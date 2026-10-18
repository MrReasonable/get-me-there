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

Written 2026-10-18 against spec revision 32, plan decisions 1–68 and `main` at 1e79da0. The operator asked for the
Phase 4 continuity fallback to be built, then ruled that its browser is Camoufox, the anti-detection Firefox build
already installed on their machine, driven through the camofox-browser REST server they already run. The provider id
stays `'camoufox'`, as spec §2 always planned. The limits that still bind (no proxies, never solving a challenge, a hard
stop and cool-down on any bot check, consent rejected and never accepted, a fixed low rate, a dedicated signed-out
profile, the camofox-browser access key, off by default) are plan decision 68, and every task below enforces them with a test.

This brief folds in the feasibility load of 2026-10-18: one Google Flights search for the worked example
(`?q=Flights from LHR to JFK on 2026-11-05 returning 2026-11-15&curr=GBP&hl=en-GB&gl=GB`) through the operator's
Camoufox (`@askjo/camofox-browser` 1.13.1, Camoufox 152.0.4-beta.28) loaded the full results with no consent page, no
CAPTCHA and no "unusual traffic" page. The structure it saw is the verified part of the selectors module (§9); the
date grid was not seen and stays unverified until Task 14.12 records it. That load ran signed in to the operator's
Google account, which this brief now forbids (the dedicated profile of Task 14.5).

It also folds in the signed-out test of 2026-10-18: a fresh camofox-browser profile (`gmt-probe-signedout`, no Google
login) landed on `consent.google.com` ("Before you continue", buttons "Reject all" and "Accept all"), with no CAPTCHA
and no "unusual traffic" page; camofox-browser 1.13.1's built-in `dismissConsentDialogs` (`server.js:1934`) then clicked
`button[aria-label="Accept all"]` by itself, twice (it runs after every navigation and no setting turns it off), and the
results page loaded with 26 result links in the same name grammar. The probe profile was deleted. So the worker never
lets the consent page appear: it pre-sets Google's `SOCS` rejection cookie, and treats any consent page as a stop (Task
14.4). The operator's rulings of the same day settle the rest: camofox-browser's `CAMOFOX_ACCESS_KEY` is set and sent;
the robots.txt disallow and Google's terms are known costs the operator accepted in choosing Camoufox; the cool-down is
48 hours by default and configurable; a list-mode return date is labelled as the query's date.

## 1. Goal

Build an opt-in, off-by-default `camoufox` discovery provider that reads Google Flights' cheapest round-trip prices in
the operator's own Camoufox, through a host-side worker that is the camofox-browser REST server's only client for this
app, at a fixed low rate, in a dedicated signed-out profile, stopping at once and cooling down on any bot check, behind
the same contract, ledger, caps and labels as every other provider.

## 2. Scope

**In**

- **The worker** `apps/camoufox-worker` (Tasks 14.1–14.6): a host-side Node process with no browser library. A typed
  client for the camofox-browser REST API pinned at 1.13.1; an accessibility-snapshot model; a pure page classifier
  (results / blocked kinds, consent and signed-in included); the dated selectors module and the dated result-name grammar;
  the `list` reader ("Cheapest" tab, "View more flights", every result's accessible name) and the `grid` reader (refused
  until verified); the `SOCS` rejection cookie set before every page and read back after it; the URL allowlist checked
  after every step; the fixed spacing; the persisted
  cool-down; the start checks (REST version, access key enforced, dedicated profile, no Google account cookie, a dated
  `SOCS` rejection value present and younger than 13 months); the token-authenticated HTTP
  API with its answers.
- **Core widening** (Task 14.7): `ProviderId` gains `'camoufox'`; `SourceKind` gains `'scraped-self'`;
  `ProviderErrorKind` gains `'blocked'`; `BudgetScopeKind` gains `'provider-execution'`; `SOURCE_LABELS` gains
  "Google Flights prices via Camoufox"; the config schema gains the `CAMOUFOX_*` block of spec §12 with its bounds.
- **db** (Task 14.8): migration 0005 widens every `provider_id` and `source_kind` CHECK; the `provider-execution` cap.
- **The adapter** `packages/providers/src/camoufox/` (Task 14.9): `list` tiling (one cell per tile) and `grid` tiling
  (7 × 7), `fetchTile` through http-kit, the answer mapping, `cellIssues` for dropped options and unread cells, `camoufoxHttpLimits` and the one egress exception (exactly
  `CAMOUFOX_WORKER_URL`).
- **Engine** (Task 14.10): the two new rows of the spec §8.1 error table; a manual resume never re-admits a provider
  that was blocked in that execution.
- **Wiring and copy** (Task 14.11): `httpLimitsFor`, `providersFor`, `collectSecrets`; the compact mark `CF`.
- **Recording and replay** (Task 14.12): a development-only recorder that saves accessibility snapshots of the pages the
  worker sees, gitignored and local-only under decision 61, and replay tests that skip visibly without them; the step
  that verifies the grid selectors; a recorded consent page, taken in a throwaway profile, proves the worker refuses it.
- **Compose and checks** (Task 14.13): the `CAMOUFOX_*` environment lines and one `extra_hosts` entry on `app`; CI
  checks that the default image carries no browser and the app runs with the worker absent; the dependency and source
  rules (no proxy, no challenge solver, no cookie import).
- **Operator docs and smoke** (Tasks 14.14, 14.15): `docs/setup.md` section 14, the `docs/providers.md` and
  `docs/api-limits.md` cost entries, `.env.example`, the smoke checklist rows.

**Out**

- Itinerary search (spec §2: a result's accessible name gives the outbound only, with no return leg, flight numbers or
  IATA codes, so a `RawOffer` would be partly invented). The parsed outbound facts (carrier names, stops, duration) are
  read only to validate the grammar and to print in the smoke; nothing stores them.
- Proxies of any kind, CAPTCHA solving, clicking or waiting out a challenge, setting any cookie but the `SOCS`
  rejection, signing in, clicking anything on a consent page. Forbidden by
  decision 68; Task 14.13's tests fail the build if code or a dependency does any of them.
- Installing or configuring Camoufox or camofox-browser. The operator's own; the docs name the versions verified.
- The http-kit pipeline and recorder (**WP4**), normalisation (**WP2/WP7**), the other adapters (**WP5/WP6**).

## 3. Spec sections and plan decisions

- **§2 Continuity fallback (rev 32).** Method (the worker as the REST server's client; `list` and `grid` modes),
  discovery only, limits (dedicated signed-out profile, access key, no proxies, no challenge solved, spacing, caps,
  allowlist, consent rejected through `SOCS` and never accepted, hard stop, cool-down), ledger rows, labels, costs. The costs go verbatim into the operator docs (Task 14.14).
- **§2 table, `camoufox` row.** `scraped-self`, `maxAgeHours` 0.
- **§3.** `error` with reason `blocked`.
- **§5.1.** The widened unions; `BudgetExceeded` scope `provider-execution`.
- **§5.2.** One tile per cell (`list`) or 7 × 7 rectangles (`grid`); cell keys and currency from the page;
  `google.com` link allowlist; the worker's 423 → `blocked`.
- **§5.3.** Never billable; the one egress exception; never cached.
- **§8.1.** The `blocked` and `provider-execution` rows.
- **§9 items 2 and 7.** msw on global fetch for the adapter; the live smoke's one tile per provider.
- **§11.** Labels, the compact mark, banned words (the provenance note passes the banned-word test).
- **§12, §13.** The `CAMOUFOX_*` block; the worker on the operator's machine; the default image unchanged.
- **Plan decisions 61, 64.** Recorded pages never enter git; replay suites skip visibly.
- **Plan decision 68.** The provider id, the limits, the capabilities, the deployment shape.
- **Plan decisions 17, 24, 28.** Limiter smoothing; healthchecks probe nothing; per-cell issues never become `no_data`.

## 4. Interfaces consumed

From `@gmt/core` (plan "Provider port", verbatim names): `FlightProvider`, `DiscoveryCapability`, `CapabilityInfo`,
`DiscoveryQuery`, `TilePlan`, `TileRequest` (`kind: 'rectangle'`), `DiscoveryTileResult`, `RawCalendarPrice`,
`CellIssue`, `CellKey`, `ProviderContext`, `ProviderError`, `Clock`, `Logger`, `Secret`, `generateCells`, `addDays`,
`daysBetween`, `cellKeyString`, `asIsoDate`, `asIata`, `asIsoDateTime`, `isoDateTimeOfEpochMs`, `isoDateSchema`,
`iataSchema`.

From `@gmt/providers` (WP4, WP6): `HttpKit`, `HttpKitRequest`, `ProviderHttpLimits`, `ResponseFacts`, `parseError`,
`NoteCounter`; `recordingsPresent`, `skipTitle` from `@gmt/providers/testing`; the harness `makeKit`, `FakeBudget`,
`testLimits`, `server`.

From `@gmt/db` (WP3): `BudgetGuard.reserve` predicates; the migration runner. From `@gmt/engine` (WP7):
`disabledBefore(ctx, executionId)` and the error-table dispatcher.

From the camofox-browser REST server 1.13.1 (operator-installed, `http://127.0.0.1:9377`): the operations the
feasibility load used, create a tab for a user id, navigate it, read its accessibility snapshot, click an element by
the reference the snapshot gives, close it, plus, if the API offers them, the server version and the profile's cookie
list. Task 14.1 pins the exact paths and bodies from that version's README into `src/rest.ts`; nothing in this brief
names a path the README has not confirmed.

## 5. Interfaces produced

```ts
// packages/core/src/types/provenance.ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'camoufox' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'scraped-self' | 'synthetic';
// packages/core/src/errors.ts
export type ProviderErrorKind = 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout' | 'blocked';
export type BudgetScopeKind = 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-execution'
  | 'provider-month' | 'provider-lifetime' | 'global-month';
// packages/core/src/config/schema.ts (Config.providers)
camoufox: {
  token: Secret; workerUrl: URL;  // http only on loopback or host.docker.internal; no path, no query, no userinfo
  mode: 'list' | 'grid';
  minSpacingSeconds: number;      // ≥ 30, ≤ 600
  executionPageCap: number;       // 1–400
  cooldownHours: number;          // ≥ 24
  pageTimeoutSeconds: number;     // 10–120
  limits: ProviderLimits;         // monthlyCallCap = CAMOUFOX_MONTHLY_PAGE_CAP, ratePerMinute = max(1, floor(60 / spacing)), ratePerHour = floor(3600 / spacing), concurrency 1, cost 0, cacheTtlHours 0, window 'month', executionCallCap = executionPageCap
} | null;

// packages/providers/src/camoufox/index.ts (barrel)
export const CAMOUFOX_DISPLAY_NAME = 'Google Flights via Camoufox';
export const CAMOUFOX_DISCOVERY_INFO: CapabilityInfo;      // scraped-self, maxAgeHours 0
export const GRID_DAYS = 7;
export function planDateGrid(q: DiscoveryQuery): TilePlan[];
export function planSingleCells(q: DiscoveryQuery): TilePlan[];
export function camoufoxProvider(o: { http: HttpKit; log: Logger; clock: Clock; token: Secret; workerUrl: URL; mode: 'list' | 'grid'; pointOfSale: string }): FlightProvider;
export function camoufoxHttpLimits(c: NonNullable<Config['providers']['camoufox']>, cfg: Pick<Config, 'maxWaitSeconds'>): ProviderHttpLimits;

// apps/camoufox-worker/src/protocol.ts (the worker's wire contract; the adapter keeps its own zod copy)
export type PageRequest = { mode: 'list' | 'grid'; origin: Iata; destination: Iata; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate; gl: string };
export type WorkerAnswer =
  | { kind: 'cells'; fetchedAt: IsoDateTime; currency: string; pointOfSale: string; cells: PageCell[]; dropped: DroppedCell[]; optionsDropped: number; notes: string[]; selectorsVersion: string }
  | { kind: 'blocked'; page: BlockedPage; cooldownUntil: IsoDateTime }       // HTTP 423
  | { kind: 'cooling-down'; cooldownUntil: IsoDateTime }                    // HTTP 423, Google not contacted
  | { kind: 'spacing'; retryAfterSeconds: number }                          // HTTP 429, Google not contacted
  | { kind: 'mode-unavailable'; mode: 'grid' };                             // HTTP 409, grid selectors unverified
export type BlockedPage = 'captcha' | 'unusual-traffic' | 'consent-unhandled' | 'sign-in' | 'signed-in' | 'off-allowlist' | 'unrecognised';
export type PageCell = { departureDate: IsoDate; returnDate: IsoDate; amountMinor: number | null };   // null: no price shown
export type DroppedCell = { departureDate: IsoDate | null; returnDate: IsoDate | null; detail: string };

// apps/camoufox-worker/src/ax.ts
export interface AxNode { role: string; name: string; ref?: string; selected?: boolean; children: AxNode[] }
export interface Snapshot { url: string; tree: AxNode }
// apps/camoufox-worker/src/rest.ts
export interface CamofoxRest {
  version(): Promise<string>;
  openWithoutKey(): Promise<'refused' | 'answered'>;                 // one keyless request; the worker refuses to start on 'answered'
  setConsentCookie(profileId: string, socsValue: string): Promise<void>;   // POST /sessions/:userId/cookies, name SOCS only
  consentCookie(profileId: string): Promise<string | null>;          // the session's SOCS value, read back after every page
  discardSession(profileId: string): Promise<void>;                  // close the session and drop its cookies
  accountCookie(profileId: string): Promise<boolean | 'unchecked'>;   // 'unchecked' only when 1.13.1 has no cookie listing
  openTab(profileId: string, url: string): Promise<{ tabId: string }>;
  snapshot(tabId: string): Promise<Snapshot>;
  click(tabId: string, ref: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
}
```

`CamofoxRest` has no navigate-elsewhere, no general cookie import (the one cookie method writes `SOCS` and nothing
else), no type-text and no script-evaluation method, by design: the worker cannot ask the browser for anything the
rules do not allow. Every request carries `CAMOFOX_ACCESS_KEY` in the way the README names.

## 6. Endpoints and parameters

**Worker (host-side, `CAMOUFOX_WORKER_URL`, default `http://127.0.0.1:8090`).** Every request carries
`x-gmt-worker-token: <CAMOUFOX_WORKER_TOKEN>` (constant-time compare; a mismatch is 401 with no detail).
`GET /v1/status` answers `{ ok, coolingDownUntil | null, lastPageAt | null, selectorsVersion, profileId, accountCookie, accessKeyEnforced, socsCapturedAt }`
and never touches Google. `POST /v1/page` takes a `PageRequest` and makes **at most one Google document load**.

**Google (worker side only).** One URL form, the one the feasibility load used, built in `src/url.ts`:
`https://www.google.com/travel/flights?q=Flights from <origin> to <destination> on <depart> returning <return>&curr=GBP&hl=en-GB&gl=<gl>`
with ISO dates; for `list` the cell's own dates, for `grid` the fourth day of each 7-day block (the grid shows the
selected dates ± 3 days). The reverse-engineered `tfs` parameter is never built. `hl=en-GB` is load-bearing: the
selectors and the result grammar match English names.

**URL allowlist (worker `src/classify.ts`).** The worker only ever opens a tab on that URL form and clicks only the
references the selectors module names (the "Cheapest" tab, "View more flights", "Date grid"). After every
open and click it re-reads the snapshot and checks the tab's URL: `https://www.google.com` with a path under
`/travel/flights`. `consent.google.com` is the blocked page `consent-unhandled`, `accounts.google.com` is `sign-in`, and
any other URL is `off-allowlist`. The worker clicks nothing on a consent page, ever. The REST API offers no request filter, so subresources load
as in any browser; spec §2 says so.

