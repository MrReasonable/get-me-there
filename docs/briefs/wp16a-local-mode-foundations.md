---
wp: 16a
title: Local-mode foundations (catch-up, active run, moved marker, shared camoufox pieces)
owner: opus
depends_on: [15]
spec_sections: ["§2 Method (FLAGS)", "§2 Caps across callers", "§3 skipped reasons", "§6.6 row 6", "§7 search_executions", "§7 cell_outcomes", "§7 Budget windows", "§8.1 Operator notifications", "§8.2 Scheduler", "§9 mutation", "§10 GET /executions/active", "§10 GET /tools/smoke/plan", "§12 configuration block (CAMOUFOX_BROWSER_WINDOW)", "§12 Where settings live", "§13 One app per ledger", "§16", "§17 revision 36"]
reviewers: [search-strategy-reviewer, data-model-reviewer, cost-and-budget-reviewer, code-architect, test-strategy-reviewer, provenance-auditor]
mutate: {"@gmt/core": ["src/camoufox/builds.ts", "src/camoufox/protocol.ts", "src/camoufox/settings.ts", "src/camoufox/start.ts", "src/budget/window.ts", "src/local/movedMarker.ts", "src/local/paths.ts", "src/labels/skip.ts"], "@gmt/engine": ["src/scheduler/catchUp.ts", "src/scheduler/parseCron.ts", "src/scheduler/catchUpStart.ts", "src/scheduler/browserWindow.ts", "src/scheduler/heartbeat.ts", "src/tick.ts", "src/stages/browserGate.ts"]}
pending: {}
status: merged
---

# WP16a: Local-mode foundations

Written 2026-10-19 against spec revision 36 and plan decisions 1–83 after review round 2, which split the old WP16
(decision 81), and revised after review round 3. This package changes what the product does (when scheduled searches
run, which databases an app will open) and lays the `core` and `providers` pieces that WP16b, WP17 and WP18 all start
from, so it merges first and alone. It has no CLI code. Every finding of rounds 1 to 3 is answered in the review
directories' `resolutions.md`.

## 1. Goal

A missed scheduled firing, a late live tick included, is caught up at most once (never twice, never loading a browser
page, not when the next firing is near), an app refuses to open a database that moved to a native install, `GET
/api/executions/active` tells a client whether a run is in flight, `GET /api/tools/smoke/plan` states the smoke's worst
case, and `core` holds the camoufox build table, flags, start checks, shared settings with their effective values,
the billing-month window, the worker status fields and the refusal schema and texts the CLI, the worker and the status
report share.

## 2. Scope

**In**

