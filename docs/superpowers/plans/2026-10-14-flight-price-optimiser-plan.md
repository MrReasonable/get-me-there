# get-me-there Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the route-agnostic flexible-date flight price optimiser described by the design spec, as a pnpm monorepo of six packages, delivered as fourteen work packages dispatched to Opus and Sonnet implementers behind contracts that Fable owns.

**Architecture:** One Node process (Hono API + engine + croner scheduler) serving a built React SPA over one SQLite file. `core` is pure (types, ports, every domain function); `db` and `providers` depend only on `core`; `engine` composes them; `api` and `web` sit on top. Every price carries provenance; every HTTP attempt is ledgered and cap-checked before it is sent; synthetic data exists only behind `syntheticAllowed`.

**Tech Stack:** TypeScript strict, Node 22+ (image `node:22-slim`; dev machine runs 26), pnpm 12, `better-sqlite3` + Drizzle, Hono + `@hono/node-server` + `@hono/zod-validator`, zod 4, `@noble/hashes`, `@date-fns/tz`, `bottleneck`, `p-retry`, `pino`, `croner`, `nodemailer`, Vite 8 + React 19 + TanStack Query + TanStack Table + Tailwind 4 + Recharts 3, Vitest 5 + `msw` 3 + Testing Library + Stryker, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (revision 9, approved). The plan argues from the spec; every implementer reads both. Where this plan and the spec disagree, the spec wins and the plan is the bug.

**Companion documents:** one brief per work package under `docs/briefs/wpNN-<slug>.md` carries that package's bite-sized tasks. This plan holds the global constraints, the file map, the cross-package contracts, the dispatch order, and the full task list for WP0 (which Fable builds first, because everything else imports it).

## Global Constraints

Copied from the spec. Every task's requirements include this section.

- **Package graph (spec §4):** `core` imports only `zod`, `@noble/hashes`, `@date-fns/tz`. `db` and `providers` import `core` only. `engine` imports `core`, `db`, `providers`. `api` imports all. `web` imports `core` (types, `api-contract`, pure filter/rank/verdict/label functions). `providers` has no SQLite and no `process.env`. `process.env` is read once, in the `api` bootstraps.
- **No airports in code (spec §1):** "nothing about any specific city or country exists in application code." The worked example everywhere (docs, fixtures, tests that need a route) is London → New York: LHR and LGW to JFK and EWR. The operator's own route never appears in the repository.
- **No fabricated data (spec §5.5):** every fixture price is `sourceKind: 'synthetic'` and `providerId: 'fixture'`; repositories reject any row where `provider_id = 'fixture'` ⇔ `source_kind = 'synthetic'` does not hold; the fixture provider's constructor throws unless `syntheticAllowed(config)`.
- **Provenance on every price (spec §3):** `{ providerId, sourceKind, fetchedAt, providerObservedAt?, maxAgeHours: number | 'unknown', fx: { converted: false } | { converted: true; rateNano; rateDate; source }, pointOfSale: 'GB' | 'unknown', cabin }`. Nothing is defaulted.
- **Money (spec §6.3):** prices are integer pence (`*Pence` / `*_pence`); provider costs integer micro-GBP (`*MicroGbp` / `*_micro_gbp`); FX rates integer nano (`fx_rate_nano` = GBP per 1 native unit × 1e9); operator config in pence converted once at the config boundary; "No float ever holds money; zod and repositories reject non-integers."
- **Timestamps (spec §6.3):** `Date.prototype.toISOString()` form only (`2026-10-14T15:00:00.000Z`). Calendar dates are `YYYY-MM-DD` strings backed by epoch-day integers; "never `Date`-local arithmetic."
- **Budget (spec §5.3):** `budget.reserve` runs before every HTTP attempt inside one `BEGIN IMMEDIATE` transaction; a cap of 0 refuses when `current + this > 0`; zero-cost calls pass; subscription plans count the fixed fee once and treat the call cap as the hard stop; `travelpayouts` and `fx` are never billable; cache hits are never billable.
- **Secrets (spec §5.3):** keys travel only in headers; `endpoint_path` is path only; cache keys and bodies exclude credentials; every URL written to any sink has query and userinfo stripped; pino `redact` covers `apiKey`, `token`, `authorization`, `url.query`, `req.headers.authorization`; the recorder fails closed on any secret substring. The repository `.gitignore` covers `.env*`, `data/`, `*.db*` and `backups/`.
- **Banned words (spec §11):** "exhaustive", "all combinations", "every combination", "live", "bookable", "guaranteed", "real-time" in any user-facing string (web, engine templates, API reason strings), tested with word boundaries and a small allowlist. "verified" appears only beside class-`verified` values; stage counts say "itinerary-searched".
- **Coverage thresholds (spec §9):** `core` 100% lines/branches/functions; `db`, `providers`, `engine`, `api` 85% lines and 70% branches; `web` 70% lines, 60% branches; Stryker break threshold 80% on `core` `hashing`, `constraints`, `selection`, `rollUp`, `syntheticAllowed`, `toGbp`, `vendorUrl`, `alertDedup`.
- **Vendor links (spec §5.2):** `https:` only, no userinfo, host equal to or a subdomain of the provider's allowlist (`aviasales.com` for Travelpayouts, `google.com` for SearchApi), else `{ kind: 'none' }`.
- **Point of sale (spec §5.2):** SearchApi `gl` = `POINT_OF_SALE` lower-cased, `hl=en`, `currency=GBP`; Travelpayouts `currency=gbp` only and `pointOfSale: 'unknown'`.
- **Comments:** generous. Every exported function has a doc comment saying what it is for and which spec section it implements. Non-obvious decisions get a `// why:` line.
- **Tooling:** Biome for lint and format (`pnpm lint` clean is part of done); Vitest for every test; `pnpm -r test` green with thresholds is part of done for every WP.

## Review Focus

Input classes the spec implies but its own test lists do not exercise, most likely to bite first. Each line names the owning work package, whose brief carries the pinned test.

1. **Operator types a lowercase or metropolitan IATA code** (`lhr`, `LON`, `NYC`) into the Definitions form or the example JSON. Expected: upper-cased before validation; a metro code is rejected with a message naming it as a city code and listing the airports the table maps to it. Owner: WP1 (`validateSearchSpace` rejects codes whose airports-table row is absent, and the lookup callback exposes `metroOf`), WP9 (form upper-cases on blur and shows the message).
2. **A vendor timestamp in the future** (clock skew makes `providerObservedAt` or `fetchedAt` later than `now`). Expected: effective age clamps to 0 and the label says "just now", never a negative age or a crash in ordering. Owner: WP0 (`effectiveAge` clamps; test in Task 7 below), WP2 (ordering with clamped ages).
3. **The browser runs outside Europe/London.** Expected: every calendar day, departure and return is rendered from its `YYYY-MM-DD` string; a day never shifts by one. Owner: WP10 (test with `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo` on the calendar grid and the results date columns).
4. **The definition is edited while an execution is running** (airports or nights changed). Expected: the running execution keeps its snapshot; results filter to the current resolved space and may be empty; the header says "0 of N rows are inside the current window and nights range" rather than "no results". Owner: WP7 (snapshot is read once at start; a `PUT` during a run does not change the plan) and WP8 (`/results` reports the excluded count in `basisReason`).
5. **SQLite is busy or the disk is full during a tile write.** Expected: `busy_timeout=5000` absorbs contention; a persistent `SQLITE_FULL` or `SQLITE_BUSY` makes the execution `paused_error` with the SQLite message in `error_text` (URL-free) and an operator notification, never a crash loop. Owner: WP3 (`busy_timeout` pragma asserted), WP7 (a repository write that throws a `SqliteError` during a tile → `paused_error`, siblings aborted to `not_run`).

---

## Repository file map

Every file with one responsibility. Paths are relative to the repository root. `(WPn)` marks the work package that creates the file; later packages only add files of their own unless a brief says otherwise.

```
package.json                      workspace root: scripts (build, test, lint, dev, smoke:live, record:fixtures), engines, packageManager (WP0)
pnpm-workspace.yaml               packages/* and apps/*; onlyBuiltDependencies: [better-sqlite3] (WP0)
.npmrc                            strict-peer-dependencies=false, engine-strict=true (WP0)
tsconfig.base.json                strict, NodeNext, isolatedModules, noUncheckedIndexedAccess, exactOptionalPropertyTypes (WP0)
biome.json                        lint + format rules shared by every package (WP0)
vitest.config.ts                  root test.projects listing every package config (WP0)
.github/workflows/ci.yml          install → lint → typecheck → test with coverage → secret scan → Dockerfile assertion (WP0; WP12 adds the Docker build)
scripts/secret-scan.mjs           fails if any configured secret value or key-like token appears under fixtures/ (WP0)
scripts/backup.mjs                VACUUM INTO + integrity_check, refuses existing target (WP12)
.env.example                      every variable from spec §12 with its comment (WP0; WP12 finalises)
.gitignore                        .env*, data/, *.db*, backups/, node_modules/, dist/ (exists)
.dockerignore                     .env*, data/, fixtures/recorded/, node_modules/ (WP12)
Dockerfile                        multi-stage, node:22-slim by digest, NODE_ENV=production, IN_CONTAINER=1, USER node (WP12)
docker-compose.yml                app + mailpit (dev profile), named volume, 127.0.0.1:3000 (WP12)
docs/setup.md                     first-run path, example definition JSON (London → New York), backups, growth (WP12)
docs/api-limits.md                plan preset table, per-provider facts, reconciliation (WP12)
docs/scheduling.md                cron examples, cadence table, pausing (WP12)
docs/briefs/wpNN-<slug>.md        one brief per work package (this plan's companions)

packages/core/                    @gmt/core — pure; 100% coverage
  src/index.ts                    barrel of every public export (WP0, extended by WP1/WP2)
  src/types/ids.ts                Iata, IsoDate, IsoMonth, IsoDateTime brands and their zod schemas (WP0)
  src/types/provenance.ts         Provenance, SourceKind, Cabin, PointOfSale (WP0)
  src/types/definition.ts         SearchDefinition, WindowSpec, Constraints, VerificationPolicy, Budget, ProvidersConfig (WP0)
  src/types/execution.ts          ExecutionStatus, Stage, CellOutcomeStatus, CellOutcome, RollUp (WP0)
  src/types/itinerary.ts          NormalisedItinerary, Segment, Layover, Offer, Observation (WP0)
  src/ports/provider.ts           spec §5.1 verbatim: FlightProvider and friends (WP0)
  src/ports/budget.ts             BudgetGuard, BudgetScope, Usage, Reservation (WP0)
  src/ports/cache.ts              ResponseCache (WP0)
  src/ports/notifier.ts           Notifier, AlertDigest, OperatorMessage (WP0)
  src/ports/logger.ts             Logger (pino-shaped subset) (WP0)
  src/ports/clock.ts              Clock { now(): IsoDateTime; todayLondon(): IsoDate } (WP0)
  src/errors.ts                   ProviderError, BudgetExceeded, AbortedError, NormalisationError (WP0)
  src/config/secret.ts            Secret wrapper that never prints its value (WP0)
  src/config/presets.ts           PLAN_PRESETS: trial, 40usd, travelpayouts defaults (WP0)
  src/config/schema.ts            configSchema + parseConfig(env, { realpath }) (WP0)
  src/config/synthetic.ts         syntheticAllowed(config) (WP0)
  src/text/bannedWords.ts         BANNED_WORDS, findBannedWords(text, allowlist) (WP0)
  src/labels/age.ts               effectiveAge, formatAgeFull, formatAgeCompact (WP0)
  src/api-contract/common.ts      error envelope, pagination, provenance schema, money schemas (WP0)
  src/api-contract/definitions.ts definition create/update/read schemas, budgetFit, estimate, coverage-check (WP0)
  src/api-contract/executions.ts  execution read, start, cancel, resume, cells/verify (WP0)
  src/api-contract/results.ts     results row, calendar day, duration analysis, coverage, calendar-gap, cell detail, history (WP0)
  src/api-contract/alerts.ts      alert rule, alert event (WP0)
  src/api-contract/system.ts      health, providers, budget, scheduler jobs, tools (WP0)
  src/api-contract/index.ts       barrel + route table `ROUTES` (method, path, request, response) (WP0)
  src/dates/epochDay.ts           toEpochDay, fromEpochDay, addDays, daysBetween, isLeapYear helpers on IsoDate (WP1)
  src/space/window.ts             resolveWindow (WP1)
  src/space/generate.ts           generateCells, countCells (WP1)
  src/space/validate.ts           validateSearchSpace (WP1)
  src/coverage/rollUp.ts          rollUp(outcomes) precedence table, mergeWithinProvider (WP1)
  src/coverage/buckets.ts         sixBuckets(outcomes), selectedNotReached (WP1)
  src/selection/select.ts         selectCandidates(policy, cells, discoveryRollUps) (WP1)
  src/normalise/carrier.ts        canonical carrier / flight number (WP2)
  src/normalise/localTime.ts      departLocal via @date-fns/tz; nonexistent/ambiguous rules (WP2)
  src/normalise/hashing.ts        itineraryHash (WP2)
  src/normalise/money.ts          toGbp, Minor units, exponent table (WP2)
  src/normalise/timestamps.ts     toIsoDateTime from vendor forms; isIsoDateTime (WP2)
  src/normalise/vendorUrl.ts      validateVendorUrl(url, allowlist) → booking (WP2)
  src/normalise/itinerary.ts      normaliseOffer(raw, deps) → NormalisedItinerary + Offer (WP2)
  src/constraints/evaluate.ts     evaluateConstraints (WP2)
  src/constraints/verdictClass.ts verdictClass (WP2)
  src/results/dedup.ts            dedupByItinerary (WP2)
  src/results/rank.ts             rankRows, sortRows (WP2)
  src/results/filter.ts           filterRows (WP2)
  src/results/band.ts             bandCheapest(rows, hours) (WP2)
  src/alerts/evaluate.ts          evaluateAlertRules (WP2)
  src/alerts/dedup.ts             dedupKey, isSuppressed (WP2)
  src/alerts/digest.ts            buildDigest (WP2)
  test/**                         mirrors src; fixtures for hashing matrix etc.
  vitest.config.ts                thresholds 100/100/100 (WP0)
  stryker.config.json             mutate list from spec §9 (WP0)

packages/db/                      @gmt/db — better-sqlite3 + Drizzle
  src/index.ts                    barrel (WP0, extended by WP3)
  src/client.ts                   openDatabase(path): Db with WAL, busy_timeout, foreign_keys; sync transaction (WP0)
  src/migrate.ts                  applyMigrations(db, migrationsDir) idempotent (WP0)
  src/schema/*.ts                 one Drizzle table per spec §7 entity (WP3)
  drizzle/                        generated SQL migrations, committed (WP3)
  src/repositories/*.ts           one repository per aggregate (WP3; names in the contracts below)
  src/budgetGuard.ts              SqliteBudgetGuard (WP3)
  src/responseCache.ts            SqliteResponseCache (WP3)
  src/appLock.ts                  AppLock (WP3)
  src/seed/airports.ts            seedAirports(db, dataset) + sanity check (WP3)
  data/airports.<version>.json    vendored mwgg/Airports subset: iata, icao, name, city, country, tz, lat, lon, metro (WP3)
  src/maintenance.ts              runMaintenance(db, clock, log) (WP3)
  test/**
  vitest.config.ts                85/70 (WP0)

packages/providers/               @gmt/providers
  src/index.ts                    barrel (WP4)
  src/http/httpKit.ts             createHttpKit; pipeline cache→dedup→retry{limiter→reserve→fetch→finalise} (WP4)
  src/http/limiter.ts             bottleneck chained reservoirs per provider (WP4)
  src/http/cacheKey.ts            sha256 over the credential-free canonical request (WP4)
  src/http/scrub.ts               scrubSecrets(value, secrets), stripUrl(url) (WP4)
  src/http/egress.ts              hostname allowlist check, redirect: 'error' (WP4)
  src/http/classify.ts            default status → ProviderError mapping (spec §5.2 table) (WP4)
  src/http/recorder.ts            fixture recorder: placeholders, content hash, fails closed (WP4)
  src/fixture/provider.ts         FixtureProvider (HTTP adapter against http://fixture.local) (WP4)
  src/fixture/handlers.ts         msw handlers + a Hono router serving the same fixture tree (WP4)
  src/searchapi/provider.ts       SearchApiProvider (WP5)
  src/searchapi/calendar.ts       rectangle tiling + calendar parsing (WP5)
  src/searchapi/itinerary.ts      step 1→2→3 chain (WP5)
  src/searchapi/params.ts         dated parameter allowlist loader (WP5)
  src/travelpayouts/provider.ts   TravelpayoutsProvider (WP6)
  src/travelpayouts/tiles.ts      month tiling + row attribution (WP6)
  src/travelpayouts/params.ts     dated parameter allowlist loader (WP6)
  fixtures/recorded/<provider>/<endpoint>/<yyyy-mm-dd>-<sha>.json   recorded, redacted, hashed (WP4b)
  fixtures/recorded/<provider>/params-<date>.json                   dated parameter allowlists (WP4b)
  fixtures/synthetic/fixture/**   the fixture provider's tree, every file synthetic:true (WP4)
  test/**
  vitest.config.ts                85/70 (WP0)

packages/engine/                  @gmt/engine
  src/index.ts                    createEngine, parseCron (WP7)
  src/orchestrator.ts             execution lifecycle spec §8.1 (WP7)
  src/stages/discovery.ts         reuse → plan → tiles → write (WP7)
  src/stages/verification.ts      selection → cells → write (WP7)
  src/stages/reuse.ts             reuse query and copy (WP7)
  src/normalise.ts                spec §5.6 step over db repositories (WP7)
  src/estimate.ts                 estimate, estimateRemaining, budgetFit (WP7)
  src/resume.ts                   compare-and-set claim, departed cells, boot sweep (WP7)
  src/errors.ts                   error table spec §8.1 → outcome and execution transitions (WP7)
  src/scheduler/parseCron.ts      the single croner wrapper (WP7)
  src/scheduler/scheduler.ts      register/unregister/tick, one-shot resume jobs (WP7)
  src/fx/refresh.ts               frankfurter daily refresh through http-kit id 'fx' (WP7)
  src/notifiers/log.ts            LogNotifier (WP7)
  src/notifiers/email.ts          EmailNotifier (nodemailer) (WP11)
  src/alerts/runner.ts            evaluate → persist → digest → notify (WP11)
  src/alerts/templates.ts         plain-text subject/body (WP11)
  src/maintenance.ts              daily job wiring (WP7)
  test/**
  vitest.config.ts                85/70 (WP0)

apps/api/                         @gmt/api
  src/wiring.ts                   buildPorts(config, opts) (WP4b)
  src/bootstrap/app.ts            app bootstrap: env → config → ports → migrate → seed → lock → boot engine → serve (WP8)
  src/bootstrap/tool.ts           tool bootstrap: same ports, no sweep/cron, honours app_lock (WP4b; WP8 adds routes)
  src/tools/record.ts             record:fixtures (WP4b)
  src/tools/smoke.ts              smoke:live (WP13)
  src/app.ts                      createApp(ports): Hono (WP8)
  src/middleware/auth.ts          basic auth, rate limit, ALLOW_UNAUTHENTICATED (WP8)
  src/middleware/hardening.ts     Host/Origin/Content-Type/X-Requested-With checks (WP8)
  src/middleware/headers.ts       security headers (WP8)
  src/routes/*.ts                 one file per spec §10 row group (WP8)
  src/static.ts                   serveStatic SPA fallback (WP8)
  test/**
  vitest.config.ts                85/70 (WP0)

apps/web/                         @gmt/web — Vite + React
  src/main.tsx, src/App.tsx       shell, nav, definition selector, status bar (WP9)
  src/api/client.ts               typed fetch over core/api-contract (WP9)
  src/components/Provenance.tsx   badge + age + fx marker (WP9)
  src/components/StatusBar.tsx    (WP9)
  src/views/Definitions/*         form, coverage check, import example (WP9)
  src/views/Results/*             table, expanded row, filters (WP9)
  src/views/Coverage/*            View D (WP9)
  src/views/Calendar/*            View B (WP10)
  src/views/Duration/*            View C (WP10)
  src/views/History/*             (WP10)
  src/views/Alerts/*              (WP11)
  src/views/Providers/*           (WP9)
  test/**, e2e/smoke.spec.ts      Playwright smoke in fixture mode (WP10)
  vitest.config.ts                70/60 (WP0)
```

