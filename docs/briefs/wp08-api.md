---
wp: 8
title: "api: app bootstrap, routes, auth, hardening, static, health, tools routes"
owner: sonnet
depends_on: [4b, 7]
spec_sections: ["§4 Auth and request hardening", "§5.5", "§6.5", "§6.9", "§7 app_lock", "§8.1 Single-cell verification", "§8.1 Resume", "§8.2", "§9 item 5", "§10", "§12", "§13", "§14"]
reviewers: [code-architect, test-strategy-reviewer, security-reviewer, provenance-auditor, product-owner, devops-reviewer]
status: draft
---

# WP8 — `@gmt/api`: app bootstrap, routes, auth, hardening, static, health, tools routes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task: failing test, run, minimal code, run, commit. Steps use `- [ ]` checkboxes. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, revision 9) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`) before Task 8.1. **This brief is not dispatchable until every item under "Open questions" is closed by Fable** (each is a contract amendment, not a design question for the operator).

## 1. Goal

Turn the engine, repositories and ports into the one HTTP surface of spec §10, behind the auth and hardening of spec §4, started by an app bootstrap that honours the §5.5 synthetic gates, the §7 `app_lock` waits and the §7 pre-migration backup, and that shuts down gracefully (§13).

## 2. Scope

**In**

- `apps/api/src/app.ts`: `createApp(ports, engine, options?)`, a Hono app that mounts every `ROUTES` entry of `@gmt/core` `apiContract` under the `/api` prefix (see Open question 1) with `@hono/zod-validator` on bodies and queries, the error envelope `{ error: { code, message, details? } }`, security headers, Host/Origin/Content-Type/X-Requested-With checks, basic auth with the failed-auth rate limit, static serving of the built web app with an SPA fallback.
- Every route of spec §10 with its semantics: health (public and authenticated detail), providers, definitions CRUD with the plan-aware default definition, estimate, coverage check, executions (start, read, cancel, resume), single-cell verify, results (§6.5/§6.9), calendar, duration analysis, coverage, calendar gap, cell detail, history, alerts CRUD and events (storage only), scheduler jobs, budget, `/tools/smoke` and `/tools/record`.
- `apps/api/src/bootstrap/app.ts`: `bootApp(deps)` and `main()`; `apps/api/src/bootstrap/start.ts` entry; config parsed once (§12); pre-migration backup through an injected port; airport seed and sanity check; `AppLock('app')` with the 60 s / 90 s waits and the 30 s heartbeat; `engine.boot()`; `@hono/node-server` on `bindAddress:port`; SIGTERM/SIGINT graceful shutdown; pino with the §14 redact paths.
- Every §9 item 5 test as real code, plus the review-focus line 4 test (`excludedByCurrentSpace` and the `basisReason` wording).

**Out**

- `buildPorts`, `loadConfigFromEnv`, the tool bootstrap and the `record:fixtures` tool: WP4b (consumed here).
- The live smoke tool function (`apps/api/src/tools/smoke.ts`) and the "tool bootstrap starts no execution" test: WP13. WP8 mounts `/tools/smoke` and answers `503 tool_unavailable` until WP13 registers the runner.
- The alert runner, `EmailNotifier` and alert templates: WP11. WP8 stores and reads alert rules and events only.
- `scripts/backup.mjs` and its `backupDatabase` export: WP12. WP8 injects a `backup` port and loads that export at runtime.
- Dockerfile, compose, `HEALTHCHECK`, `docs/*`: WP12.
- The SPA itself and its API client: WP9/WP10.
- Engine semantics (pre-start checks, resume compare-and-set, child execution rules, scheduler ticks): WP7. WP8 calls the engine and maps its `StartResult` to HTTP.

## 3. Spec sections

| Section | What it requires of WP8 |
|---|---|
| §4 "Auth and request hardening" | Basic auth (both vars or neither, password ≥ 12, constant-time compare), failed-auth limit 5/min per source IP (from `X-Forwarded-For` only with `TRUST_PROXY=true`) with a global 20/min, everything authenticated except the minimal `GET /health`, which is also Host-exempt; `ALLOWED_HOSTS` rejection names the header value and the variable; mutating routes need `Content-Type: application/json` and `X-Requested-With: get-me-there`; `Origin`, when present, must match; CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`. |
| §5.5 | Bootstraps refuse `NODE_ENV=test`; `databasePath` realpath-resolved before the config is built (WP4b's `loadConfigFromEnv`); injected-config boot matrix; one test spawning the real bootstrap with a real production environment. |
| §6.5 | `/results` dedups per itinerary hash (cheapest offer in the definition's cabin, others in the expanded row), ranks by class then price, returns at most 1000 rows with `truncated` and `total`, no sort/filter parameters. |
| §6.9 | Basis `verified` or `calendar`; calendar rows are class `unchecked` with a "not applied" list; default basis is calendar when the snapshot has no verification provider or no observations exist, with a reason; calendar-gap empty with no verification provider; a search link on every row whose booking is `none`. |
| §7 `app_lock` | App holder: heartbeat every 30 s; a fresh `tool` lock → wait up to 60 s then refuse; a fresh `app` lock → wait up to 90 s logging the lock age, then take over; SIGTERM releases the lock after the checkpoint. Pre-migration `VACUUM INTO` backup only when migrations are pending; a failed backup refuses boot. Seed and the airport sanity check fail boot. |
| §8.1 "Single-cell verification" | `POST /cells/verify` validates the cell ∈ the current resolved space and that its airports exist; 409 when a child is active for that cell; hidden (refused) when the definition has no verification provider. Children are included in results, calendar, calendar-gap and duration analysis. |
| §8.1 "Resume" | `/resume` is manual (`{ manual: true }`), 409 when another execution is active or the compare-and-set loses. |
| §8.2 | `POST`/`PUT`/`DELETE` of a definition (re)register or unregister its cron job in the same request; cron validated by `engine.parseCron` (sub-hourly rejected); the default definition uses the plan-aware policy preset. |
| §9 item 5 | Every test listed there (see Task 8.15 for the sweep). |
| §10 | The route table, the error envelope, `provenance` and `stale` on every price-bearing shape. |
| §12 | `process.env` parsed once in the bootstrap through the `core` schema; invalid config fails boot naming the field. |
| §13 | `/health` for the `HEALTHCHECK`; graceful shutdown: stop, checkpoint, release lock, exit 0. |
| §14 | pino JSON to stdout; `redact` paths `apiKey`, `token`, `authorization`, `url.query`, `req.headers.authorization`; URL query/userinfo stripped from every logged string. |

## 4. Interfaces consumed

Copied from the plan's "Cross-package contracts" without change, then the items this brief needs that the plan does not spell out (each listed again in Open questions).

```ts
// @gmt/core (WP0)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export const systemClock: Clock;
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export interface Config { /* the plan's Config block, verbatim */ }
export function parseConfig(env: Record<string, string | undefined>, opts: ParseConfigOptions): ConfigResult;
export function syntheticAllowed(c: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>): boolean;
export const FIXTURE_OPT_IN_PHRASE = 'i-understand-this-is-fake';
export function stripUrlsInText(text: string): string;
export class BudgetExceeded extends Error { scope; cap; current; requested }
export const BANNED_WORDS: readonly string[];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown';
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
export interface SearchDefinition { /* the plan's Definition types block, verbatim */ }
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean };
export const ACTIVE_STATUSES: readonly ExecutionStatus[];
export * as apiContract from './api-contract/index.js';
// apiContract: ROUTES, RouteDef { method; path; request?; query?; response; auth: 'public' | 'required' }, errorEnvelopeSchema,
// priceCellSchema, bucketsSchema, coverageSummarySchema, bookingSchema, definitionCreateRequestSchema,
// definitionUpdateRequestSchema, definitionResponseSchema, estimateResponseSchema, coverageCheckRequestSchema,
// coverageCheckResponseSchema, executionResponseSchema, startExecutionRequestSchema, verifyCellRequestSchema,
// resultRowSchema, resultsResponseSchema, calendarResponseSchema, durationAnalysisResponseSchema,
// coverageResponseSchema, calendarGapResponseSchema, cellDetailResponseSchema, historyResponseSchema,
// alertRuleSchema, alertEventSchema, healthPublicSchema, healthDetailSchema, providersResponseSchema,
// budgetResponseSchema, schedulerJobsResponseSchema, toolRunResponseSchema, cronSchema

// @gmt/core (WP1, plan "WP1" Produces)
export function resolveWindow(def: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean };
export function countCells(space: ResolvedSpace): number;
export function generateCells(space: ResolvedSpace): Cell[];
export function addDays(d: IsoDate, n: number): IsoDate;
export function daysBetween(a: IsoDate, b: IsoDate): number;        // b − a in days (assumed direction; Open question 6)
export function validateSearchSpace(def, todayLondon, lookup: { exists(iata): boolean; metroOf(iata): string | null; airportsOfMetro(code): Iata[] }, maxCells): ValidationResult;
export function sixBuckets(outcomes: CellOutcome[]): Buckets;
export function cellKeyString(cell: CellKey): string;                 // `O|D|dep|ret`

// @gmt/core (WP2, plan "WP2" Produces; parameter shapes not in the plan, Open question 6)
export function evaluateConstraints(it: NormalisedItinerary, offer: EvaluatedOffer, c: Constraints, supplied: readonly SuppliedField[]): Verdicts;
export interface EvaluatedOffer { requestedCabin: Cabin; pricePence: number; segmentCabins: Cabin[] | null; selfTransfer: boolean | null; baggage: BaggageSnapshot | null }
export function verdictClass(v: Verdicts): VerdictClass;
export function dedupByItinerary(rows: ResultRow[]): ResultRow[];     // one row per itineraryHash, cheapest kept, others into otherOffers
export function rankRows(rows: ResultRow[]): ResultRow[];             // class, then seen before notSeenInLatest, then price, then compareAges
export function bandCheapest(rows: ResultRow[], hours: number): ResultRow[]; // sets bandCheapest on the cheapest per band
export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url: string; host: string; label: string };

// @gmt/db (WP0, WP3)
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T): T; close(): void }
export function openDatabase(path: string): Db;
export class AppLock { constructor(db, holder: 'app' | 'tool', clock, log); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void; static inspect(db): { holder; heartbeatAt; acquiredAt } | null }
export function seedAirports(db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };
export function sanityCheckAirports(db, referenced: Iata[]): { ok: true } | { ok: false; reason: string };
export class AirportsRepo { exists(iata): boolean; get(iata): Airport | null; metroOf(iata): string | null; airportsOfMetro(code: string): Iata[] /* Open question 3 */; count(): number }
export class DefinitionsRepo { create(input): SearchDefinition; update(id, patch): SearchDefinition; get(id): SearchDefinition | null; list(): SearchDefinition[]; softDelete(id): void; setConfirmedCost(id, pence): void }
export class ExecutionsRepo { get(id): Execution | null; listForDefinition(id, opts: { includeChildren: boolean }): Execution[]; activeParent(definitionId): Execution | null; latestCompleted(definitionId): Execution | null }
export class CellsRepo { outcomes(executionId, filter?): CellOutcome[]; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; selected(executionId): Array<CellKey & { reason: SelectionReason }> }
export class CalendarPricesRepo { insert(rows): void; latestPerCell(definitionId, cabin, space: ResolvedSpace | null /* Open question 3 */): CalendarPriceRow[]; history(origin, destination, cabin): HistoryPoint[] }
export class ItinerariesRepo { observationsForDefinition(definitionId, executionIds, space: ResolvedSpace | null /* Open question 3 */, cabin): ObservationRow[]; offerHistory(hash): HistoryPoint[]; latestVerificationOutcomeForCell(definitionId, cell): CellOutcome | null }
export class LedgerRepo { countsFor(executionId): { calls: number; costMicroGbp: number; tiles: number; cacheHits: number }; overrun(executionId, planLength): boolean }
export class AlertsRepo { rules(definitionId?): AlertRule[]; create(input: AlertRuleInput): AlertRule; update(id: string, patch: Partial<AlertRuleInput>): AlertRule; delete(id: string): void; get(id: string): AlertRule | null; events(filter: { ruleId?: string; definitionId?: string; limit: number }): AlertEvent[] }
export class NotificationsRepo { wasSent(kind, executionId): boolean }
export class RoutePriceHistoryRepo { series(origin, destination, cabin, providerId): HistoryPoint[] }
// Row types the plan names without fields (Open question 3); WP8 reads exactly these fields:
export interface Execution { id: string; definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; status: ExecutionStatus; stage: Stage | null; estimate: Estimate | null; resumeAfter: IsoDateTime | null; startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null; errorText: string | null }
export interface CalendarPriceRow extends CellKey { id: number; executionId: string; providerId: ProviderId; sourceKind: SourceKind; cabin: Cabin; pricePence: number; fx: FxInfo; pointOfSale: PointOfSale; fetchedAt: IsoDateTime; providerObservedAt: IsoDateTime | null; maxAgeHours: number | null; vendorLink: string | null; reusedFromExecutionId: string | null }
export interface ObservationRow { observation: Observation; offer: Offer & { id: number }; itinerary: NormalisedItinerary; executionId: string; isChild: boolean }
export interface HistoryPoint { providerId: ProviderId; kind: 'observation' | 'calendar' | 'route-lowest'; fetchedAt: IsoDateTime; pricePence: number; provenance: Provenance }

// @gmt/providers (WP4)
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>; costMicroGbp: number }): FlightProvider;
export function fixtureHandlers(root: string): RequestHandler[];

// @gmt/engine (WP7)
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window'; message: string; details: unknown };
export interface Engine {
  boot(): Promise<void>; shutdown(): Promise<void>;
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
export function createEngine(deps: EngineDeps): Engine;
export function parseCron(expr: string, tz: string): { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };
export class LogNotifier implements Notifier { constructor(log: Logger) }   // plan file map names src/notifiers/log.ts; export not in the contract (Open question 5)
export interface SchedulerJob { definitionId: string; kind: 'cron' | 'resume'; cron: string | null; tz: string; nextRun: IsoDateTime | null; executionId: string | null } // Open question 5

// apps/api (WP4b)
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[] }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string }): Ports;
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
// apps/api/src/tools/record.ts (WP4b), in-process entry (Open question 4):
export function recordFixtures(ports: Ports, args: { budget: number }, log: Logger): Promise<ToolRunResult>;
export interface ToolRunResult { ok: boolean; exitCode: number; lines: string[] }

// scripts/backup.mjs (WP12), loaded at runtime (Open question 4):
export function backupDatabase(dbPath: string): Promise<string>;   // VACUUM INTO + integrity_check, refuses an existing target, keeps 5; returns the backup path
```

## 5. Interfaces produced

```ts
// apps/api/src/app.ts
export type RouteKey = `${'GET' | 'POST' | 'PUT' | 'DELETE'} ${string}`;
export interface ToolRunners { smoke?: (args: Record<string, never>) => Promise<ToolRunResult>; record?: (args: { budget: number }) => Promise<ToolRunResult> }
export interface AppOptions { webRoot?: string | null; tools?: ToolRunners; clientIp?: (c: Context<AppEnv>) => string | null; routes?: readonly RouteDef[] }
export const API_PREFIX = '/api';   // defined in src/routes/types.ts, re-exported by src/app.ts
export function createApp(ports: Ports, engine: Engine, options?: AppOptions): Hono<AppEnv>;

// apps/api/src/errors.ts
export class ApiError extends Error { constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) }
export function envelope(code: string, message: string, details?: unknown): { error: { code: string; message: string; details?: unknown } };

// apps/api/src/logger.ts
export const REDACT_PATHS: readonly string[];   // spec §14, exactly five
export function createLogger(level: Config['logLevel'], destination?: pino.DestinationStream): Logger;

// apps/api/src/bootstrap/app.ts
export interface BootDeps {
  config: Config; log: Logger; clock?: Clock; listen: boolean; assets: AssetPaths;
  backup?: (dbPath: string) => Promise<void>;                 // default: loadBackup(assets.backupModule)
  sleep?: (ms: number) => Promise<void>;                      // default: setTimeout
  timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
  tools?: (ports: Ports) => ToolRunners;                      // main() passes inProcessTools
}
export const HEARTBEAT_MS = 30_000;
export class BootError extends Error {}
export interface RunningApp { app: Hono<AppEnv>; ports: Ports; engine: Engine; port: number | null; close(): Promise<void> }
export function bootApp(deps: BootDeps): Promise<RunningApp>;
export function main(env: NodeJS.ProcessEnv): Promise<void>;

// apps/api/src/bootstrap/lock.ts
export function acquireAppLockWithWaits(p: { lock: AppLock; inspect: () => { holder: 'app' | 'tool'; heartbeatAt: IsoDateTime } | null; clock: Clock; sleep: (ms: number) => Promise<void>; log: Logger }): Promise<void>;
export const TOOL_LOCK_WAIT_MS = 60_000;
export const APP_LOCK_WAIT_MS = 90_000;

// apps/api/src/bootstrap/migrations.ts
export function pendingMigrations(dbPath: string, migrationsDir: string): { fresh: boolean; pending: string[] };

// apps/api/src/bootstrap/backup.ts, paths.ts
export function loadBackup(modulePath: string): (dbPath: string) => Promise<void>;
export interface AssetPaths { migrationsDir: string; airportsDataDir: string; webRoot: string | null; backupModule: string }
export function assetPaths(): AssetPaths;
export function loadAirportsDataset(dir: string): AirportsDataset;

// apps/api/src/tools/inProcess.ts
export function inProcessTools(ports: Ports): ToolRunners;

// apps/api/src/defaults.ts
export function defaultDefinitionInput(config: Config, providers: readonly FlightProvider[]): DefinitionInput;
```

The HTTP surface is `ROUTES` from `@gmt/core` under `/api`; WP9's client and WP12's `HEALTHCHECK` (`GET /api/health`) depend on that prefix.

## 6. Library notes

All versions from the plan's Task 0.1 list. Verified on 2026-10-14 with context7.

| Library | Version | Calls used | Source verified |
|---|---|---|---|
| `hono` | 4.13.13 | `new Hono<AppEnv>()`, `app.route('/api', api)`, `api.on(method, path, mw, handler)`, `app.use('*', mw)`, `app.onError`, `app.notFound`, `app.request(path, init)` for tests, `c.json(body, status)`, `c.header()`, `c.req.header()`, `c.req.path`, `c.req.method`, `c.req.param()`, `c.req.text()`, `c.req.addValidatedData(target, data)`, `c.req.valid(target)`; `secureHeaders` from `hono/secure-headers` with `contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] }`, `referrerPolicy: 'no-referrer'`, `xContentTypeOptions: 'nosniff'`; `every` from `hono/combine`; `HTTPException` not used (own `ApiError`) | context7 `/websites/hono_dev` (secure-headers options table; `app.request` API) |
| `@hono/node-server` | 2.1.5 | `serve({ fetch: app.fetch, port, hostname }, (info) => …)` returns the `node:http` server; `serveStatic({ root })` from `@hono/node-server/serve-static` (rejects `..`, calls `next()` when not found); `serveStatic({ path })` for the SPA fallback; `getConnInfo(c)` from `@hono/node-server/conninfo` (`info.remote.address`) | context7 `/honojs/node-server` (`serve`, `serveStatic` options and behaviour, `conninfo`) |
| `@hono/zod-validator` | 0.9.1 | `zValidator('json' \| 'query', schema, hook)` with `hook(result, c)` returning the 400 envelope when `!result.success`; peer range `zod ^3.25.0 \|\| ^4.0.0`, so zod 4.6.7 is supported | context7 `/honojs/middleware` (README hook; `package.json` peerDependencies) |
| `zod` | 4.6.7 | `z.infer`, `schema.safeParse`, `ZodError.issues` | WP0 already uses it; added to `@gmt/api` dependencies as the validator's peer |
| `pino` | 10.4.0 | `pino({ level, redact: { paths, censor: '[redacted]' }, formatters: { log } }, destination)`; `logger.child()` | context7 `/pinojs/pino` (`redact` option: paths, censor, remove) |
| `drizzle-orm` | 0.45.4 (through `@gmt/db`) | not called directly; `pendingMigrations` reads `meta/_journal.json` (`entries[].when`, `entries[].tag`) and `__drizzle_migrations.created_at`, mirroring the migrator, which applies entries whose `when` is greater than the last `created_at` | context7 `/drizzle-team/drizzle-orm` (`readMigrationFiles`, journal format) |
| `msw` | 3.0.3 (dev) | `setupServer(...fixtureHandlers(root))`, `server.listen({ onUnhandledRequest: 'error' })`, `server.close()` | used exactly as WP4/WP7 tests use it |
| `tsx` | 4.23.15 (dev) | `node --import tsx src/bootstrap/start.ts` for the spawn test and `pnpm dev` | tsx docs: `--import tsx` is the Node ≥ 20.6 loader form |
| `vitest` | 5.0.4 | `describe/it/expect`, `vi.spyOn`, `beforeAll/afterAll`, per-test `timeout` | — |
| `node:crypto` | Node 22 | `createHash('sha256')`, `timingSafeEqual` | Node docs |
| `node:child_process` | Node 22 | `spawn(process.execPath, ['--import', 'tsx', …], { env, cwd })` | Node docs |

## 7. Files

**Create** (all under `apps/api/`)

```
src/app.ts                     createApp, API_PREFIX, AppEnv, mounting from ROUTES
src/errors.ts                  ApiError, envelope, scrubDetails, onError/notFound handlers
src/logger.ts                  createLogger, REDACT_PATHS
src/text.ts                    API_TEXT: every fixed user-facing string the api emits
src/defaults.ts                defaultDefinitionInput (spec §8.2 preset, §11 form defaults)
src/static.ts                  mountStatic(app, webRoot): serveStatic + SPA fallback
src/tools/inProcess.ts         inProcessTools(ports): the record runner (WP13 adds smoke)
src/middleware/headers.ts      securityHeaders()
src/middleware/hardening.ts    hostAllowlist, originCheck, mutatingRequestCheck
src/middleware/auth.ts         FailedAuthLimiter, basicAuthGate, clientIpFrom
src/middleware/validate.ts     validatorsFor(route), readInput
src/routes/types.ts            API_PREFIX, AppEnv, RouteHandler, RouteInput, RouteContext, HandlerTable, ToolRunners
src/routes/shared.ts           param, getLiveDefinition
src/routes/index.ts            HANDLERS (merge of every table below)
src/routes/system.ts           /health, /providers, /budget, /scheduler/jobs
src/routes/definitions.ts      /definitions CRUD, /estimate, /coverage-check
src/routes/executions.ts       /definitions/:id/executions, /executions/:id[/cancel|/resume], /cells/verify
src/routes/results.ts          /results, /calendar, /duration-analysis, /coverage, /calendar-gap, /cells/…
src/routes/history.ts          /itineraries/:hash/history, /routes/:origin/:destination/history
src/routes/alerts.ts           /alerts CRUD, /alerts/events
src/routes/tools.ts            /tools/smoke, /tools/record
src/read/space.ts              currentSpace, cellInSpace, airportLookup, isDraft
src/read/rows.ts               verifiedRow, calendarRow, datedPrice, staleness, latestPerOffer, notSeenResolver, cheapest
src/read/results.ts            loadRows, chooseBasis, assembleResults
src/read/calendar.ts           assembleCalendar
src/read/duration.ts           assembleDuration
src/read/coverage.ts           coverageSummaryFor, zeroBuckets, SEARCHED
src/read/coverageView.ts       assembleCoverage, ledgerByProvider, retryable
src/read/history.ts            historySeries
src/read/cell.ts               assembleCellDetail
src/read/executions.ts         executionResponse, budgetScopes, scopeLabel
src/read/definitions.ts        definitionResponse, needsConfirmation
src/bootstrap/paths.ts         assetPaths(): migrationsDir, airportsDataDir, webRoot, backupModule
src/bootstrap/migrations.ts    pendingMigrations
src/bootstrap/backup.ts        loadBackup (scripts/backup.mjs, WP12)
src/bootstrap/app.ts           bootApp, main, BootError, HEARTBEAT_MS
src/bootstrap/lock.ts          acquireAppLockWithWaits, LockRefusedError
src/bootstrap/start.ts         `await main(process.env)`
test/harness.ts                in-memory ports + engine + app; msw fixture server; request helpers
test/seed.ts                   SQL seeder over the spec §7 column names
test/contract.ts               expectContract(res, route)
test/examples.ts               exampleDefinitionInput (the worked example, sized for tests)
test/*.test.ts                 one file per task below
```

**Modify**

- `apps/api/package.json`: add dependency `zod@4.6.7`; dev dependency `msw@3.0.3`; scripts `"dev": "tsx watch src/bootstrap/start.ts"`, `"start": "node dist/bootstrap/start.js"`. Keep WP4b's `tool` script.
- `apps/api/vitest.config.ts`: `testTimeout: 20_000` (the spawn test boots a real process).

## 8. Tasks

Every "Run" step assumes the workspace dependencies of `@gmt/api` are built, because workspace packages export `dist/`: run `pnpm --filter "@gmt/api^..." build` once per session and after pulling a dependency change. Test files live in `apps/api/test/`; the filter argument after `--` is a file-name substring.

### Task 8.1: Production boot lacks `fixture` (first failing test)

**Files:**
- Create: `src/text.ts`, `src/errors.ts`, `src/logger.ts`, `src/routes/types.ts`, `src/routes/system.ts`, `src/routes/index.ts`, `src/middleware/auth.ts`, `src/middleware/validate.ts`, `src/read/executions.ts`, `src/app.ts`, `src/bootstrap/paths.ts`, `src/bootstrap/app.ts`, `src/bootstrap/start.ts`
- Modify: `apps/api/package.json` (dependencies and scripts listed in §7), `apps/api/vitest.config.ts` (`testTimeout: 20_000`)
- Test: `test/boot.spawn.test.ts`

**Interfaces:**
- Consumes: `loadConfigFromEnv`, `buildPorts`, `Ports` (WP4b); `fixtureProvider` (WP4); `AppLock`, `seedAirports`, `CalendarPriceRow` (WP3); `createEngine`, `LogNotifier` (WP7); `apiContract.ROUTES`, `FIXTURE_OPT_IN_PHRASE`, `systemClock`, `stripUrlsInText` (WP0).
- Produces: `createApp` (non-strict mounting; Task 8.15 makes it strict), `API_PREFIX`, `ApiError`, `envelope`, `createLogger` (no redaction yet; Task 8.5), `API_TEXT`, `bootApp`, `main`, `assetPaths`, `loadAirportsDataset`, `GET /api/health` (public shape), `GET /api/providers`.

- [ ] **Step 1: Write the failing test**

`test/boot.spawn.test.ts`:

```ts
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_OPT_IN_PHRASE, asIata, asIsoDate, asIsoDateTime, systemClock } from '@gmt/core';
import type { CalendarPriceRow } from '@gmt/db';
import { fixtureProvider } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { assetPaths } from '../src/bootstrap/paths.js';
import { createLogger } from '../src/logger.js';
import { buildPorts, loadConfigFromEnv } from '../src/wiring.js';

// why: the spawned process must see a real production environment, not vitest's NODE_ENV=test,
// so the env is built from scratch rather than copied from this process.
const apiRoot = fileURLToPath(new URL('..', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      if (a !== null && typeof a === 'object') {
        const port = a.port;
        s.close(() => resolve(port));
      } else reject(new Error('no port'));
    });
  });
}

/** Resolves with the first stdout line matching `pattern`; rejects with all output if the child exits first. */
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
    child.stderr?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`bootstrap exited with ${code} before ${pattern}:\n${out}`));
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

