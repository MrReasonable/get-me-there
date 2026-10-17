---
wp: 8
title: "api: app bootstrap, routes, auth, hardening, static, health, record tool route"
owner: sonnet
depends_on: [4b, 7, 9, 10]
spec_sections: ["§3 Effective age", "§4 Auth and request hardening", "§5.5", "§6.5", "§6.8 (storage)", "§6.9", "§7 app_lock, Migrations", "§8.1", "§8.2", "§9 item 5", "§10", "§12", "§13", "§14"]
reviewers: [code-architect, test-strategy-reviewer, security-reviewer, provenance-auditor, product-owner, devops-reviewer]
status: draft
---

# WP8 — `@gmt/api`: app bootstrap, routes, auth, hardening, static, health, record tool route

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task: failing test, run, minimal code, run, commit. Steps use `- [ ]` checkboxes. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, revision 24) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`: "Global Constraints", every "Cross-package contracts" block and "Decisions taken at reconciliation" 1–52) before Task 8.0. Refreshed on 2026-10-17 against main at `697ad9d` (spec revision 24, plan decisions 1–52) and the reviewed WP7, WP9 and WP10 briefs; every code block below was assembled on a scratch worktree of main and run green (§13 says what stood in for the parts not on main yet).

## 1. Goal

Turn the engine, repositories and ports into the one HTTP surface of spec §10 under `/api`, behind the auth and hardening of spec §4, started by an app bootstrap that honours the §5.5 synthetic gates, the §7 `app_lock` waits and the pre-migration backup, and that shuts down gracefully (§7, §13).

## 2. Scope

**In**

- `apps/api/src/app.ts`: `createApp(ports, engine, options?)`, a Hono app that mounts every `ROUTES` entry of `@gmt/core` `apiContract` (paths already carry `/api`) with `@hono/zod-validator` on bodies and queries, the error envelope `{ error: { code, message, details? } }` (a 422 and a validation 400 carry `details.fields`), security headers, Host/Origin/Content-Type/X-Requested-With checks, basic auth with the failed-auth rate limit, static serving of the built web app with an SPA fallback outside `/api`. Handlers narrow every input with its contract schema (`parseWith`); no `as` anywhere (`pnpm casts`, decision 48).
- Every route of spec §10 except `POST /api/tools/smoke`: health (union schema), airports autocomplete, providers, definitions CRUD with the plan-preset draft and the confirmation rule in pence and calls (decisions 37, 42, 43), both estimate routes, the coverage check, executions, single-cell verify, results (§6.5/§6.9), calendar, duration analysis, coverage, calendar gap, cell detail (with `verify` from `Engine.childCapPreview`, decisions 42, 48), history (with `stale`, `truncated` and `priceConfirmed` on points, decisions 36, 38, 42), alert rule storage and events, scheduler jobs, budget, and `POST /api/tools/record` over WP4b's `runRecord`.
- Staleness by fetch age (decision 44, spec rev 23): a price is stale when its fetch age plus its known `maxAgeHours` exceeds the threshold; an unknown vendor age is aged by the fetch age alone and never marked stale on that account. `truncated` on every calendar price from its discovery outcome's `last_error` through core's `isTruncated` (decisions 36, 47). Verified-basis minima skip prices the final step did not confirm (decisions 45, 48).
- `apps/api/src/bootstrap/app.ts`: `bootApp(deps)` and `main(env)` in the plan's order: refuse `NODE_ENV=test` → data directory writable → backup preflight through WP4b's `bootstrap/preflight.ts` (decision 32) → `buildPorts` (migrations) → seed + airport sanity check → `AppLock('app')` with waits and the 30 s heartbeat → `createEngine` → `engine.boot()` → serve; SIGTERM: stop accepting → `engine.shutdown()` → `wal_checkpoint(TRUNCATE)` → lock release → close → exit 0. Exit codes from WP4b's single `EXIT` table (`apps/api/src/tools/types.ts`).
- Two contract additions no other brief makes (Task 8.0): `expandTop` on `executionSummarySchema` (decision 42) and draft-tolerant stored/response definition shapes; plus `suppliedFields` on `ItinerariesRepo.offerHistory` points, from which `priceConfirmed` is derived (decision 42).
- Every §9 item 5 test as real code, plus the review-focus line 4 test.

**Out**

- `buildPorts`, `loadConfigFromEnv`, `collectSecrets`, `createLogger` (with the §14 redact paths and secret scrubbing), `safeMessage`, the tool bootstrap with `recordingTarget`, the preflight helpers, `runRecord`/`recordFixtures` and the `EXIT` table: WP4b (on main, consumed here).
- `POST /api/tools/smoke`, `runSmoke` and the "tool bootstrap starts no execution" test: WP13. WP8 leaves the smoke route unmounted (key listed in `OWNED_ELSEWHERE`); WP13 adds its handler and removes the key.
- The alert runner (`runAlerts`, passed to `createEngine` as `opts.alerts`), `EmailNotifier`, templates: WP11, which modifies `bootApp` to pass `{ alerts: runAlerts }`. WP8 stores and reads alert rules and events only.
- `backupDatabase` (WP3) and its CLI wrapper `scripts/backup.mjs` (WP12). Dockerfile, compose, `HEALTHCHECK` (fetches `GET /api/health`), docs: WP12.
- The SPA and its client: WP9/WP10. The contract fields WP9 Task 9.0 (`truncated`) and WP10 Task 10.1 (duration `searched` per series and minimum cells, `historyPointResponseSchema`, `priceConfirmed`, `verify`, the calendar day's `verification.unconfirmedCells`, decision 51) add, and the fields WP7 Tasks 7.13 and 7.18 add (`confirmedCalls`, `confirmCalls`, `needsConfirmation.totalCalls`, nullable `cachedRows`); WP8 fills them.
- Engine semantics (pre-start checks, the confirmation comparison at start, resume compare-and-set, child sizing, scheduler, budget fit): WP7. WP8 maps `StartResult` to HTTP and mirrors the confirmation trigger only to fill `needsConfirmation`.
- The place-name check in `scripts/check-boundaries.mjs` and its `NOT_AIRPORT_WORDS` list: WP9 Task 9.12 (decisions 36, 46). WP8's strings need no new entry: the only three-letter capitals its new code adds are `GET` (handler keys), already listed.

## 3. Spec sections

| Section | What it requires of WP8 |
|---|---|
| §3 Effective age (rev 23) | Every price carries its effective age as a number: the observed age, or the fetch age plus a known `maxAgeHours`, or (unknown vendor age) the fetch age alone, which the web labels "vendor's cache age unknown" from the provenance; an unknown age is never stale on that account (decision 44). |
| §4 "Auth and request hardening" | Basic auth (both vars or neither, password ≥ 12, constant-time compare), failed-auth limit 5/min per source IP (from `X-Forwarded-For` only with `TRUST_PROXY=true`) with a global 20/min; everything authenticated except the minimal `GET /api/health`, which is also Host-exempt; the `ALLOWED_HOSTS` rejection names the header value and the variable; mutating routes need `Content-Type: application/json` and `X-Requested-With: get-me-there`; `Origin`, when present, must match; CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`. |
| §5.5 | Bootstraps refuse `NODE_ENV=test`; injected-config boot matrix; one test spawning the real bootstrap with a real production environment (`/providers` omits `fixture`, the fixture constructor throws, a synthetic write throws). |
| §6.5 | `/results` dedups per itinerary hash, ranks by class then price, returns at most 1000 rows with `truncated` and `total`, no sort/filter parameters. |
| §6.8 | Alert rules stored with the `requireAllVerified` refinement enforced on create and on a merged partial update; events listed by rule and definition; soft delete keeps events. |
| §6.9 | Basis `verified` or `calendar`; calendar rows are class `unchecked` with a "not applied" list; default basis calendar when the snapshot has no verification provider or no observation exists, with a reason; calendar gap empty with no verification provider; a search link on every non-synthetic row. |
| §7 `app_lock`, Migrations | App holder: heartbeat every 30 s; a fresh `tool` lock → wait up to 60 s then refuse; a fresh `app` lock → wait up to 90 s logging its age, refuse if still heartbeated, take over a stale lock at once; SIGTERM releases the lock after the checkpoint. Backup before migrations when migrations are pending; a failed backup refuses boot. Seed and the airport sanity check fail boot. |
| §8.1 | Staleness per price (as §3 above); `notSeenInLatest`; overruns against the pre-factor plan (discovery on tiles, decision 43); `/resume` manual, 409 on a lost compare-and-set or an active sibling; single-cell verify validates membership in the current resolved space and the airports; children in results, calendar, calendar gap and duration analysis. |
| §8.2 | Definition create/PUT/disable/enable/delete (re)register its cron job in the same request; cron validated by the engine's `parseCron` (sub-hourly rejected); the default definition uses the plan-aware preset; a schedule whose provider-month scope does not fit is refused (decision 25). |
| §9 item 5 | Every test listed there (Task 8.15 sweeps). |
| §10 | The route table under `/api`, incl. `GET /airports` and `POST /definitions/estimate`; the error envelope with `details.fields` on 422; `provenance` and `stale` on every price-bearing shape. |
| §12 | `process.env` read once, in `src/bootstrap/start.ts`, and parsed through the `core` schema by WP4b's `loadConfigFromEnv`. |
| §13, §14 | `/api/health` for the `HEALTHCHECK`; graceful shutdown; pino with redaction and secret scrubbing (WP4b's `createLogger`); error messages through WP4b's `safeMessage`. |

The brief follows the spec at revision 24 and plan decisions 1–52 (50 and 52 change nothing here: resume, stride and web rules). Where a brief and the plan name a field differently (WP10's `verification.unconfirmed` against decision 51's `unconfirmedCells`), the brief follows the plan and §13 records it.

## 4. Interfaces consumed

As the code on main declares them (WP0–WP6, WP4b), plus the additions the reviewed WP7, WP9 and WP10 briefs make before WP8 runs (marked). Only the members WP8 calls are listed; the plan's "Cross-package contracts" are authoritative for the rest.

```ts
// @gmt/core — types and helpers (WP0–WP2)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export function cellKeyString(c: CellKey): string;
export interface SearchDefinition { id; name; origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights; maxNights; cabin; constraints; verification: VerificationPolicy; budget: ExecutionBudget; providers: ProvidersConfig; destinationNotes: Partial<Record<Iata, string>>; onwardCostPence: Partial<Record<Iata, number>>; scheduleCron: string | null; scheduleTz: string; confirmedCostPence: number | null; confirmedCalls: number | null /* WP7 Task 7.13 */; enabled: boolean; createdAt; updatedAt; deletedAt: IsoDateTime | null }
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'confirmedCostPence' | 'confirmedCalls' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean; droppedAlwaysInclude: CellKey[] };
export interface Execution { id; definitionId; isChild; cell: CellKey | null; snapshot: DefinitionSnapshot; status: ExecutionStatus; stage: Stage | null; estimate: Estimate | null; resumeAfter; startedAt; finishedAt; errorText; createdAt; trigger: 'manual' | 'schedule' | 'tool' }
export interface Buckets { priced; empty; no_data; error; skipped; not_run; reused }
export interface Estimate { cells; perProvider: Array<{ providerId; stage: Stage; calls; planCalls; costMicroGbp; costPence; seconds; blocked: string | null }>; totalCalls; totalPlanCalls; totalCostMicroGbp; totalCostPence; seconds; assumptions: string[]; windowClamped; retryFactor }
export type BudgetFit = z.infer<typeof budgetFitSchema>;   // { fits; runsPerMonth; perScope: Array<{ scope; estimated; cap: number | null; fits }> }
export type BudgetScope = { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string } | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId } | { kind: 'global-month' };
export interface Usage { calls; costMicroGbp; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
export interface ProviderLimits { monthlyCallCap; window: 'month' | 'lifetime'; …; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const PENCE_TO_MICRO = 10_000;
export function microGbpToPence(micro: number): number;               // rounds up (decisions 47, 49; WP7 Task 7.1)
export const TRUNCATED_NOTE = 'cheapest of the rows read';            // WP7 Task 7.5
export function isTruncated(lastError: string | null): boolean;       // WP7 Task 7.5 (decision 47)
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;                   // decision 21
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;   // EffectiveAge always carries fetchedHours
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown';
export function resolveWindow(w: WindowSpec, todayLondon: IsoDate): { departureFrom; departureTo; clamped };
export function generateCells(space: ResolvedSpace): Cell[]; export function countCells(space: ResolvedSpace): number;
export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number;
export function validateSearchSpace(def: Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'>, todayLondon: IsoDate, lookup: AirportLookup, maxCells: number): ValidationResult;
export interface AirportLookup { exists(iata: Iata): boolean; metroOf(iata: Iata): string | null; airportsOfMetro(code: string): Iata[] }
export function selectedNotReached(selected: CellKey[], outcomes: CellOutcome[]): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }>;
export function evaluateConstraints(it, obs, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts;
export function verdictClass(v: Verdicts): VerdictClass;   // throws without a cabin verdict: never called on calendar rows
export function unverifiedNames(v: Verdicts): ConstraintName[];
export function dedupByItinerary(rows: ResultRow[], now: IsoDateTime): ResultRow[]; export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[];
export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url; host; label } | null;   // null for 'fixture'
export function formatPence(pence: number): string;
export function stripUrlsInText(text: string): string; export function syntheticAllowed(c: SyntheticGateInput): boolean;
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word; index }>; export const BANNED_WORD_ALLOWLIST: readonly string[];
export const iataSchema: z.ZodType<Iata, string>; export const isoDateSchema: z.ZodType<IsoDate, string>;
export function isoDateTimeOfEpochMs(ms: number): IsoDateTime; export function londonDateOf(instant: IsoDateTime): IsoDate;
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export const FIXTURE_OPT_IN_PHRASE = 'i-understand-this-is-fake';
export interface Config { nodeEnv; databasePath; port; bindAddress; allowedHosts: string[]; auth: { user: string; pass: Secret } | null; trustProxy; logLevel; pointOfSale; staleAfterHours: number; calendarStaleAfterHours: number | null; maxCellsPerDefinition; schedulerTimezone; spend: { monthlyCapMicroGbp; softConfirmMicroGbp; executionMaxCalls; executionMaxFreeCalls; executionMaxCostMicroGbp; childMaxCalls; … }; providers: { travelpayouts: { token; limits } | null; searchapi: { key; plan: PlanId; trialUsed; limits } | null; fixture: { costMicroGbp } | null }; … }
export interface FlightProvider { id; displayName; discovery?: { info: CapabilityInfo; … }; verification?: { info: CapabilityInfo; … }; … }
export * as apiContract from './api-contract/index.js';
// apiContract (WP0; with WP7 Tasks 7.13/7.18, WP9 Task 9.0, WP10 Task 10.1 and this brief's Task 8.0):
//   ROUTES: readonly RouteDef[] (RouteDef { method; path /* /api/… */; request?; query?; response; auth: 'public' | 'required' })
//   errorEnvelopeSchema, cellKeySchema, priceCellSchema { pricePence, provenance, stale, ageHours, truncated /* 9.0 */ },
//   executionSummarySchema { id, status, isChild, startedAt, finishedAt, ageHours, expandTop /* 8.0 */ }, usageSchema, coverageSummarySchema,
//   definitionCreateRequestSchema / definitionUpdateRequestSchema (+ confirmedCostPence?, confirmedCalls? /* 7.13 */), definitionShapeSchema,
//   definitionResponseSchema (+ confirmedCalls; needsConfirmation { estimateMicroGbp, totalCalls, confirmedCostPence, confirmedCalls } /* 7.13 */),
//   estimateResponseSchema, coverageCheckRequestSchema, coverageCheckResponseSchema (cachedRows: number | null /* 7.18 */),
//   executionResponseSchema, startExecutionRequestSchema { confirmCostPence?, confirmCalls? /* 7.13 */ }, startExecutionResponseSchema, verifyCellRequestSchema,
//   resultRowSchema (+ truncated /* 9.0 */), resultsQuerySchema, resultsResponseSchema, calendarResponseSchema (day verification + unconfirmedCells /* 10.1, decision 51 */),
//   durationAnalysisResponseSchema (minima carry `cell`; searched { verification; discovery: Array<{ providerId; searched }> } /* 10.1 */),
//   coverageResponseSchema, calendarGapResponseSchema, cellDetailResponseSchema (+ verify: { maxCalls; headroomCalls } | null /* 10.1, decision 42 */),
//   historyPointSchema, historyPointResponseSchema { …HistoryPoint, stale, truncated } /* 10.1 */, itineraryHistoryResponseSchema (points + priceConfirmed /* 10.1 */),
//   routeHistoryQuerySchema, routeHistoryResponseSchema, airportsQuerySchema, airportsResponseSchema, providersResponseSchema,
//   budgetResponseSchema, schedulerJobsResponseSchema, healthPublicSchema, healthDetailSchema, alertRuleSchema, alertRuleInputSchema,
//   alertRuleUpdateRequestSchema, alertEventSchema, alertEventsQuerySchema, toolRecordRequestSchema, toolRunResponseSchema

// @gmt/db (WP0, WP3; WP7 Task 7.13)
export interface Db { raw: BetterSqlite3.Database; transaction; immediateTransaction; close(): void }
export const MIGRATIONS_DIR: string; export const AIRPORTS_DATA_DIR: string;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export class AppLock { constructor(db: Db, holder: 'app' | 'tool', clock: Clock, log: Logger, opts?); static inspect(db: Db): { holder; heartbeatAt; acquiredAt } | null; acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void }
export function loadAirportsDataset(dir: string): AirportsDataset; export function seedAirports(db: Db, dataset: AirportsDataset): { inserted; datasetVersion };
export function sanityCheckAirports(db: Db, referenced: Iata[]): { ok: true } | { ok: false; reason: string };
export class AirportsRepo { exists(iata); search(q, limit): Airport[]; metroOf(iata); airportsOfMetro(code): Iata[]; count(): number; datasetVersion(): string | null }
export class DefinitionsRepo { create(input: DefinitionInput & { confirmedCostPence?: number; confirmedCalls?: number }): SearchDefinition; update(id, patch: Partial<DefinitionInput>): SearchDefinition; get(id): SearchDefinition | null; list(opts?): SearchDefinition[]; softDelete(id): void; setConfirmed(id, confirmed: { pence: number; calls: number } | null): void /* WP7 Task 7.13, replaces setConfirmedCost */ }
export class ExecutionsRepo { get(id): Execution | null; listForDefinition(definitionId, opts: { limit; includeChildren }): Execution[] /* newest first */ }
export class CellsRepo { outcomes(executionId, filter?: { stage?; providerId?; cells? }): CellOutcome[]; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; bucketsPerDay(executionId): Map<IsoDate, Array<{ stage; providerId; buckets; total }>>; selected(executionId): Array<{ cell; reason }> }
export class CalendarPricesRepo { latestPerCell(definitionId, cabin, space: ResolvedSpace | null): CalendarPriceRow[]; history(origin, destination, cabin, opts?): Array<{ providerId; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> }
export class ItinerariesRepo { observationsForDefinition(definitionId, opts: { executionIds; space; cabin; includeChildren }): ObservationRow[]; latestVerificationOutcomeForCell(definitionId, cell, cabin): CellOutcome | null; offerHistory(hash): Array<{ providerId; seller; cabin; points: OfferHistoryPoint[] /* Task 8.0 */ }> }
export class LedgerRepo { countsFor(executionId): { calls; costMicroGbp; tiles; cacheHits; perProvider: Array<{ providerId; stage: Stage | null; calls; costMicroGbp; tiles; cacheHits }> } }
export class AlertsRepo { rules(definitionId?): AlertRule[]; get(id); create(input); update(id, patch); softDelete(id); events(filter: { ruleId?; definitionId?; limit }): AlertEvent[] }
export class NotificationsRepo { wasSent(kind: OperatorMessageKind, executionId: string | null, definitionId: string): boolean }
export class RoutePriceHistoryRepo { series(origin, destination, providerId, cabin: Cabin | 'unknown'): RouteSeriesPoint[] }

// @gmt/providers (WP4): fixtureProvider(opts): FlightProvider (throws unless syntheticAllowed); buildPorts wires the fixture host through http-kit's gated inProcessHosts.

// @gmt/engine (WP7 brief §5; the brief WP8 is assembled against)
export interface StartOptions { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number }
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled'; message: string; details: unknown };
export interface Engine { boot(): Promise<void>; shutdown(): Promise<void>; start(definitionId, opts: StartOptions): Promise<StartResult>; resume(executionId, opts: { manual: boolean }): Promise<StartResult>; cancel(executionId): Promise<boolean>; verifyCell(definitionId, cell: CellKey): Promise<StartResult>; childCapPreview(definitionId, cell: CellKey): { maxCalls: number; headroomCalls: number }; estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate; budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit; coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>; scheduler: { register(def): void; unregister(definitionId): void; jobs(): SchedulerJob[]; tick(definitionId): Promise<void>; blockedSince(): IsoDateTime | null }; status(): { running: string[]; degraded: boolean; nextRun; lastExecutionAt } }
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;   // boot() makes no network call; EngineOptions carries no cost
export function parseCron(expr: string, tz: string): { ok: true; next(from: Date): Date | null } | { ok: false; reason: string };
export class LogNotifier implements Notifier { constructor(log: Logger) }
// What WP8 relies on (WP7 §5): estimate() is the worst case without reuse with `blocked` filled and totals over what would run; a
// start compares the stored or sent confirmation in pence AND calls; childCapPreview sizes exactly as verifyCell will.

// apps/api on main (WP4b)
export interface Ports { config; db: Db; repos: Repos; budget: BudgetGuard; cache; http; providers: FlightProvider[]; clock; log: Logger; secrets: Secret[]; recorder; fixtureRoot: string | null }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?; migrationsDir: string; fixtureRoot?: string }): Ports;   // fixtureRoot defaults to defaultFixtureRoot() under the gate
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;   // throws InvalidConfigError naming every bad field
export class InvalidConfigError extends Error {}; export function collectSecrets(config: Config): Secret[];
export function createLogger(config: Pick<Config, 'logLevel'>, opts?: { destination?: NodeJS.WritableStream; fd?: 1 | 2; secrets?: readonly Secret[] }): Logger;
export function safeMessage(e: unknown, secrets: readonly Secret[]): string;   // src/safeMessage.ts
export const EXIT = { ok: 0, failed: 1, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;   // src/tools/types.ts
// src/bootstrap/preflight.ts (decision 32): dataDirRefusal(databasePath): string | null; pendingOnExistingDb(databasePath, migrationsDir): string[];
//   backupsDirFor(databasePath): string; BACKUPS_KEPT = 5;
//   backupBeforeMigrations(databasePath, migrationsDir, clock, secrets): { ok: true; line: string | null } | { ok: false; code: 73 | 74; message: string }
// src/bootstrap/tool.ts: interface RecordingTarget { root; recordedBy }; recordingTarget(cli: RecordCli, given?: RecordingTarget, roots?): RecordingTarget | { refusal: string }
// src/tools/record.ts: recordPrecheck(c: Config): string | null; runRecord(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number /* exit code */>
// src/tools/recordPlan.ts: interface RecordCli { args: RecordArgs; dryRun: boolean; confirmRerun: boolean; out: string | null }
// test/helpers (WP4b): env.ts cleanEnv, SENTINEL_AUTH/SA/TP, silentLog; tmp.ts tempDir, onCleanup; test/support/setup.ts installs WP4's network guards
```

The fixture provider is reached through http-kit's gated `inProcessHosts` seam (`buildPorts` wires it under `syntheticAllowed`), so route tests need no `msw`.

## 5. Interfaces produced

```ts
// apps/api/src/routes/types.ts
export const API_PREFIX = '/api';
export type AppEnv = { Variables: { authenticated: boolean; optionalBody?: { present: boolean; value: unknown } } };
export interface RouteInput { body: unknown; query: unknown; params: Record<string, string> }
export interface RouteContext { ports: Ports; engine: Engine; tools: ToolRunners; toolInFlight: { name: string | null } }
export type RouteHandler = (c: Context<AppEnv>, input: RouteInput, ctx: RouteContext) => Response | Promise<Response>;
export type HandlerTable = Readonly<Record<string, RouteHandler>>;   // keyed `${method} ${path}` of a ROUTES entry
export type ToolRunResponse = z.infer<typeof apiContract.toolRunResponseSchema>;
export interface ToolRunners { record?: (args: ToolRecordRequest, signal: AbortSignal) => Promise<ToolRunResponse> }
/** ROUTES entries whose handler another package owns; left unmounted here. WP13 removes 'POST /api/tools/smoke' when it adds its handler. */
export const OWNED_ELSEWHERE: ReadonlySet<string>;

// apps/api/src/app.ts
export interface AppOptions { webRoot?: string | null; tools?: ToolRunners; clientIp?: (c: Context<AppEnv>) => string | null; routes?: readonly apiContract.RouteDef[] }
export function createApp(ports: Ports, engine: Engine, options?: AppOptions): Hono<AppEnv>;   // strict mounting (Task 8.15)

// apps/api/src/errors.ts, routes/shared.ts
export class ApiError extends Error { constructor(status: ContentfulStatusCode, code: string, message: string, details?: Details) }
export function envelope(code: string, message: string, details?: Details): { error: { code; message; details? } };
export function parseWith<S extends z.ZodType>(schema: S, value: unknown, target?: string): z.output<S>;

// apps/api/src/bootstrap/app.ts, lock.ts, paths.ts
export class BootError extends Error { readonly exitCode: number }
export interface BootDeps { config: Config; log: Logger; clock?: Clock; listen: boolean; assets: AssetPaths; tools?: (ports: Ports) => ToolRunners; sleep?: (ms: number) => Promise<void>; timers?: Timers }
export interface RunningApp { app: Hono<AppEnv>; ports: Ports; engine: Engine; port: number | null; close(): Promise<void> }
export function bootApp(deps: BootDeps): Promise<RunningApp>;
export function main(env: NodeJS.ProcessEnv): Promise<void>;
export function acquireAppLockWithWaits(d: LockWaitDeps): Promise<void>; export const TOOL_LOCK_WAIT_MS = 60_000; export const APP_LOCK_WAIT_MS = 90_000;
export class LockRefusedError extends Error { readonly exitCode: 75 }
export interface AssetPaths { migrationsDir: string; airportsDataDir: string; webRoot: string | null }; export function assetPaths(): AssetPaths;

// apps/api/src/read/*: the read model the routes share and WP11 may reuse
export function staleness(p: Provenance, thresholdHours: number, now: IsoDateTime): { ageHours: number; stale: boolean };   // decision 44, spec rev 23
export function loadRows(def: SearchDefinition, ports: Ports, executionId?: string): Loaded;
export function executionSummary(e: Execution, now: IsoDateTime): ExecutionSummary;
export function defaultDefinitionInput(config: Config, providers: readonly FlightProvider[]): DefinitionInput;   // src/defaults.ts; DEFAULT_CRON = '0 5 * * 1'

// apps/api/src/tools/inProcess.ts
export function inProcessTools(ports: Ports, opts?: { recording?: RecordingTarget }): ToolRunners;

// @gmt/core (Task 8.0): executionSummarySchema.expandTop; definitionShapeSchema / definitionResponseSchema accept empty airport lists (drafts)
// @gmt/db (Task 8.0): export interface OfferHistoryPoint extends HistoryPoint { suppliedFields: SuppliedField[] }; offerHistory points are OfferHistoryPoint
```

## 6. Library notes

All versions from the plan's Task 0.1 list (already in `apps/api/package.json`). Every call below was exercised by this revision's assembly run on 2026-10-17; the API shapes were first verified with context7 on 2026-10-14 (sources in the last column).

| Library | Version | Calls used | Source verified |
|---|---|---|---|
| `hono` | 4.13.13 | `new Hono<AppEnv>()`, `app.on(method, path, mw, handler)`, `app.use(path, mw)`, `app.onError`, `app.notFound`, `app.request(url, init)` for tests, `c.json(body, status)`, `c.header()`, `c.req.header()`, `c.req.path`, `c.req.method`, `c.req.param()`, `c.req.query()`, `c.req.text()`, `c.req.json()` (cached after the validator read it), `c.req.raw.signal`; `HTTPException` from `hono/http-exception` (the validator's malformed-JSON throw); `secureHeaders` from `hono/secure-headers` with `contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] }`, `referrerPolicy: 'no-referrer'`, `xContentTypeOptions: 'nosniff'`, `xFrameOptions: 'DENY'`; `every` from `hono/combine` | context7 `/websites/hono_dev` (secure-headers options table; `app.request`; HTTPException) |
| `@hono/node-server` | 2.1.5 | `serve({ fetch, port, hostname }, (info) => …)` returns the `node:http` server; `serveStatic({ root })` and `serveStatic({ path })` from `@hono/node-server/serve-static` (rejects `..`, `//` and backslashes; calls `next()` when not found); `getConnInfo(c)` from `@hono/node-server/conninfo` (`info.remote.address`; throws under `app.request()`, which has no socket) | context7 `/honojs/node-server` |
| `@hono/zod-validator` | 0.9.1 | `zValidator('json' \| 'query', schema, hook)`; the hook receives `{ success: false, error }` with zod 4's `$ZodError` (typed here by its `issues` only) and returns the 400 envelope | context7 `/honojs/middleware` (README hook; peer `zod ^3.25.0 \|\| ^4.0.0`) |
| `zod` | 4.6.7 | `safeParse`, `z.output`, `.pick`, `.extend`, `z.looseObject` (tests parse bodies rather than cast them) | the api-contract's own usage |
| `pino` | 10.4.0 (through WP4b's `createLogger`) | not configured here; tests pass a `Writable` as `opts.destination` to capture lines | context7 `/pinojs/pino` |
| `tsx` | 4.23.15 (dev) | `node --conditions=@gmt/source --import tsx src/bootstrap/start.ts` for the spawn test and `pnpm dev` (`--watch`) | tsx docs: `--import tsx` is the Node ≥ 20.6 loader form |
| `typescript` | 5.9.3 | `ts.createSourceFile` in the assembly's approximation of WP9's place-name check (not shipped) | — |
| `vitest` | 5.0.4 | `describe/it/it.each/it.skipIf`, `vi.spyOn`, `vi.fn`, `vi.waitFor`, `afterEach`, `afterAll`; per-task runs use `pnpm --filter @gmt/api exec vitest run <files>` (decision 8) | — |
| Node | 22 | `node:crypto` `createHash`, `timingSafeEqual`; `node:child_process` `spawn`, `spawnSync`; `node:net` `createServer().listen(0)` (no host: WP4's guards refuse even a lookup of `127.0.0.1`); `node:stream` `Writable`; `fs.readdirSync(dir, { recursive: true, withFileTypes: true })` with `parentPath` | Node docs |

## 7. Files

**Create** (under `apps/api/` unless noted)

```
src/text.ts                    API_TEXT: every fixed user-facing string the api emits
src/errors.ts                  ApiError, envelope, fieldsDetail, issuesToFields, scrubDetails, onError, notFound
src/defaults.ts                DEFAULT_CRON, defaultDefinitionInput (spec §8.2 preset, §11 form defaults)
src/static.ts                  mountStatic(app, webRoot): serveStatic + SPA fallback outside /api
src/app.ts                     createApp, mounting from ROUTES
src/middleware/headers.ts      securityHeaders()
src/middleware/hardening.ts    hostAllowlist, originCheck, mutatingRequestCheck
src/middleware/auth.ts         credentialsMatch, FailedAuthLimiter, clientIpFrom, basicAuthGate
src/middleware/validate.ts     validatorsFor(route), readInput, acceptsUndefined
src/routes/types.ts            API_PREFIX, AppEnv, RouteInput, RouteContext, RouteHandler, HandlerTable, ToolRunners, OWNED_ELSEWHERE
src/routes/shared.ts           parseWith, param, getLiveDefinition
src/routes/index.ts            HANDLERS (merge of every table below)
src/routes/system.ts           /api/health, /api/airports, /api/providers, /api/budget, /api/scheduler/jobs
src/routes/definitions.ts      /api/definitions CRUD, both estimate routes, /api/definitions/coverage-check
src/routes/executions.ts       /api/definitions/:id/executions, /api/executions/:id[/cancel|/resume], /api/cells/verify
src/routes/results.ts          /results, /calendar, /duration-analysis, /coverage, /calendar-gap, /cells/…
src/routes/history.ts          /api/itineraries/:hash/history, /api/routes/:origin/:destination/history
src/routes/alerts.ts           /api/alerts CRUD, /api/alerts/events
src/routes/tools.ts            /api/tools/record
src/read/space.ts              isDraft, currentSpace, cellInSpace, airportLookup
src/read/usage.ts              providerLimits, scopeLabel, providerScopes, windowScope, budgetScopes, usageOf
src/read/definitions.ts        definitionResponse, deletedResponse, needsConfirmation, confirmationRequired, covers, mergeDefinition, inputOf
src/read/executions.ts         executionResponse, executionSummary, overrunOf, planCallsOf, hoursSince
src/read/rows.ts               staleness, thresholds, priceCell, verifiedRow, calendarRow, latestPerOffer, notSeenResolver, cheapest
src/read/coverage.ts           coverageSummaryFor, zeroBuckets, SEARCHED
src/read/results.ts            loadRows, truncationOf, confirmedIn, chooseBasis, assembleResults
src/read/calendar.ts           assembleCalendar, assembleCalendarGap
src/read/duration.ts           assembleDuration
src/read/coverageView.ts       assembleCoverage, retryable
src/read/cell.ts               assembleCellDetail
src/read/history.ts            itineraryHistory, routeHistory
src/bootstrap/paths.ts         assetPaths()
src/bootstrap/lock.ts          acquireAppLockWithWaits, LockRefusedError
src/bootstrap/app.ts           bootApp, main, BootError, Timers
src/bootstrap/start.ts         the process entry (the app's one process.env read)
src/tools/inProcess.ts         inProcessTools(ports): the record runner over runRecord
test/helpers/harness.ts        in-memory ports + engine + app; request helper; captureLines; harnessEnv
test/helpers/contract.ts       expectContract, expectEnvelopeOrContract, errorOf
test/helpers/examples.ts       exampleDefinitionInput (the worked example, sized for tests), SMALL_WINDOW
test/helpers/seed.ts           seeder over WP3's atomic writes (generated ids, named in tests)
test/defaults.test.ts, test/bootstrap/app.{spawn,matrix,lock,backup,shutdown}.test.ts, test/routes/*.test.ts
packages/core/test/api-contract/wp08.test.ts
```

**Modify**

- `apps/api/package.json`: scripts `dev` (the entry is `start.ts`) and `start` (Task 8.1). No dependency change: `hono`, `@hono/node-server`, `@hono/zod-validator` and `zod` are already listed.
- `apps/api/vitest.config.ts`: `testTimeout: 60_000` (Task 8.1).
- `packages/core/src/api-contract/common.ts`, `packages/core/src/api-contract/definitions.ts` (Task 8.0).
- `packages/db/src/types.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories/itineraries.ts`, `packages/db/test/itineraries.test.ts` (Task 8.0).
- `src/wiring.ts`, `src/logger.ts`, `src/safeMessage.ts`, `src/bootstrap/preflight.ts`, `src/bootstrap/tool.ts` and `src/tools/*` other than `inProcess.ts` are WP4b's and are not changed here.

## 8. Tasks

Every "Run" step assumes the workspace dependencies of `@gmt/api` resolve from source (the `@gmt/source` condition and the Vitest aliases). Per-task runs use `pnpm --filter @gmt/api exec vitest run <files>` (no coverage threshold on a partial run, decision 8); the full `pnpm --filter @gmt/api test` enforces thresholds. Tasks 8.2–8.8 pin behaviour Task 8.1 already builds (the bootstrap and the middleware cannot boot without each other); each is seen failing first by the stated temporary mutation, which the step then reverts.

### Task 8.0: The contract fields only WP8 adds

**Files:**
- Create: `packages/core/test/api-contract/wp08.test.ts`
- Modify: `packages/core/src/api-contract/common.ts`, `packages/core/src/api-contract/definitions.ts`, `packages/db/src/types.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories/itineraries.ts`, `packages/db/test/itineraries.test.ts`

**Interfaces:**
- Consumes: `executionSummarySchema`, `definitionShapeSchema`, `definitionResponseSchema` (WP0, after WP7 Task 7.13), `ItinerariesRepo.offerHistory` (WP3).
- Produces: `executionSummarySchema.expandTop` (decision 42: the Results header's "(E outbounds each)" describes the run shown, not today's definition); draft-tolerant `definitionShapeSchema` and `definitionResponseSchema` (spec §10: `POST /definitions` with no body creates the plan default, which names no airport, spec §1 — WP3 reads every stored row through the shape schema, so without this a draft can be inserted but never read back); `OfferHistoryPoint` (`suppliedFields` on each `offerHistory` point, from which Task 8.13 derives `priceConfirmed`).

- [ ] **Step 1: Write the failing test**

`packages/core/test/api-contract/wp08.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import {
  definitionCreateRequestSchema,
  definitionShapeSchema,
  executionSummarySchema,
} from '../../src/api-contract/index.js';

// WP8's contract additions (plan decision 42; spec §10 `POST /definitions` with no body).
describe('WP8 contract additions', () => {
  it('an execution summary carries the run snapshot expandTop', () => {
    const summary = {
      id: 'e1',
      status: 'completed',
      isChild: false,
      startedAt: '2026-10-14T09:00:00.000Z',
      finishedAt: '2026-10-14T10:00:00.000Z',
      ageHours: 1,
    };
    expect(executionSummarySchema.safeParse(summary).success).toBe(false);
    expect(executionSummarySchema.safeParse({ ...summary, expandTop: 2 }).success).toBe(true);
    expect(executionSummarySchema.safeParse({ ...summary, expandTop: 0 }).success).toBe(false);
  });

  it('a stored definition may be a draft without airports; a create body may not', () => {
    const origins = definitionShapeSchema.shape.origins;
    expect(origins.safeParse([]).success).toBe(true);
    expect(definitionShapeSchema.shape.destinations.safeParse([]).success).toBe(true);
    const create = definitionCreateRequestSchema.safeParse({ origins: [] });
    expect(create.error?.issues.some((i) => i.path[0] === 'origins' && i.code === 'too_small')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract/wp08.test.ts`
Expected: FAIL, 2 of 2: the summary without `expandTop` still parses (`expected true to be false`), and the stored shape refuses an empty `origins` (`expected false to be true`).

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/common.ts` — find:

```ts
  finishedAt: isoDateTimeSchema.nullable(),
  ageHours: ageHoursSchema,
});
```

`packages/core/src/api-contract/common.ts` — replace with:

```ts
  finishedAt: isoDateTimeSchema.nullable(),
  ageHours: ageHoursSchema,
  /** Plan decision 42: the run's own outbounds expanded per cell (its snapshot's `verification.expandTop`). */
  expandTop: z.number().int().min(1),
});
```

`packages/core/src/api-contract/definitions.ts` — find:

```ts
/** The unrefined field shape: used to read stored rows back, where the save-time policy refinements must not run. */
export const definitionShapeSchema = z
  .object(definitionFields)