---

## Dispatch order and process

**Owners** (spec §16): Fable owns WP0, WP4b, WP13. Opus owns WP3, WP4, WP5, WP7. Sonnet owns WP1, WP2, WP6, WP8, WP9, WP10, WP11, WP12.

**Waves** (a wave starts when every dependency has merged to `main`):

| Wave | Packages | Parallel? |
|---|---|---|
| 0 | WP0 (Fable) | — |
| 1 | WP1, WP2 (Sonnet), WP3, WP4 (Opus) | yes, four worktrees |
| 2 | WP4b (Fable; needs 3, 4) | — |
| 3 | WP5 (Opus; 4, 4b), WP6 (Sonnet; 4, 4b), WP7 (Opus; 1, 2, 3, 4) | yes |
| 4 | WP8 (Sonnet; 4b, 7) | — |
| 5 | WP9 (Sonnet; 8), WP12 (Sonnet; 8) | yes |
| 6 | WP10 (Sonnet; 9) | — |
| 7 | WP11 (Sonnet; 7, 8, 10) | — |
| 8 | WP13 (Fable; all) | — |

**Before dispatch**, each brief is reviewed with `/review-spec docs/briefs/wpNN-<slug>.md --roster core`; Critical and High findings are fixed in the brief first. Briefs for later waves are re-reviewed when their wave opens, against the code that exists by then.

**Per work package:**