/** A synthetic row the repository must refuse outside the gate (spec §5.5). */
function syntheticCalendarRow(): Omit<CalendarPriceRow, 'id'> {
  return {
    executionId: 'spawn-test',
    providerId: 'fixture',
    sourceKind: 'synthetic',
    cabin: 'economy',
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    departureDate: asIsoDate('2027-03-14'),
    returnDate: asIsoDate('2027-03-28'),
    pricePence: 41_200,
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
    const dir = mkdtempSync(join(tmpdir(), 'gmt-spawn-'));
    const port = await freePort();
    // why: the strongest negative case: the opt-in phrase is set, the path ends in .fixture.db and we
    // are not in a container, so NODE_ENV=production is the only thing standing between us and synthetic data.
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      DATABASE_PATH: join(dir, 'prod.fixture.db'),
      PORT: String(port),
      BIND_ADDRESS: '127.0.0.1',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: 'test-basic-auth-pass-0123456789',
      ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
      LOG_LEVEL: 'info',
    };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/bootstrap/start.ts'], {
      cwd: apiRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitForLine(child, /"msg":"listening"/, 45_000);
      const auth = Buffer.from(`${env.APP_BASIC_AUTH_USER}:${env.APP_BASIC_AUTH_PASS}`).toString('base64');
      const res = await fetch(`http://127.0.0.1:${port}/api/providers`, { headers: { authorization: `Basic ${auth}` } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { providers: Array<{ id: string }> };
      expect(body.providers.map((p) => p.id)).not.toContain('fixture');
    } finally {
      child.kill('SIGTERM');
    }
    expect(await waitForExit(child)).toBe(0);

    // Same environment and file, in this process: the gates hold outside the server too.
    const config = loadConfigFromEnv(env);
    const log = createLogger('error');
    const ports = buildPorts(config, { log, migrationsDir: assetPaths().migrationsDir });
    try {
      expect(ports.providers.map((p) => p.id)).not.toContain('fixture');
      expect(() => fixtureProvider({ http: ports.http, log, clock: systemClock, config, costMicroGbp: 0 })).toThrow();
      // why: match the message so a foreign-key failure cannot satisfy the assertion by accident.
      expect(() => ports.repos.calendarPrices.insert([syntheticCalendarRow()])).toThrow(/synthetic/i);
    } finally {
      ports.db.close();
    }
  }, 90_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- boot.spawn`
Expected: FAIL, `Cannot find module '../src/bootstrap/paths.js'` (or `../src/logger.js`).

- [ ] **Step 3: Implement**

`apps/api/package.json` additions (keep WP0/WP4b fields):

```json
{
  "scripts": { "dev": "tsx watch src/bootstrap/start.ts", "start": "node dist/bootstrap/start.js" },
  "dependencies": { "zod": "4.6.7" },
  "devDependencies": { "msw": "3.0.3" }
}
```

`src/text.ts`:

```ts
/**
 * Every fixed user-facing string the api emits: error messages, basis reasons, notices and
 * series labels. One table so the banned-word test (spec §11, §8.3) can scan all of them.
 * Rule: no banned word; "verified" never appears here because it is reserved for class values.
 */
export const API_TEXT = {
  internal: 'internal error; see the server log',
  notFound: 'no such route',
  unauthenticated: 'authentication required',
  rateLimited: (seconds: number) => `too many failed sign-in attempts; retry in ${seconds}s`,
  hostRejected: (host: string, allowed: readonly string[]) => `Host "${host}" is not in ALLOWED_HOSTS (${allowed.join(', ')})`,
  originRejected: (origin: string, allowed: readonly string[]) =>
    `Origin "${origin}" does not match ALLOWED_HOSTS (${allowed.join(', ')})`,
  contentType: 'requests that change data need Content-Type: application/json',
  requestedWith: 'requests that change data need X-Requested-With: get-me-there',
  validation: (target: string) => `invalid request ${target}`,
  malformedJson: 'request body is not valid JSON',
  definitionNotFound: (id: string) => `no search definition ${id}`,
  executionNotFound: (id: string) => `no execution ${id}`,
  alertNotFound: (id: string) => `no alert rule ${id}`,
  draftNotice: 'Set at least one origin and one destination before running or scheduling this search.',
  draftCannotEnable: 'a definition without origins and destinations cannot be enabled',
  draftNoEstimate: 'set origins and destinations before asking for an estimate',
  deletedNotice: 'definition deleted; its schedule is removed',
  invalidDefinition: 'the definition is not valid',
  zeroCells: 'the window and nights range resolve to zero cells; widen the window or the nights range',
  invalidCron: (reason: string) => `schedule rejected: ${reason}`,
  coverageCheckUnavailable: 'the coverage check reads the free Travelpayouts cache; set TRAVELPAYOUTS_TOKEN to enable it',
  zeroCapVerification: 'verification will not run: spend cap is 0',
  notCancellable: (status: string) => `execution is ${status} and cannot be cancelled`,
  cellNotInSpace: 'that cell is outside the current window, nights range or airports of this definition',
  unknownAirport: (iata: string) => `airport ${iata} is not in the airports table`,
  noVerificationProvider: 'this definition has no verification provider, so single-cell verify is unavailable',
  basisNoVerificationProvider: 'calendar basis: no verification provider is configured, so constraints are not checked',
  basisNoObservations: 'calendar basis: no itinerary-searched observations yet, so constraints are not checked',
  basisItinerarySearched: 'itinerary-searched basis: constraints checked against the current definition at read time',
  basisRequestedCalendar: 'calendar basis as requested: constraints are not checked',
  insideSpace: (inside: number, total: number) => `${inside} of ${total} rows are inside the current window and nights range`,
  routeLowestLabel: "Google's route-level lowest price, cabin unknown",
  observationSeries: (name: string) => `${name} · itinerary-searched offers`,
  calendarSeries: (name: string) => `${name} · calendar prices, constraints not checked`,
  toolUnavailable: (name: string) => `the ${name} tool is not available in this build`,
  toolBusy: (name: string) => `the ${name} tool is already running`,
  toolFailed: (name: string) => `the ${name} tool failed; see the server log`,
} as const;
```

`src/errors.ts`:

```ts
import { stripUrlsInText } from '@gmt/core';
import type { Logger } from '@gmt/core';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { API_TEXT } from './text.js';

/** Thrown by handlers; rendered as the spec §10 error envelope with its status. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details: unknown;
  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(stripUrlsInText(message));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Deep copy with every string URL-stripped. Spec §5.3: API `error.details` never holds a query string or userinfo. */
export function scrubDetails(value: unknown): unknown {
  if (typeof value === 'string') return stripUrlsInText(value);
  if (Array.isArray(value)) return value.map(scrubDetails);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDetails(v)]));
  }
  return value;
}

/** Spec §10: `{ error: { code, message, details? } }`. */
export function envelope(code: string, message: string, details?: unknown): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code, message: stripUrlsInText(message), ...(details === undefined ? {} : { details: scrubDetails(details) }) } };
}

/** `app.onError`: ApiError → its envelope; anything else → 500 without internals, logged URL-free. */
export function onError(log: Logger) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.details), err.status);
    log.error({ err: { name: err.name, message: stripUrlsInText(err.message) } }, 'unhandled error');
    return c.json(envelope('internal', API_TEXT.internal), 500);
  };
}

/** `app.notFound`: the router matched nothing. Handlers use their own codes (`definition_not_found`, …). */
export function notFound(c: Context) {
  return c.json(envelope('not_found', API_TEXT.notFound), 404);
}
```

`src/logger.ts` (redaction lands in Task 8.5, with its failing test):

```ts
import type { Config, Logger } from '@gmt/core';
import pino from 'pino';

/** pino JSON to stdout (spec §14). `destination` is injected by tests to capture lines. */
export function createLogger(level: Config['logLevel'], destination?: pino.DestinationStream): Logger {
  const logger: Logger = destination === undefined ? pino({ level }) : pino({ level }, destination);
  return logger;
}
```

`src/routes/types.ts`:

```ts
import type { Engine } from '@gmt/engine';
import type { Context } from 'hono';
import type { Ports } from '../wiring.js';

/** Every ROUTES path is mounted under this prefix so SPA paths never collide with API paths (Open question 1). */
export const API_PREFIX = '/api';

/** Request-scoped variables set by middleware. */
export interface AppVariables {
  /** True when the request carried valid basic-auth credentials, or auth is disabled by config. */
  authenticated: boolean;
  /** Set by the optional-JSON validator: whether a body was sent and its parsed value. */
  optionalBody?: { present: boolean; value: unknown };
}
export type AppEnv = { Variables: AppVariables };
export type RouteKey = `${'GET' | 'POST' | 'PUT' | 'DELETE'} ${string}`;

/** Result of an in-process tool run (spec §10 `/tools/*`). */
export interface ToolRunResult { ok: boolean; exitCode: number; lines: string[] }
/** In-process tool entry points; absent means the route answers 503 tool_unavailable. */
export interface ToolRunners {
  smoke?: (args: Record<string, never>) => Promise<ToolRunResult>;
  record?: (args: { budget: number }) => Promise<ToolRunResult>;
}

export interface RouteInput { body: unknown; query: unknown; params: Record<string, string> }
export interface RouteContext { ports: Ports; engine: Engine; tools: ToolRunners; toolInFlight: { name: string | null } }
export type RouteHandler = (c: Context<AppEnv>, input: RouteInput, ctx: RouteContext) => Response | Promise<Response>;
/** Handlers keyed exactly as `${method} ${path}` of a ROUTES entry. */
export type HandlerTable = Partial<Record<RouteKey, RouteHandler>>;
```

`src/read/executions.ts` (scope helpers; `executionResponse` joins in Task 8.10):

```ts
import type { BudgetScope, Config, ProviderId, ProviderLimits } from '@gmt/core';
import type { Ports } from '../wiring.js';

/** The configured limits for a provider; the fixture provider has none (test cost rule lives in the guard). */
export function providerLimits(config: Config, id: ProviderId): ProviderLimits | null {
  if (id === 'travelpayouts') return config.providers.travelpayouts?.limits ?? null;
  if (id === 'searchapi') return config.providers.searchapi?.limits ?? null;
  return null;
}

/** Spec §7 "Budget windows": a `trial` plan is a lifetime window, everything else monthly. */
export function providerScope(config: Config, providerId: ProviderId): BudgetScope {
  return { kind: providerLimits(config, providerId)?.window === 'lifetime' ? 'provider-lifetime' : 'provider-month', providerId };
}

/** Stable wire label for a scope, e.g. `provider-month:searchapi`, `execution-calls`, `global-month`. */
export function scopeLabel(s: BudgetScope): string {
  return 'providerId' in s ? `${s.kind}:${s.providerId}` : s.kind;
}

/** Every scope the spec §8.1 pre-start check uses: execution scopes (when an execution is given), each provider, global. */
export function budgetScopes(ports: Ports, executionId: string | null): BudgetScope[] {
  const scopes: BudgetScope[] = [];
  if (executionId !== null) {
    for (const kind of ['execution-calls', 'execution-free-calls', 'execution-cost'] as const) scopes.push({ kind, executionId });
  }
  for (const p of ports.providers) scopes.push(providerScope(ports.config, p.id));
  scopes.push({ kind: 'global-month' });
  return scopes;
}
```

`src/routes/system.ts` (health detail, budget and scheduler jobs join in Task 8.8):

```ts
import type { Ports } from '../wiring.js';
import { providerLimits, providerScope, scopeLabel } from '../read/executions.js';
import { API_TEXT } from '../text.js';
import type { HandlerTable, RouteContext } from './types.js';

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

/** Spec §10 `GET /providers`: capabilities, plan, usage vs caps with window bounds, zero-cap message. */
export function providersResponse(ctx: RouteContext) {
  const { config, budget } = ctx.ports;
  const providers = ctx.ports.providers.map((p) => {
    const scope = providerScope(config, p.id);
    return {
      id: p.id,
      displayName: p.displayName,
      plan: p.id === 'searchapi' ? (config.providers.searchapi?.plan ?? null) : null,
      // why: travelpayouts is never billable (spec §5.3); fixture is billable at its test cost.
      billed: p.id !== 'travelpayouts',
      capabilities: { discovery: p.discovery?.info ?? null, verification: p.verification?.info ?? null },
      cabins: [...p.cabins],
      usage: { scope: scopeLabel(scope), usage: budget.usage(scope) },
      excludedFromSchedule: providerLimits(config, p.id)?.excludedFromSchedule ?? false,
    };
  });
  const searchapiEnabled = ctx.ports.providers.some((p) => p.id === 'searchapi');
  return {
    providers,
    global: budget.usage({ kind: 'global-month' }),
    messages: searchapiEnabled && config.spend.monthlyCapMicroGbp === 0 ? [API_TEXT.zeroCapVerification] : [],
  };
}

export const systemHandlers: HandlerTable = {
  'GET /health': (c, _input, ctx) => c.json(healthPublic(ctx)),
  'GET /providers': (c, _input, ctx) => c.json(providersResponse(ctx)),
};
```

`src/routes/index.ts`:

```ts
import { systemHandlers } from './system.js';
import type { HandlerTable } from './types.js';

/** Every handler, keyed by its ROUTES entry. Later tasks add one spread line each. */
export const HANDLERS: HandlerTable = {
  ...systemHandlers,
};
```

`src/middleware/auth.ts` (the rate limit lands in Task 8.7):

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config, Secret } from '@gmt/core';
import type { MiddlewareHandler } from 'hono';
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
export function credentialsMatch(header: string | undefined, expected: { user: string; pass: Secret }): 'absent' | 'valid' | 'invalid' {
  if (header === undefined) return 'absent';
  if (!header.startsWith('Basic ')) return 'invalid';
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return 'invalid';
  const userOk = timingSafeEqual(digest(decoded.slice(0, colon)), digest(expected.user));
  const passOk = timingSafeEqual(digest(decoded.slice(colon + 1)), digest(expected.pass.reveal()));
  return userOk && passOk ? 'valid' : 'invalid';
}

export interface AuthGateOptions {
  config: Config;
  /** `${method} ${fullPath}` of every ROUTES entry whose auth flag is `public`. */
  publicKeys: ReadonlySet<string>;
}

/**
 * Spec §4: everything except the public `GET /health` needs auth, static files included.
 * Sets `authenticated` so the public route can return its authenticated detail.
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
    const result = credentialsMatch(c.req.header('authorization'), auth);
    if (result === 'valid') {
      c.set('authenticated', true);
      return next();
    }
    c.set('authenticated', false);
    if (isPublic) return next();
    c.header('WWW-Authenticate', 'Basic realm="get-me-there", charset="UTF-8"');
    return c.json(envelope('unauthenticated', API_TEXT.unauthenticated), 401);
  };
}
```

`src/middleware/validate.ts`:

```ts
import type { apiContract } from '@gmt/core';
import { zValidator } from '@hono/zod-validator';
import type { Context, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { envelope } from '../errors.js';
import type { AppEnv, RouteInput } from '../routes/types.js';
import { API_TEXT } from '../text.js';

type RouteDef = apiContract.RouteDef;

function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

function hook(target: 'json' | 'query') {
  return (result: { success: boolean; error?: z.ZodError }, c: Context<AppEnv>) => {
    if (!result.success && result.error !== undefined) {
      return c.json(envelope('validation', API_TEXT.validation(target === 'json' ? 'body' : 'query'), issuesOf(result.error)), 400);
    }
    return undefined;
  };
}

/** True for request schemas that accept a missing body (only `POST /definitions`, spec §10). */
export function acceptsUndefined(schema: z.ZodTypeAny): boolean {
  return schema.safeParse(undefined).success;
}

/**
 * Body validator for schemas that accept "no body". zValidator('json') rejects an empty body as
 * malformed JSON, so this reads the text itself; a present body is validated by the same schema.
 */
function optionalJson(schema: z.ZodTypeAny): MiddlewareHandler<AppEnv> {
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
    if (!r.success) return c.json(envelope('validation', API_TEXT.validation('body'), issuesOf(r.error)), 400);
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
  if (route.query !== undefined) mws.push(zValidator('query', route.query, hook('query')));
  if (route.request !== undefined) {
    mws.push(acceptsUndefined(route.request) ? optionalJson(route.request) : zValidator('json', route.request, hook('json')));
  }
  return mws;
}

/** Validated inputs for a handler. The route table is dynamic, so the typed `valid()` overloads cannot apply. */
export function readInput(c: Context<AppEnv>, route: RouteDef): RouteInput {
  // why: Hono types `valid()` from the route's static input; with a table-driven mount that type is
  // empty, so the validated values are read as `unknown` and each handler narrows with its schema type.
  const req = c.req as unknown as { valid(target: 'json' | 'query'): unknown };
  const body =
    route.request === undefined ? undefined : acceptsUndefined(route.request) ? c.get('optionalBody')?.value : req.valid('json');
  const query = route.query === undefined ? undefined : req.valid('query');
  return { body, query, params: c.req.param() as Record<string, string> };
}
```

`src/app.ts`:

```ts
import { apiContract } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import { type Context, Hono } from 'hono';
import { every } from 'hono/combine';
import { notFound, onError } from './errors.js';
import { basicAuthGate } from './middleware/auth.js';
import { readInput, validatorsFor } from './middleware/validate.js';
import { HANDLERS } from './routes/index.js';
import { API_PREFIX, type AppEnv, type RouteContext, type RouteKey, type ToolRunners } from './routes/types.js';
import type { Ports } from './wiring.js';

export { API_PREFIX };

export interface AppOptions {
  /** Directory of the built SPA (`apps/web/dist`); null serves no static files. */
  webRoot?: string | null;
  tools?: ToolRunners;
  /** Source IP for the failed-auth limit; tests inject it, production derives it (Task 8.7). */
  clientIp?: (c: Context<AppEnv>) => string | null;
  /** The route table to mount; defaults to `apiContract.ROUTES`. Tests pass a modified table. */
  routes?: readonly apiContract.RouteDef[];
}

export function publicRouteKeys(routes: readonly apiContract.RouteDef[]): Set<string> {
  return new Set(routes.filter((r) => r.auth === 'public').map((r) => `${r.method} ${API_PREFIX}${r.path}`));
}

/**
 * The single HTTP surface (spec §10): one Hono app mounting every ROUTES entry from
 * `@gmt/core` api-contract with zod validation, the error envelope and the auth gate.
 */
export function createApp(ports: Ports, engine: Engine, options: AppOptions = {}): Hono<AppEnv> {
  const routes = options.routes ?? apiContract.ROUTES;
  const ctx: RouteContext = { ports, engine, tools: options.tools ?? {}, toolInFlight: { name: null } };
  const app = new Hono<AppEnv>();
  app.onError(onError(ports.log));
  app.notFound(notFound);
  app.use('*', basicAuthGate({ config: ports.config, publicKeys: publicRouteKeys(routes) }));

  const api = new Hono<AppEnv>();
  api.onError(onError(ports.log));
  for (const route of routes) {
    const handler = HANDLERS[`${route.method} ${route.path}` as RouteKey];
    if (handler === undefined) continue;
    api.on(route.method, route.path, every(...validatorsFor(route)), async (c) => handler(c, readInput(c, route), ctx));
  }
  app.route(API_PREFIX, api);
  return app;
}
```

`src/bootstrap/paths.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AirportsDataset } from '@gmt/db';

export interface AssetPaths { migrationsDir: string; airportsDataDir: string; webRoot: string | null; backupModule: string }

// why: src/bootstrap (tsx) and dist/bootstrap (build) are both four levels below the repository root,
// so one set of relative URLs serves dev, tests and the image (WP12 keeps the layout).
const fromHere = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

/** Where the bootstrap finds migrations, the vendored airports dataset, the SPA and the backup script. */
export function assetPaths(): AssetPaths {
  const web = fromHere('../../../web/dist/');
  return {
    migrationsDir: fromHere('../../../../packages/db/drizzle'),
    airportsDataDir: fromHere('../../../../packages/db/data'),
    webRoot: existsSync(join(web, 'index.html')) ? web : null,
    backupModule: fromHere('../../../../scripts/backup.mjs'),
  };
}

/** Loads the single vendored `airports.<version>.json` (spec §7: no network at seed). */
export function loadAirportsDataset(dir: string): AirportsDataset {
  const files = readdirSync(dir).filter((f) => /^airports\..+\.json$/.test(f));
  const [file, ...rest] = files;
  if (file === undefined || rest.length > 0) throw new Error(`expected exactly one airports.<version>.json in ${dir}, found ${files.length}`);
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as AirportsDataset;
}
```

`src/bootstrap/app.ts`:

```ts
import { type Clock, type Config, type Logger, stripUrlsInText, systemClock } from '@gmt/core';
import { AppLock, seedAirports } from '@gmt/db';
import { type Engine, LogNotifier, createEngine } from '@gmt/engine';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import type { AppEnv, ToolRunners } from '../routes/types.js';
import { type Ports, buildPorts, loadConfigFromEnv } from '../wiring.js';
import { type AssetPaths, assetPaths, loadAirportsDataset } from './paths.js';

/** A boot refusal: logged with its message and the process exits 1. */
export class BootError extends Error {
  constructor(message: string) {
    super(stripUrlsInText(message));
    this.name = 'BootError';
  }
}

/** Spec §7: heartbeat every 30 s. */
export const HEARTBEAT_MS = 30_000;

export interface BootDeps {
  config: Config;
  log: Logger;
  clock?: Clock;
  /** false in tests that drive the app with `app.request()`. */
  listen: boolean;
  assets: AssetPaths;
  /** Builds the in-process tool runners once ports exist (Task 8.14). */
  tools?: (ports: Ports) => ToolRunners;
}

export interface RunningApp {
  app: Hono<AppEnv>;
  ports: Ports;
  engine: Engine;
  /** The bound port when listening, else null. */
  port: number | null;
  /** Graceful shutdown (spec §13); idempotent. */
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

function messageOf(err: unknown): string {
  return stripUrlsInText(err instanceof Error ? err.message : String(err));
}

/**
 * Everything the app process does at start, with config injected (spec §5.5 boot matrix):
 * ports → seed → app_lock → engine.boot → serve.
 */
export async function bootApp(deps: BootDeps): Promise<RunningApp> {
  const { config, log } = deps;
  const clock = deps.clock ?? systemClock;
  const ports = buildPorts(config, { log, clock, migrationsDir: deps.assets.migrationsDir });
  try {
    seedAirports(ports.db, loadAirportsDataset(deps.assets.airportsDataDir));
    const lock = new AppLock(ports.db, 'app', clock, log);
    if (lock.acquire({ waitMs: 0 }) !== 'acquired') throw new BootError('app_lock is held by another process; refusing to start');
    const heartbeat = setInterval(() => lock.heartbeat(), HEARTBEAT_MS);
    heartbeat.unref();
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
        await closeServer(bound?.server ?? null);
        await engine.shutdown();
        clearInterval(heartbeat);
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

/** The app entrypoint: env parsed once (spec §12), boot, signals. Throws on refusal; start.ts exits 1. */
export async function main(env: NodeJS.ProcessEnv): Promise<void> {
  const config = loadConfigFromEnv(env);
  const log = createLogger(config.logLevel);
  let running: RunningApp;
  try {
    running = await bootApp({ config, log, listen: true, assets: assetPaths() });
  } catch (err) {
    log.error({ err: { message: messageOf(err) } }, 'boot failed');
    throw err;
  }
  log.info({ port: running.port, bindAddress: config.bindAddress }, 'listening');
  const stop = (signal: string) => {
    log.info({ signal }, 'shutting down');
    running.close().then(
      () => process.exit(0),
      (err: unknown) => {
        log.error({ err: { message: messageOf(err) } }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
```

`src/bootstrap/start.ts`:

```ts
// The process entry (`pnpm --filter @gmt/api start`, `dev`, and the WP12 image CMD).
import { main } from './app.js';

main(process.env).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- boot.spawn && pnpm --filter @gmt/api typecheck`
Expected: PASS, 1 test; the child logs `"msg":"listening"`, `GET /api/providers` returns 200 without `fixture`, the child exits 0 on SIGTERM, the fixture constructor throws and the synthetic insert throws a message containing "synthetic"; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: app bootstrap and production-boot-lacks-fixture spawn test"
```

### Task 8.2: Injected-config boot matrix, `NODE_ENV=test` refusal, password length, airport sanity check

**Files:**
- Modify: `src/bootstrap/app.ts`
- Test: `test/boot.matrix.test.ts`

**Interfaces:**
- Consumes: `sanityCheckAirports`, `DefinitionsRepo.list` (WP3); `loadConfigFromEnv` (WP4b).
- Produces: `bootApp` refuses `nodeEnv === 'test'` before opening the database; boot fails when `sanityCheckAirports` fails.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_OPT_IN_PHRASE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type RunningApp, bootApp } from '../src/bootstrap/app.js';
import { type AssetPaths, assetPaths, loadAirportsDataset } from '../src/bootstrap/paths.js';
import { createLogger } from '../src/logger.js';
import { loadConfigFromEnv } from '../src/wiring.js';

const PASS = 'test-basic-auth-pass-0123456789';
const authHeader = `Basic ${Buffer.from(`operator:${PASS}`).toString('base64')}`;

function envFor(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'gmt-matrix-'));
  return {
    NODE_ENV: 'production',
    DATABASE_PATH: join(dir, 'm.fixture.db'),
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: PASS,
    ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
    LOG_LEVEL: 'error',
    ...overrides,
  };
}

async function bootWith(env: Record<string, string | undefined>, assets: AssetPaths = assetPaths()): Promise<RunningApp> {
  return bootApp({ config: loadConfigFromEnv(env), log: createLogger('error'), listen: false, assets });
}

describe('injected-config boot matrix (spec §5.5)', () => {
  it.each([
    // label, env overrides, fixture offered?
    ['production with the phrase and .fixture.db', {}, false],
    ['development, phrase, .fixture.db, not in a container', { NODE_ENV: 'development' }, true],
    ['development in a container', { NODE_ENV: 'development', IN_CONTAINER: '1' }, false],
    ['development with the wrong phrase', { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: 'yes' }, false],
    ['development without the phrase', { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: undefined }, false],
  ] as const)('%s → fixture offered: %s', async (_label, overrides, expected) => {
    const running = await bootWith(envFor(overrides));
    try {
      expect(running.ports.providers.some((p) => p.id === 'fixture')).toBe(expected);
      const res = await running.app.request('http://localhost:3000/api/providers', { headers: { host: 'localhost:3000', authorization: authHeader } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { providers: Array<{ id: string }> };
      expect(body.providers.some((p) => p.id === 'fixture')).toBe(expected);
    } finally {
      await running.close();
    }
  });

  it('development with the phrase but a plain .db path offers no fixture', async () => {
    const env = envFor({ NODE_ENV: 'development' });
    const running = await bootWith({ ...env, DATABASE_PATH: String(env.DATABASE_PATH).replace('.fixture.db', '.db') });
    try {
      expect(running.ports.providers.some((p) => p.id === 'fixture')).toBe(false);
    } finally {
      await running.close();
    }
  });

  it('refuses NODE_ENV=test before touching the database', async () => {
    const env = envFor({ NODE_ENV: 'test' });
    await expect(bootWith({ ...env, DATABASE_PATH: String(env.DATABASE_PATH).replace('.fixture.db', '.test.db') })).rejects.toThrow(/NODE_ENV=test/);
  });

  it('a password shorter than 12 characters fails boot naming the variable', () => {
    expect(() => loadConfigFromEnv(envFor({ APP_BASIC_AUTH_PASS: 'elevenchars' }))).toThrow(/APP_BASIC_AUTH_PASS/);
  });

  it('a failed airport sanity check fails boot', async () => {
    const real = loadAirportsDataset(assetPaths().airportsDataDir) as unknown;
    // why: shape-agnostic truncation so this test does not depend on the dataset's field names.
    const tiny = Array.isArray(real)
      ? real.slice(0, 10)
      : Object.fromEntries(Object.entries(real as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 10) : v]));
    const dataDir = mkdtempSync(join(tmpdir(), 'gmt-airports-'));
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'airports.tiny.json'), JSON.stringify(tiny));
    await expect(bootWith(envFor({}), { ...assetPaths(), airportsDataDir: dataDir })).rejects.toThrow(/airport sanity check failed/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- boot.matrix`
Expected: FAIL on "refuses NODE_ENV=test" (boot proceeds) and "a failed airport sanity check fails boot" (resolves); the matrix rows and the password row pass already, because the gates live in WP0/WP4b and Task 8.1 wires them.

- [ ] **Step 3: Implement**

In `src/bootstrap/app.ts`, add `sanityCheckAirports` to the `@gmt/db` import, then make these two edits inside `bootApp`.

Insert as the first statement after `const clock = …`:

```ts
  // why: spec §5.5: both bootstraps refuse NODE_ENV=test, so a test config can never serve traffic.
  if (config.nodeEnv === 'test') throw new BootError('the app bootstrap refuses NODE_ENV=test (spec §5.5); use development or production');
```

Replace the line `seedAirports(ports.db, loadAirportsDataset(deps.assets.airportsDataDir));` with:

```ts
    seedAirports(ports.db, loadAirportsDataset(deps.assets.airportsDataDir));
    // Spec §7: at least 5,000 airports with tz, and every airport an enabled definition references exists.
    const referenced = [
      ...new Set(ports.repos.definitions.list().filter((d) => d.enabled && d.deletedAt === null).flatMap((d) => [...d.origins, ...d.destinations])),
    ];
    const sanity = sanityCheckAirports(ports.db, referenced);
    if (!sanity.ok) throw new BootError(`airport sanity check failed: ${sanity.reason}`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- boot`
Expected: PASS, the spawn test and 9 matrix tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: boot matrix, NODE_ENV=test refusal, airport sanity check fails boot"
```

### Task 8.3: `app_lock` waits for the app holder

**Files:**
- Create: `src/bootstrap/lock.ts`
- Modify: `src/bootstrap/app.ts`
- Test: `test/lock.test.ts`

**Interfaces:**
- Consumes: `AppLock`, `AppLock.inspect` (WP3); `fixedClock` (WP0).
- Produces: `acquireAppLockWithWaits`, `TOOL_LOCK_WAIT_MS`, `APP_LOCK_WAIT_MS`, `LOCK_POLL_MS`, `LockRefusedError`; `BootDeps.sleep?`.

Rule implemented (spec §7): poll every second. A fresh `tool` lock: refuse once 60 s have passed. A fresh `app` lock: keep polling and take it over as soon as WP3's `acquire` judges it stale (three missed 30 s beats); if it is still heartbeating after 90 s, a second live app process holds it, so refuse rather than run two writers. The lock age is logged every 10 s while waiting.

- [ ] **Step 1: Write the failing test**

```ts
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AppLock } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { APP_LOCK_WAIT_MS, TOOL_LOCK_WAIT_MS, acquireAppLockWithWaits } from '../src/bootstrap/lock.js';
import { assetPaths } from '../src/bootstrap/paths.js';
import { createLogger } from '../src/logger.js';
import { buildPorts, loadConfigFromEnv } from '../src/wiring.js';

function setup(onSleep: (totalMs: number) => void = () => {}) {
  const config = loadConfigFromEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' });
  const clock = fixedClock(asIsoDateTime('2026-10-14T09:00:00.000Z'));
  const lines: string[] = [];
  const log = createLogger('debug', { write: (s: string) => void lines.push(s) });
  const ports = buildPorts(config, { log, clock, migrationsDir: assetPaths().migrationsDir });
  let slept = 0;
  const sleep = async (ms: number) => {
    slept += ms;
    clock.advance(ms);
    onSleep(slept);
  };
  const acquire = () =>
    acquireAppLockWithWaits({ lock: new AppLock(ports.db, 'app', clock, log), inspect: () => AppLock.inspect(ports.db), clock, sleep, log });
  return { ports, clock, log, lines, acquire, slept: () => slept };
}

