---
wp: 4b
title: fixture recording on the example route and the wiring helper
owner: fable
depends_on: [3, 4]
spec_sections: ["§2 (spike facts 1–8)", "§5.3 Recorder", "§5.5", "§7 app_lock", "§9 item 7", "§16 WP4b"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, security-reviewer, cost-and-budget-reviewer]
status: draft
---

# WP4b — fixture recording on the example route and the wiring helper

## 1. Goal

Build the wiring helper and tool bootstrap that every later entrypoint reuses. Then use them to record redacted, hashed vendor fixtures for the public worked example (LHR, LGW → JFK, EWR). The calls go through the real http-kit, the real recorder and the real `SqliteBudgetGuard`, within an explicit call budget.

## 2. Scope

**In**

- `apps/api/src/wiring.ts`: `loadConfigFromEnv(env)` and `buildPorts(config, opts)`, exactly as the plan's "Wiring and bootstraps" contract, plus the helpers they need (`tolerantRealpath`, `ConfigError`, `collectSecrets`, `httpLimits`, a local `Repos` declaration).
- `apps/api/src/logger.ts`: the pino logger with the spec §14 redact paths.
- `apps/api/src/paths.ts`: the repository paths of the migrations directory and the recorded-fixture root.
- `apps/api/src/bootstrap/tool.ts`: `runTool(name, args)`. It refuses `NODE_ENV=test`, builds the ports and takes `AppLock('tool')`. It refuses while a fresh lock exists, heartbeats every 30 s, releases the lock on every exit path and never calls `engine.boot()` (no engine is constructed at all).
- `apps/api/src/tools/{types,recordPlan,recordParams,recordRequests,record}.ts`: `pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--free-budget N] [--min-nights N] [--metro CODE] [--dry-run]`.
- The recording run on the worked example. It covers Travelpayouts month tiles, one SearchApi calendar rectangle, a step 1 → 2 → 3 chain for the cheapest priced cell, a deliberate over-limit calendar request (HTTP 400 body), invalid-credential probes (HTTP 401 bodies) and a best-effort 429 attempt.
- The dated parameter allowlists `packages/providers/fixtures/recorded/<provider>/params-<date>.json`.
- The committed recorded tree, and a manual review of every recorded file before commit.
- Tests: the fixture-tree hash test, the committed-tree completeness test, the allowlist shape test, the tool bootstrap tests (in-process and spawned), the budget-argument refusal, the guard-enforces-budget test and the sentinel secret-scan test.

**Out**

- The recorder itself: placeholders, scrubbing, the content hash, fail-closed behaviour and the `.raw.json` sibling. **WP4** (`createRecorder`). This brief pins the file format the recorder must write (section 5.3) and tests it.
- `SqliteBudgetGuard`, `AppLock`, the repositories and the migrations. **WP3**.
- The SearchApi adapter, its tiling, its ≤200 assertion and its error mapping. **WP5**. The Travelpayouts adapter. **WP6**. Both replay the files recorded here.
- Adding the two adapters to `buildPorts`, the app bootstrap, `POST /tools/record` and `POST /tools/smoke`. **WP8**.
- `smoke:live`, layer-B engine tests and the "tool bootstrap starts no execution" lock test. **WP13**.
- Seeding the airports table at tool start. Not specified anywhere; see section 13, item 9. `record.ts` reads the metro from the table when it is populated and accepts `--metro` otherwise.

**Adapters do not exist when WP4b runs.** WP5 and WP6 depend on this package, so `record.ts` cannot call `FlightProvider` methods. It hand-builds every request with the exact URLs and parameters in section 6 and sends them through `HttpKit.request` with the recorder attached. WP5 and WP6 later replay those files through msw on global fetch. The parameter allowlists written here are the single source both adapters load (`searchapi/params.ts`, `travelpayouts/params.ts`).

## 3. Spec sections

| Section | What it requires of this package |
|---|---|
| §2 spike facts 1–8 | The shapes to re-record on the public route: (1) Travelpayouts rows carry `origin_airport` but no `found_at`, `currency=gbp` honoured, one tile per (metro, destination, month); (2) SearchApi calendar: per airport, HTTP 400 above 200 combinations; (3) the step 1 → 2 → 3 chain with unpriced options and an OTA price below the airline fare; (4) the vendor cache answers a repeat unbilled; (5) error bodies: SearchApi 401 and 400, Travelpayouts 401 plain text, no 429 seen yet; (6) carriers; (7) the trial is a one-off balance; (8) keys in headers only. |
| §5.3 "Recorder" | Files at `fixtures/recorded/<provider>/<endpoint>/<yyyy-mm-dd>-<sha>.json`. Credentials fail closed, `search_metadata` URLs are stripped, and opaque tokens become deterministic placeholders consistent between a response and the next request. |
| §5.5 | The tool bootstrap refuses `NODE_ENV=test`. The recorder writes only under `fixtures/recorded/`, with a content hash and a `recordedBy` signature that the fixture-tree test verifies. |
| §7 `app_lock` | `holder ∈ app \| tool`, heartbeat every 30 s, stale after 3 missed beats, liveness by heartbeat age. "The tool bootstrap refuses while a fresh app lock exists." Acquisition uses `BEGIN IMMEDIATE` (WP3). The tool bootstrap "reuses the same config parse and port wiring, opens the same DB, skips the boot sweep, auto-resume and cron, uses the production ledger". |
| §9 item 7 | `pnpm record:fixtures --budget N` records the step 1→2→3 chain for one cell and the 429/quota bodies when the vendor can be induced to return them, within an explicit call budget. Excluded from `pnpm test`, run via the tool bootstrap. |
| §16 WP4b | Records the public example route through the real recorder, including a 429 if one can be induced, using ~12 of the 91 remaining trial credits. Also builds the minimal wiring helper (config parse + port construction) that WP8's bootstraps reuse. First failing test: a recorded fixture carries a verifiable content hash. |

## 4. Interfaces consumed

Copied from the plan's "Cross-package contracts" without change.

`@gmt/core` (WP0):

```ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$, upper-case
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata>;          // z.string().regex(/^[A-Z]{3}$/) then brand
export const isoMonthSchema: z.ZodType<IsoMonth>;
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export const systemClock: Clock;                       // Date.now() + Intl Europe/London
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };   // tests
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export type PlanId = 'trial' | '40usd';
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const PLAN_PRESETS: Record<PlanId, ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number }>;
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits;   // cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0, fixed 0
export interface Config { /* exactly as the plan's Config block; fields used here: nodeEnv, databasePath, logLevel, pointOfSale, maxWaitSeconds, requestTimeoutSeconds, spend, providers, smtp, auth, allowFixtureProvider, inContainer */ }
export interface ParseConfigOptions { realpath: (p: string) => string }
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: Array<{ field: string; message: string }> };
export function parseConfig(env: Record<string, string | undefined>, opts: ParseConfigOptions): ConfigResult;
export function syntheticAllowed(c: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>): boolean;
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
```

The plan also defines `ProviderId`, `FlightProvider`, `BudgetGuard`, `ResponseCache`, `ProviderError` and `BudgetExceeded` as spec §5.1 verbatim (`ProviderError.kind`, `.httpStatus`; `BudgetExceeded.scope`).

`@gmt/db` (WP0 + WP3):

```ts
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T): T; close(): void }
export function openDatabase(path: string): Db;
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
// repositories — constructed as new XRepo(db, clock)
export class AirportsRepo { exists(iata): boolean; get(iata): Airport | null; search(q: string, limit): Airport[]; metroOf(iata): string | null; sharedMetro(iatas: Iata[]): string | null; count(): number; upsertAll(rows, datasetVersion): void }
export class FxRepo { … }  export class DefinitionsRepo { … }  export class ExecutionsRepo { … }  export class CellsRepo { … }
export class CalendarPricesRepo { … }  export class ItinerariesRepo { … }  export class LedgerRepo { … }  export class AlertsRepo { … }
export class NotificationsRepo { … }  export class RoutePriceHistoryRepo { … }
export class SqliteBudgetGuard implements BudgetGuard { constructor(db, config: BudgetConfig, clock) }   // BudgetConfig = per-provider ProviderLimits + spend + which providers are billable + fixture cost rule
export class SqliteResponseCache implements ResponseCache { constructor(db, clock) }
export class AppLock { constructor(db, holder: 'app' | 'tool', clock, log); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void; static inspect(db): { holder; heartbeatAt; acquiredAt } | null }
```

`@gmt/providers` (WP4):

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
// Throws ProviderError (classified), BudgetExceeded (from reserve, before any fetch), AbortedError (signal).
export interface FixtureRecorder { record(r: { providerId; endpointPath; request: HttpKitRequest; status; body }): Promise<void> }
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>; costMicroGbp: number }): FlightProvider;  // throws unless syntheticAllowed
```

`@gmt/engine` (WP7, **not yet built**): the plan's `Ports` names `repos: Repos`, and `Repos` is defined in the engine block:

```ts
export interface Repos { airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo; calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo; notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo }
```

WP7 runs after WP4b, so `wiring.ts` declares a structurally identical `Repos`. WP8 replaces it with `import type { Repos } from '@gmt/engine'`; the two are assignable to each other.

`scripts/secret-scan.mjs` (WP0 Task 0.11) is consumed as written. It scans `packages/providers/fixtures` relative to its cwd, takes secret values from `TRAVELPAYOUTS_TOKEN`, `SEARCHAPI_KEY`, `SMTP_PASS` and `APP_BASIC_AUTH_PASS` (≥ 8 chars), and rejects the shapes `api_key=…`, `token=…16+`, `Bearer …16+` and the literal `X-Access-Token`.

### Assumptions this brief pins against merged WP3/WP4 behaviour

Each assumption has a test that fails if WP3 or WP4 merged something different. If one fails, stop and raise a finding against the plan. Do not patch around it.

1. **Recorded file format** (section 5.3). Pinned by Task 1's test against the real `createRecorder`.
2. **`createRecorder` records every attempt that reaches the vendor, whatever the status** (400, 401 and 429 included). Pinned by Task 6 (the 400 and 401 files must exist).
3. **`SqliteBudgetGuard` reads an execution's caps from `search_executions.definition_snapshot_json` `$.budget`, and `provider_requests.execution_id` references `search_executions.id`.** This is how the WP3 brief (draft) builds it. `record.ts` therefore creates a real execution. It is a disabled definition, soft-deleted at once, whose snapshot budget is `{ maxCalls: --budget, maxFreeCalls: --free-budget, maxCostMicroGbp: 0 }`. The execution is created `running` and finalised `completed` (or `cancelled` on abort) in a `finally`. Pinned by Task 6's guard test.
4. **`BudgetConfig` comes from WP3's `budgetConfigFromConfig(config, { fixtureCallCap? })`** (WP3 brief, draft). The plan names the type only in prose, so `buildPorts` calls WP3's function rather than building the object itself.

These come from the WP3 brief (draft) and are not in the plan's contracts:

```ts
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export interface ExecutionCreateInput { definitionId: string; snapshot: DefinitionSnapshot; status: 'pending' | 'running' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed'; cell: CellKey | null; estimate: Estimate | null; errorText: string | null }
new DefinitionsRepo(db, clock): create(input: DefinitionInput): SearchDefinition; softDelete(id: string): void
new ExecutionsRepo(db, clock): create(input: ExecutionCreateInput): Execution; setStatus(id: string, status: ExecutionStatus, patch?: ExecutionPatch): void
export function budgetConfigFromConfig(config: Config, opts: { fixtureCallCap?: number }): BudgetConfig;
```

## 5. Interfaces produced

### 5.1 `apps/api/src/wiring.ts` (contract, WP8 builds on it)

```ts
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[] }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string }): Ports;
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
// helpers, also exported
export interface Repos { /* as section 4 */ }
export class ConfigError extends Error { readonly errors: ReadonlyArray<{ field: string; message: string }> }
export function tolerantRealpath(p: string): string;
export function collectSecrets(config: Config): Secret[];
export function httpLimits(config: Config, allowSynthetic: boolean): Record<ProviderId | 'fx', ProviderHttpLimits>;
export const FIXTURE_COST_MICRO_GBP = 3200;
```

In WP4b, `Ports.providers` holds the fixture provider when `syntheticAllowed(config)` and nothing else. WP8 adds the SearchApi and Travelpayouts adapters once WP5 and WP6 merge.

### 5.2 Bootstrap and tools

```ts
// apps/api/src/paths.ts
export const MIGRATIONS_DIR: string;   // <repo>/packages/db/drizzle
export const RECORDED_ROOT: string;    // <repo>/packages/providers/fixtures/recorded
// apps/api/src/logger.ts
export const REDACT_PATHS: readonly string[];
export function createLogger(level: Config['logLevel'], destination?: DestinationStream): Logger;
// apps/api/src/tools/types.ts
export interface ToolContext { recorder: FixtureRecorder | null; recordedRoot: string; signal: AbortSignal; out(line: string): void; err(line: string): void }
export interface StartedTool { ok: true; recordedBy: string | null; configure(c: Config): Config; precheck(c: Config): string | null; run(ports: Ports, ctx: ToolContext): Promise<number> }
export interface ToolEntry { start(argv: readonly string[]): StartedTool | { ok: false; message: string } }
// apps/api/src/bootstrap/tool.ts
export const EXIT: { ok: 0; failed: 1; refusedTestEnv: 2; badConfig: 3; lockRefused: 4; usage: 5 };
export const TOOLS: Readonly<Record<string, ToolEntry>>;   // { record } now; WP13 adds smoke
export function runTool(name: string, args: readonly string[]): Promise<number>;   // exit code
// apps/api/src/tools/record.ts
export const RECORDED_BY = '@gmt/api record:fixtures';
export const recordTool: ToolEntry;
export function recordFixtures(ports: Ports, a: RecordArgs, ctx: RecordContext): Promise<RecordSummary>;
export function openRecordingExecution(ports: Ports, a: RecordArgs): string;   // execution id carrying the --budget caps
// apps/api/src/tools/recordParams.ts
export interface ParamsAllowlist { … }   // section 5.4; WP5/WP6 params.ts load this
```

`runTool` takes `name: string`, not the plan's `'record' | 'smoke'`, because it validates CLI input against `TOOLS`. The names it accepts are the plan's.

### 5.3 Recorded file format (as the WP4 brief pins it; this brief verifies it independently)

```json
{
  "recordedAt": "2026-10-20T09:14:03.512Z",
  "recordedBy": "@gmt/api record:fixtures",
  "providerId": "searchapi",
  "endpointPath": "/api/v1/search",
  "request": {
    "method": "GET",
    "url": "https://www.searchapi.io/api/v1/search",
    "params": { "engine": "google_flights", "departure_id": "LHR", "departure_token": "<departure_token:0>" },
    "body": null
  },
  "status": 200,
  "body": { "best_flights": [ { "price": 603, "booking_token": "<booking_token:0>" } ] },
  "contentSha256": "9f2c…64 lowercase hex"
}
```

- `contentSha256` is the SHA-256 hex digest of the UTF-8 **canonical JSON** of the whole object **without** the `contentSha256` key. Canonical JSON means object keys sorted by code unit, recursively; arrays keep their order; no whitespace; primitives as `JSON.stringify` renders them.
- The file name is `<recordedAt date>-<first 12 hex of contentSha256>.json`, in the directory `<root>/<providerId>/<endpointPath without the leading slash, every character outside [A-Za-z0-9._-] → "_">/`. That gives `travelpayouts/aviasales_v3_prices_for_dates/` and `searchapi/api_v1_search/`. All SearchApi engines share one path and so one directory; the engine is in `request.params.engine`.
- `request.url` is origin + path (`stripUrl`). `request.params` is the query string as an object, with tokens replaced by placeholders. **Request headers are never written**, so neither the credential nor the header name `X-Access-Token` (a secret-scan shape) can appear.
- `body` is scrubbed of credentials, `search_metadata` URLs are removed, and every opaque token is replaced by `<field:n>`. The numbering is consistent across the files of one recorder instance.
- The unredacted response is written beside the file as `<same name>.raw.json`. `.gitignore` already ignores `packages/providers/fixtures/recorded/**/*.raw.json`.

### 5.4 Parameter allowlist file (`<root>/<provider>/params-<yyyy-mm-dd>.json`)

```json
{
  "provider": "searchapi",
  "recordedAt": "2026-10-20T09:20:41.007Z",
  "recordedBy": "@gmt/api record:fixtures",
  "credential": "header",
  "endpoints": [
    {
      "key": "google_flights_calendar", "method": "GET", "path": "/api/v1/search",
      "params": {
        "engine": { "fixed": ["google_flights_calendar"], "observed": ["google_flights_calendar"] },
        "departure_id": { "kind": "iata", "observed": ["LHR"] },
        "outbound_date_start": { "kind": "iso-date", "observed": ["2027-03-01"] }
      }
    }
  ]
}
```

Each parameter is either `{ fixed: string[] }`, where the value must be one of these, or `{ kind: 'iata' | 'iso-date' | 'iso-month' | 'positive-int' | 'opaque-token' }`. Each also carries `observed`: the sorted distinct values actually sent (always `[]` for `opaque-token`). No credential parameter (`api_key`, `token`) is ever listed. `credential: "header"` records how the key travels without naming the header.

## 6. Endpoints and parameters (verified 2026-10-14)

Verified = read on the vendor's documentation page with WebFetch on 2026-10-14. Spike-measured = settled by the 2026-10-14 spike (spec §2, `docs/providers.md`); not re-fetched for this brief.

**Travelpayouts** `GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates`. Credential in header `X-Access-Token`.

| Parameter | Value sent | Status |
|---|---|---|
| `origin` | origin airport, or the origins' shared metro code from the airports table | spike-measured |
| `destination` | destination airport | spike-measured |
| `departure_at` | `YYYY-MM` | spike-measured |
| `one_way` | `false` | spike-measured |
| `currency` | `gbp` | spike-measured (fact 1: honoured) |
| `limit` | `1000` | spike-measured |
| `page` | `1`, then `2…` while a page returns 1000 rows | spike-measured |
| no `return_at`, no `market`, no `trip_class`, no `token` query param | — | spike-measured (fact 1: `market`/`trip_class` ignored; fact 8: header accepted) |

**SearchApi** `GET https://www.searchapi.io/api/v1/search`. Credential in header `Authorization: Bearer <key>`: **verified** (both docs pages list the Bearer header as an alternative to `api_key`). `api_key` is never sent.