1. Fable creates a worktree and branch `wp/NN-<slug>` from `main` (`superpowers:using-git-worktrees`).
2. The implementer (Opus or Sonnet, per the brief's frontmatter) receives the brief path, the spec path and this plan path, and works task by task: failing test, run, implement, run, commit. Commit messages: `wpNN: <what>` and the attribution line from the repository's conventions.
3. Done means: every task's checkbox ticked; `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` green with the package thresholds; the brief's definition-of-done commands pass; no `process.env` outside `apps/api/src/bootstrap/`; no airport, city or country literal outside tests and docs that use the worked example.
4. Review gate: the project reviewers named in the brief (`code-architect`, `test-strategy-reviewer`, plus the package's specialist) read the diff; Fable reads the diff; findings are fixed on the branch; then Fable merges to `main` with `--no-ff`.
5. Interfaces in the contracts section are frozen once their package merges. A later package that needs a change opens it as a finding against this plan; Fable edits the plan and the contract in one commit.

**Execution method for WP0:** native (Fable implements it in-session, one reviewer at the end), because WP0 is the contract everything else imports and the mistakes that matter are consistency mistakes a single author avoids. Every later package is subagent-driven by the owner named above.

---

## Cross-package contracts

Everything below is `export`ed from the named file. Later packages consume these exact names. The spec's §5.1 block is reproduced in `packages/core/src/ports/provider.ts` without change and is not repeated here.

### Identifiers and dates (`@gmt/core` `types/ids.ts`, WP0)

```ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$, upper-case
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata>;          // z.string().regex(/^[A-Z]{3}$/) then brand
export const isoDateSchema: z.ZodType<IsoDate>;    // regex + real calendar date check (rejects 2027-02-29)
export const isoMonthSchema: z.ZodType<IsoMonth>;
export const isoDateTimeSchema: z.ZodType<IsoDateTime>; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ and Date.parse round-trips
export function asIata(s: string): Iata;           // throws on mismatch; used by tests and seeds, never on user input (zod does that)
export function asIsoDate(s: string): IsoDate;
export function asIsoDateTime(s: string): IsoDateTime;
```

### Provenance and shared enums (`types/provenance.ts`, WP0)

```ts
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = 'GB' | 'unknown';
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}
export const provenanceSchema: z.ZodType<Provenance>;
```

### Definition types (`types/definition.ts`, WP0)

```ts
export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
export interface Constraints {
  maxStops?: number; maxJourneyMinutes?: number; minLayoverMinutes?: number; maxLayoverMinutes?: number;
  noOvernightLayover?: boolean; departureWindowLocal?: { from: string; to: string }; arrivalWindowLocal?: { from: string; to: string };
  noSelfTransfer?: boolean; noAirportChange?: boolean; includeAirlines?: string[]; excludeAirlines?: string[];
  cabinBagRequired?: boolean; checkedBagRequired?: boolean; minCheckedBags?: number; maxPricePence?: number;
}
export interface VerificationPolicy { maxCells: number; topN: number; priceCeilingPence?: number; perDepartureDateBest?: number; alwaysInclude: CellKey[]; expandTop: number; bookingLinks: boolean; maxStops?: number }
export interface ExecutionBudget { maxCalls: number; maxFreeCalls: number; maxCostMicroGbp: number }
export interface ProvidersConfig { discovery: ProviderId[]; verification: ProviderId[]; discoveryRefreshHours: Partial<Record<ProviderId, number>> }
export interface SearchDefinition {
  id: string; name: string; origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights: number; maxNights: number;
  cabin: Cabin; constraints: Constraints; verification: VerificationPolicy; budget: ExecutionBudget; providers: ProvidersConfig;
  destinationNotes: Partial<Record<Iata, string>>; onwardCostPence: Partial<Record<Iata, number>>;
  scheduleCron: string | null; scheduleTz: string; confirmedCostPence: number | null; enabled: boolean;
  createdAt: IsoDateTime; updatedAt: IsoDateTime; deletedAt: IsoDateTime | null;
}
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean };
```

### Execution types (`types/execution.ts`, WP0)

```ts
export type ExecutionStatus = 'pending' | 'running' | 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled' | 'completed'
  | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed';
export const ACTIVE_STATUSES: readonly ExecutionStatus[] = ['pending', 'running', 'paused_budget', 'paused_error', 'interrupted'];
export const RESUMABLE_STATUSES: readonly ExecutionStatus[] = ['interrupted', 'paused_budget', 'paused_error', 'cancelled', 'completed'];
export type Stage = 'discovery' | 'verification';
export type CellOutcomeStatus = 'not_run' | 'priced' | 'empty' | 'no_data' | 'error' | 'skipped';
export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'departed';
export interface CellOutcome extends CellKey {
  executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null;
  attempts: number; lastError: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin | null; pointOfSale: PointOfSale | null; sourceKind: SourceKind | null; reusedFromExecutionId: string | null;
}
export type RollUpStatus = CellOutcomeStatus;   // NULL in the DB is represented as `null` in TS and 'not_applicable' in the API
export interface RollUp { status: RollUpStatus | null; reason: SkipReason | string | null; minPence: number | null }
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';
```

### Itinerary types (`types/itinerary.ts`, WP0)

As spec §6.3: `NormalisedItinerary`, `Segment` (`flightNumber: number`), `Layover = { at: Iata; minutes: number; overnight: boolean; airportChange: boolean }`, plus:

```ts
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }
export interface FareConditions { refundable?: boolean; changeable?: boolean; notes?: string[] }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Offer { itineraryHash: string; providerId: ProviderId; seller: string; cabin: Cabin }
export interface Observation {
  id: number; offerId: number; executionId: string; provenance: Provenance; pricePence: number; priceNativeMinor: number; currencyNative: string;
  taxesIncluded: boolean | null; selfTransfer: boolean | null; segmentCabins: Cabin[] | null; baggage: BaggageSnapshot | null;
  fareConditions: FareConditions | null; booking: Booking; bookingExpiresAt: IsoDateTime | null; suppliedFields: SuppliedField[]; partialExpansion: boolean;
}
export type Verdict = 'pass' | 'fail' | 'unverified';
export type ConstraintName = keyof Constraints | 'cabin';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
```

### Budget port (`ports/budget.ts`, WP0)

```ts
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
// Reservation and BudgetGuard exactly as spec §5.1.
```

### Logger and clock (`ports/logger.ts`, `ports/clock.ts`, WP0)

```ts
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export const systemClock: Clock;                       // Date.now() + Intl Europe/London
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };   // tests
```

### Errors (`errors.ts`, WP0)

`ProviderError`, `BudgetExceeded`, `AbortedError` exactly as spec §5.1, constructed as `new ProviderError({ kind, reason?, retryable, httpStatus?, retryAfterSeconds?, message })`, `new BudgetExceeded({ scope, cap, current, requested })`. Plus:

```ts
export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time';
export class NormalisationError extends Error { reason: NormalisationReason; detail?: string }
```

Error messages never contain a URL; the constructors strip anything matching `/https?:\/\/\S+/` to its origin + path.

### Config (`config/schema.ts`, `config/presets.ts`, `config/secret.ts`, `config/synthetic.ts`, WP0)

```ts
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export type PlanId = 'trial' | '40usd';
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const PLAN_PRESETS: Record<PlanId, ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number }>;
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits;   // cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0, fixed 0
export interface Config {
  nodeEnv: 'production' | 'development' | 'test'; databasePath: string; port: number; bindAddress: string; allowedHosts: string[];
  auth: { user: string; pass: Secret } | null; allowUnauthenticated: boolean; trustProxy: boolean; logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  pointOfSale: string; staleAfterHours: number; calendarStaleAfterHours: number | null; stuckAfterHours: number; maxCellsPerDefinition: number;
  schedulerTimezone: string; autoResume: boolean; maxAutoResumes: number; maxWaitSeconds: number; requestTimeoutSeconds: number;
  estimateRetryFactor: number; fxMaxRateAgeDays: number;
  spend: { monthlyCapMicroGbp: number; globalBillingDay: number; softConfirmMicroGbp: number; executionMaxCalls: number; executionMaxFreeCalls: number; executionMaxCostMicroGbp: number; childMaxCalls: number };
  providers: { travelpayouts: { token: Secret; limits: ProviderLimits } | null; searchapi: { key: Secret; plan: PlanId; trialUsed: number; limits: ProviderLimits } | null };
  smtp: { host: string; port: number; tls: 'implicit' | 'starttls' | 'none'; user: string; pass: Secret; to: string; from: string } | null;
  inContainer: boolean; allowFixtureProvider: string | null;
}
export interface ParseConfigOptions { realpath: (p: string) => string }   // injected so core stays pure; api passes fs.realpathSync (tolerating a missing file by resolving its directory)
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: Array<{ field: string; message: string }> };
export function parseConfig(env: Record<string, string | undefined>, opts: ParseConfigOptions): ConfigResult;
export function syntheticAllowed(c: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>): boolean;
```

Rules the schema enforces (all tested in WP0): empty string = unset; `*_PENCE` integers ≥ 0 converted to micro-GBP (× 10 000); billing days 1–28; `APP_BASIC_AUTH_*` both or neither, password ≥ 12; `SMTP_*` all or nothing, `none` only when host is loopback (the Mailpit profile sets host `mailpit`, which the schema allows only under `NODE_ENV=development`); `SEARCHAPI_PLAN` default `trial`; preset fills `monthlySpendCapMicroGbp`, `executionMaxCalls`, `executionMaxCostMicroGbp` unless the variable is set; `ALLOWED_HOSTS` default from `PORT` plus `localhost:5173` under development; `ALLOW_UNAUTHENTICATED=true` required when `bindAddress` is non-loopback and `auth` is null, else the result is an error naming both variables.

### Labels (`labels/age.ts`, WP0)

```ts
export type EffectiveAge = { kind: 'observed'; fetchedHours: number; observedHours: number } | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number } | { kind: 'unknown'; fetchedHours: number };
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;   // hours as non-negative numbers, clamped at 0
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown';   // observed → observedHours; bounded → fetched + max; unknown → 'unknown'
export function formatAgeFull(a: EffectiveAge): string;     // "fetched 2h ago · observed 3h ago" | "fetched 2h ago · provider age unknown (≤7d before that)" | "fetched 2h ago · provider age unknown"
export function formatAgeCompact(a: EffectiveAge): string;  // "2h ago · obs 3h" | "2h ago · ≤7d" | "2h ago · age unknown"
export function formatDuration(hours: number): string;      // "just now" (<1h), "2h", "3d", "2w" — hours rounded down; days from 48h; weeks from 14d
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;  // unknown loses to any known; otherwise by worst-case hours
```

### Banned words (`text/bannedWords.ts`, WP0)

```ts
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;  // word-boundary, case-insensitive; allowlist entries are exact phrases that may contain a banned word (e.g. "lives in")
```

### API contract (`api-contract/*.ts`, WP0)

Every schema is a zod object; every TypeScript type is `z.infer` of its schema. Request schemas end in `RequestSchema`, response schemas in `ResponseSchema`. The barrel exports `ROUTES`, a `const` array of `{ method, path, request?, response }` which WP8 uses to mount routes and WP9 to build the client. Shapes (each a full zod schema in the file; the fields are the contract):

- `common.ts`: `errorEnvelopeSchema` `{ error: { code: string; message: string; details?: unknown } }`; `provenanceSchema`; `moneyPenceSchema` (`z.number().int().min(0)`); `effectiveAgeSchema`; `priceCellSchema` `{ pricePence, provenance, stale: boolean, ageHours: number | 'unknown' }`.
- `definitions.ts`: `definitionCreateRequestSchema` (every `SearchDefinition` field except id/timestamps; `window` discriminated union; `bookingLinks` forced true when `providers.verification` includes `searchapi` via `superRefine`); `definitionResponseSchema` (`SearchDefinition` + `budgetFit: { fits: boolean; runsPerMonth: number; perScope: Array<{ scope: string; estimated: number; cap: number | null; fits: boolean }> }` + `estimate`); `estimateResponseSchema` `{ cells, perProvider: Array<{ providerId, stage, calls, costMicroGbp, costPence, seconds }>, totalCostMicroGbp, totalCostPence, seconds, assumptions: string[], windowClamped }`; `coverageCheckRequestSchema` `{ origins, destinations, window, minNights, maxNights }`; `coverageCheckResponseSchema` `{ pairs: Array<{ origin, destination, months: Array<{ month, cachedRows }> }>, calls, notes }`.
- `executions.ts`: `executionResponseSchema` `{ id, definitionId, isChild, cell?, status, stage, reason, resumeAfter, startedAt, finishedAt, progress: Array<{ stage, providerId, buckets: Buckets, total }>, budget: Array<{ scope, usage: Usage }>, estimate, ledger: { calls, costMicroGbp, costPence } }`; `startExecutionRequestSchema` `{ confirmCostPence?: number }`; `verifyCellRequestSchema` `{ definitionId, cell: CellKey }`.
- `results.ts`: `bucketsSchema` `{ priced, empty, no_data, error, skipped, not_run, reused }`; `resultRowSchema` `{ itineraryHash | null, basis, verdictClass: VerdictClass | 'unchecked', pricePence, provenance, stale, ageHours, cell: CellKey & { nights }, outbound: Segment[] | null, inbound: Segment[] | null, totalMinutes | null, stopsOut | null, stopsIn | null, carriers: string[], verdicts: Verdicts, unverified: ConstraintName[], notApplied: ConstraintName[], booking: Booking, searchLink: { url, host, label }, otherOffers: Array<{ seller, pricePence, provenance, booking }>, notSeenInLatest: { ageHours } | null, adjustedPence | null, destinationNote | null, bandCheapest: boolean }`; `resultsResponseSchema` `{ rows, total, truncated, basis, basisReason, executions: Array<{ id, status, ageHours }>, coverage: CoverageSummary, excludedByCurrentSpace: number }`; `calendarResponseSchema` (per day as spec §10); `durationAnalysisResponseSchema`; `coverageResponseSchema`; `calendarGapResponseSchema`; `cellDetailResponseSchema`; `historyResponseSchema`.
- `alerts.ts`: `alertRuleSchema` (spec §6.8 with the `requireAllVerified` refinement), `alertEventSchema`.
- `system.ts`: `healthPublicSchema` `{ ok, degraded }`, `healthDetailSchema`, `providersResponseSchema`, `budgetResponseSchema`, `schedulerJobsResponseSchema`, `toolRunResponseSchema`.
- `cronSchema`: `z.string().min(9).max(100).regex(/^[\d*\/,\-\s]+$/)` (bounded string only; semantic validation is `parseCron` in `engine`).

### Database (`@gmt/db`, WP0 skeleton, WP3 everything else)

```ts
// client.ts (WP0)
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T): T; close(): void }
export function openDatabase(path: string): Db;      // ':memory:' allowed; sets journal_mode=WAL (file only), busy_timeout=5000, foreign_keys=ON
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };   // migrate.ts (WP0), Drizzle migrator wrapped so a failure names the file
// repositories (WP3) — constructed as new XRepo(db, clock); all methods synchronous; every write that spans tables runs inside db.transaction
export class AirportsRepo { exists(iata): boolean; get(iata): Airport | null; search(q: string, limit): Airport[]; metroOf(iata): string | null; sharedMetro(iatas: Iata[]): string | null; count(): number; upsertAll(rows, datasetVersion): void }
export class FxRepo { rateNano(date: IsoDate, currency: string): number | null; latest(currency, maxAgeDays, today): { rateNano; date } | null; upsert(rows): void }
export class DefinitionsRepo { create(input): SearchDefinition; update(id, patch): SearchDefinition; get(id): SearchDefinition | null; list(): SearchDefinition[]; softDelete(id): void; setConfirmedCost(id, pence): void }
export class ExecutionsRepo { create(input): Execution; get(id): Execution | null; listForDefinition(id, opts): Execution[]; activeParent(definitionId): Execution | null; activeChild(definitionId, cell): Execution | null; latestCompleted(definitionId): Execution | null; claimResume(id): boolean /* compare-and-set */; setStatus(id, status, patch?): void; bootSweep(bootAt): { interrupted: string[] }; incrementAutoResume(id): number }
export class CellsRepo { seed(executionId, cells, discoveryProviders): void; seedVerification(executionId, selection, verificationProviders): void; outcomes(executionId, filter?): CellOutcome[]; resumable(executionId, stage, providerId, manual): CellKey[]; markDeparted(executionId, today): number; writeTile(executionId, providerId, result: TileWrite): void /* prices + outcomes + roll-ups atomically */; writeVerifiedCell(executionId, providerId, cell, write: VerifiedCellWrite): void; setOutcome(executionId, cell, stage, providerId, patch): void; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; selected(executionId): Array<CellKey & { reason: SelectionReason }> }
export class CalendarPricesRepo { insert(rows): void; latestPerCell(definitionId, cabin, space): CalendarPriceRow[]; reuseCandidates(definitionId, providerId, cabin, pointOfSale, sourceKind, cells, newerThan): Map<string, { outcome: CellOutcome; price: CalendarPriceRow | null }>; copyReused(executionId, rows): void; supersedeReused(executionId, providerId, cell): void; history(origin, destination, cabin): HistoryPoint[] }
export class ItinerariesRepo { upsertItinerary(it, segments): void; upsertOffer(offer): number; insertObservation(obs): number; observationsForDefinition(definitionId, executionIds, space, cabin): ObservationRow[]; offerHistory(hash): HistoryPoint[]; latestVerificationOutcomeForCell(definitionId, cell): CellOutcome | null }
export class LedgerRepo { countsFor(executionId): { calls: number; costMicroGbp: number; tiles: number; cacheHits: number }; overrun(executionId, planLength): boolean; sweepPending(olderThan): number; pruneCacheHits(olderThan, providerIds): number }
export class AlertsRepo { rules(definitionId?): AlertRule[]; create/update/delete; events(filter): AlertEvent[]; lastFiring(ruleId, dedupKey | identity, since): AlertEvent | null; insertEvent(e): number }
export class NotificationsRepo { wasSent(kind, executionId): boolean; record(kind, executionId, status): void }
export class RoutePriceHistoryRepo { upsert(rows): void; series(origin, destination, cabin, providerId): HistoryPoint[] }
export class SqliteBudgetGuard implements BudgetGuard { constructor(db, config: BudgetConfig, clock) }   // BudgetConfig = per-provider ProviderLimits + spend + which providers are billable + fixture cost rule
export class SqliteResponseCache implements ResponseCache { constructor(db, clock) }
export class AppLock { constructor(db, holder: 'app' | 'tool', clock, log); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void; static inspect(db): { holder; heartbeatAt; acquiredAt } | null }
export function seedAirports(db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };
export function sanityCheckAirports(db, referenced: Iata[]): { ok: true } | { ok: false; reason: string };
export function runMaintenance(db, clock, log, opts: { lifetimeProviders: ProviderId[] }): { cacheRowsDeleted: number; ledgerRowsPruned: number; dbBytes: number };
```

### http-kit (`@gmt/providers` `http/httpKit.ts`, WP4)

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
// Retries: p-retry max 3 attempts on retryable ProviderError only; per-request timeout is non-retryable when limits.billable === 'http-200'.
export interface FixtureRecorder { record(r: { providerId; endpointPath; request: HttpKitRequest; status; body }): Promise<void> }
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;       // deep; throws if a secret survives
export function stripUrl(url: string): string;                          // origin + path only
export function canonicalCacheKey(r: HttpKitRequest, secrets: Secret[]): string;   // sha256 hex
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>; costMicroGbp: number }): FlightProvider;  // throws unless syntheticAllowed
export function fixtureHandlers(root: string): RequestHandler[];        // msw handlers for http://fixture.local
export function fixtureRouter(root: string): Hono;                      // the same tree as a Hono router for fixture mode
```

Adapter constructors (WP5, WP6): `searchApiProvider({ http, log, clock, key: Secret, plan: PlanId, pointOfSale: string, paramsAllowlist })` and `travelpayoutsProvider({ http, log, clock, token: Secret, paramsAllowlist, airports: { sharedMetro(iatas): string | null } })`, both returning `FlightProvider`.

### Engine (`@gmt/engine`, WP7; alerts in WP11)

```ts
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export interface Repos { airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo; calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo; notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo }
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window'; message: string; details: unknown };
export interface Engine {
  boot(): Promise<void>;                 // sweep → auto-resume → one-shot jobs → cron
  shutdown(): Promise<void>;             // stop scheduler, abort, checkpoint
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
export function parseCron(expr: string, tz: string): { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };   // sub-hourly rejected
```

### Wiring and bootstraps (`apps/api`, WP4b and WP8)

```ts
// wiring.ts (WP4b)
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[] }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string }): Ports;   // opens DB, applies migrations, constructs guard/cache/http/providers (fixture only under syntheticAllowed)
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;   // parseConfig + realpath; throws with every field named on failure
// bootstrap/app.ts (WP8): main() — refuses NODE_ENV=test; buildPorts; seed; AppLock('app'); engine.boot(); serve
// bootstrap/tool.ts (WP4b): runTool(name: 'record' | 'smoke', args) — refuses NODE_ENV=test; buildPorts; AppLock('tool'); no engine.boot()
```

---

## WP0 — Scaffold, core contracts, db skeleton (Fable)

Brief: this section is the brief. Owner: Fable, executed natively. Depends on nothing. First failing test: the `syntheticAllowed` truth table.

Definition of done: `pnpm install` succeeds; `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` pass with `core` at 100% and the other packages at their thresholds (an empty package with a smoke test counts); CI workflow runs the same; every contract in the section above exists with the stated name and signature; `.env.example` lists every spec §12 variable.

### Task 0.1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.env.example`
- Create: `packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,test/smoke.test.ts}` and the same five files for `packages/db`, `packages/providers`, `packages/engine`, `apps/api`, `apps/web` (web's vitest config uses `environment: 'jsdom'`)

**Interfaces:**
- Produces: package names `@gmt/core`, `@gmt/db`, `@gmt/providers`, `@gmt/engine`, `@gmt/api`, `@gmt/web`; scripts `pnpm -r lint | typecheck | test | build`.

- [ ] **Step 1: Write the failing smoke tests**

`packages/core/test/smoke.test.ts` (and one per package, importing that package's own `src/index.ts`):

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('@gmt/core package', () => {
  it('exports a module', () => {
    expect(typeof core).toBe('object');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core test`
Expected: FAIL (no `package.json`, no `vitest`).

- [ ] **Step 3: Write the workspace files**

`package.json`:

```json
{
  "name": "get-me-there",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@12.9.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r --filter './packages/**' --filter './apps/**' build",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "mutate": "pnpm --filter @gmt/core mutate",
    "dev": "pnpm --parallel --filter @gmt/api --filter @gmt/web dev",
    "smoke:live": "pnpm --filter @gmt/api tool smoke",
    "record:fixtures": "pnpm --filter @gmt/api tool record",
    "secret-scan": "node scripts/secret-scan.mjs"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.15",
    "@vitest/coverage-v8": "5.0.4",
    "typescript": "5.9.3",
    "vitest": "5.0.4"
  }
}
```

`// why:` TypeScript is pinned at 5.9 rather than 7.0 until Biome, Vitest and Drizzle Kit declare 7.0 support; a brief that upgrades it must run the whole suite.

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - apps/*
onlyBuiltDependencies:
  - better-sqlite3
```

`.npmrc`:

```ini
engine-strict=true
strict-peer-dependencies=false
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "composite": true
  }
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "files": { "includes": ["**", "!**/dist", "!**/node_modules", "!**/coverage", "!**/drizzle/meta"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 110 },
  "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" }, "style": { "noNonNullAssertion": "error" } } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always", "trailingCommas": "all" } }
}
```

`vitest.config.ts` (root):

```ts
import { defineConfig } from 'vitest/config';

// why: one root config so `pnpm test` runs every package with its own thresholds.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

`packages/core/package.json` (the other packages differ only in `name`, `dependencies` and, for `@gmt/api`, the extra `dev` and `tool` scripts):

```json
{
  "name": "@gmt/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --coverage",
    "mutate": "stryker run"
  },
  "dependencies": { "@date-fns/tz": "1.5.0", "@noble/hashes": "2.4.0", "zod": "4.6.7" },
  "devDependencies": { "@stryker-mutator/core": "10.0.0", "@stryker-mutator/vitest-runner": "10.0.0", "fast-check": "4.10.2" }
}
```

Dependencies per package: `@gmt/db`: `@gmt/core`, `better-sqlite3@13.0.3`, `drizzle-orm@0.45.4`; dev `drizzle-kit@0.31.11`, `@types/better-sqlite3@9.6.0`. `@gmt/providers`: `@gmt/core`, `bottleneck@2.19.5`, `p-retry@8.0.1`, `hono@4.13.13`; dev `msw@3.0.3`. `@gmt/engine`: `@gmt/core`, `@gmt/db`, `@gmt/providers`, `croner@10.0.1`, `nodemailer@10.1.1`, `pino@10.4.0`; dev `@types/nodemailer@8.0.2`. `@gmt/api`: all four, `hono@4.13.13`, `@hono/node-server@2.1.5`, `@hono/zod-validator@0.9.1`, `pino@10.4.0`; dev `tsx@4.23.15`, `pino-pretty@13.2.0`. `@gmt/web`: `@gmt/core`, `react@19.3.1`, `react-dom@19.3.1`, `@tanstack/react-query@5.104.2`, `@tanstack/react-table@9.3.1`, `recharts@3.10.1`, `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`; dev `vite@8.3.4`, `@vitejs/plugin-react@6.1.2`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `jsdom@30.1.2`, `@testing-library/react@16.3.3`, `@testing-library/jest-dom@7.0.1`, `@testing-library/user-event@14.6.8`, `@playwright/test@1.64.1`. Workspace packages use `"workspace:*"`. Root dev: `@types/node@26.6.5`.

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
```

Thresholds for the other packages: `db`, `providers`, `engine`, `api` `{ lines: 85, branches: 70, functions: 85, statements: 85 }`; `web` `{ lines: 70, branches: 60, functions: 70, statements: 70 }` with `environment: 'jsdom'` and `setupFiles: ['test/setup.ts']` importing `@testing-library/jest-dom/vitest`.

`packages/core/src/index.ts` starts as:

```ts
// Barrel for @gmt/core. Every public export of the package is re-exported from here;
// consumers never deep-import. Extended by WP1 and WP2.
export {};
```

`.env.example`: the full spec §12 block, verbatim, one variable per line with its comment.

- [ ] **Step 4: Install and run**

Run: `pnpm install && pnpm -r typecheck && pnpm test`
Expected: six smoke tests PASS; coverage reports 100% for `core` (only `index.ts`, excluded) and no threshold failures elsewhere (empty `src/` yields no files, which Vitest treats as pass; `coverage.include` must be present so an empty include set does not fail).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "wp0: workspace scaffold with six packages, Biome, Vitest thresholds"
```

### Task 0.2: `syntheticAllowed` (first failing test)

**Files:**
- Create: `packages/core/src/config/synthetic.ts`, `packages/core/test/config/synthetic.test.ts`

**Interfaces:**
- Produces: `syntheticAllowed(c: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>): boolean` and the type `SyntheticGateInput` for that pick.

- [ ] **Step 1: Write the failing truth table**

```ts
import { describe, expect, it } from 'vitest';
import { syntheticAllowed } from '../../src/config/synthetic.js';

const base = { nodeEnv: 'production', databasePath: '/data/get-me-there.db', allowFixtureProvider: null, inContainer: true } as const;

describe('syntheticAllowed (spec §5.5)', () => {
  it.each([
    // nodeEnv, databasePath, allowFixtureProvider, inContainer, expected
    ['test', ':memory:', null, false, true],
    ['test', '/tmp/x.test.db', null, false, true],
    ['test', '/tmp/x.test.db', null, true, true], // container does not matter for the test branch
    ['test', '/tmp/x.db', null, false, false], // wrong suffix
    ['test', '/tmp/x.test.db/../prod.db', null, false, false], // traversal: path is realpath-resolved before here, so a non-suffix path fails
    ['development', '/tmp/x.fixture.db', 'i-understand-this-is-fake', false, true],
    ['development', '/tmp/x.fixture.db', 'i-understand-this-is-fake', true, false], // in container
    ['development', '/tmp/x.fixture.db', 'yes', false, false], // wrong phrase
    ['development', '/tmp/x.db', 'i-understand-this-is-fake', false, false], // wrong suffix
    ['production', '/tmp/x.fixture.db', 'i-understand-this-is-fake', false, false],
    ['production', ':memory:', null, false, false],
    ['production', '/data/get-me-there.db', null, true, false],
  ] as const)('%s %s %s container=%s → %s', (nodeEnv, databasePath, allowFixtureProvider, inContainer, expected) => {
    expect(syntheticAllowed({ ...base, nodeEnv, databasePath, allowFixtureProvider, inContainer })).toBe(expected);
  });

  it('is false when the path merely contains the suffix elsewhere', () => {
    expect(syntheticAllowed({ ...base, nodeEnv: 'test', databasePath: '/tmp/a.test.db.bak', inContainer: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core test -- synthetic`
Expected: FAIL, "Cannot find module '../../src/config/synthetic.js'".

- [ ] **Step 3: Implement**

```ts
/**
 * The single gate behind which synthetic (fixture) data may exist. Spec §5.5.
 *
 * Two branches only:
 *  - tests: NODE_ENV=test with an in-memory DB or a file ending in `.test.db`;
 *  - local development: the exact opt-in phrase, NODE_ENV=development, not inside the
 *    container, and a DB file ending in `.fixture.db`.
 *
 * `databasePath` must already be realpath-resolved by the caller (the api bootstrap does
 * this) so symlinks and `..` cannot smuggle a production file through the suffix check.
 */
export interface SyntheticGateInput {
  nodeEnv: 'production' | 'development' | 'test';
  databasePath: string;
  allowFixtureProvider: string | null;
  inContainer: boolean;
}

export const FIXTURE_OPT_IN_PHRASE = 'i-understand-this-is-fake';

export function syntheticAllowed(c: SyntheticGateInput): boolean {
  if (c.nodeEnv === 'test') {
    return c.databasePath === ':memory:' || c.databasePath.endsWith('.test.db');
  }
  if (c.nodeEnv === 'development') {
    return (
      c.allowFixtureProvider === FIXTURE_OPT_IN_PHRASE && !c.inContainer && c.databasePath.endsWith('.fixture.db')
    );
  }
  return false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test -- synthetic`
Expected: PASS, 13 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp0: syntheticAllowed gate with truth table"
```

### Task 0.3: Branded identifiers and date schemas

**Files:**
- Create: `packages/core/src/types/ids.ts`, `packages/core/test/types/ids.test.ts`

**Interfaces:**
- Produces: the contract block "Identifiers and dates" above.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { asIsoDate, iataSchema, isoDateSchema, isoDateTimeSchema, isoMonthSchema } from '../../src/types/ids.js';

describe('iataSchema', () => {
  it('accepts three upper-case letters', () => expect(iataSchema.safeParse('LHR').success).toBe(true));
  it.each(['lhr', 'LHRX', 'LH', '12A', ''])('rejects %j', (v) => expect(iataSchema.safeParse(v).success).toBe(false));
});

describe('isoDateSchema', () => {
  it('accepts a real date', () => expect(isoDateSchema.safeParse('2028-02-29').success).toBe(true));
  it.each(['2027-02-29', '2026-13-01', '2026-04-31', '2026-1-1', '20261001', '2026-10-01T00:00:00.000Z'])('rejects %j', (v) =>
    expect(isoDateSchema.safeParse(v).success).toBe(false),
  );
  it('asIsoDate throws on a bad value', () => expect(() => asIsoDate('2027-02-29')).toThrow());
});

describe('isoMonthSchema', () => {
  it('accepts YYYY-MM', () => expect(isoMonthSchema.safeParse('2026-11').success).toBe(true));
  it('rejects month 13', () => expect(isoMonthSchema.safeParse('2026-13').success).toBe(false));
});

describe('isoDateTimeSchema', () => {
  it('accepts the toISOString form only', () => {
    expect(isoDateTimeSchema.safeParse('2026-10-14T15:00:00.000Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-10-14T15:00:00Z').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-10-14T15:00:00.000+01:00').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-02-30T15:00:00.000Z').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core test -- ids`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod';

/** Upper-case IATA airport code. Spec §6.1: format `^[A-Z]{3}$`; existence is checked separately. */
export type Iata = string & { readonly __brand: 'Iata' };
/** Calendar date `YYYY-MM-DD`, independent of any timezone. Spec §6.1. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };
/** Calendar month `YYYY-MM`. Used by Travelpayouts month tiles. */
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };
/** Instant in `Date#toISOString()` form only. Spec §6.3. */
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True when y-m-d is a real calendar date (rejects 2027-02-29, 2026-04-31). Pure arithmetic, no Date. */
export function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
  return d <= days;
}