describe('app_lock waits for the app holder (spec §7)', () => {
  it('acquires a free lock without waiting', async () => {
    const s = setup();
    await s.acquire();
    expect(s.slept()).toBe(0);
    expect(AppLock.inspect(s.ports.db)?.holder).toBe('app');
  });

  it('waits 60 s on a fresh tool lock, then refuses', async () => {
    const s = setup();
    expect(new AppLock(s.ports.db, 'tool', s.clock, s.log).acquire({ waitMs: 0 })).toBe('acquired');
    await expect(s.acquire()).rejects.toThrow(/tool/);
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
    new AppLock(s.ports.db, 'app', s.clock, s.log).acquire({ waitMs: 0 }); // the previous process, now dead: no heartbeats
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

Run: `pnpm --filter @gmt/api test -- lock`
Expected: FAIL, `Cannot find module '../src/bootstrap/lock.js'`.

- [ ] **Step 3: Implement**

`src/bootstrap/lock.ts`:

```ts
import { type Clock, type IsoDateTime, type Logger, stripUrlsInText } from '@gmt/core';
import type { AppLock } from '@gmt/db';

/** Spec §7: a fresh tool lock makes the app wait up to 60 s, then refuse. */
export const TOOL_LOCK_WAIT_MS = 60_000;
/** Spec §7: a fresh app lock makes the app wait up to 90 s (three missed 30 s beats), then take over. */
export const APP_LOCK_WAIT_MS = 90_000;
export const LOCK_POLL_MS = 1_000;
const LOG_EVERY_MS = 10_000;

export class LockRefusedError extends Error {
  constructor(message: string) {
    super(stripUrlsInText(message));
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
 * The app holder's acquisition policy (spec §7). Liveness is judged by heartbeat age inside
 * WP3's `acquire`, never by pid; this function only decides how long to keep asking.
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

In `src/bootstrap/app.ts`: import `acquireAppLockWithWaits` from `./lock.js`; add to `BootDeps`:

```ts
  /** Injected by tests to advance a fixed clock instead of waiting. */
  sleep?: (ms: number) => Promise<void>;
```

and replace the line `if (lock.acquire({ waitMs: 0 }) !== 'acquired') throw new BootError('app_lock is held by another process; refusing to start');` with:

```ts
    await acquireAppLockWithWaits({
      lock,
      inspect: () => AppLock.inspect(ports.db),
      clock,
      sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
      log,
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- lock boot`
Expected: PASS, 5 lock tests and the boot tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: app_lock waits: 60 s refuse on a tool lock, stale takeover of an app lock"
```

### Task 8.4: Pre-migration backup when migrations are pending

**Files:**
- Create: `src/bootstrap/migrations.ts`, `src/bootstrap/backup.ts`
- Modify: `src/bootstrap/app.ts`
- Test: `test/backup.test.ts`

**Interfaces:**
- Consumes: `openDatabase` (WP0); `backupDatabase` from `scripts/backup.mjs` (WP12, loaded at runtime).
- Produces: `pendingMigrations(dbPath, migrationsDir): { fresh: boolean; pending: string[] }`, `loadBackup(modulePath)`, `BootDeps.backup?`.

Rule (spec §7, §13): when the database already holds applied migrations and the bundled journal has newer entries, call `backup(dbPath)` before `buildPorts` applies them; a backup failure refuses boot and leaves the schema untouched. A database with no applied migrations (new file, or no `__drizzle_migrations` table) has nothing to back up and is migrated directly.

- [ ] **Step 1: Write the failing test**

```ts
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@gmt/db';
import { describe, expect, it, vi } from 'vitest';
import { bootApp } from '../src/bootstrap/app.js';
import { loadBackup } from '../src/bootstrap/backup.js';
import { pendingMigrations } from '../src/bootstrap/migrations.js';
import { assetPaths } from '../src/bootstrap/paths.js';
import { createLogger } from '../src/logger.js';
import { loadConfigFromEnv } from '../src/wiring.js';

function config(dbPath: string) {
  return loadConfigFromEnv({
    NODE_ENV: 'production',
    DATABASE_PATH: dbPath,
    BIND_ADDRESS: '127.0.0.1',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: 'test-basic-auth-pass-0123456789',
    LOG_LEVEL: 'error',
  });
}

/** A copy of the bundled migrations plus one journal entry newer than anything applied. */
function migrationsWithProbe(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'gmt-mig-')), 'drizzle');
  cpSync(assetPaths().migrationsDir, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<Record<string, unknown>> };
  const last = journal.entries[journal.entries.length - 1] ?? {};
  journal.entries.push({ ...last, idx: journal.entries.length, when: Date.now() + 60_000, tag: '9999_wp8_probe' });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, '9999_wp8_probe.sql'), 'CREATE TABLE wp8_probe (id integer);');
  return dir;
}

function hasProbe(dbPath: string): boolean {
  const db = openDatabase(dbPath);
  try {
    return db.raw.prepare("select name from sqlite_master where type = 'table' and name = 'wp8_probe'").get() !== undefined;
  } finally {
    db.close();
  }
}

async function bootOnce(dbPath: string, backup: (p: string) => Promise<void>, migrationsDir = assetPaths().migrationsDir) {
  const running = await bootApp({ config: config(dbPath), log: createLogger('error'), listen: false, backup, assets: { ...assetPaths(), migrationsDir } });
  await running.close();
}

describe('pre-migration backup (spec §7 Migrations, §13 Backup)', () => {
  it('a new database is migrated without a backup; an up-to-date one is not backed up either', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-bk-')), 'b.db');
    expect(pendingMigrations(dbPath, assetPaths().migrationsDir).fresh).toBe(true);
    const backup = vi.fn(async (_p: string) => {});
    await bootOnce(dbPath, backup);
    expect(pendingMigrations(dbPath, assetPaths().migrationsDir)).toEqual({ fresh: false, pending: [] });
    await bootOnce(dbPath, backup);
    expect(backup).not.toHaveBeenCalled();
  });

  it('backs up before applying pending migrations', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-bk-')), 'b.db');
    await bootOnce(dbPath, async () => {});
    const probeDir = migrationsWithProbe();
    expect(pendingMigrations(dbPath, probeDir).pending).toEqual(['9999_wp8_probe']);
    const backup = vi.fn(async (p: string) => {
      expect(hasProbe(p)).toBe(false); // why: the backup must see the pre-migration schema
    });
    await bootOnce(dbPath, backup, probeDir);
    expect(backup).toHaveBeenCalledWith(dbPath);
    expect(hasProbe(dbPath)).toBe(true);
  });

  it('a failed backup refuses boot and leaves the schema unmigrated', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-bk-')), 'b.db');
    await bootOnce(dbPath, async () => {});
    const failing = async () => {
      throw new Error('disk full writing /data/backups/x.db');
    };
    await expect(bootOnce(dbPath, failing, migrationsWithProbe())).rejects.toThrow(/pre-migration backup failed, migrations refused: disk full/);
    expect(hasProbe(dbPath)).toBe(false);
  });

  it('loadBackup fails closed when the WP12 module is missing and calls backupDatabase when present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmt-bkmod-'));
    await expect(loadBackup(join(dir, 'missing.mjs'))(join(dir, 'x.db'))).rejects.toThrow(/backup unavailable/);
    const mod = join(dir, 'backup.mjs');
    writeFileSync(mod, "import { writeFileSync } from 'node:fs';\nexport async function backupDatabase(p) { writeFileSync(`${p}.marker`, 'ok'); return `${p}.bak`; }\n");
    await loadBackup(mod)(join(dir, 'x.db'));
    expect(existsSync(join(dir, 'x.db.marker'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- backup`
Expected: FAIL, `Cannot find module '../src/bootstrap/backup.js'`.

- [ ] **Step 3: Implement**

`src/bootstrap/migrations.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '@gmt/db';

interface Journal { entries: Array<{ when: number; tag: string }> }

/**
 * Which bundled migrations the database has not applied yet. Mirrors the Drizzle SQLite
 * migrator, which applies journal entries whose `when` exceeds the newest
 * `__drizzle_migrations.created_at`. `fresh` means nothing was ever applied, so there is
 * nothing to back up (spec §7: the backup protects existing data from a migration).
 */
export function pendingMigrations(dbPath: string, migrationsDir: string): { fresh: boolean; pending: string[] } {
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8')) as Journal;
  const all = journal.entries.map((e) => e.tag);
  if (dbPath === ':memory:' || !existsSync(dbPath)) return { fresh: true, pending: all };
  const db = openDatabase(dbPath);
  try {
    const table = db.raw.prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
    if (table === undefined) return { fresh: true, pending: all };
    const row = db.raw.prepare('select max(created_at) as last from __drizzle_migrations').get() as { last: number | null };
    if (row.last === null) return { fresh: true, pending: all };
    const last = Number(row.last);
    return { fresh: false, pending: journal.entries.filter((e) => e.when > last).map((e) => e.tag) };
  } finally {
    db.close();
  }
}
```

`src/bootstrap/backup.ts`:

```ts
import { pathToFileURL } from 'node:url';

/**
 * The production backup port: `backupDatabase` from `scripts/backup.mjs` (WP12), loaded when
 * needed so the api builds before WP12 merges. Fails closed: no module, no migration.
 */
export function loadBackup(modulePath: string): (dbPath: string) => Promise<void> {
  return async (dbPath) => {
    let mod: { backupDatabase?: unknown };
    try {
      mod = (await import(pathToFileURL(modulePath).href)) as { backupDatabase?: unknown };
    } catch {
      throw new Error(`backup unavailable: ${modulePath} could not be loaded`);
    }
    if (typeof mod.backupDatabase !== 'function') throw new Error(`backup unavailable: ${modulePath} does not export backupDatabase`);
    await (mod.backupDatabase as (p: string) => Promise<unknown>)(dbPath);
  };
}
```

In `src/bootstrap/app.ts`: import `pendingMigrations` from `./migrations.js` and `loadBackup` from `./backup.js`; add to `BootDeps`:

```ts
  /** Pre-migration backup (spec §7); defaults to scripts/backup.mjs `backupDatabase`. */
  backup?: (dbPath: string) => Promise<void>;
```

and insert immediately before `const ports = buildPorts(`:

```ts
  const migrations = pendingMigrations(config.databasePath, deps.assets.migrationsDir);
  if (!migrations.fresh && migrations.pending.length > 0) {
    log.info({ pending: migrations.pending }, 'migrations pending; backing up first');
    const backup = deps.backup ?? loadBackup(deps.assets.backupModule);
    try {
      await backup(config.databasePath);
    } catch (err) {
      throw new BootError(`pre-migration backup failed, migrations refused: ${messageOf(err)}`);
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- backup boot`
Expected: PASS, 4 backup tests and the boot tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: pre-migration backup port; a failed backup refuses migrations"
```

### Task 8.5: Graceful shutdown order, heartbeat, and pino redaction

**Files:**
- Modify: `src/bootstrap/app.ts`, `src/logger.ts`
- Test: `test/shutdown.test.ts`, `test/logger.test.ts`

**Interfaces:**
- Produces: `BootDeps.timers?`; `REDACT_PATHS`; `createLogger` with redaction and URL stripping.

- [ ] **Step 1: Write the failing tests**

`test/shutdown.test.ts`:

```ts
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppLock, openDatabase } from '@gmt/db';
import { describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, bootApp } from '../src/bootstrap/app.js';
import { assetPaths } from '../src/bootstrap/paths.js';
import { createLogger } from '../src/logger.js';
import { loadConfigFromEnv } from '../src/wiring.js';

function first(order: number[]): number {
  const v = order[0];
  if (v === undefined) throw new Error('not called');
  return v;
}

describe('graceful shutdown (spec §7, §13)', () => {
  it('heartbeats every 30 s and shuts down: engine → checkpoint → release lock → close', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-sd-')), 's.db');
    const config = loadConfigFromEnv({ NODE_ENV: 'development', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1', LOG_LEVEL: 'error' });
    let tick: (() => void) | undefined;
    let intervalMs = 0;
    const handle = { id: 'heartbeat' };
    const cleared: unknown[] = [];
    const timers = {
      setInterval: (fn: () => void, ms: number) => {
        tick = fn;
        intervalMs = ms;
        return handle;
      },
      clearInterval: (h: unknown) => void cleared.push(h),
    };
    const running = await bootApp({ config, log: createLogger('error'), listen: false, assets: assetPaths(), timers });
    expect(intervalMs).toBe(HEARTBEAT_MS);
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
  });
});
```

`test/logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, createLogger } from '../src/logger.js';

function capture() {
  const lines: string[] = [];
  return { lines, log: createLogger('debug', { write: (s: string) => void lines.push(s) }) };
}

describe('pino setup (spec §14, §5.3)', () => {
  it('redacts exactly the spec paths', () => {
    expect(REDACT_PATHS).toEqual(['apiKey', 'token', 'authorization', 'url.query', 'req.headers.authorization']);
    const { lines, log } = capture();
    log.info({ apiKey: 'sentinel-1', token: 'sentinel-2', authorization: 'sentinel-3', url: { query: 'sentinel-4', path: '/x' }, req: { headers: { authorization: 'sentinel-5' } } }, 'probe');
    const text = lines.join('');
    for (const n of [1, 2, 3, 4, 5]) expect(text).not.toContain(`sentinel-${n}`);
    expect(text).toContain('[redacted]');
    expect(text).toContain('"path":"/x"');
  });

  it('strips query strings and userinfo from every logged string, in fields and messages', () => {
    const { lines, log } = capture();
    log.warn({ note: 'GET https://user:pw@api.example.com/v1/x?api_key=SENTINEL failed', nested: { list: ['https://a.example/p?token=SENTINEL2'] } }, 'see https://b.example/q?key=SENTINEL3');
    const text = lines.join('');
    expect(text).not.toContain('SENTINEL');
    expect(text).not.toContain('pw@');
    expect(text).toContain('https://api.example.com/v1/x');
  });

  it('child loggers keep the rules', () => {
    const { lines, log } = capture();
    log.child({ executionId: 'e1' }).info({ token: 'sentinel-6' }, 'child');
    expect(lines.join('')).not.toContain('sentinel-6');
    expect(lines.join('')).toContain('"executionId":"e1"');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api test -- shutdown logger`
Expected: FAIL: `REDACT_PATHS` is not exported; `bootApp` ignores `timers` (`intervalMs` stays 0).

- [ ] **Step 3: Implement**

`src/logger.ts` (replaces the Task 8.1 file):

```ts
import { type Config, type Logger, stripUrlsInText } from '@gmt/core';
import pino from 'pino';

/** Spec §14: exactly these paths, censored. */
export const REDACT_PATHS = ['apiKey', 'token', 'authorization', 'url.query', 'req.headers.authorization'] as const;

/** Deep copy with every string URL-stripped (spec §5.3: no sink holds a query string or userinfo). */
function stripDeep(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return stripUrlsInText(value);
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripDeep(v, depth + 1));
  // why: objects with toJSON (Secret, Date) serialise themselves; leave them to pino.
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripDeep(v, depth + 1)]));
}

/** pino JSON to stdout with the spec §14 redaction and URL stripping. `destination` is for tests. */
export function createLogger(level: Config['logLevel'], destination?: pino.DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    formatters: { log: (obj) => stripDeep(obj, 0) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const cleaned = args.map((a) => (typeof a === 'string' ? stripUrlsInText(a) : a)) as Parameters<typeof method>;
        method.apply(this, cleaned);
      },
    },
  };
  const logger: Logger = destination === undefined ? pino(options) : pino(options, destination);
  return logger;
}
```

`src/bootstrap/app.ts`: add to `BootDeps`:

```ts
  /** Injected by tests to observe the heartbeat; defaults to unref'd Node timers. */
  timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
```

add after `const clock = deps.clock ?? systemClock;`:

```ts
  const timers = deps.timers ?? {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms).unref(),
    clearInterval: (h: unknown) => clearInterval(h as NodeJS.Timeout),
  };
```

and replace the two lines `const heartbeat = setInterval(() => lock.heartbeat(), HEARTBEAT_MS);` / `heartbeat.unref();` with `const heartbeat = timers.setInterval(() => lock.heartbeat(), HEARTBEAT_MS);`, and `clearInterval(heartbeat);` in `close` with `timers.clearInterval(heartbeat);`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api test -- shutdown logger boot lock backup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: shutdown order (checkpoint before lock release), heartbeat, pino redaction"
```

### Task 8.6: Test harness, security headers, Host/Origin/Content-Type/X-Requested-With

**Files:**
- Create: `test/harness.ts`, `test/contract.ts`, `src/middleware/headers.ts`, `src/middleware/hardening.ts`
- Modify: `src/app.ts`
- Test: `test/hardening.test.ts`

**Interfaces:**
- Consumes: `fixtureHandlers` (WP4), `buildPorts` under `NODE_ENV=test` with `:memory:` (WP4b), `createEngine`, `LogNotifier` (WP7), `secureHeaders` (hono).
- Produces: `createHarness`, `Harness`, `stopMsw`, `basic`, `T0`, `HOST`, `AUTH_USER`, `SENTINELS` (test-only); `expectContract` (test-only); `securityHeaders`, `hostAllowlist`, `originCheck`, `mutatingRequestCheck`.

The harness is the route-test engine: real ports over an in-memory database (`buildPorts` from WP4b under `NODE_ENV=test` and `:memory:`, which `syntheticAllowed` permits), the real engine, the fixture provider served by `msw` at `http://fixture.local`, and the app driven with `app.request()`. It does not import any other package's test files.

- [ ] **Step 1: Write the harness and the failing test**

`test/harness.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { seedAirports } from '@gmt/db';
import { type Engine, LogNotifier, createEngine } from '@gmt/engine';
import { fixtureHandlers } from '@gmt/providers';
import type { Hono } from 'hono';
import { setupServer } from 'msw/node';
import { type AppOptions, createApp } from '../src/app.js';
import { assetPaths, loadAirportsDataset } from '../src/bootstrap/paths.js';
import { createLogger } from '../src/logger.js';
import type { AppEnv } from '../src/routes/types.js';
import { type Ports, buildPorts, loadConfigFromEnv } from '../src/wiring.js';

/** The harness clock starts here; every seeded timestamp is relative to it. */
export const T0 = asIsoDateTime('2026-10-14T09:00:00.000Z');
export const HOST = 'localhost:3000';
export const AUTH_USER = 'operator';
/** Sentinel secrets (brief rule): Task 8.15 asserts none reaches a response body or a log line. */
export const SENTINELS = {
  authPass: 'test-basic-auth-pass-0123456789',
  travelpayouts: 'test-travelpayouts-token-0123456789abcdef',
  searchapi: 'test-searchapi-key-0123456789abcdef',
} as const;

const fixtureRoot = fileURLToPath(new URL('../../../packages/providers/fixtures/synthetic/fixture', import.meta.url));
// why: one msw server per test file; onUnhandledRequest 'error' proves no request leaves the process.
const msw = setupServer(...fixtureHandlers(fixtureRoot));
let mswListening = false;
export function stopMsw(): void {
  if (mswListening) {
    msw.close();
    mswListening = false;
  }
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

export async function createHarness(opts: { env?: Record<string, string>; app?: AppOptions } = {}): Promise<Harness> {
  if (!mswListening) {
    msw.listen({ onUnhandledRequest: 'error' });
    mswListening = true;
  }
  const config = loadConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: AUTH_USER,
    APP_BASIC_AUTH_PASS: SENTINELS.authPass,
    // why: the fixture provider is billable at its test cost (spec §5.3), so the harness gives it headroom.
    EXECUTION_MAX_CALLS: '1000',
    MONTHLY_SPEND_CAP_PENCE: '1000',
    LOG_LEVEL: 'debug',
    ...opts.env,
  });
  const logLines: string[] = [];
  const log = createLogger('debug', { write: (s: string) => void logLines.push(s) });
  const clock = fixedClock(T0);
  const assets = assetPaths();
  const ports = buildPorts(config, { log, clock, migrationsDir: assets.migrationsDir });
  seedAirports(ports.db, loadAirportsDataset(assets.airportsDataDir));
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
      if (o.auth !== false && !headers.has('authorization')) headers.set('authorization', basic(AUTH_USER, SENTINELS.authPass));
      if (method !== 'GET' && o.csrf !== false) {
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'get-me-there');
      }
      const body = o.json !== undefined ? JSON.stringify(o.json) : o.body;
      return app.request(`http://${HOST}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
    },
    close: async () => {
      await engine.shutdown();
      ports.db.close();
    },
  };
}
```

`test/contract.ts`:

```ts
import { apiContract } from '@gmt/core';
import type { z } from 'zod';

/**
 * Parses a response against its ROUTES entry (2xx) or the error envelope (otherwise) and
 * returns the body. Spec §9 item 5: every route is tested against core/api-contract.
 */
export async function expectContract(res: Response, method: string, path: string, override?: z.ZodTypeAny): Promise<unknown> {
  const route = apiContract.ROUTES.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no ROUTES entry ${method} ${path}`);
  const body: unknown = await res.clone().json();
  const schema = res.ok ? (override ?? route.response) : apiContract.errorEnvelopeSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`${method} ${path} → ${res.status} breaks the contract: ${JSON.stringify(parsed.error.issues).slice(0, 2000)}`);
  }
  return body;
}
```

`test/hardening.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TEXT } from '../src/text.js';
import { type Harness, createHarness, stopMsw } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
  stopMsw();
});

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

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
    expect(e.message).toBe(API_TEXT.hostRejected('evil.example:3000', ['localhost:3000', '127.0.0.1:3000']));
  });
  it('names a missing Host as (none)', async () => {
    const res = await h.request('/api/providers', { headers: { host: '' } });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toContain('(none)');
  });
  it('matches case-insensitively', async () => {
    expect((await h.request('/api/providers', { headers: { host: 'LOCALHOST:3000' } })).status).toBe(200);
  });
  it('exempts the public GET /health', async () => {
    expect((await h.request('/api/health', { auth: false, headers: { host: 'healthcheck.internal' } })).status).toBe(200);
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
    expect((await h.request('/api/providers', { headers: { origin: 'http://localhost:3000' } })).status).toBe(200);
    expect((await h.request('/api/providers')).status).toBe(200);
  });
});

describe('mutating requests (spec §4)', () => {
  it.each(['POST', 'PUT', 'DELETE'] as const)('%s without Content-Type: application/json → 415', async (method) => {
    const res = await h.request('/api/nothing-here', { method, csrf: false, body: 'x', headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe('content_type');
  });
  it('without X-Requested-With: get-me-there → 403', async () => {
    const res = await h.request('/api/nothing-here', { method: 'POST', csrf: false, body: '{}', headers: { 'content-type': 'application/json' } });
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

Run: `pnpm --filter @gmt/api test -- hardening`
Expected: FAIL: no `content-security-policy` header; the evil Host returns 401; POST without Content-Type returns 404.

- [ ] **Step 3: Implement**

`src/middleware/headers.ts`:

```ts
import { secureHeaders } from 'hono/secure-headers';

/**
 * Spec §4 security headers, on every response including 401/404 and static files. Hono's other
 * defaults (X-Frame-Options, CORP, COOP, HSTS…) stay on; X-Frame-Options is tightened to DENY to
 * agree with frame-ancestors 'none'.
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

`src/middleware/hardening.ts`:

```ts
import type { Config } from '@gmt/core';
import type { Context, MiddlewareHandler } from 'hono';
import { envelope } from '../errors.js';
import type { AppEnv } from '../routes/types.js';
import { API_TEXT } from '../text.js';

type Exempt = (c: Context<AppEnv>) => boolean;
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** Spec §4 `ALLOWED_HOSTS`: rejection names the header value and the variable. GET /health is exempt. */
export function hostAllowlist(config: Config, exempt: Exempt): MiddlewareHandler<AppEnv> {
  const allowed = new Set(config.allowedHosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    if (exempt(c)) return next();
    const host = c.req.header('host') ?? '';
    if (!allowed.has(host.toLowerCase())) {
      return c.json(envelope('host_not_allowed', API_TEXT.hostRejected(host === '' ? '(none)' : host, config.allowedHosts)), 403);
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
    if (!allowed.has(host.toLowerCase())) return c.json(envelope('origin_not_allowed', API_TEXT.originRejected(origin, config.allowedHosts)), 403);
    return next();
  };
}

/** Spec §4: mutating API routes need JSON and the custom header (a CSRF barrier for a basic-auth app). */
export function mutatingRequestCheck(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    if (!/^application\/json\s*(;|$)/i.test(c.req.header('content-type') ?? '')) return c.json(envelope('content_type', API_TEXT.contentType), 415);
    if (c.req.header('x-requested-with') !== 'get-me-there') return c.json(envelope('requested_with', API_TEXT.requestedWith), 403);
    return next();
  };
}
```

`src/app.ts`: import `securityHeaders`, `hostAllowlist`, `originCheck`, `mutatingRequestCheck`; replace the line `app.use('*', basicAuthGate({ config: ports.config, publicKeys: publicRouteKeys(routes) }));` with:

```ts
  const publicKeys = publicRouteKeys(routes);
  const isPublic = (c: Context<AppEnv>) => publicKeys.has(`${c.req.method} ${c.req.path}`);
  // Order (spec §4): headers on everything → Host → Origin → auth → JSON + X-Requested-With on mutating API calls.
  app.use('*', securityHeaders());
  app.use('*', hostAllowlist(ports.config, isPublic));
  app.use('*', originCheck(ports.config, isPublic));
  app.use('*', basicAuthGate({ config: ports.config, publicKeys }));
  app.use(`${API_PREFIX}/*`, mutatingRequestCheck());
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- hardening`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: route-test harness; security headers; Host, Origin, Content-Type, X-Requested-With"
```

### Task 8.7: Failed-auth rate limit, the auth gate over static files, SPA fallback

**Files:**
- Create: `src/static.ts`
- Modify: `src/middleware/auth.ts`, `src/app.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `getConnInfo` (`@hono/node-server/conninfo`), `serveStatic` (`@hono/node-server/serve-static`).
- Produces: `FailedAuthLimiter`, `clientIpFrom(config)`, `mountStatic(app, webRoot)`.

Rules (spec §4): a request that presents credentials is refused with 429 while its source IP has 5 failures in the last minute, or the whole app has 20; a wrong password counts as a failure on every route, the public `/health` included (so it cannot be used to probe passwords), but a request without credentials is never counted. The source IP is the last `X-Forwarded-For` entry (the one the trusted proxy appended) only when `TRUST_PROXY=true`, else the socket address; when neither is known only the global limit applies.

- [ ] **Step 1: Write the failing test**

`test/auth.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AUTH_USER, type Harness, SENTINELS, basic, createHarness, stopMsw } from './harness.js';

const WRONG = basic(AUTH_USER, 'wrong-password-000');
const RIGHT = basic(AUTH_USER, SENTINELS.authPass);
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

const byTestIp = { clientIp: (c: { req: { header(n: string): string | undefined } }) => c.req.header('x-test-ip') ?? null };

describe('basic auth gate (spec §4)', () => {
  it('401 with a challenge without or with wrong credentials, 200 with the right ones', async () => {
    h = await createHarness();
    const none = await h.request('/api/providers', { auth: false });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Basic');
    expect((await h.request('/api/providers', { headers: { authorization: WRONG } })).status).toBe(401);
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT } })).status).toBe(200);
  });

  it('GET /health is public and minimal without credentials', async () => {
    h = await createHarness();
    const res = await h.request('/api/health', { auth: false });
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()) as object).sort()).toEqual(['degraded', 'ok']);
  });

  it('with ALLOW_UNAUTHENTICATED on loopback no credentials are needed', async () => {
    h = await createHarness({ env: { APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' } });
    expect((await h.request('/api/providers', { auth: false })).status).toBe(200);
  });
});

describe('failed-auth rate limit (spec §4)', () => {
  it('5 failures from one IP block that IP (even with the right password) for a minute, not others', async () => {
    h = await createHarness({ app: byTestIp });
    for (let i = 0; i < 5; i++) expect((await h.request('/api/providers', { headers: { authorization: WRONG, 'x-test-ip': '203.0.113.7' } })).status).toBe(401);
    const blocked = await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.7' } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.8' } })).status).toBe(200);
    h.clock.advance(61_000);
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.7' } })).status).toBe(200);
  });

  it('wrong credentials on the public /health still count', async () => {
    h = await createHarness({ app: byTestIp });
    for (let i = 0; i < 5; i++) expect((await h.request('/api/health', { headers: { authorization: WRONG, 'x-test-ip': '203.0.113.9' } })).status).toBe(200);
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '203.0.113.9' } })).status).toBe(429);
    expect((await h.request('/api/health', { auth: false, headers: { 'x-test-ip': '203.0.113.9' } })).status).toBe(200);
  });

  it('20 failures across many IPs trip the global limit', async () => {
    h = await createHarness({ app: byTestIp });
    for (let i = 0; i < 20; i++) await h.request('/api/providers', { headers: { authorization: WRONG, 'x-test-ip': `198.51.100.${i}` } });
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-test-ip': '192.0.2.1' } })).status).toBe(429);
  });

  it('TRUST_PROXY=true keys on the last X-Forwarded-For entry', async () => {
    h = await createHarness({ env: { TRUST_PROXY: 'true' } });
    for (let i = 0; i < 5; i++) await h.request('/api/providers', { headers: { authorization: WRONG, 'x-forwarded-for': '198.51.100.7' } });
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-forwarded-for': '198.51.100.7' } })).status).toBe(429);
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-forwarded-for': '198.51.100.7, 198.51.100.8' } })).status).toBe(200);
  });

  it('TRUST_PROXY=false ignores X-Forwarded-For', async () => {
    h = await createHarness();
    for (let i = 0; i < 5; i++) await h.request('/api/providers', { headers: { authorization: WRONG, 'x-forwarded-for': '198.51.100.7' } });
    // why: no socket under app.request(), so the IP is unknown and only the global limit (20) applies.
    expect((await h.request('/api/providers', { headers: { authorization: RIGHT, 'x-forwarded-for': '198.51.100.7' } })).status).toBe(200);
  });
});

