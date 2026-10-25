# get-me-there Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the route-agnostic flexible-date flight price optimiser described by the design spec, as a pnpm monorepo of six packages, delivered as fourteen work packages dispatched to Opus and Sonnet implementers behind contracts that Fable owns.

**Architecture:** One Node process (Hono API + engine + croner scheduler) serving a built React SPA over one SQLite file. `core` is pure (types, ports, every domain function); `db` and `providers` depend only on `core`; `engine` composes them; `api` and `web` sit on top. Every price carries provenance; every HTTP attempt is ledgered and cap-checked before it is sent; synthetic data exists only behind `syntheticAllowed`.

**Tech Stack:** TypeScript strict, Node 22+ (image `node:22-slim`; dev machine runs 26), pnpm 12, `better-sqlite3` + Drizzle, Hono + `@hono/node-server`, zod 4, `@noble/hashes`, `@date-fns/tz`, `bottleneck`, `p-retry`, `pino`, `croner`, `nodemailer`, Vite 8 + React 19 + TanStack Query + TanStack Table + Tailwind 4 + Recharts 3, Vitest 5 + `msw` 3 + Testing Library + Stryker, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (revision 9, approved). The plan argues from the spec; every implementer reads both. Where this plan and the spec disagree, the spec wins and the plan is the bug.

**Companion documents:** one brief per work package under `docs/briefs/wpNN-<slug>.md` carries that package's bite-sized tasks. This plan holds the global constraints, the file map, the cross-package contracts, the dispatch order, and the full task list for WP0 (which Fable builds first, because everything else imports it).

## Global Constraints

Copied from the spec. Every task's requirements include this section.