export const iataSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'IATA code must be three upper-case letters')
  .transform((s) => s as Iata);

export const isoDateSchema = z
  .string()
  .refine((s) => {
    const m = DATE_RE.exec(s);
    return m !== null && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }, 'date must be a real YYYY-MM-DD')
  .transform((s) => s as IsoDate);

export const isoMonthSchema = z
  .string()
  .refine((s) => {
    const m = MONTH_RE.exec(s);
    return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
  }, 'month must be YYYY-MM')
  .transform((s) => s as IsoMonth);

export const isoDateTimeSchema = z
  .string()
  .refine((s) => DATETIME_RE.test(s) && new Date(s).toISOString() === s, 'timestamp must be Date#toISOString() form')
  .transform((s) => s as IsoDateTime);

function must<T>(schema: z.ZodType<T>, value: string, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`${what}: ${value}`);
  return r.data;
}
/** Test and seed helper; user input goes through zod. */
export const asIata = (s: string): Iata => must(iataSchema, s, 'not an IATA code');
export const asIsoDate = (s: string): IsoDate => must(isoDateSchema, s, 'not an ISO date');
export const asIsoMonth = (s: string): IsoMonth => must(isoMonthSchema, s, 'not an ISO month');
export const asIsoDateTime = (s: string): IsoDateTime => must(isoDateTimeSchema, s, 'not an ISO timestamp');
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test -- ids`
Expected: PASS; `isRealDate` branches covered by the `it.each` rows (add `['2026-00-10']` and `['2026-10-00']` rows if the branch report shows a gap).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp0: branded ids and date schemas"
```

### Task 0.4: Domain types, ports and errors

**Files:**
- Create: `packages/core/src/types/provenance.ts`, `types/definition.ts`, `types/execution.ts`, `types/itinerary.ts`, `ports/provider.ts`, `ports/budget.ts`, `ports/cache.ts`, `ports/notifier.ts`, `ports/logger.ts`, `ports/clock.ts`, `errors.ts`
- Test: `packages/core/test/errors.test.ts`, `packages/core/test/ports/clock.test.ts`, `packages/core/test/types/provenance.test.ts`

**Interfaces:**
- Produces: every type in the contract blocks "Provenance", "Definition types", "Execution types", "Itinerary types", "Budget port", "Logger and clock", "Errors", and spec §5.1 verbatim in `ports/provider.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/errors.test.ts
import { describe, expect, it } from 'vitest';
import { AbortedError, BudgetExceeded, NormalisationError, ProviderError } from '../src/errors.js';

describe('ProviderError', () => {
  it('carries kind, retryable and status', () => {
    const e = new ProviderError({ kind: 'rate-limit', retryable: true, httpStatus: 429, retryAfterSeconds: 30, message: 'slow down' });
    expect(e.kind).toBe('rate-limit');
    expect(e.retryable).toBe(true);
    expect(e.httpStatus).toBe(429);
    expect(e.retryAfterSeconds).toBe(30);
    expect(e).toBeInstanceOf(Error);
  });
  it('never keeps a URL query or userinfo in its message (spec §5.3)', () => {
    const e = new ProviderError({ kind: 'upstream', retryable: false, message: 'GET https://user:pw@api.example.com/v1/x?api_key=SECRET failed' });
    expect(e.message).toBe('GET https://api.example.com/v1/x failed');
    expect(e.message).not.toContain('SECRET');
    expect(e.message).not.toContain('pw@');
  });
});

describe('BudgetExceeded', () => {
  it('names scope and numbers', () => {
    const e = new BudgetExceeded({ scope: 'global-month', cap: 35_000_000, current: 34_000_000, requested: 3_200_000 });
    expect(e.scope).toBe('global-month');
    expect(e.message).toContain('global-month');
    expect(e.message).toContain('35000000');
  });
});

describe('NormalisationError / AbortedError', () => {
  it('construct', () => {
    expect(new NormalisationError('fx-unavailable', 'CNY 2026-10-14').reason).toBe('fx-unavailable');
    expect(new AbortedError().name).toBe('AbortedError');
  });
});
```

```ts
// test/ports/clock.test.ts
import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from '../../src/ports/clock.js';

describe('clock', () => {
  it('fixedClock returns the instant and advances', () => {
    const c = fixedClock('2026-10-14T23:30:00.000Z' as never);
    expect(c.now()).toBe('2026-10-14T23:30:00.000Z');
    expect(c.todayLondon()).toBe('2026-10-15'); // BST: 23:30Z is 00:30 the next day in London
    c.advance(3_600_000);
    expect(c.now()).toBe('2026-10-15T00:30:00.000Z');
  });
  it('todayLondon in winter equals the UTC date', () => {
    expect(fixedClock('2026-12-01T23:30:00.000Z' as never).todayLondon()).toBe('2026-12-01');
  });
  it('systemClock produces the toISOString form', () => {
    expect(systemClock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
```

```ts
// test/types/provenance.test.ts
import { describe, expect, it } from 'vitest';
import { provenanceSchema } from '../../src/types/provenance.js';

const good = { providerId: 'searchapi', sourceKind: 'scraped-aggregate', fetchedAt: '2026-10-14T15:00:00.000Z', maxAgeHours: 24, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' };

describe('provenanceSchema', () => {
  it('accepts a complete provenance', () => expect(provenanceSchema.safeParse(good).success).toBe(true));
  it("accepts maxAgeHours 'unknown'", () => expect(provenanceSchema.safeParse({ ...good, maxAgeHours: 'unknown' }).success).toBe(true));
  it('rejects a missing fetchedAt (nothing is defaulted)', () => {
    const { fetchedAt: _omit, ...rest } = good;
    expect(provenanceSchema.safeParse(rest).success).toBe(false);
  });
  it('requires rate, date and source when converted', () => {
    expect(provenanceSchema.safeParse({ ...good, fx: { converted: true, rateNano: 110_000_000, rateDate: '2026-10-14' } }).success).toBe(false);
    expect(provenanceSchema.safeParse({ ...good, fx: { converted: true, rateNano: 110_000_000, rateDate: '2026-10-14', source: 'frankfurter' } }).success).toBe(true);
  });
  it('rejects a non-integer rateNano', () => {
    expect(provenanceSchema.safeParse({ ...good, fx: { converted: true, rateNano: 1.5, rateDate: '2026-10-14', source: 'x' } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/errors.ts`:

```ts
import type { ProviderId } from './ports/provider.js';

/** Strip query string and userinfo from every URL inside a message. Spec §5.3: no sink ever holds a full URL. */
export function stripUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s)'"]+/g, (raw) => {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return '<url>';
    }
  });
}

export type ProviderErrorKind = 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout';

/** Spec §5.1. Thrown by http-kit (classified) and adapters (parse); never retried at adapter level. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly reason: string | undefined;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly providerId: ProviderId | 'fx' | undefined;
  constructor(p: { kind: ProviderErrorKind; retryable: boolean; message: string; reason?: string; httpStatus?: number; retryAfterSeconds?: number; providerId?: ProviderId | 'fx' }) {
    super(stripUrlsInText(p.message));
    this.name = 'ProviderError';
    this.kind = p.kind;
    this.reason = p.reason;
    this.retryable = p.retryable;
    this.httpStatus = p.httpStatus;
    this.retryAfterSeconds = p.retryAfterSeconds;
    this.providerId = p.providerId;
  }
}

export type BudgetScopeKind = 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-month' | 'provider-lifetime' | 'global-month';

/** Spec §5.1. Raised by BudgetGuard.reserve before any fetch; never recorded as a cell `error`. */
export class BudgetExceeded extends Error {
  readonly scope: BudgetScopeKind;
  readonly cap: number;
  readonly current: number;
  readonly requested: number;
  readonly providerId: ProviderId | undefined;
  constructor(p: { scope: BudgetScopeKind; cap: number; current: number; requested: number; providerId?: ProviderId }) {
    super(`budget exceeded: ${p.scope} cap ${p.cap}, current ${p.current}, requested ${p.requested}${p.providerId ? ` (${p.providerId})` : ''}`);
    this.name = 'BudgetExceeded';
    this.scope = p.scope;
    this.cap = p.cap;
    this.current = p.current;
    this.requested = p.requested;
    this.providerId = p.providerId;
  }
}

/** Spec §5.1. Cancel or SIGTERM; the cell returns to `not_run`. */
export class AbortedError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortedError';
  }
}

export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time';

/** Spec §5.6. An offer that cannot be normalised is dropped and counted; never guessed. */
export class NormalisationError extends Error {
  readonly reason: NormalisationReason;
  readonly detail: string | undefined;
  constructor(reason: NormalisationReason, detail?: string) {
    super(detail ? `${reason}: ${stripUrlsInText(detail)}` : reason);
    this.name = 'NormalisationError';
    this.reason = reason;
    this.detail = detail;
  }
}
```