describe('static files and SPA fallback (spec §4, §13)', () => {
  function webRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'gmt-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>gmt</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1);');
    return dir;
  }

  it('static files need auth', async () => {
    h = await createHarness({ app: { webRoot: webRoot() } });
    expect((await h.request('/', { auth: false })).status).toBe(401);
    expect((await h.request('/assets/app.js', { auth: false })).status).toBe(401);
  });

  it('serves files, falls back to index.html for SPA paths, and never for /api', async () => {
    h = await createHarness({ app: { webRoot: webRoot() } });
    const index = await h.request('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<title>gmt</title>');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    const js = await h.request('/assets/app.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(await (await h.request('/results/abc')).text()).toContain('<title>gmt</title>');
    const api = await h.request('/api/nope');
    expect(api.status).toBe(404);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe('not_found');
    const post = await h.request('/somewhere', { method: 'POST', json: {} });
    expect(post.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- auth`
Expected: FAIL: the rate-limit tests get 200 instead of 429; the static tests get 404 for `/`.

- [ ] **Step 3: Implement**

`src/middleware/auth.ts`: add these imports and exports, and replace `AuthGateOptions` and `basicAuthGate`:

```ts
import type { Clock } from '@gmt/core';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

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
      const parts = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
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
  publicKeys: ReadonlySet<string>;
  limiter: FailedAuthLimiter;
  clientIp: (c: Context<AppEnv>) => string | null;
}

/**
 * Spec §4: everything except the public `GET /health` needs auth, static files included.
 * Credentials are evaluated only when the source is not rate-limited; a wrong password counts
 * on every route; a request without credentials is never counted.
 */
export function basicAuthGate(o: AuthGateOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = o.config.auth;
    if (auth === null) {
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

`src/static.ts`:

```ts
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

`src/app.ts`: import `FailedAuthLimiter`, `clientIpFrom` from `./middleware/auth.js` and `mountStatic` from `./static.js`; change the auth line to

```ts
  app.use('*', basicAuthGate({ config: ports.config, publicKeys, limiter: new FailedAuthLimiter(ports.clock), clientIp: options.clientIp ?? clientIpFrom(ports.config) }));
```

and after `app.route(API_PREFIX, api);` add:

```ts
  if (options.webRoot) mountStatic(app, options.webRoot);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- auth hardening`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: failed-auth rate limit, auth over static files, SPA fallback"
```

### Task 8.8: Health detail, providers zero-cap message, budget, scheduler jobs

**Files:**
- Create: `test/examples.ts`, `src/defaults.ts` (type only; Task 8.9 fills it)
- Modify: `src/routes/system.ts`
- Test: `test/system.test.ts`

**Interfaces:**
- Consumes: `engine.status()`, `engine.scheduler.jobs()`, `BudgetGuard.usage` (WP7, WP3); `healthDetailSchema`, `budgetResponseSchema`, `schedulerJobsResponseSchema` (WP0, shapes in Open question 2).
- Produces: `GET /api/health` authenticated detail; `GET /api/budget`; `GET /api/scheduler/jobs`.

- [ ] **Step 1: Write the failing test**

```ts
import { apiContract } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { API_TEXT } from '../src/text.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, SENTINELS, createHarness, stopMsw } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

describe('GET /health (spec §10, §13)', () => {
  it('public shape without auth; detail with auth', async () => {
    h = await createHarness();
    const pub = (await expectContract(await h.request('/api/health', { auth: false }), 'GET', '/health')) as object;
    expect(pub).toEqual({ ok: true, degraded: false });
    const detail = (await expectContract(await h.request('/api/health'), 'GET', '/health', apiContract.healthDetailSchema)) as {
      db: { ok: boolean }; providers: Array<{ id: string }>; scheduler: { jobCount: number };
    };
    expect(detail.db.ok).toBe(true);
    expect(detail.providers.map((p) => p.id)).toContain('fixture');
    expect(detail.scheduler.jobCount).toBe(0);
  });
  it('reports degraded from the engine without detail', async () => {
    h = await createHarness();
    vi.spyOn(h.engine, 'status').mockReturnValue({ running: [], degraded: true, nextRun: null, lastExecutionAt: null });
    expect(await (await h.request('/api/health', { auth: false })).json()).toEqual({ ok: true, degraded: true });
  });
});

describe('GET /providers (spec §10)', () => {
  it('lists capabilities and usage with window bounds', async () => {
    h = await createHarness();
    const body = (await expectContract(await h.request('/api/providers'), 'GET', '/providers')) as {
      providers: Array<{ id: string; usage: { scope: string; usage: Record<string, unknown> } }>; messages: string[];
    };
    const fixture = body.providers.find((p) => p.id === 'fixture');
    expect(fixture?.usage.scope).toBe('provider-month:fixture');
    expect(fixture?.usage.usage).toHaveProperty('windowStart');
    expect(fixture?.usage.usage).toHaveProperty('windowEnd');
    expect(body.messages).toEqual([]);
  });
  it('says verification will not run when a billed provider is enabled under a zero cap', async () => {
    h = await createHarness({ env: { SEARCHAPI_KEY: SENTINELS.searchapi, SEARCHAPI_PLAN: '40usd', MONTHLY_SPEND_CAP_PENCE: '0' } });
    const body = (await expectContract(await h.request('/api/providers'), 'GET', '/providers')) as { messages: string[] };
    expect(body.messages).toContain(API_TEXT.zeroCapVerification);
  });
});

describe('GET /budget and GET /scheduler/jobs (spec §7 budget windows, §8.2)', () => {
  it('reports every provider and the global window with bounds', async () => {
    h = await createHarness();
    const body = (await expectContract(await h.request('/api/budget'), 'GET', '/budget')) as {
      scopes: Array<{ scope: string; usage: Record<string, unknown> }>;
    };
    expect(body.scopes.map((s) => s.scope)).toEqual(expect.arrayContaining(['provider-month:fixture', 'global-month']));
    for (const s of body.scopes) {
      expect(s.usage).toHaveProperty('windowStart');
      expect(s.usage).toHaveProperty('cap');
    }
  });
  it('lists registered jobs', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }));
    h.engine.scheduler.register(def);
    const body = (await expectContract(await h.request('/api/scheduler/jobs'), 'GET', '/scheduler/jobs')) as { jobs: Array<{ definitionId: string }> };
    expect(body.jobs.map((j) => j.definitionId)).toContain(def.id);
  });
});
```

`test/examples.ts` (used from here on):

```ts
import { asIata } from '@gmt/core';
import type { DefinitionInput } from '../src/defaults.js';

/** The worked example (London → New York), sized small for tests; fixture providers for both stages. */
export function exampleDefinitionInput(overrides: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: 'London to New York',
    origins: [asIata('LHR')],
    destinations: [asIata('JFK')],
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
    confirmedCostPence: null,
    enabled: true,
    ...overrides,
  };
}
```

`DefinitionInput` is defined in `src/defaults.ts` in Task 8.9; create that file now with only the type so this task compiles:

```ts
import type { apiContract } from '@gmt/core';
import type { z } from 'zod';

/** A definition as the create route accepts it (spec §10): every SearchDefinition field except id and timestamps. */
export type DefinitionInput = z.infer<typeof apiContract.definitionCreateRequestSchema>;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- system`
Expected: FAIL: the authenticated health body lacks `db`; `/api/budget` and `/api/scheduler/jobs` return 404.

- [ ] **Step 3: Implement**

In `src/routes/system.ts` add `import { statSync } from 'node:fs';` and `budgetScopes` to the `../read/executions.js` import, then add:

```ts
function dbSizeBytes(path: string): number | null {
  if (path === ':memory:') return null;
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/** Spec §10 authenticated `/health` detail: `{ db, providers, scheduler: { jobCount, nextRun, lastExecutionAt, degraded } }`. */
export function healthDetail(ctx: RouteContext) {
  const base = healthPublic(ctx);
  const s = ctx.engine.status();
  return {
    ...base,
    db: { ok: base.ok, sizeBytes: dbSizeBytes(ctx.ports.config.databasePath) },
    providers: ctx.ports.providers.map((p) => ({ id: p.id, enabled: true })),
    scheduler: { jobCount: ctx.engine.scheduler.jobs().length, nextRun: s.nextRun, lastExecutionAt: s.lastExecutionAt, degraded: s.degraded },
  };
}
```

and replace `systemHandlers` with:

```ts
export const systemHandlers: HandlerTable = {
  // why: one public route with two shapes: the HEALTHCHECK gets the minimal one, an authenticated caller the detail.
  'GET /health': (c, _input, ctx) => c.json(c.get('authenticated') ? healthDetail(ctx) : healthPublic(ctx)),
  'GET /providers': (c, _input, ctx) => c.json(providersResponse(ctx)),
  'GET /budget': (c, _input, ctx) =>
    c.json({ scopes: budgetScopes(ctx.ports, null).map((s) => ({ scope: scopeLabel(s), usage: ctx.ports.budget.usage(s) })) }),
  'GET /scheduler/jobs': (c, _input, ctx) => c.json({ jobs: ctx.engine.scheduler.jobs() }),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- system auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: health detail, providers zero-cap message, budget windows, scheduler jobs"
```

### Task 8.9: Definitions CRUD, the plan-aware default definition, cron validation, schedule sync, estimate, coverage check

**Files:**
- Create: `src/read/space.ts`, `src/read/definitions.ts`, `src/routes/shared.ts`, `src/routes/definitions.ts`
- Modify: `src/defaults.ts`, `src/routes/index.ts`
- Test: `test/definitions.test.ts`, `test/defaults.test.ts`

**Interfaces:**
- Consumes: `DefinitionsRepo` (WP3); `engine.estimate`, `engine.budgetFit`, `engine.coverageCheck`, `engine.scheduler.register/unregister`, `parseCron` (WP7); `resolveWindow`, `countCells`, `validateSearchSpace`, `PENCE_TO_MICRO` (WP0/WP1).
- Produces: `defaultDefinitionInput`, `isDraft`, `currentSpace`, `cellInSpace`, `airportLookup`, `definitionResponse`, `needsConfirmation`, `ZERO_ESTIMATE`, `ZERO_BUDGET_FIT`, `getLiveDefinition`, `param`, `syncSchedule`, `validateForSave`; routes `GET/POST /definitions`, `GET/PUT/DELETE /definitions/:id`, `POST /definitions/:id/estimate`, `POST /definitions/coverage-check`.

**What `POST /definitions` with no body returns (spec §10, §8.2, §11).** `201` with a `definitionResponse` for a newly persisted **draft**: `name: 'New search'`, `origins: []`, `destinations: []`, relative window offset 7 / length 182, nights 10–21, economy, constraints `{ maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } }`, verification `{ maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true }`, budget from `EXECUTION_MAX_CALLS` / `EXECUTION_MAX_FREE_CALLS` / `EXECUTION_MAX_COST_PENCE`, providers from the plan preset (below) with `discoveryRefreshHours` 168 per discovery provider, `scheduleCron: '0 5 * * 1'`, `scheduleTz: SCHEDULER_TIMEZONE`, `confirmedCostPence: null`, **`enabled: false`**; plus `estimate: ZERO_ESTIMATE`, `budgetFit: { fits: true, runsPerMonth: 0, perScope: [] }`, `needsConfirmation: false`, `notices: ["Set at least one origin and one destination before running or scheduling this search."]`. No cron job is registered for it. A draft (no origins or no destinations) can be renamed or edited but not enabled (`422 draft_cannot_enable`), estimated (`422 draft_definition`) or run (the engine refuses). Plan preset (spec §8.2): Travelpayouts discovery when configured; SearchApi in both stages only on the `40usd` plan; on `trial` or £0 there is no verification provider; the fixture provider, when the gate admits it, in both stages.

- [ ] **Step 1: Write the failing tests**

`test/defaults.test.ts`:

```ts
import { type Config, type FlightProvider, type ProviderId, parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultDefinitionInput } from '../src/defaults.js';

function config(env: Record<string, string>): Config {
  const r = parseConfig(
    { NODE_ENV: 'production', DATABASE_PATH: '/data/x.db', APP_BASIC_AUTH_USER: 'operator', APP_BASIC_AUTH_PASS: 'test-basic-auth-pass-0123456789', ...env },
    { realpath: (p) => p },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
const stub = (id: ProviderId): FlightProvider => ({ id, displayName: id, suppliedFields: [], cabins: ['economy'], healthcheck: async () => ({ ok: true, detail: '' }) });

describe('defaultDefinitionInput (spec §8.2 plan preset, §11 form defaults)', () => {
  it('£0: Travelpayouts discovery only, no verification', () => {
    const d = defaultDefinitionInput(config({ TRAVELPAYOUTS_TOKEN: 't'.repeat(32) }), [stub('travelpayouts')]);
    expect(d.providers).toEqual({ discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } });
  });
  it('trial SearchApi plus Travelpayouts: still Travelpayouts discovery only', () => {
    const c = config({ TRAVELPAYOUTS_TOKEN: 't'.repeat(32), SEARCHAPI_KEY: 'k'.repeat(32) });
    expect(defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]).providers.verification).toEqual([]);
  });
  it('40usd: both providers discover, SearchApi verifies, maxCells 10 / expandTop 2', () => {
    const c = config({ TRAVELPAYOUTS_TOKEN: 't'.repeat(32), SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_PLAN: '40usd' });
    const d = defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]);
    expect(d.providers.discovery).toEqual(['travelpayouts', 'searchapi']);
    expect(d.providers.verification).toEqual(['searchapi']);
    expect(d.verification).toEqual({ maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true });
    expect(d.budget).toEqual({ maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 });
  });
  it('no providers: empty stages; airports always empty; disabled; weekly schedule in SCHEDULER_TIMEZONE', () => {
    const d = defaultDefinitionInput(config({ SCHEDULER_TIMEZONE: 'Europe/London' }), []);
    expect(d.providers.discovery).toEqual([]);
    expect(d.origins).toEqual([]);
    expect(d.destinations).toEqual([]);
    expect(d.enabled).toBe(false);
    expect(d.scheduleCron).toBe('0 5 * * 1');
    expect(d.scheduleTz).toBe('Europe/London');
    expect(d.window).toEqual({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 });
    expect([d.minNights, d.maxNights, d.cabin]).toEqual([10, 21, 'economy']);
    expect(d.constraints).toEqual({ maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } });
  });
});
```

`test/definitions.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ZERO_ESTIMATE } from '../src/read/definitions.js';
import { API_TEXT } from '../src/text.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, SENTINELS, createHarness, stopMsw } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

type Def = { id: string; origins: string[]; enabled: boolean; confirmedCostPence: number | null; needsConfirmation: boolean; notices: string[]; budgetFit: { fits: boolean; runsPerMonth: number; perScope: unknown[] } };
async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}
const jobIds = (x: Harness) => x.engine.scheduler.jobs().map((j) => j.definitionId);

describe('POST /definitions', () => {
  it('with no body creates the disabled draft default definition for the configured plan', async () => {
    h = await createHarness();
    const res = await h.request('/api/definitions', { method: 'POST' });
    expect(res.status).toBe(201);
    const d = (await expectContract(res, 'POST', '/definitions')) as Def & { providers: { discovery: string[]; verification: string[] } };
    expect(d.origins).toEqual([]);
    expect(d.enabled).toBe(false);
    expect(d.providers).toMatchObject({ discovery: ['fixture'], verification: ['fixture'] });
    expect(d.budgetFit).toEqual({ fits: true, runsPerMonth: 0, perScope: [] });
    expect(d.notices).toEqual([API_TEXT.draftNotice]);
    expect(d.needsConfirmation).toBe(false);
    expect(jobIds(h)).not.toContain(d.id);
  });

  it('with a body validates, persists, estimates and registers the schedule', async () => {
    h = await createHarness();
    const res = await h.request('/api/definitions', { json: exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }) });
    expect(res.status).toBe(201);
    const d = (await expectContract(res, 'POST', '/definitions')) as Def & { estimate: { cells: number } };
    expect(d.estimate.cells).toBeGreaterThan(0);
    expect(jobIds(h)).toContain(d.id);
  });

  it('rejects a sub-hourly cron through engine.parseCron', async () => {
    h = await createHarness();
    const res = await h.request('/api/definitions', { json: exampleDefinitionInput({ scheduleCron: '*/15 * * * *' }) });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('invalid_cron');
  });

  it('returns 422 for a window that resolves to zero cells', async () => {
    h = await createHarness();
    const res = await h.request('/api/definitions', { json: exampleDefinitionInput({ window: { kind: 'absolute', from: asIsoDate('2026-01-01'), to: asIsoDate('2026-01-10') } }) });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('zero_cells');
  });

  it('rejects a malformed body with the validation envelope', async () => {
    h = await createHarness();
    const res = await h.request('/api/definitions', { json: { name: 'x' } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
  });
});

describe('PUT / DELETE /definitions/:id and the schedule (spec §8.2)', () => {
  it('disable, enable and delete each (re)register the job in the same request', async () => {
    h = await createHarness();
    const d = (await (await h.request('/api/definitions', { json: exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }) })).json()) as Def;
    expect((await h.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: false } })).status).toBe(200);
    expect(jobIds(h)).not.toContain(d.id);
    expect((await h.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: true } })).status).toBe(200);
    expect(jobIds(h)).toContain(d.id);
    const del = await h.request(`/api/definitions/${d.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(((await expectContract(del, 'DELETE', '/definitions/:id')) as { deletedAt: string | null }).deletedAt).not.toBeNull();
    expect(jobIds(h)).not.toContain(d.id);
    expect((await h.request(`/api/definitions/${d.id}`)).status).toBe(404);
    expect(((await (await h.request('/api/definitions')).json()) as Def[]).map((x) => x.id)).not.toContain(d.id);
  });

  it('a draft can be edited but not enabled until it has airports', async () => {
    h = await createHarness();
    const d = (await (await h.request('/api/definitions', { method: 'POST' })).json()) as Def;
    expect((await h.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { name: 'renamed' } })).status).toBe(200);
    const res = await h.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: true } });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('draft_cannot_enable');
    const ok = await h.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { origins: ['LHR'], destinations: ['JFK'], enabled: true } });
    expect(ok.status).toBe(200);
    expect(jobIds(h)).toContain(d.id);
  });

  it('returns needsConfirmation when the estimate rises above the stored confirmation, never rewriting it', async () => {
    h = await createHarness();
    vi.spyOn(h.engine, 'estimate').mockReturnValue({ ...ZERO_ESTIMATE, cells: 10, totalCostMicroGbp: 5_000_000, totalCostPence: 500 });
    const created = (await (await h.request('/api/definitions', { json: exampleDefinitionInput({ confirmedCostPence: 100 }) })).json()) as Def;
    expect(created.needsConfirmation).toBe(true);
    expect(created.confirmedCostPence).toBe(100);
    const confirmed = (await (await h.request(`/api/definitions/${created.id}`, { method: 'PUT', json: { confirmedCostPence: 500 } })).json()) as Def;
    expect(confirmed.needsConfirmation).toBe(false);
    const renamed = (await (await h.request(`/api/definitions/${created.id}`, { method: 'PUT', json: { name: 'again' } })).json()) as Def;
    expect(renamed.confirmedCostPence).toBe(500);
  });

  it('404 for an unknown definition', async () => {
    h = await createHarness();
    const res = await h.request('/api/definitions/nope');
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('definition_not_found');
  });
});

