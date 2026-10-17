---
wp: 13
title: smoke test, layer-B engine tests, smoke documentation, final whole-branch pass
owner: fable
depends_on: [all]
spec_sections: ["§9 item 7", "§9 item 4 layer B", "§7 app_lock and the tool bootstrap", "§10 /tools/smoke", "§11 banned words", "§12", "§13", "§15", "§16 WP13"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, security-reviewer, cost-and-budget-reviewer, devops-reviewer, provider-integration-expert, product-owner, persona-flexible-traveller]
status: reviewed
---

# WP13: smoke test, layer-B engine tests, smoke documentation, final whole-branch pass

Revised on 2026-10-17 for review round 2: every round-1 finding (0 Critical, 7 High, 19 Medium, 11 Low) is addressed under the rulings of plan decision 66, the others as the reviewers suggested (§13 item 11 maps each one). Written against the plan's "Global Constraints", its "Wiring and bootstraps" contract and decisions 1–66, spec revision 27, and the code merged on `main` at `f8b7595` (WP0–WP9 and the decision-64 skip guard); WP10 merged afterwards (`4403a6b`) without touching apps/api, core, providers or engine, and its CI change is reflected in Tasks 13.6 and 13.9. Every code block of Tasks 13.1–13.6 was assembled on a scratch worktree of that commit and passed `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm casts` and the api, core, providers and engine suites with their thresholds (§13 item 1). WP11 and WP12 are not on `main` yet; Task 13.7 edits WP12's files and was not assembled.

## 1. Goal

Prove the assembled system against the vendors with the operator's real keys at a small, stated and enforced cost, prove the engine over the real adapters on the recorded session, document the smoke test, trace one real price end to end, and close the build with a whole-branch review and the release tag. Specifically:

- `pnpm smoke:live` and `POST /api/tools/smoke` run one discovery tile per configured provider and one SearchApi itinerary chain under the recording spend rules (one shared helper; the per-run cap frozen at min(`--budget`, worst case)), with a dry run that sends nothing, and print a headline price with its provenance and a checklist of provenance and honesty checks.
- The engine passes layer-B tests on the local recordings, and every recording-dependent suite skips visibly, by title, where the recordings are absent.
- `docs/setup.md` documents the smoke test, its dry run and its exit codes.
- The operator's vendor steps run on one ledger under one ceiling, the final pass traces one real price from the vendor to each view, the whole-branch review runs with every finding addressed, and `v0.1.0` is tagged.

## 2. Scope

**In**

- `apps/api/src/tools/smoke.ts` (arguments, query, worst case, fixture target, the hidden execution, discovery, chain, headline, `runSmoke`, `runSmokeTool`) and `apps/api/src/tools/smokeChecks.ts` (the checklist and `metroRuleCheck`), split the way the record tool is split. The smoke runs through `runTool('smoke', …)` with the same bootstrap as recording: config, refusal under `NODE_ENV=test` or an open synthetic gate (70), arguments (64), the fixture target (78), data directory (73), the read-only `app_lock` probe (75), the pre-migration backup (73/74), `buildPorts`, `AppLock('tool')`, seeding, heartbeat, release on every path.
- One argv reader for both tools (`apps/api/src/tools/args.ts`: `readFlags`, `positiveInt`; decision 66); the record tool's parser keeps only its own validation and its messages.
- One copy of the tool-run bookkeeping (`apps/api/src/tools/toolExecution.ts`, renamed from `recordExecution.ts`): `spendPosition` (window room, then the cross-run sum against `--budget`, 65 before any request, `--confirm-rerun` lifting only the cross-run refusal; the trial window line prints `SEARCHAPI_TRIAL_USED`), `toolEstimate` (the stored estimate for ledger parity) and `openHiddenExecution` (the hidden soft-deleted definition built once, the snapshot from one instant, and the frozen cap min(`--budget`, worst case) for both tools; cost-wp4b-011, decision 66).
- The smoke's spend: worst case 4 SearchApi credits (calendar 1, chain `1 + 2 × expandTop` = 3) and 3 free Travelpayouts calls (one tile at the page cap); the cap the guard enforces is min(`--budget`, 4). `--dry-run` (CLI) and `dryRun: true` (route) print the plan, the frozen cap and the spend position and send nothing (decision 66).
- Fixtures: a command-line smoke writes dated recordings beside the database (`<dirname(DATABASE_PATH)>/smoke/fixtures/recorded`, ignored by git wherever it lies), never into `packages/providers/fixtures/recorded` (decision 61; true-case real-path containment shared with the record tool in `apps/api/src/tools/paths.ts`). The route writes none and says so.
- `POST /api/tools/smoke`: one shared in-process runner with the record route (503 unregistered, one tool at a time, 500 scrubbed, 409 busy), runs inside a container too (spec §13; decision 62 refuses only recording there), refuses an open synthetic gate with 70. `OWNED_ELSEWHERE` is removed: every ROUTES entry is mounted by apps/api, and WP8's sweep now drives the smoke route. `API_TEXT.toolSynthetic` takes the tool name.
- The visible-skip guard moved into `@gmt/providers/testing` (the shims deleted, the importers repointed, one unit test), layer-B engine tests (`packages/engine/test/layerB/`), and a CI step that fails unless each recording-dependent suite reports its skip by title (the decision-61 CI note).
- `docs/setup.md` section 13 "The smoke test" and the exit codes 2 and 3 in section 10, with WP12's `docs.test.ts` requiring them (decision 63).
- The operator's vendor steps (Task 13.8) and the final pass (Task 13.9): the whole-branch review on the Fable model, the integration checks, the end-to-end trace of one real price, and the release.

**Out**

- `record:fixtures`' plan and calls, `runTool`'s steps, the recorded tree's verification: WP4b (on main). WP13 adds the `smoke` case, moves the flag loop, the containment helper and the execution bookkeeping into shared modules, and rewords two output phrases; the record tool's plan, exit codes and caps are unchanged.
- The adapters' tiling, parsing, error mapping and allowlists: WP5, WP6 (on main). A smoke or layer-B finding that traces to `src` is fixed on this branch with a regression test in the owning package.
- `createApp`, the other routes, `oneAtATime`: WP8 (on main). WP13 changes the tool routes, one text and the removed `OWNED_ELSEWHERE`.
- The engine and its layer-A harness: WP7 (on main). Layer B builds its own small setup and changes no WP7 file.
- Dockerfile, compose, the rest of `docs/setup.md`, the docs tests' other rules: WP12. WP13 adds one section, two table rows and one test.
- Cross-cutting tests the merged packages already own: the ROUTES mounting sweep both ways, every GET against the contract, banned words in every `API_TEXT` entry and response string, the sentinel secrets in bodies and logs (`apps/api/test/routes/contract-sweep.test.ts`); the web catalogue and rendered sweeps (`apps/web/test/copy/`); engine log lines and operator words (`packages/engine/test/logs-and-words.test.ts`); the recorded-tree secret scan (`apps/api/test/security/sentinel.test.ts`); the tool bootstrap's lock, backup and refusal cases (`apps/api/test/bootstrap/`). Task 13.9 runs them.
- `show_cheapest_flights` (WP5 §13): the adapter's allowlist refuses the parameter and decision 66 keeps every vendor step on the app's ledger, so WP13 does not test it; §13 item 10 records it as a follow-up.

## 3. Spec sections

- **§9 item 7.** `pnpm smoke:live` issues exactly one tile per configured provider (a query sized so `plan` yields one tile), asserts via the ledger, prints the cheapest price with provenance, writes dated fixtures, exits non-zero on zero providers or any configured-provider error, uses a distinct code for empty, is excluded from `pnpm test` and runs through the tool bootstrap.
- **§9 item 4, layer B.** The real adapters replaying recorded fixtures through the same path as layer A: real http-kit, the real `db` BudgetGuard, an in-memory DB, msw on global fetch.
- **§7 `app_lock`, SQLite settings, migrations.** The tool bootstrap skips the boot sweep, auto-resume and cron, uses the production ledger, checks `app_lock` read-only before any backup or migration, and holds the lock as `tool`; a test proves it starts no execution.
- **§10 `/tools/smoke`.** The smoke runs inside the app process, authenticated, while the app holds `app_lock`; every route lives under `/api`.
- **§11.** No banned word in a user-facing string; the tools' response lines are API strings (§13 item 6). "verified" is reserved for class values: the smoke says "confirmed by a seller listing" and "price not confirmed by the final step" (decision 44).
- **§12.** No new variable: the smoke's budget is an argument, like recording's; `SEARCHAPI_TRIAL_USED` (existing) is set from the dashboard before the operator's first call; `.env.example` is unchanged.
- **§13.** The image has no curl: the operator calls the route from the host with curl against the loopback port; the docs carry the dry run and the local-development `pnpm smoke:live`.
- **§15.** "Cheapest round trip found", never "bookable": the headline reads `cheapest confirmed price …` or `cheapest calendar price … · not checked by an itinerary search` (decision 66).
- **§16 WP13.** First failing test: the smoke exits 0 with provenance.
- **Plan decisions** this brief implements: 4, 5, 12, 20, 23, 24, 26, 27, 29, 30, 34, 35, 37, 39, 40, 44, 53, 61, 62, 63, 64, 65, 66.

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
Config.providers.searchapi: { key: Secret; plan: 'trial' | '40usd'; trialUsed: number; limits: ProviderLimits } | null   // SEARCHAPI_TRIAL_USED, subtracted from the trial's lifetime cap

// db (WP3)
LedgerRepo.countsFor(executionId): { calls; costMicroGbp; tiles; cacheHits; perProvider: Array<{ providerId; stage: 'discovery' | 'verification' | null; calls; costMicroGbp; tiles; cacheHits }> }
AirportsRepo.exists(iata): boolean; AirportsRepo.airportsOfMetro(code): Iata[]; seedAirports(db, dataset)
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
tools/recordExecution.ts: priorToolCredits(ports): number; budgetPosition(ports, a, plan); openRecordingExecution(ports, a, plan, sa)   // renamed toolExecution.ts and reshaped by Task 13.1
tools/recordPlan.ts: parseRecordArgs(argv) with its own flag loop and positiveInt   // the loop moves to tools/args.ts (Task 13.1)
bootstrap/tool.ts: realOrAncestor(p) (module-private), recordingTarget(cli, given, roots?)   // realOrAncestor moves to tools/paths.ts (Task 13.4)
BudgetGuard.usage({ kind: 'execution-calls', executionId }): Usage   // the guard's billed count (pending, unknown or billable)
tools/recordPlan.ts: CALENDAR_OUT_DAYS (9), RECORD_MIN_NIGHTS (10), RECORD_MAX_NIGHTS (21), TP_MAX_PAGES_PER_TILE, firstDayOf(month), monthAfter(month, k)
tools/recordRequests.ts: cheapestOption(body, 'departure_token' | 'booking_token'): { token; price } | null
routes: route(schemas, handle); NO_INPUT; oneAtATime(ctx, key, fn, busy); HandlerTable; RouteContext { ports; engine; tools: HttpToolRunners; busy }; OWNED_ELSEWHERE (removed by Task 13.5); ApiError; API_TEXT (toolSynthetic is a string on main); safeMessage(e, secrets)
test helpers: testEnv, cleanEnv, toolEnv, silentLog, SENTINEL_SA/TP; STANDIN_MARKER; onCleanup, tempDir, tempRecordedRoot, filesUnder; createHarness (routes); testRecording, TEST_RECORDED_BY; engine test/support/harness.ts capturingLogger, capturingNotifier
```

## 5. Interfaces produced

```ts
// packages/core/src/api-contract/system.ts (changed)
export const toolSmokeRequestSchema = z.object({ origin: iataSchema, destination: iataSchema, budget: z.number().int().min(1), dryRun: z.boolean().optional() });

// apps/api/src/tools/types.ts (changed): the one exit-code table gains the smoke's two codes
export const EXIT = { ok: 0, failed: 1, smokeNoProviders: 2, smokeEmpty: 3, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;

// apps/api/src/tools/args.ts (new; the record parser's loop, shared)
export type ReadFlags = { ok: true; flags: ReadonlyMap<string, string>; switches: ReadonlySet<string> } | { ok: false; message: string };
export function readFlags(argv: readonly string[], valueFlags: ReadonlySet<string>, switchNames: ReadonlySet<string>): ReadFlags;
export function positiveInt(s: string): number | null;

// apps/api/src/tools/paths.ts (new; the record tool's containment, shared)
export function realOrAncestor(p: string): string;
export function isInside(p: string, root: string): boolean;

// apps/api/src/tools/toolExecution.ts (renamed from recordExecution.ts; shared by both tools)
export function priorToolCredits(ports: Ports): number;   // unchanged
export interface WorstCase { credits: number; freeCalls: number }
export function spendPosition(ports: Ports, worst: WorstCase, budget: number): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] };
export interface EstimateLine { providerId: ProviderId; stage: Stage; calls: number; planCalls: number }
export function toolEstimate(ports: Ports, lines: readonly EstimateLine[], assumption: string): Estimate;
export interface HiddenRun { tool: 'record:fixtures' | 'smoke:live'; origins; destinations; from; to; minNights; maxNights; cabin; expandTop; budget: number; worst: WorstCase; maxFreeCalls: number; estimate: Estimate }
export function openHiddenExecution(ports: Ports, run: HiddenRun): string;   // snapshot budget maxCalls = min(run.budget, run.worst.credits)
export function budgetPosition(ports, a: RecordArgs, plan): …;   // the record tool's wrapper, unchanged signature
export function openRecordingExecution(ports, a: RecordArgs, plan): string;   // loses its `sa` argument

// apps/api/src/tools/smoke.ts
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
export const SMOKE_EXPAND_TOP = 1; export const SMOKE_DEPARTURE_DAYS = 9; export const SMOKE_CABIN: Cabin = 'economy'; export const SMOKE_USAGE: string;
export const NOT_CONFIRMED = 'price not confirmed by the final step';
export const VENDORS = ['travelpayouts', 'searchapi'] as const; export type Vendor;
export interface SmokeArgs { origin: Iata; destination: Iata; budget: number }
export interface SmokeCli { args: SmokeArgs; confirmRerun: boolean; dryRun: boolean }
export interface SmokePrice { pricePence: number; cell: CellKey; nights: number; displayName: string; provenance: Provenance; confirmed: boolean | null; truncated: boolean }
export interface SmokeProviderReport { providerId: Vendor; stage: 'discovery' | 'itinerary'; status: 'priced' | 'empty' | 'error' | 'skipped'; prices: number; cheapest: SmokePrice | null; cheapestConfirmed: SmokePrice | null; detail: string }
export interface SmokeResult { exitCode: number; summary: string; lines: string[]; checks: SmokeCheck[]; reports: SmokeProviderReport[]; fixturesWritten: string[]; executionId: string | null }
export function parseSmokeArgs(argv: readonly string[]): { ok: true; value: SmokeCli } | { ok: false; message: string };
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery;
export function smokeWorstCase(config: Config): WorstCase;
export function smokeFixtureTarget(databasePath: string, recordedTree?: string): { root: string; recordedBy: string } | { refusal: string };
export function describePrice(p: SmokePrice, now: IsoDateTime): string;
export async function runSmoke(ports: Ports, cli: SmokeCli, opts: { signal: AbortSignal; fixtures: { root: string; recordedBy: string } | null }): Promise<SmokeResult>;
export async function runSmokeTool(ports: Ports, cli: SmokeCli, ctx: ToolContext): Promise<number>;

// apps/api/src/tools/smokeChecks.ts
export interface SmokeCheck { name: string; status: 'pass' | 'fail' | 'skip' | 'look'; detail: string }
export interface Seen { providerId: string; tileIndex: number | null; url: URL; body: unknown }
export function metroRuleCheck(q: Pick<DiscoveryQuery, 'origin' | 'destination'>, requests: ReadonlyArray<{ providerId: string; url: URL }>): SmokeCheck;
export function checklist(i: ChecklistInput): SmokeCheck[];

// apps/api/src/bootstrap/tool.ts (changed)
export interface ToolRunners { record(ports, cli: RecordCli, ctx): Promise<number>; smoke(ports, cli: SmokeCli, ctx): Promise<number> }

