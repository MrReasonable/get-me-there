---
wp: 13
title: smoke test, layer-B engine tests, smoke documentation, final whole-branch pass
owner: fable
depends_on: [all]
spec_sections: ["§9 item 7", "§9 item 4 layer B", "§7 app_lock and the tool bootstrap", "§10 /tools/smoke", "§11 banned words", "§12", "§13", "§15", "§16 WP13"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, security-reviewer, cost-and-budget-reviewer, devops-reviewer, provider-integration-expert, product-owner, persona-flexible-traveller]
status: draft
---

# WP13: smoke test, layer-B engine tests, smoke documentation, final whole-branch pass

Refreshed on 2026-10-17 against the plan's "Global Constraints", its "Wiring and bootstraps" contract (the one exit-code table and the smoke contract) and decisions 1–64, spec revision 27, and the code merged on `main` at `13454fc` (WP0–WP9 and the decision-64 skip guard). Every code block below was assembled on a scratch worktree of that commit and passed `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm casts` and the api, core, providers and engine suites (§13 item 1). WP10, WP11 and WP12 are not on `main` yet; Task 13.7 edits WP12's files and was not assembled.

## 1. Goal

Prove the assembled system against the vendors with the operator's real keys at a small, stated cost, prove the engine over the real adapters on the recorded session, document the smoke test, and close the build with a whole-branch review and the release tag. Specifically:

- `pnpm smoke:live` and `POST /api/tools/smoke` run one discovery tile per configured provider and one SearchApi itinerary chain, inside a stated worst case the guard enforces, and print the cheapest price with its provenance and a checklist of provenance and honesty checks.
- The engine passes layer-B tests on the local recordings, and skips them visibly where the recordings are absent.
- `docs/setup.md` documents the smoke test and its exit codes.
- The whole-branch review runs, every finding is addressed, the operator's smoke rows are recorded, and `v0.1.0` is tagged.

## 2. Scope

**In**

- `apps/api/src/tools/smoke.ts`: `runSmoke`, `runSmokeTool`, `parseSmokeArgs`, `smokeQuery`, `smokeWorstCase`, `smokeFixtureTarget`, `metroRuleCheck`, `describePrice` and the result types. The smoke runs through `runTool('smoke', …)` with the same bootstrap as recording: config, refusal under `NODE_ENV=test` or an open synthetic gate (70), arguments (64), data directory (73), the read-only `app_lock` probe (75), the pre-migration backup (73/74), `buildPorts`, `AppLock('tool')`, seeding, heartbeat, release on every path.
- Spend, by the recording rules: the smoke's worst case (SearchApi `1 + 1 + 2 × expandTop` = 4 credits; Travelpayouts one tile at the 3-page cap) is checked by the same `spendPosition` the record tool uses (window room, then the cross-run sum against `--budget`, refused with 65 before any request, `--confirm-rerun` lifting only the cross-run refusal), and is the hidden tool execution's snapshot budget, so the guard refuses any reservation beyond it before the fetch.
- Fixtures: a command-line smoke writes dated recordings beside the database (`<dirname(DATABASE_PATH)>/smoke/fixtures/recorded`, ignored by git wherever it lies), never into `packages/providers/fixtures/recorded` (decision 61). The route writes none and says so.
- `POST /api/tools/smoke`: mounted here (decision 4), one tool at a time with the record route, runs inside a container too (spec §13 calls it with curl from the host; decision 62 refuses only recording there), refuses an open synthetic gate with 70.
- Shared code the smoke reuses rather than copies: `spendPosition` and `openHiddenExecution` extracted from the record tool's `recordExecution.ts`; the decision-61 visible-skip guard moved into `@gmt/providers/testing` (one copy for api, providers and engine).
- Layer-B engine tests (`packages/engine/test/layerB/`) on the real adapters, the real http-kit and guard, an in-memory database and the recorded WP4b session, skipped visibly without recordings, and the CI step that shows those skips (the decision-61 CI note).
- `docs/setup.md` section 13 "The smoke test" and the exit codes 2 and 3 in section 10, with WP12's `docs.test.ts` changed to require them (decision 63 handed the smoke documentation to WP13).
- The operator's smoke run and the WP5/WP6 smoke rows (Task 13.8), the whole-branch review and the release (Task 13.9).

**Out**

- `record:fixtures`, `runTool`, the tool bootstrap's steps, `recordFixtures`, the recorded tree's verification: WP4b (on main). WP13 adds the `smoke` case to `runTool`'s switch and extracts two helpers.
- The adapters' tiling, parsing, error mapping and allowlists: WP5, WP6 (on main). A smoke or layer-B finding that traces to `src` is fixed on this branch with a regression test in the owning package.
- `createApp`, the record route, `oneAtATime`, `API_TEXT`'s other entries: WP8 (on main). WP13 adds the smoke handler, its runner and one text.
- The engine and its layer-A harness: WP7 (on main). Layer B builds its own small setup and changes no WP7 file.
- Dockerfile, compose, the rest of `docs/setup.md`, the docs tests' other rules: WP12. WP13 adds one section, two table rows and one test.
- Cross-cutting tests the merged packages already own: the ROUTES mounting sweep both ways, every GET against the contract, banned words in every `API_TEXT` entry and response string, the sentinel secrets in bodies and logs (`apps/api/test/routes/contract-sweep.test.ts`); the web catalogue and rendered sweeps (`apps/web/test/copy/`); engine log lines and operator words (`packages/engine/test/logs-and-words.test.ts`); the recorded-tree secret scan (`apps/api/test/security/sentinel.test.ts`); the tool bootstrap's lock, backup and refusal cases (`apps/api/test/bootstrap/tool.test.ts`, `tool.spawn.test.ts`). The earlier draft's separate `integration` project duplicated them; Task 13.9 runs them instead (§13 item 9).

## 3. Spec sections

