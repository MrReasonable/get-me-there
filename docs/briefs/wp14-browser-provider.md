---
wp: 14
title: Camoufox provider (self-scraped Google Flights, opt-in)
owner: opus
depends_on: [13]
spec_sections: ["§2", "§3", "§5.1", "§5.2", "§5.3", "§8.1", "§9 items 2 and 7", "§11", "§12", "§13", "§15", "§16"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer, security-reviewer, devops-reviewer]
status: draft
---

# WP14: Camoufox provider (self-scraped Google Flights, opt-in)

Written 2026-10-18 against spec revision 32, plan decisions 1–69 and `main` at 1e79da0, and revised after the round-1
review (4 Critical, 29 High, 51 Medium, 27 Low; summary and findings at
`~/.cache/get-me-there/review-spec/wp14-browser-provider/r1/`). The operator's rulings on that review are plan decision
69; every finding is addressed, and Appendix A lists each finding ID with where this brief answers it.

**What changed in round 1.** The worker no longer drives the camofox-browser REST server. It launches its own Camoufox,
from the operator's installed binary, through `camoufox-js`, in a persistent profile of its own (decision 69). That one
change settles the four Criticals: camofox-browser 1.13.1 has no version route and no cookie-listing route
(devops-001, PIE-01, SEC-001), and its built-in `dismissConsentDialogs` clicks "Accept all" inside every snapshot and
click (PIE-02). The worker now reads cookies with `context.cookies()`, sets `SOCS` with `context.addCookies`, and never
calls camofox-browser, so its auto-dismiss, shared superkey (SEC-008), bootstrap cookies (SEC-005, PIE-13) and crash
telemetry (SEC-014, PIE-19) stop mattering.

**The evidence this brief stands on.**

