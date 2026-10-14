---
wp: 13
title: live smoke, layer-B engine tests, app_lock tool test, integration review, final pass
owner: fable
depends_on: [all]
spec_sections: ["§9 item 7", "§9 item 4 layer B", "§7 app_lock", "§10 /api/tools/smoke", "§13", "§16 WP13", "§17 revision 10", "§9 and §11 cross-cutting: banned words, sentinel keys, Stryker, coverage"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, security-reviewer, cost-and-budget-reviewer, devops-reviewer, product-owner, persona-flexible-traveller]
status: draft
---

# WP13: live smoke, layer-B engine tests, app_lock tool test, integration review, final pass

Reconciled on 2026-10-14 against the plan's rewritten "Cross-package contracts", including its "Decisions taken at reconciliation", and against spec revision 10. It also uses the interface sections of the draft briefs WP4, WP4b, WP7, WP8, WP9 and WP11.

## 1. Goal

Prove the assembled system against recorded vendor behaviour and the operator's real keys. Specifically:

- `pnpm smoke:live` issues exactly one ledgered tile per configured provider and prints the cheapest price with its provenance.
- The real adapters pass the engine's layer-B tests on recorded fixtures.
- A spawned tool bootstrap is shown to start no execution.
- The cross-cutting banned-word and sentinel-key tests run once over the whole process.
- v0.1.0 is tagged after the integration review.

## 2. Scope

**In**

- `apps/api/src/tools/smoke.ts`:
  - `runSmoke(ports, { origin, destination })` with the exit-code contract (§9 item 7);
  - `smokeQuery` and `parseSmokeArgs`;
  - `smokeTool`, registered in WP4b's `TOOLS` so `runTool('smoke', argv)` runs it;
  - `toToolRunResponse`.
- `apps/api/src/tools/perRunCap.ts`: the per-run cap of exactly one call per provider, wrapping the real `SqliteBudgetGuard`.
- Mounting `POST /api/tools/smoke`. The plan assigns this to WP13. WP13 does it by adding `smoke` to WP8's `inProcessTools(ports)` and by giving WP8's `'POST /tools/smoke'` handler the validated `toolSmokeRequestSchema` body, so the route returns `toolRunResponseSchema`.
- Layer-B engine tests in `packages/engine/test/layerB/*.test.ts`. They run the real `searchApiProvider` and `travelpayoutsProvider` over `replayHandlers(fixtures/recorded)` through WP7's harness. WP13 adds one additive option to that harness (`vendors`) and one field to its `extraProviders` tools (`repos`).
- The real-process `app_lock` test: the tool bootstrap is spawned as a child process, and the test proves it starts no execution.
- A root `integration` Vitest project holding:
  - the cross-cutting banned-word test over web `COPY`, api `API_TEXT`, engine `operatorMessage` and WP11 `renderBody`, with core's `BANNED_WORD_ALLOWLIST`;
  - the whole-process sentinel-key test;
  - the route-mount test.
- The final integration review checklist and the release steps: tag `v0.1.0`, and check `docs/setup.md` against a fresh clone in Docker.

**Out**

- `@gmt/providers/testing` (`fixtureHandlers`, `replayHandlers`, `loadRecorded`): WP4.
- `record:fixtures`, the recorded tree, `buildPorts`, `httpLimitsFor`, `providersFor`, `createLogger`, `runTool`, `TOOLS`, `EXIT` and WP4b's in-process lock tests: WP4b.
- Adapter tiling, parsing and error mapping: WP5 and WP6. Layer B tests them only through the engine.
- Layer-A tests and `createHarness`: WP7.
- `createApp`, the `/api/tools/*` handlers, `API_TEXT` and `inProcessTools`: WP8. WP13 changes only the smoke runner and its handler argument.
- `COPY` and the per-package banned-word tests in web: WP9.
- `EmailNotifier`, `renderBody`: WP11.
- Dockerfile, compose and `docs/setup.md` content: WP12. WP13 checks them and records defects as findings against WP12.
- `toolSmokeRequestSchema`, `toolRunResponseSchema`, `BANNED_WORD_ALLOWLIST`: WP0. WP13 consumes them unchanged.

## 3. Spec sections

- **§9 item 7.** `pnpm smoke:live`:
  - issues exactly one tile per configured provider, using a query sized so `plan` yields one tile;
  - asserts through the ledger;
  - prints the cheapest price with provenance;
  - writes dated fixtures.

  It exits non-zero when zero providers are configured or any configured provider errors, and uses a distinct exit code for empty. It is excluded from `pnpm test` and runs through the tool bootstrap.
- **§9 item 4, layer B.** The real adapters replay recorded fixtures through the same path as layer A: real http-kit, the real `SqliteBudgetGuard`, an in-memory DB and msw on global fetch.
- **§7 `app_lock` and SQLite settings.** The tool bootstrap skips the boot sweep, auto-resume and cron, uses the production ledger and honours `app_lock`. A test proves it starts no execution, and it refuses while a fresh app lock exists.
- **§10 (rev 10) `POST /api/tools/smoke`.** The smoke runs inside the app process, authenticated, while the app holds `app_lock`. Every route lives under `/api`.
- **§13 (rev 10).** The image has no `curl`. Smoke and record are invoked from the host with `curl` against the loopback port.
- **§16 WP13.** The first failing test is "live smoke exits 0 with provenance".
- **§5.3 sentinel-key test.** Every secret (both provider keys, the SMTP password, the basic-auth password) is set to a sentinel. Every path is exercised, error paths included. No sentinel may appear in any log line, DB column, error message, API body, email or fixture file.
- **§11 and §8.3.** One banned-word list, matched on word boundaries with one allowlist, over web, engine templates and API strings.
- **§9 thresholds.** Package coverage thresholds hold, and Stryker breaks below 80% on the core modules.

**Resolved at reconciliation** (this brief already follows each one):

- The smoke takes `--origin` and `--destination`, so no airport code appears in application code.
- The image has no `curl`; it is used from the host instead.
- The recorder keeps the credential-free query in `request.url`.
- A route-run smoke writes no fixtures and says so.
- `runTool` returns `Promise<number>`.
- `/api/tools/smoke` is mounted by WP13.

**Still inconsistent** (the spec wins where it speaks; otherwise these are findings for Fable):

1. **Exit-code collision.** WP4b's `EXIT` is `{ ok: 0, failed: 1, refusedTestEnv: 2, badConfig: 3, lockRefused: 4, usage: 5 }`, and `runTool` returns the tool's own code on success. The smoke's 2 (zero providers) and 3 (empty) therefore collide with `refusedTestEnv` and `badConfig`. A malformed `--origin` is rejected by `smokeTool.start` and exits `EXIT.usage` = 5, not 64. The table in §5 states what each path returns today. One of the two tables should move, for example `EXIT` to 64–69.
2. **WP8's tool runner shape.** WP8's draft `ToolRunners.smoke` takes `Record<string, never>`, returns `{ ok, exitCode, lines }`, and its handler spreads `{ tool: name, ... }`. The plan's `toolRunResponseSchema` is `{ exitCode, summary, lines, fixturesWritten }`, and the request is `toolSmokeRequestSchema`. Task 13.3 changes the smoke runner's argument and result types. The extra `tool` field in WP8's `runTool` handler helper also affects `/tools/record` and is left to WP8.
3. **`createLogger` signature.** The plan says `createLogger(config: Pick<Config, 'logLevel'>, opts?: { destination })`, owned by WP4b. The WP4b and WP8 drafts both write `createLogger(level, destination?)` in `apps/api/src/logger.ts`. This brief calls the plan's form.
4. **`Notifier.send` shape.** The plan's port is `send({ kind: 'digest'; digest; subject; body } | { kind: 'operator'; message })`. WP11's draft `EmailNotifier.send(msg: AlertDigest | OperatorMessage)`. This brief calls the plan's form.
5. **No filter or miss log in replay.** The plan's `replayHandlers(recordedRoot)` has neither a `recordedBy` filter nor a miss log. A smoke recording and a WP4b recording of the same request (for example a Travelpayouts `LON` month tile) compete, and a miss surfaces only as an unhandled-request error. This brief asks WP4 for `replayHandlers(root, opts?: { recordedBy?: string })`. Until then, the tests choose a smoke month WP4b did not record (Task 13.1, Step 5).
6. **WP7's harness can't reach the vendors.** Its http limits route `travelpayouts` to `stub.local` and give `searchapi` no host, its budget config has no `searchapi`, and `extraProviders` receives no `repos`. Task 13.4 adds `vendors` and `repos` additively.
7. **msw 3 option name.** WP4 verified that msw 3 renamed `onUnhandledRequest` to `onUnhandledFrame`. WP7's harness still writes `onUnhandledRequest`. This brief uses `onUnhandledFrame`.
8. **Fixture transport for the sentinel test.** `buildPorts(…, { fixtureRoot })` serves the fixture host in-process, where a test cannot set scenario rules. The sentinel test therefore omits `fixtureRoot`, so `fixture.local` goes to global fetch and is served by msw `fixtureHandlers`, and it sets rules with `fetch(scenarioRequest(rules))`. This assumes `buildPorts` still constructs the fixture provider under `syntheticAllowed` when `fixtureRoot` is absent.

## 4. Interfaces consumed

From the plan's "Cross-package contracts" (rev 10):

```ts
// core ports/provider.ts
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface Notifier { id: string; send(msg: { kind: 'digest'; digest: AlertDigest; subject: string; body: string } | { kind: 'operator'; message: OperatorMessage }): Promise<{ ok: boolean; detail?: string }> }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number; newItems: DigestItem[]; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }
export interface OperatorMessage { kind: OperatorMessageKind; executionId: string | null; definitionId: string; subject: string; body: string }

// core clock, labels, text, api-contract
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;   // bounded with maxAgeHours 0 → "fetched 5h ago"
export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
toolSmokeRequestSchema  // { origin: Iata; destination: Iata }
toolRunResponseSchema   // { exitCode: number; summary: string; lines: string[]; fixturesWritten: string[] }
ROUTES                  // paths include the /api prefix
// iataSchema upper-cases input (reconciliation decision 1)

// core domain (WP1, WP2)
export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number; export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[];
export function toGbp(amountMinor: number, currency: string, rateNano: number): number;

// db
export function createRepos(db: Db, clock: Clock, opts: RepoOptions): Repos;
export function openDatabase(path: string): Db; export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
export class FxRepo { latest(currency: string, maxAgeDays: number, today: IsoDate): { rateNano: number; date: IsoDate; source: string } | null }
export type ExecutionCreateInput = { definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; estimate: Estimate | null; trigger: Execution['trigger']; status: 'pending' | 'running' | ExecutionStatus & `skipped_${string}` }
export class NotificationsRepo { wasSent(kind: OperatorMessageKind, executionId: string | null, definitionId: string): boolean }
export class AppLock { constructor(db: Db, holder: 'app' | 'tool', clock: Clock, log: Logger); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; release(): void; static inspect(db: Db): { holder; heartbeatAt; acquiredAt } | null }
export function seedAirports(db: Db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };
export function loadAirportsDataset(dir: string): AirportsDataset;

// providers
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
export interface RecordedFixture { recordedAt: IsoDateTime; recordedBy: string; providerId: string; endpointPath: string; request: { method: string; url: string; headers: Record<string, string>; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; contentSha256: string }
export interface FixtureRecorder { record(r: { providerId: ProviderId | 'fx'; endpointPath: string; request: HttpKitRequest; status: number; body: unknown }): Promise<string /* path written */> }
export function stripUrl(url: string): string;
export function searchApiProvider(o: { http; log; clock; key: Secret; plan: PlanId; pointOfSale: string; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist }): FlightProvider;
export function searchApiHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;
export const SEARCHAPI_PARAMS: ParamsAllowlist;
export function travelpayoutsProvider(o: { http; log; clock; token: Secret; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist; airports: { metroOf(iata: Iata): string | null } }): FlightProvider;
export function travelpayoutsHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist;
// '@gmt/providers/testing': fixtureHandlers(root): RequestHandler[]; replayHandlers(recordedRoot): RequestHandler[]; loadRecorded(root, providerId, endpointPath): RecordedFixture[]

// engine
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;

// apps/api wiring.ts (WP4b)
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[]; recorder: FixtureRecorder | null; fixtureRoot: string | null }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string; fixtureRoot?: string }): Ports;
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo }): FlightProvider[];
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
export function createLogger(config: Pick<Config, 'logLevel'>, opts?: { destination?: NodeJS.WritableStream }): Logger;
// bootstrap/tool.ts: export async function runTool(name: 'record' | 'smoke', argv: string[]): Promise<number>
// tools/smoke.ts (this WP): export async function runSmoke(ports: Ports, args: { origin: Iata; destination: Iata }): Promise<SmokeResult>
```

From the draft briefs, for names the plan does not pin:

| Name | Source | Shape used here |
|---|---|---|
| `EXIT`, `TOOLS`, `ToolEntry`, `StartedTool`, `ToolContext` | WP4b §5.2 | `ToolEntry { start(argv): StartedTool \| { ok: false; message } }`; `StartedTool { ok: true; recordedBy: string \| null; configure(c): Config; precheck(c): string \| null; run(ports, ctx): Promise<number> }`; `ToolContext { recorder; recordedRoot; signal; out(line); err(line) }` |
| `MIGRATIONS_DIR`, `RECORDED_ROOT` | WP4b `apps/api/src/paths.ts` | absolute paths |
| `RECORDED_BY_ALLOWED` | WP4b | includes `'@gmt/api smoke:live'` (the smoke's `recordedBy`) |
| `record --dry-run` | WP4b | `--budget 12 --route LHR,LGW:JFK,EWR --month 2027-03 --metro LON --dry-run` prints the plan, makes no request, creates no execution, exits 0; output lines `tool lock acquired` / `tool lock released`; refusal on stderr `app_lock is held by app` with `EXIT.lockRefused` |
| `createApp(ports, engine, options?)`, `AppOptions.tools`, `ToolRunners`, `inProcessTools(ports)`, `toolHandlers`, `API_TEXT`, `API_PREFIX` | WP8 §5 | as written there; Task 13.3 changes `ToolRunners.smoke` |
| `createHarness(opts)`, `HarnessOptions { env?, now?, extraProviders?, … }`, `Harness { deps, options, config, clock, db, repos, server, createDefinition, runToCompletion, waitForSettled, outcomes, ledgerRows, tileRequests, close }`, `T0` | WP7 test/harness.ts | Task 13.4 adds `vendors` and `repos` |
| `operatorMessage(kind, { definitionName, executionId, detail })`, `OPERATOR_KINDS` | WP7 | exported from `@gmt/engine` |
| `EmailNotifier({ smtp, nodeEnv, log, createTransport })`, `TransportFactory = (o: SmtpTransportOptions) => MailTransport`, `MailTransport { sendMail(m: MailMessage): Promise<{ messageId }> }`, `MailMessage { from, to, subject, text }` | WP11 §5 | |
| `renderBody(input: DigestRenderInput)`, `DigestRenderInput { rule, definitionId, definitionName, items, restCount, newcomers, newcomersRest, coverage, now }` | WP11 §5 | |
| `COPY` | WP9 `apps/web/src/copy.ts` | the single web string catalogue; nested objects of strings and string-returning functions |
| `scenarioRequest(rules)`, `FixtureRule` | WP4 | `{ match: { path?, params? }, respond: FixtureResponse, times? }`; fixture paths `/calendar`, `/itinerary` |

## 5. Interfaces produced

```ts
// apps/api/src/tools/smoke.ts — spec §9 item 7
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
export type SmokeExitCode = 0 | 1 | 2 | 3 | 64;
export interface SmokeProviderReport {
  providerId: ProviderId; status: 'priced' | 'empty' | 'error'; tiles: number; prices: number;
  ledger: { rows: number; firstAttemptOk: number }; detail: string;
}
export interface SmokePrice { pricePence: number; cell: CellKey; nights: number; displayName: string; provenance: Provenance }
export interface SmokeResult { exitCode: SmokeExitCode; summary: string; lines: string[]; providers: SmokeProviderReport[]; cheapest: SmokePrice | null; fixturesWritten: string[] }
export function runSmoke(ports: Ports, args: { origin: Iata; destination: Iata }): Promise<SmokeResult>;
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery;
export function parseSmokeArgs(argv: readonly string[]): { ok: true; args: { origin: Iata; destination: Iata } } | { ok: false; message: string };
export function toToolRunResponse(r: SmokeResult): { exitCode: number; summary: string; lines: string[]; fixturesWritten: string[] };   // = toolRunResponseSchema
export const smokeTool: ToolEntry;   // registered as TOOLS.smoke

// apps/api/src/tools/perRunCap.ts
export interface CappedGuard extends BudgetGuard { reservationIds(providerId: ProviderId): readonly string[] }
export function perRunCallCap(inner: BudgetGuard, perProvider: number, freeProviders: ReadonlySet<ProviderId>): CappedGuard;

// apps/api/src/routes/types.ts (WP8 file, changed here)
smoke?: (args: { origin: Iata; destination: Iata }) => Promise<ToolRunResponse>   // ToolRunResponse = z.infer<typeof toolRunResponseSchema>

// packages/engine/test/harness.ts (WP7 file, additive)
HarnessOptions.vendors?: Partial<Record<'searchapi' | 'travelpayouts', { http: ProviderHttpLimits; limits: ProviderLimits; billable: boolean }>>
extraProviders tools gain repos: Repos

// root integration project: integration/package.json (@gmt/integration, private), integration/vitest.config.ts (project 'integration', no thresholds)
```

**Smoke exit codes.** When several apply, the highest row wins in the order 64, 2, 1, 3, 0.

| Code | Meaning | Calls made |
|---|---|---|
| 64 | Bad arguments that reach `runSmoke`: origin equals destination, or either is absent from the airports table | none |
| 2 | Zero providers configured (neither `TRAVELPAYOUTS_TOKEN` nor `SEARCHAPI_KEY`) | none |
| 1 | Any configured provider errored: a `tile-error`, a thrown `ProviderError` or `BudgetExceeded` (including the per-run cap), `plan()` yielding anything but one tile, a ledger assertion failing (not exactly one row, first attempt, `ok`), or a non-GBP price with no FX rate | at most one per provider |
| 3 | No error, but at least one configured provider's tile held no price (`no_data` or `noFares`) | one per provider |
| 0 | Every configured provider priced its one tile, with exactly one first-attempt `ok` ledger row each | one per provider |

Through the CLI, `runTool` returns these codes on a successful start. It returns its own `EXIT` codes before the smoke runs:

| `EXIT` | Code | When |
|---|---|---|
| `refusedTestEnv` | 2 | `NODE_ENV=test` |
| `badConfig` | 3 | invalid configuration |
| `lockRefused` | 4 | a fresh app lock exists |
| `usage` | 5 | missing or malformed `--origin` or `--destination`, rejected by `smokeTool.start` |

The 2 and 3 collisions are §3 item 1. Through the route, a malformed body is a 400 from validation, and the codes above arrive in `exitCode`.

**Contract additions still proposed** (for Fable):

1. `replayHandlers(root, opts?: { recordedBy?: string })`, plus a miss log (§3 item 5).
2. WP7 harness `vendors` and `repos` (§3 item 6).
3. `@gmt/api` and `@gmt/engine` barrels export the names the integration project imports:
   - api: `buildPorts`, `loadConfigFromEnv`, `createLogger`, `createApp`, `inProcessTools`, `runSmoke`, `API_TEXT`;
   - engine: `operatorMessage`, `OPERATOR_KINDS`, `EmailNotifier`, `renderBody`.
4. `pnpm-workspace.yaml` gains `integration`, and the root `vitest.config.ts` gains the `integration` project.

## 6. Library notes

Verified on 2026-10-14.

- **vitest 5.0.4.** Source: context7 `/vitest-dev/vitest/v5.0.3`, `docs/guide/projects.md`.
  - `test.projects` takes config-file paths named `vitest.config.*`.
  - `test.name` names a project.
  - `vitest run --project integration` filters to one project.
  - `vi.waitFor(fn, { timeout })` retries an assertion.

  Per-task runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>` (reconciliation decision 8), which applies no coverage threshold to a partial run.
- **msw 3.0.3.** Sources: context7 `/websites/mswjs_io` (quick start, intercepting requests), and WP4's verification of "Migrations 2.x → 3.x".
  - `setupServer` from `msw/node`; `http` and `HttpResponse` from `msw/http` (v3 moved them off the root).
  - `server.listen({ onUnhandledFrame: 'error' })`, the v3 name; `server.use`, `server.resetHandlers`, `server.close`.
  - `server.events.on('request:start', ({ request }) => …)`.
  - `http.all(url, resolver, { once: true })`.
  - `HttpResponse.json(body, { status })`, `HttpResponse.text(body, { status })`, `new HttpResponse(null, { status: 302, headers: { Location } })`.

  No `RequestHandler` import: WP4 found that the v3 docs do not name its entrypoint.
- **node:child_process (Node 22).**
  - `spawn(process.execPath, ['--import', 'tsx', entry, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })`.
  - The `close` event `(code)`, and `child.kill('SIGKILL')` on timeout.
  - `--import tsx` resolves from `cwd`, so the spawn runs in `apps/api`, where `tsx@4.23.15` is a dev dependency.
- **hono 4.13.13.** Source: context7 `/honojs/website`, "Dev helper" and "Testing".
  - `inspectRoutes(app)` from `hono/dev` lists `{ method, path, isMiddleware }`.
  - `app.request(url, init)` dispatches in-process.
- **nodemailer.** Not called directly. WP11's `TransportFactory` is the seam.

## 7. Files

**Create**

- `apps/api/src/tools/smoke.ts`
- `apps/api/src/tools/perRunCap.ts`
- `apps/api/test/support/env.ts`
- `apps/api/test/tools/smoke.test.ts`
- `apps/api/test/tools/smokeExitCodes.test.ts`
- `apps/api/test/tools/smokeArgs.test.ts`
- `apps/api/test/routes/toolsSmoke.test.ts`
- `apps/api/test/tools/appLock.spawn.test.ts`
- `packages/engine/test/layerB/support.ts`
- `packages/engine/test/layerB/discovery.test.ts`
- `packages/engine/test/layerB/verification.test.ts`
- `packages/engine/test/layerB/errors.test.ts`
- `integration/package.json`, `integration/tsconfig.json`, `integration/vitest.config.ts`
- `integration/test/support.ts`
- `integration/test/bannedWords.test.ts`
- `integration/test/sentinel.test.ts`
- `integration/test/routes.test.ts`
- Two smoke recordings, written by the one recorded run in Task 13.1:
  - `packages/providers/fixtures/recorded/searchapi/api_v1_search/<date>-<sha12>.json`
  - `packages/providers/fixtures/recorded/travelpayouts/aviasales_v3_prices_for_dates/<date>-<sha12>.json`

**Modify**

- `apps/api/src/bootstrap/tool.ts` (`TOOLS` gains `smoke: smokeTool`)
- `apps/api/src/tools/inProcess.ts` (adds the `smoke` runner)
- `apps/api/src/routes/types.ts` (the `ToolRunners.smoke` type)
- `apps/api/src/routes/tools.ts` (the `'POST /tools/smoke'` handler passes the validated body)
- `apps/api/src/index.ts` and `packages/engine/src/index.ts` (barrel exports, §5 addition 3)
- `packages/engine/test/harness.ts` (`vendors`, `repos`)
- `pnpm-workspace.yaml`
- `vitest.config.ts` (root)
- `.github/workflows/ci.yml` (`pnpm build` before tests, so the integration project resolves `dist`)

## 8. Tasks

### Task 13.1: The smoke exits 0 with provenance (first failing test)

**Files:**
- Create: `apps/api/src/tools/perRunCap.ts`, `apps/api/src/tools/smoke.ts`, `apps/api/test/support/env.ts`, `apps/api/test/tools/smoke.test.ts`, and the two smoke recordings
- Modify: `apps/api/src/bootstrap/tool.ts`, `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `buildPorts`, `loadConfigFromEnv`, `httpLimitsFor`, `providersFor`, `createHttpKit`, `createRecorder`, `stripUrl`, `effectiveAge`, `formatAgeFull`, `toGbp`, `FxRepo.latest`, `seedAirports`, `loadAirportsDataset`, `replayHandlers`, `loadRecorded`, `TOOLS`, `ToolEntry`.
- Produces: `runSmoke`, `smokeQuery`, `parseSmokeArgs`, `smokeTool`, `toToolRunResponse`, `SMOKE_RECORDED_BY`, `perRunCallCap`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/support/env.ts`:

```ts
/**
 * Shared apps/api test support: sentinel secrets, a capture logger, ports on an in-memory DB with
 * the vendored airports (and metro list) seeded, and the smoke recordings. Spec §5.3, §9 item 7.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IsoDateTime, type Logger, Secret, fixedClock } from '@gmt/core';
import { loadAirportsDataset, seedAirports } from '@gmt/db';
import { type RecordedFixture, createRecorder } from '@gmt/providers';
import { loadRecorded } from '@gmt/providers/testing';
import { MIGRATIONS_DIR, RECORDED_ROOT } from '../../src/paths.js';
import { SMOKE_RECORDED_BY } from '../../src/tools/smoke.js';
import { type Ports, buildPorts, loadConfigFromEnv } from '../../src/wiring.js';

export const AIRPORTS_DIR = join(MIGRATIONS_DIR, '../data');
export const SENTINELS = {
  searchapi: 'test-searchapi-key-0123456789abcdef',
  travelpayouts: 'test-travelpayouts-token-0123456789abcdef',
  smtpPass: 'test-smtp-pass-0123456789abcdef',
  authPass: 'test-basic-auth-pass-0123456789abcdef',
} as const;

/** NODE_ENV=test is accepted by buildPorts; only the bootstraps refuse it. */
export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1', LOG_LEVEL: 'debug', ...overrides };
}

/** A Logger that keeps every line as JSON so tests can scan it. */
export function captureLogger(bindings: object = {}): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const make = (b: object): Logger => {
    const write = (level: string) => (o: object, msg?: string) => { lines.push(JSON.stringify({ level, ...b, ...o, msg })); };
    return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error'), child: (more) => make({ ...b, ...more }) };
  };
  return { log: make(bindings), lines };
}

/** The smoke's recordings: SearchApi calendar and Travelpayouts month, recordedBy smoke:live. */
export function smokeRecordings(): RecordedFixture[] {
  return [
    ...loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search'),
    ...loadRecorded(RECORDED_ROOT, 'travelpayouts', '/aviasales/v3/prices_for_dates'),
  ].filter((r) => r.recordedBy === SMOKE_RECORDED_BY);
}

/** The instant of the newest smoke recording; the test clock is fixed there so smokeQuery rebuilds the recorded requests. */
export function smokeRecordedAt(): IsoDateTime {
  const last = smokeRecordings().map((r) => r.recordedAt).sort().at(-1);
  if (last === undefined) throw new Error(`no '${SMOKE_RECORDED_BY}' recordings under ${RECORDED_ROOT}; run WP13 Task 13.1 step 5`);
  return last;
}