```

`packages/core/src/api-contract/definitions.ts` — replace with:

```ts
/**
 * A stored definition may be a draft without airports (spec §10: `POST /definitions` with no body creates the plan
 * default, which names none, spec §1), so the stored and response shapes accept empty airport lists; a create or
 * update body still needs at least one of each.
 */
const storedFields = {
  ...definitionFields,
  origins: z.array(iataSchema),
  destinations: z.array(iataSchema),
};
/** The unrefined field shape: used to read stored rows back, where the save-time policy refinements must not run. */
export const definitionShapeSchema = z
  .object(storedFields)
```

`packages/core/src/api-contract/definitions.ts` — find:

```ts
export const definitionResponseSchema = z.object({
  ...definitionFields,
```

`packages/core/src/api-contract/definitions.ts` — replace with:

```ts
export const definitionResponseSchema = z.object({
  ...storedFields,
```

Apply this patch from the repository root (`git apply`):

```diff
diff --git a/packages/db/src/index.ts b/packages/db/src/index.ts
index 4607f8a..c405f2c 100644
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -44,6 +44,7 @@ export type {
   ExecutionCreateInput,
   ExecutionPatch,
   ObservationRow,
+  OfferHistoryPoint,
   RepoOptions,
   ReuseCriteria,
   ReusedCopy,
diff --git a/packages/db/src/repositories/itineraries.ts b/packages/db/src/repositories/itineraries.ts
index 4d61f2a..9919649 100644
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
@@ -463,7 +465,12 @@ export class ItinerariesRepo {
         cabin: o.provenance.cabin,
         points: [],
       };
-      series.points.push({ at: o.provenance.fetchedAt, pricePence: o.pricePence, provenance: o.provenance });
+      series.points.push({
+        at: o.provenance.fetchedAt,
+        pricePence: o.pricePence,
+        provenance: o.provenance,
+        suppliedFields: o.suppliedFields,
+      });
       out.set(r.offer_id, series);
     }
     return [...out.values()];
diff --git a/packages/db/src/types.ts b/packages/db/src/types.ts
index 256583b..23e92d0 100644
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
@@ -147,3 +148,7 @@ export interface ObservationRow extends Observation {
   cell: Cell;
   seller: string;
 }
+/** One `offerHistory` point: the stored history point plus the observation's supplied fields (plan decision 42). */
+export interface OfferHistoryPoint extends HistoryPoint {
+  suppliedFields: SuppliedField[];
+}
diff --git a/packages/db/test/itineraries.test.ts b/packages/db/test/itineraries.test.ts
index 273ea2c..cd371ae 100644
--- a/packages/db/test/itineraries.test.ts
+++ b/packages/db/test/itineraries.test.ts
@@ -701,7 +701,9 @@ describe('ItinerariesRepo reads', () => {
         providerId: 'searchapi',
         seller: 'British Airways',
         cabin: 'economy',
-        points: [{ at: T0, pricePence: 41_200, provenance: SEARCHAPI_PROVENANCE }],
+        points: [
+          { at: T0, pricePence: 41_200, provenance: SEARCHAPI_PROVENANCE, suppliedFields: expect.any(Array) },
+        ],
       },
     ]);
     expect(repo.latestVerificationOutcomeForCell(definition.id, cell(), 'economy')).toMatchObject({
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract && pnpm --filter @gmt/db exec vitest run test/itineraries.test.ts && pnpm -r typecheck`
Expected: PASS (the new file's 2 tests; the itineraries suite unchanged in count); typecheck clean. Run `pnpm --filter @gmt/core test` too: core stays at 100% on every metric.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: expandTop on the execution summary, draft-tolerant stored definitions, supplied fields on offer history"
```

### Task 8.1: The app bootstrap, the server core, and production boot lacks `fixture` (first failing test)

**Files:**
- Create: `apps/api/src/text.ts`, `src/errors.ts`, `src/defaults.ts`, `src/routes/types.ts`, `src/routes/shared.ts`, `src/read/usage.ts`, `src/routes/system.ts`, `src/routes/index.ts`, `src/middleware/validate.ts`, `src/middleware/auth.ts`, `src/middleware/headers.ts`, `src/middleware/hardening.ts`, `src/static.ts`, `src/app.ts`, `src/bootstrap/paths.ts`, `src/bootstrap/lock.ts`, `src/bootstrap/app.ts`, `src/bootstrap/start.ts`
- Modify: `apps/api/package.json`, `apps/api/vitest.config.ts`
- Test: `apps/api/test/bootstrap/app.spawn.test.ts`, `apps/api/test/defaults.test.ts`

**Interfaces:**
- Consumes: `loadConfigFromEnv`, `InvalidConfigError`, `collectSecrets`, `buildPorts`, `createLogger`, `safeMessage`, `EXIT`, `dataDirRefusal`, `backupBeforeMigrations` (WP4b); `fixtureProvider` (WP4); `AppLock`, `HEARTBEAT_INTERVAL_MS`, `seedAirports`, `loadAirportsDataset`, `sanityCheckAirports`, `MIGRATIONS_DIR`, `AIRPORTS_DATA_DIR`, `CalendarPriceInsert` (WP3); `createEngine`, `LogNotifier` (WP7); `apiContract.ROUTES`, `microGbpToPence`, `DEFAULT_DISCOVERY_REFRESH_HOURS`, `FIXTURE_OPT_IN_PHRASE`, `formatPence` (core).
- Produces: `createApp` (non-strict mounting; Task 8.15 makes it strict), `ApiError`, `envelope`, `fieldsDetail`, `issuesToFields`, `parseWith`, `API_TEXT`, `defaultDefinitionInput`, `usageOf`, `providerScopes`, `windowScope`, `budgetScopes`, the middleware of spec §4, `bootApp`, `BootError`, `Timers`, `main`, `acquireAppLockWithWaits`, `LockRefusedError`, `assetPaths`; routes `GET /api/health` (both shapes), `GET /api/airports`, `GET /api/providers`, `GET /api/budget`, `GET /api/scheduler/jobs`.

The bootstrap cannot boot without its ports, its middleware and at least one route, so this task builds them together; Tasks 8.2–8.8 then pin each behaviour with its own tests.

**Plan preset** (spec §8.2, §11), used by `GET /api/providers` `presets` and by `POST /api/definitions` with no body (Task 8.9): Travelpayouts discovery when configured; SearchApi in both stages only on the `40usd` plan (the `trial` credits are for the spike and smoke, spec §2 fact 7); the fixture provider in both stages when the gate admits it; `maxCells 10, topN 10, expandTop 2, bookingLinks true`; budget from `EXECUTION_MAX_*`; each discovery provider's refresh core's `DEFAULT_DISCOVERY_REFRESH_HOURS` (168, decision 21); no airports; `enabled: false`; schedule `0 5 * * 1` in `SCHEDULER_TIMEZONE`.

**Boot order** (plan "Wiring and bootstraps", spec §7; decision 32 reuses WP4b's preflight): refuse `NODE_ENV=test` (70) → `dataDirRefusal` (73) → `backupBeforeMigrations` when migrations are pending on an existing file (73 when the backups path is unusable, 74 when the backup fails) → `buildPorts` (migrations) → seed when the airports table is empty or the dataset changed → `sanityCheckAirports` over the airports of enabled definitions (1) → `acquireAppLockWithWaits` (75) → heartbeat every `HEARTBEAT_INTERVAL_MS`, its failure logged rather than thrown (a throw inside a timer would kill the process with executions running) → `createEngine({ ...ports, notifiers: [new LogNotifier(log)] })` (WP7's `EngineOptions` carries no cost; WP11 adds `{ alerts: runAlerts }`) → `engine.boot()` → `createApp` → serve. `close()`: stop accepting → `engine.shutdown()` → clear the heartbeat → `wal_checkpoint(TRUNCATE)` → `lock.release()` → `db.close()`. Every exit code is WP4b's `EXIT` table, the one table every CLI shares.

**Input typing.** `@hono/zod-validator` validates each body and query with its ROUTES schema (the 400 envelope with `details.fields` on failure). The table-driven mount loses Hono's static input types, so `readInput` hands the handler `unknown` values and the handler narrows them with `parseWith(schema, value)`: the same schema the validator accepted, an idempotent re-parse, and no cast (`pnpm casts`, decision 48).

- [ ] **Step 1: Write the failing tests**

The spawn test runs the real entry with an environment built from scratch (no inherited `NODE_ENV=test`), and probes the server from a second, unguarded `node` process, because this test process's `fetch` is answered by WP4's network guards and they refuse even a DNS lookup of `127.0.0.1`.

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
    timeout: 20_000,
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
  it('the real bootstrap under NODE_ENV=production never offers or accepts synthetic data', async () => {
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
      await waitForLine(child, /"msg":"listening"/, 45_000);
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
  }, 90_000);

  it('refuses NODE_ENV=test with exit code 70 and bad config with 78 (plan exit-code table)', async () => {
    const dir = tempDir('gmt-spawn-');
    const base = {
      PATH: process.env.PATH ?? '',
      BIND_ADDRESS: '127.0.0.1',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    };
    const run = (env: Record<string, string>) =>
      waitForExit(
        spawn(process.execPath, ENTRY, { cwd: apiRoot, env: cleanEnv({ ...base, ...env }), stdio: 'ignore' }),
      );
    expect(await run({ NODE_ENV: 'test', DATABASE_PATH: join(dir, 'x.test.db') })).toBe(70);
    expect(await run({ NODE_ENV: 'production', DATABASE_PATH: join(dir, 'x.db'), PORT: 'not-a-port' })).toBe(
      78,
    );
  }, 60_000);
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

`apps/api/vitest.config.ts` — find:

```ts
    setupFiles: ['test/support/setup.ts'],
```

`apps/api/vitest.config.ts` — replace with:

```ts
    setupFiles: ['test/support/setup.ts'],
    // why: the boot tests seed the full airports table per boot and the spawn test starts a real production process
    // (spec §5.5); on a loaded machine the default 5 s, and even 20 s, timed out in the assembly runs.
    testTimeout: 60_000,
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
  hostRejected: (host: string, allowed: readonly string[]) =>
    `Host "${host}" is not in ALLOWED_HOSTS (${allowed.join(', ')})`,
  originRejected: (origin: string, allowed: readonly string[]) =>
    `Origin "${origin}" does not match ALLOWED_HOSTS (${allowed.join(', ')})`,
  contentType: 'requests that change data need Content-Type: application/json',
  requestedWith: 'requests that change data need X-Requested-With: get-me-there',
  validation: (target: string) => `invalid request ${target}`,
  malformedJson: 'request body is not valid JSON',
  definitionNotFound: (id: string) => `no search definition ${id}`,
  executionNotFound: (id: string) => `no execution ${id}`,
  noExecution: 'this definition has not been run yet',
  alertNotFound: (id: string) => `no alert rule ${id}`,
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
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
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
 * `app.onError`: ApiError → its envelope; Hono's HTTPException (a malformed JSON body from the validator) → 400
 * `validation`; anything else → 500 without internals, logged URL-free and secret-free (spec §5.3, §14).
 */
export function onError(log: Logger, secrets: readonly Secret[]) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.details), err.status);
    if (err instanceof HTTPException && err.status < 500)
      return c.json(envelope('validation', API_TEXT.malformedJson), 400);
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
  /** Set by the optional-JSON validator: whether a body was sent and its parsed value. */
  optionalBody?: { present: boolean; value: unknown };
}
export type AppEnv = { Variables: AppVariables };

export type ToolRunResponse = z.infer<typeof apiContract.toolRunResponseSchema>;
export type ToolRecordRequest = z.infer<typeof apiContract.toolRecordRequestSchema>;
/** In-process tool entry points; an absent runner answers 503 tool_unavailable. */
export interface ToolRunners {
  record?: (args: ToolRecordRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
}

/** ROUTES entries another package mounts (plan decision 4). WP13 adds the smoke handler and removes its key. */
export const OWNED_ELSEWHERE: ReadonlySet<string> = new Set(['POST /api/tools/smoke']);

/**
 * What a handler receives. Values are what the validators accepted, typed `unknown` because the table-driven mount
 * loses Hono's static input type; each handler narrows with its own contract schema through `parseWith` (no casts).
 */
export interface RouteInput {
  body: unknown;
  query: unknown;
  params: Record<string, string>;
}
export interface RouteContext {
  ports: Ports;
  engine: Engine;
  tools: ToolRunners;
  /** One tool at a time (spec §10 `/tools/*`). */
  toolInFlight: { name: string | null };
}
export type RouteHandler = (
  c: Context<AppEnv>,
  input: RouteInput,
  ctx: RouteContext,
) => Response | Promise<Response>;
/** Handlers keyed exactly as `${method} ${path}` of a ROUTES entry. */
export type HandlerTable = Readonly<Record<string, RouteHandler>>;
```

`apps/api/src/routes/shared.ts` (new file):

```ts
/** Helpers every handler table uses. */
import type { SearchDefinition } from '@gmt/core';
import type { z } from 'zod';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { RouteContext, RouteInput } from './types.js';

/**
 * Narrows a validated input with its contract schema. why: the validators already accepted the value with this same
 * schema, so this parse cannot fail on a mounted route; it is how a handler gets the static type without a cast (plan
 * Global Constraints: no `as`). Re-parsing is idempotent for every contract schema (trim/upper-case, coerce, default).
 */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown, target = 'body'): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new ApiError(
      400,
      'validation',
      API_TEXT.validation(target),
      fieldsDetail(issuesToFields(r.error.issues)),
    );
  return r.data;
}

/** A path parameter the router guarantees; a missing one is a 400, never a crash. */
export function param(input: RouteInput, name: string): string {
  const v = input.params[name];
  if (v === undefined || v === '') throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return v;
}

/** A definition that exists and is not soft-deleted, else 404 `definition_not_found`. */
export function getLiveDefinition(ctx: RouteContext, id: string): SearchDefinition {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null)
    throw new ApiError(404, 'definition_not_found', API_TEXT.definitionNotFound(id));
  return def;
}
```

`apps/api/src/read/usage.ts` (new file):

```ts
/** Budget usage in the api-contract shape (spec §7 budget windows, §10). */
import {
  type apiContract,
  type BudgetScope,
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

/** Stable wire label for a scope, e.g. `provider-month:searchapi`, `execution-calls`, `global-month`. */
export function scopeLabel(s: BudgetScope): string {
  return 'providerId' in s ? `${s.kind}:${s.providerId}` : s.kind;
}

/** Both provider windows; the guard reports `cap: null` for the one the plan does not use (plan, Budget port). */
export function providerScopes(providerId: ProviderId): BudgetScope[] {
  return [
    { kind: 'provider-month', providerId },
    { kind: 'provider-lifetime', providerId },
  ];
}

/** The provider window its plan counts against: lifetime for the trial, month otherwise (spec §5.3). */
export function windowScope(config: Config, providerId: ProviderId): BudgetScope {
  const kind =
    providerLimits(config, providerId)?.window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
  return { kind, providerId };
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
    scope: scopeLabel(scope),
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
import { budgetScopes, providerLimits, providerScopes, usageOf } from '../read/usage.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { parseWith } from './shared.js';
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
  // why: one public route with two shapes: the HEALTHCHECK gets the minimal one, an authenticated caller the detail.
  'GET /api/health': (c, _input, ctx) =>
    c.json(c.get('authenticated') ? healthDetail(ctx) : healthPublic(ctx)),
  'GET /api/airports': (c, input, ctx) => {
    const { q } = parseWith(apiContract.airportsQuerySchema, input.query, 'query');
    return c.json(
      ctx.ports.repos.airports.search(q, 20).map((a) => ({
        iata: a.iata,
        name: a.name,
        city: a.city,
        country: a.country,
        tz: a.tz,
        metro: a.metro,
      })),
    );
  },
  'GET /api/providers': (c, _input, ctx) => c.json(providersResponse(ctx)),
  'GET /api/budget': (c, _input, ctx) => c.json(budgetResponse(ctx)),
  'GET /api/scheduler/jobs': (c, _input, ctx) => c.json({ jobs: ctx.engine.scheduler.jobs() }),
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

`apps/api/src/middleware/validate.ts` (new file):

```ts
/** Spec §10: every ROUTES entry's path, query and body validated by its contract schema before the handler runs. */
import type { apiContract } from '@gmt/core';
import { zValidator } from '@hono/zod-validator';
import type { Context, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { envelope, fieldsDetail, issuesToFields } from '../errors.js';
import type { AppEnv, RouteInput } from '../routes/types.js';
import { API_TEXT } from '../text.js';

type RouteDef = apiContract.RouteDef;
type Target = 'json' | 'query';
const TARGET_LABEL: Record<Target, string> = { json: 'body', query: 'query' };

/** The 400 envelope with `details.fields` for a value its schema refused. */
function refusal(
  c: Context<AppEnv>,
  target: string,
  error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> },
) {
  return c.json(
    envelope('validation', API_TEXT.validation(target), fieldsDetail(issuesToFields(error.issues))),
    400,
  );
}

function validator(target: Target, schema: z.ZodType): MiddlewareHandler<AppEnv> {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return refusal(c, TARGET_LABEL[target], result.error);
    return undefined;
  });
}

/** True for request schemas that accept a missing body (only `POST /api/definitions`, spec §10). */
export function acceptsUndefined(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

/** Body validator for schemas that accept "no body": zValidator('json') would reject an empty body as malformed. */
function optionalJson(schema: z.ZodType): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const text = await c.req.text();
    if (text.trim() === '') {
      c.set('optionalBody', { present: false, value: undefined });
      return next();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return c.json(envelope('validation', API_TEXT.malformedJson), 400);
    }
    const r = schema.safeParse(parsed);
    if (!r.success) return refusal(c, 'body', r.error);
    c.set('optionalBody', { present: true, value: r.data });
    return next();
  };
}

const passThrough: MiddlewareHandler<AppEnv> = async (_c, next) => {
  await next();
};

/** The validators a ROUTES entry needs: query, then body. Always at least one middleware. */
export function validatorsFor(route: RouteDef): MiddlewareHandler<AppEnv>[] {
  const mws: MiddlewareHandler<AppEnv>[] = [passThrough];
  if (route.query !== undefined) mws.push(validator('query', route.query));
  if (route.request !== undefined)
    mws.push(
      acceptsUndefined(route.request) ? optionalJson(route.request) : validator('json', route.request),
    );
  return mws;
}

/**
 * The inputs a handler reads: the path parameters, the raw query and the body its validator accepted (Hono caches the
 * parsed JSON, so this is no second read). Each handler narrows them with `parseWith` and its contract schema.
 */
export async function readInput(c: Context<AppEnv>, route: RouteDef): Promise<RouteInput> {
  let body: unknown;
  if (route.request !== undefined)
    body = acceptsUndefined(route.request) ? c.get('optionalBody')?.value : await c.req.json();
  return { body, query: route.query === undefined ? undefined : c.req.query(), params: c.req.param() };
}
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

/** Spec §4: 5 failures per minute per source IP, 20 per minute overall. In memory: one process, one operator. */
export class FailedAuthLimiter {
  private readonly byIp = new Map<string, number[]>();
  private global: number[] = [];
  constructor(
    private readonly clock: Clock,
    private readonly limits = { perIp: 5, global: 20, windowMs: 60_000 },
  ) {}

  private now(): number {
    return Date.parse(this.clock.now());
  }

  private recent(list: number[], now: number): number[] {
    return list.filter((t) => now - t < this.limits.windowMs);
  }

  /** When does the oldest failure that keeps `list` at its limit expire? null when under the limit. */
  private blockedUntil(list: number[], limit: number): number | null {
    if (list.length < limit) return null;
    const pivot = list[list.length - limit];
    return pivot === undefined ? null : pivot + this.limits.windowMs;
  }

  /** Seconds until this source may try again, or null when it is not limited. */
  retryAfterSeconds(ip: string | null): number | null {
    const now = this.now();
    this.global = this.recent(this.global, now);
    const untils = [this.blockedUntil(this.global, this.limits.global)];
    if (ip !== null) {
      const mine = this.recent(this.byIp.get(ip) ?? [], now);
      if (mine.length === 0) this.byIp.delete(ip);
      else this.byIp.set(ip, mine);
      untils.push(this.blockedUntil(mine, this.limits.perIp));
    }
    const until = Math.max(...untils.map((u) => u ?? 0));
    return until > now ? Math.ceil((until - now) / 1000) : null;
  }

  recordFailure(ip: string | null): void {
    const now = this.now();
    this.global.push(now);
    if (ip !== null) this.byIp.set(ip, [...(this.byIp.get(ip) ?? []), now]);
    // why: bound memory under a spray of source addresses.
    if (this.byIp.size > 10_000) {
      for (const [k, v] of this.byIp) if (this.recent(v, now).length === 0) this.byIp.delete(k);
    }
  }
}

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
 * Spec §4: everything except the public `GET /api/health` needs auth, static files included.
 * Credentials are evaluated only when the source is not rate-limited; a wrong password counts
 * on every route (so the public health route cannot probe passwords); a request without credentials is never counted.
 */
export function basicAuthGate(o: AuthGateOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = o.config.auth;
    if (auth === null) {
      // why: config refuses this on a non-loopback bind unless ALLOW_UNAUTHENTICATED=true (spec §4).
      c.set('authenticated', true);
      return next();
    }
    const isPublic = o.publicKeys.has(`${c.req.method} ${c.req.path}`);
    const header = c.req.header('authorization');
    if (header !== undefined) {
      const ip = o.clientIp(c);
      const retry = o.limiter.retryAfterSeconds(ip);
      if (retry !== null) {
        c.header('Retry-After', String(retry));
        return c.json(envelope('auth_rate_limited', API_TEXT.rateLimited(retry)), 429);
      }
      if (credentialsMatch(header, auth) === 'valid') {
        c.set('authenticated', true);
        return next();
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
/** Spec §4 request hardening: Host allowlist, Origin check, JSON and X-Requested-With on mutating calls. */
import type { Config } from '@gmt/core';
import type { Context, MiddlewareHandler } from 'hono';
import { envelope } from '../errors.js';
import type { AppEnv } from '../routes/types.js';
import { API_TEXT } from '../text.js';

type Exempt = (c: Context<AppEnv>) => boolean;
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** Spec §4 `ALLOWED_HOSTS`: rejection names the header value and the variable. The public GET /api/health is exempt. */
export function hostAllowlist(config: Config, exempt: Exempt): MiddlewareHandler<AppEnv> {
  const allowed = new Set(config.allowedHosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    if (exempt(c)) return next();
    const host = c.req.header('host') ?? '';
    if (!allowed.has(host.toLowerCase())) {
      return c.json(
        envelope(
          'host_not_allowed',
          API_TEXT.hostRejected(host === '' ? '(none)' : host, config.allowedHosts),
        ),
        403,
      );
    }
    return next();
  };
}

/** Spec §4: `Origin`, when present, must name an allowed host. */
export function originCheck(config: Config, exempt: Exempt): MiddlewareHandler<AppEnv> {
  const allowed = new Set(config.allowedHosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin === undefined || exempt(c)) return next();
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      host = origin; // why: "null" and garbage are compared as-is, so they never match
    }
    if (!allowed.has(host.toLowerCase()))
      return c.json(
        envelope('origin_not_allowed', API_TEXT.originRejected(origin, config.allowedHosts)),
        403,
      );
    return next();
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
import { every } from 'hono/combine';
import { notFound, onError } from './errors.js';
import { basicAuthGate, clientIpFrom, FailedAuthLimiter } from './middleware/auth.js';
import { hostAllowlist, mutatingRequestCheck, originCheck } from './middleware/hardening.js';
import { securityHeaders } from './middleware/headers.js';
import { readInput, validatorsFor } from './middleware/validate.js';
import { HANDLERS } from './routes/index.js';
import {
  API_PREFIX,
  type AppEnv,
  OWNED_ELSEWHERE,
  type RouteContext,
  type ToolRunners,
} from './routes/types.js';
import { mountStatic } from './static.js';
import type { Ports } from './wiring.js';

export { API_PREFIX };

export interface AppOptions {
  /** Directory of the built SPA (`apps/web/dist`); null serves no static files. */
  webRoot?: string | null;
  tools?: ToolRunners;
  /** Source IP for the failed-auth limit; tests inject it, production derives it from the socket or the proxy. */
  clientIp?: (c: Context<AppEnv>) => string | null;
  /** The route table to mount; defaults to `apiContract.ROUTES`. Tests pass a modified table. */
  routes?: readonly apiContract.RouteDef[];
}

export function publicRouteKeys(routes: readonly apiContract.RouteDef[]): Set<string> {
  return new Set(routes.filter((r) => r.auth === 'public').map((r) => `${r.method} ${r.path}`));
}

/**
 * The single HTTP surface (spec §10): one Hono app mounting every ROUTES entry from `@gmt/core` api-contract (paths
 * carry `/api`) with zod validation, the error envelope, the spec §4 hardening and the auth gate.
 */
export function createApp(ports: Ports, engine: Engine, options: AppOptions = {}): Hono<AppEnv> {
  const routes = options.routes ?? apiContract.ROUTES;
  const ctx: RouteContext = { ports, engine, tools: options.tools ?? {}, toolInFlight: { name: null } };
  const app = new Hono<AppEnv>();
  app.onError(onError(ports.log, ports.secrets));
  app.notFound(notFound);
  const publicKeys = publicRouteKeys(routes);
  const isPublic = (c: Context<AppEnv>) => publicKeys.has(`${c.req.method} ${c.req.path}`);
  // why: ROUTES paths carry /api, so the public key is 'GET /api/health'.
  // Order (spec §4): headers on everything → Host → Origin → auth → JSON + X-Requested-With on mutating API calls.
  app.use('*', securityHeaders());
  app.use('*', hostAllowlist(ports.config, isPublic));
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
  app.use(`${API_PREFIX}/*`, mutatingRequestCheck());
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const handler = HANDLERS[key];
    // why: Task 8.15 makes mounting strict once every handler exists; until then an unmapped entry answers 404.
    if (handler === undefined || OWNED_ELSEWHERE.has(key)) continue;
    app.on(route.method, route.path, every(...validatorsFor(route)), async (c) =>
      handler(c, await readInput(c, route), ctx),
    );
  }
  if (options.webRoot) mountStatic(app, options.webRoot);
  return app;
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
/** Spec §7 `app_lock` acquisition policy for the app holder. */
import type { Clock, IsoDateTime, Logger } from '@gmt/core';
import type { AppLock } from '@gmt/db';
import { EXIT } from '../tools/types.js';

/** Spec §7: a fresh tool lock makes the app wait up to 60 s, then refuse. */
export const TOOL_LOCK_WAIT_MS = 60_000;
/** Spec §7: a fresh app lock makes the app wait up to 90 s (three missed 30 s beats), then refuse if still heartbeated. */
export const APP_LOCK_WAIT_MS = 90_000;
export const LOCK_POLL_MS = 1_000;
const LOG_EVERY_MS = 10_000;

/** A lock refusal; exit code 75 in the plan's table. */
export class LockRefusedError extends Error {
  readonly exitCode = EXIT.lockRefused;
  constructor(message: string) {
    super(message);
    this.name = 'LockRefusedError';
  }
}

export interface LockWaitDeps {
  lock: AppLock;
  inspect: () => { holder: 'app' | 'tool'; heartbeatAt: IsoDateTime } | null;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: Logger;
}

const ms = (iso: IsoDateTime): number => Date.parse(iso);
const seconds = (v: number): number => Math.round(v / 1000);

/**
 * The app holder's acquisition policy (spec §7): poll every second. A fresh `tool` lock: refuse once 60 s have passed.
 * A fresh `app` lock: wait, logging its age every 10 s; WP3's `acquire` takes it over at once whenever it has gone stale
 * (three missed 30 s beats); if it is still being heartbeated after 90 s, refuse (two live apps). Liveness is judged by
 * heartbeat age inside `acquire`, never by pid.
 */
export async function acquireAppLockWithWaits(d: LockWaitDeps): Promise<void> {
  const started = ms(d.clock.now());
  let lastLogAt = Number.NEGATIVE_INFINITY;
  for (;;) {
    if (d.lock.acquire({ waitMs: 0 }) === 'acquired') return;
    const now = ms(d.clock.now());
    const waited = now - started;
    const held = d.inspect();
    if (held !== null) {
      const lockAgeMs = now - ms(held.heartbeatAt);
      if (held.holder === 'tool' && waited >= TOOL_LOCK_WAIT_MS) {
        throw new LockRefusedError(
          `app_lock is held by a tool process (heartbeat ${seconds(lockAgeMs)}s ago); waited ${seconds(waited)}s; refusing to start. Start the app when the tool has finished.`,
        );
      }
      if (held.holder === 'app' && waited > APP_LOCK_WAIT_MS) {
        // why: an ungracefully stopped app stops heartbeating and goes stale within 90 s; a lock that
        // is still fresh after that belongs to a second live app, and two writers would corrupt the ledger.
        throw new LockRefusedError(
          `app_lock is held by another app process that is still heartbeating (${seconds(lockAgeMs)}s ago); refusing to start a second app`,
        );
      }
      if (waited - lastLogAt >= LOG_EVERY_MS) {
        d.log.warn({ holder: held.holder, lockAgeMs, waitedMs: waited }, 'waiting for app_lock');
        lastLogAt = waited;
      }
    }
    await d.sleep(LOCK_POLL_MS);
  }
}
```

`apps/api/src/bootstrap/app.ts` (new file):

```ts
/**
 * The app bootstrap (spec §4, §5.5, §7, §12, §13): the process that serves the API and the SPA and runs the engine.
 * Order (plan "Wiring and bootstraps"): refuse NODE_ENV=test → data directory writable → backup preflight when
 * migrations are pending (WP4b's preflight.ts, decision 32) → buildPorts (migrations) → seed + airport sanity check →
 * app_lock('app') with waits and a 30 s heartbeat → createEngine → engine.boot() → serve. Shutdown: stop accepting →
 * engine.shutdown() → wal_checkpoint(TRUNCATE) → lock release → close (spec §7 order).
 */
import { type Clock, type Config, type Logger, type Secret, systemClock } from '@gmt/core';
import {
  AppLock,
  HEARTBEAT_INTERVAL_MS,
  loadAirportsDataset,
  sanityCheckAirports,
  seedAirports,
} from '@gmt/db';
import { createEngine, type Engine, LogNotifier } from '@gmt/engine';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import type { AppEnv, ToolRunners } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';
import { acquireAppLockWithWaits } from './lock.js';
import { type AssetPaths, assetPaths } from './paths.js';
import { backupBeforeMigrations, dataDirRefusal } from './preflight.js';

/** A boot refusal: logged with its message; start.ts exits with `exitCode` (the plan's single exit-code table). */
export class BootError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'BootError';
    this.exitCode = exitCode;
  }
}

/** Timers the bootstrap uses for the heartbeat; tests inject their own to observe it. */
export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Node's timers, the heartbeat unref'd so it never keeps the process alive. */
function nodeTimers(): Timers {
  const handles = new Map<unknown, NodeJS.Timeout>();
  return {
    setInterval: (fn, ms) => {
      const t = setInterval(fn, ms);
      t.unref();
      const key = {};
      handles.set(key, t);
      return key;
    },
    clearInterval: (key) => {
      clearInterval(handles.get(key));
      handles.delete(key);
    },
  };
}

export interface BootDeps {
  config: Config;
  log: Logger;
  clock?: Clock;
  /** false in tests that drive the app with `app.request()`. */
  listen: boolean;
  assets: AssetPaths;
  /** Builds the in-process tool runners once ports exist (`main` passes `inProcessTools`). */
  tools?: (ports: Ports) => ToolRunners;
  /** Injected by tests to advance a fixed clock instead of waiting for app_lock. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected by tests to observe the heartbeat; defaults to unref'd Node timers. */
  timers?: Timers;
}

export interface RunningApp {
  app: Hono<AppEnv>;
  ports: Ports;
  engine: Engine;
  port: number | null;
  close(): Promise<void>;
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

/** Spec §7: seed after migration when `airports` is empty or the dataset version changed; local files, no network. */
function seedIfNeeded(ports: Ports, dir: string, log: Logger): void {
  const dataset = loadAirportsDataset(dir);
  if (ports.repos.airports.count() > 0 && ports.repos.airports.datasetVersion() === dataset.version) return;
  const r = seedAirports(ports.db, dataset);
  log.info({ inserted: r.inserted, datasetVersion: r.datasetVersion }, 'airports seeded');
}

/**
 * Everything the app process does at start, with config injected (spec §5.5 boot matrix), in the plan's order.
 * Every refusal is a BootError (or LockRefusedError) carrying the plan's exit code: 70 NODE_ENV=test, 73 an unwritable
 * data or backups directory, 74 a failed backup, 75 app_lock refused, 1 anything else (a failed sanity check).
 */
export async function bootApp(deps: BootDeps): Promise<RunningApp> {
  const { config, log } = deps;
  const clock = deps.clock ?? systemClock;
  const timers = deps.timers ?? nodeTimers();
  const secrets: readonly Secret[] = collectSecrets(config);
  // why: spec §5.5: both bootstraps refuse NODE_ENV=test, so a test config can never serve traffic.
  if (config.nodeEnv === 'test')
    throw new BootError('the app bootstrap refuses NODE_ENV=test (spec §5.5)', EXIT.refusedTestEnv);
  const dataDir = dataDirRefusal(config.databasePath);
  if (dataDir !== null) throw new BootError(dataDir, EXIT.preflightImpossible);
  const backup = backupBeforeMigrations(config.databasePath, deps.assets.migrationsDir, clock, secrets);
  if (!backup.ok) throw new BootError(backup.message, backup.code);
  if (backup.line !== null) log.info({}, backup.line);
  const ports = buildPorts(config, { log, clock, migrationsDir: deps.assets.migrationsDir });
  try {
    seedIfNeeded(ports, deps.assets.airportsDataDir, log);
    // Spec §7: at least 5,000 airports with tz, and every airport an enabled definition references exists.
    const referenced = ports.repos.definitions
      .list()
      .filter((d) => d.enabled)
      .flatMap((d) => [...d.origins, ...d.destinations]);
    const sanity = sanityCheckAirports(ports.db, referenced);
    if (!sanity.ok) throw new BootError(`airport sanity check failed: ${sanity.reason}`, EXIT.failed);
    const lock = new AppLock(ports.db, 'app', clock, log);
    await acquireAppLockWithWaits({
      lock,
      inspect: () => AppLock.inspect(ports.db),
      clock,
      sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
      log,
    });
    const heartbeat = timers.setInterval(() => {
      try {
        lock.heartbeat();
      } catch (e) {
        // why: a throw inside a timer would kill the process with executions running; log it and keep serving reads.
        log.error({ err: { message: safeMessage(e, secrets) } }, 'app_lock heartbeat failed');
      }
    }, HEARTBEAT_INTERVAL_MS);
    // why: WP11 adds `{ alerts: runAlerts }` to these options; until then the engine's default noAlerts step runs.
    const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
    await engine.boot();
    const app = createApp(ports, engine, { webRoot: deps.assets.webRoot, tools: deps.tools?.(ports) ?? {} });
    const bound = deps.listen ? await listen(app, config) : null;
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
        timers.clearInterval(heartbeat);
        // why: spec §7 releases the lock after the checkpoint; db.close() checkpoints again, harmlessly.
        ports.db.raw.pragma('wal_checkpoint(TRUNCATE)');
        lock.release();
        ports.db.close();
        log.info({}, 'shutdown complete');
      },
    };
  } catch (err) {
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
import { BootError, main } from './app.js';
import { LockRefusedError } from './lock.js';

main(process.env).catch((err: unknown) => {
  // why: boot errors are already URL- and secret-free; a stray error is stripped of URLs here before it is printed.
  process.stderr.write(`${safeMessage(err, [])}\n`);
  // why: BootError and LockRefusedError carry the plan's exit code (70, 73, 74, 75, 78); anything else is 1.
  process.exit(err instanceof BootError || err instanceof LockRefusedError ? err.exitCode : EXIT.failed);
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.spawn.test.ts test/defaults.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 6 tests: the child logs `"msg":"listening"`, the probe's `GET /api/providers` is 200 without `fixture` and with `synthetic: false`, the child exits 0 on SIGTERM, the fixture constructor and the synthetic insert both throw, the refusals exit 70 and 78; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: the app bootstrap, the server core and the production-boot-lacks-fixture spawn test"
```

### Task 8.2: The route-test harness; the injected-config boot matrix, `NODE_ENV=test` refusal, data directory, password length, airport sanity check

**Files:**
- Test: `apps/api/test/bootstrap/app.matrix.test.ts`
- Create: `apps/api/test/helpers/harness.ts`

**Interfaces:**
- Consumes: `bootApp`, `createApp` (Task 8.1); `buildPorts` under `NODE_ENV=test` and `:memory:`, `loadConfigFromEnv`, `cleanEnv`, `SENTINEL_AUTH` (WP4b); `createEngine`, `LogNotifier` (WP7); the vendored airports files under `AIRPORTS_DATA_DIR` (WP3). Produces (test-only): `createHarness`, `Harness`, `harnessEnv`, `captureLines`, `basic`, `T0`, `HOST`, `AUTH_USER` — the route-test engine: real ports over an in-memory database, the engine, the fixture provider reached in-process through http-kit's gated `inProcessHosts` seam, the app driven with `app.request()`; it imports no other package's test files and needs no `msw`.

Rules (spec §5.5, §4, §7): the gate decides whether `fixture` is offered, through `GET /api/providers` and the ports alike; `NODE_ENV=test` is refused before the database is touched (70); an unwritable data directory is 73; a password under 12 characters is a config error naming `APP_BASIC_AUTH_PASS`; a failed airport sanity check fails boot (1).

- [ ] **Step 1: Write the failing test**

`apps/api/test/helpers/harness.ts` (new file):

```ts
// The route-test harness (spec §9 item 5): real ports over an in-memory database (NODE_ENV=test + :memory:, which
// syntheticAllowed admits), the engine, and the fixture provider reached through http-kit's gated inProcessHosts seam
// (buildPorts wires it), so no request leaves the process and no msw is imported here.
import { Writable } from 'node:stream';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { createEngine, type Engine, LogNotifier } from '@gmt/engine';
import type { Hono } from 'hono';
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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

/** Parsed once per test file: every harness seeds the same vendored dataset (spec §7), so only the insert repeats. */
let dataset: ReturnType<typeof loadAirportsDataset> | undefined;

export async function createHarness(
  opts: { env?: Record<string, string>; app?: AppOptions } = {},
): Promise<Harness> {
  const config = loadConfigFromEnv(harnessEnv(opts.env));
  const logLines: string[] = [];
  const log = createLogger(config, { destination: captureLines(logLines), secrets: collectSecrets(config) });
  const clock = fixedClock(T0);
  const ports = buildPorts(config, { log, clock, migrationsDir: MIGRATIONS_DIR });
  dataset ??= loadAirportsDataset(AIRPORTS_DATA_DIR);
  seedAirports(ports.db, dataset);
  const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
  await engine.boot();
  const app = createApp(ports, engine, { webRoot: null, ...opts.app });
  return {
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
      await engine.shutdown();
      ports.db.close();
    },
  };
}
```

`apps/api/test/bootstrap/app.matrix.test.ts` (new file):

```ts
// Spec §5.5 injected-config boot matrix; spec §4 password length; spec §7 the airport sanity check fails boot.
import { chmodSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { apiContract, FIXTURE_OPT_IN_PHRASE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp, type RunningApp } from '../../src/bootstrap/app.js';
import { type AssetPaths, assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from '../helpers/env.js';
import { basic } from '../helpers/harness.js';
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

describe('injected-config boot matrix (spec §5.5)', () => {
  it.each([
    // label, env overrides, fixture offered?
    ['production with the phrase and .fixture.db', {}, false],
    ['development, phrase, .fixture.db, not in a container', { NODE_ENV: 'development' }, true],
    ['development in a container', { NODE_ENV: 'development', IN_CONTAINER: '1' }, false],
    ['development with the wrong phrase', { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: 'yes' }, false],
    ['development without the phrase', { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: '' }, false],
  ] as const)('%s → fixture offered: %s', async (_label, overrides, expected) => {
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

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/bootstrap/app.ts` delete the two lines `if (config.nodeEnv === 'test')` … `throw new BootError('the app bootstrap refuses NODE_ENV=test (spec §5.5)', EXIT.refusedTestEnv);`.

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.matrix.test.ts`
Expected: FAIL, 1 of 10: "refuses NODE_ENV=test before touching the database (exit 70)" — `promise resolved "{ app: …" instead of rejecting`.

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.matrix.test.ts`
Expected: PASS, 10 tests (five matrix rows, the plain `.db` path, the refusal, 73, the password, the sanity check).

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: boot matrix, NODE_ENV=test refusal, data directory, password length and airport sanity tests"
```

### Task 8.3: `app_lock` waits for the app holder

**Files:**
- Test: `apps/api/test/bootstrap/app.lock.test.ts`

**Interfaces:**
- Consumes: `acquireAppLockWithWaits`, `TOOL_LOCK_WAIT_MS`, `APP_LOCK_WAIT_MS` (Task 8.1); `AppLock`, `AppLock.inspect` (WP3); `fixedClock` (core).

Rule (spec §7; plan "Wiring and bootstraps"): poll every second. A fresh `tool` lock: refuse once 60 s have passed (75). A fresh `app` lock: wait, logging its age every 10 s; WP3's `acquire` takes it over at once whenever it has gone stale (three missed 30 s beats); if it is still being heartbeated after 90 s, refuse (two live apps). The test sleeps by advancing a fixed clock.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bootstrap/app.lock.test.ts` (new file):

```ts
// Spec §7 app_lock: the app holder's waits, the stale takeover and the two-live-apps refusal.
import { fixedClock } from '@gmt/core';
import { AppLock, MIGRATIONS_DIR } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { APP_LOCK_WAIT_MS, acquireAppLockWithWaits, TOOL_LOCK_WAIT_MS } from '../../src/bootstrap/lock.js';
import { createLogger } from '../../src/logger.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { captureLines, harnessEnv, T0 } from '../helpers/harness.js';
import { onCleanup } from '../helpers/tmp.js';

function setup(onSleep: (totalMs: number) => void = () => {}) {
  const config = loadConfigFromEnv(harnessEnv());
  const clock = fixedClock(T0);
  const lines: string[] = [];
  const log = createLogger({ logLevel: 'debug' }, { destination: captureLines(lines) });
  const ports = buildPorts(config, { log, clock, migrationsDir: MIGRATIONS_DIR });
  onCleanup(() => ports.db.close());
  let slept = 0;
  const sleep = async (ms: number) => {
    slept += ms;
    clock.advance(ms);
    onSleep(slept);
  };
  const acquire = () =>
    acquireAppLockWithWaits({
      lock: new AppLock(ports.db, 'app', clock, log),
      inspect: () => AppLock.inspect(ports.db),
      clock,
      sleep,
      log,
    });
  return { ports, clock, log, lines, acquire, slept: () => slept };
}

describe('app_lock waits for the app holder (spec §7)', () => {
  it('acquires a free lock without waiting', async () => {
    const s = setup();
    await s.acquire();
    expect(s.slept()).toBe(0);
    expect(AppLock.inspect(s.ports.db)?.holder).toBe('app');
  });

  it('waits 60 s on a fresh tool lock, then refuses with exit code 75', async () => {
    const s = setup();
    expect(new AppLock(s.ports.db, 'tool', s.clock, s.log).acquire({ waitMs: 0 })).toBe('acquired');
    await expect(s.acquire()).rejects.toMatchObject({ exitCode: 75, message: expect.stringMatching(/tool/) });
    expect(s.slept()).toBeGreaterThanOrEqual(TOOL_LOCK_WAIT_MS);
    expect(s.slept()).toBeLessThan(TOOL_LOCK_WAIT_MS + 2_000);
    expect(AppLock.inspect(s.ports.db)?.holder).toBe('tool');
  });

  it('acquires as soon as a tool releases within the wait', async () => {
    let tool: AppLock | undefined;
    const s = setup((total) => {
      if (total >= 10_000) tool?.release();
    });
    tool = new AppLock(s.ports.db, 'tool', s.clock, s.log);
    tool.acquire({ waitMs: 0 });
    await s.acquire();
    expect(s.slept()).toBeGreaterThanOrEqual(10_000);
    expect(s.slept()).toBeLessThan(12_000);
    expect(AppLock.inspect(s.ports.db)?.holder).toBe('app');
  });

  it("takes over its own previous process's app lock once it goes stale, logging the lock age", async () => {
    const s = setup();
    new AppLock(s.ports.db, 'app', s.clock, s.log).acquire({ waitMs: 0 }); // the previous process, now dead
    const before = AppLock.inspect(s.ports.db);
    await s.acquire();
    expect(s.slept()).toBeGreaterThanOrEqual(APP_LOCK_WAIT_MS);
    expect(s.slept()).toBeLessThanOrEqual(APP_LOCK_WAIT_MS + 2_000);
    const after = AppLock.inspect(s.ports.db);
    expect(after?.holder).toBe('app');
    expect(after?.acquiredAt).not.toBe(before?.acquiredAt);
    expect(s.lines.some((l) => l.includes('"lockAgeMs"'))).toBe(true);
  });

  it('refuses after 90 s when another app process is still heartbeating', async () => {
    let other: AppLock | undefined;
    const s = setup(() => other?.heartbeat());
    other = new AppLock(s.ports.db, 'app', s.clock, s.log);
    other.acquire({ waitMs: 0 });
    await expect(s.acquire()).rejects.toThrow(/still heartbeating/);
    expect(s.slept()).toBeGreaterThan(APP_LOCK_WAIT_MS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/bootstrap/lock.ts` change `waited >= TOOL_LOCK_WAIT_MS` to `waited >= APP_LOCK_WAIT_MS`.

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.lock.test.ts`
Expected: FAIL, 1 of 5: "waits 60 s on a fresh tool lock, then refuses with exit code 75" — `expected 90000 to be less than 62000`.

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.lock.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: app_lock wait tests: 60 s on a tool lock, stale takeover, two live apps refused"
```

### Task 8.4: Backup preflight when migrations are pending

**Files:**
- Test: `apps/api/test/bootstrap/app.backup.test.ts`

**Interfaces:**
- Consumes: `bootApp` (Task 8.1); `backupsDirFor`, `pendingOnExistingDb` (WP4b `bootstrap/preflight.ts`, decision 32); WP3's `backupDatabase` behind it.

Rule (spec §7 Migrations, §13): the app bootstrap calls WP4b's `backupBeforeMigrations` before `buildPorts` applies anything; a new database file has nothing to back up; a backup lands in `<db dir>/backups` and holds the pre-migration schema; a failed backup refuses boot with 74 and leaves the schema unmigrated; a backups path that is not a directory refuses with 73. A probe migration (a copy of the committed migrations plus one newer journal entry) makes migrations pending without touching the committed tree.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bootstrap/app.backup.test.ts` (new file):

```ts
// Spec §7 Migrations, §13 Backup: the app bootstrap reuses WP4b's preflight (plan decision 32).
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { backupsDirFor, pendingOnExistingDb } from '../../src/bootstrap/preflight.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from '../helpers/env.js';
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

describe('backup preflight (spec §7 Migrations, §13 Backup)', () => {
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
});
```

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/bootstrap/app.ts` replace `if (!backup.ok) throw new BootError(backup.message, backup.code);` with `void backup;`.

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.backup.test.ts`
Expected: FAIL, 2 of 4: the 74 and 73 cases — `promise resolved "undefined" instead of rejecting`.

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.backup.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: backup preflight tests over WP4b's preflight (decision 32)"
```

### Task 8.5: Graceful shutdown order and the heartbeat

**Files:**
- Test: `apps/api/test/bootstrap/app.shutdown.test.ts`

**Interfaces:**
- Consumes: `bootApp`, `Timers` (Task 8.1); `HEARTBEAT_INTERVAL_MS`, `AppLock` (WP3).

Rule (spec §7, §13): the heartbeat runs every 30 s; shutdown is stop accepting → `engine.shutdown()` → `wal_checkpoint(TRUNCATE)` → lock release → close, and is idempotent. pino redaction is WP4b's and tested there.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bootstrap/app.shutdown.test.ts` (new file):

```ts
// Spec §7, §13: the heartbeat and the graceful shutdown order.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppLock, HEARTBEAT_INTERVAL_MS, openDatabase } from '@gmt/db';
import { describe, expect, it, vi } from 'vitest';
import { bootApp, type Timers } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

function first(order: number[]): number {
  const v = order[0];
  if (v === undefined) throw new Error('not called');
  return v;
}

describe('graceful shutdown (spec §7, §13)', () => {
  it('heartbeats every 30 s and shuts down: engine → checkpoint → release lock → close', async () => {
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    const config = loadConfigFromEnv(
      cleanEnv({
        NODE_ENV: 'development',
        DATABASE_PATH: dbPath,
        BIND_ADDRESS: '127.0.0.1',
        LOG_LEVEL: 'error',
      }),
    );
    let tick: (() => void) | undefined;
    let intervalMs = 0;
    const handle = { id: 'heartbeat' };
    const cleared: unknown[] = [];
    const timers: Timers = {
      setInterval: (fn, ms) => {
        tick = fn;
        intervalMs = ms;
        return handle;
      },
      clearInterval: (h) => void cleared.push(h),
    };
    const running = await bootApp({
      config,
      log: createLogger({ logLevel: 'error' }),
      listen: false,
      assets: assetPaths(),
      timers,
    });
    expect(intervalMs).toBe(HEARTBEAT_INTERVAL_MS);
    const heartbeat = vi.spyOn(AppLock.prototype, 'heartbeat');
    tick?.();
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
    expect(cleared).toContain(handle);

    const db = openDatabase(dbPath);
    try {
      expect(AppLock.inspect(db)).toBeNull();
    } finally {
      db.close();
    }
    const wal = `${dbPath}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    await running.close(); // idempotent
    expect(shutdown).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/bootstrap/app.ts` move `lock.release();` above `ports.db.raw.pragma('wal_checkpoint(TRUNCATE)');`.

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.shutdown.test.ts`
Expected: FAIL, 1 of 1: `expected 4 to be less than 3` (the checkpoint ran after the release).

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/app.shutdown.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: shutdown order (checkpoint before lock release) and heartbeat test"
```

### Task 8.6: Contract helpers; security headers; Host, Origin, Content-Type, X-Requested-With

**Files:**
- Create: `apps/api/test/helpers/contract.ts`, `apps/api/test/helpers/examples.ts`
- Test: `apps/api/test/routes/hardening.test.ts`

**Interfaces:**
- Consumes: the harness (Task 8.2), `apiContract.ROUTES`, `errorEnvelopeSchema` (core).
- Produces (test-only): `expectContract(res, method, path, schema)` (parses the body against its ROUTES entry and returns it typed, so no test casts a body), `expectEnvelopeOrContract`, `errorOf`; `exampleDefinitionInput`, `SMALL_WINDOW`, `LHR`, `LGW`, `JFK`, `EWR`.

Rules (spec §4): headers on every response including 401 and 404; Host checked before auth, the public `GET /api/health` exempt; `Origin`, when present, must name an allowed host; mutating API calls need JSON (415 otherwise) and `X-Requested-With: get-me-there` (403).

- [ ] **Step 1: Write the helpers and the failing test**

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

`apps/api/test/routes/hardening.test.ts` (new file):

```ts
// Spec §4 security headers and request hardening.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { errorOf } from '../helpers/contract.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
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
  it('rejects an unknown Host naming the value and ALLOWED_HOSTS, before auth', async () => {
    const res = await h.request('/api/providers', { auth: false, headers: { host: 'evil.example:3000' } });
    expect(res.status).toBe(403);
    const e = await errorOf(res);
    expect(e.code).toBe('host_not_allowed');
    expect(e.message).toBe(API_TEXT.hostRejected('evil.example:3000', h.ports.config.allowedHosts));
    expect(e.message).toContain('ALLOWED_HOSTS');
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
```

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/app.ts` delete the line `` app.use(`${API_PREFIX}/*`, mutatingRequestCheck()); ``.

Run: `pnpm --filter @gmt/api exec vitest run test/routes/hardening.test.ts`
Expected: FAIL, 4 of 18: the three 415 cases and the 403 case get 404.

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1 and the test helpers above.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/hardening.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: route-test harness; security header and request hardening tests"
```

### Task 8.7: Failed-auth rate limit, the auth gate over static files, the SPA fallback

**Files:**
- Test: `apps/api/test/routes/auth.test.ts`

**Interfaces:**
- Consumes: `basicAuthGate`, `FailedAuthLimiter`, `clientIpFrom`, `mountStatic` (Task 8.1); the harness (Task 8.6).

Rules (spec §4): a request that presents credentials is refused with 429 (`auth_rate_limited`, `Retry-After`) while its source IP has 5 failures in the last minute, or the whole app has 20; a wrong password counts on every route, the public `/health` included (so it cannot probe passwords), but a request without credentials is never counted. The source IP is the last `X-Forwarded-For` entry only when `TRUST_PROXY=true`, else the socket address; when neither is known only the global limit applies. Static files need auth; SPA paths fall back to `index.html`; `/api/*` never does.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/auth.test.ts` (new file):

```ts
// Spec §4 basic auth, the failed-auth rate limit, auth over static files, the SPA fallback.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AppEnv } from '../../src/routes/types.js';
import { errorOf } from '../helpers/contract.js';
import { SENTINEL_AUTH } from '../helpers/env.js';
import { AUTH_USER, basic, createHarness, type Harness } from '../helpers/harness.js';
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

describe('failed-auth rate limit (spec §4)', () => {
  it('5 failures from one IP block that IP (even with the right password) for a minute, not others', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 5; i++)
      expect(
        (await x.request('/api/providers', { headers: { authorization: WRONG, 'x-test-ip': '203.0.113.7' } }))
          .status,
      ).toBe(401);
    const blocked = await x.request('/api/providers', {
      headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.7' },
    });
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe('auth_rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(
      (await x.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.8' } }))
        .status,
    ).toBe(200);
    x.clock.advance(61_000);
    expect(
      (await x.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.7' } }))
        .status,
    ).toBe(200);
  });

  it('wrong credentials on the public /api/health still count; no credentials never do', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 5; i++)
      expect(
        (await x.request('/api/health', { headers: { authorization: WRONG, 'x-test-ip': '203.0.113.9' } }))
          .status,
      ).toBe(200);
    expect(
      (await x.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.9' } }))
        .status,
    ).toBe(429);
    for (let i = 0; i < 30; i++)
      await x.request('/api/health', { auth: false, headers: { 'x-test-ip': '198.51.100.1' } });
    expect(
      (await x.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '198.51.100.1' } }))
        .status,
    ).toBe(200);
  });

  it('20 failures across many IPs trip the global limit', async () => {
    const x = await harness({ app: byTestIp });
    for (let i = 0; i < 20; i++)
      await x.request('/api/providers', {
        headers: { authorization: WRONG, 'x-test-ip': `198.51.100.${i}` },
      });
    expect(
      (await x.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '192.0.2.1' } }))
        .status,
    ).toBe(429);
  });

  it('TRUST_PROXY=true keys on the last X-Forwarded-For entry', async () => {
    const x = await harness({ env: { TRUST_PROXY: 'true' } });
    for (let i = 0; i < 5; i++)
      await x.request('/api/providers', {
        headers: { authorization: WRONG, 'x-forwarded-for': '198.51.100.7' },
      });
    expect(
      (
        await x.request('/api/providers', {
          headers: { authorization: RIGHT, 'x-forwarded-for': '198.51.100.7' },
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await x.request('/api/providers', {
          headers: { authorization: RIGHT, 'x-forwarded-for': '198.51.100.7, 198.51.100.8' },
        })
      ).status,
    ).toBe(200);
  });

  it('TRUST_PROXY=false ignores X-Forwarded-For', async () => {
    const x = await harness();
    for (let i = 0; i < 5; i++)
      await x.request('/api/providers', {
        headers: { authorization: WRONG, 'x-forwarded-for': '198.51.100.7' },
      });
    // why: no socket under app.request(), so the IP is unknown and only the global limit (20) applies.
    expect(
      (
        await x.request('/api/providers', {
          headers: { authorization: RIGHT, 'x-forwarded-for': '198.51.100.7' },
        })
      ).status,
    ).toBe(200);
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

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/middleware/auth.ts` delete `o.limiter.recordFailure(ip);`.

Run: `pnpm --filter @gmt/api exec vitest run test/routes/auth.test.ts`
Expected: FAIL, 4 of 10: the rate-limit tests get 200 where they expect 429.

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/auth.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: failed-auth rate limit, auth over static files and SPA fallback tests"
```

### Task 8.8: Health detail, airports autocomplete, providers, budget, scheduler jobs

**Files:**
- Test: `apps/api/test/routes/system.test.ts`

**Interfaces:**
- Consumes: `systemHandlers` (Task 8.1); `engine.status()`, `engine.scheduler.jobs()`, `engine.scheduler.blockedSince()` (WP7); `AirportsRepo.search` (WP3); the system schemas of the api-contract.

Rules (spec §10, §13): one public health route with two shapes (`healthResponseSchema` is the union): the `HEALTHCHECK` gets `{ ok, degraded }`; an authenticated caller gets the detail, which never includes the database path (`sizeBytes` is 0 for `:memory:`), and `healthy: null` per provider because health never calls a provider. Airports: up to 20 rows in the repository's prefix-on-IATA-then-city/name order. Providers: capabilities, plan, both usage windows, the zero-cap notice, the presets with core's refresh default. Budget: every provider window and the global one, the cap, the subscription fees counted once in it (spec §5.3) and a one-line ceiling note, money through `microGbpToPence` (decision 49).

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run to verify it fails**

Mutation: in `apps/api/src/routes/system.ts` change the health handler to `c.json(healthPublic(ctx))`.

Run: `pnpm --filter @gmt/api exec vitest run test/routes/system.test.ts`
Expected: FAIL, 1 of 8: `GET /api/health does not match the test schema` (the authenticated body has no `db`).

Revert the mutation.

- [ ] **Step 3: Implement**

Nothing beyond Task 8.1: the behaviour exists; this task's tests are what keep it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/system.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: health detail, airports, providers presets, budget and scheduler jobs tests"
```

### Task 8.9: Definitions CRUD, the plan-preset draft, cron validation, schedule sync and fit, both estimate routes, the coverage check, the confirmation rule

**Files:**
- Create: `apps/api/src/read/space.ts`, `src/read/definitions.ts`, `src/routes/definitions.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/definitions.test.ts`

**Interfaces:**
- Consumes: `DefinitionsRepo.create/update/get/list/softDelete/setConfirmed` (WP3, WP7 Task 7.13); `engine.estimate`, `engine.budgetFit`, `engine.coverageCheck`, `engine.scheduler.register/unregister`, `parseCron` (WP7); `resolveWindow`, `countCells`, `daysBetween`, `validateSearchSpace` (WP1); `PENCE_TO_MICRO`; `definitionCreateRequestSchema`, `definitionUpdateRequestSchema`, `definitionResponseSchema`, `estimateResponseSchema`, `coverageCheckRequestSchema`, `coverageCheckResponseSchema` (core).
- Produces: `isDraft`, `currentSpace`, `cellInSpace`, `airportLookup`, `definitionResponse`, `deletedResponse`, `needsConfirmation`, `confirmationRequired`, `covers`, `SOFT_CONFIRM_CALL_SHARE`, `mergeDefinition`, `inputOf`, `ZERO_BUDGET_FIT`, `syncSchedule`, `validateForSave`; routes `GET/POST /api/definitions`, `GET/PUT/DELETE /api/definitions/:id`, `POST /api/definitions/estimate`, `POST /api/definitions/:id/estimate`, `POST /api/definitions/coverage-check`.

**`POST /api/definitions` with no body** (spec §10, §8.2, §11): `201` with the response for a newly persisted **draft** built by `defaultDefinitionInput`: no airports, `enabled: false`, `confirmedCostPence` and `confirmedCalls` null, `estimate: null`, `budgetFit: { fits: true, runsPerMonth: 0, perScope: [] }`, `needsConfirmation: null`, `notices: [API_TEXT.draftNotice]`; no cron job is registered (Task 8.0 lets the stored shape hold it). A draft can be renamed or edited but not enabled (`422 draft_cannot_enable`), estimated (`422 draft_definition`) or run.

**Confirmation** (spec §7, decisions 25, 37, 42, 43): create and PUT bodies may carry `confirmedCostPence` and `confirmedCalls`, the operator's explicit confirmation. The route stores both with `DefinitionsRepo.setConfirmed(id, { pence, calls })` only when both are sent and both cover the current estimate (`pence × 10 000 ≥ totalCostMicroGbp` and `calls ≥ totalCalls`; the estimate is the engine's worst case without reuse, which a start compares against); otherwise nothing is stored. Nothing else writes them. `needsConfirmation` is `{ estimateMicroGbp, totalCalls, confirmedCostPence, confirmedCalls }` when a run needs a confirmation — the estimate above `SOFT_CONFIRM`, or one provider's runnable calls above 20% of its window cap (`SOFT_CONFIRM_CALL_SHARE`, the engine's share; §13) — and the stored one does not cover both; else `null`.

**Schedule** (spec §8.2, decision 25): cron is validated by the engine's `parseCron`, the sole validator (422 `invalid_cron` with `details.fields`); a save that turns a schedule on or changes it is refused with 422 `schedule_over_budget` while any `provider-month:` scope of the engine's `budgetFit` does not fit; create, PUT, disable, enable and delete (re)register the job in the same request.

**PUT** merges the update into the stored definition field by field (`mergeDefinition`: an absent field keeps its value, `null` is a value) and validates the merged definition, so a partial update cannot bypass a refinement. A malformed JSON body is a 400 `validation` envelope (Hono's `HTTPException` mapped by `onError`). A window resolving to zero cells is 422 `zero_cells`; the rest of `validateSearchSpace` is 422 `invalid_definition` with its fields.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/definitions.test.ts` (new file):

```ts
// Spec §8.2, §10 definitions CRUD, the plan-preset draft, cron validation, schedule sync, both estimate routes, the
// coverage check; the confirmation rule (spec §7, plan decisions 25, 37, 42, 43).
import { apiContract, asIata, asIsoDate, asIsoMonth, type Estimate } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { SENTINEL_TP } from '../helpers/env.js';
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

const DEF = apiContract.definitionResponseSchema;
const estimateOf = (totalCostMicroGbp: number, totalCalls = 10): Estimate => ({
  cells: 10,
  perProvider: [],
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
    const heavy: Estimate = {
      ...estimateOf(0, cap),
      perProvider: [
        {
          providerId: 'fixture',
          stage: 'discovery',
          calls: cap,
          planCalls: cap,
          costMicroGbp: 0,
          costPence: 0,
          seconds: 1,
          blocked: null,
        },
      ],
    };
    vi.spyOn(x.engine, 'estimate').mockReturnValue(heavy);
    const d = await create(x, exampleDefinitionInput());
    expect(d.needsConfirmation).toMatchObject({ estimateMicroGbp: 0, totalCalls: cap });
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
import {
  type apiContract,
  type BudgetFit,
  type DefinitionInput,
  type Estimate,
  PENCE_TO_MICRO,
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import type { RouteContext } from '../routes/types.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { isDraft } from './space.js';
import { windowScope } from './usage.js';

export type DefinitionResponse = z.infer<typeof apiContract.definitionResponseSchema>;

/** The budgetFit of a draft: nothing to search, nothing to fit. */
export const ZERO_BUDGET_FIT: BudgetFit = { fits: true, runsPerMonth: 0, perScope: [] };

/**
 * Decision 25: a run whose calls for one provider exceed this share of that provider's window cap asks for a
 * confirmation even when it costs nothing. why: the same share as WP7's pre-start check, so the form asks exactly when
 * a start would be refused with `confirm` (§13 asks WP7 to export its constant so one copy remains).
 */
export const SOFT_CONFIRM_CALL_SHARE = 0.2;

/** One explicit operator confirmation, as stored (`confirmed_cost_pence`, `confirmed_calls`). */
export interface Confirmation {
  pence: number | null;
  calls: number | null;
}

/** Decisions 37, 43: a confirmation covers an estimate only when both its pence and its calls suffice. */
export function covers(c: Confirmation, estimate: Estimate): boolean {
  return (
    c.pence !== null &&
    c.calls !== null &&
    c.pence * PENCE_TO_MICRO >= estimate.totalCostMicroGbp &&
    c.calls >= estimate.totalCalls
  );
}

/** Spec §8.1, decision 25: the estimate is above SOFT_CONFIRM, or one provider's runnable calls are a heavy share of its cap. */
export function confirmationRequired(estimate: Estimate, ports: Ports): boolean {
  if (estimate.totalCostMicroGbp > ports.config.spend.softConfirmMicroGbp) return true;
  const calls = new Map<ProviderId, number>();
  for (const p of estimate.perProvider)
    if (p.blocked === null) calls.set(p.providerId, (calls.get(p.providerId) ?? 0) + p.calls);
  return [...calls].some(([id, n]) => {
    const cap = ports.budget.usage(windowScope(ports.config, id)).cap;
    return cap !== null && n > SOFT_CONFIRM_CALL_SHARE * cap;
  });
}

/**
 * `needsConfirmation` (decision 42 shape): the estimate's cost and calls with the stored confirmation, when a run needs
 * one and the stored confirmation does not cover both; else null. Never writes the confirmation (spec §7).
 */
export function needsConfirmation(
  def: Pick<SearchDefinition, 'confirmedCostPence' | 'confirmedCalls'>,
  estimate: Estimate,
  ports: Ports,
): DefinitionResponse['needsConfirmation'] {
  if (!confirmationRequired(estimate, ports)) return null;
  if (covers({ pence: def.confirmedCostPence, calls: def.confirmedCalls }, estimate)) return null;
  return {
    estimateMicroGbp: estimate.totalCostMicroGbp,
    totalCalls: estimate.totalCalls,
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
  countCells,
  type DefinitionInput,
  type SearchDefinition,
  validateSearchSpace,
} from '@gmt/core';
import { parseCron } from '@gmt/engine';
import { defaultDefinitionInput } from '../defaults.js';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import {
  covers,
  definitionResponse,
  deletedResponse,
  inputOf,
  mergeDefinition,
} from '../read/definitions.js';
import { airportLookup, currentSpace, isDraft } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { getLiveDefinition, param, parseWith } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

/** The explicit confirmation a create or update body may carry (decisions 37, 42). */
interface SentConfirmation {
  confirmedCostPence?: number | undefined;
  confirmedCalls?: number | undefined;
}

/**
 * Spec §7, decisions 37 and 43: the stored confirmation is set only from an explicit operator value carrying both pence
 * and calls, and only when both cover the current estimate (the worst case without reuse that a start compares
 * against); otherwise nothing is stored and the response carries needsConfirmation.
 */
function applyConfirmation(
  def: SearchDefinition,
  sent: SentConfirmation,
  ctx: RouteContext,
): SearchDefinition {
  const { confirmedCostPence: pence, confirmedCalls: calls } = sent;
  if (pence === undefined || calls === undefined || isDraft(def)) return def;
  const estimate = ctx.engine.estimate(def, ctx.ports.clock.todayLondon());
  if (!covers({ pence, calls }, estimate)) return def;
  ctx.ports.repos.definitions.setConfirmed(def.id, { pence, calls });
  return { ...def, confirmedCostPence: pence, confirmedCalls: calls };
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
 * validator), drafts may not be enabled, then the contract shape, zero-cell windows (422, spec §6.1),
 * `validateSearchSpace` (airports, metro codes, nights, caps, alwaysInclude) and, when the save turns a schedule on or
 * changes it, the monthly fit of every provider-month scope (decision 25). Returns the parsed definition.
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
    const over = ctx.engine
      .budgetFit(def)
      .perScope.filter((s) => s.scope.startsWith('provider-month:') && !s.fits)
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
  'GET /api/definitions': (c, _input, ctx) =>
    c.json(ctx.ports.repos.definitions.list().map((d) => definitionResponse(d, ctx))),

  'POST /api/definitions': (c, input, ctx) => {
    // why: spec §10: no body creates the plan-aware default, a draft without airports.
    if (c.get('optionalBody')?.present !== true) {
      const draft = ctx.ports.repos.definitions.create(
        validateForSave(defaultDefinitionInput(ctx.ports.config, ctx.ports.providers), ctx, null),
      );
      return c.json(definitionResponse(draft, ctx), 201);
    }
    const { confirmedCostPence, confirmedCalls, ...def } = parseWith(
      apiContract.definitionCreateRequestSchema,
      input.body,
    );
    const created = applyConfirmation(
      ctx.ports.repos.definitions.create(validateForSave(def, ctx, null)),
      { confirmedCostPence, confirmedCalls },
      ctx,
    );
    syncSchedule(created, ctx);
    return c.json(definitionResponse(created, ctx), 201);
  },

  'POST /api/definitions/estimate': (c, input, ctx) => {
    const {
      confirmedCostPence: _p,
      confirmedCalls: _c,
      ...def
    } = parseWith(apiContract.definitionCreateRequestSchema, input.body);
    // why: the unsaved body is estimated, not scheduled, so its enabled flag and schedule fit do not matter here.
    validateForSave({ ...def, enabled: false }, ctx, null);
    return c.json(estimateResponse(def, ctx));
  },

  'GET /api/definitions/:id': (c, input, ctx) =>
    c.json(definitionResponse(getLiveDefinition(ctx, param(input, 'id')), ctx)),

  'PUT /api/definitions/:id': (c, input, ctx) => {
    const existing = getLiveDefinition(ctx, param(input, 'id'));
    const { confirmedCostPence, confirmedCalls, ...patch } = parseWith(
      apiContract.definitionUpdateRequestSchema,
      input.body,
    );
    const merged = validateForSave(mergeDefinition(inputOf(existing), patch), ctx, existing);
    const updated = applyConfirmation(
      ctx.ports.repos.definitions.update(existing.id, merged),
      { confirmedCostPence, confirmedCalls },
      ctx,
    );
    syncSchedule(updated, ctx);
    return c.json(definitionResponse(updated, ctx));
  },

  'DELETE /api/definitions/:id': (c, input, ctx) => {
    const existing = getLiveDefinition(ctx, param(input, 'id'));
    ctx.ports.repos.definitions.softDelete(existing.id);
    ctx.engine.scheduler.unregister(existing.id);
    return c.json(deletedResponse(existing, ctx));
  },

  'POST /api/definitions/:id/estimate': (c, input, ctx) => {
    const def = getLiveDefinition(ctx, param(input, 'id'));
    if (isDraft(def)) throw new ApiError(422, 'draft_definition', API_TEXT.draftNoEstimate);
    return c.json(estimateResponse(def, ctx));
  },

  'POST /api/definitions/coverage-check': async (c, input, ctx) => {
    // why: spec §10: the check runs free Travelpayouts month tiles and never calls a billed provider.
    if (!ctx.ports.providers.some((p) => p.id === 'travelpayouts'))
      throw new ApiError(409, 'coverage_check_unavailable', API_TEXT.coverageCheckUnavailable);
    return c.json(
      await ctx.engine.coverageCheck(parseWith(apiContract.coverageCheckRequestSchema, input.body)),
    );
  },
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

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/definitions.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 16 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: definitions CRUD, plan-preset draft, confirmation in pence and calls, cron and schedule-fit validation, estimates, coverage check"
```

### Task 8.10: Executions: start, read, cancel, resume; single-cell verify with membership validation

**Files:**
- Create: `apps/api/test/helpers/seed.ts`, `apps/api/src/read/executions.ts`, `src/routes/executions.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/executions.test.ts`

**Interfaces:**
- Consumes: `engine.start` (`StartOptions` with `confirmCostPence` and `confirmCalls`), `engine.resume/cancel/verifyCell`, `StartResult` (WP7); `ExecutionsRepo.get`, `CellsRepo.buckets/outcomes`, `LedgerRepo.countsFor`, `NotificationsRepo.wasSent` (WP3); `microGbpToPence`; `executionResponseSchema`, `startExecutionRequestSchema`, `startExecutionResponseSchema`, `verifyCellRequestSchema` (core).
- Produces: `executionResponse`, `executionSummary` (with the snapshot's `expandTop`, Task 8.0), `overrunOf`, `planCallsOf`, `OVERRUN_TOLERANCE`, `hoursSince`, `startError`; routes `POST /api/definitions/:id/executions`, `GET /api/executions/:id`, `POST /api/executions/:id/cancel`, `POST /api/executions/:id/resume`, `POST /api/cells/verify`; test-only `seeder(ports)` (`execution`, `cells`, `tile`, `tileError`, `reuse`, `verified`, `routeLowest`, `id`), `cell`, `at`.

HTTP mapping of `StartResult` (spec §8.1, §10): `ok` → `202 { executionId }` for start and verify, `200` with the execution for resume and cancel; `not_found` → 404; `active`, `cap`, `confirm`, `disabled` → 409 with the engine's code, message and details (URL-stripped); `window` → 422. A start passes `confirmCostPence` and `confirmCalls` through only when sent (decisions 37, 43). `/resume` always passes `{ manual: true }`. `/api/cells/verify` checks, in order: the definition exists (404), it has a verification provider (422 `no_verification_provider`), the cell is in the current resolved space (422 `cell_not_in_space`), both airports exist (422 `unknown_airport`); the engine enforces one active child per cell (409 `active`). Execution reads add `overrun` (spec §8.1: more than 10% above the stored estimate's pre-factor `planCalls`, discovery judged on distinct tiles and verification on calls, decision 43), `parityBreak` (the operator notification was sent) and `disabledProviders`.

`test/helpers/seed.ts` writes test data through WP3's atomic units (`writeTile`, `writeTileError`, `writeVerifiedCell`, `copyReused`), so route tests control every value while every repository invariant holds (synthetic gate, priced ⇔ price, roll-ups, unique keys); executions get generated ids, named in tests.

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
  type Cabin,
  type CellKey,
  type DefinitionSnapshot,
  daysBetween,
  type ExecutionStatus,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  londonDateOf,
  type NormalisedItinerary,
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
                booking: { kind: 'none' },
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
      repos.cells.writeVerifiedCell(id(name), PROVIDER, {
        cell: c,
        itineraries,
        outcome: {
          ...c,
          status: 'priced',
          reason: null,
          lastError: null,
          fetchedAt,
          minPence: Math.min(...offers.map((o) => o.pricePence)),
          cabin: CABIN,
          pointOfSale: POS,
          sourceKind: 'synthetic',
        },
      });
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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
async function harness(): Promise<Harness> {
  h = await createHarness();
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

  it('flags a discovery overrun on distinct tiles, never on calls (decision 43)', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    const id = s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    const plan = (planCalls: number) =>
      x.ports.repos.executions.patch(id, {
        estimate: {
          cells: 4,
          perProvider: [
            {
              providerId: 'fixture',
              stage: 'discovery',
              calls: planCalls,
              planCalls,
              costMicroGbp: 0,
              costPence: 0,
              seconds: 1,
              blocked: null,
            },
          ],
          totalCalls: planCalls,
          totalPlanCalls: planCalls,
          totalCostMicroGbp: 0,
          totalCostPence: 0,
          seconds: 1,
          assumptions: [],
          windowClamped: false,
          retryFactor: 1.2,
        },
      });
    const ledger = vi.spyOn(x.ports.repos.ledger, 'countsFor');
    const counts = (tiles: number, calls: number) => ({
      calls,
      costMicroGbp: 0,
      tiles,
      cacheHits: 0,
      perProvider: [
        {
          providerId: 'fixture' as const,
          stage: 'discovery' as const,
          calls,
          costMicroGbp: 0,
          tiles,
          cacheHits: 0,
        },
      ],
    });
    plan(10);
    ledger.mockReturnValue(counts(10, 30)); // why: a paged tile spends a call a page; 10 tiles as planned is no overrun
    expect((await execution(x, id)).overrun).toBe(false);
    ledger.mockReturnValue(counts(12, 12));
    expect((await execution(x, id)).overrun).toBe(true);
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
/** Whole hours from `from` to `now`, never negative. */
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
import { getLiveDefinition, param, parseWith } from './shared.js';
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
  if (e === null) throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound(id));
  return e;
}

/** `startExecutionResponseSchema` for start and verify (202). */
function accepted(c: Context<AppEnv>, r: StartResult) {
  if (!r.ok) throw startError(r);
  return c.json({ executionId: r.executionId }, 202);
}

export const executionHandlers: HandlerTable = {
  'POST /api/definitions/:id/executions': async (c, input, ctx) => {
    const def = getLiveDefinition(ctx, param(input, 'id'));
    const body = parseWith(apiContract.startExecutionRequestSchema, input.body);
    // why: decisions 37, 43: a manual start passes the pence and the calls the operator saw; the engine compares both.
    return accepted(
      c,
      await ctx.engine.start(def.id, {
        trigger: 'manual',
        ...(body.confirmCostPence === undefined ? {} : { confirmCostPence: body.confirmCostPence }),
        ...(body.confirmCalls === undefined ? {} : { confirmCalls: body.confirmCalls }),
      }),
    );
  },

  'GET /api/executions/:id': (c, input, ctx) =>
    c.json(executionResponse(ctx.ports, getExecution(ctx, param(input, 'id')))),

  'POST /api/executions/:id/cancel': async (c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    if (!(await ctx.engine.cancel(e.id)))
      throw new ApiError(409, 'not_cancellable', API_TEXT.notCancellable(e.status));
    return c.json(executionResponse(ctx.ports, getExecution(ctx, e.id)));
  },

  'POST /api/executions/:id/resume': async (c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    // why: the API's resume is the operator's manual resume (spec §8.1): it re-enables disabled providers.
    const r = await ctx.engine.resume(e.id, { manual: true });
    if (!r.ok) throw startError(r);
    return c.json(executionResponse(ctx.ports, getExecution(ctx, r.executionId)));
  },

  'POST /api/cells/verify': async (c, input, ctx) => {
    const body = parseWith(apiContract.verifyCellRequestSchema, input.body);
    const def = getLiveDefinition(ctx, body.definitionId);
    if (def.providers.verification.length === 0)
      throw new ApiError(422, 'no_verification_provider', API_TEXT.noVerificationProvider);
    if (!cellInSpace(currentSpace(def, ctx.ports.clock.todayLondon()), body.cell))
      throw new ApiError(422, 'cell_not_in_space', API_TEXT.cellNotInSpace, { cell: body.cell });
    for (const code of [body.cell.origin, body.cell.destination]) {
      if (!ctx.ports.repos.airports.exists(code))
        throw new ApiError(422, 'unknown_airport', API_TEXT.unknownAirport(code));
    }
    return accepted(c, await ctx.engine.verifyCell(def.id, body.cell));
  },
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
Expected: PASS, 18 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: executions start/read/cancel/resume with confirmation calls, overrun on tiles, single-cell verify with membership"
```

### Task 8.11: Results (spec §6.5, §6.9, §8.1): basis, dedup, ranking, cap, staleness, truncation, `notSeenInLatest`, children, excluded rows

**Files:**
- Create: `apps/api/src/read/rows.ts`, `src/read/coverage.ts`, `src/read/results.ts`, `src/routes/results.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/results.test.ts`

**Interfaces:**
- Consumes: `ItinerariesRepo.observationsForDefinition`, `ItinerariesRepo.latestVerificationOutcomeForCell`, `CalendarPricesRepo.latestPerCell(definitionId, cabin, null)`, `ExecutionsRepo.listForDefinition`, `CellsRepo.rollUps/outcomes/selected` (WP3); `evaluateConstraints`, `verdictClass`, `unverifiedNames`, `dedupByItinerary`, `rankRows`, `searchLinkFor`, `effectiveAge`, `worstCaseAgeHours`, `isTruncated`, `TRUNCATED_NOTE`, `DEFAULT_DISCOVERY_REFRESH_HOURS` (core).
- Produces: `staleness`, `calendarThreshold`, `calendarStaleAfterHours`, `thresholdFor`, `priceCell`, `priceOf`, `verifiedRow`, `calendarRow`, `configuredConstraints`, `latestPerOffer`, `notSeenResolver`, `cheapest`, `withNights`, `coverageSummaryFor`, `SEARCHED`, `loadRows`, `truncationOf`, `confirmedIn`, `discoveryProviders`, `chooseBasis`, `assembleResults`, `RESULTS_CAP`; route `GET /api/definitions/:id/results`.

Assembly rules, each pinned by a test below:

1. Rows come from **every** execution of the definition, children included (spec §8.1), or from one execution when `executionId` is given (404 for a foreign one); observations and calendar prices are read in the definition's current cabin.
2. Each offer contributes its latest observation (max `fetchedAt`, tie on id); verdicts are evaluated now against the **current** constraints and requested cabin with the observation's stored supplied fields (spec §6.2).
3. Rows outside the current resolved space are dropped and counted in `excludedByCurrentSpace` (the repositories are read with `space: null` so the count is possible); when that count is non-zero, `basisReason` ends with "· I of N rows are inside the current window and nights range" (review focus 4). An all-excluded verified basis stays verified, so the reason says why the table is empty.
4. Default basis (spec §6.9): `calendar` when the latest parent's snapshot (or, with none, the definition) has no verification provider, or no observation exists; otherwise `verified`. `basisReason` says which; `verificationProviderConfigured` reports the current definition.
5. Verified basis: `dedupByItinerary(rows, now)` then `rankRows(rows, now)`; **all classes are returned**, `failed` last; `cheapest` is the first ranked row (the Results headline).
6. Calendar basis: the latest price per (provider, cell), reused copies ignored, class `unchecked` (assigned directly: `verdictClass` throws without a cabin verdict), `notApplied` = every configured constraint, `booking: none`, a search link (`null` for synthetic rows).
7. **Staleness** (spec §3 and §8.1 at revision 23, decision 44): `ageHours` is the effective age — the observed age, else the fetch age plus a known `maxAgeHours`, else the fetch age alone; a price is stale only when its fetch age plus its **known** `maxAgeHours` exceeds the threshold (`STALE_AFTER_HOURS` for the verified basis; for the calendar basis `CALENDAR_STALE_AFTER_HOURS`, else the discovery refresh plus the provider's declared age). An unknown vendor age is never stale on that account; the web labels it "vendor's cache age unknown" from `provenance.maxAgeHours`, and its stale banner counts only rows stale by a known age. Stale rows are returned, never hidden.
8. **Truncation** (decisions 36, 47): a calendar price is `truncated` when its discovery outcome's `last_error` starts with `TRUNCATED_NOTE`, read with core's `isTruncated`; itinerary rows are never truncated.
9. Cheapest per cell is computed here from recomputed verdicts, never read from `search_cells.best_observation_id`.
10. `notSeenInLatest`: the cell's newest `priced | empty` verification outcome is from another execution in which this offer has no observation → `{ ageHours }` of that newer search.
11. At most `limit` rows (default and maximum 1000); `total` counts every row before the cut; `truncated = total > limit`.

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
  });
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
/** Result rows of both bases, prices with provenance, staleness and truncation (spec §6.2, §6.9, §8.1). */
import {
  type apiContract,
  type CellKey,
  type CellOutcome,
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
  type Provenance,
  type ProviderId,
  type SearchDefinition,
  searchLinkFor,
  unverifiedNames,
  verdictClass,
  worstCaseAgeHours,
} from '@gmt/core';
import type { CalendarPriceRow, ObservationRow } from '@gmt/db';
import type { z } from 'zod';
import { hoursSince } from './executions.js';

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
 * Spec §3 and §8.1 at revision 23 (plan decision 44). `ageHours` is the effective age: the observed age when the vendor
 * dates the price, else the fetch age plus the vendor's declared `maxAgeHours`, else (`'unknown'`) the fetch age alone;
 * the web labels the last case "vendor's cache age unknown" from `provenance.maxAgeHours`. A price is stale only when
 * its known age (fetch age plus a known `maxAgeHours`) exceeds the threshold, so an unknown vendor age never marks it
 * stale on that account.
 */
export function staleness(
  p: Provenance,
  thresholdHours: number,
  now: IsoDateTime,
): { ageHours: number; stale: boolean } {
  const age = effectiveAge(p, now);
  const known = p.maxAgeHours === 'unknown' ? 0 : p.maxAgeHours;
  const worst = worstCaseAgeHours(age);
  return {
    ageHours: worst === 'unknown' ? age.fetchedHours : worst,
    stale: age.fetchedHours + known > thresholdHours,
  };
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

/** Every constraint an operator can set (spec §6.2), in the order the web lists them. */
const CONSTRAINT_NAMES: readonly ConstraintName[] = [
  'maxStops',
  'maxJourneyMinutes',
  'minLayoverMinutes',
  'maxLayoverMinutes',
  'noOvernightLayover',
  'departureWindowLocal',
  'arrivalWindowLocal',
  'noSelfTransfer',
  'noAirportChange',
  'includeAirlines',
  'excludeAirlines',
  'cabinBagRequired',
  'checkedBagRequired',
  'minCheckedBags',
  'maxPricePence',
];

/** Constraints the operator set; on calendar rows these are "not applied" (spec §6.9). */
export function configuredConstraints(c: Constraints): ConstraintName[] {
  const set: ConstraintName[] = [];
  for (const [k, v] of Object.entries(c)) {
    const name = CONSTRAINT_NAMES.find((n) => n === k);
    if (name !== undefined && v !== undefined) set.push(name);
  }
  return set;
}

function adjusted(
  def: SearchDefinition,
  destination: CellKey['destination'],
  pricePence: number,
): number | null {
  const onward = def.onwardCostPence[destination];
  return onward === undefined ? null : pricePence + onward; // why: a separate column, never merged into price (spec §11)
}

/** Spec §6.9 calendar-basis row; `truncated` from the cell's discovery outcome (decisions 36, 47). */
export function calendarRow(r: CalendarPriceRow, rc: RowContext, truncated: boolean): ResultRow {
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
    searchLink: searchLinkFor(r.providerId, r.cell, rc.def.cabin),
    otherOffers: [],
    notSeenInLatest: null,
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
  notSeenInLatest: { ageHours: number } | null,
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
    booking: o.booking,
    searchLink: searchLinkFor(o.offer.providerId, o.cell, rc.def.cabin),
    otherOffers: [],
    notSeenInLatest,
    adjustedPence: adjusted(rc.def, it.destination, o.pricePence),
    destinationNote: rc.def.destinationNotes[it.destination] ?? null,
    executionId: o.executionId,
    calendarPriceId: null,
    observationId: o.id,
  };
}

/** The cheapest row, or null. */
export function cheapest(rows: readonly ResultRow[]): ResultRow | null {
  let best: ResultRow | null = null;
  for (const r of rows) if (best === null || r.pricePence < best.pricePence) best = r;
  return best;
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
  return (r: ObservationRow): { ageHours: number } | null => {
    const key = cellKeyString(r.cell);
    let latest = cache.get(key);
    if (latest === undefined) {
      latest = latestOutcome(r.cell);
      cache.set(key, latest);
    }
    if (latest === null || (latest.status !== 'priced' && latest.status !== 'empty')) return null;
    if (latest.executionId === r.executionId || seen.has(`${latest.executionId}|${r.offer.id}`)) return null;
    return { ageHours: hoursSince(latest.fetchedAt ?? now, now) };
  };
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
  type ProviderId,
  type ResolvedSpace,
  rankRows,
  type SearchDefinition,
} from '@gmt/core';
import type { CalendarPriceRow } from '@gmt/db';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
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
): (r: Pick<CalendarPriceRow, 'executionId' | 'providerId' | 'cell'>) => boolean {
  const byExecution = new Map<string, Map<string, CellOutcome>>();
  return (r) => {
    let outcomes = byExecution.get(r.executionId);
    if (outcomes === undefined) {
      outcomes = new Map(
        ports.repos.cells
          .outcomes(r.executionId, { stage: 'discovery' })
          .map((o) => [`${o.providerId}|${cellKeyString(o)}`, o]),
      );
      byExecution.set(r.executionId, outcomes);
    }
    return isTruncated(outcomes.get(`${r.providerId}|${cellKeyString(r.cell)}`)?.lastError ?? null);
  };
}

/** Everything the read routes share: rows of both bases for the definition's current space and cabin. */
export function loadRows(def: SearchDefinition, ports: Ports, executionId?: string): Loaded {
  const now = ports.clock.now();
  const space = currentSpace(def, ports.clock.todayLondon());
  const all = ports.repos.executions.listForDefinition(def.id, {
    limit: EXECUTIONS_LIMIT,
    includeChildren: true,
  });
  const scoped = executionId === undefined ? all : all.filter((e) => e.id === executionId);
  if (executionId !== undefined && scoped.length === 0)
    throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound(executionId));
  const ids = new Set(scoped.map((e) => e.id));
  const rc: RowContext = { def, now, config: ports.config, providers: ports.providers };

  // why: space null reads every cell, so rows outside the current space can be counted (review focus 4).
  const raw = ports.repos.itineraries.observationsForDefinition(def.id, {
    executionIds: [...ids],
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

  const calendarAll = ports.repos.calendarPrices
    .latestPerCell(def.id, def.cabin, null)
    .filter((r) => ids.has(r.executionId) && r.reusedFromExecutionId === null);
  const calendarIn = calendarAll.filter((r) => cellInSpace(space, r.cell));
  const truncated = truncationOf(ports);

  return {
    def,
    space,
    rc,
    all,
    scoped,
    latestParent: all.find((e) => !e.isChild) ?? null,
    verified: inSpace.map((o) => verifiedRow(o, rc, notSeen(o))),
    unconfirmed: new Set(inSpace.filter((o) => !o.suppliedFields.includes('price')).map((o) => o.id)),
    calendar: calendarIn.map((r) => calendarRow(r, rc, truncated(r))),
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

/** The discovery providers of the rows' definition, for per-provider series. */
export function discoveryProviders(loaded: Loaded): ProviderId[] {
  return [
    ...new Set([...loaded.def.providers.discovery, ...loaded.calendar.map((r) => r.provenance.providerId)]),
  ];
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
  const loaded = loadRows(def, ports, q.executionId);
  const { basis, reason } = chooseBasis(loaded, q.basis);
  const ranked = rankRows(
    basis === 'verified' ? dedupByItinerary(loaded.verified, loaded.rc.now) : loaded.calendar,
    loaded.rc.now,
  );
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
    coverage: coverageSummaryFor(loaded.latestParent, loaded.all, ports),
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
import { getLiveDefinition, param, parseWith } from './shared.js';
import type { HandlerTable } from './types.js';

export const resultHandlers: HandlerTable = {
  'GET /api/definitions/:id/results': (c, input, ctx) =>
    c.json(
      assembleResults(
        getLiveDefinition(ctx, param(input, 'id')),
        parseWith(apiContract.resultsQuerySchema, input.query, 'query'),
        ctx.ports,
      ),
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
Expected: PASS, 15 tests (with the execution summary's `expandTop`, decision 42); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: results: basis, dedup, class-then-price ranking, cap, staleness by fetch age, truncation, notSeenInLatest, excluded rows"
```

### Task 8.12: Calendar, duration analysis, coverage, calendar gap, cell detail

**Files:**
- Create: `apps/api/src/read/calendar.ts`, `src/read/duration.ts`, `src/read/coverageView.ts`, `src/read/cell.ts`
- Modify: `apps/api/src/routes/results.ts` (replace the file)
- Test: `apps/api/test/routes/views.test.ts`

**Interfaces:**
- Consumes: `loadRows`, `confirmedIn`, `discoveryProviders`, `priceOf`, `withNights`, `cheapest`, `calendarStaleAfterHours` (Task 8.11); `overrunOf`, `planCallsOf`, `executionResponse` (Task 8.10); `CellsRepo.bucketsPerDay/outcomes/rollUps/selected`, `LedgerRepo.countsFor`, `NotificationsRepo.wasSent` (WP3); `engine.scheduler.blockedSince()`, `engine.childCapPreview` (WP7); `selectedNotReached`, `addDays`, `daysBetween`, `dedupByItinerary` (core).
- Produces: `assembleCalendar`, `assembleCalendarGap`, `assembleDuration`, `assembleCoverage`, `retryable`, `assembleCellDetail`; routes `GET /api/definitions/:id/calendar`, `/duration-analysis`, `/coverage`, `/calendar-gap`, `/cells/:origin/:destination/:departureDate/:returnDate`.

Rules: every view reads the same rows as `/results` and dedups itinerary-searched rows per itinerary before counting. Calendar days cover every departure date of the current window; six-bucket counts, selection and coverage come from the **latest parent** execution, completed children counted per day as "on demand". `cheapestVerified` uses class `verified` only; `cheapestPartiallyVerified` carries its `count`; `verification.unconfirmedCells` counts the day's selected cells whose itinerary search priced but confirmed no price (decision 51), over every destination; neither minimum, nor duration's `minVerified`, nor the calendar gap's minimum, ever uses a price the final step did not confirm (decisions 45, 48: a verified-basis view never shows an unconfirmed fare as the itinerary-search price). A priced verification roll-up with a null price counts as itinerary-searched and contributes no price. The calendar response reports `staleAfterHours` and per discovery provider `calendarStaleAfterHours`.

Duration (plan decision 38, WP10 §13): each minimum carries its `cell`; `n` counts the cells of that nights value with a class-verified confirmed price (verified) or that the provider priced (calendar); `searched` is per series — `verification` is true when any verification outcome of that nights value, in the latest parent or a completed child, is priced, empty or no_data, and each discovery provider of the definition by the same rule over its own outcomes in the latest parent.

Coverage (View D) is the latest parent's; before the first run it is 404 `no_execution` (the contract names one execution). `perStage` rows carry their ledger counts, the pre-factor `planCalls`, `overrun` (decision 43: discovery on tiles) and `parityBreak`; `errors[].retryable` is what a manual resume would pick up (WP3's resume query): `auth`, `quota`, `parse` always; other reasons while `attempts < 3`, except the deterministic `no-return-legs`, `no-priced-options`, `fx-unavailable`, `currency-unsupported`, `unknown-airport-tz`.

Cell detail: outcomes per execution × stage × provider passed as stored (a priced verification outcome with a null `minPence` is the web's "price not confirmed", decision 48), calendar prices with `truncated`, observations as rows, and `verify` from `Engine.childCapPreview(definitionId, cell)` — the same sizing the child gets (decisions 42, 45, 48) — or null without a verification provider or for a cell outside the current space.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/views.test.ts` (new file):

```ts
// Spec §10 calendar, duration analysis, coverage, calendar gap and cell detail (Views B, C, D and the side panel).
import { apiContract, daysBetween } from '@gmt/core';
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
  it('per day: six buckets per provider, selection, the three cheapest, byDestination, stale thresholds', async () => {
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
    expect(
      day('2026-11-02')?.byDestination.map((b) => [
        b.destination,
        b.cheapestVerified?.pricePence,
        b.cheapestCalendar?.pricePence,
      ]),
    ).toEqual([['JFK', 60_000, 45_000]]);
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
    expect(ten?.searched).toEqual({
      verification: true,
      discovery: [{ providerId: 'fixture', searched: true }],
    });
    expect(d.byNights[1]).toMatchObject({
      nights: 11,
      minVerified: null,
      minCalendar: [],
      searched: { verification: false, discovery: [{ providerId: 'fixture', searched: false }] },
    });
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
      .mockReturnValue({ maxCalls: 6, headroomCalls: 994 });
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
  type Buckets,
  cellKeyString,
  dedupByItinerary,
  type IsoDate,
  type ProviderId,
  type RollUp,
  type SearchDefinition,
  type Stage,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import { confirmedIn, discoveryProviders, loadRows } from './results.js';
import { calendarStaleAfterHours, cheapest, priceOf, type ResultRow } from './rows.js';

type DayBuckets = Array<{ stage: Stage; providerId: ProviderId; buckets: Buckets; total: number }>;

export type CalendarResponse = z.infer<typeof apiContract.calendarResponseSchema>;
export type CalendarGapResponse = z.infer<typeof apiContract.calendarGapResponseSchema>;

/**
 * Spec §10 `GET /calendar`: one entry per departure date of the current window. Six-bucket counts, selection and
 * coverage come from the latest parent execution (children are excluded from "latest execution", spec §8.1); completed
 * children count per day as "on demand". `cheapestVerified` is class verified only; `cheapestPartiallyVerified` skips
 * prices the final step did not confirm (decisions 45, 48); `unconfirmedCells` counts the day's selected cells whose
 * itinerary search priced but confirmed no price (decision 51), over every destination: the day-level count cannot
 * follow the web's destination filter (§13).
 */
export function assembleCalendar(def: SearchDefinition, ports: Ports): CalendarResponse {
  const loaded = loadRows(def, ports);
  const parent = loaded.latestParent;
  const perDay =
    parent === null ? new Map<IsoDate, DayBuckets>() : ports.repos.cells.bucketsPerDay(parent.id);
  const rollUps =
    parent === null
      ? new Map<string, { discovery: RollUp; verification: RollUp }>()
      : ports.repos.cells.rollUps(parent.id);
  const selected = parent === null ? [] : ports.repos.cells.selected(parent.id);
  const children = loaded.all.filter((e) => e.isChild && e.status === 'completed');
  const confirmed = confirmedIn(loaded);
  const verified = dedupByItinerary(loaded.verified, loaded.rc.now).filter(confirmed);
  // why: decisions 45, 48, 51: a cell whose itinerary search priced but whose final step confirmed no price has no
  // itinerary-search price; the day counts such cells so the web can say "price not confirmed" without outcome reasons.
  const confirmedCells = new Set(loaded.verified.filter(confirmed).map((r) => cellKeyString(r.cell)));
  const days: CalendarResponse['days'] = [];
  for (let d = loaded.space.departureFrom; d <= loaded.space.departureTo; d = addDays(d, 1)) {
    const onDay = (r: ResultRow) => r.cell.departureDate === d;
    const v = verified.filter(onDay);
    const cal = loaded.calendar.filter(onDay);
    const partial = v.filter((r) => r.verdictClass === 'partially-verified');
    const best = cheapest(v.filter((r) => r.verdictClass === 'verified'));
    const bestPartial = cheapest(partial);
    const bestCal = cheapest(cal);
    const sel = selected.filter(({ cell }) => cell.departureDate === d);
    days.push({
      date: d,
      discovery: (perDay.get(d) ?? [])
        .filter((p) => p.stage === 'discovery')
        .map(({ providerId, buckets, total }) => ({ providerId, buckets, total })),
      verification: {
        selected: sel.length,
        itinerarySearched: sel.filter(({ cell }) => {
          const s = rollUps.get(cellKeyString(cell))?.verification.status ?? null;
          return s !== null && SEARCHED.has(s);
        }).length,
        onDemand: children.filter((e) => e.cell?.departureDate === d).length,
        unconfirmedCells: sel.filter(({ cell }) => {
          const key = cellKeyString(cell);
          return rollUps.get(key)?.verification.status === 'priced' && !confirmedCells.has(key);
        }).length,
      },
      cheapestVerified:
        best === null || best.itineraryHash === null
          ? null
          : { ...priceOf(best), cell: best.cell, itineraryHash: best.itineraryHash },
      cheapestPartiallyVerified:
        bestPartial === null || bestPartial.itineraryHash === null
          ? null
          : {
              ...priceOf(bestPartial),
              cell: bestPartial.cell,
              itineraryHash: bestPartial.itineraryHash,
              count: partial.length,
            },
      cheapestCalendar: bestCal === null ? null : { ...priceOf(bestCal), cell: bestCal.cell },
      byDestination: def.destinations.map((destination) => {
        const dv = cheapest(
          v.filter((r) => r.verdictClass === 'verified' && r.cell.destination === destination),
        );
        const dc = cheapest(cal.filter((r) => r.cell.destination === destination));
        return {
          destination,
          cheapestVerified: dv === null ? null : priceOf(dv),
          cheapestCalendar: dc === null ? null : priceOf(dc),
        };
      }),
    });
  }
  const calendarStale: Partial<Record<ProviderId, number>> = {};
  for (const id of discoveryProviders(loaded)) calendarStale[id] = calendarStaleAfterHours(loaded.rc, id);
  return {
    days,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    staleAfterHours: ports.config.staleAfterHours,
    calendarStaleAfterHours: calendarStale,
  };
}

/**
 * Spec §10 `GET /calendar-gap`: calendar prices below the cheapest class-verified, confirmed price; empty without a
 * verification provider. why: search_cells.best_observation_id is the cheapest observation written, not the cheapest
 * class-verified one, so the minimum is computed at read time (plan round-2 pin).
 */
export function assembleCalendarGap(def: SearchDefinition, ports: Ports): CalendarGapResponse {
  if (def.providers.verification.length === 0) return { cheapestVerified: null, cells: [] };
  const loaded = loadRows(def, ports);
  const best = cheapest(
    loaded.verified.filter((r) => r.verdictClass === 'verified').filter(confirmedIn(loaded)),
  );
  if (best === null || best.itineraryHash === null) return { cheapestVerified: null, cells: [] };
  const below = loaded.calendar
    .filter((r) => r.pricePence < best.pricePence)
    .sort((a, b) => a.pricePence - b.pricePence);
  return {
    cheapestVerified: { ...priceOf(best), cell: best.cell, itineraryHash: best.itineraryHash },
    cells: below.map((r) => ({ cell: r.cell, calendar: priceOf(r), verifyAvailable: true })),
  };
}
```

`apps/api/src/read/duration.ts` (new file):

```ts
/** Spec §10 `/duration-analysis` (View C). */
import {
  type apiContract,
  type CellOutcome,
  daysBetween,
  dedupByItinerary,
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import { confirmedIn, discoveryProviders, loadRows } from './results.js';
import { cheapest, priceOf, type ResultRow } from './rows.js';
import { cellInSpace } from './space.js';

export type DurationResponse = z.infer<typeof apiContract.durationAnalysisResponseSchema>;

const cellsOf = (rows: readonly ResultRow[]): number =>
  new Set(
    rows.map((r) => `${r.cell.departureDate}|${r.cell.returnDate}|${r.cell.origin}|${r.cell.destination}`),
  ).size;

/**
 * Spec §10 `GET /duration-analysis`: per nights value, no interpolation (absent → null / []). Each minimum carries its
 * cell; `n` counts the cells of that nights value with a class-verified confirmed price (verified) or that the provider
 * priced (calendar). `searched` is per series (plan decision 38, WP10 §13): verification is true when any verification
 * outcome of that nights value, in the latest parent or a completed child, is priced, empty or no_data; each discovery
 * provider of the definition by the same rule over its own outcomes in the latest parent.
 */
export function assembleDuration(def: SearchDefinition, ports: Ports): DurationResponse {
  const loaded = loadRows(def, ports);
  const verified = dedupByItinerary(loaded.verified, loaded.rc.now)
    .filter((r) => r.verdictClass === 'verified')
    .filter(confirmedIn(loaded));
  const providers = discoveryProviders(loaded);
  const parent = loaded.latestParent;
  const sources = [
    ...(parent === null ? [] : [parent]),
    ...loaded.all.filter((e) => e.isChild && e.status === 'completed'),
  ];
  const outcomes: CellOutcome[] = sources
    .flatMap((e) => ports.repos.cells.outcomes(e.id))
    .filter((o) => SEARCHED.has(o.status) && cellInSpace(loaded.space, o));
  const searched = (nights: number, keep: (o: CellOutcome) => boolean) =>
    outcomes.some((o) => keep(o) && daysBetween(o.departureDate, o.returnDate) === nights);
  const byNights: DurationResponse['byNights'] = [];
  for (let n = def.minNights; n <= def.maxNights; n++) {
    const v = verified.filter((r) => r.cell.nights === n);
    const best = cheapest(v);
    byNights.push({
      nights: n,
      minVerified: best === null ? null : { ...priceOf(best), cell: best.cell, n: cellsOf(v) },
      minCalendar: providers.flatMap((providerId: ProviderId) => {
        const rows = loaded.calendar.filter(
          (r) => r.cell.nights === n && r.provenance.providerId === providerId,
        );
        const b = cheapest(rows);
        return b === null ? [] : [{ providerId, price: { ...priceOf(b), cell: b.cell }, n: cellsOf(rows) }];
      }),
      searched: {
        verification: searched(n, (o) => o.stage === 'verification'),
        discovery: def.providers.discovery.map((providerId) => ({
          providerId,
          searched: searched(
            n,
            (o) => o.stage === 'discovery' && o.providerId === providerId && o.executionId === parent?.id,
          ),
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
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
import { executionResponse, overrunOf, planCallsOf } from './executions.js';
import { withNights } from './rows.js';

export type CoverageResponse = z.infer<typeof apiContract.coverageResponseSchema>;
/** Reasons a manual resume re-admits (spec §7 Resume; WP3's resume query). */
const MANUAL_RETRY = new Set(['auth', 'quota', 'parse']);
/** Deterministic failures no resume retries (spec §7 Resume; decision 37 adds `no-priced-options`). */
const NEVER_RETRY = new Set([
  'no-return-legs',
  'no-priced-options',
  'fx-unavailable',
  'currency-unsupported',
  'unknown-airport-tz',
]);

/** What a manual resume would pick up again (spec §7 Resume, WP3's resume query with `manual`). */
export function retryable(o: Pick<CellOutcome, 'reason' | 'attempts'>): boolean {
  const reason = o.reason ?? '';
  if (MANUAL_RETRY.has(reason)) return true;
  return o.attempts < 3 && !NEVER_RETRY.has(reason);
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
import { cellInSpace } from './space.js';

export type CellDetailResponse = z.infer<typeof apiContract.cellDetailResponseSchema>;

/**
 * Spec §10 cell route: outcomes per execution × stage × provider, prices with provenance, the observations as rows.
 * `verify` is what a per-cell verify would spend now, from `Engine.childCapPreview` (the same sizing the child gets,
 * decisions 42, 45, 48); null without a verification provider or for a cell outside the current space. A priced
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
  const canVerify = def.providers.verification.length > 0 && cellInSpace(loaded.space, target);
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
            },
          ],
    ),
    observations: loaded.verified.filter(onCell),
    verify: canVerify ? engine.childCapPreview(def.id, target) : null,
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
import { getLiveDefinition, param, parseWith } from './shared.js';
import type { HandlerTable, RouteInput } from './types.js';

/** Path parameters of the cell route; the route declares no params schema, so they are validated here. */
function cellFromPath(input: RouteInput): CellKey {
  const o = iataSchema.safeParse(param(input, 'origin'));
  const d = iataSchema.safeParse(param(input, 'destination'));
  const dep = isoDateSchema.safeParse(param(input, 'departureDate'));
  const ret = isoDateSchema.safeParse(param(input, 'returnDate'));
  if (!o.success || !d.success || !dep.success || !ret.success)
    throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return { origin: o.data, destination: d.data, departureDate: dep.data, returnDate: ret.data };
}

export const resultHandlers: HandlerTable = {
  'GET /api/definitions/:id/results': (c, input, ctx) =>
    c.json(
      assembleResults(
        getLiveDefinition(ctx, param(input, 'id')),
        parseWith(apiContract.resultsQuerySchema, input.query, 'query'),
        ctx.ports,
      ),
    ),
  // why: the calendar route takes no query (plan API contract): both bases come back per day and the client colours by one (spec §11).
  'GET /api/definitions/:id/calendar': (c, input, ctx) =>
    c.json(assembleCalendar(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  'GET /api/definitions/:id/duration-analysis': (c, input, ctx) =>
    c.json(assembleDuration(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  'GET /api/definitions/:id/coverage': (c, input, ctx) =>
    c.json(assembleCoverage(getLiveDefinition(ctx, param(input, 'id')), ctx.ports, ctx.engine)),
  'GET /api/definitions/:id/calendar-gap': (c, input, ctx) =>
    c.json(assembleCalendarGap(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  'GET /api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate': (c, input, ctx) =>
    c.json(
      assembleCellDetail(
        getLiveDefinition(ctx, param(input, 'id')),
        cellFromPath(input),
        ctx.ports,
        ctx.engine,
      ),
    ),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/views.test.ts && pnpm --filter @gmt/api typecheck`
Expected: PASS, 11 tests; `test/routes/results.test.ts` still passes; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: calendar, duration analysis with per-series searched, coverage, calendar gap and cell detail with verify"
```

### Task 8.13: History routes and alert rule storage

**Files:**
- Create: `apps/api/src/read/history.ts`, `src/routes/history.ts`, `src/routes/alerts.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/test/routes/history.test.ts`, `apps/api/test/routes/alerts.test.ts`

**Interfaces:**
- Consumes: `ItinerariesRepo.offerHistory` (with Task 8.0's `suppliedFields`), `CalendarPricesRepo.history`, `RoutePriceHistoryRepo.series`, `DefinitionsRepo.list`, `AlertsRepo` (WP3); `staleness`, `calendarThreshold`, `truncationOf` (Task 8.11); `itineraryHistoryResponseSchema`, `routeHistoryResponseSchema`, `routeHistoryQuerySchema`, `alertRuleInputSchema`, `alertRuleUpdateRequestSchema`, `alertEventsQuerySchema`, `iataSchema` (core).
- Produces: `itineraryHistory`, `routeHistory`; routes `GET /api/itineraries/:hash/history`, `GET /api/routes/:origin/:destination/history`, `GET/POST /api/alerts`, `PUT/DELETE /api/alerts/:id`, `GET /api/alerts/events`.

Rules (spec §7, §10, §11; decisions 36, 38, 42, 44): itinerary history is one series per (provider, seller, cabin); each point carries `stale` (verified-basis rule), `truncated: false` and `priceConfirmed` (`price` among the observation's supplied fields). Route history is the calendar series per provider in the requested cabin (`?cabin=`, default economy), one point per execution fetch carrying its `cell` and `executionId` (reused rows excluded by the repository), each with `stale` by the calendar rule (the refresh of a live definition flying the pair, else core's default) and `truncated` from its discovery outcome; plus the route-level lowest-price series per provider for the requested cabin and `'unknown'`, plotted by `date` (empty when the vendor supplies none, decision 40). Alert routes store and read rules and events only; evaluation and delivery are WP11. `DELETE /api/alerts/:id` soft-deletes (events kept). `GET /api/alerts` filters by `?definitionId=` (the ROUTES query schema); `GET /api/alerts/events` by `ruleId` and `definitionId`. A PUT is validated on the merged rule, so the `requireAllVerified` refinement (spec §6.8) cannot be bypassed by a partial update.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/history.test.ts` (new file):

```ts
// Spec §10, §7 history routes: provenance, staleness, truncation and confirmation on every point (decisions 36, 38, 42, 44).
import { apiContract, TRUNCATED_NOTE } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../helpers/contract.js';
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
    const { x } = await world();
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
      status: 'sent',
      reason: 'below £500',
      payload: {},
    });
    const EVENTS = apiContract.alertEventSchema.array();
    const events = await expectContract(
      await x.request(`/api/alerts/events?ruleId=${r.id}`),
      'GET',
      '/api/alerts/events',
      EVENTS,
    );
    expect(events.map((e) => e.status)).toEqual(['sent']);
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
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { truncationOf } from './results.js';
import { calendarThreshold, staleness } from './rows.js';

export type ItineraryHistoryResponse = z.infer<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.infer<typeof apiContract.routeHistoryResponseSchema>;

/**
 * One series per (provider, seller, cabin), oldest first (spec §11 History). Each point is stale by the verified-basis
 * rule (STALE_AFTER_HOURS, decision 44), never truncated (an itinerary search has no pages), and says whether the final
 * step confirmed its price (`price` among the observation's supplied fields, decisions 27, 37, 42).
 */
export function itineraryHistory(hash: string, ports: Ports): ItineraryHistoryResponse {
  const now = ports.clock.now();
  return {
    itineraryHash: hash,
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
          truncated: truncated({ executionId: p.executionId, providerId: s.providerId, cell: p.cell }),
        })),
      };
    }),
    routeSeries: ports.providers
      .flatMap((p) =>
        [cabin, 'unknown' as const].map((cab) => ({
          providerId: p.id,
          cabin: cab,
          points: ports.repos.routeHistory.series(origin, destination, p.id, cab),
        })),
      )
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
import { param, parseWith } from './shared.js';
import type { HandlerTable } from './types.js';

export const historyHandlers: HandlerTable = {
  'GET /api/itineraries/:hash/history': (c, input, ctx) =>
    c.json(itineraryHistory(param(input, 'hash'), ctx.ports)),

  'GET /api/routes/:origin/:destination/history': (c, input, ctx) => {
    const o = iataSchema.safeParse(param(input, 'origin'));
    const d = iataSchema.safeParse(param(input, 'destination'));
    if (!o.success || !d.success) throw new ApiError(400, 'validation', API_TEXT.validation('path'));
    const q = parseWith(apiContract.routeHistoryQuerySchema, input.query, 'query');
    return c.json(routeHistory(o.data, d.data, q.cabin ?? 'economy', ctx.ports));
  },
};
```

`apps/api/src/routes/alerts.ts` (new file):

```ts
/** Spec §6.8, §10 alert rule storage and events; evaluation and delivery are WP11's. */
import { type AlertRule, apiContract } from '@gmt/core';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import { API_TEXT } from '../text.js';
import { param, parseWith } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

function requireDefinition(ctx: RouteContext, id: string): void {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null)
    throw new ApiError(
      422,
      'definition_not_found',
      API_TEXT.definitionNotFound(id),
      fieldsDetail([{ field: 'definitionId', message: API_TEXT.definitionNotFound(id) }]),
    );
}

function getRule(ctx: RouteContext, id: string): AlertRule {
  const rule = ctx.ports.repos.alerts.get(id);
  if (rule === null) throw new ApiError(404, 'alert_not_found', API_TEXT.alertNotFound(id));
  return rule;
}

export const alertHandlers: HandlerTable = {
  'GET /api/alerts': (c, input, ctx) => {
    const q = parseWith(
      apiContract.alertEventsQuerySchema.pick({ definitionId: true }),
      input.query,
      'query',
    );
    return c.json(ctx.ports.repos.alerts.rules(q.definitionId));
  },

  'POST /api/alerts': (c, input, ctx) => {
    const body = parseWith(apiContract.alertRuleInputSchema, input.body);
    requireDefinition(ctx, body.definitionId);
    return c.json(ctx.ports.repos.alerts.create(body), 201);
  },

  'PUT /api/alerts/:id': (c, input, ctx) => {
    const { id, ...current } = getRule(ctx, param(input, 'id'));
    const patch = parseWith(apiContract.alertRuleUpdateRequestSchema, input.body);
    // why: validate the merged rule, so a partial update cannot slip past the requireAllVerified refinement (spec §6.8).
    const merged = apiContract.alertRuleInputSchema.safeParse({ ...current, ...patch });
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

  'DELETE /api/alerts/:id': (c, input, ctx) => {
    const existing = getRule(ctx, param(input, 'id'));
    // why: alert rules soft-delete so their events stay readable (plan decision 15).
    ctx.ports.repos.alerts.softDelete(existing.id);
    return c.json(existing);
  },

  'GET /api/alerts/events': (c, input, ctx) => {
    const q = parseWith(apiContract.alertEventsQuerySchema, input.query, 'query');
    return c.json(
      ctx.ports.repos.alerts.events({
        ...(q.ruleId === undefined ? {} : { ruleId: q.ruleId }),
        ...(q.definitionId === undefined ? {} : { definitionId: q.definitionId }),
        limit: q.limit ?? 100,
      }),
    );
  },
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

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: history routes with stale, truncated and priceConfirmed points; alert rule storage"
```

### Task 8.14: `POST /api/tools/record` inside the app process

**Files:**
- Create: `apps/api/src/routes/tools.ts`, `src/tools/inProcess.ts`
- Modify: `apps/api/src/routes/index.ts`, `src/bootstrap/app.ts` (`main` passes `inProcessTools`)
- Test: `apps/api/test/routes/tools.test.ts`

**Interfaces:**
- Consumes: `runRecord`, `recordPrecheck` (WP4b `src/tools/record.ts`), `RecordCli` (`src/tools/recordPlan.ts`), `recordingTarget`, `RecordingTarget` (`src/bootstrap/tool.ts`), `EXIT`, `safeMessage`; `syntheticAllowed`; `toolRecordRequestSchema`, `toolRunResponseSchema` (core).
- Produces: `inProcessTools(ports, opts?)`; route `POST /api/tools/record`.

Rules (spec §7, §10, §13): the route needs auth like every other; it runs the record tool in this process (the app holds `app_lock`, so the tool bootstrap would refuse) through WP4b's own `runRecord` over the app's ports, so the plan, the budget position and every spend refusal are the CLI's; one tool at a time (`409 tool_busy`); an unregistered runner answers `503 tool_unavailable`; a runner that throws answers `500 tool_failed` and logs the message through `safeMessage`. The runner refuses, before any call and with the CLI's exit codes, an open synthetic gate (70: recordings and the ledger never share a database with synthetic data), a route that may not enter the committed tree (64; HTTP has no `--out`) and a configuration that cannot record (78); over HTTP there is no `--confirm-rerun`, so a rerun that needs it ends 65. The request's own abort signal stops the run. `fixturesWritten` lists every file the run added under the recorded root. `POST /api/tools/smoke` is WP13's and stays unmounted.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/tools.test.ts` (new file):

```ts
// Spec §10, §7 `POST /api/tools/record` inside the app process.
import { join } from 'node:path';
import { apiContract } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunResponse } from '../../src/routes/types.js';
import { inProcessTools } from '../../src/tools/inProcess.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { cleanEnv, silentLog } from '../helpers/env.js';
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
import { parseWith } from './shared.js';
import type { HandlerTable } from './types.js';

export const toolHandlers: HandlerTable = {
  /** One tool at a time; an unregistered runner is 503; a runner that throws is 500 with a scrubbed log line. */
  'POST /api/tools/record': async (c, input, ctx) => {
    const record = ctx.tools.record;
    if (record === undefined) throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable('record'));
    if (ctx.toolInFlight.name !== null)
      throw new ApiError(409, 'tool_busy', API_TEXT.toolBusy(ctx.toolInFlight.name));
    const args = parseWith(apiContract.toolRecordRequestSchema, input.body);
    ctx.toolInFlight.name = 'record';
    // why: the request's own signal ends the run when the client disconnects, as SIGINT ends the CLI run.
    try {
      return c.json(await record(args, c.req.raw.signal));
    } catch (err) {
      ctx.ports.log.error(
        { tool: 'record', err: { message: safeMessage(err, ctx.ports.secrets) } },
        'tool failed',
      );
      throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed('record'));
    } finally {
      ctx.toolInFlight.name = null;
    }
  },
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
import { join } from 'node:path';
import { syntheticAllowed } from '@gmt/core';
import { type RecordingTarget, recordingTarget } from '../bootstrap/tool.js';
import type { ToolRecordRequest, ToolRunners, ToolRunResponse } from '../routes/types.js';
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

/**
 * The record runner over `runRecord` with the CLI's refusals in the same order and with the same exit codes (plan
 * exit-code table): an open synthetic gate (70), a route that may not enter the committed tree (64), a configuration
 * that cannot record (78); then the run itself, which refuses for spend with 65 (no `--confirm-rerun` over HTTP).
 * `fixturesWritten` is every file the run added under the recorded root. `recording` is the test seam the tool
 * bootstrap also has.
 */
export function inProcessTools(ports: Ports, opts: { recording?: RecordingTarget } = {}): ToolRunners {
  return {
    record: async (args: ToolRecordRequest, signal: AbortSignal) => {
      if (syntheticAllowed(ports.config)) return refused(EXIT.refusedTestEnv, API_TEXT.toolSynthetic);
      const cli: RecordCli = { args, dryRun: false, confirmRerun: false, out: null };
      const target = recordingTarget(cli, opts.recording);
      if ('refusal' in target) return refused(EXIT.usage, target.refusal);
      const precheck = recordPrecheck(ports.config);
      if (precheck !== null) return refused(EXIT.badConfig, precheck);
      const lines: string[] = [];
      const before = new Set(filesUnder(target.root));
      const exitCode = await runRecord(ports, cli, {
        signal,
        out: (l) => lines.push(l),
        err: (l) => lines.push(l),
        recordedRoot: target.root,
        recordedBy: target.recordedBy,
      });
      const fixturesWritten = filesUnder(target.root).filter((f) => !before.has(f));
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
Expected: PASS, 7 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: POST /api/tools/record in-process over WP4b's runRecord"
```

### Task 8.15: Contract sweep: strict mounting, auth flags, every response against `core/api-contract`, provenance, banned words, sentinels

**Files:**
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/routes/contract-sweep.test.ts`

**Interfaces:**
- Consumes: `apiContract.ROUTES`, `findBannedWords`, `BANNED_WORD_ALLOWLIST` (core); every handler table.
- Produces: `createApp` throws when a ROUTES entry has no handler (unless listed in `OWNED_ELSEWHERE`) or a handler has no ROUTES entry.

- [ ] **Step 1: Write the failing test**

`apps/api/test/routes/contract-sweep.test.ts` (new file):

```ts
// Spec §9 item 5 sweeps: strict mounting, auth flags, every GET against core/api-contract with provenance on every
// price, banned words in every API string, sentinel secrets never in a body or a log line.
import { apiContract, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { OWNED_ELSEWHERE } from '../../src/routes/types.js';
import { API_TEXT } from '../../src/text.js';
import { expectEnvelopeOrContract } from '../helpers/contract.js';
import { SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { basic, createHarness, type Harness } from '../helpers/harness.js';
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
const mounted = apiContract.ROUTES.filter((r) => !OWNED_ELSEWHERE.has(`${r.method} ${r.path}`));

/** A small world touching every read route: one parent execution, a calendar price, an observation, an alert rule. */
function seedWorld(x: Harness): { def: string; exec: string; alert: string } {
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints: { maxStops: 1 } }));
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
  s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1) });
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) }]);
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

/** Paths of every object that has a `pricePence` but no `provenance` (spec §10: provenance on every price). */
function pricesWithoutProvenance(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => pricesWithoutProvenance(x, `${path}[${i}]`));
  if (v === null || typeof v !== 'object') return [];
  // why: route-series points carry providerId + sourceKind by contract (the vendor gives no cabin).
  const here = 'pricePence' in v && !('provenance' in v) && !('sourceKind' in v) ? [path] : [];
  return [...here, ...Object.entries(v).flatMap(([k, x]) => pricesWithoutProvenance(x, `${path}.${k}`))];
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
    API_TEXT.hostRejected('evil.example:3000', ['localhost:3000']),
    API_TEXT.originRejected('https://evil.example', ['localhost:3000']),
    API_TEXT.contentType,
    API_TEXT.requestedWith,
    API_TEXT.validation('body'),
    API_TEXT.malformedJson,
    API_TEXT.definitionNotFound('d1'),
    API_TEXT.executionNotFound('e1'),
    API_TEXT.noExecution,
    API_TEXT.alertNotFound('a1'),
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
      expect(pricesWithoutProvenance(body), route.path).toEqual([]);
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
    const everything = [...bodies, ...x.logLines].join('\n');
    for (const secret of [SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP]) expect(everything).not.toContain(secret);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/contract-sweep.test.ts`
Expected: FAIL, 1 of 6: "refuses a ROUTES entry without a handler and a handler without a ROUTES entry" (`createApp` skips silently); the other sweeps pass when Tasks 8.8–8.14 are complete, and any failure there names the offending route.

- [ ] **Step 3: Implement**

`apps/api/src/app.ts` — find:

```ts
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const handler = HANDLERS[key];
    // why: Task 8.15 makes mounting strict once every handler exists; until then an unmapped entry answers 404.
    if (handler === undefined || OWNED_ELSEWHERE.has(key)) continue;
    app.on(route.method, route.path, every(...validatorsFor(route)), async (c) =>
      handler(c, await readInput(c, route), ctx),
    );
  }
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
    app.on(route.method, route.path, every(...validatorsFor(route)), async (c) =>
      handler(c, await readInput(c, route), ctx),
    );
  }
```

`apps/api/src/app.ts` — find:

```ts
 * carry `/api`) with zod validation, the error envelope, the spec §4 hardening and the auth gate.
 */
```

`apps/api/src/app.ts` — replace with:

```ts
 * carry `/api`) with zod validation, the error envelope, the spec §4 hardening and the auth gate. Strict: a ROUTES entry
 * without a handler (unless another package owns it) or a handler without a ROUTES entry refuses to build.
 */
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS, every test file (35 files, 337 tests in the assembly: 142 new here, 195 WP4b's); coverage at or above 85% lines, functions and statements and 70% branches (the assembly measured 93.3 / 92.8 / 94.7 / 86.0).

- [ ] **Step 5: Commit**

```bash
git add -A apps/api packages && git commit -m "wp08: strict ROUTES mounting and the contract, provenance, banned-word and sentinel sweeps"
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
| `pnpm --filter @gmt/api test` | every test passes, including `bootstrap/app.spawn` (a real production bootstrap); coverage ≥ 85% lines, functions, statements and ≥ 70% branches for `apps/api/src` |
| `pnpm --filter @gmt/core test` and `pnpm --filter @gmt/db test` | pass; core at 100% on every metric with Task 8.0's test |
| `pnpm -r typecheck` | exit 0 |
| `pnpm lint` | exit 0, no diagnostics |
| `pnpm boundaries` | exit 0: `@gmt/api` reads `process.env` only under `src/bootstrap/`; no msw import; no suppression comment; once WP9 Task 9.12 is on main, no place name in an `apps/api/src` string outside `tools/workedExample.ts` (WP8's new code adds only `GET`, already in `NOT_AIRPORT_WORDS`) |
| `pnpm casts` | exit 0, `0 casts` (decision 48; the assembly scanned 315 files) |
| Manual: `NODE_ENV=development DATABASE_PATH=./data/dev.db BIND_ADDRESS=127.0.0.1 pnpm --filter @gmt/api dev`, then `curl -s -H 'Host: localhost:3000' localhost:3000/api/health` | the log shows `"msg":"listening"`; curl prints `{"ok":true,"degraded":false}`; Ctrl-C logs `shutdown complete` and exits 0 |

## 11. Open questions

None requires the operator's judgment. The design questions this refresh met are settled by plan decisions 21–49; the items below are coordination for the plan owner and other briefs, collected in §13.

## 12. Changes outside `apps/api`

- `packages/core/src/api-contract/common.ts`, `definitions.ts` and the new `packages/core/test/api-contract/wp08.test.ts` (Task 8.0): `executionSummarySchema.expandTop`; draft-tolerant `definitionShapeSchema` and `definitionResponseSchema`.
- `packages/db/src/types.ts`, `src/index.ts`, `src/repositories/itineraries.ts`, `test/itineraries.test.ts` (Task 8.0): `OfferHistoryPoint` with the observation's `suppliedFields`.

## 13. For the plan (not yet recorded there)

1. **Assembly stand-ins.** WP7, WP9 Task 9.0 and WP10 Task 10.1 are not on main. The assembly (2026-10-17, scratch worktrees of main at `f5ecd4e` and `697ad9d`; the brief was replayed task by task into a fresh tree, `pnpm -r typecheck` after every task) applied WP7 Task 7.13's patches verbatim (migration 0001 with a hand-added journal entry, `setConfirmed`, `confirmedCalls`, the contract's `confirmCalls` and `needsConfirmation.totalCalls`) with the db test it changes, WP7's `microGbpToPence`, `TRUNCATED_NOTE`/`isTruncated`, nullable `cachedRows` and `scripts/check-casts.mjs`, WP9's `truncated` on price cells and rows, and WP10's contract fields (with decision 42's `verify` and decision 51's `unconfirmedCells`), and stubbed `@gmt/engine` with WP7 §5's types: `start` and `verifyCell` write executions and seeded cells through the repositories and finish at once, `childCapPreview` returns `CHILD_MAX_CALLS` and the definition's `maxCalls`, `estimate` a fixed small plan, `budgetFit` always fits, `parseCron` refuses a non-numeric minute field. Route tests that depend on engine behaviour mock it with `vi.spyOn`; the two that run the engine (start, verify) assert only what any engine must write. WP4b's tool test counted two migrations, as WP7 Task 7.13 changes it. Results: `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries` and `pnpm casts` clean; `pnpm --filter @gmt/api test` 337/337 with thresholds met (93.3% lines, 86.0% branches). On a machine also running WP7's suite (load 15–20) the full run timed out in WP4b's and WP8's slowest tests alike at the old 20 s timeout, hence 60 s and the harness's parsed-once airports dataset. The core and db failures the stand-ins cause (WP9's and WP7's own fixture updates) are those packages' diffs.
2. **`unconfirmedCells`.** Decision 51 names the calendar day's field `verification.unconfirmedCells` and asks for it "under the active destination filter"; the reviewed WP10 brief (Task 10.1) still declares `verification.unconfirmed`. WP8 fills decision 51's name with the count over every destination of the day, because the calendar route takes no query and `byDestination` carries prices only; a per-destination count needs `byDestination[].unconfirmedCells` in the contract (the same gap as WP10 §13 item 2). WP10's Task 10.1 should rename its field.
3. **Drafts in the contract.** Spec §10's no-body `POST /definitions` creates a definition with no airports (spec §1), but the stored-row and response schemas required at least one origin and destination, so WP3 could insert a draft and never read it back. Task 8.0 relaxes only `definitionShapeSchema` and `definitionResponseSchema`; the plan's API-contract text should say so, and WP9 should expect empty airport lists on a draft.
4. **Contract additions with no owner until now.** `expandTop` on `executionSummarySchema` (decision 42) is added by WP8's Task 8.0; `OfferHistoryPoint` (`suppliedFields` on `offerHistory`) is the db change behind `priceConfirmed` on itinerary history points. The plan's Database contract should list `offerHistory(hash): Array<{ …; points: OfferHistoryPoint[] }>`.
5. **One copy of the soft-confirm call share.** WP8 mirrors WP7's `SOFT_CONFIRM_CALL_SHARE = 0.2` to fill `needsConfirmation` (decision 25). WP7's barrel does not export it (nor `StartOptions`, which WP8 needs only structurally); exporting both from `@gmt/engine` lets WP8 import the constant instead of declaring it.
6. **Spec text at the next revision.** §10's `GET /definitions/:id/calendar?basis=` (the contract takes no query; both bases come back per day); §10's coverage row gains "404 before the first run"; §7's app bootstrap order says nothing of a fresh `app_lock` held while migrations are pending: the app runs the backup preflight and migrations before it takes the lock (the plan's order), so a second app started against a running one would migrate before it refuses; WP4b's tool avoids this with `readOnlyLockState` first, and the app could do the same before `backupBeforeMigrations` (a WP8 change if the plan rules it).
7. **Core age helper.** Spec rev 23 makes the effective age of an unknown-age price the fetch age; core's `worstCaseAgeHours` still returns `'unknown'` for it, so WP8's `staleness` maps that case to `fetchedHours` itself, and `ageHours` on the wire is never `'unknown'` from WP8. The contract's `ageHoursSchema` still admits `'unknown'`; WP9/WP10 read the "vendor's cache age unknown" label from `provenance.maxAgeHours`.