// apps/api/src/routes (changed)
export type ToolSmokeRequest = z.infer<typeof apiContract.toolSmokeRequestSchema>;
HttpToolRunners.smoke?: (args: ToolSmokeRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
// OWNED_ELSEWHERE removed; API_TEXT.toolSynthetic: (name: string) => string

// packages/providers/src/testing (moved here; decisions 61, 64)
export const SKIP_SUFFIX = ' (skipped: recordings not present, local-only, decision 61)';
export function recordingsPresent(root: string): boolean;
export const skipTitle: (title: string, present: boolean) => string;

// apps/api/test/helpers/smokeVendors.ts (test only)
export function stubSmokeVendors(o?: SmokeVendorOptions): { urls: URL[] };   // options: tpEmpty, step2Price, step3Dearer, step3Empty, tpTruncated, tpBadPrice, failOn
```

**Exit codes** (the plan's one table for every CLI; spec §9 item 7). For the smoke, everything before the first request is decided in this order: in the bootstrap (command line only) 64 for malformed arguments, then 78 for the fixture target; inside `runSmoke` 64 for a city code, an unknown airport or the same airport twice, then 2 (no provider configured), then a dry run stops with 0, then 65 (spend). After the run, 1 beats 3 beats 0.

| Code | Meaning | Who returns it |
|---|---|---|
| 0 | Ok. Smoke: every configured provider priced its tile, the chain priced, and no checklist line reads `fail`; or a dry run | tool |
| 1 | The run failed. Smoke: a provider errored (a `tile-error`, a thrown `ProviderError`, a guard refusal, a plan of other than one tile, a non-GBP price), the run was aborted, or a checklist line reads `fail` | tool |
| 2 | Smoke: no provider configured; nothing sent, no execution | `runSmoke` |
| 3 | Smoke: no error, but a tile or the chain held no price | `runSmoke` |
| 64 | Bad arguments | `parseSmokeArgs`, `runSmoke` |
| 65 | Refused for spend: a provider window has less room than the worst case, or earlier tool runs' credits in this database plus the worst case exceed `--budget` without `--confirm-rerun` (over HTTP: `budget` in the body, never confirmed) | `spendPosition` via `runSmoke` |
| 70 | Refused under `NODE_ENV=test` or while the synthetic gate is open (the route answers 70 in `exitCode`) | `runTool`, the in-process runner |
| 73, 74, 75 | Data directory or preflight impossible; backup failed; `app_lock` held | `runTool` |
| 78 | Bad configuration; for the smoke also a `DATABASE_PATH` whose fixture target lies in the recorded tree | `runTool` |

Through the route a malformed body is a 400 from validation; every other code arrives in `exitCode`.

**The headline** (decision 66): `cheapest confirmed price <describePrice>` when a seller listing confirmed a chain price; otherwise `cheapest calendar price <describePrice> · not checked by an itinerary search`, whose age label is the one the views print; `no price found` when nothing priced. Only a confirmed offer reads "sold by <seller>"; an offer the final step did not confirm reads "airline stated by the vendor: <airline> · price not confirmed by the final step" (decision 44). A truncated tile's cheapest reads "(cheapest of the rows read)" (decision 30).

**The checklist.** Every line reads only what this run saw (the hidden execution's ledger and guard usage, the requests this run's http-kit sent and the bodies it received, the adapters' results). It checks the adapters' output on the operator's keys; the stored records are proved by layer B and Task 13.9's trace.

| Check | `pass` when | Source |
|---|---|---|
| one tile per provider | every configured provider planned exactly one tile | spec §9 item 7 |
| tiles read whole | no tile stopped at its page cap and no per-cell issue other than an open-jaw drop (the query is sized to be read in one tile) | decisions 24, 30 |
| ledger | each fetched provider has one first-attempt tile and no cache hit; every answer this run received is in the ledger (attempts ≥ answers, retries reported); the chain made at most 3 calls; the guard's billed count for the execution is within the frozen cap | spec §8.1; cost-wp13-r1-008 |
| provenance | each price shown parses with `provenanceSchema`, carries the source kind its provider and stage declare (`authorised-cached`, `scraped-aggregate`, `scraped-search`; never `synthetic`), the point-of-sale rule (`POINT_OF_SALE` for SearchApi, `unknown` for Travelpayouts), and was fetched during this run | spec §3, Global Constraints |
| age labels | `look`: the label each view would print | spec §3, §11; decisions 35, 44, 58 |
| airport pairs (metro rule) | every Travelpayouts request named the query's airports as `origin`/`destination`, and every SearchApi request as `departure_id`/`arrival_id` | decision 34 |
| open-jaw drop | `look`, with the cells the adapter's `[open-jaw]` issues name and their row count; `fail` when those counts exceed the tile's `offers-dropped` note. Read from issues and notes only, never priced rows (decision 66) | decision 39 |
| 9-day rectangle | SearchApi's one tile is 9 departure days and the vendor accepted it | decision 29; WP5 smoke row |
| step 1 = step 2 | step 2 expanded step 1's cheapest outbound (its `departure_token`), and its cheapest return carries the same price | spec §5.4 |
| sellers | the chain returned offers, every offer names a seller, and at least one price was confirmed by a seller listing | decisions 24, 27, 44 |
| separate tickets excluded | `look` when every SearchApi request carried `separate_tickets=1` (`fail` otherwise) | decision 29; WP5 smoke row |

## 6. Library notes

Exercised on 2026-10-17 by this brief's assembly on Node 22 (versions from the lockfile at `f8b7595`); every API below is also used on `main` by the file named.

- **vitest 5.0.4.** `describe.skipIf(cond)(title, fn)` (used by `apps/api/test/recorded/manifest.test.ts`); `vi.stubGlobal('fetch', fn)` with `vi.unstubAllGlobals()` (WP4b's `test/helpers/vendors.ts`); `it.each(table)(name, fn)`; the root CLI's `--project <name>` filter plus file-name filters and `--reporter=verbose`, which prints a skipped test's full title (Task 13.6's CI step, run on the assembly). Per-task runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>` (decision 8: no threshold on a partial run).
- **msw 3.0.3** only through `@gmt/providers/testing` (decision 7): `guardedServer.use(...handlers)` adds replay handlers in front of the network guards' catch-all (the guards reset handlers after each test; `packages/providers/test/travelpayouts/replay.test.ts` uses the same `server.use(...r.handlers)`).
- **zod 4.6.7** (an engine dependency): `z.union`, `z.object`, `z.literal`, `z.array(z.string())`, `.parse` to narrow JSON read as `unknown` in layer B (as `packages/engine/test/verification.test.ts` narrows its JSON; no cast, hard rule 8).
- **node:child_process** `spawnSync(process.execPath, [...NODE_ARGS, '--import', 'tsx', 'src/bootstrap/tool.ts', …], { cwd, env, encoding: 'utf8', timeout })` as WP4b's `tool.spawn.test.ts` does, with its DNS-refusal preload.
- **git** `git check-ignore -q <path>` exits 0 for an ignored path (used by `apps/api/test/security/sentinel.test.ts`).
- **GitHub Actions** `shell: bash` runs `bash --noprofile --norc -eo pipefail {0}`, so a failing command before `tee` fails the step (the default shell has no pipefail).
- **hono 4.13.13** through WP8's `route()` wrapper; `Context<AppEnv>` types the shared runner's `c`.

## 7. Files

**Create**

- `apps/api/src/tools/args.ts`, `apps/api/src/tools/paths.ts`, `apps/api/src/tools/smoke.ts`, `apps/api/src/tools/smokeChecks.ts`
- `apps/api/test/helpers/smokeVendors.ts`
- `apps/api/test/tools/smoke.test.ts`, `apps/api/test/tools/smokeArgs.test.ts`, `apps/api/test/routes/toolsSmoke.test.ts`
- `packages/providers/src/testing/recordings.ts`
- `packages/engine/test/layerB/support.ts`, `packages/engine/test/layerB/layerB.test.ts`

**Rename**

- `apps/api/src/tools/recordExecution.ts` → `apps/api/src/tools/toolExecution.ts` (rewritten)
- `packages/providers/test/support/recordings.test.ts` → `packages/providers/test/testing/recordings.test.ts`

**Delete**

- `apps/api/test/helpers/recordings.ts`, `packages/providers/test/support/recordings.ts`, `apps/api/test/recorded/recordings.test.ts` (the second unit test of the same guard)

**Modify**

- `packages/core/src/api-contract/system.ts`
- `apps/api/src/tools/types.ts`, `apps/api/src/tools/recordPlan.ts`, `apps/api/src/tools/record.ts`, `apps/api/src/tools/inProcess.ts`, `apps/api/src/bootstrap/tool.ts`
- `apps/api/src/routes/types.ts`, `apps/api/src/routes/tools.ts`, `apps/api/src/app.ts`, `apps/api/src/text.ts`
- `apps/api/test/bootstrap/tool.test.ts`, `apps/api/test/bootstrap/tool.spawn.test.ts`, `apps/api/test/routes/tools.test.ts`, `apps/api/test/routes/contract-sweep.test.ts`, `apps/api/test/tools/record.test.ts`, `apps/api/test/recorded/manifest.test.ts`
- `packages/providers/src/testing/index.ts`, `packages/providers/test/travelpayouts/replay.test.ts`, `packages/providers/test/searchapi/recorded.test.ts`
- `.gitignore`, `.github/workflows/ci.yml`
- `docs/setup.md`, `apps/api/test/deploy/docs.test.ts` (WP12's files; Task 13.7)

## 8. Tasks

### Task 13.1: The smoke exits 0 with provenance (first failing test)

**Preconditions:** none beyond `main`; offline.

**Files:**
- Create: `apps/api/src/tools/args.ts`, `apps/api/src/tools/paths.ts`, `apps/api/src/tools/smoke.ts`, `apps/api/src/tools/smokeChecks.ts`, `apps/api/test/helpers/smokeVendors.ts`, `apps/api/test/tools/smoke.test.ts`
- Rename and rewrite: `apps/api/src/tools/recordExecution.ts` → `apps/api/src/tools/toolExecution.ts`
- Modify: `packages/core/src/api-contract/system.ts`, `apps/api/src/tools/types.ts`, `apps/api/src/tools/recordPlan.ts`, `apps/api/src/tools/record.ts`, `apps/api/src/bootstrap/tool.ts` (`recordingTarget` only), `apps/api/test/tools/record.test.ts`, `apps/api/test/bootstrap/tool.test.ts`

**Interfaces:**
- Consumes: `buildPorts`, `httpLimitsFor`, `providersFor`, `createHttpKit`, `createRecorder`, `priorToolCredits`, the record tool's constants, `cheapestOption`, `majorToMinor`, `provenanceSchema`, `effectiveAge`, `formatAgeFull`, `formatPence`, `LedgerRepo.countsFor`, `BudgetGuard.usage`.
- Produces: `readFlags`, `positiveInt`, `realOrAncestor`, `isInside`, `spendPosition`, `toolEstimate`, `openHiddenExecution`, `runSmoke`, `runSmokeTool`, `parseSmokeArgs`, `smokeQuery`, `smokeWorstCase`, `smokeFixtureTarget`, `describePrice`, `checklist`, `metroRuleCheck`, `EXIT.smokeNoProviders`, `EXIT.smokeEmpty`, `toolSmokeRequestSchema.budget` and `.dryRun`.

- [ ] **Step 1: Write the failing test**

The vendor stand-ins answer in the shapes the real adapters parse, with dates taken from each request, so the smoke's query (next month) needs no fixed calendar. Travelpayouts returns one closed round trip (£412, which the vendor dates 30 days before the departure, 10 days before the test's clock) and one open-jaw row the adapter must drop; SearchApi returns a calendar cell at £603, a two-option step 1, a two-option step 2 whose cheapest equals step 1, and two seller listings at step 3 (the airline at £603, an agent at £573). Options give the other cases of Task 13.2.

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
  /** Step 3 lists only an agent dearer than step 2, so the cheapest offer is the airline's unconfirmed step-2 price. */
  step3Dearer?: boolean;
  /** Step 3 lists no seller at all, so no price is confirmed by the final step. */
  step3Empty?: boolean;
  /** Travelpayouts fills every page (1,000 distinct rows), so the adapter stops at its 3-page cap (decision 30). */
  tpTruncated?: boolean;
  /** Travelpayouts adds a row with an unusable price for a covered cell (a per-cell issue, decision 24). */
  tpBadPrice?: boolean;
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
    // why: the vendor dates the find 30 days before the departure, 10 days before the smoke's clock (2027-02-10 for a
    // 2027-03-02 departure); WP6 reads it as the observed age (decision 35)
    link: `/search/${STANDIN_MARKER}?t=${token(`${origin}${destination}`, back)}&search_date=${ddmmyyyy(addDays(dep, -30))}`,
  });
  if (o.tpTruncated === true) {
    // why: a full page makes the adapter read the next one; prices differ per page so no page repeats another
    const page = Number(p.get('page') ?? '1');
    const data = Array.from({ length: 1000 }, (_, k) =>
      row(dep, ret, 400 + page * 1000 + k, `${destination}${origin}`),
    );
    return json({ success: true, currency: 'gbp', data });
  }
  return json({
    success: true,
    currency: 'gbp',
    data: [
      row(dep, ret, 412, `${destination}${origin}`),
      // why: an open-jaw row (back to another London airport) the adapter must drop and report (decision 39)
      row(dep2, ret2, 377, `${destination}LGW`),
      ...(o.tpBadPrice === true ? [{ ...row(dep, ret, 0, `${destination}${origin}`), price: 'n/a' }] : []),
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
      booking_options:
        o.step3Empty === true
          ? []
          : o.step3Dearer === true
            ? [{ book_with: 'Synthetic Travel Agent', price: 650, booking_request: POST }]
            : [
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
    // why: a route-level series the adapter keeps (decision 40: best-effort, absent from the recordings)
    price_insights: {
      price_history: [
        { price: 640, iso_date: `${addDays(out, -20)}T04:00:00Z` },
        { price: 610, iso_date: `${addDays(out, -10)}T04:00:00Z` },
      ],
    },
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

const cli = (
  budget = 4,
  confirmRerun = false,
  origin = LHR,
  destination = JFK,
  dryRun = false,
): SmokeCli => ({
  args: { origin, destination, budget },
  confirmRerun,
  dryRun,
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
const lineOf = (r: SmokeResult, start: string): string => r.lines.find((l) => l.startsWith(start)) ?? '';
const billed = (ports: Ports, r: SmokeResult): number =>
  ports.budget.usage({ kind: 'execution-calls', executionId: r.executionId ?? '' }).calls;

describe('runSmoke (spec §9 item 7)', () => {
  it('exits 0 with provenance: one tile per provider, one chain, the confirmed price as headline, every check passed, dated fixtures outside the recorded tree', async () => {
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
      'tiles read whole': 'pass',
      ledger: 'pass',
      provenance: 'pass',
      'age labels': 'look',
      'airport pairs (metro rule)': 'pass',
      'open-jaw drop': 'look',
      '9-day rectangle': 'pass',
      'step 1 = step 2': 'pass',
      sellers: 'pass',
      'route history': 'look',
      'separate tickets excluded': 'look',
    });
    expect(r.lines).toContain(
      '  [look] route history: 2 point(s) from 2027-02-10 to 2027-02-20, lowest £610',
    );
    // why: decision 66: the headline is the cheapest price a seller listing confirmed (the agent's £573 at step 3)
    expect(r.summary).toBe(
      "cheapest confirmed price £573 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Google Flights via SearchApi, sold by Synthetic Travel Agent · fetched just now · vendor's cache age unknown",
    );
    expect(r.lines).toContain(r.summary);
    // why: Travelpayouts' £412 row is its cheapest; the £377 row flew back to another airport and was dropped (decision 39)
    expect(lineOf(r, 'travelpayouts discovery: priced')).toContain(
      'cheapest £412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched just now · observed 10d ago',
    );
    expect(r.lines).toContain(
      '  [look] open-jaw drop: 1 open-jaw row(s) dropped in 1 cell(s) (2027-03-03–2027-03-15); 1 row(s) dropped in all',
    );
    expect(r.lines.some((l) => l.includes('£603 at step 1, £603 at step 2'))).toBe(true);
    expect(
      r.lines.some((l) => l.includes('SearchApi credits counted by the guard 4 of the frozen cap 4')),
    ).toBe(true);
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
    // why: the stored estimate is the stated worst case, so ledger-vs-estimate parity holds (cost-wp4b-010)
    expect(ex?.estimate?.perProvider.map((l) => [l.providerId, l.stage, l.calls])).toEqual([
      ['travelpayouts', 'discovery', 3],
      ['searchapi', 'discovery', 1],
      ['searchapi', 'verification', 3],
    ]);
    expect(ex?.snapshot.budget.maxCalls).toBe(4);
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

- [ ] **Step 3: Implement the contract and the shared tool modules**

`packages/core/src/api-contract/system.ts`: replace `toolSmokeRequestSchema` (the budget mirrors `toolRecordRequestSchema`'s, plan decision 20; `dryRun`, decision 66):

```ts
/**
 * Spec §9 item 7, §10 `/tools/smoke`: the smoke's two airports; as for recording, the SearchApi credits tool runs may
 * have ledgered in the provider's budget window, this run included (plan decision 20); and `dryRun`, which prints the
 * spend position and the plan and sends nothing (plan decision 66).
 */
export const toolSmokeRequestSchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  budget: z.number().int().min(1),
  dryRun: z.boolean().optional(),
});
```

`apps/api/src/tools/types.ts`: the `EXIT` doc comment and table gain the smoke's codes, and the `ToolName` comment reads `/** The two tools of spec §9 item 7. */`:

```ts
/**
 * The plan's single exit-code table for every CLI. 1 = a required recording call did not return its expected status, a
 * smoke provider errored or a smoke check failed, or the run failed. 2 = smoke: no provider configured, nothing sent. 3
 * = smoke: no error, but a tile or the chain held no price. 70 = refused under NODE_ENV=test or while the synthetic
 * gate is open. 65 = a tool run refused for spend: credits already ledgered to earlier tool runs plus this run's worst
 * case exceed `--budget` without `--confirm-rerun` (plan decision 20), or a provider's budget window has less room than
 * the run's worst case (cost-wp4b-r2-001). 78 = bad configuration, including a DATABASE_PATH that would put the smoke's
 * fixtures inside the recorded tree.
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

`apps/api/src/tools/args.ts`, the record parser's flag loop and `positiveInt`, now shared (decision 66):

```ts
/**
 * The one argv reader both tools share (`record:fixtures`, `smoke:live`; spec §9 item 7, plan decision 66): `--flag
 * value` and `--flag=value` for the value flags, bare switches, pnpm's own `--` skipped. Each tool keeps only its own
 * validation; the refusal wording here is the same for both.
 */

/** The flags and switches read, or the refusal (without the usage line, which each tool appends). */
export type ReadFlags =
  | { ok: true; flags: ReadonlyMap<string, string>; switches: ReadonlySet<string> }
  | { ok: false; message: string };

export function readFlags(
  argv: readonly string[],
  valueFlags: ReadonlySet<string>,
  switchNames: ReadonlySet<string>,
): ReadFlags {
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // why: pnpm may forward its own separator
    if (a === undefined || !a.startsWith('--'))
      return { ok: false, message: `unexpected argument ${String(a)}` };
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (switchNames.has(name) && eq === -1) {
      switches.add(name);
      continue;
    }
    if (!valueFlags.has(name)) return { ok: false, message: `unknown flag --${name}` };
    if (flags.has(name)) return { ok: false, message: `--${name} is given twice` };
    const value = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
    if (value === undefined || value === '' || value.startsWith('--'))
      return { ok: false, message: `--${name} needs a value` };
    flags.set(name, value);
    if (eq === -1) i++;
  }
  return { ok: true, flags, switches };
}

/** A positive integer of at most six digits, or null (a budget is never 0, never a float, never huge). */
export function positiveInt(s: string): number | null {
  return /^[1-9]\d{0,5}$/.test(s) ? Number(s) : null;
}
```

`apps/api/src/tools/recordPlan.ts`: import `positiveInt` and `readFlags` from `'./args.js'`, delete its own `positiveInt`, and replace the flag loop at the top of `parseRecordArgs` (every message and the record parse tests are unchanged):

```ts
export function parseRecordArgs(argv: readonly string[]): ParseRecordResult {
  const fail = (message: string): ParseRecordResult => ({ ok: false, message: `${message}\n${USAGE}` });
  const read = readFlags(argv, VALUE_FLAGS, SWITCHES);
  if (!read.ok) return fail(read.message);
  const { flags, switches } = read;
  // … the budget, route and month checks follow unchanged
```

`apps/api/src/tools/paths.ts`, the record tool's true-case containment, now shared:

```ts
/**
 * Path containment for the tools' write targets (sec minor 1): both sides compared as true-case real paths, so a
 * symlinked or differently cased path on a case-insensitive file system (macOS APFS) cannot slip past the check. Used by
 * the record tool's `--out` rule and the smoke's fixture target (WP13).
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/** The true-case real path of `p`, or of its nearest existing ancestor with the rest appended (a directory not made yet). */
export function realOrAncestor(p: string): string {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync.native(abs);
  const up = dirname(abs);
  return up === abs ? abs : join(realOrAncestor(up), abs.slice(up.length + 1));
}

/** Whether `p` is `root` or lies under it, both resolved by `realOrAncestor`. */
export function isInside(p: string, root: string): boolean {
  const a = realOrAncestor(p);
  const b = realOrAncestor(root);
  return a === b || a.startsWith(`${b}${sep}`);
}
```

`apps/api/src/bootstrap/tool.ts`: delete the module-private `realOrAncestor`, import `isInside` from `'../tools/paths.js'`, drop `sep` from the `node:path` import, and `recordingTarget`'s `--out` check reads:

```ts
  if (cli.out !== null) {
    const out = cli.out;
    if ((roots ?? repositoryRoots()).some((repo) => isInside(out, repo)))
      return {
        refusal: `--out ${cli.out} is inside the repository; recordings of other routes stay outside it`,
      };
    return { root: join(resolve(cli.out), 'fixtures', 'recorded'), recordedBy: RECORDED_BY };
  }
```

`git mv apps/api/src/tools/recordExecution.ts apps/api/src/tools/toolExecution.ts`, then the file reads (one copy of each rule for both tools: `priorToolCredits` and its status list unchanged; `spendPosition` from `budgetPosition`, printing a provider's lines only when it is configured, the trial's `SEARCHAPI_TRIAL_USED` on the window line, and no "live" in the two phrases that reach the tools' API bodies; `toolEstimate` from `planEstimate`; `openHiddenExecution` building the hidden definition once, its snapshot from the one instant that names it, and the frozen cap min(`--budget`, worst case)):

```ts
/**
 * Tool-run bookkeeping shared by `record:fixtures` and `smoke:live` (spec §7 production ledger; plan decisions 5, 20,
 * 23, 65, 66): the hidden soft-deleted definition and its execution with the run's frozen caps and stored estimate, the
 * credits earlier tool runs ledgered, and the provider windows' room for this run. One copy of each rule, so the two
 * tools cannot drift; the record tool's plan-specific wrappers (`budgetPosition`, `openRecordingExecution`) sit at the end.
 */
import {
  addDays,
  type Cabin,
  type DefinitionInput,
  type DefinitionSnapshot,
  type Estimate,
  type ExecutionStatus,
  type Iata,
  type IsoDate,
  microGbpToPence,
  type ProviderId,
  type Stage,
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

/** A tool run's stated worst case: SearchApi credits and free Travelpayouts calls. */
export interface WorstCase {
  credits: number;
  freeCalls: number;
}

/**
 * Where a tool run stands against every spend limit before a call to a vendor (plan decision 20, cost-wp4b-r2-001): the
 * cross-run sum against `budget`, and each configured provider window's remaining room against the run's worst case.
 * `windowRefusals` is empty when the run may start; `--confirm-rerun` lifts only the cross-run refusal, never a window
 * that has no room. The trial plan's window line names `SEARCHAPI_TRIAL_USED`, so a dry run shows the figure the cap
 * subtracts (plan decision 66).
 */
export function spendPosition(
  ports: Ports,
  worst: WorstCase,
  budget: number,
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const prior = priorToolCredits(ports);
  const rerunNeedsConfirm = prior + worst.credits > budget;
  const windowRefusals: string[] = [];
  const room = (cap: number | null, used: number): number | null => (cap === null ? null : cap - used);
  // why: these lines reach the tools' API bodies, where spec §11 bans "live" (decision 65)
  const lines = [
    `SearchApi credits already ledgered to tool runs in this budget window: ${prior}; this run ≤${worst.credits}; --budget ${budget}${rerunNeedsConfirm ? ' (a run that calls the vendors needs --confirm-rerun)' : ''}`,
  ];
  const sa = ports.config.providers.searchapi;
  // why: a provider that is not configured has no budget lines (the smoke runs on either one alone)
  if (sa === null) lines.push('SearchApi: not configured');
  else {
    const w = searchApiWindow(ports);
    const saRoom = room(w.cap, w.calls);
    if (saRoom !== null && saRoom < worst.credits)
      windowRefusals.push(
        `the SearchApi window has room for ${saRoom} credit(s) but this run may use ${worst.credits}`,
      );
    const trial = sa.limits.window === 'lifetime' ? `; SEARCHAPI_TRIAL_USED ${sa.trialUsed}` : '';
    lines.push(
      `SearchApi window (${sa.plan}${trial}): ${w.calls} of ${w.cap ?? 'no cap'} used (compare with the dashboard); room ${saRoom ?? 'unlimited'}, this run ≤${worst.credits}`,
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
  lines.push(...windowRefusals.map((r) => `a run that calls the vendors would be refused: ${r}`));
  return { lines, rerunNeedsConfirm, windowRefusals };
}

/** One line of a tool run's stored estimate: what one provider may call in one stage. */
export interface EstimateLine {
  providerId: ProviderId;
  stage: Stage;
  /** The worst case, retries and pages included. */
  calls: number;
  /** First attempts the run plans, for parity with the ledger (cost M-1). */
  planCalls: number;
}

/**
 * A tool run's estimate, stored on its hidden execution so ledger-vs-estimate parity can be computed (cost-wp4b-010).
 * SearchApi lines are priced at the configured per-call rate; Travelpayouts is free.
 */
export function toolEstimate(ports: Ports, lines: readonly EstimateLine[], assumption: string): Estimate {
  const rate = ports.config.providers.searchapi?.limits.costPerCallMicroGbp ?? 0;
  const perProvider = lines.map((l) => {
    const costMicroGbp = l.providerId === 'searchapi' ? l.calls * rate : 0;
    return { ...l, costMicroGbp, costPence: microGbpToPence(costMicroGbp), seconds: 0, blocked: null };
  });
  const totalCostMicroGbp = perProvider.reduce((n, l) => n + l.costMicroGbp, 0);
  return {
    cells: 0,
    perProvider,
    totalCalls: lines.reduce((n, l) => n + l.calls, 0),
    totalPlanCalls: lines.reduce((n, l) => n + l.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: microGbpToPence(totalCostMicroGbp),
    seconds: 0,
    assumptions: [assumption],
    windowClamped: false,
    retryFactor: 1,
  };
}

/** What varies between the two tools' hidden executions; everything else of the definition is fixed here. */
export interface HiddenRun {
  tool: 'record:fixtures' | 'smoke:live';
  origins: Iata[];
  destinations: Iata[];
  from: IsoDate;
  to: IsoDate;
  minNights: number;
  maxNights: number;
  cabin: Cabin;
  expandTop: number;
  /** The operator's `--budget`; the run's SearchApi cap is min(budget, worst.credits) (cost-wp4b-011, decision 66). */
  budget: number;
  worst: WorstCase;
  /** The free-call cap the guard enforces for this run. */
  maxFreeCalls: number;
  estimate: Estimate;
}

/**
 * A tool run's hidden execution (plan decision 5): the guard reads execution caps from the snapshot, and the ledger's
 * execution_id references search_executions, so a tool run needs a real execution. The definition is created and
 * soft-deleted in one transaction, the snapshot is built from the deleted row (prov-wp04b-009) at the instant that
 * named it, and the snapshot budget freezes the run's caps: SearchApi calls min(--budget, worst case), so the guard
 * enforces exactly the figure the dry run printed and never more than --budget, for both tools (cost-wp4b-011, decision
 * 66). Its space mirrors the run's only to satisfy the definition schema; nothing seeds cells for it, and spec §8.1
 * never resumes or schedules a deleted definition.
 */
export function openHiddenExecution(ports: Ports, run: HiddenRun): string {
  const now = ports.clock.now();
  const rate = ports.config.providers.searchapi?.limits.costPerCallMicroGbp ?? 0;
  const maxCalls = Math.min(run.budget, run.worst.credits);
  const input: DefinitionInput = {
    name: `${run.tool} ${now} (hidden tool run)`,
    origins: run.origins,
    destinations: run.destinations,
    window: { kind: 'absolute', from: run.from, to: run.to },
    minNights: run.minNights,
    maxNights: run.maxNights,
    cabin: run.cabin,
    constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: run.expandTop, bookingLinks: true },
    budget: { maxCalls, maxFreeCalls: run.maxFreeCalls, maxCostMicroGbp: maxCalls * rate },
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
    if (deleted === null) throw new Error('hidden tool definition vanished');
    return deleted;
  });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: {
      origins: run.origins,
      destinations: run.destinations,
      departureFrom: run.from,
      departureTo: run.to,
      minNights: run.minNights,
      maxNights: run.maxNights,
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
    estimate: run.estimate,
    trigger: 'tool',
    status: 'running',
  }).id;
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

/** The record tool's hidden execution over the calendar rectangle's space (plan decision 5). */
export function openRecordingExecution(ports: Ports, a: RecordArgs, plan: readonly PlannedCall[]): string {
  const t = planTotals(plan);
  const from = firstDayOf(a.month);
  return openHiddenExecution(ports, {
    tool: 'record:fixtures',
    origins: a.origins,
    destinations: a.destinations,
    from,
    to: addDays(from, CALENDAR_OUT_DAYS - 1),
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: RECORD_TRAVEL_CLASS,
    expandTop: 1,
    budget: a.budget,
    worst: { credits: t.worstCaseCredits, freeCalls: t.worstCaseFreeCalls },
    maxFreeCalls: ports.config.spend.executionMaxFreeCalls,
    estimate: toolEstimate(
      ports,
      [
        {
          providerId: 'travelpayouts',
          stage: 'discovery',
          calls: t.worstCaseFreeCalls,
          planCalls: t.freeCalls,
        },
        // why: every planned first attempt, the unbilled 401 probe included, so parity with the ledger's rows holds (cost M-1)
        { providerId: 'searchapi', stage: 'verification', calls: t.worstCaseCredits, planCalls: t.saCalls },
      ],
      'record:fixtures plan: SearchApi calls at worst-case credits; Travelpayouts calls at the page cap',
    ),
  });
}
```

`apps/api/src/tools/record.ts`: import `budgetPosition` and `openRecordingExecution` from `'./toolExecution.js'`, and call `openRecordingExecution(ports, args, plan)`. `apps/api/test/tools/record.test.ts`: import `priorToolCredits` from `'../../src/tools/toolExecution.js'`. `apps/api/test/bootstrap/tool.test.ts`: the three record cases that quote the changed lines read:

```ts
      'SearchApi window (trial; SEARCHAPI_TRIAL_USED 0): 0 of 100 used (compare with the dashboard); room 100, this run ≤5',
```

```ts
    expect(again.text()).toContain('(a run that calls the vendors needs --confirm-rerun)');
```

```ts
      'a run that calls the vendors would be refused: the SearchApi window has room for 3 credit(s) but this run may use 5',
```

- [ ] **Step 4: Implement the smoke and its checklist**

`apps/api/src/tools/smoke.ts`:

```ts
/**
 * `pnpm smoke:live` and `POST /api/tools/smoke` (spec §9 item 7, §10, §13; plan "Wiring and bootstraps", decisions 20,
 * 23, 27, 29, 34, 35, 39, 44, 61, 62, 65, 66). One small, ledgered run against the operator's real keys: one discovery
 * tile per configured provider (a query sized so `plan()` yields one tile each), then one SearchApi itinerary chain for
 * the cheapest SearchApi cell, through the real adapters, a dedicated http-kit with no response cache (the vendor must
 * answer today) and the production SqliteBudgetGuard. Spend follows the recording rules through the same helpers
 * (`toolExecution.ts`): the worst case is stated up front, `spendPosition`'s window and cross-run checks refuse with 65
 * before any request, and the hidden tool execution freezes min(--budget, worst case) as its cap, so the guard refuses
 * any reservation beyond it before the fetch. `--dry-run` prints the plan and the spend position and sends nothing.
 * The result is a checklist (`smokeChecks.ts`) the operator reads beside the vendors' own pages.
 *
 * Fixtures: a command-line run writes dated recordings beside the database (`<data dir>/smoke/fixtures/recorded`),
 * never into the repository's recorded tree (decision 61); a run inside the app process (the route) writes none and
 * says so.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  AbortedError,
  addDays,
  BudgetExceeded,
  type Cabin,
  type CellKey,
  type Config,
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
} from '@gmt/providers';
import { safeMessage } from '../safeMessage.js';
import { httpLimitsFor, type Ports, providersFor } from '../wiring.js';
import { positiveInt, readFlags } from './args.js';
import { isInside } from './paths.js';
import {
  CALENDAR_OUT_DAYS,
  firstDayOf,
  monthAfter,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  TP_MAX_PAGES_PER_TILE,
} from './recordPlan.js';
import { checklist, type Seen, type SmokeCheck } from './smokeChecks.js';
import { openHiddenExecution, spendPosition, toolEstimate, type WorstCase } from './toolExecution.js';
import { EXIT, type ToolContext } from './types.js';

export type { SmokeCheck } from './smokeChecks.js';

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
  'usage: pnpm smoke:live --origin IATA --destination IATA --budget N [--dry-run] [--confirm-rerun]';
/** The decision-44 label for an offer the final step did not confirm. */
export const NOT_CONFIRMED = 'price not confirmed by the final step';

// why: provider identifiers in a fixed order, never airports; the free provider first, so a broken setup is learned
// before any credit is spent (plan decision 23 orders the record tool's probes the same way).
export const VENDORS = ['travelpayouts', 'searchapi'] as const;
export type Vendor = (typeof VENDORS)[number];
// why: a cache hit is not a call; the smoke must show that the vendor answers today (spec §9 item 7).
const NO_CACHE: ResponseCache = { get: () => undefined, set: () => undefined };
const VALUE_FLAGS: ReadonlySet<string> = new Set(['origin', 'destination', 'budget']);
const SWITCHES: ReadonlySet<string> = new Set(['confirm-rerun', 'dry-run']);

export interface SmokeArgs {
  origin: Iata;
  destination: Iata;
  /** SearchApi credits tool runs may have ledgered in the provider's budget window, this run included (decision 20). */
  budget: number;
}
export interface SmokeCli {
  args: SmokeArgs;
  /** Lifts only the cross-run refusal, as for recording; never a window without room, never the frozen cap. */
  confirmRerun: boolean;
  /** Prints the query, the worst case and the spend position; opens no execution and sends nothing (decision 66). */
  dryRun: boolean;
}
export type ParseSmokeResult = { ok: true; value: SmokeCli } | { ok: false; message: string };

/** The cheapest price one source returned, in pence, with the provenance the adapter declares for it. */
export interface SmokePrice {
  pricePence: number;
  cell: CellKey;
  nights: number;
  /** The source, and for an itinerary offer its seller wording (decision 44: only a confirmed price is "sold by"). */
  displayName: string;
  provenance: Provenance;
  /** False for an itinerary offer the final step did not confirm; true for a confirmed offer; calendar prices: null. */
  confirmed: boolean | null;
  /** The tile stopped at its page cap: the cheapest of the rows read (decision 30). */
  truncated: boolean;
}
export interface SmokeProviderReport {
  providerId: Vendor;
  stage: 'discovery' | 'itinerary';
  status: 'priced' | 'empty' | 'error' | 'skipped';
  prices: number;
  cheapest: SmokePrice | null;
  /** Itinerary only: the cheapest offer a seller listing confirmed (the summary's headline, decision 66). */
  cheapestConfirmed: SmokePrice | null;
  detail: string;
}
export interface SmokeResult {
  exitCode: number;
  summary: string;
  lines: string[];
  checks: SmokeCheck[];
  reports: SmokeProviderReport[];
  /** Paths relative to the fixture root; always empty for a run inside the app process or a dry run. */
  fixturesWritten: string[];
  executionId: string | null;
}

/** `--origin X --destination Y --budget N [--dry-run] [--confirm-rerun]` through the tools' one argv reader. */
export function parseSmokeArgs(argv: readonly string[]): ParseSmokeResult {
  const fail = (message: string): ParseSmokeResult => ({ ok: false, message: `${message}\n${SMOKE_USAGE}` });
  const read = readFlags(argv, VALUE_FLAGS, SWITCHES);
  if (!read.ok) return fail(read.message);
  const origin = iataSchema.safeParse(read.flags.get('origin') ?? '');
  const destination = iataSchema.safeParse(read.flags.get('destination') ?? '');
  if (!origin.success || !destination.success)
    return fail('--origin and --destination are required: one three-letter airport code each');
  const budgetRaw = read.flags.get('budget');
  if (budgetRaw === undefined)
    return fail(
      '--budget is required: the SearchApi credits tool runs may use in this budget window (spec §9 item 7)',
    );
  const budget = positiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer');
  return {
    ok: true,
    value: {
      args: { origin: origin.data, destination: destination.data, budget },
      confirmRerun: read.switches.has('confirm-rerun'),
      dryRun: read.switches.has('dry-run'),
    },
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
 * The run's stated worst case: SearchApi one calendar tile plus the chain's `1 + 2 × expandTop` (the adapter's own
 * estimate rule, spec §5.4); Travelpayouts one month tile at the page cap.
 */
export function smokeWorstCase(config: Config): WorstCase {
  return {
    credits: config.providers.searchapi === null ? 0 : 1 + 1 + 2 * SMOKE_EXPAND_TOP,
    freeCalls: config.providers.travelpayouts === null ? 0 : TP_MAX_PAGES_PER_TILE,
  };
}

/**
 * Where a command-line smoke writes: `<dirname(DATABASE_PATH)>/smoke/fixtures/recorded` (the recorder requires the
 * `fixtures/recorded` suffix), refused when that lies inside the repository's recorded tree (decision 61), compared as
 * true-case real paths (`isInside`). The data directory is the operator's (gitignored `data/` on a checkout, the volume
 * in a container), like the backups beside it.
 */
export function smokeFixtureTarget(
  databasePath: string,
  recordedTree: string = defaultRecordedRoot(),
): { root: string; recordedBy: string } | { refusal: string } {
  const root = join(dirname(resolve(databasePath)), 'smoke', 'fixtures', 'recorded');
  if (isInside(root, recordedTree))
    return {
      refusal: `DATABASE_PATH would put the smoke's fixtures in the recorded tree (${root}); move the database`,
    };
  return { root, recordedBy: SMOKE_RECORDED_BY };
}

/** The hidden tool execution: the run's space, min(--budget, worst case) as its cap, and its stored estimate. */
function openSmokeExecution(ports: Ports, q: DiscoveryQuery, worst: WorstCase, budget: number): string {
  const tp = ports.config.providers.travelpayouts !== null;
  const sa = ports.config.providers.searchapi !== null;
  const chainCalls = 1 + 2 * SMOKE_EXPAND_TOP;
  return openHiddenExecution(ports, {
    tool: 'smoke:live',
    origins: [q.origin],
    destinations: [q.destination],
    from: q.departureFrom,
    to: q.departureTo,
    minNights: q.minNights,
    maxNights: q.maxNights,
    cabin: q.cabin,
    expandTop: SMOKE_EXPAND_TOP,
    budget,
    worst,
    maxFreeCalls: worst.freeCalls,
    estimate: toolEstimate(
      ports,
      [
        ...(tp
          ? [
              {
                providerId: 'travelpayouts' as const,
                stage: 'discovery' as const,
                calls: worst.freeCalls,
                planCalls: 1,
              },
            ]
          : []),
        ...(sa
          ? [
              { providerId: 'searchapi' as const, stage: 'discovery' as const, calls: 1, planCalls: 1 },
              {
                providerId: 'searchapi' as const,
                stage: 'verification' as const,
                calls: chainCalls,
                planCalls: chainCalls,
              },
            ]
          : []),
      ],
      'smoke:live: one tile per configured provider (Travelpayouts at the page cap), one SearchApi chain expanding one outbound',
    ),
  });
}

/** A provider failure as one URL-free, secret-free phrase; anything that is not a request result propagates. */
function describeFailure(e: unknown, ports: Ports): string | null {
  if (e instanceof BudgetExceeded) return `refused by the guard before the request: ${e.scope}`;
  if (e instanceof AbortedError) return 'aborted';
  if (e instanceof ProviderError)
    return `${e.kind}${e.reason === undefined ? '' : ` (${e.reason})`}: ${safeMessage(e, ports.secrets)}`;
  return null;
}

/** A vendor amount in pence with the provenance the adapter declares (spec §3), or why it cannot be shown. */
function priceOf(
  provider: FlightProvider,
  info: { sourceKind: Provenance['sourceKind']; maxAgeHours: Provenance['maxAgeHours'] },
  p: { amountMinor: number; currency: string; providerObservedAt?: IsoDateTime } & CellKey,
  fetchedAt: IsoDateTime,
  pointOfSale: string,
  extra: { displayName: string; confirmed: boolean | null; truncated: boolean },
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
    displayName: extra.displayName,
    confirmed: extra.confirmed,
    truncated: extra.truncated,
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

/**
 * `£412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched … · observed …`, with "cheapest of the rows
 * read" for a truncated tile (decision 30) and the decision-44 label for an unconfirmed offer.
 */
export function describePrice(p: SmokePrice, now: IsoDateTime): string {
  const c = p.cell;
  return [
    `${formatPence(p.pricePence)}${p.truncated ? ' (cheapest of the rows read)' : ''}`,
    `${c.origin}→${c.destination} ${c.departureDate}–${c.returnDate} (${p.nights}n)`,
    p.displayName,
    formatAgeFull(effectiveAge(p.provenance, now)),
    ...(p.confirmed === false ? [NOT_CONFIRMED] : []),
  ].join(' · ');
}

type Tile = Extract<DiscoveryTileResult, { kind: 'tile' }>;
export interface Discovery {
  report: SmokeProviderReport;
  plans: TilePlan[];
  tile: Tile | null;
}
export interface Chain {
  report: SmokeProviderReport;
  result: ItinerarySearchResult | null;
}
type Ctx = { executionId: string; signal: AbortSignal; recordFixtures: boolean };

function blankReport(providerId: Vendor, stage: SmokeProviderReport['stage']) {
  return (status: SmokeProviderReport['status'], detail: string): SmokeProviderReport => ({
    providerId,
    stage,
    status,
    prices: 0,
    cheapest: null,
    cheapestConfirmed: null,
    detail,
  });
}

/** One provider's one tile. A plan of any other length is reported and nothing is fetched. */
async function discover(
  ports: Ports,
  id: Vendor,
  provider: FlightProvider | undefined,
  q: DiscoveryQuery,
  ctx: Ctx,
): Promise<Discovery> {
  const report = blankReport(id, 'discovery');
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
  // why: a partial tile is reported on its line, never hidden behind "priced" (prov-wp13-r1-003)
  const issues = result.cellIssues ?? [];
  const partial = [
    ...(result.truncated === true ? ['stopped at the page cap'] : []),
    ...(issues.length > 0 ? [`${issues.length} cell(s) with dropped or unread rows`] : []),
  ].join('; ');
  const prices = [...result.prices].sort((a, b) => a.amountMinor - b.amountMinor);
  const [cheapestRaw] = prices;
  if (cheapestRaw === undefined) {
    // why: an empty Aviasales tile is absence from a cache; an empty SearchApi grid is the vendor's own answer (spec §5.2)
    const none =
      id === 'travelpayouts'
        ? `no row in the Aviasales cache for these days (${result.noFares.length} cell(s) without fares)`
        : `the vendor returned no price for these days (${result.noFares.length} cell(s) without fares)`;
    return {
      report: report('empty', [none, partial].filter((s) => s !== '').join('; ')),
      plans,
      tile: result,
    };
  }
  const priced = priceOf(provider, cap.info, cheapestRaw, result.fetchedAt, result.pointOfSale, {
    displayName: provider.displayName,
    confirmed: null,
    truncated: result.truncated === true,
  });
  if (typeof priced === 'string') return { report: report('error', priced), plans, tile: result };
  return {
    report: { ...report('priced', partial), prices: prices.length, cheapest: priced },
    plans,
    tile: result,
  };
}

/** The SearchApi chain for the cheapest SearchApi cell (spec §5.4), expanding one outbound. */
async function chain(
  ports: Ports,
  provider: FlightProvider | undefined,
  cell: CellKey,
  ctx: Ctx,
): Promise<Chain> {
  const report = blankReport('searchapi', 'itinerary');
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
  // why: decision 44: only a price a seller listing confirmed is "sold by"; a step-2 price names the airline the
  // vendor states and carries the unconfirmed label
  const shown = (o: (typeof offers)[number]): SmokePrice | string =>
    priceOf(
      provider,
      cap.info,
      { ...cell, amountMinor: o.amountMinor, currency: o.currency },
      result.fetchedAt,
      result.pointOfSale,
      {
        displayName: o.verified
          ? `${provider.displayName}, sold by ${o.seller}`
          : `${provider.displayName}, airline stated by the vendor: ${o.seller}`,
        confirmed: o.verified,
        truncated: false,
      },
    );
  const priced = shown(best);
  if (typeof priced === 'string') return { report: report('error', priced), result };
  const confirmedOffer = offers.find((o) => o.verified);
  const confirmed = confirmedOffer === undefined ? null : shown(confirmedOffer);
  return {
    report: {
      ...report('priced', result.partial ? 'partial: not every step answered' : ''),
      prices: offers.length,
      cheapest: priced,
      cheapestConfirmed: typeof confirmed === 'string' ? null : confirmed,
    },
    result,
  };
}

/**
 * The headline (decision 66): the cheapest price a seller listing confirmed, else the cheapest discovery price labelled
 * as a calendar price no itinerary search checked, with its age.
 */
function headline(reports: readonly SmokeProviderReport[], now: IsoDateTime): string {
  const confirmed = reports.find((r) => r.stage === 'itinerary')?.cheapestConfirmed ?? null;
  if (confirmed !== null) return `cheapest confirmed price ${describePrice(confirmed, now)}`;
  const calendar = reports
    .filter((r) => r.stage === 'discovery')
    .flatMap((r) => (r.cheapest === null ? [] : [r.cheapest]))
    .sort((a, b) => a.pricePence - b.pricePence)[0];
  return calendar === undefined
    ? 'no price found'
    : `cheapest calendar price ${describePrice(calendar, now)} · not checked by an itinerary search`;
}

const MARK: Record<SmokeCheck['status'], string> = { pass: 'ok  ', fail: 'FAIL', skip: 'skip', look: 'look' };

/**
 * Spec §9 item 7. Never throws for a vendor failure: the exit code carries it (plan exit-code table: 0 every
 * configured provider priced and no check failed; 1 a provider error, an abort or a failed check; 2 zero providers; 3
 * no error but a tile or the chain held no price; 64 bad airports; 65 spend refused). A dry run stops after the spend
 * position with 0 and sends nothing. Anything else (SQLite, a recorder refusal) cancels the hidden execution and
 * propagates, as for recording.
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
  const finish = (exitCode: number, summary: string): SmokeResult => ({
    exitCode,
    summary,
    lines,
    checks: [],
    reports: [],
    fixturesWritten: [],
    executionId: null,
  });
  const refuse = (exitCode: number, message: string): SmokeResult => {
    say(message);
    return finish(exitCode, message);
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

  const q = smokeQuery(ports.clock.todayLondon(), origin, destination);
  const worst = smokeWorstCase(ports.config);
  const cap = Math.min(cli.args.budget, worst.credits);
  say(
    `smoke: ${origin}→${destination} departures ${q.departureFrom}–${q.departureTo}, ${q.minNights}–${q.maxNights} nights; one tile per provider${configured.includes('searchapi') ? ', then one SearchApi itinerary chain' : ''}`,
  );
  say(
    `this run: at most ${worst.credits} SearchApi credit(s), frozen at ${cap} by --budget ${cli.args.budget}; at most ${worst.freeCalls} free Travelpayouts call(s)`,
  );
  const position = spendPosition(ports, worst, cli.args.budget);
  for (const l of position.lines) say(l);
  if (cli.dryRun) {
    say('dry run: nothing sent, no execution opened');
    return finish(EXIT.ok, 'dry run: nothing sent');
  }
  if (position.windowRefusals.length > 0)
    return refuse(
      EXIT.spendRefused,
      `refusing: ${position.windowRefusals.join('; ')} (never start what cannot finish)`,
    );
  if (position.rerunNeedsConfirm && !cli.confirmRerun)
    return refuse(
      EXIT.spendRefused,
      `refusing: credits already ledgered to earlier tool runs plus this run's worst case exceed --budget ${cli.args.budget}; read the first line above and raise --budget only if you mean to spend more (plan decision 20)`,
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
      seen.push({ providerId: r.providerId, tileIndex: r.tileIndex, url: r.url, body: res.body });
      return res;
    },
    stats: () => kit.stats(),
  };
  const providers = providersFor(ports.config, { http, log, clock: ports.clock }).filter((p) =>
    configured.some((id) => id === p.id),
  );
  const runStart = ports.clock.now();
  const executionId = openSmokeExecution(ports, q, worst, cli.args.budget);
  const ctx: Ctx = { executionId, signal: opts.signal, recordFixtures: recorder !== null };

  const found = new Map<Vendor, Discovery>();
  let itinerary: Chain | null = null;
  try {
    for (const id of configured)
      found.set(
        id,
        await discover(
          ports,
          id,
          providers.find((p) => p.id === id),
          q,
          ctx,
        ),
      );
    const saCell = found.get('searchapi')?.report.cheapest?.cell;
    const skipped = (detail: string): Chain => ({
      report: blankReport('searchapi', 'itinerary')('skipped', detail),
      result: null,
    });
    if (!configured.includes('searchapi')) itinerary = null;
    else if (opts.signal.aborted) itinerary = skipped('aborted before the chain');
    else if (saCell === undefined)
      // why: no priced calendar cell, so the chain has nothing to search; no credit is spent on it (cost I-1)
      itinerary = skipped('no priced SearchApi calendar cell');
    else
      itinerary = await chain(
        ports,
        providers.find((p) => p.id === 'searchapi'),
        saCell,
        ctx,
      );
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
  const checks = checklist({ ports, q, executionId, runStart, cap, configured, found, itinerary, seen });
  const now = ports.clock.now();
  for (const r of reports)
    say(
      `${r.providerId} ${r.stage}: ${r.status}${r.prices > 0 ? ` · ${r.prices} price(s)` : ''}${r.cheapest === null ? '' : ` · cheapest ${describePrice(r.cheapest, now)}`}${r.detail === '' ? '' : ` · ${r.detail}`}`,
    );
  say('checklist:');
  for (const c of checks) say(`  [${MARK[c.status]}] ${c.name}: ${c.detail}`);
  const summary = headline(reports, now);
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

`apps/api/src/tools/smokeChecks.ts`:

```ts
/**
 * The smoke's checklist (spec §9 item 7; plan decisions 27, 29, 30, 34, 35, 39, 44, 66). Every line reads only what
 * this run saw: the hidden execution's ledger rows and guard usage, the requests this run's http-kit sent and the
 * bodies it received, and the adapters' results. `look` lines are for the operator to compare with the vendors' own
 * pages and never fail the run. What these lines check is the adapters' output on the operator's keys; the stored
 * record (calendar_prices, price_observations) is proved by layer B and the final pass's end-to-end trace.
 */
import {
  type DiscoveryQuery,
  daysBetween,
  effectiveAge,
  formatAgeFull,
  formatPence,
  type IsoDateTime,
  provenanceSchema,
  type SourceKind,
} from '@gmt/core';
import { majorToMinor } from '@gmt/providers/recording';
import type { Ports } from '../wiring.js';
import { cheapestOption } from './recordRequests.js';
import type { Chain, Discovery, SmokeProviderReport, Vendor } from './smoke.js';

/** One line of the checklist. */
export interface SmokeCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'look';
  detail: string;
}

/** One response this run's http-kit returned (never written anywhere). */
export interface Seen {
  providerId: string;
  tileIndex: number | null;
  url: URL;
  body: unknown;
}

/** What the checklist reads. `cap` is the run's frozen SearchApi cap, min(--budget, worst case). */
export interface ChecklistInput {
  ports: Ports;
  q: DiscoveryQuery;
  executionId: string;
  runStart: IsoDateTime;
  cap: number;
  configured: readonly Vendor[];
  found: ReadonlyMap<Vendor, Discovery>;
  itinerary: Chain | null;
  seen: readonly Seen[];
}

/** Calls the chain may make: one step 1, then step 2 and step 3 for the one outbound it expands (spec §5.4). */
const CHAIN_CALLS = 3;
/** Departure days of the production SearchApi block for the smoke's band (decision 29). */
const RECTANGLE_DAYS = 9;

/** The source kind each provider and stage declares (spec §2 table); never 'synthetic' on a run against the vendors. */
const SOURCE_KIND: Record<`${Vendor} ${SmokeProviderReport['stage']}`, SourceKind | null> = {
  'travelpayouts discovery': 'authorised-cached',
  'travelpayouts itinerary': null,
  'searchapi discovery': 'scraped-aggregate',
  'searchapi itinerary': 'scraped-search',
};

/** Whole pence of a vendor GBP amount, or null (shared exact conversion, plan decision 24). */
const pence = (major: number | undefined): number | null =>
  major === undefined ? null : majorToMinor(major, 'GBP');
/** A WP6 per-cell issue that only reports open-jaw rows (its detail names no other cause). */
const openJawOnly = (detail: string): boolean => /^travelpayouts: [^;]*\[open-jaw\]$/.test(detail);
/** The open-jaw row count in a WP6 per-cell issue detail ("2 rows were not the closed round trip … [open-jaw]"). */
const openJawRows = (detail: string): number =>
  Number(/(\d+) rows? were not the closed round trip[^;]*\[open-jaw\]/.exec(detail)?.[1] ?? 0);
/** A NoteCounter count (`key:n`, plan decision 24) from a notes list. */
const noteCount = (notes: readonly string[], key: string): number =>
  Number(notes.find((n) => n.startsWith(`${key}:`))?.slice(key.length + 1) ?? 0);

/**
 * Plan decision 34 and spec §5.2: every request names the query's own airports, never a city code (a city query returns
 * one cheapest row across every airport of the city, hiding the definition's own fare). Travelpayouts sends
 * `origin`/`destination`; SearchApi `departure_id`/`arrival_id` on every engine and step (prov-wp13-r1-011).
 */
export function metroRuleCheck(
  q: Pick<DiscoveryQuery, 'origin' | 'destination'>,
  requests: ReadonlyArray<{ providerId: string; url: URL }>,
): SmokeCheck {
  const names = (providerId: string): [string, string] =>
    providerId === 'searchapi' ? ['departure_id', 'arrival_id'] : ['origin', 'destination'];
  const faults = requests.filter((r) => {
    const [o, d] = names(r.providerId);
    return r.url.searchParams.get(o) !== q.origin || r.url.searchParams.get(d) !== q.destination;
  });
  return {
    name: 'airport pairs (metro rule)',
    status: requests.length === 0 ? 'skip' : faults.length === 0 ? 'pass' : 'fail',
    detail:
      requests.length === 0
        ? 'no request'
        : `${requests.length} request(s) named ${q.origin}→${q.destination}${faults.length === 0 ? '' : `; ${faults.length} named another code`}`,
  };
}

export function checklist(i: ChecklistInput): SmokeCheck[] {
  const { ports, q, executionId, configured, found, itinerary, seen } = i;
  const checks: SmokeCheck[] = [];
  const add = (name: string, status: SmokeCheck['status'], detail: string): void => {
    checks.push({ name, status, detail });
  };
  const tp = found.get('travelpayouts');
  const sa = found.get('searchapi');

  // 1. One tile per configured provider (spec §9 item 7).
  add(
    'one tile per provider',
    configured.every((id) => found.get(id)?.plans.length === 1) ? 'pass' : 'fail',
    configured.map((id) => `${id} ${found.get(id)?.plans.length ?? 0}`).join(', '),
  );

  // 2. Each tile read whole (decision 30; prov-wp13-r1-003): no page cap reached, no per-cell issue but open-jaw drops.
  const tiles = [...found.values()].flatMap((d) =>
    d.tile === null ? [] : [{ id: d.report.providerId, tile: d.tile }],
  );
  const partial = tiles.flatMap(({ id, tile }) => [
    ...(tile.truncated === true ? [`${id} stopped at the page cap`] : []),
    ...(tile.cellIssues ?? [])
      .filter((x) => !openJawOnly(x.detail))
      .map((x) => `${id} ${x.cell.departureDate}–${x.cell.returnDate} ${x.reason}`),
  ]);
  add(
    'tiles read whole',
    tiles.length === 0 ? 'skip' : partial.length === 0 ? 'pass' : 'fail',
    tiles.length === 0
      ? 'no tile'
      : partial.length === 0
        ? `${tiles.length} tile(s), every page and cell read`
        : partial.join('; '),
  );

  // 3. The ledger (spec §8.1): one first-attempt tile per provider, no cache hit, every request this run's kit answered
  // ledgered, the chain inside its estimate, and billed calls inside the frozen cap (the guard's own count, cost-wp13-r1-008).
  const counts = ports.repos.ledger.countsFor(executionId);
  const line = (id: Vendor, stage: 'discovery' | 'verification') =>
    counts.perProvider.find((p) => p.providerId === id && p.stage === stage);
  const faults: string[] = [];
  const parts: string[] = [];
  for (const id of configured) {
    const d = line(id, 'discovery');
    const attempts = counts.perProvider.filter((p) => p.providerId === id).reduce((n, p) => n + p.calls, 0);
    const answered = seen.filter((s) => s.providerId === id).length;
    parts.push(
      `${id} ${d?.tiles ?? 0} tile, ${attempts} attempt(s) for ${answered} answer(s), ${d?.cacheHits ?? 0} cache hit(s)`,
    );
    if (found.get(id)?.plans.length === 1 && (d?.tiles !== 1 || d.cacheHits !== 0))
      faults.push(`${id} discovery is not one fetched tile`);
    if (attempts < answered)
      faults.push(`${id}: ${answered - attempts} answered request(s) missing from the ledger`);
  }
  const v = line('searchapi', 'verification');
  if (v !== undefined && v.calls > CHAIN_CALLS) faults.push('the chain exceeded its estimate');
  const billed = ports.budget.usage({ kind: 'execution-calls', executionId }).calls;
  parts.push(`SearchApi credits counted by the guard ${billed} of the frozen cap ${i.cap}`);
  if (billed > i.cap) faults.push('SearchApi credits exceeded the frozen cap');
  add('ledger', faults.length === 0 ? 'pass' : 'fail', [...parts, ...faults].join('; '));

  // 4. Provenance the adapters declare (spec §3; Global Constraints; prov-wp13-r1-005): complete, the source kind each
  // provider and stage declares (never synthetic), the point-of-sale rule, fetched during this run.
  const reports = [tp?.report, sa?.report, itinerary?.report].filter(
    (r): r is SmokeProviderReport => r !== undefined,
  );
  const shown = reports.flatMap((r) =>
    [r.cheapest, r.cheapestConfirmed].flatMap((p) => (p === null ? [] : [{ r, p: p.provenance }])),
  );
  const provFaults = shown.flatMap(({ r, p }) => {
    const out: string[] = [];
    const where = `${r.providerId} ${r.stage}`;
    if (!provenanceSchema.safeParse(p).success) out.push(`${where}: provenance incomplete`);
    const kind = SOURCE_KIND[`${r.providerId} ${r.stage}`];
    if (p.sourceKind === 'synthetic' || p.sourceKind !== kind)
      out.push(`${where}: source kind ${p.sourceKind}, expected ${kind ?? 'none'}`);
    const pos = r.providerId === 'travelpayouts' ? 'unknown' : ports.config.pointOfSale;
    if (p.pointOfSale !== pos) out.push(`${where}: point of sale ${p.pointOfSale}, expected ${pos}`);
    if (p.fetchedAt < i.runStart) out.push(`${where}: fetched before this run`);
    return out;
  });
  add(
    'provenance',
    shown.length === 0 ? 'skip' : provFaults.length === 0 ? 'pass' : 'fail',
    shown.length === 0
      ? 'no price to check'
      : [
          ...[
            ...new Set(
              shown.map(
                ({ r, p }) => `${r.providerId} ${r.stage} ${p.sourceKind}, point of sale ${p.pointOfSale}`,
              ),
            ),
          ],
          ...provFaults,
        ].join('; '),
  );

  // 5. Age labels as the views print them (spec §3, §11; decisions 35, 44, 58): for the operator to compare.
  const now = ports.clock.now();
  add(
    'age labels',
    shown.length === 0 ? 'skip' : 'look',
    shown.length === 0
      ? 'no price to label'
      : [
          ...new Set(
            shown.map(({ r, p }) => `${r.providerId} ${r.stage}: ${formatAgeFull(effectiveAge(p, now))}`),
          ),
        ].join('; '),
  );

  // 6. Airport pairs (decision 34), on both vendors.
  checks.push(metroRuleCheck(q, seen));

  // 7. Open-jaw drop (decision 39), read from the adapter's per-cell issues and notes, never from priced rows (which
  // carry no return airport): the issues' row counts must be inside the tile's dropped-row count. The cells are listed
  // for the operator to open on the Aviasales site.
  const tile = tp?.tile ?? null;
  if (tile === null) add('open-jaw drop', 'skip', 'no Travelpayouts tile');
  else {
    const jaw = (tile.cellIssues ?? []).filter((x) => x.detail.includes('[open-jaw]'));
    const rows = jaw.reduce((n, x) => n + openJawRows(x.detail), 0);
    const dropped = noteCount(tile.notes, 'offers-dropped');
    add(
      'open-jaw drop',
      rows > dropped ? 'fail' : 'look',
      `${rows} open-jaw row(s) dropped in ${jaw.length} cell(s)${jaw.length === 0 ? '' : ` (${jaw.map((x) => `${x.cell.departureDate}–${x.cell.returnDate}`).join(', ')})`}; ${dropped} row(s) dropped in all${rows > dropped ? '; the issues count more rows than the tile dropped' : ''}`,
    );
  }

  // 8. The production 9-day rectangle (WP5 smoke row; spec §2 fact 2): the vendor accepted 9 × 20 combinations.
  const rect = sa?.plans[0]?.request;
  if (sa === undefined || rect === undefined || rect.kind !== 'rectangle')
    add('9-day rectangle', 'skip', 'no SearchApi tile');
  else {
    const days = daysBetween(rect.departFrom, rect.departTo) + 1;
    const rets = daysBetween(rect.returnFrom, rect.returnTo) + 1;
    const accepted = sa.report.status === 'priced' || sa.report.status === 'empty';
    add(
      '9-day rectangle',
      days === RECTANGLE_DAYS && accepted ? 'pass' : 'fail',
      `${days} × ${rets} = ${days * rets} combinations, ${accepted ? 'accepted' : `not accepted (${sa.report.detail})`}`,
    );
  }

  // 9. Step 1 = step 2 (spec §5.4): step 2 expanded step 1's cheapest outbound, and the return's price equals it.
  const flights = seen.filter(
    (s) => s.providerId === 'searchapi' && s.url.searchParams.get('engine') === 'google_flights',
  );
  const step1 = flights.find(
    (s) => !s.url.searchParams.has('departure_token') && !s.url.searchParams.has('booking_token'),
  );
  const step2 = flights.find((s) => s.url.searchParams.has('departure_token'));
  const o1 = cheapestOption(step1?.body, 'departure_token');
  const p1 = pence(o1?.price);
  const p2 = pence(cheapestOption(step2?.body, 'booking_token')?.price);
  if (p1 === null || p2 === null || o1 === null)
    add('step 1 = step 2', 'skip', 'the chain did not answer both steps');
  else if (step2?.url.searchParams.get('departure_token') !== o1.token)
    add('step 1 = step 2', 'fail', 'step 2 expanded another outbound than step 1 priced cheapest');
  else
    add(
      'step 1 = step 2',
      p1 === p2 ? 'pass' : 'fail',
      `${formatPence(p1)} at step 1, ${formatPence(p2)} at step 2`,
    );

  // 10. Sellers (decisions 24, 27, 44): every offer names a seller; at least one price a seller listing confirmed.
  const result = itinerary?.result ?? null;
  if (result === null) add('sellers', 'skip', 'no chain result');
  else {
    const offers = result.offers;
    const named = offers.filter((o) => o.seller.trim() !== '');
    const confirmed = offers.filter((o) => o.verified).length;
    const noSeller = result.notes.filter((n) => n.startsWith('no-seller') || n.startsWith('no-airline'));
    add(
      'sellers',
      offers.length > 0 && named.length === offers.length && confirmed > 0 ? 'pass' : 'fail',
      `${offers.length} offer(s) from ${[...new Set(named.map((o) => o.seller))].join(', ') || 'no seller'}; ${confirmed} confirmed by a seller listing, ${offers.length - confirmed} not confirmed by the final step${noSeller.length === 0 ? '' : `; dropped: ${noSeller.join(', ')}`}`,
    );
  }

  // 11. Route-level history (decision 40; WP5 §13 row): what step 1 supplied, for the operator to compare with the
  // series another cell's search stored (Task 13.8). Best-effort: absence is the vendor's, never a fault.
  const history = result?.routeHistory ?? [];
  add(
    'route history',
    result === null ? 'skip' : 'look',
    result === null
      ? 'no chain result'
      : history.length === 0
        ? 'none supplied by the vendor for this cell'
        : `${history.length} point(s) from ${history[0]?.date} to ${history.at(-1)?.date}, lowest ${formatPence(Math.min(...history.map((h) => h.lowestPriceMinor)))}`,
  );

  // 12. Separate tickets (decision 29; WP5 smoke row): every SearchApi request asks to exclude them; whether Google
  // honours it is compared by eye in Task 13.8.
  const saSeen = seen.filter((s) => s.providerId === 'searchapi');
  const excluded = saSeen.filter((s) => s.url.searchParams.get('separate_tickets') === '1').length;
  const splits = result?.notes.filter((n) => n.startsWith('split-booking-skipped')) ?? [];
  add(
    'separate tickets excluded',
    saSeen.length === 0 ? 'skip' : excluded === saSeen.length ? 'look' : 'fail',
    saSeen.length === 0
      ? 'no SearchApi request'
      : `separate_tickets=1 on ${excluded} of ${saSeen.length} SearchApi request(s); split bookings skipped: ${splits.join(', ') || 'none'}`,
  );
  return checks;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools test/bootstrap/tool.test.ts`
Expected: PASS. `smoke.test.ts` 1 test; every record test passes with only the three quoted lines changed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/api-contract/system.ts apps/api/src/tools apps/api/src/bootstrap/tool.ts apps/api/test && git commit -m "wp13: the smoke prints a headline price with provenance and a checklist from one ledgered tile per provider and one chain; tool modules shared (spec §9 item 7, decision 66)"
```

### Task 13.2: Exit codes, the spend rules, the dry run and the honest labels

**Preconditions:** Task 13.1.

**Files:**
- Modify: `apps/api/test/tools/smoke.test.ts`

**Interfaces:**
- Consumes: `runSmoke`, `stubSmokeVendors` (`failOn`, `step2Price`, `step3Dearer`, `step3Empty`, `tpEmpty`, `tpTruncated`, `tpBadPrice`), `EXIT`, `LedgerRepo.countsFor`, `BudgetGuard.usage`.

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

  it('65: the same cross-run rule as recording; a higher --budget lifts it, --confirm-rerun too', async () => {
    const ports = smokePorts();
    const short = await smoke(ports, cli(3));
    expect(short.r.exitCode).toBe(EXIT.spendRefused);
    expect(short.urls).toEqual([]);
    expect((await smoke(ports, cli(4))).r.exitCode).toBe(EXIT.ok);
    // why: the first run ledgered 4 credits to a tool execution; 4 + 4 > 4
    const again = await smoke(ports, cli(4));
    expect(again.r.exitCode).toBe(EXIT.spendRefused);
    expect(again.r.summary).toContain('raise --budget only if you mean to spend more');
    // why: the route returns these lines in its body, so spec §11's banned words apply to them too
    for (const l of again.r.lines) expect(findBannedWords(l, BANNED_WORD_ALLOWLIST), l).toEqual([]);
    expect((await smoke(ports, cli(8))).r.exitCode).toBe(EXIT.ok);
    expect((await smoke(ports, cli(4, true))).r.exitCode).toBe(EXIT.ok);
  });

  it("the cap is frozen at min(--budget, worst case): --budget 3 --confirm-rerun lets the guard refuse the chain's last step before the fetch (decision 66, cost-wp4b-011)", async () => {
    const ports = smokePorts();
    const { r, urls } = await smoke(ports, cli(3, true));
    expect(urls.filter((u) => u.hostname === 'www.searchapi.io')).toHaveLength(3);
    expect(billed(ports, r)).toBe(3);
    expect(ports.repos.executions.get(r.executionId ?? '')?.snapshot.budget.maxCalls).toBe(3);
    expect(r.exitCode).toBe(EXIT.failed);
  });

  it('65: a SearchApi window with less room than the worst case refuses even with --confirm-rerun', async () => {
    const ports = smokePorts({ SEARCHAPI_PLAN: 'trial', SEARCHAPI_TRIAL_USED: '97' });
    const { r, urls } = await smoke(ports, cli(4, true));
    expect(r.exitCode).toBe(EXIT.spendRefused);
    expect(r.summary).toContain('the SearchApi window has room for');
    expect(urls).toEqual([]);
  });

  it('1: a SearchApi 401 is an error; Travelpayouts still prices, no chain credit is spent, the headline is a labelled calendar price', async () => {
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
    expect(r.summary).toBe(
      'cheapest calendar price £412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched just now · observed 10d ago · not checked by an itinerary search',
    );
  });

  it('1: step 2 showing another price than step 1 fails the check', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step2Price: 610 });
    expect(r.exitCode).toBe(EXIT.failed);
    expect(status(r)['step 1 = step 2']).toBe('fail');
    expect(r.lines.some((l) => l.includes('£603 at step 1, £610 at step 2'))).toBe(true);
  });

  it('an unconfirmed step-2 price is never "sold by": it names the airline and carries the decision-44 label', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step3Dearer: true });
    expect(lineOf(r, 'searchapi itinerary: priced')).toContain(
      "cheapest £603 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Google Flights via SearchApi, airline stated by the vendor: Synthetic Air One · fetched just now · vendor's cache age unknown · price not confirmed by the final step",
    );
    expect(r.summary.startsWith('cheapest confirmed price £650 ·')).toBe(true);
    expect(r.exitCode).toBe(EXIT.ok);
  });

  it('1: no seller listing at step 3: the sellers check fails and the headline falls back to the labelled calendar price', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step3Empty: true });
    expect(status(r).sellers).toBe('fail');
    expect(r.summary.startsWith('cheapest calendar price £412 ·')).toBe(true);
    expect(r.exitCode).toBe(EXIT.failed);
  });

  it.each([
    ['a tile stopped at the page cap', { tpTruncated: true }, 'travelpayouts stopped at the page cap'],
    ['a row with an unusable price', { tpBadPrice: true }, 'travelpayouts 2027-03-02–2027-03-16 parse'],
  ] as const)(
    '1: %s fails "tiles read whole" (decision 30, prov-wp13-r1-003)',
    async (_label, vendors, detail) => {
      const { r } = await smoke(smokePorts(), cli(), vendors);
      expect(status(r)['tiles read whole']).toBe('fail');
      expect(r.checks.find((c) => c.name === 'tiles read whole')?.detail).toContain(detail);
      expect(r.exitCode).toBe(EXIT.failed);
    },
  );

  it('a truncated tile\'s cheapest reads "cheapest of the rows read" (decision 30)', async () => {
    const { r, urls } = await smoke(smokePorts(), cli(), { tpTruncated: true });
    expect(urls.filter((u) => u.hostname === 'api.travelpayouts.com')).toHaveLength(3);
    expect(lineOf(r, 'travelpayouts discovery: priced')).toContain('(cheapest of the rows read)');
  });

  it('3: no error, but the Travelpayouts tile held no price (Travelpayouts only: no credit)', async () => {
    const ports = smokePorts({ SEARCHAPI_KEY: '' });
    const { r, urls } = await smoke(ports, cli(1), { tpEmpty: true });
    expect(r.exitCode).toBe(EXIT.smokeEmpty);
    expect(r.reports.map((p) => p.status)).toEqual(['empty']);
    expect(r.reports[0]?.detail).toContain('no row in the Aviasales cache for these days');
    expect(r.summary).toBe('no price found');
    expect(urls.map((u) => u.hostname)).toEqual(['api.travelpayouts.com']);
  });
```

- [ ] **Step 2: Run, and prove the assertions bite**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts`
Expected: PASS, 17 tests (Task 13.1 already implements this behaviour; this is a characterisation run). Prove they bite, restoring each change afterwards:
1. In `openHiddenExecution` change `Math.min(run.budget, run.worst.credits)` to `run.worst.credits`. Expected: FAIL in the frozen-cap case ("expected [ …(4) ] to have a length of 3 but got 4": the fourth SearchApi call went out).
2. In `chain`'s `shown`, make the `displayName` condition `true` instead of `o.verified`. Expected: FAIL in the "never sold by" case.

- [ ] **Step 3: Implement**

No new code unless a case fails; fix `smoke.ts` or `smokeChecks.ts`, never the test.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/tools/smoke.test.ts && git commit -m "wp13: smoke exit codes, the frozen cap, the dry run and the decision-44 labels (spec §9 item 7, decisions 20, 30, 44, 66)"
```

### Task 13.3: Arguments, the one-tile query, the fixture target and the airport-pair check

**Preconditions:** Task 13.1.

**Files:**
- Create: `apps/api/test/tools/smokeArgs.test.ts`
- Modify: `.gitignore`

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
import { parseSmokeArgs, SMOKE_RECORDED_BY, smokeFixtureTarget, smokeQuery } from '../../src/tools/smoke.js';
import { metroRuleCheck } from '../../src/tools/smokeChecks.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

describe('parseSmokeArgs', () => {
  it('reads both flag forms through the shared reader, upper-cases the airports and takes the two switches', () => {
    expect(
      parseSmokeArgs([
        '--origin',
        'lhr',
        '--destination=JFK',
        '--budget',
        '8',
        '--confirm-rerun',
        '--dry-run',
      ]),
    ).toEqual({
      ok: true,
      value: { args: { origin: 'LHR', destination: 'JFK', budget: 8 }, confirmRerun: true, dryRun: true },
    });
    expect(parseSmokeArgs(['--', '--origin', 'LHR', '--destination', 'JFK', '--budget', '4'])).toMatchObject({
      ok: true,
      value: { confirmRerun: false, dryRun: false },
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
    expect('refusal' in r && r.refusal).toContain("would put the smoke's fixtures in the recorded tree");
  });
});

describe('metroRuleCheck (plan decision 34): every request on both vendors names the airports', () => {
  const q = { origin: asIata('LHR'), destination: asIata('JFK') };
  const tp = (o: string) => ({
    providerId: 'travelpayouts',
    url: new URL(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${o}&destination=JFK`),
  });
  const sa = (d: string) => ({
    providerId: 'searchapi',
    url: new URL(
      `https://www.searchapi.io/api/v1/search?engine=google_flights&departure_id=LHR&arrival_id=${d}`,
    ),
  });
  it('passes when every request names the airports, fails on a city code on either vendor (positive controls), skips on none', () => {
    expect(metroRuleCheck(q, [tp('LHR'), sa('JFK')]).status).toBe('pass');
    expect(metroRuleCheck(q, [tp('LHR'), tp('LON')])).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('1 named another code'),
    });
    expect(metroRuleCheck(q, [sa('NYC')]).status).toBe('fail');
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
git add .gitignore apps/api/test/tools/smokeArgs.test.ts && git commit -m "wp13: smoke arguments through the shared reader, one-tile query, fixtures beside the database and out of git (decisions 61, 66)"
```

### Task 13.4: `pnpm smoke:live` through the tool bootstrap, and a spawned smoke starts no execution

**Preconditions:** Task 13.1.

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
    expect(text).toMatch(/^cheapest confirmed price £573 · LHR→JFK /m);
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

  it('smoke --dry-run: the same bootstrap, the spend position, nothing sent, no execution (decision 66)', async () => {
    const h = harness();
    const seen = stubSmokeVendors();
    expect(
      await runTool(
        'smoke',
        ['--origin', 'LHR', '--destination', 'JFK', '--budget', '4', '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.ok);
    expect(h.text()).toContain('dry run: nothing sent, no execution opened');
    expect(h.text()).toContain('SearchApi window (trial; SEARCHAPI_TRIAL_USED 0)');
    expect(h.text().indexOf('dry run: nothing sent')).toBeLessThan(h.text().indexOf('tool lock released'));
    expect(seen.urls).toEqual([]);
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM search_executions')).toEqual({ n: 0 });
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
Expected: FAIL, 5 tests: stderr says `smoke:live is not built yet; WP13 adds it` and the exit code is 64 where 0, 2 or 65 is expected.

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
      // why: dated smoke fixtures go beside the database, never into the recorded tree (plan decision 61); a
      // DATABASE_PATH that would put them there is a configuration fault (78). Tests pass their own target, as for recording.
      const target = given ?? smokeFixtureTarget(config.databasePath);
      if ('refusal' in target) {
        err(target.refusal);
        return { ok: false, code: EXIT.badConfig };
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

Everything else in `runTool` is the record tool's path unchanged: the smoke gets the NODE_ENV and synthetic-gate refusals, the data-directory check, the read-only lock probe, the pre-migration backup, the tool lock with heartbeat, seeding, and the release on every path. A dry run takes the lock and seeds too (the plan contract's `--dry-run`: "builds ports and takes the lock without any vendor call").

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/api exec vitest run test/bootstrap`
Expected: PASS; the five smoke cases among them.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/tool.ts apps/api/test/bootstrap && git commit -m "wp13: pnpm smoke:live and its dry run through the tool bootstrap; a spawned smoke starts no execution (spec §7, §9 item 7)"
```

### Task 13.5: Mount `POST /api/tools/smoke`

**Preconditions:** Task 13.1.

**Files:**
- Create: `apps/api/test/routes/toolsSmoke.test.ts`
- Modify: `apps/api/src/routes/types.ts`, `apps/api/src/routes/tools.ts`, `apps/api/src/app.ts`, `apps/api/src/tools/inProcess.ts`, `apps/api/src/text.ts`, `apps/api/test/routes/tools.test.ts`, `apps/api/test/routes/contract-sweep.test.ts`

**Interfaces:**
- Consumes: `route`, `NO_INPUT`, `oneAtATime`, `ApiError`, `API_TEXT`, `safeMessage`, `runSmoke`, `createHarness`, `expectContract`, `errorOf`.
- Produces: `HttpToolRunners.smoke`, `ToolSmokeRequest`, the `'POST /api/tools/smoke'` handler; `OWNED_ELSEWHERE` removed; `API_TEXT.toolSynthetic(name)`.

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
    await x.request('/api/tools/smoke', { method: 'POST', json: { ...body, dryRun: true } });
    expect(smoke.mock.calls[1]?.[0]).toEqual({ ...body, dryRun: true });
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
    expect(r?.summary).toMatch(/^cheapest confirmed price £573 · LHR→JFK /);
    expect(seen.urls).toHaveLength(5);
    expect(JSON.stringify(r)).not.toContain(SENTINEL_SA);
    // why: decision 66: the operator's dry run goes through the route too, on the container's one ledger
    const dry = await inProcessTools(ports).smoke?.(
      apiContract.toolSmokeRequestSchema.parse({ ...body, budget: 8, dryRun: true }),
      new AbortController().signal,
    );
    expect(dry?.exitCode).toBe(0);
    expect(dry?.lines.at(-1)).toBe('dry run: nothing sent, no execution opened');
    expect(dry?.lines[2]).toBe(
      'SearchApi credits already ledgered to tool runs in this budget window: 4; this run ≤4; --budget 8',
    );
    expect(seen.urls).toHaveLength(5);
  });
});
```

`apps/api/test/routes/tools.test.ts`: the case `503 when the runner is not registered; the smoke route is not mounted by WP8` becomes `503 when the runner is not registered` and loses its last four statements (the smoke request and its `not_found` expectation).

`apps/api/test/routes/contract-sweep.test.ts`: delete the `OWNED_ELSEWHERE` import; `const mounted = apiContract.ROUTES;` (every entry, the smoke route included: with no runner registered it answers the 503 envelope); the sweep case is titled `every ROUTES entry is mounted with its method and auth flag, and answers the contract or the envelope`; `apiTexts()` lists `API_TEXT.toolSynthetic('record')` in place of `API_TEXT.toolSynthetic`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/api exec vitest run test/routes/toolsSmoke.test.ts test/routes/contract-sweep.test.ts`
Expected: FAIL: the smoke route answers 404 `not_found`, the in-process runner has no `smoke`, and the sweep cannot import `OWNED_ELSEWHERE` once Step 3 removes it (`pnpm --filter @gmt/api typecheck` also reports `smoke` missing on `HttpToolRunners` and `toolSynthetic` not callable).

- [ ] **Step 3: Implement**

`apps/api/src/routes/types.ts`: the tool types gain the smoke, and `OWNED_ELSEWHERE` (and its doc comment) is deleted:

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
```

`apps/api/src/app.ts`: drop `OWNED_ELSEWHERE` from the `./routes/types.js` import, delete the line `if (OWNED_ELSEWHERE.has(key)) continue; …` in the mounting loop, and the `createApp` doc comment's strict rule reads "a ROUTES entry without a handler, a handler without a ROUTES entry, or a handler whose schemas are not its entry's refuses to build".

`apps/api/src/text.ts`: `toolSynthetic` takes the tool name, like `toolUnavailable`, `toolBusy` and `toolFailed`:

```ts
  toolSynthetic: (name: string) => `the ${name} tool refuses while the synthetic gate is open (spec §5.5)`,
```

`apps/api/src/routes/tools.ts`: one in-process runner for both routes:

```ts
/** Spec §10 `/tools/record` and `/tools/smoke`: the scripts inside the app process, which holds app_lock (spec §7). */
import { apiContract } from '@gmt/core';
import type { Context } from 'hono';
import { ApiError } from '../errors.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, route } from './define.js';
import { oneAtATime } from './shared.js';
import type { AppEnv, HandlerTable, RouteContext, ToolRunResponse } from './types.js';

const TOOL_KEY = 'tool';

/**
 * One tool run inside the app process, the same for both tools: an unregistered runner is 503; one tool at a time,
 * whichever it is (spec §10 `/tools/*`: one key, the contract's 409 tool_busy); a runner that throws is 500 with a
 * scrubbed log line. why: the request's own signal ends the run when the client disconnects, as SIGINT ends the CLI run.
 */
async function runInProcess<A>(
  c: Context<AppEnv>,
  ctx: RouteContext,
  name: 'record' | 'smoke',
  runner: ((args: A, signal: AbortSignal) => Promise<ToolRunResponse>) | undefined,
  args: A,
): Promise<Response> {
  if (runner === undefined) throw new ApiError(503, 'tool_unavailable', API_TEXT.toolUnavailable(name));
  return oneAtATime(
    ctx,
    TOOL_KEY,
    async () => {
      try {
        return c.json(await runner(args, c.req.raw.signal));
      } catch (err) {
        ctx.ports.log.error(
          { tool: name, err: { message: safeMessage(err, ctx.ports.secrets) } },
          'tool failed',
        );
        throw new ApiError(500, 'tool_failed', API_TEXT.toolFailed(name));
      }
    },
    () => new ApiError(409, 'tool_busy', API_TEXT.toolBusy(name)),
  );
}

export const toolHandlers: HandlerTable = {
  /** Refused with 409 inside a container (decision 62), then `runInProcess`. */
  'POST /api/tools/record': route(
    { request: apiContract.toolRecordRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      // why: plan decision 62: recordings are local-only (decision 61), so the route refuses inside a container.
      // `inContainer` is IN_CONTAINER, read by the bootstrap's config parse and passed in on the ports.
      if (ctx.ports.config.inContainer)
        throw new ApiError(409, 'recording_in_container', API_TEXT.recordingInContainer);
      return runInProcess(c, ctx, 'record', ctx.tools.record, body);
    },
  ),
  /**
   * Spec §10, §13: the smoke runs inside the app process, in a container too (the operator calls it with curl from the
   * host; decision 62 refuses only recording there). The exit code, lines and an empty fixture list come back in the body.
   */
  'POST /api/tools/smoke': route(
    { request: apiContract.toolSmokeRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => runInProcess(c, ctx, 'smoke', ctx.tools.smoke, body),
  ),
};
```

`apps/api/src/tools/inProcess.ts`: the file comment names `runRecord` and `runSmoke`; import `runSmoke` from `'./smoke.js'`; `refused` takes the tool name, and the record runner's three refusals pass `'record'` (`API_TEXT.toolSynthetic('record')` for the gate):

```ts
/** A refusal before the tool runs, in the tool response shape, for either tool. */
function refused(name: 'record' | 'smoke', exitCode: number, line: string): ToolRunResponse {
  return {
    exitCode,
    summary: API_TEXT.toolSummary(name, exitCode, 0),
    lines: [line],
    fixturesWritten: [],
  };
}
```

and the smoke runner follows `record`:

```ts
    // why: the app's ports and ledger; no fixtures (the route says so), no --confirm-rerun over HTTP, the synthetic
    // gate refused with the CLI's code 70 (WP13)
    smoke: async (args, signal) => {
      if (syntheticAllowed(ports.config))
        return refused('smoke', EXIT.refusedTestEnv, API_TEXT.toolSynthetic('smoke'));
      const r = await runSmoke(
        ports,
        {
          args: { origin: args.origin, destination: args.destination, budget: args.budget },
          confirmRerun: false,
          dryRun: args.dryRun === true,
        },
        { signal, fixtures: null },
      );
      return { exitCode: r.exitCode, summary: r.summary, lines: r.lines, fixturesWritten: [] };
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS with the package thresholds (85/70; `src/routes/**` 90/80). On the assembly: 37 files passed and 1 skipped (the recorded manifest, visibly), 449 tests passed and 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp13: mount POST /api/tools/smoke through one in-process runner; every ROUTES entry mounted by apps/api (spec §10, §13)"
```

### Task 13.6: Layer-B engine tests, one copy of the skip guard, and its CI note

**Preconditions:** Task 13.1 (none of 13.2–13.5); the layer-B run with recordings needs the operator's local WP4b recordings.

**Files:**
- Create: `packages/providers/src/testing/recordings.ts`, `packages/engine/test/layerB/support.ts`, `packages/engine/test/layerB/layerB.test.ts`
- Rename: `packages/providers/test/support/recordings.test.ts` → `packages/providers/test/testing/recordings.test.ts`
- Delete: `packages/providers/test/support/recordings.ts`, `apps/api/test/helpers/recordings.ts`, `apps/api/test/recorded/recordings.test.ts`
- Modify: `packages/providers/src/testing/index.ts`, `packages/providers/test/travelpayouts/replay.test.ts`, `packages/providers/test/searchapi/recorded.test.ts`, `apps/api/test/recorded/manifest.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `createEngine`, `fxHttpLimits`, both adapters and their limits and params, `budgetConfigFromConfig`, `seedAirports`, `guardedServer`, `replayHandlers`, `loadRecorded`, `capturingLogger`, `capturingNotifier`.
- Produces: `recordingsPresent`, `skipTitle`, `SKIP_SUFFIX` on `@gmt/providers/testing`.

The recorded WP4b session (local-only, decision 61) holds one LHR → JFK SearchApi calendar rectangle for 2027-03-01..09 × 2027-03-11..30 (the production 9 × 20 shape, decision 29), the Travelpayouts LHR → JFK March month tile, and one google_flights chain for one cell. Layer B runs the engine over exactly those requests. The recorded March tile holds three rows, none departing on the 1st to the 9th, so the first case also pins that an Aviasales cache without a row records `no_data`, never `empty`, and a second case reads Travelpayouts provenance from a 2027-03-15..17 window the same month tile prices.

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
  seedAirports,
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
/**
 * WP4b's signature, mirroring RECORDED_BY in apps/api/src/tools/record.ts (engine may not import apps/api, spec §4); the
 * smoke's own recordings live beside its database, never here (decision 61).
 */
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

/**
 * Engine deps over the real adapters, with the recorded session installed on the guarded msw server. why: the provider
 * and http-limit construction mirrors apps/api/src/wiring.ts `providersFor` and `httpLimitsFor` (engine may not import
 * apps/api); a change there must be repeated here, and layer B then fails on a request the recording does not hold.
 */
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
  seedAirports(db, loadAirportsDataset(AIRPORTS_DATA_DIR));
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
import { z } from 'zod';
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
  fx_converted: number;
}
interface ObservationRow {
  provider_id: string;
  seller: string;
  source_kind: string;
  max_age_hours: number | null;
  point_of_sale: string;
  fetched_at: string;
  fx_converted: number;
  supplied_fields_json: string;
  booking_json: string | null;
}
/** A stored booking, read as unknown and narrowed (no cast; arch-wp13-r1-009). */
const bookingSchema = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.string(), url: z.string() }),
]);
const suppliedSchema = z.array(z.string());

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
          'SELECT provider_id, source_kind, point_of_sale, max_age_hours, fetched_at, provider_observed_at, reused_from_execution_id, fx_converted FROM calendar_prices WHERE execution_id = ?',
        )
        .all(first.executionId);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.reused_from_execution_id).toBeNull();
        expect(r.fx_converted).toBe(0); // GBP from the vendor, never converted (Global Constraints)
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

    it('verification: the recorded chain for its cell as a child execution, scraped-search provenance, every offer naming its seller and at least one price confirmed by a seller listing (spec §5.4; decisions 27, 37)', async () => {
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
        .prepare<[string], ObservationRow>(
          `SELECT o.provider_id, o.seller, p.source_kind, p.max_age_hours, p.point_of_sale, p.fetched_at, p.fx_converted,
                  p.supplied_fields_json, p.booking_json
             FROM price_observations p JOIN fare_offers o ON o.id = p.offer_id WHERE p.execution_id = ?`,
        )
        .all(child.executionId);
      expect(obs.length).toBeGreaterThan(0);
      let confirmed = 0;
      for (const o of obs) {
        expect([o.provider_id, o.source_kind, o.max_age_hours, o.point_of_sale, o.fx_converted]).toEqual([
          'searchapi',
          'scraped-search',
          null,
          'GB',
          0,
        ]);
        expect(o.fetched_at >= at).toBe(true);
        expect(o.seller.trim()).not.toBe('');
        // why: decision 37: an offer whose price is not a supplied field is "price not confirmed by the final step"
        if (suppliedSchema.parse(JSON.parse(o.supplied_fields_json)).includes('price')) confirmed += 1;
        const booking = bookingSchema.parse(
          o.booking_json === null ? { kind: 'none' } : JSON.parse(o.booking_json),
        );
        if ('url' in booking) expect(new URL(booking.url).hostname.endsWith('google.com')).toBe(true);
      }
      expect(confirmed).toBeGreaterThan(0);
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

- [ ] **Step 3: Implement: one copy of the guard in `@gmt/providers/testing`**

`packages/providers/src/testing/recordings.ts` (the providers helper's code, now the one copy):

```ts
/**
 * The one gate for tests that replay the vendor recordings, shared by api, providers and the engine's layer-B suite
 * (WP13 moved it here from two test helpers; its unit test is test/testing/recordings.test.ts). The recordings
 * (`fixtures/recorded/**\/*.json` except the tracked `params-*.json`) are gitignored and local-only (plan decisions 61
 * and 64), so a fresh checkout has none; the suites that need them skip visibly instead of failing or passing
 * vacuously.
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
export { recordingsPresent, SKIP_SUFFIX, skipTitle } from './recordings.js'; // decisions 61, 64: the one visible-skip guard
```

Delete the two helper copies and the api's second unit test of the same guard; repoint the importers: `apps/api/test/recorded/manifest.test.ts` imports `recordingsPresent` and `skipTitle` from `'@gmt/providers/testing'`; `packages/providers/test/travelpayouts/replay.test.ts` and `test/searchapi/recorded.test.ts` from `'../../src/testing/recordings.js'`; `git mv packages/providers/test/support/recordings.test.ts packages/providers/test/testing/recordings.test.ts` with its import changed to `'../../src/testing/recordings.js'` (its cases are unchanged).

`.github/workflows/ci.yml`, in the `test` job after the test steps (on main since WP10: `pnpm -r --workspace-concurrency=1 test`, then `pnpm exec vitest run --project scripts`; the decision-61 CI note): every guarded suite must report its own skip by title, and `shell: bash` makes a failing suite fail the step through `tee`:

```yaml
      # why: recorded vendor responses are local-only (plan decisions 61, 64), so this fresh checkout has none. Every suite
      # that replays them must report its skip by title, never pass vacuously; `shell: bash` adds -o pipefail, so a
      # failing suite fails the step even through tee.
      - name: recording-dependent suites skip visibly (decision 61)
        shell: bash
        run: |
          pnpm exec vitest run --project api --project providers --project engine test/recorded/ test/searchapi/recorded.test.ts test/travelpayouts/replay.test.ts test/layerB/ --reporter=verbose | tee recorded-skip.log
          suffix='(skipped: recordings not present, local-only, decision 61)'
          for title in \
            'committed recorded tree for the worked example' \
            'recorded Travelpayouts fixtures (WP4b) replay through replayHandlers (plan decision 17: one session)' \
            'WP4b recordings this brief relies on (§7 "Inputs from WP4b") — pending-fixtures' \
            'SEARCHAPI_PARAMS against the recording (spec §5.2, plan decision 24) — pending-fixtures' \
            'recorded replay through the adapter (spec §5.2, §5.4, §9 item 2) — pending-fixtures' \
            'layer B: the engine over the real adapters on the recorded session (spec §9 item 4)'; do
            grep -qF "$title $suffix" recorded-skip.log || { echo "not skipped visibly: $title"; exit 1; }
          done
```

- [ ] **Step 4: Run to verify it passes**

On a checkout without recordings (CI, a fresh clone):
Run: `pnpm --filter @gmt/engine exec vitest run test/layerB --reporter=verbose`
Expected: 3 tests skipped, each title ending `(skipped: recordings not present, local-only, decision 61)`.

On the operator's machine, with the WP4b recordings in `packages/providers/fixtures/recorded`:
Run: `pnpm --filter @gmt/engine exec vitest run test/layerB`
Expected: PASS, 3 tests (the assembly ran them against the local recordings of session `20261015T035035045Z-b1f7d7`).

Then: `pnpm --filter @gmt/providers test`, `pnpm --filter @gmt/engine test` and `pnpm --filter @gmt/api test` exit 0 with their thresholds; and the CI step's commands, run under `bash -eo pipefail` from the repository root on the fresh assembly, exit 0 (each of the six titles found).

- [ ] **Step 5: Commit**

```bash
git add -A packages/providers packages/engine/test/layerB apps/api/test .github/workflows/ci.yml && git commit -m "wp13: layer-B engine tests on the recorded session, one skip guard, CI checks every skip by title (spec §9 item 4, decisions 61, 64)"
```

### Task 13.7: Document the smoke test in `docs/setup.md` (decision 63)

**Preconditions:** WP12 merged to `main` and this branch rebased onto it; re-read `docs.test.ts`'s section headings (`## 8. Fixture recording`, `## 10. Exit codes` … `## 11.`) before editing, since this task was not assembled.

WP12 wrote `docs/setup.md` and `apps/api/test/deploy/docs.test.ts` and kept the smoke out of both. This task adds it in a new last section, so no test that quotes a section heading moves.

**Files:**
- Modify: `docs/setup.md`, `apps/api/test/deploy/docs.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/test/deploy/docs.test.ts`: import `apiContract` from `@gmt/core`; in `describe('docs/setup.md exit codes …')` delete the comment `// why: the smoke test's 2 and 3 are documented by WP13 with its route (decision 63)` (the test is unchanged: `EXIT` holds 2 and 3 since Task 13.1, so the table must list them); in `describe('docs/setup.md operations rules …')` replace `leaves the smoke test to WP13 (decision 63)` with:

```ts
  it('documents the smoke test: a dry run first, the route with a prompted password and valid bodies, the budget per database, the command line, where fixtures go (WP13, decision 66)', () => {
    expect(setup).toContain(
      "curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \\",
    );
    expect(setup).toContain('-X POST http://127.0.0.1:3000/api/tools/smoke');
    const body = /-d '(\{[^']*\})'/.exec(setup)?.[1] ?? '';
    expect(apiContract.toolSmokeRequestSchema.parse(JSON.parse(body))).toMatchObject({ dryRun: true });
    expect(flat).toContain('Each database keeps its own count of the SearchApi credits tool runs have used');
    expect(flat).toContain('SEARCHAPI_TRIAL_USED');
    expect(setup).toContain('pnpm smoke:live --origin LHR --destination JFK --budget 8 --dry-run');
    expect(flat).toContain('smoke/fixtures/recorded');
    expect(flat).toContain('The app writes no fixtures for a smoke test it runs');
    expect(flat).toContain('`2` and `3`');
    expect(flat).not.toContain('--confirm-rerun');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts`
Expected: FAIL in two cases: the exit-code table lacks 2 and 3, and `setup.md` has no smoke text.

- [ ] **Step 3: Implement**

`docs/setup.md` section 10: the opening sentence and the rows for 1, 65 and 78 change, and rows 2 and 3 are added (the table stays in code order):

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
| 65 | a recording or smoke test refused for spend: with earlier tool runs in this database it would exceed the budget you gave (raise it only when you mean to spend more), or a provider's budget window has less room than the run needs |
| 70 | refused because `NODE_ENV=test`, or because fixture data is enabled |
| 73 | the data directory or `<data dir>/backups` is not writable, the database lock cannot be read, or the pre-migration backup cannot be attempted |
| 74 | a backup failed (boot, `scripts/backup.mjs`) or is unusable (`scripts/check-backup.mjs`); at boot, migrations were not applied |
| 75 | the database lock is held by another running app or tool |
| 78 | bad configuration; the message names every variable to fix (for the smoke test, also a `DATABASE_PATH` that would put its fixtures inside the repository's recorded fixture tree) |
````

`docs/setup.md`, a new last section after section 12:

````markdown
## 13. The smoke test

The smoke test asks each configured provider for one small search and checks what comes back:
Travelpayouts one month of cached prices (a free call), SearchApi one date grid and one
itinerary search for its cheapest day pair (at most 4 credits). It prints the cheapest price a
seller confirmed (or, without one, the cheapest calendar price, labelled as such, with its
age), then a checklist. Run it after setup, after changing a key, and whenever prices look
wrong.

Each database keeps its own count of the SearchApi credits tool runs have used (smoke tests and
fixture recordings): the container's volume one, a development checkout's `data/dev.db`
another. `budget` is the most that count may reach in the current budget window, this run
included. On the trial plan, first set `SEARCHAPI_TRIAL_USED` in `.env` to the credits the
SearchApi dashboard shows as used before this app counted any, so the app's window matches the
vendor's.

Start with a dry run. It sends nothing and shows the count so far, the plan and the window;
curl asks for the password:

```bash
curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -X POST http://127.0.0.1:3000/api/tools/smoke -d '{"origin":"LHR","destination":"JFK","budget":8,"dryRun":true}'
```

Its first report line reads `SearchApi credits already ledgered to tool runs in this budget
window: N`. Choose `budget` as N plus 4, then send the same request without `"dryRun":true`.
When this run's 4 credits would go beyond `budget`, or the window has no room left, the smoke
test refuses with code 65 before sending anything. The answer's `exitCode` uses the table in
section 10, and `lines` holds the report. The app writes no fixtures for a smoke test it runs.

With the app stopped, on a development checkout, the same test runs from the command line
against that checkout's database:

```bash
pnpm smoke:live --origin LHR --destination JFK --budget 8 --dry-run
pnpm smoke:live --origin LHR --destination JFK --budget 8
```

It also writes what the vendors answered, dated, under `smoke/fixtures/recorded` beside the
database (`data/smoke/fixtures/recorded` for `data/dev.db`). Git ignores those files and they
stay on that machine, like every recorded vendor response (section 8).

Each checklist line reads `ok`, `FAIL`, `skip` or `look`:

- `one tile per provider`, `tiles read whole`: each provider was asked once, and every page
  and day of its answer was read.
- `ledger`: every answer the run received is in the database's request log, and the credits
  stayed inside this run's limit.
- `provenance`: each price shown carries the source, fetch time, point of sale and age limit
  its provider declares. This checks the providers' answers; the stored records are checked by
  the app's own tests.
- `airport pairs (metro rule)`: both providers were asked for the airports you named, never a
  city code.
- `9-day rectangle`, `step 1 = step 2`, `sellers`: SearchApi accepted the date grid the app
  uses, the return search priced the outbound it was asked about at the same price, and at
  least one offer was confirmed by a seller; an offer the last step did not confirm reads
  "price not confirmed by the final step".
- `open-jaw drop`, `age labels`, `separate tickets excluded` (`look`): compare these by eye with
  Google Flights and Aviasales for the same airports and dates; `open-jaw drop` lists the days
  where Travelpayouts rows that fly back to another airport were left out.

Codes `2` and `3` are not faults of the app: `2` means no provider key is set; `3` means a
provider had no price for those days.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy`
Expected: PASS. The banned-word scan passes (`smoke:live` is core's allowlisted token); the place scan sees only LHR and JFK.

- [ ] **Step 5: Commit**

```bash
git add docs/setup.md apps/api/test/deploy/docs.test.ts && git commit -m "wp13: setup doc: the smoke test, its dry run, the budget per database, exit codes 2 and 3 (decisions 63, 66)"
```

### Task 13.8: The operator's vendor steps on one ledger, and the WP5/WP6 smoke rows

**Preconditions:** operator-only; Ian's `.env` and Ian's approval of Step 0's figures, recorded in the PR before Step 1; WP12 merged and the container built from this branch (the route is WP13's); Tasks 13.1–13.7 merged into the branch. Everything before this task is offline.

**One ledger, one ceiling** (decision 66). Every vendor step of this task and of Task 13.9's trace runs in the container, through the route, on the container's database, so one ledger counts all of them; the development checkout's `pnpm smoke:live` is not used here (its database is another ledger, cost-wp13-r1-001). The ceiling is **24 SearchApi credits** across all of them, re-runs included, against a trial balance of about 87:

| Step | Worst case (credits) |
|---|---|
| Smoke, first run | 4 |
| Smoke, one re-run if the first exits 3 (another destination) | 4 |
| Smoke, one re-run after a fix, if one is needed | 4 |
| Task 13.9's trace: Travelpayouts discovery | 0 (free) |
| Task 13.9's trace: one per-cell verification child | its call cap, shown before it starts (at most 6 at the default `CHILD_MAX_CALLS`) |
| Margin | 6 |

The smokes are held to it by `budget`: every smoke sends `budget` = the dry run's "already ledgered" figure plus 4, and never above 18 (24 less the child's cap and nothing else), so the cross-run rule refuses any smoke beyond that with 65 before it sends anything. The trace's child is held by its own cap, which the verify control shows before it runs. A dry run costs nothing and may be repeated. Stop and ask Ian if the SearchApi dashboard ever shows more than 24 credits used since Step 0.

- [ ] **Step 0: Window, dry run, approval**

1. Read the SearchApi dashboard: credits used and remaining, and the plan. Record both.
2. On the trial plan set `SEARCHAPI_TRIAL_USED` in `.env` to the dashboard's used figure less any SearchApi calls the container's database already ledgered (a fresh volume has none), so the app's window equals the vendor's (cost-wp13-r1-004). On the 40usd plan the variable is ignored; record the dashboard's month figure instead. Apply it: `docker compose up -d --wait`.
3. Dry run through the route (docs/setup.md section 13):

```bash
curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -X POST http://127.0.0.1:3000/api/tools/smoke -d '{"origin":"LHR","destination":"JFK","budget":4,"dryRun":true}'
```

Expected: `exitCode` 0, `lines` ending `dry run: nothing sent, no execution opened`, with `SearchApi credits already ledgered to tool runs in this budget window: N`, `this run: at most 4 SearchApi credit(s), frozen at 4 by --budget 4` and `SearchApi window (trial; SEARCHAPI_TRIAL_USED T): U of C used …; room R`. Record N, T, U, C, R beside the dashboard's figures; a difference between the app's window and the dashboard's is a finding to settle before Step 1.
4. Put the ceiling table, the figures and the planned `budget` values in the PR; Ian approves them there.

- [ ] **Step 1: The smoke through the route**

Send Step 0's request with `"budget": N + 4` and without `"dryRun": true`.
Expected: HTTP 200, `exitCode` 0, the checklist in `lines` with no `FAIL`, the last line `fixtures not written (app process)`, `fixturesWritten: []`. On `exitCode` 3 (an Aviasales cache without a row for next month's first nine days), dry-run again for the new N and send `"destination": "EWR"` with `budget` N + 4; record which. To see the cross-run refusal without spending, send `budget` equal to the dry run's N: it answers 65 before any request. Never send a second full run to "check" the rule, and never raise `budget` past 18.

Record in the PR, under "WP13 smoke rows", the whole report of every run: each provider line and every checklist line with its status. A line that stayed `skip` is an open item with its reason, never a pass. Rows 4, 5 and 8 below need at least one run in which every configured provider priced (`exitCode` 0); until then they stay open.

- [ ] **Step 2: The smoke rows the adapters' briefs left for WP13**

1. **One fare against the vendor's own page (decision 27).** Open Google Flights for the chain's cell (the `searchapi itinerary` line's airports and dates), economy, one adult, GBP. Record the cheapest option there, its price and seller, beside the smoke's headline (`cheapest confirmed price …`) and its cheapest offer. A difference beyond a few pounds is a finding against WP5.
2. **The 9-day rectangle (decisions 27, 29).** The `9-day rectangle` line reads `ok` with `9 × 20 = 180 combinations, accepted`.
3. **`separate_tickets=1` excludes separate tickets (decisions 27, 29).** For the same cell, list the Google Flights options marked "separate tickets"; none may match an offer in the smoke's report. The `separate tickets excluded` line reads `look` with `split bookings skipped:` naming any.
4. **Travelpayouts against the Aviasales page (WP6 §13 item 2).** Take the `travelpayouts discovery` line's cheapest row (airports and dates) and open the Aviasales search for them; record the price shown and the passenger count the page assumes. The provenance note names a passenger count only after this row.
5. **Age labels.** The `age labels` line shows Travelpayouts as `observed …` (decision 35) and SearchApi as `provider age unknown (≤1d before that)` for the date grid and `vendor's cache age unknown` for the itinerary. Record whether the Aviasales page's own age hint agrees.
6. **Route-history scope (WP5 §13).** The `route history` line shows what step 1 supplied for the smoke's cell. Task 13.9's trace stores the series step 1 supplies for its own cell (`GET /api/routes/LHR/JFK/history`). Pick the trace's cell on another day than the smoke's; if both series are supplied and differ for the same dates, the spec §7 "route-level" label (or `route_price_history`'s key) changes at the next spec revision; if they agree, it stands; if either is absent (decision 40), record that and leave the question open.
7. **`show_cheapest_flights` (WP5 §13).** Not run: the adapter's allowlist refuses the parameter, and decision 66 keeps every vendor step on the app's ledger. Recorded as a follow-up (§13 item 10).
8. **Open-jaw drop and airport pairs.** The `airport pairs (metro rule)` line reads `ok`. The `open-jaw drop` line lists the cells where Travelpayouts rows that fly back to another airport were dropped; open one on the Aviasales site and record whether a return to another London airport appears there.

- [ ] **Step 3: Close**

Read the dashboard again and record the credits used since Step 0; they must equal the app window's increase (the dry run's `U` before and after, Task 13.9's trace included once it has run). Nothing in the repository changes unless a row produced a finding; such a fix is its own commit with a regression test, and re-checking it uses a dry run or the offline tests, not another smoke unless the ceiling table still has room.

### Task 13.9: Final pass: the whole-branch review, the integration checks, one real price end to end, the release

**Preconditions:** WP10, WP11 and WP12 merged to `main` and the branch rebased onto them; Task 13.8 recorded in the PR; the tag only after every finding of Step 1 is addressed.

- [ ] **Step 1: The whole-branch review**

Run the review on the Fable model (the brief's owner; suggested because it holds the plan and the contracts): dispatch every reviewer of `.claude/agents/` over the branch diff (`git diff main...wp/13-smoke-and-final-pass`) and over the assembled tree at the branch head, each reading the spec, the plan and this brief. Name one focus explicitly: provenance from a vendor's response to the rendered cell (adapter → normalisation → `calendar_prices`/`price_observations` → API → each view's PriceCell), with Step 3's trace and screenshots as evidence. Every finding is addressed, all severities (the operator's standing rule); a finding that needs judgment is ruled on and recorded as a plan decision. Fixes land on this branch with tests.

- [ ] **Step 2: The integration checks**

Record each command's output in the PR under "WP13 integration review"; a failure is fixed on this branch before the tag.

1. `pnpm install --frozen-lockfile && pnpm build` exits 0.
2. `pnpm lint`, `pnpm -r typecheck`, `pnpm boundaries`, `pnpm casts` are clean (`pnpm casts` prints `0 casts`).
3. `pnpm -r --workspace-concurrency=1 test` exits 0 (each package's own script and thresholds; WP10 found the root run ignores them) with the thresholds: `core` 100/100/100/100; `db`, `providers`, `engine`, `api` ≥ 85% lines and ≥ 70% branches (api's `src/read/**` and `src/routes/**` 90/80; the providers adapter floors); `web` ≥ 70/60.
4. The CI step of Task 13.6 passes on a fresh clone (no recordings): each of the six guarded suites reports its skip by title.
5. `pnpm mutate` exits 0 with a mutation score ≥ 80% over the files in `packages/core/stryker.config.json`.
6. `pnpm secret-scan` prints `secret scan: clean`; `git ls-files | rg '\.env$|\.db$|backups/|fixtures/recorded/.*/[0-9].*\.json$'` prints nothing; `git log --all --format= --name-only -- packages/providers/fixtures/recorded | rg -v 'params-|\.gitkeep'` prints nothing (decision 61's purge).
7. Each spec §9 item maps to a passing file: core (`packages/core/test`), providers (`packages/providers/test`, the adapters' recorded suites with recordings present), db (`packages/db/test`), engine layer A (`packages/engine/test/*.test.ts`) and layer B (`packages/engine/test/layerB`), api (`apps/api/test`, the contract sweep, the boot matrix and spawn tests), web (`apps/web/test`, the Playwright fixture-mode smoke), the scripts (`pnpm smoke:live` and its tests, `record:fixtures` and its tests), the build (CI's docker job).
8. Docker: `docker build -t get-me-there:v0.1.0-rc .` succeeds; `docker run --rm get-me-there:v0.1.0-rc sh -c 'command -v curl'` exits non-zero (spec §13: no curl in the image); WP12's `docker` CI job is green.
9. A fresh clone in Docker following `docs/setup.md` literally (sections 1, 2 and 6): `docker compose up -d --wait`, `curl -fsS http://127.0.0.1:3000/api/health` answers `{"ok":true,"degraded":false}`, and section 13's dry run (`"dryRun": true`) answers `exitCode` 0 with nothing sent. The fresh clone sends no full smoke: Task 13.8's run is the evidence (cost-wp13-r1-002). Where the doc and the run differ, fix the doc and re-run from the top with health checks and dry runs only.
10. A manual walkthrough in fixture mode with every vendor key cleared, so no real vendor is reachable: `SEARCHAPI_KEY= TRAVELPAYOUTS_TOKEN= ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake NODE_ENV=development DATABASE_PATH="$PWD/data/walkthrough.fixture.db" BIND_ADDRESS=127.0.0.1 pnpm dev`. Import the example, run it, and check the four views at 1280 px and 375 px against spec §11 (the synthetic banner, provenance on every price without hover, the six coverage buckets summing to the cell count, the class badge, price and provenance visible at 375 px). Afterwards `sqlite3 data/walkthrough.fixture.db "SELECT COUNT(*) FROM provider_requests WHERE provider_id IN ('searchapi','travelpayouts')"` prints 0. Screenshots stay outside the repository.
11. No synthetic row reached a real database (prov-wp13-r1-015): `SELECT COUNT(*) FROM calendar_prices WHERE source_kind = 'synthetic'` and the same for `price_observations` print 0 on `data/dev.db` and on the container's database (`docker compose exec app node -e …` through the app's own `@gmt/db` client, or a copy of a backup).

- [ ] **Step 3: One real price end to end (decision 66)**

In the container, on the ledger of Task 13.8 and inside its ceiling:

1. Create a definition (Definitions view, or `POST /api/definitions`): LHR → JFK only, an absolute window covering next month's first nine days (the smoke's month), 10–21 nights, economy, discovery `['travelpayouts']` and verification `[]`, no schedule; budget `maxCalls` 6 and `maxCostMicroGbp` 6 × the configured SearchApi per-call rate (the later child inherits every cap but `maxCalls`; the run itself calls only Travelpayouts, which bills nothing). Run it and wait for `completed`.
2. Edit it to verification `['searchapi']` (the run is over, so the snapshot of a later child is the edited definition), open the cell detail of one priced cell on another day than the smoke's chain cell, read the verify control's call cap and remaining headroom, and confirm the cap fits the ceiling's row for the trace. Then verify that one cell and wait for the child to settle.
3. Follow the prices through each layer and record what each shows in the PR:
   - **Database:** the run's `calendar_prices` rows carry `provider_id` `travelpayouts`, `source_kind` `authorised-cached`, `point_of_sale` `unknown`, `fx_converted` 0 and a `provider_observed_at`; the child's `price_observations` carry `scraped-search`, `point_of_sale` `GB`, and an offer without `price` among its supplied fields for every step-2 price.
   - **API:** `GET /api/definitions/:id/results`, `…/calendar`, `…/cells/LHR/JFK/<dep>/<ret>` and `GET /api/routes/LHR/JFK/history` return those prices, each with full provenance and `stale`.
   - **Views:** Results, Calendar, Duration, Coverage, the cell panel and History show each price with provider, source, age and FX status without hover; the step-2 offer carries "price not confirmed by the final step"; no synthetic banner appears. Screenshots outside the repository.