- **§9 item 7.** `pnpm smoke:live` issues exactly one tile per configured provider (a query sized so `plan` yields one tile), asserts via the ledger, prints the cheapest price with provenance, writes dated fixtures, exits non-zero on zero providers or any configured-provider error, uses a distinct code for empty, is excluded from `pnpm test` and runs through the tool bootstrap.
- **§9 item 4, layer B.** The real adapters replaying recorded fixtures through the same path as layer A: real http-kit, the real `db` BudgetGuard, an in-memory DB, msw on global fetch.
- **§7 `app_lock`, SQLite settings, migrations.** The tool bootstrap skips the boot sweep, auto-resume and cron, uses the production ledger, checks `app_lock` read-only before any backup or migration, and holds the lock as `tool`; a test proves it starts no execution.
- **§10 `/tools/smoke`.** The smoke runs inside the app process, authenticated, while the app holds `app_lock`; every route lives under `/api`.
- **§11.** No banned word in a user-facing string; the tools' response lines are API strings (§13 item 6).
- **§12.** No new variable: the smoke's budget is an argument, like recording's; `.env.example` is unchanged.
- **§13.** The image has no curl: the operator calls the route from the host with curl against the loopback port; the docs carry the local-development `pnpm smoke:live`.
- **§15.** "Cheapest round trip found", never "bookable": the smoke's summary reads `cheapest found …` with the source and age.
- **§16 WP13.** First failing test: the smoke exits 0 with provenance.
- **Plan decisions** this brief implements: 4 (WP13 mounts the route), 5 (the hidden tool execution), 12 (curl from the host), 20 and 23 (tool runs on the production ledger, read-only lock probe, synthetic gate refused, cross-run budget, free calls before billed ones), 26 (tools run as the app's user), 27 (the WP5 smoke rows), 29 (the production 9 × 20 rectangle, `separate_tickets=1`), 34 (no metro query), 35 (vendor row dates), 39 (open-jaw rows dropped), 40 (route history best-effort), 53 (the read-only lock check), 61, 62, 63, 64.

## 4. Interfaces consumed

From the plan's "Cross-package contracts" and the merged code (signatures as on `main`; §13 item 3 lists where the plan text is stale):

```ts
// core (WP0–WP2)
export interface DiscoveryQuery { origin: Iata; destination: Iata; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number; cabin: Cabin; currency: 'GBP'; cells?: CellKey[] }
export interface ItineraryQuery extends CellKey { cabin: Cabin; adults: 1; currency: 'GBP'; maxStops?: number; expandTop: number; bookingLinks: boolean }
export type DiscoveryTileResult = { kind: 'tile'; index; coveredCells; fetchedAt; pointOfSale; prices: RawCalendarPrice[]; noFares; notes; cellIssues?: CellIssue[]; truncated?: boolean } | { kind: 'tile-error'; index; coveredCells; error: ProviderError };
export interface ItinerarySearchResult { offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt; pointOfSale; partial: boolean; failedExpansions: number; notes: string[]; routeHistory?: … }
export interface FlightProvider { id; displayName; suppliedFields; cabins; discovery?: DiscoveryCapability; verification?: VerificationCapability; healthcheck(ctx) }
export interface Provenance { providerId; sourceKind; fetchedAt; providerObservedAt?; maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale; cabin }
export const provenanceSchema: z.ZodType<Provenance>;
export function effectiveAge(p, now: IsoDateTime): EffectiveAge; export function formatAgeFull(a: EffectiveAge): string; export function formatPence(pence: number): string;
export const iataSchema; export function monthOf(d: IsoDate): IsoMonth; export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number;
export class BudgetExceeded extends Error { scope: BudgetScopeKind; cap; current; requested; providerId }
export class AbortedError extends Error; export class ProviderError extends Error { kind; reason; retryable; httpStatus }
apiContract.toolSmokeRequestSchema, apiContract.toolRunResponseSchema   // { exitCode; summary; lines; fixturesWritten }
export function syntheticAllowed(c: SyntheticGateInput): boolean; export const BANNED_WORD_ALLOWLIST; export function findBannedWords(text, allowlist?);

// db (WP3)
LedgerRepo.countsFor(executionId): { calls; costMicroGbp; tiles; cacheHits; perProvider: Array<{ providerId; stage: 'discovery' | 'verification' | null; calls; costMicroGbp; tiles; cacheHits }> }
AirportsRepo.exists(iata): boolean; AirportsRepo.airportsOfMetro(code): Iata[]
DefinitionsRepo.create(input: DefinitionInput); softDelete(id); get(id)
ExecutionsRepo.create(ExecutionCreateInput); setStatus(id, status, { finishedAt?, errorText? }); get(id)
Db.immediateTransaction<T>(fn: () => T): T
export const AIRPORTS_DATA_DIR, MIGRATIONS_DIR; export function budgetConfigFromConfig(config); class SqliteBudgetGuard; class SqliteResponseCache

// providers (WP4–WP6)
export function createHttpKit(deps: HttpKitDeps): HttpKit;   // HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export interface HttpKitDeps { budget; cache; limits: Partial<Record<HttpProviderId, ProviderHttpLimits>>; clock; log; secrets: Secret[]; syntheticAllowed: boolean; recorder?: FixtureRecorder; inProcessHosts? }
export function createRecorder(opts: { root: string; secrets: readonly Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;   // root must exist and end in fixtures/recorded
export function defaultRecordedRoot(): string;
export function searchApiProvider(o: { http; log; clock; key: Secret; costPerCallMicroGbp; pointOfSale; cacheTtlSeconds; paramsAllowlist }): FlightProvider;
export function travelpayoutsProvider(o: { http; log; clock; token: Secret; cacheTtlSeconds; paramsAllowlist }): FlightProvider;
export function searchApiHttpLimits(limits, timing); export function travelpayoutsHttpLimits(limits, config); SEARCHAPI_PARAMS; TRAVELPAYOUTS_PARAMS;
'@gmt/providers/recording': majorToMinor(major: number, currency: string): number | null; MAX_PAGES
'@gmt/providers/testing': guardedServer; installNetworkGuards(hooks); loadRecorded(root, providerId, endpointPath); replayHandlers(root, opts?: { session?: string }): { handlers; misses(): string[] }

// engine (WP7)
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;   // start(definitionId, { trigger }); verifyCell(definitionId, cell); shutdown()
export interface EngineDeps { config; db; repos; budget; cache; http; providers; notifiers; clock; log }
src/fx/limits.ts: export function fxHttpLimits(timing): ProviderHttpLimits;

// apps/api (WP4b, WP8)
export interface Ports { config; db; repos; budget; cache; http; providers; clock; log; secrets: Secret[]; recorder: FixtureRecorder | null; fixtureRoot: string | null }
export function buildPorts(config, opts: { log; clock?; recorder?; migrationsDir; fixtureRoot? }): Ports;
export function httpLimitsFor(config): HttpKitDeps['limits'];
export function providersFor(config, deps: { http; log; clock }): FlightProvider[];
export async function runTool(name: ToolName, argv: string[], opts?: RunToolOptions): Promise<number>;   // RunToolOptions { env?; runners?: Partial<ToolRunners>; out?; err?; logDestination?; clock?; migrationsDir?; recording?: RecordingTarget }
export interface ToolContext { signal: AbortSignal; out(line); err(line); recordedRoot: string; recordedBy: string }
export const EXIT = { ok: 0, failed: 1, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;
tools/recordExecution.ts: priorToolCredits(ports): number; budgetPosition(ports, a, plan); openRecordingExecution(ports, a, plan, sa)
tools/recordPlan.ts: CALENDAR_OUT_DAYS (9), RECORD_MIN_NIGHTS (10), RECORD_MAX_NIGHTS (21), TP_MAX_PAGES_PER_TILE, firstDayOf(month), monthAfter(month, k)
tools/recordRequests.ts: cheapestOption(body, 'departure_token' | 'booking_token'): { token; price } | null
routes: route(schemas, handle); NO_INPUT; oneAtATime(ctx, key, fn, busy); HandlerTable; RouteContext { ports; engine; tools: HttpToolRunners; busy }; ApiError; API_TEXT; safeMessage(e, secrets)
test helpers: testEnv, cleanEnv, toolEnv, silentLog, SENTINEL_SA/TP; STANDIN_MARKER; onCleanup, tempDir, tempRecordedRoot, filesUnder; createHarness (routes); testRecording, TEST_RECORDED_BY; engine test/support/harness.ts capturingLogger, capturingNotifier
```

## 5. Interfaces produced

```ts
// packages/core/src/api-contract/system.ts (changed)
export const toolSmokeRequestSchema = z.object({ origin: iataSchema, destination: iataSchema, budget: z.number().int().min(1) });

// apps/api/src/tools/types.ts (changed): the one exit-code table gains the smoke's two codes
export const EXIT = { ok: 0, failed: 1, smokeNoProviders: 2, smokeEmpty: 3, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;

// apps/api/src/tools/recordExecution.ts (extracted, shared by both tools)
export function spendPosition(ports: Ports, worst: { credits: number; freeCalls: number }, budget: number): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] };
export function openHiddenExecution(ports: Ports, input: DefinitionInput, resolved: DefinitionSnapshot['resolved'], estimate: Estimate | null): string;

// apps/api/src/tools/smoke.ts
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
export const SMOKE_EXPAND_TOP = 1; export const SMOKE_DEPARTURE_DAYS = 9; export const SMOKE_CABIN: Cabin = 'economy'; export const SMOKE_USAGE: string;
export interface SmokeArgs { origin: Iata; destination: Iata; budget: number }
export interface SmokeCli { args: SmokeArgs; confirmRerun: boolean }
export interface SmokeCheck { name: string; status: 'pass' | 'fail' | 'skip' | 'look'; detail: string }
export interface SmokePrice { pricePence: number; cell: CellKey; nights: number; displayName: string; provenance: Provenance }
export interface SmokeProviderReport { providerId: 'travelpayouts' | 'searchapi'; stage: 'discovery' | 'itinerary'; status: 'priced' | 'empty' | 'error' | 'skipped'; prices: number; cheapest: SmokePrice | null; detail: string }
export interface SmokeResult { exitCode: number; summary: string; lines: string[]; checks: SmokeCheck[]; reports: SmokeProviderReport[]; fixturesWritten: string[]; executionId: string | null }
export function parseSmokeArgs(argv: readonly string[]): { ok: true; value: SmokeCli } | { ok: false; message: string };
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery;
export function smokeWorstCase(config: Config): { credits: number; freeCalls: number };
export function smokeFixtureTarget(databasePath: string, recordedTree?: string): { root: string; recordedBy: string } | { refusal: string };
export function metroRuleCheck(q: Pick<DiscoveryQuery, 'origin' | 'destination'>, urls: readonly URL[]): SmokeCheck;
export function describePrice(p: SmokePrice, now: IsoDateTime): string;
export async function runSmoke(ports: Ports, cli: SmokeCli, opts: { signal: AbortSignal; fixtures: { root: string; recordedBy: string } | null }): Promise<SmokeResult>;
export async function runSmokeTool(ports: Ports, cli: SmokeCli, ctx: ToolContext): Promise<number>;

// apps/api/src/bootstrap/tool.ts (changed)
export interface ToolRunners { record(ports, cli: RecordCli, ctx): Promise<number>; smoke(ports, cli: SmokeCli, ctx): Promise<number> }

// apps/api/src/routes/types.ts (changed)
export type ToolSmokeRequest = z.infer<typeof apiContract.toolSmokeRequestSchema>;
HttpToolRunners.smoke?: (args: ToolSmokeRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
export const OWNED_ELSEWHERE: ReadonlySet<string> = new Set();   // empty: every ROUTES entry is mounted by apps/api
// apps/api/src/text.ts: API_TEXT.smokeSynthetic

// packages/providers/src/testing (moved here from two test helpers; decisions 61, 64)
export const SKIP_SUFFIX = ' (skipped: recordings not present, local-only, decision 61)';
export function recordingsPresent(root: string): boolean;
export const skipTitle: (title: string, present: boolean) => string;

// apps/api/test/helpers/smokeVendors.ts (test only)
export function stubSmokeVendors(o?: SmokeVendorOptions): { urls: URL[] };
```

**Exit codes** (the plan's one table for every CLI; spec §9 item 7). For the smoke, a refusal is decided before any request in this order: 64 (bad arguments, a city code, an unknown airport, the same airport twice), 2 (no provider configured), 65 (spend); after the run, 1 beats 3 beats 0.

| Code | Meaning | Who returns it |
|---|---|---|
| 0 | Ok. Smoke: every configured provider priced its tile, the chain priced, and no checklist line reads `fail` | tool |
| 1 | The run failed. Smoke: a provider errored (a `tile-error`, a thrown `ProviderError`, a guard refusal, a plan of other than one tile, a non-GBP price), the run was aborted, or a checklist line reads `fail` | tool |
| 2 | Smoke: no provider configured; nothing sent, no execution | `runSmoke` |
| 3 | Smoke: no error, but a tile or the chain held no price | `runSmoke` |
| 64 | Bad arguments | `parseSmokeArgs`, `runSmoke` |
| 65 | Refused for spend: a provider window has less room than the worst case, or earlier tool runs' credits plus the worst case exceed `--budget` without `--confirm-rerun` (over HTTP: `budget` in the body, never confirmed) | `spendPosition` via `runSmoke` |
| 70 | Refused under `NODE_ENV=test` or while the synthetic gate is open (the route answers 70 in `exitCode`) | `runTool`, the in-process runner |
| 73, 74, 75, 78 | Data directory or preflight impossible; backup failed; `app_lock` held; bad configuration | `runTool` |

Through the route a malformed body is a 400 from validation; every other code arrives in `exitCode`.

**The checklist.** Every line reads only what this run saw (the hidden execution's ledger rows, the requests this run's http-kit sent, the bodies it received):

| Check | `pass` when | Source |
|---|---|---|
| one tile per provider | every configured provider planned exactly one tile | spec §9 item 7 |
| ledger | each fetched provider has one first-attempt tile and no cache hit; the chain made at most `1 + 2 × expandTop` calls; SearchApi calls ≤ the stated worst case | spec §8.1 parity |
| provenance | each cheapest price parses with `provenanceSchema`; point of sale is `POINT_OF_SALE` for SearchApi, `unknown` for Travelpayouts; fetched during this run | spec §3, Global Constraints |
| age labels | `look`: the label each view would print, for the operator to compare with the vendor's page | spec §3, §11; decisions 35, 44, 58 |
| metro rule | every Travelpayouts request named the query's own airports | decision 34 |
| open-jaw drop | every Travelpayouts price is the closed pair; the cells with dropped open-jaw rows are counted | decision 39 |
| 9-day rectangle | SearchApi's one tile is 9 departure days and the vendor accepted it | decision 29; WP5 smoke row |
| step 1 = step 2 | the cheapest outbound's step-1 price equals its cheapest return's step-2 price | spec §5.4 |
| sellers | the chain returned offers, every offer names a seller, and at least one was confirmed by a seller listing | decisions 24, 27 |
| separate tickets excluded | `look` when every SearchApi request carried `separate_tickets=1` (`fail` otherwise); whether Google honoured it is Task 13.8's row | decision 29; WP5 smoke row |

## 6. Library notes

Exercised on 2026-10-17 by this brief's assembly on Node 22 (versions from the lockfile at `13454fc`); every API below is also used on `main` by the file named.

- **vitest 5.0.4.** `describe.skipIf(cond)(title, fn)` (used by `apps/api/test/recorded/manifest.test.ts`); `vi.stubGlobal('fetch', fn)` with `vi.unstubAllGlobals()` (WP4b's `test/helpers/vendors.ts`); `it.each(table)(name, fn)`; the root CLI's `--project <name>` filter plus file-name filters and `--reporter=verbose`, which prints a skipped test's full title (Task 13.6's CI step, run on the assembly). Per-task runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>` (decision 8: no threshold on a partial run).
- **msw 3.0.3** only through `@gmt/providers/testing` (decision 7): `guardedServer.use(...handlers)` adds replay handlers in front of the network guards' catch-all (the guards reset handlers after each test; `packages/providers/test/travelpayouts/replay.test.ts` uses the same `server.use(...r.handlers)`).
- **node:child_process** `spawnSync(process.execPath, [...NODE_ARGS, '--import', 'tsx', 'src/bootstrap/tool.ts', …], { cwd, env, encoding: 'utf8', timeout })` as WP4b's `tool.spawn.test.ts` does, with its DNS-refusal preload.
- **git** `git check-ignore -q <path>` exits 0 for an ignored path (used by `apps/api/test/security/sentinel.test.ts`).
- **hono 4.13.13** through WP8's `route()` wrapper only; no new Hono API.

## 7. Files

**Create**

- `apps/api/src/tools/smoke.ts`
- `apps/api/test/helpers/smokeVendors.ts`
- `apps/api/test/tools/smoke.test.ts`, `apps/api/test/tools/smokeArgs.test.ts`
- `apps/api/test/routes/toolsSmoke.test.ts`
- `packages/providers/src/testing/recordings.ts`
- `packages/engine/test/layerB/support.ts`, `packages/engine/test/layerB/layerB.test.ts`

**Modify**

- `packages/core/src/api-contract/system.ts` (`toolSmokeRequestSchema.budget`)
- `apps/api/src/tools/types.ts` (`EXIT` 2 and 3), `apps/api/src/tools/recordExecution.ts` (`spendPosition`, `openHiddenExecution`, two lines without "live")
- `apps/api/src/bootstrap/tool.ts` (`ToolRunners.smoke`, the `smoke` case)
- `apps/api/src/routes/types.ts`, `apps/api/src/routes/tools.ts`, `apps/api/src/tools/inProcess.ts`, `apps/api/src/text.ts`
- `apps/api/test/bootstrap/tool.test.ts`, `apps/api/test/bootstrap/tool.spawn.test.ts`, `apps/api/test/routes/tools.test.ts`, `apps/api/test/routes/contract-sweep.test.ts`
- `apps/api/test/helpers/recordings.ts`, `packages/providers/test/support/recordings.ts` (re-export the moved guard), `packages/providers/src/testing/index.ts`
- `.gitignore`, `.github/workflows/ci.yml`
- `docs/setup.md`, `apps/api/test/deploy/docs.test.ts` (WP12's files; Task 13.7)

## 8. Tasks

### Task 13.1: The smoke exits 0 with provenance (first failing test)

**Files:**
- Create: `apps/api/src/tools/smoke.ts`, `apps/api/test/helpers/smokeVendors.ts`, `apps/api/test/tools/smoke.test.ts`
- Modify: `packages/core/src/api-contract/system.ts`, `apps/api/src/tools/types.ts`, `apps/api/src/tools/recordExecution.ts`, `apps/api/test/bootstrap/tool.test.ts`

**Interfaces:**
- Consumes: `buildPorts`, `httpLimitsFor`, `providersFor`, `createHttpKit`, `createRecorder`, `priorToolCredits`, the record tool's constants, `cheapestOption`, `majorToMinor`, `provenanceSchema`, `effectiveAge`, `formatAgeFull`, `formatPence`, `LedgerRepo.countsFor`.
- Produces: `runSmoke`, `runSmokeTool`, `parseSmokeArgs`, `smokeQuery`, `smokeWorstCase`, `smokeFixtureTarget`, `metroRuleCheck`, `describePrice`, `spendPosition`, `openHiddenExecution`, `EXIT.smokeNoProviders`, `EXIT.smokeEmpty`, `toolSmokeRequestSchema.budget`.

- [ ] **Step 1: Write the failing test**

The vendor stand-ins answer in the shapes the real adapters parse, with dates taken from each request, so the smoke's query (next month) needs no fixed calendar. Travelpayouts returns one closed round trip (£412, dated by the vendor 30 days before the month) and one open-jaw row the adapter must drop; SearchApi returns a calendar cell at £603, a two-option step 1, a two-option step 2 whose cheapest equals step 1, and two seller listings at step 3.

`apps/api/test/helpers/smokeVendors.ts`:

```ts
// Stand-ins for the two vendors in the shapes the real adapters parse (spec §2, §5.2, §5.4), for the smoke's offline
// tests. Test bodies only, never written under fixtures/: every identifier they invent carries STANDIN_MARKER, the
// carriers and sellers are clearly synthetic, and the airports are the worked example's. Dates follow the request, so
// the stand-ins answer whatever month the smoke query names. Like vendors.ts, this replaces globalThis.fetch for one
// test and throws for any other host.
import { addDays, asIsoDate, type IsoDate } from '@gmt/core';
import { vi } from 'vitest';
import { SENTINEL_SA, SENTINEL_TP } from './env.js';
import { onCleanup } from './tmp.js';
import { STANDIN_MARKER } from './vendors.js';

export interface SmokeVendorOptions {
  /** Travelpayouts answers with no row (the schema-valid empty envelope, spec §5.2). */
  tpEmpty?: boolean;
  /** The price step 2 shows for the cheapest return (default 603, equal to step 1). */
  step2Price?: number;
  /** A failure for the chosen request: an HTTP status with a body, or a socket error. */
  failOn?: (url: URL) => { status: number; body: unknown } | 'network' | undefined;
}

export interface SmokeVendorLog {
  /** Every request URL, in order (header values never kept). */
  urls: URL[];
}

const ECHO = { search_parameters: { currency: 'GBP', gl: 'gb', hl: 'en' } };
const POST = { url: 'https://www.google.com/travel/clk/f', post_data: `u=${STANDIN_MARKER}` };
const DT = `${STANDIN_MARKER}-DT-cheapest`;
const DT_DEARER = `${STANDIN_MARKER}-DT-dearer`;
const BT = `${STANDIN_MARKER}-BT-cheapest`;
const BT_DEARER = `${STANDIN_MARKER}-BT-dearer`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** DDMMYYYY of a date, for a Travelpayouts `search_date`. */
const ddmmyyyy = (d: IsoDate): string => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
/** The `t` itinerary token: 26 digits then each direction's airport chain (decision 35, WP6). */
const token = (out: string, back: string): string => `${'1'.repeat(26)}${out}${'2'.repeat(26)}${back}`;

function tpAnswer(url: URL, o: SmokeVendorOptions): Response {
  const p = url.searchParams;
  const month = p.get('departure_at') ?? '';
  if (o.tpEmpty === true) return json({ success: true, data: [], currency: 'gbp' });
  const dep = asIsoDate(`${month}-02`);
  const ret = addDays(dep, 14);
  const dep2 = addDays(dep, 1);
  const ret2 = addDays(dep2, 12);
  const origin = p.get('origin') ?? '';
  const destination = p.get('destination') ?? '';
  const row = (d: IsoDate, r: IsoDate, price: number, back: string) => ({
    origin,
    destination,
    origin_airport: origin,
    destination_airport: destination,
    price,
    airline: 'ZZ',
    flight_number: '9999',
    departure_at: `${d}T08:25:00+00:00`,
    return_at: `${r}T18:00:00-04:00`,
    transfers: 0,
    return_transfers: 0,
    // why: the vendor dates the find two days before the departure month's first day; WP6 reads it as observed age
    link: `/search/${STANDIN_MARKER}?t=${token(`${origin}${destination}`, back)}&search_date=${ddmmyyyy(addDays(dep, -30))}`,
  });
  return json({
    success: true,
    currency: 'gbp',
    data: [
      row(dep, ret, 412, `${destination}${origin}`),
      // why: an open-jaw row (back to another London airport) the adapter must drop and report (decision 39)
      row(dep2, ret2, 377, `${destination}LGW`),
    ],
  });
}

function seg(from: string, to: string, date: IsoDate, flight: string) {
  return {
    departure_airport: { id: from, date, time: '09:00' },
    arrival_airport: { id: to, date, time: '23:00' },
    airline: 'Synthetic Air One',
    flight_number: flight,
    travel_class: 'Economy',
    duration: 420,
  };
}

function saAnswer(url: URL, o: SmokeVendorOptions): Response {
  const p = url.searchParams;
  const origin = p.get('departure_id') ?? '';
  const destination = p.get('arrival_id') ?? '';
  if (p.get('engine') === 'google_flights_calendar') {
    const from = asIsoDate(p.get('outbound_date_start') ?? '');
    return json({
      ...ECHO,
      calendar: [
        { departure: addDays(from, 1), return: addDays(from, 15), price: 603 },
        { departure: addDays(from, 2), return: addDays(from, 14), has_no_flights: true },
      ],
    });
  }
  const out = asIsoDate(p.get('outbound_date') ?? '');
  const back = asIsoDate(p.get('return_date') ?? '');
  if (p.has('booking_token'))
    return json({
      ...ECHO,
      booking_options: [
        { book_with: 'Synthetic Air One', price: 603, booking_request: POST },
        { book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST },
      ],
    });
  if (p.has('departure_token'))
    return json({
      ...ECHO,
      other_flights: [
        {
          flights: [seg(destination, origin, back, 'X1 101')],
          price: o.step2Price ?? 603,
          booking_token: BT,
        },
        { flights: [seg(destination, origin, back, 'X1 103')], price: 640, booking_token: BT_DEARER },
      ],
    });
  return json({
    ...ECHO,
    other_flights: [
      { flights: [seg(origin, destination, out, 'X1 100')], price: 603, departure_token: DT },
      { flights: [seg(origin, destination, out, 'X1 102')], price: 655, departure_token: DT_DEARER },
    ],
  });
}

/** Replaces globalThis.fetch with the two stand-ins for this test (restored afterwards). */
export function stubSmokeVendors(o: SmokeVendorOptions = {}): SmokeVendorLog {
  const log: SmokeVendorLog = { urls: [] };
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    const headers = new Headers(init?.headers);
    log.urls.push(url);
    const fail = o.failOn?.(url);
    if (fail === 'network') throw new TypeError('fetch failed');
    if (fail !== undefined) return json(fail.body, fail.status);
    if (url.hostname === 'api.travelpayouts.com') {
      if (headers.get('x-access-token') !== SENTINEL_TP)
        return new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } });
      return tpAnswer(url, o);
    }
    if (url.hostname === 'www.searchapi.io') {
      if (headers.get('authorization') !== `Bearer ${SENTINEL_SA}`)
        return json({ error: 'Invalid API key.' }, 401);
      return saAnswer(url, o);
    }
    throw new TypeError(`no stand-in for ${url.origin}`);
  };
  vi.stubGlobal('fetch', fake);
  onCleanup(() => vi.unstubAllGlobals());
  return log;
}
```

`apps/api/test/tools/smoke.test.ts` (the first case; Task 13.2 adds the others inside the same `describe`):

```ts
// Spec §9 item 7: the smoke, offline, against the vendor stand-ins (test/helpers/smokeVendors.ts) through the
// real adapters, http-kit, recorder and SqliteBudgetGuard. The run against the vendors is an operator step (WP13 Task 13.8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords, fixedClock } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { runSmoke, type SmokeCli, type SmokeResult } from '../../src/tools/smoke.js';
import { EXIT } from '../../src/tools/types.js';
import { buildPorts, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';
import { type SmokeVendorOptions, stubSmokeVendors } from '../helpers/smokeVendors.js';
import { onCleanup, tempRecordedRoot } from '../helpers/tmp.js';

/** The smoke's clock: a February day, so the query is the first nine days of March 2027. */
const NOW = asIsoDateTime('2027-02-10T09:00:00.000Z');
const LHR = asIata('LHR');
const JFK = asIata('JFK');
const TEST_SMOKE_BY = '@gmt/api smoke:live (test)';

function smokePorts(env: Record<string, string> = {}): Ports {
  const ports = buildPorts(loadConfigFromEnv(testEnv(env)), {
    log: silentLog,
    clock: fixedClock(NOW),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => ports.db.close());
  seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
  return ports;
}

const cli = (budget = 4, confirmRerun = false, origin = LHR, destination = JFK): SmokeCli => ({
  args: { origin, destination, budget },
  confirmRerun,
});

async function smoke(
  ports: Ports,
  c: SmokeCli = cli(),
  vendors: SmokeVendorOptions = {},
): Promise<{ r: SmokeResult; root: string; urls: URL[] }> {
  const log = stubSmokeVendors(vendors);
  const { root } = tempRecordedRoot();
  const r = await runSmoke(ports, c, {
    signal: new AbortController().signal,
    fixtures: { root, recordedBy: TEST_SMOKE_BY },
  });
  return { r, root, urls: log.urls };
}

const status = (r: SmokeResult) => Object.fromEntries(r.checks.map((c) => [c.name, c.status]));

describe('runSmoke (spec §9 item 7)', () => {
  it('exits 0 with provenance: one tile per provider, one chain, every check passed, dated fixtures outside the recorded tree', async () => {
    const ports = smokePorts();
    const { r, root, urls } = await smoke(ports);

    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.reports.map((p) => [p.providerId, p.stage, p.status])).toEqual([
      ['travelpayouts', 'discovery', 'priced'],
      ['searchapi', 'discovery', 'priced'],
      ['searchapi', 'itinerary', 'priced'],
    ]);
    expect(status(r)).toEqual({
      'one tile per provider': 'pass',
      ledger: 'pass',
      provenance: 'pass',
      'age labels': 'look',
      'metro rule': 'pass',
      'open-jaw drop': 'pass',
      '9-day rectangle': 'pass',
      'step 1 = step 2': 'pass',
      sellers: 'pass',
      'separate tickets excluded': 'look',
    });
    // why: Travelpayouts' £412 row is the cheapest calendar price; the £377 row was open-jaw and dropped (decision 39)
    expect(r.summary).toBe(
      'cheapest found £412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched just now · observed 10d ago',
    );
    expect(r.lines).toContain(r.summary);
    expect(r.lines.some((l) => l.includes('1 cell(s) had open-jaw rows dropped'))).toBe(true);
    expect(r.lines.some((l) => l.includes('£603 at step 1, £603 at step 2'))).toBe(true);
    // one Travelpayouts page, one calendar rectangle, step 1, step 2, step 3: five requests, five dated files
    expect(urls).toHaveLength(5);
    expect(r.fixturesWritten).toHaveLength(5);
    expect(r.fixturesWritten.every((f) => /^(travelpayouts|searchapi)\//.test(f))).toBe(true);
    const counts = ports.repos.ledger.countsFor(r.executionId ?? '');
    expect(counts.perProvider.map((p) => [p.providerId, p.stage, p.tiles, p.calls, p.cacheHits])).toEqual([
      ['searchapi', 'discovery', 1, 1, 0],
      ['searchapi', 'verification', 0, 3, 0],
      ['travelpayouts', 'discovery', 1, 1, 0],
    ]);
    const ex = ports.repos.executions.get(r.executionId ?? '');
    expect([ex?.trigger, ex?.status, ex?.errorText]).toEqual(['tool', 'completed', null]);
    const everything = [
      ...r.lines,
      ...r.fixturesWritten.map((f) => readFileSync(join(root, f), 'utf8')),
    ].join('\n');
    for (const s of [SENTINEL_SA, SENTINEL_TP]) expect(everything).not.toContain(s);
    for (const l of r.lines) expect(findBannedWords(l, BANNED_WORD_ALLOWLIST), l).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts`
Expected: FAIL: the import `../../src/tools/smoke.js` cannot be resolved.

- [ ] **Step 3: Implement the contract and the shared spend helpers**

`packages/core/src/api-contract/system.ts`: replace `toolSmokeRequestSchema` (the budget mirrors `toolRecordRequestSchema`'s, plan decision 20; §13 item 2):

```ts
/**
 * Spec §9 item 7, §10 `/tools/smoke`: the smoke's two airports and, as for recording, the SearchApi credits tool runs
 * may have ledgered in the provider's budget window including this run (plan decision 20; WP13).
 */
export const toolSmokeRequestSchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  budget: z.number().int().min(1),
});
```

`apps/api/src/tools/types.ts`: the `EXIT` doc comment and table gain the smoke's codes:

```ts
/**
 * The plan's single exit-code table for every CLI. 1 = a required recording call did not return its expected status, a
 * smoke provider errored or a smoke check failed, or the run failed. 2 = smoke: no provider configured, nothing sent. 3
 * = smoke: no error, but a tile held no price. 70 = refused under NODE_ENV=test or while the synthetic gate is open. 65
 * = a tool run refused for spend: credits already ledgered to earlier tool runs plus this run's worst case exceed
 * `--budget` without `--confirm-rerun` (plan decision 20), or a provider's budget window has less room than the run's
 * worst case (cost-wp4b-r2-001).
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  smokeNoProviders: 2,
  smokeEmpty: 3,
  usage: 64,
  spendRefused: 65,
  refusedTestEnv: 70,
  preflightImpossible: 73,
  backupFailed: 74,
  lockRefused: 75,
  badConfig: 78,
} as const;
```

and its `ToolName` comment reads `/** The two tools of spec §9 item 7. */`.

`apps/api/src/tools/recordExecution.ts`: replace `budgetPosition` with the shared `spendPosition` and a one-line `budgetPosition` over it. The SearchApi and Travelpayouts lines appear only for a configured provider (the smoke runs on either alone), and the two phrases that reach the tools' API bodies no longer say "live" (spec §11):

```ts
/**
 * Where a tool run stands against every spend limit before a live call (plan decision 20, cost-wp4b-r2-001): the
 * cross-run sum against `budget`, and each provider window's remaining room against the run's worst case. One rule for
 * both tools (`record:fixtures`, `smoke:live`; WP13). `windowRefusals` is empty when a live run may start;
 * `--confirm-rerun` lifts only the cross-run refusal, never a window that has no room.
 */
export function spendPosition(
  ports: Ports,
  worst: { credits: number; freeCalls: number },
  budget: number,
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const prior = priorToolCredits(ports);
  const rerunNeedsConfirm = prior + worst.credits > budget;
  const windowRefusals: string[] = [];
  const room = (cap: number | null, used: number): number | null => (cap === null ? null : cap - used);
  const lines = [
    `SearchApi credits already ledgered to tool runs in this budget window: ${prior}; this run ≤${worst.credits}; --budget ${budget}${rerunNeedsConfirm ? ' (a run that calls the vendors needs --confirm-rerun)' : ''}`,
  ];
  // why: a provider that is not configured has no budget lines (the smoke runs on either one alone; WP13)
  if (ports.config.providers.searchapi === null) lines.push('SearchApi: not configured');
  else {
    const sa = searchApiWindow(ports);
    const saRoom = room(sa.cap, sa.calls);
    if (saRoom !== null && saRoom < worst.credits)
      windowRefusals.push(
        `the SearchApi window has room for ${saRoom} credit(s) but this run may use ${worst.credits}`,
      );
    lines.push(
      `SearchApi window: ${sa.calls} of ${sa.cap ?? 'no cap'} used (compare with the dashboard); room ${saRoom ?? 'unlimited'}, this run ≤${worst.credits}`,
    );
  }
  if (ports.config.providers.travelpayouts === null) lines.push('Travelpayouts: not configured');
  else {
    const tp = ports.budget.usage({ kind: 'provider-month', providerId: 'travelpayouts' });
    const tpRoom = room(tp.cap, tp.calls);
    if (tpRoom !== null && tpRoom < worst.freeCalls)
      windowRefusals.push(
        `the Travelpayouts month has room for ${tpRoom} call(s) but this run may make ${worst.freeCalls}`,
      );
    lines.push(
      `Travelpayouts month: ${tp.calls} of ${tp.cap ?? 'no cap'} used; room ${tpRoom ?? 'unlimited'}, this run ≤${worst.freeCalls}`,
    );
  }
  // why: these lines reach the tools' API bodies, where spec §11 bans "live" (WP13)
  lines.push(...windowRefusals.map((r) => `a run that calls the vendors would be refused: ${r}`));
  return { lines, rerunNeedsConfirm, windowRefusals };
}

/** The record tool's position: its plan's worst case against `--budget` (plan decision 20). */
export function budgetPosition(
  ports: Ports,
  a: RecordArgs,
  plan: readonly PlannedCall[],
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const t = planTotals(plan);
  return spendPosition(ports, { credits: t.worstCaseCredits, freeCalls: t.worstCaseFreeCalls }, a.budget);
}
```

and move the transaction out of `openRecordingExecution` into the shared `openHiddenExecution` (the record tool's behaviour is unchanged; only the vanished-definition message says "tool"):

```ts
// the end of openRecordingExecution, after `const input: DefinitionInput = { … };`
  return openHiddenExecution(
    ports,
    input,
    {
      origins: a.origins,
      destinations: a.destinations,
      departureFrom: from,
      departureTo: to,
      minNights: RECORD_MIN_NIGHTS,
      maxNights: RECORD_MAX_NIGHTS,
    },
    planEstimate(plan, sa.limits.costPerCallMicroGbp),
  );
}

/**
 * A tool run's hidden execution (plan decision 5): the definition is created and soft-deleted in one transaction, the
 * snapshot is built from the deleted row (prov-wp04b-009), and the execution carries the run's caps in its snapshot
 * budget, which the guard reads before every attempt. Shared by `record:fixtures` and `smoke:live` (WP13). Spec §8.1
 * never resumes or schedules a deleted definition.
 */
export function openHiddenExecution(
  ports: Ports,
  input: DefinitionInput,
  resolved: DefinitionSnapshot['resolved'],
  estimate: Estimate | null,
): string {
  const def = ports.db.immediateTransaction(() => {
    const created = ports.repos.definitions.create(input);
    ports.repos.definitions.softDelete(created.id);
    const deleted = ports.repos.definitions.get(created.id);
    if (deleted === null) throw new Error('hidden tool definition vanished');
    return deleted;
  });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved,
    resolvedAt: ports.clock.now(),
    windowClamped: false,
    droppedAlwaysInclude: [],
  };
  return ports.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot,
    estimate,
    trigger: 'tool',
    status: 'running',
  }).id;
}
```

`apps/api/test/bootstrap/tool.test.ts`: the two record cases that quote those lines change with them:

```ts
    expect(again.text()).toContain('(a run that calls the vendors needs --confirm-rerun)');
```

```ts
      'a run that calls the vendors would be refused: the SearchApi window has room for 3 credit(s) but this run may use 5',
```

- [ ] **Step 4: Implement the smoke**

`apps/api/src/tools/smoke.ts`:

```ts
/**
 * `pnpm smoke:live` and `POST /api/tools/smoke` (spec §9 item 7, §10, §13; plan "Wiring and bootstraps", decisions 20,
 * 23, 27, 29, 34, 35, 39, 61, 62). One small, ledgered run against the operator's real keys: one discovery tile per
 * configured provider (a query sized so `plan()` yields one tile each), then one SearchApi itinerary chain for the
 * cheapest SearchApi cell, through the real adapters, a dedicated http-kit with no response cache (the vendor must
 * answer today) and the production SqliteBudgetGuard. Spend follows the recording rules exactly: the run's worst case
 * is stated up front, the cross-run and window checks of `spendPosition` refuse with 65 before any request, and the
 * hidden tool execution's snapshot caps make the guard refuse any reservation beyond that worst case, before the fetch.
 * The result is a checklist of provenance and honesty checks the operator reads beside the vendors' own pages.
 *
 * Fixtures: a command-line run writes dated recordings beside the database (`<data dir>/smoke/fixtures/recorded`),
 * never into the repository's recorded tree (decision 61: vendor responses are local-only); a run inside the app
 * process (the route) writes none and says so.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  AbortedError,
  addDays,
  BudgetExceeded,
  type Cabin,
  type CellKey,
  type Config,
  type DefinitionInput,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  daysBetween,
  effectiveAge,
  type FlightProvider,
  formatAgeFull,
  formatPence,
  type Iata,
  type IsoDate,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  iataSchema,
  monthOf,
  type Provenance,
  ProviderError,
  provenanceSchema,
  type ResponseCache,
  type TilePlan,
} from '@gmt/core';
import {
  createHttpKit,
  createRecorder,
  defaultRecordedRoot,
  type FixtureRecorder,
  type HttpKit,
  type HttpKitDeps,
  type HttpKitRequest,
} from '@gmt/providers';
import { majorToMinor } from '@gmt/providers/recording';
import { safeMessage } from '../safeMessage.js';
import { httpLimitsFor, type Ports, providersFor } from '../wiring.js';
import { openHiddenExecution, spendPosition } from './recordExecution.js';
import {
  CALENDAR_OUT_DAYS,
  firstDayOf,
  monthAfter,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  TP_MAX_PAGES_PER_TILE,
} from './recordPlan.js';
import { cheapestOption } from './recordRequests.js';
import { EXIT, type ToolContext } from './types.js';

/** The recordedBy signature on every file a command-line smoke writes (spec §5.5). */
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
/** Outbounds the chain expands: one, so the chain is step 1, one step 2 and one step 3 (spec §5.4). */
export const SMOKE_EXPAND_TOP = 1;
/**
 * Departure days of the smoke query: the production SearchApi block for the 10–21-night band (9 × 20 = 180
 * combinations, plan decision 29), so the smoke is also WP5's "try a 9-day rectangle" row, and every day sits inside
 * one month, so Travelpayouts plans one month tile.
 */
export const SMOKE_DEPARTURE_DAYS = CALENDAR_OUT_DAYS;
export const SMOKE_CABIN: Cabin = 'economy';
export const SMOKE_USAGE =
  'usage: pnpm smoke:live --origin IATA --destination IATA --budget N [--confirm-rerun]';

// why: provider identifiers in a fixed order, never airports; the free provider first, so a broken setup is learned
// before any credit is spent (plan decision 23 orders the record tool's probes the same way).
const VENDORS = ['travelpayouts', 'searchapi'] as const;
type Vendor = (typeof VENDORS)[number];
// why: a cache hit is not a call; the smoke must show that the vendor answers today (spec §9 item 7).
const NO_CACHE: ResponseCache = { get: () => undefined, set: () => undefined };

export interface SmokeArgs {
  origin: Iata;
  destination: Iata;
  /** SearchApi credits tool runs may have ledgered in the provider's budget window, this run included (decision 20). */
  budget: number;
}
export interface SmokeCli {
  args: SmokeArgs;
  /** Lifts only the cross-run refusal, as for recording; never a window without room. */
  confirmRerun: boolean;
}
export type ParseSmokeResult = { ok: true; value: SmokeCli } | { ok: false; message: string };

/** One line of the checklist. `look`: shown for the operator to compare with the vendor's page; never fails the run. */
export interface SmokeCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'look';
  detail: string;
}
/** The cheapest price one source returned, in pence, with the provenance the engine would store with it. */
export interface SmokePrice {
  pricePence: number;
  cell: CellKey;
  nights: number;
  displayName: string;
  provenance: Provenance;
}
export interface SmokeProviderReport {
  providerId: Vendor;
  stage: 'discovery' | 'itinerary';
  status: 'priced' | 'empty' | 'error' | 'skipped';
  prices: number;
  cheapest: SmokePrice | null;
  detail: string;
}
export interface SmokeResult {
  exitCode: number;
  summary: string;
  lines: string[];
  checks: SmokeCheck[];
  reports: SmokeProviderReport[];
  /** Paths relative to the fixture root; always empty for a run inside the app process. */
  fixturesWritten: string[];
  executionId: string | null;
}