describe('POST /definitions/:id/estimate and /definitions/coverage-check', () => {
  it('estimates a saved definition; refuses a draft', async () => {
    h = await createHarness();
    const d = (await (await h.request('/api/definitions', { json: exampleDefinitionInput() })).json()) as Def;
    const res = await h.request(`/api/definitions/${d.id}/estimate`, { method: 'POST', json: {} });
    expect(res.status).toBe(200);
    await expectContract(res, 'POST', '/definitions/:id/estimate');
    const draft = (await (await h.request('/api/definitions', { method: 'POST' })).json()) as Def;
    const refused = await h.request(`/api/definitions/${draft.id}/estimate`, { method: 'POST', json: {} });
    expect(refused.status).toBe(422);
    expect(await errorCode(refused)).toBe('draft_definition');
  });

  const coverageBody = { origins: ['LHR'], destinations: ['JFK'], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21 };

  it('needs Travelpayouts (free) and never falls back to a billed provider', async () => {
    h = await createHarness();
    const spy = vi.spyOn(h.engine, 'coverageCheck');
    const res = await h.request('/api/definitions/coverage-check', { json: coverageBody });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('coverage_check_unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('delegates to engine.coverageCheck when Travelpayouts is configured', async () => {
    h = await createHarness({ env: { TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts } });
    const spy = vi.spyOn(h.engine, 'coverageCheck').mockResolvedValue({ pairs: [], calls: 0, notes: [] } as never);
    const res = await h.request('/api/definitions/coverage-check', { json: coverageBody });
    expect(res.status).toBe(200);
    await expectContract(res, 'POST', '/definitions/coverage-check');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api test -- definitions defaults`
Expected: FAIL: `defaultDefinitionInput` is not exported; `POST /api/definitions` returns 404.

- [ ] **Step 3: Implement**

`src/defaults.ts` (replaces the type-only file):

```ts
import type { Config, FlightProvider, ProviderId, apiContract } from '@gmt/core';
import type { z } from 'zod';

/** A definition as the create route accepts it (spec §10): every SearchDefinition field except id and timestamps. */
export type DefinitionInput = z.infer<typeof apiContract.definitionCreateRequestSchema>;

/** Spec §11 Definitions-form defaults. */
export const DEFAULT_REFRESH_HOURS = 168;
export const DEFAULT_CRON = '0 5 * * 1';

/**
 * The default definition for the configured plan (spec §8.2 policy preset, §11 form defaults).
 * No airports: the operator enters them (spec §1, §15). Disabled, so no schedule fires on a draft.
 */
export function defaultDefinitionInput(config: Config, providers: readonly FlightProvider[]): DefinitionInput {
  const configured = new Set(providers.map((p) => p.id));
  const paid = config.providers.searchapi?.plan === '40usd' && configured.has('searchapi');
  const fixture = configured.has('fixture');
  const discovery: ProviderId[] = [
    ...(configured.has('travelpayouts') ? (['travelpayouts'] as const) : []),
    ...(paid ? (['searchapi'] as const) : []),
    ...(fixture ? (['fixture'] as const) : []),
  ];
  // why: on trial the 100 credits are for the spike and smoke (spec §2 fact 7), so the preset never verifies with them.
  const verification: ProviderId[] = [...(paid ? (['searchapi'] as const) : []), ...(fixture ? (['fixture'] as const) : [])];
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
    budget: { maxCalls: config.spend.executionMaxCalls, maxFreeCalls: config.spend.executionMaxFreeCalls, maxCostMicroGbp: config.spend.executionMaxCostMicroGbp },
    providers: { discovery, verification, discoveryRefreshHours: Object.fromEntries(discovery.map((id) => [id, DEFAULT_REFRESH_HOURS])) },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: DEFAULT_CRON,
    scheduleTz: config.schedulerTimezone,
    confirmedCostPence: null,
    enabled: false,
  } as DefinitionInput;
}
```

`src/read/space.ts`:

```ts
import { type CellKey, type Iata, type IsoDate, type ResolvedSpace, type SearchDefinition, daysBetween, resolveWindow } from '@gmt/core';
import type { AirportsRepo } from '@gmt/db';

type SpaceFields = Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights'>;

/** A draft has no origins or no destinations; it can be stored but not enabled, estimated or run. */
export function isDraft(def: Pick<SearchDefinition, 'origins' | 'destinations'>): boolean {
  return def.origins.length === 0 || def.destinations.length === 0;
}

/** The definition's current resolved space (spec §6.1), as results filter to it (spec §6.2, §10). */
export function currentSpace(def: SpaceFields, today: IsoDate): ResolvedSpace {
  const w = resolveWindow(def.window, today);
  return { origins: def.origins, destinations: def.destinations, departureFrom: w.departureFrom, departureTo: w.departureTo, minNights: def.minNights, maxNights: def.maxNights };
}

/**
 * Membership in `generateCells(space)` without generating it (spec §8.1 single-cell verify).
 * Equivalent by construction: a cell is generated iff its airports are in the lists, its
 * departure is inside the inclusive window and its nights are inside the inclusive range.
 * Task 8.10 asserts the equivalence against `generateCells` on a small space.
 */
export function cellInSpace(space: ResolvedSpace, cell: CellKey): boolean {
  if (!space.origins.includes(cell.origin) || !space.destinations.includes(cell.destination)) return false;
  if (cell.departureDate < space.departureFrom || cell.departureDate > space.departureTo) return false;
  const nights = daysBetween(cell.departureDate, cell.returnDate);
  return nights >= space.minNights && nights <= space.maxNights;
}

/** The lookup `validateSearchSpace` needs (plan WP1), backed by the airports table. */
export function airportLookup(repo: AirportsRepo) {
  return {
    exists: (iata: Iata) => repo.exists(iata),
    metroOf: (iata: Iata) => repo.metroOf(iata),
    airportsOfMetro: (code: string) => repo.airportsOfMetro(code),
  };
}
```

`src/read/definitions.ts`:

```ts
import { type Config, PENCE_TO_MICRO, type SearchDefinition, type apiContract } from '@gmt/core';
import type { z } from 'zod';
import type { RouteContext } from '../routes/types.js';
import { API_TEXT } from '../text.js';
import { isDraft } from './space.js';

export type DefinitionResponse = z.infer<typeof apiContract.definitionResponseSchema>;
export type Estimate = z.infer<typeof apiContract.estimateResponseSchema>;
export type BudgetFit = DefinitionResponse['budgetFit'];

/** The estimate of a draft: nothing to search yet. */
export const ZERO_ESTIMATE: Estimate = { cells: 0, perProvider: [], totalCostMicroGbp: 0, totalCostPence: 0, seconds: 0, assumptions: [], windowClamped: false };
export const ZERO_BUDGET_FIT: BudgetFit = { fits: true, runsPerMonth: 0, perScope: [] };

/**
 * Spec §8.1: above SOFT_CONFIRM a run needs `confirmedCostPence × 10 000 ≥ estimateMicroGbp`;
 * a PUT that raises the estimate past the stored confirmation says so. Never recomputes the confirmation (spec §7).
 */
export function needsConfirmation(def: Pick<SearchDefinition, 'confirmedCostPence'>, estimate: Estimate, config: Config): boolean {
  if (estimate.totalCostMicroGbp <= config.spend.softConfirmMicroGbp) return false;
  return def.confirmedCostPence === null || def.confirmedCostPence * PENCE_TO_MICRO < estimate.totalCostMicroGbp;
}

/** Spec §10 definition response: the definition, its estimate and `budgetFit`, `needsConfirmation`, `notices`. */
export function definitionResponse(def: SearchDefinition, ctx: RouteContext): DefinitionResponse {
  if (isDraft(def)) return { ...def, estimate: ZERO_ESTIMATE, budgetFit: ZERO_BUDGET_FIT, needsConfirmation: false, notices: [API_TEXT.draftNotice] };
  const estimate = ctx.engine.estimate(def, ctx.ports.clock.todayLondon());
  return { ...def, estimate, budgetFit: ctx.engine.budgetFit(def), needsConfirmation: needsConfirmation(def, estimate, ctx.ports.config), notices: [] };
}

/** The response for a soft-deleted definition: its last state, marked deleted, nothing estimated. */
export function deletedResponse(def: SearchDefinition, ctx: RouteContext): DefinitionResponse {
  return { ...def, enabled: false, deletedAt: ctx.ports.clock.now(), estimate: ZERO_ESTIMATE, budgetFit: ZERO_BUDGET_FIT, needsConfirmation: false, notices: [API_TEXT.deletedNotice] };
}
```

`src/routes/shared.ts`:

```ts
import type { SearchDefinition } from '@gmt/core';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { RouteContext, RouteInput } from './types.js';

/** A path parameter the router guarantees; a missing one is a 400, never a crash. */
export function param(input: RouteInput, name: string): string {
  const v = input.params[name];
  if (v === undefined || v === '') throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return v;
}

/** A definition that exists and is not soft-deleted, else 404 `definition_not_found`. */
export function getLiveDefinition(ctx: RouteContext, id: string): SearchDefinition {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null) throw new ApiError(404, 'definition_not_found', API_TEXT.definitionNotFound(id));
  return def;
}
```

`src/routes/definitions.ts`:

```ts
import { apiContract, countCells, type SearchDefinition, validateSearchSpace } from '@gmt/core';
import { parseCron } from '@gmt/engine';
import type { z } from 'zod';
import { type DefinitionInput, defaultDefinitionInput } from '../defaults.js';
import { ApiError } from '../errors.js';
import { definitionResponse, deletedResponse } from '../read/definitions.js';
import { airportLookup, currentSpace, isDraft } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

type CoverageCheckRequest = z.infer<typeof apiContract.coverageCheckRequestSchema>;

function inputOf(def: SearchDefinition): DefinitionInput {
  const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = def;
  return rest as DefinitionInput;
}

/** Spec §8.2: register when enabled with a cron, otherwise unregister, in the same request. */
export function syncSchedule(def: SearchDefinition, ctx: RouteContext): void {
  if (def.enabled && def.scheduleCron !== null && def.deletedAt === null) ctx.engine.scheduler.register(def);
  else ctx.engine.scheduler.unregister(def.id);
}

/**
 * Save-time validation of the whole (merged) definition: cron through the scheduler's
 * `parseCron` (spec §8.2, sole validator), drafts may not be enabled, then the contract shape,
 * zero-cell windows (422, spec §6.1) and `validateSearchSpace` (airports, nights, caps, alwaysInclude).
 */
export function validateForSave(def: DefinitionInput, ctx: RouteContext): void {
  if (def.scheduleCron !== null) {
    const cron = parseCron(def.scheduleCron, def.scheduleTz);
    if (!cron.ok) throw new ApiError(422, 'invalid_cron', API_TEXT.invalidCron(cron.reason));
  }
  if (isDraft(def)) {
    if (def.enabled) throw new ApiError(422, 'draft_cannot_enable', API_TEXT.draftCannotEnable);
    return;
  }
  const shape = apiContract.definitionCreateRequestSchema.safeParse(def);
  if (!shape.success) {
    throw new ApiError(422, 'invalid_definition', API_TEXT.invalidDefinition, shape.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  const today = ctx.ports.clock.todayLondon();
  if (countCells(currentSpace(def, today)) <= 0) throw new ApiError(422, 'zero_cells', API_TEXT.zeroCells);
  const v = validateSearchSpace(def, today, airportLookup(ctx.ports.repos.airports), ctx.ports.config.maxCellsPerDefinition);
  if (!v.ok) throw new ApiError(422, 'invalid_definition', API_TEXT.invalidDefinition, v.errors);
}

export const definitionHandlers: HandlerTable = {
  'GET /definitions': (c, _input, ctx) =>
    c.json(ctx.ports.repos.definitions.list().filter((d) => d.deletedAt === null).map((d) => definitionResponse(d, ctx))),

  'POST /definitions': (c, input, ctx) => {
    const sent = c.get('optionalBody')?.present === true;
    const def = sent ? (input.body as DefinitionInput) : defaultDefinitionInput(ctx.ports.config, ctx.ports.providers);
    validateForSave(def, ctx);
    const created = ctx.ports.repos.definitions.create(def);
    syncSchedule(created, ctx);
    return c.json(definitionResponse(created, ctx), 201);
  },

  'GET /definitions/:id': (c, input, ctx) => c.json(definitionResponse(getLiveDefinition(ctx, param(input, 'id')), ctx)),

  'PUT /definitions/:id': (c, input, ctx) => {
    const existing = getLiveDefinition(ctx, param(input, 'id'));
    const patch = input.body as Partial<DefinitionInput>;
    validateForSave({ ...inputOf(existing), ...patch }, ctx);
    // why: the confirmation is stored only when the operator sends it (spec §7); a PUT without it leaves it alone.
    const updated = ctx.ports.repos.definitions.update(existing.id, patch);
    syncSchedule(updated, ctx);
    return c.json(definitionResponse(updated, ctx));
  },

  'DELETE /definitions/:id': (c, input, ctx) => {
    const existing = getLiveDefinition(ctx, param(input, 'id'));
    ctx.ports.repos.definitions.softDelete(existing.id);
    ctx.engine.scheduler.unregister(existing.id);
    return c.json(deletedResponse(existing, ctx));
  },

  'POST /definitions/:id/estimate': (c, input, ctx) => {
    const def = getLiveDefinition(ctx, param(input, 'id'));
    if (isDraft(def)) throw new ApiError(422, 'draft_definition', API_TEXT.draftNoEstimate);
    return c.json(ctx.engine.estimate(def, ctx.ports.clock.todayLondon()));
  },

  'POST /definitions/coverage-check': async (c, input, ctx) => {
    // why: spec §10: the check runs free Travelpayouts month tiles and never calls a billed provider.
    if (!ctx.ports.providers.some((p) => p.id === 'travelpayouts')) throw new ApiError(409, 'coverage_check_unavailable', API_TEXT.coverageCheckUnavailable);
    return c.json(await ctx.engine.coverageCheck(input.body as CoverageCheckRequest));
  },
};
```

`src/routes/index.ts`: add `import { definitionHandlers } from './definitions.js';` and the line `...definitionHandlers,` to `HANDLERS`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api test -- definitions defaults`
Expected: PASS, 4 + 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: definitions CRUD, plan-aware draft default, cron validation, schedule sync"
```

### Task 8.10: Executions: start, read, cancel, resume; single-cell verify with membership validation

**Files:**
- Create: `test/seed.ts`, `src/routes/executions.ts`
- Modify: `src/read/executions.ts`, `src/routes/index.ts`
- Test: `test/executions.test.ts`

**Interfaces:**
- Consumes: `engine.start/resume/cancel/verifyCell`, `StartResult` (WP7); `ExecutionsRepo.get`, `CellsRepo.buckets`, `LedgerRepo.countsFor` (WP3); `generateCells` (WP1).
- Produces: `executionResponse(ports, execution)`, `startError(result)`; routes `POST /definitions/:id/executions`, `GET /executions/:id`, `POST /executions/:id/cancel`, `POST /executions/:id/resume`, `POST /cells/verify`; test-only `seedExecution`, `seedCell`, `seedOutcome`, `seedCalendarPrice`, `seedObservation`, `cell`, `at`.

HTTP mapping of `StartResult` (spec §8.1, §10): `ok` → `202` with the execution; `active`, `cap`, `confirm` → `409` with `code` equal to the engine's code and its message and details (the cap message names the cap and the numbers); `window` → `422`. `/resume` always passes `{ manual: true }` (spec §8.1: manual resume re-enables disabled providers and retries errors on a completed run). `/cells/verify` checks, in order: definition exists (404), it has a verification provider (422 `no_verification_provider`, spec §8.1 "hidden when the definition has no verification provider"), the cell is in the current resolved space (422 `cell_not_in_space`), both airports exist (422 `unknown_airport`); then the engine enforces one active child per cell (409 `active`).

`test/seed.ts` writes rows with SQL over the spec §7 column names so route tests control every value (prices, ages, classes) without depending on what the synthetic fixture tree happens to contain; the engine-driven tests use the real fixture provider instead.

- [ ] **Step 1: Write the seeder and the failing test**

`test/seed.ts`:

```ts
import {
  type BaggageSnapshot, type Cabin, type CellKey, type DefinitionSnapshot, type ExecutionStatus, type IsoDate, type IsoDateTime,
  type ProviderId, type SearchDefinition, type SourceKind, type Stage, type SuppliedField,
  asIata, asIsoDate, asIsoDateTime, daysBetween, resolveWindow,
} from '@gmt/core';
import type { Db } from '@gmt/db';
import { T0 } from './harness.js';

const HOUR = 3_600_000;
/** An instant `hours` after the harness T0 (negative = before). */
export const at = (hours: number): IsoDateTime => asIsoDateTime(new Date(Date.parse(T0) + hours * HOUR).toISOString());
export const cell = (o: string, d: string, dep: string, ret: string): CellKey => ({
  origin: asIata(o), destination: asIata(d), departureDate: asIsoDate(dep), returnDate: asIsoDate(ret),
});

function snapshotOf(def: SearchDefinition, resolvedAt: IsoDateTime, today: IsoDate): DefinitionSnapshot {
  const w = resolveWindow(def.window, today);
  return {
    ...def,
    resolved: { origins: def.origins, destinations: def.destinations, departureFrom: w.departureFrom, departureTo: w.departureTo, minNights: def.minNights, maxNights: def.maxNights },
    resolvedAt,
    windowClamped: w.clamped,
  };
}

export interface SeedExecution { id: string; def: SearchDefinition; status: ExecutionStatus; startedAt: IsoDateTime; finishedAt?: IsoDateTime | null; child?: CellKey; stage?: Stage | null }
export function seedExecution(db: Db, s: SeedExecution): void {
  db.raw
    .prepare(
      `insert into search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date, child_return_date,
        definition_snapshot_json, status, stage, estimate_json, cancel_requested, resume_after, auto_resume_count, started_at, finished_at, error_text)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 0, null, 0, ?, ?, null)`,
    )
    .run(
      s.id, s.def.id, s.child ? 1 : 0, s.child?.origin ?? null, s.child?.destination ?? null, s.child?.departureDate ?? null, s.child?.returnDate ?? null,
      JSON.stringify(snapshotOf(s.def, s.startedAt, s.startedAt.slice(0, 10) as IsoDate)), s.status, s.stage ?? null, s.startedAt, s.finishedAt ?? null,
    );
}

export interface SeedCell { discoveryStatus?: string | null; discoveryMinPence?: number | null; selected?: boolean; selectionReason?: string | null; verificationStatus?: string | null }
export function seedCell(db: Db, executionId: string, c: CellKey, s: SeedCell = {}): void {
  db.raw
    .prepare(
      `insert into search_cells (execution_id, origin, destination, departure_date, return_date, discovery_status, discovery_min_pence,
        verification_selected, selection_reason, verification_status, best_observation_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
       on conflict (execution_id, origin, destination, departure_date, return_date) do update set
         discovery_status = excluded.discovery_status, discovery_min_pence = excluded.discovery_min_pence,
         verification_selected = excluded.verification_selected, selection_reason = excluded.selection_reason,
         verification_status = excluded.verification_status`,
    )
    .run(executionId, c.origin, c.destination, c.departureDate, c.returnDate, s.discoveryStatus ?? null, s.discoveryMinPence ?? null, s.selected ? 1 : 0, s.selectionReason ?? null, s.verificationStatus ?? null);
}

export interface SeedOutcome { status: string; reason?: string | null; attempts?: number; fetchedAt?: IsoDateTime | null; minPence?: number | null; cabin?: Cabin; sourceKind?: SourceKind; reusedFrom?: string | null }
export function seedOutcome(db: Db, executionId: string, c: CellKey, stage: Stage, providerId: ProviderId, s: SeedOutcome): void {
  db.raw
    .prepare(
      `insert or ignore into search_cells (execution_id, origin, destination, departure_date, return_date, verification_selected) values (?, ?, ?, ?, ?, 0)`,
    )
    .run(executionId, c.origin, c.destination, c.departureDate, c.returnDate);
  db.raw
    .prepare(
      `insert into cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, reason, attempts,
        last_error, fetched_at, min_pence, cabin, point_of_sale, source_kind, reused_from_execution_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, 'GB', ?, ?)`,
    )
    .run(executionId, c.origin, c.destination, c.departureDate, c.returnDate, stage, providerId, s.status, s.reason ?? null, s.attempts ?? 0,
      s.fetchedAt ?? null, s.minPence ?? null, s.cabin ?? 'economy', s.sourceKind ?? 'synthetic', s.reusedFrom ?? null);
}

export interface SeedCalendarPrice { executionId: string; cell: CellKey; pricePence: number; fetchedAt: IsoDateTime; providerId?: ProviderId; sourceKind?: SourceKind; cabin?: Cabin; maxAgeHours?: number | null; reusedFrom?: string | null }
export function seedCalendarPrice(db: Db, s: SeedCalendarPrice): number {
  const r = db.raw
    .prepare(
      `insert into calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence,
        price_native_minor, currency_native, fx_rate_nano, fx_rate_date, fx_source, fx_converted, point_of_sale, fetched_at, provider_observed_at,
        max_age_hours, vendor_link, reused_from_execution_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP', null, null, null, 0, 'GB', ?, null, ?, null, ?)`,
    )
    .run(s.executionId, s.providerId ?? 'fixture', s.sourceKind ?? 'synthetic', s.cabin ?? 'economy', s.cell.origin, s.cell.destination,
      s.cell.departureDate, s.cell.returnDate, s.pricePence, s.pricePence, s.fetchedAt, s.maxAgeHours === undefined ? 24 : s.maxAgeHours, s.reusedFrom ?? null);
  return Number(r.lastInsertRowid);
}

export interface SeedObservation {
  executionId: string; cell: CellKey; hash: string; pricePence: number; fetchedAt: IsoDateTime;
  seller?: string; providerId?: ProviderId; sourceKind?: SourceKind; cabin?: Cabin; stopsOut?: number;
  /** null: baggage not supplied (its constraints become unverified). */
  baggage?: BaggageSnapshot | null; maxAgeHours?: number;
}
/** One itinerary (insert-or-ignore), its segments, its offer (insert-or-ignore) and one observation. */
export function seedObservation(db: Db, s: SeedObservation): { offerId: number; observationId: number } {
  const c = s.cell;
  const nights = daysBetween(c.departureDate, c.returnDate);
  const stopsOut = s.stopsOut ?? 0;
  const via = ['AAA', 'BBB', 'CCC'].slice(0, stopsOut); // why: clearly synthetic connection points
  const outPath = [c.origin, ...via, c.destination];
  const providerId = s.providerId ?? 'fixture';
  const cabin = s.cabin ?? 'economy';
  db.raw
    .prepare(
      `insert or ignore into itineraries (hash, kind, origin, destination, departure_date, return_date, nights, outbound_minutes, inbound_minutes,
        stops_out, stops_in, airport_change, carriers_json, first_seen_at) values (?, 'flight', ?, ?, ?, ?, ?, 480, 480, ?, 0, 0, '["BA"]', ?)`,
    )
    .run(s.hash, c.origin, c.destination, c.departureDate, c.returnDate, nights, stopsOut, s.fetchedAt);
  const seg = db.raw.prepare(
    `insert or ignore into segments (itinerary_hash, direction, position, mode, marketing_carrier, operating_carrier, flight_number, from_iata, to_iata,
      depart_local, arrive_local, depart_utc, arrive_utc, duration_minutes, aircraft) values (?, ?, ?, 'air', 'BA', null, ?, ?, ?, ?, ?, null, null, 120, null)`,
  );
  for (let i = 0; i < outPath.length - 1; i++) {
    const hh = String(8 + i * 3).padStart(2, '0');
    const hh2 = String(10 + i * 3).padStart(2, '0');
    seg.run(s.hash, 'outbound', i, 100 + i, outPath[i], outPath[i + 1], `${c.departureDate}T${hh}:00`, `${c.departureDate}T${hh2}:00`);
  }
  seg.run(s.hash, 'inbound', 0, 200, c.destination, c.origin, `${c.returnDate}T10:00`, `${c.returnDate}T18:00`);
  const seller = s.seller ?? 'BA';
  db.raw
    .prepare(
      `insert or ignore into fare_offers (itinerary_hash, provider_id, seller, cabin, first_seen_at, last_seen_at, first_price_pence, lowest_price_pence,
        highest_price_pence, latest_price_pence) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.hash, providerId, seller, cabin, s.fetchedAt, s.fetchedAt, s.pricePence, s.pricePence, s.pricePence, s.pricePence);
  const offer = db.raw
    .prepare('select id from fare_offers where itinerary_hash = ? and provider_id = ? and seller = ? and cabin = ?')
    .get(s.hash, providerId, seller, cabin) as { id: number };
  const baggage = s.baggage === undefined ? { checkedBags: 1 } : s.baggage;
  const supplied: SuppliedField[] = ['segments', 'segmentTimes', 'segmentCabins', 'selfTransfer', 'seller', 'price', ...(baggage === null ? [] : (['baggage'] as const))];
  const segmentCabins = Array.from({ length: outPath.length }, () => cabin);
  const r = db.raw
    .prepare(
      `insert into price_observations (offer_id, execution_id, source_kind, cabin, fetched_at, provider_observed_at, price_pence, price_native_minor,
        currency_native, fx_rate_nano, fx_rate_date, fx_source, fx_converted, point_of_sale, max_age_hours, taxes_included, self_transfer,
        segment_cabins_json, baggage_json, fare_conditions_json, booking_json, booking_expires_at, supplied_fields_json, partial_expansion)
       values (?, ?, ?, ?, ?, null, ?, ?, 'GBP', null, null, null, 0, 'GB', ?, 1, 0, ?, ?, null, '{"kind":"none"}', null, ?, 0)`,
    )
    .run(offer.id, s.executionId, s.sourceKind ?? 'synthetic', cabin, s.fetchedAt, s.pricePence, s.pricePence, s.maxAgeHours ?? 0,
      JSON.stringify(segmentCabins), baggage === null ? null : JSON.stringify(baggage), JSON.stringify(supplied));
  return { offerId: offer.id, observationId: Number(r.lastInsertRowid) };
}
```

`test/executions.test.ts`:

```ts
import { asIata, asIsoDate, cellKeyString, generateCells } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cellInSpace } from '../src/read/space.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, createHarness, stopMsw } from './harness.js';
import { at, cell, seedExecution } from './seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

type Exec = { id: string; status: string; isChild: boolean; progress: Array<{ stage: string; providerId: string; total: number }>; budget: Array<{ scope: string; usage: object }> };
async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}
const small = () =>
  exampleDefinitionInput({ window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-03') }, minNights: 10, maxNights: 10 });

async function waitTerminal(x: Harness, id: string): Promise<Exec> {
  for (let i = 0; i < 200; i++) {
    const e = (await (await x.request(`/api/executions/${id}`)).json()) as Exec;
    if (e.status !== 'pending' && e.status !== 'running') return e;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`execution ${id} did not finish`);
}

describe('POST /definitions/:id/executions and GET /executions/:id (spec §8.1, §10)', () => {
  it('starts a run through the engine and reports progress per stage × provider and every budget scope', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(small());
    const res = await h.request(`/api/definitions/${def.id}/executions`, { json: { confirmCostPence: 100_000 } });
    expect(res.status).toBe(202);
    const started = (await expectContract(res, 'POST', '/definitions/:id/executions')) as Exec;
    const done = await waitTerminal(h, started.id);
    await expectContract(await h.request(`/api/executions/${started.id}`), 'GET', '/executions/:id');
    expect(done.progress.find((p) => p.stage === 'discovery' && p.providerId === 'fixture')?.total).toBe(2);
    expect(done.progress.some((p) => p.stage === 'verification' && p.providerId === 'fixture')).toBe(true);
    expect(done.budget.map((b) => b.scope)).toEqual(
      expect.arrayContaining(['execution-calls', 'execution-free-calls', 'execution-cost', 'provider-month:fixture', 'global-month']),
    );
    for (const b of done.budget) expect(b.usage).toHaveProperty('windowEnd');
  });

  it('409 active when an execution is already active for the definition', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(small());
    seedExecution(h.ports.db, { id: 'E-running', def, status: 'running', startedAt: at(-1) });
    const res = await h.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('active');
  });

  it.each([
    ['active', 409],
    ['cap', 409],
    ['confirm', 409],
    ['window', 422],
  ] as const)('maps StartResult %s to %i with the engine message', async (c, status) => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(small());
    vi.spyOn(h.engine, 'start').mockResolvedValue({ ok: false, code: c, message: `refused: ${c} execution-calls cap 10, current 9, requested 5`, details: { scope: 'execution-calls' } });
    const res = await h.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(status);
    const body = (await expectContract(res, 'POST', '/definitions/:id/executions')) as { error: { code: string; message: string } };
    expect(body.error.code).toBe(c);
    expect(body.error.message).toContain('cap 10');
  });

  it('404 for an unknown execution', async () => {
    h = await createHarness();
    const res = await h.request('/api/executions/nope');
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('execution_not_found');
  });
});

describe('cancel and resume (spec §8.1 Resume, §10)', () => {
  it('cancel: 409 when the engine refuses, 200 with the execution when it accepts', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(small());
    seedExecution(h.ports.db, { id: 'E-done', def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    vi.spyOn(h.engine, 'cancel').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const refused = await h.request('/api/executions/E-done/cancel', { method: 'POST', json: {} });
    expect(refused.status).toBe(409);
    expect(await code(refused)).toBe('not_cancellable');
    expect((await h.request('/api/executions/E-done/cancel', { method: 'POST', json: {} })).status).toBe(200);
  });

  it('resume is always manual and maps a lost compare-and-set or an active sibling to 409', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(small());
    seedExecution(h.ports.db, { id: 'E-cancelled', def, status: 'cancelled', startedAt: at(-2), finishedAt: at(-1) });
    const resume = vi.spyOn(h.engine, 'resume')
      .mockResolvedValueOnce({ ok: true, executionId: 'E-cancelled' })
      .mockResolvedValueOnce({ ok: false, code: 'active', message: 'another execution is active', details: null });
    expect((await h.request('/api/executions/E-cancelled/resume', { method: 'POST', json: {} })).status).toBe(200);
    expect(resume).toHaveBeenCalledWith('E-cancelled', { manual: true });
    const lost = await h.request('/api/executions/E-cancelled/resume', { method: 'POST', json: {} });
    expect(lost.status).toBe(409);
    expect(await code(lost)).toBe('active');
  });
});

describe('POST /cells/verify (spec §8.1 Single-cell verification)', () => {
  const inside = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');

  it.each([
    ['departure outside the window', cell('LHR', 'JFK', '2027-09-01', '2027-09-11')],
    ['nights outside the range', cell('LHR', 'JFK', '2026-11-02', '2026-11-27')],
    ['origin not in the definition', cell('LGW', 'JFK', '2026-11-02', '2026-11-12')],
  ])('422 cell_not_in_space: %s, without calling the engine', async (_label, c) => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput());
    const spy = vi.spyOn(h.engine, 'verifyCell');
    const res = await h.request('/api/cells/verify', { json: { definitionId: def.id, cell: c } });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('cell_not_in_space');
    expect(spy).not.toHaveBeenCalled();
  });

  it('422 no_verification_provider when the definition has none', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput({ providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} } }));
    const res = await h.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('no_verification_provider');
  });

  it('creates a child execution for a member cell; 409 when a child is active for it', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput());
    const res = await h.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(202);
    expect(((await expectContract(res, 'POST', '/cells/verify')) as Exec).isChild).toBe(true);
    vi.spyOn(h.engine, 'verifyCell').mockResolvedValue({ ok: false, code: 'active', message: 'a child is active for this cell', details: null });
    const again = await h.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(again.status).toBe(409);
  });

  it('cellInSpace agrees with generateCells on a small space and its neighbours', () => {
    const space = { origins: [asIata('LHR')], destinations: [asIata('JFK')], departureFrom: asIsoDate('2026-11-02'), departureTo: asIsoDate('2026-11-04'), minNights: 1, maxNights: 2 };
    const members = new Set(generateCells(space).map(cellKeyString));
    let checked = 0;
    for (const o of ['LHR', 'LGW']) for (const d of ['JFK', 'EWR']) for (let dep = 1; dep <= 5; dep++) for (let n = 0; n <= 3; n++) {
      const ret = new Date(Date.UTC(2026, 10, dep + n)).toISOString().slice(0, 10);
      const c = cell(o, d, `2026-11-0${dep}`, ret);
      expect(cellInSpace(space, c)).toBe(members.has(cellKeyString(c)));
      checked++;
    }
    expect(checked).toBe(80);
    expect(members.size).toBe(6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- executions`
Expected: FAIL: the route tests get 404 `not_found`; the `cellInSpace` property test passes already (Task 8.9).

- [ ] **Step 3: Implement**

Append to `src/read/executions.ts`:

```ts
import { PENCE_TO_MICRO, type apiContract } from '@gmt/core';
import type { Execution } from '@gmt/db';
import type { z } from 'zod';

export type ExecutionResponse = z.infer<typeof apiContract.executionResponseSchema>;

/**
 * Spec §10 `GET /executions/:id`: status, stage, reason, resumeAfter, progress per stage ×
 * provider (six buckets + reused), budget usage for every scope, estimate vs ledger.
 * A stage with no provider has no progress rows (spec §3 `not_applicable`).
 */
export function executionResponse(ports: Ports, e: Execution): ExecutionResponse {
  const progress = (['discovery', 'verification'] as const).flatMap((stage) =>
    e.snapshot.providers[stage].map((providerId) => {
      const b = ports.repos.cells.buckets(e.id, stage, providerId);
      return { stage, providerId, buckets: b, total: b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run };
    }),
  );
  const counts = ports.repos.ledger.countsFor(e.id);
  return {
    id: e.id,
    definitionId: e.definitionId,
    isChild: e.isChild,
    ...(e.cell === null ? {} : { cell: e.cell }),
    status: e.status,
    stage: e.stage,
    reason: e.errorText,
    resumeAfter: e.resumeAfter,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    progress,
    budget: budgetScopes(ports, e.id).map((s) => ({ scope: scopeLabel(s), usage: ports.budget.usage(s) })),
    estimate: e.estimate,
    // why: "ledger cost, from configured rates" (spec §8.1); pence rounded up so spend is never understated.
    ledger: { calls: counts.calls, costMicroGbp: counts.costMicroGbp, costPence: Math.ceil(counts.costMicroGbp / PENCE_TO_MICRO) },
  };
}
```

(merge the new imports into the file's existing import lines.)

`src/routes/executions.ts`:

```ts
import type { CellKey, apiContract } from '@gmt/core';
import type { StartResult } from '@gmt/engine';
import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { executionResponse } from '../read/executions.js';
import { cellInSpace, currentSpace } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { getLiveDefinition, param } from './shared.js';
import type { AppEnv, HandlerTable, RouteContext } from './types.js';

type StartRequest = z.infer<typeof apiContract.startExecutionRequestSchema>;
type VerifyRequest = z.infer<typeof apiContract.verifyCellRequestSchema>;

/** Spec §10: 409 on an active execution or a cap breach naming the cap; 422 for a zero-cell window. */
export function startError(r: Extract<StartResult, { ok: false }>): ApiError {
  return new ApiError(r.code === 'window' ? 422 : 409, r.code, r.message, r.details);
}

function getExecution(ctx: RouteContext, id: string) {
  const e = ctx.ports.repos.executions.get(id);
  if (e === null) throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound(id));
  return e;
}

function started(c: Context<AppEnv>, r: StartResult, ctx: RouteContext, status: 200 | 202) {
  if (!r.ok) throw startError(r);
  return c.json(executionResponse(ctx.ports, getExecution(ctx, r.executionId)), status);
}

export const executionHandlers: HandlerTable = {
  'POST /definitions/:id/executions': async (c, input, ctx) => {
    const def = getLiveDefinition(ctx, param(input, 'id'));
    const body = (input.body ?? {}) as StartRequest;
    const r = await ctx.engine.start(def.id, { trigger: 'manual', ...(body.confirmCostPence === undefined ? {} : { confirmCostPence: body.confirmCostPence }) });
    return started(c, r, ctx, 202);
  },

  'GET /executions/:id': (c, input, ctx) => c.json(executionResponse(ctx.ports, getExecution(ctx, param(input, 'id')))),

  'POST /executions/:id/cancel': async (c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    if (!(await ctx.engine.cancel(e.id))) throw new ApiError(409, 'not_cancellable', API_TEXT.notCancellable(e.status));
    return c.json(executionResponse(ctx.ports, getExecution(ctx, e.id)));
  },

  'POST /executions/:id/resume': async (c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    // why: the API's resume is the operator's manual resume (spec §8.1): it re-enables disabled providers.
    return started(c, await ctx.engine.resume(e.id, { manual: true }), ctx, 200);
  },

  'POST /cells/verify': async (c, input, ctx) => {
    const body = input.body as VerifyRequest;
    const def = getLiveDefinition(ctx, body.definitionId);
    if (def.providers.verification.length === 0) throw new ApiError(422, 'no_verification_provider', API_TEXT.noVerificationProvider);
    const target: CellKey = body.cell;
    if (!cellInSpace(currentSpace(def, ctx.ports.clock.todayLondon()), target)) throw new ApiError(422, 'cell_not_in_space', API_TEXT.cellNotInSpace, { cell: target });
    for (const iata of [target.origin, target.destination]) {
      if (!ctx.ports.repos.airports.exists(iata)) throw new ApiError(422, 'unknown_airport', API_TEXT.unknownAirport(iata));
    }
    return started(c, await ctx.engine.verifyCell(def.id, target), ctx, 202);
  },
};
```

`src/routes/index.ts`: add `...executionHandlers,`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- executions`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: executions start/read/cancel/resume and single-cell verify with membership"
```

### Task 8.11: Results (spec §6.5, §6.9, §8.1): basis, dedup, ranking, cap, staleness, `notSeenInLatest`, children, excluded rows

**Files:**
- Create: `src/read/rows.ts`, `src/read/results.ts`, `src/read/coverage.ts`, `src/routes/results.ts`
- Modify: `src/routes/index.ts`
- Test: `test/results.test.ts`

**Interfaces:**
- Consumes: `ItinerariesRepo.observationsForDefinition`, `ItinerariesRepo.latestVerificationOutcomeForCell`, `CalendarPricesRepo.latestPerCell`, `ExecutionsRepo.listForDefinition`, `CellsRepo.rollUps/outcomes/selected` (WP3); `evaluateConstraints`, `verdictClass`, `dedupByItinerary`, `rankRows`, `bandCheapest`, `searchLinkFor` (WP2); `effectiveAge`, `worstCaseAgeHours` (WP0).
- Produces: `loadRows`, `assembleResults`, `RESULTS_CAP = 1000`, `BAND_HOURS = 6`, `verifiedRow`, `calendarRow`, `datedPrice`, `staleness`, `latestPerOffer`, `notSeenResolver`, `coverageSummaryFor`, `hoursSince`; route `GET /definitions/:id/results`.

Assembly rules, each pinned by a test below:

1. Rows come from **every** execution of the definition, children included (spec §8.1), or from one execution when `executionId` is given; observations and calendar prices are read in the definition's current cabin.
2. Each offer contributes its latest observation (max `fetchedAt`, tie on id); verdicts are evaluated now against the **current** constraints and the observation's stored supplied fields (spec §6.2).
3. Rows outside the current resolved space are dropped and counted in `excludedByCurrentSpace`; when that count is non-zero, `basisReason` ends with "· I of N rows are inside the current window and nights range" (review focus 4).
4. Default basis (spec §6.9): `calendar` when the latest parent execution's snapshot (or, with none, the definition) has no verification provider, or no observation is inside the space; otherwise `verified`. `basisReason` says which.
5. Verified basis: `dedupByItinerary` (one row per hash, cheapest offer, the rest in `otherOffers`), then `rankRows` (class, seen before `notSeenInLatest`, price, age), then `bandCheapest(rows, 6)`. **All classes are returned**; `failed` ranks last and so never consumes the cap ahead of better rows.
6. Calendar basis: the latest price per (provider, cell), reused copies ignored, class `unchecked`, `notApplied` = every configured constraint, `booking: none`, a search link.
7. `stale` per spec §8.1: verified basis against `STALE_AFTER_HOURS`; calendar basis against `CALENDAR_STALE_AFTER_HOURS` or the provider's `discoveryRefreshHours + maxAgeHours`; unknown age is stale. Stale rows are returned, never hidden.
8. `notSeenInLatest`: the cell's newest `priced | empty` verification outcome is from another execution in which this offer has no observation → `{ ageHours }` of that newer search.
9. At most `limit` rows (default and maximum 1000); `total` counts every row before the cut; `truncated = total > limit`.

- [ ] **Step 1: Write the failing test**

`test/results.test.ts`:

```ts
import { type Constraints, apiContract } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { API_TEXT } from '../src/text.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, createHarness, stopMsw } from './harness.js';
import { at, cell, seedCalendarPrice, seedExecution, seedObservation, seedOutcome } from './seed.js';

type Results = z.infer<typeof apiContract.resultsResponseSchema>;
const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const C3 = cell('LHR', 'JFK', '2026-11-04', '2026-11-14');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

/**
 * Three itinerary-searched rows in one parent execution, one per class under
 * { maxStops: 1, checkedBagRequired: true }: hV £600 verified, hP £400 partially-verified
 * (baggage not supplied), hF £300 failed (two stops).
 */
async function world(constraints: Constraints = { maxStops: 1, checkedBagRequired: true }) {
  const x = await createHarness();
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints }));
  seedExecution(x.ports.db, { id: 'E1', def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  for (const c of [C1, C2, C3]) seedOutcome(x.ports.db, 'E1', c, 'verification', 'fixture', { status: 'priced', fetchedAt: at(-1) });
  seedObservation(x.ports.db, { executionId: 'E1', cell: C1, hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) });
  seedObservation(x.ports.db, { executionId: 'E1', cell: C2, hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null });
  seedObservation(x.ports.db, { executionId: 'E1', cell: C3, hash: 'hF', pricePence: 30_000, fetchedAt: at(-1), stopsOut: 2 });
  return { x, def };
}

async function results(x: Harness, defId: string, query = ''): Promise<Results> {
  const res = await x.request(`/api/definitions/${defId}/results${query}`);
  expect(res.status).toBe(200);
  return (await expectContract(res, 'GET', '/definitions/:id/results')) as Results;
}

describe('GET /definitions/:id/results, verified basis', () => {
  it('returns every class, ranked by class then price, each row with provenance', async () => {
    const { x, def } = await world();
    h = x;
    const r = await results(x, def.id);
    expect(r.basis).toBe('verified');
    expect(r.basisReason).toBe(API_TEXT.basisItinerarySearched);
    expect(r.rows.map((row) => row.itineraryHash)).toEqual(['hV', 'hP', 'hF']);
    expect(r.rows.map((row) => row.verdictClass)).toEqual(['verified', 'partially-verified', 'failed']);
    expect(r.rows[1]?.unverified).toContain('checkedBagRequired');
    expect([r.total, r.truncated, r.excludedByCurrentSpace]).toEqual([3, false, 0]);
    for (const row of r.rows) {
      expect(row.provenance.fetchedAt).toBe(at(-1));
      expect([row.stale, row.ageHours]).toEqual([false, 1]);
    }
  });

  it('recomputes verdicts at read time after a constraint edit', async () => {
    const { x, def } = await world();
    h = x;
    const put = await x.request(`/api/definitions/${def.id}`, { method: 'PUT', json: { constraints: { maxStops: 1, checkedBagRequired: true, maxPricePence: 50_000 } } });
    expect(put.status).toBe(200);
    const r = await results(x, def.id);
    expect(r.rows.map((row) => [row.itineraryHash, row.verdictClass])).toEqual([
      ['hP', 'partially-verified'],
      ['hF', 'failed'],
      ['hV', 'failed'],
    ]);
  });

  it('returns stale rows labelled, never hidden', async () => {
    const { x, def } = await world();
    h = x;
    x.clock.advance(200 * 3_600_000); // 201 h > STALE_AFTER_HOURS 192
    const r = await results(x, def.id);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((row) => row.stale && row.ageHours === 201)).toBe(true);
  });

  it('dedups per itinerary: the cheapest offer is the row, the others are in otherOffers', async () => {
    const { x, def } = await world();
    h = x;
    seedObservation(x.ports.db, { executionId: 'E1', cell: C1, hash: 'hV', seller: 'OTA', pricePence: 58_000, fetchedAt: at(-1) });
    const r = await results(x, def.id);
    const hv = r.rows.filter((row) => row.itineraryHash === 'hV');
    expect(hv).toHaveLength(1);
    expect(hv[0]?.pricePence).toBe(58_000);
    expect(hv[0]?.otherOffers.map((o) => [o.seller, o.pricePence])).toEqual([['BA', 60_000]]);
    expect(hv[0]?.otherOffers[0]?.provenance.providerId).toBe('fixture');
  });

  it('caps at limit with truncated and total; refuses a limit above 1000', async () => {
    const { x, def } = await world();
    h = x;
    const r = await results(x, def.id, '?limit=2');
    expect([r.rows.length, r.total, r.truncated]).toEqual([2, 3, true]);
    expect((await x.request(`/api/definitions/${def.id}/results?limit=1001`)).status).toBe(400);
  });

  it('includes children; marks rows not seen in the newer search and ranks them after seen rows', async () => {
    const { x, def } = await world();
    h = x;
    seedExecution(x.ports.db, { id: 'E2', def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.5), child: C1 });
    seedOutcome(x.ports.db, 'E2', C1, 'verification', 'fixture', { status: 'priced', fetchedAt: at(-0.5) });
    seedObservation(x.ports.db, { executionId: 'E2', cell: C1, hash: 'hC', pricePence: 65_000, fetchedAt: at(-0.5) });
    const r = await results(x, def.id);
    const order = r.rows.map((row) => row.itineraryHash);
    expect(order.indexOf('hC')).toBeLessThan(order.indexOf('hV')); // why: hC is dearer but seen in the latest search
    expect(r.rows.find((row) => row.itineraryHash === 'hC')?.notSeenInLatest).toBeNull();
    expect(r.rows.find((row) => row.itineraryHash === 'hV')?.notSeenInLatest).toEqual({ ageHours: 0 });
    expect(r.rows.find((row) => row.itineraryHash === 'hP')?.notSeenInLatest).toBeNull();
    expect(r.coverage.onDemand).toBe(1);
  });

  it('scopes to one execution with executionId; 404 for a foreign one', async () => {
    const { x, def } = await world();
    h = x;
    expect((await results(x, def.id, '?executionId=E1')).total).toBe(3);
    expect((await x.request(`/api/definitions/${def.id}/results?executionId=nope`)).status).toBe(404);
  });
});

describe('GET /definitions/:id/results, calendar basis (spec §6.9)', () => {
  it('is the default with no verification provider, with the reason, unchecked rows, not-applied list and a search link', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(
      exampleDefinitionInput({ providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 168 } }, constraints: { maxJourneyMinutes: 1500 } }),
    );
    seedExecution(h.ports.db, { id: 'E3', def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    seedCalendarPrice(h.ports.db, { executionId: 'E3', cell: C1, pricePence: 45_000, fetchedAt: at(-3) });
    const r = await results(h, def.id);
    expect(r.basis).toBe('calendar');
    expect(r.basisReason).toBe(API_TEXT.basisNoVerificationProvider);
    const row = r.rows[0];
    expect(row?.verdictClass).toBe('unchecked');
    expect(row?.notApplied).toEqual(['maxJourneyMinutes']);
    expect(row?.booking).toEqual({ kind: 'none' });
    expect(row?.searchLink.url).toMatch(/^https:\/\//);
    expect(row?.outbound).toBeNull();
    expect([row?.stale, row?.ageHours]).toEqual([false, 3 + 24]);
  });

  it('is the default when a verification provider exists but nothing was itinerary-searched', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput());
    seedExecution(h.ports.db, { id: 'E3', def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    seedCalendarPrice(h.ports.db, { executionId: 'E3', cell: C1, pricePence: 45_000, fetchedAt: at(-3) });
    expect((await results(h, def.id)).basisReason).toBe(API_TEXT.basisNoObservations);
  });

  it('can be requested explicitly, and ignores reused copies', async () => {
    const { x, def } = await world();
    h = x;
    seedCalendarPrice(x.ports.db, { executionId: 'E1', cell: C1, pricePence: 45_000, fetchedAt: at(-3) });
    seedExecution(x.ports.db, { id: 'E4', def, status: 'completed', startedAt: at(-0.2), finishedAt: at(-0.1) });
    seedCalendarPrice(x.ports.db, { executionId: 'E4', cell: C1, pricePence: 45_000, fetchedAt: at(-3), reusedFrom: 'E1' });
    const r = await results(x, def.id, '?basis=calendar');
    expect(r.basisReason).toBe(API_TEXT.basisRequestedCalendar);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.provenance.fetchedAt).toBe(at(-3));
  });
});

describe('review focus 4: the definition is edited after the rows were written', () => {
  it('reports the excluded count and says "0 of 3 rows are inside…" rather than "no results"', async () => {
    const { x, def } = await world();
    h = x;
    for (const [c, p] of [[C1, 45_000], [C2, 46_000], [C3, 47_000]] as const) seedCalendarPrice(x.ports.db, { executionId: 'E1', cell: c, pricePence: p, fetchedAt: at(-1) });
    expect((await x.request(`/api/definitions/${def.id}`, { method: 'PUT', json: { minNights: 11 } })).status).toBe(200);
    for (const q of ['?basis=verified', '']) {
      const r = await results(x, def.id, q);
      expect(r.rows).toEqual([]);
      expect([r.total, r.excludedByCurrentSpace]).toEqual([0, 3]);
      expect(r.basisReason).toContain(API_TEXT.insideSpace(0, 3));
    }
  });
});

```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- results`
Expected: FAIL: every results request returns 404 `not_found`.

- [ ] **Step 3: Implement**

`src/read/rows.ts`:

```ts
import {
  type CellKey, type CellOutcome, type Config, type ConstraintName, type Constraints, type IsoDateTime, type Provenance,
  type ProviderId, type SearchDefinition, type Verdict, type apiContract,
  cellKeyString, daysBetween, effectiveAge, evaluateConstraints, searchLinkFor, verdictClass, worstCaseAgeHours,
} from '@gmt/core';
import type { CalendarPriceRow, ObservationRow } from '@gmt/db';
import type { z } from 'zod';
import { DEFAULT_REFRESH_HOURS } from '../defaults.js';

export type ResultRow = z.infer<typeof apiContract.resultRowSchema>;
export type PriceCell = z.infer<typeof apiContract.priceCellSchema>;
/** A price with its cell: the unit of every calendar, duration, gap and cell-detail shape. */
export type DatedPrice = PriceCell & { cell: ResultRow['cell'] };
export type Basis = 'verified' | 'calendar';
export interface RowContext { def: SearchDefinition; now: IsoDateTime; config: Config }

const HOUR = 3_600_000;
export function hoursSince(from: IsoDateTime, now: IsoDateTime): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(from)) / HOUR));
}

export function refreshHoursFor(def: SearchDefinition, providerId: ProviderId): number {
  return def.providers.discoveryRefreshHours[providerId] ?? DEFAULT_REFRESH_HOURS;
}

/**
 * Spec §8.1 "Staleness per price". `ageHours` is the worst-case effective age (spec §3); unknown is stale.
 * Verified basis: > STALE_AFTER_HOURS. Calendar basis: > CALENDAR_STALE_AFTER_HOURS, else
 * > discoveryRefreshHours + maxAgeHours of the provider.
 */
export function staleness(p: Provenance, basis: Basis, rc: RowContext): { ageHours: number | 'unknown'; stale: boolean } {
  const worst = worstCaseAgeHours(effectiveAge(p, rc.now));
  if (worst === 'unknown') return { ageHours: 'unknown', stale: true };
  const threshold =
    basis === 'verified'
      ? rc.config.staleAfterHours
      : (rc.config.calendarStaleAfterHours ?? refreshHoursFor(rc.def, p.providerId) + (p.maxAgeHours === 'unknown' ? 0 : p.maxAgeHours));
  return { ageHours: worst, stale: worst > threshold };
}

/** Spec §3 provenance of a calendar row; `max_age_hours` NULL means unknown (spec §7). Nothing defaulted. */
export function calendarProvenance(r: CalendarPriceRow): Provenance {
  return {
    providerId: r.providerId,
    sourceKind: r.sourceKind,
    fetchedAt: r.fetchedAt,
    ...(r.providerObservedAt === null ? {} : { providerObservedAt: r.providerObservedAt }),
    maxAgeHours: r.maxAgeHours ?? 'unknown',
    fx: r.fx,
    pointOfSale: r.pointOfSale,
    cabin: r.cabin,
  };
}

export function withNights(c: CellKey): ResultRow['cell'] {
  return { origin: c.origin, destination: c.destination, departureDate: c.departureDate, returnDate: c.returnDate, nights: daysBetween(c.departureDate, c.returnDate) };
}

/** Constraints the operator set; on calendar rows these are "not applied" (spec §6.9). */
export function configuredConstraints(c: Constraints): ConstraintName[] {
  return (Object.keys(c) as Array<keyof Constraints>).filter((k) => c[k] !== undefined);
}

function adjusted(def: SearchDefinition, destination: CellKey['destination'], pricePence: number): number | null {
  const onward = def.onwardCostPence[destination];
  return onward === undefined ? null : pricePence + onward; // why: a separate column, never merged into price (spec §11)
}

/** Spec §6.9 calendar-basis row. */
export function calendarRow(r: CalendarPriceRow, rc: RowContext): ResultRow {
  const provenance = calendarProvenance(r);
  const s = staleness(provenance, 'calendar', rc);
  return {
    itineraryHash: null, basis: 'calendar', verdictClass: 'unchecked', pricePence: r.pricePence, provenance, stale: s.stale, ageHours: s.ageHours,
    cell: withNights(r), outbound: null, inbound: null, totalMinutes: null, stopsOut: null, stopsIn: null, carriers: [], verdicts: {}, unverified: [],
    notApplied: configuredConstraints(rc.def.constraints), booking: { kind: 'none' }, searchLink: searchLinkFor(r.providerId, r, rc.def.cabin),
    otherOffers: [], notSeenInLatest: null, adjustedPence: adjusted(rc.def, r.destination, r.pricePence),
    destinationNote: rc.def.destinationNotes[r.destination] ?? null, bandCheapest: false,
  };
}

/** Spec §6.2/§6.9 verified-basis row: verdicts evaluated now, against the current definition. */
export function verifiedRow(o: ObservationRow, rc: RowContext, notSeenInLatest: { ageHours: number } | null): ResultRow {
  const obs = o.observation;
  const it = o.itinerary;
  const verdicts = evaluateConstraints(
    it,
    { requestedCabin: rc.def.cabin, pricePence: obs.pricePence, segmentCabins: obs.segmentCabins, selfTransfer: obs.selfTransfer, baggage: obs.baggage },
    rc.def.constraints,
    obs.suppliedFields,
  );
  const s = staleness(obs.provenance, 'verified', rc);
  const unverified = (Object.entries(verdicts) as Array<[ConstraintName, Verdict | undefined]>).filter(([, v]) => v === 'unverified').map(([k]) => k);
  return {
    itineraryHash: it.hash, basis: 'verified', verdictClass: verdictClass(verdicts), pricePence: obs.pricePence, provenance: obs.provenance,
    stale: s.stale, ageHours: s.ageHours, cell: withNights(it), outbound: it.outbound, inbound: it.inbound,
    totalMinutes: it.outboundMinutes !== undefined && it.inboundMinutes !== undefined ? it.outboundMinutes + it.inboundMinutes : null,
    stopsOut: it.stopsOut, stopsIn: it.stopsIn, carriers: it.marketingCarriers, verdicts, unverified, notApplied: [],
    // why: offers carry their seller in otherOffers after dedup; booking is the observation's validated booking (spec §5.2).
    booking: obs.booking, searchLink: searchLinkFor(o.offer.providerId, it, rc.def.cabin), otherOffers: [], notSeenInLatest,
    adjustedPence: adjusted(rc.def, it.destination, obs.pricePence), destinationNote: rc.def.destinationNotes[it.destination] ?? null, bandCheapest: false,
  };
}

export function datedPrice(row: ResultRow): DatedPrice {
  return { pricePence: row.pricePence, provenance: row.provenance, stale: row.stale, ageHours: row.ageHours, cell: row.cell };
}

/** An offer's current price is its latest observation (spec §7 `latest` = max fetchedAt, tie id). */
export function latestPerOffer(rows: readonly ObservationRow[]): ObservationRow[] {
  const best = new Map<number, ObservationRow>();
  for (const r of rows) {
    const cur = best.get(r.offer.id);
    const a = r.observation.provenance.fetchedAt;
    const b = cur?.observation.provenance.fetchedAt;
    if (cur === undefined || b === undefined || a > b || (a === b && r.observation.id > cur.observation.id)) best.set(r.offer.id, r);
  }
  return [...best.values()];
}

/**
 * Spec §8.1: a row is "not seen in latest search" when its cell's newest `priced | empty`
 * verification outcome comes from another execution in which this offer has no observation.
 */
export function notSeenResolver(rows: readonly ObservationRow[], latestOutcome: (cell: CellKey) => CellOutcome | null, now: IsoDateTime) {
  const seen = new Set(rows.map((r) => `${r.executionId}|${r.offer.id}`));
  const cache = new Map<string, CellOutcome | null>();
  return (r: ObservationRow): { ageHours: number } | null => {
    const key = cellKeyString(r.itinerary);
    let latest = cache.get(key);
    if (latest === undefined) {
      latest = latestOutcome(r.itinerary);
      cache.set(key, latest);
    }
    if (latest === null || (latest.status !== 'priced' && latest.status !== 'empty')) return null;
    if (latest.executionId === r.executionId || seen.has(`${latest.executionId}|${r.offer.id}`)) return null;
    return { ageHours: hoursSince(latest.fetchedAt ?? now, now) };
  };
}
```

`src/read/coverage.ts` (the summary; the full View D route joins in Task 8.12):

```ts
import { type CellOutcomeStatus, type apiContract, cellKeyString } from '@gmt/core';
import type { Execution } from '@gmt/db';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';

export type Buckets = z.infer<typeof apiContract.bucketsSchema>;
export type CoverageSummary = z.infer<typeof apiContract.coverageSummarySchema>;
const SEARCHED: ReadonlySet<CellOutcomeStatus> = new Set(['priced', 'empty', 'no_data']);

export function zeroBuckets(): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
}

/**
 * Spec §3/§11 header line: six discovery buckets over the latest parent execution's cell
 * roll-ups (they sum to the cell count), "(R reused)", "itinerary-searched K of N selected",
 * "+C on demand" from completed children.
 */
export function coverageSummaryFor(latestParent: Execution | null, executions: readonly Execution[], ports: Ports): CoverageSummary {
  const onDemand = executions.filter((e) => e.isChild && e.status === 'completed').length;
  if (latestParent === null) return { buckets: zeroBuckets(), total: 0, selected: 0, itinerarySearched: 0, onDemand };
  const rollUps = ports.repos.cells.rollUps(latestParent.id);
  const buckets = zeroBuckets();
  for (const r of rollUps.values()) if (r.discovery.status !== null) buckets[r.discovery.status] += 1;
  buckets.reused = new Set(
    ports.repos.cells.outcomes(latestParent.id).filter((o) => o.stage === 'discovery' && o.reusedFromExecutionId !== null).map(cellKeyString),
  ).size;
  const selected = ports.repos.cells.selected(latestParent.id);
  const itinerarySearched = selected.filter((c) => {
    const status = rollUps.get(cellKeyString(c))?.verification.status ?? null;
    return status !== null && SEARCHED.has(status);
  }).length;
  return { buckets, total: rollUps.size, selected: selected.length, itinerarySearched, onDemand };
}
```

`src/read/results.ts`:

```ts
import { type ResolvedSpace, type SearchDefinition, type apiContract, bandCheapest, dedupByItinerary, rankRows } from '@gmt/core';
import type { Execution, ObservationRow } from '@gmt/db';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
import { type Basis, type ResultRow, type RowContext, calendarRow, hoursSince, latestPerOffer, notSeenResolver, verifiedRow } from './rows.js';
import { cellInSpace, currentSpace } from './space.js';

export type ResultsResponse = z.infer<typeof apiContract.resultsResponseSchema>;
export type ResultsQuery = z.infer<typeof apiContract.resultsQuerySchema>;
/** Spec §6.5: at most 1000 rows per response. */
export const RESULTS_CAP = 1000;
/** Spec §6.5: `bandCheapest(rows, 6h)`. */
export const BAND_HOURS = 6;

export interface Loaded {
  def: SearchDefinition;
  space: ResolvedSpace;
  /** All executions of the definition (children included), newest first by start. */
  all: Execution[];
  /** The executions the rows come from (all, or the one `executionId`). */
  scoped: Execution[];
  latestParent: Execution | null;
  /** One row per offer inside the current space, verdicts evaluated now; not deduped. */
  verified: ResultRow[];
  /** One row per (provider, cell) inside the current space; reused copies ignored. */
  calendar: ResultRow[];
  /** Itineraries / calendar rows dropped because they fall outside the current space. */
  excluded: { verified: number; calendar: number };
}

/** Everything the read routes share: rows of both bases for the definition's current space and cabin. */
export function loadRows(def: SearchDefinition, ports: Ports, executionId?: string): Loaded {
  const now = ports.clock.now();
  const space = currentSpace(def, ports.clock.todayLondon());
  const all = [...ports.repos.executions.listForDefinition(def.id, { includeChildren: true })].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  const scoped = executionId === undefined ? all : all.filter((e) => e.id === executionId);
  if (executionId !== undefined && scoped.length === 0) throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound(executionId));
  const ids = new Set(scoped.map((e) => e.id));
  const rc: RowContext = { def, now, config: ports.config };

  const raw = ports.repos.itineraries.observationsForDefinition(def.id, [...ids], null, def.cabin);
  // why: "seen in execution X" must consider every observation, not only each offer's latest one.
  const notSeen = notSeenResolver(raw, (c) => ports.repos.itineraries.latestVerificationOutcomeForCell(def.id, c), now);
  const latest = latestPerOffer(raw);
  const inSpace = latest.filter((o) => cellInSpace(space, o.itinerary));
  const hashes = (xs: readonly ObservationRow[]) => new Set(xs.map((o) => o.itinerary.hash)).size;

  const calendarAll = ports.repos.calendarPrices.latestPerCell(def.id, def.cabin, null).filter((r) => ids.has(r.executionId) && r.reusedFromExecutionId === null);
  const calendarIn = calendarAll.filter((r) => cellInSpace(space, r));

  return {
    def,
    space,
    all,
    scoped,
    latestParent: all.find((e) => !e.isChild) ?? null,
    verified: inSpace.map((o) => verifiedRow(o, rc, notSeen(o))),
    calendar: calendarIn.map((r) => calendarRow(r, rc)),
    excluded: { verified: hashes(latest) - hashes(inSpace), calendar: calendarAll.length - calendarIn.length },
  };
}

/** Spec §6.9 default basis and its reason. */
function chooseBasis(loaded: Loaded, requested: Basis | undefined): { basis: Basis; reason: string } {
  const providers = (loaded.latestParent?.snapshot ?? loaded.def).providers;
  const hasVerification = providers.verification.length > 0;
  if (requested === 'calendar') return { basis: 'calendar', reason: API_TEXT.basisRequestedCalendar };
  if (requested === 'verified') return { basis: 'verified', reason: API_TEXT.basisItinerarySearched };
  if (!hasVerification) return { basis: 'calendar', reason: API_TEXT.basisNoVerificationProvider };
  if (loaded.verified.length === 0) return { basis: 'calendar', reason: API_TEXT.basisNoObservations };
  return { basis: 'verified', reason: API_TEXT.basisItinerarySearched };
}

/** Spec §10 `GET /definitions/:id/results`. No sort or filter parameters: the client sorts and filters (spec §6.5). */
export function assembleResults(def: SearchDefinition, q: ResultsQuery, ports: Ports): ResultsResponse {
  const now = ports.clock.now();
  const loaded = loadRows(def, ports, q.executionId);
  const { basis, reason } = chooseBasis(loaded, q.basis);
  const rows = basis === 'verified' ? dedupByItinerary(loaded.verified) : loaded.calendar;
  const ranked = bandCheapest(rankRows(rows), BAND_HOURS);
  const excluded = basis === 'verified' ? loaded.excluded.verified : loaded.excluded.calendar;
  const total = ranked.length;
  const limit = Math.min(q.limit ?? RESULTS_CAP, RESULTS_CAP);
  return {
    rows: ranked.slice(0, limit),
    total,
    truncated: total > limit,
    basis,
    basisReason: excluded > 0 ? `${reason} · ${API_TEXT.insideSpace(total, total + excluded)}` : reason,
    executions: loaded.scoped.map((e) => ({ id: e.id, status: e.status, ageHours: hoursSince(e.startedAt ?? now, now) })),
    coverage: coverageSummaryFor(loaded.latestParent, loaded.all, ports),
    excludedByCurrentSpace: excluded,
  };
}
```

`src/routes/results.ts` (Task 8.12 adds the other view routes to this table):

```ts
import { assembleResults, type ResultsQuery } from '../read/results.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable } from './types.js';

export const resultHandlers: HandlerTable = {
  'GET /definitions/:id/results': (c, input, ctx) =>
    c.json(assembleResults(getLiveDefinition(ctx, param(input, 'id')), (input.query ?? {}) as ResultsQuery, ctx.ports)),
};
```

`src/routes/index.ts`: add `...resultHandlers,`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- results`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: results: basis, dedup, class-then-price ranking, cap, stale, notSeenInLatest, excluded rows"
```

### Task 8.12: Calendar, duration analysis, coverage, calendar gap, cell detail

**Files:**
- Create: `src/read/calendar.ts`, `src/read/duration.ts`, `src/read/cell.ts`, `src/read/coverageView.ts`
- Modify: `src/read/coverage.ts`, `src/read/rows.ts`, `src/read/results.ts` (export `chooseBasis`), `src/routes/results.ts`
- Test: `test/views.test.ts`

**Interfaces:**
- Consumes: `loadRows`, `datedPrice`, `withNights` (Task 8.11); `CellsRepo.outcomes/rollUps/selected`, `LedgerRepo.overrun`, `NotificationsRepo.wasSent` (WP3); `addDays`, `iataSchema`, `isoDateSchema` (WP0/WP1).
- Produces: `assembleCalendar`, `assembleDuration`, `assembleCoverage`, `assembleCalendarGap`, `assembleCellDetail`, `ledgerByProvider`; routes `GET /definitions/:id/calendar`, `/duration-analysis`, `/coverage`, `/calendar-gap`, `/cells/:origin/:destination/:departureDate/:returnDate`.

Rules: every view reads the same rows as `/results` (Task 8.11: current space and cabin, children included, verdicts recomputed now) and dedups itinerary-searched rows per itinerary before counting. Calendar days cover every departure date of the current window. Six-bucket counts, selection and coverage come from the **latest parent** execution (children are excluded from "latest execution", spec §8.1) and count completed children per day as "on demand". `cheapestVerified` uses class `verified` only; `cheapestPartiallyVerified` carries its `count`. Calendar gap is `{ hidden: true }` when the definition has no verification provider (spec §6.9). Coverage `errors[].retryable` is what a manual resume would pick up (spec §7 Resume): reasons `auth`, `quota`, `parse` always; other reasons while `attempts < 3`, except the deterministic `no-return-legs`, `fx-unavailable`, `currency-unsupported`, `unknown-airport-tz`.

- [ ] **Step 1: Write the failing test**

`test/views.test.ts`:

```ts
import { apiContract, daysBetween } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { currentSpace } from '../src/read/space.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, createHarness, stopMsw } from './harness.js';
import { at, cell, seedCalendarPrice, seedCell, seedExecution, seedObservation, seedOutcome } from './seed.js';

const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const C3 = cell('LHR', 'JFK', '2026-11-04', '2026-11-14');
const C4 = cell('LHR', 'JFK', '2026-11-05', '2026-11-15');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

/** Discovery: C1 priced £450, C2 no data, C3 no fares, C4 error. Selection: all four; C4 not reached. Observations as in Task 8.11. */
async function world() {
  const x = await createHarness();
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints: { maxStops: 1, checkedBagRequired: true } }));
  const db = x.ports.db;
  seedExecution(db, { id: 'E1', def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  seedCell(db, 'E1', C1, { discoveryStatus: 'priced', discoveryMinPence: 45_000, selected: true, selectionReason: 'top_n', verificationStatus: 'priced' });
  seedCell(db, 'E1', C2, { discoveryStatus: 'no_data', selected: true, selectionReason: 'top_n', verificationStatus: 'priced' });
  seedCell(db, 'E1', C3, { discoveryStatus: 'empty', selected: true, selectionReason: 'top_n', verificationStatus: 'priced' });
  seedCell(db, 'E1', C4, { discoveryStatus: 'error', selected: true, selectionReason: 'always_include', verificationStatus: 'not_run' });
  seedOutcome(db, 'E1', C1, 'discovery', 'fixture', { status: 'priced', fetchedAt: at(-1), minPence: 45_000 });
  seedOutcome(db, 'E1', C2, 'discovery', 'fixture', { status: 'no_data', fetchedAt: at(-1) });
  seedOutcome(db, 'E1', C3, 'discovery', 'fixture', { status: 'empty', fetchedAt: at(-1) });
  seedOutcome(db, 'E1', C4, 'discovery', 'fixture', { status: 'error', reason: 'upstream', attempts: 1 });
  for (const c of [C1, C2, C3]) seedOutcome(db, 'E1', c, 'verification', 'fixture', { status: 'priced', fetchedAt: at(-1) });
  seedOutcome(db, 'E1', C4, 'verification', 'fixture', { status: 'not_run' });
  seedCalendarPrice(db, { executionId: 'E1', cell: C1, pricePence: 45_000, fetchedAt: at(-1) });
  seedObservation(db, { executionId: 'E1', cell: C1, hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) });
  seedObservation(db, { executionId: 'E1', cell: C2, hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null });
  seedObservation(db, { executionId: 'E1', cell: C3, hash: 'hF', pricePence: 30_000, fetchedAt: at(-1), stopsOut: 2 });
  return { x, def };
}