- *Feasibility load, 2026-10-18* (signed in, through camofox-browser): the worked example's search
  (`?q=Flights from LHR to JFK on 2026-11-05 returning 2026-11-15&curr=GBP&hl=en-GB&gl=GB`) loaded the full results with
  no challenge. Seen: a `tablist` with tabs "Best" and "Cheapest from £451" (accessible name "Cheapest from Fetching
  results 451 British pounds", so the page was still loading); "24 results returned."; lists "Top departing flights"
  and "Other departing flights" of `listitem`s each holding one `link` named with the whole option; buttons "View more
  flights", "Date grid", "Price graph", "View price history", "Sorted by top flights, Change sort order."; footer
  "Currency GBP" and "Location·United Kingdom". All of it on the **Best** tab.
- *Signed-out test, 2026-10-18* (fresh profile `gmt-probe-signedout`, since deleted): landed on `consent.google.com`
  ("Before you continue", "Reject all" / "Accept all"), no CAPTCHA, no "unusual traffic"; camofox-browser then
  accepted by itself; the results page that followed held 26 result links in the same name grammar.
- *Package source, read 2026-10-18* (§7): `camoufox-js` 0.11.5 and the operator's installed binary.

Neither load saw the Cheapest tab selected, the search form's fields, a "no flights" page, the grid's contents or a
consent page in a profile carrying a pre-set rejection. Task 14.1 records those before any parser depends on them
(decision 69: "the first task records the Best and Cheapest pages").

## 1. Goal

Build an opt-in, off-by-default `camoufox` discovery provider that reads the cheapest round-trip price Google Flights
lists for one day pair per page, in the operator's own Camoufox launched by a host-side worker in its own signed-out
profile, at a fixed low rate, stopping at once on any bot check or page it does not recognise, behind the same contract,
ledger, caps and labels as every other provider.

## 2. Scope

**In**

- **Recordings first** (Task 14.1): the worker's launch, the page classifier, the cool-down and a development-only
  recorder, so the operator records the Best page, the Cheapest page, the search form, a consent page (in a throwaway
  profile, never clicked), the `SOCS` stability probe and, if one can be found, a "no flights" page, before any parser
  is written against them.
- **The worker** `apps/camoufox-worker` (Tasks 14.1–14.5): launch through `camoufox-js` with the pinned binary and a
  launch shim; the aria-snapshot parser; the classifier (blocked kinds first; cool-down by cause); the dated selectors
  module and the dated result-name grammar; the readiness and search-form checks; the list reader (every result link,
  airport and date matching, the Cheapest-tab comparison); `SOCS` capture, pre-set and read-back on every path; the
  start-to-start pacer with persisted state; the data-directory lock; the persisted signed-in refusal; the page
  deadline and the failure map; the key-authenticated HTTP API with its status route and `x-gmt-google-contacted`.
- **Core** (Task 14.6): `ProviderId` `'camoufox'`; `SourceKind` `'scraped-self'`; `ProviderErrorKind` `'blocked'` and
  `'provider-unavailable'`; `SkipReason` `'provider_unavailable'`; `BudgetScope`/`BudgetScopeKind`
  `'provider-execution'` with its label; `ProviderLimits.executionCallCap`; `ExecutionBudget.providerMaxCalls`;
  `DiscoveryQuery.airportNames`; `DiscoveryCapability.preflight`; the worker's wire contract as zod schemas
  (`core/src/camoufox/protocol.ts`); the source label; the `CAMOUFOX_*` config block.
- **db** (Task 14.7): migration 0005 (widened CHECKs, `provider_requests.page_class`, `operator_notice_keys`); the
  camoufox entry in `budgetConfigFromConfig`; the `provider-execution` predicate read from the snapshot budget; `no-page`
  rows outside the page caps; the check order.
- **http-kit and the adapter** (Task 14.8): the never-ledgered id `camoufox-status`; non-retryable transport failures
  and `provider-unavailable` for camoufox; `page_class` from the worker's header; `x-gmt-worker-key` as a credential
  header; list tiling; the answer mapping; `preflight`; `fetchedAt` validation.
- **Engine** (Task 14.9): the preflight skip and the once-per-cool-down notice; the `blocked` and `provider-unavailable`
  rows; no manual re-admission after a block; the page cap frozen into the snapshot at start; `airportNames`; the
  estimate's clamp, seconds and coverage note; `budgetFit`'s camoufox load.
- **Wiring and copy** (Task 14.10); **Docker, compose, CI and boundaries** (Task 14.11); **operator docs** (Task
  14.12); **smoke rows** (Task 14.13).

**Out**

- `grid` mode. Designed in spec §2, not built: the worker answers 409 `mode-unavailable`, the config refuses
  `CAMOUFOX_MODE=grid`, and a test pins that it cannot be enabled until stored rows record where a return date came
  from (decision 69). The grid findings (PIE-16, prov-007) are recorded in spec §2's grid paragraph for that later work.
- Itinerary search (spec §2).
- Proxies, CAPTCHA solving, clicking or waiting out a challenge, any cookie but `SOCS`, signing in, clicking anything on
  a consent page, humanised input, geolocation lookups, add-ons. Forbidden by decisions 68 and 69; Task 14.1's launch
  tests and Task 14.11's rules tests pin each.
- The camofox-browser server: never called. The operator may keep running it for other tools; this work package
  neither needs it nor changes it.
- Installing Camoufox. The operator's own; §7 names the build verified.

## 3. Spec sections and plan decisions

- **§2 Continuity fallback (rev 32).** Method (embedded Camoufox; list mode; settle and search-form checks), discovery
  only, limits, consent, navigation and stops (cool-down by cause; preflight), ledger and caps (`no-page`; check order;
  no transport retries), labels, coverage, costs. The costs and coverage go verbatim into the operator docs (Task 14.12).
- **§3.** `error`/`blocked`; `skipped:provider_unavailable`.
- **§5.1.** The widened unions; `airportNames`; `preflight`; `BudgetExceeded` `provider-execution`.
- **§5.2.** List tiling; the worker answer map.
- **§5.3.** Never billable; `no-page`; the egress exception; `camoufox-status`.
- **§8.1.** The `blocked`, `provider-unavailable`, preflight and `provider-execution` rows.
- **§9 items 2 and 7; §11; §12; §13; §15; §16.**
- **Plan decisions 61, 64** (recordings local-only, visible skip), **68** (provider id, limits), **69** (round-1
  rulings), **17, 19, 24, 28, 30, 54** (limiter smoothing, the closed priced-reason set, healthchecks probe nothing,
  cell issues never `no_data`, truncation, staleness).

## 4. Interfaces consumed

From `@gmt/core` (verbatim names): `FlightProvider`, `DiscoveryCapability`, `CapabilityInfo`, `DiscoveryQuery`,
`TilePlan`, `DiscoveryTileResult`, `RawCalendarPrice`, `CellIssue`, `CellKey`, `ProviderContext`, `ProviderError`,
`Clock`, `fixedClock`, `Logger`, `Secret`, `generateCells`, `addDays`, `daysBetween`, `cellKeyString`, `asIsoDate`,
`asIata`, `asIsoDateTime`, `isoDateTimeOfEpochMs`, `isoDateSchema`, `isoDateTimeSchema`, `iataSchema`, `parseConfig`
(`(env, { realpath }) → ConfigResult`, never throws), `budgetScopeLabel`.

From `@gmt/providers`: `HttpKit`, `HttpKitRequest`, `ProviderHttpLimits`, `ResponseFacts`, `CREDENTIAL_HEADERS`,
`parseError`; from `@gmt/providers/testing` (worker tests only, decision 69): `recordingsPresent`, `skipTitle`,
`SKIP_SUFFIX`; the providers test harness `makeKit`, `FakeBudget`, `testLimits`, `server`.

From `@gmt/db`: `budgetConfigFromConfig`, the guard's predicates; tests use `freshDb` (`test/helpers/db.ts`).

From `@gmt/engine`: `disabledBefore`, `commitTile` (a covered cell with no price, no issue and not in `noFares` is
written `no_data`; a `CellIssue` on a priced cell writes `offers-dropped:n` from `offersDropped` and puts `detail` in
`last_error`), `SECONDS_PER_CALL`, the estimate, `budgetFit`.

From `camoufox-js` 0.11.5 (verified in source, §7): `Camoufox(options & { user_data_dir })`, which returns a
`BrowserContext` from `firefox.launchPersistentContext`; `launchOptions(...)`'s fields `executable_path`, `ff_version`,
`exclude_addons`, `headless`, `geoip`, `humanize`, `os`, `locale`, `env`, `i_know_what_im_doing`, and its pass-through
of other Playwright launch options. From `playwright-core` 1.59.1: `BrowserContext.cookies(urls?)`, `addCookies`,
`clearCookies`, `route`, `newPage`, `close`; `Page.goto`, `url`, `frames`, `locator('body').ariaSnapshot()`, `getByRole`;
`Route.abort`, `Route.fallback`, `Route.request`; `Request.isNavigationRequest`, `Request.url`.

## 5. Interfaces produced

```ts
// packages/core/src/types/provenance.ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'camoufox' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'scraped-self' | 'synthetic';
// packages/core/src/errors.ts
export type ProviderErrorKind = 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout'
  | 'blocked' | 'provider-unavailable';
export type BudgetScopeKind = 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-execution'
  | 'provider-month' | 'provider-lifetime' | 'global-month';
// packages/core/src/ports/budget.ts
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-execution'; executionId: string; providerId: ProviderId }   // label 'provider-execution:camoufox'
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number; pageClass?: 'page' | 'no-page' }): void }
// packages/core/src/types/execution.ts
export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'provider_unavailable' | 'departed';
// packages/core/src/types/definition.ts
export interface ExecutionBudget { maxCalls: number; maxFreeCalls: number; maxCostMicroGbp: number; providerMaxCalls?: Partial<Record<ProviderId, number>> }
// packages/core/src/config/presets.ts
export interface ProviderLimits { /* existing fields */ executionCallCap?: number; pagesOnly?: true }   // pagesOnly: no-page rows are not counted
// packages/core/src/ports/provider.ts
export interface DiscoveryQuery { /* existing fields */ airportNames?: { origin: string[]; destination: string[] } }
export type PreflightResult = { ok: true } | { ok: false; skip: 'provider_disabled' | 'provider_unavailable'; detail: string; until?: IsoDateTime };
export interface DiscoveryCapability { /* existing members */ preflight?(ctx: ProviderContext): Promise<PreflightResult> }
// packages/core/src/config/schema.ts (Config.providers)
camoufox: {
  key: Secret;
  workerUrl: string;              // validated: http or https, host 127.0.0.1 | localhost | [::1] | host.docker.internal, explicit port, no path, query or userinfo
  minSpacingSeconds: number;      // 30–600
  executionPageCap: number;       // 1–400
  cooldownHours: number;          // ≥ 24
  pageTimeoutSeconds: number;     // 30–240
  limits: ProviderLimits;         // monthlyCallCap = CAMOUFOX_MONTHLY_PAGE_CAP, window 'month', billingDay = CAMOUFOX_BILLING_DAY,
                                  // ratePerMinute = max(1, floor(60 / spacing)), ratePerHour = floor(3600 / spacing), concurrency 1,
                                  // cacheTtlHours 0, costPerCallMicroGbp 0, planFixedMicroGbp 0, excludedFromSchedule false,
                                  // executionCallCap = executionPageCap, pagesOnly true
} | null;

// packages/core/src/camoufox/protocol.ts (pure zod, the one copy both sides use; arch-011)
export const pageRequestSchema;      // { mode: 'list' | 'grid'; origin; destination; departureDate; returnDate; gl; airportNames: { origin: string[]; destination: string[] } }
export const workerAnswerSchema;     // discriminated on kind, below
export type WorkerAnswer =
  | { kind: 'cells'; fetchedAt: IsoDateTime; currency: 'GBP'; pointOfSale: string; cell: PageCell; notes: string[]; versions: Versions }
  | { kind: 'blocked'; page: BlockedPage; cooldownUntil: IsoDateTime }   // 423
  | { kind: 'cooling-down'; cause: BlockedPage; cooldownUntil: IsoDateTime }   // 423, Google not contacted
  | { kind: 'spacing'; retryAfterSeconds: number }                     // 429, Google not contacted
  | { kind: 'mode-unavailable'; mode: 'grid' }                         // 409, Google not contacted
  | { kind: 'not-ready'; elapsedMs: number }                           // 504, Google contacted
  | { kind: 'browser-error'; stage: 'launch' | 'navigate' | 'read'; detail: string };   // 502; contacted unless stage is 'launch'
export type BlockedPage = 'captcha' | 'unusual-traffic' | 'consent-unhandled' | 'sign-in' | 'signed-in' | 'off-allowlist' | 'unrecognised';
export type PageCell =
  | { status: 'price'; amountMinor: number; tabMinor: number | null; optionsUnparsed: number; optionsOtherCell: number; returnDateFrom: 'query-and-form' }
  | { status: 'no-flights' };        // Google's own "no flights" line, once recorded → no_data
export interface Versions { selectors: string; grammar: string; camoufoxJs: string; binary: string }
export const GOOGLE_CONTACTED_HEADER = 'x-gmt-google-contacted';   // '1' | '0' on every answer

// packages/providers/src/camoufox/index.ts
export const CAMOUFOX_DISPLAY_NAME = 'Google Flights via Camoufox';
export const CAMOUFOX_DISCOVERY_INFO: CapabilityInfo;      // scraped-self, maxAgeHours 0, the spec §2 provenance note
export function planSingleCells(q: DiscoveryQuery): TilePlan[];
export function camoufoxProvider(o: { http: HttpKit; log: Logger; clock: Clock; key: Secret; workerUrl: string; pointOfSale: string }): FlightProvider;
export function camoufoxHttpLimits(c: NonNullable<Config['providers']['camoufox']>, cfg: Pick<Config, 'maxWaitSeconds'>): ProviderHttpLimits;
```

The worker's own modules (`apps/camoufox-worker/src`) export nothing to other packages; nothing imports the worker.

## 6. Endpoints and parameters

**Worker** (host-side, `CAMOUFOX_WORKER_URL`, default `http://127.0.0.1:8090`). Every request carries
`x-gmt-worker-key` (constant-time compare over equal-length buffers; a mismatch, a missing header or a length mismatch is
401 with no body detail). Every answer carries `x-gmt-google-contacted: 1|0`.

| Route | Answer | Status | Google contacted |
|---|---|---|---|
| `GET /v1/status` | `{ ok, coolingDownUntil, cooldownCause, signedInRefusal, lastPageAt, busySince, versions, profileHasAccountCookie: false, socsCapturedAt, socsReadBackExact, cooldownHours, pageTimeoutSeconds }` | 200 | no |
| `POST /v1/page`, `mode: 'list'` | `cells` | 200 | yes |
|  | `blocked` | 423 | yes |
|  | `cooling-down` (also while the signed-in refusal stands) | 423 | no |
|  | `spacing` | 429 + `Retry-After` | no |
|  | `not-ready` | 504 | yes |
|  | `browser-error` | 502 | yes, except `stage: 'launch'` |
| `POST /v1/page`, `mode: 'grid'` | `mode-unavailable` | 409 | no |
| invalid body (schema, size > 4 KiB, wrong content type) | `{ kind: 'bad-request' }` | 400 | no |
| anything else | — | 404 | no |

**Google** (worker side only). One URL form, the feasibility load's, built in `src/url.ts`:
`https://www.google.com/travel/flights?q=Flights from <origin> to <destination> on <departure> returning <return>&curr=GBP&hl=en-GB&gl=<gl>`.
`tfs` is never built. `hl=en-GB` is load-bearing (English names).

**Navigation allowlist** (worker `src/guard.ts`, a pure `decideRoute` wired to `context.route('**/*')`): a document or
frame navigation is allowed only to `https://www.google.com` with a path equal to `/travel/flights` or under
`/travel/flights/` (so `/travel/flightsevil` is refused); everything else is aborted with `blockedbyclient` and recorded,
and the session answers `consent-unhandled` (`consent.google.com`), `sign-in` (`accounts.google.com`) or
`off-allowlist`. Subresources load as in any browser. The worker clicks only names its selectors module marks verified.

**The consent cookie.** Name `SOCS`, verified 2026-10-18 against Google's cookie policy
(<https://policies.google.com/technologies/cookies>: "Google uses the 'SOCS' cookie, which lasts for 13 months, to store
a user's state regarding their cookies choices"). The value is undocumented and never invented: the operator captures it
from a real "Reject all" in an ordinary private browser window, with `capture-socs` (Task 14.3).

## 7. Library and tool notes

Read in source on 2026-10-18, from the operator's checkout `/Users/iandominey/camofox-browser/node_modules/camoufox-js`
(`package.json` version **0.11.5**, `"type": "module"`, `engines.node >= 22`, peer `playwright-core: "*"`, dependencies
including `better-sqlite3 ^13`, `fingerprint-generator`, `impit`):

- `dist/sync_api.js` `Camoufox(launch_options)`: strips `headless` and `user_data_dir`, calls `launchOptions(...)`, and
  with a string `user_data_dir` returns `firefox.launchPersistentContext(userDataDir, fromOptions)`, a
  `BrowserContext`. `headless` defaults to `false`; the worker passes `true`.
- `dist/utils.js` `launchOptions`: `executable_path` (string, resolved) becomes `executablePath`; without it,
  `launchPath()` resolves the install directory. **`loadProperties(executable_path)` reads `properties.json` from
  `dirname(executable_path)`**; in the macOS bundle the binary is `Camoufox.app/Contents/MacOS/camoufox` and
  `properties.json` is in `Contents/Resources`, so pointing `executable_path` at the binary itself fails with ENOENT.
  The worker therefore builds a **launch shim** in its data directory, `<data>/shim/<sha16>/camoufox-bin` (a symlink to
  the binary's realpath) beside `properties.json` (a symlink to the bundle's), and passes the shim's path, as
  camofox-browser's own `lib/camoufox-executable.js` (`ensureLaunchShim`) does for the same binary.
- `launchOptions` calls `installedVerStr()` for the Firefox major **unless `ff_version` is given**; `installedVerStr()`
  reads `<CAMOUFOX_INSTALL_DIR or ~/Library/Caches/camoufox>/version.json` through `Version.fromPath`, which takes
  `versionData.release`. **The installed binary's own `version.json`**
  (`~/Library/Caches/camoufox/browsers/official/152.0.4-beta.28-8b7680a6/version.json`) reads
  `{"version":"152.0.4","build":"beta.28",…,"sha256":"8b7680a6…"}`: the build is named `build`, not `release`, so
  `Version` would call `undefined.split` on it. The worker never lets `camoufox-js` read a version file: it reads the
  bundle's `version.json` itself (searching up to four directories above the binary's realpath for exactly one),
  takes `build` (falling back to `release` only when `build` is absent, so either spelling reads), pins
  `CAMOUFOX_BINARY_BUILD` (default `152.0.4-beta.28`) against `<version>-<build>`, and passes
  `ff_version: Number(version.split('.')[0])` (152) with `i_know_what_im_doing: true`, which only silences the
  `ff_version` leak warning (the worker passes no manual `config` and no custom fingerprint, the other two things that
  flag governs).
- `addDefaultAddons` downloads uBlock Origin from addons.mozilla.org through Node when its directory is missing, and
  resolves it through the install directory: the worker passes `exclude_addons: ['UBO']`, so no add-on is fetched or
  read.
- `geoip: true` would call a public-IP lookup and download a GeoIP database (`dist/ip.js`, `dist/locale.js`): the worker
  passes `geoip: false`. `proxy` is never passed. `humanize` is never passed (default off).
- `env`: when absent, `launchOptions` passes the **whole `process.env`** to the browser. The worker passes a minimal
  `env` (`HOME`, `PATH`, `TMPDIR`, `LANG=en_GB.UTF-8`), so its own key never reaches the browser process.
- Other Playwright options pass through `...launch_options`; the worker sets `handleSIGTERM`, `handleSIGINT` and
  `handleSIGHUP` to `false` (the worker's own shutdown closes the context), as camofox-browser does.
- `camoufox-js` uses `Math.random` for fingerprint seeds; that is Camoufox's own fingerprint, not a worker delay.
- **playwright-core 1.59.1**: the version camofox-browser 1.13.1 ships beside `camoufox-js` 0.11.5 and runs Camoufox
  152.0.4-beta.28 with (Juggler compatibility). The workspace's other Playwright (`@playwright/test` 1.64.1 in
  `apps/web`) is unrelated. `BrowserContext.cookies(urls?)`, `addCookies(cookies)` and `clearCookies(options?)` are
  verified in `types/types.d.ts` (lines 9036, 8908, 8985 of the 1.59.1 copy); `Locator.ariaSnapshot()` returns the
  YAML text form (`- role "name" [attr]:` lines).
- An upgrade of `camoufox-js`, `playwright-core` or the binary is a re-verification: the start checks refuse any other
  `camoufox-js` version (read from its `package.json`) or binary build.

## 8. Files

Create:

- `apps/camoufox-worker/`: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`,
  `stryker.config.json`, `launchd/uk.dominey.get-me-there.camoufox-worker.plist.example`,
  `fixtures/recorded/.gitkeep`
- `apps/camoufox-worker/src/`: `main.ts` and `record.ts` and `captureSocs.ts` and `clearSignedIn.ts` (the four entry
  points; the only `process.env` readers), `config.ts`, `envFile.ts`, `binary.ts`, `launch.ts`, `lock.ts`, `aria.ts`,
  `selectors.ts`, `names.ts`, `airports.ts`, `classify.ts`, `guard.ts`, `ready.ts`, `form.ts`, `list.ts`, `socs.ts`,
  `cooldown.ts`, `pacer.ts`, `refusal.ts`, `driver.ts`, `session.ts`, `server.ts`, `url.ts`, `pointOfSale.ts`
- `apps/camoufox-worker/test/`: `support/trees.ts`, `support/fakeDriver.ts`, `support/tmp.ts`, and one test file per
  source module above, plus `recorded.test.ts`, `record.test.ts`, `rules.test.ts`
- `packages/core/src/camoufox/protocol.ts` and `packages/core/test/camoufox/protocol.test.ts`
- `packages/providers/src/camoufox/`: `index.ts`, `provider.ts`, `tiles.ts`, `answer.ts`, `limits.ts`, `preflight.ts`
- `packages/providers/test/camoufox/`: `tiles.test.ts`, `fetchTile.test.ts`, `limits.test.ts`, `egress.test.ts`,
  `preflight.test.ts`, `recorderHeaders.test.ts`
- `packages/db/drizzle/0005_camoufox_provider.sql` (and its meta snapshot); `packages/db/test/migration0005.test.ts`,
  `packages/db/test/budgetGuard.providerExecution.test.ts`, `packages/db/test/budgetConfig.camoufox.test.ts`
- `packages/engine/test/camoufoxRows.test.ts`, `packages/engine/test/camoufoxEstimate.test.ts`,
  `packages/engine/test/support/camoufox.ts`

Modify:

- `packages/core/src/types/provenance.ts`, `errors.ts`, `ports/budget.ts`, `ports/provider.ts`, `types/execution.ts`,
  `types/definition.ts`, `labels/source.ts`, `config/schema.ts`, `config/presets.ts`, `index.ts`, and their tests
- `packages/db/src/internal/enums.ts`, `budgetConfig.ts`, `budgetGuard.ts`, `schema/*.ts`
- `packages/providers/src/http/egress.ts`, `http/httpKit.ts`, `http/types.ts`, `http/classify.ts`, `http/attempt.ts`,
  `http/cacheKey.ts` (`CREDENTIAL_HEADERS`), `test/fakes.ts` (`testLimits.camoufox`)
- `packages/engine/src/run.ts`, `resume.ts`, `estimate.ts`, `budgetFit.ts`, `start.ts`, `stages/discovery.ts`,
  `notify.ts`
- `apps/api/src/wiring.ts`, `apps/api/src/read/usage.ts`, `apps/api/src/tools/smoke.ts`, `smokeChecks.ts`,
  `apps/web/src/copy.ts`, `.env.example`
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.gitignore`, `package.json` (root build filter),
  `scripts/check-boundaries.mjs`, `scripts/workflows.test.mjs`, `.github/workflows/ci.yml`
- `docs/setup.md`, `docs/providers.md`, `docs/api-limits.md`, `docs/scheduling.md` (generated rows)

## 9. Pages the worker recognises, and what is verified

The classifier is a pure function of `{ url, frameUrls, tree }`, total over any input (an unparsable URL is
`off-allowlist`). The order below is the code's order; the first match wins.

| Order | Kind | Rule (selectors module) | Evidence | Cool-down |
|---|---|---|---|---|
| 1 | `captcha` | a frame URL on `www.google.com` with path under `/recaptcha/`, an `iframe` node named /recaptcha/i, or a `checkbox` named /not a robot/i | generic; the iframe and the URL are the realistic signals (PIE-17) | 48 h |
| 2 | `unusual-traffic` | URL path under `/sorry/`, or any node name matching /unusual traffic/i | generic | 48 h |
| 3 | `signed-in` | any `button` or `link` named /^Google Account: / | feasibility load showed it | 48 h + persisted refusal |
| 4 | `consent-unhandled` | URL host `consent.google.com`, or a `heading` named "Before you continue" | signed-out test | 48 h |
| 5 | `sign-in` | URL host `accounts.google.com`, or a `heading` named "Sign in" | generic | 48 h |
| 6 | `off-allowlist` | URL not `https://www.google.com/travel/flights` or under `/travel/flights/` | rule | 48 h |
| 7 | `no-flights` | the recorded "no flights" line (Task 14.1); until recorded, never matched | Task 14.1 | none; `no_data` |
| 8 | `results` | exactly one `tablist` holding exactly one `tab` named /^Cheapest\b/, exactly one `button` named "Date grid", and at least one result `link` | feasibility load | — |
| 9 | `unrecognised` | anything else, and a `results` page whose search form disagrees with the query | rule | 1 h, provider disabled for the run |

Settled (`ready.ts`): a `results` page is read only when the text "<N> results returned." is present, no node name
contains "Fetching results", the Cheapest tab name carries a price, and the result links number at least one; the
session polls the snapshot every 2 s within the page deadline, classifying blocked kinds on every poll. Not settled by
the deadline: `not-ready` (no cool-down).

Verification state in `selectors.ts` (each flag flips only in the commit that adds the recording proving it, and the
recorded suite pins it): `RESULTS_VERIFIED` (true: feasibility load), `FORM_VERIFIED`, `CHEAPEST_FLOW_VERIFIED`,
`VIEW_MORE_ADDS_CHEAPER`, `NO_FLIGHTS_VERIFIED`, `SOCS_STABLE`, `GRID_VERIFIED` (false until Task 14.1's recordings).
While `FORM_VERIFIED` is false the worker refuses to start (the search-form check is mandatory, decision 69); Task 14.1's
recording sets it before any list page is served.

## 10. Tasks

Conventions for every task: test clocks are `fixedClock(asIsoDateTime(…))` from `@gmt/core` (arch-003); no casts
(`check-casts.mjs` scans tests too): narrow with guards or parse with the zod schemas; each step's expected result is
"PASS, no skipped tests" unless a count is stated (TS-17); every worker test is pure (synthetic trees, a fake driver, a
temp data directory) except Task 14.1's launch smoke, which runs only on the operator's machine and skips visibly
elsewhere.

### Task 14.1: Scaffold, launch, classifier, cool-down and the recorder, then the first recordings (first failing test)

**Files:** create `apps/camoufox-worker/{package.json,tsconfig.json,tsconfig.test.json,vitest.config.ts}`,
`src/{aria.ts,selectors.ts,classify.ts,cooldown.ts,binary.ts,launch.ts,lock.ts,guard.ts,driver.ts,record.ts}`,
`test/support/{trees.ts,fakeDriver.ts,tmp.ts}`, `test/{aria,classify,cooldown,binary,launch,lock,guard,record}.test.ts`,
`test/recorded.test.ts`; `.gitignore`.

`package.json`:

```json
{
  "name": "@gmt/camoufox-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node --conditions=@gmt/source --env-file-if-exists=${CAMOUFOX_ENV_FILE:-$HOME/.local/state/get-me-there/camoufox/worker.env} --import tsx src/main.ts",
    "record": "node --conditions=@gmt/source --env-file-if-exists=$HOME/.local/state/get-me-there/camoufox/worker.env --import tsx src/record.ts",
    "capture-socs": "node --conditions=@gmt/source --import tsx src/captureSocs.ts",
    "clear-signed-in": "node --conditions=@gmt/source --import tsx src/clearSignedIn.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@gmt/core": "workspace:*", "camoufox-js": "0.11.5", "playwright-core": "1.59.1" },
  "devDependencies": { "@gmt/providers": "workspace:*" }
}
```

(The worker runs from source, like `apps/api`'s `tool` script, so a fresh checkout needs only `pnpm install`; there is
no `dist` to go stale (devops-003, arch-014). `tsx`, `vitest`, `typescript` and Stryker entries copy `apps/api`'s
exactly. `main.ts` re-checks the env file's mode, Task 14.5.)

`vitest.config.ts` sets the floor 90 lines / 80 branches / 90 functions / 90 statements for the package and 100 lines and
branches for `classify.ts`, `cooldown.ts`, `pacer.ts`, `socs.ts`, `names.ts`, `guard.ts`, `ready.ts` (TS-12, decision
69). `stryker.config.json` mutates those seven modules with the command runner, concurrency 2 and explicit timeouts, and
`scripts/mutation-gate.mjs` applies the existing 80% break and 5% timeout gate to it.

- [ ] **Step 1: Write the failing test**

`test/support/trees.ts`:

```ts
import type { AxNode, Snapshot } from '../../src/aria.js';

/** A synthetic accessibility node; synthetic only, never copied from a recording. */
export function n(role: string, name: string, children: AxNode[] = [], extra: Partial<AxNode> = {}): AxNode {
  return { role, name, children, ...extra };
}
export const RESULTS = 'https://www.google.com/travel/flights?q=x&curr=GBP&hl=en-GB&gl=GB';
export const SEARCH = 'https://www.google.com/travel/flights/search?tfs=x';
export const CONSENT = 'https://consent.google.com/ml?continue=x';
export const SORRY = 'https://www.google.com/sorry/index?continue=x';

export function option(pounds: number, opts: { leaves?: string; from?: string; to?: string; extra?: string } = {}): AxNode {
  const from = opts.from ?? 'Heathrow Airport';
  const to = opts.to ?? 'John F. Kennedy International Airport';
  const on = opts.leaves ?? 'Thursday, November 5';
  return n('listitem', '', [n('link', `From ${pounds} British pounds round trip total.${opts.extra ?? ''} 1 stop flight with Example Air. Leaves ${from} at 12:25 on ${on} and arrives at ${to} at 20:05 on ${on}. Total duration 12 hrs 40 min. Select flight`)]);
}

/** A settled results page shaped like the feasibility load's tree (roles and names only). */
export function resultsTree(o: { url?: string; tab?: string; top?: AxNode[]; other?: AxNode[]; extra?: AxNode[]; count?: number; form?: AxNode[] } = {}): Snapshot {
  const top = o.top ?? [option(478)];
  const other = o.other ?? [option(451)];
  return {
    url: o.url ?? SEARCH,
    frameUrls: [],
    tree: n('document', 'Google Flights', [
      ...(o.form ?? formNodes()),
      n('tablist', '', [n('tab', 'Best', [], { selected: true }), n('tab', o.tab ?? 'Cheapest from 451 British pounds')]),
      n('text', `${o.count ?? top.length + other.length} results returned.`),
      n('list', 'Top departing flights', top),
      n('list', 'Other departing flights', other),
      n('button', 'Date grid'),
      n('button', 'Currency GBP'),
      n('button', 'Location·United Kingdom'),
      ...(o.extra ?? []),
    ]),
  };
}
/** The search form as Task 14.1's recording will pin it; these names are the brief's hypothesis until then. */
export function formNodes(o: { trip?: string; adults?: string; dep?: string; ret?: string } = {}): AxNode[] {
  return [
    n('combobox', `Change ticket type. ${o.trip ?? 'Round trip'}`),
    n('button', `${o.adults ?? '1'} passenger, change number of passengers.`),
    n('textbox', 'Departure', [], { value: o.dep ?? 'Thu, 5 Nov' }),
    n('textbox', 'Return', [], { value: o.ret ?? 'Sun, 15 Nov' }),
  ];
}
const page = (url: string, kids: AxNode[], frameUrls: string[] = []): Snapshot => ({ url, frameUrls, tree: n('document', '', kids) });
export const captchaFrameTree = page(RESULTS, [n('iframe', 'reCAPTCHA')], ['https://www.google.com/recaptcha/api2/anchor?k=x']);
export const captchaCheckboxTree = page(RESULTS, [n('checkbox', "I'm not a robot")]);
export const sorryTree = page(SORRY, [n('text', 'Our systems have detected unusual traffic from your computer network.')]);
export const signInTree = page(RESULTS, [n('heading', 'Sign in')]);
export const signedInTree = (): Snapshot => resultsTree({ extra: [n('button', 'Google Account: Example Person (example@example.test)')] });
export const consentTree = page(CONSENT, [n('heading', 'Before you continue'), n('button', 'Reject all'), n('button', 'Accept all')]);
export const blankTree = page(RESULTS, [n('text', 'Something else')]);
export const loadingTree = (): Snapshot => resultsTree({ tab: 'Cheapest from Fetching results 451 British pounds' });
```

`test/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyPage } from '../src/classify.js';
import * as T from './support/trees.js';