- **Package graph (spec §4):** `core` imports only `zod`, `@noble/hashes`, `@date-fns/tz`. `db` and `providers` import `core` only. `engine` imports `core`, `db`, `providers`. `api` imports all. `web` imports `core` (types, `api-contract`, pure filter/rank/verdict/label functions). `providers` has no SQLite and no `process.env`. `process.env` is read once, in the `api` bootstraps. `apps/camoufox-worker` (WP14, decisions 68 and 69) imports `core`, `camoufox-js` and `playwright-core` (and, in tests only, `@gmt/providers/testing`), reads its own `process.env` once in its entry point, runs on the operator's machine (never in an image), and is imported by nothing; the app reaches it over HTTP. `apps/cli` (WP16b, decision 72) imports `core` only, reads `process.env` once in its entry module, imports no browser library and no other workspace package, and reaches the app and the worker only over HTTP or as child processes. The worker's `run.ts` also sets `CAMOUFOX_INSTALL_DIR` once before dispatch (decision 73), its one write to `process.env`.
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
pnpm-workspace.yaml               packages/* and apps/*; pnpm 12 allowBuilds: better-sqlite3, esbuild (WP0, decision 16)
.npmrc                            strict-peer-dependencies=false, engine-strict=true (WP0)
tsconfig.base.json                strict, NodeNext, isolatedModules, noUncheckedIndexedAccess, exactOptionalPropertyTypes (WP0)
biome.json                        lint + format rules shared by every package (WP0)
vitest.config.ts                  root test.projects listing every package config (WP0)
.github/workflows/ci.yml          install → lint → typecheck → test with coverage → secret scan → Dockerfile assertion (WP0; WP12 adds the Docker build)
scripts/secret-scan.mjs           fails if any configured secret value or key-like token appears under fixtures/ (WP0)
scripts/backup.mjs               CLI wrapper over @gmt/db backupDatabase: arguments, exit codes, output (WP12)
scripts/mutation-gate.mjs         fails `pnpm mutate` when timed-out mutants exceed 5% of those tested (decision 67)
.github/workflows/mutation.yml    the Stryker gate on core, on workflow_dispatch and weekly, never on push (decision 67)
README.md                         what the app is; start with docs/setup.md section 1; links to the operator docs (decision 67)
docs/release-notes.md             what each release does, its known limits and follow-ups (decision 67)
.env.example                      every variable from spec §12 with its comment (WP0; WP12 finalises)
.gitignore                        .env*, data/, *.db*, backups/, node_modules/, dist/ (exists)
.dockerignore                     .env*, data/, fixtures/recorded/, node_modules/ (WP12)
Dockerfile                        multi-stage, node:22-slim by digest, NODE_ENV=production, IN_CONTAINER=1, USER node (WP12)
docker-compose.yml                app + mailpit (dev profile), named volume, 127.0.0.1:3000 (WP12)
docs/setup.md                     first-run path, example definition JSON (London → New York), backups, growth (WP12)
docs/api-limits.md                plan preset table, per-provider facts, reconciliation (WP12)
docs/scheduling.md                cron examples, cadence table, pausing (WP12)
docs/briefs/wpNN-<slug>.md        one brief per work package (this plan's companions)
docs/examples/london-new-york.json the importable example definition; also imported by apps/web/src/example.ts (WP12 writes it, WP9 imports it)

packages/core/                    @gmt/core — pure; 100% coverage
  src/index.ts                    barrel of every public export (WP0, extended by WP1/WP2)
  src/types/ids.ts                Iata, IsoDate, IsoMonth, IsoDateTime brands and their zod schemas (WP0)
  src/types/provenance.ts         Provenance, SourceKind, Cabin, PointOfSale (WP0)
  src/types/definition.ts         SearchDefinition, WindowSpec, Constraints, VerificationPolicy, Budget, ProvidersConfig (WP0)
  src/types/execution.ts          ExecutionStatus, Stage, CellOutcomeStatus, CellOutcome, RollUp (WP0)
  src/types/itinerary.ts          NormalisedItinerary, Segment, Layover, Offer, Observation (WP0)
  src/types/alerts.ts             AlertRule, AlertEvent, AlertCandidate, Firing, PriorFiring (WP0)
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
  src/results/types.ts, rowKey.ts, searchLink.ts   ResultRow helpers, resultRowKey, searchLinkFor (WP2)
  src/constraints/labels.ts       CONSTRAINT_LABELS (WP2)
  src/text/money.ts, src/text/control.ts           formatPence; hasControlChars, stripControlChars (WP2; WP11 imports the control helpers)
  test/**                         mirrors src; fixtures for hashing matrix etc.
  vitest.config.ts                thresholds 100/100/100 (WP0)
  stryker.config.json             mutate list from spec §9 (WP0)

packages/db/                      @gmt/db — better-sqlite3 + Drizzle
  src/index.ts                    barrel (WP0, extended by WP3)
  src/client.ts                   openDatabase(path): Db with WAL, busy_timeout, foreign_keys; sync transaction (WP0)
  src/migrate.ts                  applyMigrations(db, migrationsDir) idempotent (WP0)
  src/schema/*.ts                 one Drizzle table per spec §7 entity (WP3)
  drizzle/                        generated SQL migrations, committed (WP3)
  src/types.ts, src/repos.ts      row and write types; createRepos (WP3)
  src/internal/*.ts               row mappers that parse stored JSON through core's schemas; cell-key SQL (WP3)
  src/repositories/*.ts           one repository per aggregate (WP3; names in the contracts below)
  src/budget/window.ts, src/budgetConfig.ts   billing windows; budgetConfigFromConfig (WP3)
  src/backup.ts                   backupDatabase: VACUUM INTO + integrity_check, private modes, prune (WP3)
  scripts/build-airports.mjs      builds data/airports.<version>.json and data/metros.json from the vendored sources (WP3)
  src/budgetGuard.ts              SqliteBudgetGuard (WP3)
  src/responseCache.ts            SqliteResponseCache (WP3)
  src/appLock.ts                  AppLock (WP3)
  src/seed/airports.ts            seedAirports(db, dataset) + sanity check (WP3)
  data/airports.<version>.json    vendored mwgg/Airports subset: iata, icao, name, city, country, tz, lat, lon (WP3)
  data/metros.json                attributed list of IATA metropolitan area codes → airports (CC BY-SA 4.0, LICENSE beside it) (WP3)
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
  src/fixture/router.ts           Hono router serving the fixture tree; scenario control (WP4)
  src/testing/index.ts            '@gmt/providers/testing': fixtureHandlers, replayHandlers, loadRecorded (msw) (WP4)
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
  src/wiring.ts                   buildPorts, httpLimitsFor, providersFor, loadConfigFromEnv (WP4b)
  src/logger.ts                   createLogger: pino with the spec §14 redact paths (WP4b)
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
| 1 | WP1, WP2 (Sonnet), WP4 (Opus) | yes, three worktrees |
| 1b | WP3 (Opus; needs 0, 1) | starts when WP1 merges |
| 2 | WP4b (Fable; needs 3, 4) | — |
| 3 | WP6 (Sonnet; 1, 2, 4, 4b), WP7 (Opus; 1, 2, 3, 4) in parallel; WP5 (Opus; 1, 2, 4, 4b, 6) after WP6 merges | yes |
| 4 | WP8 (Sonnet; 4b, 7) | — |
| 5 | WP9 (Sonnet; 8) | — |
| 6 | WP10 (Sonnet; 9) | — |
| 7 | WP11 (Sonnet; 7, 8, 10) | — |
| 7b | WP12 (Sonnet; 8, 9, 11) | — |
| 8 | WP13 (Fable; all) | — |
| 9 | WP14 (Opus; 13): the `camoufox` provider, opt-in (decision 68) | — |
| 10 | WP15 (Opus; 14): the `camoufox` `grid` mode (decision 70) | — |
| 11 | WP16a (Opus; 15): local-mode foundations: catch-up and migration 0007, `GET /api/executions/active`, the moved-database marker, the shared `core`/`providers` camoufox pieces, the browser window (decisions 79, 81, 82, 83) | — |
| 11b | WP16b (Opus; 16a): the `gmt` command, native services, imports, update during a run, CI matrix, quick start (decisions 71, 72, 77, 78, 80) | — |
| 12 | WP17 (Opus; 16a, 16b): Camoufox install, consent capture, the worker's caps, Linux worker (decisions 73–75, 82); WP18 (Sonnet; 16a, 16b): status report, `gmt status`, Status view, consent email (decisions 74, 76) | yes, two worktrees |

**Before dispatch**, each brief is reviewed with `/review-spec docs/briefs/wpNN-<slug>.md --roster core`; Critical and High findings are fixed in the brief first. Briefs for later waves are re-reviewed when their wave opens, against the code that exists by then.

**Per work package:**

1. Fable creates a worktree and branch `wp/NN-<slug>` from `main` (`superpowers:using-git-worktrees`).
2. The implementer (Opus or Sonnet, per the brief's frontmatter) receives the brief path, the spec path and this plan path, and works task by task: failing test, run, implement, run, commit. Commit messages: `wpNN: <what>` and the attribution line from the repository's conventions.
3. Done means: every task's checkbox ticked; `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` green with the package thresholds; the brief's definition-of-done commands pass; no `process.env` outside `apps/api/src/bootstrap/` and the `scripts/*.mjs` entry points; no airport, city or country literal outside tests and docs that use the worked example.
4. Review gate: the project reviewers named in the brief (`code-architect`, `test-strategy-reviewer`, plus the package's specialist) read the diff; Fable reads the diff; findings are fixed on the branch; then Fable merges to `main` with `--no-ff`.
5. Interfaces in the contracts section are frozen once their package merges. A later package that needs a change opens it as a finding against this plan; Fable edits the plan and the contract in one commit.

**Execution method for WP0:** native (Fable implements it in-session, one reviewer at the end), because WP0 is the contract everything else imports and the mistakes that matter are consistency mistakes a single author avoids. Every later package is subagent-driven by the owner named above.

---

## Cross-package contracts

Everything below is `export`ed from the named file. Later packages consume these exact names. These contracts are **frozen** once their package merges; the brief-drafting pass of 2026-10-14 (fourteen briefs) settled every type the first version left implicit, and the decisions it forced are listed in "Decisions taken at reconciliation" at the end of this section. Where this section and spec revision 10 disagree, the spec wins and this section is the bug.

### Identifiers and dates (`@gmt/core` `types/ids.ts`, WP0)

```ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export const isoDateSchema: z.ZodType<IsoDate, string>;    // regex + real calendar date check (rejects 2027-02-29)
export const isoMonthSchema: z.ZodType<IsoMonth, string>;
export const isoDateTimeSchema: z.ZodType<IsoDateTime, string>; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ and Date.parse round-trips
export function isRealDate(y: number, m: number, d: number): boolean;
export function asIata(s: string): Iata;           // throws on mismatch. The as* helpers are the ONLY brand mint sites in the repository (production and tests); no `as <Brand>` anywhere else
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;
export function isoDateTimeOfEpochMs(ms: number): IsoDateTime;   // new Date(ms).toISOString(), minted
```

### Provenance and shared enums (`types/provenance.ts`, WP0)

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'camoufox' | 'fixture';   // defined here; ports/provider.ts re-exports it; 'camoufox' added by WP14 (decision 68)
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'scraped-self' | 'synthetic';   // 'scraped-self' added by WP14
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';   // ISO 3166-1 alpha-2 upper-case (POINT_OF_SALE echoes), or 'unknown'; pointOfSaleSchema = z.string().regex(/^[A-Z]{2}$/).or(z.literal('unknown'))
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}
export const providerIdSchema, sourceKindSchema, cabinSchema, pointOfSaleSchema, fxInfoSchema, provenanceSchema;
// provenanceSchema uses z.object({...}).strict() with providerObservedAt: isoDateTimeSchema.exactOptional()  (zod 4; needed under exactOptionalPropertyTypes)
```

### Definition types (`types/definition.ts`, WP0)

```ts
export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }   // the ONLY definition; ports/provider.ts imports it
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}` — lives here (WP0) so WP1, WP2, WP3 all share it
export function parseCellKeyString(s: string): CellKey;   // inverse; throws on malformed input
export type LocalTimeWindow = { from: string; to: string };   // HH:mm, inclusive, local to the airport
export interface Constraints {
  maxStops?: number; maxJourneyMinutes?: number; minLayoverMinutes?: number; maxLayoverMinutes?: number;
  noOvernightLayover?: boolean; departureWindowLocal?: LocalTimeWindow; arrivalWindowLocal?: LocalTimeWindow;
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
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'confirmedCostPence' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean; droppedAlwaysInclude: CellKey[] };
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
export type NoDataReason = 'cabin-not-offered';          // a provider whose `cabins` excludes the definition's cabin: every cell no_data, no call
export type ErrorReason = ProviderErrorKind | NormalisationReason;   // the vendor message goes to lastError, never to reason
export interface CellOutcome extends CellKey {
  executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null;
  attempts: number; lastError: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin | null; pointOfSale: PointOfSale | null; sourceKind: SourceKind | null; reusedFromExecutionId: string | null;
}
export interface RollUp { status: CellOutcomeStatus | null; reason: string | null; minPence: number | null }   // null status ↔ API 'not_applicable'
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';
export interface Execution {
  id: string; definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; status: ExecutionStatus; stage: Stage | null;
  estimate: Estimate | null; cancelRequested: boolean; resumeAfter: IsoDateTime | null; autoResumeCount: number;
  startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null; errorText: string | null; createdAt: IsoDateTime; trigger: 'manual' | 'schedule' | 'tool';
}
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }   // bucketsSchema in api-contract/common.ts is z.ZodType<Buckets>
```

### Itinerary types (`types/itinerary.ts`, WP0)

```ts
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }
export interface FareConditions { refundable?: boolean; changeable?: boolean; notes?: string[] }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Segment { marketingCarrier: string; operatingCarrier?: string; flightNumber: number; from: Iata; to: Iata; departLocal: string; arriveLocal: string; departUtc?: IsoDateTime; arriveUtc?: IsoDateTime; durationMinutes?: number; aircraft?: string }
export interface Layover { at: Iata; minutes: number; overnight: boolean; airportChange: boolean }
export interface NormalisedItinerary { hash: string; origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate; nights: number; outbound: Segment[]; inbound: Segment[]; outboundMinutes?: number; inboundMinutes?: number; stopsOut: number; stopsIn: number; layovers: Layover[]; airportChange?: boolean; marketingCarriers: string[] }
export interface Offer { itineraryHash: string; providerId: ProviderId; seller: string; cabin: Cabin }
export interface ObservationFields {   // what normalisation yields for one raw offer, before the db assigns ids
  pricePence: number; priceNativeMinor: number; currencyNative: string; fx: FxInfo; taxesIncluded: boolean | null; selfTransfer: boolean | null;
  segmentCabins: Cabin[] | null; baggage: BaggageSnapshot | null; fareConditions: FareConditions | null; booking: Booking; bookingExpiresAt: IsoDateTime | null;
}
export interface Observation extends ObservationFields { id: number; offerId: number; executionId: string; provenance: Provenance; suppliedFields: SuppliedField[]; partialExpansion: boolean }
export type Verdict = 'pass' | 'fail' | 'unverified';
export type ConstraintName = keyof Constraints | 'cabin';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
export type ResultBasis = 'verified' | 'calendar';   // API values; the UI labels them "itinerary-search basis" and "calendar basis"
```

### Provider port (`ports/provider.ts`, WP0)

Spec §5.1 (revision 10) verbatim, with these settled details:

```ts
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }                                   // Travelpayouts month tiles (added in spec rev 10)
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };
export interface ItinerarySearchResult {
  offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; partial: boolean; failedExpansions: number; notes: string[];
  routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>;   // SearchApi price_insights.price_history; the engine upserts route_price_history
}
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;   // upstream attempts since `since`; http-kit seeds its hourly reservoir from it after a restart
}
// DiscoveryQuery stays per (origin, destination) pair. Travelpayouts queries by airport code only (decision 34: a metro query returns one cheapest row per date pair across the metro and hides the definition's own fares), rows filtered to the pair by origin_airport; a scan costs O × D × M upstream free calls.
// A provider whose `cabins` excludes the definition's cabin is not called at all: the engine marks every cell for that provider and stage no_data with reason 'cabin-not-offered' (spec rev 10).
```

### Budget port (`ports/budget.ts`, WP0)

```ts
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowUsed: boolean; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
// windowUsed is false only for a provider window the plan does not use (a month scope on a lifetime plan, and vice versa); its cap is then null and means nothing. With windowUsed true, a null cap means no cap is configured (decision 67, ruling 2). The api sends only the window each plan uses.
// Per-execution caps come from the execution's snapshot budget (search_executions.definition_snapshot_json → budget), never from config at reserve time; child executions inherit the definition's budget with only maxCalls replaced by min(headroom, max(CHILD_MAX_CALLS, perCellEstimate × ESTIMATE_RETRY_FACTOR)), the headroom being the parent's remaining calls (else the definition's maxCalls) less what other active children may spend (decisions 25, 43, 67). Config EXECUTION_MAX_* are the defaults a new definition is created with.
```

### Logger and clock (`ports/logger.ts`, `ports/clock.ts`, WP0)

```ts
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export const systemClock: Clock;
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export function londonDateOf(instant: IsoDateTime): IsoDate;
```

### Notifier port (`ports/notifier.ts`, WP0)

```ts
export interface DigestItem { pricePence: number; provenance: Provenance; cell: Cell; verdictClass: VerdictClass | 'unchecked'; itineraryHash: string | null; seller: string | null; unverified: ConstraintName[]; previousPricePence: number | null; fetchGapHours: number | null; isNew: boolean; firingReason: string; booking: Booking; bookingExpiresAt: IsoDateTime | null; outbound: Segment[] | null; inbound: Segment[] | null; searchLink: { url: string; host: string; label: string } | null /* null for synthetic rows */; rowKey: string /* resultRowKey, for the app link */ }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number /* firings beyond the top 10 */; newItems: DigestItem[]; newRestCount: number /* new cells beyond the top 10 */; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }
export type OperatorMessageKind = 'paused_budget' | 'paused_error' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed' | 'interrupted' | 'provider_disabled' | 'provider_capped' | 'parity_break' | 'alerts_calendar_only' | 'crash_loop';
export interface OperatorMessage { kind: OperatorMessageKind; executionId: string | null; definitionId: string; subject: string; body: string }
export interface Notifier { id: string; send(msg: { kind: 'digest'; digest: AlertDigest; subject: string; body: string } | { kind: 'operator'; message: OperatorMessage }): Promise<{ ok: boolean; detail?: string }> }
// Rendering subject and body is the engine's job (WP7 for operator messages, WP11 for digests); core's buildDigest returns the structured AlertDigest only.
```

### Alert types (`types/alerts.ts`, WP0)

```ts
export type AlertRuleType = 'absolute' | 'dropPct' | 'dropAbs';
export interface AlertRule { id: string; definitionId: string; type: AlertRuleType; thresholdPence: number | null; pct: number | null; basis: ResultBasis; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export type AlertRuleInput = Omit<AlertRule, 'id'>;
export interface AlertEvent { id: number; ruleId: string; identityKey: string; observationId: number | null; calendarPriceId: number | null; dedupKey: string; firedAt: IsoDateTime; status: 'sent' | 'failed' | 'suppressed'; reason: string | null; payload: unknown }
export type VerifiedCandidate = { basis: 'verified'; observation: Observation; itinerary: NormalisedItinerary; verdictClass: VerdictClass; unverified: ConstraintName[]; seller: string; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type CalendarCandidate = { basis: 'calendar'; calendarPriceId: number; fetchedByExecutionId: string; cell: Cell; pricePence: number; provenance: Provenance; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };   // evaluateAlertRules refuses candidates whose fetchedByExecutionId ≠ ctx.executionId (reused rows)
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface Firing { rule: AlertRule; candidate: AlertCandidate; identityKey: string; dedupKey: string; reason: string; isNew: boolean; suppressed: { reason: string } | null }   // evaluateAlertRules returns suppressed firings too; the runner records them with status 'suppressed' and the digest excludes them
export interface PriorFiring { identityKey: string; dedupKey: string; firedAt: IsoDateTime; pricePence: number }
// identityKey formats: verified `${ruleId}|${itineraryHash}`; calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`. dedupKey = `${identityKey}|${Math.floor(pricePence / 100)}`.
```

### Errors (`errors.ts`, WP0)

As in the WP0 tasks: `ProviderError`, `BudgetExceeded`, `AbortedError`, `NormalisationError`, `stripUrlsInText`. `ProviderErrorKind` and `NormalisationReason` are exported here. The outcome `reason` column holds the kind or normalisation reason only; the vendor message (URL-stripped) goes to `lastError`.

### Config (`config/*.ts`, WP0)

As in the WP0 tasks, plus:

```ts
appBaseUrl: string | null;        // APP_BASE_URL, optional https URL; used by email templates to link to a results row; null → relative path
providers.fixture: { costMicroGbp: number } | null;   // only under syntheticAllowed; FIXTURE_COST_MICRO_GBP (default 0) read by the test/dev config, so engine tests can bill the fixture provider
```

### Labels (`labels/age.ts`, WP0)

As in Task 0.7, with one settled rule: a `bounded` age whose `maxAgeHours` is 0 (interactive search at request time) formats as `fetched 5h ago` (full) and `5h ago` (compact); the "(≤… before that)" clause appears only when `maxAgeHours > 0`.

### Banned words (`text/bannedWords.ts`, WP0)

As in Task 0.6, plus `export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in']` — the single allowlist every package's banned-word test passes. Vocabulary (spec §11): the SearchApi calendar source reads "Google date grid via SearchApi", the SearchApi itinerary source "Google Flights via SearchApi", Travelpayouts "Aviasales cache", the verified basis "itinerary-search basis".

### API contract (`api-contract/*.ts`, WP0)

**Every route is mounted under `/api`** (spec rev 10): the SPA owns `/`, `GET /api/health` is the public health route, the Docker `HEALTHCHECK` fetches it. Zod objects; types are `z.infer`. `ROUTES` entries carry `{ method, path, request?, query?, params?, response, auth: 'public' | 'required' }` and the path strings below include the prefix.

- `common.ts`: `errorEnvelopeSchema` `{ error: { code: string; message: string; details?: { fields?: Array<{ field: string; message: string }> } & Record<string, unknown> } }` (a 422 carries `details.fields`); `moneyPenceSchema`; `microGbpSchema`; `ageHoursSchema`; `priceCellSchema` `{ pricePence, provenance, stale, ageHours }`; `bucketsSchema: z.ZodType<Buckets>`; `coverageSummarySchema` `{ buckets, total, selected, itinerarySearched, onDemand, reused }`; `cronSchema`; `bookingSchema`; `executionSummarySchema` `{ id, status, isChild, startedAt, finishedAt, ageHours }` (lists are newest first); `usageSchema` `{ scope: string; calls; costMicroGbp; costPence; cap; windowStart; windowEnd }`; `fieldErrorSchema`.
- `airports.ts`: `GET /api/airports?q=` → `airportsResponseSchema` `Array<{ iata, name, city, country, tz, metro: string | null }>` (max 20, prefix match on iata, then city/name substring).
- `definitions.ts`: `definitionCreateRequestSchema` (DefinitionInput plus `confirmedCostPence?: number`, the explicit confirmation from the create click; `bookingLinks` forced true when verification includes `searchapi`; origins/destinations disjoint; `topN ≤ maxCells`; `alwaysInclude.length ≤ maxCells`); `definitionUpdateRequestSchema` (partial); `definitionResponseSchema` `SearchDefinition & { budgetFit: BudgetFit; estimate: Estimate | null; needsConfirmation: { estimateMicroGbp: number; confirmedCostPence: number | null } | null; notices: string[] }`; `budgetFitSchema` `{ fits: boolean; runsPerMonth: number; perScope: Array<{ scope: string; estimated: number; cap: number | null; fits: boolean }> }`; `estimateSchema` (= `Estimate`) `{ cells: number; perProvider: Array<{ providerId; stage: Stage; calls: number; planCalls: number; costMicroGbp: number; costPence: number; seconds: number; blocked: string | null }>; totalCalls: number; totalPlanCalls: number; totalCostMicroGbp: number; totalCostPence: number; seconds: number; assumptions: string[]; windowClamped: boolean; retryFactor: number }` (`planCalls` is pre-factor, for the overrun check); `POST /api/definitions/estimate` (body: `definitionCreateRequestSchema`, unsaved) and `POST /api/definitions/:id/estimate` both → `estimateResponseSchema` `{ estimate: Estimate; budgetFit: BudgetFit }` (so the form shows both before the create click); `coverageCheckRequestSchema` `{ origins, destinations, window, minNights, maxNights }`; `coverageCheckResponseSchema` `{ pairs: Array<{ origin, destination, months: Array<{ month: IsoMonth; cachedRows: number; cellsInBand: number }> }>; calls: number; notes: string[] }`.
- `executions.ts`: `executionResponseSchema` `{ id, definitionId, isChild, cell, status, stage, reason: string | null, resumeAfter, trigger, startedAt, finishedAt, errorText, progress: Array<{ stage, providerId, buckets: Buckets, total }>, budget: Usage[], estimate: Estimate | null, ledger: { calls, costMicroGbp, costPence, tiles, cacheHits, perProvider: Array<{ providerId, stage: Stage | null, calls, costMicroGbp }> }, parityBreak: boolean, overrun: boolean, disabledProviders: ProviderId[] }`; `startExecutionRequestSchema` `{ confirmCostPence?: number }`; `startExecutionResponseSchema` `{ executionId }`; `verifyCellRequestSchema` `{ definitionId, cell: CellKey }` → `startExecutionResponseSchema`.
- `results.ts`: `resultRowSchema` `{ itineraryHash: string | null; basis: ResultBasis; verdictClass: VerdictClass | 'unchecked'; pricePence; provenance; stale; ageHours; cell: Cell; outbound: Segment[] | null; inbound: Segment[] | null; totalMinutes: number | null; outboundMinutes; inboundMinutes; stopsOut; stopsIn; layovers: Layover[]; carriers: string[]; verdicts: Verdicts; unverified: ConstraintName[]; notApplied: ConstraintName[]; seller: string | null; baggage: BaggageSnapshot | null; fareConditions: FareConditions | null; selfTransfer: boolean | null; booking: Booking; searchLink: { url; host; label } | null; otherOffers: Array<{ seller; pricePence; provenance; booking; stale; ageHours; verdictClass; unverified: ConstraintName[]; notSeenInLatest: { ageHours } | null }>; notSeenInLatest: { ageHours } | null; adjustedPence: number | null; destinationNote: string | null; executionId: string; calendarPriceId: number | null; observationId: number | null }`; `resultsQuerySchema` `{ basis?: ResultBasis; executionId?: string; limit?: number ≤ 1000 }`; `resultsResponseSchema` `{ rows; total; truncated; basis; basisReason: string; executions: ExecutionSummary[]; coverage: CoverageSummary; excludedByCurrentSpace: number; verificationProviderConfigured: boolean; cheapest: ResultRow | null }`; `calendarDaySchema` `{ date: IsoDate /* departure date */; discovery: Array<{ providerId; buckets: Buckets; total }>; verification: { selected; itinerarySearched; onDemand }; cheapestVerified: (PriceCell & { cell: Cell; itineraryHash: string }) | null; cheapestPartiallyVerified: (PriceCell & { cell: Cell; itineraryHash: string; count: number }) | null; cheapestCalendar: (PriceCell & { cell: Cell }) | null; byDestination: Array<{ destination: Iata; cheapestVerified: PriceCell | null; cheapestCalendar: PriceCell | null }> }`; `calendarResponseSchema` `{ days: CalendarDay[]; executions: ExecutionSummary[]; staleAfterHours: number; calendarStaleAfterHours: Record<ProviderId, number> }`; `durationAnalysisResponseSchema` `{ byNights: Array<{ nights: number; minVerified: (PriceCell & { n: number }) | null; minCalendar: Array<{ providerId; price: PriceCell; n: number }>; searched: boolean }>; executions: ExecutionSummary[] }`; `coverageResponseSchema` `{ executionId; summary: CoverageSummary; perStage: Array<{ stage; providerId; buckets: Buckets; total; requests: { calls; cacheHits; costMicroGbp; planCalls: number | null }; overrun: boolean; parityBreak: boolean }>; selectedNotReached: Array<{ cell: Cell; reason: 'not_run' | 'skipped:budget' }>; errors: Array<{ cell: Cell; stage; providerId; reason; lastError; attempts; retryable: boolean }>; scheduleBlockedSince: IsoDateTime | null }`; `calendarGapResponseSchema` `{ cheapestVerified: (PriceCell & { cell: Cell; itineraryHash: string }) | null; cells: Array<{ cell: Cell; calendar: PriceCell; verifyAvailable: boolean }> }`; `routeHistoryQuerySchema` `{ cabin?: Cabin }`; the calendar route takes no query (both bases are returned per day); `HistoryPoint` and `RouteSeriesPoint` are exported types; `cellDetailResponseSchema` `{ cell: Cell; outcomes: CellOutcome[]; calendarPrices: Array<PriceCell & { executionId; calendarPriceId }>; observations: Array<ResultRow> }`; `historyPointSchema` `{ at: IsoDateTime; pricePence; provenance: Provenance }`; `routeSeriesPointSchema` `{ date: IsoDate; pricePence; currency: 'GBP'; fetchedAt: IsoDateTime; providerId; sourceKind; pointOfSale: PointOfSale; fx: { converted: false } }` (the provenance every price carries; the series' cabin names it; plotted by `date`, indicative, never a PriceCell); `itineraryHistoryResponseSchema` `{ itineraryHash; series: Array<{ providerId; seller; cabin; points: HistoryPoint[] }> }`; `routeHistoryResponseSchema` `{ origin; destination; calendarSeries: Array<{ providerId; cabin; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> /* one point per execution fetch: the pair's minimum across its cells */; routeSeries: Array<{ providerId; cabin: Cabin | 'unknown'; points: RouteSeriesPoint[] }> }`.
- `alerts.ts`: `alertRuleSchema` (`AlertRule`; `requireAllVerified` only on basis `verified`; `cooldownHours` default 336; `thresholdPence` required for `absolute` and `dropAbs`, `pct` for `dropPct`), `alertRuleInputSchema`, `alertEventSchema`, `alertEventsQuerySchema` `{ ruleId?; definitionId?; limit? }`.
- `system.ts`: `healthResponseSchema = z.union([healthPublicSchema, healthDetailSchema])` where public is `{ ok: boolean; degraded: boolean }` and detail `{ ok; degraded; db: { ok; path: never /* no path leaks */; sizeBytes }; providers: Array<{ providerId; configured; healthy: boolean | null }>; scheduler: { jobCount; nextRun; lastExecutionAt; degraded; blockedSince: IsoDateTime | null } }`; `providersResponseSchema` `{ providers: Array<{ providerId; displayName; enabled; capabilities: { discovery: CapabilityInfo | null; verification: CapabilityInfo | null }; plan: PlanId | 'free' | 'synthetic'; usage: Usage[]; excludedFromSchedule: boolean; notices: string[] }>; synthetic: boolean; presets: { policy: Pick<VerificationPolicy, 'maxCells' | 'topN' | 'expandTop' | 'bookingLinks'>; providers: ProvidersConfig; budget: ExecutionBudget; discoveryRefreshHours: number; schedulerTimezone: string }; pointOfSale: string }`; `budgetResponseSchema` `{ scopes: Usage[]; monthlyCapMicroGbp; monthlyCapPence; fixedFeesMicroGbp; ceilingNote: string }`; `schedulerJobsResponseSchema` `{ jobs: Array<SchedulerJob> }` with `schedulerJobSchema` exported and `SchedulerJob = { id: string; kind: 'definition' | 'resume'; definitionId: string; executionId: string | null; cron: string | null; tz: string; nextRun: IsoDateTime | null }`; `toolRecordRequestSchema` `{ budget: number; origins: Iata[]; destinations: Iata[]; month: IsoMonth }`; `toolSmokeRequestSchema` `{ origin: Iata; destination: Iata }`; `toolRunResponseSchema` `{ exitCode: number; summary: string; lines: string[]; fixturesWritten: string[] }`.
- `index.ts`: `ROUTES` with one entry per spec §10 row (rev 10, `/api` prefix, plus `GET /api/airports` and `POST /api/definitions/estimate`). `POST /api/tools/smoke` is mounted by WP13, `POST /api/tools/record` by WP8.

### Database (`@gmt/db`, WP0 skeleton, WP3 everything else)

```ts
// client.ts (WP0)
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T extends Promise<unknown> ? never : T): T; immediateTransaction<T>(fn: () => T extends Promise<unknown> ? never : T): T /* BEGIN IMMEDIATE, same Promise guard */; checkpoint(): void; close(): void }
export function openDatabase(path: string): Db;   // throws WalUnavailableError when a file db cannot hold WAL (dm-003); the app bootstrap exits 73
export class WalUnavailableError extends Error {}
export function pendingMigrations(db: Db, migrationsDir: string): string[];      // migrate.ts (WP0): names of unapplied migration files
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
// repositories (WP3)
export interface RepoOptions { allowSynthetic: boolean }    // from syntheticAllowed(config); repositories throw on synthetic rows when false
export interface Repos { airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo; calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo; notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo }
export function createRepos(db: Db, clock: Clock, opts: RepoOptions): Repos;   // Repos lives HERE, not in engine
export interface Airport { iata: Iata; icao: string | null; name: string; city: string; country: string; tz: string; lat: number; lon: number; metro: string | null; source: string; datasetVersion: string }
export interface AirportsDataset { version: string; airports: Array<Omit<Airport, 'source' | 'datasetVersion'>>; metros: Record<string, string[]> /* metro → airports, from the vendored attributed list */ }
export class AirportsRepo { exists(iata): boolean; get(iata): Airport | null; search(q: string, limit: number): Airport[]; metroOf(iata): string | null; airportsOfMetro(code: string): Iata[]; sharedMetro(iatas: Iata[]): string | null; count(): number; upsertAll(dataset: AirportsDataset): void; datasetVersion(): string | null; tzOf(iata): string | null }
export class FxRepo { rateNano(date: IsoDate, currency: string): number | null; latest(currency: string, maxAgeDays: number, today: IsoDate): { rateNano: number; date: IsoDate; source: string } | null; upsert(rows: Array<{ date: IsoDate; currency: string; rateNano: number; source: string }>): void }
export class DefinitionsRepo { create(input: DefinitionInput & { confirmedCostPence?: number }): SearchDefinition; update(id, patch: Partial<DefinitionInput>): SearchDefinition; get(id): SearchDefinition | null; list(opts?: { includeDeleted?: boolean }): SearchDefinition[]; softDelete(id): void; setConfirmed(id, confirmed: { pence: number; calls: number } | null): void /* decision 43 */ }
export type ExecutionCreateInput = { definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; estimate: Estimate | null; trigger: Execution['trigger']; status: 'pending' | 'running' | ExecutionStatus & `skipped_${string}` }
export type ExecutionPatch = Partial<Pick<Execution, 'stage' | 'resumeAfter' | 'errorText' | 'startedAt' | 'finishedAt' | 'cancelRequested' | 'estimate' | 'snapshot'>>
export class ExecutionsRepo { create(input: ExecutionCreateInput): Execution; get(id): Execution | null; listForDefinition(definitionId, opts: { limit: number; includeChildren: boolean }): Execution[]; listByStatus(statuses: ExecutionStatus[]): Execution[]; activeParent(definitionId): Execution | null; activeChild(definitionId, cell: CellKey): Execution | null; latestCompleted(definitionId): Execution | null; claimResume(id): boolean; setStatus(id, status: ExecutionStatus, patch?: ExecutionPatch): void; patch(id, patch: ExecutionPatch): void; requestCancel(id): void; bootSweep(bootAt: IsoDateTime): { interrupted: string[] }; incrementAutoResume(id): number; resetAutoResume(id): void; lastScheduledFiring(definitionId): IsoDateTime | null }
export interface TileWrite { tileIndex: number; cells: CellKey[]; prices: CalendarPriceInsert[]; outcomes: Array<Pick<CellOutcome, 'origin' | 'destination' | 'departureDate' | 'returnDate' | 'status' | 'reason' | 'lastError' | 'fetchedAt' | 'minPence' | 'cabin' | 'pointOfSale' | 'sourceKind'>>; discards: number }
export interface CalendarPriceInsert { providerId; sourceKind; cabin; cell: CellKey; pricePence; priceNativeMinor; currencyNative; fx: FxInfo; pointOfSale; fetchedAt; providerObservedAt: IsoDateTime | null; maxAgeHours: number | null; vendorLink: string | null; reusedFromExecutionId: string | null }
export interface CalendarPriceRow extends CalendarPriceInsert { id: number; executionId: string; provenance: Provenance }
export interface VerifiedCellWrite { cell: CellKey; outcome: TileWrite['outcomes'][number]; itineraries: Array<{ itinerary: NormalisedItinerary; offers: Array<{ offer: Offer; observation: ObservationFields & { provenance: Provenance; suppliedFields: SuppliedField[]; partialExpansion: boolean } }> }> }   // best_observation_id = the cheapest observation written; the write applies the §6.6 monotone merge and never downgrades priced to empty
export interface ReusedCopy { cell: CellKey; outcome: CellOutcome; price: CalendarPriceRow | null }
export class CellsRepo { seed(executionId, cells: Cell[], discoveryProviders: ProviderId[]): void; seedVerification(executionId, selected: Array<{ cell: CellKey; reason: SelectionReason }>, allCells: CellKey[], verificationProviders: ProviderId[]): void; outcomes(executionId, filter?: { stage?: Stage; providerId?: ProviderId; cells?: CellKey[] }): CellOutcome[]; resumable(executionId, stage, providerId, manual: boolean): CellKey[]; markDeparted(executionId, today: IsoDate): number; markNoData(executionId, stage, providerId, reason: NoDataReason): number; writeTile(executionId, providerId, w: TileWrite): void; writeTileError(executionId, providerId, cells: CellKey[], reason: string, lastError: string | null): void; writeVerifiedCell(executionId, providerId, w: VerifiedCellWrite): void; setOutcome(executionId, cell, stage, providerId, patch: Partial<CellOutcome> & { incrementAttempts?: boolean }): void; setOutcomesForProvider(executionId, stage, providerId, from: CellOutcomeStatus[], to: { status; reason }): number; copyReused(executionId, providerId, copies: ReusedCopy[], criteria: ReuseCriteria): void; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; bucketsPerDay(executionId): Map<IsoDate, Array<{ stage; providerId; buckets: Buckets; total }>>; selected(executionId): Array<{ cell: CellKey; reason: SelectionReason }>; hasVerificationOutcomes(executionId): boolean }
export class CalendarPricesRepo { insert(executionId, rows: CalendarPriceInsert[]): number[]; latestPerCell(definitionId, cabin, space: ResolvedSpace | null): CalendarPriceRow[]; fetchedBy(executionId): CalendarPriceRow[] /* reused excluded */; previousFor(definitionId, providerId, cabin, cell, before: IsoDateTime, notOlderThan: IsoDateTime): CalendarPriceRow | null; reuseCandidates(definitionId, providerId, cabin, pointOfSale, sourceKind, cells: CellKey[], newerThan: IsoDateTime): ReusedCopy[]; history(origin, destination, cabin, opts?: { definitionId?: string }): Array<{ providerId; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> /* per provider, one point per execution fetch: the minimum across the pair's cells (within the definition's resolved space when given); reused rows excluded */; belowVerified(definitionId, cabin, space, thresholdPence): CalendarPriceRow[] }
export interface ObservationRow extends Observation { offer: Offer & { id: number }; itinerary: NormalisedItinerary; cell: Cell; seller: string }
export class ItinerariesRepo { upsertItinerary(it: NormalisedItinerary): void; recordObservation(offer: Offer, obs: Omit<Observation, 'id' | 'offerId'>): { offerId: number; observationId: number }; get(hash): (NormalisedItinerary & { firstSeenAt }) | null; observationsForDefinition(definitionId, opts: { executionIds: string[] | 'all'; space: ResolvedSpace | null; cabin: Cabin; includeChildren: boolean }): ObservationRow[]; writtenBy(executionId): ObservationRow[]; previousObservation(offerId: number, before: IsoDateTime): Observation | null; offerHistory(hash): Array<{ providerId; seller; cabin; points: HistoryPoint[] }>; latestVerificationOutcomeForCell(definitionId, cell, cabin: Cabin): CellOutcome | null; bestObservationForCell(executionId, cell): number | null }
export class LedgerRepo { countsFor(executionId): { calls: number /* upstream attempts, not cap usage */; costMicroGbp: number; tiles: number /* first-attempt upstream rows only; parity = tiles + cacheHits */; cacheHits: number; perProvider: Array<{ providerId; stage: Stage | null; calls; costMicroGbp; tiles; cacheHits }> }; firstAttemptTiles(executionId, providerId): number; sweepPending(olderThan: IsoDateTime): number; pruneCacheHits(olderThan: IsoDateTime, providerIds: ProviderId[]): number }
export class AlertsRepo { rules(definitionId?: string): AlertRule[]; get(id): AlertRule | null; create(input: AlertRuleInput): AlertRule; update(id, patch: Partial<AlertRuleInput>): AlertRule; softDelete(id): void /* alert_rules.deleted_at; events are kept */; events(filter: { ruleId?: string; definitionId?: string; limit: number }): AlertEvent[]; priorFirings(ruleId, identityKeys: string[], since: IsoDateTime): PriorFiring[]; insertEvent(e: Omit<AlertEvent, 'id'>): number }
export class NotificationsRepo { wasSent(kind: OperatorMessageKind, executionId: string | null, definitionId: string): boolean; lastSent(kind, definitionId): IsoDateTime | null; record(kind, executionId, definitionId, status: 'sent' | 'failed'): void }
export class RoutePriceHistoryRepo { upsert(rows: Array<{ origin; destination; trip: { departureDate: IsoDate; returnDate: IsoDate }; cabin: Cabin; providerId; date: IsoDate; lowestPricePence: number; currency: string /* refused unless 'GBP' */; fetchedAt: IsoDateTime; pointOfSale: PointOfSale }>): void; series(origin, destination, providerId, cabin: Cabin | 'unknown'): Array<{ trip: { departureDate: IsoDate; returnDate: IsoDate } | null /* migrated rows: trip unknown */; points: RouteSeriesPoint[] }> }   // keyed by trip (decision 67, ruling 6; migration 0003); point of sale per point (migration 0004)
export interface BudgetConfig { providers: Partial<Record<ProviderId, ProviderLimits & { billable: boolean; trialUsed: number }>>; spend: Config['spend'] }   // trialUsed seeds a lifetime window: effective cap = monthlyCallCap − trialUsed; the fixture cost is providers.fixture.costPerCallMicroGbp
export function budgetConfigFromConfig(c: Config): BudgetConfig;
export class SqliteBudgetGuard implements BudgetGuard { constructor(db: Db, config: BudgetConfig, clock: Clock) }   // execution caps read from the execution's snapshot budget; reserve refuses a costMicroGbp that differs from the provider's configured per-call rate (rule 'cost'); predicates and the pending insert run inside Db.immediateTransaction
export class SqliteResponseCache implements ResponseCache { constructor(db: Db, clock: Clock) }
export class AppLock { constructor(db: Db, holder: 'app' | 'tool', clock: Clock, log: Logger); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void; static inspect(db: Db): { holder; heartbeatAt; acquiredAt } | null }
export function seedAirports(db: Db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };
export function sanityCheckAirports(db: Db, referenced: Iata[]): { ok: true } | { ok: false; reason: string };
export function runMaintenance(db: Db, clock: Clock, log: Logger, opts: { lifetimeProviders: ProviderId[] }): { cacheRowsDeleted: number; ledgerRowsPruned: number; dbBytes: number };
export function loadAirportsDataset(dir: string): AirportsDataset;   // reads airports.<version>.json + metros.json (CC BY-SA attributed list of IATA metropolitan codes) from packages/db/data
export function backupDatabase(dbPath: string, backupsDir: string, opts: { keep: number; clock: Clock }): { file: string };   // src/backup.ts (WP3): VACUUM INTO a timestamped file, PRAGMA integrity_check on the output, refuse an existing target, prune to `keep`; throws on any failure. scripts/backup.mjs (WP12) is a CLI wrapper; both bootstraps call it before buildPorts when pendingMigrations() is non-empty and the DB file exists.
```

Schema additions over spec §7 (rev 10 records them; rev 28 records the next two; rev 29 the last): `search_definitions.confirmed_calls` (set with `confirmed_cost_pence` from the same confirmation, decisions 37, 43; migration 0001), `route_price_history.departure_date` and `.return_date` (the searched trip, NULL on rows migrated without one; decision 67, migration 0003), `route_price_history.point_of_sale` (the search's point of sale, 'unknown' on rows migrated without one; migration 0004), `search_definitions.destination_notes_json`, `search_cells.discovery_reason`, `search_cells.verification_reason`, `search_cells.verification_min_pence`, `search_executions.trigger`, `search_executions.created_at`, `itineraries.layovers_json`, `fx_rates.source`, `operator_notifications.definition_id`, `provider_cache.provider_id NULL`, `route_price_history.cabin` allows `'unknown'`, `alert_rules.deleted_at`; the `providers` table is removed (spec rev 11; provider state comes from config); `cell_outcomes` carries the provider⇔kind CHECK and the provenance CHECK for priced/empty rows. `search_cells.best_observation_id` is the cheapest observation written for the cell (verdicts are computed at read time, so "cheapest verified" is a read-time query, never this column).

### http-kit (`@gmt/providers` `http/httpKit.ts`, WP4)

```ts
export interface ResponseFacts { status: number; body: unknown /* scrubbed */; headers: Headers; providerId: ProviderId | 'fx'; endpointPath: string }
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never' /* in http-kit: governs timeout retryability only; the ledger's billable flag is WP3's */; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; rateLimitFallbackWaitSeconds?: number /* wait for a 429 without Retry-After; absent → the first such 429 is non-retryable rate-limit with retryAfterSeconds = seconds to the hourly refresh */; classifyError?: (f: ResponseFacts) => ProviderError | undefined /* undefined → the default spec §5.2 table; http-kit applies Retry-After, limiter-timeout and scrubbing to whichever error results */ }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[] /* non-empty whenever a real provider is configured */; syntheticAllowed: boolean /* required true for inProcessHosts or limits.fixture */; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
// inProcessHosts: wiring passes { 'fixture.local': fixtureRouter(root).fetch } only under syntheticAllowed; http-kit dispatches requests whose hostname is a key here to that function instead of globalThis.fetch. Every other step of the pipeline (limiter, reserve, finalise, cache, recorder) still runs. This is the only transport seam and it is gated by the synthetic rule.
export interface HttpKitRequest { providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never' /* accept vetoes caching a body the adapter cannot parse; null or empty bodies are never cached */; signal: AbortSignal; recordFixtures: boolean }
// In-flight dedup: a joiner records its own recordCacheHit row (own executionId/tileIndex; not for fx), is raced against its own signal, and re-issues the request when the shared call ends in the leader's AbortedError or a BudgetExceeded on another execution's scope.
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
// 'fx' requests skip budget.reserve/recordCacheHit entirely (never ledgered) but keep the limiter, allowlist, timeout and retry.
// Per-request timeout: setTimeout + AbortController (fakeable), non-retryable when billable === 'http-200'.
export interface RecordedFixture { recordedAt: IsoDateTime /* the response's fetchedAt, passed through the hook */; recordedBy: string; session: string /* the recorder's creation instant plus a random suffix; placeholders carry it and replay filters by it */; providerId: string; endpointPath: string; request: { method: string; url: string /* credential-free, query kept */; headers: Record<string, string> /* scrubbed */; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; contentSha256: string }
export interface FixtureRecorder { record(r: { providerId: ProviderId | 'fx'; endpointPath: string; request: HttpKitRequest; status: number; body: unknown; fetchedAt: IsoDateTime }): Promise<string /* path written */> }
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;   // files: <root>/<providerId>/<endpointPath with / → _>/<yyyy-mm-dd>-<sha12>.json; raw bodies to *.raw.json beside them (gitignored)
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string;
export function withContentHash<T extends object>(file: T): T & { contentSha256: string };   // main barrel (WP4b): the allowlist writer hashes with WP4's own code
export function assertRecordedRoot(root: string): string;   // main barrel (WP4b): the real root, refused unless it exists and ends in fixtures/recorded; shared by the recorder, the readers and WP4b's allowlist writer
export function secretForms(value: string): string[];   // main barrel (WP4b): the one list of a secret's textual forms, from the leaf src/http/secretForms.ts that scripts/secret-scan.mjs also imports
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;
export function stripUrl(url: string): string;
export function canonicalCacheKey(r: HttpKitRequest, secrets: Secret[]): string;   // sha256 over method + credential-free URL (query kept) + scrubbed headers + body only; never executionId or tileIndex, so an identical request from another execution inside the TTL is a cache hit
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string /* '<path>' or '<path>?engine=<value>' for vendors that multiplex engines on one path */, { names: string[] /* ascending */; values: Record<string, string[] | 'any'> }>; contentSha256: string }   // src/params/allowlist.ts (WP4): the type, loadParamsAllowlist(path), assertRequestAllowed(allowlist, endpointPath, url) picks the most specific matching key
// RecordedFixture.request.headers DROPS credential headers entirely (Authorization, X-Access-Token) rather than scrubbing their values, so the secret scan's header-name rule passes.
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: SyntheticGateInput; costMicroGbp: number }): FlightProvider;
export function fixtureRouter(root: string, gate: SyntheticGateInput): Hono;   // '@gmt/providers/fixture' subpath (not the main barrel); throws unless syntheticAllowed(gate); scenario control via POST /__fixture/scenario, the x-fixture-scenario header, and hold/release (POST /__fixture/release) so WP7 needs no second request layer; paged-calendar and chained-verification options exist for layer-A parity tests
// '@gmt/providers/testing' subpath export (src/testing/index.ts): fixtureHandlers(root, gate): RequestHandler[]; replayHandlers(recordedRoot, opts?: { session?: string }): { handlers: RequestHandler[]; misses(): string[] } (serves fixtures/recorded by matching method, path and credential-free query with placeholders as recorded; a miss is logged and answered with HttpResponse.error(), never passed through to the network; a match key served by more than one session is refused at construction unless `session` picks one; every consumer asserts misses() is empty in afterEach); loadRecorded(root, providerId, endpointPath): RecordedFixture[]; withContentHash (also on the main barrel, below). msw is a dependency of the package (not dev) because this subpath imports it; production code never imports the subpath (boundary script asserts).
```

Adapter constructors and exports (WP5, WP6):

```ts
export function searchApiProvider(o: { http: HttpKit; log: Logger; clock: Clock; key: Secret; costPerCallMicroGbp: number; pointOfSale: string; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist }): FlightProvider;
export function searchApiHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // hosts ['www.searchapi.io'], billable 'http-200', classifyError for the recorded 401/400 bodies and 429 quota discrimination
export const SEARCHAPI_PARAMS: ParamsAllowlist;   // code constant; a test asserts it equals fixtures/recorded/searchapi/params-<date>.json
export function travelpayoutsProvider(o: { http: HttpKit; log: Logger; clock: Clock; token: Secret; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist }): FlightProvider;   // airport-pair queries only (decision 34); cacheTtlSeconds ≤ 48 h
export function travelpayoutsHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // hosts ['api.travelpayouts.com'], billable 'never'; no classifyError (default table maps 401 → auth)
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist;
```

### Core domain functions (WP1, WP2)

```ts
// WP1 (dates/, space/, coverage/, selection/)
export function toEpochDay(d: IsoDate): number; export function fromEpochDay(n: number): IsoDate; export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number /* b − a */; export function monthOf(d: IsoDate): IsoMonth; export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[]; export function isLeapYear(y: number): boolean;
export function resolveWindow(w: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean };
export function generateCells(space: ResolvedSpace): Cell[]; export function countCells(space: ResolvedSpace): number;
export interface AirportLookup { exists(iata: Iata): boolean; metroOf(iata: Iata): string | null; airportsOfMetro(code: string): Iata[] }
export type ValidationResult = { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] } | { ok: false; errors: Array<{ field: string; message: string }> };
export function validateSearchSpace(def: Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'>, todayLondon: IsoDate, lookup: AirportLookup, maxCells: number): ValidationResult;
export function rollUp(outcomes: CellOutcome[]): RollUp; export function mergeWithinProvider(a: CellOutcome, b: CellOutcome): CellOutcome;
export function sixBuckets(outcomes: CellOutcome[]): Buckets /* one stage, one provider, one execution; the reference oracle WP3's SQL counts are asserted against */; export function selectedNotReached(selected: CellKey[], outcomes: CellOutcome[]): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }>;   // throws when a selected cell has no verification rows
export function selectCandidates(policy: VerificationPolicy, cells: Cell[], discovery: Map<string, RollUp>, hasDiscoveryProvider: boolean): Array<{ cell: CellKey; reason: SelectionReason }>;   // throws RangeError unless maxCells/topN/perDepartureDateBest are non-negative integers and deduplicated in-space alwaysInclude ≤ maxCells; the stride walks only cells not already chosen
// rollUp rules settled: a priced roll-up carries 'partial-expansion' when any priced input has it; no_data outcomes with reason 'cabin-not-offered' are ignored whenever any other outcome exists and the roll-up is no_data:cabin-not-offered only when all are; error carries the reason when all agree, else 'mixed'; mergeWithinProvider keeps every field with the input that supplies the minimum price, replaces a reused outcome outright with a fresh priced, empty or no_data one (no min-merge against a reused copy, spec §6.6 rev 11; a fresh error never displaces a reused or fresh stronger result, it only counts an attempt) and throws on a priced input without minPence; WP3's write transactions call rollUp and mergeWithinProvider (no SQL copy)
// WP2 (normalise/, constraints/, results/, alerts/)
export function canonicalCarrier(s: string): string; export function canonicalFlightNumber(s: string | number, carrier?: string): number;
export function departLocal(input: string, timeKind: 'local' | 'utc' | 'offset', tz: string): string; export function toIsoDateTime(input: string, timeKind: 'local' | 'utc' | 'offset', tz: string): IsoDateTime;
export function itineraryHash(outbound: Segment[], inbound: Segment[]): string;
export const MINOR_EXPONENT: Record<string, number>; export const ECB_CURRENCIES: readonly string[]; export function toGbp(amountMinor: number, currency: string, rateNano: number): number;
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export const SEARCH_LINK_LABEL = 'search link, not a fare link'; export function validateVendorUrl(url: string, allowlist: string[]): Booking /* https only, no userinfo, no port, host equal to or subdomain of an entry, ≤ 2048 chars; POST postData ≤ 4096 */; export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url: string; host: string; label: string } | null /* null for 'fixture' */;
export function hasControlChars(s: string): boolean; export function stripControlChars(s: string, replacement = ''): string;   // src/text/control.ts: Unicode Cc set, code-point scan, no regex; WP11 wraps it for email headers
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;   // spec §7 providers_json default; WP7 imports it, no local copy
export function formatPence(pence: number): string;   // src/text/money.ts: en-GB grouping, whole pounds when exact ('£412', '£1,234'), two decimals otherwise ('£412.50'); throws on non-integer or negative; the single money formatter (web and email import it)
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // src/constraints/labels.ts: plain-English labels; completeness test
export interface NormaliseDeps { providerId: ProviderId; cabin: Cabin; tzOf(iata: Iata): string | null; rateFor(currency: string): { rateNano: number; rateDate: IsoDate; source: string } | null }
export function normaliseOffer(raw: RawOffer, cell: CellKey, deps: NormaliseDeps): { ok: true; itinerary: NormalisedItinerary; offer: Offer; observation: ObservationFields } | { ok: false; error: NormalisationError };
export function evaluateConstraints(it: NormalisedItinerary, obs: ObservationFields & { segmentCabins: Cabin[] | null }, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts; export function verdictClass(v: Verdicts): VerdictClass; export function unverifiedNames(v: Verdicts): ConstraintName[];
export type ResultRow = z.infer<typeof resultRowSchema>; export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted'; export interface ResultFilters { verdictClass?: Array<VerdictClass | 'unchecked'>; unverified?: ConstraintName[]; providerId?: ProviderId[]; maxStops?: number; carriers?: string[]; destination?: Iata[]; maxPricePence?: number; nights?: { min: number; max: number }; hideStale?: boolean }
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;   // itineraryHash, or `calendar:${calendarPriceId}`; the web's `?row=` parameter and email links use it
export function dedupByItinerary(rows: ResultRow[], now: IsoDateTime): ResultRow[] /* primary offer by class, then seen-in-latest, then price, then fresher age, then seller (code-unit compare) */; export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[] /* class, seen-in-latest, price, age, seller; stale rows are labelled, never demoted */; export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[]; export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[]; export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string /* resultRowKey */> /* skips failed and notSeenInLatest rows; unchecked rows are eligible */;
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], prior: PriorFiring[], ctx: { now: IsoDateTime; executionId: string; cabin: Cabin; discoveryRefreshHours: Partial<Record<ProviderId, number>> }): Firing[];   // settles each identity on its cheapest eligible candidate before judging; returns suppressed firings with `suppressed` set; within the cooldown the same identity fires again only when the new price is at least max(£10, 5%) below the last fired price (spec §6.8 rev 11)
export function identityKey(rule: AlertRule, c: AlertCandidate): string; export function dedupKey(identityKey: string, pricePence: number): string; export function isSuppressed(f: Pick<Firing, 'identityKey' | 'dedupKey' | 'candidate'>, prior: PriorFiring[], cooldownHours: number, now: IsoDateTime): { suppressed: boolean; reason: string | null };
export function buildDigest(rule: AlertRule, firings: Firing[], ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] }): AlertDigest | null;   // null when no firing; top 10 + restCount
```

### Engine (`@gmt/engine`, WP7; alerts in WP11)

```ts
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export interface EngineOptions { alerts?: AlertsStepHook; providerConcurrency?: Partial<Record<ProviderId, number>> /* tests; production reads config limits */ }
export type AlertsStepHook = (deps: EngineDeps, executionId: string) => Promise<{ digests: number; events: number }>;   // WP11 provides runAlerts; default noAlerts
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled'; message: string; details: unknown };
export type Estimate = z.infer<typeof estimateSchema>; export type BudgetFit = z.infer<typeof budgetFitSchema>; export type SchedulerJob = z.infer<typeof schedulerJobSchema>;
export interface Engine { boot(): Promise<void>; shutdown(): Promise<void>; start(definitionId, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number }): Promise<StartResult>; resume(executionId, opts: { manual: boolean }): Promise<StartResult>; cancel(executionId): Promise<boolean>; verifyCell(definitionId, cell: CellKey, opts?: VerifyCellOptions /* { confirmCostPence?; confirmCalls? } */): Promise<StartResult>; childCapPreview(definitionId, cell: CellKey): { ok: true; maxCalls: number; headroomCalls: number } | { ok: false; code: 'not_found' | 'window'; message: string } /* decision 45 */; estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate; estimateRemaining(executionId): Estimate; budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit; coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>; scheduler: { register(def: SearchDefinition): void; unregister(definitionId): void; jobs(): SchedulerJob[]; tick(definitionId): Promise<void>; blockedSince(): IsoDateTime | null }; status(): { running: string[]; degraded: boolean; nextRun: IsoDateTime | null; lastExecutionAt: IsoDateTime | null } }
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;   // boot() makes no network call (FX refresh is a scheduled job that runs after boot)
export function parseCron(expr: string, tz: string): { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };
export class LogNotifier implements Notifier { constructor(log: Logger) }
export function renderOperatorMessage(kind: OperatorMessageKind, ctx: {...}): { subject: string; body: string };   // engine/src/notifiers/operatorTemplates.ts
// A child execution's snapshot budget is the definition's budget with only maxCalls replaced by the child cap (per-cell estimate × retry factor, raised to CHILD_MAX_CALLS, never above the headroom; a 0-call definition gets no child, decision 67 ruling 9); a child never pauses: on a cap breach it ends `cancelled` with its cell `skipped:budget`; its policy is { maxCells: 1, topN: 1, alwaysInclude: [cell] } with discovery [] so the stored snapshot satisfies the save-time refinements. Route calendar history covers parent executions only (children never discover).
// Rules settled: manual resume of a paused_budget execution-* breach copies the definition's CURRENT budget into the snapshot (only `budget`), then re-checks caps (spec rev 10). Executions whose definition is soft-deleted are never auto-resumed and never scheduled (the record tool's hidden definition relies on this). Supersede of a reused row is enforced in writeTile as a safety net even though the plan never re-fetches a reused cell.
```

### Wiring and bootstraps (`apps/api`, WP4b and WP8)

```ts
// src/wiring.ts (WP4b)
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[]; recorder: FixtureRecorder | null; fixtureRoot: string | null }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string; fixtureRoot?: string }): Ports;   // opens DB, applies migrations (callers run the backup preflight first), createRepos, guard, cache, http-kit with httpLimitsFor(config), providersFor(config, http, ...)
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];   // WP4b writes it with fixture + fx; WP5 and WP6 each add their provider's line (a Modify in their briefs)
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock }): FlightProvider[];   // same ownership rule
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;   // parseConfig + tolerantRealpath; throws listing every bad field
export function createLogger(config: Pick<Config, 'logLevel'>, opts?: { destination?: NodeJS.WritableStream; fd?: 1 | 2; secrets?: readonly Secret[] }): Logger;   // src/logger.ts (WP4b): pino with the spec §14 redact paths, every configured secret scrubbed
// src/bootstrap/tool.ts (WP4b): export async function runTool(name: 'record' | 'smoke', argv: string[]): Promise<number /* exit code */>; `--dry-run` builds ports and takes the lock without any vendor call
// Exit codes (one table for every CLI): 0 ok; smoke 1 provider error, 2 zero providers, 3 empty; 64 usage/bad arguments; 65 `spendRefused`: a recording or smoke run refused for spend: credits already ledgered to earlier tool runs plus this run's worst case exceed `--budget` without `--confirm-rerun`, or a provider window with less room than the run's worst case; 70 refused under NODE_ENV=test or while the synthetic gate is open; 73 the data directory or backups directory is unwritable or the preflight is impossible; 74 backup failed; 75 app_lock refused; 78 bad config. Backups are written to `<dirname(dbPath)>/backups`.
// src/tools/record.ts (WP4b): export async function recordFixtures(ports: Ports, args: RecordArgs, ctx: { signal: AbortSignal }): Promise<RecordSummary>; RecordArgs = { budget: number; origins: Iata[]; destinations: Iata[]; month: IsoMonth; metro?: string }; RecordSummary = { calls: Array<{ id: string; providerId; status: number | 'skipped'; file: string | null }>; creditsUsed: number; freeCalls: number }
// src/tools/smoke.ts (WP13): export async function runSmoke(ports: Ports, cli: SmokeCli, opts: { signal: AbortSignal; fixtures: { root: string; recordedBy: string } | null }): Promise<SmokeResult>; exit codes 0 priced, 1 provider error, 2 zero providers, 3 empty, 64 bad arguments, 65 spend refused; its stages (discover, chain) are in smokeStages.ts (ca-011)
// src/read/*.ts (WP8): one module per read route (results, calendar, duration, coverage, coverageView, history, cell, definitions, executions, usage, rows, links, space, pick); src/tools/{args,paths,toolExecution,smoke,smokeStages,smokeArgs,smokeChecks,inProcess}.ts (WP4b, WP13): the tool arguments, recording targets, the hidden tool execution and spend checks, and the smoke
// src/bootstrap/app.ts (WP8): main(); order: refuse NODE_ENV=test → config → logger → preflight backup when pendingMigrations() is non-empty and the DB file exists (WP12's backupDatabase) → buildPorts → seed + sanity → AppLock('app') waits → createEngine(ports, { alerts: runAlerts }) → engine.boot() → serve. SIGTERM: stop accepting → engine.shutdown() → wal_checkpoint(TRUNCATE) → lock release → exit (spec §7 order).
// AppLock takeover: a fresh 'app' lock is waited on for 90 s; if it is still being heartbeated after that, boot refuses (two live apps) rather than taking over; a stale one is taken over at once.
```

### Web (`apps/web`, WP9, WP10, WP11)

`src/copy.ts` is the single string catalogue; the URL parameter `row=<resultRowKey>` selects and scrolls to a results row (email links use it); WP9 writes `docs/examples/london-new-york.json` if it is absent and WP12 owns its final content and the docs test; `scripts/check-boundaries.mjs` allowlists `apps/web/src/example.ts` and `apps/api/src/tools/workedExample.ts` (decision 36; `docs/` is not scanned) for airport literals; components import strings from it and a source guard rejects literal JSX text. `docs/examples/london-new-york.json` is the importable example; `apps/web/src/example.ts` re-exports it as `EXAMPLE_DEFINITION` via a JSON import, and `scripts/check-boundaries.mjs` allowlists that one file for airport literals. Web dependencies add `msw@3.0.3`, `@testing-library/dom@10.x`, `zod@4.6.7`. The History view plots provider series by `fetchedAt` and the route-level series by its `date`.

### Decisions taken at reconciliation (2026-10-14)

1. `iataSchema` upper-cases input; `PointOfSale` is any ISO alpha-2 code or `'unknown'`; `CellKey` is defined once; `cellKeyString` moves to WP0; `Buckets`, `Estimate`, `BudgetFit`, `SchedulerJob`, `DigestItem`, `Firing`, `AlertCandidate`, `PriorFiring` are defined above.
2. `BudgetGuard.reserve` and `recordCacheHit` carry `tileIndex` (spec rev 10). `'fx'` is never ledgered and goes through http-kit (spec §5.6 corrected). Frankfurter's host is `api.frankfurter.dev` (`/v1/latest?from=GBP`); the old `.app` host redirects, and http-kit refuses redirects.
3. `TileRequest` gains `{ kind: 'month' }`. Travelpayouts queries per airport pair (metro queries withdrawn by decision 34). Cabin-not-offered is an engine rule, not an adapter rule. SearchApi rectangles are 8 × 19 for a 12-night band (tile count unchanged).
4. The API lives under `/api`; `GET /api/airports` and `POST /api/definitions/estimate` are added; `/api/tools/smoke` is mounted by WP13; health is a union schema.
5. Per-execution caps come from the snapshot; manual resume refreshes only the snapshot's budget. The record tool runs under a hidden soft-deleted definition's execution; deleted definitions are never resumed or scheduled.
6. The recorded-fixture file format and hash field (`contentSha256`) are pinned above; parameter allowlists carry the same hash; the runtime allowlist is a code constant asserted equal to the recorded file.
7. The fixture host is reached through http-kit's gated `inProcessHosts`; `@gmt/providers/testing` is the only module that imports msw.
8. Stryker runs with its command runner (`"testRunner": "command"`, `"commandRunner": { "command": "pnpm exec vitest run --coverage.enabled=false" }`) because `@stryker-mutator/vitest-runner` 10 executes no tests under Vitest 5; `ignorePatterns` uses `"/coverage"` so `src/coverage/` is mutated. Per-task test runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>` (no coverage threshold on a partial run).
9. The `.gitignore` gains `backups/` and `*.db*`. The boundary script's `process.env` rule applies to `src/` trees and to the operator scripts under `scripts/`; only `apps/api/src/bootstrap/`, the worker's `apps/camoufox-worker/src/run.ts`, the `apps/cli` entry module (WP16b adds it to the boundary script, decision 72) and the `scripts/*.mjs` entry points read `process.env` (the operator scripts are command-line entry points like the bootstraps; the allowlist is anchored to those two locations, so a `bootstrap/` directory elsewhere or a helper nested under `scripts/` fails); `apps/api/src/wiring.ts` (`loadConfigFromEnv(env)`) and `apps/api/src/logger.ts` take the environment or config as an argument (tightened by WP4b, whose boundary script enforces it).
10. `AlertDigest` is structured; subject and body are rendered by WP11's templates. A digest with only "new" items and no firing is not sent. Validated booking and search links keep their query strings in API bodies and emails; every other URL sink is stripped.
11. The airports dataset ships with a separate attributed metro-code list (`packages/db/data/metros.json`, from Wikipedia's list of IATA metropolitan area codes, CC BY-SA 4.0, attribution file beside it). `SEARCHAPI_PLAN` `trial` keeps the lifetime window.
12. React is 19 (spec §4 updated). `APP_BASE_URL` is added to config. Smoke and record are invoked from the host with curl against the loopback port; the image has no curl.
13. Dispatch dependencies: WP6 depends on 1, 2, 4, 4b and WP5 on 1, 2, 4, 4b, 6 (WP5 consumes WP6's shared modules); WP12 depends on 8, 9 and 11 (its docs-equals-constant tests and the alert email settings); WP4b depends on 3 and 4.
42. (From the WP9 and WP10 brief revisions) The api-contract gains: `confirmedCalls` beside `confirmedCostPence` on definition create and confirm (WP8 fills from decision 37's column); `expandTop` on the execution summary ("outbounds each"); `verify: { maxCalls, headroomCalls }` on the cell detail (WP7 exposes a dry run of the child-cap calculation); `priceConfirmed` on itinerary history points; `historyPointResponseSchema` with `stale` and `truncated` (the db type keeps `historyPointSchema`). WP9's Task 9.0 (`truncated`, departure-date range filter, `formatAgo`) lands before WP8's results routes. Web names shared across WP9/WP10: `formatIsoDateShort`/`formatIsoDateLong`/`formatWeekday`, `COPY.truncatedNote`, PriceCell's `truncated` prop and `compact` variant, `ViewHeader variant="span"`.
46. (From the WP9 round-2 review) WP9's shell is the base WP10 extends, never replaces. Date formats in format.ts: `formatIsoDate` '14 Mar 2027', `formatIsoDateShort` '14 Mar', `formatIsoDateLong` 'Sun 14 Mar 2027', `formatWeekday` 'Sun' (one month and weekday table). PriceCell `compact` (day cells) keeps the amount with '≈', a short provider badge, the destination code and the stale/truncated/unconfirmed marks, and hides source words, age line and destination note; WP10 adds props to PriceCell rather than replacing it; the wide-table form that hides columns the table already shows is `besideColumns`. `ViewHeader variant="span"` is the cross-execution shape. `scripts/check-boundaries.mjs` also rejects `biome-ignore` and `eslint-disable` comments in every package; scrollable tables use a labelled region without `tabIndex`. The airport-literal check matches only string literals and template text, with a committed list of non-airport words (ISO, SQL, GMT, ALL, APG, …) that later briefs extend in their own diffs. Web types derive from the contract (no hand-written `BudgetFit`, `PlanId`, `BucketName`); `DEFAULT_DISCOVERY_REFRESH_HOURS` comes from core.
83. (Operator rulings O5 and O6 of 2026-10-23, and the final check's rulings R28–R32 on review findings ssr-008, ssr-r4-001/002/003/006, PA4-001; spec revision 36) **Browser pages load only inside a run's window by default; `CAMOUFOX_BROWSER_WINDOW` can let a resumed run keep loading them.** The app-side setting `CAMOUFOX_BROWSER_WINDOW` (in `core`'s config schema; not a shared worker setting, because the engine decides) is exactly `scheduled` or `any`; unset means `scheduled`, and any other value fails boot naming the field. It is read live at every check: a change (for example `gmt setup --reconfigure browser`, whose app restart interrupts and auto-resumes a run) applies at the next check, and cells already `scheduled_only` stay so. Under `scheduled`: migration 0007 adds `search_executions.browser_window_end` (nullable). The start transaction writes `browser_window_end` = the anchor (the later of `scheduled_for` and the run's start, so a punctual tick that starts up to the 2-minute grace after its firing never finds a small run's window already closed; for a manual run the operator starts, not a resume, its `started_at`) + 1.5 × the start estimate's total seconds. Nothing moves the end except a resume performed by the definition's own punctual live tick (the tick order resumes a paused run instead of starting; a late tick resumes without re-anchoring): it re-anchors before its window check, worked out in memory, so that firing becomes the anchor (the later of the firing and the resume) and the end is computed from the estimate of the cells still resumable; `scheduled_for` and `browser_window_end` are written by one guarded statement inside the resume's claim transaction (`UPDATE … WHERE NOT EXISTS` another parent row of the definition with that `scheduled_for`; never a catch-up, whose firing History names), so a refused resume moves neither, and when another row already holds the firing (`changes() = 0`) the pass carries on under the old window. The window is checked only (a) before a run's first `camoufox` page, (b) at any resume (manual, `resume_after`, boot, live tick), and (c) before the next `camoufox` page after a detected suspension; (a) and (c) run when the provider's rate limiter admits the page, immediately before it is sent (`ProviderContext.beforeSend`, which http-kit calls after admission), so a page that waited for its slot across a sleep is checked when it would really start, and a page the check refuses is abandoned with nothing reserved or sent. One heartbeat timer in the engine's scheduler module (every 30 s, `unref`'d, beside the minute job, no I/O) records the last wall-clock beat; a beat more than 120 s after the previous one records `suspendedAt` (the previous beat) and `resumedAt`, logs one line, and marks every execution in flight as needing a window check. Before each `camoufox` page starts, a last beat older than 120 s also counts as a detected suspension (closing the up to 30 s after a wake before the next beat). A page in flight during the suspension finishes, its result kept with its provenance unchanged, and the check runs before that run's next page; a run is never otherwise cut mid-flight, so runs interleaving page by page through the shared FIFO limiter keep their tails. A row with a null end (started before migration 0007, or with no estimate) ends at `started_at` (else `created_at`) + `STUCK_AFTER_HOURS`. One pure function, `browserWindow(execution, setting, now)` in `engine/src/scheduler/browserWindow.ts`, reads only those columns (unbounded under `any`). The resume pass applies it before `estimateRemainingFor`: past the window it first writes the remaining `camoufox` cells `skipped:scheduled_only` with `skip_detail` `outside-browser-window`, so the pass, its stored estimate and its cap checks exclude `camoufox`, and a `camoufox` provider-month block cannot refuse a resume that SearchApi can run; checks (a) and (c) do the same for a run in flight. A page already in flight finishes and is stored; the operator is told once per execution, in a notice kind of its own (`browser_window`, so the notice dedupe never lets it and a `provider_disabled` notice hide each other; migration 0007's kind CHECK): "browser pages left: this run is past its browser window", naming who fetches the cells as the cell texts do, and saying "the other providers carry on" only when another discovery provider still searches in that run with cells left to search (else "the run stops its browser part with no other discovery provider left to run"). SearchApi and Travelpayouts resume and continue normally, and the next scheduled run (or, on a definition with no schedule, the operator's next run of it) fetches the browser cells. A pass the window cut left its planned tiles unrequested on purpose, so it is no parity break. Under `any`, a run resumed by the operator, by its `resume_after` job or by the boot's auto-resume, or carrying on after the machine slept, keeps loading camoufox pages within every cap, the spacing and the cool-downs, and no window check writes `scheduled_only`. A catch-up excludes camoufox under both values (decision 79), and the gate refuses a catch-up's browser page outright whatever its cells' state. `scheduled_only` cells carry a detail code (`cell_outcomes.skip_detail`, migration 0007: `catch-up-no-browser` | `outside-browser-window`), rendered through `core`'s `scheduledOnlyText` as "<who fetches it>: <why>": who is "left for the next scheduled run" only when the definition is scheduled, enabled and its scheduled runs still use the browser provider, "left for your next run of this search" when only a run by hand would (a run the operator starts is its own anchor), otherwise "not fetched: this search no longer uses the browser provider" (`leftForOf`, read when shown; the engine's `browserLeftFor`, returned by the api as `browserLeftFor`), and only for the latest parent run's cells: an earlier run's reads "left by that run: <why>" (`scheduledOnlyPastText`); why is `SKIP_DETAIL_TEXT`'s "a catch-up loads no browser pages" or "outside this run's browser window". View D offers no Retry on a browser error a resume would only leave (one rule, `resumeLeavesBrowserCells`, with the resume); the Status worker card says "browser pages: only inside a run's window" (`scheduled`) or "browser pages: also when a run resumes" (`any`). The Status view and `gmt status` warn when two definitions using `camoufox` share a firing time ("both fire at <time>; stagger them so neither waits for the other's pages"). Owner WP16a (WP18 for the Status texts, WP16b for the setup question). WP16a also adds the setting's line to `.env.example` and its name to `docker-compose.yml`'s `environment` allowlist (compose passes only listed names); `gmt setup --reconfigure browser` (WP16b) asks "If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours? [no]", writes `any` for yes, and refuses while a run is active (naming it; `--force` states that the restart interrupts it and that the new value applies when it resumes). `docs/scheduling.md` states the rule in one sentence the docs test pins: "By default (CAMOUFOX_BROWSER_WINDOW=scheduled), browser pages load only inside a run's window: from its scheduled time, or its start when that is later (a manual run's start), to 1.5 times its estimated duration later. The window is checked at a run's first browser page, at a resume, or after the machine has slept, never while a run keeps going; a run that resumes or wakes after its window leaves the browser provider's remaining cells for the next scheduled run (or, when the definition has no schedule, for your next run of it), while SearchApi and Travelpayouts carry on. With CAMOUFOX_BROWSER_WINDOW=any, a resumed run keeps loading browser pages, within every cap, spacing and cool-down. A catch-up never loads browser pages either way." Tests (fake clock, literal instants): the schema accepts `scheduled` and `any`, defaults to `scheduled` when unset, and refuses any other value naming the field; a start writes `browser_window_end` from the start estimate; a resume pass that would add `camoufox` seconds leaves `browser_window_end` unchanged and loads no page past it; a pre-0007 scheduled row with an estimate and a null `scheduled_for` and end uses `started_at` + `STUCK_AFTER_HOURS`; a `camoufox` provider-month block past the window does not refuse a resume that SearchApi can still run; a `paused_budget` run past its window resumed by the next firing's live tick re-anchors before its window check, gets that firing as `scheduled_for`, a new end from the cells still resumable, and loads pages; when another row already holds that firing the tick's resume keeps the old window (and, past it, writes `scheduled_only`); two definitions firing at the same instant through the production `createLimiter` (fake clock), interleaving page by page and each past its own window before finishing, both finish with no `scheduled_only` cell, and the Status stagger warning appears; (fake timers and a controllable wall clock) a 15-minute suspension starting mid-page past the window lets the in-flight page finish and be stored and leaves the remaining camoufox cells `scheduled_only`; a beat 119 s late is not a suspension and one 121 s late is; with the wall clock jumped 15 min and no beat yet, a page start past the window is refused (the stale last beat counts as a suspension) and the run's remaining camoufox cells become `scheduled_only`; a suspension inside the window changes nothing; the heartbeat makes no I/O; live setting, both directions: started under `scheduled` and resumed under `any` past the window loads pages (cells already `scheduled_only` stay so), and started under `any` and resumed under `scheduled` past the window loads none; under `any` resumes past the window load pages and write no `scheduled_only`; a catch-up loads no browser page under `any`; under `scheduled` a resume inside the window loads pages, the end is inclusive (a tile at the end loads, one a millisecond later does not); a run in flight crossing its end stops issuing camoufox tiles after the page in flight, which is stored; one notice per execution; a manual run past its window and a catch-up under `any` each show their own detail text; the next scheduled run fetches the `scheduled_only` cells; a live-tick resume refused at its claim writes neither column, and one whose firing another row takes just before the claim carries on under the old window; a page held by the limiter across a 15-minute sleep past the window sends no request; a catch-up with a browser cell planted runnable loads no page; a punctual tick 115 s late with a 72 s estimate loads its page; one pass with both a closed window and a disabled provider sends both notices, in either order; on a definition with no schedule the notice and the cells name the operator's next run; a window-cut pass sends no parity notice; the heartbeat reads the Clock port; `browserWindow`, `resumeLeavesBrowserCells`, the browser gate and the heartbeat are mutation-tested.
82. (Operator ruling O4 of 2026-10-19 on review finding cost-003 and round-3 cost-r3-001 / ts3-001; spec revision 36) **The worker enforces the camoufox monthly page and scroll caps itself, across every caller.** It keeps the page and scroll counts for the current `billingMonthWindow(now, CAMOUFOX_BILLING_DAY)` (the ledger's 00:00 UTC billing-day month from `core`, not the London calendar month) in its data directory beside the pacer's last-page time (one file, 0600, written with the pacer's), counts every page it loads (the adapter's pages, the `consent` command's and `consent check`'s), refuses a page that would pass `CAMOUFOX_MONTHLY_PAGE_CAP` or a scroll that would pass `CAMOUFOX_MONTHLY_SCROLL_CAP` with the reason `monthly-cap` before loading anything (count persisted before the load; a refuse leaves counts unchanged; a corrupt, missing, unreadable or widened-mode counts file refuses start / `monthly-cap` and is not overwritten with zeros), and reports the counts in `/v1/status`. The adapter maps `monthly-cap` to `BudgetExceeded` at `provider-month`. Both caps and `CAMOUFOX_BILLING_DAY` join `SHARED_WORKER_SETTINGS`; WP16a reads them with defaults into `sharedSettings`, WP17 enforces. A second app instance in one month is reported in the Status view, not refused; each app sends its database's own random `app_instance_id` (`app_meta`, migration 0007; `MetaRepo.appInstanceId`, kept with the database's canonical path (realpathed by `MetaRepo` itself): another path is a new id) as `x-gmt-app-instance`, so a container recreate or a host rename is still one app and a copied or moved database is a second, and the property the warning protects is one app per ledger. Until WP17 the worker only reports the caps, and `.env.example` says so; WP17 restores "the worker enforces it too". `docs/api-limits.md` states that with two apps on one SearchApi key the stop is the vendor's quota, not this app's ledger, and that the money ceiling holds only because the `40usd` plan has no overage; a docs test pins the line (WP16a). The worker side is WP17's. Tests: `Promise.all` callers with one slot left admit exactly one; literal-instant London/UTC billing-day boundaries; restart round trip; mid-grid scroll-cap outcome stated; consent load counts; status read leaves counts unchanged; the adapter's mapping.
81. (Orchestrator ruling R12 of 2026-10-19 on review finding po-r2-005; round-3 ARCH-R3-001/003; spec revision 36) **WP16 is split.** **WP16a** (Opus; brief `docs/briefs/wp16a-local-mode-foundations.md`; reviewers include search-strategy-reviewer) merges first and holds what changes the product or what WP17 and WP18 both start from: migration 0007 (including the skip reason `scheduled_only`) and the catch-up (decision 79), `GET /api/executions/active`, `GET /api/tools/smoke/plan`, the moved-database marker in the app and tool bootstraps, the History label, and the `core`/`providers` pieces: `CAMOUFOX_BUILDS` with `FLAGS`, `flagsFor` and the pure start checks, `SHARED_WORKER_SETTINGS` (with the monthly caps and `CAMOUFOX_BILLING_DAY`), `effectiveSharedSettings`, `sharedSettingDiffs`, `billingMonthWindow`, `startRefusalSchema` with `START_REFUSAL_TEXT`, `workerDataDir`, every `workerStatusSchema` field WP17 will emit (shape only, `exactOptional`, plus `sharedSettings`), and `readWorkerStatus` split out of `camoufoxPreflight`, with the worker's selectors module reading its flags through `core` (no value changes), `/v1/status` reporting `sharedSettings` from effective values, and the two-apps docs line (decision 82). **WP16b** (Opus; brief `docs/briefs/wp16b-local-setup-cli.md`) holds the CLI, the services, the imports, CI and the docs, and depends on 16a; it is the only later editor of `apps/cli/src/commands/status.ts`. WP17 and WP18 depend on both and run in parallel from the same `core` schema: WP17 emits the optional worker fields, WP18 reads them when present, and neither edits the other's files.
80. (Operator rulings of 2026-10-19 on review findings pers-002, devops-r2-001/002 and sec-r2-005; spec revision 36) **`gmt update` never cuts a run short without saying so, and never stops the app before the network work it can do first.** It runs `git fetch` and checks that a fast-forward is possible while the app still runs. It then reads `GET /api/executions/active` (WP16a) with basic auth from `app.env`: with a run active, a single-cell verification included (it spends credits too), it refuses, naming the definition, the start and the estimated finish (now plus the remaining cells' estimated seconds, or "unknown"); when the read fails (no answer, a non-200 such as 401, a timeout) while the app service is active it refuses too; with the service inactive it proceeds. `--wait` polls every 60 s until no run is active. `--force` first prints what will happen: the app stops within 30 s on SIGTERM; a page or call in flight is abandoned, stays on the ledger and has its cells requested again; the run is marked interrupted at its last checkpoint without counting an auto-resume (spec §8.1's graceful-stop path), and after the restart the boot resumes it when `AUTO_RESUME` is on, or it waits for a manual resume. Then the order of spec §13: record the commit, stop, back up into `backups/update` (keep 5), merge, install, build, Camoufox (decision 73), re-render, start, wait 240 s, remove the old bundle, status. A failure at any step after the stop prints the commit, the backup and both restore paths. Tests: refusal text with and without an estimate; 401, timeout and service-stopped reads; `--wait` with a fake clock; `--force` prints before its first action; no backup before the stop; the failure message for a failing merge, install and build.
79. (Operator rulings O1 and O3 of 2026-10-19 and O5–O8 of 2026-10-23 on review findings po-004, po-r2-002, ssr-001…008, PA3-003; cost-007, devops-r2-008, ts2-001, ts2-007; spec revision 36) **A missed scheduled firing is caught up at most once, never twice, and a catch-up never loads browser pages.** One function, `findMissedFiring`, serves the boot (replacing `detectMissed`), a new system job that runs every minute, and a late live tick. For each scheduled definition it takes the latest expected firing (`previousFiring`) that is more than 2 minutes old, however old, and treats it as covered when the definition's `updated_at` is at or after it, when a row already carries it in `scheduled_for` (read first, through the firing index), when any parent execution (manual and catch-up included) was active at that instant or was created after it, except a catch-up paused at it (`paused_at`, the stored instant it last stopped running, at or before the firing; a run a late live tick has just superseded for the firing covers nothing), or when no configured provider that sells the definition's cabin, `camoufox` included, could run the definition on a schedule (then nothing is written or sent). A paused catch-up never covers a firing: that firing's row, whatever it is (its start, its catch-up or its `skipped_*` row), supersedes it in the same immediate transaction as its insert (when the guarded cancel finds a resume claimed it meanwhile, the transaction rolls back: a start is refused `active`, a skip records nothing, and neither logs a supersede nor cancels the resume job), and a lost insert rolls the supersede back. An automatic resume of a paused catch-up (its one-shot, the boot's auto-resume) first hands a firing since its `paused_at` to `findMissedFiring` (`autoResumeYields`; inside the grace the resume is re-registered just past it) and resumes only if the catch-up is still paused afterwards, so the outcome never depends on which timer fires first after a wake; both call sites go through one function (`autoResume`), which logs a throw while deciding and resumes, and reads or starts nothing once the engine is closing. After coverage, the firing is judged against the catch-up's own provider set: when `camoufox` is the only discovery provider (among those that sell the cabin) that could run the definition, it is recorded `skipped_missed` with `skip_code` `browser-only-definition`, notified once, and nothing starts. An uncovered firing is not caught up when `(next − now) < (next − firing) / 2` (cadence = next expected firing minus the missed one, both from `croner`); it is recorded as `skipped_missed` with `scheduled_for` and `skip_code` `half-cadence` and notified once. Otherwise one run starts through the normal pre-start checks and caps with `trigger 'schedule'`, `scheduled_for` the firing and `is_catch_up` 1. The live tick computes `firing = previousFiring(expr, tz, now + 2 s)` (the second before a firing counts as that firing), writes it as `scheduled_for` at millisecond precision, and when `now − firing` exceeds the 2-minute grace (one predicate, `pastGrace`, shared with `findMissedFiring`) runs the same tick order (the stale-run supersede, the resume without re-anchoring, the "blocked since" record) and defers to the catch-up in place of the start (croner 10.x re-checks every 30 s and would otherwise fire an overdue tick as a full scheduled run), so a machine asleep at every firing still recovers from a stale paused run. When the active run at a firing is a paused catch-up, the firing's row supersedes it. The minute job and the boot isolate each definition (one that throws is logged; the rest proceed; the boot still registers its job); the engine's shutdown refuses new starts, resumes and verifications from its first moment, stops every run taking new provider work, waits for scheduler callbacks already running at most the SMTP connection and greeting timeouts plus 2 s, then hands the database back (a callback past the wait writes nothing: a late notice is logged once and not recorded, a late window skip disables no schedule); the app marks the engine closed (`Engine.markClosed`) before closing the database, even past its deadline. Migration 0007 adds the nullable `scheduled_for` (also set by every live tick's start or skip), `is_catch_up` (default 0, no backfill), `paused_at` (a row already paused or interrupted takes its last activity), the partial in-flight index, the unique index `(definition_id, scheduled_for) WHERE is_child = 0 AND scheduled_for IS NOT NULL`, and rebuilds `cell_outcomes` so its skip-reason CHECK admits `scheduled_only` (`SkipReason`, `SKIP_RANK`) with a nullable `skip_detail` (`catch-up-no-browser` | `outside-browser-window`), whose label is `scheduledOnlyText`'s "<who fetches it>: <why>" (decision 83), and adds `skip_code` (`half-cadence` | `browser-only-definition`) to `search_executions` for `skipped_missed` rows. Every scheduled start or skip inserts through the index (`INSERT … ON CONFLICT DO NOTHING`; `changes() = 0` → `firing-taken`), and the loser of a race no-ops; the start side of the rule lives in `engine/src/scheduler/catchUpStart.ts` and is mutation-tested with the decision. A cap refusal is the existing `skipped_*` row for that firing, so it is never retried. A catch-up keeps `camoufox` in its snapshot for reuse only: reuse copies camoufox outcomes still inside the refresh window with no page load; other camoufox cells are seeded `skipped:scheduled_only` (`catch-up-no-browser`), which no resume (manual, automatic, or boot) ever runs. A camoufox-only definition whose catch-up would have no discovery provider is recorded `skipped_missed` once (never a verification-only run, never a per-minute notice storm). History shows "ran <time>, catch-up for <missed time>"; prices keep their own fetch times. Docs say "a catch-up never loads browser pages"; resumes, on wake or at boot, follow the browser window of decision 83. Owner WP16a. Tests (fake clock, literal UTC instants): asleep across one firing gives one run; across three, one run for the latest; a weekly firing missed 6 of 7 days ago gives `skipped_missed`, no run; Mon/Thu, monthly-on-the-1st and daily-across-DST cadence cases; a manual run after waking covers it; a definition edited after the firing gives none while an edit to another definition does not stop it; a live tick and the minute job in the same minute give one execution; a clock jump past the firing then 30 s with both jobs registered gives exactly one catch-up or one `skipped_missed`; boot then the minute job give one run; a cap-refused catch-up met twice gives one row and one notice; a firing during an active run gives none, a catch-up included (an hourly catch-up running past the next firing: the minute jobs while it runs and after it ends start, write, notify and call nothing, and "blocked since" clears when it ends); a catch-up paused across F2 with its one-shot due on the same wake gives one F2 catch-up and one superseded row in both timer orders, and a one-shot inside F2's grace waits until just past it; a paused catch-up at the next firing is superseded by the live tick, and by the minute job when the machine slept through that firing (catch-up for F1 `paused_budget`, asleep across F2: one superseded row and one new row with `scheduled_for` F2 and `is_catch_up` 1; a second minute tick writes nothing); each `skip_code` round-trips and renders its text, and a camoufox-only `skipped_missed` row still shows `browser-only-definition` after SearchApi is configured later; camoufox-only (with and without SearchApi verification) gives one `skipped_missed`, one notice, no ledger row across five minute-job ticks; reuse copies a fresh camoufox outcome and a manual resume loads no page; a daily 01:30 Europe/London firing on 2027-03-28 and on 2027-10-31: the task's first step records the firings `croner` 10.x actually gives as UTC instants, and the tests assert exactly as many catch-up candidates as those firings (one run at most, `scheduled_for` equal to the latest recorded instant), with the literals in the test; daily 00:30 and 02:30 across both change days; asleep from before a change to after it; the minute job makes no network call; a notice send held past the shutdown's wait writes nothing to the closed database and logs once, and no provider request starts once the shutdown begins.
78. (Operator ruling of 2026-10-19 and review findings ts-011, ts2-003; spec revision 36) **Windows is a full setup target in a later work package, not in WP16–18.** From WP16b the CI `test` job runs on `windows-2025`: POSIX-only tests skip with a visible title naming the reason, and the tests known to fail there are named in `ci/windows-known-failures.txt` (written by WP16b's research task; each fix removes its line). The leg runs them as expected-fail, still printing each title, is not `continue-on-error`, and fails on any failure outside the list or on a listed test that passes; a guard test checks that every line names an existing test. `gmt setup --dry-run` on win32 prints "Windows setup is not built yet; run the app with Docker (docs/setup.md)" and exits 0 with no plan, and a real `gmt setup` exits 78 with the same text; both are tested. The code stays portable: paths through `node:path` and the `Platform` interface, no shell strings, no POSIX mode outside `writeSecretFile`. The later package adds the `win32` `Platform` (a service through Task Scheduler or a service wrapper, chosen in its brief), ACLs in place of 0600 and 0700, Windows data directories, the `win32-*` entries of `CAMOUFOX_BUILDS` with their layout check, and its own recording sessions. Until then the worker refuses to start on Windows. The list WP16b's research recorded on 2026-10-24 (run https://github.com/MrReasonable/get-me-there/actions/runs/40117391189, 242 tests) is `ci/windows-known-failures.txt`, kept there as the one copy so the leg, its guard and this decision cannot disagree; the files of packages/db, packages/providers and apps/api that did not load in that run (fixed in WP16b) add their lines from the first Windows leg on the final tree.
77. (Operator ruling of 2026-10-19 and review rounds 1 and 2; spec revision 36) **CI runs on Linux, macOS and Windows; it never loads Google, calls a vendor or reads a secret.** `ci.yml`'s `test` job is a matrix over `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15` and `windows-2025` (Windows as decision 78 says). The `install-e2e` job (both Ubuntu runners and `macos-15`) builds its own fixture: a bare repository made from the checkout, a clone of it on a local `main` in a temporary directory, `gmt setup --non-interactive --answers <generated>` there (no vendor key, port 3917, `linger: enable`), assertions of the installed state (unit or agent present and running, health 200), `gmt status` (exit 0; `backups` `ok` with no note, `price-sources` `warn`), a commit pushed to the bare repository and `gmt update` (the served version changes), `gmt uninstall`, and assertions over WP16b's lists of removed and kept paths. Each matrix entry's mode is a YAML literal, `E2E-MODE: real` or `lint-only`, echoed by the job; the guard parses it, fails on a computed value, and fails unless at least one entry is `real`. `lint-only` (`--dry-run`, `plutil -lint`, `systemd-analyze --user verify`) is allowed only for a runner WP16b's research shows cannot run its service manager, recorded with its run link and date in the brief. The job has `timeout-minutes` and uploads the service logs on failure. The only outbound call a booted e2e app makes is its free FX-rate fetch, which is never ledgered. The `camoufox-install` job (WP17) runs on changes to `core/camoufox/builds.ts` or the install code and weekly: each runner's entry, cached by its SHA-256 (`actions/cache`), one retry, a step timeout, launched through the worker's launch path against a loopback page with a `fetch` spy (decision 73), plus an Intel macOS runner for `darwin-x64` when WP16b's research finds one (otherwise `darwin-x64` is stated as not exercised in CI). The workflow guard is the existing `scripts/workflows.test.mjs` (root `scripts` vitest project), extended: it parses the YAML and fails on the `secrets` context in any form, `github.token` or `GITHUB_TOKEN` in the install jobs, `pull_request_target`, `workflow_run`, `secrets: inherit`, self-hosted runners, a missing top-level `permissions: contents: read`, an action not pinned by SHA, and any URL whose host is off its allowlist: `registry.npmjs.org` and loopback for every job, and `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com` for `install-e2e` and `camoufox-install` only. It scans the workflow YAML and the `ci/*.json` files steps name, not `scripts/*`. Each ban has a fixture that fails, including a release host in another job. The mutation workflow and the root `mutate` script gain `@gmt/cli` with `src/plan/`, `src/services/`, `src/exec/system.ts`, `src/setup/{appEnv,answers,secrets}.ts` and `src/camoufox/**`; the worker's Stryker config gains `src/consentLine.ts`; a check fails when a file a brief names for mutation is in no Stryker `mutate` glob. The repository is public, so standard runners cost nothing.
76. (Operator ruling of 2026-10-19 and review rounds 1–3; spec revision 36) **One status report, three readers.** `statusResponseSchema` lives in `core/api-contract/system.ts` (WP18 §5 states its fields). `GET /api/status` builds every check of WP18 §6 through fixed summary templates and error classes, never raw vendor, worker, ledger, file or SMTP text. Compatibility: a `workerStatusSchema` field is added to the schema one package before any worker emits it (WP16a shapes the fields WP17 fills; WP18 reads them when present and never infers a flag from an absent field). `data` reports, per definition, its **latest finished** parent run's discovery coverage per cell in the six buckets with `core`'s labels ("last run 18 Oct: priced N, no fares E, no cached data D, error R, skipped S, not searched U of T cells", followed, as spec §3 requires of every coverage line, by "(n reused from earlier runs)" when any cell's outcome was reused, so a catch-up that loaded no browser page never reads as browser activity), both ends of its priced observations' effective ages ("newest …, oldest …"; "age unknown" when `maxAgeHours` is unknown), never "fresh", "complete", "all", or "prices up to <age>" with the youngest age; it warns when `R + S + U` pass 20% of T, when the **oldest** known effective age passes its basis's stale threshold, when a scheduled definition's last finished run is older than its cadence, when the latest row is `skipped_*` ("last firing skipped …"), or when there is no priced observation ("no prices yet"); a catch-up's `scheduled_only` cells count under skipped, with their detail's text; a `skipped_missed` latest row states its stored `skip_code` text, never a reason re-derived from today's settings; the worker card states the browser window ("browser pages: only inside a run's window" or "browser pages: also when a run resumes"); the `schedule` check warns when two definitions using `camoufox` share a firing time ("both fire at <time>; stagger them so neither waits for the other's pages"); synthetic observations never count. `price-sources` warns unless a usable non-synthetic discovery provider is configured. `degraded` is a `fail` on `schedule`. A fresh install's first backup (taken at setup) leaves `backups` `ok` without a "due" note; a recent catch-up is `ok` with a note. The worker check calls `readWorkerStatus` (WP16a), which takes no rate-limiter token and leaves the worker's pacer untouched, with a 2 s `AbortSignal`, picks named fields, uses `sharedSettingDiffs` on effective `sharedSettings`, and compares keys by digest ("keys differ"). In native mode, when the worker does not answer, it reads `<workerDataDir(home)>/start-refusal.json` through `startRefusalSchema` (`{ reason, at }`, unknown reasons and extra fields refused, any text ignored), with `HOME` passed from the api bootstrap; each reason maps through `START_REFUSAL_TEXT` (`flags-unset` and `build-mismatch` to `off`, `awaiting-verification`; `consent-missing`, `consent-expired`, `consent-voided` to `pnpm gmt consent`, and the consent check then reads `fail`); a refusal older than the newest consent record is shown as superseded. In container mode it says the worker is not reachable from the container. Fixes carry a `pnpm gmt …` command only in native mode. A compose `app` container beside the native app, a detached checkout and the worker's refusal are `gmt status`'s local facts (WP16b), not the API's. `POST /api/alerts/test-email` sends one fixed message within the hourly cap and keeps its last result in the process. The consent email is the maintenance tick's `sendSystemNotice` path (decision 74), not an `OperatorMessageKind`, so no migration. `gmt status` prints the same checks and exits 1 on `fail`. The Status view and the status bar share one query; the bar names the area when one item is listed and shows stale and not-answering states. "30 days" is elapsed time (30 × 86,400,000 ms).
75. (Operator rulings of 2026-10-19 and review rounds 1 and 2; spec revision 36) **The worker runs on Linux too, headless as on macOS, on flags bound to `<os>-<arch>` and their build.** `FLAGS` (`Record<OsArch, { build, flags }>`) and `flagsFor(osArch, runningBuild)` live in `core/camoufox/builds.ts` beside `CAMOUFOX_BUILDS` (WP16a), read by the worker's selectors module and by the CLI; `flagsFor` returns all false unless `runningBuild` equals that entry's `build`, and every flag read in the worker goes through the one selected object. `darwin-arm64` keeps the 2026-10-18 values and build; the other three start false. A test fails when an entry's build differs from its `FLAGS` build while any of its flags is true, and one per entry with a true flag requires its named recordings locally or skips visibly (decision 64). The pure start checks the CLI needs (flags for this build, consent record present and in date, layout entries) are `core` functions too; the worker adds `run.ts check --json`, which prints a `startRefusalSchema` result and is what `gmt start` and `setup` spawn. Before any exit 78 the worker writes `<workerDataDir(home)>/start-refusal.json` (0600, `{ reason, at }`, reasons `flags-unset`, `consent-missing`, `consent-expired`, `consent-voided`, `build-mismatch`, `layout`, `signed-in`, `locked`, no text) and clears it on a successful start; `gmt consent` clears `consent-*` refusals after a successful capture. On macOS the worker's agent has `ThrottleInterval` 600, and `gmt start`, `status` and `update` boot it out while the file exists; systemd uses `RestartPreventExitStatus=78`. On Linux the worker keeps `os: 'macos'` and passes a generated absolute `fonts.conf` as `FONTCONFIG_FILE`. The recording sessions (WP17 Task 17.8): before each, the host worker alone is stopped with `pnpm gmt stop --only worker` (a native app keeps running), no camoufox run may be active, a host cool-down refuses the session, and the session's last-page time is seeded from the host's; afterwards it is written back (or one spacing interval passes) before the host worker starts, and the session record states its page and scroll counts, which the worker's monthly counter also holds. `darwin-x64` runs under a throwaway `HOME` with an x86_64 Node under `arch -x86_64`, asserting `process.arch === 'x64'` at the start, with `SOCS` by `gmt consent import`, and the throwaway tree removed after the backup. `linux-arm64` and `linux-x64` (`--platform linux/amd64`) run in containers from `apps/camoufox-worker/Dockerfile.recorder` (Firefox's libraries and `unzip` installed; mounts limited to `apps/`, `packages/`, the lockfile, the workspace manifests and `fixtures/recorded/`; a start-up check refusing any visible `.env`, `app.env` or `worker.env`), each followed by `recordings:backup`, and each entry's flags set in the commit that names its recordings. The live check for a Linux entry runs `gmt setup` inside that container, app and worker both on its loopback, no published ports. `gmt setup` offers the browser provider only on an entry with flags; elsewhere it says once "The browser provider is not available on this machine yet (no recordings for <os>-<arch>); SearchApi and Travelpayouts work", downloads and installs nothing, leaves `CAMOUFOX_ENABLED` unset, and offers it again on a later `setup` or `update` once the flags land. On a machine with no display it shows spec §2's server text and needs a typed `yes`. The Docker path on Linux leaves the provider off (the worker's bind stays `127.0.0.1`). The provenance notes say "on the machine running this app's browser worker, from that machine's address". The worker records each calling app's instance id (a SHA-256 of the host name and the database's real path, sent as a header) and `/v1/status` reports two in one month. Every WP14 and WP15 limit holds unchanged on Linux.
74. (Operator rulings of 2026-10-19 and review rounds 1 and 2; spec revision 36) **Consent is captured by a person's click in a visible window, observed read-only, never by the tool.** The order is fixed: Task 17.4 builds the landing view, `consentCaptureGuard` and the `consent-research` recorder kind; research 17.0c, headed with the person clicking, records one "Reject all" and one "Accept all" under that guard with a request listener that saves each request's method, path and form field names, never values, except the one value that differs between the two, compared in memory before saving; Task 17.5 builds the `consent` command only when 17.0c proves a rejection mark computed from the `SOCS` value alone. Until then `capture-socs` is the way, and no prompt asking which button was clicked exists. The guard admits, by host, path and method, document navigations and form POSTs to `consent.google.com` (`/save` included) and the redirect to `www.google.com/travel/flights`; the server path's guard never admits `/save` (tested). The command holds the worker's lock and runs under its pacer, monthly count and cool-downs (refusing during a cool-down, naming its end; waiting out the spacing; writing the last-page time). It loads the landing page `https://www.google.com/travel/flights?hl=en-GB&gl=<POINT_OF_SALE>`, which the classifier recognises positively as the `landing` kind from dated selectors under `LANDING_VERIFIED` (set by the 17.0c and Task 17.8 recordings); anything not positively recognised writes nothing. `gmt consent` stops the worker service, spawns the command with the display variables in two groups (`DISPLAY` with `XAUTHORITY` when `DISPLAY` is set; `WAYLAND_DISPLAY` with `XDG_RUNTIME_DIR` when `WAYLAND_DISPLAY` is set; never `DBUS_SESSION_BUS_ADDRESS`), which `run.ts` reads for the `consent` subcommand only, and afterwards starts the worker and clears `consent-*` refusals on success, or restores its previous state. The command observes only through a driver type exposing launch, load, cookies, URL, snapshot and close: the main frame's host on each navigation, the classifier's view, and `SOCS` by name and domain, every other cookie dropped as it is read and an account cookie failing the capture. It writes `socs.json` only for a `SOCS` that appeared after the consent host was seen and whose computed mark is a rejection, and the not-shown record only when the first stable view is `landing` with no consent host and no `SOCS`, after the operator confirms. `consent export` requires `gmt setup`'s install (the worker never downloads) and prints `gmt-socs-v1.<base64url of { socs, capturedAt, mark }>` as its only standard output; `consent import` reads standard input only (4 KB cap), validates with a strict zod schema (name `SOCS`, bounded value length and characters, domain `.google.com`, path `/`, expiry ≤ `capturedAt` + 13 months), recomputes the mark from the value and refuses a differing or non-rejection mark, and keeps `capturedAt`; `consent check` is the server's one headless, read-only load of the landing page under every worker rule, at most once an hour, writing not-shown only under the same rule. A consent page or a `SOCS` cookie appearing after a not-shown record rewrites it as `{ consent: "voided", voidedAt }`; `/v1/status` reports kind `voided` and the next start refuses with `consent-voided`. Export, import and the codec live in the worker beside `socs.ts`; `gmt consent [export|import|check]` only spawns the worker's entry with standard streams inherited. Expiry everywhere is the earlier of the cookie's expiry and `capturedAt` + 13 months. There is no reminder service: the app's maintenance tick sends the system notice `consent_expiring` straight to the notifiers while the consent check is `warn` or `fail` and the provider is enabled, after claiming the key `consent-expiring:<London date>` in `operator_notice_keys` (as the cool-down notice does), so `operator_notifications` and its kind check are untouched and no migration is needed (WP18).
73. (Operator rulings of 2026-10-19, research 17.0a and 17.0b, review rounds 1 and 2; spec revision 36) **The CLI installs Camoufox from one typed manifest and owns its layout; the worker only verifies and never downloads.** This supersedes decision 69 round 2 item 1 (launch through `~/Library/Caches/camoufox` and refusal of any set install directory). `CAMOUFOX_BUILDS` in `core/camoufox/builds.ts` (WP16a; `satisfies` its zod schema) holds, per `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `{ build: '152.0.4-beta.28', url, sha256, bytes, unpackedBytes, hashedOn: '2026-10-19' }` with the URLs and GitHub digests of release `v152.0.4-beta.28` (asset names `camoufox-152.0.4-beta.28-<mac|lin>.<arm64|x86_64>.zip`; full digests in WP17 §0); the schema allows only `https://github.com/daijro/camoufox/releases/download/` URLs. The worker's pin is `CAMOUFOX_BUILDS[osArch].build`; `DEFAULT_BINARY_BUILD` and the `CAMOUFOX_BINARY_BUILD` setting are deleted. The CLI: checks free space (archive plus unpacked size), downloads with `fetch` (redirects followed only to `https` GitHub release-asset hosts), hashes while streaming, deletes the file on a mismatch, re-hashes just before unpacking, lists entries with `unzip -Z1` and refuses absolute, `..` or escaping entries, unpacks with `unzip` into a 0700 temporary directory beside the target, writes `version.json` with `version` and `release` derived by splitting the entry's `build` at its first `-` (plus `build` and `sha256`), renames into `browsers/official/<build>-<sha256[0..8]>/`, then writes the layout `camoufox-js` reads (on macOS the root's `Camoufox.app` symlink and `{ version, release }` `version.json`; on Linux nothing more, since the bundle directory is the install directory). On Linux it then runs `ldd` over `camoufox-bin` and every `.so` in the bundle, `libxul.so` included, and names the missing sonames with WP17 §0's apt line. `update` installs a changed entry only when that entry's flags are set (then there is no keep option; otherwise it installs nothing, keeps the old bundle and says the provider stays off on this `<os>-<arch>` until recordings land), switches the layout after the build step, and removes the previous bundle only once the app is healthy. There is no copy from `~/Library/Caches`. In the worker, `run.ts` (the one `process.env` owner, with a commented exception for this one write) refuses an inherited `CAMOUFOX_INSTALL_DIR`, then assigns it the install directory for its OS before dispatch, because `camoufox-js` reads it once at import (`pkgman.js:44`); `launch.ts` asserts it before importing. `ensureInstallLayout` verifies only, including its preconditions for `camoufoxPath()` (non-empty directory, a `version.json` release `camoufox-js` accepts), and runs before any `launchOptions` call, since reaching `camoufox-js`'s download branch would `rmSync` the install directory; a test spies on `fetch` (the branch calls it synchronously in the first `launchOptions`) and asserts no call against each OS's layout fixture and on the refusal paths (missing or mismatched bundle → exit 78). The boundary script gains the `run.ts` write exception.
72. (Operator rulings of 2026-10-19 and review rounds 1 and 2; spec revision 36) **`apps/cli` is a plan-then-apply command behind one `Platform` interface.** Its interfaces are those WP16b §5 states; that section is the single statement, and WP17 and WP18 code against it. Package `@gmt/cli`; root script `"gmt": "node --conditions=@gmt/source --import tsx apps/cli/src/main.ts"`, with `tsx` 4.23.15 added to the root `devDependencies` and to `@gmt/cli` so it resolves from the repository root (a test runs `pnpm gmt --help` there); not `pnpm --filter`, which would change the working directory. Arguments through `node:util` `parseArgs`; prompts through `node:readline/promises`, hidden input by raw mode on a TTY; no new dependency. `Platform` carries the user id; `ServiceManager.facts(rendered, run)` gathers file contents and loaded state once, and its planning methods (`install`, `start`, `stop`, `restart`, `remove`) are pure functions of those facts that return `writeFile` and `run` actions holding the literal `launchctl gui/<uid>` or `systemctl --user` argv; one `Runner` (an `execFile` wrapper in `exec/`) serves the executor and every read. No journal: `apply` stops at the first failure and reports what was and was not done, and a re-run plans only what is missing. The CLI imports `core` only (config schema, `CAMOUFOX_BUILDS`, `FLAGS`, `flagsFor`, the pure start checks, `startRefusalSchema`, `workerDataDir`, `sharedSettingDiffs`, the status contract), never `db`, `providers`, `engine`, `api` or the worker, and reaches them over HTTP or by spawning their entries (`run.ts check --json`, `run.ts consent …`). A rendering test asserts each service's environment is exactly `{ PATH, HOME }`. The boundary script gains `@gmt/cli: ['@gmt/core']` and a `process.env` exception for `apps/cli/src/main.ts`. The image is unchanged in content: the Dockerfile copies `apps/cli/package.json` in both install stages and filters `!@gmt/cli`, and `.dockerignore` admits only that manifest, as for the worker, with `scripts/workflows.test.mjs`'s image assertions extended. Key rotation is part of `--reconfigure browser`, not a command of its own.
71. (Operator rulings of 2026-10-19 on the local ease-of-use proposal and review rounds 1 and 2; spec revision 36) **Native mode is the default local path; Docker stays for VPS; one app per ledger.** Audience: someone technical but new to the project, on a clean Mac or Linux machine, as well as the operator; one operator per install. `pnpm gmt setup` installs the app as a user service running `<execPath> --env-file=<absolute app.env> apps/api/dist/bootstrap/start.js` with `NODE_ENV=production`, `BIND_ADDRESS=127.0.0.1`, generated basic auth and `DATABASE_PATH` under `~/.local/share/get-me-there/` (spec §13 gives the service details, the daily backup job in `backups/daily` keeping 14 with the first taken at setup, and update, restore and uninstall). `IN_CONTAINER` stays unset, so the record tool route works natively. The wizard's questions are WP16b's prompt table: Enter through every one reaches a running app with no price source, and the closing screen then says so first and points at Travelpayouts; it asks the time zone (proposed from the machine), optional email, the vendors with one line each from spec §1 (and, for the SearchApi trial, the credits already used), and the browser provider after its costs; `--reconfigure <group>` changes one group; setup ends with the URL, user, password location and `pnpm gmt password`. The app and the worker remain two services, the worker only on opt-in. Native setup refuses while a compose project or its volume exists unless `--import-docker` or `--ignore-docker`. `--import-docker` refuses while the container runs an execution (or waits with `--wait`), stops it, backs up from the stopped volume, restores and integrity-checks natively, and only then writes the moved marker; `--import-db <path>` does the same for a checkout's database. The app and tool bootstraps honour a `MOVED-TO-NATIVE` file beside any database they open, before migrations, the boot sweep, auto-resume and cron (WP16a). `setup.md` gains a Quick start at the top and notes on each section saying which path it applies to. Settings editing in the UI and a packaged app are out of scope.
70. (Operator rulings of 2026-10-18 after the two graph explorations, and the WP15 round-1 review rulings; spec revision 34) **Grid mode is designed, not built; work package 15 builds it** (brief `docs/briefs/wp15-camoufox-grid.md`, Opus, after WP14). The Price graph's chart region has no readable bars (its text is the axes only; 710 elements, no images or buttons), so it is dropped. Its Dates tab is the source: `tabpanel "Dates"` holding an empty `grid "Date grid"`, a line of seven departures, 49 cell buttons named `£<price>[, cheapest price], <d> <Mon> to <d> <Mon>[, selected]` (the order recording 2 shows), a line of seven returns, a selected-pair line with the year, and four scroll buttons. **Round-1 rulings:** (1) a dialog view `dates-grid` (dialog "Price insights" open, "Dates" selected, the panel's four scroll buttons present); the challenge, sign-in, signed-in, consent, `SOCS` and allowlist checks run first on every poll, unchanged; exploration 2's stored classification was `unrecognised` (`cheapest-tab-count`) only because no dialog view existed. (2) Exactly 49 cell buttons in the panel, matched by position against departures × returns, not by a "£" prefix; a priced cell is parsed; an unpriced cell is `no_data` once a recording proves Google's unpriced form, unparsed until then; duplicate pairs or a failed cross-product make the whole view structurally unparsed, nothing stored and its covered cells issues. (3) More than half of a view's priced-looking cells failing the grammar stops the page as `unrecognised`, no further scrolls. (4) Grid prices carry the assumed 24 h age ("Google's date grid; age not stated (assumed ≤24h)"), never 0. (5) Pence are pounds × 100 and the note says the grid shows whole pounds. (6) SearchApi `google_flights_calendar`'s `is_lowest_price` fills `vendor_price_mark` too; the type is `boolean | null` everywhere (superseded by the recordings' addendum below: the enum `cheapest | low | none`, or null). (7) The context viewport is pinned at 1280 × 900 (ordinary layout configuration); `GRID_SIDE` 7 is the recorded side at that viewport. (8) The scroll step is measured by the `--grid` recording, dated, reported by the worker and passed to the planner (`stepDays`, in `@gmt/providers`); the cost table is restated from it. (9) A view after a scroll counts only when its departures or returns line differs from the view before the move, then holds stable for two polls 2 s apart. (10) Each move has its own budget, 45 s plus a 15 s reserve, inside an overall per-page cap, with boundary tests. (11) The departures and returns lines are the truth for the dates a view shows; a first view shifted near today or a short move at an edge is accepted when consistent and inside the sale window, recorded as an "off-plan view" issue naming its cause (never `unrecognised`), and the planner re-plans from the dates shown (superseded by fix round 1 below: the resume re-plans the unread cells on the lattice anchored at today). (12) `CAMOUFOX_EXECUTION_SCROLL_CAP` 600 and `CAMOUFOX_MONTHLY_SCROLL_CAP` 6,000 beside the page caps, checked before each scroll; scroll spacing 0 to 30 s (default 5; 0 means no pause, operator ruling 2026-10-25), fixed, never randomised; every scroll counts in the row's `scroll_count`. (13) The estimate's retry factor is 1.0 for camoufox (it never retries). (14) Every other finding follows its reviewer's suggestion. **Further rules:** the year comes from the selected-pair line and the query, each date takes the year in {Y − 1, Y, Y + 1} nearest the planned block, and every weekday on both lines must agree; the first view's selected cell is the query's pair at the line's price; `return_date_source` ∈ `vendor | asked | grid-cell` (migration 0006, backfilled, no default); one `provider_requests` row per page load with `scroll_count` (NULL for list rows and for a grid call with no answer); a page ends on a read view and the next opens the next read block; cells outside the window or nights are never stored; the label is "Google Flights date grid via Camoufox"; `GRID_VERIFIED` flips only in the commit that adds a `--grid` recording proving the dialog view, the grammar, the lines, each scroll's axis and step and the unpriced form if one was seen. Every WP14 limit (decisions 68 and 69) holds unchanged: the signed-out profile, `SOCS` set and read back by value, the guard, the classifier's stops, the cool-downs by cause, no proxies, no challenge ever solved or clicked, the page spacing (default 30 s, 0 to 600, decision 69), the page caps.
    **After the `--grid` recordings (operator, 2026-10-18), added to this decision.** One scroll moves one day on its axis (`stepDays` 1 and 1), so each reveals 7 cells; the planner chooses per move between a new page (about 30 s, 49 cells) and the scrolls (about 9.3 s each), whichever is quicker within the page and scroll caps shared across the run's pairs. The page reuses and rotates its elements after a scroll, so a cell's dates come only from its own name; the lines are a set check (supersedes ruling 2's positional match). The grammar takes "low price" beside "cheapest price" (`vendor_price_mark` ∈ `cheapest | low | none`, NULL where the vendor states none) and thousands separators. A view holds 49 cells less the pairs whose return precedes the departure. Each date takes the year nearest the query's departure. A grid query past the sale window lands on the no-flights page: `no_data` for its covered cells, and the planner plans no departure past `GRID_HORIZON_DAYS` (320).
    **Fix round 1 of PR #9 (2026-10-18), added to this decision; spec revision 35.** From the four branch reviews and CodeRabbit's pass, each applied as its reviewer suggested: the lattice is anchored at the later of the window's first departure and today; the horizon bounds returns as well as departures, and the probe opens at the least pair past it; a no-flights page is `no_data` only for the covered cells on or after its first pair on both dates, the others `no-flights-at-start` issues; a 0-night diagonal block opens a day later and scrolls up once; block moves keep every view holding round trips; a page's scroll allowance is what the guard says the caps leave (`BudgetGuard.scrollsLeft`), reserved as such, and a page with none still reads its first block; the worker reports its scroll cap and spacing and the preflight refuses a mismatch; off-plan causes are named only from what is known (`shifted` otherwise); a pair read twice fails the tile; an `unknown` call keeps its planned scrolls on the ledger; a scroll-cap breach is worded as one; the estimate reads each tile's figures from the provider (`estimateTile`), times a scroll at the longer of 9.3 s and the spacing, notes a run past `STUCK_AFTER_HOURS`, and `budgetFit` warns on the month's scrolls; a stored grid-cell price is labelled assumed from its own row; both settles keep the first of a run of matching polls; the docs state the estimate's own figures (100 pages and 588 scrolls a run at the defaults, 3 runs a full pass), pinned by a test. **Rulings on it (operator, 2026-10-19):** (1) each pair's grid plan puts its joined pages first and the engine takes the pairs' camoufox grid pages in turn (round-robin, `DiscoveryCapability.interleavePairs`), list mode and every other provider unchanged, so a capped run spreads its pages across every pair: 100 pages and 588 scrolls a run at the defaults, about 2.4 h, 5,152 of the 8,736 day pairs; (2) the 0-night step is confirmed live by `grid/2026-10-18/5.json` (14 → 15 Mar, `up`: a 34-cell view, then 28, same-day pairs shown, returns −1), and short views near the diagonal are accepted when every cell has return ≥ departure and the count matches the lines' dates; (3) `record.ts`, `session.ts` and `driver.ts` stay large on purpose (the rules tests pin code to them); (4) a SearchApi calendar price is labelled assumed from its own row too. **Ruling on the re-review's N1 (2026-10-19):** the no-flights line is generic, so a no-flights page marks `no_data` only the query cell it shows, and every cell of the probe page past the 320-day horizon (the sale window's end); inside the horizon every other planned cell of that page stays a resumable `no-flights-unseen` issue (this replaces fix round 1's on-or-after inference). A 0-night page with no scroll left, or under a per-page cap of 0, drops its lead scroll and reads the view it opens on, so it keeps its ledger row.
69. (WP14 brief review round 1, operator rulings of 2026-10-18; spec revision 32) Where this decision and decision 68 differ, this one wins. **The worker embeds Camoufox:** `apps/camoufox-worker` launches its own Camoufox with `camoufox-js` 0.11.5 and `playwright-core` 1.59.1 (pinned; the pair camofox-browser 1.13.1 runs the same binary with), from the operator's installed binary through `camoufox-js`'s own install-directory layout (round 2, item 1; no shim), passing `ff_version` from the bundle's own `version.json` (whose build field is named `build`), `exclude_addons: ['UBO']` (no add-on download), `serviceWorkers: 'block'`, `geoip: false`, no proxy, no humanise, headless, and a minimal browser environment (never the worker's secrets); it uses a persistent profile directory of its own, never shared and never seeded from any cookie file, reads cookies with `context.cookies()`, sets only `SOCS` with `context.addCookies`, and never calls camofox-browser, so its auto-dismiss, superkey, bootstrap cookies and telemetry stop mattering. The app reaches the worker with `CAMOUFOX_WORKER_KEY` (replacing the worker token). Start checks: binary build and `camoufox-js` version pinned; no Google account cookie in the profile; the `SOCS` capture present, in date and, after the recording probe proves it stable, equal on read-back after every page on every path. The consent probe uses a throwaway profile in the worker's own browser and records the consent page without clicking. **Spacing** is start to start, as the app's limiter measures it; `CAMOUFOX_MIN_SPACING_SECONDS` takes 0 to 600 (default 30), and 0 (operator ruling, 2026-10-25) means no pause: the limiter has no rate limit, the pacer lets a claim pass at once (one page at a time, the last page time still recorded), and the page caps alone bound a run. **Ledger:** answers that load no Google page (spacing 429, cooling-down 423, mode-unavailable 409, 400, 401, a 5xx before navigation, a refused connection) keep their rows with the outcome class `no-page` (a new `provider_requests.page_class` column, migration 0005), and the page caps and the "pages" copy never count them; the worker states `x-gmt-google-contacted` on every answer. **Worker absent:** a refused connection is `provider-unavailable`, not retryable, and the first one disables camoufox for the execution (`skipped:provider_unavailable`, "browser worker not reachable"); timeouts and dropped sockets are never retried for camoufox. **Cool-downs by cause:** a challenge page, sign-in, signed-in or consent-unhandled 48 h (configurable, at least 24); an unrecognised page 1 h, and the provider disabled for the execution; a page that never settles is a `parse` error with no cool-down; a recorded "no flights" page is `no_data`. Before planning camoufox tiles the engine calls the capability's unledgered `preflight` (the worker's `/v1/status` under the never-ledgered id `camoufox-status`): during a cool-down or with the worker unreachable the provider is skipped with no ledger rows, and the operator is notified once per cool-down. The cool-downs and the signed-in refusal persist on disk; so does the last page time; a data-directory lock keeps one worker per profile. **The page cap** is frozen into the execution's budget snapshot (`budget.providerMaxCalls`), never read from config at reserve time; the estimate clamps the camoufox line to it and says how many cells a run prices. **Tests:** the worker may take `@gmt/providers` as a devDependency for `@gmt/providers/testing` only, and the boundary check allows that test-only import there and nowhere else; the worker's floor is 90/80/90/90 and its classifier, pacer, cool-down, consent and grammar modules join the mutation run with the 5% timeout gate. **Provenance:** list mode is the only mode in WP14; grid mode stays refused, pinned by a test, until stored rows record where a return date came from; the provenance note says "return date: the date asked for"; each option's airports are matched to the queried codes through the airports dataset's names (`DiscoveryQuery.airportNames`, set by the engine), a mismatch dropped and counted; the grid dash would map to `no_data`; the worker checks the page's search form (trip type, passengers, dates) and a mismatch is `unrecognised`. **The "Cheapest" flow is unverified:** the first task records the Best and Cheapest pages; until a recording confirms the flow the worker clicks nothing and computes the minimum over every result link on the page; "View more flights" is clicked only if a recording shows it adds options below the visible minimum. **Failure paths:** `CAMOUFOX_PAGE_TIMEOUT_SECONDS` bounds every page operation; the pacer is released in a `finally` no error can skip; every thrown error maps to a defined answer with a test. **Coverage** in list mode is stated in the docs, the Providers copy and the estimate (at most the monthly page cap of day pairs a month, with the worked example's arithmetic). Every other finding of round 1 follows its reviewer's suggestion; the brief records which.
    **Round 2 (WP14 re-review, operator rulings of 2026-10-18), added to this decision.** (1) The worker launches through `camoufox-js`'s own install-directory layout, the one the 2026-10-18 loads used: `~/Library/Caches/camoufox` with a `Camoufox.app` symlink to the installed bundle and a top-level `version.json` in `{version, release}` form; the worker checks both at start and creates any that is missing, never modifies the bundle, and refuses when the bundle's own `version.json` (`build`) differs from the pin; no shim; a launch smoke (launch, open `about:blank`, read the cookies, close) is its own task step. (2) macOS only: elsewhere the worker refuses to start; nothing is written for Linux. (3) `serviceWorkers: 'block'`; every navigation, redirects included, is checked on its final URL by `framenavigated` and `request` guards as well as `context.route`; an off-allowlist redirect stops the page as `off-allowlist`, the consent and sign-in hosts as their own kinds. (4) Recording order: the `SOCS` capture; with `SOCS` pre-set, the results, Cheapest and View-more pages (and the stability check); the consent probe in a throwaway profile, a narrow navigation exception that lives only in the recorder, records without clicking, starts no cool-down and deletes its profile in a `finally`, with a start-up sweep of leftover `probe-*` profiles; a "no flights" page from a valid no-service query the operator picks, else recorded as unrecorded with the grammar line unverified; tasks are ordered so each one's prerequisite modules exist before its tests run. (5) Result names are read through Playwright locators (the link's accessible name), never by parsing printed ARIA text; the signed-in control by role and name prefix; a CAPTCHA by frame URL and page text, never by iframe name; names over a generous limit count as unparsed. (6) Every Playwright call takes its own `timeout`; one page deadline closes the page, which rejects pending calls; every raced promise has a no-op `catch`; the `finally` steps (SOCS read-back, page close) each run under their own bounded timeout. (7) The worker allows a 2 s tolerance on start-to-start spacing, and the app's limiter takes the spacing directly as `minTime` (`ProviderHttpLimits.minIntervalMs`), not from `ratePerMinute`. (8) The account-cookie set is named and dated, read across `https://www.google.com` and `https://accounts.google.com`, one test per name. (9) `SOCS` is compared by value everywhere. (10) `/v1/status` reports the live account-cookie result, never a constant. (11) The worker key never appears on a command line or in an `export`; the status check is a script that reads the env file; one env-file path, `<data>/worker.env`, everywhere, with the mode check on the file actually loaded. (12) The test fixes (migration 0005's tables and `db.raw`; `vitest run --coverage`; the rest as the reviewer suggests). (13) All other round-2 findings follow their reviewers' suggestions.