const isPositiveInt = (s: string): number | null => (/^[1-9]\d{0,5}$/.test(s) ? Number(s) : null);

/** `--origin X --destination Y --budget N [--confirm-rerun]` (`--flag=value` too). iataSchema upper-cases. */
export function parseSmokeArgs(argv: readonly string[]): ParseSmokeResult {
  const fail = (message: string): ParseSmokeResult => ({ ok: false, message: `${message}\n${SMOKE_USAGE}` });
  const flags = new Map<string, string>();
  let confirmRerun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // why: pnpm may forward its own separator
    if (a === undefined || !a.startsWith('--')) return fail(`unexpected argument ${String(a)}`);
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (name === 'confirm-rerun' && eq === -1) {
      confirmRerun = true;
      continue;
    }
    if (name !== 'origin' && name !== 'destination' && name !== 'budget')
      return fail(`unknown flag --${name}`);
    if (flags.has(name)) return fail(`--${name} is given twice`);
    const value = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
    if (value === undefined || value === '' || value.startsWith('--')) return fail(`--${name} needs a value`);
    flags.set(name, value);
    if (eq === -1) i++;
  }
  const origin = iataSchema.safeParse(flags.get('origin') ?? '');
  const destination = iataSchema.safeParse(flags.get('destination') ?? '');
  if (!origin.success || !destination.success)
    return fail('--origin and --destination are required: one three-letter airport code each');
  const budgetRaw = flags.get('budget');
  if (budgetRaw === undefined)
    return fail(
      '--budget is required: the SearchApi credits tool runs may use in this budget window (spec §9 item 7)',
    );
  const budget = isPositiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer');
  return {
    ok: true,
    value: { args: { origin: origin.data, destination: destination.data, budget }, confirmRerun },
  };
}

/**
 * The one-tile query: departures on the first `SMOKE_DEPARTURE_DAYS` days of next month, 10–21 nights, economy. Next
 * month's 1st is always after today and nine days from the 1st never cross a month end, so Travelpayouts plans one
 * month tile; SearchApi's block for this band is nine days, so it plans one 9 × 20 rectangle. `runSmoke` still checks
 * `plan().length === 1` for each provider before any request.
 */
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery {
  const departureFrom = firstDayOf(monthAfter(monthOf(today), 1));
  return {
    origin,
    destination,
    departureFrom,
    departureTo: addDays(departureFrom, SMOKE_DEPARTURE_DAYS - 1),
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: SMOKE_CABIN,
    currency: 'GBP',
  };
}

/**
 * The run's stated worst case, enforced by the guard through the hidden execution's caps: SearchApi one calendar tile
 * plus the chain's `1 + 2 × expandTop` (the adapter's own estimate rule, spec §5.4); Travelpayouts one month tile at the
 * page cap.
 */
export function smokeWorstCase(config: Config): { credits: number; freeCalls: number } {
  return {
    credits: config.providers.searchapi === null ? 0 : 1 + 1 + 2 * SMOKE_EXPAND_TOP,
    freeCalls: config.providers.travelpayouts === null ? 0 : TP_MAX_PAGES_PER_TILE,
  };
}

/**
 * Where a command-line smoke writes: `<dirname(DATABASE_PATH)>/smoke/fixtures/recorded` (the recorder requires the
 * `fixtures/recorded` suffix), refused when that lies inside the repository's recorded tree (decision 61). The data
 * directory is the operator's (gitignored `data/` on a checkout, the volume in a container), like the backups beside it.
 */
export function smokeFixtureTarget(
  databasePath: string,
  recordedTree: string = defaultRecordedRoot(),
): { root: string; recordedBy: string } | { refusal: string } {
  const root = join(dirname(resolve(databasePath)), 'smoke', 'fixtures', 'recorded');
  const tree = resolve(recordedTree);
  if (root === tree || root.startsWith(`${tree}${sep}`))
    return { refusal: `smoke fixtures would land in the recorded tree (${root}); move DATABASE_PATH` };
  return { root, recordedBy: SMOKE_RECORDED_BY };
}