describe('classifyPage (spec §2, brief §9; blocked kinds first, total)', () => {
  it.each([
    ['a reCAPTCHA frame URL', T.captchaFrameTree, 'captcha'],
    ['a not-a-robot checkbox', T.captchaCheckboxTree, 'captcha'],
    ['the /sorry/ path', T.sorryTree, 'unusual-traffic'],
    ['unusual-traffic text on a results URL', { ...T.sorryTree, url: T.RESULTS }, 'unusual-traffic'],
    ['a signed-in account control on a full results page', T.signedInTree(), 'signed-in'],
    ['the consent page', T.consentTree, 'consent-unhandled'],
    ['a consent heading on a results URL', { ...T.consentTree, url: T.RESULTS }, 'consent-unhandled'],
    ['a sign-in heading', T.signInTree, 'sign-in'],
    ['accounts.google.com', { ...T.blankTree, url: 'https://accounts.google.com/ServiceLogin' }, 'sign-in'],
    ['www.google.com outside /travel/flights', { ...T.resultsTree(), url: 'https://www.google.com/search?q=x' }, 'off-allowlist'],
    ['/travel/flightsevil', { ...T.resultsTree(), url: 'https://www.google.com/travel/flightsevil' }, 'off-allowlist'],
    ['plain http', { ...T.resultsTree(), url: 'http://www.google.com/travel/flights' }, 'off-allowlist'],
    ['an unparsable URL', { ...T.resultsTree(), url: 'not a url' }, 'off-allowlist'],
    ['results without the Date grid button', { ...T.resultsTree(), tree: T.n('document', '', T.resultsTree().tree.children.filter((c) => c.name !== 'Date grid')) }, 'unrecognised'],
    ['two Cheapest tabs', T.resultsTree({ extra: [T.n('tablist', '', [T.n('tab', 'Cheapest from 1 British pounds')])] }), 'unrecognised'],
    ['anything else', T.blankTree, 'unrecognised'],
  ])('%s → blocked:%s', (_n, snap, page) => {
    expect(classifyPage(snap)).toEqual({ kind: 'blocked', page });
  });
  it('the feasibility-shaped results page is results', () => {
    expect(classifyPage(T.resultsTree())).toEqual({ kind: 'results' });
  });
  it('results with a CAPTCHA frame are blocked', () => {
    expect(classifyPage({ ...T.resultsTree(), frameUrls: ['https://www.google.com/recaptcha/api2/anchor'] })).toEqual({ kind: 'blocked', page: 'captcha' });
  });
  it('a consent heading beside a sign-in heading is consent-unhandled (row 4 before row 5)', () => {
    expect(classifyPage({ url: T.RESULTS, frameUrls: [], tree: T.n('document', '', [T.n('heading', 'Sign in'), T.n('heading', 'Before you continue')]) })).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
  });
});
```

`test/cooldown.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CooldownStore } from '../src/cooldown.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2026-10-18T05:00:00.000Z');

describe('CooldownStore (spec §2: cool-down by cause, persisted, fail closed)', () => {
  it('a bot check cools down for the configured hours', () => {
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) });
    s.start('captcha');
    expect(s.active()).toEqual({ until: '2026-10-20T05:00:00.000Z', cause: 'captcha' });
  });
  it('an unrecognised page cools down for exactly one hour', () => {
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) });
    s.start('unrecognised');
    expect(s.active()?.until).toBe('2026-10-18T06:00:00.000Z');
  });
  it('survives a restart and ends at the boundary', () => {
    const dir = tmpDir();
    new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).start('sign-in');
    expect(new CooldownStore({ dir, botHours: 48, clock: fixedClock(asIsoDateTime('2026-10-19T05:00:00.000Z')) }).active()?.until).toBe('2026-10-20T05:00:00.000Z');
    expect(new CooldownStore({ dir, botHours: 48, clock: fixedClock(asIsoDateTime('2026-10-20T05:00:00.000Z')) }).active()).toBeNull();
  });
  it('a later, shorter cool-down never shortens a longer one', () => {
    const dir = tmpDir();
    new CooldownStore({ dir, botHours: 72, clock: fixedClock(T0) }).start('captcha');
    const s = new CooldownStore({ dir, botHours: 48, clock: fixedClock(asIsoDateTime('2026-10-18T06:00:00.000Z')) });
    s.start('unrecognised');
    expect(s.active()).toEqual({ until: '2026-10-21T05:00:00.000Z', cause: 'captcha' });
  });
  it.each([['not json', '{not json'], ['a non-date until', JSON.stringify({ until: 'tomorrow', cause: 'captcha' })], ['an unknown cause', JSON.stringify({ until: '2026-10-19T00:00:00.000Z', cause: 'x' })]])(
    'a record that is %s fails closed: a fresh bot-length cool-down from now',
    (_n, content) => {
      const dir = tmpDir();
      writeFileSync(join(dir, 'cooldown.json'), content);
      expect(new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).active()).toEqual({ until: '2026-10-20T05:00:00.000Z', cause: 'unrecognised' });
      expect(JSON.parse(readFileSync(join(dir, 'cooldown.json'), 'utf8')).cause).toBe('unrecognised');
    },
  );
  it('a read error other than ENOENT is thrown, never read as "no cool-down"', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'cooldown.json'), '{}', { mode: 0o000 });
    expect(() => new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).active()).toThrow(/EACCES/);
  });
  it('refuses fewer than 24 bot hours', () => {
    expect(() => new CooldownStore({ dir: tmpDir(), botHours: 23, clock: fixedClock(T0) })).toThrow(/CAMOUFOX_COOLDOWN_HOURS/);
  });
});
```

(The EACCES case skips visibly when the suite runs as root, where mode 0o000 does not stop a read.)

`test/binary.test.ts` (over a temp bundle the test lays out: `<dir>/Camoufox.app/Contents/{MacOS/camoufox,Resources/properties.json}` and `<dir>/version.json`):

```ts
import { describe, expect, it } from 'vitest';
import { readBinary } from '../src/binary.js';
import { fakeBundle } from './support/tmp.js';

describe('readBinary (decision 69: pinned build; version.json names it build)', () => {
  it('reads version and build from the bundle\'s own version.json', () => {
    const b = fakeBundle({ version: '152.0.4', build: 'beta.28' });
    expect(readBinary(b.executable, '152.0.4-beta.28')).toMatchObject({ build: '152.0.4-beta.28', ffMajor: 152, propertiesJson: b.properties });
  });
  it('accepts the release spelling when build is absent', () => {
    const b = fakeBundle({ version: '152.0.4', release: 'beta.28' });
    expect(readBinary(b.executable, '152.0.4-beta.28').build).toBe('152.0.4-beta.28');
  });
  it.each([
    ['another build', { version: '152.0.4', build: 'beta.29' }, /CAMOUFOX_BINARY_BUILD/],
    ['no build or release', { version: '152.0.4' }, /version\.json/],
    ['a non-numeric major', { version: 'x.0', build: 'beta.28' }, /version\.json/],
  ])('refuses %s', (_n, json, re) => {
    expect(() => readBinary(fakeBundle(json).executable, '152.0.4-beta.28')).toThrow(re);
  });
  it('refuses when no properties.json can be found in the bundle', () => {
    expect(() => readBinary(fakeBundle({ version: '152.0.4', build: 'beta.28' }, { properties: false }).executable, '152.0.4-beta.28')).toThrow(/properties\.json/);
  });
});
```

`test/launch.test.ts`:

```ts
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLaunchOptions, ensureShim } from '../src/launch.js';
import { fakeBundle, tmpDir } from './support/tmp.js';

describe('buildLaunchOptions (spec §2 limits; library notes §7)', () => {
  const opts = buildLaunchOptions({ shimPath: '/x/camoufox-bin', ffMajor: 152, os: 'macos', home: '/Users/op', path: '/usr/bin', tmp: '/tmp' });
  it('is headless, English, with the pinned Firefox major and no version-file read', () => {
    expect(opts).toMatchObject({ headless: true, locale: 'en-GB', ff_version: 152, i_know_what_im_doing: true, executable_path: '/x/camoufox-bin', os: 'macos' });
  });
  it('fetches nothing and disguises nothing beyond Camoufox itself: no add-on, no geoip, no proxy, no humanise', () => {
    expect(opts.exclude_addons).toEqual(['UBO']);
    expect(opts.geoip).toBe(false);
    expect('proxy' in opts).toBe(false);
    expect('humanize' in opts).toBe(false);
    expect('fingerprint' in opts).toBe(false);
  });
  it('passes a minimal environment, never the worker\'s own variables', () => {
    expect(opts.env).toEqual({ HOME: '/Users/op', PATH: '/usr/bin', TMPDIR: '/tmp', LANG: 'en_GB.UTF-8' });
  });
  it('leaves shutdown to the worker', () => {
    expect([opts.handleSIGTERM, opts.handleSIGINT, opts.handleSIGHUP]).toEqual([false, false, false]);
  });
});

describe('ensureShim (camoufox-js reads properties.json beside executable_path)', () => {
  it('links the binary and properties.json side by side in the data directory', () => {
    const b = fakeBundle({ version: '152.0.4', build: 'beta.28' });
    const shim = ensureShim(tmpDir(), b.executable, b.properties);
    expect(lstatSync(shim).isSymbolicLink()).toBe(true);
    expect(readlinkSync(shim)).toBe(realpathSync(b.executable));
    expect(realpathSync(join(shim, '..', 'properties.json'))).toBe(realpathSync(b.properties));
  });
});
```

`test/lock.test.ts`: one worker per data directory (devops-006): a second `acquireLock(dir)` throws naming the holder's
pid; a lock whose pid is not alive is taken over; `release()` removes it; `record.ts` refuses while the lock is held.

`test/guard.test.ts` over the pure `decideRoute(url, isNavigation)`: `/travel/flights` and `/travel/flights/search`
on `https://www.google.com` → `continue`; `/travel/flightsevil`, `http:`, `/search`, `consent.google.com`,
`accounts.google.com`, any other host → `abort` with the kind it implies (`off-allowlist`, `consent-unhandled`,
`sign-in`); a subresource (not a navigation) to any host → `continue`.

`test/aria.test.ts` over `parseAria(yaml)`: nesting by indentation; `- role "name" [selected]` and `[checked]`;
`- text: …` nodes; a quoted name with escaped quotes; a `/value: …` child as `value`; an unparsable line throws
`AriaUnreadable` (the session maps it to `unrecognised`).

`test/record.test.ts` over a fake driver and a temp directory (TS-05), one `it` each: writes `<n>-<kind>.snapshot.json`
and a meta of `{ recordedAt, recordedBy: 'camoufox-worker record', url, kind, request, versions, stepMs, contentSha256 }`
(SEC-015: a fixed tool id, no user name); refuses and writes nothing when the snapshot holds the worker key, a `SOCS`
value, a "Google Account:" name or any node name matching an e-mail address; on a blocked page writes nothing, prints
the cool-down end and exits 69; refuses `--pages` above 3; refuses while the worker's lock is held; `--consent-probe`
opens a throwaway profile under `<data>/probe-<random>`, sets no `SOCS`, never clicks, and deletes the profile on every
path, a thrown error included; `--socs-probe` sets the captured `SOCS` in a throwaway profile, loads three pages 30 s
apart and records the read-back each time; `--cheapest` is the only path that clicks the Cheapest tab before
`CHEAPEST_FLOW_VERIFIED`, and `--view-more` the only one that clicks "View more flights" before
`VIEW_MORE_ADDS_CHEAPER`; `mode: 'grid'` is reachable only through `--grid` and never from the server.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/camoufox-worker exec vitest run`
Expected: FAIL, the source modules do not exist.

- [ ] **Step 3: Implement**

`src/aria.ts`:

```ts
export interface AxNode { role: string; name: string; selected?: boolean; checked?: boolean; value?: string; children: AxNode[] }
export interface Snapshot { url: string; frameUrls: string[]; tree: AxNode }
export class AriaUnreadable extends Error {}

/** Depth-first walk. */
export function* walk(n: AxNode): Generator<AxNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}
/** Every node with one of these roles whose name matches (exact string or pattern). */
export function find(t: AxNode, role: string | readonly string[], name: string | RegExp): AxNode[] {
  const roles = typeof role === 'string' ? [role] : role;
  return [...walk(t)].filter((x) => roles.includes(x.role) && (typeof name === 'string' ? x.name === name : name.test(x.name)));
}
/**
 * Parses Playwright's aria-snapshot YAML (`- role "name" [attr]:` lines nested by two-space indentation, `- text: …`,
 * `/value: …`) into a tree under a synthetic `document` root. Throws AriaUnreadable on any line it cannot read: an
 * unread line could hide a challenge, so the session stops as `unrecognised` rather than guessing.
 */
export function parseAria(yaml: string, rootName = ''): AxNode { /* line grammar above; full implementation in this task */ }
```

(`parseAria`'s body is the line grammar stated in its comment; it is pure, and `aria.test.ts` pins every form. The YAML
form is Playwright's documented aria-snapshot output, read from `Locator.ariaSnapshot()` in 1.59.1.)

`src/selectors.ts`: the brief §9 rules and flags, with `SELECTORS_VERSION = '2026-10-18-results'`.

`src/classify.ts`:

```ts
import { find, type Snapshot, walk } from './aria.js';
import type { BlockedPage } from '@gmt/core';
import { SELECTORS as S } from './selectors.js';

export type PageKind = { kind: 'results' } | { kind: 'no-flights' } | { kind: 'blocked'; page: BlockedPage };