/** Ports as the CLI builds them: a recorder (into a temp dir, never the committed tree) and the real airports. */
export function testPorts(env: Record<string, string | undefined>, opts: { now: IsoDateTime; record?: boolean }): { ports: Ports; logs: string[]; out: string } {
  const { log, lines } = captureLogger();
  const config = loadConfigFromEnv(env);
  const clock = fixedClock(opts.now);
  const out = mkdtempSync(join(tmpdir(), 'gmt-smoke-'));
  const secrets = [config.providers.searchapi?.key, config.providers.travelpayouts?.token].filter((s): s is Secret => s !== undefined);
  const recorder = opts.record === true ? createRecorder({ root: out, secrets, clock, recordedBy: SMOKE_RECORDED_BY }) : undefined;
  const ports = buildPorts(config, { log, clock, migrationsDir: MIGRATIONS_DIR, ...(recorder === undefined ? {} : { recorder }) });
  seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DIR));
  return { ports, logs: lines, out };
}
```

`apps/api/test/tools/smoke.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { asIata, findBannedWords } from '@gmt/core';
import { replayHandlers } from '@gmt/providers/testing';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RECORDED_ROOT } from '../../src/paths.js';
import { runSmoke } from '../../src/tools/smoke.js';
import { SENTINELS, smokeRecordedAt, testEnv, testPorts } from '../support/env.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('runSmoke (spec §9 item 7)', () => {
  it('exits 0 with provenance when both providers price their one tile', async () => {
    const recordedAt = smokeRecordedAt();
    server.use(...replayHandlers(RECORDED_ROOT));
    const { ports, logs } = testPorts(
      testEnv({ TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts, SEARCHAPI_KEY: SENTINELS.searchapi, SEARCHAPI_PLAN: 'trial' }),
      { now: recordedAt, record: true },
    );

    const r = await runSmoke(ports, { origin: asIata('LHR'), destination: asIata('JFK') });

    expect(r.exitCode).toBe(0);
    expect(r.providers.map((p) => [p.providerId, p.status, p.tiles, p.ledger.rows, p.ledger.firstAttemptOk])).toEqual([
      ['searchapi', 'priced', 1, 1, 1],
      ['travelpayouts', 'priced', 1, 1, 1],
    ]);
    expect(r.summary).toMatch(/^cheapest found £\d+\.\d{2} · LHR→JFK \d{4}-\d{2}-\d{2}–\d{4}-\d{2}-\d{2} \(\d+n\) · .+ · fetched /);
    expect(r.lines).toContain(r.summary);
    expect(r.cheapest?.provenance.fetchedAt).toBe(recordedAt);
    expect(r.cheapest?.provenance.fx).toEqual({ converted: false });
    expect(r.fixturesWritten).toHaveLength(2);
    const everything = [...r.lines, ...logs, ...r.fixturesWritten.map((f) => readFileSync(f, 'utf8'))].join('\n');
    for (const s of Object.values(SENTINELS)) expect(everything).not.toContain(s);
    for (const l of r.lines) expect(findBannedWords(l)).toEqual([]);
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts`
Expected: FAIL, "Failed to load url ../../src/tools/smoke.js".

- [ ] **Step 3: Implement the per-run cap**

`apps/api/src/tools/perRunCap.ts`:

```ts
import { BudgetExceeded, type BudgetGuard, type ProviderId } from '@gmt/core';

/** A BudgetGuard that also reports which ledger rows this run reserved. */
export interface CappedGuard extends BudgetGuard {
  reservationIds(providerId: ProviderId): readonly string[];
}

/**
 * Wraps the real SqliteBudgetGuard with a cap of `perProvider` reservations per provider for one
 * run. Spec §9 item 7: exactly one call per provider. Each permitted reserve still goes through
 * `inner`, so every real cap applies. A retry would be a second reserve, so it becomes
 * BudgetExceeded rather than a second call.
 */
export function perRunCallCap(inner: BudgetGuard, perProvider: number, freeProviders: ReadonlySet<ProviderId>): CappedGuard {
  const ids = new Map<ProviderId, string[]>();
  return {
    reserve(p) {
      const taken = ids.get(p.providerId) ?? [];
      if (taken.length >= perProvider) {
        throw new BudgetExceeded({
          scope: freeProviders.has(p.providerId) ? 'execution-free-calls' : 'execution-calls',
          cap: perProvider, current: taken.length, requested: 1,
        });
      }
      const reservation = inner.reserve(p);
      ids.set(p.providerId, [...taken, reservation.id]);
      return reservation;
    },
    recordCacheHit: (p) => inner.recordCacheHit(p),
    usage: (scope) => inner.usage(scope),
    reservationIds: (providerId) => ids.get(providerId) ?? [],
  };
}
```

- [ ] **Step 4: Implement the smoke and its tool entry**

`apps/api/src/tools/smoke.ts`:

```ts
/**
 * `pnpm smoke:live` and `POST /api/tools/smoke`. Spec §9 item 7, §10, §13.
 *
 * Runs one tile per configured provider, with the query sized so `plan()` yields one tile, through
 * a dedicated http-kit. That kit has the real SqliteBudgetGuard behind a per-run cap of one call
 * per provider, no response cache (the smoke must reach the vendor), and the ports' recorder
 * (present for the CLI, null in the app process). The ledger rows this run reserved are read back
 * by id and must be exactly one first-attempt `ok` row per provider. No execution row is created,
 * because ProviderContext.executionId is null.
 */
import {
  BudgetExceeded, type CellKey, type Config, type DiscoveryQuery, type DiscoveryTileResult, type FlightProvider, type FxInfo,
  type Iata, type IsoDate, type Provenance, ProviderError, type ProviderId, type ResponseCache, addDays, apiContract, asIsoDate,
  daysBetween, effectiveAge, formatAgeFull, monthsSpanned, toGbp,
} from '@gmt/core';
import { type FixtureRecorder, createHttpKit, stripUrl } from '@gmt/providers';
import { type Ports, httpLimitsFor, providersFor } from '../wiring.js';
import { type CappedGuard, perRunCallCap } from './perRunCap.js';
import type { ToolEntry } from './types.js';

export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
export type SmokeExitCode = 0 | 1 | 2 | 3 | 64;
export interface SmokeProviderReport {
  providerId: ProviderId; status: 'priced' | 'empty' | 'error'; tiles: number; prices: number;
  ledger: { rows: number; firstAttemptOk: number }; detail: string;
}
export interface SmokePrice { pricePence: number; cell: CellKey; nights: number; displayName: string; provenance: Provenance }
export interface SmokeResult { exitCode: SmokeExitCode; summary: string; lines: string[]; providers: SmokeProviderReport[]; cheapest: SmokePrice | null; fixturesWritten: string[] }

// why: provider identifiers in a fixed order, not airports.
const VENDORS = ['searchapi', 'travelpayouts'] as const;
const FREE: ReadonlySet<ProviderId> = new Set<ProviderId>(['travelpayouts']);
// why: a cache hit is not a call; the smoke must prove the vendor answers today.
const NO_CACHE: ResponseCache = { get: () => undefined, set: () => undefined };

/**
 * The one-tile query. The first day of next month is always after today, and eight departure days
 * starting on the 1st never cross a month end, so Travelpayouts plans one `month` tile. With
 * 10–21 nights the return span is 8 + 11 = 19 days, so SearchApi plans one tight 8 × 19
 * rectangle (spec §5.2 rev 10). Both counts are asserted with `plan().length === 1` before any call.
 */
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery {
  const next = monthsSpanned(today, addDays(today, 31))[1];
  if (next === undefined) throw new Error('monthsSpanned must return two months for a 31-day span');
  const departureFrom = asIsoDate(`${next}-01`);
  return { origin, destination, departureFrom, departureTo: addDays(departureFrom, 7), minNights: 10, maxNights: 21, cabin: 'economy', currency: 'GBP' };
}

/** `--origin X --destination Y` (or `--origin=X`). iataSchema upper-cases and checks the format. */
export function parseSmokeArgs(argv: readonly string[]): { ok: true; args: { origin: Iata; destination: Iata } } | { ok: false; message: string } {
  const get = (name: string): string => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq !== undefined) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? '') : '';
  };
  const parsed = apiContract.toolSmokeRequestSchema.safeParse({ origin: get('origin'), destination: get('destination') });
  if (!parsed.success) return { ok: false, message: 'usage: pnpm smoke:live -- --origin <IATA> --destination <IATA>' };
  return { ok: true, args: parsed.data };
}

/** The `toolRunResponseSchema` body for `POST /api/tools/smoke`. */
export function toToolRunResponse(r: SmokeResult): { exitCode: number; summary: string; lines: string[]; fixturesWritten: string[] } {
  return { exitCode: r.exitCode, summary: r.summary, lines: r.lines, fixturesWritten: r.fixturesWritten };
}

function formatPence(p: number): string {
  return `£${Math.trunc(p / 100)}.${String(p % 100).padStart(2, '0')}`;
}