`src/ports/clock.ts`:

```ts
import type { IsoDate, IsoDateTime } from '../types/ids.js';

/** Injected everywhere time is read, so tests pin instants. Spec §6.1: dates resolve in Europe/London. */
export interface Clock {
  now(): IsoDateTime;
  todayLondon(): IsoDate;
}

const londonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date in Europe/London for an instant. `en-CA` formats as YYYY-MM-DD. */
export function londonDateOf(instant: IsoDateTime): IsoDate {
  return londonDate.format(new Date(instant)) as IsoDate;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString() as IsoDateTime,
  todayLondon: () => londonDateOf(new Date().toISOString() as IsoDateTime),
};

export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void } {
  let current = new Date(at).getTime();
  return {
    now: () => new Date(current).toISOString() as IsoDateTime,
    todayLondon: () => londonDateOf(new Date(current).toISOString() as IsoDateTime),
    advance: (ms) => {
      current += ms;
    },
    set: (next) => {
      current = new Date(next).getTime();
    },
  };
}
```

`src/types/provenance.ts`:

```ts
import { z } from 'zod';
import type { ProviderId } from '../ports/provider.js';
import { type IsoDate, type IsoDateTime, isoDateSchema, isoDateTimeSchema } from './ids.js';

export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = 'GB' | 'unknown';
export const sourceKindSchema = z.enum(['authorised-cached', 'scraped-aggregate', 'scraped-search', 'synthetic']);
export const cabinSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);
export const pointOfSaleSchema = z.enum(['GB', 'unknown']);
export const providerIdSchema = z.enum(['travelpayouts', 'searchapi', 'fixture']);

/** Spec §3 "Provenance". `rateNano` = GBP per 1 native unit × 1e9 (spec §6.3). */
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export const fxInfoSchema: z.ZodType<FxInfo> = z.discriminatedUnion('converted', [
  z.object({ converted: z.literal(false) }),
  z.object({ converted: z.literal(true), rateNano: z.number().int().positive(), rateDate: isoDateSchema, source: z.string().min(1) }),
]);

export interface Provenance {
  providerId: ProviderId;
  sourceKind: SourceKind;
  fetchedAt: IsoDateTime;
  providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown';
  fx: FxInfo;
  pointOfSale: PointOfSale;
  cabin: Cabin;
}

export const provenanceSchema: z.ZodType<Provenance> = z.object({
  providerId: providerIdSchema,
  sourceKind: sourceKindSchema,
  fetchedAt: isoDateTimeSchema,
  providerObservedAt: isoDateTimeSchema.optional(),
  maxAgeHours: z.union([z.number().int().min(0), z.literal('unknown')]),
  fx: fxInfoSchema,
  pointOfSale: pointOfSaleSchema,
  cabin: cabinSchema,
});
```

`src/ports/provider.ts`: the spec §5.1 block verbatim, with `import type` lines for `Iata`, `IsoDate`, `IsoMonth`, `IsoDateTime`, `Cabin`, `SuppliedField`, `BaggageSnapshot`, `FareConditions`, `BudgetScope`, `Usage`, `AlertDigest`, `OperatorMessage`, and the three error classes re-exported from `../errors.js` (the spec declares them in the same block; they live in `errors.ts` so `providers` can import them without the port types).

`src/ports/budget.ts`, `ports/cache.ts`, `ports/notifier.ts`, `ports/logger.ts`: the contract blocks above. `AlertDigest = { ruleId: string; definitionId: string; executionId: string; basis: 'verified' | 'calendar'; subject: string; body: string; items: DigestItem[]; restCount: number }`; `OperatorMessage = { kind: 'paused_budget' | 'paused_error' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed' | 'interrupted' | 'provider_disabled' | 'parity_break' | 'alerts_calendar_only'; executionId: string | null; definitionId: string; subject: string; body: string }`.

`src/types/definition.ts`, `types/execution.ts`, `types/itinerary.ts`: the contract blocks above, each with a doc comment naming its spec section.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test && pnpm --filter @gmt/core typecheck`
Expected: PASS; coverage 100% (type-only files produce no coverage entries; `errors.ts`, `clock.ts` and `provenance.ts` are fully exercised).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp0: domain types, ports and errors (spec §3, §5.1, §6.3)"
```

### Task 0.5: Config schema, presets and `Secret`

**Files:**
- Create: `packages/core/src/config/secret.ts`, `config/presets.ts`, `config/schema.ts`
- Test: `packages/core/test/config/secret.test.ts`, `test/config/schema.test.ts`

**Interfaces:**
- Produces: the "Config" contract block.

- [ ] **Step 1: Write the failing tests**

```ts
// test/config/secret.test.ts
import { describe, expect, it } from 'vitest';
import { Secret } from '../../src/config/secret.js';

describe('Secret', () => {
  const s = new Secret('hunter2hunter2');
  it('reveals on request only', () => expect(s.reveal()).toBe('hunter2hunter2'));
  it('prints redacted', () => {
    expect(String(s)).toBe('[redacted]');
    expect(`${s}`).toBe('[redacted]');
    expect(JSON.stringify({ s })).toBe('{"s":"[redacted]"}');
    expect(Object.keys(s)).toEqual([]); // value is not an enumerable property
  });
});
```

```ts
// test/config/schema.test.ts
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/schema.js';

const realpath = (p: string) => p;
const minimal = { NODE_ENV: 'production', DATABASE_PATH: '/data/get-me-there.db', APP_BASIC_AUTH_USER: 'ian', APP_BASIC_AUTH_PASS: 'correct-horse-battery', IN_CONTAINER: '1' };

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

describe('parseConfig (spec §12)', () => {
  it('parses the minimal production config with defaults', () => {
    const c = ok(minimal);
    expect(c.port).toBe(3000);
    expect(c.bindAddress).toBe('0.0.0.0');
    expect(c.allowedHosts).toEqual(['localhost:3000', '127.0.0.1:3000']);
    expect(c.spend.monthlyCapMicroGbp).toBe(0); // no billed provider → 0
    expect(c.spend.executionMaxFreeCalls).toBe(2000);
    expect(c.spend.softConfirmMicroGbp).toBe(1_000_000);
    expect(c.staleAfterHours).toBe(192);
    expect(c.providers.searchapi).toBeNull();
    expect(c.providers.travelpayouts).toBeNull();
    expect(c.smtp).toBeNull();
    expect(c.inContainer).toBe(true);
  });
  it('treats empty strings as unset', () => {
    expect(ok({ ...minimal, SEARCHAPI_KEY: '', SMTP_HOST: '' }).providers.searchapi).toBeNull();
  });
  it('requires both auth vars or neither, password ≥ 12', () => {
    expect(errors({ ...minimal, APP_BASIC_AUTH_PASS: undefined })).toContain('APP_BASIC_AUTH_PASS');
    expect(errors({ ...minimal, APP_BASIC_AUTH_PASS: 'short' })).toContain('APP_BASIC_AUTH_PASS');
  });
  it('refuses unauthenticated on a non-loopback bind unless ALLOW_UNAUTHENTICATED=true', () => {
    const noAuth = { ...minimal, APP_BASIC_AUTH_USER: undefined, APP_BASIC_AUTH_PASS: undefined };
    expect(errors(noAuth)).toEqual(expect.arrayContaining(['BIND_ADDRESS', 'ALLOW_UNAUTHENTICATED']));
    expect(ok({ ...noAuth, ALLOW_UNAUTHENTICATED: 'true' }).auth).toBeNull();
    expect(ok({ ...noAuth, BIND_ADDRESS: '127.0.0.1' }).auth).toBeNull();
  });
  it('fills the 40usd preset and lets variables override', () => {
    const c = ok({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_PLAN: '40usd' });
    expect(c.providers.searchapi?.limits).toMatchObject({ monthlyCallCap: 10_000, window: 'month', ratePerHour: 2000, ratePerMinute: 10, concurrency: 2, costPerCallMicroGbp: 0, planFixedMicroGbp: 32_000_000, excludedFromSchedule: false });
    expect(c.spend.monthlyCapMicroGbp).toBe(35_000_000);
    expect(c.spend.executionMaxCalls).toBe(2000);
    expect(c.spend.executionMaxCostMicroGbp).toBe(0);
    const o = ok({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_PLAN: '40usd', MONTHLY_SPEND_CAP_PENCE: '3000', SEARCHAPI_MONTHLY_CALL_CAP: '5000' });
    expect(o.spend.monthlyCapMicroGbp).toBe(30_000_000);
    expect(o.providers.searchapi?.limits.monthlyCallCap).toBe(5000);
  });
  it('trial is the default plan: lifetime window, excluded from schedule, trialUsed seeded', () => {
    const c = ok({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_TRIAL_USED: '9' });
    expect(c.providers.searchapi?.plan).toBe('trial');
    expect(c.providers.searchapi?.limits).toMatchObject({ monthlyCallCap: 100, window: 'lifetime', excludedFromSchedule: true, ratePerHour: 20, ratePerMinute: 2, concurrency: 1 });
    expect(c.providers.searchapi?.trialUsed).toBe(9);
    expect(c.spend.executionMaxCalls).toBe(0);
  });
  it('rejects non-integer pence and billing days outside 1–28', () => {
    expect(errors({ ...minimal, MONTHLY_SPEND_CAP_PENCE: '12.5' })).toContain('MONTHLY_SPEND_CAP_PENCE');
    expect(errors({ ...minimal, GLOBAL_BILLING_DAY: '29' })).toContain('GLOBAL_BILLING_DAY');
    expect(errors({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_BILLING_DAY: '0' })).toContain('SEARCHAPI_BILLING_DAY');
  });
  it('SMTP is all or nothing; tls none only on loopback or the dev mailpit host', () => {
    const smtp = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', ALERT_EMAIL_TO: 'a@b.c', ALERT_EMAIL_FROM: 'x@b.c' };
    expect(ok({ ...minimal, ...smtp }).smtp?.tls).toBe('implicit');
    expect(errors({ ...minimal, ...smtp, SMTP_PASS: undefined })).toContain('SMTP_PASS');
    expect(errors({ ...minimal, ...smtp, SMTP_TLS: 'none' })).toContain('SMTP_TLS');
    expect(ok({ ...minimal, ...smtp, SMTP_HOST: '127.0.0.1', SMTP_TLS: 'none' }).smtp?.tls).toBe('none');
    expect(ok({ ...minimal, NODE_ENV: 'development', IN_CONTAINER: undefined, ...smtp, SMTP_HOST: 'mailpit', SMTP_TLS: 'none' }).smtp?.tls).toBe('none');
    expect(errors({ ...minimal, ...smtp, SMTP_HOST: 'mailpit', SMTP_TLS: 'none' })).toContain('SMTP_TLS');
  });
  it('realpath-resolves the database path and keeps :memory: as is', () => {
    const c = ok({ ...minimal, DATABASE_PATH: '/data/link.db' });
    expect(parseConfig({ ...minimal, DATABASE_PATH: '/data/link.db' }, { realpath: () => '/real/get-me-there.db' })).toMatchObject({ ok: true, config: { databasePath: '/real/get-me-there.db' } });
    expect(c.databasePath).toBe('/data/link.db');
    expect(ok({ ...minimal, NODE_ENV: 'test', DATABASE_PATH: ':memory:', IN_CONTAINER: undefined }).databasePath).toBe(':memory:');
  });
  it('adds the Vite origin to ALLOWED_HOSTS under development', () => {
    expect(ok({ ...minimal, NODE_ENV: 'development', IN_CONTAINER: undefined }).allowedHosts).toContain('localhost:5173');
  });
  it('names every bad field at once', () => {
    expect(errors({ ...minimal, PORT: 'abc', LOG_LEVEL: 'loud' })).toEqual(expect.arrayContaining(['PORT', 'LOG_LEVEL']));
  });
  it('wraps secrets', () => {
    const c = ok({ ...minimal, TRAVELPAYOUTS_TOKEN: 't'.repeat(32) });
    expect(String(c.providers.travelpayouts?.token)).toBe('[redacted]');
    expect(c.providers.travelpayouts?.token.reveal()).toBe('t'.repeat(32));
    expect(JSON.stringify(c)).not.toContain('tttt');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core test -- config`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/config/secret.ts`:

```ts
/**
 * A credential that cannot be printed by accident. The value lives in a closure, not a
 * property, so `JSON.stringify`, `console.log`, `Object.keys` and pino serialisation all see
 * `[redacted]`. Call `reveal()` at the one place the header is built. Spec §5.3.
 */
export class Secret {
  readonly reveal: () => string;
  constructor(value: string) {
    this.reveal = () => value;
    Object.defineProperty(this, 'reveal', { enumerable: false, value: () => value });
  }
  toString(): string {
    return '[redacted]';
  }
  toJSON(): string {
    return '[redacted]';
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]';
  }
}
```

`src/config/presets.ts`:

```ts
/** Plan presets from spec §12 and docs/api-limits.md. Money in micro-GBP; pence × 10 000. */
export type PlanId = 'trial' | '40usd';

export interface ProviderLimits {
  monthlyCallCap: number;
  window: 'month' | 'lifetime';
  billingDay: number;
  ratePerMinute: number;
  ratePerHour: number;
  concurrency: number;
  cacheTtlHours: number;
  costPerCallMicroGbp: number;
  planFixedMicroGbp: number;
  excludedFromSchedule: boolean;
}

export const PENCE_TO_MICRO = 10_000;

export const PLAN_PRESETS: Record<PlanId, ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number }> = {
  // why: the free allowance is a one-off credit balance (spec §2 fact 7), so the window is lifetime
  // and scheduled runs exclude the provider; the spike and smoke are the only users.
  trial: { monthlyCallCap: 100, window: 'lifetime', billingDay: 1, ratePerMinute: 2, ratePerHour: 20, concurrency: 1, cacheTtlHours: 1, costPerCallMicroGbp: 0, planFixedMicroGbp: 0, excludedFromSchedule: true, monthlySpendCapMicroGbp: 0, executionMaxCalls: 0, executionMaxCostMicroGbp: 0 },
  // why: subscription: marginal cost 0, the fixed fee (£32) counted once in the global cap, the call cap is the hard stop.
  '40usd': { monthlyCallCap: 10_000, window: 'month', billingDay: 1, ratePerMinute: 10, ratePerHour: 2000, concurrency: 2, cacheTtlHours: 1, costPerCallMicroGbp: 0, planFixedMicroGbp: 3200 * PENCE_TO_MICRO, excludedFromSchedule: false, monthlySpendCapMicroGbp: 3500 * PENCE_TO_MICRO, executionMaxCalls: 2000, executionMaxCostMicroGbp: 0 },
};