async function view<T>(x: Harness, path: string, routePath: string): Promise<T> {
  const res = await x.request(path);
  expect(res.status).toBe(200);
  return (await expectContract(res, 'GET', routePath)) as T;
}

describe('GET /definitions/:id/calendar (spec §10, View B)', () => {
  it('per day: six buckets per provider, selection, the three cheapest and byDestination', async () => {
    const { x, def } = await world();
    h = x;
    type Calendar = z.infer<typeof apiContract.calendarResponseSchema>;
    const cal = await view<Calendar>(x, `/api/definitions/${def.id}/calendar`, '/definitions/:id/calendar');
    const space = currentSpace(def, x.clock.todayLondon());
    expect(cal.days).toHaveLength(daysBetween(space.departureFrom, space.departureTo) + 1);
    const day = (d: string) => cal.days.find((x2) => x2.date === d);
    expect(day('2026-11-02')?.discovery).toEqual([{ providerId: 'fixture', buckets: { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 } }]);
    expect(day('2026-11-02')?.verification).toEqual({ selected: 1, itinerarySearched: 1, onDemand: 0 });
    expect(day('2026-11-02')?.cheapestVerified?.pricePence).toBe(60_000);
    expect(day('2026-11-02')?.cheapestCalendar?.pricePence).toBe(45_000);
    expect(day('2026-11-02')?.cheapestPartiallyVerified).toBeNull();
    expect(day('2026-11-02')?.byDestination.map((b) => [b.destination, b.cheapestVerified?.pricePence])).toEqual([['JFK', 60_000]]);
    expect(day('2026-11-03')?.discovery[0]?.buckets.no_data).toBe(1);
    expect(day('2026-11-03')?.cheapestPartiallyVerified).toMatchObject({ pricePence: 40_000, count: 1 });
    expect(day('2026-11-04')?.discovery[0]?.buckets.empty).toBe(1);
    expect(day('2026-11-04')?.cheapestVerified).toBeNull(); // why: hF is class failed
    expect(day('2026-11-05')?.discovery[0]?.buckets.error).toBe(1);
    expect(day('2026-11-05')?.verification).toEqual({ selected: 1, itinerarySearched: 0, onDemand: 0 });
  });
});