4. The dry run of Task 13.8 Step 0, sent again, shows the window's increase; the dashboard agrees.

- [ ] **Step 4: Release**

```bash
git switch main && git merge --no-ff wp/13-smoke-and-final-pass -m "wp13: smoke test, layer B, smoke docs, final pass"
pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint && pnpm -r typecheck
git tag -a v0.1.0 -m "get-me-there v0.1.0: Phases 1–3 per the design spec"
git push origin main v0.1.0
```

Expected: every command exits 0, and `git tag -l v0.1.0` prints `v0.1.0`.

## 9. Pinned review-focus tests

The plan's five Review Focus lines belong to WP0–WP10; Task 13.9 Step 2 item 7 re-runs them with the rest. WP13 pins its own:

- The smoke exits 0 with provenance, the confirmed headline, the checklist and the ledger proof: Task 13.1.
- The guard refuses beyond min(`--budget`, worst case) before the fetch; the recording spend rules refuse with 65 before any request; a dry run sends nothing: Task 13.2.
- An unconfirmed price is never "sold by"; a partial tile fails the run: Task 13.2.
- A spawned smoke starts no execution and releases the lock: Task 13.4.
- The smoke route runs inside a container and shares the one-tool-at-a-time key; every ROUTES entry is mounted: Task 13.5.
- Layer B over the real adapters, and an empty cache recorded as `no_data`; every guarded suite skips visibly by title in CI: Task 13.6.