export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits = { monthlyCallCap: 50_000, window: 'month', billingDay: 1, ratePerMinute: 200, ratePerHour: 10_000, concurrency: 4, cacheTtlHours: 6, costPerCallMicroGbp: 0, planFixedMicroGbp: 0, excludedFromSchedule: false };
```

`src/config/schema.ts` (structure; every rule from the contract block is a `superRefine` issue with `path: [VARIABLE_NAME]` so `errors[].field` is the variable the operator must fix):

```ts
import { z } from 'zod';
import { PENCE_TO_MICRO, PLAN_PRESETS, type PlanId, type ProviderLimits, TRAVELPAYOUTS_DEFAULTS } from './presets.js';
import { Secret } from './secret.js';

export interface Config { /* exactly the contract block */ }
export interface ParseConfigOptions { realpath: (p: string) => string }
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: Array<{ field: string; message: string }> };

/** Empty string means unset (spec §12). */
const str = z.string().transform((s) => (s === '' ? undefined : s)).optional();
const int = (min: number, max?: number) => str.pipe(z.coerce.number().int().min(min).max(max ?? Number.MAX_SAFE_INTEGER).optional());
const bool = str.pipe(z.enum(['true', 'false']).transform((v) => v === 'true').optional());
const pence = (v: number | undefined) => (v === undefined ? undefined : v * PENCE_TO_MICRO);

const envSchema = z.object({
  NODE_ENV: str.pipe(z.enum(['production', 'development', 'test']).default('production')),
  DATABASE_PATH: str.pipe(z.string().min(1)),
  PORT: int(1, 65535), BIND_ADDRESS: str, ALLOWED_HOSTS: str,
  APP_BASIC_AUTH_USER: str, APP_BASIC_AUTH_PASS: str, ALLOW_UNAUTHENTICATED: bool, TRUST_PROXY: bool,
  LOG_LEVEL: str.pipe(z.enum(['trace', 'debug', 'info', 'warn', 'error']).optional()),
  POINT_OF_SALE: str.pipe(z.string().regex(/^[A-Z]{2}$/).optional()),
  STALE_AFTER_HOURS: int(1), CALENDAR_STALE_AFTER_HOURS: int(1), STUCK_AFTER_HOURS: int(1), MAX_CELLS_PER_DEFINITION: int(1),
  SCHEDULER_TIMEZONE: str, AUTO_RESUME: bool, MAX_AUTO_RESUMES: int(0), MAX_WAIT_SECONDS: int(1), REQUEST_TIMEOUT_SECONDS: int(1),
  ESTIMATE_RETRY_FACTOR: str.pipe(z.coerce.number().min(1).max(5).optional()), FX_MAX_RATE_AGE_DAYS: int(1),
  MONTHLY_SPEND_CAP_PENCE: int(0), GLOBAL_BILLING_DAY: int(1, 28), SOFT_CONFIRM_PENCE: int(0),
  EXECUTION_MAX_CALLS: int(0), EXECUTION_MAX_FREE_CALLS: int(0), EXECUTION_MAX_COST_PENCE: int(0), CHILD_MAX_CALLS: int(0),
  TRAVELPAYOUTS_TOKEN: str, TRAVELPAYOUTS_BILLING_DAY: int(1, 28), TRAVELPAYOUTS_MONTHLY_CALL_CAP: int(0), TRAVELPAYOUTS_RATE_PER_MINUTE: int(1), TRAVELPAYOUTS_RATE_PER_HOUR: int(1), TRAVELPAYOUTS_CONCURRENCY: int(1), TRAVELPAYOUTS_CACHE_TTL_HOURS: int(0),
  SEARCHAPI_KEY: str, SEARCHAPI_PLAN: str.pipe(z.enum(['trial', '40usd']).optional()), SEARCHAPI_BILLING_DAY: int(1, 28), SEARCHAPI_CACHE_TTL_HOURS: int(0), SEARCHAPI_TRIAL_USED: int(0),
  SEARCHAPI_MONTHLY_CALL_CAP: int(0), SEARCHAPI_RATE_PER_MINUTE: int(1), SEARCHAPI_RATE_PER_HOUR: int(1), SEARCHAPI_CONCURRENCY: int(1), SEARCHAPI_COST_PER_CALL_MICRO_GBP: int(0), SEARCHAPI_PLAN_FIXED_PENCE: int(0),
  SMTP_HOST: str, SMTP_PORT: int(1, 65535), SMTP_TLS: str.pipe(z.enum(['implicit', 'starttls', 'none']).optional()), SMTP_USER: str, SMTP_PASS: str, ALERT_EMAIL_TO: str, ALERT_EMAIL_FROM: str,
  IN_CONTAINER: str, ALLOW_FIXTURE_PROVIDER: str,
});

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;

export function parseConfig(env: Record<string, string | undefined>, opts: ParseConfigOptions): ConfigResult {
  const parsed = envSchema.safeParse(env);
  const errors: Array<{ field: string; message: string }> = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push({ field: String(issue.path[0] ?? '?'), message: issue.message });
    return { ok: false, errors };
  }
  const e = parsed.data;
  const port = e.PORT ?? 3000;
  const bindAddress = e.BIND_ADDRESS ?? '0.0.0.0';
  // auth: both or neither; password ≥ 12
  let auth: Config['auth'] = null;
  if ((e.APP_BASIC_AUTH_USER === undefined) !== (e.APP_BASIC_AUTH_PASS === undefined)) {
    errors.push({ field: e.APP_BASIC_AUTH_USER === undefined ? 'APP_BASIC_AUTH_USER' : 'APP_BASIC_AUTH_PASS', message: 'APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS must both be set or both be empty' });
  } else if (e.APP_BASIC_AUTH_USER !== undefined && e.APP_BASIC_AUTH_PASS !== undefined) {
    if (e.APP_BASIC_AUTH_PASS.length < 12) errors.push({ field: 'APP_BASIC_AUTH_PASS', message: 'password must be at least 12 characters' });
    else auth = { user: e.APP_BASIC_AUTH_USER, pass: new Secret(e.APP_BASIC_AUTH_PASS) };
  }
  if (auth === null && !LOOPBACK.test(bindAddress) && e.ALLOW_UNAUTHENTICATED !== true) {
    errors.push({ field: 'BIND_ADDRESS', message: `binding ${bindAddress} without auth needs ALLOW_UNAUTHENTICATED=true (Tailscale-only hosts)` });
    errors.push({ field: 'ALLOW_UNAUTHENTICATED', message: 'set to true only on a host that is not reachable from the internet' });
  }
  // providers
  const searchapi = buildSearchApi(e, errors);
  const travelpayouts = e.TRAVELPAYOUTS_TOKEN === undefined ? null : { token: new Secret(e.TRAVELPAYOUTS_TOKEN), limits: { ...TRAVELPAYOUTS_DEFAULTS, billingDay: e.TRAVELPAYOUTS_BILLING_DAY ?? 1, monthlyCallCap: e.TRAVELPAYOUTS_MONTHLY_CALL_CAP ?? TRAVELPAYOUTS_DEFAULTS.monthlyCallCap, ratePerMinute: e.TRAVELPAYOUTS_RATE_PER_MINUTE ?? 200, ratePerHour: e.TRAVELPAYOUTS_RATE_PER_HOUR ?? 10_000, concurrency: e.TRAVELPAYOUTS_CONCURRENCY ?? 4, cacheTtlHours: e.TRAVELPAYOUTS_CACHE_TTL_HOURS ?? 6 } };
  const preset = searchapi ? PLAN_PRESETS[searchapi.plan] : null;
  const smtp = buildSmtp(e, errors);
  const inContainer = e.IN_CONTAINER !== undefined;
  const allowedHosts = e.ALLOWED_HOSTS ? e.ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean) : [`localhost:${port}`, `127.0.0.1:${port}`, ...(e.NODE_ENV === 'development' ? ['localhost:5173'] : [])];
  if (errors.length > 0) return { ok: false, errors };
  const config: Config = {
    nodeEnv: e.NODE_ENV, databasePath: e.DATABASE_PATH === ':memory:' ? ':memory:' : opts.realpath(e.DATABASE_PATH), port, bindAddress, allowedHosts,
    auth, allowUnauthenticated: e.ALLOW_UNAUTHENTICATED ?? false, trustProxy: e.TRUST_PROXY ?? false, logLevel: e.LOG_LEVEL ?? 'info',
    pointOfSale: e.POINT_OF_SALE ?? 'GB', staleAfterHours: e.STALE_AFTER_HOURS ?? 192, calendarStaleAfterHours: e.CALENDAR_STALE_AFTER_HOURS ?? null, stuckAfterHours: e.STUCK_AFTER_HOURS ?? 12,
    maxCellsPerDefinition: e.MAX_CELLS_PER_DEFINITION ?? 50_000, schedulerTimezone: e.SCHEDULER_TIMEZONE ?? 'Europe/London', autoResume: e.AUTO_RESUME ?? true, maxAutoResumes: e.MAX_AUTO_RESUMES ?? 3,
    maxWaitSeconds: e.MAX_WAIT_SECONDS ?? 3900, requestTimeoutSeconds: e.REQUEST_TIMEOUT_SECONDS ?? 60, estimateRetryFactor: e.ESTIMATE_RETRY_FACTOR ?? 1.2, fxMaxRateAgeDays: e.FX_MAX_RATE_AGE_DAYS ?? 3,
    spend: {
      monthlyCapMicroGbp: pence(e.MONTHLY_SPEND_CAP_PENCE) ?? preset?.monthlySpendCapMicroGbp ?? 0, globalBillingDay: e.GLOBAL_BILLING_DAY ?? 1, softConfirmMicroGbp: pence(e.SOFT_CONFIRM_PENCE) ?? 100 * PENCE_TO_MICRO,
      executionMaxCalls: e.EXECUTION_MAX_CALLS ?? preset?.executionMaxCalls ?? 0, executionMaxFreeCalls: e.EXECUTION_MAX_FREE_CALLS ?? 2000, executionMaxCostMicroGbp: pence(e.EXECUTION_MAX_COST_PENCE) ?? preset?.executionMaxCostMicroGbp ?? 0, childMaxCalls: e.CHILD_MAX_CALLS ?? 6,
    },
    providers: { travelpayouts, searchapi }, smtp, inContainer, allowFixtureProvider: e.ALLOW_FIXTURE_PROVIDER ?? null,
  };
  return { ok: true, config };
}
```

`buildSearchApi` applies the preset for `SEARCHAPI_PLAN ?? 'trial'` then each `SEARCHAPI_*` override; `buildSmtp` enforces all-or-nothing over the seven variables and the `none` rule (`LOOPBACK.test(host)`, or host `mailpit` under `NODE_ENV=development`). Both push to `errors` with the variable name as `field`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test -- config`
Expected: PASS. Check the coverage table; every `??` default and every `errors.push` branch must be hit, so add a test row for any branch the report shows red (the 100% threshold enforces this).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp0: config schema with plan presets and Secret (spec §12)"
```

### Task 0.6: Banned words

**Files:**
- Create: `packages/core/src/text/bannedWords.ts`, `packages/core/test/text/bannedWords.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BANNED_WORDS, findBannedWords } from '../../src/text/bannedWords.js';

describe('findBannedWords (spec §11)', () => {
  it('lists the canonical words', () => {
    expect(BANNED_WORDS).toEqual(['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time']);
  });
  it('matches on word boundaries, case-insensitively', () => {
    expect(findBannedWords('Live prices here')).toEqual([{ word: 'live', index: 0 }]);
    expect(findBannedWords('delivered olives alive')).toEqual([]);
    expect(findBannedWords('Real-Time and realtime')).toEqual([{ word: 'real-time', index: 0 }]);
  });
  it('honours an allowlist of exact phrases', () => {
    expect(findBannedWords('she lives in Leeds; live now', ['lives in'])).toEqual([{ word: 'live', index: 21 }]);
  });
  it('finds multi-word phrases', () => {
    expect(findBannedWords('searches ALL combinations')).toEqual([{ word: 'all combinations', index: 9 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/core test -- banned` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/** The one canonical list of words no user-facing string may contain. Spec §11. */
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary, case-insensitive search. Allowlist entries are exact phrases (case-insensitive)
 * whose span is excluded before matching, e.g. "lives in". Returns every hit with its index in
 * the original text so a test can print the offending sentence.
 */
export function findBannedWords(text: string, allowlist: readonly string[] = []): Array<{ word: string; index: number }> {
  let masked = text;
  for (const phrase of allowlist) {
    masked = masked.replace(new RegExp(escape(phrase), 'gi'), (m) => ' '.repeat(m.length));
  }
  const hits: Array<{ word: string; index: number }> = [];
  for (const word of BANNED_WORDS) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of masked.matchAll(re)) hits.push({ word, index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/core test -- banned` → PASS.

- [ ] **Step 5: Commit** — `git add packages/core && git commit -m "wp0: banned-word finder"`

### Task 0.7: Effective age and labels

**Files:**
- Create: `packages/core/src/labels/age.ts`, `packages/core/test/labels/age.test.ts`

**Interfaces:**
- Produces: the "Labels" contract block.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { compareAges, effectiveAge, formatAgeCompact, formatAgeFull, formatDuration, worstCaseAgeHours } from '../../src/labels/age.js';

const now = '2026-10-14T15:00:00.000Z' as never;
const at = (iso: string) => iso as never;

describe('effectiveAge (spec §3)', () => {
  it('uses providerObservedAt when present', () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T13:00:00.000Z'), providerObservedAt: at('2026-10-14T12:00:00.000Z'), maxAgeHours: 48 }, now)).toEqual({ kind: 'observed', fetchedHours: 2, observedHours: 3 });
  });
  it('bounds by maxAgeHours otherwise', () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T13:00:00.000Z'), maxAgeHours: 168 }, now)).toEqual({ kind: 'bounded', fetchedHours: 2, maxAgeHours: 168 });
  });
  it("is unknown when maxAgeHours is 'unknown'", () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T13:00:00.000Z'), maxAgeHours: 'unknown' }, now)).toEqual({ kind: 'unknown', fetchedHours: 2 });
  });
  it('clamps a future timestamp to 0 (review focus 2)', () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T16:00:00.000Z'), providerObservedAt: at('2026-10-14T17:00:00.000Z'), maxAgeHours: 1 }, now)).toEqual({ kind: 'observed', fetchedHours: 0, observedHours: 0 });
  });
  it('fractions of an hour round down', () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T13:10:00.000Z'), maxAgeHours: 1 }, now).fetchedHours).toBe(1);
  });
});

describe('formatting', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('just now');
    expect(formatDuration(2)).toBe('2h');
    expect(formatDuration(47)).toBe('47h');
    expect(formatDuration(48)).toBe('2d');
    expect(formatDuration(13 * 24)).toBe('13d');
    expect(formatDuration(14 * 24)).toBe('2w');
    expect(formatDuration(168)).toBe('7d');
  });
  it('full and compact forms match spec §3 examples', () => {
    const b = { kind: 'bounded', fetchedHours: 2, maxAgeHours: 168 } as const;
    expect(formatAgeFull(b)).toBe('fetched 2h ago · provider age unknown (≤7d before that)');
    expect(formatAgeCompact(b)).toBe('2h ago · ≤7d');
    const o = { kind: 'observed', fetchedHours: 2, observedHours: 3 } as const;
    expect(formatAgeFull(o)).toBe('fetched 2h ago · observed 3h ago');
    expect(formatAgeCompact(o)).toBe('2h ago · obs 3h');
    const u = { kind: 'unknown', fetchedHours: 2 } as const;
    expect(formatAgeFull(u)).toBe('fetched 2h ago · provider age unknown');
    expect(formatAgeCompact(u)).toBe('2h ago · age unknown');
    expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 0, maxAgeHours: 24 })).toBe('just now · ≤24h');
  });
});