**The consent cookie.** Name `SOCS`, verified 2026-10-18 against Google's cookie policy
(<https://policies.google.com/technologies/cookies>: "Google uses the 'SOCS' cookie, which lasts for 13 months, to store
a user's state regarding their cookies choices"). The policy does not document the value, so the worker never invents
one: the operator captures it once, in an ordinary private browser window and never through camofox-browser (whose
`dismissConsentDialogs` would click "Accept all"), by opening `https://www.google.com/travel/flights`, clicking
**Reject all**, and copying the `SOCS` cookie's value, domain and path from the browser's storage view into
`<stateDir>/socs.json` as `{ value, domain, path, capturedAt }` (mode 0600). The worker sets exactly that cookie on its
session before the first navigation and before every page, reads it back after every page, and refuses to start when
the file is missing, malformed, or older than 13 months (the cookie's stated lifetime). If a page shows consent anyway,
or the value read back differs, the answer is `blocked` `consent-unhandled`: the worker discards the session, cools
down, and the operator re-captures the value. An operator may also patch camofox-browser to prefer "Reject all"
(`dismissConsentDialogs`); the worker works the same with or without that patch and never depends on it.

## 7. Library and tool notes

- **camofox-browser 1.13.1** (`@askjo/camofox-browser`, operator-installed, REST on `:9377`, Camoufox
  152.0.4-beta.28). Task 14.1 reads its README at exactly that version and records in `src/rest.ts`'s header the URL,
  the version, the date read and every path and body used. A different server version makes the worker refuse to start
  (`startChecks`), so an upgrade is a deliberate re-verification. The server's `CAMOFOX_ACCESS_KEY` gates every
  route; Step 0 records how the key is sent (header name), and `startChecks` makes one keyless request and refuses to
  start if it is answered. `POST /sessions/:userId/cookies` sets the `SOCS` cookie (Step 0 records its body); Step 0
  also records the route that lists a session's cookies, which `consentCookie` and the account-cookie check use, and
  the route that deletes a session. 1.13.1's `dismissConsentDialogs` (`server.js:1934`) clicks "Accept all" after every
  navigation and cannot be turned off; the design never lets it find a consent page.
- **node:http** for the worker server; **global fetch** for the REST client (Node 22).
- **zod 4** through `@gmt/core` only.
- **msw 3** for the adapter tests (decision 18's guarded server).
- No Playwright, no Puppeteer, no browser binary in this repository's dependency tree for this work package (the
  existing `@playwright/test` in `apps/web` is unrelated and untouched).

## 8. Files

Create:

- `apps/camoufox-worker/package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`
- `apps/camoufox-worker/src/`: `main.ts` (the only `process.env` read), `config.ts`, `protocol.ts`, `rest.ts`, `ax.ts`,
  `selectors.ts`, `names.ts`, `classify.ts`, `list.ts`, `grid.ts`, `consent.ts`, `cooldown.ts`, `pacer.ts`,
  `startChecks.ts`, `session.ts`, `server.ts`, `url.ts`, `record.ts`
- `apps/camoufox-worker/test/`: `support/trees.ts`, `support/fakeRest.ts`, `rest.test.ts`, `classify.test.ts`,
  `names.test.ts`, `list.test.ts`, `grid.test.ts`, `consent.test.ts`, `cooldown.test.ts`, `pacer.test.ts`,
  `startChecks.test.ts`, `session.test.ts`, `server.test.ts`, `url.test.ts`, `recorded.test.ts`, `rules.test.ts`
- `apps/camoufox-worker/fixtures/recorded/.gitkeep`
- `packages/providers/src/camoufox/`: `index.ts`, `provider.ts`, `tiles.ts`, `answer.ts`, `limits.ts`
- `packages/providers/test/camoufox/`: `tiles.test.ts`, `fetchTile.test.ts`, `limits.test.ts`, `egress.test.ts`
- `packages/db/drizzle/0005_camoufox_provider.sql` (and its meta snapshot)

Modify:

- `packages/core/src/types/provenance.ts`, `errors.ts`, `labels/source.ts`, `config/schema.ts`, `config/presets.ts`
- `packages/db/src/internal/enums.ts`, the budget guard
- `packages/providers/src/http/egress.ts`, `http/httpKit.ts`, `http/types.ts`, `test/fakes.ts`
- `packages/engine/src/run.ts`, `execute.ts`, `resume.ts`, `estimate.ts`
- `apps/api/src/wiring.ts`, `apps/api/src/read/usage.ts`, `apps/api/src/tools/smoke.ts`, `smokeChecks.ts`,
  `apps/web/src/copy.ts`, `.env.example`
- `docker-compose.yml`, `.gitignore`, `scripts/check-boundaries.mjs`, `scripts/workflows.test.mjs`,
  `.github/workflows/ci.yml`
- `docs/setup.md`, `docs/providers.md`, `docs/api-limits.md`

## 9. Pages the worker recognises, and what is verified

The classifier is a pure function of the snapshot (`{ url, tree }`). The order is fixed, the first match wins, and
**blocked kinds are tested before anything else**, so a page that shows results and a bot check is blocked.

| Order | Kind | Rule (selectors module) | Verified by | Worker action |
|---|---|---|---|---|
| 1 | `captcha` | any node role `checkbox` named /not a robot/i, or role `iframe`/`document` whose name or URL contains `recaptcha` | not seen; generic | stop, cool down, 423 |
| 2 | `unusual-traffic` | URL path starts `/sorry/`, or any node name matching /unusual traffic/i | not seen; generic | stop, cool down, 423 |
| 3 | `signed-in` | any `button` or `link` named /^Google Account: / | feasibility load (it showed "Google Account: <operator>") | stop, cool down, 423, and refuse to serve until restarted (Task 14.5) |
| 4 | `sign-in` | URL host `accounts.google.com`, or role `heading` named /^Sign in$/ | not seen; generic | stop, cool down, 423 |
| 5 | `off-allowlist` | URL outside §6's allowlist | rule | stop, cool down, 423 |
| 6 | `consent-unhandled` | URL host `consent.google.com`, or a `heading` named "Before you continue" (tested right after `signed-in`, before rows 4 and 5) | signed-out test 2026-10-18 | stop, discard the session, cool down, 423; nothing on the page is clicked |
| 7 | `results` | URL `www.google.com/travel/flights…`, a `tablist` holding a `tab` named /^Cheapest/, and a `button` named "Date grid" | feasibility load | read per mode, 200 `cells` |
| 8 | `unrecognised` | anything else | rule | stop, cool down, 423 |

Seen in the feasibility load (2026-10-18) and therefore the verified half of `selectors.ts`: the `tablist` with `tab`
"Best" and `tab` "Cheapest from £451" (accessible name "Cheapest from Fetching results 451 British pounds"), the text
"24 results returned.", two lists "Top departing flights" and "Other departing flights" whose `listitem`s each hold one
`link` whose name carries the whole option, the buttons "View more flights", "Date grid", "Price graph", "View price
history" and "Sorted by top flights, Change sort order.", and the footer controls "Currency GBP" and "Location·United
Kingdom". Two option names the load returned, used verbatim as the grammar's first test inputs:

- "From 478 British pounds round trip total. 1 stop flight with Tap Air Portugal. Leaves Heathrow Airport at 12:25 on
  Thursday, November 5 and arrives at John F. Kennedy International Airport at 20:05 on Thursday, November 5. Total
  duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Select
  flight"
- "From 534 British pounds round trip total. Non-stop flight with Delta. Leaves Heathrow Airport at 10:10 …" (the load
  report elides the middle; Task 14.12's recording supplies a complete non-stop name before the grammar's non-stop case
  is marked verified).

## 10. Tasks

Every worker test is pure: synthetic accessibility trees (`test/support/trees.ts`) and an in-memory `FakeRest`
(`test/support/fakeRest.ts`) that records every call. No test starts a browser or reaches the network. The
recorded-snapshot suite (Task 14.12) is the only one that reads Google's page structure, and only from local,
gitignored files.

### Task 14.1: Worker scaffold, the pinned REST client, the classifier, the hard stop and the cool-down (first failing test)

**Files:** create `apps/camoufox-worker/{package.json,tsconfig.json,tsconfig.test.json,vitest.config.ts}`,
`src/{protocol.ts,ax.ts,rest.ts,selectors.ts,classify.ts,cooldown.ts}`, `test/support/{trees.ts,fakeRest.ts}`,
`test/{rest.test.ts,classify.test.ts,cooldown.test.ts}`.

**Interfaces:** produces `AxNode`, `Snapshot`, `CamofoxRest`, `restClient`, `parseSnapshot`, `classifyPage`,
`PageKind`, `CooldownStore`, `SELECTORS`, `SELECTORS_VERSION`, `GRID_VERIFIED`.

`package.json`:

```json
{
  "name": "@gmt/camoufox-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run",
    "record": "node dist/record.js"
  },
  "dependencies": { "@gmt/core": "workspace:*" }
}
```

(`devDependencies` copy the exact `vitest` and `typescript` entries of `apps/api/package.json`.)

- [ ] **Step 0: Pin the REST API.** Read the camofox-browser README at 1.13.1 (the package's own published README for
that version). In `src/rest.ts`'s header comment record: the README URL, "version 1.13.1, read <date>", and for each
`CamofoxRest` method the HTTP method, path, request body and the response fields used. Write `parseSnapshot(raw)` in
`src/ax.ts` against the snapshot format that README documents (structured or text), producing `AxNode` trees; if the
README documents only a text form, parse that form and record its grammar in `ax.ts`'s header. Record how 1.13.1
takes `CAMOFOX_ACCESS_KEY`, the body of `POST /sessions/:userId/cookies`, its cookie-listing and session-deletion
routes, and its version route; a missing version route makes `startChecks` read the version from the field the README
names, or refuse to start. A missing cookie listing stops this work package (the `SOCS` read-back and the
account-cookie check both need it): report it to Fable rather than weaken either check.

- [ ] **Step 1: Write the failing test**

`test/support/trees.ts`:

```ts
import type { AxNode, Snapshot } from '../../src/ax.js';

let refs = 0;
/** A synthetic accessibility node. Synthetic only: never copied from a recording. */
export function n(role: string, name: string, children: AxNode[] = [], extra: Partial<AxNode> = {}): AxNode {
  refs += 1;
  return { role, name, ref: `e${refs}`, children, ...extra };
}
export const RESULTS = 'https://www.google.com/travel/flights?q=x&curr=GBP&hl=en-GB&gl=GB';
export const CONSENT = 'https://consent.google.com/ml?continue=x';
export const SORRY = 'https://www.google.com/sorry/index?continue=x';

export function option(pounds: number, rest = '1 stop flight with Example Air. Leaves Heathrow Airport at 12:25 on Thursday, November 5 and arrives at John F. Kennedy International Airport at 20:05 on Thursday, November 5. Total duration 12 hrs 40 min. Select flight'): AxNode {
  return n('listitem', '', [n('link', `From ${pounds} British pounds round trip total. ${rest}`)]);
}

/** A results page shaped like the feasibility load's tree (roles and names only). */
export function resultsTree(o: { cheapestTab?: string; top?: AxNode[]; other?: AxNode[]; extra?: AxNode[]; cheapestSelected?: boolean; moreButton?: boolean } = {}): Snapshot {
  return {
    url: RESULTS,
    tree: n('document', 'Google Flights', [
      n('tablist', '', [n('tab', 'Best', [], { selected: o.cheapestSelected !== true }), n('tab', o.cheapestTab ?? 'Cheapest from Fetching results 451 British pounds', [], { selected: o.cheapestSelected === true })]),
      n('text', '24 results returned.'),
      n('list', 'Top departing flights', o.top ?? [option(478)]),
      n('list', 'Other departing flights', o.other ?? [option(451)]),
      ...(o.moreButton === false ? [] : [n('button', 'View more flights')]),
      n('button', 'Date grid'), n('button', 'Price graph'),
      n('button', 'Currency GBP'), n('button', 'Location·United Kingdom'),
      ...(o.extra ?? []),
    ]),
  };
}
export const captchaTree: Snapshot = { url: RESULTS, tree: n('document', '', [n('checkbox', "I'm not a robot")]) };
export const sorryTree: Snapshot = { url: SORRY, tree: n('document', '', [n('text', 'Our systems have detected unusual traffic from your computer network.')]) };
export const signInTree: Snapshot = { url: RESULTS, tree: n('document', '', [n('heading', 'Sign in')]) };
export const signedInTree = (): Snapshot => resultsTree({ extra: [n('button', 'Google Account: Example Person (example@example.test)')] });
/** Shaped like the signed-out test's consent page (2026-10-18): roles and names only. */
export const consentTree: Snapshot = { url: CONSENT, tree: n('document', '', [n('heading', 'Before you continue'), n('button', 'Reject all'), n('button', 'Accept all')]) };
export const blankTree: Snapshot = { url: RESULTS, tree: n('document', '', [n('text', 'Something else')]) };
```

`test/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyPage } from '../src/classify.js';
import * as T from './support/trees.js';

describe('classifyPage (spec §2, brief §9: stop on anything not recognised)', () => {
  it('a CAPTCHA checkbox is blocked:captcha', () => {
    expect(classifyPage(T.captchaTree)).toEqual({ kind: 'blocked', page: 'captcha' });
  });
  it('the /sorry/ path is blocked:unusual-traffic', () => {
    expect(classifyPage(T.sorryTree)).toEqual({ kind: 'blocked', page: 'unusual-traffic' });
  });
  it('unusual-traffic wording on a results URL is still blocked', () => {
    expect(classifyPage({ url: T.RESULTS, tree: T.sorryTree.tree })).toEqual({ kind: 'blocked', page: 'unusual-traffic' });
  });
  it('a signed-in account control is blocked:signed-in, even on a full results page', () => {
    expect(classifyPage(T.signedInTree())).toEqual({ kind: 'blocked', page: 'signed-in' });
  });
  it('a sign-in heading is blocked:sign-in', () => {
    expect(classifyPage(T.signInTree)).toEqual({ kind: 'blocked', page: 'sign-in' });
  });
  it('accounts.google.com is blocked:sign-in', () => {
    expect(classifyPage({ url: 'https://accounts.google.com/ServiceLogin', tree: T.blankTree.tree })).toEqual({ kind: 'blocked', page: 'sign-in' });
  });
  it('the consent page is blocked:consent-unhandled (the SOCS cookie should have prevented it)', () => {
    expect(classifyPage(T.consentTree)).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
  });
  it('a consent heading on a results URL is still consent-unhandled', () => {
    expect(classifyPage({ url: T.RESULTS, tree: T.consentTree.tree })).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
  });
  it('the feasibility-shaped results page is results', () => {
    expect(classifyPage(T.resultsTree())).toEqual({ kind: 'results' });
  });
  it('results with a CAPTCHA are blocked (blocked kinds first)', () => {
    expect(classifyPage(T.resultsTree({ extra: [T.n('checkbox', "I'm not a robot")] }))).toEqual({ kind: 'blocked', page: 'captcha' });
  });
  it('www.google.com outside /travel/flights is off-allowlist', () => {
    expect(classifyPage({ url: 'https://www.google.com/search?q=x', tree: T.resultsTree().tree })).toEqual({ kind: 'blocked', page: 'off-allowlist' });
  });
  it('plain http is off-allowlist', () => {
    expect(classifyPage({ url: 'http://www.google.com/travel/flights', tree: T.resultsTree().tree })).toEqual({ kind: 'blocked', page: 'off-allowlist' });
  });
  it('anything else is unrecognised', () => {
    expect(classifyPage(T.blankTree)).toEqual({ kind: 'blocked', page: 'unrecognised' });
  });
});
```

`test/cooldown.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, type Clock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CooldownStore } from '../src/cooldown.js';

const at = (iso: string): Clock => ({ now: () => asIsoDateTime(iso) });
const T0 = '2026-10-18T05:00:00.000Z';

describe('CooldownStore (spec §2: pause for CAMOUFOX_COOLDOWN_HOURS after a block)', () => {
  it('a block starts a cool-down of the configured hours', () => {
    const s = new CooldownStore({ dir: mkdtempSync(join(tmpdir(), 'cd-')), hours: 48, clock: at(T0) });
    expect(s.activeUntil()).toBeNull();
    s.start('captcha');
    expect(s.activeUntil()).toBe('2026-10-20T05:00:00.000Z');
  });
  it('survives a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-'));
    new CooldownStore({ dir, hours: 48, clock: at(T0) }).start('unusual-traffic');
    expect(new CooldownStore({ dir, hours: 48, clock: at('2026-10-19T05:00:00.000Z') }).activeUntil()).toBe('2026-10-20T05:00:00.000Z');
  });
  it('ends at the boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-'));
    new CooldownStore({ dir, hours: 48, clock: at(T0) }).start('sign-in');
    expect(new CooldownStore({ dir, hours: 48, clock: at('2026-10-20T05:00:00.000Z') }).activeUntil()).toBeNull();
  });
  it('a later block never shortens it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-'));
    new CooldownStore({ dir, hours: 72, clock: at(T0) }).start('captcha');
    const s = new CooldownStore({ dir, hours: 24, clock: at('2026-10-18T06:00:00.000Z') });
    s.start('captcha');
    expect(s.activeUntil()).toBe('2026-10-21T05:00:00.000Z');
  });
  it('a corrupt record fails closed: a fresh cool-down from now', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-'));
    writeFileSync(join(dir, 'cooldown.json'), '{not json');
    expect(new CooldownStore({ dir, hours: 48, clock: at(T0) }).activeUntil()).toBe('2026-10-20T05:00:00.000Z');
    expect(JSON.parse(readFileSync(join(dir, 'cooldown.json'), 'utf8')).page).toBe('unrecognised');
  });
  it('rejects fewer than 24 hours', () => {
    expect(() => new CooldownStore({ dir: tmpdir(), hours: 23, clock: at(T0) })).toThrow(/at least 24/);
  });
});
```

`test/rest.test.ts` (a contract test of `restClient` against a local `node:http` stand-in that answers the paths
pinned in Step 0 with the shapes the README documents, built from synthetic trees): one `it` per `CamofoxRest` method
asserting the method, path and body sent and the parsed result, plus: the client refuses a base URL that is not
loopback; it never sends a cookie header; a non-2xx answer throws `RestError` with the status and no response body in
the message.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/camoufox-worker exec vitest run test/classify.test.ts test/cooldown.test.ts test/rest.test.ts`
Expected: FAIL, `Cannot find module '../src/classify.js'` (and the others).

- [ ] **Step 3: Implement**

`src/selectors.ts`:

```ts
/**
 * Every role and name the worker matches, in one dated module (spec §2). Accessible names assume hl=en-GB. why: Google
 * changes its page without notice; a change must surface as `unrecognised` (a stop), never as a wrong parse, and the
 * fix is a new recording, an edit here and a new version, in one commit.
 *
 * Results-page entries were seen in the feasibility load of 2026-10-18 and the consent page in the signed-out test of
 * the same day (brief §9). Grid entries were not seen: GRID_VERIFIED stays false until Task 14.12's recording confirms
 * them, and the worker refuses grid mode while it is false.
 */
export const SELECTORS_VERSION = '2026-10-18-results';
export const GRID_VERIFIED = false;

export const SELECTORS = {
  hosts: { results: 'www.google.com', consent: 'consent.google.com', signIn: 'accounts.google.com' },
  resultsPathPrefix: '/travel/flights',
  blocked: {
    captchaName: /not a robot/i,
    captchaFrame: /recaptcha/i,
    sorryPathPrefix: '/sorry/',
    unusualTraffic: /unusual traffic/i,
    signInHeading: /^Sign in$/,
    accountControl: /^Google Account: /,
  },
  consent: { heading: /^Before you continue$/ },
  results: {
    cheapestTab: /^Cheapest\b/,
    cheapestTabPrice: /([0-9][0-9,]*) British pounds$/,
    lists: ['Top departing flights', 'Other departing flights'],
    moreButton: 'View more flights',
    dateGridButton: 'Date grid',
    currencyControl: /^Currency ([A-Z]{3})$/,
    locationControl: /^Location·(.+)$/,
  },
  grid: {
    dialog: /date grid/i,
    headerDate: /^(?:[A-Z][a-z]{2}, )?(\d{1,2}) ([A-Z][a-z]{2})$/,
    price: /^£([0-9][0-9,]*)$/,
    noPrice: /^(?:—|-|–)$/,
  },
} as const;
```

`src/ax.ts` (the model plus helpers; `parseSnapshot` per Step 0):

```ts
export interface AxNode { role: string; name: string; ref?: string; selected?: boolean; children: AxNode[] }
export interface Snapshot { url: string; tree: AxNode }

/** Depth-first walk. */
export function* walk(n: AxNode): Generator<AxNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}
/** Every node with this role whose name matches (exact string or pattern). */
export function find(t: AxNode, role: string | readonly string[], name: string | RegExp): AxNode[] {
  const roles = typeof role === 'string' ? [role] : role;
  return [...walk(t)].filter((x) => roles.includes(x.role) && (typeof name === 'string' ? x.name === name : name.test(x.name)));
}
```

`src/classify.ts`:

```ts
import { find, type Snapshot, walk } from './ax.js';
import type { BlockedPage } from './protocol.js';
import { SELECTORS as S } from './selectors.js';

export type PageKind = { kind: 'results' } | { kind: 'blocked'; page: BlockedPage };

/** Spec §2 and brief §9: blocked kinds first; anything not positively recognised is `unrecognised`. Pure. */
export function classifyPage(s: Snapshot): PageKind {
  const url = new URL(s.url);
  const nodes = [...walk(s.tree)];
  if (nodes.some((x) => S.blocked.captchaName.test(x.name) || ((x.role === 'iframe' || x.role === 'document') && S.blocked.captchaFrame.test(x.name))))
    return { kind: 'blocked', page: 'captcha' };
  if (url.pathname.startsWith(S.blocked.sorryPathPrefix) || nodes.some((x) => S.blocked.unusualTraffic.test(x.name)))
    return { kind: 'blocked', page: 'unusual-traffic' };
  if (find(s.tree, ['button', 'link'], S.blocked.accountControl).length > 0) return { kind: 'blocked', page: 'signed-in' };
  // why: camofox-browser accepts consent on its own; a consent page means the SOCS rejection did not hold (spec §2).
  if (url.hostname === S.hosts.consent || find(s.tree, 'heading', S.consent.heading).length > 0)
    return { kind: 'blocked', page: 'consent-unhandled' };
  if (url.hostname === S.hosts.signIn || find(s.tree, 'heading', S.blocked.signInHeading).length > 0)
    return { kind: 'blocked', page: 'sign-in' };
  const https = url.protocol === 'https:';
  const onResults = https && url.hostname === S.hosts.results && url.pathname.startsWith(S.resultsPathPrefix);
  if (!onResults) return { kind: 'blocked', page: 'off-allowlist' };
  const tabs = find(s.tree, 'tab', S.results.cheapestTab);
  if (tabs.length === 1 && find(s.tree, 'button', S.results.dateGridButton).length === 1) return { kind: 'results' };
  return { kind: 'blocked', page: 'unrecognised' };
}
```

`src/cooldown.ts`:

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Clock, type IsoDateTime, isoDateTimeOfEpochMs } from '@gmt/core';
import type { BlockedPage } from './protocol.js';

/**
 * The worker's refusal period after a block (spec §2, plan decision 68), persisted in its state directory so a restart
 * does not clear it and every app that calls the worker sees the same one. Fails closed on an unreadable record.
 */
export class CooldownStore {
  private readonly file: string;
  constructor(private readonly o: { dir: string; hours: number; clock: Clock }) {
    if (!Number.isInteger(o.hours) || o.hours < 24) throw new Error('CAMOUFOX_COOLDOWN_HOURS must be at least 24');
    this.file = join(o.dir, 'cooldown.json');
  }
  activeUntil(): IsoDateTime | null {
    const rec = this.read();
    return rec !== null && Date.parse(rec.until) > Date.parse(this.o.clock.now()) ? rec.until : null;
  }
  start(page: BlockedPage): IsoDateTime {
    const proposed = Date.parse(this.o.clock.now()) + this.o.hours * 3_600_000;
    const current = this.read();
    const until = isoDateTimeOfEpochMs(Math.max(proposed, current === null ? 0 : Date.parse(current.until)));
    this.write({ until, page, at: this.o.clock.now() });
    return until;
  }
  private read(): { until: IsoDateTime } | null {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
      throw e;
    }
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v === 'object' && v !== null && 'until' in v && typeof v.until === 'string' && !Number.isNaN(Date.parse(v.until)))
        return { until: isoDateTimeOfEpochMs(Date.parse(v.until)) };
    } catch {
      // why: falls through to fail closed
    }
    // why: an unreadable record must never mean "not cooling down" (spec §2).
    const until = isoDateTimeOfEpochMs(Date.parse(this.o.clock.now()) + this.o.hours * 3_600_000);
    this.write({ until, page: 'unrecognised', at: this.o.clock.now() });
    return { until };
  }
  private write(rec: { until: IsoDateTime; page: BlockedPage; at: IsoDateTime }): void {
    mkdirSync(this.o.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
```

`src/rest.ts`: `restClient(base: URL): CamofoxRest` over global `fetch`, implementing exactly the paths pinned in Step
0; it throws at construction unless `base.hostname` is `127.0.0.1`, `localhost` or `::1`; it sets no `cookie` header;
`snapshot` returns `parseSnapshot(body)`; every non-2xx throws `RestError(status)`.

`test/support/fakeRest.ts`: `FakeRest implements CamofoxRest` with a queue of snapshots per tab, a `calls` log
(`{ op, profileId?, url?, ref?, value? }`), options `version`, `accountCookie` and `keyless`, and `consentAfterPage`
(the `SOCS` value `consentCookie` returns; by default the last value set).

- [ ] **Step 4: Run to verify it passes**

Run: the Step 2 command. Expected: PASS (13 classify, 6 cool-down, and the REST contract tests).

- [ ] **Step 5: Commit**

```bash
git add apps/camoufox-worker pnpm-lock.yaml && git commit -m "wp14: camoufox worker scaffold, pinned REST client, page classifier, hard stop and cool-down"
```

### Task 14.2: The result-name grammar and the list reader

**Files:** create `src/names.ts`, `src/list.ts`, `test/names.test.ts`, `test/list.test.ts`.

**Interfaces:** `parseOptionName(name): ParsedOption | null` with `ParsedOption = { amountMinor; currency: 'GBP';
stops: number; carriers: string; departsOn: { month: number; day: number }; durationMinutes: number }`;
`readList(snap, req): ListRead` with `ListRead = { cheapestTabMinor: number | null; options: ParsedOption[];
optionsDropped: number; currency: string | null; pointOfSale: string }`.

Rules: the price is read only from the leading "From <n> British pounds round trip total." clause, exact digits, no
float; "British pounds" is the only currency phrase the grammar knows, and any other phrase drops the option; an option
that does not match the whole grammar is dropped and counted (`optionsDropped`), never partly read; the cell's price
(Task 14.5) is the minimum over parsed options whose `departsOn` equals the cell's departure date; options leaving on
another date are dropped and counted (`departure-mismatch` note); the "Cheapest" tab's own price is read separately and
compared.

- [ ] **Step 1: Write the failing tests**

`test/names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GRAMMAR_VERSION, parseOptionName } from '../src/names.js';

// The first input is the feasibility load's option name of 2026-10-18, verbatim (brief §9).
const ONE_STOP = 'From 478 British pounds round trip total. 1 stop flight with Tap Air Portugal. Leaves Heathrow Airport at 12:25 on Thursday, November 5 and arrives at John F. Kennedy International Airport at 20:05 on Thursday, November 5. Total duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Select flight';

describe('parseOptionName (dated grammar, spec §2 list mode)', () => {
  it('parses the feasibility one-stop name', () => {
    expect(parseOptionName(ONE_STOP)).toEqual({ amountMinor: 47800, currency: 'GBP', stops: 1, carriers: 'Tap Air Portugal', departsOn: { month: 11, day: 5 }, durationMinutes: 760 });
  });
  it('parses a non-stop name', () => {
    const name = 'From 534 British pounds round trip total. Non-stop flight with Delta. Leaves Heathrow Airport at 10:10 on Thursday, November 5 and arrives at John F. Kennedy International Airport at 13:27 on Thursday, November 5. Total duration 8 hrs 17 min. Select flight';
    expect(parseOptionName(name)).toMatchObject({ amountMinor: 53400, stops: 0, carriers: 'Delta', durationMinutes: 497 });
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
    ['an empty name', ''],
  ])('%s is dropped (null), never partly read', (_n, name) => {
    expect(parseOptionName(name)).toBeNull();
  });
  it('the grammar is dated', () => {
    expect(GRAMMAR_VERSION).toMatch(/^2026-10-18/);
  });
});
```

`test/list.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { readList } from '../src/list.js';
import { n, option, resultsTree } from './support/trees.js';

const REQ = { mode: 'list' as const, origin: asIata('LHR'), destination: asIata('JFK'), gl: 'GB',
  departFrom: asIsoDate('2026-11-05'), departTo: asIsoDate('2026-11-05'), returnFrom: asIsoDate('2026-11-15'), returnTo: asIsoDate('2026-11-15') };

describe('readList (spec §2 list mode)', () => {
  it('reads every option of both lists, the tab price, currency and point of sale', () => {
    const r = readList(resultsTree({ top: [option(478), option(534)], other: [option(451)] }), REQ);
    expect(r.options.map((o) => o.amountMinor).sort()).toEqual([45100, 47800, 53400]);
    expect(r.cheapestTabMinor).toBe(45100);
    expect(r.currency).toBe('GBP');
    expect(r.pointOfSale).toBe('GB');
    expect(r.optionsDropped).toBe(0);
  });
  it('an option whose name does not parse is dropped and counted', () => {
    const r = readList(resultsTree({ top: [option(478), n('listitem', '', [n('link', 'Something Google added')])] }), REQ);
    expect(r.optionsDropped).toBe(1);
  });
  it('an option leaving on another day is dropped and counted', () => {
    const other = option(300, '1 stop flight with Example Air. Leaves Heathrow Airport at 12:25 on Friday, November 6 and arrives at John F. Kennedy International Airport at 20:05 on Friday, November 6. Total duration 12 hrs 40 min. Select flight');
    const r = readList(resultsTree({ top: [option(478), other] }), REQ);
    expect(r.options.map((o) => o.amountMinor)).not.toContain(30000);
    expect(r.optionsDropped).toBe(1);
  });
  it('no currency control: currency null (the session stops as unrecognised)', () => {
    const t = resultsTree();
    t.tree.children = t.tree.children.filter((c) => c.name !== 'Currency GBP');
    expect(readList(t, REQ).currency).toBeNull();
  });
  it('another location: point of sale unknown', () => {
    const t = resultsTree();
    for (const c of t.tree.children) if (c.name.startsWith('Location·')) c.name = 'Location·Elsewhere';
    expect(readList(t, REQ).pointOfSale).toBe('unknown');
  });
  it('a tab name with no price gives cheapestTabMinor null', () => {
    expect(readList(resultsTree({ cheapestTab: 'Cheapest' }), REQ).cheapestTabMinor).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/names.test.ts test/list.test.ts`; FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/names.ts`:

```ts
/**
 * The grammar of one result's accessible name (spec §2 list mode), dated like the selectors. why: the name carries the
 * whole option in English prose; a strict whole-string match drops anything Google rewords instead of misreading it.
 * Verified against the feasibility load's one-stop name (2026-10-18); the non-stop case is verified by Task 14.12.
 */
export const GRAMMAR_VERSION = '2026-10-18-feasibility';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NAME = new RegExp(
  '^From ([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+) British pounds round trip total\\. ' +
    '(Non-stop|([0-9]+) stops?) flight with (.+?)\\. ' +
    'Leaves (.+?) at ([0-9]{1,2}:[0-9]{2}) on [A-Z][a-z]+, ([A-Z][a-z]+) ([0-9]{1,2}) ' +
    'and arrives at (.+?) at ([0-9]{1,2}:[0-9]{2}) on [A-Z][a-z]+, [A-Z][a-z]+ [0-9]{1,2}\\. ' +
    'Total duration (?:([0-9]+) hrs?)? ?(?:([0-9]+) min)?\\.' +
    '(?: .*)? ?Select flight$',
);

export interface ParsedOption { amountMinor: number; currency: 'GBP'; stops: number; carriers: string; departsOn: { month: number; day: number }; durationMinutes: number }

/** Whole-name parse or null; never a partial read. */
export function parseOptionName(name: string): ParsedOption | null {
  const m = NAME.exec(name);
  if (m === null) return null;
  const [, pounds = '', stopWord = '', stopN, carriers = '', , , monthName = '', day = '', , , hrs, mins] = m;
  const month = MONTHS.indexOf(monthName) + 1;
  if (month === 0 || (hrs === undefined && mins === undefined)) return null;
  const digits = pounds.replaceAll(',', '');
  return {
    amountMinor: Number(`${digits}00`),
    currency: 'GBP',
    stops: stopWord === 'Non-stop' ? 0 : Number(stopN),
    carriers,
    departsOn: { month, day: Number(day) },
    durationMinutes: Number(hrs ?? 0) * 60 + Number(mins ?? 0),
  };
}
```

`src/list.ts`: walks the two lists named in `SELECTORS.results.lists`, takes each `listitem`'s single `link` name, parses
it, keeps options whose `departsOn` equals `req.departFrom`'s month and day, counts the rest (unparsed and
departure-mismatch) in `optionsDropped`; reads the tab price with `cheapestTabPrice`; reads currency and location from
the footer controls (`'GB'` only for "United Kingdom"; anything else `'unknown'`).

- [ ] **Step 4: Run** — PASS, 12 + 6 tests.

- [ ] **Step 5: Commit** — `git commit -am "wp14: dated result-name grammar and the list reader"`

### Task 14.3: The grid reader (refused until verified)

**Files:** create `src/grid.ts`, `test/grid.test.ts`.

**Interfaces:** `readGrid(snap, req): GridRead` (`cells: PageCell[]`, `dropped: DroppedCell[]`, `currency`,
`pointOfSale`), `resolveHeaderDate(text, from, to)`, `GridUnreadable`.

The grid's roles are a hypothesis until Task 14.12 records it: the reader expects a node role `dialog` named /date
grid/i holding `columnheader`s (departure days), `row`s each with one `rowheader` (return day) and `gridcell`s. Rules
(spec §2, §5.2): keys from the headers; a header shows day and month only, so the year is the unique date inside the
requested block ± 7 days, else the whole row or column is dropped and reported (`header-unresolved`); `£` prices only,
exact digits; the no-price mark gives `amountMinor: null`; any other text drops the cell (`unreadable-cell`); a grid
with no cells throws `GridUnreadable`.

- [ ] **Step 1: Write the failing test.** Build a synthetic 7 × 7 grid with `n('dialog', 'Date grid', [...])`, rows of
`n('row', '', [n('rowheader', 'Sun, 21 Mar'), n('gridcell', '£412'), …])` and a header row of `columnheader`s, and
assert, one `it` each: 49 keyed cells in pence; a "—" cell is `amountMinor: null` and not dropped; an unreadable cell is
dropped with both dates; `£1,204` is 120400 and `£412.50` is dropped, never rounded; a header that matches no date drops
its column (7 drops, `departureDate: null`, `header-unresolved`); a `$` cell is dropped (`unreadable-cell`); an empty
grid throws `GridUnreadable`; `resolveHeaderDate('Fri, 31 Dec', 2027-12-29, 2028-01-04)` is 2027-12-31 and `'Sat, 1 Jan'`
is 2028-01-01; `'1 Jun'` against a March block is null.

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/grid.test.ts`; FAIL.

- [ ] **Step 3: Implement** `src/grid.ts` over `ax.ts`'s `find`/`walk`, with `resolveHeaderDate` iterating
`addDays(from, -7)` to `addDays(to, 7)` and returning a date only when exactly one matches, and prices through the
same exact-digit rule as `names.ts`.

- [ ] **Step 4: Run** — PASS, 10 tests.

- [ ] **Step 5: Commit** — `git commit -am "wp14: grid reader over the accessibility tree, gated until verified"`

### Task 14.4: Consent: the SOCS rejection cookie, never an accept

**Files:** create `src/consent.ts`, `test/consent.test.ts`.

**Interfaces:** `loadSocs(stateDir, clock): SocsValue` (throws `ConsentNotCaptured` when `<stateDir>/socs.json` is
missing, malformed or older than 13 months); `SocsValue = { value: string; domain: '.google.com'; path: '/';
capturedAt: IsoDateTime }`; `SOCS_NAME = 'SOCS'`.

Why this shape (spec §2, the signed-out test): camofox-browser 1.13.1 clicks "Accept all" on its own after every
navigation, so the worker cannot reach "Reject all" by clicking. Instead it never lets the consent page appear: the
rejection cookie is already on the session when Google is asked for the page. The value comes from a real rejection the
operator makes in an ordinary private browser window (brief §6), because Google does not document it.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ConsentNotCaptured, loadSocs, SOCS_NAME } from '../src/consent.js';

