---
wp: 20
title: Search now (the first screen, a search's page, plain words, and the flight list for the cheapest date pairs)
owner: opus
depends_on: [19]
spec_sections: ["§2 camoufox", "§3", "§6.6", "§6.9", "§7", "§8.1", "§8.2", "§10", "§11", "§12", "§16", "§17 revision 55"]
reviewers: [product-owner, provenance-auditor, search-strategy-reviewer, cost-and-budget-reviewer, ui-reviewer, code-architect, test-strategy-reviewer, provider-integration-expert, data-model-reviewer, security-reviewer]
mutate: {"@gmt/core": ["src/labels/age.ts", "src/types/definitionDefaults.ts", "src/labels/stopCause.ts", "src/labels/mainPath.ts", "src/datePairs/marks.ts", "src/flights/choose.ts", "src/flights/ties.ts"], "@gmt/web": ["src/state/landing.ts", "src/views/Dates/overview.ts", "src/format.ts", "src/views/Searches/estimateLine.ts", "src/views/Dates/stateLines.ts"], "@gmt/camoufox-worker": ["src/names.ts", "src/flights.ts"], "@gmt/engine": ["src/stopCause.ts", "src/estimate.ts", "src/budgetCheck.ts", "src/stages/flightLists/select.ts"]}
pending: {}
status: dispatched
---

# WP20: Search now

Written 2026-10-31 against spec revision 54 (main `d04446b3`) and the approved design
`docs/superpowers/specs/2026-10-31-search-now-design.md` (Ian, 2026-10-31, every *my call* included). Revised the
same day after the core roster's review (190 findings: 57 High, 102 Medium, 31 Low; every one answered in the text
below), Ian's three rulings of 2026-10-31 (a Search again on a stopped search starts fresh; no automatic resume for a
run of an unscheduled search; a confirmation covers that run only) and the orchestrator's rulings on the review's
`requires_human_judgment` items, then again after the quick re-review (54 findings: 6 High, 32 Medium, 16 Low; each
answered below) and the orchestrator's four further rulings that follow from Ian's (a browser page-limit stop,
monthly or per-run, offers Search again and never Resume; a scheduled firing supersedes a stopped manual run of the
same search; Repeat weekly's Save stores the shown confirmation as the schedule's; `replaceStopped` travels end to
end), all of which Task 20.0 records as spec revision 55 and the design doc now carries. The
design is the requirement; from revision 55 on, the spec text wins as usual. Where this brief chooses something the
design left to the builder (its §11), the choice is marked **builder**, and Task 20.0 writes it into the spec. WP19 is
merged.

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans`, task by task, in the order below. Steps use `- [ ]` checkboxes.

**Goal.** From the first screen, a new trip is searched with From, To, a departure window, a stay range and one
**Search now** press; a search's page says in plain words what is happening, leads with the cheapest date pairs and,
where the browser worker read them, their flights; and nothing on the main path says "definition", "cell", "discovery",
"hard stop" or "verdict class".

**Architecture.** Two halves, in this order so the branch is usable early. First the flow and the words: defaults that
work, `enabled` meaning only "scheduled runs happen", create-and-start, Search again as its own confirmation and as a
fresh start on a stopped search, a stored cause for every stop, the stale fix, the first screen (layout B), a search's
page, Run now and the header's selector out of the shell, Remove, the word table, nav and landing. Then the flight
list: the worker captures every flight on a list page → protocol and contract → provider capability → `flight_lists`
tables → an engine step after discovery with its own allowance of 10 pages outside `CAMOUFOX_EXECUTION_PAGE_CAP`,
behind the grid's own page gate → two endpoints → the flights on a search's page. One PR, squash-merged.

**Tech stack.** As the repo: TypeScript 5.9 strict, zod 4, Hono 4, Drizzle over better-sqlite3, React 19 with
TanStack Query 5, vitest with Testing Library and msw, Playwright, Stryker 10 (command runner).

**Spec.** `docs/superpowers/specs/2026-10-31-search-now-design.md` (the design, as revised for the rulings) and
`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (revision 55 after Task 20.0).

## 0. Standing rules for the implementer

- **No `as`** except `as const` and `satisfies`; brands only through `core`'s helpers (`asIata`, `asIsoDate`, …) or
  zod; `node scripts/check-casts.mjs` passes. Tests are type-checked through each package's `tsconfig.test.json`.
- **TDD**: the failing test first, run it and see it fail for the stated reason, then the least code, then green.
- **Event-driven tests**: no sleeps, fixed delays or poll-until loops. Wait on an event (a promise the code under test
  returns, Testing Library's `findBy…`, a server's `listening`, a process's `exit`, a deferred promise the test
  resolves), with a timeout only as a backstop. Every clock read, debounce and poll goes through an injected clock or
  `vi.useFakeTimers()` (the pattern of `apps/web/test/views/definitions/airportList.test.tsx:93-104`, advanced with
  `vi.advanceTimersByTimeAsync`), and `useNow` is driven the same way.
- **Comments are generous**: every exported symbol has a doc comment naming its spec section (revision 55's), and
  every non-obvious choice carries a `// why:` line.
- **Words come from one place**: web view logic composes sentences from `COPY` keys (templates with parameters, as
  `views/Dates/howFar.ts` does), never inline literals, so the catalogue and rendered-sweep tests cover them; core's
  sentences (stop texts) come from `core/labels`, and every main-path name of a source comes from core's one table
  (`labels/mainPath.ts`, Task 20.1).
- **Package-scoped tests while iterating** (`pnpm --filter @gmt/<pkg> exec vitest run <path>`); the whole `pnpm test`
  only before a push (the machine is shared). **Stryker scoped** while iterating
  (`pnpm --filter @gmt/<pkg> exec stryker run --mutate <file> --concurrency 2`; each task names its run). After every
  vitest, Stryker or Playwright run, `pgrep -fl 'vitest|stryker|playwright|chrom'` and stop anything left from it.
- **Public wording**: the repo is public. Code, comments, tests, docs and commit messages never mention how the
  browser provider's pages look to a site, and never use the words `scripts/wording.test.mjs` refuses; commit messages
  (`wp20: <what>`) name no vendor's site and no data-collection method. Before every push:
  `pnpm exec vitest run scripts/wording.test.mjs` and `git diff main...HEAD | grep -nP '\b[Bb][Oo][t](s?\b|[A-Z_-])'`.
- **Worked examples only**: London → New York (`LHR`, `LGW` → `JFK`, `EWR`; metro `LON`, `NYC`) and Birmingham →
  Frankfurt (`BHX` → `FRA`). Any other code in a test is synthetic (`QQA`, `QQB`, `AAA`) and seeded by that test, never
  looked up in the airports dataset. No airport code or city name in a string literal under `apps/web/src` or
  `apps/api/src` (`node scripts/check-boundaries.mjs`). Every new fixture (`test/fixtures.searches.ts`, the worker's
  option facts, the flight-list msw bodies) carries `sourceKind: 'synthetic'`/`providerId: 'fixture'` unless the test
  needs a real provider's shape (the flight-list msw bodies always do: the contract refuses any provider but
  `camoufox`, so they carry the real provenance shape with synthetic flights), and is scanned by the existing
  secret-substring test; inline worker names are marked synthetic in a comment.
- **Every task builds alone**: a contract field is added in the task that produces it, or as optional with every
  consumer named; each task's pass step includes `pnpm -r typecheck`. No two files in one directory differ only by
  letter case.
- **Secrets in tests are sentinels** (`test-worker-key-0123456789abcdef0123456789abcdef`); the redaction sweep gains
  every new response shape (`stop`, `flights`, flight-list `reason`, the cards).
- **Package boundaries**: `web` imports only `core`; `engine` never imports `api` (the api passes what the engine
  needs through `EngineOptions`, Task 20.9); `node scripts/check-boundaries.mjs` passes.
- **Commits**: plain fix commits (the PR lands by squash-merge). Every commit ends with the trailer
  `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`. Never a bare `git stash`.
- **CodeRabbit**: count the PR's changed files; at 150 or fewer the app reviews it, above 150 run the CLI and say so
  in the PR. Before the merge, read the app's inline threads and outside-diff list, fix each, push, resolve each.
- **Windows known failures** (`ci/windows-known-failures.txt`, byte-sorted `<file> > <fullName>` lines): no task
  below depends on POSIX file modes, so none is expected. Instant formatting is assembled from `formatToParts` (Task
  20.1) so ICU differences cannot change a sentence. A test that fails only on Windows for a cause the list already
  names gets its line after the CI matrix has run, sorted into place, and the PR says why.

## 1. Global constraints (from the design and the spec)

- Provenance (source, age, "not checked with the airline") stays visible without hovering on every price, the cards'
  cheapest and every flight included; every amount renders through `PriceCell`; the tie line, the estimate sentence
  and the monthly-pages note format money and counts only through the cost formatter the estimate panel uses
  (`sourceGuard.test.ts` allowlist, Task 20.5).
- "Not searched", "not reached" and "couldn't be read" are never shown as "no flights" or "no price shown"; a flight
  read never says "verified"; the banned words of §11 hold; main-path refusal and stop text is never engine or vendor
  text.
- No run spends money or capped calls the operator did not see first: the Search now and Search again presses are the
  confirmation, for that run only, of exactly the figures beside the button, which the server recomputes.
- A new search has no schedule; `enabled` means scheduled runs happen and nothing else; nothing runs unattended
  without the operator's say: a manual run of an unscheduled search is never resumed by a timer or at boot.
- Flight-list pages: `FLIGHT_LIST_COUNT = 10` a run, outside `CAMOUFOX_EXECUTION_PAGE_CAP`, inside the monthly page
  cap and `EXECUTION_MAX_FREE_CALLS`; `FLIGHT_LIST_MAX_FLIGHTS = 30` a list; `FLIGHTS_SHOWN = 3`. No new setting (§12).
  The browser provider is `camoufox` only, economy only; the step and the on-demand read run for no other provider.
- A flight read never changes a date pair's price, rank, coverage or bucket; its outcome is stated beside the price.
- Money in integer pence; timestamps `toISOString()` text; dates `YYYY-MM-DD` on the wire, "10 Jan 2027" on screen;
  no local-time `Date` arithmetic anywhere (calendar arithmetic on the strings, run under `test:tz`).

## 2. Review Focus

Five conditions the design implies and no section of it tests; each is pinned by a test in the task named:

1. **No price source at all.** An install with nothing configured: Search now saves the search and the start is
   refused (`disabled`); the page opens with "No price source is set up, so nothing was searched" and the fix
   "Set up a price source (Providers)", never engine text and never a blank board (Tasks 20.2, 20.5).
2. **A run that is pending, not yet running.** "Read flights for this date" is refused `browser_busy` before any
   worker call or ledger row while a parent run that names the browser provider is `pending` as well as `running`,
   and allowed while a Travelpayouts-only run is running; a run that goes pending while a read is in flight waits for
   the browser lease before its first page (Task 20.9).
3. **The grid cap spent before the flights.** A camoufox-only run whose 100 grid pages are used stops `paused_budget`
   at `provider-execution`; the flight-list step still runs on its own allowance (the one stop it runs after), reads
   its 10 pages, and the run stays `paused_budget` with its stop sentence noting "flights read for 10 of 10 date
   pairs" and offering Search again, never Resume; the 11th flight page is refused at `provider-execution` before any
   call and the status is unchanged; a Cancel during that step ends the run `cancelled` (Tasks 20.8, 20.9).
4. **Runs stopped before migration 0011.** An execution row with `stop_cause_json` NULL reads
   `NO_STOP_CAUSE_TEXT` whether or not `error_text` holds a message, never the stored `error_text` and never
   "paused: error"; seeded through a real migrated database (Tasks 20.2, 20.3, 20.6).
5. **A date typed the old way.** "10/01/2027" in Leave between is refused beside the field with "Enter the date as
   10 Jan 2027", no estimate request is made past the debounce, and Search now stays disabled with an accessible
   description naming "Leave between" (Task 20.5).

## 3. Scope

**In**

- Spec revision 55 (Task 20.0) and the design doc's rulings.
- `core`: defaults (no arrival window, no schedule), the main-path name table, `stopCauseSchema`, `stopText` and
  the stop-text schema, the search-card, create-and-start, restore, flight-list, estimate-response and execution
  contract changes, `calendarStaleThreshold`, `FlightListCapability` on the provider port, the worker protocol's
  `flights` request and answer, the worker's page URL moved to core, the flight-list constants, `chooseFlightsToShow`,
  `orderWithinTie`, `ROUTES` entries.
- `camoufox-worker`: times captured by the grammar (optional groups), `readFlights`, `POST /v1/flights`.
- `providers`: the camoufox adapter's `flightLists` capability.
- `db`: migration 0011 (two execution columns, `flight_lists`, `flight_list_flights`), `FlightListsRepo`,
  `DefinitionsRepo.restore`, `ExecutionsRepo.latestParentPerDefinition`, the stop cause on every status write, the
  budget guard's endpoint split, airport ranking by country.
- `engine`: manual runs ignore `enabled`; a fresh start over a stopped run; no automatic resume for unscheduled
  searches; `requireCovered` starts; a cause on every stop; the browser lease; the flight-list step, its allowance,
  gate, reuse, resume and error table; the on-demand read; the estimate's flight line and covered date pairs.
- `api`: `GET /definitions/cards`, `POST /definitions/create-and-start`, `POST /definitions/:id/restore`,
  `GET`/`POST /definitions/:id/flight-lists`, DELETE cancelling an active run, the execution response's `stop`,
  `flights` and `estimatedFinishAt`, the estimate response's additions, the per-price stale rule in every reader,
  airport ranking by point of sale, the boot sanity check and the Status data check under the new `enabled`.
- `web`: the Searches view (cards and the new-search form), the search's page (header line, running, reading and
  stopped lines, Repeat weekly, Search again, flights, ties, the five-mark month key), Run now and the selector out of
  the shell, Remove with undo, the word table, nav and landing, the e2e smoke.
- Docs: `apps/web/PRODUCT.md`, `docs/setup.md`, `docs/providers.md` (the camoufox verdict cell and one line).

**Out** (owner in brackets)

- Booking, any price not read, the return leg's flights, flight numbers, airport codes per segment (design §2, §6.3).
- Any change to what discovery searches or how the grid is paged (WP14, WP15); verification, alerts, History (WP7,
  WP10, WP11) beyond reading the new fields and the stale rule.
- The set-up views' own terms (Providers, Alerts, Status keep them with a one-line explanation where first shown).
- Windows CI changes (WP16b); the visual system beyond the departure-board look that exists.

## 4. Interfaces consumed (unchanged unless a task says so)

```ts
// @gmt/core
definitionDefaults(): DefinitionDefaults; DEFAULT_CRON; DEFAULT_DISCOVERY_REFRESH_HOURS (= 168, alerts/evaluate.ts)
rankDatePairs(pairs, now); figuresByDatePair(candidates, scope, now); decodeDatePairs(r); datePairIndex(s, d, r)
effectiveAge(p, now); isStale(p, now, thresholdHours); hoursSince(at, now); formatAgo; PROVIDER_NAMES (labels/providers.ts)
formatInstant(at, tz) (status/time.ts:4, h23 pinned); SOURCE_LABELS, GRID_SOURCE_LABEL, sourceLabel(p) (labels/source.ts)
searchLinkFor(providerId, cell, cabin): { url; host; label } | null; SEARCH_LINK_LABEL     // results/searchLink.ts
listRequestSchema, workerAnswerSchema, ANSWER_STATUS, versionsSchema, BLOCKED_PAGES, workerRuleSchema   // camoufox/protocol.ts
FlightProvider, DiscoveryCapability, CapabilityInfo, ProviderContext, PreflightResult, DiscoveryQuery.airportNames  // ports/provider.ts
ProviderErrorKind, BudgetScopeKind (errors.ts:28, :88: type unions with no value array today); BudgetExceeded
positiveInt = z.number().int().min(0) (api-contract/definitions.ts:16: its name notwithstanding, it accepts 0)
ROUTES: readonly RouteDef[] (api-contract/index.ts:84): the one route table; createApp refuses an entry without a handler
  and a handler whose schemas are not its entry's (app.ts:118-133)
estimateSchema (api-contract/definitions.ts:163), read back from every stored estimate_json (db/src/internal/read.ts:116)
definitionCreateRequestSchema, definitionUpdateRequestSchema (api-contract/definitions.ts:146, :149); the status check's
  fix shape { text, command: z.string().startsWith('pnpm gmt ').nullable() } (api-contract/system.ts:168-171)
// @gmt/db
Repos (repos.ts:18); ExecutionsRepo { create, get, oldestInFlight, listByStatus, activeParent, claimResume, cancelPaused,
  setStatus(id, status, patch: ExecutionPatch), patch, bootSweep, apply }; CLAIM_RESUME_SQL (executions.ts:101)
DefinitionsRepo { create, update, get, list, softDelete (sets enabled = 0 today), setConfirmed }; AirportsRepo.search(q, limit)
SqliteBudgetGuard { checkCaps (budgetGuard.ts:264), providerExecutionRows, usage }; LedgerRepo.countsFor (ledger.ts:26)
schema/checks.ts: isInteger, isNullOrInteger, isIsoTimestamp, isOneOf, isBool, isPointOfSale, isProviderKind, priceTableChecks
// @gmt/engine
startExecution(ctx, reg, definitionId, opts: StartOptions): Promise<StartResult>  // start.ts:240; 'disabled' at :250; 'active' at :252-257
replacePausedCatchUp(ctx, supersedes) (start.ts:109, :361: the one-transaction supersede a fresh start reuses)
confirmationNeeded(ctx, estimate, blocked, confirmed) (start.ts:169); SOFT_CONFIRM_CALL_SHARE = 0.2
finalStatus(stop: StopReason | null, now, tz) (execute.ts:72); execute(ctx, run) (execute.ts:15); finish
RunState { disabled: Set<ProviderId>; disabledReason: Map<ProviderId, SkipReason>; isCatchUp; isChild; stop; lanes; controller; intake } (run.ts:57)
Lane.budgetOut: boolean (run.ts:47, set for provider-execution and provider-month alike at :404-407); stopRun keeps the first stop (run.ts:171)
StopReason (run.ts:24); disableProvider (run.ts:448); airportNamesOf(ctx): (iata) => string[] (stages/discovery.ts:51-54); sellsCabin (snapshot.ts:34)
mayLoadPage(ctx, run, providerId, lane); pageGate(ctx, run, providerId, lane) (stages/browserGate.ts:98, :115: its closed-window path calls
  leaveLane and pushes the browser-window notice); browserWindow(); browserLeftAtResume(exec) (browserGate.ts:146); Orchestrator.cancel(id) (orchestrator.ts:22)
EngineOptions { alerts?, consentCheck?, providerConcurrency? } (types.ts:75), passed by apps/api/src/bootstrap/engine.ts:17-19
EngineContext.lifecycle { closing; closed; abort: AbortController } (context.ts:95); Engine.estimateRemaining (types.ts:154)
estimate (estimate.ts:160-212, the camoufox line: list page = minSpacingSeconds + 40 s); confirmationOf (estimate.ts:385: every line, blocked
  included; WP8's PUT path keeps it); snapshotBudget (snapshot.ts:55); the schedule predicate enabled && scheduleCron !== null && deletedAt === null
  (tick.ts, scheduler.ts, boot.ts); the one-shot resume job (engine.ts:102-113); autoResume (scheduler/catchUp.ts:206)
// @gmt/providers
camoufoxProvider(o): FlightProvider (camoufox/provider.ts:146); classifyWorkerAnswer, throwIfMonthly (answer.ts:53, :152)
camoufoxHttpLimits (camoufox/limits.ts: one timeout per provider; no per-request timeout); HttpKit.request (http/types.ts:151)
// @gmt/api
datePairFigures(loaded, scope, rc) (read/datePairs.ts); loadRows (read/load.ts); thresholdFor, staleness (read/rows.ts:70, :81)
applyConfirmation, syncSchedule (routes/definitions.ts:41, :64); startError, START_STATUS (routes/executions.ts:16, :30)
activeExecution(ports, engine) (read/executions.ts:158); safeSearchLink (read/links.ts:33); scrubDetails (errors.ts:48)
HANDLERS (routes/index.ts); the boot airport sanity check (bootstrap/app.ts:214-219); the Status data check (read/status.ts:298)
// @gmt/web
PriceCell (components/PriceCell.tsx: pricePence, provenance, calendar, stale, compact face); isCalendarPrice (Provenance.tsx:46)
formatIsoDate, formatIsoDateShort, MONTHS, formatPence, formatMinutes (format.ts); hrefWith; updateSearchParams; navigateTo
useSearchParams; useNow; useMediaQuery; api (api/endpoints.ts:19); qk, POLL_MS, useDefinitions, useExecution, useExecutionWatch,
useDatePairs, useExecutionActions (api/queries.ts; useExecutionWatch polls nothing itself: it shares the status bar's poll of the oldest
  run in flight); isSyntheticRead (views/Dates/board.ts:132); providerStatusKnown (App.tsx:71); test:tz (package.json:19: test/tz,
  test/views/dates and the results panel test only)
AirportListInput, airportChoices, suggestedName (views/Definitions/); EstimatePanel, BudgetFitPanel; ScheduleField, parseSchedule
RunNowButton (components/StatusBar.tsx:152, also views/Dates/States.tsx:35: replaced in Task 20.3)
renderWithProviders (test/render.tsx:16); fixtures (test/fixtures.ts, fixtures.dates.ts); server, handlers (test/msw/)
```