describe('ordering (spec §8.1: unknown loses to any known age)', () => {
  it('worstCaseAgeHours', () => {
    expect(worstCaseAgeHours({ kind: 'observed', fetchedHours: 2, observedHours: 3 })).toBe(3);
    expect(worstCaseAgeHours({ kind: 'bounded', fetchedHours: 2, maxAgeHours: 48 })).toBe(50);
    expect(worstCaseAgeHours({ kind: 'unknown', fetchedHours: 2 })).toBe('unknown');
  });
  it('compareAges', () => {
    const known = { kind: 'bounded', fetchedHours: 100, maxAgeHours: 48 } as const;
    const unknown = { kind: 'unknown', fetchedHours: 0 } as const;
    expect(compareAges(known, unknown)).toBeLessThan(0);
    expect(compareAges(unknown, known)).toBeGreaterThan(0);
    expect(compareAges(unknown, unknown)).toBe(0);
    expect(compareAges({ kind: 'observed', fetchedHours: 1, observedHours: 1 }, known)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';

/** Spec §3 "Effective age" and the two label formats defined once here for web, api and email. */
export type EffectiveAge =
  | { kind: 'observed'; fetchedHours: number; observedHours: number }
  | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number }
  | { kind: 'unknown'; fetchedHours: number };

/** Whole hours between two instants, never negative (a vendor clock ahead of ours reads as 0). */
function hoursBetween(earlier: IsoDateTime, later: IsoDateTime): number {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.max(0, Math.floor(ms / 3_600_000));
}

export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge {
  const fetchedHours = hoursBetween(p.fetchedAt, now);
  if (p.providerObservedAt !== undefined) return { kind: 'observed', fetchedHours, observedHours: hoursBetween(p.providerObservedAt, now) };
  if (p.maxAgeHours === 'unknown') return { kind: 'unknown', fetchedHours };
  return { kind: 'bounded', fetchedHours, maxAgeHours: p.maxAgeHours };
}

export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown' {
  switch (a.kind) {
    case 'observed': return a.observedHours;
    case 'bounded': return a.fetchedHours + a.maxAgeHours;
    case 'unknown': return 'unknown';
  }
}

/** "just now" under an hour; hours to 47h; days to 13d; weeks after. */
export function formatDuration(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function ago(hours: number): string {
  return hours < 1 ? 'just now' : `${formatDuration(hours)} ago`;
}

export function formatAgeFull(a: EffectiveAge): string {
  const fetched = `fetched ${ago(a.fetchedHours)}`;
  switch (a.kind) {
    case 'observed': return `${fetched} · observed ${ago(a.observedHours)}`;
    case 'bounded': return `${fetched} · provider age unknown (≤${formatDuration(a.maxAgeHours)} before that)`;
    case 'unknown': return `${fetched} · provider age unknown`;
  }
}

export function formatAgeCompact(a: EffectiveAge): string {
  const fetched = ago(a.fetchedHours);
  switch (a.kind) {
    case 'observed': return `${fetched} · obs ${formatDuration(a.observedHours)}`;
    case 'bounded': return `${fetched} · ≤${formatDuration(a.maxAgeHours)}`;
    case 'unknown': return `${fetched} · age unknown`;
  }
}

/** Sort comparator: fresher first; unknown age loses to any known age; unknown ties. */
export function compareAges(a: EffectiveAge, b: EffectiveAge): number {
  const wa = worstCaseAgeHours(a);
  const wb = worstCaseAgeHours(b);
  if (wa === 'unknown' && wb === 'unknown') return 0;
  if (wa === 'unknown') return 1;
  if (wb === 'unknown') return -1;
  return wa - wb;
}
```

Note `formatDuration(24)` is `'24h'` so the compact bounded example reads `≤24h`, and `formatDuration(168)` is `'7d'`.

- [ ] **Step 4: Run to verify it passes** — PASS at 100%.

- [ ] **Step 5: Commit** — `git add packages/core && git commit -m "wp0: effective age and the two label formats (spec §3)"`

### Task 0.8: API contract

**Files:**
- Create: `packages/core/src/api-contract/{common,definitions,executions,results,alerts,system,index}.ts`
- Test: `packages/core/test/api-contract/contract.test.ts`

**Interfaces:**
- Produces: the "API contract" block; `ROUTES` with one entry per spec §10 row.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { ROUTES, cronSchema, definitionCreateRequestSchema, priceCellSchema, resultRowSchema, resultsResponseSchema } from '../../src/api-contract/index.js';

const provenance = { providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: '2026-10-14T15:00:00.000Z', maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' };

describe('api-contract (spec §10)', () => {
  it('has a route for every spec §10 row', () => {
    const paths = ROUTES.map((r) => `${r.method} ${r.path}`);
    for (const p of [
      'GET /health', 'GET /providers', 'GET /definitions', 'POST /definitions', 'GET /definitions/:id', 'PUT /definitions/:id', 'DELETE /definitions/:id',
      'POST /definitions/:id/estimate', 'POST /definitions/coverage-check', 'POST /definitions/:id/executions', 'GET /executions/:id',
      'POST /executions/:id/cancel', 'POST /executions/:id/resume', 'POST /cells/verify', 'GET /definitions/:id/results', 'GET /definitions/:id/calendar',
      'GET /definitions/:id/duration-analysis', 'GET /definitions/:id/coverage', 'GET /definitions/:id/calendar-gap',
      'GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate', 'POST /tools/smoke', 'POST /tools/record',
      'GET /itineraries/:hash/history', 'GET /routes/:origin/:destination/history', 'GET /alerts', 'POST /alerts', 'PUT /alerts/:id', 'DELETE /alerts/:id',
      'GET /alerts/events', 'GET /scheduler/jobs', 'GET /budget',
    ]) expect(paths).toContain(p);
  });
  it('every price-bearing response requires provenance', () => {
    expect(priceCellSchema.safeParse({ pricePence: 41200, stale: false, ageHours: 2 }).success).toBe(false);
    expect(priceCellSchema.safeParse({ pricePence: 41200, provenance, stale: false, ageHours: 2 }).success).toBe(true);
    expect(priceCellSchema.safeParse({ pricePence: 412.5, provenance, stale: false, ageHours: 2 }).success).toBe(false);
  });
  it('a result row without provenance is rejected', () => {
    const row = { itineraryHash: null, basis: 'calendar', verdictClass: 'unchecked', pricePence: 41200, stale: false, ageHours: 2, cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-14', returnDate: '2027-03-28', nights: 14 }, outbound: null, inbound: null, totalMinutes: null, stopsOut: null, stopsIn: null, carriers: [], verdicts: {}, unverified: [], notApplied: ['arrivalWindowLocal'], booking: { kind: 'none' }, searchLink: { url: 'https://www.google.com/travel/flights?q=x', host: 'www.google.com', label: 'search link, not a fare link' }, otherOffers: [], notSeenInLatest: null, adjustedPence: null, destinationNote: null, bandCheapest: false };
    expect(resultRowSchema.safeParse(row).success).toBe(false);
    expect(resultRowSchema.safeParse({ ...row, provenance }).success).toBe(true);
  });
  it('forces bookingLinks true when searchapi verifies', () => {
    const def = { name: 'x', origins: ['LHR'], destinations: ['JFK'], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy', constraints: {}, verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: false }, budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 }, providers: { discovery: ['searchapi'], verification: ['searchapi'], discoveryRefreshHours: {} }, destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', enabled: true };
    expect(definitionCreateRequestSchema.safeParse(def).success).toBe(false);
    expect(definitionCreateRequestSchema.safeParse({ ...def, verification: { ...def.verification, bookingLinks: true } }).success).toBe(true);
  });
  it('rejects topN above maxCells and startOffsetDays 0', () => {
    const base = { name: 'x', origins: ['LHR'], destinations: ['JFK'], window: { kind: 'relative', startOffsetDays: 0, lengthDays: 10 }, minNights: 1, maxNights: 2, cabin: 'economy', constraints: {}, verification: { maxCells: 5, topN: 6, alwaysInclude: [], expandTop: 1, bookingLinks: true }, budget: { maxCalls: 0, maxFreeCalls: 100, maxCostMicroGbp: 0 }, providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} }, destinationNotes: {}, onwardCostPence: {}, scheduleCron: null, scheduleTz: 'Europe/London', enabled: true };
    const r = definitionCreateRequestSchema.safeParse(base);
    expect(r.success).toBe(false);
    const fields = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['verification.topN', 'window.startOffsetDays']));
  });
  it('cronSchema is a bounded string only', () => {
    expect(cronSchema.safeParse('0 5 * * 1').success).toBe(true);
    expect(cronSchema.safeParse('rm -rf /').success).toBe(false);
  });
  it('results response carries basisReason and excludedByCurrentSpace', () => {
    const r = resultsResponseSchema.safeParse({ rows: [], total: 0, truncated: false, basis: 'calendar', basisReason: 'no verification provider configured', executions: [], coverage: { buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 }, total: 0, selected: 0, itinerarySearched: 0, onDemand: 0 }, excludedByCurrentSpace: 0 });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

`common.ts`:

```ts
import { z } from 'zod';
import { provenanceSchema } from '../types/provenance.js';

export const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
export const moneyPenceSchema = z.number().int().min(0);
export const microGbpSchema = z.number().int().min(0);
export const ageHoursSchema = z.union([z.number().int().min(0), z.literal('unknown')]);
/** Every price on the wire: amount, provenance, staleness, effective age. Spec §10. */
export const priceCellSchema = z.object({ pricePence: moneyPenceSchema, provenance: provenanceSchema, stale: z.boolean(), ageHours: ageHoursSchema });
export const bucketsSchema = z.object({ priced: z.number().int().min(0), empty: z.number().int().min(0), no_data: z.number().int().min(0), error: z.number().int().min(0), skipped: z.number().int().min(0), not_run: z.number().int().min(0), reused: z.number().int().min(0) });
export const coverageSummarySchema = z.object({ buckets: bucketsSchema, total: z.number().int().min(0), selected: z.number().int().min(0), itinerarySearched: z.number().int().min(0), onDemand: z.number().int().min(0) });
export const cronSchema = z.string().min(9).max(100).regex(/^[\d*/,\-\s]+$/, 'cron: digits, * / , - and spaces only; validated by the scheduler');
export const bookingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('get'), url: z.string().url(), host: z.string() }),
  z.object({ kind: z.literal('post'), url: z.string().url(), postData: z.string(), host: z.string() }),
  z.object({ kind: z.literal('none') }),
]);
```

`definitions.ts`: `windowSpecSchema` (discriminated; `startOffsetDays: z.number().int().min(1)`, `lengthDays: z.number().int().min(1).max(400)`, absolute `to ≥ from` by refine), `constraintsSchema` (every field optional with integer/time-string checks; `departureWindowLocal.from/to` as `HH:mm`), `verificationPolicySchema` with `.superRefine` for `topN ≤ maxCells` (issue path `['topN']`) and `alwaysInclude.length ≤ maxCells`, `definitionCreateRequestSchema` with the top-level `superRefine` that sets an issue at `['verification', 'bookingLinks']` when `providers.verification` includes `'searchapi'` and `bookingLinks` is false, and `origins`/`destinations` disjoint; `definitionUpdateRequestSchema = definitionCreateRequestSchema.partial()`; `budgetFitSchema`; `definitionResponseSchema`; `estimateResponseSchema`; `coverageCheckRequestSchema`; `coverageCheckResponseSchema`.

`executions.ts`, `results.ts`, `alerts.ts`, `system.ts`: the shapes from the contract block, each field typed with the schemas from `common.ts` and `types/`.

`index.ts`:

```ts
export * from './common.js'; export * from './definitions.js'; export * from './executions.js'; export * from './results.js'; export * from './alerts.js'; export * from './system.js';
import type { z } from 'zod';
// ... imports of each schema

export interface RouteDef { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; request?: z.ZodTypeAny; query?: z.ZodTypeAny; response: z.ZodTypeAny; auth: 'public' | 'required' }
/** One entry per spec §10 row; api mounts these, web derives its client from them. */
export const ROUTES: readonly RouteDef[] = [
  { method: 'GET', path: '/health', response: healthPublicSchema, auth: 'public' },
  { method: 'GET', path: '/providers', response: providersResponseSchema, auth: 'required' },
  { method: 'GET', path: '/definitions', response: z.array(definitionResponseSchema), auth: 'required' },
  { method: 'POST', path: '/definitions', request: definitionCreateRequestSchema.optional(), response: definitionResponseSchema, auth: 'required' },
  // … every remaining row of spec §10 in the same form
];
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/core test -- contract` → PASS; typecheck clean.

- [ ] **Step 5: Commit** — `git add packages/core && git commit -m "wp0: api-contract schemas and ROUTES (spec §10)"`

### Task 0.9: `core` barrel and Stryker config

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/stryker.config.json`

- [ ] **Step 1: Export everything**

```ts
export * from './types/ids.js';
export * from './types/provenance.js';
export * from './types/definition.js';
export * from './types/execution.js';
export * from './types/itinerary.js';
export * from './ports/provider.js';
export * from './ports/budget.js';
export * from './ports/cache.js';
export * from './ports/notifier.js';
export * from './ports/logger.js';
export * from './ports/clock.js';
export * from './errors.js';
export * from './config/secret.js';
export * from './config/presets.js';
export * from './config/schema.js';
export * from './config/synthetic.js';
export * from './text/bannedWords.js';
export * from './labels/age.js';
export * as apiContract from './api-contract/index.js';
```

- [ ] **Step 2: Stryker**

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "mutate": ["src/config/synthetic.ts", "src/labels/age.ts", "src/normalise/hashing.ts", "src/normalise/money.ts", "src/normalise/vendorUrl.ts", "src/constraints/evaluate.ts", "src/selection/select.ts", "src/coverage/rollUp.ts", "src/alerts/dedup.ts"],
  "thresholds": { "high": 90, "low": 80, "break": 80 },
  "ignorePatterns": ["dist", "coverage"]
}
```

Files that do not exist yet (WP1/WP2) are listed now so the threshold applies the moment they land; Stryker skips missing globs with a warning until then.

- [ ] **Step 3: Run** — `pnpm --filter @gmt/core test && pnpm --filter @gmt/core mutate` → tests PASS; mutation score on the existing two files ≥ 80%.

- [ ] **Step 4: Commit** — `git add packages/core && git commit -m "wp0: core barrel and Stryker configuration"`

### Task 0.10: `db` skeleton

**Files:**
- Create: `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/index.ts`, `packages/db/drizzle.config.ts`, `packages/db/drizzle/.gitkeep`
- Test: `packages/db/test/client.test.ts`

**Interfaces:**
- Produces: `openDatabase`, `applyMigrations`, `Db` as in the contract.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/client.js';

describe('openDatabase (spec §7 SQLite settings)', () => {
  it('sets busy_timeout and foreign_keys on an in-memory db', () => {
    const db = openDatabase(':memory:');
    expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
  it('uses WAL on a file db', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'gmt-')), 'x.test.db'));
    expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });
  it('transaction callbacks must be synchronous (better-sqlite3 commits at the first await)', () => {
    const db = openDatabase(':memory:');
    // @ts-expect-error async callbacks are rejected by the type and at runtime
    expect(() => db.transaction(async () => 1)).toThrow(/synchronous/);
    expect(db.transaction(() => 41 + 1)).toBe(42);
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/db test` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/client.ts
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';

export interface Db {
  raw: Database.Database;
  drizzle: BetterSQLite3Database;
  /** Runs `fn` in one transaction. The callback must be synchronous: better-sqlite3 commits at the first `await`. Spec §7. */
  transaction<T>(fn: () => T extends Promise<unknown> ? never : T): T;
  close(): void;
}