`engine=google_flights_calendar` (https://www.searchapi.io/docs/google-flights-calendar-api):

| Parameter | Value sent | Status |
|---|---|---|
| `engine` | `google_flights_calendar` | verified |
| `departure_id`, `arrival_id` | one airport each (city codes rejected, fact 2) | verified (docs also allow comma lists and kgmids; not used) |
| `outbound_date` | = `outbound_date_start` | verified; **docs mark it required** (not in the original parameter list for this brief) |
| `return_date` | = `return_date_start` | verified; **docs mark it required** |
| `outbound_date_start`, `outbound_date_end` | rectangle bounds | verified (defaults: `outbound_date`, start + 7) |
| `return_date_start`, `return_date_end` | rectangle bounds | verified |
| `flight_type` | `round_trip` | verified (default) |
| `currency` | `GBP` | verified (default `USD`) |
| `gl` | `POINT_OF_SALE` lower-cased (`gb`) | verified (default `us`) |
| `hl` | `en` | verified |

The docs say "Maximum 200 unique outbound/return date combinations … Exceeding this returns an empty response". The spike measured HTTP 400 (fact 2). SA-02 records which one happens on the example route, and the recorded file is the authority for WP5.

The docs list the calendar response fields as `departure`, `return`, `price`, `is_lowest_price` and `has_no_flights`. They do not document `search_metadata` or `search_parameters`; the recorded bodies will show them.

`engine=google_flights` (https://www.searchapi.io/docs/google-flights-api):

| Parameter | Value sent | Status |
|---|---|---|
| `engine` | `google_flights` | verified |
| `departure_id`, `arrival_id` | the cell's airports | verified |
| `outbound_date`, `return_date` | the cell's dates | verified (`return_date` required for `round_trip`) |
| `flight_type` | `round_trip` | verified |
| `currency`, `gl`, `hl` | `GBP`, `gb`, `en` | verified |
| `departure_token` (step 2) | from the cheapest priced step-1 option, sent with all step-1 params | token verified; **resending the search params with it is unverified** (docs show no step-2 example) |
| `booking_token` (step 3) | from the cheapest priced step-2 option, sent with all step-1 params and without `departure_token` | verified (the docs' booking example resends `departure_id`, `arrival_id`, `flight_type`, `outbound_date`, `return_date`) |

Response fields per the docs: `best_flights[]` (`flights`, `price`, `departure_token` or `booking_token`), `booking_options[]` (`book_with`, `price`, `booking_request.url`, `booking_request.post_data`), `price_insights`. The docs page shows no `other_flights`; `record.ts` reads both arrays and tolerates either being absent.

## 7. Planned live call list (worked example)

Command: `pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03`.

Defaults: `--free-budget 25`, `--min-nights 10`. The metro (`LON`) comes from the airports table, or from `--metro LON` while the table is empty. `--dry-run` prints exactly this list (Task 5 asserts it line by line).

"Credits ≤" counts every HTTP 200 SearchApi call as billed, which is how the ledger counts them (spec §2 fact 4: the ledger may overcount the vendor, never undercount). The 400 and 401 responses are not billed (fact 4) and the guard does not count them once finalised.

| # | Call | Expect | SearchApi credits ≤ (running) | Travelpayouts calls (running) |
|---|---|---|---|---|
| TP-01 | prices_for_dates LON→JFK 2027-03 (metro) | 200 | 0 (0) | 1 (1) |
| TP-02 | LON→EWR 2027-03 | 200 | 0 (0) | 1 (2) |
| TP-03 | LON→JFK 2027-04 | 200 | 0 (0) | 1 (3) |
| TP-04 | LON→EWR 2027-04 | 200 | 0 (0) | 1 (4) |
| TP-05 | LON→JFK 2027-05 | 200 | 0 (0) | 1 (5) |
| TP-06 | LON→EWR 2027-05 | 200 | 0 (0) | 1 (6) |
| TP-07 | LON→JFK 2027-06 | 200 | 0 (0) | 1 (7) |
| TP-08 | LON→EWR 2027-06 | 200 | 0 (0) | 1 (8) |
| TP-09 | LON→JFK 2027-07 | 200 | 0 (0) | 1 (9) |
| TP-10 | LON→EWR 2027-07 | 200 | 0 (0) | 1 (10) |
| TP-11 | LON→JFK 2027-08 | 200 | 0 (0) | 1 (11) |
| TP-12 | LON→EWR 2027-08 | 200 | 0 (0) | 1 (12) |
| TP-13 | LON→JFK 2027-09 | 200 | 0 (0) | 1 (13) |
| TP-14 | LON→EWR 2027-09 | 200 | 0 (0) | 1 (14) |
| TP-15 | LHR→JFK 2027-03 (airport) | 200 | 0 (0) | 1 (15) |
| TP-16 | LHR→EWR 2027-03 | 200 | 0 (0) | 1 (16) |
| TP-17 | LGW→JFK 2027-03 | 200 | 0 (0) | 1 (17) |
| TP-18 | LGW→EWR 2027-03 | 200 | 0 (0) | 1 (18) |
| TP-19 | LON→JFK 2028-02 (empty-envelope probe, best-effort) | 200 | 0 (0) | 1 (19) |
| TP-20 | LON→JFK 2027-03 with an invalid token (401 body) | 401 | 0 (0) | 1 (20) |
| SA-01 | calendar LHR→JFK out 2027-03-01..03-08 × ret 2027-03-11..04-03 (192) | 200 | 1 (1) | 0 (20) |
| SA-02 | calendar out 2027-03-01..03-09 × same returns (216, over the limit) | 400 | 0 (1) | 0 (20) |
| SA-03 | google_flights step 1 LHR→JFK, cheapest priced cell of SA-01 | 200 | 1 (2) | 0 (20) |
| SA-04 | step 2, `departure_token` of the cheapest priced step-1 option | 200 | 1 (3) | 0 (20) |
| SA-05 | step 3, `booking_token` of the cheapest priced step-2 option | 200 | 1 (4) | 0 (20) |
| SA-06 | step 1 LHR→JFK 2027-03-01/2027-03-11 with an invalid key (401 body) | 401 | 0 (4) | 0 (20) |
| SA-07 | repeat of SA-01 through the burst kit, 429 attempt 1 of 8 | 200/429 | 1 (5) | 0 (20) |
| SA-08 | 429 attempt 2 | 200/429 | 1 (6) | 0 (20) |
| SA-09 | 429 attempt 3 | 200/429 | 1 (7) | 0 (20) |
| SA-10 | 429 attempt 4 | 200/429 | 1 (8) | 0 (20) |
| SA-11 | 429 attempt 5 | 200/429 | 1 (9) | 0 (20) |
| SA-12 | 429 attempt 6 | 200/429 | 1 (10) | 0 (20) |
| SA-13 | 429 attempt 7 | 200/429 | 1 (11) | 0 (20) |
| SA-14 | 429 attempt 8 | 200/429 | 1 (12) | 0 (20) |

**Totals:** SearchApi at most 12 credits (expected 4 to 12; spike fact 4 says a cached repeat is not billed, so SA-07…SA-14 may cost nothing). Travelpayouts 20 free calls, plus one per extra page if any page returns 1000 rows. The free cap of 25 leaves room for that.

**Why these calls:**

- **TP-01…14** are a full worked-example scan: 7 months × 2 destinations via the shared metro, which is spec §5.2's "2 origins sharing LON × 2 destinations × 7 months = 14". WP13's layer-B tests can replay a whole discovery from them.
- **TP-15…18** give WP6 airport-origin tiles for the no-shared-metro path.
- **TP-19** looks for an empty success envelope, which WP6's first failing test needs ("empty envelope → `no_data`"). It is best-effort: the run summary says whether it was empty.
- **SA-07…14** run sequentially through a second http-kit that shares the guard and recorder but has a looser local limiter (60/min, 5 s max wait). Without it the trial preset's 2/min limiter would make a vendor 429 impossible. Every HTTP 200 duplicate from the burst is deleted after the run, so only a 429 body, if one occurs, joins the tree. The 429 attempt is **best-effort and expected not to succeed**: the trial's vendor limit is 20 % of the plan per hour (20 calls), and the whole run makes at most 14 SearchApi calls. The summary reports "429 induced: no" in that case, and the adapters keep mapping 429 by status and ledger state (spec §2 fact 5).

**Credentials** come from the operator's `.env` through `loadConfigFromEnv` only. The `tool` script loads the file with Node's `--env-file-if-exists`. Never print, `cat`, `echo`, `grep` or otherwise display `.env` or any key, and never pass a key on the command line. If the trial was partly spent elsewhere, set `SEARCHAPI_TRIAL_USED=9` (the spike's nine billed calls) so the lifetime window matches the vendor dashboard's 91.

## 8. Library notes

| Library | Version | API used | Verified against |
|---|---|---|---|
| `node:child_process` | Node 22+ (dev 26) | `spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout })` → `{ status, stdout, stderr }` | https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options (2026-10-14) |
| Node CLI | 22.9+ | `--env-file-if-exists=<path>`; `--import tsx` | https://nodejs.org/api/cli.html (2026-10-14). The image's `node:22-slim` is ≥ 22.9 |
| `tsx` | 4.23.15 (plan Task 0.1) | `node --import tsx ./file.ts` | context7 `/privatenumber/tsx`, docs/dev-api/node-cli.md (2026-10-14) |
| `vitest` | 5.0.4 | `describe`, `it(name, fn, timeoutMs)`, `expect`, `beforeAll`, `afterAll`, `afterEach`, `vi.stubEnv`, `vi.unstubAllEnvs`, `vi.spyOn` | context7 `/vitest-dev/vitest`, docs/api/vi.md (2026-10-14) |
| `msw` | 3.0.3 (plan Task 0.1; added to `@gmt/api` devDependencies) | `setupServer(...handlers)` from `msw/node`; `http.get(url, ({ request }) => …)`; `HttpResponse.json(body, { status, headers })`; `new HttpResponse(text, { status })`; `server.listen({ onUnhandledRequest: 'error' })`, `server.close()` | context7 `/websites/mswjs_io` quick-start and http/intercepting-requests (2026-10-14). The pages document the 2.x API; at install, confirm that 3.0.3 keeps the `msw` / `msw/node` import paths. If not, stop and raise a finding against the plan |
| `pino` | 10.4.0 | `pino({ level, redact: { paths, censor } }, destination)`; `pino.destination({ dest: 2, sync: true })`; `logger.child(bindings)` | context7 `/pinojs/pino/v10.1.0`, docs/api.md and docs/redaction.md (2026-10-14) |
| `node:crypto` | Node 22+ | `createHash('sha256').update(s, 'utf8').digest('hex')` | https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options |
| internal | — | `@gmt/core`, `@gmt/db`, `@gmt/providers` contracts in section 4 | the plan |

## 9. Files

**Create**

- `apps/api/src/wiring.ts`, `apps/api/src/paths.ts`, `apps/api/src/logger.ts`
- `apps/api/src/bootstrap/tool.ts`
- `apps/api/src/tools/types.ts`, `apps/api/src/tools/recordPlan.ts`, `apps/api/src/tools/recordParams.ts`, `apps/api/src/tools/recordRequests.ts`, `apps/api/src/tools/record.ts`
- `apps/api/test/helpers/env.ts`, `apps/api/test/helpers/mswVendors.ts`
- `apps/api/test/wiring/loadConfig.test.ts`, `apps/api/test/wiring/buildPorts.test.ts`, `apps/api/test/logger.test.ts`
- `apps/api/test/tools/recordPlan.test.ts`, `apps/api/test/tools/record.msw.test.ts`, `apps/api/test/tools/allowlist.test.ts`
- `apps/api/test/bootstrap/tool.test.ts`, `apps/api/test/bootstrap/tool.spawn.test.ts`
- `apps/api/test/security/sentinel.test.ts`
- `packages/providers/test/helpers/recordedTree.ts`
- `packages/providers/test/fixtures/recorded-tree.test.ts`, `packages/providers/test/fixtures/recorded-manifest.test.ts`
- `packages/providers/fixtures/recorded/**` (the recorded tree and two `params-<date>.json`, Task 11)

**Modify**

- `apps/api/package.json`: script `tool`; devDependency `msw@3.0.3`.

## 10. Tasks

Shared test helpers come first, because several tasks use them. They are written in Task 2 and extended in Task 6.

### Task 1: Recorded-file verifier (first failing test)

**Files:** create `packages/providers/test/helpers/recordedTree.ts`, `packages/providers/test/fixtures/recorded-tree.test.ts`.

**Interfaces:** consumes `createRecorder`, `Secret`, `fixedClock`, `asIsoDateTime`. Produces the test helpers `canonicalJson`, `contentSha256`, `verifyRecordedFile`, `listRecordedFiles`, `RECORDED_BY_ALLOWED`, `RecordedFile`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/providers/test/fixtures/recorded-tree.test.ts
// Spec §5.5 / §9 item 2: recorded files carry recordedAt, recordedBy and a content hash that this
// test recomputes independently of the recorder, so a hand-edited file fails.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Secret, asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { createRecorder } from '../../src/index.js';
import { listRecordedFiles, verifyRecordedFile } from '../helpers/recordedTree.js';

const SENTINEL = 'test-travelpayouts-token-0123456789abcdef';

async function recordOne(): Promise<string> {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rec-')), 'fixtures', 'recorded');
  const recorder = createRecorder({
    root,
    secrets: [new Secret(SENTINEL)],
    clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
    recordedBy: '@gmt/api record:fixtures',
  });
  const url = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=LON&destination=JFK&departure_at=2027-03&one_way=false&currency=gbp&limit=1000&page=1');
  await recorder.record({
    providerId: 'travelpayouts',
    endpointPath: url.pathname,
    request: {
      providerId: 'travelpayouts', executionId: 'record-test', tileIndex: 0, endpointPath: url.pathname,
      method: 'GET', url, headers: { 'X-Access-Token': SENTINEL }, cache: 'never',
      signal: new AbortController().signal, recordFixtures: true,
    },
    status: 200,
    body: { success: true, data: [], currency: 'gbp' },
  });
  const files = listRecordedFiles(root);
  expect(files).toHaveLength(1);
  const only = files[0];
  if (only === undefined) throw new Error('no recorded file');
  return only;
}

describe('recorded fixture content hash (spec §5.5, WP4b first failing test)', () => {
  it('a file written by the real recorder carries a hash this test can recompute', async () => {
    const path = await recordOne();
    const result = verifyRecordedFile(path);
    expect(result).toEqual({ ok: true, file: expect.objectContaining({ providerId: 'travelpayouts', status: 200 }) });
    expect(path).toMatch(/[/\\]travelpayouts[/\\]aviasales_v3_prices_for_dates[/\\]2026-10-20-[0-9a-f]{12}\.json$/);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toMatch(/X-Access-Token/i);
  });

  it('a hand-edited file fails verification', async () => {
    const path = await recordOne();
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    writeFileSync(path, JSON.stringify({ ...parsed, status: 201 }));
    expect(verifyRecordedFile(path)).toEqual({ ok: false, reason: expect.stringContaining('contentSha256 mismatch') });
  });

  it('every committed recorded file verifies (the tree may be empty until Task 11)', () => {
    const root = fileURLToPath(new URL('../../fixtures/recorded/', import.meta.url));
    for (const path of listRecordedFiles(root)) {
      expect(verifyRecordedFile(path), path).toMatchObject({ ok: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers test -- test/fixtures/recorded-tree.test.ts`
Expected: FAIL with `Failed to load url ../helpers/recordedTree.js` (or `Cannot find module`).

- [ ] **Step 3: Implement**

```ts
// packages/providers/test/helpers/recordedTree.ts
// Independent verifier for recorded fixtures (spec §5.3 Recorder, §5.5, §9 item 2). It deliberately
// does NOT reuse the recorder's own hashing code: a shared bug would otherwise pass its own check.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** recordedBy values a committed recorded file may carry (spec §5.5 "recordedBy signature"). */
export const RECORDED_BY_ALLOWED: readonly string[] = ['@gmt/api record:fixtures', '@gmt/api smoke:live'];

/** The pinned recorded-file shape (brief WP4b section 5.3). */
export interface RecordedFile {
  recordedAt: string;
  recordedBy: string;
  providerId: string;
  endpointPath: string;
  request: { method: string; url: string; params: Record<string, string>; body: string | null };
  status: number;
  body: unknown;
  contentSha256: string;
}

/** Canonical JSON: keys sorted recursively, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v: unknown) => canonicalJson(v)).join(',')}]`;
  const entries: Array<[string, unknown]> = Object.entries(value);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 hex over the canonical JSON of the object without its `contentSha256` key. */
export function contentSha256(file: Record<string, unknown>): string {
  const { contentSha256: _ignored, ...rest } = file;
  return createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringMap(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === 'string');
}

/** Verifies shape, hash, file name and signature of one recorded file. */
export function verifyRecordedFile(path: string): { ok: true; file: RecordedFile } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'not an object' };
  const { recordedAt, recordedBy, providerId, endpointPath, request, status, contentSha256 } = parsed;
  if (typeof recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt)) return { ok: false, reason: 'recordedAt' };
  if (typeof recordedBy !== 'string' || !RECORDED_BY_ALLOWED.includes(recordedBy)) return { ok: false, reason: 'recordedBy' };
  if (typeof providerId !== 'string' || typeof endpointPath !== 'string') return { ok: false, reason: 'providerId/endpointPath' };
  if (!isRecord(request) || typeof request.method !== 'string' || typeof request.url !== 'string' || !isStringMap(request.params)) return { ok: false, reason: 'request' };
  const requestBody = request.body ?? null;
  if (requestBody !== null && typeof requestBody !== 'string') return { ok: false, reason: 'request.body' };
  if (request.url.includes('?')) return { ok: false, reason: 'request.url carries a query string' };
  if (typeof status !== 'number' || !('body' in parsed)) return { ok: false, reason: 'status/body' };
  if (typeof contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(contentSha256)) return { ok: false, reason: 'contentSha256 field' };
  const recomputed = contentSha256(parsed);
  if (recomputed !== contentSha256) return { ok: false, reason: `contentSha256 mismatch: file says ${contentSha256}, content is ${recomputed}` };
  const expectedName = `${recordedAt.slice(0, 10)}-${contentSha256.slice(0, 12)}.json`;
  if (basename(path) !== expectedName) return { ok: false, reason: `file name should be ${expectedName}` };
  return {
    ok: true,
    file: { recordedAt, recordedBy, providerId, endpointPath, request: { method: request.method, url: request.url, params: request.params, body: requestBody }, status, body: parsed.body, contentSha256 },
  };
}

/** Every recorded response file under root (excludes *.raw.json and params-*.json). */
export function listRecordedFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-')) out.push(p);
    }
  };
  walk(root);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers test -- test/fixtures/recorded-tree.test.ts`
Expected: 3 passed. If the first test fails on the path regex or on `verifyRecordedFile`, WP4's recorder does not write the pinned format (section 4, assumption 1). Stop and raise a finding.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/test && git commit -m "wp04b: independent verifier for recorded fixture content hashes"
```

### Task 2: `loadConfigFromEnv` and `tolerantRealpath`

**Files:** create `apps/api/src/wiring.ts` (first part), `apps/api/test/helpers/env.ts`, `apps/api/test/wiring/loadConfig.test.ts`.

**Interfaces:** consumes `parseConfig`, `Config`, `ConfigResult`. Produces `loadConfigFromEnv`, `ConfigError`, `tolerantRealpath`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/helpers/env.ts
// Test-only environment builders. Secrets are sentinels (brief README); nothing reads .env.
import type { Logger } from '@gmt/core';

export const SENTINEL_SA = 'test-searchapi-key-0123456789abcdef';
export const SENTINEL_TP = 'test-travelpayouts-token-0123456789abcdef';
export const SENTINEL_SMTP = 'test-smtp-pass-0123456789abcdef';

/** Every spec §12 variable set to '' (= unset), so values in a developer shell never leak into a test. */
export const ALL_VARS = [
  'NODE_ENV', 'DATABASE_PATH', 'PORT', 'BIND_ADDRESS', 'ALLOWED_HOSTS', 'APP_BASIC_AUTH_USER', 'APP_BASIC_AUTH_PASS',
  'ALLOW_UNAUTHENTICATED', 'TRUST_PROXY', 'LOG_LEVEL', 'POINT_OF_SALE', 'STALE_AFTER_HOURS', 'CALENDAR_STALE_AFTER_HOURS',
  'STUCK_AFTER_HOURS', 'MAX_CELLS_PER_DEFINITION', 'SCHEDULER_TIMEZONE', 'AUTO_RESUME', 'MAX_AUTO_RESUMES', 'MAX_WAIT_SECONDS',
  'REQUEST_TIMEOUT_SECONDS', 'ESTIMATE_RETRY_FACTOR', 'FX_MAX_RATE_AGE_DAYS', 'MONTHLY_SPEND_CAP_PENCE', 'GLOBAL_BILLING_DAY',
  'SOFT_CONFIRM_PENCE', 'EXECUTION_MAX_CALLS', 'EXECUTION_MAX_FREE_CALLS', 'EXECUTION_MAX_COST_PENCE', 'CHILD_MAX_CALLS',
  'TRAVELPAYOUTS_TOKEN', 'TRAVELPAYOUTS_BILLING_DAY', 'SEARCHAPI_KEY', 'SEARCHAPI_PLAN', 'SEARCHAPI_BILLING_DAY',
  'SEARCHAPI_CACHE_TTL_HOURS', 'SEARCHAPI_TRIAL_USED', 'SEARCHAPI_RATE_PER_MINUTE', 'SEARCHAPI_RATE_PER_HOUR',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'SMTP_PASS', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_FROM', 'IN_CONTAINER',
  'ALLOW_FIXTURE_PROVIDER',
] as const;

/** A complete env map: every variable blank, then the overrides. */
export function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ALL_VARS) env[k] = '';
  return { ...env, ...overrides };
}

/** In-memory test env with both providers configured (sentinel credentials) and fast SearchApi limits. */
export function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1',
    TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA,
    // why: the trial preset's 2/min limiter would make the msw run take minutes.
    SEARCHAPI_RATE_PER_MINUTE: '600', SEARCHAPI_RATE_PER_HOUR: '6000',
    ...extra,
  });
}

/** A Logger that drops everything. */
export const silentLog: Logger = {
  debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined,
  child: () => silentLog,
};
```

```ts
// apps/api/test/wiring/loadConfig.test.ts
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfigFromEnv, tolerantRealpath } from '../../src/wiring.js';
import { SENTINEL_SMTP, cleanEnv, testEnv } from '../helpers/env.js';