const clock = { now: () => asIsoDateTime('2026-10-18T05:00:00.000Z') };
// A synthetic value: the real one is captured by the operator and never enters git.
const SYNTHETIC = { value: 'synthetic-socs-rejection-value', domain: '.google.com', path: '/', capturedAt: '2026-10-18T04:00:00.000Z' };
function dirWith(content: string | null): string {
  const d = mkdtempSync(join(tmpdir(), 'socs-'));
  if (content !== null) writeFileSync(join(d, 'socs.json'), content);
  return d;
}

describe('loadSocs (spec §2: the consent rejection is a captured, dated value)', () => {
  it('loads a captured value', () => {
    expect(loadSocs(dirWith(JSON.stringify(SYNTHETIC)), clock)).toEqual(SYNTHETIC);
  });
  it.each([
    ['missing', null],
    ['malformed', '{not json'],
    ['another domain', JSON.stringify({ ...SYNTHETIC, domain: '.example.test' })],
    ['an empty value', JSON.stringify({ ...SYNTHETIC, value: '' })],
    ['older than 13 months', JSON.stringify({ ...SYNTHETIC, capturedAt: '2025-09-01T00:00:00.000Z' })],
  ])('%s refuses, naming how to capture it', (_n, content) => {
    expect(() => loadSocs(dirWith(content), clock)).toThrow(ConsentNotCaptured);
    expect(() => loadSocs(dirWith(content), clock)).toThrow(/private browser window.*Reject all/);
  });
  it('the cookie name is SOCS, from Google\'s cookie policy', () => {
    expect(SOCS_NAME).toBe('SOCS');
  });
  it('no worker source names an accept control, and the selectors name no consent button at all', () => {
    const src = ['consent.ts', 'selectors.ts', 'session.ts', 'classify.ts'].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('');
    expect(src).not.toMatch(/accept all|i agree|i accept/i);
    const selectors = readFileSync(new URL('../src/selectors.ts', import.meta.url), 'utf8');
    expect(selectors).not.toMatch(/reject all/i);
  });
});
```

(The last test reads `session.ts`, so it passes once Task 14.5 exists; until then run the others. The selectors never
name "Reject all": the worker never looks for that button, because it never acts on a consent page; the words appear
only in the operator's capture instructions.)

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/consent.test.ts`; FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Clock, type IsoDateTime, isoDateTimeSchema } from '@gmt/core';

/** Google's consent-choice cookie (https://policies.google.com/technologies/cookies, read 2026-10-18). */
export const SOCS_NAME = 'SOCS';
/** The cookie's stated lifetime; a captured value older than this is refused. */
const LIFETIME_MS = 13 * 30.44 * 86_400_000;

export interface SocsValue { value: string; domain: '.google.com'; path: '/'; capturedAt: IsoDateTime }
export class ConsentNotCaptured extends Error {}

const HOW = 'capture it: in an ordinary private browser window (not camofox-browser), open https://www.google.com/travel/flights, click Reject all, and copy the SOCS cookie into socs.json (docs/setup.md section 14)';

/**
 * The rejection value the worker pre-sets on its session (spec §2). why: camofox-browser 1.13.1 clicks "Accept all" by
 * itself, so the rejection must already be in place before Google is asked for a page; Google does not document the
 * value, so it is captured from a real rejection, never invented.
 */
export function loadSocs(stateDir: string, clock: Clock): SocsValue {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(join(stateDir, 'socs.json'), 'utf8'));
  } catch {
    throw new ConsentNotCaptured(`no readable socs.json in ${stateDir}; ${HOW}`);
  }
  if (typeof v !== 'object' || v === null || !('value' in v) || !('domain' in v) || !('path' in v) || !('capturedAt' in v))
    throw new ConsentNotCaptured(`socs.json is incomplete; ${HOW}`);
  const at = isoDateTimeSchema.safeParse(v.capturedAt);
  if (typeof v.value !== 'string' || v.value === '' || v.domain !== '.google.com' || v.path !== '/' || !at.success)
    throw new ConsentNotCaptured(`socs.json is not a .google.com SOCS value; ${HOW}`);
  if (Date.parse(clock.now()) - Date.parse(at.data) > LIFETIME_MS)
    throw new ConsentNotCaptured(`the SOCS value is older than its 13-month lifetime; ${HOW}`);
  return { value: v.value, domain: '.google.com', path: '/', capturedAt: at.data };
}
```

- [ ] **Step 4: Run** — PASS, 7 tests (8 after Task 14.5).

- [ ] **Step 5: Commit** — `git commit -am "wp14: the captured SOCS rejection value, refused when missing or stale"`

### Task 14.5: Spacing, the start checks and the page session (one page at a time; stop and cool down)

**Files:** create `src/pacer.ts`, `src/url.ts`, `src/startChecks.ts`, `src/session.ts`, `test/pacer.test.ts`,
`test/url.test.ts`, `test/startChecks.test.ts`, `test/session.test.ts`.

**Interfaces:** `Pacer` (`claim()`, `release()`); `pageUrl(req): URL`; `startChecks(rest, cfg): Promise<void>`;
`PageSession` (`page(req): Promise<WorkerAnswer>`).

Rules: concurrency 1; spacing from the end of one page load to the start of the next, never below 30 s, never
randomised; a request during a cool-down answers `cooling-down` and opens no tab; a request while refusing (after a
`signed-in` stop) answers `blocked` `signed-in` and opens no tab; every tab is opened under `CAMOUFOX_PROFILE_ID` and
closed in `finally`; before opening the tab the session sets the `SOCS` rejection cookie on its profile, and after the
page it reads `SOCS` back: a different value, or a consent page at any step, is `blocked` `consent-unhandled`, and the
session is discarded (`discardSession`) before the cool-down starts; the only clicks are the "Cheapest" tab, "View more
flights" and (grid mode) "Date grid", never anything on a consent page; after every open and click the session re-reads the snapshot and re-classifies; `grid` mode is
answered `mode-unavailable` while `GRID_VERIFIED` is false. Start checks: the REST server's version equals the pinned
1.13.1; a request made without `CAMOFOX_ACCESS_KEY` is refused by the server; `loadSocs` succeeds; `CAMOUFOX_PROFILE_ID` matches `^gmt-[a-z0-9-]{1,40}$` (so it can never be the operator's everyday profile by
accident); `accountCookie(profileId)` is `false`.

- [ ] **Step 1: Write the failing tests**

`test/pacer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer.js';