## 10. Definition of done

- `pnpm install --frozen-lockfile && pnpm build` exits 0; `pnpm lint`, `pnpm -r typecheck`, `pnpm boundaries`, `pnpm casts` are clean.
- `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts test/tools/smokeArgs.test.ts test/routes/toolsSmoke.test.ts` passes 43 tests (17, 19, 7); `pnpm --filter @gmt/api exec vitest run test/bootstrap -t smoke` passes the 5 smoke cases.
- `pnpm --filter @gmt/api test`, `pnpm --filter @gmt/providers test`, `pnpm --filter @gmt/engine test` and `pnpm --filter @gmt/core test` exit 0 with their thresholds.
- `pnpm --filter @gmt/engine exec vitest run test/layerB` skips 3 tests visibly without recordings and passes them with the local recordings; CI's skip step finds all six titles.
- `pnpm --filter @gmt/api exec vitest run test/deploy` passes with the smoke section and exit codes 2 and 3 (after WP12).
- Task 13.8's report and rows are recorded in the PR within the 24-credit ceiling, and Task 13.9's review, checks and trace are complete with every finding addressed.
- `v0.1.0` is tagged on `main`.

## 11. Open questions

None that need the operator's judgement: decision 66 ruled on round 1's judgment items. Ian approves Task 13.8's figures before any spend (decision 65).