function urlOf(s: string): URL | null {
  try { return new URL(s); } catch { return null; }
}
/** Spec §2, brief §9: blocked kinds first, total over any input; anything not positively recognised is `unrecognised`. */
export function classifyPage(s: Snapshot): PageKind {
  const url = urlOf(s.url);
  const nodes = [...walk(s.tree)];
  const frameCaptcha = s.frameUrls.some((f) => { const u = urlOf(f); return u !== null && u.hostname === S.hosts.results && u.pathname.startsWith(S.blocked.captchaPath); });
  if (frameCaptcha || nodes.some((x) => (x.role === 'iframe' && S.blocked.captchaFrameName.test(x.name)) || (x.role === 'checkbox' && S.blocked.captchaName.test(x.name))))
    return { kind: 'blocked', page: 'captcha' };
  if (url === null) return { kind: 'blocked', page: 'off-allowlist' };
  if (url.pathname.startsWith(S.blocked.sorryPathPrefix) || nodes.some((x) => S.blocked.unusualTraffic.test(x.name))) return { kind: 'blocked', page: 'unusual-traffic' };
  if (find(s.tree, ['button', 'link'], S.blocked.accountControl).length > 0) return { kind: 'blocked', page: 'signed-in' };
  if (url.hostname === S.hosts.consent || find(s.tree, 'heading', S.consent.heading).length > 0) return { kind: 'blocked', page: 'consent-unhandled' };
  if (url.hostname === S.hosts.signIn || find(s.tree, 'heading', S.blocked.signInHeading).length > 0) return { kind: 'blocked', page: 'sign-in' };
  const onResults = url.protocol === 'https:' && url.hostname === S.hosts.results && (url.pathname === S.resultsPath || url.pathname.startsWith(`${S.resultsPath}/`));
  if (!onResults) return { kind: 'blocked', page: 'off-allowlist' };
  if (S.NO_FLIGHTS_VERIFIED && nodes.some((x) => S.results.noFlights.test(x.name))) return { kind: 'no-flights' };
  const tablists = find(s.tree, 'tablist', /.*/).filter((t) => find(t, 'tab', S.results.cheapestTab).length > 0);
  const cheapest = find(s.tree, 'tab', S.results.cheapestTab);
  if (tablists.length === 1 && cheapest.length === 1 && find(s.tree, 'button', S.results.dateGridButton).length === 1 && find(s.tree, 'link', S.results.optionLink).length > 0)
    return { kind: 'results' };
  return { kind: 'blocked', page: 'unrecognised' };
}
```

`src/cooldown.ts`: as the test pins: `CooldownStore({ dir, botHours, clock })`, `active(): { until, cause } | null`,
`start(cause): IsoDateTime` (`unrecognised` → 1 h, any other `BlockedPage` → `botHours`; never shortens the current
end, keeping the longer cause), records written atomically (temp file, rename, mode 0600), unreadable records fail
closed to a bot-length cool-down from now with cause `unrecognised`, any read error but ENOENT thrown.

`src/binary.ts`: `readBinary(executable, pinnedBuild)` per §7: realpath; up to four parents searched for exactly one
`version.json`; `build ?? release`; `<version>-<build>` compared with the pin (error names `CAMOUFOX_BINARY_BUILD`);
`ffMajor` from the version's first component; `propertiesJson` found at `Contents/Resources/properties.json` beside a
macOS binary or beside the binary elsewhere; never reads the `camoufox-js` install directory.

`src/launch.ts`: `ensureShim(dataDir, executable, properties)` (the `<data>/shim/<sha16>/` symlink pair, recreated
when stale) and `buildLaunchOptions({...})` exactly as the test pins; `launchContext(o)` calls
`Camoufox({ ...buildLaunchOptions(o), user_data_dir: <data>/profile })` and returns the `BrowserContext`, after checking
`camoufox-js`'s own `package.json` version is `0.11.5` (read with `createRequire(import.meta.url).resolve`).

`src/guard.ts`: `decideRoute` as pinned, and `installGuard(context, log)` wiring it to `context.route('**/*', …)` with
`route.abort('blockedbyclient')` or `route.fallback()`.

`src/driver.ts`: the narrow page driver the session uses (`open(url)`, `snapshot()` (body `ariaSnapshot()` through
`parseAria`, `page.url()`, `page.frames()`), `click(role, name)` by `getByRole(role, { name, exact: true })`, `close()`),
each call bounded by the page deadline's `AbortSignal`; `test/support/fakeDriver.ts` is its scripted double (queues of
snapshots, failures and never-resolving calls on demand).

`src/record.ts`: the recorder as `record.test.ts` pins it. `.gitignore`:

```gitignore
# why: recorded Google page snapshots are vendor content and never enter git (plan decisions 61, 68, 69)
apps/camoufox-worker/fixtures/recorded/**
!apps/camoufox-worker/fixtures/recorded/.gitkeep
```

`test/recorded.test.ts` (decision 61; TS-04, TS-13): imports `recordingsPresent`, `skipTitle` from
`@gmt/providers/testing` (the worker's devDependency, decision 69); one `describe` per recording kind (`results`,
`cheapest`, `form`, `consent-probe`, `socs-probe`, `no-flights`, `view-more`), each gated on recordings **of its own
kind** with its own skip title, each asserting `length > 0` before its loop; snapshots and metas parsed with zod schemas
(no casts, arch-005); asserting, per kind: the recording hashes to its `contentSha256`; no "Google Account:" node and no
e-mail address; `results` classify as `results` and every option names the queried airports (prov-006); `consent-probe`
classifies as `consent-unhandled`; `socs-probe`'s three read-backs equal the captured value (else `SOCS_STABLE` must be
false); each verified flag in `selectors.ts` is true only if a recording of its kind exists and passes. One unconditional
test asserts that every flag that is true names, in `selectors.ts`, the recording date that proved it, no older than
`SELECTORS_VERSION` (TS-13).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/camoufox-worker exec vitest run`; PASS, no skipped
tests except the recorded kinds not yet present (each reported with its decision-61 suffix) and the root-only EACCES
case.

- [ ] **Step 5: The operator records.** On the operator's machine, with the worker's env file in place (Task 14.5's
`worker.env`; for this step only `CAMOUFOX_EXECUTABLE` and `CAMOUFOX_DATA_DIR` are needed):

```bash
pnpm install
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --pages 1
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --pages 1 --cheapest
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --pages 1 --view-more
pnpm --filter @gmt/camoufox-worker record --consent-probe
pnpm --filter @gmt/camoufox-worker record --socs-probe          # after Task 14.3's capture-socs
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart <a date with no service> --return <date> --pages 1
```

Every run honours the spacing, the allowlist and the hard stop; a blocked page records nothing and starts the
cool-down. The implementer then writes `selectors.ts` (the search form's roles and names, the Cheapest flow, the
no-flights line) from the recordings, and flips each flag only where its recording proves it, listing every rule that
changed in the commit message. If the Best page alone already lists the cheapest option, `CHEAPEST_FLOW_VERIFIED`
stays false and the worker never clicks.

- [ ] **Step 6: Commit** — `git commit -m "wp14: worker scaffold, launch, classifier, cool-down and recorder; selectors dated <date>"`

### Task 14.2: The result-name grammar, airports, the search form, readiness and the list reader

**Files:** create `src/{names.ts,airports.ts,form.ts,ready.ts,list.ts,pointOfSale.ts}` and their tests.

**Interfaces:** `parseOptionName(name): ParsedOption | null` (`{ amountMinor; stops; carriers; departsOn: { month; day
}; from: string; to: string; interstitials: string[]; durationMinutes }`); `airportMatches(googleName, datasetNames):
boolean`; `checkForm(snap, req): 'ok' | 'mismatch' | 'absent'`; `isSettled(snap): boolean`; `readList(snap, req):
ListRead` (`{ minMinor: number | null; tabMinor: number | null; optionsUnparsed; optionsOtherCell; resultsStated:
number | null; resultsSeen: number; currency: string | null; pointOfSale: string }`); `pointOfSaleOf(locationName)`.

Rules (spec §2; PIE-10, PIE-15, prov-004, prov-005, prov-006, prov-011):

- The grammar is a strict whole-name match, dated (`GRAMMAR_VERSION`). Between the price clause and the stops clause
  it allows only the interstitial sentences listed in `names.ts`, each added from a recording with its date (none
  until Task 14.1 records one); which applied is returned.
- An option counts for the cell only when its departure date (month and day) is the cell's and its "Leaves" and
  "arrives at" airports match the cell's origin and destination through `airportMatches` against the names the engine
  sends (`PageRequest.airportNames`, from the airports dataset): case and punctuation folded, then equal, or one a
  word-suffix of the other ("Heathrow Airport" ⊂ "London Heathrow Airport"), or listed in the dated alias table in
  `selectors.ts` (added only from a recording). Other options count as `optionsOtherCell`; unparsed ones as
  `optionsUnparsed`.
- The search form (`form.ts`) must show round trip, one passenger, and departure and return dates equal to the query
  (day and month; the year from the query, refusing an ambiguous match); `mismatch` → `unrecognised`; `absent` →
  `unrecognised` (decision 69).
- `isSettled` per brief §9.
- `pointOfSaleOf` maps the stated location through a dated table (`United Kingdom` → `GB`, `United States` → `US`, and
  only names a recording has shown), else the name is unknown → `'unknown'`; the stored value is what the page stated,
  so a page that ignored `gl` never passes for the requested market.
- The cell's minimum is over options for the cell only; `tabMinor` is the Cheapest tab's price.

- [ ] **Step 1: Write the failing tests** — `names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GRAMMAR_VERSION, parseOptionName } from '../src/names.js';

// The feasibility load's one-stop option name of 2026-10-18, verbatim (brief introduction).
const ONE_STOP = 'From 478 British pounds round trip total. 1 stop flight with Tap Air Portugal. Leaves Heathrow Airport at 12:25 on Thursday, November 5 and arrives at John F. Kennedy International Airport at 20:05 on Thursday, November 5. Total duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Select flight';

describe('parseOptionName (dated grammar)', () => {
  it('parses the feasibility one-stop name, airports included', () => {
    expect(parseOptionName(ONE_STOP)).toEqual({ amountMinor: 47800, stops: 1, carriers: 'Tap Air Portugal', departsOn: { month: 11, day: 5 },
      from: 'Heathrow Airport', to: 'John F. Kennedy International Airport', interstitials: [], durationMinutes: 760 });
  });
  it('thousands separators are exact', () => {
    expect(parseOptionName(ONE_STOP.replace('From 478', 'From 1,204'))?.amountMinor).toBe(120400);
  });
  it.each([
    ['a decimal price', ONE_STOP.replace('From 478', 'From 478.50')],
    ['another currency phrase', ONE_STOP.replace('British pounds', 'US dollars')],
    ['no round-trip clause', ONE_STOP.replace(' round trip total', '')],
    ['a missing duration', ONE_STOP.replace(/ Total duration [^.]*\./, '')],
    ['an unknown month', ONE_STOP.replaceAll('November', 'Novembre')],
    ['an unlisted interstitial sentence', ONE_STOP.replace('total. 1 stop', 'total. This price does not include overhead bin access. 1 stop')],
    ['an empty name', ''],
  ])('%s → null, never partly read', (_n, name) => {
    expect(parseOptionName(name)).toBeNull();
  });
  it('is dated', () => {
    expect(GRAMMAR_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
```

`list.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { readList } from '../src/list.js';
import { n, option, resultsTree } from './support/trees.js';

const REQ = { mode: 'list' as const, origin: asIata('LHR'), destination: asIata('JFK'), gl: 'GB',
  departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15'),
  airportNames: { origin: ['London Heathrow Airport'], destination: ['John F Kennedy International Airport'] } };

describe('readList (spec §2 list mode)', () => {
  it('takes the minimum over every result link for this cell, with the tab price, currency and point of sale', () => {
    const r = readList(resultsTree({ top: [option(478), option(534)], other: [option(451)] }), REQ);
    expect(r).toMatchObject({ minMinor: 45100, tabMinor: 45100, optionsUnparsed: 0, optionsOtherCell: 0, resultsStated: 3, resultsSeen: 3, currency: 'GBP', pointOfSale: 'GB' });
  });
  it('an unparsed name is counted as unparsed', () => {
    expect(readList(resultsTree({ top: [option(478), n('listitem', '', [n('link', 'Reworded by Google')])] }), REQ)).toMatchObject({ minMinor: 45100, optionsUnparsed: 1 });
  });
  it('another day or another airport is counted as another cell, never priced here', () => {
    const r = readList(resultsTree({ top: [option(300, { leaves: 'Friday, November 6' }), option(310, { to: 'Newark Liberty International Airport' })], other: [option(451)] }), REQ);
    expect(r).toMatchObject({ minMinor: 45100, optionsOtherCell: 2, optionsUnparsed: 0 });
  });
  it('no option for this cell: minMinor null', () => {
    expect(readList(resultsTree({ top: [option(300, { leaves: 'Friday, November 6' })], other: [] }), REQ).minMinor).toBeNull();
  });
  it.each([
    ['United States', 'US'],
    ['Elsewhere', 'unknown'],
  ])('location %s → %s, stored as stated', (place, pos) => {
    const t = resultsTree();
    for (const c of t.tree.children) if (c.name.startsWith('Location·')) c.name = `Location·${place}`;
    expect(readList(t, REQ).pointOfSale).toBe(pos);
  });
  it('no currency control: currency null', () => {
    const t = resultsTree();
    t.tree.children = t.tree.children.filter((c) => c.name !== 'Currency GBP');
    expect(readList(t, REQ).currency).toBeNull();
  });
  it('sorts numerically', () => {
    expect(readList(resultsTree({ top: [option(1000), option(999)], other: [] }), REQ).minMinor).toBe(99900);
  });
});
```

`airports.test.ts`: "Heathrow Airport" matches "London Heathrow Airport"; "John F. Kennedy International Airport"
matches "John F Kennedy International Airport"; "Newark Liberty International Airport" does not match JFK's names; an
alias listed in `selectors.ts` matches; an empty dataset list never matches.

`form.test.ts`: `ok` for the default `formNodes()`; `mismatch` for "One way", "2 passengers", a departure of "Fri, 6 Nov",
a return of "Mon, 16 Nov"; `absent` when the four controls are missing; an ambiguous day-and-month across a year is
`mismatch`. (The control names are the brief's hypothesis; Task 14.1's recording replaces them, and these tests move with
it.)

`ready.test.ts`: `resultsTree()` is settled; `loadingTree()` ("Fetching results") is not; a tree without the
"N results returned." line is not; a tab name without a price is not; zero result links is not.

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/names.test.ts test/list.test.ts test/airports.test.ts test/form.test.ts test/ready.test.ts`; FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/names.ts`:

```ts
/**
 * The grammar of one result's accessible name (spec §2), dated like the selectors. A strict whole-name match drops
 * anything Google rewords instead of misreading it; interstitial sentences between the price and the stops are allowed
 * only from INTERSTITIALS, each added from a recording with its date (PIE-10).
 */
export const GRAMMAR_VERSION = '2026-10-18-feasibility';
export const INTERSTITIALS: ReadonlyArray<{ sentence: string; recorded: string }> = [];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inter = INTERSTITIALS.length === 0 ? '' : `((?: (?:${INTERSTITIALS.map((i) => esc(i.sentence)).join('|')}))*)`;
const NAME = new RegExp(
  `^From ([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+) British pounds round trip total\\.${inter} ` +
    '(Non-stop|([0-9]+) stops?) flight with (.+?)\\. ' +
    'Leaves (.+?) at ([0-9]{1,2}:[0-9]{2}) on [A-Z][a-z]+, ([A-Z][a-z]+) ([0-9]{1,2}) ' +
    'and arrives at (.+?) at ([0-9]{1,2}:[0-9]{2}) on [A-Z][a-z]+, [A-Z][a-z]+ [0-9]{1,2}\\. ' +
    'Total duration (?:([0-9]+) hrs?)? ?(?:([0-9]+) min)?\\.(?: .*)? ?Select flight$',
);

export interface ParsedOption { amountMinor: number; stops: number; carriers: string; departsOn: { month: number; day: number }; from: string; to: string; interstitials: string[]; durationMinutes: number }

/** Whole-name parse or null; never a partial read. Exact digits, no float. */
export function parseOptionName(name: string): ParsedOption | null {
  const m = NAME.exec(name);
  if (m === null) return null;
  const g = [...m];
  const off = inter === '' ? 0 : 1;
  const [pounds = '', interText = ''] = [g[1], off === 1 ? g[2] : ''];
  const stopWord = g[2 + off] ?? '';
  const stopN = g[3 + off];
  const carriers = g[4 + off] ?? '';
  const from = g[5 + off] ?? '';
  const monthName = g[7 + off] ?? '';
  const day = g[8 + off] ?? '';
  const to = g[9 + off] ?? '';
  const hrs = g[11 + off];
  const mins = g[12 + off];
  const month = MONTHS.indexOf(monthName) + 1;
  if (month === 0 || (hrs === undefined && mins === undefined)) return null;
  return {
    amountMinor: Number(`${pounds.replaceAll(',', '')}00`),
    stops: stopWord === 'Non-stop' ? 0 : Number(stopN),
    carriers, from, to,
    departsOn: { month, day: Number(day) },
    interstitials: interText.split('. ').map((x) => x.trim()).filter((x) => x !== ''),
    durationMinutes: Number(hrs ?? 0) * 60 + Number(mins ?? 0),
  };
}
```

`src/list.ts`, `src/airports.ts`, `src/form.ts`, `src/ready.ts`, `src/pointOfSale.ts`: as the tests and rules pin, over
`aria.ts`'s `find`/`walk`; `readList` sorts with `(a, b) => a - b` (TS-19).

- [ ] **Step 4: Run** — PASS, no skipped tests.

- [ ] **Step 5: Commit** — `git commit -am "wp14: result grammar, airport and form checks, readiness and the list reader"`

### Task 14.3: Consent: the captured SOCS rejection, set before every page, read back on every path

**Files:** create `src/socs.ts`, `src/captureSocs.ts`, `test/socs.test.ts`, `test/captureSocs.test.ts`.

**Interfaces:** `SOCS_NAME = 'SOCS'`; `SocsCapture = { value; domain: '.google.com'; path: '/'; expires: number;
secure: true; sameSite: 'Lax' | 'Strict' | 'None'; capturedAt: IsoDateTime }`; `loadSocs(dataDir, clock): SocsCapture`
(throws `ConsentNotCaptured`); `writeCapture(dataDir, input, clock)`; `socsCookie(capture)` (the Playwright cookie
object); `readBack(cookies, capture): 'same' | 'changed' | 'missing'`.

Rules: the file is `<data>/socs.json`, mode 0600 in a 0700 directory; `loadSocs` refuses a missing, malformed, group-
or world-readable file, a domain other than `.google.com`, a path other than `/`, an empty value, a `capturedAt` older
than 13 months or in the future (devops-010, TS-18); `capture-socs` reads the value, expiry, secure and sameSite from
stdin as the browser's cookie view shows them, stamps `capturedAt` from the clock, creates the directory 0700 and writes
the file 0600; while `SOCS_STABLE` is false the read-back compares presence only and the status route says so
(`socsReadBackExact: false`); once Task 14.1's `--socs-probe` recording proves stability it compares the exact value
(PIE-12).

- [ ] **Step 1: Write the failing test** — `socs.test.ts`:

```ts
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ConsentNotCaptured, loadSocs, readBack, SOCS_NAME, socsCookie } from '../src/socs.js';
import { tmpDir } from './support/tmp.js';

const clock = fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z'));
// A synthetic value: the real one is captured by the operator and never enters git.
const OK = { value: 'synthetic-socs-rejection-value', domain: '.google.com', path: '/', expires: 1_800_000_000, secure: true, sameSite: 'Lax', capturedAt: '2026-10-18T04:00:00.000Z' };
function dirWith(content: string | null, mode = 0o600): string {
  const d = tmpDir();
  if (content !== null) { writeFileSync(join(d, 'socs.json'), content); chmodSync(join(d, 'socs.json'), mode); }
  return d;
}

describe('loadSocs (spec §2: a captured, dated rejection value)', () => {
  it('loads a capture', () => {
    expect(loadSocs(dirWith(JSON.stringify(OK)), clock)).toEqual(OK);
  });
  it.each([
    ['missing', null, 0o600],
    ['malformed', '{not json', 0o600],
    ['group-readable', JSON.stringify(OK), 0o640],
    ['another domain', JSON.stringify({ ...OK, domain: '.example.test' }), 0o600],
    ['another path', JSON.stringify({ ...OK, path: '/travel' }), 0o600],
    ['an empty value', JSON.stringify({ ...OK, value: '' }), 0o600],
    ['a missing field', JSON.stringify({ ...OK, sameSite: undefined }), 0o600],
    ['older than 13 months', JSON.stringify({ ...OK, capturedAt: '2025-09-17T05:00:00.000Z' }), 0o600],
    ['in the future', JSON.stringify({ ...OK, capturedAt: '2026-10-19T05:00:00.000Z' }), 0o600],
  ])('%s refuses, saying how to capture it', (_n, content, mode) => {
    expect(() => loadSocs(dirWith(content, mode), clock)).toThrow(ConsentNotCaptured);
    expect(() => loadSocs(dirWith(content, mode), clock)).toThrow(/capture-socs/);
  });
  it('accepts exactly 13 months old', () => {
    expect(loadSocs(dirWith(JSON.stringify({ ...OK, capturedAt: '2025-09-18T05:00:00.000Z' })), clock).capturedAt).toBe('2025-09-18T05:00:00.000Z');
  });
  it('the cookie set is SOCS with the captured attributes, nothing else', () => {
    expect(socsCookie(loadSocs(dirWith(JSON.stringify(OK)), clock))).toEqual({ name: SOCS_NAME, value: OK.value, domain: '.google.com', path: '/', expires: OK.expires, secure: true, sameSite: 'Lax', httpOnly: false });
  });
  it.each([
    ['same', [{ name: 'SOCS', value: OK.value, domain: '.google.com' }], 'same'],
    ['changed', [{ name: 'SOCS', value: 'an-accept-value', domain: '.google.com' }], 'changed'],
    ['missing', [{ name: 'NID', value: 'x', domain: '.google.com' }], 'missing'],
  ])('readBack: %s', (_n, cookies, expected) => {
    expect(readBack(cookies, loadSocs(dirWith(JSON.stringify(OK)), clock))).toBe(expected);
  });
});
```

`captureSocs.test.ts`: from stdin JSON `{ value, expires, secure, sameSite }` it writes a 0600 file in a 0700 directory
with `capturedAt` from the clock and domain and path fixed; it refuses an empty value, `secure: false`, or a directory
that exists with a looser mode (naming `chmod 700`); it prints no value.

- [ ] **Step 2: Run** — FAIL, modules not found.

- [ ] **Step 3: Implement** `socs.ts` and `captureSocs.ts` as pinned. The month arithmetic is calendar months on the UTC
date (13 months back from now, inclusive), never a fixed day count (TS-18).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: SOCS capture, load and read-back"`

