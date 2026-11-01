---
wp: 21
title: The return leg (the cheapest outbound within the limits is selected, its return flights read, and each pairing's round-trip total leads the date pair)
owner: opus
depends_on: [20]
spec_sections: ["§2 camoufox", "§3", "§5.1", "§6.5", "§6.9", "§7", "§8.1", "§9", "§10", "§11", "§12", "§16", "§17 revision 56"]
reviewers: [product-owner, provenance-auditor, provider-integration-expert, cost-and-budget-reviewer, data-model-reviewer, search-strategy-reviewer, ui-reviewer, code-architect, test-strategy-reviewer, security-reviewer]
mutate: {"@gmt/core": ["src/flights/choose.ts", "src/datePairs/rank.ts", "src/datePairs/figure.ts"], "@gmt/camoufox-worker": ["src/classify.ts", "src/ready.ts", "src/names.ts", "src/flights.ts", "src/monthly.ts", "src/guard.ts"], "@gmt/engine": ["src/stages/flightLists/select.ts", "src/estimate.ts"]}
pending: {"@gmt/core": ["src/flights/types.ts", "src/flights/returns.ts", "src/datePairs/pairing.ts"], "@gmt/camoufox-worker": ["src/returns.ts", "src/returnPhase.ts"], "@gmt/engine": ["src/stages/flightLists.ts", "src/flightRead.ts"]}
status: reviewed
---

# WP21: The return leg

Written 2026-11-01 against spec revision 55 and the code on `feat/search-now` (WP20 built; PR #38 held as a draft until
this package is in). Ian approved the plan on 2026-11-01, on finding the flight list read only the outbound: "The entire
purpose of this app is to work out full flight costs … They are surely crucial?!" He chooses dates on flight time,
changes and time of departure, so the page must show, per date pair, an outbound, its return flights and the
round-trip total Google listed for that pairing, each leg checked against the search's limits. **Revised the same day
after the core roster's review (123 findings: 43 High, 59 Medium, 21 Low), Ian's rulings of 2026-11-01, and the quick
re-review (56 findings: 2 Critical, 17 High, 27 Medium, 10 Low) with the orchestrator's rulings on it; every finding is
answered in the text below.** Ian ruled: (1) the pairing total leads: a date pair whose flights were read takes the
cheapest pairing total within the search's limits as its headline figure and board rank, the date-grid price beside it,
pairs not read keeping the grid price marked as such (this supersedes WP20's "a flight read never changes a date pair's
price or rank"; coverage buckets are unchanged); (2) a second outbound: when no return of the cheapest outbound within
the limits fits, the next-cheapest outbound within the limits is tried (at most two a pair), and when no outbound fits
at all the cheapest outbound's returns are read anyway and the pairing is marked over the limit. The orchestrator's
rulings (R-lead, R-grid, R-synthetic, R-second, R-reserve, R-zero, R-spacing, R-settle, R-returns30, R-heads, R-order,
R-viewmore, R-unverified, and the first round's page rule, served sequence, limits, finished statuses, unknown-view
stop, mismatch line, planning from the flag and the reservation chain) are folded in where they apply. The work has two
phases on one branch: research first (Task 21.0 records what Google's page does when an outbound is selected, and
again after the list page is loaded afresh for a second outbound; nothing is built on a guess), then spec revision 56
from the findings (Task 21.1), then the build, task by task, each building alone. Where a rule depends on the findings
it says so and gives the decision rule; everything else is fixed here.

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans`, task by task, in the order below. Steps use `- [ ]` checkboxes. Task 21.0's live
> recording is run by the controller, never by an implementer.

**Goal.** For each of the 10 cheapest date pairs (and on demand), the browser worker selects the cheapest outbound
within the search's limits, reads the return flights Google lists with it (and, when none fits, those of the next
outbound within the limits, from a fresh load of the list page), and a search's page leads each read date pair, while
its list is fresh and was read under the current limits, with the round-trip total Google listed for its cheapest
pairing within the limits, shows "Out:" and up to three "Back:" lines, both legs judged against the limits, and says
plainly which outbound the pairing used and when a return read failed, keeping the outbound.

**Architecture.** The worker's flights page gains a return phase after the outbound read, in its own module: core's
one selection rule picks the outbound among every flight read for the cell, the driver clicks that option's link (the
one new verified click, behind its own per-entry flag `RETURN_SELECT_VERIFIED`), the page is polled until the view has
changed from the outbound list and settled, a return reader with the shared grammar reads the return options (fitting
ones kept first), and, when no return fits and a second outbound fits, the list page is loaded again (a fresh, spaced,
counted page; the served sequence again) and the next outbound is selected. Every document load is a page: the worst
case per pair is one core constant, reserved in the worker's monthly counts before the first load and settled down to
the documents loaded, carried as `pagesLoaded` on the answer, through http-kit, the ledger, the guard and the usage
read. The answer carries a `returns` block with the limits the selection used; the contract, the capability, migration
0012 (additive), the engine step (the limits and the worker's flag in the plan), the api's figure (the pairing total
leads while fresh and under the current limits) and the page carry it through. A return view that is not the recorded
shape ends the phase with the outbound answer intact and no cool-down, and the run sends no further return phase; a
genuine block after the click stops the page as any block does.

**Tech stack.** As the repo: TypeScript 5.9 strict, zod 4, Hono 4, Drizzle over better-sqlite3, React 19 with
TanStack Query 5, vitest with Testing Library, msw and fast-check, Playwright, Stryker 10 (command runner).

**Spec.** `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (revision 56 after Task 21.1); the WP20
design `docs/superpowers/specs/2026-10-31-search-now-design.md` stays the record of the flight list's first
conversation; its §6.2 price rule and §6.3 "no return leg" carry Ian's 2026-11-01 ruling and defer to the spec.

## 0. Standing rules for the implementer

- **No `as`** except `as const` and `satisfies`; brands only through `core`'s helpers (`asIata`, `asIsoDate`, …) or
  zod; `node scripts/check-casts.mjs` passes. Tests are type-checked through each package's `tsconfig.test.json`
  (`pnpm --filter @gmt/<pkg> typecheck`); a type-level claim is pinned with `expectTypeOf` and that run, since vitest
  alone does not type-check.
- **TDD**: the failing test first, run it and see it fail for the reason the task states, then the least code, then green.
- **Event-driven tests**: no sleeps, fixed delays or poll-until loops. Wait on an event (a promise the code under test
  returns, Testing Library's `findBy…`, a server's `listening`, a process's `exit`, a deferred promise the test
  resolves), with a timeout only as a backstop. Every clock read, debounce and poll goes through an injected clock or
  `vi.useFakeTimers()` (the worker's `test/support/timers.ts` `fakeTimers`; the web's pattern of
  `apps/web/test/views/definitions/airportList.test.tsx:93-104`, advanced with `vi.advanceTimersByTimeAsync`).
- **Comments are generous**: every exported symbol has a doc comment naming its spec section (revision 56's), and
  every non-obvious choice carries a `// why:` line.
- **Words come from one place**: web view logic composes sentences from `COPY` keys (templates with parameters), never
  inline literals, so the catalogue and rendered-sweep tests cover them; the main-path name of a source comes from
  core's one table (`labels/mainPath.ts`). One spelling: "round-trip total" everywhere (COPY, the provenance note, the spec).
- **Package-scoped tests while iterating** (`pnpm --filter @gmt/<pkg> exec vitest run <path>`); the whole `pnpm test`
  only before a push (the machine is shared). **Stryker scoped** while iterating
  (`pnpm --filter @gmt/<pkg> exec stryker run --mutate <file> --concurrency 2`; each task names its run). After every
  vitest, Stryker or Playwright run, `pgrep -fl 'vitest|stryker|playwright|chrom'` and stop anything left from it.
- **Public wording**: the repo is public. Code, comments, tests, docs and commit messages never describe how the
  browser provider's pages look to a site, and never use the words `scripts/wording.test.mjs` refuses; commit messages
  (`wp21: <what>`) name no vendor's site and no data-collection method. Before every push:
  `pnpm exec vitest run scripts/wording.test.mjs` and `git diff main...HEAD | grep -nP '\b[Bb][Oo][t](s?\b|[A-Z_-])'`.
- **Worked examples only**: London → New York (`LHR`, `LGW` → `JFK`, `EWR`; metro `LON`, `NYC`) and Birmingham →
  Frankfurt (`BHX` → `FRA`). Any other code in a test is synthetic (`QQA`, `QQB`, `AAA`) and seeded by that test, never
  looked up in the airports dataset; synthetic carriers are `QQ Air`, `QQ Atlantic`. No airport code or city name in a
  string literal under `apps/web/src` or `apps/api/src` (`node scripts/check-boundaries.mjs`). Every new fixture module
  exports `export const SYNTHETIC = true as const` and a one-line header saying so (a test in each package's
  `test/fixtures*.test.ts` asserts the export on every module under `test/fixtures*` and `test/support/fake*`); the
  flight-list msw bodies keep the real provenance shape with synthetic flights; every fixture is scanned by the
  existing secret-substring test; every fixture that must satisfy a contract is built through that schema's `parse`.
- **Recordings** (decision 61): `apps/camoufox-worker/fixtures/recorded/**` is gitignored, 0600 and local-only. No
  recording, no value read from a page, no page text, no option, button or tab name and no Google URL with a query is
  ever written into a test, a doc, a commit message, the recorder's console output or this brief's findings note; a
  pinned value of a page is a `pinOf(contentSha256, value)` hash (`test/support/recordedList.ts`) or a boolean.
  Recorded suites skip, naming themselves skipped, where the recordings are absent. Back them up with
  `pnpm --filter @gmt/camoufox-worker recordings:backup` before removing any worktree.
- **No live load** except Task 21.0's recorder run (the controller runs it, worker stopped, example route only, at
  most two date pairs plus at most two retries, under every rule the recorder applies). No task runs the worker
  against Google, and the worker's rules are unchanged except the clicks and the one reload of this package's return
  phase, each behind the one flag and each a name in the selectors module or the worker's own URL form.
- **Every task builds alone** (R-order): a contract field, a type field and a schema member are added in the task that
  produces them as optional (`.exactOptional()` on the wire, `?:` on an interface, a new enum value admitted but not
  yet produced) with every consumer named, and are made required only in the task that updates the last consumer;
  §5 names that task per field; each task's pass step includes `pnpm -r typecheck`. No import cycle: a module shared
  by `camoufox/` and `flights/` lives in a leaf module. No two files in one directory differ only by letter case. A
  branch on a figure's basis is an exhaustive `switch` with a `never` default.
- **Secrets in tests are sentinels** (`test-worker-key-0123456789abcdef0123456789abcdef`); the redaction sweep gains
  every new answer shape (`returns`, `pagesLoaded`, `nextLoadNotBefore`, the return rows, the pairing figure and the grid price).
- **Package boundaries**: `web` imports only `core`; `engine` never imports `api`; `node scripts/check-boundaries.mjs`
  passes.
- **Commits**: plain commits, `wp21: <what>` (the PR lands by squash-merge). Every commit ends with the trailer
  `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`. Never a bare `git stash`.
- **CodeRabbit**: count the PR's changed files; at 150 or fewer the app reviews it, above 150 run the CLI and say so
  in the PR. Before the merge, read the app's inline threads and outside-diff list, fix each, push, resolve each.
- **Windows known failures** (`ci/windows-known-failures.txt`): no task below depends on POSIX file modes beyond the
  recorder's existing 0600 writes, which its tests already guard; none is expected.

## 1. Global constraints

- **The pairing total leads while it is fresh (Ian, 2026-11-01; R-lead).** A date pair whose newest list for its
  figure's airport pair has a finished return read, a pairing within the search's limits, is not stale by the per-price
  rule (its age within the search's camoufox refresh) and was read under the current limits (its stored limits equal
  `flightLimitsOf` of today's constraints) takes that pairing's round-trip total, as the return list stated it, as its
  headline figure and its board rank, through `PriceCell` with the flight list's provenance (source "the browser
  worker's flight list", fetch time, "not checked with the airline", never "verified"); the date-grid price it replaced
  is shown beneath it through `PriceCell` with its own source, age, "not checked" and stale mark (R-grid). When the
  list is older than the refresh or was read under other limits, the grid price leads and the pairing is shown beneath
  with its age. A date pair whose outbound flights were read but has no pairing within the limits keeps the grid price
  with its own mark; "flights not read" is shown only when no flight list exists (R-heads). The rank's "current" keys
  of a pairing figure (`superseded`, `notSeenInLatest`) are the calendar candidate's it replaced; its `fromEarlierSearch`
  is true exactly when the list's `fetchedAt` is before the latest parent run's `startedAt` (an on-demand list read
  after that start counts as from the latest search). Coverage, the buckets and the month key are unchanged by any
  flight read; the synthetic banner judges every price group in the read, the grid price included (R-synthetic).
- A return's total is the round-trip total **the page listed for that outbound with that return**, in GBP pence, as
  read; it is never computed, never a "from" price, and never shown without the outbound it pairs with. The outbound's
  own "from" price stays what it is. When the cheapest return total of an outbound differs from that outbound's "from"
  price, the page says so in one line naming both figures; nothing is reconciled. When the return view stated more
  results than were read, or showed a "View more" control, the page says Google listed more return flights than this
  app read; the control is not clicked (R-viewmore).
- **The limits applied**: the longest journey on each leg's duration, the per-direction `maxStops` on each leg's stops,
  and the departure and arrival windows on the outbound's local times only (the definition has no return windows; the
  page says "windows apply to the outbound"). The selection, the chooser (outbound and return), every "within your
  limits" mark and the pairing figure apply exactly these, and nothing on the page says the pairing is within the
  limits "as a whole". Airlines and layovers are not applied ("airline settings not applied to flights read", said in
  the block and, when the search sets any, on the board row of a pairing figure).
- **Pages** (the page rule; R-second; R-reserve). A page is one Google document load (spec §2). A flights request with
  a return phase may load up to `FLIGHT_LIST_PAGES_PER_PAIR_MAX` documents: the first view, the first selection when
  it loads a document, the fresh load of the list page for a second outbound (always a document), and the second
  selection when it loads one. The constant is the all-document worst case (4), one source in core for the worker's
  reservation, the app's reservation, the allowance and the estimate, whatever the findings show; the findings decide
  only whether a selection is expected to load a document (and so is spaced before the click) and what counts as
  unexpected. Before every document-loading step the worker waits out the spacing (the pacer re-claimed, under the
  step's own budget), the app admits the request only when the browser window outlasts its worst case, the worker
  reserves the worst case in its monthly counts before the first load and settles down to the documents loaded, never
  above the reservation (when the worst case would pass the monthly cap the first view still loads on a reservation
  of one and the return phase is skipped `monthly-headroom`), and every answer to such a request states `pagesLoaded`
  (0 when the first load was refused), which the ledger, the guard, the estimate and the usage read carry. An in-app
  change is one interaction, counted nowhere (as the Cheapest click is). After a phase that loaded further documents
  the answer states when the next load may start, and the app's next request waits for it (R-spacing). No new
  setting (§12).
- **Planned from the worker's flag**: the return phase is planned (its pages, seconds and the estimate's "out and
  back" words) only when the worker last reported `RETURN_SELECT_VERIFIED` true; a worker that reports it false, or has
  not been read, is planned outbound-only, and the run sends `returnLimits` only when its plan says so. Docs promise
  returns only where the flag is on.
- The worker's rules hold: one page at a time, the spacing per document load, the cool-downs, consent cookie,
  signed-out profile, page gate, GBP check, no challenge ever answered, nothing clicked but the names its selectors
  module marks verified, no URL but its own form. The additions are the selected outbound's link (clicked at most twice
  a pair, the second time after a fresh load of the worker's own list URL), only in `flights` mode, only when the
  request carries `returnLimits`, and only on an entry whose `RETURN_SELECT_VERIFIED` a recording of the served
  sequence set.
- Money in integer pence; timestamps `toISOString()` text; dates `YYYY-MM-DD` on the wire; no local-time `Date`
  arithmetic (a return's day offset is calendar arithmetic in UTC from the return date, −1 to 3).

## 2. Review Focus

Five conditions the plan implies and no section states outright; each is pinned by a test in the task named:

1. **One selection rule, end to end.** The outbound the worker clicks is `selectOutbound` over every flight read for
   the cell under the request's limits (journey, stops, windows), the answer's `attempts[0].outboundIndex` names it
   inside `flights`, the stored `outbound_position` equals it, the page's "Out:" line is that flight, the board's
   headline total and the page's first "Back:" line come from one shared fixture through one core function
   (`cheapestPairing`), and the fixture makes the right pick neither the first in page order nor the cheapest (Tasks
   21.2, 21.3, 21.5, 21.6, 21.7).
2. **A wrong return view is not a block, and it is not repeated.** After the click, a view that is not the recorded
   return shape, a view that never changes from the outbound list, a click or spacing step that fails or times out, or
   a return phase that does not settle ends the phase with a transient status, the outbound flights intact, no
   cool-down, no `blocked` answer, the page's own `not-ready` never triggered (no `DeadlineExceeded` of the phase is
   rethrown), and the run sends no further return phase; while a captcha, consent, sign-in, account or
   unusual-traffic page after the click is `blocked` with its cool-down exactly as on a Best-view poll (Tasks 21.3, 21.6).
3. **Transient, old and other-limit lists are read again; finished ones are not.** A row stored before 0012, a row
   read without a return phase, a row whose return status is transient, a `not-verified` row once the worker reports
   the flag true, and a row read under other limits are read again by the next step and allowed on demand, whatever
   their age; a `read` or `no-outbound` row under the current limits, younger than 0.9 × refresh, is reused (Tasks 21.5,
   21.6, 21.7).
4. **The pair's pages are one number everywhere.** The worker reserves `FLIGHT_LIST_PAGES_PER_PAIR_MAX` pages per
   return-phase request and settles to the documents loaded, never above; every answer to such a request states
   `pagesLoaded`; the ledger row's `page_count` is the plan while pending, the answer's count when finalised (0
   admitted), the plan on an unknown attempt; the guard's camoufox page scopes count it as their `calls`, the
   snapshot's `flightListPages`, the estimate's pages and the Providers page follow; the app's flights request has its
   own timeout covering the phase's worst case, and discovery keeps its own (Tasks 21.0, 21.2–21.6).
5. **Totals lead honestly.** A return's price is never "from"; the figure's `PriceCell` for a read pair carries the
   flight list's provenance and never "verified"; the grid price beneath it carries its own; a pairing older than the
   refresh or read under other limits does not lead; a pair with no pairing within the limits keeps the grid price with
   its mark; the contract refuses a return without a price (Tasks 21.2, 21.6, 21.7).

## 3. Scope

**In**

- Task 21.0: the recorder kind `select-outbound` (the served sequence, the selection, a fresh load of the list page
  and a second selection), the guard's document-load count, the pacer's re-claim, the monthly worst-case reservation
  and settle, the recorded-test scaffold, the controller's live recording, the findings note.
- Spec revision 56 (Task 21.1) from the findings and the rulings.
- `core`: the return shapes, `selectOutbound`, the limits (stops, windows per direction), the pairing figure, its
  basis and freshness rule, `FLIGHT_LIST_PAGES_PER_PAIR_MAX`, `flightRequestSeconds`, the protocol's `returnLimits`,
  `returns`, `pagesLoaded` and `nextLoadNotBefore`, the ports' `pages` and `pageCount`, `FlightListQuery.returnLimits`,
  `FlightListResult.returns`, `PreflightResult.flags`, every strict schema that carries a basis or a plan
  (`flightListSchema`, `flightListsStateSchema`, `datePairFigureSchema`, the card's `cheapest`, the date-pair columns,
  `detailLink`), `Estimate.flightLists.pairs/returns`, the provenance note, the rule-token leaf module.
- `camoufox-worker`: the recorder kind, `RETURN_SELECT_VERIFIED` (flag, `PROOFS`, `/v1/status`), the return view in
  the classifier and the settle rule (changed from the pre-click view, then stable), the driver's steps, the return
  reader (fitting returns kept first), the return phase module, `pagesLoaded` and `nextLoadNotBefore` on the answers,
  `versions.returnGrammar`, `documentLoads` in every recording's meta.
- `providers`: the limits, the page plan and the flights request's own timeout through http-kit, `returns`,
  `pageCountOf`, the limiter hold from `nextLoadNotBefore`, the preflight's flags.
- `db`: migration 0012 (additive), the repository's returns and stored limits, `newestWithReturns`, the guard's and
  ledger's page counts (as the camoufox page scopes' `calls`).
- `engine`: the worker's flags on the context (from the preflight and the api's status read), the plan's `returns`,
  the limits in the query, the allowance per worst case, the window check per request, the step's stop after a
  transient return phase, reuse of finished lists under the same limits, the on-demand read's `fresh` rule, the
  estimate's pairs, pages, seconds and words, budgetFit.
- `api`: the pairing figure on the board, the cards and the scoped `/results` read (one pairings map), `returns` on the
  wire; `cli`: nothing (`gmt browser counts` reads `calls`, which is now the page sum).
- `web`: the board's figure (the pairing total, the grid-price `PriceCell` beneath, the marks), every basis reader
  (`overview.ts`, `howFar.ts`, `datesState.ts`, `BoardCard.tsx`, `board.ts`'s synthetic guard), the flights block (head
  per state naming the outbound used, the pairing section, "Back:" lines price first, both legs' marks, the mismatch
  and more-listed lines, status notes with what happens next, the counts clause), the estimate sentence's pairs and
  pages, the read button's pages, the Providers page's camoufox count.
- Docs: `apps/web/PRODUCT.md`, `docs/providers.md`, `docs/setup.md`; the smoke's selector.

**Out** (owner in brackets)

- Flight numbers, airport codes per segment, seller, baggage, booking (spec §2: still not itinerary search; WP7's
  verification owns offers). Return-leg time windows as definition fields (a later package, if Ian wants them). A
  "View more" click on the return view, and a back control (a later package with its own recorder step and flag).
- Reading returns for more than two outbounds a pair, or returns on the Travelpayouts or SearchApi paths.
- Verifying `RETURN_SELECT_VERIFIED` on `darwin-x64`, `linux-arm64` and `linux-x64` (WP17's per-entry recording
  sessions, run when Ian next runs them; each stays false until its own recording of the served sequence).
- Any change to the date grid, discovery, ties, alerts or History; the step's candidates stay the 10 cheapest by the
  calendar figures (`rankedPairsFor` passes no pairings), so which pairs are read does not drift as pairing totals land.

## 4. Interfaces consumed (unchanged unless a task says so)

```ts
// @gmt/core
FLIGHT_LIST_COUNT = 10; FLIGHT_LIST_MAX_FLIGHTS = 30; FLIGHTS_SHOWN = 3; FLIGHT_LIST_ENDPOINT_PATH = '/v1/flights'   // flights/limits.ts
LISTED; Listed; FLIGHT_TEXT; listedFlightSchema; ListedFlight (hhmm and flightText are module-private)               // flights/types.ts
FlightLimits (interface); ShownFlights<T>; withinLimits(f, l); clockOf; compareFlights; chooseFlightsToShow         // flights/choose.ts
tieGroups; orderWithinTie                                                                                             // flights/ties.ts
flightsRequestSchema; workerAnswerSchema; workerRuleSchema (protocol.ts:48, moved by Task 21.2); versionsSchema (gridGrammar exactOptional precedent);
  GOOGLE_CONTACTED_HEADER (every answer; '0' → page class no-page)
FLAG_NAMES; FlagName; flagsFor; FLAGS; CAMOUFOX_PIN                                                                   // camoufox/builds.ts, pin.ts
FlightListQuery; FlightListResult; FlightListCapability; PreflightResult; ProviderContext { executionId; signal; recordFixtures; beforeSend? }
BudgetGuard.reserve(p: ReserveParams { …; scrolls?: number }); finalise(r); scrollsLeft; scrollsThisMonth           // ports/budget.ts
flightListSchema; flightListsResponseSchema; readFlightListRequestSchema                                             // api-contract/flights.ts
flightListsStateSchema (api-contract/executions.ts:25, strictObject: the stored plan's one reader/writer); executionFlightsSchema
estimateSchema.flightLists: { pages; seconds }.exactOptional() (api-contract/definitions.ts:213); Estimate.flightLists (types/execution.ts:156)
usageSchema (api-contract/common.ts:129, z.object: calls, cap, scrolls?, flightLists?: { calls; cap }); the Usage port type
datePairs: figuresSchema columns (api-contract/datePairs.ts:80-113), cheaperCachedSchema (sparse); resultBasisSchema ('verified' | 'calendar');
  datePairFigureSchema (api-contract/results.ts:29-45, strictObject, the scoped /results read's figure); searchCardSchema.cheapest.basis
  (api-contract/searches.ts:96); DatePairFigure (datePairs/encode.ts:15); Figure<T>, FigureCandidate = Pick<ResultRow, …>, figuresByDatePair
  (datePairs/figure.ts); rankDatePairs (datePairs/rank.ts:12: current, price, basis, age, index); decodeDatePairs; detailLink.ts (a ResultBasis)
Constraints { maxStops?; maxJourneyMinutes?; departureWindowLocal?; arrivalWindowLocal?; includeAirlines?; excludeAirlines?; minLayoverMinutes?;
  maxLayoverMinutes?; … } (types/definition.ts:50); LocalTimeWindow; inWindow (constraints/evaluate.ts)
localTimeWindowSchema (api-contract/definitions.ts:15, module-private today); STOP_DETAILS; pageUrl; addDays
// @gmt/camoufox-worker (src/)
PageSession.page / read (session.ts:417-573: settle on Best, form check, Cheapest flow behind CHEAPEST_FLOW_VERIFIED, View more, listFacts, readFlights | readList);
  the Cheapest flow's inline classify-after-failed-step block (session.ts:487-500); noFlightsAnswer; `contacted` set before goto
pageBudget(timers, pageTimeoutMs, started, capMs): PageBudget { d; next(); nextFor(ms); onExpire }                       // budget.ts
Driver { goto; headingNames; readFacts(d, o?); resultNames; listFacts; formFacts; click; clickCheapest }; createDriver; ProbePage = Omit<Driver, 'click' | 'clickCheapest'>
runStep (throws CheapestStepFailed(name, 'timed-out' | 'failed')); CheapestStepFailed(step, reason) and its importers: driver.ts, record.ts, recordDialogs.ts,
  graph.ts, dialogSettle.ts, gridPage.ts, gridRecord.ts, session.ts (the catch)
LOOKUP_TIMEOUT_MS = 5000; CLICK_TIMEOUT_MS = 10_000; POLL_TIMEOUT_MS = 20_000; pollUntilSettled(driver, d, timers, pollMs, S, { view, log, startedAt })
View = 'best' | 'cheapest' (ready.ts:5); isSettled; stableAcross (Previous { signature; links; at }); PageFacts; SettleFacts { linkSignature; … }; ListFacts
classifyPageWithRule(f, S, view); ClassifyRule; GuardState { hops; frameUrls; refused }: hops gains the main frame's URL on `framenavigated` too
  (guard.ts:166-169), so a History API change adds a hop and no request
Selectors; SELECTORS; SELECTORS_VERSION; selectorsFor; PROOFS; flagsOf                                                   // selectors.ts
ParsedOption; parseOptionName; GRAMMAR_VERSION; MONTHS; group; grammarFor (module-private)                               // names.ts
readOptions(f, req, interstitials): { list: ListRead; mine: ParsedOption[] }; readList                                   // list.ts
FlightsRead; readFlights; dayOffset (0..3); splitCarriers (flights.ts); airportMatches; pointOfSaleOf
MonthlyCounter { check(scrollRequest); write; admit; settle(reserved, allowance, scrollsMade); rewrite }; admit(), settle() pure   // monthly.ts
Pacer { claim(): Claim; release() } (TOLERANCE_MS 2 s; the last start persisted; busy while held)                       // pacer.ts
pageClaim.ts claim(pacer, monthly, scrolls, deps, ctx) (the recorder's claim: exactly one page, never settled)
KINDS; parseRecordArgs; RecordArgs; MAX_PAGES = 3; RECORDED_BY; RecordingRefused; interact (record.ts:477-657); meta() (record.ts:729)
Outcome; Seen; StopFacts; writeRecording; writeUnrecorded; test/support/{recordedList,fakePage,fakeContext,timers}.ts (optionName fixes duration and carrier)
// @gmt/providers
flightListCapability; CAMOUFOX_FLIGHT_LIST_INFO; postToWorker(o, { path, body, tileIndex, ctx, scrolls? }); fetchedAtWithinRequest
camoufoxHttpLimits (one ProviderHttpLimits for list, grid and flights requests; requestTimeoutSeconds list pageTimeoutSeconds + 15; limits.ts:56-59);
  pageClassOf; scrollCountOf; classifyWorkerAnswer; http/types.ts HttpKitRequest.scrolls?, ProviderHttpLimits.requestTimeoutSeconds (:59), HttpKit (:151);
  http/attempt.ts (scrolls to reserve, scrollCount to finalise); the limiter (one per provider id)
preflight.ts: readWorkerStatus → WorkerStatus { flags; … }; workerFinding; the discovery preflight's PreflightResult
// @gmt/db
FlightListsRepo { insert; newestPerCell; newestPerDatePair; cellsOfExecution; forExecution }; StoredFlightList; FlightListInsert; RowRejected
SqliteBudgetGuard: INSERT_PENDING_SQL, FINALISE_SQL (scroll_count kept on an unknown attempt), checkCaps `+ 1`, providerExecutionRows, flightListCap, usage
ledger.ts COUNTS; schema/providerRequests.ts (page_class, scroll_count CHECKs); load.ts:51-52 (the executionIds scope of a read); migration 0011;
  test helpers { freshDb, openTracked, tmpDbPath, T0, migrationsWithout, statementsOf }
// @gmt/engine
runFlightLists; flightStepEntry; readPage (lease, `used + 1 > pages`, cap.read, error table); writeRow; planOf; markLeftByWindow; flightPageGate (beforeSend)
selectFlightPairs(ranked, newest: ReadonlyMap<string, NewestList>, now, refreshHours, todayLondon, count); NewestList { fetchedAt; status; listed }
withFlights (estimate.ts); FLIGHT_NOTE; isFlightNote; snapshotBudget; budgetFit.ts flightAllowanceOf, scheduleLoad; createFlightReader (flightRead.ts: failedRow,
  the `fresh` rule, the on-demand write); stages/discovery.ts:195 preflightPasses (the discovery preflight); EngineContext; ProviderRunLimits (context.ts:38,
  minSpacingSeconds; no request timeout); RankedDatePairsReader; RankedDatePair (engine/src/types.ts)
// @gmt/api
toFlightList; assembleFlightLists; flightsOf; datePairFigures(loaded, scope, rc) (read/datePairs.ts:48; also called by read/results.ts:119 for the scoped
  /results read); rankedFigures; rankedPairsFor (read/ranked.ts); cards.ts:134 (copies the figure's basis); read/usage.ts; wiring.ts (builds the
  providers' http limits); the boot status read of camoufox (bootstrap)
// @gmt/cli: apps/cli/src/camoufox/counts.ts (`gmt browser counts` takes month.calls as pages); apps/cli/test/support/deps.ts unsetFlags() (a full literal of FLAG_NAMES)
// @gmt/web
COPY.flights (copy.ts; readButton hard-codes "1 page"; differenceSource/differenceAt name a source and a time); copy/estimate.ts flights(pairs, duration);
  views/Searches/estimateLine.ts:151-154; views/Dates/{Flights,FlightRow,BoardTable,BoardCard}.tsx (BoardCard.tsx:136 maps non-verified to 'calendar');
  flightLines.ts; board.ts (isSyntheticRead:132-145 judges price and cheaperCached); overview.ts:192 ('calendar' → notChecked); howFar.ts:26;
  state/datesState.ts:145 (the figure's basis as a ResultBasis); views/Providers/ProvidersView.tsx:70-80 (u.calls as "N of 1,500");
  test/fixtures.searches.ts; test/msw
```

## 5. Interfaces produced

Each item names the task that builds it and, for a field a later task fills, the task that makes it required (R-order).
**F** marks a value Task 21.0's findings fix, with its decision rule; Task 21.1 writes the value into the spec and
Task 21.2 into the code.

```ts
// ---------- core (Task 21.2 unless marked) ----------
// camoufox/rule.ts (leaf: imports nothing): export const workerRuleSchema (moved from protocol.ts, which re-exports it); const count stays module-private
//   (returns.ts imports the leaf; nothing new reaches the barrel)
// flights/types.ts: const legFields (module-private zod shape, spread by both schemas); export type LegTimes = Pick<ListedFlight, 'departsLocal' | 'arrivesLocal'
//   | 'durationMinutes' | 'stops'> (what withinLimits judges)
export const listedReturnSchema = z.strictObject({ ...legFields, arrivesDayOffset: z.number().int().min(-1).max(3), totalMinor: z.number().int().min(1) });
//   GBP pence: the round-trip total the page listed for the selected outbound with this return; the day offset is from the RETURN date (−1: a date-line
//   return arriving the previous calendar day); the outbound's offset stays 0..3
export type ListedReturn = z.infer<typeof listedReturnSchema>;
// flights/limits.ts: export const RETURNS_SHOWN = 3; export const RETURN_ATTEMPTS_MAX = 2;
export const RETURN_NAVIGATION = ['in-app', 'document'] as const; export type ReturnNavigation;
export const RETURN_SELECT_NAVIGATION: ReturnNavigation;   // F: 'document' when the guard's documentLoads grew on either recording's first selection, else 'in-app'
//   (the second selection, after the reload, is expected to behave the same; the recording checks it: answer 1)
export const FLIGHT_LIST_PAGES_PER_PAIR_MAX = 4;             // R-reserve: the all-document worst case (the first view, a selection, the reload, a selection), the ONE
//   source for the worker's and the app's reservation, the allowance and the estimate, whatever the findings show; it never changes with them
export function expectedLoads(step: 'select' | 'reload', nav: ReturnNavigation): 0 | 1;   // 'reload' → 1; 'select' → nav === 'document' ? 1 : 0
export const RETURN_STEP_SECONDS: number;   // F: the larger recorded click-plus-settle stepMs (from the click, the spacing wait excluded) of a selection
//   or the reload's settle, rounded up to 10 s, at least 40
export const RETURN_PHASE_SECONDS_MAX = RETURN_STEP_SECONDS * (2 * RETURN_ATTEMPTS_MAX - 1);   // two selections and one reload-with-Cheapest
export function flightRequestSeconds(pageTimeoutSeconds: number, minSpacingSeconds: number): number;   // the app's timeout for a flights request with a
//   return phase, the worker's worst case: 5 × pageTimeoutSeconds (first view, Cheapest, selection, reload-with-Cheapest, selection) +
//   (FLIGHT_LIST_PAGES_PER_PAIR_MAX − 1) × minSpacingSeconds + 15 (read-back, close, discard bounds) + 15 (the round trip)
// flights/returns.ts (new)
export const RETURN_STATUS = ['read', 'no-outbound', 'skipped', 'select-failed', 'not-settled', 'unrecognised', 'not-verified'] as const;
export type ReturnStatus = (typeof RETURN_STATUS)[number];
//   read: at least one attempt's return view was read (its returns may be empty: listed none-for-cell); no-outbound: the outbound page listed no flight for the
//   pair (Google's no-flights line, or options none this app read), nothing clicked; skipped: no attempt made, rule `monthly-headroom` (the month's pages
//   left are below the worst case) or `spacing` (the spacing wait ran out of its budget); select-failed, not-settled, unrecognised: the first attempt's
//   transient end, with its rule; not-verified: the entry's RETURN_SELECT_VERIFIED is false
export const RETURN_FINISHED: ReadonlySet<ReturnStatus> = new Set(['read', 'no-outbound']);   // counts as a return phase done (§8.1 reuse); not-verified is
//   reused only while the worker still reports the flag false (R-unverified): the reuse rule's `returnsPlanned false` branch
export const RETURN_TRANSIENT: ReadonlySet<ReturnStatus> = new Set(['select-failed', 'not-settled', 'unrecognised', 'skipped']);   // re-read; the step stops
//   the phase for the run after select-failed, not-settled or unrecognised (never after skipped, which is the month's or the spacing's)
export const returnAttemptSchema = z.strictObject({
  outboundIndex: count,                       // into the list's `flights`
  outboundFits: z.boolean(),                  // the outbound met every limit when selected (false only on the no-outbound-fits attempt)
  listed: z.enum(['returns', 'none-for-cell']),
  navigation: z.enum(RETURN_NAVIGATION),      // what the selection did to the page, as the worker measured it (fewer loads than expected are recorded, never an end)
  moreListed: z.boolean(),                    // R-viewmore: the view showed a "View more" control, or stated more results than this app read (returns + unparsed + other)
  returns: z.array(listedReturnSchema).max(FLIGHT_LIST_MAX_FLIGHTS),   // R-returns30: the returns fitting the request's limits first (by total), then the rest,
  optionsUnparsed: count, optionsOtherCell: count, resultsStated: count.nullable() })   // cut to 30, kept in page order
  .refine((a) => (a.listed === 'returns') === a.returns.length > 0);
export const returnReadSchema = z.strictObject({
  limits: flightLimitsSchema,                 // the limits the selection used (stored; reuse and the figure's lead compare them)
  status: z.enum(RETURN_STATUS), rule: workerRuleSchema.nullable(),   // rule non-null exactly for skipped, select-failed, not-settled, unrecognised, and for
                                              // a `read` whose second attempt ended transiently (the first stands; the rule says why there is no second)
  attempts: z.array(returnAttemptSchema).max(RETURN_ATTEMPTS_MAX),    // in order made; non-empty exactly when status is read
  triedAll: z.boolean() })                    // no further outbound within the limits remained untried
  .superRefine(…);   // (status === 'read') === (attempts.length > 0); the rule rule above; attempts[1], when present, has outboundFits true and attempts[0]
                     // has no return within `limits` (a second attempt is made only then)
export type ReturnRead = z.infer<typeof returnReadSchema>;
// flights/choose.ts
export const flightLimitsSchema = z.strictObject({ maxJourneyMinutes: z.number().int().min(1).nullable(),
  maxStops: z.number().int().min(0).nullable().exactOptional(),   // optional here; required in Task 21.7 (the web's limitsOf is the last consumer)
  departureWindowLocal: localTimeWindowSchema.nullable(), arrivalWindowLocal: localTimeWindowSchema.nullable() });   // localTimeWindowSchema moves to
export type FlightLimits = z.infer<typeof flightLimitsSchema>;                                                        // types/window.ts; api-contract imports it
export function flightLimitsOf(c: Pick<Constraints, 'maxJourneyMinutes' | 'maxStops' | 'departureWindowLocal' | 'arrivalWindowLocal'>): FlightLimits;
export type Leg = 'outbound' | 'return';
export function withinLimits<T extends LegTimes>(f: T, l: FlightLimits, leg: Leg = 'outbound'): { journey: boolean; stops: boolean; arrival: boolean; departure: boolean };
//   journey ≤ maxJourneyMinutes; stops ≤ maxStops (an absent or null maxStops is met); arrival/departure by inWindow on the outbound's times, always true for
//   'return'. chooseFlightsToShow now applies the stops limit too (a board-visible change Task 21.1 states in §11); otherwise unchanged
export function selectOutbound<T extends ListedFlight>(flights: readonly T[], l: FlightLimits, skip: ReadonlySet<number> = new Set()): { index: number; flight: T; fits: boolean };
//   over the flights not in `skip`: the first that fits every limit in compareFlights order, ties by the lowest index (page order); with none fitting, the
//   first by compareFlights (ties by index) with fits false; throws RangeError on an empty input (the caller answers no-outbound before calling)
export function compareReturns(a: ListedReturn, b: ListedReturn): number;   // totalMinor, duration, stops, departure; the caller breaks the rest by index
export function chooseReturnsToShow(returns: readonly ListedReturn[], l: FlightLimits): ShownFlights<ListedReturn>;   // the chooser's shared body (comparator,
//   count, leg 'return') with compareReturns and RETURNS_SHOWN
// datePairs/pairing.ts (new, pure; Ian's ruling 1)
export interface Pairing { attempt: number; returnIndex: number; totalMinor: number; outboundFits: boolean; returnFits: boolean }
export function cheapestPairing(r: ReturnRead, flights: readonly ListedFlight[], l: FlightLimits): Pairing | null;
//   over every attempt's returns: the cheapest by totalMinor (then compareReturns, then attempt, then index) among those where the outbound and the return
//   both fit `l`; with none fitting, the cheapest of all with its fits flags; null with no return at all. Judged under the limits passed (the current
//   search's); the stored limits decide reuse and whether the pairing may lead
export interface PairingCandidate { totalMinor: number; provenance: Provenance; stale: StaleMark; ageHours: AgeHours; fits: boolean; fresh: boolean;
  underCurrentLimits: boolean; fetchedAt: IsoDateTime; executionId: string | null }   // what the api attaches per cell from its newest list
export function pairingLeads(p: PairingCandidate): boolean;   // R-lead: fits && fresh && underCurrentLimits
// datePairs/figure.ts: figuresByDatePair(rows, scope, now, pairingOf: (cell: CellKey) => PairingCandidate | null = () => null) — FigureCandidate and
//   ResultRow untouched; Figure<T> gains { basis: 'pairing'; chosen: T; cheaperCached: null; grid: { pricePence; provenance; stale; truncated }; pairing:
//   PairingCandidate } chosen when the calendar figure's cell has a candidate with pairingLeads true (a verified figure still wins: §6.5); otherwise the
//   calendar figure carries pairingRead (below). rank.ts: basis order verified 0, pairing 1, calendar 2 (price first); a pairing figure's current keys are the
//   calendar candidate's; its fromEarlierSearch is the api's (R-lead). datePairs/encode.ts DatePairFigure gains (optional until Task 21.7 makes them required):
//   basis 'pairing'; gridPrice?: { pricePence; provenance; stale; truncated } | null (non-null exactly for 'pairing'); pairingRead?: PairingRead
export const PAIRING_READ = ['not-read', 'outbound-only', 'no-pairing-read', 'over-limit', 'within', 'within-older', 'within-other-limits'] as const;
//   not-read: no flight list for the figure's cell; outbound-only: a list with no return phase (returns null, or not-verified); no-pairing-read: a finished
//   return phase with no return listed or read (no-outbound, none-for-cell); over-limit: returns read, none fitting; within: a fitting pairing leads;
//   within-older: a fitting pairing exists but the list is older than the refresh (the grid price leads; the pairing shown beneath with its age);
//   within-other-limits: a fitting pairing exists but the list was read under other limits (the grid price leads)
// api-contract/datePairs.ts: figuresSchema.basis takes figureBasisSchema = z.enum(['verified', 'calendar', 'pairing']); a sparse gridPriceSchema group keyed by
//   figure (pricePence, provenance, stale, truncated); a sparse pairingSchema group keyed by figure (pricePence, provenance, stale, ageHours: the pairing shown
//   beneath a calendar figure for within-older / within-other-limits / over-limit); a dense pairingRead column (z.enum(PAIRING_READ)); encode/decode carry them
//   (both groups exactOptional until Task 21.6 fills them; the web reads them in 21.7); §10's 4 MiB bound holds (one dense byte a pair, two sparse groups)
// api-contract/results.ts: datePairFigureSchema gains basis 'pairing', gridPrice and pairingRead (the scoped /results figure, so the detail and the board agree)
// api-contract/searches.ts: searchCardSchema.cheapest.basis takes figureBasisSchema
// datePairs/detailLink.ts: a 'pairing' basis opens the detail on the 'calendar' results basis (the row the pairing replaced)
// camoufox/protocol.ts: flightsRequestSchema gains returnLimits: flightLimitsSchema.exactOptional() (absent: no return phase, no `returns`; a /v1/page request
//   with it is refused); every answer kind that may answer a request carrying returnLimits (flights, blocked, not-ready, browser-error, cooling-down,
//   monthly-cap, spacing, counts-unreadable) gains pagesLoaded: count.exactOptional() — stated on every answer to a request that carries returnLimits on a
//   verified entry (0 when the first load was refused or the browser failed first; R-zero), absent otherwise (a list or grid page, or an older worker: the
//   ledger then counts the page class as today) — and nextLoadNotBefore: isoDateTimeSchema.exactOptional() (R-spacing: the worker's last document load's
//   start plus the spacing, stated when the phase loaded a further document); the `flights` answer gains returns: returnReadSchema.exactOptional() and its
//   superRefine checks every attempt's outboundIndex < flights.length (the provider maps a breach to list-error parse unknown-answer); versionsSchema
//   gains returnGrammar: z.string().min(1).exactOptional()
// ports/provider.ts: FlightListQuery gains returnLimits?: FlightLimits | null (required in Task 21.6); FlightListResult's `list` gains returns?: ReturnRead | null,
//   pagesLoaded?: number and nextLoadNotBefore?: IsoDateTime | null (required in Task 21.6); PreflightResult gains flags?: Readonly<Record<string, boolean>>
// ports/budget.ts: ReserveParams gains pages?: number (the planned page count, default 1); finalise's parameter gains pageCount?: number (the answer's, 0 admitted;
//   absent keeps the plan on an unknown attempt, else 1 on a contacted page); for a camoufox page scope the guard's `calls` IS the page sum (usageSchema, the
//   Usage type, the api's usage read, ProvidersView and `gmt browser counts` are unchanged: arch-r2-006)
// api-contract/flights.ts: flightListSchema gains returns: returnReadSchema.nullable().exactOptional() (required `.nullable()` in Task 21.7); superRefine: every
//   attempt's outboundIndex < flights.length
// api-contract/executions.ts: flightListsStateSchema gains returns: z.boolean().exactOptional() (absent read as false: an older plan is outbound-only) and
//   returnsStopped: workerRuleSchema.nullable().exactOptional() (absent read as null); types/execution.ts FlightListsState gains returns: boolean and
//   returnsStopped: string | null (the reader fills the defaults, so the type is total)
// types/execution.ts: Estimate.flightLists gains pairs?: number and returns?: boolean (required in Task 21.7: estimateLine is the last reader); estimateSchema the same
// camoufox/builds.ts (Task 21.0): FLAG_NAMES gains 'RETURN_SELECT_VERIFIED' (NONE false; pin.ts every entry false until Task 21.3's last commit)
// labels/source.ts: FLIGHT_LIST_SOURCE_LABEL unchanged; the provenance note (providers, below) is revised

// ---------- camoufox-worker ----------
// guard.ts (Task 21.0): GuardState gains documentLoads: number, incremented in the context's request route for a main-frame navigation request
//   (`req.isNavigationRequest()` with `main`), never on `framenavigated`; reset with hops per page
// driver.ts (Task 21.0): CheapestStepFailed becomes export class StepFailed extends Error { step; reason: 'timed-out' | 'failed' | 'not-found' | 'not-selected' |
//   'ambiguous'; flow: string } with constructor (step, reason, flow = 'cheapest') (the rename done in one go across every importer named in §4, no alias;
//   runStep passes o.flow); readFacts(d, o?, view: View = 'best') counts resultLinks, names and the signature with S.returns.resultLink when view is 'returns'
//   and always reports outboundLinks (the outbound pattern's count) and text.returnHeading; listFacts(d, view = 'best') reads the view's links; Driver gains
//   clickOutbound(name, d, o): Promise<string[]> (steps find-outbound: exactly one link in main with that exact name, else StepFailed('find-outbound',
//   'not-found' | 'ambiguous', 'select-outbound'); click-outbound under CLICK_TIMEOUT_MS; returns [`link:${name}`]), linkNames(d), buttonNames(d), tabNames(d)
//   (each name URL-stripped, at most 200; the recorder's); export function classifyAfterFailedStep(driver, cur, steps, S, view) (the recorder's closure made a
//   driver function; the session switches to it in Task 21.3); ProbePage = Omit<Driver, 'click' | 'clickCheapest' | 'clickOutbound'>; probePage() gains only
//   the read methods
// ready.ts (Task 21.0): View = 'best' | 'cheapest' | 'returns'; PollOptions gains changedFrom?: { signature: string; documentLoads: number } (the pre-click
//   view); isSettled(page, settle, 'returns', changed: boolean) = changed && !settle.fetching && (page.resultLinks > 0 || page.outboundLinks > 0 ||
//   page.text.noFlights), then the existing two-poll stability; `changed` (R-settle) = settle.linkSignature !== changedFrom.signature ||
//   page.text.returnHeading || guard.documentLoads > changedFrom.documentLoads; an unchanged view until the step's deadline is not settled
// classify.ts (Task 21.0 the branch; Task 21.3 the recorded structure): ClassifyRule gains 'returns' | 'not-return-view' | 'no-flights-line-unrecorded';
//   classifyPageWithRule(f, S, 'returns'): the blocked rules first; then, when S.RETURN_SELECT_VERIFIED: results when f.text.returnHeading && f.resultLinks > 0
//   && <F: the structural facts>, Google's no-flights line with no link by either pattern → blocked unrecognised 'no-flights-line-unrecorded', else blocked
//   unrecognised 'not-return-view'; with the flag false always 'not-return-view'. F rule: every count of cheapestTabs, dateGridButtons and outboundLinks both
//   recordings agree on becomes an equality condition; a count they disagree on is not used; with no distinctive structure the heading and the links are the rule
// selectors.ts (Task 21.0 the hypothesis; Task 21.3 dates it): Selectors gains returns: { heading: RegExp; resultLink: RegExp }; RETURN_SELECT_VERIFIED: boolean;
//   SELECTORS_VERSION re-dated in Task 21.3; PROOFS['darwin-arm64'].RETURN_SELECT_VERIFIED; flagsOf reports it. No back control (R-second)
// pacer.ts (Task 21.0): reclaim(d: Deadline, timers: Timers): Promise<void>   // for the holder: waits until spacing − tolerance after the last recorded start
//   (fake-timer driven, under d: DeadlineExceeded past it), then records a new last start; spacing 0 records and returns at once
// monthly.ts (Task 21.0): check(scrollRequest, pages = 1): Admission whose reserved adds min(pages, what the cap leaves) (at least 1, else monthly-cap as today)
//   and reports pagesReserved; settle(reserved, allowance, scrollsMade, pagesLoaded = 1) returns reserved less the unused pages, never above the reservation
//   (pure; the class method window-checked as today); rewrite untouched
// pageClaim.ts (Task 21.0): claim(pacer, monthly, scrolls, deps, ctx, pages = 1) returns the admission (reserved, pagesReserved) so the recorder settles
// record.ts (Task 21.0): RECORD_SELECT_PAGES = 4 (a worker literal; Task 21.3 pins it equal to core's FLIGHT_LIST_PAGES_PER_PAIR_MAX); KINDS gains
//   'select-outbound'; flag --select-outbound (a mode flag; needs --origin … --return; --pages 1 to 2); interact() for the kind runs the SERVED sequence:
//   settle on Best, the form check, the Cheapest flow exactly as the session runs it when the entry's CHEAPEST_FLOW_VERIFIED is true, the first pick, then
//   `d = budget.nextFor(spacingMs)`, `pacer.reclaim(d, timers)`, `d = budget.nextFor(pageTimeoutMs)`, goto(url) again, the served sequence again, the
//   second pick excluding the first; the kind claims RECORD_SELECT_PAGES monthly pages up front and settles to guard.documentLoads; stepMs runs from each
//   click (or goto) to its settle, the re-claim's wait recorded apart as waitMs; every kind's meta gains documentLoads (so a results, cheapest or grid
//   recording states its own count; prov-int-r2-008); the page budget is pageBudget(…, 5 × pageTimeoutMs + 3 × spacingMs)
// names.ts (Task 21.3): grammarFor(interstitials, price: 'from' | 'total') builds the one regex with the outbound's clause or the return's F clause (the exact
//   form the recording shows; a "From" clause on a return name is never read as a total); parseOptionName unchanged; export function parseReturnName(name,
//   interstitials?): ParsedOption | null (price 'total'; amountMinor holds the total); RETURN_GRAMMAR_VERSION = '2026-11-<dd>-returns'
// list.ts (Task 21.3): readOptions returns mine: Array<{ option: ParsedOption; name: string }>; readList unchanged
// flights.ts (Task 21.3): FlightsRead gains names: string[] (aligned with `flights`, never in the answer) and parsed: Array<{ flight: ListedFlight; name: string }>
//   (every flight read for the cell, before the 30-cut); readFlights keeps the 30 cheapest as today; the phase's pick outside the 30 replaces the dearest
//   non-pick kept flight (so `flights` stays ≤ 30 with the pick inside) and the counts the page shows come from `parsed.length` (the flights read), unchanged
// returns.ts (Task 21.3): export interface ReturnsRead { listed; returns: ListedReturn[]; moreListed: boolean; optionsUnparsed; optionsOtherCell; parsedForThisCell;
//   resultsStated; currency }; readReturns(f: ListFacts & { viewMore: boolean }, req: Pick<FlightsRequest, 'returnDate' | 'airportNames' | 'returnLimits'>,
//   interstitials?)   // an option is this pair's when its departsOn is the RETURN date, its `from` matches a DESTINATION name and its `to` an ORIGIN name;
//   day offset from the return date with −1 admitted; each return through listedReturnSchema.safeParse (a refusal counts unparsed); R-returns30: the returns
//   fitting req.returnLimits (withinLimits(r, l, 'return')) first by total, then the rest by total, cut to 30, kept in page order; moreListed as the attempt
//   schema says (ListFacts gains viewMore: the View more button's presence, read by listFacts for every view)
// returnPhase.ts (Task 21.3): export async function returnPhase(p: { driver; guard; budget; pacer; monthly; url: string; req: FlightsRequest & { returnLimits };
//   outbound: FlightsRead; S; timers; log; pollMs; startedAt; navigation: ReturnNavigation; admitted: number }): Promise<{ returns: ReturnRead } | { stop: BlockedPage;
//   rule: string }>   // the whole phase; session.ts calls it after the outbound read; the only importer of returns.ts; returns.ts the only importer of
//   parseReturnName (rules.test.ts pins both); every DeadlineExceeded inside it (the re-claim, a click, a poll, listFacts, the form read, the reload) is a
//   transient status, never rethrown (prov-int-r2-001)
// session.ts (Task 21.3): for a flights request with returnLimits on a verified entry the page budget is pageBudget(…, 5 × pageTimeoutMs +
//   (FLIGHT_LIST_PAGES_PER_PAIR_MAX − 1) × spacingMs) and the monthly admission asks for FLIGHT_LIST_PAGES_PER_PAIR_MAX pages (admitted with 1 when fewer than
//   the worst case are left: the phase is then `skipped` `monthly-headroom` before any click); every answer to such a request carries pagesLoaded:
//   guard.documentLoads and, when documentLoads > 1, nextLoadNotBefore; settle(…, pagesLoaded) after the page; the session switches to driver.ts's
//   classifyAfterFailedStep

// ---------- providers (Task 21.4) ----------
// camoufox/flights.ts: the request carries returnLimits when q.returnLimits is non-null; the post passes pages: FLIGHT_LIST_PAGES_PER_PAIR_MAX and
//   requestTimeoutSeconds: flightRequestSeconds(c.pageTimeoutSeconds, c.minSpacingSeconds) for such a request (pages 1 and the provider's timeout otherwise);
//   the result carries returns: answer.returns ?? null, pagesLoaded: answer.pagesLoaded ?? 1, nextLoadNotBefore: answer.nextLoadNotBefore ?? null; after an
//   answer with nextLoadNotBefore the capability calls o.http.holdUntil('camoufox', at) so the limiter's next start waits for it (R-spacing: no refused
//   round trip, no retry spent)
// http/types.ts: HttpKitRequest gains pages?: number and requestTimeoutSeconds?: number (a per-request override of the provider's; discovery keeps its own);
//   HttpKit gains holdUntil(providerId, at: IsoDateTime): void; ProviderHttpLimits gains pageCountOf?: (bodyText) => number | undefined
// http/attempt.ts: passes pages to reserve and pageCount (pageCountOf of the body: the answer's pagesLoaded, 0 admitted; undefined without it) to finalise
// camoufox/limits.ts: export function pageCountOf(bodyText): number | undefined; camoufoxHttpLimits unchanged otherwise (its requestTimeoutSeconds stays
//   discovery's)
// CAMOUFOX_FLIGHT_LIST_INFO.provenanceNote (verbatim; Task 21.1 puts it in §2 Labels): "Google Flights flight list via Camoufox: the outbound flights Google
//   Flights listed for this day pair, each with the lowest round-trip total Google listed with that outbound (its "From" price), and, where this app's worker
//   selected the cheapest of the outbound flights it read that was within the search's longest journey, stops and time windows (or, when none was, the
//   cheapest it read; or, when none of that outbound's returns was within them, the next-cheapest within them, from a fresh load of the same page), the
//   return flights Google listed with that outbound, each with the round-trip total Google listed for that outbound and that return; where no outbound was
//   selected the return flight is neither chosen nor read; when this app's own Camoufox browser read the page on the machine running this app's browser
//   worker, from that machine's address, in the currency the page states. Times are the page's local times. Flight numbers, seller, fare conditions and
//   baggage are not read; nothing is checked with the airline."
// camoufox/preflight.ts: the discovery preflight's PreflightResult carries flags: read.status.flags (every read with a status, ok or refused)

// ---------- db (Task 21.5) ----------
// drizzle/0012_wp21_return_leg.sql (hand-written as 0011, every CHECK a named CONSTRAINT "<table>_<col>_ck", with meta/_journal.json and meta/0012_snapshot.json
//   whose prevId is 0011's id), additive only:
//   ALTER TABLE flight_lists ADD return_status TEXT NULL CHECK (NULL or IN (<RETURN_STATUS>)); ADD return_rule TEXT NULL CHECK (NULL or (length ≤ 80 AND
//   GLOB '[a-z]*' AND NOT GLOB '*[^a-z0-9:-]*')); ADD return_limits_json TEXT NULL CHECK (NULL or (json_valid AND json_type = 'object')); ADD return_tried_all
//   INTEGER NULL CHECK (NULL or IN (0, 1)); ADD pages_loaded INTEGER NULL CHECK (NULL or (integer ≥ 0)); the coupling CHECKs on the last ADD:
//   (return_status IS NULL) = (return_limits_json IS NULL) = (return_tried_all IS NULL); (return_rule IS NOT NULL) implies return_status IN ('skipped',
//   'select-failed', 'not-settled', 'unrecognised', 'read'); return_status IS NULL OR status = 'read';
//   CREATE TABLE flight_list_attempts (list_id FK flight_lists(id) ON DELETE CASCADE, attempt INTEGER NOT NULL CHECK (0 or 1), outbound_position INTEGER NOT
//   NULL CHECK (integer ≥ 0), outbound_fits INTEGER NOT NULL CHECK (IN (0, 1)), listed TEXT NOT NULL CHECK (IN ('returns', 'none-for-cell')), navigation TEXT
//   NOT NULL CHECK (IN ('in-app', 'document')), more_listed INTEGER NOT NULL CHECK (IN (0, 1)), options_unparsed, options_other_cell (integers ≥ 0),
//   results_stated (NULL or integer ≥ 0), PRIMARY KEY (list_id, attempt));
//   CREATE TABLE flight_list_returns (list_id, attempt, position, departs_local, arrives_local, arrives_day_offset INTEGER NOT NULL CHECK (BETWEEN -1 AND 3),
//   duration_minutes, stops, carriers_json, operated_by, total_pence INTEGER NOT NULL CHECK (integer > 0), PRIMARY KEY (list_id, attempt, position), FK
//   (list_id, attempt) REFERENCES flight_list_attempts ON DELETE CASCADE, the flight table's CHECKs on the shared columns);
//   ALTER TABLE provider_requests ADD page_count INTEGER NULL CHECK (page_count IS NULL OR (provider_id = 'camoufox' AND typeof(page_count) = 'integer' AND
//   page_count >= 0)) — R-zero; NULL on every existing row and on every no-page row
// budgetGuard.ts: INSERT_PENDING writes the planned page_count (p.pages ?? 1 for camoufox page rows, NULL otherwise); FINALISE keeps it on an unknown attempt
//   with no pageCount, writes NULL on a no-page attempt, else the answer's (0 admitted); checkCaps adds (p.pages ?? 1) on provider-month and
//   provider-execution for camoufox; providerExecutionRows and the month window count camoufox pages as SUM(COALESCE(page_count, 1)) over page rows, reported
//   as `calls` on those scopes (boundary tests: a row of 0, of 2, and NULL; exactly at the cap; one over)
// ledger.ts: COUNTS's calls for camoufox page rows become the same sum (countsFor's lines agree with usage)
// repositories/flightLists.ts: FlightListInsert gains returns?: ReturnRead | null and pagesLoaded?: number | null (required in Task 21.6; a failed list carries
//   returns null); insert parses `returns` through returnReadSchema (every refinement) and refuses an outboundIndex ≥ flights.length before SQL, writes the
//   columns, the attempts and the returns in the one transaction (a refused return rolls the list back); StoredFlightList gains returns: ReturnRead | null
//   and pagesLoaded: number | null, assembled through parseWith('flight_lists.return_*', returnReadSchema, …) naming the column on a corrupt row (an
//   outbound_position past the flights included); newestPerCell and newestPerDatePair run their lists statement and one further statement for the attempts
//   and returns (ordered by list_id, attempt, position: one probe of the primary key, no new index) inside one read transaction; export newestWithReturns
//   (definitionId, cabin, pointOfSale, scope: { executionIds: readonly string[] } | null): StoredFlightList[]   // the newest list per cell of the definition
//   (the same list newestPerCell would give: never an older one), returned only when its status is read and its return_status is read or no-outbound,
//   with its returns; under an executionIds scope only lists whose executionId is in the scope; two statements, one transaction
// ---------- engine (Task 21.6) ----------
// context.ts: EngineContext gains workerFlags: { get(providerId): Readonly<Record<string, boolean>> | null; set(providerId, flags) } (in memory; set by the
//   discovery preflight (stages/discovery.ts preflightPasses), the on-demand read's preflight and the api's status read; null before any); ProviderRunLimits
//   gains flightRequestSeconds: number | null (api wiring.ts fills it from core's flightRequestSeconds for camoufox)
// stages/flightLists.ts: the plan's returns = ctx.workerFlags.get('camoufox')?.RETURN_SELECT_VERIFIED === true at planning and the snapshot's flightListPages ≥
//   cells.length × FLIGHT_LIST_PAGES_PER_PAIR_MAX (an older snapshot plans outbound-only); before each request with a return phase the step checks, once, that
//   the run's browser window outlasts now + flightRequestSeconds (else the step ends `window` as the gate would; flightPageGate itself unchanged); readPage sends
//   returnLimits = flightLimitsOf(run.snapshot.constraints) only when plan.returns and plan.returnsStopped === null, checks the allowance as `used +
//   (returnLimits ? FLIGHT_LIST_PAGES_PER_PAIR_MAX : 1) > pages`, and, on a `list` result whose returns.status is select-failed, not-settled or unrecognised,
//   patches returnsStopped = its rule so the pass sends none after; writeRow stores returns and pagesLoaded (null for a failed page). No ProviderContext.pages
//   (the provider derives the plan from returnLimits: arch-r2-010)
// stages/flightLists/select.ts: NewestList gains returnStatus: ReturnStatus | null and limits: FlightLimits | null; selectFlightPairs(…, current: FlightLimits,
//   returnsPlanned: boolean): a newest read list younger than 0.9 × refresh is reused when !returnsPlanned, or when returnStatus ∈ RETURN_FINISHED and
//   limits deep-equal `current`; else read (not-verified is therefore re-read once the flag is on: R-unverified)
// snapshot.ts: flightListPages: FLIGHT_LIST_COUNT * FLIGHT_LIST_PAGES_PER_PAIR_MAX (40)
// estimate.ts: withFlights: returns = the worker's flag (above); perPair = returns ? FLIGHT_LIST_PAGES_PER_PAIR_MAX : 1; pairs = min(wanted, floor(monthLeft /
//   perPair), freeLeft) (free calls count requests); pages = pairs × perPair; seconds = pairs × (minSpacingSeconds + 40 + (returns ? RETURN_PHASE_SECONDS_MAX +
//   (perPair − 1) × minSpacingSeconds : 0)); Estimate.flightLists = { pairs, pages, seconds, returns }; FLIGHT_NOTE = '+ flights' and the clause "+ flights, out
//   and back, for up to N date pairs (P pages), about M minutes" (returns) or "+ flights for up to N date pairs, about M minutes"; the binding cap named by
//   comparing in pairs; estimateRemaining the same per planned cell left
// budgetFit.ts: the execution-free-calls line counts flight pairs (requests), the provider-month line the page allowance
// flightRead.ts: the read runs the preflight first (setting workerFlags), sends returnLimits when the flags say the flag is true, stores r.returns,
//   r.pagesLoaded on its row (one read-row builder shared with writeRow), and is refused `fresh` only when the newest list is read, young, and either no return
//   phase is planned for this worker or its returnStatus ∈ RETURN_FINISHED under limits equal to the current ones
// ---------- api (Task 21.6) ----------
// read/datePairs.ts: datePairFigures(loaded, scope, rc, pairings: ReadonlyMap<string, PairingCandidate>) builds the map from newestWithReturns (the read's
//   executionIds scope passed) through cheapestPairing under flightLimitsOf(def.constraints), with fresh = ageHours ≤ refreshHours, underCurrentLimits =
//   deep-equal stored limits, fetchedAt and executionId; assembleDatePairs, read/results.ts (the scoped /results read: the same map, so the detail and the
//   board agree), rankedFigures (the cards) pass it; rankedPairsFor passes an empty map (the step's candidates stay the calendar figures: arch-r2-013); toFigure
//   maps basis 'pairing', gridPrice, the pairing group and pairingRead, and sets fromEarlierSearch for a pairing figure from the list's fetchedAt against the
//   latest parent's startedAt (R-lead)
// read/flightLists.ts: toFlightList maps returns and pagesLoaded
// ---------- web (Task 21.7) ----------
// copy.ts COPY.flights gains: out 'Out:'; back 'Back:'; total 'round-trip total'; pairingHead(which: 'cheapest' | 'next-cheapest') 'With the cheapest outbound read
//   within your limits:' / 'With the next-cheapest outbound read within your limits (the cheapest one's returns were all over your limits):'; pairingHeadOver
//   'With the cheapest outbound read (over your limits):'; pairingHeadWhenRead(which, ago) 'With the <which> outbound read, selected under your limits when
//   read, <ago>:'; limitsChanged 'your limits have changed since; the returns are read again at the next search'; selectedMark(which) 'selected for the returns
//   above' / 'tried first: its returns were all over your limits'; legs { outbound, return }; withinLeg(leg, duration, limit); overLimitLeg(leg, duration,
//   limit); stopsOver(leg, n, max); windowsOutboundOnly 'windows apply to the outbound'; returnMore(n, outside); showAllReturns 'show all return flights';
//   showFewerReturns; showAllOutbound 'show all outbound flights'; showFewerOutbound; returnsNotRead(clause); returnStatus: Record<Exclude<ReturnStatus,
//   'read'>, string> (six texts, §8 Task 21.7); returnsOld; returnsRead(n); returnsNone 'Google listed return flights, none this app could read for these
//   airports and dates'; noOutboundFits(n) 'none of the N outbound flights read is within your limits; the cheapest one's returns are shown'; returnCounts
//   (unread, other); moreListed(stated, read) 'Google listed N return flights; this app read the first M'; triedAll(n, tried); mismatch(returnTotal,
//   fromPrice); totalAppliesTo "this total is for the Out: flight shown"; settingsNotApplied 'airline settings not applied to flights read'; returnNotRead
//   'return leg not read'; headPairing(which, ago, when) 'Outbound flights, and the return flights for the <which> outbound read within your limits · each Back
//   price is the full round-trip total for that outbound and that return · read …'; headPairingOver(ago, when) '… for the cheapest outbound read, which is
//   over your limits …'; readButton(pages, pagesLeft) with pages from FLIGHT_LIST_PAGES_PER_PAIR_MAX ("free, up to 4 pages"); readRefusedPages(n) 'fewer than
//   N pages left this month'; copy/estimate.ts flights(pairs, duration) and flightsOutAndBack(pairs, pages, duration)
// datesView copy: gridShowed(source, when) 'date grid showed' + the source and time as differenceSource/differenceAt do; pairingBeneath(ago) 'return flights read
//   <ago>, older than this search's refresh:' / pairingOtherLimits 'return flights read under earlier limits:'; pairingRead: Record<PairingRead, string>
//   ('flights not read', 'return leg not read', 'no return flight read', 'no pairing within your limits read', …); pairingLabel 'round-trip total, cheapest
//   outbound read within your limits'
// flightLines.ts: limitsOf(d) = flightLimitsOf(d.constraints); legMarks(leg, f, limits, c); returnNote(list, c) (per status; returnsOld for null; the counts and
//   moreListed clauses for a read; null for a clean read); pairingOf(list, limits, now): { attempt; which: 'cheapest' | 'next-cheapest'; outbound; outboundIndex;
//   returns: ShownFlights<ListedReturn>; fits: boolean; selectedNow: boolean (selectOutbound(list.flights, limits).index === outboundIndex for attempt 0, or
//   the second pick for attempt 1); underCurrentLimits: boolean } | null; mismatchOf(list); allReturnsInOrder(returns, limits)
// views/Dates/{Flights,FlightRow,PairingSection,ReturnRow,BoardTable,BoardCard}.tsx, overview.ts, howFar.ts, state/datesState.ts, board.ts: every basis branch an
//   exhaustive switch; isSyntheticRead judges f.gridPrice.provenance too; the board row's figure cell for basis 'pairing' through PriceCell with the list's
//   provenance, the gridPrice PriceCell beneath with gridShowed, pairingLabel once, settingsNotApplied when the search sets airline or layover settings; a
//   calendar figure with a pairing group shows it beneath through PriceCell with pairingBeneath / pairingOtherLimits; pairingRead words per value;
//   ProvidersView unchanged (calls is the page sum); estimateLine.ts states pairs and pages from flightLists.pairs and .pages
```

## 6. Library notes (checked 2026-11-01)

No library API beyond those WP20's §6 verified on 2026-10-31 is used, except the one named first; each is named here
with what this package relies on.

- **Playwright 1.64.1** (through the worker's `LocatorLike`/`PageLike` seams): `Request.isNavigationRequest()` on the
  context's route handler is true only for a document navigation of its frame (a History API change fires
  `framenavigated` with no request; `guard.ts:166-169` already records those as hops, so hops cannot tell the two
  apart: the new counter can). Also `page.getByRole('main').getByRole('link', { name, exact: true })`, `locator.count()`,
  `locator.click({ timeout })`, `page.goto` (the reload is the same `goto` the first view uses), `page.url()`.
- **zod 4.6.7**: `listedReturnSchema` spreads the shared `legFields` object into a fresh `z.strictObject` (never
  `.extend` on a refined schema); `returnReadSchema` refines with `superRefine`; new wire fields use `.exactOptional()`
  so a body without the key parses and a body with `undefined` does not; `z.enum` over `as const` tuples.
- **better-sqlite3 as pinned**: `json_each(?)` for the list-id set; two statements inside one `db.transaction` for one
  read snapshot; `ON DELETE CASCADE` through `flight_list_attempts` to `flight_list_returns`.
- **fast-check** (core's existing dev dependency): the property tests of Tasks 21.2 and 21.3.
- **React 19.3.1 / Testing Library**: the two "show all" toggles are `useState`s with `aria-expanded`; focus stays on
  the pressed toggle (asserted with `document.activeElement`).

## 7. Files

**Create**: `.superpowers/sdd/wp20-search-now/return-page-findings.md` (local; `.superpowers/` is gitignored).
`packages/core/src/flights/returns.ts`, `src/datePairs/pairing.ts`, `src/camoufox/rule.ts`, `src/types/window.ts`; tests
`packages/core/test/flights/{returns,select,chooseReturns}.test.ts`, `test/datePairs/pairing.test.ts`, `test/camoufox/returnsProtocol.test.ts`,
`test/fixtures/pairing.ts` (the shared pairing fixture, `SYNTHETIC`). `apps/camoufox-worker/src/{returns,returnPhase}.ts`; tests
`apps/camoufox-worker/test/{returnNames,returns,returnPhase,returnsRecorded,recordSelectOutbound,flagsProofs}.test.ts`.
`packages/db/drizzle/0012_wp21_return_leg.sql`, `drizzle/meta/0012_snapshot.json`; test `packages/db/test/migration0012.test.ts`.
`apps/web/src/views/Dates/{PairingSection,ReturnRow}.tsx`; tests `apps/web/test/views/dates/returns.test.tsx`, `test/views/dates/logic/pairing.test.ts`.

**Modify**: the spec (Task 21.1); `packages/core/src/flights/{types,limits,choose,index}.ts`, `src/datePairs/{figure,rank,encode,decode,detailLink}.ts`,
`src/camoufox/{protocol,builds,pin}.ts`, `src/ports/{provider,budget}.ts`, `src/api-contract/{flights,definitions,datePairs,results,searches,executions}.ts`,
`src/types/execution.ts`, `src/index.ts`, `packages/core/stryker.config.json`; tests `test/flights/choose.test.ts`, `test/datePairs/{figure,rank,encode,
detailLink}.test.ts`, `test/camoufox/{flightsProtocol,builds}.test.ts`, `test/api-contract/{flights,datePairs,results,searches,executions}.test.ts`.
`apps/camoufox-worker/src/{recordArgs,record,recordDialogs,graph,dialogSettle,gridPage,gridRecord,selectors,driver,guard,classify,ready,names,list,flights,
session,monthly,pacer,pageClaim}.ts`, `apps/camoufox-worker/stryker.config.json`, `test/support/{fakePage,recordedList}.ts`; tests `test/{record,recordArgs,
selectors,driver,guard,classify,ready,names,list,flights,session,rules,status,monthly,pacer,recorded,flightsRecorded,gridRecorded}.test.ts`.
`apps/cli/test/support/deps.ts`. `packages/providers/src/camoufox/{flights,limits,preflight}.ts`, `src/http/{types,attempt,limiter}.ts`; tests
`test/camoufox/{flightList,limits,preflight}.test.ts`, `test/http/{attempt,limiter}.test.ts`. `packages/db/src/schema/{flightLists,providerRequests}.ts`,
`src/repositories/{flightLists,ledger}.ts`, `src/types.ts`, `src/budgetGuard.ts`, `drizzle/meta/_journal.json`; tests `test/{flightLists,budgetGuard.flightLists,
ledger,barrel,client}.test.ts`. `packages/engine/src/stages/{flightLists,discovery}.ts`, `src/stages/flightLists/select.ts`, `src/{context,snapshot,estimate,
budgetFit,flightRead,engine}.ts`, `packages/engine/stryker.config.json`, `test/support/harness.ts`; tests `test/stages/{flightLists,flightListsSelect,
flightListsResume,discoveryPreflight}.test.ts`, `test/{estimate,budgetFit,flightRead,snapshot}.test.ts`. `apps/api/src/read/{flightLists,datePairs,results,
ranked,cards}.ts`, `src/{wiring.ts,bootstrap/engine.ts}`; tests `test/routes/{flightLists,datePairs,results,cards,ranked}.test.ts`.
`apps/web/src/{copy.ts,copy/estimate.ts}`, `src/views/Dates/{flightLines,Flights,FlightRow,BoardTable,BoardCard,board,overview,howFar}.ts(x)`,
`src/state/datesState.ts`, `src/views/Searches/estimateLine.ts`, `apps/web/e2e/selectors.ts`; tests `test/views/dates/{flights,board,overview}.test.tsx`,
`test/views/dates/logic/{flightLines,board,overview,howFar}.test.ts`, `test/state/datesState.test.ts`, `test/views/searches/logic/estimateLine.test.ts`,
`test/fixtures.searches.ts`, `test/msw/searchesHandlers.ts`, `test/copy/*`. `apps/web/PRODUCT.md`, `docs/providers.md`, `docs/setup.md`.

## 8. Tasks

### Task 21.0: The recorder kind, the page counts and the research recordings

**Files**: `apps/camoufox-worker/src/{recordArgs,record,recordDialogs,graph,dialogSettle,gridPage,gridRecord,driver,guard,selectors,ready,classify,monthly,
pacer,pageClaim}.ts`, `test/support/fakePage.ts`, `packages/core/src/camoufox/{builds,pin}.ts`, `apps/cli/test/support/deps.ts`; tests
`apps/camoufox-worker/test/{recordArgs,record,driver,guard,ready,classify,selectors,status,monthly,pacer,recordSelectOutbound,gridRecorded}.test.ts`,
`packages/core/test/camoufox/builds.test.ts`; the findings note. **Produces**: the kind, `guard.documentLoads`, `StepFailed` (renamed in one go),
the view-aware `readFacts` and `listFacts` (with `viewMore`), `clickOutbound`, `linkNames`, `buttonNames`, `tabNames`, `classifyAfterFailedStep`
(driver.ts; the recorder uses it; the session in 21.3), `ProbePage` without the new click, `View 'returns'` with the changed-then-stable settle rule,
the hypothesis `S.returns` and classifier branch, `Pacer.reclaim`, `MonthlyCounter.check(…, pages)` and `settle(…, pagesLoaded)`, `pageClaim`'s
`pages`, `RECORD_SELECT_PAGES`, `documentLoads` in every kind's meta, `RETURN_SELECT_VERIFIED` false everywhere (`FLAG_NAMES`, `NONE`, every pin entry,
`Selectors`, `flagsOf`, `/v1/status`, the CLI's `unsetFlags` built from `FLAG_NAMES`).

The implementer builds the kind and its tests over fakes; the controller runs the live recording. What changes on the
served path: `readFacts` gains one heading lookup (`return-heading`) and reports `outboundLinks` on every poll,
`listFacts` reads the View more button's presence, and the Best and Cheapest classifications are unchanged (pinned).

- [ ] **Write the failing tests** (expected to fail as: unknown argument; `documentLoads`, `clickOutbound`, `linkNames`,
  `reclaim`, `check(0, n)`'s second parameter not there; `StepFailed` not exported; `View` refusing `'returns'` and
  `unsetFlags` missing a key under typecheck; the flag absent).
  - `recordArgs.test.ts` (extend): `--select-outbound --origin LHR --destination JFK --depart 2027-03-14 --return
    2027-03-24` parses to `kind 'select-outbound'`, `pages 1`; `--pages 2` accepted, `--pages 3` refused "--pages must
    be 1 to 2 for --select-outbound"; two mode flags refused; without `--origin` refused as the results kind is.
  - `guard.test.ts` (extend, over `FakeContext`): a main-frame navigation request increments `documentLoads` once; a
    `framenavigated` with a new URL and no request adds a hop and leaves `documentLoads` unchanged; a sub-frame
    navigation changes neither; a refused main-frame navigation increments nothing and sets `refused`; a page's install
    resets `documentLoads` to 0; `decideRoute`'s existing table re-asserted (the allowlist is unchanged).
  - `driver.test.ts` (extend, over `FakePage`): `clickOutbound(name, d, steps)` with exactly one link in `main` named
    `name` clicks it and returns `['link:<name>']`; with none throws `StepFailed('find-outbound', 'not-found',
    'select-outbound')` and clicks nothing; with two `'ambiguous'`; a link of that name outside `main` is not found; the
    click runs under `CLICK_TIMEOUT_MS` within `d`; a `runStep` overrun throws `StepFailed` with `reason 'timed-out'`
    and the flow of its options (the Cheapest flow's overrun carries `'cheapest'`); every former `CheapestStepFailed`
    site (`graph`, `dialogSettle`, `gridPage`, `gridRecord`, `recordDialogs`, `record`) throws and catches `StepFailed`
    with their existing tests green (`gridRecorded.test.ts` included); `readFacts(d, o, 'returns')` counts
    `resultLinks`, `names` and the signature by `S.returns.resultLink` and reports `outboundLinks` by the outbound
    pattern; `readFacts(d, o)` (no view) gives every existing field equal to a literal captured from the unmodified
    code over the same tree, plus `outboundLinks` and `text.returnHeading` with the stated values; `listFacts(d,
    'returns')` reads the return view's links and `listFacts(d)` reports `viewMore` true exactly when the View more
    button exists; `text.returnHeading` and `settle.returnHeading` true exactly when a heading matches
    `S.returns.heading`; `linkNames` returns every link name in `main` with `https://…` runs replaced by `<url>` and at
    most 200; `buttonNames` and `tabNames` the same shapes; `probePage(d)` has no `click`, `clickCheapest` or
    `clickOutbound` (`expectTypeOf` plus a runtime `'clickOutbound' in page` false); `classifyAfterFailedStep(driver,
    cur, steps, S, view)` returns the blocked kind of a challenge page and null for a results page or an overrun lookup.
  - `ready.test.ts` and `classify.test.ts` (extend): `isSettled(…, 'returns', changed)` is false while `changed` is
    false whatever the facts, and with it true needs no fetching and a link by either pattern or the no-flights line,
    never `resultsReturned`, `cheapestSelected` or the heading; `pollUntilSettled` with `changedFrom` stays unsettled
    while the signature equals the pre-click one and `documentLoads` has not grown and no return heading shows (a fake
    that keeps the outbound tree for three polls before the swap settles on the fourth, and one that never swaps
    ends `DeadlineExceeded`); `classifyPageWithRule(f, S, 'returns')` with the flag off is `unrecognised`
    `not-return-view` whatever the facts; with it on, results when the heading and the return links are present,
    `no-flights-line-unrecorded` for Google's line with no link, `not-return-view` otherwise; the blocked rules come
    first (a table over captcha, consent host, sign-in heading, account control, unusual traffic); Best and Cheapest
    classification over the existing fixtures unchanged.
  - `pacer.test.ts` (extend): `reclaim(d, timers)` waits spacing − 2 s from the last start under fake timers, records
    the new start, returns at once with spacing 0, throws `DeadlineExceeded` past `d` without recording a start.
    `monthly.test.ts` (extend): `check(0, 4)` reserves 4 with 4 left (`pagesReserved 4`) and 2 with 2 left, admits 1
    with 1 left, refuses `monthly-cap` with 0; `settle(reserved, 0, 0, 1)` returns 3 of 4 and `settle(reserved, 0, 0, 4)`
    all 4; `settle` with `pagesLoaded` above the reservation keeps the reservation (never above); the window check as
    today. `pageClaim`'s `claim(…, pages)` returns the admission.
  - `recordSelectOutbound.test.ts` (the pattern of `record.test.ts`'s `--cheapest` case, over `FakeContext`; the
    fixture's Best tree holds, in page order: an option for another day (£300), an unparsable name, £451 at 1,600 min
    (the recorder picks by price; limits are production's), £478 at 600 min, £478 at 600 min with another carrier,
    £520 at 700 min; the Cheapest tab present; the script swaps to the Cheapest tree on `tab:Cheapest`, keeps that
    tree for three polls after `link:<the £451 name>` then swaps to the return tree (heading matching the hypothesis,
    three return options in the hypothesis form, a View more button, the outbound names gone), serves the Best tree
    again on the second `goto`, the Cheapest tree on the second `tab:Cheapest`, and a second return tree on
    `link:<the first £478 name>`): the facts carry `kind 'select-outbound'`, the Best and the Cheapest views' `page`,
    `settle`, `names`, `list`, `form`, `headings`, `clicked: ['tab:Cheapest', 'link:<£451 name>', 'goto', 'tab:Cheapest',
    'link:<£478 name>']`, `picks: [{ name, linkIndex: 2 }, { name, linkIndex: 3 }]` (the cheapest on the day, then
    the next-cheapest; ties by page order), per step `after: { url (query stripped), urlChanged, documentLoads,
    changedFromPreClick: true, page, settle, names, list (viewMore true), linkNames, headings, buttonNames, tabNames,
    stepMs (from the click or goto to the settle), waitMs (the re-claim's wait, the spacing advanced under fake
    timers and not in stepMs), settled: true }` for the first selection, the reload (its Cheapest view's facts) and
    the second selection; the £300 and the unparsable options are never picks; a tree with two links of the pick's
    name records `selectFailed: 'find-outbound:ambiguous'` and no `after`; a blocked kind on the poll after any click
    or the reload is a stop with its cool-down and rule exactly as the `--cheapest` case, for each of captcha,
    consent, sign-in, account and unusual-traffic; a return view that never changes from the Cheapest view within
    the step's budget records that step's `after` with `settled: false`, `changedFromPreClick: false` and what the
    last poll read, then ends the page plainly (no further step, never a stop); a re-claim that runs out of its own
    budget records `waitTimedOut: true` for that step and ends the page plainly, never as `not-ready`; the kind claims
    `RECORD_SELECT_PAGES` (4) monthly pages before the first load and settles to `documentLoads` (a fake with one
    document load per selection and one on the reload settles the month to 4; one with in-app selections settles to
    2); the pacer is re-claimed before each of the first selection, the reload and the second selection (its
    last-start record moves each time); the page budget is `5 × pageTimeoutMs + 3 × spacingMs` (the `timers.deadline`
    literal for `pageTimeoutMs` 90,000 and `spacingMs` 30,000: 540,000); the meta names the kind, the entry, the bundle
    and `documentLoads`; a `--results` and a `--cheapest` recording's meta carry `documentLoads` too; `assertClean`
    refuses the worker key and the SOCS value; the recorder's console output for the page is counts, booleans and rule
    words only (no URL, no option, button or tab name); the written file is 0600; the read-back and page close run
    after the whole interaction.
  - `selectors.test.ts`, `status.test.ts` and core's `builds.test.ts` (extend): `flagsOf(selectorsFor(<each entry>,
    <its build>)).RETURN_SELECT_VERIFIED === false`; `/v1/status` reports it; `FLAG_NAMES` holds it; the CLI's
    `unsetFlags()` is `Object.fromEntries(FLAG_NAMES.map((f) => [f, false]))` checked with `satisfies`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/camoufox-worker exec vitest run test/recordArgs.test.ts test/guard.test.ts test/driver.test.ts
  test/ready.test.ts test/classify.test.ts test/pacer.test.ts test/monthly.test.ts test/recordSelectOutbound.test.ts test/selectors.test.ts test/status.test.ts`,
  `pnpm --filter @gmt/core exec vitest run test/camoufox/builds.test.ts`, then `pnpm --filter @gmt/camoufox-worker typecheck` and `pnpm --filter @gmt/cli typecheck`.
- [ ] **Implement.** `KINDS` and `parseRecordArgs` (`MAX_PAGES` stays 3; the kind's own bound is 2). `guard.ts`'s
  counter. `driver.ts` as §5 (`StepFailed(step, reason, flow = 'cheapest')`, every importer renamed in this task;
  `runStep` passes `o.flow`). `S.returns` as a **hypothesis** with a `// why: a hypothesis until select-outbound/<date>
  records the view (Task 21.3 dates it)` line: `{ heading: /^(?:Top |Other )?[Rr]eturning flights$/, resultLink:
  /^[\d,]+ [A-Za-z ]+ round trip total\. |^From [\d,]+ [A-Za-z ]+ round trip total\. / }` (both price forms, so the
  research can see whichever the page uses). `ready.ts` and `classify.ts` as §5 (`pollUntilSettled` takes
  `changedFrom` and reads `guard.documentLoads` through a `loads()` option). `pacer.ts`, `monthly.ts`, `pageClaim.ts`
  as §5. `interact()` for the kind: the served sequence (the Cheapest flow when the entry's `CHEAPEST_FLOW_VERIFIED` is
  true, exactly the session's steps, through `classifyAfterFailedStep`), then the first pick: the recorder lacks
  airport names, so a pick is the cheapest `parseOptionName` result whose `departsOn` is the request's departure day,
  ties by page order, its link name the one the facts hold; before the selection, the reload and the second
  selection: `d = budget.nextFor(spacingMs)`, `pacer.reclaim(d, timers)` (a `DeadlineExceeded` there records
  `waitTimedOut` and ends the page plainly), `d = budget.nextFor(pageTimeoutMs)`; the poll after a click runs under
  `{ ...S, RETURN_SELECT_VERIFIED: true }` with view `'returns'` and `changedFrom` the pre-click signature and
  `documentLoads`; the reload is `driver.goto(url, d)` then the served sequence again and the second pick excluding
  the first; a `DeadlineExceeded` from a step's own deadline records that step `settled: false` with one more
  `readFacts` under `FINALLY_MS * 2` (the `--no-flights` pattern) and ends the page plainly; a blocked kind is
  `stop(...)` as in the `--cheapest` branch. The monthly claim of `RECORD_SELECT_PAGES` and the settle to
  `guard.documentLoads` through `pageClaim`'s `claim(…, 4)` and `monthly.settle(…, loads)`; every kind's `meta` gains
  `documentLoads`. The console line per page names counts and booleans only. `fakePage.ts`: `optionName` gains
  `duration` and `carrier`, plus `returnOptionName({ pounds, from, to, on, duration, carrier, priceForm: 'total' |
  'from' })` and a `viewMore` node. Core: `FLAG_NAMES`, `NONE`, `pin.ts` false on every entry; the worker's
  `Selectors`, `flagsOf`, `PROOFS` (no entry yet); the CLI's `unsetFlags`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/camoufox-worker test`, `pnpm --filter @gmt/core test` and `pnpm --filter @gmt/cli test` at their thresholds; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the recorder's select-outbound kind, the document-load count, the outbound selection step, the page reservation and spacing re-claim, and the return-select flag (false everywhere)`.
- [ ] **The live recording (controller only).** Stop the worker: `pnpm gmt stop --only worker` (docs/setup.md:1065).
  From `apps/camoufox-worker`, two date pairs on the example route, one run each (the recorder's pacer spaces them):
  ```
  env -i HOME="$HOME" PATH="$PATH" USER="$USER" TMPDIR="$TMPDIR" pnpm -s record --select-outbound --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24
  env -i HOME="$HOME" PATH="$PATH" USER="$USER" TMPDIR="$TMPDIR" pnpm -s record --select-outbound --origin LGW --destination EWR --depart 2027-04-10 --return 2027-04-20
  ```
  Then `pnpm gmt start --only worker`. A stop (any blocked kind) ends the research for an operator ruling, as every
  recording does; a `selectFailed`, `settled: false` or `waitTimedOut` outcome is itself a finding, and the controller
  reads the stored `after` facts before deciding whether a second attempt with a revised hypothesis is warranted (at
  most two further runs in total; each claims 4 pages, settled to what it loaded).
- [ ] **The findings note** `.superpowers/sdd/wp20-search-now/return-page-findings.md` (local, never committed; no
  page text, option, button or tab name, or URL with a query; counts, booleans, token classes, pattern descriptions
  and rule words only; the pinned expectations in the tests are `pinOf` hashes and booleans) answers, per recording
  (`select-outbound/<date>/<n>`) and per step (the first selection, the reload, the second selection):
  1. **Navigation**: `documentLoads` before and after the step; `urlChanged`; the path pattern after the step (the
     allowlisted `/travel/flights…` path, as a class); the first view's own count (1 expected; a different count is a
     finding for list and grid pages too). Decision rule → `RETURN_SELECT_NAVIGATION` `'document'` when either
     selection on either recording grew `documentLoads`, else `'in-app'` (the reload is always a document).
  2. **Headings**: the heading names of the return view as a pattern (does one match the hypothesis; are the outbound
     headings gone). → `S.returns.heading`.
  3. **Structure**: on the return view the counts of `cheapestTabs` (and whether one is selected), `dateGridButtons`,
     `resultLinks` by the return pattern and `outboundLinks` by the outbound pattern, `viewMore` (true/false),
     `resultsStated` against the links counted, and which control names a selected outbound (as a class). → the
     classifier's F conditions (§5's rule). Decision rule for the View more and the stated count: neither stops the
     work; the attempt's `moreListed` carries them and the page says so (R-viewmore).
  4. **Return-option grammar** (structural, never quoted): for every `linkNames` entry on the return view, which
     candidate grammar reads it (`parseOptionName` as is; the `'total'` clause; neither), with counts; whether the
     price clause starts with "From" (a boolean per name, counted); whether the leg sentence leaves from a
     destination-airport name and arrives at an origin-airport name on the return date (booleans, counted). Task 21.1
     may quote the token classes of the clause ("a number, 'British pounds round trip total.'"), never a name. →
     `parseReturnName`'s price clause, `S.returns.resultLink`.
  5. **Totals** (decision rule): the return prices carry no "From" on every name, and the minimum return total of each
     selection equals that selected outbound's "From" price on every recording → proceed. **Either otherwise: stop;
     Ian rules before Task 21.1** with the flag staying false.
  6. **Tabs**: is there a Best/Cheapest tablist on the return view, and which is selected after the selection? After
     the reload, the served sequence runs again (the Cheapest flow), so no second-view question remains.
  7. **Dismissals**: did anything intercept a click or need dismissing? → stop for an operator ruling (nothing is
     added by the implementer; a dismissal, if ruled, is an exact-named button inside the results page, as the Cheapest
     pop-up's close is, with its own recorder step).
  8. **Timings**: `stepMs` (from the click or goto to the settle) and `waitMs` of each step. → `RETURN_STEP_SECONDS`
     by §5's rule; Task 21.1 states the worst-case overrun past the browser window's end (§8.2) as
     `flightRequestSeconds` at the install's settings.
  9. **Form**: do the form facts still read the request's dates and one adult after each step? Unchanged → no
     post-click form check; changed but still the request's → the phase runs the form check after each step and a
     mismatch is `unrecognised` rule `form`; a lost one-adult or date → stop for Ian.
  10. **SOCS**: the read-back was `same` on both recordings (anything else is a stop, already handled).
  The note ends with the values Task 21.1 writes: `RETURN_SELECT_NAVIGATION`, `RETURN_STEP_SECONDS`, `S.returns.heading`,
  `S.returns.resultLink`, the return grammar's price clause (token classes), the structural conditions, the
  per-schedule monthly arithmetic (below), and the `PROOFS` sentence for darwin-arm64 (recording keys, the served
  sequence, link counts, "every return name parses", "minimum total equals the From price", "SOCS same").

### Task 21.1: Spec revision 56

**Files**: the spec. No code. **Consumes**: the findings note, Ian's and the orchestrator's rulings.

- [ ] Bump the header to **revision 55 → 56**. Write `### Revision 56: the return leg (2026-11-<dd>)` at the top of
  §17 in the form of revision 55: *Ian decided 2026-11-01* (the purpose; the two phases; what the page shows; the
  click behind its own per-entry flag), *Ian ruled 2026-11-01* (the pairing total leads the figure and the rank, the
  grid price beside it, coverage unchanged; a second outbound when none of the first's returns fit, at most two, and
  the cheapest outbound's returns read anyway when none fits), *What the recording showed* (answers 1–10 in one
  sentence each, no page text), *Rulings on the brief's reviews* (the orchestrator's: the page rule with the spacing
  per document load and the window's worst case; the served sequence recorded; the settle on a changed view; the
  limits applied per direction; stored limits and reuse; finished and transient statuses; the unknown-view stop for
  the run; the mismatch and more-listed lines; planning from the worker's flag; old lists re-read; the reservation
  chain; R-lead's freshness; R-grid; R-synthetic; the second outbound by a fresh load; the worst-case reservation as
  one constant; `pagesLoaded` of 0; the spacing hold; fitting returns kept first; the heads; `not-verified` re-read),
  *Builder's choices* (the selection over every flight read with the pick kept in the 30; the candidates by the
  calendar figures; the return grammar as the one grammar with a price clause parameter; the phase in its own module;
  `no-returns` dropped until the return view's no-flights line is recorded; −1 day offsets for returns; the page sum
  reported as the camoufox page scopes' `calls`), and *What changed* (the section list).
- [ ] Fold each rule into its section (never an amendment block; one rule set per section):
  - **§2 camoufox**: after "*The flight-list read, beside discovery.*": the return phase (the request's `returnLimits`;
    `selectOutbound` over every flight read; the clicks, each a name in the selectors module, gated by
    `RETURN_SELECT_VERIFIED` per entry and dated by a recording of the served sequence; the return view's settle (a
    changed view, then the two-poll rule) and classifier conditions as recorded; the return grammar's clause and
    `RETURN_GRAMMAR_VERSION`, reported as `versions.returnGrammar`; fitting returns kept first; the second attempt by a
    fresh load of the worker's own list URL, the served sequence again, when it is made; the answer's `returns` with
    every status, which are finished and which transient; a view that is not the recorded shape ends the phase with
    the outbound answer and no cool-down and the run sends no further return phase, while a genuine block stops the
    page as any block does; the return view's no-flights line is not yet recorded, so it is `unrecognised` with its
    rule). The *page rule*: line 229's "at most one Google document load" becomes "at most one document load, or for a
    flights request with a return phase at most `FLIGHT_LIST_PAGES_PER_PAIR_MAX`; every Google document load, whichever
    request it belongs to, starts at least `CAMOUFOX_MIN_SPACING_SECONDS` after the last (less the 2 s tolerance), so
    documents per hour stay at most `floor(3600 / spacing)`; a flights request with a return phase takes up to
    `FLIGHT_LIST_PAGES_PER_PAIR_MAX` of them, each reserved in the worker's monthly counts before the first load and
    settled to the documents loaded, each counted on the answer as `pagesLoaded` and in the ledger as `page_count`;
    after such a request the answer states when the next load may start and the app waits for it"; the Limits
    paragraph's spacing sentence says the same; the page budget (five page periods plus the spacing per further
    document) and the app's flights request timeout, `flightRequestSeconds`, discovery keeping its own; "the worker
    opens only the URL form above" gains "and, in the return phase, the documents the page's own selected-flight
    control loads, each on the allowlist, and that same URL form again for a second outbound". Revise "the return
    flight is neither chosen nor read" to "where no outbound was selected"; the provenance note of §5 verbatim; the
    sentence "clicks only names in its selectors module" lists the return phase's click as a verified one (decision
    69's "nothing except Cheapest" is superseded and the §17 entry says so); the Capabilities table row's "no return
    legs" becomes "the return flights listed with at most two selected outbounds, no flight numbers or sellers"; the
    worker's `/v1/status` flags are read by the app and `RETURN_SELECT_VERIFIED` decides whether a return phase is planned.
  - **§3**: "Flight list" gains the attempts and the pairing; "pairing total": the round-trip total Google listed for
    one outbound and one return.
  - **§5.1**: `FlightListQuery.returnLimits`, `FlightListResult.returns`, `pagesLoaded` and `nextLoadNotBefore`,
    `PreflightResult.flags`, `ReserveParams.pages`, `finalise`'s `pageCount`, the camoufox page scopes' `calls` as the
    page sum, http-kit's `holdUntil` and per-request timeout.
  - **§6.2**: the limits a flight read is judged against: the longest journey and `maxStops` per leg, the windows on
    the outbound only; airlines and layovers not applied (said on the board row when set); the outbound chooser
    applies the stops limit too.
  - **§6.5 and §6.9**: the figure rule as §1 states it (Ian's ruling 1 with R-lead): basis `pairing` between verified
    and calendar in the rank, only while the list is fresh and read under the current limits, else the grid price
    leads and the pairing shows beneath with its age; the pairing figure's current keys and `fromEarlierSearch` stated
    exactly; `gridPrice` beneath through `PriceCell` with its provenance; `pairingRead`'s seven values and their words;
    the flight list is still not a results basis for alerts, History or verification; the detail opens on the calendar
    row; the mismatch and more-listed lines; the difference line of revision 55 is replaced by the grid-price line;
    the synthetic banner judges the grid price too.
  - **§7**: migration 0012's columns and tables (§5's text), additive, NULL on every existing row; `provider_requests.
    page_count` (0 admitted) and what the guard sums; the repository's attempts and returns statements inside one read
    transaction; `newestWithReturns` (the same newest list, attached only when finished, the read's execution scope).
  - **§8.1**: the step's plan carries `returns` (from the worker's last reported flag and the snapshot's allowance)
    and `returnsStopped`; the query carries the search's limits only then; the allowance `flightListPages =
    FLIGHT_LIST_COUNT × FLIGHT_LIST_PAGES_PER_PAIR_MAX` and the check per request; the candidates ranked by the
    calendar figures; the reuse rule (a newest `read` list younger than 0.9 × refresh is reused when no return phase is
    planned for this worker, or when its return status is `read` or `no-outbound` under limits equal to the current
    ones; transient, `not-verified`, older or other-limit lists are read again); an older snapshot plans
    outbound-only; the window check per request against `flightRequestSeconds`; a cancel during the phase writes no
    row and the resumed pass reads that pair once; the estimate's pairs, pages, seconds, words and the binding cap in
    pairs; the per-schedule monthly arithmetic (a daily schedule with a 168 h refresh makes about 5 discovery runs a
    month, about 5 × (100 grid + 10 × 4) = 700 of the 1,500 pages at the worst case, fewer as the settle returns
    unused pages); the on-demand read's `fresh` rule and its return phase under the preflight's flag; the error table
    unchanged (a return status is inside a `read` row).
  - **§8.2**: the browser window's worst-case overrun for a flights page with a return phase (`flightRequestSeconds`).
  - **§9**: the recorded suites (`returnsRecorded.test.ts` skips without `select-outbound` recordings) and the CI-run
    proof check (a true flag names recording keys in `PROOFS`).
  - **§10**: `flightListSchema.returns` and `pagesLoaded`; the date-pair response's basis `pairing`, `gridPrice` and
    `pairing` groups and `pairingRead` column; the scoped `/results` figure the same; the card's `cheapest.basis`;
    `GET /executions/:id` unchanged; `usage` unchanged in shape, `calls` on the camoufox page scopes being the page sum.
  - **§11 Flights**: the board row's figure for a read pair (the pairing total through `PriceCell` with the list's
    provenance, the grid price beneath through `PriceCell` with its own source, time and stale mark, the figure
    labelled once as a round-trip total for the cheapest outbound read within the limits, "airline settings not
    applied" when the search sets any, the `pairingRead` words; a pairing older than the refresh or read under other
    limits shown beneath a leading grid price with its age); the block's head per state naming the outbound used
    ("the cheapest outbound read" / "the next-cheapest outbound read", "within your limits" at read time and whether
    the limits have changed since); the pairing section (the heads of §5, "Out: …" with its marks, up to three "Back:"
    lines with the total first, each leg's marks, "windows apply to the outbound", "N more returns read, M outside
    your limits · show all return flights"); the mismatch line; the more-listed line; the status notes with what
    happens next; "none of the N outbound flights read is within your limits; the cheapest one's returns are shown";
    "2 of the N outbounds within your limits were tried" / "other outbounds not tried"; the counts clause; the limits
    line; a list stored before 0012 shows as today; the tie order unchanged; the read button's "up to N pages" and its
    refusal below that many pages left.
  - **§12**: the constants of `core/flights/limits.ts` (`FLIGHT_LIST_PAGES_PER_PAIR_MAX`, `RETURN_STEP_SECONDS`,
    `RETURNS_SHOWN`, `RETURN_ATTEMPTS_MAX`), not settings.
  - **§16**: row 21 with this brief's scope and first failing test ("`selectOutbound` picks the first fitting flight in `compareFlights` order, ties by index").
- [ ] **Run**: `pnpm exec vitest run scripts/wording.test.mjs` and `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts` green.
- [ ] **Commit**: `Specify the return leg (spec revision 56)`.

### Task 21.2: `core`: the return shapes, the limits, the selection rule, the pairing figure, the contracts

**Files**: `packages/core/src/flights/{types,limits,returns,choose,index}.ts`, `src/datePairs/{pairing,figure,rank,encode,decode,detailLink}.ts`,
`src/camoufox/{rule,protocol}.ts`, `src/types/{window,execution}.ts`, `src/ports/{provider,budget}.ts`, `src/api-contract/{flights,definitions,datePairs,
results,searches,executions}.ts`, `src/index.ts`, `packages/core/stryker.config.json`; tests `test/flights/{returns,select,chooseReturns,choose}.test.ts`,
`test/datePairs/{pairing,figure,rank,encode,detailLink}.test.ts`, `test/camoufox/{returnsProtocol,flightsProtocol}.test.ts`, `test/api-contract/{flights,
datePairs,results,searches,executions}.test.ts`, `test/fixtures/pairing.ts`. **Consumes**: Task 21.1's values. **Produces**: §5's core items, every new
field optional as §5 marks it, so every present consumer typechecks unchanged.

- [ ] **Write the failing tests** (expected to fail as: missing exports; `flightLimitsSchema` refusing `maxStops`; the
  protocol refusing the new keys; `figureBasisSchema` absent and the date-pair, results and card schemas refusing
  `'pairing'`; `flightListsStateSchema` refusing `returns`).
  - `select.test.ts`: limits `{ maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null }`
    over, in input order, £92 at 600 min with 2 stops, £86 at 700 min, £80 at 1,560 min, £86 at 900 min, £95 at 800
    min → `{ index: 1, fits: true }` (the £80 is over the journey limit, the £92 over the stops limit; of the two £86
    the shorter); a departure window 08:00–20:00 that excludes index 1 (departs 06:10) → `{ index: 3 }`; under
    `{ maxJourneyMinutes: 500, maxStops: 0, windows null }` every flight is over → `{ index: 2, fits: false }` (the
    cheapest of all); `skip` holding index 1 → `{ index: 3 }`; two fitting flights equal on price, duration, stops and
    departure with different carriers → the lower index; an empty array throws `RangeError`; property (fast-check
    over arrays of `listedFlight` shapes and random limits): `fits` is false iff no flight outside `skip` fits, when
    true the pick fits every limit and no fitting flight compares lower, for every fitting `j` with
    `compareFlights(flights[j], flight) === 0` the pick's index ≤ j, and `flights[index] === flight`.
    `flightLimitsOf({})` is `{ maxJourneyMinutes: null, maxStops: null, departureWindowLocal: null, arrivalWindowLocal: null }`;
    `flightLimitsOf({ maxJourneyMinutes: 1500, maxStops: 0, arrivalWindowLocal: { from: '06:00', to: '23:00' } })` is the literal
    object; `flightLimitsSchema` refuses `maxJourneyMinutes: 0`, `maxStops: -1` and a window `'6:00'`, accepts a body
    without `maxStops`; `withinLimits(f, l, 'return')` ignores both windows and applies journey and stops;
    `withinLimits(f, l)` is today's result plus `stops` (met when `maxStops` is absent or null).
  - `returns.test.ts`: `listedReturnSchema` accepts `arrivesDayOffset: -1`, refuses `-2`, `4`, `totalMinor: 0`,
    `amountMinor`, `'24:00'`; `returnReadSchema` refuses `status 'read'` with `attempts: []`, `status 'no-outbound'`
    with an attempt, `status 'unrecognised'` with `rule: null`, `status 'read'` with `rule 'Select'`, an attempt with
    `listed 'returns'` and no return, a second attempt whose first attempt has a return within `limits`, a second
    attempt with `outboundFits false`; accepts a `read` with two attempts of 30 returns each and refuses 31;
    `RETURN_FINISHED` holds exactly read and no-outbound; `RETURN_TRANSIENT` exactly select-failed, not-settled,
    unrecognised, skipped; `FLIGHT_LIST_PAGES_PER_PAIR_MAX === 4`; `expectedLoads('reload', 'in-app') === 1`,
    `expectedLoads('select', 'in-app') === 0`, `expectedLoads('select', 'document') === 1`; `RETURN_PHASE_SECONDS_MAX
    === 3 × RETURN_STEP_SECONDS` with the fixed literal; `flightRequestSeconds(90, 30) === 570` (5 × 90 + 3 × 30 + 15 + 15).
  - `chooseReturns.test.ts`: the mirror of `choose.test.ts`'s cases with `totalMinor` (five returns of 600/700/1,560/
    900/800 minutes at £1,292/£1,286/£1,280/£1,286/£1,295 → shown £1,286 at 700, £1,286 at 900, £1,292 at 600; the
    shortest within the limits always among `shown`; a return with 2 stops under `maxStops 1` counted in `moreOutside`;
    a return arriving 03:10 under an arrival window 06:00–23:00 is NOT outside; every return outside → the cheapest
    three with `overLimit`); property: `shown.length + moreRead === returns.length`. `choose.test.ts` (extend): every
    existing case unchanged; a flight with 2 stops under `maxStops 1` is outside (`chooseFlightsToShow` applies the
    stops limit too).
  - `pairing.test.ts` over `test/fixtures/pairing.ts` (`SYNTHETIC`; every fixture built through `returnReadSchema.parse`):
    the shared list `PAIRING_FIXTURE` has `flights` of four (the pick at index 2), attempt 0 (`outboundFits true`) with
    returns £1,204 (2 stops) and £1,230 (2 stops), attempt 1 (`outboundFits true`, the £520 outbound at index 3) with
    £1,180 (1 stop) and £1,250 (direct) → under `maxStops 1`, `cheapestPairing` is `{ attempt: 1, returnIndex: 0,
    totalMinor: 118000, outboundFits: true, returnFits: true }` (the api and web tests of Tasks 21.6 and 21.7 assert
    these same literals); a single attempt with `outboundFits false` and a fitting return → `outboundFits false`; a
    single attempt whose returns are all over the limit → the cheapest of all with `returnFits false`; no returns at
    all → null; judged under the limits passed, not `r.limits` (a stored `maxStops 2` and a passed `maxStops 0` reject
    a one-stop return); `pairingLeads` true only with `fits`, `fresh` and `underCurrentLimits` all true (a table).
  - `figure.test.ts` and `rank.test.ts` (extend): `figuresByDatePair(rows, scope, now, pairingOf)` with a candidate
    whose `pairingLeads` is true gives `basis 'pairing'` with `price` the total, `grid` the calendar price it replaced,
    and the calendar candidate's `superseded`/`notSeenInLatest`; with `fresh false`, `underCurrentLimits false` or
    `fits false` the calendar figure stays with the pairing beside it; a verified candidate still wins; the default
    `pairingOf` (none passed) gives today's figures unchanged over the existing fixtures; `rankDatePairs` orders two
    current pairs at equal price verified before pairing before calendar, and ranks a £1,204 pairing after a £86
    calendar figure (price first); `encode`/`decode` round-trip `gridPrice` and the `pairing` group (sparse) and
    `pairingRead` (dense), and a response without the new groups decodes with `gridPrice null`, `pairing null`,
    `pairingRead 'not-read'`; `detailLink` maps `'pairing'` to the `'calendar'` results basis.
  - `returnsProtocol.test.ts`: `flightsRequestSchema` accepts `returnLimits` (all null; with `maxStops` and windows;
    without `maxStops`) and without the key, refuses `returnLimits: undefined`; `pageRequestSchema` refuses a list
    request with `returnLimits`; every answer kind named in §5 accepts `pagesLoaded` (0 included) and `nextLoadNotBefore`
    and without them; the `flights` answer accepts `returns` of every status (a table) and without the key, refuses an
    attempt's `outboundIndex` ≥ `flights.length`, and refuses what `returnReadSchema` refuses; `versionsSchema` accepts
    `returnGrammar`; a `flights` answer with two attempts of 30 returns and 30 flights stays under 90 KB serialised.
    `flightsProtocol.test.ts` unchanged and green.
  - `api-contract` (extend): `flightListSchema` accepts a body without `returns`, with `returns: null`, with a `read`
    block of `outboundIndex` 0 of one flight, refuses `outboundIndex` 1 with one flight; `flightListsStateSchema`
    accepts a plan without `returns`/`returnsStopped` (read back as `false`/`null`) and with them; `datePairs.test.ts`:
    basis `'pairing'`, the `gridPrice` and `pairing` groups' strict ascending `figure`, `pairingRead` dense with the
    figures' length, the 4 MiB bound at 36,400 pairs with the new column and groups; `results.test.ts`:
    `datePairFigureSchema` accepts basis `'pairing'` with `gridPrice` and `pairingRead` and a figure without them;
    `searches.test.ts`: a card's `cheapest.basis 'pairing'`; the redaction sweeps' shape lists gain `returns`,
    `pagesLoaded`, `nextLoadNotBefore`, `gridPrice` and `pairing`.
  - `ports`: `expectTypeOf` cases for `ReserveParams.pages?`, `finalise`'s `pageCount?`, `FlightListQuery.returnLimits?`,
    `FlightListResult`'s `returns?`/`pagesLoaded?`/`nextLoadNotBefore?`, `PreflightResult.flags?`, `Estimate.flightLists.pairs?`,
    `DatePairFigure.gridPrice?`, under `pnpm --filter @gmt/core typecheck`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/flights test/datePairs test/camoufox test/api-contract`; `pnpm --filter @gmt/core typecheck`.
- [ ] **Implement** as §5. `workerRuleSchema` moves to `camoufox/rule.ts` (protocol.ts re-exports it; `count` stays
  private); `localTimeWindowSchema` to `types/window.ts` (api-contract/definitions.ts imports it); `selectOutbound` in
  `choose.ts`; the constants in `limits.ts`; `figuresByDatePair`'s `pairingOf` defaulted so `figuresByDatePair(rows,
  scope, now)` still compiles for the api. Add `src/flights/returns.ts`, `src/flights/types.ts` (an existing file not
  yet under mutation), `src/datePairs/pairing.ts` to `packages/core/stryker.config.json` and move them from `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/core test` at 100%; `pnpm --filter @gmt/core exec stryker run --mutate src/flights/returns.ts,src/flights/choose.ts,src/flights/types.ts,src/datePairs/pairing.ts,src/datePairs/figure.ts,src/datePairs/rank.ts --concurrency 2` ≥ 80%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: return shapes, the limits with stops, the outbound selection rule, the pairing figure and the contract fields`.

### Task 21.3: `camoufox-worker`: the return grammar and reader, the return phase, the answer's page counts, the flag

**Files**: `apps/camoufox-worker/src/{selectors,classify,names,list,flights,returns,returnPhase,session,driver}.ts`, `apps/camoufox-worker/stryker.config.json`,
`packages/core/src/camoufox/pin.ts`, `test/support/recordedList.ts`; tests `test/{returnNames,returns,returnPhase,returnsRecorded,flagsProofs,classify,
selectors,session,rules,names,list,flights,recorded,flightsRecorded}.test.ts`. **Consumes**: Tasks 21.0 (recordings, findings, the pacer, monthly and
page-claim changes), 21.2. **Produces**: §5's worker items.

- [ ] **Write the failing tests** (expected to fail as: `parseReturnName`, `readReturns`, `returnPhase` missing;
  `pagesLoaded` absent from answers; the session's budget and admission unchanged; the flag false).
  - `returnNames.test.ts`: `parseReturnName` over a synthetic return name in the recorded form (the leg from "John F.
    Kennedy International Airport" to "Heathrow Airport" on the return day; carriers `QQ Air`; the price clause as the
    findings fixed it) returns `amountMinor` (the total) in pence and every other `ParsedOption` field; a name whose
    price clause carries "From" is **null**; a name with a stopover sentence parses; an appended sentence is null;
    `RETURN_GRAMMAR_VERSION` matches `/^\d{4}-\d{2}-\d{2}-returns$/`. `names.test.ts` (extend): `grammarFor(interstitials,
    'from')` is `parseOptionName`'s grammar (every existing case green; `GRAMMAR_VERSION` unchanged); `list.test.ts`
    (extend): `readOptions` returns each parsed option with its name, `readList` byte-identical.
  - `returns.test.ts` (synthetic names): facts of 35 return options for the pair (the 31st cheapest by total the only
    one within `maxStops 0`), 2 options leaving on another day, 1 leaving from the ORIGIN airport (`optionsOtherCell`),
    1 unparsable → `listed 'returns'`, 30 returns kept of which the fitting one is first by total and inside the 30
    (R-returns30; the dearest non-fitting one dropped), in page order, `optionsOtherCell 3`, `optionsUnparsed 1`,
    `parsedForThisCell 35`, each return with `totalMinor`, `arrivesDayOffset` from the RETURN date (next day 1;
    previous calendar day −1; 31 Dec to 1 Jan is 1), `currency 'GBP'`; every return accepted by `listedReturnSchema`;
    an option refused by the schema (a 120-character operator) counts unparsed; every option for other days → `listed
    'none-for-cell'`, `returns: []`; `moreListed` true with `viewMore` true, or with `resultsStated` above read +
    unparsed + other, false otherwise.
  - `flights.test.ts` (extend): `readFlights` reports `parsed` (35 of them, each with its name) and `names` aligned
    with the 30 kept; the recorded parity suites unchanged.
  - `selectors.test.ts` and `classify.test.ts` (extend; written after Task 21.1): `S.returns.heading` and `resultLink`
    are the dated values, `SELECTORS_VERSION` re-dated; for each F equality condition, synthetic facts with the count
    equal pass, each count off by one is `not-return-view`, and a count the findings marked disagreeing is not consulted.
  - `returnPhase.test.ts` (the session over `FakeContext` as `session.test.ts`, `selectorsFor` flags of a verified
    entry plus `RETURN_SELECT_VERIFIED: true`, the request `{ mode: 'flights', …REQ, returnLimits: { maxJourneyMinutes: 1500,
    maxStops: 1, windows null } }`; the session's `deps.navigation` seam stubbed to `'in-app'` and `'document'` in turn,
    its default core's constant; the reservation is always core's `FLIGHT_LIST_PAGES_PER_PAIR_MAX`, never stubbed). The
    fixture's Best and Cheapest trees hold, in page order: an other-day option, an unparsable name, £451 at 1,600 min
    (over the journey limit), £478 at 600 min with 2 stops (over the stops limit), £478 at 600 min with 1 stop (the
    right pick: index 2 of `flights`, neither first in page order nor the cheapest), £520 at 700 min; the return trees
    carry the recorded name form; the fake keeps the pre-click tree for two polls after a click before swapping:
    - **the whole phase**: the answer is `kind 'flights'` with `flights` of four, `returns.status 'read'`, `attempts[0]
      .outboundIndex 2`, `outboundFits true`, three returns with `totalMinor` 120400 / 118000 / 125000 in page order,
      `navigation` the stubbed value, `moreListed false`, `rule null`, `triedAll true`, `limits` the request's; the
      page's clicks are exactly `['tab:Cheapest', 'link:<the one-stop £478 name>']`; `selectOutbound(answer.flights,
      limits).index === answer.returns.attempts[0].outboundIndex` and the clicked name is `names[2]` (Review Focus 1);
      with the fake loading one document per selection, `pagesLoaded` is the literal 2 (`'document'` stub) and 1
      (`'in-app'` stub: nothing loaded by the click), the month settled to the same literals; `nextLoadNotBefore` is
      the last load's start + 30 s when a further document was loaded and absent otherwise; `fetchedAt` is after the
      phase; `versions.returnGrammar` is set;
    - **a pick outside the 30**: 31 parsed outbound flights where only the dearest fits → `flights` holds 30 with the
      pick inside, `outboundIndex` names it, the dropped flight is the dearest non-pick, and the counts the page shows
      come from the 31 read (prov-r2-010);
    - **the second attempt**: the first return tree's returns all have 2 stops and a second fitting outbound exists
      (£520) → the clicks continue `['goto', 'tab:Cheapest', 'link:<the £520 name>']` (the reload: `calls.gotos` gains
      the same URL; the pacer re-claimed before it), `attempts.length 2`, `attempts[1].outboundIndex 3`, `triedAll` true
      when no third fitting outbound exists and false when one does; when the second attempt ends transiently the
      status stays `read` with `rule` the second's rule and one attempt; no second attempt when the first had a
      fitting return, or when no further outbound fits;
    - **no outbound fits**: every flight over a limit → one attempt with `outboundFits false` on the cheapest flight,
      no second attempt (Ian's ruling 2);
    - **no-outbound**: Google's no-flights line, or every option for another cell → `returns { status: 'no-outbound',
      attempts: [] }`, nothing clicked, `pagesLoaded 1`;
    - **not verified**: `RETURN_SELECT_VERIFIED: false` → no click, `status 'not-verified'`; a request without
      `returnLimits` → no click, no `returns`, no `pagesLoaded` key;
    - **headroom**: with 3 pages left in the month the admission reserves 1 and the phase is `skipped` rule
      `monthly-headroom` before any click, `pagesLoaded 1`; with exactly 4 left it reserves 4 and runs (the exact-fit
      case); the first view still loads in both;
    - **transient ends**, each asserted through one shared helper (the answer is `kind 'flights'` with the outbound
      flights intact, never `not-ready` or `blocked`, `cooldown.active()` null, `pagesLoaded` the literal loaded, the
      month settled to it): the view never changes from the Cheapest tree within the step's budget → `not-settled`
      rule `select-outbound:not-settled`; the tree changes but lacks the heading → `unrecognised` rule
      `not-return-view`; Google's no-flights line on the return view → `unrecognised` rule
      `no-flights-line-unrecorded`; two links of the pick's name → `select-failed` rule `select-outbound:find-outbound`;
      the click never resolves (fake time past `CLICK_TIMEOUT_MS`) → `select-failed` rule
      `select-outbound:click-outbound`; the spacing wait runs out of its own budget (`'document'` stub, the pacer's
      last start just written, fake time not advanced) → `skipped` rule `spacing`; the page cap expires during
      `listFacts` of the return view → `not-settled` rule `select-outbound:list-facts`; the return view in another
      currency → `unrecognised` rule `currency`; two document loads where one was expected (`'document'` stub, the
      fake loading twice on the click) → `unrecognised` rule `unexpected-navigation`, the phase ended before any
      `listFacts`, `pagesLoaded 3`, the month settled to 3 (within the reservation of 4); one document load where none
      was expected (`'in-app'` stub) → the same, `pagesLoaded 2`, settled to 2; a form read after a step that no
      longer states the request's dates (the findings' answer 9 case) → `unrecognised` rule `form`; in every case the
      page is closed and the SOCS read-back run after;
    - **genuine blocks after any click or the reload**, a table over captcha, consent host, sign-in heading, account
      control and unusual-traffic: the answer is `blocked` with that page, its rule, its cool-down record and
      `pagesLoaded` the literal loaded, exactly as a Best-view poll gives it;
    - **the guard after the click**: a main-frame navigation request to another host, and one to a non-flights path
      on the allowlisted host, are aborted (nothing fetched), set `refused`, and the phase ends `unrecognised` rule
      `guard-refused:<kind>` with no cool-down (sec-002);
    - **a refused first load**: the fake refuses the first `goto` → the answer is `blocked` with `pagesLoaded 0` and
      the month settled to 0 (R-zero);
    - **budgets**: the page budget is the literal 630,000 ms for this request (`5 × 90,000 + 3 × 30,000`) and 180,000
      for a flights request without `returnLimits`; each step's deadline is `nextFor(spacingMs)` then
      `nextFor(pageTimeoutMs)` (the `timers.deadline` sequence pinned); `RECORD_SELECT_PAGES === FLIGHT_LIST_PAGES_PER_PAIR_MAX`.
  - `session.test.ts` (extend): a list, grid or flights page without `returnLimits` carries no `pagesLoaded`; the
    session's catch of `StepFailed` (the Cheapest flow) uses driver.ts's `classifyAfterFailedStep`, its existing cases green.
  - `rules.test.ts` (extend): with the module's verified flags a list page clicks only `tab:Cheapest`; a flights page
    with `returnLimits` clicks `tab:Cheapest`, then at most one `link:` click whose name is a result-link name of the
    page, then at most one `goto` of the same URL followed by `tab:Cheapest` and one more such `link:`; the consent page
    nothing; `moduleImporters('./returnPhase.js')` is `['session.ts']`, `moduleImporters('./returns.js')` is
    `['returnPhase.ts']`; `ProbePage` still has no click.
  - `flagsProofs.test.ts` (CI-run, no recordings; green on every commit): for every entry and flag, `flagsFor(entry,
    build)[flag] === true` implies `PROOFS[entry][flag]` names at least one `<kind>/<date>/<n>` key, and a flag not
    named in `PROOFS` is false; the recorded suites' skip titles name themselves skipped (`skipTitle`). The
    "darwin-arm64 only" expectation lives in core's `builds.test.ts` and is written in the flipping commit.
  - `returnsRecorded.test.ts` (recorded-guarded on `select-outbound`; `recordedList.ts` gains the kind, reading each
    step's `after.list` with the request rebuilt from the recorded URL's query and the dataset's names, reversed for
    the return steps): every return name `parseReturnName` reads states its times and a day offset in −1..3 from the
    return date; `readReturns` over each recording's selections gives `listed 'returns'`, `optionsUnparsed === 0`,
    `optionsOtherCell` pinned as a `pinOf` hash, and the minimum `totalMinor` **equals** the selected outbound's
    `amountMinor` from `readFlights(...).parsed` (asserted true: the decision rule); every step's `documentLoads`
    growth equals `expectedLoads(step, RETURN_SELECT_NAVIGATION)`; `recorded.test.ts` and `flightsRecorded.test.ts`
    unchanged over every recorded page.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/camoufox-worker exec vitest run test/returnNames.test.ts test/returns.test.ts test/returnPhase.test.ts
  test/session.test.ts test/rules.test.ts test/names.test.ts test/list.test.ts test/flights.test.ts test/selectors.test.ts test/classify.test.ts test/flagsProofs.test.ts`.
- [ ] **Implement.** `names.ts`'s `grammarFor(interstitials, price)` and `parseReturnName`; `list.ts`'s names;
  `flights.ts`'s `parsed` and `names`; `returns.ts`; `returnPhase.ts` (the phase, in order: the headroom check
  (`admitted < FLIGHT_LIST_PAGES_PER_PAIR_MAX` → `skipped` `monthly-headroom`) → `selectOutbound` over `outbound.parsed`
  with the pick kept in `flights` → for a document-loading step `d = budget.nextFor(spacingMs)`, `pacer.reclaim(d,
  timers)` (`DeadlineExceeded` → `skipped` `spacing`), then `d = budget.nextFor(pageTimeoutMs)` → `driver.clickOutbound
  (name, d, steps)` (a `StepFailed` → `select-failed` with rule `select-outbound:<step>` after `classifyAfterFailedStep`,
  a blocked kind there being the page's stop) → the poll on `'returns'` with `changedFrom` the pre-click signature
  and `documentLoads` (its own `DeadlineExceeded` → `not-settled`) → a settled `blocked` kind with page ≠
  `unrecognised` → the page's stop; `unrecognised` → the status with the classifier's rule; more loads than
  `expectedLoads` → `unexpected-navigation` and the phase ends (no `listFacts`; fewer loads are recorded on the
  attempt's `navigation`); the form check when the findings say so → `form`; `readReturns(await driver.listFacts(d,
  'returns'), req)` (a `DeadlineExceeded` anywhere → `not-settled` with rule `select-outbound:<step>`) → currency ≠
  GBP → `unrecognised` rule `currency`; then the second attempt when no return of the first fits (`withinLimits(r,
  limits, 'return')` over the attempt's returns) and `selectOutbound(parsed, limits, skip)` gives a further fit: the
  spacing wait, `driver.goto(url, d)` (the fresh load: the served sequence through the session's own settle, form
  check and Cheapest flow, run again from a shared `servedSequence` function the session and the phase both call),
  then the second selection as the first; `triedAll` from whether a further fit remains; every `DeadlineExceeded`
  inside the phase is a transient status, never rethrown). `session.ts` calls it after the outbound read, maps its
  stop into the page's stop handling, carries `pagesLoaded` (`guard.documentLoads`, 0 admitted) and
  `nextLoadNotBefore` onto every answer to a request with `returnLimits` on a verified entry, builds the larger budget
  and the worst-case admission for such a request, settles pages after the page, and switches its Cheapest catch to
  `classifyAfterFailedStep`. `selectors.ts` dates `S.returns`, re-dates `SELECTORS_VERSION`; `classify.ts` adds the
  recorded structural conditions. The `PROOFS['darwin-arm64'].RETURN_SELECT_VERIFIED` sentence from the findings;
  **the flag flips in the last commit of this task only**, in `pin.ts` (darwin-arm64, the pinned build) and core's
  `builds.test.ts` ("true for darwin-arm64 only"), once `returnsRecorded.test.ts` is green over the 21.0 recordings
  and `flagsProofs.test.ts` passes. Add `src/returns.ts` and `src/returnPhase.ts` to `apps/camoufox-worker/stryker.config.json`
  and move them from `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/camoufox-worker test` at its thresholds, the recorded suites green on the controller's machine;
  `pnpm --filter @gmt/camoufox-worker exec stryker run --mutate src/returns.ts,src/returnPhase.ts,src/classify.ts,src/ready.ts,src/names.ts,src/flights.ts,src/monthly.ts,src/guard.ts --concurrency 2` ≥ 80%; `pnpm -r typecheck`.
- [ ] **Commits**: `wp21: the return grammar, the return reader and the kept names`; `wp21: the session's return phase behind the return-select flag, its budget, spacing and page counts`;
  `wp21: the return-select flag set for darwin-arm64 by the select-outbound recordings of 2026-11-<dd>`.

### Task 21.4: `providers`: the limits, the page plan and timeout in the request; the returns, page count and spacing hold in the result; the flags

**Files**: `packages/providers/src/camoufox/{flights,limits,preflight}.ts`, `src/http/{types,attempt,limiter}.ts`; tests `test/camoufox/{flightList,limits,
preflight}.test.ts`, `test/http/{attempt,limiter}.test.ts`. **Consumes**: Task 21.2.

- [ ] **Write the failing tests** (expected to fail as: `returnLimits` not posted; `pages` and `requestTimeoutSeconds`
  not on the request; `pageCountOf`, `holdUntil` missing; `flags` absent from the preflight result).
  - `flightList.test.ts` (extend; msw): `read({ cell, airportNames, returnLimits: {…} })` posts a body carrying
    `returnLimits` exactly and omits the key for `null`; the fake http-kit sees `pages: 4` and `requestTimeoutSeconds:
    570` (the literal for `pageTimeoutSeconds 90`, `minSpacingSeconds 30`) for a request with limits and `pages: 1`
    with no override without; a `flights` answer with `returns`, `pagesLoaded 3` and `nextLoadNotBefore` maps to `{ kind:
    'list', …, returns, pagesLoaded: 3, nextLoadNotBefore }` field for field and `holdUntil('camoufox', at)` is called
    with it; one without the keys maps to `returns: null`, `pagesLoaded: 1`, `nextLoadNotBefore: null` and no hold;
    an answer whose attempt's `outboundIndex` is out of range is `list-error` `parse` `unknown-answer`;
    `CAMOUFOX_FLIGHT_LIST_INFO.provenanceNote` is §5's text verbatim; the sentinel key never appears in the answer,
    the error or the posted body.
  - `attempt.test.ts` and `limiter.test.ts` (extend): `pages` reaches `reserve`; a request's `requestTimeoutSeconds`
    overrides the provider's for that attempt only (the next discovery attempt keeps `pageTimeoutSeconds + 15`); the
    finalise of an attempt whose body states `pagesLoaded 2` carries `pageCount 2`, `pagesLoaded 0` carries `pageCount
    0`, a blocked or not-ready body with `pagesLoaded` carries it, an unknown attempt (timeout, no body) carries no
    `pageCount`, a body without `pagesLoaded` carries no `pageCount` (the guard then writes 1 on a contacted page);
    `holdUntil` makes the limiter's next start for that provider wait until `at` under fake timers and does nothing
    for an `at` in the past.
  - `limits.test.ts` (extend): `camoufoxHttpLimits.requestTimeoutSeconds` unchanged (105 in list mode); `pageCountOf`
    reads 2 from `{"pagesLoaded":2}`, 0 from `{"pagesLoaded":0}`, `undefined` from a body without it or a non-JSON body.
  - `preflight.test.ts` (extend): an `ok` status read puts the worker's `flags` on the result; a refused read with a
    status body does too; an unreadable one gives no `flags`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/providers exec vitest run test/camoufox test/http`.
- [ ] **Implement** as §5. **Run to verify they pass**; `pnpm --filter @gmt/providers test` at its thresholds; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the flight-list capability sends the limits, the page plan and its own timeout, maps the returns and page count, holds the next start, reports the worker's flags`.

### Task 21.5: `db`: migration 0012, the returns and page counts in the repository, the guard and the ledger

**Files**: `packages/db/drizzle/0012_wp21_return_leg.sql`, `drizzle/meta/{_journal.json,0012_snapshot.json}`, `src/schema/{flightLists,providerRequests}.ts`,
`src/repositories/{flightLists,ledger}.ts`, `src/types.ts`, `src/budgetGuard.ts`, `src/index.ts`; tests `test/{migration0012,flightLists,budgetGuard.flightLists,
ledger,barrel,client}.test.ts`. **Consumes**: Task 21.2. **Produces**: §5's db items (`FlightListInsert.returns` optional until Task 21.6).

- [ ] **Write the failing tests** (expected to fail as: the migration absent; `returns` unknown to `insert`;
  `newestWithReturns` missing; the guard counting rows, not pages).
  - `migration0012.test.ts` (the pattern of `migration0011.test.ts`): a database seeded at 0011 with a definition, a
    completed run, a `read` list of two flights, a `failed` list and a camoufox ledger row comes through 0012 with
    every seeded row byte-equal on its old columns, every return column, `pages_loaded` and `page_count` NULL, no
    attempt or return row; the CHECKs refuse (one case each, through raw SQL on `db.raw`): `return_status 'read'` with
    `return_limits_json` NULL, `return_status 'maybe'`, `return_rule 'Select'`, a `return_rule` on `no-outbound`, a
    return phase on a `failed` list, `outbound_position -1`, `attempt 2`, `arrives_day_offset -2`, `total_pence 0`, a
    return row whose attempt row does not exist, `page_count -1`, `page_count` on a non-camoufox row, and accept
    `page_count 0`; `ON DELETE CASCADE` removes a list's attempts and returns; the journal's entry 12 names the tag;
    the snapshot names every CHECK the database carries on `flight_lists`, `flight_list_attempts`,
    `flight_list_returns` and `provider_requests` (0011's snapshot-equals-database case, carried) and its `prevId` is
    0011's id; `barrel.test.ts` and `client.test.ts` migration lists gain it.
  - `flightLists.test.ts` (extend): `insert` with `returns` writes the columns, the attempts and the returns in
    position order in one transaction (a refused return, `total_pence 0` written through a stubbed prepared
    statement, rolls the list and its flights back); `insert` refuses before SQL an `outboundIndex` ≥
    `flights.length`, a `failed` list with non-null `returns`, a `returns` block `returnReadSchema` refuses; `insert`
    without `returns` stores `return_status NULL`; `newestPerCell` and `newestPerDatePair` read `returns` and
    `pagesLoaded` back field for field (`null` for a row without them) in **two** statements inside one transaction
    (the WP19 counter; the existing "one statement" assertions become two with a `// why:`) and nothing more for a
    page of 50 cells; a corrupt `outbound_position` past the flights throws the named-column error; `newestWithReturns`
    returns the newest list per cell (the same `newestPerCell` gives) only when its status is read and its
    `return_status` is `read` or `no-outbound`, with returns, never an older finished list under a newer transient
    one (a cell whose newest is `not-settled` and whose older is `read` returns nothing for that cell), and under an
    `executionIds` scope only lists of those executions; `forExecution` and `cellsOfExecution` unchanged; an
    on-demand list with returns has `executionId null`.
  - `budgetGuard.flightLists.test.ts` (extend): a reserve with `pages: 4` inserts a pending row with `page_count 4`;
    finalise with `pageCount 2` writes 2, with `pageCount 0` writes 0, with none on an unknown attempt keeps 4, with
    none on a contacted attempt writes 1, on a no-page attempt writes NULL; with `flightListPages: 40` and nine rows
    finalised at 4, a reserve of 4 passes at 36 and the next (at 40) throws `provider-execution`; `usage({ kind:
    'provider-execution' })` reports `flightLists.calls` as the page sum and `provider-month` `calls` as the sum
    over camoufox page rows (a row of 0 counts 0, of 2 counts 2, NULL counts 1, a no-page row counts 0); a
    non-camoufox reserve with `pages` writes NULL; `scrollsThisMonth` unchanged. `ledger.test.ts`: `countsFor`'s
    camoufox lines agree with usage's sums.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/db exec vitest run test/migration0012.test.ts test/flightLists.test.ts test/budgetGuard.flightLists.test.ts test/ledger.test.ts test/barrel.test.ts test/client.test.ts`.
- [ ] **Implement** as §5 (the SQL hand-written with `--> statement-breakpoint`, the snapshot drizzle-kit 0.31's shape, "Do not regenerate" in its header as 0011's).
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/db test` ≥ 85% / 70%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: migration 0012 (the return attempts and rows, the stored limits, the ledger's page count, additive) and the repository's returns`.

### Task 21.6: `engine` and `api`: the plan, the limits, the allowance and estimate, reuse, the pairing figure, the wire

**Files**: `packages/engine/src/stages/{flightLists,discovery}.ts`, `src/stages/flightLists/select.ts`, `src/{context,snapshot,estimate,budgetFit,flightRead,
engine}.ts`, `packages/engine/stryker.config.json`, `test/support/harness.ts`; `apps/api/src/read/{flightLists,datePairs,results,ranked,cards}.ts`, `src/wiring.ts`,
`src/bootstrap/engine.ts`; tests `packages/engine/test/stages/{flightLists,flightListsSelect,flightListsResume,discoveryPreflight}.test.ts`, `test/{estimate,
budgetFit,flightRead,snapshot}.test.ts`, `apps/api/test/routes/{flightLists,datePairs,results,cards,ranked}.test.ts`. **Consumes**: Tasks 21.4, 21.5. Makes
required: `FlightListQuery.returnLimits`, `FlightListResult`'s `returns`/`pagesLoaded`/`nextLoadNotBefore`, `FlightListInsert.returns`.

- [ ] **Write the failing tests** (expected to fail as: `workerFlags` and `flightRequestSeconds` absent; `returnLimits`
  never sent; `returns` dropped by the on-demand write; the figure's basis never `'pairing'`; the estimate's clause
  unchanged).
  - `flightListsSelect.test.ts` (extend, one case per status): under `returnsPlanned true` and `current` limits, a
    newest `read` list 150 h old under refresh 168 is `reused` when its `returnStatus` is `read` or `no-outbound`
    **and** its stored limits deep-equal `current`; `read` again when the status is `not-verified` (R-unverified),
    `skipped`, `select-failed`, `not-settled` or `unrecognised`, when `returnStatus` is null, or when the stored limits
    differ (`maxStops` 1 against 0); under `returnsPlanned false` every `read` young list is reused whatever its return
    status (`not-verified` included); a `failed` newest list is `read` always; the property unchanged.
  - `flightLists.test.ts` (extend; the harness with a `workerFlags` stub): with the flag true at planning, the plan
    stores `returns true` and the stub capability receives `returnLimits` equal to the literal `{ maxJourneyMinutes: 1500,
    maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: { from: '06:00', to: '23:00' } }` for a snapshot with
    those constraints and all-null for one without; with the flag false or unread, the plan stores `returns false` and
    no `returnLimits`; a `list` result with returns and `pagesLoaded` is stored with them; a `failed` page stores
    `returns: null`; a `list` whose `returns.status` is `not-settled` patches `returnsStopped 'select-outbound:not-settled'`
    and every later page of the pass carries no `returnLimits` (outbound reads continue; Review Focus 2), while
    `skipped`, `no-outbound` and `read` do not stop it; with `flightListPages 40` the eleventh pair is refused at
    `provider-execution` before any call and an allowance of 39 refuses the tenth (`used + 4 > pages`); a snapshot with
    `flightListPages 10` (older) plans `returns false` and reads 10 outbound-only pages; a request with a return phase
    is not sent when the run's browser window ends sooner than now + `flightRequestSeconds` (the step ends `window`
    with no row, as the gate's refusal does) and is sent when it ends later; `snapshot.test.ts`: the literal
    `flightListPages 40`; a pre-WP21 plan JSON (no `returns` key) resumes as outbound-only (`flightListsResume.test.ts`);
    a cancel during a page (the capability rejects on `run.controller` abort) writes no row and a resumed pass reads
    that pair once and only that pair; `discoveryPreflight.test.ts`: the discovery preflight's result sets
    `ctx.workerFlags` for camoufox; the error table's rows unchanged (one smoke case).
  - `estimate.test.ts` (extend; exact-fit cases, estimate.ts now under mutation): with camoufox in discovery and the
    flag true, `flightLists` is the literal `{ pairs: 10, pages: 40, seconds: 10 × (30 + 40 + 3 × RETURN_STEP_SECONDS +
    3 × 30), returns: true }` (2,800 s for `RETURN_STEP_SECONDS` 40), the assumption "+ flights, out and back, for up to
    10 date pairs (40 pages), about 47 minutes"; with the flag false or unread, `{ pairs: 10, pages: 10, seconds: 700,
    returns: false }` and "+ flights for up to 10 date pairs, about 12 minutes"; the monthly bound in whole pairs at
    `monthLeft` 3, 4 and 5 pages with `perPair` 4 (0, 1 and 1 pairs; "flights for 1 date pair: the browser worker's
    monthly page cap"), the free-call bound in requests (`maxFreeCalls` 105 after 100 grid pages plans 5 pairs); a
    blocked browser line drops the clause (`isFlightNote` on the new prefix); `estimateRemaining` the same per planned
    cell left. `budgetFit.test.ts` (extend): the execution-free-calls line counts flight pairs (10) and the
    provider-month line the page allowance (40); the schedule's monthly load the same.
  - `flightRead.test.ts` (extend; flightRead.ts under mutation): the read runs the preflight first and sets
    `workerFlags`, sends `returnLimits` when the flags say the flag is true and none otherwise; a `list` result with
    returns is stored with them and `pagesLoaded` (read back by `newestPerCell`), a failed read stores `returns: null`
    (data-005); `fresh` only when the newest list is read, young, and either no return phase is planned for this worker
    or its status is `read`/`no-outbound` under equal limits; a young transient, `not-verified` (flag on), old or
    other-limit list is read; the boundary at exactly 0.9 × refresh.
  - `apps/api/test/routes/datePairs.test.ts`, `results.test.ts`, `cards.test.ts`, `ranked.test.ts` (extend; the shared
    `PAIRING_FIXTURE` of core's `test/fixtures/pairing.ts` stored through the repository): a date pair whose figure cell
    has that list (fresh, under the current limits) answers basis `'pairing'`, `pricePence 118000`, the provenance the
    list's (camoufox, scraped-self, the list's `fetchedAt`, `maxAgeHours 0`), `stale` the list's, `gridPrice` the
    calendar figure it replaced with its own provenance and stale mark, `pairingRead 'within'`, `fromEarlierSearch`
    true when the list's `fetchedAt` is before the latest parent's `startedAt` and false for an on-demand list after
    it, `superseded`/`notSeenInLatest` the calendar candidate's; the same list 200 h old under refresh 168 keeps the
    calendar figure with `pairingRead 'within-older'` and the `pairing` group beneath (its total, provenance, stale and
    age); one stored under `maxStops 2` with today's `maxStops 1` → `'within-other-limits'`; one with no fitting
    pairing → `'over-limit'` and the pairing group; a `no-outbound` list → `'no-pairing-read'`; a `not-verified` or
    returns-null list → `'outbound-only'`; no list → `'not-read'`; a verified figure is unchanged; the board's rank
    follows `pricePence`; the scoped `/results` read's figure equals the board's for the same pair (one pairings map);
    the card's cheapest shows the pairing with its provenance and parses the card schema; `rankedPairsFor` ranks the
    calendar figures only (a read pair keeps its place); the response size at 36,400 pairs stays under §10's bound.
    `flightLists.test.ts` (extend): `list.returns` and `pagesLoaded` field for field, `returns: null` for an older row;
    `POST` refuses a body carrying `returnLimits` and the on-demand read takes its limits from the definition; both
    routes still behind the auth gate and the write header. The Providers page's and `gmt browser counts`' tests
    unchanged (`calls` is the page sum).
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/engine exec vitest run test/stages test/estimate.test.ts test/budgetFit.test.ts test/flightRead.test.ts test/snapshot.test.ts`,
  `pnpm --filter @gmt/api exec vitest run test/routes/flightLists.test.ts test/routes/datePairs.test.ts test/routes/results.test.ts test/routes/cards.test.ts test/routes/ranked.test.ts`.
- [ ] **Implement** as §5. `wiring.ts` fills `ProviderRunLimits.flightRequestSeconds` from core's `flightRequestSeconds`;
  `bootstrap/engine.ts` sets `workerFlags` from the boot's status read when camoufox is configured. Add
  `src/stages/flightLists.ts`, `src/estimate.ts` (whole) and `src/flightRead.ts` to `packages/engine/stryker.config.json`
  (their tests added to the command runner's list) and move the pending ones to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` at their thresholds;
  `pnpm --filter @gmt/engine exec stryker run --mutate src/stages/flightLists/select.ts,src/stages/flightLists.ts,src/estimate.ts,src/flightRead.ts --concurrency 2` ≥ 80%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the flight-list step plans the return phase from the worker's flag, sends the limits, counts each pair's pages and stops after a transient view; the pairing figure leads while fresh; returns and pages on the wire`.

### Task 21.7: `web`: the pairing on a search's page and on the board

**Files**: `apps/web/src/{copy.ts,copy/estimate.ts}`, `src/views/Dates/{flightLines,Flights,FlightRow,PairingSection,ReturnRow,BoardTable,BoardCard,board,
overview,howFar}.ts(x)`, `src/state/datesState.ts`, `src/views/Searches/estimateLine.ts`; tests `test/views/dates/{flights,returns,board,overview}.test.tsx`,
`test/views/dates/logic/{flightLines,pairing,board,overview,howFar}.test.ts`, `test/state/datesState.test.ts`, `test/views/searches/logic/estimateLine.test.ts`,
`test/fixtures.searches.ts` (gains `listedReturn`, `returnAttempt`, `returnRead`, `pairingFigure`, each through its schema), `test/msw/searchesHandlers.ts`,
the copy tests. **Consumes**: Task 21.6. Makes required: `flightListSchema.returns`, `FlightLimits.maxStops`, `DatePairFigure.gridPrice/pairingRead`,
`Estimate.flightLists.pairs/returns` (core's optional markers removed here, every reader now set).

- [ ] **Write the failing tests** (expected to fail as: missing COPY keys; `legMarks`, `pairingOf`, `mismatchOf`
  missing; the board rendering basis `'pairing'` as calendar; `overview.ts`'s switch not exhaustive under typecheck;
  `isSyntheticRead` ignoring the grid price; the estimate sentence saying pages for pairs).
  - `logic/flightLines.test.ts` and `logic/pairing.test.ts` (over `PAIRING_FIXTURE`): `legMarks('return', …)` words
    "return 26h: over your 25h limit", "return 2 changes: over your 1-change limit", "return 12h 05m, within your 25h
    limit" (no window mark on a return; no "; return not read" suffix on either leg); `legMarks('outbound', …)` is
    today's `flightMarks` plus the stops mark; `returnNote` gives each of the six non-read statuses' words (the
    transient ones "tried again at the next search, or press Read flights for this date now"; `not-verified` "return
    flights are not yet read on this kind of machine; see the recording session in docs/setup.md"; `skipped` the
    rule's words; `no-outbound` nothing more than the outbound's own line), `returnsOld` for null, the counts clause
    "2 return options unread, 1 for other airports or days" and the more-listed clause "Google listed 12 return
    flights; this app read the first 10" for a read with such counts, null for a clean read; `pairingOf` gives
    `{ attempt: 1, which: 'next-cheapest', outboundIndex: 3, returns.shown[0].totalMinor: 118000, fits: true,
    selectedNow: true, underCurrentLimits: true }` for the fixture (the same literals as the api test), `which
    'cheapest'` for a one-attempt read, `selectedNow false` when `selectOutbound(list.flights, limitsOf(d))` differs
    from the stored index after a limit edit, `underCurrentLimits false` when the stored limits differ, and null for
    every status but read and for a read whose attempts listed no return; `mismatchOf` is non-null exactly when the
    shown attempt's cheapest return total differs from its outbound's `amountMinor`; `limitsOf(d)` equals the literal
    `flightLimitsOf` result for a fixture with every constraint set; `isSyntheticRead` is true for a pairing figure
    with real list provenance and a fixture-provider `gridPrice` (R-synthetic); `overview.ts` marks a pairing figure
    `notChecked`; `howFar.ts` words a pairing figure as the browser worker's flight list; `datesState.ts`'s detail
    patch opens a pairing figure on the calendar basis.
  - `returns.test.tsx` (fake timers; the msw handler serving `PAIRING_FIXTURE` as the list, `maxStops 1`): the block's
    head reads "Outbound flights, and the return flights for the next-cheapest outbound read within your limits · each
    Back price is the full round-trip total for that outbound and that return · read 3d ago, 12 Mar 11:44 · prices from
    Google Flights, not checked with the airline"; the pairing section headed "With the next-cheapest outbound read
    within your limits (the cheapest one's returns were all over your limits):" with the line "Out: depart 07:15,
    arrive 18:05 +1 · 10h 50m · 1 change · QQ Air" for `flights[3]` (its mark; no price on this line); the "Back:" lines
    with the total FIRST ("Back: £1,180 round-trip total · depart 14:20, arrive 06:25 +1 · 12h 05m · 1 change · QQ Air")
    through `PriceCell` compact with the list's provenance, the calendar style, the stale mark and the age, in
    `chooseReturnsToShow` order, each with its marks on the line below and a "−1" arrival rendered with its full date
    for assistive technology; "this total is for the Out: flight shown"; no "from" before a total and "from £" on every
    outbound line (Review Focus 5); the outbound list marks `flights[3]` "selected for the returns above" and
    `flights[2]` "tried first: its returns were all over your limits"; the two toggles are named "show all return
    flights" and "show all outbound flights", each with `aria-expanded`, focus staying on the pressed toggle, keyboard
    operable, the expanded return order `allReturnsInOrder`; the limits line reads "airline settings not applied to
    flights read · windows apply to the outbound" without "return leg not read; " when returns were read, and with it
    for `returns: null` and every non-read status; the mismatch line (both figures through `PriceCell`) when
    `mismatchOf` is non-null and not otherwise; the more-listed line when `moreListed`; a one-attempt read with
    `triedAll false` shows "1 of the 5 outbounds within your limits were tried; other outbounds not tried"; a read with
    `outboundFits false` heads the block "… for the cheapest outbound read, which is over your limits …", the section
    "With the cheapest outbound read (over your limits):", and the line "none of the 4 outbound flights read is within
    your limits; the cheapest one's returns are shown"; a read whose attempts listed none heads WP20's "Outbound
    flights only · …" plus "Google listed return flights, none this app could read for these airports and dates"; a
    read after a limit edit (`selectedNow false` or `underCurrentLimits false`) heads the section "With the cheapest
    outbound read, selected under your limits when read, 3d ago:" and adds "your limits have changed since; the
    returns are read again at the next search"; every non-read status shows WP20's head and its status note (one
    assertion per status that the head does not mention return flights); `returns: null` renders the block with the
    same explicit assertions as WP20's `flights.test.tsx` (no snapshot); the live region says "Flights read for 14 →
    24 Mar, 2 return flights" when a pressed read lands with returns, the status note's words for a non-read status,
    and focus stays on the block when the pairing section appears; the read button reads "Read flights for this date
    (free, up to 4 pages)" and refuses with "fewer than 4 pages left this month" when `monthlyPagesLeft` is below 4; a
    return carrier of `<img src=x onerror=1>` renders as text; "verified" nowhere; a stale list's pairing shows the
    stale mark; a return outside every limit set is marked.
  - `board.test.tsx` and `logic/board.test.ts` (extend): a row with basis `'pairing'` renders its figure through
    `PriceCell` with the flight-list source label, the age and "not checked", labelled "round-trip total, cheapest
    outbound read within your limits", with the grid price beneath through `PriceCell` compact carrying its own
    source ("date grid showed £564 · the date grid, 10 Mar 09:30"), age and stale mark, and "airline settings not
    applied to flights read" when the search sets airlines or layovers and nothing when it sets none; a calendar
    figure with `pairingRead 'within-older'` shows "return flights read 9d ago, older than this search's refresh:"
    and the pairing beneath through `PriceCell` with its age, `'within-other-limits'` "return flights read under
    earlier limits:", `'over-limit'` "no pairing within your limits read" with the pairing beneath, `'no-pairing-read'`
    "no return flight read", `'outbound-only'` "return leg not read", `'not-read'` "flights not read" (never when a
    list exists); the rank column follows the response's order; the phone card the same; the overview carries "not
    checked" on a pairing figure; the tie line and `orderWithinTie` unchanged.
  - `estimateLine.test.ts` (extend): `flightLists { pairs: 10, pages: 40, seconds, returns: true }` reads "+ flights,
    out and back, for up to 10 date pairs (40 pages), about 47 minutes"; `returns: false` "+ flights for up to 10 date
    pairs, about 12 minutes".
  - `flights.test.tsx`: every existing case green with the fixtures extended (`flightListsResponse` entries gain
    `returns: null` by default; the difference line's cases become the grid-price line's).
  - The copy catalogue and rendered-sweep tests cover every new key (no banned word; no "from" in a return template;
    "round-trip total" spelt one way).
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates test/state test/views/searches/logic/estimateLine.test.ts test/copy`; `pnpm --filter @gmt/web typecheck`.
- [ ] **Implement** as §5: `PairingSection` inside `ListSection` after the head; `ReturnRow` as `FlightRow` with the
  price first and `legMarks('return', …)`; the board's figure cell by an exhaustive basis switch; `estimateLine.ts`
  from `pairs` and `pages`; core's optional markers of this task's fields removed (`pnpm -r typecheck` green).
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test` at 70% / 60% (ending with `test:tz`); `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the pairing total leads each read date pair while fresh, with its outbound, return flights and both legs' limits on a search's page`.

### Task 21.8: The smoke, the docs

**Files**: `apps/web/e2e/{smoke.spec,selectors}.ts`, `test/e2e/selectors.test.tsx`; `apps/web/PRODUCT.md`, `docs/providers.md`, `docs/setup.md`.

- [ ] `smoke.spec.ts`: the fixture-only search's flights area still reads "Flight times need the browser worker" (the
  fixture provider has no flight lists, so no e2e run can show a pairing: no jsdom test claims the pairing's 375 px
  layout, and the `@phone` project asserts only what it can see); `SMOKE` gains `pairing` for the pairing section's
  test id, pinned by `selectors.test.tsx` against a rendered block with returns.
- [ ] `apps/web/PRODUCT.md` (:82–86): the flight-list bullet says the browser worker also selects the cheapest outbound
  within the search's journey, stops and time limits, reads the return flights Google lists with it (and the next
  outbound's, from a fresh load of the page, when none fits), each with that pairing's round-trip total, which leads
  the date pair while the list is fresh, the grid price beside it; return flights are read only on worker machines
  whose recording session set the flag (the operator's Mac at present); "no return leg" becomes "one or two outbounds'
  returns, not every pairing". `docs/providers.md` (:24 and :69): the verdict cell and the flight-list paragraph say
  the same in one sentence each, that a date pair costs up to 4 pages, each spaced like any page, and where returns
  are read. `docs/setup.md`: the worker's page-count sentence and the recording session's list gain the
  `select-outbound` kind; the example JSON block unchanged (`docs.test.ts` holds it byte for byte).
- [ ] **Run**: `pnpm --filter @gmt/web e2e` locally (desktop and `@phone`), `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts`, `pnpm exec vitest run scripts/wording.test.mjs`.
- [ ] **Commit**: `wp21: smoke selector and docs for the return leg`.

## 9. Pinned review-focus tests

1. One selection rule: `select.test.ts` (the property, ties by index, stops and windows), `returnPhase.test.ts` (the
   clicked name is `names[2]`, neither first nor cheapest; `outboundIndex` equals core's pick; the pick outside the
   30), `flightLists.test.ts` (db: `outbound_position` read back), `pairing.test.ts`, `datePairs.test.ts` and
   `pairing.test.ts` (web) over the one `PAIRING_FIXTURE` with the same literals (`attempt 1`, `returnIndex 0`,
   `118000`), `returns.test.tsx` (the "Out:" line is `flights[3]`).
2. A wrong return view is not a block and is not repeated: `returnPhase.test.ts` (every transient case through the
   shared helper, the unchanged-view case, the spacing and list-facts deadlines; the block table),
   `flightLists.test.ts` (`returnsStopped` after the first transient status).
3. Transient, old and other-limit lists read again: `migration0012.test.ts`, `flightLists.test.ts` (`returns: null`,
   `newestWithReturns` never an older list), `flightListsSelect.test.ts` and `flightRead.test.ts` (one case per status,
   `not-verified` with the flag on, the limits comparison, the 0.9 × refresh boundary), `returns.test.tsx` (WP20's
   rendering for null).
4. One pages number: `monthly.test.ts` and `pacer.test.ts` (Task 21.0), `returnPhase.test.ts` (the worst-case
   reservation, the settle literals, `pagesLoaded` 0..3 on every kind, the headroom exact fit), `attempt.test.ts`,
   `limiter.test.ts` and `limits.test.ts` (`pages`, the per-request timeout literal 570, `pageCountOf` with 0,
   `holdUntil`), `budgetGuard.flightLists.test.ts` (pending, finalised 0/2/NULL and unknown rows; the sums; exactly
   at the cap and one over), `snapshot.test.ts` (40), `estimate.test.ts` (the pair arithmetic at `monthLeft` 3, 4, 5),
   `budgetFit.test.ts`; the Providers page and `gmt browser counts` unchanged because `calls` is the sum.
5. Totals lead honestly: `returns.test.ts` (core: `totalMinor` ≥ 1, no `amountMinor`), `returnNames.test.ts` (a "From"
   clause is null), `figure.test.ts`/`rank.test.ts` (`pairingLeads`: fits, fresh, current limits), `datePairs.test.ts`
   (api: basis, provenance, `gridPrice`, the pairing group beneath an older or other-limit list, every `pairingRead`
   value, `fromEarlierSearch` from the list's fetch), `board.test.tsx` and `returns.test.tsx` (no "from" before a
   total; the grid price beneath through `PriceCell` with its source, time and stale mark; "verified" nowhere; the
   synthetic banner on a fixture grid price).

Also pinned: every return, pairing and grid price through `PriceCell` with its own provenance and age; coverage, the
buckets and the key unchanged by a flight read (`board.test.tsx` over `overview.test.ts`'s fixtures); the worker
clicks nothing new on a list page, nothing without `returnLimits`, nothing on an entry whose flag is false, loads no
URL but its own form, and the guard's allowlist holds after the click (`rules.test.ts`, `returnPhase.test.ts`,
`guard.test.ts`); a true flag names a recording in `PROOFS` and an unnamed flag is false, CI-run on every commit
(`flagsProofs.test.ts`); list mode over every recorded page unchanged (`recorded.test.ts`); the banned words over every
new string; no page text in any test, console line or the findings note (hashes and booleans only); every fixture that
meets a contract built through its schema's `parse`.

## 10. Definition of done

- Task 21.0's recordings exist on the controller's machine, backed up to `~/.local/share/get-me-there/private/fixtures/camoufox-<date>/`
  (`recordings:backup`); the findings note is written; the stop-and-ask conditions of 21.0 (answers 5, 7 and 9) were
  not met, or Ian ruled.
- Spec revision 56 written (Task 21.1) with every rule of this brief in its section; the WP20 design doc's two
  passages carry the ruling.
- `pnpm --filter @gmt/core test` (100%), `pnpm --filter @gmt/camoufox-worker test`, `pnpm --filter @gmt/providers test`,
  `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` (85% / 70%), the CLI's
  tests, `pnpm --filter @gmt/web test` (70% / 60%, ending with `test:tz`), each green; the worker's recorded suites
  (`recorded`, `flightsRecorded`, `gridRecorded`, `returnsRecorded`) green on the controller's machine.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`,
  `node scripts/check-mutation-globs.mjs` (nothing pending for WP21 once `status` is `merged`), `pnpm test`.
- Mutation at ≥ 80% with timed-out mutants under 5%: `pnpm --filter @gmt/core mutate` (`flights/{returns,choose,types}.ts`,
  `datePairs/{pairing,figure,rank}.ts` among its list), `pnpm --filter @gmt/camoufox-worker mutate` (`returns.ts`,
  `returnPhase.ts`, `classify.ts`, `ready.ts`, `names.ts`, `flights.ts`, `monthly.ts`, `guard.ts`),
  `pnpm --filter @gmt/engine mutate` (`stages/flightLists/select.ts`, `stages/flightLists.ts`, `estimate.ts`, `flightRead.ts`).
- `RETURN_SELECT_VERIFIED` true for darwin-arm64 only, named by `PROOFS` with the recording keys of the served
  sequence; false on every other entry; `/v1/status` reports it; `flagsProofs.test.ts` green in CI on every commit.
- `pnpm --filter @gmt/web e2e` green on the desktop and `@phone` projects; CI's `e2e` job green on the PR.
- `pnpm exec vitest run scripts/wording.test.mjs scripts/workflows.test.mjs` green, and
  `git diff main...HEAD | grep -nP '\b[Bb][Oo][t](s?\b|[A-Z_-])'` returns nothing; no commit message names a vendor's
  site or a data-collection method.
- No orphaned vitest, Stryker, Playwright or browser process after the runs; the worker is running again after the recording.
- The PR description (PR #38, or its successor) carries the changed-file count and the CodeRabbit route; every
  CodeRabbit thread fixed and resolved.

## 11. Open questions

None. Ian's two rulings of 2026-11-01 (the pairing total leads; a second outbound, and the cheapest outbound's returns
read anyway when none fits) and the orchestrator's rulings on both reviews are folded into the text above. Three
conditions still stop the work for Ian inside Task 21.0, as its findings note says: a "From" price on a return name
or a minimum return total that differs from the selected outbound's "From" price on any recording (answer 5),
anything that needs dismissing or intercepts a click (answer 7), and a form that loses the request's dates or its one
adult after a step (answer 9).