## 5. Interfaces produced

Each `core` item names the task that builds it; a later task uses it by these names.

```ts
// ---------- core (Task 20.1 unless marked) ----------
// types/definitionDefaults.ts
definitionDefaults(): constraints = { maxJourneyMinutes: 1500 } (no arrivalWindowLocal); scheduleCron: null; enabled: false

// labels/mainPath.ts: the one table of main-path source names (design §7; the set-up views keep PROVIDER_NAMES)
export const MAIN_PATH_SOURCE: Readonly<Record<ProviderId, string>>;
//   camoufox 'the browser worker', travelpayouts 'the Aviasales cache', searchapi 'Google Flights via SearchApi', fixture 'the test source'
export function mainPathSource(id: ProviderId): string;

// errors.ts: export const BUDGET_SCOPE_KINDS = [...] as const and export const PROVIDER_ERROR_KINDS = [...] as const; the two type unions
//   BudgetScopeKind and ProviderErrorKind are derived from them (the kinds are unchanged)
// flights/types.ts (the part Task 20.1 creates): export const LISTED = ['flights', 'no-flights', 'none-for-cell'] as const; export type Listed
// ports/provider.ts (Task 20.1): export interface CellAirportNames { origin: string[]; destination: string[] }, the type DiscoveryQuery.airportNames
//   already has inline; FlightListQuery (Task 20.7) uses it too

// api-contract/stopCause.ts (the schema lives in api-contract because db parses stored JSON through api-contract schemas)
export const STOP_DETAILS = [...PROVIDER_ERROR_KINDS, ...BLOCKED_PAGES, 'settings-differ', 'grid-unverified', 'counts-unreadable',
  'no-airport-names', 'none-for-cell', 'unparsed', 'monthly-cap', 'execution-cap', 'free-call-cap', 'outside-browser-window',
  'fatal', 'aborted'] as const;      // every detail and reason the app stores is one of these words, never free text
export type StopDetail = (typeof STOP_DETAILS)[number];
export const stopCauseSchema = z.discriminatedUnion('kind', [
  { kind: 'sources-unavailable', stage: stageSchema, searched: count,     // date pairs searched before the stop
    sources: z.array({ providerId, skip: z.enum(['provider_disabled', 'provider_unavailable']),
                       detail: z.enum(STOP_DETAILS), until: isoDateTimeSchema.nullable() }).min(1) },
  { kind: 'budget', scope: z.enum(BUDGET_SCOPE_KINDS), providerId: providerIdSchema.nullable(), unit: z.enum(['calls', 'pages', 'scrolls', 'pence']),
    resumeAfter: isoDateTimeSchema.nullable(), resetsAt: isoDateTimeSchema.nullable(),   // resetsAt: the cap window's end, even when no resume is scheduled
    flights: z.strictObject({ read: count, planned: count }).nullable() },               // set when the flight step ran after this stop
  { kind: 'limiter-timeout', providerId, resumeAfter: isoDateTimeSchema.nullable() },
  { kind: 'cancelled' }, { kind: 'superseded', by: z.enum(['schedule', 'search-again', 'stale', 'remove']) },   // 'schedule': a firing over a stopped run
  { kind: 'never-started' }, { kind: 'interrupted' }, { kind: 'fatal' }, { kind: 'child-cap' },
  { kind: 'skipped-confirm', estimatePence: moneyPenceSchema, confirmedPence: moneyPenceSchema.nullable() },
  { kind: 'skipped-budget', scope: z.enum(BUDGET_SCOPE_KINDS), providerId: providerIdSchema.nullable() },
  { kind: 'skipped-window' }, { kind: 'skipped-missed', code: z.enum(SKIP_CODES) },
]);
export type StopCause = z.infer<typeof stopCauseSchema>;
export const stopTextSchema = z.strictObject({ sentence: z.string().max(400),
  fix: z.strictObject({ text: z.string().max(200), command: z.string().startsWith('pnpm gmt ').max(200).nullable() }).nullable() });
export type StopText = z.infer<typeof stopTextSchema>;
// labels/stopCause.ts
export function stopText(c: StopCause, f: { tz: string; mode: 'native' | 'container' | 'dev'; scheduled: boolean }): StopText;
//   full sentences (no caller adds a prefix); instants through formatInstantShort; names through mainPathSource
export const NO_STOP_CAUSE_TEXT: StopText;   // "No reason was recorded for this run." / fix "Search again"
// status/time.ts
export function formatInstantShort(at: IsoDateTime, tz: string): string;   // "14 Mar 15:00", assembled from formatToParts (day, short month, h23)
// labels/age.ts (the one staleness rule, pure; rows.ts, history.ts, statusSources.ts and the engine's alerts/marks.ts call it directly)
export function calendarStaleThreshold(p: Pick<Provenance, 'maxAgeHours'>, refreshHours: number, override: number | null): number;
//   override ?? refreshHours + (maxAgeHours === 'unknown' ? 0 : maxAgeHours): the price's OWN stored age (design §5.5). For a bounded or
//   unknown age this is exactly "never stale within the refresh" (fetch age ≤ refresh ⇔ not stale), so no latest-run clause exists; a
//   vendor-dated price keeps its own age; an override wins as the design says
export function stalenessOf(row: { provenance: Provenance; basis: 'verified' | 'calendar' },
  t: { refreshHours: number; overrideHours: number | null; staleAfterHours: number }, now: IsoDateTime): { ageHours: AgeHours; stale: boolean; markText: string };
//   calendar: isStale against calendarStaleThreshold; verified: against staleAfterHours; markText from staleMarkText
export function staleMarkText(t: { basis: 'verified' | 'calendar'; override: boolean }): string;
//   calendar, no override: "older than this search's refresh"; override: "older than your stale setting"; verified: "older than your stale setting"
// types/definition.ts: export function isScheduled(d: Pick<SearchDefinition, 'enabled' | 'scheduleCron' | 'deletedAt'>): boolean
//   (enabled && scheduleCron !== null && deletedAt === null: the engine's one schedule predicate, read live by finish, the one-shot job and autoResume)
// datePairs/marks.ts (the main path's one reading of a date pair's six buckets)
export type ReducedMark = 'priced' | 'no-price-shown' | 'couldnt-read' | 'not-reached' | 'not-searched';
export function reducedMark(buckets: Buckets): ReducedMark;   // the §6.6 precedence bucket over the airport pairs → one of five
export function datePairSearched(buckets: Buckets): boolean;  // reducedMark ∈ { priced, no-price-shown }: the cards, the header line, the stopped line,
//   the stop cause's `searched` and the overview all count with this one function

// api-contract/searches.ts
export const searchCardSchema = z.strictObject({
  id, name, origins: z.array(iataSchema), destinations: z.array(iataSchema),
  window: z.strictObject({ kind: z.enum(['absolute', 'relative']), departureFrom: isoDateSchema, departureTo: isoDateSchema,
    startOffsetDays: count.nullable(), lengthDays: positiveInt.nullable() }), minNights, maxNights, cabin: cabinSchema,
  schedule: z.strictObject({ cron: cronSchema, tz: z.string() }).nullable(),   // non-null only when enabled and cron set
  discovery: z.array(providerIdSchema),                                        // the sources it names
  latestRun: z.strictObject({ id, status: executionStatusSchema, trigger, startedAt: nullable, finishedAt: nullable,
    datePairs: count, datePairsSearched: count, datePairsNeverSearched: count,   // over the run's snapshot space; searched = priced|empty|no_data on any airport pair
    flights: z.strictObject({ planned: count, read: count }).nullable(),
    estimatedFinishAt: isoDateTimeSchema.nullable(), stop: stopTextSchema.nullable() }).nullable(),   // stop non-null only for a stopped status
  spaceChangedSince: z.boolean(),      // the definition's space changed after latestRun started (persona-007)
  cheapest: z.strictObject({ pricePence: moneyPenceSchema, provenance: provenanceSchema, stale: z.boolean(), ageHours: ageHoursSchema,
    basis: z.enum(['verified', 'calendar']), departureDate, returnDate, origin, destination, fromLatestRun: z.boolean() }).nullable(),
});
export const searchCardsResponseSchema = z.strictObject({ cards: z.array(searchCardSchema) });   // in card order (the api owns it)
export const createAndStartRequestSchema = z.object(definitionFields).omit({ confirmedCostPence: true, confirmedCalls: true })
  .extend({ confirmCostPence: moneyPenceSchema, confirmCalls: count, requestKey: z.string().uuid() }).superRefine(refineDefinition);
export const startRefusalCodes = ['cap', 'confirm', 'window', 'disabled', 'shutting-down', 'failed'] as const;
export const createAndStartResponseSchema = z.strictObject({
  definition: definitionResponseSchema, executionId: z.string().nullable(),
  refusal: z.strictObject({ code: z.enum(startRefusalCodes), estimatePence: moneyPenceSchema.nullable(), totalCalls: count.nullable(),
    resetsAt: isoDateTimeSchema.nullable() }).nullable() });     // no message: the web words each code
// api-contract/executions.ts (Task 20.1): startExecutionRequestSchema gains requireCovered: z.boolean().optional() and
//   replaceStopped: z.boolean().optional(); the route passes both through to StartOptions (Task 20.2)
// api-contract/executions.ts (Task 20.2, with the db mapper and api reader that fill them): executionResponseSchema gains
//   stop: stopTextSchema.nullable();          // from stop_cause_json; NO_STOP_CAUSE_TEXT when NULL on a stopped status; null on every other status
//   estimatedFinishAt: isoDateTimeSchema.nullable();   // now + estimateRemaining(id).seconds while pending or running, else null
//   flights: z.strictObject({ planned: count, read: count, reused: count, failed: count, ended: z.enum(['window', 'monthly-cap', 'stopped', 'disabled']).nullable() })
//     .refine(read + reused + failed ≤ planned).nullable();   // null only when the run's snapshot names no browser provider; derived at read time
//     // from flight_lists_json when it exists, else from the row's status and snapshot (planned 0 with the ended word)
// api-contract/definitions.ts (Task 20.4, with the route that fills them): estimateResponseSchema (the route's answer, beside budgetFit) gains
//   datePairs: count; datePairsCovered: count; datePairsPartly: count; datePairsReused: count;   // planned-only coverage; reused apart
//   softConfirm: z.strictObject({ reason: z.string() }).nullable();
//   billedCalls: z.array({ providerId, calls: count, left: count.nullable() })   // runnable lines of billable-plan providers (cost-003)
//   monthlyPages: z.strictObject({ planned: count, left: count }).nullable()   // the browser worker's month (cost-018, persona-005)
// estimateSchema (the stored Estimate; Task 20.1) gains only flightLists: z.strictObject({ pages: count, seconds: count }).exactOptional()
// executionBudgetSchema (Task 20.1) gains flightListPages: z.number().int().min(1).exactOptional()   // never 0; a definition's own budget never
//   carries it; the snapshot does. (positiveInt accepts 0; refreshHours and lengthDays keep their own min(1) schemas)

// camoufox/url.ts (moved from the worker; Task 20.7): export function pageUrl(req: { origin; destination; departureDate; returnDate; gl }): string
// results/searchLink.ts: searchLinkFor(providerId, cell, cabin, pointOfSale: PointOfSale = 'unknown') — the camoufox case builds pageUrl(…,
//   gl = pointOfSale, 'unknown' → 'GB'), the worker's verified form, still under LINK_ALLOWLIST; the other cases are unchanged; the
//   parameter defaults so the two api callers compile until Task 20.9 passes the install's point of sale

// flights/limits.ts (Task 20.7)
export const FLIGHT_LIST_COUNT = 10; export const FLIGHT_LIST_MAX_FLIGHTS = 30; export const FLIGHTS_SHOWN = 3;
export const FLIGHT_LIST_ENDPOINT_PATH = '/v1/flights'; export const MAX_FLIGHT_LIST_PAIRS = 50;
// labels/source.ts (Task 20.7): export const FLIGHT_LIST_SOURCE_LABEL = 'Google Flights flight list via Camoufox' (set-up views, provenance);
//   the main-path label is mainPathSource('camoufox') + "'s flight list"
// flights/types.ts (Task 20.7)
export const FLIGHT_TEXT = /^[^\p{Cc}\p{Cf}]{1,80}$/u;   // trimmed, whitespace collapsed, no control or format characters
export const listedFlightSchema = z.strictObject({
  departsLocal: hhmm, arrivesLocal: hhmm, arrivesDayOffset: z.number().int().min(0).max(3),
  durationMinutes: z.number().int().min(1).max(6000), stops: z.number().int().min(0).max(5),
  carriers: z.array(z.string().regex(FLIGHT_TEXT)).min(1).max(6), operatedBy: z.string().regex(FLIGHT_TEXT).nullable(),
  amountMinor: z.number().int().min(1) });   // GBP pence: the lowest round-trip total listed with this outbound
export type ListedFlight = z.infer<typeof listedFlightSchema>;
// LISTED (Task 20.1) means: 'flights' (at least one flight read for the pair), 'no-flights' (Google's own no-flights line),
// 'none-for-cell' (options present, none this app could read or match: other days or airports, or unparsed)
// flights/choose.ts (Task 20.10)
export interface FlightLimits { maxJourneyMinutes: number | null; arrivalWindowLocal: LocalTimeWindow | null; departureWindowLocal: LocalTimeWindow | null }
export interface ShownFlights<T> { shown: T[]; overLimit: boolean; moreRead: number; moreOutside: number }
export function withinLimits<T extends ListedFlight>(f: T, l: FlightLimits): { journey: boolean; arrival: boolean; departure: boolean };
export function chooseFlightsToShow<T extends ListedFlight>(flights: readonly T[], l: FlightLimits): ShownFlights<T>;
//   within = flights meeting both limits; shown = the first FLIGHTS_SHOWN of within by (amountMinor, durationMinutes, stops, departsLocal),
//   always including the shortest flight of within (replacing the last pick when it is not among them); when within is empty,
//   the same over every flight with overLimit true; moreRead = flights.length − shown.length; moreOutside = those not shown
//   that fail a limit
// flights/ties.ts (Task 20.10)
export function tieGroups<P>(ranked: readonly P[], keyOf: (p: P) => { pricePence: number; current: boolean }): P[][];
//   contiguous runs of equal price and equal current flag, in rank order
export function orderWithinTie<P>(group: readonly P[], shownOf: (p: P) => ShownFlights<ListedFlight> | null): P[];
//   members with at least one shown flight first, by their first shown flight's (durationMinutes, stops, departsLocal); a failed,
//   empty or missing list is no list; the rest after, in input order; stable

// api-contract/flights.ts (Task 20.7)
export const flightListsQuerySchema = z.strictObject({ pairs: z.string().max(1100) });   // "2027-03-14_2027-03-24,…", 1..50, else 422 invalid_pairs
export const flightListSchema = z.strictObject({
  id: z.number().int(), executionId: z.string().nullable(), origin, destination, departureDate, returnDate,
  fetchedAt: isoDateTimeSchema, ageHours: ageHoursSchema, stale: z.boolean(),   // stale: older than the definition's camoufox refresh
  provenance: provenanceSchema.extend({ providerId: z.literal('camoufox'), sourceKind: z.literal('scraped-self') }),   // as the DB CHECKs;
    // maxAgeHours 0, fx { converted: false }, pointOfSale, cabin economy; a fixture or synthetic list is refused
  status: z.enum(['read', 'failed']), reason: z.enum(STOP_DETAILS).nullable(),   // non-null exactly when failed
  listed: z.enum(LISTED).nullable(),  // non-null exactly when read
  minMinor: count.nullable(), tabMinor: count.nullable(), cheapestView: z.enum(['cheapest', 'best-fallback']).nullable(),
  flights: z.array(listedFlightSchema).max(FLIGHT_LIST_MAX_FLIGHTS),   // the 30 cheapest of the pair's options, in page order
  optionsUnparsed: count, optionsOtherCell: count, resultsStated: count.nullable() });
export const flightListsResponseSchema = z.strictObject({
  available: z.boolean(), unavailableReason: z.enum(['not-named', 'not-configured', 'cabin']).nullable(),
  refreshHours: positiveInt, monthlyPagesLeft: count.nullable(),
  reading: z.strictObject({ departureDate, returnDate }).nullable(),
  pairs: z.array(z.strictObject({ departureDate, returnDate, origin: iataSchema.nullable(), destination: iataSchema.nullable(),
    link: z.strictObject({ url: z.string().url().startsWith('https://'), host: z.enum(['www.google.com']), label: z.string() }).nullable(),
    list: flightListSchema.nullable(),           // the newest list for the figure's airport pair, cabin and point of sale: the only list that feeds
                                                 // the outcome beside the price, the difference line and orderWithinTie
    listOtherPair: flightListSchema.nullable() })) });   // else the newest list for another airport pair of the current space: shown only inside the
                                                 // flights block under its airport-pair label, with no outcome beside the price and no difference line
export const readFlightListRequestSchema = z.strictObject({ departureDate: isoDateSchema, returnDate: isoDateSchema });
export const readFlightListResponseSchema = z.strictObject({ accepted: z.literal(true) });

// camoufox/protocol.ts (Task 20.7): one shared field shape and one shared refinement pair build both
//   listRequestSchema (mode 'list', unchanged behaviour) and flightsRequestSchema (mode 'flights'); pageRequestSchema is unchanged.
// workerAnswerSchema gains { kind: 'flights', fetchedAt, currency: 'GBP', pointOfSale, listed: z.enum(LISTED), flights: array(listedFlightSchema).max(30),
//   minMinor: count.nullable(), tabMinor: count.nullable(), cheapestView, optionsUnparsed, optionsOtherCell, resultsStated: count.nullable(),
//   notes, versions }; ANSWER_STATUS.flights = 200; the header comment names /v1/flights

// ports/provider.ts (Task 20.7)
export interface FlightListQuery { cell: CellKey; airportNames: CellAirportNames }   // economy only; the adapter's own gl and point of sale;
//   the engine fills it as { origin: names(cell.origin), destination: names(cell.destination) } from airportNamesOf(ctx)
export type FlightListResult =
  | { kind: 'list'; fetchedAt; pointOfSale; listed: Listed; flights: ListedFlight[]; minMinor: number | null; tabMinor: number | null;
      cheapestView: 'cheapest' | 'best-fallback' | null; optionsUnparsed: number; optionsOtherCell: number; resultsStated: number | null; notes: string[] }
  | { kind: 'list-error'; error: ProviderError };          // BudgetExceeded is thrown, as fetchTile throws it
export interface FlightListCapability { info: CapabilityInfo; read(q: FlightListQuery, ctx: ProviderContext): Promise<FlightListResult> }
// FlightProvider gains flightLists?: FlightListCapability (the discovery preflight is its preflight)

// ---------- camoufox-worker (Task 20.7) ----------
// src/names.ts: the leg pattern gains OPTIONAL capture groups; ParsedOption gains departsAt: string | null, arrivesAt: string | null ('HH:MM'),
//   arrivesOn: { month: number; day: number } | null (as departsOn); GRAMMAR_VERSION = '2026-10-31-times'
// src/flights.ts
export interface FlightsRead extends ListRead { listed: Listed; flights: ListedFlight[] }   // the 30 cheapest of the cell's options, page order
export function readFlights(f: ListFacts, req: Pick<FlightsRequest, 'departureDate' | 'airportNames'>, interstitials = INTERSTITIALS): FlightsRead;
export function dayOffset(departsOn: { month: number; day: number }, arrivesOn: { month: number; day: number }, departureDate: IsoDate): number | null;
export function splitCarriers(s: string): string[];   // on ', ' and ' and '; each trimmed, whitespace collapsed
// src/server.ts: POST /v1/flights admits flightsRequestSchema only (4,096-byte cap) and calls PageSession.page(); page() branches at the
//   reader for mode 'flights' (readFlights for readList), as grid branches, keeping fellBack, currency and no-options-read

// ---------- providers (Task 20.7) ----------
// packages/providers/src/camoufox/flights.ts
export const CAMOUFOX_FLIGHT_LIST_INFO: CapabilityInfo;   // sourceKind 'scraped-self', maxAgeHours 0, the provenance note of Task 20.7
export function flightListCapability(o: CamoufoxProviderOptions): FlightListCapability;   // camoufoxProvider(o).flightLists

// ---------- db (Task 20.2: migration, schema and repos; Task 20.8: FlightListsRepo) ----------
// drizzle/0011_wp20_flight_lists.sql (whole, hand-written as 0010, with meta/_journal.json and meta/0011_snapshot.json):
//   search_executions + stop_cause_json TEXT NULL, flight_lists_json TEXT NULL; tables flight_lists, flight_list_flights (Task 20.2's columns)
// repositories/flightLists.ts
export interface NewFlightList { definitionId; executionId: string | null; providerId: ProviderId; sourceKind: SourceKind; cell: CellKey;
  pointOfSale; fetchedAt; status: 'read' | 'failed'; reason: StopDetail | null; listed: Listed | null; minMinor; tabMinor; cheapestView;
  optionsUnparsed; optionsOtherCell; resultsStated: number | null; flights: readonly ListedFlight[] }
export interface FlightListRow extends NewFlightList { id: number; cabin: 'economy'; currencyNative: 'GBP' }
export class FlightListsRepo { constructor(db: Db, clock: Clock, opts: RepoOptions);   // refuses providerId ≠ 'camoufox' before SQL
  insert(list: NewFlightList): number;
  newestPerCell(definitionId: string, cells: readonly CellKey[], pointOfSale: PointOfSale): FlightListRow[];   // one statement (json_each + ROW_NUMBER)
  newestPerDatePair(definitionId: string, pairs: readonly { departureDate; returnDate }[], space: ResolvedSpace, pointOfSale): FlightListRow[];
  forExecution(executionId: string, plannedCells: readonly CellKey[]): { read: number; failed: number } }   // newest row per planned cell
// ExecutionPatch and the core Execution type (core types/execution.ts, Task 20.2) gain stopCause: StopCause | null and
//   flightLists: FlightListsState | null, read by db/src/internal/read.ts as estimate_json is, where
//   FlightListsState = { planned: number; cells: CellKey[]; reused: number; ended: 'window' | 'monthly-cap' | 'stopped' | null }
//   (written only when the step selected at least one cell; 'disabled' is derived at read time, never stored)
// ExecutionsRepo.apply clears stop_cause_json when the status becomes pending, running or completed; CLAIM_RESUME_SQL clears it;
//   bootSweep's UPDATE writes the interrupted cause; cancelPaused(id, cause: StopCause)
// ExecutionsRepo.latestParentPerDefinition(): Map<string, Execution>   // one statement, ROW_NUMBER by created_at desc, id desc
// DefinitionsRepo.softDelete no longer clears enabled (every scheduling reader checks deleted_at); restore(id): 'restored' | 'live' | 'tool-only'
// AirportsRepo.search(q, limit, country: string | null): same-country rows first within each band, then kind, then the rest

// ---------- engine ----------
// types.ts (Task 20.2): the reader types, beside the start options the task changes
export interface RankedDatePair { departureDate; returnDate; origin; destination; pricePence: number; providerId: ProviderId; sourceKind: SourceKind }
export type RankedDatePairsReader = (q: { definitionId: string; space: ResolvedSpace; cabin: Cabin; maxJourneyMinutes: number | null; now: IsoDateTime }) => RankedDatePair[];
// types.ts (Task 20.9): EngineOptions gains rankedDatePairs?: RankedDatePairsReader (absent: the step runs nothing; flights reads planned 0, ended 'disabled')
// StartOptions gains requireCovered?: boolean (refuse 'confirm' whenever the runnable estimate exceeds the confirmation in pence or calls)
//   and replaceStopped?: boolean (cancel a paused_* or interrupted latest parent with cause superseded 'search-again' and start, one immediate transaction);
//   both arrive from startExecutionRequestSchema through routes/executions.ts
// start.ts refuses 'disabled' only when opts.trigger === 'schedule'; a scheduled firing over a paused_* or interrupted parent of the same
//   definition supersedes it (cause superseded 'schedule') and starts, in the one transaction, so an old stopped manual run never blocks a schedule
// run.ts (Task 20.2): StopReason's cancel carries its cause, { kind: 'cancel'; cause: Extract<StopCause, { kind: 'cancelled' | 'superseded' }> };
//   Orchestrator.cancel(id, cause) takes it for a live run (stopRun) and a stopped one (setStatus); Lane.budgetOut becomes
//   budgetOutScope: BudgetScopeKind | null, set from the breach; RunState gains disabledDetail: Map<ProviderId, { skip; detail: StopDetail;
//   until: IsoDateTime | null }>, searchedDatePairs(): number (datePairSearched over the run's roll-ups) and flightLists: { read: number;
//   planned: number } | null (set by the step, Task 20.9) and flightStop: StopReason | null (a cancel or SIGTERM that arrives during the step
//   after a budget stop; finish prefers it to run.stop)
// stopCause.ts (Task 20.2)
export function stopCauseOf(stop: StopReason, run: Pick<RunState, 'disabledDetail' | 'searchedDatePairs' | 'flightLists'>, scheduled: boolean): StopCause;
// finalStatus(stop, now, tz, run, scheduled) (the one signature) computes the cause itself through stopCauseOf and patches
//   { stopCause, errorText: sentence, resumeAfter }, where scheduled = isScheduled(def) read live at finish and resumeAfter is null when it is
//   false (Ian's ruling 2) or the stop is the browser provider's monthly or per-run page limit (never resumed: a resume past the run's
//   window reads no browser pages); the flight-list step runs before finish, so the cause carries its counts
// browserLease.ts (Task 20.9): one in-flight slot
export interface BrowserLease { hold(done: Promise<void>): boolean; whenFree(signal: AbortSignal): Promise<void>; inFlight(): boolean }
//   held only by the on-demand read (hold returns false while held); every browser page of a pass, grid lane and flight step alike, awaits
//   whenFree(run.controller.signal) before it is sent
// stages/flightLists/select.ts (Task 20.9, pure)
export function selectFlightPairs(ranked: readonly RankedDatePair[], newest: ReadonlyMap<string, { fetchedAt; status: 'read' | 'failed'; listed: Listed | null }>,
  now: IsoDateTime, refreshHours: number, todayLondon: IsoDate, count = FLIGHT_LIST_COUNT): { read: RankedDatePair[]; reused: RankedDatePair[] };
export function cellKeyOf(p: RankedDatePair): string;   // cellKeyString: origin, destination, departure, return
// stages/flightLists.ts (Task 20.9): export async function runFlightLists(ctx: EngineContext, run: RunState): Promise<void>
//   its pages carry run.controller.signal only (cancel, SIGTERM, fatal), with an intake of its own, never run.intake or a lane's intakeSignal
//   (both already aborted after a budget stop); its gate is stages/flightLists/gate.ts: flightPageGate(ctx, run): () => void, which re-reads
//   browserWindow() and the heartbeat's suspension mark before every page (check (a) and (c) of §8.2 for the step) and throws AbortedError only,
//   marking no discovery cell and sending no notice
// flightRead.ts (Task 20.9)
export type FlightReadStart = { ok: true; done: Promise<void> } | { ok: false; code: 'busy' | 'not_available' | 'fresh' | 'not_found' | 'outside_space' | 'no_price' | 'shutting-down' };
// Engine gains readFlightList(definitionId, pair: { departureDate; returnDate }): Promise<FlightReadStart> (the busy query and lease.hold run in
//   one synchronous turn, no await between them), flightReadInFlight(): { definitionId; departureDate; returnDate } | null, and shutdown awaits a
//   read in flight (aborted through lifecycle.abort) within the drain

// ---------- api ----------
// ROUTES entries (core api-contract/index.ts) and HANDLERS (routes/index.ts): Task 20.2 adds GET /definitions/cards and POST /definitions/create-and-start
//   before GET /definitions/:id, and POST /definitions/:id/restore; Task 20.9 adds GET and POST /definitions/:id/flight-lists
// read/ranked.ts (Task 20.2): rankedPairsFor(ports, q: Parameters<RankedDatePairsReader>[0]): RankedDatePair[]   // datePairFigures + rankDatePairs, departed pairs out
// read/cards.ts: assembleCards(ports, engine, now): SearchCardsResponse
// read/rows.ts (Task 20.2): thresholds come from core's stalenessOf (above); rows.ts, history.ts and statusSources.ts build its `t` from RowContext
//   (refreshHoursFor, config.calendarStaleAfterHours, config.staleAfterHours); the engine's alerts/marks.ts imports it from core (no hook)
// routes/searches.ts (Task 20.2): runnableTotalsOf(e: Estimate): { pence: number; calls: number }   // the shown totals: unblocked lines only; what
//   create-and-start and Repeat weekly's Save store (the orchestrator's rulings); confirmationOf's doc comment says WP8's PUT keeps the worst case

// ---------- web ----------
// state/view.ts (Task 20.3)
export type ViewId = 'searches' | 'dates' | 'results' | 'history' | 'definitions' | 'providers' | 'alerts' | 'status';
export const NAV_TIERS = [{ id: 'decide', views: ['searches', 'dates', 'history'] }, { id: 'setup', views: ['providers', 'alerts', 'status'] }];
// parseView: absent or unknown → 'searches'; land(): 'definitions' without edit= → 'searches'; 'dates' without def= → 'searches'
// state/lastSearch.ts: readLastSearch(): string | null; writeLastSearch(id): void   // localStorage 'gmt.lastSearch', try/catch; the nav's page entry
// format.ts (Task 20.5): export function parseDateText(s: string, today: IsoDate): IsoDate | null   // beside formatIsoDate, the same MONTHS
// views/Searches/estimateLine.ts (Task 20.5)
export function estimateSentence(e: EstimateResponse, scheduled: { cron: string | null; tz: string } | null, c: typeof COPY, money: (pence) => string):
  { line: string; button: string; notes: string[]; covers: { pence: number; calls: number } };
export function aboutDuration(seconds: number): string;   // lower case: "under a minute", "about 12 minutes", "about 2½ hours"; the sentence capitalises
export function leftWords(seconds: number): string;       // "about 1h 40m left", "about 12m left", "less than a minute left"
// views/Dates/stateLines.ts (Task 20.6; named so it never differs from SearchedLine.tsx by case alone)
export function searchedLine(d: { run: ExecutionSummary; pairs: DatePair[]; providers: ProviderId[]; reused: number; now; c }): string;
export function stateLine(d: { latest: ExecutionResponse | null; pairs; now; c }): { kind: 'searching' | 'reading' | 'searched' | 'stopped' | 'never' | 'changed'; text: string };
export function readAt(fetchedAt: IsoDateTime, now: IsoDateTime, c): string;   // "11:44" today, else "12 Mar 11:44": the one form for every flight-read instant
// views/Dates/overview.ts (Task 20.6): imports reducedMark and datePairSearched from core's datePairs/marks.ts; keeps the striped overlay
// api/queries.ts (Task 20.6): useLatestRun(id, activeId): the status bar's shared query when id === activeId, else useExecution(id) with its own
//   refetchInterval POLL_MS while pending or running
```

