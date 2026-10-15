---
wp: 4b
title: fixture recording on the example route and the wiring helper
owner: fable
depends_on: [3, 4]
spec_sections: ["§2 (spike facts 1–8)", "§5.3 Recorder", "§5.5", "§7 app_lock, Migrations, tool bootstrap", "§9 item 7", "§12", "§14", "§16 WP4b"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, security-reviewer, cost-and-budget-reviewer, provenance-auditor, product-owner]
status: reviewed
---

# WP4b — fixture recording on the example route and the wiring helper

Reconciled against the plan's "Cross-package contracts" (Wiring and bootstraps, http-kit, Database, Budget port), its "Decisions taken at reconciliation" 1–31, spec revision 15, and the merged `@gmt/core`, `@gmt/db` (WP3), `@gmt/providers` (WP4) and WP2 on main at d86d24d. Every code block below was assembled on that commit on 2026-10-15 and passes typecheck, lint and its tests there (section 12).

## 1. Goal

Build the wiring helper and the tool bootstrap that every later entrypoint reuses, then use them to record redacted, hashed vendor fixtures for the public worked example (LHR, LGW → JFK, EWR) through the real http-kit, recorder and `SqliteBudgetGuard`, within an explicit call budget against the operator's production ledger.

## 2. Scope

**In**

- `apps/api/src/wiring.ts`: `Ports`, `buildPorts`, `httpLimitsFor`, `providersFor` and `loadConfigFromEnv` as the plan's contract, plus `tolerantRealpath`, `InvalidConfigError` and `collectSecrets`. `httpLimitsFor` and `providersFor` cover only `fixture` (under `syntheticAllowed`, at `config.providers.fixture.costMicroGbp` through WP4's `fixtureHttpLimits`) and `fx`; WP5 and WP6 each add one line. Paths come from the packages that own them: `MIGRATIONS_DIR` and `AIRPORTS_DATA_DIR` from `@gmt/db`, `defaultFixtureRoot()` from `@gmt/providers/fixture`, `defaultRecordedRoot()` from `@gmt/providers` (one-line barrel export, Task 8).
- `packages/db/src/appLock.ts`: `readOnlyLockState(dbPath, clock)`, exported from the `@gmt/db` barrel (Task 7, ruling on review item 4): the tool reads the lock before any backup or migration without opening SQLite itself; `@gmt/api` takes no SQLite dependency.
- `apps/api/src/logger.ts`: `createLogger(config, opts?)`, pino to stdout (spec §14) with the spec §14 redact paths, WP4's `CREDENTIAL_HEADERS` in every casing at the top level and one level down, `err.config`, `smtp.pass`, and pino's `hooks.streamWrite` replacing every configured secret value in any encoded form, written through `pino.destination({ dest: fd, sync: true })` (plan decision 30).
- `apps/api/src/bootstrap/tool.ts`: `runTool(name, argv, opts?): Promise<number>`, a `switch (name)` (no registry), in this order:
  1. parse the config once through `loadConfigFromEnv` (78 on a bad config); the only `process.env` read;
  2. refuse `config.nodeEnv === 'test'` (70);
  3. refuse while `syntheticAllowed(config)` is true (70, as the plan's exit table gives both refusals of synthetic data);
  4. parse the tool's arguments (64), decide where it records (64 for a route other than the worked example without `--out`, or an `--out` inside the repository), and run its configuration precheck (78);
  5. refuse an unwritable data directory (73);
  6. read `app_lock` through `@gmt/db`'s `readOnlyLockState` (a read-only connection; no migration, no journal-mode change) and refuse while a fresh lock exists (75); a file it cannot read (not a database, unreadable) refuses with 73;
  7. when the file exists and migrations are pending: refuse an unreadable migration state or a backups path that is not a writable directory (73), then `backupDatabase` (74 on failure);
  8. `buildPorts` (migrations; 1 on failure);
  9. take `AppLock('tool')` (75), seed the airports table when it is empty or the dataset version changed, heartbeat every `HEARTBEAT_INTERVAL_MS` (a lost lock aborts the tool and returns 75), abort on SIGINT/SIGTERM (repeated signals only abort again), release on every path.

  Every failure after the config parse maps to an exit code with a secret-scrubbed message, so nothing reaches the entry point's catch. It never constructs or boots the engine.
- `apps/api/src/tools/{types,recordRequests,recordPlan,recordParams,recordExecution,recordReport,record,workedExample}.ts`: `pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--out DIR] [--dry-run] [--confirm-rerun]` and `recordFixtures(ports, args, ctx)` as the plan's contract (plan decision 23; section 5.1).
- **Where a run writes (ruling on sec2-002):** into the committed tree (`defaultRecordedRoot()`) only when `--route` is exactly the worked example `LHR,LGW:JFK,EWR`; any other route needs `--out DIR` outside the repository and writes `DIR/fixtures/recorded`. "The repository" is every ancestor holding `pnpm-workspace.yaml`, so from a `.worktrees/` worktree the enclosing main checkout counts too, and paths are compared as true-case real paths (`realpathSync.native`), so a differently cased spelling on macOS cannot slip through (sec minor 1). Anything else refuses with 64 before the database is opened. A live `--out` run creates `DIR/fixtures/recorded` before the hidden execution opens, and the recorder is built before it too, so a bad root never leaves a `running` execution behind (prov-wp04b-r3-003). `apps/api/src/tools/workedExample.ts` is the one application source file that names those airports (the section 12 grep excludes it), as `apps/web/src/example.ts` is for the web. Tests always pass their own root together with the test signature (`RunToolOptions.recording`), so no test can write the committed tree or sign as the real tool (prov-wp04b-006).
- The recording run on the worked example through the real http-kit + recorder + guard, under a hidden soft-deleted definition's execution with `trigger: 'tool'`, against the operator's configured `DATABASE_PATH` (the production ledger, spec §7). It records:
  - 21 Travelpayouts calls: a 7-month metro scan, 4 airport tiles, an empty-envelope probe, a 401 probe on a month no success call uses, and the reverse-direction tile JFK → LON for the worked month (plan decision 31);
  - 6 SearchApi calls: a 401 probe on a cell outside the calendar rectangle, one calendar rectangle, a deliberate over-limit calendar, and the step 1 → 2 → 3 chain for the cheapest priced in-band cell inside the rectangle. Every SearchApi request sends `adults=1`, `travel_class` and `separate_tickets=1` (plan decisions 24 and 29: the vendor documents it for both engines); google_flights also sends `sort_by=price`; no `stops` (plan decision 24). The calendar rectangle is the production tiling shape for the worked band, 9 outbound days × a 20-day return span = 180 (spec rev 15 §5.2, plan decision 29). When the calendar yields no usable cell, the over-limit probe and the chain are skipped, so a doomed run spends nothing more (ruling on cost-wp4b-r2-004); and when any required call before the first billed one (TP-01…TP-18, TP-20, TP-21, SA-01) did not answer as planned, SA-02…SA-06 are all skipped and no credit is spent (cost I-1, plan decision 30).

  No 429 is attempted (plan decision 20): WP5 maps rate limits from a labelled synthetic fixture and `rateLimitFallbackWaitSeconds`, and SearchApi's Retry-After behaviour stays unverified against the vendor.
- Spend control before any live call (exit 65, `EXIT.spendRefused`): the run refuses when the SearchApi credits already ledgered to `trigger: 'tool'` executions in the provider's budget window, plus this run's worst case, exceed `--budget`, unless `--confirm-rerun` is passed (plan decision 20); and it refuses, whatever the flags, when the SearchApi window or the Travelpayouts month has less room than the run's worst case (cost-wp4b-r2-001). Travelpayouts paging stops at 3 pages per tile, so the worst case is finite (cost-wp4b-r2-002). The dry run prints every figure and verdict.
- The dated parameter allowlists `packages/providers/fixtures/recorded/<provider>/params-<date>.json` in the plan's `ParamsAllowlist` shape, loadable by WP4's `loadParamsAllowlist`.
- The committed recorded tree, a manual review of every recorded file before commit, and the committed-tree manifest: `checkWorkedExampleTree(root, opts)` in apps/api's test helpers, proven against a stand-in tree and broken copies of it, and called on the committed tree by one test (r2-ts-002). Its stand-in tripwire fails on any committed file carrying the test stand-ins' marker.
- `scripts/check-boundaries.mjs`: any msw import (static, side-effect or dynamic) fails in every package's `src` outside `packages/providers/src/testing/`, `@gmt/api` may neither list msw nor import it from its test tree (plan decisions 7 and 20), and `process.env` may be read only under `apps/api/src/bootstrap/` (wiring and logger take the env as an argument).
- **The recorded tree is for this private repository.** Publishing the repository requires removing or re-recording the vendor bodies first (plan decision 20; Task 12b repeats it in the PR).

**Out**

- **WP4 (merged):** the recorder itself (`createRecorder`, `RecordedFixture`, placeholders, scrubbing, response-header allowlist, fail-closed, `.raw.json`), `verifyRecordedFile`/`verifyRecordedTree`, `installNetworkGuards`, `loadRecorded`/`replayHandlers`, the `inProcessHosts` seam and `fixtureRouter`.
- **WP3:** everything in `@gmt/db` except `readOnlyLockState` (Task 7): `SqliteBudgetGuard` (execution caps from the snapshot), `AppLock`, `createRepos`, `budgetConfigFromConfig`, `pendingMigrations`, `backupDatabase`, `seedAirports`/`loadAirportsDataset`, the migrations; the engine-visible rule that soft-deleted definitions are never resumed or scheduled is WP7's.
- **WP5:** the SearchApi adapter, `searchApiHttpLimits`, `SEARCHAPI_PARAMS`, the 429 mapping from a synthetic labelled fixture, and the one-line additions to `httpLimitsFor`/`providersFor`.
- **WP6:** the same for Travelpayouts. Both replay the files recorded here.
- **WP8:** the app bootstrap and `POST /api/tools/record`.
- **WP12:** `scripts/backup.mjs`, the CLI wrapper around WP3's `backupDatabase`.
- **WP13:** `smoke:live` (the `smoke` case of runTool's switch), `/api/tools/smoke`, the layer-B engine tests and the "tool bootstrap starts no execution" lock test.

**Adapters do not exist when WP4b runs.** WP5 and WP6 depend on this package. `record.ts` therefore hand-builds every request with the URLs and parameters of section 6 and sends them through its own `createHttpKit` instance, which shares `ports.budget`, `ports.cache`, `ports.secrets` and `ports.clock`, uses `recordingLimits(...)` for the two vendors and a recorder `record.ts` builds itself from `ports.secrets`, `ports.clock` and the recorded root. WP5 and WP6 later replay the recorded files through `@gmt/providers/testing`'s `replayHandlers`; their `SEARCHAPI_PARAMS`/`TRAVELPAYOUTS_PARAMS` are asserted equal to the allowlists written here.

## 3. Spec sections

| Section | What it requires of this package |
|---|---|
| §2 spike facts 1–8 | The shapes to re-record on the public route: (1) Travelpayouts rows carry `origin_airport`, no `found_at`, `currency=gbp` honoured; (2) SearchApi calendar per airport, HTTP 400 above 200 combinations; (3) the 1 → 2 → 3 chain, with unpriced options and an OTA below the airline fare; (4) the ledger counts every HTTP 200 (may overcount, never undercount); (5) error bodies (SearchApi 401 and 400, Travelpayouts 401 plain text); (6) carriers; (7) a one-off trial balance on a lifetime window; (8) keys in headers only. |
| §5.3 "Recorder" | `fixtures/recorded/<provider>/<endpoint>/<yyyy-mm-dd>-<sha>.json`; credentials fail closed; `search_metadata` URLs stripped of query and userinfo; opaque tokens become `<key:n@session>` placeholders consistent across a chain. Pino `redact` covers `apiKey`, `token`, `authorization`, `url.query`, `req.headers.authorization`. |
| §5.5 | `databasePath` realpath-resolved before the config is built (symlink cases tested); the tool bootstrap refuses `NODE_ENV=test`; the recorder writes only under `fixtures/recorded/` with a content hash and a `recordedBy` the fixture-tree tests verify. |
| §7 `app_lock`, SQLite settings, Migrations | Heartbeat 30 s, stale after 3 missed beats; the tool bootstrap refuses while a fresh app lock exists, reuses the config parse and port wiring, opens the same DB, uses the production ledger, skips sweep, auto-resume and cron. A backup runs first only when migrations are pending; a failed backup refuses migrations. Seed after migration when `airports` is empty or the dataset version changed. |
| §8.1 | Deleted definitions are never resumed or scheduled, which makes the hidden recording definition inert. |
| §9 item 7 | `pnpm record:fixtures --budget N` records the step 1→2→3 chain for one cell, and the 429/quota bodies when the vendor can be induced to return them, within an explicit call budget; excluded from `pnpm test`; run via the tool bootstrap. Plan decision 20 rules that a 429 is not induced on this run. |
| §12 | Config parsed once; empty = unset; a bad config fails naming the field, never a value. |
| §14 | pino JSON to stdout; the §5.3 redact paths; no secrets, no full URLs. |
| §16 WP4b | Records the public example route through the real recorder and builds the wiring helper WP8 reuses. First failing test: a recorded fixture carries a verifiable content hash. Decision 20 replaces the "~12 credits, incl. a 429" sizing with 6 SearchApi calls, at most 5 billed credits. |

## 4. Interfaces consumed

Signatures as they stand in the plan's contracts and in the merged code on main (WP3 and WP4).

`@gmt/core` (main):

```ts
export type Iata; export type IsoDate; export type IsoMonth; export type IsoDateTime;   // branded strings
export const iataSchema; export const isoDateSchema; export const isoMonthSchema;        // zod; iataSchema trims and upper-cases
export function asIsoDate(s: string): IsoDate; export function asIsoMonth(s: string): IsoMonth; export function asIsoDateTime(s: string): IsoDateTime;
export function addDays(date: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number; export function monthOf(date: IsoDate): IsoMonth;
export interface Logger { debug(o: object, msg?: string): void; info(…): void; warn(…): void; error(…): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export const systemClock: Clock; export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export class Secret { reveal(): string /* toJSON redacts */ }
export interface Config { nodeEnv; databasePath; logLevel; pointOfSale; schedulerTimezone; maxWaitSeconds; requestTimeoutSeconds; spend: { executionMaxFreeCalls: number; … }; providers: { travelpayouts: { token: Secret; limits: ProviderLimits } | null; searchapi: { key: Secret; plan: PlanId; trialUsed: number; limits: ProviderLimits } | null; fixture: { costMicroGbp: number } | null }; smtp: { pass: Secret; … } | null; auth: { user: string; pass: Secret } | null; … }
export type ConfigError = { field: string; message: string };
export function parseConfig(env: Record<string, string | undefined>, opts: { realpath: (p: string) => string }): { ok: true; config: Config } | { ok: false; errors: ConfigError[] };
export function syntheticAllowed(c: SyntheticGateInput): boolean;
export interface ProviderLimits { monthlyCallCap; window: 'month' | 'lifetime'; ratePerMinute; ratePerHour; concurrency; costPerCallMicroGbp; … }
export class ProviderError extends Error { kind: ProviderErrorKind; httpStatus: number | undefined; … }
export class BudgetExceeded extends Error { scope: BudgetScopeKind; … }
export class AbortedError extends Error {}
export function stripUrlsInText(text: string): string;
export type DefinitionInput; export type DefinitionSnapshot; export interface Estimate; export type ExecutionStatus; export type ProviderId; export interface FlightProvider; export interface BudgetGuard; export interface ResponseCache;
```

`@gmt/db` (WP3, main):

```ts
export const MIGRATIONS_DIR: string; export const AIRPORTS_DATA_DIR: string;   // src/paths.ts, valid from src and dist
export function openDatabase(path: string): Db;   // Db: { raw: BetterSqlite3.Database; drizzle; transaction(fn); immediateTransaction(fn); close() }
export function pendingMigrations(db: Db, migrationsDir: string): string[];
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };   // throws 'migration failed in …'
export function createRepos(db: Db, clock: Clock, opts: { allowSynthetic: boolean }): Repos;
// AirportsRepo: sharedMetro(iatas: Iata[]): string | null; count(): number; datasetVersion(): string | null
// DefinitionsRepo: create(input: DefinitionInput & { confirmedCostPence?: number }): SearchDefinition; get(id): SearchDefinition | null; softDelete(id): void
// ExecutionsRepo: create(input: ExecutionCreateInput): Execution; listByStatus(statuses: ExecutionStatus[]): Execution[]; setStatus(id, status, patch?: ExecutionPatch): void   // errorText is URL-stripped on write
export function budgetConfigFromConfig(c: Config): BudgetConfig;   // fixture rate = providers.fixture.costMicroGbp under syntheticAllowed
export class SqliteBudgetGuard implements BudgetGuard { constructor(db: Db, config: BudgetConfig, clock: Clock) }   // execution caps from the snapshot budget; a pending row counts until finalised; reserve refuses a cost ≠ the configured rate
export class SqliteResponseCache implements ResponseCache { constructor(db: Db, clock: Clock) }
export const HEARTBEAT_INTERVAL_MS = 30_000; export const LOCK_STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS;
export class AppLock { constructor(db: Db, holder: 'app' | 'tool', clock: Clock, log: Logger); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void /* throws 'app_lock lost' after a takeover */; release(): void /* never deletes another holder's lock */; static inspect(db: Db): { holder; heartbeatAt; acquiredAt } | null }
export function backupDatabase(dbPath: string, backupsDir: string, opts: { keep: number; clock: Clock }): { file: string };   // creates the directory 0o700; refuses a world-writable one; throws on any failure
export function loadAirportsDataset(dir: string): AirportsDataset;   // local files, no network
export function seedAirports(db: Db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };
```

`@gmt/providers` (WP4, main):

```ts
export interface ResponseFacts { status: number; body: unknown; headers: Headers; providerId: HttpProviderId; endpointPath: string }
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; rateLimitFallbackWaitSeconds?: number; classifyError?: (f: ResponseFacts) => ProviderError | undefined }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<HttpProviderId, ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; syntheticAllowed: boolean; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: HttpProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL /* credential-free; the query is kept */; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never'; signal: AbortSignal; recordFixtures: boolean }
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export function createHttpKit(deps: HttpKitDeps): HttpKit;   // records every attempt that got an HTTP response, before classification; throws ProviderError (httpStatus set for a response), BudgetExceeded, AbortedError, RecorderRefusedError
export interface FixtureRecorder { record(r: { providerId; endpointPath: string; request: HttpKitRequest; status: number; body: unknown; fetchedAt: IsoDateTime; responseHeaders?: Headers }): Promise<string /* path written */> }
export interface RecordedFixture { recordedAt: IsoDateTime /* = fetchedAt */; recordedBy: string; providerId: string; endpointPath: string; request: { method: string; url: string /* credential-free, query kept */; headers: Record<string, string> /* credential headers dropped */; body: string | null }; status: number; body: unknown; placeholders: Record<string, string> /* '<key:n@session>' → key */; responseHeaders: Record<string, string> /* retry-after, content-type, x-ratelimit-*, ratelimit-*; lower-cased; a secret in one refuses the recording */; session: string; contentSha256: string }
export function createRecorder(opts: { root: string /* must end in fixtures/recorded */; secrets: readonly Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;   // <root>/<providerId>/<endpointPath with / → _>/<yyyy-mm-dd>-<sha12>.json; raw body beside it as .raw.json (gitignored); search_metadata URLs keep their keys with query and userinfo stripped
export function defaultRecordedRoot(): string;   // src/http/recorder.ts; Task 8 adds it to the barrel
export function withContentHash<T extends object>(file: T): T & { contentSha256: string };   // src/http/recorder.ts; Task 6 adds it to the main barrel (plan decision 30)
export function assertRecordedRoot(root: string): string;   // Task 6 adds it to recorder.ts and the main barrel: the real root, refused unless it exists and ends in fixtures/recorded (the recorder's own rule)
export function canonicalJson(v: unknown): string;   // keys sorted, undefined dropped: the hash input
export function scrubSecrets<T>(value: T, secrets: readonly Secret[]): T;
export const CREDENTIAL_HEADERS: ReadonlySet<string>;   // authorization, proxy-authorization, x-access-token, x-api-key, cookie
export function fixtureHttpLimits(o: { costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits;
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: SyntheticGateInput; costMicroGbp: number }): FlightProvider;
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string, { names: string[]; values: Record<string, string[] | 'any'> }>; contentSha256: string }
export function loadParamsAllowlist(path: string, root?: string): ParamsAllowlist;   // hash, key form, ascending names, a value list per name
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void;   // most specific key; two matching discriminated keys refuse
```

`@gmt/providers/fixture`: `defaultFixtureRoot(): string`; `fixtureRouter(root: string, gate: SyntheticGateInput): Hono` (throws unless `syntheticAllowed(gate)`).

`@gmt/providers/testing` (tests only; the only msw importer):

```ts
export interface GuardHooks { beforeAll(fn: () => unknown): unknown; afterEach(fn: () => unknown): unknown; afterAll(fn: () => unknown): unknown }
export function installNetworkGuards(hooks: GuardHooks): { server };   // refuses DNS, catch-all msw handler, fails a test that left a stray request
export function verifyRecordedFile(path: string, recordedRoot: string, secrets?: readonly Secret[]): string[];   // problems; [] = clean (hash, recordedAt, recordedBy, session, location, file name, response headers, provider host, no secret)
export function verifyRecordedTree(recordedRoot: string, secrets?: readonly Secret[]): string[];
export function loadRecorded(root: string, providerId: string, endpointPath: string): RecordedFixture[];   // recordedAt order
export function takeStrays(): string[];   // requests the catch-all answered since the last call, cleared (the guard test reads it)
export function withContentHash<T extends object>(file: T): T & { contentSha256: string };   // the manifest's negative tests re-hash an edited copy
```

Signature checks: WP4's verifier accepts any non-blank `recordedBy`, so `checkWorkedExampleTree` (Task 12a) is the only check that requires `RECORDED_BY`.

`scripts/secret-scan.mjs` (WP0) is consumed as written: it scans `packages/providers/fixtures` under its cwd, takes values from `TRAVELPAYOUTS_TOKEN`, `SEARCHAPI_KEY`, `SMTP_PASS` and `APP_BASIC_AUTH_PASS` (≥ 8 chars), and rejects `api_key=…`, `token=…16+`, `Bearer …16+` and the literal `X-Access-Token`.

## 5. Interfaces produced

### 5.1 Plan contract (`apps/api`)

```ts
// src/wiring.ts
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[]; recorder: FixtureRecorder | null; fixtureRoot: string | null }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string; fixtureRoot?: string }): Ports;
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];   // WP4b: fixture (under syntheticAllowed) + fx; WP5/WP6 add one line each
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo }): FlightProvider[];
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;   // throws InvalidConfigError
// src/logger.ts
export function createLogger(config: Pick<Config, 'logLevel'>, opts?: { destination?: NodeJS.WritableStream; fd?: 1 | 2; secrets?: readonly Secret[] }): Logger;
// src/bootstrap/tool.ts
export async function runTool(name: 'record' | 'smoke', argv: string[], opts?: RunToolOptions): Promise<number>;
// src/tools/record.ts
export async function recordFixtures(ports: Ports, args: RecordArgs, ctx: { signal: AbortSignal; recordedRoot: string; recordedBy: string; plan?: readonly PlannedCall[] }): Promise<RecordSummary>;
export interface RecordArgs { budget: number; origins: Iata[]; destinations: Iata[]; month: IsoMonth }
// src/tools/types.ts
export interface RecordSummary { calls: RecordedCall[]; creditsUsed: number; freeCalls: number; session: string | null; chain: { currency: 'GBP'; step1PricePence: number | null; step2PricePence: number | null; step3Options: Array<{ bookWith: string; pricePence: number }> } }
export interface RecordedCall { id: string; providerId: ProviderId; status: number | 'skipped' | 'aborted' | 'no-response'; file: string | null; files: string[]; detail: string | null }
```

Plan decision 23 records the widenings against the plan's first text (`createLogger`'s `fd`/`secrets`, `runTool`'s `opts`, `recordFixtures`' ctx, `RecordArgs` without `metro`, `RecordSummary.session`/`chain`, the `RecordedCall` fields). This revision adds two that section 13 lists: `ctx.recordedBy` is required (no fallback signature), and `chain` carries integer pence with its currency (prov-wp04b-r2-001: diagnostics, never offers).

`RecordedCall.status` is the HTTP status when a response arrived; `'no-response'` when the request may have reached the vendor but no status came back, with `detail` saying whether the ledger counted it (a timeout is finalised `unknown` and counted; a socket failure is finalised `error`, not counted, and retried by http-kit: the one path where the vendor may have billed a credit the ledger does not show, cost-wp4b-r2-003); `'aborted'` when SIGINT, SIGTERM or a lost lock stopped it; `'skipped'` only when nothing reached the vendor (a guard refusal, a rate-limit slot not granted within `MAX_WAIT_SECONDS`, a missing chain prerequisite, an abort before send; cost M-2). Any other status-less ProviderError is `'no-response'` naming its code, so only a `[socket]` failure carries the "NOT counted" line Task 12b step 5 reconciles against the dashboard. `files` lists every file the recorder wrote for the call, retries included; `file` is the last. `creditsUsed` and `freeCalls` are `budget.usage` of the execution's `execution-calls` and `execution-free-calls` scopes.

### 5.2 Helpers, also exported (used by WP8/WP13 or by this brief's tests)

```ts
// src/wiring.ts
export class InvalidConfigError extends Error { readonly errors: readonly ConfigError[] }
export function tolerantRealpath(p: string): string;   // refuses a dangling symlink
export function collectSecrets(config: Config): Secret[];
// src/logger.ts
export const SPEC_REDACT_PATHS: readonly string[]; export const REDACT_PATHS: readonly string[];
// src/tools/types.ts
export type ToolName = 'record' | 'smoke';
export interface ToolContext { signal: AbortSignal; out(line: string): void; err(line: string): void; recordedRoot: string; recordedBy: string }
export const EXIT: { ok: 0; failed: 1; usage: 64; spendRefused: 65; refusedTestEnv: 70; preflightImpossible: 73; backupFailed: 74; lockRefused: 75; badConfig: 78 };
export interface RecordingProviders { tp: NonNullable<Config['providers']['travelpayouts']>; sa: NonNullable<Config['providers']['searchapi']> }
export class RecordingFailedError extends Error { readonly partial: { calls: RecordedCall[]; creditsUsed: number; freeCalls: number; session: string | null } }
// packages/db/src/appLock.ts (exported from @gmt/db; Task 7)
export type ReadOnlyLockState = { state: 'absent' } | { state: 'fresh' | 'stale'; holder: 'app' | 'tool'; heartbeatAt: IsoDateTime };
export function readOnlyLockState(dbPath: string, clock: Clock): ReadOnlyLockState;   // absent: :memory:, no file, no app_lock table or no row; fresh: heartbeat ≤ LOCK_STALE_AFTER_MS old; never writes; throws for a non-database file or a malformed heartbeat (the tool maps a throw to 73)
// src/bootstrap/tool.ts
export interface ToolRunners { record(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number> }   // WP13 adds smoke
export interface RecordingTarget { root: string; recordedBy: string }
export interface RunToolOptions { env?; runners?: Partial<ToolRunners>; out?; err?; logDestination?; clock?: Clock; migrationsDir?: string; recording?: RecordingTarget /* root and signature together */ }
export function recordingTarget(cli: RecordCli, given: RecordingTarget | undefined, roots?: readonly string[]): RecordingTarget | { refusal: string };   // roots default: repositoryRoots()
export function repositoryRoots(from?: string): string[];   // every ancestor of the recorded tree holding pnpm-workspace.yaml, nearest first, true-case real paths
export function repositoryRoot(): string;   // the nearest of them
export function isEntryPoint(script?: string, self?: string): boolean;
// src/bootstrap/preflight.ts (Task 8; the pre-migration preflight WP8's app bootstrap reuses, plan decision 30 / arch M-1)
export const BACKUPS_KEPT = 5;
export function backupsDirFor(databasePath: string): string;   // <dirname(dbPath)>/backups
export function dataDirRefusal(databasePath: string): string | null;   // the refusal when the data directory is not writable
export function pendingOnExistingDb(databasePath: string, migrationsDir: string): string[];   // opens read-write (no schema change)
export function backupBeforeMigrations(databasePath: string, migrationsDir: string, clock: Clock, secrets: readonly Secret[]): { ok: true; line: string | null } | { ok: false; code: 73 | 74; message: string };
// src/safeMessage.ts (Task 6; record.ts re-exports it)
export function safeMessage(e: unknown, secrets: readonly Secret[]): string;
// src/tools/workedExample.ts
export const WORKED_EXAMPLE_ROUTE: { origins: readonly ['LHR', 'LGW']; destinations: readonly ['JFK', 'EWR'] }; export const WORKED_EXAMPLE_ROUTE_ARG: string;
export function isWorkedExampleRoute(a: { origins: readonly string[]; destinations: readonly string[] }): boolean;
// src/tools/recordRequests.ts
export const TP_URL; export const SA_URL; export const TP_PAGE_LIMIT = 1000; export const RECORD_TRAVEL_CLASS = 'economy'; export const RECORD_ADULTS = '1'; export const RECORD_SORT_BY = 'price'; export const RECORD_SEPARATE_TICKETS = '1';
export interface Rect { outFrom: IsoDate; outTo: IsoDate; retFrom: IsoDate; retTo: IsoDate; combinations: number }
export interface CellDates { departure: IsoDate; return: IsoDate }
export function isRecord(v: unknown): v is Record<string, unknown>;
export function recordingLimits(tp, sa, timing): HttpKitDeps['limits'];
export function tpUrl(…): URL; export function saUrl(…): URL; export function calendarParams(…); export function flightsParams(…);
export function cheapestCalendarCell(body: unknown, band: { minNights: number; maxNights: number }, rect: Rect): (CellDates & { price: number }) | null;
export function cheapestOption(body: unknown, tokenField: 'departure_token' | 'booking_token'): { token: string; price: number } | null;
export function calendarIsEmpty(body: unknown): boolean; export function dataRowCount(body: unknown): number; export function bookingOptions(body: unknown): Array<{ bookWith: string; price: number }>;
// src/tools/recordPlan.ts
export const TP_MAX_PAGES_PER_TILE = 3;
export interface RecordCli { args: RecordArgs; dryRun: boolean; confirmRerun: boolean; out: string | null }
export function parseRecordArgs(argv: readonly string[]): { ok: true; value: RecordCli } | { ok: false; message: string };
export function monthAfter(month: IsoMonth, k: number): IsoMonth; export function rectangle(month: IsoMonth, outDays: number, retDays: number, minNights: number): Rect;
export function planCalls(a: RecordArgs, metro: string | null): PlannedCall[]; export function planTotals(plan): { saCalls; worstCaseCredits; expectedCredits; freeCalls; worstCaseFreeCalls };
export function formatPlan(plan: readonly PlannedCall[]): string[]; export function freeCallMisfit(plan, maxFreeCalls: number): string | null;   // against the worst case
// src/tools/recordParams.ts
export class ParamLog { validate(key: EndpointKey, params: URLSearchParams): void /* before send */; observe(key: EndpointKey, params: URLSearchParams): void /* after a response */; document(provider, recordedAt: IsoDate): ParamsAllowlist }
export function paramRules(): Readonly<Record<EndpointKey, EndpointRules>>; export function writeAllowlist(root: string, doc: ParamsAllowlist): string;   // 'wx'
// src/tools/recordExecution.ts
export function priorToolCredits(ports: Ports): number;
export function budgetPosition(ports: Ports, a: RecordArgs, plan: readonly PlannedCall[]): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] };
export function openRecordingExecution(ports: Ports, a: RecordArgs, plan: readonly PlannedCall[], sa: RecordingProviders['sa']): string;   // providers narrowed once in recordFixtures (arch M-3)
// src/tools/recordReport.ts
export interface RunAssessment { requiredOk: boolean; notAsExpected: string[]; chainComplete: boolean; emptyEnvelope: 'yes' | 'no' | 'no-answer'; overLimit: 'http-400' | 'empty-200' | 'other' | 'no-answer' }   // 'no-answer': the call got no HTTP status, so nothing is said about the vendor

export function assessRun(plan, s: Pick<RecordSummary, 'calls'>): RunAssessment;
export function formatSummary(s, v, a, plan): string[]; export function ledgerLine(s, a): string; export function retryAttemptLines(calls): string[];   // a deletable line only for a call whose final attempt answered 200
export function readRecorded(file: string | null): Record<string, unknown> | undefined; export function sessionOf(file: string): string | null; export function sessionOfCalls(calls): string | null;
// src/tools/record.ts
export const RECORDED_BY = '@gmt/api record:fixtures';
export function failureOf(e: unknown): { status: RecordedCall['status']; detail: string } | null;   // null: not a request result, it propagates
export function recordPrecheck(c: Config): string | null; export function runRecord(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number>; export function safeMessage(e: unknown, secrets: readonly Secret[]): string;
```

### 5.3 Recorded file format (plan `RecordedFixture`, written by WP4's recorder)

```json
{
  "recordedAt": "2026-10-20T09:14:03.512Z",
  "recordedBy": "@gmt/api record:fixtures",
  "providerId": "searchapi",
  "endpointPath": "/api/v1/search",
  "request": {
    "method": "GET",
    "url": "https://www.searchapi.io/api/v1/search?engine=google_flights&departure_id=LHR&…&travel_class=economy&currency=GBP&gl=gb&hl=en&departure_token=%3Cdeparture_token%3A0%4020261020T091403512Z-a1b2c3%3E",
    "headers": {},
    "body": null
  },
  "status": 200,
  "body": { "best_flights": [ { "price": 603, "booking_token": "<booking_token:0@20261020T091403512Z-a1b2c3>" } ] },
  "placeholders": { "<booking_token:0@20261020T091403512Z-a1b2c3>": "booking_token", "<departure_token:0@20261020T091403512Z-a1b2c3>": "departure_token" },
  "responseHeaders": { "content-type": "application/json" },
  "session": "20261020T091403512Z-a1b2c3",
  "contentSha256": "9f2c…64 lowercase hex"
}
```

- `contentSha256` is the SHA-256 hex digest of WP4's `canonicalJson` of the object without `contentSha256`; `verifyRecordedFile` recomputes it.
- The file is `<root>/<providerId>/<endpointPath with "/" → "_">/<yyyy-mm-dd>-<first 12 hex>.json`, so the endpoint directories are `_aviasales_v3_prices_for_dates` and `_api_v1_search`; the date is `recordedAt`'s UTC date. The `.raw.json` sibling is gitignored.
- `request.url` keeps its query, with tokens as `<key:n@session>` placeholders and no credential parameter. `request.headers` never contains a credential header. `responseHeaders` holds only `retry-after`, `content-type`, `x-ratelimit-*` and `ratelimit-*`, lower-cased.
- `search_metadata` URL fields (`request_url`, `json_endpoint`, …) keep their keys; their values have no query and no userinfo.

### 5.4 Parameter allowlist file (`<root>/<provider>/params-<yyyy-mm-dd>.json`, plan `ParamsAllowlist`)

```json
{
  "provider": "searchapi",
  "recordedAt": "2026-10-20",
  "endpoints": {
    "/api/v1/search?engine=google_flights_calendar": {
      "names": ["adults", "arrival_id", "currency", "departure_id", "engine", "flight_type", "gl", "hl", "outbound_date", "outbound_date_end", "outbound_date_start", "return_date", "return_date_end", "return_date_start", "separate_tickets", "travel_class"],
      "values": { "adults": ["1"], "arrival_id": "any", "currency": ["GBP"], "departure_id": "any", "engine": ["google_flights_calendar"], "flight_type": ["round_trip"], "gl": ["gb"], "hl": ["en"], "outbound_date": "any", "outbound_date_end": "any", "outbound_date_start": "any", "return_date": "any", "return_date_end": "any", "return_date_start": "any", "separate_tickets": ["1"], "travel_class": ["business", "economy", "first_class", "premium_economy"] }
    },
    "/api/v1/search?engine=google_flights": {
      "names": ["adults", "arrival_id", "booking_token", "currency", "departure_id", "departure_token", "engine", "flight_type", "gl", "hl", "outbound_date", "return_date", "separate_tickets", "sort_by", "travel_class"],
      "values": { "…": "as above", "booking_token": "any", "departure_token": "any", "engine": ["google_flights"], "separate_tickets": ["1"], "sort_by": ["price"] }
    }
  },
  "contentSha256": "…"
}
```

Keys are the endpoint path, or `<path>?engine=<value>` for SearchApi's two engines on `/api/v1/search`; Travelpayouts has one key, `/aviasales/v3/prices_for_dates`, with names `currency, departure_at, destination, limit, one_way, origin, page`. `names` lists every parameter sent to that key, sorted. `values`: a fixed parameter maps to the sorted values sent; `travel_class` maps to the vendor's documented set (spec §5.4), so WP5 can send the definition's cabin while this run sends `economy`; a variable parameter (airport, date, month, page, opaque token) maps to `'any'`. No credential name (`api_key`, `token`) and none of `market`, `trip_class`, `return_at`, `stops` ever appears. A name enters the file only when a request carrying it got a response, so a call the guard refused or an abort stopped evidences nothing (prov-wp04b-r2-003). Plan decision 24: this SearchApi file equals WP5's `SEARCHAPI_PARAMS`; plan decision 29 puts `separate_tickets` (`["1"]`) on both engines. `contentSha256` is over `canonicalJson` without the field, so `loadParamsAllowlist` verifies it.

## 6. Endpoints and parameters

Verified = read on the vendor's documentation page on 2026-10-14, or in the WP5 review's evidence note of 2026-10-15 (`~/.cache/get-me-there/review-spec/wp05-searchapi-adapter/r1/evidence/provider-integration-expert-vendor-docs.md`); this revision makes no vendor request. Spike-measured = settled by the 2026-10-14 spike (spec §2, `docs/providers.md`).

**Travelpayouts** `GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates`. Credential in header `X-Access-Token`.

| Parameter | Value sent | Status |
|---|---|---|
| `origin` | origin airport, or the origins' shared metro code from the seeded airports table | spike-measured |
| `destination` | destination airport | spike-measured |
| `departure_at` | `YYYY-MM` | spike-measured |
| `one_way` | `false` | spike-measured |
| `currency` | `gbp` | spike-measured (fact 1: honoured) |
| `limit` | `1000` | spike-measured |
| `page` | `1`, then `2…` while a page returns 1000 rows, at most 3 pages per tile | spike-measured; the cap is this brief's (cost-wp4b-r2-002) |
| no `return_at`, `market`, `trip_class` or `token` query parameter | — | spike-measured (fact 1, fact 8) |

**SearchApi** `GET https://www.searchapi.io/api/v1/search`. Credential in header `Authorization: Bearer <key>` (verified; `api_key` is never sent).

`engine=google_flights_calendar` (https://www.searchapi.io/docs/google-flights-calendar-api):

| Parameter | Value sent | Status |
|---|---|---|
| `engine` | `google_flights_calendar` | verified |
| `departure_id`, `arrival_id` | one airport each (city codes rejected, fact 2) | verified |
| `outbound_date`, `return_date` | = the rectangle's start dates | verified; the docs mark both required |
| `outbound_date_start`/`_end`, `return_date_start`/`_end` | rectangle bounds | verified |
| `flight_type` | `round_trip` | verified |
| `travel_class` | `economy` (the worked example's cabin) | verified (2026-10-15 evidence); spec §5.4 value set; sent on every SearchApi request (plan decisions 20, 24) |
| `adults` | `1`, sent explicitly | verified (default 1); plan decision 24 |
| `currency` | `GBP` | verified (default `USD`) |
| `gl` | `gb` (the tool refuses unless `POINT_OF_SALE=GB`) | verified (default `us`) |
| `hl` | `en` | verified |
| `separate_tickets` | `1` (excludes separate-ticket itineraries) | verified (documented for both engines); plan decision 29 |
| no `stops` | — | plan decision 24 (the calendar's `stops` filter would hide cells WP5 must price) |

The docs say more than 200 combinations "returns an empty response"; the spike measured HTTP 400. SA-03 records which happens: a 400 or an empty 200 both pass, the empty 200 is billed (section 7), and the summary names the behaviour.

`engine=google_flights` (https://www.searchapi.io/docs/google-flights-api): `engine`, `departure_id`, `arrival_id`, `outbound_date`, `return_date`, `flight_type=round_trip`, `travel_class=economy`, `adults=1`, `currency=GBP`, `gl=gb`, `hl=en` (verified), plus, by plan decision 24, the documented price sort `sort_by=price` and, as on the calendar (plan decision 29), `separate_tickets=1`, the value that excludes separate-ticket itineraries (the evidence note gives the parameter and its default 0, which shows them; the excluding value is the non-default one, and WP5's equality test against this file keeps both packages on one value); no `stops`; step 2 adds `departure_token` from the cheapest priced step-1 option and resends the step-1 parameters (token verified; resending the parameters with it is unverified, the docs show no step-2 example); step 3 sends `booking_token` from the cheapest priced step-2 option with the step-1 parameters and without `departure_token` (verified). Response fields per the docs: `best_flights[]`, `booking_options[]` (`book_with`, `price`, `booking_request`), `price_insights`; `record.ts` also reads `other_flights` and tolerates either array being absent.

## 7. Planned live call list (worked example)

Command, against the operator's `.env` (no `DATABASE_PATH` override): `pnpm record:fixtures --budget 5 --route LHR,LGW:JFK,EWR --month 2027-03`.

The metro comes from the airports table, which the tool seeds after migration when it is empty or its dataset version changed (the vendored metro list maps LHR and LGW to `LON`). The nights band is the worked example's 10–21. `--dry-run` prints exactly this list (Task 5 asserts it line by line), then where it records, the Travelpayouts per-run cap, the credits already ledgered to tool runs in the SearchApi window, each provider window's used/cap/room figures (the SearchApi one to compare with the dashboard), and any refusal a live run would meet.

"Credits ≤" counts every HTTP 200 SearchApi call as billed, which is how the ledger counts them (spec §2 fact 4: the ledger may overcount, never undercount). 400 and 401 responses are not billed and are not counted once finalised. The guard counts a reservation while it is pending, so the SearchApi 401 probe runs first: its reservation never meets a cap the billed calls have filled.

| # | Call | Expect | SearchApi credits ≤ (running) | Travelpayouts calls (running) |
|---|---|---|---|---|
| TP-01…TP-14 | prices_for_dates LON→JFK and LON→EWR, 2027-03 … 2027-09 (metro) | 200 | 0 (0) | 14 (14) |
| TP-15…TP-18 | LHR→JFK, LHR→EWR, LGW→JFK, LGW→EWR 2027-03 (airport) | 200 | 0 (0) | 4 (18) |
| TP-19 | LON→JFK 2028-02 (empty-envelope probe, best-effort, not required) | 200 | 0 (0) | 1 (19) |
| TP-20 | LON→JFK 2028-03 with an invalid token (401 body; a month no success call uses) | 401 | 0 (0) | 1 (20) |
| TP-21 | JFK→LON 2027-03 (reverse direction, plan decision 31) | 200 | 0 (0) | 1 (21) |
| SA-01 | google_flights step 1 LHR→JFK 2027-03-10/2027-03-31 with an invalid key (401 body; a cell outside the SA-02 rectangle) | 401 | 0 (0) | 0 (21) |
| SA-02 | calendar LHR→JFK out 2027-03-01..03-09 × ret 2027-03-11..03-30 (9 × 20 = 180, the production tiling shape of spec rev 15 §5.2; plan decision 29) | 200 | 1 (1) | 0 (21) |
| SA-03 | calendar out 2027-03-01..03-09 × ret 2027-03-11..04-03 (9 × 24 = 216, over the limit) | 400, or an empty 200 | 1 (2) | 0 (21) |
| SA-04 | google_flights step 1 LHR→JFK, the cheapest priced SA-02 cell inside the rectangle with 10–21 nights | 200 | 1 (3) | 0 (21) |
| SA-05 | step 2, `departure_token` of the cheapest priced step-1 option | 200 | 1 (4) | 0 (21) |
| SA-06 | step 3, `booking_token` of the cheapest priced step-2 option | 200 | 1 (5) | 0 (21) |

**Totals:** 6 SearchApi calls, at most **5** billed credits (4 expected: SA-02, SA-04, SA-05, SA-06; SA-03 is billed only if the vendor answers it with an empty 200). Plan decision 24's extra parameters and plan decision 29 (`separate_tickets` on the calendar, the 9 × 20 rectangle) change no call and no credit. 21 Travelpayouts free calls, at most 61 with up to 3 pages per tile (20 tiles × 3 + the 401 probe; plan decision 31's TP-21 adds one call and no credit); a tile still at 1000 rows on its third page is recorded with `detail: page cap reached`. The execution's snapshot budget caps SearchApi at `min(--budget, 5)` and Travelpayouts at `EXECUTION_MAX_FREE_CALLS` (default 2000); a plan whose worst case exceeds that cap is refused before any call (exit 78), and a provider window with less room than the worst case refuses a live run (exit 65).

**Why these calls:**

- **TP-01…14** are a full worked-example scan, spec §5.2's "2 origins sharing LON × 2 destinations × 7 months = 14", so WP13 can replay a whole discovery. **TP-15…18** give WP6 airport-origin tiles for the no-shared-metro path. **TP-19** looks for the empty success envelope WP6's first failing test needs; it is best-effort and outside `requiredOk`. **TP-20** records the 401 body on a request key no success call shares. **TP-21** (plan decision 31, required) is the reverse-direction tile JFK → LON for the worked month: its rows depart from a westward origin, so WP6's replay test can check that every row's local departure month matches the tile month (UTC bucketing at month boundaries).
- **SA-01** records the 401 body on a cell one day past the rectangle on both sides; the chain's cell is chosen only inside the rectangle, so replay never confuses the two. **SA-02** is the calendar WP5 tiles from, in the exact shape WP5's tiler sends for the worked band (9 × 20 = 180; plan decision 29); **SA-03** settles the over-limit behaviour; **SA-04…06** record the chain on a cell the worked example would verify. When SA-02 yields no usable cell (a non-200, a timeout, no priced in-band cell), SA-03 to SA-06 are skipped: the run must be repeated anyway, so nothing more is spent (ruling on cost-wp4b-r2-004). For the same reason, a required call before SA-02 (TP-01…TP-18, TP-20, TP-21, SA-01) that did not answer as planned (a stale Travelpayouts token, a Travelpayouts outage, a timed-out SA-01) skips SA-02 to SA-06 with `skipped: required call(s) <ids> not as planned; the run must be repeated` (cost I-1, plan decision 30).
- **No 429 attempt** (plan decision 20). The trial's vendor limit is 20 % of the plan per hour and the run makes 6 SearchApi calls, so a 429 cannot be induced honestly; WP5 maps 429 with a synthetic labelled fixture and `rateLimitFallbackWaitSeconds`, and records that Retry-After behaviour is unverified against the vendor.

**Spend checks before the first call (exit 65).** Every invocation creates its own hidden execution. Before a live call the tool sums the SearchApi credits already ledgered to `trigger: 'tool'` executions inside the provider's budget window (the lifetime window on the trial plan, the billing month on 40usd; the status list is exhaustive at compile time) and refuses when that sum plus this run's worst case exceeds `--budget`, unless `--confirm-rerun` is passed. Separately, it refuses whenever the SearchApi window or the Travelpayouts month has less room than the run's worst case: a run that cannot finish never starts (cost-wp4b-r2-001), and `--confirm-rerun` does not lift that. The operator rule in Task 12b: after any failed live run, stop and ask before re-running.

**A retried attempt.** http-kit records every attempt. A SearchApi 5xx retried into a 200 leaves one extra file for that call, with the same request URL and a non-200 status, unbilled; the summary lists it, and Task 12b step 4 deletes that file only (ruling on prov-wp04b-r2-005). Every other failure keeps the whole session out of the commit.

**Ledger and dashboard.** Run the tool as the app's user: on a cleanly closed database its read-only lock probe leaves SQLite's empty `-wal`/`-shm` side files, owned by whoever ran it, and an app running as another user could not then open the database (sec2-003; WP12's setup docs carry the same rule). The run uses the production ledger, so the app's lifetime window sees these credits; `SEARCHAPI_TRIAL_USED` in the operator's `.env` stays what it is (the credits spent outside this app, 9 from the spike, while on the trial plan; ignored on 40usd). The dry run prints the window's used/cap figure. After the run, the dashboard's drop must be at most the ledger's `creditsUsed` (Task 12b step 5).

**Residual risk, documented (cost-wp4b-013).** If the connection drops after SearchApi has produced and billed a 200 but before the status line arrives, http-kit finalises the attempt as `error` (zero, not counted) and may retry; the vendor would then have billed one credit the ledger does not count. Over 6 calls this is unlikely; such a call's summary line reads `no-response (network; ledgered error, NOT counted …)`, and the dashboard check in Task 12b would show the difference; no code change here.

**Credentials** come from the operator's `.env` through `loadConfigFromEnv` only; the `tool` script loads the file with Node's `--env-file-if-exists`. Never print, `cat`, `echo`, `grep` or otherwise display `.env` or any key, and never pass a key on the command line.

## 8. Library notes

| Library | Version | API used | Verified against |
|---|---|---|---|
| `node:child_process` | Node 22+ (dev 26) | `spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout })` | https://nodejs.org/api/child_process.html (2026-10-14) |
| Node CLI | 22.9+ | `--conditions=@gmt/source`, `--env-file-if-exists=<path>`, `--import <module>` (twice: the DNS-refusal preload, then `tsx`) | https://nodejs.org/api/cli.html (2026-10-14); plan Task 0.1: Node and tsx resolve workspace packages to `dist` unless started with the condition. Verified in the assembly with every package's `dist` empty |
| `tsx` | 4.23.15 | `node --import tsx ./file.ts` | context7 `/privatenumber/tsx` (2026-10-14) |
| `vitest` | 5.0.4 | `describe`, `it(name, fn, timeoutMs)`, `it.each`, `it.skipIf`, `expect`, `beforeAll`, `afterEach`, `afterAll`, `vi.stubGlobal`, `vi.unstubAllGlobals`, `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })` (heartbeat) and `{ toFake: ['setTimeout', 'clearTimeout'] }` (http-kit's retry backoff, limiter spacing and request timeout), `vi.advanceTimersByTime`, `vi.advanceTimersByTimeAsync`, `vi.useRealTimers`; `setupFiles` in `vitest.config.ts` | context7 `/vitest-dev/vitest` docs/api/vi.md (2026-10-14); run in the assembly |
| `pino` | 10.4.0 | `pino({ level, redact: { paths, censor }, hooks: { streamWrite } }, destination)`, `pino.destination({ dest: fd, sync: true })` (docs/api.md: streamWrite rewrites the stringified line before any destination writes it); bracket paths `headers["x-access-token"]` and a leading wildcard `*.headers["X-Access-Token"]`; `logger.child(bindings)` | context7 `/pinojs/pino/v10.1.0` docs/redaction.md (2026-10-14); the logger tests exercise each path form |
| `better-sqlite3` | 13.0.3 (already `@gmt/db`'s dependency; nothing new in `@gmt/api`) | in `readOnlyLockState` only: `new Database(path, { readonly: true, fileMustExist: true })`, `prepare(sql).get()`, `close()` | used the same way by WP3's `backupDatabase`. Measured in the assembly: a read-only connection reads the `-wal`, so a live app's uncheckpointed heartbeat is seen; on a cleanly closed WAL database it creates empty `-wal`/`-shm` sidecars and writes nothing (the test asserts the database file's digest and mtime are unchanged and the `-wal` is empty). URI `immutable=1` is not available (better-sqlite3 opens without URI support) and would hide the live app's WAL anyway |
| `node:stream`, `node:fs` | Node 22+ | `new Writable({ write })` (test sinks only); `readdirSync(dir, { withFileTypes: true, recursive: true })` with `Dirent.parentPath` | https://nodejs.org/api/fs.html (2026-10-14) |
| msw | — | **not used by apps/api.** Vendor stand-ins replace `globalThis.fetch` with `vi.stubGlobal` (http-kit calls the global `fetch` for every non-fixture host); while stubbed, the stand-in is itself the barrier (it throws for any other host). WP4's `installNetworkGuards` in the setup file covers every unstubbed test, and `test/support/guards.test.ts` proves it live through `takeStrays()` | plan decisions 7, 18, 20 |
| internal | — | `@gmt/core`, `@gmt/db`, `@gmt/providers` as in section 4 | merged code |

## 9. Files

**Create**

- `apps/api/src/wiring.ts`, `apps/api/src/logger.ts`, `apps/api/src/safeMessage.ts`, `apps/api/src/bootstrap/tool.ts`, `apps/api/src/bootstrap/preflight.ts`
- `apps/api/src/tools/types.ts`, `recordRequests.ts`, `recordPlan.ts`, `recordParams.ts`, `recordExecution.ts`, `recordReport.ts`, `record.ts`, `workedExample.ts`
- `apps/api/test/support/setup.ts`, `noNetwork.mjs`, `guards.test.ts`, `logToFd.ts`
- `apps/api/test/helpers/env.ts`, `tmp.ts`, `vendors.ts`, `recording.ts`, `workedExampleTree.ts`
- `apps/api/test/tools/recordedHash.test.ts`, `recordPlan.test.ts`, `record.test.ts`, `allowlist.test.ts`
- `apps/api/test/wiring/loadConfig.test.ts`, `buildPorts.test.ts`; `apps/api/test/logger.test.ts`
- `apps/api/test/bootstrap/tool.test.ts`, `tool.spawn.test.ts`, `preflight.test.ts`; `apps/api/test/security/sentinel.test.ts`
- `apps/api/test/recorded/workedExampleTree.test.ts`, `manifest.test.ts`
- `packages/db/test/readOnlyLockState.test.ts`
- `packages/providers/fixtures/recorded/**` (the recorded tree and two `params-<date>.json`, Task 12b)

**Modify**

- `apps/api/vitest.config.ts`: `setupFiles`, single `include`/`coverage.include` entries (Task 1).
- `packages/db/src/appLock.ts`, `packages/db/src/index.ts`, `packages/db/test/barrel.test.ts`: `readOnlyLockState` and its export (Task 7).
- `packages/providers/src/http/recorder.ts`, `packages/providers/test/http/recorder.test.ts`: `assertRecordedRoot`, shared by the recorder, `loadRecordedJson` and WP4b's allowlist writer (Task 6, plan decision 30).
- `packages/providers/src/index.ts`, `packages/providers/test/barrel.test.ts`: export and assert `withContentHash` and `assertRecordedRoot` (Task 6) and `defaultRecordedRoot` (Task 8).
- `apps/api/package.json`: script `tool` (Task 9). No new dependency, no msw.
- root `package.json`: `record:fixtures` and `smoke:live` run `pnpm -C apps/api run tool …`, so the tool's exit code reaches the operator (plan decision 30, Task 9); `engines.node` is `>=22.9`, the first Node with `--env-file-if-exists` (arch M-10).
- `scripts/check-boundaries.mjs`: the msw rules and the `process.env` reader list (Task 9).

## 10. Tasks

Run every command from the repository root. The shared test helpers are written in Task 1 and extended in Task 6.

### Task 1: Recording requests and a verifiable recorded fixture (first failing test)

**Files:** create `apps/api/test/support/setup.ts`, `apps/api/test/helpers/{env,tmp,vendors}.ts`, `apps/api/test/tools/recordedHash.test.ts`, `apps/api/src/tools/recordRequests.ts`; modify `apps/api/vitest.config.ts`.

**Interfaces:** consumes `createHttpKit`, `createRecorder`, `SqliteBudgetGuard`, `budgetConfigFromConfig`, `installNetworkGuards`, `verifyRecordedFile`, `loadRecorded`. Produces `recordingLimits`, `tpUrl`, `saUrl`, `calendarParams`, `flightsParams`, the response readers, `Rect`, `CellDates`, `RECORD_TRAVEL_CLASS`, and the test helpers.

- [ ] **Step 1: Write the failing test** (with the test scaffolding it needs)

`apps/api/vitest.config.ts` (main's file plus `setupFiles`; the duplicated entries collapse to one):

```ts
// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'api',
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

```ts
// apps/api/test/support/setup.ts
// Vitest setup for @gmt/api (plan decisions 18 and 20): WP4's network guards — a catch-all msw handler that
// fails the test on any request no stand-in answered, and DNS lookups refused for the whole run. apps/api never
// imports msw itself; vendor stand-ins replace globalThis.fetch (test/helpers/vendors.ts).
import { installNetworkGuards } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';

installNetworkGuards({ beforeAll, afterEach, afterAll });
```

```ts
// apps/api/test/helpers/env.ts
// Test-only environment builders. Secrets are sentinels (brief README); nothing reads .env.
import type { Logger } from '@gmt/core';

export const SENTINEL_SA = 'test-searchapi-key-0123456789abcdef';
export const SENTINEL_TP = 'test-travelpayouts-token-0123456789abcdef';
export const SENTINEL_SMTP = 'test-smtp-pass-0123456789abcdef';
export const SENTINEL_AUTH = 'test-basic-auth-pass-0123';

/** Every variable core's parseConfig reads (spec §12), so a value in a developer shell never leaks into a test. */
export const ALL_VARS = [
  'NODE_ENV',
  'DATABASE_PATH',
  'PORT',
  'BIND_ADDRESS',
  'ALLOWED_HOSTS',
  'APP_BASE_URL',
  'APP_BASIC_AUTH_USER',
  'APP_BASIC_AUTH_PASS',
  'ALLOW_UNAUTHENTICATED',
  'TRUST_PROXY',
  'LOG_LEVEL',
  'POINT_OF_SALE',
  'STALE_AFTER_HOURS',
  'CALENDAR_STALE_AFTER_HOURS',
  'STUCK_AFTER_HOURS',
  'MAX_CELLS_PER_DEFINITION',
  'SCHEDULER_TIMEZONE',
  'AUTO_RESUME',
  'MAX_AUTO_RESUMES',
  'MAX_WAIT_SECONDS',
  'REQUEST_TIMEOUT_SECONDS',
  'ESTIMATE_RETRY_FACTOR',
  'FX_MAX_RATE_AGE_DAYS',
  'MONTHLY_SPEND_CAP_PENCE',
  'GLOBAL_BILLING_DAY',
  'SOFT_CONFIRM_PENCE',
  'EXECUTION_MAX_CALLS',
  'EXECUTION_MAX_FREE_CALLS',
  'EXECUTION_MAX_COST_PENCE',
  'CHILD_MAX_CALLS',
  'FIXTURE_COST_MICRO_GBP',
  'TRAVELPAYOUTS_TOKEN',
  'TRAVELPAYOUTS_BILLING_DAY',
  'TRAVELPAYOUTS_MONTHLY_CALL_CAP',
  'TRAVELPAYOUTS_RATE_PER_MINUTE',
  'TRAVELPAYOUTS_RATE_PER_HOUR',
  'TRAVELPAYOUTS_CONCURRENCY',
  'TRAVELPAYOUTS_CACHE_TTL_HOURS',
  'SEARCHAPI_KEY',
  'SEARCHAPI_PLAN',
  'SEARCHAPI_TRIAL_USED',
  'SEARCHAPI_BILLING_DAY',
  'SEARCHAPI_MONTHLY_CALL_CAP',
  'SEARCHAPI_RATE_PER_MINUTE',
  'SEARCHAPI_RATE_PER_HOUR',
  'SEARCHAPI_CONCURRENCY',
  'SEARCHAPI_CACHE_TTL_HOURS',
  'SEARCHAPI_COST_PER_CALL_MICRO_GBP',
  'SEARCHAPI_PLAN_FIXED_PENCE',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_TLS',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_EMAIL_TO',
  'ALERT_EMAIL_FROM',
  'IN_CONTAINER',
  'ALLOW_FIXTURE_PROVIDER',
] as const;

/** A complete env map: every variable blank (= unset, spec §12), then the overrides. */
export function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ALL_VARS) env[k] = '';
  return { ...env, ...overrides };
}

/** In-memory test env with both providers configured (sentinel credentials) and fast SearchApi limits. */
export function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
    SEARCHAPI_KEY: SENTINEL_SA,
    // why: http-kit smooths calls to ceil(60000 / ratePerMinute) ms apart (plan decision 17); the trial's 2/min and
    // Travelpayouts' 200/min would make a 26-call recording take minutes or seconds.
    SEARCHAPI_RATE_PER_MINUTE: '60000',
    SEARCHAPI_RATE_PER_HOUR: '600000',
    TRAVELPAYOUTS_RATE_PER_MINUTE: '60000',
    TRAVELPAYOUTS_RATE_PER_HOUR: '600000',
    ...extra,
  });
}

/** A development env for the tool bootstrap on a file database (the gate stays closed: no opt-in phrase). */
export function toolEnv(databasePath: string, extra: Record<string, string> = {}): Record<string, string> {
  return testEnv({ NODE_ENV: 'development', DATABASE_PATH: databasePath, LOG_LEVEL: 'error', ...extra });
}

/** A Logger that drops everything. */
export const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};
```

```ts
// apps/api/test/helpers/tmp.ts
// Temporary directories that are removed after every test (ts-017).
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const made: string[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
  for (const dir of made.splice(0)) {
    chmodSync(dir, 0o700); // why: a test may have made it read-only
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh directory under the OS temp dir, removed after the test. */
export function tempDir(prefix = 'gmt-api-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** `<tmp>/packages/providers/fixtures/recorded`, the shape the recorder requires (spec §5.5). */
export function tempRecordedRoot(): { repo: string; root: string } {
  const repo = tempDir('gmt-rec-');
  const root = join(repo, 'packages', 'providers', 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return { repo, root };
}

/** Runs `fn` after the test (database handles, stubs). */
export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}

/** Every file under `dir` (recordings, raw bodies and allowlists alike), sorted. */
export function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}
```

```ts
// apps/api/test/helpers/vendors.ts
// In-process stand-ins for the two vendors, shaped like spec §2 facts 1–5. Test bodies only; never committed: every
// identifier they invent carries STANDIN_MARKER, and the committed-tree check rejects any file holding it (prov-wp04b-006).
// why: msw is imported only by @gmt/providers/testing (plan decision 7). While stubbed, this function replaces the
// msw-patched fetch, so it is itself the barrier: it answers the two vendor hosts and throws for any other host; WP4's
// network guards (test/support/setup.ts) cover every test that does not stub fetch (r2-ts-006).
import { vi } from 'vitest';
import { SENTINEL_SA, SENTINEL_TP } from './env.js';

/**
 * The marker every stand-in identifier carries; the committed-tree check fails on it. why: a token that cannot occur in
 * vendor text, matched case-sensitively, so 'Outstanding legroom' in a real body never trips it (r3-ts-002).
 */
export const STANDIN_MARKER = 'gmt-standin-7f3a';

import { onCleanup } from './tmp.js';

export interface VendorLog {
  tp: URLSearchParams[];
  sa: URLSearchParams[];
  /** Every request as the vendor saw it: URL and header names (values never kept). */
  requests: Array<{ url: string; headerNames: string[] }>;
}

export interface VendorOptions {
  /** Rows a Travelpayouts page returns (default 1); 1000 makes the tool fetch the next page. */
  tpRows?: (p: URLSearchParams) => number;
  /** The calendar body: the default grid, or one with no priced in-band cell. */
  calendar?: 'default' | 'no-priced-cell';
  /** A vendor that echoes a real credential (ts-008): in the calendar's search_parameters, in a 401 body, in a Travelpayouts body. */
  echo?: 'calendar-parameters' | 'calendar-base64' | 'sa-401-bearer' | 'tp-body' | 'tp-bearer';
  /** A failure for chosen requests (r2-ts-004): an HTTP 500 or 429, a socket error, or no answer until the client aborts. */
  failOn?: (url: URL) => 'http-500' | 'http-429' | 'network' | 'hang' | undefined;
  /** Step 1 answers with priced options that carry no departure_token. */
  step1WithoutToken?: boolean;
  /** Step 3 answers 200 with no booking option. */
  step3Empty?: boolean;
  /** How the vendor answers more than 200 combinations (spec §2 fact 2 versus the docs). */
  overLimit?: '400' | 'empty-200';
  /** Called before each answer (e.g. to abort the run after a given call). */
  onRequest?: (url: URL) => void;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function inclusiveDays(from: string | null, to: string | null): number {
  if (from === null || to === null) return 0;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

/** The default calendar: the global minimum lies outside the 10–21-night band, an unpriced cell carries a price field. */
const CALENDAR = [
  { departure: '2027-03-01', return: '2027-03-29', price: 380 },
  { departure: '2027-03-04', return: '2027-03-16', has_no_flights: true, price: 390 },
  { departure: '2027-03-03', return: '2027-03-15', price: 640 },
  { departure: '2027-03-02', return: '2027-03-16', price: 603, is_lowest_price: true },
];

/** Stand-in tokens; the cheapest priced option of each step is the one the tool must follow. */
export const DT = {
  unpriced: `${STANDIN_MARKER}-DT-unpriced`,
  dearer: `${STANDIN_MARKER}-DT-dearer`,
  cheapest: `${STANDIN_MARKER}-DT-cheapest`,
};
export const BT = {
  unpriced: `${STANDIN_MARKER}-BT-unpriced`,
  dearer: `${STANDIN_MARKER}-BT-dearer`,
  cheapest: `${STANDIN_MARKER}-BT-cheapest`,
};

function failure(
  how: 'http-500' | 'http-429' | 'network' | 'hang',
  init: RequestInit | undefined,
): Promise<Response> {
  if (how === 'http-500') return Promise.resolve(json({ error: 'internal error' }, 500));
  if (how === 'http-429')
    return Promise.resolve(json({ error: 'Too many requests.' }, 429, { 'retry-after': '0' }));
  if (how === 'network') return Promise.reject(new TypeError('fetch failed'));
  // why: settle on abort, so http-kit's request timeout ends the call inside the process
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
      once: true,
    });
  });
}

function tpAnswer(url: URL, headers: Headers, opts: VendorOptions): Response {
  const p = url.searchParams;
  if (headers.get('x-access-token') !== SENTINEL_TP)
    return new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } });
  if (p.get('departure_at') === '2028-02') return json({ success: true, data: [], currency: 'gbp' });
  if (opts.echo === 'tp-body')
    return json({ success: true, data: [], currency: 'gbp', debug: `X-Access-Token: ${SENTINEL_TP}` });
  if (opts.echo === 'tp-bearer')
    return json({ success: true, data: [], currency: 'gbp', note: `Bearer ${SENTINEL_TP}` });
  const n = opts.tpRows?.(p) ?? 1;
  // why: the reverse tile (TP-21, plan decision 31) departs westward-local: 22:30 on 31 March in New York is already
  // 1 April in UTC, the month-boundary case WP6 checks
  const reverse = p.get('origin') === 'JFK';
  const row = {
    origin: p.get('origin'),
    destination: p.get('destination'),
    origin_airport: reverse ? 'JFK' : 'LHR',
    destination_airport: reverse ? 'LHR' : p.get('destination'),
    price: 412,
    airline: 'ZZ',
    flight_number: '9999',
    departure_at: reverse ? '2027-03-31T22:30:00-04:00' : '2027-03-02T08:25:00+00:00',
    return_at: reverse ? '2027-04-14T08:00:00+01:00' : '2027-03-16T18:00:00-04:00',
    transfers: 0,
    return_transfers: 0,
    link: `/search/${STANDIN_MARKER}-${reverse ? '3103-1404' : '0203-1603'}`,
  };
  return json({ success: true, currency: 'gbp', data: Array.from({ length: n }, () => row) }, 200, {
    'x-ratelimit-remaining': '599',
  });
}

function saAnswer(url: URL, headers: Headers, opts: VendorOptions): Response {
  const p = url.searchParams;
  if (headers.get('authorization') !== `Bearer ${SENTINEL_SA}`)
    return json({ error: 'Invalid API key.' }, 401);
  const engine = p.get('engine');
  if (opts.echo === 'sa-401-bearer' && engine === 'google_flights_calendar')
    return json({ error: `Invalid API key: Bearer ${SENTINEL_SA}` }, 401);
  if (engine === 'google_flights_calendar') {
    const combos =
      inclusiveDays(p.get('outbound_date_start'), p.get('outbound_date_end')) *
      inclusiveDays(p.get('return_date_start'), p.get('return_date_end'));
    if (combos > 200)
      return opts.overLimit === 'empty-200'
        ? json({ search_metadata: { id: `${STANDIN_MARKER}-cal-empty` } })
        : json({ error: 'Too many date combinations: the maximum is 200.' }, 400);
    const calendar =
      opts.calendar === 'no-priced-cell'
        ? CALENDAR.map((e) => ({ departure: e.departure, return: e.return, has_no_flights: true }))
        : CALENDAR;
    return json({
      search_metadata: {
        id: `${STANDIN_MARKER}-cal-1`,
        request_url: 'https://www.searchapi.io/api/v1/search?engine=google_flights_calendar&departure_id=LHR',
        json_endpoint: `https://user:pw@www.searchapi.io/api/v1/searches/${STANDIN_MARKER}-cal-1.json`,
      },
      search_parameters: {
        engine,
        gl: p.get('gl'),
        currency: p.get('currency'),
        ...(opts.echo === 'calendar-parameters' ? { api_key: SENTINEL_SA } : {}),
        ...(opts.echo === 'calendar-base64'
          ? { key_b64: Buffer.from(SENTINEL_SA, 'utf8').toString('base64') }
          : {}),
      },
      calendar,
    });
  }
  if (engine === 'google_flights') {
    const dt = p.get('departure_token');
    const bt = p.get('booking_token');
    if (dt === null && bt === null)
      return json({
        best_flights: opts.step1WithoutToken
          ? [{ price: 603 }, { price: 655 }]
          : [{ departure_token: DT.unpriced }, { price: 655, departure_token: DT.dearer }],
        other_flights: opts.step1WithoutToken ? [] : [{ price: 603, departure_token: DT.cheapest }],
        price_insights: { lowest_price: 590, price_history: [[1790000000, 610]] },
      });
    if (dt === DT.cheapest && bt === null)
      return json({
        best_flights: [{ booking_token: BT.unpriced }, { price: 640, booking_token: BT.dearer }],
        other_flights: [{ price: 603, booking_token: BT.cheapest }],
      });
    if (bt === BT.cheapest && dt === null)
      return json({
        booking_options: opts.step3Empty
          ? []
          : [
              {
                book_with: 'Airline',
                price: 603,
                booking_request: {
                  url: `https://www.google.com/travel/clk/f?booking_token=${BT.cheapest}`,
                  post_data: 'u=airline',
                },
              },
              {
                book_with: 'OTA',
                price: 573,
                booking_request: {
                  url: `https://www.google.com/travel/clk/f?booking_token=${BT.cheapest}`,
                  post_data: 'u=ota',
                },
              },
            ],
      });
  }
  return json({ error: 'unexpected request' }, 400);
}

/** Replaces globalThis.fetch with the two stand-ins for this test (restored afterwards). */
export function stubVendors(opts: VendorOptions = {}): VendorLog {
  const seen: VendorLog = { tp: [], sa: [], requests: [] };
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    const headers = new Headers(init?.headers);
    seen.requests.push({ url: url.href, headerNames: [...headers.keys()] });
    opts.onRequest?.(url);
    const fail = opts.failOn?.(url);
    if (fail !== undefined) {
      if (url.hostname === 'www.searchapi.io') seen.sa.push(url.searchParams);
      else seen.tp.push(url.searchParams);
      return failure(fail, init);
    }
    if (url.hostname === 'api.travelpayouts.com') {
      seen.tp.push(url.searchParams);
      return tpAnswer(url, headers, opts);
    }
    if (url.hostname === 'www.searchapi.io') {
      seen.sa.push(url.searchParams);
      return saAnswer(url, headers, opts);
    }
    throw new TypeError(`no stand-in for ${url.origin}`);
  };
  vi.stubGlobal('fetch', fake);
  onCleanup(() => vi.unstubAllGlobals());
  return seen;
}
```

```ts
// apps/api/test/tools/recordedHash.test.ts
// Spec §5.5 / §9 item 2 / §16 WP4b first failing test: a fixture recorded through the real http-kit and recorder
// carries a content hash, session and allowlisted response headers that WP4's verifier accepts, and an edit fails it.
import { readFileSync, writeFileSync } from 'node:fs';
import { asIsoDateTime, fixedClock, parseConfig, Secret } from '@gmt/core';
import {
  applyMigrations,
  budgetConfigFromConfig,
  MIGRATIONS_DIR,
  openDatabase,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import { createHttpKit, createRecorder } from '@gmt/providers';
import { loadRecorded, verifyRecordedFile } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { recordingLimits, tpUrl } from '../../src/tools/recordRequests.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';
import { onCleanup, tempRecordedRoot } from '../helpers/tmp.js';
import { stubVendors } from '../helpers/vendors.js';

const AT = asIsoDateTime('2026-10-20T09:00:00.000Z');
const SECRETS = [new Secret(SENTINEL_TP), new Secret(SENTINEL_SA)];

async function recordOneTile(): Promise<{ root: string; path: string }> {
  const parsed = parseConfig(testEnv(), { realpath: (p) => p });
  if (!parsed.ok) throw new Error('test env should parse');
  const { travelpayouts: tp, searchapi: sa } = parsed.config.providers;
  if (tp === null || sa === null) throw new Error('both providers are configured in testEnv');
  const db = openDatabase(':memory:');
  onCleanup(() => db.close());
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = fixedClock(AT);
  const { root } = tempRecordedRoot();
  const written: string[] = [];
  const inner = createRecorder({
    root,
    secrets: SECRETS,
    clock,
    recordedBy: '@gmt/api record:fixtures (test)',
  });
  const http = createHttpKit({
    budget: new SqliteBudgetGuard(db, budgetConfigFromConfig(parsed.config), clock),
    cache: new SqliteResponseCache(db, clock),
    limits: recordingLimits(tp, sa, parsed.config),
    clock,
    log: silentLog,
    secrets: SECRETS,
    syntheticAllowed: false,
    recorder: {
      record: async (r) => {
        const p = await inner.record(r);
        written.push(p);
        return p;
      },
    },
  });
  stubVendors();
  const url = tpUrl('LON', 'JFK', '2027-03', 1);
  const res = await http.request({
    providerId: 'travelpayouts',
    executionId: null,
    tileIndex: 0,
    endpointPath: url.pathname,
    method: 'GET',
    url,
    headers: { 'X-Access-Token': SENTINEL_TP },
    cache: 'never',
    signal: new AbortController().signal,
    recordFixtures: true,
  });
  expect(res.status).toBe(200);
  const path = written[0];
  if (path === undefined) throw new Error('nothing recorded');
  return { root, path };
}

describe('recorded fixture content hash (spec §5.5, WP4b first failing test)', () => {
  it('a tile recorded through http-kit verifies, with recordedAt = fetchedAt, a session and allowlisted response headers', async () => {
    const { root, path } = await recordOneTile();
    expect(path).toMatch(
      /[/\\]travelpayouts[/\\]_aviasales_v3_prices_for_dates[/\\]2026-10-20-[0-9a-f]{12}\.json$/,
    );
    expect(verifyRecordedFile(path, root, SECRETS)).toEqual([]);
    const [file] = loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates');
    expect(file?.recordedAt).toBe(AT);
    expect(file?.session).toMatch(/\S/);
    expect(file?.responseHeaders).toEqual({
      'content-type': 'application/json',
      'x-ratelimit-remaining': '599',
    });
    expect(new URL(file?.request.url ?? '').searchParams.get('departure_at')).toBe('2027-03'); // query kept
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain(SENTINEL_TP);
    // why: the WP0 secret scan rejects the literal header name, so credential headers are dropped, not scrubbed
    expect(text).not.toMatch(/X-Access-Token/i);
  });

  it('a hand-edited file fails verification', async () => {
    const { root, path } = await recordOneTile();
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    writeFileSync(path, JSON.stringify({ ...parsed, status: 201 }));
    expect(verifyRecordedFile(path, root, SECRETS).join('\n')).toMatch(/hash/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/recordedHash.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/tools/recordRequests.js' imported from …/apps/api/test/tools/recordedHash.test.ts`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/tools/recordRequests.ts
/**
 * Hand-built vendor requests and response readers for record:fixtures (brief section 6, spec §5.2,
 * §5.4, docs/providers.md). Credentials go in headers only (spec §2 fact 8); nothing here is an
 * airport, every code arrives as an argument.
 */
import { type Config, daysBetween, type IsoDate, isoDateSchema } from '@gmt/core';
import type { HttpKitDeps } from '@gmt/providers';

export const TP_URL = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
export const SA_URL = 'https://www.searchapi.io/api/v1/search';
/** Spec §5.2 measured page size. */
export const TP_PAGE_LIMIT = 1000;
/** Deliberately invalid credentials for the 401 probes; not secrets, never real keys. */
export const INVALID_SEARCHAPI_KEY = 'invalid-key-for-401-recording';
export const INVALID_TRAVELPAYOUTS_TOKEN = 'invalid-token-for-401-recording';

/** The worked example's cabin, sent as SearchApi `travel_class` on every request (spec §5.4, plan decision 20). */
export const RECORD_TRAVEL_CLASS = 'economy';

/** Passengers on every SearchApi request, sent explicitly (plan decision 24; vendor default 1). */
export const RECORD_ADULTS = '1';
/** google_flights only (plan decision 24): results sorted by price. */
export const RECORD_SORT_BY = 'price';
/** Both engines (plan decisions 24 and 29; the vendor documents it for both): separate-ticket itineraries excluded. */
export const RECORD_SEPARATE_TICKETS = '1';

/** A calendar rectangle (spec §5.2): outbound and return date ranges, both inclusive. */
export interface Rect {
  outFrom: IsoDate;
  outTo: IsoDate;
  retFrom: IsoDate;
  retTo: IsoDate;
  combinations: number;
}
/** One cell's dates. */
export interface CellDates {
  departure: IsoDate;
  return: IsoDate;
}

/**
 * Vendor limits while recording, from the configured provider limits (no preset fallback: the tool's
 * precheck has refused a missing provider). why: httpLimitsFor gains these providers only when WP5/WP6
 * add their lines; WP4b records before either exists. Costs equal the guard's configured per-call rates,
 * which reserve requires (WP3 rule 'cost'). Follow-up (arch M-5): once WP5/WP6 land, the body becomes
 * `{ travelpayouts: travelpayoutsHttpLimits(…), searchapi: searchApiHttpLimits(…) }`, so each vendor's hosts, billing
 * mode and classifyError have one definition.
 */
export function recordingLimits(
  tp: NonNullable<Config['providers']['travelpayouts']>,
  sa: NonNullable<Config['providers']['searchapi']>,
  timing: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): HttpKitDeps['limits'] {
  const t = { maxWaitSeconds: timing.maxWaitSeconds, requestTimeoutSeconds: timing.requestTimeoutSeconds };
  return {
    travelpayouts: {
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: tp.limits.ratePerMinute,
      ratePerHour: tp.limits.ratePerHour,
      concurrency: tp.limits.concurrency,
      billable: 'never',
      costPerCallMicroGbp: tp.limits.costPerCallMicroGbp,
      ...t,
    },
    searchapi: {
      hosts: ['www.searchapi.io'],
      ratePerMinute: sa.limits.ratePerMinute,
      ratePerHour: sa.limits.ratePerHour,
      concurrency: sa.limits.concurrency,
      billable: 'http-200',
      costPerCallMicroGbp: sa.limits.costPerCallMicroGbp,
      ...t,
    },
  };
}

/** One prices_for_dates page (spec §5.2 Travelpayouts month tiles). */
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
export function calendarParams(
  origin: string,
  destination: string,
  r: Rect,
  gl: string,
): Record<string, string> {
  return {
    engine: 'google_flights_calendar',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: r.outFrom,
    outbound_date_start: r.outFrom,
    outbound_date_end: r.outTo,
    return_date: r.retFrom,
    return_date_start: r.retFrom,
    return_date_end: r.retTo,
    flight_type: 'round_trip',
    travel_class: RECORD_TRAVEL_CLASS,
    adults: RECORD_ADULTS,
    separate_tickets: RECORD_SEPARATE_TICKETS,
    currency: 'GBP',
    gl,
    hl: 'en',
  };
}

/** google_flights for one cell; steps 2 and 3 add one token (spec §5.4). */
export function flightsParams(
  origin: string,
  destination: string,
  cell: CellDates,
  gl: string,
  token: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: cell.departure,
    return_date: cell.return,
    flight_type: 'round_trip',
    travel_class: RECORD_TRAVEL_CLASS,
    adults: RECORD_ADULTS,
    sort_by: RECORD_SORT_BY,
    separate_tickets: RECORD_SEPARATE_TICKETS,
    currency: 'GBP',
    gl,
    hl: 'en',
    ...token,
  };
}

/** Plain-object guard for vendor JSON; the one copy the record tool's modules share. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Cheapest priced calendar entry inside the requested rectangle whose nights fall inside `band` (pie-006: the chain
 * is recorded for a cell the worked example would verify; prov-wp04b-r2-002: an entry outside the rectangle the vendor
 * returns anyway is ignored, so step 1 can never equal the 401 probe's cell). Entries with has_no_flights, no price or
 * malformed dates are skipped.
 */
export function cheapestCalendarCell(
  body: unknown,
  band: { minNights: number; maxNights: number },
  rect: Rect,
): (CellDates & { price: number }) | null {
  if (!isRecord(body) || !Array.isArray(body.calendar)) return null;
  let best: (CellDates & { price: number }) | null = null;
  for (const e of body.calendar) {
    if (!isRecord(e) || e.has_no_flights === true || typeof e.price !== 'number') continue;
    const departure = isoDateSchema.safeParse(e.departure);
    const ret = isoDateSchema.safeParse(e.return);
    if (!departure.success || !ret.success) continue;
    if (
      departure.data < rect.outFrom ||
      departure.data > rect.outTo ||
      ret.data < rect.retFrom ||
      ret.data > rect.retTo
    )
      continue;
    const nights = daysBetween(departure.data, ret.data);
    if (nights < band.minNights || nights > band.maxNights) continue;
    if (best === null || e.price < best.price)
      best = { departure: departure.data, return: ret.data, price: e.price };
  }
  return best;
}

/** True when a calendar body carries no priced entry (the over-limit probe's "empty response" from the docs). */
export function calendarIsEmpty(body: unknown): boolean {
  return !isRecord(body) || !Array.isArray(body.calendar) || body.calendar.length === 0;
}

/** Cheapest option carrying a price and the given token, over best_flights then other_flights; unpriced options are skipped (spec §5.4). */
export function cheapestOption(
  body: unknown,
  tokenField: 'departure_token' | 'booking_token',
): { token: string; price: number } | null {
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

/** Step-3 booking options as (seller, price), cheapest first; options without both are skipped. */
export function bookingOptions(body: unknown): Array<{ bookWith: string; price: number }> {
  if (!isRecord(body) || !Array.isArray(body.booking_options)) return [];
  const out: Array<{ bookWith: string; price: number }> = [];
  for (const o of body.booking_options) {
    if (isRecord(o) && typeof o.book_with === 'string' && typeof o.price === 'number')
      out.push({ bookWith: o.book_with, price: o.price });
  }
  return out.sort((a, b) => a.price - b.price);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/recordedHash.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: recording requests and a fixture recorded through http-kit that WP4's verifier accepts"
```

### Task 2: `loadConfigFromEnv` and `tolerantRealpath`

**Files:** create `apps/api/src/wiring.ts` (part 1), `apps/api/test/wiring/loadConfig.test.ts`.

**Interfaces:** consumes `parseConfig`, `Config`, `ConfigError`, `syntheticAllowed`. Produces `loadConfigFromEnv`, `InvalidConfigError`, `tolerantRealpath`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/wiring/loadConfig.test.ts
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, syntheticAllowed } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { InvalidConfigError, loadConfigFromEnv, tolerantRealpath } from '../../src/wiring.js';
import { ALL_VARS, cleanEnv, SENTINEL_SMTP, testEnv } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

describe('tolerantRealpath (spec §5.5: databasePath is realpath-resolved before the config is built)', () => {
  it('passes :memory: through', () => {
    expect(tolerantRealpath(':memory:')).toBe(':memory:');
  });
  it('resolves an existing file through a symlinked directory', () => {
    const real = tempDir();
    writeFileSync(join(real, 'a.db'), '');
    const link = join(tempDir(), 'link');
    symlinkSync(real, link);
    expect(tolerantRealpath(join(link, 'a.db'))).toBe(join(realpathSync(real), 'a.db'));
  });
  it('resolves a missing file by its directory', () => {
    const real = tempDir();
    const link = join(tempDir(), 'link');
    symlinkSync(real, link);
    expect(tolerantRealpath(join(link, 'new.db'))).toBe(join(realpathSync(real), 'new.db'));
  });
  it('throws when the directory itself is missing', () => {
    expect(() => tolerantRealpath(join(tempDir(), 'missing', 'nested', 'a.db'))).toThrow(/ENOENT/);
  });
  it('refuses a dangling symlink, whose own name could pass the .fixture.db suffix (prov-wp04b-001)', () => {
    const dir = tempDir();
    symlinkSync(join(dir, 'prod.db'), join(dir, 'x.fixture.db'));
    expect(() => tolerantRealpath(join(dir, 'x.fixture.db'))).toThrow(
      /symbolic link to a file that does not exist/,
    );
  });
});

describe('loadConfigFromEnv (plan "Wiring and bootstraps")', () => {
  it('returns the parsed config with a realpath-resolved database path', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'data'));
    const config = loadConfigFromEnv(
      testEnv({ NODE_ENV: 'development', DATABASE_PATH: join(dir, 'data', 'dev.db') }),
    );
    expect(config.databasePath).toBe(join(realpathSync(dir), 'data', 'dev.db'));
    expect(config.providers.searchapi).not.toBeNull();
  });

  it('throws InvalidConfigError naming every invalid field and never echoing a value', () => {
    const env = cleanEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '0.0.0.0',
      SMTP_PASS: SENTINEL_SMTP,
    });
    const direct = parseConfig(env, { realpath: tolerantRealpath });
    if (direct.ok) throw new Error('fixture env should be invalid');
    expect(direct.errors.length).toBeGreaterThanOrEqual(2);
    let caught: unknown;
    try {
      loadConfigFromEnv(env);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidConfigError);
    if (!(caught instanceof InvalidConfigError)) return;
    expect(caught.errors).toEqual(direct.errors);
    for (const { field } of direct.errors) expect(caught.message).toContain(field);
    expect(caught.message).not.toContain(SENTINEL_SMTP);
  });

  it('reports an unresolvable DATABASE_PATH as that field', () => {
    expect(() =>
      loadConfigFromEnv(
        testEnv({ NODE_ENV: 'development', DATABASE_PATH: join(tempDir(), 'no', 'such', 'x.db') }),
      ),
    ).toThrow(/DATABASE_PATH: cannot be resolved/);
  });

  it('a .fixture.db symlink to an existing production file closes the synthetic gate (spec §5.5 symlink case)', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'prod.db'), '');
    symlinkSync(join(dir, 'prod.db'), join(dir, 'x.fixture.db'));
    const config = loadConfigFromEnv(
      testEnv({
        NODE_ENV: 'development',
        ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake',
        DATABASE_PATH: join(dir, 'x.fixture.db'),
      }),
    );
    expect(config.databasePath.endsWith('prod.db')).toBe(true);
    expect(syntheticAllowed(config)).toBe(false);
  });

  it('ALL_VARS names every variable core parseConfig reads, so test envs blank all of them (arch-017)', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../../../packages/core/src/config/schema.ts', import.meta.url)),
      'utf8',
    );
    const quoted = [...schema.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)].map((m) => m[1] ?? '');
    const prefixes = [...schema.matchAll(/providerLimits\(r, '([A-Z]+)'/g)].map((m) => m[1] ?? '');
    const suffixes = [...schema.matchAll(/`\$\{prefix\}_([A-Z_]+)`/g)].map((m) => m[1] ?? '');
    const names = new Set([
      ...quoted.filter((n) => !prefixes.includes(n)),
      ...prefixes.flatMap((p) => suffixes.map((s) => `${p}_${s}`)),
    ]);
    const known: readonly string[] = ALL_VARS;
    expect([...names].filter((n) => !known.includes(n))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/loadConfig.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/wiring.js' imported from …/apps/api/test/wiring/loadConfig.test.ts`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/wiring.ts (part 1 of 2; Task 3 replaces the file)
/**
 * The wiring helper (part 1 of 2; Task 3 completes the file): one config parse and one port construction shared by the app bootstrap (WP8)
 * and the tool bootstrap (this package). Spec §4 (both bootstraps are built on this helper and parse the
 * environment once through the core schema), §5.5, §7, §12.
 *
 * This module never reads the process environment: the bootstraps pass it in (the boundary script enforces it).
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Config, type ConfigError, parseConfig } from '@gmt/core';

/** Thrown by loadConfigFromEnv; the message names every failing field and never a value (spec §12). */
export class InvalidConfigError extends Error {
  readonly errors: readonly ConfigError[];
  constructor(errors: readonly ConfigError[]) {
    super(`invalid configuration: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
    this.name = 'InvalidConfigError';
    this.errors = errors;
  }
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

/**
 * realpath that tolerates a database file that does not exist yet by resolving its directory
 * (plan Config contract). Spec §5.5: the synthetic gate's suffix checks run on the resolved path.
 * A dangling symlink is refused: its own name could pass the `.fixture.db` suffix check while
 * SQLite would create the file it points at (prov-wp04b-001).
 */
export function tolerantRealpath(p: string): string {
  if (p === ':memory:') return p;
  try {
    return realpathSync(p);
  } catch (e) {
    if (errnoCode(e) !== 'ENOENT') throw e;
    let dangling = false;
    try {
      dangling = lstatSync(p).isSymbolicLink();
    } catch {
      // why: lstat ENOENT means nothing exists at p, the first-boot case handled below.
    }
    if (dangling)
      throw new Error(`${p} is a symbolic link to a file that does not exist; refusing (spec §5.5)`);
    // why: a first boot has no DB file yet; a missing *directory* still fails, as it should.
    return join(realpathSync(dirname(p)), basename(p));
  }
}

/**
 * Parses the environment once through the core schema (spec §12). Throws InvalidConfigError naming
 * every bad field; a DATABASE_PATH that cannot be resolved is reported as that field, never a value.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config {
  let result: ReturnType<typeof parseConfig>;
  try {
    result = parseConfig(env, { realpath: tolerantRealpath });
  } catch (e) {
    throw new InvalidConfigError([
      {
        field: 'DATABASE_PATH',
        message: `cannot be resolved (${errnoCode(e) ?? (e instanceof Error ? e.message : 'error')})`,
      },
    ]);
  }
  if (!result.ok) throw new InvalidConfigError(result.errors);
  return result.config;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/loadConfig.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: loadConfigFromEnv with a realpath-resolved database path and dangling-symlink refusal"
```

### Task 3: `buildPorts`, `httpLimitsFor`, `providersFor`

**Files:** modify `apps/api/src/wiring.ts`; create `apps/api/test/wiring/buildPorts.test.ts`.

**Interfaces:** consumes `createRepos`, `budgetConfigFromConfig`, `SqliteBudgetGuard`, `SqliteResponseCache`, `createHttpKit`, `fixtureHttpLimits`, `fixtureProvider`, `fixtureRouter`, `defaultFixtureRoot`, `MIGRATIONS_DIR`. Produces `Ports`, `buildPorts`, `httpLimitsFor`, `providersFor`, `collectSecrets`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/wiring/buildPorts.test.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AppLock, budgetConfigFromConfig, MIGRATIONS_DIR } from '@gmt/db';
import { defaultFixtureRoot } from '@gmt/providers/fixture';
import { describe, expect, it } from 'vitest';
import { buildPorts, httpLimitsFor, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';
import { onCleanup, tempDir } from '../helpers/tmp.js';

const FIXTURE_COST = { FIXTURE_COST_MICRO_GBP: '3200' };

function ports(env: Record<string, string>) {
  const p = buildPorts(loadConfigFromEnv(env), {
    log: silentLog,
    clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => p.db.close());
  return p;
}

describe('buildPorts (plan "Wiring and bootstraps")', () => {
  it('under syntheticAllowed (test + :memory:) builds a migrated DB, the fixture provider and the in-process fixture host', async () => {
    const p = ports(testEnv(FIXTURE_COST));
    expect(p.providers.map((x) => x.id)).toEqual(['fixture']);
    expect(p.fixtureRoot).toBe(defaultFixtureRoot());
    expect(p.recorder).toBeNull();
    expect(p.repos.airports.count()).toBe(0); // table exists: migrations applied
    expect(AppLock.inspect(p.db)).toBeNull();
    expect(p.secrets.map((s) => s.reveal()).sort()).toEqual([SENTINEL_SA, SENTINEL_TP].sort());
    expect(JSON.stringify(p.secrets)).not.toContain(SENTINEL_SA); // Secret#toJSON redacts
  });

  it('in production builds no provider and no fixture host, and a fixture.local request is refused; migrations are idempotent', async () => {
    const path = join(tempDir(), 'prod.db');
    const env = testEnv({ NODE_ENV: 'production', DATABASE_PATH: path });
    for (let i = 0; i < 2; i++) {
      const p = ports(env);
      expect(p.providers).toEqual([]);
      expect(p.fixtureRoot).toBeNull();
      const url = new URL('http://fixture.local/calendar');
      await expect(
        p.http.request({
          providerId: 'fixture',
          executionId: null,
          tileIndex: 0,
          endpointPath: url.pathname,
          method: 'GET',
          url,
          headers: {},
          cache: 'never',
          signal: new AbortController().signal,
          recordFixtures: false,
        }),
      ).rejects.toThrow(
        'fixture /calendar: egress denied (no HTTP limits configured for this provider) [egress-denied]',
      );
      expect(p.db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get()).toEqual({ n: 0 });
    }
    expect(existsSync(path)).toBe(true);
  });

  it.each([
    ['development without the opt-in phrase', { NODE_ENV: 'development', DATABASE_PATH: 'x.fixture.db' }],
    [
      'development with the phrase but a non-.fixture.db path',
      { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake', DATABASE_PATH: 'x.db' },
    ],
    [
      'production with the phrase',
      {
        NODE_ENV: 'production',
        ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake',
        DATABASE_PATH: 'x.fixture.db',
      },
    ],
  ])('the synthetic gate stays closed: %s (ts-012)', (_name, extra) => {
    const dir = tempDir();
    const p = ports(testEnv({ ...extra, DATABASE_PATH: join(dir, extra.DATABASE_PATH) }));
    expect(p.providers).toEqual([]);
    expect(p.fixtureRoot).toBeNull();
    expect(Object.keys(httpLimitsFor(p.config))).toEqual(['fx']);
  });

  it('fails, closing the handle, when the migrations directory is missing', () => {
    expect(() =>
      buildPorts(loadConfigFromEnv(testEnv()), { log: silentLog, migrationsDir: '/nonexistent/drizzle' }),
    ).toThrow(/migration failed/);
  });

  it('httpLimitsFor at WP4b: fixture (WP4 fixtureHttpLimits at the configured cost) only under syntheticAllowed, fx always', () => {
    const config = loadConfigFromEnv(testEnv(FIXTURE_COST));
    const limits = httpLimitsFor(config);
    expect(Object.keys(limits).sort()).toEqual(['fixture', 'fx']);
    // why: the guard refuses any reserve whose cost differs from its configured rate (WP3 rule 'cost'), so both read config
    expect(limits.fixture?.costPerCallMicroGbp).toBe(3200);
    expect(limits.fixture?.costPerCallMicroGbp).toBe(
      budgetConfigFromConfig(config).providers.fixture?.costPerCallMicroGbp,
    );
    expect(limits.fx).toMatchObject({
      hosts: ['api.frankfurter.dev'],
      billable: 'never',
      costPerCallMicroGbp: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/buildPorts.test.ts`
Expected: FAIL, first failure `TypeError: buildPorts is not a function`.

- [ ] **Step 3: Implement** — the whole file (part 1 unchanged, its imports merged):

```ts
// apps/api/src/wiring.ts
/**
 * The wiring helper: one config parse and one port construction shared by the app bootstrap (WP8)
 * and the tool bootstrap (this package). Spec §4 (both bootstraps are built on this helper and parse the
 * environment once through the core schema), §5.5, §7, §12.
 *
 * This module never reads the process environment: the bootstraps pass it in (the boundary script enforces it).
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type BudgetGuard,
  type Clock,
  type Config,
  type ConfigError,
  type FlightProvider,
  type Logger,
  parseConfig,
  type ResponseCache,
  type Secret,
  syntheticAllowed,
  systemClock,
} from '@gmt/core';
import {
  type AirportsRepo,
  applyMigrations,
  budgetConfigFromConfig,
  createRepos,
  type Db,
  openDatabase,
  type Repos,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import {
  createHttpKit,
  type FixtureRecorder,
  fixtureHttpLimits,
  fixtureProvider,
  type HttpKit,
  type HttpKitDeps,
} from '@gmt/providers';
import { defaultFixtureRoot, fixtureRouter } from '@gmt/providers/fixture';

/** Thrown by loadConfigFromEnv; the message names every failing field and never a value (spec §12). */
export class InvalidConfigError extends Error {
  readonly errors: readonly ConfigError[];
  constructor(errors: readonly ConfigError[]) {
    super(`invalid configuration: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
    this.name = 'InvalidConfigError';
    this.errors = errors;
  }
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

/**
 * realpath that tolerates a database file that does not exist yet by resolving its directory
 * (plan Config contract). Spec §5.5: the synthetic gate's suffix checks run on the resolved path.
 * A dangling symlink is refused: its own name could pass the `.fixture.db` suffix check while
 * SQLite would create the file it points at (prov-wp04b-001).
 */
export function tolerantRealpath(p: string): string {
  if (p === ':memory:') return p;
  try {
    return realpathSync(p);
  } catch (e) {
    if (errnoCode(e) !== 'ENOENT') throw e;
    let dangling = false;
    try {
      dangling = lstatSync(p).isSymbolicLink();
    } catch {
      // why: lstat ENOENT means nothing exists at p, the first-boot case handled below.
    }
    if (dangling)
      throw new Error(`${p} is a symbolic link to a file that does not exist; refusing (spec §5.5)`);
    // why: a first boot has no DB file yet; a missing *directory* still fails, as it should.
    return join(realpathSync(dirname(p)), basename(p));
  }
}

/**
 * Parses the environment once through the core schema (spec §12). Throws InvalidConfigError naming
 * every bad field; a DATABASE_PATH that cannot be resolved is reported as that field, never a value.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config {
  let result: ReturnType<typeof parseConfig>;
  try {
    result = parseConfig(env, { realpath: tolerantRealpath });
  } catch (e) {
    throw new InvalidConfigError([
      {
        field: 'DATABASE_PATH',
        message: `cannot be resolved (${errnoCode(e) ?? (e instanceof Error ? e.message : 'error')})`,
      },
    ]);
  }
  if (!result.ok) throw new InvalidConfigError(result.errors);
  return result.config;
}

/** Everything an entrypoint needs, built once (plan "Wiring and bootstraps"). */
export interface Ports {
  config: Config;
  db: Db;
  repos: Repos;
  budget: BudgetGuard;
  cache: ResponseCache;
  http: HttpKit;
  providers: FlightProvider[];
  clock: Clock;
  log: Logger;
  secrets: Secret[];
  recorder: FixtureRecorder | null;
  fixtureRoot: string | null;
}

/** Every configured secret, for http-kit and recorder scrubbing (spec §5.3). */
export function collectSecrets(config: Config): Secret[] {
  const out: Secret[] = [];
  if (config.providers.travelpayouts !== null) out.push(config.providers.travelpayouts.token);
  if (config.providers.searchapi !== null) out.push(config.providers.searchapi.key);
  if (config.smtp !== null) out.push(config.smtp.pass);
  if (config.auth !== null) out.push(config.auth.pass);
  return out;
}

/**
 * The fixture provider's per-call cost: FIXTURE_COST_MICRO_GBP through core's config (spec §5.3
 * "fixture iff HTTP 200 at the configured test cost"), or null when the synthetic gate is closed.
 * why: the guard (WP3 budgetConfigFromConfig) refuses any reserve whose cost differs from this value.
 */
function fixtureCost(config: Config): number | null {
  return syntheticAllowed(config) ? (config.providers.fixture?.costMicroGbp ?? 0) : null;
}

/**
 * http-kit limits per provider (spec §5.3). Ownership rule (plan): WP4b writes fixture + fx; WP5 adds
 * `...(config.providers.searchapi ? { searchapi: searchApiHttpLimits(…) } : {})` and WP6 the
 * Travelpayouts line, one line each, in their own briefs.
 */
export function httpLimitsFor(config: Config): HttpKitDeps['limits'] {
  const timing = {
    maxWaitSeconds: config.maxWaitSeconds,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
  };
  const cost = fixtureCost(config);
  return {
    ...(cost === null ? {} : { fixture: fixtureHttpLimits({ costPerCallMicroGbp: cost, ...timing }) }),
    // why: plan decision 2 — frankfurter lives at api.frankfurter.dev; the .app host redirects and http-kit refuses redirects.
    // Owner: WP7's fx/refresh.ts holds the fx client; this entry moves beside it as `fxHttpLimits` (arch M-7).
    fx: {
      hosts: ['api.frankfurter.dev'],
      ratePerMinute: 10,
      ratePerHour: 100,
      concurrency: 1,
      billable: 'never',
      costPerCallMicroGbp: 0,
      ...timing,
    },
  };
}

/** Providers for this config. Same ownership rule as httpLimitsFor: WP5/WP6 each add one line. */
export function providersFor(
  config: Config,
  deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo },
): FlightProvider[] {
  const out: FlightProvider[] = [];
  const cost = fixtureCost(config);
  if (cost !== null) {
    out.push(
      fixtureProvider({ http: deps.http, log: deps.log, clock: deps.clock, config, costMicroGbp: cost }),
    );
  }
  return out;
}

/**
 * Opens the DB, applies migrations (callers run the backup preflight first), then builds repos,
 * guard, cache, http-kit and providers (plan "Wiring and bootstraps"). The in-process fixture host
 * is passed only under syntheticAllowed (plan decision 7: the only transport seam, gated).
 */
export function buildPorts(
  config: Config,
  opts: {
    log: Logger;
    clock?: Clock;
    recorder?: FixtureRecorder;
    migrationsDir: string;
    fixtureRoot?: string;
  },
): Ports {
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(config.databasePath);
  try {
    applyMigrations(db, opts.migrationsDir);
    const allowSynthetic = syntheticAllowed(config);
    const repos = createRepos(db, clock, { allowSynthetic });
    const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
    const cache = new SqliteResponseCache(db, clock);
    const secrets = collectSecrets(config);
    const fixtureRoot = allowSynthetic ? (opts.fixtureRoot ?? defaultFixtureRoot()) : null;
    const router = fixtureRoot === null ? null : fixtureRouter(fixtureRoot, config);
    const http = createHttpKit({
      budget,
      cache,
      limits: httpLimitsFor(config),
      clock,
      log: opts.log,
      secrets,
      syntheticAllowed: allowSynthetic,
      ...(opts.recorder !== undefined ? { recorder: opts.recorder } : {}),
      ...(router !== null
        ? { inProcessHosts: { 'fixture.local': (req: Request) => Promise.resolve(router.fetch(req)) } }
        : {}),
    });
    const providers = providersFor(config, { http, log: opts.log, clock, airports: repos.airports });
    return {
      config,
      db,
      repos,
      budget,
      cache,
      http,
      providers,
      clock,
      log: opts.log,
      secrets,
      recorder: opts.recorder ?? null,
      fixtureRoot,
    };
  } catch (e) {
    db.close(); // why: never leave a half-built handle holding the WAL
    throw e;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring` and `pnpm -r typecheck`
Expected: 17 passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: buildPorts, httpLimitsFor and providersFor with the gated fixture host at the configured cost"
```

### Task 4: Logger

**Files:** create `apps/api/src/logger.ts`, `apps/api/test/logger.test.ts`, `apps/api/test/support/logToFd.ts`.

**Interfaces:** consumes `Logger`, `Config['logLevel']`, `CREDENTIAL_HEADERS`, `scrubSecrets`, `createHttpKit`, `recordingLimits`. Produces `createLogger`, `SPEC_REDACT_PATHS`, `REDACT_PATHS`.

- [ ] **Step 1: Write the failing test**

The fifth and sixth tests spawn `test/support/logToFd.ts`, which logs once through the default destination and exits at once: the line arrives on the chosen fd, scrubbed. The last two tests drive the real pino logger through http-kit's own log calls at debug level (a 503 retried into a 200, a 400 and a 401) with sentinel credentials in the headers and sentinels echoed in vendor bodies (sec-001): once without the scrubbing sink, so only pino's redact paths and http-kit's own stripping stand, and once with it (r2-ts-003). Fake timers drive the retry backoff and the limiter spacing.

```ts
// apps/api/test/logger.test.ts
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock, Secret } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import { createHttpKit, type HttpKitRequest } from '@gmt/providers';
import { describe, expect, it, vi } from 'vitest';
import { createLogger, REDACT_PATHS, SPEC_REDACT_PATHS } from '../src/logger.js';
import { recordingLimits, saUrl, tpUrl } from '../src/tools/recordRequests.js';
import { buildPorts, loadConfigFromEnv } from '../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from './helpers/env.js';
import { onCleanup } from './helpers/tmp.js';

function sink(): { destination: Writable; text(): string; lines(): string[] } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return {
    destination,
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l !== ''),
  };
}

describe('createLogger (spec §14 redact paths, sec-001, sec-002)', () => {
  it('keeps the spec list and redacts credential headers in every casing, nested, plus err.config and smtp.pass', () => {
    expect(REDACT_PATHS.slice(0, SPEC_REDACT_PATHS.length)).toEqual([
      'apiKey',
      'token',
      'authorization',
      'url.query',
      'req.headers.authorization',
    ]);
    const s = sink();
    const log = createLogger({ logLevel: 'debug' }, { destination: s.destination });
    log.info(
      {
        apiKey: SENTINEL_SA,
        token: SENTINEL_SA,
        authorization: SENTINEL_SA,
        url: { query: SENTINEL_SA },
        req: { headers: { authorization: SENTINEL_SA } },
      },
      'spec',
    );
    log.info(
      {
        headers: {
          Authorization: SENTINEL_SA,
          'X-Access-Token': SENTINEL_TP,
          'x-api-key': SENTINEL_SA,
          COOKIE: SENTINEL_SA,
        },
      },
      'top',
    );
    log.info(
      {
        request: {
          headers: {
            authorization: SENTINEL_SA,
            'x-access-token': SENTINEL_TP,
            'Proxy-Authorization': SENTINEL_SA,
          },
        },
      },
      'nested',
    );
    log.error(
      {
        err: { message: 'boom', config: { headers: { Authorization: `Bearer ${SENTINEL_SA}` } } },
        smtp: { pass: SENTINEL_SA },
      },
      'library error',
    );
    log.child({ tool: 'record' }).warn({ token: SENTINEL_SA }, 'child');
    log.debug({}, 'd');
    const text = s.text();
    expect(s.lines()).toHaveLength(6);
    expect(text).not.toContain(SENTINEL_SA);
    expect(text).not.toContain(SENTINEL_TP);
    expect(s.lines()[4]).toContain('"tool":"record"');
  });

  it('scrubs configured secret values from any field the paths do not name, including messages', () => {
    const s = sink();
    const log = createLogger(
      { logLevel: 'info' },
      { destination: s.destination, secrets: [new Secret(SENTINEL_SA)] },
    );
    log.warn(
      { error: `upstream said: ${SENTINEL_SA}`, nested: { deep: [encodeURIComponent(SENTINEL_SA)] } },
      `message with ${SENTINEL_SA}`,
    );
    expect(s.text()).not.toContain(SENTINEL_SA);
    expect(s.text()).toContain('[redacted]');
  });

  it.each([1, 2] as const)(
    'the default destination writes fd %i synchronously and scrubbed, so a process exiting at once keeps its last line (pino.destination sync, hooks.streamWrite)',
    (fd) => {
      const r = spawnSync(
        process.execPath,
        [
          '--conditions=@gmt/source',
          '--import',
          'tsx',
          fileURLToPath(new URL('./support/logToFd.ts', import.meta.url)),
          String(fd),
          SENTINEL_SA,
        ],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: { PATH: process.env.PATH ?? '' },
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      expect(r.status).toBe(3);
      const [written, other] = fd === 1 ? [r.stdout, r.stderr] : [r.stderr, r.stdout];
      expect(written).toContain('"msg":"failed with [redacted]"');
      expect(written).toContain('"detail":"upstream echoed [redacted]"');
      expect(`${written}${other}`).not.toContain(SENTINEL_SA);
      expect(other).toBe('');
    },
    30_000,
  );

  it.each([
    ["without the scrubbing sink: only pino redact and http-kit's own stripping stand", false],
    ['with the scrubbing sink', true],
  ] as const)(
    'the real pino logger behind http-kit at debug level leaks no credential on success, retry, 401 and 400 paths, %s (sec-001, r2-ts-003)',
    async (_name, scrub) => {
      // why: fake timers drive http-kit's retry backoff, so the test is deterministic and fast
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      onCleanup(() => vi.useRealTimers());
      const config = loadConfigFromEnv(testEnv());
      const { travelpayouts: tp, searchapi: sa } = config.providers;
      if (tp === null || sa === null) throw new Error('both providers configured');
      const ports = buildPorts(config, {
        log: silentLog,
        clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
        migrationsDir: MIGRATIONS_DIR,
      });
      onCleanup(() => ports.db.close());
      const s = sink();
      const log = createLogger(
        { logLevel: 'debug' },
        { destination: s.destination, ...(scrub ? { secrets: ports.secrets } : {}) },
      );
      const http = createHttpKit({
        budget: ports.budget,
        cache: ports.cache,
        clock: ports.clock,
        log,
        secrets: ports.secrets,
        syntheticAllowed: false,
        limits: recordingLimits(tp, sa, config),
      });
      let calls = 0;
      vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        calls++;
        if (url.hostname === 'api.travelpayouts.com')
          return calls === 1
            ? new Response(`upstream overloaded for token ${SENTINEL_TP}`, { status: 503 })
            : new Response(JSON.stringify({ success: true, data: [], currency: 'gbp' }), { status: 200 });
        if (url.searchParams.get('engine') === 'google_flights_calendar')
          return new Response(JSON.stringify({ error: 'Too many date combinations.' }), { status: 400 });
        return new Response(JSON.stringify({ error: `Invalid API key: Bearer ${SENTINEL_SA}` }), {
          status: 401,
        });
      });
      onCleanup(() => vi.unstubAllGlobals());
      const req = (
        providerId: 'travelpayouts' | 'searchapi',
        url: URL,
        headers: Record<string, string>,
      ): HttpKitRequest => ({
        providerId,
        executionId: null,
        tileIndex: 0,
        endpointPath: url.pathname,
        method: 'GET',
        url,
        headers,
        cache: 'never',
        signal: new AbortController().signal,
        recordFixtures: false,
      });
      // why: the limiter's spacing and the retry backoff are timers; each request is driven by advancing fake time
      const drive = async <T>(p: Promise<T>): Promise<PromiseSettledResult<T>> => {
        const settled = Promise.allSettled([p]);
        await vi.advanceTimersByTimeAsync(10_000);
        const [r] = await settled;
        if (r === undefined) throw new Error('no result');
        return r;
      };
      const ok = await drive(
        http.request(
          req('travelpayouts', tpUrl('LON', 'JFK', '2027-03', 1), { 'X-Access-Token': SENTINEL_TP }),
        ),
      ); // 503, retried, then 200
      expect(ok.status).toBe('fulfilled');
      expect(
        (
          await drive(
            http.request(
              req('searchapi', saUrl({ engine: 'google_flights_calendar' }), {
                Authorization: `Bearer ${SENTINEL_SA}`,
              }),
            ),
          )
        ).status,
      ).toBe('rejected');
      expect(
        (
          await drive(
            http.request(
              req('searchapi', saUrl({ engine: 'google_flights' }), {
                Authorization: `Bearer ${SENTINEL_SA}`,
              }),
            ),
          )
        ).status,
      ).toBe('rejected');
      const text = s.text();
      expect(calls).toBe(4);
      expect(text).toContain('"level":20'); // debug lines were written
      expect(text).toContain('http request failed');
      for (const banned of [SENTINEL_SA, SENTINEL_TP, 'Bearer ', 'api_key=', 'departure_at='])
        expect(text).not.toContain(banned);
      if (!scrub) expect(text).not.toContain('[redacted]'); // nothing here needed the sink: http-kit logged no credential at all
    },
  );
});
```

```ts
// apps/api/test/support/logToFd.ts
// Spawned by test/logger.test.ts: logs one line through the default destination to the given fd, then exits at once,
// so the test sees whether the write was synchronous and scrubbed. Arguments: <fd 1|2> <secret>.
import { Secret } from '@gmt/core';
import { createLogger } from '../../src/logger.js';

const [fdArg, secret = ''] = process.argv.slice(2);
const log = createLogger({ logLevel: 'info' }, { fd: fdArg === '1' ? 1 : 2, secrets: [new Secret(secret)] });
log.error({ detail: `upstream echoed ${secret}` }, `failed with ${secret}`);
process.exit(3);
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/logger.test.ts`
Expected: FAIL, `Error: Cannot find module '../src/logger.js' imported from …/apps/api/test/logger.test.ts`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/logger.ts
/**
 * pino behind the core Logger port (spec §14). Redact paths are the spec's list plus every casing of
 * WP4's credential header names at any one level of nesting; URL query and userinfo stripping happens
 * in http-kit before anything reaches a log line (§5.3). Every line is also scrubbed of the
 * configured secret values (all their encoded forms) before it reaches the destination.
 */
import type { Config, Logger, Secret } from '@gmt/core';
import { CREDENTIAL_HEADERS, scrubSecrets } from '@gmt/providers';
import pino, { type Logger as PinoLogger } from 'pino';

/** Spec §14 / §5.3 redact paths, verbatim. */
export const SPEC_REDACT_PATHS: readonly string[] = [
  'apiKey',
  'token',
  'authorization',
  'url.query',
  'req.headers.authorization',
];

/** `x-access-token` → `x-access-token`, `X-Access-Token`, `X-ACCESS-TOKEN`. */
function casings(name: string): string[] {
  const title = name
    .split('-')
    .map((p) => (p === '' ? p : `${p[0]?.toUpperCase() ?? ''}${p.slice(1)}`))
    .join('-');
  return [...new Set([name, title, name.toUpperCase()])];
}

/**
 * The spec list, then WP4's CREDENTIAL_HEADERS in every casing under `headers` at the top level and one
 * level down (`*.headers[...]`, which covers `req.headers` and `request.headers`), then the nested
 * credential fields a library error or the SMTP config can carry (sec-001, sec-002).
 */
export const REDACT_PATHS: readonly string[] = [
  ...SPEC_REDACT_PATHS,
  ...[...CREDENTIAL_HEADERS].flatMap((h) =>
    casings(h).flatMap((c) => [`headers["${c}"]`, `*.headers["${c}"]`]),
  ),
  '*.apiKey',
  '*.token',
  '*.authorization',
  '*.Authorization',
  'err.config',
  '*.config.headers',
  'smtp.pass',
  '*.pass',
  '*.password',
];

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
 * JSON logs to stdout by default (spec §14). The tool bootstrap passes `fd: 2` so its human report on
 * stdout stays clean. Every line is scrubbed of the configured secret values (all their encoded forms) by pino's
 * `hooks.streamWrite`, before any destination sees it. why: `pino.destination({ dest: fd, sync: true })` (SonicBoom)
 * writes synchronously, so a process that exits right after an error keeps its last line, and it handles partial
 * writes and EAGAIN on a pipe, which a hand-rolled `writeSync` stream did not (arch I-2, sec minor 3). `destination`
 * is the test seam.
 */
export function createLogger(
  config: Pick<Config, 'logLevel'>,
  opts?: { destination?: NodeJS.WritableStream; fd?: 1 | 2; secrets?: readonly Secret[] },
): Logger {
  const secrets = opts?.secrets ?? [];
  return wrap(
    pino(
      {
        level: config.logLevel,
        redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
        hooks: { streamWrite: (line) => scrubSecrets(line, secrets) },
      },
      opts?.destination ?? pino.destination({ dest: opts?.fd ?? 1, sync: true }),
    ),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/logger.test.ts`
Expected: 6 passed (the two fd cases spawn `test/support/logToFd.ts`, which logs through the default destination and exits at once).

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: pino logger with the spec redact paths, credential headers in every casing and secret scrubbing"
```

### Task 5: Record arguments and the static call plan

**Files:** create `apps/api/src/tools/recordPlan.ts`, `apps/api/test/tools/recordPlan.test.ts`.

**Interfaces:** consumes `iataSchema`, `isoMonthSchema`, `asIsoDate`, `addDays`, `monthOf`, `Rect`, `CellDates`. Produces `RecordArgs`, `RecordCli`, `parseRecordArgs`, `monthAfter`, `rectangle`, `planCalls`, `planTotals`, `formatPlan`, `freeCallMisfit`, `PlannedCall`, `CallSpec` and the plan constants.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tools/recordPlan.test.ts
import { asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_OUT_DAYS,
  CALENDAR_RET_DAYS,
  formatPlan,
  freeCallMisfit,
  monthAfter,
  OVER_LIMIT_OUT_DAYS,
  OVER_LIMIT_RET_DAYS,
  parseRecordArgs,
  planCalls,
  planTotals,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  type RecordArgs,
  rectangle,
} from '../../src/tools/recordPlan.js';

const ROUTE = ['--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03'];

function args(budget = '5'): RecordArgs {
  const r = parseRecordArgs(['--budget', budget, ...ROUTE]);
  if (!r.ok) throw new Error(r.message);
  return r.value.args;
}

describe('parseRecordArgs refuses to run without an explicit budget (spec §9 item 7)', () => {
  it.each([
    [[...ROUTE], '--budget is required'],
    [['--budget', '0', ...ROUTE], 'positive integer'],
    [['--budget', '-3', ...ROUTE], 'positive integer'],
    [['--budget', 'ten', ...ROUTE], 'positive integer'],
    [['--budget', '12abc', ...ROUTE], 'positive integer'],
    [['--budget', '4', ...ROUTE], 'at least 5'],
    [['--budget', ...ROUTE], '--budget needs a value'],
    [['--budget', '5', '--budget', '6', ...ROUTE], '--budget is given twice'],
    [['--budget', '5', '--month', '2027-03'], '--route is required'],
    [['--budget', '5', '--route', 'LHR:LHR', '--month', '2027-03'], 'both origin and destination'],
    [['--budget', '5', '--route', 'LHR,LHR:JFK', '--month', '2027-03'], 'distinct three-letter codes'],
    [['--budget', '5', '--route', 'LHR', '--month', '2027-03'], 'O1,O2:D1,D2'],
    [['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-13'], '--month'],
    [['--budget', '5', ...ROUTE, '--bogus', '1'], 'unknown flag --bogus'],
    [['--budget', '5', ...ROUTE, '--metro', 'LON'], 'unknown flag --metro'],
    [['--budget', '5', ...ROUTE, 'stray'], 'unexpected argument stray'],
  ])('%j → %s', (argv, message) => {
    const r = parseRecordArgs(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(message);
  });

  it('accepts lower-case codes, the --flag=value form, a pnpm "--" separator, --dry-run and --confirm-rerun', () => {
    expect(
      parseRecordArgs(['--', '--budget=5', '--route', 'lhr,lgw:jfk,ewr', '--month=2027-03', '--dry-run']),
    ).toEqual({
      ok: true,
      value: {
        args: { budget: 5, origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'], month: '2027-03' },
        dryRun: true,
        confirmRerun: false,
        out: null,
      },
    });
    expect(
      parseRecordArgs(['--budget', '5', ...ROUTE, '--confirm-rerun', '--out', '/tmp/rec']),
    ).toMatchObject({
      ok: true,
      value: { dryRun: false, confirmRerun: true, out: '/tmp/rec' },
    });
  });
});

describe('date steps use core helpers (ts-011)', () => {
  it.each([
    ['2027-03', 0, '2027-03'],
    ['2027-03', 6, '2027-09'],
    ['2027-12', 1, '2028-01'],
    ['2027-03', 11, '2028-02'],
    ['2027-03', 12, '2028-03'],
    ['2028-01', 1, '2028-02'],
    ['2027-08', 12, '2028-08'],
  ])('monthAfter(%s, %i) = %s', (m, k, want) => {
    expect(monthAfter(asIsoMonth(m), k)).toBe(want);
  });
  it('monthAfter agrees with year·12 + month arithmetic for every start month of 2027–2028 and k = 0..12 (r2-ts-010)', () => {
    for (let y = 2027; y <= 2028; y++)
      for (let m = 1; m <= 12; m++)
        for (let k = 0; k <= 12; k++) {
          const idx = y * 12 + (m - 1) + k;
          const want = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
          expect(monthAfter(asIsoMonth(`${y}-${String(m).padStart(2, '0')}`), k), `${y}-${m} + ${k}`).toBe(
            want,
          );
        }
  });
  it('monthAfter refuses more than 12 months', () => {
    expect(() => monthAfter(asIsoMonth('2027-03'), 13)).toThrow(RangeError);
  });
  it.each([
    [
      '2027-03',
      {
        outFrom: '2027-03-01',
        outTo: '2027-03-09',
        retFrom: '2027-03-11',
        retTo: '2027-03-30',
        combinations: 180,
      },
    ],
    [
      '2028-02',
      {
        outFrom: '2028-02-01',
        outTo: '2028-02-09',
        retFrom: '2028-02-11',
        retTo: '2028-03-01',
        combinations: 180,
      },
    ],
    [
      '2027-02',
      {
        outFrom: '2027-02-01',
        outTo: '2027-02-09',
        retFrom: '2027-02-11',
        retTo: '2027-03-02',
        combinations: 180,
      },
    ],
    [
      '2027-12',
      {
        outFrom: '2027-12-01',
        outTo: '2027-12-09',
        retFrom: '2027-12-11',
        retTo: '2027-12-30',
        combinations: 180,
      },
    ],
  ])(
    'rectangle(%s) for the 10–21-night band is 9 × 20 = 180, the production tiling shape (spec §5.2, plan decision 29)',
    (m, want) => {
      expect(rectangle(asIsoMonth(m), 9, 20, 10)).toEqual(want);
    },
  );
  it('the calendar block is the largest b with b × (b + maxNights − minNights) ≤ 200, and the probe exceeds 200 (arch M-6)', () => {
    const span = (b: number): number => b + RECORD_MAX_NIGHTS - RECORD_MIN_NIGHTS;
    expect(CALENDAR_RET_DAYS).toBe(span(CALENDAR_OUT_DAYS));
    expect(CALENDAR_OUT_DAYS * CALENDAR_RET_DAYS).toBeLessThanOrEqual(200);
    expect((CALENDAR_OUT_DAYS + 1) * span(CALENDAR_OUT_DAYS + 1)).toBeGreaterThan(200);
    expect(OVER_LIMIT_OUT_DAYS * OVER_LIMIT_RET_DAYS).toBeGreaterThan(200);
  });
  it('the over-limit rectangle is 9 × 24 = 216', () => {
    expect(rectangle(asIsoMonth('2027-03'), 9, 24, 10)).toEqual({
      outFrom: '2027-03-01',
      outTo: '2027-03-09',
      retFrom: '2027-03-11',
      retTo: '2027-04-03',
      combinations: 216,
    });
  });
});

describe('planCalls: the exact live call list of brief section 7', () => {
  it('with the shared metro LON: 21 Travelpayouts calls, 6 SearchApi calls, ≤5 credits (4 expected)', () => {
    const plan = planCalls(args(), 'LON');
    expect(plan.map((c) => c.id)).toEqual([
      ...Array.from({ length: 21 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 6 }, (_, i) => `SA-${String(i + 1).padStart(2, '0')}`),
    ]);
    expect(plan.map((c) => c.label)).toEqual([
      'travelpayouts prices_for_dates LON→JFK 2027-03 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-03 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-04 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-04 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-05 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-05 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-06 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-06 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-07 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-07 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-08 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-08 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-09 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-09 (metro)',
      'travelpayouts prices_for_dates LHR→JFK 2027-03 (airport)',
      'travelpayouts prices_for_dates LHR→EWR 2027-03 (airport)',
      'travelpayouts prices_for_dates LGW→JFK 2027-03 (airport)',
      'travelpayouts prices_for_dates LGW→EWR 2027-03 (airport)',
      'travelpayouts prices_for_dates LON→JFK 2028-02 (empty-probe)',
      'travelpayouts prices_for_dates LON→JFK 2028-03 with an invalid token (401 body)',
      'travelpayouts prices_for_dates JFK→LON 2027-03 (reverse)',
      'searchapi google_flights step 1 LHR→JFK 2027-03-10/2027-03-31 with an invalid key (401 body)',
      'searchapi google_flights_calendar LHR→JFK out 2027-03-01..2027-03-09 × ret 2027-03-11..2027-03-30 (180)',
      'searchapi google_flights_calendar LHR→JFK out 2027-03-01..2027-03-09 × ret 2027-03-11..2027-04-03 (216) over the limit (400, or an empty 200 per the docs)',
      'searchapi google_flights step 1 LHR→JFK, cheapest priced in-band cell of SA-02',
      'searchapi google_flights step 2, departure_token of the cheapest priced step-1 option',
      'searchapi google_flights step 3, booking_token of the cheapest priced step-2 option',
    ]);
    expect(plan.filter((c) => !c.required).map((c) => c.id)).toEqual(['TP-19']);
    expect(planTotals(plan)).toEqual({
      saCalls: 6,
      worstCaseCredits: 5,
      expectedCredits: 4,
      freeCalls: 21,
      worstCaseFreeCalls: 61,
    });
    const lines = formatPlan(plan);
    expect(lines[19]).toContain('Travelpayouts 1 (running 20)');
    expect(lines[20]).toContain('Travelpayouts 1 (running 21)');
    expect(lines[21]).toContain('SearchApi ≤0 (running ≤0)');
    expect(lines[26]).toContain('SearchApi ≤1 (running ≤5)');
    expect(lines[27]).toBe(
      'total: SearchApi 6 calls, ≤5 credits (4 expected); Travelpayouts 21 free calls, ≤61 with up to 3 pages per tile',
    );
  });

  it('no error probe sends the same credential-free request as a success call (prov-wp04b-004, decision 20)', () => {
    for (const metro of ['LON', null]) {
      const plan = planCalls(args(), metro);
      const key = (c: (typeof plan)[number]): string =>
        JSON.stringify(
          c.spec.kind.startsWith('sa-') && 'cell' in c.spec
            ? c.spec.cell
            : 'month' in c.spec
              ? [c.spec.origin, c.spec.destination, c.spec.month]
              : c.id,
        );
      const probes = plan.filter((c) => c.spec.kind === 'tp-auth' || c.spec.kind === 'sa-auth').map(key);
      const others = plan.filter((c) => c.spec.kind !== 'tp-auth' && c.spec.kind !== 'sa-auth').map(key);
      for (const p of probes) expect(others).not.toContain(p);
      // why: the chain's cell comes from the calendar rectangle, so the 401 probe's cell must lie outside it (r2-ts-008)
      const auth = plan.find((c) => c.spec.kind === 'sa-auth')?.spec;
      const cal = plan.find((c) => c.spec.kind === 'sa-calendar')?.spec;
      if (auth?.kind !== 'sa-auth' || cal?.kind !== 'sa-calendar')
        throw new Error('plan lacks the probe or the calendar');
      expect(auth.cell.departure > cal.rect.outTo).toBe(true);
      expect(auth.cell.return > cal.rect.retTo).toBe(true);
    }
  });

  it('without a shared metro: every origin airport for 7 months, no separate airport tiles, 31 free calls; the reverse tile ends at the first origin', () => {
    const plan = planCalls(args(), null);
    expect(plan.filter((c) => c.spec.kind === 'tp-tile')).toHaveLength(2 * 2 * 7 + 2);
    expect(planTotals(plan).freeCalls).toBe(31);
    expect(plan.find((c) => c.id === 'TP-31')?.label).toBe(
      'travelpayouts prices_for_dates JFK→LHR 2027-03 (reverse)',
    );
  });

  it('freeCallMisfit compares the worst case (3 pages per tile) with the configured cap (ruling 13, cost-wp4b-r2-002)', () => {
    expect(freeCallMisfit(planCalls(args(), null), 91)).toBeNull();
    expect(freeCallMisfit(planCalls(args(), null), 90)).toContain(
      'the plan needs up to 91 Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is 90',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/recordPlan.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/tools/recordPlan.js' imported from …/apps/api/test/tools/recordPlan.test.ts`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/tools/recordPlan.ts
/**
 * Arguments and the static call plan of `pnpm record:fixtures` (spec §9 item 7, §16 WP4b).
 * Pure, so the list the operator approves with --dry-run is exactly the list that runs.
 * No airport appears here: the route is a CLI argument and the metro comes from the airports table (spec §1, §5.2).
 */
import {
  addDays,
  asIsoDate,
  type Iata,
  type IsoDate,
  type IsoMonth,
  iataSchema,
  isoMonthSchema,
  monthOf,
} from '@gmt/core';
import type { CellDates, Rect } from './recordRequests.js';

export type { CellDates, Rect } from './recordRequests.js';

/** Calendar + step 1 + step 2 + step 3: the credits the four required SearchApi fixtures cost. */
export const SA_REQUIRED_CREDITS = 4;
/** The smallest accepted --budget: the required four plus the over-limit probe (SA-03), which is billed if the vendor answers it with an empty 200. */
export const RECORD_MIN_BUDGET = 5;
/** Months of Travelpayouts metro tiles: the worked example's 182-day window spans 7 (spec §5.2). */
export const TP_MONTHS = 7;
/** Month offset of the best-effort empty-envelope probe (TP-19): outside the scanned months. */
export const TP_EMPTY_PROBE_OFFSET_MONTHS = 11;
/** Month offset of the Travelpayouts 401 probe (TP-20): a request no success recording makes (plan decision 20). */
export const TP_AUTH_PROBE_OFFSET_MONTHS = 12;
/** The worked example's nights band, 10–21 (spec §1): returns start 10 days after the first outbound. */
export const RECORD_MIN_NIGHTS = 10;
export const RECORD_NIGHTS_BAND = 12;
export const RECORD_MAX_NIGHTS = RECORD_MIN_NIGHTS + RECORD_NIGHTS_BAND - 1;
/**
 * Spec rev 15 §5.2 production tiling shape for the worked 10–21-night band (plan decision 29): the largest outbound
 * block b with b × (b + maxNights − minNights) ≤ 200, i.e. 9 outbound days × a 20-day return span = 180. why: the
 * return span is the rule, not a literal, so a changed band cannot silently leave the production shape (arch M-6).
 */
export const CALENDAR_OUT_DAYS = 9;
export const CALENDAR_RET_DAYS = CALENDAR_OUT_DAYS + RECORD_MAX_NIGHTS - RECORD_MIN_NIGHTS;
/** The deliberate over-limit probe: 9 × 24 = 216 > 200 (spec §2 fact 2). */
export const OVER_LIMIT_OUT_DAYS = 9;
export const OVER_LIMIT_RET_DAYS = 24;
/**
 * Pages fetched at most per Travelpayouts tile (cost-wp4b-r2-002): a vendor that ignored `page` and always answered
 * 1000 rows would otherwise page until the per-run cap. 3 covers the spike's busiest gateway month several times over.
 */
export const TP_MAX_PAGES_PER_TILE = 3;

/** Plan contract (Wiring and bootstraps), without `metro`: the metro comes from the seeded airports table (decision 20). */
export interface RecordArgs {
  budget: number;
  origins: Iata[];
  destinations: Iata[];
  month: IsoMonth;
}
/** What the CLI asks for beyond RecordArgs. */
export interface RecordCli {
  args: RecordArgs;
  dryRun: boolean;
  /** Required for a live run when earlier tool runs already ledgered SearchApi credits in the window (decision 20). */
  confirmRerun: boolean;
  /**
   * `--out DIR`: record into DIR/fixtures/recorded instead of the committed tree. Required for any route other than the
   * worked example, and DIR must be outside the repository (sec2-002; the operator's own routes never enter the repo).
   */
  out: string | null;
}
export type ParseRecordResult = { ok: true; value: RecordCli } | { ok: false; message: string };

/**
 * Why a Travelpayouts tile is in the plan. `reverse` (TP-21, plan decision 31): the first destination back to the
 * origins' metro for the same month, so WP6 can check every row's local departure month against the tile month for a
 * westward origin (UTC bucketing at month boundaries).
 */
export type TilePurpose = 'metro' | 'airport' | 'empty-probe' | 'reverse';

export type CallSpec =
  | {
      kind: 'tp-tile';
      /** An airport or a metro code; the reverse tile's destination is the metro (plan decision 31). */
      origin: string;
      destination: string;
      month: IsoMonth;
      purpose: TilePurpose;
    }
  | { kind: 'tp-auth'; origin: string; destination: Iata; month: IsoMonth }
  | { kind: 'sa-calendar' | 'sa-over-limit'; origin: Iata; destination: Iata; rect: Rect }
  | { kind: 'sa-step1' | 'sa-step2' | 'sa-step3'; origin: Iata; destination: Iata }
  | { kind: 'sa-auth'; origin: Iata; destination: Iata; cell: CellDates };

export interface PlannedCall {
  id: string;
  spec: CallSpec;
  label: string;
  /** SearchApi credits the ledger counts if the vendor answers HTTP 200 (spec §2 fact 4: every 200 counts). */
  worstCaseCredits: 0 | 1;
  /** Credits the spike's behaviour predicts. */
  expectedCredits: 0 | 1;
  freeCalls: 0 | 1;
  expect: readonly number[];
  /** Counted by `requiredOk`; the empty-envelope probe is best-effort (pie-010). */
  required: boolean;
}

export const USAGE =
  'usage: pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--out DIR] [--dry-run] [--confirm-rerun]';
const VALUE_FLAGS = new Set(['budget', 'route', 'month', 'out']);
const SWITCHES = new Set(['dry-run', 'confirm-rerun']);

function positiveInt(s: string): number | null {
  return /^[1-9]\d{0,5}$/.test(s) ? Number(s) : null;
}

function iataList(s: string): Iata[] | null {
  const out: Iata[] = [];
  for (const part of s.split(',')) {
    const r = iataSchema.safeParse(part); // iataSchema trims and upper-cases (plan decision 1)
    if (!r.success || out.includes(r.data)) return null;
    out.push(r.data);
  }
  return out.length > 0 ? out : null;
}

/** Parses the CLI. Refuses a missing or too-small budget before anything is opened (spec §9 item 7). */
export function parseRecordArgs(argv: readonly string[]): ParseRecordResult {
  const fail = (message: string): ParseRecordResult => ({ ok: false, message: `${message}\n${USAGE}` });
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // why: pnpm may forward its own separator
    if (a === undefined || !a.startsWith('--')) return fail(`unexpected argument ${String(a)}`);
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (SWITCHES.has(name) && eq === -1) {
      switches.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) return fail(`unknown flag --${name}`);
    if (flags.has(name)) return fail(`--${name} is given twice`);
    const value = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
    if (value === undefined || value === '' || value.startsWith('--')) return fail(`--${name} needs a value`);
    flags.set(name, value);
    if (eq === -1) i++;
  }
  const budgetRaw = flags.get('budget');
  if (budgetRaw === undefined)
    return fail('--budget is required: the explicit SearchApi call budget (spec §9 item 7)');
  const budget = positiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer; 0 would record nothing');
  if (budget < RECORD_MIN_BUDGET)
    return fail(
      `--budget must be at least ${RECORD_MIN_BUDGET} (calendar, the over-limit probe and the three-step chain); got ${budget}`,
    );
  const route = flags.get('route');
  if (route === undefined) return fail('--route is required, e.g. --route O1,O2:D1,D2');
  const sides = route.split(':');
  const [from, to] = sides;
  if (sides.length !== 2 || from === undefined || to === undefined)
    return fail('--route must look like O1,O2:D1,D2');
  const origins = iataList(from);
  const destinations = iataList(to);
  if (origins === null || destinations === null)
    return fail('--route must look like O1,O2:D1,D2 with distinct three-letter codes');
  if (origins.some((o) => destinations.includes(o)))
    return fail('an airport cannot be both origin and destination');
  const month = isoMonthSchema.safeParse(flags.get('month') ?? '');
  if (!month.success) return fail('--month must be YYYY-MM');
  return {
    ok: true,
    value: {
      args: { budget, origins, destinations, month: month.data },
      dryRun: switches.has('dry-run'),
      confirmRerun: switches.has('confirm-rerun'),
      out: flags.get('out') ?? null,
    },
  };
}

/** The first day of a month, through core's brand helper. */
export function firstDayOf(month: IsoMonth): IsoDate {
  return asIsoDate(`${month}-01`);
}

/**
 * The month `k` months after `month`, from core's date helpers (spec §6.1: epoch-day arithmetic only).
 * why: 31·k days after the 1st lands inside month + k for 0 ≤ k ≤ 12, because any 12 consecutive months
 * fall at most 7 days short of 31 days each and every month has at least 28 days.
 */
export function monthAfter(month: IsoMonth, k: number): IsoMonth {
  if (!Number.isInteger(k) || k < 0 || k > 12)
    throw new RangeError(`monthAfter supports 0..12 months, got ${k}`);
  return monthOf(addDays(firstDayOf(month), 31 * k));
}

/** Outbound days from the 1st of `month`; returns start `minNights` after the first outbound day. */
export function rectangle(month: IsoMonth, outDays: number, retDays: number, minNights: number): Rect {
  const outFrom = firstDayOf(month);
  const retFrom = addDays(outFrom, minNights);
  return {
    outFrom,
    outTo: addDays(outFrom, outDays - 1),
    retFrom,
    retTo: addDays(retFrom, retDays - 1),
    combinations: outDays * retDays,
  };
}

function first<T>(xs: readonly T[]): T {
  const x = xs[0];
  if (x === undefined) throw new Error('empty list');
  return x;
}

/** The exact ordered call list (brief section 7). `metro` is the origins' shared metro code from the airports table, or null. */
export function planCalls(a: RecordArgs, metro: string | null): PlannedCall[] {
  const calls: PlannedCall[] = [];
  let tp = 0;
  let sa = 0;
  const tpCall = (spec: CallSpec, label: string, expect: readonly number[], required: boolean): void => {
    tp++;
    const id = `TP-${String(tp).padStart(2, '0')}`;
    calls.push({ id, spec, label, worstCaseCredits: 0, expectedCredits: 0, freeCalls: 1, expect, required });
  };
  const saCall = (
    spec: CallSpec,
    label: string,
    credits: { worst: 0 | 1; expected: 0 | 1 },
    expect: readonly number[],
  ): void => {
    sa++;
    const id = `SA-${String(sa).padStart(2, '0')}`;
    calls.push({
      id,
      spec,
      label,
      worstCaseCredits: credits.worst,
      expectedCredits: credits.expected,
      freeCalls: 0,
      expect,
      required: true,
    });
  };
  const tile = (origin: string, destination: string, month: IsoMonth, purpose: TilePurpose): void =>
    tpCall(
      { kind: 'tp-tile', origin, destination, month, purpose },
      `travelpayouts prices_for_dates ${origin}→${destination} ${month} (${purpose})`,
      [200],
      purpose !== 'empty-probe',
    );

  const tileOrigins = metro === null ? a.origins : [metro];
  for (let k = 0; k < TP_MONTHS; k++) {
    const month = monthAfter(a.month, k);
    for (const o of tileOrigins)
      for (const d of a.destinations) tile(o, d, month, metro === null ? 'airport' : 'metro');
  }
  if (metro !== null)
    for (const o of a.origins) for (const d of a.destinations) tile(o, d, a.month, 'airport');
  const o0 = first(a.origins);
  const d0 = first(a.destinations);
  const tpOrigin = metro ?? o0;
  tile(tpOrigin, d0, monthAfter(a.month, TP_EMPTY_PROBE_OFFSET_MONTHS), 'empty-probe');
  const authMonth = monthAfter(a.month, TP_AUTH_PROBE_OFFSET_MONTHS);
  tpCall(
    { kind: 'tp-auth', origin: tpOrigin, destination: d0, month: authMonth },
    `travelpayouts prices_for_dates ${tpOrigin}→${d0} ${authMonth} with an invalid token (401 body)`,
    [401],
    true,
  );
  // why: plan decision 31 — a required, free reverse-direction tile for the same month (TP-21)
  tile(d0, tpOrigin, a.month, 'reverse');

  const rect = rectangle(a.month, CALENDAR_OUT_DAYS, CALENDAR_RET_DAYS, RECORD_MIN_NIGHTS);
  const over = rectangle(a.month, OVER_LIMIT_OUT_DAYS, OVER_LIMIT_RET_DAYS, RECORD_MIN_NIGHTS);
  const rectLabel = (r: Rect): string =>
    `out ${r.outFrom}..${r.outTo} × ret ${r.retFrom}..${r.retTo} (${r.combinations})`;
  // why: first, so its reservation never meets a cap the billed calls have filled (the guard counts a pending row before
  // the 401 finalises it unbilled); one day past the rectangle on both sides, so it never equals a chain request (prov-wp04b-004)
  const authCell: CellDates = { departure: addDays(rect.outTo, 1), return: addDays(rect.retTo, 1) };
  saCall(
    { kind: 'sa-auth', origin: o0, destination: d0, cell: authCell },
    `searchapi google_flights step 1 ${o0}→${d0} ${authCell.departure}/${authCell.return} with an invalid key (401 body)`,
    { worst: 0, expected: 0 },
    [401],
  );
  saCall(
    { kind: 'sa-calendar', origin: o0, destination: d0, rect },
    `searchapi google_flights_calendar ${o0}→${d0} ${rectLabel(rect)}`,
    { worst: 1, expected: 1 },
    [200],
  );
  saCall(
    { kind: 'sa-over-limit', origin: o0, destination: d0, rect: over },
    `searchapi google_flights_calendar ${o0}→${d0} ${rectLabel(over)} over the limit (400, or an empty 200 per the docs)`,
    { worst: 1, expected: 0 },
    [400, 200],
  );
  saCall(
    { kind: 'sa-step1', origin: o0, destination: d0 },
    `searchapi google_flights step 1 ${o0}→${d0}, cheapest priced in-band cell of SA-02`,
    { worst: 1, expected: 1 },
    [200],
  );
  saCall(
    { kind: 'sa-step2', origin: o0, destination: d0 },
    'searchapi google_flights step 2, departure_token of the cheapest priced step-1 option',
    { worst: 1, expected: 1 },
    [200],
  );
  saCall(
    { kind: 'sa-step3', origin: o0, destination: d0 },
    'searchapi google_flights step 3, booking_token of the cheapest priced step-2 option',
    { worst: 1, expected: 1 },
    [200],
  );
  return calls;
}

/** Totals over a plan. */
export function planTotals(plan: readonly PlannedCall[]): {
  saCalls: number;
  worstCaseCredits: number;
  expectedCredits: number;
  freeCalls: number;
  worstCaseFreeCalls: number;
} {
  const tiles = plan.filter((c) => c.spec.kind === 'tp-tile').length;
  const freeCalls = plan.reduce((n, c) => n + c.freeCalls, 0);
  return {
    saCalls: plan.filter((c) => c.spec.kind.startsWith('sa-')).length,
    worstCaseCredits: plan.reduce((n, c) => n + c.worstCaseCredits, 0),
    expectedCredits: plan.reduce((n, c) => n + c.expectedCredits, 0),
    freeCalls,
    // why: every tile may page up to TP_MAX_PAGES_PER_TILE; the 401 probe never pages
    worstCaseFreeCalls: freeCalls + tiles * (TP_MAX_PAGES_PER_TILE - 1),
  };
}

/** One line per call with running totals, then a total line (printed by --dry-run and before a live run). */
export function formatPlan(plan: readonly PlannedCall[]): string[] {
  let credits = 0;
  let free = 0;
  const lines = plan.map((c) => {
    credits += c.worstCaseCredits;
    free += c.freeCalls;
    return `${c.id.padEnd(6)} ${c.label} | expect ${c.expect.join('/')} | SearchApi ≤${c.worstCaseCredits} (running ≤${credits}) | Travelpayouts ${c.freeCalls} (running ${free})`;
  });
  const t = planTotals(plan);
  lines.push(
    `total: SearchApi ${t.saCalls} calls, ≤${t.worstCaseCredits} credits (${t.expectedCredits} expected); Travelpayouts ${t.freeCalls} free calls, ≤${t.worstCaseFreeCalls} with up to ${TP_MAX_PAGES_PER_TILE} pages per tile`,
  );
  return lines;
}

/** Refusal message when the plan's worst-case free calls exceed the configured per-execution cap (EXECUTION_MAX_FREE_CALLS), else null. */
export function freeCallMisfit(plan: readonly PlannedCall[], maxFreeCalls: number): string | null {
  const need = planTotals(plan).worstCaseFreeCalls;
  return need <= maxFreeCalls
    ? null
    : `the plan needs up to ${need} Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is ${maxFreeCalls}; raise it or narrow --route`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/recordPlan.test.ts`
Expected: 36 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp04b: record:fixtures arguments and the exact call plan"
```

### Task 6: The recording run through the real http-kit, recorder and guard

**Files:** modify `packages/providers/src/http/recorder.ts`, `packages/providers/src/index.ts`, `packages/providers/test/http/recorder.test.ts`, `packages/providers/test/barrel.test.ts` (Step 3a); create `apps/api/src/safeMessage.ts`, `apps/api/src/tools/types.ts`, `recordParams.ts`, `recordExecution.ts`, `recordReport.ts`, `record.ts`, `apps/api/test/helpers/recording.ts`, `apps/api/test/tools/record.test.ts`. The four `src/tools` modules split the work (arch-r2-005): execution bookkeeping and the budget position (`recordExecution.ts`), assessment and the report (`recordReport.ts`), the request loop and the CLI runner (`record.ts`), the shared result types and exit codes (`types.ts`).

**Interfaces:** consumes `createHttpKit`, `createRecorder`, `withContentHash`, `assertRecordedRoot` (Step 3a), `scrubSecrets`, `ProviderError`, `BudgetExceeded`, `AbortedError`, `stripUrlsInText`, `DefinitionInput`, `DefinitionSnapshot`, `Estimate`, `Repos.definitions.create/get/softDelete`, `Repos.executions.create/listByStatus/setStatus`, `Db.immediateTransaction`, `budget.usage`, `seedAirports`, `loadAirportsDataset`, `verifyRecordedTree`, `loadRecorded`. Produces `recordFixtures`, `RecordSummary`, `RecordedCall`, `RecordingFailedError`, `RECORDED_BY`, `recordPrecheck`, `priorToolCredits`, `budgetPosition`, `openRecordingExecution`, `assessRun`, `formatSummary`, `ledgerLine`, `retryAttemptLines`, `runRecord`, `safeMessage`, `ParamLog`, `paramRules`, `writeAllowlist`, `EXIT`, `ToolContext`, `ToolName`.

The tests run the recording against the stand-ins on an in-memory, seeded database with a fixed clock, into a temporary recorded tree created before the run (so a failed run's files can be scanned, ts-008), under the test signature `@gmt/api record:fixtures (test)`. Every identifier the stand-ins invent carries the marker `gmt-standin-7f3a`, a token that cannot occur in vendor text, so a stand-in recording can never pass as a vendor one (prov-wp04b-006; Task 12a's check requires `RECORDED_BY` and rejects the marker). The failure cases (a 5xx retried into a 200, a 429, a socket failure, a timeout) run under fake timers through `runRecordingInFakeTime`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/helpers/recording.ts
// Runs record:fixtures against the stand-ins into a temporary recorded tree, with a test signature (prov-wp04b-006).
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { vi } from 'vitest';
import { type RecordArgs, recordFixtures } from '../../src/tools/record.js';
import { type PlannedCall, parseRecordArgs, planCalls } from '../../src/tools/recordPlan.js';
import type { RecordSummary } from '../../src/tools/types.js';
import { buildPorts, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { silentLog, testEnv } from './env.js';
import { onCleanup, tempRecordedRoot } from './tmp.js';
import { stubVendors, type VendorLog, type VendorOptions } from './vendors.js';

/**
 * The signature test recordings carry. WP4's verifier accepts any non-blank signature; the committed-tree check
 * (checkWorkedExampleTree) requires RECORDED_BY, so a test tree can never pass as a vendor one (prov-wp04b-006).
 */
export const TEST_RECORDED_BY = '@gmt/api record:fixtures (test)';

/** A temporary recorded tree and the test signature, for runTool's `recording` option. */
export function testRecording(): {
  repo: string;
  root: string;
  recording: { root: string; recordedBy: string };
} {
  const { repo, root } = tempRecordedRoot();
  return { repo, root, recording: { root, recordedBy: TEST_RECORDED_BY } };
}
export const AT = asIsoDateTime('2026-10-20T09:00:00.000Z');

/** The worked example's arguments, parsed (so the codes are branded Iata values). */
export const WORKED_EXAMPLE: RecordArgs = (() => {
  const r = parseRecordArgs(['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03']);
  if (!r.ok) throw new Error(r.message);
  return r.value.args;
})();

/** Ports over a migrated in-memory DB with the airports table seeded (so LON is the shared metro). */
export function seededPorts(env: Record<string, string> = {}, clock = fixedClock(AT)): Ports {
  const ports = buildPorts(loadConfigFromEnv(testEnv(env)), {
    log: silentLog,
    clock,
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => ports.db.close());
  seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
  return ports;
}

export interface Recording {
  summary: RecordSummary;
  seen: VendorLog;
  repo: string;
  root: string;
  ports: Ports;
  plan: PlannedCall[];
}

/** A prepared run: the tree exists before the recording starts, so a failed run's files can still be inspected (ts-008). */
export interface RecordingSetup {
  seen: VendorLog;
  repo: string;
  root: string;
  ports: Ports;
  args: RecordArgs;
  plan: PlannedCall[];
  run(signal?: AbortSignal): Promise<RecordSummary>;
}

export function recordingSetup(
  o: { args?: RecordArgs; vendors?: VendorOptions; env?: Record<string, string>; ports?: Ports } = {},
): RecordingSetup {
  const args = o.args ?? WORKED_EXAMPLE;
  const ports = o.ports ?? seededPorts(o.env);
  const seen = stubVendors(o.vendors);
  const { repo, root } = tempRecordedRoot();
  return {
    seen,
    repo,
    root,
    ports,
    args,
    plan: planCalls(args, ports.repos.airports.sharedMetro(args.origins)),
    run: (signal) =>
      recordFixtures(ports, args, {
        signal: signal ?? new AbortController().signal,
        recordedRoot: root,
        recordedBy: TEST_RECORDED_BY,
      }),
  };
}

/** Runs the whole recording; `ports` lets a test reuse one database across runs. */
export async function runRecording(
  o: {
    args?: RecordArgs;
    vendors?: VendorOptions;
    env?: Record<string, string>;
    ports?: Ports;
    signal?: AbortSignal;
  } = {},
): Promise<Recording> {
  const s = recordingSetup(o);
  const summary = await s.run(o.signal);
  return { summary, seen: s.seen, repo: s.repo, root: s.root, ports: s.ports, plan: s.plan };
}

/**
 * Runs a recording whose vendor fails and retries under fake timers, so http-kit's backoff and request timeout pass
 * in fake time (r2-ts-003): deterministic and fast. Restores real timers afterwards.
 */
export async function runRecordingInFakeTime(o: Parameters<typeof runRecording>[0] = {}): Promise<Recording> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const p = runRecording(o);
    let done = false;
    p.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    while (!done) await vi.advanceTimersByTimeAsync(500);
    return await p;
  } finally {
    vi.useRealTimers();
  }
}
```

```ts
// apps/api/test/tools/record.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbortedError, asIsoDate, asIsoDateTime, BudgetExceeded, fixedClock, ProviderError } from '@gmt/core';
import type { RecordedFixture } from '@gmt/providers';
import { loadParamsAllowlist } from '@gmt/providers';
import { loadRecorded, verifyRecordedTree } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { failureOf, recordFixtures } from '../../src/tools/record.js';
import { priorToolCredits } from '../../src/tools/recordExecution.js';
import { assessRun } from '../../src/tools/recordReport.js';
import { cheapestCalendarCell, cheapestOption } from '../../src/tools/recordRequests.js';
import { RecordingFailedError } from '../../src/tools/types.js';
import { SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';
import {
  AT,
  recordingSetup,
  runRecording,
  runRecordingInFakeTime,
  seededPorts,
  TEST_RECORDED_BY,
  WORKED_EXAMPLE,
} from '../helpers/recording.js';
import { filesUnder, tempDir } from '../helpers/tmp.js';
import { BT, DT, STANDIN_MARKER, stubVendors } from '../helpers/vendors.js';

function recordings(root: string): RecordedFixture[] {
  return [
    ...loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'),
    ...loadRecorded(root, 'searchapi', '/api/v1/search'),
  ];
}
const q = (f: RecordedFixture, k: string): string | null => new URL(f.request.url).searchParams.get(k);
const statuses = (calls: ReadonlyArray<{ id: string; status: unknown }>): string[] =>
  calls.map((c) => `${c.id}:${String(c.status)}`);
const RECT = {
  outFrom: asIsoDate('2027-03-01'),
  outTo: asIsoDate('2027-03-09'),
  retFrom: asIsoDate('2027-03-11'),
  retTo: asIsoDate('2027-03-30'),
  combinations: 180,
};
const BAND = { minNights: 10, maxNights: 21 };

describe('response readers (ts-005, pie-006, prov-wp04b-r2-002)', () => {
  it('cheapestOption takes the cheapest priced option across best_flights and other_flights, skipping unpriced ones', () => {
    const body = {
      best_flights: [{ departure_token: 'unpriced' }, { price: 655, departure_token: 'dearer' }],
      other_flights: [{ price: 603, departure_token: 'cheapest' }],
    };
    expect(cheapestOption(body, 'departure_token')).toEqual({ token: 'cheapest', price: 603 });
    expect(cheapestOption({ best_flights: [{ departure_token: 'x' }] }, 'departure_token')).toBeNull();
  });
  it('cheapestCalendarCell skips has_no_flights cells that carry a price, out-of-band cells and cells outside the rectangle', () => {
    const body = {
      calendar: [
        { departure: '2027-03-01', return: '2027-03-29', price: 380 },
        { departure: '2027-03-04', return: '2027-03-16', has_no_flights: true, price: 390 },
        { departure: '2027-03-10', return: '2027-03-31', price: 400 },
        { departure: '2027-03-02', return: '2027-03-16', price: 603 },
        { departure: 'not-a-date', return: '2027-03-16', price: 1 },
      ],
    };
    expect(cheapestCalendarCell(body, BAND, RECT)).toEqual({
      departure: '2027-03-02',
      return: '2027-03-16',
      price: 603,
    });
    expect(cheapestCalendarCell({ calendar: [] }, BAND, RECT)).toBeNull();
  });
});

describe('failureOf: how a failed request is reported (cost-wp4b-r2-003, cost M-2)', () => {
  const pe = (kind: ProviderError['kind'], code: string, httpStatus?: number): ProviderError =>
    new ProviderError({
      kind,
      retryable: false,
      providerId: 'searchapi',
      message: `searchapi /api/v1/search: detail [${code}]`,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  it.each([
    [pe('rate-limit', 'http-429', 429), { status: 429, detail: 'rate-limit' }],
    [pe('limiter-timeout', 'retry-after-exceeds-max-wait', 429), { status: 429, detail: 'limiter-timeout' }],
    [
      pe('limiter-timeout', 'queue-wait-exceeded'),
      { status: 'skipped', detail: 'rate-limit slot not granted within MAX_WAIT_SECONDS; nothing sent' },
    ],
    [pe('network', 'timeout'), { status: 'no-response', detail: 'timeout (ledgered unknown, counted)' }],
    [
      pe('network', 'socket'),
      {
        status: 'no-response',
        detail:
          'network (ledgered error, NOT counted: if the dashboard drop exceeds the ledger, this call is why)',
      },
    ],
    [
      pe('upstream', 'redirect-refused'),
      {
        status: 'no-response',
        detail: 'upstream without an HTTP status (redirect-refused); see its ledger row',
      },
    ],
    [
      new BudgetExceeded({ scope: 'execution-calls', cap: 5, current: 5, requested: 1 }),
      { status: 'skipped', detail: 'refused by the guard: execution-calls' },
    ],
    [
      new AbortedError(),
      { status: 'aborted', detail: 'aborted (an attempt already sent is ledgered unknown, counted)' },
    ],
  ] as const)('%s', (e, want) => {
    expect(failureOf(e)).toEqual(want);
  });
  it('anything else is not a request result (it propagates)', () => {
    expect(failureOf(new Error('recorder refused'))).toBeNull();
  });
});

describe('recordFixtures against the vendor stand-ins (spec §9 item 7, §5.3 Recorder)', () => {
  it('issues the planned calls, follows the token chain and records every response', async () => {
    const run = await runRecording();
    const { summary, seen, plan, root } = run;
    expect(assessRun(plan, summary)).toEqual({
      requiredOk: true,
      notAsExpected: [],
      chainComplete: true,
      emptyEnvelope: 'yes',
      overLimit: 'http-400',
    });
    expect(statuses(summary.calls)).toEqual([
      ...Array.from({ length: 19 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}:200`),
      'TP-20:401',
      'TP-21:200',
      'SA-01:401',
      'SA-02:200',
      'SA-03:400',
      'SA-04:200',
      'SA-05:200',
      'SA-06:200',
    ]);
    for (const c of summary.calls) expect(c.files, c.id).toHaveLength(1);
    expect(summary.creditsUsed).toBe(4); // SA-02, 04, 05, 06: 200s count, 401 and 400 do not (spec §2 fact 4)
    expect(summary.freeCalls).toBe(21);
    expect(summary.chain).toEqual({
      currency: 'GBP',
      step1PricePence: 60300,
      step2PricePence: 60300,
      step3Options: [
        { bookWith: 'OTA', pricePence: 57300 },
        { bookWith: 'Airline', pricePence: 60300 },
      ],
    });

    // step 1 used the cheapest priced in-band cell; steps 2 and 3 carried the cheapest priced tokens
    const flights = seen.sa.filter(
      (p) => p.get('engine') === 'google_flights' && p.get('outbound_date') === '2027-03-02',
    );
    expect(
      flights.map((p) => [p.get('return_date'), p.get('departure_token'), p.get('booking_token')]),
    ).toEqual([
      ['2027-03-16', null, null],
      ['2027-03-16', DT.cheapest, null],
      ['2027-03-16', null, BT.cheapest],
    ]);
    for (const p of seen.sa)
      expect([p.get('api_key'), p.get('travel_class'), p.get('gl')]).toEqual([null, 'economy', 'gb']);
    for (const p of seen.tp) expect(p.get('token')).toBeNull();

    // the recorded tree: WP4's verifier finds nothing, one session, the test signature, no credential anywhere
    expect(verifyRecordedTree(root, run.ports.secrets)).toEqual([]);
    const files = recordings(root);
    expect(files).toHaveLength(27);
    expect(new Set(files.map((f) => f.session)).size).toBe(1);
    expect(summary.session).toBe(files[0]?.session);
    for (const f of files) {
      expect(f.recordedBy).toBe(TEST_RECORDED_BY);
      for (const p of Object.keys(f.placeholders))
        expect(p).toMatch(new RegExp(`^<[a-z_]+:\\d+@${f.session}>$`));
    }
    for (const path of filesUnder(root)) {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toContain(SENTINEL_SA);
      expect(text).not.toContain(SENTINEL_TP);
      expect(text).not.toMatch(/X-Access-Token|api_key=|Bearer /i);
    }
    // search_metadata keeps its URL keys with query and userinfo stripped (WP4 stripMetadataUrls)
    const calendar = files.find((f) => q(f, 'engine') === 'google_flights_calendar' && f.status === 200);
    expect(JSON.stringify(calendar?.body)).toContain(
      '"request_url":"https://www.searchapi.io/api/v1/search"',
    );
    expect(JSON.stringify(calendar?.body)).toContain(
      `"json_endpoint":"https://www.searchapi.io/api/v1/searches/${STANDIN_MARKER}-cal-1.json"`,
    );
  });

  it('the execution is hidden and carries the approved plan: soft-deleted definition, trigger tool, completed, caps and estimate', async () => {
    const run = await runRecording();
    const rows = run.ports.db.raw
      .prepare(
        `SELECT e.status, e.trigger, e.error_text AS errorText,
                json_extract(e.definition_snapshot_json, '$.budget') AS budget, json_extract(e.definition_snapshot_json, '$.deletedAt') AS snapDeleted,
                json_extract(e.estimate_json, '$.totalPlanCalls') AS planCalls,
                json_extract(e.estimate_json, '$.perProvider[1].planCalls') AS saPlanCalls,
                json_extract(e.estimate_json, '$.perProvider[1].calls') AS saCalls,
                d.deleted_at AS deletedAt, d.enabled,
                (SELECT COUNT(*) FROM search_cells c WHERE c.execution_id = e.id) AS cells
         FROM search_executions e JOIN search_definitions d ON d.id = e.definition_id`,
      )
      .all();
    expect(rows).toEqual([
      {
        status: 'completed',
        trigger: 'tool',
        errorText: null,
        budget: JSON.stringify({ maxCalls: 5, maxFreeCalls: 2000, maxCostMicroGbp: 0 }),
        snapDeleted: expect.any(String),
        // why: plan-call figures count every planned first attempt, so parity with the ledger holds (cost M-1): 21 + 6
        planCalls: 27,
        saPlanCalls: 6,
        saCalls: 5,
        deletedAt: expect.any(String),
        enabled: 0,
        cells: 0,
      },
    ]);
  });

  it('the real SqliteBudgetGuard stops the run at the budget before the vendor is hit; the allowlist names only parameters sent (ts-004, prov-wp04b-r2-003)', async () => {
    const run = await runRecording({ args: { ...WORKED_EXAMPLE, budget: 2 } });
    const sa = run.summary.calls.filter((c) => c.providerId === 'searchapi');
    expect(statuses(sa)).toEqual([
      'SA-01:401',
      'SA-02:200',
      'SA-03:400',
      'SA-04:200',
      'SA-05:skipped',
      'SA-06:skipped',
    ]);
    expect(sa.find((c) => c.id === 'SA-05')?.detail).toBe('refused by the guard: execution-calls');
    expect(sa.find((c) => c.id === 'SA-06')?.detail).toContain('chain prerequisite missing');
    expect(run.seen.sa).toHaveLength(4);
    expect(run.seen.sa.some((p) => p.get('departure_token') !== null)).toBe(false);
    expect(
      run.ports.db.raw
        .prepare(`SELECT COUNT(*) AS n FROM provider_requests WHERE provider_id = 'searchapi'`)
        .get(),
    ).toEqual({ n: 4 });
    expect(run.summary.creditsUsed).toBe(2);
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      notAsExpected: ['SA-05', 'SA-06'],
    });
    expect(run.ports.db.raw.prepare('SELECT error_text AS e FROM search_executions').get()).toEqual({
      e: 'required calls not as expected: SA-05, SA-06; chain incomplete; 1 call(s) refused by the guard',
    });
    const allow = loadParamsAllowlist(join(run.root, 'searchapi', 'params-2026-10-20.json'), run.root);
    expect(allow.endpoints['/api/v1/search?engine=google_flights']?.names).not.toContain('departure_token');
  });

  it('pages a Travelpayouts tile while a page holds 1000 rows, and stops at the page cap (ts-006, cost-wp4b-r2-002)', async () => {
    const lonJfk = (p: URLSearchParams): boolean =>
      p.get('origin') === 'LON' && p.get('destination') === 'JFK';
    const run = await runRecording({
      vendors: {
        tpRows: (p) =>
          lonJfk(p) && p.get('departure_at') === '2027-03'
            ? p.get('page') === '1'
              ? 1000
              : 3
            : lonJfk(p) && p.get('departure_at') === '2027-04'
              ? 1000
              : 1,
      },
    });
    expect(statuses(run.summary.calls.slice(0, 7))).toEqual([
      'TP-01:200',
      'TP-01p2:200',
      'TP-02:200',
      'TP-03:200',
      'TP-03p2:200',
      'TP-03p3:200',
      'TP-04:200',
    ]);
    expect(run.summary.calls[5]?.detail).toBe('page cap reached (3 pages of 1000 rows)');
    expect(run.summary.freeCalls).toBe(24);
  });

  it('the Travelpayouts month cap stops a run mid-way with the guard, before the vendor (r2-ts-004)', async () => {
    const run = await runRecording({ env: { TRAVELPAYOUTS_MONTHLY_CALL_CAP: '18' } });
    expect(statuses(run.summary.calls.slice(17, 20))).toEqual([
      'TP-18:200',
      'TP-19:skipped',
      'TP-20:skipped',
    ]);
    expect(run.summary.calls[18]?.detail).toBe('refused by the guard: provider-month');
    expect(run.seen.tp).toHaveLength(18);
    // why: TP-19 never reached the vendor, so nothing is said about its envelope (prov-wp04b-r3-002)
    expect(assessRun(run.plan, run.summary).emptyEnvelope).toBe('no-answer');
  });

  it('a calendar with no priced in-band cell skips SA-03 and the chain: nothing more is spent (ts-006, cost-wp4b-r2-004)', async () => {
    const run = await runRecording({ vendors: { calendar: 'no-priced-cell' } });
    const byId = new Map(run.summary.calls.map((c) => [c.id, c]));
    expect(byId.get('SA-03')?.detail).toBe(
      'skipped: calendar SA-02 gave no usable cell; the run must be repeated',
    );
    for (const id of ['SA-03', 'SA-04', 'SA-05', 'SA-06']) expect(byId.get(id)?.status).toBe('skipped');
    expect(run.seen.sa.map((p) => p.get('engine'))).toEqual(['google_flights', 'google_flights_calendar']); // the 401 probe, then SA-02
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      chainComplete: false,
      overLimit: 'no-answer',
      notAsExpected: ['SA-03', 'SA-04', 'SA-05', 'SA-06'],
    });
  });

  it('a required call not as planned before the first billed SearchApi call skips SA-02…SA-06: nothing is spent on a run that must be repeated (cost I-1, plan decision 30)', async () => {
    // why: a stale Travelpayouts token makes every tile answer 401; the run is doomed before any credit is at stake
    const run = await runRecording({
      env: { TRAVELPAYOUTS_TOKEN: 'test-stale-travelpayouts-token-0123456789' },
    });
    const tiles = [...Array.from({ length: 18 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}`), 'TP-21'];
    const detail = `skipped: required call(s) ${tiles.join(', ')} not as planned; the run must be repeated`;
    const sa = run.summary.calls.filter((c) => c.providerId === 'searchapi');
    expect(sa.map((c) => [c.id, c.status, c.detail])).toEqual([
      ['SA-01', 401, 'auth'],
      ...['SA-02', 'SA-03', 'SA-04', 'SA-05', 'SA-06'].map((id) => [id, 'skipped', detail]),
    ]);
    expect(run.seen.sa).toHaveLength(1);
    expect(run.summary.creditsUsed).toBe(0);
  });

  it('a required SearchApi probe not as planned (SA-01 timing out) also stops the run before SA-02 (cost I-1)', async () => {
    const run = await runRecordingInFakeTime({
      env: { REQUEST_TIMEOUT_SECONDS: '1' },
      vendors: {
        failOn: (u) =>
          u.searchParams.get('engine') === 'google_flights' &&
          u.searchParams.get('outbound_date') === '2027-03-10'
            ? 'hang'
            : undefined,
      },
    });
    expect(run.summary.calls.find((c) => c.id === 'SA-02')).toMatchObject({
      status: 'skipped',
      detail: 'skipped: required call(s) SA-01 not as planned; the run must be repeated',
    });
    expect(run.seen.sa).toHaveLength(1);
  });

  it('a step 3 answering 200 with no booking option ends completed with "chain incomplete" (prov-wp04b-r2-004)', async () => {
    const run = await runRecording({ vendors: { step3Empty: true } });
    expect(run.summary.calls.find((c) => c.id === 'SA-06')?.status).toBe(200);
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      notAsExpected: [],
      chainComplete: false,
    });
    expect(run.ports.db.raw.prepare('SELECT status, error_text AS e FROM search_executions').get()).toEqual({
      status: 'completed',
      e: 'chain incomplete',
    });
  });

  it('a recorded root that does not exist is refused before the hidden execution opens (prov-wp04b-r3-003)', async () => {
    const ports = seededPorts();
    stubVendors();
    await expect(
      recordFixtures(ports, WORKED_EXAMPLE, {
        signal: new AbortController().signal,
        recordedRoot: join(tempDir(), 'fixtures', 'recorded'),
        recordedBy: TEST_RECORDED_BY,
      }),
    ).rejects.toThrow(/recorder root/);
    expect(ports.db.raw.prepare('SELECT COUNT(*) AS n FROM search_executions').get()).toEqual({ n: 0 });
  });

  it('a step 1 without any departure_token breaks the chain after one paid call (r2-ts-004)', async () => {
    const run = await runRecording({ vendors: { step1WithoutToken: true } });
    expect(statuses(run.summary.calls.slice(-3))).toEqual(['SA-04:200', 'SA-05:skipped', 'SA-06:skipped']);
    expect(run.summary.creditsUsed).toBe(2);
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      notAsExpected: ['SA-05', 'SA-06'],
    });
  });

  it('an empty 200 for the over-limit calendar is accepted, named and billed (pie-005, cost-wp4b-004)', async () => {
    const run = await runRecording({ vendors: { overLimit: 'empty-200' } });
    expect(assessRun(run.plan, run.summary)).toMatchObject({ requiredOk: true, overLimit: 'empty-200' });
    expect(run.summary.creditsUsed).toBe(5);
  });

  it('a 5xx retried into a 200 keeps both attempt files on the call, the failed one first (prov-wp04b-r2-005)', async () => {
    let failed = false;
    const run = await runRecordingInFakeTime({
      vendors: {
        failOn: (u) => {
          if (failed || u.searchParams.get('engine') !== 'google_flights_calendar') return undefined;
          failed = true;
          return 'http-500';
        },
      },
    });
    const sa02 = run.summary.calls.find((c) => c.id === 'SA-02');
    expect(sa02?.status).toBe(200);
    expect(sa02?.files).toHaveLength(2);
    const [first, last] = (sa02?.files ?? []).map((p) => JSON.parse(readFileSync(p, 'utf8')).status);
    expect([first, last]).toEqual([500, 200]);
    expect(run.summary.creditsUsed).toBe(4); // the 500 is not billed
  });

  it('a 429 on a required call leaves it not as planned (r2-ts-004)', async () => {
    const run = await runRecordingInFakeTime({
      vendors: {
        failOn: (u) => (u.searchParams.get('return_date_end') === '2027-04-03' ? 'http-429' : undefined),
      },
    });
    expect(run.summary.calls.find((c) => c.id === 'SA-03')).toMatchObject({
      status: 429,
      detail: 'rate-limit',
    });
    expect(assessRun(run.plan, run.summary)).toMatchObject({ requiredOk: false, notAsExpected: ['SA-03'] });
  });

  it('a socket failure is no-response, NOT counted; a timeout is no-response, ledgered unknown and counted (cost-wp4b-r2-003)', async () => {
    const run = await runRecordingInFakeTime({
      env: { REQUEST_TIMEOUT_SECONDS: '1' },
      vendors: {
        failOn: (u) =>
          // why: the best-effort TP-19, so a required call stays as planned and SA-04 is still sent (cost I-1)
          u.searchParams.get('departure_at') === '2028-02'
            ? 'network'
            : u.searchParams.get('engine') === 'google_flights' &&
                u.searchParams.get('outbound_date') === '2027-03-02' &&
                u.searchParams.get('departure_token') === null
              ? 'hang'
              : undefined,
      },
    });
    expect(run.summary.calls.find((c) => c.id === 'TP-19')).toMatchObject({
      status: 'no-response',
      detail: expect.stringContaining('NOT counted'),
    });
    expect(run.summary.calls.find((c) => c.id === 'SA-04')).toMatchObject({
      status: 'no-response',
      detail: 'timeout (ledgered unknown, counted)',
    });
    expect(
      run.ports.db.raw
        .prepare(
          `SELECT outcome FROM provider_requests WHERE provider_id = 'searchapi' AND outcome = 'unknown'`,
        )
        .all(),
    ).toEqual([{ outcome: 'unknown' }]);
    expect(run.summary.creditsUsed).toBe(2); // SA-02 and the timed-out SA-04 (counted); SA-05/06 skipped
  });

  it('an abort during the calendar stops the run: later calls never reach the vendor and the execution is cancelled (ts-006, cost-wp4b-006)', async () => {
    const ac = new AbortController();
    const run = await runRecording({
      signal: ac.signal,
      vendors: {
        onRequest: (u) => {
          if (u.searchParams.get('engine') === 'google_flights_calendar') ac.abort();
        },
      },
    });
    const sa = run.summary.calls.filter((c) => c.providerId === 'searchapi');
    expect(sa.slice(0, 2).map((c) => c.status)).toEqual([401, 'aborted']);
    for (const c of sa.slice(2)) expect([c.status, c.detail]).toEqual(['skipped', 'aborted before send']);
    expect(run.seen.sa).toHaveLength(2);
    expect(run.ports.db.raw.prepare('SELECT status, error_text AS e FROM search_executions').get()).toEqual({
      status: 'cancelled',
      e: 'aborted',
    }); // why: an abort with the real kit leaves no open reservation; the aborted SA-02 is ledgered unknown and counted, so the
    // ledger line shows it (cost M-3)
    expect(
      run.ports.db.raw.prepare("SELECT COUNT(*) AS n FROM provider_requests WHERE outcome = 'pending'").get(),
    ).toEqual({ n: 0 });
    expect(
      run.ports.db.raw
        .prepare("SELECT outcome FROM provider_requests WHERE provider_id = 'searchapi' ORDER BY rowid")
        .all(),
    ).toEqual([{ outcome: 'error' }, { outcome: 'unknown' }]);
    expect(run.summary.creditsUsed).toBe(1);
  });

  it.each([
    ['calendar-parameters', 22],
    ['calendar-base64', 22],
    ['sa-401-bearer', 22],
    ['tp-body', 0],
    ['tp-bearer', 0],
  ] as const)(
    'a vendor echoing a real credential (%s) fails closed: the earlier %i recordings exist, the refused call has none, no file holds the key (ts-008, r3-ts-005)',
    async (echo, earlier) => {
      const setup = recordingSetup({ vendors: { echo } });
      const err = await setup.run().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RecordingFailedError);
      if (!(err instanceof RecordingFailedError)) return;
      expect(err.message).not.toContain(SENTINEL_SA);
      expect(err.message).not.toContain(SENTINEL_TP);
      const files = recordings(setup.root);
      expect(files).toHaveLength(earlier);
      // the refused call (the SA-02 calendar, or TP-01) left no recording
      expect(files.some((f) => q(f, 'engine') === 'google_flights_calendar')).toBe(false);
      for (const path of filesUnder(setup.root)) {
        const text = readFileSync(path, 'utf8');
        expect(text, path).not.toContain(SENTINEL_SA);
        expect(text, path).not.toContain(SENTINEL_TP);
        expect(text, path).not.toContain(Buffer.from(SENTINEL_SA, 'utf8').toString('base64'));
      }
      const row = setup.ports.db.raw.prepare('SELECT status, error_text AS e FROM search_executions').get();
      expect(row).toMatchObject({
        status: 'cancelled',
        e: expect.stringContaining('record:fixtures failed'),
      });
      expect(JSON.stringify(row)).not.toContain(SENTINEL_SA);
      expect(JSON.stringify(row)).not.toContain(SENTINEL_TP);
    },
  );

  it('refuses a plan whose worst-case free calls exceed EXECUTION_MAX_FREE_CALLS before any request (ruling 13)', async () => {
    const ports = seededPorts({ EXECUTION_MAX_FREE_CALLS: '57' });
    await expect(runRecording({ ports })).rejects.toThrow(
      'the plan needs up to 61 Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is 57',
    );
    expect(ports.db.raw.prepare('SELECT COUNT(*) AS n FROM search_executions').get()).toEqual({ n: 0 });
  });

  it('priorToolCredits counts tool runs inside the SearchApi window only: lifetime on the trial, the billing month on 40usd (r2-ts-004)', async () => {
    const clock = fixedClock(AT);
    const ports = seededPorts({ SEARCHAPI_PLAN: '40usd' }, clock);
    await runRecording({ ports });
    expect(priorToolCredits(ports)).toBe(4);
    clock.set(asIsoDateTime('2026-11-02T09:00:00.000Z'));
    expect(priorToolCredits(ports)).toBe(0);
    const trialClock = fixedClock(AT);
    const trial = seededPorts({}, trialClock);
    await runRecording({ ports: trial });
    trialClock.set(asIsoDateTime('2027-11-02T09:00:00.000Z'));
    expect(priorToolCredits(trial)).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/record.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/tools/recordExecution.js' imported from …/apps/api/test/tools/record.test.ts`.

- [ ] **Step 3: Implement**

Step 3a (plan decision 30, ruling on arch I-3): WP4 owns the tamper-evidence hash and the recorded-root rule, so the allowlist writer uses them rather than second copies. In `packages/providers/src/http/recorder.ts`, add `assertRecordedRoot` above `canonicalJson`, and replace the root checks in `createRecorder` (keep `givenRoot = resolve(opts.root)` for the returned paths; `const root = assertRecordedRoot(opts.root);`) and in `loadRecordedJson` (`const realRoot = assertRecordedRoot(root);`) with calls to it:

```ts
/**
 * The real path of a recorded root, refused unless it exists and its real path ends in fixtures/recorded (spec §5.5).
 * why: the suffix is tested on the real path, so a symlink named …/fixtures/recorded cannot point elsewhere (I1); the
 * recorder, the readers and WP4b's allowlist writer share this one rule (WP4b I-3).
 */
export function assertRecordedRoot(root: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(root));
  } catch (e) {
    // why: only absence is reported as such; EACCES, ELOOP and the rest surface unchanged (re-review low 1).
    if (errnoCode(e) === 'ENOENT') throw new RecorderRefusedError(`recorder root ${root} does not exist`);
    throw e;
  }
  if (!real.endsWith(RECORDED_DIR))
    throw new RecorderRefusedError(`recorder root must end in fixtures/recorded (spec §5.5), got ${real}`);
  return real;
}
```

Add `assertRecordedRoot` and `withContentHash` to the main barrel's `./http/recorder.js` export list; in `packages/providers/test/barrel.test.ts` add both to the main-barrel function list and remove `'withContentHash'` from the "not in main" list (it stays in `./testing` too). In `packages/providers/test/http/recorder.test.ts` (import `assertRecordedRoot` and `realpathSync`), before the `canonicalJson` known-answer test:

```ts
  it('assertRecordedRoot returns the real root, and refuses a missing root, a wrong suffix and a symlink pointing elsewhere (WP4b I-3)', () => {
    const root = tree();
    expect(assertRecordedRoot(root)).toBe(realpathSync(root));
    const base = mkdtempSync(join(tmpdir(), 'gmt-root-'));
    expect(() => assertRecordedRoot(join(base, 'absent', 'fixtures', 'recorded'))).toThrow(
      RecorderRefusedError,
    );
    expect(() => assertRecordedRoot(join(base, 'absent', 'fixtures', 'recorded'))).toThrow(/does not exist/);
    expect(() => assertRecordedRoot(base)).toThrow(/must end in fixtures\/recorded/);
    const linked = join(base, 'elsewhere', 'fixtures', 'recorded');
    mkdirSync(join(linked, '..'), { recursive: true });
    symlinkSync(base, linked);
    expect(() => assertRecordedRoot(linked)).toThrow(/must end in fixtures\/recorded/);
  });
```

Run `pnpm --filter @gmt/providers exec vitest run test/barrel.test.ts test/http/recorder.test.ts` first: 2 failed (`withContentHash: expected 'undefined' to be 'function'`, `TypeError: assertRecordedRoot is not a function`); after the change, the providers suite passes (264).

Step 3b: the apps/api modules.

```ts
// apps/api/src/safeMessage.ts
/** One error-message sanitiser for every apps/api sink: the tool bootstrap, the preflight and the record tool. */
import { type Secret, stripUrlsInText } from '@gmt/core';
import { scrubSecrets } from '@gmt/providers';

/** A message safe for any sink: URL query and userinfo stripped, every configured secret replaced (spec §5.3, sec-006). */
export function safeMessage(e: unknown, secrets: readonly Secret[]): string {
  return scrubSecrets(stripUrlsInText(e instanceof Error ? e.message : String(e)), secrets);
}
```

```ts
// apps/api/src/tools/types.ts
/** What the tool bootstrap hands a tool, the shared record-tool result types, and the one exit-code table every CLI shares. */
import type { Config, ProviderId } from '@gmt/core';

/** Both vendors' configuration, narrowed once by recordFixtures and passed down (arch M-3). */
export interface RecordingProviders {
  tp: NonNullable<Config['providers']['travelpayouts']>;
  sa: NonNullable<Config['providers']['searchapi']>;
}

/** The two tools of spec §9 item 7; `smoke` arrives with WP13. */
export type ToolName = 'record' | 'smoke';

/** Per-run context: the abort signal (SIGINT, SIGTERM, a lost app_lock), the two output lines and where recordings go. */
export interface ToolContext {
  signal: AbortSignal;
  out(line: string): void;
  err(line: string): void;
  /** `defaultRecordedRoot()` for the worked example, `<--out>/fixtures/recorded` otherwise, a temporary tree in tests. */
  recordedRoot: string;
  /** `RECORDED_BY` in every real run; tests pass their own signature together with their root (prov-wp04b-006). */
  recordedBy: string;
}

/**
 * The plan's single exit-code table for every CLI (smoke adds 2 and 3 in WP13). 1 = a required recording call did not
 * return its expected status, or the run failed. 70 = refused under NODE_ENV=test or while the synthetic gate is open. 65 = a live recording refused for spend: credits already ledgered to
 * earlier tool runs plus this run's worst case exceed `--budget` without `--confirm-rerun` (plan decision 20), or a
 * provider's budget window has less room than the run's worst case (cost-wp4b-r2-001).
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 64,
  spendRefused: 65,
  refusedTestEnv: 70,
  preflightImpossible: 73,
  backupFailed: 74,
  lockRefused: 75,
  badConfig: 78,
} as const;

/**
 * One planned call's result. `status` is the HTTP status when a response arrived; `'no-response'` when the request
 * may have reached the vendor but no status came back (`detail` says whether the ledger counted it: a timeout is
 * ledgered `unknown` and counted, a socket failure `error` and not counted); `'aborted'` when SIGINT, SIGTERM or a
 * lost lock stopped it; `'skipped'` only when nothing reached the vendor (guard refusal, missing chain prerequisite,
 * abort before send). `files` lists every file the recorder wrote for the call, retries included; `file` is the last.
 */
export interface RecordedCall {
  id: string;
  providerId: ProviderId;
  status: number | 'skipped' | 'aborted' | 'no-response';
  file: string | null;
  files: string[];
  detail: string | null;
}

/** Plan contract (Wiring and bootstraps; plan decision 23). */
export interface RecordSummary {
  calls: RecordedCall[];
  creditsUsed: number;
  freeCalls: number;
  /** The recorder session every file of this run carries (null when nothing was written). */
  session: string | null;
  /**
   * Diagnostics along the chain (pie-008), in integer pence with their currency (hard rule 7): never prices shown to the
   * operator as offers; they let the PR state whether step 1 = step 2 and what step 3 showed.
   */
  chain: {
    currency: 'GBP';
    step1PricePence: number | null;
    step2PricePence: number | null;
    step3Options: Array<{ bookWith: string; pricePence: number }>;
  };
}

/** recordFixtures failed after opening its execution; carries what was done so far (cause = the original error). */
export class RecordingFailedError extends Error {
  constructor(
    message: string,
    readonly partial: {
      calls: RecordedCall[];
      creditsUsed: number;
      freeCalls: number;
      session: string | null;
    },
    options: { cause: unknown },
  ) {
    super(message, options);
    this.name = 'RecordingFailedError';
  }
}
```

```ts
// apps/api/src/tools/recordParams.ts
/**
 * The dated parameter allowlists (spec §5.2: "fixtures/recorded/<provider>/params-<date>.json
 * enumerates parameter names and values; tests assert both"), in the plan's ParamsAllowlist shape.
 * Every parameter record:fixtures sends is checked against this table before the request leaves.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IsoDate } from '@gmt/core';
import { assertRecordedRoot, type ParamsAllowlist, withContentHash } from '@gmt/providers';

export type EndpointKey = 'prices_for_dates' | 'google_flights_calendar' | 'google_flights';
const ENDPOINT_KEYS: readonly EndpointKey[] = [
  'prices_for_dates',
  'google_flights_calendar',
  'google_flights',
];
type ValueKind = 'iata' | 'iso-date' | 'iso-month' | 'positive-int' | 'opaque-token';
/**
 * `fixed`: the allowlist lists the values actually sent. `oneOf`: the allowlist lists the vendor's whole
 * documented set (spec §5.4 `travel_class`), so WP5 may send any cabin while this run sends one.
 * `kind`: a variable value, written as 'any'.
 */
type ParamRule = { fixed: readonly string[] } | { oneOf: readonly string[] } | { kind: ValueKind };
interface EndpointRules {
  provider: 'travelpayouts' | 'searchapi';
  key: string;
  params: Readonly<Record<string, ParamRule>>;
}

const KIND_PATTERN: Record<Exclude<ValueKind, 'opaque-token'>, RegExp> = {
  iata: /^[A-Z]{3}$/,
  'iso-date': /^\d{4}-\d{2}-\d{2}$/,
  'iso-month': /^\d{4}-\d{2}$/,
  'positive-int': /^[1-9]\d*$/,
};
/** Spec §5.4: SearchApi's `travel_class` values. */
export const SEARCHAPI_TRAVEL_CLASSES: readonly string[] = [
  'business',
  'economy',
  'first_class',
  'premium_economy',
];

/** The full rule table. `gl` is pinned to `gb`: the recorded tree is the public worked example's (spec §2). */
export function paramRules(): Readonly<Record<EndpointKey, EndpointRules>> {
  const iata: ParamRule = { kind: 'iata' };
  const date: ParamRule = { kind: 'iso-date' };
  const shared = {
    flight_type: { fixed: ['round_trip'] },
    travel_class: { oneOf: SEARCHAPI_TRAVEL_CLASSES },
    adults: { fixed: ['1'] },
    currency: { fixed: ['GBP'] },
    gl: { fixed: ['gb'] },
    hl: { fixed: ['en'] },
    // why: plan decision 29 — separate-ticket itineraries excluded on both engines (documented for both)
    separate_tickets: { fixed: ['1'] },
  } as const;
  return {
    prices_for_dates: {
      provider: 'travelpayouts',
      key: '/aviasales/v3/prices_for_dates',
      params: {
        origin: iata,
        destination: iata,
        departure_at: { kind: 'iso-month' },
        one_way: { fixed: ['false'] },
        currency: { fixed: ['gbp'] },
        limit: { fixed: ['1000'] },
        page: { kind: 'positive-int' },
      },
    },
    google_flights_calendar: {
      provider: 'searchapi',
      key: '/api/v1/search?engine=google_flights_calendar',
      params: {
        engine: { fixed: ['google_flights_calendar'] },
        departure_id: iata,
        arrival_id: iata,
        outbound_date: date,
        outbound_date_start: date,
        outbound_date_end: date,
        return_date: date,
        return_date_start: date,
        return_date_end: date,
        ...shared,
      },
    },
    google_flights: {
      provider: 'searchapi',
      key: '/api/v1/search?engine=google_flights',
      params: {
        engine: { fixed: ['google_flights'] },
        departure_id: iata,
        arrival_id: iata,
        outbound_date: date,
        return_date: date,
        ...shared,
        // why: plan decision 24 — sorted by price; no `stops` on either engine (separate_tickets is shared, decision 29)
        sort_by: { fixed: ['price'] },
        departure_token: { kind: 'opaque-token' },
        booking_token: { kind: 'opaque-token' },
      },
    },
  };
}

/** Validates outgoing parameters and accumulates the names and fixed values sent. */
export class ParamLog {
  private readonly observed = new Map<EndpointKey, Map<string, Set<string>>>();
  constructor(private readonly rules: Readonly<Record<EndpointKey, EndpointRules>>) {}

  /** Throws before a request leaves if any parameter or value is outside the table. Messages name parameters, never values. */
  validate(key: EndpointKey, params: URLSearchParams): void {
    const table = this.rules[key].params;
    for (const [name, value] of params) {
      const rule = table[name];
      if (rule === undefined) throw new Error(`parameter ${name} is not in the ${key} allowlist`);
      const allowed = 'fixed' in rule ? rule.fixed : 'oneOf' in rule ? rule.oneOf : null;
      if (allowed !== null && !allowed.includes(value))
        throw new Error(`${key}: a value of ${name} is not allowed`);
      if ('kind' in rule && rule.kind !== 'opaque-token' && !KIND_PATTERN[rule.kind].test(value))
        throw new Error(`${key}: ${name} is not a ${rule.kind}`);
    }
  }

  /**
   * Records the names and fixed values of a request the vendor answered. why: only a request that left and got a
   * response evidences a parameter; a call the guard refused or an abort stopped adds nothing (prov-wp04b-r2-003).
   */
  observe(key: EndpointKey, params: URLSearchParams): void {
    const table = this.rules[key].params;
    const seen = this.observed.get(key) ?? new Map<string, Set<string>>();
    this.observed.set(key, seen);
    for (const [name, value] of params) {
      const rule = table[name];
      const values = seen.get(name) ?? new Set<string>();
      seen.set(name, values);
      if (rule !== undefined && 'fixed' in rule) values.add(value); // why: oneOf lists the documented set and variables are 'any'
    }
  }

  /**
   * The allowlist document for one provider, hashed by WP4's own withContentHash, so WP4's loadParamsAllowlist
   * verifies it with the same code that wrote it (arch I-3). Keys are the endpoint path, or
   * '<path>?engine=<value>' for SearchApi's engines multiplexed on one path (plan ParamsAllowlist).
   */
  document(provider: 'travelpayouts' | 'searchapi', recordedAt: IsoDate): ParamsAllowlist {
    const endpoints: ParamsAllowlist['endpoints'] = {};
    for (const k of ENDPOINT_KEYS) {
      const r = this.rules[k];
      const seen = this.observed.get(k);
      if (r.provider !== provider || seen === undefined) continue;
      const names = [...seen.keys()].sort();
      const values: Record<string, string[] | 'any'> = {};
      for (const name of names) {
        const rule = r.params[name];
        values[name] =
          rule === undefined || 'kind' in rule
            ? 'any'
            : 'oneOf' in rule
              ? [...rule.oneOf].sort()
              : [...(seen.get(name) ?? [])].sort();
      }
      endpoints[r.key] = { names, values };
    }
    return withContentHash({ provider, recordedAt, endpoints });
  }
}

/**
 * Writes params-<date>.json under `root` (spec §5.5). The root must pass WP4's assertRecordedRoot (it exists and its
 * real path ends in fixtures/recorded: the recorder's own rule, arch I-3); a provider directory that resolves outside
 * the real root (sec-003) and an existing file or symlink at the target are refused.
 */
export function writeAllowlist(root: string, doc: ParamsAllowlist): string {
  const realRoot = assertRecordedRoot(root);
  const dir = join(root, doc.provider);
  mkdirSync(dir, { recursive: true });
  const realDir = realpathSync(dir);
  if (realDir !== join(realRoot, doc.provider))
    throw new Error(`refusing to write: ${dir} resolves outside ${realRoot}`);
  const path = join(realDir, `params-${doc.recordedAt}.json`);
  // why: 'wx' refuses an existing file or symlink at the target, as WP4's recorder does (sec2-006); a second run on the
  // same date must first delete the earlier session's files and allowlists (Task 12b step 1)
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx' });
  return path;
}
```

```ts
// apps/api/src/tools/recordExecution.ts
/**
 * The record tool's execution bookkeeping (spec §7 production ledger, plan decisions 5, 20 and 23): the hidden
 * soft-deleted definition and its execution, the plan's stored estimate, the credits earlier tool runs ledgered, and
 * the provider windows' room for this run.
 */
import {
  addDays,
  type DefinitionInput,
  type DefinitionSnapshot,
  type Estimate,
  type ExecutionStatus,
} from '@gmt/core';
import type { Ports } from '../wiring.js';
import {
  CALENDAR_OUT_DAYS,
  firstDayOf,
  type PlannedCall,
  planTotals,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  type RecordArgs,
} from './recordPlan.js';
import { RECORD_TRAVEL_CLASS } from './recordRequests.js';
import type { RecordingProviders } from './types.js';

/** why: a Record over the union fails to compile when core adds a status, so the list below is always complete (arch-r2-002). */
const STATUS_FLAGS: Record<ExecutionStatus, true> = {
  pending: true,
  running: true,
  paused_budget: true,
  paused_error: true,
  interrupted: true,
  cancelled: true,
  completed: true,
  skipped_budget: true,
  skipped_confirm: true,
  skipped_window: true,
  skipped_missed: true,
};
function isExecutionStatus(s: string): s is ExecutionStatus {
  return Object.hasOwn(STATUS_FLAGS, s);
}
const ALL_STATUSES: ExecutionStatus[] = Object.keys(STATUS_FLAGS).filter(isExecutionStatus);

/** The SearchApi budget window the configured plan uses: lifetime on the trial, the billing month on 40usd. */
function searchApiWindow(ports: Ports) {
  return ports.budget.usage(
    ports.config.providers.searchapi?.limits.window === 'lifetime'
      ? { kind: 'provider-lifetime', providerId: 'searchapi' }
      : { kind: 'provider-month', providerId: 'searchapi' },
  );
}

/**
 * SearchApi credits already ledgered to earlier `trigger: 'tool'` executions inside the provider's current budget
 * window (the lifetime window on the trial plan, the billing month on 40usd); plan decision 20. It scans every
 * execution and asks the guard per tool run: acceptable for a rarely run tool. Follow-up for WP3's owner (arch M-8): a
 * repository query for credits ledgered to `trigger = 'tool'` executions since an instant, which retires STATUS_FLAGS.
 */
export function priorToolCredits(ports: Ports): number {
  if (ports.config.providers.searchapi === null) return 0;
  const start = searchApiWindow(ports).windowStart;
  return ports.repos.executions
    .listByStatus(ALL_STATUSES)
    .filter((e) => e.trigger === 'tool' && (start === null || e.createdAt >= start))
    .reduce((n, e) => n + ports.budget.usage({ kind: 'execution-calls', executionId: e.id }).calls, 0);
}

/**
 * Where this run stands against every spend limit before a live call (plan decision 20, cost-wp4b-r2-001): the cross-run
 * sum against `--budget`, and each provider window's remaining room against the plan's worst case. `refusals` is empty
 * when a live run may start; `--confirm-rerun` lifts only the cross-run refusal, never a window that has no room.
 */
export function budgetPosition(
  ports: Ports,
  a: RecordArgs,
  plan: readonly PlannedCall[],
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const t = planTotals(plan);
  const prior = priorToolCredits(ports);
  const rerunNeedsConfirm = prior + t.worstCaseCredits > a.budget;
  const sa = searchApiWindow(ports);
  const tp = ports.budget.usage({ kind: 'provider-month', providerId: 'travelpayouts' });
  const windowRefusals: string[] = [];
  const room = (cap: number | null, used: number): number | null => (cap === null ? null : cap - used);
  const saRoom = room(sa.cap, sa.calls);
  const tpRoom = room(tp.cap, tp.calls);
  if (saRoom !== null && saRoom < t.worstCaseCredits)
    windowRefusals.push(
      `the SearchApi window has room for ${saRoom} credit(s) but this run may use ${t.worstCaseCredits}`,
    );
  if (tpRoom !== null && tpRoom < t.worstCaseFreeCalls)
    windowRefusals.push(
      `the Travelpayouts month has room for ${tpRoom} call(s) but this run may make ${t.worstCaseFreeCalls}`,
    );
  const lines = [
    `SearchApi credits already ledgered to tool runs in this budget window: ${prior}; this run ≤${t.worstCaseCredits}; --budget ${a.budget}${rerunNeedsConfirm ? ' (a live run needs --confirm-rerun)' : ''}`,
    `SearchApi window: ${sa.calls} of ${sa.cap ?? 'no cap'} used (compare with the dashboard); room ${saRoom ?? 'unlimited'}, this run ≤${t.worstCaseCredits}`,
    `Travelpayouts month: ${tp.calls} of ${tp.cap ?? 'no cap'} used; room ${tpRoom ?? 'unlimited'}, this run ≤${t.worstCaseFreeCalls}`,
    ...windowRefusals.map((r) => `a live run would be refused: ${r}`),
  ];
  return { lines, rerunNeedsConfirm, windowRefusals };
}

/** The plan's estimate, stored on the hidden execution so ledger-vs-estimate parity can be computed (cost-wp4b-010). */
function planEstimate(plan: readonly PlannedCall[], saCostMicroGbp: number): Estimate {
  const t = planTotals(plan);
  const saCost = t.worstCaseCredits * saCostMicroGbp;
  return {
    cells: 0,
    perProvider: [
      {
        providerId: 'travelpayouts',
        stage: 'discovery',
        calls: t.worstCaseFreeCalls,
        planCalls: t.freeCalls,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 0,
        blocked: null,
      },
      {
        providerId: 'searchapi',
        stage: 'verification',
        calls: t.worstCaseCredits,
        // why: every planned first attempt, the unbilled 401 probe included, so parity with the ledger's rows holds (cost M-1)
        planCalls: t.saCalls,
        costMicroGbp: saCost,
        costPence: Math.ceil(saCost / 10_000),
        seconds: 0,
        blocked: null,
      },
    ],
    totalCalls: t.worstCaseFreeCalls + t.worstCaseCredits,
    totalPlanCalls: t.freeCalls + t.saCalls,
    totalCostMicroGbp: saCost,
    totalCostPence: Math.ceil(saCost / 10_000),
    seconds: 0,
    assumptions: [
      'record:fixtures plan: SearchApi calls at worst-case credits; Travelpayouts calls at the page cap',
    ],
    windowClamped: false,
    retryFactor: 1,
  };
}

/**
 * The hidden execution that carries the run's caps in its snapshot budget (plan decision 5). The guard reads execution
 * caps from the snapshot, and the ledger's execution_id references search_executions, so recording needs a real
 * execution. Create and soft-delete are one transaction, and the snapshot is built from the deleted row
 * (prov-wp04b-009). The definition's space mirrors the calendar rectangle only to satisfy the definition schema:
 * nothing seeds cells for it, and spec §8.1 never resumes or schedules it.
 */
export function openRecordingExecution(
  ports: Ports,
  a: RecordArgs,
  plan: readonly PlannedCall[],
  sa: RecordingProviders['sa'],
): string {
  const now = ports.clock.now();
  const from = firstDayOf(a.month);
  const to = addDays(from, CALENDAR_OUT_DAYS - 1);
  // why: the guard enforces exactly the figure the dry run printed, never more than --budget (cost-wp4b-011)
  const maxCalls = Math.min(a.budget, planTotals(plan).worstCaseCredits);
  const input: DefinitionInput = {
    name: `record:fixtures ${now} (hidden tool run)`,
    origins: a.origins,
    destinations: a.destinations,
    window: { kind: 'absolute', from, to },
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: RECORD_TRAVEL_CLASS,
    constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: {
      maxCalls,
      maxFreeCalls: ports.config.spend.executionMaxFreeCalls,
      maxCostMicroGbp: maxCalls * sa.limits.costPerCallMicroGbp,
    },
    providers: { discovery: [], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: ports.config.schedulerTimezone,
    enabled: false,
  };
  const def = ports.db.immediateTransaction(() => {
    const created = ports.repos.definitions.create(input);
    ports.repos.definitions.softDelete(created.id);
    const deleted = ports.repos.definitions.get(created.id);
    if (deleted === null) throw new Error('hidden recording definition vanished');
    return deleted;
  });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: {
      origins: a.origins,
      destinations: a.destinations,
      departureFrom: from,
      departureTo: to,
      minNights: RECORD_MIN_NIGHTS,
      maxNights: RECORD_MAX_NIGHTS,
    },
    resolvedAt: now,
    windowClamped: false,
    droppedAlwaysInclude: [],
  };
  return ports.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot,
    estimate: planEstimate(plan, sa.limits.costPerCallMicroGbp),
    trigger: 'tool',
    status: 'running',
  }).id;
}
```

```ts
// apps/api/src/tools/recordReport.ts
/** Assessment and the human report of a recording run (spec §9 item 7; brief WP4b Task 12b reads these lines). */
import { existsSync, readFileSync } from 'node:fs';
import type { PlannedCall, RecordArgs } from './recordPlan.js';
import { bookingOptions, calendarIsEmpty, dataRowCount, isRecord } from './recordRequests.js';
import type { RecordedCall, RecordSummary } from './types.js';

export interface RunAssessment {
  requiredOk: boolean;
  /** Ids of required calls that did not answer as planned (empty when requiredOk). */
  notAsExpected: string[];
  chainComplete: boolean;
  /**
   * `'no-answer'` when the call got no HTTP status (skipped, aborted, no response): nothing is then said about what the
   * vendor would have answered (prov-wp04b-r3-002).
   */
  emptyEnvelope: 'yes' | 'no' | 'no-answer';
  overLimit: 'http-400' | 'empty-200' | 'other' | 'no-answer';
}

/** The parsed recorded file, or undefined when it is missing (e.g. never written). */
export function readRecorded(file: string | null): Record<string, unknown> | undefined {
  if (file === null || !existsSync(file)) return undefined;
  const v: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isRecord(v) ? v : undefined;
}

/** The recorder session a recorded file carries. */
export function sessionOf(file: string): string | null {
  const s = readRecorded(file)?.session;
  return typeof s === 'string' ? s : null;
}

/** The session of the first file any call wrote, or null. */
export function sessionOfCalls(calls: readonly RecordedCall[]): string | null {
  const first = calls.find((c) => c.file !== null)?.file ?? null;
  return first === null ? null : sessionOf(first);
}

/** Derived verdicts over a summary: required calls as planned, the chain, the empty envelope, the over-limit behaviour. */
export function assessRun(plan: readonly PlannedCall[], s: Pick<RecordSummary, 'calls'>): RunAssessment {
  const byId = new Map(s.calls.map((c) => [c.id, c] as const));
  const callOf = (kind: PlannedCall['spec']['kind'], purpose?: string): RecordedCall | undefined => {
    const p = plan.find(
      (x) =>
        x.spec.kind === kind &&
        (purpose === undefined || ('purpose' in x.spec && x.spec.purpose === purpose)),
    );
    return p === undefined ? undefined : byId.get(p.id);
  };
  const step3 = callOf('sa-step3');
  const probe = callOf('tp-tile', 'empty-probe');
  const over = callOf('sa-over-limit');
  const chainComplete = step3?.status === 200 && bookingOptions(readRecorded(step3.file)?.body).length > 0;
  const answered = (c: RecordedCall | undefined): c is RecordedCall & { status: number } =>
    typeof c?.status === 'number';
  const emptyEnvelope = !answered(probe)
    ? 'no-answer'
    : probe.status === 200 && dataRowCount(readRecorded(probe.file)?.body) === 0
      ? 'yes'
      : 'no';
  const overLimit = !answered(over)
    ? 'no-answer'
    : over.status === 400
      ? 'http-400'
      : over.status === 200 && calendarIsEmpty(readRecorded(over.file)?.body)
        ? 'empty-200'
        : 'other';
  const notAsExpected = plan
    .filter((p) => {
      if (!p.required) return false;
      if (p.spec.kind === 'sa-over-limit') return overLimit === 'other' || overLimit === 'no-answer';
      const c = byId.get(p.id);
      return c === undefined || typeof c.status !== 'number' || !p.expect.includes(c.status);
    })
    .map((p) => p.id);
  return {
    requiredOk: notAsExpected.length === 0 && chainComplete,
    notAsExpected,
    chainComplete,
    emptyEnvelope,
    overLimit,
  };
}

/** The ledger line, printed on every path that opened an execution (cost-wp4b-006). */
export function ledgerLine(s: { creditsUsed: number; freeCalls: number }, a: RecordArgs): string {
  return `ledger: SearchApi ${s.creditsUsed} credit(s) of budget ${a.budget}; Travelpayouts ${s.freeCalls} free call(s)`;
}

/**
 * Files of calls that were retried: every attempt before the last answered with an error and was not billed, so each
 * may be deleted whole before commit (prov-wp04b-r2-005); the operator never edits a file.
 */
export function retryAttemptLines(calls: readonly RecordedCall[]): string[] {
  return calls
    .filter((c) => c.files.length > 1)
    .map((c) =>
      // why: only a call whose final attempt answered 200 has deletable failed attempts; any other multi-file call is a
      // failure the operator keeps for review (prov-wp04b-r3-005)
      c.status === 200
        ? `${c.id}: non-final attempt file(s), unbilled, delete before commit (Task 12b step 4): ${c.files.slice(0, -1).join(', ')}`
        : `${c.id}: ${c.files.length} failed attempts, keep for review; the session cannot be committed as is`,
    );
}

/** The call a verdict line is about, by plan kind, for its status and detail. */
function callLine(
  s: RecordSummary,
  plan: readonly PlannedCall[],
  kind: PlannedCall['spec']['kind'],
  purpose?: string,
): string {
  const p = plan.find(
    (x) =>
      x.spec.kind === kind && (purpose === undefined || ('purpose' in x.spec && x.spec.purpose === purpose)),
  );
  const c = p === undefined ? undefined : s.calls.find((x) => x.id === p.id);
  return c === undefined
    ? 'not in the plan'
    : `${c.id} ${String(c.status)}${c.detail === null ? '' : ` (${c.detail})`}`;
}

const pounds = (pence: number | null): string => (pence === null ? '—' : (pence / 100).toFixed(2));

/** Human summary printed after a run. */
export function formatSummary(
  s: RecordSummary,
  v: RunAssessment,
  a: RecordArgs,
  plan: readonly PlannedCall[],
): string[] {
  const c = s.chain;
  const step3 = c.step3Options.map((o) => `${o.bookWith} ${pounds(o.pricePence)}`).join(', ');
  return [
    ...s.calls.map(
      (x) =>
        `${x.id} ${String(x.status)}${x.detail === null ? '' : ` (${x.detail})`}${x.files.length === 0 ? '' : ` → ${x.files.join(', ')}`}`,
    ),
    `required calls: ${v.requiredOk ? 'all as expected' : `NOT all as expected: ${v.notAsExpected.join(', ') || 'the chain is incomplete'}`}`,
    `chain step 1 → 2 → 3: ${v.chainComplete ? 'complete' : 'incomplete'}`,
    `chain prices (${c.currency}, diagnostics only): step 1 ${pounds(c.step1PricePence)}, step 2 ${pounds(c.step2PricePence)} (step 1 = step 2: ${c.step1PricePence !== null && c.step1PricePence === c.step2PricePence ? 'yes' : 'no'}); step 3 ${step3 === '' ? '—' : step3}`,
    `over-limit calendar (SA-03): ${v.overLimit === 'http-400' ? 'HTTP 400, as spike fact 2' : v.overLimit === 'empty-200' ? 'an empty HTTP 200, as the docs say (billed)' : v.overLimit === 'no-answer' ? `no vendor answer recorded: ${callLine(s, plan, 'sa-over-limit')}` : 'neither 400 nor an empty 200: raise a finding for WP5'}`,
    `empty envelope recorded: ${v.emptyEnvelope === 'yes' ? 'yes' : v.emptyEnvelope === 'no-answer' ? `no vendor answer recorded: ${callLine(s, plan, 'tp-tile', 'empty-probe')}` : 'no (best-effort; WP6 then needs a synthetic one: raise a finding)'}`,
    '429: not attempted; WP5 maps rate limits from a labelled synthetic fixture (plan decision 20)',
    ...retryAttemptLines(s.calls),
    `session: ${s.session ?? 'none (nothing recorded)'}`,
    ledgerLine(s, a),
    'next: read the SearchApi dashboard credits; run the manual review checklist (Task 12b) before git add',
  ];
}
```

```ts
// apps/api/src/tools/record.ts
/**
 * `pnpm record:fixtures` (spec §9 item 7, §5.3 Recorder, §2 facts 1–8, §16 WP4b).
 * Hand-built vendor requests through the real http-kit, recorder and SqliteBudgetGuard. The
 * adapters (WP5, WP6) do not exist yet and later replay what this records.
 */
import { mkdirSync } from 'node:fs';
import { AbortedError, asIsoDate, BudgetExceeded, type Config, ProviderError } from '@gmt/core';
import {
  createHttpKit,
  createRecorder,
  type FixtureRecorder,
  type HttpKit,
  type HttpKitRequest,
  type HttpKitResponse,
} from '@gmt/providers';
import { safeMessage } from '../safeMessage.js';
import type { Ports } from '../wiring.js';
import { budgetPosition, openRecordingExecution } from './recordExecution.js';
import { type EndpointKey, ParamLog, paramRules, writeAllowlist } from './recordParams.js';
import {
  type CellDates,
  formatPlan,
  freeCallMisfit,
  type PlannedCall,
  planCalls,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  type RecordArgs,
  type RecordCli,
  TP_MAX_PAGES_PER_TILE,
} from './recordPlan.js';
import { assessRun, formatSummary, ledgerLine, retryAttemptLines, sessionOfCalls } from './recordReport.js';
import {
  bookingOptions,
  calendarParams,
  cheapestCalendarCell,
  cheapestOption,
  dataRowCount,
  flightsParams,
  INVALID_SEARCHAPI_KEY,
  INVALID_TRAVELPAYOUTS_TOKEN,
  recordingLimits,
  saUrl,
  TP_PAGE_LIMIT,
  tpUrl,
} from './recordRequests.js';
import {
  EXIT,
  type RecordedCall,
  RecordingFailedError,
  type RecordingProviders,
  type RecordSummary,
  type ToolContext,
} from './types.js';

export type { RecordArgs } from './recordPlan.js';

/**
 * recordedBy signature on every file a real run records (spec §5.5). WP4's verifier accepts any non-blank signature;
 * the committed-tree manifest (checkWorkedExampleTree) is the only check that requires this one.
 */
export const RECORDED_BY = '@gmt/api record:fixtures';

// why: one sanitiser for every apps/api sink (src/safeMessage.ts); re-exported here, where the plan contract names it
export { safeMessage };

/** Why the configuration cannot record, or null (exit 78 in the tool bootstrap). */
export function recordPrecheck(c: Config): string | null {
  if (c.providers.travelpayouts === null || c.providers.searchapi === null)
    return 'record:fixtures needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY in the environment (.env)';
  // why: the committed tree is the public worked example's, recorded at point of sale GB (spec §2; po-009)
  if (c.pointOfSale !== 'GB') return `record:fixtures records at POINT_OF_SALE=GB; got ${c.pointOfSale}`;
  return null;
}

/** Wraps the recorder so every file written while a call runs (retries included) is attributed to that call. */
function tracking(inner: FixtureRecorder): { recorder: FixtureRecorder; take(): string[] } {
  let written: string[] = [];
  return {
    recorder: {
      record: async (r) => {
        const p = await inner.record(r);
        written.push(p);
        return p;
      },
    },
    take: () => {
      const out = written;
      written = [];
      return out;
    },
  };
}

type Sent =
  | { ok: true; res: HttpKitResponse }
  | { ok: false; status: RecordedCall['status']; detail: string };

/** The trailing `[code]` http-kit puts on every classified ProviderError message. */
function codeOf(e: ProviderError): string | null {
  return /\[([a-z0-9-]+)\]$/.exec(e.message)?.[1] ?? null;
}

/**
 * How a failed request is reported, or null for anything that is not a request result (recorder refusal, SQLite),
 * which then propagates. `skipped` only when nothing reached the vendor: a guard refusal, or a limiter queue timeout
 * (nothing reserved or sent, cost M-2). WP4 finalises a timeout `unknown` (counted) but a socket failure `error` (not
 * counted, and retried), so only the latter can leave a vendor charge the ledger does not show (cost-wp4b-r2-003).
 */
export function failureOf(e: unknown): { status: RecordedCall['status']; detail: string } | null {
  if (e instanceof BudgetExceeded) return { status: 'skipped', detail: `refused by the guard: ${e.scope}` };
  if (e instanceof AbortedError)
    return { status: 'aborted', detail: 'aborted (an attempt already sent is ledgered unknown, counted)' };
  if (!(e instanceof ProviderError)) return null;
  if (e.httpStatus !== undefined) return { status: e.httpStatus, detail: e.kind };
  if (e.kind === 'limiter-timeout')
    return { status: 'skipped', detail: 'rate-limit slot not granted within MAX_WAIT_SECONDS; nothing sent' };
  const code = codeOf(e);
  if (code === 'timeout') return { status: 'no-response', detail: 'timeout (ledgered unknown, counted)' };
  if (code === 'socket')
    return {
      status: 'no-response',
      detail:
        'network (ledgered error, NOT counted: if the dashboard drop exceeds the ledger, this call is why)',
    };
  return {
    status: 'no-response',
    detail: `${e.kind} without an HTTP status (${code ?? 'no code'}); see its ledger row`,
  };
}

/** One request; the guard, abort and provider errors become results, anything else (recorder refusal, SQLite) propagates. */
async function send(http: HttpKit, req: HttpKitRequest): Promise<Sent> {
  try {
    return { ok: true, res: await http.request(req) };
  } catch (e) {
    const f = failureOf(e);
    if (f === null) throw e;
    return { ok: false, ...f };
  }
}

function providerOf(call: PlannedCall): 'travelpayouts' | 'searchapi' {
  return call.spec.kind.startsWith('tp-') ? 'travelpayouts' : 'searchapi';
}

/**
 * Whole pence of a vendor's GBP price, or null for anything not a finite number (hard rule 7). Diagnostics only.
 * Follow-up (arch M-4): when WP6 lands `majorToMinor` in `@gmt/providers` (plan decision 24), this becomes
 * `majorToMinor(price, 'GBP')`, the single exact conversion.
 */
function toPence(price: number | undefined): number | null {
  return price !== undefined && Number.isFinite(price) ? Math.round(price * 100) : null;
}

/**
 * Runs the plan through the real http-kit + recorder + guard (spec §9 item 7), under the hidden recording execution.
 * Every request is cache 'never' (the vendor answers it) and recordFixtures true (the recorder sees it). The execution
 * ends `completed` when the plan ran to its end, with errorText naming any required call not as planned and any guard
 * refusal (prov-wp04b-r2-004); `cancelled` on abort; `cancelled` with errorText 'record:fixtures failed: …' when anything
 * threw (ExecutionStatus has no 'failed'), the error then rethrown as a RecordingFailedError whose cause is the original.
 */
export async function recordFixtures(
  ports: Ports,
  args: RecordArgs,
  ctx: { signal: AbortSignal; recordedRoot: string; recordedBy: string; plan?: readonly PlannedCall[] },
): Promise<RecordSummary> {
  const tp = ports.config.providers.travelpayouts;
  const sa = ports.config.providers.searchapi;
  const refusal = recordPrecheck(ports.config);
  if (tp === null || sa === null || refusal !== null)
    throw new Error(refusal ?? 'record:fixtures needs both providers');
  // why: runRecord passes the plan it printed, so the approved list is the list that runs (arch-023)
  const plan = ctx.plan ?? planCalls(args, ports.repos.airports.sharedMetro(args.origins));
  const misfit = freeCallMisfit(plan, ports.config.spend.executionMaxFreeCalls);
  if (misfit !== null) throw new Error(misfit);
  // why: the recorder refuses a missing or misplaced root; it is built before the hidden execution opens, so such a
  // refusal never leaves a 'running' execution behind (prov-wp04b-r3-003)
  const recorder = createRecorder({
    root: ctx.recordedRoot,
    secrets: ports.secrets,
    clock: ports.clock,
    recordedBy: ctx.recordedBy,
  });
  const providers: RecordingProviders = { tp, sa };
  const executionId = openRecordingExecution(ports, args, plan, sa);
  let run: PlanRun | null = null;
  try {
    run = new PlanRun(ports, plan, executionId, recorder, ctx, providers);
    await run.execute();
  } catch (e) {
    const message = safeMessage(e, ports.secrets);
    ports.repos.executions.setStatus(executionId, 'cancelled', {
      finishedAt: ports.clock.now(),
      errorText: `record:fixtures failed: ${message}`,
    });
    const partial = run?.usage() ?? { calls: [], creditsUsed: 0, freeCalls: 0, session: null };
    throw new RecordingFailedError(`record:fixtures failed: ${message}`, partial, { cause: e });
  }
  const summary = run.summary();
  const guardStops = summary.calls.filter(
    (c) => c.detail?.startsWith('refused by the guard') === true,
  ).length;
  const verdict = assessRun(plan, summary);
  const notes = [
    ...(verdict.notAsExpected.length > 0
      ? [`required calls not as expected: ${verdict.notAsExpected.join(', ')}`]
      : []),
    // why: a step 3 that answered 200 without a priced booking option leaves requiredOk false with every status as
    // planned (prov-wp04b-r2-004)
    ...(verdict.chainComplete ? [] : ['chain incomplete']),
    ...(guardStops > 0 ? [`${guardStops} call(s) refused by the guard`] : []),
  ];
  const aborted = ctx.signal.aborted;
  ports.repos.executions.setStatus(executionId, aborted ? 'cancelled' : 'completed', {
    finishedAt: ports.clock.now(),
    // why: completed, not paused_budget — paused_budget is an active status, and this execution is never resumed (cost-wp4b-012)
    errorText: aborted ? 'aborted' : notes.length > 0 ? notes.join('; ') : null,
  });
  return summary;
}

/** One run of the plan: the state the chain threads from call to call. */
class PlanRun {
  private readonly calls: RecordedCall[] = [];
  private readonly params = new ParamLog(paramRules());
  private readonly track: ReturnType<typeof tracking>;
  private readonly kit: HttpKit;
  private readonly gl: string;
  private cell: CellDates | null = null;
  private departureToken: string | null = null;
  private bookingToken: string | null = null;
  private tileIndex = 0;
  private readonly chain: RecordSummary['chain'] = {
    currency: 'GBP',
    step1PricePence: null,
    step2PricePence: null,
    step3Options: [],
  };

  constructor(
    private readonly ports: Ports,
    private readonly plan: readonly PlannedCall[],
    private readonly executionId: string,
    recorder: FixtureRecorder,
    private readonly ctx: { signal: AbortSignal; recordedRoot: string },
    private readonly providers: RecordingProviders,
  ) {
    this.track = tracking(recorder);
    this.gl = ports.config.pointOfSale.toLowerCase();
    this.kit = createHttpKit({
      budget: ports.budget,
      cache: ports.cache,
      clock: ports.clock,
      log: ports.log,
      // why: both providers are configured here, so secrets is non-empty as HttpKitDeps requires
      secrets: ports.secrets,
      syntheticAllowed: false,
      recorder: this.track.recorder,
      limits: recordingLimits(providers.tp, providers.sa, ports.config),
    });
  }

  private request(
    providerId: 'travelpayouts' | 'searchapi',
    url: URL,
    headers: Record<string, string>,
    tile: number | null,
  ): HttpKitRequest {
    return {
      providerId,
      executionId: this.executionId,
      tileIndex: tile,
      endpointPath: url.pathname,
      method: 'GET',
      url,
      headers,
      cache: 'never',
      signal: this.ctx.signal,
      recordFixtures: true,
    };
  }

  /** Validates before the request leaves; adds the parameters to the allowlist only when the vendor answered. */
  private async exec(
    id: string,
    providerId: 'travelpayouts' | 'searchapi',
    key: EndpointKey,
    req: HttpKitRequest,
  ): Promise<Sent> {
    this.params.validate(key, req.url.searchParams);
    const r = await send(this.kit, req);
    const files = this.track.take();
    if (r.ok || typeof r.status === 'number') this.params.observe(key, req.url.searchParams);
    this.calls.push({
      id,
      providerId,
      status: r.ok ? r.res.status : r.status,
      file: files.at(-1) ?? null,
      files,
      detail: r.ok ? null : r.detail,
    });
    return r;
  }

  /**
   * Required calls run so far that did not answer as planned (a page counts for its tile). why: once one has failed,
   * the run must be repeated and its session cannot be committed, so no SearchApi credit is spent on it (cost I-1).
   */
  private requiredNotAsPlanned(): string[] {
    const planned = new Map(this.plan.map((p) => [p.id, p] as const));
    return this.calls
      .filter((c) => {
        const p = planned.get(c.id.replace(/p\d+$/, ''));
        return p?.required === true && !(typeof c.status === 'number' && p.expect.includes(c.status));
      })
      .map((c) => c.id);
  }

  private skip(call: PlannedCall, detail: string): void {
    this.calls.push({
      id: call.id,
      providerId: providerOf(call),
      status: 'skipped',
      file: null,
      files: [],
      detail,
    });
  }

  async execute(): Promise<void> {
    const { tp, sa } = this.providers;
    const tpHeaders = (token: string): Record<string, string> => ({ 'X-Access-Token': token });
    const saHeaders = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });
    let calendarAnswered = false;
    let doomed: string | null = null;
    for (const call of this.plan) {
      if (this.ctx.signal.aborted) {
        this.skip(call, 'aborted before send');
        continue;
      }
      const s = call.spec;
      if (s.kind === 'sa-calendar') {
        // why: SA-02 is the first billed call; a run already doomed spends nothing more (cost I-1, plan decision 30)
        const failed = this.requiredNotAsPlanned();
        if (failed.length > 0)
          doomed = `skipped: required call(s) ${failed.join(', ')} not as planned; the run must be repeated`;
      }
      if (doomed !== null && s.kind.startsWith('sa-') && s.kind !== 'sa-auth') {
        this.skip(call, doomed);
        continue;
      }
      switch (s.kind) {
        case 'tp-tile': {
          const tile = this.tileIndex++;
          for (let page = 1; ; page++) {
            const url = tpUrl(s.origin, s.destination, s.month, page);
            const id = page === 1 ? call.id : `${call.id}p${page}`;
            const r = await this.exec(
              id,
              'travelpayouts',
              'prices_for_dates',
              this.request('travelpayouts', url, tpHeaders(tp.token.reveal()), tile),
            );
            if (!r.ok || dataRowCount(r.res.body) < TP_PAGE_LIMIT) break;
            if (page === TP_MAX_PAGES_PER_TILE) {
              const last = this.calls.at(-1);
              // why: a vendor ignoring `page` must not page to the per-run cap (cost-wp4b-r2-002)
              if (last !== undefined)
                last.detail = `page cap reached (${TP_MAX_PAGES_PER_TILE} pages of ${TP_PAGE_LIMIT} rows)`;
              break;
            }
          }
          break;
        }
        case 'tp-auth': {
          const url = tpUrl(s.origin, s.destination, s.month, 1);
          await this.exec(
            call.id,
            'travelpayouts',
            'prices_for_dates',
            this.request('travelpayouts', url, tpHeaders(INVALID_TRAVELPAYOUTS_TOKEN), null),
          );
          break;
        }
        case 'sa-calendar': {
          const url = saUrl(calendarParams(s.origin, s.destination, s.rect, this.gl));
          const r = await this.exec(
            call.id,
            'searchapi',
            'google_flights_calendar',
            this.request('searchapi', url, saHeaders(sa.key.reveal()), this.tileIndex++),
          );
          if (r.ok)
            this.cell = cheapestCalendarCell(
              r.res.body,
              { minNights: RECORD_MIN_NIGHTS, maxNights: RECORD_MAX_NIGHTS },
              s.rect,
            );
          calendarAnswered = this.cell !== null;
          break;
        }
        case 'sa-over-limit': {
          // why: without a usable calendar the chain is doomed and the run must be repeated, so nothing more is spent (cost-wp4b-r2-004)
          if (!calendarAnswered) {
            this.skip(call, 'skipped: calendar SA-02 gave no usable cell; the run must be repeated');
            break;
          }
          const url = saUrl(calendarParams(s.origin, s.destination, s.rect, this.gl));
          await this.exec(
            call.id,
            'searchapi',
            'google_flights_calendar',
            this.request('searchapi', url, saHeaders(sa.key.reveal()), this.tileIndex++),
          );
          break;
        }
        case 'sa-step1':
        case 'sa-step2':
        case 'sa-step3': {
          const token =
            s.kind === 'sa-step1'
              ? {}
              : s.kind === 'sa-step2'
                ? this.departureToken === null
                  ? null
                  : { departure_token: this.departureToken }
                : this.bookingToken === null
                  ? null
                  : { booking_token: this.bookingToken };
          if (this.cell === null || token === null) {
            this.skip(
              call,
              'chain prerequisite missing (no priced in-band cell or no token from the previous step)',
            );
            break;
          }
          const url = saUrl(flightsParams(s.origin, s.destination, this.cell, this.gl, token));
          const r = await this.exec(
            call.id,
            'searchapi',
            'google_flights',
            this.request('searchapi', url, saHeaders(sa.key.reveal()), null),
          );
          if (!r.ok) break;
          if (s.kind === 'sa-step1') {
            const o = cheapestOption(r.res.body, 'departure_token');
            this.departureToken = o?.token ?? null;
            this.chain.step1PricePence = toPence(o?.price);
          } else if (s.kind === 'sa-step2') {
            const o = cheapestOption(r.res.body, 'booking_token');
            this.bookingToken = o?.token ?? null;
            this.chain.step2PricePence = toPence(o?.price);
          } else {
            this.chain.step3Options = bookingOptions(r.res.body).flatMap((o) => {
              const pricePence = toPence(o.price);
              return pricePence === null ? [] : [{ bookWith: o.bookWith, pricePence }];
            });
          }
          break;
        }
        case 'sa-auth': {
          const url = saUrl(flightsParams(s.origin, s.destination, s.cell, this.gl, {}));
          await this.exec(
            call.id,
            'searchapi',
            'google_flights',
            this.request('searchapi', url, saHeaders(INVALID_SEARCHAPI_KEY), null),
          );
          break;
        }
        default: {
          const unhandled: never = s;
          throw new Error(`unhandled call ${JSON.stringify(unhandled)}`);
        }
      }
    }
    if (this.calls.some((c) => c.files.length > 0)) {
      // why: the UTC date, as in the recorded files' names (recordedAt.slice(0, 10))
      const date = asIsoDate(this.ports.clock.now().slice(0, 10));
      writeAllowlist(this.ctx.recordedRoot, this.params.document('travelpayouts', date));
      writeAllowlist(this.ctx.recordedRoot, this.params.document('searchapi', date));
    }
  }

  usage(): { calls: RecordedCall[]; creditsUsed: number; freeCalls: number; session: string | null } {
    return {
      calls: this.calls,
      creditsUsed: this.ports.budget.usage({ kind: 'execution-calls', executionId: this.executionId }).calls,
      freeCalls: this.ports.budget.usage({ kind: 'execution-free-calls', executionId: this.executionId })
        .calls,
      session: sessionOfCalls(this.calls),
    };
  }

  summary(): RecordSummary {
    return { ...this.usage(), chain: this.chain };
  }
}

/**
 * The `record` tool (spec §7 tool bootstrap, §9 item 7). Prints the plan and the budget position; a dry run stops
 * there. A live run refuses (exit 65) when a provider window lacks room for the worst case, or when its worst case
 * plus credits already ledgered to earlier tool runs would exceed --budget, unless --confirm-rerun (plan decision 20).
 * The ledger line and the session id are printed on every path that opened an execution (cost-wp4b-006, prov-wp04b-r2-005).
 */
export async function runRecord(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number> {
  const a = cli.args;
  const metro = ports.repos.airports.sharedMetro(a.origins);
  const plan = planCalls(a, metro);
  for (const line of formatPlan(plan)) ctx.out(line);
  ctx.out(`metro from the airports table: ${metro ?? 'none (each origin airport is tiled)'}`);
  ctx.out(`recording into: ${ctx.recordedRoot}`);
  const maxFree = ports.config.spend.executionMaxFreeCalls;
  ctx.out(`Travelpayouts per-run cap (EXECUTION_MAX_FREE_CALLS): ${maxFree}`);
  const misfit = freeCallMisfit(plan, maxFree);
  if (misfit !== null) {
    ctx.err(misfit);
    return EXIT.badConfig;
  }
  const position = budgetPosition(ports, a, plan);
  for (const line of position.lines) ctx.out(line);
  if (cli.dryRun) return EXIT.ok;
  if (position.windowRefusals.length > 0) {
    ctx.err(`refusing: ${position.windowRefusals.join('; ')} (never start what cannot finish)`);
    return EXIT.spendRefused;
  }
  if (position.rerunNeedsConfirm && !cli.confirmRerun) {
    ctx.err(
      `refusing: credits already ledgered to earlier tool runs plus this run's worst case exceed --budget ${a.budget}; stop and ask before re-running, then pass --confirm-rerun (plan decision 20)`,
    );
    return EXIT.spendRefused;
  }
  // why: `--out DIR` names a directory that may not exist yet, and the recorder requires its root (prov-wp04b-r3-003)
  mkdirSync(ctx.recordedRoot, { recursive: true });
  let summary: RecordSummary;
  try {
    summary = await recordFixtures(ports, a, {
      signal: ctx.signal,
      recordedRoot: ctx.recordedRoot,
      recordedBy: ctx.recordedBy,
      plan,
    });
  } catch (e) {
    if (!(e instanceof RecordingFailedError)) throw e;
    for (const x of e.partial.calls)
      ctx.out(`${x.id} ${String(x.status)}${x.files.length === 0 ? '' : ` → ${x.files.join(', ')}`}`);
    for (const line of retryAttemptLines(e.partial.calls)) ctx.out(line);
    ctx.err(e.message);
    ctx.out(`session: ${e.partial.session ?? 'none (nothing recorded)'}`);
    ctx.out(ledgerLine(e.partial, a));
    return EXIT.failed;
  }
  const verdict = assessRun(plan, summary);
  for (const line of formatSummary(summary, verdict, a, plan)) ctx.out(line);
  return verdict.requiredOk && !ctx.signal.aborted ? EXIT.ok : EXIT.failed;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/record.test.ts`
Expected: 25 passed. Two failures would mean the merged WP3 or WP4 differs from section 4, so raise a finding rather than adapt the test: a missing 400 or 401 file (the recorder does not record every attempt), or a `departure_token` request in the budget test (the guard does not read the snapshot budget).

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/providers && git commit -m "wp04b: record:fixtures run through the real http-kit, recorder and guard under a hidden tool execution"
```

### Task 7: `readOnlyLockState` in `@gmt/db`

**Files:** modify `packages/db/src/appLock.ts`, `packages/db/src/index.ts`, `packages/db/test/barrel.test.ts`; create `packages/db/test/readOnlyLockState.test.ts`.

**Interfaces:** consumes `AppLock`, `LOCK_STALE_AFTER_MS`, `readTime` (WP3 internals), `better-sqlite3` (already `@gmt/db`'s dependency). Produces `readOnlyLockState(dbPath, clock): ReadOnlyLockState`, a discriminated union (`{ state: 'absent' }` or `{ state: 'fresh' | 'stale'; holder: 'app' | 'tool'; heartbeatAt }`), the module-private `isFresh(heartbeatAt, now)` that AppLock and readOnlyLockState now share, so the two can never disagree about staleness (arch-r3-003), and the module-private `readLockRow` (one SELECT, `holder` validated through the same `oneOf` as `AppLock.inspect`; arch M-2). `readOnlyLockState` and `type ReadOnlyLockState` are exported from the `@gmt/db` barrel; `isFresh` and `readLockRow` stay private.

The tool bootstrap must read `app_lock` before any backup or migration without opening the database read-write (spec §7, plan decision 20). This function lives beside `AppLock` so the SQLite dependency stays in `@gmt/db`. It throws for a file that is not a database and for a malformed heartbeat (only a hand-made table can hold one: the migrated schema CHECKs the column); the caller maps a throw to exit 73 (r2-ts-007).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/readOnlyLockState.test.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { AppLock, LOCK_STALE_AFTER_MS, readOnlyLockState } from '../src/appLock.js';
import { RowCorrupt } from '../src/internal/read.js';
import { at, freshDb, silentLog, T0, tmpDbPath, tmpDir } from './helpers/db.js';

const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** A migrated file database holding an app lock taken at T0, closed again (so no -wal/-shm remains). */
function lockedFile(): string {
  const path = tmpDbPath();
  const db = freshDb(path);
  expect(new AppLock(db, 'app', fixedClock(T0), silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
  return path;
}

describe('readOnlyLockState (spec §7 app_lock; plan decision 20)', () => {
  it('a missing file is absent and is not created', () => {
    const path = join(tmpDir(), 'none.db');
    expect(readOnlyLockState(path, fixedClock(T0))).toEqual({ state: 'absent' });
    expect(existsSync(path)).toBe(false);
  });

  it('a database without the app_lock table (pre-migration) is absent, and nothing is migrated', () => {
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec('CREATE TABLE t (x INTEGER)');
    raw.close();
    expect(readOnlyLockState(path, fixedClock(T0))).toEqual({ state: 'absent' });
    const check = new Database(path, { readonly: true });
    expect(
      check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'").get(),
    ).toEqual({ n: 0 });
    check.close();
  });

  it('a migrated database with no lock row is absent', () => {
    const path = tmpDbPath();
    freshDb(path).close();
    expect(readOnlyLockState(path, fixedClock(T0))).toEqual({ state: 'absent' });
  });

  it('a heartbeat within LOCK_STALE_AFTER_MS is fresh, older is stale; the file is never written', () => {
    const path = lockedFile();
    const before = { digest: digest(path), mtime: statSync(path).mtimeMs };
    const clock = fixedClock(T0);
    clock.advance(LOCK_STALE_AFTER_MS);
    expect(readOnlyLockState(path, clock)).toEqual({
      state: 'fresh',
      holder: 'app',
      heartbeatAt: at('2026-10-14T12:00:00.000Z'),
    });
    clock.advance(1);
    expect(readOnlyLockState(path, clock)).toEqual({ state: 'stale', holder: 'app', heartbeatAt: T0 });
    expect({ digest: digest(path), mtime: statSync(path).mtimeMs }).toEqual(before);
    // why: a read-only connection to a WAL database needs SQLite's -wal/-shm sidecars and creates empty ones when
    // absent; nothing is ever written to the log
    expect(existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0).toBe(0);
    const check = new Database(path, { readonly: true });
    expect(check.pragma('journal_mode', { simple: true })).toBe('wal');
    check.close();
  });

  it("sees a live app's heartbeat that is still only in the WAL", () => {
    const path = tmpDbPath();
    const live = freshDb(path);
    const clock = fixedClock(T0);
    expect(new AppLock(live, 'app', clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    expect(readOnlyLockState(path, clock)).toEqual({ state: 'fresh', holder: 'app', heartbeatAt: T0 });
  });

  it(':memory: is absent', () => {
    expect(readOnlyLockState(':memory:', fixedClock(T0))).toEqual({ state: 'absent' });
  });

  it('throws for a file that is not a SQLite database (the tool maps it to exit 73)', () => {
    const path = join(tmpDir(), 'garbage.db');
    writeFileSync(path, 'this is not a database, just text long enough to fill a header page');
    expect(() => readOnlyLockState(path, fixedClock(T0))).toThrow(/not a database/);
  });

  it('throws RowCorrupt for a malformed heartbeat_at (a hand-made table; the migrated schema CHECKs the column)', () => {
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec(
      'CREATE TABLE app_lock (id INTEGER PRIMARY KEY, holder TEXT, heartbeat_at TEXT, acquired_at TEXT)',
    );
    raw.prepare("INSERT INTO app_lock VALUES (1, 'app', 'yesterday', 'yesterday')").run();
    raw.close();
    expect(() => readOnlyLockState(path, fixedClock(T0))).toThrow(/heartbeat_at/);
  });

  it('throws RowCorrupt for a holder other than app or tool, through the same check as AppLock.inspect (arch M-2)', () => {
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec(
      'CREATE TABLE app_lock (id INTEGER PRIMARY KEY, holder TEXT, heartbeat_at TEXT, acquired_at TEXT)',
    );
    raw.prepare('INSERT INTO app_lock VALUES (1, ?, ?, ?)').run('intruder', T0, T0);
    raw.close();
    expect(() => readOnlyLockState(path, fixedClock(T0))).toThrow(RowCorrupt);
    expect(() => readOnlyLockState(path, fixedClock(T0))).toThrow(/app_lock\.holder/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/db exec vitest run test/readOnlyLockState.test.ts`
Expected: FAIL, 9 failed; the first failure is `TypeError: readOnlyLockState is not a function`.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/appLock.ts (changes)
// top of the file: two new imports beside the existing ones
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

// after LOCK_STALE_AFTER_MS:
/** The one freshness rule (spec §7): a heartbeat at most LOCK_STALE_AFTER_MS old. AppLock and readOnlyLockState share it. */
function isFresh(heartbeatAt: string, now: string): boolean {
  return Date.parse(now) - Date.parse(heartbeatAt) <= LOCK_STALE_AFTER_MS;
}

/** What readOnlyLockState reports; a present lock always names its holder and heartbeat. */
export type ReadOnlyLockState =
  | { state: 'absent' }
  | { state: 'fresh' | 'stale'; holder: Holder; heartbeatAt: IsoDateTime };

// after the LockRow interface: one validated reader shared by AppLock.inspect and readOnlyLockState (arch M-2)
const LOCK_ROW_SQL = 'SELECT holder, heartbeat_at, acquired_at FROM app_lock WHERE id = 1';

/** The lock row, validated; null when there is none. One reader for AppLock.inspect and readOnlyLockState (arch M-2). */
function readLockRow(
  raw: Database.Database,
): { holder: Holder; heartbeatAt: IsoDateTime; acquiredAt: IsoDateTime } | null {
  const r = raw.prepare<[], LockRow>(LOCK_ROW_SQL).get();
  if (r === undefined) return null;
  return {
    holder: oneOf('app_lock.holder', HOLDERS, r.holder),
    heartbeatAt: readTime('app_lock.heartbeat_at', r.heartbeat_at),
    acquiredAt: readTime('app_lock.acquired_at', r.acquired_at),
  };
}

// AppLock.inspect becomes `return readLockRow(db.raw);`; AppLock.tryAcquire reads its raw row with
// `this.db.raw.prepare<[], LockRow>(LOCK_ROW_SQL).get()`, and its staleness test becomes the shared rule:
        if (isFresh(row.heartbeat_at, now)) return false;

// end of the file:
/**
 * The lock as another process would judge it, read through a read-only connection (spec §7; plan decision 20: a tool
 * inspects app_lock before any backup or migration). `absent` for a missing file, a database without the table or
 * an empty table; `fresh` while the heartbeat is at most LOCK_STALE_AFTER_MS old; `stale` after that. It never writes:
 * no journal-mode change, no migration, no checkpoint on close. why: a read-only connection still reads the -wal, so a
 * live app's latest heartbeat is seen; SQLite creates empty -wal/-shm sidecars when they are absent and writes nothing.
 * Throws for a file that is not a SQLite database, a database it cannot open, or a malformed heartbeat_at (RowCorrupt);
 * the tool bootstrap maps any throw to exit 73.
 */
export function readOnlyLockState(dbPath: string, clock: Clock): ReadOnlyLockState {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return { state: 'absent' };
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const table = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'app_lock'",
      )
      .get();
    if ((table?.n ?? 0) === 0) return { state: 'absent' };
    const row = readLockRow(db);
    if (row === null) return { state: 'absent' };
    return {
      state: isFresh(row.heartbeatAt, clock.now()) ? 'fresh' : 'stale',
      holder: row.holder,
      heartbeatAt: row.heartbeatAt,
    };
  } finally {
    db.close();
  }
}
```

In `packages/db/src/index.ts`, extend the `appLock.js` export line:

```ts
export {
  AppLock,
  HEARTBEAT_INTERVAL_MS,
  LOCK_STALE_AFTER_MS,
  type ReadOnlyLockState,
  readOnlyLockState,
} from './appLock.js';
```

In `packages/db/test/barrel.test.ts`, add `'readOnlyLockState'` to both lists: after `'LOCK_STALE_AFTER_MS'` in the "exports every contract name" list, and after `'pendingMigrations'` in the exact-keys list.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/db exec vitest run test/readOnlyLockState.test.ts test/barrel.test.ts test/appLock.test.ts` and `pnpm --filter @gmt/db test`
Expected: 9 passed in the new file; the three files 25 passed; the db suite passes with WP3's thresholds (263 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db && git commit -m "wp04b: readOnlyLockState in @gmt/db, so the tool reads app_lock before any backup or migration"
```

### Task 8: Tool bootstrap (in-process)

**Files:** create `apps/api/src/bootstrap/tool.ts`, `apps/api/src/bootstrap/preflight.ts`, `apps/api/src/tools/workedExample.ts`, `apps/api/test/bootstrap/tool.test.ts`, `apps/api/test/bootstrap/preflight.test.ts`; modify `packages/providers/src/index.ts`, `packages/providers/test/barrel.test.ts`.

**Interfaces:** consumes `AppLock`, `HEARTBEAT_INTERVAL_MS`, `readOnlyLockState` (Task 7), `openDatabase`, `pendingMigrations`, `backupDatabase`, `seedAirports`, `loadAirportsDataset`, `AIRPORTS_DATA_DIR`, `MIGRATIONS_DIR`, `defaultRecordedRoot`, `buildPorts`, `loadConfigFromEnv`, `collectSecrets`, `createLogger`, `runRecord`, `recordPrecheck`. Produces `runTool`, `RunToolOptions`, `RecordingTarget`, `recordingTarget`, `repositoryRoot`, `isEntryPoint`, `ToolRunners`, `backupsDirFor`, `pendingOnExistingDb`, `WORKED_EXAMPLE_ROUTE`, `isWorkedExampleRoute`.

Every exit path is tested through the injectable `runners` table: a throwing tool, SIGINT and SIGTERM (twice), the heartbeat under fake timers, a lock taken over mid-run (with and without a throw), a buildPorts failure, an unreadable database, an unreadable migration state, an existing database in a read-only directory (ts-003, r2-ts-005). The refusal after `buildPorts` when `AppLock.acquire` refuses is reached only by a process that takes the lock between the read-only check and the acquire; WP3's AppLock tests cover the refusal itself. Every test records into a temporary tree under the test signature, and the suite snapshots the committed tree's files (with size and mtime) before it runs and asserts the snapshot unchanged after: no test adds, removes or changes a file in the committed tree, before or after Task 12b commits it (prov-wp04b-006, prov-wp04b-r3-001). Three further groups drive `runRecord` through `runTool`: a run with required calls not as planned, a 5xx retried into a 200 (fake timers; the retry line and its file), and a SIGINT during the calendar; a live `--out` run into a fresh directory; and `recordingTarget` itself (a given target wins; the worked example and `--out` sign `RECORDED_BY`; `--out` at the repository root, through a relative path or through a symlink into it is refused) (r2-ts-004, r3-ts-004).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/bootstrap/tool.test.ts
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { asIsoDateTime, fixedClock, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, HEARTBEAT_INTERVAL_MS, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { defaultRecordedRoot } from '@gmt/providers';
import { loadRecorded } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { backupsDirFor } from '../../src/bootstrap/preflight.js';
import {
  EXIT,
  isEntryPoint,
  type RunToolOptions,
  recordingTarget,
  repositoryRoot,
  repositoryRoots,
  runTool,
} from '../../src/bootstrap/tool.js';
import { RECORDED_BY } from '../../src/tools/record.js';
import { parseRecordArgs } from '../../src/tools/recordPlan.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, toolEnv } from '../helpers/env.js';
import { TEST_RECORDED_BY, testRecording } from '../helpers/recording.js';
import { filesUnder, tempDir } from '../helpers/tmp.js';
import { stubVendors } from '../helpers/vendors.js';

const ROUTE = ['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03'];
const DRY = [...ROUTE, '--dry-run'];

afterEach(() => {
  vi.useRealTimers();
});
/** Every file of the committed tree with its size and mtime. */
function committedTree(): string[] {
  return filesUnder(defaultRecordedRoot()).map((p) => {
    const st = statSync(p);
    return `${p} ${st.size} ${st.mtimeMs}`;
  });
}
// why: no test adds, removes or changes a file in the committed tree (prov-wp04b-006); a snapshot, not a fixed list,
// so the guard holds before and after Task 12b commits the recorded tree (prov-wp04b-r3-001)
let committedBefore: string[] = [];
beforeAll(() => {
  committedBefore = committedTree();
});
afterAll(() => {
  expect(committedTree()).toEqual(committedBefore);
});

/** A temp database and a temp recorded tree with the test signature (every runTool test records there, never in the committed tree). */
function harness(dbPath = join(tempDir('gmt-tool-'), 'tool.db'), extra: Record<string, string> = {}) {
  const rec = testRecording();
  const out: string[] = [];
  const err: string[] = [];
  // why: the tool's pino lines (e.g. a lost lock) go to this sink, not the test runner's stderr
  const logDestination = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const opts: RunToolOptions = {
    env: toolEnv(dbPath, extra),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    logDestination,
    recording: rec.recording,
  };
  return { dbPath, root: rec.root, out, err, opts, text: () => out.join('\n'), errors: () => err.join('\n') };
}

function holdLock(dbPath: string, at: 'now' | 'stale', holder: 'app' | 'tool' = 'app'): void {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  const clock =
    at === 'now' ? systemClock : fixedClock(asIsoDateTime(new Date(Date.now() - 10 * 60_000).toISOString()));
  expect(new AppLock(db, holder, clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
}

/** One row of a query, read after the tool has finished with the file. */
function count(dbPath: string, sql: string): unknown {
  const db = openDatabase(dbPath);
  try {
    return db.raw.prepare(sql).get();
  } finally {
    db.close();
  }
}

describe('runTool refusals (spec §5.5, §7, plan decision 20)', () => {
  it('refuses NODE_ENV=test (read through loadConfigFromEnv) before opening anything', async () => {
    const h = harness(undefined, { NODE_ENV: 'test' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.refusedTestEnv);
    expect(h.errors()).toContain('tool bootstrap refuses NODE_ENV=test');
    expect(existsSync(h.dbPath)).toBe(false);
  });

  it('reports invalid configuration with 78 and never echoes a value', async () => {
    const h = harness(undefined, { BIND_ADDRESS: '0.0.0.0' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.badConfig);
    expect(h.errors()).toContain('invalid configuration');
    expect(h.errors()).not.toContain(SENTINEL_SA);
  });

  it('refuses while the synthetic gate is open with 70, as the plan exit table says (sec-005, ts-012, arch-r3-001)', async () => {
    const dir = tempDir();
    const h = harness(join(dir, 'tool.fixture.db'), { ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.refusedTestEnv);
    expect(h.errors()).toContain('synthetic gate is open');
    expect(existsSync(join(dir, 'tool.fixture.db'))).toBe(false);
  });

  it('refuses smoke (WP13) and a missing budget with the usage code', async () => {
    const h = harness();
    expect(await runTool('smoke', [], h.opts)).toBe(EXIT.usage);
    expect(h.errors()).toContain('WP13 adds it');
    expect(await runTool('record', ['--route', 'LHR:JFK', '--month', '2027-03'], h.opts)).toBe(EXIT.usage);
    expect(h.errors()).toContain('--budget is required');
  });

  it.each([
    [{ SEARCHAPI_KEY: '' }, 'needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY'],
    [{ POINT_OF_SALE: 'US' }, 'POINT_OF_SALE=GB'],
  ])('refuses a configuration that cannot record with 78: %j (arch-022, po-009)', async (extra, message) => {
    const h = harness(undefined, extra);
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.badConfig);
    expect(h.errors()).toContain(message);
  });

  it('a fresh app lock refuses with 75 before the backup or any migration (po-008, sec-007)', async () => {
    const h = harness();
    const db = openDatabase(h.dbPath); // a bare table, no migrations: the pre-migration case
    db.raw.exec(
      'CREATE TABLE app_lock (id INTEGER PRIMARY KEY, holder TEXT NOT NULL, heartbeat_at TEXT NOT NULL, acquired_at TEXT NOT NULL)',
    );
    const now = new Date().toISOString();
    db.raw.prepare('INSERT INTO app_lock VALUES (1, ?, ?, ?)').run('app', now, now);
    db.close();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.lockRefused);
    expect(h.errors()).toContain('app_lock is held by app');
    expect(existsSync(backupsDirFor(h.dbPath))).toBe(false);
    expect(
      count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'"),
    ).toEqual({ n: 0 });
  });

  it('a fresh app lock on a migrated database refuses with 75 and leaves the lock untouched', async () => {
    const h = harness();
    holdLock(h.dbPath, 'now');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.lockRefused);
    expect(count(h.dbPath, 'SELECT holder FROM app_lock')).toEqual({ holder: 'app' });
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses with 73 when the data directory is not writable (ts-018)',
    async () => {
      const dir = tempDir();
      chmodSync(dir, 0o500);
      const h = harness(join(dir, 'tool.db'));
      expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
      expect(h.errors()).toContain('is not writable');
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    'refuses with 73 when an existing database sits in a directory that is not writable (arch-r2-001, sec2-001)',
    async () => {
      const dir = tempDir();
      const h = harness(join(dir, 'tool.db'));
      holdLock(h.dbPath, 'stale');
      chmodSync(dir, 0o500);
      expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
      expect(h.errors()).toContain('is not writable');
    },
  );

  it('refuses with 73, scrubbed, when DATABASE_PATH is not a SQLite database: no backup, no lock (r2-ts-005 a)', async () => {
    const h = harness();
    writeFileSync(h.dbPath, 'not a database; long enough to fill a SQLite header page, which this is not');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
    expect(h.errors()).toContain('cannot read app_lock');
    expect(existsSync(backupsDirFor(h.dbPath))).toBe(false);
  });

  it('refuses with 73 when the migration state cannot be read (r2-ts-005 b)', async () => {
    const h = harness();
    const db = openDatabase(h.dbPath);
    db.raw.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY)'); // no created_at column
    db.close();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
    expect(h.errors()).toContain('cannot read the migration state');
  });

  it('refuses with 73 when migrations are pending and the backups path is not a directory', async () => {
    const h = harness();
    openDatabase(h.dbPath).close();
    writeFileSync(backupsDirFor(h.dbPath), 'not a directory');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
    expect(h.errors()).toContain('is not a writable directory');
  });

  it('a failed backup refuses with 74 and leaves the migrations pending (ts-013)', async () => {
    const h = harness();
    openDatabase(h.dbPath).close();
    mkdirSync(backupsDirFor(h.dbPath));
    chmodSync(backupsDirFor(h.dbPath), 0o777); // WP3 refuses a world-writable backups directory
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.backupFailed);
    expect(h.errors()).toContain('backup failed, refusing to migrate');
    expect(
      count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'"),
    ).toEqual({ n: 0 });
  });

  it('a buildPorts failure returns 1 with no lock taken', async () => {
    const h = harness();
    expect(await runTool('record', DRY, { ...h.opts, migrationsDir: join(tempDir(), 'missing') })).toBe(
      EXIT.failed,
    );
    expect(h.errors()).toContain('tool failed while opening the database');
    expect(count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'app_lock'")).toEqual({
      n: 0,
    });
  });
});

describe('runTool success paths', () => {
  it('backs up before migrating: the copy has the pre-migration schema, the database is migrated after (ts-013)', async () => {
    const h = harness();
    openDatabase(h.dbPath).close();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain('backup before 1 migration(s)');
    const [backup] = readdirSync(backupsDirFor(h.dbPath));
    if (backup === undefined) throw new Error('no backup');
    expect(
      count(
        join(backupsDirFor(h.dbPath), backup),
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'app_lock'",
      ),
    ).toEqual({ n: 0 });
    expect(count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'app_lock'")).toEqual({
      n: 1,
    });
  });

  it('dry run: seeds airports, takes the tool lock, prints the plan and budget position, issues no request, creates no execution, releases', async () => {
    const h = harness();
    const seen = stubVendors();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    const text = h.text();
    expect(text).toMatch(/airports seeded: \d+ rows/);
    expect(text).toContain('tool lock acquired');
    expect(text).toContain('metro from the airports table: LON');
    expect(text).toContain(
      'total: SearchApi 6 calls, ≤5 credits (4 expected); Travelpayouts 21 free calls, ≤61',
    );
    expect(text).toContain(`recording into: ${h.root}`);
    expect(text).toContain(
      'SearchApi window: 0 of 100 used (compare with the dashboard); room 100, this run ≤5',
    );
    expect(text).toContain('Travelpayouts per-run cap (EXECUTION_MAX_FREE_CALLS): 2000');
    expect(text).toContain(
      'SearchApi credits already ledgered to tool runs in this budget window: 0; this run ≤5; --budget 5',
    );
    expect(text).toContain('tool lock released');
    expect(`${text}${h.errors()}`).not.toContain(SENTINEL_SA);
    expect(seen.requests).toEqual([]);
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM provider_requests')).toEqual({ n: 0 });
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM search_executions')).toEqual({ n: 0 });
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM app_lock')).toEqual({ n: 0 });
  });

  it('dry run refuses a plan that does not fit EXECUTION_MAX_FREE_CALLS (ruling 13)', async () => {
    const h = harness(undefined, { EXECUTION_MAX_FREE_CALLS: '57' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.badConfig);
    expect(h.errors()).toContain(
      'the plan needs up to 61 Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is 57',
    );
  });

  it('takes over a stale app lock', async () => {
    const h = harness();
    holdLock(h.dbPath, 'stale');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
  });

  it('a live run through runTool records into the given root under the test signature; a second run needs --confirm-rerun (ts-014, ruling 3, prov-wp04b-006)', async () => {
    const h = harness();
    stubVendors();
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain('required calls: all as expected');
    expect(h.text()).toContain('ledger: SearchApi 4 credit(s) of budget 5; Travelpayouts 21 free call(s)');
    expect(filesUnder(h.root).filter((f) => f.endsWith('.json') && !f.endsWith('.raw.json'))).toHaveLength(
      29,
    ); // 27 recordings + 2 allowlists
    for (const f of loadRecorded(h.root, 'searchapi', '/api/v1/search'))
      expect(f.recordedBy).toBe(TEST_RECORDED_BY);
    const again = harness(h.dbPath);
    expect(await runTool('record', ROUTE, again.opts)).toBe(EXIT.spendRefused);
    expect(again.errors()).toContain('credits already ledgered to earlier tool runs');
    expect(again.text()).toContain('(a live run needs --confirm-rerun)');
    const confirmed = harness(h.dbPath);
    expect(await runTool('record', [...ROUTE, '--confirm-rerun'], confirmed.opts)).toBe(EXIT.ok);
  });

  it('a live run refuses with 65, before any request, when the SearchApi window has less room than the worst case (cost-wp4b-r2-001)', async () => {
    const h = harness(undefined, { SEARCHAPI_TRIAL_USED: '97' });
    const seen = stubVendors();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain(
      'a live run would be refused: the SearchApi window has room for 3 credit(s) but this run may use 5',
    );
    expect(await runTool('record', [...ROUTE, '--confirm-rerun'], h.opts)).toBe(EXIT.spendRefused);
    expect(h.errors()).toContain('the SearchApi window has room for 3 credit(s)');
    expect(seen.requests).toEqual([]);
  });

  it('a recording that fails closed exits 1 and still prints the calls, the session and the ledger line (r2-ts-004)', async () => {
    const h = harness();
    stubVendors({ echo: 'calendar-parameters' });
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.failed);
    expect(h.errors()).toContain('record:fixtures failed');
    expect(h.text()).toMatch(/session: \S+/);
    expect(h.text()).toContain('ledger: SearchApi 1 credit(s) of budget 5; Travelpayouts 21 free call(s)'); // the refused 200 was billed
    expect(`${h.text()}${h.errors()}`).not.toContain(SENTINEL_SA);
  });
});

describe('where a record run may write (sec2-002 ruling)', () => {
  function bare(extra: Record<string, string> = {}) {
    const h = harness(undefined, extra);
    const { recording: _ignored, ...opts } = h.opts;
    return { ...h, opts };
  }

  it('the committed tree takes only the worked example: another route without --out refuses with 64 before anything is opened', async () => {
    const h = bare();
    expect(
      await runTool(
        'record',
        ['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-03', '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.usage);
    expect(h.errors()).toContain(
      'the committed recorded tree holds only the worked example (--route LHR,LGW:JFK,EWR)',
    );
    expect(existsSync(h.dbPath)).toBe(false);
  });

  it('--out inside the repository refuses with 64', async () => {
    const h = bare();
    const inside = join(repositoryRoot(), 'tmp-recordings');
    expect(
      await runTool(
        'record',
        ['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-03', '--out', inside, '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.usage);
    expect(h.errors()).toContain('is inside the repository');
    expect(existsSync(inside)).toBe(false);
  });

  it('--out outside the repository records any route into <out>/fixtures/recorded', async () => {
    const h = bare();
    const out = join(tempDir(), 'mine');
    expect(
      await runTool(
        'record',
        ['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-03', '--out', out, '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.ok);
    expect(h.text()).toContain(`recording into: ${join(out, 'fixtures', 'recorded')}`);
  });

  it('the worked example without --out writes the committed tree (the dry run names it; nothing is written)', async () => {
    const h = bare();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain(`recording into: ${defaultRecordedRoot()}`);
  });

  it('isEntryPoint compares the unresolved path when realpath fails (arch-r2-006)', () => {
    const missing = join(tempDir(), 'gone.ts');
    expect(isEntryPoint(missing, pathToFileURL(missing).href)).toBe(true);
    expect(isEntryPoint(undefined, pathToFileURL(missing).href)).toBe(false);
  });
});

describe('runTool releases the lock on every exit path (ts-003)', () => {
  function lockRow(dbPath: string): unknown {
    return count(dbPath, 'SELECT COUNT(*) AS n FROM app_lock');
  }

  it('a throwing tool returns 1 with a scrubbed message, and the lock is released', async () => {
    const h = harness();
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async () => {
          throw new Error(`boom with ${SENTINEL_TP} at https://x.example/p?token=abc`);
        },
      },
    });
    expect(code).toBe(EXIT.failed);
    expect(h.errors()).toContain('tool failed: boom with [redacted] at https://x.example/p');
    expect(h.errors()).not.toContain(SENTINEL_TP);
    expect(lockRow(h.dbPath)).toEqual({ n: 0 });
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    '%s aborts the tool, the lock is released and the listeners removed',
    async (sig) => {
      const h = harness();
      const before = process.listenerCount(sig);
      const code = await runTool('record', DRY, {
        ...h.opts,
        runners: {
          record: async (_ports, _cli, ctx) => {
            expect(process.listenerCount(sig)).toBe(before + 1);
            process.emit(sig);
            return ctx.signal.aborted ? 42 : 0;
          },
        },
      });
      expect(code).toBe(42);
      expect(process.listenerCount(sig)).toBe(before);
      expect(lockRow(h.dbPath)).toEqual({ n: 0 });
    },
  );

  it('a second SIGINT only aborts again: the handler stays until the lock is released (r2-ts-005 e)', async () => {
    const h = harness();
    const before = process.listenerCount('SIGINT');
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async (_ports, _cli, ctx) => {
          process.emit('SIGINT');
          process.emit('SIGINT');
          return process.listenerCount('SIGINT') === before + 1 && ctx.signal.aborted ? 42 : 0;
        },
      },
    });
    expect(code).toBe(42);
    expect(process.listenerCount('SIGINT')).toBe(before);
    expect(lockRow(h.dbPath)).toEqual({ n: 0 });
  });

  it('heartbeats every HEARTBEAT_INTERVAL_MS while the tool runs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = harness();
    const clock = fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    const code = await runTool('record', DRY, {
      ...h.opts,
      clock,
      runners: {
        record: async (ports) => {
          clock.advance(HEARTBEAT_INTERVAL_MS);
          vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
          return AppLock.inspect(ports.db)?.heartbeatAt === '2026-10-20T09:00:30.000Z' ? 0 : 9;
        },
      },
    });
    expect(code).toBe(EXIT.ok);
  });

  it('a lost lock aborts the tool and returns 75 instead of crashing in the timer (arch-014)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = harness();
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async (ports, _cli, ctx) => {
          ports.db.raw
            .prepare("UPDATE app_lock SET holder = 'app', acquired_at = '2000-01-01T00:00:00.000Z'")
            .run();
          vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
          return ctx.signal.aborted ? EXIT.ok : 9;
        },
      },
    });
    expect(code).toBe(EXIT.lockRefused);
    expect(h.errors()).toContain('app_lock lost');
    expect(count(h.dbPath, 'SELECT holder FROM app_lock')).toEqual({ holder: 'app' }); // never deletes another holder's lock
  });

  it('a tool that throws after the lock was lost returns 75 (r2-ts-005 d)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = harness();
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async (ports) => {
          ports.db.raw
            .prepare("UPDATE app_lock SET holder = 'app', acquired_at = '2000-01-01T00:00:00.000Z'")
            .run();
          vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
          throw new Error('the tool noticed the abort and gave up');
        },
      },
    });
    expect(code).toBe(EXIT.lockRefused);
    expect(h.errors()).toContain('tool failed: the tool noticed the abort and gave up');
  });
});

describe('runRecord through runTool: failed and partial runs (r2-ts-004)', () => {
  it('a run with required calls not as planned exits 1 and reports them without attributing skipped calls to the vendor', async () => {
    const h = harness();
    stubVendors({ calendar: 'no-priced-cell' });
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.failed);
    const text = h.text();
    expect(text).toContain('required calls: NOT all as expected: SA-03, SA-04, SA-05, SA-06');
    expect(text).toContain('chain step 1 → 2 → 3: incomplete');
    expect(text).toContain(
      'over-limit calendar (SA-03): no vendor answer recorded: SA-03 skipped (skipped: calendar SA-02 gave no usable cell; the run must be repeated)',
    );
    expect(text).not.toContain('raise a finding for WP5');
    expect(text).toContain('ledger: SearchApi 1 credit(s) of budget 5; Travelpayouts 21 free call(s)');
  });

  it('a 5xx retried into a 200 prints the deletable non-final attempt file (prov-wp04b-r2-005, prov-wp04b-r3-005)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    let failed = false;
    stubVendors({
      failOn: (u) => {
        if (failed || u.searchParams.get('engine') !== 'google_flights_calendar') return undefined;
        failed = true;
        return 'http-500';
      },
    });
    const run = runTool('record', ROUTE, h.opts);
    let done = false;
    run.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    while (!done) await vi.advanceTimersByTimeAsync(500);
    expect(await run).toBe(EXIT.ok);
    const line = h.out.find((l) =>
      l.startsWith('SA-02: non-final attempt file(s), unbilled, delete before commit (Task 12b step 4): '),
    );
    expect(line).toBeDefined();
    const path = line?.split(': ').at(-1) ?? '';
    expect(JSON.parse(readFileSync(path, 'utf8')).status).toBe(500);
  });

  it('SIGINT during the calendar aborts the run: exit 1, the execution cancelled, the ledger line printed', async () => {
    const h = harness();
    stubVendors({
      onRequest: (u) => {
        if (u.searchParams.get('engine') === 'google_flights_calendar') process.emit('SIGINT');
      },
    });
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.failed);
    expect(h.text()).toContain('SA-02 aborted');
    expect(h.text()).toMatch(/ledger: SearchApi \d credit\(s\) of budget 5/);
    expect(count(h.dbPath, 'SELECT status, error_text AS e FROM search_executions')).toEqual({
      status: 'cancelled',
      e: 'aborted',
    });
  });

  it('--out records live into a fresh directory outside the repository, creating <out>/fixtures/recorded first (prov-wp04b-r3-003)', async () => {
    const h = harness();
    const { recording: _ignored, ...opts } = h.opts;
    const out = join(tempDir(), 'fresh', 'mine');
    stubVendors();
    expect(await runTool('record', [...ROUTE, '--out', out], opts)).toBe(EXIT.ok);
    const root = join(out, 'fixtures', 'recorded');
    expect(loadRecorded(root, 'searchapi', '/api/v1/search').map((f) => f.recordedBy)).toEqual(
      Array(6).fill(RECORDED_BY),
    );
    expect(count(h.dbPath, 'SELECT status FROM search_executions')).toEqual({ status: 'completed' });
  });
});

describe('recordingTarget (sec2-002 ruling, r3-ts-004)', () => {
  const cli = (argv: string[]) => {
    const r = parseRecordArgs(['--budget', '5', '--month', '2027-03', ...argv]);
    if (!r.ok) throw new Error(r.message);
    return r.value;
  };
  const example = ['--route', 'LHR,LGW:JFK,EWR'];
  const other = ['--route', 'LHR:JFK'];

  it('a given target wins unchanged', () => {
    const given = { root: '/tmp/x/fixtures/recorded', recordedBy: TEST_RECORDED_BY };
    expect(recordingTarget(cli(other), given)).toBe(given);
  });
  it('the worked example without --out records the committed tree under RECORDED_BY', () => {
    expect(recordingTarget(cli(example), undefined)).toEqual({
      root: defaultRecordedRoot(),
      recordedBy: RECORDED_BY,
    });
  });
  it('--out outside the repository records <out>/fixtures/recorded under RECORDED_BY', () => {
    const out = join(tempDir(), 'mine');
    expect(recordingTarget(cli([...other, '--out', out]), undefined)).toEqual({
      root: join(out, 'fixtures', 'recorded'),
      recordedBy: RECORDED_BY,
    });
  });
  it.each([
    ['the repository root', () => repositoryRoot()],
    ['a relative path that resolves inside it', () => join(repositoryRoot(), 'apps', '..', 'tmp-rec')],
    [
      'a symlink pointing into it',
      () => {
        const link = join(tempDir(), 'link');
        symlinkSync(repositoryRoot(), link);
        return join(link, 'tmp-rec');
      },
    ],
  ])('--out %s is refused', (_name, out) => {
    expect(recordingTarget(cli([...other, '--out', out()]), undefined)).toEqual({
      refusal: expect.stringContaining('is inside the repository'),
    });
  });
  it.skipIf(
    !existsSync(repositoryRoot().toUpperCase()) || repositoryRoot().toUpperCase() === repositoryRoot(),
  )('--out spelled in another case on a case-insensitive file system is refused (sec minor 1)', () => {
    expect(
      recordingTarget(cli([...other, '--out', join(repositoryRoot().toUpperCase(), 'tmp-rec')]), undefined),
    ).toEqual({ refusal: expect.stringContaining('is inside the repository') });
  });
  it('from a worktree, the enclosing checkout is a repository too, and --out inside it is refused (sec minor 1)', () => {
    const outer = realpathSync(tempDir('gmt-outer-'));
    const inner = join(outer, '.worktrees', 'x');
    const recorded = join(inner, 'packages', 'providers', 'fixtures', 'recorded');
    mkdirSync(recorded, { recursive: true });
    writeFileSync(join(outer, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(inner, 'pnpm-workspace.yaml'), '');
    const roots = repositoryRoots(recorded);
    expect(roots).toEqual([inner, outer]);
    expect(recordingTarget(cli([...other, '--out', join(outer, 'tmp-rec')]), undefined, roots)).toEqual({
      refusal: expect.stringContaining('is inside the repository'),
    });
    const outside = join(tempDir(), 'mine');
    expect(recordingTarget(cli([...other, '--out', outside]), undefined, roots)).toEqual({
      root: join(outside, 'fixtures', 'recorded'),
      recordedBy: RECORDED_BY,
    });
  });
  it('another route without --out is refused', () => {
    expect(recordingTarget(cli(other), undefined)).toEqual({
      refusal: expect.stringContaining('holds only the worked example'),
    });
  });
});
```

```ts
// apps/api/test/bootstrap/preflight.test.ts
// The pre-migration preflight both bootstraps share (spec §7 Migrations; plan "Wiring and bootstraps": both call
// backupDatabase before buildPorts when migrations are pending). WP8's app bootstrap reuses this module (arch M-1).
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import {
  BACKUPS_KEPT,
  backupBeforeMigrations,
  backupsDirFor,
  dataDirRefusal,
  pendingOnExistingDb,
} from '../../src/bootstrap/preflight.js';
import { EXIT } from '../../src/tools/types.js';
import { tempDir } from '../helpers/tmp.js';

const clock = fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z'));
const bareDb = (): string => {
  const path = join(tempDir('gmt-pre-'), 'app.db');
  openDatabase(path).close(); // an existing database with every migration pending
  return path;
};

describe('bootstrap preflight (spec §7 Migrations)', () => {
  it('backups live beside the database and five are kept', () => {
    expect(backupsDirFor('/data/app.db')).toBe('/data/backups');
    expect(BACKUPS_KEPT).toBe(5);
  });

  it('a new file or :memory: has nothing pending; an existing bare database has every migration pending', () => {
    expect(pendingOnExistingDb(':memory:', MIGRATIONS_DIR)).toEqual([]);
    expect(pendingOnExistingDb(join(tempDir(), 'none.db'), MIGRATIONS_DIR)).toEqual([]);
    expect(pendingOnExistingDb(bareDb(), MIGRATIONS_DIR).length).toBeGreaterThan(0);
  });

  it('nothing pending: no backup, no line', () => {
    expect(backupBeforeMigrations(join(tempDir(), 'none.db'), MIGRATIONS_DIR, clock, [])).toEqual({
      ok: true,
      line: null,
    });
  });

  it('pending: backs up first and names the file', () => {
    const path = bareDb();
    const r = backupBeforeMigrations(path, MIGRATIONS_DIR, clock, []);
    expect(r).toMatchObject({ ok: true, line: expect.stringMatching(/^backup before \d+ migration\(s\): /) });
    expect(readdirSync(backupsDirFor(path))).toHaveLength(1);
  });

  it('refuses with 73 when the backups path is not a writable directory, and with 74 when the backup fails', () => {
    const notDir = bareDb();
    writeFileSync(backupsDirFor(notDir), 'not a directory');
    expect(backupBeforeMigrations(notDir, MIGRATIONS_DIR, clock, [])).toMatchObject({
      ok: false,
      code: EXIT.preflightImpossible,
      message: expect.stringContaining('is not a writable directory'),
    });
    const worldWritable = bareDb();
    mkdirSync(backupsDirFor(worldWritable));
    chmodSync(backupsDirFor(worldWritable), 0o777); // WP3 refuses a world-writable backups directory
    expect(backupBeforeMigrations(worldWritable, MIGRATIONS_DIR, clock, [])).toMatchObject({
      ok: false,
      code: EXIT.backupFailed,
      message: expect.stringContaining('backup failed, refusing to migrate'),
    });
  });

  it('refuses with 73 when the migration state cannot be read', () => {
    const path = join(tempDir('gmt-pre-'), 'app.db');
    const db = openDatabase(path);
    db.raw.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY)');
    db.close();
    expect(backupBeforeMigrations(path, MIGRATIONS_DIR, clock, [])).toMatchObject({
      ok: false,
      code: EXIT.preflightImpossible,
      message: expect.stringContaining('cannot read the migration state'),
    });
  });

  it.skipIf(process.getuid?.() === 0)('names an unwritable data directory; :memory: has none', () => {
    expect(dataDirRefusal(':memory:')).toBeNull();
    const dir = tempDir();
    expect(dataDirRefusal(join(dir, 'app.db'))).toBeNull();
    chmodSync(dir, 0o500);
    expect(dataDirRefusal(join(dir, 'app.db'))).toContain('is not writable');
    expect(existsSync(join(dir, 'app.db'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/tool.test.ts test/bootstrap/preflight.test.ts`
Expected: FAIL, both files with `Error: Cannot find module '../../src/bootstrap/preflight.js' imported from …` (each imports the preflight module first).

- [ ] **Step 3: Implement**

In `packages/providers/src/index.ts`, add `defaultRecordedRoot` to the `./http/recorder.js` export list (Task 6 added `assertRecordedRoot` and `withContentHash`):

```ts
export {
  assertRecordedRoot,
  canonicalJson,
  contentHash,
  createRecorder,
  defaultRecordedRoot,
  type RecordedFixture,
  RecorderRefusedError,
  withContentHash,
} from './http/recorder.js'; // canonicalJson: WP5/WP6; RecorderRefusedError, defaultRecordedRoot, withContentHash, assertRecordedRoot: WP4b
```

In `packages/providers/test/barrel.test.ts`, add `'defaultRecordedRoot'` after `'createRecorder'` in the main-barrel function list (arch-r2-007); `withContentHash` and `assertRecordedRoot` are already there since Task 6.

```ts
// apps/api/src/tools/workedExample.ts
/**
 * The public worked example's route (brief README, spec §1): the only route the committed recorded tree may hold.
 * why: the privacy rule — the operator's own route never enters the repository, so a run that would write into the
 * committed tree with any other route is refused (sec2-002). This is the one apps/api source file that names airports
 * (the WP4b definition-of-done grep excludes it), as apps/web/src/example.ts is for the web.
 */
export const WORKED_EXAMPLE_ROUTE = { origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'] } as const;

/** True only for exactly the worked example's route, in its order: `LHR,LGW:JFK,EWR`. */
export function isWorkedExampleRoute(a: {
  origins: readonly string[];
  destinations: readonly string[];
}): boolean {
  const same = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    same(a.origins, WORKED_EXAMPLE_ROUTE.origins) && same(a.destinations, WORKED_EXAMPLE_ROUTE.destinations)
  );
}

/** `LHR,LGW:JFK,EWR`, for messages. */
export const WORKED_EXAMPLE_ROUTE_ARG = `${WORKED_EXAMPLE_ROUTE.origins.join(',')}:${WORKED_EXAMPLE_ROUTE.destinations.join(',')}`;
```

The pre-migration preflight lives in its own module so WP8's app bootstrap reuses it rather than importing the tool entry (plan decision 30, arch M-1):

```ts
// apps/api/src/bootstrap/preflight.ts
/**
 * The pre-migration preflight both bootstraps share (spec §7 SQLite settings and Migrations; plan "Wiring and
 * bootstraps": both call backupDatabase before buildPorts when pendingMigrations() is non-empty). The tool bootstrap
 * uses it today and WP8's app bootstrap reuses it (arch M-1); WP12's scripts/backup.mjs uses the same directory and
 * keep count. Under bootstrap/, so the process.env rule is unchanged; nothing here reads the environment.
 */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Clock, Secret } from '@gmt/core';
import { backupDatabase, openDatabase, pendingMigrations } from '@gmt/db';
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';

/** Spec §7 Migrations: keep the last 5 backups. */
export const BACKUPS_KEPT = 5;

/** Spec §7: backups live beside the database (`/data/backups` in the container). */
export function backupsDirFor(databasePath: string): string {
  return join(dirname(databasePath), 'backups');
}

/** Why the database's directory cannot take a new file or SQLite's side files, or null (73 in the tool). */
export function dataDirRefusal(databasePath: string): string | null {
  if (databasePath === ':memory:') return null;
  try {
    accessSync(dirname(databasePath), constants.W_OK);
    return null;
  } catch {
    return `data directory ${dirname(databasePath)} is not writable; refusing (spec §7)`;
  }
}

/**
 * Pending migrations on a database file that already exists (none for a new file or :memory:). why: this opens the file
 * read-write through openDatabase (journal-mode pragma, checkpoint on close) but changes no schema; only the app_lock
 * read before it is strictly read-only (arch-r2-003).
 */
export function pendingOnExistingDb(databasePath: string, migrationsDir: string): string[] {
  if (databasePath === ':memory:' || !existsSync(databasePath)) return [];
  const db = openDatabase(databasePath);
  try {
    return pendingMigrations(db, migrationsDir);
  } finally {
    db.close();
  }
}

export type BackupOutcome =
  | { ok: true; line: string | null }
  | { ok: false; code: typeof EXIT.preflightImpossible | typeof EXIT.backupFailed; message: string };

/**
 * Backs the database up when migrations are pending (spec §7: "a failed backup refuses migrations"). 73 when the
 * migration state cannot be read or the backups path is not a writable directory; 74 when the backup itself fails.
 * Messages are scrubbed of every configured secret and URL query.
 */
export function backupBeforeMigrations(
  databasePath: string,
  migrationsDir: string,
  clock: Clock,
  secrets: readonly Secret[],
): BackupOutcome {
  let pending: string[];
  try {
    pending = pendingOnExistingDb(databasePath, migrationsDir);
  } catch (e) {
    return {
      ok: false,
      code: EXIT.preflightImpossible,
      message: `cannot read the migration state: ${safeMessage(e, secrets)}`,
    };
  }
  if (pending.length === 0) return { ok: true, line: null };
  const backupsDir = backupsDirFor(databasePath);
  if (existsSync(backupsDir)) {
    try {
      if (!statSync(backupsDir).isDirectory()) throw new Error('not a directory');
      accessSync(backupsDir, constants.W_OK);
    } catch {
      return {
        ok: false,
        code: EXIT.preflightImpossible,
        message: `${pending.length} pending migration(s) but the backups directory ${backupsDir} is not a writable directory; refusing to migrate (spec §7)`,
      };
    }
  }
  try {
    // why: backupDatabase creates the directory itself, 0o700 (arch-015)
    const { file } = backupDatabase(databasePath, backupsDir, { keep: BACKUPS_KEPT, clock });
    return { ok: true, line: `backup before ${pending.length} migration(s): ${file}` };
  } catch (e) {
    return {
      ok: false,
      code: EXIT.backupFailed,
      message: `backup failed, refusing to migrate (spec §7): ${safeMessage(e, secrets)}`,
    };
  }
}
```

```ts
// apps/api/src/bootstrap/tool.ts
/**
 * The tool bootstrap (spec §7 SQLite settings, app_lock and Migrations; §5.5; §9 item 7): the second entrypoint in
 * apps/api. It reuses the config parse and port wiring, opens the operator's configured database (the production
 * ledger), never constructs or boots the engine (no sweep, no auto-resume, no cron), and holds app_lock as 'tool' for
 * its whole run. The one process.env read is here.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Clock, type Config, type Secret, syntheticAllowed, systemClock } from '@gmt/core';
import {
  AIRPORTS_DATA_DIR,
  AppLock,
  HEARTBEAT_INTERVAL_MS,
  loadAirportsDataset,
  MIGRATIONS_DIR,
  readOnlyLockState,
  seedAirports,
} from '@gmt/db';
import { defaultRecordedRoot } from '@gmt/providers';
import { createLogger } from '../logger.js';
import { safeMessage } from '../safeMessage.js';
import { RECORDED_BY, recordPrecheck, runRecord } from '../tools/record.js';
import { parseRecordArgs, type RecordCli } from '../tools/recordPlan.js';
import { EXIT, type ToolContext, type ToolName } from '../tools/types.js';
import { isWorkedExampleRoute, WORKED_EXAMPLE_ROUTE_ARG } from '../tools/workedExample.js';
import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';
import { backupBeforeMigrations, dataDirRefusal } from './preflight.js';

export { EXIT, type ToolName } from '../tools/types.js';

/** The tool runners runTool's switch dispatches to; tests replace them (ts-003). WP13 adds `smoke`. */
export interface ToolRunners {
  record(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number>;
}
const DEFAULT_RUNNERS: ToolRunners = { record: runRecord };

/** Where recordings go and the signature they carry; always given together (prov-wp04b-006, r2-ts-001). */
export interface RecordingTarget {
  root: string;
  recordedBy: string;
}

/** Test seams; production passes none of them (the entry point below calls runTool(name, argv)). */
export interface RunToolOptions {
  env?: NodeJS.ProcessEnv;
  runners?: Partial<ToolRunners>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  logDestination?: NodeJS.WritableStream;
  clock?: Clock;
  migrationsDir?: string;
  /** Tests record into a temporary tree under a test signature; a real run never passes this. */
  recording?: RecordingTarget;
}

/**
 * Every ancestor of the recorded tree holding pnpm-workspace.yaml, nearest first, as true-case real paths. why: run from
 * a `.worktrees/` worktree, the enclosing main checkout is a repository too, and `--out` into it must be refused like
 * `--out` into the worktree (sec minor 1). `realpathSync.native` returns the on-disk case, so a differently cased
 * spelling on a case-insensitive file system (macOS APFS) cannot slip past the containment check.
 */
export function repositoryRoots(from: string = defaultRecordedRoot()): string[] {
  const roots: string[] = [];
  for (let dir = resolve(from); ; ) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) roots.push(realpathSync.native(dir));
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (roots.length === 0) throw new Error('repository root not found above the recorded tree');
  return roots;
}

/** The repository's root: the nearest ancestor of the committed recorded tree holding pnpm-workspace.yaml. */
export function repositoryRoot(): string {
  const [nearest] = repositoryRoots();
  if (nearest === undefined) throw new Error('repository root not found above the recorded tree');
  return nearest;
}

/** The true-case real path of `p`, or of its nearest existing ancestor with the rest appended (a directory not made yet). */
function realOrAncestor(p: string): string {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync.native(abs);
  const up = dirname(abs);
  return up === abs ? abs : join(realOrAncestor(up), abs.slice(up.length + 1));
}

/**
 * Where a record run writes, and under which signature (sec2-002, ruling 2026-10-15): the committed tree only for the
 * worked example's route; any other route needs `--out DIR` outside the repository, which writes DIR/fixtures/recorded.
 */
export function recordingTarget(
  cli: RecordCli,
  given: RecordingTarget | undefined,
  roots?: readonly string[],
): RecordingTarget | { refusal: string } {
  if (given !== undefined) return given;
  if (cli.out !== null) {
    const out = realOrAncestor(cli.out);
    if ((roots ?? repositoryRoots()).some((repo) => out === repo || out.startsWith(`${repo}${sep}`)))
      return {
        refusal: `--out ${cli.out} is inside the repository; recordings of other routes stay outside it`,
      };
    return { root: join(resolve(cli.out), 'fixtures', 'recorded'), recordedBy: RECORDED_BY };
  }
  if (!isWorkedExampleRoute(cli.args))
    return {
      refusal: `the committed recorded tree holds only the worked example (--route ${WORKED_EXAMPLE_ROUTE_ARG}); record any other route with --out DIR outside the repository`,
    };
  return { root: defaultRecordedRoot(), recordedBy: RECORDED_BY };
}

type Prepared =
  | {
      ok: true;
      precheck: string | null;
      target: RecordingTarget;
      run(ports: Ports, ctx: ToolContext): Promise<number>;
    }
  | { ok: false; code: number };

/** The per-tool part: argument parsing, where to record, and the configuration precheck. A switch, not a registry (arch-020). */
function prepare(
  name: ToolName,
  argv: readonly string[],
  config: Config,
  runners: ToolRunners,
  given: RecordingTarget | undefined,
  err: (l: string) => void,
): Prepared {
  switch (name) {
    case 'record': {
      const parsed = parseRecordArgs(argv);
      if (!parsed.ok) {
        err(parsed.message);
        return { ok: false, code: EXIT.usage };
      }
      const target = recordingTarget(parsed.value, given);
      if ('refusal' in target) {
        err(target.refusal);
        return { ok: false, code: EXIT.usage };
      }
      return {
        ok: true,
        precheck: recordPrecheck(config),
        target,
        run: (ports, ctx) => runners.record(ports, parsed.value, ctx),
      };
    }
    case 'smoke':
      err('smoke:live is not built yet; WP13 adds it');
      return { ok: false, code: EXIT.usage };
    default: {
      const unknown: never = name;
      err(`unknown tool ${String(unknown)}; expected record or smoke`);
      return { ok: false, code: EXIT.usage };
    }
  }
}

/**
 * Runs one tool and returns its exit code; every failure after the config parse maps to a code with a scrubbed
 * message, so nothing reaches the entry point's catch (sec2-001). Order (spec §5.5, §7, plan decision 20): config →
 * refuse NODE_ENV=test → refuse an open synthetic gate → arguments and recording target → precheck → data directory
 * writable → app_lock read-only → backup when migrations are pending → buildPorts (migrations) → app_lock('tool') →
 * seed airports → heartbeat → run → release on every path.
 */
export async function runTool(name: ToolName, argv: string[], opts: RunToolOptions = {}): Promise<number> {
  const err = opts.err ?? ((line: string) => void process.stderr.write(`${line}\n`));
  let secrets: readonly Secret[] = [];
  try {
    return await runToolSteps(name, argv, opts, err, (s) => {
      secrets = s;
    });
  } catch (e) {
    err(`tool failed: ${safeMessage(e, secrets)}`);
    return EXIT.failed;
  }
}

async function runToolSteps(
  name: ToolName,
  argv: string[],
  opts: RunToolOptions,
  err: (line: string) => void,
  knowSecrets: (s: readonly Secret[]) => void,
): Promise<number> {
  const out = opts.out ?? ((line: string) => void process.stdout.write(`${line}\n`));
  // why: the single process.env read (plan decision 9); NODE_ENV is read only through loadConfigFromEnv (sec-005)
  const env = opts.env ?? process.env;
  let config: Config;
  try {
    config = loadConfigFromEnv(env);
  } catch (e) {
    if (e instanceof InvalidConfigError) {
      err(e.message);
      return EXIT.badConfig;
    }
    throw e;
  }
  const secrets = collectSecrets(config);
  knowSecrets(secrets);
  if (config.nodeEnv === 'test') {
    err('tool bootstrap refuses NODE_ENV=test (spec §5.5)');
    return EXIT.refusedTestEnv;
  }
  if (syntheticAllowed(config)) {
    err(
      'tool bootstrap refuses while the synthetic gate is open (ALLOW_FIXTURE_PROVIDER with a .fixture.db path): recordings and the ledger never share a database with synthetic data (spec §5.5)',
    );
    // why: the plan's single exit-code table gives 70 to both refusals of synthetic data (NODE_ENV=test, open gate)
    return EXIT.refusedTestEnv;
  }
  const prepared = prepare(name, argv, config, { ...DEFAULT_RUNNERS, ...opts.runners }, opts.recording, err);
  if (!prepared.ok) return prepared.code;
  if (prepared.precheck !== null) {
    err(prepared.precheck);
    return EXIT.badConfig;
  }
  const clock = opts.clock ?? systemClock;
  const migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;

  const dataDir = dataDirRefusal(config.databasePath);
  if (dataDir !== null) {
    err(dataDir);
    return EXIT.preflightImpossible;
  }
  let held: ReturnType<typeof readOnlyLockState>;
  try {
    // why: read-only, before any backup or migration, so a live app's schema is never touched (spec §7, decision 20)
    held = readOnlyLockState(config.databasePath, clock);
  } catch (e) {
    err(`cannot read app_lock in ${config.databasePath}: ${safeMessage(e, secrets)}; refusing (spec §7)`);
    return EXIT.preflightImpossible;
  }
  if (held.state === 'fresh') {
    err(
      `app_lock is held by ${held.holder} (heartbeat ${held.heartbeatAt}); stop it, or use POST /api/tools/${name} while the app runs (spec §7)`,
    );
    return EXIT.lockRefused;
  }
  const backup = backupBeforeMigrations(config.databasePath, migrationsDir, clock, secrets);
  if (!backup.ok) {
    err(backup.message);
    return backup.code;
  }
  if (backup.line !== null) out(backup.line);

  const log = createLogger(config, {
    fd: 2,
    secrets,
    ...(opts.logDestination === undefined ? {} : { destination: opts.logDestination }),
  }).child({ tool: name });
  out(`database: ${config.databasePath}`);
  let ports: Ports;
  try {
    ports = buildPorts(config, { log, clock, migrationsDir });
  } catch (e) {
    err(`tool failed while opening the database: ${safeMessage(e, secrets)}`);
    return EXIT.failed;
  }
  try {
    const lock = new AppLock(ports.db, 'tool', ports.clock, log);
    // why: waitMs 0 — a tool never queues behind the app; the operator uses POST /api/tools/* instead (spec §7). Only a
    // process that took the lock between the read-only check and here reaches the refusal (AppLock's own tests cover it).
    if (lock.acquire({ waitMs: 0 }) === 'refused') {
      const now = AppLock.inspect(ports.db);
      err(
        `app_lock is held by ${now?.holder ?? 'another process'} (heartbeat ${now?.heartbeatAt ?? 'unknown'}); stop it, or use POST /api/tools/${name} while the app runs (spec §7)`,
      );
      return EXIT.lockRefused;
    }
    out('tool lock acquired');
    const ac = new AbortController();
    let lockLost = false;
    const beat = setInterval(() => {
      try {
        lock.heartbeat();
      } catch (e) {
        // why: a throw inside a timer would kill the process with the execution left running (arch-014, cost-wp4b-007)
        lockLost = true;
        log.error({ error: safeMessage(e, secrets) }, 'app_lock heartbeat failed; aborting the tool');
        err(`app_lock lost (${safeMessage(e, secrets)}); aborting`);
        ac.abort();
      }
    }, HEARTBEAT_INTERVAL_MS);
    beat.unref();
    // why: `on`, not `once` — a second Ctrl-C must not kill the process with the lock held and the execution running
    // (r2-ts-005 e); the handler stays until the lock is released
    const onSignal = (): void => ac.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    try {
      seedIfNeeded(ports, out);
      const code = await prepared.run(ports, {
        signal: ac.signal,
        out,
        err,
        recordedRoot: prepared.target.root,
        recordedBy: prepared.target.recordedBy,
      });
      return lockLost ? EXIT.lockRefused : code;
    } catch (e) {
      err(`tool failed: ${safeMessage(e, secrets)}`);
      return lockLost ? EXIT.lockRefused : EXIT.failed;
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

/** Spec §7: seed after migration when `airports` is empty or the dataset version changed; local files, no network. */
function seedIfNeeded(ports: Ports, out: (line: string) => void): void {
  const dataset = loadAirportsDataset(AIRPORTS_DATA_DIR);
  if (ports.repos.airports.count() > 0 && ports.repos.airports.datasetVersion() === dataset.version) return;
  const r = seedAirports(ports.db, dataset);
  out(`airports seeded: ${r.inserted} rows, dataset ${r.datasetVersion}`);
}

/**
 * True when this module is the process entry. why: argv[1] may be a symlink (pnpm's bin links), so it is resolved; if
 * resolution fails the unresolved path is compared instead of silently skipping the run (arch-r2-006).
 */
export function isEntryPoint(
  script: string | undefined = process.argv[1],
  self: string = import.meta.url,
): boolean {
  if (script === undefined) return false;
  let resolved = script;
  try {
    resolved = realpathSync(script);
  } catch {
    // why: compare the path as given; a missing or unreadable argv[1] simply never equals this module's URL
  }
  return self === pathToFileURL(resolved).href;
}

// why: run only when executed directly, so tests import runTool without side effects.
if (isEntryPoint()) {
  const [name = '', ...rest] = process.argv.slice(2);
  if (name !== 'record' && name !== 'smoke') {
    process.stderr.write(`unknown tool "${name}"; expected record or smoke\n`);
    process.exitCode = EXIT.usage;
  } else {
    runTool(name, rest).then(
      (code) => {
        process.exitCode = code;
      },
      (e: unknown) => {
        // why: unreachable by design — runTool maps every failure to an exit code with secrets scrubbed; kept so an
        // unforeseen rejection still exits non-zero, URL-stripped
        process.stderr.write(`tool failed: ${safeMessage(e, [])}\n`);
        process.exitCode = EXIT.failed;
      },
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/tool.test.ts test/bootstrap/preflight.test.ts` and `pnpm --filter @gmt/providers test`
Expected: 47 + 7 passed (the case-variant `--out` test is skipped on a case-sensitive file system; the three read-only-directory cases are reported skipped when run as root); the providers suite passes (264). If "takes over a stale app lock" fails, WP3's `AppLock` does not treat a heartbeat older than three beats as stale: a WP3 bug against spec §7, raise it.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/providers/src/index.ts packages/providers/test/barrel.test.ts && git commit -m "wp04b: tool bootstrap with read-only lock check, backup preflight, airport seeding, the tool lock and the recording-target rule"
```

### Task 9: Tool bootstrap entry, spawned; the network guards; the package script; the boundary rules

**Files:** modify `apps/api/package.json` (script), the root `package.json` (`record:fixtures`, `smoke:live`), `scripts/check-boundaries.mjs`; create `apps/api/test/support/noNetwork.mjs`, `apps/api/test/support/guards.test.ts`, `apps/api/test/bootstrap/tool.spawn.test.ts`.

**Interfaces:** consumes the real entry `src/bootstrap/tool.ts`, `takeStrays`. Produces the `tool` script the root's `record:fixtures` and `smoke:live` call.

- [ ] **Step 1: Write the failing test**

```js
// apps/api/test/support/noNetwork.mjs
// Preloaded into every spawned tool process (node --import): DNS lookups fail, so a request that should not
// happen cannot leave the machine (ts-002; the in-process tests get the same rule from WP4's network guards).
import dns from 'node:dns';

const refuse = (hostname, ...rest) => {
  const callback = rest.find((x) => typeof x === 'function');
  const error = Object.assign(new Error(`spawned tool test makes no DNS lookups (${hostname})`), {
    code: 'ENOTFOUND',
  });
  if (typeof callback === 'function') process.nextTick(() => callback(error));
};
Object.defineProperty(dns, 'lookup', { value: refuse, writable: true, configurable: true });
```

```ts
// apps/api/test/support/guards.test.ts
// The setup file's network guards are live in apps/api (r2-ts-006): an unstubbed request to a vendor host fails in
// process and is recorded as a stray (cleared here, so the guard's afterEach does not fail this test).
import { takeStrays } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';

describe('apps/api network guards (plan decision 18)', () => {
  it('an unstubbed fetch to a vendor host is refused in process and recorded as a stray', async () => {
    await expect(fetch('https://www.searchapi.io/api/v1/search?engine=google_flights')).rejects.toThrow();
    expect(takeStrays()).toEqual(['GET https://www.searchapi.io/api/v1/search']);
  });
});
```

```ts
// apps/api/test/bootstrap/tool.spawn.test.ts
// Spawns the real entry the way `pnpm record:fixtures` does (node --conditions=@gmt/source --import tsx), with an env
// built from scratch (no inherited secrets, no .env file) and DNS refused in the child.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { SENTINEL_SA, SENTINEL_TP, silentLog, toolEnv } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NO_NETWORK = fileURLToPath(new URL('../support/noNetwork.mjs', import.meta.url));
const DRY = ['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--dry-run'];
/** Node's arguments for every spawned child: workspace sources, and the DNS-refusal preload (one list, r3-ts-006). */
const NODE_ARGS = ['--conditions=@gmt/source', '--import', NO_NETWORK] as const;

function spawnTool(env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [...NODE_ARGS, '--import', 'tsx', 'src/bootstrap/tool.ts', 'record', ...DRY],
    {
      cwd: API_ROOT,
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

const freshDbPath = (): string => join(tempDir('gmt-spawn-'), 'tool.db');

function holdAppLock(dbPath: string, stale: boolean): void {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = stale
    ? fixedClock(asIsoDateTime(new Date(Date.now() - 10 * 60_000).toISOString()))
    : systemClock;
  expect(new AppLock(db, 'app', clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
}

describe('tool bootstrap as a real process (spec §5.5, §7)', () => {
  it('NODE_ENV=test → exit 70, nothing opened', () => {
    const dbPath = freshDbPath();
    const r = spawnTool(toolEnv(dbPath, { NODE_ENV: 'test' }));
    expect(r.stderr).toContain('tool bootstrap refuses NODE_ENV=test');
    expect(r.status).toBe(70);
    expect(existsSync(dbPath)).toBe(false);
  }, 60_000);

  it('a fresh app lock → exit 75, lock untouched', () => {
    const dbPath = freshDbPath();
    holdAppLock(dbPath, false);
    const r = spawnTool(toolEnv(dbPath));
    expect(r.stderr).toContain('app_lock is held by app');
    expect(r.status).toBe(75);
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)?.holder).toBe('app');
    db.close();
  }, 60_000);

  // why: a dry run makes no HTTP request, so this proves only the bootstrap's own output; http-kit's debug lines are
  // covered through the real pino logger in test/logger.test.ts (sec2-004)
  it('otherwise, at debug log level, acquires the tool lock, prints the plan and releases the lock; the bootstrap prints no credential', () => {
    const dbPath = freshDbPath();
    const r = spawnTool(toolEnv(dbPath, { LOG_LEVEL: 'debug' }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('tool lock acquired');
    expect(r.stdout).toContain('SA-06');
    expect(r.stdout).toContain('tool lock released');
    for (const s of [SENTINEL_SA, SENTINEL_TP, 'Bearer ']) expect(`${r.stdout}${r.stderr}`).not.toContain(s);
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)).toBeNull();
    db.close();
  }, 60_000);

  it('a stale app lock is taken over', () => {
    const dbPath = freshDbPath();
    holdAppLock(dbPath, true);
    expect(spawnTool(toolEnv(dbPath)).status).toBe(0);
  }, 60_000);

  it('the package script resolves workspace sources, loads the operator .env only through Node and runs this entry', () => {
    const pkg: unknown = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({
      scripts: {
        tool: 'node --conditions=@gmt/source --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts',
      },
    });
    // why: --env-file-if-exists arrived in Node 22.9; an older Node fails with "bad option" before the exit table applies
    // (arch M-10)
    const root: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(root).toMatchObject({ engines: { node: '>=22.9' } });
  });

  it("the root script passes the tool's exit code through to the operator: no --budget → 64 (plan decision 30)", () => {
    const dbPath = freshDbPath();
    // why: `pnpm --filter` collapsed every child code to 1, hiding 64/65/70/73/74/75/78 (arch I-1); the env blanks every
    // variable the tool reads, so a developer's .env (loaded by --env-file-if-exists, existing variables win) adds nothing
    const r = spawnSync(
      'pnpm',
      ['run', '--silent', 'record:fixtures', '--route', 'LHR:JFK', '--month', '2027-03'],
      {
        cwd: REPO_ROOT,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          NODE_OPTIONS: `--import=${NO_NETWORK}`,
          ...toolEnv(dbPath),
        },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(r.stderr).toContain('--budget is required');
    expect(r.status).toBe(64);
    expect(existsSync(dbPath)).toBe(false);
  }, 60_000);

  it('every spawned child gets the DNS-refusal preload, and under it fetch, as http-kit uses it, cannot reach a host (r2-ts-006, r3-ts-006)', () => {
    expect(NODE_ARGS).toContain(NO_NETWORK);
    const r = spawnSync(
      process.execPath,
      [
        ...NODE_ARGS,
        '--input-type=module',
        '-e',
        "fetch('https://example.invalid/').then(() => process.stdout.write('fetched'), (e) => process.stdout.write(String(e.cause?.message ?? e.message)))",
      ],
      { cwd: API_ROOT, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000 },
    );
    expect(r.stdout).toContain('spawned tool test makes no DNS lookups (example.invalid)');
  }, 30_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/tool.spawn.test.ts test/support/guards.test.ts`
Expected: 2 failed | 6 passed; the failures are the script test, `AssertionError: expected { name: '@gmt/api', …(7) } to match object { Object (scripts) }`, and the root-script test, `AssertionError: expected 1 to be 64` (`pnpm --filter` collapses the child's exit code to 1). The spawn tests pass because the entry exists since Task 8; if one fails instead, the entry-point guard does not fire under `node --import tsx`: fix `isEntryPoint` before going on. The preload test and the guard test pass on first run; they prove the two network guards are live (r2-ts-006).

- [ ] **Step 3: Implement**

In the root `package.json`, set `"record:fixtures": "pnpm -C apps/api run tool record"` and `"smoke:live": "pnpm -C apps/api run tool smoke"` (plan decision 30: `pnpm --filter` reports 1 for any non-zero child code, so the operator could not tell 65 from 75; `pnpm -C … run` passes the code through, and the cwd is still `apps/api`, so `../../.env` resolves as before), and raise `engines.node` to `">=22.9"`: the `tool` script's `--env-file-if-exists` arrived in Node 22.9 (arch M-10).

In `apps/api/package.json`, set the `tool` script (merge the key; keep main's other scripts):

```json
{
  "scripts": {
    "tool": "node --conditions=@gmt/source --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts"
  }
}
```

`// why:` (record it in the PR description; JSON has no comments) The root scripts are `"record:fixtures": "pnpm -C apps/api run tool record"` and `"smoke:live": "pnpm -C apps/api run tool smoke"`, so pnpm appends the operator's arguments after `record` and the tool's exit code is the operator's (plan decision 30). `--conditions=@gmt/source` makes Node and tsx resolve workspace packages to their sources rather than stale or missing `dist` builds (plan Task 0.1). Node loads `.env` into `process.env`, where existing variables win; `loadConfigFromEnv` is the only reader. The spawn tests call `node` directly with their own env; the one root-script test goes through `pnpm` with an env that blanks every variable the tool reads (existing variables win over `.env`) and exits at argument parsing, so no test ever takes a value from the real `.env`.

In `scripts/check-boundaries.mjs`, widen `walk`'s file filter so `.mjs` test-support files are scanned too (arch-r3-002):

```js
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(p)) yield p; // why: .mjs test-support files count too (arch-r3-002)
```

replace the `ENV_READERS` line and add the msw pattern beside it:

```js
// The only files that may read process.env: the app and tool bootstraps (wiring and logger take the env as an argument).
const ENV_READERS = ['/bootstrap/'];
// Any static, side-effect or dynamic import of msw.
const MSW_IMPORT = /(from\s+|import\s*\(\s*|import\s+)['"]msw/;
```

change the `process.env` message to `${f} reads process.env outside apps/api/src/bootstrap/`, then replace the providers-only msw rule inside the per-file loop and append the `@gmt/api` rules after the loop (before `process.exit`):

```js
// scripts/check-boundaries.mjs, inside the per-file loop (replaces the `name === '@gmt/providers'` msw rule)
    // why: plan decision 7 — @gmt/providers/testing is the only production-tree module that imports msw, in every package
    if (!(name === '@gmt/providers' && f.includes('/src/testing/')) && MSW_IMPORT.test(src)) {
      console.error(`${f} imports msw outside packages/providers/src/testing/`);
      bad++;
    }
```

```js
// scripts/check-boundaries.mjs, after the loop, before process.exit
// why: plan decision 20 — apps/api tests reach msw only through @gmt/providers/testing (its network guards), never directly
const apiPkg = JSON.parse(readFileSync('apps/api/package.json', 'utf8'));
for (const field of ['dependencies', 'devDependencies']) {
  if (Object.hasOwn(apiPkg[field] ?? {}, 'msw')) {
    console.error(`@gmt/api lists msw in ${field}; use @gmt/providers/testing`);
    bad++;
  }
}
for (const f of walk('apps/api/test')) {
  if (MSW_IMPORT.test(readFileSync(f, 'utf8'))) {
    console.error(`${f} imports msw; apps/api tests use @gmt/providers/testing`);
    bad++;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/tool.spawn.test.ts test/support/guards.test.ts` and `node scripts/check-boundaries.mjs`
Expected: 8 passed; the boundary script exits 0. Then, for each of `import { http } from 'msw/http';`, `import 'msw/node';` and `await import('msw');`, write the line to `apps/api/test/plant.ts`, run `node scripts/check-boundaries.mjs` and expect exit 1 with `apps/api/test/plant.ts imports msw; apps/api tests use @gmt/providers/testing`; delete the file. Do the same with `import 'msw/node';` in `apps/api/test/support/plant.mjs`, expecting `apps/api/test/support/plant.mjs imports msw; …`.

- [ ] **Step 5: Commit**

```bash
git add apps/api scripts/check-boundaries.mjs && git commit -m "wp04b: tool script on workspace sources, spawned-bootstrap and network-guard tests, msw and env boundary rules"
```

### Task 10: Parameter allowlist files

**Files:** create `apps/api/test/tools/allowlist.test.ts`.

**Interfaces:** consumes `loadParamsAllowlist`, `assertRequestAllowed`, `loadRecorded`, `ParamLog`, `paramRules`, `writeAllowlist`, `runRecording`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tools/allowlist.test.ts
// Spec §5.2: the dated allowlist enumerates parameter names AND values; tests assert both. Shape is the plan's
// ParamsAllowlist, hashed like a recorded fixture and loaded through WP4's own loader (arch-010).
import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate } from '@gmt/core';
import {
  assertRequestAllowed,
  loadParamsAllowlist,
  type ParamsAllowlist,
  RecorderRefusedError,
} from '@gmt/providers';
import { loadRecorded } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { ParamLog, paramRules, writeAllowlist } from '../../src/tools/recordParams.js';
import { runRecording } from '../helpers/recording.js';
import { tempDir, tempRecordedRoot } from '../helpers/tmp.js';

function load(root: string, provider: 'travelpayouts' | 'searchapi'): ParamsAllowlist {
  const names = readdirSync(join(root, provider)).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  expect(names).toEqual(['params-2026-10-20.json']);
  return loadParamsAllowlist(join(root, provider, names[0] ?? ''), root);
}

const SA_COMMON = [
  'arrival_id',
  'currency',
  'departure_id',
  'engine',
  'flight_type',
  'gl',
  'hl',
  'outbound_date',
  'return_date',
  'travel_class',
  'adults',
];

describe('parameter allowlist files (spec §5.2, plan ParamsAllowlist)', () => {
  it('the recording writes allowlists WP4 loads, with the exact names and values of brief §5.4, and every recorded request passes them', async () => {
    const { root } = await runRecording();
    const tp = load(root, 'travelpayouts');
    const sa = load(root, 'searchapi');
    expect(tp.endpoints).toEqual({
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
    });
    const fixedSa = {
      adults: ['1'],
      currency: ['GBP'],
      flight_type: ['round_trip'],
      gl: ['gb'],
      hl: ['en'],
      travel_class: ['business', 'economy', 'first_class', 'premium_economy'],
    };
    expect(sa.endpoints).toEqual({
      '/api/v1/search?engine=google_flights_calendar': {
        names: [
          ...SA_COMMON,
          'outbound_date_end',
          'outbound_date_start',
          'return_date_end',
          'return_date_start',
          'separate_tickets',
        ].sort(),
        values: {
          ...fixedSa,
          engine: ['google_flights_calendar'],
          separate_tickets: ['1'],
          arrival_id: 'any',
          departure_id: 'any',
          outbound_date: 'any',
          outbound_date_end: 'any',
          outbound_date_start: 'any',
          return_date: 'any',
          return_date_end: 'any',
          return_date_start: 'any',
        },
      },
      '/api/v1/search?engine=google_flights': {
        names: [...SA_COMMON, 'booking_token', 'departure_token', 'separate_tickets', 'sort_by'].sort(),
        values: {
          ...fixedSa,
          engine: ['google_flights'],
          separate_tickets: ['1'],
          sort_by: ['price'],
          arrival_id: 'any',
          departure_id: 'any',
          outbound_date: 'any',
          return_date: 'any',
          booking_token: 'any',
          departure_token: 'any',
        },
      },
    });
    for (const doc of [tp, sa]) {
      for (const ep of Object.values(doc.endpoints))
        for (const banned of ['api_key', 'token', 'market', 'trip_class', 'return_at', 'stops'])
          expect(ep.names).not.toContain(banned);
    }
    for (const f of loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'))
      assertRequestAllowed(tp, f.endpointPath, new URL(f.request.url));
    for (const f of loadRecorded(root, 'searchapi', '/api/v1/search'))
      assertRequestAllowed(sa, f.endpointPath, new URL(f.request.url));
  });

  it('ParamLog refuses an unlisted parameter or value before the request leaves, naming the parameter only (ts-015)', () => {
    const log = new ParamLog(paramRules());
    expect(() =>
      log.validate('google_flights', new URLSearchParams({ engine: 'google_flights', api_key: 'x' })),
    ).toThrow('parameter api_key is not in the google_flights allowlist');
    expect(() => log.validate('prices_for_dates', new URLSearchParams({ currency: 'GBP' }))).toThrow(
      'prices_for_dates: a value of currency is not allowed',
    );
    expect(() => log.validate('google_flights', new URLSearchParams({ gl: 'us' }))).toThrow(
      'google_flights: a value of gl is not allowed',
    );
    expect(() => log.validate('google_flights', new URLSearchParams({ outbound_date: '2027-3-1' }))).toThrow(
      'google_flights: outbound_date is not a iso-date',
    );
  });

  it('refuses a second allowlist for the same provider and date, and a symlink at the target (sec2-006)', () => {
    const doc: ParamsAllowlist = {
      provider: 'searchapi',
      recordedAt: asIsoDate('2026-10-20'),
      endpoints: {},
      contentSha256: '',
    };
    const { root } = tempRecordedRoot();
    writeAllowlist(root, doc);
    expect(() => writeAllowlist(root, doc)).toThrow(/EEXIST/);
    const other = tempRecordedRoot().root;
    mkdirSync(join(other, 'searchapi'));
    symlinkSync(join(tempDir(), 'elsewhere.json'), join(other, 'searchapi', 'params-2026-10-20.json'));
    expect(() => writeAllowlist(other, doc)).toThrow(/EEXIST/);
  });

  it('refuses to write outside fixtures/recorded, through a symlinked recorded root or a symlinked provider directory (sec-003)', () => {
    const doc: ParamsAllowlist = {
      provider: 'searchapi',
      recordedAt: asIsoDate('2026-10-20'),
      endpoints: {},
      contentSha256: '',
    };
    // why: the root rule is WP4's assertRecordedRoot, shared with the recorder (arch I-3)
    const elsewhere = join(tempDir(), 'elsewhere');
    mkdirSync(elsewhere);
    expect(() => writeAllowlist(elsewhere, doc)).toThrow(RecorderRefusedError);
    expect(() => writeAllowlist(elsewhere, doc)).toThrow(/must end in fixtures\/recorded/);
    expect(() => writeAllowlist(join(tempDir(), 'fixtures', 'recorded'), doc)).toThrow(/does not exist/);
    const linkedRoot = join(tempDir(), 'fixtures', 'recorded');
    mkdirSync(join(linkedRoot, '..'), { recursive: true });
    symlinkSync(tempDir(), linkedRoot);
    expect(() => writeAllowlist(linkedRoot, doc)).toThrow(/must end in fixtures\/recorded/);
    const { root } = tempRecordedRoot();
    symlinkSync(tempDir(), join(root, 'searchapi'));
    expect(() => writeAllowlist(root, doc)).toThrow(/resolves outside/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The writer exists since Task 6, so the test passes on its first run. Prove the exact-names-and-values assertion bites with a mutation that lets the run finish (r2-ts-009): change `travel_class: { oneOf: SEARCHAPI_TRAVEL_CLASSES }` in `paramRules` to `travel_class: { fixed: SEARCHAPI_TRAVEL_CLASSES }` and run `pnpm --filter @gmt/api exec vitest run test/tools/allowlist.test.ts`.
Expected: FAIL, 1 failed | 3 passed; the first test fails with `AssertionError: expected { …(2) } to deeply equal { …(2) }` (the allowlist now lists only `economy`). Revert the change.

- [ ] **Step 3: Implement** — no production change; the test is the deliverable.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/allowlist.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp04b: allowlists load through WP4, list exactly the sent names and values, refuse symlinks and same-date overwrites"
```

### Task 11: Sentinel secret scan and the raw-body ignore rule

**Files:** create `apps/api/test/security/sentinel.test.ts`.

**Interfaces:** consumes `scripts/secret-scan.mjs`, `runRecording`, `git check-ignore`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/security/sentinel.test.ts
// Spec §5.3: "the sentinel-key test … asserts none appears in any … fixture file"; CI runs the same scan over
// fixtures/. The WP0 scan runs with the sentinels in its environment over (a) a tree just recorded through the real
// recorder with sentinel keys, (b) that tree with a planted sentinel, (c) the committed tree — which proves only the
// shape rules there, since CI has no real keys; the real-value scan is the operator gate of Task 12b (sec-004).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SENTINEL_AUTH, SENTINEL_SA, SENTINEL_SMTP, SENTINEL_TP } from '../helpers/env.js';
import { runRecording } from '../helpers/recording.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN = join(REPO, 'scripts', 'secret-scan.mjs');
const SENTINEL_ENV = {
  PATH: process.env.PATH ?? '',
  SEARCHAPI_KEY: SENTINEL_SA,
  TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
  SMTP_PASS: SENTINEL_SMTP,
  APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
};

function scan(cwd: string) {
  return spawnSync(process.execPath, [SCAN], { cwd, env: SENTINEL_ENV, encoding: 'utf8', timeout: 30_000 });
}

describe('no key reaches any recorded file (spec §5.3 sentinel test)', () => {
  it('a tree recorded with sentinel keys, raw bodies included, is clean; planting a sentinel makes the scan fail without printing it', async () => {
    const run = await runRecording();
    const clean = scan(run.repo);
    expect(clean.stdout).toContain('secret scan: clean');
    expect(clean.status).toBe(0);
    const plantDir = join(run.root, 'planted');
    mkdirSync(plantDir, { recursive: true });
    writeFileSync(join(plantDir, 'p.json'), JSON.stringify({ leaked: SENTINEL_SA }));
    const dirty = scan(run.repo);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('secret value found');
    expect(dirty.stderr).not.toContain(SENTINEL_SA);
  });

  it('the committed fixture tree passes the shape rules (the real-value scan is the operator gate in Task 12b)', () => {
    const r = scan(REPO);
    expect(r.stdout).toContain('secret scan: clean');
    expect(r.status).toBe(0);
  });

  it('raw bodies are ignored by git and redacted files are not', () => {
    const base = 'packages/providers/fixtures/recorded/searchapi/_api_v1_search/2026-10-20-0123456789ab';
    const ignored = (p: string) => spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO }).status;
    expect(ignored(`${base}.raw.json`)).toBe(0);
    expect(ignored(`${base}.json`)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The scan script and the ignore rule exist, so the test passes on its first run. Prove the plant branch is not vacuous by breaking the scan, not the test: change `const roots = ['packages/providers/fixtures'];` in `scripts/secret-scan.mjs` to `const roots = ['packages/providers/fixtures-missing'];` and run `pnpm --filter @gmt/api exec vitest run test/security/sentinel.test.ts`.
Expected: FAIL, 1 failed | 2 passed, with `AssertionError: expected +0 to be 1 // Object.is equality` (the planted sentinel is not found). Revert the change.

- [ ] **Step 3: Implement** — no production change.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/security/sentinel.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp04b: sentinel secret scan over recorded trees and the raw-body ignore rule"
```

### Task 12a: The committed-tree check, proven offline

**Files:** create `apps/api/test/helpers/workedExampleTree.ts`, `apps/api/test/recorded/workedExampleTree.test.ts`, `apps/api/test/recorded/manifest.test.ts`.

**Interfaces:** consumes `verifyRecordedTree`, `loadRecorded`, `withContentHash`, `loadParamsAllowlist`, `assertRequestAllowed`, `defaultRecordedRoot`, `STANDIN_MARKER`, `runRecording`. Produces `checkWorkedExampleTree(root, { recordedBy, standInsAllowed, secrets? }): string[]`, the gate the live run must turn green.

The check is a function of a root (r2-ts-002): proven green on a tree recorded from the stand-ins, and red on broken copies of it (a second session, a step-2 placeholder missing from step 1's body, an out-of-band step-1 cell, a body URL on a foreign host) and on the stand-ins signed as the real tool. Further negatives cover each remaining predicate: a `www.google.com` booking parameter holding an opaque value (the good tree's booking URL carries a recorder placeholder, so the accept branch runs too), a body URL with userinfo, a `search_metadata` URL with a query, a request with `stops`, and a second allowlist file; the stand-in tripwire is shown to match only its marker, never prose such as 'Outstanding legroom' (r3-ts-002, r3-ts-003). It lives in apps/api's test helpers because it names the worked example's airports, which `packages/providers/src` may not. The committed tree is one thin test calling it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/recorded/workedExampleTree.test.ts
// Every predicate of the committed-tree check passes on a known-good tree recorded from the stand-ins and fails on a
// broken copy (r2-ts-002), before it ever meets the live recording; the stand-in tripwire catches a test tree
// signed as a real one (prov-wp04b-006).
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecordedFixture } from '@gmt/providers';
import { loadRecorded, withContentHash } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { RECORDED_BY } from '../../src/tools/record.js';
import { runRecording, TEST_RECORDED_BY } from '../helpers/recording.js';
import { filesUnder } from '../helpers/tmp.js';
import { STANDIN_MARKER } from '../helpers/vendors.js';
import { checkWorkedExampleTree, holdsStandInMarker } from '../helpers/workedExampleTree.js';

const OK = { recordedBy: TEST_RECORDED_BY, standInsAllowed: true };
const q = (f: RecordedFixture, k: string): string | null => new URL(f.request.url).searchParams.get(k);

/** Rewrites one recording through `mutate`, re-hashed and renamed so only the predicate under test can object. */
function rewrite(
  root: string,
  pick: (f: RecordedFixture) => boolean,
  mutate: (json: Record<string, unknown>) => void,
): void {
  const path = filesUnder(root).find((p) => {
    if (!p.endsWith('.json') || p.endsWith('.raw.json') || p.includes('params-')) return false;
    const f = [
      ...loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'),
      ...loadRecorded(root, 'searchapi', '/api/v1/search'),
    ].find((x) => p.endsWith(`${x.recordedAt.slice(0, 10)}-${x.contentSha256.slice(0, 12)}.json`));
    return f !== undefined && pick(f);
  });
  if (path === undefined) throw new Error('no recording matched');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('not an object');
  const json = Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== 'contentSha256'));
  mutate(json);
  const hashed = withContentHash(json);
  const recordedAt = typeof json.recordedAt === 'string' ? json.recordedAt : '';
  const next = join(dirname(path), `${recordedAt.slice(0, 10)}-${hashed.contentSha256.slice(0, 12)}.json`);
  writeFileSync(path, `${JSON.stringify(hashed, null, 2)}\n`);
  renameSync(path, next);
}

describe('checkWorkedExampleTree (the committed-tree manifest)', () => {
  it('accepts a known-good tree recorded from the stand-ins', async () => {
    const { root } = await runRecording();
    expect(checkWorkedExampleTree(root, OK)).toEqual([]);
  });

  it('rejects the stand-ins under the real signature: the signature check and the stand-in tripwire both fire (prov-wp04b-006)', async () => {
    const { root } = await runRecording();
    const problems = checkWorkedExampleTree(root, { recordedBy: RECORDED_BY, standInsAllowed: false });
    expect(problems).toContain(`recordedBy ${TEST_RECORDED_BY} on a searchapi file`);
    expect(problems).toContain(
      "a searchapi file holds the test stand-ins' marker: stand-in data in the committed tree",
    );
  });

  it('rejects a second recording session', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => f.providerId === 'travelpayouts' && f.status === 200,
      (j) => {
        j.session = '20000101T000000000Z-000000';
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain('2 recording sessions, expected one');
  });

  it("rejects a step-2 placeholder missing from step 1's body", async () => {
    const { root } = await runRecording();
    const step1 = (f: RecordedFixture): boolean =>
      q(f, 'engine') === 'google_flights' &&
      f.status === 200 &&
      q(f, 'departure_token') === null &&
      q(f, 'booking_token') === null;
    rewrite(root, step1, (j) => {
      j.body = {};
    });
    expect(checkWorkedExampleTree(root, OK)).toContain(
      "searchapi: step 2's departure_token is not in step 1's body",
    );
  });

  it('rejects a step-1 cell outside the 10–21-night band', async () => {
    const { root } = await runRecording();
    const step1 = (f: RecordedFixture): boolean =>
      q(f, 'engine') === 'google_flights' &&
      f.status === 200 &&
      q(f, 'departure_token') === null &&
      q(f, 'booking_token') === null;
    rewrite(root, step1, (j) => {
      const request = j.request;
      if (
        typeof request !== 'object' ||
        request === null ||
        !('url' in request) ||
        typeof request.url !== 'string'
      )
        throw new Error('request');
      const url = new URL(request.url);
      url.searchParams.set('return_date', '2027-03-29');
      j.request = { ...request, url: url.href };
    });
    expect(checkWorkedExampleTree(root, OK)).toContain('searchapi: step 1 is 27 nights, outside 10–21');
  });

  it('rejects a body URL on a host outside the link allowlist', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'booking_token') !== null && f.status === 200,
      (j) => {
        j.body = {
          booking_options: [
            {
              book_with: 'OTA',
              price: 573,
              booking_request: { url: 'https://evil.example/book', post_data: 'u=ota' },
            },
          ],
        };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain('body URL host evil.example under url');
  });

  it('the stand-in tripwire matches only the marker, never ordinary prose (r3-ts-002)', () => {
    for (const prose of ['Outstanding legroom', 'Standing room only', 'STANDIN', 'standin', 'understanding'])
      expect(holdsStandInMarker(prose), prose).toBe(false);
    expect(holdsStandInMarker(`id ${STANDIN_MARKER}-cal-1`)).toBe(true);
  });

  it.each([
    [
      'a www.google.com booking parameter holding an opaque value',
      (j: Record<string, unknown>) => {
        j.body = {
          booking_options: [
            {
              book_with: 'OTA',
              price: 573,
              booking_request: {
                url: 'https://www.google.com/travel/clk/f?tfs=CBwQAhooEgoyMDI3LTAzLTAyagcIARID',
                post_data: 'u=ota',
              },
            },
          ],
        };
      },
      'www.google.com URL parameter tfs under url holds an opaque value',
    ],
    [
      'a body URL with userinfo',
      (j: Record<string, unknown>) => {
        j.body = {
          booking_options: [
            {
              book_with: 'OTA',
              price: 573,
              booking_request: { url: 'https://me:pw@www.google.com/travel/clk/f', post_data: 'u=ota' },
            },
          ],
        };
      },
      'body URL with userinfo under url',
    ],
    [
      'a search_metadata URL with a query',
      (j: Record<string, unknown>) => {
        j.body = {
          ...asObject(j.body),
          search_metadata: { request_url: 'https://www.searchapi.io/api/v1/search?engine=google_flights' },
        };
      },
      'search_metadata URL with a query under request_url',
    ],
  ] as const)('rejects %s (r3-ts-003)', async (_name, mutate, problem) => {
    const { root } = await runRecording();
    rewrite(root, (f) => q(f, 'booking_token') !== null && f.status === 200, mutate);
    expect(checkWorkedExampleTree(root, OK)).toContain(problem);
  });

  it('accepts a www.google.com booking parameter that carries a recorder placeholder (r3-ts-003)', async () => {
    const { root } = await runRecording();
    const step3 = loadRecorded(root, 'searchapi', '/api/v1/search').find(
      (f) => q(f, 'booking_token') !== null && f.status === 200,
    );
    expect(JSON.stringify(step3?.body)).toContain('booking_token=%3Cbooking_token');
    expect(checkWorkedExampleTree(root, OK)).toEqual([]);
  });

  it('rejects a request with a stops parameter (r3-ts-003)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'engine') === 'google_flights_calendar' && f.status === 200,
      (j) => {
        const request = asObject(j.request);
        const url = new URL(String(request.url));
        url.searchParams.set('stops', '0');
        j.request = { ...request, url: url.href };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'searchapi: a stops parameter was sent (plan decision 24)',
    );
  });

  it('rejects a calendar request without separate_tickets=1 (plan decision 29: both engines)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'engine') === 'google_flights_calendar' && f.status === 200,
      (j) => {
        const request = asObject(j.request);
        const url = new URL(String(request.url));
        url.searchParams.delete('separate_tickets');
        j.request = { ...request, url: url.href };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'searchapi: a request without separate_tickets=1 (plan decisions 24 and 29: both engines)',
    );
  });

  it('rejects a tree without the reverse tile JFK→LON (plan decision 31)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'origin') === 'JFK' && f.status === 200,
      (j) => {
        const request = asObject(j.request);
        const url = new URL(String(request.url));
        url.searchParams.set('departure_at', '2027-04');
        j.request = { ...request, url: url.href };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'travelpayouts: no reverse tile JFK→LON 2027-03 (plan decision 31)',
    );
  });

  it('rejects a second allowlist file for a provider (r3-ts-003)', async () => {
    const { root } = await runRecording();
    copyFileSync(
      join(root, 'searchapi', 'params-2026-10-20.json'),
      join(root, 'searchapi', 'params-2026-10-21.json'),
    );
    expect(checkWorkedExampleTree(root, OK)).toContain('searchapi: 2 allowlist files, expected 1');
  });
});

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
  return Object.fromEntries(Object.entries(v));
}
```

```ts
// apps/api/test/recorded/manifest.test.ts
// The committed recorded tree for the worked example (brief WP4b section 7): what WP5, WP6 and WP13 replay.
// Red until the operator's live run (WP4b Task 12b) commits the tree.
import { defaultRecordedRoot } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { RECORDED_BY } from '../../src/tools/record.js';
import { checkWorkedExampleTree } from '../helpers/workedExampleTree.js';

describe('committed recorded tree for the worked example', () => {
  it('is one live recording session of the worked example, under the record tool signature, with no stand-in data', () => {
    expect(
      checkWorkedExampleTree(defaultRecordedRoot(), { recordedBy: RECORDED_BY, standInsAllowed: false }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/recorded`
Expected: FAIL, both files with `Error: Cannot find module '../helpers/workedExampleTree.js' imported from …/apps/api/test/recorded/manifest.test.ts` (and the same for `workedExampleTree.test.ts`).

- [ ] **Step 3: Implement**

```ts
// apps/api/test/helpers/workedExampleTree.ts
// The committed-tree manifest as a function of a root (r2-ts-002), so every predicate is proven against a known-good
// tree recorded from the stand-ins, and against broken copies, before it ever meets the live recording.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Secret } from '@gmt/core';
import { assertRequestAllowed, loadParamsAllowlist, type RecordedFixture } from '@gmt/providers';
import { loadRecorded, verifyRecordedTree } from '@gmt/providers/testing';
import { STANDIN_MARKER } from './vendors.js';

const q = (f: RecordedFixture, k: string): string | null => new URL(f.request.url).searchParams.get(k);
const nights = (f: RecordedFixture): number =>
  (Date.parse(`${q(f, 'return_date')}T00:00:00Z`) - Date.parse(`${q(f, 'outbound_date')}T00:00:00Z`)) /
  86_400_000;

/** Every string inside a JSON value, with the key it sits under. */
function strings(v: unknown, key = ''): Array<{ key: string; value: string }> {
  if (typeof v === 'string') return [{ key, value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x, key));
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => strings(x, k));
  return [];
}

/** True when text carries the test stand-ins' marker; case-sensitive, so ordinary prose never matches (r3-ts-002). */
export function holdsStandInMarker(text: string): boolean {
  return text.includes(STANDIN_MARKER);
}

/** A query value that looks like an opaque token rather than a placeholder or a short code (sec2-005). */
const OPAQUE = /^[A-Za-z0-9_-]{24,}$/;

/**
 * Every way `root` differs from the worked example's recorded tree (brief WP4b section 7); empty = conforming.
 * `recordedBy` is the one signature every file must carry; `standInsAllowed` is true only for trees recorded from the
 * test stand-ins, whose identifiers carry STANDIN_MARKER (the committed tree must never hold one).
 */
export function checkWorkedExampleTree(
  root: string,
  opts: { recordedBy: string; standInsAllowed: boolean; secrets?: readonly Secret[] },
): string[] {
  const problems: string[] = [];
  const fail = (p: string): void => {
    problems.push(p);
  };
  for (const p of verifyRecordedTree(root, opts.secrets ?? [])) fail(`verifier: ${p}`);
  const tp = loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates');
  const sa = loadRecorded(root, 'searchapi', '/api/v1/search');
  const all = [...tp, ...sa];

  // signature, session, stand-in tripwire
  if (tp.length < 21) fail(`travelpayouts: ${tp.length} recordings, expected at least 21`);
  if (sa.length !== 6) fail(`searchapi: ${sa.length} recordings, expected 6`);
  for (const f of all)
    if (f.recordedBy !== opts.recordedBy) fail(`recordedBy ${f.recordedBy} on a ${f.providerId} file`);
  const sessions = new Set(all.map((f) => f.session));
  if (sessions.size > 1) fail(`${sessions.size} recording sessions, expected one`);
  for (const f of all)
    for (const p of Object.keys(f.placeholders))
      if (!p.endsWith(`@${f.session}>`)) fail(`placeholder ${p} not scoped to its session`);
  if (!opts.standInsAllowed)
    for (const f of all)
      if (holdsStandInMarker(JSON.stringify([f.request, f.body])))
        fail(`a ${f.providerId} file holds the test stand-ins' marker: stand-in data in the committed tree`);

  // replay distinctness (plan decision 20)
  const statuses = new Map<string, Set<number>>();
  for (const f of all) {
    const k = `${f.request.method} ${f.request.url}`;
    statuses.set(k, (statuses.get(k) ?? new Set<number>()).add(f.status));
  }
  for (const [k, s] of statuses)
    if (s.size > 1) fail(`one request recorded with statuses ${[...s].join(', ')}: ${k}`);

  // Travelpayouts
  const metro = new Set(
    tp
      .filter((f) => f.status === 200 && q(f, 'origin') === 'LON' && q(f, 'page') === '1')
      .map((f) => `${q(f, 'destination')}|${q(f, 'departure_at')}`),
  );
  for (const d of ['JFK', 'EWR'])
    for (const m of ['2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'])
      if (!metro.has(`${d}|${m}`)) fail(`travelpayouts: no metro tile LON→${d} ${m}`);
  for (const o of ['LHR', 'LGW'])
    for (const d of ['JFK', 'EWR'])
      if (!tp.some((f) => f.status === 200 && q(f, 'origin') === o && q(f, 'destination') === d))
        fail(`travelpayouts: no airport tile ${o}→${d}`);
  // why: plan decision 31 — the reverse tile JFK→LON for the worked month (TP-21), for WP6's local-month check
  if (
    !tp.some(
      (f) =>
        f.status === 200 &&
        q(f, 'origin') === 'JFK' &&
        q(f, 'destination') === 'LON' &&
        q(f, 'departure_at') === '2027-03',
    )
  )
    fail('travelpayouts: no reverse tile JFK→LON 2027-03 (plan decision 31)');
  if (JSON.stringify(tp.filter((f) => q(f, 'departure_at') === '2028-02').map((f) => f.status)) !== '[200]')
    fail('travelpayouts: the empty-envelope probe (2028-02) is missing or not a 200');
  if (JSON.stringify(tp.filter((f) => f.status === 401).map((f) => q(f, 'departure_at'))) !== '["2028-03"]')
    fail('travelpayouts: the 401 probe must be the one 401, on 2028-03');
  for (const f of tp) if (q(f, 'currency') !== 'gbp') fail('travelpayouts: currency is not gbp');

  // SearchApi
  const cal = sa.filter((f) => q(f, 'engine') === 'google_flights_calendar');
  // why: SA-02 and SA-03 share outbound 2027-03-01..03-09 (plan decision 29); the return span tells them apart
  const main = cal.filter((f) => q(f, 'return_date_end') === '2027-03-30');
  if (main.length !== 1 || main[0]?.status !== 200 || q(main[0], 'outbound_date_end') !== '2027-03-09')
    fail(
      'searchapi: the 180-combination calendar must be one 200, out 2027-03-01..03-09 × ret 2027-03-11..03-30',
    );
  const over = cal.filter((f) => q(f, 'return_date_end') === '2027-04-03');
  const overBody = over[0]?.body;
  const emptyCalendar =
    typeof overBody === 'object' &&
    overBody !== null &&
    !Array.isArray(overBody) &&
    (!('calendar' in overBody) || (Array.isArray(overBody.calendar) && overBody.calendar.length === 0));
  if (over.length !== 1 || !(over[0]?.status === 400 || (over[0]?.status === 200 && emptyCalendar)))
    fail('searchapi: the over-limit calendar must be one 400 or one empty 200');
  const unauth = sa
    .filter((f) => f.status === 401)
    .map((f) => `${q(f, 'outbound_date')}/${q(f, 'return_date')}`);
  if (JSON.stringify(unauth) !== '["2027-03-10/2027-03-31"]')
    fail('searchapi: the 401 probe must be the one 401, on 2027-03-10/2027-03-31');
  for (const f of sa) {
    if (
      q(f, 'gl') !== 'gb' ||
      q(f, 'travel_class') !== 'economy' ||
      q(f, 'currency') !== 'GBP' ||
      q(f, 'adults') !== '1'
    )
      fail('searchapi: gl, travel_class, currency or adults differs');
    if (q(f, 'stops') !== null) fail('searchapi: a stops parameter was sent (plan decision 24)');
    if (q(f, 'separate_tickets') !== '1')
      fail('searchapi: a request without separate_tickets=1 (plan decisions 24 and 29: both engines)');
    if (q(f, 'engine') === 'google_flights' && q(f, 'sort_by') !== 'price')
      fail('searchapi: google_flights without sort_by=price (plan decision 24)');
  }

  // the chain
  const flights = sa.filter((f) => q(f, 'engine') === 'google_flights' && f.status === 200);
  const step1 = flights.find((f) => q(f, 'departure_token') === null && q(f, 'booking_token') === null);
  const step2 = flights.find((f) => q(f, 'departure_token') !== null);
  const step3 = flights.find((f) => q(f, 'booking_token') !== null);
  if (step1 === undefined || step2 === undefined || step3 === undefined)
    fail('searchapi: the step 1 → 2 → 3 chain is incomplete');
  else {
    if (nights(step1) < 10 || nights(step1) > 21)
      fail(`searchapi: step 1 is ${nights(step1)} nights, outside 10–21`);
    const dt = q(step2, 'departure_token') ?? '';
    const bt = q(step3, 'booking_token') ?? '';
    if (!new RegExp(`^<departure_token:\\d+@${step2.session}>$`).test(dt))
      fail('searchapi: step 2 departure_token is not a session placeholder');
    if (!new RegExp(`^<booking_token:\\d+@${step3.session}>$`).test(bt))
      fail('searchapi: step 3 booking_token is not a session placeholder');
    if (!JSON.stringify(step1.body).includes(JSON.stringify(dt)))
      fail("searchapi: step 2's departure_token is not in step 1's body");
    if (!JSON.stringify(step2.body).includes(JSON.stringify(bt)))
      fail("searchapi: step 3's booking_token is not in step 2's body");
  }

  // allowlists, body URLs
  for (const [provider, files] of [
    ['travelpayouts', tp],
    ['searchapi', sa],
  ] as const) {
    const dir = join(root, provider);
    const names = existsSync(dir)
      ? readdirSync(dir).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
      : [];
    if (names.length !== 1) {
      fail(`${provider}: ${names.length} allowlist files, expected 1`);
      continue;
    }
    try {
      const allow = loadParamsAllowlist(join(dir, names[0] ?? ''), root);
      for (const f of files) assertRequestAllowed(allow, f.endpointPath, new URL(f.request.url));
    } catch (e) {
      fail(`${provider} allowlist: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const f of all)
    for (const { key, value } of strings(f.body)) {
      if (!/^https?:\/\//i.test(value)) continue;
      const u = new URL(value);
      if (u.host !== 'www.google.com' && u.host !== 'www.searchapi.io')
        fail(`body URL host ${u.host} under ${key}`);
      if (u.username !== '' || u.password !== '') fail(`body URL with userinfo under ${key}`);
      if (u.host === 'www.searchapi.io' && u.search !== '')
        fail(`search_metadata URL with a query under ${key}`);
      if (u.host === 'www.google.com')
        for (const [name, v] of u.searchParams)
          if (OPAQUE.test(v) && !v.startsWith('<'))
            fail(`www.google.com URL parameter ${name} under ${key} holds an opaque value`);
    }
  return problems;
}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm --filter @gmt/api exec vitest run test/recorded` and `pnpm --filter @gmt/api test`
Expected: `workedExampleTree.test.ts` 15 passed (the negatives added for plan decisions 29 and 31); `manifest.test.ts` 1 failed, its problem list starting with the verifier's and `travelpayouts: 0 recordings, expected at least 21` (the committed tree holds only `.gitkeep`). The package suite: 1 failed | 156 passed (157), the one failure being `test/recorded/manifest.test.ts`; every other row of section 12 is green. This is the pre-handoff state (r2-ts-012).

- [ ] **Step 5: Commit the check, not the gate**

```bash
git add apps/api/test/helpers/workedExampleTree.ts apps/api/test/recorded/workedExampleTree.test.ts && git commit -m "wp04b: the committed-tree check as a function, proven on a stand-in tree and broken copies"
```

`apps/api/test/recorded/manifest.test.ts` stays uncommitted until Task 12b's tree turns it green, so no red test ever lands on the branch. The implementing agent stops here and hands Task 12b to Ian.

### Task 12b: Live recording on the example route (operator only), manual review and commit

**STOP: operator-only.** This task spends real SearchApi credits and reads the operator's `.env`. A subagent never runs it; Fable hands it to Ian in the pre-handoff state of Task 12a and runs Steps 1–2 only with Ian present.

**Files:** create `packages/providers/fixtures/recorded/**` (by the run); commit `apps/api/test/recorded/manifest.test.ts` with it.

- [ ] **Step 1: Preconditions.**
   - Tasks 1–11 and Task 12a's check are committed and green; `manifest.test.ts` is written and red.
   - The app is not running (`app_lock` free). Run every command as the app's user (the read-only lock probe can leave SQLite's empty `-wal`/`-shm` side files, owned by whoever ran it; sec2-003).
   - The operator's `.env` at the repository root defines `TRAVELPAYOUTS_TOKEN`, `SEARCHAPI_KEY` and the production `DATABASE_PATH`, and `POINT_OF_SALE` is `GB` or unset. On the trial plan, `SEARCHAPI_TRIAL_USED` holds the credits spent outside this app (9 from the spike). Do not open, print or grep `.env`.
   - Read the SearchApi dashboard's "Remaining free searches (credits)" and write it down.
   - The recorded tree holds only `.gitkeep`. After any earlier failed live run, every file of that run's session and its allowlists were deleted, and Ian agreed to the re-run.

- [ ] **Step 2: Dry run.**

   ```bash
   pnpm record:fixtures --budget 5 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run
   ```

   Expected, exit 0: `airports seeded: …` on a first run; `tool lock acquired`; the 27 call lines of section 7; `total: SearchApi 6 calls, ≤5 credits (4 expected); Travelpayouts 21 free calls, ≤61 with up to 3 pages per tile`; `metro from the airports table: LON`; `recording into: <repository>/packages/providers/fixtures/recorded`; `Travelpayouts per-run cap (EXECUTION_MAX_FREE_CALLS): …`; `SearchApi credits already ledgered to tool runs in this budget window: 0; this run ≤5; --budget 5`; `SearchApi window: <used> of <cap> used (compare with the dashboard); room <room>, this run ≤5`; `Travelpayouts month: …`; no `a live run would be refused` line; `tool lock released`. On the trial plan `<cap> − <used>` must equal the dashboard reading; if not, stop and resync `SEARCHAPI_TRIAL_USED` with Ian.

- [ ] **Step 3: Live run.** The same command without `--dry-run`:

   ```bash
   pnpm record:fixtures --budget 5 --route LHR,LGW:JFK,EWR --month 2027-03
   ```

   It takes a few minutes (calendar calls take 9–29 s; the trial limiter allows 2 per minute). Expected, exit 0:
   - TP-01…TP-19 at 200 (TP-19 is best-effort), TP-20 at 401, TP-21 at 200;
   - SA-01 at 401; SA-02, SA-04, SA-05, SA-06 at 200; SA-03 at 400 or an empty 200;
   - `required calls: all as expected`, `chain step 1 → 2 → 3: complete`;
   - the chain-prices, over-limit, empty-envelope, `429: not attempted` and `session:` lines;
   - `ledger: SearchApi <4 or 5> credit(s) of budget 5; Travelpayouts <≥ 21> free call(s)`.

   If the run exits non-zero, do not re-run: copy the summary, including its `session:` line (printed on the failure path too), into the notes and stop for Ian. A re-run needs `--confirm-rerun` (exit 65 otherwise) and a cleaned tree (Step 1).

- [ ] **Step 4: Committed-tree test.** Run `pnpm --filter @gmt/api exec vitest run test/recorded/manifest.test.ts`. Expected: 1 passed. If it fails, the manifest stays strict (ruling on prov-wp04b-r2-005); the one permitted repair is for a retried call: when the summary printed a line `<id>: non-final attempt file(s), unbilled, delete before commit (Task 12b step 4): <files>`, each listed file has the same request URL as that call's final 200 and a non-200 status, was not billed, and may be deleted whole together with its `.raw.json`. Delete only those files, record each in the PR, and run the manifest test again before committing. A line `<id>: <n> failed attempts, keep for review; the session cannot be committed as is` (a call whose final attempt also failed) permits nothing: keep the files and stop. Any other failure: stop; do not edit or delete a recorded file (the hash test fails on any edit by design).

- [ ] **Step 5: Dashboard.** Read the remaining credits again. The drop must be **at most** the ledger line's SearchApi figure (spec §2 fact 4: the ledger may overcount, never undercount). If the drop is larger, stop: do not re-run, record a finding against the WP4 billing rule (a `no-response (network; … NOT counted …)` line names the likely call), and resync `SEARCHAPI_TRIAL_USED` with Ian. Record the ledger figure, both readings and the difference in the PR.

- [ ] **Step 6: Manual review of every recorded file before `git add`.** Run `git status --porcelain packages/providers/fixtures`; no `.raw.json` may appear (if one does, the ignore rule is broken: stop). Then open each `.json` under `fixtures/recorded/` and check:
   - [ ] No key or token value: `node --env-file=.env scripts/secret-scan.mjs` prints `secret scan: clean` (Node loads the real values into the scan's environment without printing them). This is the real-value gate; CI cannot run it.
   - [ ] `request.url` keeps its query; it has no `api_key` or `token` parameter, no userinfo and no credential value. `request.headers` has no `authorization` or `x-access-token`.
   - [ ] `search_metadata` URL fields (`request_url`, `json_endpoint`, …) keep their keys, and every such URL has no `?` and no `user:pass@`.
   - [ ] Every `departure_token` and `booking_token`, in request URLs and in bodies, has the form `<departure_token:n@<session>>` / `<booking_token:n@<session>>`, where `<session>` equals the file's `session`, the same in every file; the step-2 and step-3 request placeholders appear in the previous step's body.
   - [ ] `responseHeaders` holds only `content-type`, `retry-after`, `x-ratelimit-*` or `ratelimit-*`.
   - [ ] No personal data: no operator name, email or account id, no location other than the worked example's airports and the carriers' own data. No opaque id other than the vendor's search ids; any query parameter on a `www.google.com` booking URL is noted in the PR (the manifest refuses opaque values there).
   - [ ] `recordedBy` is `@gmt/api record:fixtures` on every file.
   - [ ] Booking URLs in step-3 bodies are `https://www.google.com/…` (spec §5.2 link allowlist).
   - [ ] File count: 21 Travelpayouts (+ one per extra page) and 6 SearchApi recordings, plus `travelpayouts/params-<date>.json` and `searchapi/params-<date>.json`.

   If any item fails, delete every file of the session and its allowlists, fix the cause in a follow-up (a recorder issue goes to WP4's owner), and re-run only with Ian's agreement (Step 1).

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`, `pnpm --filter @gmt/providers test`, `pnpm secret-scan`
Expected: both suites pass (the api suite includes the manifest test, 157 passed; the suite's committed-tree snapshot holds after the commit); `secret scan: clean`.

- [ ] **Step 8: Commit**

```bash
git add packages/providers/fixtures/recorded apps/api/test/recorded/manifest.test.ts && git commit -m "wp04b: recorded fixtures for the worked example and the committed-tree manifest test"
```

The tree after the run (date = the run's UTC date):

```
packages/providers/fixtures/recorded/
├── travelpayouts/
│   ├── params-<date>.json
│   └── _aviasales_v3_prices_for_dates/
│       └── <date>-<sha12>.json          × 20 (TP-01…TP-20; one more per extra page)
└── searchapi/
    ├── params-<date>.json
    └── _api_v1_search/
        └── <date>-<sha12>.json          × 6 (SA-01…SA-06)
(every <date>-<sha12>.raw.json sibling stays on disk, gitignored, never committed)
```

The PR description carries: the dashboard readings before and after, the ledger figure and the difference; the run summary lines, including the session id; any non-final attempt file deleted under Step 4; SA-03's behaviour (400 or empty 200); whether TP-19 was empty; the chain prices and "step 1 = step 2: yes/no"; the `tool` script `// why:` of Task 9; and this line: **the recorded tree is for this private repository; publishing the repository requires removing or re-recording the vendor bodies first (plan decision 20).**

## 11. Pinned review-focus tests

None. The plan's Review Focus lines are owned by WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10.

## 12. Definition of done

Rows marked **operator** run on Ian's machine with the real `.env`; every other row runs anywhere, including CI. Before Task 12b (the pre-handoff state) every row is green except the first, which fails in exactly `test/recorded/manifest.test.ts` (1 failed | 156 passed).

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/api test` | all 157 tests pass after Task 12b; coverage over `src/**` ≥ 85 % lines, 70 % branches, 85 % functions, 85 % statements (assembly, manifest excluded: 96.9 / 84.5 / 95.8 / 94.9) |
| `pnpm --filter @gmt/db test` | passes (263), including `test/readOnlyLockState.test.ts` and the updated barrel test; WP3's thresholds hold |
| `pnpm --filter @gmt/providers test` | passes (264, including the barrel test naming `defaultRecordedRoot`, `withContentHash` and `assertRecordedRoot`, and the `assertRecordedRoot` test); WP4's thresholds hold |
| `pnpm lint` | clean |
| `pnpm -r typecheck` | clean |
| `node scripts/check-boundaries.mjs` | exit 0: `process.env` is read only under `apps/api/src/bootstrap/`; any msw import (static, side-effect or dynamic) appears only under `packages/providers/src/testing/` among the packages' `src` trees; `@gmt/api` neither lists msw nor imports it from any `.ts`, `.mts`, `.cts`, `.js`, `.mjs` or `.cjs` file under `apps/api/test` |
| `pnpm secret-scan` | `secret scan: clean` |
| `git ls-files packages/providers/fixtures \| grep -c 'raw\.json'` | `0` |
| `pnpm record:fixtures --route LHR:JFK --month 2027-03` | exit 64, `--budget is required` (the code passes through `pnpm -C apps/api run`, plan decision 30; `tool.spawn.test.ts` asserts it through the root script) |
| `grep -rnE 'LHR\|LGW\|JFK\|EWR\|LON\|NYC' apps/api/src --exclude=workedExample.ts` | no output (airports only in `workedExample.ts`, tests, docs and fixtures) |
| **operator:** `pnpm record:fixtures --budget 5 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run` | exit 0, the 27 call lines and the total line of section 7, no `a live run would be refused` line |
| **operator:** `node --env-file=.env scripts/secret-scan.mjs` | `secret scan: clean` with the real values loaded |
| **operator:** SearchApi dashboard | the drop over the run ≤ the ledger's SearchApi figure, recorded in the PR |

The grep row's pattern is ERE with `\|` escaped only for this table; type it as `grep -rnE 'LHR|LGW|JFK|EWR|LON|NYC' apps/api/src --exclude=workedExample.ts`.

## 13. Open questions

None. Plan decisions 23 and 26 record this brief's contract changes; this revision's one further contract detail is that `readOnlyLockState` returns the discriminated union `ReadOnlyLockState` (`{ state: 'absent' }` or `{ state: 'fresh' | 'stale'; holder: 'app' | 'tool'; heartbeatAt }`), with AppLock and it sharing one freshness rule.