- Migration 0007: `search_executions.scheduled_for` (nullable instant: the firing `croner` gives, UTC ISO text with
  milliseconds), `is_catch_up` (not null, default 0), `browser_window_end` (nullable; decision 83),
  `skip_code` (nullable; CHECK in `half-cadence`, `browser-only-definition`; only on a `skipped_missed` row), the firing
  unique index `(definition_id, scheduled_for) WHERE
  is_child = 0 AND scheduled_for IS NOT NULL`; the `cell_outcomes` table rebuilt so its skip-reason CHECK admits
  `scheduled_only`, with a nullable `skip_detail` (CHECK in `catch-up-no-browser`, `outside-browser-window`; set only
  with `scheduled_only`); the schema, the drizzle snapshot, and the repository's scheduled insert (`INSERT … ON
  CONFLICT(definition_id, scheduled_for) WHERE is_child = 0 AND scheduled_for IS NOT NULL DO NOTHING` inside the start's
  immediate transaction; `changes() = 0` returns `firing-taken`).
- `core`: `SkipReason` gains `scheduled_only`, `SKIP_RANK` places it after `provider_unavailable` and before `departed`
  (spec §6.6 row 6); `SKIP_DETAIL_TEXT` and `SKIP_CODE_TEXT` map the codes to fixed text ("a catch-up loads no browser
  pages", "outside this run's browser window", "the next scheduled run was less than half the gap away", "only the
  browser provider could run it, and a catch-up loads no browser pages"), and `scheduledOnlyText(detail, leftFor)`
  puts who fetches the cell before the reason (`leftForOf`: "left for the next scheduled run" only when the definition
  is scheduled and enabled and its scheduled runs still use the browser provider, "left for your next run of this
  search" when only a run by hand would, else "not fetched: this search no longer uses the browser provider"; the
  engine's `browserLeftFor` answers it at read time and the api returns it), with exhaustive and banned-word tests;
  View D, the cell panel and the window notice render a `scheduled_only` cell through it, the panel only for the latest
  parent run's outcomes (an earlier run's reads "left by that run: <why>", `scheduledOnlyPastText`); the window notice
  says the other providers carry on only when one still searches in the run; View D's header names a skipped firing's
  time and reason through the header's one formatter, as History does; no resume path (manual, automatic, boot)
  selects it, and View D offers no Retry on a browser error a resume would only leave.
- `findMissedFiring` in `engine` (replacing `detectMissed`), used by the boot, by a new minute system job and by a late
  live tick; the live tick computes `firing = previousFiring(expr, tz, now + 2 s)` (the second before a firing counts as
  that firing), writes it as `scheduled_for`, and over the 2-minute grace (one predicate, `pastGrace`, on both sides)
  runs the same tick order (stale supersede, resume without re-anchoring, "blocked since") and defers to the catch-up in
  place of the start; a paused catch-up at a firing is superseded by that firing's row, whatever it is (its start, its
  catch-up or its skip), in the same immediate transaction as its insert; a catch-up in flight at a firing covers it as
  any run does, one paused there (`paused_at` at or before it) never does, and an automatic resume of a paused catch-up
  yields to a firing since it paused (`autoResumeYields`); the minute job and the boot isolate each definition; the engine's shutdown refuses new work, stops
  every run taking new provider work, waits (bounded by the notice's SMTP timeouts) for running scheduler callbacks,
  then hands the database back, a late callback writing nothing; a `skipped_missed` row stores its `skip_code`; decision 79's rules, including the cadence (next firing minus the missed one), the
  coverage judged against the catch-up's provider set, and the catch-up's `camoufox` cells (reuse only, the rest
  `skipped:scheduled_only`).
- The browser window (decision 83): the app-side setting `CAMOUFOX_BROWSER_WINDOW` (`scheduled` | `any`, default
  `scheduled`) in `core`'s config schema, its `.env.example` line and its entry in `docker-compose.yml`'s `environment`
  allowlist (compose passes only listed names); the stored window (`browser_window_end`)
  written at start from the later of the firing and the start, and reset only by a punctual live-tick resume
  (re-anchored in memory before its check; `scheduled_for` and the end written by one guarded statement inside the
  claim, which carries on under the old window when the firing is taken, so a refused resume moves neither); the
  window checked only before a run's first `camoufox` page, at any resume, and before the next page after a detected
  suspension, the page checks running when the limiter admits the page (`ProviderContext.beforeSend`) (the heartbeat in
  the engine's scheduler module: every 30 s, `unref`'d, a beat more than 120 s late records `suspendedAt` and
  `resumedAt`, logs one line and marks executions in flight; before each page start a last beat older than 120 s
  counts too), never mid-run;
  `browserWindow(execution, setting, now)` in `engine/src/scheduler/browserWindow.ts`, reading the setting live and only
  the stored columns, checked in the resume pass before `estimateRemainingFor` and by the orchestrator at a run's first
  `camoufox` page and before the next page after a detected suspension; under `scheduled`, outside the window the provider's remaining cells become
  `skipped:scheduled_only` (`outside-browser-window`) with one notice per execution, of its own kind `browser_window`
  (migration 0007's kind CHECK); a window-cut pass is no parity break; the gate refuses a catch-up outright; under
  `any`, a resumed run keeps
  loading pages within every cap, spacing and cool-down. Not a shared worker setting.
- `GET /api/executions/active` (the oldest pass in flight, a run or a single-cell verification, with now plus its
  remaining estimate) and `GET /api/tools/smoke/plan`, with their contracts; execution summaries carry `scheduledFor`,
  `isCatchUp` and `skipCode`, and history points their run's catch-up label.
- The moved-database marker: its one format in `core` (`MOVED_MARKER`, `movedMarkerText`, `parseMovedMarker`: the
  first line is the move's ISO instant); the app and tool bootstraps refuse (exit 78) a database with `MOVED-TO-NATIVE`
  beside it, readable or not, before migrations, the boot sweep, auto-resume and cron.
- `core/camoufox/builds.ts`: `OsArch`, `camoufoxBuildSchema`, `CAMOUFOX_BUILDS` (WP17 §0's four rows), `bundleDirName`,
  `REDIRECT_HOSTS`, `VerifiedSet`, `FLAGS`, `flagsFor`.
- `core/camoufox/start.ts`: `START_REFUSAL_REASONS`, `startRefusalSchema`, `START_REFUSAL_TEXT`, `StartFacts` and
  `startChecks` (so builds.ts and protocol.ts import neither each other nor it).
- `core/camoufox/settings.ts`: `SHARED_WORKER_SETTINGS` (with the two monthly caps and `CAMOUFOX_BILLING_DAY`),
  `SHARED_WORKER_DEFAULTS`, the one rule set (`readSharedSettings`, `sharedSettingMessage`, `sharedInt`,
  `sharedMode`), `parseSharedSettings`, `effectiveSharedSettings`, `sharedSettingDiffs`; the app's config and the
  worker derive every typed shared field from it.
- `core/local/paths.ts`: `workerDataDir`, the native install's path rules (WP17's install paths join it there).
- `core/camoufox/protocol.ts`: the wire schemas, `APP_INSTANCE_HEADER`, and every `workerStatusSchema` field WP17's worker will
  fill (`osArch`, `build`, `consent`, `monthly`, `appInstances`) plus `sharedSettings`, all `exactOptional`, shape only.
  This is decision 76's compatibility rule: a status field enters the schema one package before any worker emits it.
- `core/budget/window.ts`: `billingMonthWindow(now, billingDay)`, the ledger's 00:00 UTC billing-day month as a pure
  function, which `db`'s `monthWindow` is tested to agree with and the worker's monthly counts use (WP17).
- `providers`: `readWorkerStatus` split out of `camoufoxPreflight` (an options object; a refusal keeps the classifier's
  kind, so a 403 is a refused key too); the preflight compares effective values through `sharedSettingDiffs`.
- The worker: `loadWorkerConfig` reads and validates `CAMOUFOX_MONTHLY_PAGE_CAP`, `CAMOUFOX_MONTHLY_SCROLL_CAP` and
  `CAMOUFOX_BILLING_DAY` with the app's defaults (WP17 enforces the caps; this package only reads and reports them);
  `/v1/status` reports `sharedSettings`; the selectors module reads its flags through `core` (`flagsFor('darwin-arm64',
  …)` on the operator's Mac; values unchanged); the `/v1/status` handler stays clear of the pacer (test); `paths.ts`'s
  default data directory equals `core`'s `workerDataDir` (test).
- Mutation wiring: this brief's front-matter `mutate` field is its scope (`core`: the camoufox builds, wire contract,
  shared settings and start checks, the billing window, the moved-marker format and the skip labels; `engine`: the
  catch-up decision and its start side, the firing count that sizes schedules (`parseCron.ts`), the browser window, the
  heartbeat, the tick and the browser gate), and each file is in its package's Stryker `mutate` list; a new
  `packages/engine/stryker.config.json` runs the scheduler suites (`test/scheduler`, a directory, never a hand list of
  files) and `test/parse-cron.test.ts`, whose seeded comparison checks the firing count against the stepped one; the root `mutate` script and
  `.github/workflows/mutation.yml` gain `@gmt/engine`; `scripts/check-mutation-globs.mjs` reads every brief's
  front-matter `mutate` and `pending` fields (docs/briefs/README.md) and fails when a brief has no `mutate` line
  (`mutate: {}` for none; every merged brief states its real scope, WP1, WP2, WP14 and WP15 included), when a `mutate`
  glob matches no file or a file it matches is in no Stryker `mutate` entry (minimatch, Stryker's own matcher), or when
  a brief whose `status` is `merged` still has `pending` entries; CRLF front matter reads as LF. WP16b, WP17 and WP18
  state their scopes as `pending` and move them to `mutate` before they merge.
- The web History label; spec §8.2 wording in `docs/scheduling.md`; `docs/api-limits.md`'s two-apps line.

**Out**

- The CLI, services, imports and CI matrix (WP16b); the Camoufox install, the worker's install directory, filling the
  new status fields, enforcing the monthly caps and consent (WP17); the status report (WP18).

## 3. Interfaces produced (WP16b, WP17 and WP18 code against these)

```ts
// packages/core/src/camoufox/builds.ts
export type OsArch = 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64';
export const camoufoxBuildSchema = z.strictObject({
  build: z.string().regex(/^\d+\.\d+\.\d+-[a-z]+\.\d+$/),
  url: z.string().startsWith('https://github.com/daijro/camoufox/releases/download/'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  unpackedBytes: z.number().int().positive(),
  hashedOn: isoDateSchema,
});
export const CAMOUFOX_BUILDS = { /* WP17 §0's four rows */ } as const satisfies Record<OsArch, z.input<typeof camoufoxBuildSchema>>;
export const bundleDirName = (b: CamoufoxBuild): string => `${b.build}-${b.sha256.slice(0, 8)}`;
export function versionOf(b: CamoufoxBuild): { version: string; release: string }; // split at the first '-'
export const REDIRECT_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'] as const;
export const FLAG_NAMES = ['FORM_VERIFIED', 'RESULTS_VERIFIED', 'CHEAPEST_FLOW_VERIFIED', 'NO_FLIGHTS_VERIFIED',
  'GRID_VERIFIED', 'LANDING_VERIFIED' /* … every existing flag, listed exhaustively */] as const;
export interface VerifiedSet { build: string; flags: Readonly<Record<FlagName, boolean>> }
export const FLAGS: Readonly<Record<OsArch, VerifiedSet>>;
export function flagsFor(osArch: OsArch, runningBuild: string): Readonly<Record<FlagName, boolean>>; // all false on a mismatch

// packages/core/src/camoufox/start.ts (START_REFUSAL_REASONS, startRefusalSchema and START_REFUSAL_TEXT below too)
export type StartConsent = { kind: 'voided' } | { kind: 'socs' | 'not-shown'; expiresAt: IsoDateTime }; // voided: no expiry
export interface StartFacts { osArch: OsArch | null; installedBuild: string | null; layoutOk: boolean;
  consent: StartConsent | null; signedIn: boolean; locked: boolean; now: IsoDateTime }
export function startChecks(f: StartFacts): StartRefusalReason | null; // pure; the worker's own start uses it too

// packages/core/src/camoufox/settings.ts; protocol.ts keeps the wire schemas; local/paths.ts holds workerDataDir
export const SHARED_WORKER_SETTINGS = ['CAMOUFOX_COOLDOWN_HOURS', 'CAMOUFOX_PAGE_TIMEOUT_SECONDS', 'CAMOUFOX_MODE',
  'CAMOUFOX_GRID_SCROLL_CAP', 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', 'CAMOUFOX_MONTHLY_PAGE_CAP',
  'CAMOUFOX_MONTHLY_SCROLL_CAP', 'CAMOUFOX_BILLING_DAY', 'POINT_OF_SALE'] as const;
export type SharedWorkerSetting = (typeof SHARED_WORKER_SETTINGS)[number];
export const GRID_ONLY_SETTINGS = ['CAMOUFOX_GRID_SCROLL_CAP', 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS'] as const;
export const SHARED_WORKER_DEFAULTS: Readonly<Record<SharedWorkerSetting, string>>; // the app's defaults (spec §12)
export type SharedSettings = Readonly<Record<SharedWorkerSetting, string>>;
// The one rule set: bounds, defaults and refusal words per name (CAMOUFOX_COOLDOWN_HOURS 24–100000 on both sides).
// readSharedSettings lists every invalid name and holds its default; the app's config, loadWorkerConfig and the CLI's
// reader read the nine names only through it and derive their typed fields (sharedInt, sharedMode) from its record.
export function readSharedSettings(raw: Readonly<Record<string, string | undefined>>):
  { settings: SharedSettings; invalid: readonly SharedWorkerSetting[] };
// Effective values: the default applied to an absent or empty line, integers as decimal strings; throws naming the
// setting (never its value) on an invalid one.
export function effectiveSharedSettings(raw: Readonly<Record<string, string | undefined>>): SharedSettings;
export function sharedSettingDiffs(app: SharedSettings, worker: SharedSettings, mode: 'list' | 'grid'):
  readonly SharedWorkerSetting[]; // names only; GRID_ONLY_SETTINGS compared only when mode is 'grid'
export const START_REFUSAL_REASONS = ['flags-unset', 'consent-missing', 'consent-expired', 'consent-voided',
  'build-mismatch', 'layout', 'signed-in', 'locked'] as const;
export const startRefusalSchema = z.strictObject({ reason: z.enum(START_REFUSAL_REASONS), at: isoDateTimeSchema });
// The one map from reason to text: WP16b's local status, WP17's start and update, and WP18's builder all read it.
export const START_REFUSAL_TEXT: Readonly<Record<StartRefusalReason, { summary: string; fixCommand: `pnpm gmt ${string}` | null }>>;
export const workerDataDir = (home: string): string => `${home}/.local/state/get-me-there/camoufox`;
export const APP_INSTANCE_HEADER = 'x-gmt-app-instance';
// workerStatusSchema keeps z.strictObject and its existing fields, and gains, all .exactOptional():
//   sharedSettings: z.record(z.enum(SHARED_WORKER_SETTINGS), z.string())   (every name present; WP16a's worker fills it)
//   osArch: z.enum(OS_ARCHES)                                              (WP17 fills the rest)
//   build: z.string()
//   consent: z.strictObject({ kind: z.enum(['socs', 'not-shown', 'voided']), expiresAt: isoDateTimeSchema.nullable(),
//                             boundedBy: z.enum(['cookie', 'capture', 'check']).nullable() })  // null for voided
//   monthly: z.strictObject({ windowStart: isoDateTimeSchema, windowEnd: isoDateTimeSchema, pages: int ≥ 0,
//                             scrolls: int ≥ 0, readable: z.boolean() })   // readable false: the counts file refused
//   appInstances: z.strictObject({ windowStart: isoDateTimeSchema, count: int ≥ 0 })

// packages/core/src/budget/window.ts
export function billingMonthWindow(now: IsoDateTime, billingDay: number): { windowStart: IsoDateTime; windowEnd: IsoDateTime };

// packages/providers/src/camoufox/preflight.ts
export function readWorkerStatus(o: { http: HttpKit; key: Secret; url: string; signal: AbortSignal; appInstance?: string }):
  Promise<WorkerStatusRead>;
// { kind: 'ok'; status } | { kind: 'unreachable' } | { kind: 'refused'; errorKind; httpStatus: number | null } | { kind: 'unreadable' }
// (errorKind is the classifier's: 'auth' for a 401 or 403, the refused key)

// core api-contract: GET /api/executions/active
export const activeExecutionResponseSchema = z.strictObject({
  execution: z.strictObject({ id: z.string(), definitionId: z.string(), definitionName: z.string(),
    kind: z.enum(['run', 'cell-verification']), startedAt: isoDateTimeSchema,
    estimatedFinishAt: isoDateTimeSchema.nullable() /* now + the remaining cells' estimated seconds */ }).nullable(),
});
// core api-contract: GET /api/tools/smoke/plan (ledgers nothing)
export const smokePlanResponseSchema = z.strictObject({
  searchApi: z.strictObject({ calendar: z.number().int(), itinerary: z.number().int(), trialLeft: z.number().int().nullable() }).nullable(),
  travelpayouts: z.strictObject({ freeCalls: z.number().int() }).nullable(),
  // scrolls 0 in list mode; pageBoundSeconds: the request timeout the smoke's http-kit gives the page (spec §10, §13)
  camoufox: z.strictObject({ pages: z.number().int(), scrolls: z.number().int(), pageBoundSeconds: z.number().int().min(1) }).nullable(),
});

// engine
export function findMissedFiring(ctx: EngineContext, def: SearchDefinition, now: IsoDateTime):
  | { kind: 'none' }
  | { kind: 'catch-up'; firing: IsoDateTime }
  | { kind: 'skip'; firing: IsoDateTime; reason: 'half-cadence' | 'scheduled-only' };
// the start's result gains { kind: 'firing-taken' } beside the existing 'active' and refusal results
```

`core` imports no `node:` module, so `workerDataDir` joins with `/` (POSIX only until the Windows package, which
adds its own rule); its doc comment says so.

`START_REFUSAL_TEXT`'s fix commands: `consent-missing`, `consent-expired`, `consent-voided` and `signed-in` give `pnpm
gmt consent` (a new throwaway profile); `layout` gives `pnpm gmt setup --reconfigure browser`; `locked` gives `pnpm gmt
restart`; `flags-unset` and `build-mismatch` give null (WP18 shows them as `off`, awaiting verification). Each summary is
a short fixed sentence (for example `consent-voided`: "consent screen now shown: capture again").

## 4. Files

Create: `packages/db/drizzle/0007_catch_up.sql` (+ meta), `packages/engine/src/scheduler/catchUp.ts`,
`packages/engine/src/scheduler/browserWindow.ts`, `packages/engine/src/scheduler/heartbeat.ts`,
`packages/engine/stryker.config.json`, `packages/core/src/camoufox/builds.ts`, `packages/core/src/budget/window.ts`,
`packages/core/src/api-contract/tools.ts` (or the existing tools contract file), `scripts/check-mutation-globs.mjs`,
tests beside each.
Modify: `packages/db/src/schema/{searchExecutions,cellOutcomes}.ts` and their repositories, `packages/db/src/budget/
window.ts` (its agreement test), `packages/core/src/types/execution.ts` (`SkipReason`), `packages/core/src/coverage/
rollUp.ts` (`SKIP_RANK`), `packages/core/stryker.config.json`, `packages/engine/src/{boot,start,tick,run}.ts`, its
snapshot and discovery seeding, and the system jobs, `packages/core/src/camoufox/protocol.ts`,
`packages/core/src/config/` (`CAMOUFOX_BROWSER_WINDOW`), `.env.example`, `docker-compose.yml` (its `environment`
allowlist), `packages/core/src/api-contract/executions.ts`, `packages/providers/src/camoufox/{preflight,provider}.ts`,
`apps/camoufox-worker/src/{config,paths,selectors,server,status}.ts`, `apps/api/src/bootstrap/{app,tool,preflight}.ts`,
`apps/api/src/config` (shared settings through `effectiveSharedSettings`), `apps/api/src/routes/{executions,tools}.ts`,
`apps/web` History, root `package.json` (`mutate`), `.github/workflows/mutation.yml`, `docs/scheduling.md`,
`docs/api-limits.md`, the docs tests.

## 5. Tasks

### Task 16a.1: Migration 0007, the skip reason and the firing unique index (first failing test)

- [ ] **Failing tests:**
  - **First failing test (§16):** with the coverage read stubbed to "uncovered", a late live tick and the minute job
    both reach the insert with the same `scheduled_for`: one execution; the loser returns `firing-taken` and creates
    zero cells, sends zero notices, calls no provider (a provider spy) and writes zero ledger rows.
  - Repository: a raw second `INSERT` for the same `(definition_id, scheduled_for)` on a parent fails with the unique
    constraint; two rows with null `scheduled_for` both insert; the same instant on another definition inserts; a child
    execution never carries `scheduled_for` and never collides; the scheduled insert's `firing-taken` path seeds
    nothing; an active-parent clash on a scheduled insert still returns `active` (it is not swallowed), and a CHECK or
    NOT NULL failure still throws.
  - A `skipped_*` row for a firing carries `scheduled_for`, so a second skip or start for it returns `firing-taken`.
  - The migration applied to a populated 0006 database keeps every row (executions and cell outcomes counted), leaves
    old rows with `scheduled_for` null and `is_catch_up` 0, and `sqlite_master` holds the firing index with its `WHERE`
    clause; the drizzle snapshot matches.
  - `cell_outcomes`' CHECK accepts `skipped:scheduled_only` and still refuses an unknown reason; `skip_detail` accepts
    its two codes only with `scheduled_only`, and `skip_code` its two codes only on `skipped_missed`; `rollUp` ranks it
    per spec §6.6 row 6 (`SKIP_RANK` exhaustive test); View D shows each detail's text.
  - The migration leaves old rows with `browser_window_end`, `skip_code` and `skip_detail`
    null.
- [ ] **Implement; commit `wp16a: scheduled_for, scheduled_only and the firing index`.**

### Task 16a.2: `findMissedFiring`, the live tick, the boot and the minute job

- [ ] **First step:** record the firings `croner` 10.0.1 gives, as UTC instants, for daily `30 1 * * *`, `30 0 * * *`
  and `30 2 * * *` in `Europe/London` on 2027-03-28 and 2027-10-31, and for the irregular schedules below; they become
  the literals in the tests (no test computes its expected instant through `croner`).
- [ ] **Failing tests** (fake clock, literal UTC instants):
  - Asleep across one firing: one catch-up, `scheduled_for` the firing, `is_catch_up` 1.
  - Across three firings: one run, for the latest.
  - The late tick: schedule registered, system time jumped 6 h past a firing with no timer run, then timers advanced
    30 s with both the definition's job and the minute job registered: exactly one row, `is_catch_up` 1, its `camoufox`
    cells reused or `skipped:scheduled_only`; the weekly variant 6 of 7 days late gives exactly one `skipped_missed` row
    and no run. A punctual tick writes `scheduled_for` equal to `previousFiring(expr, tz, now + 2 s)` to the millisecond.
  - Cadence is next − missed: weekly missed 6 of 7 days ago: `skipped_missed` with `scheduled_for`, notified once, no
    run. Boundaries on a weekly schedule with literal instants: `(next − now)` one ms under `(next − firing) / 2` skips,
    exactly half catches up, one ms over catches up. `0 6 * * 1,4` (gaps of 72 h and 96 h): a Monday firing missed with
    36 h to Thursday catches up, with 35 h 59 m skips; a Thursday firing uses its 96 h gap. Monthly `0 6 1 * *` across a
    30- and a 31-day month. Daily `0 6 * * *` across both 2027 clock changes (the 23 h and 25 h gaps). Weekdays only
    `0 9 * * 1-5`: a Friday firing missed uses its 72 h gap to Monday.
  - A firing 2 minutes old or less: not missed (the grace).
  - A manual run started after the firing covers it; a run active at the firing covers it, a running catch-up included
    (hourly, overrunning the next firing: no second catch-up, no row, notice or call in the minutes after); a **paused
    catch-up** active at a firing does not, whichever of its one-shot and the minute job fires first on waking: that firing's tick supersedes it and starts the scheduled run with `scheduled_for` set
    (one row superseded, one new row). After sleep: a catch-up for F1 `paused_budget`, asleep across F2, the minute job
    on wake gives one superseded row and one new row with `scheduled_for` F2 and `is_catch_up` 1, and a second minute
    tick writes nothing.
  - The definition edited after the firing: none; another definition edited: still caught up (positive control).
  - No configured provider can run the definition on a schedule (none configured): no row, no run, no notice.
  - `camoufox` the only discovery provider, without and with SearchApi verification configured, minute job run 5
    times: one `skipped_missed` row with `scheduled_for` and `skip_code` `browser-only-definition`, one notice, no run,
    no ledger row; with SearchApi configured afterwards the row still reads `browser-only-definition`. The half-cadence
    skip stores `half-cadence`; each code round-trips and renders its text.
  - Boot then the minute job for one firing: one run (the shared function).
  - A cap-refused catch-up met twice: one `skipped_*` row, one notice; the confirmation and window refusals likewise
    each write one row carrying `scheduled_for`.
  - The catch-up keeps `camoufox` for reuse only: a fresh camoufox outcome inside the refresh window is copied with no
    page load; its other cells are `skipped:scheduled_only` with `skip_detail` `catch-up-no-browser`; Travelpayouts and SearchApi run. A manual resume of a
    paused catch-up, an automatic resume and a boot resume load no page (a worker stub failing the test on any
    request). The next scheduled run fetches those cells.
  - Positive control: a punctual live tick's run plans `camoufox` cells as `not_run` and fetches them.
  - DST: on 2027-03-28 and 2027-10-31, daily 01:30, 00:30 and 02:30 each give exactly the recorded candidates and at
    most one run, with `scheduled_for` the latest recorded instant; asleep from 2027-03-27T23:00:00.000Z to
    2027-03-28T09:00:00.000Z gives one run for the recorded 01:30 instant (and the same across 2027-10-31).
  - The minute job makes no network call (global `fetch` stubbed to fail the test) and starts nothing for a covered
    firing.
  - Boot no longer writes `skipped_missed` for a firing it catches up; old `skipped_missed` rows still read.
- [ ] **Implement; commit.**

### Task 16a.2b: The browser window (decision 83)

- [ ] **Failing tests, the setting:** `core`'s config schema accepts `CAMOUFOX_BROWSER_WINDOW=scheduled` and `any`,
  gives `scheduled` when the variable is unset or empty, and refuses any other value (`Any`, `always`, ` scheduled`)
  naming the field; it is not in `SHARED_WORKER_SETTINGS` (test). `.env.example` carries the line with its two values
  and default, and `docker-compose.yml`'s `environment` allowlist lists `CAMOUFOX_BROWSER_WINDOW:
  "${CAMOUFOX_BROWSER_WINDOW:-}"` (the existing compose-allowlist and env-example tests extended). The setting is read
  live: started under `scheduled` and resumed under `any` past the window, the run loads pages (cells already
  `scheduled_only` stay so); started under `any` and resumed under `scheduled` past the window, it loads none.
- [ ] **Failing tests, the stored window** (fake clock, literal UTC instants, a worker stub that fails the test on any
  request outside the window):
  - The start transaction writes `browser_window_end` = anchor (`scheduled_for`, or a manual run's `started_at`) + 1.5 × the start estimate's total
    seconds.
  - A resume pass that would add `camoufox` seconds to the stored estimate leaves `browser_window_end` unchanged and,
    past it, loads no page.
  - A pre-0007 scheduled row with an estimate, a null `scheduled_for` and a null end: its window ends at `started_at` +
    `STUCK_AFTER_HOURS` (and `created_at` + `STUCK_AFTER_HOURS` with no `started_at`).
  - Past the window, a resume writes the remaining `camoufox` cells `skipped:scheduled_only` (`skip_detail`
    `outside-browser-window`) before `estimateRemainingFor`: a `camoufox` provider-month block does not refuse a resume
    that SearchApi can still run, and the pass's stored estimate has no `camoufox` line.
  - A `paused_budget` run past its window, resumed by the next firing's live tick: it re-anchors before the window check,
    `scheduled_for` becomes that firing by the guarded update, `browser_window_end` is rewritten from the estimate of the cells
    still resumable, and its pages load. With that firing already held by another row (`changes() = 0`), the tick's
    resume keeps the old window and, past it, writes the remaining camoufox cells `scheduled_only`.
  - Two definitions firing at the same instant through the production `createLimiter` (fake clock), interleaving page
    by page, each running past its own window before its last page: both finish with every camoufox cell fetched and
    none `scheduled_only`; WP18's stagger warning reads both from their schedules (WP18 tests the text).
  - The heartbeat (fake timers and a controllable wall clock): a beat 119 s after the previous one is not a suspension;
    one 121 s after is, recording `suspendedAt` (the previous beat) and `resumedAt`, logging one line and marking every
    execution in flight; the heartbeat makes no I/O (no file, network or database call; a spy) and is `unref`'d. Before
    each `camoufox` page starts, a last beat older than 120 s counts as a suspension: with the wall clock jumped 15 min
    and no beat yet, a page start past the window is refused and the remaining camoufox cells become `scheduled_only`;
    the same within 120 s of the last beat starts normally.
  - A 15-minute suspension starting mid-page past the window: the in-flight page finishes and is stored with its
    provenance unchanged, and the remaining camoufox cells become `scheduled_only`; the same suspension inside the
    window changes nothing; a run past its window with no suspension keeps loading its pages.
- [ ] **Failing tests, under `any`:** a boot auto-resume, a `resume_after` job and a manual `/resume`, each well past
  the window's end, load camoufox pages (within the caps, spacing and cool-downs, which a stub at its cap still refuses)
  and write no `scheduled_only`; a run carrying on after a clock jump past its window keeps issuing camoufox tiles; a
  catch-up still loads no browser page (decision 79), and its camoufox cells are still `scheduled_only` with
  `catch-up-no-browser`.
- [ ] **Failing tests, under `scheduled` (and unset):**
  - `browserWindow(execution, 'scheduled', now)` reads only the stored columns; the end is inclusive: a tile at the end
    instant loads, one at the end + 1 ms does not.
  - A resume inside the window loads pages. A boot auto-resume, a `resume_after` job and a manual `/resume`, each at the
    window's end + 1 ms, load no page, write the remaining camoufox cells `skipped:scheduled_only`, and the Travelpayouts
    and SearchApi cells continue.
  - A run in flight crossing its window end with no suspension keeps going (never cut mid-run); after a detected
    suspension past its end, the page in flight (if any) finishes and is stored, no further camoufox tile is issued, and
    the remaining cells become `scheduled_only`.
  - One notice per execution ("browser pages left for the next scheduled run: this run is past its browser window"),
    however many times the window check fails.
  - View D shows "left for the next scheduled run: outside this run's browser window" for a manual run past its window,
    and "left for the next scheduled run: a catch-up loads no browser pages" for a catch-up under `any`.
  - No later resume runs a `scheduled_only` cell; the next scheduled run fetches them (positive control).
- [ ] **Implement; commit.**

### Task 16a.3: `GET /api/executions/active` and `GET /api/tools/smoke/plan`

- [ ] **Failing tests:** both return 401 without auth when auth is configured. Active: the oldest execution in flight, a parent run or a
  single-cell verification (`kind`), with `estimatedFinishAt` = now + the remaining cells' estimated seconds (a resumed
  run never in the past), or null without an estimate; `{ execution: null }` when idle;
  contract test. Smoke plan: its figures equal `smokeWorstCase(config)` for each provider combination (SearchApi on
  `trial` and `40usd`, Travelpayouts, camoufox in list and grid mode, none), split into calendar 1 and itinerary `1 + 2
  × SMOKE_EXPAND_TOP`; `trialLeft` is the trial's remaining lifetime credits or null off `trial`; `pageBoundSeconds`
  equals the request timeout `httpLimitsFor(config)` gives camoufox (list: page timeout + 15 s; grid: 2 × page timeout
  + scroll cap × (scroll spacing + 60 s) + 15 s, 2,145 s at the default settings, and at each setting's maximum); the
  ledger row count is unchanged and no provider is called (a spy); contract test.
- [ ] **Implement; commit.**

### Task 16a.4: The moved-database marker

- [ ] **Failing tests:** the app bootstrap and the tool bootstrap, with `MOVED-TO-NATIVE` beside `DATABASE_PATH`
  (inside a container or not), exit 78 with "this database moved to a native install on <date>; see docs/setup.md
  section 0" and the removal line, before any migration runs, any boot sweep or auto-resume happens, or any scheduler job
  is registered (asserted: no migration applied, no job registered); without the marker, unchanged.
- [ ] **Implement; commit.**

### Task 16a.5: The shared camoufox pieces in `core`

- [ ] **Failing tests:**
  - `CAMOUFOX_BUILDS` passes its schema; a URL outside the release prefix, an `http:` URL or a short hash fails;
    `versionOf` splits every entry's build (`152.0.4`, `beta.28`), checked against each entry; `bundleDirName` uses the
    first 8 hex characters.
  - `FLAGS.darwin-arm64` equals the worker's current flag values one by one (an exhaustive test over `FLAG_NAMES`) and
    build `152.0.4-beta.28`; the other entries are all false; `flagsFor` returns all false on a build mismatch; a test
    fails when an entry's `CAMOUFOX_BUILDS` build differs from its `FLAGS` build while any flag is true.
  - `startChecks` returns each `START_REFUSAL_REASONS` value from its facts, and null when all pass; consent expiry is
    the record's `expiresAt`.
  - `startRefusalSchema` refuses an unknown reason, an extra field and any `fix` text. `START_REFUSAL_TEXT` has an entry
    for every reason (exhaustive), its fix commands are as §3 states, and every summary passes the banned-word test.
  - `effectiveSharedSettings` gives the defaults for absent and empty lines, normalises `030` to `30`, and names an
    invalid setting without its value; `sharedSettingDiffs` returns names only (a sentinel value never appears), covers
    all nine names, compares the two grid-only names only in grid mode, and is empty when one side omits a line the
    other sets to its default.
  - `workerStatusSchema` parses a fixture holding every field WP17's worker will emit (`osArch`, `build`, each
    `consent` kind with its `boundedBy`, `monthly` readable and not, `appInstances`) and `sharedSettings`, and parses the
    current worker's status with none of them; it still refuses an unknown field. The same fixture file is what WP17's
    worker test checks its own `/v1/status` against.
  - `billingMonthWindow` agrees with `db`'s `monthWindow` (a property test over instants and billing days 1–28) and at
    literal instants: billing day 1, `2027-03-31T23:59:59.999Z` and `2027-04-01T00:00:00.000Z` (a British Summer Time
    month: the boundary stays at 00:00 UTC); billing day 15, `2027-10-14T23:59:59.999Z` and `2027-10-15T00:00:00.000Z`.
  - The worker's selectors module reads through `flagsFor` (a grep test that no `*_VERIFIED` constant is read directly);
    the worker's `paths.ts` default data directory equals `workerDataDir(home)`.
- [ ] **Implement; commit.**

### Task 16a.6: `readWorkerStatus`, the worker's shared settings and the preflight

- [ ] **Failing tests:** `camoufoxPreflight`'s existing tests pass through the split; `readWorkerStatus` returns each
  `kind` (a stub worker; an abort at 2 s under fake timers); it takes no camoufox rate-limiter token: 100 status reads,
  then a page acquires its slot without waiting; the worker's `/v1/status` handler leaves the persisted last-page time
  unchanged (worker test). `loadWorkerConfig` reads the two monthly caps and the billing day with the app's defaults
  (1500, 6000, 1), refuses an invalid one by name, and `/v1/status` reports `sharedSettings` from
  `effectiveSharedSettings`. The preflight compares the app's effective record with the worker's through
  `sharedSettingDiffs` in the app's mode and skips the provider (`provider_disabled`, "settings differ: <names>") on any
  name, in list and grid mode; a worker status without `sharedSettings` falls back to today's grid-only comparison. A
  `worker.env` with no monthly-cap and no billing-day lines (the operator's current file's shape) beside an app
  config with none passes the preflight in list and in grid mode. The adapter sends `APP_INSTANCE_HEADER`: the database's
  `app_meta.app_instance_id`, a random id kept with the database's canonical path (realpathed by `MetaRepo` itself) (`MetaRepo.appInstanceId`, migration
  0007), so a container recreate or a host rename is still one app and a database opened at another path is a second.
- [ ] **Implement; commit.**

### Task 16a.7: History label and docs

- [ ] **Failing tests:** History shows "ran <time>, catch-up for <missed time>" for an `is_catch_up` run and nothing
  extra otherwise; prices from it show their own fetch time.
- [ ] `docs/scheduling.md`: the catch-up rule (once; a late tick is a catch-up; the half-gap skip with the next − missed
  cadence; "a catch-up never loads browser pages", with resumes and boot following the browser window below; runs need the machine awake). A
  docs test pins the sentence "a catch-up never loads browser pages" and that the page holds no "hours the operator
  chose" claim. The same page states the browser window (decision 83) in one sentence the docs test also pins: "By
  default (CAMOUFOX_BROWSER_WINDOW=scheduled), browser pages load only inside a run's window: from its scheduled time
  (or a manual run's start) to 1.5 times its estimated duration later. The window is checked at a run's first browser
  page, at a resume, or after the machine has slept, never while a run keeps going; a
  run that resumes or wakes after its window leaves the browser provider's remaining cells for the next scheduled run,
  while SearchApi and Travelpayouts carry on. With CAMOUFOX_BROWSER_WINDOW=any, a resumed run keeps loading browser
  pages, within every cap, spacing and cool-down. A catch-up never loads browser pages either way." (It names the setting and its default.) `docs/api-limits.md`: "With two apps on one SearchApi key, the stop is SearchApi's own quota, not this
  app's ledger; the money ceiling holds only because the 40usd plan has no overage." A docs test pins the line. The
  wording test passes.
- [ ] **Commit.**

### Task 16a.8: Mutation wiring

- [ ] **Failing tests:** `scripts/check-mutation-globs.mjs` (root `scripts` vitest project) fails a fixture brief whose
  front-matter `mutate` glob matches no file (a typo) or a file no Stryker `mutate` entry covers, a brief with no
  `mutate` line, and a merged brief with `pending` entries; reports `pending` entries of an unmerged brief; reads CRLF
  front matter; and passes on this repository once every file of every brief's front matter is in its package's
  config; `scripts/workflows.test.mjs` asserts `mutation.yml` runs `@gmt/engine mutate`.
- [ ] **Implement** (the root `mutate` script gains `pnpm --filter @gmt/engine mutate`); **commit.**

## 6. Definition of done

- `pnpm --filter @gmt/core test` (100%), `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/engine test`,
  `pnpm --filter @gmt/providers test`, `pnpm --filter @gmt/api test`, `pnpm --filter @gmt/web test`,
  `pnpm --filter @gmt/camoufox-worker test` at their thresholds; `pnpm --filter @gmt/core mutate` and
  `pnpm --filter @gmt/engine mutate` ≥ 80% over the files of this brief's front-matter `mutate` field, with each
  surviving mutant named and explained; `node scripts/check-mutation-globs.mjs` passes.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`, `pnpm test`.
- The container rebuilt on the operator's Mac applies migration 0007 after its pre-migration backup and keeps running,
  and its camoufox preflight passes against the operator's running worker (no "settings differ").

## 7. Open questions

None.