/** The hidden tool execution whose snapshot budget is exactly the stated worst case (plan decision 5). */
function openSmokeExecution(
  ports: Ports,
  q: DiscoveryQuery,
  worst: { credits: number; freeCalls: number },
): string {
  const rate = ports.config.providers.searchapi?.limits.costPerCallMicroGbp ?? 0;
  const input: DefinitionInput = {
    name: `smoke:live ${ports.clock.now()} (hidden tool run)`,
    origins: [q.origin],
    destinations: [q.destination],
    window: { kind: 'absolute', from: q.departureFrom, to: q.departureTo },
    minNights: q.minNights,
    maxNights: q.maxNights,
    cabin: q.cabin,
    constraints: {},
    verification: {
      maxCells: 1,
      topN: 1,
      alwaysInclude: [],
      expandTop: SMOKE_EXPAND_TOP,
      bookingLinks: true,
    },
    budget: { maxCalls: worst.credits, maxFreeCalls: worst.freeCalls, maxCostMicroGbp: worst.credits * rate },
    providers: { discovery: [], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: ports.config.schedulerTimezone,
    enabled: false,
  };
  return openHiddenExecution(
    ports,
    input,
    {
      origins: [q.origin],
      destinations: [q.destination],
      departureFrom: q.departureFrom,
      departureTo: q.departureTo,
      minNights: q.minNights,
      maxNights: q.maxNights,
    },
    null,
  );
}

/** A provider failure as one URL-free, secret-free phrase; anything that is not a request result propagates. */
function describeFailure(e: unknown, ports: Ports): string | null {
  if (e instanceof BudgetExceeded) return `refused by the guard before the request: ${e.scope}`;
  if (e instanceof AbortedError) return 'aborted';
  if (e instanceof ProviderError)
    return `${e.kind}${e.reason === undefined ? '' : ` (${e.reason})`}: ${safeMessage(e, ports.secrets)}`;
  return null;
}

/** A vendor amount in pence with the provenance the engine would store (spec §3), or why it cannot be shown. */
function priceOf(
  provider: FlightProvider,
  info: { sourceKind: Provenance['sourceKind']; maxAgeHours: Provenance['maxAgeHours'] },
  p: { amountMinor: number; currency: string; providerObservedAt?: IsoDateTime } & CellKey,
  fetchedAt: IsoDateTime,
  pointOfSale: string,
): SmokePrice | string {
  // why: both adapters ask for GBP (spec §5.2); the smoke compares pence only and reports any other currency.
  if (p.currency.toUpperCase() !== 'GBP') return `price in ${p.currency}; the smoke compares GBP only`;
  const cell: CellKey = {
    origin: p.origin,
    destination: p.destination,
    departureDate: p.departureDate,
    returnDate: p.returnDate,
  };
  return {
    pricePence: p.amountMinor,
    cell,
    nights: daysBetween(cell.departureDate, cell.returnDate),
    displayName: provider.displayName,
    provenance: {
      providerId: provider.id,
      sourceKind: info.sourceKind,
      fetchedAt,
      ...(p.providerObservedAt === undefined ? {} : { providerObservedAt: p.providerObservedAt }),
      maxAgeHours: info.maxAgeHours,
      fx: { converted: false },
      pointOfSale,
      cabin: SMOKE_CABIN,
    },
  };
}

/** `£412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched just now · …` */
export function describePrice(p: SmokePrice, now: IsoDateTime): string {
  const c = p.cell;
  return `${formatPence(p.pricePence)} · ${c.origin}→${c.destination} ${c.departureDate}–${c.returnDate} (${p.nights}n) · ${p.displayName} · ${formatAgeFull(effectiveAge(p.provenance, now))}`;
}

type Tile = Extract<DiscoveryTileResult, { kind: 'tile' }>;
interface Discovery {
  report: SmokeProviderReport;
  plans: TilePlan[];
  tile: Tile | null;
}

/** One provider's one tile. A plan of any other length is reported and nothing is fetched. */
async function discover(
  ports: Ports,
  id: Vendor,
  provider: FlightProvider | undefined,
  q: DiscoveryQuery,
  ctx: { executionId: string; signal: AbortSignal; recordFixtures: boolean },
): Promise<Discovery> {
  const report = (status: SmokeProviderReport['status'], detail: string): SmokeProviderReport => ({
    providerId: id,
    stage: 'discovery',
    status,
    prices: 0,
    cheapest: null,
    detail,
  });
  const cap = provider?.discovery;
  if (provider === undefined || cap === undefined)
    return { report: report('error', 'configured but has no discovery capability'), plans: [], tile: null };
  const plans = cap.plan(q);
  const [first] = plans;
  if (plans.length !== 1 || first === undefined)
    return {
      report: report('error', `planned ${plans.length} tiles; the smoke query must plan exactly 1`),
      plans,
      tile: null,
    };
  let result: DiscoveryTileResult;
  try {
    result = await cap.fetchTile(first, q, ctx);
  } catch (e) {
    const why = describeFailure(e, ports);
    if (why === null) throw e;
    return { report: report('error', why), plans, tile: null };
  }
  if (result.kind === 'tile-error')
    return {
      report: report('error', describeFailure(result.error, ports) ?? 'tile error'),
      plans,
      tile: null,
    };
  const prices = [...result.prices].sort((a, b) => a.amountMinor - b.amountMinor);
  const [cheapestRaw] = prices;
  if (cheapestRaw === undefined)
    return {
      report: report(
        'empty',
        `no price in the tile (${result.noFares.length} cell(s) without fares, the rest without cached data)`,
      ),
      plans,
      tile: result,
    };
  const priced = priceOf(provider, cap.info, cheapestRaw, result.fetchedAt, result.pointOfSale);
  if (typeof priced === 'string') return { report: report('error', priced), plans, tile: result };
  return {
    report: { ...report('priced', ''), prices: prices.length, cheapest: priced },
    plans,
    tile: result,
  };
}

/** The SearchApi chain for the cheapest SearchApi cell (spec §5.4), expanding one outbound. */
async function chain(
  ports: Ports,
  provider: FlightProvider | undefined,
  cell: CellKey,
  ctx: { executionId: string; signal: AbortSignal; recordFixtures: boolean },
): Promise<{ report: SmokeProviderReport; result: ItinerarySearchResult | null }> {
  const report = (status: SmokeProviderReport['status'], detail: string): SmokeProviderReport => ({
    providerId: 'searchapi',
    stage: 'itinerary',
    status,
    prices: 0,
    cheapest: null,
    detail,
  });
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined)
    return { report: report('error', 'configured but has no itinerary capability'), result: null };
  const q: ItineraryQuery = {
    ...cell,
    cabin: SMOKE_CABIN,
    adults: 1,
    currency: 'GBP',
    expandTop: SMOKE_EXPAND_TOP,
    bookingLinks: true,
  };
  let result: ItinerarySearchResult;
  try {
    result = await cap.search(q, ctx);
  } catch (e) {
    const why = describeFailure(e, ports);
    if (why === null) throw e;
    return { report: report('error', why), result: null };
  }
  const offers = [...result.offers].sort((a, b) => a.amountMinor - b.amountMinor);
  const [best] = offers;
  if (best === undefined) return { report: report('empty', 'the chain returned no offer'), result };
  const priced = priceOf(
    provider,
    cap.info,
    { ...cell, amountMinor: best.amountMinor, currency: best.currency },
    result.fetchedAt,
    result.pointOfSale,
  );
  if (typeof priced === 'string') return { report: report('error', priced), result };
  return {
    report: {
      ...report('priced', result.partial ? 'partial: not every step answered' : ''),
      prices: offers.length,
      cheapest: { ...priced, displayName: `${provider.displayName}, sold by ${best.seller}` },
    },
    result,
  };
}

/** One response the smoke's http-kit returned, kept for the checklist (never written anywhere). */
interface Seen {
  providerId: HttpKitRequest['providerId'];
  url: URL;
  body: unknown;
}

/** Whole pence of a vendor GBP amount, or null (shared exact conversion, plan decision 24). */
const pence = (major: number | undefined): number | null =>
  major === undefined ? null : majorToMinor(major, 'GBP');

/** The checklist (spec §9 item 7; plan decisions 27, 29, 34, 35, 39). Each check reads only what this run saw. */
function checklist(
  ports: Ports,
  q: DiscoveryQuery,
  executionId: string,
  runStart: IsoDateTime,
  configured: readonly Vendor[],
  found: Map<Vendor, Discovery>,
  itinerary: { report: SmokeProviderReport; result: ItinerarySearchResult | null } | null,
  seen: readonly Seen[],
): SmokeCheck[] {
  const checks: SmokeCheck[] = [];
  const add = (name: string, status: SmokeCheck['status'], detail: string) =>
    checks.push({ name, status, detail });
  const tp = found.get('travelpayouts');
  const sa = found.get('searchapi');

  // 1. One tile per configured provider (spec §9 item 7).
  const planned = configured.map((id) => `${id} ${found.get(id)?.plans.length ?? 0}`);
  add(
    'one tile per provider',
    configured.every((id) => found.get(id)?.plans.length === 1) ? 'pass' : 'fail',
    planned.join(', '),
  );

  // 2. The ledger of this run's execution: one first-attempt tile per provider, no cache hit, the chain inside its
  // estimate, every billed call inside the stated worst case (spec §8.1 parity).
  const counts = ports.repos.ledger.countsFor(executionId);
  const line = (id: Vendor, stage: 'discovery' | 'verification') =>
    counts.perProvider.find((p) => p.providerId === id && p.stage === stage);
  const ledgerFaults: string[] = [];
  const ledgerParts: string[] = [];
  for (const id of configured) {
    const d = line(id, 'discovery');
    const fetched = found.get(id)?.plans.length === 1;
    ledgerParts.push(
      `${id} ${d?.tiles ?? 0} tile, ${d?.calls ?? 0} call(s), ${d?.cacheHits ?? 0} cache hit(s)`,
    );
    if (fetched && (d?.tiles !== 1 || d.cacheHits !== 0))
      ledgerFaults.push(`${id} discovery is not one fetched tile`);
  }
  const v = line('searchapi', 'verification');
  if (v !== undefined) {
    ledgerParts.push(`searchapi chain ${v.calls} call(s)`);
    if (v.calls > 1 + 2 * SMOKE_EXPAND_TOP) ledgerFaults.push('the chain exceeded its estimate');
  }
  const billed = counts.perProvider
    .filter((p) => p.providerId === 'searchapi')
    .reduce((n, p) => n + p.calls, 0);
  if (billed > smokeWorstCase(ports.config).credits)
    ledgerFaults.push('SearchApi calls exceeded the stated worst case');
  add('ledger', ledgerFaults.length === 0 ? 'pass' : 'fail', [...ledgerParts, ...ledgerFaults].join('; '));

  // 3. Provenance on every price shown (spec §3; Global Constraints: SearchApi point of sale = POINT_OF_SALE,
  // Travelpayouts 'unknown'; fetched during this run).
  const shown = [tp?.report, sa?.report, itinerary?.report].flatMap((r) =>
    r?.cheapest === null || r?.cheapest === undefined ? [] : [{ r, p: r.cheapest.provenance }],
  );
  const provFaults = shown.flatMap(({ r, p }) => {
    const out: string[] = [];
    if (!provenanceSchema.safeParse(p).success) out.push(`${r.providerId} ${r.stage}: provenance incomplete`);
    const pos = r.providerId === 'travelpayouts' ? 'unknown' : ports.config.pointOfSale;
    if (p.pointOfSale !== pos)
      out.push(`${r.providerId} ${r.stage}: point of sale ${p.pointOfSale}, expected ${pos}`);
    if (p.fetchedAt < runStart) out.push(`${r.providerId} ${r.stage}: fetched before this run`);
    return out;
  });
  add(
    'provenance',
    shown.length === 0 ? 'skip' : provFaults.length === 0 ? 'pass' : 'fail',
    shown.length === 0
      ? 'no price to check'
      : [
          ...shown.map(
            ({ r, p }) => `${r.providerId} ${r.stage} ${p.sourceKind}, point of sale ${p.pointOfSale}`,
          ),
          ...provFaults,
        ].join('; '),
  );

  // 4. Age labels, as the views print them (spec §3, §11; decisions 35, 44, 58): for the operator to compare.
  const now = ports.clock.now();
  add(
    'age labels',
    shown.length === 0 ? 'skip' : 'look',
    shown.length === 0
      ? 'no price to label'
      : shown
          .map(({ r, p }) => `${r.providerId} ${r.stage}: ${formatAgeFull(effectiveAge(p, now))}`)
          .join('; '),
  );

  // 5. Metro rule (decision 34).
  checks.push(
    metroRuleCheck(
      q,
      seen.filter((s) => s.providerId === 'travelpayouts').map((s) => s.url),
    ),
  );

  // 6. Open-jaw drop (decision 39): only closed round trips of the pair are priced; dropped rows are reported per cell.
  const tile = tp?.tile ?? null;
  if (tile === null) add('open-jaw drop', 'skip', 'no Travelpayouts tile');
  else {
    const open = tile.prices.filter((p) => p.origin !== q.origin || p.destination !== q.destination);
    const dropped = (tile.cellIssues ?? []).filter((i) => i.detail.includes('[open-jaw]')).length;
    add(
      'open-jaw drop',
      open.length === 0 ? 'pass' : 'fail',
      `${tile.prices.length} price(s), all ${q.origin}→${q.destination} and back${open.length === 0 ? '' : ` except ${open.length}`}; ${dropped} cell(s) had open-jaw rows dropped`,
    );
  }

  // 7. The production 9-day rectangle (WP5 smoke row; spec §2 fact 2): the vendor accepted 9 × 20 combinations.
  const rect = sa?.plans[0]?.request;
  if (sa === undefined || rect === undefined || rect.kind !== 'rectangle')
    add('9-day rectangle', 'skip', 'no SearchApi tile');
  else {
    const days = daysBetween(rect.departFrom, rect.departTo) + 1;
    const rets = daysBetween(rect.returnFrom, rect.returnTo) + 1;
    const accepted = sa.report.status === 'priced' || sa.report.status === 'empty';
    add(
      '9-day rectangle',
      days === SMOKE_DEPARTURE_DAYS && accepted ? 'pass' : 'fail',
      `${days} × ${rets} = ${days * rets} combinations, ${accepted ? 'accepted' : `not accepted (${sa.report.detail})`}`,
    );
  }

  // 8. Step 1 = step 2 (spec §5.4): the price Google shows for the cheapest outbound is the cheapest return's price.
  const flights = seen.filter(
    (s) => s.providerId === 'searchapi' && s.url.searchParams.get('engine') === 'google_flights',
  );
  const step1 = flights.find(
    (s) => !s.url.searchParams.has('departure_token') && !s.url.searchParams.has('booking_token'),
  );
  const step2 = flights.find((s) => s.url.searchParams.has('departure_token'));
  const p1 = pence(cheapestOption(step1?.body, 'departure_token')?.price);
  const p2 = pence(cheapestOption(step2?.body, 'booking_token')?.price);
  if (p1 === null || p2 === null) add('step 1 = step 2', 'skip', 'the chain did not answer both steps');
  else
    add(
      'step 1 = step 2',
      p1 === p2 ? 'pass' : 'fail',
      `${formatPence(p1)} at step 1, ${formatPence(p2)} at step 2`,
    );

  // 9. Sellers (decisions 24, 27): every offer names the seller the vendor states; step 3 confirmed at least one.
  const offers = itinerary?.result?.offers ?? [];
  if (itinerary === null || itinerary.result === null) add('sellers', 'skip', 'no chain result');
  else {
    const named = offers.filter((o) => o.seller.trim() !== '');
    const confirmed = offers.filter((o) => o.verified).length;
    const noSeller = itinerary.result.notes.filter(
      (n) => n.startsWith('no-seller') || n.startsWith('no-airline'),
    );
    add(
      'sellers',
      offers.length > 0 && named.length === offers.length && confirmed > 0 ? 'pass' : 'fail',
      `${offers.length} offer(s) from ${[...new Set(named.map((o) => o.seller))].join(', ') || 'no seller'}; ${confirmed} confirmed by a seller listing${noSeller.length === 0 ? '' : `; dropped: ${noSeller.join(', ')}`}`,
    );
  }

  // 10. Separate tickets (decision 29; WP5 smoke row): every SearchApi request asks to exclude them; whether Google
  // honours it is compared by eye in the final pass.
  const saSeen = seen.filter((s) => s.providerId === 'searchapi');
  const excluded = saSeen.filter((s) => s.url.searchParams.get('separate_tickets') === '1').length;
  const splits = itinerary?.result?.notes.filter((n) => n.startsWith('split-booking-skipped')) ?? [];
  add(
    'separate tickets excluded',
    saSeen.length === 0 ? 'skip' : excluded === saSeen.length ? 'look' : 'fail',
    saSeen.length === 0
      ? 'no SearchApi request'
      : `separate_tickets=1 on ${excluded} of ${saSeen.length} SearchApi request(s); split bookings skipped: ${splits.join(', ') || 'none'}`,
  );
  return checks;
}

/**
 * Plan decision 34: every Travelpayouts request names the query's own airports, never a city code (a metro query
 * returns one cheapest row across every airport of the city, hiding the definition's own fare).
 */
export function metroRuleCheck(
  q: Pick<DiscoveryQuery, 'origin' | 'destination'>,
  urls: readonly URL[],
): SmokeCheck {
  const faults = urls.filter(
    (u) => u.searchParams.get('origin') !== q.origin || u.searchParams.get('destination') !== q.destination,
  );
  return {
    name: 'metro rule',
    status: urls.length === 0 ? 'skip' : faults.length === 0 ? 'pass' : 'fail',
    detail:
      urls.length === 0
        ? 'no Travelpayouts request'
        : `${urls.length} Travelpayouts request(s) sent ${q.origin}→${q.destination}${faults.length === 0 ? '' : `; ${faults.length} sent another code`}`,
  };
}

const MARK: Record<SmokeCheck['status'], string> = { pass: 'ok  ', fail: 'FAIL', skip: 'skip', look: 'look' };

/**
 * Spec §9 item 7. Never throws for a vendor failure: the exit code carries it (plan exit-code table: 0 every
 * configured provider priced and every check passed; 1 a provider error or a failed check; 2 zero providers; 3 no
 * error but a tile held no price; 64 bad airports; 65 spend refused). Anything else (SQLite, a recorder refusal)
 * cancels the hidden execution and propagates, as for recording.
 */