describe('Pacer (spec §2: concurrency 1, ≥ 30 s between page loads, never randomised)', () => {
  it('refuses spacing below 30 seconds', () => {
    expect(() => new Pacer({ minSpacingSeconds: 29, nowMs: () => 0 })).toThrow(/at least 30/);
  });
  it('a second claim while busy is refused with the full spacing', () => {
    const p = new Pacer({ minSpacingSeconds: 30, nowMs: () => 0 });
    expect(p.claim()).toEqual({ ok: true });
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 30 });
  });
  it('spacing runs from the end of the previous load', () => {
    const t = { v: 0 };
    const p = new Pacer({ minSpacingSeconds: 30, nowMs: () => t.v });
    p.claim(); t.v = 12_000; p.release();
    t.v = 41_999; expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
    t.v = 42_000; expect(p.claim()).toEqual({ ok: true });
  });
  it('is deterministic', () => {
    const a = new Pacer({ minSpacingSeconds: 45, nowMs: () => 0 });
    const b = new Pacer({ minSpacingSeconds: 45, nowMs: () => 0 });
    a.claim(); b.claim();
    expect(a.claim()).toEqual(b.claim());
  });
});
```

`test/url.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { pageUrl } from '../src/url.js';

const base = { origin: asIata('LHR'), destination: asIata('JFK'), gl: 'GB' };
describe('pageUrl (brief §6, the feasibility form)', () => {
  it('list mode queries the cell itself', () => {
    const u = pageUrl({ ...base, mode: 'list', departFrom: asIsoDate('2026-11-05'), departTo: asIsoDate('2026-11-05'), returnFrom: asIsoDate('2026-11-15'), returnTo: asIsoDate('2026-11-15') });
    expect(`${u.origin}${u.pathname}`).toBe('https://www.google.com/travel/flights');
    expect(u.searchParams.get('q')).toBe('Flights from LHR to JFK on 2026-11-05 returning 2026-11-15');
    expect([...u.searchParams.keys()].sort()).toEqual(['curr', 'gl', 'hl', 'q']);
    expect([u.searchParams.get('curr'), u.searchParams.get('hl'), u.searchParams.get('gl')]).toEqual(['GBP', 'en-GB', 'GB']);
  });
  it('grid mode centres on the fourth day of each block', () => {
    const u = pageUrl({ ...base, mode: 'grid', departFrom: asIsoDate('2027-03-11'), departTo: asIsoDate('2027-03-17'), returnFrom: asIsoDate('2027-03-21'), returnTo: asIsoDate('2027-03-27') });
    expect(u.searchParams.get('q')).toBe('Flights from LHR to JFK on 2027-03-14 returning 2027-03-24');
  });
  it('never builds a tfs parameter', () => {
    const u = pageUrl({ ...base, mode: 'list', departFrom: asIsoDate('2027-01-01'), departTo: asIsoDate('2027-01-01'), returnFrom: asIsoDate('2027-01-11'), returnTo: asIsoDate('2027-01-11') });
    expect(u.searchParams.has('tfs')).toBe(false);
  });
});
```

`test/startChecks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asIsoDateTime } from '@gmt/core';
import { ConsentNotCaptured } from '../src/consent.js';
import { startChecks } from '../src/startChecks.js';
import { FakeRest } from './support/fakeRest.js';

const OK = { version: '1.13.1', accountCookie: false, keyless: 'refused' as const };
const SOCS = { value: 'synthetic-socs-rejection-value', domain: '.google.com' as const, path: '/' as const, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') };

describe('startChecks (spec §2: dedicated signed-out profile; access key; pinned REST version; captured SOCS)', () => {
  it('passes on the pinned version, an enforced key, a gmt- profile, no account cookie and a captured SOCS', async () => {
    await expect(startChecks(new FakeRest(OK), { profileId: 'gmt-worker', socs: () => SOCS })).resolves.toBeUndefined();
  });
  it('refuses a server that answers without the access key', async () => {
    await expect(startChecks(new FakeRest({ ...OK, keyless: 'answered' }), { profileId: 'gmt-worker', socs: () => SOCS })).rejects.toThrow(/CAMOFOX_ACCESS_KEY/);
  });
  it('refuses without a captured SOCS value', async () => {
    await expect(startChecks(new FakeRest(OK), { profileId: 'gmt-worker', socs: () => { throw new ConsentNotCaptured('no socs.json'); } })).rejects.toThrow(ConsentNotCaptured);
  });
  it('refuses another REST version', async () => {
    await expect(startChecks(new FakeRest({ ...OK, version: '1.14.0' }), { profileId: 'gmt-worker', socs: () => SOCS })).rejects.toThrow(/1\.13\.1/);
  });
  it.each(['default', 'ian', '', 'gmt-'])('refuses the profile id %j', async (id) => {
    await expect(startChecks(new FakeRest(OK), { profileId: id, socs: () => SOCS })).rejects.toThrow(/CAMOUFOX_PROFILE_ID/);
  });
  it('refuses a profile holding a Google account cookie', async () => {
    await expect(startChecks(new FakeRest({ ...OK, accountCookie: true }), { profileId: 'gmt-worker', socs: () => SOCS })).rejects.toThrow(/signed in/);
  });
  it('sets no cookie and opens no tab while checking', async () => {
    const r = new FakeRest(OK);
    await startChecks(r, { profileId: 'gmt-worker', socs: () => SOCS });
    expect(r.calls.map((c) => c.op)).toEqual(['version', 'openWithoutKey', 'accountCookie']);
  });
});
```

`test/session.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIata, asIsoDate, asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CooldownStore } from '../src/cooldown.js';
import { Pacer } from '../src/pacer.js';
import { PageSession } from '../src/session.js';
import type { Snapshot } from '../src/ax.js';
import { FakeRest } from './support/fakeRest.js';
import * as T from './support/trees.js';

const LIST = { mode: 'list' as const, origin: asIata('LHR'), destination: asIata('JFK'), gl: 'GB',
  departFrom: asIsoDate('2026-11-05'), departTo: asIsoDate('2026-11-05'), returnFrom: asIsoDate('2026-11-15'), returnTo: asIsoDate('2026-11-15') };
const clock = { now: () => asIsoDateTime('2026-10-18T05:00:00.000Z') };

const SOCS = { value: 'synthetic-socs-rejection-value', domain: '.google.com' as const, path: '/' as const, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') };

function session(...snaps: Snapshot[]) {
  const rest = new FakeRest({ version: '1.13.1', accountCookie: false, keyless: 'refused', snapshots: snaps });
  const cooldown = new CooldownStore({ dir: mkdtempSync(join(tmpdir(), 'ws-')), hours: 48, clock });
  const s = new PageSession({ rest, profileId: 'gmt-worker', socs: SOCS, pacer: new Pacer({ minSpacingSeconds: 30, nowMs: () => 0 }), cooldown, clock });
  return { s, rest, cooldown, opens: () => rest.calls.filter((c) => c.op === 'openTab').length };
}

describe('PageSession: the hard stop (spec §2)', () => {
  it('a CAPTCHA answers blocked, starts the cool-down, closes the tab, and the next request opens nothing', async () => {
    const h = session(T.captchaTree);
    expect(await h.s.page(LIST)).toEqual({ kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' });
    expect(h.rest.calls.at(-1)?.op).toBe('closeTab');
    const before = h.opens();
    expect(await h.s.page(LIST)).toEqual({ kind: 'cooling-down', cooldownUntil: '2026-10-20T05:00:00.000Z' });
    expect(h.opens()).toBe(before);
  });
  it.each([
    ['unusual traffic', T.sorryTree, 'unusual-traffic'],
    ['sign-in wall', T.signInTree, 'sign-in'],
    ['unrecognised page', T.blankTree, 'unrecognised'],
  ])('a %s stops at once, with no click', async (_n, snap, page) => {
    const h = session(snap);
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page });
    expect(h.rest.calls.some((c) => c.op === 'click')).toBe(false);
    expect(h.cooldown.activeUntil()).not.toBeNull();
  });
  it('a signed-in page stops, cools down, and the worker refuses every later page until restarted', async () => {
    const h = session(T.signedInTree());
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page: 'signed-in' });
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page: 'signed-in' });
    expect(h.opens()).toBe(1);
  });
  it('a challenge that appears after the Cheapest click still stops, and nothing else is clicked', async () => {
    const h = session(T.resultsTree(), T.captchaTree);
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page: 'captcha' });
    expect(h.rest.calls.filter((c) => c.op === 'click')).toHaveLength(1);
  });
  it('sets the SOCS rejection on the profile before the tab is opened', async () => {
    const t = T.resultsTree({ cheapestSelected: true, moreButton: false });
    const h = session(T.resultsTree(), t, t);
    await h.s.page(LIST);
    const ops = h.rest.calls.map((c) => c.op);
    expect(ops.indexOf('setConsentCookie')).toBeLessThan(ops.indexOf('openTab'));
    expect(h.rest.calls.find((c) => c.op === 'setConsentCookie')).toMatchObject({ profileId: 'gmt-worker', value: SOCS.value });
  });
  it('a consent page anyway: blocked consent-unhandled, nothing clicked, session discarded, cool-down started', async () => {
    const h = session(T.consentTree);
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page: 'consent-unhandled' });
    expect(h.rest.calls.some((c) => c.op === 'click')).toBe(false);
    expect(h.rest.calls.some((c) => c.op === 'discardSession')).toBe(true);
    expect(h.cooldown.activeUntil()).not.toBeNull();
  });
  it('SOCS changed after the page (an accept happened): consent-unhandled, and the cells are not answered', async () => {
    const t = T.resultsTree({ cheapestSelected: true, moreButton: false });
    const h = session(T.resultsTree(), t, t);
    h.rest.consentAfterPage = 'an-accept-value';
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page: 'consent-unhandled' });
    expect(h.rest.calls.some((c) => c.op === 'discardSession')).toBe(true);
  });
});