describe('GET /definitions/:id/duration-analysis (spec §10, View C)', () => {
  it('per nights: min among class verified with n, calendar per provider with n, gaps as null / empty', async () => {
    const { x, def } = await world();
    h = x;
    type Duration = z.infer<typeof apiContract.durationAnalysisResponseSchema>;
    const d = await view<Duration>(x, `/api/definitions/${def.id}/duration-analysis`, '/definitions/:id/duration-analysis');
    expect(d.nights.map((n) => n.nights)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    const ten = d.nights[0];
    expect(ten?.minVerified).toMatchObject({ n: 1, price: { pricePence: 60_000 } });
    expect(ten?.minCalendar).toEqual([expect.objectContaining({ providerId: 'fixture', n: 1, price: expect.objectContaining({ pricePence: 45_000 }) })]);
    expect(d.nights[1]).toMatchObject({ nights: 11, minVerified: null, minCalendar: [] });
  });
});

describe('GET /definitions/:id/coverage (spec §10, View D)', () => {
  it('summary, per stage × provider, selected-but-not-reached, errors with retry, flags', async () => {
    const { x, def } = await world();
    h = x;
    type Coverage = z.infer<typeof apiContract.coverageResponseSchema>;
    const cov = await view<Coverage>(x, `/api/definitions/${def.id}/coverage`, '/definitions/:id/coverage');
    expect(cov.executionId).toBe('E1');
    expect(cov.summary).toEqual({ buckets: { priced: 1, empty: 1, no_data: 1, error: 1, skipped: 0, not_run: 0, reused: 0 }, total: 4, selected: 4, itinerarySearched: 3, onDemand: 0 });
    expect(cov.perStageProvider.find((p) => p.stage === 'discovery')?.total).toBe(4);
    expect(cov.selectedNotReached).toEqual([{ cell: { ...C4, nights: 10 }, reason: 'not_run' }]);
    expect(cov.errors).toEqual([expect.objectContaining({ stage: 'discovery', providerId: 'fixture', reason: 'upstream', attempts: 1, retryable: true })]);
    expect(cov.flags).toEqual({ overrun: false, parityBreak: false });
    expect(cov.requests).toEqual([]);
  });
});

describe('GET /definitions/:id/calendar-gap (spec §10, §6.9)', () => {
  it('lists calendar prices below the cheapest class-verified price', async () => {
    const { x, def } = await world();
    h = x;
    seedCalendarPrice(x.ports.db, { executionId: 'E1', cell: C2, pricePence: 70_000, fetchedAt: at(-1) });
    type Gap = z.infer<typeof apiContract.calendarGapResponseSchema>;
    const gap = await view<Gap>(x, `/api/definitions/${def.id}/calendar-gap`, '/definitions/:id/calendar-gap');
    expect(gap.hidden).toBe(false);
    expect(gap.cheapestVerified?.pricePence).toBe(60_000);
    expect(gap.cells.map((c) => [c.cell.departureDate, c.pricePence])).toEqual([['2026-11-02', 45_000]]);
  });
  it('is hidden when the definition has no verification provider', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput({ providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} } }));
    type Gap = z.infer<typeof apiContract.calendarGapResponseSchema>;
    expect(await view<Gap>(h, `/api/definitions/${def.id}/calendar-gap`, '/definitions/:id/calendar-gap')).toEqual({ hidden: true, cheapestVerified: null, cells: [] });
  });
});

describe('GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate (spec §10, View B side panel)', () => {
  const route = '/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate';
  it("returns the cell's outcomes per stage and provider and its prices with provenance", async () => {
    const { x, def } = await world();
    h = x;
    type Detail = z.infer<typeof apiContract.cellDetailResponseSchema>;
    const d = await view<Detail>(x, `/api/definitions/${def.id}/cells/LHR/JFK/2026-11-02/2026-11-12`, route);
    expect(d.outcomes.map((o) => [o.executionId, o.stage, o.status]).sort()).toEqual([['E1', 'discovery', 'priced'], ['E1', 'verification', 'priced']]);
    expect(d.calendarPrices.map((p) => [p.pricePence, p.provenance.providerId])).toEqual([[45_000, 'fixture']]);
    expect(d.observations.map((o) => [o.itineraryHash, o.price.pricePence, o.verdictClass])).toEqual([['hV', 60_000, 'verified']]);
  });
  it('400 on a malformed path parameter', async () => {
    const { x, def } = await world();
    h = x;
    expect((await x.request(`/api/definitions/${def.id}/cells/LHR/JFK/2026-02-30/2026-03-10`)).status).toBe(400);
    expect((await x.request(`/api/definitions/${def.id}/cells/lhr/JFK/2026-11-02/2026-11-12`)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- views`
Expected: FAIL: every view route returns 404 `not_found`.

- [ ] **Step 3: Implement**

In `src/read/results.ts` add `export` to `function chooseBasis`. In `src/read/rows.ts` add:

```ts
/** The cheapest row, or null. */
export function cheapest(rows: readonly ResultRow[]): ResultRow | null {
  let best: ResultRow | null = null;
  for (const r of rows) if (best === null || r.pricePence < best.pricePence) best = r;
  return best;
}
```

In `src/read/coverage.ts` change `const SEARCHED` to `export const SEARCHED`. Create `src/read/coverageView.ts` (a separate file so `results.ts` → `coverage.ts` stays acyclic):

```ts
import { type CellOutcome, PENCE_TO_MICRO, type SearchDefinition, type apiContract, cellKeyString } from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
import { executionResponse } from './executions.js';
import { loadRows } from './results.js';
import { withNights } from './rows.js';

export type CoverageResponse = z.infer<typeof apiContract.coverageResponseSchema>;
/** Reasons a manual resume always retries (spec §7 Resume). */
const MANUAL_RETRY = new Set(['auth', 'quota', 'parse']);
/** Deterministic failures no resume retries (spec §7 Resume). */
const NEVER_RETRY = new Set(['no-return-legs', 'fx-unavailable', 'currency-unsupported', 'unknown-airport-tz']);

export function retryable(o: Pick<CellOutcome, 'reason' | 'attempts'>): boolean {
  const reason = o.reason ?? '';
  if (MANUAL_RETRY.has(reason)) return true;
  return o.attempts < 3 && !NEVER_RETRY.has(reason);
}

/** Per-provider request counts for one execution (spec §10 coverage). Reads the ledger table by its spec §7 columns. */
export function ledgerByProvider(ports: Ports, executionId: string) {
  const rows = ports.db.raw
    .prepare(
      `select provider_id as providerId,
              sum(case when outcome = 'cache_hit' then 0 else 1 end) as calls,
              sum(case when outcome = 'cache_hit' then 1 else 0 end) as cacheHits,
              coalesce(sum(cost_micro_gbp), 0) as costMicroGbp
         from provider_requests where execution_id = ? group by provider_id order by provider_id`,
    )
    .all(executionId) as Array<{ providerId: string; calls: number; cacheHits: number; costMicroGbp: number }>;
  return rows.map((r) => ({ ...r, costPence: Math.ceil(r.costMicroGbp / PENCE_TO_MICRO) }));
}

/** Spec §10 `GET /definitions/:id/coverage` (View D). */
export function assembleCoverage(def: SearchDefinition, ports: Ports): CoverageResponse {
  const loaded = loadRows(def, ports);
  const parent = loaded.latestParent;
  const summary = coverageSummaryFor(parent, loaded.all, ports);
  if (parent === null) {
    return { executionId: null, summary, perStageProvider: [], requests: [], flags: { overrun: false, parityBreak: false }, selectedNotReached: [], errors: [] };
  }
  const outcomes = ports.repos.cells.outcomes(parent.id);
  const verification = outcomes.filter((o) => o.stage === 'verification');
  // why: the stored estimate carries ESTIMATE_RETRY_FACTOR; overruns compare with the pre-factor plan (spec §8.1).
  const planLength = parent.estimate === null ? null : Math.round(parent.estimate.perProvider.reduce((n, p) => n + p.calls, 0) / ports.config.estimateRetryFactor);
  const selectedNotReached = ports.repos.cells.selected(parent.id).flatMap((c) => {
    const mine = verification.filter((o) => cellKeyString(o) === cellKeyString(c));
    const budget = mine.some((o) => o.status === 'skipped' && o.reason === 'budget');
    const notRun = mine.some((o) => o.status === 'not_run');
    return budget || notRun ? [{ cell: withNights(c), reason: budget ? ('budget' as const) : ('not_run' as const) }] : [];
  });
  return {
    executionId: parent.id,
    summary,
    perStageProvider: executionResponse(ports, parent).progress,
    requests: ledgerByProvider(ports, parent.id),
    flags: {
      overrun: planLength === null ? false : ports.repos.ledger.overrun(parent.id, planLength),
      parityBreak: ports.repos.notifications.wasSent('parity_break', parent.id),
    },
    selectedNotReached,
    errors: outcomes
      .filter((o) => o.status === 'error')
      .map((o) => ({ cell: withNights(o), stage: o.stage, providerId: o.providerId, reason: o.reason, attempts: o.attempts, retryable: retryable(o) })),
  };
}
```

`src/read/calendar.ts`:

```ts
import { type CellOutcome, type SearchDefinition, type apiContract, addDays, cellKeyString, dedupByItinerary } from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { SEARCHED, zeroBuckets, type Buckets } from './coverage.js';
import { chooseBasis, loadRows } from './results.js';
import { type Basis, type ResultRow, cheapest, datedPrice, hoursSince } from './rows.js';

export type CalendarResponse = z.infer<typeof apiContract.calendarResponseSchema>;

function bucketsOf(outcomes: readonly CellOutcome[]): Buckets {
  const b = zeroBuckets();
  for (const o of outcomes) {
    b[o.status] += 1;
    if (o.reusedFromExecutionId !== null) b.reused += 1;
  }
  return b;
}

/** The three day prices of spec §10: class verified only, partially verified with its count, calendar. */
function cheapestOf(itinerarySearched: readonly ResultRow[], calendar: readonly ResultRow[]) {
  const partial = itinerarySearched.filter((r) => r.verdictClass === 'partially-verified');
  const v = cheapest(itinerarySearched.filter((r) => r.verdictClass === 'verified'));
  const p = cheapest(partial);
  const c = cheapest(calendar);
  return {
    cheapestVerified: v === null ? null : datedPrice(v),
    cheapestPartiallyVerified: p === null ? null : { ...datedPrice(p), count: partial.length },
    cheapestCalendar: c === null ? null : datedPrice(c),
  };
}

/** Spec §10 `GET /definitions/:id/calendar`: one entry per departure date of the current window. */
export function assembleCalendar(def: SearchDefinition, requested: Basis | undefined, ports: Ports): CalendarResponse {
  const now = ports.clock.now();
  const loaded = loadRows(def, ports);
  const parent = loaded.latestParent;
  const providers = (parent?.snapshot ?? def).providers.discovery;
  const discovery = parent === null ? [] : ports.repos.cells.outcomes(parent.id).filter((o) => o.stage === 'discovery');
  const rollUps = parent === null ? new Map() : ports.repos.cells.rollUps(parent.id);
  const selected = parent === null ? [] : ports.repos.cells.selected(parent.id);
  const children = loaded.all.filter((e) => e.isChild && e.status === 'completed');
  const verified = dedupByItinerary(loaded.verified);
  const days: CalendarResponse['days'] = [];
  for (let d = loaded.space.departureFrom; d <= loaded.space.departureTo; d = addDays(d, 1)) {
    const onDay = (r: ResultRow) => r.cell.departureDate === d;
    const v = verified.filter(onDay);
    const cal = loaded.calendar.filter(onDay);
    const sel = selected.filter((c) => c.departureDate === d);
    days.push({
      date: d,
      discovery: providers.map((providerId) => ({ providerId, buckets: bucketsOf(discovery.filter((o) => o.providerId === providerId && o.departureDate === d)) })),
      verification: {
        selected: sel.length,
        itinerarySearched: sel.filter((c) => {
          const s = rollUps.get(cellKeyString(c))?.verification.status ?? null;
          return s !== null && SEARCHED.has(s);
        }).length,
        onDemand: children.filter((e) => e.cell?.departureDate === d).length,
      },
      ...cheapestOf(v, cal),
      byDestination: def.destinations.map((destination) => ({
        destination,
        ...cheapestOf(v.filter((r) => r.cell.destination === destination), cal.filter((r) => r.cell.destination === destination)),
      })),
    });
  }
  return {
    basis: chooseBasis(loaded, requested).basis,
    days,
    executions: loaded.scoped.map((e) => ({ id: e.id, status: e.status, ageHours: hoursSince(e.startedAt ?? now, now) })),
  };
}

/** Spec §10 `GET /definitions/:id/calendar-gap`: calendar prices below the cheapest class-verified price. */
export function assembleCalendarGap(def: SearchDefinition, ports: Ports) {
  if (def.providers.verification.length === 0) return { hidden: true, cheapestVerified: null, cells: [] };
  const loaded = loadRows(def, ports);
  const best = cheapest(loaded.verified.filter((r) => r.verdictClass === 'verified'));
  if (best === null) return { hidden: false, cheapestVerified: null, cells: [] };
  const below = loaded.calendar.filter((r) => r.pricePence < best.pricePence).sort((a, b) => a.pricePence - b.pricePence);
  return { hidden: false, cheapestVerified: datedPrice(best), cells: below.map(datedPrice) };
}
```

`src/read/duration.ts`:

```ts
import { type SearchDefinition, type apiContract, dedupByItinerary } from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { loadRows } from './results.js';
import { cheapest, datedPrice } from './rows.js';

export type DurationResponse = z.infer<typeof apiContract.durationAnalysisResponseSchema>;

/** Spec §10 `GET /definitions/:id/duration-analysis`: per nights, no interpolation (absent → null / []). */
export function assembleDuration(def: SearchDefinition, ports: Ports): DurationResponse {
  const loaded = loadRows(def, ports);
  const verified = dedupByItinerary(loaded.verified).filter((r) => r.verdictClass === 'verified');
  const providers = [...new Set(loaded.calendar.map((r) => r.provenance.providerId))].sort();
  const nights: DurationResponse['nights'] = [];
  for (let n = def.minNights; n <= def.maxNights; n++) {
    const v = verified.filter((r) => r.cell.nights === n);
    const best = cheapest(v);
    nights.push({
      nights: n,
      minVerified: best === null ? null : { price: datedPrice(best), n: v.length },
      minCalendar: providers.flatMap((providerId) => {
        const rows = loaded.calendar.filter((r) => r.cell.nights === n && r.provenance.providerId === providerId);
        const b = cheapest(rows);
        return b === null ? [] : [{ providerId, price: datedPrice(b), n: rows.length }];
      }),
    });
  }
  return { nights };
}
```

`src/read/cell.ts`:

```ts
import { type CellKey, type SearchDefinition, type apiContract, cellKeyString } from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { loadRows } from './results.js';
import { type ResultRow, datedPrice, withNights } from './rows.js';

export type CellDetailResponse = z.infer<typeof apiContract.cellDetailResponseSchema>;

/** Spec §10 cell route (View B side panel): outcomes per execution × stage × provider, and prices with provenance. */
export function assembleCellDetail(def: SearchDefinition, target: CellKey, ports: Ports): CellDetailResponse {
  const key = cellKeyString(target);
  const loaded = loadRows(def, ports);
  const onCell = (r: ResultRow) => cellKeyString(r.cell) === key;
  return {
    cell: withNights(target),
    outcomes: loaded.all.flatMap((e) =>
      ports.repos.cells
        .outcomes(e.id)
        .filter((o) => cellKeyString(o) === key)
        .map((o) => ({
          executionId: e.id, isChild: e.isChild, stage: o.stage, providerId: o.providerId, status: o.status, reason: o.reason,
          attempts: o.attempts, fetchedAt: o.fetchedAt, minPence: o.minPence, reusedFromExecutionId: o.reusedFromExecutionId,
        })),
    ),
    calendarPrices: loaded.calendar.filter(onCell).map(datedPrice),
    observations: loaded.verified.filter(onCell).map((r) => ({ itineraryHash: r.itineraryHash, verdictClass: r.verdictClass, unverified: r.unverified, price: datedPrice(r), booking: r.booking })),
  };
}
```

`src/routes/results.ts` (replace the file):

```ts
import { type CellKey, type apiContract, iataSchema, isoDateSchema } from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { assembleCalendar, assembleCalendarGap } from '../read/calendar.js';
import { assembleCellDetail } from '../read/cell.js';
import { assembleCoverage } from '../read/coverageView.js';
import { assembleDuration } from '../read/duration.js';
import { type ResultsQuery, assembleResults } from '../read/results.js';
import { API_TEXT } from '../text.js';
import { getLiveDefinition, param } from './shared.js';
import type { HandlerTable, RouteInput } from './types.js';

type CalendarQuery = z.infer<typeof apiContract.calendarQuerySchema>;

/** Path parameters of the cell route, validated like a body (400 on a bad code or date). */
function cellFromPath(input: RouteInput): CellKey {
  const o = iataSchema.safeParse(param(input, 'origin'));
  const d = iataSchema.safeParse(param(input, 'destination'));
  const dep = isoDateSchema.safeParse(param(input, 'departureDate'));
  const ret = isoDateSchema.safeParse(param(input, 'returnDate'));
  if (!o.success || !d.success || !dep.success || !ret.success) throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return { origin: o.data, destination: d.data, departureDate: dep.data, returnDate: ret.data };
}

export const resultHandlers: HandlerTable = {
  'GET /definitions/:id/results': (c, input, ctx) =>
    c.json(assembleResults(getLiveDefinition(ctx, param(input, 'id')), (input.query ?? {}) as ResultsQuery, ctx.ports)),
  'GET /definitions/:id/calendar': (c, input, ctx) =>
    c.json(assembleCalendar(getLiveDefinition(ctx, param(input, 'id')), ((input.query ?? {}) as CalendarQuery).basis, ctx.ports)),
  'GET /definitions/:id/duration-analysis': (c, input, ctx) => c.json(assembleDuration(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  'GET /definitions/:id/coverage': (c, input, ctx) => c.json(assembleCoverage(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  'GET /definitions/:id/calendar-gap': (c, input, ctx) => c.json(assembleCalendarGap(getLiveDefinition(ctx, param(input, 'id')), ctx.ports)),
  'GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate': (c, input, ctx) =>
    c.json(assembleCellDetail(getLiveDefinition(ctx, param(input, 'id')), cellFromPath(input), ctx.ports)),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- views results`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: calendar, duration analysis, coverage, calendar gap and cell detail routes"
```

### Task 8.13: History routes and alert rule storage

**Files:**
- Create: `src/read/history.ts`, `src/routes/history.ts`, `src/routes/alerts.ts`
- Modify: `src/routes/index.ts`
- Test: `test/history.test.ts`, `test/alerts.test.ts`

**Interfaces:**
- Consumes: `ItinerariesRepo.offerHistory`, `CalendarPricesRepo.history`, `RoutePriceHistoryRepo.series`, `AlertsRepo` (WP3); `alertRuleRequestSchema`, `historyResponseSchema` (WP0, Open question 2).
- Produces: `historySeries`; routes `GET /itineraries/:hash/history`, `GET /routes/:origin/:destination/history`, `GET/POST /alerts`, `PUT/DELETE /alerts/:id`, `GET /alerts/events`.

Rules: one series per (provider, kind), points ordered by `fetchedAt`, each point with provenance; reused calendar rows are excluded (spec §7, the repository reads `reused_from_execution_id IS NULL`, asserted here); the route series is read in the requested cabin (default economy) and SearchApi's route-level lowest price is its own labelled series (spec §7 `route_price_history`). Alert routes store and read rules and events only; evaluation and delivery are WP11. A PUT is validated on the merged rule, so the `requireAllVerified` refinement (spec §6.8) cannot be bypassed by a partial update.

- [ ] **Step 1: Write the failing tests**

`test/history.test.ts`:

```ts
import { apiContract } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { API_TEXT } from '../src/text.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, createHarness, stopMsw } from './harness.js';
import { at, cell, seedCalendarPrice, seedExecution, seedObservation } from './seed.js';

type History = z.infer<typeof apiContract.historyResponseSchema>;
const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

async function world() {
  const x = await createHarness();
  const def = x.ports.repos.definitions.create(exampleDefinitionInput());
  seedExecution(x.ports.db, { id: 'E1', def, status: 'completed', startedAt: at(-6), finishedAt: at(-5) });
  seedExecution(x.ports.db, { id: 'E2', def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  seedObservation(x.ports.db, { executionId: 'E1', cell: C1, hash: 'hV', pricePence: 60_000, fetchedAt: at(-5) });
  seedObservation(x.ports.db, { executionId: 'E2', cell: C1, hash: 'hV', pricePence: 59_000, fetchedAt: at(-1) });
  seedCalendarPrice(x.ports.db, { executionId: 'E1', cell: C1, pricePence: 45_000, fetchedAt: at(-5) });
  seedCalendarPrice(x.ports.db, { executionId: 'E2', cell: C1, pricePence: 45_000, fetchedAt: at(-5), reusedFrom: 'E1' });
  seedCalendarPrice(x.ports.db, { executionId: 'E2', cell: C2, pricePence: 47_000, fetchedAt: at(-1) });
  x.ports.db.raw
    .prepare('insert into route_price_history (origin, destination, cabin, provider_id, date, lowest_price_pence, fetched_at) values (?, ?, ?, ?, ?, ?, ?)')
    .run('LHR', 'JFK', 'economy', 'fixture', '2026-10-13', 44_000, at(-1));
  return x;
}

describe('history routes (spec §10, §7)', () => {
  it('itinerary history: one series per provider and kind, points in time order with provenance', async () => {
    h = await world();
    const res = await h.request('/api/itineraries/hV/history');
    const body = (await expectContract(res, 'GET', '/itineraries/:hash/history')) as History;
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ providerId: 'fixture', kind: 'observation' });
    expect(body.series[0]?.label).toMatch(/· itinerary-searched offers$/);
    expect(body.series[0]?.points.map((p) => p.pricePence)).toEqual([60_000, 59_000]);
    expect(body.series[0]?.points.every((p) => p.provenance.providerId === 'fixture')).toBe(true);
  });

  it('route history excludes reused rows and carries the route-level lowest series', async () => {
    h = await world();
    const body = (await expectContract(await h.request('/api/routes/LHR/JFK/history'), 'GET', '/routes/:origin/:destination/history')) as History;
    expect(body.series.find((s) => s.kind === 'calendar')?.points.map((p) => p.pricePence)).toEqual([45_000, 47_000]);
    expect(body.series.find((s) => s.kind === 'route-lowest')?.label).toBe(API_TEXT.routeLowestLabel);
  });

  it('reads the requested cabin and rejects a bad airport code', async () => {
    h = await world();
    const business = (await expectContract(await h.request('/api/routes/LHR/JFK/history?cabin=business'), 'GET', '/routes/:origin/:destination/history')) as History;
    expect(business.series.find((s) => s.kind === 'calendar')).toBeUndefined();
    expect((await h.request('/api/routes/lhr/JFK/history')).status).toBe(400);
  });
});
```

`test/alerts.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, createHarness, stopMsw } from './harness.js';
import { at } from './seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

const rule = (definitionId: string) => ({ definitionId, type: 'absolute', thresholdPence: 50_000, basis: 'verified', requireAllVerified: true, cooldownHours: 336, enabled: true });
async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('alert rules (spec §6.8, §10; storage only, WP11 evaluates)', () => {
  it('create, list, update, delete', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput());
    const created = await h.request('/api/alerts', { json: rule(def.id) });
    expect(created.status).toBe(201);
    const r = (await expectContract(created, 'POST', '/alerts')) as { id: string };
    expect(((await expectContract(await h.request(`/api/alerts?definitionId=${def.id}`), 'GET', '/alerts')) as unknown[]).length).toBe(1);
    const put = await h.request(`/api/alerts/${r.id}`, { method: 'PUT', json: { thresholdPence: 40_000 } });
    expect(((await expectContract(put, 'PUT', '/alerts/:id')) as { thresholdPence: number }).thresholdPence).toBe(40_000);
    expect((await h.request(`/api/alerts/${r.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await h.request(`/api/alerts?definitionId=${def.id}`)).json()).toEqual([]);
    const gone = await h.request(`/api/alerts/${r.id}`, { method: 'DELETE' });
    expect(gone.status).toBe(404);
    expect(await code(gone)).toBe('alert_not_found');
  });

  it('requireAllVerified is rejected on calendar basis, on create and through a partial update', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput());
    expect((await h.request('/api/alerts', { json: { ...rule(def.id), basis: 'calendar' } })).status).toBe(400);
    const r = (await (await h.request('/api/alerts', { json: rule(def.id) })).json()) as { id: string };
    const res = await h.request(`/api/alerts/${r.id}`, { method: 'PUT', json: { basis: 'calendar' } });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('invalid_alert_rule');
  });

  it('a rule for an unknown definition is refused', async () => {
    h = await createHarness();
    const res = await h.request('/api/alerts', { json: rule('nope') });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('definition_not_found');
  });

  it('lists events by rule', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(exampleDefinitionInput());
    const r = (await (await h.request('/api/alerts', { json: rule(def.id) })).json()) as { id: string };
    h.ports.db.raw
      .prepare(
        `insert into alert_events (rule_id, identity_key, observation_id, calendar_price_id, dedup_key, fired_at, status, reason, payload_json)
         values (?, 'hV', null, null, 'hV|500', ?, 'sent', 'below £500', '{}')`,
      )
      .run(r.id, at(-1));
    const events = (await expectContract(await h.request(`/api/alerts/events?ruleId=${r.id}`), 'GET', '/alerts/events')) as Array<{ status: string }>;
    expect(events.map((e) => e.status)).toEqual(['sent']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api test -- history alerts`
Expected: FAIL: the routes return 404 `not_found`.

- [ ] **Step 3: Implement**

`src/read/history.ts`:

```ts
import type { ProviderId, apiContract } from '@gmt/core';
import type { HistoryPoint } from '@gmt/db';
import type { z } from 'zod';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';

export type HistoryResponse = z.infer<typeof apiContract.historyResponseSchema>;

function labelFor(kind: HistoryPoint['kind'], name: string): string {
  if (kind === 'route-lowest') return API_TEXT.routeLowestLabel;
  return kind === 'observation' ? API_TEXT.observationSeries(name) : API_TEXT.calendarSeries(name);
}

/** Spec §11 History: one series per provider and kind; x = fetchedAt; gaps are left to the chart. */
export function historySeries(points: readonly HistoryPoint[], ports: Ports): HistoryResponse {
  const groups = new Map<string, { providerId: ProviderId; kind: HistoryPoint['kind']; points: HistoryPoint[] }>();
  for (const p of points) {
    const key = `${p.providerId}|${p.kind}`;
    const g = groups.get(key) ?? { providerId: p.providerId, kind: p.kind, points: [] };
    g.points.push(p);
    groups.set(key, g);
  }
  return {
    series: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, g]) => ({
        providerId: g.providerId,
        kind: g.kind,
        label: labelFor(g.kind, ports.providers.find((p) => p.id === g.providerId)?.displayName ?? g.providerId),
        points: [...g.points]
          .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
          .map((p) => ({ fetchedAt: p.fetchedAt, pricePence: p.pricePence, provenance: p.provenance })),
      })),
  };
}
```

`src/routes/history.ts`:

```ts
import { type apiContract, iataSchema } from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { historySeries } from '../read/history.js';
import { API_TEXT } from '../text.js';
import { param } from './shared.js';
import type { HandlerTable } from './types.js';

type RouteHistoryQuery = z.infer<typeof apiContract.routeHistoryQuerySchema>;

export const historyHandlers: HandlerTable = {
  'GET /itineraries/:hash/history': (c, input, ctx) => c.json(historySeries(ctx.ports.repos.itineraries.offerHistory(param(input, 'hash')), ctx.ports)),

  'GET /routes/:origin/:destination/history': (c, input, ctx) => {
    const o = iataSchema.safeParse(param(input, 'origin'));
    const d = iataSchema.safeParse(param(input, 'destination'));
    if (!o.success || !d.success) throw new ApiError(400, 'validation', API_TEXT.validation('path'));
    const cabin = ((input.query ?? {}) as RouteHistoryQuery).cabin ?? 'economy';
    const points = [
      ...ctx.ports.repos.calendarPrices.history(o.data, d.data, cabin),
      ...ctx.ports.providers.flatMap((p) => ctx.ports.repos.routeHistory.series(o.data, d.data, cabin, p.id)),
    ];
    return c.json(historySeries(points, ctx.ports));
  },
};
```

`src/routes/alerts.ts`:

```ts
import { apiContract } from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import { param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

type AlertRuleRequest = z.infer<typeof apiContract.alertRuleRequestSchema>;
type AlertsQuery = z.infer<typeof apiContract.alertsQuerySchema>;
type AlertEventsQuery = z.infer<typeof apiContract.alertEventsQuerySchema>;

function requireDefinition(ctx: RouteContext, id: string): void {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null) throw new ApiError(422, 'definition_not_found', API_TEXT.definitionNotFound(id));
}

function getRule(ctx: RouteContext, id: string) {
  const rule = ctx.ports.repos.alerts.get(id);
  if (rule === null) throw new ApiError(404, 'alert_not_found', API_TEXT.alertNotFound(id));
  return rule;
}

export const alertHandlers: HandlerTable = {
  'GET /alerts': (c, input, ctx) => c.json(ctx.ports.repos.alerts.rules(((input.query ?? {}) as AlertsQuery).definitionId)),

  'POST /alerts': (c, input, ctx) => {
    const body = input.body as AlertRuleRequest;
    requireDefinition(ctx, body.definitionId);
    return c.json(ctx.ports.repos.alerts.create(body), 201);
  },

  'PUT /alerts/:id': (c, input, ctx) => {
    const existing = getRule(ctx, param(input, 'id'));
    const patch = input.body as Partial<AlertRuleRequest>;
    const { id: _id, ...current } = existing;
    // why: validate the merged rule, so a partial update cannot slip past the requireAllVerified refinement (spec §6.8).
    const merged = apiContract.alertRuleRequestSchema.safeParse({ ...current, ...patch });
    if (!merged.success) throw new ApiError(422, 'invalid_alert_rule', API_TEXT.validation('body'), merged.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
    if (patch.definitionId !== undefined) requireDefinition(ctx, patch.definitionId);
    return c.json(ctx.ports.repos.alerts.update(existing.id, patch));
  },

  'DELETE /alerts/:id': (c, input, ctx) => {
    const existing = getRule(ctx, param(input, 'id'));
    ctx.ports.repos.alerts.delete(existing.id);
    return c.json(existing);
  },

  'GET /alerts/events': (c, input, ctx) => {
    const q = (input.query ?? {}) as AlertEventsQuery;
    return c.json(ctx.ports.repos.alerts.events({ ...(q.ruleId === undefined ? {} : { ruleId: q.ruleId }), ...(q.definitionId === undefined ? {} : { definitionId: q.definitionId }), limit: q.limit ?? 100 }));
  },
};
```

`src/routes/index.ts`: add `...historyHandlers,` and `...alertHandlers,`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api test -- history alerts`
Expected: PASS, 3 + 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: history routes and alert rule storage"
```

### Task 8.14: `/tools/smoke` and `/tools/record` inside the app process

**Files:**
- Create: `src/routes/tools.ts`, `src/tools/inProcess.ts`
- Modify: `src/routes/index.ts`, `src/bootstrap/app.ts` (`main` passes `tools`)
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `recordFixtures(ports, args, log)` from `src/tools/record.ts` (WP4b, Open question 4); `toolRunResponseSchema`, `toolSmokeRequestSchema`, `toolRecordRequestSchema` (WP0, Open question 2).
- Produces: `inProcessTools(ports): ToolRunners`; routes `POST /tools/smoke`, `POST /tools/record`.

Rules (spec §7, §10, §13): both routes need auth like every other route; they run the tool functions in this process (the app holds `app_lock`, so the tool bootstrap would refuse); one tool at a time (`409 tool_busy`); a runner that is not registered answers `503 tool_unavailable` (the smoke runner arrives with WP13, which adds `smoke` to `inProcessTools`); a runner that throws answers `500 tool_failed` and logs the URL-stripped message.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunResult } from '../src/routes/types.js';
import { expectContract } from './contract.js';
import { type Harness, createHarness, stopMsw } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

const ok: ToolRunResult = { ok: true, exitCode: 0, lines: ['one tile per configured provider'] };
async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('/tools/* (spec §10, §7 app_lock)', () => {
  it('both routes require auth', async () => {
    h = await createHarness({ app: { tools: { smoke: async () => ok, record: async () => ok } } });
    expect((await h.request('/api/tools/smoke', { method: 'POST', json: {}, auth: false })).status).toBe(401);
    expect((await h.request('/api/tools/record', { method: 'POST', json: { budget: 3 }, auth: false })).status).toBe(401);
  });

  it('503 when the runner is not registered', async () => {
    h = await createHarness();
    const res = await h.request('/api/tools/smoke', { method: 'POST', json: {} });
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('tool_unavailable');
  });

  it('runs the registered runner and passes the record budget', async () => {
    const record = vi.fn(async (_args: { budget: number }) => ok);
    h = await createHarness({ app: { tools: { smoke: async () => ok, record } } });
    const smoke = await h.request('/api/tools/smoke', { method: 'POST', json: {} });
    expect(smoke.status).toBe(200);
    expect(await expectContract(smoke, 'POST', '/tools/smoke')).toEqual({ tool: 'smoke', ...ok });
    expect((await h.request('/api/tools/record', { method: 'POST', json: { budget: 3 } })).status).toBe(200);
    expect(record).toHaveBeenCalledWith({ budget: 3 });
    expect((await h.request('/api/tools/record', { method: 'POST', json: { budget: 0 } })).status).toBe(400);
  });

  it('one tool at a time', async () => {
    let release: (() => void) | undefined;
    const slow = () => new Promise<ToolRunResult>((resolve) => (release = () => resolve(ok)));
    h = await createHarness({ app: { tools: { smoke: slow, record: async () => ok } } });
    const first = h.request('/api/tools/smoke', { method: 'POST', json: {} });
    await vi.waitFor(() => expect(release).toBeDefined());
    const busy = await h.request('/api/tools/record', { method: 'POST', json: { budget: 1 } });
    expect(busy.status).toBe(409);
    expect(await code(busy)).toBe('tool_busy');
    release?.();
    expect((await first).status).toBe(200);
    expect((await h.request('/api/tools/record', { method: 'POST', json: { budget: 1 } })).status).toBe(200);
  });

  it('a failing runner answers 500 tool_failed without leaking URLs', async () => {
    h = await createHarness({ app: { tools: { smoke: async () => Promise.reject(new Error('GET https://example.test/x?api_key=SENTINEL-TOOL failed')) } } });
    const res = await h.request('/api/tools/smoke', { method: 'POST', json: {} });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('tool_failed');
    expect(text).not.toContain('SENTINEL-TOOL');
    expect(h.logLines.join('')).not.toContain('SENTINEL-TOOL');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- tools`
Expected: FAIL: the routes return 404 `not_found` (the auth test passes already).

- [ ] **Step 3: Implement**

`src/routes/tools.ts`:

```ts
import { type apiContract, stripUrlsInText } from '@gmt/core';
import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { AppEnv, HandlerTable, RouteContext, ToolRunResult } from './types.js';

type RecordRequest = z.infer<typeof apiContract.toolRecordRequestSchema>;

/** Runs one tool in-process, one at a time (spec §10 `/tools/*`). */
async function runTool(c: Context<AppEnv>, ctx: RouteContext, name: 'smoke' | 'record', run: (() => Promise<ToolRunResult>) | null) {
  if (run === null) throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable(name));
  if (ctx.toolInFlight.name !== null) throw new ApiError(409, 'tool_busy', API_TEXT.toolBusy(ctx.toolInFlight.name));
  ctx.toolInFlight.name = name;
  try {
    return c.json({ tool: name, ...(await run()) });
  } catch (err) {
    ctx.ports.log.error({ tool: name, err: { message: stripUrlsInText(err instanceof Error ? err.message : String(err)) } }, 'tool failed');
    throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed(name));
  } finally {
    ctx.toolInFlight.name = null;
  }
}

export const toolHandlers: HandlerTable = {
  'POST /tools/smoke': (c, _input, ctx) => {
    const smoke = ctx.tools.smoke;
    return runTool(c, ctx, 'smoke', smoke === undefined ? null : () => smoke({}));
  },
  'POST /tools/record': (c, input, ctx) => {
    const record = ctx.tools.record;
    const body = input.body as RecordRequest;
    return runTool(c, ctx, 'record', record === undefined ? null : () => record({ budget: body.budget }));
  },
};
```

`src/tools/inProcess.ts`:

```ts
import type { ToolRunners } from '../routes/types.js';
import type { Ports } from '../wiring.js';
import { recordFixtures } from './record.js';

/**
 * The tools reachable while the app holds app_lock (spec §7): the same functions the tool
 * bootstrap runs, over the app's own ports. WP13 adds `smoke` here.
 */
export function inProcessTools(ports: Ports): ToolRunners {
  return { record: (args) => recordFixtures(ports, args, ports.log) };
}
```

`src/routes/index.ts`: add `...toolHandlers,`. In `src/bootstrap/app.ts` `main`, import `inProcessTools` from `../tools/inProcess.js` and change the `bootApp` call to `bootApp({ config, log, listen: true, assets: assetPaths(), tools: inProcessTools })`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- tools`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: /tools/smoke and /tools/record in-process, one at a time"
```

### Task 8.15: Contract sweep: strict mounting, auth flags, every response against `core/api-contract`, provenance, banned words, sentinels

**Files:**
- Modify: `src/app.ts`
- Test: `test/contract-sweep.test.ts`

**Interfaces:**
- Consumes: `apiContract.ROUTES`, `findBannedWords` (WP0).
- Produces: `createApp` throws when a ROUTES entry has no handler or a handler has no ROUTES entry.

- [ ] **Step 1: Write the failing test**

```ts
import { apiContract, findBannedWords } from '@gmt/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { API_TEXT } from '../src/text.js';
import { expectContract } from './contract.js';
import { exampleDefinitionInput } from './examples.js';
import { type Harness, SENTINELS, basic, createHarness, stopMsw } from './harness.js';
import { at, cell, seedCalendarPrice, seedCell, seedExecution, seedObservation, seedOutcome } from './seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
afterAll(() => stopMsw());

const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');

/** A small world touching every read route: one parent execution, a calendar price, an observation, an alert rule. */
async function seedWorld(x: Harness): Promise<{ def: string; exec: string; alert: string }> {
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints: { maxStops: 1 } }));
  seedExecution(x.ports.db, { id: 'E1', def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  seedCell(x.ports.db, 'E1', C1, { discoveryStatus: 'priced', discoveryMinPence: 45_000, selected: true, selectionReason: 'top_n', verificationStatus: 'priced' });
  seedOutcome(x.ports.db, 'E1', C1, 'discovery', 'fixture', { status: 'priced', fetchedAt: at(-1), minPence: 45_000 });
  seedOutcome(x.ports.db, 'E1', C1, 'verification', 'fixture', { status: 'priced', fetchedAt: at(-1) });
  seedCalendarPrice(x.ports.db, { executionId: 'E1', cell: C1, pricePence: 45_000, fetchedAt: at(-1) });
  seedObservation(x.ports.db, { executionId: 'E1', cell: C1, hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) });
  const alert = x.ports.repos.alerts.create({ definitionId: def.id, type: 'absolute', thresholdPence: 50_000, basis: 'verified', requireAllVerified: true, cooldownHours: 336, enabled: true });
  return { def: def.id, exec: 'E1', alert: alert.id };
}

function fill(path: string, ids: { def: string; exec: string; alert: string }): string {
  return path
    .replace(/^\/definitions\/:id/, `/definitions/${ids.def}`)
    .replace(/^\/executions\/:id/, `/executions/${ids.exec}`)
    .replace(/^\/alerts\/:id/, `/alerts/${ids.alert}`)
    .replace(':hash', 'hV')
    .replace(':origin', 'LHR')
    .replace(':destination', 'JFK')
    .replace(':departureDate', '2026-11-02')
    .replace(':returnDate', '2026-11-12');
}
const missing = { def: 'zz-missing', exec: 'zz-missing', alert: 'zz-missing' };

/** Paths of every object that has a `pricePence` but no `provenance` (spec §10: provenance on every price). */
function pricesWithoutProvenance(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => pricesWithoutProvenance(x, `${path}[${i}]`));
  if (v === null || typeof v !== 'object') return [];
  const here = 'pricePence' in v && !('provenance' in v) ? [path] : [];
  return [...here, ...Object.entries(v).flatMap(([k, x]) => pricesWithoutProvenance(x, `${path}.${k}`))];
}

/** Every user-facing string in a response: reasons, notices, messages, labels, assumptions. */
function userStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(userStrings);
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => {
    if (['basisReason', 'message', 'label'].includes(k) && typeof x === 'string') return [x];
    if (['messages', 'notices', 'assumptions'].includes(k) && Array.isArray(x)) return x.filter((s): s is string => typeof s === 'string');
    return userStrings(x);
  });
}

