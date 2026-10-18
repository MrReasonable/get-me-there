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
review (4 Critical, 29 High, 51 Medium, 27 Low) and the round-2 re-review (3 High from round 1 marked partial, 38 new
findings; both under `~/.cache/get-me-there/review-spec/wp14-browser-provider/`). The operator's rulings on both are plan
decision 69 (round 2 is its second paragraph); every finding is addressed, and Appendix A lists each finding ID with
where this brief answers it.

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
- *What the evidence does not cover* (PIE-R2-11): both loads ran through camofox-browser's own launch (`humanize: true`,
  `enable_cache: true`, uBlock Origin unless disabled), and the signed-in one through the operator's account. The worker
  launches without humanise, cache preferences or uBlock, so its "no challenge" is unproven until its own recordings;
  every recording's meta stores the launch options the worker actually used (minus `env`), which makes the first worker
  recordings the evidence for this configuration.

Neither load saw the Cheapest tab selected, the search form's fields, a "no flights" page, the grid's contents or a
consent page in a profile carrying a pre-set rejection. Task 14.2 records those, in the order decision 69 sets and before
any parser depends on them; Task 14.1 builds only what the recorder needs, and loads no Google page.

## 1. Goal

Build an opt-in, off-by-default `camoufox` discovery provider that reads the cheapest round-trip price Google Flights
lists for one day pair per page, in the operator's own Camoufox launched by a host-side worker in its own signed-out
profile, at a fixed low rate, stopping at once on any page that is not a recognised results page, behind the same contract,
ledger, caps and labels as every other provider.

## 2. Scope

**In**

- **Recordings first** (Tasks 14.1, 14.2): the launch through `camoufox-js`'s install layout, the locator driver, the
  guards, the classifier, the cool-down, the lock, the `SOCS` capture, the pacer and the recorder; then the operator
  records, in decision 69's order, the `SOCS` capture, the results, Cheapest and View-more pages with `SOCS` pre-set
  (and the stability check), the consent probe in a throwaway profile, and a "no flights" page, before any parser is
  written against them.
- **The worker** `apps/camoufox-worker` (Tasks 14.1–14.5, macOS only): launch through `camoufox-js`'s own install layout
  with the pinned build, service workers blocked; the locator-based page driver; the classifier (blocked kinds first; cool-down by cause); the dated selectors
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
- Linux or any other host: the worker refuses to start off macOS (decision 69, round 2).
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
`BrowserContext` from `firefox.launchPersistentContext`; `launchOptions(...)`'s fields `ff_version`, `exclude_addons`,
`headless`, `geoip`, `os`, `locale`, `env`, `firefox_user_prefs`, `i_know_what_im_doing`, and its pass-through of other
Playwright launch options (`serviceWorkers`, the signal handlers); its install directory, `INSTALL_DIR`, which is
`~/Library/Caches/camoufox` unless `CAMOUFOX_INSTALL_DIR` is set (the worker never sets it). From `playwright-core` 1.59.1: `BrowserContext.cookies(urls?)`, `addCookies`,
`clearCookies`, `route`, `newPage`, `close`, `on('request')`; `Page.goto({ timeout, waitUntil: 'domcontentloaded' })`,
`url`, `frames`, `on('framenavigated')`, `getByRole(role, { name })`, `getByText`; `Locator.count`, `nth`,
`getAttribute('aria-label', { timeout })`, `textContent({ timeout })`, `click({ timeout })`; `Route.abort`,
`Route.fallback`, `Route.request`; `Request.isNavigationRequest`, `Request.url`, `Request.redirectedFrom`; the launch
option `serviceWorkers: 'block'`.

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
                                  // ratePerMinute = max(1, floor(60 / spacing)) and ratePerHour = floor(3600 / spacing) (display and
                                  // reservoirs only; the start spacing is minIntervalMs = spacing × 1000), concurrency 1,
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
export const workerStatusSchema;     // { ok; coolingDownUntil; cooldownCause; signedInRefusal; lastPageAt; busySince; versions;
                                     //   flags: Record<string, boolean>; accountCookie: { found: boolean; names: string[]; checkedAt };
                                     //   socsCapturedAt; socsStable; cooldownHours; pageTimeoutSeconds }  (live values, SEC-R2-004, TS2-17)
export const GOOGLE_CONTACTED_HEADER = 'x-gmt-google-contacted';   // '1' | '0' on every answer

// packages/providers/src/camoufox/index.ts
export const CAMOUFOX_DISPLAY_NAME = 'Google Flights via Camoufox';
export const CAMOUFOX_DISCOVERY_INFO: CapabilityInfo;      // scraped-self, maxAgeHours 0, the spec §2 provenance note
export function planSingleCells(q: DiscoveryQuery): TilePlan[];
export function camoufoxProvider(o: { http: HttpKit; log: Logger; clock: Clock; key: Secret; workerUrl: string; pointOfSale: string }): FlightProvider;
export function camoufoxHttpLimits(c: NonNullable<Config['providers']['camoufox']>, cfg: Pick<Config, 'maxWaitSeconds'>): ProviderHttpLimits;
// packages/providers/src/http/types.ts
export interface ProviderHttpLimits { /* existing fields */ minIntervalMs?: number }   // when set, the limiter's minTime (start to start), in place of ceil(60000 / ratePerMinute)
```

The worker's own modules (`apps/camoufox-worker/src`) export nothing to other packages; nothing imports the worker.

## 6. Endpoints and parameters

**Worker** (host-side, `CAMOUFOX_WORKER_URL`, default `http://127.0.0.1:8090`). Every request carries
`x-gmt-worker-key` (constant-time compare over equal-length buffers; a mismatch, a missing header or a length mismatch is
401 with no body detail). Every answer carries `x-gmt-google-contacted: 1|0`.

| Route | Answer | Status | Google contacted |
|---|---|---|---|
| `GET /v1/status` | `workerStatusSchema`: live values, the account-cookie check run on request (a cookie read, no page load) with its names and time | 200 | no |
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

**Navigation allowlist** (worker `src/guard.ts`). A navigation is allowed only to `https://www.google.com` with a path
equal to `/travel/flights` or under `/travel/flights/` (so `/travel/flightsevil` is refused). It is enforced three ways,
because `context.route` sees only a redirect's first URL and nothing a service worker answers (playwright-core 1.59.1
`types.d.ts`, `route`; PIE-R2-05, SEC-R2-007): the context blocks service workers (`serviceWorkers: 'block'`);
`context.route('**/*')` aborts any document or frame request off the allowlist with `blockedbyclient`; and
`page.on('framenavigated')` plus `context.on('request')` record every navigation's final URL and each redirect hop
(`request.redirectedFrom()` chain), so a 302 to another host stops the page however it arrived. A hop or final URL on
`consent.google.com` is `consent-unhandled`, on `accounts.google.com` `sign-in`, anywhere else `off-allowlist`.
Subresources load as in any browser. The one exception is the recorder's consent probe (Task 14.2), which uses its own
guard variant that also admits `https://consent.google.com/` documents, in a throwaway profile, with a driver that has
no click method; nothing on the server path can reach it (a test pins this, as for grid). The worker clicks only names
its selectors module marks verified.

**Account cookies** (`src/accountCookies.ts`, dated 2026-10-18; PIE-R2-08, SEC-R2-002). Read with
`context.cookies()` and no URL argument, then filtered to domains equal to or under `google.com`, which covers both
`https://www.google.com` and `https://accounts.google.com`. The profile is signed in when any of them is named in the
set below, or when any cookie at all is host-only on `accounts.google.com`. Only names are read; values are never
logged.

`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-1PSID`, `__Secure-3PSID`, `__Secure-1PAPISID`,
`__Secure-3PAPISID`, `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `__Secure-1PSIDCC`, `__Secure-3PSIDCC`, `SIDCC`, `LSID`,
`__Host-1PLSID`, `__Host-3PLSID`, `__Host-GAPS`, `OSID`, `__Secure-OSID`, `ACCOUNT_CHOOSER`.

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
- **The launch path (decision 69 round 2, item 1; PIE-R2-03).** Without `executable_path`, `launchOptions` resolves the
  binary through `launchPath()` → `getPath('../MacOS/camoufox')` under `INSTALL_DIR/Camoufox.app/Contents/Resources`,
  and `loadProperties()` reads `Contents/Resources/properties.json` the same way; `camoufoxPath()` first checks that
  `INSTALL_DIR` is non-empty and that `Version.fromPath(INSTALL_DIR)` (the **top-level** `INSTALL_DIR/version.json`,
  read as `{version, release}`) is supported, and **starts an unawaited download (`CamoufoxFetcher().install()`) when
  the directory is missing, empty or unsupported**. On the operator's Mac that layout already exists and is the one the
  2026-10-18 loads used: `~/Library/Caches/camoufox/Camoufox.app` is a symlink to
  `browsers/official/152.0.4-beta.28-8b7680a6/Camoufox.app`, and the top-level `version.json` reads
  `{"version":"152.0.4","release":"beta.28"}`. The worker checks both entries at start and creates any that is
  missing (the symlink to the bundle it was configured with, and the top-level file written from the bundle's own
  `version.json`), so `camoufoxPath()` never reaches its download branch; it never modifies the bundle. Round 1's
  shim and its precedent are withdrawn: camofox-browser's `findResourceDir` looks for `properties.json` only beside the
  binary and its realpath, so its executable override does not fit this bundle either.
- **Versions.** The bundle's own `version.json` reads `{"version":"152.0.4","build":"beta.28",…,"sha256":"8b7680a6…"}`
  (the build named `build`); the top-level one uses `release`. The worker reads the bundle's file itself, checks its
  shape (`version` matching `^\d+\.`, a `build` or `release` string) **before** the pin (TS2-09), compares
  `<version>-<build>` with `CAMOUFOX_BINARY_BUILD` (default `152.0.4-beta.28`), and passes
  `ff_version: Number(version.split('.')[0])` with `i_know_what_im_doing: true`, which only silences the `ff_version`
  leak warning (no manual `config` and no custom fingerprint are passed). This decouples the Firefox major from the
  top-level file; it is not a workaround for a crash (round 1's claim that `camoufox-js` would read the bundle's file was
  wrong).
- **macOS only** (PIE-R2-04). On Linux `getEnvVars` reads `getPath('fontconfig/<os>')` from `INSTALL_DIR` and could
  trigger the download branch; this build does not support Linux, and `main.ts` refuses any `process.platform` but
  `darwin` with a clear message.
- `addDefaultAddons` downloads uBlock Origin from addons.mozilla.org through Node when its directory is missing: the
  worker passes `exclude_addons: ['UBO']`, so no add-on is fetched or read (the 2026-10-18 loads, through
  camofox-browser, may have run with it; PIE-R2-11).
- `geoip: true` would call a public-IP lookup and download a GeoIP database (`dist/ip.js`, `dist/locale.js`): the worker
  passes `geoip: false`. `proxy` is never passed. `humanize` is never passed (default off).
- **Background connections** (SEC-R2-008): the browser's own services are not covered by the above. The worker passes
  `firefox_user_prefs` that switch off telemetry (`toolkit.telemetry.enabled`, `datareporting.healthreport
  .uploadEnabled`, `datareporting.policy.dataSubmissionEnabled`), crash-report submission
  (`browser.crashReports.unsubmittedCheck.autoSubmit2`), Normandy (`app.normandy.enabled`) and the captive-portal check
  (`network.captive-portal-service.enabled`), and leaves safe browsing at the binary's default (a fingerprint signal if
  changed; a stated background connection to Google). The launch smoke records every host the context's requests reach
  while `about:blank` sits for 10 s.
- `env`: when absent, `launchOptions` passes the **whole `process.env`** to the browser. The worker passes a minimal
  `env` (`HOME`, `PATH`, `TMPDIR`, `LANG=en_GB.UTF-8`), so its own key never reaches the browser process.
- Other Playwright options pass through `...launch_options`; the worker sets `serviceWorkers: 'block'` and
  `handleSIGTERM`, `handleSIGINT` and `handleSIGHUP` to `false` (the worker's own shutdown closes the context).
- **Deadlines** (PIE-R2-06): `goto`, `click`, `getAttribute`, `textContent` and the readiness polls each
  take their own `timeout` (the remaining page deadline) where the API has one; one page deadline closes the page,
  which rejects any pending call; every promise raced against the deadline has a no-op `catch` attached; the `finally`
  steps (`SOCS` read-back, page close) each run under their own 5 s bound, and overrunning one discards the context
  (relaunched lazily) and answers `browser-error` `read`.
- `camoufox-js` uses `Math.random` for fingerprint seeds; that is Camoufox's own fingerprint, not a worker delay.
- **playwright-core 1.59.1**: the version camofox-browser 1.13.1 ships beside `camoufox-js` 0.11.5 and runs Camoufox
  152.0.4-beta.28 with (Juggler compatibility). The workspace's other Playwright (`@playwright/test` 1.64.1 in
  `apps/web`) is unrelated. `BrowserContext.cookies(urls?)`, `addCookies(cookies)` and `clearCookies(options?)` are
  verified in `types/types.d.ts` (lines 9036, 8908, 8985 of the 1.59.1 copy). **The printed aria snapshot is never
  parsed** (PIE-R2-02): its YAML quoting, attributes, `/url` children and 900-character name cut make it an unsound
  input. The worker reads roles and accessible names through locators (`getByRole(role, { name })`, the link's
  `aria-label` or, when absent, its text), and counts and reads result links one by one.
- An upgrade of `camoufox-js`, `playwright-core` or the binary is a re-verification: the start checks refuse any other
  `camoufox-js` version (read from its `package.json`) or binary build.

## 8. Files

Create:

- `apps/camoufox-worker/`: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`,
  `stryker.config.json`, `launchd/local.get-me-there.camoufox-worker.plist.example`,
  `fixtures/recorded/<kind>/.gitkeep` for each recording kind