## 6. Library notes (verified 2026-10-31)

- **zod 4.6.7**: `.extend` on a refined object throws at module load ("Cannot overwrite keys on object schemas
  containing refinements"), so the list and flights request schemas are built from one shared field shape plus one
  shared refinement pair, never by extending `listRequestSchema`; `z.object(definitionFields).omit(…).extend(…)` for
  create-and-start is applied before `superRefine`. `z.discriminatedUnion`, `.exactOptional()`, `z.string().uuid()`,
  `.startsWith`, array `.max()`. Verified with context7 `/colinhacks/zod`.
- **Hono 4.13.13**: the api does not register routes itself; `createApp` walks core's `ROUTES` in table order and
  refuses an entry without a handler, so a new route is an entry in `ROUTES` (placed before `GET /definitions/:id`
  where its path would otherwise match it) plus a `HANDLERS` entry whose schemas are the entry's own objects.
  `c.json(body, 202)` for the accepted read.
- **@tanstack/react-query 5.104.2**: a search's page observes its latest run through `useLatestRun(latestRun.id)`, its
  own `refetchInterval: POLL_MS` while pending or running (rulings B7, R-coupling): the status bar's poll of the same
  run is the same query key, and every observer's interval restarts on each update of the query, so the two polls move
  in step and merge into one request; the flight-lists query uses `refetchInterval: POLL_MS` only while
  `reading !== null`; the cards query `refetchInterval: POLL_MS` only while a card is pending or running;
  `useMutation` with `onSuccess` invalidating `['cards']`, `['definitions']` and `['date-pairs', id]`. Verified with
  context7 `/tanstack/query`.
- **better-sqlite3 as pinned**: `json_each(?)` for the cell list in `newestPerCell`; `ROW_NUMBER() OVER (PARTITION BY
  origin, destination, departure_date, return_date ORDER BY fetched_at DESC, id DESC)` for the newest list per cell
  and the same over `search_executions` for `latestParentPerDefinition` (sqlite.org/windowfunctions.html).
- **`Intl.DateTimeFormat`**: `formatInstantShort` assembles `{day} {month} {hour}:{minute}` from `formatToParts`
  (`hourCycle: 'h23'`) so no ICU version inserts a comma; tested under `Europe/London` across the 2027-03-28 clock
  change and under `Asia/Tokyo`.
- **React 19.3.1**: the estimate debounce is a `setTimeout` of `ESTIMATE_DEBOUNCE_MS = 400` cleared on change, driven
  by fake timers in tests; the Undo line is a `setTimeout` of `UNDO_MS = 30_000` through the injected clock.
- **Playwright 1.64.1**: the smoke's "Search now" step waits on the page's own state line (`getByRole('status')`)
  reaching "Searched", with the existing 90 s backstop; the `@phone` project asserts no horizontal overflow
  (`document.scrollingElement.scrollWidth <= innerWidth`) and 44 px targets through `boundingBox()`.

## 7. Files

**Create**: `packages/core/src/labels/{mainPath,stopCause}.ts`, `src/api-contract/{stopCause,searches,flights}.ts`,
`src/flights/{limits,types,choose,ties,index}.ts`, `src/camoufox/url.ts`; tests `packages/core/test/labels/{mainPath,
stopCause,age.stale}.test.ts`, `test/api-contract/{stopCause,searches,flights}.test.ts`, `test/flights/{choose,ties}.test.ts`,
`test/camoufox/{flightsProtocol,url}.test.ts`, `test/status/timeShort.test.ts`. `apps/camoufox-worker/src/flights.ts`,
`test/{flights,flightsRecorded}.test.ts`. `packages/providers/src/camoufox/flights.ts`, `test/camoufox/flightList.test.ts`.
`packages/db/drizzle/0011_wp20_flight_lists.sql`, `drizzle/meta/0011_snapshot.json`, `src/schema/flightLists.ts`,
`src/repositories/flightLists.ts`, `test/{migration0011,flightLists,latestParent,stopCauseWrites}.test.ts`.
`packages/engine/src/{stopCause,browserLease,flightRead}.ts`, `src/stages/flightLists.ts`, `src/stages/flightLists/select.ts`;
tests `test/{stopCause,stopWrites,browserLease,flightRead,startFresh}.test.ts`, `test/stages/{flightLists,flightListsSelect,
flightListsResume}.test.ts`. `apps/api/src/routes/{searches,flightLists}.ts`, `src/read/{cards,ranked,flightLists}.ts`;
tests `test/routes/{cards,createAndStart,restore,flightLists,newRoutesAuth}.test.ts`, `test/read/{stale,ranked}.test.ts`,
`test/bootstrap/sanityLive.test.ts`. `apps/web/src/state/lastSearch.ts`, `src/views/Searches/{SearchesView,SearchCard,
NewSearchForm,RemoveSearch,estimateLine}.ts(x)`, `src/views/Dates/{SearchedLine,StoppedLine,Flights,FlightRow,TieLine,
SearchAgainButton,RepeatWeekly}.tsx`, `src/views/Dates/stateLines.ts`, `src/api/flights.ts`; tests `test/views/searches/*.test.ts(x)`,
`test/views/searches/logic/estimateLine.test.ts`, `test/views/dates/{flights,stateLines,stopped,searchAgain,header,
repeatWeekly}.test.tsx`, `test/views/dates/logic/stateLines.test.ts`, `test/state/{landing,lastSearch}.test.ts`,
`test/format/dateText.test.ts`, `test/msw/searchesHandlers.ts`, `test/fixtures.searches.ts`.

**Modify**: the spec and the design doc; `packages/core/src/types/{definitionDefaults,execution,definition}.ts`,
`src/errors.ts`, `src/status/time.ts`, `src/labels/{age,source}.ts`, `src/results/searchLink.ts`,
`src/api-contract/{executions,definitions,index}.ts`, `src/camoufox/protocol.ts`, `src/ports/provider.ts`, `src/index.ts`,
`packages/core/stryker.config.json`; `apps/camoufox-worker/src/{names,session,server,url}.ts` (`url.ts` re-exports core's),
`apps/camoufox-worker/stryker.config.json`, `test/{names,server,session,recorded}.test.ts`;
`packages/providers/src/camoufox/{provider,limits,answer}.ts`; `packages/db/src/{repos,types,index,budgetGuard}.ts`,
`src/schema/{searchExecutions,index}.ts`, `src/repositories/{executions,definitions,airports,ledger}.ts`,
`drizzle/meta/_journal.json`, `test/{migration0009,migration0010,barrel,client,airports,definitions,budgetGuard,
executions}.test.ts`; `packages/engine/src/{start,execute,run,estimate,snapshot,types,engine,resume,orchestrator}.ts`,
`src/stages/discovery.ts`, `src/alerts/marks.ts`, `src/scheduler/{catchUp,boot}.ts` (the auto-resume rule),
`test/support/harness.ts`, `test/{start,execute,estimate,resume}.test.ts`, `packages/engine/stryker.config.json`;
`apps/api/src/defaults.ts`, `src/routes/{definitions,executions,system,index}.ts`, `src/read/{rows,executions,definitions,
datePairs,results,history,statusSources,status,links}.ts`, `src/tools/smokeCamoufox.ts`, `src/bootstrap/{app,engine}.ts`,
`test/routes/{executions,estimate,definitions,system}.test.ts`, `test/read/status.test.ts`;
`apps/web/src/{App,copy,format}.ts(x)`, `src/state/{view,landing}.ts`, `src/components/{Nav,StatusBar,PriceCell}.tsx`,
`src/views/Definitions/{DefinitionsView,DefinitionForm,AdvancedFields,ScheduleField,draft}.ts(x)`,
`src/views/Dates/{DatesView,DatesHeader,States,BoardTable,BoardCard,Legend,OverviewMonth,overview}.ts(x)`,
`src/api/{endpoints,queries}.ts`, `apps/web/stryker.config.json`, `apps/web/e2e/{smoke.spec,selectors}.ts`, the web tests
that pin the old nav, default view, selector and Run now (`test/app/shell.test.tsx`, `shellBoundary.test.tsx`,
`test/components/statusBar.test.tsx`, `test/copy/{catalogue,renderedSweep,sourceGuard}.test.ts(x)`,
`test/views/definitions/{create,form}.test.tsx`, `test/e2e/selectors.test.tsx`); `apps/web/PRODUCT.md`, `docs/setup.md`,
`docs/providers.md`. **Delete**: `apps/web/src/components/DefinitionSelector.tsx` and its test (Task 20.3).

## 8. Tasks

### Task 20.0: Spec revision 55

**Files**: the spec. The design doc already carries the rulings. No code. First commit of the build.

- [ ] Bump the header to **revision 54 → 55**. Write `### Revision 55: Search now (2026-10-31)` at the top of §17 in
  the form of revisions 48 and 50: *Ian decided 2026-10-31* (the design's goals, layout B, every *my call* line, each
  in one sentence), *Ian ruled 2026-10-31* (the three rulings: a Search again on a stopped search cancels it and
  starts fresh in one transaction, Resume staying where carrying on makes sense; a manual run of an unscheduled
  search is never resumed by a timer or at boot, its stop sentence saying when the limit resets and offering Search
  again or Resume; a confirmation covers that run only, scheduled runs keeping the confirmation given when the
  schedule was set and skipping, with the page saying so, when their cost rises past it), *Rulings on the brief's
  review* (the orchestrator's, each one sentence: the flight step's entry predicate; create-and-start stores the shown
  runnable totals; Undo restores the schedule; the flight read's outcome on the row's main line; arrival-window marks
  on flights; five month-key marks; landing always on Searches, the header selector removed, the nav's page entry the
  search last opened; "the rest when you search again" / "the rest next Monday"; the card's cheapest through
  `PriceCell`'s compact face; coverage worded as what is asked; the camoufox link in the worker's URL form; flight
  lists keyed on airport pair, dates, cabin and point of sale; pre-0011 rows read `NO_STOP_CAUSE_TEXT`; the word sweep
  over Edit and More options), *Builder's choices* (the items marked **builder** below), and *What moves* (Run now
  and the definition selector leave the shell; the Definitions view becomes the first screen's form and the Edit
  page). Note that `docs/superpowers/specs/2026-10-31-search-now-design.md` stays as the record of the conversation.
- [ ] Fold each rule into its section (never an amendment block; each section states one rule set):
  - **§2 camoufox**, after "*Capabilities: discovery only.*": the provider also offers a **flight-list read**, a second
    capability beside discovery (`flightLists`), economy only, that opens the list page of one cell and returns what
    the page showed for the pair (`flights`, Google's own no-flights line, or options none of which matched the
    airports and dates) and the 30 cheapest flights listed, each with its outbound departure and arrival times (and
    the arrival's day offset), duration, stops, carriers and the lowest round-trip total listed with that outbound
    (its "From" price; the return is neither chosen nor read), with the page's own minimum and Cheapest-tab price kept
    as the list read keeps them; it is not itinerary search (no return leg, no flight numbers, no airport codes per
    segment) and builds no `RawOffer`. Its pages are one Google document load each, in the worker's verified URL
    form, under the same spacing, cool-downs, consent, profile and page-gate rules, counted in the monthly page cap and
    `EXECUTION_MAX_FREE_CALLS`, ledgered as `page_class` rows with `endpoint_path /v1/flights`; a run reads them for
    the 10 cheapest date pairs on its board under an allowance of `FLIGHT_LIST_COUNT` (10) pages of its own, outside
    `CAMOUFOX_EXECUTION_PAGE_CAP`; on demand one pair is read against the monthly cap only, refused while any run that
    names the provider is pending or running or another read is in flight, and refused `fresh` while its newest list
    is younger than 0.9 × the refresh. Source label "Google Flights flight list via Camoufox"; the provenance note of
    Task 20.7; the search link for a camoufox cell is the page URL form the worker loads. The defaults paragraph: a
    new search names every free source the install has configured and enabled (`travelpayouts` when its token is set,
    `camoufox` when `CAMOUFOX_ENABLED`), stored on the search when it is created; `CAMOUFOX_ENABLED` stays the
    install-level opt-in.
  - **§3**: "search" is the operator's word for a search definition on the main path; "date pair" for a cell's dates;
    the main-path names of the sources are core's one table (`the browser worker`, `the Aviasales cache`, `Google
    Flights via SearchApi`); the "searched" umbrella (`priced + empty + no_data`) appears, per date pair over its
    airport pairs, in a search's progress line ("120 of 405 date pairs"), the stopped line ("0 of 405 searched") and
    the header line, each with the breakdown under the count; the six buckets are still the coverage section's and
    every count's basis, shown on the main path as five marks (priced; no price shown = no fares + no cached data;
    couldn't be read = error; not reached = skipped; not searched = not run); the word table of design §7 as the
    main-path vocabulary, "STALE" read as the stale mark's words ("older than this search's refresh", or "older than
    your stale setting" under an override or on the verified basis), "verified" still only beside class-verified
    values, and a flight list carrying no verdict class.
  - **§6.6**: unchanged buckets; the five-mark mapping and the striped overlay; the umbrella's three main-path lines.
  - **§6.9**: flight lists are not a results basis; they feed no alert, History series or figure; the figure and its
    source are unchanged by a flight read; the page states the read's outcome beside the price ("Google's list: from
    £92, 11:44" / "not in Google's list" / "Google's list showed no flights") and a difference from the figure in one
    line worded from the figure's own source.
  - **§7**: `search_executions.stop_cause_json` (every status write that stops a run writes a `StopCause`, the
    sentence in `error_text`; cleared when the row becomes pending, running or completed; NULL means written before
    0011 and reads "No reason was recorded for this run.") and `flight_lists_json` (`{ planned, cells, reused, ended }`,
    written once when the step selects); the `flight_lists` and `flight_list_flights` tables with Task 20.2's columns
    and checks; `enabled` means scheduled runs happen (existing rows keep their value, no backfill; the engine's
    `skipped_window` auto-disable now means "unschedule"; a soft delete no longer clears it, and a restore brings the
    schedule back); `schedule_cron` NULL on a new search; the boot airport check covers every live search.
  - **§8.1**: pre-start: a manual start is never refused for `enabled = 0` (`disabled` applies to scheduled firings
    only); `requireCovered` (a main-path start refuses `confirm` whenever the runnable estimate exceeds the
    confirmation in pence or calls, whatever `SOFT_CONFIRM_PENCE`); `replaceStopped` (a manual start over a `paused_*`
    or `interrupted` latest parent cancels it with cause superseded 'search-again' and starts in one immediate
    transaction); a scheduled firing over a `paused_*` or `interrupted` parent of its definition supersedes it (cause
    superseded 'schedule') and starts, so an old stopped manual run never blocks a schedule added afterwards; a manual
    run of an unscheduled search (`isScheduled` false: enabled, cron set and not deleted, read live) stores
    `resume_after` NULL on every pause and is never auto-resumed, its sentence naming when the cap resets and offering
    Search again or Resume; a stop at the browser provider's monthly or per-run page limit stores `resume_after` NULL
    for every search and offers Search again only (a resume past the run's browser window reads no browser pages; a
    manual resume of the per-run stop is refused `cap`), a scheduled search's sentence adding that the next scheduled
    run picks the pages up; a cancel carries its cause (by the operator, a remove, a stale supersede); the lifecycle
    gains the step `flight lists` between discovery and `finish` (`stage` stays `discovery`): entry predicate (no stop,
    or only camoufox's grid `provider-execution` budget stop; never a catch-up, a child, a lane with `windowOut` or
    `budgetOutScope` of `provider-month`, `provider-lifetime` or `global-month`, a disabled camoufox, a resumed pass
    whose camoufox is among `browserLeftAtResume`'s providers, a snapshot without `flightListPages`, a non-economy
    cabin); candidates = the board's ranking over the run's snapshot space and cabin with the definition's journey
    limit, departed pairs out, first 10, one airport pair each (the figure's); reuse when the newest list for the
    same cell, cabin and point of sale is `read` and younger than 0.9 × the camoufox refresh; the step's pages carry
    the run's own cancel signal, never a lane's intake, and pass a gate of the step's own that re-reads the browser
    window and the suspension mark before every page and, refused, ends the step with no row, no cell marked and no
    notice (`ended 'window'`); a cancel or SIGTERM during the step after a budget stop ends the run `cancelled` or
    `interrupted`; the step's error table (Task 20.9), under which no flight page ever changes an outcome, the run's
    status or a notice except the once-per-cool-down notice a blocked answer sends; planned once per execution when
    at least one cell is selected, a resumed pass reading only planned cells with no row of this execution and
    skipping departed ones; the execution reports `flights { planned, read, reused, failed, ended }`, derived at read
    time when nothing was planned. Every stop stores a cause (the table of Task 20.2) and the all-sources-unavailable
    stop stores each source with why and how many date pairs were searched (by the one main-path reading of a date
    pair's buckets, §6.6). Staleness per price: the calendar threshold is the refresh hours plus the price's **own
    stored** `max_age_hours`, which is exactly "never stale within the refresh" for a bounded or unknown age and
    leaves a vendor-dated price its own age; `CALENDAR_STALE_AFTER_HOURS` overrides it outright; one pure function in
    `core`, read by the board, the detail, History, Status and the alert email.
  - **§8.2**: presets: no default schedule (`schedule_cron` NULL, `enabled` 0), no default arrival window, discovery =
    every configured free source plus the §8.2 paid rule; "Repeat weekly…" opens the schedule fields (the stored cron,
    else `0 5 * * 1`) with the estimate sentence, and Save registers the schedule and stores the sentence's shown
    runnable totals as the schedule's confirmation, after the monthly-fit check; a scheduled run whose estimate exceeds
    that confirmation is `skipped_confirm` with a cause the page shows ("Skipped: today's estimate is above the
    confirmation you gave when you set the schedule · Change"); the one-shot resume job and the boot's auto-resume
    (both through `autoResume`) skip runs of definitions `isScheduled` says are unscheduled; the Definitions form
    paragraph replaced by §11's.
  - **§10**: the five routes with §5's shapes and codes, each an entry in `ROUTES`; `GET /executions/:id` gains `stop`,
    `flights` and `estimatedFinishAt`; `POST /definitions/:id/executions` gains `requireCovered` and `replaceStopped`;
    the estimate response gains `datePairs`, `datePairsCovered`, `datePairsPartly`, `datePairsReused` (coverage counts
    planned cells only; reused ones apart), `softConfirm`, `billedCalls`, `monthlyPages`; the date-pairs response
    loses `calendarStaleAfterHours`;
    `DELETE /definitions/:id` cancels an active or paused parent (cause superseded 'remove') before the soft delete;
    `GET /airports` ranks a same-country airport (the install's `POINT_OF_SALE`) first inside each band (**builder**:
    the point of sale is the locale signal, because it is the install's market and a browser locale varies by viewer);
    every new route behind the auth gate and the write header.
  - **§11**: nav tiers Decide (Searches; the search last opened, named by it, absent until one is opened; History)
    and Set up (Providers, Alerts, Status); no definition selector; the Searches view is the landing view (absent or
    unknown `?view=`; always, whatever the number of searches); layout B; the card's lines, states, actions and order
    (design §3 as revised: the cheapest through `PriceCell`'s compact face, the window's year when it crosses one, a
    rolling window's line, "N of M date pairs never searched"); the new-search form (design §4.1–4.3; dates as "10 Jan
    2027", a year-less day and month read as its next occurrence; the estimate sentence forms of Task 20.5, "free" only
    when no billable-plan source is used, capped calls and monthly pages named; the button disabled from the first
    change until the current draft's estimate, with accessible reasons); the Search now press confirms that run only,
    storing the shown runnable totals as the search's confirmation; Search again's two-press rule (design §4.4) with
    the second press confirming that run only, and its fresh start over a stopped run; Edit's "Save and search again"
    (the same sentence, button and confirmation) and "Save" ("Dates changed: N date pairs not searched yet" after a
    Save that changes the space); Run now removed from the status bar; a search's page (design §5: the header line
    from the latest run's buckets with not searched, not reached, couldn't be read and reused clauses; the searching,
    reading-flights and stopped lines; the flights block with its outbound-only header, the "N more read" line, the
    "return leg not read" line, the flight read's outcome beside the price; ties per group; the five-mark key with a
    glyph per mark); refusal words for each start refusal code; `?view=dates&def=` and `?view=definitions` without
    `edit=` land as §5's `parseView` says; Remove ("Cancel and remove" on a running search) with an inline confirm and
    a 30 s undo line that restores the schedule.
  - **§12**: no new setting; `FLIGHT_LIST_COUNT` is a constant.
  - **§16**: row 20 with this brief's scope and first failing test ("a manual start of a search with `enabled = 0`
    starts a run").
- [ ] **Run**: `pnpm exec vitest run scripts/wording.test.mjs` and `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts` green.
- [ ] **Commit**: `Specify Search now (spec revision 55)`.

### Task 20.1: `core`: defaults, names, stop causes, the search contracts, the stale threshold (first failing test's contract)

**Files**: `packages/core/src/types/{definitionDefaults,definition}.ts`, `src/errors.ts`, `src/status/time.ts`,
`src/labels/{mainPath,stopCause,age}.ts`, `src/datePairs/marks.ts`, `src/flights/types.ts` (`LISTED` only), `src/ports/provider.ts`
(`CellAirportNames`), `src/api-contract/{stopCause,searches,executions,definitions,index}.ts` (executions: the two optional start
flags; definitions: `flightLists` on the stored estimate and `flightListPages`, both `exactOptional`, so no consumer changes),
`src/index.ts`, `packages/core/stryker.config.json`; tests as §7 plus `test/helpers/searches.ts` (the card helper).
**Produces**: §5's core items marked Task 20.1. Nothing here is required of a producer yet: the execution response's and
the estimate response's new fields arrive with their producers (Tasks 20.2 and 20.4).

- [ ] **Write the failing tests.**
  - `test/types/definitionDefaults.test.ts` (extend): `definitionDefaults().constraints` deep-equals
    `{ maxJourneyMinutes: 1500 }` (no `arrivalWindowLocal` key), `scheduleCron` is `null`, `enabled` is `false`;
    `DEFAULT_CRON` is still `'0 5 * * 1'`.
  - `test/labels/mainPath.test.ts`: the four names above; every `ProviderId` has one; none contains "Camoufox".
  - `test/status/timeShort.test.ts`: `formatInstantShort('2027-03-14T15:00:00.000Z', 'Europe/London')` is exactly
    `14 Mar 15:00` (no comma); London's clocks go forward at 01:00 UTC on Sunday 28 March 2027, so
    `'2027-03-28T00:30:00.000Z'` is `28 Mar 00:30` (before) and `'2027-03-28T01:30:00.000Z'` is `28 Mar 02:30`
    (after); `'2027-03-31T23:00:00.000Z'` is `1 Apr 00:00`; under `Asia/Tokyo` the first is `15 Mar 00:00`; midnight
    renders `00:00`, never `24:00`.
  - `test/types/definition.test.ts` (extend): `isScheduled` is true only for enabled, cron set and not deleted (one
    case per missing condition).
  - `test/datePairs/marks.test.ts`: `reducedMark` over each single bucket; a date pair with one `empty` and three
    `not_run` is `not-searched` (the §6.6 precedence) and `datePairSearched` false; one `priced` and three `not_run`
    is `priced` and true; one `error` and three `empty` is `couldnt-read` and false; all `empty` is `no-price-shown`
    and true; property: `datePairSearched` ⇔ mark ∈ { priced, no-price-shown }.
  - `test/errors.test.ts` (extend): `PROVIDER_ERROR_KINDS` holds the nine kinds and `ProviderErrorKind` derives from it.
  - `test/labels/stopCause.test.ts`, table-driven over `stopText` with `tz: 'Europe/London'`, `mode: 'native'`,
    `scheduled: false` unless stated (every sentence is a full sentence; no caller prefixes it):
    | cause | sentence | fix |
    |---|---|---|
    | sources-unavailable, camoufox `provider_unavailable`, searched 0 | "The browser worker isn't answering, so nothing was searched." | "Start it with `pnpm gmt start`, then Search again", command `pnpm gmt start` |
    | the same in mode `container` | the same | "Start the browser worker, then Search again", command null |
    | the same, searched 120 of a run of 405 | "The browser worker stopped answering, so the search stopped after 120 date pairs." | the same |
    | the same at stage `verification` | "The browser worker stopped answering, so the prices found were not checked." | the same |
    | camoufox `provider_disabled`, `until` 2027-03-14T15:00:00.000Z | "The browser worker is pausing until 14 Mar 15:00, so nothing was searched." | "Search again after 14 Mar 15:00", command null |
    | camoufox `provider_disabled`, detail `signed-in` | "The browser worker refused to load pages because its browser profile is signed in to an account, so nothing was searched." | "Check Status, then Search again" |
    | camoufox `provider_disabled`, detail `settings-differ` | "… because its settings differ from the app's, …" | "Check Status, then Search again" |
    | travelpayouts `provider_disabled`, detail `auth` | "The Aviasales cache couldn't be used because its token was refused, so nothing was searched." | "Check Providers, then Search again" |
    | two sources | both clauses joined with " and ", one ", so nothing was searched." | the first source's fix |
    | budget provider-month camoufox, pages, resetsAt 2027-03-31T23:00:00.000Z, scheduled | "The browser worker's monthly page limit is used up; it resets on 1 Apr 00:00, and the next scheduled run picks these pages up." | "Search again after 1 Apr 00:00" |
    | the same, unscheduled | "The browser worker's monthly page limit is used up; it resets on 1 Apr 00:00." | "Search again after 1 Apr 00:00" |
    | budget provider-execution camoufox, pages, flights { read: 8, planned: 10 } | "This search stopped at its limit of browser pages for one run; flights were read for 8 of 10 date pairs." | "Search again to carry on (prices already found are reused)" |
    | the same, flights { read: 10, planned: 10 } | "…; flights were read for 10 of 10 date pairs." | the same |
    | the same, flights null (the step did not run) | "This search stopped at its limit of browser pages for one run." | the same |
    | budget execution-calls | "This search stopped at its limit of calls for one run." | "Raise the limit in Edit, then Resume" |
    | budget execution-free-calls | "This search stopped at its limit of free calls for one run." | "Raise the limit in Edit, then Resume" |
    | budget execution-cost, pence 500 | "This search stopped at £5, its spending limit for one run." | "Raise the limit in Edit, then Resume" |
    | budget provider-lifetime searchapi, calls | "Google Flights via SearchApi has no calls left on its plan." | "Check Providers" |
    | budget global-month, pence | "This month's spending limit is used up; it resets on <resetsAt>." | null (scheduled) / "Search again after <resetsAt>, or Resume" |
    | limiter-timeout travelpayouts, resumeAfter set | "The Aviasales cache is limiting how fast it answers; this search resumes at 14 Mar 15:00." | null |
    | limiter-timeout camoufox, resumeAfter null | "The browser worker is limiting how fast it answers." | "Resume" |
    | cancelled / superseded search-again / superseded schedule / superseded stale / superseded remove | "Stopped by you." / "Replaced by a search you started." / "Replaced by a scheduled run." / "Too old to carry on; a fresh run replaced it." / "Stopped when the search was removed." | "Search again" / null / null / null / null |
    | never-started / interrupted / fatal / child-cap | "This run never started." / "The app stopped during this search." / "The app hit an error and stopped this search." / "Stopped at the on-demand search's limit." | "Search again" / "Resume, or Search again" / "Check Status, then Resume" / null |
    | skipped-confirm, 120 p against confirmed 100 p | "Skipped: today's estimate (about £1.20) is above the confirmation you gave when you set the schedule (£1.00)." | "Change the schedule's confirmation in Edit" |
    | skipped-budget, skipped-window, skipped-missed half-cadence / browser-only-definition | "Skipped: <scope words>." / "Skipped: outside this search's window." / "Skipped: the next scheduled run was less than half the gap away." / "Skipped: only the browser worker could run it, and a catch-up loads no browser pages." | null |
    `NO_STOP_CAUSE_TEXT` is `{ sentence: 'No reason was recorded for this run.', fix: { text: 'Search again', command: null } }`.
    No sentence contains a banned word of §11, "error" as a bare state, "definition", "cell" or "hard stop"; no
    sentence starts with "Stopped:" or "Paused:" except the skipped rows' "Skipped:"; every `detail` word of
    `STOP_DETAILS` renders a clause (a table over the whole enum), so no raw class word reaches a sentence; no fix of a
    camoufox page-limit cause (monthly or per-run) names Resume.
  - `test/api-contract/stopCause.test.ts`: `stopCauseSchema` refuses `sources: []`, a `detail` outside `STOP_DETAILS`,
    a `until` that is not an instant, an unknown kind; `stopTextSchema` refuses a `command` not starting `pnpm gmt `
    and a sentence over 400 characters; `BUDGET_SCOPE_KINDS` has the seven scopes and `BudgetScopeKind` derives from it.
  - `test/labels/age.stale.test.ts`: `calendarStaleThreshold({ maxAgeHours: 24 }, 168, null)` is 192, with
    `'unknown'` 168, with override 2 it is 2; `stalenessOf` on the calendar basis: a bounded age (`maxAgeHours` 24)
    fetched 168 h ago under refresh 168 is not stale and at 169 h is stale (property over refresh ∈ 1..400 and
    `maxAgeHours` ∈ 0..72: not stale ⇔ fetch age ≤ refresh, the design's "never stale within the refresh"); an
    unknown age the same; a vendor-dated price (`providerObservedAt` 20 days ago) fetched 1 h ago is stale; override
    2 h with a row fetched 3 h ago is stale with `markText` "older than your stale setting"; the verified basis uses
    `staleAfterHours` alone; `staleMarkText` gives the three texts.
  - `test/api-contract/searches.test.ts`: `searchCardsResponseSchema` parses the worked-example card (a card helper in
    `test/helpers/searches.ts`); it rejects `schedule` with `cron` but no `tz`, `datePairsSearched` above `datePairs`,
    a `cheapest` without `provenance`, an unknown key; `createAndStartRequestSchema` refuses `confirmedCostPence` (the
    old pair), a body missing `requestKey`, and accepts `confirmCalls: 0` (a camoufox-only free search);
    `createAndStartResponseSchema` refuses a code outside the six.
  - `test/api-contract/contract.test.ts` (extend): `startExecutionRequestSchema` accepts and keeps `requireCovered`
    and `replaceStopped`; `estimateSchema` (the stored shape) parses a pre-WP20 body with no `flightLists` key and
    refuses `flightLists: undefined` written explicitly; `executionBudgetSchema` accepts `flightListPages: 10`,
    refuses 0 and refuses the key present as `undefined`. (The execution and estimate response additions are tested
    in Tasks 20.2 and 20.4, where they are produced.)
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/types/definitionDefaults.test.ts test/labels test/status test/api-contract`
  → the defaults test fails on `arrivalWindowLocal`, the others on missing modules, exports and keys.
- [ ] **Implement** §5's signatures. `stopText` composes every sentence from a template table in `labels/stopCause.ts`
  (one entry per kind, scope and detail), names through `mainPathSource`, instants through `formatInstantShort`,
  money through core's pence-to-pounds formatter. Add `src/types/definitionDefaults.ts`, `src/labels/stopCause.ts`,
  `src/labels/mainPath.ts` and `src/datePairs/marks.ts` to `packages/core/stryker.config.json`'s `mutate` and move
  them from this brief's `pending` to `mutate` in the same commit (`age.ts` is already listed).
- [ ] **Run to verify they pass**: the same command green; `pnpm --filter @gmt/core test` green at 100%; `pnpm -r typecheck`;
  `pnpm --filter @gmt/core exec stryker run --mutate src/labels/stopCause.ts,src/labels/age.ts,src/datePairs/marks.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: defaults without a schedule or arrival window, main-path names, stop causes and the search contracts`.

### Task 20.2: `engine`, `db` and `api`: manual runs ignore `enabled`, fresh starts, no automatic resume for unscheduled searches, a cause on every stop, migration 0011, cards, create-and-start, restore, the stale rule, airport ranking

**Files**: `packages/core/src/types/execution.ts` (`Execution.stopCause`, `flightLists`), `src/api-contract/{executions,datePairs}.ts`
(the execution response's `stop`, `estimatedFinishAt`, `flights`; `calendarStaleAfterHours` removed), `src/datePairs/{encode,decode}.ts`
and their tests; `packages/engine/src/{start,execute,run,stopCause,resume,orchestrator,engine,tick,boot,types}.ts`,
`src/stages/discovery.ts`, `src/scheduler/catchUp.ts` (`autoResume`), `src/alerts/marks.ts`, tests `test/{start,startFresh,stopCause,
stopWrites,execute,resume,tick}.test.ts`; `packages/db/drizzle/0011_wp20_flight_lists.sql` (whole), `drizzle/meta/{_journal.json,
0011_snapshot.json}`, `src/schema/{searchExecutions,flightLists,index}.ts`, `src/internal/read.ts`, `src/repositories/{executions,
definitions,airports}.ts`, `src/types.ts`, tests `test/{migration0011,migration0009,migration0010,barrel,client,definitions,airports,
latestParent,stopCauseWrites}.test.ts`; `apps/api/src/defaults.ts`, `src/routes/{definitions,searches,executions,system,index}.ts`,
`src/read/{cards,ranked,rows,executions,definitions,datePairs,results,history,statusSources,status}.ts`, `src/bootstrap/{app,engine}.ts`,
`packages/core/src/api-contract/index.ts` (`ROUTES`), tests as §7 plus `test/defaults.test.ts`; `apps/web/test/fixtures.ts` and
`test/fixtures.dates.ts` (the new execution fields; the retired map).
**Consumes**: Task 20.1. **Produces**: §5's engine stop cause, reader types, cancel cause, lane scope (`BrowserLease` is 20.9's); the
four routes; `runnableTotalsOf`; `rankedPairsFor`; `AirportsRepo.search(q, limit, country)`; `latestParentPerDefinition`; `restore`.

- [ ] **Write the failing tests.**
  - **First failing test (§16)**, `packages/engine/test/start.test.ts`: `startExecution` with a definition whose
    `enabled` is false and `opts.trigger === 'manual'` returns `{ ok: true }` and seeds the run; the same with
    `trigger: 'schedule'` returns `refused('disabled', …)` and seeds nothing. `requireCovered: true` with a stored
    confirmation of 100 p / 10 calls and a runnable estimate of 120 p (below `SOFT_CONFIRM_PENCE`) refuses `confirm`
    with `estimatePence 120` and `totalCalls`; the same with 100 p / 12 calls refuses on calls; without
    `requireCovered` the start proceeds (the existing rule); covered figures start on the first press.
  - `test/startFresh.test.ts` (Ian's ruling 1): a manual start with `replaceStopped: true` over a `paused_error`
    latest parent cancels it (status `cancelled`, `stopCause { kind: 'superseded', by: 'search-again' }`) and starts
    the new run, both inside one immediate transaction (the existing `replacePausedCatchUp` pattern: a failed insert
    rolls the cancel back); over an `interrupted` parent the same; over a `running` parent `refused('active')`;
    without the flag a paused parent still refuses `active`. `test/tick.test.ts` (extend): a scheduled firing whose
    definition has a `paused_error` parent with `resumeAfter` null (a manual run stopped while the search was
    unscheduled, the schedule added since) cancels it with cause `superseded 'schedule'` and starts the firing's run in
    the one transaction, never recording "schedule blocked since"; a paused parent with a future `resumeAfter` is
    resumed as today.
  - `test/stopCause.test.ts`: `stopCauseOf` maps each `StopReason` kind to its `StopCause`; for `all-disabled` it
    carries every entry of `run.disabledDetail` (skip, detail, until) and `searched` from `run.searchedDatePairs()`,
    stage from the reason; a budget stop carries scope, provider, unit (pages for camoufox `provider-*`, scrolls for
    `unit: 'scrolls'`, pence for cost scopes, calls otherwise), `resetsAt` from the breach's window end,
    `resumeAfter` null when `scheduled` is false or the scope is camoufox's `provider-month` or `provider-execution`,
    and `flights` from `run.flightLists` (null when the step did not run); a limiter-timeout carries its provider; a
    cancel's cause is the reason's own (`cancelled`, `superseded 'remove'`, `superseded 'stale'`); `searched` comes
    from `datePairSearched` over the run's roll-ups (one `empty` and three `not_run` on a date pair: not counted). A
    resumed camoufox-only pass whose provider was disabled by an earlier pass (seeded from the outcome rows' reason and
    `last_error` class) still yields one source, never an empty list.
  - `test/stopWrites.test.ts` and `packages/db/test/stopCauseWrites.test.ts`: an enumeration test over every
    status-writing path proves each stores a cause: `finalStatus` for every `StopReason` kind; `Orchestrator.cancel(id,
    cause)` for a live run (through `stopRun`) and for a stopped one (`cancelled` from the HTTP cancel, `superseded
    'remove'` from DELETE); `resume.ts`'s stale supersede (`superseded 'stale'`) and never-started cancel
    (`never-started`); `cancelPaused` for a catch-up replaced by its firing and the tick's supersede of a stopped
    manual run (`superseded 'schedule'`); `bootSweep`'s crash rows (`interrupted`, written by the UPDATE itself); the
    scheduler's `skipped_confirm` (with the two figures), `skipped_budget`, `skipped_window` and `skipped_missed` rows
    (a scheduled firing refused for no runnable provider writes no row today and still writes none: it is a notice
    only). `apply` clears `stop_cause_json` when the status becomes pending, running or completed; `CLAIM_RESUME_SQL`
    clears it; a run paused with a cause, resumed and completed reads NULL.
  - `test/execute.test.ts` (extend): a run whose only discovery provider's preflight refuses `provider_unavailable`
    ends `paused_error` with `stopCause.kind === 'sources-unavailable'`, `errorText` equal to the sentence of Task
    20.1's first row and `resumeAfter` null; a stub preflight whose detail is a vendor sentence holding the sentinel
    key is stored as its class word only (`detail` ∈ `STOP_DETAILS`), and neither the cause, `errorText` nor the api
    response contains the sentinel (test-010); a budget pause of a run of an unscheduled definition stores
    `resumeAfter: null` and `resetsAt` set, registers no one-shot job, and `autoResume` (called by `boot.ts`'s loop and
    the one-shot handler in `engine.ts`) skips it while resuming the same pause of a scheduled definition (Ian's
    ruling 2); a definition with `enabled` 1 and no cron is unscheduled for this rule (`isScheduled`); a camoufox
    `provider-month` pause of a **scheduled** definition also stores `resumeAfter: null` (never resumed; the next
    firing fetches the pages); a manual resume of a camoufox `provider-execution` pause is refused `cap` (so the
    sentence's Search again is the only path); a cancel stores `cancelled`.
  - `packages/db/test/migration0011.test.ts` (the pattern of `migration0009.test.ts`): seed a pre-0011 world through
    `migrationsWithout(['0011_wp20_flight_lists'])` (a definition, a paused execution with `error_text`, a completed
    one, calendar prices, a ledger row); apply; every row count and value is unchanged, the two columns are NULL on
    every existing row, the two tables exist with the columns below, `foreign_key_check` and `integrity_check` are
    clean; `applyMigrations(db, MIGRATIONS_DIR).applied` lists 0011 (0009's and 0010's expected lists gain it;
    `barrel.test.ts`'s `SPEC_TABLES`, repos key list and migration count and `client.test.ts`'s pending list grow);
    CHECKs: a `flight_lists` row with `provider_id 'searchapi'`, `source_kind 'synthetic'`, `cabin 'business'`,
    `currency_native 'EUR'`, a non-ISO `fetched_at`, a `point_of_sale` of `'gb'`, `status 'failed'` with `reason`
    NULL, `status 'read'` with a reason, `status 'read'` with `listed` NULL, a `reason` outside `STOP_DETAILS`, or
    `carriers_json` that is not a JSON array is `SQLITE_CONSTRAINT_CHECK`; a flight with `arrives_day_offset 4`,
    `duration_minutes 0`, `price_pence 478.5`, `stops -1` or `position -1` is refused; deleting a list deletes its
    flights. A `db:generate` after 0011 produces no diff (the snapshot matches the schema).
  - `test/latestParent.test.ts`: `latestParentPerDefinition` returns the newest parent (by `created_at`, then id) per
    definition, children and tool runs excluded, in one statement.
  - `test/definitions.test.ts` (extend): `softDelete` keeps `enabled`; `restore(id)` clears `deleted_at`, keeps the
    pre-delete `enabled`, sets `updated_at`, returns `'restored'`; `'live'` on a live row; `'tool-only'` on a
    definition whose executions are all `trigger 'tool'`.
  - `test/airports.test.ts` (extend): with two seeded rows named "Birmingham" (`QQA`, country `GB`, kind large,
    scheduled; `QQB`, country `US`, kind large, scheduled) `search('Birmingham', 20, 'GB')` lists `QQA` first,
    `search('Birmingham', 20, 'US')` lists `QQB` first, and `search('Birmingham', 20, null)` keeps today's order.
  - `apps/api/test/routes/cards.test.ts`: `GET /api/definitions/cards` returns cards in the order pending or running
    first (oldest start first), then by `latestRun.startedAt` descending, then never-run in creation order; a running
    card's `estimatedFinishAt` is now plus `engine.estimateRemaining(latestRun.id).seconds` for **each** running
    search (two concurrent runs each get their own); `datePairsSearched` counts the date pairs of the run's snapshot
    space that core's `datePairSearched` accepts over their roll-ups (a world of 4 airport pairs: one `priced` and
    three `not_run` counts, one `empty` and three `not_run` does not, as the page's key marks it), and
    `datePairsNeverSearched` those `datePairSearched` refuses in every run; `cheapest` is the board's first-ranked
    figure (through `rankedPairsFor`) with its full provenance and
    `stale` by `stalenessOf`, `fromLatestRun` false when fetched by an earlier run; `spaceChangedSince` is true after
    a PUT that widened the stay; a tool-run definition and a deleted one are absent; a paused run's `stop` is its
    stored cause's text; a pre-0011 row with `stop_cause_json` NULL and `error_text 'paused: error'` reads
    `NO_STOP_CAUSE_TEXT` and the response never contains `error_text`'s words (Review Focus 4; seeded through the
    migrated database); a `completed` row that was once paused has `stop` null; a `skipped_confirm` latest run
    carries its sentence.
  - `test/routes/createAndStart.test.ts`: a valid body creates the definition, stores `confirmed_cost_pence` and
    `confirmed_calls` equal to the body's values when they cover the server's recomputed `runnableTotalsOf` (the shown
    figures; a blocked paid line is not included), starts a manual run with `{ trigger: 'manual', confirmCostPence,
    confirmCalls, requireCovered: true }` and answers 201 `{ definition, executionId, refusal: null }`;
    a body whose values are below the recomputed runnable totals creates the definition, stores no confirmation and
    answers `refusal { code: 'confirm', estimatePence, totalCalls }` (sec-006); with no configured provider the
    definition is still created and the answer is `{ executionId: null, refusal: { code: 'disabled', … } }` (Review
    Focus 1); a `cap` refusal carries `resetsAt`; a camoufox-only body with `confirmCalls: 0` starts; a soft-confirm
    estimate starts on the first press when covered; a zero-cell window is 422 and creates nothing; the same
    `requestKey` sent twice, concurrently (the second arriving while the first is still estimating, held on a deferred
    estimate) or after the first settled, creates one definition and answers the first promise's result (200); a
    rejected first request evicts the key; a start that throws answers 201 with `refusal { code: 'failed' }` and the
    definition; the route is reachable (not shadowed by `/:id`).
  - `test/routes/executions.test.ts` (extend, end to end for Ian's ruling 1): `POST /definitions/:id/executions` with
    `{ replaceStopped: true, requireCovered: true, confirmCostPence, confirmCalls }` on a search whose latest parent is
    `paused_error` answers 202, the old run reads `cancelled` with `stop.sentence` "Replaced by a search you started."
    and the new run is running; without `replaceStopped` the same answers 409 `active`; both flags reach
    `engine.start`'s options (a spy).
  - `test/routes/restore.test.ts`: 200 with the live definition and its schedule re-registered when `enabled` and
    `scheduleCron` are set; 404 `definition_not_found` when not deleted or tool-only.
  - `test/routes/definitions.test.ts` (extend): `DELETE` on a definition with a running parent soft-deletes first
    (so no tick can start a run of it in the gap) and then cancels it through `Orchestrator.cancel(id, { kind:
    'superseded', by: 'remove' })` (status `cancelled`, that cause stored), on a paused parent likewise, and a tick
    fired between the two steps starts nothing; alert rules are untouched. `GET /api/providers` presets name every configured free source (`travelpayouts` with its token,
    `camoufox` with `CAMOUFOX_ENABLED` and the worker URL and key; never when `CAMOUFOX_ENABLED` is false), the paid
    rule unchanged, `scheduleCron: null`, `enabled: false`, no `arrivalWindowLocal` (`test/defaults.test.ts`).
  - `test/routes/newRoutesAuth.test.ts` (sec-001): with basic auth configured, `cards`, `create-and-start`, `restore`
    and (from Task 20.9) both `flight-lists` routes answer 401 without credentials; the POSTs answer 403 without
    `X-Requested-With: get-me-there`; cards carries no `error_text`, key, password or path (the redaction sweep).
  - `test/read/stale.test.ts` (every age below is a **fetch** age; a bounded price's effective age adds its own
    `maxAgeHours`): a camoufox list-mode row with stored `maxAgeHours` 0 fetched 1 h ago under refresh 168 is not
    stale; a row with stored `maxAgeHours` 24 under refresh 1 is not stale fetched 1 h ago (effective 25 against
    threshold 25, `isStale` is strictly greater) and stale fetched 2 h ago, while the provider's declared `maxAgeHours`
    is 0 (the old rule gave threshold 1); a row fetched 168 h ago under refresh 168 is not stale and at 169 h is
    stale, whichever run fetched it; a Travelpayouts row fetched 1 h ago with `providerObservedAt` 20 days ago **is**
    stale (prov-001); a verified-basis row is judged by `STALE_AFTER_HOURS` alone; `CALENDAR_STALE_AFTER_HOURS = 2`
    makes a row fetched 3 h ago stale with the mark "older than your stale setting" (the override wins outright); the
    date-pairs figures, `cheaperCached.stale`, `/results` rows, `history.ts`, `statusSources.ts` and the engine's
    alert marks all go through core's `stalenessOf` (one case each over the same list-mode row); the date-pairs
    response, its encoder and decoder and the web fixtures no longer carry `calendarStaleAfterHours`.
  - `test/read/ranked.test.ts`: `rankedPairsFor` equals the board's first rows for the same data (through
    `decodeDatePairs` + `rankDatePairs`), excludes pairs departing on or before today in London, and applies the
    definition's journey limit.
  - `test/bootstrap/sanityLive.test.ts` and `test/read/status.test.ts`: the boot airport check covers every live
    definition whatever `enabled` (an unscheduled search naming a code outside the table fails boot); a search's
    Status `data` card is judged by its latest run, states "not scheduled" as its note, and is `off` only when deleted
    (data-004).
  - `test/routes/executions.test.ts` (extend): `POST /definitions/:id/executions` on a disabled definition answers
    202; `GET /executions/:id` carries `stop`, `flights: null` and `estimatedFinishAt` (null when not pending or
    running); `test/api-contract/contract.test.ts` (core): `executionResponseSchema` accepts the three and refuses
    `flights` with `read + reused + failed > planned` or `ended 'gate'`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/engine exec vitest run test/start.test.ts test/startFresh.test.ts test/stopCause.test.ts test/stopWrites.test.ts test/execute.test.ts test/tick.test.ts`,
  `pnpm --filter @gmt/db exec vitest run test/migration0011.test.ts test/latestParent.test.ts test/definitions.test.ts test/airports.test.ts test/stopCauseWrites.test.ts`,
  `pnpm --filter @gmt/api exec vitest run test/routes/cards.test.ts test/routes/createAndStart.test.ts test/routes/restore.test.ts test/routes/newRoutesAuth.test.ts test/read/stale.test.ts test/read/ranked.test.ts`
  → `'disabled'` refusal on the manual start; missing modules, columns, methods and routes elsewhere.
- [ ] **Implement.** `start.ts:250` becomes `if (!def.enabled && opts.trigger === 'schedule')`; `requireCovered`
  compares the runnable estimate with the confirmation before `confirmationNeeded`; `replaceStopped` (manual) and a
  scheduled firing over a stopped parent both reuse `replacePausedCatchUp`'s transaction over a `paused_*` or
  `interrupted` latest parent; `routes/executions.ts` passes `requireCovered` and `replaceStopped` through.
  `finalStatus(stop, now, tz, run, scheduled)` computes the cause through `stopCauseOf` and patches `{ stopCause,
  errorText: stopText(…).sentence, resumeAfter }` for every non-null stop (the `fatal` message stays in the log),
  `resumeAfter` null when `!scheduled` or the cause is camoufox's monthly or per-run page limit; `scheduled` is
  core's `isScheduled` over the live definition, read at finish and in `autoResume`. `Lane.budgetOutScope` replaces
  the boolean. Migration 0011 columns: `flight_lists (id
  INTEGER PRIMARY KEY AUTOINCREMENT, definition_id TEXT NOT NULL REFERENCES search_definitions(id), execution_id TEXT
  NULL REFERENCES search_executions(id), provider_id TEXT NOT NULL CHECK (provider_id = 'camoufox'), source_kind TEXT
  NOT NULL CHECK (source_kind = 'scraped-self'), cabin TEXT NOT NULL CHECK (cabin = 'economy'), origin, destination
  TEXT NOT NULL (IATA GLOB), departure_date, return_date TEXT NOT NULL (date GLOB), fetched_at TEXT NOT NULL
  (isIsoTimestamp), point_of_sale TEXT NOT NULL (isPointOfSale), currency_native TEXT NOT NULL CHECK (currency_native =
  'GBP'), status TEXT NOT NULL CHECK (status IN ('read','failed')), reason TEXT NULL (isOneOf STOP_DETAILS, nullable),
  listed TEXT NULL (isOneOf LISTED, nullable), min_minor INTEGER NULL, tab_minor INTEGER NULL (isNullOrInteger, > 0),
  cheapest_view TEXT NULL, options_unparsed, options_other_cell INTEGER NOT NULL (isInteger, >= 0), results_stated
  INTEGER NULL, CHECK ((status = 'failed') = (reason IS NOT NULL)), CHECK ((status = 'read') = (listed IS NOT NULL)))`,
  indexes `flight_lists_cell_idx (definition_id, origin, destination, departure_date, return_date, cabin, point_of_sale,
  fetched_at DESC, id DESC)` and `flight_lists_execution_idx (execution_id)`; `flight_list_flights (list_id INTEGER NOT
  NULL REFERENCES flight_lists(id) ON DELETE CASCADE, position INTEGER NOT NULL (isInteger, >= 0), departs_local,
  arrives_local TEXT NOT NULL (HH:MM GLOB), arrives_day_offset INTEGER NOT NULL (isInteger, 0..3), duration_minutes
  INTEGER NOT NULL (isInteger, > 0), stops INTEGER NOT NULL (isInteger, >= 0), carriers_json TEXT NOT NULL CHECK
  (json_valid(carriers_json) AND json_type(carriers_json) = 'array'), operated_by TEXT NULL, price_pence INTEGER NOT
  NULL (isInteger, > 0), PRIMARY KEY (list_id, position))` (no `price_native_minor`: the list's `currency_native` is
  the stored fact behind `fx { converted: false }`). Declare both in `src/schema/flightLists.ts` with `checks.ts`'s
  helpers, add the two columns to `src/schema/searchExecutions.ts`, run `db:generate` for the journal entry and
  snapshot, then replace the SQL with the hand-written statements under 0010's "Do not regenerate" header. `ROUTES`
  gains the three entries; `HANDLERS` their handlers. `assembleCards` reads every live, non-tool definition once,
  `latestParentPerDefinition`, the date-pair buckets through `classifyCells` over each run's snapshot space, the
  cheapest through `rankedPairsFor`. `rows.ts`, `history.ts`, `statusSources.ts` and the engine's `alerts/marks.ts`
  call core's `stalenessOf` directly (the old `calendarThreshold` and its per-provider map go). `AirportsRepo.search`
  adds `country` as the first key inside a band (equal when null); `routes/system.ts` passes `config.pointOfSale`
  when it is a code. The create-and-start route recomputes the estimate (`engine.estimate`), compares the body's
  figures with `runnableTotalsOf` (unblocked lines only; `confirmationOf`'s doc comment gains the sentence that WP8's
  PUT path keeps the worst case while create-and-start and Repeat weekly store the shown totals), stores them only
  when they cover, then `engine.start` with the body's values and `requireCovered`; a refusal is answered in the
  body, never thrown; `requestKey` maps to the request's pending promise from the moment it arrives (a bounded map of
  the last 100, evicted on rejection), so a concurrent repeat awaits the same promise. Add `src/stopCause.ts` to
  `packages/engine/stryker.config.json`'s `mutate` (its test under the engine's mutate command), moving it from
  `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/api test` green at their thresholds;
  `pnpm -r typecheck`; `pnpm --filter @gmt/engine exec stryker run --mutate src/stopCause.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: manual runs ignore the schedule switch, fresh starts over stopped runs, a cause on every stop, search cards, create-and-start, restore and the per-price stale rule`.

### Task 20.3: `web`: nav, landing, the Searches view (cards), Search again's first press, Remove

**Files**: `apps/web/src/state/{view,landing,lastSearch}.ts`, `src/components/{Nav,StatusBar,PriceCell}.tsx`
(`DefinitionSelector.tsx` deleted), `src/App.tsx`, `src/copy.ts`, `src/views/Searches/{SearchesView,SearchCard,RemoveSearch}.tsx`,
`src/views/Dates/{SearchAgainButton,States}.tsx`, `src/api/{endpoints,queries}.ts`; tests `test/state/{landing,lastSearch}.test.ts`,
`test/views/searches/{view,card,remove,states}.test.tsx`, `test/views/dates/searchAgain.test.tsx` (the first-press cases),
`test/app/shell.test.tsx`, `test/components/statusBar.test.tsx`, `test/copy/*`; `apps/web/stryker.config.json`.
**Consumes**: Task 20.2's routes. **Produces**: §5's `ViewId`, `NAV_TIERS`, `lastSearch`, `SearchAgainButton` (first press).

- [ ] **Write the failing tests.**
  - `landing.test.ts` (extend): `?` → `searches`; `?view=unknown` → `searches`; `?view=dates&def=d1` → `dates` with
    `def` kept; `?view=dates` with no `def=` → `searches` whatever the number of searches (the orchestrator's ruling on
    design §8); `?view=definitions` without `edit=` → `searches`; `?view=definitions&edit=d1` → `definitions`; the
    WP19 cases (`calendar`, `duration`, `coverage`, `results` with and without a date pair, `row=`) unchanged.
    `lastSearch.test.ts`: `writeLastSearch` then `readLastSearch` round-trips; a throwing `localStorage` reads null.
  - `shell.test.tsx`: no definition selector anywhere; the nav's Decide tier lists "Searches", then the search last
    opened by its name (absent until a search's page has been opened; written by `DatesView` on mount and by a card's
    See dates), then "History"; Set up lists Providers, Alerts, Status and no "Searches"/"Definitions" entry; the
    current link carries `aria-current="page"`; every link ≥ 44 px; the Searches view renders only once
    `providerStatusKnown`, as the Dates view does.
  - `statusBar.test.tsx`: no "Run now" button on any view; the failing count still links to Status; the bar's run line
    for a paused run prints `stop.sentence` as-is and, with `stop` null and `reason` `'paused: error'` (a pre-0011
    row), prints `NO_STOP_CAUSE_TEXT.sentence`, never "paused: error" and never "Stopped: Stopped" (Review Focus 4).
  - `views/searches/view.test.tsx` (msw `searchesHandlers.ts` serving `GET /api/definitions/cards`; fake timers for
    `useNow` and `POLL_MS`): the main column lists one card per search **in the served order** (the api owns it; the
    order is kept while a mutation of this view is pending and changes only on the next settled read); each card
    shows the route ("Birmingham → Frankfurt" from the airports' cities, codes beside), the window ("10 Jan – 31 Mar";
    "10 Dec 2026 – 31 Mar 2027" when it crosses a year; "rolling: 182 days from 7 days ahead" for a relative window),
    the stay ("10–14 nights"), "repeats Mondays 05:00" only with a schedule, and its state line in `role="status"`:
    "Searching · 120 of 405 date pairs · about 1h 40m left" (running with `estimatedFinishAt`; without it, no "left"
    clause), "Reading flights · 3 of 10" (flights planned and read below planned while running), "Searched 2h ago",
    "Dates changed: 24 date pairs not searched yet" (`spaceChangedSince`), the stop sentence as-is with its fix as a
    line or button, "Not searched yet", and "85 of 405 date pairs never searched" whenever non-zero; the cheapest
    "£86 · 12 → 23 Jan" **always** through `PriceCell`'s compact face (source mark, short age, "not checked" on a
    calendar price, the stale mark) with "cheapest so far" while running, and nothing when `cheapest` is null; the red
    synthetic banner when any card's `cheapest.provenance` is fixture or synthetic; actions See dates
    (`?view=dates&def=<id>`, writing `lastSearch`), Search again, Edit (`?view=definitions&edit=<id>`), Remove
    (visually apart from Search again); the side column holds the form from Task 20.5 and, until then, a "New search"
    link to `?view=definitions`; at 375 px the side column renders above the list (`useMediaQuery`); with no search
    the column says "No searches yet"; the cards query refetches at `POLL_MS` only while a card is pending or
    running (advance `POLL_MS` − 1: no request; `POLL_MS`: one).
  - `views/searches/states.test.tsx`: cards loading (`LoadState`), cards error (`role="alert"` in plain words with
    Retry), a 500 from Remove, Search again and (from Task 20.5) Search now shown in words beside the action.
  - `searchAgain.test.tsx` (first press): `SearchAgainButton` posts `{ confirmCostPence: stored, confirmCalls: stored,
    requireCovered: true, replaceStopped: true }`; a 202 shows "Searching…" and invalidates cards and date pairs; a 409
    `active` reads "Already searching"; a free search within its stored confirmation starts on the first press; the
    button is disabled while the mutation is pending (the second-press flow is Task 20.5's).
  - `remove.test.tsx`: Remove shows an inline "Remove <name>? [Remove] [Keep]" (no `dialog` role), focus moving to
    Remove; on a pending or running search it reads "Cancel and remove <name>?"; Keep restores the actions and focus;
    Remove calls `DELETE /api/definitions/:id`, the card is replaced by a `role="status"` line "Removed <name>. [Undo]"
    with focus on Undo, kept for `UNDO_MS` (30 s, injected clock) whatever refetches happen, then gone; Undo calls
    `POST /api/definitions/:id/restore`, the card returns to its place with "repeats Mondays" intact when it had a
    schedule, and focus moves to its heading; the undo line survives a cards refetch at `POLL_MS`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/state test/app/shell.test.tsx test/components/statusBar.test.tsx test/views/searches test/views/dates/searchAgain.test.tsx` → `searches` is not a view; modules missing.
- [ ] **Implement.** `Nav` takes `searchName: string | null` and renders the `dates` entry only when it is a string
  (from `lastSearch` and the cards). `App` drops the selector; `def=` still selects the page's search. `StatusBar`
  loses `showRunNow`, `viewOwnsFirstRun` and `RunNowButton`; `States.tsx`'s never-run state uses
  `SearchAgainButton` (labelled "Search now" there) in the same commit. `PriceCell` gains `sourceLabel?: string`
  (Task 20.10 uses it). Copy keys: `COPY.nav.searches`, the card and state-line templates, `COPY.stopped` removed in
  favour of printing `stop.sentence`. `landing.ts` is the one mutated module this task changes.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test` green at 70% / 60%; `pnpm -r typecheck`;
  `pnpm --filter @gmt/web exec stryker run --mutate src/state/landing.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: searches as the first screen, nav and landing, search again, remove with undo`.

### Task 20.4: The estimate's covered date pairs, billed calls, monthly pages and soft-confirm reason

**Files**: `packages/core/src/api-contract/definitions.ts` (the estimate response's additions), `packages/engine/src/estimate.ts`,
`test/estimate.test.ts`; `apps/api/src/read/definitions.ts`, `routes/definitions.ts`, `test/routes/estimate.test.ts`;
`apps/web/test/fixtures.ts` (the estimate response fixture).
**Consumes**: Task 20.1's schemas. **Produces**: the estimate response's `datePairs`, `datePairsCovered`, `datePairsPartly`,
`datePairsReused`, `softConfirm`, `billedCalls`, `monthlyPages` (`flightLists` is Task 20.9's).

- [ ] **Write the failing tests.** `estimate.test.ts` (every expected number written out in the test from the layout
  rule, never read back from the plan): for the worked example (182 days × 12 stays × 4 pairs), `datePairs` is 2,184;
  with Travelpayouts month tiles (every cell planned) `datePairsCovered` is 2,184 and `datePairsPartly` 0; with
  camoufox list mode alone under a 100-page cap, `planSingleCells` takes the first 100 cells of generation order
  (origin, destination, day, nights), all on the first airport pair, so `datePairsCovered` is 0 and `datePairsPartly`
  is 100; with grid mode at the defaults, the planner's 7 × 7 blocks over 4 pairs (25 pages a pair, pages joining
  blocks first) give the numbers the test derives from `docs/scheduling.md`'s layout (5,152 of 8,736 cells read:
  the covered count is the date pairs every one of whose 4 cells is among them, the partly count the rest with any),
  stated as literals; a date pair counts as covered only when **every** in-scope airport pair of it is planned, as
  partly when some are, and as reused (`datePairsReused`) when every airport pair is reused (planned ∪ reused never
  counts a reused cell as asked); a fully reusable space (Search again a day after a full run) gives `datePairsCovered`
  0 and `datePairsReused` 2,184; a blocked camoufox line (monthly cap spent) contributes nothing; a camoufox line with
  40 monthly pages left is cut at 40; two providers' plans over the same 50 date pairs count 50, not 100.
  `test/routes/estimate.test.ts`:
  `softConfirm.reason` is `confirmationNeeded`'s reason for both `POST /definitions/estimate` and
  `POST /definitions/:id/estimate`, null for a free search within caps; `billedCalls` lists each runnable line of a
  billable-plan provider with its calls and the month's calls left (null without a cap); `monthlyPages` is `{ planned,
  left }` when camoufox is a runnable line, null otherwise.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/engine exec vitest run test/estimate.test.ts` → `datePairs` undefined.
- [ ] **Implement**: covered and partly over the distinct planned cells of runnable lines, each provider's plan cut
  at the lesser of its execution cap and its monthly window's remaining pages or calls; reused apart;
  `softConfirm` through `confirmationNeeded(ctx, estimate, blocked, { pence: null, calls: null })`.
- [ ] **Run to verify they pass**; **Commit**: `wp20: the estimate states its date pairs, billed calls, monthly pages and whether the press confirms it`.

### Task 20.5: `web`: the new-search form, Search now, Search again's second press, Edit

**Files**: `src/format.ts` (`parseDateText`), `src/views/Searches/{NewSearchForm,estimateLine}.ts(x)`,
`src/views/Definitions/{DefinitionsView,DefinitionForm,AdvancedFields,ScheduleField,draft}.ts(x)`,
`src/views/Dates/{SearchAgainButton,RepeatWeekly}.tsx`, `src/copy.ts`, `src/copy/{plan,setup}.ts`, `src/api/{endpoints,queries}.ts`;
tests `test/format/dateText.test.ts`, `test/views/searches/logic/estimateLine.test.ts`, `test/views/searches/{form,searchNow}.test.tsx`,
`test/views/dates/{searchAgain,repeatWeekly}.test.tsx`, `test/views/definitions/{create,form}.test.tsx`, `test/copy/sourceGuard.test.ts`.
**Consumes**: Tasks 20.2, 20.4. **Produces**: §5's `parseDateText`, `estimateLine`, the full `SearchAgainButton`, `RepeatWeekly`.

- [ ] **Write the failing tests.**
  - `dateText.test.ts` (pure, calendar arithmetic only; `apps/web/package.json`'s `test:tz` gains `test/format` and
    `test/views/searches` so it runs under both zones): `formatIsoDate('2027-01-10')` is
    "10 Jan 2027" (the existing helper, reused); `parseDateText(s, today = '2026-10-31')` accepts "10 Jan 2027",
    "10 january 2027", " 10 Jan 2027 ", "1 Jan 2027", "10 Sept 2027", "2027-01-10", and a year-less "10 Jan" or
    "Jan 10" as its next occurrence on or after today (`2027-01-10`; "31 Oct" is `2026-10-31`), echoed beside the
    field as "10 Jan 2027"; returns null for "10/01/2027", "31 Feb 2027", "29 Feb 2027", "10 Jan 27" and "Jan"; "29 Feb
    2028" parses; a round-trip property over every date of 2027 and 2028.
  - `logic/estimateLine.test.ts` (pure; `COPY` passed in; the formatter stubbed `p => '£' + (p / 100).toFixed(2)`):
    a free estimate of 9,000 s covering 405 of 405, unscheduled → line "About 2½ hours · free · asks about all 405
    date pairs", button "Search now"; 10,800 s, 120 p, 300 covered of 405, unscheduled → "About 3 hours · about £1.20 ·
    asks about 300 of 405 date pairs this run, the rest when you search again", button "Search now · about £1.20";
    the same with schedule `0 5 * * 1` → "…, the rest next Monday"; 20 partly → "… (20 on some airports only)"; 105
    reused → "… (105 reused from earlier runs)"; covered 0 and reused 405 → "Nothing new to ask: 405 date pairs
    reused from earlier runs";
    Travelpayouts the only runnable source → the line ends "· cached prices only where travellers searched recently";
    a SearchApi line of 120 calls at 0 µGBP with 9,880 left → no "free": "· uses about 120 of the 9,880 SearchApi
    searches left this month", button "Search now · 120 SearchApi searches"; `flightLists { pages: 10, seconds: 700 }`
    → " · + flights for up to 10 date pairs, about 12 minutes"; `monthlyPages { planned: 110, left: 1,400 }` → the
    note "uses about 110 of your 1,400 browser pages left this month"; a blocked SearchApi line → the note "Google
    Flights via SearchApi is not used: no calls left this month (about £3.40 not included)"; `softConfirm` with a cost
    reason → "This costs about £1.20, above your £1.00 check; pressing Search now confirms it", with a share reason →
    "This uses more than a fifth of this month's SearchApi searches; pressing Search now confirms it"; the line never
    contains "priced", "prices for", "all combinations" or "will find"; `covers` is the runnable totals. `aboutDuration`:
    30 → "under a minute", 720 → "about 12 minutes", 5,400 → "about 1½ hours", 9,000 → "about 2½ hours", 10,799 →
    "about 3 hours" (lower case; the sentence capitalises its first letter). `leftWords`: 6,000 → "about 1h 40m left",
    720 → "about 12m left", 30 → "less than a minute left".
  - `form.test.tsx` (fake timers; msw holding the estimate on a deferred promise and counting calls): the form shows
    From, To, Leave between (two text fields with "10 Jan 2027" placeholders), Stay min and max, and the Search now
    button; More options holds the journey limit (25 h), cabin, the rolling-window switch with "starts in N days" and
    "lasts M days", the sources (every free source ticked from `/api/providers`' presets, camoufox included when
    enabled), the name (suggested from the airports), the budget fields and the budget-fit table, each set-up term
    with its one-line explanation (ui-011); no arrival or departure window is pre-filled (the time fields are empty,
    labelled "only if you set one"); the estimate is requested `ESTIMATE_DEBOUNCE_MS` after the last change and never
    before (advance 399 ms: 0 calls; 400 ms: 1 call); from the first change until the estimate for the **current**
    draft arrives, the button is `aria-disabled` with the description "Working out the estimate…" and a press sends
    nothing; the estimate sentence sits in a polite live region; incomplete: "Enter From and To", "Enter the dates",
    "Enter the stay", "The shortest stay is longer than the longest", "The last date is before the first", each as the
    button's accessible description; "10/01/2027" gives "Enter the date as 10 Jan 2027" beside the field
    (`aria-invalid`, `aria-describedby`), the estimate handler's call count stays 0 past the debounce, and the button's
    description names "Leave between" (Review Focus 5); "10 Jan" echoes "10 Jan 2027" beside the field.
  - `searchNow.test.tsx`: a press sends `POST /api/definitions/create-and-start` with the draft, `confirmCostPence`
    and `confirmCalls` equal to the sentence's `covers`, a fresh `requestKey`, `scheduleCron: null`, `enabled: false`;
    the button is disabled while pending; on `{ executionId }` the URL becomes `?view=dates&def=<id>` (push, writing
    `lastSearch`); on `{ refusal }` the URL becomes `?view=dates&def=<id>&refused=<code>` and the page words each
    code: `disabled` → "No price source is set up, so nothing was searched" with "Set up a price source (Providers)"
    (Review Focus 1); `confirm` → the estimate sentence inline with "Search again · about £X" sending the refusal's
    figures; `cap` → "This month's limit is used up; it resets on <resetsAt>"; `window` → "Nothing to search: the
    dates have passed" with Edit; `shutting-down` → "The app is restarting; try again in a moment"; `failed` → "The
    search was saved but could not start" with Search again; never `refusal.message` (there is none); a 422 keeps the
    form with its field errors; a 500 shows "Couldn't save the search" beside the button.
  - `searchAgain.test.tsx` (second press): a 409 `confirm` with details `{ estimatePence: 120, totalCalls: 300 }` shows
    the estimate sentence inline, relabels the button "Search again · about £1.20", and the second press posts those
    values with `requireCovered` and `replaceStopped` and **no** PUT is sent (Ian's ruling 3); the sentence's "the
    rest …" clause follows the schedule.
  - `repeatWeekly.test.tsx`: "Repeat weekly…" opens the schedule fields pre-filled with the stored cron, else
    `DEFAULT_CRON`, in the configured time zone, with the estimate sentence and the monthly figure (budget fit, flight
    pages included) beside them, and sends **no** PUT; Save PUTs `{ scheduleCron, enabled: true, confirmedCostPence,
    confirmedCalls }` with the sentence's `covers` (the shown runnable totals: the schedule's confirmation, which
    scheduled runs then use; only `enabled: true` and the confirmation when the stored cron is kept) and the stored
    `confirmed_cost_pence`/`confirmed_calls` afterwards equal what the sentence showed (the route stores them through
    `runnableTotalsOf`'s rule, not the all-lines worst case); a 422 monthly-fit refusal is shown in words beside the
    fields; "Stop repeating" PUTs `{ enabled: false }`; a search whose latest run is stopped shows no warning here (the
    first firing supersedes it, Task 20.2).
  - `definitions/form.test.tsx` (edit): the form opened with `edit=<id>` shows the same estimate sentence and ends
    with "Save and search again · about £1.20" (the button carries the cost as Search now does) and "Save"; "Save and
    search again" PUTs then starts **that** id with `{ confirmCostPence, confirmCalls, requireCovered, replaceStopped }`
    from the sentence (never `def=`'s id), then opens `?view=dates&def=<id>`; a plain Save that changes the space
    opens the page reading "Dates changed: N date pairs not searched yet · Search again".
  - `sourceGuard.test.ts`: `views/Searches/estimateLine.ts` is in the money-formatting allowlist and formats through
    the estimate panel's formatter only.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/format test/views/searches test/views/dates/searchAgain.test.tsx test/views/dates/repeatWeekly.test.tsx test/views/definitions` → modules missing; the old "Show estimate" assertions fail.
- [ ] **Implement.** `NewSearchForm` builds a `Draft` from `defaultDraft(presets)`; `useEstimateDraft` debounces and
  keys the estimate by the draft it was fetched for; the sentence comes from `estimateSentence`. `DefinitionForm`
  keeps More options and gains the two buttons for `edit=`. `routes/definitions.ts`'s PUT stores a sent confirmation
  that covers `runnableTotalsOf` (the Repeat weekly Save) as it stores one covering the worst case today. Add
  `src/format.ts` and `src/views/Searches/estimateLine.ts` to `apps/web/stryker.config.json` (`test/format` and
  `test/views/searches/logic` join its mutate command) and move them from `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm -r typecheck`; `pnpm --filter @gmt/web run test:tz`;
  `pnpm --filter @gmt/web exec stryker run --mutate src/format.ts,src/views/Searches/estimateLine.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: the new-search form, search now, search again's confirmation and save-and-search-again`.

### Task 20.6: `web`: a search's page (header line, searching, reading and stopped lines, words, the month key)

**Files**: `src/views/Dates/{DatesView,DatesHeader,States,SearchedLine,StoppedLine,Legend,OverviewMonth,overview,stateLines}.ts(x)`,
`src/components/PriceCell.tsx` (the stale mark's words), `src/copy.ts`, `src/api/queries.ts`; tests
`test/views/dates/{stateLines,stopped,header}.test.tsx`, `test/views/dates/logic/{stateLines,overview}.test.ts`,
`test/copy/{catalogue,renderedSweep}.test.ts(x)`.
**Consumes**: Tasks 20.2, 20.3. **Produces**: `searchedLine`, `stateLine`, `reducedMark`.

- [ ] **Write the failing tests.**
  - `logic/stateLines.test.ts` (`COPY` passed in): a finished run 09:12–11:41 today whose buckets give 300 date
    pairs priced, 20 showed no price, 60 not searched, 20 not reached, 5 couldn't be read, 120 reused, sources from
    the run's outcomes `camoufox` → "Searched today 09:12–11:41 · 300 of 405 date pairs priced, 20 showed no price,
    60 not searched, 20 not reached, 5 couldn't be read (120 reused from earlier runs) · the browser worker"; clauses
    at zero are omitted; yesterday → "Searched yesterday …"; older → "Searched 12 Mar …"; two sources → "the
    Aviasales cache and the browser worker"; the line never implies completeness ("all" and "every" absent).
    `stateLine`: running with `estimatedFinishAt` → `{ kind: 'searching', text: 'Searching · 120 of 405 date pairs ·
    about 1h 40m left' }`; running with `flights { planned: 10, read: 3 }` after discovery → `{ kind: 'reading', text:
    'Reading flights · 3 of 10 date pairs · about 8m left' }`; completed → `searched`, only once the flights step is
    done; stopped → `{ kind: 'stopped', text: <stop.sentence> }` plus "0 of 405 searched" when nothing was searched
    (`datePairSearched` over the run's buckets, the same count as the card and the key), and the page's counts never
    read "0 error" for it; a finished run whose `flights` has `read + reused < planned` never reads a bare
    "Searched": `ended 'window'` → "… · flights read for 4 of 10 date pairs; the rest were left: outside this run's
    browser window", `'monthly-cap'` → "…; the rest were not read: the browser worker's monthly page limit",
    `'stopped'` → "…; the rest were not read: a limit for this run", `'disabled'` with planned 0 → "… · flights not
    read: the browser worker was paused for this run"; `spaceChangedSince` → `changed`; no run → `never`. `readAt`:
    today → "11:44", yesterday → "yesterday 11:44", older → "12 Mar 11:44".
  - `header.test.tsx`: the header shows route, window and stay in words (dates as "10 Jan 2027"), the line above, and
    the actions Search again, Edit, Repeat weekly… (or "Repeats Mondays 05:00 · Change"); the jargon sweep over the
    rendered page, the Edit page and its More options in every state (never run, running, reading, searched, each
    stop kind, each refusal code) finds none of "definition", "cells", "discovery", "hard stop", "verdict class",
    "tile", "retry factor", "STALE", "calendar basis", "itinerary", "Camoufox" outside provenance notes; the board's
    basis labels read "from Google's date grid" / "checked fares"; the stale mark reads `staleMarkText`'s words; the
    set-up terms that stay in More options each have their one-line explanation.
  - `stopped.test.tsx`: a paused run with `stop` renders the sentence as-is and its fix as a button or line (Resume
    when the fix names Resume, Search again otherwise, both when it names both, a `pnpm` command in a `code` element in
    native mode); a run with `stop` null (pre-0011, `error_text` set or not) renders `NO_STOP_CAUSE_TEXT.sentence`
    and never "paused: error" nor the stored text (Review Focus 4); `?refused=<code>` renders Task 20.5's words for
    each code; a never-run search naming no source reads "No price source is set up" from its own data; Cancel sits
    beside the searching and reading lines while running; while running, the board lists the date pairs priced so far
    under "partial: still searching" and the overview marks the rest not searched (persona-001).
  - `logic/overview.test.ts` (extend): the overview's marks are core's `reducedMark` (imported, not re-implemented:
    `priced → priced`, `empty | no_data → no-price-shown`, `error → couldnt-read`, `skipped → not-reached`, `not_run →
    not-searched`); a date pair's mark comes from the §6.6 precedence bucket over its airport pairs (one `empty` and
    three `not_run` is `not-searched` with the striped overlay, never `no-price-shown`, and the header's and card's
    counts agree because all three use `datePairSearched`); each mark has a distinct glyph in `data-mark` and its words in
    the cell's accessible name (an error cell says "couldn't be read"); the legend lists the five marks with counts,
    "darker is cheaper", "striped: partly not searched", "each dot is one stay length", the detail under "no price
    shown" naming its parts ("12 no fares, 3 no cached data"); "not checked" stays; no mark reads "no flights".
  - `catalogue.test.ts` and `renderedSweep.test.tsx`: samples for every new copy key; the `searches` landmark.
  - `header.test.tsx` (second concurrent run, fake timers): a search whose latest run is not the status bar's active
    one (an older run of another search is in flight) still sees its searching line and `estimatedFinishAt` advance
    at `POLL_MS` through `useLatestRun` (its own `useExecution` poll); when it is the active one, no second request is
    issued (the status bar's query is shared).
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates test/copy` → missing modules and keys.
- [ ] **Implement.** The page observes its latest run through `useLatestRun(latestRun.id, activeId)` and reads
  `estimatedFinishAt` from it. The old `COPY.paused` and the `statusName` fallbacks (`StatusBar.tsx:280`,
  `DatesHeader.tsx:44`, `DatesView.tsx:282`) are deleted. Add `src/views/Dates/stateLines.ts` to the Stryker list and
  move it from `pending`.
- [ ] **Run to verify they pass**; `pnpm -r typecheck`;
  `pnpm --filter @gmt/web exec stryker run --mutate src/views/Dates/stateLines.ts,src/views/Dates/overview.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: a search's page says what happened in plain words`.

### Task 20.7: `core` protocol and contract, `camoufox-worker` capture, `providers` capability

**Files**: `packages/core/src/camoufox/{protocol,url}.ts`, `src/flights/{limits,types,index}.ts`, `src/api-contract/flights.ts`,
`src/ports/provider.ts`, `src/labels/source.ts`, `src/results/searchLink.ts`, `src/index.ts`; `apps/camoufox-worker/src/{names,flights,
session,server,url}.ts`, `apps/camoufox-worker/stryker.config.json`; `packages/providers/src/camoufox/{flights,provider,answer}.ts`;
tests `packages/core/test/camoufox/{flightsProtocol,url}.test.ts`, `test/api-contract/flights.test.ts`,
`apps/camoufox-worker/test/{flights,flightsRecorded,names,server,session,recorded}.test.ts`,
`packages/providers/test/camoufox/flightList.test.ts`, `packages/core/test/results/searchLink.test.ts`.
**Produces**: §5's protocol, contract, worker and provider items.

- [ ] **Write the failing tests.**
  - `flightsProtocol.test.ts`: `flightsRequestSchema` accepts the list request's fields with `mode: 'flights'` and
    refuses `mode: 'list'`; `listRequestSchema`'s existing tests stay green; the `flights` answer accepts 30 flights
    and refuses 31, a `departsLocal` of "24:00", an `arrivesDayOffset` of 4, `carriers: []`, a carrier holding a
    control or bidi character, `listed 'flights'` with `flights: []`; `ANSWER_STATUS.flights === 200`;
    `pageRequestSchema` still refuses a flights request. `url.test.ts`: core's `pageUrl` is byte-equal to the worker's
    former output for the worked cell. `searchLink.test.ts` (extend): the camoufox case equals `pageUrl(…, gl)` with
    `gl` from the point of sale (`'unknown'` → `GB`), host `www.google.com`, label `SEARCH_LINK_LABEL`, and a synthetic
    cell still gives null. `api-contract/flights.test.ts`: `flightListSchema` refuses `status 'read'` with `listed`
    null, `status 'failed'` with `reason` null, a `reason` outside `STOP_DETAILS`, a link whose url is not `https://`
    or whose host is not `www.google.com`, a `pairs` string of 51 pairs.
  - `names.test.ts` (extend; the recorded suites stay green): `parseOptionName` of the inline worked name (synthetic,
    marked so) returns `departsAt`, `arrivesAt` and `arrivesOn` equal to the times and date that name states; a name
    whose leg sentence lacks a time still parses with the three fields null (the groups are optional, so list mode
    cannot regress); `GRAMMAR_VERSION` is `'2026-10-31-times'`. `recorded.test.ts` (extend, recorded-guarded): list
    mode over every recorded results page gives the same `optionsUnparsed`, `minMinor` and counts as before this
    change; the expectations are captured **first**, by running the existing suite on `main` before `names.ts` is
    touched, written into the test as literals per recording and committed, and only then is the grammar changed.
    `flightsRecorded.test.ts` (recorded-guarded): every recorded option yields `departsAt` and `arrivesAt` matching
    `/^([01]\d|2[0-3]):[0-5]\d$/` and a `dayOffset` in 0..3; `flights.length` equals `min(30, the cell's parsed
    options)`, and `flights.length + optionsUnparsed + optionsOtherCell + the options dropped past 30` equals the
    page's option count; every flight is accepted by `listedFlightSchema`.
  - `flights.test.ts`: `dayOffset({11,5},{11,5},'2027-11-05')` is 0; `{11,6}` is 1; `{1,1}` from `'2026-12-31'` is 1;
    `{11,4}` is null; `{11,9}` is null. `splitCarriers('British Airways, American Airlines and Finnair')` is three
    names, trimmed. `readFlights` over facts of 35 options for the cell (one of them cheapest at position 31), 2 for
    another day and 1 unparsable keeps the **30 cheapest** in page order, `listed 'flights'`, `optionsOtherCell 2`,
    `optionsUnparsed 1`, `minMinor` the minimum over **every** parsed option of the cell (the list read's own rule, so
    the position-31 price), `tabMinor` and `cheapestView` as `readList` gives them, each flight carrying `amountMinor`
    in pence (47,800 for "478 British pounds"), `durationMinutes`, `stops` (0 for "Nonstop"), `carriers`,
    `operatedBy`, `arrivesDayOffset`; an option whose `dayOffset` is null, or whose fields fail
    `listedFlightSchema.safeParse` (a 120-character `operatedBy`), counts in `optionsUnparsed` and the others survive;
    a page with Google's own no-flights line gives `listed 'no-flights'` and `flights: []`; a page whose options are
    all for other days gives `listed 'none-for-cell'`; a page whose cell options are present but **all** fail to parse
    gives `listed 'none-for-cell'` with `optionsUnparsed` = their count and `flights: []` (never `'flights'` with an
    empty list, which the schema refuses); whitespace is collapsed and control characters refused.
  - `server.test.ts` (extend): `POST /v1/flights` answers 200 `kind: 'flights'` for a valid body, 400 for a list
    body, 401 without the key, a body above 4,096 bytes refused as `/v1/page`'s is; the contacted header exactly as
    `/v1/page`'s. `session.test.ts` (extend): a flights page runs the grid gate (skipped), the cool-down check, the
    monthly admission, the pacer claim and the monthly write before the load (the existing order assertion extended);
    a second request during a page answers `spacing`; a non-GBP page is `blocked` `unrecognised` rule `currency`; the
    Cheapest flow's fall-back and no-options-read branches behave as in list mode.
  - `flightList.test.ts` (msw, as `fetchTile.test.ts`): `camoufoxProvider(o).flightLists.read(q, ctx)` posts a
    flights request to `/v1/flights` with `endpointPath: FLIGHT_LIST_ENDPOINT_PATH`, `executionId: ctx.executionId`,
    `tileIndex: null`, the query's `airportNames` and the adapter's own `gl`; a query without airport names fails
    closed with `list-error` `no-airport-names` before any request; a `flights` answer maps to `{ kind: 'list', … }`
    with every field; `monthly-cap` throws `BudgetExceeded` at `provider-month` with `counter: 'worker'`; `blocked`,
    `cooling-down`, `spacing`, `browser-error`, `not-ready` and 401 map through `classifyWorkerAnswer` to
    `list-error`; `CAMOUFOX_FLIGHT_LIST_INFO` has `sourceKind 'scraped-self'`, `maxAgeHours 0`, and its
    `provenanceNote` is the text below; the sentinel key never appears in the answer or the error; the fixture
    provider exposes no `flightLists`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/camoufox test/api-contract/flights.test.ts test/results`,
  `pnpm --filter @gmt/camoufox-worker exec vitest run test/flights.test.ts test/names.test.ts test/server.test.ts test/session.test.ts`,
  `pnpm --filter @gmt/providers exec vitest run test/camoufox/flightList.test.ts` → missing schemas, fields and route.
- [ ] **Implement.** `names.ts` adds optional groups `(?: at (?<departsAt>[0-9]{1,2}:[0-9]{2}))?`, the same for the
  arrival, and `(?<arrivesMonth>…) (?<arrivesDay>…)` through `MONTHS` (times normalised to `HH:MM`). `readFlights`
  reuses `readList`'s cell filter and minimum, then keeps the 30 cheapest. `PageSession.page` takes `mode 'flights'`
  and branches at the reader; `/v1/flights` admits only that mode. The provenance note: "Google Flights flight list via
  Camoufox: the outbound flights Google Flights listed for this day pair, each with the lowest round-trip total Google
  listed with that outbound (its "From" price; the return flight is neither chosen nor read), when this app's own
  Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in
  the currency the page states. Times are the page's local times. Flight numbers, seller and baggage are not read;
  nothing is checked with the airline." The answer's size is a bound: at most about 25 KB at the schema's limits;
  http-kit accepts 10 MB; the request stays under the worker's 4,096-byte cap. The adapter uses the provider's one
  http-kit timeout (there is no per-request timeout; in grid mode the grid's bound applies, which is longer, never
  shorter). `protocol.ts`'s header comment names `/v1/flights`. Add `src/flights.ts` to
  `apps/camoufox-worker/stryker.config.json` and move it from `pending` to `mutate`.
- [ ] **Run to verify they pass**; the worker's recorded suites (local recordings) green; `pnpm --filter @gmt/camoufox-worker test`,
  `pnpm --filter @gmt/providers test` at their thresholds; `pnpm --filter @gmt/camoufox-worker exec stryker run --mutate src/flights.ts,src/names.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: the browser worker returns the flights on a list page; the flight-list capability`.

### Task 20.8: `db`: the flight-list repository and the budget guard's endpoint split

**Files**: `packages/db/src/repositories/{flightLists,ledger}.ts`, `src/budgetGuard.ts`, `src/repos.ts`, `src/index.ts`;
tests `test/flightLists.test.ts`, `test/budgetGuard.test.ts`, `test/ledger.test.ts`.
**Consumes**: Tasks 20.2 (tables), 20.7 (`ListedFlight`). **Produces**: `FlightListsRepo`, the guard's split.

- [ ] **Write the failing tests.** `flightLists.test.ts`: `insert` writes the list and its flights in position order
  in one transaction (a refused flight rolls the list back); `insert` with `providerId 'fixture'` or `sourceKind
  'synthetic'` is refused by the repository before SQL (and the CHECK refuses it when forced); `newestPerCell`
  returns the newest list per requested cell in request order, in one statement (the WP19 statement counter), for
  the given point of sale only, and nothing for a cell never read; an `LHR→JFK` list is not returned for `LGW→EWR` on
  the same dates; a `read` list newer than a `failed` one wins and the reverse too (the page shows the newest);
  `newestPerDatePair` returns, per date pair, the newest list of any airport pair inside the given space;
  `forExecution(id, planned)` counts the newest row per planned cell of that execution (a pair read twice counts
  once); an on-demand list has `executionId null`. `budgetGuard.test.ts` (extend): with `flightListPages: 10` in the
  snapshot, ten `/v1/flights` page rows pass and the eleventh throws `provider-execution`; 100 `/v1/page` rows and 0
  flight rows let a `/v1/flights` reserve pass; the `/v1/page` cap ignores `/v1/flights` rows; `usage({ kind:
  'provider-execution' })` reports grid pages against the page cap and, as a second entry, flight pages against
  `flightListPages`; a snapshot **without** `flightListPages` refuses the first `/v1/flights` reserve (cap 0,
  fail-closed); a reserve with `executionId: null` and `/v1/flights` is checked at `provider-month` only; flight
  pages count against `execution-free-calls`. `ledger.test.ts`: `countsFor` classifies `/v1/flights` rows as their
  own `flight-list` line, never `verification`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/db exec vitest run test/flightLists.test.ts test/budgetGuard.test.ts test/ledger.test.ts`.
- [ ] **Implement.** The split lives in `providerExecutionRows` (one predicate on `endpoint_path`, keeping the
  `page_class IS NOT 'no-page'` filter on both halves), so `checkCaps` and `usage` share it.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/db test` ≥ 85% / 70%. **Commit**: `wp20: flight-list repository and the page allowance in the budget guard`.

### Task 20.9: `engine` and `api`: the flight-list step, its gate, allowance, reuse, resume and error table; the browser lease; the on-demand read; the endpoints

**Files**: `packages/engine/src/stages/flightLists.ts`, `src/stages/flightLists/select.ts`, `src/{flightRead,browserLease}.ts`,
`src/{execute,estimate,snapshot,types,engine}.ts`, `src/stages/discovery.ts` (the lane waits for the lease), `test/support/harness.ts`,
`packages/engine/stryker.config.json`; `apps/api/src/routes/{flightLists,index}.ts`, `src/read/{flightLists,executions,links}.ts`,
`src/tools/smokeCamoufox.ts` (the point of sale to `searchLinkFor`), `src/bootstrap/engine.ts`, `packages/core/src/api-contract/index.ts`
(`ROUTES`); tests `packages/engine/test/stages/{flightLists,
flightListsSelect,flightListsResume}.test.ts`, `test/{flightRead,browserLease,estimate}.test.ts`, `apps/api/test/routes/flightLists.test.ts`.
**Consumes**: Tasks 20.7, 20.8. **Produces**: §5's engine and api flight items.

- [ ] **Write the failing tests.**
  - `flightListsSelect.test.ts` (pure): 15 ranked pairs → `read` is the first 10; a pair whose newest list for the
    **same cell** is `read` and 150 h old under refresh 168 (0.9 × 168 = 151.2) is `reused`, at 152 h it is `read`;
    a newest list for another airport pair of the same dates does not count; a newest `failed` list of any age is
    `read`; a pair departing on or before `todayLondon` is dropped; `read.length + reused.length ≤ 10`; the order is
    the ranking's (property: output ⊆ the first 10 after dropping departed pairs, in order); `cellKeyOf` is
    `cellKeyString`.
  - `browserLease.test.ts`: `hold(done)` succeeds once and returns false while `done` is pending; `inFlight()`
    follows it; `whenFree` resolves when `done` settles and rejects on the signal.
  - `flightLists.test.ts` (the engine harness with a stub `rankedDatePairs` option and a stub `flightLists`
    capability driven by deferred promises): after discovery, the step runs when the predicate holds (`run.stop ===
    null`, or the only stop is camoufox's `provider-execution` budget stop; never a catch-up, a child, a lane with
    `windowOut`, a lane whose `budgetOutScope` is `provider-month`, `provider-lifetime` or `global-month`, camoufox
    disabled, a resumed pass whose camoufox is among `browserLeftAtResume(exec).providers`, a snapshot without
    `flightListPages`, a non-economy cabin, or no `rankedDatePairs` option), calling the reader with the run's
    snapshot space, cabin, journey limit and now; a camoufox + Travelpayouts run whose camoufox lane hit
    `provider-execution` (no run stop, Travelpayouts completes) still reads 10 flight pages and ends `completed`,
    while the same lane at `provider-month` sends none; it reads the selected pairs one at a time (concurrency 1) with
    `FlightListQuery.cell` = the figure's airport pair and `airportNames` built from `airportNamesOf`, `ctx.executionId`
    the run's, `ctx.signal` = `run.controller.signal` (after a `provider-execution` stop the stub still receives a
    **non-aborted** signal, since `run.intake` and the lane's intake are already aborted and the step watches neither),
    and the step's own gate before each page; it writes `flight_lists_json { planned, cells, reused, ended: null }`
    once, before the first page, only when at least one cell was selected; each answer writes one row (`read` with
    every field, `failed` with the reason word); verification then runs. A camoufox-only run paused `paused_budget` at
    `provider-execution` after 100 grid pages still reads its 10 flight pages, stays `paused_budget`, and its cause
    carries `flights { read: 10, planned: 10 }` (Review Focus 3; the step runs before `finish`); with 10 `/v1/flights`
    ledger rows already seeded for the execution, the next page is refused at `provider-execution` before any
    capability call (call count and ledger unchanged), the pair and the rest are `failed` reason `execution-cap`,
    `ended 'stopped'`, and the status is unchanged; a Cancel during that step (after the grid-cap stop) ends the run
    `cancelled` with cause `cancelled`, and a SIGTERM there ends it `interrupted` (`run.flightStop` wins over the
    budget stop in `finish`). The error table, one test per row, none of which calls discovery's `onFailure`, changes
    an outcome, the run's status or a notice except as stated:
    | the page's result | the pair | the rest | the step |
    |---|---|---|---|
    | `BudgetExceeded` any scope (`monthly-cap`, guard-side `provider-month`, `execution-free-calls`, `provider-execution`) | `failed` reason `monthly-cap` / `free-call-cap` / `execution-cap` | `failed` with the same reason, no request sent | ends, `ended 'monthly-cap'` or `'stopped'` |
    | `list-error` `blocked`, `provider-unavailable`, `auth`, `quota` | `failed` reason the kind | `failed` the same, no request | ends; a blocked answer also disables camoufox for the run and sends the once-per-cool-down notice as discovery does |
    | `list-error` `limiter-timeout` | `failed` reason `limiter-timeout` | `failed` the same | ends, never pausing the run |
    | `list-error` `parse`, `upstream`, `network`, `rate-limit` | `failed` reason the kind | continue | continues |
    | gate abort (the step's own `flightPageGate` finds the window closed or a suspension, while not cancelling) | no row | no row | ends, `ended 'window'`; the run's status unchanged, never `cancelled`; no discovery cell marked, no notice pushed |
    | cancel or SIGTERM during a page | no row (as an aborted tile writes no outcome) | no row | the stop propagates (or `run.flightStop` when a budget stop stands) |
    A catch-up, a child, a run whose discovery lane went `windowOut`, and a run with `flightLists` from a provider
    other than `camoufox` send no flight page; a run naming camoufox whose preflight disabled it stores no
    `flight_lists_json` and its execution response reads `flights { planned: 0, …, ended: 'disabled' }` (derived, never
    null); the step counts its 10 pages toward `execution-free-calls` (a `maxFreeCalls` of 105 after 100 grid pages
    lets 5 flight pages through, then `free-call-cap`).
  - `flightListsResume.test.ts`: a run interrupted after 4 of 10 pages (SIGTERM) and auto-resumed (scheduled
    definition) keeps `planned` and `cells` fixed, reads only the planned cells with no row of this execution (6
    more), skips a planned cell whose departure is on or before today in London (no row; the counts still satisfy
    `read + reused + failed ≤ planned`), writes no duplicate pair, ends with `forExecution` read + failed + reused ≤
    planned, 10 `/v1/flights` ledger rows at most, and the response parses; a retry-errors resume of a `completed`
    run re-reads nothing; a one-shot resume past the run's browser window (camoufox among `browserLeftAtResume`'s
    providers) reads no flight page and keeps `ended 'window'`; a pass whose preflight had disabled camoufox
    (`paused_error`, worker down), then a manual Resume with the worker up, runs the grid and reads 10 flight pages
    (no stored plan froze it).
  - `flightRead.test.ts` (`readFlightList` returns `{ ok: true, done }`; the stub capability on a deferred promise):
    `busy` while a parent run naming camoufox is `pending` or `running` (Review Focus 2), while another read is in
    flight, and never for a Travelpayouts-only run — asserted before any capability call and with the ledger
    unchanged; `not_available` when the definition does not name camoufox, it is not configured, or the cabin is not
    economy; `fresh` when the newest list for the figure's cell is `read` and younger than 0.9 × refresh; `outside_space`
    for a departed or out-of-space pair; `no_price` when the pair has no figure; otherwise the read holds the browser
    lease, runs the camoufox discovery preflight first (a refusal records `failed` with its detail), ignores
    `CAMOUFOX_BROWSER_WINDOW` (its own anchor, like a manual start), and writes a row with `executionId null`,
    `tileIndex null`; `flightReadInFlight()` names the pair while `done` is pending and is null after it; the busy
    query and `lease.hold` run with no await between them (a start admitted in the same turn sees the lease held); a
    throw inside the read records `failed` reason `fatal` and clears the mark; shutdown during a read aborts it
    through `lifecycle.abort`, awaits `done` within the drain, and writes nothing after `closed`; a run that goes
    `pending` while a read is in flight waits on `whenFree` before its first camoufox page (the grid lane's first page
    starts only after `done`), and a Resume whose grid has no cells left waits the same way before the flight step's
    first page.
  - `estimate.test.ts` (extend): with camoufox in discovery, `flightLists` is `{ pages, seconds }` with `pages =
    min(10 − reusable pairs, the monthly pages left after the grid plan, maxFreeCalls − the grid plan's free calls −
    the other free providers' calls)` and `seconds = pages × (minSpacingSeconds + 40)` (700 at the defaults), carried
    through `totalsOf`, `withBlocked`, `addPass` and `estimateRemaining` (which counts the planned cells with no row
    yet), so `seconds` and the browser window's end include it while `totalCalls` does not; `confirmationNeeded`'s
    camoufox calls and `budgetFit`'s monthly pages include the flight pages (a monthly cap of 500 with a 100-page grid
    run and 10 flight pages trips the 20% share); `assumptions` gains "+ flights for up to N date pairs, about M
    minutes", "flights for 4 date pairs: the browser worker's monthly page cap" when that cap binds, and "flights for 5
    date pairs: the run's free-call limit" when `maxFreeCalls` 105 binds after 100 grid pages (the step's own cap,
    Review Focus 3's sibling); without camoufox, `flightLists` is absent (the stored shape has no key).
  - `apps/api/test/routes/flightLists.test.ts`: `GET /api/definitions/:id/flight-lists?pairs=2027-03-14_2027-03-24,2027-03-15_2027-03-25`
    returns one entry per pair in order with the figure's airport pair, `list` = the newest list for that cell, cabin
    and point of sale (full provenance, `ageHours`, `stale` when older than the camoufox refresh), `listOtherPair` when
    only another airport pair of the current space has a list, `link` from `searchLinkFor('camoufox', cell, cabin,
    pointOfSale)` through `safeSearchLink` (null for a synthetic figure), `available`, `unavailableReason`,
    `refreshHours`, `monthlyPagesLeft`; a malformed pair, 0 pairs or 51 pairs is 422 `invalid_pairs`; `POST` answers
    202 `{ accepted: true }` and `GET` then reports `reading`; `busy` is 409 `browser_busy`; `fresh` 409; `not_available`
    409 with its reason; `outside_space` and `no_price` 422; `GET /executions/:id` reports `flights { planned: 10, read:
    8, reused: 1, failed: 1, ended: null }`; the auth and write-header cases of `newRoutesAuth.test.ts`; the redaction
    sweep covers `reason` and the lists.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/engine exec vitest run test/stages test/flightRead.test.ts test/browserLease.test.ts test/estimate.test.ts`,
  `pnpm --filter @gmt/api exec vitest run test/routes/flightLists.test.ts`.
- [ ] **Implement.** `runFlightLists` is its own module with its own error mapping (the table), its own intake and
  `flightPageGate` (which reuses `browserWindow()` and the heartbeat's suspension mark and throws `AbortedError`
  only), never routing through `onFailure`, `pageGate`'s `leaveLane` or the shared budget handler; it runs after
  discovery and verification and before `finish`, restricts itself to `providerId === 'camoufox'`, and records a
  cancel or SIGTERM that arrives while a budget stop stands in `run.flightStop`, which `finish` prefers.
  `snapshotBudget` writes `flightListPages: FLIGHT_LIST_COUNT` when camoufox is in discovery and strips it from the
  definition's own budget. `discovery.ts`'s camoufox lane and the step both await `lease.whenFree` before a page.
  `bootstrap/engine.ts` passes `rankedDatePairs: (q) => rankedPairsFor(ports, q)`; `read/links.ts`'s `safeSearchLink`
  and `tools/smokeCamoufox.ts` now pass the install's point of sale to `searchLinkFor`. Add
  `src/stages/flightLists/select.ts` to `packages/engine/stryker.config.json` (its test under `test/stages/`, added
  to the mutate command) and move it from `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` at their thresholds; `pnpm -r typecheck`;
  `pnpm --filter @gmt/engine exec stryker run --mutate src/stages/flightLists/select.ts --concurrency 2` ≥ 80%.
- [ ] **Commit**: `wp20: flight lists for the cheapest date pairs after discovery, on demand, and their endpoints`.

### Task 20.10: `core` and `web`: the flights on a search's page

**Files**: `packages/core/src/flights/{choose,ties}.ts`, `packages/core/stryker.config.json`, tests `packages/core/test/flights/{choose,ties}.test.ts`;
`apps/web/src/views/Dates/{Flights,FlightRow,TieLine,BoardTable,BoardCard,DatesView}.tsx`, `src/api/flights.ts`, `src/copy.ts`;
tests `test/views/dates/flights.test.tsx`, `test/msw/searchesHandlers.ts` (extend), `test/fixtures.searches.ts`.
**Consumes**: Task 20.9. **Produces**: `withinLimits`, `chooseFlightsToShow`, `tieGroups`, `orderWithinTie`.

- [ ] **Write the failing tests.**
  - `choose.test.ts`: limits `{ maxJourneyMinutes: 1500, arrivalWindowLocal: null, departureWindowLocal: null }`, five
    flights of 600/700/1,560/900/800 minutes priced £92/£86/£80/£86/£95 → `shown` is £86 at 700, £86 at 900, £92 at
    600 (price, then duration), `overLimit` false, `moreRead` 2, `moreOutside` 1; the shortest flight within the limits
    is always among `shown` (a 400-minute flight at £150 replaces the third pick); an arrival window 06:00–23:00
    excludes a flight arriving 03:10 (`withinLimits.arrival` false) and a departure window 08:00–20:00 excludes one
    departing 06:10 (`withinLimits.departure` false), each counted in `moreOutside`; every flight outside →
    the cheapest three with `overLimit` true, `moreRead` 2, `moreOutside` 2; a null limit shows the cheapest three;
    fewer than three shows all; ties in price and duration go to fewer stops then the earlier departure; property:
    `shown.length + moreRead === flights.length`.
  - `ties.test.ts`: `tieGroups` over a ranked list of prices 86, 86, 86, 92, 92 with the third £86 not current gives
    groups [2, 1, 2]; `orderWithinTie` over three pairs whose first shown flights last 700, 600 and 600 minutes, the
    last two with 1 and 0 stops → order 3, 2, 1; a tie decided only by `departsLocal`; pairs with a failed, empty or
    missing list, or whose only list is `listOtherPair` (the web passes null for them), keep input order after them;
    stable (property).
  - `flights.test.tsx` (fake timers): the board requests `GET flight-lists` for the pairs of every tie group that
    touches the shown page (bounded by `MAX_FLIGHT_LIST_PAIRS`; "Show 10 more" issues one more request); each board
    row of the shown page (and its phone card) carries a flights block headed "Outbound flights only · each price is
    the lowest round trip listed with it · read 3d ago, 12 Mar 11:44 · prices from Google Flights, not checked with
    the airline" (age through `formatAgo`, the date added when not today), the row's main line reading beside the
    figure "Google's list: from £92, 11:44" / "not in Google's list" / "Google's list showed no flights", the instant
    through `readAt` (a reused list 100 h old reads "Google's list: from £92, 12 Mar 11:44"; the outcome comes from
    `list` only, never `listOtherPair`; the figure's `PriceCell`, rank number and coverage are unchanged when a list
    arrives); up to
    three flights each "depart 07:15, arrive 18:05 +1 · 10h 50m · 1 change · Virgin Atlantic · from £478 round trip"
    through `PriceCell` compact with `sourceLabel` the main-path flight-list label, `calendar: true` (dashed outline,
    "not checked"), the list's `stale` as the stale mark, and "+1" with the arrival's full date for assistive
    technology; a flight within the limits is marked "outbound 10h 50m, within your 25h limit; return not read", an
    over-limit one "outbound 26h: over your 25h limit", one outside the arrival window "arrives 03:10, outside your
    window", one outside the departure window "departs 06:10, outside your window"; the line "3 more read, 1 outside
    your limits · show all" expanding to every flight; a per-list line "return leg not read; stops and airline
    settings not applied to flights read"; a `failed` list reads "Flights not read: <the reason's clause>"; `listed
    'no-flights'` reads "Google's list showed no flights for these dates when read 11:44"; `listed 'none-for-cell'`
    reads "Google listed flights, none this app could read for these airports and dates (2 for other airports or
    days, 1 unread)" and, with every option unparsed, "… (3 unread)", never "no flights"; `listOtherPair` renders only
    inside the flights block under "Flights read for LGW → EWR, not the priced airports", with no outcome beside the
    price and no difference line; no list reads "Flights not read yet" with
    "Read flights for this date (free, 1 page; 1,390 pages left this month)" when `available`, the pages-left clause
    only when fewer than `CAMOUFOX_EXECUTION_PAGE_CAP + FLIGHT_LIST_COUNT` remain; a press POSTs, shows "Reading
    flights…", disables every other read button while `reading` is non-null, refetches at `POLL_MS` (advance it) and
    clears when the poll returns the newer list; a 409 `browser_busy` shows "The browser worker is busy with a search;
    try again when it finishes", `fresh` "Read within this search's refresh"; when `available` is false no per-row
    line appears and one line under the list reads "Flight times need the browser worker; set it up in Providers";
    when the cheapest flight read (`list.minMinor`) differs from the figure the line "Google's flight list showed £92
    as the cheapest read, 12 Mar 11:44; the Aviasales cache showed £86, 10 Mar 09:30" (both through `PriceCell`, both
    instants through `readAt` so the two sides share one form, the clause from the figure's provenance; a date-grid
    figure reads "the date grid"; a reused list 100 h old carries its day), with "Google shows a lower fare it could
    not read (£x)" when `tabMinor` is below; every date pair row has "Open in Google Flights ↗" with the response's `link`
    (`rel="noopener noreferrer"`, `target="_blank"`, accessible name "Open in Google Flights for 12 → 23 Jan, opens in
    a new tab"), `SEARCH_LINK_LABEL` beside it, whatever `available` says, none when `link` is null, and a link whose
    url is not `https://www.google.com/…` renders no anchor; "verified" appears nowhere in a flights block; a carrier
    of `<img src=x onerror=1>` renders as literal text and `apps/web/src` holds no `dangerouslySetInnerHTML`; each
    tie group has its own line "4 date pairs tie at £86, listed by shortest flight time" when at least one member has
    flights shown, else "… in date order", and the group's rows follow `orderWithinTie` (an on-demand read may move
    rows within a tie; the rank number column is the price rank and does not change); the fixture-only search shows
    no read button and the one line under the list.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/flights`, `pnpm --filter @gmt/web exec vitest run test/views/dates/flights.test.tsx`.
- [ ] **Implement.** The web applies `orderWithinTie` per `tieGroups` group after `rankDatePairs` and before paging,
  over the fetched lists. Add `src/flights/choose.ts` and `src/flights/ties.ts` to `packages/core/stryker.config.json`
  and move them from `pending`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/core test` at 100%; `pnpm --filter @gmt/core exec stryker run --mutate src/flights/choose.ts,src/flights/ties.ts --concurrency 2` ≥ 80%;
  `pnpm --filter @gmt/web test` at 70% / 60%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp20: flights for the cheapest date pairs on a search's page`.

### Task 20.11: The smoke, the docs

**Files**: `apps/web/e2e/{smoke.spec,selectors}.ts`, `test/e2e/selectors.test.tsx`; `apps/web/PRODUCT.md`, `docs/setup.md`, `docs/providers.md`.

- [ ] `smoke.spec.ts` step 1 becomes: on `?`, fill From and To (the example's codes through the picker), Leave between
  "14 Mar 2027" and "15 Mar 2027", Stay 10 to 11, open More options and switch the sources to `fixture`, press "Search
  now", and wait on the page's state line reading "Searched" (90 s backstop); the flights area reads "Flight times
  need the browser worker" with no read button (the fixture provider has no flight lists); step 4 adds
  `?view=dates&def=<id>` landing on the page, `?view=definitions` landing on Searches and the nav's page entry naming
  the search; the `@phone` test checks the form above the list at 375 px, no horizontal overflow on a search's page
  with the flights block and on the cards list, and ≥ 44 px card actions. `SMOKE` gains `searchNow`, `stateLine`,
  `searchCard`, `flightsBlock`, `flightsUnavailable`.
- [ ] `apps/web/PRODUCT.md`: the views (Searches first, a search's page, History; Set up), the success line (one press),
  the words table's main-path terms, the flight list line (what it is and is not). `docs/setup.md`: :105–106 (a new
  search runs when you press Search now; a schedule is added from its page and registers on Save), :324–327 (a
  search's page), the example JSON block unchanged (`docs.test.ts` holds it byte for byte). `docs/providers.md`: the
  camoufox verdict cell reads "Discovery, plus the flight-list read" and one line says the browser provider also reads
  the flight list for the cheapest ten date pairs under its own allowance.
- [ ] **Run**: `pnpm --filter @gmt/web e2e` locally (desktop and `@phone`), `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts`, `pnpm exec vitest run scripts/wording.test.mjs`.
- [ ] **Commit**: `wp20: smoke and docs for search now`.

## 9. Pinned review-focus tests

1. No price source: `createAndStart.test.ts` (refusal in the body) and `searchNow.test.tsx` + `stopped.test.tsx` (the
   page's words and fix, from the URL's `refused=` and from the search's own data).
2. Pending run: `flightRead.test.ts` (`busy` for `pending` and `running` before any call; allowed for a
   Travelpayouts-only run; a run going pending waits on the lease).
3. Grid cap spent: `flightLists.test.ts` (the step after the `provider-execution` stop; the 11th page refused before
   any call; the run stays `paused_budget`) and `budgetGuard.test.ts`.
4. Pre-0011 rows: `cards.test.ts`, `statusBar.test.tsx`, `stopped.test.tsx` (`NO_STOP_CAUSE_TEXT` with and without
   `error_text`, seeded through the migrated database; never "paused: error").
5. Old date format: `form.test.tsx` (refused beside the field, zero estimate calls past the debounce, the button's
   description names the field).

Also pinned, from the design's anti-goals and the rulings: STALE never true for a bounded- or unknown-age price within
its refresh, a vendor-dated old price stays stale, and the override wins outright (`age.stale.test.ts`, `stale.test.ts`);
a browser page-limit stop never offers Resume and a manual resume of the per-run one is refused `cap`
(`stopCause.test.ts`, `execute.test.ts`); a scheduled firing supersedes a stopped manual run (`tick.test.ts`);
`replaceStopped` end to end (`executions.test.ts`); the cards, the header line, the stopped line and the key count a
searched date pair with one core function (`marks.test.ts`, `cards.test.ts`, `stateLines.test.ts`, `overview.test.ts`); "not searched", "not reached" and "couldn't be
read" never "no flights" or "no price shown" (`overview.test.ts`, `stateLines.test.ts`, `flights.test.tsx`); a flight
read never changes a price, rank or coverage and its outcome is beside the price (`flights.test.tsx`); "verified"
never in a flights block; no main-path jargon on the page, the Edit page or More options (`header.test.tsx`'s sweep);
the banned words over every new string (the catalogue and rendered-sweep tests); no stop sentence from engine or
vendor text (`stopCause.test.ts`'s enum table, `execute.test.ts`'s sentinel case); a confirmation covers that run only
(`searchAgain.test.tsx`: no PUT); a manual run of an unscheduled search never auto-resumes (`execute.test.ts`); a fresh
start over a stopped run (`startFresh.test.ts`).

## 10. Definition of done

- Spec revision 55 written (Task 20.0) with every rule of this brief in its section; the design doc carries the rulings.
- `pnpm --filter @gmt/core test` (100%), `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/providers test`,
  `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` (85% / 70%), `pnpm --filter @gmt/camoufox-worker test`,
  `pnpm --filter @gmt/web test` (70% / 60%, ending with `test:tz`), each green; the worker's and providers' recorded
  suites green on a machine holding the recordings.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`,
  `node scripts/check-mutation-globs.mjs` (nothing pending for WP20 once `status` is `merged`), `pnpm test`.
- Mutation at ≥ 80% with timed-out mutants under 5%: `pnpm --filter @gmt/core mutate` (`definitionDefaults.ts`,
  `labels/{stopCause,mainPath,age}.ts`, `flights/{choose,ties}.ts` among its list), `pnpm --filter @gmt/web mutate`
  (`landing.ts`, `overview.ts`, `format.ts`, `estimateLine.ts`, `stateLines.ts`), `pnpm --filter @gmt/engine mutate`
  (`stopCause.ts`, `stages/flightLists/select.ts`), `pnpm --filter @gmt/camoufox-worker mutate` (`flights.ts`,
  `names.ts`); `pnpm --filter @gmt/core mutate` also covers `labels/age.ts` (the staleness rule) and `datePairs/marks.ts`.
- `pnpm --filter @gmt/web e2e` green on the desktop and `@phone` projects; CI's `e2e` job green on the PR.
- `pnpm exec vitest run scripts/wording.test.mjs scripts/workflows.test.mjs` green (the wording test holds the
  ruled phrases over every tracked file), and the bare-word grep of §0,
  `git diff main...HEAD | grep -nP '\b[Bb][Oo][t](s?\b|[A-Z_-])'`, returns nothing.
- No orphaned vitest, Stryker, Playwright or browser process after the runs.
- The PR description carries the changed-file count and the CodeRabbit route; every CodeRabbit thread fixed and resolved.

## 11. Open questions

None. The review's `requires_human_judgment` items were ruled on 2026-10-31 (Ian's three rulings and the
orchestrator's on the rest, in two rounds) and are folded into the text above and into the design doc; Task 20.0
records them in revision 55. One reading of the design is noted for Ian without reopening it: design §5.5's "a price
fetched by the latest run, within its refresh interval, is never stale" needs no clause of its own, because the
per-price threshold (the refresh plus the price's own stored age) already makes a bounded- or unknown-age price
stale exactly when its fetch age passes the refresh; a vendor-dated price keeps its own age, so an old price the
vendor dates is never hidden, and `CALENDAR_STALE_AFTER_HOURS` overrides outright, as the design says.