export async function runSmoke(
  ports: Ports,
  cli: SmokeCli,
  opts: { signal: AbortSignal; fixtures: { root: string; recordedBy: string } | null },
): Promise<SmokeResult> {
  const lines: string[] = [];
  const say = (l: string): void => {
    lines.push(safeMessage(l, ports.secrets));
  };
  const refuse = (exitCode: number, message: string): SmokeResult => {
    say(message);
    return {
      exitCode,
      summary: message,
      lines,
      checks: [],
      reports: [],
      fixturesWritten: [],
      executionId: null,
    };
  };

  const { origin, destination } = cli.args;
  if (origin === destination) return refuse(EXIT.usage, 'origin and destination must differ');
  for (const code of [origin, destination]) {
    if (ports.repos.airports.exists(code)) continue;
    const members = ports.repos.airports.airportsOfMetro(code);
    return refuse(
      EXIT.usage,
      members.length > 0
        ? `${code} is a city code; the smoke takes one airport (${members.join(', ')})`
        : `unknown airport ${code}: not in the airports table`,
    );
  }
  const configured = VENDORS.filter((v) => ports.config.providers[v] !== null);
  if (configured.length === 0)
    return refuse(EXIT.smokeNoProviders, 'no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY');

  const worst = smokeWorstCase(ports.config);
  const position = spendPosition(ports, worst, cli.args.budget);
  for (const l of position.lines) say(l);
  if (position.windowRefusals.length > 0)
    return refuse(
      EXIT.spendRefused,
      `refusing: ${position.windowRefusals.join('; ')} (never start what cannot finish)`,
    );
  if (position.rerunNeedsConfirm && !cli.confirmRerun)
    return refuse(
      EXIT.spendRefused,
      `refusing: credits already ledgered to earlier tool runs plus this run's worst case exceed --budget ${cli.args.budget}; raise --budget or pass --confirm-rerun (plan decision 20)`,
    );

  const written: string[] = [];
  let recorder: FixtureRecorder | null = null;
  if (opts.fixtures !== null) {
    mkdirSync(opts.fixtures.root, { recursive: true });
    const inner = createRecorder({
      root: opts.fixtures.root,
      secrets: ports.secrets,
      clock: ports.clock,
      recordedBy: opts.fixtures.recordedBy,
    });
    // why: FixtureRecorder.record resolves to the path it wrote, so fixturesWritten is exact
    recorder = {
      record: async (r) => {
        const p = await inner.record(r);
        written.push(p);
        return p;
      },
    };
  }
  const log = ports.log.child({ tool: 'smoke' });
  const seen: Seen[] = [];
  const all = httpLimitsFor(ports.config);
  // why: the two vendors only: the smoke never calls the fixture provider (a test database may have the synthetic gate
  // open; the bootstrap and the route refuse it for a real run) nor the FX host.
  const limits: HttpKitDeps['limits'] = {
    ...(all.travelpayouts === undefined ? {} : { travelpayouts: all.travelpayouts }),
    ...(all.searchapi === undefined ? {} : { searchapi: all.searchapi }),
  };
  const kit = createHttpKit({
    budget: ports.budget,
    cache: NO_CACHE,
    limits,
    clock: ports.clock,
    log,
    secrets: ports.secrets,
    syntheticAllowed: false,
    ...(recorder === null ? {} : { recorder }),
  });
  // why: the checklist reads what the vendors answered (step prices, request parameters) from this run only
  const http: HttpKit = {
    request: async (r) => {
      const res = await kit.request(r);
      seen.push({ providerId: r.providerId, url: r.url, body: res.body });
      return res;
    },
    stats: () => kit.stats(),
  };
  const providers = providersFor(ports.config, { http, log, clock: ports.clock }).filter((p) =>
    configured.some((id) => id === p.id),
  );
  const q = smokeQuery(ports.clock.todayLondon(), origin, destination);
  const runStart = ports.clock.now();
  const executionId = openSmokeExecution(ports, q, worst);
  const ctx = { executionId, signal: opts.signal, recordFixtures: recorder !== null };
  say(
    `smoke: ${origin}→${destination} departures ${q.departureFrom}–${q.departureTo}, ${q.minNights}–${q.maxNights} nights; one tile per provider${configured.includes('searchapi') ? ', then one SearchApi itinerary chain' : ''}`,
  );

  const found = new Map<Vendor, Discovery>();
  let itinerary: { report: SmokeProviderReport; result: ItinerarySearchResult | null } | null = null;
  try {
    for (const id of configured) {
      const d = await discover(
        ports,
        id,
        providers.find((p) => p.id === id),
        q,
        ctx,
      );
      found.set(id, d);
    }
    const saCell = found.get('searchapi')?.report.cheapest?.cell;
    if (saCell !== undefined && !opts.signal.aborted)
      itinerary = await chain(
        ports,
        providers.find((p) => p.id === 'searchapi'),
        saCell,
        ctx,
      );
    else if (configured.includes('searchapi'))
      // why: no priced calendar cell, so the chain has nothing to search; no credit is spent on it (cost I-1)
      itinerary = {
        report: {
          providerId: 'searchapi',
          stage: 'itinerary',
          status: 'skipped',
          prices: 0,
          cheapest: null,
          detail: 'no priced SearchApi calendar cell',
        },
        result: null,
      };
  } catch (e) {
    ports.repos.executions.setStatus(executionId, 'cancelled', {
      finishedAt: ports.clock.now(),
      errorText: `smoke:live failed: ${safeMessage(e, ports.secrets)}`,
    });
    throw e;
  }

  const reports = [...found.values()]
    .map((d) => d.report)
    .concat(itinerary === null ? [] : [itinerary.report]);
  const checks = checklist(ports, q, executionId, runStart, configured, found, itinerary, seen);
  const now = ports.clock.now();
  for (const r of reports)
    say(
      `${r.providerId} ${r.stage}: ${r.status}${r.prices > 0 ? ` · ${r.prices} price(s)` : ''}${r.cheapest === null ? '' : ` · cheapest ${describePrice(r.cheapest, now)}`}${r.detail === '' ? '' : ` · ${r.detail}`}`,
    );
  say('checklist:');
  for (const c of checks) say(`  [${MARK[c.status]}] ${c.name}: ${c.detail}`);

  const discovered = [...found.values()].flatMap((d) =>
    d.report.cheapest === null ? [] : [d.report.cheapest],
  );
  const cheapest = discovered.sort((a, b) => a.pricePence - b.pricePence)[0] ?? null;
  const summary = cheapest === null ? 'no price found' : `cheapest found ${describePrice(cheapest, now)}`;
  say(summary);
  say(
    opts.fixtures === null
      ? 'fixtures not written (app process)'
      : `fixtures written: ${written.length} under ${opts.fixtures.root} (local-only, never committed)`,
  );

  const failed =
    opts.signal.aborted ||
    reports.some((r) => r.status === 'error') ||
    checks.some((c) => c.status === 'fail');
  const exitCode = failed
    ? EXIT.failed
    : reports.some((r) => r.status === 'empty')
      ? EXIT.smokeEmpty
      : EXIT.ok;
  ports.repos.executions.setStatus(executionId, opts.signal.aborted ? 'cancelled' : 'completed', {
    finishedAt: now,
    errorText: exitCode === EXIT.ok ? null : `smoke:live exit ${exitCode}`,
  });
  const root = opts.fixtures?.root;
  return {
    exitCode,
    summary,
    lines,
    checks,
    reports,
    fixturesWritten: root === undefined ? [] : written.map((f) => relative(root, f)).sort(),
    executionId,
  };
}

/**
 * The `smoke` runner of the tool bootstrap (spec §9 item 7): runs the smoke with its fixtures beside the database and
 * prints every line; refusals go to stderr. Returns the exit code.
 */
export async function runSmokeTool(ports: Ports, cli: SmokeCli, ctx: ToolContext): Promise<number> {
  const r = await runSmoke(ports, cli, {
    signal: ctx.signal,
    fixtures: { root: ctx.recordedRoot, recordedBy: ctx.recordedBy },
  });
  const refused = r.executionId === null && r.exitCode !== EXIT.ok;
  for (const line of r.lines) (refused ? ctx.err : ctx.out)(line);
  return r.exitCode;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts test/bootstrap/tool.test.ts test/tools`
Expected: PASS. `smoke.test.ts` 1 test; every record test unchanged except the two quoted lines.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/api-contract/system.ts apps/api/src/tools apps/api/test && git commit -m "wp13: the smoke prints the cheapest price with provenance and a checklist from one ledgered tile per provider and one chain (spec §9 item 7)"
```

### Task 13.2: Exit codes 1, 2, 3, 64, 65 and the spend rules

**Files:**
- Modify: `apps/api/test/tools/smoke.test.ts`

**Interfaces:**
- Consumes: `runSmoke`, `stubSmokeVendors` (`failOn`, `step2Price`, `tpEmpty`), `EXIT`, `LedgerRepo.countsFor`.

- [ ] **Step 1: Write the tests**

Add inside `describe('runSmoke (spec §9 item 7)', …)`, after the first case:

```ts
  it('2: no provider configured, nothing sent, no execution', async () => {
    const ports = smokePorts({ TRAVELPAYOUTS_TOKEN: '', SEARCHAPI_KEY: '' });
    const { r, urls } = await smoke(ports);
    expect(r.exitCode).toBe(EXIT.smokeNoProviders);
    expect(r.lines).toEqual(['no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY']);
    expect([urls, r.executionId]).toEqual([[], null]);
  });

  it.each([
    ['LON', 'JFK', 'LON is a city code; the smoke takes one airport'],
    ['QQQ', 'JFK', 'unknown airport QQQ'],
    ['LHR', 'LHR', 'origin and destination must differ'],
  ])('64: %s→%s is refused before anything is sent', async (o, d, message) => {
    const ports = smokePorts();
    const { r, urls } = await smoke(ports, cli(4, false, asIata(o), asIata(d)));
    expect(r.exitCode).toBe(EXIT.usage);
    expect(r.summary).toContain(message);
    expect(urls).toEqual([]);
  });

  it('65: the same cross-run rule as recording; --confirm-rerun lifts it, a higher --budget too', async () => {
    const ports = smokePorts();
    const short = await smoke(ports, cli(3));
    expect(short.r.exitCode).toBe(EXIT.spendRefused);
    expect(short.urls).toEqual([]);
    expect((await smoke(ports, cli(4))).r.exitCode).toBe(EXIT.ok);
    // why: the first run ledgered 4 credits to a tool execution; 4 + 4 > 4
    const again = await smoke(ports, cli(4));
    expect(again.r.exitCode).toBe(EXIT.spendRefused);
    expect(again.r.summary).toContain('pass --confirm-rerun');
    // why: the route returns these lines in its body, so spec §11's banned words apply to them too
    for (const l of again.r.lines) expect(findBannedWords(l, BANNED_WORD_ALLOWLIST), l).toEqual([]);
    expect((await smoke(ports, cli(4, true))).r.exitCode).toBe(EXIT.ok);
    expect((await smoke(ports, cli(12))).r.exitCode).toBe(EXIT.ok);
  });

  it('65: a SearchApi window with less room than the worst case refuses even with --confirm-rerun', async () => {
    const ports = smokePorts({ SEARCHAPI_PLAN: 'trial', SEARCHAPI_TRIAL_USED: '97' });
    const { r, urls } = await smoke(ports, cli(4, true));
    expect(r.exitCode).toBe(EXIT.spendRefused);
    expect(r.summary).toContain('the SearchApi window has room for');
    expect(urls).toEqual([]);
  });

  it('1: a SearchApi 401 is an error; Travelpayouts still prices and no chain credit is spent', async () => {
    const ports = smokePorts();
    const { r } = await smoke(ports, cli(), {
      failOn: (u) =>
        u.hostname === 'www.searchapi.io' ? { status: 401, body: { error: 'Invalid API key.' } } : undefined,
    });
    expect(r.exitCode).toBe(EXIT.failed);
    expect(r.reports.map((p) => [p.providerId, p.stage, p.status])).toEqual([
      ['travelpayouts', 'discovery', 'priced'],
      ['searchapi', 'discovery', 'error'],
      ['searchapi', 'itinerary', 'skipped'],
    ]);
    expect(r.reports[1]?.detail).toMatch(/^auth/);
    const sa = ports.repos.ledger
      .countsFor(r.executionId ?? '')
      .perProvider.filter((p) => p.providerId === 'searchapi');
    expect(sa.map((p) => [p.stage, p.calls])).toEqual([['discovery', 1]]);
    expect(r.summary.startsWith('cheapest found £412')).toBe(true);
  });

  it('1: step 2 showing another price than step 1 fails the check', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step2Price: 610 });
    expect(r.exitCode).toBe(EXIT.failed);
    expect(status(r)['step 1 = step 2']).toBe('fail');
    expect(r.lines.some((l) => l.includes('£603 at step 1, £610 at step 2'))).toBe(true);
  });

  it('3: no error, but the Travelpayouts tile held no price (Travelpayouts only: no credit)', async () => {
    const ports = smokePorts({ SEARCHAPI_KEY: '' });
    const { r, urls } = await smoke(ports, cli(1), { tpEmpty: true });
    expect(r.exitCode).toBe(EXIT.smokeEmpty);
    expect(r.reports.map((p) => p.status)).toEqual(['empty']);
    expect(r.summary).toBe('no price found');
    expect(urls.map((u) => u.hostname)).toEqual(['api.travelpayouts.com']);
  });
```

- [ ] **Step 2: Run, and prove the assertions bite**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts`
Expected: PASS, 10 tests (Task 13.1 already implements this behaviour; this is a characterisation run). Prove it bites: in `smokeWorstCase` change `1 + 1 + 2 * SMOKE_EXPAND_TOP` to `1 + 2 * SMOKE_EXPAND_TOP`. Expected: FAIL in three cases: the first ("expected 1 to be +0": the guard now refuses the chain's third call, so no seller listing confirms a price) and both 65 cases ("expected 1 to be 65"). Restore it.

- [ ] **Step 3: Implement**

No new code unless a case fails; fix `smoke.ts`, never the test.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/tools/smoke.test.ts && git commit -m "wp13: smoke exit codes and the recording spend rules (spec §9 item 7, plan decision 20)"
```

### Task 13.3: Arguments, the one-tile query, the fixture target and the metro check

**Files:**
- Create: `apps/api/test/tools/smokeArgs.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `parseSmokeArgs`, `smokeQuery`, `smokeFixtureTarget`, `metroRuleCheck`, `defaultRecordedRoot`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/tools/smokeArgs.test.ts`:

```ts
// Spec §9 item 7: the smoke's arguments, its one-tile query, its fixture target and the metro-rule check.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIata, asIsoDate } from '@gmt/core';
import { defaultRecordedRoot } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import {
  metroRuleCheck,
  parseSmokeArgs,
  SMOKE_RECORDED_BY,
  smokeFixtureTarget,
  smokeQuery,
} from '../../src/tools/smoke.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

describe('parseSmokeArgs', () => {
  it('reads both flag forms, upper-cases the airports and takes --confirm-rerun', () => {
    expect(
      parseSmokeArgs(['--origin', 'lhr', '--destination=JFK', '--budget', '8', '--confirm-rerun']),
    ).toEqual({
      ok: true,
      value: { args: { origin: 'LHR', destination: 'JFK', budget: 8 }, confirmRerun: true },
    });
  });
  it.each([
    [[], '--origin and --destination are required'],
    [['--origin', 'LHR', '--budget', '4'], '--origin and --destination are required'],
    [['--origin', 'L1R', '--destination', 'JFK', '--budget', '4'], '--origin and --destination are required'],
    [['--origin', 'LHR', '--destination', 'JFK'], '--budget is required'],
    [['--origin', 'LHR', '--destination', 'JFK', '--budget', '0'], '--budget must be a positive integer'],
    [['--origin', 'LHR', '--origin', 'LGW'], '--origin is given twice'],
    [['--month', '2027-03'], 'unknown flag --month'],
    [['LHR'], 'unexpected argument LHR'],
    [['--origin'], '--origin needs a value'],
  ])('refuses %j with a usage line', (argv, message) => {
    const r = parseSmokeArgs(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain(message);
      expect(r.message).toContain('usage: pnpm smoke:live');
    }
  });
});

describe('smokeQuery: one Travelpayouts month tile and one 9 × 20 SearchApi rectangle', () => {
  it.each([
    ['2026-10-14', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-01-31', '2028-02-01'],
    ['2026-11-01', '2026-12-01'],
  ])('today %s → departures from %s, nine days inside one month, 10–21 nights', (today, from) => {
    const q = smokeQuery(asIsoDate(today), asIata('LHR'), asIata('JFK'));
    expect(q.departureFrom).toBe(from);
    expect(q.departureTo).toBe(`${from.slice(0, 8)}09`);
    expect([q.minNights, q.maxNights, q.cabin, q.currency]).toEqual([10, 21, 'economy', 'GBP']);
  });
});

describe('smokeFixtureTarget (plan decision 61)', () => {
  it('writes beside the database under the smoke signature', () => {
    expect(smokeFixtureTarget('/srv/data/app.db', '/repo/packages/providers/fixtures/recorded')).toEqual({
      root: '/srv/data/smoke/fixtures/recorded',
      recordedBy: SMOKE_RECORDED_BY,
    });
  });
  it('never inside the repository recorded tree', () => {
    const r = smokeFixtureTarget(join(defaultRecordedRoot(), 'searchapi', 'dev.db'));
    expect('refusal' in r && r.refusal).toContain('would land in the recorded tree');
  });
});

describe('metroRuleCheck (plan decision 34)', () => {
  const q = { origin: asIata('LHR'), destination: asIata('JFK') };
  const url = (o: string) =>
    new URL(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${o}&destination=JFK`);
  it('passes when every request names the airports, fails on a city code (positive control), skips on none', () => {
    expect(metroRuleCheck(q, [url('LHR')]).status).toBe('pass');
    expect(metroRuleCheck(q, [url('LHR'), url('LON')])).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('1 sent another code'),
    });
    expect(metroRuleCheck(q, []).status).toBe('skip');
  });
});

