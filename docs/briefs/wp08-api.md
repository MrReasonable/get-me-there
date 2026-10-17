---
wp: 8
title: "api: app bootstrap, routes, auth, hardening, static, health, record tool route"
owner: sonnet
depends_on: [4b, 7, 9, 10]
spec_sections: ["§3 Effective age", "§4 Auth and request hardening", "§5.2 Vendor links", "§5.5", "§6.5", "§6.8 (storage)", "§6.9", "§7 app_lock, Migrations", "§8.1", "§8.2", "§9 item 5", "§10", "§12", "§13", "§14"]
reviewers: [code-architect, test-strategy-reviewer, security-reviewer, provenance-auditor, product-owner, devops-reviewer]
status: reviewed
---

# WP8 — `@gmt/api`: app bootstrap, routes, auth, hardening, static, health, record tool route

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task: failing test, run, minimal code, run, commit. Steps use `- [ ]` checkboxes. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, revision 25) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`: "Global Constraints", every "Cross-package contracts" block and "Decisions taken at reconciliation" 1–58) before Task 8.0a. Refreshed on 2026-10-17 after review round 2, against main at `f8f66c0` (WP7 merged; spec revision 25; plan decisions 1–58) and the reviewed WP9 and WP10 briefs. Tasks 8.0a and 8.0b apply WP9's Task 9.0 and WP10's Task 10.1 first (decision 57); every code block below was assembled on a scratch worktree of main in that order and run green.

## 1. Goal

Turn the engine, repositories and ports into the one HTTP surface of spec §10 under `/api`, behind the auth and hardening of spec §4, started by an app bootstrap that honours the §5.5 synthetic gates, judges `app_lock` before it touches the database (§7, decision 53), backs up before migrating, and shuts down gracefully (§7, §13).

## 2. Scope

**In**

- `apps/api/src/app.ts`: `createApp(ports, engine, options?)`, a Hono app that mounts every `ROUTES` entry of `@gmt/core` `apiContract` (paths already carry `/api`). Each handler is built with `route({ request, query }, run)` over its ROUTES entry's own schema objects, which parses the body and the query exactly once (decision 54) and hands `run` their typed output; `createApp` refuses a handler whose schemas are not its entry's. Around them: the error envelope `{ error: { code, message, details? } }` (a 422 and a validation 400 carry `details.fields`), a 64 KiB body limit (413), `Cache-Control: no-store` on every API response, security headers, Host/Origin/Content-Type/X-Requested-With checks, basic auth with the per-IP failed-auth limit, static serving of the built web app with an SPA fallback outside `/api`. No `as` anywhere (`pnpm casts`, decision 48).
- Every route of spec §10 except `POST /api/tools/smoke`: health (union schema), airports autocomplete, providers, definitions CRUD with the plan-preset draft and the confirmation rule (decisions 37, 42, 43, 53, 54), both estimate routes, the coverage check, executions, single-cell verify (passing its confirmation, decision 54), results (§6.5/§6.9), calendar (with `?destination=`, decision 53), duration analysis, coverage, calendar gap, cell detail (with `verify` from `Engine.childCapPreview`, decisions 42, 48), history (the itinerary's `cell` and `carriers`; `stale`, `truncated`, `priceConfirmed` and `executionId` on its points; `stale` on route-level points, decisions 36, 38, 42, 52, 54, 55), alert rule storage and events, scheduler jobs, budget, and `POST /api/tools/record` over WP4b's `runRecord`.
- Provenance on every figure (decisions 44, 53, 54, 55, 58): staleness is core's one `isStale(provenance, now, thresholdHours)`, the effective age (the observed age, never younger than the fetch age; else fetch age plus a known `maxAgeHours`; else, the vendor's age unknown, the fetch age alone) against the threshold, called for every `stale` the api computes; every verified-basis figure (rows, calendar day minima, duration minima, the calendar gap's reference verified price) carries "not seen in latest search" and is picked latest seen, then fresh, then cheapest, over every confirmed offer before the per-itinerary dedup; a calendar-basis price is `superseded` when the latest execution that searched its cell is newer and found it empty or no_data (result rows, the calendar day's minimum, the duration's calendar minima, the cell detail) and ranks after current prices; `truncated` on every calendar price (decisions 36, 47); verified-basis minima skip prices the final step did not confirm (decisions 45, 48); every booking and search link is re-validated against `LINK_ALLOWLIST` on the way out.
- One in-flight guard (decisions 54, 58): a second run, resume or verify of a definition, or a second coverage check, while one is awaiting is 429 `already_running`; a second tool run is 409 `tool_busy`. The estimates are synchronous and need none.
- `apps/api/src/bootstrap/app.ts`: `bootApp(deps)` and `main(env)` in decision 53's order: refuse `NODE_ENV=test` (70) → re-assert the auth invariants on the injected config (78) → data directory writable (73) → read `app_lock` read-only and wait while it is fresh (75 when it stays fresh; 73 when unreadable) → backup preflight through WP4b's `bootstrap/preflight.ts` (decision 32) → `buildPorts` (migrations) → `AppLock('app')` and the 30 s heartbeat → seed + airport sanity check under the lock, as the tool bootstrap seeds (decision 58) → `createEngine` → `engine.boot()` → serve; a failed boot after the lock releases it and stops the heartbeat. SIGTERM: stop accepting → `engine.shutdown()` → `wal_checkpoint(TRUNCATE)` → lock release → close → exit 0. Every refusal is one `BootError` carrying an exit code from WP4b's single `EXIT` table (`apps/api/src/tools/types.ts`).
- Task 8.0's core and db additions (§12): core's effective age (an unknown vendor age counts the fetch age; an observed age is never younger than the fetch age), `isStale` and the "vendor's cache age unknown" label (decisions 55, 58), `byDestination` dropped from the calendar day (decision 58), `vendorLinkSchema` on every contract link field, `storedBookingSchema`, `superseded` on result rows, `budgetScopeLabel`, the verify confirmation fields, draft-tolerant stored definitions, `definitionCreateOptionalSchema` and `alertRulesQuerySchema`, the exported `CONSTRAINT_NAMES`; db's `retriedOnResume`, `OfferHistoryPoint` (supplied fields and execution) and `CalendarPricesRepo.heldBy`; the engine's exports of its own `confirmationNeeded`, `capKindOf` and `lineKey` (decision 58).
- Every §9 item 5 test as real code, plus the review-focus line 4 test.

**Out**

- `buildPorts`, `loadConfigFromEnv`, `collectSecrets`, `createLogger` (with the §14 redact paths and secret scrubbing), `safeMessage`, the tool bootstrap with `recordingTarget`, the preflight helpers, `runRecord`/`recordFixtures` and the `EXIT` table: WP4b (on main, consumed here). WP8 moves the tool bootstrap's airport seeding into a shared `bootstrap/seed.ts` both bootstraps call.
- `POST /api/tools/smoke`, `runSmoke` and the "tool bootstrap starts no execution" test: WP13. WP8 leaves the smoke route unmounted (key listed in `OWNED_ELSEWHERE`); WP13 adds its handler and removes the key.
- The alert runner (`runAlerts`, passed to `createEngine` as `opts.alerts`), `EmailNotifier`, templates: WP11, which modifies `bootApp` to pass `{ alerts: runAlerts }`. WP8 stores and reads alert rules and events only.
- `backupDatabase` (WP3) and its CLI wrapper `scripts/backup.mjs` (WP12). Dockerfile, compose, `HEALTHCHECK` (fetches `GET /api/health`), docs: WP12.
- The SPA and its client: WP9/WP10. The contract fields WP9 Task 9.0 adds (`truncated` on price cells and rows, `expandTop` on the execution summary, core's `formatAgo`/`formatFetchedAgo`) and WP10 Task 10.1 adds (`calendarQuerySchema` on the calendar route; `notSeenInLatest` on the day's verified minima, the duration's `minVerified` and the calendar gap's yardstick; `superseded` on the day's calendar minimum, the duration's calendar minima and the cell detail's calendar prices; `verification.unconfirmedCells`; per-series `searched` counts and the minima's cells; `historyPointResponseSchema`, the itinerary's `cell` and `carriers` and each point's `priceConfirmed` and `executionId`; `stale` on route-level points; the cell detail's `verify`); WP8 fills every one. WP10 labels the route-level series indicative; the contract's route points are GBP-only by shape (decision 25).
- Engine semantics (pre-start checks, the confirmation comparison at start and verify, `confirmationOf`, resume compare-and-set, child sizing, scheduler, budget fit): WP7, on main. WP8 maps `StartResult` and `ChildCapPreview` to HTTP and fills `needsConfirmation` by calling WP7's own `confirmationNeeded` and `capKindOf`, which Task 8.0 exports (decision 58); WP8 keeps no copy of the rule.
- The place-name check in `scripts/check-boundaries.mjs` and its `NOT_AIRPORT_WORDS` list: WP9 Task 9.12 (decisions 36, 46). WP8's strings need no new entry: the only three-letter capitals its new code adds are `GET` (handler keys), already listed.

## 3. Spec sections

| Section | What it requires of WP8 |
|---|---|
| §3 Effective age (rev 25) | Every price carries its effective age as a number: the observed age, or the fetch age plus a known `maxAgeHours`, or (unknown vendor age) the fetch age alone, which the web labels "vendor's cache age unknown" from the provenance. Core's `worstCaseAgeHours` returns that number (Task 8.0, decision 53); `compareAges` ranks an unknown age after any known one; core's full label for it reads "vendor's cache age unknown". Stale means the effective age exceeds the threshold, decided by core's one `isStale` (decisions 54, 55). |
| §4 "Auth and request hardening" | Basic auth (both vars or neither, password ≥ 12, constant-time compare), re-asserted by `bootApp` on an injected config; failed-auth limit 5/min per client IP (from `X-Forwarded-For` only with `TRUST_PROXY=true`, which is safe only when the app is reachable through the proxy alone), held in memory bounded by age and size, and a correct credential always succeeds (decision 54); everything authenticated except the minimal `GET /api/health`, which is also Host-exempt, and whose detail an unauthenticated deployment shows only to an allowed Host; the `ALLOWED_HOSTS` rejection names the header value and the variable, never the allowed values (decision 54); mutating routes need `Content-Type: application/json` and `X-Requested-With: get-me-there`; `Origin`, when present, must match; bodies over 64 KiB are 413; every API response is `no-store`, the 401, 403, 413 and 429 refusals included (decision 58), and none carries a CORS header; CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`. |
| §5.2 Vendor links | `vendorLink` and `booking.url` are https on a host within the provider's `LINK_ALLOWLIST` entry, checked again on the way out; anything else becomes `{ kind: 'none' }` (decision 54). |
| §5.5 | Bootstraps refuse `NODE_ENV=test`; injected-config boot matrix (production with and without the phrase, development in and out of a container, the wrong phrase, a plain `.db` path; the fixture constructor throws outside the gate; a definition naming `fixture` under production is 422 `unknown_provider`); one test spawning the real bootstrap with a real production environment. |
| §6.5 | `/results` dedups per itinerary hash, ranks by class then price, returns at most 1000 rows with `truncated` and `total`, no sort/filter parameters. |
| §6.8 | Alert rules stored with the `requireAllVerified` refinement enforced on create and on a merged partial update; events listed by rule and definition; soft delete keeps events. |
| §6.9 | Basis `verified` or `calendar`; calendar rows are class `unchecked` with a "not applied" list; default basis calendar when the snapshot has no verification provider or no observation exists, with a reason; calendar gap empty with no verification provider; a search link on every non-synthetic row. |
| §7 `app_lock`, Migrations | The app reads the lock read-only before any backup or migration (decision 53): a fresh `tool` lock → wait up to 60 s then refuse (75); a fresh `app` lock → wait up to 90 s logging its age, proceed once it goes stale, refuse a second live app (75). The lock is taken right after the migrations, and airports are seeded under it (decision 58). Heartbeat every 30 s; SIGTERM releases the lock after the checkpoint. Backup before migrations when migrations are pending; a failed backup refuses boot. Seed and the airport sanity check fail boot. |
| §8.1 | Staleness per price (as §3 above); "not seen in latest search" on every verified-basis figure; overruns against the pre-factor plan (discovery on tiles, decision 43); `/resume` manual, 409 on a lost compare-and-set or an active sibling (and WP3's `RowRejected('active')` from a lost race); single-cell verify validates membership in the current resolved space and the airports and passes the confirmation; children in results, calendar, calendar gap and duration analysis; a run's own view includes the prices it reused (decision 58). |
| §8.2 | Definition create/PUT/disable/enable/delete (re)register its cron job in the same request; cron validated by the engine's `parseCron` (sub-hourly rejected); the default definition uses the plan-aware preset; a schedule whose provider-month scope does not fit is refused (decision 25), matched by core's `budgetScopeLabel`. |
| §9 item 5 | Every test listed there (Task 8.15 sweeps). |
| §10 | The route table under `/api`, incl. `GET /airports`, `POST /definitions/estimate` and the calendar's `destination` query; the error envelope with `details.fields` on 422; `provenance` and `stale` on every price-bearing shape. |
| §12 | `process.env` read once, in `src/bootstrap/start.ts`, and parsed through the `core` schema by WP4b's `loadConfigFromEnv`. |
| §13, §14 | `/api/health` for the `HEALTHCHECK`; graceful shutdown; pino with redaction and secret scrubbing (WP4b's `createLogger`); error messages through WP4b's `safeMessage`. |

The brief follows the spec at revision 25 and plan decisions 1–58 (revision 25 changes alert delivery, which is WP11's; WP8's alert routes only read events). Decisions 53 and 54 rule on this brief's first review round, 57 on its task order and 58 on its second round; decision 55 (from the WP11 refresh) gives core one `isStale` that WP8 adds and WP8 and WP11 both call, and the unknown-age label text; §13 lists only what the plan has not recorded.

## 4. Interfaces consumed

As the code on main declares them (WP0–WP7, WP4b), plus the WP9 Task 9.0 and WP10 Task 10.1 contract fields (marked). Only the members WP8 calls are listed; the plan's "Cross-package contracts" are authoritative for the rest.

```ts
// @gmt/core — types and helpers (WP0–WP2, WP7)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export function cellKeyString(c: CellKey): string;
export interface SearchDefinition { id; name; origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights; maxNights; cabin; constraints; verification: VerificationPolicy; budget: ExecutionBudget; providers: ProvidersConfig; destinationNotes: Partial<Record<Iata, string>>; onwardCostPence: Partial<Record<Iata, number>>; scheduleCron: string | null; scheduleTz: string; confirmedCostPence: number | null; confirmedCalls: number | null; enabled: boolean; createdAt; updatedAt; deletedAt: IsoDateTime | null }
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'confirmedCostPence' | 'confirmedCalls' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean; droppedAlwaysInclude: CellKey[] };
export interface Execution { id; definitionId; isChild; cell: CellKey | null; snapshot: DefinitionSnapshot; status: ExecutionStatus; stage: Stage | null; estimate: Estimate | null; resumeAfter; startedAt; finishedAt; errorText; createdAt; trigger: 'manual' | 'schedule' | 'tool' }
export interface Buckets { priced; empty; no_data; error; skipped; not_run; reused }
export interface Estimate { cells; perProvider: Array<{ providerId; stage: Stage; calls; planCalls; costMicroGbp; costPence; seconds; blocked: string | null }>; totalCalls; totalPlanCalls; totalCostMicroGbp; totalCostPence; seconds; assumptions: string[]; windowClamped; retryFactor }
export type BudgetFit = z.infer<typeof budgetFitSchema>;   // { fits; runsPerMonth; perScope: Array<{ scope; estimated; cap: number | null; fits }> }
export type BudgetScope = { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string } | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId } | { kind: 'global-month' };
export interface Usage { calls; costMicroGbp; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
export interface ProviderLimits { monthlyCallCap; window: 'month' | 'lifetime'; …; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export function microGbpToPence(micro: number): number;               // rounds up (decisions 47, 49)
export const TRUNCATED_NOTE = 'cheapest of the rows read'; export function isTruncated(lastError: string | null): boolean;   // decision 47
export const PRICE_UNCONFIRMED = 'price-unconfirmed';                 // the verified cell's reason when no offer is confirmed (test seeder)
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;                   // decision 21
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;   // always carries fetchedHours
export function resolveWindow(w: WindowSpec, todayLondon: IsoDate): { departureFrom; departureTo; clamped };
export function generateCells(space: ResolvedSpace): Cell[]; export function countCells(space: ResolvedSpace): number;
export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number;
export function validateSearchSpace(def: Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'>, todayLondon: IsoDate, lookup: AirportLookup, maxCells: number): ValidationResult;
export interface AirportLookup { exists(iata: Iata): boolean; metroOf(iata: Iata): string | null; airportsOfMetro(code: string): Iata[] }
export function selectedNotReached(selected: CellKey[], outcomes: CellOutcome[]): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }>;
export function sixBuckets(outcomes: CellOutcome[]): Buckets;
export function evaluateConstraints(it, obs, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts;
export function verdictClass(v: Verdicts): VerdictClass;   // throws without a cabin verdict: never called on calendar rows
export function unverifiedNames(v: Verdicts): ConstraintName[];
export function dedupByItinerary(rows: ResultRow[], now: IsoDateTime): ResultRow[]; export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[];
export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url; host; label } | null;   // null for 'fixture'
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export function validateVendorUrl(url: string, allowed: readonly string[]): Booking;   // spec §5.2
export function formatPence(pence: number): string;
export function stripUrlsInText(text: string): string; export function syntheticAllowed(c: SyntheticGateInput): boolean;
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word; index }>; export const BANNED_WORD_ALLOWLIST: readonly string[];
export const iataSchema: z.ZodType<Iata, string>; export const isoDateSchema: z.ZodType<IsoDate, string>;
export function isoDateTimeOfEpochMs(ms: number): IsoDateTime; export function londonDateOf(instant: IsoDateTime): IsoDate;
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export const FIXTURE_OPT_IN_PHRASE = 'i-understand-this-is-fake';
export interface Config { nodeEnv; databasePath; port; bindAddress; allowedHosts: string[]; auth: { user: string; pass: Secret } | null; allowUnauthenticated: boolean; trustProxy; logLevel; pointOfSale; staleAfterHours: number; calendarStaleAfterHours: number | null; maxCellsPerDefinition; schedulerTimezone; spend: { monthlyCapMicroGbp; softConfirmMicroGbp; executionMaxCalls; executionMaxFreeCalls; executionMaxCostMicroGbp; childMaxCalls; … }; providers: { travelpayouts: { token; limits } | null; searchapi: { key; plan: PlanId; trialUsed; limits } | null; fixture: { costMicroGbp } | null }; … }
export interface FlightProvider { id; displayName; discovery?: { info: CapabilityInfo; … }; verification?: { info: CapabilityInfo; … }; … }
export * as apiContract from './api-contract/index.js';
// apiContract (WP0, WP7; WP9 Task 9.0, WP10 Task 10.1 marked; Task 8.0's additions in §5):
//   ROUTES: readonly RouteDef[] (RouteDef { method; path /* /api/… */; request?; query?; response; auth: 'public' | 'required' })
//   errorEnvelopeSchema, cellKeySchema, priceCellSchema { pricePence, provenance, stale, ageHours, truncated /* 9.0 */ }, executionSummarySchema (+ expandTop /* 9.0 */), usageSchema, coverageSummarySchema,
//   definitionCreateRequestSchema / definitionUpdateRequestSchema (+ confirmedCostPence?, confirmedCalls?), definitionShapeSchema,
//   definitionResponseSchema (+ confirmedCalls; needsConfirmation { estimateMicroGbp, totalCalls, confirmedCostPence, confirmedCalls }),
//   estimateResponseSchema, coverageCheckRequestSchema, coverageCheckResponseSchema (cachedRows: number | null),
//   executionResponseSchema, startExecutionRequestSchema { confirmCostPence?, confirmCalls? }, startExecutionResponseSchema, verifyCellRequestSchema,
//   resultRowSchema (+ truncated /* 9.0 */), resultsQuerySchema, resultsResponseSchema,
//   calendarQuerySchema { destination? } /* 10.1 */, calendarResponseSchema (day: verification.unconfirmedCells; cheapestVerified / cheapestPartiallyVerified + notSeenInLatest; cheapestCalendar + superseded /* 10.1 */),
//   durationAnalysisResponseSchema (minima carry `cell`; minVerified + notSeenInLatest; minCalendar[].price + superseded; searched { verification: { searched, total }; discovery: Array<{ providerId; searched; total }> } /* 10.1 */),
//   coverageResponseSchema, calendarGapResponseSchema (cheapestVerified + notSeenInLatest /* 10.1 */), cellDetailResponseSchema (calendarPrices[] + superseded; verify: { maxCalls; headroomCalls } | null /* 10.1 */),
//   historyPointSchema, historyPointResponseSchema { …HistoryPoint, stale, truncated } /* 10.1 */, itineraryHistoryResponseSchema (cell, carriers; points + priceConfirmed, executionId /* 10.1 */),
//   routeHistoryQuerySchema, routeHistoryResponseSchema (routeSeries points + stale /* 10.1 */), routeSeriesPointSchema, airportsQuerySchema, airportsResponseSchema, providersResponseSchema,
//   budgetResponseSchema, schedulerJobsResponseSchema, healthPublicSchema, healthDetailSchema, alertRuleSchema, alertRuleInputSchema,
//   alertRuleUpdateRequestSchema, alertEventSchema, alertEventsQuerySchema, toolRecordRequestSchema, toolRunResponseSchema

// @gmt/db (WP0, WP3, WP7)
export interface Db { raw: BetterSqlite3.Database; transaction; immediateTransaction; close(): void }
export const MIGRATIONS_DIR: string; export const AIRPORTS_DATA_DIR: string;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export function readOnlyLockState(dbPath: string, clock: Clock): { state: 'absent' } | { state: 'fresh' | 'stale'; holder: 'app' | 'tool'; heartbeatAt: IsoDateTime };   // opens the file read-only (absent for :memory: or no file); throws when it is not a database
export class AppLock { constructor(db: Db, holder: 'app' | 'tool', clock: Clock, log: Logger, opts?); static inspect(db: Db): { holder; heartbeatAt; acquiredAt } | null; acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void }
export class RowRejected extends Error { readonly rule: string }   // rule 'active': an execution of the definition is already active (WP7)
export function loadAirportsDataset(dir: string): AirportsDataset; export function seedAirports(db: Db, dataset: AirportsDataset): { inserted; datasetVersion };
export function sanityCheckAirports(db: Db, referenced: Iata[]): { ok: true } | { ok: false; reason: string };
export class AirportsRepo { exists(iata); search(q, limit): Airport[]; metroOf(iata); airportsOfMetro(code): Iata[]; count(): number; datasetVersion(): string | null }
export class DefinitionsRepo { create(input: DefinitionInput & { confirmedCostPence?: number; confirmedCalls?: number }): SearchDefinition; update(id, patch: Partial<DefinitionInput>): SearchDefinition; get(id): SearchDefinition | null; list(opts?): SearchDefinition[]; softDelete(id): void; setConfirmed(id, confirmed: { pence: number; calls: number } | null): void }
export class ExecutionsRepo { get(id): Execution | null; listForDefinition(definitionId, opts: { limit; includeChildren }): Execution[] /* newest first: created_at, then rowid */ }
export class CellsRepo { outcomes(executionId, filter?: { stage?; providerId?; cells? }): CellOutcome[]; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; selected(executionId): Array<{ cell; reason }> }
export class CalendarPricesRepo { latestPerCell(definitionId, cabin, space: ResolvedSpace | null): CalendarPriceRow[]; fetchedBy(executionId): CalendarPriceRow[]; heldBy(executionId): CalendarPriceRow[] /* Task 8.0: fetched and reused rows */; history(origin, destination, cabin, opts?): Array<{ providerId; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> }
export class ItinerariesRepo { get(hash): (NormalisedItinerary & { firstSeenAt }) | null; observationsForDefinition(definitionId, opts: { executionIds; space; cabin; includeChildren }): ObservationRow[]; latestVerificationOutcomeForCell(definitionId, cell, cabin): CellOutcome | null; offerHistory(hash): Array<{ providerId; seller; cabin; points: OfferHistoryPoint[] /* Task 8.0 */ }> }
export class LedgerRepo { countsFor(executionId): { calls; costMicroGbp; tiles; cacheHits; perProvider: Array<{ providerId; stage: Stage | null; calls; costMicroGbp; tiles; cacheHits }> } }
export class AlertsRepo { rules(definitionId?): AlertRule[]; get(id); create(input); update(id, patch); softDelete(id); events(filter: { ruleId?; definitionId?; limit }): AlertEvent[] }
export class NotificationsRepo { wasSent(kind: OperatorMessageKind, executionId: string | null, definitionId: string): boolean }
export class RoutePriceHistoryRepo { series(origin, destination, providerId, cabin: Cabin | 'unknown'): RouteSeriesPoint[] }

// @gmt/providers (WP4): fixtureProvider(opts): FlightProvider (throws unless syntheticAllowed); buildPorts wires the fixture host through http-kit's gated inProcessHosts.

// @gmt/engine (WP7, on main)
export interface StartOptions { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number }
export interface VerifyCellOptions { confirmCostPence?: number; confirmCalls?: number }
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled'; message: string; details: unknown };
export type ChildCapPreview = { ok: true; maxCalls: number; headroomCalls: number } | { ok: false; code: 'not_found' | 'window'; message: string };
export interface Engine { boot(): Promise<void>; shutdown(): Promise<void>; start(definitionId, opts: StartOptions): Promise<StartResult>; resume(executionId, opts: { manual: boolean }): Promise<StartResult>; cancel(executionId): Promise<boolean>; verifyCell(definitionId, cell: CellKey, opts?: VerifyCellOptions): Promise<StartResult>; childCapPreview(definitionId, cell: CellKey): ChildCapPreview; estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate; budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit; coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>; scheduler: { register(def): void; unregister(definitionId): void; jobs(): SchedulerJob[]; tick(definitionId): Promise<void>; blockedSince(): IsoDateTime | null }; status(): { running: string[]; degraded: boolean; nextRun; lastExecutionAt } }
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;   // boot() makes no network call
export function confirmationOf(e: Pick<Estimate, 'perProvider'>): { pence: number; calls: number };   // worst case over every line, blocked ones included
export const SOFT_CONFIRM_CALL_SHARE = 0.2;                                                            // decisions 25, 53
// Task 8.0 exports (decision 58): the engine's own confirmation rule and cap-scope mapping, narrowed to what they read
export interface ConfirmationContext { config: Pick<Config, 'spend'>; budget: Pick<BudgetGuard, 'usage'>; limitsOf(id: ProviderId): { capKind: 'provider-month' | 'provider-lifetime' } }
export function confirmationNeeded(ctx: ConfirmationContext, estimate: Estimate, blocked: ReadonlySet<LineKey>, confirmed: Confirmation): { estimateMicroGbp; estimatePence; calls; totalCalls; reason } | null;
export function capKindOf(window: 'month' | 'lifetime'): 'provider-month' | 'provider-lifetime'; export type LineKey; export function lineKey(stage: Stage, providerId: ProviderId): LineKey;
export function parseCron(expr: string, tz: string): { ok: true; next(from: Date): Date | null } | { ok: false; reason: string };
export class LogNotifier implements Notifier { constructor(log: Logger) }
// What WP8 relies on: estimate() is the worst case without reuse with `blocked` filled and totals over the lines that would run;
// a start or verify compares the stored or sent confirmation in pence AND calls with confirmationOf(estimate);
// childCapPreview sizes exactly as verifyCell will and refuses where verifyCell would.

// apps/api on main (WP4b)
export interface Ports { config; db: Db; repos: Repos; budget: BudgetGuard; cache; http; providers: FlightProvider[]; clock; log: Logger; secrets: Secret[]; recorder; fixtureRoot: string | null }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?; migrationsDir: string; fixtureRoot?: string }): Ports;
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;   // throws InvalidConfigError naming every bad field
export class InvalidConfigError extends Error {}; export function collectSecrets(config: Config): Secret[];
export function createLogger(config: Pick<Config, 'logLevel'>, opts?: { destination?: NodeJS.WritableStream; fd?: 1 | 2; secrets?: readonly Secret[] }): Logger;
export function safeMessage(e: unknown, secrets: readonly Secret[]): string;   // src/safeMessage.ts: URL queries and userinfo stripped, secrets replaced
export const EXIT = { ok: 0, failed: 1, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;   // src/tools/types.ts
// src/bootstrap/preflight.ts (decision 32): dataDirRefusal(databasePath): string | null; pendingOnExistingDb(databasePath, migrationsDir): string[];
//   backupsDirFor(databasePath): string; BACKUPS_KEPT = 5;
//   backupBeforeMigrations(databasePath, migrationsDir, clock, secrets): { ok: true; line: string | null } | { ok: false; code: 73 | 74; message: string }
// src/bootstrap/tool.ts: runTool(name, argv, opts?): Promise<number>; interface RecordingTarget { root; recordedBy }; recordingTarget(cli: RecordCli, given?: RecordingTarget, roots?): RecordingTarget | { refusal: string }
// src/tools/record.ts: recordPrecheck(c: Config): string | null; runRecord(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number /* exit code */>
// src/tools/recordPlan.ts: interface RecordCli { args: RecordArgs; dryRun: boolean; confirmRerun: boolean; out: string | null }
// test/helpers (WP4b): env.ts cleanEnv, SENTINEL_AUTH/SA/TP, silentLog; tmp.ts tempDir, onCleanup; test/support/setup.ts installs WP4's network guards
```

The fixture provider is reached through http-kit's gated `inProcessHosts` seam (`buildPorts` wires it under `syntheticAllowed`), so route tests need no `msw`.

## 5. Interfaces produced

```ts
// apps/api/src/routes/types.ts, define.ts
export const API_PREFIX = '/api';
export type AppEnv = { Variables: { authenticated: boolean } };
export interface RawInput { body: unknown; query: Record<string, string> | undefined; params: Record<string, string> }
export interface RouteContext { ports: Ports; engine: Engine; tools: HttpToolRunners; busy: Set<string> }
export interface RouteHandler { readonly request: z.ZodType; readonly query: z.ZodType; handle(c: Context<AppEnv>, raw: RawInput, ctx: RouteContext): Response | Promise<Response> }
export type HandlerTable = Readonly<Record<string, RouteHandler>>;   // keyed `${method} ${path}` of a ROUTES entry
export const NO_INPUT: z.ZodUndefined;   // the schema of an input a route does not take
export function route<B extends z.ZodType, Q extends z.ZodType>(schemas: { request: B; query: Q }, run: (c, input: { body: z.output<B>; query: z.output<Q>; params }, ctx) => Response | Promise<Response>): RouteHandler;
export function plain(run: (c, input: { body: undefined; query: undefined; params }, ctx) => Response | Promise<Response>): RouteHandler;
export type ToolRunResponse = z.infer<typeof apiContract.toolRunResponseSchema>;
export interface HttpToolRunners { record?: (args: ToolRecordRequest, signal: AbortSignal) => Promise<ToolRunResponse> }   // named apart from WP4b's CLI ToolRunners
/** ROUTES entries whose handler another package owns; left unmounted here. WP13 removes 'POST /api/tools/smoke' when it adds its handler. */
export const OWNED_ELSEWHERE: ReadonlySet<string>;

// apps/api/src/app.ts, routes/shared.ts, errors.ts
export const MAX_BODY_BYTES = 64 * 1024;
export interface AppOptions { webRoot?: string | null; tools?: HttpToolRunners; clientIp?: (c: Context<AppEnv>) => string | null; routes?: readonly apiContract.RouteDef[] }
export function createApp(ports: Ports, engine: Engine, options?: AppOptions): Hono<AppEnv>;   // strict mounting (Task 8.15)
export function oneAtATime<T>(ctx: RouteContext, key: string, fn: () => T | Promise<T>, busy?: () => ApiError): Promise<T>;   // the one in-flight guard; 429 already_running by default (decisions 54, 58)
export class ApiError extends Error { constructor(status: ContentfulStatusCode, code: string, message: string, details?: Details) }
export function envelope(code: string, message: string, details?: Details): { error: { code; message; details? } };

// apps/api/src/bootstrap/app.ts, lock.ts, seed.ts, paths.ts
export interface BootDeps { config: Config; log: Logger; clock?: Clock; listen: boolean; assets: AssetPaths; tools?: (ports: Ports) => HttpToolRunners; sleep?: (ms: number) => Promise<void> }
export interface RunningApp { app: Hono<AppEnv>; ports: Ports; engine: Engine; port: number | null; close(): Promise<void> }
export function assertAuthInvariants(config: Config, log: Logger): void;
export function bootApp(deps: BootDeps): Promise<RunningApp>;
export function main(env: NodeJS.ProcessEnv): Promise<void>;
export function waitForLockFree(d: { databasePath; clock; sleep; log; secrets }): Promise<void>; export const TOOL_LOCK_WAIT_MS = 60_000; export const APP_LOCK_WAIT_MS = 90_000;
// bootstrap/errors.ts: export class BootError extends Error { constructor(message: string, exitCode: number); readonly exitCode: number }   // the one refusal (decision 58)
export function seedIfNeeded(ports: Ports, dataDir: string, report: (line: string) => void): void;   // both bootstraps
export interface AssetPaths { migrationsDir: string; airportsDataDir: string; webRoot: string | null }; export function assetPaths(): AssetPaths;

// apps/api/src/read/*: the read model the routes share and WP11 may reuse
export function staleness(p: Provenance, thresholdHours: number, now: IsoDateTime): { ageHours: number; stale: boolean };   // effective age; stale from core's isStale (decisions 44, 54, 55)
export function loadRows(def: SearchDefinition, ports: Ports, executionIds?: readonly string[]): Loaded;
export function pickVerified(rows: readonly ResultRow[]): ResultRow | null;   // read/pick.ts: seen in the newest search, then fresh, then cheaper (decisions 54, 58)
export function pickCalendar(rows: readonly ResultRow[]): ResultRow | null;   // read/pick.ts: a current price before a superseded one, then cheaper
export function safeBooking(b: Booking, providerId: ProviderId): Booking;     // read/links.ts: LINK_ALLOWLIST re-validation (decision 54)
export function executionSummary(e: Execution, now: IsoDateTime): ExecutionSummary;
export function defaultDefinitionInput(config: Config, providers: readonly FlightProvider[]): DefinitionInput;   // src/defaults.ts; DEFAULT_CRON = '0 5 * * 1'

// apps/api/src/tools/inProcess.ts
export function inProcessTools(ports: Ports, opts?: { recording?: RecordingTarget; runRecord?: typeof runRecord }): HttpToolRunners;

// @gmt/core (Task 8.0)
export function effectiveAge(p, now: IsoDateTime): EffectiveAge;   // observedHours = max(observed age, fetch age) (decision 58)
export function worstCaseAgeHours(a: EffectiveAge): number;   // unknown vendor age → the fetch age (spec §3, decision 53)
export function isStale(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime, thresholdHours: number): boolean;   // the one staleness rule (decision 55; WP11 calls it too)
export function formatAgeFull(a: EffectiveAge): string;   // unknown vendor age: "fetched 2h ago · vendor's cache age unknown" (decision 55)
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;   // an unknown age loses to any known one
export function budgetScopeLabel(s: BudgetScope): string;   // 'provider-month:searchapi', 'global-month', …
export { CONSTRAINT_NAMES };   // now in the barrel
// apiContract: vendorLinkSchema (https on a LINK_ALLOWLIST host; bookingSchema and searchLinkSchema use it), storedBookingSchema (any URL; db reads),
//   resultRowSchema.superseded (decision 54, as on WP10's calendar figures),
//   verifyCellRequestSchema { confirmCostPence?, confirmCalls? }, draft-tolerant definitionShapeSchema / definitionResponseSchema,
//   definitionCreateOptionalSchema, alertRulesQuerySchema; calendarDaySchema without byDestination (decision 58)
// @gmt/db (Task 8.0)
export function retriedOnResume(o: Pick<CellOutcome, 'status' | 'reason' | 'attempts'>, manual: boolean): boolean;   // RESUMABLE_SQL's rule, from the same lists
export interface OfferHistoryPoint extends HistoryPoint { suppliedFields: SuppliedField[]; executionId: string }   // offerHistory points
CalendarPricesRepo.heldBy(executionId): CalendarPriceRow[];   // the rows a run fetched and the copies it reused (decision 58)
// @gmt/engine (Task 8.0): confirmationNeeded, ConfirmationContext, Confirmation, capKindOf, lineKey, LineKey exported (§4)
```

## 6. Library notes

All versions from the plan's Task 0.1 list (already in `apps/api/package.json`). Every call below was exercised by this revision's assembly run on 2026-10-17; the API shapes were first verified with context7 on 2026-10-14 (sources in the last column).

| Library | Version | Calls used | Source verified |
|---|---|---|---|
| `hono` | 4.13.13 | `new Hono<AppEnv>()`, `app.on(method, path, handler)`, `app.use(path, mw)`, `app.onError`, `app.notFound`, `app.request(url, init)` for tests, `c.json(body, status)`, `c.header()`, `c.req.header()`, `c.req.path`, `c.req.method`, `c.req.param()`, `c.req.query()`, `c.req.text()`, `c.req.raw.signal`; `bodyLimit({ maxSize, onError })` from `hono/body-limit` (checks `Content-Length`, then counts a streamed body); `secureHeaders` from `hono/secure-headers` with `contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] }`, `referrerPolicy: 'no-referrer'`, `xContentTypeOptions: 'nosniff'`, `xFrameOptions: 'DENY'` | context7 `/websites/hono_dev` (secure-headers options table; body-limit; `app.request`) |
| `@hono/node-server` | 2.1.5 | `serve({ fetch, port, hostname }, (info) => …)` returns the `node:http` server; `serveStatic({ root })` and `serveStatic({ path })` from `@hono/node-server/serve-static` (rejects `..`, `//` and backslashes; calls `next()` when not found); `getConnInfo(c)` from `@hono/node-server/conninfo` (`info.remote.address`; throws under `app.request()`, which has no socket) | context7 `/honojs/node-server` |
| `zod` | 4.6.7 | `safeParse`, `z.output`, `z.undefined()`, `z.url().refine(…)`, `.pick`, `.extend`, `.optional()`, `z.looseObject` and `z.record` (tests parse bodies rather than cast them) | the api-contract's own usage |
| `pino` | 10.4.0 (through WP4b's `createLogger`) | not configured here; tests pass a `Writable` as `opts.destination` to capture lines | context7 `/pinojs/pino` |
| `tsx` | 4.23.15 (dev) | `node --conditions=@gmt/source --import tsx src/bootstrap/start.ts` for the spawn test and `pnpm dev` (`--watch`) | tsx docs: `--import tsx` is the Node ≥ 20.6 loader form |
| `vitest` | 5.0.4 | `describe/it/it.each`, `describe(name, { timeout }, fn)` (the boot files, which seed the full airports table per boot), `vi.spyOn`, `vi.fn`, `vi.waitFor`, `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })` and `vi.advanceTimersByTime` (the heartbeat), `afterEach`; coverage `thresholds` with glob keys (`'src/read/**'`); per-task runs use `pnpm --filter @gmt/api exec vitest run <files>` (decision 8) | — |
| Node | 22 | `node:crypto` `createHash`, `timingSafeEqual`; `node:child_process` `spawn`, `spawnSync`; `node:net` `createServer().listen(0)` (no host: WP4's guards refuse even a lookup of `127.0.0.1`); `node:stream` `Writable`; `fs.readdirSync(dir, { recursive: true, withFileTypes: true })` with `parentPath`; `path.relative` | Node docs |

`@hono/zod-validator` leaves `apps/api` (Task 8.1 removes it): each handler parses its own body and query once with the ROUTES schemas (decision 54), so a validator middleware would parse a second time.

## 7. Files

**Create** (under `apps/api/` unless noted)

```
src/text.ts                    API_TEXT: every fixed user-facing string the api emits
src/errors.ts                  ApiError, envelope, fieldsDetail, issuesToFields, scrubDetails, onError (RowRejected('active') → 409), notFound
src/defaults.ts                DEFAULT_CRON, defaultDefinitionInput (spec §8.2 preset, §11 form defaults)
src/static.ts                  mountStatic(app, webRoot): serveStatic + SPA fallback outside /api
src/app.ts                     createApp, MAX_BODY_BYTES, mounting from ROUTES
src/middleware/headers.ts      securityHeaders()
src/middleware/hardening.ts    hostAllowed, hostAllowlist, originCheck, noStore, mutatingRequestCheck
src/middleware/auth.ts         credentialsMatch, FailedAuthLimiter, UNKNOWN_IP, clientIpFrom, basicAuthGate
src/routes/types.ts            API_PREFIX, AppEnv, RawInput, RouteContext, RouteHandler, HandlerTable, HttpToolRunners, OWNED_ELSEWHERE
src/routes/define.ts           NO_INPUT, route, plain: one validation per request
src/routes/shared.ts           param, getLiveDefinition, oneAtATime (the one in-flight guard)
src/routes/index.ts            HANDLERS (merge of every table below)
src/routes/system.ts           /api/health, /api/airports, /api/providers, /api/budget, /api/scheduler/jobs
src/routes/definitions.ts      /api/definitions CRUD, both estimate routes, /api/definitions/coverage-check
src/routes/executions.ts       /api/definitions/:id/executions, /api/executions/:id[/cancel|/resume], /api/cells/verify
src/routes/results.ts          /results, /calendar, /duration-analysis, /coverage, /calendar-gap, /cells/…
src/routes/history.ts          /api/itineraries/:hash/history, /api/routes/:origin/:destination/history
src/routes/alerts.ts           /api/alerts CRUD, /api/alerts/events
src/routes/tools.ts            /api/tools/record
src/read/space.ts              isDraft, currentSpace, cellInSpace, airportLookup
src/read/usage.ts              providerLimits, providerScopes, budgetScopes, usageOf
src/read/definitions.ts        definitionResponse, deletedResponse, needsConfirmation (over WP7's confirmationNeeded), sentCovers, mergeDefinition, inputOf
src/read/executions.ts         executionResponse, executionSummary, overrunOf, planCallsOf, hoursSince
src/read/rows.ts               staleness, thresholds, priceCell, verifiedRow, calendarRow, latestPerOffer, notSeenResolver
src/read/links.ts              safeBooking, safeSearchLink (spec §5.2 re-validation)
src/read/pick.ts               cheapest, pickVerified, pickCalendar (picking one figure out of rows)
src/read/coverage.ts           coverageSummaryFor, zeroBuckets, SEARCHED
src/read/results.ts            loadRows, truncationOf, confirmedIn, chooseBasis, assembleResults
src/read/calendar.ts           assembleCalendar, assembleCalendarGap
src/read/duration.ts           assembleDuration
src/read/coverageView.ts       assembleCoverage, retryable
src/read/cell.ts               assembleCellDetail
src/read/history.ts            itineraryHistory, routeHistory
src/bootstrap/paths.ts         assetPaths()
src/bootstrap/errors.ts        BootError (the one boot refusal, decision 58)
src/bootstrap/lock.ts          waitForLockFree
src/bootstrap/seed.ts          seedIfNeeded (both bootstraps)
src/bootstrap/app.ts           bootApp, assertAuthInvariants, main
src/bootstrap/start.ts         the process entry (the app's one process.env read)
src/tools/inProcess.ts         inProcessTools(ports, opts?): the record runner over runRecord
test/helpers/harness.ts        in-memory ports + engine + app; request helper; captureLines; harnessEnv
test/helpers/contract.ts       expectContract, expectEnvelopeOrContract, errorOf
test/helpers/examples.ts       exampleDefinitionInput (the worked example, sized for tests), SMALL_WINDOW
test/helpers/seed.ts           seeder over WP3's atomic writes and the real budget guard (generated ids, named in tests)
test/defaults.test.ts, test/bootstrap/app.{spawn,matrix,lock,backup,shutdown}.test.ts, test/routes/*.test.ts
packages/core/test/api-contract/wp08.test.ts, packages/db/test/cells.retriedOnResume.test.ts
```

**Modify**

- `apps/api/package.json`: remove `@hono/zod-validator`; scripts `dev` (the entry is `start.ts`) and `start` (Task 8.1).
- `apps/api/src/bootstrap/tool.ts`: call the shared `seedIfNeeded`; its heartbeat error is logged under `err` (Task 8.1).
- `apps/api/vitest.config.ts`: per-folder thresholds for `src/read/**` and `src/routes/**` (Task 8.15). The default test timeout stays; the boot files name their own (`BOOT_TIMEOUT_MS`).
- `packages/core/src/labels/age.ts`, `ports/budget.ts`, `index.ts`, `api-contract/{common,results,definitions,executions,alerts,index}.ts` and their tests (Task 8.0).
- `packages/db/src/types.ts`, `index.ts`, `internal/read.ts`, `repositories/itineraries.ts`, `repositories/cells.ts`, `repositories/calendarPrices.ts` and their tests (Task 8.0).
- `packages/engine/src/context.ts`, `start.ts`, `index.ts` and `test/smoke.test.ts` (Task 8.0: the exports of decision 58, no behaviour change).
- WP9's Task 9.0 and WP10's Task 10.1 files, exactly as those tasks write them (Tasks 8.0a, 8.0b; decision 57).
- `src/wiring.ts`, `src/logger.ts`, `src/safeMessage.ts`, `src/bootstrap/preflight.ts` and `src/tools/*` other than `inProcess.ts` are WP4b's and are not changed here.

## 8. Tasks

Every "Run" step assumes the workspace dependencies of `@gmt/api` resolve from source (the `@gmt/source` condition and the Vitest aliases). Per-task runs use `pnpm --filter @gmt/api exec vitest run <files>` (no coverage threshold on a partial run, decision 8); the full `pnpm --filter @gmt/api test` enforces thresholds. Tasks 8.0a and 8.0b apply WP9's and WP10's contract tasks as their briefs write them (decision 57); Task 8.0's patches apply on top of them. Tasks 8.2–8.8 pin behaviour Task 8.1 already builds (the bootstrap and the middleware cannot boot without each other); each is seen failing first by its temporary mutations, one per rule, which the step then reverts. The feature tasks 8.9–8.15 fail first because their routes do not exist yet, and then list the mutations that prove each rule's test bites. Every mutation and its failing test names were run on the assembled tree.

### Task 8.0a: Apply WP9's Task 9.0 (contract fields WP8 fills)

Plan decision 57: WP8 needs contract fields WP9 and WP10 introduce, while their web tasks need WP8's api, so WP8's implementer applies WP9's Task 9.0 and then WP10's Task 10.1 exactly as their briefs write them, as WP8's first two tasks; WP9's and WP10's implementers then skip them (already on main). Do not copy or adapt them: every Task 8.0 patch below applies on top of their result.

- [ ] **Step 1: Apply WP9's Task 9.0 as written**

Work through `docs/briefs/wp09-web-shell-definitions-results.md` §8 **Task 9.0** ("Core additions: `truncated` on every price, the run's `expandTop`, the departure-date filter, the age phrases", line 285 on main at `f8f66c0`), Steps 1–4, unchanged: the new `packages/core/test/results/webAdditions.test.ts`, the `common.ts` and `results.ts` edits, the replaced `results/types.ts`, `results/filter.ts` and `labels/age.ts`, and the `helpers/rows.ts` and `contract.test.ts` fixture edits.

- [ ] **Step 2: Run that task's checks**

Run: `pnpm --filter @gmt/core exec vitest run test/results test/api-contract test/labels && pnpm --filter @gmt/core test && pnpm --filter @gmt/core typecheck`
Expected: PASS, as WP9's Task 9.0 Step 4 states; core at 100% on every metric.

- [ ] **Step 3: Commit**

```bash
git add -A apps/api packages && git commit -m "wp09 task 9.0 (applied by WP8, plan decision 57): truncated on every price, expandTop, the departure filter, the age phrases"
```

### Task 8.0b: Apply WP10's Task 10.1 (contract fields WP8 fills)

- [ ] **Step 1: Apply WP10's Task 10.1 as written**

Work through `docs/briefs/wp10-web-calendar-duration-history.md` §8 **Task 10.1** ("Contract additions in core (first failing test)", line 289 on main at `f8f66c0`), Steps 1–4, unchanged: the new `packages/core/test/api-contract/wp10.test.ts` and the `api-contract/results.ts` and `api-contract/index.ts` edits. Its last edit targets WP9's `apps/web/test/fixtures.ts`, which does not exist until WP9's web tasks create it: skip that one edit here (§13 item 2).

- [ ] **Step 2: Run that task's checks**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract && pnpm -r typecheck`
Expected: PASS, as WP10's Task 10.1 Step 4 states; typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add -A apps/api packages && git commit -m "wp10 task 10.1 (applied by WP8, plan decision 57): the calendar query, the views' marks, unconfirmedCells, searched counts, history fields, verify"
```

### Task 8.0: Core, db and engine: effective age and `isStale`, link re-validation, the row's superseded mark, scope labels, the resume predicate, a run's held prices, the engine's confirmation rule

**Files:**
- Create: `packages/core/test/api-contract/wp08.test.ts`, `packages/db/test/cells.retriedOnResume.test.ts`
- Modify: `packages/core/src/labels/age.ts`, `packages/core/src/ports/budget.ts`, `packages/core/src/index.ts`, `packages/core/src/api-contract/common.ts`, `packages/core/src/api-contract/results.ts`, `packages/core/src/api-contract/definitions.ts`, `packages/core/src/api-contract/executions.ts`, `packages/core/src/api-contract/alerts.ts`, `packages/core/src/api-contract/index.ts`, `packages/core/test/labels/age.test.ts`, `packages/core/test/api-contract/contract.test.ts`, `packages/core/test/helpers/rows.ts`, `packages/core/test/wp2-barrel.test.ts`, `packages/db/src/types.ts`, `packages/db/src/index.ts`, `packages/db/src/internal/read.ts`, `packages/db/src/repositories/itineraries.ts`, `packages/db/src/repositories/cells.ts`, `packages/db/src/repositories/calendarPrices.ts`, `packages/db/test/barrel.test.ts`, `packages/db/test/itineraries.test.ts`, `packages/db/test/reuse.test.ts`, `packages/engine/src/context.ts`, `packages/engine/src/start.ts`, `packages/engine/src/index.ts`, `packages/engine/test/smoke.test.ts`

**Interfaces:**
- Consumes: `effectiveAge`, `EffectiveAge`, `formatAgeFull`, `LINK_ALLOWLIST`, `validateVendorUrl`, `BudgetScope`, `CONSTRAINT_NAMES` (core); the api-contract schemas (WP0, WP7); `ItinerariesRepo.offerHistory`, `CalendarPricesRepo`, `RESUMABLE_SQL`'s `NON_RETRYABLE`/`MANUAL_RETRYABLE` lists (WP3, WP7); WP7's `confirmationNeeded`, `EngineContext.limitsOf(id).capKind`, `lineKey` (internal until now).
- Produces (each a ruling of decisions 53–58, or a field no other brief adds):
  - `effectiveAge` clamps an observed age to at least the fetch age (decision 58): a vendor cannot have observed a price after we fetched it, so a later observed time never makes held data look younger; the test pins a 300 h fetch with a 10 h observed time as stale.
  - `worstCaseAgeHours(a): number` — the unknown-vendor-age case is the fetch age (spec §3, decision 53; no local conversion in the api); `compareAges` ranks an unknown age after every known one and two unknowns equal.
  - `isStale(provenance, now, thresholdHours)` — the one staleness rule, effective age against the threshold, so an unknown vendor age is never stale on that account (decision 55); the api's rows and history points call it, and WP11's alerts will. `formatAgeFull` of an unknown vendor age reads "fetched 2h ago · vendor's cache age unknown" (spec §3 rev 23); the compact form stays "2h ago · age unknown".
  - `vendorLinkSchema` (https, no userinfo or port, a host equal to or under a `LINK_ALLOWLIST` entry); `bookingSchema` and the result row's `searchLink` use it, so a hostile stored link can never pass the response contract (decision 54, spec §5.2). `storedBookingSchema` keeps any URL for the db's read, so one bad stored link never fails a page: the api drops it instead (Task 8.11).
  - `resultRowSchema.superseded`: a calendar-basis row whose cell a newer parent execution found empty or no_data (decision 54), the same boolean WP10's Task 10.1 puts on the views' calendar figures; WP10 notes that the rows of `/results` had no field yet.
  - `definitionCreateOptionalSchema` and `alertRulesQuerySchema` as named objects on their routes, so a handler can bind the very schema its ROUTES entry declares (decision 54: one validation).
  - `verifyCellRequestSchema.confirmCostPence?` and `confirmCalls?` (WP7's `VerifyCellOptions`).
  - `budgetScopeLabel(scope)`: the wire label every scope list and the schedule refusal share (review arch-011).
  - `CONSTRAINT_NAMES` in the core barrel (calendar rows' "not applied" list, review arch-010).
  - Draft-tolerant `definitionShapeSchema` and `definitionResponseSchema` (decision 53).
  - db: `retriedOnResume(outcome, manual)`, the resume query's rule as a predicate from the same two lists (View D's "retry", review arch-005); `OfferHistoryPoint` with the observation's `suppliedFields` (decision 53) and its `executionId` (WP10's history points, decision 52), asserted exactly in `itineraries.test.ts`; the db reads bookings with `storedBookingSchema`.

  - `calendarDaySchema` loses `byDestination` (decision 58): no client reads it, `?destination=` scopes the whole day instead, and its figures could not carry the decision 54 marks. WP10's own test fixtures still pass (zod drops the unknown key).
  - db: `CalendarPricesRepo.heldBy(executionId)`, the rows a run fetched and the copies it reused (decision 58), so a run's own view of its prices agrees with its coverage, which counts a reused cell as priced.
  - engine (decision 58; no behaviour change): `confirmationNeeded` takes a narrow `ConfirmationContext` (the soft-confirm threshold, the guard's `usage`, each provider's `capKind`) that `EngineContext` satisfies, and is exported with `Confirmation`, `lineKey` and `LineKey`; `capKindOf(window)` is the one window-to-scope mapping, used by `buildContext` and exported. The api calls them and keeps no copy (Task 8.9).

Tasks 8.0a and 8.0b already added `expandTop`, `truncated`, the calendar query, the views' marks and the history fields; this task adds none of them. After WP8 merges, WP7's confirmation check and `budgetFit` take core's `budgetScopeLabel` and db's reuse-copy rule calls `retriedOnResume` (decision 57's follow-ups).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/api-contract/wp08.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import {
  alertRulesQuerySchema,
  bookingSchema,
  definitionCreateOptionalSchema,
  definitionCreateRequestSchema,
  definitionShapeSchema,
  resultRowSchema,
  storedBookingSchema,
  vendorLinkSchema,
  verifyCellRequestSchema,
} from '../../src/api-contract/index.js';
import { budgetScopeLabel } from '../../src/ports/budget.js';

// WP8's contract additions (plan decision 53: drafts; spec §10 `POST /definitions` with no body).
describe('WP8 contract additions', () => {
  it('a stored definition may be a draft without airports; a create body may not', () => {
    const origins = definitionShapeSchema.shape.origins;
    expect(origins.safeParse([]).success).toBe(true);
    expect(definitionShapeSchema.shape.destinations.safeParse([]).success).toBe(true);
    const create = definitionCreateRequestSchema.safeParse({ origins: [] });
    expect(create.error?.issues.some((i) => i.path[0] === 'origins' && i.code === 'too_small')).toBe(true);
  });
});

// WP8 round-2 additions (plan decisions 53, 54).
describe('WP8 contract additions, round 2', () => {
  it.each([
    ['https://www.aviasales.com/search/LHR0211JFK1', true],
    ['https://google.com/travel/flights', true],
    ['http://www.aviasales.com/x', false],
    ['javascript:alert(1)', false],
    ['https://evil.example/aviasales.com', false],
    ['https://user@aviasales.com/', false],
    ['https://aviasales.com.evil.example/', false],
    ['https://aviasales.com:8443/', false],
  ])('vendorLinkSchema: %s → %s', (url, ok) => {
    expect(vendorLinkSchema.safeParse(url).success).toBe(ok);
    expect(bookingSchema.safeParse({ kind: 'get', url, host: 'h' }).success).toBe(ok);
    expect(bookingSchema.safeParse({ kind: 'post', url, postData: '', host: 'h' }).success).toBe(ok);
  });

  it('storedBookingSchema reads any stored URL, so the api can drop it rather than fail the page', () => {
    expect(
      storedBookingSchema.safeParse({ kind: 'get', url: 'javascript:alert(1)', host: 'x' }).success,
    ).toBe(true);
    expect(
      storedBookingSchema.safeParse({ kind: 'post', url: 'https://a.b/', postData: '', host: 'x' }).success,
    ).toBe(true);
    expect(storedBookingSchema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(storedBookingSchema.safeParse({ kind: 'get', url: 'not a url', host: 'x' }).success).toBe(false);
  });

  it('budgetScopeLabel names provider scopes with their provider and the global scopes alone', () => {
    expect(budgetScopeLabel({ kind: 'provider-month', providerId: 'searchapi' })).toBe(
      'provider-month:searchapi',
    );
    expect(budgetScopeLabel({ kind: 'global-month' })).toBe('global-month');
  });

  it('a result row carries the superseded mark beside the not-seen mark (decision 54)', () => {
    const mark = resultRowSchema.shape.notSeenInLatest;
    expect(mark.safeParse(null).success).toBe(true);
    expect(mark.safeParse({ ageHours: 'unknown' }).success).toBe(true);
    expect(resultRowSchema.shape.superseded.safeParse(true).success).toBe(true);
    expect(resultRowSchema.shape.superseded.safeParse(null).success).toBe(false);
  });

  it('alert rules take an optional definitionId; a create body is optional', () => {
    expect(alertRulesQuerySchema.parse({ definitionId: 'd1' })).toEqual({ definitionId: 'd1' });
    expect(definitionCreateOptionalSchema.safeParse(undefined).success).toBe(true);
    expect(definitionCreateOptionalSchema.safeParse({ origins: [] }).success).toBe(false);
  });

  it('a verify request may carry a confirmation', () => {
    const base = {
      definitionId: 'd1',
      cell: { origin: 'LHR', destination: 'JFK', departureDate: '2026-11-02', returnDate: '2026-11-12' },
    };
    expect(verifyCellRequestSchema.parse({ ...base, confirmCostPence: 7, confirmCalls: 6 })).toMatchObject({
      confirmCostPence: 7,
      confirmCalls: 6,
    });
    expect(verifyCellRequestSchema.safeParse({ ...base, confirmCalls: -1 }).success).toBe(false);
  });
});
```

`packages/db/test/cells.retriedOnResume.test.ts` (new file):

```ts
// retriedOnResume is RESUMABLE_SQL as a predicate (plan decision 54): over every status × reason × attempts × manual
// combination, the predicate and the resume query pick the same cells.
import { cellKeyString, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CellsRepo, retriedOnResume } from '../src/repositories/cells.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, newExecution, withNights } from './helpers/factories.js';
import { rawOutcome } from './helpers/outcomes.js';

const CASES: Array<{ status: string; reason: string | null; attempts: number }> = [
  { status: 'not_run', reason: null, attempts: 0 },
  { status: 'priced', reason: null, attempts: 1 },
  { status: 'empty', reason: null, attempts: 1 },
  { status: 'skipped', reason: 'budget', attempts: 0 },
  { status: 'skipped', reason: 'provider_disabled', attempts: 0 },
  { status: 'skipped', reason: 'not_selected', attempts: 0 },
  { status: 'error', reason: 'upstream', attempts: 1 },
  { status: 'error', reason: 'upstream', attempts: 3 },
  { status: 'error', reason: 'auth', attempts: 1 },
  { status: 'error', reason: 'quota', attempts: 5 },
  { status: 'error', reason: 'parse', attempts: 1 },
  { status: 'error', reason: 'no-return-legs', attempts: 1 },
  { status: 'error', reason: 'no-priced-options', attempts: 1 },
  { status: 'error', reason: 'fx-unavailable', attempts: 1 },
];

describe('retriedOnResume (spec §7 Resume; plan decision 54)', () => {
  it.each([false, true])('agrees with the resume query (manual %s)', (manual) => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const { execution } = newExecution(db, clock);
    const repo = new CellsRepo(db, clock, { allowSynthetic: false });
    const cells = CASES.map((_, i) =>
      cell(undefined, undefined, `2027-05-${String(i + 1).padStart(2, '0')}`, '2027-06-20'),
    );
    repo.seed(execution.id, cells.map(withNights), ['searchapi']);
    CASES.forEach((c, i) => {
      const at = cells[i];
      if (at !== undefined) rawOutcome(db, execution.id, at, 'discovery', 'searchapi', c);
    });
    const byQuery = new Set(
      repo.resumable(execution.id, 'discovery', 'searchapi', manual).map(cellKeyString),
    );
    const byPredicate = repo
      .outcomes(execution.id)
      .filter((o) => retriedOnResume(o, manual))
      .map(cellKeyString);
    expect(new Set(byPredicate)).toEqual(byQuery);
    expect(byQuery.size).toBe(manual ? 7 : 3); // why: not_run, budget, a young upstream error; manual adds disabled, auth, quota, parse
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract/wp08.test.ts && pnpm --filter @gmt/db exec vitest run test/cells.retriedOnResume.test.ts`
Expected: FAIL: the core suite's `vendorLinkSchema`, `storedBookingSchema`, `budgetScopeLabel` and the named query schemas are not exported (`Cannot read properties of undefined`, `… is not a function`); the db suite cannot call `retriedOnResume`.

- [ ] **Step 3: Implement**

Core sources:

Apply this patch from the repository root (`git apply`):

```diff
diff --git a/packages/core/src/api-contract/alerts.ts b/packages/core/src/api-contract/alerts.ts
index 49484ad..09adf66 100644
--- a/packages/core/src/api-contract/alerts.ts
+++ b/packages/core/src/api-contract/alerts.ts
@@ -62,3 +62,5 @@ export const alertEventsQuerySchema = z.object({
   definitionId: z.string().optional(),
   limit: z.coerce.number().int().min(1).max(1000).optional(),
 });
+/** `GET /alerts?definitionId=`: one object, so handlers can name it. */
+export const alertRulesQuerySchema = alertEventsQuerySchema.pick({ definitionId: true });
diff --git a/packages/core/src/api-contract/common.ts b/packages/core/src/api-contract/common.ts
index 1ae92fc..607e680 100644
--- a/packages/core/src/api-contract/common.ts
+++ b/packages/core/src/api-contract/common.ts
@@ -1,4 +1,5 @@
 import { z } from 'zod';
+import { LINK_ALLOWLIST, validateVendorUrl } from '../normalise/vendorUrl.js';
 import type { Buckets } from '../types/execution.js';
 import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
 import { cabinSchema, provenanceSchema, providerIdSchema } from '../types/provenance.js';
@@ -52,11 +53,32 @@ export const cronSchema = z
   .min(9)
   .max(100)
   .regex(/^[\d*/,\-\s]+$/, 'cron: digits, * / , - and spaces only; validated by the scheduler');
-export const bookingSchema = z.discriminatedUnion('kind', [
+/** Every host a vendor or search link may name (spec §5.2), across providers. */
+const LINK_HOSTS: readonly string[] = Object.values(LINK_ALLOWLIST).flat();
+/**
+ * Spec §5.2 vendor links, re-validated on the wire (plan decision 54): https, no userinfo, no port, a host equal to or
+ * under a `LINK_ALLOWLIST` entry. A stored value that fails never reaches a client as a link.
+ */
+export const vendorLinkSchema = z
+  .url()
+  .refine(
+    (u) => validateVendorUrl(u, LINK_HOSTS).kind !== 'none',
+    'link must be https on an allowlisted host',
+  );
+/**
+ * The booking as an adapter stored it (spec §6.3): any URL. The db reads with this, so one bad stored link never fails a
+ * whole page; the api re-validates it and the wire schema below refuses it (plan decision 54).
+ */
+export const storedBookingSchema = z.discriminatedUnion('kind', [
   z.object({ kind: z.literal('get'), url: z.url(), host: z.string() }),
   z.object({ kind: z.literal('post'), url: z.url(), postData: z.string(), host: z.string() }),
   z.object({ kind: z.literal('none') }),
 ]);
+export const bookingSchema = z.discriminatedUnion('kind', [
+  z.object({ kind: z.literal('get'), url: vendorLinkSchema, host: z.string() }),
+  z.object({ kind: z.literal('post'), url: vendorLinkSchema, postData: z.string(), host: z.string() }),
+  z.object({ kind: z.literal('none') }),
+]);
 export const executionStatusSchema = z.enum([
   'pending',
   'running',
diff --git a/packages/core/src/api-contract/definitions.ts b/packages/core/src/api-contract/definitions.ts
index 47f3043..e4f438a 100644
--- a/packages/core/src/api-contract/definitions.ts
+++ b/packages/core/src/api-contract/definitions.ts
@@ -127,11 +127,23 @@ const refineDefinition = (
     });
   }
 };
+/**
+ * A stored definition may be a draft without airports (spec §10: `POST /definitions` with no body creates the plan
+ * default, which names none, spec §1), so the stored and response shapes accept empty airport lists; a create or
+ * update body still needs at least one of each.
+ */
+const storedFields = {
+  ...definitionFields,
+  origins: z.array(iataSchema),
+  destinations: z.array(iataSchema),
+};
 /** The unrefined field shape: used to read stored rows back, where the save-time policy refinements must not run. */
 export const definitionShapeSchema = z
-  .object(definitionFields)
+  .object(storedFields)
   .omit({ confirmedCostPence: true, confirmedCalls: true });
 export const definitionCreateRequestSchema = z.object(definitionFields).superRefine(refineDefinition);
+/** `POST /definitions` takes no body (the plan default, a draft) or a create body; one object, so handlers can name it. */
+export const definitionCreateOptionalSchema = definitionCreateRequestSchema.optional();
 export const definitionUpdateRequestSchema = z.object(definitionFields).partial();
 
 export const budgetFitSchema = z.object({
@@ -172,7 +184,7 @@ export const estimateSchema: z.ZodType<Estimate> = z.object({
 /** Both estimate routes return the estimate with its budget fit, so the form shows both before the create click. */
 export const estimateResponseSchema = z.object({ estimate: estimateSchema, budgetFit: budgetFitSchema });
 export const definitionResponseSchema = z.object({
-  ...definitionFields,
+  ...storedFields,
   confirmedCostPence: moneyPenceSchema.nullable(),
   confirmedCalls: positiveInt.nullable(),
   id: z.string(),
diff --git a/packages/core/src/api-contract/executions.ts b/packages/core/src/api-contract/executions.ts
index 2aa5feb..7f98ac0 100644
--- a/packages/core/src/api-contract/executions.ts
+++ b/packages/core/src/api-contract/executions.ts
@@ -56,4 +56,10 @@ export const startExecutionRequestSchema = z.object({
   confirmCalls: z.number().int().min(0).optional(),
 });
 export const startExecutionResponseSchema = z.object({ executionId: z.string() });
-export const verifyCellRequestSchema = z.object({ definitionId: z.string(), cell: cellKeySchema });
+/** WP7: a single-cell verification above SOFT_CONFIRM needs the confirmation a start would, pence and calls together. */
+export const verifyCellRequestSchema = z.object({
+  definitionId: z.string(),
+  cell: cellKeySchema,
+  confirmCostPence: moneyPenceSchema.optional(),
+  confirmCalls: z.number().int().min(0).optional(),
+});
diff --git a/packages/core/src/api-contract/index.ts b/packages/core/src/api-contract/index.ts
index 9762540..7d52d58 100644
--- a/packages/core/src/api-contract/index.ts
+++ b/packages/core/src/api-contract/index.ts
@@ -5,11 +5,13 @@ import {
   alertEventsQuerySchema,
   alertRuleInputSchema,
   alertRuleSchema,
+  alertRulesQuerySchema,
   alertRuleUpdateRequestSchema,
 } from './alerts.js';
 import {
   coverageCheckRequestSchema,
   coverageCheckResponseSchema,
+  definitionCreateOptionalSchema,
   definitionCreateRequestSchema,
   definitionResponseSchema,
   definitionUpdateRequestSchema,
@@ -80,9 +82,7 @@ export const ROUTES: readonly RouteDef[] = [
   route('GET', '/airports', airportsResponseSchema, { query: airportsQuerySchema }),
   route('GET', '/providers', providersResponseSchema),
   route('GET', '/definitions', definitionResponseSchema.array()),
-  route('POST', '/definitions', definitionResponseSchema, {
-    request: definitionCreateRequestSchema.optional(),
-  }),
+  route('POST', '/definitions', definitionResponseSchema, { request: definitionCreateOptionalSchema }),
   route('POST', '/definitions/estimate', estimateResponseSchema, { request: definitionCreateRequestSchema }),
   route('POST', '/definitions/coverage-check', coverageCheckResponseSchema, {
     request: coverageCheckRequestSchema,
@@ -114,9 +114,7 @@ export const ROUTES: readonly RouteDef[] = [
   route('GET', '/routes/:origin/:destination/history', routeHistoryResponseSchema, {
     query: routeHistoryQuerySchema,
   }),
-  route('GET', '/alerts', alertRuleSchema.array(), {
-    query: alertEventsQuerySchema.pick({ definitionId: true }),
-  }),
+  route('GET', '/alerts', alertRuleSchema.array(), { query: alertRulesQuerySchema }),
   route('POST', '/alerts', alertRuleSchema, { request: alertRuleInputSchema }),
   route('PUT', '/alerts/:id', alertRuleSchema, { request: alertRuleUpdateRequestSchema }),
   route('DELETE', '/alerts/:id', alertRuleSchema),
diff --git a/packages/core/src/api-contract/results.ts b/packages/core/src/api-contract/results.ts
index ec9b529..5b064e4 100644
--- a/packages/core/src/api-contract/results.ts
+++ b/packages/core/src/api-contract/results.ts
@@ -18,12 +18,14 @@ import {
   resultBasisSchema,
   segmentSchema,
   stageSchema,
+  vendorLinkSchema,
   verdictClassSchema,
   verdictsSchema,
 } from './common.js';
 
 const count = z.number().int().min(0);
-const searchLinkSchema = z.object({ url: z.url(), host: z.string(), label: z.string() }).nullable();
+/** A vendor search link (spec §5.2): re-validated on the wire like a booking link (plan decision 54). */
+const searchLinkSchema = z.object({ url: vendorLinkSchema, host: z.string(), label: z.string() }).nullable();
 /** Spec §6.5 / §6.9: one row per itinerary (or calendar cell), provenance on every price. */
 export const resultRowSchema = z.object({
   itineraryHash: z.string().nullable(),
@@ -80,6 +82,11 @@ export const resultRowSchema = z.object({
     }),
   ),
   notSeenInLatest: z.object({ ageHours: ageHoursSchema }).nullable(),
+  /**
+   * Plan decision 54, as on the views' calendar figures: a calendar-basis row whose cell a newer parent execution found
+   * empty or no_data, ranked after every current price. Always false on the verified basis.
+   */
+  superseded: z.boolean(),
   adjustedPence: moneyPenceSchema.nullable(),
   destinationNote: z.string().nullable(),
   executionId: z.string(),
@@ -129,13 +136,7 @@ export const calendarDaySchema = z.object({
   cheapestVerified: verifiedFigure.nullable(),
   cheapestPartiallyVerified: verifiedFigure.extend({ count }).nullable(),
   cheapestCalendar: calendarFigure.nullable(),
-  byDestination: z.array(
-    z.object({
-      destination: iataSchema,
-      cheapestVerified: priceCellSchema.nullable(),
-      cheapestCalendar: priceCellSchema.nullable(),
-    }),
-  ),
+  // why: plan decision 58: no per-destination figures; `?destination=` (decision 53) scopes the whole day instead.
 });
 /**
  * Plan decision 53: the calendar route's optional destination. With it, every day's buckets, selection counts, minimums
diff --git a/packages/core/src/index.ts b/packages/core/src/index.ts
index bb0ba74..407acf1 100644
--- a/packages/core/src/index.ts
+++ b/packages/core/src/index.ts
@@ -22,7 +22,7 @@ export * from './config/schema.js';
 export * from './config/secret.js';
 export * from './config/synthetic.js';
 export { evaluateConstraints } from './constraints/evaluate.js';
-export { CONSTRAINT_LABELS } from './constraints/labels.js';
+export { CONSTRAINT_LABELS, CONSTRAINT_NAMES } from './constraints/labels.js';
 export { unverifiedNames, verdictClass } from './constraints/verdictClass.js';
 export * from './coverage/buckets.js';
 export * from './coverage/rollUp.js';
diff --git a/packages/core/src/labels/age.ts b/packages/core/src/labels/age.ts
index 8476637..2ccb971 100644
--- a/packages/core/src/labels/age.ts
+++ b/packages/core/src/labels/age.ts
@@ -19,24 +19,45 @@ export function effectiveAge(
 ): EffectiveAge {
   const fetchedHours = hoursBetween(p.fetchedAt, now);
   if (p.providerObservedAt !== undefined) {
-    return { kind: 'observed', fetchedHours, observedHours: hoursBetween(p.providerObservedAt, now) };
+    // why: plan decision 58: a vendor cannot have observed a price after we fetched it, so an observed time later than
+    // the fetch (a vendor clock or data error) never makes the price look younger than the fetch.
+    const observedHours = Math.max(hoursBetween(p.providerObservedAt, now), fetchedHours);
+    return { kind: 'observed', fetchedHours, observedHours };
   }
   if (p.maxAgeHours === 'unknown') return { kind: 'unknown', fetchedHours };
   return { kind: 'bounded', fetchedHours, maxAgeHours: p.maxAgeHours };
 }
 
-/** The age a careful reader should assume: observed age, or fetched age plus the provider's bound. */
-export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown' {
+/**
+ * The effective age of spec §3 (revision 23, plan decisions 44, 53, 58): the observed age (never younger than the fetch
+ * age, `effectiveAge` clamps it) when the vendor dates the price,
+ * else the fetch age plus the provider's bound, else (the vendor's age unknown) the fetch age alone. The labels say
+ * "vendor's cache age unknown" for the last case; this number never pretends to know more.
+ */
+export function worstCaseAgeHours(a: EffectiveAge): number {
   switch (a.kind) {
     case 'observed':
       return a.observedHours;
     case 'bounded':
       return a.fetchedHours + a.maxAgeHours;
     case 'unknown':
-      return 'unknown';
+      return a.fetchedHours;
   }
 }
 
+/**
+ * The one staleness rule (spec §3, plan decisions 44, 54, 55): stale when the effective age exceeds the threshold. An
+ * unknown vendor age counts the fetch age alone, so it is never stale on that account; every package that marks a price
+ * stale (the api's rows and history points, WP11's alerts) calls this.
+ */
+export function isStale(
+  p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>,
+  now: IsoDateTime,
+  thresholdHours: number,
+): boolean {
+  return worstCaseAgeHours(effectiveAge(p, now)) > thresholdHours;
+}
+
 /** "just now" under an hour; hours to 47h; days to 13d; weeks after. */
 export function formatDuration(hours: number): string {
   if (hours < 1) return 'just now';
@@ -56,7 +77,10 @@ export function formatFetchedAgo(a: EffectiveAge): string {
   return `fetched ${formatAgo(a.fetchedHours)}`;
 }
 
-/** Tooltip, header and email form, e.g. "fetched 2h ago · provider age unknown (≤7d before that)". */
+/**
+ * Tooltip, header and email form, e.g. "fetched 2h ago · provider age unknown (≤7d before that)", or, when the vendor
+ * gives no age at all, "fetched 2h ago · vendor's cache age unknown" (spec §3 rev 23, decision 55).
+ */
 export function formatAgeFull(a: EffectiveAge): string {
   const fetched = formatFetchedAgo(a);
   switch (a.kind) {
@@ -68,7 +92,7 @@ export function formatAgeFull(a: EffectiveAge): string {
         ? fetched
         : `${fetched} · provider age unknown (≤${formatDuration(a.maxAgeHours)} before that)`;
     case 'unknown':
-      return `${fetched} · provider age unknown`;
+      return `${fetched} · vendor's cache age unknown`;
   }
 }
 
@@ -87,10 +111,10 @@ export function formatAgeCompact(a: EffectiveAge): string {
 
 /** Sort comparator: fresher first; an unknown age loses to any known age; two unknowns tie. Spec §8.1. */
 export function compareAges(a: EffectiveAge, b: EffectiveAge): number {
-  const wa = worstCaseAgeHours(a);
-  const wb = worstCaseAgeHours(b);
-  if (wa === 'unknown' && wb === 'unknown') return 0;
-  if (wa === 'unknown') return 1;
-  if (wb === 'unknown') return -1;
-  return wa - wb;
+  // why: the ordering rule is about what is known, not about the number: an unknown vendor age loses to any known one
+  // even when its fetch age is smaller (spec §8.1).
+  if (a.kind === 'unknown' && b.kind === 'unknown') return 0;
+  if (a.kind === 'unknown') return 1;
+  if (b.kind === 'unknown') return -1;
+  return worstCaseAgeHours(a) - worstCaseAgeHours(b);
 }
diff --git a/packages/core/src/ports/budget.ts b/packages/core/src/ports/budget.ts
index fb4d25f..81587eb 100644
--- a/packages/core/src/ports/budget.ts
+++ b/packages/core/src/ports/budget.ts
@@ -7,6 +7,14 @@ export type BudgetScope =
   | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
   | { kind: 'global-month' };
 
+/**
+ * The wire label of a scope (`execution-calls`, `provider-month:searchapi`, `global-month`): the one formatter the
+ * budget-fit scopes, the usage rows and the schedule refusal share (plan decision 54; WP7's budgetFit formats the same).
+ */
+export function budgetScopeLabel(s: BudgetScope): string {
+  return 'providerId' in s ? `${s.kind}:${s.providerId}` : s.kind;
+}
+
 /** `cap` is null for a window the plan does not use and for a scope with no cap configured. */
 export interface Usage {
   calls: number;
```

Core tests the change touches (the effective-age cases, `isStale` and the unknown-age label; the result-row fixtures gain `superseded`; `CONSTRAINT_NAMES` leaves the barrel's private list):

Apply this patch from the repository root (`git apply`):

```diff
diff --git a/packages/core/test/api-contract/contract.test.ts b/packages/core/test/api-contract/contract.test.ts
index e5ee5da..e4918b1 100644
--- a/packages/core/test/api-contract/contract.test.ts
+++ b/packages/core/test/api-contract/contract.test.ts
@@ -111,6 +111,7 @@ describe('api-contract (spec §10)', () => {
       },
       otherOffers: [],
       notSeenInLatest: null,
+      superseded: false,
       adjustedPence: null,
       destinationNote: null,
       executionId: 'e1',
diff --git a/packages/core/test/helpers/rows.ts b/packages/core/test/helpers/rows.ts
index f9a2970..ccf5452 100644
--- a/packages/core/test/helpers/rows.ts
+++ b/packages/core/test/helpers/rows.ts
@@ -68,6 +68,7 @@ export function row(over: Over = {}): ResultRow {
     },
     otherOffers: [],
     notSeenInLatest: null,
+    superseded: false,
     adjustedPence: null,
     destinationNote: null,
     executionId: 'ex-2',
diff --git a/packages/core/test/labels/age.test.ts b/packages/core/test/labels/age.test.ts
index fb38218..e9aa0bd 100644
--- a/packages/core/test/labels/age.test.ts
+++ b/packages/core/test/labels/age.test.ts
@@ -5,6 +5,7 @@ import {
   formatAgeCompact,
   formatAgeFull,
   formatDuration,
+  isStale,
   worstCaseAgeHours,
 } from '../../src/labels/age.js';
 import { asIsoDateTime } from '../../src/types/ids.js';
@@ -77,7 +78,7 @@ describe('formatting', () => {
     expect(formatAgeFull(o)).toBe('fetched 2h ago · observed 3h ago');
     expect(formatAgeCompact(o)).toBe('2h ago · obs 3h');
     const u = { kind: 'unknown', fetchedHours: 2 } as const;
-    expect(formatAgeFull(u)).toBe('fetched 2h ago · provider age unknown');
+    expect(formatAgeFull(u)).toBe("fetched 2h ago · vendor's cache age unknown");
     expect(formatAgeCompact(u)).toBe('2h ago · age unknown');
     expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 0, maxAgeHours: 24 })).toBe('just now · ≤24h');
     expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 1, maxAgeHours: 24 })).toBe('1h ago · ≤24h');
@@ -98,7 +99,7 @@ describe('ordering (spec §8.1: unknown loses to any known age)', () => {
   it('worstCaseAgeHours', () => {
     expect(worstCaseAgeHours({ kind: 'observed', fetchedHours: 2, observedHours: 3 })).toBe(3);
     expect(worstCaseAgeHours({ kind: 'bounded', fetchedHours: 2, maxAgeHours: 48 })).toBe(50);
-    expect(worstCaseAgeHours({ kind: 'unknown', fetchedHours: 2 })).toBe('unknown');
+    expect(worstCaseAgeHours({ kind: 'unknown', fetchedHours: 2 })).toBe(2); // spec rev 23: the fetch age alone
   });
   it('compareAges', () => {
     const known = { kind: 'bounded', fetchedHours: 100, maxAgeHours: 48 } as const;
@@ -106,7 +107,48 @@ describe('ordering (spec §8.1: unknown loses to any known age)', () => {
     expect(compareAges(known, unknown)).toBeLessThan(0);
     expect(compareAges(unknown, known)).toBeGreaterThan(0);
     expect(compareAges(unknown, unknown)).toBe(0);
+    // why: an unknown vendor age loses even with a smaller fetch age than the known one
+    expect(
+      compareAges(
+        { kind: 'unknown', fetchedHours: 0 },
+        { kind: 'bounded', fetchedHours: 5, maxAgeHours: 48 },
+      ),
+    ).toBeGreaterThan(0);
     expect(compareAges({ kind: 'observed', fetchedHours: 1, observedHours: 1 }, known)).toBeLessThan(0);
     expect(compareAges(known, known)).toBe(0);
   });
 });
+
+describe('isStale (spec §3, plan decisions 44, 54, 55: the one staleness rule)', () => {
+  const at = (hoursAgo: number) =>
+    asIsoDateTime(new Date(Date.parse(now) - hoursAgo * 3_600_000).toISOString());
+  it('a known bound adds to the fetch age; stale only strictly past the threshold', () => {
+    expect(isStale({ fetchedAt: at(150), maxAgeHours: 42 }, now, 192)).toBe(false); // 192, not past
+    expect(isStale({ fetchedAt: at(151), maxAgeHours: 42 }, now, 192)).toBe(true);
+  });
+  it('an observed age wins over the bound, and is never younger than the fetch age (decision 58)', () => {
+    expect(isStale({ fetchedAt: at(1), providerObservedAt: at(200), maxAgeHours: 0 }, now, 192)).toBe(true);
+    expect(isStale({ fetchedAt: at(150), providerObservedAt: at(180), maxAgeHours: 168 }, now, 192)).toBe(
+      false,
+    );
+    // an observed time after the fetch is a vendor error: the 300 h fetch age stands
+    expect(isStale({ fetchedAt: at(300), providerObservedAt: at(10), maxAgeHours: 168 }, now, 192)).toBe(
+      true,
+    );
+    expect(
+      effectiveAge({ fetchedAt: at(300), providerObservedAt: at(10), maxAgeHours: 0 }, now),
+    ).toMatchObject({
+      observedHours: 300,
+    });
+    expect(
+      effectiveAge({ fetchedAt: at(50), providerObservedAt: at(50), maxAgeHours: 0 }, now),
+    ).toMatchObject({
+      fetchedHours: 50,
+      observedHours: 50,
+    });
+  });
+  it('an unknown vendor age counts the fetch age alone: never stale on that account', () => {
+    expect(isStale({ fetchedAt: at(191), maxAgeHours: 'unknown' }, now, 192)).toBe(false);
+    expect(isStale({ fetchedAt: at(193), maxAgeHours: 'unknown' }, now, 192)).toBe(true);
+  });
+});
diff --git a/packages/core/test/wp2-barrel.test.ts b/packages/core/test/wp2-barrel.test.ts
index 190ea34..568e72d 100644
--- a/packages/core/test/wp2-barrel.test.ts
+++ b/packages/core/test/wp2-barrel.test.ts
@@ -49,7 +49,6 @@ const PRIVATE = [
   'need',
   'compareRows',
   'compareText',
-  'CONSTRAINT_NAMES',
   // module exports that no other package reads, so they stay out of the barrel
   'MIN_REPEAT_DROP_PENCE',
   'MIN_REPEAT_DROP_PERCENT',
```

Db sources and the tests they touch:

Apply this patch from the repository root (`git apply`):

```diff
diff --git a/packages/db/src/index.ts b/packages/db/src/index.ts
index 4607f8a..114b791 100644
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -21,7 +21,7 @@ export { createRepos, type Repos } from './repos.js';
 export { AirportsRepo } from './repositories/airports.js';
 export { AlertsRepo } from './repositories/alerts.js';
 export { CalendarPricesRepo } from './repositories/calendarPrices.js';
-export { CellsRepo } from './repositories/cells.js';
+export { CellsRepo, retriedOnResume } from './repositories/cells.js';
 export { DefinitionsRepo } from './repositories/definitions.js';
 export { ExecutionsRepo } from './repositories/executions.js';
 export { FxRepo } from './repositories/fx.js';
@@ -44,6 +44,7 @@ export type {
   ExecutionCreateInput,
   ExecutionPatch,
   ObservationRow,
+  OfferHistoryPoint,
   RepoOptions,
   ReuseCriteria,
   ReusedCopy,
diff --git a/packages/db/src/internal/read.ts b/packages/db/src/internal/read.ts
index ab440be..3f6c3c1 100644
--- a/packages/db/src/internal/read.ts
+++ b/packages/db/src/internal/read.ts
@@ -112,7 +112,7 @@ export const readBaggage = (column: string, v: unknown): BaggageSnapshot =>
 export const readFareConditions = (column: string, v: unknown): FareConditions =>
   parseWith(column, apiContract.resultRowSchema.shape.fareConditions.unwrap(), v);
 export const readBooking = (column: string, text: string): Booking =>
-  parseWith(column, apiContract.bookingSchema, readJson(column, text));
+  parseWith(column, apiContract.storedBookingSchema, readJson(column, text));
 export const readEstimate = (column: string, text: string): Estimate =>
   parseWith(column, apiContract.estimateSchema, readJson(column, text));
 
diff --git a/packages/db/src/repositories/calendarPrices.ts b/packages/db/src/repositories/calendarPrices.ts
index e827d54..8a11cfd 100644
--- a/packages/db/src/repositories/calendarPrices.ts
+++ b/packages/db/src/repositories/calendarPrices.ts
@@ -189,6 +189,20 @@ export class CalendarPricesRepo {
     };
   }
 
+  /**
+   * Every price row this execution holds: the ones it fetched and the reused copies it made (each keeping its source's
+   * fetch time and `reusedFromExecutionId`). A run's own view (plan decision 58): its coverage counts a reused cell as
+   * priced, so its prices must include that cell's price.
+   */
+  heldBy(executionId: string): CalendarPriceRow[] {
+    return this.db.raw
+      .prepare<[string], CalendarPriceDbRow>(
+        'SELECT * FROM calendar_prices WHERE execution_id = ? ORDER BY id',
+      )
+      .all(executionId)
+      .map(toCalendarPriceRow);
+  }
+
   /** Prices this execution fetched itself (reused copies excluded): the calendar-basis alert candidates (spec §6.8). */
   fetchedBy(executionId: string): CalendarPriceRow[] {
     return this.db.raw
diff --git a/packages/db/src/repositories/cells.ts b/packages/db/src/repositories/cells.ts
index 427aae7..aa41597 100644
--- a/packages/db/src/repositories/cells.ts
+++ b/packages/db/src/repositories/cells.ts
@@ -110,6 +110,30 @@ function assertNonTerminalTarget(status: CellOutcomeStatus, reason: string | nul
     throw new RowRejected('outcome-reason', `a not_run outcome carries no reason, got ${reason}`);
 }
 
+const listed = (xs: readonly string[], reason: string | null): boolean =>
+  reason !== null && xs.includes(reason);
+
+/**
+ * The resume rule of RESUMABLE_SQL as a predicate over one outcome, from the same two lists, so a reader that shows
+ * "retry" (View D, WP8) and the resume that does the retry cannot disagree (plan decision 54; test cells.resume).
+ */
+export function retriedOnResume(
+  o: Pick<CellOutcome, 'status' | 'reason' | 'attempts'>,
+  manual: boolean,
+): boolean {
+  switch (o.status) {
+    case 'not_run':
+      return true;
+    case 'skipped':
+      return o.reason === 'budget' || (manual && o.reason === 'provider_disabled');
+    case 'error':
+      return (
+        (o.attempts < 3 && !listed(NON_RETRYABLE, o.reason)) || (manual && listed(MANUAL_RETRYABLE, o.reason))
+      );
+    default:
+      return false;
+  }
+}
 const sqlList = (xs: readonly string[]) => xs.map((r) => `'${r}'`).join(', ');
 
 /**
diff --git a/packages/db/src/repositories/itineraries.ts b/packages/db/src/repositories/itineraries.ts
index 4d61f2a..3b6d888 100644
--- a/packages/db/src/repositories/itineraries.ts
+++ b/packages/db/src/repositories/itineraries.ts
@@ -4,7 +4,6 @@ import type {
   CellOutcome,
   Clock,
   FxInfo,
-  HistoryPoint,
   IsoDateTime,
   NormalisedItinerary,
   Observation,
@@ -45,7 +44,7 @@ import {
   assertProviderKind,
   RowRejected,
 } from '../internal/validate.js';
-import type { ObservationRow, RepoOptions } from '../types.js';
+import type { ObservationRow, OfferHistoryPoint, RepoOptions } from '../types.js';
 
 interface ObservationDbRow {
   id: number;
@@ -443,13 +442,16 @@ export class ItinerariesRepo {
     return r === undefined ? null : toObservation(r);
   }
 
-  /** Every observation of every offer of one itinerary, one series per offer, oldest first (History view). */
+  /**
+   * Every observation of every offer of one itinerary, one series per offer, oldest first (History view). Each point
+   * carries the observation's supplied fields, so a reader can tell a price the final step confirmed (plan decision 42).
+   */
   offerHistory(
     hash: string,
-  ): Array<{ providerId: ProviderId; seller: string; cabin: Cabin; points: HistoryPoint[] }> {
+  ): Array<{ providerId: ProviderId; seller: string; cabin: Cabin; points: OfferHistoryPoint[] }> {
     const out = new Map<
       number,
-      { providerId: ProviderId; seller: string; cabin: Cabin; points: HistoryPoint[] }
+      { providerId: ProviderId; seller: string; cabin: Cabin; points: OfferHistoryPoint[] }
     >();
     for (const r of this.db.raw
       .prepare<[string], ObservationDbRow>(
@@ -463,7 +465,13 @@ export class ItinerariesRepo {
         cabin: o.provenance.cabin,
         points: [],
       };
-      series.points.push({ at: o.provenance.fetchedAt, pricePence: o.pricePence, provenance: o.provenance });
+      series.points.push({
+        at: o.provenance.fetchedAt,
+        pricePence: o.pricePence,
+        provenance: o.provenance,
+        suppliedFields: o.suppliedFields,
+        executionId: o.executionId,
+      });
       out.set(r.offer_id, series);
     }
     return [...out.values()];
diff --git a/packages/db/src/types.ts b/packages/db/src/types.ts
index 256583b..72bae90 100644
--- a/packages/db/src/types.ts
+++ b/packages/db/src/types.ts
@@ -8,6 +8,7 @@ import type {
   Execution,
   ExecutionStatus,
   FxInfo,
+  HistoryPoint,
   Iata,
   IsoDateTime,
   NormalisedItinerary,
@@ -147,3 +148,11 @@ export interface ObservationRow extends Observation {
   cell: Cell;
   seller: string;
 }
+/**
+ * One `offerHistory` point: the stored history point plus the observation's supplied fields (plan decision 42) and the
+ * execution that wrote it (decision 52: History joins only consecutive runs).
+ */
+export interface OfferHistoryPoint extends HistoryPoint {
+  suppliedFields: SuppliedField[];
+  executionId: string;
+}
diff --git a/packages/db/test/barrel.test.ts b/packages/db/test/barrel.test.ts
index 47b01a2..5db639e 100644
--- a/packages/db/test/barrel.test.ts
+++ b/packages/db/test/barrel.test.ts
@@ -101,6 +101,7 @@ describe('@gmt/db public surface (plan "Database" contract)', () => {
         'openDatabase',
         'pendingMigrations',
         'readOnlyLockState',
+        'retriedOnResume',
         'runMaintenance',
         'sanityCheckAirports',
         'seedAirports',
diff --git a/packages/db/test/itineraries.test.ts b/packages/db/test/itineraries.test.ts
index 273ea2c..cb0bd29 100644
--- a/packages/db/test/itineraries.test.ts
+++ b/packages/db/test/itineraries.test.ts
@@ -701,7 +701,16 @@ describe('ItinerariesRepo reads', () => {
         providerId: 'searchapi',
         seller: 'British Airways',
         cabin: 'economy',
-        points: [{ at: T0, pricePence: 41_200, provenance: SEARCHAPI_PROVENANCE }],
+        points: [
+          {
+            at: T0,
+            pricePence: 41_200,
+            provenance: SEARCHAPI_PROVENANCE,
+            // why: the observation's own supplied fields, which the api reads as priceConfirmed (plan decision 42)
+            suppliedFields: ['segments', 'segmentTimes', 'segmentCabins', 'price', 'seller', 'baggage'],
+            executionId,
+          },
+        ],
       },
     ]);
     expect(repo.latestVerificationOutcomeForCell(definition.id, cell(), 'economy')).toMatchObject({
diff --git a/packages/db/test/reuse.test.ts b/packages/db/test/reuse.test.ts
index 4676e72..baa83b2 100644
--- a/packages/db/test/reuse.test.ts
+++ b/packages/db/test/reuse.test.ts
@@ -220,6 +220,8 @@ describe('reuse (spec §8.1 "reuse, per cell", §7 atomic unit "each reused cell
         .all(c),
     ).toEqual([{ f: T0, r: a }]);
     expect(prices.fetchedBy(c)).toEqual([]); // a reused copy is not "fetched by" c
+    // …but c holds it: its own view of its prices includes the copy, with the source's fetch time (decision 58)
+    expect(prices.heldBy(c).map((r) => [r.fetchedAt, r.reusedFromExecutionId])).toEqual([[T0, a]]);
     new ExecutionsRepo(db, clock).setStatus(c, 'completed');
     clock.advance(60_000);
     const d = newExecution(db, clock, { definition }).execution.id;
```

Engine exports and their smoke test:

Apply this patch from the repository root (`git apply`):

```diff
diff --git a/packages/engine/src/context.ts b/packages/engine/src/context.ts
index 400cd30..925e39c 100644
--- a/packages/engine/src/context.ts
+++ b/packages/engine/src/context.ts
@@ -40,6 +40,14 @@ export interface ProviderRunLimits {
   billed: boolean;
 }
 
+/**
+ * The cap scope a provider's calls count against, from its plan window (spec §5.3): the one mapping the engine and the
+ * api share (plan decision 58).
+ */
+export function capKindOf(window: 'month' | 'lifetime'): 'provider-month' | 'provider-lifetime' {
+  return window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
+}
+
 /** What every engine module receives. Built once per engine by buildContext. */
 export interface EngineContext {
   readonly deps: EngineDeps;
@@ -83,7 +91,7 @@ export function buildContext(deps: EngineDeps, options: EngineOptions = {}): Eng
       ratePerMinute: b.ratePerMinute,
       ratePerHour: b.ratePerHour,
       window: b.window,
-      capKind: b.window === 'lifetime' ? 'provider-lifetime' : 'provider-month',
+      capKind: capKindOf(b.window),
       planFixedMicroGbp: b.planFixedMicroGbp,
       excludedFromSchedule: b.excludedFromSchedule,
       billed: b.billable,
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 0479780..6234672 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -1,12 +1,19 @@
 // Barrel for @gmt/engine (plan contract "Engine"). EmailNotifier and runAlerts are added by WP11.
 export { noAlerts } from './alertsStep.js';
+export { capKindOf } from './context.js';
 export { createEngine } from './engine.js';
 export { confirmationOf } from './estimate.js';
 export { fxHttpLimits } from './fx/limits.js';
+export { type LineKey, lineKey } from './lines.js';
 export { LogNotifier } from './notifiers/log.js';
 export { renderOperatorMessage } from './notifiers/operatorTemplates.js';
 export { parseCron } from './scheduler/parseCron.js';
-export { SOFT_CONFIRM_CALL_SHARE } from './start.js';
+export {
+  type Confirmation,
+  type ConfirmationContext,
+  confirmationNeeded,
+  SOFT_CONFIRM_CALL_SHARE,
+} from './start.js';
 export type {
   AlertsStepHook,
   BudgetFit,
diff --git a/packages/engine/src/start.ts b/packages/engine/src/start.ts
index ce5eb03..3f8cd5c 100644
--- a/packages/engine/src/start.ts
+++ b/packages/engine/src/start.ts
@@ -80,6 +80,16 @@ export async function recordSkipped(
   return exec.id;
 }
 
+/**
+ * What `confirmationNeeded` reads: the soft-confirm threshold, the budget guard's caps and each provider's cap scope.
+ * Narrow so the api can call the same rule over its own ports (plan decision 58).
+ */
+export interface ConfirmationContext {
+  readonly config: Pick<EngineContext['config'], 'spend'>;
+  readonly budget: Pick<EngineContext['budget'], 'usage'>;
+  limitsOf(id: ProviderId): Pick<ReturnType<EngineContext['limitsOf']>, 'capKind'>;
+}
+
 /**
  * Spec §8.1 SOFT_CONFIRM: the runnable (not blocked) part of the estimate needs confirming when its cost is above the
  * pence threshold, or when a provider's runnable calls exceed SOFT_CONFIRM_CALL_SHARE of its call cap — the monthly
@@ -89,8 +99,9 @@ export async function recordSkipped(
  * alone never covers a run of any size. Null when no confirmation is needed, else the refusal details, whose
  * `totalCalls` and `estimatePence` are what a client confirms.
  */
+
 export function confirmationNeeded(
-  ctx: EngineContext,
+  ctx: ConfirmationContext,
   estimate: Estimate,
   blocked: ReadonlySet<LineKey>,
   confirmed: Confirmation,
diff --git a/packages/engine/test/smoke.test.ts b/packages/engine/test/smoke.test.ts
index 8d04300..e0f8c2c 100644
--- a/packages/engine/test/smoke.test.ts
+++ b/packages/engine/test/smoke.test.ts
@@ -17,4 +17,11 @@ describe('@gmt/engine package', () => {
     // why: WP8 imports the engine's value rather than keeping a copy that could drift
     expect(pkg.SOFT_CONFIRM_CALL_SHARE).toBe(0.2);
   });
+  it('exports the confirmation rule and the cap-scope mapping the api calls (decision 58)', () => {
+    // why: WP8 fills needsConfirmation with the engine's own rule instead of a copy that could drift
+    expect(pkg.capKindOf('month')).toBe('provider-month');
+    expect(pkg.capKindOf('lifetime')).toBe('provider-lifetime');
+    expect(pkg.lineKey('verification', 'searchapi')).toBe('verification:searchapi');
+    expectTypeOf(pkg.confirmationNeeded).toBeFunction();
+  });
 });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test && pnpm --filter @gmt/db test && pnpm --filter @gmt/engine test && pnpm -r typecheck`
Expected: PASS: core 767 tests with 100% on every metric (14 of them `wp08.test.ts`), db 276 tests (7 of them `cells.retriedOnResume.test.ts`), engine 282 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: core effective age and isStale, the unknown-age label, link re-validation, the row superseded mark, no byDestination, scope labels; db retriedOnResume, offer-history fields, heldBy; engine exports its confirmation rule"
```

### Task 8.1: The app bootstrap, the server core, and production boot lacks `fixture` (first failing test)

**Files:**
- Create: `apps/api/src/text.ts`, `src/errors.ts`, `src/defaults.ts`, `src/routes/types.ts`, `src/routes/define.ts`, `src/routes/shared.ts`, `src/read/usage.ts`, `src/routes/system.ts`, `src/routes/index.ts`, `src/middleware/auth.ts`, `src/middleware/headers.ts`, `src/middleware/hardening.ts`, `src/static.ts`, `src/app.ts`, `src/bootstrap/errors.ts`, `src/bootstrap/paths.ts`, `src/bootstrap/lock.ts`, `src/bootstrap/seed.ts`, `src/bootstrap/app.ts`, `src/bootstrap/start.ts`
- Modify: `apps/api/package.json`, `apps/api/src/bootstrap/tool.ts`
- Test: `apps/api/test/bootstrap/app.spawn.test.ts`, `apps/api/test/defaults.test.ts`

**Interfaces:**
- Consumes: `loadConfigFromEnv`, `InvalidConfigError`, `collectSecrets`, `buildPorts`, `createLogger`, `safeMessage`, `EXIT`, `dataDirRefusal`, `backupBeforeMigrations` (WP4b); `fixtureProvider` (WP4); `readOnlyLockState`, `AppLock`, `HEARTBEAT_INTERVAL_MS`, `seedAirports`, `loadAirportsDataset`, `sanityCheckAirports`, `RowRejected`, `MIGRATIONS_DIR`, `AIRPORTS_DATA_DIR`, `CalendarPriceInsert` (WP3); `createEngine`, `LogNotifier` (WP7); `budgetScopeLabel`, `microGbpToPence`, `DEFAULT_DISCOVERY_REFRESH_HOURS`, the system schemas (core).
- Produces: `createApp` (non-strict mounting; Task 8.15 makes it strict), `MAX_BODY_BYTES`, `route`, `plain`, `NO_INPUT`, `oneAtATime`, `ApiError`, `envelope`, `fieldsDetail`, `issuesToFields`, `API_TEXT`, `defaultDefinitionInput`, `usageOf`, `providerScopes`, `budgetScopes`, the middleware of spec §4, `bootApp`, `assertAuthInvariants`, `BootError` (the one refusal class, `bootstrap/errors.ts`), `main`, `waitForLockFree`, `seedIfNeeded`, `assetPaths`; routes `GET /api/health` (both shapes), `GET /api/airports`, `GET /api/providers`, `GET /api/budget`, `GET /api/scheduler/jobs`.

The bootstrap cannot boot without its ports, its middleware and at least one route, so this task builds them together; Tasks 8.2–8.8 then pin each behaviour with its own tests and mutations.

**Plan preset** (spec §8.2, §11), used by `GET /api/providers` `presets` and by `POST /api/definitions` with no body (Task 8.9): Travelpayouts discovery when configured; SearchApi in both stages only on the `40usd` plan (the `trial` credits are for the spike and smoke, spec §2 fact 7); the fixture provider in both stages when the gate admits it; `maxCells 10, topN 10, expandTop 2, bookingLinks true`; budget from `EXECUTION_MAX_*`; each discovery provider's refresh core's `DEFAULT_DISCOVERY_REFRESH_HOURS` (168, decision 21); no airports; `enabled: false`; schedule `0 5 * * 1` in `SCHEDULER_TIMEZONE`.

**Boot order** (decisions 53, 58; spec §7; decision 32 reuses WP4b's preflight): refuse `NODE_ENV=test` (70) → `assertAuthInvariants` on the injected config, the same rules `loadConfigFromEnv` enforces, so no caller of `bootApp` can serve without auth on a public bind, with an empty `ALLOWED_HOSTS` or a short password (78; `ALLOW_UNAUTHENTICATED=true` is accepted with a warning) → `dataDirRefusal` (73) → `waitForLockFree`: `app_lock` read read-only with WP3's `readOnlyLockState`, as the record tool does, polling every second while it is fresh — up to 60 s for a tool, 90 s for another app, logging the holder and the lock's age every 10 s — then 75; an unreadable file is 73 (both a `BootError`, the one refusal class every step throws, so `start.ts` reads one `exitCode`) → `backupBeforeMigrations` when migrations are pending on an existing file (73 when the backups path is unusable, 74 when the backup fails) → `buildPorts` (migrations) → `lock.acquire({ waitMs: 0 })` right away, as the tool bootstrap takes it, which also catches a process that took the lock since the read-only check (75) → heartbeat every `HEARTBEAT_INTERVAL_MS` with a plain `setInterval(...).unref()`, its failure logged rather than thrown (a throw inside a timer would kill the process with executions running) → `seedIfNeeded` (shared with the tool bootstrap) and `sanityCheckAirports` over the airports of enabled definitions (1), both under the lock, so an app and a tool starting together never both seed (decision 58) → `createEngine({ ...ports, notifiers: [new LogNotifier(log)] })` (WP11 adds `{ alerts: runAlerts }`) → `engine.boot()` → `createApp` → serve. Anything that throws after `buildPorts` clears the heartbeat, releases the lock (WP3's `release` deletes only the row this `AppLock` acquired, so a refused acquire leaves the holder's lock alone) and closes the database before rethrowing (review arch-008). `close()`: stop accepting → `engine.shutdown()` → clear the heartbeat → `wal_checkpoint(TRUNCATE)` → `lock.release()` → `db.close()`. Every exit code is WP4b's `EXIT` table.

**One in-flight guard** (decisions 54, 58): `oneAtATime(ctx, key, fn, busy?)` over `RouteContext.busy`; a second request under a key that is awaiting is refused with `busy()` (429 `already_running` by default). Keys: the definition id for run, resume and verify; `coverage-check`; `tool` for the record tool with its contract's 409 `tool_busy`. The estimates are synchronous, so nothing can run beside them and they take no guard.

**One validation per request** (decision 54). Each handler is `route({ request, query }, run)` over its ROUTES entry's own schema objects (`NO_INPUT`, `z.undefined()`, for an input the route does not take; `plain(run)` for neither). `createApp` reads the raw body as text (an empty body is `undefined`; text that is not JSON is the 400 `validation` envelope with `API_TEXT.malformedJson`), the query record and the path parameters, and the handler parses the body and the query once, answering a refusal with the 400 envelope and `details.fields`. Binding the schemas to the handler keeps the parsed types without a cast (`pnpm casts`, decision 48), and `createApp` refuses a handler whose schemas are not its entry's own objects.

**Hardening** (spec §4, decisions 54, 58): `Cache-Control: no-store` first on `/api/*`, set after the rest of the chain returns, so every API response carries it, the 401, 403, 413 and 429 refusals included → headers on everything → Host (exempting the public `GET /api/health`; the rejection names the header value and `ALLOWED_HOSTS`, and the allowed values go to the log only) → `Origin` → auth → on `/api/*`: `bodyLimit` at `MAX_BODY_BYTES` = 64 KiB (413 `body_too_large`), then JSON and `X-Requested-With` on mutating calls. No CORS middleware: the SPA is same-origin. The failed-auth limiter is per client IP only, 5 failures a minute; a request whose IP is unknown (no socket under `app.request()`, no trusted proxy) shares one `UNKNOWN_IP` bucket; a valid credential is accepted before the limiter is consulted, so the limit slows guessing and never locks out the operator. The limiter's memory is bounded by age and by size: past 10 000 source addresses the least recently failing one is dropped in constant time (review SEC-R2-1). `TRUST_PROXY=true` is safe only when the app is reachable through the proxy alone: a client that reaches it directly can choose its `X-Forwarded-For`, which defeats any per-IP limit (WP12's operator docs carry the same sentence). With auth off, health detail is shown only to an allowed Host (a DNS-rebound page cannot read it, review SEC-2).

- [ ] **Step 1: Write the failing tests**

The spawn test runs the real entry with an environment built from scratch (no inherited `NODE_ENV=test`), and probes the server from a second, unguarded `node` process, because this test process's `fetch` is answered by WP4's network guards and they refuse even a DNS lookup of `127.0.0.1`. Its timeouts are named constants: it starts a real production process.

`apps/api/test/bootstrap/app.spawn.test.ts` (new file):

```ts
// Spec §5.5, §9 item 5: one test spawning the real bootstrap with a real production environment.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiContract, asIata, asIsoDate, asIsoDateTime, FIXTURE_OPT_IN_PHRASE, systemClock } from '@gmt/core';
import { type CalendarPriceInsert, MIGRATIONS_DIR } from '@gmt/db';
import { fixtureProvider } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../src/logger.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

// why: the spawned process must see a real production environment, not vitest's NODE_ENV=test, so the env is built
// from scratch (cleanEnv blanks every variable spec §12 names) rather than copied from this process.
const apiRoot = fileURLToPath(new URL('../..', import.meta.url));
/** How long the probe process may take, how long the child may take to listen, and the two tests' budgets. */
const PROBE_TIMEOUT_MS = 20_000;
const LISTEN_TIMEOUT_MS = 45_000;
const BOOT_TEST_TIMEOUT_MS = 90_000;
const REFUSAL_TEST_TIMEOUT_MS = 60_000;
const ENTRY = ['--conditions=@gmt/source', '--import', 'tsx', 'src/bootstrap/start.ts'];

/** A free port. why: listen without a host, because the network guards refuse even a lookup of 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const a = s.address();
      if (a !== null && typeof a === 'object') {
        const port = a.port;
        s.close(() => resolve(port));
      } else reject(new Error('no port'));
    });
  });
}

/** Resolves with the first output line matching `pattern`; rejects with all output if the child exits first. */
function waitForLine(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}:\n${out}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      const line = out.split('\n').find((l) => pattern.test(l));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(line);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`bootstrap exited with ${code} before ${pattern}:\n${out}`));
    });
  });
}

/**
 * GET from the spawned app in a separate node process. why: this process's fetch is answered by WP4's network guards
 * (every request is a stray), so the probe runs where nothing is intercepted, on a numeric loopback address.
 */
function probe(url: string, authorization: string): { status: number; body: unknown } {
  const script = `const r = await fetch(${JSON.stringify(url)}, { headers: { authorization: ${JSON.stringify(authorization)} } }); process.stdout.write(JSON.stringify({ status: r.status, body: await r.json() }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  const out = z.object({ status: z.number(), body: z.unknown() }).parse(JSON.parse(r.stdout));
  return out;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

/** A synthetic row the repository must refuse outside the gate (spec §5.5). */
function syntheticCalendarRow(): CalendarPriceInsert {
  return {
    providerId: 'fixture',
    sourceKind: 'synthetic',
    cabin: 'economy',
    cell: {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureDate: asIsoDate('2027-03-14'),
      returnDate: asIsoDate('2027-03-28'),
    },
    pricePence: 41_200,
    priceNativeMinor: 41_200,
    currencyNative: 'GBP',
    fx: { converted: false },
    pointOfSale: 'unknown',
    fetchedAt: asIsoDateTime('2026-10-14T09:00:00.000Z'),
    providerObservedAt: null,
    maxAgeHours: 0,
    vendorLink: null,
    reusedFromExecutionId: null,
  };
}

describe('production boot lacks fixture (spec §5.5, §9 item 5)', () => {
  it(
    'the real bootstrap under NODE_ENV=production never offers or accepts synthetic data',
    async () => {
      const dir = tempDir('gmt-spawn-');
      const port = await freePort();
      // why: the strongest negative case: the opt-in phrase is set, the path ends in .fixture.db and we are not in a
      // container, so NODE_ENV=production is the only thing standing between us and synthetic data.
      const env = cleanEnv({
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        DATABASE_PATH: join(dir, 'prod.fixture.db'),
        PORT: String(port),
        BIND_ADDRESS: '127.0.0.1',
        ALLOWED_HOSTS: `127.0.0.1:${port}`,
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
        ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
        LOG_LEVEL: 'info',
      });
      const child = spawn(process.execPath, ENTRY, { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        await waitForLine(child, /"msg":"listening"/, LISTEN_TIMEOUT_MS);
        const auth = Buffer.from(`operator:${SENTINEL_AUTH}`).toString('base64');
        const res = probe(`http://127.0.0.1:${port}/api/providers`, `Basic ${auth}`);
        expect(res.status).toBe(200);
        const body = apiContract.providersResponseSchema.parse(res.body);
        expect(body.providers.map((p) => p.providerId)).not.toContain('fixture');
        expect(body.synthetic).toBe(false);
      } finally {
        child.kill('SIGTERM');
      }
      expect(await waitForExit(child)).toBe(0);

      // Same environment and file, in this process: the gates hold outside the server too.
      const config = loadConfigFromEnv(env);
      const log = createLogger({ logLevel: 'error' });
      const ports = buildPorts(config, { log, migrationsDir: MIGRATIONS_DIR });
      try {
        expect(ports.providers.map((p) => p.id)).not.toContain('fixture');
        expect(() =>
          fixtureProvider({ http: ports.http, log, clock: systemClock, config, costMicroGbp: 0 }),
        ).toThrow();
        // why: match the message so a foreign-key failure cannot satisfy the assertion by accident.
        expect(() => ports.repos.calendarPrices.insert('spawn-test', [syntheticCalendarRow()])).toThrow(
          /synthetic/i,
        );
      } finally {
        ports.db.close();
      }
    },
    BOOT_TEST_TIMEOUT_MS,
  );

  it(
    'refuses NODE_ENV=test with exit code 70 and bad config with 78 (plan exit-code table)',
    async () => {
      const dir = tempDir('gmt-spawn-');
      const base = {
        PATH: process.env.PATH ?? '',
        BIND_ADDRESS: '127.0.0.1',
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
      };
      const run = (env: Record<string, string>) =>
        waitForExit(
          spawn(process.execPath, ENTRY, {
            cwd: apiRoot,
            env: cleanEnv({ ...base, ...env }),
            stdio: 'ignore',
          }),
        );
      expect(await run({ NODE_ENV: 'test', DATABASE_PATH: join(dir, 'x.test.db') })).toBe(70);
      expect(
        await run({ NODE_ENV: 'production', DATABASE_PATH: join(dir, 'x.db'), PORT: 'not-a-port' }),
      ).toBe(78);
    },
    REFUSAL_TEST_TIMEOUT_MS,
  );
});
```

`apps/api/test/defaults.test.ts` (new file):

```ts
// Spec §8.2 plan preset and §11 form defaults.
import type { FlightProvider, ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultDefinitionInput } from '../src/defaults.js';
import { loadConfigFromEnv } from '../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP } from './helpers/env.js';

const config = (env: Record<string, string>) =>
  loadConfigFromEnv(
    cleanEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
      ...env,
    }),
  );
const stub = (id: ProviderId): FlightProvider => ({
  id,
  displayName: id,
  suppliedFields: [],
  cabins: ['economy'],
  healthcheck: async () => ({ ok: true, detail: '' }),
});

describe('defaultDefinitionInput (spec §8.2 plan preset, §11 form defaults)', () => {
  it('£0: Travelpayouts discovery only, no verification, the core refresh default', () => {
    const d = defaultDefinitionInput(config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP }), [stub('travelpayouts')]);
    expect(d.providers).toEqual({
      discovery: ['travelpayouts'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168 },
    });
  });
  it('trial SearchApi plus Travelpayouts: still no verification provider', () => {
    const c = config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA });
    expect(
      defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]).providers.verification,
    ).toEqual([]);
  });
  it('40usd: both providers discover, SearchApi verifies, maxCells 10 / expandTop 2', () => {
    const c = config({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const d = defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]);
    expect(d.providers.discovery).toEqual(['travelpayouts', 'searchapi']);
    expect(d.providers.verification).toEqual(['searchapi']);
    expect(d.verification).toEqual({
      maxCells: 10,
      topN: 10,
      alwaysInclude: [],
      expandTop: 2,
      bookingLinks: true,
    });
    expect(d.budget).toEqual({ maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 });
  });
  it('no providers: empty stages; no airports; disabled; weekly schedule in SCHEDULER_TIMEZONE; form defaults', () => {
    const d = defaultDefinitionInput(config({ SCHEDULER_TIMEZONE: 'Europe/London' }), []);
    expect(d.providers.discovery).toEqual([]);
    expect([d.origins, d.destinations, d.enabled]).toEqual([[], [], false]);
    expect([d.scheduleCron, d.scheduleTz]).toEqual(['0 5 * * 1', 'Europe/London']);
    expect(d.window).toEqual({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 });
    expect([d.minNights, d.maxNights, d.cabin]).toEqual([10, 21, 'economy']);
    expect(d.constraints).toEqual({
      maxJourneyMinutes: 1500,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
    });
    expect(d).not.toHaveProperty('confirmedCostPence');
    expect(d).not.toHaveProperty('confirmedCalls');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.spawn.test.ts test/defaults.test.ts`
Expected: FAIL: `Cannot find module '../src/defaults.js'`; the spawn test's child exits with `ERR_MODULE_NOT_FOUND` for `src/bootstrap/start.ts` before printing `"msg":"listening"`.

- [ ] **Step 3: Implement**

Remove the validator middleware the routes no longer use (it updates `package.json` and `pnpm-lock.yaml`), then add the scripts:

Run: `pnpm --filter @gmt/api remove @hono/zod-validator`
Expected: `@hono/zod-validator` leaves `apps/api/package.json` and the lockfile; nothing else changes.

`apps/api/package.json` — find:

```json
    "dev": "tsx watch src/bootstrap/app.ts",
    "tool": "node --conditions=@gmt/source --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts"
```

`apps/api/package.json` — replace with:

```json
    "dev": "node --conditions=@gmt/source --import tsx --watch src/bootstrap/start.ts",
    "tool": "node --conditions=@gmt/source --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts",
    "start": "node dist/bootstrap/start.js"
```

The tool bootstrap calls the shared seeding (and logs its heartbeat failure under `err`, as every other error log does):

Apply this patch from the repository root (`git apply`):

```diff
diff --git a/apps/api/src/bootstrap/tool.ts b/apps/api/src/bootstrap/tool.ts
index 9624092..3a6367c 100644
--- a/apps/api/src/bootstrap/tool.ts
+++ b/apps/api/src/bootstrap/tool.ts
@@ -12,10 +12,8 @@ import {
   AIRPORTS_DATA_DIR,
   AppLock,
   HEARTBEAT_INTERVAL_MS,
-  loadAirportsDataset,
   MIGRATIONS_DIR,
   readOnlyLockState,
-  seedAirports,
 } from '@gmt/db';
 import { defaultRecordedRoot } from '@gmt/providers';
 import { createLogger } from '../logger.js';
@@ -26,6 +24,7 @@ import { EXIT, type ToolContext, type ToolName } from '../tools/types.js';
 import { isWorkedExampleRoute, WORKED_EXAMPLE_ROUTE_ARG } from '../tools/workedExample.js';
 import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';
 import { backupBeforeMigrations, dataDirRefusal } from './preflight.js';
+import { seedIfNeeded } from './seed.js';
 
 export { EXIT, type ToolName } from '../tools/types.js';
 
@@ -274,7 +273,10 @@ async function runToolSteps(
       } catch (e) {
         // why: a throw inside a timer would kill the process with the execution left running (arch-014, cost-wp4b-007)
         lockLost = true;
-        log.error({ error: safeMessage(e, secrets) }, 'app_lock heartbeat failed; aborting the tool');
+        log.error(
+          { err: { message: safeMessage(e, secrets) } },
+          'app_lock heartbeat failed; aborting the tool',
+        );
         err(`app_lock lost (${safeMessage(e, secrets)}); aborting`);
         ac.abort();
       }
@@ -286,7 +288,7 @@ async function runToolSteps(
     process.on('SIGINT', onSignal);
     process.on('SIGTERM', onSignal);
     try {
-      seedIfNeeded(ports, out);
+      seedIfNeeded(ports, AIRPORTS_DATA_DIR, out);
       const code = await prepared.run(ports, {
         signal: ac.signal,
         out,
@@ -310,14 +312,6 @@ async function runToolSteps(
   }
 }
 
-/** Spec §7: seed after migration when `airports` is empty or the dataset version changed; local files, no network. */
-function seedIfNeeded(ports: Ports, out: (line: string) => void): void {
-  const dataset = loadAirportsDataset(AIRPORTS_DATA_DIR);
-  if (ports.repos.airports.count() > 0 && ports.repos.airports.datasetVersion() === dataset.version) return;
-  const r = seedAirports(ports.db, dataset);
-  out(`airports seeded: ${r.inserted} rows, dataset ${r.datasetVersion}`);
-}
-
 /**
  * True when this module is the process entry. why: argv[1] may be a symlink (pnpm's bin links), so it is resolved; if
  * resolution fails the unresolved path is compared instead of silently skipping the run (arch-r2-006).
```

`apps/api/src/text.ts` (new file):

```ts
/**
 * Every fixed user-facing string the api emits: error messages, basis reasons, notices (spec §10, §11).
 * One table so the banned-word test (spec §11, §8.3) can scan all of them.
 * Rule: no banned word; "verified" never appears here because it is reserved for class values;
 * the verified basis is called the "itinerary-search basis" (plan Banned words, spec §11).
 * No airport code appears here (spec §1; the boundary script's airport-literal check, decisions 36 and 46).
 */
import { formatPence } from '@gmt/core';

export const API_TEXT = {
  internal: 'internal error; see the server log',
  notFound: 'no such route',
  unauthenticated: 'authentication required',
  rateLimited: (seconds: number) => `too many failed sign-in attempts; retry in ${seconds}s`,
  // why: plan decision 54: a rejection names the variable, never its values (they would tell a stranger the host names).
  hostRejected: (host: string) => `Host "${host}" is not in ALLOWED_HOSTS`,
  originRejected: (origin: string) => `Origin "${origin}" does not name a host in ALLOWED_HOSTS`,
  bodyTooLarge: 'request body is larger than the api accepts',
  contentType: 'requests that change data need Content-Type: application/json',
  requestedWith: 'requests that change data need X-Requested-With: get-me-there',
  validation: (target: string) => `invalid request ${target}`,
  malformedJson: 'request body is not valid JSON',
  // why: not-found messages never echo the id a caller sent (spec §5.3: a pasted secret must not come back out).
  definitionNotFound: 'no such search definition',
  executionNotFound: 'no such execution',
  noExecution: 'this definition has not been run yet',
  alertNotFound: 'no such alert rule',
  itineraryNotFound: 'no such itinerary',
  alreadyRunning: 'a request for this definition is already running; retry when it finishes',
  unknownProvider: (id: string) => `provider ${id} is not configured`,
  unknownDestination: 'that destination is not one of this definition',
  draftNotice: 'Set at least one origin and one destination before running or scheduling this search.',
  draftCannotEnable: 'a definition without origins and destinations cannot be enabled',
  draftNoEstimate: 'set origins and destinations before asking for an estimate',
  deletedNotice: 'definition deleted; its schedule is removed',
  invalidDefinition: 'the definition is not valid',
  zeroCells: 'the window and nights range resolve to zero cells; widen the window or the nights range',
  invalidCron: (reason: string) => `schedule rejected: ${reason}`,
  scheduleOverBudget: (scopes: readonly string[]) =>
    `schedule rejected: the monthly load of every enabled schedule would exceed ${scopes.join(', ')}`,
  coverageCheckUnavailable:
    'the coverage check reads the free Travelpayouts cache; set TRAVELPAYOUTS_TOKEN to enable it',
  zeroCapVerification: 'verification will not run: spend cap is 0',
  // why: formatPence (core) is the only money formatter in user-facing strings (plan decision 15).
  ceilingNote: (capPence: number, feesPence: number) =>
    `monthly spend cap ${formatPence(capPence)}, of which ${formatPence(feesPence)} is subscription fees counted once`,
  notCancellable: (status: string) => `execution is ${status} and cannot be cancelled`,
  cellNotInSpace: 'that cell is outside the current window, nights range or airports of this definition',
  unknownAirport: (code: string) => `airport ${code} is not in the airports table`,
  noVerificationProvider:
    'this definition has no verification provider, so single-cell verify is unavailable',
  basisNoVerificationProvider:
    'calendar basis: no verification provider is configured, so constraints are not checked',
  basisNoObservations:
    'calendar basis: no itinerary-searched observations yet, so constraints are not checked',
  basisItinerarySearch:
    'itinerary-search basis: constraints checked against the current definition at read time',
  basisRequestedCalendar: 'calendar basis as requested: constraints are not checked',
  insideSpace: (inside: number, total: number) =>
    `${inside} of ${total} rows are inside the current window and nights range`,
  toolUnavailable: (name: string) => `the ${name} tool is not available in this build`,
  toolBusy: (name: string) => `the ${name} tool is already running`,
  toolFailed: (name: string) => `the ${name} tool failed; see the server log`,
  toolSynthetic: 'the record tool refuses while the synthetic gate is open (spec §5.5)',
  toolSummary: (name: string, exitCode: number, files: number) =>
    `${name} finished with exit code ${exitCode}; ${files} fixture file(s) written`,
} as const;
```

`apps/api/src/errors.ts` (new file):

```ts
/** The spec §10 error envelope and the app's error handlers. */
import { type Logger, type Secret, stripUrlsInText } from '@gmt/core';
import { RowRejected } from '@gmt/db';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { safeMessage } from './safeMessage.js';
import { API_TEXT } from './text.js';

export type FieldError = { field: string; message: string };
/** `error.details` on the wire: a JSON object, `fields` on a 422 or a validation 400 (spec §10). */
export type Details = { [key: string]: unknown };

/** Thrown by handlers; rendered as the spec §10 error envelope with its status. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details: Details | undefined;
  constructor(status: ContentfulStatusCode, code: string, message: string, details?: Details) {
    super(stripUrlsInText(message));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Spec §10: a 422 (and a 400 from validation) carries `details.fields`. */
export function fieldsDetail(fields: readonly FieldError[]): { fields: FieldError[] } {
  return { fields: [...fields] };
}

/** zod issues → field errors, the path joined with dots. */
export function issuesToFields(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): FieldError[] {
  return issues.map((i) => ({ field: i.path.map(String).join('.'), message: i.message }));
}

/** A copy with every string URL-stripped. Spec §5.3: API `error.details` never holds a query string or userinfo. */
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return stripUrlsInText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === 'object') return scrubDetails(value);
  return value;
}

/** Deep copy of an object with every string URL-stripped (spec §5.3). */
export function scrubDetails(value: object): Details {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
}

/** Spec §10: `{ error: { code, message, details? } }`. */
export function envelope(
  code: string,
  message: string,
  details?: Details,
): { error: { code: string; message: string; details?: Details } } {
  return {
    error: {
      code,
      message: stripUrlsInText(message),
      ...(details === undefined ? {} : { details: scrubDetails(details) }),
    },
  };
}

/**
 * `app.onError`: ApiError → its envelope; WP3's `RowRejected('active')` (a start or verify that lost the race for the
 * one-active-execution index) → 409 `active`; anything else → 500 without internals, logged URL-free and secret-free
 * (spec §5.3, §14).
 */
export function onError(log: Logger, secrets: readonly Secret[]) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.details), err.status);
    if (err instanceof RowRejected && err.rule === 'active')
      return c.json(envelope('active', err.message), 409);
    log.error({ err: { name: err.name, message: safeMessage(err, secrets) } }, 'unhandled error');
    return c.json(envelope('internal', API_TEXT.internal), 500);
  };
}

/** `app.notFound`: the router matched nothing. Handlers use their own codes (`definition_not_found`, …). */
export function notFound(c: Context) {
  return c.json(envelope('not_found', API_TEXT.notFound), 404);
}
```

`apps/api/src/defaults.ts` (new file):

```ts
/** The plan-aware default definition (spec §8.2 policy preset, §11 form defaults). */
import {
  type Config,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type DefinitionInput,
  type FlightProvider,
  type ProviderId,
} from '@gmt/core';

/** Spec §8.2: weekly, Monday 05:00 in SCHEDULER_TIMEZONE. The refresh default is core's DEFAULT_DISCOVERY_REFRESH_HOURS. */
export const DEFAULT_CRON = '0 5 * * 1';

/**
 * The default definition for the configured plan (spec §8.2 policy preset, §11 form defaults).
 * No airports (spec §1, §15). Disabled, so no schedule fires on a draft. No confirmation: `confirmedCostPence` and
 * `confirmedCalls` are not part of DefinitionInput and are set only from an explicit confirmation (spec §7, decision 37).
 */
export function defaultDefinitionInput(
  config: Config,
  providers: readonly FlightProvider[],
): DefinitionInput {
  const configured = new Set(providers.map((p) => p.id));
  const paid = config.providers.searchapi?.plan === '40usd' && configured.has('searchapi');
  const fixture = configured.has('fixture');
  const discovery: ProviderId[] = [];
  if (configured.has('travelpayouts')) discovery.push('travelpayouts');
  if (paid) discovery.push('searchapi');
  if (fixture) discovery.push('fixture');
  // why: on trial the 100 credits are for the spike and smoke (spec §2 fact 7), so the preset never verifies with them.
  const verification: ProviderId[] = [];
  if (paid) verification.push('searchapi');
  if (fixture) verification.push('fixture');
  const discoveryRefreshHours: Partial<Record<ProviderId, number>> = {};
  for (const id of discovery) discoveryRefreshHours[id] = DEFAULT_DISCOVERY_REFRESH_HOURS;
  return {
    name: 'New search',
    origins: [],
    destinations: [],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: {
      maxCalls: config.spend.executionMaxCalls,
      maxFreeCalls: config.spend.executionMaxFreeCalls,
      maxCostMicroGbp: config.spend.executionMaxCostMicroGbp,
    },
    providers: { discovery, verification, discoveryRefreshHours },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: DEFAULT_CRON,
    scheduleTz: config.schedulerTimezone,
    enabled: false,
  };
}
```

`apps/api/src/routes/types.ts` (new file):

```ts
/** Shared types of the route table (spec §10). */
import type { apiContract } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';

/** Every ROUTES path starts with this (spec §10); static files and the SPA fallback own everything else. */
export const API_PREFIX = '/api';

export interface AppVariables {
  /** True when the request carried valid basic-auth credentials, or auth is disabled by config. */
  authenticated: boolean;
}
export type AppEnv = { Variables: AppVariables };

export type ToolRunResponse = z.infer<typeof apiContract.toolRunResponseSchema>;
export type ToolRecordRequest = z.infer<typeof apiContract.toolRecordRequestSchema>;
/**
 * The tools the HTTP surface runs in-process; an absent runner answers 503 tool_unavailable. why: named apart from
 * WP4b's `ToolRunners` in `bootstrap/tool.ts` (the CLI's runners, a different shape) so the two never shadow.
 */
export interface HttpToolRunners {
  record?: (args: ToolRecordRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
}

/** ROUTES entries another package mounts (plan decision 4). WP13 adds the smoke handler and removes its key. */
export const OWNED_ELSEWHERE: ReadonlySet<string> = new Set(['POST /api/tools/smoke']);

/** The raw inputs of one request: the JSON body (undefined when empty), the query record, the path parameters. */
export interface RawInput {
  body: unknown;
  query: Record<string, string> | undefined;
  params: Record<string, string>;
}
export interface RouteContext {
  ports: Ports;
  engine: Engine;
  tools: HttpToolRunners;
  /** Plan decisions 54, 58: the keys with a request in flight (`oneAtATime`): definitions, the coverage check, the tool. */
  busy: Set<string>;
}
/**
 * One route's handler with the schemas it validates against: the ROUTES entry's own `request` and `query` objects
 * (createApp checks identity), parsed exactly once before `handle` runs (plan decision 54).
 */
export interface RouteHandler {
  readonly request: z.ZodType;
  readonly query: z.ZodType;
  handle(c: Context<AppEnv>, raw: RawInput, ctx: RouteContext): Response | Promise<Response>;
}
/** Handlers keyed exactly as `${method} ${path}` of a ROUTES entry. */
export type HandlerTable = Readonly<Record<string, RouteHandler>>;
```

`apps/api/src/routes/define.ts` (new file):

```ts
/** One validation per request (plan decision 54): each handler declares the ROUTES schemas and receives their output. */
import type { Context } from 'hono';
import { z } from 'zod';
import { envelope, fieldsDetail, issuesToFields } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { AppEnv, RouteContext, RouteHandler } from './types.js';

/** The schema of an input a route does not take: only `undefined` passes. Shared, so createApp can compare identity. */
export const NO_INPUT = z.undefined();

/** The validated inputs a handler receives, typed from its schemas. */
export interface Input<B extends z.ZodType, Q extends z.ZodType> {
  body: z.output<B>;
  query: z.output<Q>;
  params: Record<string, string>;
}

/**
 * Defines a handler over the ROUTES entry's `request` and `query` (pass `NO_INPUT` for one the route does not take).
 * The body and the query are parsed here, once; a refusal is the 400 `validation` envelope with `details.fields`.
 * why: the table-driven mount loses Hono's static input types; binding the schema objects to the handler keeps the
 * types without a cast, and createApp refuses a handler whose schemas are not the ROUTES entry's own.
 */
export function route<B extends z.ZodType, Q extends z.ZodType>(
  schemas: { request: B; query: Q },
  run: (c: Context<AppEnv>, input: Input<B, Q>, ctx: RouteContext) => Response | Promise<Response>,
): RouteHandler {
  return {
    request: schemas.request,
    query: schemas.query,
    handle: (c, raw, ctx) => {
      const body = schemas.request.safeParse(raw.body);
      if (!body.success)
        return c.json(
          envelope(
            'validation',
            API_TEXT.validation('body'),
            fieldsDetail(issuesToFields(body.error.issues)),
          ),
          400,
        );
      const query = schemas.query.safeParse(raw.query);
      if (!query.success)
        return c.json(
          envelope(
            'validation',
            API_TEXT.validation('query'),
            fieldsDetail(issuesToFields(query.error.issues)),
          ),
          400,
        );
      return run(c, { body: body.data, query: query.data, params: raw.params }, ctx);
    },
  };
}

/** A route without a body or a query. */
export function plain(
  run: (
    c: Context<AppEnv>,
    input: Input<typeof NO_INPUT, typeof NO_INPUT>,
    ctx: RouteContext,
  ) => Response | Promise<Response>,
): RouteHandler {
  return route({ request: NO_INPUT, query: NO_INPUT }, run);
}
```

`apps/api/src/routes/shared.ts` (new file):

```ts
/** Helpers every handler table uses. */
import type { SearchDefinition } from '@gmt/core';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { RouteContext } from './types.js';

/** A path parameter the router guarantees; a missing one is a 400, never a crash. */
export function param(input: { params: Record<string, string> }, name: string): string {
  const v = input.params[name];
  if (v === undefined || v === '') throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return v;
}

/** A definition that exists and is not soft-deleted, else 404 `definition_not_found` (the id is not echoed). */
export function getLiveDefinition(ctx: RouteContext, id: string): SearchDefinition {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null)
    throw new ApiError(404, 'definition_not_found', API_TEXT.definitionNotFound);
  return def;
}

/** The refusal of a request whose key is already in flight (decision 54): 429 `already_running`. */
const alreadyRunning = () => new ApiError(429, 'already_running', API_TEXT.alreadyRunning);

/**
 * The one in-flight guard (plan decisions 54, 58): a second request under the same key while one is awaiting is refused
 * with `busy()` — 429 `already_running` by default. Keys: the definition id for a run, resume or verify; `coverage-check`
 * for the coverage check; `tool` for the record tool (409 `tool_busy`, its contract code). The estimates are
 * synchronous, so they need no guard: nothing else runs while they do.
 */
export async function oneAtATime<T>(
  ctx: RouteContext,
  key: string,
  fn: () => T | Promise<T>,
  busy: () => ApiError = alreadyRunning,
): Promise<T> {
  if (ctx.busy.has(key)) throw busy();
  ctx.busy.add(key);
  try {
    return await fn();
  } finally {
    ctx.busy.delete(key);
  }
}
```

`apps/api/src/read/usage.ts` (new file):

```ts
/** Budget usage in the api-contract shape (spec §7 budget windows, §10). */
import {
  type apiContract,
  type BudgetScope,
  budgetScopeLabel,
  type Config,
  microGbpToPence,
  type ProviderId,
  type ProviderLimits,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';

export type ApiUsage = z.infer<typeof apiContract.usageSchema>;

/** The configured limits for a provider; the fixture provider has none (its test cost lives in the guard). */
export function providerLimits(config: Config, id: ProviderId): ProviderLimits | null {
  if (id === 'travelpayouts') return config.providers.travelpayouts?.limits ?? null;
  if (id === 'searchapi') return config.providers.searchapi?.limits ?? null;
  return null;
}

/** Both provider windows; the guard reports `cap: null` for the one the plan does not use (plan, Budget port). */
export function providerScopes(providerId: ProviderId): BudgetScope[] {
  return [
    { kind: 'provider-month', providerId },
    { kind: 'provider-lifetime', providerId },
  ];
}

/** Every scope of the spec §8.1 pre-start check: execution scopes (when given), each provider, global. */
export function budgetScopes(ports: Ports, executionId: string | null): BudgetScope[] {
  const execution: BudgetScope[] =
    executionId === null
      ? []
      : [
          { kind: 'execution-calls', executionId },
          { kind: 'execution-free-calls', executionId },
          { kind: 'execution-cost', executionId },
        ];
  return [...execution, ...ports.providers.flatMap((p) => providerScopes(p.id)), { kind: 'global-month' }];
}

/** The api-contract `Usage`: the guard's usage plus its scope label and pence (core's rounding: spend is never understated). */
export function usageOf(ports: Ports, scope: BudgetScope): ApiUsage {
  const u = ports.budget.usage(scope);
  return {
    scope: budgetScopeLabel(scope),
    calls: u.calls,
    costMicroGbp: u.costMicroGbp,
    costPence: microGbpToPence(u.costMicroGbp),
    cap: u.cap,
    windowStart: u.windowStart,
    windowEnd: u.windowEnd,
  };
}
```

`apps/api/src/routes/system.ts` (new file):

```ts
/** Spec §10 system routes: health, airports, providers, budget, scheduler jobs. */
import { statSync } from 'node:fs';
import {
  apiContract,
  type Config,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  microGbpToPence,
  type ProviderId,
} from '@gmt/core';
import type { z } from 'zod';
import { defaultDefinitionInput } from '../defaults.js';
import { hostAllowed } from '../middleware/hardening.js';
import { budgetScopes, providerLimits, providerScopes, usageOf } from '../read/usage.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { NO_INPUT, plain, route } from './define.js';
import type { HandlerTable, RouteContext } from './types.js';

type HealthDetail = z.infer<typeof apiContract.healthDetailSchema>;
type ProvidersResponse = z.infer<typeof apiContract.providersResponseSchema>;
type BudgetResponse = z.infer<typeof apiContract.budgetResponseSchema>;

function dbOk(ports: Ports): boolean {
  try {
    ports.db.raw.prepare('select 1 as one').get();
    return true;
  } catch {
    return false;
  }
}

/** Spec §10 `GET /health` minimal shape: no detail without auth. */
export function healthPublic(ctx: RouteContext): { ok: boolean; degraded: boolean } {
  return { ok: dbOk(ctx.ports), degraded: ctx.engine.status().degraded };
}

/** The file's size; 0 for an in-memory database (the contract has no "unknown"). */
function dbSizeBytes(path: string): number {
  if (path === ':memory:') return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Spec §10 authenticated `/health` detail. No database path (plan: `path: never`). */
export function healthDetail(ctx: RouteContext): HealthDetail {
  const base = healthPublic(ctx);
  const s = ctx.engine.status();
  return {
    ...base,
    db: { ok: base.ok, sizeBytes: dbSizeBytes(ctx.ports.config.databasePath) },
    // why: `healthy` would need a provider call; health never spends or waits, so it reports null (not checked).
    providers: ctx.ports.providers.map((p) => ({ providerId: p.id, configured: true, healthy: null })),
    scheduler: {
      jobCount: ctx.engine.scheduler.jobs().length,
      nextRun: s.nextRun,
      lastExecutionAt: s.lastExecutionAt,
      degraded: s.degraded,
      blockedSince: ctx.engine.scheduler.blockedSince(),
    },
  };
}

function planOf(config: Config, id: ProviderId): ProvidersResponse['providers'][number]['plan'] {
  if (id === 'searchapi') return config.providers.searchapi?.plan ?? 'trial';
  return id === 'fixture' ? 'synthetic' : 'free';
}

/**
 * Spec §10 `GET /providers`: config + capabilities + usage only (there is no providers table, plan decision 15), the
 * zero-cap notice, the plan presets (`discoveryRefreshHours` is core's DEFAULT_DISCOVERY_REFRESH_HOURS, decision 21).
 */
export function providersResponse(ctx: RouteContext): ProvidersResponse {
  const { config } = ctx.ports;
  const preset = defaultDefinitionInput(config, ctx.ports.providers);
  return {
    providers: ctx.ports.providers.map((p) => ({
      providerId: p.id,
      displayName: p.displayName,
      enabled: true,
      capabilities: { discovery: p.discovery?.info ?? null, verification: p.verification?.info ?? null },
      plan: planOf(config, p.id),
      usage: providerScopes(p.id).map((s) => usageOf(ctx.ports, s)),
      excludedFromSchedule: providerLimits(config, p.id)?.excludedFromSchedule ?? false,
      // why: spec §10/§12: a billed provider enabled under a zero cap cannot verify; say so where the operator looks.
      notices:
        p.id === 'searchapi' && config.spend.monthlyCapMicroGbp === 0 ? [API_TEXT.zeroCapVerification] : [],
    })),
    synthetic: ctx.ports.providers.some((p) => p.id === 'fixture'),
    presets: {
      policy: {
        maxCells: preset.verification.maxCells,
        topN: preset.verification.topN,
        expandTop: preset.verification.expandTop,
        bookingLinks: preset.verification.bookingLinks,
      },
      providers: preset.providers,
      budget: preset.budget,
      discoveryRefreshHours: DEFAULT_DISCOVERY_REFRESH_HOURS,
      schedulerTimezone: config.schedulerTimezone,
    },
    pointOfSale: config.pointOfSale,
  };
}

/** Spec §10 `GET /budget`: every window with bounds; the cap includes subscription fees once (spec §5.3, §12). */
export function budgetResponse(ctx: RouteContext): BudgetResponse {
  const { config } = ctx.ports;
  const sa = config.providers.searchapi;
  const fixedFeesMicroGbp = sa !== null && sa.limits.window === 'month' ? sa.limits.planFixedMicroGbp : 0;
  const monthlyCapPence = microGbpToPence(config.spend.monthlyCapMicroGbp);
  return {
    scopes: budgetScopes(ctx.ports, null).map((s) => usageOf(ctx.ports, s)),
    monthlyCapMicroGbp: config.spend.monthlyCapMicroGbp,
    monthlyCapPence,
    fixedFeesMicroGbp,
    ceilingNote: API_TEXT.ceilingNote(monthlyCapPence, microGbpToPence(fixedFeesMicroGbp)),
  };
}

export const systemHandlers: HandlerTable = {
  /**
   * One public route with two shapes: the HEALTHCHECK gets the minimal one; the detail goes only to a caller with
   * valid credentials or, with auth off, a request whose Host is allowed (review SEC-2: the route is Host-exempt, so
   * a rebinding page must not read the detail through it).
   */
  'GET /api/health': plain((c, _input, ctx) => {
    const { config } = ctx.ports;
    const detail =
      c.get('authenticated') && (config.auth !== null || hostAllowed(config, c.req.header('host')));
    return c.json(detail ? healthDetail(ctx) : healthPublic(ctx));
  }),
  'GET /api/airports': route(
    { request: NO_INPUT, query: apiContract.airportsQuerySchema },
    (c, { query }, ctx) =>
      c.json(
        ctx.ports.repos.airports.search(query.q, 20).map((a) => ({
          iata: a.iata,
          name: a.name,
          city: a.city,
          country: a.country,
          tz: a.tz,
          metro: a.metro,
        })),
      ),
  ),
  'GET /api/providers': plain((c, _input, ctx) => c.json(providersResponse(ctx))),
  'GET /api/budget': plain((c, _input, ctx) => c.json(budgetResponse(ctx))),
  'GET /api/scheduler/jobs': plain((c, _input, ctx) => c.json({ jobs: ctx.engine.scheduler.jobs() })),
};
```

`apps/api/src/routes/index.ts` (new file):

```ts
/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
};
```

`apps/api/src/middleware/auth.ts` (new file):

```ts
/** Spec §4 basic auth with the failed-auth rate limit. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock, Config, Secret } from '@gmt/core';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { envelope } from '../errors.js';
import type { AppEnv } from '../routes/types.js';
import { API_TEXT } from '../text.js';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/**
 * Constant-time basic-auth check (spec §4). Both sides are hashed to equal-length digests so
 * `timingSafeEqual` never sees different lengths, and both comparisons always run.
 */
export function credentialsMatch(
  header: string | undefined,
  expected: { user: string; pass: Secret },
): 'absent' | 'valid' | 'invalid' {
  if (header === undefined) return 'absent';
  if (!header.startsWith('Basic ')) return 'invalid';
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return 'invalid';
  const userOk = timingSafeEqual(digest(decoded.slice(0, colon)), digest(expected.user));
  const passOk = timingSafeEqual(digest(decoded.slice(colon + 1)), digest(expected.pass.reveal()));
  return userOk && passOk ? 'valid' : 'invalid';
}

/**
 * Spec §4 and plan decision 54: 5 failed sign-ins a minute per client IP (TRUST_PROXY-aware, see `clientIpFrom`). In
 * memory: one process, one operator. why: no global bucket, because anyone who can reach the port could then keep the
 * operator out by spending it; and a correct credential always succeeds, so the limit slows guessing without ever
 * locking the operator out. A request whose IP is unknown (no socket, no trusted proxy header) shares one bucket.
 * Memory is bounded by age and by size (review SEC-R2-1): past `maxSources` addresses the least recently failing one is
 * dropped, in constant time, so a spray of spoofed addresses cannot grow the map or slow each failure. (With
 * TRUST_PROXY=true a client that reaches the app directly can choose its address, which defeats any per-IP limit: that
 * setting is safe only when the app is reachable through the proxy alone.)
 */
export class FailedAuthLimiter {
  private readonly byIp = new Map<string, number[]>();
  constructor(
    private readonly clock: Clock,
    private readonly limits = { perIp: 5, windowMs: 60_000, maxSources: 10_000 },
  ) {}

  private now(): number {
    return Date.parse(this.clock.now());
  }

  private recent(ip: string, now: number): number[] {
    const list = (this.byIp.get(ip) ?? []).filter((t) => now - t < this.limits.windowMs);
    if (list.length === 0) this.byIp.delete(ip);
    else this.byIp.set(ip, list);
    return list;
  }

  /** Seconds until this source may try again, or null when it is not limited. */
  retryAfterSeconds(ip: string): number | null {
    const now = this.now();
    const list = this.recent(ip, now);
    if (list.length < this.limits.perIp) return null;
    const pivot = list[list.length - this.limits.perIp] ?? now;
    return Math.max(1, Math.ceil((pivot + this.limits.windowMs - now) / 1000));
  }

  recordFailure(ip: string): void {
    const now = this.now();
    const list = [...this.recent(ip, now), now];
    // why: delete then set, so the Map's insertion order is least recently failing first, and eviction takes the head.
    this.byIp.delete(ip);
    this.byIp.set(ip, list);
    while (this.byIp.size > this.limits.maxSources) {
      const oldest = this.byIp.keys().next().value;
      if (oldest === undefined) break;
      this.byIp.delete(oldest);
    }
  }

  /** How many source addresses the limiter is holding (tests). */
  get sources(): number {
    return this.byIp.size;
  }
}

/** The bucket of a request whose client IP is not known. */
export const UNKNOWN_IP = 'unknown';

/** Spec §4: `X-Forwarded-For` only when `TRUST_PROXY=true` (its last entry, appended by the proxy), else the socket. */
export function clientIpFrom(config: Config): (c: Context<AppEnv>) => string | null {
  return (c) => {
    if (config.trustProxy) {
      const parts = (c.req.header('x-forwarded-for') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      const last = parts[parts.length - 1];
      if (last !== undefined) return last;
    }
    try {
      return getConnInfo(c).remote.address ?? null;
    } catch {
      return null; // why: app.request() in tests has no socket
    }
  };
}

export interface AuthGateOptions {
  config: Config;
  /** `${method} ${path}` of every ROUTES entry whose auth flag is `public`. */
  publicKeys: ReadonlySet<string>;
  limiter: FailedAuthLimiter;
  clientIp: (c: Context<AppEnv>) => string | null;
}

/**
 * Spec §4: everything except the public `GET /api/health` needs auth, static files included. A valid credential is
 * accepted whatever the limiter says (decision 54); a wrong one from a source over its limit is 429 with Retry-After,
 * otherwise it counts and is 401 — on every route, the public health route included, so it cannot probe passwords. A
 * request without credentials is never counted.
 */
export function basicAuthGate(o: AuthGateOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = o.config.auth;
    if (auth === null) {
      // why: config refuses this on a non-loopback bind unless ALLOW_UNAUTHENTICATED=true (spec §4); bootApp re-asserts it.
      c.set('authenticated', true);
      return next();
    }
    const isPublic = o.publicKeys.has(`${c.req.method} ${c.req.path}`);
    const header = c.req.header('authorization');
    if (header !== undefined) {
      if (credentialsMatch(header, auth) === 'valid') {
        c.set('authenticated', true);
        return next();
      }
      const ip = o.clientIp(c) ?? UNKNOWN_IP;
      const retry = o.limiter.retryAfterSeconds(ip);
      if (retry !== null) {
        c.header('Retry-After', String(retry));
        return c.json(envelope('auth_rate_limited', API_TEXT.rateLimited(retry)), 429);
      }
      o.limiter.recordFailure(ip);
    }
    c.set('authenticated', false);
    if (isPublic) return next();
    c.header('WWW-Authenticate', 'Basic realm="get-me-there", charset="UTF-8"');
    return c.json(envelope('unauthenticated', API_TEXT.unauthenticated), 401);
  };
}
```

`apps/api/src/middleware/headers.ts` (new file):

```ts
/** Spec §4 security headers. */
import { secureHeaders } from 'hono/secure-headers';

/**
 * Spec §4 security headers, on every response including 401/404 and static files. Hono's other
 * defaults (CORP, COOP, HSTS…) stay on; X-Frame-Options is tightened to DENY to agree with frame-ancestors 'none'.
 */
export function securityHeaders() {
  return secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
    referrerPolicy: 'no-referrer',
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
  });
}
```

`apps/api/src/middleware/hardening.ts` (new file):

```ts
/** Spec §4 request hardening: Host allowlist, Origin check, JSON and X-Requested-With on mutating calls; no caching. */
import type { Config, Logger } from '@gmt/core';
import type { Context, MiddlewareHandler } from 'hono';
import { envelope } from '../errors.js';
import type { AppEnv } from '../routes/types.js';
import { API_TEXT } from '../text.js';

type Exempt = (c: Context<AppEnv>) => boolean;
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** True when `host` is one of ALLOWED_HOSTS (case-insensitive). */
export function hostAllowed(config: Config, host: string | undefined): boolean {
  return host !== undefined && config.allowedHosts.some((h) => h.toLowerCase() === host.toLowerCase());
}

/**
 * Spec §4 `ALLOWED_HOSTS`: the rejection names the received Host and the variable, never the allowed values (plan
 * decision 54); the values go to the log for the operator. The public GET /api/health is exempt.
 */
export function hostAllowlist(config: Config, exempt: Exempt, log: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (exempt(c)) return next();
    const host = c.req.header('host');
    if (hostAllowed(config, host)) return next();
    log.warn({ host: host ?? null, allowedHosts: config.allowedHosts }, 'Host not in ALLOWED_HOSTS');
    const shown = host === undefined || host === '' ? '(none)' : host;
    return c.json(envelope('host_not_allowed', API_TEXT.hostRejected(shown)), 403);
  };
}

/** Spec §4: `Origin`, when present, must name an allowed host. */
export function originCheck(config: Config, exempt: Exempt): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin === undefined || exempt(c)) return next();
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      host = origin; // why: "null" and garbage are compared as-is, so they never match
    }
    if (hostAllowed(config, host)) return next();
    return c.json(envelope('origin_not_allowed', API_TEXT.originRejected(origin)), 403);
  };
}

/** Authenticated API responses are private: never cached by a browser or a proxy (review SEC-8). */
export function noStore(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  };
}

/** Spec §4: mutating API routes need JSON and the custom header (a CSRF barrier for a basic-auth app). */
export function mutatingRequestCheck(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    if (!/^application\/json\s*(;|$)/i.test(c.req.header('content-type') ?? ''))
      return c.json(envelope('content_type', API_TEXT.contentType), 415);
    if (c.req.header('x-requested-with') !== 'get-me-there')
      return c.json(envelope('requested_with', API_TEXT.requestedWith), 403);
    return next();
  };
}
```

`apps/api/src/static.ts` (new file):

```ts
/** Spec §4, §13: the built SPA behind auth, with an index.html fallback outside /api. */
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { API_PREFIX, type AppEnv } from './routes/types.js';

const isApi = (path: string): boolean => path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);

/**
 * Serves the built SPA (spec §4: behind auth, which runs before this) with an index.html
 * fallback for client-side paths. GET only; `/api/*` never falls back, so API 404s stay JSON.
 * serveStatic rejects `..`, `//` and backslashes before touching the disk.
 */
export function mountStatic(app: Hono<AppEnv>, webRoot: string): void {
  const files = serveStatic<AppEnv>({ root: webRoot });
  const index = serveStatic<AppEnv>({ path: join(webRoot, 'index.html') });
  app.get('*', async (c, next) => (isApi(c.req.path) ? next() : files(c, next)));
  app.get('*', async (c, next) => (isApi(c.req.path) ? next() : index(c, next)));
}
```

`apps/api/src/app.ts` (new file):

```ts
/** The single HTTP surface of spec §10, mounted from `@gmt/core` api-contract ROUTES. */
import { apiContract } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { envelope, notFound, onError } from './errors.js';
import { basicAuthGate, clientIpFrom, FailedAuthLimiter } from './middleware/auth.js';
import { hostAllowlist, mutatingRequestCheck, noStore, originCheck } from './middleware/hardening.js';
import { securityHeaders } from './middleware/headers.js';
import { NO_INPUT } from './routes/define.js';
import { HANDLERS } from './routes/index.js';
import {
  API_PREFIX,
  type AppEnv,
  type HttpToolRunners,
  OWNED_ELSEWHERE,
  type RawInput,
  type RouteContext,
} from './routes/types.js';
import { mountStatic } from './static.js';
import { API_TEXT } from './text.js';
import type { Ports } from './wiring.js';

export { API_PREFIX };

/** The largest request body the api reads (review SEC-1): a definition is a few kilobytes; nothing needs more. */
export const MAX_BODY_BYTES = 64 * 1024;

export interface AppOptions {
  /** Directory of the built SPA (`apps/web/dist`); null serves no static files. */
  webRoot?: string | null;
  tools?: HttpToolRunners;
  /** Source IP for the failed-auth limit; tests inject it, production derives it from the socket or the proxy. */
  clientIp?: (c: Context<AppEnv>) => string | null;
  /** The route table to mount; defaults to `apiContract.ROUTES`. Tests pass a modified table. */
  routes?: readonly apiContract.RouteDef[];
}

export function publicRouteKeys(routes: readonly apiContract.RouteDef[]): Set<string> {
  return new Set(routes.filter((r) => r.auth === 'public').map((r) => `${r.method} ${r.path}`));
}

/** The JSON body of a route that takes one: undefined when empty, a 400 envelope when it is not JSON. */
async function readBody(c: Context<AppEnv>): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await c.req.text();
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The single HTTP surface (spec §10): one Hono app mounting every ROUTES entry from `@gmt/core` api-contract (paths
 * carry `/api`), each body and query validated once by its handler against the entry's own schemas (decision 54), the
 * error envelope, the spec §4 hardening and the auth gate. A handler whose schemas are not its ROUTES entry's refuses
 * to build.
 */
export function createApp(ports: Ports, engine: Engine, options: AppOptions = {}): Hono<AppEnv> {
  const routes = options.routes ?? apiContract.ROUTES;
  const ctx: RouteContext = {
    ports,
    engine,
    tools: options.tools ?? {},
    busy: new Set(),
  };
  const app = new Hono<AppEnv>();
  app.onError(onError(ports.log, ports.secrets));
  app.notFound(notFound);
  const publicKeys = publicRouteKeys(routes);
  const isPublic = (c: Context<AppEnv>) => publicKeys.has(`${c.req.method} ${c.req.path}`);
  // why: ROUTES paths carry /api, so the public key is 'GET /api/health'.
  // Order (spec §4, decision 58): no-store first on API calls, so every API response carries it — the 401, 403, 413 and
  // 429 refusals included → headers on everything → Host → Origin → auth → body size, JSON + X-Requested-With.
  app.use(`${API_PREFIX}/*`, noStore());
  app.use('*', securityHeaders());
  app.use('*', hostAllowlist(ports.config, isPublic, ports.log));
  app.use('*', originCheck(ports.config, isPublic));
  app.use(
    '*',
    basicAuthGate({
      config: ports.config,
      publicKeys,
      limiter: new FailedAuthLimiter(ports.clock),
      clientIp: options.clientIp ?? clientIpFrom(ports.config),
    }),
  );
  app.use(
    `${API_PREFIX}/*`,
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(envelope('body_too_large', API_TEXT.bodyTooLarge), 413),
    }),
  );
  app.use(`${API_PREFIX}/*`, mutatingRequestCheck());
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const handler = HANDLERS[key];
    // why: Task 8.15 makes mounting strict once every handler exists; until then an unmapped entry answers 404.
    if (handler === undefined || OWNED_ELSEWHERE.has(key)) continue;
    // why: the handler validates with the schemas it was typed against; they must be the entry's own objects.
    if (handler.request !== (route.request ?? NO_INPUT) || handler.query !== (route.query ?? NO_INPUT))
      throw new Error(`handler for ${key} validates with schemas other than its ROUTES entry's`);
    app.on(route.method, route.path, async (c) => {
      let body: unknown;
      if (route.request !== undefined) {
        const read = await readBody(c);
        if (!read.ok) return c.json(envelope('validation', API_TEXT.malformedJson), 400);
        body = read.value;
      }
      const raw: RawInput = {
        body,
        query: route.query === undefined ? undefined : c.req.query(),
        params: c.req.param(),
      };
      return handler.handle(c, raw, ctx);
    });
  }
  if (options.webRoot) mountStatic(app, options.webRoot);
  return app;
}
```

`apps/api/src/bootstrap/errors.ts` (new file):

```ts
/** The one boot-refusal error (plan decision 58): the app bootstrap and the lock wait throw it; start.ts exits with its code. */
export class BootError extends Error {
  /** The plan's single exit-code table (`EXIT`): 70, 73, 74, 75, 78; 1 for anything else. */
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'BootError';
    this.exitCode = exitCode;
  }
}
```

`apps/api/src/bootstrap/paths.ts` (new file):

```ts
/** Where the app bootstrap finds its assets (spec §7 migrations and airports, §13 the built SPA). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIRPORTS_DATA_DIR, MIGRATIONS_DIR } from '@gmt/db';

export interface AssetPaths {
  migrationsDir: string;
  airportsDataDir: string;
  /** The built SPA, or null when `apps/web/dist/index.html` is absent (an api-only run). */
  webRoot: string | null;
}

/**
 * The db package's committed migrations and airports data (its own exported paths, valid from src/ and dist/), and the
 * web build. why: src/bootstrap (tsx) and dist/bootstrap (build) are both three levels below `apps/`, so one relative
 * URL serves dev, tests and the image (WP12 keeps the layout). The fixture tree is buildPorts' default
 * (`defaultFixtureRoot()`), wired only under the synthetic gate.
 */
export function assetPaths(): AssetPaths {
  const web = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  return {
    migrationsDir: MIGRATIONS_DIR,
    airportsDataDir: AIRPORTS_DATA_DIR,
    webRoot: existsSync(join(web, 'index.html')) ? web : null,
  };
}
```

`apps/api/src/bootstrap/lock.ts` (new file):

```ts
/** Spec §7 `app_lock` for the app holder, judged read-only before anything touches the database (plan decision 53). */
import type { Clock, Logger, Secret } from '@gmt/core';
import { readOnlyLockState } from '@gmt/db';
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
import { BootError } from './errors.js';

/** Spec §7: a fresh tool lock makes the app wait up to 60 s, then refuse. */
export const TOOL_LOCK_WAIT_MS = 60_000;
/**
 * Spec §7: a fresh app lock is waited on up to 90 s (three missed 30 s beats): a crashed app's lock goes stale inside
 * that time; one still being heartbeated after it belongs to a second live app, which is refused (decision 53).
 */
export const APP_LOCK_WAIT_MS = 90_000;
export const LOCK_POLL_MS = 1_000;
const LOG_EVERY_MS = 10_000;

export interface LockWaitDeps {
  databasePath: string;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: Logger;
  secrets: readonly Secret[];
}

const seconds = (v: number): number => Math.round(v / 1000);

/**
 * Plan decision 53: before any backup or migration, the app reads `app_lock` read-only (WP3's `readOnlyLockState`, as
 * the record tool does) and waits while it is fresh — up to 60 s for a tool, 90 s for another app — polling every
 * second and logging the holder and the lock's age every 10 s; it returns once the lock is absent or stale, and refuses
 * with 75 when the wait runs out. A second app started against a live one therefore never backs up or migrates. The
 * lock itself is taken after the migrations, when the table is sure to exist (`AppLock.acquire`, which also catches a
 * process that took it in between). why: not `AppLock.acquire`'s own wait (review arch-006): acquire writes the lock
 * row, so it needs the migrated table, and the point of decision 53 is that nothing writes before the lock is judged.
 */
export async function waitForLockFree(d: LockWaitDeps): Promise<void> {
  const started = Date.parse(d.clock.now());
  let lastLogAt = Number.NEGATIVE_INFINITY;
  for (;;) {
    let state: ReturnType<typeof readOnlyLockState>;
    try {
      state = readOnlyLockState(d.databasePath, d.clock);
    } catch (e) {
      throw new BootError(
        `cannot read app_lock in ${d.databasePath}: ${safeMessage(e, d.secrets)}; refusing (spec §7)`,
        EXIT.preflightImpossible,
      );
    }
    if (state.state !== 'fresh') return;
    const now = Date.parse(d.clock.now());
    const waited = now - started;
    const lockAgeMs = now - Date.parse(state.heartbeatAt);
    const limit = state.holder === 'tool' ? TOOL_LOCK_WAIT_MS : APP_LOCK_WAIT_MS;
    // why: strictly past the limit: WP3 calls a lock fresh up to and including 90 s, so a crashed app's lock taken as
    // the wait began turns stale on the next poll after 90 s, not on the poll at 90 s.
    if (waited > limit)
      throw new BootError(
        state.holder === 'tool'
          ? `app_lock is held by a tool process (heartbeat ${seconds(lockAgeMs)}s ago); waited ${seconds(waited)}s; start the app when the tool has finished`
          : `app_lock is held by another app process that is still heartbeating (${seconds(lockAgeMs)}s ago); refusing to start a second app`,
        EXIT.lockRefused,
      );
    if (waited - lastLogAt >= LOG_EVERY_MS) {
      d.log.warn({ holder: state.holder, lockAgeMs, waitedMs: waited }, 'waiting for app_lock');
      lastLogAt = waited;
    }
    await d.sleep(LOCK_POLL_MS);
  }
}
```

`apps/api/src/bootstrap/seed.ts` (new file):

```ts
/** Spec §7 airport seeding, shared by the app and the tool bootstraps (review arch-007). */
import { loadAirportsDataset, seedAirports } from '@gmt/db';
import type { Ports } from '../wiring.js';

/**
 * Seeds after migration when the `airports` table is empty or the vendored dataset's version changed; local files, no
 * network (spec §7). `report` receives one line when it seeds.
 */
export function seedIfNeeded(ports: Ports, dataDir: string, report: (line: string) => void): void {
  const dataset = loadAirportsDataset(dataDir);
  if (ports.repos.airports.count() > 0 && ports.repos.airports.datasetVersion() === dataset.version) return;
  const r = seedAirports(ports.db, dataset);
  report(`airports seeded: ${r.inserted} rows, dataset ${r.datasetVersion}`);
}
```

`apps/api/src/bootstrap/app.ts` (new file):

```ts
/**
 * The app bootstrap (spec §4, §5.5, §7, §12, §13): the process that serves the API and the SPA and runs the engine.
 * Order (plan "Wiring and bootstraps", decisions 53, 58): refuse NODE_ENV=test → re-assert the auth invariants → data
 * directory writable → `app_lock` read-only, waiting while it is fresh → backup preflight when migrations are pending
 * (WP4b's preflight.ts, decision 32) → buildPorts (migrations) → `AppLock('app')` and the 30 s heartbeat → seed +
 * airport sanity check under the lock (as the tool bootstrap seeds) → createEngine → engine.boot() → serve. Shutdown: stop accepting → engine.shutdown() →
 * wal_checkpoint(TRUNCATE) → lock release → close (spec §7 order). A boot that fails after taking the lock releases
 * it and stops the heartbeat before the database closes.
 */
import { type Clock, type Config, type Logger, type Secret, systemClock } from '@gmt/core';
import { AppLock, HEARTBEAT_INTERVAL_MS, sanityCheckAirports } from '@gmt/db';
import { createEngine, type Engine, LogNotifier } from '@gmt/engine';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import type { AppEnv, HttpToolRunners } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';
import { BootError } from './errors.js';
import { waitForLockFree } from './lock.js';
import { type AssetPaths, assetPaths } from './paths.js';
import { backupBeforeMigrations, dataDirRefusal } from './preflight.js';
import { seedIfNeeded } from './seed.js';

export interface BootDeps {
  config: Config;
  log: Logger;
  clock?: Clock;
  /** false in tests that drive the app with `app.request()`. */
  listen: boolean;
  assets: AssetPaths;
  /** Builds the in-process tool runners once ports exist (`main` passes `inProcessTools`). */
  tools?: (ports: Ports) => HttpToolRunners;
  /** Injected by tests to advance a fixed clock instead of waiting for app_lock. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunningApp {
  app: Hono<AppEnv>;
  ports: Ports;
  engine: Engine;
  port: number | null;
  close(): Promise<void>;
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;

/**
 * Spec §4, review SEC-3: the invariants `loadConfigFromEnv` enforces, re-asserted on the injected config, so no caller
 * of `bootApp` can serve without auth on a public bind or with no allowed host. 78, as a config error.
 */
export function assertAuthInvariants(config: Config, log: Logger): void {
  if (config.allowedHosts.length === 0)
    throw new BootError('ALLOWED_HOSTS is empty; refusing to serve', EXIT.badConfig);
  if (config.auth !== null && config.auth.pass.reveal().length < 12)
    throw new BootError('APP_BASIC_AUTH_PASS must be at least 12 characters', EXIT.badConfig);
  if (config.auth === null && !LOOPBACK.test(config.bindAddress)) {
    if (!config.allowUnauthenticated)
      throw new BootError(
        `binding ${config.bindAddress} without auth needs ALLOW_UNAUTHENTICATED=true (spec §4)`,
        EXIT.badConfig,
      );
    log.warn(
      { bindAddress: config.bindAddress },
      'serving without auth on a non-loopback bind (ALLOW_UNAUTHENTICATED)',
    );
  }
}

function listen(app: Hono<AppEnv>, config: Config): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindAddress }, (info) =>
      resolve({ server, port: info.port }),
    );
    server.once('error', reject);
  });
}

function closeServer(server: ServerType | null): Promise<void> {
  return new Promise((resolve) => (server === null ? resolve() : server.close(() => resolve())));
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Everything the app process does at start, with config injected (spec §5.5 boot matrix), in the order above. Every
 * refusal carries the plan's exit code: 70 NODE_ENV=test, 78 a broken auth invariant, 73 an unwritable data or
 * backups directory or an unreadable lock, 75 app_lock held by a live process, 74 a failed backup, 1 anything else.
 */
export async function bootApp(deps: BootDeps): Promise<RunningApp> {
  const { config, log } = deps;
  const clock = deps.clock ?? systemClock;
  const secrets: readonly Secret[] = collectSecrets(config);
  // why: spec §5.5: both bootstraps refuse NODE_ENV=test, so a test config can never serve traffic.
  if (config.nodeEnv === 'test')
    throw new BootError('the app bootstrap refuses NODE_ENV=test (spec §5.5)', EXIT.refusedTestEnv);
  assertAuthInvariants(config, log);
  const dataDir = dataDirRefusal(config.databasePath);
  if (dataDir !== null) throw new BootError(dataDir, EXIT.preflightImpossible);
  await waitForLockFree({
    databasePath: config.databasePath,
    clock,
    sleep: deps.sleep ?? realSleep,
    log,
    secrets,
  });
  const backup = backupBeforeMigrations(config.databasePath, deps.assets.migrationsDir, clock, secrets);
  if (!backup.ok) throw new BootError(backup.message, backup.code);
  if (backup.line !== null) log.info({}, backup.line);
  const ports = buildPorts(config, { log, clock, migrationsDir: deps.assets.migrationsDir });
  const lock = new AppLock(ports.db, 'app', clock, log);
  let heartbeat: NodeJS.Timeout | null = null;
  try {
    // why: plan decision 58: the lock is taken right after the migrations, as the tool bootstrap takes it, so airports are
    // seeded under it. The read-only wait found it free; a process that took it since is caught here, without a wait.
    if (lock.acquire({ waitMs: 0 }) === 'refused')
      throw new BootError(
        'app_lock was taken by another process during boot; refusing to start',
        EXIT.lockRefused,
      );
    heartbeat = setInterval(() => {
      try {
        lock.heartbeat();
      } catch (e) {
        // why: a throw inside a timer would kill the process with executions running; log it and keep serving reads.
        log.error({ err: { message: safeMessage(e, secrets) } }, 'app_lock heartbeat failed');
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    seedIfNeeded(ports, deps.assets.airportsDataDir, (line) => log.info({}, line));
    // Spec §7: at least 5,000 airports with tz, and every airport an enabled definition references exists.
    const referenced = ports.repos.definitions
      .list()
      .filter((d) => d.enabled)
      .flatMap((d) => [...d.origins, ...d.destinations]);
    const sanity = sanityCheckAirports(ports.db, referenced);
    if (!sanity.ok) throw new BootError(`airport sanity check failed: ${sanity.reason}`, EXIT.failed);
    // why: WP11 adds `{ alerts: runAlerts }` to these options; until then the engine's default noAlerts step runs.
    const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
    await engine.boot();
    const app = createApp(ports, engine, { webRoot: deps.assets.webRoot, tools: deps.tools?.(ports) ?? {} });
    const bound = deps.listen ? await listen(app, config) : null;
    const beat = heartbeat;
    let closed = false;
    return {
      app,
      ports,
      engine,
      port: bound?.port ?? null,
      close: async () => {
        if (closed) return;
        closed = true;
        await closeServer(bound?.server ?? null); // stop accepting
        await engine.shutdown();
        clearInterval(beat);
        // why: spec §7 releases the lock after the checkpoint; db.close() checkpoints again, harmlessly.
        ports.db.raw.pragma('wal_checkpoint(TRUNCATE)');
        lock.release();
        ports.db.close();
        log.info({}, 'shutdown complete');
      },
    };
  } catch (err) {
    // why: review arch-008: a boot that failed after the lock was taken must not leave it fresh for 90 s or a heartbeat
    // firing against a closed database.
    if (heartbeat !== null) clearInterval(heartbeat);
    // why: WP3's release deletes only the row this AppLock acquired, so a refused acquire leaves the holder's lock alone.
    lock.release();
    ports.db.close();
    throw err;
  }
}

/** The app entrypoint: env parsed once (spec §12), boot, signals. Throws on refusal; start.ts exits with its code. */
export async function main(env: NodeJS.ProcessEnv): Promise<void> {
  let config: Config;
  try {
    config = loadConfigFromEnv(env);
  } catch (err) {
    if (err instanceof InvalidConfigError) throw new BootError(err.message, EXIT.badConfig);
    throw err;
  }
  const secrets = collectSecrets(config);
  const log = createLogger(config, { secrets });
  let running: RunningApp;
  try {
    running = await bootApp({
      config,
      log,
      listen: true,
      assets: assetPaths(),
    });
  } catch (err) {
    log.error({ err: { message: safeMessage(err, secrets) } }, 'boot failed');
    throw err;
  }
  log.info({ port: running.port, bindAddress: config.bindAddress }, 'listening');
  const stop = (signal: string) => {
    log.info({ signal }, 'shutting down');
    running.close().then(
      () => process.exit(EXIT.ok),
      (err: unknown) => {
        log.error({ err: { message: safeMessage(err, secrets) } }, 'shutdown failed');
        process.exit(EXIT.failed);
      },
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
```

`apps/api/src/bootstrap/start.ts` (new file):

```ts
/** The app process entry (`pnpm --filter @gmt/api start`, `dev`, and the WP12 image CMD). The one process.env read. */
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
import { main } from './app.js';
import { BootError } from './errors.js';

main(process.env).catch((err: unknown) => {
  // why: boot errors are already URL- and secret-free; a stray error is stripped of URLs here before it is printed.
  process.stderr.write(`${safeMessage(err, [])}\n`);
  // why: a BootError carries the plan's exit code (70, 73, 74, 75, 78); anything else is 1.
  process.exit(err instanceof BootError ? err.exitCode : EXIT.failed);
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.spawn.test.ts test/defaults.test.ts test/bootstrap/tool.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS: 6 tests in the two new files (the child logs `"msg":"listening"`, the probe's `GET /api/providers` is 200 without `fixture` and with `synthetic: false`, the child exits 0 on SIGTERM, the fixture constructor and the synthetic insert both throw, the refusals exit 70 and 78), and WP4b's 47 tool-bootstrap tests still pass over the shared seeding; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: the app bootstrap with decision 53's lock-first order, the server core and the production-boot-lacks-fixture spawn test"
```

### Task 8.2: The route-test helpers; the injected-config boot matrix, `NODE_ENV=test` refusal, auth invariants, data directory, password length, airport sanity check

**Files:**
- Test: `apps/api/test/bootstrap/app.matrix.test.ts`
- Create: `apps/api/test/helpers/harness.ts`, `apps/api/test/helpers/contract.ts`, `apps/api/test/helpers/examples.ts`

**Interfaces:**
- Consumes: `bootApp`, `createApp` (Task 8.1); `buildPorts` under `NODE_ENV=test` and `:memory:`, `loadConfigFromEnv`, `cleanEnv`, `SENTINEL_AUTH` (WP4b); `createEngine`, `LogNotifier` (WP7); `fixtureProvider` (WP4); the vendored airports files under `AIRPORTS_DATA_DIR` (WP3). Produces (test-only): `createHarness`, `Harness`, `harnessEnv`, `captureLines`, `basic`, `T0`, `HOST`, `AUTH_USER` — real ports over an in-memory database seeded with the London and New York metro members only (review TS-4: each route test builds a harness in milliseconds instead of loading the full airports table; boot tests seed the full table and name their own `BOOT_TIMEOUT_MS`), the engine, the fixture provider reached in-process through http-kit's gated `inProcessHosts` seam, the app driven with `app.request()`, and an `afterEach` that closes every harness a test opened, idempotently, so no file leaks a database on a failure path (review TS-8); `expectContract(res, method, path, schema)` (parses the body against its ROUTES entry and returns it typed, so no test casts a body), `expectEnvelopeOrContract`, `errorOf`; `exampleDefinitionInput`, `SMALL_WINDOW`, `LHR`, `LGW`, `JFK`, `EWR`.

Rules (spec §5.5, §4, §7; review TS-5): the gate decides whether `fixture` is offered, through `GET /api/providers` and the ports alike, for production with and without the phrase, development in and out of a container, the wrong phrase, and a plain `.db` path; outside the gate the fixture constructor throws; `NODE_ENV=test` is refused before the database is touched (70); `bootApp` re-asserts the auth invariants on an injected config — a public bind without auth, an empty `ALLOWED_HOSTS`, a password under 12 characters (review SEC-R2-2) — with 78, and accepts `ALLOW_UNAUTHENTICATED=true` with a warning; config refuses no auth on a public bind and a half-set credential pair; an unwritable data directory is 73; a password under 12 characters is a config error naming `APP_BASIC_AUTH_PASS`; a failed airport sanity check fails boot (1). Task 8.9 adds the matrix row that needs the definitions route.

- [ ] **Step 1: Write the test**

`apps/api/test/helpers/harness.ts` (new file):

```ts
// The route-test harness (spec §9 item 5): real ports over an in-memory database (NODE_ENV=test + :memory:, which
// syntheticAllowed admits), the engine, and the fixture provider reached through http-kit's gated inProcessHosts seam
// (buildPorts wires it), so no request leaves the process and no msw is imported here.
import { Writable } from 'node:stream';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import {
  AIRPORTS_DATA_DIR,
  type AirportsDataset,
  loadAirportsDataset,
  MIGRATIONS_DIR,
  seedAirports,
} from '@gmt/db';
import { createEngine, type Engine, LogNotifier } from '@gmt/engine';
import type { Hono } from 'hono';
import { afterEach } from 'vitest';
import { type AppOptions, createApp } from '../../src/app.js';
import { createLogger } from '../../src/logger.js';
import type { AppEnv } from '../../src/routes/types.js';
import { buildPorts, collectSecrets, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from './env.js';

/** The harness clock starts here; every seeded timestamp is relative to it. */
export const T0 = asIsoDateTime('2026-10-14T09:00:00.000Z');
export const HOST = 'localhost:3000';
export const AUTH_USER = 'operator';

/** A stream that appends every written chunk to `lines` (the logger's destination in tests). */
export function captureLines(lines: string[]): Writable {
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
}

export function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
  /** false: send no Authorization header. */
  auth?: boolean;
  /** false: do not add Content-Type and X-Requested-With to a mutating request. */
  csrf?: boolean;
}

export interface Harness {
  ports: Ports;
  engine: Engine;
  app: Hono<AppEnv>;
  clock: ReturnType<typeof fixedClock>;
  logLines: string[];
  request(path: string, o?: RequestOptions): Promise<Response>;
  close(): Promise<void>;
}

/** The harness environment: every variable blank (= unset, spec §12), then the test values and the overrides. */
export function harnessEnv(env: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: AUTH_USER,
    APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    // why: the fixture provider is billable at its test cost (spec §5.3), so the harness gives it headroom.
    EXECUTION_MAX_CALLS: '1000',
    MONTHLY_SPEND_CAP_PENCE: '1000',
    LOG_LEVEL: 'debug',
    ...env,
  });
}

/**
 * The airports a route test needs: every airport of the worked example's metros (London, New York), parsed once per
 * test file. why: route tests never run the 5,000-row sanity check (the boot tests seed the full table), and seeding
 * the full table into every in-memory harness made the suite slow enough to time out on a loaded machine (review
 * TS-4); with the metros' members present, metro-code validation and the airports route behave as with the full table.
 */
let dataset: AirportsDataset | undefined;
function routeTestAirports(): AirportsDataset {
  if (dataset !== undefined) return dataset;
  const full = loadAirportsDataset(AIRPORTS_DATA_DIR);
  const keep = new Set([...(full.metros.LON ?? []), ...(full.metros.NYC ?? [])]);
  dataset = { ...full, airports: full.airports.filter((a) => keep.has(a.iata)) };
  return dataset;
}

/** Every harness still open; closed after each test whatever the test did (review TS-8). */
const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});

export async function createHarness(
  opts: { env?: Record<string, string>; app?: AppOptions } = {},
): Promise<Harness> {
  const config = loadConfigFromEnv(harnessEnv(opts.env));
  const logLines: string[] = [];
  const log = createLogger(config, { destination: captureLines(logLines), secrets: collectSecrets(config) });
  const clock = fixedClock(T0);
  const ports = buildPorts(config, { log, clock, migrationsDir: MIGRATIONS_DIR });
  seedAirports(ports.db, routeTestAirports());
  const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
  await engine.boot();
  const app = createApp(ports, engine, { webRoot: null, ...opts.app });
  let closed = false;
  const harness: Harness = {
    ports,
    engine,
    app,
    clock,
    logLines,
    request: async (path, o = {}) => {
      const method = o.method ?? (o.json !== undefined ? 'POST' : 'GET');
      const headers = new Headers({ host: HOST, ...o.headers });
      if (o.auth !== false && !headers.has('authorization'))
        headers.set('authorization', basic(AUTH_USER, SENTINEL_AUTH));
      if (method !== 'GET' && o.csrf !== false) {
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'get-me-there');
      }
      const body = o.json !== undefined ? JSON.stringify(o.json) : o.body;
      return app.request(`http://${HOST}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await engine.shutdown();
      ports.db.close();
    },
  };
  open.push(harness);
  return harness;
}
```

`apps/api/test/helpers/contract.ts` (new file):

```ts
// Spec §9 item 5: every route is tested against core/api-contract. Bodies are parsed, never cast.
import { apiContract } from '@gmt/core';
import { expect } from 'vitest';
import type { z } from 'zod';

function routeOf(method: string, path: string): apiContract.RouteDef {
  const route = apiContract.ROUTES.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no ROUTES entry ${method} ${path}`);
  return route;
}

/** Parses a 2xx body against its ROUTES entry and against `schema` (the shape the test reads), returning it typed. */
export async function expectContract<S extends z.ZodType>(
  res: Response,
  method: string,
  path: string,
  schema: S,
): Promise<z.output<S>> {
  const body: unknown = await res.clone().json();
  expect(res.ok, `${method} ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 500)}`).toBe(true);
  const route = routeOf(method, path).response.safeParse(body);
  if (!route.success)
    throw new Error(
      `${method} ${path} breaks the contract: ${JSON.stringify(route.error.issues).slice(0, 2000)}`,
    );
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      `${method} ${path} does not match the test schema: ${JSON.stringify(parsed.error.issues).slice(0, 2000)}`,
    );
  return parsed.data;
}

/** Any body against its ROUTES entry (2xx) or the error envelope (otherwise); the sweep's form. */
export async function expectEnvelopeOrContract(
  res: Response,
  method: string,
  path: string,
): Promise<unknown> {
  const body: unknown = await res.clone().json();
  const schema = res.ok ? routeOf(method, path).response : apiContract.errorEnvelopeSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      `${method} ${path} → ${res.status} breaks the contract: ${JSON.stringify(parsed.error.issues).slice(0, 2000)}`,
    );
  return body;
}

/** The error envelope of a non-2xx response (spec §10). */
export async function errorOf(
  res: Response,
): Promise<z.output<typeof apiContract.errorEnvelopeSchema>['error']> {
  return apiContract.errorEnvelopeSchema.parse(await res.json()).error;
}
```

`apps/api/test/helpers/examples.ts` (new file):

```ts
// The worked example (London → New York; brief README), sized for route tests; the fixture provider in both stages.
import { asIata, asIsoDate, type DefinitionInput } from '@gmt/core';

export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');

/** A small window near the harness clock: 2026-11-02 … 2026-11-05 departures, 10–21 nights. */
export const SMALL_WINDOW = {
  kind: 'absolute',
  from: asIsoDate('2026-11-02'),
  to: asIsoDate('2026-11-05'),
} as const;

export function exampleDefinitionInput(overrides: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: 'London to New York',
    origins: [LHR],
    destinations: [JFK],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: {},
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 1000, maxFreeCalls: 2000, maxCostMicroGbp: 10_000_000 },
    providers: { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: { fixture: 168 } },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: true,
    ...overrides,
  };
}
```

`apps/api/test/bootstrap/app.matrix.test.ts` (new file):

```ts
// Spec §5.5 injected-config boot matrix; spec §4 password length and auth invariants; spec §7 the airport sanity check.
import { chmodSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { apiContract, FIXTURE_OPT_IN_PHRASE, Secret, systemClock } from '@gmt/core';
import { fixtureProvider } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp, type RunningApp } from '../../src/bootstrap/app.js';
import { type AssetPaths, assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, silentLog } from '../helpers/env.js';
import { basic, captureLines } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

function envFor(overrides: Record<string, string>): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'production',
    DATABASE_PATH: join(tempDir('gmt-matrix-'), 'm.fixture.db'),
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
    LOG_LEVEL: 'error',
    ...overrides,
  });
}

function bootWith(env: Record<string, string>, assets: AssetPaths = assetPaths()): Promise<RunningApp> {
  return bootApp({
    config: loadConfigFromEnv(env),
    log: createLogger({ logLevel: 'error' }),
    listen: false,
    assets,
  });
}

/** Each boot seeds the full airports table; this file's tests may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

describe('injected-config boot matrix (spec §5.5)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it.each([
    // label, env overrides, fixture offered?
    ['production with the phrase and .fixture.db: no fixture', {}, false],
    ['production without the phrase: no fixture', { ALLOW_FIXTURE_PROVIDER: '' }, false],
    [
      'development, phrase, .fixture.db, not in a container: fixture offered',
      { NODE_ENV: 'development' },
      true,
    ],
    ['development in a container: no fixture', { NODE_ENV: 'development', IN_CONTAINER: '1' }, false],
    [
      'development with the wrong phrase: no fixture',
      { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: 'yes' },
      false,
    ],
    [
      'development without the phrase: no fixture',
      { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: '' },
      false,
    ],
  ] as const)('%s', async (_label, overrides, expected) => {
    const running = await bootWith(envFor(overrides));
    try {
      expect(running.ports.providers.some((p) => p.id === 'fixture')).toBe(expected);
      const res = await running.app.request('http://localhost:3000/api/providers', {
        headers: { host: 'localhost:3000', authorization: basic('operator', SENTINEL_AUTH) },
      });
      expect(res.status).toBe(200);
      const body = apiContract.providersResponseSchema.parse(await res.json());
      expect(body.providers.some((p) => p.providerId === 'fixture')).toBe(expected);
      expect(body.synthetic).toBe(expected);
      if (!expected) {
        // why: spec §5.5: outside the gate the fixture provider cannot even be built
        expect(() =>
          fixtureProvider({
            http: running.ports.http,
            log: silentLog,
            clock: systemClock,
            config: running.ports.config,
            costMicroGbp: 0,
          }),
        ).toThrow();
      }
    } finally {
      await running.close();
    }
  });

  it('development with the phrase but a plain .db path offers no fixture', async () => {
    const env = envFor({ NODE_ENV: 'development' });
    const running = await bootWith({
      ...env,
      DATABASE_PATH: String(env.DATABASE_PATH).replace('.fixture.db', '.db'),
    });
    try {
      expect(running.ports.providers.some((p) => p.id === 'fixture')).toBe(false);
    } finally {
      await running.close();
    }
  });

  it('refuses NODE_ENV=test before touching the database (exit 70)', async () => {
    const env = envFor({ NODE_ENV: 'test' });
    const path = String(env.DATABASE_PATH).replace('.fixture.db', '.test.db');
    await expect(bootWith({ ...env, DATABASE_PATH: path })).rejects.toMatchObject({
      exitCode: 70,
      message: expect.stringMatching(/NODE_ENV=test/),
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'an unwritable data directory fails boot with exit code 73',
    async () => {
      const env = envFor({});
      const dir = dirname(String(env.DATABASE_PATH));
      chmodSync(dir, 0o500);
      await expect(bootWith(env)).rejects.toMatchObject({ exitCode: 73 });
    },
  );

  it('auth invariants (spec §4, review SEC-3): config refuses no auth on a public bind and a half-set pair', () => {
    expect(() =>
      loadConfigFromEnv(
        envFor({ BIND_ADDRESS: '0.0.0.0', APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' }),
      ),
    ).toThrow(/ALLOW_UNAUTHENTICATED/);
    expect(() => loadConfigFromEnv(envFor({ APP_BASIC_AUTH_PASS: '' }))).toThrow(/APP_BASIC_AUTH_PASS/);
  });

  it('bootApp re-asserts them on an injected config (78): public bind, no host, short password; the explicit flag warns', async () => {
    const env = envFor({ APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' });
    const loopback = loadConfigFromEnv(env);
    const forged = { ...loopback, bindAddress: '0.0.0.0' };
    const boot = (config: typeof loopback, lines: string[] = []) =>
      bootApp({
        config,
        log: createLogger({ logLevel: 'warn' }, { destination: captureLines(lines) }),
        listen: false,
        assets: assetPaths(),
      });
    await expect(boot(forged)).rejects.toMatchObject({ exitCode: 78 });
    await expect(boot({ ...loopback, allowedHosts: [] })).rejects.toMatchObject({ exitCode: 78 });
    // why: review SEC-R2-2: the short-password branch on an injected config, which loadConfigFromEnv never builds
    await expect(
      boot({ ...loopback, auth: { user: 'operator', pass: new Secret('elevenchars') } }),
    ).rejects.toMatchObject({ exitCode: 78, message: expect.stringMatching(/APP_BASIC_AUTH_PASS/) });
    const lines: string[] = [];
    const running = await boot({ ...forged, allowUnauthenticated: true }, lines);
    await running.close();
    expect(lines.join('')).toContain('ALLOW_UNAUTHENTICATED');
  });

  it('a password shorter than 12 characters fails boot naming the variable', () => {
    expect(() => loadConfigFromEnv(envFor({ APP_BASIC_AUTH_PASS: 'elevenchars' }))).toThrow(
      /APP_BASIC_AUTH_PASS/,
    );
  });

  it('a failed airport sanity check fails boot (exit 1)', async () => {
    // why: the vendored files cut to ten airports, far below the 5,000 the check requires (spec §7).
    const source = assetPaths().airportsDataDir;
    const file = readdirSync(source).find((f) => /^airports\..+\.json$/.test(f)) ?? '';
    const real = z
      .looseObject({ airports: z.array(z.unknown()) })
      .parse(JSON.parse(readFileSync(join(source, file), 'utf8')));
    const dataDir = tempDir('gmt-airports-');
    writeFileSync(
      join(dataDir, 'airports.tiny.json'),
      JSON.stringify({ ...real, airports: real.airports.slice(0, 10) }),
    );
    copyFileSync(join(source, 'metros.json'), join(dataDir, 'metros.json'));
    await expect(bootWith(envFor({}), { ...assetPaths(), airportsDataDir: dataDir })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(/airport sanity check failed/),
    });
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.matrix.test.ts` once per mutation below, each applied alone and then reverted.

- **8.2a**: in `apps/api/src/bootstrap/app.ts` replace

```ts
  if (config.nodeEnv === 'test')
    throw new BootError('the app bootstrap refuses NODE_ENV=test (spec §5.5)', EXIT.refusedTestEnv);
```

  with nothing.
  Fails: “refuses NODE_ENV=test before touching the database (exit 70)”.

- **8.2b**: in `apps/api/src/bootstrap/app.ts` delete the line `assertAuthInvariants(config, log);`. Fails: “bootApp re-asserts them on an injected config (78): public bind, no host, short password; the explicit flag warns”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.matrix.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: route-test helpers; boot matrix, NODE_ENV=test refusal, auth invariants, data directory, password length and airport sanity tests"
```

### Task 8.3: `app_lock` judged read-only before anything touches the database

**Files:**
- Test: `apps/api/test/bootstrap/app.lock.test.ts`

**Interfaces:**
- Consumes: `waitForLockFree`, `TOOL_LOCK_WAIT_MS`, `APP_LOCK_WAIT_MS` (Task 8.1); `readOnlyLockState`, `AppLock`, `applyMigrations`, `openDatabase` (WP3); `fixedClock` (core).

Rule (spec §7, decision 53): poll every second, read-only. No lock, or no database file yet: proceed at once. A fresh `tool` lock: refuse once 60 s have passed (75), or proceed as soon as the tool releases. A fresh `app` lock: wait, logging its age every 10 s; proceed once it goes stale (a crashed app's three missed 30 s beats); if it is still being heartbeated after 90 s, refuse (two live apps, 75). A file that is not a database: 73. The tests run against a real migrated file and sleep by advancing a fixed clock, heartbeating or releasing the other holder from the sleep.

- [ ] **Step 1: Write the test**

`apps/api/test/bootstrap/app.lock.test.ts` (new file):

```ts
// Spec §7 app_lock and plan decision 53: the app reads the lock read-only before any backup or migration, waits while
// it is fresh (60 s for a tool, 90 s for another app), takes over a stale one, and refuses a live second app with 75.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { AppLock, applyMigrations, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { APP_LOCK_WAIT_MS, TOOL_LOCK_WAIT_MS, waitForLockFree } from '../../src/bootstrap/lock.js';
import { createLogger } from '../../src/logger.js';
import { silentLog } from '../helpers/env.js';
import { captureLines, T0 } from '../helpers/harness.js';
import { onCleanup, tempDir } from '../helpers/tmp.js';

/** A migrated database file, a fixed clock, and a sleep that advances it and runs `onSleep` (a heartbeat, a release). */
function setup(onSleep: (totalMs: number) => void = () => {}) {
  const databasePath = join(tempDir('gmt-lock-'), 'app.db');
  const db = openDatabase(databasePath);
  applyMigrations(db, MIGRATIONS_DIR);
  onCleanup(() => db.close());
  const clock = fixedClock(T0);
  const lines: string[] = [];
  const log = createLogger({ logLevel: 'debug' }, { destination: captureLines(lines) });
  let slept = 0;
  const sleep = async (ms: number) => {
    slept += ms;
    clock.advance(ms);
    onSleep(slept);
  };
  const wait = () => waitForLockFree({ databasePath, clock, sleep, log, secrets: [] });
  const hold = (holder: 'app' | 'tool') => {
    const lock = new AppLock(db, holder, clock, silentLog);
    expect(lock.acquire({ waitMs: 0 })).toBe('acquired');
    return lock;
  };
  return { db, clock, lines, wait, hold, slept: () => slept };
}

describe('the read-only app_lock wait (spec §7, plan decision 53)', () => {
  it('returns at once when no lock is held, and for a file that does not exist yet', async () => {
    const s = setup();
    await s.wait();
    expect(s.slept()).toBe(0);
    await waitForLockFree({
      databasePath: join(tempDir(), 'none.db'),
      clock: s.clock,
      sleep: async () => undefined,
      log: silentLog,
      secrets: [],
    });
  });

  it('waits 60 s on a fresh tool lock, then refuses with exit code 75', async () => {
    let tool: AppLock | undefined;
    const s = setup(() => tool?.heartbeat());
    tool = s.hold('tool');
    await expect(s.wait()).rejects.toMatchObject({ exitCode: 75, message: expect.stringMatching(/tool/) });
    expect(s.slept()).toBeGreaterThanOrEqual(TOOL_LOCK_WAIT_MS);
    expect(s.slept()).toBeLessThan(TOOL_LOCK_WAIT_MS + 2_000);
  });

  it('proceeds as soon as a tool releases within the wait', async () => {
    let tool: AppLock | undefined;
    const s = setup((total) => (total >= 10_000 ? tool?.release() : tool?.heartbeat()));
    tool = s.hold('tool');
    await s.wait();
    expect(s.slept()).toBeGreaterThanOrEqual(10_000);
    expect(s.slept()).toBeLessThan(12_000);
  });

  it("proceeds once a crashed app's lock goes stale (no heartbeats), logging the lock's age", async () => {
    const s = setup();
    s.hold('app'); // the previous process, now dead
    await s.wait();
    expect(s.slept()).toBeGreaterThan(0);
    expect(s.slept()).toBeLessThanOrEqual(APP_LOCK_WAIT_MS + 1_000);
    expect(s.lines.some((l) => l.includes('"lockAgeMs"'))).toBe(true);
  });

  it('refuses a second app with 75 after 90 s while the first is still heartbeating', async () => {
    let other: AppLock | undefined;
    const s = setup(() => other?.heartbeat());
    other = s.hold('app');
    await expect(s.wait()).rejects.toMatchObject({
      exitCode: 75,
      message: expect.stringMatching(/still heartbeating/),
    });
    expect(s.slept()).toBeGreaterThanOrEqual(APP_LOCK_WAIT_MS);
  });

  it('a file that is not a database is 73, as in the tool bootstrap', async () => {
    const s = setup();
    const notDb = join(tempDir(), 'garbage.db');
    writeFileSync(notDb, 'not a database');
    await expect(
      waitForLockFree({
        databasePath: notDb,
        clock: s.clock,
        sleep: async () => undefined,
        log: silentLog,
        secrets: [],
      }),
    ).rejects.toMatchObject({ exitCode: 73 });
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.lock.test.ts` once per mutation below, each applied alone and then reverted.

- **8.3a**: in `apps/api/src/bootstrap/lock.ts` replace `const limit = state.holder === 'tool' ? TOOL_LOCK_WAIT_MS : APP_LOCK_WAIT_MS;` with `const limit = APP_LOCK_WAIT_MS;`. Fails: “waits 60 s on a fresh tool lock, then refuses with exit code 75”.

- **8.3b**: in `apps/api/src/bootstrap/lock.ts` replace

```ts
    if (state.state !== 'fresh') return;
```

  with

```ts
    if (state.state === 'absent') return;
```

  Fails: “proceeds once a crashed app's lock goes stale (no heartbeats), logging the lock's age”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.lock.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: read-only app_lock wait tests: 60 s on a tool lock, release, stale takeover, two live apps refused, unreadable file"
```

### Task 8.4: Backup preflight when migrations are pending, after the lock check

**Files:**
- Test: `apps/api/test/bootstrap/app.backup.test.ts`

**Interfaces:**
- Consumes: `bootApp` (Task 8.1); `backupsDirFor`, `pendingOnExistingDb` (WP4b `bootstrap/preflight.ts`, decision 32); WP3's `backupDatabase` behind it; `AppLock` (WP3).

Rule (spec §7 Migrations, §13; decision 53; review TS-2): the app bootstrap calls WP4b's `backupBeforeMigrations` before `buildPorts` applies anything, and only after the read-only lock check; a new database file has nothing to back up; a backup lands in `<db dir>/backups` and holds the pre-migration schema; a failed backup refuses boot with 74 and leaves the schema unmigrated; a backups path that is not a directory refuses with 73; a second app started against a live, heartbeating app lock with a migration pending refuses with 75 and leaves no backups directory and no migrated table. A probe migration (a copy of the committed migrations plus one newer journal entry) makes migrations pending without touching the committed tree.

- [ ] **Step 1: Write the test**

`apps/api/test/bootstrap/app.backup.test.ts` (new file):

```ts
// Spec §7 Migrations, §13 Backup: the app bootstrap reuses WP4b's preflight (plan decision 32).
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { AppLock, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { backupsDirFor, pendingOnExistingDb } from '../../src/bootstrap/preflight.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, silentLog } from '../helpers/env.js';
import { T0 } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

function config(dbPath: string) {
  return loadConfigFromEnv(
    cleanEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: dbPath,
      BIND_ADDRESS: '127.0.0.1',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
      LOG_LEVEL: 'error',
    }),
  );
}

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ when: z.number() })) });

/** A copy of the bundled migrations plus one journal entry newer than anything applied. */
function migrationsWithProbe(): string {
  const dir = join(tempDir('gmt-mig-'), 'drizzle');
  cpSync(assetPaths().migrationsDir, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = journalSchema.parse(JSON.parse(readFileSync(journalPath, 'utf8')));
  const last = journal.entries[journal.entries.length - 1] ?? { when: 0 };
  // why: drizzle orders by `when`; the probe must be newer than every committed migration, whatever their dates.
  const when = Math.max(...journal.entries.map((e) => e.when)) + 1_000;
  journal.entries.push({ ...last, idx: journal.entries.length, when, tag: '9999_wp8_probe' });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, '9999_wp8_probe.sql'), 'CREATE TABLE wp8_probe (id integer);');
  return dir;
}

function hasProbe(dbPath: string): boolean {
  const db = openDatabase(dbPath);
  try {
    return (
      db.raw.prepare("select name from sqlite_master where type = 'table' and name = 'wp8_probe'").get() !==
      undefined
    );
  } finally {
    db.close();
  }
}

async function bootOnce(dbPath: string, migrationsDir = assetPaths().migrationsDir): Promise<void> {
  const running = await bootApp({
    config: config(dbPath),
    log: createLogger({ logLevel: 'error' }),
    listen: false,
    assets: { ...assetPaths(), migrationsDir },
  });
  await running.close();
}

/** Each boot seeds the full airports table; this file's tests may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

describe('backup preflight (spec §7 Migrations, §13 Backup)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it('a database file that does not exist yet is migrated without a backup; an up-to-date one is not backed up', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    await bootOnce(dbPath);
    expect(pendingOnExistingDb(dbPath, assetPaths().migrationsDir)).toEqual([]);
    expect(readdirSync(join(dbPath, '..'))).not.toContain('backups');
  });

  it('backs up into <db dir>/backups before applying pending migrations; the backup has the old schema', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    const probeDir = migrationsWithProbe();
    expect(pendingOnExistingDb(dbPath, probeDir)).toEqual(['9999_wp8_probe']);
    await bootOnce(dbPath, probeDir);
    expect(hasProbe(dbPath)).toBe(true);
    const backups = readdirSync(backupsDirFor(dbPath));
    expect(backups).toHaveLength(1);
    expect(hasProbe(join(backupsDirFor(dbPath), backups[0] ?? ''))).toBe(false);
  });

  it('a failed backup refuses boot with exit code 74 and leaves the schema unmigrated', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    mkdirSync(backupsDirFor(dbPath));
    chmodSync(backupsDirFor(dbPath), 0o777); // why: WP3's backupDatabase refuses a world-writable backups directory
    await expect(bootOnce(dbPath, migrationsWithProbe())).rejects.toMatchObject({
      exitCode: 74,
      message: expect.stringMatching(/backup failed, refusing to migrate/),
    });
    expect(hasProbe(dbPath)).toBe(false);
  });

  it('a backups path that is not a directory refuses boot with exit code 73', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    writeFileSync(backupsDirFor(dbPath), 'not a directory');
    await expect(bootOnce(dbPath, migrationsWithProbe())).rejects.toMatchObject({ exitCode: 73 });
    expect(hasProbe(dbPath)).toBe(false);
  });

  it('a second app against a live app lock refuses with 75 and runs no backup or migration (plan decision 53)', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    const clock = fixedClock(T0);
    const live = openDatabase(dbPath);
    const first = new AppLock(live, 'app', clock, silentLog);
    expect(first.acquire({ waitMs: 0 })).toBe('acquired');
    try {
      const probeDir = migrationsWithProbe();
      expect(pendingOnExistingDb(dbPath, probeDir)).toEqual(['9999_wp8_probe']);
      await expect(
        bootApp({
          config: config(dbPath),
          log: createLogger({ logLevel: 'error' }),
          clock,
          listen: false,
          assets: { ...assetPaths(), migrationsDir: probeDir },
          // why: the first app keeps heartbeating while the second waits on the shared clock
          sleep: async (ms) => {
            clock.advance(ms);
            first.heartbeat();
          },
        }),
      ).rejects.toMatchObject({ exitCode: 75 });
      expect(existsSync(backupsDirFor(dbPath))).toBe(false);
      expect(hasProbe(dbPath)).toBe(false);
    } finally {
      first.release();
      live.close();
    }
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.backup.test.ts` once per mutation below, each applied alone and then reverted.

- **8.4a**: in `apps/api/src/bootstrap/app.ts` replace `if (!backup.ok) throw new BootError(backup.message, backup.code);` with `void backup;`. Fails: “a failed backup refuses boot with exit code 74 and leaves the schema unmigrated”; “a backups path that is not a directory refuses boot with exit code 73”.

- **8.4b**: in `apps/api/src/bootstrap/app.ts` replace

```ts
  await waitForLockFree({
    databasePath: config.databasePath,
    clock,
    sleep: deps.sleep ?? realSleep,
    log,
    secrets,
  });
```

  with nothing.
  Fails: “a second app against a live app lock refuses with 75 and runs no backup or migration (plan decision 53)”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.backup.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: backup preflight tests over WP4b's preflight (decision 32), and no backup or migration for a refused second app (decision 53)"
```

### Task 8.5: Graceful shutdown order, the heartbeat, and a failed boot that leaves no lock

**Files:**
- Test: `apps/api/test/bootstrap/app.shutdown.test.ts`

**Interfaces:**
- Consumes: `bootApp` (Task 8.1); `HEARTBEAT_INTERVAL_MS`, `AppLock` (WP3); Vitest's fake interval timers.

Rule (spec §7, §13; review arch-008, arch-015): the heartbeat runs every 30 s (driven with `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })`; only intervals are faked, because croner and the engine use timeouts); shutdown is stop accepting → `engine.shutdown()` → `wal_checkpoint(TRUNCATE)` → lock release → close, clears the heartbeat, and is idempotent; a boot that fails after taking the lock (here `listen`, which this process's network guards refuse) leaves no lock row and no heartbeat. pino redaction is WP4b's and tested there.

- [ ] **Step 1: Write the test**

`apps/api/test/bootstrap/app.shutdown.test.ts` (new file):

```ts
// Spec §7, §13: the heartbeat, the graceful shutdown order, and a failed boot that leaves no lock behind.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppLock, HEARTBEAT_INTERVAL_MS, openDatabase } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

/** Boot tests seed the full airports table; this file's tests may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

function first(order: number[]): number {
  const v = order[0];
  if (v === undefined) throw new Error('not called');
  return v;
}

function devConfig(dbPath: string) {
  return loadConfigFromEnv(
    cleanEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: dbPath,
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'error',
    }),
  );
}

/** Spies on the interval timers; `heartbeat()` is the handle of the one interval at HEARTBEAT_INTERVAL_MS. */
function intervalSpies() {
  const set = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  return {
    clear,
    heartbeat: () => {
      const i = set.mock.calls.findIndex((call) => call[1] === HEARTBEAT_INTERVAL_MS);
      const r = set.mock.results[i];
      if (r === undefined || r.type !== 'return') throw new Error('no heartbeat interval was set');
      return r.value;
    },
  };
}

function lockRow(dbPath: string) {
  const db = openDatabase(dbPath);
  try {
    return AppLock.inspect(db);
  } finally {
    db.close();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('graceful shutdown (spec §7, §13)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it('heartbeats every 30 s and shuts down: engine → checkpoint → release lock → close', async () => {
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    // why: only the interval timers are faked: the heartbeat is the app's one interval, croner and the engine use timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    const running = await bootApp({
      config: devConfig(dbPath),
      log: createLogger({ logLevel: 'error' }),
      listen: false,
      assets: assetPaths(),
    });
    const heartbeat = vi.spyOn(AppLock.prototype, 'heartbeat');
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(heartbeat).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    const shutdown = vi.spyOn(running.engine, 'shutdown');
    const pragma = vi.spyOn(running.ports.db.raw, 'pragma');
    const release = vi.spyOn(AppLock.prototype, 'release');
    const close = vi.spyOn(running.ports.db, 'close');
    await running.close();
    const checkpointIndex = pragma.mock.calls.findIndex(([src]) => String(src).startsWith('wal_checkpoint'));
    const checkpointOrder = pragma.mock.invocationCallOrder[checkpointIndex] ?? Number.NaN;
    expect(first(shutdown.mock.invocationCallOrder)).toBeLessThan(checkpointOrder);
    expect(checkpointOrder).toBeLessThan(first(release.mock.invocationCallOrder));
    expect(first(release.mock.invocationCallOrder)).toBeLessThan(first(close.mock.invocationCallOrder));
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat()); // the heartbeat is cleared

    expect(lockRow(dbPath)).toBeNull();
    const wal = `${dbPath}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    await running.close(); // idempotent
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('a boot that fails after taking the lock releases it and stops the heartbeat (review arch-008)', async () => {
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    // why: listen is the last step, after the lock and the heartbeat; this process's network guards refuse its address
    // lookup, so it fails here deterministically.
    await expect(
      bootApp({
        config: devConfig(dbPath),
        log: createLogger({ logLevel: 'error' }),
        listen: true,
        assets: assetPaths(),
      }),
    ).rejects.toThrow();
    expect(lockRow(dbPath)).toBeNull();
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat());
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.shutdown.test.ts` once per mutation below, each applied alone and then reverted.

- **8.5a**: in `apps/api/src/bootstrap/app.ts` replace

```ts
        ports.db.raw.pragma('wal_checkpoint(TRUNCATE)');
        lock.release();
```

  with

```ts
        lock.release();
        ports.db.raw.pragma('wal_checkpoint(TRUNCATE)');
```

  Fails: “heartbeats every 30 s and shuts down: engine → checkpoint → release lock → close”.

- **8.5b**: in `apps/api/src/bootstrap/app.ts` delete the line `if (heartbeat !== null) clearInterval(heartbeat);`. Fails: “a boot that fails after taking the lock releases it and stops the heartbeat (review arch-008)”.

- **8.5c**: in `apps/api/src/bootstrap/app.ts` replace

```ts
    // why: WP3's release deletes only the row this AppLock acquired, so a refused acquire leaves the holder's lock alone.
    lock.release();
```

  with nothing.
  Fails: “a boot that fails after taking the lock releases it and stops the heartbeat (review arch-008)”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.shutdown.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: shutdown order (checkpoint before lock release), heartbeat, and lock release on a failed boot"
```

### Task 8.6: Security headers; Host, Origin, Content-Type, X-Requested-With; body size, no-store, no CORS

**Files:**
- Test: `apps/api/test/routes/hardening.test.ts`

**Interfaces:**
- Consumes: the harness and contract helpers (Task 8.2), `MAX_BODY_BYTES` (Task 8.1), `apiContract.ROUTES`, `errorEnvelopeSchema` (core).

Rules (spec §4; decisions 54, 58; reviews SEC-1, SEC-6, SEC-8): headers on every response including 401 and 404; `Cache-Control: no-store` on every API response, the 401, the Host and Origin 403s and the 413 included (the 429 is pinned in Task 8.7); Host checked before auth, the public `GET /api/health` exempt, and the rejection names the value and the variable but no allowed host (those go to the log); `Origin`, when present, must name an allowed host; mutating API calls need JSON (415 otherwise) and `X-Requested-With: get-me-there` (403); a body over 64 KiB is 413 `body_too_large` before any parse; every API response is `Cache-Control: no-store`; none carries an `Access-Control-*` header and a preflight is never approved.

- [ ] **Step 1: Write the test**

`apps/api/test/routes/hardening.test.ts` (new file):

```ts
// Spec §4 security headers and request hardening.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/app.js';
import { API_TEXT } from '../../src/text.js';
import { errorOf } from '../helpers/contract.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

describe('security headers (spec §4)', () => {
  it.each([
    ['public health', '/api/health', true],
    ['authenticated route', '/api/providers', true],
    ['401', '/api/providers', false],
    ['404', '/api/nothing-here', true],
  ] as const)('%s carries CSP, nosniff and no-referrer', async (_label, path, auth) => {
    const res = await h.request(path, { auth });
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('Host allowlist (spec §4)', () => {
  it('rejects an unknown Host naming the value and the variable, never the allowed hosts, before auth', async () => {
    const res = await h.request('/api/providers', { auth: false, headers: { host: 'evil.example:3000' } });
    expect(res.status).toBe(403);
    const e = await errorOf(res);
    expect(e.code).toBe('host_not_allowed');
    expect(e.message).toBe(API_TEXT.hostRejected('evil.example:3000'));
    expect(e.message).toContain('ALLOWED_HOSTS');
    // why: decision 54: the allowed values would tell a stranger the host names; they go to the log only
    for (const allowed of h.ports.config.allowedHosts) expect(JSON.stringify(e)).not.toContain(allowed);
    expect(h.logLines.join('')).toContain(h.ports.config.allowedHosts[0] ?? 'no allowed host');
  });
  it('names a missing Host as (none)', async () => {
    const res = await h.request('/api/providers', { headers: { host: '' } });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toContain('(none)');
  });
  it('matches case-insensitively', async () => {
    expect((await h.request('/api/providers', { headers: { host: 'LOCALHOST:3000' } })).status).toBe(200);
  });
  it('exempts the public GET /api/health', async () => {
    expect(
      (await h.request('/api/health', { auth: false, headers: { host: 'healthcheck.internal' } })).status,
    ).toBe(200);
  });
});

describe('Origin check (spec §4)', () => {
  it.each(['https://evil.example', 'null', 'http://localhost:9999'])('rejects Origin %s', async (origin) => {
    const res = await h.request('/api/providers', { headers: { origin } });
    expect(res.status).toBe(403);
    const e = await errorOf(res);
    expect(e.code).toBe('origin_not_allowed');
    expect(e.message).toContain(origin);
  });
  it('accepts an allowed Origin and an absent one', async () => {
    expect((await h.request('/api/providers', { headers: { origin: 'http://localhost:3000' } })).status).toBe(
      200,
    );
    expect((await h.request('/api/providers')).status).toBe(200);
  });
});

describe('mutating requests (spec §4)', () => {
  it.each(['POST', 'PUT', 'DELETE'] as const)(
    '%s without Content-Type: application/json → 415',
    async (method) => {
      const res = await h.request('/api/nothing-here', {
        method,
        csrf: false,
        body: 'x',
        headers: { 'content-type': 'text/plain' },
      });
      expect(res.status).toBe(415);
      expect((await errorOf(res)).code).toBe('content_type');
    },
  );
  it('without X-Requested-With: get-me-there → 403', async () => {
    const res = await h.request('/api/nothing-here', {
      method: 'POST',
      csrf: false,
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('requested_with');
  });
  it('with both headers (charset allowed) the request reaches the router', async () => {
    const res = await h.request('/api/nothing-here', {
      method: 'POST',
      csrf: false,
      body: '{}',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-requested-with': 'get-me-there' },
    });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
  });
  it('GET needs neither', async () => {
    expect((await h.request('/api/providers')).status).toBe(200);
  });
});

describe('body size, caching and cross-origin (reviews SEC-1, SEC-8)', () => {
  it('a body over MAX_BODY_BYTES is 413 before it is parsed', async () => {
    const spy = vi.spyOn(h.engine, 'estimate');
    const res = await h.request('/api/definitions/estimate', {
      method: 'POST',
      body: JSON.stringify({ name: 'x'.repeat(MAX_BODY_BYTES) }),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('body_too_large');
    expect(spy).not.toHaveBeenCalled();
  });

  it('every API response is no-store; none carries an Access-Control header, and a preflight is not approved', async () => {
    for (const path of ['/api/providers', '/api/health', '/api/nothing-here']) {
      const res = await h.request(path, { headers: { origin: 'http://localhost:3000' } });
      expect(res.headers.get('cache-control'), path).toBe('no-store');
      expect(
        [...res.headers.keys()].filter((k) => k.startsWith('access-control-')),
        path,
      ).toEqual([]);
    }
    // decision 58: the refusals too, which return before any route runs (the 429 is pinned in auth.test.ts)
    const refusals = await Promise.all([
      h.request('/api/providers', { auth: false }),
      h.request('/api/providers', { headers: { host: 'evil.example:3000' } }),
      h.request('/api/providers', { headers: { origin: 'https://evil.example' } }),
      h.request('/api/definitions/estimate', { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) }),
    ]);
    expect(refusals.map((r) => r.status)).toEqual([401, 403, 403, 413]);
    for (const r of refusals) expect(r.headers.get('cache-control'), String(r.status)).toBe('no-store');
    const preflight = await h.request('/api/definitions', {
      method: 'OPTIONS',
      csrf: false,
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.status).not.toBe(204);
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/hardening.test.ts` once per mutation below, each applied alone and then reverted.

- **8.6a**: in `apps/api/src/app.ts` replace

```ts
  app.use(`${API_PREFIX}/*`, mutatingRequestCheck());
```

  with nothing.
  Fails: “POST without Content-Type: application/json → 415”; “PUT without Content-Type: application/json → 415”; “DELETE without Content-Type: application/json → 415”; “without X-Requested-With: get-me-there → 403”.

- **8.6b**: in `apps/api/src/middleware/hardening.ts` replace

```ts
API_TEXT.hostRejected(shown)
```

  with

```ts
`${API_TEXT.hostRejected(shown)} (${config.allowedHosts.join(', ')})`
```

  Fails: “rejects an unknown Host naming the value and the variable, never the allowed hosts, before auth”.

- **8.6c**: in `apps/api/src/app.ts` replace `      maxSize: MAX_BODY_BYTES,` with `      maxSize: MAX_BODY_BYTES * 4,`. Fails: “a body over MAX_BODY_BYTES is 413 before it is parsed”; “every API response is no-store; none carries an Access-Control header, and a preflight is not approved”.

- **8.6d**: in `apps/api/src/app.ts` replace

```ts
  app.use(`${API_PREFIX}/*`, noStore());
```

  with nothing.
  Fails: “every API response is no-store; none carries an Access-Control header, and a preflight is not approved”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/hardening.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: security header, request hardening, body limit, no-store and no-CORS tests"
```

### Task 8.7: Failed-auth rate limit per client IP, the auth gate over static files, the SPA fallback

**Files:**
- Test: `apps/api/test/routes/auth.test.ts`

**Interfaces:**
- Consumes: `basicAuthGate`, `FailedAuthLimiter`, `clientIpFrom`, `UNKNOWN_IP`, `mountStatic` (Task 8.1); the harness (Task 8.2).

Rules (spec §4, decisions 54, 58; reviews SEC-4, SEC-R2-1): the limiter holds at most `maxSources` addresses, dropping the least recently failing one, so a spray of addresses neither grows it nor slows each failure; a wrong credential is refused with 429 (`auth_rate_limited`, `Retry-After`) while its client IP has 5 failures in the last minute; a correct credential is always accepted, from any IP; there is no global bucket, so failures spread over many addresses never refuse another; a wrong password counts on every route, the public `/health` included (so it cannot probe passwords), but a request without credentials is never counted. The client IP is the last `X-Forwarded-For` entry only when `TRUST_PROXY=true`, else the socket address; with neither, every request shares the `UNKNOWN_IP` bucket. Static files need auth; SPA paths fall back to `index.html`; `/api/*` never does.

- [ ] **Step 1: Write the test**

`apps/api/test/routes/auth.test.ts` (new file):

```ts
// Spec §4 basic auth, the failed-auth rate limit, auth over static files, the SPA fallback.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import type { Context } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FailedAuthLimiter } from '../../src/middleware/auth.js';
import type { AppEnv } from '../../src/routes/types.js';
import { errorOf } from '../helpers/contract.js';
import { SENTINEL_AUTH } from '../helpers/env.js';
import { AUTH_USER, basic, createHarness, type Harness, T0 } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

const WRONG = basic(AUTH_USER, 'wrong-password-000');
const RIGHT = basic(AUTH_USER, SENTINEL_AUTH);
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const byTestIp = { clientIp: (c: Context<AppEnv>) => c.req.header('x-test-ip') ?? null };

async function harness(opts: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  h = await createHarness(opts);
  return h;
}

describe('basic auth gate (spec §4)', () => {
  it('401 with a challenge without or with wrong credentials, 200 with the right ones', async () => {
    const x = await harness();
    const none = await x.request('/api/providers', { auth: false });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Basic');
    expect((await x.request('/api/providers', { headers: { authorization: WRONG } })).status).toBe(401);
    expect((await x.request('/api/providers', { headers: { authorization: RIGHT } })).status).toBe(200);
  });

  it('GET /api/health is public and minimal without credentials', async () => {
    const x = await harness();
    const res = await x.request('/api/health', { auth: false });
    expect(res.status).toBe(200);
    expect(Object.keys(z.looseObject({}).parse(await res.json())).sort()).toEqual(['degraded', 'ok']);
  });

  it('with no credentials configured on loopback no credentials are needed', async () => {
    const x = await harness({ env: { APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' } });
    expect((await x.request('/api/providers', { auth: false })).status).toBe(200);
  });
});

describe('failed-auth rate limit (spec §4, plan decision 54)', () => {
  const as = (x: Harness, authorization: string, ip: string, path = '/api/providers') =>
    x.request(path, { headers: { authorization, 'x-test-ip': ip } }).then((r) => r.status);

  it('5 failures from one IP limit that IP for a minute, not others; a correct credential always succeeds', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 5; i++) expect(await as(x, WRONG, '203.0.113.7')).toBe(401);
    const blocked = await x.request('/api/providers', {
      headers: { authorization: WRONG, 'x-test-ip': '203.0.113.7' },
    });
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe('auth_rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('cache-control')).toBe('no-store'); // decision 58: refusals are no-store too
    // why: decision 54: the limit slows guessing; it never locks out the operator, who knows the password
    expect(await as(x, RIGHT, '203.0.113.7')).toBe(200);
    expect(await as(x, WRONG, '203.0.113.8')).toBe(401);
    x.clock.advance(61_000);
    expect(await as(x, WRONG, '203.0.113.7')).toBe(401);
  });

  it('wrong credentials on the public /api/health still count; no credentials never do', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 5; i++) expect(await as(x, WRONG, '203.0.113.9', '/api/health')).toBe(200);
    expect(await as(x, WRONG, '203.0.113.9')).toBe(429);
    for (let i = 0; i < 30; i++)
      await x.request('/api/health', { auth: false, headers: { 'x-test-ip': '198.51.100.1' } });
    expect(await as(x, WRONG, '198.51.100.1')).toBe(401);
  });

  it('there is no global bucket: failures spread over many IPs never refuse another IP (review SEC-4)', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 40; i++) await as(x, WRONG, `198.51.100.${i}`);
    expect(await as(x, WRONG, '192.0.2.1')).toBe(401);
    expect(await as(x, RIGHT, '192.0.2.1')).toBe(200);
  });

  it('holds at most maxSources addresses, dropping the least recently failing one (review SEC-R2-1)', () => {
    const clock = fixedClock(T0);
    const limiter = new FailedAuthLimiter(clock, { perIp: 2, windowMs: 60_000, maxSources: 3 });
    for (const ip of ['a', 'b', 'c']) limiter.recordFailure(ip);
    limiter.recordFailure('a'); // a is now the most recent
    expect(limiter.retryAfterSeconds('a')).not.toBeNull();
    limiter.recordFailure('d'); // evicts b, the least recently failing
    expect(limiter.sources).toBe(3);
    for (let i = 0; i < 100; i++) limiter.recordFailure(`spray-${i}`);
    expect(limiter.sources).toBe(3);
    expect(limiter.retryAfterSeconds('a')).toBeNull(); // evicted by the spray: forgotten, never grown
  });

  it('TRUST_PROXY=true keys on the last X-Forwarded-For entry', async () => {
    const x = await harness({ env: { TRUST_PROXY: 'true' } });
    const xff = (authorization: string, chain: string) =>
      x
        .request('/api/providers', { headers: { authorization, 'x-forwarded-for': chain } })
        .then((r) => r.status);
    for (let i = 0; i < 5; i++) await xff(WRONG, '198.51.100.7');
    expect(await xff(WRONG, '198.51.100.7')).toBe(429);
    expect(await xff(WRONG, '198.51.100.7, 198.51.100.8')).toBe(401);
  });

  it('TRUST_PROXY=false ignores X-Forwarded-For: every unknown-IP request shares one bucket', async () => {
    const x = await harness();
    for (let i = 0; i < 5; i++)
      await x.request('/api/providers', {
        headers: { authorization: WRONG, 'x-forwarded-for': `198.51.100.${i}` },
      });
    // why: no socket under app.request() and no trusted proxy, so the five spoofed addresses were one source
    const res = await x.request('/api/providers', {
      headers: { authorization: WRONG, 'x-forwarded-for': '203.0.113.1' },
    });
    expect(res.status).toBe(429);
  });
});

describe('static files and SPA fallback (spec §4, §13)', () => {
  function webRoot(): string {
    const dir = tempDir('gmt-web-');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>gmt</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1);');
    return dir;
  }

  it('static files need auth', async () => {
    const x = await harness({ app: { webRoot: webRoot() } });
    expect((await x.request('/', { auth: false })).status).toBe(401);
    expect((await x.request('/assets/app.js', { auth: false })).status).toBe(401);
  });

  it('serves files, falls back to index.html for SPA paths, and never for /api', async () => {
    const x = await harness({ app: { webRoot: webRoot() } });
    const index = await x.request('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<title>gmt</title>');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    const js = await x.request('/assets/app.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(await (await x.request('/results/abc')).text()).toContain('<title>gmt</title>');
    const api = await x.request('/api/nope');
    expect(api.status).toBe(404);
    expect((await errorOf(api)).code).toBe('not_found');
    expect((await x.request('/somewhere', { method: 'POST', json: {} })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/auth.test.ts` once per mutation below, each applied alone and then reverted.

- **8.7a**: in `apps/api/src/middleware/auth.ts` delete the line `o.limiter.recordFailure(ip);`. Fails: “5 failures from one IP limit that IP for a minute, not others; a correct credential always succeeds”; “wrong credentials on the public /api/health still count; no credentials never do”; “TRUST_PROXY=true keys on the last X-Forwarded-For entry”; “TRUST_PROXY=false ignores X-Forwarded-For: every unknown-IP request shares one bucket”.

- **8.7b**: in `apps/api/src/middleware/auth.ts` replace

```ts
    if (header !== undefined) {
      if (credentialsMatch(header, auth) === 'valid') {
        c.set('authenticated', true);
        return next();
      }
      const ip = o.clientIp(c) ?? UNKNOWN_IP;
      const retry = o.limiter.retryAfterSeconds(ip);
      if (retry !== null) {
        c.header('Retry-After', String(retry));
        return c.json(envelope('auth_rate_limited', API_TEXT.rateLimited(retry)), 429);
      }
```

  with

```ts
    if (header !== undefined) {
      const ip = o.clientIp(c) ?? UNKNOWN_IP;
      const retry = o.limiter.retryAfterSeconds(ip);
      if (retry !== null) {
        c.header('Retry-After', String(retry));
        return c.json(envelope('auth_rate_limited', API_TEXT.rateLimited(retry)), 429);
      }
      if (credentialsMatch(header, auth) === 'valid') {
        c.set('authenticated', true);
        return next();
      }
```

  Fails: “5 failures from one IP limit that IP for a minute, not others; a correct credential always succeeds”.

- **8.7c**: in `apps/api/src/middleware/auth.ts` replace `    while (this.byIp.size > this.limits.maxSources) {` with `    while (this.byIp.size > this.limits.maxSources * 1000) {`. Fails: “holds at most maxSources addresses, dropping the least recently failing one (review SEC-R2-1)”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/auth.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: per-IP failed-auth limit where a correct credential always wins; auth over static files and SPA fallback tests"
```

### Task 8.8: Health detail, airports autocomplete, providers, budget, scheduler jobs

**Files:**
- Test: `apps/api/test/routes/system.test.ts`

**Interfaces:**
- Consumes: `systemHandlers`, `hostAllowed` (Task 8.1); `engine.status()`, `engine.scheduler.jobs()`, `engine.scheduler.blockedSince()` (WP7); `AirportsRepo.search` (WP3); the system schemas of the api-contract.

Rules (spec §10, §13; review SEC-2): one public health route with two shapes (`healthResponseSchema` is the union): the `HEALTHCHECK` gets `{ ok, degraded }`; an authenticated caller gets the detail — with auth off, only when the Host is allowed — which never includes the database path (`sizeBytes` is 0 for `:memory:`), and `healthy: null` per provider because health never calls a provider. Airports: up to 20 rows in the repository's prefix-on-IATA-then-city/name order. Providers: capabilities, plan, both usage windows, the zero-cap notice, the presets with core's refresh default. Budget: every provider window and the global one labelled by `budgetScopeLabel`, the cap, the subscription fees counted once in it (spec §5.3) and a one-line ceiling note, money through `microGbpToPence` (decision 49).

- [ ] **Step 1: Write the test**

`apps/api/test/routes/system.test.ts` (new file):

```ts
// Spec §10 health, airports, providers, budget and scheduler jobs.
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { expectContract } from '../helpers/contract.js';
import { SENTINEL_SA } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

describe('GET /api/health (spec §10, §13)', () => {
  it('public shape without auth; detail with auth, no database path', async () => {
    const x = await harness();
    const pub = await expectContract(
      await x.request('/api/health', { auth: false }),
      'GET',
      '/api/health',
      apiContract.healthPublicSchema,
    );
    expect(pub).toEqual({ ok: true, degraded: false });
    const detail = await expectContract(
      await x.request('/api/health'),
      'GET',
      '/api/health',
      apiContract.healthDetailSchema,
    );
    expect(detail.db.ok).toBe(true);
    expect(detail.db).not.toHaveProperty('path');
    expect(JSON.stringify(detail)).not.toContain(':memory:');
    expect(detail.providers.map((p) => p.providerId)).toContain('fixture');
    expect(detail.scheduler).toMatchObject({ jobCount: 0, blockedSince: null });
  });
  it('with auth off, a foreign Host gets the minimal shape, an allowed Host the detail (review SEC-2)', async () => {
    const x = await harness({ APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' });
    const foreign = await x.request('/api/health', { auth: false, headers: { host: 'rebound.example' } });
    expect(await expectContract(foreign, 'GET', '/api/health', apiContract.healthPublicSchema)).toEqual({
      ok: true,
      degraded: false,
    });
    const local = await x.request('/api/health', { auth: false });
    await expectContract(local, 'GET', '/api/health', apiContract.healthDetailSchema);
  });

  it('reports degraded from the engine without detail', async () => {
    const x = await harness();
    vi.spyOn(x.engine, 'status').mockReturnValue({
      running: [],
      degraded: true,
      nextRun: null,
      lastExecutionAt: null,
    });
    expect(await (await x.request('/api/health', { auth: false })).json()).toEqual({
      ok: true,
      degraded: true,
    });
  });
});

describe('GET /api/airports?q= (spec §10, §11 autocomplete)', () => {
  it('returns at most 20 airports, IATA prefix first', async () => {
    const x = await harness();
    const rows = await expectContract(
      await x.request('/api/airports?q=LHR'),
      'GET',
      '/api/airports',
      apiContract.airportsResponseSchema,
    );
    expect(rows[0]?.iata).toBe('LHR');
    const london = await expectContract(
      await x.request('/api/airports?q=London'),
      'GET',
      '/api/airports',
      apiContract.airportsResponseSchema,
    );
    expect(london.map((a) => a.iata)).toEqual(expect.arrayContaining(['LHR', 'LGW']));
    expect(london.length).toBeLessThanOrEqual(20);
  });
  it('400 without q', async () => {
    const x = await harness();
    expect((await x.request('/api/airports')).status).toBe(400);
  });
});

describe('GET /api/providers (spec §10)', () => {
  it('lists capabilities, plan, usage with window bounds, the synthetic flag and the plan presets', async () => {
    const x = await harness();
    const body = await expectContract(
      await x.request('/api/providers'),
      'GET',
      '/api/providers',
      apiContract.providersResponseSchema,
    );
    const fixture = body.providers.find((p) => p.providerId === 'fixture');
    expect(fixture?.plan).toBe('synthetic');
    expect(fixture?.usage.map((u) => u.scope)).toEqual([
      'provider-month:fixture',
      'provider-lifetime:fixture',
    ]);
    expect(fixture?.notices).toEqual([]);
    expect(body.synthetic).toBe(true);
    expect(body.presets).toMatchObject({
      policy: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true },
      discoveryRefreshHours: 168,
      schedulerTimezone: 'Europe/London',
    });
  });
  it('says verification will not run when a billed provider is enabled under a zero cap', async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
      MONTHLY_SPEND_CAP_PENCE: '0',
    });
    const body = await expectContract(
      await x.request('/api/providers'),
      'GET',
      '/api/providers',
      apiContract.providersResponseSchema,
    );
    expect(body.providers.find((p) => p.providerId === 'searchapi')?.notices).toContain(
      API_TEXT.zeroCapVerification,
    );
  });
});

describe('GET /api/budget and GET /api/scheduler/jobs (spec §7 budget windows, §8.2)', () => {
  it('reports every window with bounds, the cap and the subscription fees counted once', async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
      MONTHLY_SPEND_CAP_PENCE: '3500',
    });
    const body = await expectContract(
      await x.request('/api/budget'),
      'GET',
      '/api/budget',
      apiContract.budgetResponseSchema,
    );
    expect(body.scopes.map((s) => s.scope)).toEqual(
      expect.arrayContaining(['provider-month:searchapi', 'global-month']),
    );
    for (const s of body.scopes) expect(s).toHaveProperty('windowStart');
    expect([body.monthlyCapPence, body.fixedFeesMicroGbp]).toEqual([3500, 32_000_000]);
    expect(body.ceilingNote).toBe(API_TEXT.ceilingNote(3500, 3200));
  });
  it('lists registered jobs', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }));
    x.engine.scheduler.register(def);
    const body = await expectContract(
      await x.request('/api/scheduler/jobs'),
      'GET',
      '/api/scheduler/jobs',
      apiContract.schedulerJobsResponseSchema,
    );
    expect(body.jobs.map((j) => j.definitionId)).toContain(def.id);
  });
});
```

- [ ] **Step 2: Run to verify each rule's test fails without it**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/system.test.ts` once per mutation below, each applied alone and then reverted.

- **8.8a**: in `apps/api/src/routes/system.ts` replace `c.get('authenticated') && (config.auth !== null || hostAllowed(config, c.req.header('host')))` with `c.get('authenticated')`. Fails: “with auth off, a foreign Host gets the minimal shape, an allowed Host the detail (review SEC-2)”.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/system.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: health detail (Host-checked without auth), airports, providers presets, budget and scheduler jobs tests"
```

### Task 8.9: Definitions CRUD, the plan-preset draft, cron validation, schedule sync and fit, both estimate routes, the coverage check, the confirmation rule

**Files:**
- Create: `apps/api/src/read/space.ts`, `src/read/definitions.ts`, `src/routes/definitions.ts`
- Modify: `apps/api/src/routes/index.ts`, `apps/api/test/bootstrap/app.matrix.test.ts`
- Test: `apps/api/test/routes/definitions.test.ts`

**Interfaces:**
- Consumes: `DefinitionsRepo.create/update/get/list/softDelete/setConfirmed` (WP3, WP7); `engine.estimate`, `engine.budgetFit`, `engine.coverageCheck`, `engine.scheduler.register/unregister`, `parseCron`, `confirmationOf`, and Task 8.0's exports `confirmationNeeded`, `capKindOf`, `lineKey` (WP7); `resolveWindow`, `countCells`, `daysBetween`, `validateSearchSpace` (WP1); `PENCE_TO_MICRO`, `budgetScopeLabel`; `definitionCreateOptionalSchema`, `definitionCreateRequestSchema`, `definitionUpdateRequestSchema`, `definitionResponseSchema`, `estimateResponseSchema`, `coverageCheckRequestSchema`, `coverageCheckResponseSchema` (core).
- Produces: `isDraft`, `currentSpace`, `cellInSpace`, `airportLookup`, `definitionResponse`, `deletedResponse`, `needsConfirmation`, `sentCovers`, `mergeDefinition`, `inputOf`, `ZERO_BUDGET_FIT`, `syncSchedule`, `validateForSave`; routes `GET/POST /api/definitions`, `GET/PUT/DELETE /api/definitions/:id`, `POST /api/definitions/estimate`, `POST /api/definitions/:id/estimate`, `POST /api/definitions/coverage-check`.

**`POST /api/definitions` with no body** (spec §10, §8.2, §11): `201` with the response for a newly persisted **draft** built by `defaultDefinitionInput`: no airports, `enabled: false`, `confirmedCostPence` and `confirmedCalls` null, `estimate: null`, `budgetFit: { fits: true, runsPerMonth: 0, perScope: [] }`, `needsConfirmation: null`, `notices: [API_TEXT.draftNotice]`; no cron job is registered (Task 8.0 lets the stored shape hold it). A draft can be renamed or edited but not enabled (`422 draft_cannot_enable`), estimated (`422 draft_definition`) or run.

**Confirmation** (spec §7, decisions 25, 37, 42, 43, 53, 54, 58). Whether a run needs one is WP7's own `confirmationNeeded(ctx, estimate, blocked, stored)`, the function a start calls: the api passes a `ConfirmationContext` over its ports (the config, the guard, each provider's `capKindOf` its plan window; the fixture provider counts monthly), the estimate's blocked lines as `lineKey`s and the stored confirmation, and keeps no copy of the rule (review arch-wp08-003). When it needs one, `needsConfirmation` is `{ estimateMicroGbp, totalCalls, confirmedCostPence, confirmedCalls }` with the **worst-case** figures of WP7's `confirmationOf(estimate)` — every line, blocked ones included; else null. Create and PUT bodies may carry `confirmedCostPence` and `confirmedCalls`, the operator's explicit confirmation: when both are sent and both are at least the worst-case figures, the route stores `confirmationOf(estimate)` itself with `DefinitionsRepo.setConfirmed` (so a provider back from a cap next month is still covered, and a larger figure the operator typed is not what is stored); otherwise nothing is stored. Nothing else writes them.

**Validation** (spec §8.2, §5.5): cron by the engine's `parseCron`, the sole validator (422 `invalid_cron` with `details.fields`); every named provider must be configured (422 `unknown_provider`: a production config never offers `fixture`); a window resolving to zero cells is 422 `zero_cells`; the rest of `validateSearchSpace` is 422 `invalid_definition` with its fields; a save that turns a schedule on or changes it is refused with 422 `schedule_over_budget` while any provider-month scope of the engine's `budgetFit` does not fit, matched by `budgetScopeLabel` (review arch-011). Create, PUT, disable, enable and delete (re)register the job in the same request. PUT merges the update into the stored definition field by field (`mergeDefinition`: an absent field keeps its value, `null` is a value) and validates the merged definition, so a partial update cannot bypass a refinement. A malformed JSON body is the 400 `validation` envelope.

**One at a time** (decisions 54, 58; review SEC-5): the coverage check runs inside `oneAtATime` under the key `coverage-check`; a second while one is awaiting is 429 `already_running`. The estimates are synchronous (`engine.estimate` and `budgetFit` return at once), so no request can run beside them and they take no guard.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/definitions.test.ts` (new file):

```ts
// Spec §8.2, §10 definitions CRUD, the plan-preset draft, cron validation, schedule sync, both estimate routes, the
// coverage check; the confirmation rule (spec §7, plan decisions 25, 37, 42, 43).
import { apiContract, asIata, asIsoDate, asIsoMonth, type Estimate } from '@gmt/core';
import { confirmationOf, SOFT_CONFIRM_CALL_SHARE } from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { SENTINEL_TP } from '../helpers/env.js';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const DEF = apiContract.definitionResponseSchema;
type Line = Estimate['perProvider'][number];
const line = (costMicroGbp: number, calls: number, blocked: string | null = null): Line => ({
  providerId: 'fixture',
  stage: blocked === null ? 'discovery' : 'verification',
  calls,
  planCalls: calls,
  costMicroGbp,
  costPence: Math.ceil(costMicroGbp / 10_000),
  seconds: 1,
  blocked,
});
/** An estimate of one runnable line (and, when given, more lines; WP7 sums the shown totals over runnable ones). */
const estimateOf = (totalCostMicroGbp: number, totalCalls = 10, extra: Line[] = []): Estimate => ({
  cells: 10,
  perProvider: [line(totalCostMicroGbp, totalCalls), ...extra],
  totalCalls,
  totalPlanCalls: 9,
  totalCostMicroGbp,
  totalCostPence: Math.ceil(totalCostMicroGbp / 10_000),
  seconds: 1,
  assumptions: [],
  windowClamped: false,
  retryFactor: 1.2,
});
const jobIds = (x: Harness) => x.engine.scheduler.jobs().map((j) => j.definitionId);
const ZERO_WINDOW = { kind: 'absolute', from: asIsoDate('2026-01-01'), to: asIsoDate('2026-01-10') } as const;

async function create(x: Harness, body: unknown) {
  return expectContract(await x.request('/api/definitions', { json: body }), 'POST', '/api/definitions', DEF);
}

describe('POST /api/definitions', () => {
  it('with no body creates the disabled draft default definition for the configured plan', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', { method: 'POST' });
    expect(res.status).toBe(201);
    const d = await expectContract(res, 'POST', '/api/definitions', DEF);
    expect([
      d.origins,
      d.enabled,
      d.confirmedCostPence,
      d.confirmedCalls,
      d.estimate,
      d.needsConfirmation,
    ]).toEqual([[], false, null, null, null, null]);
    expect(d.providers).toMatchObject({ discovery: ['fixture'], verification: ['fixture'] });
    expect(d.budgetFit).toEqual({ fits: true, runsPerMonth: 0, perScope: [] });
    expect(d.notices).toEqual([API_TEXT.draftNotice]);
    expect(jobIds(x)).not.toContain(d.id);
  });

  it('with a body validates, persists, estimates and registers the schedule', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }),
    });
    expect(res.status).toBe(201);
    const d = await expectContract(res, 'POST', '/api/definitions', DEF);
    expect(d.estimate?.cells).toBeGreaterThan(0);
    expect(jobIds(x)).toContain(d.id);
  });

  it('rejects a sub-hourly cron through the scheduler parseCron with details.fields', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ scheduleCron: '*/15 * * * *' }),
    });
    expect(res.status).toBe(422);
    const e = await errorOf(res);
    expect(e.code).toBe('invalid_cron');
    expect(e.details?.fields?.[0]?.field).toBe('scheduleCron');
  });

  it('returns 422 for a window that resolves to zero cells', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ window: ZERO_WINDOW }),
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('zero_cells');
  });

  it('rejects a malformed body with the validation envelope and its fields', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', { json: { name: 'x' } });
    expect(res.status).toBe(400);
    const e = await errorOf(res);
    expect(e.code).toBe('validation');
    expect(e.details?.fields?.length).toBeGreaterThan(0);
  });

  it('a malformed JSON body is a 400 validation envelope', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions/coverage-check', { method: 'POST', body: '{not json' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation');
  });
  it('refuses a schedule whose provider-month scope does not fit the monthly load (decision 25)', async () => {
    const x = await harness();
    vi.spyOn(x.engine, 'budgetFit').mockReturnValue({
      fits: false,
      runsPerMonth: 4.33,
      perScope: [{ scope: 'provider-month:fixture', estimated: 900, cap: 100, fits: false }],
    });
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }),
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('schedule_over_budget');
    expect(x.ports.repos.definitions.list()).toHaveLength(0);
  });
});

describe('PUT / DELETE /api/definitions/:id and the schedule (spec §8.2)', () => {
  it('disable, enable and delete each (re)register the job in the same request', async () => {
    const x = await harness();
    const d = await create(x, exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }));
    expect(
      (await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: false } })).status,
    ).toBe(200);
    expect(jobIds(x)).not.toContain(d.id);
    expect(
      (await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: true } })).status,
    ).toBe(200);
    expect(jobIds(x)).toContain(d.id);
    const del = await x.request(`/api/definitions/${d.id}`, { method: 'DELETE' });
    expect((await expectContract(del, 'DELETE', '/api/definitions/:id', DEF)).deletedAt).not.toBeNull();
    expect(jobIds(x)).not.toContain(d.id);
    expect((await x.request(`/api/definitions/${d.id}`)).status).toBe(404);
    const list = await expectContract(
      await x.request('/api/definitions'),
      'GET',
      '/api/definitions',
      DEF.array(),
    );
    expect(list.map((y) => y.id)).not.toContain(d.id);
  });

  it('a draft can be edited but not enabled until it has airports; codes are upper-cased (review focus 1)', async () => {
    const x = await harness();
    const d = await expectContract(
      await x.request('/api/definitions', { method: 'POST' }),
      'POST',
      '/api/definitions',
      DEF,
    );
    expect(
      (await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { name: 'renamed' } })).status,
    ).toBe(200);
    const res = await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: true } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('draft_cannot_enable');
    const ok = await x.request(`/api/definitions/${d.id}`, {
      method: 'PUT',
      json: { origins: ['lhr'], destinations: ['JFK'], enabled: true },
    });
    expect((await expectContract(ok, 'PUT', '/api/definitions/:id', DEF)).origins).toEqual(['LHR']);
    expect(jobIds(x)).toContain(d.id);
  });

  it('stores a confirmation only when its pence and calls both cover the estimate (decisions 37, 43)', async () => {
    const x = await harness();
    const estimate = vi.spyOn(x.engine, 'estimate').mockReturnValue(estimateOf(5_000_000, 40)); // 500p > SOFT_CONFIRM 100p
    const created = await create(x, {
      ...exampleDefinitionInput(),
      confirmedCostPence: 100,
      confirmedCalls: 40,
    });
    expect([created.confirmedCostPence, created.confirmedCalls]).toEqual([null, null]); // 100p does not cover 500p
    expect(created.needsConfirmation).toEqual({
      estimateMicroGbp: 5_000_000,
      totalCalls: 40,
      confirmedCostPence: null,
      confirmedCalls: null,
    });
    const put = (json: unknown) =>
      x
        .request(`/api/definitions/${created.id}`, { method: 'PUT', json })
        .then((r) => expectContract(r, 'PUT', '/api/definitions/:id', DEF));
    const penceOnly = await put({ confirmedCostPence: 500 });
    expect(penceOnly.confirmedCostPence).toBeNull(); // why: a confirmation without its calls covers nothing
    const tooFewCalls = await put({ confirmedCostPence: 500, confirmedCalls: 39 });
    expect(tooFewCalls.confirmedCalls).toBeNull();
    const confirmed = await put({ confirmedCostPence: 500, confirmedCalls: 40 });
    expect([confirmed.confirmedCostPence, confirmed.confirmedCalls, confirmed.needsConfirmation]).toEqual([
      500,
      40,
      null,
    ]);
    const renamed = await put({ name: 'again' });
    expect([renamed.confirmedCostPence, renamed.confirmedCalls]).toEqual([500, 40]); // never rewritten without an explicit value
    estimate.mockReturnValue(estimateOf(6_000_000, 40));
    const raised = await expectContract(
      await x.request(`/api/definitions/${created.id}`),
      'GET',
      '/api/definitions/:id',
      DEF,
    );
    expect(raised.needsConfirmation).toEqual({
      estimateMicroGbp: 6_000_000,
      totalCalls: 40,
      confirmedCostPence: 500,
      confirmedCalls: 40,
    });
  });

  it('asks for a confirmation when a free run needs more than 20% of a provider call cap (decision 25)', async () => {
    const x = await harness();
    const cap = x.ports.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).cap ?? 0;
    expect(cap).toBeGreaterThan(0);
    vi.spyOn(x.engine, 'estimate').mockReturnValue(
      estimateOf(0, Math.floor(SOFT_CONFIRM_CALL_SHARE * cap) + 1),
    );
    const d = await create(x, exampleDefinitionInput());
    expect(d.needsConfirmation).toMatchObject({ estimateMicroGbp: 0 });
    vi.spyOn(x.engine, 'estimate').mockReturnValue(estimateOf(0, Math.floor(SOFT_CONFIRM_CALL_SHARE * cap)));
    expect((await create(x, exampleDefinitionInput())).needsConfirmation).toBeNull();
  });

  it('shows and stores the worst case over every line, blocked ones included (WP7 confirmationOf, decision 54)', async () => {
    const x = await harness();
    // a runnable 300p / 30-call line and a 200p / 10-call line a cap blocks today
    vi.spyOn(x.engine, 'estimate').mockReturnValue({
      ...estimateOf(3_000_000, 30, [line(2_000_000, 10, 'provider-month')]),
    });
    const created = await create(x, exampleDefinitionInput());
    expect(created.needsConfirmation).toMatchObject({ estimateMicroGbp: 5_000_000, totalCalls: 40 });
    const put = (json: unknown) =>
      x
        .request(`/api/definitions/${created.id}`, { method: 'PUT', json })
        .then((r) => expectContract(r, 'PUT', '/api/definitions/:id', DEF));
    expect((await put({ confirmedCostPence: 300, confirmedCalls: 30 })).confirmedCostPence).toBeNull();
    // why: what is stored is the worst case itself, not the operator's larger figure (WP7's confirmationOf)
    expect(await put({ confirmedCostPence: 900, confirmedCalls: 90 })).toMatchObject({
      confirmedCostPence: 500,
      confirmedCalls: 40,
      needsConfirmation: null,
    });
  });

  it('with the real engine: an over-threshold run needs a confirmation, and a confirmation of its figures clears it', async () => {
    // why: review TS-1: the rule runs against a real estimate, not a mocked one (the fixture billed at 10p a call)
    const x = await harness({ FIXTURE_COST_MICRO_GBP: '100000' });
    const created = await create(
      x,
      exampleDefinitionInput({ window: SMALL_WINDOW, minNights: 10, maxNights: 10 }),
    );
    const worst = confirmationOf(x.engine.estimate(created, x.clock.todayLondon()));
    expect(worst.pence).toBeGreaterThan(100);
    expect(created.needsConfirmation).toMatchObject({ totalCalls: worst.calls, confirmedCostPence: null });
    const put = await x.request(`/api/definitions/${created.id}`, {
      method: 'PUT',
      json: { confirmedCostPence: worst.pence, confirmedCalls: worst.calls },
    });
    expect((await expectContract(put, 'PUT', '/api/definitions/:id', DEF)).needsConfirmation).toBeNull();
  });

  it('404 for an unknown definition', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions/nope');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('definition_not_found');
  });
});

describe('estimates and the coverage check', () => {
  it('POST /api/definitions/estimate estimates an unsaved body without persisting it', async () => {
    const x = await harness();
    const before = x.ports.repos.definitions.list().length;
    const res = await x.request('/api/definitions/estimate', { json: exampleDefinitionInput() });
    const body = await expectContract(
      res,
      'POST',
      '/api/definitions/estimate',
      apiContract.estimateResponseSchema,
    );
    expect(body.estimate.cells).toBeGreaterThan(0);
    expect(typeof body.budgetFit.fits).toBe('boolean');
    expect(x.ports.repos.definitions.list()).toHaveLength(before);
    const zero = await x.request('/api/definitions/estimate', {
      json: exampleDefinitionInput({ window: ZERO_WINDOW }),
    });
    expect((await errorOf(zero)).code).toBe('zero_cells');
  });

  it('POST /api/definitions/:id/estimate estimates a saved definition; refuses a draft', async () => {
    const x = await harness();
    const d = await create(x, exampleDefinitionInput());
    const res = await x.request(`/api/definitions/${d.id}/estimate`, { method: 'POST', json: {} });
    await expectContract(res, 'POST', '/api/definitions/:id/estimate', apiContract.estimateResponseSchema);
    const draft = await expectContract(
      await x.request('/api/definitions', { method: 'POST' }),
      'POST',
      '/api/definitions',
      DEF,
    );
    const refused = await x.request(`/api/definitions/${draft.id}/estimate`, { method: 'POST', json: {} });
    expect(refused.status).toBe(422);
    expect((await errorOf(refused)).code).toBe('draft_definition');
  });

  const coverageBody = {
    origins: ['LHR'],
    destinations: ['JFK'],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
  };

  it('needs Travelpayouts (free) and never falls back to a billed provider', async () => {
    const x = await harness();
    const spy = vi.spyOn(x.engine, 'coverageCheck');
    const res = await x.request('/api/definitions/coverage-check', { json: coverageBody });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('coverage_check_unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('delegates to engine.coverageCheck when Travelpayouts is configured; a month it could not check is null', async () => {
    const x = await harness({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP });
    const spy = vi.spyOn(x.engine, 'coverageCheck').mockResolvedValue({
      pairs: [
        {
          origin: asIata('LHR'),
          destination: asIata('JFK'),
          months: [{ month: asIsoMonth('2026-11'), cachedRows: null, cellsInBand: 12 }],
        },
      ],
      calls: 1,
      notes: [],
    });
    const res = await x.request('/api/definitions/coverage-check', { json: coverageBody });
    const body = await expectContract(
      res,
      'POST',
      '/api/definitions/coverage-check',
      apiContract.coverageCheckResponseSchema,
    );
    expect(body.pairs[0]?.months[0]?.cachedRows).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('one coverage check at a time (decision 54): a second while one runs is 429 already_running', async () => {
    const x = await harness({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP });
    let release: (() => void) | undefined;
    vi.spyOn(x.engine, 'coverageCheck')
      .mockResolvedValue({ pairs: [], calls: 0, notes: [] })
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve({ pairs: [], calls: 0, notes: [] }))),
      );
    const first = x.request('/api/definitions/coverage-check', { json: coverageBody });
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = await x.request('/api/definitions/coverage-check', { json: coverageBody });
    expect(second.status).toBe(429);
    expect((await errorOf(second)).code).toBe('already_running');
    release?.();
    expect((await first).status).toBe(200);
    expect((await x.request('/api/definitions/coverage-check', { json: coverageBody })).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/definitions.test.ts`
Expected: FAIL: every definitions route answers 404 `not_found` (`POST /api/definitions → 404`).

- [ ] **Step 3: Implement**

`apps/api/src/read/space.ts` (new file):

```ts
/** The definition's current resolved space and cell membership (spec §6.1, §8.1). */
import {
  type AirportLookup,
  type CellKey,
  daysBetween,
  type IsoDate,
  type ResolvedSpace,
  resolveWindow,
  type SearchDefinition,
} from '@gmt/core';
import type { AirportsRepo } from '@gmt/db';

type SpaceFields = Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights'>;

/** A draft has no origins or no destinations; it can be stored but not enabled, estimated or run. */
export function isDraft(def: Pick<SearchDefinition, 'origins' | 'destinations'>): boolean {
  return def.origins.length === 0 || def.destinations.length === 0;
}

/** The definition's current resolved space (spec §6.1); results filter to it (spec §6.2, §10). */
export function currentSpace(def: SpaceFields, today: IsoDate): ResolvedSpace {
  const w = resolveWindow(def.window, today);
  return {
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: w.departureFrom,
    departureTo: w.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
}

/**
 * Membership in `generateCells(space)` without generating it (spec §8.1 single-cell verify):
 * airports in the lists, departure inside the inclusive window, nights inside the inclusive range.
 * Task 8.10 asserts the equivalence against `generateCells` on a small space.
 */
export function cellInSpace(space: ResolvedSpace, cell: CellKey): boolean {
  if (!space.origins.includes(cell.origin) || !space.destinations.includes(cell.destination)) return false;
  if (cell.departureDate < space.departureFrom || cell.departureDate > space.departureTo) return false;
  const nights = daysBetween(cell.departureDate, cell.returnDate);
  return nights >= space.minNights && nights <= space.maxNights;
}

/** WP1's `AirportLookup`, backed by the airports table. */
export function airportLookup(repo: AirportsRepo): AirportLookup {
  return {
    exists: (code) => repo.exists(code),
    metroOf: (code) => repo.metroOf(code),
    airportsOfMetro: (code) => repo.airportsOfMetro(code),
  };
}
```

`apps/api/src/read/definitions.ts` (new file):

```ts
/** The definition response and the confirmation rule (spec §7, §8.1, §10; plan decisions 25, 37, 42, 43). */
import type {
  apiContract,
  BudgetFit,
  DefinitionInput,
  Estimate,
  ProviderId,
  SearchDefinition,
} from '@gmt/core';
import {
  type Confirmation,
  type ConfirmationContext,
  capKindOf,
  confirmationNeeded,
  confirmationOf,
  type LineKey,
  lineKey,
} from '@gmt/engine';
import type { z } from 'zod';
import type { RouteContext } from '../routes/types.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { isDraft } from './space.js';
import { providerLimits } from './usage.js';

export type DefinitionResponse = z.infer<typeof apiContract.definitionResponseSchema>;

/** The budgetFit of a draft: nothing to search, nothing to fit. */
export const ZERO_BUDGET_FIT: BudgetFit = { fits: true, runsPerMonth: 0, perScope: [] };

/**
 * WP7's own confirmation rule over the api's ports (plan decision 58): the soft-confirm threshold, the guard's caps and
 * each provider's cap scope through the engine's `capKindOf`, so the form asks exactly when a start would be refused
 * with `confirm`. The fixture provider has no configured limits and counts monthly, as the guard counts it.
 */
function confirmationContext(ports: Ports): ConfirmationContext {
  return {
    config: ports.config,
    budget: ports.budget,
    limitsOf: (id: ProviderId) => ({
      capKind: capKindOf(providerLimits(ports.config, id)?.window ?? 'month'),
    }),
  };
}

/** The estimate lines a cap blocks today, as the engine's line keys (`Estimate.perProvider[].blocked`). */
function blockedLines(estimate: Estimate): Set<LineKey> {
  return new Set(
    estimate.perProvider.filter((p) => p.blocked !== null).map((p) => lineKey(p.stage, p.providerId)),
  );
}

/**
 * Decision 54 with WP7's `confirmationOf`: an operator's sent confirmation covers the definition when it names at
 * least the worst-case figures (every line, blocked ones included) — the figures `needsConfirmation` shows and the
 * store records, so a provider back from a cap next month is still covered.
 */
export function sentCovers(c: Confirmation, estimate: Estimate): boolean {
  const worst = confirmationOf(estimate);
  return c.pence !== null && c.calls !== null && c.pence >= worst.pence && c.calls >= worst.calls;
}

/**
 * `needsConfirmation` (decision 42 shape): the worst-case figures to confirm, with the stored confirmation, when a run
 * needs one and the stored confirmation does not cover it; else null. Never writes the confirmation (spec §7).
 */
export function needsConfirmation(
  def: Pick<SearchDefinition, 'confirmedCostPence' | 'confirmedCalls'>,
  estimate: Estimate,
  ports: Ports,
): DefinitionResponse['needsConfirmation'] {
  const stored: Confirmation = { pence: def.confirmedCostPence, calls: def.confirmedCalls };
  if (confirmationNeeded(confirmationContext(ports), estimate, blockedLines(estimate), stored) === null)
    return null;
  const worst = confirmationOf(estimate);
  return {
    estimateMicroGbp: estimate.perProvider.reduce((a, p) => a + p.costMicroGbp, 0),
    totalCalls: worst.calls,
    confirmedCostPence: def.confirmedCostPence,
    confirmedCalls: def.confirmedCalls,
  };
}

/** A partial record as the plain JSON object the contract declares (absent keys stay absent). */
function plain<V>(r: Partial<Record<string, V>>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) out[k] = v;
  return out;
}

/** The stored definition in the contract's shape: notes and onward costs keyed by airport as plain objects. */
function wire(def: SearchDefinition) {
  return {
    ...def,
    destinationNotes: plain(def.destinationNotes),
    onwardCostPence: plain(def.onwardCostPence),
  };
}

/** Spec §10 definition response: the definition, its estimate and `budgetFit`, `needsConfirmation`, `notices`. */
export function definitionResponse(def: SearchDefinition, ctx: RouteContext): DefinitionResponse {
  if (isDraft(def))
    return {
      ...wire(def),
      estimate: null,
      budgetFit: ZERO_BUDGET_FIT,
      needsConfirmation: null,
      notices: [API_TEXT.draftNotice],
    };
  const estimate = ctx.engine.estimate(def, ctx.ports.clock.todayLondon());
  return {
    ...wire(def),
    estimate,
    budgetFit: ctx.engine.budgetFit(def),
    needsConfirmation: needsConfirmation(def, estimate, ctx.ports),
    notices: [],
  };
}

/** The response for a soft-deleted definition: its last state, marked deleted, nothing estimated. */
export function deletedResponse(def: SearchDefinition, ctx: RouteContext): DefinitionResponse {
  return {
    ...wire(def),
    enabled: false,
    deletedAt: ctx.ports.clock.now(),
    estimate: null,
    budgetFit: ZERO_BUDGET_FIT,
    needsConfirmation: null,
    notices: [API_TEXT.deletedNotice],
  };
}

/** A partial update as the definition-update schema yields it: absent fields are `undefined`. */
export type DefinitionPatch = { [K in keyof DefinitionInput]?: DefinitionInput[K] | undefined };

/** Spec §10 PUT: the stored definition with every field the update names replaced (null is a value, as for scheduleCron). */
export function mergeDefinition(e: DefinitionInput, p: DefinitionPatch): DefinitionInput {
  const v = <K extends keyof DefinitionInput>(k: K): DefinitionInput[K] => {
    const x = p[k];
    return x === undefined ? e[k] : x;
  };
  return {
    name: v('name'),
    origins: v('origins'),
    destinations: v('destinations'),
    window: v('window'),
    minNights: v('minNights'),
    maxNights: v('maxNights'),
    cabin: v('cabin'),
    constraints: v('constraints'),
    verification: v('verification'),
    budget: v('budget'),
    providers: v('providers'),
    destinationNotes: v('destinationNotes'),
    onwardCostPence: v('onwardCostPence'),
    scheduleCron: v('scheduleCron'),
    scheduleTz: v('scheduleTz'),
    enabled: v('enabled'),
  };
}

/** The editable part of a stored definition (DefinitionInput), for merging a partial update. */
export function inputOf(def: SearchDefinition): DefinitionInput {
  const {
    id: _id,
    confirmedCostPence: _c,
    confirmedCalls: _cc,
    createdAt: _ca,
    updatedAt: _u,
    deletedAt: _d,
    ...rest
  } = def;
  return rest;
}
```

`apps/api/src/routes/definitions.ts` (new file):

```ts
/** Spec §10 definitions CRUD, both estimate routes and the coverage check; spec §8.2 schedule sync. */
import {
  apiContract,
  budgetScopeLabel,
  countCells,
  type DefinitionInput,
  type SearchDefinition,
  validateSearchSpace,
} from '@gmt/core';
import { confirmationOf, parseCron } from '@gmt/engine';
import { defaultDefinitionInput } from '../defaults.js';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import {
  definitionResponse,
  deletedResponse,
  inputOf,
  mergeDefinition,
  sentCovers,
} from '../read/definitions.js';
import { airportLookup, currentSpace, isDraft } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { getLiveDefinition, oneAtATime, param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

/** The in-flight key of the coverage check, which names no saved definition (decision 54). */
const COVERAGE_CHECK = 'coverage-check';

/** The explicit confirmation a create or update body may carry (decisions 37, 42). */
interface SentConfirmation {
  confirmedCostPence?: number | undefined;
  confirmedCalls?: number | undefined;
}

/**
 * Spec §7, decisions 37, 43 and 54: the stored confirmation is set only from an explicit operator value carrying both
 * pence and calls that cover the worst-case figures, and what is stored is WP7's `confirmationOf(estimate)` (every
 * line, blocked ones included), never the shown totals; otherwise nothing is stored and the response carries
 * needsConfirmation.
 */
function applyConfirmation(
  def: SearchDefinition,
  sent: SentConfirmation,
  ctx: RouteContext,
): SearchDefinition {
  const { confirmedCostPence: pence, confirmedCalls: calls } = sent;
  if (pence === undefined || calls === undefined || isDraft(def)) return def;
  const estimate = ctx.engine.estimate(def, ctx.ports.clock.todayLondon());
  if (!sentCovers({ pence, calls }, estimate)) return def;
  const worst = confirmationOf(estimate);
  ctx.ports.repos.definitions.setConfirmed(def.id, worst);
  return { ...def, confirmedCostPence: worst.pence, confirmedCalls: worst.calls };
}

/** Spec §10 estimate routes: `{ estimate, budgetFit }` so the form shows both before the create click. */
function estimateResponse(def: DefinitionInput | SearchDefinition, ctx: RouteContext) {
  return {
    estimate: ctx.engine.estimate(def, ctx.ports.clock.todayLondon()),
    budgetFit: ctx.engine.budgetFit(def),
  };
}

/** Spec §8.2: register when enabled with a cron, otherwise unregister, in the same request. */
export function syncSchedule(def: SearchDefinition, ctx: RouteContext): void {
  if (def.enabled && def.scheduleCron !== null && def.deletedAt === null) ctx.engine.scheduler.register(def);
  else ctx.engine.scheduler.unregister(def.id);
}

/** True when the save turns a schedule on or changes it (decision 25 judges the monthly fit only then). */
function scheduleChanges(next: DefinitionInput, before: SearchDefinition | null): boolean {
  if (!next.enabled || next.scheduleCron === null) return false;
  return (
    before === null ||
    !before.enabled ||
    before.scheduleCron !== next.scheduleCron ||
    before.scheduleTz !== next.scheduleTz
  );
}

/**
 * Save-time validation of the whole (merged) definition: cron through the scheduler's `parseCron` (spec §8.2, the sole
 * validator), drafts may not be enabled, every named provider must be configured (a production config never offers
 * `fixture`, spec §5.5), then the contract shape, zero-cell windows (422, spec §6.1), `validateSearchSpace` (airports,
 * metro codes, nights, caps, alwaysInclude) and, when the save turns a schedule on or changes it, the monthly fit of
 * every provider-month scope (decision 25), matched by core's scope label (decision 54).
 */
export function validateForSave(
  def: DefinitionInput,
  ctx: RouteContext,
  before: SearchDefinition | null,
): DefinitionInput {
  if (def.scheduleCron !== null) {
    const cron = parseCron(def.scheduleCron, def.scheduleTz);
    if (!cron.ok)
      throw new ApiError(
        422,
        'invalid_cron',
        API_TEXT.invalidCron(cron.reason),
        fieldsDetail([{ field: 'scheduleCron', message: cron.reason }]),
      );
  }
  const configured = new Set(ctx.ports.providers.map((p) => p.id));
  for (const stage of ['discovery', 'verification'] as const) {
    const unknown = def.providers[stage].find((id) => !configured.has(id));
    if (unknown !== undefined)
      throw new ApiError(
        422,
        'unknown_provider',
        API_TEXT.unknownProvider(unknown),
        fieldsDetail([{ field: `providers.${stage}`, message: API_TEXT.unknownProvider(unknown) }]),
      );
  }
  if (isDraft(def)) {
    if (def.enabled)
      throw new ApiError(
        422,
        'draft_cannot_enable',
        API_TEXT.draftCannotEnable,
        fieldsDetail([{ field: 'enabled', message: API_TEXT.draftCannotEnable }]),
      );
    return def;
  }
  const shape = apiContract.definitionCreateRequestSchema.safeParse(def);
  if (!shape.success)
    throw new ApiError(
      422,
      'invalid_definition',
      API_TEXT.invalidDefinition,
      fieldsDetail(issuesToFields(shape.error.issues)),
    );
  const today = ctx.ports.clock.todayLondon();
  if (countCells(currentSpace(def, today)) <= 0)
    throw new ApiError(
      422,
      'zero_cells',
      API_TEXT.zeroCells,
      fieldsDetail([{ field: 'window', message: API_TEXT.zeroCells }]),
    );
  const v = validateSearchSpace(
    def,
    today,
    airportLookup(ctx.ports.repos.airports),
    ctx.ports.config.maxCellsPerDefinition,
  );
  if (!v.ok)
    throw new ApiError(422, 'invalid_definition', API_TEXT.invalidDefinition, fieldsDetail(v.errors));
  if (scheduleChanges(def, before)) {
    const monthScopes = new Set(
      ctx.ports.providers.map((p) => budgetScopeLabel({ kind: 'provider-month', providerId: p.id })),
    );
    const over = ctx.engine
      .budgetFit(def)
      .perScope.filter((s) => monthScopes.has(s.scope) && !s.fits)
      .map((s) => s.scope);
    if (over.length > 0)
      throw new ApiError(
        422,
        'schedule_over_budget',
        API_TEXT.scheduleOverBudget(over),
        fieldsDetail([{ field: 'scheduleCron', message: API_TEXT.scheduleOverBudget(over) }]),
      );
  }
  return def;
}

export const definitionHandlers: HandlerTable = {
  'GET /api/definitions': plain((c, _input, ctx) =>
    c.json(ctx.ports.repos.definitions.list().map((d) => definitionResponse(d, ctx))),
  ),

  'POST /api/definitions': route(
    { request: apiContract.definitionCreateOptionalSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      // why: spec §10: no body creates the plan-aware default, a draft without airports.
      if (body === undefined) {
        const draft = ctx.ports.repos.definitions.create(
          validateForSave(defaultDefinitionInput(ctx.ports.config, ctx.ports.providers), ctx, null),
        );
        return c.json(definitionResponse(draft, ctx), 201);
      }
      const { confirmedCostPence, confirmedCalls, ...def } = body;
      const created = applyConfirmation(
        ctx.ports.repos.definitions.create(validateForSave(def, ctx, null)),
        { confirmedCostPence, confirmedCalls },
        ctx,
      );
      syncSchedule(created, ctx);
      return c.json(definitionResponse(created, ctx), 201);
    },
  ),

  'POST /api/definitions/estimate': route(
    { request: apiContract.definitionCreateRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      const { confirmedCostPence: _p, confirmedCalls: _c, ...def } = body;
      // why: the unsaved body is estimated, not scheduled, so its enabled flag and schedule fit do not matter here.
      validateForSave({ ...def, enabled: false }, ctx, null);
      return c.json(estimateResponse(def, ctx));
    },
  ),

  'GET /api/definitions/:id': plain((c, input, ctx) =>
    c.json(definitionResponse(getLiveDefinition(ctx, param(input, 'id')), ctx)),
  ),

  'PUT /api/definitions/:id': route(
    { request: apiContract.definitionUpdateRequestSchema, query: NO_INPUT },
    (c, input, ctx) => {
      const existing = getLiveDefinition(ctx, param(input, 'id'));
      const { confirmedCostPence, confirmedCalls, ...patch } = input.body;
      const merged = validateForSave(mergeDefinition(inputOf(existing), patch), ctx, existing);
      const updated = applyConfirmation(
        ctx.ports.repos.definitions.update(existing.id, merged),
        { confirmedCostPence, confirmedCalls },
        ctx,
      );
      syncSchedule(updated, ctx);
      return c.json(definitionResponse(updated, ctx));
    },
  ),

  'DELETE /api/definitions/:id': plain((c, input, ctx) => {
    const existing = getLiveDefinition(ctx, param(input, 'id'));
    ctx.ports.repos.definitions.softDelete(existing.id);
    ctx.engine.scheduler.unregister(existing.id);
    return c.json(deletedResponse(existing, ctx));
  }),

  'POST /api/definitions/:id/estimate': plain((c, input, ctx) => {
    const def = getLiveDefinition(ctx, param(input, 'id'));
    if (isDraft(def)) throw new ApiError(422, 'draft_definition', API_TEXT.draftNoEstimate);
    return c.json(estimateResponse(def, ctx));
  }),

  'POST /api/definitions/coverage-check': route(
    { request: apiContract.coverageCheckRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      // why: spec §10: the check runs free Travelpayouts month tiles and never calls a billed provider.
      if (!ctx.ports.providers.some((p) => p.id === 'travelpayouts'))
        throw new ApiError(409, 'coverage_check_unavailable', API_TEXT.coverageCheckUnavailable);
      return oneAtATime(ctx, COVERAGE_CHECK, async () => c.json(await ctx.engine.coverageCheck(body)));
    },
  ),
};
```

`apps/api/src/routes/index.ts` (replace the file):

```ts
/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { definitionHandlers } from './definitions.js';
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
  ...definitionHandlers,
};
```

The boot matrix gains its production row for a definition naming `fixture` (spec §5.5; it needs this task's route):

`apps/api/test/bootstrap/app.matrix.test.ts` — find:

```ts
import { cleanEnv, SENTINEL_AUTH, silentLog } from '../helpers/env.js';
```

`apps/api/test/bootstrap/app.matrix.test.ts` — replace with:

```ts
import { errorOf } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_AUTH, silentLog } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
```

`apps/api/test/bootstrap/app.matrix.test.ts` — find:

```ts
  it('development with the phrase but a plain .db path offers no fixture', async () => {
```

`apps/api/test/bootstrap/app.matrix.test.ts` — replace with:

```ts
  it('production refuses a definition naming the fixture provider with 422 unknown_provider', async () => {
    const running = await bootWith(envFor({}));
    try {
      const refused = await running.app.request('http://localhost:3000/api/definitions', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: basic('operator', SENTINEL_AUTH),
          'content-type': 'application/json',
          'x-requested-with': 'get-me-there',
        },
        body: JSON.stringify(exampleDefinitionInput()),
      });
      expect(refused.status).toBe(422);
      expect((await errorOf(refused)).code).toBe('unknown_provider');
    } finally {
      await running.close();
    }
  });

  it('development with the phrase but a plain .db path offers no fixture', async () => {
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/definitions.test.ts test/bootstrap/app.matrix.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 19 + 14 tests (the definitions suite, including the real-engine confirmation test, and the boot matrix with its new row); typecheck clean.

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.9a**: in `apps/api/src/routes/definitions.ts` replace

```ts
  ctx.ports.repos.definitions.setConfirmed(def.id, worst);
  return { ...def, confirmedCostPence: worst.pence, confirmedCalls: worst.calls };
```

  with

```ts
  ctx.ports.repos.definitions.setConfirmed(def.id, { pence, calls });
  return { ...def, confirmedCostPence: pence, confirmedCalls: calls };
```

  Fails: “shows and stores the worst case over every line, blocked ones included (WP7 confirmationOf, decision 54)”.

- **8.9b**: in `apps/api/src/routes/definitions.ts` replace

```ts
return oneAtATime(ctx, COVERAGE_CHECK, async
```

  with

```ts
return oneAtATime(ctx, `${COVERAGE_CHECK}:${Math.random()}`, async
```

  Fails: “one coverage check at a time (decision 54): a second while one runs is 429 already_running”.

- **8.9c**: in `apps/api/src/routes/definitions.ts` replace

```ts
    if (unknown !== undefined)
```

  with

```ts
    if (unknown !== undefined && false)
```

  Fails: “production refuses a definition naming the fixture provider with 422 unknown_provider”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: definitions CRUD, plan-preset draft, worst-case confirmation, cron, provider and schedule-fit validation, estimates, coverage check, one at a time"
```

### Task 8.10: Executions: start, read, cancel, resume; single-cell verify with membership validation; one at a time

**Files:**
- Create: `apps/api/test/helpers/seed.ts`, `apps/api/src/read/executions.ts`, `src/routes/executions.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/executions.test.ts`

**Interfaces:**
- Consumes: `engine.start` (`StartOptions` with `confirmCostPence` and `confirmCalls`), `engine.resume/cancel`, `engine.verifyCell(definitionId, cell, opts)` with `VerifyCellOptions`, `StartResult` (WP7); `ExecutionsRepo.get`, `CellsRepo.buckets/outcomes`, `LedgerRepo.countsFor`, `NotificationsRepo.wasSent`, `RowRejected` (WP3); the real `BudgetGuard` (`reserve(...).finalise(...)`) for test ledger rows; `microGbpToPence`, `PRICE_UNCONFIRMED`; `executionResponseSchema`, `startExecutionRequestSchema`, `startExecutionResponseSchema`, `verifyCellRequestSchema` (core).
- Produces: `executionResponse`, `executionSummary` (with the snapshot's `expandTop`), `overrunOf`, `planCallsOf`, `OVERRUN_TOLERANCE`, `hoursSince`, `startError`; routes `POST /api/definitions/:id/executions`, `GET /api/executions/:id`, `POST /api/executions/:id/cancel`, `POST /api/executions/:id/resume`, `POST /api/cells/verify`; test-only `seeder(ports)` (`execution`, `cells`, `tile`, `tileError`, `reuse`, `verified`, `ledger`, `routeLowest`, `id`), `cell`, `at`.

HTTP mapping of `StartResult` (spec §8.1, §10): `ok` → `202 { executionId }` for start and verify, `200` with the execution for resume and cancel; `not_found` → 404; `active`, `cap`, `confirm`, `disabled` → 409 with the engine's code, message and details (URL-stripped); `window` → 422. WP3's `RowRejected('active')` from a start or verify that lost the race to create the execution is 409 `active` too (`onError`). A start and a verify pass `confirmCostPence` and `confirmCalls` through only when sent (decisions 37, 43, 54). `/resume` always passes `{ manual: true }`. Start, resume and verify run inside `oneAtATime` keyed by the definition (429 `already_running`, decision 54); another definition is never held up. `/api/cells/verify` checks, in order: the definition exists (404), it has a verification provider (422 `no_verification_provider`), the cell is in the current resolved space (422 `cell_not_in_space`), both airports exist (422 `unknown_airport`); the engine enforces one active child per cell (409 `active`). Execution reads add `overrun` (spec §8.1: more than 10% above the stored estimate's pre-factor `planCalls`, discovery judged on distinct tiles and verification on calls, decision 43), `parityBreak` (the operator notification was sent) and `disabledProviders`.

The refusals are tested twice (review TS-1): once mapped from a mocked `StartResult`, and once through the real engine — a definition with a one-call cap is 409 `cap`, and a run above `SOFT_CONFIRM` (the fixture billed at 10p a call) is 409 `confirm` with its figures, in both cases with no ledger row and no started execution; resent with the refusal's `estimatePence` and `totalCalls`, the run starts. The overrun test reads real ledger rows written through the budget guard (review TS-6).

`test/helpers/seed.ts` writes test data through WP3's atomic units (`writeTile`, `writeTileError`, `writeVerifiedCell`, `copyReused`) and the real budget guard, so route tests control every value while every repository invariant holds (synthetic gate, priced ⇔ price, roll-ups, unique keys, WP7's rule that a verified cell's price is its cheapest confirmed offer and a cell with none carries the `price-unconfirmed` reason); executions get generated ids, named in tests.

- [ ] **Step 1: Write the failing test**

`apps/api/test/helpers/seed.ts` (new file):

```ts
// Test data written through WP3's repositories and their atomic units (writeTile, writeTileError, writeVerifiedCell,
// copyReused), so every repository invariant holds: synthetic gate, priced ⇔ price, roll-ups, UNIQUE keys. Executions
// get generated ids; tests name them ('E1') and read the real id back with `id(name)`.
import {
  asIata,
  asIsoDate,
  type BaggageSnapshot,
  type Booking,
  type Cabin,
  type CellKey,
  type DefinitionSnapshot,
  daysBetween,
  type ExecutionStatus,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  londonDateOf,
  type NormalisedItinerary,
  PRICE_UNCONFIRMED,
  type ProviderId,
  resolveWindow,
  type SearchDefinition,
  type Segment,
  type SelectionReason,
  type SuppliedField,
} from '@gmt/core';
import type { VerifiedCellWrite } from '@gmt/db';
import type { Ports } from '../../src/wiring.js';
import { T0 } from './harness.js';

const HOUR = 3_600_000;
/** An instant `hours` after the harness T0 (negative = before). */
export const at = (hours: number): IsoDateTime => isoDateTimeOfEpochMs(Date.parse(T0) + hours * HOUR);
export const cell = (o: string, d: string, dep: string, ret: string): CellKey => ({
  origin: asIata(o),
  destination: asIata(d),
  departureDate: asIsoDate(dep),
  returnDate: asIsoDate(ret),
});
const withNights = (c: CellKey) => ({ ...c, nights: daysBetween(c.departureDate, c.returnDate) });

function snapshotOf(def: SearchDefinition, resolvedAt: IsoDateTime): DefinitionSnapshot {
  const w = resolveWindow(def.window, londonDateOf(resolvedAt));
  return {
    ...def,
    resolved: {
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: w.departureFrom,
      departureTo: w.departureTo,
      minNights: def.minNights,
      maxNights: def.maxNights,
    },
    resolvedAt,
    windowClamped: w.clamped,
    droppedAlwaysInclude: [],
  };
}

export interface SeedOffer {
  hash: string;
  pricePence: number;
  fetchedAt: IsoDateTime;
  seller?: string;
  stopsOut?: number;
  /** null: baggage not supplied (its constraints become unverified). */
  baggage?: BaggageSnapshot | null;
  /** false: the final step did not confirm the price (no `price` supplied field, decisions 27, 37). */
  confirmed?: boolean;
  maxAgeHours?: number | 'unknown';
  /** The stored booking, as an adapter wrote it; the api re-validates it on the way out (decision 54). */
  booking?: Booking;
}

/** A synthetic itinerary for the cell: `stopsOut` clearly synthetic connection points (AAA, BBB), one inbound leg. */
function itineraryOf(c: CellKey, hash: string, stopsOut: number): NormalisedItinerary {
  const path = [c.origin, ...['AAA', 'BBB', 'CCC'].slice(0, stopsOut).map(asIata), c.destination];
  const outbound: Segment[] = path.slice(0, -1).map((from, i) => ({
    marketingCarrier: 'BA',
    flightNumber: 100 + i,
    from,
    to: path[i + 1] ?? c.destination,
    departLocal: `${c.departureDate}T${String(8 + i * 3).padStart(2, '0')}:00`,
    arriveLocal: `${c.departureDate}T${String(10 + i * 3).padStart(2, '0')}:00`,
    durationMinutes: 120,
  }));
  const inbound: Segment[] = [
    {
      marketingCarrier: 'BA',
      flightNumber: 200,
      from: c.destination,
      to: c.origin,
      departLocal: `${c.returnDate}T10:00`,
      arriveLocal: `${c.returnDate}T18:00`,
      durationMinutes: 480,
    },
  ];
  return {
    hash,
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
    nights: daysBetween(c.departureDate, c.returnDate),
    outbound,
    inbound,
    outboundMinutes: 480,
    inboundMinutes: 480,
    stopsOut,
    stopsIn: 0,
    layovers: [],
    airportChange: false,
    marketingCarriers: ['BA'],
  };
}

const PROVIDER: ProviderId = 'fixture';
const CABIN: Cabin = 'economy';
const POS = 'GB';

export function seeder(ports: Ports) {
  const { repos } = ports;
  const ids = new Map<string, string>();
  const defs = new Map<string, SearchDefinition>();
  const id = (name: string): string => {
    const v = ids.get(name);
    if (v === undefined) throw new Error(`no seeded execution ${name}`);
    return v;
  };
  return {
    id,

    /** An execution of `def` in `status`, started at `startedAt`; a child when `child` is given. */
    execution(
      name: string,
      s: {
        def: SearchDefinition;
        status: ExecutionStatus;
        startedAt: IsoDateTime;
        finishedAt?: IsoDateTime | null;
        child?: CellKey;
      },
    ): string {
      const e = repos.executions.create({
        definitionId: s.def.id,
        isChild: s.child !== undefined,
        cell: s.child ?? null,
        snapshot: snapshotOf(s.def, s.startedAt),
        estimate: null,
        trigger: 'manual',
        status: 'running',
      });
      repos.executions.setStatus(e.id, s.status, {
        startedAt: s.startedAt,
        finishedAt: s.finishedAt ?? null,
      });
      ids.set(name, e.id);
      defs.set(name, s.def);
      return e.id;
    },

    /** Seeds the cells (not_run per discovery provider) and, when given, the verification selection, once per execution. */
    cells(
      name: string,
      cells: CellKey[],
      o: {
        discovery?: ProviderId[];
        verification?: ProviderId[];
        selected?: Array<{ cell: CellKey; reason: SelectionReason }>;
      } = {},
    ): void {
      const exec = id(name);
      repos.cells.seed(exec, cells.map(withNights), o.discovery ?? [PROVIDER]);
      if (o.selected !== undefined)
        repos.cells.seedVerification(exec, o.selected, cells, o.verification ?? [PROVIDER]);
    },

    /** One discovery tile covering `c`: priced with a calendar price, or empty / no_data (spec §7 atomic unit). */
    tile(
      name: string,
      c: CellKey,
      s: {
        status: 'priced' | 'empty' | 'no_data';
        fetchedAt: IsoDateTime;
        pricePence?: number;
        lastError?: string | null;
        maxAgeHours?: number | null;
        tileIndex?: number;
      },
    ): void {
      const priced = s.status === 'priced';
      const pricePence = s.pricePence ?? 45_000;
      repos.cells.writeTile(id(name), PROVIDER, {
        tileIndex: s.tileIndex ?? 0,
        cells: [c],
        discards: 0,
        prices: priced
          ? [
              {
                providerId: PROVIDER,
                sourceKind: 'synthetic',
                cabin: CABIN,
                cell: c,
                pricePence,
                priceNativeMinor: pricePence,
                currencyNative: 'GBP',
                fx: { converted: false },
                pointOfSale: POS,
                fetchedAt: s.fetchedAt,
                providerObservedAt: null,
                maxAgeHours: s.maxAgeHours === undefined ? 24 : s.maxAgeHours,
                vendorLink: null,
                reusedFromExecutionId: null,
              },
            ]
          : [],
        outcomes: [
          {
            ...c,
            status: s.status,
            reason: null,
            lastError: s.lastError ?? null,
            fetchedAt: s.fetchedAt,
            minPence: priced ? pricePence : null,
            cabin: CABIN,
            pointOfSale: POS,
            sourceKind: 'synthetic',
          },
        ],
      });
    },

    /** A discovery tile error for `cells` (attempts + 1). */
    tileError(name: string, cells: CellKey[], reason: string, lastError: string | null): void {
      repos.cells.writeTileError(id(name), PROVIDER, cells, reason, lastError);
    },

    /** Copies `from`'s discovery results for `cells` into `name` as reused rows (spec §8.1 reuse). */
    reuse(name: string, from: string, cells: CellKey[], newerThan: IsoDateTime): void {
      const def = defs.get(name);
      if (def === undefined) throw new Error(`no seeded execution ${name}`);
      const copies = repos.calendarPrices
        .reuseCandidates(def.id, PROVIDER, CABIN, POS, 'synthetic', cells, newerThan)
        .filter((c) => c.outcome.executionId === id(from));
      repos.cells.copyReused(id(name), PROVIDER, copies, {
        pointOfSale: POS,
        sourceKind: 'synthetic',
        newerThan,
      });
    },

    /** One verified cell: its itineraries, offers and observations and its priced outcome (spec §7 atomic unit). */
    verified(name: string, c: CellKey, offers: SeedOffer[]): void {
      const itineraries: VerifiedCellWrite['itineraries'] = offers.map((o) => {
        const itinerary = itineraryOf(c, o.hash, o.stopsOut ?? 0);
        const baggage = o.baggage === undefined ? { checkedBags: 1 } : o.baggage;
        const suppliedFields: SuppliedField[] = [
          'segments',
          'segmentTimes',
          'segmentCabins',
          'selfTransfer',
          'seller',
        ];
        if (o.confirmed !== false) suppliedFields.push('price');
        if (baggage !== null) suppliedFields.push('baggage');
        return {
          itinerary,
          offers: [
            {
              offer: { itineraryHash: o.hash, providerId: PROVIDER, seller: o.seller ?? 'BA', cabin: CABIN },
              observation: {
                pricePence: o.pricePence,
                priceNativeMinor: o.pricePence,
                currencyNative: 'GBP',
                fx: { converted: false },
                taxesIncluded: true,
                selfTransfer: false,
                segmentCabins: [...itinerary.outbound, ...itinerary.inbound].map(() => CABIN),
                baggage,
                fareConditions: null,
                booking: o.booking ?? { kind: 'none' },
                bookingExpiresAt: null,
                suppliedFields,
                partialExpansion: false,
                provenance: {
                  providerId: PROVIDER,
                  sourceKind: 'synthetic',
                  fetchedAt: o.fetchedAt,
                  maxAgeHours: o.maxAgeHours ?? 0,
                  fx: { converted: false },
                  pointOfSale: POS,
                  cabin: CABIN,
                },
              },
            },
          ],
        };
      });
      const fetchedAt = [...offers.map((o) => o.fetchedAt)].sort()[0] ?? T0;
      // why: WP7's write rule (decision 45): the cell's price is the cheapest confirmed one, and a cell with no
      // confirmed offer carries the `price-unconfirmed` reason.
      const confirmed = offers.filter((o) => o.confirmed !== false);
      repos.cells.writeVerifiedCell(id(name), PROVIDER, {
        cell: c,
        itineraries,
        outcome: {
          ...c,
          status: 'priced',
          reason: confirmed.length === 0 ? PRICE_UNCONFIRMED : null,
          lastError: null,
          fetchedAt,
          minPence: Math.min(...(confirmed.length > 0 ? confirmed : offers).map((o) => o.pricePence)),
          cabin: CABIN,
          pointOfSale: POS,
          sourceKind: 'synthetic',
        },
      });
    },

    /**
     * Ledger rows as http-kit leaves them (review TS-6): for each tile index, `attempts` upstream calls through the real
     * budget guard, the first one per tile counting as the tile.
     */
    ledger(name: string, tiles: Array<{ tileIndex: number; attempts: number }>): void {
      for (const t of tiles)
        for (let attempt = 1; attempt <= t.attempts; attempt++)
          ports.budget
            .reserve({
              providerId: PROVIDER,
              executionId: id(name),
              tileIndex: t.tileIndex,
              costMicroGbp: ports.config.providers.fixture?.costMicroGbp ?? 0,
              httpAttempt: attempt,
              endpointPath: '/calendar',
            })
            .finalise({ outcome: 'ok', httpStatus: 200, durationMs: 1 });
    },

    /** One point of the route-level lowest-price series (spec §7 route_price_history). */
    routeLowest(s: {
      origin: string;
      destination: string;
      date: string;
      pricePence: number;
      fetchedAt: IsoDateTime;
    }): void {
      repos.routeHistory.upsert([
        {
          origin: asIata(s.origin),
          destination: asIata(s.destination),
          cabin: 'unknown',
          providerId: PROVIDER,
          date: asIsoDate(s.date),
          lowestPricePence: s.pricePence,
          fetchedAt: s.fetchedAt,
        },
      ]);
    },
  };
}

export type Seeder = ReturnType<typeof seeder>;
```

`apps/api/test/routes/executions.test.ts` (new file):

```ts
// Spec §8.1, §10 executions: start, read, cancel, resume; single-cell verify with membership validation.
import { apiContract, asIata, asIsoDate, cellKeyString, generateCells } from '@gmt/core';
import { RowRejected } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cellInSpace } from '../../src/read/space.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const EXEC = apiContract.executionResponseSchema;
const STARTED = apiContract.startExecutionResponseSchema;
const small = () => exampleDefinitionInput({ window: SMALL_WINDOW, minNights: 10, maxNights: 10 });

async function execution(x: Harness, id: string) {
  return expectContract(await x.request(`/api/executions/${id}`), 'GET', '/api/executions/:id', EXEC);
}

describe('POST /api/definitions/:id/executions and GET /api/executions/:id (spec §8.1, §10)', () => {
  it('starts a run through the engine and reports progress per stage × provider, every budget scope and the ledger', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(202);
    const { executionId } = await expectContract(res, 'POST', '/api/definitions/:id/executions', STARTED);
    const e = await execution(x, executionId);
    expect(e.trigger).toBe('manual');
    expect(e.progress.find((p) => p.stage === 'discovery' && p.providerId === 'fixture')?.total).toBe(4);
    expect(e.progress.some((p) => p.stage === 'verification' && p.providerId === 'fixture')).toBe(true);
    expect(e.budget.map((b) => b.scope)).toEqual(
      expect.arrayContaining([
        'execution-calls',
        'execution-free-calls',
        'execution-cost',
        'provider-month:fixture',
        'provider-lifetime:fixture',
        'global-month',
      ]),
    );
    expect(e.ledger.perProvider.every((p) => p.providerId === 'fixture')).toBe(true);
    expect([e.parityBreak, e.overrun, e.disabledProviders]).toEqual([false, false, []]);
  });

  it('passes the confirmation pence and calls to the engine (decisions 37, 43)', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const start = vi.spyOn(x.engine, 'start').mockResolvedValue({ ok: true, executionId: 'e1' });
    await x.request(`/api/definitions/${def.id}/executions`, {
      json: { confirmCostPence: 500, confirmCalls: 40 },
    });
    expect(start).toHaveBeenCalledWith(def.id, {
      trigger: 'manual',
      confirmCostPence: 500,
      confirmCalls: 40,
    });
    await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(start).toHaveBeenLastCalledWith(def.id, { trigger: 'manual' });
  });

  it.each([
    ['active', 409],
    ['cap', 409],
    ['confirm', 409],
    ['disabled', 409],
    ['window', 422],
    ['not_found', 404],
  ] as const)('maps StartResult %s to %i with the engine message and details', async (code, status) => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    vi.spyOn(x.engine, 'start').mockResolvedValue({
      ok: false,
      code,
      message: `refused: ${code} execution-calls cap 10, current 9, requested 5`,
      details: { scope: 'execution-calls', estimatePence: 500, totalCalls: 40 },
    });
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(status);
    const e = await errorOf(res);
    expect(e.code).toBe(code);
    expect(e.message).toContain('cap 10');
    expect(e.details).toMatchObject({ scope: 'execution-calls', totalCalls: 40 });
  });

  it('404 for an unknown execution', async () => {
    const x = await harness();
    const res = await x.request('/api/executions/nope');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('execution_not_found');
  });

  it('flags a discovery overrun on distinct tiles from real ledger rows, never on calls (decision 43, review TS-6)', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    const planned = (name: string) => {
      const id = s.execution(name, { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
      x.ports.repos.executions.patch(id, {
        estimate: {
          cells: 4,
          perProvider: [
            {
              providerId: 'fixture',
              stage: 'discovery',
              calls: 10,
              planCalls: 10,
              costMicroGbp: 0,
              costPence: 0,
              seconds: 1,
              blocked: null,
            },
          ],
          totalCalls: 10,
          totalPlanCalls: 10,
          totalCostMicroGbp: 0,
          totalCostPence: 0,
          seconds: 1,
          assumptions: [],
          windowClamped: false,
          retryFactor: 1.2,
        },
      });
      return id;
    };
    const tiles = (n: number, attempts: number) =>
      Array.from({ length: n }, (_, i) => ({ tileIndex: i, attempts }));
    const paged = planned('E-paged');
    // why: ten tiles as planned, each paging three times: thirty calls, but no overrun
    s.ledger('E-paged', tiles(10, 3));
    const paging = await execution(x, paged);
    expect([paging.ledger.calls, paging.ledger.tiles, paging.overrun]).toEqual([30, 10, false]);
    const extra = planned('E-extra');
    s.ledger('E-extra', tiles(12, 1));
    const over = await execution(x, extra);
    expect([over.ledger.tiles, over.overrun]).toEqual([12, true]);
  });
});

describe('cancel and resume (spec §8.1 Resume, §10)', () => {
  it('cancel: 409 when the engine refuses, 200 with the execution when it accepts', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    s.execution('E-done', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    vi.spyOn(x.engine, 'cancel').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const refused = await x.request(`/api/executions/${s.id('E-done')}/cancel`, { method: 'POST', json: {} });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe('not_cancellable');
    const ok = await x.request(`/api/executions/${s.id('E-done')}/cancel`, { method: 'POST', json: {} });
    await expectContract(ok, 'POST', '/api/executions/:id/cancel', EXEC);
  });

  it('resume is always manual and maps a lost compare-and-set or an active sibling to 409', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    s.execution('E-cancelled', { def, status: 'cancelled', startedAt: at(-2), finishedAt: at(-1) });
    const resume = vi
      .spyOn(x.engine, 'resume')
      .mockResolvedValueOnce({ ok: true, executionId: s.id('E-cancelled') })
      .mockResolvedValueOnce({
        ok: false,
        code: 'active',
        message: 'another execution is active',
        details: null,
      });
    const ok = await x.request(`/api/executions/${s.id('E-cancelled')}/resume`, { method: 'POST', json: {} });
    await expectContract(ok, 'POST', '/api/executions/:id/resume', EXEC);
    expect(resume).toHaveBeenCalledWith(s.id('E-cancelled'), { manual: true });
    const lost = await x.request(`/api/executions/${s.id('E-cancelled')}/resume`, {
      method: 'POST',
      json: {},
    });
    expect(lost.status).toBe(409);
    expect((await errorOf(lost)).code).toBe('active');
  });
});

describe('POST /api/cells/verify (spec §8.1 Single-cell verification)', () => {
  const inside = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');

  it.each([
    ['departure outside the window', cell('LHR', 'JFK', '2027-09-01', '2027-09-11')],
    ['nights outside the range', cell('LHR', 'JFK', '2026-11-02', '2026-11-27')],
    ['origin not in the definition', cell('LGW', 'JFK', '2026-11-02', '2026-11-12')],
  ])('422 cell_not_in_space: %s, without calling the engine', async (_label, c) => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const spy = vi.spyOn(x.engine, 'verifyCell');
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: c } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('cell_not_in_space');
    expect(spy).not.toHaveBeenCalled();
  });

  it('422 no_verification_provider when the definition has none', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('no_verification_provider');
  });

  it('creates a child execution for a member cell; 409 when a child is active for it', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(202);
    const { executionId } = await expectContract(res, 'POST', '/api/cells/verify', STARTED);
    expect((await execution(x, executionId)).isChild).toBe(true);
    vi.spyOn(x.engine, 'verifyCell').mockResolvedValue({
      ok: false,
      code: 'active',
      message: 'a child is active for this cell',
      details: null,
    });
    expect(
      (await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } })).status,
    ).toBe(409);
  });

  it('cellInSpace agrees with generateCells on a small space and its neighbours', () => {
    const space = {
      origins: [asIata('LHR')],
      destinations: [asIata('JFK')],
      departureFrom: asIsoDate('2026-11-02'),
      departureTo: asIsoDate('2026-11-04'),
      minNights: 1,
      maxNights: 2,
    };
    const members = new Set(generateCells(space).map(cellKeyString));
    let checked = 0;
    for (const o of ['LHR', 'LGW'])
      for (const d of ['JFK', 'EWR'])
        for (let dep = 1; dep <= 5; dep++)
          for (let n = 0; n <= 3; n++) {
            const ret = new Date(Date.UTC(2026, 10, dep + n)).toISOString().slice(0, 10);
            const c = cell(o, d, `2026-11-0${dep}`, ret);
            expect(cellInSpace(space, c)).toBe(members.has(cellKeyString(c)));
            checked++;
          }
    expect([checked, members.size]).toEqual([80, 6]);
  });
});

describe('refusals with the real engine, the active race, and one request at a time (review TS-1, decision 54)', () => {
  const ledgerRows = (x: Harness) =>
    x.ports.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM provider_requests').get()?.n ?? -1;
  const startedRuns = (x: Harness, defId: string) =>
    x.ports.repos.executions
      .listForDefinition(defId, { limit: 10, includeChildren: true })
      .filter((e) => e.status === 'running' || e.status === 'completed').length;

  it('a run over its call cap is 409 cap before any provider call', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create({
      ...small(),
      budget: { maxCalls: 1, maxFreeCalls: 1, maxCostMicroGbp: 10_000_000 },
    });
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('cap');
    expect([ledgerRows(x), startedRuns(x, def.id)]).toEqual([0, 0]);
  });

  it('an unconfirmed run above SOFT_CONFIRM is 409 confirm with its figures; resent with them, it starts', async () => {
    const x = await harness({ FIXTURE_COST_MICRO_GBP: '100000' });
    const def = x.ports.repos.definitions.create(small());
    const refused = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(refused.status).toBe(409);
    const e = await errorOf(refused);
    expect(e.code).toBe('confirm');
    expect([ledgerRows(x), startedRuns(x, def.id)]).toEqual([0, 0]);
    const figures = z.object({ estimatePence: z.number(), totalCalls: z.number() }).parse(e.details);
    const ok = await x.request(`/api/definitions/${def.id}/executions`, {
      json: { confirmCostPence: figures.estimatePence, confirmCalls: figures.totalCalls },
    });
    expect(ok.status).toBe(202);
  });

  it("WP3's RowRejected('active') from a lost race is 409 active", async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    vi.spyOn(x.engine, 'start').mockRejectedValue(
      new RowRejected('active', 'another execution of this definition is active'),
    );
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('active');
  });

  it('a verify passes its confirmation on to the engine', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const verify = vi.spyOn(x.engine, 'verifyCell').mockResolvedValue({ ok: true, executionId: 'c1' });
    const c = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    await x.request('/api/cells/verify', {
      json: { definitionId: def.id, cell: c, confirmCostPence: 7, confirmCalls: 6 },
    });
    expect(verify).toHaveBeenCalledWith(def.id, c, { confirmCostPence: 7, confirmCalls: 6 });
  });

  it('a second run or verify of a definition while one is in flight is 429 already_running', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    let release: (() => void) | undefined;
    vi.spyOn(x.engine, 'start')
      .mockResolvedValue({ ok: true, executionId: 'e2' })
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve({ ok: true, executionId: 'e1' }))),
      );
    const first = x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(second.status).toBe(429);
    expect((await errorOf(second)).code).toBe('already_running');
    const verify = await x.request('/api/cells/verify', {
      json: { definitionId: def.id, cell: cell('LHR', 'JFK', '2026-11-02', '2026-11-12') },
    });
    expect(verify.status).toBe(429);
    const other = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'another' }));
    vi.spyOn(x.engine, 'verifyCell').mockResolvedValue({ ok: true, executionId: 'c1' });
    const elsewhere = await x.request('/api/cells/verify', {
      json: { definitionId: other.id, cell: cell('LHR', 'JFK', '2026-11-02', '2026-11-12') },
    });
    expect(elsewhere.status).toBe(202); // why: one at a time per definition, not per app
    release?.();
    expect((await first).status).toBe(202);
    expect((await x.request(`/api/definitions/${def.id}/executions`, { json: {} })).status).toBe(202);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/executions.test.ts`
Expected: FAIL: the route tests get 404 `not_found`; the `cellInSpace` property test passes already (Task 8.9).

- [ ] **Step 3: Implement**

`apps/api/src/read/executions.ts` (new file):

```ts
/** Spec §10 `GET /api/executions/:id` and the execution summaries every view lists. */
import {
  type apiContract,
  type Execution,
  type IsoDateTime,
  microGbpToPence,
  type ProviderId,
  type Stage,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { budgetScopes, usageOf } from './usage.js';

export type ExecutionResponse = z.infer<typeof apiContract.executionResponseSchema>;
export type ExecutionSummary = z.infer<typeof apiContract.executionSummarySchema>;
/** Spec §8.1: an overrun is more than 10% above the pre-factor plan. */
export const OVERRUN_TOLERANCE = 1.1;
const STATUSES_WITH_REASON = new Set([
  'paused_budget',
  'paused_error',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
  'interrupted',
  'cancelled',
]);

const HOUR = 3_600_000;
/**
 * Whole hours from `from` to `now`, never negative. why: core's `hoursBetween` is module-private to `labels/age.ts`;
 * this is the one api copy, and every whole-hour age the api reports outside a provenance comes from it (review arch-014).
 */
export function hoursSince(from: IsoDateTime, now: IsoDateTime): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(from)) / HOUR));
}

/**
 * The api-contract `ExecutionSummary` used by every view's `executions` list (newest first). `expandTop` is the run's
 * own, from its snapshot, so "(E outbounds each)" describes the run shown, not today's definition (decision 42).
 */
export function executionSummary(e: Execution, now: IsoDateTime): ExecutionSummary {
  return {
    id: e.id,
    status: e.status,
    isChild: e.isChild,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    ageHours: hoursSince(e.startedAt ?? e.createdAt, now),
    expandTop: e.snapshot.verification.expandTop,
  };
}

/** One (stage, provider) line of the ledger, as the coverage view and the overrun flag read it. */
export interface LedgerLine {
  calls: number;
  costMicroGbp: number;
  tiles: number;
  cacheHits: number;
}

/**
 * Spec §8.1 overrun against the stored estimate's pre-factor `planCalls`. Discovery is judged on distinct tiles, because
 * `planCalls` counts tiles and a paged tile spends a call a page (decision 43); verification on calls.
 */
export function overrunOf(stage: Stage, line: LedgerLine | undefined, planCalls: number | null): boolean {
  if (planCalls === null || planCalls <= 0) return false;
  const spent = stage === 'discovery' ? (line?.tiles ?? 0) : (line?.calls ?? 0);
  return spent > planCalls * OVERRUN_TOLERANCE;
}

/** The stored estimate's pre-factor calls for one (stage, provider), or null without an estimate line. */
export function planCallsOf(e: Execution, stage: Stage, providerId: ProviderId): number | null {
  return (
    e.estimate?.perProvider.find((p) => p.providerId === providerId && p.stage === stage)?.planCalls ?? null
  );
}

/**
 * Spec §10 `GET /api/executions/:id`: status, stage, reason, resumeAfter, progress per stage × provider, budget usage
 * for every scope, estimate vs ledger, overrun and parity flags, disabled providers. A stage with no provider has no
 * progress rows (spec §3 `not_applicable`).
 */
export function executionResponse(ports: Ports, e: Execution): ExecutionResponse {
  const counts = ports.repos.ledger.countsFor(e.id);
  const progress = (['discovery', 'verification'] as const).flatMap((stage) =>
    e.snapshot.providers[stage].map((providerId) => {
      const b = ports.repos.cells.buckets(e.id, stage, providerId);
      return {
        stage,
        providerId,
        buckets: b,
        total: b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run,
      };
    }),
  );
  const disabled = new Set<ProviderId>(
    ports.repos.cells
      .outcomes(e.id)
      .filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')
      .map((o) => o.providerId),
  );
  const overrun = progress.some((p) =>
    overrunOf(
      p.stage,
      counts.perProvider.find((l) => l.providerId === p.providerId && l.stage === p.stage),
      planCallsOf(e, p.stage, p.providerId),
    ),
  );
  return {
    id: e.id,
    definitionId: e.definitionId,
    isChild: e.isChild,
    cell: e.cell,
    status: e.status,
    stage: e.stage,
    reason: STATUSES_WITH_REASON.has(e.status) ? e.errorText : null,
    resumeAfter: e.resumeAfter,
    trigger: e.trigger,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    errorText: e.errorText,
    progress,
    budget: budgetScopes(ports, e.id).map((s) => usageOf(ports, s)),
    estimate: e.estimate,
    // why: "ledger cost, from configured rates" (spec §8.1); core's microGbpToPence never understates spend.
    ledger: {
      calls: counts.calls,
      costMicroGbp: counts.costMicroGbp,
      costPence: microGbpToPence(counts.costMicroGbp),
      tiles: counts.tiles,
      cacheHits: counts.cacheHits,
      perProvider: counts.perProvider.map((p) => ({
        providerId: p.providerId,
        stage: p.stage,
        calls: p.calls,
        costMicroGbp: p.costMicroGbp,
      })),
    },
    parityBreak: ports.repos.notifications.wasSent('parity_break', e.id, e.definitionId),
    overrun,
    disabledProviders: [...disabled].sort(),
  };
}
```

`apps/api/src/routes/executions.ts` (new file):

```ts
/** Spec §8.1, §10: start, read, cancel and resume executions; single-cell verify. */
import { apiContract, type Execution } from '@gmt/core';
import type { StartResult } from '@gmt/engine';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ApiError, type Details, scrubDetails } from '../errors.js';
import { executionResponse } from '../read/executions.js';
import { cellInSpace, currentSpace } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { getLiveDefinition, oneAtATime, param } from './shared.js';
import type { AppEnv, HandlerTable, RouteContext } from './types.js';

type Refusal = Extract<StartResult, { ok: false }>;

const START_STATUS: Record<Refusal['code'], ContentfulStatusCode> = {
  active: 409,
  cap: 409,
  confirm: 409,
  disabled: 409,
  window: 422,
  not_found: 404,
};

/** Spec §10: 409 on an active execution or a cap breach naming the cap; 422 for a zero-cell window. */
export function startError(r: Refusal): ApiError {
  const details: Details | undefined =
    r.details !== null && typeof r.details === 'object' ? scrubDetails(r.details) : undefined;
  return new ApiError(START_STATUS[r.code], r.code, r.message, details);
}

function getExecution(ctx: RouteContext, id: string): Execution {
  const e = ctx.ports.repos.executions.get(id);
  if (e === null) throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound);
  return e;
}

/** `startExecutionResponseSchema` for start and verify (202). */
function accepted(c: Context<AppEnv>, r: StartResult) {
  if (!r.ok) throw startError(r);
  return c.json({ executionId: r.executionId }, 202);
}

/** The confirmation fields a start or verify body carries, passed on only when sent (decisions 37, 43). */
function confirmation(b: { confirmCostPence?: number | undefined; confirmCalls?: number | undefined }) {
  return {
    ...(b.confirmCostPence === undefined ? {} : { confirmCostPence: b.confirmCostPence }),
    ...(b.confirmCalls === undefined ? {} : { confirmCalls: b.confirmCalls }),
  };
}

export const executionHandlers: HandlerTable = {
  'POST /api/definitions/:id/executions': route(
    { request: apiContract.startExecutionRequestSchema, query: NO_INPUT },
    (c, input, ctx) => {
      const def = getLiveDefinition(ctx, param(input, 'id'));
      return oneAtATime(ctx, def.id, async () =>
        accepted(c, await ctx.engine.start(def.id, { trigger: 'manual', ...confirmation(input.body) })),
      );
    },
  ),

  'GET /api/executions/:id': plain((c, input, ctx) =>
    c.json(executionResponse(ctx.ports, getExecution(ctx, param(input, 'id')))),
  ),

  'POST /api/executions/:id/cancel': plain(async (c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    if (!(await ctx.engine.cancel(e.id)))
      throw new ApiError(409, 'not_cancellable', API_TEXT.notCancellable(e.status));
    return c.json(executionResponse(ctx.ports, getExecution(ctx, e.id)));
  }),

  'POST /api/executions/:id/resume': plain((c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    return oneAtATime(ctx, e.definitionId, async () => {
      // why: the API's resume is the operator's manual resume (spec §8.1): it re-enables disabled providers.
      const r = await ctx.engine.resume(e.id, { manual: true });
      if (!r.ok) throw startError(r);
      return c.json(executionResponse(ctx.ports, getExecution(ctx, r.executionId)));
    });
  }),

  'POST /api/cells/verify': route(
    { request: apiContract.verifyCellRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      const def = getLiveDefinition(ctx, body.definitionId);
      if (def.providers.verification.length === 0)
        throw new ApiError(422, 'no_verification_provider', API_TEXT.noVerificationProvider);
      if (!cellInSpace(currentSpace(def, ctx.ports.clock.todayLondon()), body.cell))
        throw new ApiError(422, 'cell_not_in_space', API_TEXT.cellNotInSpace, { cell: body.cell });
      for (const code of [body.cell.origin, body.cell.destination]) {
        if (!ctx.ports.repos.airports.exists(code))
          throw new ApiError(422, 'unknown_airport', API_TEXT.unknownAirport(code));
      }
      return oneAtATime(ctx, def.id, async () =>
        accepted(c, await ctx.engine.verifyCell(def.id, body.cell, confirmation(body))),
      );
    },
  ),
};
```

`apps/api/src/routes/index.ts` (replace the file):

```ts
/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { definitionHandlers } from './definitions.js';
import { executionHandlers } from './executions.js';
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
  ...definitionHandlers,
  ...executionHandlers,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/executions.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 23 tests; typecheck clean.

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.10a**: in `apps/api/src/routes/executions.ts` replace

```ts
      return oneAtATime(ctx, def.id, async () =>
        accepted(c, await ctx.engine.start(
```

  with

```ts
      return oneAtATime(ctx, `${def.id}:${Math.random()}`, async () =>
        accepted(c, await ctx.engine.start(
```

  Fails: “a second run or verify of a definition while one is in flight is 429 already_running”.

- **8.10b**: in `apps/api/src/errors.ts` replace

```ts
    if (err instanceof RowRejected && err.rule === 'active')
      return c.json(envelope('active', err.message), 409);
```

  with nothing.
  Fails: “WP3's RowRejected('active') from a lost race is 409 active”.

- **8.10c**: in `apps/api/src/routes/executions.ts` replace `accepted(c, await ctx.engine.verifyCell(def.id, body.cell, confirmation(body))),` with `accepted(c, await ctx.engine.verifyCell(def.id, body.cell)),`. Fails: “a verify passes its confirmation on to the engine”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: executions with confirmation calls, real-engine refusals, overrun on real ledger tiles, verify with confirmation, one at a time"
```

### Task 8.11: Results (spec §6.5, §6.9, §8.1): basis, dedup, ranking, cap, staleness, truncation, the not-seen and superseded marks, links, children, excluded rows

**Files:**
- Create: `apps/api/src/read/rows.ts`, `src/read/links.ts`, `src/read/pick.ts`, `src/read/coverage.ts`, `src/read/results.ts`, `src/routes/results.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/results.test.ts`

**Interfaces:**
- Consumes: `ItinerariesRepo.observationsForDefinition`, `ItinerariesRepo.latestVerificationOutcomeForCell`, `CalendarPricesRepo.latestPerCell(definitionId, cabin, null)`, `CalendarPricesRepo.heldBy` (Task 8.0), `ExecutionsRepo.listForDefinition`, `CellsRepo.rollUps/outcomes/selected` (WP3); `evaluateConstraints`, `verdictClass`, `unverifiedNames`, `dedupByItinerary`, `rankRows`, `searchLinkFor`, `LINK_ALLOWLIST`, `validateVendorUrl`, `effectiveAge`, `worstCaseAgeHours`, `isStale`, `CONSTRAINT_NAMES`, `isTruncated`, `TRUNCATED_NOTE`, `DEFAULT_DISCOVERY_REFRESH_HOURS` (core).
- Produces: `rows.ts` (`staleness`, `calendarThreshold`, `calendarStaleAfterHours`, `thresholdFor`, `priceCell`, `priceOf`, `verifiedRow`, `calendarRow`, `configuredConstraints`, `latestPerOffer`, `notSeenResolver`, `withNights`), `links.ts` (`safeBooking`, `safeSearchLink`), `pick.ts` (`cheapest`, `pickVerified`, `pickCalendar`; review arch-wp08-r2-008 split them out of `rows.ts`), `coverageSummaryFor`, `SEARCHED`, `loadRows`, `truncationOf`, `confirmedIn`, `chooseBasis`, `assembleResults`, `RESULTS_CAP`; route `GET /api/definitions/:id/results`.

Assembly rules, each pinned by a test below:

1. Rows come from **every** execution of the definition, children included (spec §8.1), or from one execution when `executionId` is given (404 for one of another definition). Scoped to a run, the calendar rows are the latest that run holds per provider and cell — fetched or reused within its refresh window (`heldBy`, decision 58: its coverage counts a reused cell as priced, so its prices must include it, with the source's fetch time and the source outcome's truncation) — not the global latest filtered, so an older run picked from the list still shows its own price after a newer run priced the cell again (review prov-003); the scoped coverage and executions list are that run's. Observations and calendar prices are read in the definition's current cabin.
2. Each offer contributes its latest observation (max `fetchedAt`, tie on id); verdicts are evaluated now against the **current** constraints and requested cabin with the observation's stored supplied fields (spec §6.2).
3. Rows outside the current resolved space are dropped and counted in `excludedByCurrentSpace` (the repositories are read with `space: null` so the count is possible); when that count is non-zero, `basisReason` ends with "· I of N rows are inside the current window and nights range" (review focus 4). An all-excluded verified basis stays verified, so the reason says why the table is empty.
4. Default basis (spec §6.9): `calendar` when the latest parent's snapshot (or, with none, the definition) has no verification provider, or no observation exists; otherwise `verified`. `basisReason` says which; `verificationProviderConfigured` reports the current definition.
5. Verified basis: `dedupByItinerary(rows, now)` then `rankRows(rows, now)`; **all classes are returned**, `failed` last; `cheapest` is the first ranked row (the Results headline).
6. Calendar basis: the latest price per (provider, cell), reused copies ignored, class `unchecked` (assigned directly: `verdictClass` throws without a cabin verdict), `notApplied` = every configured constraint from core's `CONSTRAINT_NAMES`, `booking: none`. A price is `superseded: true` when the **latest parent execution that searched its cell** for that provider (outcome `priced`, `empty` or `no_data`; later in the newest-first list wins, so two runs in one second still order) is newer than the price's execution and found the cell `empty` or `no_data`; a newer run that skipped, failed on or reused the cell does not clear the mark (decisions 54, 58; reviews prov-013, prov-wp08-r2-002). Superseded prices rank after every current price.
7. **Staleness** (spec §3, §8.1; decisions 44, 53, 54, 55, 58): `ageHours` is the effective age from core's `worstCaseAgeHours` — the observed age (never younger than the fetch age), else the fetch age plus a known `maxAgeHours`, else the fetch age alone — and `stale` is core's `isStale` against the threshold (`STALE_AFTER_HOURS` for the verified basis; for the calendar basis `CALENDAR_STALE_AFTER_HOURS`, else the discovery refresh plus the provider's declared age). The web labels an unknown age "vendor's cache age unknown" from `provenance.maxAgeHours`.
8. **Truncation** (decisions 36, 47): a calendar price is `truncated` when its discovery outcome's `last_error` starts with `TRUNCATED_NOTE`, read with core's `isTruncated`; itinerary rows are never truncated.
9. Cheapest per cell is computed here from recomputed verdicts, never read from `search_cells.best_observation_id`.
10. `notSeenInLatest`: the cell's newest `priced | empty` verification outcome is from another execution in which this offer has no observation → `{ ageHours }` of that newer search, or `'unknown'` when that outcome has no `fetchedAt` (review prov-011).
11. **Links** (spec §5.2, decision 54, review SEC-9): a stored `booking` is re-validated with `validateVendorUrl` against its own provider's `LINK_ALLOWLIST` entry and becomes `{ kind: 'none' }` when it fails (a `javascript:` URL, plain http, userinfo, a port, a suffix look-alike, another provider's host, or a post booking off the allowlist; the test runs each, review SEC-R2-3); a search link is kept only when it re-validates; the contract's `vendorLinkSchema` refuses anything else on the way out.
12. At most `limit` rows (default and maximum 1000); `total` counts every row before the cut; `truncated = total > limit`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/results.test.ts` (new file):

```ts
// Spec §6.5, §6.9, §8.1 `/results`: basis, dedup, ranking, cap, staleness (decision 44), notSeenInLatest, children,
// excluded rows (review focus 4), truncation (decisions 36, 47).
import { apiContract, type Constraints, TRUNCATED_NOTE } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

const RESULTS = apiContract.resultsResponseSchema;
const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const C3 = cell('LHR', 'JFK', '2026-11-04', '2026-11-14');
const HOUR = 3_600_000;

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/**
 * Three itinerary-searched rows in one parent execution, one per class under { maxStops: 1, checkedBagRequired: true }:
 * hV £600 verified, hP £400 partially-verified (baggage not supplied), hF £300 failed (two stops).
 */
async function world(constraints: Constraints = { maxStops: 1, checkedBagRequired: true }) {
  const x = await createHarness();
  h = x;
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints }));
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1, C2, C3], { selected: [C1, C2, C3].map((c) => ({ cell: c, reason: 'top_n' as const })) });
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) }]);
  s.verified('E1', C2, [{ hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null }]);
  s.verified('E1', C3, [{ hash: 'hF', pricePence: 30_000, fetchedAt: at(-1), stopsOut: 2 }]);
  return { x, def, s };
}

async function results(x: Harness, defId: string, query = '') {
  return expectContract(
    await x.request(`/api/definitions/${defId}/results${query}`),
    'GET',
    '/api/definitions/:id/results',
    RESULTS,
  );
}

describe('GET /definitions/:id/results, verified basis', () => {
  it('returns every class, ranked by class then price, each row with provenance', async () => {
    const { x, def, s } = await world();
    const r = await results(x, def.id);
    expect(r.basis).toBe('verified');
    expect(r.basisReason).toBe(API_TEXT.basisItinerarySearch);
    expect(r.rows.map((row) => row.itineraryHash)).toEqual(['hV', 'hP', 'hF']);
    expect(r.rows.map((row) => row.verdictClass)).toEqual(['verified', 'partially-verified', 'failed']);
    expect(r.rows[1]?.unverified).toContain('checkedBagRequired');
    expect([r.total, r.truncated, r.excludedByCurrentSpace, r.verificationProviderConfigured]).toEqual([
      3,
      false,
      0,
      true,
    ]);
    expect(r.cheapest?.itineraryHash).toBe('hV'); // the headline row: best class first, then price
    expect(r.rows.map((row) => row.executionId)).toEqual([s.id('E1'), s.id('E1'), s.id('E1')]);
    expect(r.rows[0]?.observationId).not.toBeNull();
    for (const row of r.rows) {
      expect(row.provenance.fetchedAt).toBe(at(-1));
      expect([row.stale, row.ageHours, row.truncated]).toEqual([false, 1, false]);
    }
  });

  it('recomputes verdicts at read time after a constraint edit', async () => {
    const { x, def } = await world();
    const put = await x.request(`/api/definitions/${def.id}`, {
      method: 'PUT',
      json: { constraints: { maxStops: 1, checkedBagRequired: true, maxPricePence: 50_000 } },
    });
    expect(put.status).toBe(200);
    const r = await results(x, def.id);
    expect(r.rows.map((row) => [row.itineraryHash, row.verdictClass])).toEqual([
      ['hP', 'partially-verified'],
      ['hF', 'failed'],
      ['hV', 'failed'],
    ]);
  });

  it('returns stale rows labelled, never hidden (STALE_AFTER_HOURS 192 against the fetch age)', async () => {
    const { x, def } = await world();
    x.clock.advance(200 * HOUR); // 201 h > 192
    const r = await results(x, def.id);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((row) => row.stale && row.ageHours === 201)).toBe(true);
  });

  it('an unknown vendor age is aged by fetchedAt alone and is not stale for that reason (decision 44, spec rev 23)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1, C2], { selected: [C1, C2].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.verified('E1', C1, [{ hash: 'hU', pricePence: 50_000, fetchedAt: at(-1), maxAgeHours: 'unknown' }]);
    s.verified('E1', C2, [{ hash: 'hK', pricePence: 51_000, fetchedAt: at(-1), maxAgeHours: 48 }]);
    x.clock.advance(150 * HOUR); // fetch age 151 h: under 192 alone, over it with a known 48 h
    const rows = (await results(x, def.id)).rows;
    expect(rows.find((r) => r.itineraryHash === 'hU')).toMatchObject({ stale: false, ageHours: 151 });
    expect(rows.find((r) => r.itineraryHash === 'hU')?.provenance.maxAgeHours).toBe('unknown'); // the label's source
    expect(rows.find((r) => r.itineraryHash === 'hK')).toMatchObject({ stale: true, ageHours: 199 });
    x.clock.advance(50 * HOUR); // fetch age 201 h: stale by fetch age, whatever the vendor's age
    expect((await results(x, def.id)).rows.find((r) => r.itineraryHash === 'hU')?.stale).toBe(true);
  });

  it('dedups per itinerary: the best offer (same class, cheaper) is the row, the others are in otherOffers with their class', async () => {
    const { x, def, s } = await world();
    s.verified('E1', C1, [{ hash: 'hV', seller: 'OTA', pricePence: 58_000, fetchedAt: at(-1) }]);
    const r = await results(x, def.id);
    const hv = r.rows.filter((row) => row.itineraryHash === 'hV');
    expect(hv).toHaveLength(1);
    expect(hv[0]?.pricePence).toBe(58_000);
    expect(hv[0]?.otherOffers.map((o) => [o.seller, o.pricePence, o.verdictClass])).toEqual([
      ['BA', 60_000, 'verified'],
    ]);
    expect(hv[0]?.otherOffers[0]?.provenance.providerId).toBe('fixture');
  });

  it('caps at limit with truncated and total; refuses a limit above 1000', async () => {
    const { x, def } = await world();
    const r = await results(x, def.id, '?limit=2');
    expect([r.rows.length, r.total, r.truncated]).toEqual([2, 3, true]);
    expect((await x.request(`/api/definitions/${def.id}/results?limit=1001`)).status).toBe(400);
  });

  it('includes children; marks rows not seen in the newer search and ranks them after seen rows', async () => {
    const { x, def, s } = await world();
    s.execution('E2', { def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.5), child: C1 });
    s.cells('E2', [C1], { discovery: [], selected: [{ cell: C1, reason: 'always_include' }] });
    s.verified('E2', C1, [{ hash: 'hC', pricePence: 65_000, fetchedAt: at(-0.5) }]);
    const r = await results(x, def.id);
    const order = r.rows.map((row) => row.itineraryHash);
    expect(order.indexOf('hC')).toBeLessThan(order.indexOf('hV')); // why: hC is dearer but seen in the latest search
    expect(r.rows.find((row) => row.itineraryHash === 'hC')?.notSeenInLatest).toBeNull();
    expect(r.rows.find((row) => row.itineraryHash === 'hV')?.notSeenInLatest).toEqual({ ageHours: 0 });
    expect(r.rows.find((row) => row.itineraryHash === 'hP')?.notSeenInLatest).toBeNull();
    expect(r.coverage.onDemand).toBe(1);
    expect(r.executions.map((e) => e.id)).toEqual([s.id('E2'), s.id('E1')]); // newest first
  });

  it('every execution summary carries the run snapshot expandTop (decision 42)', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    x.ports.repos.definitions.update(def.id, { verification: { ...def.verification, expandTop: 3 } });
    const r = await expectContract(
      await x.request(`/api/definitions/${def.id}/results`),
      'GET',
      '/api/definitions/:id/results',
      apiContract.resultsResponseSchema,
    );
    expect(r.executions.map((e) => e.expandTop)).toEqual([2]);
  });
  it('scopes to one execution with executionId; 404 for a foreign one', async () => {
    const { x, def, s } = await world();
    expect((await results(x, def.id, `?executionId=${s.id('E1')}`)).total).toBe(3);
    expect((await x.request(`/api/definitions/${def.id}/results?executionId=nope`)).status).toBe(404);
    const other = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'other' }));
    s.execution('EO', { def: other, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    expect((await x.request(`/api/definitions/${def.id}/results?executionId=${s.id('EO')}`)).status).toBe(
      404,
    );
  });

  it('an older run picked with executionId still shows its own price after a newer run priced the cell again (review prov-003)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1]);
    s.tile('Enew', C1, { status: 'priced', pricePence: 47_000, fetchedAt: at(-1) });
    const scoped = await results(x, def.id, `?basis=calendar&executionId=${s.id('Eold')}`);
    expect(scoped.rows.map((r) => [r.pricePence, r.executionId])).toEqual([[45_000, s.id('Eold')]]);
    expect(scoped.executions.map((e) => e.id)).toEqual([s.id('Eold')]);
    const latest = await results(x, def.id, '?basis=calendar');
    expect(latest.rows.map((r) => r.pricePence)).toEqual([47_000]);
  });

  it.each([
    ['a javascript: URL', { kind: 'get', url: 'javascript:alert(1)', host: 'x' }],
    ['plain http', { kind: 'get', url: 'http://www.google.com/travel/flights', host: 'www.google.com' }],
    ['userinfo', { kind: 'get', url: 'https://user:pw@www.google.com/travel', host: 'www.google.com' }],
    [
      'a suffix look-alike',
      { kind: 'get', url: 'https://www.google.com.evil.example/', host: 'www.google.com.evil.example' },
    ],
    ['a port', { kind: 'get', url: 'https://www.google.com:8443/travel', host: 'www.google.com' }],
    [
      "another provider's host",
      { kind: 'get', url: 'https://www.google.com/travel/flights', host: 'www.google.com' },
    ],
    [
      'a post off the allowlist',
      { kind: 'post', url: 'https://evil.example/book', postData: 'a=1', host: 'evil.example' },
    ],
  ] as const)(
    'a stored booking with %s is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)',
    async (_label, booking) => {
      const x = await createHarness();
      h = x;
      const s = seeder(x.ports);
      const def = x.ports.repos.definitions.create(exampleDefinitionInput());
      s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
      s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
      s.verified('E1', C1, [{ hash: 'hJ', pricePence: 50_000, fetchedAt: at(-1), booking }]);
      const r = await results(x, def.id);
      expect(r.rows.map((row) => [row.itineraryHash, row.booking, row.searchLink])).toEqual([
        ['hJ', { kind: 'none' }, null],
      ]);
    },
  );
});

describe('GET /definitions/:id/results, calendar basis (spec §6.9)', () => {
  it('is the default with no verification provider, with the reason, unchecked rows, not-applied list and no search link for synthetic rows', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 168 } },
        constraints: { maxJourneyMinutes: 1500 },
      }),
    );
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1]);
    s.tile('E3', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-3) });
    const r = await results(x, def.id);
    expect(r.basis).toBe('calendar');
    expect(r.basisReason).toBe(API_TEXT.basisNoVerificationProvider);
    expect(r.verificationProviderConfigured).toBe(false);
    const row = r.rows[0];
    expect(row?.verdictClass).toBe('unchecked');
    expect(row?.notApplied).toEqual(['maxJourneyMinutes']);
    expect(row?.booking).toEqual({ kind: 'none' });
    expect(row?.searchLink).toBeNull(); // why: synthetic (fixture) rows have no search link (plan decision 15)
    expect(row?.outbound).toBeNull();
    expect([row?.calendarPriceId === null, row?.observationId, row?.seller, row?.layovers]).toEqual([
      false,
      null,
      null,
      [],
    ]);
    expect([row?.stale, row?.ageHours, row?.truncated]).toEqual([false, 3 + 24, false]);
  });

  it('marks a price from a truncated tile with truncated, from the outcome last_error (decisions 36, 47)', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1, C2]);
    s.tile('E3', C1, {
      status: 'priced',
      pricePence: 45_000,
      fetchedAt: at(-3),
      lastError: `${TRUNCATED_NOTE} (3 pages)`,
    });
    s.tile('E3', C2, { status: 'priced', pricePence: 46_000, fetchedAt: at(-3), tileIndex: 1 });
    const rows = (await results(x, def.id, '?basis=calendar')).rows;
    expect(rows.map((r) => [r.pricePence, r.truncated])).toEqual([
      [45_000, true],
      [46_000, false],
    ]);
  });

  it('a calendar price is stale only past the refresh plus the provider age (spec §8.1)', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1]);
    s.tile('E3', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1), maxAgeHours: 24 });
    x.clock.advance(150 * HOUR);
    expect((await results(x, def.id, '?basis=calendar')).rows[0]?.stale).toBe(true); // 151 + 24 > 168 + 0 declared
  });

  it('is the default when a verification provider exists but nothing was itinerary-searched', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1]);
    s.tile('E3', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-3) });
    expect((await results(x, def.id)).basisReason).toBe(API_TEXT.basisNoObservations);
  });

  it('a calendar price a later search found empty is marked superseded and ranked after current prices (decision 54)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1, C2]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-29) });
    s.tile('Eold', C2, { status: 'priced', pricePence: 50_000, fetchedAt: at(-29), tileIndex: 1 });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('Enew', [C1, C2]);
    s.tile('Enew', C1, { status: 'empty', fetchedAt: at(-2) });
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-2), tileIndex: 1 });
    const r = await results(x, def.id, '?basis=calendar');
    expect(r.rows.map((row) => [row.pricePence, row.superseded])).toEqual([
      [52_000, false],
      [30_000, true],
    ]);
  });

  it('superseded compares with the latest run that searched the cell: a newer run that skipped it does not clear the mark (decision 58)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-50), finishedAt: at(-49) });
    s.cells('E1', [C1]);
    s.tile('E1', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-49) });
    s.execution('E2', { def, status: 'completed', startedAt: at(-20), finishedAt: at(-19) });
    s.cells('E2', [C1, C2]);
    s.tile('E2', C1, { status: 'empty', fetchedAt: at(-19) });
    s.tile('E2', C2, { status: 'priced', pricePence: 31_000, fetchedAt: at(-19), tileIndex: 1 });
    s.execution('E3', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E3', [C1, C2]); // not_run: E3 searched neither cell
    const r = await results(x, def.id, '?basis=calendar');
    // C1: E2's "no fares" still marks E1's price; C2: E2's price is the latest search's own, never superseded
    expect(r.rows.map((row) => [row.pricePence, row.superseded])).toEqual([
      [31_000, false],
      [30_000, true],
    ]);
  });

  it('a run picked with executionId shows the prices it reused, as its coverage counts them (decision 58)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 41_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1, C2]);
    s.reuse('Enew', 'Eold', [C1], at(-100));
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-1), tileIndex: 1 });
    const r = await results(x, def.id, `?basis=calendar&executionId=${s.id('Enew')}`);
    expect(r.rows.map((row) => [row.pricePence, row.provenance.fetchedAt]).sort()).toEqual([
      [41_000, at(-29)],
      [52_000, at(-1)],
    ]);
  });

  it('can be requested explicitly, and ignores reused copies', async () => {
    const { x, def, s } = await world();
    s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-3) });
    s.execution('E4', { def, status: 'completed', startedAt: at(-0.2), finishedAt: at(-0.1) });
    s.cells('E4', [C1]);
    s.reuse('E4', 'E1', [C1], at(-100));
    const r = await results(x, def.id, '?basis=calendar');
    expect(r.basisReason).toBe(API_TEXT.basisRequestedCalendar);
    expect(r.rows).toHaveLength(1);
    expect([r.rows[0]?.executionId, r.rows[0]?.provenance.fetchedAt]).toEqual([s.id('E1'), at(-3)]);
  });
});

describe('review focus 4: the definition is edited after the rows were written', () => {
  it('reports the excluded count and says "0 of 3 rows are inside…" rather than "no results"', async () => {
    const { x, def, s } = await world();
    for (const [i, [c, p]] of (
      [
        [C1, 45_000],
        [C2, 46_000],
        [C3, 47_000],
      ] as const
    ).entries())
      s.tile('E1', c, { status: 'priced', pricePence: p, fetchedAt: at(-1), tileIndex: i });
    expect(
      (await x.request(`/api/definitions/${def.id}`, { method: 'PUT', json: { minNights: 11 } })).status,
    ).toBe(200);
    for (const q of ['?basis=calendar', '?basis=verified', '']) {
      const r = await results(x, def.id, q);
      expect(r.rows).toEqual([]);
      expect([r.total, r.excludedByCurrentSpace]).toEqual([0, 3]);
      expect(r.basisReason).toContain(API_TEXT.insideSpace(0, 3));
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/results.test.ts`
Expected: FAIL: every results request answers 404 `not_found`.

- [ ] **Step 3: Implement**

`apps/api/src/read/rows.ts` (new file):

```ts
/**
 * Result rows of both bases, prices with provenance, staleness and truncation (spec §6.2, §6.9, §8.1). Link
 * re-validation is `links.ts`; picking a figure out of rows is `pick.ts` (review arch-wp08-r2-008).
 */
import {
  type apiContract,
  type CellKey,
  type CellOutcome,
  CONSTRAINT_NAMES,
  type Config,
  type ConstraintName,
  type Constraints,
  cellKeyString,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  daysBetween,
  effectiveAge,
  evaluateConstraints,
  type FlightProvider,
  type IsoDateTime,
  isStale,
  type Provenance,
  type ProviderId,
  type SearchDefinition,
  unverifiedNames,
  verdictClass,
  worstCaseAgeHours,
} from '@gmt/core';
import type { CalendarPriceRow, ObservationRow } from '@gmt/db';
import type { z } from 'zod';
import { hoursSince } from './executions.js';
import { safeBooking, safeSearchLink } from './links.js';

export type ResultRow = z.infer<typeof apiContract.resultRowSchema>;
export type PriceCell = z.infer<typeof apiContract.priceCellSchema>;
export type Basis = 'verified' | 'calendar';
export interface RowContext {
  def: SearchDefinition;
  now: IsoDateTime;
  config: Config;
  providers: readonly FlightProvider[];
}

/** The definition's discovery refresh for a provider; core's DEFAULT_DISCOVERY_REFRESH_HOURS when unset (decision 21). */
export function refreshHoursFor(def: SearchDefinition, providerId: ProviderId): number {
  return def.providers.discoveryRefreshHours[providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
}

/**
 * The calendar-basis stale threshold of a provider (spec §8.1): `CALENDAR_STALE_AFTER_HOURS` when set, else the
 * discovery refresh plus the provider's declared cache age (0 when the vendor's age is unknown).
 */
export function calendarThreshold(
  config: Config,
  providers: readonly FlightProvider[],
  providerId: ProviderId,
  refreshHours: number,
): number {
  if (config.calendarStaleAfterHours !== null) return config.calendarStaleAfterHours;
  const declared = providers.find((p) => p.id === providerId)?.discovery?.info.maxAgeHours ?? 0;
  return refreshHours + (declared === 'unknown' ? 0 : declared);
}

/** The calendar threshold for a provider of the row context's definition; the calendar route reports it per provider. */
export function calendarStaleAfterHours(rc: RowContext, providerId: ProviderId): number {
  return calendarThreshold(rc.config, rc.providers, providerId, refreshHoursFor(rc.def, providerId));
}

/** The threshold a price of this basis is judged against (spec §8.1). */
export function thresholdFor(basis: Basis, providerId: ProviderId, rc: RowContext): number {
  return basis === 'verified' ? rc.config.staleAfterHours : calendarStaleAfterHours(rc, providerId);
}

/**
 * Spec §3 and §8.1 at revision 24 (plan decisions 44, 53, 54). `ageHours` is the effective age from core: the observed
 * age when the vendor dates the price, else the fetch age plus a known `maxAgeHours`, else the fetch age alone (the web
 * labels that case "vendor's cache age unknown" from `provenance.maxAgeHours`). A price is stale when its effective age
 * exceeds the threshold, so an unknown vendor age is never stale on that account alone: core's `isStale`, the one copy
 * of the rule (decision 55).
 */
export function staleness(
  p: Provenance,
  thresholdHours: number,
  now: IsoDateTime,
): { ageHours: number; stale: boolean } {
  const ageHours = worstCaseAgeHours(effectiveAge(p, now));
  return { ageHours, stale: isStale(p, now, thresholdHours) };
}

/** A price on the wire: amount, provenance, staleness, age, truncation (decisions 36, 44). */
export function priceCell(
  pricePence: number,
  provenance: Provenance,
  basis: Basis,
  rc: RowContext,
  truncated: boolean,
): PriceCell {
  const s = staleness(provenance, thresholdFor(basis, provenance.providerId, rc), rc.now);
  return { pricePence, provenance, stale: s.stale, ageHours: s.ageHours, truncated };
}

/** The price part of a row, for the views that show a row's price as a PriceCell. */
export function priceOf(r: ResultRow): PriceCell {
  return {
    pricePence: r.pricePence,
    provenance: r.provenance,
    stale: r.stale,
    ageHours: r.ageHours,
    truncated: r.truncated,
  };
}

export function withNights(c: CellKey): ResultRow['cell'] {
  return {
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
    nights: daysBetween(c.departureDate, c.returnDate),
  };
}

/**
 * Constraints the operator set; on calendar rows these are "not applied" (spec §6.9). Core's `CONSTRAINT_NAMES` is the
 * one list (review arch-010); `cabin` and `priceConfirmed` are never keys of `Constraints`, so they never appear.
 */
export function configuredConstraints(c: Constraints): ConstraintName[] {
  const set = new Set(Object.entries(c).flatMap(([k, v]) => (v === undefined ? [] : [k])));
  return CONSTRAINT_NAMES.filter((n) => set.has(n));
}

function adjusted(
  def: SearchDefinition,
  destination: CellKey['destination'],
  pricePence: number,
): number | null {
  const onward = def.onwardCostPence[destination];
  return onward === undefined ? null : pricePence + onward; // why: a separate column, never merged into price (spec §11)
}

/**
 * Spec §6.9 calendar-basis row; `truncated` from the cell's discovery outcome (decisions 36, 47); `superseded` when a
 * newer parent execution found the cell empty or no_data for the same provider (decision 54).
 */
export function calendarRow(
  r: CalendarPriceRow,
  rc: RowContext,
  truncated: boolean,
  superseded: boolean,
): ResultRow {
  const p = priceCell(r.pricePence, r.provenance, 'calendar', rc, truncated);
  return {
    itineraryHash: null,
    basis: 'calendar',
    verdictClass: 'unchecked',
    ...p,
    cell: withNights(r.cell),
    outbound: null,
    inbound: null,
    totalMinutes: null,
    outboundMinutes: null,
    inboundMinutes: null,
    stopsOut: null,
    stopsIn: null,
    layovers: [],
    carriers: [],
    verdicts: {},
    unverified: [],
    notApplied: configuredConstraints(rc.def.constraints),
    seller: null,
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    booking: { kind: 'none' },
    searchLink: safeSearchLink(r.providerId, r.cell, rc.def),
    otherOffers: [],
    notSeenInLatest: null,
    superseded,
    adjustedPence: adjusted(rc.def, r.cell.destination, r.pricePence),
    destinationNote: rc.def.destinationNotes[r.cell.destination] ?? null,
    executionId: r.executionId,
    calendarPriceId: r.id,
    observationId: null,
  };
}

/** Spec §6.2/§6.9 verified-basis row: verdicts evaluated now, against the current definition. */
export function verifiedRow(
  o: ObservationRow,
  rc: RowContext,
  notSeenInLatest: { ageHours: number | 'unknown' } | null,
): ResultRow {
  const it = o.itinerary;
  const verdicts = evaluateConstraints(it, o, rc.def.constraints, rc.def.cabin, o.suppliedFields);
  // why: an itinerary search is never truncated; only calendar tiles are (decision 30).
  const p = priceCell(o.pricePence, o.provenance, 'verified', rc, false);
  return {
    itineraryHash: it.hash,
    basis: 'verified',
    verdictClass: verdictClass(verdicts),
    ...p,
    cell: o.cell,
    outbound: it.outbound,
    inbound: it.inbound,
    totalMinutes:
      it.outboundMinutes !== undefined && it.inboundMinutes !== undefined
        ? it.outboundMinutes + it.inboundMinutes
        : null,
    outboundMinutes: it.outboundMinutes ?? null,
    inboundMinutes: it.inboundMinutes ?? null,
    stopsOut: it.stopsOut,
    stopsIn: it.stopsIn,
    layovers: it.layovers,
    carriers: it.marketingCarriers,
    verdicts,
    unverified: unverifiedNames(verdicts),
    notApplied: [],
    seller: o.seller,
    baggage: o.baggage,
    fareConditions: o.fareConditions,
    selfTransfer: o.selfTransfer,
    booking: safeBooking(o.booking, o.offer.providerId),
    searchLink: safeSearchLink(o.offer.providerId, o.cell, rc.def),
    otherOffers: [],
    notSeenInLatest,
    superseded: false,
    adjustedPence: adjusted(rc.def, it.destination, o.pricePence),
    destinationNote: rc.def.destinationNotes[it.destination] ?? null,
    executionId: o.executionId,
    calendarPriceId: null,
    observationId: o.id,
  };
}

/** An offer's current price is its latest observation (spec §7 `latest` = max fetchedAt, tie id). */
export function latestPerOffer(rows: readonly ObservationRow[]): ObservationRow[] {
  const best = new Map<number, ObservationRow>();
  for (const r of rows) {
    const cur = best.get(r.offer.id);
    const a = r.provenance.fetchedAt;
    if (
      cur === undefined ||
      a > cur.provenance.fetchedAt ||
      (a === cur.provenance.fetchedAt && r.id > cur.id)
    )
      best.set(r.offer.id, r);
  }
  return [...best.values()];
}

/**
 * Spec §8.1: a row is "not seen in latest search" when its cell's newest `priced | empty`
 * verification outcome comes from another execution in which this offer has no observation.
 */
export function notSeenResolver(
  rows: readonly ObservationRow[],
  latestOutcome: (cell: CellKey) => CellOutcome | null,
  now: IsoDateTime,
) {
  const seen = new Set(rows.map((r) => `${r.executionId}|${r.offer.id}`));
  const cache = new Map<string, CellOutcome | null>();
  return (r: ObservationRow): { ageHours: number | 'unknown' } | null => {
    const key = cellKeyString(r.cell);
    let latest = cache.get(key);
    if (latest === undefined) {
      latest = latestOutcome(r.cell);
      cache.set(key, latest);
    }
    if (latest === null || (latest.status !== 'priced' && latest.status !== 'empty')) return null;
    if (latest.executionId === r.executionId || seen.has(`${latest.executionId}|${r.offer.id}`)) return null;
    // why: a priced or empty outcome always has fetchedAt; if one ever lacks it the age is not known, never "now".
    return { ageHours: latest.fetchedAt === null ? 'unknown' : hoursSince(latest.fetchedAt, now) };
  };
}
```

`apps/api/src/read/links.ts` (new file):

```ts
/** Vendor links re-validated on the way out (spec §5.2, plan decision 54). */
import {
  type Booking,
  type CellKey,
  LINK_ALLOWLIST,
  type ProviderId,
  type SearchDefinition,
  searchLinkFor,
  validateVendorUrl,
} from '@gmt/core';
import type { ResultRow } from './rows.js';

/**
 * Spec §5.2 and plan decision 54: a stored booking is re-validated against its provider's `LINK_ALLOWLIST` before it
 * is sent (https, no userinfo, no port, an allowlisted host); anything else becomes `{ kind: 'none' }`. A post booking
 * keeps its form data with the re-validated URL.
 */
export function safeBooking(b: Booking, providerId: ProviderId): Booking {
  if (b.kind === 'none') return b;
  const checked = validateVendorUrl(b.url, LINK_ALLOWLIST[providerId]);
  if (checked.kind !== 'get') return { kind: 'none' };
  return b.kind === 'post'
    ? { kind: 'post', url: checked.url, postData: b.postData, host: checked.host }
    : checked;
}

/** The same rule for a search link (decision 54): kept only when it re-validates for its provider. */
export function safeSearchLink(
  providerId: ProviderId,
  cell: CellKey,
  def: SearchDefinition,
): ResultRow['searchLink'] {
  const link = searchLinkFor(providerId, cell, def.cabin);
  if (link === null) return null;
  return validateVendorUrl(link.url, LINK_ALLOWLIST[providerId]).kind === 'get' ? link : null;
}
```

`apps/api/src/read/pick.ts` (new file):

```ts
/** Picking one figure out of rows (spec §8.1, §11 View B; plan decisions 54, 58). */
import type { ResultRow } from './rows.js';

/** The cheapest row, or null (calendar-basis minima). */
export function cheapest(rows: readonly ResultRow[]): ResultRow | null {
  let best: ResultRow | null = null;
  for (const r of rows) if (best === null || r.pricePence < best.pricePence) best = r;
  return best;
}

/**
 * The verified-basis figure of a set of rows (plan decision 54, spec §8.1, §11 View B): a row the newest search of its
 * cell returned beats one it did not, a fresh row beats a stale one, then the cheaper wins. The caller carries the
 * winner's `notSeenInLatest`, so a not-seen figure is shown only when nothing seen exists, and says so.
 */
export function pickVerified(rows: readonly ResultRow[]): ResultRow | null {
  const rank = (r: ResultRow) => [r.notSeenInLatest === null ? 0 : 1, r.stale ? 1 : 0, r.pricePence];
  let best: ResultRow | null = null;
  for (const r of rows) {
    if (best === null) {
      best = r;
      continue;
    }
    const [a, b] = [rank(r), rank(best)];
    const i = a.findIndex((x, k) => x !== b[k]);
    if (i >= 0 && (a[i] ?? 0) < (b[i] ?? 0)) best = r;
  }
  return best;
}

/** The calendar-basis figure: a current price before one a later search superseded (decision 54), then the cheapest. */
export function pickCalendar(rows: readonly ResultRow[]): ResultRow | null {
  return cheapest(rows.filter((r) => !r.superseded)) ?? cheapest(rows);
}
```

`apps/api/src/read/coverage.ts` (new file):

```ts
/** The coverage summary every view header shows (spec §3, §11). */
import {
  type apiContract,
  type Buckets,
  type CellOutcomeStatus,
  cellKeyString,
  type Execution,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';

export type CoverageSummary = z.infer<typeof apiContract.coverageSummarySchema>;
/**
 * Statuses that mean "searched" (spec §3). A priced verification roll-up with a null price (`price-unconfirmed`,
 * decisions 45 and 48) is searched: it counts as itinerary-searched but contributes no itinerary-search price.
 */
export const SEARCHED: ReadonlySet<CellOutcomeStatus> = new Set(['priced', 'empty', 'no_data']);

export function zeroBuckets(): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
}

/**
 * Spec §3/§11 header line: six discovery buckets over the latest parent execution's cell roll-ups (they sum to the
 * cell count), "(R reused)", "itinerary-searched K of N selected", "+C on demand" from completed children.
 */
export function coverageSummaryFor(
  latestParent: Execution | null,
  executions: readonly Execution[],
  ports: Ports,
): CoverageSummary {
  const onDemand = executions.filter((e) => e.isChild && e.status === 'completed').length;
  if (latestParent === null)
    return { buckets: zeroBuckets(), total: 0, selected: 0, itinerarySearched: 0, onDemand, reused: 0 };
  const rollUps = ports.repos.cells.rollUps(latestParent.id);
  const buckets = zeroBuckets();
  for (const r of rollUps.values()) if (r.discovery.status !== null) buckets[r.discovery.status] += 1;
  const reused = new Set(
    ports.repos.cells
      .outcomes(latestParent.id, { stage: 'discovery' })
      .filter((o) => o.reusedFromExecutionId !== null)
      .map(cellKeyString),
  ).size;
  buckets.reused = reused;
  const selected = ports.repos.cells.selected(latestParent.id);
  const itinerarySearched = selected.filter(({ cell }) => {
    const status = rollUps.get(cellKeyString(cell))?.verification.status ?? null;
    return status !== null && SEARCHED.has(status);
  }).length;
  return { buckets, total: rollUps.size, selected: selected.length, itinerarySearched, onDemand, reused };
}
```

`apps/api/src/read/results.ts` (new file):

```ts
/** Spec §6.5, §6.9, §10 `/results` and the row set every view reads. */
import {
  type apiContract,
  type CellOutcome,
  cellKeyString,
  dedupByItinerary,
  type Execution,
  isTruncated,
  type ResolvedSpace,
  rankRows,
  type SearchDefinition,
} from '@gmt/core';
import type { CalendarPriceRow } from '@gmt/db';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor, SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import {
  type Basis,
  calendarRow,
  latestPerOffer,
  notSeenResolver,
  type ResultRow,
  type RowContext,
  verifiedRow,
} from './rows.js';
import { cellInSpace, currentSpace } from './space.js';

export type ResultsResponse = z.infer<typeof apiContract.resultsResponseSchema>;
export type ResultsQuery = z.infer<typeof apiContract.resultsQuerySchema>;
/** Spec §6.5: at most 1000 rows per response. */
export const RESULTS_CAP = 1000;
/** Executions read per definition (newest first); far above a year of weekly runs plus children. */
export const EXECUTIONS_LIMIT = 500;

export interface Loaded {
  def: SearchDefinition;
  space: ResolvedSpace;
  rc: RowContext;
  /** All executions of the definition (children included), newest first. */
  all: Execution[];
  /** The executions the rows come from (all, or the one `executionId`). */
  scoped: Execution[];
  latestParent: Execution | null;
  /** One row per offer inside the current space, verdicts evaluated now; not deduped. */
  verified: ResultRow[];
  /**
   * Observation ids whose price the final step did not confirm (no `price` supplied field, decisions 27, 37). The
   * verified-basis minima of the views skip them, so an unconfirmed fare is never shown as an itinerary-search price
   * (decisions 45, 48); `/results` returns them, and the web badges them from `verdicts`.
   */
  unconfirmed: ReadonlySet<number>;
  /** One row per (provider, cell) inside the current space; reused copies ignored. */
  calendar: ResultRow[];
  /** Itineraries / calendar rows dropped because they fall outside the current space. */
  excluded: { verified: number; calendar: number };
}

/**
 * Decisions 36, 47: a calendar price is truncated when its discovery outcome's `last_error` starts with core's
 * `TRUNCATED_NOTE`, tested with core's `isTruncated`. One outcome read per execution.
 */
export function truncationOf(
  ports: Ports,
): (r: Pick<CalendarPriceRow, 'executionId' | 'reusedFromExecutionId' | 'providerId' | 'cell'>) => boolean {
  const byExecution = new Map<string, Map<string, CellOutcome>>();
  return (r) => {
    // why: a reused copy's truncation is its source's: the copying run read no pages (decision 58).
    const source = r.reusedFromExecutionId ?? r.executionId;
    let outcomes = byExecution.get(source);
    if (outcomes === undefined) {
      outcomes = new Map(
        ports.repos.cells
          .outcomes(source, { stage: 'discovery' })
          .map((o) => [`${o.providerId}|${cellKeyString(o)}`, o]),
      );
      byExecution.set(source, outcomes);
    }
    return isTruncated(outcomes.get(`${r.providerId}|${cellKeyString(r.cell)}`)?.lastError ?? null);
  };
}

/** The latest calendar price per (provider, cell) among `rows` (max fetchedAt, tie on id), reused copies included. */
function latestPerProviderCell(rows: readonly CalendarPriceRow[]): CalendarPriceRow[] {
  const best = new Map<string, CalendarPriceRow>();
  for (const r of rows) {
    const key = `${r.providerId}|${cellKeyString(r.cell)}`;
    const cur = best.get(key);
    if (cur === undefined || r.fetchedAt > cur.fetchedAt || (r.fetchedAt === cur.fetchedAt && r.id > cur.id))
      best.set(key, r);
  }
  return [...best.values()];
}

/**
 * Plans decisions 54 and 58: a calendar price is "superseded by a later search" when the latest parent execution that
 * searched its cell for that provider (outcome priced, empty or no_data) is newer than the price's execution and found
 * the cell empty or no_data. A newer run that skipped the cell, failed on it or reused it does not count as a search,
 * so an older "no fares" still marks the price. `superseded` is the field on rows and on the views' calendar figures.
 */
function supersessionOf(
  ports: Ports,
  all: readonly Execution[],
): (r: Pick<CalendarPriceRow, 'executionId' | 'providerId' | 'cell'>) => boolean {
  // why: `all` is newest first (created_at, then rowid), so a later position is an earlier search, even when two
  // executions share a created_at second.
  const position = new Map(all.map((e, i) => [e.id, i]));
  const lastSearch = new Map<string, { at: number; found: boolean }>();
  all.forEach((e, at) => {
    if (e.isChild) return;
    for (const o of ports.repos.cells.outcomes(e.id, { stage: 'discovery' })) {
      const key = `${o.providerId}|${cellKeyString(o)}`;
      if (!SEARCHED.has(o.status) || lastSearch.has(key)) continue;
      lastSearch.set(key, { at, found: o.status === 'priced' });
    }
  });
  return (r) => {
    const fetchedBy = position.get(r.executionId);
    const last = lastSearch.get(`${r.providerId}|${cellKeyString(r.cell)}`);
    return fetchedBy !== undefined && last !== undefined && last.at < fetchedBy && !last.found;
  };
}

/**
 * Everything the read routes share: rows of both bases for the definition's current space and cabin. `executionIds`
 * scopes the rows to those executions (a run picked with `?executionId=`, or the duration analysis's set): calendar
 * rows are then the latest each of them holds — fetched, or reused within its refresh window (decision 58, so a run's
 * prices agree with its coverage, which counts a reused cell as priced) — read per execution rather than filtered out
 * of the global latest, so a cell a newer run priced again still shows the scoped run's price (review prov-003). "Not
 * seen in latest search" and "superseded by a later search" always compare with the newest search of the cell.
 */
export function loadRows(def: SearchDefinition, ports: Ports, executionIds?: readonly string[]): Loaded {
  const now = ports.clock.now();
  const space = currentSpace(def, ports.clock.todayLondon());
  const all = ports.repos.executions.listForDefinition(def.id, {
    limit: EXECUTIONS_LIMIT,
    includeChildren: true,
  });
  const wanted = executionIds === undefined ? null : new Set(executionIds);
  const scoped = wanted === null ? all : all.filter((e) => wanted.has(e.id));
  const ids = scoped.map((e) => e.id);
  const rc: RowContext = { def, now, config: ports.config, providers: ports.providers };
  const latestParent = all.find((e) => !e.isChild) ?? null;

  // why: space null reads every cell, so rows outside the current space can be counted (review focus 4).
  const raw = ports.repos.itineraries.observationsForDefinition(def.id, {
    executionIds: ids,
    space: null,
    cabin: def.cabin,
    includeChildren: true,
  });
  // why: "seen in execution X" must consider every observation, not only each offer's latest one.
  const notSeen = notSeenResolver(
    raw,
    (c) => ports.repos.itineraries.latestVerificationOutcomeForCell(def.id, c, def.cabin),
    now,
  );
  const latest = latestPerOffer(raw);
  const inSpace = latest.filter((o) => cellInSpace(space, o.cell));
  const hashes = (xs: readonly { itinerary: { hash: string } }[]) =>
    new Set(xs.map((o) => o.itinerary.hash)).size;

  const calendarAll =
    wanted === null
      ? ports.repos.calendarPrices
          .latestPerCell(def.id, def.cabin, null)
          .filter((r) => r.reusedFromExecutionId === null)
      : latestPerProviderCell(
          ids.flatMap((id) => ports.repos.calendarPrices.heldBy(id)).filter((r) => r.cabin === def.cabin),
        );
  const calendarIn = calendarAll.filter((r) => cellInSpace(space, r.cell));
  const truncated = truncationOf(ports);
  const superseded = supersessionOf(ports, all);

  return {
    def,
    space,
    rc,
    all,
    scoped,
    latestParent,
    verified: inSpace.map((o) => verifiedRow(o, rc, notSeen(o))),
    unconfirmed: new Set(inSpace.filter((o) => !o.suppliedFields.includes('price')).map((o) => o.id)),
    calendar: calendarIn.map((r) => calendarRow(r, rc, truncated(r), superseded(r))),
    excluded: {
      verified: hashes(latest) - hashes(inSpace),
      calendar: calendarAll.length - calendarIn.length,
    },
  };
}

/** A verified-basis row whose price the final step confirmed (decisions 45, 48). */
export function confirmedIn(loaded: Loaded): (r: ResultRow) => boolean {
  return (r) => r.observationId === null || !loaded.unconfirmed.has(r.observationId);
}

/** Spec §6.9 default basis and its reason. */
export function chooseBasis(loaded: Loaded, requested: Basis | undefined): { basis: Basis; reason: string } {
  const hasVerification = (loaded.latestParent?.snapshot ?? loaded.def).providers.verification.length > 0;
  if (requested === 'calendar') return { basis: 'calendar', reason: API_TEXT.basisRequestedCalendar };
  if (requested === 'verified') return { basis: 'verified', reason: API_TEXT.basisItinerarySearch };
  if (!hasVerification) return { basis: 'calendar', reason: API_TEXT.basisNoVerificationProvider };
  if (loaded.verified.length === 0 && loaded.excluded.verified === 0)
    return { basis: 'calendar', reason: API_TEXT.basisNoObservations };
  return { basis: 'verified', reason: API_TEXT.basisItinerarySearch };
}

/** Spec §10 `GET /api/definitions/:id/results`. No sort or filter parameters: the client sorts and filters (spec §6.5). */
export function assembleResults(def: SearchDefinition, q: ResultsQuery, ports: Ports): ResultsResponse {
  const loaded = loadRows(def, ports, q.executionId === undefined ? undefined : [q.executionId]);
  const shown = loaded.scoped[0];
  if (q.executionId !== undefined && shown === undefined)
    throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound);
  const { basis, reason } = chooseBasis(loaded, q.basis);
  const ranked =
    basis === 'verified'
      ? rankRows(dedupByItinerary(loaded.verified, loaded.rc.now), loaded.rc.now)
      : // why: decision 54: a superseded calendar price ranks after every current one (a stable partition).
        rankRows(loaded.calendar, loaded.rc.now).sort((a, b) => Number(a.superseded) - Number(b.superseded));
  const excluded = basis === 'verified' ? loaded.excluded.verified : loaded.excluded.calendar;
  const total = ranked.length;
  const limit = Math.min(q.limit ?? RESULTS_CAP, RESULTS_CAP);
  return {
    rows: ranked.slice(0, limit),
    total,
    truncated: total > limit,
    basis,
    basisReason: excluded > 0 ? `${reason} · ${API_TEXT.insideSpace(total, total + excluded)}` : reason,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    // why: with ?executionId= the header describes the run shown, alone (review prov-003, decision 42's principle).
    coverage:
      shown === undefined || q.executionId === undefined
        ? coverageSummaryFor(loaded.latestParent, loaded.all, ports)
        : coverageSummaryFor(shown, [], ports),
    excludedByCurrentSpace: excluded,
    verificationProviderConfigured: def.providers.verification.length > 0,
    cheapest: ranked[0] ?? null,
  };
}
```

`apps/api/src/routes/results.ts` (new file):

```ts
/** Spec §10 read routes over a definition's executions: results (Task 8.12 adds the four views and the cell detail). */
import { apiContract } from '@gmt/core';
import { assembleResults } from '../read/results.js';
import { NO_INPUT, route } from './define.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable } from './types.js';

export const resultHandlers: HandlerTable = {
  'GET /api/definitions/:id/results': route(
    { request: NO_INPUT, query: apiContract.resultsQuerySchema },
    (c, input, ctx) =>
      c.json(assembleResults(getLiveDefinition(ctx, param(input, 'id')), input.query, ctx.ports)),
  ),
};
```

`apps/api/src/routes/index.ts` (replace the file):

```ts
/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { definitionHandlers } from './definitions.js';
import { executionHandlers } from './executions.js';
import { resultHandlers } from './results.js';
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
  ...definitionHandlers,
  ...executionHandlers,
  ...resultHandlers,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/results.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 26 tests (with the execution summary's `expandTop`, decision 42); typecheck clean.

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.11a**: in `apps/api/src/read/rows.ts` replace `  return { ageHours, stale: isStale(p, now, thresholdHours) };` with `  return { ageHours, stale: effectiveAge(p, now).fetchedHours > thresholdHours };`. Fails: “an unknown vendor age is aged by fetchedAt alone and is not stale for that reason (decision 44, spec rev 23)”; “a calendar price is stale only past the refresh plus the provider age (spec §8.1)”.

- **8.11b**: in `apps/api/src/read/rows.ts` replace `    booking: safeBooking(o.booking, o.offer.providerId),` with `    booking: o.booking,`. Fails: “a stored booking with a javascript: URL is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”; “a stored booking with plain http is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”; “a stored booking with userinfo is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”; “a stored booking with a suffix look-alike is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”; “a stored booking with a port is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”; “a stored booking with another provider's host is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”; “a stored booking with a post off the allowlist is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)”.

- **8.11c**: in `apps/api/src/read/results.ts` replace `last.at < fetchedBy && !last.found;` with `false;`. Fails: “a calendar price a later search found empty is marked superseded and ranked after current prices (decision 54)”; “superseded compares with the latest run that searched the cell: a newer run that skipped it does not clear the mark (decision 58)”.

- **8.11e**: in `apps/api/src/read/results.ts` replace `      if (!SEARCHED.has(o.status) || lastSearch.has(key)) continue;` with `      if (lastSearch.has(key)) continue;`. Fails: “superseded compares with the latest run that searched the cell: a newer run that skipped it does not clear the mark (decision 58)”.

- **8.11d**: in `apps/api/src/read/results.ts` replace

```ts
    wanted === null
      ? ports.repos
```

  with

```ts
    wanted === null || wanted !== null
      ? ports.repos
```

  Fails: “an older run picked with executionId still shows its own price after a newer run priced the cell again (review prov-003)”.

- **8.11f**: in `apps/api/src/read/results.ts` replace `ports.repos.calendarPrices.heldBy(id)` with `ports.repos.calendarPrices.fetchedBy(id)`. Fails: “a run picked with executionId shows the prices it reused, as its coverage counts them (decision 58)”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: results: basis, dedup, ranking, cap, effective-age staleness, truncation, not-seen and superseded marks, link re-validation, scoped runs with reused copies"
```

### Task 8.12: Calendar (with `destination`), duration analysis, coverage, calendar gap, cell detail

**Files:**
- Create: `apps/api/src/read/calendar.ts`, `src/read/duration.ts`, `src/read/coverageView.ts`, `src/read/cell.ts`
- Modify: `apps/api/src/routes/results.ts` (replace the file)
- Test: `apps/api/test/routes/views.test.ts`

**Interfaces:**
- Consumes: `loadRows`, `confirmedIn`, `priceOf`, `withNights`, `pickVerified`, `pickCalendar`, `calendarStaleAfterHours` (Task 8.11); `overrunOf`, `planCallsOf`, `executionResponse` (Task 8.10); `CellsRepo.outcomes/rollUps/selected`, `LedgerRepo.countsFor`, `NotificationsRepo.wasSent`, `retriedOnResume` (WP3, Task 8.0); `engine.scheduler.blockedSince()`, `engine.childCapPreview` (WP7); `selectedNotReached`, `sixBuckets`, `addDays`, `daysBetween`, `dedupByItinerary`, `cellKeyString` (core).
- Produces: `assembleCalendar`, `assembleCalendarGap`, `assembleDuration`, `assembleCoverage`, `retryable`, `assembleCellDetail`; routes `GET /api/definitions/:id/calendar` (`?destination=`), `/duration-analysis`, `/coverage`, `/calendar-gap`, `/cells/:origin/:destination/:departureDate/:returnDate`.

**Calendar** (View B; decisions 51, 53, 54, 58). Days cover every departure date of the current window. With `destination` (one of the definition's, else 422 `unknown_destination`), every figure of the day — the six-bucket counts, the selection, `unconfirmedCells`, both verified minima and the calendar minimum — counts that destination's cells only (the day has no per-destination figures, decision 58), so a filtered day never borrows another airport's price or count. Six-bucket counts come from the latest parent's discovery outcomes through core's `sixBuckets`; selection and coverage from the latest parent, completed children counted per day as "on demand". Verified-basis figures count confirmed prices only and are picked by `pickVerified` over **every confirmed offer, before the per-itinerary dedup** (decision 58): the dedup chooses an itinerary's primary offer on price before age, so picking after it would hide a fresh £420 offer from one seller behind a stale £400 one from another, and a confirmed £400 offer behind an unconfirmed £380 one (review prov-009). `cheapestVerified` uses class `verified`, `cheapestPartiallyVerified` class `partially-verified` with its `count` (itineraries, from the dedup), each picked latest seen, then fresh, then cheapest (decision 54, spec §11 View B), with its `notSeenInLatest` mark (WP10's field). `cheapestCalendar` is `pickCalendar`'s: a current price before a superseded one, carrying `superseded`. `verification.unconfirmedCells` counts the latest parent's selected cells whose verification roll-up is priced with no confirmed price (decisions 48, 51), so an older run's confirmed price does not hide the latest run's unconfirmed one (review prov-008). The response reports `staleAfterHours` and per discovery provider `calendarStaleAfterHours`.

**Duration** (View C; decisions 38, 54, 58; review prov-012; WP10's shapes): one execution set — the latest parent plus completed children, with the prices each holds, reused copies included (decision 58) — feeds both the minima and the `searched` counts, so a nights value is never counted searched by one run and priced by another. Each minimum carries its `cell` and `n` (cells of that nights value with a class-verified confirmed price, or that the provider priced); `minVerified` is picked by `pickVerified` over every confirmed offer before any dedup and carries its `notSeenInLatest` mark; each `minCalendar[].price` is `pickCalendar`'s and carries `superseded`, so a cell the latest run reused is both counted searched and priced. `searched` counts per series: `verification` over the selected cells of that nights value (the latest parent's selection and the completed children's cells), each discovery provider over every cell of that nights value in the current space; `searched` is those whose outcome in the set is priced, empty or no_data. Cell keys are core's `cellKeyString`.

**Coverage** (View D) is the latest parent's; before the first run it is 404 `no_execution`. `perStage` rows carry their ledger counts, the pre-factor `planCalls`, `overrun` (decision 43: discovery on tiles) and `parityBreak`; `errors[].retryable` is WP3's `retriedOnResume(outcome, true)`, the very rule the manual resume runs.

**Calendar gap** (spec §6.9; decision 58): current calendar prices below the **reference verified price (latest seen, then fresh, then cheapest)** — the class-verified confirmed price picked by `pickVerified`, with its mark; a superseded calendar price is not listed. Empty without a verification provider.

**Cell detail**: outcomes per execution × stage × provider as stored (a priced verification outcome with a null `minPence` is the web's "price not confirmed", decision 48), calendar prices with `truncated` and `superseded`, observations as rows, and `verify` from `Engine.childCapPreview(definitionId, cell)` when its result is `ok` — the same sizing and the same refusals as `verifyCell` (decisions 42, 45, 48) — or null without a verification provider or when the preview refuses (`not_found`, `window`).

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/views.test.ts` (new file):

```ts
// Spec §10 calendar, duration analysis, coverage, calendar gap and cell detail (Views B, C, D and the side panel).
import { apiContract, asIata, daysBetween, generateCells } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSpace } from '../../src/read/space.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const C3 = cell('LHR', 'JFK', '2026-11-04', '2026-11-14');
const C4 = cell('LHR', 'JFK', '2026-11-05', '2026-11-15');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/**
 * Discovery: C1 priced £450, C2 no data, C3 no fares, C4 error. Selection: all four; C4 not reached.
 * Itinerary search: hV £600 verified (C1), hP £400 partially-verified (C2), hF £300 failed (C3).
 */
async function world() {
  const x = await createHarness();
  h = x;
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(
    exampleDefinitionInput({ constraints: { maxStops: 1, checkedBagRequired: true } }),
  );
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1, C2, C3, C4], {
    selected: [
      ...[C1, C2, C3].map((c) => ({ cell: c, reason: 'top_n' as const })),
      { cell: C4, reason: 'always_include' as const },
    ],
  });
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1), tileIndex: 0 });
  s.tile('E1', C2, { status: 'no_data', fetchedAt: at(-1), tileIndex: 1 });
  s.tile('E1', C3, { status: 'empty', fetchedAt: at(-1), tileIndex: 2 });
  s.tileError('E1', [C4], 'upstream', 'HTTP 503');
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) }]);
  s.verified('E1', C2, [{ hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null }]);
  s.verified('E1', C3, [{ hash: 'hF', pricePence: 30_000, fetchedAt: at(-1), stopsOut: 2 }]);
  return { x, def, s };
}

const get = <S extends Parameters<typeof expectContract>[3]>(
  x: Harness,
  path: string,
  route: string,
  schema: S,
) => x.request(path).then((r) => expectContract(r, 'GET', route, schema));

describe('GET /api/definitions/:id/calendar (spec §10, View B)', () => {
  it('per day: six buckets per provider, selection, the three cheapest, stale thresholds', async () => {
    const { x, def } = await world();
    const cal = await get(
      x,
      `/api/definitions/${def.id}/calendar`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
    const space = currentSpace(def, x.clock.todayLondon());
    expect(cal.days).toHaveLength(daysBetween(space.departureFrom, space.departureTo) + 1);
    expect(cal.staleAfterHours).toBe(192);
    expect(cal.calendarStaleAfterHours.fixture).toBe(168);
    const day = (d: string) => cal.days.find((y) => y.date === d);
    expect(day('2026-11-02')?.discovery).toEqual([
      {
        providerId: 'fixture',
        buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
        total: 1,
      },
    ]);
    expect(day('2026-11-02')?.verification).toEqual({
      selected: 1,
      itinerarySearched: 1,
      onDemand: 0,
      unconfirmedCells: 0,
    });
    expect(day('2026-11-02')?.cheapestVerified).toMatchObject({
      pricePence: 60_000,
      itineraryHash: 'hV',
      truncated: false,
    });
    expect(day('2026-11-02')?.cheapestCalendar?.pricePence).toBe(45_000);
    expect(day('2026-11-02')?.cheapestPartiallyVerified).toBeNull();
    expect(Object.keys(day('2026-11-02') ?? {})).not.toContain('byDestination'); // decision 58
    expect(day('2026-11-03')?.discovery[0]?.buckets.no_data).toBe(1);
    expect(day('2026-11-03')?.cheapestPartiallyVerified).toMatchObject({
      pricePence: 40_000,
      count: 1,
      itineraryHash: 'hP',
    });
    expect(day('2026-11-04')?.discovery[0]?.buckets.empty).toBe(1);
    expect(day('2026-11-04')?.cheapestVerified).toBeNull(); // why: hF is class failed
    expect(day('2026-11-05')?.discovery[0]?.buckets.error).toBe(1);
  });

  it('an offer whose price the final step did not confirm is never a cheapest itinerary-search price (decisions 45, 48)', async () => {
    const { x, def, s } = await world();
    s.verified('E1', C2, [
      { hash: 'hX', pricePence: 20_000, fetchedAt: at(-1), baggage: null, confirmed: false },
    ]);
    const cal = await get(
      x,
      `/api/definitions/${def.id}/calendar`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
    expect(cal.days.find((d) => d.date === '2026-11-03')?.cheapestPartiallyVerified).toMatchObject({
      itineraryHash: 'hP',
    });
  });

  it('counts a selected cell whose itinerary search priced but confirmed no price (decision 51)', async () => {
    const { x, def, s } = await world();
    s.execution('E2', { def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.4) });
    s.cells('E2', [C4], { selected: [{ cell: C4, reason: 'always_include' }] });
    s.verified('E2', C4, [{ hash: 'hU', pricePence: 20_000, fetchedAt: at(-0.4), confirmed: false }]);
    const cal = await get(
      x,
      `/api/definitions/${def.id}/calendar`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
    const day = cal.days.find((d) => d.date === '2026-11-05');
    expect(day?.verification).toMatchObject({ selected: 1, itinerarySearched: 1, unconfirmedCells: 1 });
    expect(day?.cheapestVerified).toBeNull();
    const other = cal.days.find((d) => d.date === '2026-11-03');
    expect(other?.verification.unconfirmedCells).toBe(0); // why: hP's price is confirmed
  });
});

describe('calendar selection rules (plan decisions 53, 54; review prov-009)', () => {
  const calendar = (x: Harness, defId: string, query = '') =>
    get(
      x,
      `/api/definitions/${defId}/calendar${query}`,
      '/api/definitions/:id/calendar',
      apiContract.calendarResponseSchema,
    );
  async function bare(destinations = ['JFK']) {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ destinations: destinations.map(asIata) }),
    );
    return { x, s, def };
  }

  it('with destination=, buckets, selection and minima count that destination only; 422 for another', async () => {
    const { x, s, def } = await bare(['JFK', 'EWR']);
    const J = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    const E = cell('LHR', 'EWR', '2026-11-02', '2026-11-12');
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [J, E], { selected: [J, E].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.tile('E1', J, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1) });
    s.tile('E1', E, { status: 'priced', pricePence: 35_000, fetchedAt: at(-1), tileIndex: 1 });
    s.verified('E1', J, [{ hash: 'hJ', pricePence: 60_000, fetchedAt: at(-1) }]);
    s.verified('E1', E, [{ hash: 'hE', pricePence: 50_000, fetchedAt: at(-1) }]);
    const both = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect([
      both?.cheapestVerified?.pricePence,
      both?.verification.selected,
      both?.discovery[0]?.total,
    ]).toEqual([50_000, 2, 2]);
    const jfk = (await calendar(x, def.id, '?destination=JFK')).days.find((d) => d.date === '2026-11-02');
    expect([jfk?.cheapestVerified?.pricePence, jfk?.cheapestCalendar?.pricePence]).toEqual([60_000, 45_000]);
    expect([jfk?.verification.selected, jfk?.discovery[0]?.total]).toEqual([1, 1]);
    const bos = await x.request(`/api/definitions/${def.id}/calendar?destination=BOS`);
    expect(bos.status).toBe(422);
    expect((await errorOf(bos)).code).toBe('unknown_destination');
  });

  it('prefers a price the newest search returned over a cheaper one it did not, and marks the latter', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hOld', pricePence: 55_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [{ hash: 'hNew', pricePence: 65_000, fetchedAt: at(-1) }]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hNew', notSeenInLatest: null });
    const gap = await get(
      x,
      `/api/definitions/${def.id}/calendar-gap`,
      '/api/definitions/:id/calendar-gap',
      apiContract.calendarGapResponseSchema,
    );
    expect(gap.cheapestVerified).toMatchObject({ itineraryHash: 'hNew', notSeenInLatest: null });
  });

  it('prefers a fresh price over a cheaper stale one on the same day', async () => {
    const { x, s, def } = await bare();
    const C1b = cell('LHR', 'JFK', '2026-11-02', '2026-11-13');
    s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-1) });
    s.cells('E1', [C1, C1b], { selected: [C1, C1b].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.verified('E1', C1, [{ hash: 'hStale', pricePence: 50_000, fetchedAt: at(-250) }]); // 250 h > 192
    s.verified('E1', C1b, [{ hash: 'hFresh', pricePence: 58_000, fetchedAt: at(-1) }]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hFresh', stale: false });
  });

  it('a fresh offer from another seller is shown before a cheaper stale offer of the same itinerary (decision 58)', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [
      { hash: 'hS', pricePence: 40_000, fetchedAt: at(-250), seller: 'Stale Air' }, // 250 h > 192
      { hash: 'hS', pricePence: 42_000, fetchedAt: at(-1), seller: 'Fresh Travel' },
    ]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hS', pricePence: 42_000, stale: false });
  });

  it('a confirmed £400 offer is the cheapest even when the same itinerary has an unconfirmed £380 offer', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [
      { hash: 'hD', pricePence: 40_000, fetchedAt: at(-1), seller: 'Confirmed Air' },
      { hash: 'hD', pricePence: 38_000, fetchedAt: at(-1), seller: 'Unconfirmed Travel', confirmed: false },
    ]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestVerified).toMatchObject({ itineraryHash: 'hD', pricePence: 40_000 });
    expect(day?.verification.unconfirmedCells).toBe(0);
  });

  it("unconfirmedCells follows the latest run: an older run's confirmed price does not hide it", async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hC', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [{ hash: 'hU', pricePence: 55_000, fetchedAt: at(-1), confirmed: false }]);
    const day = (await calendar(x, def.id)).days.find((d) => d.date === '2026-11-02');
    expect(day?.verification.unconfirmedCells).toBe(1);
  });
});

describe('GET /api/definitions/:id/duration-analysis (spec §10, View C)', () => {
  it('per nights: minimum with its cell and n, calendar per provider, searched per series, gaps as null / empty', async () => {
    const { x, def } = await world();
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    expect(d.byNights.map((n) => n.nights)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    const ten = d.byNights[0];
    expect(ten?.minVerified).toMatchObject({ n: 1, pricePence: 60_000, cell: { ...C1, nights: 10 } });
    expect(ten?.minCalendar).toEqual([
      expect.objectContaining({
        providerId: 'fixture',
        n: 1,
        price: expect.objectContaining({ pricePence: 45_000 }),
      }),
    ]);
    // why: WP10's per-series counts: three of the four selected 10-night cells were itinerary-searched (C4 was not
    // reached); the fixture answered C1, C2 and C3 of every 10-night cell of the window (C4's tile failed)
    const tenTotal = generateCells(currentSpace(def, x.clock.todayLondon())).filter(
      (c) => c.nights === 10,
    ).length;
    expect(ten?.searched).toEqual({
      verification: { searched: 3, total: 4 },
      discovery: [{ providerId: 'fixture', searched: 3, total: tenTotal }],
    });
    expect(d.byNights[1]).toMatchObject({
      nights: 11,
      minVerified: null,
      minCalendar: [],
      searched: {
        verification: { searched: 0, total: 0 },
        discovery: [{ providerId: 'fixture', searched: 0, total: tenTotal }],
      },
    });
  });
});

describe('superseded calendar prices on the views (decision 54, WP10 Task 10.1 shapes)', () => {
  it('a day, a stay length and the cell detail mark a price a later search found empty, and prefer a current one', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const C1b = cell('LHR', 'JFK', '2026-11-02', '2026-11-13'); // same day, 11 nights
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1, C1b]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-29) });
    s.tile('Eold', C1b, { status: 'priced', pricePence: 50_000, fetchedAt: at(-29), tileIndex: 1 });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('Enew', [C1, C1b]);
    s.tile('Enew', C1, { status: 'empty', fetchedAt: at(-2) });
    s.tile('Enew', C1b, { status: 'priced', pricePence: 52_000, fetchedAt: at(-2), tileIndex: 1 });
    const day = (
      await get(
        x,
        `/api/definitions/${def.id}/calendar`,
        '/api/definitions/:id/calendar',
        apiContract.calendarResponseSchema,
      )
    ).days.find((d) => d.date === '2026-11-02');
    expect(day?.cheapestCalendar).toMatchObject({ pricePence: 52_000, superseded: false });
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    // why: the duration reads the latest parent's own fetches, so the 10-night minimum is gone, not superseded
    expect(d.byNights.find((n) => n.nights === 10)?.minCalendar).toEqual([]);
    const detail = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      apiContract.cellDetailResponseSchema,
    );
    expect(detail.calendarPrices.map((p) => [p.pricePence, p.superseded])).toEqual([[30_000, true]]);
  });
});

describe('duration analysis over one set of executions (review prov-012)', () => {
  it('counts a cell the latest run reused as searched and takes its reused price as the minimum (decision 58)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 41_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1, C2]);
    s.reuse('Enew', 'Eold', [C1], at(-100));
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-1), tileIndex: 1 });
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    const ten = d.byNights.find((n) => n.nights === 10);
    expect(ten?.minCalendar.map((m) => [m.price.pricePence, m.n])).toEqual([[41_000, 2]]);
    expect(ten?.searched.discovery[0]?.searched).toBe(2);
  });

  it("an older run's price is neither a minimum nor marks a nights value searched once a newer run skipped it", async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-29) });
    s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C2], { selected: [{ cell: C2, reason: 'top_n' }] });
    s.verified('E2', C2, [{ hash: 'hW', pricePence: 61_000, fetchedAt: at(-1) }]);
    const d = await get(
      x,
      `/api/definitions/${def.id}/duration-analysis`,
      '/api/definitions/:id/duration-analysis',
      apiContract.durationAnalysisResponseSchema,
    );
    const ten = d.byNights.find((n) => n.nights === 10);
    expect(ten?.minVerified).toMatchObject({ pricePence: 61_000, n: 1, cell: { ...C2, nights: 10 } });
    expect(ten?.minVerified?.cell.departureDate).toBe('2026-11-03');
    expect(ten?.searched.verification).toEqual({ searched: 1, total: 1 });
    expect(ten?.minCalendar).toEqual([]);
    expect(ten?.searched.discovery.map((s) => s.searched)).toEqual([0]);
  });
});

describe('GET /api/definitions/:id/coverage (spec §10, View D)', () => {
  it('summary, per stage × provider with requests, selected-but-not-reached, errors with retry, blocked schedule', async () => {
    const { x, def, s } = await world();
    const cov = await get(
      x,
      `/api/definitions/${def.id}/coverage`,
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(cov.executionId).toBe(s.id('E1'));
    expect(cov.summary).toEqual({
      buckets: { priced: 1, empty: 1, no_data: 1, error: 1, skipped: 0, not_run: 0, reused: 0 },
      total: 4,
      selected: 4,
      itinerarySearched: 3,
      onDemand: 0,
      reused: 0,
    });
    expect(cov.perStage.find((p) => p.stage === 'discovery')).toMatchObject({
      providerId: 'fixture',
      total: 4,
      requests: { calls: 0, cacheHits: 0, costMicroGbp: 0, planCalls: null },
      overrun: false,
      parityBreak: false,
    });
    expect(cov.selectedNotReached).toEqual([{ cell: { ...C4, nights: 10 }, reason: 'not_run' }]);
    expect(cov.errors).toEqual([
      expect.objectContaining({
        stage: 'discovery',
        providerId: 'fixture',
        reason: 'upstream',
        lastError: 'HTTP 503',
        attempts: 1,
        retryable: true,
      }),
    ]);
    expect(cov.scheduleBlockedSince).toBeNull();
  });

  it('404 no_execution before the first run', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const res = await x.request(`/api/definitions/${def.id}/coverage`);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('no_execution');
  });
});

describe('GET /api/definitions/:id/calendar-gap (spec §10, §6.9)', () => {
  it('lists calendar prices below the cheapest class-verified price', async () => {
    const { x, def, s } = await world();
    s.tile('E1', C2, { status: 'priced', pricePence: 70_000, fetchedAt: at(-1), tileIndex: 9 });
    const gap = await get(
      x,
      `/api/definitions/${def.id}/calendar-gap`,
      '/api/definitions/:id/calendar-gap',
      apiContract.calendarGapResponseSchema,
    );
    expect(gap.cheapestVerified).toMatchObject({
      pricePence: 60_000,
      itineraryHash: 'hV',
      provenance: { providerId: 'fixture' },
    });
    expect(gap.cells.map((c) => [c.cell.departureDate, c.calendar.pricePence, c.verifyAvailable])).toEqual([
      ['2026-11-02', 45_000, true],
    ]);
  });
  it('is empty when the definition has no verification provider', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    expect(
      await get(
        x,
        `/api/definitions/${def.id}/calendar-gap`,
        '/api/definitions/:id/calendar-gap',
        apiContract.calendarGapResponseSchema,
      ),
    ).toEqual({ cheapestVerified: null, cells: [] });
  });
});

describe('GET /api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate (spec §10, View B side panel)', () => {
  const route = '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate';
  it("returns the cell's outcomes per stage and provider, its prices with provenance, and the verify cap from the engine", async () => {
    const { x, def, s } = await world();
    const preview = vi
      .spyOn(x.engine, 'childCapPreview')
      .mockReturnValue({ ok: true, maxCalls: 6, headroomCalls: 994 });
    const d = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      route,
      apiContract.cellDetailResponseSchema,
    );
    expect(d.outcomes.map((o) => [o.executionId, o.stage, o.status]).sort()).toEqual([
      [s.id('E1'), 'discovery', 'priced'],
      [s.id('E1'), 'verification', 'priced'],
    ]);
    expect(
      d.calendarPrices.map((p) => [p.pricePence, p.provenance.providerId, p.executionId, p.truncated]),
    ).toEqual([[45_000, 'fixture', s.id('E1'), false]]);
    expect(d.observations.map((o) => [o.itineraryHash, o.pricePence, o.verdictClass])).toEqual([
      ['hV', 60_000, 'verified'],
    ]);
    expect(d.verify).toEqual({ maxCalls: 6, headroomCalls: 994 });
    expect(preview).toHaveBeenCalledWith(def.id, C1);
  });
  it('drops a hostile stored booking from the observations it lists (decision 54, review SEC-R2-3)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    const url = 'https://user:pw@evil.example:8443/book';
    s.verified('E1', C1, [
      {
        hash: 'hH',
        pricePence: 50_000,
        fetchedAt: at(-1),
        booking: { kind: 'get', url, host: 'evil.example' },
      },
    ]);
    const d = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      route,
      apiContract.cellDetailResponseSchema,
    );
    expect(d.observations.map((o) => o.booking)).toEqual([{ kind: 'none' }]);
    expect(JSON.stringify(d)).not.toContain('evil.example');
  });

  it('verify is null without a verification provider', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    const d = await get(
      x,
      `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`,
      route,
      apiContract.cellDetailResponseSchema,
    );
    expect(d.verify).toBeNull();
  });
  it('400 on a malformed path parameter', async () => {
    const { x, def } = await world();
    expect((await x.request(`/api/definitions/${def.id}/cells/LHR/JFK/2026-02-30/2026-03-10`)).status).toBe(
      400,
    );
    expect((await x.request(`/api/definitions/${def.id}/cells/LHRX/JFK/2026-11-02/2026-11-12`)).status).toBe(
      400,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/views.test.ts`
Expected: FAIL: every view route answers 404 `not_found`.

- [ ] **Step 3: Implement**

`apps/api/src/read/calendar.ts` (new file):

```ts
/** Spec §10 `/calendar` (View B) and `/calendar-gap` (spec §6.9). */
import {
  addDays,
  type apiContract,
  type CellOutcome,
  cellKeyString,
  dedupByItinerary,
  type Iata,
  type ProviderId,
  type RollUp,
  type SearchDefinition,
  sixBuckets,
} from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import { pickCalendar, pickVerified } from './pick.js';
import { confirmedIn, loadRows } from './results.js';
import { calendarStaleAfterHours, priceOf, type ResultRow } from './rows.js';

export type CalendarResponse = z.infer<typeof apiContract.calendarResponseSchema>;
export type CalendarGapResponse = z.infer<typeof apiContract.calendarGapResponseSchema>;

/** A verified-basis figure with its "not seen in latest search" mark (decision 54). */
function verifiedFigure(r: ResultRow) {
  return { ...priceOf(r), notSeenInLatest: r.notSeenInLatest };
}

/** True when the cell's verification roll-up is priced with no confirmed price (decisions 45, 48, 51). */
function unconfirmed(r: RollUp | undefined): boolean {
  return r?.status === 'priced' && r.minPence === null;
}

/**
 * Spec §10 `GET /calendar`: one entry per departure date of the current window, for every destination or, with
 * `destination` (plan decision 53), for that destination's cells only — buckets, selection, minima and
 * `unconfirmedCells` alike, so a filtered day never counts another airport. Six-bucket counts and selection come from
 * the latest parent execution's outcomes (spec §8.1); completed children count per day as "on demand". The verified
 * figures (class verified; partially verified with its count) count only confirmed prices and are picked over every
 * confirmed offer before the per-itinerary dedup, so neither an unconfirmed offer (review prov-009) nor a cheaper stale
 * offer of the same itinerary (decision 58) hides the price shown; each prefers a row the newest search returned, then a
 * fresh one, then the cheaper (decision 54, spec §11 View B), with its marks. `unconfirmedCells` is the latest parent's
 * selected cells whose verification roll-up is priced with no confirmed price. No per-destination figures (decision 58).
 */
export function assembleCalendar(
  def: SearchDefinition,
  destination: Iata | undefined,
  ports: Ports,
): CalendarResponse {
  if (destination !== undefined && !def.destinations.includes(destination))
    throw new ApiError(422, 'unknown_destination', API_TEXT.unknownDestination);
  const loaded = loadRows(def, ports);
  const parent = loaded.latestParent;
  const mine = (c: { destination: Iata }) => destination === undefined || c.destination === destination;
  const outcomes: CellOutcome[] =
    parent === null ? [] : ports.repos.cells.outcomes(parent.id, { stage: 'discovery' }).filter(mine);
  const rollUps =
    parent === null
      ? new Map<string, { discovery: RollUp; verification: RollUp }>()
      : ports.repos.cells.rollUps(parent.id);
  const selected =
    parent === null ? [] : ports.repos.cells.selected(parent.id).filter(({ cell }) => mine(cell));
  const children = loaded.all.filter(
    (e) => e.isChild && e.status === 'completed' && e.cell !== null && mine(e.cell),
  );
  // why: plan decision 58: the minima are picked (seen, then fresh, then cheaper) over every confirmed offer, before the
  // per-itinerary dedup, whose primary offer is chosen on price before age and would hide a fresh offer from another
  // seller behind a cheaper stale one. The dedup only sizes the partially-verified `count`.
  const confirmed = loaded.verified.filter(confirmedIn(loaded)).filter((r) => mine(r.cell));
  const verified = dedupByItinerary(confirmed, loaded.rc.now);
  const calendar = loaded.calendar.filter((r) => mine(r.cell));
  const providers = def.providers.discovery;
  const days: CalendarResponse['days'] = [];
  for (let d = loaded.space.departureFrom; d <= loaded.space.departureTo; d = addDays(d, 1)) {
    const onDay = (r: ResultRow) => r.cell.departureDate === d;
    const offers = confirmed.filter(onDay);
    const cal = calendar.filter(onDay);
    const partial = verified.filter((r) => onDay(r) && r.verdictClass === 'partially-verified');
    const best = pickVerified(offers.filter((r) => r.verdictClass === 'verified'));
    const bestPartial = pickVerified(offers.filter((r) => r.verdictClass === 'partially-verified'));
    const bestCal = pickCalendar(cal);
    const sel = selected.filter(({ cell }) => cell.departureDate === d);
    days.push({
      date: d,
      discovery: providers.flatMap((providerId: ProviderId) => {
        const list = outcomes.filter((o) => o.departureDate === d && o.providerId === providerId);
        return list.length === 0 ? [] : [{ providerId, buckets: sixBuckets(list), total: list.length }];
      }),
      verification: {
        selected: sel.length,
        itinerarySearched: sel.filter(({ cell }) => {
          const s = rollUps.get(cellKeyString(cell))?.verification.status ?? null;
          return s !== null && SEARCHED.has(s);
        }).length,
        onDemand: children.filter((e) => e.cell?.departureDate === d).length,
        unconfirmedCells: sel.filter(({ cell }) =>
          unconfirmed(rollUps.get(cellKeyString(cell))?.verification),
        ).length,
      },
      cheapestVerified:
        best === null || best.itineraryHash === null
          ? null
          : { ...verifiedFigure(best), cell: best.cell, itineraryHash: best.itineraryHash },
      cheapestPartiallyVerified:
        bestPartial === null || bestPartial.itineraryHash === null
          ? null
          : {
              ...verifiedFigure(bestPartial),
              cell: bestPartial.cell,
              itineraryHash: bestPartial.itineraryHash,
              count: partial.length,
            },
      cheapestCalendar:
        bestCal === null ? null : { ...priceOf(bestCal), cell: bestCal.cell, superseded: bestCal.superseded },
    });
  }
  const calendarStale: Partial<Record<ProviderId, number>> = {};
  for (const id of providers) calendarStale[id] = calendarStaleAfterHours(loaded.rc, id);
  return {
    days,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    staleAfterHours: ports.config.staleAfterHours,
    calendarStaleAfterHours: calendarStale,
  };
}

/**
 * Spec §10 `GET /calendar-gap`: current calendar prices below the reference verified price (latest seen, then fresh,
 * then cheapest; decisions 54, 58): the class-verified confirmed price picked as every verified figure is, with its mark; empty without a verification provider. A superseded calendar price is not listed: a
 * later search of that cell found no fares. why: search_cells.best_observation_id is the cheapest observation written,
 * not the cheapest class-verified one, so the yardstick is computed at read time (plan round-2 pin).
 */
export function assembleCalendarGap(def: SearchDefinition, ports: Ports): CalendarGapResponse {
  if (def.providers.verification.length === 0) return { cheapestVerified: null, cells: [] };
  const loaded = loadRows(def, ports);
  const best = pickVerified(
    loaded.verified.filter(confirmedIn(loaded)).filter((r) => r.verdictClass === 'verified'),
  );
  if (best === null || best.itineraryHash === null) return { cheapestVerified: null, cells: [] };
  const below = loaded.calendar
    .filter((r) => !r.superseded && r.pricePence < best.pricePence)
    .sort((a, b) => a.pricePence - b.pricePence);
  return {
    cheapestVerified: { ...verifiedFigure(best), cell: best.cell, itineraryHash: best.itineraryHash },
    cells: below.map((r) => ({ cell: r.cell, calendar: priceOf(r), verifyAvailable: true })),
  };
}
```

`apps/api/src/read/duration.ts` (new file):

```ts
/** Spec §10 `/duration-analysis` (View C). */
import {
  type apiContract,
  type CellKey,
  cellKeyString,
  daysBetween,
  generateCells,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import { pickCalendar, pickVerified } from './pick.js';
import { confirmedIn, EXECUTIONS_LIMIT, loadRows } from './results.js';
import { priceOf, type ResultRow } from './rows.js';
import { cellInSpace } from './space.js';

export type DurationResponse = z.infer<typeof apiContract.durationAnalysisResponseSchema>;

const cellsOf = (rows: readonly ResultRow[]): number => new Set(rows.map((r) => cellKeyString(r.cell))).size;

/**
 * Spec §10 `GET /duration-analysis`: per nights value, no interpolation (absent → null / []). Plan decision 54: the
 * minima and the `searched` counts read the same executions — the latest parent and the completed children — and the
 * same provider list, the definition's discovery providers, so a price never sits beside "not searched". Each minimum
 * carries its cell; `n` counts the cells of that nights value with a class-verified confirmed price (verified, picked
 * as every verified figure is, with its "not seen in latest search" mark) or that the provider priced (calendar, a
 * current price before a superseded one, with its `superseded` mark). `searched` counts per series, as WP10's Task 10.1
 * declares it: verification over the selected cells of the nights value (the latest parent's selection and the
 * completed children's cells), discovery over every cell of the nights value in the current space; `searched` is those
 * whose outcome in the set is priced, empty or no_data.
 */
export function assembleDuration(def: SearchDefinition, ports: Ports): DurationResponse {
  const all = ports.repos.executions.listForDefinition(def.id, {
    limit: EXECUTIONS_LIMIT,
    includeChildren: true,
  });
  const parent = all.find((e) => !e.isChild);
  const children = all.filter((e) => e.isChild && e.status === 'completed');
  const set = [...(parent === undefined ? [] : [parent]), ...children];
  const loaded = loadRows(
    def,
    ports,
    set.map((e) => e.id),
  );
  // why: plan decision 58: picked over every confirmed offer before any per-itinerary dedup (see assembleCalendar).
  const verified = loaded.verified.filter(confirmedIn(loaded)).filter((r) => r.verdictClass === 'verified');
  const inSpace = (c: CellKey) => cellInSpace(loaded.space, c);
  const answered = new Set(
    set
      .flatMap((e) => ports.repos.cells.outcomes(e.id))
      .filter((o) => SEARCHED.has(o.status) && inSpace(o))
      .map((o) => `${o.stage}|${o.stage === 'discovery' ? o.providerId : ''}|${cellKeyString(o)}`),
  );
  const selected = [
    ...(parent === undefined ? [] : ports.repos.cells.selected(parent.id).map(({ cell }) => cell)),
    ...children.flatMap((e) => (e.cell === null ? [] : [e.cell])),
  ].filter(inSpace);
  const selectedKeys = [...new Map(selected.map((c) => [cellKeyString(c), c])).values()];
  const space = generateCells(loaded.space);
  const nightsOf = (c: CellKey) => daysBetween(c.departureDate, c.returnDate);
  const count = (cells: readonly CellKey[], stage: string, providerId: string) => ({
    searched: cells.filter((c) => answered.has(`${stage}|${providerId}|${cellKeyString(c)}`)).length,
    total: cells.length,
  });
  const byNights: DurationResponse['byNights'] = [];
  for (let n = def.minNights; n <= def.maxNights; n++) {
    const v = verified.filter((r) => r.cell.nights === n);
    const best = pickVerified(v);
    const ofNights = space.filter((c) => c.nights === n);
    byNights.push({
      nights: n,
      minVerified:
        best === null
          ? null
          : { ...priceOf(best), cell: best.cell, n: cellsOf(v), notSeenInLatest: best.notSeenInLatest },
      minCalendar: def.providers.discovery.flatMap((providerId) => {
        const rows = loaded.calendar.filter(
          (r) => r.cell.nights === n && r.provenance.providerId === providerId,
        );
        const b = pickCalendar(rows);
        return b === null
          ? []
          : [
              {
                providerId,
                price: { ...priceOf(b), cell: b.cell, superseded: b.superseded },
                n: cellsOf(rows),
              },
            ];
      }),
      searched: {
        verification: count(
          selectedKeys.filter((c) => nightsOf(c) === n),
          'verification',
          '',
        ),
        discovery: def.providers.discovery.map((providerId) => ({
          providerId,
          ...count(ofNights, 'discovery', providerId),
        })),
      },
    });
  }
  return { byNights, executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)) };
}
```

`apps/api/src/read/coverageView.ts` (new file):

```ts
/** Spec §10 `/coverage` (View D). Separate from `coverage.ts` so `results.ts` → `coverage.ts` stays acyclic. */
import { type apiContract, type CellOutcome, type SearchDefinition, selectedNotReached } from '@gmt/core';
import { retriedOnResume } from '@gmt/db';
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
import { executionResponse, overrunOf, planCallsOf } from './executions.js';
import { withNights } from './rows.js';

export type CoverageResponse = z.infer<typeof apiContract.coverageResponseSchema>;
/**
 * What a manual resume would pick up again: WP3's `retriedOnResume`, the predicate the resume query is built from
 * (review arch-005), so View D's "retry" and the resume never disagree.
 */
export function retryable(o: Pick<CellOutcome, 'status' | 'reason' | 'attempts'>): boolean {
  return retriedOnResume(o, true);
}

/**
 * Spec §10 `GET /coverage` (View D) for the latest parent execution: six buckets per stage × provider with request
 * counts, the overrun flag (decision 43: discovery on tiles) and the parity flag, selected-but-not-reached cells,
 * errors with retry. 404 `no_execution` before the first run (the contract names one execution).
 */
export function assembleCoverage(def: SearchDefinition, ports: Ports, engine: Engine): CoverageResponse {
  const all = ports.repos.executions.listForDefinition(def.id, { limit: 500, includeChildren: true });
  const parent = all.find((e) => !e.isChild) ?? null;
  if (parent === null) throw new ApiError(404, 'no_execution', API_TEXT.noExecution);
  const summary = coverageSummaryFor(parent, all, ports);
  const counts = ports.repos.ledger.countsFor(parent.id);
  const parityBreak = ports.repos.notifications.wasSent('parity_break', parent.id, def.id);
  const perStage = executionResponse(ports, parent).progress.map((p) => {
    const line = counts.perProvider.find((c) => c.providerId === p.providerId && c.stage === p.stage);
    const planCalls = planCallsOf(parent, p.stage, p.providerId);
    return {
      ...p,
      requests: {
        calls: line?.calls ?? 0,
        cacheHits: line?.cacheHits ?? 0,
        costMicroGbp: line?.costMicroGbp ?? 0,
        planCalls,
      },
      overrun: overrunOf(p.stage, line, planCalls),
      parityBreak,
    };
  });
  const outcomes = ports.repos.cells.outcomes(parent.id);
  const notReached = selectedNotReached(
    ports.repos.cells.selected(parent.id).map((s) => s.cell),
    outcomes.filter((o) => o.stage === 'verification'),
  );
  return {
    executionId: parent.id,
    summary,
    perStage,
    selectedNotReached: notReached.map((s) => ({ cell: withNights(s.cell), reason: s.reason })),
    errors: outcomes
      .filter((o) => o.status === 'error')
      .map((o) => ({
        cell: withNights(o),
        stage: o.stage,
        providerId: o.providerId,
        reason: o.reason ?? '',
        lastError: o.lastError,
        attempts: o.attempts,
        retryable: retryable(o),
      })),
    scheduleBlockedSince: engine.scheduler.blockedSince(),
  };
}
```

`apps/api/src/read/cell.ts` (new file):

```ts
/** Spec §10 cell route (the View B side panel). */
import { type apiContract, type CellKey, cellKeyString, type SearchDefinition } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { loadRows } from './results.js';
import { type ResultRow, withNights } from './rows.js';

export type CellDetailResponse = z.infer<typeof apiContract.cellDetailResponseSchema>;

/**
 * Spec §10 cell route: outcomes per execution × stage × provider, prices with provenance, the observations as rows.
 * `verify` is what a per-cell verify would spend now, from `Engine.childCapPreview` (the same sizing the child gets,
 * decisions 42, 45, 48); null without a verification provider or when the preview refuses the cell (`not_found`, `window`). A priced
 * verification outcome with a null `minPence` is passed through as stored: its price was not confirmed (decision 48).
 */
export function assembleCellDetail(
  def: SearchDefinition,
  target: CellKey,
  ports: Ports,
  engine: Engine,
): CellDetailResponse {
  const key = cellKeyString(target);
  const loaded = loadRows(def, ports);
  const onCell = (r: ResultRow) => cellKeyString(r.cell) === key;
  // why: WP7's preview refuses a cell it would not verify (`not_found`, `window`); the button then has nothing to show.
  const preview = def.providers.verification.length > 0 ? engine.childCapPreview(def.id, target) : null;
  return {
    cell: withNights(target),
    outcomes: loaded.all.flatMap((e) => ports.repos.cells.outcomes(e.id, { cells: [target] })),
    calendarPrices: loaded.calendar.filter(onCell).flatMap((r) =>
      r.calendarPriceId === null
        ? []
        : [
            {
              pricePence: r.pricePence,
              provenance: r.provenance,
              stale: r.stale,
              ageHours: r.ageHours,
              truncated: r.truncated,
              executionId: r.executionId,
              calendarPriceId: r.calendarPriceId,
              superseded: r.superseded,
            },
          ],
    ),
    observations: loaded.verified.filter(onCell),
    verify:
      preview?.ok === true ? { maxCalls: preview.maxCalls, headroomCalls: preview.headroomCalls } : null,
  };
}
```

`apps/api/src/routes/results.ts` (replace the file):

```ts
/** Spec §10 read routes over a definition's executions: results and the four views, and the cell detail. */
import { apiContract, type CellKey, iataSchema, isoDateSchema } from '@gmt/core';
import { ApiError } from '../errors.js';
import { assembleCalendar, assembleCalendarGap } from '../read/calendar.js';
import { assembleCellDetail } from '../read/cell.js';
import { assembleCoverage } from '../read/coverageView.js';
import { assembleDuration } from '../read/duration.js';
import { assembleResults } from '../read/results.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable } from './types.js';

/** Path parameters of the cell route; the route declares no params schema, so they are validated here. */
function cellFromPath(input: { params: Record<string, string> }): CellKey {
  const o = iataSchema.safeParse(param(input, 'origin'));
  const d = iataSchema.safeParse(param(input, 'destination'));
  const dep = isoDateSchema.safeParse(param(input, 'departureDate'));
  const ret = isoDateSchema.safeParse(param(input, 'returnDate'));
  if (!o.success || !d.success || !dep.success || !ret.success)
    throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return { origin: o.data, destination: d.data, departureDate: dep.data, returnDate: ret.data };
}

export const resultHandlers: HandlerTable = {
  'GET /api/definitions/:id/results': route(
    { request: NO_INPUT, query: apiContract.resultsQuerySchema },
    (c, input, ctx) =>
      c.json(assembleResults(getLiveDefinition(ctx, param(input, 'id')), input.query, ctx.ports)),
  ),
  // why: plan decision 53: both bases come back per day; `destination` narrows the day to one destination's cells.
  'GET /api/definitions/:id/calendar': route(
    { request: NO_INPUT, query: apiContract.calendarQuerySchema },
    (c, input, ctx) =>
      c.json(
        assembleCalendar(getLiveDefinition(ctx, param(input, 'id')), input.query.destination, ctx.ports),
      ),
  ),
  'GET /api/definitions/:id/duration-analysis': plain((c, input, ctx) =>
    c.json(assembleDuration(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  ),
  'GET /api/definitions/:id/coverage': plain((c, input, ctx) =>
    c.json(assembleCoverage(getLiveDefinition(ctx, param(input, 'id')), ctx.ports, ctx.engine)),
  ),
  'GET /api/definitions/:id/calendar-gap': plain((c, input, ctx) =>
    c.json(assembleCalendarGap(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  ),
  'GET /api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate': plain((c, input, ctx) =>
    c.json(
      assembleCellDetail(
        getLiveDefinition(ctx, param(input, 'id')),
        cellFromPath(input),
        ctx.ports,
        ctx.engine,
      ),
    ),
  ),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/views.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 21 tests; typecheck clean (run `test/routes/results.test.ts` too: still 26).

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.12a**: in `apps/api/src/read/pick.ts` replace `  const rank = (r: ResultRow) => [r.notSeenInLatest === null ? 0 : 1, r.stale ? 1 : 0, r.pricePence];` with `  const rank = (r: ResultRow) => [r.pricePence];`. Fails: “prefers a price the newest search returned over a cheaper one it did not, and marks the latter”; “prefers a fresh price over a cheaper stale one on the same day”; “a fresh offer from another seller is shown before a cheaper stale offer of the same itinerary (decision 58)”.

- **8.12f**: in `apps/api/src/read/calendar.ts` replace `    const offers = confirmed.filter(onDay);` with `    const offers = verified.filter(onDay);`. Fails: “a fresh offer from another seller is shown before a cheaper stale offer of the same itinerary (decision 58)”.

- **8.12b**: in `apps/api/src/read/calendar.ts` replace `  const confirmed = loaded.verified.filter(confirmedIn(loaded)).filter((r) => mine(r.cell));` with `  const confirmed = loaded.verified.filter((r) => mine(r.cell));`. Fails: “an offer whose price the final step did not confirm is never a cheapest itinerary-search price (decisions 45, 48)”.

- **8.12c**: in `apps/api/src/read/calendar.ts` replace `    parent === null ? [] : ports.repos.cells.selected(parent.id).filter(({ cell }) => mine(cell));` with `    parent === null ? [] : ports.repos.cells.selected(parent.id);`. Fails: “with destination=, buckets, selection and minima count that destination only; 422 for another”.

- **8.12e**: in `apps/api/src/read/pick.ts` replace `  return cheapest(rows.filter((r) => !r.superseded)) ?? cheapest(rows);` with `  return cheapest(rows);`. Fails: “a day, a stay length and the cell detail mark a price a later search found empty, and prefer a current one”.

- **8.12d**: in `apps/api/src/read/duration.ts` replace

```ts
  const loaded = loadRows(
    def,
    ports,
    set.map((e) => e.id),
  );
```

  with

```ts
  const loaded = loadRows(def, ports);
```

  Fails: “a day, a stay length and the cell detail mark a price a later search found empty, and prefer a current one”; “an older run's price is neither a minimum nor marks a nights value searched once a newer run skipped it”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: calendar with destination filter and minima picked before dedup, duration over one execution set with reused prices, coverage, calendar gap and cell detail"
```

### Task 8.13: History routes and alert rule storage

**Files:**
- Create: `apps/api/src/read/history.ts`, `src/routes/history.ts`, `src/routes/alerts.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/history.test.ts`, `apps/api/test/routes/alerts.test.ts`

**Interfaces:**
- Consumes: `ItinerariesRepo.get`, `ItinerariesRepo.offerHistory` (with Task 8.0's `suppliedFields` and `executionId`), `CalendarPricesRepo.history`, `RoutePriceHistoryRepo.series`, `DefinitionsRepo.list`, `AlertsRepo` (WP3); `staleness`, `calendarThreshold`, `truncationOf` (Task 8.11); `isStale` (core, Task 8.0); `itineraryHistoryResponseSchema`, `routeHistoryResponseSchema`, `routeHistoryQuerySchema`, `alertRuleInputSchema`, `alertRuleUpdateRequestSchema`, `alertRulesQuerySchema`, `alertEventsQuerySchema`, `iataSchema` (core).
- Produces: `itineraryHistory`, `routeHistory`; routes `GET /api/itineraries/:hash/history`, `GET /api/routes/:origin/:destination/history`, `GET/POST /api/alerts`, `PUT/DELETE /api/alerts/:id`, `GET /api/alerts/events`.

Rules (spec §7, §10, §11; decisions 36, 38, 42, 44, 52, 54, 55): itinerary history is the itinerary's own `cell` and `carriers` from its stored row (404 `itinerary_not_found` for an unknown hash) and one series per (provider, seller, cabin); each point carries the `executionId` of the run that observed it, `stale` (verified-basis rule, core's `isStale`), `truncated: false` and `priceConfirmed` (`price` among the observation's supplied fields). Route history is the calendar series per provider in the requested cabin (`?cabin=`, default economy), one point per execution fetch carrying its `cell` and `executionId` (reused rows excluded by the repository), each with `stale` by the calendar rule (the refresh of a live definition flying the pair, else core's default) and `truncated` from its discovery outcome; plus the route-level lowest-price series per provider for the requested cabin and `'unknown'`, plotted by `date` (empty when the vendor supplies none, decision 40), each point `stale` by its fetch age against the provider's calendar threshold: core's `isStale` with an unknown vendor age, since the vendor dates the series no further (review prov-004, decisions 54, 55). WP10 labels that series indicative; it is GBP-only by contract (decision 25). Alert routes store and read rules and events only; evaluation and delivery are WP11. `DELETE /api/alerts/:id` soft-deletes (events kept). `GET /api/alerts` filters by `?definitionId=` (`alertRulesQuerySchema`); `GET /api/alerts/events` by `ruleId` and `definitionId`. Events are read generically through WP3's repository and validated by the contract's `alertEventSchema`, so the route is unchanged by WP11's migration 0002 (statuses `queued | notified | suppressed`, spec rev 25); its test seeds a `suppressed` event (a status on both sides of 0002) with a payload in the shape of WP11's `alertEventPayloadSchema` (decision 56), and no WP8 code or test uses `'sent'`. A PUT is validated on the merged rule, so the `requireAllVerified` refinement (spec §6.8) cannot be bypassed by a partial update.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/history.test.ts` (new file):

```ts
// Spec §10, §7 history routes: provenance, staleness, truncation and confirmation on every point (decisions 36, 38, 42, 44).
import { apiContract, TRUNCATED_NOTE } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

const ITINERARY = apiContract.itineraryHistoryResponseSchema;
const ROUTE = apiContract.routeHistoryResponseSchema;
const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function world() {
  const x = await createHarness();
  h = x;
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput());
  s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-299) });
  s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1, C2], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.cells('E2', [C1, C2], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-299) }]);
  s.verified('E2', C1, [{ hash: 'hV', pricePence: 59_000, fetchedAt: at(-1), confirmed: false }]);
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-299) });
  s.reuse('E2', 'E1', [C1], at(-400));
  s.tile('E2', C2, {
    status: 'priced',
    pricePence: 47_000,
    fetchedAt: at(-1),
    lastError: TRUNCATED_NOTE,
    tileIndex: 1,
  });
  s.routeLowest({
    origin: 'LHR',
    destination: 'JFK',
    date: '2026-10-13',
    pricePence: 44_000,
    fetchedAt: at(-1),
  });
  return { x, s };
}

describe('history routes (spec §10, §7)', () => {
  it('itinerary history: one series per provider, seller and cabin, points in time order with provenance, stale and confirmation', async () => {
    const { x, s } = await world();
    const body = await expectContract(
      await x.request('/api/itineraries/hV/history'),
      'GET',
      '/api/itineraries/:hash/history',
      ITINERARY,
    );
    expect(body.itineraryHash).toBe('hV');
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ providerId: 'fixture', seller: 'BA', cabin: 'economy' });
    expect(body.series[0]?.points.map((p) => [p.pricePence, p.stale, p.truncated, p.priceConfirmed])).toEqual(
      [
        [60_000, true, false, true],
        [59_000, false, false, false],
      ],
    );
    expect(body.series[0]?.points.every((p) => p.provenance.providerId === 'fixture')).toBe(true);
    // decision 52 (WP10 Task 10.1): the itinerary names its own trip, and each point the run that observed it
    expect(body.cell).toEqual({ ...C1, nights: 10 });
    expect(body.carriers).toEqual(['BA']);
    expect(body.series[0]?.points.map((p) => p.executionId)).toEqual([s.id('E1'), s.id('E2')]);
    const unknown = await x.request('/api/itineraries/nope/history');
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('itinerary_not_found');
  });

  it('route history: one calendar point per execution fetch, reused rows excluded, stale and truncated, and the route-level series by cabin and date', async () => {
    const { x, s } = await world();
    const body = await expectContract(
      await x.request('/api/routes/LHR/JFK/history'),
      'GET',
      '/api/routes/:origin/:destination/history',
      ROUTE,
    );
    expect([body.origin, body.destination]).toEqual(['LHR', 'JFK']);
    expect(
      body.calendarSeries
        .find((c) => c.providerId === 'fixture')
        ?.points.map((p) => [p.pricePence, p.executionId, p.stale, p.truncated]),
    ).toEqual([
      [45_000, s.id('E1'), true, false],
      [47_000, s.id('E2'), false, true],
    ]);
    expect(
      body.routeSeries
        .find((r) => r.providerId === 'fixture' && r.cabin === 'unknown')
        ?.points.map((p) => [p.date, p.pricePence]),
    ).toEqual([['2026-10-13', 44_000]]);
    // decisions 54, 55: a route-level point is stale by its fetch age (the vendor gives the series no age)
    const route = body.routeSeries.find((r) => r.providerId === 'fixture');
    expect(route?.points.map((p) => p.stale)).toEqual([false]);
    x.clock.advance(200 * 3_600_000);
    const later = await expectContract(
      await x.request('/api/routes/LHR/JFK/history'),
      'GET',
      '/api/routes/:origin/:destination/history',
      ROUTE,
    );
    expect(later.routeSeries.find((r) => r.providerId === 'fixture')?.points.map((p) => p.stale)).toEqual([
      true,
    ]);
  });

  it('reads the requested cabin and rejects a bad airport code', async () => {
    const { x } = await world();
    const business = await expectContract(
      await x.request('/api/routes/LHR/JFK/history?cabin=business'),
      'GET',
      '/api/routes/:origin/:destination/history',
      ROUTE,
    );
    expect(business.calendarSeries.every((c) => c.points.length === 0)).toBe(true);
    expect((await x.request('/api/routes/LHRX/JFK/history')).status).toBe(400);
  });
});
```

`apps/api/test/routes/alerts.test.ts` (new file):

```ts
// Spec §6.8, §10 alert rule storage and events (WP11 evaluates and delivers).
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at } from '../helpers/seed.js';

const RULE = apiContract.alertRuleSchema;
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(): Promise<Harness> {
  h = await createHarness();
  return h;
}

const rule = (definitionId: string) => ({
  definitionId,
  type: 'absolute',
  thresholdPence: 50_000,
  pct: null,
  basis: 'verified',
  requireAllVerified: true,
  cooldownHours: 336,
  enabled: true,
});

describe('alert rules (spec §6.8, §10; storage only, WP11 evaluates)', () => {
  it('create, list, update, delete', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const created = await x.request('/api/alerts', { json: rule(def.id) });
    expect(created.status).toBe(201);
    const r = await expectContract(created, 'POST', '/api/alerts', RULE);
    const listed = await expectContract(
      await x.request(`/api/alerts?definitionId=${def.id}`),
      'GET',
      '/api/alerts',
      RULE.array(),
    );
    expect(listed).toHaveLength(1);
    const put = await x.request(`/api/alerts/${r.id}`, { method: 'PUT', json: { thresholdPence: 40_000 } });
    expect((await expectContract(put, 'PUT', '/api/alerts/:id', RULE)).thresholdPence).toBe(40_000);
    expect((await x.request(`/api/alerts/${r.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await x.request(`/api/alerts?definitionId=${def.id}`)).json()).toEqual([]);
    const gone = await x.request(`/api/alerts/${r.id}`, { method: 'DELETE' });
    expect(gone.status).toBe(404);
    expect((await errorOf(gone)).code).toBe('alert_not_found');
  });

  it('requireAllVerified is rejected on calendar basis, on create and through a partial update', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    expect((await x.request('/api/alerts', { json: { ...rule(def.id), basis: 'calendar' } })).status).toBe(
      400,
    );
    const r = await expectContract(
      await x.request('/api/alerts', { json: rule(def.id) }),
      'POST',
      '/api/alerts',
      RULE,
    );
    const res = await x.request(`/api/alerts/${r.id}`, { method: 'PUT', json: { basis: 'calendar' } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('invalid_alert_rule');
  });

  it('a rule for an unknown definition is refused', async () => {
    const x = await harness();
    const res = await x.request('/api/alerts', { json: rule('nope') });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('definition_not_found');
  });

  it('lists events by rule and by definition; events are kept after a soft delete', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const r = await expectContract(
      await x.request('/api/alerts', { json: rule(def.id) }),
      'POST',
      '/api/alerts',
      RULE,
    );
    x.ports.repos.alerts.insertEvent({
      ruleId: r.id,
      identityKey: `${r.id}|hV`,
      observationId: null,
      calendarPriceId: null,
      dedupKey: `${r.id}|hV|500`,
      firedAt: at(-1),
      // why: 'suppressed' is a status before and after WP11's migration 0002 (sent → notified, failed → queued), and the
      // payload has WP11's alertEventPayloadSchema shape, so this test holds on either side of WP11 (decision 56)
      status: 'suppressed',
      reason: 'below £500',
      payload: {
        digestId: null,
        executionId: 'ex-1',
        pricePence: 41_200,
        provenance: {
          providerId: 'fixture',
          sourceKind: 'synthetic',
          fetchedAt: at(-1),
          maxAgeHours: 'unknown',
          fx: { converted: false },
          pointOfSale: 'unknown',
          cabin: 'economy',
        },
        previous: null,
        isNew: false,
        route: 'LHR→JFK 2 Nov–12 Nov (10n)',
        verdictClass: 'verified',
        unverified: [],
        reason: { kind: 'threshold', gapHours: null },
        staleThresholdHours: 192,
        truncated: false,
        notSeenInLatest: null,
      },
    });
    const EVENTS = apiContract.alertEventSchema.array();
    const events = await expectContract(
      await x.request(`/api/alerts/events?ruleId=${r.id}`),
      'GET',
      '/api/alerts/events',
      EVENTS,
    );
    expect(events.map((e) => [e.status, e.reason])).toEqual([['suppressed', 'below £500']]);
    expect((await x.request(`/api/alerts/${r.id}`, { method: 'DELETE' })).status).toBe(200);
    const after = (q: string) =>
      x
        .request(`/api/alerts/events?${q}`)
        .then((res) => expectContract(res, 'GET', '/api/alerts/events', EVENTS));
    expect(await after(`ruleId=${r.id}`)).toHaveLength(1);
    expect(await after(`definitionId=${def.id}`)).toHaveLength(1);
    expect(await after('definitionId=other')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/history.test.ts test/routes/alerts.test.ts`
Expected: FAIL: the routes answer 404 `not_found`.

- [ ] **Step 3: Implement**

`apps/api/src/read/history.ts` (new file):

```ts
/** Spec §10 history routes: points with provenance, staleness, truncation and confirmation (decisions 36, 38, 42, 44). */
import {
  type apiContract,
  type Cabin,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type Iata,
  isStale,
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { truncationOf } from './results.js';
import { calendarThreshold, staleness, withNights } from './rows.js';

export type ItineraryHistoryResponse = z.infer<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.infer<typeof apiContract.routeHistoryResponseSchema>;

/**
 * One series per (provider, seller, cabin), oldest first (spec §11 History), under the itinerary's own `cell` and
 * `carriers` from its stored row (decision 52, WP10 Task 10.1); 404 for an unknown hash. Each point names the execution
 * whose observation it is, is stale by the verified-basis rule (STALE_AFTER_HOURS, decisions 44, 55), never truncated
 * (an itinerary search has no pages), and says whether the final step confirmed its price (`price` among the
 * observation's supplied fields, decisions 27, 37, 42).
 */
export function itineraryHistory(hash: string, ports: Ports): ItineraryHistoryResponse {
  const now = ports.clock.now();
  const it = ports.repos.itineraries.get(hash);
  if (it === null) throw new ApiError(404, 'itinerary_not_found', API_TEXT.itineraryNotFound);
  return {
    itineraryHash: hash,
    cell: withNights(it),
    carriers: it.marketingCarriers,
    series: ports.repos.itineraries.offerHistory(hash).map((s) => ({
      providerId: s.providerId,
      seller: s.seller,
      cabin: s.cabin,
      points: s.points.map(({ suppliedFields, ...p }) => ({
        ...p,
        stale: staleness(p.provenance, ports.config.staleAfterHours, now).stale,
        truncated: false,
        priceConfirmed: suppliedFields.includes('price'),
      })),
    })),
  };
}

/** The refresh a route point is judged by: the newest live definition flying the pair with that provider, else the default. */
function refreshFor(
  defs: readonly SearchDefinition[],
  origin: Iata,
  destination: Iata,
  providerId: ProviderId,
): number {
  for (const d of defs) {
    if (!d.origins.includes(origin) || !d.destinations.includes(destination)) continue;
    const h = d.providers.discoveryRefreshHours[providerId];
    if (h !== undefined) return h;
  }
  return DEFAULT_DISCOVERY_REFRESH_HOURS;
}

/**
 * Route history: the calendar series per provider in the requested cabin, one point per execution fetch carrying its
 * cell and execution (reused rows excluded by the repository), each stale by the calendar rule and truncated when its
 * discovery outcome was (decisions 36, 38); plus the route-level lowest-price series per provider, for the requested
 * cabin and `'unknown'` (SearchApi's vendor gives none), plotted by `date` (spec §7 `route_price_history`, decision 40).
 * Plan decision 54: each route-level point carries `stale` by fetch age against the provider's calendar threshold (the
 * series is GBP-only by contract, decision 25, and WP10 labels it indicative).
 */
export function routeHistory(
  origin: Iata,
  destination: Iata,
  cabin: Cabin,
  ports: Ports,
): RouteHistoryResponse {
  const now = ports.clock.now();
  const truncated = truncationOf(ports);
  const defs = ports.repos.definitions.list();
  return {
    origin,
    destination,
    calendarSeries: ports.repos.calendarPrices.history(origin, destination, cabin).map((s) => {
      const threshold = calendarThreshold(
        ports.config,
        ports.providers,
        s.providerId,
        refreshFor(defs, origin, destination, s.providerId),
      );
      return {
        providerId: s.providerId,
        cabin,
        points: s.points.map((p) => ({
          ...p,
          stale: staleness(p.provenance, threshold, now).stale,
          truncated: truncated({
            executionId: p.executionId,
            reusedFromExecutionId: null,
            providerId: s.providerId,
            cell: p.cell,
          }),
        })),
      };
    }),
    routeSeries: ports.providers
      .flatMap((p) => {
        const threshold = calendarThreshold(
          ports.config,
          ports.providers,
          p.id,
          refreshFor(defs, origin, destination, p.id),
        );
        return [cabin, 'unknown' as const].map((cab) => ({
          providerId: p.id,
          cabin: cab,
          points: ports.repos.routeHistory.series(origin, destination, p.id, cab).map((pt) => ({
            ...pt,
            // why: decision 54: stale by fetch age. The vendor gives the series no age, so core's rule (decision 55)
            // reads it as an unknown vendor age, which counts the fetch age alone. The web labels the series indicative.
            stale: isStale({ fetchedAt: pt.fetchedAt, maxAgeHours: 'unknown' }, now, threshold),
          })),
        }));
      })
      .filter((s) => s.points.length > 0),
  };
}
```

`apps/api/src/routes/history.ts` (new file):

```ts
/** Spec §10 history routes. */
import { apiContract, iataSchema } from '@gmt/core';
import { ApiError } from '../errors.js';
import { itineraryHistory, routeHistory } from '../read/history.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { param } from './shared.js';
import type { HandlerTable } from './types.js';

export const historyHandlers: HandlerTable = {
  'GET /api/itineraries/:hash/history': plain((c, input, ctx) =>
    c.json(itineraryHistory(param(input, 'hash'), ctx.ports)),
  ),

  'GET /api/routes/:origin/:destination/history': route(
    { request: NO_INPUT, query: apiContract.routeHistoryQuerySchema },
    (c, input, ctx) => {
      const o = iataSchema.safeParse(param(input, 'origin'));
      const d = iataSchema.safeParse(param(input, 'destination'));
      if (!o.success || !d.success) throw new ApiError(400, 'validation', API_TEXT.validation('path'));
      return c.json(routeHistory(o.data, d.data, input.query.cabin ?? 'economy', ctx.ports));
    },
  ),
};
```

`apps/api/src/routes/alerts.ts` (new file):

```ts
/** Spec §6.8, §10 alert rule storage and events; evaluation and delivery are WP11's. */
import { type AlertRule, apiContract } from '@gmt/core';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

function requireDefinition(ctx: RouteContext, id: string): void {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null)
    throw new ApiError(
      422,
      'definition_not_found',
      API_TEXT.definitionNotFound,
      fieldsDetail([{ field: 'definitionId', message: API_TEXT.definitionNotFound }]),
    );
}

function getRule(ctx: RouteContext, id: string): AlertRule {
  const rule = ctx.ports.repos.alerts.get(id);
  if (rule === null) throw new ApiError(404, 'alert_not_found', API_TEXT.alertNotFound);
  return rule;
}

export const alertHandlers: HandlerTable = {
  'GET /api/alerts': route(
    { request: NO_INPUT, query: apiContract.alertRulesQuerySchema },
    (c, { query }, ctx) => c.json(ctx.ports.repos.alerts.rules(query.definitionId)),
  ),

  'POST /api/alerts': route(
    { request: apiContract.alertRuleInputSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      requireDefinition(ctx, body.definitionId);
      return c.json(ctx.ports.repos.alerts.create(body), 201);
    },
  ),

  'PUT /api/alerts/:id': route(
    { request: apiContract.alertRuleUpdateRequestSchema, query: NO_INPUT },
    (c, input, ctx) => {
      const { id, ...current } = getRule(ctx, param(input, 'id'));
      // why: validate the merged rule, so a partial update cannot slip past the requireAllVerified refinement (spec §6.8).
      const merged = apiContract.alertRuleInputSchema.safeParse({ ...current, ...input.body });
      if (!merged.success)
        throw new ApiError(
          422,
          'invalid_alert_rule',
          API_TEXT.validation('body'),
          fieldsDetail(issuesToFields(merged.error.issues)),
        );
      if (merged.data.definitionId !== current.definitionId) requireDefinition(ctx, merged.data.definitionId);
      return c.json(ctx.ports.repos.alerts.update(id, merged.data));
    },
  ),

  'DELETE /api/alerts/:id': plain((c, input, ctx) => {
    const existing = getRule(ctx, param(input, 'id'));
    // why: alert rules soft-delete so their events stay readable (plan decision 15).
    ctx.ports.repos.alerts.softDelete(existing.id);
    return c.json(existing);
  }),

  // why: events are read generically through WP3's repository and validated by the contract's `alertEventSchema`, so
  // the route works before and after WP11's migration 0002 (statuses `queued | notified | suppressed`) and needs no
  // change when WP11 adds `alertEventPayloadSchema` (decision 56).
  'GET /api/alerts/events': route(
    { request: NO_INPUT, query: apiContract.alertEventsQuerySchema },
    (c, { query }, ctx) =>
      c.json(
        ctx.ports.repos.alerts.events({
          ...(query.ruleId === undefined ? {} : { ruleId: query.ruleId }),
          ...(query.definitionId === undefined ? {} : { definitionId: query.definitionId }),
          limit: query.limit ?? 100,
        }),
      ),
  ),
};
```

`apps/api/src/routes/index.ts` (replace the file):

```ts
/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { alertHandlers } from './alerts.js';
import { definitionHandlers } from './definitions.js';
import { executionHandlers } from './executions.js';
import { historyHandlers } from './history.js';
import { resultHandlers } from './results.js';
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
  ...definitionHandlers,
  ...executionHandlers,
  ...resultHandlers,
  ...historyHandlers,
  ...alertHandlers,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/history.test.ts test/routes/alerts.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 3 + 4 tests; typecheck clean.

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.13a**: in `apps/api/src/read/history.ts` replace `            stale: isStale({ fetchedAt: pt.fetchedAt, maxAgeHours: 'unknown' }, now, threshold),` with `            stale: false,`. Fails: “route history: one calendar point per execution fetch, reused rows excluded, stale and truncated, and the route-level series by cabin and date”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: history routes: itinerary cell and carriers, points with execution, stale, truncated and priceConfirmed, stale route points; alert rule storage"
```

### Task 8.14: `POST /api/tools/record` inside the app process

**Files:**
- Create: `apps/api/src/routes/tools.ts`, `src/tools/inProcess.ts`
- Modify: `apps/api/src/routes/index.ts`, `src/bootstrap/app.ts` (`main` passes `inProcessTools`)
- Test: `apps/api/test/routes/tools.test.ts`

**Interfaces:**
- Consumes: `runRecord`, `recordPrecheck` (WP4b `src/tools/record.ts`), `RecordCli` (`src/tools/recordPlan.ts`), `recordingTarget`, `RecordingTarget`, `runTool` (`src/bootstrap/tool.ts`), `EXIT`, `safeMessage`; `syntheticAllowed`; `toolRecordRequestSchema`, `toolRunResponseSchema` (core).
- Produces: `inProcessTools(ports, opts?)` returning `HttpToolRunners` (named apart from WP4b's CLI `ToolRunners`, review arch-009); route `POST /api/tools/record`.

Rules (spec §7, §10, §13; reviews SEC-7, arch-009): the route needs auth like every other; it runs the record tool in this process (the app holds `app_lock`, so the tool bootstrap would refuse) through WP4b's own `runRecord` over the app's ports, so the plan, the budget position and every spend refusal are the CLI's; one tool at a time through the one in-flight guard, `oneAtATime` under the key `tool` with the contract's `409 tool_busy` (decision 58: no second guard); an unregistered runner answers `503 tool_unavailable`; a runner that throws answers `500 tool_failed` and logs the message through `safeMessage`. The runner refuses, before any call and with the CLI's exit codes and in `runTool`'s order, an open synthetic gate (70), a route that may not enter the committed tree (64; HTTP has no `--out`) and a configuration that cannot record (78); a test runs both over the same refusing configurations and compares the codes. Over HTTP there is no `--confirm-rerun`, so a rerun that needs it ends 65. Every output line passes through `safeMessage` (URL queries and secrets stripped) before it leaves the process, and `fixturesWritten` lists the files the run added, relative to the recorded root, so no absolute path of the host is returned. The request's own abort signal stops the run. `POST /api/tools/smoke` is WP13's and stays unmounted.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/tools.test.ts` (new file):

```ts
// Spec §10, §7 `POST /api/tools/record` inside the app process.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiContract, FIXTURE_OPT_IN_PHRASE } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../../src/bootstrap/tool.js';
import type { ToolRunResponse } from '../../src/routes/types.js';
import { inProcessTools } from '../../src/tools/inProcess.js';
import type { runRecord } from '../../src/tools/record.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_TP, silentLog } from '../helpers/env.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { onCleanup, tempDir } from '../helpers/tmp.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(opts: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  h = await createHarness(opts);
  return h;
}

const TOOL = apiContract.toolRunResponseSchema;
const ok: ToolRunResponse = {
  exitCode: 0,
  summary: 'done',
  lines: ['1 call'],
  fixturesWritten: ['fixtures/recorded/x.json'],
};
const body = { budget: 5, origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'], month: '2027-03' };

describe('POST /api/tools/record (spec §10, §7 app_lock)', () => {
  it('requires auth', async () => {
    const x = await harness({ app: { tools: { record: async () => ok } } });
    expect((await x.request('/api/tools/record', { method: 'POST', json: body, auth: false })).status).toBe(
      401,
    );
  });

  it('503 when the runner is not registered; the smoke route is not mounted by WP8', async () => {
    const x = await harness();
    const res = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('tool_unavailable');
    const smoke = await x.request('/api/tools/smoke', {
      method: 'POST',
      json: { origin: 'LHR', destination: 'JFK' },
    });
    expect((await errorOf(smoke)).code).toBe('not_found');
  });

  it('runs the registered runner with the validated arguments', async () => {
    const record = vi.fn(async (_args: unknown, _signal: AbortSignal) => ok);
    const x = await harness({ app: { tools: { record } } });
    const res = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(await expectContract(res, 'POST', '/api/tools/record', TOOL)).toEqual(ok);
    expect(record.mock.calls[0]?.[0]).toEqual(body);
    expect(
      (await x.request('/api/tools/record', { method: 'POST', json: { ...body, budget: 0 } })).status,
    ).toBe(400);
  });

  it('one tool at a time', async () => {
    let release: (() => void) | undefined;
    const slow = () => new Promise<ToolRunResponse>((resolve) => (release = () => resolve(ok)));
    const x = await harness({ app: { tools: { record: slow } } });
    const first = x.request('/api/tools/record', { method: 'POST', json: body });
    await vi.waitFor(() => expect(release).toBeDefined());
    const busy = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(busy.status).toBe(409);
    expect((await errorOf(busy)).code).toBe('tool_busy');
    release?.();
    expect((await first).status).toBe(200);
  });

  it('a failing runner answers 500 tool_failed without leaking URLs or secrets', async () => {
    const x = await harness({
      app: {
        tools: {
          record: async () =>
            Promise.reject(new Error('GET https://example.test/x?api_key=SENTINEL-TOOL failed')),
        },
      },
    });
    const res = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('tool_failed');
    expect(text).not.toContain('SENTINEL-TOOL');
    expect(x.logLines.join('')).not.toContain('SENTINEL-TOOL');
  });

  it('the in-process runner refuses with the CLI exit code while the synthetic gate is open (70)', async () => {
    const x = await harness();
    const record = inProcessTools(x.ports).record;
    expect(record).toBeDefined();
    const r = await record?.(apiContract.toolRecordRequestSchema.parse(body), new AbortController().signal);
    expect(r).toMatchObject({ exitCode: 70, fixturesWritten: [] });
    expect(TOOL.safeParse(r).success).toBe(true);
  });
});

describe('the in-process runner outside the synthetic gate (plan exit-code table)', () => {
  it('refuses another route with 64 and a configuration without both vendors with 78, before any call', async () => {
    const dbPath = join(tempDir('gmt-tools-'), 'app.db');
    const config = loadConfigFromEnv(
      cleanEnv({
        NODE_ENV: 'development',
        DATABASE_PATH: dbPath,
        BIND_ADDRESS: '127.0.0.1',
        LOG_LEVEL: 'error',
      }),
    );
    const ports = buildPorts(config, { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    onCleanup(() => ports.db.close());
    const record = inProcessTools(ports).record;
    const signal = new AbortController().signal;
    const other = apiContract.toolRecordRequestSchema.parse({
      ...body,
      origins: ['LGW'],
      destinations: ['EWR'],
    });
    expect(await record?.(other, signal)).toMatchObject({ exitCode: 64, fixturesWritten: [] });
    expect(await record?.(apiContract.toolRecordRequestSchema.parse(body), signal)).toMatchObject({
      exitCode: 78,
    });
  });
});

describe('the in-process runner: refusal order, scrubbed lines and relative paths (reviews SEC-7, arch-010)', () => {
  const argv = (b: {
    budget: number;
    origins: readonly string[];
    destinations: readonly string[];
    month: string;
  }) => [
    '--budget',
    String(b.budget),
    '--route',
    `${b.origins.join(',')}:${b.destinations.join(',')}`,
    '--month',
    b.month,
  ];
  const vendors = { TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd' };

  function portsFor(env: Record<string, string>, file = 'app.db') {
    const fullEnv = cleanEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: join(tempDir('gmt-tools-'), file),
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'error',
      ...env,
    });
    const ports = buildPorts(loadConfigFromEnv(fullEnv), { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    onCleanup(() => ports.db.close());
    return { ports, env: fullEnv };
  }

  it.each([
    ['an open synthetic gate', { ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE }, 'app.fixture.db', body, 70],
    ['another route', {}, 'app.db', { ...body, origins: ['LGW'], destinations: ['EWR'] }, 64],
    ['no vendor keys', {}, 'app.db', body, 78],
  ] as const)('%s: the same exit code as runTool', async (_label, extra, file, args, code) => {
    const { ports, env } = portsFor(extra, file);
    const lines: string[] = [];
    const cli = await runTool('record', argv(args), {
      env,
      err: (l) => lines.push(l),
      out: (l) => lines.push(l),
    });
    const http = await inProcessTools(ports).record?.(
      apiContract.toolRecordRequestSchema.parse(args),
      new AbortController().signal,
    );
    expect([cli, http?.exitCode]).toEqual([code, code]);
  });

  it('every line has URL queries and secrets scrubbed, and fixturesWritten is relative to the recorded root', async () => {
    const { ports } = portsFor(vendors);
    const root = join(tempDir('gmt-rec-'), 'fixtures', 'recorded');
    const fake: typeof runRecord = async (_ports, _cli, o) => {
      o.out(`GET https://api.example.test/v1?token=${SENTINEL_TP} 200`);
      o.err(`key ${SENTINEL_SA} rejected`);
      mkdirSync(join(o.recordedRoot, 'travelpayouts'), { recursive: true });
      writeFileSync(join(o.recordedRoot, 'travelpayouts', 'x.json'), '{}');
      return 0;
    };
    const r = await inProcessTools(ports, {
      recording: { root, recordedBy: 'test' },
      runRecord: fake,
    }).record?.(apiContract.toolRecordRequestSchema.parse(body), new AbortController().signal);
    expect(r?.exitCode).toBe(0);
    expect(r?.fixturesWritten).toEqual([join('travelpayouts', 'x.json')]);
    const text = JSON.stringify(r);
    for (const leak of [SENTINEL_TP, SENTINEL_SA, 'token=', root]) expect(text).not.toContain(leak);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/tools.test.ts`
Expected: FAIL: `Cannot find module '../../src/tools/inProcess.js'`.

- [ ] **Step 3: Implement**

`apps/api/src/routes/tools.ts` (new file):

```ts
/** Spec §10 `/tools/record`: the recording script inside the app process, which holds app_lock (spec §7). */
import { apiContract } from '@gmt/core';
import { ApiError } from '../errors.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, route } from './define.js';
import { oneAtATime } from './shared.js';
import type { HandlerTable } from './types.js';

const TOOL_KEY = 'tool';

export const toolHandlers: HandlerTable = {
  /** One tool at a time; an unregistered runner is 503; a runner that throws is 500 with a scrubbed log line. */
  'POST /api/tools/record': route(
    { request: apiContract.toolRecordRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      const record = ctx.tools.record;
      if (record === undefined)
        throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable('record'));
      // why: one tool at a time, whichever it is (spec §10 `/tools/*`): one key, the contract's 409 tool_busy.
      return oneAtATime(
        ctx,
        TOOL_KEY,
        async () => {
          // why: the request's own signal ends the run when the client disconnects, as SIGINT ends the CLI run.
          try {
            return c.json(await record(body, c.req.raw.signal));
          } catch (err) {
            ctx.ports.log.error(
              { tool: 'record', err: { message: safeMessage(err, ctx.ports.secrets) } },
              'tool failed',
            );
            throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed('record'));
          }
        },
        () => new ApiError(409, 'tool_busy', API_TEXT.toolBusy('record')),
      );
    },
  ),
};
```

`apps/api/src/tools/inProcess.ts` (new file):

```ts
/**
 * The tools reachable while the app holds app_lock (spec §7, §10): WP4b's `runRecord`, the same function the tool
 * bootstrap runs, over the app's own ports, with its output collected into the api-contract tool response. WP13 owns
 * smoke.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { syntheticAllowed } from '@gmt/core';
import { type RecordingTarget, recordingTarget } from '../bootstrap/tool.js';
import type { HttpToolRunners, ToolRecordRequest, ToolRunResponse } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { recordPrecheck, runRecord } from './record.js';
import type { RecordCli } from './recordPlan.js';
import { EXIT } from './types.js';

/** Every file under `root`, or none when it does not exist yet. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

function refused(exitCode: number, line: string): ToolRunResponse {
  return {
    exitCode,
    summary: API_TEXT.toolSummary('record', exitCode, 0),
    lines: [line],
    fixturesWritten: [],
  };
}

/** Test seams; production passes none. `runRecord` stands in for WP4b's runner (review SEC-7's sentinel test). */
export interface InProcessOptions {
  recording?: RecordingTarget;
  runRecord?: typeof runRecord;
}

/**
 * The record runner over `runRecord`. why: the refusals mirror `runTool`'s order and exit codes (plan exit-code
 * table), which a test pins by running both over the same refusing config: an open synthetic gate (70), a route that
 * may not enter the committed tree (64), a configuration that cannot record (78); the run itself refuses for spend
 * with 65 (no `--confirm-rerun` over HTTP). Every line is URL- and secret-scrubbed with `safeMessage` before it leaves
 * the process (review SEC-7), and `fixturesWritten` lists the files the run added, relative to the recorded root.
 */
export function inProcessTools(ports: Ports, opts: InProcessOptions = {}): HttpToolRunners {
  const run = opts.runRecord ?? runRecord;
  return {
    record: async (args: ToolRecordRequest, signal: AbortSignal) => {
      if (syntheticAllowed(ports.config)) return refused(EXIT.refusedTestEnv, API_TEXT.toolSynthetic);
      const cli: RecordCli = { args, dryRun: false, confirmRerun: false, out: null };
      const target = recordingTarget(cli, opts.recording);
      if ('refusal' in target) return refused(EXIT.usage, target.refusal);
      const precheck = recordPrecheck(ports.config);
      if (precheck !== null) return refused(EXIT.badConfig, precheck);
      const lines: string[] = [];
      const keep = (l: string) => lines.push(safeMessage(l, ports.secrets));
      const before = new Set(filesUnder(target.root));
      const exitCode = await run(ports, cli, {
        signal,
        out: keep,
        err: keep,
        recordedRoot: target.root,
        recordedBy: target.recordedBy,
      });
      const fixturesWritten = filesUnder(target.root)
        .filter((f) => !before.has(f))
        .map((f) => relative(target.root, f));
      return {
        exitCode,
        summary: API_TEXT.toolSummary('record', exitCode, fixturesWritten.length),
        lines,
        fixturesWritten,
      };
    },
  };
}
```

`apps/api/src/routes/index.ts` (replace the file):

```ts
/** Every handler, keyed by its ROUTES entry (`${method} ${path}`). */
import { alertHandlers } from './alerts.js';
import { definitionHandlers } from './definitions.js';
import { executionHandlers } from './executions.js';
import { historyHandlers } from './history.js';
import { resultHandlers } from './results.js';
import { systemHandlers } from './system.js';
import { toolHandlers } from './tools.js';
import type { HandlerTable } from './types.js';

export const HANDLERS: HandlerTable = {
  ...systemHandlers,
  ...definitionHandlers,
  ...executionHandlers,
  ...resultHandlers,
  ...historyHandlers,
  ...alertHandlers,
  ...toolHandlers,
};
```

`apps/api/src/bootstrap/app.ts` — find:

```ts
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
```

`apps/api/src/bootstrap/app.ts` — replace with:

```ts
import { safeMessage } from '../safeMessage.js';
import { inProcessTools } from '../tools/inProcess.js';
import { EXIT } from '../tools/types.js';
```

`apps/api/src/bootstrap/app.ts` — find:

```ts
      listen: true,
      assets: assetPaths(),
    });
```

`apps/api/src/bootstrap/app.ts` — replace with:

```ts
      listen: true,
      assets: assetPaths(),
      tools: (p) => inProcessTools(p),
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/tools.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 11 tests; typecheck clean.

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.14a**: in `apps/api/src/tools/inProcess.ts` replace `const keep = (l: string) => lines.push(safeMessage(l, ports.secrets));` with `const keep = (l: string) => lines.push(l);`. Fails: “every line has URL queries and secrets scrubbed, and fixturesWritten is relative to the recorded root”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: POST /api/tools/record in-process over WP4b's runRecord, refusals in runTool's order, scrubbed lines, relative paths"
```

### Task 8.15: Contract sweep: strict mounting, auth flags, every response against `core/api-contract`, provenance by shape, banned words, sentinels; folder coverage thresholds

**Files:**
- Modify: `apps/api/src/app.ts`, `apps/api/vitest.config.ts`
- Test: `apps/api/test/routes/contract-sweep.test.ts`

**Interfaces:**
- Consumes: `apiContract.ROUTES`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`, `TRUNCATED_NOTE` (core); every handler table.
- Produces: `createApp` throws when a ROUTES entry has no handler (unless listed in `OWNED_ELSEWHERE`) or a handler has no ROUTES entry.

Rules (spec §9 item 5; reviews prov-005, SEC-10, TS-7): the provenance sweep is shape-based — every object holding `pricePence`, `minPence` or `lowestPricePence` must carry `provenance` or a `providerId` + `sourceKind` pair and `stale` (itself or an enclosing object; row-level outcomes excepted), and a `fixture` price must be `synthetic` and the reverse — over a seeded world with a truncated tile, an unconfirmed offer, an unknown-age observation, a route-level point and a hostile stored booking (a post to an off-allowlist host with userinfo and a port, which no response may carry: review SEC-R2-3), so a price field added later is checked without editing the sweep. The banned-word sweep covers every `API_TEXT` entry and every user-facing string of every response. The sentinel sweep sends provider keys and the password in a path, a query, a malformed body and a verify body as well as on the happy routes, and finds none — nor the base64 of either Basic credential (review SEC-R2-4) — in any body or log line. `vitest.config.ts` adds per-folder thresholds for `src/read/**` and `src/routes/**` (90% lines, functions, statements; 80% branches), so a file there cannot hide behind the package average.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/contract-sweep.test.ts` (new file):

```ts
// Spec §9 item 5 sweeps: strict mounting, auth flags, every GET against core/api-contract with provenance on every
// price, banned words in every API string, sentinel secrets never in a body or a log line.
import { apiContract, BANNED_WORD_ALLOWLIST, findBannedWords, TRUNCATED_NOTE } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { OWNED_ELSEWHERE } from '../../src/routes/types.js';
import { API_TEXT } from '../../src/text.js';
import { expectEnvelopeOrContract } from '../helpers/contract.js';
import { SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { AUTH_USER, basic, createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const mounted = apiContract.ROUTES.filter((r) => !OWNED_ELSEWHERE.has(`${r.method} ${r.path}`));

/**
 * A small world touching every read route and every provenance shape (review TS-4): a parent execution, a calendar
 * price, a truncated tile, a confirmed observation, an unconfirmed one, an unknown-age one, a route-level point and an
 * alert rule.
 */
function seedWorld(x: Harness): { def: string; exec: string; alert: string } {
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints: { maxStops: 1 } }));
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.cells('E1', [C2]);
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1) });
  s.tile('E1', C2, {
    status: 'priced',
    pricePence: 41_000,
    fetchedAt: at(-1),
    lastError: TRUNCATED_NOTE,
    tileIndex: 1,
  });
  s.verified('E1', C1, [
    { hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) },
    { hash: 'hU', pricePence: 58_000, fetchedAt: at(-1), confirmed: false },
    { hash: 'hA', pricePence: 61_000, fetchedAt: at(-1), maxAgeHours: 'unknown' },
    // why: review SEC-R2-3: a hostile stored link, so a route that bypassed the re-validation fails the contract here
    {
      hash: 'hH',
      pricePence: 62_000,
      fetchedAt: at(-1),
      booking: {
        kind: 'post',
        url: 'https://user:pw@evil.example:8443/book',
        postData: 'a=1',
        host: 'evil.example',
      },
    },
  ]);
  s.routeLowest({
    origin: 'LHR',
    destination: 'JFK',
    date: '2026-11-02',
    pricePence: 40_000,
    fetchedAt: at(-1),
  });
  const alert = x.ports.repos.alerts.create({
    definitionId: def.id,
    type: 'absolute',
    thresholdPence: 50_000,
    pct: null,
    basis: 'verified',
    requireAllVerified: true,
    cooldownHours: 336,
    enabled: true,
  });
  return { def: def.id, exec: s.id('E1'), alert: alert.id };
}

function fill(path: string, ids: { def: string; exec: string; alert: string }): string {
  const p = path
    .replace(/^\/api\/definitions\/:id/, `/api/definitions/${ids.def}`)
    .replace(/^\/api\/executions\/:id/, `/api/executions/${ids.exec}`)
    .replace(/^\/api\/alerts\/:id/, `/api/alerts/${ids.alert}`)
    .replace(':hash', 'hV')
    .replace(':origin', 'LHR')
    .replace(':destination', 'JFK')
    .replace(':departureDate', '2026-11-02')
    .replace(':returnDate', '2026-11-12');
  return p === '/api/airports' ? `${p}?q=LHR` : p;
}
const missing = { def: 'zz-missing', exec: 'zz-missing', alert: 'zz-missing' };

const PRICE_KEYS = ['pricePence', 'minPence', 'lowestPricePence'] as const;

/**
 * Paths of every object holding a price (`pricePence`, `minPence`, `lowestPricePence`) that does not say where it came
 * from and how old it is (spec §10, review TS-4): it must carry `provenance` or a `providerId` + `sourceKind` pair, and a
 * `stale` flag unless its provenance is the cell-level roll-up's; a fixture price must be synthetic and the reverse.
 * Shape-based, so a price field a later change adds is checked without editing this list.
 */
function unlabelledPrices(
  v: unknown,
  path = '$',
  inherited: { stale: boolean } = { stale: false },
): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => unlabelledPrices(x, `${path}[${i}]`, inherited));
  if (v === null || typeof v !== 'object') return [];
  const o = z.record(z.string(), z.unknown()).parse(v);
  const scope = { stale: inherited.stale || 'stale' in o };
  const problems: string[] = [];
  if (PRICE_KEYS.some((k) => typeof o[k] === 'number')) {
    const prov = z.object({ providerId: z.string(), sourceKind: z.string() }).safeParse(o.provenance ?? o);
    if (!prov.success) problems.push(`${path}: price without provenance`);
    else if ((prov.data.providerId === 'fixture') !== (prov.data.sourceKind === 'synthetic'))
      problems.push(`${path}: fixture and synthetic must go together`);
    if (!scope.stale && !('verdictClass' in o) && !('status' in o))
      problems.push(`${path}: price without stale`);
  }
  return [...problems, ...Object.entries(o).flatMap(([k, x]) => unlabelledPrices(x, `${path}.${k}`, scope))];
}

/** Every user-facing string in a response: reasons, notices, messages, labels, notes, summaries, assumptions. */
function userStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(userStrings);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => {
    if (['basisReason', 'message', 'label', 'ceilingNote', 'summary'].includes(k) && typeof x === 'string')
      return [x];
    if (['notices', 'assumptions', 'lines', 'notes'].includes(k) && Array.isArray(x))
      return x.filter((s): s is string => typeof s === 'string');
    return userStrings(x);
  });
}

/** Every API_TEXT entry as text: strings as they are, functions applied to sample arguments. */
function apiTexts(): string[] {
  return [
    API_TEXT.internal,
    API_TEXT.notFound,
    API_TEXT.unauthenticated,
    API_TEXT.rateLimited(42),
    API_TEXT.hostRejected('evil.example:3000'),
    API_TEXT.originRejected('https://evil.example'),
    API_TEXT.bodyTooLarge,
    API_TEXT.contentType,
    API_TEXT.requestedWith,
    API_TEXT.validation('body'),
    API_TEXT.malformedJson,
    API_TEXT.definitionNotFound,
    API_TEXT.executionNotFound,
    API_TEXT.noExecution,
    API_TEXT.alertNotFound,
    API_TEXT.alreadyRunning,
    API_TEXT.unknownProvider('fixture'),
    API_TEXT.unknownDestination,
    API_TEXT.itineraryNotFound,
    API_TEXT.draftNotice,
    API_TEXT.draftCannotEnable,
    API_TEXT.draftNoEstimate,
    API_TEXT.deletedNotice,
    API_TEXT.invalidDefinition,
    API_TEXT.zeroCells,
    API_TEXT.invalidCron('sub-hourly schedules are not allowed'),
    API_TEXT.scheduleOverBudget(['provider-month:searchapi']),
    API_TEXT.coverageCheckUnavailable,
    API_TEXT.zeroCapVerification,
    API_TEXT.ceilingNote(3500, 3200),
    API_TEXT.notCancellable('completed'),
    API_TEXT.cellNotInSpace,
    API_TEXT.unknownAirport('AAA'),
    API_TEXT.noVerificationProvider,
    API_TEXT.basisNoVerificationProvider,
    API_TEXT.basisNoObservations,
    API_TEXT.basisItinerarySearch,
    API_TEXT.basisRequestedCalendar,
    API_TEXT.insideSpace(0, 3),
    API_TEXT.toolUnavailable('record'),
    API_TEXT.toolBusy('record'),
    API_TEXT.toolFailed('record'),
    API_TEXT.toolSynthetic,
    API_TEXT.toolSummary('record', 0, 3),
  ];
}

describe('ROUTES mounting (spec §10)', () => {
  it('refuses a ROUTES entry without a handler and a handler without a ROUTES entry', async () => {
    const x = await harness();
    const extra = { method: 'GET', path: '/api/unmapped', response: z.object({}), auth: 'required' } as const;
    expect(() => createApp(x.ports, x.engine, { routes: [...apiContract.ROUTES, extra] })).toThrow(
      /no handler for GET \/api\/unmapped/,
    );
    expect(() =>
      createApp(x.ports, x.engine, { routes: apiContract.ROUTES.filter((r) => r.path !== '/api/budget') }),
    ).toThrow(/no route for handler GET \/api\/budget/);
  });

  it('every entry WP8 owns is mounted with its method and auth flag, and answers the contract or the envelope', async () => {
    const x = await harness();
    for (const route of mounted) {
      const path = fill(route.path, missing);
      const json = route.method === 'GET' ? undefined : {};
      const anonymous = await x.request(path, {
        method: route.method,
        auth: false,
        ...(json === undefined ? {} : { json }),
      });
      if (route.auth === 'required')
        expect(anonymous.status, `${route.method} ${route.path} without auth`).toBe(401);
      else expect(anonymous.status, `${route.method} ${route.path} is public`).not.toBe(401);
      const authed = await x.request(path, { method: route.method, ...(json === undefined ? {} : { json }) });
      const body = await expectEnvelopeOrContract(authed, route.method, route.path);
      const parsed = apiContract.errorEnvelopeSchema.safeParse(body);
      expect(parsed.success && parsed.data.error.code, `${route.method} ${route.path} is mounted`).not.toBe(
        'not_found',
      );
    }
  });
});

describe('every GET route against the contract, with provenance on every price (spec §9 item 5)', () => {
  it('validates each response and finds no price without provenance', async () => {
    const x = await harness();
    const ids = seedWorld(x);
    for (const route of mounted.filter((r) => r.method === 'GET')) {
      const res = await x.request(fill(route.path, ids));
      expect(res.status, route.path).toBe(200);
      const body = await expectEnvelopeOrContract(res, 'GET', route.path);
      expect(unlabelledPrices(body), route.path).toEqual([]);
      expect(JSON.stringify(body), route.path).not.toContain('evil.example:8443'); // the hostile stored link
    }
  });
});

describe('banned words in API strings (spec §11, §8.3)', () => {
  it('no fixed API string contains a banned word, and every API_TEXT entry is checked', () => {
    const texts = apiTexts();
    expect(texts).toHaveLength(Object.keys(API_TEXT).length);
    for (const text of texts) expect(findBannedWords(text, BANNED_WORD_ALLOWLIST), text).toEqual([]);
  });

  it('no reason, notice, message, label or summary in any response contains a banned word', async () => {
    const x = await harness();
    const ids = seedWorld(x);
    const texts: string[] = [];
    for (const route of mounted.filter((r) => r.method === 'GET'))
      texts.push(...userStrings(await (await x.request(fill(route.path, ids))).json()));
    texts.push(...userStrings(await (await x.request('/api/definitions', { method: 'POST' })).json()));
    texts.push(...userStrings(await (await x.request('/api/providers', { auth: false })).json()));
    expect(texts.length).toBeGreaterThan(3);
    for (const t of texts) expect(findBannedWords(t, BANNED_WORD_ALLOWLIST), t).toEqual([]);
  });
});

describe('sentinel secrets never reach a body or a log line (spec §5.3)', () => {
  it('provider keys and the auth password stay out of every response and log', async () => {
    const x = await harness({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const ids = seedWorld(x);
    const bodies: string[] = [];
    for (const route of mounted.filter((r) => r.method === 'GET'))
      bodies.push(await (await x.request(fill(route.path, ids))).text());
    bodies.push(
      await (
        await x.request('/api/providers', { headers: { authorization: basic(SENTINEL_SA, SENTINEL_TP) } })
      ).text(),
    );
    bodies.push(await (await x.request('/api/definitions', { json: { name: SENTINEL_SA } })).text());
    // why: review SEC-6: a secret the client sends back in a path, a query or a malformed body is never echoed
    bodies.push(await (await x.request(`/api/definitions/${SENTINEL_SA}`)).text());
    bodies.push(await (await x.request(`/api/executions/${SENTINEL_TP}`)).text());
    bodies.push(
      await (await x.request(`/api/definitions/${ids.def}/calendar?destination=${SENTINEL_SA}`)).text(),
    );
    bodies.push(await (await x.request(`/api/airports?q=${SENTINEL_TP}&limit=${SENTINEL_SA}`)).text());
    bodies.push(
      await (
        await x.request('/api/definitions', { method: 'POST', body: `{"name":"${SENTINEL_TP}"` })
      ).text(),
    );
    bodies.push(
      await (
        await x.request('/api/cells/verify', {
          json: { definitionId: SENTINEL_SA, cell: { origin: SENTINEL_TP } },
        })
      ).text(),
    );
    const everything = [...bodies, ...x.logLines].join('\n');
    // why: review SEC-R2-4: a logged Basic header would hold the base64 of user:pass, which contains neither sentinel
    const encoded = [basic(AUTH_USER, SENTINEL_AUTH), basic(SENTINEL_SA, SENTINEL_TP)].map((b) =>
      b.slice('Basic '.length),
    );
    for (const secret of [SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP, ...encoded])
      expect(everything).not.toContain(secret);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/contract-sweep.test.ts`
Expected: FAIL, 1 of 6: "refuses a ROUTES entry without a handler and a handler without a ROUTES entry" (`createApp` skips silently); the other sweeps pass when Tasks 8.8–8.14 are complete, and any failure there names the offending route and path.

- [ ] **Step 3: Implement**

`apps/api/src/app.ts` — find:

```ts
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const handler = HANDLERS[key];
    // why: Task 8.15 makes mounting strict once every handler exists; until then an unmapped entry answers 404.
    if (handler === undefined || OWNED_ELSEWHERE.has(key)) continue;
```

`apps/api/src/app.ts` — replace with:

```ts
  const routeKeys = new Set(routes.map((r) => `${r.method} ${r.path}`));
  for (const key of Object.keys(HANDLERS)) {
    // why: a handler for a route the contract no longer has is dead code the web client cannot reach.
    if (!routeKeys.has(key)) throw new Error(`no route for handler ${key}`);
  }
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (OWNED_ELSEWHERE.has(key)) continue; // why: another package mounts it (plan decision 4: smoke is WP13's)
    const handler = HANDLERS[key];
    // why: spec §10 is the route table; an entry without a handler is a contract the api does not honour.
    if (handler === undefined) throw new Error(`no handler for ${key}`);
```

`apps/api/src/app.ts` — find:

```ts
 error envelope, the spec §4 hardening and the auth gate. A handler whose schemas are not its ROUTES entry's refuses
 * to build.
```

`apps/api/src/app.ts` — replace with:

```ts
 error envelope, the spec §4 hardening and the auth gate. Strict: a ROUTES entry without a handler (unless another
 * package owns it), a handler without a ROUTES entry, or a handler whose schemas are not its entry's refuses to build.
```

`apps/api/vitest.config.ts` — find:

```ts
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
```

`apps/api/vitest.config.ts` — replace with:

```ts
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 85,
        statements: 85,
        // why: the read model and the routes carry the provenance and coverage rules (spec §6.9, §8.1, §10); a file
        // there cannot hide behind the package average (review TS-7).
        'src/read/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        'src/routes/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS, every test file (35 files, 381 tests in the assembly: 186 new here, 195 WP4b's) under the default test timeout; coverage at or above 85% lines, functions and statements and 70% branches for `src`, and the folder thresholds (the assembly measured 94.6 / 86.4 / 95.1 / 95.9 statements / branches / functions / lines overall, `src/read` 96.5 / 81.3 / 96.6 / 97.7, `src/routes` 96.2 / 93.0 / 100 / 96.8).

- [ ] **Step 5: See the tests bite**

Apply each temporary mutation alone, run the task's test file, see the named tests fail, revert:

- **8.15a**: in `apps/api/src/read/history.ts` delete the line `stale: isStale({ fetchedAt: pt.fetchedAt, maxAgeHours: 'unknown' }, now, threshold),`. Fails: “validates each response and finds no price without provenance”.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: strict ROUTES mounting; contract, shape-based provenance, banned-word and error-path sentinel sweeps; folder coverage thresholds"
```

## 9. Pinned review-focus tests

| Plan review-focus line | Owned here | Test |
|---|---|---|
| 4. The definition is edited while an execution is running: results filter to the current resolved space and may be empty; the header says "0 of N rows are inside the current window and nights range" rather than "no results" (WP8: `/results` reports the excluded count in `basisReason`) | yes | Task 8.11, `test/routes/results.test.ts` › "review focus 4: the definition is edited after the rows were written" (both bases and the default; `excludedByCurrentSpace` 3, `basisReason` contains `API_TEXT.insideSpace(0, 3)`) |

Lines 1, 2, 3 and 5 belong to other packages. Line 1's server side (a lower-case IATA code upper-cased) is exercised in Task 8.9 (`origins: ['lhr']` → `LHR`, through core's `iataSchema`); line 2 (future timestamps clamp) indirectly through core's `effectiveAge`.

## 10. Definition of done

Run from the repository root:

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/api test` | every test passes under the default test timeout, including `bootstrap/app.spawn` (a real production bootstrap); coverage ≥ 85% lines, functions, statements and ≥ 70% branches for `apps/api/src`, and ≥ 90% lines, functions, statements and ≥ 80% branches for each of `src/read/**` and `src/routes/**` |
| `pnpm --filter @gmt/core test`, `pnpm --filter @gmt/db test` and `pnpm --filter @gmt/engine test` | pass; core at 100% on every metric with Tasks 8.0a, 8.0b and 8.0's tests; the engine's barrel test pins Task 8.0's exports |
| `pnpm --filter @gmt/providers test` | passes unchanged (it reads the contract Task 8.0 touches) |
| `pnpm -r typecheck` | exit 0 |
| `pnpm lint` | exit 0, no diagnostics |
| `pnpm boundaries` | exit 0: `@gmt/api` reads `process.env` only under `src/bootstrap/`; no msw import; no suppression comment; once WP9 Task 9.12 is on main, no place name in an `apps/api/src` string outside `tools/workedExample.ts` (WP8's new code adds only `GET`, already in `NOT_AIRPORT_WORDS`) |
| `pnpm casts` | exit 0, `0 casts` (decision 48; the assembly scanned 474 files) |
| Every mutation of Tasks 8.2–8.15 | each fails the named tests and is reverted (the assembly ran all 38) |
| Manual: `NODE_ENV=development DATABASE_PATH=./data/dev.db BIND_ADDRESS=127.0.0.1 pnpm --filter @gmt/api dev`, then `curl -s -H 'Host: localhost:3000' localhost:3000/api/health` | the log shows `"msg":"listening"`; curl prints `{"ok":true,"degraded":false}`; Ctrl-C logs `shutdown complete` and exits 0 |

## 11. Open questions

None requires the operator's judgment. Review rounds 1 and 2 are ruled by plan decisions 53, 54, 57 and 58, and decision 55 adds core's `isStale`; §13 holds the two items the plan has not recorded.

## 12. Changes outside `apps/api`

- WP9's Task 9.0 and WP10's Task 10.1, exactly as their briefs write them (Tasks 8.0a, 8.0b; decision 57), except Task 10.1's edit of WP9's not-yet-created `apps/web/test/fixtures.ts`.
- `packages/core` (Task 8.0): `labels/age.ts` (`effectiveAge` never younger than the fetch age, `worstCaseAgeHours` returns a number, `compareAges` ranks by what is known, `isStale`, the "vendor's cache age unknown" label), `ports/budget.ts` (`budgetScopeLabel`), `index.ts` (`CONSTRAINT_NAMES`), `api-contract/common.ts` (`vendorLinkSchema`, `storedBookingSchema`, `bookingSchema` on the refined links), `api-contract/results.ts` (the row's `superseded`, the refined search link, no `byDestination`), `api-contract/definitions.ts` (draft-tolerant stored shapes, `definitionCreateOptionalSchema`), `api-contract/executions.ts` (the verify confirmation), `api-contract/alerts.ts` (`alertRulesQuerySchema`), `api-contract/index.ts` (the routes that use them); tests `labels/age.test.ts`, `api-contract/contract.test.ts`, `helpers/rows.ts`, `wp2-barrel.test.ts` and the new `api-contract/wp08.test.ts`.
- `packages/db` (Task 8.0): `repositories/cells.ts` (`retriedOnResume`), `repositories/calendarPrices.ts` (`heldBy`), `internal/read.ts` (bookings read with `storedBookingSchema`), `repositories/itineraries.ts` and `types.ts` (`OfferHistoryPoint` with supplied fields and execution), `index.ts`; tests `barrel.test.ts`, `itineraries.test.ts` (exact `suppliedFields`), `reuse.test.ts` (`heldBy` holds the copy) and the new `cells.retriedOnResume.test.ts`.
- `packages/engine` (Task 8.0): `context.ts` (`capKindOf`), `start.ts` (`ConfirmationContext`, the narrowed `confirmationNeeded` parameter), `index.ts` (the exports), `test/smoke.test.ts`.
- `pnpm-lock.yaml` (Task 8.1): `@hono/zod-validator` removed.

## 13. For the plan (not yet recorded there)

1. **Spec and web wording at the next revision.** §10's `GET /definitions/:id/calendar?basis=` (the contract takes `destination`, not `basis`; both bases come back per day, and the day has no `byDestination`, decision 58); §10's coverage row gains "404 before the first run"; §7's app bootstrap order gains decision 53's read-only lock check before the backup and decision 58's lock-then-seed; §10's calendar-gap row says "below the reference verified price (latest seen, then fresh, then cheapest)" instead of "the cheapest class-verified observation", and WP10's banner the same words (decision 58).
2. **WP10 Task 10.1's fixture edit.** Its last step adds `notSeenInLatest: null` to WP9's `apps/web/test/fixtures.ts`, which does not exist when WP8 applies the task (decision 57). WP9's implementer, who creates that file and skips Task 10.1, has to write the field in; WP9's or WP10's brief should say so.
3. **Alert events after WP11.** WP8 runs before WP11, so it cannot import WP11's `alertEventPayloadSchema` or rely on migration 0002's statuses: `GET /api/alerts/events` passes events through the repository and `alertEventSchema` generically (status and payload as stored), and works before and after 0002. When WP11 lands it should make `alertEventSchema.payload` its `alertEventPayloadSchema`, so this route parses every payload with it (decision 56), and its own tests then pin the new statuses on this route.