const SAMPLE_ARGS: Record<string, unknown[]> = {
  rateLimited: [42], hostRejected: ['evil.example:3000', ['localhost:3000']], originRejected: ['https://evil.example', ['localhost:3000']],
  validation: ['body'], definitionNotFound: ['d1'], executionNotFound: ['e1'], alertNotFound: ['a1'], invalidCron: ['sub-hourly schedules are not allowed'],
  notCancellable: ['completed'], unknownAirport: ['AAA'], insideSpace: [0, 3], observationSeries: ['Fixture provider'], calendarSeries: ['Fixture provider'],
  toolUnavailable: ['smoke'], toolBusy: ['record'], toolFailed: ['smoke'],
};

describe('ROUTES mounting (spec §10)', () => {
  it('refuses a ROUTES entry without a handler and a handler without a ROUTES entry', async () => {
    const x = await createHarness();
    h = x;
    const extra = { method: 'GET', path: '/unmapped', response: z.object({}), auth: 'required' } as const;
    expect(() => createApp(x.ports, x.engine, { routes: [...apiContract.ROUTES, extra] })).toThrow(/no handler for GET \/unmapped/);
    expect(() => createApp(x.ports, x.engine, { routes: apiContract.ROUTES.filter((r) => r.path !== '/budget') })).toThrow(/no route for handler GET \/budget/);
  });

  it('every entry is mounted with its method and auth flag', async () => {
    h = await createHarness();
    for (const route of apiContract.ROUTES) {
      const path = `/api${fill(route.path, missing)}`;
      const json = route.method === 'GET' ? undefined : {};
      const anonymous = await h.request(path, { method: route.method, auth: false, ...(json === undefined ? {} : { json }) });
      if (route.auth === 'required') expect(anonymous.status, `${route.method} ${route.path} without auth`).toBe(401);
      else expect(anonymous.status, `${route.method} ${route.path} is public`).not.toBe(401);
      const authed = await h.request(path, { method: route.method, ...(json === undefined ? {} : { json }) });
      const body = (await authed.json()) as { error?: { code: string } };
      expect(body.error?.code, `${route.method} ${route.path} is mounted`).not.toBe('not_found');
    }
  });
});

describe('every GET route against the contract, with provenance on every price (spec §9 item 5)', () => {
  it('validates each response and finds no price without provenance', async () => {
    h = await createHarness();
    const ids = await seedWorld(h);
    for (const route of apiContract.ROUTES.filter((r) => r.method === 'GET')) {
      const res = await h.request(`/api${fill(route.path, ids)}`);
      expect(res.status, `${route.path}`).toBe(200);
      const body = await expectContract(res, 'GET', route.path, route.path === '/health' ? apiContract.healthDetailSchema : undefined);
      expect(pricesWithoutProvenance(body), route.path).toEqual([]);
    }
  });
});

describe('banned words in API strings (spec §11, §8.3)', () => {
  it('no fixed API string contains a banned word', () => {
    for (const [key, value] of Object.entries(API_TEXT)) {
      const args = SAMPLE_ARGS[key];
      if (typeof value !== 'string' && args === undefined) throw new Error(`add sample args for API_TEXT.${key}`);
      const text = typeof value === 'string' ? value : (value as (...a: unknown[]) => string)(...(args ?? []));
      expect(findBannedWords(text), `API_TEXT.${key}: ${text}`).toEqual([]);
    }
  });

  it('no reason, notice, message or label in any response contains a banned word', async () => {
    h = await createHarness();
    const ids = await seedWorld(h);
    const texts: string[] = [];
    for (const route of apiContract.ROUTES.filter((r) => r.method === 'GET')) texts.push(...userStrings(await (await h.request(`/api${fill(route.path, ids)}`)).json()));
    texts.push(...userStrings(await (await h.request('/api/definitions', { method: 'POST' })).json()));
    texts.push(...userStrings(await (await h.request('/api/providers', { auth: false })).json()));
    expect(texts.length).toBeGreaterThan(3);
    for (const t of texts) expect(findBannedWords(t), t).toEqual([]);
  });
});

describe('sentinel secrets never reach a body or a log line (spec §5.3)', () => {
  it('provider keys and the auth password stay out of every response and log', async () => {
    h = await createHarness({ env: { TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts, SEARCHAPI_KEY: SENTINELS.searchapi, SEARCHAPI_PLAN: '40usd' } });
    const ids = await seedWorld(h);
    const bodies: string[] = [];
    for (const route of apiContract.ROUTES.filter((r) => r.method === 'GET')) bodies.push(await (await h.request(`/api${fill(route.path, ids)}`)).text());
    bodies.push(await (await h.request('/api/providers', { headers: { authorization: basic(SENTINELS.searchapi, SENTINELS.travelpayouts) } })).text());
    bodies.push(await (await h.request('/api/definitions', { json: { name: SENTINELS.searchapi } })).text());
    const everything = [...bodies, ...h.logLines].join('\n');
    for (const secret of Object.values(SENTINELS)) expect(everything).not.toContain(secret);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- contract-sweep`
Expected: FAIL on "refuses a ROUTES entry without a handler…" (createApp skips silently); the other sweeps pass if Tasks 8.8–8.14 are complete, and any failure there names the offending route.

- [ ] **Step 3: Implement**

In `src/app.ts` `createApp`, replace the mounting loop with:

```ts
  const routeKeys = new Set(routes.map((r) => `${r.method} ${r.path}`));
  for (const key of Object.keys(HANDLERS)) {
    // why: a handler for a route the contract no longer has is dead code the web client cannot reach.
    if (!routeKeys.has(key)) throw new Error(`no route for handler ${key}`);
  }
  for (const route of routes) {
    const handler = HANDLERS[`${route.method} ${route.path}` as RouteKey];
    // why: spec §10 is the route table; an entry without a handler is a contract the api does not honour.
    if (handler === undefined) throw new Error(`no handler for ${route.method} ${route.path}`);
    api.on(route.method, route.path, every(...validatorsFor(route)), async (c) => handler(c, readInput(c, route), ctx));
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS, every test file; coverage at or above 85% lines/functions/statements and 70% branches.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp08: strict ROUTES mounting and the contract, provenance, banned-word and sentinel sweeps"
```

## 9. Pinned review-focus tests

| Plan review-focus line | Owned here | Test |
|---|---|---|
| 4. The definition is edited while an execution is running: results filter to the current resolved space and may be empty; the header says "0 of N rows are inside the current window and nights range" rather than "no results" (WP8: `/results` reports the excluded count in `basisReason`) | yes | Task 8.11, `test/results.test.ts` › "review focus 4: the definition is edited after the rows were written" (both bases; `excludedByCurrentSpace` 3, `basisReason` contains `API_TEXT.insideSpace(0, 3)`) |

Lines 1, 2, 3 and 5 belong to other packages. Line 2 (future timestamps clamp to "just now") is exercised indirectly: `ageHours` comes from WP0's clamped `effectiveAge`.

## 10. Definition of done

Run from the repository root:

| Command | Expected |
|---|---|
| `pnpm --filter "@gmt/api^..." build` | exit 0 |
| `pnpm --filter @gmt/api test` | every test passes, including `boot.spawn` (a real production bootstrap); coverage report ≥ 85% lines, functions, statements and ≥ 70% branches for `apps/api/src` (thresholds enforced by `apps/api/vitest.config.ts`) |
| `pnpm --filter @gmt/api typecheck` and `pnpm -r typecheck` | exit 0 |
| `pnpm lint` | exit 0, no diagnostics |
| `node scripts/check-boundaries.mjs` | exit 0 (`@gmt/api` reads `process.env` only under `src/bootstrap/`) |
| `grep -rn "process.env" apps/api/src \| grep -v "apps/api/src/bootstrap/"` | no output |
| `grep -rnE "\\b(LHR\|LGW\|JFK\|EWR\|LON\|NYC)\\b" apps/api/src` | no output (no airports in application code; the worked example appears in `apps/api/test` only) |
| Manual: `NODE_ENV=development DATABASE_PATH=./data/dev.db BIND_ADDRESS=127.0.0.1 pnpm --filter @gmt/api dev`, then `curl -s -H 'Host: localhost:3000' localhost:3000/api/health` | the log shows `"msg":"listening"`; curl prints `{"ok":true,"degraded":false}`; Ctrl-C logs `shutdown complete` and exits 0 |

## 11. Open questions

All seven are contract questions for **Fable** (the plan's contract owner), not operator decisions; none is `requires_human_judgment`. Each must be closed in the plan (and, for 2, in WP0's `api-contract`) before this brief is dispatched, and the brief's code adjusted if the answer differs from the proposal.

1. **API prefix.** Spec §10 and the plan mount routes at the root (`/definitions`, `/health`), but the SPA's client-side paths (`/definitions`, `/results`) would then collide with API `GET` routes on refresh. This brief mounts every `ROUTES` entry under **`/api`** (static and SPA fallback everywhere else). Consequences: WP9's client prefixes `/api`; WP12's `HEALTHCHECK` fetches `/api/health`.
2. **Contract shapes the plan names but does not field-list.** WP8 produces these; proposed exact fields (WP0 writes them as zod, reusing `priceCellSchema`, `bucketsSchema`, `coverageSummarySchema`, `bookingSchema`, `provenanceSchema`; `DatedPrice = priceCell & { cell: CellKey & { nights } }`):

   ```ts
   // definitions.ts
   definitionResponseSchema   = SearchDefinition & { estimate: Estimate; budgetFit: BudgetFit; needsConfirmation: boolean; notices: string[] }  // adds the last two
   // results.ts
   resultsQuerySchema         = { basis?: 'verified' | 'calendar'; executionId?: string; limit?: int 1..1000 (coerced from the query string) }
   calendarQuerySchema        = { basis?: 'verified' | 'calendar' }
   routeHistoryQuerySchema    = { cabin?: Cabin }
   calendarResponseSchema     = { basis; days: Array<{ date: IsoDate; discovery: Array<{ providerId; buckets: Buckets }>; verification: { selected; itinerarySearched; onDemand };
                                  cheapestVerified: DatedPrice | null; cheapestPartiallyVerified: (DatedPrice & { count: int }) | null; cheapestCalendar: DatedPrice | null;
                                  byDestination: Array<{ destination: Iata; cheapestVerified; cheapestPartiallyVerified; cheapestCalendar }> }>;
                                  executions: Array<{ id; status; ageHours }> }
   durationAnalysisResponseSchema = { nights: Array<{ nights: int; minVerified: { price: DatedPrice; n: int } | null; minCalendar: Array<{ providerId; price: DatedPrice; n: int }> }> }
   coverageResponseSchema     = { executionId: string | null; summary: CoverageSummary; perStageProvider: Array<{ stage; providerId; buckets; total }>;
                                  requests: Array<{ providerId; calls; cacheHits; costMicroGbp; costPence }>; flags: { overrun: boolean; parityBreak: boolean };
                                  selectedNotReached: Array<{ cell: CellKey & { nights }; reason: 'not_run' | 'budget' }>;
                                  errors: Array<{ cell; stage; providerId; reason: string | null; attempts: int; retryable: boolean }> }
   calendarGapResponseSchema  = { hidden: boolean; cheapestVerified: DatedPrice | null; cells: DatedPrice[] }
   cellDetailResponseSchema   = { cell: CellKey & { nights }; outcomes: Array<{ executionId; isChild; stage; providerId; status; reason; attempts; fetchedAt: IsoDateTime | null;
                                  minPence: int | null; reusedFromExecutionId: string | null }>; calendarPrices: DatedPrice[];
                                  observations: Array<{ itineraryHash: string | null; verdictClass; unverified: ConstraintName[]; price: DatedPrice; booking: Booking }> }
   historyResponseSchema      = { series: Array<{ providerId; kind: 'observation' | 'calendar' | 'route-lowest'; label: string; points: Array<{ fetchedAt; pricePence; provenance }> }> }
   // system.ts
   healthDetailSchema         = { ok; degraded; db: { ok: boolean; sizeBytes: int | null }; providers: Array<{ id; enabled: boolean }>;
                                  scheduler: { jobCount: int; nextRun: IsoDateTime | null; lastExecutionAt: IsoDateTime | null; degraded: boolean } }
   ROUTES 'GET /health'.response = z.union([healthDetailSchema, healthPublicSchema])   // one route, two shapes (spec §10)
   providersResponseSchema    = { providers: Array<{ id; displayName; plan: PlanId | null; billed: boolean; capabilities: { discovery: CapabilityInfo | null; verification: CapabilityInfo | null };
                                  cabins: Cabin[]; usage: { scope: string; usage: Usage }; excludedFromSchedule: boolean }>; global: Usage; messages: string[] }
   budgetResponseSchema       = { scopes: Array<{ scope: string; usage: Usage }> }            // scope labels: 'execution-calls', 'provider-month:searchapi', 'global-month'
   schedulerJobsResponseSchema = { jobs: SchedulerJob[] }
   toolSmokeRequestSchema     = {} ; toolRecordRequestSchema = { budget: int ≥ 1 } ; toolRunResponseSchema = { tool: 'smoke' | 'record'; ok: boolean; exitCode: int; lines: string[] }
   // alerts.ts
   alertRuleRequestSchema     = { definitionId; type; thresholdPence?; pct?; basis; requireAllVerified?; cooldownHours; enabled }  + the spec §6.8 refinement
   alertRuleSchema            = alertRuleRequestSchema & { id: string }
   alertsQuerySchema          = { definitionId?: string } ; alertEventsQuerySchema = { ruleId?: string; definitionId?: string; limit?: int 1..1000 }
   executionResponseSchema    : as the plan, with estimate: Estimate | null (a seeded or skipped execution has none) and cell optional
   // ROUTES request/response pairs WP8 relies on
   POST /definitions                request definitionCreateRequestSchema.optional() → definitionResponseSchema (201)
   PUT /definitions/:id             request definitionUpdateRequestSchema            → definitionResponseSchema
   DELETE /definitions/:id                                                           → definitionResponseSchema (deletedAt set)
   POST /definitions/:id/estimate   no request schema                                → estimateResponseSchema
   POST /definitions/:id/executions request startExecutionRequestSchema              → executionResponseSchema (202)
   POST /executions/:id/cancel|resume no request schema                              → executionResponseSchema
   POST /cells/verify               request verifyCellRequestSchema                  → executionResponseSchema (202)
   GET /alerts query alertsQuerySchema → z.array(alertRuleSchema); POST /alerts → alertRuleSchema (201);
   PUT /alerts/:id request alertRuleRequestSchema without the refinement, partial (the handler validates the merge) → alertRuleSchema; DELETE /alerts/:id → alertRuleSchema;
   GET /alerts/events query alertEventsQuerySchema → z.array(alertEventSchema)
   ```

   Also: zod 4 may refuse `.partial()` on an object schema that carries refinements; WP0's `definitionUpdateRequestSchema = definitionCreateRequestSchema.partial()` must be built from the unrefined object (this brief re-validates the merged definition with the refined create schema in `validateForSave`).
3. **WP3 repository gaps.** (a) `AirportsRepo.airportsOfMetro(code): Iata[]`, required by WP1's `validateSearchSpace` lookup and review focus 1, is absent from the plan's `AirportsRepo`. (b) `CalendarPricesRepo.latestPerCell` and `ItinerariesRepo.observationsForDefinition` take a `space`; WP8 needs `space: null` (all cells) to count `excludedByCurrentSpace`. (c) Row types named but not field-listed: `Execution`, `CalendarPriceRow`, `ObservationRow`, `HistoryPoint` (with `provenance` required, since every history point is a price), `AlertRule`, `AlertRuleInput`, `AlertEvent`, `AirportsDataset`; this brief uses the fields listed in §4. (d) Method signatures: `ExecutionsRepo.listForDefinition(id, { includeChildren })`, `AlertsRepo.get/create/update/delete/events`. (e) No per-provider ledger count exists; WP8 reads `provider_requests` by its spec §7 columns in `ledgerByProvider` (alternatively WP3 adds `LedgerRepo.countsByProvider(executionId)`). (f) Enum spellings the SQL seeder assumes: `segments.direction ∈ { 'outbound', 'inbound' }`; integer autoincrement ids for `calendar_prices`, `fare_offers`, `price_observations`, `alert_events`; text ids for `search_executions` and `alert_rules`. (g) `applyMigrations` returns `{ applied }` in the contract block but `void` in Task 0.10. (h) Whether `seedAirports` itself skips when the dataset version is unchanged (spec §7); the bootstrap calls it on every boot.
4. **Runtime entry points from other packages.** (a) WP4b must export the in-process record entry `recordFixtures(ports, { budget }, log): Promise<ToolRunResult>`; the app's `Ports` are built without a `FixtureRecorder`, so either `buildPorts` always attaches an inert recorder (http-kit records only when the request sets `recordFixtures: true`) or `recordFixtures` builds its own http-kit over the same budget and cache. (b) WP12's `scripts/backup.mjs` must export `backupDatabase(dbPath: string): Promise<string>`; until it does, a boot with pending migrations on an existing database fails closed. (c) WP4b's tool bootstrap should reuse `assetPaths()` from `src/bootstrap/paths.ts` (or WP8 reuses WP4b's equivalent) so the migrations directory is resolved in one place.
5. **WP7 exports.** `LogNotifier` (plan file map `src/notifiers/log.ts`) and the fields of `SchedulerJob`, `Estimate`, `BudgetFit`, `CoverageCheckRequest/Response` are not in the engine contract; this brief assumes the §4 shapes and that `Estimate`/`BudgetFit` are the api-contract `z.infer` types. Overruns are measured against the pre-factor plan (spec §8.1) but only the factored estimate is stored; WP8 divides by `ESTIMATE_RETRY_FACTOR` as an approximation, and the engine should store the pre-factor plan length with the estimate. `engine.boot()` must make no network request when it starts with no due work (the spawn test runs it, and the harness runs it under `msw` with `onUnhandledRequest: 'error'`), so a daily FX refresh must not fire at boot.
6. **WP1/WP2 signatures this brief calls.** `daysBetween(a, b)` direction (`b − a` assumed); the second parameter of `evaluateConstraints` (`EvaluatedOffer` in §4); `dedupByItinerary`, `rankRows` and `bandCheapest` operating on `ResultRow` arrays, with `rankRows` implementing class → seen-before-`notSeenInLatest` (spec §8.1) → price → `compareAges`.
7. **`app_lock` takeover wording.** Spec §7 says a fresh app lock makes the app "wait up to 90 s, logging the lock age, then take over". This brief takes over as soon as WP3's `acquire` judges the lock stale (three missed beats, which an ungracefully stopped process reaches within 90 s) and **refuses** if the lock is still heartbeating after 90 s, because that can only be a second live app and two writers would break the single-writer rule (spec §7 SQLite settings). Confirm, or change Task 8.3 to force the takeover.