describe('smoke recordings stay out of git wherever the database lives (plan decision 61)', () => {
  it.each([
    'data/smoke/fixtures/recorded/searchapi/_api_v1_search/2027-02-10-0123456789ab.json',
    'smoke/fixtures/recorded/travelpayouts/_aviasales_v3_prices_for_dates/2027-02-10-0123456789ab.json',
  ])('%s is ignored', (p) => {
    expect(spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO }).status).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smokeArgs.test.ts`
Expected: FAIL in one case, `smoke/fixtures/recorded/travelpayouts/_aviasales_v3_prices_for_dates/2027-02-10-0123456789ab.json is ignored` ("expected 1 to be 0"): a database outside `data/` would leave the smoke's recordings trackable. The other 18 pass (Task 13.1).

- [ ] **Step 3: Implement**

`.gitignore`, before the decision-61 block:

```gitignore
# why: smoke:live writes its dated recordings beside the database (<data dir>/smoke/fixtures/recorded, WP13); wherever
# DATABASE_PATH points inside a checkout, those vendor responses stay out of git (plan decision 61)
**/smoke/fixtures/recorded/**
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smokeArgs.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add .gitignore apps/api/test/tools/smokeArgs.test.ts && git commit -m "wp13: smoke arguments, one-tile query, fixtures beside the database and out of git (decision 61)"
```

### Task 13.4: `pnpm smoke:live` through the tool bootstrap, and a spawned smoke starts no execution

**Files:**
- Modify: `apps/api/src/bootstrap/tool.ts`, `apps/api/test/bootstrap/tool.test.ts`, `apps/api/test/bootstrap/tool.spawn.test.ts`

**Interfaces:**
- Consumes: `runTool`, `parseSmokeArgs`, `smokeFixtureTarget`, `runSmokeTool`, `stubSmokeVendors`, `createRepos`, `AppLock.inspect`.
- Produces: `ToolRunners.smoke`; `runTool('smoke', argv)`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/bootstrap/tool.test.ts`: import `stubSmokeVendors` from `'../helpers/smokeVendors.js'`; replace the case `refuses smoke (WP13) and a missing budget with the usage code` with:

```ts
  it('refuses a smoke without its airports and a recording without a budget with the usage code', async () => {
    const h = harness();
    expect(await runTool('smoke', [], h.opts)).toBe(EXIT.usage);
    expect(h.errors()).toContain('--origin and --destination are required');
    expect(await runTool('record', ['--route', 'LHR:JFK', '--month', '2027-03'], h.opts)).toBe(EXIT.usage);
    expect(h.errors()).toContain('--budget is required');
  });
```

and add to `describe('runTool success paths', …)`:

```ts
  it('smoke: the same bootstrap (lock, seed, release); one tile per provider and one chain; exit 0; fixtures in the given tree under its signature (WP13)', async () => {
    const h = harness();
    const seen = stubSmokeVendors();
    expect(await runTool('smoke', ['--origin', 'LHR', '--destination', 'JFK', '--budget', '4'], h.opts)).toBe(
      EXIT.ok,
    );
    const text = h.text();
    expect(text.indexOf('tool lock acquired')).toBeLessThan(text.indexOf('checklist:'));
    expect(text.indexOf('checklist:')).toBeLessThan(text.indexOf('tool lock released'));
    expect(text).toMatch(/^cheapest found £412 · LHR→JFK /m);
    expect(text).not.toMatch(/\[FAIL\]/);
    expect(seen.urls).toHaveLength(5);
    // why: the recorder writes each redacted recording with its raw body beside it (*.raw.json, gitignored everywhere)
    const files = filesUnder(h.root).filter((f) => !f.endsWith('.raw.json'));
    expect(files).toHaveLength(5);
    for (const f of files)
      expect(JSON.parse(readFileSync(f, 'utf8'))).toMatchObject({ recordedBy: TEST_RECORDED_BY });
    expect(
      count(
        h.dbPath,
        "SELECT COUNT(*) AS n FROM search_executions WHERE trigger = 'tool' AND status = 'completed'",
      ),
    ).toEqual({ n: 1 });
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM app_lock')).toEqual({ n: 0 });
    expect(`${text}${h.errors()}`).not.toContain(SENTINEL_SA);
  });

  it('smoke refusals go to stderr with their codes: zero providers 2, spend 65 (WP13)', async () => {
    const none = harness(undefined, { TRAVELPAYOUTS_TOKEN: '', SEARCHAPI_KEY: '' });
    expect(
      await runTool('smoke', ['--origin', 'LHR', '--destination', 'JFK', '--budget', '4'], none.opts),
    ).toBe(EXIT.smokeNoProviders);
    expect(none.errors()).toContain('no provider configured');
    const short = harness();
    stubSmokeVendors();
    expect(
      await runTool('smoke', ['--origin', 'LHR', '--destination', 'JFK', '--budget', '3'], short.opts),
    ).toBe(EXIT.spendRefused);
    expect(short.errors()).toContain('exceed --budget 3');
  });
```

`apps/api/test/bootstrap/tool.spawn.test.ts`: import `asIata`, `asIsoDate` from `@gmt/core` and `createRepos` from `@gmt/db`, and add before `a stale app lock is taken over`:

```ts
  it('the smoke entry starts no execution: the boot sweep, auto-resume and cron never run, nothing is sent, the lock is released (spec §7; WP13)', () => {
    const dbPath = freshDbPath();
    const db = openDatabase(dbPath);
    applyMigrations(db, MIGRATIONS_DIR);
    const repos = createRepos(db, systemClock, { allowSynthetic: false });
    // why: an enabled scheduled definition and an interrupted execution give every boot step something to act on
    const def = repos.definitions.create({
      name: 'spawn lock test',
      origins: [asIata('LHR')],
      destinations: [asIata('JFK')],
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 30 },
      minNights: 10,
      maxNights: 12,
      cabin: 'economy',
      constraints: {},
      verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
      budget: { maxCalls: 0, maxFreeCalls: 10, maxCostMicroGbp: 0 },
      providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} },
      destinationNotes: {},
      onwardCostPence: {},
      scheduleCron: '0 5 * * 1',
      scheduleTz: 'Europe/London',
      enabled: true,
    });
    const day = asIsoDate(def.createdAt.slice(0, 10));
    const ex = repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: {
        ...def,
        resolved: {
          origins: def.origins,
          destinations: def.destinations,
          departureFrom: day,
          departureTo: day,
          minNights: 10,
          maxNights: 12,
        },
        resolvedAt: def.createdAt,
        windowClamped: false,
        droppedAlwaysInclude: [],
      },
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    repos.executions.setStatus(ex.id, 'interrupted');
    db.close();
    // why: zero providers (exit 2) keeps the child off the network entirely; the bootstrap steps are the same
    const r = spawnSync(
      process.execPath,
      [
        ...NODE_ARGS,
        '--import',
        'tsx',
        'src/bootstrap/tool.ts',
        'smoke',
        '--origin',
        'LHR',
        '--destination',
        'JFK',
        '--budget',
        '4',
      ],
      {
        cwd: API_ROOT,
        env: {
          PATH: process.env.PATH ?? '',
          ...toolEnv(dbPath, { TRAVELPAYOUTS_TOKEN: '', SEARCHAPI_KEY: '', AUTO_RESUME: 'true' }),
        },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(r.stderr).toContain('no provider configured');
    expect(r.status).toBe(2);
    expect(r.stdout.indexOf('tool lock acquired')).toBeLessThan(r.stdout.indexOf('tool lock released'));
    const after = openDatabase(dbPath);
    expect(
      after.raw.prepare('SELECT id, status, auto_resume_count AS n FROM search_executions').all(),
    ).toEqual([{ id: ex.id, status: 'interrupted', n: 0 }]);
    expect(after.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get()).toEqual({ n: 0 });
    expect(AppLock.inspect(after)).toBeNull();
    after.close();
  }, 60_000);
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap/tool.test.ts test/bootstrap/tool.spawn.test.ts -t smoke`
Expected: FAIL, 4 tests: stderr says `smoke:live is not built yet; WP13 adds it` and the exit code is 64 where 0, 2 or 65 is expected.

- [ ] **Step 3: Implement**

`apps/api/src/bootstrap/tool.ts`: import `parseSmokeArgs`, `runSmokeTool`, `type SmokeCli`, `smokeFixtureTarget` from `'../tools/smoke.js'`; the runners gain `smoke`:

```ts
/** The tool runners runTool's switch dispatches to; tests replace them (ts-003). */
export interface ToolRunners {
  record(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number>;
  smoke(ports: Ports, cli: SmokeCli, ctx: ToolContext): Promise<number>;
}
const DEFAULT_RUNNERS: ToolRunners = { record: runRecord, smoke: runSmokeTool };
```

and `prepare`'s `smoke` case replaces the refusal:

```ts
    case 'smoke': {
      const parsed = parseSmokeArgs(argv);
      if (!parsed.ok) {
        err(parsed.message);
        return { ok: false, code: EXIT.usage };
      }
      // why: dated smoke fixtures go beside the database, never into the recorded tree (plan decision 61); tests pass
      // their own temporary target, as for recording
      const target = given ?? smokeFixtureTarget(config.databasePath);
      if ('refusal' in target) {
        err(target.refusal);
        return { ok: false, code: EXIT.usage };
      }
      // why: no configuration precheck: zero providers is the smoke's own exit 2, reported by runSmoke (spec §9 item 7)
      return {
        ok: true,
        precheck: null,
        target,
        run: (ports, ctx) => runners.smoke(ports, parsed.value, ctx),
      };
    }
```

Everything else in `runTool` is the record tool's path unchanged: the smoke gets the NODE_ENV and synthetic-gate refusals, the data-directory check, the read-only lock probe, the pre-migration backup, the tool lock with heartbeat, seeding, and the release on every path.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap`
Expected: PASS; the four new or changed smoke cases among them.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/tool.ts apps/api/test/bootstrap && git commit -m "wp13: pnpm smoke:live through the tool bootstrap; a spawned smoke starts no execution (spec §7, §9 item 7)"
```

### Task 13.5: Mount `POST /api/tools/smoke`

**Files:**
- Create: `apps/api/test/routes/toolsSmoke.test.ts`
- Modify: `apps/api/src/routes/types.ts`, `apps/api/src/routes/tools.ts`, `apps/api/src/tools/inProcess.ts`, `apps/api/src/text.ts`, `apps/api/test/routes/tools.test.ts`, `apps/api/test/routes/contract-sweep.test.ts`

**Interfaces:**
- Consumes: `route`, `NO_INPUT`, `oneAtATime`, `ApiError`, `API_TEXT`, `safeMessage`, `runSmoke`, `createHarness`, `expectContract`, `errorOf`.
- Produces: `HttpToolRunners.smoke`, `ToolSmokeRequest`, the `'POST /api/tools/smoke'` handler, `API_TEXT.smokeSynthetic`, an empty `OWNED_ELSEWHERE`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/routes/toolsSmoke.test.ts`:

```ts
// Spec §10 `POST /api/tools/smoke`, §13 (the operator calls it from the host with curl; the image has no curl): the
// smoke inside the app process, which holds app_lock. Mounted by WP13 (plan decision 4).
import { join } from 'node:path';
import { apiContract } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunResponse } from '../../src/routes/types.js';
import { OWNED_ELSEWHERE } from '../../src/routes/types.js';
import { inProcessTools } from '../../src/tools/inProcess.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_TP, silentLog } from '../helpers/env.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { stubSmokeVendors } from '../helpers/smokeVendors.js';
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
const body = { origin: 'LHR', destination: 'JFK', budget: 4 };
const ok: ToolRunResponse = { exitCode: 0, summary: 'cheapest found £1', lines: ['x'], fixturesWritten: [] };

describe('POST /api/tools/smoke (spec §10, §13)', () => {
  it('is mounted here: no ROUTES entry is owned elsewhere any more', () => {
    expect([...OWNED_ELSEWHERE]).toEqual([]);
  });

  it('requires auth; 503 when the runner is not registered', async () => {
    const x = await harness();
    expect((await x.request('/api/tools/smoke', { method: 'POST', json: body, auth: false })).status).toBe(
      401,
    );
    const res = await x.request('/api/tools/smoke', { method: 'POST', json: body });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('tool_unavailable');
  });

  it('validates the body, then runs the runner with the upper-cased airports and answers the contract', async () => {
    const smoke = vi.fn(async (_args: unknown, _signal: AbortSignal) => ok);
    const x = await harness({ app: { tools: { smoke } } });
    for (const bad of [
      { ...body, origin: 'L1R' },
      { origin: 'LHR', destination: 'JFK' },
      { ...body, budget: 0 },
    ])
      expect((await x.request('/api/tools/smoke', { method: 'POST', json: bad })).status).toBe(400);
    const res = await x.request('/api/tools/smoke', { method: 'POST', json: { ...body, origin: 'lhr' } });
    expect(await expectContract(res, 'POST', '/api/tools/smoke', TOOL)).toEqual(ok);
    expect(smoke.mock.calls[0]?.[0]).toEqual(body);
  });

  it('runs inside a container too: plan decision 62 refuses only recording there', async () => {
    const smoke = vi.fn(async (_args: unknown, _signal: AbortSignal) => ok);
    const x = await harness({ env: { IN_CONTAINER: '1' }, app: { tools: { smoke } } });
    expect((await x.request('/api/tools/smoke', { method: 'POST', json: body })).status).toBe(200);
    expect(smoke).toHaveBeenCalledTimes(1);
  });

  it('one tool at a time, whichever it is: a smoke while a recording runs is 409 tool_busy', async () => {
    let release: (() => void) | undefined;
    const record = () => new Promise<ToolRunResponse>((resolve) => (release = () => resolve(ok)));
    const x = await harness({ app: { tools: { record, smoke: async () => ok } } });
    const first = x.request('/api/tools/record', {
      method: 'POST',
      json: { budget: 5, origins: ['LHR'], destinations: ['JFK'], month: '2027-03' },
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    const busy = await x.request('/api/tools/smoke', { method: 'POST', json: body });
    expect(busy.status).toBe(409);
    expect((await errorOf(busy)).code).toBe('tool_busy');
    release?.();
    expect((await first).status).toBe(200);
  });

  it('a failing runner answers 500 tool_failed without leaking URLs or secrets', async () => {
    const x = await harness({
      app: {
        tools: { smoke: async () => Promise.reject(new Error('GET https://x.test/?token=SENTINEL-SMOKE')) },
      },
    });
    const res = await x.request('/api/tools/smoke', { method: 'POST', json: body });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SENTINEL-SMOKE');
    expect(x.logLines.join('')).not.toContain('SENTINEL-SMOKE');
  });
});

describe('the in-process smoke runner', () => {
  it('refuses with the CLI code 70 while the synthetic gate is open', async () => {
    const x = await harness();
    const r = await inProcessTools(x.ports).smoke?.(
      apiContract.toolSmokeRequestSchema.parse(body),
      new AbortController().signal,
    );
    expect(r).toMatchObject({ exitCode: 70, fixturesWritten: [] });
    expect(TOOL.safeParse(r).success).toBe(true);
  });

  it("runs on the app's ports, writes no fixture and says so", async () => {
    const env = cleanEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: join(tempDir('gmt-smoke-route-'), 'app.db'),
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'error',
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_RATE_PER_MINUTE: '60000',
      SEARCHAPI_RATE_PER_HOUR: '600000',
    });
    const ports = buildPorts(loadConfigFromEnv(env), { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    onCleanup(() => ports.db.close());
    seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
    const seen = stubSmokeVendors();
    const r = await inProcessTools(ports).smoke?.(
      apiContract.toolSmokeRequestSchema.parse(body),
      new AbortController().signal,
    );
    expect(TOOL.parse(r)).toMatchObject({ exitCode: 0, fixturesWritten: [] });
    expect(r?.lines).toContain('fixtures not written (app process)');
    expect(r?.summary).toMatch(/^cheapest found £412 · LHR→JFK /);
    expect(seen.urls).toHaveLength(5);
    expect(JSON.stringify(r)).not.toContain(SENTINEL_SA);
  });
});
```

`apps/api/test/routes/tools.test.ts`: the case `503 when the runner is not registered; the smoke route is not mounted by WP8` becomes `503 when the runner is not registered` and loses its last four statements (the smoke request and its `not_found` expectation). `apps/api/test/routes/contract-sweep.test.ts`: `apiTexts()` lists `API_TEXT.smokeSynthetic` after `API_TEXT.toolSynthetic`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/toolsSmoke.test.ts`
Expected: FAIL: the first case sees `['POST /api/tools/smoke']`, the route answers 404 `not_found`, and the in-process runner has no `smoke` (`pnpm --filter @gmt/api typecheck` also reports that `smoke` does not exist on `HttpToolRunners`).

- [ ] **Step 3: Implement**

`apps/api/src/routes/types.ts`:

```ts
export type ToolRunResponse = z.infer<typeof apiContract.toolRunResponseSchema>;
export type ToolRecordRequest = z.infer<typeof apiContract.toolRecordRequestSchema>;
export type ToolSmokeRequest = z.infer<typeof apiContract.toolSmokeRequestSchema>;
/**
 * The tools the HTTP surface runs in-process; an absent runner answers 503 tool_unavailable. why: named apart from
 * WP4b's `ToolRunners` in `bootstrap/tool.ts` (the CLI's runners, a different shape) so the two never shadow.
 */
export interface HttpToolRunners {
  record?: (args: ToolRecordRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
  /** Spec §10 `/tools/smoke` (WP13): the smoke inside the app process, which holds app_lock. */
  smoke?: (args: ToolSmokeRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
}

/** ROUTES entries another package mounts (plan decision 4). Empty since WP13 mounted the smoke route. */
export const OWNED_ELSEWHERE: ReadonlySet<string> = new Set();
```

`apps/api/src/text.ts`, after `toolSynthetic`:

```ts
  smokeSynthetic: 'the smoke refuses while the synthetic gate is open (spec §5.5)',
```

`apps/api/src/routes/tools.ts`: the file comment names both routes (spec §10 `/tools/record` and `/tools/smoke`, the scripts inside the app process, which holds app_lock), and the handler table gains:

```ts
  /**
   * Spec §10, §13: the smoke runs inside the app process, in a container too (the operator calls it with curl from the
   * host; decision 62 refuses only recording there). One tool at a time; an unregistered runner is 503; a runner that
   * throws is 500 with a scrubbed log line. The exit code, lines and an empty fixture list come back in the body.
   */
  'POST /api/tools/smoke': route(
    { request: apiContract.toolSmokeRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      const smoke = ctx.tools.smoke;
      if (smoke === undefined) throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable('smoke'));
      return oneAtATime(
        ctx,
        TOOL_KEY,
        async () => {
          try {
            return c.json(await smoke(body, c.req.raw.signal));
          } catch (err) {
            ctx.ports.log.error(
              { tool: 'smoke', err: { message: safeMessage(err, ctx.ports.secrets) } },
              'tool failed',
            );
            throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed('smoke'));
          }
        },
        () => new ApiError(409, 'tool_busy', API_TEXT.toolBusy('smoke')),
      );
    },
  ),
```

`apps/api/src/tools/inProcess.ts`: import `runSmoke` from `'./smoke.js'`, say in the file comment that it runs WP4b's `runRecord` and WP13's `runSmoke`, and add the runner after `record`:

```ts
    // why: the app's ports; no fixtures (the route says so), no --confirm-rerun over HTTP, the synthetic gate refused
    // with the CLI's code 70 (WP13)
    smoke: async (args, signal) => {
      if (syntheticAllowed(ports.config))
        return {
          exitCode: EXIT.refusedTestEnv,
          summary: API_TEXT.smokeSynthetic,
          lines: [API_TEXT.smokeSynthetic],
          fixturesWritten: [],
        };
      const r = await runSmoke(ports, { args, confirmRerun: false }, { signal, fixtures: null });
      return { exitCode: r.exitCode, summary: r.summary, lines: r.lines, fixturesWritten: [] };
    },
```

WP8's mounting sweep (`contract-sweep.test.ts`, `mounted`) filters `OWNED_ELSEWHERE`; with the set empty it now drives the smoke route as well (503 without a runner).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS with the package thresholds (85/70; `src/routes/**` 90/80). On the assembly: 38 files passed and 1 skipped (the recorded manifest, visibly), 446 tests passed and 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp13: mount POST /api/tools/smoke inside the app process, one tool at a time (spec §10, §13)"
```

### Task 13.6: Layer-B engine tests, one copy of the skip guard, and its CI note

**Files:**
- Create: `packages/providers/src/testing/recordings.ts`, `packages/engine/test/layerB/support.ts`, `packages/engine/test/layerB/layerB.test.ts`
- Modify: `packages/providers/src/testing/index.ts`, `packages/providers/test/support/recordings.ts`, `apps/api/test/helpers/recordings.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `createEngine`, `fxHttpLimits`, both adapters and their limits and params, `budgetConfigFromConfig`, `guardedServer`, `replayHandlers`, `loadRecorded`, `capturingLogger`, `capturingNotifier`.
- Produces: `recordingsPresent`, `skipTitle`, `SKIP_SUFFIX` on `@gmt/providers/testing`.

The recorded WP4b session (local-only, decision 61) holds one LHR → JFK SearchApi calendar rectangle for 2027-03-01..09 × 2027-03-11..30 (the production 9 × 20 shape, decision 29), the Travelpayouts LHR → JFK March month tile, and one google_flights chain for one cell. Layer B runs the engine over exactly those requests. The recorded March tile holds no row departing on the 1st to the 9th, so the first case also pins that an Aviasales cache without a row records `no_data`, never `empty`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/layerB/support.ts`:

```ts
/**
 * Layer B (spec §9 item 4): the real SearchApi and Travelpayouts adapters replaying WP4b's recorded session through
 * the same path as layer A: the real http-kit, the real SqliteBudgetGuard over the production budget wiring, an
 * in-memory database, msw on global fetch (the network guards' server, @gmt/providers/testing). The recordings are
 * local-only (plan decision 61), so a checkout without them skips visibly (decision 64's guard, one copy).
 */
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  type DefinitionInput,
  type Execution,
  fixedClock,
  type IsoDateTime,
  parseConfig,
} from '@gmt/core';
import {
  AIRPORTS_DATA_DIR,
  applyMigrations,
  budgetConfigFromConfig,
  createRepos,
  type Db,
  loadAirportsDataset,
  MIGRATIONS_DIR,
  openDatabase,
  type Repos,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import {
  createHttpKit,
  defaultRecordedRoot,
  SEARCHAPI_PARAMS,
  searchApiHttpLimits,
  searchApiProvider,
  TRAVELPAYOUTS_PARAMS,
  travelpayoutsHttpLimits,
  travelpayoutsProvider,
} from '@gmt/providers';
import { guardedServer, loadRecorded, recordingsPresent, replayHandlers } from '@gmt/providers/testing';
import { fxHttpLimits } from '../../src/fx/limits.js';
import type { EngineDeps } from '../../src/types.js';
import { capturingLogger, capturingNotifier, type LogLine } from '../support/harness.js';

export const RECORDED_ROOT = defaultRecordedRoot();
export const PRESENT = recordingsPresent(RECORDED_ROOT);
/** WP4b's signature; the smoke's own recordings live beside its database, never here (decision 61). */
export const RECORD_RECORDED_BY = '@gmt/api record:fixtures';

/** The newest WP4b session that holds an in-limit calendar tile, and when it was recorded. */
export function recordedSession(): { session: string; at: IsoDateTime } {
  const calendars = loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search').filter(
    (r) =>
      r.recordedBy === RECORD_RECORDED_BY &&
      r.status === 200 &&
      new URL(r.request.url).searchParams.get('engine') === 'google_flights_calendar',
  );
  const last = calendars.at(-1);
  if (last === undefined) throw new Error('no recorded in-limit calendar tile (WP4b Task 12b)');
  const first = loadRecorded(RECORDED_ROOT, 'travelpayouts', '/aviasales/v3/prices_for_dates')
    .filter((r) => r.session === last.session)
    .at(0);
  return { session: last.session, at: first?.recordedAt ?? last.recordedAt };
}

/** The recorded google_flights chain: its cell (from step 1's request) and how many outbounds it expanded. */
export function recordedChain(session: string): {
  cell: { departureDate: string; returnDate: string };
  expandTop: number;
} {
  const flights = loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search').filter(
    (r) =>
      r.session === session &&
      r.status === 200 &&
      new URL(r.request.url).searchParams.get('engine') === 'google_flights',
  );
  const step1 = flights.find((r) => {
    const p = new URL(r.request.url).searchParams;
    return !p.has('departure_token') && !p.has('booking_token');
  });
  if (step1 === undefined) throw new Error('no recorded google_flights step 1 (WP4b Task 12b)');
  const p = new URL(step1.request.url).searchParams;
  return {
    cell: { departureDate: p.get('outbound_date') ?? '', returnDate: p.get('return_date') ?? '' },
    expandTop: flights.filter((r) => new URL(r.request.url).searchParams.has('departure_token')).length,
  };
}

export interface LayerB {
  deps: EngineDeps;
  db: Db;
  repos: Repos;
  logs: LogLine[];
  misses(): string[];
  close(): void;
}

/** Engine deps over the real adapters, with the recorded session installed on the guarded msw server. */
export function layerB(session: string, now: IsoDateTime): LayerB {
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789abcdef',
      SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef',
      SEARCHAPI_PLAN: 'trial',
      // why: the trial's 2 calls a minute would space replayed calls 30 s apart (http-kit smoothing, decision 17)
      SEARCHAPI_RATE_PER_MINUTE: '60000',
      SEARCHAPI_RATE_PER_HOUR: '600000',
      TRAVELPAYOUTS_RATE_PER_MINUTE: '60000',
      TRAVELPAYOUTS_RATE_PER_HOUR: '600000',
      REQUEST_TIMEOUT_SECONDS: '10',
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`layer B config invalid: ${JSON.stringify(parsed.errors)}`);
  const config = parsed.config;
  const tp = config.providers.travelpayouts;
  const sa = config.providers.searchapi;
  if (tp === null || sa === null) throw new Error('layer B configures both vendors');
  const clock = fixedClock(asIsoDateTime(now));
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  // why: no synthetic row is ever written here; the repositories enforce the provider ⇔ kind rule
  const repos = createRepos(db, clock, { allowSynthetic: false });
  repos.airports.upsertAll(loadAirportsDataset(AIRPORTS_DATA_DIR));
  const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
  const cache = new SqliteResponseCache(db, clock);
  const timing = {
    maxWaitSeconds: config.maxWaitSeconds,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
  };
  const http = createHttpKit({
    budget,
    cache,
    clock,
    log,
    secrets: [tp.token, sa.key],
    syntheticAllowed: false,
    limits: {
      travelpayouts: travelpayoutsHttpLimits(tp.limits, config),
      searchapi: searchApiHttpLimits(sa.limits, timing),
      fx: fxHttpLimits(config),
    },
  });
  const providers = [
    travelpayoutsProvider({
      http,
      log,
      clock,
      token: tp.token,
      cacheTtlSeconds: tp.limits.cacheTtlHours * 3600,
      paramsAllowlist: TRAVELPAYOUTS_PARAMS,
    }),
    searchApiProvider({
      http,
      log,
      clock,
      key: sa.key,
      costPerCallMicroGbp: sa.limits.costPerCallMicroGbp,
      pointOfSale: config.pointOfSale,
      cacheTtlSeconds: sa.limits.cacheTtlHours * 3600,
      paramsAllowlist: SEARCHAPI_PARAMS,
    }),
  ];
  const replay = replayHandlers(RECORDED_ROOT, { session });
  guardedServer.use(...replay.handlers);
  const deps: EngineDeps = {
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers,
    notifiers: [capturingNotifier([], [])],
    clock,
    log,
  };
  return { deps, db, repos, logs, misses: replay.misses, close: () => db.close() };
}