## 12. Changes outside WP13's own files

- `packages/core/src/api-contract/system.ts`: `toolSmokeRequestSchema` gains `budget` and `dryRun` (Task 13.1).
- `apps/api/src/tools/recordExecution.ts` (WP4b) → `toolExecution.ts`; `recordPlan.ts` and `bootstrap/tool.ts` (WP4b) use the shared `args.ts` and `paths.ts`; `record.ts` (WP4b) loses one argument. The record tool's plan, messages, caps and exit codes are unchanged; its window line gains the plan and `SEARCHAPI_TRIAL_USED`, and two phrases lose "live" (Task 13.1).
- `apps/api/src/routes/types.ts`, `routes/tools.ts`, `app.ts`, `text.ts`, `tools/inProcess.ts` (WP8): the smoke route, one in-process runner, `OWNED_ELSEWHERE` removed, `toolSynthetic(name)` (Task 13.5).
- `packages/providers/src/testing/` gains the skip guard; the providers and api test helpers that held it are deleted and their importers repointed (Task 13.6).
- `.gitignore`, `.github/workflows/ci.yml` (one step), `docs/setup.md` and `apps/api/test/deploy/docs.test.ts` (WP12).

## 13. For the plan (not yet recorded there)

1. **Assembly.** On 2026-10-17 every code block of Tasks 13.1–13.6 was assembled on a detached scratch worktree of `main` at `f8b7595` and the blocks above were generated from those files. Results: `pnpm -r typecheck`, `pnpm lint` (610 files), `pnpm boundaries`, `pnpm casts` (564 files, 0 casts) clean; `pnpm --filter @gmt/api test` exit 0 with thresholds, 449 passed and 1 skipped; core 778 passed; providers 634 passed and 29 skipped (recordings absent), coverage exit 0; engine 282 passed and 3 skipped, coverage exit 0; layer B 3 passed with the local recordings copied in and removed afterwards; the CI skip step found all six titles under `bash -eo pipefail`. The two bite proofs of Task 13.2 were run. Not run: Task 13.7 (WP12's files are not on main), Tasks 13.8 and 13.9 (operator), the CI workflow itself.
2. **The smoke contract.** The plan's smoke line reads `runSmoke(ports, args: { origin; destination }): Promise<SmokeResult>` with codes 0, 1, 2, 3, 64. The code is `runSmoke(ports, cli: SmokeCli, opts: { signal; fixtures })` with codes 0, 1, 2, 3, 64 and 65 (decision 65), `SmokeCli` carrying `dryRun` (decision 66), and 78 from the bootstrap for a fixture target inside the recorded tree. `toolSmokeRequestSchema` is `{ origin; destination; budget; dryRun? }`. `EXIT` names the new codes `smokeNoProviders` (2) and `smokeEmpty` (3); exit 1 also covers a checklist line that reads `fail`, including a partial tile.
3. **Stale plan text.** "Wiring and bootstraps" still gives `providersFor(config, deps: { http; log; clock; airports })` (WP6 removed `airports`, decision 34) and `createLogger(config, opts?: { destination? })` (decision 23 added `fd` and `secrets`). The file map could name `apps/api/src/tools/args.ts`, `paths.ts`, `toolExecution.ts`, `smoke.ts` and `smokeChecks.ts`.
4. **What the smoke spends and checks.** Spec §9 item 7 says one tile per configured provider; the smoke also runs one SearchApi itinerary chain (decision 65). Spec §9 item 7 could say so, and that the headline is a confirmed price when one exists (decision 66), at its next revision.
5. **Where the smoke writes.** As decision 65; `.gitignore` gains `**/smoke/fixtures/recorded/**`, and the target is compared with the recorded tree as true-case real paths (the record tool's rule, now shared).
6. **Banned words in tool output.** As decision 65: the record tool's "(a live run needs --confirm-rerun)" and "a live run would be refused" read "a run that calls the vendors …".
7. **The window line.** `spendPosition`'s SearchApi line now names the plan and, on the trial, `SEARCHAPI_TRIAL_USED`, for both tools (decision 66's "the dry run prints the window").
8. **`OWNED_ELSEWHERE` removed.** With the smoke mounted, no ROUTES entry is owned outside apps/api; decision 4's mechanism has no member left, so it goes, and WP8's sweep covers every entry.
9. **Layer B's evidence.** The recorded Travelpayouts LHR → JFK March tile holds three rows, none departing on 2027-03-01..09; layer B pins `no_data` for the rectangle's window and reads Travelpayouts provenance on a 2027-03-15..17, 5–7-night window the same month tile prices. Layer B mirrors apps/api's `providersFor` and `httpLimitsFor` by hand (engine may not import apps/api); its support file says so.
10. **Follow-up: `show_cheapest_flights`.** WP5 §13's row needs a parameter the allowlists refuse and a vendor call outside the ledger; decision 66 keeps every vendor step on the ledger, so it moves to a later package that adds the parameter to both allowlists through a new recorded params file, if Ian wants it.
11. **Round 1, finding by finding.** High: arch-wp13-r1-001 shared `args.ts` (Task 13.1); arch-002 and cost-006 frozen cap in `openHiddenExecution`, with a test (Tasks 13.1, 13.2); cost-001, cost-002 one ledger and the 24-credit table (Task 13.8); cost-003 `--dry-run`/`dryRun` and Step 0 (Tasks 13.1, 13.2, 13.8); prov-001 open-jaw from issues and notes, `look`, docs reworded (Task 13.1, §5, Task 13.7); prov-002 "sold by" only for confirmed offers, the decision-44 label, a test (Tasks 13.1, 13.2). Medium: arch-003 `openHiddenExecution(ports, run)` builds the definition once from one instant; arch-004 shims deleted, one guard test; arch-005 `OWNED_ELSEWHERE` removed; arch-006 `runInProcess` and `refused(name, …)`; arch-007 `smokeChecks.ts` split, `toolExecution.ts` renamed; arch-008 `paths.ts` shared, refusal 78; arch-009 zod narrowing in layer B; arch-010 preconditions on every task; cost-004 `SEARCHAPI_TRIAL_USED` set and printed (Tasks 13.1, 13.8); cost-005 `budget` from the dry run, no `--confirm-rerun` advice (Task 13.8, the refusal text, the docs); cost-007 `toolEstimate` stored and asserted; prov-003 `tiles read whole`, labels and tests; prov-004 the headline rule (decision 66); prov-005 source kind per provider, never synthetic, docs say what is checked; prov-006 attempts ≥ answers, billed count from the guard, docs reworded; prov-007 and arch-012 per-title CI check with pipefail; prov-008 every run's report recorded, `skip` as open items, an exit-0 run before rows 4, 5, 8; prov-009 Task 13.9 Step 3's trace and the review focus. Low: arch-011 `toolSynthetic(name)`; arch-013 layer B mirror comment and `seedAirports`; cost-008 the guard's billed count; cost-009 keys cleared and a zero request count in the walkthrough; prov-010 layer-B assertions widened and retitled; prov-011 SearchApi airport pairs checked; prov-012 the step-2 token must be step 1's cheapest; prov-013 the stand-in comment matches its date; prov-014 per-provider empty wording and the aborted detail; prov-015 the synthetic-row check (Task 13.9 item 11).
