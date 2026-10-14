---
wp: 13
title: live smoke, layer-B engine tests, app_lock tool test, integration review, final pass
owner: fable
depends_on: [all]
spec_sections: ["§9 item 7", "§9 item 4 layer B", "§7 app_lock", "§10 /tools/smoke", "§13", "§16 WP13", "§9 and §11 cross-cutting: banned words, sentinel keys, Stryker, coverage"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, security-reviewer, cost-and-budget-reviewer, devops-reviewer, product-owner, persona-flexible-traveller]
status: draft
---

# WP13: live smoke, layer-B engine tests, app_lock tool test, integration review, final pass

## 1. Goal

Prove the assembled system against recorded vendor behaviour and the operator's real keys: `pnpm smoke:live` issues exactly one ledgered tile per configured provider and prints the cheapest price with its provenance, the real adapters pass the engine's layer-B tests on recorded fixtures, the tool bootstrap is shown to start no execution, the cross-cutting banned-word and sentinel-key tests run once over the whole process, and v0.1.0 is tagged after the integration review.

## 2. Scope

**In**

- `apps/api/src/tools/smoke.ts`: `runSmoke(ports, opts)`, `smokeQuery`, `parseSmokeArgs`, and the exit-code contract (§9 item 7).
- `apps/api/src/tools/perRunCap.ts`: the per-run cap of exactly one call per provider, wrapping the real `SqliteBudgetGuard`.
- The `smoke` branch of the tool bootstrap (`apps/api/src/bootstrap/tool.ts`) and the body of `POST /tools/smoke` (WP8 mounted the route; this WP supplies `runSmoke`, which the route awaits).
- `toolSmokeRequestSchema`, plus the field list of `toolRunResponseSchema`, in `packages/core/src/api-contract/system.ts`.
- `packages/providers/src/testing/replay.ts`: `replayHandlers`, `listRecordings`, `latestRecordedAt` (a contract addition; see §5).
- Layer-B engine tests in `packages/engine/test/layerB/*.test.ts`: the real `searchApiProvider` and `travelpayoutsProvider` replaying `fixtures/recorded` through WP7's harness.
- The `app_lock` tool test: the real tool bootstrap is spawned as a child process.
- A root `integration` Vitest project holding the cross-cutting banned-word test, the whole-process sentinel-key test and the route-mount test.
- `BANNED_WORD_ALLOWLIST` moves into `@gmt/core` so the whole repository has one allowlist.
- The final integration review checklist and the release steps (tag `v0.1.0`, `docs/setup.md` checked against a fresh clone in Docker).

**Out**

- `pnpm record:fixtures --budget N` and the chain/429 recordings: WP4b.
- The wiring helper `buildPorts`, `loadConfigFromEnv` and the tool bootstrap's lock handling: WP4b. WP13 adds only the `smoke` dispatch.
- Adapter tiling, parsing and error mapping: WP5 (SearchApi), WP6 (Travelpayouts). Layer B tests them through the engine and leaves their unit tests alone.
- Layer-A engine tests and `test/harness.ts`: WP7.
- Route mounting, auth, hardening and pino configuration: WP8.
- Per-package banned-word tests in web: WP9. WP13 adds the cross-package test and does not remove WP9's.
- Dockerfile, compose and `docs/setup.md` content: WP12. WP13 checks them and records defects as findings against WP12.
- The Playwright fixture-mode smoke: WP10.

## 3. Spec sections

- **§9 item 7.** `pnpm smoke:live` issues exactly one tile per configured provider (the query is sized so `plan` yields one tile), asserts through the ledger, prints the cheapest price with provenance and writes dated fixtures. It exits non-zero when zero providers are configured or any configured provider errors, and has a distinct exit code for empty. It is excluded from `pnpm test` and runs through the tool bootstrap.
- **§9 item 4, layer B.** The real adapters replay recorded fixtures through the same path as layer A: real http-kit, the real `db` `BudgetGuard`, an in-memory DB and `msw` on global fetch.
- **§7 `app_lock` and SQLite settings.** The tool bootstrap skips the boot sweep, auto-resume and cron, uses the production ledger, honours `app_lock`, and "a test proves it starts no execution". It refuses while a fresh app lock exists.
- **§10 `POST /tools/smoke`.** The live smoke runs inside the app process for use while the app holds `app_lock`. The route is authenticated.
- **§13.** The live smoke runs inside the container through `docker compose exec` against `POST /tools/smoke`.
- **§16 WP13.** The first failing test is "live smoke exits 0 with provenance".
- **§5.3 sentinel-key test.** Every secret (both provider keys, the SMTP password, the basic-auth password) is set to a sentinel. Every path is exercised, including error paths. No sentinel may appear in any log line, DB column, error message, API body, email or fixture file.
- **§11 and §8.3 banned words.** One canonical list, matched on word boundaries with a small allowlist, over web, engine templates and API reason strings.
- **§9 thresholds.** Package coverage thresholds hold, and Stryker breaks below 80% on the eight `core` modules.

**Where spec, plan and these instructions disagree (the spec wins; each item is recorded for Fable to fold into the plan):**

1. **Airport literals.** The plan's WP13 instructions say the smoke "builds a DiscoveryQuery for the worked example". Spec §1 and §7 ("No specific airport is named in code") and the plan's done rule ("no airport … literal outside tests and docs") forbid `LHR`/`JFK` in `apps/api/src`. The smoke therefore takes `--origin` and `--destination` as required arguments, and `POST /tools/smoke` takes them as body fields. The worked example appears only in tests and in `docs/setup.md` (`pnpm smoke:live -- --origin LHR --destination JFK`).
2. **`curl` in the container.** §13 says the smoke runs through `docker compose exec … curl -u … -X POST /tools/smoke`. `node:22-slim` ships without `curl`. The release task uses a `node -e` fetch, the form the `HEALTHCHECK` already uses. Either WP12 installs `curl` or §13's wording changes.
3. **Fixtures written from the app process.** §9 item 7 says the smoke writes dated fixtures, and §5.5 lets the recorder write only under `fixtures/recorded/`. `.dockerignore` excludes that directory and the image runs as `USER node`, so a route-run smoke has nowhere legitimate to write. The route passes `recorderRoot: null`, and the result says "fixtures not written (app process)". The CLI run writes them.
4. **The route depends on a later package.** The plan's file map gives `tools/smoke.ts` to WP13, but WP8 mounts `POST /tools/smoke` in an earlier wave. WP8 must import `runSmoke` from `../tools/smoke.js` and ship a stub that returns exit code 2 with the line "smoke not built yet". WP13 replaces that stub's body. That stub is a placeholder inside WP8, which the brief rules forbid, so Fable has to choose between the stub and moving the route mount into WP13.
5. **`runTool` return value.** The plan gives `runTool(name, args)` without a return type. This brief assumes `Promise<number>` (the exit code), with the bootstrap setting `process.exitCode`.

## 4. Interfaces consumed

Copied from the plan's "Cross-package contracts" and spec §5.1:

```ts
// spec §5.1 (core/ports/provider.ts)
export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];
}
export interface RawCalendarPrice extends CellKey {
  amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string;
}
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };
export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> }
export interface FlightProvider {
  readonly id: ProviderId; readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void }
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
export interface Notifier { id: string; send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> }
export class BudgetExceeded extends Error { scope: 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-month' | 'provider-lifetime' | 'global-month' }

// core types/provenance.ts
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}

// core labels/age.ts
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;

// core text/bannedWords.ts
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// core config
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };
export const systemClock: Clock;

// core (WP1)
addDays(IsoDate, n): IsoDate; daysBetween(a, b): number; monthsSpanned(from, to): IsoMonth[]
// core (WP2)
toGbp(amountMinor, currency, rateNano): number

// core api-contract
export interface RouteDef { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; request?: z.ZodTypeAny; query?: z.ZodTypeAny; response: z.ZodTypeAny; auth: 'public' | 'required' }
export const ROUTES: readonly RouteDef[];

// db
export class AirportsRepo { exists(iata): boolean; /* … */ }
export class FxRepo { latest(currency, maxAgeDays, today): { rateNano; date } | null; /* … */ }
export class ExecutionsRepo { create(input): Execution; get(id): Execution | null; setStatus(id, status, patch?): void; /* … */ }
export class CellsRepo { buckets(executionId, stage, providerId): Buckets; outcomes(executionId, filter?): CellOutcome[]; /* … */ }
export class LedgerRepo { countsFor(executionId): { calls: number; costMicroGbp: number; tiles: number; cacheHits: number }; /* … */ }
export class NotificationsRepo { wasSent(kind, executionId): boolean; record(kind, executionId, status): void }
export class AppLock { constructor(db, holder: 'app' | 'tool', clock, log); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void; static inspect(db): { holder; heartbeatAt; acquiredAt } | null }
export function seedAirports(db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };

// providers http-kit
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; classifyError?: (status: number, body: unknown, ledgerAtCap: boolean) => ProviderError }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Record<ProviderId | 'fx', ProviderHttpLimits>; clock: Clock; log: Logger; secrets: Secret[] /* for scrubbing */; recorder?: FixtureRecorder }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;
export function stripUrl(url: string): string;
export function fixtureHandlers(root: string): RequestHandler[];
// adapters
searchApiProvider({ http, log, clock, key: Secret, plan: PlanId, pointOfSale: string, paramsAllowlist })
travelpayoutsProvider({ http, log, clock, token: Secret, paramsAllowlist, airports: { sharedMetro(iatas): string | null } })

// engine
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export function createEngine(deps: EngineDeps): Engine;   // start, verifyCell, … as in the contract

// apps/api wiring.ts (WP4b)
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[] }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string }): Ports;
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
// bootstrap/tool.ts (WP4b): runTool(name: 'record' | 'smoke', args) — refuses NODE_ENV=test; buildPorts; AppLock('tool'); no engine.boot()
```

**Names this brief assumes from merged packages that the plan's contracts do not pin.** Each must be confirmed against `main` when wave 8 opens (the plan re-reviews late-wave briefs against existing code). A different name or shape is a finding against this brief, never a reason to invent a substitute.

| Name | Package / file | Assumed shape | Used by |
|---|---|---|---|
| `httpLimitsFor(config)` | api `wiring.ts` (WP4b) | `(c: Config) => Record<ProviderId \| 'fx', ProviderHttpLimits>`, the same limits `buildPorts` uses | smoke |
| `providersFor(config, deps)` | api `wiring.ts` (WP4b) | `(c: Config, d: { http: HttpKit; log: Logger; clock: Clock; repos: Repos }) => FlightProvider[]`, the same construction `buildPorts` uses | smoke |
| `createLogger(config, destination?)` | api `logger.ts` (WP8) | the bootstrap's pino logger with the §14 redact paths, writing to `destination` (default stdout) | sentinel test |
| `createApp(deps)` | api `app.ts` (WP8) | `(d: Ports & { engine: Engine }) => Hono` | sentinel and route tests |
| `toolsRoute` body | api `routes/tools.ts` (WP8) | mounts `POST /tools/smoke` with `zValidator('json', toolSmokeRequestSchema)` and awaits `runSmoke` | Task 13.3 |
| `EmailNotifier` | engine `notifiers/email.ts` (WP11) | `new EmailNotifier({ smtp: NonNullable<Config['smtp']>; log: Logger; transport?: nodemailer transport object })` | sentinel test |
| `TEMPLATE_STRINGS`, `renderDigestEmail(d)`, `renderOperatorEmail(m)` | engine `alerts/templates.ts` (WP11), exported from `@gmt/engine` | `readonly string[]`; `(d: AlertDigest) => { subject: string; body: string }`; `(m: OperatorMessage) => { subject: string; body: string }` | banned-word test |
| `API_REASON_STRINGS` | api `reasons.ts` (WP8), exported from `@gmt/api` | `Readonly<Record<string, string>>` of every reason or error message the API returns | banned-word test |
| `UI_STRINGS` | web `src/text/strings.ts` (WP9, extended by WP10/11) | `Readonly<Record<string, string>>`, pure TS with no React import | banned-word test |
| `createHarness(opts)` | engine `test/harness.ts` (WP7) | see the block below | layer B |
| `loadSearchApiParams(root)`, `loadTravelpayoutsParams(root)` | providers `searchapi/params.ts` (WP5), `travelpayouts/params.ts` (WP6) | the dated allowlist loaders the adapter constructors take as `paramsAllowlist` | layer B |
| `AirportsDataset` | db `seed/airports.ts` (WP3) | the parsed shape of `packages/db/data/airports.<version>.json` | test support |
| `ExecutionsRepo.create` input | db (WP3) | `{ definitionId: string; isChild: false; cell: null; snapshot: DefinitionSnapshot; estimate: null }` | lock test |
| Tool lock log lines | api `bootstrap/tool.ts` (WP4b) | pino lines `{ holder: 'tool', msg: 'app_lock acquired' }` and `{ holder: 'tool', msg: 'app_lock released' }` | lock test |
| `record --budget 0` | api `tools/record.ts` (WP4b) | makes no call and exits 0 | lock test |
| Recorded file shape | providers recorder (WP4) | `{ recordedAt, recordedBy, providerId, endpointPath, request: { method, url, body? }, status, body, contentHash }`, with `request.url` keeping its credential-free query | replay |

WP7 harness shape that layer B needs:

```ts
export interface HarnessOptions {
  now: IsoDateTime;
  providers?: (deps: { http: HttpKit; log: Logger; clock: Clock; repos: Repos }) => FlightProvider[];   // default: the fixture provider
  handlers?: RequestHandler[];                                                                          // added to the harness msw server
  limits?: Partial<Record<ProviderId, ProviderHttpLimits>>;                                             // merged over the fixture limits
}
export interface Harness { engine: Engine; db: Db; repos: Repos; clock: Clock & { advance(ms: number): void }; server: SetupServerApi; log: Logger; close(): void }
export function createHarness(opts: HarnessOptions): Harness;   // in-memory DB, airports seeded, real http-kit, real SqliteBudgetGuard
```

## 5. Interfaces produced

```ts
// apps/api/src/tools/smoke.ts — spec §9 item 7
export type SmokeExitCode = 0 | 1 | 2 | 3 | 64;
export interface SmokeOptions { origin: string; destination: string; recorderRoot: string | null }
export interface SmokeProviderReport {
  providerId: ProviderId; status: 'priced' | 'empty' | 'error'; tiles: number; prices: number;
  ledger: { rows: number; firstAttemptOk: number }; detail: string;
}
export interface SmokePrice { pricePence: number; cell: CellKey; nights: number; displayName: string; provenance: Provenance }
export interface SmokeResult { exitCode: SmokeExitCode; lines: string[]; providers: SmokeProviderReport[]; cheapest: SmokePrice | null; fixturesWritten: string[] }
export function runSmoke(ports: Ports, opts: SmokeOptions): Promise<SmokeResult>;
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery;
export function parseSmokeArgs(argv: readonly string[]): { origin: string; destination: string };
export function toToolRunResponse(r: SmokeResult): { tool: 'smoke'; exitCode: number; lines: string[] };

// apps/api/src/tools/perRunCap.ts
export interface CappedGuard extends BudgetGuard { reservationIds(providerId: ProviderId): readonly string[] }
export function perRunCallCap(inner: BudgetGuard, perProvider: number, freeProviders: ReadonlySet<ProviderId>): CappedGuard;

// packages/providers/src/testing/replay.ts — exported as the subpath `@gmt/providers/testing`, not from the main barrel
export interface Recording { file: string; providerId: string; endpointPath: string; recordedAt: string; recordedBy: string; request: { method: string; url: string; body?: string }; status: number; body: unknown }
export interface ReplayLog { handlers: RequestHandler[]; misses: string[]; served: string[] }
export function listRecordings(root: string): Recording[];
export function latestRecordedAt(root: string, recordedBy: string): IsoDateTime;
export function requestKey(method: string, url: string, body: string | undefined): string;
export function replayHandlers(root: string, opts?: { recordedBy?: string; filter?: (r: Recording) => boolean }): ReplayLog;

// packages/core/src/api-contract/system.ts
export const toolSmokeRequestSchema: z.ZodType<{ origin: Iata; destination: Iata }>;
export const toolRunResponseSchema: z.ZodType<{ tool: 'smoke' | 'record'; exitCode: number; lines: string[] }>;

// packages/core/src/text/bannedWords.ts
export const BANNED_WORD_ALLOWLIST: readonly string[];

// root integration project
integration/package.json  (@gmt/integration, private), integration/vitest.config.ts (project name 'integration', no thresholds)
```

**Smoke exit codes (spec §9 item 7).** If several conditions hold at once, the highest row in the table decides: 64, then 2, then 1, then 3, then 0.

| Code | Meaning | Calls made |
|---|---|---|
| 64 | Invalid arguments: origin or destination missing, not `^[A-Z]{3}$` after upper-casing, equal to each other, or absent from the airports table | none |
| 2 | Zero providers configured (neither `TRAVELPAYOUTS_TOKEN` nor `SEARCHAPI_KEY`) | none |
| 1 | Any configured provider errored. This covers a `tile-error`, a thrown `ProviderError` or `BudgetExceeded` (the per-run cap included), `plan()` yielding anything other than one tile, a ledger assertion failing (not exactly one row, first attempt, `ok`), and a non-GBP price with no FX rate | at most one per provider |
| 3 | No error, but at least one configured provider's tile held no price (`no_data` or `noFares` only) | one per provider |
| 0 | Every configured provider priced its one tile, and the ledger shows exactly one first-attempt `ok` row per provider | one per provider |

When `runTool` refuses because of `app_lock`, it uses WP4b's own exit code. That code is not part of this table.

**Contract additions this brief proposes.** Fable folds them into the plan's contracts in one commit before dispatch, as the plan's process step 5 requires.

1. `@gmt/providers/testing`, a subpath export with `replayHandlers`, `listRecordings`, `latestRecordedAt` and `requestKey`. It stays out of the main barrel so production code never loads it. `msw` is already imported from `providers/src` by WP4's `fixtureHandlers`, so this adds no new runtime edge.
2. `httpLimitsFor` and `providersFor` exported from `apps/api/src/wiring.ts` (WP4b). The smoke needs its own http-kit, with the capped guard, no cache and the recorder, over the same limits and adapters as `buildPorts`.
3. `createLogger(config, destination?)` exported from `@gmt/api` (WP8). The sentinel test must scan the real redact configuration, not a copy.
4. `EmailNotifier` accepting a `transport` override (WP11). The sentinel test captures the real MIME output.
5. `UI_STRINGS` (WP9), `TEMPLATE_STRINGS`, `renderDigestEmail` and `renderOperatorEmail` (WP11), and `API_REASON_STRINGS` (WP8) as exports. The banned-word test needs one catalogue per surface.
6. `BANNED_WORD_ALLOWLIST` in `@gmt/core`. WP9's test then imports it instead of keeping a local list.
7. `toolSmokeRequestSchema`, and the three fields of `toolRunResponseSchema`, which WP0 left unspecified.
8. WP7's `createHarness` taking `providers`, `handlers` and `limits` as above.
9. The recorder keeping the credential-free query in `request.url`. Spec §5.3 strips `search_metadata` URLs in bodies, not the request line, and replay needs the query to tell tiles apart.
10. `pnpm-workspace.yaml` gains `integration`, and the root `vitest.config.ts` gains the `integration` project.
11. `apps/api/src/index.ts` exports `buildPorts`, `loadConfigFromEnv`, `createApp`, `createLogger`, `runSmoke` and `API_REASON_STRINGS` for the integration project.

## 6. Library notes

Verified on 2026-10-14.

- **vitest 5.0.4.** Docs checked: `docs/guide/projects.md` at v5.0.3 via context7 `/vitest-dev/vitest/v5.0.3`. `test.projects` in the root `vitest.config.ts` accepts config-file paths. A file entry must be named `vitest.config.*` or `vitest.<name>.config.*`. `test.name` sets the project name, and `vitest run --project integration` filters to one project. `vi.waitFor(fn, { timeout })` retries an assertion until it passes; layer B uses it to wait for execution status. The integration package's `test` script runs `vitest run` without `--coverage`, so no threshold applies there, while each package keeps the thresholds in its own config.
- **msw 3.0.3.** Docs checked: mswjs.io quick start, "Intercepting requests" and "Response timing" via context7 `/websites/mswjs_io`. `setupServer` comes from `msw/node`. `http` and `HttpResponse` come from `msw/http`, as the current quick start shows. The types `RequestHandler` and `JsonBodyType` come from `msw`; `pnpm -r typecheck` confirms them on install. Calls used:
  - `http.all('*', resolver)`; a resolver that returns `undefined` falls through.
  - Resolver argument `{ request }`, where `request` is a Fetch `Request`.
  - `HttpResponse.json(body, { status })`, `HttpResponse.text(body, { status })`, `HttpResponse.error()` (a network error), and `new HttpResponse(null, { status: 302, headers: { Location } })`.
  - The handler option `{ once: true }`.
  - `server.listen({ onUnhandledRequest: 'error' })`, `server.use`, `server.resetHandlers`, `server.close`.
  - `server.events.on('request:start', ({ request }) => …)`.