68. (Operator rulings, 2026-10-18; spec revision 32) The Phase 4 continuity fallback is built as an opt-in provider with id **`'camoufox'`**, as spec §2 originally named it: the operator ruled that the adapter's browser is Camoufox, a Firefox-based browser the operator has installed; this decision records that ruling, which replaces an earlier limit on the browser. Core: `ProviderId` gains `'camoufox'`, `SourceKind` gains `'scraped-self'` (`maxAgeHours` 0), `ProviderErrorKind` gains `'blocked'` (never retryable), and `BudgetScopeKind` gains `'provider-execution'` (a provider's own per-execution cap; on a breach that provider's remaining cells in the stage are `skipped:budget` and the run continues with any other provider, else `paused_budget` with a manual resume). **Limits, binding on every later change:** a dedicated camofox-browser profile (`CAMOUFOX_PROFILE_ID`, default `gmt-worker`) that is never signed in: no cookie import, a refusal to start when it holds a Google account cookie, and a stop (`blocked`, page `signed-in`) when any page shows a signed-in account control (the feasibility load of 2026-10-18 ran signed in to the operator's account, which this rule forbids); no proxies of any kind (the operator's own IP is a stated cost); no challenge is ever solved, clicked through or waited out; concurrency 1 and a minimum spacing of 30 s by default (`CAMOUFOX_MIN_SPACING_SECONDS`, 0 to 600, where 0 means no pause; never randomised) enforced in both the app's limiter and the worker; `CAMOUFOX_EXECUTION_PAGE_CAP` 100 (at most 400) and `CAMOUFOX_MONTHLY_PAGE_CAP` 1,500 under the free-provider ledger rules (never billable, cost 0, never cached); navigation only to `www.google.com` under `/travel/flights`; **consent rejected, never accepted:** camofox-browser 1.13.1 clicks "Accept all" on its own after every navigation (`dismissConsentDialogs`, no setting turns it off; signed-out test 2026-10-18), so before the session's first navigation and before every page the worker sets Google's consent-choice cookie `SOCS` (named in Google's cookie policy, read 2026-10-18) to a rejection value through `POST /sessions/:userId/cookies`, the only cookie it ever sets; the value is undocumented, so the operator copies it once from a real "Reject all" in an ordinary private browser window into the worker's state directory, dated, and the worker refuses to start without it; a consent page, or a `SOCS` value changed after a page, is `blocked` page `consent-unhandled`: the session is closed, its cookies discarded, and the worker cools down; an operator patch making camofox-browser prefer "Reject all" is optional and never depended on; **the access key:** the operator sets camofox-browser's `CAMOFOX_ACCESS_KEY`, the worker sends it and refuses to start if the server answers without it; **terms:** the docs tell the operator to read the provider's terms before enabling it, and the operator is responsible for how it is used; the worker stops and cools down whenever a page is not a recognised results page: on a CAPTCHA, an "unusual traffic" page, a sign-in wall, a consent page, an off-allowlist navigation or any unrecognised page the worker stops at once, the cell is `error`/`blocked`, the provider is disabled for the rest of that execution (a manual resume keeps it disabled, an exception to the manual-resume rule of spec §8.1), and the worker refuses every page load for `CAMOUFOX_COOLDOWN_HOURS` (default 48, configurable, at least 24), a refusal persisted in its state directory; **off by default** (`CAMOUFOX_ENABLED=false`, the worker not started, and a definition must name the provider). **Capabilities:** discovery only, in two modes: `list` (default) reads one cell's cheapest round-trip total (its return date is the worker's own query date, labelled so, since the page states only the departure) from the results list ("Cheapest" tab, "View more flights", every result's accessible name parsed by one dated grammar module, unparsed names dropped and counted), the structure the feasibility load saw; `grid` reads Google's 7 × 7 date grid (`rectangle` tiles, cell keys from the grid's headers) and is refused by the worker until a recording verifies its selectors. No verification: a result's accessible name carries the outbound only and a round-trip total, with no return leg, flight numbers or IATA codes, so a `RawOffer` would be partly invented, and no seller can be reached inside the allowlist. **Deployment shape:** Camoufox and the camofox-browser REST server (`@askjo/camofox-browser`, v1.13.1 in the feasibility load, `http://127.0.0.1:9377`) run on the operator's machine, so the worker does too: `apps/camoufox-worker` is a host-side Node process (`pnpm --filter @gmt/camoufox-worker start`) and that REST server's only client for this app. It embeds no browser library: it opens tabs under its profile id, navigates, reads accessibility snapshots and clicks by reference through the REST API, and serves a token-authenticated HTTP API on `CAMOUFOX_WORKER_BIND` (default `127.0.0.1`, never a wildcard) port 8090. The app reaches it by one setting, `CAMOUFOX_WORKER_URL`: `http://127.0.0.1:8090` under `pnpm dev`, `http://host.docker.internal:8090` for the app in Docker (Docker Desktop forwards it to the host loopback; on Linux compose maps it to `host-gateway` and the worker binds the bridge gateway address). Chosen over the adapter calling the REST server directly because the REST API is general-purpose browser control (any URL, any click) and the rules (allowlist, consent, signed-out check, spacing, cool-down) must hold for every app that uses the browser: the container and `pnpm dev` have different databases, so only a single host-side process can keep one pacer and one persisted cool-down for both, and the app's adapter stays an ordinary http-kit client of a narrow, authenticated API. Chosen over a worker that embeds Playwright and launches Camoufox itself because the operator's Camoufox already runs behind that REST server, and a second launcher would mean a second browser instance, profile and fingerprint to keep apart. The default image and the `app` service carry no browser (only the `CAMOUFOX_*` environment lines and one `extra_hosts` entry change); the app works with the worker absent (`network` errors on that provider's cells only). New package `apps/camoufox-worker` may import `core` only (it speaks HTTP to the REST server); nothing imports it. Recorded Google pages are vendor data under decision 61: gitignored, local-only, and the suites that replay them skip visibly. Work package WP14 (Opus, after WP13), brief `docs/briefs/wp14-browser-provider.md`.
67. (From the final whole-branch review, 2026-10-17) Results, Duration and Calendar decide the basis from one source: the live definition's verification providers plus any observation, on-demand children included, and `basisReason` says which condition failed. The Budget port distinguishes an unused window from no cap, and the status bar shows each provider's binding window (lifetime on the trial). Provenance without hover overrules decision 46: compact and phone faces show a short age line and source mark. The "searched" umbrella appears only in View D; day faces and the status bar show buckets. The spend-cap-0 notice shows only when per-call cost is above 0. SearchApi price history is keyed by trip (dates and cabin), not route (migration 0003, spec revision 28). `stops` is sent when `maxStops` is set. The mutation gate runs sandboxed, fails when timeouts exceed 5%, and runs weekly in CI. Load-sensitive tests carry explicit timeouts. The failed-auth limiter gains its global fallback of 20 per minute. `show_cheapest_flights` stays a follow-up for Ian.
66. (From the WP13 review) The tools share one argv parser. The smoke freezes its per-run cap as min(`--budget`, worst case) like recording, and has `--dry-run` (spend position and plan, no vendor call). The operator's vendor steps (Task 13.8 and the final trace) all use one ledger (the container's database, through the route) and one cross-run ceiling of 24 SearchApi credits enforced by `--budget`, re-runs included; `SEARCHAPI_TRIAL_USED` is set from the dashboard before the first call and the dry run prints the window. The smoke's open-jaw check reads the adapter's per-cell issues and notes, never priced rows (which carry no return airport). Only `verified` offers print "sold by"; others print "price not confirmed by the final step". The smoke summary headlines a confirmed chain price, else labels the discovery price as a calendar price with its age. The final pass traces one real price end to end: a one-pair, one-month definition run through the engine on Travelpayouts (free) plus one per-cell verification child, followed through the database, API and each view.
65. (From the WP13 refresh) The live smoke runs one discovery tile per configured provider plus one SearchApi itinerary chain for the cheapest SearchApi cell, spending at most 4 SearchApi credits and 3 free Travelpayouts calls per run, under the same window and cross-run checks as recording (`--budget`, `--confirm-rerun`, exit 65) through a helper shared with the record tool. The smoke request schema gains `budget`; `runSmoke` returns the shared exit codes 0/1/2/3. The smoke route is not refused inside a container (decision 62 covers recording only). Command-line smoke fixtures go beside the database, never into the recorded tree. The decision-61 skip guard moves into `@gmt/providers/testing` (one copy for api, providers and engine). Shared tool output never uses the banned word "live". The final pass (Task 13.9) is a whole-branch review on the Fable model and the `v0.1.0` tag; the operator's vendor run (Task 13.8, at most about 16 SearchApi credits) needs Ian's `.env` and approval.
64. (From the WP12 revision) The visible-skip guard for recording-dependent tests (decision 61) lands now as a small standalone task, not in WP13, because CI on a fresh checkout fails without it. WP12's script tests take exit codes, backup folder and keep count from the app's build (one copy). The root `packageManager` carries pnpm's integrity hash.
63. (From the WP12 round-1 review) CI's docker job asserts a graceful stop exits 0 and releases the lock, then kills a container hard and shows the restarted app takes over the stale lock after its threshold. The docs warn that `docker compose down -v` and volume removal destroy the database and the in-volume backups, and that backups must be copied off the volume. The default compose never forwards `ALLOW_UNAUTHENTICATED`; a documented override file does, for Tailscale-only hosts. The container healthcheck checks liveness only (a `degraded` health detail is shown in the UI and logged, never a restart trigger). The live-smoke documentation is written by WP13, not WP12. CI actions are pinned by commit SHA. The "history purged" wording in WP12's docs is true because the purge (decision 61) lands before WP12 merges.
62. (From the WP12 refresh) WP12 depends on 8, 9 and 11 (it documents alert email settings); the dispatch table follows. The record tool route refuses inside a container (`IN_CONTAINER`), since recordings are local-only; recording runs from a development checkout. Cost figures in the spec point to the generated `docs/scheduling.md`.
61. (Ian, 2026-10-17) Recorded vendor responses never enter git: SearchApi's results are scraped from Google Flights and Travelpayouts' come from the Aviasales cache, and neither may be republished. `packages/providers/fixtures/recorded/**/*.json` is gitignored except our own `params-*.json` allowlists; the recordings live on the developer's disk only (a private copy is kept outside the repo), and the commits that once held them are purged from history. This replaces decisions 20 and 26 wherever they say the recorded tree is committed. Tests that replay recordings (WP4b manifest, WP5 recorded, WP6 replay and allowlist equality) must report "recordings not present (local-only, decision 61)" and skip visibly when the tree is absent, never pass vacuously; WP13 adds that guard and the CI note.
60. (From the WP11 final pass) The engine's alerts hook gains a third argument `pass: { stop: 'completed' | 'budget' }` (it runs before the execution status is written); WP11 makes the WP7 code change. db `updateEvents` gains reason, fire-time and digest-id patch fields.
59. (From the WP11 round-2 review) With no SMTP configured, digests that only reach the log are recorded `suppressed` ("email not configured"), and the cooldown counts only `notified` events. A retried send that succeeds rewrites the row: reason cleared of the failure, fire time and digest id set to the successful send. The budget-stop lines appear only when the execution's stop was a budget pause. A queued event says why it is queued (send failed, hourly limit, migrated) and whether a retry will come. Email previous prices carry '≈' when FX-converted. Whole-hour date helpers come from core (`hoursSince`, which WP8 moves into core and exports; WP11 then imports it); the row-reference string comes from one `rowRef`; the payload's verdict-class list derives from the shared schema; no silent catch.
58. (From the WP8 round-2 review) Effective age is never younger than the fetch age (`max(fetch age, observed age)`). A run's scoped reads include the reused copies that run made, so coverage and minima agree. "Superseded" compares against the latest execution that searched the cell, not merely the latest run. The calendar's `byDestination` field is dropped from the contract (no client reads it). Minima pick freshness before the per-itinerary dedup, so a fresh offer from another seller is never hidden by a cheaper stale one. The calendar gap's reference price is "the reference verified price (latest seen, then fresh, then cheapest)" in spec and web wording. The engine exports its existing `confirmationNeeded` and window-scope helper; WP8 calls them and keeps no copies. The app bootstrap takes the lock right after `buildPorts` and seeds airports under it. One `BootError` class; one per-definition guard; `no-store` is the first middleware so every response carries it.
57. (Dependency order, from the WP8 round-1 revision) WP8 depends on contract fields WP9's Task 9.0 and WP10's Task 10.1 introduce, while WP9 and WP10 depend on WP8. So WP8's implementer applies WP9 Task 9.0 and WP10 Task 10.1 verbatim as its first two tasks, and WP9's and WP10's implementers skip them (already on main). Result rows carry `superseded: boolean`; WP9's implementer renders it through PriceCell's `superseded` prop. WP7's confirmation check and `budgetFit` use core's `budgetScopeLabel`, and db's reuse-copy rule calls `retriedOnResume` (small follow-up commits on main after WP8 merges, since WP8 adds both helpers).
56. (From the WP11 round-1 review) Core declares `alertEventPayloadSchema` (price, provenance, previous price and its provenance, reason parts); the engine writes and the web reads it, no local copies. Events are persisted as `queued` in a transaction before the email is sent and marked `notified` after (spec §8.1 order); a failed send leaves them queued for the next pass and nothing is sent twice. Rows an earlier pass recorded are found by a db query on (rule, execution), never a scan with a margin. Core exports `sourceLabel(provenance)`, the one copy of the §11 source wording, used by the engine's templates and WP9's PriceCell. A price with unknown vendor age is still stale when its fetch age alone exceeds the threshold (core `isStale`). The Alerts view shows the fare and the previous price each through PriceCell from the stored payload; reason text keeps `data-quote`. Operator messages are de-duplicated per kind per definition per day, and outgoing email has a ceiling (`ALERT_EMAIL_MAX_PER_HOUR`, default 20) beyond which messages are logged and dropped; it counts sent and in-flight emails only, so a failed send gives its slot back. nodemailer stays in @gmt/engine as the plan's file map says.
55. (From the WP11 refresh) Alerts send at most one digest per rule per stop of an execution (a paused_budget stop and the later completion may each send one) and never repeat a firing; spec §6.8 wording to follow. Core owns one `isStale(provenance, now, thresholdHours)` by effective age (WP8 adds it; WP8 and WP11 both call it, no second copy). Core's unknown-age label reads "vendor's cache age unknown" (WP8 changes the label). Prices quoted inside text (alert thresholds, firing reasons) carry `data-quote`, a third marker WP9's price sweep accepts beside PriceCell and `data-cost` (WP11 adds it to the sweep by find/replace).
54. (From the WP8 round-1 review) Staleness compares the effective age (`providerObservedAt` age when present, else fetch age plus known `maxAgeHours`). "Not seen in latest search" applies to every verified-basis figure (calendar day minima, duration minima, calendar-gap cheapest), not only /results. A calendar-basis price whose cell a newer parent execution found empty or no_data is marked "superseded by a later search" and ranked after current prices. Duration `searched` flags and minima use the same execution set. Route-level series points carry `stale` by fetch age and the indicative label; their FX flag is always false (GBP-only, decision 25). The API contract's link fields refine to https on a host in `LINK_ALLOWLIST`, so every response re-validates vendor links. Failed-auth limiting is per client IP (TRUST_PROXY-aware) and a correct credential always succeeds; estimate, coverage-check, run, resume and verify allow one request at a time per definition (429 "already running" otherwise). Host rejection names the variable, never its values. Each body and query is validated once. WP8 consumes WP7's final surface: `childCapPreview` result codes, `verifyCell` confirmation, `confirmationOf`, `RowRejected('active')`.
53. (From the WP8 refresh) The app bootstrap checks the lock read-only before any backup or migration, as the record tool does (refuses a live second app with exit 75). Stored and response definitions may be drafts with no airports; offer-history points carry `suppliedFields`. WP7 exports `SOFT_CONFIRM_CALL_SHARE` (0.2) and WP8 uses it. Core's `worstCaseAgeHours`/`effectiveAge` follow spec rev 23 (WP8 changes them in core with tests, no local conversion). The calendar endpoint takes an optional `destination` parameter and computes day buckets, minimums and `unconfirmedCells` for that destination, so a destination-filtered calendar is honest without per-destination fields.
52. (From the WP10 round-2 review) Every fare in the DOM goes through PriceCell, chart tooltips included; the `data-scale` exemption covers axis and legend scale values only. A "cached from £X" note shows its destination and stay. All run times render in `SCHEDULER_TIMEZONE` (Europe/London) everywhere, WP9's header included (WP10 carries the find/replace edit). History lines join only consecutive executions of the definition in run order, never by a time gap. The route-level series is named by its provider ("SearchApi route-level series, indicative"). History reads its run list from the executions list query the status bar uses, not from the calendar response.
51. (From the WP10 alignment) `calendarDaySchema.verification.unconfirmedCells: number` (WP10 adds it; WP8 fills it: cells of that day, under the active destination filter, whose itinerary search priced but confirmed no price). The web's date guard forbids `Date` objects outside WP9's `now.tsx`; `Date.parse` to epoch milliseconds is allowed. Each calendar month is a captioned table of day buttons with a roving tab stop (no ARIA grid, which Biome cannot accept without a suppression).
50. (From the WP7 branch review) A resume never re-fetches a departed cell (departed `error` cells become `skipped:departed` before planning). Reuse is applied before any `skipped:budget` marking, and budget blocking is per (provider, stage) line, so a 0-call line is never blocked. Stride's "no discovery provider" test counts only discovery providers that sell the cabin (spec §6.7). The tick never auto-resumes an execution-scope `paused_budget` run; only provider-month and lifetime pauses with a `resume_after` resume automatically. The engine never reads SQLite error codes; db exposes the condition. One priced-reason builder and parser in core.
49. (From the WP9 round-3 review) One suppression check: `scripts/check-boundaries.mjs` rejects `biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` in every package; no scoped lint overrides are granted, so WP10 and WP11 restructure the code that needed one. Every micro-GBP→pence conversion uses core's `microGbpToPence` (rounds up); a cap typed in pounds converts exactly. Tests of root scripts live in `scripts/*.test.mjs`, run by a root Vitest project `scripts`.
48. (From the WP7 round-3 revision) Decision 19's closed priced-reason set gains the part `price-unconfirmed` (joined with `;` like the others): a verified outcome whose cheapest price the final step did not confirm keeps that price (the CHECK requires one) and the reason part, core's roll-up ignores such outcomes for `verification_min_pence`, and a merge prefers a confirmed outcome over a cheaper unconfirmed one. The engine computes no price staleness; it passes `fetchedAt` and `maxAgeHours` (null when unknown) for WP8. `StartOptions` is the engine's one start-options type; `Engine.childCapPreview` fills the cell detail's `verify`. Every package's cast check is `pnpm casts` (`scripts/check-casts.mjs`, CI step); per-brief greps and WP9's own guard switch to it. WP8 shows a priced verification roll-up with a null price as "price not confirmed".
47. (From the WP7 round-3 and WP5 fix reviews) Core exports `isTruncated(reason: string | null)` beside `TRUNCATED_NOTE`, the one prefix check every reader uses. One `microGbpToPence` rounding helper in core replaces the six inline copies. A segment has no operating flight number field, so a codeshare keeps the operating carrier only (recorded Phase 4 gap). WP8's brief must replace `setConfirmedCost` with `setConfirmed` and send calls (its review round picks this up). http-kit's 200-character cap on vendor messages stays (it bounds `last_error`).
45. (From the WP7 round-3 review) Prices from a truncated tile are never reused: the engine's reuse filter excludes outcomes whose last_error starts with `TRUNCATED_NOTE`. A verified cell's `verification_min_pence` counts only confirmed prices (null when none) and `best_observation_id` prefers the cheapest confirmed observation, falling back to the cheapest unconfirmed; verified-basis views therefore never show an unconfirmed fare as the itinerary-search price. `Engine.childCapPreview(definitionId, cell): { maxCalls, headroomCalls }` uses the same calculation the child gets. A malformed offer amount fails only its cell (`parse`), like calendar prices. The cast check is a committed `scripts/check-casts.mjs` with its own test, run by `pnpm casts` and CI, and it fails on an empty file list.
44. (From the WP9 round-2 review) Staleness uses the fetch age: a price is stale when (now − fetchedAt) plus its known `maxAgeHours` exceeds the threshold; when the vendor's age is `'unknown'` only the fetch age counts and the price carries the label "vendor's cache age unknown" instead of being marked stale (WP8 fills `stale` by this rule; the stale banner says "older than one refresh cycle" only for rows stale by fetch age). An offer whose price the final step did not confirm shows the badge "price not confirmed by the final step" wherever it renders (table, headline, other sellers), never only in the expanded row. Confirmation and Run now send `confirmedCalls`/`confirmCalls` with pence. Estimates are worded "about N calls (hard stop M)", never "up to". A metro code typed into an airport field expands to its member airports on Enter or Add, the same as picking it from the list. No lint-suppression comments anywhere; a scrollable table uses a labelled region (no `tabIndex`, decision 46).
43. (From the WP7 round-2 revision) Core exports `priceInGbp` for calendar money; `setConfirmed(definitionId, { pence, calls })` replaces `setConfirmedCost`; `Engine.start` takes `confirmCalls`; a confirmation covers a run only when both pence and calls suffice; a child's cap is max(CHILD_MAX_CALLS, min(estimate, headroom)) with headroom net of other active children; a start whose every discovery provider is blocked is refused; a provider blocked at start is excluded from estimate totals; stale paused runs are cancelled, not replaced off-schedule; the cast check is an AST script; `apps/api` wiring takes `fxHttpLimits` from the engine. WP8 stores both confirmation figures, judges discovery overrun on tiles and derives `truncated` from `TRUNCATED_NOTE`; WP9/WP11 render null `cachedRows` as "not checked", coverage `calls` as tiles and the `priceConfirmed` label.
41. (From the WP5 branch review) A rate-limit or limiter-timeout in the middle of an itinerary chain propagates as decision 17 requires, so the step-2 offers already paid for are discarded and the cell is re-billed on resume; accepted as a rare residual (the alternative, carrying offers on a ProviderError, would blur the error contract). A step-2 fare dropped for a missing airline marks the result partial when returns were priced. A calendar row carrying both `has_no_flights` and a price is a conflicting entry, never "no fares".
40. (From the WP5 implementation against the live recordings) SearchApi's `price_insights` route-level series is best-effort: the recorded step-1 response (`sort_by=price`, `separate_tickets=1`) carries none, so the adapter returns an empty route history with an informational note and no error; WP10's route-level chart shows "no history supplied by the vendor" when empty. The recordings also put flight options under `other_flights` only; the adapter reads both `best_flights` and `other_flights`.
39. (From the WP6 branch review) The recorded metro tiles also show rows whose return leg lands at a different airport of the metro (the link's `t=` token encodes the itinerary), so attributing a metro row by `origin_airport` produced the wrong cell, a second reason for decision 34. The adapter parses the return airport from the token and drops any row that is not a closed round trip for the pair as a per-cell issue (`parse`, detail `return-airport-mismatch`); a replay test pins that every airport-tile row is closed. TP-21 (JFK→LON) is metro evidence, not an airport tile. The recording tool uses the adapter's limits, URL builder and the shared money helper (decision 32 done).
38. (From the WP10 brief review) One date-formatting module in the web app (WP9's), extended by WP10. The heatmap's default colour basis is the calendar basis unless verified days are a majority; every priced day carries a visible non-colour coverage cue; a day whose cells are all skipped shows a "skipped" state; a verified day that hides a cheaper cached fare says so; with fewer than ten priced days or a price spread under 10% the scale is flat and says so; day cells show price, compact badge, stay (nights or return date) and the coverage cue, details in the panel; phone width shows one month at a time. The route-level history series gets its own chart (price by travel date) labelled indicative; fetch-time series connect only consecutive scheduled runs; unverified offers plot dashed and labelled. Contract additions (core api-contract, WP10 adds with tests; WP8 fills): per-series `searched` flags in the duration analysis, the `cell` of each per-nights minimum, `stale` on history points. With a destination filter, day glyphs and buckets derive from that destination's cells only. The per-cell verify button shows the child's call cap and remaining headroom. Cross-execution views carry a ViewHeader variant. Duration table rows link to Results filtered by nights. A bucket total that disagrees with its sum renders "counts inconsistent". Legends define n.
37. (From the WP7 round-2 review) Core's closed error-reason list gains `no-priced-options` (stored honestly, excluded from resume estimates, never retried automatically). Core exports `TRUNCATED_NOTE`. A provider-month cap breach pauses the run with resume_after at the window reopening, as spec §7 says, and the guidance copy matches. Core's results classing treats an offer whose `price` is not a supplied field as `unverified` ("price not confirmed by the final step") regardless of constraints. The coverage check counts cells a page cap left unread as not checked, and its `calls` figure is labelled as tiles. Definitions gain `confirmed_calls` beside `confirmed_cost_pence` (WP7 adds migration 0001) and the pre-start comparison covers both. The child cap honours spec rev 18's `CHILD_MAX_CALLS` floor.
36. (From the WP9 brief review) Every price in the DOM renders through one PriceCell (FX marker, provider badge, source, age); the headline derives from the filtered set. Contract parsing runs in production too. `scripts/check-boundaries.mjs` checks airport literals over apps/web/src and apps/api/src, allowlisting only apps/web/src/example.ts and apps/api/src/tools/workedExample.ts; all example copy lives in example.ts. Core's ResultFilters gains a departure-date range filter (WP9 adds it); a max-travel-time filter and a Google Flights deep link are Phase 4. Confirmation copy shows calls as well as pence. The shell shows an error state when GET /api/providers fails. The coverage view adds a "with a price" share beside the spec's "searched"; stage totals count only searched outcomes. The api-contract gains `truncated: boolean` on calendar-basis rows and price cells, derived by WP8 from an outcome's last_error starting with core's exported `TRUNCATED_NOTE` (decision 30), rendered as "cheapest of the rows read".
35. (From the WP6 branch review) Each Travelpayouts row's `link` carries `search_date=DDMMYYYY`, the day an Aviasales user found the fare; the recordings show rows 4–7 days old against the vendor's declared 48 h horizon. The adapter parses it into `RawCalendarPrice.providerObservedAt` (that day at 00:00 UTC, the oldest reading) and the age label uses it; the 48 h declaration is the fallback only when a link lacks the field, and the provenance note says so. The recording tool's plan moves to airport-pair tiles before any re-recording (WP13 or the next WP4b touch). Spec revision 19.
34. (From the WP6 replay tests against the live recordings) A Travelpayouts metro query returns one cheapest row per date pair across every airport in the metro, so a cheaper non-definition airport hides the definition's own fare (LON→JFK 2027-03-29/04-10 returned only an LTN row while LHR→JFK priced it). Travelpayouts is queried per (origin airport, destination airport, month) only; no metro queries, no cache-dedup saving (worked example 28 upstream free calls per scan); `DiscoveryQuery.definitionOrigins` is removed from core's provider port; the recorded metro tiles stay as evidence and one WP6 test documents the behaviour. Spec revision 17.
33. (From the WP6 implementation against the live recordings) Travelpayouts writes a zero offset as `Z`: the adapter accepts `Z` as `+00:00` (time kind 'offset'); offset-less times stay refused. Rows carry undocumented keys `gate` (selling agency), `duration_to` and `duration_back`: the row schema allows unknown keys while validating the known ones; nothing reads them in Phases 1–3 and `suppliedFields` is unchanged (calendar prices carry no seller).
32. (From the WP4b fix round) Follow-ups owned by later packages: WP6 replaces the recording tool's hand-written pence conversion with the shared `majorToMinor`; WP5 and WP6 replace the tool's `recordingLimits` with their adapters' limit functions; WP7 moves `fxHttpLimits` beside the fx client; a db repository query for credits spent by tool executions replaces the tool's inline SQL when WP7 touches the ledger repo. The pre-migration preflight helpers live in `apps/api/src/bootstrap/preflight.ts` for WP8's app bootstrap to reuse.
31. (From the WP6 round-3 review) WP4b records one extra free Travelpayouts call, TP-21, the reverse-direction month tile JFK → LON, so WP6's replay test asserts that every row's local departure month matches the tile month for a westward origin (UTC bucketing at month boundaries). A SearchApi chain that ends with zero usable offers throws (`parse` or `upstream` by cause) rather than returning a priced result with no offers, so WP7 never writes `empty` for a cell the vendor priced. The fixture provider's synthetic offers carry `verified: true` (they stand in for confirmed prices under the synthetic gate). Per-directory coverage floors for adapters live in the providers vitest config.
30. (From the WP6 round-2 revision) The discovery tile result gains `truncated?: boolean`, set when the pagination cap stopped a tile before its last page; WP7 labels prices from a truncated tile "cheapest of the rows read" and leaves unread covered cells as `error`/`upstream` via `cellIssues`. `parseError` and `parseVendor` require `where`. The fixture provider uses the shared `parseError` and `NoteCounter` (its drop note is `dropped-outside-tile`). The providers main barrel exports only each adapter's provider, limits and params constants plus `withContentHash` and `assertRecordedRoot` (for WP4b's tool); shared helpers stay internal except through the named `@gmt/providers/recording` subpath, which exposes `majorToMinor`, `buildRequestUrl`, `PAGE_LIMIT`, the page cap and `TileParams` to apps/api's recording tool only (decision 39); the tool takes the adapter's limits from the main barrel's `travelpayoutsHttpLimits`. Root scripts run tools with `pnpm -C apps/api run tool …` so the tool's exit code reaches the operator. The logger scrubs through pino's `hooks.streamWrite` and writes through `pino.destination({ dest, sync: true })`. Spec §5.1 is to list `definitionOrigins?`, `cellIssues?`, `truncated?` and `RawOffer.verified` at its next revision.
29. (From the WP5 round-2 review) WP5 adds `RawOffer.verified: boolean` to core's provider port (true only when step 3 confirmed the price). A currency whose minor-unit exponent core does not know is the normalisation reason `currency-unsupported` in both adapters: rows dropped and counted, never a tile-level parse error. `separate_tickets=1` is sent on both SearchApi engines (documented for both), and WP4b records it on both; the recorded in-limit rectangle uses the production tiling shape (9 × 20 for the worked band). The shared `NoteCounter` (add/get/list), `parseError(cause, detail, where)` with `where` always given, and `parseVendor` are the only parse and note helpers in the adapters. WP5 depends on WP6.
28. (From the WP6 brief revision) (`DiscoveryQuery.definitionOrigins?` was added here and withdrawn by decision 34.) The tile result gains `cellIssues?: CellIssue[]` so a dropped row or an unread cell is reported per cell and never becomes `no_data`. `HttpKitRequest.ledgerCacheHit?` lets a multi-page cached tile ledger one cache-hit row per tile. `parseError(cause, detail, where?)`. Every Travelpayouts page must state its currency (the empty envelope too); a repeated page or an unreadable row is a parse error for the tile; `Z` or offset-less vendor times are refused; a bad vendor price is reason `parse`. `MAX_PAGES` is 3 (decision 26). WP6 implements these core and http-kit additions in its own tasks.
27. (From the WP5 brief revision) `RawOffer` gains `verified: boolean`, true only when step 3 confirmed the price; WP7 writes unverified step-2 offers with `unverified` set and never as verified fares. Offers whose seller the vendor does not state are dropped and counted (`RawOffer.seller` is part of the fare-offer identity). A chain stopped by budget or cancel returns the step-2 offers it already paid for as a partial result, and WP7 writes a result that arrives after the stop signal (decision 25). `searchApiProvider` takes `costPerCallMicroGbp` (the configured rate), not a plan id. SearchApi tiling uses the largest outbound block b with b × (b + maxNights − minNights) ≤ 200 (worked band: 9 days, 21 tiles per pair, 84 discovery calls for four pairs; spec rev 15). `ItineraryQuery` has no self-transfer field: allowing self-transfer is a recorded Phase 4 gap. WP13 smoke rows: compare one recorded fare with the vendor's own page; try a 9-day rectangle; confirm `separate_tickets=1` excludes separate tickets. Dispatch order: WP6 merges before WP5 (WP5 consumes WP6's shared modules). `readOnlyLockState` returns a discriminated union.
26. (From the WP4b brief revision, round 2) `recordFixtures` ctx `recordedBy` is required (no fallback signature); `RunToolOptions.recording` carries root and signature together; `RecordSummary.chain` is `{ currency: 'GBP'; step1PricePence; step2PricePence; step3Options: [{ bookWith; pricePence }] }`. The committed recorded tree takes only the worked example's route; any other route needs `--out DIR` outside the repository (exit 64 otherwise). `apps/api/src/tools/workedExample.ts` joins `apps/web/src/example.ts` as the application files allowed to name the worked example's airports. Travelpayouts paging is capped at 3 pages per tile (`TP_MAX_PAGES_PER_TILE`). Tools run as the app's user (WP12 setup docs) because the read-only lock probe can leave -wal/-shm side files. A recording run that threw ends `cancelled` with errorText `record:fixtures failed: …`; one whose required calls were not as planned ends `completed` with errorText naming them. `separate_tickets=1` is the inferred excluding value; the first live run's recorded file is the authority.
25. (From the WP7 brief review) A reservation that passed every cap is honoured: in-flight calls finish and write; only new reservations are refused on a budget stop; aborts happen only on operator cancel. Enabling or changing a schedule is refused when the summed monthly estimate of all enabled definitions would exceed the provider-month cap; the pre-start check uses remaining headroom. Soft confirmation triggers on runnable calls above 20% of the provider-month call cap as well as on pence. A child's maxCalls is ceil(per-cell estimate × ESTIMATE_RETRY_FACTOR) bounded by the parent's headroom; a child never pauses (cap breach → `cancelled`, cell stays unverified). The alerts step runs on completion and on paused_budget. confirmed_cost_pence records the worst-case estimate without reuse. `no-priced-options` is non-retryable automatically like `no-return-legs`; boot re-registration applies the stale-paused check; a paused run with no resume_after is superseded once older than 0.9 × discoveryRefreshHours. Coverage check counts distinct in-band cells and reports null for failed tiles. runsPerMonth = firings per 365-day year ÷ 12. Route price history keeps only vendor-supplied GBP points. Engine test harnesses live under packages/engine/test and stub only the 'fixture' provider.
24. (From the WP5 and WP6 brief reviews) Shared adapter helpers live once in @gmt/providers: `shared/money.ts` `majorToMinor(major, currency)` (exact decimal-string arithmetic over core's MINOR_EXPONENT; null for excess precision or a non-positive amount, and the row is dropped and counted `offers-dropped:n`); `shared/errors.ts` `parseError(cause, detail)` whose `reason` is the closed-list kind-level reason and whose URL-free message carries the machine cause. A covered cell whose every row was dropped becomes `error` with the normalisation reason (spec §8.1). The ledger's unit is the tile: a sibling pair records one cache-hit row per tile, never per page. Healthchecks are stateless and probe nothing: `ok: true` with detail 'not probed' (`recentCalls` returns only a count, so no derivation is possible). Travelpayouts is queried per airport pair only (decision 34). SearchApi itinerary results carry `maxAgeHours: 'unknown'`. A chain stopped by budget or abort persists the step-2 offers it already paid for as unverified with reason `partial-expansion`. The recorded SearchApi allowlist (WP4b) equals WP5's SEARCHAPI_PARAMS: `adults=1` and `travel_class` on both engines, the documented price-sort and separate-ticket-exclusion parameters on google_flights, no `stops`; `DiscoveryQuery.maxStops` is a recorded Phase 4 gap. `clock` stays in every adapter constructor. Never invent a seller: null and `suppliedFields` without 'seller' when the vendor states none.
23. (From the WP4b brief revision) `createLogger(config, opts?: { fd?, secrets? })` scrubs secret values from every line; `runTool(name, argv, opts?)` takes test-injectable runners; `recordFixtures` ctx carries `recordedRoot`, `recordedBy` and `plan`; `RecordArgs` has no `metro`; `RecordSummary` gains `session` and `chain`; `RecordedCall.status` adds `'aborted' | 'no-response'` with `files` and `detail`. The SearchApi 401 probe runs before any billed call because the guard counts a pending reservation (WP13's smoke orders probes the same way). The hidden recording execution ends `completed` even when the guard refused calls (count in errorText), never `paused_budget`. @gmt/db exports `readOnlyLockState(dbPath, clock)` for the pre-migration lock probe; apps/api never imports better-sqlite3.
22. (From the WP3 fix round) `CellsRepo.copyReused` takes a fourth argument `criteria: ReuseCriteria` (`{ pointOfSale, sourceKind, newerThan }`, exported by @gmt/db) and refuses any copy whose source misses it; core exports `isPartialExpansion(reason)`; the error-reason list includes `cell-mismatch`.
21. (From the WP2 branch review) `DigestItem.previousAgeHours` is renamed `fetchGapHours` (it is the gap between the two fetches, not the previous price's age); the calendar comparison window compares the gap in whole minutes; core exports `DEFAULT_DISCOVERY_REFRESH_HOURS` (168) and `stripControlChars(s, replacement = '')`, and WP7/WP11 use them instead of local copies.
20. (From the WP4b brief review) The recording run makes no 429 burst; WP5 maps rate limits from a synthetic labelled fixture and `rateLimitFallbackWaitSeconds`, Retry-After behaviour unverified against the vendor. `RecordedFixture.responseHeaders` carries an allowlisted scrubbed subset (`retry-after`, `content-type`, `x-ratelimit-*`, `ratelimit-*`). `@gmt/providers/testing` exports `verifyRecordedTree`/`verifyRecordedFile` and `installNetworkGuards()`; no other package imports msw. Tools run against the operator's configured DATABASE_PATH (the production ledger), inspect app_lock read-only before any backup or migration, refuse when `syntheticAllowed(config)` is true, seed airports when the table is empty or the dataset version changed, and refuse a live recording whose planned calls plus credits already ledgered to tool executions in the lifetime window exceed `--budget` unless `--confirm-rerun` is passed. The recorded fixture tree is for this private repository; publishing the repository requires removing or re-recording vendor bodies. Every SearchApi request carries `travel_class`.
19. (From the WP3 branch reviews) Priced outcome reasons form a closed set: null, `partial-expansion`, `offers-dropped:n` and the combined `partial-expansion;offers-dropped:n`; core detects partial expansion by splitting on `;`, and roll-ups still carry only `partial-expansion`. `CalendarPricesRepo.supersedeReused` is removed: writeTile supersedes reused rows inline. `CalendarPricesRepo.insert` keeps the priced ⇔ price invariant by behaving as a prices-only tile write (outcome merged, roll-up recomputed, same transaction). writeTile merges fresh-on-fresh priced overlap through core's mergeWithinProvider, keeping the cheaper price row. `ItinerariesRepo.upsertOffer`/`insertObservation` are replaced by one transactional `recordObservation(offer, observation)`.
18. (From WP4's scratch run) msw 3 can reach the real network in three cases: it follows a mocked 3xx itself, it rejects a fetch whose mocked body stream errors, and it passes a socket through when the client aborts first. Every package's msw test setup therefore installs a catch-all handler that fails the test on any unmatched request, uses handlers that settle when the client aborts, and blocks DNS lookups for the run; the WP4 brief's `test/setup.ts` is the reference and WP5–WP13 reuse it through `@gmt/providers/testing`.
17. (Round 4, from the wave-1 second-pass reviews) `RecordedFixture.session` and `fetchedAt` on the recorder hook; replay misses answered with an error response, never passed through; `replayHandlers` filters by `session`; the limiter is specified per fixed bottleneck window with `minTime = ceil(60000 / ratePerMinute)` smoothing; in a chained verification, `auth`, `quota`, `rate-limit` and `limiter-timeout` from any step propagate (only `upstream`, `network` and `parse` count as a failed expansion; spec §5.2 rev 12 says so); a fresh error never displaces a reused result; child snapshots carry `topN: 1`; `definitionShapeSchema` (unrefined) is the read-side schema for stored definitions and snapshots; the contract's inferred types (`ResultRow`, `HistoryPoint`, `RouteSeriesPoint`, `BudgetFit`, `SchedulerJob`, `CalendarDay`, `CoverageCheckRequest/Response`, `DefinitionResponse`) are exported from core's barrel; every package has a cross-package source-resolution smoke test; `DefinitionsRepo.create` accepts `confirmedCostPence`.
16. (WP0 implementation, 2026-10-14) Settled while building WP0: `Estimate` is an interface in `types/execution.ts` and `estimateSchema` is `z.ZodType<Estimate>` (types never depend on the contract); `alertRuleUpdateRequestSchema` (an unrefined partial) is the PUT body because zod 4 refuses `.partial()` on a refined object; `isRealDate`, `asIsoMonth` and `isoDateTimeOfEpochMs` are exported from `types/ids.ts`; `parseCellKeyString` validates through a zod tuple; pnpm 12 declares build scripts as `allowBuilds: { better-sqlite3: true, esbuild: true }` in `pnpm-workspace.yaml` (the `onlyBuiltDependencies` key of Task 0.1 is the pnpm 10 form); the `Db.immediateTransaction` lock test asserts `code: 'SQLITE_BUSY'`; `pendingMigrations` reads `meta/_journal.json` and `__drizzle_migrations.created_at`.
15. (Round 3, from the wave-1 brief reviews) `classifyError` returns `ProviderError | undefined` over `ResponseFacts`; the ledger-at-cap arm of the 429 rule is dropped (quota only via a recognised body); joiners of in-flight requests record cache-hit rows and own their abort; cache `accept` hook; `HttpKitDeps.syntheticAllowed`; `fixtureRouter(root, gate)` on the `@gmt/providers/fixture` subpath; `rateLimitFallbackWaitSeconds`; `BudgetGuard.recentCalls`; allowlist keys with an engine discriminator; `replayHandlers` with a miss log; the `@gmt/source` export condition; `tsconfig.test.json` everywhere; `test:tz` in core; WP3 depends on WP1 and calls core's roll-up (no SQL copy); `reserve` refuses a mismatched cost; `Db.immediateTransaction`; `bestObservationSelector` and `BudgetConfig.fixtureCostMicroGbp` removed; `history` is one point per execution fetch; `latestVerificationOutcomeForCell` and `series` take a cabin; alert rules soft-delete; the `providers` table is removed; `selectCandidates` throws above `maxCells`; the cabin-not-offered precedence and roll-up reason rules; `dedupByItinerary(rows, now)` by class first; stale rows never demoted; the minimum drop step inside the cooldown; `verdictClass` throws without a cabin; `CalendarCandidate.fetchedByExecutionId`; `newRestCount`; nullable search links for synthetic rows; `formatPence` and `CONSTRAINT_LABELS` in core; `otherOffers` carry class and unverified names; the as* helpers are the only brand mint sites; the per-provider secret binding and a CI commit-trailer rule are declined.
14. (Round 2) `backupDatabase` lives in `@gmt/db` (WP3) so both bootstraps can call it before WP12 exists; `ParamsAllowlist` lives in `@gmt/providers` (WP4); the cache key never includes execution or tile ids; recorded headers drop credentials entirely; one exit-code table for every CLI; `DigestItem` carries segments, expiry and the row key; `Firing.suppressed`; `resultRowKey`; `cell-mismatch`; `confirmedCostPence` on create/update; estimate responses carry `budgetFit`; calendar-gap carries the verified price with provenance; alert events filter by definition; child budget inherits all but `maxCalls`; `provider_capped` and `crash_loop` notification kinds; `EngineOptions.providerConcurrency`; four schema columns and `best_observation_id` semantics; spec §6.1 signature and §5.4 silent cases settled (rev 10).

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
  "engines": { "node": ">=22.18" },
  "scripts": {
    "build": "pnpm -r --filter './packages/**' --filter './apps/**' build",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "mutate": "pnpm --filter @gmt/core mutate",
    "dev": "pnpm --parallel --filter @gmt/api --filter @gmt/web dev",
    "smoke:live": "pnpm -C apps/api run tool smoke",
    "record:fixtures": "pnpm -C apps/api run tool record",
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

Dependencies per package: `@gmt/db`: `@gmt/core`, `better-sqlite3@13.0.3`, `drizzle-orm@0.45.4`; dev `drizzle-kit@0.31.11`, `@types/better-sqlite3@9.6.0`. `@gmt/providers`: `@gmt/core`, `bottleneck@2.19.5`, `p-retry@8.0.1`, `hono@4.13.13`, `msw@3.0.3` (a runtime dependency: the fixture server and replay, decision 7), `zod@4.6.7`. `@gmt/engine`: `@gmt/core`, `@gmt/db`, `@gmt/providers`, `croner@10.0.1`, `nodemailer@10.1.1`, `zod@4.6.7`; dev `@types/nodemailer@8.0.2`, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0` (the engine logs through the Logger port, so it has no pino). `@gmt/api`: all four, `hono@4.13.13`, `@hono/node-server@2.1.5`, `pino@10.4.0`, `zod@4.6.7` (routes validate with the contract schemas through their own `route()` helper, so `@hono/zod-validator` is not used); dev `tsx@4.23.15`, `yaml@2.9.1`. `@gmt/web`: `@gmt/core`, `react@19.3.1`, `react-dom@19.3.1`, `@tanstack/react-query@5.104.2`, `@tanstack/react-table@9.3.1`, `recharts@3.10.1`, `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`; dev `vite@8.3.4`, `@vitejs/plugin-react@6.1.2`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `jsdom@30.1.2`, `@testing-library/react@16.3.3`, `@testing-library/jest-dom@7.0.1`, `@testing-library/user-event@14.6.8`, `@playwright/test@1.64.1`. Workspace packages use `"workspace:*"`. Root dev: `@types/node@26.6.5`.

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src"]
}
```

`packages/core/tsconfig.test.json` (every package has one; `typecheck` runs both so test code is type-checked too):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "composite": false, "types": ["node"] },
  "include": ["src", "test"]
}
```

The `typecheck` script is `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json`. `core`'s `test` script is `vitest run --coverage && pnpm run test:tz` with `"test:tz": "TZ=Europe/London vitest run && TZ=UTC vitest run && TZ=America/Los_Angeles vitest run && TZ=Asia/Tokyo vitest run"` so the timezone matrix runs in CI.

**Source resolution across the workspace.** Every package's `exports` map carries a `"@gmt/source"` condition pointing at `./src/*.ts` beside the `default` → `dist` entries, and `tsconfig.base.json` sets `"customConditions": ["@gmt/source"]`, so `tsc` resolves workspace packages from source. Vitest externalises workspace packages and resolves them through Node (which ignores the custom condition), so every `vitest.config.ts` uses `resolve: { alias: gmtAliases(repoRoot) }` from the root `vitest.aliases.ts`, which maps `@gmt/<pkg>` and the `@gmt/providers/testing`, `@gmt/providers/fixture` and `@gmt/engine/testing` subpaths to their `src` index files. Vite's dev server for the web app uses the same aliases (WP9). `node` at runtime (the Docker image, `tsx` dev scripts) uses `dist` unless started with `--conditions=@gmt/source`.

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

Run: `pnpm --filter @gmt/core exec vitest run test/config/synthetic.test.ts`
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

Run: `pnpm --filter @gmt/core exec vitest run test/config/synthetic.test.ts`
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
  it('trims and upper-cases input (review focus 1)', () => expect(iataSchema.parse(' lhr ')).toBe('LHR'));
  it.each(['LHRX', 'LH', '12A', '', 'lh r'])('rejects %j', (v) => expect(iataSchema.safeParse(v).success).toBe(false));
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

Run: `pnpm --filter @gmt/core exec vitest run test/types/ids.test.ts`
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

// why: operators type 'lhr'; the API accepts it and stores 'LHR'. Metro codes (LON) pass this
// format check and are rejected later by validateSearchSpace against the airports table.
export const iataSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'IATA code must be three letters')
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
/** The only brand mint sites besides zod transforms; usable in production for constructed values, never on raw user input (zod does that). */
export const asIata = (s: string): Iata => must(iataSchema, s, 'not an IATA code');
export const asIsoDate = (s: string): IsoDate => must(isoDateSchema, s, 'not an ISO date');
export const asIsoMonth = (s: string): IsoMonth => must(isoMonthSchema, s, 'not an ISO month');
export const asIsoDateTime = (s: string): IsoDateTime => must(isoDateTimeSchema, s, 'not an ISO timestamp');
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/types/ids.test.ts`
Expected: PASS; `isRealDate` branches covered by the `it.each` rows (add `['2026-00-10']` and `['2026-10-00']` rows if the branch report shows a gap).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp0: branded ids and date schemas"
```

### Task 0.4: Domain types, ports and errors

**Files:**
- Create: `packages/core/src/types/provenance.ts`, `types/definition.ts` (incl. `cellKeyString`/`parseCellKeyString`), `types/execution.ts`, `types/itinerary.ts`, `types/alerts.ts`, `ports/provider.ts`, `ports/budget.ts`, `ports/cache.ts`, `ports/notifier.ts`, `ports/logger.ts`, `ports/clock.ts`, `errors.ts`
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
import type { ProviderId } from './types/provenance.js';

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

export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time' | 'cell-mismatch';

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
import { type IsoDate, type IsoDateTime, isoDateSchema, isoDateTimeSchema } from './ids.js';

/** Spec §5.1. Defined here (not in ports/provider.ts) so types and ports share one source. */
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
/** ISO 3166-1 alpha-2 of the vendor's echoed point of sale (POINT_OF_SALE), or 'unknown' when the vendor ignores it. */
export type PointOfSale = string | 'unknown';
export const sourceKindSchema = z.enum(['authorised-cached', 'scraped-aggregate', 'scraped-search', 'synthetic']);
export const cabinSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);
export const pointOfSaleSchema = z.string().regex(/^[A-Z]{2}$/).or(z.literal('unknown'));
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

// why: `.exactOptional()` (zod 4) matches `providerObservedAt?: IsoDateTime` under exactOptionalPropertyTypes;
// `.optional()` would infer `| undefined` and fail the z.ZodType<Provenance> annotation.
export const provenanceSchema: z.ZodType<Provenance> = z.object({
  providerId: providerIdSchema,
  sourceKind: sourceKindSchema,
  fetchedAt: isoDateTimeSchema,
  providerObservedAt: isoDateTimeSchema.exactOptional(),
  maxAgeHours: z.union([z.number().int().min(0), z.literal('unknown')]),
  fx: fxInfoSchema,
  pointOfSale: pointOfSaleSchema,
  cabin: cabinSchema,
});
```

`src/ports/provider.ts`: the spec §5.1 block (revision 10: `tileIndex` on `reserve`/`recordCacheHit`, the `month` tile kind, `pointOfSale` on results, optional `routeHistory`) with `CellKey` imported from `types/definition.ts` and `ProviderId` from `types/provenance.ts`, and `import type` lines for `Iata`, `IsoDate`, `IsoMonth`, `IsoDateTime`, `Cabin`, `SuppliedField`, `BaggageSnapshot`, `FareConditions`, `BudgetScope`, `Usage`, `AlertDigest`, `OperatorMessage`, and the three error classes re-exported from `../errors.js` (the spec declares them in the same block; they live in `errors.ts` so `providers` can import them without the port types).

`src/ports/budget.ts`, `ports/cache.ts`, `ports/notifier.ts`, `ports/logger.ts`: exactly the contract blocks above ("Budget port", "Notifier port", "Alert types"); the contract text is the source, this task adds nothing to it.

`src/types/definition.ts`, `types/execution.ts`, `types/itinerary.ts`, `types/alerts.ts`: the contract blocks above, each with a doc comment naming its spec section. `cellKeyString` joins the four keys with `|`; `parseCellKeyString` splits and validates with the id schemas (a test covers both directions and a malformed string).

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
  it('APP_BASE_URL must be https and fixture cost is only read outside production', () => {
    expect(errors({ ...minimal, APP_BASE_URL: 'http://x' })).toContain('APP_BASE_URL');
    expect(ok({ ...minimal, APP_BASE_URL: 'https://gmt.example' }).appBaseUrl).toBe('https://gmt.example');
    expect(ok(minimal).providers.fixture).toBeNull();
    expect(ok({ ...minimal, NODE_ENV: 'test', DATABASE_PATH: ':memory:', IN_CONTAINER: undefined, FIXTURE_COST_MICRO_GBP: '3200' }).providers.fixture).toEqual({ costMicroGbp: 3200 });
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

Run: `pnpm --filter @gmt/core exec vitest run test/config`
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
  PORT: int(1, 65535), BIND_ADDRESS: str, ALLOWED_HOSTS: str, APP_BASE_URL: str.pipe(z.string().url().startsWith('https://').optional()),
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
  IN_CONTAINER: str, ALLOW_FIXTURE_PROVIDER: str, FIXTURE_COST_MICRO_GBP: int(0),
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
    providers: { travelpayouts, searchapi, fixture: e.FIXTURE_COST_MICRO_GBP === undefined && e.ALLOW_FIXTURE_PROVIDER === undefined && e.NODE_ENV !== 'test' ? null : { costMicroGbp: e.FIXTURE_COST_MICRO_GBP ?? 0 } },
    smtp, inContainer, allowFixtureProvider: e.ALLOW_FIXTURE_PROVIDER ?? null, appBaseUrl: e.APP_BASE_URL ?? null,
  };
  return { ok: true, config };
}
```

`buildSearchApi` applies the preset for `SEARCHAPI_PLAN ?? 'trial'` then each `SEARCHAPI_*` override; `buildSmtp` enforces all-or-nothing over the seven variables and the `none` rule (`LOOPBACK.test(host)`, or host `mailpit` under `NODE_ENV=development`). Both push to `errors` with the variable name as `field`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/config`
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
    expect(findBannedWords('she lives in Leeds; live now', ['lives in'])).toEqual([{ word: 'live', index: 20 }]);
  });
  it('finds multi-word phrases', () => {
    expect(findBannedWords('searches ALL combinations')).toEqual([{ word: 'all combinations', index: 9 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/core exec vitest run test/text/bannedWords.test.ts` → FAIL, module not found.

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

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/core exec vitest run test/text/bannedWords.test.ts` → PASS.

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
    // maxAgeHours 0 (SearchApi itinerary search): no bound clause, matching the spec §8.3 subject
    expect(formatAgeFull({ kind: 'bounded', fetchedHours: 5, maxAgeHours: 0 })).toBe('fetched 5h ago');
    expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 5, maxAgeHours: 0 })).toBe('5h ago');
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
    // why: maxAgeHours 0 is an interactive search at request time; there is no bound to show.
    case 'bounded': return a.maxAgeHours === 0 ? fetched : `${fetched} · provider age unknown (≤${formatDuration(a.maxAgeHours)} before that)`;
    case 'unknown': return `${fetched} · provider age unknown`;
  }
}

export function formatAgeCompact(a: EffectiveAge): string {
  const fetched = ago(a.fetchedHours);
  switch (a.kind) {
    case 'observed': return `${fetched} · obs ${formatDuration(a.observedHours)}`;
    case 'bounded': return a.maxAgeHours === 0 ? fetched : `${fetched} · ≤${formatDuration(a.maxAgeHours)}`;
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
- Create: `packages/core/src/api-contract/{common,airports,definitions,executions,results,alerts,system,index}.ts`
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
    expect(ROUTES.every((r) => r.path.startsWith('/api/'))).toBe(true); // spec §10 rev 10: the SPA owns '/'
    const paths = ROUTES.map((r) => `${r.method} ${r.path.replace(/^\/api/, '')}`);
    for (const p of [
      'GET /health', 'GET /providers', 'GET /airports', 'POST /definitions/estimate', 'GET /definitions', 'POST /definitions', 'GET /definitions/:id', 'PUT /definitions/:id', 'DELETE /definitions/:id',
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

`airports.ts`, `executions.ts`, `results.ts`, `alerts.ts`, `system.ts`: the shapes from the contract block (every field listed there), each typed with the schemas from `common.ts` and `types/`.

`index.ts`:

```ts
export * from './common.js'; export * from './definitions.js'; export * from './executions.js'; export * from './results.js'; export * from './alerts.js'; export * from './system.js';
import type { z } from 'zod';
// ... imports of each schema

export interface RouteDef { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string /* starts with /api/ */; request?: z.ZodTypeAny; query?: z.ZodTypeAny; params?: z.ZodTypeAny; response: z.ZodTypeAny; auth: 'public' | 'required' }
/** One entry per spec §10 row; api mounts these, web derives its client from them. */
export const ROUTES: readonly RouteDef[] = [
  { method: 'GET', path: '/api/health', response: healthResponseSchema, auth: 'public' },
  { method: 'GET', path: '/api/airports', query: z.object({ q: z.string().min(1).max(40) }), response: airportsResponseSchema, auth: 'required' },
  { method: 'GET', path: '/api/providers', response: providersResponseSchema, auth: 'required' },
  { method: 'GET', path: '/api/definitions', response: z.array(definitionResponseSchema), auth: 'required' },
  { method: 'POST', path: '/api/definitions', request: definitionCreateRequestSchema.optional(), response: definitionResponseSchema, auth: 'required' },
  { method: 'POST', path: '/api/definitions/estimate', request: definitionCreateRequestSchema, response: estimateSchema, auth: 'required' },
  // … every remaining row of spec §10 in the same form
];
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/core exec vitest run test/api-contract/contract.test.ts` → PASS; typecheck clean.

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
export * from './types/alerts.js';
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
  "testRunner": "command",
  "commandRunner": { "command": "pnpm exec vitest run --coverage.enabled=false" },
  "mutate": ["src/config/synthetic.ts", "src/labels/age.ts", "src/normalise/hashing.ts", "src/normalise/carrier.ts", "src/normalise/money.ts", "src/normalise/vendorUrl.ts", "src/constraints/*.ts", "src/selection/select.ts", "src/coverage/rollUp.ts", "src/alerts/dedup.ts"],
  "thresholds": { "high": 90, "low": 80, "break": 80 },
  "ignorePatterns": ["dist", "/coverage"]
}
```

`// why:` the command runner, not `@stryker-mutator/vitest-runner`: two brief dry-runs found the vitest runner executes zero tests per mutant under Vitest 5, which makes every mutant survive. `"/coverage"` rather than `"coverage"` so `src/coverage/` is mutated.


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
  /** Same, with BEGIN IMMEDIATE: the write lock is taken before `fn` runs (BudgetGuard.reserve, AppLock). */
  immediateTransaction<T>(fn: () => T extends Promise<unknown> ? never : T): T;
  close(): void;
}

export function openDatabase(path: string): Db {
  const raw = new Database(path);
  // why: WAL lets the SPA read while the engine writes; a memory db has no journal file.
  if (path !== ':memory:') raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('foreign_keys = ON');
  const orm = drizzle(raw);
  const guarded = <T>(fn: () => T) =>
    raw.transaction(() => {
      const result = fn();
      if (result instanceof Promise) throw new TypeError('transaction callbacks must be synchronous');
      return result;
    });
  return {
    raw,
    drizzle: orm,
    transaction: (fn) => guarded(fn)(),
    immediateTransaction: (fn) => guarded(fn).immediate(),
    close: () => {
      if (path !== ':memory:') raw.pragma('wal_checkpoint(TRUNCATE)');
      raw.close();
    },
  };
}
```

```ts
// src/migrate.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

/** Drizzle's journal lists every migration tag; `__drizzle_migrations` records the applied ones by hash. */
export function pendingMigrations(db: Db, migrationsDir: string): string[] {
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string; when: number }> };
  const hasTable = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!hasTable) return journal.entries.map((e) => e.tag);
  const last = db.raw.prepare('SELECT MAX(created_at) AS at FROM __drizzle_migrations').get() as { at: number | null };
  // why: drizzle applies migrations in journal order and stores the folder timestamp as created_at,
  // so everything with a later `when` is pending.
  return journal.entries.filter((e) => last.at === null || e.when > last.at).map((e) => e.tag);
}

/** Applies the committed Drizzle SQL migrations idempotently. Spec §7 "Migrations". */
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] } {
  const pending = pendingMigrations(db, migrationsDir);
  try {
    migrate(db.drizzle, { migrationsFolder: migrationsDir });
  } catch (err) {
    throw new Error(`migration failed in ${migrationsDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { applied: pending };
}
```

Add to `test/client.test.ts`: with an empty `drizzle/` journal (`{ "entries": [] }` written to a temp dir) `pendingMigrations` returns `[]` and `applyMigrations` returns `{ applied: [] }`; WP3 extends this once the first migration exists.

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
    const envReaders = ['/bootstrap/']; // WP4b: wiring and logger take the env as an argument
    if (name === '@gmt/api' && !envReaders.some((p) => f.includes(p)) && /process\.env/.test(src)) { console.error(`${f} reads process.env outside apps/api/src/bootstrap/`); bad++; }
    if (name === '@gmt/providers' && !f.includes('/src/testing/') && /from ['"]msw/.test(src)) { console.error(`${f} imports msw outside src/testing/`); bad++; }
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

Produces (from `@gmt/core`): `toEpochDay(IsoDate): number`, `fromEpochDay(number): IsoDate`, `addDays(IsoDate, n): IsoDate`, `daysBetween(a, b): number`, `monthOf(IsoDate): IsoMonth`, `monthsSpanned(from, to): IsoMonth[]`; `resolveWindow`, `generateCells`, `countCells`, `validateSearchSpace(def, todayLondon, lookup: { exists(iata): boolean; metroOf(iata): string | null; airportsOfMetro(code): Iata[] }, maxCells): ValidationResult` where `ValidationResult = { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] } | { ok: false; errors: Array<{ field: string; message: string }> }` (review focus 1: a code that `airportsOfMetro` recognises is rejected with the message "LON is a city code; use one of LHR, LGW, …"); `rollUp(outcomes: CellOutcome[]): RollUp`, `mergeWithinProvider(a, b)`, `sixBuckets(outcomes): Buckets`, `selectedNotReached(cells, outcomes)`; `selectCandidates(policy, cells, discovery: Map<string, RollUp>, hasDiscoveryProvider): Array<{ cell: CellKey; reason: SelectionReason }>`. (`cellKeyString` is WP0's, in `types/definition.ts`.)

## WP2 — `core`: normalisation, hashing, constraints, results, money, alerts (Sonnet)

Brief: `docs/briefs/wp02-core-normalise-constraints-alerts.md`. Depends on WP0. Spec §5.6 (pure parts), §6.2, §6.3, §6.4, §6.5, §6.8, §6.9, §9 item 1. First failing test: `VS 938` ≡ `VS938` hash.

Produces: `canonicalCarrier(s): string` (throws `NormalisationError('unmappable-carrier')`), `canonicalFlightNumber(s): number`, `departLocal(instantOrLocal, timeKind, tz): string` (`YYYY-MM-DDTHH:mm`; DST rules), `itineraryHash(outbound, inbound): string`, `toGbp(amountMinor, currency, rateNano): number` with `MINOR_EXPONENT: Record<string, number>` and `ECB_CURRENCIES`, `toIsoDateTime(vendorString, timeKind, tz): IsoDateTime`, `validateVendorUrl(url, allowlist): Booking`, `normaliseOffer(raw: RawOffer, deps: { tzOf(iata): string | null; rateFor(currency): { rateNano; rateDate; source } | null; cabin: Cabin }): { itinerary: NormalisedItinerary; offer; observationFields } | NormalisationError`, `evaluateConstraints`, `verdictClass`, `dedupByItinerary`, `rankRows`, `sortRows(rows, key, dir)`, `filterRows(rows, filters)`, `bandCheapest`, `evaluateAlertRules(rules, candidates, previous, now): Firing[]`, `dedupKey`, `isSuppressed`, `buildDigest(rule, firings): AlertDigest`, `searchLinkFor(providerId, cell, cabin): { url; host; label }`.

## WP3 — `db` (Opus)

Brief: `docs/briefs/wp03-db.md`. Depends on WP0, WP1 (its write transactions call core's `rollUp` and `mergeWithinProvider`). Spec §7 entire, §5.3 cap predicates, §9 item 3. First failing test: 1,000 ledger rows × 3200 micro-GBP trip a 300p cap in SQL. Produces every class in the "Database" contract block, the first Drizzle migration, the vendored airports dataset, `seedAirports`, `sanityCheckAirports`, `runMaintenance`.

## WP4 — `providers`: http-kit, recorder, scrubbing, egress, fixture provider (Opus)

Brief: `docs/briefs/wp04-http-kit-and-fixture-provider.md`. Depends on WP0. Spec §5.3, §5.5, §9 item 2 (http-kit and fixture rows). First failing test: reserve happens before fetch on every attempt. Produces the "http-kit" contract block.

## WP4b — Fixture recording and wiring helper (Fable)

Brief: `docs/briefs/wp04b-recording-and-wiring.md`. Depends on WP3, WP4. Records the public example route (LHR/LGW → JFK/EWR) through the real recorder with ~12 of the 91 remaining trial credits, writes the dated parameter allowlists, builds `apps/api/src/wiring.ts` and the tool bootstrap. First failing test: a recorded fixture carries a verifiable content hash.

## WP5 — SearchApi adapter (Opus)

Brief: `docs/briefs/wp05-searchapi-adapter.md`. Depends on WP1, WP2, WP4, WP4b. Spec §2 (SearchApi rows and facts 2–5, 8), §5.2, §5.4, §9 item 2. First failing test: tiles partition the band.

## WP6 — Travelpayouts adapter (Sonnet)

Brief: `docs/briefs/wp06-travelpayouts-adapter.md`. Depends on WP1, WP2, WP4, WP4b. Spec §2 (Travelpayouts row and fact 1), §5.2, §9 item 2. First failing test: empty envelope → `no_data`.

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

Brief: `docs/briefs/wp12-docker-docs.md`. Depends on WP8, WP9. Spec §12 (`.env.example` final), §13, §9 item 8. First failing test: the Dockerfile sets production and the container flag.

## WP13 — Live smoke, layer-B engine tests, lock test, integration review (Fable)

Brief: `docs/briefs/wp13-smoke-and-final-pass.md`. Depends on all. Spec §9 items 4 (layer B) and 7, §7 `app_lock`. First failing test: the live smoke exits 0 with provenance.

---

## Self-review record (2026-10-14)

1. **Spec coverage.** §1 → WP9 (empty state, coverage check), WP8 (`POST /definitions` default for the plan); §2 → WP5, WP6, docs in WP12; the Phase 4 Camoufox fallback has no task by design (spec: not built); §3 → WP0 types, WP1 buckets, WP0 labels; §4 → WP0 scaffold and boundary guard, WP8 auth; §5.1 → WP0; §5.2 → WP5/WP6; §5.3 → WP4; §5.4 → WP5; §5.5 → WP0 gate, WP4 fixture provider, WP8 boot matrix, WP12 Dockerfile; §5.6 → WP2 pure parts, WP7 step; §6 → WP1/WP2; §7 → WP3 (+ WP0 client); §8 → WP7 (+ WP11 notifications); §9 → thresholds WP0, each item in its WP, item 7 split (`record:fixtures` in WP4b, `smoke:live` in WP13); §10 → WP0 contract, WP8 routes; §11 → WP9/WP10/WP11; §12 → WP0 schema, WP12 docs; §13 → WP12; §14 → WP8 (pino setup in bootstrap) and WP4 (scrubbing). No gap found.
2. **Placeholder scan.** No TBD/TODO. Two code blocks in Task 0.5 and Task 0.8 describe helper functions (`buildSearchApi`, `buildSmtp`, the remaining schema files) in prose with their rules stated; they are bounded by the tests above them, which is the acceptance criterion.
3. **Type consistency.** `Buckets` is defined once in `api-contract/common.ts` as `bucketsSchema` and re-used by `CellsRepo.buckets` and `sixBuckets`; `RollUp.status` null ↔ API `not_applicable` is stated in the execution types block; `Booking.host` is required on `get`/`post` in both `types/itinerary.ts` and `bookingSchema`; `PlanId` has two members everywhere; `Estimate` is `estimateResponseSchema`'s type.
4. **Review focus.** All five lines have an owning task: 1 → WP1 validation + WP9 form; 2 → Task 0.7 (test present) + WP2 ordering; 3 → WP10; 4 → WP7 + WP8; 5 → WP3 + WP7. Each brief carries its pinned test.