describe('tolerantRealpath (spec §5.5: databasePath is realpath-resolved before the config is built)', () => {
  it('passes :memory: through', () => {
    expect(tolerantRealpath(':memory:')).toBe(':memory:');
  });
  it('resolves an existing file through a symlinked directory', () => {
    const real = mkdtempSync(join(tmpdir(), 'gmt-real-'));
    writeFileSync(join(real, 'a.db'), '');
    const link = `${real}-link`;
    symlinkSync(real, link);
    expect(tolerantRealpath(join(link, 'a.db'))).toBe(join(realpathSync(real), 'a.db'));
  });
  it('resolves a missing file by its directory', () => {
    const real = mkdtempSync(join(tmpdir(), 'gmt-real-'));
    const link = `${real}-link`;
    symlinkSync(real, link);
    expect(tolerantRealpath(join(link, 'new.db'))).toBe(join(realpathSync(real), 'new.db'));
  });
  it('throws when the directory itself is missing', () => {
    expect(() => tolerantRealpath(join(tmpdir(), 'gmt-missing-dir-xyz', 'nested', 'a.db'))).toThrow(/ENOENT/);
  });
});

describe('loadConfigFromEnv (plan "Wiring and bootstraps")', () => {
  it('returns the parsed config with a realpath-resolved database path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmt-cfg-'));
    mkdirSync(join(dir, 'data'));
    const config = loadConfigFromEnv(testEnv({ NODE_ENV: 'development', DATABASE_PATH: join(dir, 'data', 'dev.db') }));
    expect(config.databasePath).toBe(join(realpathSync(dir), 'data', 'dev.db'));
    expect(config.providers.searchapi).not.toBeNull();
  });

  it('throws ConfigError naming every invalid field and never echoing a value', () => {
    const env = cleanEnv({
      NODE_ENV: 'production', DATABASE_PATH: ':memory:', BIND_ADDRESS: '0.0.0.0',   // non-loopback without auth
      SMTP_PASS: SENTINEL_SMTP,                                                     // SMTP half-set
    });
    const direct = parseConfig(env, { realpath: tolerantRealpath });
    if (direct.ok) throw new Error('fixture env should be invalid');
    expect(direct.errors.length).toBeGreaterThanOrEqual(2);
    try {
      loadConfigFromEnv(env);
      expect.unreachable('loadConfigFromEnv accepted an invalid env');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      if (!(e instanceof ConfigError)) return;
      expect(e.errors).toEqual(direct.errors);
      for (const { field } of direct.errors) expect(e.message).toContain(field);
      expect(e.message).not.toContain(SENTINEL_SMTP);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/wiring/loadConfig.test.ts`
Expected: FAIL, cannot resolve `../../src/wiring.js`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/wiring.ts (part 1 of 2; Task 3 appends buildPorts)
/**
 * The wiring helper: one config parse and one port construction shared by the app bootstrap (WP8)
 * and the tool bootstrap (this package). Spec §4 ("both built on the wiring helper from WP4b and
 * parsing process.env once through the core schema"), §5.5, §7, §12.
 *
 * This module never reads process.env: the bootstraps pass the environment in.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Config, parseConfig } from '@gmt/core';

/** Thrown by loadConfigFromEnv; the message names every failing field and never a value (spec §12). */
export class ConfigError extends Error {
  readonly errors: ReadonlyArray<{ field: string; message: string }>;
  constructor(errors: ReadonlyArray<{ field: string; message: string }>) {
    super(`invalid configuration: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';
}

/**
 * realpath that tolerates a database file that does not exist yet by resolving its directory
 * (plan Config contract: "api passes fs.realpathSync (tolerating a missing file by resolving its
 * directory)"). Spec §5.5: the synthetic gate's suffix checks run on the resolved path.
 */
export function tolerantRealpath(p: string): string {
  if (p === ':memory:') return p;
  try {
    return realpathSync(p);
  } catch (e) {
    // why: a first boot has no DB file yet; a missing *directory* still fails, as it should.
    if (isEnoent(e)) return join(realpathSync(dirname(p)), basename(p));
    throw e;
  }
}

/** Parses the environment once through the core schema (spec §12). Throws ConfigError on failure. */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config {
  const result = parseConfig(env, { realpath: tolerantRealpath });
  if (!result.ok) throw new ConfigError(result.errors);
  return result.config;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/wiring/loadConfig.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: loadConfigFromEnv with realpath-resolved database path"
```

### Task 3: `buildPorts`

**Files:** modify `apps/api/src/wiring.ts`; create `apps/api/src/paths.ts`, `apps/api/test/wiring/buildPorts.test.ts`.

**Interfaces:** consumes the `@gmt/db` and `@gmt/providers` contracts in section 4. Produces `Ports`, `Repos`, `buildPorts`, `collectSecrets`, `httpLimits`, `FIXTURE_COST_MICRO_GBP`, `MIGRATIONS_DIR`, `RECORDED_ROOT`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/wiring/buildPorts.test.ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppLock } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { buildPorts, httpLimits, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';

describe('buildPorts (plan "Wiring and bootstraps")', () => {
  it('under syntheticAllowed (test + :memory:) builds a migrated DB and only the fixture provider', () => {
    const ports = buildPorts(loadConfigFromEnv(testEnv()), { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    try {
      expect(ports.providers.map((p) => p.id)).toEqual(['fixture']);
      expect(ports.repos.airports.count()).toBe(0);           // table exists: migrations applied
      expect(AppLock.inspect(ports.db)).toBeNull();
      expect(ports.secrets.map((s) => s.reveal()).sort()).toEqual([SENTINEL_SA, SENTINEL_TP].sort());
      expect(JSON.stringify(ports.secrets)).not.toContain(SENTINEL_SA);   // Secret#toJSON redacts
    } finally {
      ports.db.close();
    }
  });

  it('in production builds no provider (adapters are added by WP8) and migrations are idempotent', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gmt-ports-')), 'prod.db');
    const env = testEnv({ NODE_ENV: 'production', DATABASE_PATH: path });
    for (let i = 0; i < 2; i++) {
      const ports = buildPorts(loadConfigFromEnv(env), { log: silentLog, migrationsDir: MIGRATIONS_DIR });
      expect(ports.providers).toEqual([]);
      ports.db.close();
    }
    expect(existsSync(path)).toBe(true);
  });

  it('fails when the migrations directory is missing', () => {
    expect(() => buildPorts(loadConfigFromEnv(testEnv()), { log: silentLog, migrationsDir: '/nonexistent/drizzle' })).toThrow();
  });

  it('declares the egress hosts and billable rules of spec §5.3', () => {
    const limits = httpLimits(loadConfigFromEnv(testEnv()), false);
    expect(limits.searchapi).toMatchObject({ hosts: ['www.searchapi.io'], billable: 'http-200' });
    expect(limits.travelpayouts).toMatchObject({ hosts: ['api.travelpayouts.com'], billable: 'never', costPerCallMicroGbp: 0 });
    expect(limits.fixture).toMatchObject({ hosts: ['fixture.local'], billable: 'never' });
    expect(limits.fx).toMatchObject({ billable: 'never', costPerCallMicroGbp: 0 });
    expect(httpLimits(loadConfigFromEnv(testEnv()), true).fixture).toMatchObject({ billable: 'http-200', costPerCallMicroGbp: 3200 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/wiring/buildPorts.test.ts`
Expected: FAIL, `../../src/paths.js` not found and `buildPorts` not exported.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/paths.ts
/**
 * Repository paths the bootstraps need. Resolved from this file's location so they do not depend
 * on the process cwd (pnpm runs package scripts in apps/api).
 */
import { fileURLToPath } from 'node:url';

/** Drizzle SQL migrations generated by WP3 (spec §7 "Migrations"). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../packages/db/drizzle/', import.meta.url));

/** The only directory the recorder may write to (spec §5.5). */
export const RECORDED_ROOT = fileURLToPath(new URL('../../../packages/providers/fixtures/recorded/', import.meta.url));
```

Append to `apps/api/src/wiring.ts` (merge the imports with part 1's):

```ts
import {
  type BudgetGuard, type Clock, type Config, type FlightProvider, type Logger, PLAN_PRESETS, type ProviderId,
  type ResponseCache, type Secret, TRAVELPAYOUTS_DEFAULTS, syntheticAllowed, systemClock,
} from '@gmt/core';
import {
  AirportsRepo, AlertsRepo, CalendarPricesRepo, CellsRepo, type Db, DefinitionsRepo, ExecutionsRepo,
  FxRepo, ItinerariesRepo, LedgerRepo, NotificationsRepo, RoutePriceHistoryRepo, SqliteBudgetGuard, SqliteResponseCache,
  applyMigrations, budgetConfigFromConfig, openDatabase,
} from '@gmt/db';
import { type FixtureRecorder, type HttpKit, type ProviderHttpLimits, createHttpKit, fixtureProvider } from '@gmt/providers';

/**
 * Same shape as @gmt/engine's Repos (plan "Engine" block).
 * why: WP7 runs after WP4b; WP8 replaces this with `import type { Repos } from '@gmt/engine'`.
 */
export interface Repos {
  airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo;
  calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo;
  notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo;
}

/** Everything an entrypoint needs, built once (plan "Wiring and bootstraps"). */
export interface Ports {
  config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit;
  providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[];
}

/**
 * Per-call cost of the fixture provider under syntheticAllowed (spec §5.3 billable rule: "fixture
 * iff HTTP 200 at the configured test cost"). why: 3200 µGBP is the per-call figure the spec's cap
 * tests use (§9 items 1 and 3), so engine tests trip caps with familiar numbers.
 */
export const FIXTURE_COST_MICRO_GBP = 3200;

/** Every configured secret, for http-kit and recorder scrubbing (spec §5.3 secret scrubbing). */
export function collectSecrets(config: Config): Secret[] {
  const out: Secret[] = [];
  if (config.providers.travelpayouts !== null) out.push(config.providers.travelpayouts.token);
  if (config.providers.searchapi !== null) out.push(config.providers.searchapi.key);
  if (config.smtp !== null) out.push(config.smtp.pass);
  if (config.auth !== null) out.push(config.auth.pass);
  return out;
}

/** http-kit limits per provider: egress hosts, limiter, billable rule (spec §5.3). */
export function httpLimits(config: Config, allowSynthetic: boolean): Record<ProviderId | 'fx', ProviderHttpLimits> {
  const timing = { maxWaitSeconds: config.maxWaitSeconds, requestTimeoutSeconds: config.requestTimeoutSeconds };
  // why: an unconfigured provider still needs an entry (Record type); its limits are never exercised
  // because no adapter or tool sends a request without its credential.
  const tp = config.providers.travelpayouts?.limits ?? TRAVELPAYOUTS_DEFAULTS;
  const sa = config.providers.searchapi?.limits ?? PLAN_PRESETS.trial;
  return {
    travelpayouts: {
      hosts: ['api.travelpayouts.com'], ratePerMinute: tp.ratePerMinute, ratePerHour: tp.ratePerHour,
      concurrency: tp.concurrency, billable: 'never', costPerCallMicroGbp: 0, ...timing,
    },
    searchapi: {
      hosts: ['www.searchapi.io'], ratePerMinute: sa.ratePerMinute, ratePerHour: sa.ratePerHour,
      concurrency: sa.concurrency, billable: 'http-200', costPerCallMicroGbp: sa.costPerCallMicroGbp, ...timing,
    },
    fixture: {
      hosts: ['fixture.local'], ratePerMinute: 6000, ratePerHour: 360000, concurrency: 8,
      billable: allowSynthetic ? 'http-200' : 'never', costPerCallMicroGbp: allowSynthetic ? FIXTURE_COST_MICRO_GBP : 0, ...timing,
    },
    // why: WP7's FX refresh goes through http-kit under 'fx' (spec §4); it may narrow this host.
    fx: { hosts: ['api.frankfurter.dev', 'api.frankfurter.app'], ratePerMinute: 10, ratePerHour: 100, concurrency: 1, billable: 'never', costPerCallMicroGbp: 0, ...timing },
  };
}

function buildRepos(db: Db, clock: Clock): Repos {
  return {
    airports: new AirportsRepo(db, clock), fx: new FxRepo(db, clock), definitions: new DefinitionsRepo(db, clock),
    executions: new ExecutionsRepo(db, clock), cells: new CellsRepo(db, clock), calendarPrices: new CalendarPricesRepo(db, clock),
    itineraries: new ItinerariesRepo(db, clock), ledger: new LedgerRepo(db, clock), alerts: new AlertsRepo(db, clock),
    notifications: new NotificationsRepo(db, clock), routeHistory: new RoutePriceHistoryRepo(db, clock),
  };
}

/**
 * Opens the DB, applies migrations and constructs guard, cache, http-kit and providers
 * (plan "Wiring and bootstraps"). The fixture provider exists only under syntheticAllowed (spec §5.5).
 * The real adapters are added here by WP8 after WP5 and WP6 merge.
 */
export function buildPorts(
  config: Config,
  opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string },
): Ports {
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(config.databasePath);
  try {
    applyMigrations(db, opts.migrationsDir);
    const allowSynthetic = syntheticAllowed(config);
    const repos = buildRepos(db, clock);
    const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config, {}), clock);
    const cache = new SqliteResponseCache(db, clock);
    const secrets = collectSecrets(config);
    const http = createHttpKit({
      budget, cache, limits: httpLimits(config, allowSynthetic), clock, log: opts.log, secrets,
      ...(opts.recorder !== undefined ? { recorder: opts.recorder } : {}),
    });
    const providers: FlightProvider[] = [];
    if (allowSynthetic) {
      providers.push(fixtureProvider({ http, log: opts.log, clock, config, costMicroGbp: FIXTURE_COST_MICRO_GBP }));
    }
    return { config, db, repos, budget, cache, http, providers, clock, log: opts.log, secrets };
  } catch (e) {
    db.close();   // why: never leave a half-built handle holding the WAL
    throw e;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/wiring` and `pnpm -r typecheck`
Expected: 10 passed; typecheck clean. A type error at `budgetConfigFromConfig` means WP3 merged a different signature (assumption 4). Raise a finding.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: buildPorts wiring helper with fixture-only providers"
```

### Task 4: Logger

**Files:** create `apps/api/src/logger.ts`, `apps/api/test/logger.test.ts`.

**Interfaces:** consumes `Logger`, `Config['logLevel']`. Produces `createLogger`, `REDACT_PATHS`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/logger.test.ts
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, createLogger } from '../src/logger.js';
import { SENTINEL_SA } from './helpers/env.js';

describe('createLogger (spec §14 redact paths)', () => {
  it('redacts every spec path and keeps the message', () => {
    const lines: string[] = [];
    const log = createLogger('debug', { write: (s: string) => { lines.push(s); } });
    log.info({ apiKey: SENTINEL_SA, token: SENTINEL_SA, authorization: SENTINEL_SA, url: { query: SENTINEL_SA }, req: { headers: { authorization: SENTINEL_SA } } }, 'hello');
    log.child({ tool: 'record' }).warn({ token: SENTINEL_SA }, 'child');
    log.debug({}, 'd');
    log.error({}, 'e');
    expect(lines).toHaveLength(4);
    expect(lines.join('')).not.toContain(SENTINEL_SA);
    expect(lines[0]).toContain('"msg":"hello"');
    expect(lines[1]).toContain('"tool":"record"');
    expect(REDACT_PATHS).toEqual(['apiKey', 'token', 'authorization', 'url.query', 'req.headers.authorization']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/logger.test.ts`
Expected: FAIL, `../src/logger.js` not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/logger.ts
/**
 * pino logger behind the core Logger port (spec §14). Redact paths are the spec's list; the URL
 * query/userinfo stripping rule is applied by http-kit before anything reaches a log line (§5.3).
 */
import type { Config, Logger } from '@gmt/core';
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';

/** Spec §14 / §5.3: "pino redact covers apiKey, token, authorization, url.query, req.headers.authorization". */
export const REDACT_PATHS: readonly string[] = ['apiKey', 'token', 'authorization', 'url.query', 'req.headers.authorization'];

function wrap(p: PinoLogger): Logger {
  return {
    debug: (o, msg) => p.debug(o, msg),
    info: (o, msg) => p.info(o, msg),
    warn: (o, msg) => p.warn(o, msg),
    error: (o, msg) => p.error(o, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

/**
 * JSON logs to stderr by default, so a tool's human-readable report on stdout stays clean.
 * why: sync destination, so a tool that exits right after an error does not lose its last line.
 */
export function createLogger(level: Config['logLevel'], destination?: DestinationStream): Logger {
  return wrap(
    pino(
      { level, redact: { paths: [...REDACT_PATHS], censor: '[redacted]' } },
      destination ?? pino.destination({ dest: 2, sync: true }),
    ),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/logger.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: pino logger with spec redact paths"
```

### Task 5: Record arguments and the static call plan

**Files:** create `apps/api/src/tools/recordPlan.ts`, `apps/api/test/tools/recordPlan.test.ts`.

**Interfaces:** consumes `iataSchema`, `isoMonthSchema`. Produces `RecordArgs`, `parseRecordArgs`, `planCalls`, `formatPlan`, `rectangle`, `addDaysIso`, `addMonths`, `CallSpec`, `PlannedCall`, `Rect`, `CellDates`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tools/recordPlan.test.ts
import { describe, expect, it } from 'vitest';
import { type RecordArgs, formatPlan, parseRecordArgs, planCalls, rectangle } from '../../src/tools/recordPlan.js';

const ROUTE = ['--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03'];

function args(extra: string[] = []): RecordArgs {
  const r = parseRecordArgs(['--budget', '12', ...ROUTE, ...extra]);
  if (!r.ok) throw new Error(r.message);
  return r.args;
}

describe('parseRecordArgs refuses to run without an explicit budget (spec §9 item 7)', () => {
  it.each([
    [[...ROUTE], '--budget is required'],
    [['--budget', '0', ...ROUTE], 'positive integer'],
    [['--budget', '-3', ...ROUTE], 'positive integer'],
    [['--budget', 'ten', ...ROUTE], 'positive integer'],
    [['--budget', '3', ...ROUTE], 'at least 4'],
    [['--budget', '12', '--month', '2027-03'], '--route is required'],
    [['--budget', '12', '--route', 'LHR:LHR', '--month', '2027-03'], 'both origin and destination'],
    [['--budget', '12', '--route', 'LHR', '--month', '2027-03'], 'O1,O2:D1,D2'],
    [['--budget', '12', '--route', 'LHR:JFK', '--month', '2027-13'], '--month'],
    [['--budget', '12', ...ROUTE, '--bogus', '1'], 'unknown flag --bogus'],
    [['--budget', '12', ...ROUTE, '--metro', 'lon1'], '--metro'],
  ])('%j → %s', (argv, message) => {
    const r = parseRecordArgs(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(message);
  });

  it('accepts the worked example with defaults, lower-case codes and a pnpm "--" separator', () => {
    const r = parseRecordArgs(['--', '--budget', '12', '--route', 'lhr,lgw:jfk,ewr', '--month', '2027-03', '--dry-run']);
    expect(r).toEqual({
      ok: true,
      args: { budget: 12, freeBudget: 25, origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'], month: '2027-03', minNights: 10, metro: null, dryRun: true },
    });
  });
});

describe('planCalls: the exact live call list of brief section 7', () => {
  it('rectangle 8 × 24 from the 1st of the month, returns from +minNights', () => {
    expect(rectangle('2027-03', 8, 24, 10)).toEqual({ outFrom: '2027-03-01', outTo: '2027-03-08', retFrom: '2027-03-11', retTo: '2027-04-03', combinations: 192 });
    expect(rectangle('2027-03', 9, 24, 10).combinations).toBe(216);
  });

  it('with the shared metro LON: 20 Travelpayouts calls and at most 12 SearchApi credits', () => {
    const plan = planCalls(args(), 'LON');
    expect(plan.map((c) => c.id)).toEqual([
      ...Array.from({ length: 20 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, i) => `SA-${String(i + 1).padStart(2, '0')}`),
    ]);
    expect(plan[0]?.label).toBe('travelpayouts prices_for_dates LON→JFK 2027-03 (metro)');
    expect(plan[13]?.label).toBe('travelpayouts prices_for_dates LON→EWR 2027-09 (metro)');
    expect(plan[14]?.label).toBe('travelpayouts prices_for_dates LHR→JFK 2027-03 (airport)');
    expect(plan[17]?.label).toBe('travelpayouts prices_for_dates LGW→EWR 2027-03 (airport)');
    expect(plan[18]?.label).toBe('travelpayouts prices_for_dates LON→JFK 2028-02 (empty-probe)');
    expect(plan[19]?.expect).toEqual([401]);
    expect(plan[20]?.label).toBe('searchapi google_flights_calendar LHR→JFK out 2027-03-01..2027-03-08 × ret 2027-03-11..2027-04-03 (192)');
    expect(plan[21]?.expect).toEqual([400]);
    expect(plan.reduce((n, c) => n + c.worstCaseCredits, 0)).toBe(12);
    expect(plan.reduce((n, c) => n + c.freeCalls, 0)).toBe(20);
    const lines = formatPlan(plan);
    expect(lines[19]).toContain('Travelpayouts 1 (running 20)');
    expect(lines[33]).toContain('SearchApi ≤1 (running ≤12)');
    expect(lines[34]).toBe('total: SearchApi ≤12 credits, Travelpayouts 20 free calls (plus one per extra page if a page holds 1000 rows)');
  });

  it('without a shared metro: every origin airport for 7 months, no separate airport tiles', () => {
    const plan = planCalls(args(), null);
    expect(plan.filter((c) => c.spec.kind === 'tp-tile')).toHaveLength(2 * 2 * 7 + 1);
    expect(plan.reduce((n, c) => n + c.freeCalls, 0)).toBe(30);
  });

  it('the burst shrinks with the budget: --budget 6 → 2 attempts, ≤6 credits', () => {
    const r = parseRecordArgs(['--budget', '6', ...ROUTE]);
    if (!r.ok) throw new Error(r.message);
    const plan = planCalls(r.args, 'LON');
    expect(plan.filter((c) => c.spec.kind === 'sa-burst')).toHaveLength(2);
    expect(plan.reduce((n, c) => n + c.worstCaseCredits, 0)).toBe(6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/tools/recordPlan.test.ts`
Expected: FAIL, `../../src/tools/recordPlan.js` not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/tools/recordPlan.ts
/**
 * Arguments and the static call plan of `pnpm record:fixtures` (spec §9 item 7, §16 WP4b).
 * Pure, so the list the operator approves with --dry-run is exactly the list that runs.
 * No airport appears here: the route is a CLI argument (spec §1).
 */
import { type Iata, type IsoMonth, iataSchema, isoMonthSchema } from '@gmt/core';

/** Calendar + step 1 + step 2 + step 3: the credits the run needs before any 429 attempt. */
export const SA_REQUIRED_CREDITS = 4;
/** Upper bound on 429 attempts (brief section 7). */
export const BURST_MAX = 8;
/** Months of Travelpayouts metro tiles: the worked example's 182-day window spans 7 (spec §5.2). */
export const TP_MONTHS = 7;
/** Offset of the best-effort empty-envelope probe month. */
export const TP_EMPTY_PROBE_OFFSET_MONTHS = 11;
/** Spec §5.2 measured rectangle: 8 outbound × 24 return days = 192 ≤ 200. */
export const CALENDAR_OUT_DAYS = 8;
export const CALENDAR_RET_DAYS = 24;
/** Spec §2 fact 2. */
export const CALENDAR_MAX_COMBINATIONS = 200;
export const DEFAULT_FREE_BUDGET = 25;
export const DEFAULT_MIN_NIGHTS = 10;

export interface RecordArgs {
  budget: number; freeBudget: number; origins: Iata[]; destinations: Iata[]; month: IsoMonth;
  minNights: number; metro: string | null; dryRun: boolean;
}
export type ParseRecordResult = { ok: true; args: RecordArgs } | { ok: false; message: string };

export interface Rect { outFrom: string; outTo: string; retFrom: string; retTo: string; combinations: number }
export interface CellDates { departure: string; return: string }

export type CallSpec =
  | { kind: 'tp-tile'; origin: string; destination: Iata; month: IsoMonth; purpose: 'metro' | 'airport' | 'empty-probe' }
  | { kind: 'tp-auth'; origin: string; destination: Iata; month: IsoMonth }
  | { kind: 'sa-calendar' | 'sa-over-limit'; origin: Iata; destination: Iata; rect: Rect }
  | { kind: 'sa-step1' | 'sa-step2' | 'sa-step3'; origin: Iata; destination: Iata }
  | { kind: 'sa-auth'; origin: Iata; destination: Iata; cell: CellDates }
  | { kind: 'sa-burst'; origin: Iata; destination: Iata; rect: Rect; n: number; of: number };

export interface PlannedCall {
  id: string; spec: CallSpec; label: string; worstCaseCredits: 0 | 1; freeCalls: 0 | 1; expect: readonly number[];
}

export const USAGE =
  'usage: pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--free-budget N] [--min-nights N] [--metro CODE] [--dry-run]';

const KNOWN_FLAGS = new Set(['budget', 'free-budget', 'route', 'month', 'min-nights', 'metro']);

function positiveInt(s: string): number | null {
  return /^[1-9]\d{0,5}$/.test(s) ? Number(s) : null;
}

function iataList(s: string): Iata[] | null {
  const out: Iata[] = [];
  for (const part of s.split(',')) {
    const r = iataSchema.safeParse(part.trim().toUpperCase());
    if (!r.success) return null;
    out.push(r.data);
  }
  return out.length > 0 ? out : null;
}

/** Parses the CLI. Refuses a missing, zero or too-small budget before anything is opened (spec §9 item 7). */
export function parseRecordArgs(argv: readonly string[]): ParseRecordResult {
  const fail = (message: string): ParseRecordResult => ({ ok: false, message: `${message}\n${USAGE}` });
  const flags = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;   // why: pnpm may forward its own separator
    if (a === '--dry-run') { dryRun = true; continue; }
    if (a === undefined || !a.startsWith('--')) return fail(`unexpected argument ${String(a)}`);
    const name = a.slice(2);
    if (!KNOWN_FLAGS.has(name)) return fail(`unknown flag --${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return fail(`--${name} needs a value`);
    flags.set(name, value);
    i++;
  }
  const budgetRaw = flags.get('budget');
  if (budgetRaw === undefined) return fail('--budget is required: the explicit SearchApi call budget (spec §9 item 7)');
  const budget = positiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer; 0 would record nothing');
  if (budget < SA_REQUIRED_CREDITS) return fail(`--budget must be at least 4 (calendar + the three-step chain); got ${budget}`);
  const freeBudget = positiveInt(flags.get('free-budget') ?? String(DEFAULT_FREE_BUDGET));
  if (freeBudget === null) return fail('--free-budget must be a positive integer');
  const route = flags.get('route');
  if (route === undefined) return fail('--route is required, e.g. --route O1,O2:D1,D2');
  const sides = route.split(':');
  if (sides.length !== 2 || sides[0] === undefined || sides[1] === undefined) return fail('--route must look like O1,O2:D1,D2');
  const origins = iataList(sides[0]);
  const destinations = iataList(sides[1]);
  if (origins === null || destinations === null) return fail('--route must look like O1,O2:D1,D2 with three-letter codes');
  if (origins.some((o) => destinations.includes(o))) return fail('an airport cannot be both origin and destination');
  const month = isoMonthSchema.safeParse(flags.get('month') ?? '');
  if (!month.success) return fail('--month must be YYYY-MM');
  const minNights = positiveInt(flags.get('min-nights') ?? String(DEFAULT_MIN_NIGHTS));
  if (minNights === null || minNights > 90) return fail('--min-nights must be 1–90');
  const metroRaw = flags.get('metro');
  if (metroRaw !== undefined && !/^[A-Z]{3}$/.test(metroRaw)) return fail('--metro must be a three-letter upper-case code');
  return { ok: true, args: { budget, freeBudget, origins, destinations, month: month.data, minNights, metro: metroRaw ?? null, dryRun } };
}

const DAY_MS = 86_400_000;

function epochDay(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m === null) throw new Error(`not a calendar date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Calendar-date arithmetic on UTC epoch days (spec §6.1: never Date-local arithmetic). */
export function addDaysIso(d: string, n: number): string {
  return new Date((epochDay(d) + n) * DAY_MS).toISOString().slice(0, 10);
}

export function addMonths(month: IsoMonth, k: number): IsoMonth {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (m === null) throw new Error(`not a month: ${month}`);
  const idx = Number(m[1]) * 12 + Number(m[2]) - 1 + k;
  return isoMonthSchema.parse(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
}

/** Outbound days from the 1st of `month`; returns start `minNights` after the first outbound day. */
export function rectangle(month: IsoMonth, outDays: number, retDays: number, minNights: number): Rect {
  const outFrom = `${month}-01`;
  const retFrom = addDaysIso(outFrom, minNights);
  return { outFrom, outTo: addDaysIso(outFrom, outDays - 1), retFrom, retTo: addDaysIso(retFrom, retDays - 1), combinations: outDays * retDays };
}

function first<T>(xs: readonly T[]): T {
  const x = xs[0];
  if (x === undefined) throw new Error('empty list');
  return x;
}

/** The exact ordered call list (brief section 7). `metro` is the origins' shared metro code or null. */
export function planCalls(a: RecordArgs, metro: string | null): PlannedCall[] {
  const calls: PlannedCall[] = [];
  let tp = 0;
  let sa = 0;
  const tpCall = (spec: CallSpec, label: string, expect: readonly number[]): void => {
    tp++;
    calls.push({ id: `TP-${String(tp).padStart(2, '0')}`, spec, label, worstCaseCredits: 0, freeCalls: 1, expect });
  };
  const saCall = (spec: CallSpec, label: string, credits: 0 | 1, expect: readonly number[]): void => {
    sa++;
    calls.push({ id: `SA-${String(sa).padStart(2, '0')}`, spec, label, worstCaseCredits: credits, freeCalls: 0, expect });
  };
  const tile = (origin: string, destination: Iata, month: IsoMonth, purpose: 'metro' | 'airport' | 'empty-probe'): void =>
    tpCall({ kind: 'tp-tile', origin, destination, month, purpose }, `travelpayouts prices_for_dates ${origin}→${destination} ${month} (${purpose})`, [200]);

  const tileOrigins = metro === null ? a.origins : [metro];
  for (let k = 0; k < TP_MONTHS; k++) {
    const month = addMonths(a.month, k);
    for (const o of tileOrigins) for (const d of a.destinations) tile(o, d, month, metro === null ? 'airport' : 'metro');
  }
  if (metro !== null) for (const o of a.origins) for (const d of a.destinations) tile(o, d, a.month, 'airport');
  const o0 = first(a.origins);
  const d0 = first(a.destinations);
  const tpOrigin = metro ?? o0;
  tile(tpOrigin, d0, addMonths(a.month, TP_EMPTY_PROBE_OFFSET_MONTHS), 'empty-probe');
  tpCall({ kind: 'tp-auth', origin: tpOrigin, destination: d0, month: a.month }, `travelpayouts prices_for_dates ${tpOrigin}→${d0} ${a.month} with an invalid token (401 body)`, [401]);

  const rect = rectangle(a.month, CALENDAR_OUT_DAYS, CALENDAR_RET_DAYS, a.minNights);
  const over = rectangle(a.month, CALENDAR_OUT_DAYS + 1, CALENDAR_RET_DAYS, a.minNights);
  const rectLabel = (r: Rect): string => `out ${r.outFrom}..${r.outTo} × ret ${r.retFrom}..${r.retTo} (${r.combinations})`;
  saCall({ kind: 'sa-calendar', origin: o0, destination: d0, rect }, `searchapi google_flights_calendar ${o0}→${d0} ${rectLabel(rect)}`, 1, [200]);
  saCall({ kind: 'sa-over-limit', origin: o0, destination: d0, rect: over }, `searchapi google_flights_calendar ${o0}→${d0} ${rectLabel(over)} over the limit (400 body)`, 0, [400]);
  saCall({ kind: 'sa-step1', origin: o0, destination: d0 }, `searchapi google_flights step 1 ${o0}→${d0}, cheapest priced cell of SA-01`, 1, [200]);
  saCall({ kind: 'sa-step2', origin: o0, destination: d0 }, 'searchapi google_flights step 2, departure_token of the cheapest priced step-1 option', 1, [200]);
  saCall({ kind: 'sa-step3', origin: o0, destination: d0 }, 'searchapi google_flights step 3, booking_token of the cheapest priced step-2 option', 1, [200]);
  const authCell = { departure: rect.outFrom, return: rect.retFrom };
  saCall({ kind: 'sa-auth', origin: o0, destination: d0, cell: authCell }, `searchapi google_flights step 1 ${o0}→${d0} ${authCell.departure}/${authCell.return} with an invalid key (401 body)`, 0, [401]);
  const burst = Math.max(0, Math.min(BURST_MAX, a.budget - SA_REQUIRED_CREDITS));
  for (let n = 1; n <= burst; n++) {
    saCall({ kind: 'sa-burst', origin: o0, destination: d0, rect, n, of: burst }, `searchapi repeat of SA-01, 429 attempt ${n} of ${burst} (best-effort; 200 duplicates deleted)`, 1, [200, 429]);
  }
  return calls;
}

/** One line per call with running totals, then a total line (printed by --dry-run and before a run). */
export function formatPlan(plan: readonly PlannedCall[]): string[] {
  let credits = 0;
  let free = 0;
  const lines = plan.map((c) => {
    credits += c.worstCaseCredits;
    free += c.freeCalls;
    return `${c.id.padEnd(6)} ${c.label} | expect ${c.expect.join('/')} | SearchApi ≤${c.worstCaseCredits} (running ≤${credits}) | Travelpayouts ${c.freeCalls} (running ${free})`;
  });
  lines.push(`total: SearchApi ≤${credits} credits, Travelpayouts ${free} free calls (plus one per extra page if a page holds 1000 rows)`);
  return lines;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/tools/recordPlan.test.ts`
Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: record:fixtures arguments and the exact call plan"
```

### Task 6: Vendor requests, the recording run and the budget guard (msw)

**Files:** create `apps/api/src/tools/types.ts`, `apps/api/src/tools/recordRequests.ts`, `apps/api/src/tools/recordParams.ts`, `apps/api/src/tools/record.ts`, `apps/api/test/helpers/mswVendors.ts`, `apps/api/test/tools/record.msw.test.ts`; modify `apps/api/package.json` (devDependency `msw@3.0.3`).

**Interfaces:** consumes `createHttpKit`, `HttpKitRequest`, `ProviderError`, `BudgetExceeded`, `createRecorder`, `httpLimits`. Produces `ToolEntry`, `StartedTool`, `ToolContext`, `RECORDED_BY`, `openRecordingExecution`, `resolveMetro`, `recordTool`, `recordFixtures`, `RecordContext`, `RecordSummary`, `CallResult`, `ParamsAllowlist`, `ParamLog`, `paramRules`, `writeAllowlist`, `TP_URL`, `SA_URL`, the invalid-credential constants and the response readers.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/helpers/mswVendors.ts
// msw stand-ins for the two vendors, shaped like spec §2 facts 1–5. Test bodies only; never committed.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemClock } from '@gmt/core';
import { createRecorder } from '@gmt/providers';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { RECORDED_BY, recordFixtures } from '../../src/tools/record.js';
import { type RecordArgs, parseRecordArgs, planCalls } from '../../src/tools/recordPlan.js';
import { SA_URL, TP_URL } from '../../src/tools/recordRequests.js';
import { type Ports, buildPorts, collectSecrets, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from './env.js';

export interface VendorLog { tp: URLSearchParams[]; sa: URLSearchParams[]; calendarCalls: number }

function inclusiveDays(from: string | null, to: string | null): number {
  if (from === null || to === null) return 0;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

/** rateLimitAfter: calendar calls (counted from 1, incl. the over-limit one) after which the vendor answers 429. */
export function vendorServer(opts: { rateLimitAfter: number | null }) {
  const seen: VendorLog = { tp: [], sa: [], calendarCalls: 0 };
  const server = setupServer(
    http.get(TP_URL, ({ request }) => {
      const p = new URL(request.url).searchParams;
      seen.tp.push(p);
      if (request.headers.get('x-access-token') !== SENTINEL_TP) return new HttpResponse('Unauthorized', { status: 401 });
      if (p.get('departure_at') === '2028-02') return HttpResponse.json({ success: true, data: [], currency: 'gbp' });
      return HttpResponse.json({
        success: true, currency: 'gbp',
        data: [{ origin: p.get('origin'), destination: p.get('destination'), origin_airport: 'LHR', destination_airport: p.get('destination'), price: 412, airline: 'BA', flight_number: '117', departure_at: '2027-03-02T08:25:00+00:00', return_at: '2027-03-16T18:00:00-04:00', transfers: 0, return_transfers: 0, link: '/search/LON0203JFK16031' }],
      });
    }),
    http.get(SA_URL, ({ request }) => {
      const p = new URL(request.url).searchParams;
      seen.sa.push(p);
      if (request.headers.get('authorization') !== `Bearer ${SENTINEL_SA}`) return HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 });
      const engine = p.get('engine');
      if (engine === 'google_flights_calendar') {
        seen.calendarCalls++;
        const combos = inclusiveDays(p.get('outbound_date_start'), p.get('outbound_date_end')) * inclusiveDays(p.get('return_date_start'), p.get('return_date_end'));
        if (combos > 200) return HttpResponse.json({ error: 'Too many date combinations: the maximum is 200.' }, { status: 400 });
        if (opts.rateLimitAfter !== null && seen.calendarCalls > opts.rateLimitAfter) {
          return HttpResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': '60' } });
        }
        return HttpResponse.json({
          search_metadata: { id: `cal-${seen.calendarCalls}`, request_url: 'https://www.searchapi.io/api/v1/search?engine=google_flights_calendar' },
          search_parameters: { engine, gl: p.get('gl'), currency: p.get('currency') },
          calendar: [
            { departure: '2027-03-03', return: '2027-03-15', price: 640 },
            { departure: '2027-03-02', return: '2027-03-16', price: 603, is_lowest_price: true },
            { departure: '2027-03-04', return: '2027-03-16', has_no_flights: true },
          ],
        });
      }
      if (engine === 'google_flights') {
        const dt = p.get('departure_token');
        const bt = p.get('booking_token');
        if (dt === null && bt === null) {
          return HttpResponse.json({ best_flights: [{ price: 603, departure_token: 'DT-cheapest' }, { departure_token: 'DT-unpriced' }], other_flights: [{ price: 655, departure_token: 'DT-other' }], price_insights: { lowest_price: 590, price_history: [[1790000000, 610]] } });
        }
        if (dt === 'DT-cheapest' && bt === null) return HttpResponse.json({ best_flights: [{ price: 603, booking_token: 'BT-cheapest' }, { booking_token: 'BT-unpriced' }] });
        if (bt === 'BT-cheapest' && dt === null) {
          return HttpResponse.json({ booking_options: [
            { book_with: 'Airline', price: 603, booking_request: { url: 'https://www.google.com/travel/clk/f', post_data: 'u=airline' } },
            { book_with: 'OTA', price: 573, booking_request: { url: 'https://www.google.com/travel/clk/f', post_data: 'u=ota' } },
          ] });
        }
      }
      return HttpResponse.json({ error: 'unexpected request' }, { status: 400 });
    }),
  );
  return { server, seen };
}

function workedExample(): RecordArgs {
  const r = parseRecordArgs(['--budget', '12', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--metro', 'LON']);
  if (!r.ok) throw new Error(r.message);
  return r.args;
}
/** The worked example's arguments, parsed (so the codes are branded Iata values). */
export const WORKED_EXAMPLE: RecordArgs = workedExample();

/** Runs the full recording against msw into <tmp>/packages/providers/fixtures/recorded. */
export async function runMswRecording(opts: { args?: RecordArgs; rateLimitAfter?: number | null } = {}) {
  const a = opts.args ?? WORKED_EXAMPLE;
  const repoLike = mkdtempSync(join(tmpdir(), 'gmt-msw-'));
  const recordedRoot = join(repoLike, 'packages', 'providers', 'fixtures', 'recorded');
  mkdirSync(recordedRoot, { recursive: true });
  const config = loadConfigFromEnv(testEnv());
  const { server, seen } = vendorServer({ rateLimitAfter: opts.rateLimitAfter ?? null });
  server.listen({ onUnhandledRequest: 'error' });
  const recorder = createRecorder({ root: recordedRoot, secrets: collectSecrets(config), clock: systemClock, recordedBy: RECORDED_BY });
  const ports: Ports = buildPorts(config, { log: silentLog, migrationsDir: MIGRATIONS_DIR, recorder });
  try {
    const summary = await recordFixtures(ports, a, {
      plan: planCalls(a, a.metro), recorder, recordedRoot,
      signal: new AbortController().signal, out: () => undefined,
    });
    return { summary, seen, repoLike, recordedRoot, ports };
  } finally {
    server.close();
  }
}
```

```ts
// apps/api/test/tools/record.msw.test.ts
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { listRecordedFiles, verifyRecordedFile } from '../../../../packages/providers/test/helpers/recordedTree.js';
import { WORKED_EXAMPLE, runMswRecording } from '../helpers/mswVendors.js';
import { SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';

const opened: Array<{ ports: { db: { close(): void } } }> = [];
afterEach(() => { for (const o of opened.splice(0)) o.ports.db.close(); });

describe('recordFixtures against msw vendors (spec §9 item 7, §5.3 Recorder)', () => {
  it('issues the planned calls, follows the token chain and records every response', async () => {
    const run = await runMswRecording({ rateLimitAfter: 3 });
    opened.push(run);
    const { summary, seen } = run;
    expect(summary.requiredOk).toBe(true);
    expect(summary.results.filter((r) => r.id.startsWith('TP-')).map((r) => r.status)).toEqual([...Array(19).fill(200), 401]);
    expect(summary.results.filter((r) => r.id.startsWith('SA-')).map((r) => `${r.id}:${r.status}`)).toEqual([
      'SA-01:200', 'SA-02:400', 'SA-03:200', 'SA-04:200', 'SA-05:200', 'SA-06:401', 'SA-07:200', 'SA-08:429',
      'SA-09:skipped', 'SA-10:skipped', 'SA-11:skipped', 'SA-12:skipped', 'SA-13:skipped', 'SA-14:skipped',
    ]);
    expect(summary.emptyEnvelope).toBe(true);
    expect(summary.induced429).toBe(true);
    expect(summary.chainComplete).toBe(true);
    expect(summary.duplicatesDeleted).toBe(1);

    // step 1 used the cheapest priced calendar cell; steps 2 and 3 carried the cheapest priced tokens
    const flights = seen.sa.filter((p) => p.get('engine') === 'google_flights');
    expect(flights[0]?.get('outbound_date')).toBe('2027-03-02');
    expect(flights[0]?.get('return_date')).toBe('2027-03-16');
    expect(flights[1]?.get('departure_token')).toBe('DT-cheapest');
    expect(flights[2]?.get('booking_token')).toBe('BT-cheapest');
    expect(flights[2]?.get('departure_token')).toBeNull();
    for (const p of seen.sa) expect(p.get('api_key')).toBeNull();
    for (const p of seen.tp) expect(p.get('token')).toBeNull();

    // the recorded tree: every file verifies, burst duplicates are gone, no credential anywhere
    const files = listRecordedFiles(run.recordedRoot);
    const parsed = files.map((f) => verifyRecordedFile(f));
    expect(parsed.every((v) => v.ok)).toBe(true);
    const ok = parsed.flatMap((v) => (v.ok ? [v.file] : []));
    const calendar200 = ok.filter((f) => f.request.params.engine === 'google_flights_calendar' && f.status === 200);
    expect(calendar200).toHaveLength(1);
    expect(ok.filter((f) => f.status === 429)).toHaveLength(1);
    expect(ok.filter((f) => f.status === 400)).toHaveLength(1);
    expect(ok.filter((f) => f.status === 401).map((f) => f.providerId).sort()).toEqual(['searchapi', 'travelpayouts']);
    expect(ok.filter((f) => f.providerId === 'travelpayouts')).toHaveLength(20);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toContain(SENTINEL_SA);
      expect(text).not.toContain(SENTINEL_TP);
      expect(text).not.toMatch(/X-Access-Token|api_key=|request_url/i);
    }

    // the ledger counted within the budget
    expect(summary.ledger.searchapiCalls).toBeLessThanOrEqual(WORKED_EXAMPLE.budget);
    expect(summary.ledger.travelpayoutsCalls).toBe(20);
  });

  it('the real SqliteBudgetGuard stops the run at --budget, before the vendor is hit (brief assumption 3)', async () => {
    const run = await runMswRecording({ args: { ...WORKED_EXAMPLE, budget: 2 } });
    opened.push(run);
    const byId = new Map(run.summary.results.map((r) => [r.id, r.status]));
    expect(byId.get('SA-01')).toBe(200);
    expect(byId.get('SA-02')).toBe(400);          // finalised non-billable: does not consume the cap
    expect(byId.get('SA-03')).toBe(200);
    expect(byId.get('SA-04')).toBe('budget:execution-calls');
    expect(byId.get('SA-05')).toBe('skipped');
    expect(run.seen.sa.some((p) => p.get('departure_token') !== null)).toBe(false);
    expect(run.summary.requiredOk).toBe(false);
  });

  it('the free-call cap is enforced the same way', async () => {
    const run = await runMswRecording({ args: { ...WORKED_EXAMPLE, freeBudget: 3 } });
    opened.push(run);
    expect(run.seen.tp).toHaveLength(3);
    expect(run.summary.results.find((r) => r.id === 'TP-04')?.status).toBe('budget:execution-free-calls');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/tools/record.msw.test.ts`
Expected: FAIL, `../../src/tools/recordRequests.js` not found.

- [ ] **Step 3: Implement**

Add `"msw": "3.0.3"` to `devDependencies` in `apps/api/package.json` and run `pnpm install`.

```ts
// apps/api/src/tools/recordRequests.ts
/**
 * Hand-built vendor requests and response readers for record:fixtures (brief section 6, spec §5.2,
 * §5.4, docs/providers.md). Credentials go in headers only (spec §2 fact 8); nothing here is an
 * airport, every code arrives as an argument.
 */
import type { CellDates, Rect } from './recordPlan.js';

export const TP_URL = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
export const SA_URL = 'https://www.searchapi.io/api/v1/search';
/** Spec §5.2 measured page size. */
export const TP_PAGE_LIMIT = 1000;
/** Deliberately invalid credentials for the 401 probes; not secrets, never real keys. */
export const INVALID_SEARCHAPI_KEY = 'invalid-key-for-401-recording';
export const INVALID_TRAVELPAYOUTS_TOKEN = 'invalid-token-for-401-recording';

/** One prices_for_dates page (spec §5.2 Travelpayouts tiling). */
export function tpUrl(origin: string, destination: string, month: string, page: number): URL {
  const url = new URL(TP_URL);
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('departure_at', month);
  url.searchParams.set('one_way', 'false');
  url.searchParams.set('currency', 'gbp');
  url.searchParams.set('limit', String(TP_PAGE_LIMIT));
  url.searchParams.set('page', String(page));
  return url;
}

export function saUrl(params: Readonly<Record<string, string>>): URL {
  const url = new URL(SA_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/** google_flights_calendar over one rectangle. outbound_date/return_date are required by the docs. */
export function calendarParams(origin: string, destination: string, r: Rect, gl: string): Record<string, string> {
  return {
    engine: 'google_flights_calendar', departure_id: origin, arrival_id: destination,
    outbound_date: r.outFrom, outbound_date_start: r.outFrom, outbound_date_end: r.outTo,
    return_date: r.retFrom, return_date_start: r.retFrom, return_date_end: r.retTo,
    flight_type: 'round_trip', currency: 'GBP', gl, hl: 'en',
  };
}

/** google_flights for one cell; steps 2 and 3 add one token (spec §5.4). */
export function flightsParams(origin: string, destination: string, cell: CellDates, gl: string, token: Readonly<Record<string, string>>): Record<string, string> {
  return {
    engine: 'google_flights', departure_id: origin, arrival_id: destination,
    outbound_date: cell.departure, return_date: cell.return, flight_type: 'round_trip',
    currency: 'GBP', gl, hl: 'en', ...token,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Cheapest priced calendar entry; entries with has_no_flights or no price are skipped (spec §5.2). */
export function cheapestCalendarCell(body: unknown): (CellDates & { price: number }) | null {
  if (!isRecord(body) || !Array.isArray(body.calendar)) return null;
  let best: (CellDates & { price: number }) | null = null;
  for (const e of body.calendar) {
    if (!isRecord(e) || e.has_no_flights === true) continue;
    const { departure, price } = e;
    const ret = e.return;
    if (typeof departure !== 'string' || typeof ret !== 'string' || typeof price !== 'number') continue;
    if (best === null || price < best.price) best = { departure, return: ret, price };
  }
  return best;
}

/** Cheapest option carrying a price and the given token; unpriced options are skipped (spec §5.4). */
export function cheapestOption(body: unknown, tokenField: 'departure_token' | 'booking_token'): { token: string; price: number } | null {
  if (!isRecord(body)) return null;
  let best: { token: string; price: number } | null = null;
  for (const list of [body.best_flights, body.other_flights]) {
    if (!Array.isArray(list)) continue;
    for (const o of list) {
      if (!isRecord(o)) continue;
      const token = o[tokenField];
      const price = o.price;
      if (typeof token !== 'string' || typeof price !== 'number') continue;
      if (best === null || price < best.price) best = { token, price };
    }
  }
  return best;
}

/** Row count of a prices_for_dates envelope (0 for a malformed one). */
export function dataRowCount(body: unknown): number {
  return isRecord(body) && Array.isArray(body.data) ? body.data.length : 0;
}

/** Number of step-3 booking options. */
export function bookingOptionCount(body: unknown): number {
  return isRecord(body) && Array.isArray(body.booking_options) ? body.booking_options.length : 0;
}
```

```ts
// apps/api/src/tools/recordParams.ts
/**
 * The dated parameter allowlists (spec §5.2: "fixtures/recorded/<provider>/params-<date>.json
 * enumerates parameter names and values; tests assert both"). Every parameter record:fixtures
 * sends is checked against this table before the request leaves, and the observed values are
 * written out for WP5/WP6 to load.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export type EndpointKey = 'prices_for_dates' | 'google_flights_calendar' | 'google_flights';
export type ValueKind = 'iata' | 'iso-date' | 'iso-month' | 'positive-int' | 'opaque-token';
export type ParamRule = { fixed: readonly string[] } | { kind: ValueKind };
export interface EndpointRules { provider: 'travelpayouts' | 'searchapi'; path: string; params: Readonly<Record<string, ParamRule>> }

export interface ParamsAllowlist {
  provider: 'travelpayouts' | 'searchapi';
  recordedAt: string;
  recordedBy: string;
  credential: 'header';
  endpoints: Array<{ key: EndpointKey; method: 'GET'; path: string; params: Record<string, ParamRule & { observed: string[] }> }>;
}

const KIND_PATTERN: Record<Exclude<ValueKind, 'opaque-token'>, RegExp> = {
  iata: /^[A-Z]{3}$/, 'iso-date': /^\d{4}-\d{2}-\d{2}$/, 'iso-month': /^\d{4}-\d{2}$/, 'positive-int': /^[1-9]\d*$/,
};

/** The full rule table. `gl` is POINT_OF_SALE lower-cased (spec §5.2). */
export function paramRules(gl: string): Readonly<Record<EndpointKey, EndpointRules>> {
  const iata: ParamRule = { kind: 'iata' };
  const date: ParamRule = { kind: 'iso-date' };
  const shared = { flight_type: { fixed: ['round_trip'] }, currency: { fixed: ['GBP'] }, gl: { fixed: [gl] }, hl: { fixed: ['en'] } } as const;
  return {
    prices_for_dates: {
      provider: 'travelpayouts', path: '/aviasales/v3/prices_for_dates',
      params: { origin: iata, destination: iata, departure_at: { kind: 'iso-month' }, one_way: { fixed: ['false'] }, currency: { fixed: ['gbp'] }, limit: { fixed: ['1000'] }, page: { kind: 'positive-int' } },
    },
    google_flights_calendar: {
      provider: 'searchapi', path: '/api/v1/search',
      params: {
        engine: { fixed: ['google_flights_calendar'] }, departure_id: iata, arrival_id: iata, outbound_date: date,
        outbound_date_start: date, outbound_date_end: date, return_date: date, return_date_start: date, return_date_end: date, ...shared,
      },
    },
    google_flights: {
      provider: 'searchapi', path: '/api/v1/search',
      params: {
        engine: { fixed: ['google_flights'] }, departure_id: iata, arrival_id: iata, outbound_date: date, return_date: date, ...shared,
        departure_token: { kind: 'opaque-token' }, booking_token: { kind: 'opaque-token' },
      },
    },
  };
}

/** Validates outgoing parameters and accumulates the observed values. */
export class ParamLog {
  private readonly observed = new Map<EndpointKey, Map<string, Set<string>>>();
  constructor(private readonly rules: Readonly<Record<EndpointKey, EndpointRules>>) {}

  /** Throws before a request leaves if any parameter or value is outside the table. */
  note(key: EndpointKey, params: URLSearchParams): void {
    const table = this.rules[key].params;
    const seen = this.observed.get(key) ?? new Map<string, Set<string>>();
    this.observed.set(key, seen);
    for (const [name, value] of params) {
      const rule = table[name];
      if (rule === undefined) throw new Error(`parameter ${name} is not in the ${key} allowlist`);
      if ('fixed' in rule) {
        if (!rule.fixed.includes(value)) throw new Error(`${key} ${name}=${value} is not an allowed value`);
      } else if (rule.kind !== 'opaque-token' && !KIND_PATTERN[rule.kind].test(value)) {
        throw new Error(`${key} ${name}=${value} is not a ${rule.kind}`);
      }
      const values = seen.get(name) ?? new Set<string>();
      seen.set(name, values);
      // why: opaque tokens are recorded as placeholders in the fixtures; their values are not listed.
      if (!('kind' in rule && rule.kind === 'opaque-token')) values.add(value);
    }
  }

  /** The allowlist document for one provider. */
  document(provider: 'travelpayouts' | 'searchapi', recordedAt: string, recordedBy: string): ParamsAllowlist {
    const endpoints: ParamsAllowlist['endpoints'] = [];
    for (const key of Object.keys(this.rules) as EndpointKey[]) {
      const r = this.rules[key];
      if (r.provider !== provider) continue;
      const seen = this.observed.get(key) ?? new Map<string, Set<string>>();
      const params: Record<string, ParamRule & { observed: string[] }> = {};
      for (const [name, rule] of Object.entries(r.params)) params[name] = { ...rule, observed: [...(seen.get(name) ?? [])].sort() };
      endpoints.push({ key, method: 'GET', path: r.path, params });
    }
    return { provider, recordedAt, recordedBy, credential: 'header', endpoints };
  }
}

/** Writes params-<date>.json; refuses any root that is not a fixtures/recorded directory (spec §5.5). */
export function writeAllowlist(root: string, doc: ParamsAllowlist, date: string): string {
  const abs = resolve(root);
  if (!abs.endsWith(`${sep}fixtures${sep}recorded`)) throw new Error(`refusing to write outside fixtures/recorded/: ${abs}`);
  const dir = join(abs, doc.provider);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `params-${date}.json`);
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return path;
}
```

`Object.keys(this.rules) as EndpointKey[]` is the one cast in this package. `// why:` `Object.keys` widens to `string[]`, and the table is a closed literal of exactly these three keys.

```ts
// apps/api/src/tools/types.ts
/** The registry shape the tool bootstrap runs (spec §7 tool bootstrap; WP13 adds smoke). */
import type { Config } from '@gmt/core';
import type { FixtureRecorder } from '@gmt/providers';
import type { Ports } from '../wiring.js';

export interface ToolContext {
  recorder: FixtureRecorder | null; recordedRoot: string; signal: AbortSignal;
  out(line: string): void; err(line: string): void;
}

/** A tool whose arguments parsed; its argument type is closed over, so the registry needs no generics. */
export interface StartedTool {
  ok: true;
  /** recordedBy signature for the recorder, or null when this invocation records nothing. */
  recordedBy: string | null;
  configure(c: Config): Config;
  /** A refusal message when the configuration cannot serve this tool, else null. */
  precheck(c: Config): string | null;
  run(ports: Ports, ctx: ToolContext): Promise<number>;
}

export interface ToolEntry {
  start(argv: readonly string[]): StartedTool | { ok: false; message: string };
}
```

`apps/api/src/tools/record.ts` (complete):

```ts
// apps/api/src/tools/record.ts
/**
 * `pnpm record:fixtures` (spec §9 item 7, §5.3 Recorder, §2 facts 1–8, §16 WP4b).
 * Hand-built vendor requests through the real http-kit, recorder and SqliteBudgetGuard; the
 * adapters (WP5, WP6) do not exist yet and later replay what this records.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetExceeded, type DefinitionSnapshot, type Iata, type ProviderId, ProviderError, isoDateSchema } from '@gmt/core';
import type { DefinitionInput } from '@gmt/db';
import { type FixtureRecorder, type HttpKit, type HttpKitRequest, type HttpKitResponse, type ProviderHttpLimits, createHttpKit } from '@gmt/providers';
import { type Ports, httpLimits } from '../wiring.js';
import {
  CALENDAR_OUT_DAYS, CALENDAR_RET_DAYS, type CellDates, type PlannedCall, type RecordArgs, addDaysIso, formatPlan, parseRecordArgs, planCalls,
} from './recordPlan.js';
import { ParamLog, paramRules, writeAllowlist } from './recordParams.js';
import {
  INVALID_SEARCHAPI_KEY, INVALID_TRAVELPAYOUTS_TOKEN, TP_PAGE_LIMIT, bookingOptionCount, calendarParams, cheapestCalendarCell,
  cheapestOption, dataRowCount, flightsParams, saUrl, tpUrl,
} from './recordRequests.js';
import type { StartedTool, ToolContext, ToolEntry } from './types.js';

/** recordedBy signature on every file this tool records (spec §5.5). */
export const RECORDED_BY = '@gmt/api record:fixtures';

/**
 * Creates the definition + execution whose snapshot budget carries --budget / --free-budget as the
 * execution caps the real guard enforces (spec §9 item 7, brief assumption 3).
 * why: the guard reads caps from search_executions.definition_snapshot_json and the ledger's
 * execution_id references search_executions, so the ledger needs a real execution. The definition
 * is disabled and soft-deleted at once, so no view, schedule or reuse query ever sees it.
 */
export function openRecordingExecution(ports: Ports, a: RecordArgs): string {
  const now = ports.clock.now();
  const from = isoDateSchema.parse(`${a.month}-01`);
  const to = isoDateSchema.parse(addDaysIso(from, CALENDAR_OUT_DAYS - 1));
  const maxNights = Math.min(90, a.minNights + CALENDAR_RET_DAYS - 1);
  const input: DefinitionInput = {
    name: `record:fixtures ${now}`, origins: a.origins, destinations: a.destinations,
    window: { kind: 'absolute', from, to }, minNights: a.minNights, maxNights, cabin: 'economy', constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: a.budget, maxFreeCalls: a.freeBudget, maxCostMicroGbp: 0 },
    providers: { discovery: [], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: null, scheduleTz: ports.config.schedulerTimezone,
    confirmedCostPence: null, enabled: false,
  };
  const def = ports.repos.definitions.create(input);
  ports.repos.definitions.softDelete(def.id);
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: { origins: a.origins, destinations: a.destinations, departureFrom: from, departureTo: to, minNights: a.minNights, maxNights },
    resolvedAt: now,
    windowClamped: false,
  };
  return ports.repos.executions.create({ definitionId: def.id, snapshot, status: 'running', cell: null, estimate: null, errorText: null }).id;
}

/**
 * The origins' shared metro code: from the airports table when it is populated (spec §5.2), else
 * the operator's --metro. why: before WP8 nothing seeds the table at tool start.
 */
export function resolveMetro(
  airports: { sharedMetro(iatas: Iata[]): string | null; count(): number },
  a: RecordArgs,
): { ok: true; metro: string | null } | { ok: false; message: string } {
  if (airports.count() === 0) return { ok: true, metro: a.metro };
  const fromTable = airports.sharedMetro(a.origins);
  if (a.metro !== null && a.metro !== fromTable) {
    return { ok: false, message: `--metro ${a.metro} disagrees with the airports table (${fromTable ?? 'no shared metro'})` };
  }
  return { ok: true, metro: fromTable };
}

export interface RecordContext {
  plan: readonly PlannedCall[]; recorder: FixtureRecorder; recordedRoot: string;
  signal: AbortSignal; out(line: string): void;
}
export interface CallResult { id: string; status: number | string; expected: readonly number[]; ok: boolean; required: boolean; note: string }
export interface RecordSummary {
  executionId: string; results: CallResult[]; requiredOk: boolean; chainComplete: boolean; emptyEnvelope: boolean; induced429: boolean;
  duplicatesDeleted: number; allowlists: string[]; ledger: { searchapiCalls: number; travelpayoutsCalls: number };
}

type Sent = { ok: true; res: HttpKitResponse } | { ok: false; status: number | null; kind: string };

/** One request; BudgetExceeded and ProviderError become results, anything else propagates. */
async function send(http: HttpKit, req: HttpKitRequest): Promise<Sent> {
  try {
    return { ok: true, res: await http.request(req) };
  } catch (e) {
    if (e instanceof BudgetExceeded) return { ok: false, status: null, kind: `budget:${e.scope}` };
    if (e instanceof ProviderError) return { ok: false, status: e.httpStatus ?? null, kind: e.kind };
    throw e;
  }
}

/**
 * Burst limits: looser local limiter so a vendor 429 is reachable, and a 5 s max wait so a
 * Retry-After beyond it becomes limiter-timeout instead of a billed retry (spec §5.3 p-retry rule).
 */
export function burstLimits(base: Record<ProviderId | 'fx', ProviderHttpLimits>): Record<ProviderId | 'fx', ProviderHttpLimits> {
  return { ...base, searchapi: { ...base.searchapi, ratePerMinute: 60, ratePerHour: 60, concurrency: 1, maxWaitSeconds: 5 } };
}

function listResponseFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listResponseFiles(p));
    else if (name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-')) out.push(p);
  }
  return out;
}

function recordedStatus(path: string): number | null {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return typeof v === 'object' && v !== null && 'status' in v && typeof v.status === 'number' ? v.status : null;
}

/** Deletes the HTTP 200 files the burst added (and their raw siblings); keeps any 429. */
function removeBurstDuplicates(dir: string, before: ReadonlySet<string>): number {
  let n = 0;
  for (const p of listResponseFiles(dir)) {
    if (before.has(p) || recordedStatus(p) !== 200) continue;
    rmSync(p);
    rmSync(p.replace(/\.json$/, '.raw.json'), { force: true });
    n++;
  }
  return n;
}

/**
 * Runs the plan through the real http-kit + recorder + guard (spec §9 item 7). Every request is
 * cache 'never' so the vendor answers it, recordFixtures true so the recorder sees it, and carries
 * the recording execution's id so its snapshot caps (from --budget) apply.
 */
export async function recordFixtures(ports: Ports, a: RecordArgs, ctx: RecordContext): Promise<RecordSummary> {
  const executionId = openRecordingExecution(ports, a);
  try {
    return await runPlan(ports, ctx, executionId);
  } finally {
    // why: a recording execution must never look active to the engine's boot sweep or scheduler.
    ports.repos.executions.setStatus(executionId, ctx.signal.aborted ? 'cancelled' : 'completed', { finishedAt: ports.clock.now() });
  }
}

async function runPlan(ports: Ports, ctx: RecordContext, executionId: string): Promise<RecordSummary> {
  const tp = ports.config.providers.travelpayouts;
  const sa = ports.config.providers.searchapi;
  if (tp === null || sa === null) throw new Error('record:fixtures needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY');
  const gl = ports.config.pointOfSale.toLowerCase();
  const params = new ParamLog(paramRules(gl));
  const results: CallResult[] = [];
  const saDir = join(ctx.recordedRoot, 'searchapi');
  const burstKit = createHttpKit({
    budget: ports.budget, cache: ports.cache, limits: burstLimits(httpLimits(ports.config, false)),
    clock: ports.clock, log: ports.log, secrets: ports.secrets, recorder: ctx.recorder,
  });
  let cell: CellDates | null = null;
  let departureToken: string | null = null;
  let bookingToken: string | null = null;
  let chainComplete = false;
  let emptyEnvelope = false;
  let beforeBurst: Set<string> | null = null;
  let burstStopped = false;
  let tileIndex = 0;

  const request = (providerId: 'travelpayouts' | 'searchapi', url: URL, headers: Record<string, string>, tile: number | null): HttpKitRequest => ({
    providerId, executionId, tileIndex: tile, endpointPath: url.pathname, method: 'GET', url, headers,
    cache: 'never', signal: ctx.signal, recordFixtures: true,
  });
  const tpHeaders = (token: string): Record<string, string> => ({ 'X-Access-Token': token });
  const saHeaders = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });
  const push = (call: PlannedCall, id: string, r: Sent): void => {
    const status = r.ok ? r.res.status : (r.status ?? r.kind);
    const ok = typeof status === 'number' && call.expect.includes(status);
    results.push({ id, status, expected: call.expect, ok, required: call.spec.kind !== 'sa-burst', note: r.ok ? '' : r.kind });
    ctx.out(`${id} ${String(status)}${ok ? '' : ` (expected ${call.expect.join('/')})`}`);
  };
  const skip = (call: PlannedCall, why: string): void => {
    results.push({ id: call.id, status: 'skipped', expected: call.expect, ok: false, required: call.spec.kind !== 'sa-burst', note: why });
    ctx.out(`${call.id} skipped: ${why}`);
  };

  for (const call of ctx.plan) {
    if (ctx.signal.aborted) { skip(call, 'aborted'); continue; }
    const s = call.spec;
    switch (s.kind) {
      case 'tp-tile': {
        const tile = tileIndex++;
        for (let page = 1; ; page++) {
          const url = tpUrl(s.origin, s.destination, s.month, page);
          params.note('prices_for_dates', url.searchParams);
          const r = await send(ports.http, request('travelpayouts', url, tpHeaders(tp.token.reveal()), tile));
          push(call, page === 1 ? call.id : `${call.id}p${page}`, r);
          if (!r.ok) break;
          const rows = dataRowCount(r.res.body);
          if (s.purpose === 'empty-probe' && rows === 0) emptyEnvelope = true;
          if (rows < TP_PAGE_LIMIT) break;
        }
        break;
      }
      case 'tp-auth': {
        const url = tpUrl(s.origin, s.destination, s.month, 1);
        params.note('prices_for_dates', url.searchParams);
        push(call, call.id, await send(ports.http, request('travelpayouts', url, tpHeaders(INVALID_TRAVELPAYOUTS_TOKEN), null)));
        break;
      }
      case 'sa-calendar':
      case 'sa-over-limit': {
        const url = saUrl(calendarParams(s.origin, s.destination, s.rect, gl));
        params.note('google_flights_calendar', url.searchParams);
        const r = await send(ports.http, request('searchapi', url, saHeaders(sa.key.reveal()), tileIndex++));
        push(call, call.id, r);
        if (s.kind === 'sa-calendar' && r.ok) cell = cheapestCalendarCell(r.res.body);
        break;
      }
      case 'sa-step1':
      case 'sa-step2':
      case 'sa-step3': {
        if (cell === null) { skip(call, 'no priced cell in SA-01'); break; }
        const token =
          s.kind === 'sa-step1' ? {} : s.kind === 'sa-step2' ? (departureToken === null ? null : { departure_token: departureToken })
          : (bookingToken === null ? null : { booking_token: bookingToken });
        if (token === null) { skip(call, 'no priced option with a token in the previous step'); break; }
        const url = saUrl(flightsParams(s.origin, s.destination, cell, gl, token));
        params.note('google_flights', url.searchParams);
        const r = await send(ports.http, request('searchapi', url, saHeaders(sa.key.reveal()), null));
        push(call, call.id, r);
        if (!r.ok) break;
        if (s.kind === 'sa-step1') departureToken = cheapestOption(r.res.body, 'departure_token')?.token ?? null;
        if (s.kind === 'sa-step2') bookingToken = cheapestOption(r.res.body, 'booking_token')?.token ?? null;
        if (s.kind === 'sa-step3') chainComplete = bookingOptionCount(r.res.body) > 0;
        break;
      }
      case 'sa-auth': {
        const url = saUrl(flightsParams(s.origin, s.destination, s.cell, gl, {}));
        params.note('google_flights', url.searchParams);
        push(call, call.id, await send(ports.http, request('searchapi', url, saHeaders(INVALID_SEARCHAPI_KEY), null)));
        break;
      }
      case 'sa-burst': {
        if (burstStopped) { skip(call, 'burst stopped at the first non-200'); break; }
        beforeBurst ??= new Set(listResponseFiles(saDir));
        const url = saUrl(calendarParams(s.origin, s.destination, s.rect, gl));
        params.note('google_flights_calendar', url.searchParams);
        const r = await send(burstKit, request('searchapi', url, saHeaders(sa.key.reveal()), null));
        push(call, call.id, r);
        if (!r.ok) burstStopped = true;
        break;
      }
      default: {
        const unhandled: never = s;
        throw new Error(`unhandled call ${JSON.stringify(unhandled)}`);
      }
    }
  }

  const duplicatesDeleted = beforeBurst === null ? 0 : removeBurstDuplicates(saDir, beforeBurst);
  const induced429 = listResponseFiles(saDir).some((p) => recordedStatus(p) === 429);
  const now = ports.clock.now();
  const date = now.slice(0, 10);
  const allowlists = [
    writeAllowlist(ctx.recordedRoot, params.document('travelpayouts', now, RECORDED_BY), date),
    writeAllowlist(ctx.recordedRoot, params.document('searchapi', now, RECORDED_BY), date),
  ];
  return {
    executionId,
    results,
    requiredOk: chainComplete && results.filter((r) => r.required).every((r) => r.ok),
    chainComplete, emptyEnvelope, induced429, duplicatesDeleted, allowlists,
    ledger: {
      searchapiCalls: ports.budget.usage({ kind: 'execution-calls', executionId }).calls,
      travelpayoutsCalls: ports.budget.usage({ kind: 'execution-free-calls', executionId }).calls,
    },
  };
}

/** Human summary printed after a run. */
export function formatSummary(s: RecordSummary, a: RecordArgs): string[] {
  return [
    `required calls: ${s.requiredOk ? 'all as expected' : 'NOT all as expected (see lines above)'}`,
    `chain step 1 → 2 → 3: ${s.chainComplete ? 'complete' : 'incomplete'}`,
    `empty envelope recorded: ${s.emptyEnvelope ? 'yes' : 'no (WP6 needs one: raise a finding)'}`,
    `429 induced: ${s.induced429 ? 'yes' : 'no (best-effort; spec §2 fact 5 stands)'}`,
    `burst duplicates deleted: ${s.duplicatesDeleted}`,
    `ledger: SearchApi ${s.ledger.searchapiCalls} of budget ${a.budget}; Travelpayouts ${s.ledger.travelpayoutsCalls} of free budget ${a.freeBudget}`,
    ...s.allowlists.map((p) => `allowlist: ${p}`),
    'next: read SearchApi dashboard credits; run the manual review checklist (brief section 10, Task 11) before git add',
  ];
}

async function runRecord(ports: Ports, a: RecordArgs, ctx: ToolContext): Promise<number> {
  const metro = resolveMetro(ports.repos.airports, a);
  if (!metro.ok) { ctx.err(metro.message); return 5; }
  const plan = planCalls(a, metro.metro);
  for (const line of formatPlan(plan)) ctx.out(line);
  if (a.dryRun) return 0;
  if (ctx.recorder === null) throw new Error('a recording run needs the recorder');
  const summary = await recordFixtures(ports, a, {
    plan, recorder: ctx.recorder, recordedRoot: ctx.recordedRoot, signal: ctx.signal, out: ctx.out,
  });
  for (const line of formatSummary(summary, a)) ctx.out(line);
  return summary.requiredOk ? 0 : 1;
}

/** Registry entry for `record` (spec §7 tool bootstrap). */
export const recordTool: ToolEntry = {
  start(argv) {
    const parsed = parseRecordArgs(argv);
    if (!parsed.ok) return parsed;
    const a = parsed.args;
    const started: StartedTool = {
      ok: true,
      recordedBy: a.dryRun ? null : RECORDED_BY,
      configure: (c) => c,
      precheck: (c) =>
        c.providers.travelpayouts === null || c.providers.searchapi === null
          ? 'record:fixtures needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY in the environment (.env)'
          : null,
      run: (ports, ctx) => runRecord(ports, a, ctx),
    };
    return started;
  },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/tools/record.msw.test.ts`
Expected: 3 passed. Two failures mean a pinned assumption is broken, so raise a finding:

- a 400 or 401 file missing: assumption 2;
- the budget test reaching the step-2 handler: assumption 3.

- [ ] **Step 5: Commit**

```bash
git add apps/api pnpm-lock.yaml && git commit -m "wp04b: record:fixtures run through the real http-kit, recorder and guard"
```

### Task 7: Tool bootstrap (in-process)

**Files:** create `apps/api/src/bootstrap/tool.ts`, `apps/api/test/bootstrap/tool.test.ts`.

**Interfaces:** consumes `AppLock`, `createRecorder`, `buildPorts`, `loadConfigFromEnv`, `collectSecrets`, `createLogger`, `recordTool`, `ToolEntry`. Produces `EXIT`, `TOOLS`, `runTool`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/bootstrap/tool.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, openDatabase } from '@gmt/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT, runTool } from '../../src/bootstrap/tool.js';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { SENTINEL_SA, SENTINEL_TP, cleanEnv, silentLog } from '../helpers/env.js';

const DRY = ['--budget', '12', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--metro', 'LON', '--dry-run'];
let dbPath = '';
let out: string[] = [];
let errs: string[] = [];

function stubEnv(overrides: Record<string, string>): void {
  for (const [k, v] of Object.entries(cleanEnv(overrides))) vi.stubEnv(k, v);
}

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-tool-')), 'tool.db');
  out = [];
  errs = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { errs.push(String(s)); return true; });
  stubEnv({ NODE_ENV: 'development', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1', TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA, LOG_LEVEL: 'error' });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function holdLock(holder: 'app' | 'tool', at: 'now' | 'stale'): void {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = at === 'now' ? systemClock : fixedClock(asIsoDateTime(new Date(Date.now() - 10 * 60_000).toISOString()));
  expect(new AppLock(db, holder, clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
}

describe('runTool (spec §5.5, §7 app_lock tool holder)', () => {
  it('refuses NODE_ENV=test before opening anything', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(await runTool('record', DRY)).toBe(EXIT.refusedTestEnv);
    expect(errs.join('')).toContain('tool bootstrap refuses NODE_ENV=test');
  });

  it('rejects an unknown tool and a missing budget with the usage exit code', async () => {
    expect(await runTool('smoke', [])).toBe(EXIT.usage);
    expect(errs.join('')).toContain('registered: record');
    expect(await runTool('record', ['--route', 'LHR:JFK', '--month', '2027-03'])).toBe(EXIT.usage);
    expect(errs.join('')).toContain('--budget is required');
  });

  it('reports invalid configuration without echoing values', async () => {
    vi.stubEnv('BIND_ADDRESS', '0.0.0.0');
    expect(await runTool('record', DRY)).toBe(EXIT.badConfig);
    expect(errs.join('')).toContain('invalid configuration');
    expect(errs.join('')).not.toContain(SENTINEL_SA);
  });

  it('refuses when a provider credential is missing', async () => {
    vi.stubEnv('SEARCHAPI_KEY', '');
    expect(await runTool('record', DRY)).toBe(EXIT.usage);
    expect(errs.join('')).toContain('needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY');
  });

  it('refuses while a fresh app lock exists', async () => {
    holdLock('app', 'now');
    expect(await runTool('record', DRY)).toBe(EXIT.lockRefused);
    expect(errs.join('')).toContain('app_lock is held by app');
  });

  it('acquires the tool lock, prints the plan, issues no request and releases the lock', async () => {
    expect(await runTool('record', DRY)).toBe(EXIT.ok);
    const text = out.join('');
    expect(text).toContain('tool lock acquired');
    expect(text).toContain('total: SearchApi ≤12 credits, Travelpayouts 20 free calls');
    expect(text).toContain('tool lock released');
    expect(text).not.toContain(SENTINEL_SA);
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)).toBeNull();
    const ledgerRows = db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get();
    expect(ledgerRows).toEqual({ n: 0 });
    db.close();
  });

  it('takes over a stale app lock', async () => {
    holdLock('app', 'stale');
    expect(await runTool('record', DRY)).toBe(EXIT.ok);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/bootstrap/tool.test.ts`
Expected: FAIL, `../../src/bootstrap/tool.js` not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/bootstrap/tool.ts
/**
 * The tool bootstrap (spec §7 SQLite settings, §7 app_lock, §5.5, §9 item 7): the second entrypoint
 * in apps/api. It reuses the config parse and port wiring, opens the same DB, uses the production
 * ledger, never constructs or boots the engine (no sweep, no auto-resume, no cron), and holds
 * app_lock as 'tool' for its whole run. This is one of the two files allowed to read process.env.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type Config, systemClock } from '@gmt/core';
import { AppLock } from '@gmt/db';
import { createRecorder } from '@gmt/providers';
import { createLogger } from '../logger.js';
import { MIGRATIONS_DIR, RECORDED_ROOT } from '../paths.js';
import { recordTool } from '../tools/record.js';
import type { ToolEntry } from '../tools/types.js';
import { ConfigError, buildPorts, collectSecrets, loadConfigFromEnv } from '../wiring.js';

/** Process exit codes of the tool bootstrap. */
export const EXIT = { ok: 0, failed: 1, refusedTestEnv: 2, badConfig: 3, lockRefused: 4, usage: 5 } as const;

/** Registered tools. WP13 adds `smoke`. */
export const TOOLS: Readonly<Record<string, ToolEntry>> = { record: recordTool };

/** Spec §7: heartbeat every 30 s; stale after 3 missed beats. */
const HEARTBEAT_MS = 30_000;

/** Runs one tool and returns its exit code. Refuses NODE_ENV=test first (spec §5.5). */
export async function runTool(name: string, args: readonly string[]): Promise<number> {
  const out = (line: string): void => { process.stdout.write(`${line}\n`); };
  const err = (line: string): void => { process.stderr.write(`${line}\n`); };
  if (process.env.NODE_ENV === 'test') {
    err('tool bootstrap refuses NODE_ENV=test (spec §5.5)');
    return EXIT.refusedTestEnv;
  }
  const entry = TOOLS[name];
  if (entry === undefined) {
    err(`unknown tool "${name}"; registered: ${Object.keys(TOOLS).join(', ')}`);
    return EXIT.usage;
  }
  const started = entry.start(args);
  if (!started.ok) { err(started.message); return EXIT.usage; }
  let config: Config;
  try {
    config = started.configure(loadConfigFromEnv(process.env));
  } catch (e) {
    if (e instanceof ConfigError) { err(e.message); return EXIT.badConfig; }
    throw e;
  }
  const refusal = started.precheck(config);
  if (refusal !== null) { err(refusal); return EXIT.usage; }

  const log = createLogger(config.logLevel).child({ tool: name });
  const recorder = started.recordedBy === null
    ? undefined
    : createRecorder({ root: RECORDED_ROOT, secrets: collectSecrets(config), clock: systemClock, recordedBy: started.recordedBy });
  out(`database: ${config.databasePath}`);
  const ports = buildPorts(config, { log, migrationsDir: MIGRATIONS_DIR, ...(recorder !== undefined ? { recorder } : {}) });
  try {
    const lock = new AppLock(ports.db, 'tool', ports.clock, log);
    // why: waitMs 0 — a tool never queues behind the app; the operator uses POST /tools/* instead (spec §7).
    if (lock.acquire({ waitMs: 0 }) === 'refused') {
      const held = AppLock.inspect(ports.db);
      err(`app_lock is held by ${held?.holder ?? 'another process'} (heartbeat ${held?.heartbeatAt ?? 'unknown'}); stop the app or use POST /tools/${name} while it runs (spec §7)`);
      return EXIT.lockRefused;
    }
    out('tool lock acquired');
    const beat = setInterval(() => lock.heartbeat(), HEARTBEAT_MS);
    beat.unref();
    const ac = new AbortController();
    const onSignal = (): void => ac.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      return await started.run(ports, { recorder: recorder ?? null, recordedRoot: RECORDED_ROOT, signal: ac.signal, out, err });
    } finally {
      clearInterval(beat);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      lock.release();
      out('tool lock released');
    }
  } finally {
    ports.db.close();
  }
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

// why: run only when executed directly, so tests import runTool without side effects.
if (isEntryPoint()) {
  const [name = '', ...rest] = process.argv.slice(2);
  runTool(name, rest).then(
    (code) => { process.exitCode = code; },
    (e: unknown) => {
      // ProviderError and core errors carry no URL or secret (plan "Errors"); config values never reach here.
      process.stderr.write(`tool failed: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = EXIT.failed;
    },
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/bootstrap/tool.test.ts`
Expected: 7 passed. If "takes over a stale app lock" fails, WP3's `AppLock` does not treat a heartbeat older than three beats as stale. That is a WP3 bug against spec §7; raise it.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: tool bootstrap with NODE_ENV=test refusal and app_lock tool holder"
```

### Task 8: Tool bootstrap entry, spawned

**Files:** modify `apps/api/package.json`; create `apps/api/test/bootstrap/tool.spawn.test.ts`.

**Interfaces:** consumes the real entry `src/bootstrap/tool.ts`. Produces the `tool` script that the root's `record:fixtures` and `smoke:live` call.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/bootstrap/tool.spawn.test.ts
// Spawns the real entry the way `pnpm record:fixtures` does (node --import tsx), with an env built
// from scratch: no inherited secrets, no .env file.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { SENTINEL_SA, SENTINEL_TP, cleanEnv, silentLog } from '../helpers/env.js';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DRY = ['--budget', '12', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--metro', 'LON', '--dry-run'];

function spawnTool(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/bootstrap/tool.ts', 'record', ...DRY], {
    cwd: API_ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function freshDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'gmt-spawn-')), 'tool.db');
}

function devEnv(dbPath: string, nodeEnv = 'development'): Record<string, string> {
  return cleanEnv({ NODE_ENV: nodeEnv, DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1', TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA, LOG_LEVEL: 'error' });
}

function holdAppLock(dbPath: string, stale: boolean): void {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = stale ? fixedClock(asIsoDateTime(new Date(Date.now() - 10 * 60_000).toISOString())) : systemClock;
  expect(new AppLock(db, 'app', clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
}

describe('tool bootstrap as a real process (spec §5.5, §7)', () => {
  it('NODE_ENV=test → exit 2, nothing opened', () => {
    const dbPath = freshDbPath();
    const r = spawnTool(devEnv(dbPath, 'test'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('tool bootstrap refuses NODE_ENV=test');
    expect(existsSync(dbPath)).toBe(false);
  }, 60_000);

  it('a fresh app lock → exit 4, lock untouched', () => {
    const dbPath = freshDbPath();
    holdAppLock(dbPath, false);
    const r = spawnTool(devEnv(dbPath));
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('app_lock is held by app');
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)?.holder).toBe('app');
    db.close();
  }, 60_000);

  it('otherwise acquires the tool lock, prints the plan and releases the lock', () => {
    const dbPath = freshDbPath();
    const r = spawnTool(devEnv(dbPath));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('tool lock acquired');
    expect(r.stdout).toContain('SA-14');
    expect(r.stdout).toContain('tool lock released');
    expect(`${r.stdout}${r.stderr}`).not.toContain(SENTINEL_SA);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SENTINEL_TP);
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)).toBeNull();
    db.close();
  }, 60_000);

  it('a stale app lock is taken over', () => {
    const dbPath = freshDbPath();
    holdAppLock(dbPath, true);
    expect(spawnTool(devEnv(dbPath)).status).toBe(0);
  }, 60_000);

  it('the package script loads the operator .env only through Node and runs this entry', () => {
    const pkg: unknown = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({ scripts: { tool: 'node --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- test/bootstrap/tool.spawn.test.ts`
Expected: the four spawn tests pass (the entry exists since Task 7). The script test FAILS: `scripts.tool` does not match. If any spawn test fails instead, the entry-point guard does not fire under `node --import tsx`; fix `isEntryPoint` before going on.

- [ ] **Step 3: Implement**

In `apps/api/package.json`, set the `tool` script:

```json
{
  "scripts": {
    "tool": "node --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts"
  }
}
```

Merge the key into the existing file; do not drop the WP0 scripts.

`// why:` (record it in the PR description; JSON has no comments) The root scripts are `"record:fixtures": "pnpm --filter @gmt/api tool record"` and `"smoke:live": "pnpm --filter @gmt/api tool smoke"`, so pnpm appends the operator's arguments after `record`. Node loads `.env` into `process.env`, where existing variables win. `loadConfigFromEnv` is the only reader. The spawn test calls `node --import tsx` directly so that no test ever loads the real `.env`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/bootstrap/tool.spawn.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: tool script and spawned-bootstrap tests"
```

### Task 9: Parameter allowlist shape

**Files:** create `apps/api/test/tools/allowlist.test.ts`.

**Interfaces:** consumes `ParamsAllowlist`, `runMswRecording`, `listRecordedFiles`, `verifyRecordedFile`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tools/allowlist.test.ts
// Spec §5.2: the dated allowlist enumerates parameter names AND values; tests assert both.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listRecordedFiles, verifyRecordedFile } from '../../../../packages/providers/test/helpers/recordedTree.js';
import { runMswRecording } from '../helpers/mswVendors.js';
import { writeAllowlist } from '../../src/tools/recordParams.js';

const KINDS: Record<string, RegExp> = { iata: /^[A-Z]{3}$/, 'iso-date': /^\d{4}-\d{2}-\d{2}$/, 'iso-month': /^\d{4}-\d{2}$/, 'positive-int': /^[1-9]\d*$/ };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Asserts one allowlist document and its consistency with that provider's recorded requests. */
function checkAllowlist(root: string, provider: 'travelpayouts' | 'searchapi'): void {
  const dir = join(root, provider);
  const names = readdirSync(dir).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  expect(names.length).toBeGreaterThanOrEqual(1);
  for (const name of names) {
    const text = readFileSync(join(dir, name), 'utf8');
    expect(text).not.toMatch(/X-Access-Token|Authorization|api_key|"token"/i);
    const doc: unknown = JSON.parse(text);
    if (!isRecord(doc) || !Array.isArray(doc.endpoints)) throw new Error(`${name}: bad shape`);
    expect(doc).toMatchObject({ provider, credential: 'header', recordedBy: '@gmt/api record:fixtures' });
    expect(String(doc.recordedAt).slice(0, 10)).toBe(name.slice(7, 17));
    const allowed = new Map<string, Record<string, unknown>>();
    for (const ep of doc.endpoints) {
      if (!isRecord(ep) || !isRecord(ep.params) || typeof ep.key !== 'string') throw new Error(`${name}: bad endpoint`);
      expect(ep.method).toBe('GET');
      for (const [param, rule] of Object.entries(ep.params)) {
        if (!isRecord(rule) || !Array.isArray(rule.observed)) throw new Error(`${name}: ${param} has no observed list`);
        const observed = rule.observed.map(String);
        expect(observed).toEqual([...observed].sort());
        if (Array.isArray(rule.fixed)) {
          for (const v of observed) expect(rule.fixed).toContain(v);
        } else if (rule.kind === 'opaque-token') {
          expect(observed).toEqual([]);
        } else {
          const re = KINDS[String(rule.kind)];
          if (re === undefined) throw new Error(`${name}: ${param} has unknown kind ${String(rule.kind)}`);
          for (const v of observed) expect(v).toMatch(re);
        }
      }
      allowed.set(ep.key, ep.params);
    }
    // every parameter of every recorded request is listed, with its value observed (or a placeholder token)
    for (const path of listRecordedFiles(dir)) {
      const v = verifyRecordedFile(path);
      if (!v.ok) throw new Error(`${path}: ${v.reason}`);
      const key = provider === 'travelpayouts' ? 'prices_for_dates' : v.file.request.params.engine;
      const table = allowed.get(String(key));
      expect(table, `${path} endpoint ${String(key)}`).toBeDefined();
      for (const [param, value] of Object.entries(v.file.request.params)) {
        const rule = table?.[param];
        expect(rule, `${path} param ${param}`).toBeDefined();
        if (isRecord(rule) && rule.kind === 'opaque-token') expect(value).toMatch(new RegExp(`^<${param}:\\d+>$`));
        else if (isRecord(rule) && Array.isArray(rule.observed)) expect(rule.observed).toContain(value);
      }
    }
  }
}

describe('parameter allowlist files (spec §5.2)', () => {
  it('the msw recording writes allowlists consistent with every recorded request', async () => {
    const run = await runMswRecording({ rateLimitAfter: 3 });
    try {
      checkAllowlist(run.recordedRoot, 'travelpayouts');
      checkAllowlist(run.recordedRoot, 'searchapi');
    } finally {
      run.ports.db.close();
    }
  });

  it('refuses to write outside fixtures/recorded', () => {
    expect(() => writeAllowlist('/tmp/elsewhere', { provider: 'searchapi', recordedAt: '', recordedBy: '', credential: 'header', endpoints: [] }, '2026-10-20'))
      .toThrow('refusing to write outside fixtures/recorded/');
  });

  it('the committed allowlists hold the same invariants (skipped until Task 11 commits them)', () => {
    const root = fileURLToPath(new URL('../../../../packages/providers/fixtures/recorded/', import.meta.url));
    const committed = listRecordedFiles(root);
    if (committed.length === 0) return;   // why: before the live run the tree is empty; Task 11's manifest test makes emptiness fail
    checkAllowlist(root, 'travelpayouts');
    checkAllowlist(root, 'searchapi');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The allowlist writer exists since Task 6, so this test is expected to pass on first run. Prove it is not vacuous instead: temporarily change `paramRules`' `currency` rule for `prices_for_dates` to `{ fixed: ['GBP'] }`, then run:

`pnpm --filter @gmt/api test -- test/tools/allowlist.test.ts`

Expected: FAIL in `ParamLog.note` ("currency=gbp is not an allowed value"). Revert the change.

- [ ] **Step 3: Implement** — no production change; the test is the deliverable.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/tools/allowlist.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp04b: parameter allowlist shape and consistency test"
```

### Task 10: Sentinel secret scan and the raw-body ignore rule

**Files:** create `apps/api/test/security/sentinel.test.ts`.

**Interfaces:** consumes `scripts/secret-scan.mjs`, `runMswRecording`, `git check-ignore`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/security/sentinel.test.ts
// Spec §5.3: "the sentinel-key test … asserts none appears in any … fixture file"; CI runs the same
// scan over fixtures/. The scan is run with the sentinels in its env, over (a) the committed tree,
// (b) a tree just recorded through the real recorder with sentinel keys, (c) a planted copy.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runMswRecording } from '../helpers/mswVendors.js';
import { SENTINEL_SA, SENTINEL_SMTP, SENTINEL_TP } from '../helpers/env.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN = join(REPO, 'scripts', 'secret-scan.mjs');
const SENTINEL_ENV = { PATH: process.env.PATH ?? '', SEARCHAPI_KEY: SENTINEL_SA, TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SMTP_PASS: SENTINEL_SMTP, APP_BASIC_AUTH_PASS: 'test-basic-auth-pass-0123' };

function scan(cwd: string) {
  return spawnSync(process.execPath, [SCAN], { cwd, env: SENTINEL_ENV, encoding: 'utf8', timeout: 30_000 });
}

describe('no key reaches any committed or recorded file (spec §5.3 sentinel test)', () => {
  it('the committed fixture tree is clean under the sentinel scan', () => {
    const r = scan(REPO);
    expect(r.stdout).toContain('secret scan: clean');
    expect(r.status).toBe(0);
  });

  it('a tree recorded with sentinel keys is clean, and planting a sentinel makes the scan fail', async () => {
    const run = await runMswRecording({ rateLimitAfter: 3 });
    try {
      const clean = scan(run.repoLike);
      expect(clean.status).toBe(0);
      const plantDir = join(run.recordedRoot, 'planted');
      mkdirSync(plantDir, { recursive: true });
      writeFileSync(join(plantDir, 'p.json'), JSON.stringify({ leaked: SENTINEL_SA }));
      const dirty = scan(run.repoLike);
      expect(dirty.status).toBe(1);
      expect(dirty.stderr).toContain('secret value found');
      expect(dirty.stderr).not.toContain(SENTINEL_SA);
    } finally {
      run.ports.db.close();
    }
  });

  it('raw bodies are ignored by git and redacted files are not', () => {
    const base = 'packages/providers/fixtures/recorded/searchapi/api_v1_search/2026-10-20-0123456789ab';
    const ignored = (p: string) => spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO }).status;
    expect(ignored(`${base}.raw.json`)).toBe(0);
    expect(ignored(`${base}.json`)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The scan script and the gitignore rule already exist, so this test passes on first run. Prove the plant branch is not vacuous: temporarily change `'secret value found'` to `'secret value found!'` in the test and run:

`pnpm --filter @gmt/api test -- test/security/sentinel.test.ts`

Expected: FAIL on that assertion. Revert. If the first test fails, a committed file leaks; stop and fix the recorder (WP4), never the scan.

- [ ] **Step 3: Implement** — no production change.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- test/security/sentinel.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp04b: sentinel secret scan over recorded trees and raw-body ignore rule"
```

### Task 11: Live recording on the example route, manual review and the committed-tree test

**Files:** create `packages/providers/test/fixtures/recorded-manifest.test.ts`; create `packages/providers/fixtures/recorded/**` (by the run).

**Interfaces:** consumes the `record:fixtures` tool and the Task 1 helpers. Produces the committed recorded tree and the two allowlists that WP5 and WP6 replay.

- [ ] **Step 1: Write the failing test**

```ts
// packages/providers/test/fixtures/recorded-manifest.test.ts
// The committed tree holds what WP5, WP6 and WP13 replay (brief WP4b section 7). Worked example only.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type RecordedFile, listRecordedFiles, verifyRecordedFile } from '../helpers/recordedTree.js';

const ROOT = fileURLToPath(new URL('../../fixtures/recorded/', import.meta.url));

function load(): RecordedFile[] {
  return listRecordedFiles(ROOT).map((p) => {
    const v = verifyRecordedFile(p);
    if (!v.ok) throw new Error(`${p}: ${v.reason}`);
    return v.file;
  });
}

describe('committed recorded tree for the worked example', () => {
  const files = load();
  const tp = files.filter((f) => f.providerId === 'travelpayouts');
  const sa = files.filter((f) => f.providerId === 'searchapi');
  const p = (f: RecordedFile, k: string) => f.request.params[k];

  it('Travelpayouts: 14 metro tiles over 7 months, 4 airport tiles, a 401 body', () => {
    const metroMonths = new Set(tp.filter((f) => f.status === 200 && p(f, 'origin') === 'LON' && p(f, 'page') === '1').map((f) => `${p(f, 'destination')}|${p(f, 'departure_at')}`));
    expect(metroMonths.size).toBeGreaterThanOrEqual(14);
    for (const o of ['LHR', 'LGW']) for (const d of ['JFK', 'EWR']) {
      expect(tp.some((f) => f.status === 200 && p(f, 'origin') === o && p(f, 'destination') === d), `${o}→${d}`).toBe(true);
    }
    expect(tp.some((f) => f.status === 401)).toBe(true);
    for (const f of tp) expect(p(f, 'currency')).toBe('gbp');
  });

  it('SearchApi: one calendar ≤200, the over-limit response, the 401 body', () => {
    const cal = sa.filter((f) => p(f, 'engine') === 'google_flights_calendar');
    expect(cal.filter((f) => f.status === 200)).toHaveLength(1);
    expect(cal.some((f) => f.status !== 200 && p(f, 'outbound_date_end') === '2027-03-09')).toBe(true);   // SA-02, 400 or empty per vendor
    expect(sa.some((f) => f.status === 401)).toBe(true);
  });

  it('SearchApi chain: step 1 → 2 → 3 with placeholders consistent across files (chains replay)', () => {
    const flights = sa.filter((f) => p(f, 'engine') === 'google_flights' && f.status === 200);
    const step1 = flights.find((f) => p(f, 'departure_token') === undefined && p(f, 'booking_token') === undefined);
    const step2 = flights.find((f) => p(f, 'departure_token') !== undefined);
    const step3 = flights.find((f) => p(f, 'booking_token') !== undefined);
    expect(step1 && step2 && step3).toBeTruthy();
    if (!step1 || !step2 || !step3) return;
    expect(p(step2, 'departure_token')).toMatch(/^<departure_token:\d+>$/);
    expect(p(step3, 'booking_token')).toMatch(/^<booking_token:\d+>$/);
    expect(JSON.stringify(step1.body)).toContain(String(p(step2, 'departure_token')));
    expect(JSON.stringify(step2.body)).toContain(String(p(step3, 'booking_token')));
  });

  it('both dated allowlists are committed', () => {
    for (const provider of ['travelpayouts', 'searchapi']) {
      expect(readdirSync(join(ROOT, provider)).some((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n)), provider).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers test -- test/fixtures/recorded-manifest.test.ts`
Expected: FAIL, the tree is empty (`readdirSync` ENOENT or the size assertions).

- [ ] **Step 3: Implement — the live run**

These steps spend real credits; follow them in order.

1. **Preconditions.** WP3 and WP4 are merged. Tasks 1–10 are green on this branch. The app is not running (`app_lock` free). The operator's `.env` at the repository root defines `TRAVELPAYOUTS_TOKEN` and `SEARCHAPI_KEY`. Do not open, print or grep `.env`. Read the SearchApi dashboard's "Remaining free searches (credits)" (expected 91) and write it down.

2. **Dry run.** Print and check the plan:

   ```bash
   DATABASE_PATH="$PWD/data/dev.db" SEARCHAPI_TRIAL_USED=9 pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run
   ```

   Expected: `tool lock acquired`, 34 call lines identical to section 7, then `total: SearchApi ≤12 credits, Travelpayouts 20 free calls …`, then `tool lock released`, exit 0. If the airports table is empty, add `--metro LON`. If the table is populated and disagrees, the run refuses: stop and investigate.

   `SEARCHAPI_TRIAL_USED=9` applies to the `trial` plan only. If the operator has already moved to `SEARCHAPI_PLAN=40usd`, omit it. The 12 calls then come out of the monthly 10,000.

3. **Live run.** The same command without `--dry-run`. It takes several minutes: calendar calls take 9–29 s each, and the trial limiter allows 2 per minute.

   ```bash
   DATABASE_PATH="$PWD/data/dev.db" SEARCHAPI_TRIAL_USED=9 pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03
   ```

   Expected:
   - every TP line shows 200 except TP-20 at 401;
   - SA-01, SA-03, SA-04 and SA-05 show 200; SA-02 shows 400; SA-06 shows 401;
   - the burst lines show 200 or 429, then `skipped` after the first non-200;
   - `required calls: all as expected`, `chain step 1 → 2 → 3: complete`;
   - the ledger line shows SearchApi ≤ 12 and Travelpayouts ≥ 20; exit 0.

   If SA-02 returns something other than 400 (the docs say "an empty response"), the line shows the actual status and `required calls` reports it. Do not re-run. Record the actual behaviour in the PR. WP5 maps from the recorded file, and the manifest test accepts any non-200 or empty-grid response for SA-02.

4. **Dashboard.** Read the remaining credits again. The difference must be ≤ 12. Record both readings and the difference in the PR description; spec §2 fact 4 says the ledger may overcount but never undercount.

5. **Manual review of every recorded file before `git add`.** List the files with `git status --porcelain packages/providers/fixtures`. No `.raw.json` may appear; if one does, the ignore rule is broken, so stop. Then open each `.json` file under `fixtures/recorded/` and check each item:
   - [ ] No API key or token value. Run `node --env-file=.env scripts/secret-scan.mjs`: Node loads the real values into the scan's environment without printing them. Expect `secret scan: clean`.
   - [ ] No `search_metadata` URL fields (`request_url`, `json_endpoint`, `html_url`, or any `https://www.searchapi.io/…?…` string).
   - [ ] No query string anywhere in `request.url`; `request.params` has no `api_key` or `token`.
   - [ ] Every `departure_token` and `booking_token`, in request params and in bodies, has the form `<departure_token:n>` / `<booking_token:n>`, and the step-2 and step-3 request placeholders appear in the previous step's body.
   - [ ] No personal data: no operator name, email or account id, and no location other than the worked example's airports and the carriers' own data.
   - [ ] `recordedBy` is `@gmt/api record:fixtures`. `pnpm --filter @gmt/providers test -- test/fixtures` passes, so every hash verifies.
   - [ ] Booking URLs in step-3 bodies are `https://www.google.com/…` (spec §5.2 link allowlist). Any other host is noted in the PR for WP5.
   - [ ] File count matches the run: 20 Travelpayouts (+ pages), 6 SearchApi (+ any 429).

   If any item fails, delete the offending file and its `.raw.json` and fix the recorder in a WP4 follow-up. Do not hand-edit a recorded file: the hash test fails on any edit, by design.

6. **Committed tree for the worked example** after the run (date = the run's date):

   ```
   packages/providers/fixtures/recorded/
   ├── travelpayouts/
   │   ├── params-<date>.json
   │   └── aviasales_v3_prices_for_dates/
   │       └── <date>-<sha12>.json          × 20 (TP-01…TP-20; one more per extra page)
   └── searchapi/
       ├── params-<date>.json
       └── api_v1_search/
           └── <date>-<sha12>.json          × 6 (SA-01…SA-06) + 1 if a 429 was induced
   (every <date>-<sha12>.raw.json sibling stays on disk, gitignored, never committed)
   ```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers test -- test/fixtures` and `pnpm --filter @gmt/api test` and `pnpm secret-scan`
Expected: providers fixture tests (Task 1 and this task) all pass. The api suite passes, including the committed-allowlist test in Task 9 now that it has files to check. `secret scan: clean`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/fixtures/recorded packages/providers/test && git commit -m "wp04b: recorded fixtures for the worked example and committed-tree test"
```

The PR description carries:
- the dashboard readings before and after;
- the run summary lines;
- whether a 429 was induced and whether TP-19 was empty;
- SA-02's actual status;

## 11. Pinned review-focus tests

None. The plan's five Review Focus lines are owned by WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10. WP4b owns none.

## 12. Definition of done

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/api test` | all tests pass; coverage for `apps/api` over the files that exist (`wiring.ts`, `paths.ts`, `logger.ts`, `bootstrap/tool.ts`, `tools/*.ts`) ≥ 85 % lines, 70 % branches, 85 % functions, 85 % statements |
| `pnpm --filter @gmt/providers test` | passes, including `test/fixtures/recorded-tree.test.ts` and `recorded-manifest.test.ts`; the WP4 thresholds still hold (85/70) |
| `pnpm lint` | clean |
| `pnpm -r typecheck` | clean |
| `node scripts/check-boundaries.mjs` | exit 0 (`process.env` appears only in `apps/api/src/bootstrap/tool.ts`) |
| `pnpm secret-scan` | `secret scan: clean` |
| `node --env-file=.env scripts/secret-scan.mjs` (operator machine) | `secret scan: clean` with the real values loaded |
| `git ls-files packages/providers/fixtures \| grep -c raw.json` | `0` |
| `DATABASE_PATH="$PWD/data/dev.db" pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run` | exit 0, 34 call lines and the total line of section 7 |
| `pnpm record:fixtures --route LHR:JFK --month 2027-03` | exit 5, `--budget is required` |
| SearchApi dashboard | credits spent by the run ≤ 12, recorded in the PR |
| `grep -rnE "LHR\|LGW\|JFK\|EWR\|LON\|NYC" apps/api/src` | no output (airports only in tests, docs and fixtures) |

## 13. Open questions

None blocking. Every mismatch found while writing this brief is resolved in the brief and reported to Fable for the plan:

1. `Ports.repos: Repos` refers to an `@gmt/engine` type that does not exist until WP7. The brief declares a structurally identical `Repos` in `wiring.ts`, and WP8 swaps in the import.
2. The plan's `buildPorts` comment ("constructs guard/cache/http/providers") cannot include the adapters at WP4b. The fixture provider is built here; WP8 adds the adapters.
3. The plan gives neither `BudgetConfig`'s shape nor where the guard reads execution caps. The WP3 brief (draft) reads the caps from the execution's snapshot and gives `provider_requests.execution_id` a foreign key, so `record.ts` creates a disabled, soft-deleted definition and a real execution (assumption 3). WP7 must make sure its boot sweep never resumes an execution whose definition is soft-deleted, in case a recording run crashes while `running`.
4. The recorded-file JSON format is not pinned in the spec or plan. This brief follows the WP4 brief (draft): `contentSha256`, endpoint directories `api_v1_search` / `aviasales_v3_prices_for_dates`, `request.body`. The plan's file map should carry it.
5. SearchApi's docs say the calendar's `outbound_date`/`return_date` are required, and that >200 combinations returns an empty response. The spike measured 400. SA-02 settles it on the public route.
6. The plan's self-review assigns §9 item 7 to WP13; spec §16 gives `record:fixtures` to WP4b. The spec wins, and this brief owns it.
7. Nothing seeds the airports table before WP8's app bootstrap, so the tool accepts `--metro`, cross-checked against the table when the table is populated.
8. `.gitignore` lists `*.db`, `*.db-wal` and `*.db-shm` rather than the spec's `*.db*`, and lacks `backups/` (spec §5.3, §13). This is outside WP4b; it is reported for WP12.
9. The brief request gave one `--month` and "about 20" free Travelpayouts calls. The plan here reaches 20 by recording 7 metro months from `--month` (the worked example's full scan, spec §5.2), 4 airport tiles, an empty-envelope probe and a 401 probe.