describe('PageSession: list mode (spec §2)', () => {
  it('clicks Cheapest then View more flights, then answers the minimum parsed price, its return date labelled as the query\'s', async () => {
    const before = T.resultsTree();
    const cheapest = T.resultsTree({ cheapestSelected: true });
    const expanded = T.resultsTree({ cheapestSelected: true, moreButton: false, top: [T.option(478), T.option(534)], other: [T.option(451), T.option(499)] });
    const h = session(before, cheapest, expanded);
    const a = await h.s.page(LIST);
    expect(a).toMatchObject({ kind: 'cells', currency: 'GBP', pointOfSale: 'GB', optionsDropped: 0,
      cells: [{ departureDate: '2026-11-05', returnDate: '2026-11-15', amountMinor: 45100 }] });
    expect(a).toMatchObject({ notes: expect.arrayContaining(['return-date-from-query']) });
    expect(h.rest.calls.filter((c) => c.op === 'click')).toHaveLength(2);
    expect(h.rest.calls.filter((c) => c.op === 'openTab').every((c) => c.profileId === 'gmt-worker')).toBe(true);
  });
  it('a Cheapest tab price below every parsed option is noted (the cell becomes partial upstream)', async () => {
    const t = T.resultsTree({ cheapestSelected: true, moreButton: false, cheapestTab: 'Cheapest from 399 British pounds', top: [T.option(478)], other: [] });
    const h = session(T.resultsTree(), t, t);
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'cells', notes: expect.arrayContaining(['cheapest-tab-below-parsed']) });
  });
  it('no parsed option at all: a priced page we cannot read is unrecognised, never "no fares"', async () => {
    const t = T.resultsTree({ cheapestSelected: true, moreButton: false, top: [T.n('listitem', '', [T.n('link', 'Reworded')])], other: [] });
    const h = session(T.resultsTree(), t, t);
    expect(await h.s.page(LIST)).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
  });
  it('grid mode is refused while the grid selectors are unverified, opening nothing', async () => {
    const h = session(T.resultsTree());
    expect(await h.s.page({ ...LIST, mode: 'grid', departTo: asIsoDate('2026-11-11'), returnTo: asIsoDate('2026-11-21') })).toEqual({ kind: 'mode-unavailable', mode: 'grid' });
    expect(h.opens()).toBe(0);
  });
  it('a second request inside the spacing opens nothing', async () => {
    const t = T.resultsTree({ cheapestSelected: true, moreButton: false });
    const h = session(T.resultsTree(), t, t);
    await h.s.page(LIST);
    const before = h.opens();
    expect(await h.s.page(LIST)).toEqual({ kind: 'spacing', retryAfterSeconds: 30 });
    expect(h.opens()).toBe(before);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/pacer.test.ts test/url.test.ts test/startChecks.test.ts test/session.test.ts`; FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/pacer.ts`:

```ts
/**
 * Concurrency 1 and a fixed minimum gap between page loads, end to start (spec §2, plan decision 68). why: the worker
 * enforces this itself, so the container and `pnpm dev` calling the same worker share one rate. Never randomised.
 */
export class Pacer {
  private busy = false;
  private lastEndMs: number | null = null;
  constructor(private readonly o: { minSpacingSeconds: number; nowMs: () => number }) {
    if (!Number.isInteger(o.minSpacingSeconds) || o.minSpacingSeconds < 30) throw new Error('CAMOUFOX_MIN_SPACING_SECONDS must be at least 30');
  }
  claim(): { ok: true } | { ok: false; retryAfterSeconds: number } {
    if (this.busy) return { ok: false, retryAfterSeconds: this.o.minSpacingSeconds };
    if (this.lastEndMs !== null) {
      const wait = this.lastEndMs + this.o.minSpacingSeconds * 1000 - this.o.nowMs();
      if (wait > 0) return { ok: false, retryAfterSeconds: Math.ceil(wait / 1000) };
    }
    this.busy = true;
    return { ok: true };
  }
  release(): void {
    this.busy = false;
    this.lastEndMs = this.o.nowMs();
  }
}
```

`src/url.ts`:

```ts
import { addDays } from '@gmt/core';
import type { PageRequest } from './protocol.js';

/** Brief §6: the feasibility load's URL form. List: the cell's dates; grid: the fourth day of each 7-day block. */
export function pageUrl(r: PageRequest): URL {
  const depart = r.mode === 'list' ? r.departFrom : addDays(r.departFrom, 3);
  const ret = r.mode === 'list' ? r.returnFrom : addDays(r.returnFrom, 3);
  const u = new URL('https://www.google.com/travel/flights');
  u.searchParams.set('q', `Flights from ${r.origin} to ${r.destination} on ${depart} returning ${ret}`);
  u.searchParams.set('curr', 'GBP');
  u.searchParams.set('hl', 'en-GB');
  u.searchParams.set('gl', r.gl);
  return u;
}
```

`src/session.ts`:

```ts
import type { Clock } from '@gmt/core';
import { find, type Snapshot } from './ax.js';
import { classifyPage } from './classify.js';
import type { SocsValue } from './consent.js';
import type { CooldownStore } from './cooldown.js';
import { GridUnreadable, readGrid } from './grid.js';
import { readList } from './list.js';
import type { Pacer } from './pacer.js';
import type { BlockedPage, PageRequest, WorkerAnswer } from './protocol.js';
import type { CamofoxRest } from './rest.js';
import { GRID_VERIFIED, SELECTORS as S, SELECTORS_VERSION } from './selectors.js';
import { pageUrl } from './url.js';

/**
 * One Google document load per call (spec §2): refusal and cool-down checks, pacer claim, the SOCS rejection set on the
 * dedicated profile, one tab, classification after every step, the SOCS value read back, then either the page's cells or
 * a stop. Nothing on a consent page is ever clicked. No retries.
 */
export class PageSession {
  private refusingSignedIn = false;
  constructor(private readonly o: { rest: CamofoxRest; profileId: string; socs: SocsValue; pacer: Pacer; cooldown: CooldownStore; clock: Clock }) {}

  async page(req: PageRequest): Promise<WorkerAnswer> {
    if (req.mode === 'grid' && !GRID_VERIFIED) return { kind: 'mode-unavailable', mode: 'grid' };
    const until = this.o.cooldown.activeUntil();
    if (this.refusingSignedIn) return { kind: 'blocked', page: 'signed-in', cooldownUntil: until ?? this.o.cooldown.start('signed-in') };
    if (until !== null) return { kind: 'cooling-down', cooldownUntil: until };
    const claim = this.o.pacer.claim();
    if (!claim.ok) return { kind: 'spacing', retryAfterSeconds: claim.retryAfterSeconds };
    let tabId: string | undefined;
    try {
      // why: camofox-browser accepts consent by itself after every navigation; the rejection must already be set.
      await this.o.rest.setConsentCookie(this.o.profileId, this.o.socs.value);
      tabId = (await this.o.rest.openTab(this.o.profileId, pageUrl(req).href)).tabId;
      let snap = await this.o.rest.snapshot(tabId);
      let kind = classifyPage(snap);
      if (kind.kind === 'blocked') return await this.stop(kind.page);
      // why: read Google's cheapest set, not its "Best" ranking (feasibility consequence 2).
      for (const target of req.mode === 'list' ? (['cheapest', 'more'] as const) : (['grid'] as const)) {
        const ref = this.refFor(snap, target);
        if (ref === null) continue;
        await this.o.rest.click(tabId, ref);
        snap = await this.o.rest.snapshot(tabId);
        kind = classifyPage(snap);
        if (kind.kind !== 'results') return await this.stop(kind.kind === 'blocked' ? kind.page : 'unrecognised');
      }
      // why: an accept may have happened without a consent page we could see; the cookie tells (spec §2).
      if ((await this.o.rest.consentCookie(this.o.profileId)) !== this.o.socs.value) return await this.stop('consent-unhandled');
      return req.mode === 'list' ? await this.listAnswer(snap, req) : await this.gridAnswer(snap, req);
    } finally {
      if (tabId !== undefined) await this.o.rest.closeTab(tabId);
      this.o.pacer.release();
    }
  }

  private refFor(s: Snapshot, target: 'cheapest' | 'more' | 'grid'): string | null {
    if (target === 'cheapest') {
      const tab = find(s.tree, 'tab', S.results.cheapestTab)[0];
      return tab?.selected === true ? null : (tab?.ref ?? null);
    }
    const name = target === 'more' ? S.results.moreButton : S.results.dateGridButton;
    return find(s.tree, 'button', name)[0]?.ref ?? null;
  }

  private async listAnswer(s: Snapshot, req: PageRequest): Promise<WorkerAnswer> {
    const r = readList(s, req);
    if (r.currency !== 'GBP' || r.options.length === 0) return this.stop('unrecognised');
    const min = Math.min(...r.options.map((o) => o.amountMinor));
    // why: a result's name states the departure only; the return date is the worker's own query (operator ruling 5).
    const notes = ['return-date-from-query', ...(r.cheapestTabMinor !== null && r.cheapestTabMinor < min ? ['cheapest-tab-below-parsed'] : [])];
    return {
      kind: 'cells', fetchedAt: this.o.clock.now(), currency: 'GBP', pointOfSale: r.pointOfSale,
      cells: [{ departureDate: req.departFrom, returnDate: req.returnFrom, amountMinor: min }],
      dropped: [], optionsDropped: r.optionsDropped, notes, selectorsVersion: SELECTORS_VERSION,
    };
  }

  private async gridAnswer(s: Snapshot, req: PageRequest): Promise<WorkerAnswer> {
    try {
      const g = readGrid(s, req);
      return { kind: 'cells', fetchedAt: this.o.clock.now(), ...g, optionsDropped: 0, notes: [], selectorsVersion: SELECTORS_VERSION };
    } catch (e) {
      if (e instanceof GridUnreadable) return this.stop('unrecognised');
      throw e;
    }
  }

  private async stop(page: BlockedPage): Promise<WorkerAnswer> {
    if (page === 'signed-in') this.refusingSignedIn = true;
    // why: a session that saw consent (or an accept) is never reused; its cookies go with it.
    if (page === 'consent-unhandled') await this.o.rest.discardSession(this.o.profileId);
    return { kind: 'blocked', page, cooldownUntil: this.o.cooldown.start(page) };
  }
}
```

(A list page whose cell has a price but whose options all fail the grammar is a stop, not an empty cell: a page the
worker cannot read is never "no fares". A list page that Google itself states has no flights is a later refinement once
a recording shows that page; until then it too reads as unrecognised and stops, which errs toward stopping.)

`src/startChecks.ts`: the checks of the rules above, in order (version, keyless request refused, profile id, no
account cookie, `socs()` loads), each failing with an `Error` naming the variable or the
version.

- [ ] **Step 4: Run** — PASS (4 + 3 + 9 + 12 tests); then the source test of Task 14.4 passes too.

- [ ] **Step 5: Commit** — `git commit -am "wp14: one-page session with fixed spacing, dedicated profile, SOCS rejection and hard stop"`

### Task 14.6: The worker HTTP server and its entry point

**Files:** create `src/server.ts`, `src/config.ts`, `src/main.ts`, `test/server.test.ts`.

**Interfaces:** `createWorkerServer({ token, session, status }): http.Server`; `loadWorkerConfig(env)`.

Answers: 401 (bad or missing token, constant-time compare, no detail); 400 (`PageRequest` invalid: `iataSchema`,
`isoDateSchema`, `mode` `list` with both ranges one day or `grid` with each block exactly 7 days, `gl` `^[A-Z]{2}$`);
409 `mode-unavailable` for `grid` while the grid selectors are unverified; 200 for `cells`; 423
for `blocked` and `cooling-down`; 429 with `Retry-After` for `spacing`; 404 otherwise. `GET /v1/status` never touches
Google and reports `{ ok, coolingDownUntil, lastPageAt, selectorsVersion, profileId, accountCookie,
accessKeyEnforced, socsCapturedAt }`. Logs are one JSON line per request with the answer kind, never the token. `main.ts` reads
`CAMOUFOX_WORKER_TOKEN`, `CAMOUFOX_WORKER_BIND` (refusing `0.0.0.0` and `::`), `CAMOUFOX_WORKER_PORT` (8090),
`CAMOFOX_REST_URL` (loopback only), `CAMOFOX_ACCESS_KEY` (required, sent on every REST request, never logged),
`CAMOUFOX_PROFILE_ID`, `CAMOUFOX_MIN_SPACING_SECONDS`, `CAMOUFOX_COOLDOWN_HOURS`,
`CAMOUFOX_PAGE_TIMEOUT_SECONDS` and `CAMOUFOX_STATE_DIR` (default `~/.local/state/get-me-there/camoufox`, created 0700)
once, runs `startChecks` (Task 14.5) with `socs: () => loadSocs(stateDir, clock)`, and listens.

- [ ] **Step 1: Write the failing test**

```ts
import type { AddressInfo } from 'node:net';
import { asIsoDateTime } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerServer } from '../src/server.js';
import type { PageRequest, WorkerAnswer } from '../src/protocol.js';

const TOKEN = 'test-camoufox-worker-token-0123456789abcdef';
const BODY = { mode: 'grid', origin: 'LHR', destination: 'JFK', gl: 'GB', departFrom: '2027-03-11', departTo: '2027-03-17', returnFrom: '2027-03-21', returnTo: '2027-03-27' };
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; });

async function serve(answer: WorkerAnswer) {
  const seen: PageRequest[] = [];
  const server = createWorkerServer({
    token: TOKEN,
    session: { page: async (r) => { seen.push(r); return answer; } },
    status: () => ({ ok: true, coolingDownUntil: null, lastPageAt: null, selectorsVersion: 'v', profileId: 'gmt-worker', accountCookie: false, accessKeyEnforced: true, socsCapturedAt: '2026-10-18T04:00:00.000Z' }),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  stop = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen };
}
const post = (base: string, body: unknown, token = TOKEN) =>
  fetch(`${base}/v1/page`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gmt-worker-token': token }, body: JSON.stringify(body) });

describe('worker server (brief §6)', () => {
  it('401 without the token, and the session is not called', async () => {
    const h = await serve({ kind: 'cooling-down', cooldownUntil: asIsoDateTime('2026-10-20T05:00:00.000Z') });
    expect((await post(h.base, BODY, 'wrong-token-wrong-token-wrong-token')).status).toBe(401);
    expect(h.seen).toEqual([]);
  });
  it('409 for grid mode while the grid selectors are unverified', async () => {
    const h = await serve({ kind: 'mode-unavailable', mode: 'grid' });
    expect((await post(h.base, BODY)).status).toBe(409);
  });
  it('400 for a grid block that is not 7 days', async () => {
    const h = await serve({ kind: 'cooling-down', cooldownUntil: asIsoDateTime('2026-10-20T05:00:00.000Z') });
    expect((await post(h.base, { ...BODY, departTo: '2027-03-18' })).status).toBe(400);
    expect(h.seen).toEqual([]);
  });
  it('423 for blocked and for cooling-down', async () => {
    const a = await serve({ kind: 'blocked', page: 'captcha', cooldownUntil: asIsoDateTime('2026-10-20T05:00:00.000Z') });
    const r = await post(a.base, BODY);
    expect(r.status).toBe(423);
    expect(await r.json()).toEqual({ kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' });
  });
  it('429 with Retry-After for spacing', async () => {
    const a = await serve({ kind: 'spacing', retryAfterSeconds: 17 });
    const r = await post(a.base, BODY);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('17');
  });
  it('GET /v1/status answers without calling the session', async () => {
    const a = await serve({ kind: 'spacing', retryAfterSeconds: 1 });
    const r = await fetch(`${a.base}/v1/status`, { headers: { 'x-gmt-worker-token': TOKEN } });
    expect(await r.json()).toMatchObject({ ok: true, coolingDownUntil: null });
    expect(a.seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/server.test.ts`; FAIL, module not found.

- [ ] **Step 3: Implement** `src/server.ts` with `node:http`: read at most 4 KiB of body; `timingSafeEqual` over
equal-length buffers (a length mismatch is 401); validate with a zod object built from core's `iataSchema` and
`isoDateSchema` plus a `refine` on the block lengths per mode; map the answer kind to the status table above; set
`retry-after` for `spacing`. `src/main.ts` wires `PageSession`, `Pacer` (`nowMs: Date.now`), `CooldownStore` (`dir:
stateDir`) and `restClient(CAMOFOX_REST_URL)`, and on SIGTERM closes the server, then any tab the session holds.
`src/config.ts` parses the variables with the bounds of spec §12 and fails start naming the variable.

- [ ] **Step 4: Run to verify it passes** — PASS, 6 tests; then `pnpm --filter @gmt/camoufox-worker test` (all worker
tests) PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: worker HTTP server, token check and status route"`

### Task 14.7: Core widening, labels and the camoufox config block

**Files:** modify `packages/core/src/types/provenance.ts`, `errors.ts`, `labels/source.ts`, `config/schema.ts`,
`config/presets.ts`; tests beside each.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/types/provenance.camoufox.test.ts
import { describe, expect, it } from 'vitest';
import { providerIdSchema, sourceKindSchema } from '../../src/types/provenance.js';
import { SOURCE_LABELS } from '../../src/labels/source.js';
import { BANNED_WORDS, findBannedWords } from '../../src/text/bannedWords.js';

describe('camoufox provider in core (spec §5.1 rev 32)', () => {
  it('accepts the new ids', () => {
    expect(providerIdSchema.parse('camoufox')).toBe('camoufox');
    expect(sourceKindSchema.parse('scraped-self')).toBe('scraped-self');
    expect(() => providerIdSchema.parse('camoufox')).toThrow();
  });
  it('labels the source in the §11 words, with no banned word', () => {
    expect(SOURCE_LABELS['scraped-self']).toBe('Google Flights prices via Camoufox');
    expect(findBannedWords(SOURCE_LABELS['scraped-self'])).toEqual([]);
    expect(BANNED_WORDS.length).toBeGreaterThan(0);
  });
});
```

```ts
// packages/core/test/config/camoufox.test.ts
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/schema.js';
import { baseEnv } from './helpers.js';

const ON = { CAMOUFOX_ENABLED: 'true', CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090', CAMOUFOX_WORKER_TOKEN: 'test-camoufox-worker-token-0123456789abcdef' };

describe('CAMOUFOX_* (spec §12 rev 32)', () => {
  it('off by default: no camoufox provider', () => {
    expect(parseConfig(baseEnv()).providers.camoufox).toBeNull();
  });
  it('on with defaults: spacing 30, page cap 100, month 1500, cool-down 48, concurrency 1, cost 0, rate 2/min', () => {
    const b = parseConfig({ ...baseEnv(), ...ON }).providers.camoufox;
    expect(b).toMatchObject({ mode: 'list', minSpacingSeconds: 30, executionPageCap: 100, cooldownHours: 48, pageTimeoutSeconds: 45 });
    expect(b?.workerUrl.href).toBe('http://127.0.0.1:8090/');
    expect(b?.limits).toMatchObject({ monthlyCallCap: 1500, ratePerMinute: 2, ratePerHour: 120, concurrency: 1, costPerCallMicroGbp: 0, cacheTtlHours: 0, window: 'month' });
  });
  it.each([
    ['CAMOUFOX_MIN_SPACING_SECONDS', '29'],
    ['CAMOUFOX_EXECUTION_PAGE_CAP', '401'],
    ['CAMOUFOX_EXECUTION_PAGE_CAP', '0'],
    ['CAMOUFOX_COOLDOWN_HOURS', '23'],
    ['CAMOUFOX_WORKER_TOKEN', 'short'],
    ['CAMOUFOX_WORKER_URL', 'http://192.168.1.10:8090'],
    ['CAMOUFOX_WORKER_URL', 'http://127.0.0.1:8090/path'],
    ['CAMOUFOX_MODE', 'both'],
  ])('%s=%s fails boot naming the field', (name, value) => {
    expect(() => parseConfig({ ...baseEnv(), ...ON, [name]: value })).toThrow(new RegExp(name));
  });
  it('http is accepted for host.docker.internal and loopback only; https anywhere', () => {
    for (const u of ['http://host.docker.internal:8090', 'http://localhost:8090', 'http://[::1]:8090', 'https://worker.example.test'])
      expect(parseConfig({ ...baseEnv(), ...ON, CAMOUFOX_WORKER_URL: u }).providers.camoufox?.workerUrl.origin).toBe(new URL(u).origin);
  });
  it('enabled without a token fails boot', () => {
    expect(() => parseConfig({ ...baseEnv(), CAMOUFOX_ENABLED: 'true' })).toThrow(/CAMOUFOX_WORKER_TOKEN/);
  });
  it('a 45 s spacing gives 1.33/min, floored to whole calls and never above the spacing', () => {
    const b = parseConfig({ ...baseEnv(), ...ON, CAMOUFOX_MIN_SPACING_SECONDS: '45' }).providers.camoufox;
    expect(b?.limits.ratePerMinute).toBe(1);
    expect(b?.limits.ratePerHour).toBe(80);
  });
});
```

(`parseConfig` and `baseEnv` are core's existing config entry and test helper; if their names differ on main, use
the names `config/schema.test.ts` uses.)

- [ ] **Step 2: Run** — `pnpm --filter @gmt/core exec vitest run test/types/provenance.camoufox.test.ts test/config/camoufox.test.ts`; FAIL on `'camoufox'` and `providers.camoufox`.

- [ ] **Step 3: Implement.** Widen the two unions and both zod enums; add `'blocked'` to `ProviderErrorKind` and
`'provider-execution'` to `BudgetScopeKind` (and to every exhaustive switch the typecheck then names, each with a
`// why:` line); add the label; add the config block, deriving `ratePerMinute = max(1, floor(60 / spacing))` and
`ratePerHour = floor(3600 / spacing)`; add `camoufox` to `collectSecrets`'s input shape. Core's 100% thresholds hold.

- [ ] **Step 4: Run** — `pnpm --filter @gmt/core test`; PASS with core's thresholds; `pnpm -r typecheck` names every
consumer that must handle the new members, each fixed in this task with a test where it has behaviour.

- [ ] **Step 5: Commit** — `git commit -am "wp14: core gains camoufox, scraped-self, blocked and provider-execution"`

### Task 14.8: db: migration 0005 and the provider-execution cap

**Files:** create `packages/db/drizzle/0005_camoufox_provider.sql`; modify `src/internal/enums.ts`, the budget guard;
tests `test/migrations/0005.test.ts`, `test/budget/providerExecution.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/migrations/0005.test.ts
import { describe, expect, it } from 'vitest';
import { migratedMemoryDb } from '../helpers/db.js';

describe('migration 0005 (spec §5.1 rev 32)', () => {
  it('accepts camoufox / scraped-self rows in every table that names a provider or a source kind', () => {
    const db = migratedMemoryDb();
    db.prepare("INSERT INTO provider_requests (id, provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt) VALUES ('r1','camoufox','/v1/page','2026-10-18T05:00:00.000Z','ok',0,0,1)").run();
    expect(db.prepare("SELECT provider_id FROM provider_requests WHERE id='r1'").get()).toEqual({ provider_id: 'camoufox' });
  });
  it('still refuses an unknown provider', () => {
    const db = migratedMemoryDb();
    expect(() => db.prepare("INSERT INTO provider_requests (id, provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt) VALUES ('r2','camoufox','/x','2026-10-18T05:00:00.000Z','ok',0,0,1)").run()).toThrow(/CHECK/);
  });
  it('keeps every row of a database migrated to 0004', () => {
    const { before, after } = migratedFrom0004WithRows();
    expect(after).toEqual(before);
  });
});
```

```ts
// test/budget/providerExecution.test.ts
import { describe, expect, it } from 'vitest';
import { BudgetExceeded } from '@gmt/core';
import { guardWith } from '../helpers/budget.js';

describe('provider-execution cap (spec §5.1, §8.1 rev 32)', () => {
  it('the 101st camoufox page in one execution is refused before the fetch', () => {
    const g = guardWith({ camoufox: { executionCallCap: 100 } });
    for (let i = 0; i < 100; i++) g.reserve({ providerId: 'camoufox', executionId: 'e1', tileIndex: i, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/v1/page' }).finalise({ outcome: 'ok', durationMs: 1 });
    expect(() => g.reserve({ providerId: 'camoufox', executionId: 'e1', tileIndex: 100, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/v1/page' }))
      .toThrow(expect.objectContaining({ scope: 'provider-execution' }));
  });
  it('another execution and another provider are unaffected; cache hits do not count', () => {
    const g = guardWith({ camoufox: { executionCallCap: 1 } });
    g.reserve({ providerId: 'camoufox', executionId: 'e1', tileIndex: 0, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/v1/page' }).finalise({ outcome: 'ok', durationMs: 1 });
    g.recordCacheHit({ providerId: 'camoufox', executionId: 'e2', tileIndex: 0, endpointPath: '/v1/page' });
    expect(() => g.reserve({ providerId: 'camoufox', executionId: 'e2', tileIndex: 1, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/v1/page' })).not.toThrow();
    expect(() => g.reserve({ providerId: 'travelpayouts', executionId: 'e1', tileIndex: 0, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/x' })).not.toThrow();
  });
  it('camoufox rows are never billable and count under the free-provider month rule', () => {
    const g = guardWith({ camoufox: { executionCallCap: 10 } });
    g.reserve({ providerId: 'camoufox', executionId: 'e1', tileIndex: 0, costMicroGbp: 0, httpAttempt: 1, endpointPath: '/v1/page' }).finalise({ outcome: 'error', httpStatus: 423, durationMs: 1 });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' })).toMatchObject({ calls: 1, costMicroGbp: 0 });
    expect(g.billableRows('camoufox')).toBe(0);
  });
});
```

(`migratedFrom0004WithRows`, `guardWith` and `billableRows` are new helpers in `test/helpers/`; write them over the
existing `migratedMemoryDb` and guard factory in the same commit.)

- [ ] **Step 2: Run** — `pnpm --filter @gmt/db exec vitest run test/migrations/0005.test.ts test/budget/providerExecution.test.ts`; FAIL (CHECK constraint, missing scope).

- [ ] **Step 3: Implement.** SQLite cannot alter a CHECK, so 0005 rebuilds each table that carries one
(`calendar_prices`, `cell_outcomes`, `fare_offers`, `price_observations`, `provider_requests`, `route_price_history`)
with Drizzle's generated `__new_<table>` / copy / drop / rename sequence inside one transaction, `PRAGMA foreign_keys`
off around it and `PRAGMA foreign_key_check` after; the pre-migration backup (spec §13) covers it. `ProviderLimits`
gains `executionCallCap?: number`; `reserve` checks it with the same row rule as `execution-free-calls`, scoped to
the provider.

- [ ] **Step 4: Run** — `pnpm --filter @gmt/db test`; PASS with thresholds.

- [ ] **Step 5: Commit** — `git commit -am "wp14: db migration 0005 and the provider-execution cap"`

### Task 14.9: The adapter: tiling, fetchTile through http-kit, the answer mapping

**Files:** create `packages/providers/src/camoufox/{index.ts,provider.ts,tiles.ts,answer.ts,limits.ts}`, tests
`test/camoufox/{tiles.test.ts,fetchTile.test.ts,limits.test.ts,egress.test.ts}`; modify `src/http/egress.ts`,
`src/http/httpKit.ts`, `test/fakes.ts` (`testLimits.camoufox`: hosts `['127.0.0.1']`, `workerPort: 8090`, `workerScheme: 'http:'`, billable `never`, cost 0,
`ratePerMinute: 600`).

- [ ] **Step 1: Write the failing tests**

`test/camoufox/tiles.test.ts`:

```ts
import { asIata, asIsoDate, cellKeyString, generateCells } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { planDateGrid, planSingleCells } from '../../src/camoufox/tiles.js';

const Q = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2027-01-04'), departureTo: asIsoDate('2027-07-04'),
  minNights: 10, maxNights: 21, cabin: 'economy' as const, currency: 'GBP' as const };

describe('planDateGrid (spec §2, §5.2 rev 32)', () => {
  it('the worked example pair is 26 × 3 = 78 tiles', () => {
    expect(planDateGrid(Q)).toHaveLength(78);
  });
  it('every tile is a 7 × 7 rectangle', () => {
    for (const t of planDateGrid(Q)) {
      expect(t.request.kind).toBe('rectangle');
      if (t.request.kind !== 'rectangle') continue;
      expect([t.request.departFrom, t.request.departTo, t.request.returnFrom, t.request.returnTo].every(Boolean)).toBe(true);
      expect(Date.parse(t.request.departTo) - Date.parse(t.request.departFrom)).toBe(6 * 86_400_000);
      expect(Date.parse(t.request.returnTo) - Date.parse(t.request.returnFrom)).toBe(6 * 86_400_000);
    }
  });
  it('tiles partition the cells: each cell exactly once, none outside', () => {
    const all = generateCells(Q).map(cellKeyString).sort();
    const covered = planDateGrid(Q).flatMap((t) => t.coveredCells.map(cellKeyString)).sort();
    expect(covered).toEqual(all);
  });
  it('re-plans over a subset and drops tiles with no remaining cells', () => {
    const subset = generateCells(Q).slice(0, 5);
    const plan = planDateGrid({ ...Q, cells: subset });
    expect(plan.flatMap((t) => t.coveredCells)).toHaveLength(5);
    expect(plan.length).toBeLessThanOrEqual(2);
  });
  it('is deterministic', () => {
    expect(planDateGrid(Q)).toEqual(planDateGrid(Q));
  });
  it('a fixed 14-night stay needs one return block per departure block', () => {
    expect(planDateGrid({ ...Q, minNights: 14, maxNights: 14 })).toHaveLength(26);
  });
});

describe('planSingleCells (list mode, spec §2 rev 32)', () => {
  it('one 1 × 1 rectangle per cell, in cell order, partitioning the cells', () => {
    const cells = generateCells(Q);
    const plan = planSingleCells(Q);
    expect(plan).toHaveLength(cells.length);
    for (const [i, t] of plan.entries()) {
      expect(t.coveredCells).toEqual([cells[i]]);
      expect(t.request).toEqual({ kind: 'rectangle', departFrom: cells[i]?.departureDate, departTo: cells[i]?.departureDate, returnFrom: cells[i]?.returnDate, returnTo: cells[i]?.returnDate });
    }
  });
  it('re-plans over a subset', () => {
    expect(planSingleCells({ ...Q, cells: generateCells(Q).slice(0, 3) })).toHaveLength(3);
  });
});
```

`test/camoufox/fetchTile.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { camoufoxProvider, planDateGrid } from '../../src/camoufox/index.js';
import { makeKit, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';

const URL_ = 'http://127.0.0.1:8090/v1/page';
const Q = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2027-03-11'), departureTo: asIsoDate('2027-03-17'),
  minNights: 10, maxNights: 16, cabin: 'economy' as const, currency: 'GBP' as const };
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };

function provider(mode: 'grid' | 'list' = 'grid') {
  const { kit, budget, log, clock, events } = makeKit();
  return { p: camoufoxProvider({ http: kit, log, clock, token: SENTINELS.camoufox, workerUrl: new URL('http://127.0.0.1:8090'), mode, pointOfSale: 'GB' }), budget, events };
}
afterEach(() => server.resetHandlers());

describe('camoufox fetchTile (spec §2, §5.2)', () => {
  it('maps a grid answer to raw calendar prices, keys from the answer, null prices to noFares', async () => {
    const { p } = provider();
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const cell = tile.coveredCells[0];
    if (cell === undefined) throw new Error('no cell');
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'cells', fetchedAt: '2026-10-18T05:00:00.000Z', currency: 'GBP', pointOfSale: 'GB', selectorsVersion: 'v',
      cells: tile.coveredCells.map((c, i) => ({ departureDate: c.departureDate, returnDate: c.returnDate, amountMinor: i === 1 ? null : 41200 })), dropped: [], optionsDropped: 0, notes: [] })));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    expect(r?.kind).toBe('tile');
    if (r?.kind !== 'tile') return;
    expect(r.prices[0]).toMatchObject({ ...cell, amountMinor: 41200, currency: 'GBP' });
    expect(r.noFares).toHaveLength(1);
    expect(r.pointOfSale).toBe('GB');
    expect(r.cellIssues ?? []).toEqual([]);
  });
  it('a dropped grid cell and an unread covered cell become cellIssues (never no_data), and the tile is partial', async () => {
    const { p } = provider();
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const [first, second, ...rest] = tile.coveredCells;
    if (first === undefined || second === undefined) throw new Error('cells');
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'cells', fetchedAt: '2026-10-18T05:00:00.000Z', currency: 'GBP', pointOfSale: 'GB', selectorsVersion: 'v',
      cells: rest.map((c) => ({ departureDate: c.departureDate, returnDate: c.returnDate, amountMinor: 50000 })),
      dropped: [{ departureDate: first.departureDate, returnDate: first.returnDate, detail: 'unreadable-cell' }], optionsDropped: 0, notes: [] })));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.cellIssues).toEqual([
      { cell: first, reason: 'parse', offersDropped: 1, detail: 'unreadable-cell' },
      { cell: second, reason: 'parse', offersDropped: 0, detail: 'not-in-grid' },
    ]);
    expect(r.notes).toContain('partial-grid');
  });
  it('a blocked answer is tile-error kind blocked, not retried, one ledger row', async () => {
    const { p, budget } = provider();
    let hits = 0;
    server.use(http.post(URL_, () => { hits++; return HttpResponse.json({ kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' }, { status: 423 }); }));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'blocked', retryable: false } });
    expect(r?.kind === 'tile-error' ? r.error.message : '').toMatch(/captcha.*2026-10-20T05:00:00.000Z/);
    expect(hits).toBe(1);
    expect(budget.rows('camoufox')).toHaveLength(1);
  });
  it('cooling-down is blocked too, and its message names the end', async () => {
    const { p } = provider();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'cooling-down', cooldownUntil: '2026-10-20T05:00:00.000Z' }, { status: 423 })));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'blocked' } });
    expect(r?.kind === 'tile-error' ? r.error.message : '').toMatch(/cooling down until 2026-10-20T05:00:00.000Z/);
  });
  it('a consent-unhandled block is tile-error kind blocked, its page kind in the message, one ledger row', async () => {
    const { p, budget } = provider();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'blocked', page: 'consent-unhandled', cooldownUntil: '2026-10-20T05:00:00.000Z' }, { status: 423 })));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'blocked', retryable: false } });
    expect(r?.kind === 'tile-error' ? r.error.message : '').toMatch(/consent-unhandled/);
    expect(budget.rows('camoufox')).toHaveLength(1);
  });
  it('a consent-rejected answer does not exist: an unknown answer kind is a parse error', async () => {
    const { p } = provider();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'consent-rejected', fetchedAt: '2026-10-18T05:00:00.000Z', selectorsVersion: 'v' })));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'parse' } });
  });
  it('a non-GBP grid is a parse error (currency read from the answer)', async () => {
    const { p } = provider();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'cells', fetchedAt: '2026-10-18T05:00:00.000Z', currency: 'USD', pointOfSale: 'unknown', selectorsVersion: 'v', cells: [], dropped: [], optionsDropped: 0, notes: [] })));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'parse' } });
  });
  it('a cell outside the tile is dropped and counted, never priced', async () => {
    const { p } = provider();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'cells', fetchedAt: '2026-10-18T05:00:00.000Z', currency: 'GBP', pointOfSale: 'GB', selectorsVersion: 'v',
      cells: [{ departureDate: '2027-05-01', returnDate: '2027-05-11', amountMinor: 100 }], dropped: [], optionsDropped: 0, notes: [] })));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.prices).toEqual([]);
    expect(r.notes).toContain('out-of-tile=1');
  });
  it('the worker token travels in a header and never in the URL or a log line', async () => {
    const { p, events } = provider();
    server.use(http.post(URL_, () => HttpResponse.json({ kind: 'cooling-down', cooldownUntil: '2026-10-20T05:00:00.000Z' }, { status: 423 })));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    await p.discovery?.fetchTile(tile, Q, ctx);
    const fetch = events.find((e) => e.type === 'fetch');
    expect(fetch && 'headers' in fetch ? fetch.headers['x-gmt-worker-token'] : undefined).toBe(SENTINELS.camoufox.reveal());
    expect(fetch && 'url' in fetch ? fetch.url : '').not.toContain(SENTINELS.camoufox.reveal());
  });
  it('list mode plans one cell per tile and sends mode list; unparsed options become offersDropped on the cell', async () => {
    const { p } = provider('list');
    const tile = p.discovery?.plan(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    const cell = tile.coveredCells[0];
    if (cell === undefined) throw new Error('no cell');
    let sent: unknown;
    server.use(http.post(URL_, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ kind: 'cells', fetchedAt: '2026-10-18T05:00:00.000Z', currency: 'GBP', pointOfSale: 'GB', selectorsVersion: 'v',
      cells: [{ ...cell, amountMinor: 45100 }], dropped: [], optionsDropped: 2, notes: [] }); }));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    expect(sent).toMatchObject({ mode: 'list', departFrom: cell.departureDate, departTo: cell.departureDate, returnFrom: cell.returnDate, returnTo: cell.returnDate, gl: 'GB' });
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.prices).toHaveLength(1);
    expect(r.cellIssues).toEqual([{ cell, reason: 'parse', offersDropped: 2, detail: 'options-unparsed' }]);
  });
  it('a 409 mode-unavailable (grid selectors unverified) is a parse tile-error, never retried', async () => {
    const { p } = provider('grid');
    let hits = 0;
    server.use(http.post(URL_, () => { hits++; return HttpResponse.json({ kind: 'mode-unavailable', mode: 'grid' }, { status: 409 }); }));
    const tile = planDateGrid(Q)[0];
    if (tile === undefined) throw new Error('no tile');
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', retryable: false } });
    expect(hits).toBe(1);
  });
  it('declares discovery only, scraped-self, maxAgeHours 0, every cabin refused but economy', () => {
    const { p } = provider();
    expect(p.verification).toBeUndefined();
    expect(p.discovery?.info).toMatchObject({ sourceKind: 'scraped-self', maxAgeHours: 0 });
    expect(p.cabins).toEqual(['economy']);
  });
});
```

`test/camoufox/egress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertEgress } from '../../src/http/egress.js';
import { ALL_SECRETS, req, testLimits } from '../fakes.js';

describe('egress exception for the camoufox worker (spec §5.3 rev 32)', () => {
  const L = testLimits().camoufox;
  it('allows exactly CAMOUFOX_WORKER_URL for providerId camoufox', () => {
    expect(() => assertEgress(req({ providerId: 'camoufox', url: 'http://127.0.0.1:8090/v1/page', headers: {} }), L, ALL_SECRETS)).not.toThrow();
  });
  it.each([
    ['the camofox-browser REST port', 'http://127.0.0.1:9377/tabs'],
    ['another host', 'http://192.168.1.10:8090/v1/page'],
    ['https on the worker host', 'https://127.0.0.1:8090/v1/page'],
    ['google directly', 'https://www.google.com/travel/flights'],
  ])('refuses %s', (_n, url) => {
    expect(() => assertEgress(req({ providerId: 'camoufox', url, headers: {} }), L, ALL_SECRETS)).toThrow(/egress denied/);
  });
  it('no other provider may use plain http or a port', () => {
    expect(() => assertEgress(req({ providerId: 'searchapi', url: 'http://127.0.0.1:8090/v1/page' }), testLimits().searchapi, ALL_SECRETS)).toThrow(/egress denied/);
  });
});
```

(The first refusal is the point: the app may reach the worker, never the camofox-browser REST server itself.)

`test/camoufox/limits.test.ts`: `camoufoxHttpLimits` has hosts `[workerUrl.hostname]`, `workerPort` and `workerScheme` from `workerUrl`, `billable: 'never'`, cost 0, concurrency
1, `ratePerMinute` and `ratePerHour` from config, `executionCallCap` = `executionPageCap`, `requestTimeoutSeconds` =
`pageTimeoutSeconds + 15`; its classifier maps 423 to `blocked` (non-retryable, message `camoufox /v1/page:
blocked (<page>), cooling down until <iso>` or `cooling down until <iso>`), 401 to `auth`, 400 to `parse`, every 5xx to
`upstream` **non-retryable** (a retry would be a second Google page load), and leaves 429 to http-kit's default table
so `Retry-After` is honoured. Write each mapping as one `it` with a `ResponseFacts` literal.

- [ ] **Step 2: Run** — `pnpm --filter @gmt/providers exec vitest run test/camoufox`; FAIL, modules not found.

- [ ] **Step 3: Implement.**

`tiles.ts`:

```ts
import { addDays, type CellKey, cellKeyString, type DiscoveryQuery, generateCells, type IsoDate, type TilePlan } from '@gmt/core';

/** Google's date grid: the selected dates ± 3 days on each axis (spec §2). */
export const GRID_DAYS = 7;

/**
 * Pure, deterministic 7 × 7 rectangle tiling (spec §5.2 rev 32): departure blocks of 7 days from the window start
 * and, per block, return blocks of 7 days from blockStart + minNights, so a pair needs
 * ⌈D / 7⌉ × ⌈(7 + maxNights − minNights) / 7⌉ tiles. Tiles partition the query's cells; with `cells` set the plan
 * covers only those and drops empty tiles.
 */
export function planDateGrid(q: DiscoveryQuery): TilePlan[] {
  const cells = q.cells ?? generateCells(q);
  const wanted = new Set(cells.map(cellKeyString));
  const span = GRID_DAYS + q.maxNights - q.minNights;
  const plans: TilePlan[] = [];
  for (let d0: IsoDate = q.departureFrom; d0 <= q.departureTo; d0 = addDays(d0, GRID_DAYS)) {
    for (let k = 0; k * GRID_DAYS < span; k++) {
      const departFrom = d0;
      const departTo = addDays(d0, GRID_DAYS - 1);
      const returnFrom = addDays(d0, q.minNights + k * GRID_DAYS);
      const returnTo = addDays(returnFrom, GRID_DAYS - 1);
      const covered: CellKey[] = cells.filter((c) => c.departureDate >= departFrom && c.departureDate <= departTo && c.returnDate >= returnFrom && c.returnDate <= returnTo);
      if (covered.length === 0) continue;
      plans.push({ index: plans.length, coveredCells: covered, request: { kind: 'rectangle', departFrom, departTo, returnFrom, returnTo } });
    }
  }
  // why: asserted, not assumed (spec §5.2: tiles partition the query's cells).
  const seen = plans.flatMap((p) => p.coveredCells.map(cellKeyString));
  if (seen.length !== wanted.size || new Set(seen).size !== wanted.size) throw new Error('planDateGrid: tiles do not partition the cells');
  return plans;
}
```

`answer.ts`: a zod schema for `WorkerAnswer` (the adapter's own copy; the providers package may not import the
worker) and `toTileResult(plan, answer, q)`, which keys prices from the answer's cells, drops and counts cells outside
`coveredCells` (`out-of-tile=n`), sends `amountMinor: null` cells to `noFares`, makes one `CellIssue` per dropped
cell (`reason: 'parse'`, `offersDropped: 1`, its `detail`) and one per covered cell the answer did not mention
(`offersDropped: 0`, `detail: 'not-in-grid'`), adds the note `partial-grid` when any issue exists, adds the worker's
`selectorsVersion` as a note, refuses a currency other than `GBP` with `parseError`, and returns `pointOfSale` from the
answer (`'GB'` or `'unknown'`).

`provider.ts`:

```ts
export const CAMOUFOX_DISPLAY_NAME = 'Google Flights via Camoufox';
export const CAMOUFOX_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-self',
  maxAgeHours: 0,
  provenanceNote:
    "Google Flights prices via Camoufox: the cheapest round-trip prices Google Flights showed this app's own Camoufox browser on the operator's machine when the page was read (the cheapest results in list mode, the date grid in grid mode), from the operator's IP address, in the currency the page states; in list mode the return date is the date the worker asked for, not one the page showed. Camoufox presents a generated browser fingerprint; Google's terms do not permit this automated access; the operator turned it on. Constraints are not checked; no return leg, seller or baggage is read.",
};
```

`camoufoxProvider` returns `{ id: 'camoufox', displayName, suppliedFields: [], cabins: ['economy'], discovery: { info,
plan: mode === 'grid' ? planDateGrid : planSingleCells, fetchTile }, healthcheck }` with no `verification`. `cabins: ['economy']` because the page is
requested without a cabin and the page states none; a non-economy definition gets `no_data`/`cabin-not-offered`
from the engine, never a mislabelled price. `fetchTile` posts the `PageRequest` (`mode`, the rectangle, `gl` = `POINT_OF_SALE`) through `http.request({ providerId: 'camoufox', tileIndex: plan.index, endpointPath: '/v1/page',
method: 'POST', cache: 'never', headers: { 'x-gmt-worker-token': token.reveal(), 'content-type': 'application/json' } … })`,
makes exactly one call per tile (there is no consent continuation: consent is a stop), and wraps every
`ProviderError` as a `tile-error`. The healthcheck probes nothing (decision 24): `{ ok: true, detail: 'not probed:
worker configured' }`. `index.ts` exports the provider, `camoufoxHttpLimits`, `planDateGrid`, `planSingleCells`, `GRID_DAYS`, the two
constants. `tiles.ts` adds `planSingleCells(q)`: one `rectangle` per cell with both ranges collapsed to the cell's
dates, in `generateCells` (or `q.cells`) order, indexed from 0. `answer.ts` turns the answer's `optionsDropped` (list
mode) into one `CellIssue` on the tile's cell (`offersDropped` = the count, `detail: 'options-unparsed'`) so a priced
cell carries `offers-dropped:n`, passes the worker's `return-date-from-query` and `cheapest-tab-below-parsed` notes
through, and maps a 409
`mode-unavailable` to `parseError('mode-unavailable')`.

`egress.ts`: one branch, `r.providerId === 'camoufox'` allows `http:` and an explicit port only when
`u.protocol === limits.workerScheme`, `u.hostname` is in `limits.hosts` and `u.port === String(limits.workerPort)`;
`ProviderHttpLimits` gains `workerPort?: number` and `workerScheme?: 'http:' | 'https:'`; every other rule (no userinfo, no credential query names, path equals `endpointPath`) still
applies.

- [ ] **Step 4: Run** — `pnpm --filter @gmt/providers test`; PASS with the package floor and a new per-directory floor
for `src/camoufox/**` (90 / 80 / 90 / 90) in `vitest.config.ts`.

- [ ] **Step 5: Commit** — `git commit -am "wp14: camoufox adapter, 7x7 tiling, worker answer mapping and egress exception"`

### Task 14.10: Engine: the blocked row, the page-cap row, and no manual re-admission after a block

**Files:** modify `packages/engine/src/run.ts`, `execute.ts`, `resume.ts`, `estimate.ts`; test
`packages/engine/test/camoufoxRows.test.ts` (layer A: the fixture provider configured to answer as `camoufox` is not
possible, because `fixture` ⇔ `synthetic`; so these tests use a stub `FlightProvider` with id `'camoufox'` that throws
the scripted `ProviderError`, through the real db `BudgetGuard` and an in-memory DB, the way WP7's error-table tests
stub providers).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { blockedError, engineWith, outcomes, stubCamoufox, stubTravelpayouts } from './support/camoufox.js';

describe('spec §8.1 rev 32: blocked', () => {
  it('the cell is error/blocked; the rest of the camoufox cells skipped:provider_disabled; other providers continue', async () => {
    const e = engineWith([stubCamoufox({ failTile: 0, error: blockedError('captcha') }), stubTravelpayouts()]);
    const ex = await e.runToEnd();
    const b = outcomes(e, ex.id, 'camoufox');
    expect(b.filter((o) => o.status === 'error').map((o) => o.reason)).toEqual(Array(b.filter((o) => o.status === 'error').length).fill('blocked'));
    expect(b.filter((o) => o.status === 'skipped').every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(outcomes(e, ex.id, 'travelpayouts').every((o) => o.status !== 'skipped')).toBe(true);
    expect(ex.status).toBe('completed');
  });
  it('the blocked tile is called once (never retried in the execution)', async () => {
    const s = stubCamoufox({ failTile: 0, error: blockedError('unusual-traffic') });
    const e = engineWith([s]);
    await e.runToEnd();
    expect(s.calls.filter((c) => c === 0)).toHaveLength(1);
  });
  it('with no other provider the run pauses paused_error and the notification names the cool-down end', async () => {
    const e = engineWith([stubCamoufox({ failTile: 0, error: blockedError('captcha') })]);
    const ex = await e.runToEnd();
    expect(ex.status).toBe('paused_error');
    expect(e.notifications.at(-1)?.detail).toMatch(/cool(ing)?-down.*2026-10-20T05:00:00.000Z/);
  });
  it('a manual resume keeps the camoufox provider disabled for that execution and retries none of its cells', async () => {
    const s = stubCamoufox({ failTile: 0, error: blockedError('captcha') });
    const e = engineWith([s]);
    const ex = await e.runToEnd();
    const before = s.calls.length;
    await e.resume(ex.id, { manual: true });
    expect(s.calls.length).toBe(before);
    expect(outcomes(e, ex.id, 'camoufox').filter((o) => o.reason === 'blocked').length).toBeGreaterThan(0);
  });
  it('a manual resume still re-admits a provider disabled for auth (the old rule is unchanged)', async () => {
    const s = stubCamoufox({ failTile: 0, error: blockedError('auth') });
    const e = engineWith([s]);
    const ex = await e.runToEnd();
    const before = s.calls.length;
    await e.resume(ex.id, { manual: true });
    expect(s.calls.length).toBeGreaterThan(before);
  });
});

describe('spec §8.1 rev 32: provider-execution', () => {
  it('the page cap marks the remaining camoufox cells skipped:budget and the run continues with other providers', async () => {
    const e = engineWith([stubCamoufox({ executionCallCap: 2 }), stubTravelpayouts()]);
    const ex = await e.runToEnd();
    const b = outcomes(e, ex.id, 'camoufox');
    expect(b.some((o) => o.status === 'skipped' && o.reason === 'budget')).toBe(true);
    expect(ex.status).toBe('completed');
  });
  it('alone, the page cap pauses paused_budget and needs a manual resume', async () => {
    const e = engineWith([stubCamoufox({ executionCallCap: 2 })]);
    const ex = await e.runToEnd();
    expect(ex.status).toBe('paused_budget');
    expect(await e.tick()).toEqual({ resumed: false });
  });
});
```

(`blockedError('auth')` builds a `ProviderError` of kind `auth` for the last test; write `test/support/camoufox.ts`
over WP7's existing engine test support in the same commit.)

- [ ] **Step 2: Run** — `pnpm --filter @gmt/engine exec vitest run test/camoufoxRows.test.ts`; FAIL (blocked handled as
an ordinary error; no provider-execution row).

- [ ] **Step 3: Implement.** In the dispatcher, `kind === 'blocked'` joins the `auth`/`quota` arm (disable for the run),
writes `error` with reason `blocked` and is non-retryable on resume (beside `no-return-legs`). Add
`blockedBefore(ctx, executionId)`: providers with any outcome `error`/`blocked` in the execution; `run.ts`,
`resume.ts` and `estimate.ts` compute `disabled` as `manual ? blockedBefore(...) : disabledBefore(...) ∪
blockedBefore(...)`. `BudgetExceeded` `provider-execution` follows the "provider-month, other providers remain" row
when another provider remains in the stage, else `paused_budget` with no `resume_after` (manual resume only). The
paused notification's detail appends the cool-down end parsed from the error message.

- [ ] **Step 4: Run** — `pnpm --filter @gmt/engine test`; PASS with thresholds.

- [ ] **Step 5: Commit** — `git commit -am "wp14: engine rows for blocked and the camoufox page cap"`

### Task 14.11: Wiring, copy and the Providers view

**Files:** modify `apps/api/src/wiring.ts`, `apps/api/src/read/usage.ts`, `apps/web/src/copy.ts`, `.env.example`;
tests `apps/api/test/wiring/camoufox.test.ts`, `apps/web/test/copy.camoufox.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/wiring/camoufox.test.ts
import { describe, expect, it } from 'vitest';
import { collectSecrets, httpLimitsFor, loadConfigFromEnv, providersFor } from '../../src/wiring.js';
import { prodEnv, testDeps } from '../helpers/wiring.js';

const ON = { CAMOUFOX_ENABLED: 'true', CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090', CAMOUFOX_WORKER_TOKEN: 'test-camoufox-worker-token-0123456789abcdef' };

describe('camoufox wiring (spec §12, §13 rev 32)', () => {
  it('off by default: no camoufox limits, no provider', () => {
    const c = loadConfigFromEnv(prodEnv());
    expect(httpLimitsFor(c).camoufox).toBeUndefined();
    expect(providersFor(c, testDeps()).map((p) => p.id)).not.toContain('camoufox');
  });
  it('on: the provider exists with discovery only, and its token is a collected secret', () => {
    const c = loadConfigFromEnv({ ...prodEnv(), ...ON });
    expect(httpLimitsFor(c).camoufox).toMatchObject({ hosts: ['127.0.0.1'], billable: 'never', concurrency: 1, workerPort: 8090, workerScheme: 'http:' });
    const b = providersFor(c, testDeps()).find((p) => p.id === 'camoufox');
    expect(b?.discovery).toBeDefined();
    expect(b?.verification).toBeUndefined();
    expect(collectSecrets(c).map((s) => s.reveal())).toContain(ON.CAMOUFOX_WORKER_TOKEN);
  });
  it('the default policy preset never adds camoufox to a new definition', async () => {
    const { defaultProviders } = await import('../../src/defaults.js');
    const c = loadConfigFromEnv({ ...prodEnv(), ...ON });
    expect(defaultProviders(c, new Set(['camoufox'])).discovery).not.toContain('camoufox');
  });
});
```

```ts
// apps/web/test/copy.camoufox.test.ts
import { describe, expect, it } from 'vitest';
import { COPY } from '../src/copy.js';
import { findBannedWords } from '@gmt/core';

describe('camoufox copy (spec §11 rev 32)', () => {
  it('the compact-mark legend names BR', () => {
    expect(COPY.priceLegend).toMatch(/CF Camoufox \(Google Flights prices via Camoufox\)/);
  });
  it('the Providers view names the page cap, the cool-down and the costs without banned words', () => {
    expect(COPY.providers.camoufoxNote).toMatch(/own IP address/);
    expect(COPY.providers.camoufoxNote).toMatch(/signed-out profile/);
    expect(COPY.providers.camoufoxNote).toMatch(/cool-down/);
    expect(findBannedWords(COPY.providers.camoufoxNote)).toEqual([]);
  });
});
```

(Use the real key names `copy.ts` exports for the legend at line 650 and for the Providers notes; the test names them
once.)

- [ ] **Step 2: Run** — `pnpm --filter @gmt/api exec vitest run test/wiring/camoufox.test.ts && pnpm --filter @gmt/web exec vitest run test/copy.camoufox.test.ts`; FAIL.

- [ ] **Step 3: Implement.** One line each in `httpLimitsFor`, `providersFor` and `collectSecrets`; `usage.ts` names
the camoufox provider's window `month` and plan `—`; the copy: legend entry `CF Camoufox (Google Flights prices via Camoufox)`,
`camoufoxNote`: "Off by default. Reads Google Flights in your own Camoufox browser, in a separate signed-out profile, from
your own IP address, at most one page every 30 seconds and the page cap per run. On any bot check it stops and refuses
every page for the cool-down. Google's terms do not permit this automated access." `.env.example` gains the spec §12 block verbatim.
`defaults.ts` is unchanged (it never adds `camoufox`; the test pins it).

- [ ] **Step 4: Run** — both suites PASS; `pnpm test` PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: wire the camoufox provider, copy and env example"`

### Task 14.12: Recording and replay (local-only, decision 61): the grid, and the consent page as a stop

**Files:** create `apps/camoufox-worker/src/record.ts`, `test/recorded.test.ts`; modify `.gitignore`,
`src/selectors.ts`, `src/names.ts` (after the recording).

The recorder is a development-only command the operator runs on their own machine with the worker's configuration:
`pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24
--mode list --pages 1` (and once with `--mode grid --allow-unverified-grid`, the only path on which grid mode runs before
it is verified; it reads and records, and answers nothing to an app). It uses the same `PageSession`, so the start
checks, spacing, allowlist, consent rule and hard stop all apply; `--pages` is at most 3 and each page is printed before
it is loaded. After each step it writes `apps/camoufox-worker/fixtures/recorded/<yyyy-mm-dd>/<n>-<kind>.snapshot.json`
(the parsed `Snapshot`) and `<n>-<kind>.meta.json` (`{ recordedAt, recordedBy, url, kind, request, restVersion,
selectorsVersion, grammarVersion, contentSha256 }`). It fails closed when any configured secret, the access key, the `SOCS`
value, or any node name matching `/^Google Account: /` appears (a signed-in page is never written; the run stops and
says why). On a blocked page it records nothing, prints the cool-down end and exits 69.

**The consent recording is separate and never uses the worker's profile.** Because camofox-browser 1.13.1 accepts
consent by itself, a consent page can only be captured in a throwaway profile: `record --consent-probe` creates a
camofox-browser session `gmt-probe-<random>` with no `SOCS` cookie, opens the results URL once, snapshots the first page
before anything else, writes `<n>-consent.snapshot.json` and its meta, then deletes that session and its profile at
once, whatever the page showed (an auto-accept may have happened inside it; it is never reused). It refuses to run
while the worker is running. The probe is a page load like any other and honours the spacing.

`.gitignore` gains:

```gitignore
# why: recorded Google page snapshots are vendor content and never enter git (plan decisions 61, 68)
apps/camoufox-worker/fixtures/recorded/**
!apps/camoufox-worker/fixtures/recorded/.gitkeep
```

- [ ] **Step 1: Write the failing test**

```ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordingsPresent, skipTitle } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/ax.js';
import { classifyPage } from '../src/classify.js';
import { readGrid } from '../src/grid.js';
import { readList } from '../src/list.js';
import { GRAMMAR_VERSION } from '../src/names.js';
import { GRID_VERIFIED, SELECTORS_VERSION } from '../src/selectors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { asIsoDateTime } from '@gmt/core';
import { CooldownStore } from '../src/cooldown.js';
import { Pacer } from '../src/pacer.js';
import { PageSession } from '../src/session.js';
import { FakeRest } from './support/fakeRest.js';

const clock = { now: () => asIsoDateTime('2026-10-18T05:00:00.000Z') };
const SOCS = { value: 'synthetic-socs-rejection-value', domain: '.google.com' as const, path: '/' as const, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') };

const ROOT = new URL('../fixtures/recorded/', import.meta.url).pathname;
const present = recordingsPresent(ROOT);

function recorded(kind: string): { snap: Snapshot; raw: string; meta: Record<string, unknown> }[] {
  return readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) =>
    readdirSync(join(ROOT, d.name)).filter((f) => f.endsWith(`-${kind}.meta.json`)).map((f) => {
      const raw = readFileSync(join(ROOT, d.name, f.replace('.meta.json', '.snapshot.json')), 'utf8');
      return { raw, snap: JSON.parse(raw), meta: JSON.parse(readFileSync(join(ROOT, d.name, f), 'utf8')) };
    }));
}

describe.skipIf(!present)(skipTitle('recorded Google snapshots (decision 61, local-only)', present), () => {
  it('every recording hashes to its contentSha256 (a hand-edited file fails)', () => {
    for (const k of ['consent', 'results', 'list', 'grid']) for (const r of recorded(k))
      expect(createHash('sha256').update(r.raw).digest('hex')).toBe(r.meta.contentSha256);
  });
  it('no recording shows a signed-in account control', () => {
    for (const k of ['consent', 'results', 'list', 'grid']) for (const r of recorded(k)) expect(r.raw).not.toMatch(/Google Account: /);
  });
  it('the recorded results pages classify as results and every listed option parses', () => {
    for (const r of recorded('list')) {
      expect(classifyPage(r.snap)).toEqual({ kind: 'results' });
      const l = readList(r.snap, r.meta.request as Parameters<typeof readList>[1]);
      expect(l.currency).toBe('GBP');
      expect(l.options.length).toBeGreaterThan(0);
      expect(l.optionsDropped).toBe(0);
      expect(l.cheapestTabMinor).toBe(Math.min(...l.options.map((o) => o.amountMinor)));
    }
  });
  it('the recorded consent page is a stop: consent-unhandled, nothing clicked, session discarded', async () => {
    for (const r of recorded('consent')) {
      expect(classifyPage(r.snap)).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
      const rest = new FakeRest({ version: '1.13.1', accountCookie: false, keyless: 'refused', snapshots: [r.snap] });
      const s = new PageSession({ rest, profileId: 'gmt-worker', socs: SOCS, pacer: new Pacer({ minSpacingSeconds: 30, nowMs: () => 0 }),
        cooldown: new CooldownStore({ dir: mkdtempSync(join(tmpdir(), 'rc-')), hours: 48, clock }), clock });
      expect(await s.page(r.meta.request as Parameters<PageSession['page']>[0])).toMatchObject({ kind: 'blocked', page: 'consent-unhandled' });
      expect(rest.calls.some((c) => c.op === 'click')).toBe(false);
      expect(rest.calls.some((c) => c.op === 'discardSession')).toBe(true);
    }
  });
  it('a recorded grid, if any, parses 49 keyed cells; GRID_VERIFIED follows the evidence', () => {
    const g = recorded('grid');
    for (const r of g) {
      const read = readGrid(r.snap, r.meta.request as Parameters<typeof readGrid>[1]);
      expect(read.cells.length + read.dropped.length).toBe(49);
      expect(read.dropped).toEqual([]);
    }
    expect(GRID_VERIFIED).toBe(g.length > 0);
  });
  it('the selectors and grammar versions are no older than the newest recording', () => {
    const newest = ['list', 'grid', 'consent'].flatMap((k) => recorded(k).map((r) => String(r.meta.recordedAt).slice(0, 10))).sort().at(-1) ?? '';
    expect(SELECTORS_VERSION.slice(0, 10) >= newest).toBe(true);
    expect(GRAMMAR_VERSION.slice(0, 10) >= newest).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/recorded.test.ts`. On a fresh checkout:
reported skipped with the suffix `(skipped: recordings not present, local-only, decision 61)`. With the first
recordings present: FAIL wherever the selectors, grammar or verified flags do not yet match the evidence.

- [ ] **Step 3: Implement** `record.ts`; the operator runs it (one to three page loads per mode, spacing honoured, in
the dedicated profile); the implementer edits `selectors.ts` and `names.ts` from the recorded snapshots (the grid's real
roles, the consent page's heading, the non-stop name), sets `SELECTORS_VERSION` and `GRAMMAR_VERSION` to the recording
date, flips `GRID_VERIFIED` only when a recording proves it, and rewrites `grid.ts` against the
recorded roles if they differ from Task 14.3's hypothesis, keeping Task 14.3's tests green with synthetic trees updated
to those roles. Every rule that changed is listed in the commit message.

- [ ] **Step 4: Run** — with recordings: PASS, 6 tests. Without: skipped, visibly.

- [ ] **Step 5: Commit** — `git commit -am "wp14: local-only snapshot recorder and replay; selectors dated <date>"`

### Task 14.13: Compose, the default-image checks and the rules tests

**Files:** create `apps/camoufox-worker/test/rules.test.ts`; modify `docker-compose.yml`, `.github/workflows/ci.yml`,
`scripts/check-boundaries.mjs`, `scripts/workflows.test.mjs`.

`docker-compose.yml`: the `app` service gains only these lines (no new service, no new image, no new volume):

```yaml
  app:
    # … unchanged …
    # why: the camoufox worker runs on the operator's machine beside Camoufox (spec §13 rev 32). Docker Desktop
    # resolves host.docker.internal itself; this line makes Linux resolve it to the host gateway too.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      # --- camoufox (off by default; spec §12) ---
      CAMOUFOX_ENABLED: "${CAMOUFOX_ENABLED:-}"
      CAMOUFOX_WORKER_URL: "${CAMOUFOX_WORKER_URL:-http://host.docker.internal:8090}"
      CAMOUFOX_WORKER_TOKEN: "${CAMOUFOX_WORKER_TOKEN:-}"
      CAMOUFOX_MODE: "${CAMOUFOX_MODE:-}"
      CAMOUFOX_MIN_SPACING_SECONDS: "${CAMOUFOX_MIN_SPACING_SECONDS:-}"
      CAMOUFOX_EXECUTION_PAGE_CAP: "${CAMOUFOX_EXECUTION_PAGE_CAP:-}"
      CAMOUFOX_MONTHLY_PAGE_CAP: "${CAMOUFOX_MONTHLY_PAGE_CAP:-}"
      CAMOUFOX_BILLING_DAY: "${CAMOUFOX_BILLING_DAY:-}"
      CAMOUFOX_COOLDOWN_HOURS: "${CAMOUFOX_COOLDOWN_HOURS:-}"
      CAMOUFOX_PAGE_TIMEOUT_SECONDS: "${CAMOUFOX_PAGE_TIMEOUT_SECONDS:-}"
```

- [ ] **Step 1: Write the failing tests**

`apps/camoufox-worker/test/rules.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n');
const lock = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');

describe('plan decision 68: the rules that still bind', () => {
  it('no proxy anywhere: no proxy option, no proxy package', () => {
    expect(src).not.toMatch(/\bproxy\b/i);
    expect(lock).not.toMatch(/proxy-chain|https-proxy-agent|socks-proxy-agent|residential/i);
  });
  it('no challenge solver and no challenge interaction', () => {
    expect(lock).not.toMatch(/captcha|2captcha|capsolver|anti-captcha|nopecha/i);
    expect(src).not.toMatch(/solve|bypass/i);
  });
  it('no general cookie import, no sign-in, no typing, no script evaluation through the REST client', () => {
    expect(src).not.toMatch(/import_?cookies|importCookies|signIn|typeText|evaluate/i);
  });
  it('the only cookie the worker ever sets is SOCS, from one call site', () => {
    const rest = readFileSync(new URL('../src/rest.ts', import.meta.url), 'utf8');
    const set = [...rest.matchAll(/method:\s*'POST'[\s\S]{0,300}?\/cookies[\s\S]{0,300}?name:\s*([A-Za-z_]+)/g)].map((m) => m[1]);
    expect(set).toEqual(['SOCS_NAME']);
    expect([...src.matchAll(/setConsentCookie\(/g)].length).toBe(2);   // its definition in rest.ts and its one call in session.ts
  });
  it('the worker sends the camofox-browser access key on every request', () => {
    const rest = readFileSync(new URL('../src/rest.ts', import.meta.url), 'utf8');
    expect(rest).toMatch(/accessKey/);
  });
  it('no delay is randomised', () => {
    expect(src).not.toMatch(/Math\.random|randomInt|jitter/);
  });
  it('the worker carries no browser library of its own', () => {
    const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    expect(pkg).not.toMatch(/playwright|puppeteer|camoufox|selenium/i);
  });
});
```

`scripts/workflows.test.mjs` (extend):

```js
it('the default image has no browser, compose adds no browser service, and the app reaches the worker by URL', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  expect(compose).not.toMatch(/^\s{2}(browser|camoufox)[a-z-]*:\s*$/m);
  expect(compose).toContain('host.docker.internal:host-gateway');
  expect(compose).toContain('CAMOUFOX_WORKER_URL: "${CAMOUFOX_WORKER_URL:-http://host.docker.internal:8090}"');
  expect(readFileSync('Dockerfile', 'utf8')).not.toMatch(/playwright|chromium|firefox|camoufox/i);
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  expect(ci).toMatch(/camoufox-worker absent/);
});
```

- [ ] **Step 2: Run** — `pnpm --filter @gmt/camoufox-worker exec vitest run test/rules.test.ts && pnpm vitest run --project scripts scripts/workflows.test.mjs`; FAIL on the compose and CI assertions.

- [ ] **Step 3: Implement** the compose lines; a CI step named "app runs with the camoufox-worker absent" that starts
the stack with `CAMOUFOX_ENABLED=true` and a dummy token and no worker, checks `/api/health` is ok, and checks the
Providers route lists `camoufox` with no error at boot (boot makes no network call); the docker job's existing image
assertion extended to `! command -v firefox && ! ls /ms-playwright`; `check-boundaries.mjs` adds `apps/camoufox-worker`
to the graph (imports `@gmt/core` only; nothing imports it; `process.env` only in `src/main.ts` and `src/record.ts`,
both entry points).

- [ ] **Step 4: Run** — both PASS; `node scripts/check-boundaries.mjs` exits 0.

- [ ] **Step 5: Commit** — `git commit -am "wp14: compose reaches the host worker by URL; default image and rules checks"`

### Task 14.14: Operator docs

**Files:** modify `docs/setup.md`, `docs/providers.md`, `docs/api-limits.md`; test
`apps/api/test/deploy/camoufoxDocs.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMOUFOX_DISCOVERY_INFO } from '@gmt/providers';

const doc = (p: string) => readFileSync(new URL(`../../../../docs/${p}`, import.meta.url), 'utf8');

describe('camoufox docs (spec §2 costs, §13)', () => {
  it('setup.md has the section, the worker command, both worker URLs and the off-by-default line', () => {
    const s = doc('setup.md');
    expect(s).toMatch(/^## 14\. The Camoufox provider \(optional, off by default\)$/m);
    expect(s).toContain('pnpm --filter @gmt/camoufox-worker start');
    expect(s).toContain('http://host.docker.internal:8090');
    expect(s).toContain('http://127.0.0.1:8090');
    expect(s).toContain('CAMOUFOX_ENABLED=true');
    expect(s).toMatch(/signed-out profile/);
    expect(s).toContain('CAMOFOX_ACCESS_KEY');
    expect(s).toContain('socs.json');
    expect(s).toMatch(/host\.docker\.internal.*every port/s);
  });
  it.each(["Google's terms", "operator's IP", 'Brittleness', 'Speed', 'Availability', 'Image size'])('providers.md and api-limits.md state the %s cost', (cost) => {
    expect(doc('providers.md')).toContain(cost);
    expect(doc('api-limits.md')).toContain(cost);
  });
  it('providers.md and api-limits.md state the robots.txt disallow as a known cost', () => {
    for (const d of ['providers.md', 'api-limits.md']) expect(doc(d)).toContain('/travel/flights/search');
  });
  it('providers.md quotes the provenance note exactly', () => {
    expect(doc('providers.md')).toContain(CAMOUFOX_DISCOVERY_INFO.provenanceNote);
  });
  it('providers.md no longer calls it a Phase 4 option that is not built', () => {
    expect(doc('providers.md')).not.toMatch(/Phase 4 continuity fallback only \(spec §2\); not built/);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @gmt/api exec vitest run test/deploy/camoufoxDocs.test.ts`; FAIL.

- [ ] **Step 3: Write the docs.**

`docs/setup.md`, new section after section 13:

```markdown
## 14. The Camoufox provider (optional, off by default)

The Camoufox provider reads Google Flights' cheapest prices in Camoufox, the browser you run on your own machine, through
the camofox-browser server you already have there. It exists for one case: SearchApi is gone, too dear, or has lost the
date grid, and you still want Google's prices for discovery. It finds calendar prices only ("constraints not checked");
it never searches itineraries. Read its costs below before you turn it on.

**What it costs you**

- **Google's terms.** Scraping Google is against its terms; you chose Camoufox knowing that. Google's Terms of Service
  bar automated access that ignores its machine-readable instructions, and google.com's robots.txt disallows
  `/travel/flights/search` for every user agent, the path Google's results live under (read 2026-10-18). Camoufox is
  built not to look automated, which makes the access deliberate. With SearchApi, SearchApi took that step; with this
  provider, you do.
- **Your IP address and account.** Every page comes from your own address; the app never uses a proxy. If Google
  blocks or challenges it, other Google use from the same network may be affected. The provider uses its own
  signed-out profile so your Google account is never involved.
- **Brittleness.** Google changes the page without notice. When it does, the provider stops (it never guesses) until
  the app is updated. A camofox-browser upgrade needs the same re-check.
- **Speed.** About 40 seconds a page with the fixed 30-second gap, and in the default `list` mode one page prices one
  day pair: the default cap of 100 pages a run prices 100 day pairs. Use it on a narrow window or a fixed stay. A list
  price's return date is the date the app asked for (the page states only the departure).
- **Availability.** It runs only while your machine is on and the worker is running. Without them, those day pairs show
  an error and every other provider runs as usual.
- **Image size.** None: the app's image does not change. Camoufox stays on your machine.

**How it behaves.** One page at a time, at least 30 seconds apart, no more than `CAMOUFOX_EXECUTION_PAGE_CAP` pages a
run and `CAMOUFOX_MONTHLY_PAGE_CAP` a month, in a separate signed-out profile (`gmt-worker`). Your cookie choice is
**Reject all**, set before every page from the value you capture below, so Google's cookie page never appears.
camofox-browser 1.13.1 clicks "Accept all" on that page by itself, so if the page appears anyway the worker treats it as
a stop: it closes the session and cools down, and never carries on after an accept. If Google shows a CAPTCHA, an
"unusual traffic" page, a cookie page, a sign-in page, a signed-in account, or anything it does not recognise, it stops
at once, marks that day pair "blocked", stops for the rest of the run, and
refuses every page for `CAMOUFOX_COOLDOWN_HOURS` (48 by default; set it higher for a longer pause, never below 24). It never solves or clicks through a challenge, and
nothing retries it.

**Turn it on**

1. Run camofox-browser 1.13.1 on this machine (`http://127.0.0.1:9377`) with an access key: start it with
   `CAMOFOX_ACCESS_KEY` set to at least 32 random characters. The key gates every route of that server. Without it,
   any program on this machine, and any Docker container (Docker Desktop forwards `host.docker.internal` to every port
   here), could drive the browser directly and skip every rule below; the worker refuses to start if the server answers
   without the key.
2. Capture your cookie choice once. In an ordinary private browser window (not camofox-browser, which would click
   "Accept all" for you), open `https://www.google.com/travel/flights`, click **Reject all**, then open the browser's
   storage view (developer tools, cookies for `https://www.google.com`) and copy the `SOCS` cookie's value. Save it as
   `~/.local/state/get-me-there/camoufox/socs.json`:

   ```json
   { "value": "<the SOCS value>", "domain": ".google.com", "path": "/", "capturedAt": "2026-10-18T09:00:00.000Z" }
   ```

   Google keeps this choice for 13 months; the worker refuses an older capture and tells you to repeat this step.
3. Make a worker token of at least 32 random characters (for example `openssl rand -hex 24`) and add to `.env`:

   ```bash
   CAMOUFOX_ENABLED=true
   CAMOUFOX_WORKER_TOKEN=<your token>
   ```

4. Start the worker from a checkout, in its own terminal or as a login item:
   `CAMOUFOX_WORKER_TOKEN=<your token> CAMOFOX_ACCESS_KEY=<the camofox key> pnpm --filter @gmt/camoufox-worker start`.
   It refuses to start if the camofox-browser version is not the one it was checked against, if that server answers
   without its key, if the `SOCS` capture is missing or stale, or if its profile is signed in to Google.
5. Point the app at it. With `pnpm dev`, set `CAMOUFOX_WORKER_URL=http://127.0.0.1:8090`. In Docker the default is
   `http://host.docker.internal:8090`, which Docker Desktop forwards to this machine; on Linux, also start the worker
   with `CAMOUFOX_WORKER_BIND` set to the Docker bridge address (`ip -4 addr show docker0`), never `0.0.0.0`.
6. Restart the app, then add "Google Flights prices via Camoufox" to the discovery providers of the definitions you
   choose. New definitions never include it by themselves.

**Optional.** You may patch camofox-browser so its consent helper prefers "Reject all"; the worker behaves the same
with or without that patch and never relies on it.

**Turn it off.** Set `CAMOUFOX_ENABLED=false` and restart the app; stop the worker. The worker's cool-down record lives
in `~/.local/state/get-me-there/camoufox/`; deleting it ends a cool-down early, which defeats its purpose.

**Check it.** `curl -s -H "x-gmt-worker-token: <your token>" http://127.0.0.1:8090/v1/status` shows whether it is
cooling down, its profile, whether that profile holds a Google account cookie, and the date of your `SOCS` capture.
```

`docs/providers.md`: replace the Camoufox row of the summary table with:

```markdown
| Self-scraping: Google Flights in the operator's own Camoufox, through camofox-browser and the app's host-side worker (`camoufox` provider) | Self-run; no vendor account | £0; the costs are the operator's IP, Google's terms and selector upkeep | Google's page as read | List mode one day pair a page; grid mode 7 × 7 once recorded | Yes | Yes | Search link only | **Unauthorised; the operator carries the exposure directly** | Built, opt-in, off by default, discovery only (spec §2 rev 32) |
```

and add a section `### Camoufox provider (self-scraped, opt-in)` with the method, the feasibility load (date, versions,
passed, structure seen, and that it ran signed in, which the dedicated profile now forbids), the signed-out test (the
consent page, camofox-browser's own "Accept all" click, and the `SOCS` design that answers it), the access key, the
limits, the six costs
under the bold names of spec §2 (**Google's terms**, **The operator's IP and account**, **Brittleness**, **Speed**,
**Availability**, **Image size**), the provenance note quoted exactly, and the labels.

`docs/api-limits.md`: a `### Camoufox (own Google Flights pages): self-scraped, opt-in, free` subsection under
"Per-provider facts" with the page caps and window, the spacing and derived rates, the cool-down, "never billable,
cost 0, never cached", both tilings with the worked-example figures, the six costs (same names, the robots.txt
disallow of `/travel/flights/search` stated under **Google's terms**), and under
"Reconciling" one line: there is no vendor dashboard; the ledger's `camoufox` rows are the only record, and a `423` row
is a block.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: operator docs for the camoufox provider and its costs"`

### Task 14.15: Smoke checklist rows

**Files:** modify `apps/api/src/tools/smoke.ts`, `smokeChecks.ts`; test `apps/api/test/tools/smoke.camoufox.test.ts`.

The smoke already runs one discovery tile per configured provider (spec §9 item 7, decision 65). With the camoufox provider
configured it adds **one** camoufox tile (one cell in `list` mode, the 7 × 7 grid in `grid` mode; one worker call), spending no SearchApi credit, and these checklist rows:

| Row | `ok` when | `FAIL` when | `skip` when |
|---|---|---|---|
| `camoufox one page` | the ledger holds exactly one `camoufox` row for the tile | more rows, or a row on another tile index | camoufox is not configured |
| `camoufox consent rejected` | the answer was not `consent-unhandled`, and the worker's status shows a `SOCS` capture younger than 13 months | a `consent-unhandled` block, or no capture | not configured |
| `camoufox access key` | the worker's status reports that the REST server refused a keyless request at start | anything else | not configured |
| `camoufox not blocked` | the answer was `cells` | the answer was `blocked` or `cooling-down`; the line names the page kind and the cool-down end | not configured |
| `camoufox grid keys` | every price's dates lie in the tile and came from the grid's headers (no `out-of-tile` note) | any `out-of-tile` note | not configured or blocked |
| `camoufox partial` | `look` when any cell issue exists (the line counts them), else `ok` | — | not configured or blocked |
| `camoufox provenance` | `scraped-self`, `maxAgeHours` 0, the note equals `CAMOUFOX_DISCOVERY_INFO.provenanceNote`, currency GBP | anything else | not configured or blocked |
| `camoufox selectors` | the answer's `selectorsVersion` has no `-unverified` suffix | `-unverified` (selectors never checked against a recording) | not configured or blocked |
| `camoufox signed out` | the worker's status reports the dedicated profile id and `accountCookie: false` | `accountCookie` other than false, or the operator's own profile id | not configured |
| `camoufox return date` | `look`: the line prints the cell's return date with "(the date asked for)" | — | not configured or blocked |
| `camoufox compare` | `look`: the operator opens Google Flights for the cheapest cell and compares the price by eye | — | not configured or blocked |

A blocked smoke exits 1, prints the cool-down end, and says that every further smoke will be refused until then.

- [ ] **Step 1: Write the failing test** — one `it` per row, over a scripted worker answer through msw at
`http://127.0.0.1:8090/v1/page` (cells; consent-unhandled; blocked; cooling-down; an out-of-tile
cell; a dropped cell; an `-unverified` version), each asserting the row's status and the exit code.

- [ ] **Step 2: Run** — `pnpm --filter @gmt/api exec vitest run test/tools/smoke.camoufox.test.ts`; FAIL (no rows).

- [ ] **Step 3: Implement** the rows in `smokeChecks.ts` and the one camoufox tile in `smoke.ts` (one tile from the configured mode's planner; the per-run cap for camoufox is 1 page load).

- [ ] **Step 4: Run** — PASS; `pnpm --filter @gmt/api test` PASS.

- [ ] **Step 5: Commit** — `git commit -am "wp14: smoke checklist rows for the camoufox tile"`

## 11. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP14. The inputs most likely to bite first are pinned here:

- A page that shows results **and** a bot check is blocked, never read (Task 14.1, blocked kinds first; Task 14.5
  re-classifies after every click).
- A signed-in account control stops the worker and keeps it refusing until restarted (Tasks 14.1, 14.5); a profile
  holding an account cookie never starts (Task 14.5).
- The `SOCS` rejection is set before every tab, and a consent page, or a `SOCS` value changed after a page, is a
  `consent-unhandled` stop with the session discarded and nothing clicked (Tasks 14.1, 14.4, 14.5), proved on a
  recorded consent page (Task 14.12).
- A camofox-browser server that answers without its access key, or a missing or stale `SOCS` capture, stops the worker
  at start (Task 14.5).
- A block is never retried in the execution, not even by a manual resume (Task 14.10).
- The cool-down survives a worker restart and fails closed on a corrupt record (Task 14.1).
- A second request inside the spacing opens no tab (Task 14.5).
- A result name Google rewords is dropped and counted, never partly read; a page with no parsed option stops (Tasks
  14.2, 14.5); the "Cheapest" tab price below the parsed minimum marks the cell partial (Tasks 14.5, 14.9).
- Grid mode never runs before a recording verifies it (Tasks 14.5, 14.9, 14.12).
- The app may reach the worker but never the camofox-browser REST port (Task 14.9 egress).
- The default image carries no browser and the app runs without the worker (Task 14.13).

## 12. Definition of done

- `pnpm --filter @gmt/camoufox-worker test` passes (no browser needed); `recorded.test.ts` passes with the local
  recordings and, on a fresh checkout, is reported skipped with the decision-61 suffix.
- `pnpm --filter @gmt/core test` passes at core's 100% thresholds.
- `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/providers test` (with a `src/camoufox/**` floor of 90/80/90/90),
  `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test`, `pnpm --filter @gmt/web test` pass with their
  thresholds; `pnpm test` passes.
- `pnpm lint` clean; `pnpm -r typecheck` clean; `node scripts/check-boundaries.mjs` exits 0;
  `node scripts/check-casts.mjs` exits 0; `pnpm secret-scan` prints `secret scan: clean`.
- `grep -rniE "proxy|Math\.random|jitter|importCookies|solve" apps/camoufox-worker/src packages/providers/src/camoufox`
  prints nothing.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" apps/camoufox-worker/src packages/providers/src/camoufox` prints nothing.
- `git check-ignore apps/camoufox-worker/fixtures/recorded/2026-10-18/1-list.snapshot.json` prints the path, and
  `git ls-files apps/camoufox-worker/fixtures/recorded` prints only `.gitkeep`.
- `docker compose build app && docker run --rm get-me-there:local sh -c '! command -v firefox && ! ls /ms-playwright 2>/dev/null'`
  exits 0, and `docker image ls get-me-there:local` shows the size unchanged from main within 5 MB.
- With `CAMOUFOX_ENABLED=true` and no worker running, `docker compose up -d` then `/api/health` answers ok.
- On the operator's machine: `pnpm --filter @gmt/camoufox-worker start` refuses to start against any camofox-browser
  version but 1.13.1, against a server started without `CAMOFOX_ACCESS_KEY`, without a `socs.json` capture, and against a
  signed-in profile; `lsof -nP -iTCP:8090 -sTCP:LISTEN` shows the worker on
  `127.0.0.1` only.
- The operator's own smoke with camoufox configured: exactly 1 page load, no consent page; every row of Task 14.15 reads `ok` or
  `look`.
- Every task's checkbox ticked.

## 13. For the plan (not yet recorded there)

Decision 68 records the provider id, the limits, the capabilities and the deployment shape. Items for Fable:

1. **Manual-resume exception.** Spec §8.1 says a manual `/resume` re-enables providers disabled in the previous pass;
   decision 68 keeps a provider disabled when the execution holds a `blocked` outcome for it. Spec revision 32 states
   it in the error-table row; the resume bullet of §8.1 should say it too at the next revision.
2. **Contract fields.** `ProviderLimits.executionCallCap`, `ProviderHttpLimits.workerPort` and `.workerScheme` are new
   optional fields in contracts the plan lists (Budget port, http-kit); add them to the contract blocks.
3. **Selectors and grammar re-dating.** When Google's page changes, the provider stops as `unrecognised`; the fix is a
   new recording (Task 14.12's command), edits to `selectors.ts` and `names.ts` and new versions in one commit, with
   the recorded suite green. Worth a line in the plan's process as a standing maintenance task, and the same for a
   camofox-browser upgrade (the pinned version in `rest.ts` and `startChecks`).
4. **`SOCS` re-capture.** The captured rejection lasts 13 months (Google's cookie policy); the worker refuses a stale
   capture and the smoke reports its date. A reminder in the operator's maintenance list (or an operator notification a
   month before expiry, read from the worker's status) is a small follow-up.
5. **`docs/scheduling.md`** (generated) gains camoufox rows from both planners and the spacing: `list` 100 cells per
   run at the default cap (about 67 minutes); `grid` 78 pages and about 52 minutes per worked-example pair.
6. **Smoke cross-check.** Once grid mode is verified, a smoke row comparing one grid cell with the list price for the
   same day pair would show whether the grid and the cheapest list agree.

## 14. Open questions

None. The operator's rulings of 2026-10-18 settled every question the earlier drafts raised:

- **robots.txt and Google's terms:** a known cost the operator accepted in choosing Camoufox; stated in spec §2, the
  operator docs and the Providers copy (Task 14.14). No gate.
- **The REST server's exposure:** closed by camofox-browser's `CAMOFOX_ACCESS_KEY`, which the operator sets, the
  worker sends, and the worker's start check enforces (Tasks 14.5, 14.14).
- **Consent:** the `SOCS` rejection is pre-set and any consent page is a stop (Task 14.4); the optional camofox patch is
  documented and never depended on.
- **Cool-down:** 48 hours by default, configurable, never below 24.
- **Return date in list mode:** the worker's own query date, labelled so (the `return-date-from-query` note, the
  provenance note, the smoke's `look` row).
- **Signed-out behaviour:** the signed-out test of 2026-10-18 showed a consent page and no challenge; the design above
  answers it.