- `apps/camoufox-worker/src/`: `run.ts` (the one launcher every script goes through: resolves `<data>/worker.env`,
  checks its mode, loads it with `process.loadEnvFile`, dispatches; the only `process.env` reader), `main.ts`,
  `record.ts`, `captureSocs.ts`, `clearSignedIn.ts`, `status.ts` (entry functions run by `run.ts`), `paths.ts`,
  `config.ts`, `platform.ts`, `install.ts`, `launch.ts`, `lock.ts`, `driver.ts`, `selectors.ts`, `classify.ts`,
  `guard.ts`, `accountCookies.ts`, `cooldown.ts`, `socs.ts`, `pacer.ts`, `url.ts`, `ready.ts`, `names.ts`,
  `airports.ts`, `form.ts`, `list.ts`, `pointOfSale.ts`, `refusal.ts`, `session.ts`, `server.ts`, `timers.ts`
- `apps/camoufox-worker/test/`: `support/{fakePage.ts,fakeContext.ts,tmp.ts,timers.ts}`, one test file per source
  module, `launch.smoke.test.ts`, `recorded.test.ts`, `rules.test.ts`
- `packages/core/src/camoufox/protocol.ts` and `packages/core/test/camoufox/protocol.test.ts`
- `packages/providers/src/camoufox/`: `index.ts`, `provider.ts`, `tiles.ts`, `answer.ts`, `limits.ts`, `preflight.ts`
- `packages/providers/src/testing/recordings.ts` gains `recordingsPresentForKind(root, kind)` (TS2-12)
- `packages/providers/test/camoufox/`: `tiles.test.ts`, `fetchTile.test.ts`, `limits.test.ts`, `egress.test.ts`,
  `preflight.test.ts`, `recorderHeaders.test.ts`; `packages/providers/test/http/limiter.minInterval.test.ts`
- `packages/db/drizzle/0005_camoufox_provider.sql` (and its meta snapshot); `packages/db/test/migration0005.test.ts`,
  `packages/db/test/budgetGuard.providerExecution.test.ts`, `packages/db/test/budgetConfig.camoufox.test.ts`
- `packages/engine/test/camoufoxRows.test.ts`, `packages/engine/test/camoufoxEstimate.test.ts`,
  `packages/engine/test/support/camoufox.ts`

Modify:

- `packages/core/src/types/provenance.ts`, `errors.ts`, `ports/budget.ts`, `ports/provider.ts`, `types/execution.ts`,
  `types/definition.ts`, `labels/source.ts`, `config/schema.ts`, `config/presets.ts`, `index.ts`, and their tests
- `packages/db/src/internal/enums.ts`, `budgetConfig.ts`, `budgetGuard.ts`, `schema/*.ts`
- `packages/providers/src/http/egress.ts`, `http/httpKit.ts`, `http/types.ts`, `http/classify.ts`, `http/attempt.ts`,
  `http/limiter.ts`, `http/cacheKey.ts` (`CREDENTIAL_HEADERS`), `test/fakes.ts` (`testLimits.camoufox`)
- `packages/engine/src/run.ts`, `resume.ts`, `estimate.ts`, `budgetFit.ts`, `start.ts`, `stages/discovery.ts`,
  `notify.ts`
- `apps/api/src/wiring.ts`, `apps/api/src/read/usage.ts`, `apps/api/src/tools/smoke.ts`, `smokeChecks.ts`,
  `apps/web/src/copy.ts`, `.env.example`
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.gitignore`, `package.json` (root build filter and `mutate`),
  `scripts/check-boundaries.mjs`, `scripts/workflows.test.mjs`, `scripts/ci-gates.test.mjs`, `.github/workflows/ci.yml`
- `docs/setup.md`, `docs/providers.md`, `docs/api-limits.md`, `docs/scheduling.md` (generated rows)

## 9. Pages the worker recognises, and what is verified

The classifier is a pure function of a `PageFacts` value that the driver reads through locators (decision 69 round 2,
item 5): `{ url, hops: string[], frameUrls: string[], text: { unusualTraffic, consentHeading, signInHeading,
challenge, noFlights }, accountControl: boolean, cheapestTabs: { name; inTablist: boolean }[], dateGridButtons: number,
resultLinks: number }`. Each field is one locator query (`getByRole(role, { name })`, `getByText(pattern)`,
`page.frames()`), each with its own timeout. The classifier is total over any input (an unparsable URL is
`off-allowlist`) and takes its selectors as a parameter with the module's as the default, so every flag is testable in
both states (TS2-04). The order below is the code's order; the first match wins.

| Order | Kind | Rule (selectors module) | Evidence | Cool-down |
|---|---|---|---|---|
| 1 | `captcha` | a frame URL on `www.google.com` with path under `/recaptcha/`, or the page's challenge text (for example "not a robot") | the realistic signals (PIE-R2-09: an iframe carries no accessible name in 1.59.1, so no name rule) | 48 h |
| 2 | `unusual-traffic` | URL or a hop with path under `/sorry/`, or text matching /unusual traffic/i | generic | 48 h |
| 3 | `signed-in` | a `button` or `link` whose accessible name starts "Google Account:" (`getByRole(role, { name: /^Google Account: / })`) | feasibility load showed it | 48 h + persisted refusal |
| 4 | `consent-unhandled` | URL or a hop on `consent.google.com`, or a `heading` named "Before you continue" | signed-out test | 48 h |
| 5 | `sign-in` | URL or a hop on `accounts.google.com`, or a `heading` named "Sign in" | generic | 48 h |
| 6 | `off-allowlist` | URL or a hop not `https://www.google.com/travel/flights` or under `/travel/flights/` | rule | 48 h |
| 7 | `no-flights` | the recorded "no flights" line (Task 14.2), only when `NO_FLIGHTS_VERIFIED` | Task 14.2 | none; `no_data` |
| 8 | `results` | exactly one Cheapest tab, inside a `tablist`; exactly one `button` named "Date grid"; at least one result link | feasibility load | — |
| 9 | `unrecognised` | anything else, and a `results` page whose search form disagrees with the query | rule | 1 h, provider disabled for the run |

Settled (`ready.ts`): a `results` page is read only when the text "<N> results returned." is present, no element's text
or name contains "Fetching results", the Cheapest tab's name carries a price, and there is at least one result link; the
session polls every `pollMs` (default 2 000, injectable) within the page deadline, classifying blocked kinds on every
poll. Not settled by the deadline: `not-ready` (no cool-down).