export function openDatabase(path: string): Db {
  const raw = new Database(path);
  // why: WAL lets the SPA read while the engine writes; a memory db has no journal file.
  if (path !== ':memory:') raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('foreign_keys = ON');
  const orm = drizzle(raw);
  return {
    raw,
    drizzle: orm,
    transaction: (fn) => {
      const run = raw.transaction(() => {
        const result = fn();
        if (result instanceof Promise) throw new TypeError('transaction callbacks must be synchronous');
        return result;
      });
      return run();
    },
    close: () => {
      if (path !== ':memory:') raw.pragma('wal_checkpoint(TRUNCATE)');
      raw.close();
    },
  };
}
```

```ts
// src/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

/** Applies the committed Drizzle SQL migrations idempotently. Spec §7 "Migrations". */
export function applyMigrations(db: Db, migrationsDir: string): void {
  try {
    migrate(db.drizzle, { migrationsFolder: migrationsDir });
  } catch (err) {
    throw new Error(`migration failed in ${migrationsDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

`drizzle.config.ts`: `{ dialect: 'sqlite', schema: './src/schema/index.ts', out: './drizzle' }` via `defineConfig` from `drizzle-kit`. `src/schema/index.ts` starts empty (`export {}`); WP3 fills it and generates the first migration.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/db test && pnpm --filter @gmt/db typecheck` → PASS.

- [ ] **Step 5: Commit** — `git add packages/db && git commit -m "wp0: db client with WAL, busy_timeout, sync transactions"`

### Task 0.11: CI and secret scan

**Files:**
- Create: `.github/workflows/ci.yml`, `scripts/secret-scan.mjs`
- Test: `scripts/secret-scan.test.mjs` is not needed; the script's exit code is asserted by CI running it against a planted file in a temp copy.

- [ ] **Step 1: Secret scan**

```js
#!/usr/bin/env node
// Fails when any fixture file contains a credential-shaped string or a configured secret value.
// Spec §5.3: CI runs the same secret scan over fixtures/. Values come from the environment so the
// scan can be run locally with the real .env loaded; in CI the env has no secrets and only the
// shape rules apply.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages/providers/fixtures'];
const secretValues = ['TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY', 'SMTP_PASS', 'APP_BASIC_AUTH_PASS'].map((k) => process.env[k]).filter((v) => v && v.length >= 8);
const shapes = [/api_key=[A-Za-z0-9]{8,}/i, /token=[A-Za-z0-9]{16,}/i, /Bearer\s+[A-Za-z0-9._-]{16,}/, /X-Access-Token/i];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failures = 0;
for (const root of roots) {
  let files = [];
  try { files = [...walk(root)]; } catch { continue; }
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const v of secretValues) if (text.includes(v)) { console.error(`secret value found in ${f}`); failures++; }
    for (const re of shapes) if (re.test(text)) { console.error(`credential-shaped string ${re} in ${f}`); failures++; }
  }
}
if (failures > 0) process.exit(1);
console.log('secret scan: clean');
```

- [ ] **Step 2: CI**

```yaml
name: ci
on: { push: { branches: [main, 'wp/**'] }, pull_request: {} }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm -r typecheck
      - run: pnpm test:coverage
      - run: pnpm secret-scan
      - name: secret scan catches a planted fixture
        run: |
          mkdir -p packages/providers/fixtures/recorded/planted
          echo '{"url":"https://x/?api_key=ABCDEFGH12345678"}' > packages/providers/fixtures/recorded/planted/p.json
          if pnpm secret-scan; then echo "scan missed the plant"; exit 1; fi
          rm -r packages/providers/fixtures/recorded/planted
      - name: Dockerfile sets production and container flags
        run: |
          if [ -f Dockerfile ]; then grep -q 'ENV NODE_ENV=production' Dockerfile && grep -q 'ENV IN_CONTAINER=1' Dockerfile; fi
```

- [ ] **Step 3: Run locally** — `pnpm secret-scan` → "secret scan: clean"; the planted-file steps reproduced locally exit 1 then clean up.

- [ ] **Step 4: Commit** — `git add .github scripts && git commit -m "wp0: CI workflow and fixture secret scan"`

### Task 0.12: Package-boundary guard

**Files:**
- Create: `scripts/check-boundaries.mjs`; add `"boundaries": "node scripts/check-boundaries.mjs"` to the root scripts and to CI after lint.

- [ ] **Step 1: Write the guard**

```js
#!/usr/bin/env node
// Enforces the spec §4 import graph by reading every package.json `dependencies` and every
// `import ... from '@gmt/…'` under src/. Fails on any edge not in ALLOWED.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = {
  '@gmt/core': [],
  '@gmt/db': ['@gmt/core'],
  '@gmt/providers': ['@gmt/core'],
  '@gmt/engine': ['@gmt/core', '@gmt/db', '@gmt/providers'],
  '@gmt/api': ['@gmt/core', '@gmt/db', '@gmt/providers', '@gmt/engine'],
  '@gmt/web': ['@gmt/core'],
};
const CORE_ALLOWED_EXTERNAL = ['zod', '@noble/hashes', '@date-fns/tz'];
const dirs = { '@gmt/core': 'packages/core', '@gmt/db': 'packages/db', '@gmt/providers': 'packages/providers', '@gmt/engine': 'packages/engine', '@gmt/api': 'apps/api', '@gmt/web': 'apps/web' };

function* walk(dir) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) yield* walk(p); else if (/\.(ts|tsx)$/.test(p)) yield p; } }
let bad = 0;
for (const [name, dir] of Object.entries(dirs)) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep.startsWith('@gmt/') && !ALLOWED[name].includes(dep)) { console.error(`${name} may not depend on ${dep}`); bad++; }
    if (name === '@gmt/core' && !CORE_ALLOWED_EXTERNAL.includes(dep)) { console.error(`@gmt/core may not depend on ${dep}`); bad++; }
  }
  for (const f of walk(join(dir, 'src'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\s+['"](@gmt\/[a-z]+)/g)) if (!ALLOWED[name].includes(m[1])) { console.error(`${f} imports ${m[1]}`); bad++; }
    if (name !== '@gmt/api' && /process\.env/.test(src)) { console.error(`${f} reads process.env outside apps/api`); bad++; }
    if (name === '@gmt/api' && !f.includes('/bootstrap/') && /process\.env/.test(src)) { console.error(`${f} reads process.env outside bootstrap/`); bad++; }
  }
}
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run** — `node scripts/check-boundaries.mjs` → exit 0 on the scaffold.

- [ ] **Step 3: Commit** — `git add scripts package.json .github && git commit -m "wp0: package boundary guard (spec §4)"`

WP0 is complete when every task above is committed on `main` and the definition of done at the top of this section holds.

---

## WP1 — `core`: dates, windows, space, validation, roll-up, coverage, selection (Sonnet)

Brief: `docs/briefs/wp01-core-space-coverage-selection.md`. Depends on WP0. Spec §6.1, §6.6, §6.7, §3 (six buckets), §9 item 1. First failing test: hand-computed cell counts for the default space (2 × 3 × 182 × 12 = 13,104) and the enumerated tiny space (6 cells, listed).

Produces (from `@gmt/core`): `toEpochDay(IsoDate): number`, `fromEpochDay(number): IsoDate`, `addDays(IsoDate, n): IsoDate`, `daysBetween(a, b): number`, `monthOf(IsoDate): IsoMonth`, `monthsSpanned(from, to): IsoMonth[]`; `resolveWindow`, `generateCells`, `countCells`, `validateSearchSpace(def, todayLondon, lookup: { exists(iata): boolean; metroOf(iata): string | null; airportsOfMetro(code): Iata[] }, maxCells): ValidationResult` where `ValidationResult = { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] } | { ok: false; errors: Array<{ field: string; message: string }> }` (review focus 1: a code that `airportsOfMetro` recognises is rejected with the message "LON is a city code; use one of LHR, LGW, …"); `rollUp(outcomes: CellOutcome[]): RollUp`, `mergeWithinProvider(a, b)`, `sixBuckets(outcomes): Buckets`, `selectedNotReached(cells, outcomes)`; `selectCandidates(policy, cells, discovery: Map<cellKeyString, RollUp>, hasDiscoveryProvider): Array<{ cell: CellKey; reason: SelectionReason }>`; `cellKeyString(cell): string` (`O|D|dep|ret`).

## WP2 — `core`: normalisation, hashing, constraints, results, money, alerts (Sonnet)

Brief: `docs/briefs/wp02-core-normalise-constraints-alerts.md`. Depends on WP0. Spec §5.6 (pure parts), §6.2, §6.3, §6.4, §6.5, §6.8, §6.9, §9 item 1. First failing test: `VS 938` ≡ `VS938` hash.

Produces: `canonicalCarrier(s): string` (throws `NormalisationError('unmappable-carrier')`), `canonicalFlightNumber(s): number`, `departLocal(instantOrLocal, timeKind, tz): string` (`YYYY-MM-DDTHH:mm`; DST rules), `itineraryHash(outbound, inbound): string`, `toGbp(amountMinor, currency, rateNano): number` with `MINOR_EXPONENT: Record<string, number>` and `ECB_CURRENCIES`, `toIsoDateTime(vendorString, timeKind, tz): IsoDateTime`, `validateVendorUrl(url, allowlist): Booking`, `normaliseOffer(raw: RawOffer, deps: { tzOf(iata): string | null; rateFor(currency): { rateNano; rateDate; source } | null; cabin: Cabin }): { itinerary: NormalisedItinerary; offer; observationFields } | NormalisationError`, `evaluateConstraints`, `verdictClass`, `dedupByItinerary`, `rankRows`, `sortRows(rows, key, dir)`, `filterRows(rows, filters)`, `bandCheapest`, `evaluateAlertRules(rules, candidates, previous, now): Firing[]`, `dedupKey`, `isSuppressed`, `buildDigest(rule, firings): AlertDigest`, `searchLinkFor(providerId, cell, cabin): { url; host; label }`.

## WP3 — `db` (Opus)

Brief: `docs/briefs/wp03-db.md`. Depends on WP0. Spec §7 entire, §5.3 cap predicates, §9 item 3. First failing test: 1,000 ledger rows × 3200 micro-GBP trip a 300p cap in SQL. Produces every class in the "Database" contract block, the first Drizzle migration, the vendored airports dataset, `seedAirports`, `sanityCheckAirports`, `runMaintenance`.

## WP4 — `providers`: http-kit, recorder, scrubbing, egress, fixture provider (Opus)

Brief: `docs/briefs/wp04-http-kit-and-fixture-provider.md`. Depends on WP0. Spec §5.3, §5.5, §9 item 2 (http-kit and fixture rows). First failing test: reserve happens before fetch on every attempt. Produces the "http-kit" contract block.

## WP4b — Fixture recording and wiring helper (Fable)

Brief: `docs/briefs/wp04b-recording-and-wiring.md`. Depends on WP3, WP4. Records the public example route (LHR/LGW → JFK/EWR) through the real recorder with ~12 of the 91 remaining trial credits, writes the dated parameter allowlists, builds `apps/api/src/wiring.ts` and the tool bootstrap. First failing test: a recorded fixture carries a verifiable content hash.

## WP5 — SearchApi adapter (Opus)

Brief: `docs/briefs/wp05-searchapi-adapter.md`. Depends on WP4, WP4b. Spec §2 (SearchApi rows and facts 2–5, 8), §5.2, §5.4, §9 item 2. First failing test: tiles partition the band.

## WP6 — Travelpayouts adapter (Sonnet)

Brief: `docs/briefs/wp06-travelpayouts-adapter.md`. Depends on WP4, WP4b. Spec §2 (Travelpayouts row and fact 1), §5.2, §9 item 2. First failing test: empty envelope → `no_data`.

## WP7 — `engine` with layer-A tests (Opus)

Brief: `docs/briefs/wp07-engine.md`. Depends on WP1, WP2, WP3, WP4. Spec §5.6, §8 entire, §9 item 4 layer A. First failing test: resume after k of n tiles issues n−k. Produces the "Engine" contract block except `EmailNotifier` and the alert runner (WP11); `LogNotifier` is here so WP7's tests can exercise operator notifications.

## WP8 — `api` (Sonnet)

Brief: `docs/briefs/wp08-api.md`. Depends on WP4b, WP7. Spec §4 auth and hardening, §10, §9 item 5, §14. First failing test: production boot lacks `fixture`.

## WP9 — `web` shell, Definitions, Results, Coverage, Providers (Sonnet)

Brief: `docs/briefs/wp09-web-shell-definitions-results.md`. Depends on WP8. Spec §11 (layout, status bar, Definitions form, View A, View D, Providers), §9 item 6. First failing test: a price without provenance fails to render.

## WP10 — `web` Calendar, Duration, History, Playwright smoke (Sonnet)

Brief: `docs/briefs/wp10-web-calendar-duration-history.md`. Depends on WP9. Spec §11 Views B, C, History; §9 item 6. First failing test: five-way day counts. Review focus 3 lives here.

## WP11 — Alerts, email, Alerts UI (Sonnet)

Brief: `docs/briefs/wp11-alerts-email.md`. Depends on WP7, WP8, WP10. Spec §6.8 (engine side), §8.3, §11 Alerts view. First failing test: 50 firings → one digest.

## WP12 — Docker, compose, env, backup, docs (Sonnet)

Brief: `docs/briefs/wp12-docker-docs.md`. Depends on WP8. Spec §12 (`.env.example` final), §13, §9 item 8. First failing test: the Dockerfile sets production and the container flag.

## WP13 — Live smoke, layer-B engine tests, lock test, integration review (Fable)

Brief: `docs/briefs/wp13-smoke-and-final-pass.md`. Depends on all. Spec §9 items 4 (layer B) and 7, §7 `app_lock`. First failing test: the live smoke exits 0 with provenance.

---

## Self-review record (2026-10-14)

1. **Spec coverage.** §1 → WP9 (empty state, coverage check), WP8 (`POST /definitions` default for the plan); §2 → WP5, WP6, docs in WP12; the Phase 4 Camoufox fallback has no task by design (spec: not built); §3 → WP0 types, WP1 buckets, WP0 labels; §4 → WP0 scaffold and boundary guard, WP8 auth; §5.1 → WP0; §5.2 → WP5/WP6; §5.3 → WP4; §5.4 → WP5; §5.5 → WP0 gate, WP4 fixture provider, WP8 boot matrix, WP12 Dockerfile; §5.6 → WP2 pure parts, WP7 step; §6 → WP1/WP2; §7 → WP3 (+ WP0 client); §8 → WP7 (+ WP11 notifications); §9 → thresholds WP0, each item in its WP, item 7 in WP13; §10 → WP0 contract, WP8 routes; §11 → WP9/WP10/WP11; §12 → WP0 schema, WP12 docs; §13 → WP12; §14 → WP8 (pino setup in bootstrap) and WP4 (scrubbing). No gap found.
2. **Placeholder scan.** No TBD/TODO. Two code blocks in Task 0.5 and Task 0.8 describe helper functions (`buildSearchApi`, `buildSmtp`, the remaining schema files) in prose with their rules stated; they are bounded by the tests above them, which is the acceptance criterion.
3. **Type consistency.** `Buckets` is defined once in `api-contract/common.ts` as `bucketsSchema` and re-used by `CellsRepo.buckets` and `sixBuckets`; `RollUp.status` null ↔ API `not_applicable` is stated in the execution types block; `Booking.host` is required on `get`/`post` in both `types/itinerary.ts` and `bookingSchema`; `PlanId` has two members everywhere; `Estimate` is `estimateResponseSchema`'s type.
4. **Review focus.** All five lines have an owning task: 1 → WP1 validation + WP9 form; 2 → Task 0.7 (test present) + WP2 ordering; 3 → WP10; 4 → WP7 + WP8; 5 → WP3 + WP7. Each brief carries its pinned test.