### Task 14.4: The pacer, the signed-in refusal and the page session (deadlines, every path, every error)

**Files:** create `src/pacer.ts`, `src/refusal.ts`, `src/url.ts`, `src/session.ts` and their tests.

**Interfaces:** `Pacer({ dir, minSpacingSeconds, clock })` with `claim()`, `release()` (start to start, persisted
`lastPageAt`, fail closed); `Refusal({ dir })` with `active()`, `set(reason)`, `clear()` (the persisted signed-in
flag); `pageUrl(req)`; `PageSession({ context, driver, socs, cooldown, pacer, refusal, clock, pageTimeoutMs, log })`
with `page(req): Promise<{ answer: WorkerAnswer; googleContacted: boolean }>`.

Rules (spec §2; decision 69 rulings 1, 2, 4, 9; cost-007, cost-008, devops-006, devops-007, devops-011, arch-006,
TS-09, TS-10):

1. `mode: 'grid'` → `mode-unavailable`, nothing opened.
2. A standing signed-in refusal → `cooling-down` (cause `signed-in`); an active cool-down → `cooling-down`. Nothing
   opened, `googleContacted: false`.
3. `pacer.claim()`: busy or within the spacing (start to start, from the persisted `lastPageAt`) → `spacing`.
4. Inside a `try` whose `finally` releases the pacer first, unconditionally, then closes the page best-effort (an error
   logged, never thrown): set `SOCS` (`context.addCookies([socsCookie])`); check no account cookie in
   `context.cookies('https://www.google.com')` (→ `signed-in`); open the URL under the page deadline; poll snapshots
   every 2 s, classifying blocked kinds each time, until `isSettled` or the deadline (→ `not-ready`); `checkForm`
   (→ `unrecognised` on `mismatch` or `absent`); click only verified names (none until a flag flips); `readList`;
   `currency !== 'GBP'` or `minMinor === null` with no other-cell options → `unrecognised`; a `no-flights` page →
   `cells` with `{ status: 'no-flights' }`.
5. **On every path after the page was opened, success and failure alike, read `SOCS` back** (TS-10): `changed` (or,
   once `SOCS_STABLE`, anything but `same`; before it, `missing`) turns the answer into `blocked` `consent-unhandled`
   whatever it was, and the stop wipes the profile (close the context, remove `<data>/profile`, relaunch lazily).
6. A stop records its cause in the cool-down store (`unrecognised` 1 h, the rest `botHours`); `signed-in` also sets
   the persisted refusal, cleared only by `clear-signed-in`, which first wipes the profile.
7. Every thrown error maps to one answer: the deadline → `not-ready`; `AriaUnreadable` → `blocked` `unrecognised`; a
   Playwright error before navigation → `browser-error` `launch` (Google not contacted); during navigation →
   `browser-error` `navigate`; after → `browser-error` `read`; a cool-down store read error → `browser-error` `read` and
   the process exits 70 after answering (the operator must look). Each has a test.
8. `googleContacted` is true once `open` was called.

- [ ] **Step 1: Write the failing tests** — `pacer.test.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2026-10-18T05:00:00.000Z');
describe('Pacer (spec §2: start to start, persisted, never randomised)', () => {
  it('refuses spacing below 30 seconds', () => {
    expect(() => new Pacer({ dir: tmpDir(), minSpacingSeconds: 29, clock: fixedClock(T0) })).toThrow(/CAMOUFOX_MIN_SPACING_SECONDS/);
  });
  it('spacing runs from the start of the previous page', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    expect(p.claim()).toEqual({ ok: true });
    clock.advance(20_000); p.release();
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 10 });
    clock.advance(10_000);
    expect(p.claim()).toEqual({ ok: true });
  });
  it('a second claim while busy is refused', () => {
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock: fixedClock(T0) });
    p.claim();
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 30 });
  });
  it('a restart inside the spacing keeps it (lastPageAt persisted)', () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock });
    p.claim(); p.release();
    clock.advance(10_000);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).claim()).toEqual({ ok: false, retryAfterSeconds: 20 });
  });
  it('a corrupt record fails closed: the last page is treated as now', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), '{not json');
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) }).claim()).toEqual({ ok: false, retryAfterSeconds: 30 });
  });
  it('N claims with realistic page times give N pages and no refusal when the app also spaces start to start', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    let refused = 0;
    for (let i = 0; i < 10; i++) { if (!p.claim().ok) refused++; clock.advance(12_000); p.release(); clock.advance(18_000); }
    expect(refused).toBe(0);
  });
});
```

`session.test.ts` (over `fakeDriver.ts` and a fake context whose `cookies()`/`addCookies()` are scripted), one `it`
each, all asserting the answer, `googleContacted`, the pacer released (a following `claim()` after the spacing succeeds)
and the page closed:

- a settled results page → `cells` with `{ status: 'price', amountMinor: 45100, tabMinor: 45100, optionsUnparsed: 0,
  optionsOtherCell: 0, returnDateFrom: 'query-and-form' }`, `SOCS` set before `open`, read back after;
- two successful pages, each preceded by `addCookies` with `SOCS` (TS-10);
- a CAPTCHA frame → `blocked` `captcha`, cool-down 48 h, no click; the same with `SOCS` changed → still `captcha`'s
  cool-down cause kept, profile wiped (TS-10);
- `SOCS` changed after a settled page → `blocked` `consent-unhandled`, profile wiped, no `cells`;
- `SOCS` missing after a page, before `SOCS_STABLE` → `consent-unhandled`;
- the consent page → `consent-unhandled`, nothing clicked, profile wiped;
- an aborted navigation to `accounts.google.com` → `sign-in`;
- a signed-in control → `signed-in`, the refusal persisted, a new `PageSession` over the same directory answers
  `cooling-down` (cause `signed-in`) without opening;
- an account cookie (`SID`) in the context before the page → `signed-in`, nothing opened;
- a loading tree until the deadline → `not-ready`, no cool-down, `googleContacted: true`;
- a form mismatch → `blocked` `unrecognised`, cool-down 1 h;
- a never-resolving `snapshot()` → `not-ready` at the deadline, pacer released (cost-007);
- `close()` throws after a block → the block answer stands, the pacer is released (arch-006);
- `open()` throws before navigation → `browser-error` `launch`, `googleContacted: false`;
- `parseAria` throws → `blocked` `unrecognised`;
- `mode: 'grid'` → `mode-unavailable`, nothing opened; a test asserts `GRID_VERIFIED` is false and that the config
  schema refuses `CAMOUFOX_MODE=grid` (decision 69 ruling 7);
- a request inside the spacing → `spacing`, nothing opened, `googleContacted: false`.

`url.test.ts`: the feasibility form (`on <departure> returning <return>`), exactly the keys `q`, `curr`, `hl`, `gl`;
never `tfs`.

- [ ] **Step 2: Run** — FAIL, modules not found.

- [ ] **Step 3: Implement** the four modules as the rules and tests pin. `PageSession.page` is one function with the
`try`/`finally` structure of rule 4; the deadline is one `AbortSignal.timeout(pageTimeoutMs)` threaded through every
driver call.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: start-to-start pacer, persisted refusal and the page session's every path"`

### Task 14.5: The worker's HTTP server, config, env file, bind rule, lock and status

**Files:** create `src/{config.ts,envFile.ts,server.ts,main.ts,clearSignedIn.ts}`,
`launchd/uk.dominey.get-me-there.camoufox-worker.plist.example`, `test/{config,envFile,server,main}.test.ts`.

Rules (devops-004, devops-005, SEC-011, SEC-012, SEC-013, TS-06, TS-15):

- Settings come from `<data>/worker.env` (or `CAMOUFOX_ENV_FILE`), loaded by Node's `--env-file-if-exists`; `main.ts`
  refuses to start (exit 78) when that file or the data directory is group- or world-readable.
- `config.ts` refuses, naming the variable and never its value: `CAMOUFOX_WORKER_KEY` missing or shorter than 32;
  `CAMOUFOX_EXECUTABLE` missing or not executable; `CAMOUFOX_WORKER_BIND` that is neither loopback (`127.0.0.1`, `::1`)
  nor an address `os.networkInterfaces()` assigns to an interface named `docker0` or `br-*`; `CAMOUFOX_WORKER_PORT`
  outside 1024–65535; spacing below 30 or above 600; cool-down below 24; page timeout outside 30–240.
- Start: `acquireLock`, `readBinary` (pin), `launchContext`, account-cookie check, `loadSocs`, unless the persisted
  refusal stands (then the server starts and answers `cooling-down` only); any failure exits 78 with one line naming
  the check. SIGTERM: stop accepting, let an in-flight page finish its `finally` (bounded by the page timeout), close
  the context, release the lock, exit 0.
- The server: the §6 table exactly; 4 KiB body limit; JSON content type required; the key compared in constant time;
  every answer sets `x-gmt-google-contacted`; one JSON log line per request (route, status, answer kind, duration),
  never the key, never a cookie, never a page name; `/v1/status` reports `busySince` while a page runs.

- [ ] **Step 1: Write the failing tests** — `server.test.ts`, one `it` per row of the §6 table (TS-15), including: 200
  `cells` with its body; 423 `blocked`; 423 `cooling-down`; 429 with `Retry-After`; 504 `not-ready`; 502
  `browser-error`; 409 for grid; 400 for an oversize body, for a wrong content type and for a schema failure (a list
  request with an invalid IATA code); 401 with no header, with a wrong key, with a key of another length, and on
  `/v1/status`; 404; `x-gmt-google-contacted` equal to the session's flag on each; and a log-capture test that the key
  never appears. The server is started on port 0 and its address narrowed with a guard, never a cast:

```ts
function portOf(server: import('node:http').Server): number {
  const a = server.address();
  if (a === null || typeof a === 'string') throw new Error('server not listening on TCP');
  return a.port;
}
```

`config.test.ts` (TS-06, SEC-012): one `it` per refused value listed above, each asserting the error names the variable
and not the value; `envFile.test.ts`: a 0644 env file and a 0755 data directory each refuse; `main.test.ts` (with a fake
launcher): a start-check failure exits 78; a held lock exits 78 naming the pid; SIGTERM during a page answers that page,
then exits 0 and releases the lock.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** The launchd example: `ProgramArguments` running `pnpm --filter @gmt/camoufox-worker start`
from the checkout, `KeepAlive` `{ SuccessfulExit: false }`, `ThrottleInterval` 60, `StandardOutPath` and
`StandardErrorPath` under `~/Library/Logs/get-me-there/`, no secrets in the plist (they stay in `worker.env`).

- [ ] **Step 4: Run** — PASS; then `pnpm --filter @gmt/camoufox-worker test` (the whole worker) passes with its floors.

- [ ] **Step 5: Commit** — `git commit -am "wp14: worker server, env file, bind rule, lock and status"`

### Task 14.6: Core: the widened unions, the protocol schemas, labels and the config block

**Files:** modify the core files of §8; create `packages/core/src/camoufox/protocol.ts`; tests beside each
(`test/types/provenance.camoufox.test.ts`, `test/camoufox/protocol.test.ts`, `test/config/camoufox.test.ts`,
`test/ports/budget.camoufox.test.ts`).

All core changes land in this one task, so each later task compiles on its own (arch-008): the unions, `BudgetScope`
with `provider-execution` and its label, `ProviderLimits.executionCallCap` and `pagesOnly`, `ExecutionBudget
.providerMaxCalls`, `Reservation.finalise`'s `pageClass`, `DiscoveryQuery.airportNames`, `DiscoveryCapability
.preflight`, `SkipReason` `provider_unavailable`, the protocol schemas, `SOURCE_LABELS['scraped-self']`, and the config
block. Every exhaustive switch the typecheck then names is fixed here with a `// why:` line and, where it has
behaviour, a test (for example `SECONDS_PER_CALL['scraped-self']`, Task 14.9, and the web reasons map, Task 14.10).

- [ ] **Step 1: Write the failing tests**

```ts
// test/types/provenance.camoufox.test.ts
import { describe, expect, it } from 'vitest';
import { providerIdSchema, sourceKindSchema } from '../../src/types/provenance.js';
import { SOURCE_LABELS } from '../../src/labels/source.js';
import { findBannedWords } from '../../src/text/bannedWords.js';

describe('camoufox in core (spec §5.1 rev 32)', () => {
  it('accepts the new ids and refuses unknown ones', () => {
    expect(providerIdSchema.parse('camoufox')).toBe('camoufox');
    expect(sourceKindSchema.parse('scraped-self')).toBe('scraped-self');
    expect(() => providerIdSchema.parse('browser')).toThrow();
    expect(() => providerIdSchema.parse('camofox')).toThrow();
  });
  it('labels the source in the §11 words, with no banned word', () => {
    expect(SOURCE_LABELS['scraped-self']).toBe('Google Flights prices via Camoufox');
    expect(findBannedWords(SOURCE_LABELS['scraped-self'])).toEqual([]);
  });
});
```

```ts
// test/ports/budget.camoufox.test.ts
import { describe, expect, it } from 'vitest';
import { budgetScopeLabel } from '../../src/ports/budget.js';

describe('provider-execution scope (spec §5.1)', () => {
  it('carries the execution and the provider, and labels by provider', () => {
    expect(budgetScopeLabel({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toBe('provider-execution:camoufox');
  });
});
```

```ts
// test/config/camoufox.test.ts, in schema.test.ts's own style (arch-004)
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/schema.js';

const realpath = (p: string) => p;
const minimal = { NODE_ENV: 'production', DATABASE_PATH: '/data/get-me-there.db', APP_BASIC_AUTH_USER: 'ian', APP_BASIC_AUTH_PASS: 'correct-horse-battery', IN_CONTAINER: '1' };
const ON = { ...minimal, CAMOUFOX_ENABLED: 'true', CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090', CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef' };
function ok(env: Record<string, string | undefined>) {
  const r = parseConfig(env, { realpath });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
function errors(env: Record<string, string | undefined>) {
  const r = parseConfig(env, { realpath });
  if (r.ok) throw new Error('expected failure');
  return r.errors.map((e) => e.field);
}

describe('CAMOUFOX_* (spec §12 rev 32)', () => {
  it('off by default: no camoufox provider', () => {
    expect(ok(minimal).providers.camoufox).toBeNull();
  });
  it('on, with every default and every ProviderLimits value stated', () => {
    const c = ok(ON).providers.camoufox;
    expect(c).toMatchObject({ workerUrl: 'http://host.docker.internal:8090', minSpacingSeconds: 30, executionPageCap: 100, cooldownHours: 48, pageTimeoutSeconds: 90 });
    expect(c?.limits).toEqual({ monthlyCallCap: 1500, window: 'month', billingDay: 1, ratePerMinute: 2, ratePerHour: 120, concurrency: 1, cacheTtlHours: 0,
      costPerCallMicroGbp: 0, planFixedMicroGbp: 0, excludedFromSchedule: false, executionCallCap: 100, pagesOnly: true });
  });
  it('a 45 s spacing gives 1 a minute and 80 an hour', () => {
    expect(ok({ ...ON, CAMOUFOX_MIN_SPACING_SECONDS: '45' }).providers.camoufox?.limits).toMatchObject({ ratePerMinute: 1, ratePerHour: 80 });
  });
  it.each([
    ['CAMOUFOX_MIN_SPACING_SECONDS', '29'],
    ['CAMOUFOX_EXECUTION_PAGE_CAP', '401'],
    ['CAMOUFOX_EXECUTION_PAGE_CAP', '0'],
    ['CAMOUFOX_COOLDOWN_HOURS', '23'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '29'],
    ['CAMOUFOX_WORKER_KEY', 'short'],
    ['CAMOUFOX_WORKER_URL', 'http://192.168.1.10:8090'],
    ['CAMOUFOX_WORKER_URL', 'https://worker.example.test'],
    ['CAMOUFOX_WORKER_URL', 'http://127.0.0.1'],
    ['CAMOUFOX_WORKER_URL', 'http://127.0.0.1:8090/path'],
    ['CAMOUFOX_WORKER_URL', 'http://user:pw@127.0.0.1:8090'],
    ['CAMOUFOX_MODE', 'grid'],
  ])('%s=%s fails boot naming the field', (name, value) => {
    expect(errors({ ...ON, [name]: value })).toContain(name);
  });
  it('enabled without a key or URL fails boot naming each', () => {
    expect(errors({ ...minimal, CAMOUFOX_ENABLED: 'true' })).toEqual(expect.arrayContaining(['CAMOUFOX_WORKER_KEY', 'CAMOUFOX_WORKER_URL']));
  });
  it.each(['http://127.0.0.1:8090', 'http://localhost:8090', 'http://[::1]:8090', 'https://127.0.0.1:8443', 'http://host.docker.internal:8090'])('accepts %s', (u) => {
    expect(ok({ ...ON, CAMOUFOX_WORKER_URL: u }).providers.camoufox?.workerUrl).toBe(u);
  });
});
```