- **node:child_process (Node 22).** `spawn(process.execPath, ['--import', 'tsx', entry, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })`, then the `close` event `(code)` and `child.kill('SIGKILL')` on timeout. `--import tsx` resolves from `cwd`, so the spawn runs with `cwd: apps/api`, where WP0 installed `tsx@4.23.15` as a dev dependency.
- **nodemailer 10.1.1** (used through WP11's `EmailNotifier`). Docs checked: "Writing a custom transport" via context7 `/nodemailer/nodemailer-homepage`. A transport is `{ name, version, send(mail, done) }`, `mail.message.createReadStream()` yields the raw RFC 822 message, `mail.message.getEnvelope()` and `mail.message.messageId()` supply `info`, and `done(err)` aborts the send.
- **hono 4.13.13** (route-mount test). Docs checked: hono "Dev helper" via context7 `/honojs/website`. `inspectRoutes(app)` from `hono/dev` lists `{ method, path, isMiddleware }`, and `app.request(url, init)` dispatches a request in-process.

## 7. Files

**Create**

- `apps/api/src/tools/smoke.ts`
- `apps/api/src/tools/perRunCap.ts`
- `apps/api/test/support/env.ts`
- `apps/api/test/tools/smoke.test.ts`
- `apps/api/test/tools/smokeExitCodes.test.ts`
- `apps/api/test/tools/smokeArgs.test.ts`
- `apps/api/test/routes/toolsSmoke.test.ts`
- `apps/api/test/tools/appLock.tool.test.ts`
- `packages/providers/src/testing/replay.ts`
- `packages/providers/test/testing/replay.test.ts`
- `packages/engine/test/layerB/support.ts`
- `packages/engine/test/layerB/discovery.test.ts`
- `packages/engine/test/layerB/verification.test.ts`
- `packages/engine/test/layerB/errors.test.ts`
- `integration/package.json`, `integration/tsconfig.json`, `integration/vitest.config.ts`
- `integration/test/support.ts`
- `integration/test/bannedWords.test.ts`
- `integration/test/sentinel.test.ts`
- `integration/test/routes.test.ts`
- `packages/providers/fixtures/recorded/searchapi/**/<date>-<sha>.json` and `packages/providers/fixtures/recorded/travelpayouts/**/<date>-<sha>.json`, written by the one recorded smoke run in Task 13.1

**Modify**

- `apps/api/src/bootstrap/tool.ts` (the `smoke` dispatch)
- `apps/api/src/routes/tools.ts` (the route body awaits `runSmoke`)
- `apps/api/src/index.ts` (exports)
- `packages/core/src/api-contract/system.ts` and `packages/core/test/api-contract/contract.test.ts`
- `packages/core/src/text/bannedWords.ts` and `packages/core/test/text/bannedWords.test.ts`
- `apps/web/test/**/bannedWords*.test.ts` (WP9's test imports the core allowlist)
- `packages/providers/package.json` (`exports["./testing"]`)
- `pnpm-workspace.yaml`
- `vitest.config.ts` (root)
- `.github/workflows/ci.yml` (adds `pnpm build` before tests so the integration project resolves `dist`)

## 8. Tasks

### Task 13.1: The smoke exits 0 with provenance (first failing test)

**Files:**
- Create: `packages/providers/src/testing/replay.ts`, `packages/providers/test/testing/replay.test.ts`, `apps/api/src/tools/perRunCap.ts`, `apps/api/src/tools/smoke.ts`, `apps/api/test/support/env.ts`, `apps/api/test/tools/smoke.test.ts`, and the smoke recordings
- Modify: `packages/providers/package.json`, `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `buildPorts`, `loadConfigFromEnv`, `httpLimitsFor`, `providersFor`, `createHttpKit`, `createRecorder`, `stripUrl`, `effectiveAge`, `formatAgeFull`, `toGbp`, `AirportsRepo.exists`, `FxRepo.latest`, `seedAirports`.
- Produces: `runSmoke`, `smokeQuery`, `SmokeResult`, `perRunCallCap`, `replayHandlers`, `listRecordings`, `latestRecordedAt`, `requestKey`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/support/env.ts`:

```ts
/**
 * Shared test support for apps/api: sentinel secrets, a capture logger, a ports builder on an
 * in-memory DB with the vendored airports seeded. Spec §5.3 (sentinels), §9 item 7 (smoke).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type IsoDateTime, type Logger, fixedClock } from '@gmt/core';
import { type AirportsDataset, seedAirports } from '@gmt/db';
import { type Ports, buildPorts, loadConfigFromEnv } from '../../src/wiring.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const RECORDED_ROOT = join(REPO_ROOT, 'packages/providers/fixtures/recorded');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'packages/db/drizzle');

/** Fake values for every secret; the sentinel assertions look for these exact strings. */
export const SENTINELS = {
  searchapi: 'test-searchapi-key-0123456789abcdef',
  travelpayouts: 'test-travelpayouts-token-0123456789abcdef',
  smtpPass: 'test-smtp-pass-0123456789abcdef',
  authPass: 'test-basic-auth-pass-0123456789abcdef',
} as const;

/** A test env: NODE_ENV=test is accepted by buildPorts (only the bootstraps refuse it). */
export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1', LOG_LEVEL: 'debug', ...overrides };
}

/** A Logger that keeps every line as JSON so tests can scan it. */
export function captureLogger(bindings: object = {}): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const make = (b: object): Logger => {
    const write = (level: string) => (o: object, msg?: string) => {
      lines.push(JSON.stringify({ level, ...b, ...o, msg }));
    };
    return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error'), child: (more) => make({ ...b, ...more }) };
  };
  return { log: make(bindings), lines };
}

/** Seeds the vendored mwgg/Airports subset so `airports.exists` and tz lookups work. */
export function seedVendoredAirports(ports: Ports): void {
  const dir = join(REPO_ROOT, 'packages/db/data');
  const file = readdirSync(dir).find((f) => /^airports\..+\.json$/.test(f));
  if (file === undefined) throw new Error(`no vendored airports dataset under ${dir}`);
  seedAirports(ports.db, JSON.parse(readFileSync(join(dir, file), 'utf8')) as AirportsDataset);
}

export function testPorts(env: Record<string, string | undefined>, opts: { now: IsoDateTime }): { ports: Ports; logs: string[] } {
  const { log, lines } = captureLogger();
  const ports = buildPorts(loadConfigFromEnv(env), { log, clock: fixedClock(opts.now), migrationsDir: MIGRATIONS_DIR });
  seedVendoredAirports(ports);
  return { ports, logs: lines };
}
```

`apps/api/test/tools/smoke.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBannedWords } from '@gmt/core';
import { latestRecordedAt, replayHandlers } from '@gmt/providers/testing';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runSmoke } from '../../src/tools/smoke.js';
import { RECORDED_ROOT, SENTINELS, testEnv, testPorts } from '../support/env.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('runSmoke (spec §9 item 7)', () => {
  it('exits 0 with provenance when both providers price their one tile', async () => {
    // why: the clock is fixed at the smoke recording's instant, so smokeQuery(today) rebuilds the
    // exact requests that were recorded and the strict replay matches them.
    const recordedAt = latestRecordedAt(RECORDED_ROOT, 'smoke');
    const replay = replayHandlers(RECORDED_ROOT, { recordedBy: 'smoke' });
    server.use(...replay.handlers);
    const { ports, logs } = testPorts(
      testEnv({ TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts, SEARCHAPI_KEY: SENTINELS.searchapi, SEARCHAPI_PLAN: 'trial' }),
      { now: recordedAt },
    );
    const out = mkdtempSync(join(tmpdir(), 'gmt-smoke-'));

    const r = await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: out });

    expect(replay.misses).toEqual([]);
    expect(r.exitCode).toBe(0);
    expect(r.providers.map((p) => [p.providerId, p.status, p.tiles, p.ledger.rows, p.ledger.firstAttemptOk])).toEqual([
      ['searchapi', 'priced', 1, 1, 1],
      ['travelpayouts', 'priced', 1, 1, 1],
    ]);
    const headline = r.lines.find((l) => l.startsWith('cheapest found '));
    expect(headline).toMatch(/^cheapest found £\d+\.\d{2} · LHR→JFK \d{4}-\d{2}-\d{2}–\d{4}-\d{2}-\d{2} \(\d+n\) · .+ · fetched /);
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

`packages/providers/test/testing/replay.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listRecordings, replayHandlers, requestKey } from '../../src/testing/replay.js';

const ROOT = fileURLToPath(new URL('../../fixtures/recorded', import.meta.url));
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('replay of recorded fixtures (spec §9 item 4 layer B)', () => {
  it('lists recordings for both vendors, none carrying a credential in its URL', () => {
    const recs = listRecordings(ROOT);
    expect(new Set(recs.map((r) => r.providerId))).toEqual(new Set(['searchapi', 'travelpayouts']));
    for (const r of recs) expect(r.request.url).not.toMatch(/api_key=|token=|access_token=/i);
  });
  it('keys requests independent of query order', () => {
    expect(requestKey('get', 'https://h.example/p?b=2&a=1', undefined)).toBe(requestKey('GET', 'https://h.example/p?a=1&b=2', undefined));
  });
  it('serves the recorded response for the identical request and logs a miss otherwise', async () => {
    const rec = listRecordings(ROOT).find((r) => r.request.method === 'GET');
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    const replay = replayHandlers(ROOT, { filter: (r) => r.file === rec.file });
    server.use(...replay.handlers);
    expect((await fetch(rec.request.url)).status).toBe(rec.status);
    const other = new URL(rec.request.url);
    other.searchParams.set('zz_not_recorded', '1');
    expect((await fetch(other)).status).toBe(404);
    expect(replay.misses).toHaveLength(1);
    expect(replay.served).toEqual([rec.file]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- tools/smoke && pnpm --filter @gmt/providers test -- testing/replay`
Expected: FAIL, "Cannot find module '../../src/tools/smoke.js'" and "Failed to resolve import '@gmt/providers/testing'".

- [ ] **Step 3: Implement the replay module**

`packages/providers/src/testing/replay.ts`:

```ts
/**
 * Replays recorded vendor fixtures over msw as if they were the vendor. Spec §9 item 4 layer B and
 * §9 item 7 (the smoke's test). Exported as `@gmt/providers/testing`, never from the main barrel.
 *
 * Matching is strict: method, host, path, the query sorted by name then value, and a body hash for
 * POST. Credentials travel in headers (spec §2 fact 8), so the key never contains one. A request on
 * a recorded host with no recording answers 404 and is appended to `misses`, which tests assert empty.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IsoDateTime } from '@gmt/core';
import type { JsonBodyType, RequestHandler } from 'msw';
import { HttpResponse, http } from 'msw/http';

export interface Recording {
  file: string; providerId: string; endpointPath: string; recordedAt: string; recordedBy: string;
  request: { method: string; url: string; body?: string }; status: number; body: unknown;
}
export interface ReplayLog { handlers: RequestHandler[]; misses: string[]; served: string[] }

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith('.json') && !name.startsWith('params-')) yield p;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Reads one recorded file; anything that is not a recording fails loudly with the file name. */
function parseRecording(file: string, json: unknown): Recording {
  const fail = (what: string): never => {
    throw new Error(`${file}: not a recorded fixture (${what})`);
  };
  if (!isRecord(json)) return fail('not an object');
  const req = json.request;
  if (!isRecord(req) || typeof req.method !== 'string' || typeof req.url !== 'string') return fail('request.method/url');
  for (const k of ['providerId', 'endpointPath', 'recordedAt', 'recordedBy'] as const) if (typeof json[k] !== 'string') fail(k);
  if (typeof json.status !== 'number') fail('status');
  return {
    file,
    providerId: String(json.providerId), endpointPath: String(json.endpointPath),
    recordedAt: String(json.recordedAt), recordedBy: String(json.recordedBy),
    request: { method: req.method, url: req.url, ...(typeof req.body === 'string' ? { body: req.body } : {}) },
    status: Number(json.status), body: json.body,
  };
}

/** Every recorded fixture under `root` (dated parameter allowlists excluded). */
export function listRecordings(root: string): Recording[] {
  return [...walk(root)].sort().map((f) => parseRecording(f, JSON.parse(readFileSync(f, 'utf8'))));
}

/** The newest `recordedAt` among recordings made by `recordedBy`; throws when there are none. */
export function latestRecordedAt(root: string, recordedBy: string): IsoDateTime {
  const times = listRecordings(root).filter((r) => r.recordedBy === recordedBy).map((r) => r.recordedAt).sort();
  const last = times.at(-1);
  if (last === undefined) throw new Error(`no recordings by '${recordedBy}' under ${root}; record them first (WP13 Task 13.1 step 5)`);
  return last as IsoDateTime;
}

/** Credential-free canonical key for a request. */
export function requestKey(method: string, url: string, body: string | undefined): string {
  const u = new URL(url);
  const query = [...u.searchParams]
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const bodyHash = body === undefined || body === '' ? '' : createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `${method.toUpperCase()} ${u.host}${u.pathname}?${query}#${bodyHash}`;
}

export function replayHandlers(root: string, opts: { recordedBy?: string; filter?: (r: Recording) => boolean } = {}): ReplayLog {
  const index = new Map<string, Recording>();
  for (const r of listRecordings(root)) {
    if (opts.recordedBy !== undefined && r.recordedBy !== opts.recordedBy) continue;
    if (opts.filter !== undefined && !opts.filter(r)) continue;
    const key = requestKey(r.request.method, r.request.url, r.request.body);
    const prev = index.get(key);
    // why: re-recordings are dated; the newest is the vendor's current behaviour.
    if (prev === undefined || prev.recordedAt < r.recordedAt) index.set(key, r);
  }
  const hosts = new Set([...index.values()].map((r) => new URL(r.request.url).host));
  const log: ReplayLog = { handlers: [], misses: [], served: [] };
  log.handlers.push(
    http.all('*', async ({ request }) => {
      if (!hosts.has(new URL(request.url).host)) return undefined;
      const body = request.method === 'GET' ? undefined : await request.text();
      const key = requestKey(request.method, request.url, body);
      const rec = index.get(key);
      if (rec === undefined) {
        log.misses.push(key);
        return HttpResponse.json({ replayMiss: key }, { status: 404 });
      }
      log.served.push(rec.file);
      return typeof rec.body === 'string'
        ? HttpResponse.text(rec.body, { status: rec.status })
        : HttpResponse.json(rec.body as JsonBodyType, { status: rec.status });
    }),
  );
  return log;
}
```

`packages/providers/package.json`: add `"./testing": { "types": "./dist/testing/replay.d.ts", "default": "./dist/testing/replay.js" }` to `exports`.

- [ ] **Step 4: Implement the per-run cap and the smoke**

`apps/api/src/tools/perRunCap.ts`:

```ts
import { BudgetExceeded, type BudgetGuard, type ProviderId } from '@gmt/core';

/** A BudgetGuard that also tells the smoke which ledger rows it created. */
export interface CappedGuard extends BudgetGuard {
  reservationIds(providerId: ProviderId): readonly string[];
}

/**
 * Wraps the real SqliteBudgetGuard with a per-run cap of `perProvider` reservations per provider.
 * Spec §9 item 7: the smoke issues exactly one call per provider. Every real cap still applies
 * because each permitted reserve goes through `inner`. A retry would be a second reserve, so the
 * cap turns it into BudgetExceeded instead of a second call.
 */
export function perRunCallCap(inner: BudgetGuard, perProvider: number, freeProviders: ReadonlySet<ProviderId>): CappedGuard {
  const ids = new Map<ProviderId, string[]>();
  return {
    reserve(p) {
      const taken = ids.get(p.providerId) ?? [];
      if (taken.length >= perProvider) {
        throw new BudgetExceeded({
          scope: freeProviders.has(p.providerId) ? 'execution-free-calls' : 'execution-calls',
          cap: perProvider,
          current: taken.length,
          requested: 1,
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

`apps/api/src/tools/smoke.ts`:

```ts
/**
 * `pnpm smoke:live` and `POST /tools/smoke`. Spec §9 item 7, §10, §13.
 *
 * One tile per configured provider, sized so `plan()` yields one tile, through a dedicated
 * http-kit: the real SqliteBudgetGuard wrapped by a per-run cap of one call per provider, no
 * response cache (the smoke must reach the vendor) and, from the CLI, the fixture recorder. The
 * ledger rows this run reserved are read back by id and must be exactly one first-attempt `ok`
 * row per provider. No execution row is created: ProviderContext.executionId is null.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BudgetExceeded, type CellKey, type DiscoveryQuery, type DiscoveryTileResult, type FlightProvider, type FxInfo, type Iata,
  type IsoDate, type Provenance, ProviderError, type ProviderId, type ResponseCache, addDays, asIata, asIsoDate, daysBetween,
  effectiveAge, formatAgeFull, monthsSpanned, toGbp,
} from '@gmt/core';
import { createHttpKit, createRecorder, stripUrl } from '@gmt/providers';
import { type Ports, httpLimitsFor, providersFor } from '../wiring.js';
import { type CappedGuard, perRunCallCap } from './perRunCap.js';

export type SmokeExitCode = 0 | 1 | 2 | 3 | 64;
export interface SmokeOptions { origin: string; destination: string; recorderRoot: string | null }
export interface SmokeProviderReport {
  providerId: ProviderId; status: 'priced' | 'empty' | 'error'; tiles: number; prices: number;
  ledger: { rows: number; firstAttemptOk: number }; detail: string;
}
export interface SmokePrice { pricePence: number; cell: CellKey; nights: number; displayName: string; provenance: Provenance }
export interface SmokeResult { exitCode: SmokeExitCode; lines: string[]; providers: SmokeProviderReport[]; cheapest: SmokePrice | null; fixturesWritten: string[] }

// why: the two vendors in configuration order; ids are provider identifiers, not airports.
const VENDORS = ['searchapi', 'travelpayouts'] as const;
const FREE: ReadonlySet<ProviderId> = new Set<ProviderId>(['travelpayouts']);
// why: a cache hit is not a call; the smoke must prove the vendor answers today.
const NO_CACHE: ResponseCache = { get: () => undefined, set: () => undefined };

/**
 * The one-tile query. The first day of next month is always after today. Eight departure days
 * starting on the 1st never cross a month end, so Travelpayouts plans one `month` tile. With
 * 10–21 nights the return span is 8 + 11 = 19 days, so SearchApi plans one 8 × 24 rectangle
 * (spec §5.2). Both are asserted with `plan().length === 1` before any call.
 */
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery {
  const next = monthsSpanned(today, addDays(today, 31))[1];
  if (next === undefined) throw new Error('monthsSpanned must return at least two months for a 31-day span');
  const departureFrom = asIsoDate(`${next}-01`);
  return { origin, destination, departureFrom, departureTo: addDays(departureFrom, 7), minNights: 10, maxNights: 21, cabin: 'economy', currency: 'GBP' };
}

/** `--origin X --destination Y` or `--origin=X`; missing values come back empty and the smoke exits 64. */
export function parseSmokeArgs(argv: readonly string[]): { origin: string; destination: string } {
  const get = (name: string): string => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq !== undefined) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? '') : '';
  };
  return { origin: get('origin'), destination: get('destination') };
}

/** Maps a result onto `toolRunResponseSchema` for `POST /tools/smoke`. */
export function toToolRunResponse(r: SmokeResult): { tool: 'smoke'; exitCode: number; lines: string[] } {
  return { tool: 'smoke', exitCode: r.exitCode, lines: r.lines };
}

function formatPence(p: number): string {
  return `£${Math.trunc(p / 100)}.${String(p % 100).padStart(2, '0')}`;
}

function listFiles(root: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // why: the recorder creates the root on first write
    }
    for (const n of names) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.add(p);
    }
  };
  walk(root);
  return out;
}

/** Ledger rows by the reservation ids this run created, so concurrent app traffic is never counted. */
function ledgerFor(ports: Ports, ids: readonly string[]): { rows: number; firstAttemptOk: number } {
  if (ids.length === 0) return { rows: 0, firstAttemptOk: 0 };
  const rows = ports.db.raw
    .prepare(`SELECT http_attempt AS attempt, outcome FROM provider_requests WHERE CAST(id AS TEXT) IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ attempt: number; outcome: string }>;
  return { rows: rows.length, firstAttemptOk: rows.filter((r) => r.attempt === 1 && r.outcome === 'ok').length };
}

function describeError(err: unknown): string {
  if (err instanceof BudgetExceeded) return `budget: ${err.scope} (per-run cap or a real cap refused the call)`;
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
    fx = { converted: true, rateNano: rate.rateNano, rateDate: rate.date, source: 'frankfurter' };
  }
  const info = discovery.info;
  const provenance: Provenance = {
    providerId: id, sourceKind: info.sourceKind, fetchedAt: result.fetchedAt,
    ...(cheapest.providerObservedAt === undefined ? {} : { providerObservedAt: cheapest.providerObservedAt }),
    maxAgeHours: info.maxAgeHours, fx,
    // why: spec §5.2 — Travelpayouts ignores `market` (unknown); SearchApi echoes gl from POINT_OF_SALE.
    pointOfSale: id === 'searchapi' && ports.config.pointOfSale === 'GB' ? 'GB' : 'unknown',
    cabin: q.cabin,
  };
  const cell: CellKey = { origin: cheapest.origin, destination: cheapest.destination, departureDate: cheapest.departureDate, returnDate: cheapest.returnDate };
  return {
    report: report('priced', 1, result.prices.length, ''),
    price: { pricePence, cell, nights: daysBetween(cell.departureDate, cell.returnDate), displayName: provider.displayName, provenance },
  };
}

/** Spec §9 item 7. Never throws for a vendor failure; the exit code carries it (see the brief's table). */
export async function runSmoke(ports: Ports, opts: SmokeOptions): Promise<SmokeResult> {
  const lines: string[] = [];
  const log = ports.log.child({ tool: 'smoke' });
  const say = (line: string): void => {
    lines.push(line);
    log.info({}, line);
  };
  const finish = (exitCode: SmokeExitCode, providers: SmokeProviderReport[], cheapest: SmokePrice | null, fixturesWritten: string[]): SmokeResult => ({
    exitCode, lines, providers, cheapest, fixturesWritten,
  });

  const origin = opts.origin.trim().toUpperCase();
  const destination = opts.destination.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) {
    say('usage: smoke --origin <IATA> --destination <IATA> (two different airport codes)');
    return finish(64, [], null, []);
  }
  for (const code of [origin, destination]) {
    if (!ports.repos.airports.exists(asIata(code))) {
      say(`unknown airport ${code}: not in the airports table`);
      return finish(64, [], null, []);
    }
  }
  const configured = VENDORS.filter((v) => ports.config.providers[v] !== null);
  if (configured.length === 0) {
    say('no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY');
    return finish(2, [], null, []);
  }

  const guard = perRunCallCap(ports.budget, 1, FREE);
  const before = opts.recorderRoot === null ? new Set<string>() : listFiles(opts.recorderRoot);
  const recorder = opts.recorderRoot === null
    ? undefined
    : createRecorder({ root: opts.recorderRoot, secrets: ports.secrets, clock: ports.clock, recordedBy: 'smoke' });
  const http = createHttpKit({
    budget: guard, cache: NO_CACHE, limits: httpLimitsFor(ports.config), clock: ports.clock, log, secrets: ports.secrets,
    ...(recorder === undefined ? {} : { recorder }),
  });
  const providers = providersFor(ports.config, { http, log, clock: ports.clock, repos: ports.repos });
  const q = smokeQuery(ports.clock.todayLondon(), asIata(origin), asIata(destination));
  say(`smoke: ${origin}→${destination} departures ${q.departureFrom}–${q.departureTo}, ${q.minNights}–${q.maxNights} nights, one tile per provider`);

  const reports: SmokeProviderReport[] = [];
  const prices: SmokePrice[] = [];
  // why: one provider at a time keeps the ledger readable and respects the trial's concurrency of 1.
  for (const id of configured) {
    const { report, price } = await smokeOne(ports, guard, id, providers.find((p) => p.id === id), q, recorder !== undefined);
    reports.push(report);
    if (price !== null) prices.push(price);
    say(`${id}: ${report.status} · ${report.prices} prices · ledger ${report.ledger.rows} call(s), ${report.ledger.firstAttemptOk} first-attempt ok${report.detail === '' ? '' : ` · ${report.detail}`}`);
  }

  const cheapest = [...prices].sort((a, b) => a.pricePence - b.pricePence)[0] ?? null;
  if (cheapest === null) say('no price found');
  else {
    const c = cheapest.cell;
    const age = formatAgeFull(effectiveAge(cheapest.provenance, ports.clock.now()));
    const fxNote = cheapest.provenance.fx.converted ? ' · ≈ converted to GBP' : '';
    say(`cheapest found ${formatPence(cheapest.pricePence)} · ${c.origin}→${c.destination} ${c.departureDate}–${c.returnDate} (${cheapest.nights}n) · ${cheapest.displayName} · ${age}${fxNote}`);
  }
  const fixturesWritten = opts.recorderRoot === null ? [] : [...listFiles(opts.recorderRoot)].filter((f) => !before.has(f)).sort();
  say(opts.recorderRoot === null ? 'fixtures not written (app process)' : `fixtures written: ${fixturesWritten.length} under ${opts.recorderRoot}`);

  const exitCode: SmokeExitCode = reports.some((r) => r.status === 'error') ? 1 : reports.some((r) => r.status === 'empty') ? 3 : 0;
  return finish(exitCode, reports, cheapest, fixturesWritten);
}
```

`apps/api/src/index.ts`: add `export { runSmoke, toToolRunResponse, type SmokeResult, type SmokeOptions } from './tools/smoke.js';` next to the existing exports listed in contract addition 11.

- [ ] **Step 5: Record the smoke fixtures once (operator, real keys)**

This step spends one SearchApi call (of the trial's remaining credits) and one free Travelpayouts call. Run it on the dev machine with the operator's `.env` loaded, `NODE_ENV=development`, and `DATABASE_PATH=./data/dev.db`:

Run: `pnpm smoke:live -- --origin LHR --destination JFK`
Expected: exit code 0. The output contains `searchapi: priced`, `travelpayouts: priced`, a `cheapest found £… · LHR→JFK … · fetched just now · …` line and `fixtures written: 2 under …/packages/providers/fixtures/recorded`. If it exits 3 because Travelpayouts has no cached rows for that month, run it again with `--destination EWR`, update both tests to use `EWR`, and note the substitution in the commit message. Then run `pnpm secret-scan`. Expected: "secret scan: clean".

This step needs Task 13.3's CLI dispatch. If that has not landed yet, do Task 13.3 Steps 1–4 first and come back.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @gmt/providers test -- testing/replay && pnpm --filter @gmt/api test -- tools/smoke`
Expected: PASS (3 + 1 tests). `replay.misses` is empty.

- [ ] **Step 7: Commit**

```bash
git add packages/providers apps/api && git commit -m "wp13: smoke prints cheapest price with provenance from one ledgered tile per provider (spec §9 item 7)"
```

### Task 13.2: Smoke exit codes 1, 2, 3, 64 and the per-run cap

**Files:**
- Create: `apps/api/test/tools/smokeExitCodes.test.ts`

**Interfaces:**
- Consumes: `runSmoke`, `listRecordings`, `replayHandlers`, `latestRecordedAt`.

- [ ] **Step 1: Write the failing test**

```ts
import { listRecordings, latestRecordedAt, replayHandlers } from '@gmt/providers/testing';
import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runSmoke } from '../../src/tools/smoke.js';
import { RECORDED_ROOT, SENTINELS, testEnv, testPorts } from '../support/env.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const both = testEnv({ TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts, SEARCHAPI_KEY: SENTINELS.searchapi, SEARCHAPI_PLAN: 'trial' });
const at = () => latestRecordedAt(RECORDED_ROOT, 'smoke');
function smokeRecording(providerId: string) {
  const r = listRecordings(RECORDED_ROOT).filter((x) => x.recordedBy === 'smoke' && x.providerId === providerId).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  if (r === undefined) throw new Error(`no smoke recording for ${providerId}`);
  return { rec: r, origin: new URL(r.request.url).origin, path: new URL(r.request.url).pathname };
}

describe('smoke exit codes (spec §9 item 7)', () => {
  it('2: zero providers configured, no call', async () => {
    const { ports } = testPorts(testEnv(), { now: at() });
    const r = await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: null });
    expect(r.exitCode).toBe(2);
    expect(r.lines).toEqual(['no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY']);
    ports.db.close();
  });

  it('64: a city code, a malformed code or the same airport twice, no call', async () => {
    const { ports } = testPorts(both, { now: at() });
    for (const [origin, destination] of [['lon', 'JFK'], ['', 'JFK'], ['LHR', 'LHR'], ['LHR', 'J1K']] as const) {
      const r = await runSmoke(ports, { origin, destination, recorderRoot: null });
      expect(r.exitCode).toBe(64);
    }
    const n = ports.db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get() as { n: number };
    expect(n.n).toBe(0);
    ports.db.close();
  });

  it('1: a configured provider answers 401; the other still prices and the cheapest is printed', async () => {
    const sa = smokeRecording('searchapi');
    const replay = replayHandlers(RECORDED_ROOT, { recordedBy: 'smoke' });
    // why: spec §2 fact 5 recorded this exact 401 body for SearchApi.
    server.use(http.all(`${sa.origin}/*`, () => HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 })), ...replay.handlers);
    const { ports } = testPorts(both, { now: at() });
    const r = await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: null });
    expect(r.exitCode).toBe(1);
    const saReport = r.providers.find((p) => p.providerId === 'searchapi');
    expect(saReport?.status).toBe('error');
    expect(saReport?.detail).toMatch(/^auth/);
    expect(saReport?.ledger).toEqual({ rows: 1, firstAttemptOk: 0 });
    expect(r.providers.find((p) => p.providerId === 'travelpayouts')?.status).toBe('priced');
    expect(r.lines.some((l) => l.startsWith('cheapest found '))).toBe(true);
    ports.db.close();
  });

  it('1: a retryable 503 is not retried past the per-run cap of one call', async () => {
    const sa = smokeRecording('searchapi');
    const replay = replayHandlers(RECORDED_ROOT, { recordedBy: 'smoke' });
    server.use(http.all(`${sa.origin}/*`, () => new HttpResponse(null, { status: 503 }), { once: true }), ...replay.handlers);
    const { ports } = testPorts(both, { now: at() });
    const r = await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: null });
    expect(r.exitCode).toBe(1);
    const saReport = r.providers.find((p) => p.providerId === 'searchapi');
    expect(saReport?.detail).toMatch(/^budget: execution-calls/);
    expect(saReport?.ledger.rows).toBe(1);
    expect(replay.served).not.toContain(sa.rec.file);
    ports.db.close();
  }, 30_000);

  it('3: no error but the tile holds no price', async () => {
    const tp = smokeRecording('travelpayouts');
    // why: the recorded envelope with its rows removed is the schema-valid empty case (spec §5.2).
    server.use(http.get(`${tp.origin}${tp.path}`, () => HttpResponse.json({ ...(tp.rec.body as Record<string, unknown>), data: [] })));
    const { ports } = testPorts(testEnv({ TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts }), { now: at() });
    const r = await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: null });
    expect(r.exitCode).toBe(3);
    expect(r.providers).toHaveLength(1);
    expect(r.providers[0]?.status).toBe('empty');
    expect(r.lines).toContain('no price found');
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- tools/smokeExitCodes`
Expected: the 2 and 64 cases PASS (Task 13.1 implemented them). The 401, 503 and empty cases PASS too unless one of the adapters breaks its contract. The behaviour already exists, so this step characterises it: if all five pass on the first run, temporarily change the empty-case expectation to `0`, run, and confirm FAIL "expected 3 to be 0", then restore it. That proves the assertion can fail.

- [ ] **Step 3: Implement**

No new code unless a case fails for a reason in `smoke.ts`. If one does, fix `smoke.ts` and leave the test unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- tools/smoke`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp13: smoke exit codes 1, 2, 3, 64 and the one-call cap"
```

### Task 13.3: CLI dispatch, `POST /tools/smoke` body and the request schema

**Files:**
- Create: `apps/api/test/tools/smokeArgs.test.ts`, `apps/api/test/routes/toolsSmoke.test.ts`
- Modify: `apps/api/src/bootstrap/tool.ts`, `apps/api/src/routes/tools.ts`, `packages/core/src/api-contract/system.ts`, `packages/core/test/api-contract/contract.test.ts`

**Interfaces:**
- Consumes: `runTool` (WP4b), `createApp` (WP8), `ROUTES`.
- Produces: `toolSmokeRequestSchema`, the fields of `toolRunResponseSchema`, `parseSmokeArgs`, `toToolRunResponse`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/api-contract/contract.test.ts`:

```ts
import { toolRunResponseSchema, toolSmokeRequestSchema } from '../../src/api-contract/index.js';

describe('tools contract (spec §10)', () => {
  it('the smoke takes two IATA codes', () => {
    expect(toolSmokeRequestSchema.safeParse({ origin: 'LHR', destination: 'JFK' }).success).toBe(true);
    expect(toolSmokeRequestSchema.safeParse({ origin: 'lhr', destination: 'JFK' }).success).toBe(false);
    expect(toolSmokeRequestSchema.safeParse({ origin: 'LHR' }).success).toBe(false);
  });
  it('a tool run reports its exit code and lines', () => {
    expect(toolRunResponseSchema.safeParse({ tool: 'smoke', exitCode: 3, lines: ['no price found'] }).success).toBe(true);
    expect(toolRunResponseSchema.safeParse({ tool: 'smoke', exitCode: 1.5, lines: [] }).success).toBe(false);
  });
});
```

`apps/api/test/tools/smokeArgs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSmokeArgs, smokeQuery } from '../../src/tools/smoke.js';
import { asIata, asIsoDate } from '@gmt/core';

describe('parseSmokeArgs and smokeQuery', () => {
  it('reads both flag forms and leaves missing values empty', () => {
    expect(parseSmokeArgs(['--origin', 'LHR', '--destination=JFK'])).toEqual({ origin: 'LHR', destination: 'JFK' });
    expect(parseSmokeArgs(['--origin'])).toEqual({ origin: '', destination: '' });
  });
  it.each([['2026-10-14', '2026-11-01'], ['2026-12-31', '2027-01-01'], ['2028-01-31', '2028-02-01'], ['2026-11-01', '2026-12-01']])(
    'today %s → departures from %s, eight days, inside one month',
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
import { asIsoDateTime } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { SENTINELS, testEnv, testPorts } from '../support/env.js';

describe('POST /tools/smoke (spec §10)', () => {
  it('awaits runSmoke and returns its exit code and lines; zero providers → 2, no call', async () => {
    const { ports } = testPorts(testEnv({ APP_BASIC_AUTH_USER: 'operator', APP_BASIC_AUTH_PASS: SENTINELS.authPass }), { now: asIsoDateTime('2026-10-14T09:00:00.000Z') });
    const engine = createEngine({ ...ports, notifiers: [] });
    const app = createApp({ ...ports, engine });
    const headers = {
      Authorization: `Basic ${Buffer.from(`operator:${SENTINELS.authPass}`).toString('base64')}`,
      'Content-Type': 'application/json', 'X-Requested-With': 'get-me-there',
    };
    const res = await app.request('http://localhost:3000/tools/smoke', { method: 'POST', headers, body: JSON.stringify({ origin: 'LHR', destination: 'JFK' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tool: 'smoke', exitCode: 2, lines: ['no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY'] });
    const bad = await app.request('http://localhost:3000/tools/smoke', { method: 'POST', headers, body: JSON.stringify({ origin: 'lon' }) });
    expect(bad.status).toBe(400);
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core test -- contract && pnpm --filter @gmt/api test -- smokeArgs toolsSmoke`
Expected: FAIL. "toolSmokeRequestSchema is not exported", and the route returns WP8's stub line "smoke not built yet" instead of the expected body.

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/system.ts`, adding to the existing file:

```ts
/** `POST /tools/smoke` body: the airports come from the operator, never from code. Spec §1, §10. */
export const toolSmokeRequestSchema = z.object({ origin: iataSchema, destination: iataSchema });
/** Every `/tools/*` run: the script's exit code and its printed lines. Spec §10. */
export const toolRunResponseSchema = z.object({ tool: z.enum(['smoke', 'record']), exitCode: z.number().int(), lines: z.array(z.string()) });
```

In `ROUTES`, the `POST /tools/smoke` entry gets `request: toolSmokeRequestSchema`.

`apps/api/src/routes/tools.ts`, the smoke handler body that replaces WP8's stub:

```ts
// Spec §10: the smoke inside the app process, for use while the app holds app_lock. The recorder
// is off here (recorderRoot null): the image has no fixtures/recorded tree (spec §13 .dockerignore).
app.post('/tools/smoke', zValidator('json', toolSmokeRequestSchema), async (c) => {
  const result = await runSmoke(ports, { ...c.req.valid('json'), recorderRoot: null });
  return c.json(toToolRunResponse(result), 200);
});
```

`apps/api/src/bootstrap/tool.ts`, the `smoke` branch of `runTool`:

```ts
// why: the CLI is the only caller that records; fixtures land in the committed tree (spec §5.5).
const RECORDED_FIXTURES_ROOT = fileURLToPath(new URL('../../../../packages/providers/fixtures/recorded', import.meta.url));

case 'smoke': {
  const result = await runSmoke(ports, { ...parseSmokeArgs(args), recorderRoot: RECORDED_FIXTURES_ROOT });
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  return result.exitCode;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test && pnpm --filter @gmt/api test`
Expected: PASS. `core` stays at 100%, and `api` holds 85/70.

- [ ] **Step 5: Commit**

```bash
git add packages/core apps/api && git commit -m "wp13: smoke CLI dispatch, POST /tools/smoke body, tools request schema (spec §10)"
```

### Task 13.4: Layer-B engine tests with the real adapters

**Files:**
- Create: `packages/engine/test/layerB/support.ts`, `discovery.test.ts`, `verification.test.ts`, `errors.test.ts`

**Interfaces:**
- Consumes: `createHarness` (WP7), `searchApiProvider`, `travelpayoutsProvider`, `loadSearchApiParams`, `loadTravelpayoutsParams`, `replayHandlers`, `listRecordings`, `latestRecordedAt`, `Engine.start`, `Engine.verifyCell`, `CellsRepo.buckets`, `LedgerRepo.countsFor`, `NotificationsRepo.wasSent`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/layerB/support.ts`:

```ts
/**
 * Layer B (spec §9 item 4): the real SearchApi and Travelpayouts adapters over msw replaying
 * fixtures/recorded, through WP7's harness (real http-kit, real SqliteBudgetGuard, in-memory DB).
 */
import { fileURLToPath } from 'node:url';
import { type Clock, type FlightProvider, type IsoDate, type Logger, Secret, addDays, asIata, asIsoDate, monthsSpanned } from '@gmt/core';
import type { Repos } from '@gmt/engine';
import { type HttpKit, type ProviderHttpLimits, loadSearchApiParams, loadTravelpayoutsParams, searchApiProvider, travelpayoutsProvider } from '@gmt/providers';
import { listRecordings } from '@gmt/providers/testing';

export const RECORDED_ROOT = fileURLToPath(new URL('../../../providers/fixtures/recorded', import.meta.url));
export const SENTINEL_SEARCHAPI = 'test-searchapi-key-0123456789abcdef';
export const SENTINEL_TRAVELPAYOUTS = 'test-travelpayouts-token-0123456789abcdef';

/** Vendor host taken from the recordings, so no hostname literal lives in the tests. */
function hostOf(providerId: string): string {
  const r = listRecordings(RECORDED_ROOT).find((x) => x.providerId === providerId);
  if (r === undefined) throw new Error(`no recording for ${providerId}`);
  return new URL(r.request.url).host;
}

export function layerBLimits(): Partial<Record<'searchapi' | 'travelpayouts', ProviderHttpLimits>> {
  return {
    travelpayouts: { hosts: [hostOf('travelpayouts')], ratePerMinute: 200, ratePerHour: 10_000, concurrency: 4, billable: 'never', costPerCallMicroGbp: 0, maxWaitSeconds: 60, requestTimeoutSeconds: 10 },
    searchapi: { hosts: [hostOf('searchapi')], ratePerMinute: 600, ratePerHour: 10_000, concurrency: 2, billable: 'http-200', costPerCallMicroGbp: 0, maxWaitSeconds: 60, requestTimeoutSeconds: 10 },
  };
}

export function realProviders(deps: { http: HttpKit; log: Logger; clock: Clock; repos: Repos }): FlightProvider[] {
  return [
    searchApiProvider({ http: deps.http, log: deps.log, clock: deps.clock, key: new Secret(SENTINEL_SEARCHAPI), plan: '40usd', pointOfSale: 'GB', paramsAllowlist: loadSearchApiParams(RECORDED_ROOT) }),
    travelpayoutsProvider({ http: deps.http, log: deps.log, clock: deps.clock, token: new Secret(SENTINEL_TRAVELPAYOUTS), paramsAllowlist: loadTravelpayoutsParams(RECORDED_ROOT), airports: deps.repos.airports }),
  ];
}

/**
 * The smoke's one-tile space as a definition. Same rule as apps/api smokeQuery (engine may not
 * import api); a drift shows up as replay misses.
 */
export function smokeSpaceDefinition(today: IsoDate, over: Record<string, unknown> = {}) {
  const next = monthsSpanned(today, addDays(today, 31))[1];
  if (next === undefined) throw new Error('monthsSpanned');
  const from = asIsoDate(`${next}-01`);
  return {
    name: 'layer B', origins: [asIata('LHR')], destinations: [asIata('JFK')], window: { kind: 'absolute', from, to: addDays(from, 7) } as const,
    minNights: 10, maxNights: 21, cabin: 'economy' as const, constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 50, maxFreeCalls: 50, maxCostMicroGbp: 0 },
    providers: { discovery: ['travelpayouts', 'searchapi'] as const, verification: [] as const, discoveryRefreshHours: {} },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: null, scheduleTz: 'Europe/London', confirmedCostPence: null, enabled: true,
    ...over,
  };
}
```

`packages/engine/test/layerB/discovery.test.ts`:

```ts
import { latestRecordedAt, replayHandlers } from '@gmt/providers/testing';
import { describe, expect, it, vi } from 'vitest';
import { createHarness } from '../harness.js';
import { RECORDED_ROOT, layerBLimits, realProviders, smokeSpaceDefinition } from './support.js';

type Row = { provider_id: string; source_kind: string; point_of_sale: string; max_age_hours: number | null; fetched_at: string; reused_from_execution_id: string | null };

describe('layer B discovery (spec §9 item 4, §5.2, §8.1)', () => {
  it('one month tile and one rectangle through the real adapters, full provenance, then a reuse run with zero calls', async () => {
    const at = latestRecordedAt(RECORDED_ROOT, 'smoke');
    const replay = replayHandlers(RECORDED_ROOT, { recordedBy: 'smoke' });
    const h = createHarness({ now: at, providers: realProviders, handlers: replay.handlers, limits: layerBLimits() });
    const def = h.repos.definitions.create(smokeSpaceDefinition(h.clock.todayLondon()));

    const first = await h.engine.start(def.id, { trigger: 'manual' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await vi.waitFor(() => expect(h.repos.executions.get(first.executionId)?.status).toBe('completed'), { timeout: 20_000 });
    expect(replay.misses).toEqual([]);
    const counts = h.repos.ledger.countsFor(first.executionId);
    expect(counts.tiles).toBe(2); // parity: plan() length 1 per provider (spec §8.1)
    expect(counts.cacheHits).toBe(0);
    for (const pid of ['travelpayouts', 'searchapi'] as const) {
      const b = h.repos.cells.buckets(first.executionId, 'discovery', pid);
      expect(b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run).toBe(96); // 8 days × 12 nights
      expect(b.priced).toBeGreaterThan(0);
      expect([b.error, b.not_run]).toEqual([0, 0]);
    }
    const rows = h.db.raw.prepare('SELECT provider_id, source_kind, point_of_sale, max_age_hours, fetched_at, reused_from_execution_id FROM calendar_prices WHERE execution_id = ?').all(first.executionId) as Row[];
    expect(new Set(rows.map((r) => r.provider_id))).toEqual(new Set(['travelpayouts', 'searchapi']));
    for (const r of rows) {
      expect(r.fetched_at).toBe(at);
      expect(r.reused_from_execution_id).toBeNull();
      const expected = r.provider_id === 'travelpayouts' ? ['authorised-cached', 'unknown', 48] : ['scraped-aggregate', 'GB', 24];
      expect([r.source_kind, r.point_of_sale, r.max_age_hours]).toEqual(expected);
    }

    h.clock.advance(3_600_000);
    const second = await h.engine.start(def.id, { trigger: 'manual' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await vi.waitFor(() => expect(h.repos.executions.get(second.executionId)?.status).toBe('completed'), { timeout: 20_000 });
    expect(h.repos.ledger.countsFor(second.executionId)).toMatchObject({ calls: 0, tiles: 0 });
    const reused = h.db.raw.prepare('SELECT fetched_at, reused_from_execution_id FROM calendar_prices WHERE execution_id = ?').all(second.executionId) as Row[];
    expect(reused.length).toBe(rows.length);
    for (const r of reused) {
      expect(r.reused_from_execution_id).toBe(first.executionId);
      expect(r.fetched_at).toBe(at); // original fetchedAt, never the reuse time (spec §8.1)
    }
    h.close();
  }, 60_000);
});
```

`packages/engine/test/layerB/verification.test.ts`:

```ts
import { type Recording, listRecordings, replayHandlers } from '@gmt/providers/testing';
import { asIata, asIsoDate, asIsoDateTime, daysBetween } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { createHarness } from '../harness.js';
import { RECORDED_ROOT, layerBLimits, realProviders, smokeSpaceDefinition } from './support.js';

/** WP4b's step 1→2→3 chain (spec §9 item 7): step 1 carries neither token parameter. */
function chain(): { step1: Recording; all: Recording[] } {
  const isFlights = (r: Recording) => r.providerId === 'searchapi' && new URL(r.request.url).searchParams.get('engine') === 'google_flights';
  const recs = listRecordings(RECORDED_ROOT).filter((r) => r.recordedBy !== 'smoke' && isFlights(r));
  const step1 = recs.find((r) => { const p = new URL(r.request.url).searchParams; return !p.has('departure_token') && !p.has('booking_token'); });
  if (step1 === undefined) throw new Error('no recorded google_flights step 1 (WP4b)');
  return { step1, all: recs.filter((r) => r.recordedAt.slice(0, 10) === step1.recordedAt.slice(0, 10)) };
}

describe('layer B verification (spec §5.4, §9 item 4)', () => {
  it('replays the recorded chain for its cell as a child execution with scraped-search provenance', async () => {
    const { step1, all } = chain();
    const p = new URL(step1.request.url).searchParams;
    const cell = { origin: asIata(p.get('departure_id') ?? ''), destination: asIata(p.get('arrival_id') ?? ''), departureDate: asIsoDate(p.get('outbound_date') ?? ''), returnDate: asIsoDate(p.get('return_date') ?? '') };
    const expandTop = all.filter((r) => new URL(r.request.url).searchParams.has('departure_token')).length;
    expect(expandTop).toBeGreaterThan(0);
    expect(expandTop).toBeLessThanOrEqual(2); // why: CHILD_MAX_CALLS 6 ≥ 1 + 2 × 2 (spec §8.1)
    const replay = replayHandlers(RECORDED_ROOT, { filter: (r) => all.includes(r) });
    const h = createHarness({ now: asIsoDateTime(step1.recordedAt), providers: realProviders, handlers: replay.handlers, limits: layerBLimits() });
    const nights = daysBetween(cell.departureDate, cell.returnDate);
    const def = h.repos.definitions.create(smokeSpaceDefinition(h.clock.todayLondon(), {
      origins: [cell.origin], destinations: [cell.destination], window: { kind: 'absolute', from: cell.departureDate, to: cell.departureDate },
      minNights: nights, maxNights: nights, providers: { discovery: [], verification: ['searchapi'], discoveryRefreshHours: {} },
      verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop, bookingLinks: true },
    }));
    const child = await h.engine.verifyCell(def.id, cell);
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    await vi.waitFor(() => expect(h.repos.executions.get(child.executionId)?.status).toBe('completed'), { timeout: 20_000 });
    expect(replay.misses).toEqual([]);
    const obs = h.db.raw.prepare('SELECT source_kind, max_age_hours, fetched_at, booking_json FROM price_observations WHERE execution_id = ?').all(child.executionId) as Array<{ source_kind: string; max_age_hours: number; fetched_at: string; booking_json: string | null }>;
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect([o.source_kind, o.max_age_hours, o.fetched_at]).toEqual(['scraped-search', 0, step1.recordedAt]);
      const booking = o.booking_json === null ? { kind: 'none' } : (JSON.parse(o.booking_json) as { kind: string; host?: string });
      if (booking.kind !== 'none') expect(booking.host === 'google.com' || booking.host?.endsWith('.google.com')).toBe(true);
    }
    const history = h.db.raw.prepare('SELECT COUNT(*) AS n FROM route_price_history WHERE origin = ? AND destination = ?').get(cell.origin, cell.destination) as { n: number };
    expect(history.n).toBeGreaterThan(0);
    expect(h.repos.ledger.countsFor(child.executionId).calls).toBeLessThanOrEqual(1 + expandTop * 2);
    h.close();
  }, 60_000);
});
```

`packages/engine/test/layerB/errors.test.ts`:

```ts
import { latestRecordedAt, listRecordings, replayHandlers } from '@gmt/providers/testing';
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it, vi } from 'vitest';
import { createHarness } from '../harness.js';
import { RECORDED_ROOT, layerBLimits, realProviders, smokeSpaceDefinition } from './support.js';

function originOf(providerId: string): string {
  const r = listRecordings(RECORDED_ROOT).find((x) => x.providerId === providerId);
  if (r === undefined) throw new Error(providerId);
  return new URL(r.request.url).origin;
}

describe('layer B error table rows with real adapters (spec §8.1)', () => {
  it.each([
    ['searchapi', () => HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 }), 'travelpayouts'],
    ['travelpayouts', () => HttpResponse.text('Unauthorized', { status: 401 }), 'searchapi'],
  ] as const)('%s auth failure disables it for the run; %s still prices; completed', async (failing, respond, other) => {
    const replay = replayHandlers(RECORDED_ROOT, { recordedBy: 'smoke' });
    // why: spec §2 fact 5 recorded these exact 401 bodies.
    const h = createHarness({ now: latestRecordedAt(RECORDED_ROOT, 'smoke'), providers: realProviders, handlers: [http.all(`${originOf(failing)}/*`, respond), ...replay.handlers], limits: layerBLimits() });
    const def = h.repos.definitions.create(smokeSpaceDefinition(h.clock.todayLondon()));
    const run = await h.engine.start(def.id, { trigger: 'manual' });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    await vi.waitFor(() => expect(h.repos.executions.get(run.executionId)?.status).toBe('completed'), { timeout: 20_000 });
    const bad = h.repos.cells.buckets(run.executionId, 'discovery', failing);
    expect([bad.priced, bad.not_run]).toEqual([0, 0]);
    expect(bad.error + bad.skipped).toBe(96);
    expect(h.repos.cells.buckets(run.executionId, 'discovery', other).priced).toBeGreaterThan(0);
    expect(h.repos.notifications.wasSent('provider_disabled', run.executionId)).toBe(true);
    h.close();
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- layerB`
Expected: FAIL. "Failed to resolve import '@gmt/providers/testing'" until Task 13.1 is built (`pnpm build`), and then FAIL "createHarness … providers is not a function" if WP7's harness lacks the options in §4. In that second case, extend `test/harness.ts` with the three options. The harness is test code under this WP's review, and extending it is the only change to WP7's files.

- [ ] **Step 3: Implement**

Extend `packages/engine/test/harness.ts` so that:
- `opts.providers` replaces the default fixture provider, receiving the harness's own `http`, `log`, `clock` and `repos`;
- `opts.handlers` is passed to `server.use(...)` after the fixture handlers;
- `opts.limits` is merged over the harness's limits record before `createHttpKit`.

No engine `src` change is expected. A layer-B failure that traces to `src` is a WP7 or WP5/WP6 defect, fixed on this branch with a regression test in the owning package.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && pnpm --filter @gmt/engine test`
Expected: PASS. The `engine` project holds 85/70, and layer A is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp13: layer-B engine tests with real adapters on recorded fixtures (spec §9 item 4)"
```

### Task 13.5: The tool bootstrap honours `app_lock` and starts no execution

**Files:**
- Create: `apps/api/test/tools/appLock.tool.test.ts`

**Interfaces:**
- Consumes: `runTool` via the real entry `apps/api/src/bootstrap/tool.ts`, `AppLock`, `buildPorts`, `DefinitionsRepo.create`, `ExecutionsRepo.create`/`setStatus`/`get`.

- [ ] **Step 1: Write the failing test**

```ts
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DefinitionSnapshot, asIata, asIsoDate, systemClock } from '@gmt/core';
import { AppLock } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { MIGRATIONS_DIR, REPO_ROOT, SENTINELS, captureLogger, seedVendoredAirports } from '../support/env.js';

const TOOL_ENTRY = join(REPO_ROOT, 'apps/api/src/bootstrap/tool.ts');

/** Spawns the real tool bootstrap. NODE_ENV=development because both bootstraps refuse test (spec §5.5). */
function spawnTool(args: string[], dbPath: string, timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = {
    PATH: process.env.PATH ?? '', NODE_ENV: 'development', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1', LOG_LEVEL: 'info',
    AUTO_RESUME: 'true', SEARCHAPI_KEY: SENTINELS.searchapi, TRAVELPAYOUTS_TOKEN: SENTINELS.travelpayouts,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', TOOL_ENTRY, ...args], { env, cwd: join(REPO_ROOT, 'apps/api'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { stderr += c; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`tool did not exit within ${timeoutMs} ms\n${stderr}`)); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** A DB with an enabled scheduled definition and an `interrupted` execution: everything that would tempt a boot sweep, auto-resume or cron. */
function prepare(): { dbPath: string; executionId: string } {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'gmt-lock-')), 'lock.db');
  const { log } = captureLogger();
  const ports = buildPorts(loadConfigFromEnv({ NODE_ENV: 'test', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1' }), { log, migrationsDir: MIGRATIONS_DIR });
  seedVendoredAirports(ports);
  const def = ports.repos.definitions.create({
    name: 'lock test', origins: [asIata('LHR')], destinations: [asIata('JFK')], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 30 },
    minNights: 10, maxNights: 12, cabin: 'economy', constraints: {}, verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: 0, maxFreeCalls: 10, maxCostMicroGbp: 0 }, providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', confirmedCostPence: null, enabled: true,
  });
  // why: written through the repository, so validateSearchSpace never runs; the resolved window only needs to be well-formed.
  const day = asIsoDate(def.createdAt.slice(0, 10));
  const snapshot: DefinitionSnapshot = { ...def, resolved: { origins: def.origins, destinations: def.destinations, departureFrom: day, departureTo: day, minNights: 10, maxNights: 12 }, resolvedAt: def.createdAt, windowClamped: false };
  const ex = ports.repos.executions.create({ definitionId: def.id, isChild: false, cell: null, snapshot, estimate: null });
  ports.repos.executions.setStatus(ex.id, 'interrupted');
  ports.db.close();
  return { dbPath, executionId: ex.id };
}

function inspect(dbPath: string) {
  const { log } = captureLogger();
  const ports = buildPorts(loadConfigFromEnv({ NODE_ENV: 'test', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1' }), { log, migrationsDir: MIGRATIONS_DIR });
  const executions = ports.db.raw.prepare('SELECT id, status, auto_resume_count FROM search_executions').all() as Array<{ id: string; status: string; auto_resume_count: number }>;
  const ledger = (ports.db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get() as { n: number }).n;
  return { ports, executions, ledger, lock: AppLock.inspect(ports.db) };
}

describe('tool bootstrap and app_lock (spec §7)', () => {
  it('refuses while a fresh app lock exists, touching nothing', async () => {
    const { dbPath, executionId } = prepare();
    const held = inspect(dbPath);
    const appLock = new AppLock(held.ports.db, 'app', systemClock, captureLogger().log);
    expect(appLock.acquire({ waitMs: 0 })).toBe('acquired');

    const r = await spawnTool(['record', '--budget', '0'], dbPath);

    expect(r.code).not.toBe(0);
    const after = inspect(dbPath);
    expect(after.lock?.holder).toBe('app');
    expect(after.executions).toEqual([{ id: executionId, status: 'interrupted', auto_resume_count: 0 }]);
    expect(after.ledger).toBe(0);
    appLock.release();
    after.ports.db.close();
    held.ports.db.close();
  }, 150_000);

  it('with no lock: acquires as tool, starts no execution, makes no call, releases', async () => {
    const { dbPath, executionId } = prepare();

    const r = await spawnTool(['record', '--budget', '0'], dbPath);

    expect(r.code).toBe(0);
    const logLines = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as { holder?: string; msg?: string });
    const acquired = logLines.findIndex((l) => l.holder === 'tool' && l.msg === 'app_lock acquired');
    const released = logLines.findIndex((l) => l.holder === 'tool' && l.msg === 'app_lock released');
    expect(acquired).toBeGreaterThanOrEqual(0);
    expect(released).toBeGreaterThan(acquired);
    const after = inspect(dbPath);
    // why: no boot sweep, no auto-resume, no cron (spec §7): the interrupted run is untouched and nothing new exists.
    expect(after.executions).toEqual([{ id: executionId, status: 'interrupted', auto_resume_count: 0 }]);
    expect(after.ledger).toBe(0);
    // Released, not merely stale: the app takes the lock at once with no wait.
    const app = new AppLock(after.ports.db, 'app', systemClock, captureLogger().log);
    expect(app.acquire({ waitMs: 0 })).toBe('acquired');
    app.release();
    after.ports.db.close();
    for (const s of Object.values(SENTINELS)) expect(r.stdout + r.stderr).not.toContain(s);
  }, 150_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- appLock.tool`
Expected: if WP4b's tool bootstrap and record tool behave as the spec says, both PASS on first run. This is a characterisation test of merged code. Prove the assertions bite by commenting out `appLock.acquire(...)` in the first case and running again. Expected: FAIL, `expected 0 not to be 0`, because the tool then acquires the lock and exits 0. Restore the line.

- [ ] **Step 3: Implement**

No new `src` code. A failure here is a WP4b defect: fix it in `apps/api/src/bootstrap/tool.ts` on this branch. The specific defects to look for are a missing lock check, a boot sweep or resume call, or missing acquire/release log lines.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test -- appLock.tool`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test && git commit -m "wp13: tool bootstrap honours app_lock and starts no execution (spec §7)"
```

### Task 13.6: Root `integration` project and the cross-cutting banned-word test

**Files:**
- Create: `integration/package.json`, `integration/tsconfig.json`, `integration/vitest.config.ts`, `integration/test/bannedWords.test.ts`
- Modify: `pnpm-workspace.yaml`, `vitest.config.ts`, `packages/core/src/text/bannedWords.ts`, `packages/core/test/text/bannedWords.test.ts`, WP9's web banned-word test, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `findBannedWords`, `UI_STRINGS`, `TEMPLATE_STRINGS`, `renderDigestEmail`, `renderOperatorEmail`, `API_REASON_STRINGS`.
- Produces: `BANNED_WORD_ALLOWLIST`, the `integration` project.

- [ ] **Step 1: Write the failing test**

`integration/test/bannedWords.test.ts`:

```ts
/**
 * Spec §11, §8.3: the one banned-word list over every user-facing surface, in one place, with the
 * one allowlist. Per-package tests stay; this one fails if any surface drifts.
 */
import { type AlertDigest, BANNED_WORD_ALLOWLIST, type OperatorMessage, findBannedWords } from '@gmt/core';
import { API_REASON_STRINGS } from '@gmt/api';
import { TEMPLATE_STRINGS, renderDigestEmail, renderOperatorEmail } from '@gmt/engine';
import { describe, expect, it } from 'vitest';
// why: web is not a dependency of any package (spec §4); the integration project reads its pure string module by path.
import { UI_STRINGS } from '../../apps/web/src/text/strings.js';

type Entry = { where: string; text: string };
function flatten(where: string, value: unknown): Entry[] {
  if (typeof value === 'string') return [{ where, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => flatten(`${where}[${i}]`, v));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => flatten(`${where}.${k}`, v));
  return [];
}

const KINDS: OperatorMessage['kind'][] = ['paused_budget', 'paused_error', 'skipped_budget', 'skipped_confirm', 'skipped_window', 'skipped_missed', 'interrupted', 'provider_disabled', 'parity_break', 'alerts_calendar_only'];
function digest(basis: AlertDigest['basis']): AlertDigest {
  return { ruleId: 'r1', definitionId: 'd1', executionId: 'e1', basis, subject: '', body: '', items: [], restCount: 0 };
}
const rendered: Entry[] = [
  ...(['verified', 'calendar'] as const).flatMap((b) => flatten(`engine.renderDigestEmail(${b})`, renderDigestEmail(digest(b)))),
  ...KINDS.flatMap((kind) => flatten(`engine.renderOperatorEmail(${kind})`, renderOperatorEmail({ kind, executionId: 'e1', definitionId: 'd1', subject: '', body: '' }))),
];
const sources = { web: flatten('web', UI_STRINGS), engine: [...flatten('engine', TEMPLATE_STRINGS), ...rendered], api: flatten('api', API_REASON_STRINGS) };
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
  it('every allowlist entry is used somewhere (no dead exemptions)', () => {
    for (const phrase of BANNED_WORD_ALLOWLIST) expect(all.some((e) => e.text.toLowerCase().includes(phrase.toLowerCase())), phrase).toBe(true);
  });
});
```

Append to `packages/core/test/text/bannedWords.test.ts`:

```ts
import { BANNED_WORD_ALLOWLIST } from '../../src/text/bannedWords.js';
it('the allowlist only holds phrases that contain a banned word', () => {
  for (const phrase of BANNED_WORD_ALLOWLIST) expect(findBannedWords(phrase).length, phrase).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm vitest run --project integration`
Expected: FAIL, "No projects matched the filter integration" (the project does not exist yet).

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
{ "extends": "../tsconfig.base.json", "compilerOptions": { "noEmit": true, "composite": false }, "include": ["test", "../apps/web/src/text/strings.ts"] }
```

`integration/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// why: cross-package tests (spec §9, §11, §5.3) live here; packages keep their own thresholds and
// this project has none, because it measures the system rather than one package's code.
export default defineConfig({
  test: { name: 'integration', include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
});
```

`pnpm-workspace.yaml`: add `- integration` under `packages:`.

Root `vitest.config.ts`: `projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts', 'integration/vitest.config.ts']`.

`packages/core/src/text/bannedWords.ts`, appended:

```ts
/**
 * The one allowlist of exact phrases that may contain a banned word, shared by every banned-word
 * test in the repository. Spec §11 "a small allowlist". Each entry carries a `// why:`; the
 * integration test fails on an entry no surface uses.
 */
export const BANNED_WORD_ALLOWLIST: readonly string[] = [];
```

Move any entries WP9's web test kept locally into this list, each with its `// why:`, and change that test to import `BANNED_WORD_ALLOWLIST` from `@gmt/core`.

`.github/workflows/ci.yml`: insert `- run: pnpm build` before `- run: pnpm test:coverage`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm install && pnpm build && pnpm vitest run --project integration && pnpm --filter @gmt/core test && pnpm --filter @gmt/web test`
Expected: PASS. `core` stays at 100%.

- [ ] **Step 5: Commit**

```bash
git add integration pnpm-workspace.yaml vitest.config.ts packages/core apps/web .github pnpm-lock.yaml && git commit -m "wp13: integration project and one banned-word test over every surface (spec §11)"
```

### Task 13.7: Whole-process sentinel-key test

**Files:**
- Create: `integration/test/support.ts`, `integration/test/sentinel.test.ts`

**Interfaces:**
- Consumes: `loadConfigFromEnv`, `buildPorts`, `createLogger`, `createApp`, `runSmoke`, `createEngine`, `EmailNotifier`, `fixtureHandlers`, `replayHandlers`, `latestRecordedAt`, `ROUTES`, `seedAirports`.

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
 * sentinel; every path runs, error paths included; then every sink is scanned (pino output, every
 * DB value, every GET body, the captured email, the fixtures trees, error messages).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { type AlertDigest, type OperatorMessage, apiContract, asIata, asIsoDate, asIsoDateTime, fixedClock } from '@gmt/core';
import { type AirportsDataset, seedAirports } from '@gmt/db';
import { EmailNotifier, createEngine } from '@gmt/engine';
import { fixtureHandlers } from '@gmt/providers';
import { latestRecordedAt, listRecordings, replayHandlers } from '@gmt/providers/testing';
import { buildPorts, createApp, createLogger, loadConfigFromEnv, runSmoke } from '@gmt/api';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MIGRATIONS_DIR, REPO_ROOT, FIXTURES_ROOT, RECORDED_ROOT, SYNTHETIC_ROOT, everyDbValue, fileTexts } from './support.js';

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
function findSentinels(where: string, text: string): string[] {
  return FORMS.filter((f) => text.includes(f)).map((f) => `${where} contains sentinel form ${f.slice(0, 14)}…`);
}

interface CapturedMail { message: { createReadStream(): NodeJS.ReadableStream; getEnvelope(): unknown; messageId(): string } }

describe('no secret reaches any sink (spec §5.3)', () => {
  it('finds a planted sentinel (positive control)', () => {
    expect(findSentinels('control', `x ${S.searchapi} y`)).toHaveLength(1);
    expect(findSentinels('control', `Authorization: Basic ${BASIC}`)).toHaveLength(1);
  });

  it('runs every path with sentinel secrets and scans every sink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmt-sentinel-'));
    const fixturesOut = join(dir, 'recorded');
    const recordedAt = latestRecordedAt(RECORDED_ROOT, 'smoke');
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
    const capture = {
      name: 'capture', version: '1.0.0',
      send(mail: CapturedMail, done: (err: Error | null, info?: unknown) => void) {
        const chunks: Buffer[] = [];
        const input = mail.message.createReadStream();
        input.on('data', (c: Buffer) => chunks.push(c));
        input.on('error', (e: Error) => done(e));
        input.on('end', () => { sentMail.push(Buffer.concat(chunks).toString('utf8')); done(null, { envelope: mail.message.getEnvelope(), messageId: mail.message.messageId() }); });
      },
    };
    const failing = { name: 'failing', version: '1.0.0', send(_m: CapturedMail, done: (err: Error | null) => void) { done(new Error('535 5.7.8 authentication failed')); } };

    // --- the process
    const config = loadConfigFromEnv(env);
    const log = createLogger(config, sink);
    const ports = buildPorts(config, { log, clock: fixedClock(recordedAt), migrationsDir: MIGRATIONS_DIR });
    const dataDir = join(REPO_ROOT, 'packages/db/data');
    const dataset = readdirSync(dataDir).find((f) => /^airports\..+\.json$/.test(f));
    if (dataset === undefined || config.smtp === null) throw new Error('setup');
    seedAirports(ports.db, JSON.parse(readFileSync(join(dataDir, dataset), 'utf8')) as AirportsDataset);
    const emailOk = new EmailNotifier({ smtp: config.smtp, log, transport: capture });
    const emailBad = new EmailNotifier({ smtp: config.smtp, log, transport: failing });
    const engine = createEngine({ ...ports, notifiers: [emailOk] });
    const app = createApp({ ...ports, engine });

    const server = setupServer();
    const seenRequests: Array<{ url: string; headers: string }> = [];
    server.events.on('request:start', ({ request }) => { seenRequests.push({ url: request.url, headers: JSON.stringify([...request.headers]) }); });
    const trapped: string[] = [];
    const replay = replayHandlers(RECORDED_ROOT, { recordedBy: 'smoke' });
    server.use(
      http.all('https://egress-trap.example/*', ({ request }) => { trapped.push(request.headers.get('authorization') ?? ''); return HttpResponse.json({}); }),
      ...fixtureHandlers(SYNTHETIC_ROOT),
      ...replay.handlers,
    );
    server.listen({ onUnhandledRequest: 'error' });
    try {
      // 1. Smoke, success: both vendor keys travel in headers.
      expect((await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: fixturesOut })).exitCode).toBe(0);

      // 2. Smoke, error paths: SearchApi 401; Travelpayouts 302 to another host (egress refuses; no credentials leave).
      const saOrigin = new URL(listRecordings(RECORDED_ROOT).find((r) => r.providerId === 'searchapi')?.request.url ?? '').origin;
      const tpOrigin = new URL(listRecordings(RECORDED_ROOT).find((r) => r.providerId === 'travelpayouts')?.request.url ?? '').origin;
      server.use(
        http.all(`${saOrigin}/*`, () => HttpResponse.json({ error: 'Invalid API key.' }, { status: 401 }), { once: true }),
        http.all(`${tpOrigin}/*`, () => new HttpResponse(null, { status: 302, headers: { Location: 'https://egress-trap.example/steal' } }), { once: true }),
      );
      expect((await runSmoke(ports, { origin: 'LHR', destination: 'JFK', recorderRoot: null })).exitCode).toBe(1);
      expect(trapped).toEqual([]);

      // 3. An execution on the fixture provider with a 500, a network error and, for one child, a 401.
      const def = ports.repos.definitions.create({
        name: 'sentinel', origins: [asIata('LHR')], destinations: [asIata('JFK')], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 3 },
        minNights: 10, maxNights: 11, cabin: 'economy', constraints: {}, verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true },
        budget: { maxCalls: 50, maxFreeCalls: 50, maxCostMicroGbp: 0 }, providers: { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: {} },
        destinationNotes: {}, onwardCostPence: {}, scheduleCron: null, scheduleTz: 'Europe/London', confirmedCostPence: null, enabled: true,
      });
      server.use(
        http.all('http://fixture.local/*', () => HttpResponse.json({ error: 'upstream exploded' }, { status: 500 }), { once: true }),
        http.all('http://fixture.local/*', () => HttpResponse.error(), { once: true }),
      );
      const run = await engine.start(def.id, { trigger: 'manual' });
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      await vi.waitFor(() => expect(['completed', 'paused_error', 'paused_budget']).toContain(ports.repos.executions.get(run.executionId)?.status), { timeout: 30_000 });
      const cell = ports.repos.cells.outcomes(run.executionId)[0];
      if (cell === undefined) throw new Error('no outcomes');
      server.use(http.all('http://fixture.local/*', () => HttpResponse.json({ error: 'denied' }, { status: 401 }), { once: true }));
      const child = await engine.verifyCell(def.id, { origin: cell.origin, destination: cell.destination, departureDate: cell.departureDate, returnDate: cell.returnDate });
      if (child.ok) await vi.waitFor(() => expect(ports.repos.executions.get(child.executionId)?.status).not.toBe('running'), { timeout: 30_000 });

      // 4. Email: a digest and an operator message delivered, and a failed delivery logged.
      const digest: AlertDigest = { ruleId: 'r1', definitionId: def.id, executionId: run.executionId, basis: 'calendar', subject: '[get-me-there] test digest', body: 'calendar price, no itinerary', items: [], restCount: 0 };
      const message: OperatorMessage = { kind: 'paused_error', executionId: run.executionId, definitionId: def.id, subject: '[get-me-there] paused', body: 'paused with an error' };
      expect((await emailOk.send(digest)).ok).toBe(true);
      expect((await emailOk.send(message)).ok).toBe(true);
      const failed = await emailBad.send(digest);
      expect(failed.ok).toBe(false);

      // 5. API: every GET route authenticated, plus failed auth and a validation error.
      const firstHash = (ports.db.raw.prepare('SELECT hash FROM itineraries LIMIT 1').get() as { hash: string } | undefined)?.hash ?? '0'.repeat(64);
      const params: Record<string, string> = { origin: cell.origin, destination: cell.destination, departureDate: cell.departureDate, returnDate: cell.returnDate, hash: firstHash };
      const auth = { Authorization: `Basic ${BASIC}`, Host: 'localhost:3000' };
      const bodies: Array<{ where: string; text: string }> = [];
      for (const route of apiContract.ROUTES.filter((r) => r.method === 'GET')) {
        const path = route.path.replace(/:(\w+)/g, (_m, k: string) => (k === 'id' ? (route.path.startsWith('/executions') ? run.executionId : def.id) : (params[k] ?? '')));
        const res = await app.request(`http://localhost:3000${path}`, { headers: auth });
        bodies.push({ where: `GET ${path} (${res.status})`, text: await res.text() });
      }
      const denied = await app.request('http://localhost:3000/providers', { headers: { Authorization: `Basic ${Buffer.from(`${USER}:wrong-password-1234`).toString('base64')}`, Host: 'localhost:3000' } });
      bodies.push({ where: 'GET /providers (bad auth)', text: await denied.text() });
      const invalid = await app.request('http://localhost:3000/definitions', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Requested-With': 'get-me-there' }, body: '{"name":1}' });
      bodies.push({ where: 'POST /definitions (invalid)', text: await invalid.text() });

      // --- the paths really carried the sentinels (otherwise the scan proves nothing)
      expect(seenRequests.some((r) => r.headers.includes(S.searchapi))).toBe(true);
      expect(seenRequests.some((r) => r.headers.includes(S.travelpayouts))).toBe(true);
      expect(seenRequests.filter((r) => FORMS.some((f) => r.url.includes(f)))).toEqual([]); // keys never in a URL (spec §2 fact 8)
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

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm vitest run --project integration -- sentinel`
Expected: FAIL. Until contract additions 3, 4 and 11 are exported, the error is "createLogger is not exported by @gmt/api" or "EmailNotifier … transport". Once they are, any FAIL is a real leak, and the `findings` array names the sink and the sentinel form.

- [ ] **Step 3: Implement**

- Export `createLogger` from `apps/api/src/index.ts`. If WP8's logger is built inline in `bootstrap/app.ts`, move it to `apps/api/src/logger.ts` unchanged and import it in both bootstraps.
- Add the `transport?` option to WP11's `EmailNotifier`. When set, pass it to `nodemailer.createTransport(transport)` in place of the SMTP options; production never sets it.
- For each finding, fix the sink at its source by adding the missing scrub (`stripUrl`, a pino redact path, or `Secret` in place of a raw string). Never weaken the scan.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && pnpm vitest run --project integration && pnpm test`
Expected: PASS. Every package keeps its threshold.

- [ ] **Step 5: Commit**

```bash
git add integration apps/api packages/engine && git commit -m "wp13: whole-process sentinel-key test over logs, DB, API, email and fixtures (spec §5.3)"
```

### Task 13.8: Route-mount test and the integration review

**Files:**
- Create: `integration/test/routes.test.ts`

**Interfaces:**
- Consumes: `ROUTES`, `createApp`, `inspectRoutes` (`hono/dev`).

- [ ] **Step 1: Write the failing test**

```ts
import { apiContract, asIsoDateTime, fixedClock } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { buildPorts, createApp, createLogger, loadConfigFromEnv } from '@gmt/api';
import { inspectRoutes } from 'hono/dev';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './support.js';

describe('every spec §10 route is mounted (spec §10)', () => {
  it('ROUTES and the app agree, both ways', () => {
    const config = loadConfigFromEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' });
    const log = createLogger(config, new Writable({ write(_c, _e, cb) { cb(); } }));
    const ports = buildPorts(config, { log, clock: fixedClock(asIsoDateTime('2026-10-14T09:00:00.000Z')), migrationsDir: MIGRATIONS_DIR });
    const app = createApp({ ...ports, engine: createEngine({ ...ports, notifiers: [] }) });
    const mounted = new Set(inspectRoutes(app).filter((r) => !r.isMiddleware).map((r) => `${r.method} ${r.path}`));
    const declared = apiContract.ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(declared.filter((d) => !mounted.has(d))).toEqual([]);
    const extra = [...mounted].filter((m) => !declared.includes(m) && !m.startsWith('GET /assets') && m !== 'GET /*');
    expect(extra).toEqual([]);
    ports.db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm vitest run --project integration -- routes`
Expected: if WP8 mounted every route, PASS on first run. Prove the check bites by temporarily appending `{ method: 'GET', path: '/nope', response: z.object({}), auth: 'required' }` to a local copy of `declared`. Expected: FAIL `["GET /nope"]`. Then revert.

- [ ] **Step 3: Run the integration review**

Work through each line in order. Record the result (command output or file path) in the PR body under "WP13 integration review". A line that fails becomes a finding fixed on this branch before the tag.

1. **Spec §9 item → passing test file.** For each item, list the test files that cover it, using `rg -l` over `packages/*/test apps/*/test integration/test`. Then run `pnpm test`. Expected: every item has at least one file and the run is green.
   1. `core`: `rg -l "syntheticAllowed|toGbp|itineraryHash|evaluateConstraints|rollUp|selectCandidates|evaluateAlertRules|formatAgeFull" packages/core/test`
   2. `providers`: `rg -l "partition|has_no_flights|Retry-After|redirect|recordedBy|params-" packages/providers/test`
   3. `db`: `rg -l "3200|claimResume|bootSweep|AppLock|fx_converted" packages/db/test`
   4. `engine` layer A: `rg -l "createHarness" packages/engine/test --glob '!layerB/**'`. Layer B: `ls packages/engine/test/layerB`.
   5. `api`: `rg -l "fixture|/tools/|Content-Type|X-Requested-With|frame-ancestors" apps/api/test`
   6. `web`: `rg -l "provenance|375|banned|rel=\"noopener" apps/web/test`, plus `apps/web/e2e/smoke.spec.ts`
   7. Live scripts: `apps/api/test/tools/smoke*.test.ts`, plus WP4b's record test.
   8. Build: the CI "Dockerfile sets production and container flags" step.
2. **Every spec §10 route exercised.** `integration/test/routes.test.ts` passes. The sentinel test requested every GET route. For each mutating route, `rg -n "'(POST|PUT|DELETE)'.*<path>|method: '(POST|PUT|DELETE)'" apps/api/test` finds at least one request in the `api` tests.
3. **Coverage thresholds.** `pnpm test:coverage` exits 0. `core` is at 100/100/100/100; `db`, `providers`, `engine` and `api` are at ≥ 85% lines and ≥ 70% branches; `web` is at ≥ 70% lines and ≥ 60% branches.
4. **Stryker.** `pnpm mutate` exits 0. The report shows a score ≥ 80% over the nine files in `packages/core/stryker.config.json`, and the run finds every file (no "no files to mutate" warning).
5. **Boundaries.** `node scripts/check-boundaries.mjs` exits 0.
6. **Secret scan.** `pnpm secret-scan` prints "secret scan: clean". `git ls-files | rg '\.env$|\.db$|backups/'` prints nothing.
7. **No airport literal in application code.** `rg -n "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/*/src apps/*/src` prints nothing.
8. **Docker build green.** `docker build -t get-me-there:v0.1.0-rc .` succeeds. `docker run --rm get-me-there:v0.1.0-rc node -e "process.exit(process.env.NODE_ENV==='production'&&process.env.IN_CONTAINER==='1'?0:1)"` exits 0.
9. **Manual walkthrough in fixture mode.** Start the app with `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake NODE_ENV=development DATABASE_PATH=./data/walkthrough.fixture.db pnpm dev`, create the worked-example definition with "import example", and run it. Take screenshots of View A Results, View B Calendar, View C Duration and View D Coverage at 1280 px and at 375 px, eight images in all. Save them to `~/Documents/get-me-there/v0.1.0-walkthrough/`, outside the repository and never committed. Check each screenshot against spec §11:
   - the red synthetic banner is present;
   - every price has its provenance visible without hover;
   - the six coverage buckets sum to the cell count;
   - the class badge, price and provenance stay visible at 375 px.
10. **Reviewer pass.** Run `/review-spec docs/briefs/wp13-smoke-and-final-pass.md --roster full` against the branch diff. Fix every Critical and High finding before the tag.

- [ ] **Step 4: Commit**

```bash
git add integration && git commit -m "wp13: route-mount test; integration review recorded in the PR"
```

### Task 13.9: Release v0.1.0

**Files:**
- Modify: `docs/setup.md` (only where the fresh-clone check below finds a step that does not work)

- [ ] **Step 1: Fresh clone in Docker, following `docs/setup.md` literally**

```bash
rm -rf /tmp/gmt-fresh && git clone "$(git remote get-url origin)" /tmp/gmt-fresh && cd /tmp/gmt-fresh
cp .env.example .env    # then set APP_BASIC_AUTH_USER, APP_BASIC_AUTH_PASS (≥ 12 chars) and TRAVELPAYOUTS_TOKEN, as docs/setup.md step 1 says
docker compose up -d --build
docker compose ps       # expected: app "healthy" once the HEALTHCHECK start_period has passed
docker compose exec app node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(j=>{console.log(JSON.stringify(j));process.exit(j.ok?0:1)})"
# expected: {"ok":true,"degraded":false}
docker compose exec app node -e "const a=Buffer.from(process.env.APP_BASIC_AUTH_USER+':'+process.env.APP_BASIC_AUTH_PASS).toString('base64');fetch('http://127.0.0.1:3000/tools/smoke',{method:'POST',headers:{Authorization:'Basic '+a,'Content-Type':'application/json','X-Requested-With':'get-me-there',Host:'localhost:3000'},body:JSON.stringify({origin:'LHR',destination:'JFK'})}).then(r=>r.json()).then(j=>{console.log(j.lines.join('\n'));process.exit(j.exitCode)})"
# expected: exit 0 (or 3 when the Aviasales cache is empty for that month), a "cheapest found £… · LHR→JFK … · fetched …" line, and "fixtures not written (app process)"
docker compose down
```

Each command must work exactly as `docs/setup.md` gives it. Where the doc differs from the commands above (for example, if it still says `curl`), fix the doc in this repository's working copy, not the clone, and re-run from the top.

- [ ] **Step 2: The CLI smoke on the host with real keys**

Run: `pnpm smoke:live -- --origin LHR --destination JFK`
Expected: exit 0 (or 3, which means route coverage, not a defect), with every provider line showing a ledger of `1 call(s), 1 first-attempt ok`. Do not commit the fixtures this run writes. Delete them with `git clean -n packages/providers/fixtures/recorded` (to review) and then `git clean -f packages/providers/fixtures/recorded`. The committed smoke recordings from Task 13.1 stay as they are.

- [ ] **Step 3: Tag**

```bash
git switch main && git merge --no-ff wp/13-smoke-and-final-pass -m "wp13: live smoke, layer B, lock test, integration review"
pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint && pnpm -r typecheck
git tag -a v0.1.0 -m "get-me-there v0.1.0: Phases 1–3 per spec revision 9"
git push origin main v0.1.0
```

Expected: every command exits 0. `git tag -l v0.1.0` prints `v0.1.0`.

## 9. Pinned review-focus tests

The plan's five Review Focus lines all belong to WP0–WP10. WP13 re-runs them as part of the integration review (Task 13.8 Step 3, item 1) and owns none of its own. On top of that, it pins these cross-cutting checks from its instructions:

- Smoke exit 0 with provenance and ledger proof: Task 13.1.
- Per-run cap of one call, which turns a retry into BudgetExceeded: Task 13.2, "a retryable 503".
- The tool bootstrap starts no execution: Task 13.5.
- One banned-word test over three surfaces with one allowlist and a dead-entry check: Task 13.6.
- Sentinels absent from all six sinks, with proof that they really were sent in headers: Task 13.7.

## 10. Definition of done

- `pnpm install --frozen-lockfile && pnpm build` exits 0.
- `pnpm lint` is clean and `pnpm -r typecheck` is clean, the `integration` package included.
- `pnpm test:coverage` exits 0 with `core` at 100/100/100/100, `db`/`providers`/`engine`/`api` at ≥ 85% lines and ≥ 70% branches, and `web` at ≥ 70% lines and ≥ 60% branches. The `integration` project runs with no threshold.
- `pnpm --filter @gmt/api test -- tools` passes 9 tests across the smoke files plus the 2 lock tests.
- `pnpm --filter @gmt/engine test -- layerB` passes 4 tests.
- `pnpm vitest run --project integration` passes the banned-word (4), sentinel (2) and routes (1) tests.
- `pnpm mutate` exits 0 with a score ≥ 80%.
- `node scripts/check-boundaries.mjs` exits 0.
- `pnpm secret-scan` prints "secret scan: clean".
- `docker build .` succeeds, and the fresh-clone run in Task 13.9 passes as written.
- The integration review table in the PR has every line filled.
- `v0.1.0` is tagged on `main`.

## 11. Open questions

None. The spec, plan and instruction mismatches in §3 and the contract additions in §5 are not design questions: the spec settles each one, and Fable folds them into the plan before dispatch.