Verification flags in `selectors.ts` (each flips only in the commit that adds the recording proving it; the recorded
suite pins it; `/v1/status` reports them in `flags`): `RESULTS_VERIFIED` (true: feasibility load), `FORM_VERIFIED`,
`CHEAPEST_FLOW_VERIFIED`, `VIEW_MORE_ADDS_CHEAPER`, `NO_FLIGHTS_VERIFIED`, `SOCS_STABLE`, `GRID_VERIFIED` (false until
Task 14.2's recordings; `GRID_VERIFIED` stays false in this work package). The server refuses to start while
`FORM_VERIFIED` is false (the search-form check is mandatory); the recorder runs without it.

## 10. Tasks

Conventions for every task:

- Test clocks are `fixedClock(asIsoDateTime(…))` from `@gmt/core`. Waits go through `timers.ts`
  (`sleep(ms, signal)`, `deadline(ms)`), which tests replace with `test/support/timers.ts`, a fake that advances the
  fixed clock and resolves at once, so no test waits in real time (TS2-16).
- No casts (`check-casts.mjs` scans tests too): narrow with guards or parse with the zod schemas.
- Each step's expected result is "PASS, no skipped tests" unless stated. No `it` body is a comment: every case named in
  a task is written in full in the task, or marked `it.todo` in a first commit (which "PASS, no skipped tests" then
  flags); files with several cases call `expect.hasAssertions()` in a `beforeEach` (TS2-08).
- Worker tests are pure (fake page and context objects shaped like Playwright's, a temp data directory). The one
  exception is `launch.smoke.test.ts` (Task 14.1), which needs the real binary and runs only where `CAMOUFOX_BINARY_BUILD`
  matches an installed bundle, skipping visibly elsewhere.
- Tasks are ordered so each one's prerequisite modules exist before its tests run (TS2-03): Task 14.1 builds everything
  except the recorder's Google-facing parts and loads no Google page; Task 14.2 adds the rest the recorder needs, and
  the operator records; Tasks 14.3–14.5 build the readers, the session and the server against those recordings.

### Task 14.1: Scaffold, platform and install layout, launch, driver, guards, classifier, cool-down, lock (first failing test)

**Files:** create `apps/camoufox-worker/{package.json,tsconfig.json,tsconfig.test.json,vitest.config.ts,stryker.config.json}`,
`src/{run.ts,paths.ts,platform.ts,install.ts,launch.ts,lock.ts,driver.ts,selectors.ts,classify.ts,guard.ts,accountCookies.ts,cooldown.ts,timers.ts}`,
`test/support/*`, `test/{platform,install,launch,lock,driver,classify,guard,accountCookies,cooldown,run}.test.ts`,
`test/launch.smoke.test.ts`; `.gitignore`.

`package.json` (TS2-02, TS2-05, SEC-R2-006):

```json
{
  "name": "@gmt/camoufox-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node --conditions=@gmt/source --import tsx src/run.ts main",
    "record": "node --conditions=@gmt/source --import tsx src/run.ts record",
    "capture-socs": "node --conditions=@gmt/source --import tsx src/run.ts capture-socs",
    "clear-signed-in": "node --conditions=@gmt/source --import tsx src/run.ts clear-signed-in",
    "status": "node --conditions=@gmt/source --import tsx src/run.ts status",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run --coverage",
    "mutate": "stryker run && node ../../scripts/mutation-gate.mjs reports/mutation/mutation.json"
  },
  "dependencies": { "@gmt/core": "workspace:*", "camoufox-js": "0.11.5", "playwright-core": "1.59.1" },
  "devDependencies": { "@gmt/providers": "workspace:*", "@stryker-mutator/core": "10.0.0" }
}
```

(`tsx`, `vitest`, `@vitest/coverage-v8` and `typescript` copy `apps/api`'s entries; `@stryker-mutator/core` copies
`packages/core`'s. The worker runs from source, so a fresh checkout needs only `pnpm install`. `stryker.config.json`
copies core's: command runner, concurrency 2, explicit timeouts, `thresholds.break: 80`, the JSON reporter at
`reports/mutation/mutation.json`, mutating `classify.ts`, `cooldown.ts`, `pacer.ts`, `socs.ts`, `names.ts`, `guard.ts`,
`ready.ts`, `accountCookies.ts`; the gate script then checks the 5% timeout share. The root `pnpm mutate` runs it after
core's.) `vitest.config.ts` sets the package floor 90/80/90/90 and 100 lines and branches on those eight modules;
`scripts/ci-gates.test.mjs` gains an assertion that every package's `test` script enables coverage.

`src/run.ts` and `src/paths.ts` (SEC-R2-006, ruling 11): `dataDir()` is `~/.local/state/get-me-there/camoufox`;
`workerEnvFile()` is `<data>/worker.env`; `run.ts` refuses (exit 78) when the directory is not 0700 or the file is not
0600 and the user's own, then calls `process.loadEnvFile(workerEnvFile())` on that same path, then dispatches to the named
entry function. Every command goes through it, so there is one path and the mode check is on the file loaded.
`run.test.ts`: a 0644 file refuses; a 0755 directory refuses; a file owned by another user refuses (skipped visibly as
root); the loaded path is the checked path.

- [ ] **Step 1: Write the failing test** — `test/classify.test.ts` (pure over `PageFacts`; TS-11, TS2-15, PIE-R2-09):

```ts
import { describe, expect, it } from 'vitest';
import { classifyPage, type PageFacts } from '../src/classify.js';
import { SELECTORS } from '../src/selectors.js';

const RESULTS = 'https://www.google.com/travel/flights/search?tfs=x';
const facts = (o: Partial<PageFacts> = {}): PageFacts => ({
  url: RESULTS, hops: [], frameUrls: [],
  text: { unusualTraffic: false, consentHeading: false, signInHeading: false, challenge: false, noFlights: false },
  accountControl: false, cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }], dateGridButtons: 1, resultLinks: 3,
  ...o,
});
const t = (o: Partial<PageFacts['text']>) => ({ ...facts().text, ...o });

describe('classifyPage (spec §2, brief §9; blocked kinds first, total)', () => {
  it.each([
    ['a reCAPTCHA frame URL alone', facts({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=x'] }), 'captcha'],
    ['challenge text alone', facts({ text: t({ challenge: true }) }), 'captcha'],
    ['the /sorry/ URL', facts({ url: 'https://www.google.com/sorry/index?continue=x' }), 'unusual-traffic'],
    ['a /sorry/ hop before a results URL', facts({ hops: ['https://www.google.com/sorry/index'] }), 'unusual-traffic'],
    ['unusual-traffic text', facts({ text: t({ unusualTraffic: true }) }), 'unusual-traffic'],
    ['a signed-in control on a full results page', facts({ accountControl: true }), 'signed-in'],
    ['a consent URL', facts({ url: 'https://consent.google.com/ml?continue=x' }), 'consent-unhandled'],
    ['a consent hop (302) ending on results', facts({ hops: ['https://consent.google.com/ml'] }), 'consent-unhandled'],
    ['a consent heading', facts({ text: t({ consentHeading: true }) }), 'consent-unhandled'],
    ['an accounts.google.com hop', facts({ hops: ['https://accounts.google.com/ServiceLogin'] }), 'sign-in'],
    ['a sign-in heading', facts({ text: t({ signInHeading: true }) }), 'sign-in'],
    ['www.google.com outside /travel/flights', facts({ url: 'https://www.google.com/search?q=x' }), 'off-allowlist'],
    ['/travel/flightsevil', facts({ url: 'https://www.google.com/travel/flightsevil' }), 'off-allowlist'],
    ['an off-allowlist hop', facts({ hops: ['https://www.example.test/x'] }), 'off-allowlist'],
    ['plain http', facts({ url: 'http://www.google.com/travel/flights' }), 'off-allowlist'],
    ['an unparsable URL', facts({ url: 'not a url' }), 'off-allowlist'],
    ['no Date grid button', facts({ dateGridButtons: 0 }), 'unrecognised'],
    ['two Cheapest tabs', facts({ cheapestTabs: [{ name: 'Cheapest from 1 British pounds', inTablist: true }, { name: 'Cheapest from 2 British pounds', inTablist: true }] }), 'unrecognised'],
    ['the only Cheapest tab outside a tablist', facts({ cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: false }] }), 'unrecognised'],
    ['no result links', facts({ resultLinks: 0 }), 'unrecognised'],
  ])('%s → blocked:%s', (_n, f, page) => {
    expect(classifyPage(f)).toEqual({ kind: 'blocked', page });
  });
  it('the feasibility-shaped results page is results', () => {
    expect(classifyPage(facts())).toEqual({ kind: 'results' });
  });
  it('a consent heading beside a sign-in heading is consent-unhandled (row 4 before row 5)', () => {
    expect(classifyPage(facts({ text: t({ consentHeading: true, signInHeading: true }) }))).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
  });
  it('no-flights text is no-flights only when the flag is set (injected selectors)', () => {
    const f = facts({ text: t({ noFlights: true }), resultLinks: 0 });
    expect(classifyPage(f)).toEqual({ kind: 'blocked', page: 'unrecognised' });
    expect(classifyPage(f, { ...SELECTORS, NO_FLIGHTS_VERIFIED: true })).toEqual({ kind: 'no-flights' });
  });
});
```

`test/cooldown.test.ts`: as round 1, plus (TS2-06, TS2-17): equal ends keep the earlier-recorded cause (ties keep the
current record); a consent-unhandled start over an active captcha of the same end keeps `captcha`; the EACCES case is
`it.skipIf(process.getuid?.() === 0)` with a title ending "(skipped as root)".

`test/accountCookies.test.ts` (ruling 8, PIE-R2-08, SEC-R2-002): `it.each` over every name of brief §6's set, each on
`.google.com`, asserting `found: true` and the name in `names`; a host-only cookie of any name on `accounts.google.com`
→ found; `NID` and `SOCS` on `.google.com` → not found; a set name on `.example.test` → not found; the reader passes no
URL to `context.cookies()` (asserted on the fake); values never appear in the result.

`test/platform.test.ts`: `darwin` passes; `linux` and `win32` refuse with "the camoufox worker supports macOS only".

`test/install.test.ts` (ruling 1, PIE-R2-03) over a temp home holding a fake bundle
`browsers/official/<id>/{Camoufox.app/Contents/{MacOS/camoufox,Resources/properties.json},version.json}`: with both
entries present and correct, nothing is written; with `Camoufox.app` missing, the symlink is created pointing at the
configured bundle; with the top-level `version.json` missing, it is written as `{"version","release"}` from the bundle's
`{version, build}`; a top-level `version.json` that disagrees with the bundle, or a `Camoufox.app` symlink to another
bundle, refuses (never rewritten silently); `CAMOUFOX_INSTALL_DIR` set in the environment refuses; the bundle's files
are byte-identical afterwards (never modified); the shape check runs before the pin, so `{ version: 'x.0', build:
'beta.28' }` and `{ version: '152.0.4' }` fail naming `version.json`, and `{ version: '152.0.4', build: 'beta.29' }`
fails naming `CAMOUFOX_BINARY_BUILD` (TS2-09); `release` is accepted where `build` is absent.

`test/launch.test.ts`: `buildLaunchOptions(...)` is exactly `{ headless: true, locale: 'en-GB', os: 'macos',
ff_version: 152, i_know_what_im_doing: true, exclude_addons: ['UBO'], geoip: false, serviceWorkers: 'block',
handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false, env: { HOME, PATH, TMPDIR, LANG: 'en_GB.UTF-8' },
firefox_user_prefs: { the six prefs of §7 } }`, with no `executable_path`, `proxy`, `humanize`, `fingerprint` or
`config` key (asserted by key list).

`test/guard.test.ts`: the pure `decideRoute(url, isNavigation)` cases of round 1; `installGuard(fakeContext,
fakePage, log)` registers `context.route('**/*')`, `page.on('framenavigated')` and `context.on('request')`, and a
navigation request with a `redirectedFrom()` chain through `consent.google.com` records that hop (TS2-04); the probe
variant `installProbeGuard` also admits `https://consent.google.com/` documents and nothing else; `installProbeGuard` is
not imported by `session.ts` or `server.ts` (compiler-API check in Task 14.11).

`test/driver.test.ts` (ruling 5, ruling 6, PIE-R2-06, PIE-R2-10) over a fake page: `readFacts()` builds `PageFacts` from
locator results; `resultNames()` returns one entry per link inside a result `listitem`, reading `aria-label` and
falling back to `textContent`, with a nameless link as `''` and a name over 4 000 characters returned as `null`
(counted unparsed upstream, never dropped); every call passes `timeout` equal to the remaining deadline; a call that
never resolves rejects when the deadline closes the page, and a `process.on('unhandledRejection')` spy records nothing;
the bounded `finally` helpers give up after 5 s of fake time and report `overran: true`.

`test/lock.test.ts`: as round 1, plus a start-up sweep that removes `<data>/probe-*` directories left by a killed run
(SEC-R2-003).

`test/launch.smoke.test.ts` (ruling 1, TS2-13, SEC-R2-008), skipped visibly unless the installed bundle's build equals
`CAMOUFOX_BINARY_BUILD`: verifies or creates the install layout in the real `~/Library/Caches/camoufox`; launches with
`buildLaunchOptions` into a temp profile; opens `about:blank` (never Google) and waits 10 s; asserts
`navigator.userAgent` contains `Firefox/152`; reads `context.cookies()` (expecting none); records every request host
the context saw (expecting none to `addons.mozilla.org`, `github.com` or an IP-lookup host); asserts a navigation to
`https://www.example.test/` is aborted by the guard; closes cleanly; writes the observed hosts and the launch options
(minus `env`) to `fixtures/recorded/launch/<date>.meta.json` (local-only).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/camoufox-worker test`; FAIL, the source modules do not
exist.

- [ ] **Step 3: Implement** the modules as the tests pin. `classify.ts`:

```ts
import type { BlockedPage } from '@gmt/core';
import { SELECTORS, type Selectors } from './selectors.js';

export interface PageFacts {
  url: string; hops: string[]; frameUrls: string[];
  text: { unusualTraffic: boolean; consentHeading: boolean; signInHeading: boolean; challenge: boolean; noFlights: boolean };
  accountControl: boolean; cheapestTabs: Array<{ name: string; inTablist: boolean }>; dateGridButtons: number; resultLinks: number;
}
export type PageKind = { kind: 'results' } | { kind: 'no-flights' } | { kind: 'blocked'; page: BlockedPage };

function urlOf(s: string): URL | null {
  try { return new URL(s); } catch { return null; }
}
/** Brief §9: blocked kinds first; total; selectors injected so every flag is testable both ways. */
export function classifyPage(f: PageFacts, S: Selectors = SELECTORS): PageKind {
  const all = [f.url, ...f.hops].map(urlOf);
  const onHost = (h: string) => all.some((u) => u !== null && u.hostname === h);
  if (f.frameUrls.some((x) => { const u = urlOf(x); return u !== null && u.hostname === S.hosts.results && u.pathname.startsWith(S.blocked.captchaPath); }) || f.text.challenge)
    return { kind: 'blocked', page: 'captcha' };
  if (all.some((u) => u !== null && u.pathname.startsWith(S.blocked.sorryPathPrefix)) || f.text.unusualTraffic) return { kind: 'blocked', page: 'unusual-traffic' };
  if (f.accountControl) return { kind: 'blocked', page: 'signed-in' };
  if (onHost(S.hosts.consent) || f.text.consentHeading) return { kind: 'blocked', page: 'consent-unhandled' };
  if (onHost(S.hosts.signIn) || f.text.signInHeading) return { kind: 'blocked', page: 'sign-in' };
  const allowed = (u: URL | null) => u !== null && u.protocol === 'https:' && u.hostname === S.hosts.results && (u.pathname === S.resultsPath || u.pathname.startsWith(`${S.resultsPath}/`));
  if (!all.every(allowed)) return { kind: 'blocked', page: 'off-allowlist' };
  if (S.NO_FLIGHTS_VERIFIED && f.text.noFlights) return { kind: 'no-flights' };
  const tabs = f.cheapestTabs;
  if (tabs.length === 1 && tabs.every((x) => x.inTablist) && f.dateGridButtons === 1 && f.resultLinks > 0) return { kind: 'results' };
  return { kind: 'blocked', page: 'unrecognised' };
}
```

(The challenge, unusual-traffic, consent and sign-in text facts come from `getByText`/`getByRole('heading', { name })`
queries named in `selectors.ts`; the account control from `getByRole('button' | 'link', { name: /^Google Account: / })`.)

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/camoufox-worker test`; PASS with the floors, the
launch smoke reported skipped off the operator's machine.

- [ ] **Step 5: The operator runs the launch smoke** on the Mac: `pnpm install && pnpm --filter @gmt/camoufox-worker exec vitest run test/launch.smoke.test.ts`; PASS, `about:blank` only.

- [ ] **Step 6: Commit** — `git commit -m "wp14: worker scaffold, install layout, launch, locator driver, guards, classifier, cool-down, lock"`

### Task 14.2: SOCS capture, pacer, URL, readiness, the recorder, then the recordings

**Files:** create `src/{socs.ts,captureSocs.ts,pacer.ts,url.ts,ready.ts,record.ts}` and their tests (`socs`,
`captureSocs`, `pacer`, `url`, `ready`, `record`), `test/recorded.test.ts`; extend `@gmt/providers/testing` with
`recordingsPresentForKind`.

**SOCS** (ruling 9, SEC-R2-001, TS2-06): as round 1's Task 14.3, with one rule everywhere: `readBack(cookies, capture)`
returns `same` only when a `SOCS` cookie on `.google.com` has exactly the captured value; `changed` and `missing` both
stop the page, whatever `SOCS_STABLE` says. `SOCS_STABLE` records only that the stability recording passed; it never
weakens the comparison, and `/v1/status` reports it as `socsStable`. If a recording shows Google rewrites the value,
the work stops for an operator ruling. Tests: `same`, `changed`, `missing`, a `SOCS` on another domain → `missing`, all
with `SOCS_STABLE` injected both ways and the same results.

**Pacer** (ruling 7, PIE-R2-07): start to start, persisted `lastPageAt`, fail closed, and a fixed 2 s tolerance: a
claim at least `spacing − 2 s` after the last start passes. Tests (over the fake timers): arrivals every 30 s ± 50 ms
for 20 pages → zero refusals; an arrival 27.9 s after the last start → refused with `retryAfterSeconds: 1`; with
spacing 120, arrivals every 120 s → zero refusals and arrivals every 60 s → every other refused; a restart inside the
spacing keeps it; a corrupt record treats the last page as now.

**URL, readiness:** `url.ts` and `ready.ts` as round 1's tests, readiness over `PageFacts` plus the settled-text facts.

**The recorder** (`record.ts`; ruling 4, PIE-R2-01, PIE-R2-12, SEC-R2-003, SEC-015, TS-05, TS2-10, TS2-12). Kinds and
directories: `fixtures/recorded/<kind>/<date>/<n>.facts.json` + `<n>.meta.json`, one directory per kind (`socs-capture`
holds no vendor data and is not written; `results`, `cheapest`, `view-more`, `socs-stability`, `consent-probe`,
`no-flights`), each gated in `recorded.test.ts` by `recordingsPresentForKind(root, kind)`. Each recording stores the
locator-read facts and the result names (never printed ARIA text), the landing URL and hops, the `SOCS` read-back
result (`same`/`changed`/`missing`, never the value), the launch options used (minus `env`; PIE-R2-11), step timings,
`recordedBy: 'camoufox-worker record'` and `contentSha256`. Rules, each with a `record.test.ts` case over a fake
context and page:

1. Every Google-facing run except the consent probe requires a valid `SOCS` capture, sets it before the page, and
   records nothing if the landing URL or any hop is not `www.google.com/travel/flights…` (the evidence the pre-set
   rejection works); a consent landing there is recorded as the failure it is, starts the 48 h cool-down, and stops
   the session of recordings.
2. `--stability` loads three pages of the same query 30 s apart (fake timers in the test) and records each read-back;
   any result but `same` leaves `SOCS_STABLE` false and the recorder prints that an operator ruling is needed.
3. `--consent-probe` is the one navigation exception: a throwaway profile `<data>/probe-<random>`, no `SOCS`, the probe
   guard (`installProbeGuard`), a page object typed without a `click` method (the type `ProbePage` omits it, so a click
   does not compile); it records the consent page's facts, starts **no** cool-down for that expected page (any other
   blocked kind still cools down as usual), and deletes its profile in a `finally`, a thrown error included; the probe
   is reachable only from `record.ts` (a compiler-API check in Task 14.11 pins that neither `server.ts` nor
   `session.ts` imports it).
4. `--no-flights --origin <A> --destination <B> --depart <date> --return <date>`: the operator picks, at recording time,
   a valid query with no service (for example a date beyond Google's booking horizon, or two airports in the dataset
   with no scheduled service between them); if the page is anything but a recognisable "no flights" line, the recorder
   writes a `no-flights/unrecorded.meta.json` with the date and what appeared, `NO_FLIGHTS_VERIFIED` stays false, and
   the docs say empty routes read as not searched.
5. `--cheapest` and `--view-more` are the only paths that click those controls before their flags are set; `mode:
   'grid'` is reachable only through `--grid`, never from the server.
6. Fail closed: nothing is written when the facts or names hold the worker key, a `SOCS` value, a "Google Account:" name
   or an e-mail address; `--pages` at most 3; refuses while the worker's lock is held; the spacing applies across
   recorder runs (the shared persisted pacer); the `addCookies` call takes only `socsCookie(capture)` (TS2-10).

`recorded.test.ts`: one `describe` per kind, each gated by `recordingsPresentForKind` with its own decision-61 skip
title, each asserting `length > 0` inside the gate; metas and facts parsed with zod; per kind: hashes match; no account
traces; `results`/`cheapest`/`view-more` landed on the allowlist with `SOCS` `same` and every name parses (Task 14.3's
grammar, once it exists, by an import added in Task 14.3); `consent-probe` classifies as `consent-unhandled`;
`socs-stability` read-backs all `same` iff `SOCS_STABLE`; one unconditional test that each true flag names its proving
recording's date. A `recordingsPresentForKind` unit test in providers: one kind present, the others absent, the others
skip with `SKIP_SUFFIX` (TS2-12).

- [ ] **Step 1: Write the failing tests** — `socs.test.ts` (round 1's cases plus the value rule above), `pacer.test.ts`:

```ts
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2026-10-18T05:00:00.000Z');
describe('Pacer (spec §2: start to start, 2 s tolerance, persisted, never randomised)', () => {
  it('arrivals every 30 s ± 50 ms produce no refusal', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    let refused = 0;
    for (let i = 0; i < 20; i++) { if (!p.claim().ok) refused++; p.release(); clock.advance(i % 2 === 0 ? 29_950 : 30_050); }
    expect(refused).toBe(0);
  });
  it('an arrival more than 2 s early is refused', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim(); p.release(); clock.advance(27_900);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
  it('spacing 120: 120 s arrivals pass, 60 s arrivals are refused every other time', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 120, clock });
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) { const c = p.claim(); results.push(c.ok); if (c.ok) p.release(); clock.advance(60_000); }
    expect(results).toEqual([true, false, true, false, true, false]);
  });
  it('a restart inside the spacing keeps it', () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock });
    p.claim(); p.release(); clock.advance(10_000);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).claim()).toEqual({ ok: false, retryAfterSeconds: 18 });
  });
});
```

and `record.test.ts` with one `it` per recorder rule above, written in full.

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/camoufox-worker test`; PASS with the floors, recorded
kinds skipped visibly.

- [ ] **Step 5: The operator records, in this order** (decision 69 round 2, item 4):

```bash
# 1. capture the rejection in an ordinary private browser window (docs/setup.md §14), then:
pnpm --filter @gmt/camoufox-worker capture-socs
# 2. with SOCS pre-set: results, Cheapest, View more, and the stability check
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --cheapest
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --view-more
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --stability
# 3. the consent probe, in a throwaway profile, clicking nothing
pnpm --filter @gmt/camoufox-worker record --consent-probe
# 4. no flights: a valid query with no service, chosen now
pnpm --filter @gmt/camoufox-worker record --no-flights --origin <A> --destination <B> --depart <date> --return <date>
```

If step 2's first page lands on the consent page, the run stops with a 48 h cool-down, and the work stops for an
operator ruling: the pre-set rejection does not hold. The implementer then writes `selectors.ts` (the search form's
roles and names, the Cheapest flow, the no-flights line) from the recordings, flipping each flag only where its
recording proves it, and lists every rule that changed in the commit message.

- [ ] **Step 6: Commit** — `git commit -am "wp14: SOCS capture, pacer, URL, readiness and the recorder; recordings dated <date>"`

### Task 14.3: The result-name grammar, airports, the search form and the list reader (against the recordings)

**Files:** create `src/{names.ts,airports.ts,form.ts,list.ts,pointOfSale.ts}` and their tests; extend
`recorded.test.ts`'s results kinds with the grammar import.

**Interfaces:** `parseOptionName(name, interstitials = INTERSTITIALS): ParsedOption | null`; `airportMatches(googleName,
datasetNames)`; `checkForm(form: FormFacts, req): 'ok' | 'mismatch' | 'absent'` over the form fields the driver reads
(`{ tripType; passengers; departure; return } | null`, the roles and names Task 14.2's recording pinned); `readList(f:
ListFacts, req): ListRead` where `ListFacts = { names: Array<string | null>; cheapestTabName: string; resultsStated:
number | null; currencyName: string | null; locationName: string | null }` (one `names` entry per link inside a result
`listitem`, `null` for a name over the 4 000-character limit or unreadable) and `ListRead` as round 1.

Rules: round 1's (strict whole-name grammar with enumerated, dated interstitials; airport and date matching; other-cell
and unparsed counts; dated point-of-sale table, stored as stated; the minimum over this cell's options; numeric sort),
plus: an empty or `null` name counts as `optionsUnparsed`, so every link is either priced, counted as another cell, or
counted as unparsed, and `optionsUnparsed + optionsOtherCell + parsedForThisCell === names.length` holds (PIE-R2-10);
the grammar's regex is written so every capture group it uses is guaranteed when it matches, with one guard that throws
on the impossible case instead of `?? ''` fallbacks (TS2-04); interstitials and aliases are parameters with the
module's tables as defaults, so both states are tested.

- [ ] **Step 1: Write the failing tests.** `names.test.ts`: round 1's cases (the feasibility one-stop name verbatim,
separators, the seven refusals), plus an interstitial accepted only when passed in `interstitials`, and a recorded
non-stop name from Task 14.2's `results` kind (gated by `recordingsPresentForKind`). `list.test.ts` over `ListFacts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { readList } from '../src/list.js';

const REQ = { mode: 'list' as const, origin: asIata('LHR'), destination: asIata('JFK'), gl: 'GB',
  departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15'),
  airportNames: { origin: ['London Heathrow Airport'], destination: ['John F Kennedy International Airport'] } };
const name = (pounds: number, o: { on?: string; from?: string; to?: string } = {}) =>
  `From ${pounds} British pounds round trip total. 1 stop flight with Example Air. Leaves ${o.from ?? 'Heathrow Airport'} at 12:25 on ${o.on ?? 'Thursday, November 5'} and arrives at ${o.to ?? 'John F. Kennedy International Airport'} at 20:05 on ${o.on ?? 'Thursday, November 5'}. Total duration 12 hrs 40 min. Select flight`;
const facts = (names: Array<string | null>, o: Partial<{ tab: string; stated: number | null; currency: string | null; location: string | null }> = {}) => ({
  names, cheapestTabName: o.tab ?? 'Cheapest from 451 British pounds', resultsStated: o.stated === undefined ? names.length : o.stated,
  currencyName: o.currency === undefined ? 'Currency GBP' : o.currency, locationName: o.location === undefined ? 'Location·United Kingdom' : o.location,
});

describe('readList (spec §2 list mode)', () => {
  it('the minimum over every link for this cell, with the tab price, currency and point of sale', () => {
    expect(readList(facts([name(478), name(534), name(451)]), REQ)).toMatchObject({ minMinor: 45100, tabMinor: 45100, optionsUnparsed: 0, optionsOtherCell: 0, resultsSeen: 3, currency: 'GBP', pointOfSale: 'GB' });
  });
  it.each([['a reworded name', 'Reworded by Google'], ['a nameless link', ''], ['a name over the limit', null]])('%s counts as unparsed, never vanishes', (_n, bad) => {
    const r = readList(facts([name(478), bad]), REQ);
    expect(r).toMatchObject({ minMinor: 47800, optionsUnparsed: 1, resultsSeen: 2 });
  });
  it('another day or another airport counts as another cell', () => {
    expect(readList(facts([name(300, { on: 'Friday, November 6' }), name(310, { to: 'Newark Liberty International Airport' }), name(451)]), REQ)).toMatchObject({ minMinor: 45100, optionsOtherCell: 2 });
  });
  it('no option for this cell: minMinor null', () => {
    expect(readList(facts([name(300, { on: 'Friday, November 6' })]), REQ).minMinor).toBeNull();
  });
  it.each([['United States', 'US'], ['Elsewhere', 'unknown']])('location %s → %s, stored as stated', (place, pos) => {
    expect(readList(facts([name(451)], { location: `Location·${place}` }), REQ).pointOfSale).toBe(pos);
  });
  it('no currency control: currency null', () => {
    expect(readList(facts([name(451)], { currency: null }), REQ).currency).toBeNull();
  });
  it('sorts numerically', () => {
    expect(readList(facts([name(1000), name(999)]), REQ).minMinor).toBe(99900);
  });
});
```

`airports.test.ts` and `form.test.ts` as round 1, over the recorded form field names (Task 14.2), with
`FORM_VERIFIED` set by then.

- [ ] **Step 2–4: Run, implement, run** — PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: result grammar, airport and form checks and the list reader"`

### Task 14.4: The signed-in refusal and the page session (deadlines, every path, every error)

**Files:** create `src/refusal.ts`, `src/session.ts` and their tests.

**Interfaces:** `Refusal({ dir })` (`active()`, `set(reason)`, `clear()`); `PageSession({ context, driver, socs,
cooldown, pacer, refusal, clock, timers, selectors, pageTimeoutMs, finallyTimeoutMs = 5000, pollMs = 2000, log })` with
`page(req): Promise<{ answer: WorkerAnswer; googleContacted: boolean }>`.

Rules (round 1's, corrected by rulings 5, 6 and 9):

1. `mode: 'grid'` → `mode-unavailable`, nothing opened.
2. A standing refusal or an active cool-down → `cooling-down`, nothing opened, `googleContacted: false`.
3. `pacer.claim()` refused → `spacing`.
4. `try` / `finally`, the pacer released first and unconditionally in the `finally`. In the `try`: set `SOCS`
   (`addCookies([socsCookie(capture)])`); run the account-cookie check (`accountCookies.ts`; found → `signed-in`); open
   the URL (`goto({ timeout, waitUntil: 'domcontentloaded' })`); poll `readFacts()` every `pollMs` until `isSettled`,
   classifying blocked kinds each time, within the page deadline (→ `not-ready`); `checkForm` (`mismatch`/`absent` →
   `unrecognised`); click only names whose flags are set, re-reading facts after each; `readList`; `currency !== 'GBP'`,
   or `minMinor === null` with no other-cell option → `unrecognised`; `no-flights` → `cells` `{ status: 'no-flights' }`.
5. **On every path after `goto` was called**, success and failure alike, the `finally` reads `SOCS` back under its own
   `finallyTimeoutMs` and compares the value (ruling 9): `changed` or `missing` replaces the answer with `blocked`
   `consent-unhandled`, **except** that an answer already `blocked` keeps its own kind and the cool-down records the
   longer of the two causes' periods with the earlier cause (equal periods keep the earlier, per Task 14.1's tie rule);
   in every mismatch case the profile is wiped (close the context, remove `<data>/profile`, relaunch lazily). Then the
   page is closed under its own bound; an overrun of either `finally` step discards the context and, if the answer was
   `cells`, replaces it with `browser-error` `read`.
6. A stop records its cause (`unrecognised` 1 h, the rest `challengeHours`); `signed-in` also sets the persisted refusal,
   cleared only by `clear-signed-in`, which wipes the profile first.
7. Every thrown error maps to one answer: the page deadline → `not-ready`; an error before `goto` (from `addCookies`,
   the cookie check or `newPage`) → `browser-error` `launch` (Google not contacted); during `goto` → `browser-error`
   `navigate`; after → `browser-error` `read`; a cool-down store read error → `browser-error` `read`, after which
   `main.ts` exits 70.
8. `googleContacted` is true once `goto` was called.
9. The deadline is one `timers.deadline(pageTimeoutMs)` whose expiry closes the page (rejecting every pending call);
   every call races it with a no-op `catch` attached to the losing promise; every Playwright call also takes its own
   `timeout`.

- [ ] **Step 1: Write the failing tests** — `session.test.ts` over the fake context and page, written in full, one `it`
each (TS2-14, TS-10, TS2-06), every case asserting the answer, `googleContacted`, that the pacer is released (a claim
after the spacing succeeds) and that the page is closed, and after `goto` that the read-back ran:

- settled results → `cells` `{ status: 'price', amountMinor: 45100, tabMinor: 45100, optionsUnparsed: 0,
  optionsOtherCell: 0, returnDateFrom: 'query-and-form' }`, `SOCS` set before `goto`;
- two pages in a row, each preceded by `addCookies` with `SOCS`;
- `SOCS` changed after a settled page → `consent-unhandled`, profile wiped, with `SOCS_STABLE` injected false and true
  (the same answer both ways);
- `SOCS` missing after a settled page → `consent-unhandled`;
- a CAPTCHA frame, and `SOCS` changed on the same page → `captcha` kept, cool-down cause `captcha`, profile wiped;
- a consent hop (302) to `consent.google.com` ending on results → `consent-unhandled`, nothing clicked;
- an `accounts.google.com` hop → `sign-in`;
- a signed-in control → `signed-in`, refusal persisted; a new session over the same directory answers `cooling-down`
  (cause `signed-in`) without opening;
- every name of the account-cookie set present before the page → `signed-in`, nothing opened (`it.each`);
- facts never settling → `not-ready` at the fake deadline, no cool-down, pacer released;
- a form mismatch → `unrecognised`, 1 h;
- `addCookies` throws → `browser-error` `launch`, `googleContacted: false`;
- `goto` throws → `browser-error` `navigate`, `googleContacted: true`, read-back ran;
- `readFacts` throws after navigation → `browser-error` `read`, read-back ran;
- a never-resolving `readFacts` → `not-ready`, and a `process.on('unhandledRejection')` spy records nothing after the
  page closes;
- a never-resolving read-back `cookies()` in the `finally` → bounded at 5 s of fake time, context discarded, answer
  `browser-error` `read`;
- `close()` throws after a block → the block answer stands, pacer released;
- the cool-down store throws on read → `browser-error` `read` (`main.test.ts` asserts the exit 70);
- `mode: 'grid'` → `mode-unavailable`, nothing opened; the config schema refuses `CAMOUFOX_MODE=grid`, and
  `GRID_VERIFIED` is false;
- a request inside the spacing → `spacing`, nothing opened;
- with `CHEAPEST_FLOW_VERIFIED` injected true the Cheapest tab is clicked once; false, nothing is clicked.

- [ ] **Step 2–4: Run, implement, run** — PASS with the floors.

- [ ] **Step 5: Commit** — `git commit -am "wp14: persisted refusal and the page session's every path"`

### Task 14.5: The worker's HTTP server, config, status and the launchd agent

**Files:** create `src/{config.ts,server.ts,main.ts,clearSignedIn.ts,status.ts}`,
`launchd/local.get-me-there.camoufox-worker.plist.example`, `test/{config,server,main,status}.test.ts`.

Rules (round 1's, corrected): settings come only from `<data>/worker.env` through `run.ts`; `config.ts` refuses, naming
the variable never the value, a missing or short (< 32) `CAMOUFOX_WORKER_KEY`, a `CAMOUFOX_WORKER_PORT` outside
1024–65535, spacing outside 30–600, cool-down below 24, page timeout outside 30–240, and a set `CAMOUFOX_INSTALL_DIR`;
the worker binds `127.0.0.1` only (macOS: Docker Desktop forwards `host.docker.internal` to it; no other bind is
accepted). Start: platform, install layout, lock (and the probe sweep), launch, account-cookie check, `loadSocs`,
`FORM_VERIFIED`; any failure exits 78 naming the check; a standing refusal starts the server answering `cooling-down`
only. `/v1/status` runs the account-cookie check **on each request** (a cookie read, no page load) and reports its
`found`, `names` and `checkedAt`, the live cool-down, refusal, flags and versions (SEC-R2-004, TS2-17). The `status`
script reads the key from the env file through `run.ts` and calls the route itself, so the key never reaches a command
line (SEC-R2-005).

- [ ] **Step 1: Write the failing tests** — `server.test.ts`: round 1's table cases (one `it` per §6 row; `portOf`
guard; the key never logged), plus a status case where the account check finds `SID` and the body says `found: true,
names: ['SID']`; `config.test.ts`: one `it` per refused value; `main.test.ts` (fake launcher): non-macOS exits 78 with
the macOS message; `FORM_VERIFIED` injected false exits 78; a start-check failure exits 78; a held lock exits 78 naming
the pid; a cool-down read error exits 70; SIGTERM mid-page answers that page, then exits 0 and releases the lock;
`status.test.ts`: the script reads the key from the env file and prints the status body without the key.

- [ ] **Step 2–4: Run, implement, run** — PASS; then `pnpm --filter @gmt/camoufox-worker test` passes with its floors
and `pnpm --filter @gmt/camoufox-worker mutate` passes (80% break, timeouts ≤ 5%).

- [ ] **Step 5: Commit** — `git commit -am "wp14: worker server, config, live status and launchd agent"`

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

`test/camoufox/protocol.test.ts`: `workerStatusSchema` requires `flags` and the `accountCookie` object (a literal
`false` field is refused; TS2-17, SEC-R2-004); every `WorkerAnswer` kind round-trips through `workerAnswerSchema`; an unknown kind
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
backup covers it) rebuilds only the tables whose CHECKs change (TS2-01): the `provider_id` CHECK gains `'camoufox'` on
`calendar_prices`, `cell_outcomes`, `fare_offers`, `provider_requests` and `route_price_history`; the `source_kind`
CHECK gains `'scraped-self'` on `calendar_prices`, `cell_outcomes` and `price_observations` (which has no
`provider_id`); it adds `provider_requests.page_class TEXT CHECK (page_class IS NULL OR page_class IN
('page','no-page'))` and creates `operator_notice_keys (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL)` for
once-per-cool-down notices.

`budgetConfigFromConfig` gains `if (cf !== null) providers.camoufox = { ...cf.limits, billable: false, trialUsed: 0 }`
(cost-005). `reserve`'s order (cost-010): provider-month (for a `pagesOnly` provider counting rows whose `page_class` is
not `'no-page'`, pending rows included), then **provider-execution** (the same row rule, scoped to the execution and
provider, the cap read from the execution's snapshot `$.budget.providerMaxCalls.<provider>`, never from config; a
provider with no snapshot cap has no such scope; arch-007), then global, then the execution caps (camoufox rows count in
`execution-free-calls` like any free row). `finalise({ pageClass })` writes the column.

- [ ] **Step 1: Write the failing tests**

```ts
// test/migration0005.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers/db.js';
import { seedEveryRebuiltTableAt0004, tableRows } from './helpers/migrations.js';

const PROVIDER_CK = ['calendar_prices', 'cell_outcomes', 'fare_offers', 'provider_requests', 'route_price_history'];
const SOURCE_KIND_CK = ['calendar_prices', 'cell_outcomes', 'price_observations'];
const ddl = (db: ReturnType<typeof freshDb>, t: string): string => {
  const row: unknown = db.raw.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(t);
  if (typeof row !== 'object' || row === null || !('sql' in row) || typeof row.sql !== 'string') throw new Error(`no table ${t}`);
  return row.sql;
};
beforeEach(() => { expect.hasAssertions(); });

describe('migration 0005 (spec §5.1 rev 32)', () => {
  it.each(PROVIDER_CK)('%s accepts camoufox in its provider CHECK', (t) => {
    expect(ddl(freshDb(), t)).toContain("'camoufox'");
  });
  it.each(SOURCE_KIND_CK)('%s accepts scraped-self in its source_kind CHECK', (t) => {
    expect(ddl(freshDb(), t)).toContain("'scraped-self'");
  });
  it('a camoufox provider_requests row inserts with a page class; an unknown provider and an unknown class are refused', () => {
    const insert = freshDb().raw.prepare("INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt, page_class) VALUES (?, '/v1/page', '2026-10-18T05:00:00.000Z', 'ok', 0, 0, 1, ?)");
    expect(() => insert.run('camoufox', 'no-page')).not.toThrow();
    expect(() => insert.run('kayak', 'page')).toThrow(/CHECK/);
    expect(() => insert.run('camoufox', 'sometimes')).toThrow(/CHECK/);
  });
  it('keeps every row of a database migrated to 0004', () => {
    const { before, migrate, db } = seedEveryRebuiltTableAt0004();
    migrate();
    expect(tableRows(db)).toEqual(before);
  });
});
```

(`seedEveryRebuiltTableAt0004` and `tableRows` lift `migration0004.test.ts`'s seed-and-compare pattern into
`test/helpers/migrations.ts` in this task: one row per rebuilt table, columns per the real schema, `id` omitted on
autoincrement tables. The rest of the reuses `migration0004.test.ts`'s seed-and-compare pattern; the implementer lifts that helper into
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
    let scope: string | undefined;
    expect(() => { try { g.reserve(r('e1', 2)); } catch (e) { scope = e instanceof BudgetExceeded ? e.scope : 'other'; throw e; } }).toThrow();
    expect(scope).toBe('provider-execution');
  });
  it('no-page rows count toward neither page cap', () => {
    const g = guardFor({ camoufoxConfigCap: 100, monthlyCap: 1, snapshotCaps: { e1: { camoufox: 1 } } });
    for (let i = 0; i < 5; i++) g.reserve(r('e1', i)).finalise({ outcome: 'error', httpStatus: 429, durationMs: 1, pageClass: 'no-page' });
    expect(() => g.reserve(r('e1', 9))).not.toThrow();
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(1);
  });
  it('provider-execution is checked before execution-free-calls: one reserve that breaches both names provider-execution', () => {
    const g = guardFor({ camoufoxConfigCap: 100, maxFreeCalls: 1, snapshotCaps: { e1: { camoufox: 1 } } });
    g.reserve(r('e1', 0)).finalise({ outcome: 'ok', durationMs: 1, pageClass: 'page' });
    let scope: string | undefined;
    expect(() => { try { g.reserve(r('e1', 1)); } catch (e) { scope = e instanceof BudgetExceeded ? e.scope : 'other'; throw e; } }).toThrow();
    expect(scope).toBe('provider-execution');
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
- `ProviderHttpLimits` gains `minIntervalMs?: number` (when set, `limiter.ts` uses it as `minTime` instead of
  `ceil(60000 / ratePerMinute)`; ruling 7, PIE-R2-07), `workerPort?: number`, `workerScheme?: 'http:' | 'https:'`,
  `retryTransport?: false`
  (timeouts, dropped sockets and failed body reads become non-retryable), `connectRefusedKind?: 'provider-unavailable'`
  (an `ECONNREFUSED` or `EHOSTUNREACH` before any byte was sent, read from the fetch error's `cause.code`, never from its
  message, becomes that kind, non-retryable) and
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
  concurrency 1; the config's rates and `minIntervalMs = minSpacingSeconds × 1000`; `requestTimeoutSeconds =
  pageTimeoutSeconds + 15`; `retryTransport: false`;
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
      detail: 'return date: the date asked for; options unread: 2; Google shows a lower fare under Cheapest that could not be read (£399); options for another cell: 1' }]);
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
  it('a timeout past the request timeout is one attempt, one page row, no second POST', async () => {
    const { p, budget, tile } = setup();
    let hits = 0;
    server.use(http.post(URL_, async () => { hits++; await respondAfter(120_000); return HttpResponse.json(price(), contacted(true)); }));
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'network', retryable: false } });
    expect(hits).toBe(1);
    expect(budget.rows('camoufox').map((x) => x.pageClass)).toEqual(['page']);
  });
  it('a dropped socket (a real server that destroys the connection) is one attempt, never retried, a page row', async () => {
    const { p, budget, tile, kitFor } = setupWithRealSocket('destroy');   // msw passthrough() to a node:http server that calls socket.destroy() after the request
    expect(await kitFor(p).discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'network', retryable: false } });
    expect(budget.rows('camoufox').map((x) => x.pageClass)).toEqual(['page']);
  });
  it('a refused connection (a real closed port) is provider-unavailable, one no-page row', async () => {
    const { p, budget, tile, kitFor } = setupWithRealSocket('closed');    // passthrough() to a port that was bound then closed: cause.code ECONNREFUSED
    expect(await kitFor(p).discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'provider-unavailable', retryable: false } });
    expect(budget.rows('camoufox').map((x) => x.pageClass)).toEqual(['no-page']);
  });
  it('429 spacing honours Retry-After, then the page: two rows, one page', async () => {
    const { p, budget, tile } = setup();
    const answers = [HttpResponse.json({ kind: 'spacing', retryAfterSeconds: 1 }, { status: 429, headers: { 'retry-after': '1', 'x-gmt-google-contacted': '0' } }), HttpResponse.json(price(), contacted(true))];
    server.use(http.post(URL_, () => answers.shift() ?? HttpResponse.error()));
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile' });
    expect(budget.rows('camoufox').map((x) => x.pageClass)).toEqual(['no-page', 'page']);
  });
  it('an unknown answer kind (consent-rejected) is a parse error', async () => {
    const { p, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'consent-rejected', fetchedAt: '2026-10-14T15:00:00.000Z' }, contacted(true))));
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'parse' } });
  });
  it.each([['after the adapter clock', '2026-10-14T15:00:01.000Z'], ['before the request', '2026-10-14T14:59:00.000Z']])('a fetchedAt %s is refused as parse', async (_n, at) => {
    const { p, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json({ ...price(), fetchedAt: at }, contacted(true))));
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'parse' } });
  });
  it('the key travels in x-gmt-worker-key, never in the URL', async () => {
    const { p, events, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json(price(), contacted(true))));
    await p.discovery?.fetchTile(tile, Q, ctx);
    const f = events.find((e) => e.type === 'fetch');
    expect(f !== undefined && 'headers' in f ? f.headers['x-gmt-worker-key'] : undefined).toBe(SENTINELS.camoufox.reveal());
    expect(f !== undefined && 'url' in f ? f.url : '').not.toContain(SENTINELS.camoufox.reveal());
  });
  it('declares discovery only, scraped-self, maxAgeHours 0, economy only, and the spec §2 provenance note verbatim', () => {
    const { p } = setup();
    expect(p.verification).toBeUndefined();
    expect(p.cabins).toEqual(['economy']);
    expect(p.discovery?.info).toEqual({ sourceKind: 'scraped-self', maxAgeHours: 0, provenanceNote: SPEC_PROVENANCE_NOTE });
  });
});
```

(`setupWithRealSocket` uses msw's `passthrough()` for that one URL, so a real socket gives the real `cause.code`; the
guarded server's catch-all still fails any other unmatched request (decision 18). `SPEC_PROVENANCE_NOTE` is the spec §2
text, copied into the test. Each file calls `expect.hasAssertions()` in a `beforeEach`.)

`preflight.test.ts`: cooling down → `provider_disabled` with the end and cause; signed-in refusal → `provider_disabled`;
worker down → `provider_unavailable`; healthy → ok; in every case the fake budget records no row. `tiles.test.ts`: one
tile per cell, partition asserted, subset re-plan, deterministic. `egress.test.ts`: every URL the config accepts passes
egress for `camoufox` (arch-012, using `camoufoxWorkerUrlOk`'s accepted examples); another port (`9377`), another host,
another scheme, Google directly, and any `searchapi` request to the worker URL are refused. `limits.test.ts`: the values
above; `retryTransport: false`; `minIntervalMs` = spacing × 1000; `pageClass` from the header.
`http/limiter.minInterval.test.ts` (fake timers): with `minIntervalMs` 120 000 and `ratePerMinute` 1, six jobs start at
least 120 s apart; without it the old `ceil(60000 / ratePerMinute)` rule is unchanged. `recorderHeaders.test.ts`: a recorded camoufox request has
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
  it('worker unreachable at preflight: skipped:provider_unavailable, no row, other providers run', async () => {
    const e = engineWith([stubCamoufox({ cells: 5, preflight: { ok: false, skip: 'provider_unavailable', detail: 'browser worker not reachable' } }), stubTravelpayouts({ cells: 5 })]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => [o.status, o.reason])).toEqual(Array(5).fill(['skipped', 'provider_unavailable']));
    expect(e.ledgerRows('camoufox')).toHaveLength(0);
    expect(outcomes(e, ex.id, 'travelpayouts').filter((o) => o.status === 'priced')).toHaveLength(5);
  });
  it('a refused connection mid-run: one error cell, the rest skipped:provider_unavailable, one ledger row', async () => {
    const e = engineWith([stubCamoufox({ cells: 6, failTile: 0, error: unavailableError() })]);
    const ex = await e.runToEnd();
    const cf = outcomes(e, ex.id, 'camoufox');
    expect(cf.filter((o) => o.status === 'error')).toHaveLength(1);
    expect(cf.filter((o) => o.status === 'skipped' && o.reason === 'provider_unavailable')).toHaveLength(5);
    expect(e.ledgerRows('camoufox')).toHaveLength(1);
  });
  it('a manual resume keeps camoufox disabled after a block and calls it no more', async () => {
    const s = stubCamoufox({ cells: 4, failTile: 0, error: blockedError('captcha') });
    const e = engineWith([s]);
    const ex = await e.runToEnd();
    const calls = s.calls.length;
    await e.resume(ex.id, { manual: true });
    expect(s.calls.length).toBe(calls);
  });
  it('a manual resume still re-admits a provider disabled for auth', async () => {
    const s = stubCamoufox({ cells: 4, failTile: 0, error: authError() });
    const e = engineWith([s]);
    const ex = await e.runToEnd();
    const calls = s.calls.length;
    await e.resume(ex.id, { manual: true });
    expect(s.calls.length).toBeGreaterThan(calls);
  });
  it('the snapshot page cap stops camoufox at 2 pages though config says 100, and travelpayouts continues', async () => {
    const e = engineWith([stubCamoufox({ cells: 6 }), stubTravelpayouts({ cells: 6 })], { camoufoxConfigCap: 100, snapshotCap: 2 });
    const ex = await e.runToEnd();
    expect(e.ledgerRows('camoufox').filter((r) => r.pageClass === 'page')).toHaveLength(2);
    expect(outcomes(e, ex.id, 'camoufox').filter((o) => o.status === 'skipped' && o.reason === 'budget')).toHaveLength(4);
    expect(outcomes(e, ex.id, 'travelpayouts').filter((o) => o.status === 'priced')).toHaveLength(6);
  });
  it('alone, the page cap pauses paused_budget and the tick does not resume it', async () => {
    const e = engineWith([stubCamoufox({ cells: 6 })], { camoufoxConfigCap: 100, snapshotCap: 2 });
    const ex = await e.runToEnd();
    expect(ex.status).toBe('paused_budget');
    expect(await e.tick()).toEqual({ resumed: false });
  });
  it('the engine fills airportNames from the airports repository', async () => {
    const s = stubCamoufox({ cells: 1 });
    await engineWith([s]).runToEnd();
    expect(s.queries[0]?.airportNames).toEqual({ origin: ['London Heathrow Airport'], destination: ['John F Kennedy International Airport'] });
  });
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
  does not read, or a check (the detail says which)"; `last_error` words each page kind distinctly: "Google showed a
  challenge page (CAPTCHA)", "Google reported unusual traffic", "Google showed its cookie page (the rejection did not hold)",
  "Google asked to sign in", "the browser profile was signed in", "Google sent the browser elsewhere", "Google's page was
  not one this app reads (it may have changed)", "cooling down until <time>; Google was not contacted"; the skip reason
  `provider_unavailable`: "browser worker not reachable". The narrow-screen legend at `copy.ts`'s `phoneProviders`
  string gains ", CF Camoufox (Google Flights prices via Camoufox)". The Providers note `camoufoxNote`: "Off by default.
  Reads Google Flights in Camoufox, a Firefox-based browser you have installed, in its own signed-out profile, from your
  own IP address, one day pair a page, at most one page every 30 seconds. It prices at most the monthly page cap of day
  pairs a month (1,500 by default; one London → New York airport pair has 2,184), so most cells stay unsearched or
  skipped. Whenever a page is not a recognised results page (a challenge or verification page, a sign-in page, a consent
  page, or anything unrecognised) it stops and pauses (48 hours, or 1 hour for an unrecognised page). Read the
  provider's terms before enabling it; the operator is responsible for how it is used."

- [ ] **Step 1: Write the failing tests** — wiring: off by default (no limits, no provider); on: `httpLimitsFor(c)
.camoufox` has hosts `['host.docker.internal']`, port 8090, scheme `http:`, `billable: 'never'`, concurrency 1,
`retryTransport: false`; `camoufox-status` present; the provider has discovery only; the key is a collected secret;
`defaultDefinitionInput(...)`'s discovery providers never include `camoufox`. Copy: the legend contains the CF entry;
`camoufoxNote` mentions "signed-out profile", "own IP address" and "1,500"; no copy string matches the banned words;
only the CAPTCHA kind is worded "challenge page" (prov-008).

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/api test && pnpm --filter @gmt/web test`; PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: wire the camoufox provider; reasons, legend and Providers copy"`

### Task 14.11: Docker, compose, CI, boundaries and the rules tests

**Files:** modify `Dockerfile`, `.dockerignore`, `docker-compose.yml`, root `package.json`, `scripts/check-boundaries.mjs`,
`scripts/workflows.test.mjs`, `.github/workflows/ci.yml`; create `apps/camoufox-worker/test/rules.test.ts`.

- **The image stays browser-free (arch-002, devops-002).** `.dockerignore` excludes `apps/camoufox-worker/` except its
  `package.json`. The build stage copies that manifest beside the others (so the frozen lockfile's importer resolves)
  and installs with `pnpm install --frozen-lockfile --filter '!@gmt/camoufox-worker'`; the root `build` script's filter
  becomes `--filter './packages/**' --filter './apps/**' --filter '!@gmt/camoufox-worker'`; the prod-deps stage already
  filters to `@gmt/api...`. The docker job asserts `! test -e /app/apps/camoufox-worker`,
  `! ls -d /app/node_modules/.pnpm/camoufox-js@* /app/node_modules/.pnpm/playwright-core@* 2>/dev/null` (a glob, since
  pnpm suffixes peer-resolved directories; TS2-11), `! command -v firefox`, and the image size within 5 MB of main; the
  same commands are pinned in `scripts/workflows.test.mjs`, so CI runs them.
- **Compose:** the `app` service gains only the environment lines (no `extra_hosts`: macOS only, and Docker Desktop
  resolves `host.docker.internal` itself; ruling 2)
  `CAMOUFOX_ENABLED`, `CAMOUFOX_WORKER_URL` (default `http://host.docker.internal:8090`), `CAMOUFOX_WORKER_KEY`,
  `CAMOUFOX_MIN_SPACING_SECONDS`, `CAMOUFOX_EXECUTION_PAGE_CAP`, `CAMOUFOX_MONTHLY_PAGE_CAP`, `CAMOUFOX_BILLING_DAY`,
  `CAMOUFOX_COOLDOWN_HOURS`, `CAMOUFOX_PAGE_TIMEOUT_SECONDS`. No new service, image or volume.
- **CI (devops-012):** a step "app runs with the camoufox-worker absent" runs a separate project
  (`docker compose -p gmt-cfabsent up -d` with `CAMOUFOX_ENABLED=true` and a dummy 32-character key passed through the
  shell, never `.env`), checks `/api/health`, checks `/api/providers` lists `camoufox`, starts one execution of a
  one-cell definition naming camoufox and Travelpayouts-free fixture data is not used: it asserts the camoufox cells end
  `skipped:provider_unavailable` with zero camoufox ledger rows (the preflight), then `down -v`.
- **Boundaries (arch-009, TS-04):** `ALLOWED['@gmt/camoufox-worker'] = ['@gmt/core']` for production sources, plus
  `@gmt/providers` (only its `testing` export) for files under `apps/camoufox-worker/test/`; external imports
  `camoufox-js` and `playwright-core` allowed only in `apps/camoufox-worker/src/{launch,driver}.ts`; `ENV_READER` widens
  to `apps/camoufox-worker/src/{main,record,captureSocs,clearSignedIn}.ts`; nothing may import `@gmt/camoufox-worker`.
- **Rules tests (TS-02, TS-03, arch-016, TS2-10): behavioural, not string scans.** `rules.test.ts` asserts:
  `buildLaunchOptions` (Task 14.1) by its exact key list (no `proxy`, `geoip: false`, no `humanize`, `exclude_addons:
  ['UBO']`, `serviceWorkers: 'block'`, the minimal `env`, the six background-service prefs); the worker's `package.json`
  dependencies are exactly `@gmt/core`, `camoufox-js` 0.11.5 and `playwright-core` 1.59.1; a full `PageSession` run over
  the fake context calls `addCookies` only with `socsCookie(...)` and never clicks on a consent page; and, through the
  TypeScript compiler API over `src/`: no reference to `Math.random` or `crypto.random*`; every `setTimeout` or `sleep`
  delay argument is a numeric literal or a named config field; `addCookies` is called only in `session.ts` and
  `record.ts`, each with a `socsCookie(...)` argument; `installProbeGuard` and the probe page type are imported only by
  `record.ts`; no `route.continue` with a URL option.

- [ ] **Step 1: Write the failing tests** — the rules tests above; `scripts/workflows.test.mjs` gains: compose has no
service named `camoufox*` or `browser*`; `app` has no `extra_hosts` line and has the `CAMOUFOX_WORKER_URL` default; the
Dockerfile installs with the `!@gmt/camoufox-worker` filter; `.dockerignore` excludes the worker; CI has the
"camoufox-worker absent" step.

- [ ] **Step 2–4: Run, implement, run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/rules.test.ts && pnpm vitest run --project scripts scripts/workflows.test.mjs && node scripts/check-boundaries.mjs`; PASS, exit 0.

- [ ] **Step 5: Commit** — `git commit -am "wp14: image excludes the worker; compose, CI, boundaries and rules tests"`

### Task 14.12: Operator docs

**Files:** modify `docs/setup.md`, `docs/providers.md`, `docs/api-limits.md`, `docs/scheduling.md` (generated rows);
test `apps/api/test/deploy/camoufoxDocs.test.ts`.

`docs/setup.md` section 14, "The Camoufox provider (optional, off by default; macOS only)", in this order:

1. **What it is and what it costs** — spec §2's costs under their bold names, verbatim (**Terms**: "Read the
   provider's terms before enabling it; the operator is responsible for how it is used.", **The operator's IP and account**,
   **Brittleness**, **Speed** with 50–90 s a page and 1½–2½ hours a run, **Availability**, **Image size**, **The worker
   key**: any program or container that can reach the worker, which on Docker Desktop is every container on the Mac, is
   stopped only by `CAMOUFOX_WORKER_KEY`), and the coverage paragraph.
2. **How it behaves** — one page at a time, start to start 30 s; its own signed-out profile; service workers blocked;
   every redirect checked; the cookie choice is "Reject all", set before every page from your capture and checked by
   value after it, and a cookie page means it stops; 48 h after a check, 1 h after an unknown page; never solves or
   clicks through a challenge; nothing retries it. The camofox-browser server is not used and need not run.
3. **Set it up** (macOS) —
   - `mkdir -p -m 700 ~/.local/state/get-me-there/camoufox`;
   - `pnpm install` in a checkout (the worker runs from source; repeat after every `git pull`);
   - capture your cookie choice: in an ordinary private browser window open `https://www.google.com/travel/flights`,
     click **Reject all**, open the cookie view (developer tools, Storage or Application, cookies for
     `https://www.google.com`), then run `pnpm --filter @gmt/camoufox-worker capture-socs` and paste the `SOCS` cookie's
     value, expiry, Secure and SameSite when asked (it stamps the time and writes the file 0600);
   - create `~/.local/state/get-me-there/camoufox/worker.env` in an editor (never with `echo`), mode 0600
     (`chmod 600`), holding `CAMOUFOX_WORKER_KEY` (at least 32 random characters, generated with
     `openssl rand -hex 24 > ~/.local/state/get-me-there/camoufox/key.tmp` and pasted from that file, then the file
     deleted) and, if not the default, `CAMOUFOX_BINARY_BUILD`. That file is the only place the key lives on the Mac;
   - start it: `pnpm --filter @gmt/camoufox-worker start` to try it, then install the launchd agent from
     `apps/camoufox-worker/launchd/*.plist.example` (copy, set the checkout path, `launchctl bootstrap gui/$(id -u)
     <plist>`); start-check failures exit 78 and the agent does not loop faster than once a minute; logs go to
     `~/Library/Logs/get-me-there/`.
4. **Point the app at it** — *Docker:* add `CAMOUFOX_ENABLED=true` and the `CAMOUFOX_WORKER_KEY` line to `.env` with
   an editor (the same value), and leave `CAMOUFOX_WORKER_URL` unset (the compose default reaches the worker through
   Docker Desktop). *`pnpm dev`:* keep the two lines and `CAMOUFOX_WORKER_URL=http://127.0.0.1:8090` in a 0600 file
   such as `~/.config/get-me-there/dev-camoufox.env`, and load it into the shell that runs `pnpm dev` with
   `set -a; . ~/.config/get-me-there/dev-camoufox.env; set +a` (the key is never typed or exported by hand, so it never
   reaches shell history); never put that URL in `.env`, where it would break the container. Keep
   `CAMOUFOX_COOLDOWN_HOURS` and `CAMOUFOX_PAGE_TIMEOUT_SECONDS` equal on both sides; the smoke flags a mismatch.
5. **Choose it** — add "Google Flights prices via Camoufox" to a definition's discovery providers; new definitions never
   include it.
6. **Check it** — `pnpm --filter @gmt/camoufox-worker status` (it reads the key from `worker.env` itself and prints the
   live status: cool-down, account-cookie check, flags, versions); `lsof -nP -iTCP:8090 -sTCP:LISTEN` shows
   `127.0.0.1`.
7. **Turn it off or recover** — `CAMOUFOX_ENABLED=false` and restart the app;
   `launchctl bootout gui/$(id -u)/local.get-me-there.camoufox-worker`; an in-flight page finishes before the
   worker exits. After a signed-in refusal: `pnpm --filter @gmt/camoufox-worker clear-signed-in` (it wipes the profile
   first). Deleting the cool-down record ends a pause early, which defeats its purpose.

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

- [ ] **Step 1: Write the failing test** — `camoufoxDocs.test.ts`: setup.md never matches `\$\(grep[^)]*CAMOUFOX_WORKER_KEY`,
`export CAMOUFOX_WORKER_KEY=`, `CAMOUFOX_WORKER_KEY=[0-9a-f]` on a command line, `docker0`, `systemd` or `Linux`
setup text (SEC-R2-005, ruling 2); it has the section heading, `capture-socs`, the `status` script, `set -a`,
the key-only-control sentence,
`worker.env`, `mkdir -p -m 700`, both worker URLs, the "never in `.env`" line, `launchctl bootout`,
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
| `camoufox signed out` | the live `accountCookie.found` is false (its `checkedAt` printed) and no signed-in refusal | `found: true` (the names printed), or a refusal | not configured |
| `camoufox consent` | a `SOCS` capture younger than 13 months, and the page was not `consent-unhandled`; `look` while `socsStable` is false | a `consent-unhandled` block, or no capture | not configured |
| `camoufox settings match` | the worker's `cooldownHours` and `pageTimeoutSeconds` equal the app's | a mismatch (both values printed) | not configured |
| `camoufox one page` | exactly one camoufox row of class `page` for the tile; `no-page` rows printed as "spacing waits" | more than one `page` row | not configured |
| `camoufox not blocked` | the answer was `cells` | `blocked`, `cooling-down` (page kind and end printed) | not configured |
| `camoufox cell` | the price's dates are the query's and the departure was echoed by the options; the return date printed with "(the date asked for, shown in the search form)" | an `options for another cell` count equal to all options | not configured or blocked |
| `camoufox partial` | `look` when the cell carries `offers-dropped`, with its detail; else `ok` | — | not configured or blocked |
| `camoufox provenance` | `scraped-self`, `maxAgeHours` 0, the note equals `CAMOUFOX_DISCOVERY_INFO.provenanceNote`, GBP, point of sale as stated | anything else | not configured or blocked |
| `camoufox selectors` | the status's selectors and grammar versions and its `flags` printed; `look` for each flag still false | a version that differs from the app's build of the worker protocol | not configured |
| `camoufox compare` | `look`: open Google Flights for the cell and compare the price by eye | — | not configured or blocked |

A blocked smoke exits 1, prints the cool-down end, and says every further page will be refused until then.

- [ ] **Step 1: Write the failing test** — one `it` per row, with both `/v1/status` and `/v1/page` scripted through msw
(status: healthy, cooling down, signed-in refusal, `accountCookie.found: true`, settings mismatch; page: cells, cells with dropped options, blocked,
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
- A consent or sign-in redirect is caught on its hop, and service workers are blocked (Tasks 14.1, 14.4).
- Result names are read through locators; a name too long or unreadable counts as unparsed (Tasks 14.1, 14.3).
- The app's start spacing equals the worker's, with a 2 s tolerance at the worker (Tasks 14.2, 14.8).
- The image carries no worker, no browser library and no browser; the app runs with the worker absent (Task 14.11).

## 12. Definition of done

- `pnpm --filter @gmt/camoufox-worker test` (`vitest run --coverage`) passes with its floors (90/80/90/90; 100 lines
  and branches for the eight safety modules); the recorded kinds present locally pass, the absent ones are reported skipped with the decision-61
  suffix; with `fixtures/recorded` holding only `.gitkeep`, `pnpm --filter @gmt/camoufox-worker exec vitest run
  test/recorded.test.ts --reporter verbose` prints `(skipped: recordings not present, local-only, decision 61)` for every
  kind (TS-04).
- `pnpm --filter @gmt/camoufox-worker mutate` passes (Stryker's `thresholds.break` 80, then the gate's ≤ 5% timeouts
  over `reports/mutation/mutation.json`; TS2-05).
- `pnpm --filter @gmt/core test` at 100%; `pnpm --filter @gmt/db test`, `@gmt/providers` (with the `src/camoufox/**`
  floor), `@gmt/engine`, `@gmt/api`, `@gmt/web` with their thresholds; `pnpm test` passes.
- `pnpm lint` clean; `pnpm -r typecheck` clean; `node scripts/check-boundaries.mjs` exits 0;
  `node scripts/check-casts.mjs` exits 0; `pnpm secret-scan` prints `secret scan: clean`.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" apps/camoufox-worker/src packages/providers/src/camoufox` prints nothing.
- `git check-ignore apps/camoufox-worker/fixtures/recorded/2026-10-18/1-results.snapshot.json` prints the path, and
  `git ls-files apps/camoufox-worker/fixtures/recorded` prints only `.gitkeep`.
- `docker compose build app` succeeds; `docker run --rm get-me-there:local sh -c '! test -e /app/apps/camoufox-worker && ! ls -d /app/node_modules/.pnpm/camoufox-js@* /app/node_modules/.pnpm/playwright-core@* 2>/dev/null && ! command -v firefox'`
  exits 0; `docker image ls get-me-there:local` is within 5 MB of main.
- CI's "app runs with the camoufox-worker absent" step passes.
- On the operator's Mac: the launch smoke passes (`about:blank` only); the worker starts against Camoufox
  152.0.4-beta.28 through `camoufox-js`'s install layout; refuses (exit 78) another build, a `camoufox-js` other than
  0.11.5, a set `CAMOUFOX_INSTALL_DIR`, a missing or stale `SOCS` capture, a signed-in profile, a held lock and a
  group-readable `worker.env`; `lsof -nP -iTCP:8090 -sTCP:LISTEN` shows `127.0.0.1` only; the operator's smoke loads
  exactly one page and every row reads `ok` or `look`.
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
6. **Linux support** is out of WP14 (decision 69 round 2): a later package would build the install layout with
   `fontconfig/` and set `os` from the host (PIE-R2-04).
7. **"No flights" page:** until Task 14.1 records one, a day pair with no service reads `unrecognised` and pauses the
   provider for 1 h; the docs say so (cost-014).

## 14. Open questions

None. Decision 69 settled every `[needs judgment]` finding of round 1; the remaining findings follow their reviewers'
suggestions (Appendix A).

## Appendix A: findings and where each is answered

Task numbers are this revision's: 14.1 scaffold, install layout, launch, driver, guards, classifier, cool-down, lock;
14.2 SOCS, pacer, URL, readiness, recorder and recordings; 14.3 grammar and list reader; 14.4 session; 14.5 server;
14.6 core; 14.7 db; 14.8 http-kit and adapter; 14.9 engine; 14.10 wiring and copy; 14.11 Docker, CI, boundaries and
rules; 14.12 docs; 14.13 smoke.

**Round 1**

| Finding | Answer |
|---|---|
| devops-001, PIE-01, SEC-001 | Moot under decision 69: version from the bundle and `camoufox-js`'s `package.json` (§7, 14.1); cookies with `context.cookies()` (14.1, 14.4). |
| PIE-02, SEC-002 | Moot: camofox-browser never called; nothing on a consent page is clicked (14.4, 14.11). |
| arch-001, PIE-14 | Moot: the locator driver is the interface (14.1). |
| arch-002, devops-002 | 14.11: `.dockerignore`, filtered install and build, glob image checks. |
| arch-003 | §10: `fixedClock`; `timers.ts` for waits. |
| arch-004 | 14.6: config test in `schema.test.ts`'s style. |
| arch-005, TS-07 | No casts: `portOf` (14.5), zod-parsed recordings (14.2), `ddl()` guard (14.7). |
| arch-006 | 14.4 rule 4. |
| arch-007 | Snapshot `providerMaxCalls` (14.7, 14.9). |
| arch-008 | All core changes in 14.6; `budgetConfig.ts` in 14.7. |
| arch-009, TS-04 | The worker's devDependency and the boundary rule (14.11). |
| arch-010, TS-01, cost-012, prov-012 | Unknown ids; real helpers; flat db files; tables per CHECK (14.6, 14.7, 14.10). |
| arch-011 | One zod copy in core (14.6). |
| arch-012, SEC-010 | Loopback or `host.docker.internal`, explicit port (14.6, 14.8). |
| arch-013 | `x-gmt-worker-key` in `CREDENTIAL_HEADERS` (14.8). |
| arch-014, devops-003 | Runs from source through `run.ts` (14.1, 14.12). |
| arch-015 | `workerUrl` a string; every limit stated (§5, 14.6). |
| arch-016, TS-02, TS-03 | Behavioural and compiler-API rules (14.11). |
| cost-001, PIE-07 | `retryTransport: false` (14.8). |
| cost-002, PIE-08 | Start to start, worker tolerance 2 s, app `minIntervalMs` (14.2, 14.8). |
| cost-003 | `provider-unavailable`, preflight (14.8, 14.9, 14.11). |
| cost-004, cost-009, cost-011, prov-013 | 14.9 estimate and `budgetFit`; copy (14.10, 14.12). |
| cost-005 | 14.7. |
| cost-006, prov-009 | `page_class`, `x-gmt-google-contacted` (14.5, 14.7, 14.8, 14.12). |
| cost-007, devops-007, TS-09 | 14.4 rules 4, 7, 9; driver deadlines (14.1). |
| cost-008, devops-006 | Persisted pacer (14.2); lock and probe sweep (14.1). |
| cost-010 | 14.7. |
| cost-013 | 14.13 counts `page` rows. |
| cost-014 | 14.2 records it; §13 item 7. |
| cost-015 | Preflight and `operator_notice_keys` (14.7, 14.9). |
| devops-004, SEC-013 | `run.ts` and one `worker.env`; launchd example; exit 78 (14.1, 14.5, 14.12). |
| devops-005, SEC-011 | Superseded by decision 69 round 2: macOS only, `127.0.0.1` bind (14.5). |
| devops-008 | 14.12 step 4. |
| devops-009, SEC-007, PIE-19, SEC-014 | Moot: camofox-browser not used. |
| devops-010 | `capture-socs` (14.2). |
| devops-011 | Persisted refusal and `clear-signed-in` (14.4). |
| devops-012 | 14.11. |
| prov-001 | `CellIssue` with `offersDropped` (14.8). |
| prov-002, PIE-05 | `ready.ts` and polling (14.2, 14.4). |
| prov-003 | Provenance note and stored detail (14.8). |
| prov-004 | Dated table, stored as stated (14.3). |
| prov-005 | Split counts (14.3, 14.8). |
| prov-006, PIE-10 | Airport matching, enumerated interstitials (14.3). |
| prov-007, PIE-16 | Grid not built (§13 item 5). |
| prov-008 | 14.10 copy. |
| prov-010 | 14.8. |
| prov-011, PIE-15 | `form.ts` (14.3). |
| prov-014, prov-015, TS-19 | 14.10, 14.13; numeric sort (14.3). |
| PIE-03, PIE-04, PIE-06, SEC-003, SEC-004, SEC-005, SEC-006, SEC-008, SEC-009, PIE-13 | Moot under decision 69; the consent probe runs in a throwaway profile and never clicks (14.2). |
| PIE-09 | Flags gate the clicks (14.2, 14.4). |
| PIE-11 | 1 h for unrecognised (14.1, 14.4). |
| PIE-12 | Recording order and stability check, attributes captured (14.2). |
| PIE-17 | Frame URL and page text (14.1). |
| PIE-18 | 50–90 s stated (spec §2, 14.9, 14.12). |
| SEC-012 | 14.5. |
| SEC-015 | 14.2 recorder rules. |
| TS-05 | 14.2 `record.test.ts`. |
| TS-06 | 14.5 `config.test.ts`; `run.test.ts` (14.1). |
| TS-08 | Behavioural tests live with their code; task order (§10). |
| TS-10 | 14.4 rule 5. |
| TS-11 | 14.1 cases. |
| TS-12 | `--coverage`, floors, `mutate` (14.1, §12). |
| TS-13 | Per-kind directories and gates (14.2). |
| TS-14 | Exact counts (14.9). |
| TS-15 | 14.5. |
| TS-16 | 14.8, all bodies written. |
| TS-17 | "PASS, no skipped tests" (§10). |
| TS-18 | 14.1, 14.2. |

**Round 2**

| Finding | Answer |
|---|---|
| PIE-R2-01 | Ruling 4: recording order starting with the `SOCS` capture; landing URL asserted; probe without cool-down (14.2). |
| PIE-R2-02 | Ruling 5: no printed ARIA parsing; locator reads (§7, §9, 14.1). |
| PIE-R2-03 | Ruling 1: `camoufox-js`'s install layout, verified or created; no shim; launch smoke (§7, 14.1). |
| PIE-R2-04 | Ruling 2: macOS only (§7, 14.1, 14.5, 14.12; §13 item 6). |
| PIE-R2-05 | Ruling 3: `serviceWorkers: 'block'`, hop and final-URL guards (§6, 14.1, 14.4). |
| PIE-R2-06 | Ruling 6: per-call timeouts, closing deadline, caught races, bounded `finally` (§7, 14.1, 14.4). |
| PIE-R2-07 | Ruling 7: 2 s tolerance, `minIntervalMs` (14.2, 14.8). |
| PIE-R2-08, SEC-R2-002 | Ruling 8: the named set across both hosts, one test per name (§6, 14.1). |
| PIE-R2-09 | No iframe-name rule (§9, 14.1). |
| PIE-R2-10 | Every link counted; long or nameless names unparsed (14.1, 14.3). |
| PIE-R2-11 | Evidence caveat; launch options stored in every recording (introduction, 14.2). |
| PIE-R2-12 | A no-service query chosen at recording time, or recorded as unrecorded (14.2). |
| SEC-R2-001, TS2-06 | Ruling 9: value compared everywhere; `SOCS_STABLE` never weakens it; one tie rule (14.1, 14.2, 14.4; spec §2). |
| SEC-R2-003 | Ruling 4: the probe exception lives only in the recorder, typed without click, swept on start (§6, 14.1, 14.2, 14.11). |
| SEC-R2-004 | Ruling 10: live account check in `/v1/status`; smoke FAIL case (14.5, 14.13). |
| SEC-R2-005 | Ruling 11: `status` script; `set -a` sourcing; docs test (14.5, 14.12). |
| SEC-R2-006 | Ruling 11: `run.ts`, one `worker.env`, mode checked on the loaded file (14.1). |
| SEC-R2-007 | Ruling 3 (§6, 14.1). |
| SEC-R2-008 | Background-service prefs and the launch smoke's host record (§7, 14.1). |
| SEC-R2-009 | The key-only-control sentence; no Linux firewall text (spec §2, 14.12). |
| TS2-01 | Ruling 12: tables per CHECK; `db.raw` (14.7). |
| TS2-02 | Ruling 12: `vitest run --coverage`; ci-gates assertion (14.1). |
| TS2-03 | Task order (§10; 14.1, 14.2). |
| TS2-04 | Injected selectors and tables; flags tested both ways; no unreachable `??` (14.1, 14.3, 14.4, 14.5). |
| TS2-05 | `@stryker-mutator/core` 10.0.0; `mutate` script; DoD line (14.1, §12). |
| TS2-07 | Real sockets through msw `passthrough()`; `cause.code` (14.8). |
| TS2-08 | Bodies written; `expect.hasAssertions()`; order test breaches both scopes (§10, 14.7, 14.8, 14.9). |
| TS2-09 | Shape before pin (§7, 14.1). |
| TS2-10 | `addCookies` allowed in `session.ts` and `record.ts` with `socsCookie(...)`; checkable delay rule (14.11). |
| TS2-11 | Glob image checks in workflows test (14.11, §12). |
| TS2-12 | Per-kind directories; `recordingsPresentForKind` (14.2). |
| TS2-13 | `launch.smoke.test.ts`; `FORM_VERIFIED` refusal test (14.1, 14.5). |
| TS2-14 | Every error path tested (14.4). |
| TS2-15 | Isolated captcha and tablist cases (14.1). |
| TS2-16 | Injectable timers and `pollMs` (§10). |
| TS2-17 | `skipIf` root; `flags` in status (14.1, 14.5, 14.13). |