`test/camoufox/protocol.test.ts`: every `WorkerAnswer` kind round-trips through `workerAnswerSchema`; an unknown kind
(`consent-rejected`) and an extra field are refused; `pageRequestSchema` refuses a list request whose dates are not one
cell, an invalid IATA code and a missing `airportNames`; `BlockedPage` lists exactly the seven kinds.

- [ ] **Step 2: Run** — `pnpm --filter @gmt/core exec vitest run test/types/provenance.camoufox.test.ts test/ports/budget.camoufox.test.ts test/config/camoufox.test.ts test/camoufox/protocol.test.ts`; FAIL.

- [ ] **Step 3: Implement** the changes listed; `CAMOUFOX_MODE` accepts only `list` (and is optional). The URL rule
is one function, `camoufoxWorkerUrlOk(s)`, exported for the egress test (arch-012).

- [ ] **Step 4: Run** — `pnpm --filter @gmt/core test`; PASS at core's 100% thresholds; `pnpm -r typecheck` clean after
the switch fixes.

- [ ] **Step 5: Commit** — `git commit -am "wp14: core gains camoufox, its errors, scopes, protocol and config"`

### Task 14.7: db: migration 0005, the camoufox budget entry, the snapshot page cap, and no-page rows

**Files:** create `packages/db/drizzle/0005_camoufox_provider.sql` and its snapshot; modify `src/internal/enums.ts`,
`src/budgetConfig.ts`, `src/budgetGuard.ts`, `src/schema/*.ts`; tests `test/migration0005.test.ts`,
`test/budgetGuard.providerExecution.test.ts`, `test/budgetConfig.camoufox.test.ts` (flat files, the package's layout;
arch-010).

Migration 0005 (one transaction, `PRAGMA foreign_keys` off around it, `PRAGMA foreign_key_check` after; the pre-migration
backup covers it): rebuilds `calendar_prices`, `cell_outcomes`, `fare_offers`, `price_observations`,
`provider_requests` and `route_price_history` with `provider_id` CHECKs adding `'camoufox'` and `source_kind` CHECKs
adding `'scraped-self'`; adds `provider_requests.page_class TEXT CHECK (page_class IS NULL OR page_class IN
('page','no-page'))`; creates `operator_notice_keys (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL)` for once-per-cool-down
notices.

`budgetConfigFromConfig` gains `if (cf !== null) providers.camoufox = { ...cf.limits, billable: false, trialUsed: 0 }`
(cost-005). `reserve`'s order (cost-010): provider-month (for a `pagesOnly` provider counting rows whose `page_class` is
not `'no-page'`, pending rows included), then **provider-execution** (the same row rule, scoped to the execution and
provider, the cap read from the execution's snapshot `$.budget.providerMaxCalls.<provider>`, never from config; a
provider with no snapshot cap has no such scope; arch-007), then global, then the execution caps (camoufox rows count in
`execution-free-calls` like any free row). `finalise({ pageClass })` writes the column.

- [ ] **Step 1: Write the failing tests**

```ts
// test/migration0005.test.ts
import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers/db.js';

const TABLES_WITH_PROVIDER = ['calendar_prices', 'cell_outcomes', 'fare_offers', 'price_observations', 'provider_requests', 'route_price_history'];

describe('migration 0005 (spec §5.1 rev 32)', () => {
  it('every rebuilt table accepts camoufox, and every source-kind column accepts scraped-self', () => {
    const db = freshDb();
    for (const t of TABLES_WITH_PROVIDER) {
      const check = db.$client.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t);
      expect(JSON.stringify(check)).toContain("'camoufox'");
    }
    for (const t of ['calendar_prices', 'cell_outcomes', 'price_observations'])
      expect(JSON.stringify(db.$client.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t))).toContain("'scraped-self'");
  });
  it('a provider_requests row for camoufox inserts with a page class; an unknown provider is refused', () => {
    const db = freshDb();
    const insert = db.$client.prepare("INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt, page_class) VALUES (?, '/v1/page', '2026-10-18T05:00:00.000Z', 'ok', 0, 0, 1, ?)");
    expect(() => insert.run('camoufox', 'no-page')).not.toThrow();
    expect(() => insert.run('kayak', 'page')).toThrow(/CHECK/);
    expect(() => insert.run('camoufox', 'sometimes')).toThrow(/CHECK/);
  });
  it('keeps every row of a database migrated to 0004', () => {
    // Seeds one row per rebuilt table at 0004 through the existing migration0004 test's seeding helper, migrates, compares.
  });
});
```

(The last case reuses `migration0004.test.ts`'s seed-and-compare pattern; the implementer lifts that helper into
`test/helpers/` in this task. Column lists follow the real schema, `id` omitted on autoincrement tables; arch-010.)

```ts
// test/budgetGuard.providerExecution.test.ts
import { describe, expect, it } from 'vitest';
import { BudgetExceeded } from '@gmt/core';
import { guardFor } from './helpers/guard.js';

const r = (executionId: string, tileIndex: number) => ({ providerId: 'camoufox' as const, executionId, tileIndex, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/v1/page' });

describe('provider-execution and no-page rows (spec §2, §5.3; decision 69)', () => {
  it('the cap comes from the execution snapshot: the 3rd page with a snapshot cap of 2 is refused, whatever config says', () => {
    const g = guardFor({ camoufoxConfigCap: 100, snapshotCaps: { e1: { camoufox: 2 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    g.reserve(r('e1', 1)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    expect(() => g.reserve(r('e1', 2))).toThrow(BudgetExceeded);
    try { g.reserve(r('e1', 2)); } catch (e) { expect(e instanceof BudgetExceeded && e.scope).toBe('provider-execution'); }
  });
  it('no-page rows count toward neither page cap', () => {
    const g = guardFor({ camoufoxConfigCap: 100, monthlyCap: 1, snapshotCaps: { e1: { camoufox: 1 } } });
    for (let i = 0; i < 5; i++) g.reserve(r('e1', i)).finalise({ outcome: 'error', httpStatus: 429, durationMs: 1, pageClass: 'no-page' });
    expect(() => g.reserve(r('e1', 9))).not.toThrow();
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(1);
  });
  it('provider-execution is checked before execution-free-calls, so Travelpayouts keeps its headroom', () => {
    const g = guardFor({ camoufoxConfigCap: 100, maxFreeCalls: 3, snapshotCaps: { e1: { camoufox: 1 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    try { g.reserve(r('e1', 1)); } catch (e) { expect(e instanceof BudgetExceeded && e.scope).toBe('provider-execution'); }
    expect(() => g.reserve({ ...r('e1', 0), providerId: 'travelpayouts', endpointPath: '/x' })).not.toThrow();
  });
  it('camoufox rows are never billable and cost 0', () => {
    const g = guardFor({ camoufoxConfigCap: 100, snapshotCaps: { e1: { camoufox: 10 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'error', httpStatus: 423, durationMs: 1, pageClass: 'page' });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' })).toMatchObject({ calls: 1, costMicroGbp: 0 });
  });
});
```

(`guardFor` is a new helper over `freshDb`, the real `budgetConfigFromConfig` and real executions whose snapshots carry
`budget.providerMaxCalls`.)

`test/budgetConfig.camoufox.test.ts`: `budgetConfigFromConfig(ok(ON))` has `camoufox` with `billable: false`,
`trialUsed: 0`, `executionCallCap: 100`, `pagesOnly: true`; a reserve through that config succeeds and counts under
provider-month; with camoufox disabled there is no entry and a camoufox reserve fails closed.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — `pnpm --filter @gmt/db test`; PASS with
thresholds. **Step 5: Commit** — `git commit -am "wp14: db migration 0005, camoufox budget entry, snapshot page cap, no-page rows"`

### Task 14.8: http-kit and the adapter

**Files:** modify `packages/providers/src/http/{types.ts,classify.ts,attempt.ts,egress.ts,httpKit.ts,cacheKey.ts}`,
`test/fakes.ts`; create `packages/providers/src/camoufox/*` and its tests.

http-kit changes (cost-001, cost-003, cost-006, PIE-07, prov-009, arch-013):

- `HttpProviderId` gains `'camoufox-status'`, never ledgered (like `fx`), hosts and port = the worker's, `GET` only,
  path `/v1/status` only.
- `ProviderHttpLimits` gains `workerPort?: number`, `workerScheme?: 'http:' | 'https:'`, `retryTransport?: false`
  (timeouts, dropped sockets and failed body reads become non-retryable), `connectRefusedKind?: 'provider-unavailable'`
  (an `ECONNREFUSED` or `EHOSTUNREACH` before any byte was sent becomes that kind, non-retryable) and
  `pageClass?: (f: { status: number | null; headers: Headers | null }) => 'page' | 'no-page'`, which `attempt.ts`
  passes to `reservation.finalise` (a refused connection is `no-page`; a timeout after sending is `page`).
- `CREDENTIAL_HEADERS` gains `x-gmt-worker-key`.
- Egress: for `camoufox` and `camoufox-status`, the scheme, host and explicit port must equal the configured worker
  URL's; every other rule stands.

The adapter:

- `planSingleCells(q)`: one 1 × 1 `rectangle` per cell in `generateCells` (or `q.cells`) order, partitioning the cells
  (asserted).
- `fetchTile` posts `pageRequestSchema`-valid JSON (`mode: 'list'`, the cell, `gl` = `POINT_OF_SALE`,
  `q.airportNames`), parses the answer with `workerAnswerSchema` (core's one copy), and maps it: `cells` with
  `status: 'price'` → one `RawCalendarPrice` (currency `GBP`, keys from the request, which the worker checked against
  the form) plus, on the cell, one `CellIssue` when `optionsUnparsed > 0` or the tab price is below the minimum
  (`reason: 'parse'`, `offersDropped: optionsUnparsed + (tab below ? 1 : 0)`, `detail` naming each part, so the cell
  is written `priced` with `offers-dropped:n` and a `last_error`; prov-001, prov-005), and otherwise one `CellIssue`
  with `offersDropped: 0` and `detail: 'return date: the date asked for'` plus `options for another cell: n` when
  `optionsOtherCell > 0` (stored in `last_error`; prov-003, prov-005); `status: 'no-flights'` → the cell left out of
  `prices` and `noFares`, so `commitTile` writes `no_data` (decision 69); 423 → `blocked` (message words the page kind
  as §10.10's copy table does, with the cool-down end); 409 → `parse`; 504 `not-ready` → `parse`, detail
  `page-not-ready`; 502 → `upstream`; 429 → `rate-limit` with `Retry-After`; a refused connection →
  `provider-unavailable`. The tile's `fetchedAt` is the answer's, refused unless it lies between the request's start
  and the adapter's clock (prov-010).
- `preflight(ctx)`: `GET /v1/status` through `camoufox-status`; `coolingDownUntil` set → `{ ok: false, skip:
  'provider_disabled', detail: 'cooling down until <time> (<cause>)', until }`; `signedInRefusal` → the same with detail
  "signed-in profile refused"; a refused or failed connection → `{ ok: false, skip: 'provider_unavailable', detail:
  'browser worker not reachable' }`; else `{ ok: true }`. No ledger row in any case.
- `camoufoxHttpLimits`: hosts `[url.hostname]`, `workerPort`, `workerScheme` from the URL; `billable: 'never'`; cost 0;
  concurrency 1; the config's rates; `requestTimeoutSeconds = pageTimeoutSeconds + 15`; `retryTransport: false`;
  `connectRefusedKind: 'provider-unavailable'`; `pageClass` from `x-gmt-google-contacted` (absent header on a response
  → `page`, the conservative reading); the classifier of the answer map above.
- `healthcheck` probes nothing (decision 24).

- [ ] **Step 1: Write the failing tests** — `fetchTile.test.ts` (msw at the worker URL; hit counters and ledger rows on
every case; TS-16):

```ts
import { asIata, asIsoDate, asIsoDateTime } from '@gmt/core';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { camoufoxProvider, planSingleCells } from '../../src/camoufox/index.js';
import { makeKit, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';

const URL_ = 'http://127.0.0.1:8090/v1/page';
const Q = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2027-03-11'), departureTo: asIsoDate('2027-03-11'),
  minNights: 10, maxNights: 10, cabin: 'economy' as const, currency: 'GBP' as const,
  airportNames: { origin: ['London Heathrow Airport'], destination: ['John F Kennedy International Airport'] } };
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
const contacted = (yes: boolean) => ({ headers: { 'x-gmt-google-contacted': yes ? '1' : '0' } });
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };
const price = (o: Partial<{ amountMinor: number; tabMinor: number | null; optionsUnparsed: number; optionsOtherCell: number }> = {}) => ({
  kind: 'cells', fetchedAt: '2026-10-14T15:00:00.000Z', currency: 'GBP', pointOfSale: 'GB', notes: [], versions,
  cell: { status: 'price', amountMinor: 45100, tabMinor: 45100, optionsUnparsed: 0, optionsOtherCell: 0, returnDateFrom: 'query-and-form', ...o } });

function setup() {
  const { kit, budget, log, clock, events } = makeKit();
  const p = camoufoxProvider({ http: kit, log, clock, key: SENTINELS.camoufox, workerUrl: 'http://127.0.0.1:8090', pointOfSale: 'GB' });
  const tile = planSingleCells(Q)[0];
  if (tile === undefined) throw new Error('no tile');
  return { p, budget, events, tile };
}
afterEach(() => server.resetHandlers());

describe('camoufox fetchTile (spec §2, §5.2)', () => {
  it('a price: one RawCalendarPrice, the return-date label stored on the cell, one page row', async () => {
    const { p, budget, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json(price(), contacted(true))));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.prices).toEqual([{ ...tile.coveredCells[0], amountMinor: 45100, currency: 'GBP' }]);
    expect(r.cellIssues).toEqual([{ cell: tile.coveredCells[0], reason: 'parse', offersDropped: 0, detail: 'return date: the date asked for' }]);
    expect(budget.rows('camoufox').map((x) => x.pageClass)).toEqual(['page']);
  });
  it('unparsed options and a cheaper tab mark the cell partial (offers-dropped), never only a note', async () => {
    const { p, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json(price({ tabMinor: 39900, optionsUnparsed: 2, optionsOtherCell: 1 }), contacted(true))));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.cellIssues).toEqual([{ cell: tile.coveredCells[0], reason: 'parse', offersDropped: 3,
      detail: 'return date: the date asked for; options unread: 2; the Cheapest tab showed a lower price; options for another cell: 1' }]);
  });
  it('no flights: neither a price nor noFares (written no_data)', async () => {
    const { p, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json({ ...price(), cell: { status: 'no-flights' } }, contacted(true))));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect([r.prices, r.noFares, r.cellIssues ?? []]).toEqual([[], [], []]);
  });
  it.each([
    [423, { kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' }, true, 'blocked', 'page'],
    [423, { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' }, false, 'blocked', 'no-page'],
    [409, { kind: 'mode-unavailable', mode: 'grid' }, false, 'parse', 'no-page'],
    [504, { kind: 'not-ready', elapsedMs: 90_000 }, true, 'parse', 'page'],
    [502, { kind: 'browser-error', stage: 'launch', detail: 'x' }, false, 'upstream', 'no-page'],
  ])('HTTP %i %j → tile-error %s, called once, row class %s', async (status, body, isContacted, kind, cls) => {
    const { p, budget, tile } = setup();
    let hits = 0;
    server.use(http.post(URL_, () => { hits++; return HttpResponse.json(body, { status, ...contacted(isContacted) }); }));
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind, retryable: false } });
    expect(hits).toBe(1);
    expect(budget.rows('camoufox').map((x) => x.pageClass)).toEqual([cls]);
  });
  it('a timeout past the request timeout is one attempt, one page row, no second POST', async () => { /* respondAfter beyond requestTimeoutSeconds; hits === 1; rows ['page'] */ });
  it('a dropped socket is one attempt, never retried', async () => { /* HttpResponse.error(); hits === 1 */ });
  it('a refused connection is provider-unavailable, one no-page row', async () => { /* worker URL with nothing listening; error.kind 'provider-unavailable'; rows ['no-page'] */ });
  it('429 spacing honours Retry-After, then the page: two rows, one page', async () => { /* 429 + Retry-After: 1, then price(); rows ['no-page','page'] */ });
  it('an unknown answer kind (consent-rejected) is a parse error', async () => { /* workerAnswerSchema refuses */ });
  it('a fetchedAt after the adapter clock or before the request is refused as parse', async () => { /* prov-010 */ });
  it('the key travels in x-gmt-worker-key, never in the URL, and a recording keeps no such header', async () => { /* arch-013 */ });
  it('declares discovery only, scraped-self, maxAgeHours 0, economy only, and the spec §2 provenance note verbatim', () => { /* */ });
});
```

(The commented bodies follow the first cases' pattern with the named msw helpers `respondAfter`, `HttpResponse.error()`
and a closed port; the implementer writes them in full.)

`preflight.test.ts`: cooling down → `provider_disabled` with the end and cause; signed-in refusal → `provider_disabled`;
worker down → `provider_unavailable`; healthy → ok; in every case the fake budget records no row. `tiles.test.ts`: one
tile per cell, partition asserted, subset re-plan, deterministic. `egress.test.ts`: every URL the config accepts passes
egress for `camoufox` (arch-012, using `camoufoxWorkerUrlOk`'s accepted examples); another port (`9377`), another host,
another scheme, Google directly, and any `searchapi` request to the worker URL are refused. `limits.test.ts`: the values
above; `retryTransport: false`; `pageClass` from the header. `recorderHeaders.test.ts`: a recorded camoufox request has
no `x-gmt-worker-key`.

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/providers test`; PASS with the package floor and a
`src/camoufox/**` floor of 90/80/90/90.

- [ ] **Step 5: Commit** — `git commit -am "wp14: http-kit camoufox rules and the camoufox adapter"`

### Task 14.9: Engine: preflight, the new rows, the snapshot page cap, airport names and the estimate

**Files:** modify `packages/engine/src/{run.ts,resume.ts,estimate.ts,budgetFit.ts,start.ts,stages/discovery.ts,notify.ts}`;
create `test/camoufoxRows.test.ts`, `test/camoufoxEstimate.test.ts`, `test/support/camoufox.ts` (a stub
`FlightProvider` with id `'camoufox'`, scripted `preflight` and tile results, through the real db guard and an in-memory
database, as WP7's error-table tests stub providers).

Rules:

- **Start:** the snapshot's `budget.providerMaxCalls.camoufox` is set from `config.providers.camoufox.executionPageCap`
  when the execution is created; a manual `/resume` refreshes it only as it refreshes the rest of the budget (arch-007).
- **Discovery:** for a provider with `preflight`, the stage calls it before planning; `{ ok: false }` marks every cell
  of that provider in the stage skipped with the given reason and detail in `last_error`, writes no ledger row, and
  sends one notification per cool-down, keyed `camoufox-cooldown:<until>` in `operator_notice_keys` (cost-015); the
  engine fills `q.airportNames` from the airports repository for every query (spec §5.1).
- **Errors:** `blocked` joins the disabling arm (`auth`/`quota`), writes `error`/`blocked` with the adapter's message in
  `last_error`, is non-retryable on resume, and `blockedBefore(ctx, executionId)` keeps the provider disabled through a
  manual resume; `provider-unavailable` disables the provider for the run with the remaining cells
  `skipped:provider_unavailable`; `BudgetExceeded` `provider-execution` follows the "provider-month, other providers
  remain" row, else `paused_budget` with no `resume_after`.
- **Estimate** (cost-004, cost-009, cost-011, prov-013): `SECONDS_PER_CALL['scraped-self'] = 0` and the camoufox line's
  seconds = pages × (`minSpacingSeconds` + 40), pages = min(plan length, snapshot cap) before the retry factor and
  clamped to the cap after it; the line's note: "camoufox list mode prices N of M cells this run; a full pass takes K
  runs; the month cap allows about X cells"; `budgetFit` counts the camoufox monthly load as min(runs × cap,
  discovery runs × cells) and warns when the cells a schedule needs per refresh exceed the monthly page cap.

- [ ] **Step 1: Write the failing tests** — `camoufoxRows.test.ts` with exact counts (TS-14), for example:

```ts
import { describe, expect, it } from 'vitest';
import { blockedError, engineWith, outcomes, stubCamoufox, stubTravelpayouts } from './support/camoufox.js';

describe('spec §8.1 rev 32: camoufox rows', () => {
  it('blocked on the first tile: exactly one error/blocked cell, every other camoufox cell skipped:provider_disabled, travelpayouts untouched', async () => {
    const e = engineWith([stubCamoufox({ cells: 12, failTile: 0, error: blockedError('captcha') }), stubTravelpayouts({ cells: 12 })]);
    const ex = await e.runToEnd();
    const cf = outcomes(e, ex.id, 'camoufox');
    expect(cf.filter((o) => o.status === 'error' && o.reason === 'blocked')).toHaveLength(1);
    expect(cf.filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toHaveLength(11);
    expect(outcomes(e, ex.id, 'travelpayouts').filter((o) => o.status === 'priced')).toHaveLength(12);
    expect(ex.status).toBe('completed');
  });
  it('preflight cooling down: every camoufox cell skipped with the end in last_error, no ledger row, one notice across two runs', async () => {
    const e = engineWith([stubCamoufox({ cells: 5, preflight: { ok: false, skip: 'provider_disabled', detail: 'cooling down until 2026-10-20T05:00:00.000Z (captcha)', until: '2026-10-20T05:00:00.000Z' } }), stubTravelpayouts({ cells: 5 })]);
    const a = await e.runToEnd();
    await e.runToEnd();
    expect(outcomes(e, a.id, 'camoufox').map((o) => [o.status, o.reason])).toEqual(Array(5).fill(['skipped', 'provider_disabled']));
    expect(e.ledgerRows('camoufox')).toHaveLength(0);
    expect(e.notifications.filter((n) => n.kind === 'provider-cooldown')).toHaveLength(1);
  });
  it('worker unreachable at preflight: skipped:provider_unavailable, no row, other providers run', async () => { /* exact counts */ });
  it('a refused connection mid-run: one error cell, the rest skipped:provider_unavailable, at most one ledger row', async () => { /* exact counts */ });
  it('a manual resume keeps camoufox disabled after a block and calls it no more', async () => { /* */ });
  it('a manual resume still re-admits a provider disabled for auth', async () => { /* */ });
  it('the snapshot page cap stops camoufox at 2 pages though config says 100, and travelpayouts continues', async () => { /* */ });
  it('alone, the page cap pauses paused_budget and the tick does not resume it', async () => { /* */ });
  it('the engine fills airportNames from the airports repository', async () => { /* the stub records q.airportNames */ });
});
```

`camoufoxEstimate.test.ts`: the worked example in list mode (one pair, 2,184 cells) estimates 100 pages with the factor
clamped to 100, about 7,000 s before the factor at the defaults (100 × 70), is not blocked at start by provider-month or
by the shared free-calls cap, and its note names 100 of 2,184 cells, 22 runs and about 1,500 cells a month; `budgetFit`'s
monthly camoufox load for a weekly schedule is min(4.33 × 100, 4.33 × 2,184) and the warning appears.

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/engine test`; PASS with thresholds.