/** The recorded route and band as a definition: LHR → JFK, the recorded rectangle's nine departure days, 10–21 nights. */
export function recordedDefinition(patch: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: 'London to New York (layer B)',
    origins: [asIata('LHR')],
    destinations: [asIata('JFK')],
    window: { kind: 'absolute', from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-09') },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: 20, maxFreeCalls: 20, maxCostMicroGbp: 1_000_000 },
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: true,
    ...patch,
  };
}

/** Polls until the execution leaves pending and running (real timers: replay answers at once). */
export async function settled(repos: Repos, executionId: string): Promise<Execution> {
  for (let i = 0; i < 2000; i += 1) {
    const e = repos.executions.get(executionId);
    if (e === null) throw new Error(`no execution ${executionId}`);
    if (e.status !== 'pending' && e.status !== 'running') return e;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`execution ${executionId} did not settle`);
}
```

`packages/engine/test/layerB/layerB.test.ts`:

```ts
// Spec §9 item 4, layer B (WP13): the engine over the real adapters on WP4b's recorded session. Skips visibly when the
// local-only recordings are absent (plan decisions 61, 64).
import { asIata, asIsoDate } from '@gmt/core';
import { skipTitle } from '@gmt/providers/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../../src/engine.js';
import {
  type LayerB,
  layerB,
  PRESENT,
  recordedChain,
  recordedDefinition,
  recordedSession,
  settled,
} from './support.js';

let open: LayerB | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

interface PriceRow {
  provider_id: string;
  source_kind: string;
  point_of_sale: string;
  max_age_hours: number | null;
  fetched_at: string;
  provider_observed_at: string | null;
  reused_from_execution_id: string | null;
}

describe.skipIf(!PRESENT)(
  skipTitle('layer B: the engine over the real adapters on the recorded session (spec §9 item 4)', PRESENT),
  () => {
    it('discovery: one Travelpayouts month tile and one 9 × 20 SearchApi rectangle, provenance on every row, cache absence as no_data, then a reuse run with no call (spec §5.2, §8.1)', async () => {
      const { session, at } = recordedSession();
      const b = layerB(session, at);
      open = b;
      const engine = createEngine(b.deps);
      const def = b.repos.definitions.create(recordedDefinition());
      const first = await engine.start(def.id, { trigger: 'manual' });
      if (!first.ok) throw new Error(`start refused: ${first.code}: ${first.message}`);
      expect((await settled(b.repos, first.executionId)).status).toBe('completed');
      const counts = b.repos.ledger.countsFor(first.executionId);
      expect(counts.perProvider.map((p) => [p.providerId, p.stage, p.tiles, p.cacheHits])).toEqual([
        ['searchapi', 'discovery', 1, 0],
        ['travelpayouts', 'discovery', 1, 0],
      ]);
      const rows = b.db.raw
        .prepare<[string], PriceRow>(
          'SELECT provider_id, source_kind, point_of_sale, max_age_hours, fetched_at, provider_observed_at, reused_from_execution_id FROM calendar_prices WHERE execution_id = ?',
        )
        .all(first.executionId);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.reused_from_execution_id).toBeNull();
        expect(r.fetched_at >= at).toBe(true);
        expect([r.provider_id, r.source_kind, r.point_of_sale, r.max_age_hours]).toEqual([
          'searchapi',
          'scraped-aggregate',
          'GB',
          24,
        ]);
      }
      // why: the recorded Aviasales cache holds no row departing in these nine days, so every covered cell is no_data,
      // never empty: absence from a cache is not evidence of no fares (spec §5.2 "empty is per capability")
      const tpCells = b.repos.cells.outcomes(first.executionId, {
        stage: 'discovery',
        providerId: 'travelpayouts',
      });
      expect(tpCells.length).toBe(9 * 12); // nine departure days × 10–21 nights
      expect(new Set(tpCells.map((o) => o.status))).toEqual(new Set(['no_data']));

      const second = await engine.start(def.id, { trigger: 'manual' });
      if (!second.ok) throw new Error(`start refused: ${second.code}: ${second.message}`);
      expect((await settled(b.repos, second.executionId)).status).toBe('completed');
      expect(b.repos.ledger.countsFor(second.executionId).calls).toBe(0);
      const reused = b.db.raw
        .prepare<[string], PriceRow>('SELECT * FROM calendar_prices WHERE execution_id = ?')
        .all(second.executionId);
      expect(reused.length).toBe(rows.length);
      for (const r of reused) expect(r.reused_from_execution_id).toBe(first.executionId);
      await engine.shutdown();
      expect(b.misses()).toEqual([]);
    }, 60_000);

    it('Travelpayouts rows the vendor dated: authorised-cached provenance with the search date the vendor states (spec §3; decision 35)', async () => {
      const { session, at } = recordedSession();
      const b = layerB(session, at);
      open = b;
      const engine = createEngine(b.deps);
      // why: the recorded LHR → JFK March tile prices 2027-03-15/20 and 2027-03-17/24; the same month tile is requested
      const def = b.repos.definitions.create(
        recordedDefinition({
          window: { kind: 'absolute', from: asIsoDate('2027-03-15'), to: asIsoDate('2027-03-17') },
          minNights: 5,
          maxNights: 7,
          providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} },
        }),
      );
      const run = await engine.start(def.id, { trigger: 'manual' });
      if (!run.ok) throw new Error(`start refused: ${run.code}: ${run.message}`);
      expect((await settled(b.repos, run.executionId)).status).toBe('completed');
      const rows = b.db.raw
        .prepare<[string], PriceRow>('SELECT * FROM calendar_prices WHERE execution_id = ?')
        .all(run.executionId);
      expect(rows.length).toBe(2);
      for (const r of rows) {
        expect([r.source_kind, r.point_of_sale, r.max_age_hours]).toEqual([
          'authorised-cached',
          'unknown',
          48,
        ]);
        expect(r.provider_observed_at === null ? null : r.provider_observed_at < r.fetched_at).toBe(true);
      }
      await engine.shutdown();
      expect(b.misses()).toEqual([]);
    }, 60_000);

    it('verification: the recorded chain for its cell as a child execution, scraped-search provenance, seller-confirmed offers (spec §5.4)', async () => {
      const { session, at } = recordedSession();
      const { cell, expandTop } = recordedChain(session);
      const b = layerB(session, at);
      open = b;
      const engine = createEngine(b.deps);
      const def = b.repos.definitions.create(
        recordedDefinition({
          providers: { discovery: [], verification: ['searchapi'], discoveryRefreshHours: {} },
          verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop, bookingLinks: true },
        }),
      );
      const key = {
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate(cell.departureDate),
        returnDate: asIsoDate(cell.returnDate),
      };
      const child = await engine.verifyCell(def.id, key);
      if (!child.ok) throw new Error(`verify refused: ${child.code}: ${child.message}`);
      expect((await settled(b.repos, child.executionId)).status).toBe('completed');
      const obs = b.db.raw
        .prepare<
          [string],
          { source_kind: string; max_age_hours: number | null; booking_json: string | null }
        >('SELECT source_kind, max_age_hours, booking_json FROM price_observations WHERE execution_id = ?')
        .all(child.executionId);
      expect(obs.length).toBeGreaterThan(0);
      for (const o of obs) {
        expect([o.source_kind, o.max_age_hours]).toEqual(['scraped-search', null]);
        const booking: { kind: string; url?: string } =
          o.booking_json === null ? { kind: 'none' } : JSON.parse(o.booking_json);
        if (booking.kind !== 'none')
          expect(new URL(booking.url ?? '').hostname.endsWith('google.com')).toBe(true);
      }
      expect(b.repos.ledger.countsFor(child.executionId).calls).toBeLessThanOrEqual(1 + 2 * expandTop);
      await engine.shutdown();
      expect(b.misses()).toEqual([]);
    }, 60_000);
  },
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run test/layerB`
Expected: FAIL: `recordingsPresent` and `skipTitle` are not exported by `@gmt/providers/testing`.

- [ ] **Step 3: Implement: move the guard into `@gmt/providers/testing`**

`packages/providers/src/testing/recordings.ts` (the providers helper's code, now the one copy):

```ts
/**
 * Gate for tests that replay the vendor recordings, one copy for every package (WP13 moved it here from the providers
 * and api test helpers, so the engine's layer-B suite shares it). The recordings (`fixtures/recorded/**\/*.json` except the tracked
 * `params-*.json`) are gitignored and local-only (plan decisions 61 and 64), so a fresh checkout has none; the suites
 * that need them skip visibly instead of failing or passing vacuously.
 */
import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { errnoCode } from '../util.js';

/** Appended to a skipped suite's title so the reporter shows why it did not run. */
export const SKIP_SUFFIX = ' (skipped: recordings not present, local-only, decision 61)';

const isRecording = (name: string): boolean =>
  name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-');

function hasRecording(dir: string): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // why: a missing tree is the fresh-checkout case; any other failure (EACCES …) is reported as itself.
    if (errnoCode(e) === 'ENOENT') return false;
    throw e;
  }
  return entries.some((e) => (e.isDirectory() ? hasRecording(join(dir, e.name)) : isRecording(e.name)));
}

/** True when at least one non-params recording exists under `root`. */
export function recordingsPresent(root: string): boolean {
  return hasRecording(root);
}

/** The suite title, suffixed with the skip reason only when the suite is skipped. */
export const skipTitle = (title: string, present: boolean): string =>
  present ? title : `${title}${SKIP_SUFFIX}`;
```

`packages/providers/src/testing/index.ts`, before the `replay.js` line:

```ts
export { recordingsPresent, SKIP_SUFFIX, skipTitle } from './recordings.js'; // decisions 61, 64: visible skip
```

`packages/providers/test/support/recordings.ts` and `apps/api/test/helpers/recordings.ts` become re-exports, so their importers and `recordings.test.ts` are unchanged:

```ts
// The visible-skip guard of plan decisions 61 and 64 lives in @gmt/providers/testing (one copy; WP13).
export { recordingsPresent, SKIP_SUFFIX, skipTitle } from '../../src/testing/recordings.js';
```

```ts
// The visible-skip guard of plan decisions 61 and 64 lives in @gmt/providers/testing (one copy; WP13).
export { recordingsPresent, SKIP_SUFFIX, skipTitle } from '@gmt/providers/testing';
```

`.github/workflows/ci.yml`, in the `test` job after `pnpm test:coverage` (the decision-61 CI note: a fresh checkout has no recordings, and the report must say so):

```yaml
      # why: recorded vendor responses are local-only (plan decisions 61, 64), so this fresh checkout has none; the suites
      # that replay them must report the skip, never pass vacuously
      - name: recording-dependent suites skip visibly (decision 61)
        run: |
          pnpm exec vitest run --project api --project providers --project engine test/recorded/ test/searchapi/recorded.test.ts test/travelpayouts/replay.test.ts test/layerB/ --reporter=verbose | tee recorded-skip.log
          grep -q 'skipped: recordings not present, local-only, decision 61' recorded-skip.log
```

- [ ] **Step 4: Run to verify it passes**

On a checkout without recordings (CI, a fresh clone):
Run: `pnpm --filter @gmt/engine exec vitest run test/layerB --reporter=verbose`
Expected: 3 tests skipped, each title ending `(skipped: recordings not present, local-only, decision 61)`.

On the operator's machine, with the WP4b recordings in `packages/providers/fixtures/recorded`:
Run: `pnpm --filter @gmt/engine exec vitest run test/layerB`
Expected: PASS, 3 tests (the assembly ran them against the local recordings of session `20261015T035035045Z-b1f7d7`).

Then: `pnpm --filter @gmt/providers test && pnpm --filter @gmt/engine test`, both exit 0 with their thresholds; and the CI step's two commands from the repository root exit 0 (the assembly counted 33 skipped titles carrying the suffix).

- [ ] **Step 5: Commit**

```bash
git add packages/providers packages/engine/test/layerB apps/api/test/helpers/recordings.ts .github/workflows/ci.yml && git commit -m "wp13: layer-B engine tests on the recorded session, one skip guard, CI shows the skips (spec §9 item 4, decisions 61, 64)"
```

### Task 13.7: Document the smoke test in `docs/setup.md` (decision 63)

WP12 wrote `docs/setup.md` and `apps/api/test/deploy/docs.test.ts` and kept the smoke out of both. This task adds it. Its section numbers are WP12's; the smoke goes in a new last section, so no test that quotes a section heading moves.

**Files:**
- Modify: `docs/setup.md`, `apps/api/test/deploy/docs.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/test/deploy/docs.test.ts`: import `apiContract` from `@gmt/core`; in `describe('docs/setup.md exit codes …')` delete the comment `// why: the smoke test's 2 and 3 are documented by WP13 with its route (decision 63)` (the test is unchanged: since Task 13.1 `EXIT` holds 2 and 3, so the table must list them); in `describe('docs/setup.md operations rules …')` replace `leaves the smoke test to WP13 (decision 63)` with:

```ts
  it('documents the smoke test: the route with a prompted password and a valid body, the command line, where fixtures go (WP13)', () => {
    expect(setup).toContain(
      "curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \\",
    );
    expect(setup).toContain('-X POST http://127.0.0.1:3000/api/tools/smoke');
    const body = /-d '(\{[^']*\})'/.exec(setup)?.[1] ?? '';
    expect(apiContract.toolSmokeRequestSchema.safeParse(JSON.parse(body)).success).toBe(true);
    expect(setup).toContain('pnpm smoke:live --origin LHR --destination JFK --budget 8');
    expect(flat).toContain('smoke/fixtures/recorded');
    expect(flat).toContain('The app writes no fixtures for a smoke test it runs');
    expect(flat).toContain('`2` and `3`');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts`
Expected: FAIL in two cases: the exit-code table lacks 2 and 3, and `setup.md` has no smoke text.