/** Ledger rows by the reservation ids this run created, so concurrent app traffic (coverage checks) is never counted. */
function ledgerFor(ports: Ports, ids: readonly string[]): { rows: number; firstAttemptOk: number } {
  if (ids.length === 0) return { rows: 0, firstAttemptOk: 0 };
  const rows = ports.db.raw
    .prepare(`SELECT http_attempt AS attempt, outcome FROM provider_requests WHERE CAST(id AS TEXT) IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ attempt: number; outcome: string }>;
  return { rows: rows.length, firstAttemptOk: rows.filter((r) => r.attempt === 1 && r.outcome === 'ok').length };
}

function describeError(err: unknown): string {
  if (err instanceof BudgetExceeded) return `budget: ${err.scope} (per-run cap or a configured cap refused the call)`;
  if (err instanceof ProviderError) return `${err.kind}${err.reason === undefined ? '' : ` (${err.reason})`}`;
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/https?:\/\/\S+/g, (u) => stripUrl(u)); // why: spec §5.3, no URL query in any sink
}

async function smokeOne(
  ports: Ports, guard: CappedGuard, id: ProviderId, provider: FlightProvider | undefined, q: DiscoveryQuery, recordFixtures: boolean,
): Promise<{ report: SmokeProviderReport; price: SmokePrice | null }> {
  const report = (status: SmokeProviderReport['status'], tiles: number, prices: number, detail: string): SmokeProviderReport => ({
    providerId: id, status, tiles, prices, ledger: ledgerFor(ports, guard.reservationIds(id)), detail,
  });
  const discovery = provider?.discovery;
  if (provider === undefined || discovery === undefined) return { report: report('error', 0, 0, 'configured but has no discovery capability'), price: null };
  const plan = discovery.plan(q);
  const tile = plan[0];
  if (plan.length !== 1 || tile === undefined) return { report: report('error', plan.length, 0, `planned ${plan.length} tiles; the smoke query must plan exactly 1`), price: null };

  let result: DiscoveryTileResult;
  try {
    // why: http-kit owns per-request timeouts (REQUEST_TIMEOUT_SECONDS); this signal is never aborted.
    result = await discovery.fetchTile(tile, q, { executionId: null, signal: new AbortController().signal, recordFixtures });
  } catch (err) {
    return { report: report('error', 1, 0, describeError(err)), price: null };
  }
  if (result.kind === 'tile-error') return { report: report('error', 1, 0, describeError(result.error)), price: null };
  const ledger = ledgerFor(ports, guard.reservationIds(id));
  if (ledger.rows !== 1 || ledger.firstAttemptOk !== 1) {
    return { report: report('error', 1, result.prices.length, `ledger shows ${ledger.rows} rows, ${ledger.firstAttemptOk} first-attempt ok; expected exactly 1`), price: null };
  }
  const cheapest = [...result.prices].sort((a, b) => a.amountMinor - b.amountMinor)[0];
  if (cheapest === undefined) {
    return { report: report('empty', 1, 0, `no price in the tile (${result.noFares.length} no fares, the rest no cached data)`), price: null };
  }
  let pricePence = cheapest.amountMinor;
  let fx: FxInfo = { converted: false };
  if (cheapest.currency !== 'GBP') {
    const rate = ports.repos.fx.latest(cheapest.currency, ports.config.fxMaxRateAgeDays, ports.clock.todayLondon());
    if (rate === null) return { report: report('error', 1, result.prices.length, `fx-unavailable for ${cheapest.currency}`), price: null };
    pricePence = toGbp(cheapest.amountMinor, cheapest.currency, rate.rateNano);
    fx = { converted: true, rateNano: rate.rateNano, rateDate: rate.date, source: rate.source };
  }
  const provenance: Provenance = {
    providerId: id, sourceKind: discovery.info.sourceKind, fetchedAt: result.fetchedAt,
    ...(cheapest.providerObservedAt === undefined ? {} : { providerObservedAt: cheapest.providerObservedAt }),
    maxAgeHours: discovery.info.maxAgeHours, fx, pointOfSale: result.pointOfSale, cabin: q.cabin,
  };
  const cell: CellKey = { origin: cheapest.origin, destination: cheapest.destination, departureDate: cheapest.departureDate, returnDate: cheapest.returnDate };
  return {
    report: report('priced', 1, result.prices.length, ''),
    price: { pricePence, cell, nights: daysBetween(cell.departureDate, cell.returnDate), displayName: provider.displayName, provenance },
  };
}

/** Spec §9 item 7. Never throws for a vendor failure; the exit code carries it (see the brief's table). */
export async function runSmoke(ports: Ports, args: { origin: Iata; destination: Iata }): Promise<SmokeResult> {
  const lines: string[] = [];
  const log = ports.log.child({ tool: 'smoke' });
  const say = (line: string): void => { lines.push(line); log.info({}, line); };
  const done = (exitCode: SmokeExitCode, summary: string, providers: SmokeProviderReport[], cheapest: SmokePrice | null, fixturesWritten: string[]): SmokeResult =>
    ({ exitCode, summary, lines, providers, cheapest, fixturesWritten });

  const { origin, destination } = args;
  if (origin === destination) { say('origin and destination must differ'); return done(64, lines[0] ?? '', [], null, []); }
  for (const code of [origin, destination]) {
    if (!ports.repos.airports.exists(code)) { say(`unknown airport ${code}: not in the airports table`); return done(64, lines[0] ?? '', [], null, []); }
  }
  const configured = VENDORS.filter((v) => ports.config.providers[v] !== null);
  if (configured.length === 0) {
    say('no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY');
    return done(2, lines[0] ?? '', [], null, []);
  }

  const guard = perRunCallCap(ports.budget, 1, FREE);
  const written: string[] = [];
  const inner = ports.recorder;
  // why: FixtureRecorder.record returns the path it wrote; collecting them gives fixturesWritten exactly.
  const recorder: FixtureRecorder | null = inner === null ? null : { record: async (r) => { const p = await inner.record(r); written.push(p); return p; } };
  const http = createHttpKit({
    budget: guard, cache: NO_CACHE, limits: httpLimitsFor(ports.config), clock: ports.clock, log, secrets: ports.secrets,
    ...(recorder === null ? {} : { recorder }),
  });
  const providers = providersFor(ports.config, { http, log, clock: ports.clock, airports: ports.repos.airports });
  const q = smokeQuery(ports.clock.todayLondon(), origin, destination);
  say(`smoke: ${origin}→${destination} departures ${q.departureFrom}–${q.departureTo}, ${q.minNights}–${q.maxNights} nights, one tile per provider`);

  const reports: SmokeProviderReport[] = [];
  const prices: SmokePrice[] = [];
  // why: one provider at a time keeps the ledger readable and respects the trial's concurrency of 1.
  for (const id of configured) {
    const { report, price } = await smokeOne(ports, guard, id, providers.find((p) => p.id === id), q, recorder !== null);
    reports.push(report);
    if (price !== null) prices.push(price);
    say(`${id}: ${report.status} · ${report.prices} prices · ledger ${report.ledger.rows} call(s), ${report.ledger.firstAttemptOk} first-attempt ok${report.detail === '' ? '' : ` · ${report.detail}`}`);
  }

  const cheapest = [...prices].sort((a, b) => a.pricePence - b.pricePence)[0] ?? null;
  let summary = 'no price found';
  if (cheapest !== null) {
    const c = cheapest.cell;
    const age = formatAgeFull(effectiveAge(cheapest.provenance, ports.clock.now()));
    const fxNote = cheapest.provenance.fx.converted ? ' · ≈ converted to GBP' : '';
    summary = `cheapest found ${formatPence(cheapest.pricePence)} · ${c.origin}→${c.destination} ${c.departureDate}–${c.returnDate} (${cheapest.nights}n) · ${cheapest.displayName} · ${age}${fxNote}`;
  }
  say(summary);
  say(recorder === null ? 'fixtures not written (app process)' : `fixtures written: ${written.length}`);

  const exitCode: SmokeExitCode = reports.some((r) => r.status === 'error') ? 1 : reports.some((r) => r.status === 'empty') ? 3 : 0;
  return done(exitCode, summary, reports, cheapest, [...written].sort());
}

/** The tool bootstrap entry (WP4b registry). Malformed flags → EXIT.usage before any port is built. */
export const smokeTool: ToolEntry = {
  start(argv) {
    const parsed = parseSmokeArgs(argv);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    return {
      ok: true,
      recordedBy: SMOKE_RECORDED_BY,
      configure: (c: Config) => c,
      precheck: () => null, // why: zero providers is the smoke's own exit 2, not a usage refusal
      async run(ports, ctx) {
        const r = await runSmoke(ports, parsed.args);
        for (const line of r.lines) ctx.out(line);
        return r.exitCode;
      },
    };
  },
};
```

`apps/api/src/bootstrap/tool.ts`: change `TOOLS` to `{ record: recordTool, smoke: smokeTool }`, importing `smokeTool` from `../tools/smoke.js`.

`apps/api/src/index.ts`: add `export { runSmoke, toToolRunResponse, SMOKE_RECORDED_BY, type SmokeResult } from './tools/smoke.js';`.

- [ ] **Step 5: Record the smoke fixtures once (operator, real keys)**

This spends one SearchApi call and one free Travelpayouts call. Run it on the dev machine with the operator's `.env`, `NODE_ENV=development` and `DATABASE_PATH="$PWD/data/dev.db"`.

Before running, check that the smoke's departure month (the month after today) is not WP4b's recorded month. Run `ls packages/providers/fixtures/recorded/travelpayouts/aviasales_v3_prices_for_dates` and compare with the `--month` WP4b used. If the months match, the two recordings compete in `replayHandlers` (§3 item 5). In that case wait for the next month, or pause here until WP4 adds the `recordedBy` filter.

Run: `pnpm smoke:live -- --origin LHR --destination JFK`
Expected:
- exit code 0;
- the lines `tool lock acquired`, `searchapi: priced …`, `travelpayouts: priced …`, `cheapest found £… · LHR→JFK … · fetched just now · …`, `fixtures written: 2` and `tool lock released`.

If it exits 3 because the Aviasales cache is empty for that month, re-run with `--destination EWR`, change both test files to `EWR`, and say so in the commit message. Then run `pnpm secret-scan`. Expected: "secret scan: clean".

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smoke.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/providers/fixtures/recorded && git commit -m "wp13: smoke prints cheapest price with provenance from one ledgered tile per provider (spec §9 item 7)"
```

### Task 13.2: Smoke exit codes 1, 2, 3, 64 and the per-run cap

**Files:**
- Create: `apps/api/test/tools/smokeExitCodes.test.ts`

**Interfaces:**
- Consumes: `runSmoke`, `replayHandlers`, `smokeRecordings`, `smokeRecordedAt`.

- [ ] **Step 1: Write the failing test**

```ts
import { asIata } from '@gmt/core';
import { replayHandlers } from '@gmt/providers/testing';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RECORDED_ROOT } from '../../src/paths.js';
import { runSmoke } from '../../src/tools/smoke.js';
import { SENTINELS, smokeRecordedAt, smokeRecordings, testEnv, testPorts } from '../support/env.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const both = testEnv({ TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts, SEARCHAPI_KEY: SENTINELS.searchapi, SEARCHAPI_PLAN: 'trial' });
const LHR = asIata('LHR');
const JFK = asIata('JFK');
function recording(providerId: string) {
  const r = smokeRecordings().filter((x) => x.providerId === providerId).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  if (r === undefined) throw new Error(`no smoke recording for ${providerId}`);
  const u = new URL(r.request.url);
  return { rec: r, origin: u.origin, path: u.pathname };
}

describe('smoke exit codes (spec §9 item 7)', () => {
  it('2: zero providers configured, no call', async () => {
    const { ports } = testPorts(testEnv(), { now: smokeRecordedAt() });
    const r = await runSmoke(ports, { origin: LHR, destination: JFK });
    expect(r.exitCode).toBe(2);
    expect(r.lines).toEqual(['no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY']);
    ports.db.close();
  });

  it('64: a city code, an unknown code or the same airport twice, no call', async () => {
    const { ports } = testPorts(both, { now: smokeRecordedAt() });
    for (const [origin, destination] of [['LON', 'JFK'], ['QQQ', 'JFK'], ['LHR', 'LHR']] as const) {
      expect((await runSmoke(ports, { origin: asIata(origin), destination: asIata(destination) })).exitCode).toBe(64);
    }
    expect(ports.db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get()).toEqual({ n: 0 });
    ports.db.close();
  });

  it('1: a configured provider answers 401; the other still prices and the cheapest is printed', async () => {
    const sa = recording('searchapi');
    // why: spec §2 fact 5 recorded this exact 401 body; server.use prepends, so it wins over replay.
    server.use(...replayHandlers(RECORDED_ROOT));
    server.use(http.all(`${sa.origin}/*`, () => HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 })));
    const { ports } = testPorts(both, { now: smokeRecordedAt() });
    const r = await runSmoke(ports, { origin: LHR, destination: JFK });
    expect(r.exitCode).toBe(1);
    const saReport = r.providers.find((p) => p.providerId === 'searchapi');
    expect(saReport?.status).toBe('error');
    expect(saReport?.detail).toMatch(/^auth/);
    expect(saReport?.ledger).toEqual({ rows: 1, firstAttemptOk: 0 });
    expect(r.providers.find((p) => p.providerId === 'travelpayouts')?.status).toBe('priced');
    expect(r.summary.startsWith('cheapest found ')).toBe(true);
    ports.db.close();
  });

  it('1: a retryable 503 is not retried past the per-run cap of one call', async () => {
    const sa = recording('searchapi');
    server.use(...replayHandlers(RECORDED_ROOT));
    server.use(http.all(`${sa.origin}/*`, () => new HttpResponse(null, { status: 503 }), { once: true }));
    const { ports } = testPorts(both, { now: smokeRecordedAt() });
    const r = await runSmoke(ports, { origin: LHR, destination: JFK });
    expect(r.exitCode).toBe(1);
    const saReport = r.providers.find((p) => p.providerId === 'searchapi');
    expect(saReport?.detail).toMatch(/^budget: execution-calls/);
    expect(saReport?.ledger.rows).toBe(1);
    ports.db.close();
  }, 30_000);

  it('3: no error but the tile holds no price', async () => {
    const tp = recording('travelpayouts');
    // why: the recorded envelope with its rows removed is the schema-valid empty case (spec §5.2).
    server.use(http.get(`${tp.origin}${tp.path}`, () => HttpResponse.json({ ...(tp.rec.body as Record<string, unknown>), data: [] })));
    const { ports } = testPorts(testEnv({ TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts }), { now: smokeRecordedAt() });
    const r = await runSmoke(ports, { origin: LHR, destination: JFK });
    expect(r.exitCode).toBe(3);
    expect(r.providers.map((p) => p.status)).toEqual(['empty']);
    expect(r.summary).toBe('no price found');
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smokeExitCodes.test.ts`
Expected: Task 13.1 already implements this behaviour, so this is a characterisation run and may pass at once. Prove the assertions bite by temporarily changing the empty case's `toBe(3)` to `toBe(0)`. Expected: FAIL "expected 3 to be 0". Then restore it.

- [ ] **Step 3: Implement**

No new code unless a case fails. Fix any failure in `smoke.ts`, never in the test.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smokeExitCodes.test.ts test/tools/smoke.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp13: smoke exit codes 1, 2, 3, 64 and the one-call cap"
```

### Task 13.3: Argument parsing and mounting `POST /api/tools/smoke`

**Files:**
- Create: `apps/api/test/tools/smokeArgs.test.ts`, `apps/api/test/routes/toolsSmoke.test.ts`
- Modify: `apps/api/src/routes/types.ts`, `apps/api/src/routes/tools.ts`, `apps/api/src/tools/inProcess.ts`

**Interfaces:**
- Consumes: `createApp(ports, engine, options)`, `inProcessTools`, `toolHandlers`, `createEngine`, `toolSmokeRequestSchema`, `toolRunResponseSchema`.
- Produces: the `smoke` runner and the mounted route.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/tools/smokeArgs.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { parseSmokeArgs, smokeQuery, smokeTool } from '../../src/tools/smoke.js';

describe('parseSmokeArgs, smokeTool.start and smokeQuery', () => {
  it('reads both flag forms and upper-cases', () => {
    expect(parseSmokeArgs(['--origin', 'lhr', '--destination=JFK'])).toEqual({ ok: true, args: { origin: 'LHR', destination: 'JFK' } });
  });
  it('a missing or malformed code is a usage refusal before any port is built', () => {
    for (const argv of [['--origin'], ['--origin', 'LHR'], ['--origin', 'L1R', '--destination', 'JFK']]) {
      expect(parseSmokeArgs(argv).ok).toBe(false);
      expect(smokeTool.start(argv).ok).toBe(false);
    }
  });
  it.each([['2026-10-14', '2026-11-01'], ['2026-12-31', '2027-01-01'], ['2028-01-31', '2028-02-01'], ['2026-11-01', '2026-12-01']])(
    'today %s → departures from %s, eight days inside one month',
    (today, from) => {
      const q = smokeQuery(asIsoDate(today), asIata('LHR'), asIata('JFK'));
      expect(q.departureFrom).toBe(from);
      expect(q.departureTo.slice(0, 7)).toBe(from.slice(0, 7));
      expect([q.minNights, q.maxNights]).toEqual([10, 21]);
    },
  );
});
```

`apps/api/test/routes/toolsSmoke.test.ts`:

```ts
import { apiContract, asIsoDateTime } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { inProcessTools } from '../../src/tools/inProcess.js';
import { SENTINELS, testEnv, testPorts } from '../support/env.js';

describe('POST /api/tools/smoke (spec §10 rev 10)', () => {
  it('validates the body, awaits runSmoke and returns toolRunResponseSchema; zero providers → 2, no call', async () => {
    const { ports } = testPorts(testEnv({ APP_BASIC_AUTH_USER: 'operator', APP_BASIC_AUTH_PASS: SENTINELS.authPass }), { now: asIsoDateTime('2026-10-14T09:00:00.000Z') });
    const app = createApp(ports, createEngine({ ...ports, notifiers: [] }), { webRoot: null, tools: inProcessTools(ports) });
    const headers = {
      Authorization: `Basic ${Buffer.from(`operator:${SENTINELS.authPass}`).toString('base64')}`,
      Host: 'localhost:3000', 'Content-Type': 'application/json', 'X-Requested-With': 'get-me-there',
    };
    const ok = await app.request('http://localhost:3000/api/tools/smoke', { method: 'POST', headers, body: JSON.stringify({ origin: 'lhr', destination: 'JFK' }) });
    expect(ok.status).toBe(200);
    const body = apiContract.toolRunResponseSchema.parse(await ok.json());
    expect(body).toEqual({
      exitCode: 2, summary: 'no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY',
      lines: ['no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY'], fixturesWritten: [],
    });
    const bad = await app.request('http://localhost:3000/api/tools/smoke', { method: 'POST', headers, body: JSON.stringify({ origin: 'L1R' }) });
    expect(bad.status).toBe(400);
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/smokeArgs.test.ts test/routes/toolsSmoke.test.ts`
Expected: `smokeArgs` passes (Task 13.1). The route test FAILS with status 503 `tool_unavailable`, because WP8's `inProcessTools` has no `smoke` yet.

- [ ] **Step 3: Implement**

`apps/api/src/routes/types.ts`, the `smoke` member of `ToolRunners`:

```ts
/** Spec §10 rev 10: the smoke takes the operator's airports and answers toolRunResponseSchema. */
smoke?: (args: z.infer<typeof apiContract.toolSmokeRequestSchema>) => Promise<z.infer<typeof apiContract.toolRunResponseSchema>>;
```

`apps/api/src/routes/tools.ts`, the smoke entry of `toolHandlers` (WP8's busy, 503 and failure handling in its `runTool` helper stays as written):

```ts
'POST /tools/smoke': (c, input, ctx) => {
  const smoke = ctx.tools.smoke;
  // why: the body was validated against ROUTES' toolSmokeRequestSchema by WP8's validator.
  const body = input.body as z.infer<typeof apiContract.toolSmokeRequestSchema>;
  return runTool(c, ctx, 'smoke', smoke === undefined ? null : () => smoke(body));
},
```

`apps/api/src/tools/inProcess.ts`:

```ts
import { runSmoke, toToolRunResponse } from './smoke.js';

export function inProcessTools(ports: Ports): ToolRunners {
  return {
    record: (args) => recordFixtures(ports, args, ports.log),
    // why: the app's ports carry recorder null, so the route writes no fixtures and says so (spec §13 rev 10).
    smoke: async (args) => toToolRunResponse(await runSmoke(ports, args)),
  };
}
```

WP8's `runTool` helper spreads `{ tool: name, ...result }`, and `toolRunResponseSchema` does not list `tool` (§3 item 2). The route test parses with the schema, which strips unknown keys, so it passes either way. Removing the `tool` field is WP8's call, since it also affects `/tools/record`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS with 85/70 coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp13: mount POST /api/tools/smoke with the request and response schemas (spec §10)"
```

### Task 13.4: Layer-B engine tests with the real adapters

**Files:**
- Create: `packages/engine/test/layerB/support.ts`, `discovery.test.ts`, `verification.test.ts`, `errors.test.ts`
- Modify: `packages/engine/test/harness.ts` (additive)

**Interfaces:**
- Consumes: `createHarness`, `createEngine`, `searchApiProvider`, `searchApiHttpLimits`, `SEARCHAPI_PARAMS`, `travelpayoutsProvider`, `travelpayoutsHttpLimits`, `TRAVELPAYOUTS_PARAMS`, `PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`, `replayHandlers`, `loadRecorded`, `loadAirportsDataset`.
- Produces: `HarnessOptions.vendors`, and `repos` in the `extraProviders` tools.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/layerB/support.ts`:

```ts
/**
 * Layer B (spec §9 item 4): the real SearchApi and Travelpayouts adapters over msw replaying
 * fixtures/recorded, through WP7's harness (real http-kit, real SqliteBudgetGuard, in-memory DB).
 */
import { fileURLToPath } from 'node:url';
import { type Clock, type DefinitionInput, type IsoDate, type Logger, PLAN_PRESETS, Secret, TRAVELPAYOUTS_DEFAULTS, addDays, asIata, asIsoDate, monthsSpanned } from '@gmt/core';
import { type Repos, loadAirportsDataset } from '@gmt/db';
import { type HttpKit, SEARCHAPI_PARAMS, TRAVELPAYOUTS_PARAMS, searchApiHttpLimits, searchApiProvider, travelpayoutsHttpLimits, travelpayoutsProvider } from '@gmt/providers';
import { loadRecorded, replayHandlers } from '@gmt/providers/testing';
import { type Harness, type HarnessOptions, createHarness } from '../harness.js';

export const RECORDED_ROOT = fileURLToPath(new URL('../../../providers/fixtures/recorded', import.meta.url));
const AIRPORTS_DIR = fileURLToPath(new URL('../../../db/data', import.meta.url));
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
export const RECORD_RECORDED_BY = '@gmt/api record:fixtures';
const TIMING = { maxWaitSeconds: 60, requestTimeoutSeconds: 10 };

export function recordings() {
  return [...loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search'), ...loadRecorded(RECORDED_ROOT, 'travelpayouts', '/aviasales/v3/prices_for_dates')];
}
export function smokeRecordedAt() {
  const t = recordings().filter((r) => r.recordedBy === SMOKE_RECORDED_BY).map((r) => r.recordedAt).sort().at(-1);
  if (t === undefined) throw new Error('no smoke recordings (WP13 Task 13.1 step 5)');
  return t;
}

/** The harness with both vendors routed to their real hosts, the real airports and metros seeded, and replay installed. */
export function layerB(now: HarnessOptions['now'], over: Partial<HarnessOptions> = {}): Harness {
  const sa = PLAN_PRESETS['40usd'];
  const h = createHarness({
    now,
    vendors: {
      searchapi: { http: searchApiHttpLimits(sa, TIMING), limits: sa, billable: true },
      travelpayouts: { http: travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, TIMING), limits: TRAVELPAYOUTS_DEFAULTS, billable: false },
    },
    extraProviders: (t: { clock: Clock; log: Logger; http: HttpKit; repos: Repos }) => [
      searchApiProvider({ http: t.http, log: t.log, clock: t.clock, key: new Secret('test-searchapi-key-0123456789abcdef'), plan: '40usd', pointOfSale: 'GB', cacheTtlSeconds: 3600, paramsAllowlist: SEARCHAPI_PARAMS }),
      travelpayoutsProvider({ http: t.http, log: t.log, clock: t.clock, token: new Secret('test-travelpayouts-token-0123456789abcdef'), cacheTtlSeconds: 21_600, paramsAllowlist: TRAVELPAYOUTS_PARAMS, airports: t.repos.airports }),
    ],
    ...over,
  });
  // why: the smoke ran against the real table, where LHR maps to metro LON; Travelpayouts sends that metro.
  h.repos.airports.upsertAll(loadAirportsDataset(AIRPORTS_DIR));
  h.server.use(...replayHandlers(RECORDED_ROOT));
  return h;
}

/** The smoke's one-tile space. Same rule as apps/api smokeQuery (engine may not import api); a drift shows as unhandled requests. */
export function smokeSpace(today: IsoDate): Partial<DefinitionInput> {
  const next = monthsSpanned(today, addDays(today, 31))[1];
  if (next === undefined) throw new Error('monthsSpanned');
  const from = asIsoDate(`${next}-01`);
  return {
    origins: [asIata('LHR')], destinations: [asIata('JFK')], window: { kind: 'absolute', from, to: addDays(from, 7) },
    minNights: 10, maxNights: 21, cabin: 'economy',
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: [], discoveryRefreshHours: {} },
  };
}
```

`packages/engine/test/layerB/discovery.test.ts`:

```ts
import { createEngine } from '@gmt/engine';
import { describe, expect, it } from 'vitest';
import { layerB, smokeRecordedAt, smokeSpace } from './support.js';

type Row = { provider_id: string; source_kind: string; point_of_sale: string; max_age_hours: number | null; fetched_at: string; reused_from_execution_id: string | null };

describe('layer B discovery (spec §9 item 4, §5.2, §8.1)', () => {
  it('one month tile and one rectangle through the real adapters with full provenance, then a reuse run with zero calls', async () => {
    const at = smokeRecordedAt();
    const h = layerB(at);
    const engine = createEngine(h.deps, h.options);
    const def = h.createDefinition(smokeSpace(h.clock.todayLondon()));

    const first = await h.runToCompletion(engine, def.id);
    expect(first.status).toBe('completed');
    expect(h.tileRequests(first.id)).toBe(2); // parity: plan() length 1 per provider
    for (const pid of ['travelpayouts', 'searchapi'] as const) {
      const b = h.repos.cells.buckets(first.id, 'discovery', pid);
      expect(b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run).toBe(96); // 8 days × 12 nights
      expect(b.priced).toBeGreaterThan(0);
      expect([b.error, b.not_run]).toEqual([0, 0]);
    }
    const rows = h.db.raw.prepare('SELECT provider_id, source_kind, point_of_sale, max_age_hours, fetched_at, reused_from_execution_id FROM calendar_prices WHERE execution_id = ?').all(first.id) as Row[];
    expect(new Set(rows.map((r) => r.provider_id))).toEqual(new Set(['travelpayouts', 'searchapi']));
    for (const r of rows) {
      expect(r.fetched_at).toBe(at);
      expect(r.reused_from_execution_id).toBeNull();
      const expected = r.provider_id === 'travelpayouts' ? ['authorised-cached', 'unknown', 48] : ['scraped-aggregate', 'GB', 24];
      expect([r.source_kind, r.point_of_sale, r.max_age_hours]).toEqual(expected);
    }

    h.clock.advance(3_600_000);
    const second = await h.runToCompletion(engine, def.id);
    expect(h.ledgerRows(second.id)).toEqual([]);
    const reused = h.db.raw.prepare('SELECT fetched_at, reused_from_execution_id FROM calendar_prices WHERE execution_id = ?').all(second.id) as Row[];
    expect(reused.length).toBe(rows.length);
    for (const r of reused) expect([r.reused_from_execution_id, r.fetched_at]).toEqual([first.id, at]); // original fetchedAt (spec §8.1)
    h.close();
  }, 60_000);
});
```

`packages/engine/test/layerB/verification.test.ts`:

```ts
import { asIata, asIsoDate, daysBetween } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { describe, expect, it } from 'vitest';
import { RECORD_RECORDED_BY, layerB, recordings } from './support.js';

/** WP4b's step 1→2→3 chain (spec §9 item 7): step 1 carries neither token parameter. */
function chain() {
  const flights = recordings().filter((r) => r.recordedBy === RECORD_RECORDED_BY && new URL(r.request.url).searchParams.get('engine') === 'google_flights');
  const step1 = flights.find((r) => { const p = new URL(r.request.url).searchParams; return !p.has('departure_token') && !p.has('booking_token'); });
  if (step1 === undefined) throw new Error('no recorded google_flights step 1 (WP4b)');
  return { step1, expandTop: flights.filter((r) => new URL(r.request.url).searchParams.has('departure_token')).length };
}

describe('layer B verification (spec §5.4, §9 item 4)', () => {
  it('replays the recorded chain for its cell as a child execution with scraped-search provenance', async () => {
    const { step1, expandTop } = chain();
    expect(expandTop).toBeGreaterThan(0);
    expect(expandTop).toBeLessThanOrEqual(2); // why: CHILD_MAX_CALLS 6 ≥ 1 + 2 × 2 (spec §8.1)
    const p = new URL(step1.request.url).searchParams;
    const cell = { origin: asIata(p.get('departure_id') ?? ''), destination: asIata(p.get('arrival_id') ?? ''), departureDate: asIsoDate(p.get('outbound_date') ?? ''), returnDate: asIsoDate(p.get('return_date') ?? '') };
    const h = layerB(step1.recordedAt);
    const engine = createEngine(h.deps, h.options);
    const nights = daysBetween(cell.departureDate, cell.returnDate);
    const def = h.createDefinition({
      origins: [cell.origin], destinations: [cell.destination], window: { kind: 'absolute', from: cell.departureDate, to: cell.departureDate },
      minNights: nights, maxNights: nights, providers: { discovery: [], verification: ['searchapi'], discoveryRefreshHours: {} },
      verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop, bookingLinks: true },
    });
    const child = await engine.verifyCell(def.id, cell);
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect((await h.waitForSettled(child.executionId)).status).toBe('completed');
    const obs = h.db.raw.prepare('SELECT source_kind, max_age_hours, fetched_at, booking_json FROM price_observations WHERE execution_id = ?').all(child.executionId) as Array<{ source_kind: string; max_age_hours: number; fetched_at: string; booking_json: string | null }>;
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect([o.source_kind, o.max_age_hours, o.fetched_at]).toEqual(['scraped-search', 0, step1.recordedAt]);
      const booking = o.booking_json === null ? { kind: 'none' } : (JSON.parse(o.booking_json) as { kind: string; host?: string });
      if (booking.kind !== 'none') expect(booking.host === 'google.com' || booking.host?.endsWith('.google.com')).toBe(true);
    }
    expect(h.repos.routeHistory.series(cell.origin, cell.destination, 'searchapi').length).toBeGreaterThan(0);
    expect(h.ledgerRows(child.executionId).length).toBeLessThanOrEqual(1 + expandTop * 2);
    h.close();
  }, 60_000);
});
```

`packages/engine/test/layerB/errors.test.ts`:

```ts
import { createEngine } from '@gmt/engine';
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { layerB, recordings, smokeRecordedAt, smokeSpace } from './support.js';

const originOf = (providerId: string) => {
  const r = recordings().find((x) => x.providerId === providerId);
  if (r === undefined) throw new Error(providerId);
  return new URL(r.request.url).origin;
};

describe('layer B error-table rows with real adapters (spec §8.1)', () => {
  it.each([
    ['searchapi', () => HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 }), 'travelpayouts'],
    ['travelpayouts', () => HttpResponse.text('Unauthorized', { status: 401 }), 'searchapi'],
  ] as const)('%s auth failure disables it for the run; the other still prices; completed', async (failing, respond, other) => {
    const h = layerB(smokeRecordedAt());
    // why: spec §2 fact 5 recorded these exact 401 bodies; server.use prepends, so this wins over replay.
    h.server.use(http.all(`${originOf(failing)}/*`, respond));
    const engine = createEngine(h.deps, h.options);
    const def = h.createDefinition(smokeSpace(h.clock.todayLondon()));
    const run = await h.runToCompletion(engine, def.id);
    expect(run.status).toBe('completed');
    const bad = h.repos.cells.buckets(run.id, 'discovery', failing);
    expect([bad.priced, bad.not_run]).toEqual([0, 0]);
    expect(bad.error + bad.skipped).toBe(96);
    expect(h.repos.cells.buckets(run.id, 'discovery', other).priced).toBeGreaterThan(0);
    expect(h.repos.notifications.wasSent('provider_disabled', run.id, def.id)).toBe(true);
    h.close();
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm --filter @gmt/engine exec vitest run test/layerB`
Expected: FAIL. TypeScript reports "Object literal may only specify known properties, and 'vendors' does not exist in type 'HarnessOptions'". At runtime, requests to the vendor hosts are refused by the harness's egress allowlist.

- [ ] **Step 3: Implement the harness extension**

In `packages/engine/test/harness.ts`:

```ts
// HarnessOptions, added:
/** Layer B (WP13): route a real vendor through the harness's http-kit and budget guard. */
vendors?: Partial<Record<'searchapi' | 'travelpayouts', { http: ProviderHttpLimits; limits: ProviderLimits; billable: boolean }>>;
// extraProviders tools type, widened: (tools: { clock: Clock; log: Logger; http: HttpKit; repos: Repos }) => FlightProvider[]
```

In `createHarness`, after `limits` and `budgetConfig` are built and before `createHttpKit`:

```ts
for (const [id, v] of Object.entries(opts.vendors ?? {}) as Array<['searchapi' | 'travelpayouts', { http: ProviderHttpLimits; limits: ProviderLimits; billable: boolean }]>) {
  limits[id] = v.http;
  budgetConfig.providers[id] = { limits: v.limits, billable: v.billable };
}
```

Then pass `repos` into `opts.extraProviders?.({ clock, log, http, repos })`, and change `server.listen({ onUnhandledRequest: 'error' })` to `server.listen({ onUnhandledFrame: 'error' })` (msw 3). Layer A is otherwise untouched.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && pnpm --filter @gmt/engine test`
Expected: PASS. The `engine` project holds 85/70 and layer A is unchanged. A layer-B failure that traces to `src` is a WP7, WP5 or WP6 defect. Fix it on this branch, with a regression test in the owning package.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp13: layer-B engine tests with real adapters on recorded fixtures (spec §9 item 4)"
```

### Task 13.5: A spawned tool bootstrap honours `app_lock` and starts no execution

WP4b's tests call `runTool` in-process. This test spawns the real entry as a separate OS process against a file DB that contains an enabled scheduled definition and an `interrupted` execution, so the boot sweep, auto-resume and cron would all have something to act on.

**Files:**
- Create: `apps/api/test/tools/appLock.spawn.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `applyMigrations`, `createRepos`, `seedAirports`, `loadAirportsDataset`, `AppLock`, `DefinitionsRepo.create`, `ExecutionsRepo.create`/`setStatus`, `EXIT` (WP4b), the `record --dry-run` arguments.

- [ ] **Step 1: Write the failing test**

```ts
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DefinitionSnapshot, asIata, asIsoDate, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, createRepos, loadAirportsDataset, openDatabase, seedAirports } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/bootstrap/tool.js';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { AIRPORTS_DIR, SENTINELS, captureLogger } from '../support/env.js';

const API_DIR = join(MIGRATIONS_DIR, '../../../apps/api');
const TOOL_ENTRY = join(API_DIR, 'src/bootstrap/tool.ts');
const DRY = ['--budget', '12', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--metro', 'LON', '--dry-run'];

/** Spawns the real tool bootstrap. NODE_ENV=development because both bootstraps refuse test (spec §5.5). */
function spawnTool(args: string[], dbPath: string, timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = {
    PATH: process.env.PATH ?? '', NODE_ENV: 'development', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1', LOG_LEVEL: 'info',
    AUTO_RESUME: 'true', SEARCHAPI_KEY: SENTINELS.searchapi, TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', TOOL_ENTRY, ...args], { env, cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { stderr += c; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`tool did not exit within ${timeoutMs} ms\n${stderr}`)); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function open(dbPath: string) {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  return { db, repos: createRepos(db, systemClock, { allowSynthetic: false }) };
}

/** A file DB that tempts every boot step: an enabled scheduled definition and an interrupted execution. */
function prepare(): { dbPath: string; executionId: string } {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-lock-')), 'lock.db');
  const { db, repos } = open(dbPath);
  seedAirports(db, loadAirportsDataset(AIRPORTS_DIR));
  const def = repos.definitions.create({
    name: 'lock test', origins: [asIata('LHR')], destinations: [asIata('JFK')], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 30 },
    minNights: 10, maxNights: 12, cabin: 'economy', constraints: {}, verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: 0, maxFreeCalls: 10, maxCostMicroGbp: 0 }, providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', confirmedCostPence: null, enabled: true,
  });
  // why: written through the repository, so validateSearchSpace never runs; the resolved window only needs to be well-formed.
  const day = asIsoDate(def.createdAt.slice(0, 10));
  const snapshot: DefinitionSnapshot = { ...def, resolved: { origins: def.origins, destinations: def.destinations, departureFrom: day, departureTo: day, minNights: 10, maxNights: 12 }, resolvedAt: def.createdAt, windowClamped: false };
  const ex = repos.executions.create({ definitionId: def.id, isChild: false, cell: null, snapshot, estimate: null, trigger: 'manual', status: 'running' });
  repos.executions.setStatus(ex.id, 'interrupted');
  db.close();
  return { dbPath, executionId: ex.id };
}

function state(dbPath: string) {
  const { db } = open(dbPath);
  const executions = db.raw.prepare('SELECT id, status, auto_resume_count FROM search_executions').all();
  const definitions = (db.raw.prepare('SELECT COUNT(*) AS n FROM search_definitions').get() as { n: number }).n;
  const ledger = (db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get() as { n: number }).n;
  return { db, executions, definitions, ledger, lock: AppLock.inspect(db) };
}

describe('spawned tool bootstrap and app_lock (spec §7)', () => {
  it('refuses while a fresh app lock exists, touching nothing', async () => {
    const { dbPath, executionId } = prepare();
    const held = open(dbPath);
    const appLock = new AppLock(held.db, 'app', systemClock, captureLogger().log);
    expect(appLock.acquire({ waitMs: 0 })).toBe('acquired');

    const r = await spawnTool(['record', ...DRY], dbPath);

    expect(r.code).toBe(EXIT.lockRefused);
    expect(r.stderr).toContain('app_lock is held by app');
    const after = state(dbPath);
    expect(after.lock?.holder).toBe('app');
    expect(after.executions).toEqual([{ id: executionId, status: 'interrupted', auto_resume_count: 0 }]);
    expect([after.definitions, after.ledger]).toEqual([1, 0]);
    appLock.release();
    after.db.close();
    held.db.close();
  }, 150_000);

  it('with no lock: acquires as tool, starts no execution, makes no call, releases', async () => {
    const { dbPath, executionId } = prepare();

    const r = await spawnTool(['record', ...DRY], dbPath);

    expect(r.code).toBe(EXIT.ok);
    const acquired = r.stdout.indexOf('tool lock acquired');
    expect(acquired).toBeGreaterThanOrEqual(0);
    expect(r.stdout.indexOf('tool lock released')).toBeGreaterThan(acquired);
    const after = state(dbPath);
    // why: no boot sweep, no auto-resume, no cron (spec §7): the interrupted run is untouched and nothing new exists.
    expect(after.executions).toEqual([{ id: executionId, status: 'interrupted', auto_resume_count: 0 }]);
    expect([after.definitions, after.ledger]).toEqual([1, 0]);
    expect(after.lock).toBeNull();
    const app = new AppLock(after.db, 'app', systemClock, captureLogger().log);
    expect(app.acquire({ waitMs: 0 })).toBe('acquired'); // released, not merely stale
    app.release();
    after.db.close();
    for (const s of Object.values(SENTINELS)) expect(r.stdout + r.stderr).not.toContain(s);
  }, 150_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/appLock.spawn.test.ts`
Expected: this characterises merged WP4b code, so both cases may pass at once. Prove the first case bites by commenting out `appLock.acquire(...)`. Expected: FAIL "expected 0 to be 4". Then restore it.

- [ ] **Step 3: Implement**

No `src` code. Any failure is a WP4b defect, fixed on this branch in `apps/api/src/bootstrap/tool.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/tools/appLock.spawn.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp13: spawned tool bootstrap honours app_lock and starts no execution (spec §7)"
```

### Task 13.6: Root `integration` project and the cross-cutting banned-word test

**Files:**
- Create: `integration/package.json`, `integration/tsconfig.json`, `integration/vitest.config.ts`, `integration/test/bannedWords.test.ts`
- Modify: `pnpm-workspace.yaml`, `vitest.config.ts`, `.github/workflows/ci.yml`, `apps/api/src/index.ts`, `packages/engine/src/index.ts` (export the names in §5 addition 3 where they are missing)

**Interfaces:**
- Consumes: `findBannedWords`, `BANNED_WORD_ALLOWLIST`, `COPY`, `API_TEXT`, `operatorMessage`, `OPERATOR_KINDS`, `renderBody`.

- [ ] **Step 1: Write the failing test**

`integration/test/bannedWords.test.ts`:

```ts
/**
 * Spec §11, §8.3: one banned-word list over every user-facing surface, in one place, with the one
 * allowlist from core. Per-package tests stay; this one fails if any surface drifts.
 */
import { API_TEXT } from '@gmt/api';
import { type AlertRule, BANNED_WORD_ALLOWLIST, asIsoDateTime, findBannedWords } from '@gmt/core';
import { OPERATOR_KINDS, operatorMessage, renderBody } from '@gmt/engine';
import { describe, expect, it } from 'vitest';
// why: web is a dependency of no package (spec §4); its pure catalogue is read by path.
import { COPY } from '../../apps/web/src/copy.js';

type Entry = { where: string; text: string };
/** Strings as they are; string-returning functions called with a placeholder per parameter. */
function flatten(where: string, value: unknown): Entry[] {
  if (typeof value === 'string') return [{ where, text: value }];
  if (typeof value === 'function') return flatten(`${where}()`, (value as (...a: string[]) => unknown)(...Array.from({ length: value.length }, () => 'x')));
  if (Array.isArray(value)) return value.flatMap((v, i) => flatten(`${where}[${i}]`, v));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => flatten(`${where}.${k}`, v));
  return [];
}

const RULE: AlertRule = { id: 'r1', definitionId: 'd1', type: 'absolute', thresholdPence: 45_000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true };
const engineTexts: Entry[] = [
  ...OPERATOR_KINDS.flatMap((kind) => flatten(`engine.operatorMessage(${kind})`, operatorMessage(kind, { definitionName: 'example', executionId: 'e1', detail: 'detail' }))),
  ...flatten('engine.renderBody(empty)', renderBody({ rule: RULE, definitionId: 'd1', definitionName: 'example', items: [], restCount: 0, newcomers: [], newcomersRest: 0, coverage: { kind: 'no-verification' }, now: asIsoDateTime('2026-10-14T09:00:00.000Z') })),
];
const sources = { web: flatten('web.COPY', COPY), engine: engineTexts, api: flatten('api.API_TEXT', API_TEXT) };
const all: Entry[] = [...sources.web, ...sources.engine, ...sources.api];

describe('banned words across web, engine templates and API strings (spec §11)', () => {
  it('every surface contributes strings (the test is not vacuous)', () => {
    for (const [name, entries] of Object.entries(sources)) expect(entries.length, name).toBeGreaterThan(0);
  });
  it('no user-facing string contains a banned word', () => {
    const hits = all.flatMap((e) => findBannedWords(e.text, BANNED_WORD_ALLOWLIST).map((h) => `${e.where}: "${e.text}" → ${h.word}`));
    expect(hits).toEqual([]);
  });
  it('the scan catches a planted word (positive control)', () => {
    expect(findBannedWords('prices are live and bookable', BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual(['live', 'bookable']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm vitest run --project integration`
Expected: FAIL, "No projects matched the filter integration".

- [ ] **Step 3: Implement**

`integration/package.json`:

```json
{
  "name": "@gmt/integration",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "dependencies": { "@gmt/core": "workspace:*", "@gmt/db": "workspace:*", "@gmt/providers": "workspace:*", "@gmt/engine": "workspace:*", "@gmt/api": "workspace:*" },
  "devDependencies": { "msw": "3.0.3", "hono": "4.13.13" }
}
```

`integration/tsconfig.json`:

```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "noEmit": true, "composite": false }, "include": ["test", "../apps/web/src/copy.ts"] }
```

`integration/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// why: cross-package tests (spec §9, §11, §5.3) measure the system, not one package's code, so this
// project has no coverage threshold; every package keeps its own.
export default defineConfig({ test: { name: 'integration', include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000 } });
```

Then:

- `pnpm-workspace.yaml`: add `- integration` under `packages:`.
- Root `vitest.config.ts`: add `'integration/vitest.config.ts'` to `projects`.
- `.github/workflows/ci.yml`: add `- run: pnpm build` before `- run: pnpm test:coverage`.
- Barrels: make sure `@gmt/api` exports `API_TEXT`, `buildPorts`, `loadConfigFromEnv`, `createLogger`, `createApp`, `inProcessTools`, `runSmoke`, and `@gmt/engine` exports `operatorMessage`, `OPERATOR_KINDS`, `EmailNotifier`, `renderBody`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm install && pnpm build && pnpm vitest run --project integration`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add integration pnpm-workspace.yaml vitest.config.ts .github apps/api/src/index.ts packages/engine/src/index.ts pnpm-lock.yaml && git commit -m "wp13: integration project and one banned-word test over every surface (spec §11)"
```

### Task 13.7: Whole-process sentinel-key test

**Files:**
- Create: `integration/test/support.ts`, `integration/test/sentinel.test.ts`

**Interfaces:**
- Consumes: `loadConfigFromEnv`, `buildPorts`, `createLogger`, `createApp`, `inProcessTools`, `runSmoke`, `createEngine`, `EmailNotifier`, `TransportFactory`, `fixtureHandlers`, `replayHandlers`, `loadRecorded`, `scenarioRequest`, `ROUTES`, `seedAirports`, `loadAirportsDataset`.

- [ ] **Step 1: Write the failing test**

`integration/test/support.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '@gmt/db';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURES_ROOT = join(REPO_ROOT, 'packages/providers/fixtures');
export const RECORDED_ROOT = join(FIXTURES_ROOT, 'recorded');
export const SYNTHETIC_ROOT = join(FIXTURES_ROOT, 'synthetic/fixture');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'packages/db/drizzle');
export const AIRPORTS_DIR = join(REPO_ROOT, 'packages/db/data');

export function* walkFiles(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else yield p;
  }
}

/** Every value of every column of every table, found through sqlite_master (spec §5.3 "any DB column"). */
export function everyDbValue(db: Db): Array<{ where: string; text: string }> {
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  return tables.flatMap(({ name }) =>
    (db.raw.prepare(`SELECT * FROM "${name}"`).all() as Array<Record<string, unknown>>).flatMap((row, i) =>
      Object.entries(row).map(([col, v]) => ({ where: `${name}[${i}].${col}`, text: Buffer.isBuffer(v) ? v.toString('utf8') : String(v) })),
    ),
  );
}

export function fileTexts(root: string): Array<{ where: string; text: string }> {
  return [...walkFiles(root)].map((f) => ({ where: f, text: readFileSync(f, 'utf8') }));
}
```

`integration/test/sentinel.test.ts`:

```ts
/**
 * Spec §5.3: the sentinel-key test across the whole process. Every secret is configured with a
 * sentinel and every path runs, error paths included. Then every sink is scanned: pino output,
 * every DB value, every GET body, the captured email, the fixtures trees and error messages.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { buildPorts, createApp, createLogger, inProcessTools, loadConfigFromEnv, runSmoke } from '@gmt/api';
import { type AlertDigest, type AlertRule, type OperatorMessage, Secret, apiContract, asIata, fixedClock } from '@gmt/core';
import { loadAirportsDataset, seedAirports } from '@gmt/db';
import { EmailNotifier, type TransportFactory, createEngine } from '@gmt/engine';
import { createRecorder, scenarioRequest } from '@gmt/providers';
import { fixtureHandlers, loadRecorded, replayHandlers } from '@gmt/providers/testing';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { describe, expect, it, vi } from 'vitest';
import { AIRPORTS_DIR, FIXTURES_ROOT, MIGRATIONS_DIR, RECORDED_ROOT, SYNTHETIC_ROOT, everyDbValue, fileTexts } from './support.js';

const S = {
  searchapi: 'test-searchapi-key-0123456789abcdef',
  travelpayouts: 'test-travelpayouts-token-0123456789abcdef',
  smtp: 'test-smtp-pass-0123456789abcdef',
  auth: 'test-basic-auth-pass-0123456789abcdef',
} as const;
const USER = 'operator';
const BASIC = Buffer.from(`${USER}:${S.auth}`).toString('base64');
/** Each sentinel as written, URL-encoded and base64, plus the basic-auth header value. */
const FORMS = [...Object.values(S).flatMap((v) => [v, encodeURIComponent(v), Buffer.from(v).toString('base64')]), BASIC];
const findSentinels = (where: string, text: string): string[] => FORMS.filter((f) => text.includes(f)).map((f) => `${where} contains sentinel form ${f.slice(0, 14)}…`);
const smokeAt = () => {
  const t = [...loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search'), ...loadRecorded(RECORDED_ROOT, 'travelpayouts', '/aviasales/v3/prices_for_dates')]
    .filter((r) => r.recordedBy === '@gmt/api smoke:live').map((r) => r.recordedAt).sort().at(-1);
  if (t === undefined) throw new Error('no smoke recordings');
  return t;
};

describe('no secret reaches any sink (spec §5.3)', () => {
  it('finds a planted sentinel (positive control)', () => {
    expect(findSentinels('control', `x ${S.searchapi} y`)).toHaveLength(1);
    expect(findSentinels('control', `Authorization: Basic ${BASIC}`)).toHaveLength(1);
  });

  it('runs every path with sentinel secrets and scans every sink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmt-sentinel-'));
    const fixturesOut = join(dir, 'recorded');
    const recordedAt = smokeAt();
    const env = {
      NODE_ENV: 'test', DATABASE_PATH: join(dir, 'sentinel.test.db'), BIND_ADDRESS: '127.0.0.1', LOG_LEVEL: 'debug',
      APP_BASIC_AUTH_USER: USER, APP_BASIC_AUTH_PASS: S.auth,
      TRAVELPAYOUTS_TOKEN: S.travelpayouts, SEARCHAPI_KEY: S.searchapi, SEARCHAPI_PLAN: 'trial',
      SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_TLS: 'none', SMTP_USER: 'gmt', SMTP_PASS: S.smtp,
      ALERT_EMAIL_TO: 'operator@example.com', ALERT_EMAIL_FROM: 'gmt@example.com',
    };

    // --- sinks we capture
    const logLines: string[] = [];
    const sink = new Writable({ write(chunk, _enc, cb) { logLines.push(String(chunk)); cb(); } });
    const sentMail: string[] = [];
    const smtpPassSeen: string[] = [];
    const capture: TransportFactory = (o) => {
      smtpPassSeen.push(o.auth.pass);
      return { sendMail: async (m) => { sentMail.push(JSON.stringify(m)); return { messageId: `<m${sentMail.length}@test>` }; } };
    };
    const failing: TransportFactory = () => ({ sendMail: async () => { throw new Error('535 5.7.8 authentication failed'); } });

    // --- the process
    const config = loadConfigFromEnv(env);
    if (config.smtp === null) throw new Error('smtp config');
    const log = createLogger(config, { destination: sink });
    const clock = fixedClock(recordedAt);
    const recorder = createRecorder({ root: fixturesOut, secrets: [new Secret(S.searchapi), new Secret(S.travelpayouts)], clock, recordedBy: '@gmt/api smoke:live' });
    // why: no fixtureRoot, so fixture.local goes to global fetch and msw, where scenario rules can be set (brief §3 item 8).
    const ports = buildPorts(config, { log, clock, recorder, migrationsDir: MIGRATIONS_DIR });
    seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DIR));
    const emailOk = new EmailNotifier({ smtp: config.smtp, nodeEnv: config.nodeEnv, log, createTransport: capture });
    const emailBad = new EmailNotifier({ smtp: config.smtp, nodeEnv: config.nodeEnv, log, createTransport: failing });
    const engine = createEngine({ ...ports, notifiers: [emailOk] });
    const app = createApp(ports, engine, { webRoot: null, tools: inProcessTools(ports) });

    const server = setupServer();
    const seen: Array<{ url: string; headers: string }> = [];
    server.events.on('request:start', ({ request }) => { seen.push({ url: request.url, headers: JSON.stringify([...request.headers]) }); });
    const trapped: string[] = [];
    server.use(
      http.all('https://egress-trap.example/*', ({ request }) => { trapped.push(request.headers.get('authorization') ?? ''); return HttpResponse.json({}); }),
      ...fixtureHandlers(SYNTHETIC_ROOT),
      ...replayHandlers(RECORDED_ROOT),
    );
    server.listen({ onUnhandledFrame: 'error' });
    try {
      // 1. Smoke, success: both vendor keys travel in headers.
      expect((await runSmoke(ports, { origin: asIata('LHR'), destination: asIata('JFK') })).exitCode).toBe(0);

      // 2. Smoke, error paths: a SearchApi 401, and a Travelpayouts 302 to another host (egress refuses it, so no credentials leave).
      const originOf = (id: 'searchapi' | 'travelpayouts') => new URL((id === 'searchapi' ? loadRecorded(RECORDED_ROOT, id, '/api/v1/search') : loadRecorded(RECORDED_ROOT, id, '/aviasales/v3/prices_for_dates'))[0]?.request.url ?? '').origin;
      server.use(
        http.all(`${originOf('searchapi')}/*`, () => HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 }), { once: true }),
        http.all(`${originOf('travelpayouts')}/*`, () => new HttpResponse(null, { status: 302, headers: { Location: 'https://egress-trap.example/steal' } }), { once: true }),
      );
      expect((await runSmoke(ports, { origin: asIata('LHR'), destination: asIata('JFK') })).exitCode).toBe(1);
      expect(trapped).toEqual([]);

      // 3. An execution on the fixture provider with a 500 and a network error in discovery, then a 401 for one child.
      const def = ports.repos.definitions.create({
        name: 'sentinel', origins: [asIata('LHR')], destinations: [asIata('JFK')], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 3 },
        minNights: 10, maxNights: 11, cabin: 'economy', constraints: {}, verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true },
        budget: { maxCalls: 50, maxFreeCalls: 50, maxCostMicroGbp: 0 }, providers: { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: {} },
        destinationNotes: {}, onwardCostPence: {}, scheduleCron: null, scheduleTz: 'Europe/London', confirmedCostPence: null, enabled: true,
      });
      await fetch(scenarioRequest([
        { match: { path: '/calendar' }, respond: { kind: 'status', status: 500, body: { error: 'upstream exploded' } }, times: 1 },
        { match: { path: '/calendar' }, respond: { kind: 'network' }, times: 1 },
      ]));
      const run = await engine.start(def.id, { trigger: 'manual' });
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      await vi.waitFor(() => expect(['completed', 'paused_error', 'paused_budget']).toContain(ports.repos.executions.get(run.executionId)?.status), { timeout: 30_000 });
      const cell = ports.repos.cells.outcomes(run.executionId)[0];
      if (cell === undefined) throw new Error('no outcomes');
      await fetch(scenarioRequest([{ match: { path: '/itinerary' }, respond: { kind: 'status', status: 401, body: { error: 'denied' } }, times: 1 }]));
      const child = await engine.verifyCell(def.id, { origin: cell.origin, destination: cell.destination, departureDate: cell.departureDate, returnDate: cell.returnDate });
      if (child.ok) await vi.waitFor(() => expect(ports.repos.executions.get(child.executionId)?.status).not.toBe('running'), { timeout: 30_000 });

      // 4. Email: a digest and an operator message delivered, and a failed delivery logged.
      const rule: AlertRule = { id: 'r1', definitionId: def.id, type: 'absolute', thresholdPence: 45_000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true };
      const digest: AlertDigest = { ruleId: 'r1', definitionId: def.id, executionId: run.executionId, basis: 'calendar', items: [], restCount: 0, newItems: [], coverageCaveat: null, rule };
      const message: OperatorMessage = { kind: 'paused_error', executionId: run.executionId, definitionId: def.id, subject: '[get-me-there] paused', body: 'paused with an error' };
      expect((await emailOk.send({ kind: 'digest', digest, subject: '[get-me-there] test digest', body: 'calendar price, no itinerary' })).ok).toBe(true);
      expect((await emailOk.send({ kind: 'operator', message })).ok).toBe(true);
      const failed = await emailBad.send({ kind: 'operator', message });
      expect(failed.ok).toBe(false);

      // 5. API: every GET route authenticated, plus a failed auth, a validation error and the smoke route.
      const firstHash = (ports.db.raw.prepare('SELECT hash FROM itineraries LIMIT 1').get() as { hash: string } | undefined)?.hash ?? '0'.repeat(64);
      const params: Record<string, string> = { origin: cell.origin, destination: cell.destination, departureDate: cell.departureDate, returnDate: cell.returnDate, hash: firstHash };
      const auth = { Authorization: `Basic ${BASIC}`, Host: 'localhost:3000' };
      const bodies: Array<{ where: string; text: string }> = [];
      for (const route of apiContract.ROUTES.filter((r) => r.method === 'GET')) {
        const path = route.path.replace(/:(\w+)/g, (_m, k: string) => (k === 'id' ? (route.path.startsWith('/api/executions') ? run.executionId : def.id) : (params[k] ?? '')));
        const res = await app.request(`http://localhost:3000${path}`, { headers: auth });
        bodies.push({ where: `GET ${path} (${res.status})`, text: await res.text() });
      }
      const mutate = { ...auth, 'Content-Type': 'application/json', 'X-Requested-With': 'get-me-there' };
      const denied = await app.request('http://localhost:3000/api/providers', { headers: { Authorization: `Basic ${Buffer.from(`${USER}:wrong-password-1234`).toString('base64')}`, Host: 'localhost:3000' } });
      bodies.push({ where: 'GET /api/providers (bad auth)', text: await denied.text() });
      const invalid = await app.request('http://localhost:3000/api/definitions', { method: 'POST', headers: mutate, body: '{"name":1}' });
      bodies.push({ where: 'POST /api/definitions (invalid)', text: await invalid.text() });
      const smokeRoute = await app.request('http://localhost:3000/api/tools/smoke', { method: 'POST', headers: mutate, body: JSON.stringify({ origin: 'LHR', destination: 'JFK' }) });
      bodies.push({ where: 'POST /api/tools/smoke', text: await smokeRoute.text() });

      // --- the paths really carried the sentinels (otherwise the scan proves nothing)
      expect(seen.some((r) => r.headers.includes(S.searchapi))).toBe(true);
      expect(seen.some((r) => r.headers.includes(S.travelpayouts))).toBe(true);
      expect(seen.filter((r) => FORMS.some((f) => r.url.includes(f)))).toEqual([]); // keys never in a URL (spec §2 fact 8)
      expect(smtpPassSeen).toContain(S.smtp);
      expect(logLines.some((l) => (JSON.parse(l) as { level: number }).level >= 50)).toBe(true); // error paths logged
      expect(sentMail).toHaveLength(2);
      expect(bodies.length).toBeGreaterThan(20);

      // --- scan every sink
      const errorMessages = [failed.detail ?? '', ...(ports.db.raw.prepare('SELECT error_text FROM search_executions').all() as Array<{ error_text: string | null }>).map((r) => r.error_text ?? '')];
      const findings = [
        ...logLines.flatMap((l, i) => findSentinels(`log[${i}]`, l)),
        ...everyDbValue(ports.db).flatMap((v) => findSentinels(`db ${v.where}`, v.text)),
        ...bodies.flatMap((b) => findSentinels(`api ${b.where}`, b.text)),
        ...sentMail.flatMap((m, i) => findSentinels(`email[${i}]`, m)),
        ...errorMessages.flatMap((m, i) => findSentinels(`error[${i}]`, m)),
        ...fileTexts(FIXTURES_ROOT).flatMap((f) => findSentinels(f.where, f.text)),
        ...fileTexts(fixturesOut).flatMap((f) => findSentinels(f.where, f.text)),
      ];
      expect(findings).toEqual([]);
    } finally {
      server.close();
      ports.db.close();
    }
  }, 180_000);
});
```

The recorder is built before `ports`, so it is given the two provider sentinels directly rather than `ports.secrets`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm vitest run --project integration -- sentinel`
Expected: FAIL. Until the §5 addition 3 exports exist (for example `createLogger`), the failure is a missing export. After that, a FAIL names a real leak through the `findings` array.

- [ ] **Step 3: Implement**

Add the missing barrel exports. For each finding, fix the sink at its source by adding the missing scrub: `stripUrl`, a pino redact path, or `Secret` in place of a raw string. Never weaken the scan.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && pnpm vitest run --project integration && pnpm test`
Expected: PASS, and every package keeps its threshold.

- [ ] **Step 5: Commit**

```bash
git add integration apps/api packages/engine && git commit -m "wp13: whole-process sentinel-key test over logs, DB, API, email and fixtures (spec §5.3)"
```

### Task 13.8: Route-mount test and the integration review

**Files:**
- Create: `integration/test/routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { Writable } from 'node:stream';
import { buildPorts, createApp, createLogger, inProcessTools, loadConfigFromEnv } from '@gmt/api';
import { apiContract, asIsoDateTime, fixedClock } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { inspectRoutes } from 'hono/dev';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './support.js';

describe('every spec §10 route is mounted under /api (spec §10 rev 10)', () => {
  it('ROUTES and the app agree, both ways', () => {
    const config = loadConfigFromEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' });
    const log = createLogger(config, { destination: new Writable({ write(_c, _e, cb) { cb(); } }) });
    const ports = buildPorts(config, { log, clock: fixedClock(asIsoDateTime('2026-10-14T09:00:00.000Z')), migrationsDir: MIGRATIONS_DIR });
    const app = createApp(ports, createEngine({ ...ports, notifiers: [] }), { webRoot: null, tools: inProcessTools(ports) });
    const mounted = new Set(inspectRoutes(app).filter((r) => !r.isMiddleware).map((r) => `${r.method} ${r.path}`));
    const declared = apiContract.ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(declared.filter((d) => !mounted.has(d))).toEqual([]);
    expect([...mounted].filter((m) => m.split(' ')[1]?.startsWith('/api') === true && !declared.includes(m))).toEqual([]);
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm vitest run --project integration -- routes`
Expected: if WP8 mounted every route, this passes at once. Prove it bites by temporarily adding `'GET /api/nope'` to a local copy of `declared`. Expected: FAIL `["GET /api/nope"]`. Then revert.

- [ ] **Step 3: Run the integration review**

Work through each line and record its result (command output or file path) in the PR body under "WP13 integration review". A failing line is a finding to fix on this branch before the tag.

1. **Every spec §9 item maps to a passing test file.** List the files for each item with `rg -l` over `packages/*/test apps/*/test integration/test`, then run `pnpm test`. Expected: every item has at least one file and the run is green.
   1. `core`: `rg -l "syntheticAllowed|toGbp|itineraryHash|evaluateConstraints|rollUp|selectCandidates|evaluateAlertRules|formatAgeFull" packages/core/test`
   2. `providers`: `rg -l "partition|has_no_flights|Retry-After|redirect|recordedBy|params-" packages/providers/test`
   3. `db`: `rg -l "3200|claimResume|bootSweep|AppLock|fx_converted" packages/db/test`
   4. `engine`: layer A `rg -l "createHarness" packages/engine/test --glob '!layerB/**'`; layer B `ls packages/engine/test/layerB`
   5. `api`: `rg -l "fixture|/tools/|Content-Type|X-Requested-With|frame-ancestors" apps/api/test`
   6. `web`: `rg -l "provenance|375|banned|noopener" apps/web/test`, plus `apps/web/e2e/smoke.spec.ts`
   7. Live scripts: `apps/api/test/tools/smoke*.test.ts`, plus WP4b's record tests
   8. Build: CI's Dockerfile assertion step
2. **Every spec §10 route is exercised.**
   - `integration/test/routes.test.ts` passes.
   - The sentinel test called every GET route.
   - Each mutating route is hit by at least one `api` test: `rg -n "method: '(POST|PUT|DELETE)'" apps/api/test`.
3. **Coverage.** `pnpm test:coverage` exits 0, with:
   - `core` at 100/100/100/100;
   - `db`, `providers`, `engine` and `api` at ≥ 85% lines and ≥ 70% branches;
   - `web` at ≥ 70% lines and ≥ 60% branches.
4. **Stryker.** `pnpm mutate` exits 0 with a score of at least 80%, run through the command runner (reconciliation decision 8). The report lists every file in `packages/core/stryker.config.json`, `src/coverage/*` included.
5. **Boundaries.** `node scripts/check-boundaries.mjs` exits 0. This covers no production import of `@gmt/providers/testing`.
6. **Secret scan.** `pnpm secret-scan` prints "secret scan: clean", and `git ls-files | rg '\.env$|\.db$|backups/'` prints nothing.
7. **No airport literal in application code.** `rg -n "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/*/src apps/*/src --glob '!apps/web/src/example.ts'` prints nothing.
8. **Docker build.**
   - `docker build -t get-me-there:v0.1.0-rc .` succeeds.
   - `docker run --rm get-me-there:v0.1.0-rc node -e "process.exit(process.env.NODE_ENV==='production'&&process.env.IN_CONTAINER==='1'?0:1)"` exits 0.
   - `docker run --rm get-me-there:v0.1.0-rc sh -c 'command -v curl'` exits non-zero, which confirms there is no curl in the image (spec §13 rev 10).
9. **Manual walkthrough in fixture mode.**
   1. Start the app with `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake NODE_ENV=development DATABASE_PATH=./data/walkthrough.fixture.db pnpm dev`.
   2. Create the worked-example definition with "import example" and run it.
   3. Screenshot View A Results, View B Calendar, View C Duration and View D Coverage, each at 1280 px and at 375 px (8 images).
   4. Save them to `~/Documents/get-me-there/v0.1.0-walkthrough/`, outside the repository and never committed.
   5. Check each against spec §11:
      - the red synthetic banner is present;
      - every price shows its provenance without hover;
      - the six coverage buckets sum to the cell count;
      - the class badge, price and provenance stay visible at 375 px.
10. **Reviewer pass.** Run `/review-spec docs/briefs/wp13-smoke-and-final-pass.md --roster full` against the branch diff, and fix every Critical and High finding before the tag.

- [ ] **Step 4: Commit**

```bash
git add integration && git commit -m "wp13: route-mount test; integration review recorded in the PR"
```

### Task 13.9: Release v0.1.0

**Files:**
- Modify: `docs/setup.md`, only where the fresh-clone run below finds a step that fails

- [ ] **Step 1: Fresh clone in Docker, following `docs/setup.md` literally**

```bash
rm -rf /tmp/gmt-fresh && git clone "$(git remote get-url origin)" /tmp/gmt-fresh && cd /tmp/gmt-fresh
cp .env.example .env    # then set APP_BASIC_AUTH_USER, APP_BASIC_AUTH_PASS (≥ 12 chars) and TRAVELPAYOUTS_TOKEN, as docs/setup.md step 1 says
docker compose up -d --build
docker compose ps       # expected: app "healthy" once the HEALTHCHECK start_period has passed
curl -fsS http://127.0.0.1:3000/api/health
# expected: {"ok":true,"degraded":false}
set -a; . ./.env; set +a
curl -fsS -u "$APP_BASIC_AUTH_USER:$APP_BASIC_AUTH_PASS" -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -X POST http://127.0.0.1:3000/api/tools/smoke -d '{"origin":"LHR","destination":"JFK"}'
# expected: exitCode 0 (or 3 when the Aviasales cache is empty that month), a summary "cheapest found £… · LHR→JFK … · fetched …",
#           lines ending "fixtures not written (app process)", fixturesWritten []
docker compose down
```

Every command must work exactly as `docs/setup.md` gives it. Where the doc differs, fix it in this repository's working copy (not the clone) and re-run from the top.

- [ ] **Step 2: The CLI smoke on the host with real keys**

Run: `pnpm smoke:live -- --origin LHR --destination JFK`
Expected: exit 0 (or 3, which means route coverage, not a defect), with each provider line reading `ledger 1 call(s), 1 first-attempt ok`. Do not commit the fixtures this run writes:

```bash
git clean -n packages/providers/fixtures/recorded   # review the list
git clean -f packages/providers/fixtures/recorded
```

The smoke recordings committed in Task 13.1 stay.

- [ ] **Step 3: Tag**

```bash
git switch main && git merge --no-ff wp/13-smoke-and-final-pass -m "wp13: live smoke, layer B, lock test, integration review"
pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint && pnpm -r typecheck
git tag -a v0.1.0 -m "get-me-there v0.1.0: Phases 1–3 per spec revision 10"
git push origin main v0.1.0
```

Expected: every command exits 0, and `git tag -l v0.1.0` prints `v0.1.0`.

## 9. Pinned review-focus tests

The plan's five Review Focus lines belong to WP0–WP10. WP13 re-runs them in Task 13.8, Step 3, item 1. WP13 also pins its own cross-cutting tests:

- Smoke exit 0 with provenance and ledger proof: Task 13.1.
- The per-run cap of one call, which turns a retry into BudgetExceeded: Task 13.2.
- A spawned tool bootstrap starts no execution: Task 13.5.
- One banned-word test over three surfaces with core's allowlist: Task 13.6.
- Sentinels absent from every sink, with proof they were sent in headers and in SMTP auth: Task 13.7.
- Every ROUTES entry mounted under `/api`: Task 13.8.

## 10. Definition of done

- `pnpm install --frozen-lockfile && pnpm build` exits 0.
- `pnpm lint` and `pnpm -r typecheck` are clean, the `integration` package included.
- `pnpm test:coverage` exits 0 with the package thresholds: `core` 100/100/100/100; `db`, `providers`, `engine` and `api` 85/70; `web` 70/60. The `integration` project runs with no threshold.
- `pnpm --filter @gmt/api exec vitest run test/tools test/routes/toolsSmoke.test.ts` passes 6 smoke tests, 3 argument tests (6 with the `it.each` rows), 1 route test and 2 spawn tests.
- `pnpm --filter @gmt/engine exec vitest run test/layerB` passes 4 tests.
- `pnpm vitest run --project integration` passes the banned-word (3), sentinel (2) and routes (1) tests.
- `pnpm mutate` exits 0 with a score ≥ 80%.
- `node scripts/check-boundaries.mjs` exits 0, and `pnpm secret-scan` prints "secret scan: clean".
- `docker build .` succeeds, and the fresh-clone run in Task 13.9 passes as written.
- The integration review table in the PR has every line filled, and `v0.1.0` is tagged on `main`.

## 11. Open questions

None that need the operator's judgement. The inconsistencies in §3 items 1–8 and the additions in §5 are contract matters for Fable to settle in the plan before dispatch. Item 1, the exit-code collision, is the one that changes observable behaviour.