- [ ] **Step 5: Commit** — `git commit -am "wp14: engine preflight, camoufox rows, snapshot page cap and estimate"`

### Task 14.10: Wiring, copy and the Providers view

**Files:** modify `apps/api/src/wiring.ts`, `apps/api/src/read/usage.ts`, `apps/web/src/copy.ts`, `.env.example`; tests
`apps/api/test/wiring/camoufox.test.ts` (over `test/helpers/env.ts`), `apps/web/test/copy.camoufox.test.ts`.

- `httpLimitsFor` adds `camoufox` and `camoufox-status`; `providersFor` adds the provider; `collectSecrets` adds the key;
  `defaultDefinitionInput` never adds camoufox to a new definition (asserted; arch-010).
- Copy (prov-008, prov-015, ruling 11): the outcome reasons map gains `blocked`: "stopped: Google showed a page this app
  does not read, or a check (the detail says which)"; `last_error` words each page kind distinctly: "Google showed a bot
  check (CAPTCHA)", "Google reported unusual traffic", "Google showed its cookie page (the rejection did not hold)",
  "Google asked to sign in", "the browser profile was signed in", "Google sent the browser elsewhere", "Google's page was
  not one this app reads (it may have changed)", "cooling down until <time>; Google was not contacted"; the skip reason
  `provider_unavailable`: "browser worker not reachable". The narrow-screen legend at `copy.ts`'s `phoneProviders`
  string gains ", CF Camoufox (Google Flights prices via Camoufox)". The Providers note `camoufoxNote`: "Off by default.
  Reads Google Flights in your own Camoufox browser, in its own signed-out profile, from your own IP address, one day
  pair a page, at most one page every 30 seconds. It prices at most the monthly page cap of day pairs a month (1,500 by
  default; one London → New York airport pair has 2,184), so most cells stay unsearched or skipped. On any bot check or
  page it does not recognise it stops and pauses (48 hours for a check, 1 hour for an unknown page). Google's terms do
  not permit this automated access."

- [ ] **Step 1: Write the failing tests** — wiring: off by default (no limits, no provider); on: `httpLimitsFor(c)
.camoufox` has hosts `['host.docker.internal']`, port 8090, scheme `http:`, `billable: 'never'`, concurrency 1,
`retryTransport: false`; `camoufox-status` present; the provider has discovery only; the key is a collected secret;
`defaultDefinitionInput(...)`'s discovery providers never include `camoufox`. Copy: the legend contains the CF entry;
`camoufoxNote` mentions "signed-out profile", "own IP address" and "1,500"; no copy string matches the banned words;
the `unrecognised` and `cooling-down` wordings do not contain "bot check" (prov-008).

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/api test && pnpm --filter @gmt/web test`; PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: wire the camoufox provider; reasons, legend and Providers copy"`

### Task 14.11: Docker, compose, CI, boundaries and the rules tests

**Files:** modify `Dockerfile`, `.dockerignore`, `docker-compose.yml`, root `package.json`, `scripts/check-boundaries.mjs`,
`scripts/workflows.test.mjs`, `.github/workflows/ci.yml`; create `apps/camoufox-worker/test/rules.test.ts`.

- **The image stays browser-free (arch-002, devops-002).** `.dockerignore` excludes `apps/camoufox-worker/` except its
  `package.json`. The build stage copies that manifest beside the others (so the frozen lockfile's importer resolves)
  and installs with `pnpm install --frozen-lockfile --filter '!@gmt/camoufox-worker'`; the root `build` script's filter
  becomes `--filter './packages/**' --filter './apps/**' --filter '!@gmt/camoufox-worker'`; the prod-deps stage already
  filters to `@gmt/api...`. The docker job asserts `! test -e /app/apps/camoufox-worker`, no `camoufox-js` or
  `playwright-core` under `/app/node_modules`, `! command -v firefox`, and the image size within 5 MB of main.
- **Compose:** the `app` service gains `extra_hosts: ["host.docker.internal:host-gateway"]` and the environment lines
  `CAMOUFOX_ENABLED`, `CAMOUFOX_WORKER_URL` (default `http://host.docker.internal:8090`), `CAMOUFOX_WORKER_KEY`,
  `CAMOUFOX_MIN_SPACING_SECONDS`, `CAMOUFOX_EXECUTION_PAGE_CAP`, `CAMOUFOX_MONTHLY_PAGE_CAP`, `CAMOUFOX_BILLING_DAY`,
  `CAMOUFOX_COOLDOWN_HOURS`, `CAMOUFOX_PAGE_TIMEOUT_SECONDS`. No new service, image or volume.
- **CI (devops-012):** a step "app runs with the camoufox-worker absent" runs a separate project
  (`docker compose -p gmt-cfabsent up -d` with `CAMOUFOX_ENABLED=true` and a dummy 32-character key passed through the
  shell, never `.env`), checks `/api/health`, checks `/api/providers` lists `camoufox`, imports a one-cell definition whose only discovery provider is
  camoufox, starts one execution, and asserts its cell ends `skipped:provider_unavailable` with zero camoufox ledger rows
  (the preflight found no worker), then `down -v`.
- **Boundaries (arch-009, TS-04):** `ALLOWED['@gmt/camoufox-worker'] = ['@gmt/core']` for production sources, plus
  `@gmt/providers` (only its `testing` export) for files under `apps/camoufox-worker/test/`; external imports
  `camoufox-js` and `playwright-core` allowed only in `apps/camoufox-worker/src/{launch,driver}.ts`; `ENV_READER` widens
  to `apps/camoufox-worker/src/{main,record,captureSocs,clearSignedIn}.ts`; nothing may import `@gmt/camoufox-worker`.
- **Rules tests (TS-02, TS-03, arch-016): behavioural, not string scans.** `rules.test.ts` asserts: `buildLaunchOptions`
  (Task 14.1) has no `proxy`, `geoip: false`, no `humanize`, `exclude_addons: ['UBO']` and a minimal `env`; the worker's
  `package.json` dependencies are exactly `@gmt/core`, `camoufox-js` 0.11.5 and `playwright-core` 1.59.1; a full
  `PageSession` run over the fake driver calls `addCookies` only with a `SOCS` cookie and never clicks a node on a
  consent page; and, through the TypeScript compiler API over `src/`, no call to `Math.random`, `setTimeout` with a
  computed jitter, `context.addCookies` outside `session.ts`, or `route.continue` with a changed URL.

- [ ] **Step 1: Write the failing tests** — the rules tests above; `scripts/workflows.test.mjs` gains: compose has no
service named `camoufox*` or `browser*`; `app` has the `extra_hosts` line and the `CAMOUFOX_WORKER_URL` default; the
Dockerfile installs with the `!@gmt/camoufox-worker` filter; `.dockerignore` excludes the worker; CI has the
"camoufox-worker absent" step.

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/rules.test.ts && pnpm vitest run --project scripts scripts/workflows.test.mjs && node scripts/check-boundaries.mjs`; PASS, exit 0.

- [ ] **Step 5: Commit** — `git commit -am "wp14: image excludes the worker; compose, CI, boundaries and rules tests"`

### Task 14.12: Operator docs

**Files:** modify `docs/setup.md`, `docs/providers.md`, `docs/api-limits.md`, `docs/scheduling.md` (generated rows);
test `apps/api/test/deploy/camoufoxDocs.test.ts`.

`docs/setup.md` section 14, "The Camoufox provider (optional, off by default)", in this order:

1. **What it is and what it costs** — spec §2's costs under their bold names, verbatim (**Google's terms** with the
   robots.txt disallow of `/travel/flights/search` as a known cost, **The operator's IP and account**,
   **Brittleness**, **Speed** with 50–90 s a page and 1½–2½ hours a run, **Availability**, **Image size**), and the
   coverage paragraph (at most 100 day pairs a run and 1,500 a month by default; 2,184 for one worked-example airport
   pair).
2. **How it behaves** — one page at a time, start to start 30 s; its own signed-out profile; the cookie choice is
   "Reject all", set before every page from your capture, and a cookie page means it stops; 48 h after a check, 1 h
   after an unknown page; never solves or clicks through a challenge; nothing retries it. The camofox-browser server is
   not used and need not run.
3. **Set it up** —
   - `mkdir -p -m 700 ~/.local/state/get-me-there/camoufox`;
   - `pnpm install` in a checkout (the worker runs from source; repeat after every `git pull`);
   - capture your cookie choice: in an ordinary private browser window (Firefox, Chrome or Safari: the cookie view under
     the developer tools' Storage or Application tab, cookies for `https://www.google.com`) open
     `https://www.google.com/travel/flights`, click **Reject all**, then run
     `pnpm --filter @gmt/camoufox-worker capture-socs` and paste the `SOCS` cookie's value, expiry, Secure and SameSite
     when asked (it stamps the time and writes the file 0600);
   - write `~/.local/state/get-me-there/camoufox/worker.env` (mode 0600) with `CAMOUFOX_WORKER_KEY` (at least 32
     random characters, `openssl rand -hex 24`), `CAMOUFOX_EXECUTABLE` (your Camoufox binary, for example
     `~/Library/Caches/camoufox/Camoufox.app/Contents/MacOS/camoufox`), `CAMOUFOX_DATA_DIR`, and on Linux
     `CAMOUFOX_WORKER_BIND` = the `docker0` address;
   - start it: `pnpm --filter @gmt/camoufox-worker start` to try it, then install the launchd agent from
     `apps/camoufox-worker/launchd/*.plist.example` (copy, set the checkout path, `launchctl bootstrap gui/$(id -u)
     <plist>`); on Linux the systemd user unit equivalent with `Restart=on-failure`, `RestartSec=60`,
     `After=docker.service`. Start-check failures exit 78 and the agent does not loop faster than once a minute; logs go
     to `~/Library/Logs/get-me-there/`.
4. **Point the app at it** — *Docker:* add `CAMOUFOX_ENABLED=true` and `CAMOUFOX_WORKER_KEY=…` to `.env`, and leave
   `CAMOUFOX_WORKER_URL` unset (the compose default reaches your machine); on Linux add a firewall rule admitting tcp/8090
   on the `docker0` address from the compose subnet only. *`pnpm dev`:* export `CAMOUFOX_ENABLED=true` and
   `CAMOUFOX_WORKER_KEY=…` in the shell that runs it (it reads no `.env`), with `CAMOUFOX_WORKER_URL=http://127.0.0.1:8090`;
   never put that URL in `.env`, where it would break the container (devops-008). Keep `CAMOUFOX_COOLDOWN_HOURS` and
   `CAMOUFOX_PAGE_TIMEOUT_SECONDS` equal on both sides; the smoke flags a mismatch.
5. **Choose it** — add "Google Flights prices via Camoufox" to a definition's discovery providers; new definitions never
   include it.
6. **Check it** — `curl -s -H "x-gmt-worker-key: $(grep ^CAMOUFOX_WORKER_KEY= ~/.local/state/get-me-there/camoufox/worker.env | cut -d= -f2-)" http://127.0.0.1:8090/v1/status`
   (the key read from the file, never typed; SEC-013); `lsof -nP -iTCP:8090 -sTCP:LISTEN` shows 127.0.0.1 (macOS) or the
   `docker0` address (Linux).
7. **Turn it off or recover** — `CAMOUFOX_ENABLED=false` and restart the app; `launchctl bootout gui/$(id -u)/uk.dominey.get-me-there.camoufox-worker`
   (or `systemctl --user stop`); an in-flight page finishes before the worker exits. After a signed-in refusal: wipe and
   clear with `pnpm --filter @gmt/camoufox-worker clear-signed-in`. Deleting the cool-down record ends a pause early,
   which defeats its purpose.

`docs/providers.md`: the summary row of spec §2's table; a section "Camoufox provider (self-scraped, opt-in)" with the
method, the evidence (feasibility load and signed-out test, with dates and what each saw), the verified `camoufox-js`
facts of §7, the limits, the six costs under the same bold names, the coverage paragraph, the provenance note quoted
exactly, and the labels. `docs/api-limits.md`: a subsection "Camoufox (own Google Flights pages): self-scraped, opt-in,
free" with the caps, the snapshot rule, the spacing and derived rates, the cool-downs, "never billable, cost 0, never
cached", that camoufox pages also draw on `EXECUTION_MAX_FREE_CALLS` (cost-010), the coverage arithmetic, the six costs,
and under "Reconciling": there is no vendor dashboard; the ledger's camoufox rows are the only record; rows of class
`page` loaded Google (`200`, `423` blocked, `504`, `502` after launch), rows of class `no-page` did not (`423`
cooling-down, `429`, `409`, `400`, `401`, `502` at launch, a refused connection); a `423` blocked row is a block, a
`423` cooling-down row a refusal with no page load (prov-009). `docs/scheduling.md` gains the generated camoufox rows
(100 cells a run; 22 runs for one worked-example pair; 1½–2½ hours a run).

- [ ] **Step 1: Write the failing test** — `camoufoxDocs.test.ts`: setup.md has the section heading, `capture-socs`,
`worker.env`, `chmod`-free `mkdir -p -m 700`, both worker URLs, the "never in `.env`" line, `launchctl bootout`,
`clear-signed-in`; providers.md and api-limits.md each contain every cost name and `/travel/flights/search`; providers.md
quotes `CAMOUFOX_DISCOVERY_INFO.provenanceNote` exactly and no longer says "Phase 4 continuity fallback only (spec §2);
not built"; api-limits.md names both row classes; no doc mentions `CAMOFOX_ACCESS_KEY` or the camofox-browser REST
routes as something to configure for this provider.

- [ ] **Step 2–4: Run, write, run** — `pnpm --filter @gmt/api exec vitest run test/deploy/camoufoxDocs.test.ts`; PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: operator docs for the camoufox provider, its costs and coverage"`

### Task 14.13: Smoke checklist rows

**Files:** modify `apps/api/src/tools/smoke.ts`, `smokeChecks.ts`; test `apps/api/test/tools/smoke.camoufox.test.ts`.

With camoufox configured the smoke reads the worker's `/v1/status` (unledgered) and runs **one** list tile (one cell,
at most one page load), spending no SearchApi credit. Rows (cost-013, prov-014, TS-19):