- [ ] **Step 3: Implement**

`docs/setup.md` section 10: the opening sentence and three rows change, two rows are added (the table stays in code order):

````markdown
## 10. Exit codes

Every command-line entry point (the app itself, `pnpm record:fixtures`, `pnpm smoke:live`,
`node scripts/backup.mjs`, `node scripts/check-backup.mjs`) and the `exitCode` of the
`/api/tools/*` routes use this one table. Codes `2` and `3` come only from the smoke test
(section 13):

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | a tool run failed (recording: a required call did not return its expected status; smoke test: a provider failed or a checklist line reads `FAIL`; the backup scripts: the built packages could not be loaded) |
| 2 | smoke test: no provider is configured; nothing was sent |
| 3 | smoke test: no error, but a provider had no price for the searched days (an Aviasales cache without a row for that month is common; try the other destination) |
| 64 | bad arguments (usage), or a recording of another route than the worked example without `--out DIR` outside the repository |
| 65 | a recording or smoke test refused for spend: with earlier tool runs it would exceed the budget you gave (raise it, or pass `--confirm-rerun` on the command line), or a provider's budget window has less room than the run needs |
| 70 | refused because `NODE_ENV=test`, or because fixture data is enabled |
| 73 | the data directory or `<data dir>/backups` is not writable, the database lock cannot be read, or the pre-migration backup cannot be attempted |
| 74 | a backup failed (boot, `scripts/backup.mjs`) or is unusable (`scripts/check-backup.mjs`); at boot, migrations were not applied |
| 75 | the database lock is held by another running app or tool |
| 78 | bad configuration; the message names every variable to fix |
````

`docs/setup.md`, a new last section after section 12:

````markdown
## 13. The smoke test

The smoke test asks each configured provider for one small search and checks what comes back:
Travelpayouts one month of cached prices (a free call), SearchApi one date grid and one
itinerary search for its cheapest day pair (at most 4 credits). It prints the cheapest price
found with its source and age, then a checklist. Run it after setup, after changing a key, and
whenever prices look wrong.

While the app runs (the container, or `pnpm dev`), call it from the host; curl asks for the
password:

```bash
curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -X POST http://127.0.0.1:3000/api/tools/smoke -d '{"origin":"LHR","destination":"JFK","budget":8}'
```

`budget` is the number of SearchApi credits tool runs (smoke tests and fixture recordings) may
have used in the current budget window, this run included. When this run's 4 credits would go
beyond it, or the window has no room left, the smoke test refuses with code 65 before sending
anything; send a higher `budget` when you mean to spend more. The answer's `exitCode` uses
the table in section 10, and `lines` holds the report. The app writes no fixtures for a smoke
test it runs.

With the app stopped, on a development checkout, the same test runs from the command line:

```bash
pnpm smoke:live --origin LHR --destination JFK --budget 8
```

It also writes what the vendors answered, dated, under `smoke/fixtures/recorded` beside the
database (`data/smoke/fixtures/recorded` for `data/dev.db`). Git ignores those files and they
stay on that machine, like every recorded vendor response (section 8). `--confirm-rerun` lets
a run go past `--budget` once you have decided to spend more.

Each checklist line reads `ok`, `FAIL`, `skip` or `look`:

- `one tile per provider`, `ledger`: each provider was asked once, and the database's request
  log agrees with what was sent.
- `provenance`: every price shown carries its full source record.
- `metro rule`, `open-jaw drop`: Travelpayouts was asked for the airports you named, never a
  city code, and rows that fly back to another airport were left out.
- `9-day rectangle`, `step 1 = step 2`, `sellers`: SearchApi accepted the date grid the app
  uses, the outbound price matched the return search, and the offers name who sells them.
- `age labels`, `separate tickets excluded` (`look`): compare these by eye with Google Flights
  and Aviasales for the same airports and dates.

Codes `2` and `3` are not faults of the app: `2` means no provider key is set; `3` means a
provider had no price for those days.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy`
Expected: PASS. The banned-word scan passes (`smoke:live` is core's allowlisted token); the place scan sees only LHR and JFK.

- [ ] **Step 5: Commit**

```bash
git add docs/setup.md apps/api/test/deploy/docs.test.ts && git commit -m "wp13: setup doc: the smoke test, its route, its command line and exit codes 2 and 3 (decision 63)"
```

### Task 13.8: Operator run against the vendors, and the WP5/WP6 smoke rows

The only task that spends. The operator runs it with the real `.env` on a development checkout and on the deployed container; everything before it is offline. Total spend at most 16 SearchApi credits and a handful of free Travelpayouts calls: two smokes at 4 credits each, the two WP5 parameter rows at about 4, a margin of 4. Check the SearchApi dashboard before and after and record both numbers.

- [ ] **Step 1: The command-line smoke (development checkout, app stopped)**

Run: `pnpm smoke:live --origin LHR --destination JFK --budget 8`
Expected: exit 0, or 3 when the Aviasales cache has no row for next month's first nine days (try `--destination EWR`, then record which). The lines: `tool lock acquired`, three budget lines, `travelpayouts discovery: priced …`, `searchapi discovery: priced …`, `searchapi itinerary: priced …`, `checklist:` with no `FAIL`, `cheapest found £… · LHR→JFK …`, `fixtures written: 5 under …/data/smoke/fixtures/recorded (local-only, never committed)`, `tool lock released`. Then `git status --short` prints nothing new and `pnpm secret-scan` prints `secret scan: clean`.

- [ ] **Step 2: The route against the container (docs/setup.md section 13)**

With the app up (`docker compose up -d --wait`), from the host:

```bash
curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -X POST http://127.0.0.1:3000/api/tools/smoke -d '{"origin":"LHR","destination":"JFK","budget":8}'
```

Expected: HTTP 200, `exitCode` 0 (or 3 as above), the same checklist in `lines`, the last line `fixtures not written (app process)`, `fixturesWritten: []`. A second identical call answers 65 (`budget` 8 is used up by the two runs); that is the cross-run rule working, not a fault.

- [ ] **Step 3: The smoke rows the adapters' briefs left for WP13**

Record each result in the PR under "WP13 smoke rows" and, when a row changes a rule, as a plan decision:

1. **Compare one fare with the vendor's own page (decision 27).** Open Google Flights for the chain's cell (step 1's airports and dates from the printed `searchapi itinerary` line), economy, one adult, GBP. Record the price and seller of the cheapest option there beside the smoke's cheapest offer and seller. A difference beyond a few pounds is a finding against WP5.
2. **The 9-day rectangle (decisions 27, 29).** The checklist's `9-day rectangle` line reads `ok` with `9 × 20 = 180 combinations, accepted`. Nothing else to do.
3. **`separate_tickets=1` excludes separate tickets (decisions 27, 29).** For the same cell, list the Google Flights options marked "separate tickets"; none may appear among the smoke's step-1 or step-2 options (in the step files under `data/smoke/fixtures/recorded/searchapi/`). The checklist line `separate tickets excluded` reads `look`, with `split bookings skipped:` naming any.
4. **Travelpayouts against the Aviasales page (WP6 §13 item 2).** Take the smoke's Travelpayouts cheapest row (airports and dates printed on its line) and open the Aviasales search for them; record the price shown and the passenger count the page assumes. The provenance note names a passenger count only after this row.
5. **Age labels.** The checklist's `age labels` line shows the Travelpayouts row as `observed …` (decision 35: the vendor's search date) and the SearchApi lines as `provider age unknown (≤1d before that)` for the date grid and `vendor's cache age unknown` for the itinerary. Record whether the Aviasales page's own age hint agrees.
6. **Route-history scope (WP5 §13).** In SearchApi's own playground (not the app: the adapter's allowlist refuses anything it does not send), request google_flights step 1 for two cells of LHR → JFK in the same month and compare `price_insights.price_history`. Identical series: the spec §7 "route-level" label stands. Different series: the label (or `route_price_history`'s key) changes at the next spec revision. Two credits.
7. **`show_cheapest_flights` (WP5 §13).** In the playground, one cell with and without `show_cheapest_flights=true`: compare the option count and the minimum. The same minimum: record "tested, not needed". A lower minimum: a follow-up adds the parameter to both allowlists through a new recorded params file. Two credits.
8. **Open-jaw drop and metro rule.** The checklist's `open-jaw drop` and `metro rule` lines read `ok`; record how many cells had open-jaw rows dropped.

- [ ] **Step 4: Commit**

Nothing in the repository changes unless a row produced a finding; such a fix is its own commit with a regression test. The recordings under `data/smoke/` stay on the operator's machine (decision 61).

### Task 13.9: Final pass: the whole-branch review, the integration checks, the release

- [ ] **Step 1: The whole-branch review**

Run the review on the Fable model (the brief's owner; suggested because it holds the plan and the contracts): dispatch every reviewer of `.claude/agents/` over the branch diff (`git diff main...wp/13-smoke-and-final-pass`) and over the assembled tree at the branch head, each reading the spec, the plan and this brief. Every finding is addressed, all severities (the operator's standing rule); a finding that needs judgment is ruled on and recorded as a plan decision. Fixes land on this branch with tests.

- [ ] **Step 2: The integration checks**

Record each command's output in the PR under "WP13 integration review"; a failure is fixed on this branch before the tag.

1. `pnpm install --frozen-lockfile && pnpm build` exits 0.
2. `pnpm lint`, `pnpm -r typecheck`, `pnpm boundaries`, `pnpm casts` are clean (`pnpm boundaries` covers airport literals, `process.env` and suppression comments; `pnpm casts` prints `0 casts`).
3. `pnpm test:coverage` exits 0 with the thresholds: `core` 100/100/100/100; `db`, `providers`, `engine`, `api` ≥ 85% lines and ≥ 70% branches (api's `src/read/**` and `src/routes/**` 90/80; the providers adapter floors); `web` ≥ 70/60.
4. The CI step of Task 13.6 passes on a fresh clone (no recordings): every recording-dependent suite reports its skip.
5. `pnpm mutate` exits 0 with a mutation score ≥ 80% over the files in `packages/core/stryker.config.json`.
6. `pnpm secret-scan` prints `secret scan: clean`; `git ls-files | rg '\.env$|\.db$|backups/|fixtures/recorded/.*/[0-9].*\.json$'` prints nothing; `git log --all --format= --name-only -- packages/providers/fixtures/recorded | rg -v 'params-|\.gitkeep'` prints nothing (decision 61's purge).
7. Each spec §9 item maps to a passing file: core (`packages/core/test`), providers (`packages/providers/test`, adapters' recorded suites with recordings present), db (`packages/db/test`), engine layer A (`packages/engine/test/*.test.ts`) and layer B (`packages/engine/test/layerB`), api (`apps/api/test`, the contract sweep, the boot matrix and spawn tests), web (`apps/web/test`, the Playwright fixture-mode smoke), the scripts (`pnpm smoke:live` and its tests, `record:fixtures` and its tests), the build (CI's docker job).
8. Docker: `docker build -t get-me-there:v0.1.0-rc .` succeeds; `docker run --rm get-me-there:v0.1.0-rc sh -c 'command -v curl'` exits non-zero (spec §13: no curl in the image); WP12's `docker` CI job is green.
9. A fresh clone in Docker following `docs/setup.md` literally (sections 1, 2, 6 and 13): `docker compose up -d --wait`, `curl -fsS http://127.0.0.1:3000/api/health` answers `{"ok":true,"degraded":false}`, and section 13's curl answers as Task 13.8 Step 2 says. Where the doc and the run differ, fix the doc in this branch and re-run from the top.
10. A manual walkthrough in fixture mode (`ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake NODE_ENV=development DATABASE_PATH="$PWD/data/walkthrough.fixture.db" BIND_ADDRESS=127.0.0.1 pnpm dev`): import the example, run it, and check the four views at 1280 px and 375 px against spec §11 (the synthetic banner, provenance on every price without hover, the six coverage buckets summing to the cell count, the class badge, price and provenance visible at 375 px). Screenshots stay outside the repository.

- [ ] **Step 3: Release**

```bash
git switch main && git merge --no-ff wp/13-smoke-and-final-pass -m "wp13: smoke test, layer B, smoke docs, final pass"
pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint && pnpm -r typecheck
git tag -a v0.1.0 -m "get-me-there v0.1.0: Phases 1–3 per the design spec"
git push origin main v0.1.0
```

Expected: every command exits 0, and `git tag -l v0.1.0` prints `v0.1.0`.

## 9. Pinned review-focus tests

The plan's five Review Focus lines belong to WP0–WP10; Task 13.9 Step 2 item 7 re-runs them with the rest. WP13 pins its own:

- The smoke exits 0 with provenance, the checklist and the ledger proof: Task 13.1.
- The guard refuses beyond the stated worst case, and the recording spend rules refuse with 65 before any request: Task 13.2.
- A spawned smoke starts no execution and releases the lock: Task 13.4.
- The smoke route runs inside a container and shares the one-tool-at-a-time key: Task 13.5.
- Layer B over the real adapters, and an empty cache recorded as `no_data`: Task 13.6.

## 10. Definition of done

- `pnpm install --frozen-lockfile && pnpm build` exits 0; `pnpm lint`, `pnpm -r typecheck`, `pnpm boundaries`, `pnpm casts` are clean.
- `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts test/tools/smokeArgs.test.ts test/routes/toolsSmoke.test.ts` passes 37 tests (10, 19, 8); `pnpm --filter @gmt/api exec vitest run test/bootstrap -t smoke` passes the 4 smoke cases.
- `pnpm --filter @gmt/api test`, `pnpm --filter @gmt/providers test`, `pnpm --filter @gmt/engine test` and `pnpm --filter @gmt/core test` exit 0 with their thresholds.
- `pnpm --filter @gmt/engine exec vitest run test/layerB` skips 3 tests visibly without recordings and passes them with the local recordings.
- `pnpm --filter @gmt/api exec vitest run test/deploy` passes with the smoke section and exit codes 2 and 3 (after WP12).
- Task 13.8's rows are recorded in the PR, and Task 13.9's review and checks are complete with every finding addressed.
- `v0.1.0` is tagged on `main`.

## 11. Open questions

None that need the operator's judgement. §13 lists the contract changes for Fable to record in the plan before dispatch.

## 12. Changes outside WP13's own files

- `packages/core/src/api-contract/system.ts`: `toolSmokeRequestSchema` gains `budget` (Task 13.1).
- `packages/providers/src/testing/`: the skip guard moves in; the providers and api test helpers re-export it (Task 13.6).
- `apps/api/src/tools/recordExecution.ts` (WP4b): `spendPosition` and `openHiddenExecution` extracted; two output phrases reworded; the record tool's behaviour and exit codes are unchanged (Task 13.1).
- `apps/api/src/tools/types.ts`, `bootstrap/tool.ts` (WP4b), `routes/types.ts`, `routes/tools.ts`, `tools/inProcess.ts`, `text.ts` (WP8), and their tests.
- `.gitignore`, `.github/workflows/ci.yml` (one step), `docs/setup.md` and `apps/api/test/deploy/docs.test.ts` (WP12).

## 13. For the plan (not yet recorded there)

1. **Assembly.** On 2026-10-17 every code block of Tasks 13.1–13.6 was assembled on a detached scratch worktree of `main` at `13454fc` and the blocks above were generated from those files. Results: `pnpm -r typecheck`, `pnpm lint` (610 files), `pnpm boundaries`, `pnpm casts` (564 files, 0 casts) clean; `pnpm --filter @gmt/api test` exit 0 with thresholds, 446 passed and 1 skipped; core 778 passed; providers 634 passed and 29 skipped (recordings absent), coverage exit 0; engine 282 passed and 3 skipped; layer B 3 passed with the local recordings copied in and removed afterwards. Not run: Task 13.7 (WP12's `docs/setup.md` and `docs.test.ts` are not on main), Task 13.8 (spends), Task 13.9, the CI workflow itself.
2. **The smoke contract.** The plan's smoke line reads `runSmoke(ports, args: { origin; destination }): Promise<SmokeResult>` with codes 0, 1, 2, 3, 64. The code is `runSmoke(ports, cli: SmokeCli, opts: { signal; fixtures })` with codes 0, 1, 2, 3, 64 and 65, because the smoke follows the recording spend rules (decision 20): it takes `--budget N` (and `--confirm-rerun` on the command line), and `toolSmokeRequestSchema` gains `budget`, as `toolRecordRequestSchema` has. `EXIT` names the new codes `smokeNoProviders` (2) and `smokeEmpty` (3); exit 1 also covers a checklist line that reads `fail`.
3. **Stale plan text.** "Wiring and bootstraps" still gives `providersFor(config, deps: { http; log; clock; airports })` (WP6 removed `airports`, decision 34) and `createLogger(config, opts?: { destination? })` (decision 23 added `fd` and `secrets`).
4. **What the smoke spends and checks.** Spec §9 item 7 says one tile per configured provider; the smoke also runs one SearchApi itinerary chain (`expandTop` 1, 3 credits) for its cheapest SearchApi cell, because the step-1/step-2 price, seller and age checks need it. Worst case 4 SearchApi credits and 3 free Travelpayouts calls, enforced as the hidden tool execution's snapshot budget. Spec §9 item 7 could say so at its next revision.
5. **Where the smoke writes.** A command-line smoke writes dated recordings to `<dirname(DATABASE_PATH)>/smoke/fixtures/recorded`, never into `packages/providers/fixtures/recorded`; `.gitignore` gains `**/smoke/fixtures/recorded/**`. The route writes none. This keeps spec §9 item 7's "writes dated fixtures" inside decision 61.
6. **Banned words in tool output.** The tools' `lines` are API response strings, so spec §11 applies; the record tool's "(a live run needs --confirm-rerun)" and "a live run would be refused" now read "a run that calls the vendors …" in both tools.
7. **The smoke route in a container.** Decision 62 refuses only recording inside a container; the smoke route runs there, as spec §13's curl example requires.
8. **One skip guard.** The decision-61/64 guard moved from two test helpers into `@gmt/providers/testing` so the engine's layer-B suite uses the same copy; CI shows the skips in a named step (the CI note decision 61 gave WP13).
9. **Scope trimmed from the earlier draft.** The separate `integration` project (cross-cutting banned words, a whole-process sentinel test, a route-mount test), the per-run cap wrapper and the WP7 harness extension are dropped: the merged packages already own those tests (§2 Out), the hidden execution's snapshot budget is the recording tool's own cap mechanism, and layer B builds its own small setup without changing WP7's harness.
10. **Layer B's evidence.** The recorded Travelpayouts LHR → JFK March tile holds three rows, none departing on 2027-03-01..09; layer B therefore pins `no_data` for the rectangle's window and checks Travelpayouts provenance on a 2027-03-15..17, 5–7-night window that the same recorded month tile prices.