| Row | `ok` when | `FAIL` when | `skip` when |
|---|---|---|---|
| `camoufox worker` | status answered, versions pinned (`camoufoxJs` 0.11.5, the binary build) | unreachable, or another version | not configured |
| `camoufox signed out` | `profileHasAccountCookie: false` and no signed-in refusal | anything else | not configured |
| `camoufox consent` | a `SOCS` capture younger than 13 months, and the page was not `consent-unhandled`; `look` while `socsReadBackExact` is false | a `consent-unhandled` block, or no capture | not configured |
| `camoufox settings match` | the worker's `cooldownHours` and `pageTimeoutSeconds` equal the app's | a mismatch (both values printed) | not configured |
| `camoufox one page` | exactly one camoufox row of class `page` for the tile; `no-page` rows printed as "spacing waits" | more than one `page` row | not configured |
| `camoufox not blocked` | the answer was `cells` | `blocked`, `cooling-down` (page kind and end printed) | not configured |
| `camoufox cell` | the price's dates are the query's and the departure was echoed by the options; the return date printed with "(the date asked for, shown in the search form)" | an `options for another cell` count equal to all options | not configured or blocked |
| `camoufox partial` | `look` when the cell carries `offers-dropped`, with its detail; else `ok` | — | not configured or blocked |
| `camoufox provenance` | `scraped-self`, `maxAgeHours` 0, the note equals `CAMOUFOX_DISCOVERY_INFO.provenanceNote`, GBP, point of sale as stated | anything else | not configured or blocked |
| `camoufox selectors` | the status's selectors and grammar versions, and which flags are verified, printed | `FORM_VERIFIED` false | not configured |
| `camoufox compare` | `look`: open Google Flights for the cell and compare the price by eye | — | not configured or blocked |

A blocked smoke exits 1, prints the cool-down end, and says every further page will be refused until then.

- [ ] **Step 1: Write the failing test** — one `it` per row, with both `/v1/status` and `/v1/page` scripted through msw
(status: healthy, cooling down, signed-in refusal, settings mismatch; page: cells, cells with dropped options, blocked,
cooling-down, a 429 then cells), each asserting the row's status and the exit code.

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/api exec vitest run test/tools/smoke.camoufox.test.ts`; PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: smoke checklist rows for the camoufox tile"`

## 11. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP14. Pinned here:

- Blocked kinds are classified first, on every poll and after every click; a page with results and a challenge is
  blocked (Tasks 14.1, 14.4).
- `SOCS` is set before every page and read back on every path; a consent page, a changed value or (before stability is
  proved) a missing one is a `consent-unhandled` stop that wipes the profile; nothing on a consent page is clicked
  (Tasks 14.3, 14.4, 14.11).
- An account cookie or a signed-in control stops the worker and keeps it refusing across restarts until cleared (Task
  14.4).
- The pacer is released on every path, a hanging browser call ends at the page deadline, and a restart keeps the
  spacing (Task 14.4).
- One tile never costs two Google loads: transport failures are never retried; a refused connection is one `no-page`
  row and disables the provider (Tasks 14.8, 14.9).
- Rows that loaded no page never count toward the page caps (Task 14.7).
- The page cap comes from the execution's snapshot (Task 14.7).
- A cooling-down worker costs no ledger rows and one notification per cool-down (Task 14.9).
- A reworded option is dropped and counted; another day's or airport's option never prices this cell; a cheaper tab
  marks the cell partial; a disagreeing search form stops the page (Tasks 14.2, 14.8).
- Grid mode cannot be enabled (Tasks 14.4, 14.6).
- The image carries no worker, no browser library and no browser; the app runs with the worker absent (Task 14.11).

## 12. Definition of done

- `pnpm --filter @gmt/camoufox-worker test` passes with its floors (90/80/90/90; 100 lines and branches for the seven
  safety modules); the recorded kinds present locally pass, the absent ones are reported skipped with the decision-61
  suffix; with `fixtures/recorded` holding only `.gitkeep`, `pnpm --filter @gmt/camoufox-worker exec vitest run
  test/recorded.test.ts --reporter verbose` prints `(skipped: recordings not present, local-only, decision 61)` for every
  kind (TS-04).
- `pnpm --filter @gmt/camoufox-worker exec stryker run` and `node scripts/mutation-gate.mjs apps/camoufox-worker`
  pass (80% break, timeouts ≤ 5%).
- `pnpm --filter @gmt/core test` at 100%; `pnpm --filter @gmt/db test`, `@gmt/providers` (with the `src/camoufox/**`
  floor), `@gmt/engine`, `@gmt/api`, `@gmt/web` with their thresholds; `pnpm test` passes.
- `pnpm lint` clean; `pnpm -r typecheck` clean; `node scripts/check-boundaries.mjs` exits 0;
  `node scripts/check-casts.mjs` exits 0; `pnpm secret-scan` prints `secret scan: clean`.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" apps/camoufox-worker/src packages/providers/src/camoufox` prints nothing.
- `git check-ignore apps/camoufox-worker/fixtures/recorded/2026-10-18/1-results.snapshot.json` prints the path, and
  `git ls-files apps/camoufox-worker/fixtures/recorded` prints only `.gitkeep`.
- `docker compose build app` succeeds; `docker run --rm get-me-there:local sh -c '! test -e /app/apps/camoufox-worker && ! test -e /app/node_modules/.pnpm/camoufox-js@0.11.5 && ! command -v firefox'`
  exits 0; `docker image ls get-me-there:local` is within 5 MB of main.
- CI's "app runs with the camoufox-worker absent" step passes.
- On the operator's machine: the worker starts against Camoufox 152.0.4-beta.28 through the launch shim; refuses
  (exit 78) another build, a `camoufox-js` other than 0.11.5, a missing or stale `SOCS` capture, a signed-in profile, a
  held lock, a group-readable `worker.env` and a non-loopback, non-bridge bind; `lsof -nP -iTCP:8090 -sTCP:LISTEN` shows
  127.0.0.1 (macOS) or the `docker0` address (Linux); the operator's smoke loads exactly one page and every row reads
  `ok` or `look`.
- Every task's checkbox ticked.

## 13. For the plan (not yet recorded there)

Decision 69 records the rulings. Items for Fable:

1. **Spec §8.1's resume bullet** should say that a manual `/resume` keeps a provider disabled when the execution holds a
   `blocked` outcome for it (the error-table row already does).
2. **Contracts:** `ProviderLimits.executionCallCap` and `pagesOnly`, `ExecutionBudget.providerMaxCalls`,
   `Reservation.finalise`'s `pageClass`, `ProviderHttpLimits.workerPort`, `workerScheme`, `retryTransport`,
   `connectRefusedKind` and `pageClass`, `DiscoveryQuery.airportNames`, `DiscoveryCapability.preflight`, the
   `camoufox-status` id and `core/src/camoufox/protocol.ts` belong in the plan's contract blocks.
3. **Re-dating** the selectors and grammar after a Google change, and re-verifying after an upgrade of `camoufox-js`,
   `playwright-core` or the binary, is a standing maintenance task (Task 14.1's recorder and the start-check pins).
4. **`SOCS` re-capture** every 13 months: the worker refuses a stale capture and the smoke reports its date; an operator
   notification a month before expiry, read from the status route, is a small follow-up.
5. **Grid mode** is a later work package: a recording of the grid, `providerMaxCalls`-aware tiling, a stored
   return-date source per price, the dash mapped to `no_data` until a recording shows its meaning, cells outside the
   query's nights ignored and cells outside the rectangle a FAIL (PIE-16, prov-007).
6. **"No flights" page:** until Task 14.1 records one, a day pair with no service reads `unrecognised` and pauses the
   provider for 1 h; the docs say so (cost-014).

## 14. Open questions

None. Decision 69 settled every `[needs judgment]` finding of round 1; the remaining findings follow their reviewers'
suggestions (Appendix A).

## Appendix A: round-1 findings and where each is answered

| Finding | Answer |
|---|---|
| devops-001, PIE-01, SEC-001 (no version or cookie route in camofox-browser) | Moot: the worker embeds Camoufox (decision 69); version from the bundle's `version.json` and `camoufox-js`'s `package.json` (§7, Task 14.1); cookies with `context.cookies()` (Tasks 14.3, 14.4). The `'unchecked'` variant is gone. |
| PIE-02 (auto-accept inside snapshot and click) | Moot: camofox-browser is never called; the worker clicks nothing on a consent page (Tasks 14.4, 14.11). |
| arch-001, PIE-14 (REST contract) | Moot: no REST client; the driver of Task 14.1 is the interface. |
| arch-002, devops-002 (image build) | Task 14.11: `.dockerignore`, filtered install and build, image assertions; Dockerfile and `.dockerignore` in §8. |
| arch-003 (test clocks) | §10 conventions: `fixedClock` everywhere. |
| arch-004 (parseConfig API) | Task 14.6's config test in `schema.test.ts`'s style. |
| arch-005, TS-07 (casts) | No casts: `portOf` guard (Task 14.5), zod-parsed recordings (Task 14.1). |
| arch-006 (finally ordering) | Task 14.4 rule 4 and its tests. |
| arch-007 (page cap from config) | Ruling 5: snapshot `providerMaxCalls` (Tasks 14.7, 14.9). |
| arch-008 (contract gaps) | All core changes in Task 14.6; `budgetConfig.ts` in Task 14.7; no `executionCallCap` on http limits. |
| arch-009, TS-04 (test imports) | Ruling 6 (Task 14.11 boundaries; the worker's devDependency). |
| arch-010, TS-01, cost-012, prov-012 (test correctness) | Unknown ids `kayak`, `browser`, `camofox`; real helpers (`freshDb`, `env.ts`, `defaultDefinitionInput`); flat db test files; no ids in inserts; every rebuilt table checked (Tasks 14.6, 14.7, 14.10). |
| arch-011 (protocol twice) | One zod copy in core (Task 14.6). |
| arch-012, SEC-010 (worker URL) | Loopback or `host.docker.internal`, explicit port; egress test over every accepted URL (Tasks 14.6, 14.8). |
| arch-013 (credential header) | `x-gmt-worker-key` in `CREDENTIAL_HEADERS` (Task 14.8). |
| arch-014, devops-003 (start from a fresh checkout) | The worker runs from source; `pnpm install` documented (Tasks 14.1, 14.12). |
| arch-015 (config shape) | `workerUrl` a validated string; every `ProviderLimits` value stated (§5, Task 14.6). |
| arch-016, TS-02, TS-03 (string scans) | Behavioural and compiler-API rules tests (Task 14.11). |
| cost-001, PIE-07 (retry amplification) | `retryTransport: false`, one-attempt tests (Task 14.8). |
| cost-002, PIE-08 (spacing mismatch) | Ruling 2: start to start; the N-pages test (Task 14.4). |
| cost-003 (worker absent) | Ruling 3: `provider-unavailable`, preflight (Tasks 14.8, 14.9, 14.11). |
| cost-004, cost-009, cost-011, prov-013 (estimate, coverage) | Task 14.9's estimate and `budgetFit`; ruling 11's copy (Tasks 14.10, 14.12). |
| cost-005 (budget entry) | Task 14.7. |
| cost-006, prov-009 (pages vs requests) | Ruling 2: `page_class`, `x-gmt-google-contacted` (Tasks 14.5, 14.7, 14.8, 14.12). |
| cost-007, devops-007, TS-09 (deadlines, failure paths) | Ruling 9 (Task 14.4 rules 4 and 7). |
| cost-008, devops-006 (persisted spacing, one instance) | Task 14.4's pacer; Task 14.1's lock. |
| cost-010 (check order) | Task 14.7. |
| cost-013 (smoke one-page row) | Task 14.13 counts `page` rows. |
| cost-014 (no-flights page) | Ruling 4; Task 14.1 records it; §13 item 6. |
| cost-015 (repeated notices) | Ruling 4: preflight and `operator_notice_keys` (Tasks 14.7, 14.9). |
| devops-004, SEC-013 (lifecycle, secrets on the command line) | Env file 0600, launchd example, exit 78, logs (Tasks 14.5, 14.12). |
| devops-005, SEC-011 (Linux bind) | Bind rule (Task 14.5), firewall and start order (Task 14.12), platform-specific DoD. |
| devops-008 (two run modes) | Task 14.12 step 4; the smoke's settings row. |
| devops-009, SEC-007, PIE-19, SEC-014 (camofox-browser binding and telemetry) | Moot: camofox-browser is not used; the docs say it need not run. |
| devops-010 (capture by hand) | `capture-socs` (Task 14.3). |
| devops-011 (signed-in refusal in memory) | Persisted refusal and `clear-signed-in` (Task 14.4). |
| devops-012 (CI step) | Task 14.11. |
| prov-001 (partial only as a note) | `CellIssue` with `offersDropped` (Task 14.8). |
| prov-002, PIE-05 (load completion) | `ready.ts` and polling (Tasks 14.2, 14.4). |
| prov-003 (return-date label) | Ruling 7: provenance note and a stored `last_error` detail (Task 14.8). |
| prov-004 (point of sale) | Dated table, stored as stated (Task 14.2). |
| prov-005 (other-date options) | Split counts (Tasks 14.2, 14.8). |
| prov-006, PIE-10 (airports, interstitials) | Ruling 7; enumerated interstitials (Task 14.2). |
| prov-007, PIE-16 (grid) | Grid not built; recorded for later (§13 item 5, spec §2). |
| prov-008 (blocked wording) | Task 14.10's copy table. |
| prov-010 (fetchedAt) | Task 14.8. |
| prov-011, PIE-15 (search form) | Ruling 7: `form.ts` (Task 14.2). |
| prov-014, prov-015, TS-19 (smoke and copy tests) | Tasks 14.10, 14.13; numeric sort in Task 14.2. |
| PIE-03, PIE-04, PIE-06, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-008, SEC-009, PIE-13 (camofox-browser routes, keys, persistence, snapshot window, probe) | Moot under decision 69; the consent probe now runs in a throwaway profile of the worker's own browser and never clicks (Task 14.1). |
| PIE-09 (Cheapest flow unverified) | Ruling 8 (Tasks 14.1, 14.4). |
| PIE-11 (stop policy) | Ruling 4: 1 h for unrecognised (Tasks 14.1, 14.4). |
| PIE-12 (SOCS stability, attributes) | `--socs-probe`, `SOCS_STABLE`, attributes captured (Tasks 14.1, 14.3). |
| PIE-17 (CAPTCHA detection) | Frame URLs and the `iframe` node (Task 14.1). |
| PIE-18 (time per page) | 50–90 s, stated (spec §2, Tasks 14.9, 14.12). |
| SEC-012 (worker secret length) | Task 14.5. |
| SEC-015 (recordedBy, account traces) | Task 14.1's recorder rules. |
| TS-05 (recorder tests) | Task 14.1's `record.test.ts`. |
| TS-06 (config tests) | Task 14.5's `config.test.ts`. |
| TS-08 (TDD sequencing) | The source scan is gone; behavioural tests live with the code they test. |
| TS-10 (read-back on every path) | Task 14.4 rule 5. |
| TS-11 (classifier gaps) | Task 14.1's cases. |
| TS-12 (worker gates) | Ruling 10 (Task 14.1's configs, §12). |
| TS-13 (vacuous recorded tests) | Per-kind gating and the unconditional flag test (Task 14.1). |
| TS-14 (vacuous engine assertions) | Exact counts (Task 14.9). |
| TS-15 (server rows) | Task 14.5. |
| TS-16 (adapter cases) | Task 14.8. |
| TS-17 (test counts) | "PASS, no skipped tests" (§10). |
| TS-18 (boundary cases) | Tasks 14.1, 14.3. |
