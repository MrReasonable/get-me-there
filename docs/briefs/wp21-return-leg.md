---
wp: 21
title: The return leg (the cheapest outbound within the limits is selected, its return flights and the shown pairing's booking options read, and the cheapest seller's price leads the date pair)
owner: opus
depends_on: [20]
spec_sections: ["§2 camoufox", "§3", "§5.1", "§6.5", "§6.9", "§7", "§8.1", "§9", "§10", "§11", "§12", "§16", "§17 revision 56"]
reviewers: [product-owner, provenance-auditor, provider-integration-expert, cost-and-budget-reviewer, data-model-reviewer, search-strategy-reviewer, ui-reviewer, code-architect, test-strategy-reviewer, security-reviewer]
mutate: {"@gmt/core": ["src/flights/choose.ts", "src/datePairs/rank.ts", "src/datePairs/figure.ts", "src/flights/types.ts", "src/flights/limits.ts", "src/flights/returns.ts", "src/datePairs/pairing.ts"], "@gmt/camoufox-worker": ["src/classify.ts", "src/ready.ts", "src/names.ts", "src/flights.ts", "src/monthly.ts", "src/guard.ts", "src/returns.ts", "src/offers.ts", "src/returnPhase.ts"], "@gmt/engine": ["src/stages/flightLists/select.ts", "src/estimate.ts", "src/stages/flightLists.ts", "src/flightRead.ts"]}
pending: {}
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
answered in the text below. Task 21.0 is done (2026-11-01, commits 88276c36…309db3c3): the recorder kinds
`--select-outbound` and `--select-return` are built, the live research is recorded (select-outbound/2026-11-01/3–4,
select-return/2026-11-01/1–4, backed up) and the findings note is written; two stop-and-ask conditions held and Ian
ruled the same day: the return list prices every pairing "From <price>" (the cheapest seller's), so the worker also
selects the shown pairing's return and reads the booking view's offers ("Continue to book with <seller>[, <fare>] for
<price> British pounds", stated, never "From"), opening the "<count> more booking options" expansion first, and the
headline is the cheapest offer's stated price. Every value this brief once left to a decision rule is a literal now (§5), and
the third quick re-review (55 findings: 16 High, 28 Medium, 11 Low) with the orchestrator's rulings on it (R-worst, R-estimate,
R-retry, R-low-pages, R-window, R-sellers, R-board, R-pick, R-view, R-refused, R-e2e, R-nav, the shared fixture) is folded in.** Ian ruled: (1) the pairing total leads: a date pair whose flights were read takes the
cheapest pairing total within the search's limits as its headline figure and board rank, the date-grid price beside it,
pairs not read keeping the grid price marked as such (this supersedes WP20's "a flight read never changes a date pair's
price or rank"; coverage buckets are unchanged); (2) a second outbound: when no return of the cheapest outbound within
the limits fits, the next-cheapest outbound within the limits is tried (at most two a pair), and when no outbound fits
at all the cheapest outbound's returns are read anyway and the pairing is marked over the limit. The orchestrator's
rulings (R-lead, R-grid, R-synthetic, R-second, R-reserve, R-zero, R-spacing, R-settle, R-returns30, R-heads, R-order,
R-viewmore, R-unverified, the first round's page rule, served sequence, limits, finished statuses, unknown-view stop,
mismatch line, planning from the flag and the reservation chain, and the 21.0 rulings: an activation is the keyboard
one on the matched element, never a pointer click, force, coordinates or a covering element; a booking control is
never activated; the page budget covers every page period of the served sequence) are folded in where they apply. The
research phase is done; spec revision 56 (Task 21.1) states the recorded values, then the build runs task by task,
each building alone.

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans`, task by task, in the order below. Steps use `- [ ]` checkboxes. Task 21.0's live
> recording is run by the controller, never by an implementer.

**Goal.** For each of the 10 cheapest date pairs (and on demand), the browser worker selects the cheapest outbound
within the search's limits, reads the return flights Google lists with it (and, when none fits, those of the next
outbound within the limits, from a fresh load of the list page), selects the shown pairing's return, opens the booking
view's "more booking options" and reads the offers Google listed; a search's page leads each read date pair, while its
list is fresh and was read under the current limits, with the cheapest offer's stated price for that pairing, names its seller
(and fare) as "cheapest of N offers read", shows "Out:" and up to three "Back:" lines (the returns as the "from"
prices Google words them), both legs judged against the limits, links the date pair to Google Flights and never to a
seller, and says plainly which outbound the pairing used and when a return or booking read failed, keeping what was read.

**Architecture.** The worker's flights page gains a return phase after the outbound read, in its own module: core's
one selection rule picks the outbound among every flight read for the cell, the driver activates that option's link
from the keyboard (focus, then Enter: the recorded way, behind the per-entry flag `RETURN_SELECT_VERIFIED`), the page
is polled until the view has changed from the outbound list and settled, the return reader (the outbound grammar: the
return names share it, "From" clause included) reads the return options (fitting ones kept first), and, when no return
fits and a second outbound fits, the list page is loaded again (a fresh, spaced, counted page; the served sequence
again) and the next outbound is selected. Then, behind `BOOKING_SELECT_VERIFIED`, the shown pairing's return is
activated the same way, the booking view is polled until it has changed and settled, its one "more booking options"
control is activated, and the offer reader reads the offers Google listed; no offer, grouped seller control or anything else on
the booking view is ever activated, and the guard refuses a seller's navigation and, while an activation settles, any document
navigation at all (R-worst). Every document load is a page: at most two a request (the first view and the second outbound's
reload), one core constant, reserved in the worker's monthly counts before the first load and settled down to the documents
loaded, carried as `pagesLoaded` on the answer, through http-kit, the ledger, the guard and the usage read. The answer carries a `returns` block with the attempts, the booking read and the limits the selection used;
the contract, the capability, migration 0012 (additive), the engine step (the limits and the worker's flags in the
plan), the api's figure (the cheapest seller's price leads while fresh and under the current limits) and the page carry
it through. A return or booking view that is not the recorded shape ends the phase with what was read intact and no
cool-down, and the run sends no further return phase; a genuine block after an activation stops the page as any block does.

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
  core's one table (`labels/mainPath.ts`). One spelling: "round trip" on every Out, Back and outbound price ("from £478 round trip", "Back: £1,180 round trip"; 21.7 ui-004), "round-trip total" in the provenance note; never "round trip total".
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
- **No live load**: Task 21.0's recorder runs are done. No task runs the worker against Google, and the worker's rules
  are unchanged except the activations and the one reload of this package's return phase, each behind its flag and each
  a name in the selectors module or the worker's own URL form. Every activation is the keyboard one (the matched element
  focused, then Enter): never a pointer click, force, coordinates, a covering element or a dispatched event.
- **Every task builds alone** (R-order): a contract field, a type field and a schema member are added in the task that
  produces them as optional (`.exactOptional()` on the wire, `?:` on an interface, a new enum value admitted but not
  yet produced) with every consumer named, and are made required only in the task that updates the last consumer;
  §5 names that task per field; each task's pass step includes `pnpm -r typecheck`. No import cycle: a module shared
  by `camoufox/` and `flights/` lives in a leaf module. No two files in one directory differ only by letter case. A
  branch on a figure's basis is an exhaustive `switch` with a `never` default.
- **Secrets in tests are sentinels** (`test-worker-key-0123456789abcdef0123456789abcdef`); the redaction sweep gains
  every new answer shape (`returns`, `booking`, the offers, `pagesLoaded`, `nextLoadNotBefore`, the return rows, the
  pairing figure and the grid price). Seller and fare names are page text held to `FLIGHT_TEXT` and rendered as text
  only; synthetic sellers in tests are `QQ Travel` and `QQ Fares`.
- **Package boundaries**: `web` imports only `core`; `engine` never imports `api`; `node scripts/check-boundaries.mjs`
  passes.
- **Commits**: plain commits, `wp21: <what>` (the PR lands by squash-merge). Every commit ends with the trailer
  `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`. Never a bare `git stash`.
- **CodeRabbit**: count the PR's changed files; at 150 or fewer the app reviews it, above 150 run the CLI and say so
  in the PR. Before the merge, read the app's inline threads and outside-diff list, fix each, push, resolve each.
- **Windows known failures** (`ci/windows-known-failures.txt`): no task below depends on POSIX file modes beyond the
  recorder's existing 0600 writes, which its tests already guard; none is expected.

## 1. Global constraints

- **The cheapest offer's price leads while it is fresh (Ian, 2026-11-01; R-lead; R-sellers).** A date pair whose newest list for
  its figure's airport pair has a finished return read, a pairing within the search's limits, a finished booking read of that
  pairing whose offers are complete (its cheapest offer equals the return's "from" price, or no "more booking options" control
  and no grouped seller control remained after the expansion), is not stale by the per-price rule (its age within the search's camoufox
  refresh) and was read under the current limits (its stored limits equal `flightLimitsOf` of today's constraints)
  takes the cheapest offer's stated price for that pairing as its headline figure and its board rank, through `PriceCell` with the
  flight list's provenance (source "the browser worker's flight list", fetch time, "the cheapest of the sellers read for these two
  flights" (never "the lowest seller price": 21.7 persona H1), "not checked with the airline", never "verified"), the row naming which outbound the pairing used, its outbound and
  return departure times beside the price, and the mismatch mark where it applies (R-board); the date-grid price it replaced
  is shown beneath it through `PriceCell` with its own source, age, "not checked" and stale mark (R-grid). When the
  list is older than the refresh or was read under other limits, the grid price leads and the pairing is shown beneath
  with its age. A date pair whose outbound flights were read but has no pairing within the limits keeps the grid price
  with its own mark; a pairing whose booking read did not finish, or whose offers may be incomplete, shows beneath the grid price
  as "from £X, sellers not read" or with "a cheaper seller may not have been read"; "flights not read" is shown only when no
  flight list exists and only on a search whose flight lists are read, "loading flights" while the flight-lists request is
  pending and the mark kept, with one line above the board, when it failed (R-heads; 21.7 prov-004). The words are always "offers read", never "each seller" or "every seller". The rank's "current" keys
  of a pairing figure (`superseded`, `notSeenInLatest`) are the calendar candidate's it replaced; its `fromEarlierSearch`
  is true exactly when the list's `fetchedAt` is before the latest parent run's `startedAt` (an on-demand list read
  after that start counts as from the latest search). Coverage, the buckets and the month key are unchanged by any
  flight read; the synthetic banner judges every price group in the read, the grid price included (R-synthetic).
- **What a price is** (the 21.0 finding and Ian's ruling). The return list words every return "From <price> … round
  trip total": the cheapest seller's price for that outbound and that return, a lower bound. The page words a return's
  price "from £X round trip", never as the total, exactly as it words the outbound's. A seller's offer on the
  booking view is a stated price ("for <price> British pounds"), in GBP pence, as read; the shown pairing's headline is the cheapest
  offer's, named with its seller and fare as "cheapest of N offers read"; it is never computed and never shown without naming
  that it is for one outbound and one return read (the board row carries their departure times; the search page the flights). When the cheapest offer differs from the return's "from" price (equal on
  every recording after the expansion), the page says so in one line naming both figures; nothing is reconciled. When
  the return view stated more results than were read, or showed a "View more" control (every recorded return view
  does), the page says Google listed more return flights than this app read; the control is not activated
  (R-viewmore). A grouped "View <seller>, …" control and a seller's booking control are never activated; the page
  offers no seller's link (booking stays on Google: the date pair's "Open in Google Flights" link only).
- **The limits applied**: the longest journey on each leg's duration, the per-direction `maxStops` on each leg's stops,
  and the departure and arrival windows on the outbound's local times only (the definition has no return windows; the
  page says "windows apply to the outbound"). The selection, the chooser (outbound and return), every "within your
  limits" mark and the pairing figure apply exactly these, and nothing on the page says the pairing is within the
  limits "as a whole". Airlines and layovers are not applied ("airline settings not applied to flights read", said in
  the block and, when the search sets any, on the board row of a pairing figure).
- **Pages** (the page rule; R-second; R-reserve; R-worst). A page is one Google document load (spec §2). An activation (the
  outbound's, the return's, the expansion) never loads a document: from its press until its view settles the guard aborts every
  main-frame document navigation, allowlisted or not, and the step ends transient (`unexpected-navigation`), nothing loaded,
  nothing unspaced, no seller's host reached. A flights request with a return phase therefore loads at most
  `FLIGHT_LIST_PAGES_PER_PAIR_MAX = 2` documents: the first view and the second outbound's fresh load of the list page, which is
  the one spaced step (`RETURN_SPACED_LOADS = 1`); the guard also aborts any further main-frame navigation once the documents
  loaded reach the request's reservation. The constant is one source in core for the worker's reservation, the app's
  reservation, the allowance and the bound the estimate states. Before the reload the worker waits out the spacing (the pacer re-claimed, under the step's own budget); no spacing wait
  precedes an activation. The app's gate admits a request only when the browser window outlasts the request's own seconds,
  checked immediately before the first load, after the lease and limiter waits (R-window; no page starts past the window's
  end). The worker reserves the worst case in its monthly counts before the first load and settles down to the documents loaded
  (never above: the guard stops a load the reservation does not cover); with fewer pages left in the month than the worst case
  but at least one, the request is an outbound-only read of one page, never a refusal, on the worker's side (`skipped`
  `monthly-headroom`) and on the app's (no `returnLimits` sent, the on-demand read likewise; R-low-pages). Every answer to such
  a request states `pagesLoaded` (0 when the first load was refused), which the ledger, the guard, the estimate and the usage
  read carry. An in-app change is one interaction, counted nowhere (as the Cheapest click is). After a request that loaded the
  reload the answer states when the next load may start, and the app's next request waits for it (R-spacing). No new setting (§12).
- **Planned from the worker's flags**: the return phase is planned (its pages, seconds and the estimate's "out and
  back" words) only when the worker last reported `RETURN_SELECT_VERIFIED` true, and the booking read inside it only
  when it also reported `BOOKING_SELECT_VERIFIED` true; a worker that reports either false, or has not been read, is
  planned without that step, and the run sends `returnLimits` (with `booking: true | false`) only as its plan says.
  Docs promise returns and sellers only where the flags are on.
- The worker's rules hold: one page at a time, the spacing per document load, the cool-downs, consent cookie,
  signed-out profile, page gate, GBP check, no challenge ever answered, nothing clicked but the names its selectors
  module marks verified, no URL but its own form. The additions are the selected outbound's link (activated at most twice a pair, the second time after a fresh load of the
  worker's own list URL), the shown pairing's return link and the booking view's one "more booking options" control, each
  activated from the keyboard, only in `flights` mode, only from the Cheapest view (the recorded sequence; a Best fallback runs
  no return phase: R-view), only when the request carries `returnLimits`, and only on an entry whose `RETURN_SELECT_VERIFIED`
  (and, for the return and the expansion, `BOOKING_SELECT_VERIFIED`) a recording of the full served path set (R-e2e).
- Money in integer pence; timestamps `toISOString()` text; dates `YYYY-MM-DD` on the wire; no local-time `Date`
  arithmetic (a return's day offset is calendar arithmetic in UTC from the return date, −1 to 3).

## 2. Review Focus

Five conditions the plan implies and no section states outright; each is pinned by a test in the task named:

1. **One selection rule, end to end.** The outbound the worker clicks is `selectOutbound` over every flight read for
   the cell under the request's limits (journey, stops, windows), the answer's `attempts[0].outboundIndex` names it
   inside `flights`, the stored `outbound_position` equals it, the page's "Out:" line is that flight, the board's
   headline price and the page's shown pairing come from one shared fixture (`@gmt/core/testing`) through one core rule
   (`cheapestPairing`, its last-attempt form `bookingReturnOf` for the worker's return pick, then `cheapestOffer`), the fixture
   makes the right pick neither the first in page order nor the cheapest, and a tie on the "from" price is broken the same way
   in the worker and the app (Tasks 21.2, 21.3, 21.5, 21.6, 21.7).
2. **A wrong return or booking view is not a block, and it is not repeated.** After an activation, a view that is not
   the recorded shape, a view that never changes from the one before, an activation or spacing step that fails or
   times out, or a view that does not settle ends the phase (or the booking read inside it) with a transient status,
   everything read before it intact, no cool-down, no `blocked` answer, the page's own `not-ready` never triggered (no
   `DeadlineExceeded` of the phase is rethrown), and the run sends no further return phase; while a captcha, consent,
   sign-in, account or unusual-traffic page after any activation is `blocked` with its cool-down exactly as on a
   Best-view poll; and the Cheapest view's status line that matches the no-flights pattern never settles a view on its
   own (Tasks 21.3, 21.6).
3. **Transient, old and other-limit lists are read again, once; finished ones are not.** A row stored before 0012, a row read
   without a return phase, a row whose return or booking status is transient, a `not-verified` row (return or booking) once the
   worker reports that flag true, and a row read under other limits are read again by the next step and allowed on demand,
   whatever their age; a row whose two newest lists both ended transient waits for the refresh (reused as finished, shown with
   its status; R-retry); a row whose return status is `read` or `no-outbound` and whose booking
   status, when a booking read was planned, is `read` or `no-pairing`, under the current limits and younger than
   0.9 × refresh, is reused (Tasks 21.5, 21.6, 21.7).
4. **The pair's pages are one number everywhere.** The worker reserves `FLIGHT_LIST_PAGES_PER_PAIR_MAX` (2) pages per
   return-phase request and settles to the documents loaded, never above (the guard refuses a load past the reservation); every answer to such a request states
   `pagesLoaded`; the ledger row's `page_count` is the plan while pending, the answer's count when finalised (0
   admitted), the plan on an unknown attempt; the guard's camoufox page scopes count it as their `calls`, the
   snapshot's `flightListPages`, the estimate's pages and the Providers page follow; the app's flights request has its
   own timeout covering the phase's worst case, and discovery keeps its own (Tasks 21.0, 21.2–21.6).
5. **Prices lead honestly.** A return's price is always worded "from" (as Google words it) and an offer's never; the figure's
   `PriceCell` for a read pair is the cheapest offer's stated price, carries the flight list's provenance, "cheapest of N offers
   read", which outbound the pairing used and never "verified"; the grid price beneath it carries its own provenance, its own
   source named first and no "from" (21.7 prov-009: it is the grid's price for the date pair, not a return's lower bound); a pairing older than
   the refresh, read under other limits, without a finished booking read or with offers that may be incomplete does not lead; a pair with no pairing within the limits keeps
   the grid price with its mark; the contract refuses a return or an offer without a price and an offer that is not a
   seller's stated one (Tasks 21.2, 21.6, 21.7).

## 3. Scope

**In**

- Task 21.0 (done): the recorder kinds `select-outbound` and `select-return`, the guard's document-load count, the
  keyboard activation, the pacer's re-claim, the monthly worst-case reservation and settle, both flags false, the
  recorded suites, the live recordings and the findings note.
- Spec revision 56 (Task 21.1) from the findings and the rulings.
- `core`: the return and offer shapes, `selectOutbound`, `cheapestOffer`, the limits (stops, windows per direction),
  the pairing figure, its basis and freshness rule, `FLIGHT_LIST_PAGES_PER_PAIR_MAX`, `flightRequestSeconds`, the protocol's `returnLimits`,
  `returns`, `pagesLoaded` and `nextLoadNotBefore`, the ports' `pages` and `pageCount`, `FlightListQuery.returnLimits`,
  `FlightListResult.returns`, `PreflightResult.flags`, every strict schema that carries a basis or a plan
  (`flightListSchema`, `flightListsStateSchema`, `datePairFigureSchema`, the card's `cheapest`, the date-pair columns,
  `detailLink`), `Estimate.flightLists.pairs/returns`, the provenance note, the rule-token leaf module.
- `camoufox-worker`: `RETURN_SELECT_VERIFIED` and `BOOKING_SELECT_VERIFIED` dated and set (`PROOFS`, `/v1/status`),
  the return and booking views positively recognised by the classifier and the settle rules (changed from the view
  before, then stable; never on the status line alone), the return reader (fitting returns kept first), the offer
  reader and grammar, the return phase module (selection, reload, second selection, the return's selection, the
  expansion, the offers), `pagesLoaded` and `nextLoadNotBefore` on the answers, and `versions.offerGrammar` (the return
  names use the one option grammar: no second grammar version; final ruling A-M4).
- `providers`: the limits, the page plan and the flights request's own timeout through http-kit, `returns`,
  `pageCountOf`, the limiter hold from `nextLoadNotBefore`, the preflight's flags.
- `db`: migration 0012 (additive), the repository's returns, offers and stored limits, `newestWithReturns`, the
  guard's and ledger's page counts (as the camoufox page scopes' `calls`).
- `engine`: the worker's flags on the context (from the preflight and the api's status read), the plan's `returns`,
  the limits in the query, the allowance per worst case, the window check per request, the step's stop after a
  transient return phase, reuse of finished lists under the same limits, the on-demand read's `fresh` rule, the
  estimate's pairs, pages, seconds and words, budgetFit.
- `api`: the pairing figure on the board, the cards and the scoped `/results` read (one pairings map), `returns` on the
  wire; `cli`: nothing (`gmt browser counts` reads `calls`, which is now the page sum).
- `web`: the board's figure (the cheapest offer's price with its seller words, the pairing's times, the mismatch mark, the
  grid-price `PriceCell` beneath, the marks), every basis reader (`overview.ts`, `howFar.ts`, `datesState.ts`, `BoardCard.tsx`,
  `SearchCard.tsx`, `Results/ResultsHeader.tsx`, `COPY.basisName`, `Provenance.tsx`'s calendar sources, `board.ts`'s synthetic
  guard over every price group), the flights block (head
  per state naming the outbound used, the pairing section with its seller line and "N sellers read", "Back:" lines
  with their "from" prices first, both legs' marks, the mismatch and more-listed lines, status notes with what happens
  next, the counts clause; no seller link anywhere), the estimate sentence's pairs and pages, the read button's pages,
  the Providers page's camoufox count.
- Docs: `apps/web/PRODUCT.md`, `docs/providers.md`, `docs/setup.md`; the smoke's selector.

**Out** (owner in brackets)

- Flight numbers, airport codes per segment, seller, baggage, booking (spec §2: still not itinerary search; WP7's
  verification owns bookable offers and seller links). Return-leg time windows as definition fields (a later package,
  if Ian wants them). A "View more" activation on the return view, the grouped "View <seller>, …" control, any seller's
  booking control, and a back control (each a later package with its own recorder step and flag, or never).
- Reading returns for more than two outbounds a pair, or returns on the Travelpayouts or SearchApi paths.
- Verifying `RETURN_SELECT_VERIFIED` and `BOOKING_SELECT_VERIFIED` on `darwin-x64`, `linux-arm64` and `linux-x64`
  (WP17's per-entry recording sessions, run when Ian next runs them; each stays false until its own recording of the
  served sequence).
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
// @gmt/camoufox-worker (src/), as Task 21.0 left it (commits 88276c36…309db3c3)
View = 'best' | 'cheapest' | 'returns' | 'booking' (ready.ts:8); isSettled(page, settle, view, changed) (the return rule: changed, no fetching, a link by either
  pattern or the no-flights line; the booking rule: changed, no fetching, ≥ 1 offer); pollUntilSettled(…, { view, changedFrom, loads })
Selectors.returns { heading; resultLink } (the hypothesis, confirmed), Selectors.booking { offer: /^Continue to book with .+ for [\d,]+ [A-Za-z ]+$/,
  moreOptions: /^\d+ more booking options?$/, path: '/travel/flights/booking' }; RETURN_SELECT_VERIFIED, BOOKING_SELECT_VERIFIED (false everywhere; flagsOf)
Driver.clickOutbound(name, d, o, onActivate?) / clickReturn(name, d, o, onActivate?) / clickMoreOptions(d, o, onActivate?): the keyboard activation (find,
  focus, press Enter on the one matched element; flows select-outbound / select-return / select-more-options; StepFailed(step, reason, flow) with `detail`
  a ClickFailure word); listFacts(d, view) with viewMore; readFacts(d, o?, view) with outboundLinks, text.returnHeading and, on 'booking', the offer
  buttons' count and signature; classifyAfterFailedStep; ProbePage omits the three activations; classify.ts: 'returns' positively recognised (heading and
  links) and 'booking' → blocked unrecognised 'booking-view' until Task 21.3
GuardState.documentLoads; Pacer.reclaim(d, timers) (refuses a wait that reaches its deadline); MonthlyCounter.check(scrolls, pages = 1) / admit(scrolls, pages)
  with pagesReserved (all when they fit, else 1); settle(reserved, allowance, scrollsMade, pagesReserved = 1, pagesLoaded = pagesReserved) (pure and class);
  pageClaim.ts claim(pacer, monthly, scrolls, deps, ctx, pages = 1, whole = false)
recordArgs.ts: kinds 'select-outbound' and 'select-return', SELECT_MAX_PAGES = 2; record.ts: RECORD_SELECT_PAGES = 4, RECORD_SELECT_RETURN_PAGES = 4,
  selectOutboundCapMs = 6 × pageTimeoutMs + 3 × spacingMs, selectReturnCapMs = 5 × pageTimeoutMs + 3 × spacingMs; recordSelect.ts (the served sequence,
  pickOf, the steps; only record.ts imports it), researchNames.ts, researchProbe.ts (leaf modules, recorder-only); every kind's meta carries documentLoads;
  recorded suites test/{selectRecorded,bookingRecorded}.test.ts; core's MINOR_EXPONENT (the ISO 4217 exponent table the recorder's price comparison uses)
PageSession.page / read (session.ts:417-573: settle on Best, form check, Cheapest flow behind CHEAPEST_FLOW_VERIFIED, View more, listFacts,
  readFlights | readList; its answer's view: 'cheapest', 'best-fallback' or null); the Cheapest flow's inline classify-after-failed-step block
  (session.ts:487-500) and its `budget.next()` (capped at 2 × pageTimeout from the page start); noFlightsAnswer; `contacted` set before goto
pageBudget(timers, pageTimeoutMs, started, capMs): PageBudget { d; next(); nextFor(ms); onExpire }                       // budget.ts
LOOKUP_TIMEOUT_MS = 5000; CLICK_TIMEOUT_MS = 10_000; CLICK_LOG_MARGIN_MS = 1000; POLL_TIMEOUT_MS = 20_000; runStep (throws StepFailed(step, reason, flow,
  detail?)); stableAcross (Previous { signature; links; at }); PageFacts; SettleFacts { linkSignature; … }; ListFacts; classifyPageWithRule(f, S, view);
  ClassifyRule; GuardState { hops; frameUrls; refused; documentLoads } (hops gains the main frame's URL on `framenavigated` too, guard.ts:166-169, so a
  History API change adds a hop and no request; every main-frame navigation URL, aborted ones included, is a hop, and the classifier reads an
  off-allowlist hop as `blocked off-allowlist` unless `refused` is read first)
Selectors; SELECTORS; SELECTORS_VERSION; selectorsFor; PROOFS; flagsOf                                                   // selectors.ts
ParsedOption; parseOptionName; GRAMMAR_VERSION; MONTHS; group; grammarFor (module-private)                               // names.ts
readOptions(f, req, interstitials): { list: ListRead; mine: ParsedOption[] }; readList                                   // list.ts
FlightsRead; readFlights; dayOffset (0..3); splitCarriers (flights.ts); airportMatches; pointOfSaleOf
Pacer { claim(): Claim; release(); reclaim(d, timers) } (TOLERANCE_MS 2 s; the last start persisted; busy while held)   // pacer.ts
KINDS; parseRecordArgs; RecordArgs; MAX_PAGES = 3; RECORDED_BY; RecordingRefused; interact (record.ts); meta() (record.ts)
Outcome; Seen; StopFacts; writeRecording; writeUnrecorded; test/support/{recordedList,fakePage,fakeContext,timers}.ts (fakePage's optionName and
  returnOptionName take duration and carrier; calls.focuses / calls.presses record the activations)
// @gmt/providers
flightListCapability; CAMOUFOX_FLIGHT_LIST_INFO; postToWorker(o, { path, body, tileIndex, ctx, scrolls? }); fetchedAtWithinRequest
camoufoxHttpLimits (one ProviderHttpLimits for list, grid and flights requests; requestTimeoutSeconds list pageTimeoutSeconds + 15; limits.ts:56-59);
  pageClassOf; scrollCountOf; classifyWorkerAnswer; http/types.ts HttpKitRequest.scrolls?, ProviderHttpLimits.requestTimeoutSeconds (:59), HttpKit (:151); http/attempt.ts (scrolls to reserve, scrollCount to
  finalise); the limiter (two Bottleneck instances per provider id, with maxWaitMs on its queue; no not-before option)
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
  providers' http limits only; ProviderRunLimits is built in engine/src/context.ts buildContext's limitsOf); read/statusSources.ts:298 (the api's one
  worker status read: the Status view's; no boot read of the worker exists)
// @gmt/cli: apps/cli/src/camoufox/counts.ts (`gmt browser counts` takes month.calls as pages); apps/cli/test/support/deps.ts unsetFlags() (a full literal of FLAG_NAMES)
// @gmt/web
COPY.flights (copy.ts; readButton hard-codes "1 page"; differenceSource/differenceAt name a source and a time); COPY.basisName (verified, calendar);
  copy/estimate.ts flights(pairs, duration); views/Searches/estimateLine.ts:151-154; views/Searches/SearchCard.tsx:102 (`calendar={cheapest.basis ===
  'calendar'}`); views/Results/ResultsHeader.tsx (:65 figureDiffers compares bases, :78/:85 the same calendar test, :96 COPY.basisName[figure.basis]);
  components/Provenance.tsx CALENDAR_SOURCES (no 'scraped-self'); views/Dates/{Flights,FlightRow,BoardTable,BoardCard}.tsx (BoardCard.tsx:136 maps
  non-verified to 'calendar');
  flightLines.ts; board.ts (isSyntheticRead:132-145 judges price and cheaperCached); overview.ts:192 ('calendar' → notChecked); howFar.ts:26;
  state/datesState.ts:145 (the figure's basis as a ResultBasis); views/Providers/ProvidersView.tsx:70-80 (u.calls as "N of 1,500");
  test/fixtures.searches.ts; test/msw
```

## 5. Interfaces produced

Each item names the task that builds it and, for a field a later task fills, the task that makes it required (R-order).
Every value the findings fixed is a literal here (Task 21.1 writes it into the spec, Task 21.2 into the code).

```ts
// ---------- core (Task 21.2 unless marked) ----------
// camoufox/rule.ts (leaf: imports nothing): export const workerRuleSchema (moved from protocol.ts, which re-exports it); const count stays module-private
//   (returns.ts imports the leaf; nothing new reaches the barrel)
// flights/types.ts: const legFields (module-private zod shape, spread by both schemas); export type LegTimes = Pick<ListedFlight, 'departsLocal' | 'arrivesLocal'
//   | 'durationMinutes' | 'stops'> (what withinLimits judges)
export const listedReturnSchema = z.strictObject({ ...legFields, arrivesDayOffset: z.number().int().min(-1).max(3), fromMinor: z.number().int().min(1) });
//   GBP pence: the return's "From" price (the lowest Google listed for the selected outbound with this return, the cheapest seller's), named for what it is
//   (prov-r3-003); the day offset is from the RETURN date (−1: a date-line return arriving the previous calendar day); the outbound's offset stays 0..3
export type ListedReturn = z.infer<typeof listedReturnSchema>;
// flights/limits.ts: export const RETURNS_SHOWN = 3; export const RETURN_ATTEMPTS_MAX = 2;
export const RETURN_NAVIGATION = ['in-app', 'document'] as const; export type ReturnNavigation;
export const FLIGHT_LIST_PAGES_PER_PAIR_MAX = 2;             // R-worst: the first view and the second outbound's reload; an activation never loads a document (the
//   guard refuses one while it settles), so this is the reachable bound, one source in core for the worker's and the app's reservation, the allowance and
//   the bound the estimate states; as recorded a pair loads 1, or 2 with a second outbound
export const RETURN_SPACED_LOADS = 1;                        // the reload: the one step the pacer is re-claimed before
export const RETURN_PAGE_PERIODS = { booking: 8, returnsOnly: 6 } as const;   // page periods of the budget: first view, Cheapest, selection, reload, Cheapest,
//   selection, and with a booking read the return's selection and the expansion
export const RETURN_STEP_SECONDS = 40;                       // recorded: the largest step 27,891 ms (the reload's settle) rounds to 30 s; the floor of 40 applies
export const RETURN_PHASE_SECONDS_MAX = { booking: RETURN_STEP_SECONDS * 5, returnsOnly: RETURN_STEP_SECONDS * 3 } as const;   // 200 / 120
export const RETURN_SECOND_OUTBOUND_RATE = 0.5;              // R-estimate: the share of pairs needing the second outbound; no rate was recorded (the recorder always
//   made the second selection), so the typical figure counts 1.5 pages a pair; a later recording of the served path may replace it
export function flightRequestSeconds(pageTimeoutSeconds: number, minSpacingSeconds: number, booking: boolean): number;   // the app's timeout for a flights
//   request with a return phase: RETURN_PAGE_PERIODS × pageTimeoutSeconds + RETURN_SPACED_LOADS × minSpacingSeconds + 15 (read-back, close, discard bounds)
//   + 15 (the round trip) = 780 (booking) / 600 (returns only) at the defaults (90 s, 30 s); (120, 45, true) → 1,035
export function flightPagesPerPair(flags: Readonly<Record<string, boolean>> | null): 1 | 2;   // the ONE rule for pagesPlanned, the plan, readPage's
//   allowance check and the estimate's bound: FLIGHT_LIST_PAGES_PER_PAIR_MAX when flags?.RETURN_SELECT_VERIFIED === true, else 1
export const BOOKING_OFFERS_MAX = 40;                        // offers one booking read keeps (recorded 23 and 19 after the expansion), the cheapest first by price
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
// the booking read (Ian's ruling of 2026-11-01), one per list, of the shown pairing
export const BOOKING_STATUS = ['read', 'no-pairing', 'skipped', 'select-failed', 'not-settled', 'unrecognised', 'expand-failed', 'not-verified'] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];
//   read: the expansion made (or no control present) and at least one offer read; no-pairing: no return was listed on any attempt, nothing selected; skipped:
//   no booking step was made, with its rule (`monthly-headroom`, `spacing`, `not-cheapest-view`, `reload:<end>`: the booking is read only on the view the
//   phase stands on); select-failed, not-settled, unrecognised: the return's activation, the booking view's settle or its shape (rule names the step;
//   `more-options-count` when two or more expansion controls show, nothing pressed); expand-failed: the expansion's activation failed or the expanded
//   view did not settle (the offers read before it are kept, `expanded false`); not-verified: BOOKING_SELECT_VERIFIED false on the entry
export const BOOKING_FINISHED: ReadonlySet<BookingStatus> = new Set(['read', 'no-pairing']);
export const BOOKING_TRANSIENT: ReadonlySet<BookingStatus> = new Set(['select-failed', 'not-settled', 'unrecognised', 'expand-failed']);   // sets bookingStopped
export const offerSchema = z.strictObject({ seller: flightTextSchema, fare: flightTextSchema.nullable(), priceMinor: z.number().int().min(1) });   // one offer:
//   "Continue to book with <seller>[, <fare>] for <price> British pounds", the price stated (never "From"), GBP pence by the ISO 4217 exponent
export type Offer = z.infer<typeof offerSchema>;
export const bookingReadSchema = z.strictObject({
  status: z.enum(BOOKING_STATUS), rule: workerRuleSchema.nullable(),       // rule non-null exactly for skipped, select-failed, not-settled, unrecognised, expand-failed
  attempt: count.nullable(), returnIndex: count.nullable(),                // the pairing selected (into attempts[attempt].returns); non-null unless no-pairing/not-verified/skipped
  expanded: z.boolean(),                                                   // the "more booking options" control was activated and the view settled after it
  moreControl: z.boolean(),                                                // a further expansion control remained (never pressed; recorded: none)
  grouped: count,                                                          // grouped "View <seller>, …" controls seen (never activated; their fares are not read)
  offers: z.array(offerSchema).max(BOOKING_OFFERS_MAX),                    // the offers read, the cheapest first by price then page order
  unparsed: count, nonGbp: count,                                          // offer buttons dropped: a name the grammar refuses; a price in another currency (R-sellers)
  offersStated: count.nullable() })                                        // offer buttons counted before the cut, when above BOOKING_OFFERS_MAX, else null
  .superRefine(…);   // status read ⇒ offers.length > 0; offers non-empty only for read and expand-failed (test-r3-001); the rule rule; attempt/returnIndex
                     // non-null exactly for read, select-failed, not-settled, unrecognised, expand-failed
export type BookingRead = z.infer<typeof bookingReadSchema>;
export function offersComplete(b: BookingRead, fromMinor: number): boolean;   // R-sellers: the cheapest offer equals the return's "from" price, or (no moreControl
//   and grouped === 0); a read that is not complete never leads and is shown "a cheaper seller may not have been read"
// count is one local `const count = z.number().int().min(0)` in returns.ts (a `// why:` line: api-contract/common.ts's countSchema would pull api-contract into
//   flights/); flightTextSchema is exported from flights/types.ts (off the barrel) for offerSchema
export const returnAttemptSchema = z.strictObject({
  outboundIndex: count,                       // into the list's `flights`
  outboundFits: z.boolean(),                  // the outbound met every limit when selected (false only on the no-outbound-fits attempt)
  listed: z.enum(['returns', 'none-for-cell']),
  moreListed: z.boolean(),                    // R-viewmore: the view showed a "View more" control, or stated more results than this app read (returns + unparsed + other)
  returns: z.array(listedReturnSchema).max(FLIGHT_LIST_MAX_FLIGHTS),   // R-returns30: the returns fitting the request's limits first (by total), then the rest,
  optionsUnparsed: count, optionsOtherCell: count, resultsStated: count.nullable() })   // cut to 30, kept in page order
  .refine((a) => (a.listed === 'returns') === a.returns.length > 0);
export const returnReadSchema = z.strictObject({
  limits: flightLimitsSchema,                 // the limits the selection used (stored; reuse and the figure's lead compare them)
  status: z.enum(RETURN_STATUS), rule: workerRuleSchema.nullable(),   // rule non-null exactly for skipped, select-failed, not-settled, unrecognised, and for
                                              // a `read` whose second attempt ended transiently (the first stands; the rule says why there is no second)
  attempts: z.array(returnAttemptSchema).max(RETURN_ATTEMPTS_MAX),    // in order made; non-empty exactly when status is read
  triedAll: z.boolean(),                      // no further outbound within the limits remained untried
  booking: bookingReadSchema.nullable() })    // the booking read of the shown pairing; null when the request asked for none (booking false)
  .superRefine(…);   // (status === 'read') === (attempts.length > 0); the rule rule above; attempts[1], when present, has outboundFits true and attempts[0]
                     // has no return within `limits` (a second attempt is made only then); booking.attempt, when set, is the LAST attempt (the view the
                     // phase stands on) and booking.returnIndex < that attempt's returns.length
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
export function compareReturns(a: ListedReturn, b: ListedReturn): number;   // fromMinor, duration, stops, departure; the caller breaks the rest by index
export function chooseReturnsToShow(returns: readonly ListedReturn[], l: FlightLimits): ShownFlights<ListedReturn>;   // the chooser's shared body (comparator,
//   count, leg 'return') with compareReturns and RETURNS_SHOWN
// datePairs/pairing.ts (new, pure; Ian's ruling 1; R-pick)
export interface Pairing { attempt: number; returnIndex: number; fromMinor: number; outboundFits: boolean; returnFits: boolean }
export function cheapestPairing(r: ReturnRead, flights: readonly ListedFlight[], l: FlightLimits): Pairing | null;
//   over every attempt's returns: the cheapest by fromMinor, then compareReturns (duration, stops, departure), then attempt, then index, among those where
//   the outbound and the return both fit `l`; with none fitting, the cheapest of all (the same order) with its fits flags; null with no return at all. Judged
//   under the limits passed (the current search's); the stored limits decide reuse and whether the pairing may lead
export function bookingReturnOf(r: Pick<ReturnRead, 'attempts' | 'limits'>, flights: readonly ListedFlight[]): { attempt: number; returnIndex: number } | null;
//   the ONE return-pick rule the worker books and the app expects: cheapestPairing restricted to the LAST attempt (the view the phase stands on), under
//   r.limits (the request's); null when that attempt listed no return. The api uses a booking's offers only when (attempt, returnIndex) equals it
export function cheapestOffer(b: BookingRead | null): { index: number; offer: Offer } | null;   // the lowest priceMinor (ties: the lower index) of a read or
//   expand-failed booking with offers; null otherwise
export interface PairingCandidate { fromMinor: number; offer: Offer | null; offersRead: number; complete: boolean; which: 'cheapest' | 'next-cheapest' |
  'over-limit'; times: { departOut: string; arriveOut: string; departBack: string; arriveBack: string }; mismatch: boolean; provenance: Provenance;
  stale: StaleMark; ageHours: AgeHours; fits: boolean; fresh: boolean; underCurrentLimits: boolean; fetchedAt: IsoDateTime; executionId: string | null }
//   what the api attaches per cell: `which` from the pairing's attempt and outboundFits; `complete` = offersComplete; `mismatch` = the cheapest offer differs
//   from the return's fromMinor
export function pairingLeads(p: PairingCandidate): boolean;   // R-lead with R-sellers: fits && fresh && underCurrentLimits && offer !== null && complete
export function resultBasisOf(b: FigureBasis): ResultBasis;   // 'pairing' → 'calendar' (the row it replaced), else itself: the detail link, datesState.ts:145
//   and ResultsHeader.tsx:96 read it (both changed in Task 21.2, so the widened basis typechecks)
// // datePairs/figure.ts: figuresByDatePair(rows, scope, now, pairingOf: (cell: CellKey) => { read: PairingRead; candidate: PairingCandidate | null } =
//   () => ({ read: 'not-read', candidate: null })) — the api builds `read` from the newest list (so not-read, outbound-only and no-pairing-read are told
//   apart) and core derives the candidate-based values; FigureCandidate and ResultRow untouched; Figure<T> gains { basis: 'pairing'; chosen: T; cheaperCached: null; grid: { pricePence; provenance; stale; truncated }; pairing:
//   PairingCandidate } chosen when the calendar figure's cell has a candidate with pairingLeads true (a verified figure still wins: §6.5): price = the
//   offer's priceMinor; otherwise the calendar figure carries pairingRead (below). rank.ts: basis order verified 0, pairing 1, calendar 2 (price first); a pairing figure's current keys are the
//   calendar candidate's; its fromEarlierSearch is the api's (R-lead). datePairs/encode.ts DatePairFigure gains (optional until Task 21.7 makes them required):
//   basis 'pairing'; gridPrice?: { pricePence; provenance; stale; truncated } | null (non-null exactly for 'pairing'); pairingRead?: PairingRead
export const PAIRING_READ = ['not-read', 'outbound-only', 'no-pairing-read', 'over-limit', 'sellers-not-read', 'offers-incomplete', 'within', 'within-older',
  'within-other-limits'] as const;   // nine values
//   not-read: no flight list for the figure's cell; outbound-only: a list with no return phase (returns null, or not-verified); no-pairing-read: a finished
//   return phase with no return listed or read (no-outbound, none-for-cell); over-limit: returns read, none fitting (the pairing shown beneath as its "from"
//   price); sellers-not-read: a fitting pairing whose booking read is not `read` (the grid price leads; the pairing beneath as "from £X, sellers not read");
//   offers-incomplete: read but not `complete` (the grid price leads; the pairing beneath with "a cheaper seller may not have been read");
//   within: a fitting pairing with a seller's price leads; within-older: it exists but the list is older than the refresh (the grid price leads; the pairing
//   shown beneath with its age); within-other-limits: it exists but the list was read under other limits (the grid price leads)
// api-contract/datePairs.ts: figuresSchema.basis takes figureBasisSchema = z.enum(['verified', 'calendar', 'pairing']); a sparse gridPriceSchema group keyed by
//   figure (pricePence, provenance, stale, truncated); a sparse pairingSchema group keyed by figure (pricePence (an offer's, or the return's "from" when isFrom is true), isFrom: z.boolean(), seller:
//   z.string().nullable(), fare: z.string().nullable(), offersRead: count, complete: z.boolean(), which: z.enum(['cheapest', 'next-cheapest', 'over-limit']),
//   departOut, arriveOut, departBack, arriveBack (HH:MM), mismatch: z.boolean(), provenance, stale, ageHours: the pairing shown beneath a calendar figure for
//   within-older / within-other-limits / over-limit / sellers-not-read / offers-incomplete); the pairing figure's own seller words, times, `which` and
//   mismatch ride in that group too (keyed by the figure; R-board); a dense pairingRead column (z.enum(PAIRING_READ)); encode/decode carry them
//   (both groups exactOptional until Task 21.6 fills them; the web reads them in 21.7); §10's 4 MiB bound holds (one dense byte a pair, two sparse groups)
// api-contract/results.ts: datePairFigureSchema gains basis 'pairing', gridPrice and pairingRead (the scoped /results figure, so the detail and the board agree)
// api-contract/searches.ts: searchCardSchema.cheapest.basis takes figureBasisSchema
// datePairs/detailLink.ts: a 'pairing' basis opens the detail on the 'calendar' results basis (the row the pairing replaced)
// camoufox/protocol.ts: flightsRequestSchema gains returnLimits: flightLimitsSchema.exactOptional() (absent: no return phase, no `returns`; a /v1/page request
//   with it is refused) and booking: z.boolean().exactOptional() (true: read the shown pairing's booking options; absent read as false; refused without
//   returnLimits); every answer kind that may answer a request carrying returnLimits (flights, blocked, not-ready, browser-error, cooling-down,
//   monthly-cap, spacing, counts-unreadable) gains pagesLoaded: count.exactOptional() — stated on every answer to a request that carries returnLimits on a
//   verified entry (0 when the first load was refused or the browser failed first; R-zero), absent otherwise (a list or grid page, or an older worker: the
//   ledger then counts the page class as today) — and nextLoadNotBefore: isoDateTimeSchema.exactOptional() (R-spacing: the worker's last document load's
//   start plus the spacing, stated when the phase loaded a further document); the `flights` answer gains returns: returnReadSchema.exactOptional() and its
//   superRefine checks every attempt's outboundIndex < flights.length and the booking's indices (the provider maps a breach to list-error parse
//   unknown-answer); versionsSchema gains offerGrammar: z.string().min(1).exactOptional() (return names use the one grammar: no returnGrammar)
// // ports/provider.ts: FlightListQuery gains returnLimits?: FlightLimits | null and booking?: boolean (required in Task 21.6; booking sent only with returnLimits);
//   FlightListResult's `list` gains returns?: ReturnRead | null (required in Task 21.6; pagesLoaded travels only on the answer → http-kit → page_count
//   path, never on the result, the row or the wire: arch-r3-014; nextLoadNotBefore stays off the result too: http-kit holds the next start from the
//   answer inside the attempt and nothing past the provider reads it, final ruling A-M3); PreflightResult gains flags?: Readonly<Record<string, boolean>>
// ports/budget.ts: ReserveParams gains pages?: number (the planned page count, default 1); finalise's parameter gains pageCount?: number (the answer's, 0 admitted;
//   absent keeps the plan on an unknown attempt, else 1 on a contacted page); for a camoufox page scope the guard's `calls` IS the page sum (usageSchema, the
//   Usage type, the api's usage read, ProvidersView and `gmt browser counts` are unchanged: arch-r2-006)
// // api-contract/flights.ts: flightListSchema gains returns: returnReadSchema.nullable().exactOptional() (required `.nullable()` in Task 21.7); superRefine:
//   every attempt's outboundIndex < flights.length and the booking's indices; flightListsResponseSchema gains pagesPlanned: count.exactOptional() (ruling D3:
//   flightPagesPerPair(the worker's reported flags); the read button and its refusal use it, never a hard number; filled in Task 21.6, read in 21.7)
// // api-contract/executions.ts: flightListsStateSchema gains returns and booking: z.boolean().exactOptional() (absent read as false: an older plan is
//   outbound-only) and returnsStopped and bookingStopped: workerRuleSchema.nullable().exactOptional() (absent read as null); types/execution.ts
//   FlightListsState gains returns: boolean; booking: boolean; returnsStopped: string | null; bookingStopped: string | null (the reader fills the defaults,
//   so the type is total)
// // types/execution.ts: Estimate.flightLists gains pairs?: number, returns?: boolean, pagesMax?: number and secondsMax?: number (required in Task 21.7:
//   estimateLine is the last reader): `pages` and `seconds` are the typical figures (R-estimate), the Max pair the bound; estimateSchema the same
// testing/pairing.ts (new; exported as the subpath `@gmt/core/testing`, as `@gmt/providers/testing` is: types and data only, `SYNTHETIC = true`, refused by the
//   existing fixture-provider guard in production): PAIRING_FIXTURE (Task 21.2's list) and its expected picks as literals; api and web tests import it
//   (test-r3-002, arch-r3-013); check-boundaries admits the subpath for test files only
// camoufox/builds.ts (Task 21.0, done): FLAG_NAMES holds 'RETURN_SELECT_VERIFIED' and 'BOOKING_SELECT_VERIFIED' (NONE false; pin.ts every entry false until
//   Task 21.3's last commit sets both on darwin-arm64)
// labels/source.ts: FLIGHT_LIST_SOURCE_LABEL unchanged; the provenance note (providers, below) is revised

// ---------- camoufox-worker ----------
// Task 21.0 (done) left the items §4 lists: documentLoads, StepFailed, the keyboard activations clickOutbound / clickReturn / clickMoreOptions, the
//   view-aware readFacts and listFacts, classifyAfterFailedStep, ProbePage without the activations, View 'returns' | 'booking' and the settle rules,
//   S.returns (confirmed) and S.booking (the hypothesis), both flags false, reclaim, check(…, pages), settle(…, pagesReserved, pagesLoaded), claim(…, pages,
//   whole), the recorder kinds and their recorded suites
// selectors.ts (Task 21.3): S.returns dated (the hypothesis as recorded: heading /^(?:Top |Other )?[Rr]eturning flights$/; resultLink the outbound's "From"
//   form only); S.booking dated and gains grouped: RegExp (the grouped "View <seller>, …" control, counted, never activated); SELECTORS_VERSION re-dated;
//   PROOFS['darwin-arm64'].RETURN_SELECT_VERIFIED and .BOOKING_SELECT_VERIFIED; the Lows deferred from 21.0: the price comparison's currency read from the
//   offer name's currency phrase against the request's (never a GBP fallback), one pence helper shared by names.ts, classify.ts and offers.ts over core's
//   MINOR_EXPONENT, a mixed-currency test
// // classify.ts (Task 21.3): the return branch's recorded conditions: text.returnHeading && resultLinks > 0 && cheapestTabs.length === 0 && dateGridButtons === 0 (results, rule
//   'returns'); the booking branch: when S.BOOKING_SELECT_VERIFIED, results (rule 'booking') when the URL's path is S.booking.path, no return heading,
//   outboundLinks === 0, cheapestTabs.length === 0, dateGridButtons === 0 and offers ≥ 1 (the page's price-comparison note above the offers is
//   never read: its wording changes with the fare, select-return/2026-11-01 and 2026-11-02), else blocked unrecognised
//   'not-booking-view' (the flag off → always 'not-booking-view'); the blocked rules first on both; the Cheapest view's status line that matches the
//   no-flights pattern (recorded on every Cheapest view and three of four return views) never classifies a changed view that has links
// guard.ts (Task 21.3; R-worst): GuardState gains activationGate: boolean and gateRefusals: number; while the gate is on (from an activation's press until its
//   view settles) the route aborts EVERY main-frame document navigation, allowlisted or not, counting no load and setting refused ??= 'unexpected-navigation'
//   (a new worker-side refusal word beside the BlockedPage kinds: never a cool-down); once documentLoads equals the request's pagesReserved the route
//   aborts any further main-frame navigation the same way with refused 'page-reservation' (cost-r3-002), so settle never clamps (it asserts pagesLoaded
//   ≤ pagesReserved); a refusal to the consent or sign-in host keeps its BlockedPage kind
// ready.ts (Task 21.3): isSettled(…, 'returns', changed) drops the no-flights term: changed && !fetching && (resultLinks > 0 || outboundLinks > 0) (a changed
//   view with no link settles only through the deadline, then not-settled); 'booking' as built (changed, no fetching, ≥ 1 offer)
// // names.ts (Task 21.3): unchanged: parseOptionName reads return names as it stands (38 of 38 recorded); readReturns calls it with a `// why:` (one grammar; no
//   alias, no second version)
// offers.ts (Task 21.3): OFFER_GRAMMAR_VERSION = '2026-11-01-offers'; export function parseOfferName(name): { seller: string; fare: string | null; amountMinor:
//   number; currency: string } | null   // ^Continue to book with (?<seller>.+?)(?:, (?<fare>[^,]+))? for (?<price>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+) (?<currency>
//   [A-Za-z ]+)$ (11 of 11 and 42 of 42 recorded offers); a name with "From", an unknown currency phrase or an empty seller is null; seller and fare cleaned as
//   flights.ts cleans a carrier; parseOfferName reads any currency phrase the shared pence helper knows and returns it, null only for an unknown one;
//   export interface OffersRead { offers: Offer[]; offersStated: number | null; unparsed: number; nonGbp: number; grouped: number; moreControl: boolean;
//   allGbp: boolean }; readOffers(f: BookingFacts): OffersRead   // every offer button's name through parseOfferName; a parsed offer in another currency
//   counts nonGbp and is dropped; allGbp false when any parsed offer is not GBP (the phase then ends the booking read `unrecognised` rule `currency`, as
//   the list readers end a page: prov-int-r3-008); the cheapest BOOKING_OFFERS_MAX kept by price then page order, offersStated the count before the cut
//   when above the cut, else null
// // driver.ts (Task 21.3): bookingFacts(d): Promise<BookingFacts { offerNames: Array<string | null>; moreOptions: number; grouped: number }> (offer buttons in
//   main by S.booking.offer; the expansion controls in main; grouped buttons by S.booking.grouped, never activated)
// served.ts (Task 21.3; a leaf: the served sequence — settle on Best, checkForm, the Cheapest flow with the session's fallback — as one exported function
//   servedSequence(driver, S, deps, cheapestDeadline: () => Deadline, …) taking its Cheapest deadline as a parameter: `budget.next` on the first view,
//   `() => budget.nextFor(pageTimeoutMs)` on the reload (prov-int-r3-004); imported by session.ts, returnPhase.ts and recordSelect.ts (rules.test.ts pins
//   the three), so the recorder's served() copy is replaced)
// list.ts (Task 21.3): readOptions returns mine: Array<{ option: ParsedOption; name: string }>; readList unchanged
// flights.ts (Task 21.3): FlightsRead gains names: string[] (aligned with `flights`, never in the answer) and parsed: Array<{ flight: ListedFlight; name: string }>
//   (every flight read for the cell, before the 30-cut); readFlights keeps the 30 cheapest as today; the phase's pick outside the 30 replaces the dearest
//   non-pick kept flight (so `flights` stays ≤ 30 with the pick inside) and the counts the page shows come from `parsed.length`
// returns.ts (Task 21.3): export interface ReturnsRead { listed; returns: ListedReturn[]; names: string[]; moreListed: boolean; optionsUnparsed; optionsOtherCell;
//   parsedForThisCell; resultsStated; currency }; readReturns(f: ListFacts, req: Pick<FlightsRequest, 'returnDate' | 'airportNames' | 'returnLimits'>,
//   interstitials?)   // an option is this pair's when its departsOn is the RETURN date, its `from` matches a DESTINATION name and its `to` an ORIGIN name;
//   day offset from the return date with −1 admitted; each return through listedReturnSchema.safeParse (a refusal counts unparsed; its fromMinor is the
//   name's "From" figure); R-returns30: the returns fitting req.returnLimits first by price, then the rest by price, cut to 30, kept in
//   page order with their names; moreListed as the attempt schema says
// // returnPhase.ts (Task 21.3): export async function returnPhase(p: { driver; guard; budget; pacer; url; req: FlightsRequest & { returnLimits }; outbound:
//   FlightsRead; view: 'cheapest' | 'best-fallback' | null; S; timers; log; pollMs; startedAt; admitted: number }): Promise<{ returns: ReturnRead } | { stop:
//   BlockedPage; rule: string }>   // the whole phase, the booking read included (Task 21.3's text), run only when view === 'cheapest' (else `skipped`
//   `not-cheapest-view`, booking the same: R-view); session.ts calls it after the outbound read; the only importer of returns.ts and offers.ts
//   (rules.test.ts pins both); every DeadlineExceeded inside it is a transient status, never rethrown; after every activation and every poll it reads
//   guard.refused before classifying (R-refused): 'unexpected-navigation', 'page-reservation' or off-allowlist → the step ends `unrecognised` with that
//   rule and no cool-down; consent-unhandled or sign-in → the page's stop with its cool-down (and consent's wipe)
// // session.ts (Task 21.3): for a flights request with returnLimits on a verified entry the page budget is pageBudget(…, RETURN_PAGE_PERIODS[booking ? 'booking' :
//   'returnsOnly'] × pageTimeoutMs + RETURN_SPACED_LOADS × spacingMs) (750,000 ms with a booking read, 570,000 without, at the defaults) and the monthly
//   admission asks for FLIGHT_LIST_PAGES_PER_PAIR_MAX pages (admitted with 1 when fewer than 2 are left: the phase is then `skipped` `monthly-headroom`
//   before any activation, the first view still read); every answer to such a request carries pagesLoaded: guard.documentLoads and, when documentLoads
//   > 1, nextLoadNotBefore (the pacer's last start + spacing); settle(…, pagesReserved, pagesLoaded) after the page; the session's Cheapest catch switches
//   to driver.ts's classifyAfterFailedStep and its served sequence to served.ts

// ---------- providers (Task 21.4) ----------
// // camoufox/flights.ts: the request carries returnLimits when q.returnLimits is non-null and, only then, booking: q.booking; the post passes pages:
//   FLIGHT_LIST_PAGES_PER_PAIR_MAX and requestTimeoutSeconds: flightRequestSeconds(c.pageTimeoutSeconds, c.minSpacingSeconds, q.booking) (780 / 600 at the
//   defaults) for such a request (pages 1 and listRequestSeconds, 210 s, otherwise: final ruling A-I1); the result carries returns: answer.returns ??
//   null, refused as parse returns-mismatch when the request sent no returnLimits or other limits (final ruling A-M2) (pagesLoaded goes to finalise
//   through pageCountOf only); http-kit holds its next start from an answer's nextLoadNotBefore inside the attempt (nextStartOf; ruling 21.4) so the
//   limiter's next start waits for it (R-spacing: no refused round trip, no retry spent)
// http/types.ts: HttpKitRequest gains pages?: number and requestTimeoutSeconds?: number (a per-request override of the provider's; discovery keeps its own);
//   HttpKit gains holdUntil(providerId, at: IsoDateTime): void (the hold is awaited in run() before the request is submitted to the limiter's queue, under
//   the request's signal, and does not count toward maxWaitMs: a hold longer than maxWaitMs still waits; arch-r3-018); ProviderHttpLimits gains
//   pageCountOf?: (bodyText) => number | undefined
// http/attempt.ts: passes pages to reserve and pageCount (pageCountOf of the body: the answer's pagesLoaded, 0 admitted; undefined without it) to finalise
// camoufox/limits.ts: export function pageCountOf(bodyText): number | undefined; camoufoxHttpLimits unchanged otherwise (its requestTimeoutSeconds stays
//   discovery's)
// CAMOUFOX_FLIGHT_LIST_INFO.provenanceNote (verbatim; Task 21.1 puts it in §2 Labels): "Google Flights flight list via Camoufox: the outbound flights Google
//   Flights listed for this day pair, each with the lowest round-trip total Google listed with that outbound (its "From" price), and, where this app's worker
//   selected the cheapest of the outbound flights it read that was within the search's longest journey, stops and time windows (or, when none was, the
//   cheapest it read; or, when none of that outbound's returns was within them, the next-cheapest within them, from a fresh load of the same page), the
//   return flights Google listed with that outbound, each with the lowest round-trip total Google listed for that outbound and that return (its "From"
//   price), and, for the one return this app then selected, the booking options Google listed after its "more booking options" were opened: the sellers'
//   stated prices for those two flights that this app read, of which the lowest is the pairing's price shown, the cheapest of the sellers read for these two
//   flights; where no
//   outbound was selected the return flight is neither chosen nor read; when this app's own Camoufox browser read the page on the machine running this
//   app's browser worker, from that machine's address, in the currency the page states. Times are the page's local times. Flight numbers, fare conditions
//   and baggage are not read, no seller is visited; nothing is checked with the airline or the seller."
// camoufox/preflight.ts: the discovery preflight's PreflightResult carries flags: read.status.flags (every read with a status, ok or refused)

// ---------- db (Task 21.5) ----------
// drizzle/0012_wp21_return_leg.sql (hand-written as 0011, every CHECK a named CONSTRAINT "<table>_<col>_ck", with meta/_journal.json and meta/0012_snapshot.json
//   whose prevId is 0011's id), additive only:
//   ALTER TABLE flight_lists ADD return_status TEXT NULL CHECK (NULL or IN (<RETURN_STATUS>)); ADD return_rule TEXT NULL CHECK (NULL or (length ≤ 80 AND
//   GLOB '[a-z]*' AND NOT GLOB '*[^a-z0-9:-]*')); ADD return_limits_json TEXT NULL CHECK (NULL or (json_valid AND json_type = 'object')); ADD return_tried_all
//   INTEGER NULL CHECK (NULL or IN (0, 1)); the coupling CHECKs on the last ADD:
//   (return_status IS NULL) = (return_limits_json IS NULL) = (return_tried_all IS NULL); (return_rule IS NOT NULL) implies return_status IN ('skipped',
//   'select-failed', 'not-settled', 'unrecognised', 'read'); return_status IS NULL OR status = 'read';
//   CREATE TABLE flight_list_attempts (list_id FK flight_lists(id) ON DELETE CASCADE, attempt INTEGER NOT NULL CHECK (0 or 1), outbound_position INTEGER NOT
//   NULL CHECK (integer ≥ 0), outbound_fits INTEGER NOT NULL CHECK (IN (0, 1)), listed TEXT NOT NULL CHECK (IN ('returns', 'none-for-cell')), more_listed
//   INTEGER NOT NULL CHECK (IN (0, 1)), options_unparsed, options_other_cell (integers ≥ 0),
//   results_stated (NULL or integer ≥ 0), PRIMARY KEY (list_id, attempt));
//   CREATE TABLE flight_list_returns (list_id, attempt, position, departs_local, arrives_local, arrives_day_offset INTEGER NOT NULL CHECK (BETWEEN -1 AND 3),
//   duration_minutes, stops, carriers_json, operated_by, from_pence INTEGER NOT NULL CHECK (integer > 0) (the return's "From" price), PRIMARY KEY (list_id,
//   attempt, position), FK (list_id, attempt) REFERENCES flight_list_attempts ON DELETE CASCADE, the flight table's CHECKs on the shared columns);
//   ALTER TABLE flight_lists ADD booking_status TEXT NULL CHECK (NULL or IN (<BOOKING_STATUS>)); ADD booking_rule TEXT NULL (the return_rule CHECK); ADD
//   booking_attempt INTEGER NULL, booking_return_position INTEGER NULL (NULL or integer ≥ 0), booking_expanded INTEGER NULL, booking_more_control INTEGER
//   NULL (NULL or IN (0, 1)), booking_grouped INTEGER NULL, booking_unparsed INTEGER NULL, booking_non_gbp INTEGER NULL, booking_offers_stated INTEGER NULL
//   (each NULL or integer ≥ 0); CHECK ((booking_status IS NULL) = (booking_expanded IS NULL)); booking_status IS NULL OR return_status IS NOT NULL;
//   CREATE TABLE flight_list_offers (list_id FK flight_lists(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK (integer ≥ 0), seller TEXT NOT NULL CHECK
//   (length BETWEEN 1 AND 80), fare TEXT NULL CHECK (NULL or length BETWEEN 1 AND 80), price_pence INTEGER NOT NULL CHECK (integer > 0), PRIMARY KEY (list_id,
//   position));
//   ALTER TABLE provider_requests ADD page_count INTEGER NULL CHECK (page_count IS NULL OR (provider_id = 'camoufox' AND typeof(page_count) = 'integer' AND
//   page_count >= 0)) — R-zero; NULL on every existing row and on every no-page row
// budgetGuard.ts: INSERT_PENDING writes the planned page_count (p.pages ?? 1 for camoufox page rows, NULL otherwise); FINALISE keeps it on an unknown attempt
//   with no pageCount, writes NULL on a no-page attempt, else the answer's (0 admitted); checkCaps adds (p.pages ?? 1) on provider-month and
//   provider-execution for camoufox; providerExecutionRows and the month window count camoufox pages as SUM(COALESCE(page_count, 1)) over page rows, reported
//   as `calls` on those scopes (boundary tests: a row of 0, of 2, and NULL; exactly at the cap; one over)
// ledger.ts: COUNTS's calls for camoufox page rows become the same sum (countsFor's lines agree with usage)
// // repositories/flightLists.ts: FlightListInsert gains returns?: ReturnRead | null (required in Task 21.6; a failed list carries returns null); insert parses `returns` through returnReadSchema (every refinement) and refuses an outboundIndex ≥ flights.length before SQL, writes the
//   columns, the attempts and the returns in the one transaction (a refused return rolls the list back); StoredFlightList gains returns: ReturnRead | null, assembled through parseWith('flight_lists.return_*', returnReadSchema, …) naming the column on a corrupt row (an
//   outbound_position past the flights included); newestPerCell and newestPerDatePair run their lists statement and one further statement for the attempts
//   and returns (ordered by list_id, attempt, position: one probe of the primary key, no new index) and one for the offers, inside one read transaction (three
//   statements a lookup); the attempts statement also reports, per cell, transientStreak: 0 | 1 | 2 (how many of the cell's two newest lists ended with a
//   transient return or booking status, newest first, stopping at the first finished one; R-retry); export newestWithReturns
//   (definitionId, cabin, pointOfSale, scope: { executionIds: readonly string[] } | null): StoredFlightList[]   // the newest list per cell of the definition
//   (the same list newestPerCell would give: never an older one), returned only when its status is read and its return_status is read or no-outbound,
//   with its returns and offers; under an executionIds scope only lists whose executionId is in the scope; three statements (lists, attempts and returns,
//   offers), one transaction; the same shape reads the offers in newestPerCell and newestPerDatePair
// ---------- engine (Task 21.6) ----------
// context.ts: EngineContext gains workerFlags: { get(providerId): Readonly<Record<string, boolean>> | null; set(providerId, flags) } (in memory; set by the
//   discovery preflight (stages/discovery.ts preflightPasses), the on-demand read's preflight and the api's status read in read/statusSources.ts:298 (the
//   Status view's; there is no boot read, so before the first of these the estimate words outbound-only and pagesPlanned is 1); ProviderRunLimits gains
//   flightRequestSeconds: { booking: number; returnsOnly: number } | null, filled by context.ts's limitsOf for camoufox from core's flightRequestSeconds
//   (pageTimeoutSeconds, minSpacingSeconds), null otherwise (arch-r3-006)
// stages/flightLists.ts: the plan's returns = flightPagesPerPair(ctx.workerFlags.get('camoufox')) === 2 at planning and the snapshot's flightListPages ≥
//   cells.length × FLIGHT_LIST_PAGES_PER_PAIR_MAX (an older snapshot plans outbound-only), and booking = returns && …BOOKING_SELECT_VERIFIED === true; before
//   each request the step decides outbound-only (no returnLimits, reserve 1, returnsStopped stays null, the pair's row marked by its own statuses) when the
//   month's headroom (provider-month cap − used, read from the guard) is below 2 (R-low-pages) or the run's window cannot hold the return-phase seconds but
//   can hold an outbound-only request (cost-r3-007); readPage sends returnLimits = flightLimitsOf(run.snapshot.constraints) and booking = plan.booking only
//   when plan.returns and plan.returnsStopped === null (booking false after bookingStopped), passes requestSeconds to the gate, checks the allowance as
//   `used + (returnLimits ? FLIGHT_LIST_PAGES_PER_PAIR_MAX : 1) > pages`, and, on a `list` result whose returns.status ∈ RETURN_TRANSIENT less `skipped` (or
//   whose booking.status ∈ BOOKING_TRANSIENT) patches returnsStopped (bookingStopped) = its rule so the pass sends none after; writeRow stores returns (with
//   its booking); null for a failed page. No ProviderContext.pages (the provider derives the plan from returnLimits: arch-r3-010)
// stages/flightLists/gate.ts: flightPageGate(ctx, run, requestSeconds) runs inside beforeSend (after the lease and limiter waits, immediately before the load)
//   and refuses with AbortedError when the window ends sooner than now + requestSeconds (R-window: no page starts past the window end); the step then ends
//   `window` as today
// // stages/flightLists/select.ts: NewestList gains returnStatus: ReturnStatus | null, bookingStatus: BookingStatus | null, limits: FlightLimits | null and
//   transientStreak: 0 | 1 | 2; selectFlightPairs(…, current: FlightLimits, returnsPlanned: boolean, bookingPlanned: boolean): a newest read list younger
//   than 0.9 × refresh is reused when !returnsPlanned, or when returnStatus ∈ RETURN_FINISHED, limits deep-equal `current`, and (!bookingPlanned ||
//   returnStatus === 'no-outbound' || bookingStatus ∈ BOOKING_FINISHED), or when transientStreak === 2 (R-retry: after two consecutive transient ends the
//   pair waits for its refresh, shown with its status); else read (a transient, not-verified, phase-less or other-limit list is re-read once)
// // snapshot.ts: flightListPages: FLIGHT_LIST_COUNT * FLIGHT_LIST_PAGES_PER_PAIR_MAX (20)
// estimate.ts (R-estimate): withFlights: returns = flightPagesPerPair(flags) === 2; booking = returns && the booking flag; pairsWithReturns = the pairs the
//   month's headroom allows at the bound (floor(monthLeft / 2), the rest outbound-only at 1: cost-r3-006), bounded by freeLeft (free calls count requests);
//   typical per pair with returns = minSpacingSeconds + 40 + RETURN_STEP_SECONDS × (booking ? 3 : 1) + RETURN_SECOND_OUTBOUND_RATE × (minSpacingSeconds +
//   2 × RETURN_STEP_SECONDS) (245 s with a booking read at the defaults); bound per pair = minSpacingSeconds + 40 + RETURN_PHASE_SECONDS_MAX[…] +
//   RETURN_SPACED_LOADS × minSpacingSeconds (300 s); pages = pairsWithReturns × (1 + RETURN_SECOND_OUTBOUND_RATE) + the rest, pagesMax = pairsWithReturns ×
//   2 + the rest; Estimate.flightLists = { pairs, pages, seconds, pagesMax, secondsMax, returns } (10 pairs at the defaults: 15 pages, 2,450 s; at most 20
//   pages, 3,000 s); the window is sized from `seconds` with `secondsMax` as the upper-bound note; FLIGHT_NOTE = '+ flights' and the clause "+ flights, out
//   and back, for up to N date pairs: usually about P pages and M minutes, at most Pmax pages and Mmax minutes" (returns) or "+ flights for up to N date
//   pairs, about M minutes"; the binding cap named by comparing in pairs; estimateRemaining the same per planned cell left
// // budgetFit.ts: the execution-free-calls line counts flight pairs (requests), the provider-month line the page allowance (pagesMax: 20 a run; a daily 168 h
//   schedule plans 5 × (100 + 20) = 600, two such schedules fit in 1,500); the re-read of R-retry is inside that bound (at most one extra read per pair per
//   refresh, already counted by the per-run allowance)
// // flightRead.ts: the read runs the preflight first (setting workerFlags), sends returnLimits and booking when the flags say so and the month's headroom
//   allows 2 (else outbound-only: R-low-pages), stores r.returns on its row (one read-row builder shared with writeRow), and is refused `fresh` only when the
//   newest list is read, young, and either no return phase is planned for this worker or (returnStatus ∈ RETURN_FINISHED under limits equal to the current
//   ones and, when a booking read is planned, returnStatus === 'no-outbound' or bookingStatus ∈ BOOKING_FINISHED), or when transientStreak === 2
// ---------- api (Task 21.6) ----------
// read/datePairs.ts: datePairFigures(loaded, scope, rc, pairings: ReadonlyMap<string, PairingCandidate>) builds the map from newestWithReturns (the read's
//   executionIds scope passed) through cheapestPairing under flightLimitsOf(def.constraints) and cheapestOffer (used only when the booking's attempt and
//   returnIndex equal bookingReturnOf's), with fresh = ageHours ≤ refreshHours, underCurrentLimits = deep-equal stored limits, offersRead = offers.length,
//   complete = offersComplete, which, times, mismatch, fetchedAt and executionId, and `read` (the PairingRead) from the newest list's statuses; assembleDatePairs, read/results.ts (the scoped /results read: the same map, so the detail and the
//   board agree), rankedFigures (the cards) pass it; rankedPairsFor passes an empty map (the step's candidates stay the calendar figures: arch-r2-013); toFigure
//   maps basis 'pairing', gridPrice, the pairing group and pairingRead, and sets fromEarlierSearch for a pairing figure from the list's fetchedAt against the
//   latest parent's startedAt (R-lead)
// // read/flightLists.ts: toFlightList maps returns; read/statusSources.ts: its status read sets ctx.workerFlags (through an engine method)
// ---------- web (Task 21.7) ----------
// copy.ts COPY.flights gains: out 'Out:'; back 'Back:' (every Back price followed by roundTrip 'round trip', 21.7 ui-004); pairingHead(which: 'cheapest' | 'next-cheapest') 'With the cheapest outbound read
//   within your limits:' / 'With the next-cheapest outbound read within your limits (the cheapest one's returns were all over your limits):'; pairingHeadOver
//   'With the cheapest outbound read (over your limits):'; pairingHeadWhenRead(which, ago) 'With the <which> outbound read, selected under your limits when
//   read, <ago>:'; pairingHeadOverWhenRead(ago) 'With the cheapest outbound read, over your limits when read, <ago>:' (21.7 code M13);
//   pairingHeadNoReturnFits 'No return flight within your limits for this outbound; the cheapest pairing read is shown, over your limits:' (21.7 code
//   I3); limitsChanged 'your limits have changed since; the returns are read again at the next search'; selectedMark(which) 'selected for the returns
//   above' / 'tried first: its returns were all over your limits'; legs { outbound, return }; withinLeg(leg, duration, limit); overLimitLeg(leg, duration,
//   limit); stopsOver(leg, n, max); windowsOutboundOnly 'windows apply to the outbound'; returnMore(n, outside); showAllReturns 'show all return flights';
//   showAllOutbound 'show all outbound flights' (one name each, aria-expanded the state: 21.7 code M2); returnsListName 'return flights for the
//   selected outbound'; returnsShown(n, all) 'all 5 return flights shown' (21.7 ui-007); triedSomeWhenRead(tried, within) '… within your limits when
//   read were tried …' (21.7 prov-011); returnsNotRead(clause); returnStatus: Record<Exclude<ReturnStatus,
//   'read'>, string> (six texts, §8 Task 21.7); returnsRead(n); returnsNone 'Google listed return flights, none this app could read for these
//   airports and dates'; noOutboundFits(n) 'none of the N outbound flights read is within your limits; the cheapest one's returns are shown'; returnCounts
//   (unread, other); moreListed(stated, read) 'Google listed N return flights; this app read the first M'; triedAll(n, tried); mismatch(returnTotal,
//   fromPrice) (the cheapest offer against the return's "from" price); priceAppliesTo "this price is for the Out: and Back: flights shown";
//   sellerLine(seller, fare, n) '<seller>[, <fare>] · cheapest of N offers read'; sellersNotRead 'sellers not read'; offersIncomplete 'a cheaper seller may
//   not have been read'; bookingStatus: Record<Exclude<BookingStatus, 'read'>, string> (seven texts, §8 Task 21.7); bookOnGoogle 'to book, search these
//   dates on Google Flights (the link below); this app opens no seller; Google may show different flights or prices when you search'; never "each seller" or "every seller" in any key; settingsNotApplied 'airline settings not applied to flights read'; returnNotRead
//   'return leg not read'; headPairing(which, seller, ago, when) 'Outbound flights, and the return flights for the <which> outbound read within your
//   limits[; the first Back price is a seller's stated price] · read …' (one sentence; the seller clause only when one is shown: 21.7 ui-003, prov-001);
//   headPairingOver(seller, ago, when) '… for the cheapest outbound read, which is over your limits …'; headPairingWhenRead(which | 'over', seller, ago,
//   when) '… for the <which> outbound read, selected under your limits when read, <ago>, <when> …' / '… which was over your limits when read …' (21.7
//   code I2, M13); readButton(pages, pagesLeft) with pages from the
//   response's pagesPlanned ("free, up to 2 pages" / "free, 1 page"); readOutboundOnly(n) 'free, 1 page; return leg not read: fewer than N pages left'
//   (R-low-pages: never a refusal); copy/estimate.ts flights(pairs, duration) and flightsOutAndBack(pairs, pages, duration)
// datesView copy: gridShowed(source) '<source> showed' and gridShowedAt(when) '· <when>' ("the date grid showed £564 · 10 Mar 09:30", "the Aviasales
//   cache showed …": 21.7 prov-003); pairingBeneath(ago) 'return flights read
//   <ago>, older than this search's refresh:' / pairingOtherLimits 'return flights read under earlier limits:'; pairingRead: Record<PairingRead, string>
//   ('flights not read', 'flights couldn't be read: <reason>', 'return leg not read', 'no return flight read', 'no pairing within your limits read', 'sellers not read', 'a cheaper seller may not
//   have been read', …); listFailed(reason | null) (no colon without a reason); loadingFlights 'loading flights'; flightsLoadFailed "flights couldn't be
//   loaded; prices shown without flights"; sellerCoverage(n, m) 'seller prices read for N of the M date pairs shown'; secondOutboundTried '2nd outbound
//   tried' (the row's short line; pairingWhich's long words are the group's accessible description: 21.7 persona H2, code M3); pairingTimes(out, back)
//   'Out: <HH:MM> · Back: <HH:MM>' (21.7 ui-008); mismatchMark 'Google listed from <price>'; fromPrice 'from'
// flightLines.ts: limitsOf(d) = flightLimitsOf(d.constraints); legMarks(leg, f, limits, c); returnNote(list, c, attempt?) (per status; null for null returns: the
//   list shows as the outbound list; the counts and moreListed clauses of the shown pairing's attempt for a read; null for a clean read); pairingOf(list, limits, now): { attempt; which: 'cheapest' | 'next-cheapest'; outbound; outboundIndex;
//   returns: ShownFlights<ListedReturn>; fits: boolean; selectedNow: boolean (selectOutbound(list.flights, limits).index === outboundIndex for attempt 0, or
//   the second pick for attempt 1); underCurrentLimits: boolean; offer: { seller; fare; priceMinor; offersRead; complete } | null (cheapestOffer when the booking is bookingReturnOf's
//   pairing) } | null; mismatchOf(list) (the cheapest offer against the shown return's "from" price); bookingNote(list, c): string | null (per booking
//   status; null for read); allReturnsInOrder(returns, limits)
// views/Dates/{Flights,FlightRow,PairingSection,ReturnRow,BoardTable,BoardCard}.tsx, overview.ts, howFar.ts, state/datesState.ts, board.ts: every basis branch an
//   exhaustive switch; isSyntheticRead judges f.gridPrice.provenance too; SearchCard.tsx and ResultsHeader.tsx treat 'pairing' as calendar-styled with "not checked" (COPY.basisName gains 'pairing'; Provenance.tsx's
//   CALENDAR_SOURCES gains 'scraped-self'); the board row's figure cell for basis 'pairing' through PriceCell with the list's provenance, sellerLine and
//   pairingTimes beneath it, mismatchMark when the group says so, the gridPrice PriceCell beneath with gridShowed, pairingLabel(which) once,
//   settingsNotApplied when the search sets airline or layover settings; a calendar figure with a pairing group shows it beneath through PriceCell (an
//   offer's price with its seller, or "from £X" when isFrom) with pairingBeneath / pairingOtherLimits / sellersNotRead / offersIncomplete; pairingRead words
//   per value; isSyntheticRead judges gridPrice and the pairing group too (prov-r3-008); no seller link anywhere (the one anchor stays the date pair's
//   Google Flights link);
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

**Created by Task 21.0 (done)**: `.superpowers/sdd/wp21-return-leg/return-page-findings.md` (local; `.superpowers/` is gitignored), the
recorder kinds and their suites (§4). **Create**:
`packages/core/src/flights/returns.ts`, `src/datePairs/pairing.ts`, `src/camoufox/rule.ts`, `src/types/window.ts`; tests
`packages/core/test/flights/{returns,select,chooseReturns}.test.ts`, `test/datePairs/pairing.test.ts`, `test/camoufox/returnsProtocol.test.ts`,
`test/fixtures/pairing.ts` (the shared pairing fixture, `SYNTHETIC`). `apps/camoufox-worker/src/{returns,offers,returnPhase}.ts`; tests
`apps/camoufox-worker/test/{returnNames,offers,returns,returnPhase,returnsRecorded,offersRecorded,flagsProofs}.test.ts`.
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
ranked,cards,statusSources}.ts`; tests `test/routes/{flightLists,datePairs,results,cards,ranked}.test.ts`, `test/read/statusSources.test.ts`.
`apps/web/src/{copy.ts,copy/estimate.ts}`, `src/views/Dates/{flightLines,Flights,FlightRow,BoardTable,BoardCard,board,overview,howFar}.ts(x)`,
`src/state/datesState.ts`, `src/views/Searches/estimateLine.ts`, `apps/web/e2e/selectors.ts`; tests `test/views/dates/{flights,board,overview}.test.tsx`,
`test/views/dates/logic/{flightLines,board,overview,howFar}.test.ts`, `test/state/datesState.test.ts`, `test/views/searches/logic/estimateLine.test.ts`,
`test/fixtures.searches.ts`, `test/msw/searchesHandlers.ts`, `test/copy/*`. `apps/web/PRODUCT.md`, `docs/providers.md`, `docs/setup.md`.

## 8. Tasks

### Task 21.0: The recorder kinds, the page counts and the research recordings — DONE (2026-11-01)

**Commits** 88276c36 … 309db3c3 (`task-21.0-report.md`, reviews clean). **Built**: §4's worker items (the guard's `documentLoads`,
`StepFailed`, the keyboard activations `clickOutbound` / `clickReturn` / `clickMoreOptions` with the click probe and failure words, the
view-aware `readFacts` and `listFacts`, `classifyAfterFailedStep`, `ProbePage` without the activations, `View 'returns' | 'booking'` and
the changed-then-stable settle rules, `S.returns` and `S.booking`, `Pacer.reclaim`, `MonthlyCounter.check(…, pages)` and
`settle(…, pagesReserved, pagesLoaded)`, `pageClaim`'s `pages` and `whole`, the kinds `--select-outbound` and `--select-return`
with `recordSelect.ts`, `researchNames.ts` and `researchProbe.ts`, `documentLoads` in every kind's meta, the recorded suites
`selectRecorded` and `bookingRecorded`), core's `FLAG_NAMES` with `RETURN_SELECT_VERIFIED` and `BOOKING_SELECT_VERIFIED` false
everywhere, the CLI's `unsetFlags`, 60-odd Windows known-failure lines (predicted; the PR's Windows leg confirms them).

**Recorded** (worker stopped; backed up to `~/.local/share/get-me-there/private/fixtures/camoufox-2026-11-01/`; month 13 of 1,500
pages; no cool-down): `select-outbound/2026-11-01/3` (LGW→EWR) and `/4` (LHR→JFK) with the served sequence, the first selection, the
reload and the second selection; `select-return/2026-11-01/1–2` (the return's selection and the booking view) and `/3–4` (the
"more booking options" expansion). Recordings 1 and 2 of `select-outbound` are the pointer click's failures (a timeout, then an
interception by a row overlay) that led to the keyboard activation ruling; they are not counted.

**Findings** (`.superpowers/sdd/wp21-return-leg/return-page-findings.md`, structural; its values are §5's literals):
1. every activation is in-app (14 of 14: documentLoads unchanged, the URL a History change), the reload is one document, the first
   view's own count is 1; the path after a selection stays `/travel/flights/search`, after the return's selection
   `/travel/flights/booking`; so a pair loads 1 page, or 2 with a second outbound, and the all-document worst case is 6;
2. the return view's headings match the hypothesis (plain, "Top …" and "Other …" forms); the departing headings are gone; no tab of
   any kind and no Date grid button; View more on every return view with no stated count; 4 and 15 return links; a status line
   matching the no-flights pattern beside the links on every Cheapest view and three of four return views;
3. every return name (38 of 38) is read by the outbound grammar as it stands: the price clause is `From <price> British pounds round
   trip total.` on every one; the leg leaves from the destination and arrives at the origin on the return date; day offsets 0 and +1;
   stops 0 to 2; no interstitial;
4. the cheapest return's "From" price equals the selected outbound's "From" price on every selection (4 of 4), and the two
   selections of a pair list disjoint returns; **stop-and-ask 5 held** ("From" on every return) and Ian ruled: read the booking options;
5. the booking view: reached in-app; offers are buttons `Continue to book with <seller>[, <fare name>] for <price> British pounds`, the
   price stated, never "From" (11 of 11, then 42 of 42 after the expansion); a price-comparison note above the offers whose wording changes with the fare
   (never read); one `<count> more booking options` control in `main`; on one recording the cheapest listed offer was 3.5 % above the
   "From" price (**stop-and-ask held** and Ian ruled: open the expansion); after the expansion (in-app, the URL unchanged, offers 6 → 23
   and 5 → 19) the cheapest offer equals the return's "From" price on both; a grouped `View <seller>, …` control on one recording,
   never activated; no dialog, nothing to dismiss, one passenger and both dates persist; the form controls are not read on the
   Cheapest, return or booking views (so no post-activation form check);
6. timings: selections 5.5–10.1 s, the return's selection about 5 s, the expansion about 3.5 s, the reload's settle up to 27.9 s;
   spacing waits before an in-app step are a few ms; `RETURN_STEP_SECONDS = 40` (the floor); SOCS read back the same on every recording.

**Rulings taken during the task** (the ledger `progress.md`): an activation is the keyboard one on the matched element (focus, then
Enter), never a pointer click, force, coordinates, a covering element or a dispatched event; the page budget covers every page
period of the served sequence (D7); a booking control, a grouped seller control and a seller's host are never activated or visited
(the guard refuses them; a redirect through an allowlisted first URL is caught from the hops after the fact); the price comparison
in the recorder uses core's ISO 4217 exponent table; the Lows deferred to Task 21.3 are named in §5's selectors.ts item.

### Task 21.1: Spec revision 56

**Files**: the spec. No code. **Consumes**: the findings note (Task 21.0, done), Ian's and the orchestrator's rulings. Every
value below is the recorded literal; nothing is left to a decision rule.

- [ ] Bump the header to **revision 55 → 56**. Write `### Revision 56: the return leg (2026-11-<dd>)` at the top of
  §17 in the form of revision 55: *Ian decided 2026-11-01* (the purpose; the two phases; what the page shows; the
  click behind its own per-entry flag), *Ian ruled 2026-11-01* (the pairing total leads the figure and the rank, the
  grid price beside it, coverage unchanged; a second outbound when none of the first's returns fit, at most two, and
  the cheapest outbound's returns read anyway when none fits; the return list prices every pairing "From", so the shown
  pairing's return is selected and the booking view's offers read, after its "more booking options" are opened, the
  headline being the cheapest seller's stated price), *What the recording showed* (Task 21.0's six findings in one
  sentence each, no page text), *Rulings on the brief's reviews* (the orchestrator's: the page rule with the spacing
  per document load and the window's worst case; the served sequence recorded; the settle on a changed view; the
  limits applied per direction; stored limits and reuse; finished and transient statuses; the unknown-view stop for
  the run; the mismatch and more-listed lines; planning from the worker's flag; old lists re-read; the reservation
  chain; R-lead's freshness; R-grid; R-synthetic; the second outbound by a fresh load; the worst-case reservation as
  one constant; `pagesLoaded` of 0; the spacing hold; fitting returns kept first; the heads; `not-verified` re-read;
  the keyboard activation; the page budget over every page period; no booking control, grouped control or seller's
  host ever activated or visited),
  *Builder's choices* (the selection over every flight read with the pick kept in the 30; the candidates by the
  calendar figures; the return grammar as the one grammar with a price clause parameter; the phase in its own module;
  `no-returns` dropped until the return view's no-flights line is recorded; −1 day offsets for returns; the page sum
  reported as the camoufox page scopes' `calls`; one grammar for outbound and return names; the offer grammar; the
  booking read of the last attempt's chosen return), and *What changed* (the section list).
- [ ] Fold each rule into its section (never an amendment block; one rule set per section):
  - **§2 camoufox**: after "*The flight-list read, beside discovery.*": the return phase (the request's `returnLimits`;
    `selectOutbound` over every flight read; the clicks, each a name in the selectors module, gated by
    `RETURN_SELECT_VERIFIED` per entry and dated by a recording of the served sequence; every activation from the
    keyboard, the matched element focused then Enter (the recorded way: a pointer click is intercepted by a row
    overlay), never force, coordinates, a covering element or a dispatched event; the return view's settle (a changed
    view, then the two-poll rule, never on the Cheapest view's status line alone) and the recorded classifier
    conditions (the "Returning flights" heading in its three forms, at least one link, no tab, no Date grid button);
    return names read by the one grammar ("From <price> British pounds round trip total.", the cheapest seller's price
    for that pairing, a lower bound); fitting returns kept first; the second attempt by a fresh load of the worker's own
    list URL, the served sequence again, when it is made; then, behind `BOOKING_SELECT_VERIFIED`, the shown pairing's
    return activated, the booking view (the path `/travel/flights/booking`, offer buttons
    "Continue to book with <seller>[, <fare>] for <price> British pounds", the price stated) settled, its one "<count>
    more booking options" control activated (in-page; never a seller's offer, a grouped "View <seller>, …" control or
    a seller's host, which the guard refuses), and every offer read (`OFFER_GRAMMAR_VERSION`, reported as
    `versions.offerGrammar`); the answer's `returns` with its attempts and `booking`, every status, which are finished
    and which transient; a view that is not the recorded shape ends the phase with what was read and no cool-down and
    the run sends no further return phase (or booking read), while a genuine block stops the page as any block does;
    the return view's no-flights line is not yet recorded, so it is `unrecognised` with its rule). The *page rule*:
    line 229's "at most one Google document load" becomes "at most one document load, or for a flights request with a
    return phase at most `FLIGHT_LIST_PAGES_PER_PAIR_MAX` (2: the first view and the second outbound's reload; an activation never loads a document,
    the guard refusing one while it settles); every Google document load, whichever
    request it belongs to, starts at least `CAMOUFOX_MIN_SPACING_SECONDS` after the last (less the 2 s tolerance), so
    documents per hour stay at most `floor(3600 / spacing)`; a flights request with a return phase takes up to
    `FLIGHT_LIST_PAGES_PER_PAIR_MAX` of them, each reserved in the worker's monthly counts before the first load and
    settled to the documents loaded, each counted on the answer as `pagesLoaded` and in the ledger as `page_count`;
    after such a request the answer states when the next load may start and the app waits for it"; the Limits
    paragraph's spacing sentence says the same; the page budget (eight page periods plus one spacing: 750 s at the defaults; six periods without a
    booking read) and the app's flights request timeout, `flightRequestSeconds` (780 s / 600 s at the defaults), and without a return
    phase `listRequestSeconds`, two page periods plus 30 s (210 s; final ruling A-I1), discovery keeping its own; a request arriving while a
    page is in flight is answered `spacing` with the rest of that page's cap and its close as its wait, which the app's retry waits (final
    ruling A-I1); the browser's own error inside a step ends that step `<step>:browser-error`, keeping the outbound and every return read
    before it (final ruling A-M1); "the worker opens only the URL form above" gains "and, in the return phase, the views the page's own
    selected-flight controls and its booking-options expansion show in place, each on the allowlist, and that same
    URL form again for a second outbound". Revise "the return
    flight is neither chosen nor read" to "where no outbound was selected"; the provenance note of §5 verbatim; the
    sentence "clicks only names in its selectors module" lists the return phase's click as a verified one (decision
    69's "nothing except Cheapest" is superseded and the §17 entry says so); the Capabilities table row's "no return
    legs" becomes "the return flights listed with at most two selected outbounds, no flight numbers or sellers"; the
    worker's `/v1/status` flags are read by the app and `RETURN_SELECT_VERIFIED` decides whether a return phase is planned.
  - **§3**: "Flight list" gains the attempts, the pairing and the booking read; "pairing": one outbound and one
    return; "from price": what the list words "From", the cheapest seller's price; "offer": one seller's stated price
    for a pairing, with its fare name when stated; "sellers read".
  - **§5.1**: `FlightListQuery.returnLimits`, `FlightListResult.returns` (never `pagesLoaded` or `nextLoadNotBefore`),
    `PreflightResult.flags`, `ReserveParams.pages`, `finalise`'s `pageCount`, the camoufox page scopes' `calls` as the
    page sum, http-kit's `holdUntil` and per-request timeout.
  - **§6.2**: the limits a flight read is judged against: the longest journey and `maxStops` per leg, the windows on
    the outbound only; airlines and layovers not applied (said on the board row when set); the outbound chooser
    applies the stops limit too.
  - **§6.5 and §6.9**: the figure rule as §1 states it (Ian's ruling 1 with R-lead): basis `pairing` between verified
    and calendar in the rank, the figure the cheapest offer's stated price ("the cheapest of the sellers read for these two
    flights", "cheapest of N offers read"), only while the list is fresh, read under the current limits, with a finished booking read whose offers are
    complete (R-sellers), else the grid price leads and the pairing shows beneath with its age, as "from £X, sellers not read" or with "a cheaper seller
    may not have been read"; the board row names which outbound the pairing used, carries the two departure times and the mismatch mark (R-board); the
    worker's return pick and the app's expected pairing are one core rule (R-pick); the pairing figure's current keys and `fromEarlierSearch` stated
    exactly; `gridPrice` beneath through `PriceCell` with its provenance; `pairingRead`'s seven values and their words;
    the flight list is still not a results basis for alerts, History or verification; the detail opens on the calendar
    row; the mismatch (the cheapest offer against the return's "from" price) and more-listed lines; the difference
    line of revision 55 is replaced by the grid-price line; the synthetic banner judges the grid price too; no seller
    is ever linked (booking stays on Google: the date pair's link). Final rulings B-I2, B-M1, B-M2, B-M5: with no return fitting
    on either outbound the pairing shown is the last attempt's (the one the worker booked, its offers kept, over the limits,
    the first outbound marked tried); freshness and the list's stale mark read one elapsed-time rule (`listFresh`);
    `pairingRead`'s candidate order puts `within-other-limits` first, worded with the block's limit-edit phrase; a pairing
    beneath agrees with its read on both wire encodings, and a card's pairing figure is fresh and a flight list's.
  - **§7**: migration 0012's columns and tables (§5's text: the attempts, the returns with their "from" prices, the
    booking columns and the offers), additive, NULL on every existing row; `provider_requests.page_count` (0 admitted)
    and what the guard sums; the repository's attempts, returns and offers statements inside one read transaction;
    `newestWithReturns` (the same newest list, attached only when finished, the read's execution scope).
  - **§8.1**: the step's plan carries `returns` and `booking` (from the worker's last reported flags and the
    snapshot's allowance), `returnsStopped` and `bookingStopped`; the query carries the search's limits and the
    booking ask only then; the allowance `flightListPages = FLIGHT_LIST_COUNT × FLIGHT_LIST_PAGES_PER_PAIR_MAX` (20)
    and the check per request; an outbound-only request when the month's headroom is below the worst case or the window holds only that
    (R-low-pages, R-window); the return phase only from the Cheapest view (R-view); a refused navigation read before classifying (R-refused); the candidates ranked by the
    calendar figures; the reuse rule (a newest `read` list younger than 0.9 × refresh is reused when no return phase is
    planned for this worker, or when its return status is `read` or `no-outbound` under limits equal to the current
    ones and, when a booking read is planned, its booking status is `read` or `no-pairing`; transient, `not-verified`, older or other-limit lists are
    read again once, and after two consecutive transient ends the pair waits for its refresh (R-retry)); an older snapshot plans outbound-only; the window check per request against `flightRequestSeconds`; a cancel during the phase writes no
    row and the resumed pass reads that pair once; the estimate's pairs, pages, seconds, words and the binding cap in
    pairs (10 pairs at the defaults: usually about 15 pages and 41 minutes, at most 20 pages and 50 minutes; 700 s without returns); the per-schedule
    monthly arithmetic (a daily schedule with a 168 h refresh makes about 5 discovery runs a month, at most 5 × (100 grid + 10 × 2) = 600 of the 1,500
    pages, so two such schedules fit, and typically 5 × (100 + 15) = 575, the settle returning the unused pages); the on-demand read's `fresh` rule and its return phase under the preflight's flag; the error table
    unchanged (a return status is inside a `read` row). Final rulings B-M3, B-M4: while the worker's flags are unread the
    estimate counts the bound (the return phase with the booking read); with fewer than 2 pages a pair left in the month, up
    to `min(pairs, M)` date pairs, all but the last out and back, at most M pages.
  - **§8.2**: a run's pages end inside its window: the gate's check runs after the lease and limiter waits, immediately before the load, against the
    request's own seconds (no page starts past the window end); the window is sized from the estimate's typical seconds with the bound as a note.
  - **§9**: the recorded suites (`selectRecorded`, `bookingRecorded`, `returnsRecorded` and `offersRecorded` skip
    without their recordings) and the CI-run proof check (a true flag names recording keys in `PROOFS`).
  - **§10**: `flightListSchema.returns` (its `booking` included; `pagesLoaded` stays off the result, the row and the
    app's API: ruling A5, final ruling A-M4) and `readNow` (final ruling B-I3); the date-pair response's basis
    `pairing`, `gridPrice` and `pairing` groups (the pairing group's seller, fare, `offersRead`, `complete`, `which`, the times, `mismatch` and `isFrom`) and
    `pairingRead` column (nine values); the scoped `/results` figure the same; the card's `cheapest.basis`;
    `GET /executions/:id` unchanged; `usage` unchanged in shape, `calls` on the camoufox page scopes being the page sum.
  - **§11 Flights**: the board row's figure for a read pair (the cheapest offer's price through `PriceCell` with the list's provenance, the seller line
    "<seller>[, <fare>] · cheapest of N offers read", "2nd outbound tried" on a second attempt and "Out: 07:15 · Back: 14:20" beneath it (the row stays
    short; the long words of which outbound the pairing used are the group's accessible description and the search's page block: 21.7 persona H2), the
    mismatch mark where the cheapest offer differs from the return's "from" price (beneath a calendar figure too: 21.7 code M12), the grid price beneath
    through `PriceCell` with its own source named first ("the date grid showed £564 · 10 Mar 09:30"), time and stale mark, the group named once by its
    visible lines, "airline settings not applied" when the search sets any, the
    `pairingRead` words; a pairing older than the refresh, read under other limits or without a finished booking read
    shown beneath a leading grid price with its age or as "from £X, sellers not read"); the block's head per state
    naming the outbound used ("the cheapest outbound read" / "the next-cheapest outbound read", "within your limits"
    at read time and whether the limits have changed since); the pairing section (the heads of §5, "Out: …" with its
    marks, the shown "Back:" line with the seller line and "this price is for the Out: and Back: flights shown", the
    other "Back:" lines with their "from" prices first, each leg's marks, "windows apply to the outbound", "N more
    returns read, M outside your limits · show all return flights", "book through Google Flights (the link below);
    this app opens no seller; Google may show different flights or prices when you search"); the mismatch line; the more-listed line; the status notes (return and booking) with
    what happens next; "none of the N outbound flights read is within your limits; the cheapest one's returns are shown";
    "2 of the N outbounds within your limits were tried" / "other outbounds not tried"; the counts clause; the limits
    line; a list stored before 0012 shows as today; the tie order unchanged; the read button's "up to N pages" and its
    refusal below that many pages left. Final rulings B-I1, B-I3: the shown seller's price is emphasised exactly when it leads
    its date pair (core's `pairingLeads`, the board's rule); the read button shows exactly when the pair's `readNow` is true,
    and a transient note says "tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now" only then, else
    "read again once the read is nearly as old as this search's refresh".
  - **§12**: the constants of `core/flights/limits.ts` (`FLIGHT_LIST_PAGES_PER_PAIR_MAX` 2, `RETURN_SPACED_LOADS` 1, `RETURN_PAGE_PERIODS` 8 / 6,
    `RETURN_STEP_SECONDS` 40, `RETURN_SECOND_OUTBOUND_RATE` 0.5, `RETURNS_SHOWN` 3, `RETURN_ATTEMPTS_MAX` 2, `BOOKING_OFFERS_MAX` 40), not settings.
  - **§16**: row 21 with this brief's scope and first failing test ("`selectOutbound` picks the first fitting flight in `compareFlights` order, ties by index").
- [ ] **Run**: `pnpm exec vitest run scripts/wording.test.mjs` and `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts` green.
- [ ] **Commit**: `Specify the return leg (spec revision 56)`.

### Task 21.2: `core`: the return shapes, the limits, the selection rule, the pairing figure, the contracts

**Files**: `packages/core/src/flights/{types,limits,returns,choose,index}.ts` (`returns.ts` holds the offer and booking shapes too), `src/datePairs/{pairing,figure,rank,encode,decode,detailLink}.ts`, `src/testing/{index,pairing}.ts` (the `@gmt/core/testing` subpath in `package.json`, as providers'), `apps/web/src/state/datesState.ts` and `src/views/Results/ResultsHeader.tsx` (their one line each through `resultBasisOf`, so the widened basis typechecks),
`src/camoufox/{rule,protocol}.ts`, `src/types/{window,execution}.ts`, `src/ports/{provider,budget}.ts`, `src/api-contract/{flights,definitions,datePairs,
results,searches,executions}.ts`, `src/index.ts`, `packages/core/stryker.config.json`; tests `test/flights/{returns,select,chooseReturns,choose}.test.ts`,
`test/datePairs/{pairing,figure,rank,encode,detailLink}.test.ts`, `test/camoufox/{returnsProtocol,flightsProtocol}.test.ts`, `test/api-contract/{flights,
datePairs,results,searches,executions}.test.ts`, `scripts/check-boundaries.mjs` (the subpath admitted for test files). **Consumes**: Task 21.1's values. **Produces**: §5's core items, every new
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
  - `returns.test.ts`: `listedReturnSchema` accepts `arrivesDayOffset: -1`, refuses `-2`, `4`, `fromMinor: 0`,
    `amountMinor`, `'24:00'`; `returnReadSchema` refuses `status 'read'` with `attempts: []`, `status 'no-outbound'`
    with an attempt, `status 'unrecognised'` with `rule: null`, `status 'read'` with `rule 'Select'`, an attempt with
    `listed 'returns'` and no return, a second attempt whose first attempt has a return within `limits`, a second
    attempt with `outboundFits false`; accepts a `read` with two attempts of 30 returns each and refuses 31;
    `RETURN_FINISHED` holds exactly read and no-outbound; `RETURN_TRANSIENT` exactly select-failed, not-settled,
    unrecognised, skipped; `BOOKING_FINISHED` exactly read and no-pairing; `BOOKING_TRANSIENT` exactly select-failed, not-settled, unrecognised,
    expand-failed; `FLIGHT_LIST_PAGES_PER_PAIR_MAX === 2`; `RETURN_SPACED_LOADS === 1`; `RETURN_PAGE_PERIODS.booking === 8` and `.returnsOnly === 6`;
    `RETURN_STEP_SECONDS === 40`; `RETURN_PHASE_SECONDS_MAX.booking === 200`; `flightRequestSeconds(90, 30, true) === 780`, `(90, 30, false) === 600`,
    `(120, 45, true) === 1035` (two data points); `flightPagesPerPair({ RETURN_SELECT_VERIFIED: true }) === 2`, `({ RETURN_SELECT_VERIFIED: false }) === 1`,
    `(null) === 1`; `BOOKING_OFFERS_MAX === 40`; `offerSchema` refuses `priceMinor: 0`, a seller of 81 characters, a fare with a control character, and
    accepts `fare: null`; `bookingReadSchema` refuses `status 'read'` with `offers: []`, `status 'no-pairing'` with an `attempt`, `status 'expand-failed'`
    with `rule: null`, `status 'read'` with 41 offers, `status 'not-settled'` with an offer, and accepts `expand-failed` with two offers (test-r3-001);
    `offersComplete` true when the cheapest offer equals `fromMinor`, true when `moreControl` is false and `grouped` is 0, false otherwise (a table); `returnReadSchema` refuses a `booking` whose `attempt` is not the last attempt or whose
    `returnIndex` is past that attempt's returns, and accepts `booking: null`.
  - `chooseReturns.test.ts`: the mirror of `choose.test.ts`'s cases with `fromMinor` (five returns of 600/700/1,560/
    900/800 minutes at £1,292/£1,286/£1,280/£1,286/£1,295 → shown £1,286 at 700, £1,286 at 900, £1,292 at 600; the
    shortest within the limits always among `shown`; a return with 2 stops under `maxStops 1` counted in `moreOutside`;
    a return arriving 03:10 under an arrival window 06:00–23:00 is NOT outside; every return outside → the cheapest
    three with `overLimit`); property: `shown.length + moreRead === returns.length`. `choose.test.ts` (extend): every
    existing case unchanged; a flight with 2 stops under `maxStops 1` is outside (`chooseFlightsToShow` applies the
    stops limit too).
  - `pairing.test.ts` over `src/testing/pairing.ts` (`SYNTHETIC`; every fixture built through `returnReadSchema.parse`; the api and web tests import it
    from `@gmt/core/testing`):
    the shared list `PAIRING_FIXTURE` has `flights` of four (the pick at index 2), attempt 0 (`outboundFits true`) with
    returns £1,204 (2 stops) and £1,230 (2 stops), attempt 1 (`outboundFits true`, the £520 outbound at index 3) with
    £1,180 (1 stop) and £1,250 (direct), and a `booking` of attempt 1, `returnIndex 0`, `expanded true`, offers
    (synthetic sellers) at £1,180 (`QQ Travel`, no fare), £1,195 (`QQ Fares`, "Economy Basic") and £1,210 → under
    `maxStops 1`, `cheapestPairing` is `{ attempt: 1, returnIndex: 0, fromMinor: 118000, outboundFits: true, returnFits: true }`, `cheapestOffer` is
    `{ index: 0, offer: { seller: 'QQ Travel', fare: null, priceMinor: 118000 } }` and `bookingReturnOf` is `{ attempt: 1, returnIndex: 0 }` (the api and
    web tests of Tasks 21.6 and 21.7 assert these same literals); `cheapestOffer` of a `booking` whose status is not read or expand-failed, or null, is
    null; ties in price go to the lower index; `bookingReturnOf` equals `cheapestPairing`'s attempt and index whenever the last attempt holds it,
    including two fitting returns tied on `fromMinor` where the later in page order is shorter (the shorter wins in both; R-pick), and the
    `outboundFits false` case; `resultBasisOf('pairing') === 'calendar'`, the others themselves; a single attempt with `outboundFits false` and a fitting return → `outboundFits false`; a
    single attempt whose returns are all over the limit → the cheapest of all with `returnFits false`; no returns at
    all → null; judged under the limits passed, not `r.limits` (a stored `maxStops 2` and a passed `maxStops 0` reject
    a one-stop return); `pairingLeads` true only with `fits`, `fresh`, `underCurrentLimits`, `complete` all true and `offer` non-null (a table over
    the combinations).
  - `figure.test.ts` and `rank.test.ts` (extend): `figuresByDatePair(rows, scope, now, pairingOf)` with `{ read, candidate }` whose `pairingLeads` is true gives `basis 'pairing'` with `price` the
    offer's, `grid` the calendar price it replaced, `pairingRead 'within'`; `read` 'not-read', 'outbound-only' and 'no-pairing-read' pass through with
    no candidate (one case each); `complete false` keeps the calendar figure with `pairingRead 'offers-incomplete'`;
    and the calendar candidate's `superseded`/`notSeenInLatest`; with `fresh false`, `underCurrentLimits false` or
    `fits false` the calendar figure stays with the pairing beside it; a verified candidate still wins; the default
    `pairingOf` (none passed) gives today's figures unchanged over the existing fixtures; `rankDatePairs` orders two
    current pairs at equal price verified before pairing before calendar, and ranks a £1,204 pairing after a £86
    calendar figure (price first); `encode`/`decode` round-trip `gridPrice` and the `pairing` group (sparse) and
    `pairingRead` (dense), and a response without the new groups decodes with `gridPrice null`, `pairing null`,
    `pairingRead 'not-read'`; the pairing group round-trips `isFrom`, `seller`, `fare`, `offersRead`, `complete`, `which`, the four times and `mismatch`;
    `detailLink` maps `'pairing'` to the `'calendar'` results basis through `resultBasisOf`.
  - `returnsProtocol.test.ts`: `flightsRequestSchema` accepts `returnLimits` (all null; with `maxStops` and windows;
    without `maxStops`) with and without `booking`, and without the key, refuses `returnLimits: undefined` and
    `booking` without `returnLimits`; `pageRequestSchema` refuses a list
    request with `returnLimits`; every answer kind named in §5 accepts `pagesLoaded` (0 included) and `nextLoadNotBefore`
    and without them; the `flights` answer accepts `returns` of every status (a table) and without the key, refuses an
    attempt's `outboundIndex` ≥ `flights.length`, and refuses what `returnReadSchema` refuses; `versionsSchema` accepts
    `offerGrammar`; a `flights` answer with two attempts of 30 returns, 30 flights and a booking of 40 offers stays under 100 KB serialised.
    `flightsProtocol.test.ts` unchanged and green.
  - `api-contract` (extend): `flightListSchema` accepts a body without `returns`, with `returns: null`, with a `read`
    block of `outboundIndex` 0 of one flight, refuses `outboundIndex` 1 with one flight; `flightListsStateSchema` accepts a plan without `returns`/`booking`/`returnsStopped`/`bookingStopped` (read back as `false`/`false`/`null`/`null`)
    and with them; `estimateSchema.flightLists` accepts `pagesMax`/`secondsMax` and without; `datePairs.test.ts`:
    basis `'pairing'`, the `gridPrice` and `pairing` groups' strict ascending `figure`, `pairingRead` dense with the
    figures' length, the 4 MiB bound at 36,400 pairs with the new column and groups; `results.test.ts`:
    `datePairFigureSchema` accepts basis `'pairing'` with `gridPrice` and `pairingRead` and a figure without them;
    `searches.test.ts`: a card's `cheapest.basis 'pairing'`; the redaction sweeps' shape lists gain `returns`,
    `pagesLoaded`, `nextLoadNotBefore`, `gridPrice` and `pairing`.
  - `ports`: `expectTypeOf` cases for `ReserveParams.pages?`, `finalise`'s `pageCount?`, `FlightListQuery.returnLimits?`/`booking?`, `FlightListResult`'s `returns?` (and no `nextLoadNotBefore`), `PreflightResult.flags?`, `Estimate.flightLists.pairs?`,
    `DatePairFigure.gridPrice?`, under `pnpm --filter @gmt/core typecheck`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/flights test/datePairs test/camoufox test/api-contract`; `pnpm --filter @gmt/core typecheck`.
- [ ] **Implement** as §5 (every constant the literal the findings fixed). `workerRuleSchema` moves to `camoufox/rule.ts`
  (protocol.ts re-exports it; `count` stays private); `localTimeWindowSchema` to `types/window.ts` (api-contract/definitions.ts imports it); `selectOutbound` in
  `choose.ts`; the constants in `limits.ts`; `figuresByDatePair`'s `pairingOf` defaulted so `figuresByDatePair(rows,
  scope, now)` still compiles for the api. Add `src/flights/returns.ts`, `src/flights/types.ts` and `src/flights/limits.ts` (existing files not yet under mutation), `src/datePairs/pairing.ts` to
  `packages/core/stryker.config.json` and move them from `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/core test` at 100%; `pnpm --filter @gmt/core exec stryker run --mutate src/flights/returns.ts,src/flights/choose.ts,src/flights/types.ts,src/datePairs/pairing.ts,src/datePairs/figure.ts,src/datePairs/rank.ts --concurrency 2` ≥ 80%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: return, booking and offer shapes, the limits with stops, the outbound selection and cheapest-offer rules, the pairing figure and the contract fields`.

### Task 21.3: `camoufox-worker`: the return and offer readers, the return phase with the booking read, the answer's page counts, the flags

**Files**: `apps/camoufox-worker/src/{selectors,classify,ready,guard,offers,served,list,flights,returns,returnPhase,session,driver,recordSelect,recordArgs}.ts`,
`apps/camoufox-worker/stryker.config.json`, `packages/core/src/camoufox/pin.ts`, `packages/core/test/camoufox/builds.test.ts`, `test/support/{recordedList,fakePage}.ts`; tests `test/{returnNames,offers,
returns,returnPhase,returnsRecorded,offersRecorded,flagsProofs,classify,ready,selectors,session,rules,names,list,flights,recorded,flightsRecorded}.test.ts`.
**Consumes**: Task 21.0 (done: the recordings, the findings, the activations, the pacer, monthly and page-claim changes), Task 21.2. **Produces**: §5's
worker items.

- [ ] **Write the failing tests** (expected to fail as: `parseReturnName`, `parseOfferName`, `readReturns`, `readOffers`, `returnPhase`,
  `bookingFacts` missing; `pagesLoaded` absent from answers; the session's budget and admission unchanged; the booking view still
  `'booking-view'`; the return settle still accepting the no-flights line; both flags false).
  - `returnNames.test.ts`: `parseOptionName` over a synthetic return name in the recorded form (the outbound grammar's shape, "From <price> British pounds
    round trip total.", the leg from "John F. Kennedy International Airport" to "Heathrow Airport" on the return day; carriers `QQ Air`) returns
    `amountMinor` (the "From" figure) in pence and every other field (no alias, no second version). `offers.test.ts`: `parseOfferName('Continue to book with QQ Travel for
    1,180 British pounds')` is `{ seller: 'QQ Travel', fare: null, amountMinor: 118000, currency: 'British pounds' }`; with ", Economy Basic"
    the fare; a US-dollar phrase parses with `currency 'US dollars'`; a name with "From", an empty seller, an unknown currency phrase, an appended sentence, or an
    81-character seller is null; `readOffers` over 23 offer buttons (two unparsable, one in dollars) keeps the 20 GBP offers by price then page order,
    `unparsed 2`, `nonGbp 1`, `allGbp false`, `grouped` the grouped buttons' count, `moreControl` true when a further expansion control is present,
    `offersStated null` (23 is under the cut); over 45 GBP offers keeps 40 (the 5 dearest dropped, ties by page order), `offersStated 45`;
    `OFFER_GRAMMAR_VERSION === '2026-11-01-offers'`.
    `list.test.ts` (extend): `readOptions` returns each parsed option with its name, `readList` byte-identical.
  - `returns.test.ts` (synthetic names): facts of 35 return options for the pair (the 31st cheapest by total the only
    one within `maxStops 0`), 2 options leaving on another day, 1 leaving from the ORIGIN airport (`optionsOtherCell`),
    1 unparsable → `listed 'returns'`, 30 returns kept of which the fitting one is first by total and inside the 30
    (R-returns30; the dearest non-fitting one dropped), in page order, `optionsOtherCell 3`, `optionsUnparsed 1`,
    `parsedForThisCell 35`, each return with `fromMinor` (its "From" figure) and its name, `arrivesDayOffset` from the RETURN date (next
    day 1; previous calendar day −1; 31 Dec to 1 Jan is 1), `currency 'GBP'`; every return accepted by `listedReturnSchema`;
    an option refused by the schema (a 120-character operator) counts unparsed; every option for other days → `listed
    'none-for-cell'`, `returns: []`; `moreListed` true with `viewMore` true, or with `resultsStated` above read +
    unparsed + other, false otherwise.
  - `flights.test.ts` (extend): `readFlights` reports `parsed` (35 of them, each with its name) and `names` aligned
    with the 30 kept; the recorded parity suites unchanged.
  - `selectors.test.ts`, `classify.test.ts` and `ready.test.ts` (extend): `S.returns` and `S.booking` are the dated values (`grouped`
    added; `grouped` never matches an offer or the expansion control), `SELECTORS_VERSION` re-dated; the return branch: the
    heading, a link, no Cheapest tab and no Date grid button pass; one Cheapest tab, or one Date grid button, or no heading, or no link is
    `not-return-view`; `outboundLinks` and the link counts are not consulted (4 and 15 both pass); the booking branch with the flag on: the
    booking path, no return heading, `outboundLinks 0`, no tab, no Date grid button and one offer pass (`booking`);
    each fact missing is `not-booking-view`; the flag off → always `not-booking-view`; the blocked rules first on both; `isSettled(…,
    'returns', true)` is false for a changed view with the no-flights line and no link, true with a link; the Cheapest view's status line
    beside links never changes its classification.
  - `returnPhase.test.ts` (the session over `FakeContext` as `session.test.ts`, `selectorsFor` flags of a verified entry plus `RETURN_SELECT_VERIFIED: true`
    and `BOOKING_SELECT_VERIFIED: true`, the request `{ mode: 'flights', …REQ, returnLimits: { maxJourneyMinutes: 1500, maxStops: 1, windows null }, booking:
    true }`; no navigation seam: a document navigation during an activation is the fake guard seeing a main-frame request, refused by the gate; the
    reservation is core's `FLIGHT_LIST_PAGES_PER_PAIR_MAX`). The
    fixture's Best and Cheapest trees hold, in page order: an other-day option, an unparsable name, £451 at 1,600 min
    (over the journey limit), £478 at 600 min with 2 stops (over the stops limit), £478 at 600 min with 1 stop (the
    right pick: index 2 of `flights`, neither first in page order nor the cheapest), £520 at 700 min; the return trees
    carry the recorded name form; the fake keeps the pre-click tree for two polls after a click before swapping:
    - **the whole phase** (the request `booking: true`): the answer is `kind 'flights'` with `flights` of four, `returns.status 'read'`,
      `attempts[0].outboundIndex 2`, `outboundFits true`, three returns with `fromMinor` 120400 / 118000 / 125000 in page order, `moreListed true` (the
      fake's View more), `rule null`, `triedAll true`, `limits` the request's, and `booking { status: 'read', attempt: 0, returnIndex: 1 (the £1,180 one-stop
      return: `bookingReturnOf`'s pick), expanded: true, offers: [£1,180 'QQ Travel', £1,195 'QQ Fares' 'Economy Basic', £1,210], unparsed: 0, nonGbp: 0,
      grouped: 1, moreControl: false, offersStated: null }`; two fitting returns tied on `fromMinor` where the later is shorter → the shorter booked
      (`booking.returnIndex === bookingReturnOf(...).returnIndex`; R-pick); the page's actions are exactly `['tab:Cheapest',
      'focus:link:<the one-stop £478 name>', 'press:Enter', 'focus:link:<the £1,180 return name>', 'press:Enter', 'focus:button:<the more
      options name>', 'press:Enter']` and no `click` of any link, offer or grouped control (the fake's `calls.clicks` holds `tab:Cheapest`
      only); `selectOutbound(answer.flights, limits).index === answer.returns.attempts[0].outboundIndex` and the activated name is
      `names[2]` (Review Focus 1); the guard's activation gate is on from each press until its settle and off between; `pagesLoaded` is the literal 1 and the
      month settles to 1 of the 2 reserved; `nextLoadNotBefore` absent; `fetchedAt` is after the phase; `versions.offerGrammar` is set (one grammar: no `returnGrammar`, final ruling A-M4);
    - **a pick outside the 30**: 31 parsed outbound flights where only the dearest fits → `flights` holds 30 with the
      pick inside, `outboundIndex` names it, the dropped flight is the dearest non-pick, and the counts the page shows
      come from the 31 read (prov-r2-010);
    - **the second attempt**: the first return tree's returns all have 2 stops and a second fitting outbound exists (£520) → the actions
      continue `['goto', 'tab:Cheapest', 'focus:link:<the £520 name>', 'press:Enter', …]` (the reload: `calls.gotos` gains the same URL; the pacer re-claimed before it; the reload's Cheapest flow gets a full page timeout even with fake
      time past 180 s at the reload (the `timers.deadline` sequence pinned: prov-int-r3-004); `pagesLoaded 2`, the month settled to 2), `attempts.length 2`,
      `attempts[1].outboundIndex 3`, the booking read made on attempt 1's chosen return (`booking.attempt 1`), `triedAll` true when no third fitting
      outbound exists and false when one does; when the reload's served sequence ends other than on a settled Cheapest view (a Best fallback, Google's
      no-flights line, a form mismatch, no option read) the status stays `read` with `rule 'reload:<end>'`, one attempt, no cool-down, and the booking
      `skipped` with that rule (the phase stands on a view that is not attempt 0's; prov-r3-005); only the spacing end before the reload started keeps the
      booking read of attempt 0 (`rule 'spacing'`); a genuine blocked kind on the reload is the page's stop; no second attempt when the first had a
      fitting return, or when no further outbound fits; a request with `booking: false` makes the same second attempt and no booking read;
    - **no outbound fits**: every flight over a limit → one attempt with `outboundFits false` on the cheapest flight, no second attempt
      (Ian's ruling 2), the booking read of `bookingReturnOf`'s pick; **no return fits on the last attempt**: the booking read is of `bookingReturnOf`'s
      pick (the cheapest by the one order), `returnFits false` in the web's judgement;
    - **no-outbound**: Google's no-flights line, or every option for another cell → `returns { status: 'no-outbound', attempts: [], booking:
      { status: 'no-pairing' } }`, nothing activated, `pagesLoaded 1`; a `read` attempt with `listed 'none-for-cell'` on the last attempt →
      `booking.status 'no-pairing'`;
    - **not the Cheapest view** (R-view): the outbound answer's view is `best-fallback` or null → nothing activated, `returns.status 'skipped'` rule
      `not-cheapest-view`, `booking.status 'skipped'` the same, the outbound flights intact;
    - **not verified**: `RETURN_SELECT_VERIFIED: false` → nothing activated, `status 'not-verified'`, `booking.status 'not-verified'`;
      `BOOKING_SELECT_VERIFIED: false` alone → the returns read, nothing activated after them, `booking.status 'not-verified'`; a request
      with `booking: false` → `booking null` and no activation after the returns; a request without `returnLimits` → nothing activated,
      no `returns`, no `pagesLoaded` key;
    - **headroom**: with 1 page left in the month the admission reserves 1 and the phase is `skipped` rule `monthly-headroom` before any activation
      (`booking.status 'skipped'` the same rule), `pagesLoaded 1`, the outbound flights read; with exactly 2 left it reserves 2 and runs (the exact-fit
      case); with a reservation of 1 or 2 a further main-frame navigation past it is aborted by the guard (nothing fetched, `refused 'page-reservation'`)
      and the phase ends `unrecognised` rule `page-reservation`, the month equal to the ledger's `page_count` (cost-r3-002);
    - **transient ends**, each asserted through one shared helper (the answer is `kind 'flights'` with the outbound
      flights intact, never `not-ready` or `blocked`, `cooldown.active()` null, `pagesLoaded` the literal loaded, the
      month settled to it): the view never changes from the Cheapest tree within the step's budget (Enter changed nothing) → `not-settled` rule
      `select-outbound:no-activation`; the tree changes but lacks the heading → `unrecognised` rule `not-return-view`; a changed view with
      the no-flights line and no link → `not-settled` (never settled on the line); two links of the pick's name → `select-failed` rule
      `select-outbound:find-outbound`; the press never resolves (fake time past `CLICK_TIMEOUT_MS`) → `select-failed` rule
      `select-outbound:press-outbound`; the spacing wait before the reload runs out of its own budget (the pacer's last start just written,
      fake time not advanced) → the status stays `read` with `rule 'spacing'` and one attempt (the reload is the only spaced step); the page cap expires during `listFacts` of the return view → `not-settled` rule `select-outbound:list-facts`; the return view in another currency →
      `unrecognised` rule `currency`; a main-frame navigation request during an activation (allowlisted or not) is aborted by the gate, nothing fetched,
      `pagesLoaded` stays 1, and the phase ends `unrecognised` rule `unexpected-navigation` (R-worst; pinned in `guard.test.ts` too: an allowlisted booking
      path URL aborted while the gate is on and admitted with it off);
      the booking step's own ends (the returns intact, `returns.status 'read'`): the return's press changes nothing → `booking.status
      'not-settled'` rule `select-return:no-activation`; the changed view is off the booking path or lacks an offer
      → `booking.status 'unrecognised'` rule `not-booking-view`; two links of the return's name → `'select-failed'` rule
      `select-return:find-return`; the expansion control absent → `booking.status 'read'` with `expanded false` and the offers read before it; two or more expansion controls →
      `'unrecognised'` rule `more-options-count`, nothing pressed, no offer kept (the contract allows offers only on `read` and `expand-failed`; prov-int-r3-006); the expansion's press changes nothing, or its
      settle runs out → `'expand-failed'` rule `select-more-options:no-activation` / `:not-settled`, `expanded false`, the offers read before it kept (the
      answer parses: test-r3-001); a navigation during the return's or the expansion's activation → `'unrecognised'` rule `unexpected-navigation`, nothing
      loaded; any parsed offer in another currency → `'unrecognised'` rule `currency` (prov-int-r3-008); in every case the page is closed and the SOCS
      read-back run after;
    - **genuine blocks after any activation or the reload** (the outbound's, the return's, the expansion's), a table over captcha, consent
      host, sign-in heading, account control and unusual-traffic: the answer is `blocked` with that page, its rule, its cool-down record and
      `pagesLoaded` the literal loaded, exactly as a Best-view poll gives it;
    - **the guard after an activation** (R-refused): `guard.refused` is read before classifying after every activation and every poll; a main-frame
      navigation request to another host (a seller's), and one to a non-flights path on the allowlisted host, are aborted (nothing fetched) and the phase
      (or the booking step) ends `unrecognised` rule `guard-refused:off-allowlist` with no cool-down (sec-002); a refusal of kind `consent-unhandled` or
      `sign-in` is the page's stop with its cool-down (and consent's wipe); a seller redirect cannot reach the hops any more (the gate aborts the first
      navigation), pinned; the offer buttons and the grouped control are never focused or pressed (the full actions list asserted);
    - **a refused first load**: the fake refuses the first `goto` → the answer is `blocked` with `pagesLoaded 0` and
      the month settled to 0 (R-zero);
    - **budgets**: the page budget is the literal 750,000 ms for this request (`8 × 90,000 + 1 × 30,000`), 570,000 with `booking: false` and 180,000 for a
      flights request without `returnLimits`; the reload's deadline is `nextFor(spacingMs)` then `nextFor(pageTimeoutMs)`, every activation's
      `nextFor(pageTimeoutMs)` (the `timers.deadline` sequence pinned); the monthly admission asks for the literal 2; the recorder's `RECORD_SELECT_PAGES`
      and `RECORD_SELECT_RETURN_PAGES` become 2 (the recorder's activations run under the same gate: Task 21.0's 4s were pre-gate).
  - `session.test.ts` (extend): a list, grid or flights page without `returnLimits` carries no `pagesLoaded`; the
    session's catch of `StepFailed` (the Cheapest flow) uses driver.ts's `classifyAfterFailedStep`, its existing cases green.
  - `rules.test.ts` (extend): with the module's verified flags a list page clicks only `tab:Cheapest`; a flights page with `returnLimits`
    clicks `tab:Cheapest` and otherwise only focuses and presses Enter: at most one result link, then at most one `goto` of the same URL
    followed by `tab:Cheapest` and one more result link, then at most one return link and one expansion control; never an offer button, a
    grouped control or any `click` of a link; the consent page nothing; `moduleImporters('./returnPhase.js')` is `['session.ts']`,
    `moduleImporters('./returns.js')` and `moduleImporters('./offers.js')` are `['returnPhase.ts']`, `moduleImporters('./served.js')` is `['session.ts',
    'returnPhase.ts', 'recordSelect.ts']`; `clickOutbound`, `clickReturn` and
    `clickMoreOptions` are named only in driver.ts, recordSelect.ts and returnPhase.ts; `ProbePage` still has no activation.
  - `flagsProofs.test.ts` (CI-run, no recordings; green on every commit): for every entry and flag, `flagsFor(entry, build)[flag] === true`
    implies `PROOFS[entry][flag]` names at least one `<kind>/<date>/<n>` key, and a flag not named in `PROOFS` is false; where recordings exist each named key
    resolves to a recording directory; with `RECORDINGS_REQUIRED=1` the recorded suites fail instead of skipping (test-r3-003); the recorded suites' skip
    titles name themselves skipped (`skipTitle`). The "darwin-arm64 only" expectation for both flags lives in core's `builds.test.ts` and is written in
    the flipping commit.
  - `returnsRecorded.test.ts` (recorded-guarded on `select-outbound/2026-11-01/3–4` and the end-to-end recording of R-e2e, named by key; 1–2 are the
    failed pointer clicks and are not read): every return name `parseOptionName` reads states its times and a day offset in −1..3 from the return date;
    `readReturns` over each recording's selections gives `listed 'returns'`, `optionsUnparsed === 0`, `optionsOtherCell` pinned as a `pinOf` hash,
    `moreListed true`, and whether the minimum `fromMinor` equals the selected outbound's `amountMinor` pinned as a boolean per key (true on every
    recording today; a changed value on re-recording is a finding for the controller, not a bug: test-r3-004); `classifyPageWithRule(after.page, S,
    'returns')` is `results` on every selection with the dated selectors; a selection's `documentLoads` growth is 0 and the reload's 1.
    `offersRecorded.test.ts` (recorded-guarded on `select-return/2026-11-01/3–4` and the end-to-end recording for the expanded assertions; 1–2 only for
    the booking view's classify and shape pins): on every booking recording the dated booking branch classifies the settled view `booking`; `readOffers`
    over the expanded view reads every offer (`unparsed 0`, `nonGbp 0`, `allGbp`), none "From", whether the cheapest equals the selected return's "From"
    price pinned as a boolean per key, `grouped` and `moreControl` as pinned by the Task 21.0 suite; `recorded.test.ts`, `flightsRecorded.test.ts`, `selectRecorded.test.ts` and
    `bookingRecorded.test.ts` unchanged over every recorded page.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/camoufox-worker exec vitest run test/returnNames.test.ts test/offers.test.ts test/returns.test.ts
  test/returnPhase.test.ts test/session.test.ts test/rules.test.ts test/names.test.ts test/list.test.ts test/flights.test.ts test/selectors.test.ts
  test/classify.test.ts test/ready.test.ts test/flagsProofs.test.ts`.
- [ ] **Implement.** `names.ts`'s `parseReturnName` alias; `offers.ts`; `list.ts`'s names; `flights.ts`'s `parsed` and `names`; `returns.ts`;
  `driver.bookingFacts`; `served.ts`; `guard.ts`'s activation gate and reservation stop; `returnPhase.ts` (the phase, in order: the view check (not
  `'cheapest'` → `skipped` `not-cheapest-view`), the headroom check (`admitted < FLIGHT_LIST_PAGES_PER_PAIR_MAX` → `skipped` `monthly-headroom`, the
  booking the same) → `selectOutbound` over `outbound.parsed` with the pick kept in `flights` → `d = budget.nextFor(pageTimeoutMs)` → the gate on →
  `driver.clickOutbound(name, d, steps)` (a `StepFailed` → `select-failed` with rule
  `select-outbound:<step>` after `classifyAfterFailedStep`, a blocked kind there being the page's stop) → the poll on `'returns'` with
  `changedFrom` the pre-activation signature (its own `DeadlineExceeded` → `not-settled`; a view that never changed → rule `select-outbound:no-activation`) → the gate off → `guard.refused` read
  first (`unexpected-navigation` / `page-reservation` / off-allowlist → `unrecognised` with that rule, no cool-down; consent or sign-in → the page's
  stop) → a settled `blocked` kind with page ≠ `unrecognised` → the page's stop; `unrecognised` → the status with the classifier's rule; no form check
  (the recorded views show no form); `readReturns(await driver.listFacts(d, 'returns'), req)` (a
  `DeadlineExceeded` anywhere → `not-settled` with rule `select-outbound:<step>`) → currency ≠ GBP → `unrecognised` rule `currency`; then
  the second attempt when no return of the first fits (`withinLimits(r, limits, 'return')` over the attempt's returns) and
  `selectOutbound(parsed, limits, skip)` gives a further fit: `d = budget.nextFor(spacingMs)`, `pacer.reclaim(d, timers)`
  (`DeadlineExceeded` → the status stays `read`, `rule 'spacing'`), `d = budget.nextFor(pageTimeoutMs)`, `driver.goto(url, d)` (the fresh load: `served.ts`'s `servedSequence` with `() => budget.nextFor(pageTimeoutMs)` as its Cheapest deadline; any end
  other than a settled Cheapest view → the status stays `read` with `rule 'reload:<end>'`, the booking `skipped` the same, no cool-down unless a genuine
  blocked kind), then the second selection as the first; `triedAll` from whether a further fit remains; then, when `req.booking` and
  `S.BOOKING_SELECT_VERIFIED`, the booking read on the view the phase stands on: the chosen return = core's `bookingReturnOf` over the attempts so far
  under the request's limits (`returnIndex`; R-pick), `d = budget.nextFor(pageTimeoutMs)`, the gate on, `driver.clickReturn(names[returnIndex], d, steps)`, the poll on `'booking'` with `changedFrom` (a view
  that never changed → `select-return:no-activation`), the gate off, `guard.refused` read first, the classifier (`not-booking-view` → `unrecognised`), `bookingFacts` → `moreOptions ≥ 2` → `unrecognised`
  `more-options-count`; when `moreOptions === 1`: `d = budget.nextFor(pageTimeoutMs)`, the gate on, `driver.clickMoreOptions(d, steps)`, the poll on
  `'booking'` with `changedFrom` the offers' signature (a failure or no change → `expand-failed`, the offers read before it kept), the gate off →
  `readOffers(await driver.bookingFacts(d))` (`allGbp` false → `unrecognised` `currency`) → `booking { status: 'read', expanded, offers, unparsed, nonGbp,
  grouped, moreControl, offersStated }`; every `DeadlineExceeded` inside the phase is a transient
  status, never rethrown; an answer never carries an offer's button name, only its parsed seller, fare and price). `session.ts` calls it after the outbound read, maps its stop into the page's stop handling, carries `pagesLoaded` (`guard.documentLoads`,
  0 admitted) and `nextLoadNotBefore` onto every answer to a request with `returnLimits` on a verified entry, builds the larger budget
  and the worst-case admission for such a request, settles pages after the page, and switches its Cheapest catch to
  `classifyAfterFailedStep`. `selectors.ts` dates `S.returns` and `S.booking`, re-dates `SELECTORS_VERSION`; `classify.ts` and `ready.ts` as
  §5 (the Lows deferred from 21.0 folded in: the currency from the offer name against the request's, one pence helper over
  `MINOR_EXPONENT`, the mixed-currency test). The `PROOFS['darwin-arm64']` sentences for both flags from the findings ("2026-11-01
  select-outbound/2026-11-01/3 and 4 …", "2026-11-01 select-return/2026-11-01/1–4 …"); **both flags flip in the last commit of this task only, a controller step** (R-e2e, test-r3-003): first the controller records, worker stopped, one
  end-to-end run of the full served path on this entry (`record --select-return --force-second --origin LGW --destination EWR --depart 2027-04-10
  --return 2027-04-20`: the first outbound's returns treated as not fitting, the reload, the second outbound, its return, the booking view, the
  expansion; `recordSelect.ts` and `recordArgs.ts` gain the `--force-second` option in this task, under the gate and a reservation of 2); then
  `RECORDINGS_REQUIRED=1 pnpm --filter @gmt/camoufox-worker exec vitest run test/returnsRecorded.test.ts test/offersRecorded.test.ts test/selectRecorded.test.ts
  test/bookingRecorded.test.ts --reporter=verbose` must report executed > 0 and skipped 0 (the run pasted in the commit body); core's `builds.test.ts`
  expectation is written and seen red before `pin.ts` changes (the ledger records the red run); then `pin.ts` flips and `flagsProofs.test.ts` passes. Add
  `src/returns.ts`, `src/offers.ts` and `src/returnPhase.ts` to `apps/camoufox-worker/stryker.config.json` and move them from `pending` to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/camoufox-worker test` at its thresholds, the recorded suites green on the controller's machine;
  `pnpm --filter @gmt/camoufox-worker exec stryker run --mutate src/returns.ts,src/offers.ts,src/returnPhase.ts,src/classify.ts,src/ready.ts,src/names.ts,src/flights.ts,src/monthly.ts,src/guard.ts --concurrency 2` ≥ 80%; `pnpm -r typecheck`.
- [ ] **Commits**: `wp21: the return and offer readers, the served sequence as one module and the kept names`; `wp21: the session's return phase with the
  booking read behind the two select flags, the activation gate, its budget, spacing and page counts`; `wp21: the return-select and booking-select flags
  set for darwin-arm64 by the recordings of 2026-11-01 and the end-to-end recording`.

### Task 21.4: `providers`: the limits, the page plan and timeout in the request; the returns, page count and spacing hold in the result; the flags

**Files**: `packages/providers/src/camoufox/{flights,limits,preflight}.ts`, `src/http/{types,attempt,limiter}.ts`; tests `test/camoufox/{flightList,limits,
preflight}.test.ts`, `test/http/{attempt,limiter}.test.ts`. **Consumes**: Task 21.2.

- [ ] **Write the failing tests** (expected to fail as: `returnLimits` not posted; `pages` and `requestTimeoutSeconds`
  not on the request; `pageCountOf`, `holdUntil` missing; `flags` absent from the preflight result).
  - `flightList.test.ts` (extend; msw): `read({ cell, airportNames, returnLimits: {…} })` posts a body carrying
    `returnLimits` exactly (and `booking` only with it) and omits the keys for `null`; the fake http-kit sees `pages: 2` and `requestTimeoutSeconds: 780`
    (`booking true`; 600 with it false; the literals for `pageTimeoutSeconds 90`, `minSpacingSeconds 30`) for a request with limits and `pages: 1` with no
    override without; a `flights` answer with `returns`, `pagesLoaded 2` and `nextLoadNotBefore` maps to `{ kind: 'list', …, returns }` field for field
    (no `pagesLoaded` or `nextLoadNotBefore` on the result; http-kit holds the next start); one without the keys maps to `returns: null`
    and no hold; a return block on a request sent without `returnLimits`, or under other limits, is `list-error` `parse` `returns-mismatch`;
    an answer whose attempt's `outboundIndex` is out of range is `list-error` `parse` `unknown-answer`;
    `CAMOUFOX_FLIGHT_LIST_INFO.provenanceNote` is §5's text verbatim; the sentinel key never appears in the answer,
    the error or the posted body.
  - `attempt.test.ts` and `limiter.test.ts` (extend): `pages` reaches `reserve`; a request's `requestTimeoutSeconds`
    overrides the provider's for that attempt only (the next discovery attempt keeps `pageTimeoutSeconds + 15`); the
    finalise of an attempt whose body states `pagesLoaded 2` carries `pageCount 2`, `pagesLoaded 0` carries `pageCount
    0`, a blocked or not-ready body with `pagesLoaded` carries it, an unknown attempt (timeout, no body) carries no
    `pageCount`, a body without `pagesLoaded` carries no `pageCount` (the guard then writes 1 on a contacted page);
    `holdUntil` makes the limiter's next start for that provider wait until `at` under fake timers (awaited before the queue, under the signal; a hold
    longer than `maxWaitMs` still waits and is not a limiter timeout) and does nothing for an `at` in the past.
  - `limits.test.ts` (extend): `camoufoxHttpLimits.requestTimeoutSeconds` unchanged (105 in list mode); `pageCountOf`
    reads 2 from `{"pagesLoaded":2}`, 0 from `{"pagesLoaded":0}`, `undefined` from a body without it or a non-JSON body.
  - `preflight.test.ts` (extend): an `ok` status read puts the worker's `flags` on the result; a refused read with a
    status body does too; an unreadable one gives no `flags`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/providers exec vitest run test/camoufox test/http`.
- [ ] **Implement** as §5. **Run to verify they pass**; `pnpm --filter @gmt/providers test` at its thresholds; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the flight-list capability sends the limits, the booking ask, the page plan and its own timeout, maps the returns, offers and page count, holds the next start, reports the worker's flags`.

### Task 21.5: `db`: migration 0012, the returns and page counts in the repository, the guard and the ledger

**Files**: `packages/db/drizzle/0012_wp21_return_leg.sql`, `drizzle/meta/{_journal.json,0012_snapshot.json}`, `src/schema/{flightLists,providerRequests}.ts`,
`src/repositories/{flightLists,ledger}.ts`, `src/types.ts`, `src/budgetGuard.ts`, `src/index.ts`; tests `test/{migration0012,flightLists,budgetGuard.flightLists,
ledger,barrel,client}.test.ts`. **Consumes**: Task 21.2. **Produces**: §5's db items (`FlightListInsert.returns` optional until Task 21.6).

- [ ] **Write the failing tests** (expected to fail as: the migration absent; `returns` unknown to `insert`;
  `newestWithReturns` missing; the guard counting rows, not pages).
  - `migration0012.test.ts` (the pattern of `migration0011.test.ts`): a database seeded at 0011 with a definition, a
    completed run, a `read` list of two flights, a `failed` list and a camoufox ledger row comes through 0012 with every seeded row byte-equal on its old
    columns, every return and booking column and `page_count` NULL, no attempt, return or offer row; the CHECKs refuse (one case each, through raw SQL on `db.raw`): `return_status 'read'` with
    `return_limits_json` NULL, `return_status 'maybe'`, `return_rule 'Select'`, a `return_rule` on `no-outbound`, a
    return phase on a `failed` list, `outbound_position -1`, `attempt 2`, `arrives_day_offset -2`, `total_pence 0`, a
    return row whose attempt row does not exist, `from_pence 0`, `return_tried_all` NULL with `return_status` set, `booking_expanded` NULL with
    `booking_status` set, `booking_status 'read'` with `return_status` NULL, `booking_status 'maybe'`, an offer with `price_pence 0` or an 81-character
    seller, `page_count -1`, `page_count` on a non-camoufox row, and accept `page_count 0`; `ON DELETE
    CASCADE` removes a list's attempts, returns and offers; the journal's entry 12 names the tag;
    the snapshot names every CHECK the database carries on `flight_lists`, `flight_list_attempts`, `flight_list_returns`,
    `flight_list_offers` and `provider_requests` (0011's snapshot-equals-database case, carried) and its `prevId` is
    0011's id; `barrel.test.ts` and `client.test.ts` migration lists gain it.
  - `flightLists.test.ts` (extend): `insert` with `returns` writes the columns, the attempts, the returns and the booking's offers in
    position order in one transaction (a refused return or offer, `from_pence 0` / `price_pence 0` written through a stubbed prepared
    statement, rolls the list and its flights back); `insert` refuses before SQL an `outboundIndex` ≥
    `flights.length`, a `failed` list with non-null `returns`, a `returns` block `returnReadSchema` refuses; `insert`
    without `returns` stores `return_status NULL`; `newestPerCell` and `newestPerDatePair` read `returns` (its `booking` and offers included) back field for field (`null` for a row without them) with
    `transientStreak` 0, 1 or 2 (a cell whose newest two lists ended transient gives 2; a finished newest gives 0) in **three** statements inside one transaction (the WP19 counter; the existing "one statement"
    assertions become three with a `// why:`) and nothing more for a page of 50 cells; a corrupt `outbound_position` past the flights throws the named-column error; `newestWithReturns` returns the newest list per cell (the same `newestPerCell` gives) only when its status is read and its
    `return_status` is `read` or `no-outbound`, with returns and offers, never an older finished list under a newer transient
    one (a cell whose newest is `not-settled` and whose older is `read` returns nothing for that cell), and under an
    `executionIds` scope only lists of those executions; `forExecution` and `cellsOfExecution` unchanged; an
    on-demand list with returns has `executionId null`.
  - `budgetGuard.flightLists.test.ts` (extend): a reserve with `pages: 2` inserts a pending row with `page_count 2`; finalise with `pageCount 1` writes 1,
    with `pageCount 0` writes 0, with none on an unknown attempt keeps 2, with none on a contacted attempt writes 1, on a no-page attempt writes NULL; with
    `flightListPages: 20` and nine rows finalised at 2, a reserve of 2 passes at 18 and the next (at 20) throws `provider-execution`; `usage({ kind:
    'provider-execution' })` reports `flightLists.calls` as the page sum and `provider-month` `calls` as the sum
    over camoufox page rows (a row of 0 counts 0, of 2 counts 2, NULL counts 1, a no-page row counts 0); a
    non-camoufox reserve with `pages` writes NULL; `scrollsThisMonth` unchanged. `ledger.test.ts`: `countsFor`'s
    camoufox lines agree with usage's sums.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/db exec vitest run test/migration0012.test.ts test/flightLists.test.ts test/budgetGuard.flightLists.test.ts test/ledger.test.ts test/barrel.test.ts test/client.test.ts`.
- [ ] **Implement** as §5 (the SQL hand-written with `--> statement-breakpoint`, the snapshot drizzle-kit 0.31's shape, "Do not regenerate" in its header as 0011's).
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/db test` ≥ 85% / 70%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: migration 0012 (the return attempts and rows, the booking read and its offers, the stored limits, the ledger's page count, additive) and the repository's returns`.

### Task 21.6: `engine` and `api`: the plan, the limits, the allowance and estimate, reuse, the pairing figure, the wire

**Files**: `packages/engine/src/stages/{flightLists,discovery}.ts`, `src/stages/flightLists/select.ts`, `src/{context,snapshot,estimate,budgetFit,flightRead,
engine}.ts`, `packages/engine/stryker.config.json`, `test/support/harness.ts`; `apps/api/src/read/{flightLists,datePairs,results,ranked,cards}.ts`, `src/wiring.ts`,
`src/bootstrap/engine.ts`; tests `packages/engine/test/stages/{flightLists,flightListsSelect,flightListsResume,discoveryPreflight}.test.ts`, `test/{estimate,
budgetFit,flightRead,snapshot}.test.ts`, `apps/api/test/routes/{flightLists,datePairs,results,cards,ranked}.test.ts`. **Consumes**: Tasks 21.4, 21.5. Makes
required: `FlightListQuery.returnLimits`, `FlightListResult`'s `returns`, `FlightListInsert.returns`.

- [ ] **Write the failing tests** (expected to fail as: `workerFlags` and `flightRequestSeconds` absent; `returnLimits`
  never sent; `returns` dropped by the on-demand write; the figure's basis never `'pairing'`; the estimate's clause
  unchanged).
  - `flightListsSelect.test.ts` (extend, one case per status): under `returnsPlanned true` and `current` limits, a
    newest `read` list 150 h old under refresh 168 is `reused` when its `returnStatus` is `read` or `no-outbound`
    **and** its stored limits deep-equal `current`; `read` again when the status is `not-verified` (R-unverified), `skipped`, `select-failed`, `not-settled` or `unrecognised`, when
    `returnStatus` is null, when the stored limits differ (`maxStops` 1 against 0), or, under `bookingPlanned true`, when the booking status
    is anything but `read` or `no-pairing` (a `read` return status with a `not-verified` or `expand-failed` booking is re-read); a list with
    `transientStreak 2` is reused whatever its statuses (R-retry: a list stored after a run's `returnsStopped`, 2 h old, is read once, and after the
    second transient end reused until 0.9 × refresh); under `bookingPlanned false` the booking status is not consulted; under `returnsPlanned false`
    every `read` young list is reused whatever its statuses (`not-verified` included); a `failed` newest list is `read` always; the property unchanged.
  - `flightLists.test.ts` (extend; the harness with a `workerFlags` stub): with both flags true at planning, the plan stores `returns true` and `booking true` and the stub capability receives `booking: true` and
    `returnLimits` equal to the literal `{ maxJourneyMinutes: 1500,
    maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: { from: '06:00', to: '23:00' } }` for a snapshot with
    those constraints and all-null for one without; with `BOOKING_SELECT_VERIFIED` false the plan stores `booking false` and the capability receives `booking: false`; with `RETURN_SELECT_VERIFIED` false or unread, the plan stores `returns false` and no `returnLimits`; a `list` result with returns (its booking
    included) is stored with them; a `list` whose `booking.status` is `expand-failed` patches `bookingStopped` and every later page carries `booking:
    false` while returns are still read; with 1 page of month headroom left the request goes out without `returnLimits` (an outbound-only read, the step
    not ended; R-low-pages) and with 2 it carries them; a `failed` page stores
    `returns: null`; a `list` whose `returns.status` is `not-settled` patches `returnsStopped 'select-outbound:not-settled'`
    and every later page of the pass carries no `returnLimits` (outbound reads continue; Review Focus 2), while
    `skipped`, `no-outbound` and `read` do not stop it; with `flightListPages 20` the eleventh pair is refused at `provider-execution` before any call and an allowance of 19 refuses the tenth (`used + 2 >
    pages`); a snapshot with `flightListPages 10` (older) plans `returns false` and reads 10 outbound-only pages; the gate, run inside `beforeSend` after
    a held lease is released, refuses a return-phase request whose seconds the window no longer holds (the step ends `window` with no row), while the
    step sends an outbound-only request instead when the window holds that (R-window, cost-r3-007); `flightRequestSeconds` comes from
    `ctx.limitsOf('camoufox').flightRequestSeconds` (context.ts's `limitsOf`, pinned in its test); `snapshot.test.ts`: the literal `flightListPages 20`; a pre-WP21 plan JSON (no `returns` key) resumes as outbound-only (`flightListsResume.test.ts`);
    a cancel during a page (the capability rejects on `run.controller` abort) writes no row and a resumed pass reads
    that pair once and only that pair; `discoveryPreflight.test.ts`: the discovery preflight's result sets `ctx.workerFlags` for camoufox; the api's `statusSources.test.ts`: the Status view's
    worker read sets them too, and before any read `pagesPlanned` is 1 and the estimate words outbound-only; the error table's rows unchanged (one smoke case).
  - `estimate.test.ts` (extend; exact-fit cases, estimate.ts now under mutation): with camoufox in discovery and the
    flags true, `flightLists` is the literal `{ pairs: 10, pages: 15, seconds: 2450, pagesMax: 20, secondsMax: 3000, returns: true }` (typical 245 s and
    1.5 pages a pair; bound 300 s and 2), the assumption "+ flights, out and back, for up to 10 date pairs: usually about 15 pages and 41 minutes, at
    most 20 pages and 50 minutes"; with the booking flag false `seconds 1650` (165 s a pair) and `secondsMax 2200`; with the flag false or unread, `{ pairs: 10, pages: 10, seconds: 700,
    returns: false }` and "+ flights for up to 10 date pairs, about 12 minutes"; the monthly bound at `monthLeft` 1, 2 and 3 pages (0, 1 and 1 pairs with returns, the rest outbound-only; "flights for 1 date pair out and back,
    9 outbound only: the browser worker's monthly page cap"), the free-call bound in requests (`maxFreeCalls` 105 after 100 grid pages plans 5 pairs); a
    blocked browser line drops the clause (`isFlightNote` on the new prefix); `estimateRemaining` the same per planned
    cell left. `budgetFit.test.ts` (extend): the execution-free-calls line counts flight pairs (10) and the
    provider-month line the page allowance (20); the schedule's monthly load the same; two daily 168 h schedules both fit a 1,500-page month (cost-r3-001).
  - `flightRead.test.ts` (extend; flightRead.ts under mutation): the read runs the preflight first and sets `workerFlags`, sends `returnLimits` when the flags say `RETURN_SELECT_VERIFIED` and
    `booking` per `BOOKING_SELECT_VERIFIED`, none otherwise; a `list` result with
    returns is stored with them and `pagesLoaded` (read back by `newestPerCell`), a failed read stores `returns: null`
    (data-005); `fresh` only when the newest list is read, young, and either no return phase is planned for this worker or its status is `read`/`no-outbound` under
    equal limits with, when a booking read is planned, a `read`/`no-pairing` booking, or its `transientStreak` is 2; a young transient (streak 1),
    `not-verified` (flag on), `expand-failed`, old or other-limit list is read; with 1 page of headroom the read goes out outbound-only (R-low-pages);
    the boundary at exactly 0.9 × refresh.
  - `apps/api/test/routes/datePairs.test.ts`, `results.test.ts`, `cards.test.ts`, `ranked.test.ts` (extend; the shared
    `PAIRING_FIXTURE` of core's `test/fixtures/pairing.ts` stored through the repository): a date pair whose figure cell
    has that list (fresh, under the current limits, its booking read and complete) answers basis `'pairing'`, `pricePence 118000` (the offer's; the
    pairing group: `QQ Travel`, `offersRead 3`, `complete true`, `which 'next-cheapest'`, the four times, `mismatch false`, `isFrom false`), the provenance the list's (camoufox, scraped-self, the list's
    `fetchedAt`, `maxAgeHours 0`), `stale` the list's, `gridPrice` the calendar figure it replaced with its own provenance and stale mark,
    `pairingRead 'within'`; the same list with its booking `expand-failed` (or of another attempt or return than the pairing's) keeps the calendar figure with `pairingRead 'sellers-not-read'` and the pairing group as `isFrom true`, `pricePence 118000` (the return's "from"),
    `seller null`; a `read` booking with `moreControl true` whose cheapest offer is above the return's "from" keeps the calendar figure with
    `'offers-incomplete'`; a booking of another attempt or return than `bookingReturnOf`'s → `'sellers-not-read'`; a cheapest offer above the "from" with
    no control left leads with `mismatch true`; `fromEarlierSearch`
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
- [ ] **Implement** as §5. `context.ts`'s `limitsOf` fills `flightRequestSeconds` for camoufox; `read/statusSources.ts` sets `workerFlags` through the
  engine (no boot read exists or is added). Add
  `src/stages/flightLists.ts`, `src/estimate.ts` (whole) and `src/flightRead.ts` to `packages/engine/stryker.config.json`
  (their tests added to the command runner's list) and move the pending ones to `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` at their thresholds;
  `pnpm --filter @gmt/engine exec stryker run --mutate src/stages/flightLists/select.ts,src/stages/flightLists.ts,src/estimate.ts,src/flightRead.ts --concurrency 2` ≥ 80%; `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the flight-list step plans the return phase and the booking read from the worker's flags, sends the limits, counts each pair's pages and stops after a transient view; the cheapest seller's price leads while fresh; returns, offers and pages on the wire`.

### Task 21.7: `web`: the pairing on a search's page and on the board

**Files**: `apps/web/src/{copy.ts,copy/estimate.ts}`, `src/views/Dates/{flightLines,Flights,FlightRow,PairingSection,ReturnRow,BoardTable,BoardCard,board,
overview,howFar}.ts(x)`, `src/views/Searches/{estimateLine.ts,SearchCard.tsx}`, `src/views/Results/ResultsHeader.tsx`, `src/components/Provenance.tsx`; tests `test/views/searches/card.test.tsx`, `test/views/results/header.test.tsx`, `test/views/dates/{flights,returns,board,overview}.test.tsx`,
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
    WP20's outbound marks plus the stops mark; `returnNote` gives each of the six non-read statuses' words (the
    transient ones "tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now"; `not-verified` "return
    flights are not yet read on this kind of machine; see the recording session in docs/setup.md"; `skipped` the
    rule's words; `no-outbound` nothing more than the outbound's own line), null for null returns (the list shows as the
    outbound list; 21.7 code M6), the counts clause
    "2 return options unread, 1 for other airports or days" and the more-listed clause "Google listed 12 return
    flights; this app read the first 10" for a read with such counts (of the shown pairing's attempt: 21.7 code M1), null
    for a clean read; `pairingOf` gives `{ attempt: 1, which: 'next-cheapest', outboundIndex: 3, returns.shown[0].fromMinor: 118000, fits: true, selectedNow: true,
    underCurrentLimits: true, offer: { seller: 'QQ Travel', fare: null, priceMinor: 118000, offersRead: 3, complete: true } }` for the fixture (the same
    literals as the api test), `offer null` when the booking is not `read` or is of another attempt or return than `bookingReturnOf`'s; `bookingNote` gives each of
    the seven non-read booking statuses' words (`not-verified` "sellers are not yet read on this kind of machine", `expand-failed` "sellers
    read before the list could be expanded; the cheapest may be missing" (the transient words when it kept no offer: 21.7 prov-014), the transient ones "tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now", `skipped` the rule's words, `no-pairing` "no return flight to read sellers for"), null for read; `which
    'cheapest'` for a one-attempt read, `selectedNow false` when `selectOutbound(list.flights, limitsOf(d))` differs
    from the stored index after a limit edit, `underCurrentLimits false` when the stored limits differ, and null for
    every status but read and for a read whose attempts listed no return; `mismatchOf` is non-null exactly when the cheapest offer's price differs from the shown return's "from" price; `limitsOf(d)` equals the literal
    `flightLimitsOf` result for a fixture with every constraint set (in `flightLines.test.ts`); `isSyntheticRead` is true for a pairing figure with real list provenance and a fixture-provider `gridPrice`, and for a calendar figure with a
    fixture-provider pairing group (R-synthetic, prov-r3-008); `overview.ts` marks a pairing figure
    `notChecked`; `howFar.ts` words a pairing figure as the browser worker's flight list; `datesState.ts`'s detail patch opens a pairing figure on the calendar basis (through `resultBasisOf`); a card and a results header with a pairing
    figure render calendar-styled with "not checked" and `COPY.basisName.pairing` (a card words it "cheapest of the sellers read, not checked with the airline", since it carries no seller, offer count or
    grid price: prov-006, 21.7 persona H1) (arch-r3-003); the results header explains a pairing figure as "It is a seller's offer
    read from the browser worker's flight list for one outbound and one return, not one of the prices listed here." (21.7
    prov-002).
  - `returns.test.tsx` (fake timers; the msw handler serving `PAIRING_FIXTURE` as the list, `maxStops 1`): the block's
    head reads, in one sentence, "Outbound flights, and the return flights for the next-cheapest outbound read within your
    limits; the first Back price is a seller's stated price · read 3d ago, 12 Mar 11:44 · prices from Google Flights, not
    checked with the airline" (the seller clause only when the first Back line shows a seller's price; 21.7 ui-003/004,
    prov-001); the pairing section headed "With the next-cheapest outbound read within your limits (the cheapest one's returns were all over your
    limits):" with the line "Out: depart 07:15, arrive 18:05 +1 · 10h 50m · 1 change · QQ Air" for `flights[3]` (its mark; no price on this
    line); the shown "Back:" line with the offer's price FIRST ("Back: £1,180 round trip · QQ Travel · cheapest of 3 offers read · depart 14:20, arrive 06:25 +1 · 12h 05m ·
    1 change · QQ Air") through `PriceCell` compact with the list's provenance, the calendar style, the stale mark and the age, the block's one emphasised price
    (the class `flight-price-lead` on its `.flight-price`, only for a seller's stated price within the limits: 21.7 re-review N2; every return price inside the inline `.flight-price`: 21.7 ui-001/002), then directly under it (before
    the other returns: 21.7 code M4) the line "this price is for the Out: and Back: flights shown" and "to book, search these dates on Google Flights (the link below); this app opens no
    seller; Google may show different flights or prices when you search"; an incomplete booking (`moreControl true` with the cheapest offer above the "from") adds "· a cheaper seller may not have been read" on the
    shown line itself (21.7 prov-006) and the row does not lead;
    the other "Back:" lines with "from £1,250 round trip" first (the return's "from" price through `PriceCell`), in `chooseReturnsToShow` order, each
    with its marks on the line below and a "−1" arrival rendered with its full date for assistive technology; "from £" on every outbound
    line and on every return line but the shown one, never before an offer's price (Review Focus 5); a fare-named offer reads "QQ Fares,
    Economy Basic"; no anchor to any seller (`apps/web/src` holds no seller URL and the block's only anchor is the date pair's Google Flights
    link); a seller name of `<img src=x onerror=1>` renders as text; the outbound list marks `flights[3]` "selected for the returns above" and
    `flights[2]` "tried first: its returns were all over your limits"; the two toggles are named "show all return
    flights" and "show all outbound flights", each keeping its name with `aria-expanded` the state and `aria-controls` its list
    (the returns list named "return flights for the selected outbound", the toggle directly under it, a live region saying
    "all 5 return flights shown": 21.7 code M2, ui-007), focus staying on the pressed toggle, keyboard
    operable, the expanded return order `allReturnsInOrder`; the limits line reads "airline settings not applied to
    flights read · windows apply to the outbound" without "return leg not read; " when returns were read, and with it
    for `returns: null` and every non-read status; the mismatch line "the cheapest offer read is £1,195; Google's list showed from £1,180" (both figures through `PriceCell`) when `mismatchOf` is
    non-null and not otherwise; a `sellers-not-read` pairing (the booking `expand-failed`) shows the shown "Back:" line as
    "from £1,180 round trip · sellers not read" with the transient booking note (21.7 prov-014); the more-listed line when `moreListed`; a one-attempt read with
    `triedAll false` shows "1 of the 5 outbounds within your limits were tried; other outbounds not tried" (every count under the
    read's limits; "… within your limits when read were tried …" after a limit edit: 21.7 prov-011); a read whose selected
    outbound fits and none of its returns does heads the section "No return flight within your limits for this outbound; the
    cheapest pairing read is shown, over your limits:" and keeps the seller's price on its Back line with the over-limit
    mark (21.7 code I3); a read with
    `outboundFits false` heads the block "… for the cheapest outbound read, which is over your limits …", the section
    "With the cheapest outbound read (over your limits):", and the line "none of the 4 outbound flights read is within
    your limits; the cheapest one's returns are shown"; a read whose attempts listed none heads WP20's "Outbound
    flights only · …" plus "Google listed return flights, none this app could read for these airports and dates"; a
    read after a limit edit (`selectedNow false` or `underCurrentLimits false`) heads the section "With the cheapest
    outbound read, selected under your limits when read, 3d ago:" (or "With the cheapest outbound read, over your limits
    when read, 3d ago:" when no outbound fitted: 21.7 code M13), the block "… for the next-cheapest outbound read, selected
    under your limits when read, 3d ago, 12 Mar 11:44 …", never "within your limits" (21.7 code I2), and adds "your limits
    have changed since; the returns are read again at the next search"; every non-read status shows WP20's head and its
    status note directly under it (21.7 ui-006) (one
    assertion per status that the head does not mention return flights); `returns: null` renders the block with the
    same explicit assertions as WP20's `flights.test.tsx` (no snapshot); the live region says "Flights read for 14 →
    24 Mar, 2 return flights" when a pressed read lands with returns (the shown pairing's attempt's count), the status note's words for a non-read status,
    and focus stays on the block when the pairing section appears; the read button reads "Read flights for this date (free, up to 2 pages)" (the count from the flight-lists response's `pagesPlanned` meta; "1 page" on
    an unverified worker) and, with 1 page left in the month, "Read flights for this date (free, 1 page; return leg not read: fewer than 2 pages left)"
    (never a refusal: R-low-pages); a
    return carrier of `<img src=x onerror=1>` renders as text; "verified" nowhere; a stale list's pairing shows the
    stale mark; a return outside every limit set is marked.
  - `board.test.tsx` and `logic/board.test.ts` (extend): a row with basis `'pairing'` renders its figure through `PriceCell` with the flight-list source label, the age and "not checked", the seller line "QQ Travel · cheapest of 3 offers read", "2nd outbound tried" and "Out: 07:15 · Back: 14:20" beneath,
    the group named by those visible lines and described by "next-cheapest outbound read within your limits (the cheapest one's returns were all over your
    limits)" for the fixture, the one-attempt read with no "2nd outbound tried" (21.7 persona H2, code M3, ui-008), "Google listed from £1,180" when the group's `mismatch` is true, with the grid price beneath through `PriceCell` compact carrying its own
    source first ("the date grid showed £564 · 10 Mar 09:30"; "the Aviasales cache showed …" for a cached price: 21.7 prov-003), age and stale mark, and "airline settings not
    applied to flights read" when the search sets airlines or layovers and nothing when it sets none; a calendar
    figure with `pairingRead 'within-older'` shows "return flights read 9d ago, older than this search's refresh:"
    and the pairing beneath through `PriceCell` with its age, `'within-other-limits'` "return flights read under
    earlier limits:", `'over-limit'` "no pairing within your limits read" with the pairing beneath (its offer when one was read, as the block shows it:
    21.7 code I3), an offer beneath that differs from its "from" price also "Google listed from £1,180" (21.7 code M12), `'sellers-not-read'` "from £1,180 · sellers not read" beneath the grid price, `'offers-incomplete'` the offer beneath with "a cheaper seller may not
    have been read", `'no-pairing-read'`
    "no return flight read", `'outbound-only'` "return leg not read" (an outbound-only list only), `'list-failed'` "flights couldn't be read: <the
    `listReason` in words>" (a failed newest list; never "return leg not read"; the 21.6 ruling), `'not-read'` "flights not read" (never when a
    list exists; "loading flights" while the flight-lists request is pending, the mark kept and "flights couldn't be loaded; prices shown without
    flights" above the board when it failed: 21.7 prov-004); "seller prices read for 1 of the 2 date pairs shown" in the board's head when a
    pairing figure is shown (21.7 persona coverage); the rank column follows the response's order; the phone card the same; the overview carries "not
    checked" on a pairing figure; the tie line and `orderWithinTie` unchanged.
  - `estimateLine.test.ts` (extend): `flightLists { pairs: 10, pages: 15, seconds: 2450, pagesMax: 20, secondsMax: 3000, returns: true }` reads "+ flights,
    out and back, for up to 10 date pairs: usually about 15 pages and 41 minutes, at most 20 pages and 50 minutes"; `returns: false` "+ flights for up to 10 date
    pairs, about 12 minutes"; a one-pair plan out and back reads "for up to 1 date pair: usually about 2 pages …", and the engine's line with no
    pair out and back (`returns: false`, its bound kept) reads the outbound-only words (21.7 code I1: the engine states `returns: outAndBack > 0`).
  - `flights.test.tsx`: every existing case green with the fixtures extended (`flightListsResponse` entries gain
    `returns: null` by default; the difference line's cases become the grid-price line's).
  - The copy catalogue and rendered-sweep tests cover every new key (no banned word; "from" before every return-price template and never before an
    offer's; never "each seller", "every seller" or "lowest seller price", in any string or any template's sample output; "round trip" spelt one way:
    21.7 code M5).
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates test/state test/views/searches/logic/estimateLine.test.ts test/copy`; `pnpm --filter @gmt/web typecheck`.
- [ ] **Implement** as §5: `PairingSection` inside `ListSection` after the head; `ReturnRow` as `FlightRow` with the
  price first and `legMarks('return', …)`; the board's figure cell by an exhaustive basis switch; `estimateLine.ts`
  from `pairs` and `pages`; core's optional markers of this task's fields removed (`pnpm -r typecheck` green).
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test` at 70% / 60% (ending with `test:tz`); `pnpm -r typecheck`.
- [ ] **Commit**: `wp21: the cheapest seller's price leads each read date pair while fresh, with its outbound, return flights, sellers and both legs' limits on a search's page`.

### Task 21.8: The smoke, the docs

**Files**: `apps/web/e2e/{smoke.spec,selectors}.ts`, `test/e2e/selectors.test.tsx`; `apps/web/PRODUCT.md`, `docs/providers.md`, `docs/setup.md`.

- [ ] `smoke.spec.ts`: the fixture-only search's flights area still reads "Flight times need the browser worker" (the
  fixture provider has no flight lists, so no e2e run can show a pairing: no jsdom test claims the pairing's 375 px
  layout, and the `@phone` project asserts only what it can see); `SMOKE` gains `pairing` for the pairing section's
  test id, pinned by `selectors.test.tsx` against a rendered block with returns.
- [ ] `apps/web/PRODUCT.md` (:82–86): the flight-list bullet says the browser worker also selects the cheapest outbound
  within the search's journey, stops and time limits, reads the return flights Google lists with it (and the next outbound's, from a fresh load of the page, when none fits), each priced as Google words it ("from"), then opens the booking options of the shown pairing and reads the offers Google listed, the cheapest of
  which leads the date pair while the list is fresh and the offers are complete, the grid price beside it; booking stays on Google (the app opens no seller); return
  flights and sellers are read only on worker machines whose recording session set the flags (the operator's Mac at present); "no return leg" becomes "one or two outbounds'
  returns, not every pairing". `docs/providers.md` (:24 and :69): the verdict cell and the flight-list paragraph say
  the same in one sentence each, that a date pair costs 1 page, or 2 with a second outbound, each spaced like any page, and where returns and offers are read. `docs/setup.md`: the worker's page-count sentence and the recording session's list gain the
  `select-outbound` kind; the example JSON block unchanged (`docs.test.ts` holds it byte for byte).
- [ ] **Run**: `pnpm --filter @gmt/web e2e` locally (desktop and `@phone`), `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts`, `pnpm exec vitest run scripts/wording.test.mjs`.
- [ ] **Commit**: `wp21: smoke selector and docs for the return leg`.

## 9. Pinned review-focus tests

1. One selection rule: `select.test.ts` (the property, ties by index, stops and windows), `returnPhase.test.ts` (the
   clicked name is `names[2]`, neither first nor cheapest; `outboundIndex` equals core's pick; the pick outside the
   30), `flightLists.test.ts` (db: `outbound_position` read back), `pairing.test.ts`, `datePairs.test.ts` and
   `pairing.test.ts` (web) over the one `PAIRING_FIXTURE` from `@gmt/core/testing` with the same literals (`attempt 1`, `returnIndex 0`, `118000`, `QQ
   Travel`, 3 offers), `returnPhase.test.ts` and `pairing.test.ts` (the tie on the "from" price), `returns.test.tsx` (the "Out:" line is `flights[3]`).
2. A wrong return or booking view is not a block and is not repeated: `returnPhase.test.ts` (every transient case of the return and the
   booking steps through the shared helper, the unchanged-view cases, the no-flights line never settling a view, the spacing and
   list-facts deadlines; the block table after each activation; the full actions list with no offer or grouped control touched),
   `flightLists.test.ts` (`returnsStopped` and `bookingStopped` after the first transient status).
3. Transient, old and other-limit lists read again: `migration0012.test.ts`, `flightLists.test.ts` (`returns: null`,
   `newestWithReturns` never an older list), `flightListsSelect.test.ts` and `flightRead.test.ts` (one case per status,
   `not-verified` with the flag on, the limits comparison, the 0.9 × refresh boundary), `returns.test.tsx` (WP20's
   rendering for null).
4. One pages number: `monthly.test.ts` and `pacer.test.ts` (Task 21.0), `guard.test.ts` and `returnPhase.test.ts` (the activation gate, the reservation
   stop, the reservation of 2, the settle literals 1 and 2, `pagesLoaded` 0..2 on every kind, the headroom exact fit at 2, the budget literal 750,000),
   `attempt.test.ts`, `limiter.test.ts` and `limits.test.ts` (`pages: 2`, the per-request timeout literals 780 / 600, `pageCountOf` with 0, `holdUntil`),
   `budgetGuard.flightLists.test.ts` (pending, finalised 0/1/NULL and unknown rows; the sums; exactly at the cap and one over), `snapshot.test.ts` (20),
   `estimate.test.ts` (the typical and bound figures; the month at 1, 2, 3 pages left), `budgetFit.test.ts` (two daily schedules fit); the Providers page and `gmt browser counts` unchanged because `calls` is the sum.
5. Prices lead honestly: `returns.test.ts` (core: `fromMinor` ≥ 1, `offerSchema` refuses a price of 0), `offers.test.ts` (a "From" offer is
   null), `figure.test.ts`/`rank.test.ts` (`pairingLeads`: fits, fresh, current limits, an offer), `datePairs.test.ts` (api: basis, provenance, the seller words, `which`, the times, `mismatch`, `gridPrice`, the pairing group beneath an older,
   other-limit, sellers-not-read or offers-incomplete list with `isFrom`, every `pairingRead` value, `fromEarlierSearch` from the list's fetch), `board.test.tsx` and `returns.test.tsx` ("from" on every return's own price and never
   before an offer's; the grid price beneath through `PriceCell` with its source, time and stale mark; no seller anchor; "verified" nowhere;
   the synthetic banner on a fixture grid price).

Also pinned: every return, offer, pairing and grid price through `PriceCell` with its own provenance and age; coverage, the buckets and
the key unchanged by a flight read (`board.test.tsx` over `overview.test.ts`'s fixtures); the worker activates nothing new on a list page,
nothing without `returnLimits`, nothing on an entry whose flag is false, never an offer, a grouped control or a seller's host, loads no
URL but its own form, and the guard's allowlist holds after every activation (`rules.test.ts`, `returnPhase.test.ts`, `guard.test.ts`); a true flag names a recording in `PROOFS` and an unnamed flag is false, CI-run on every commit
(`flagsProofs.test.ts`); list mode over every recorded page unchanged (`recorded.test.ts`); the banned words over every
new string; no page text in any test, console line or the findings note (hashes and booleans only); every fixture that
meets a contract built through its schema's `parse`.

## 10. Definition of done

- Task 21.0 is done: its recordings are backed up at `~/.local/share/get-me-there/private/fixtures/camoufox-2026-11-01/`, the findings note is written
  and its two stop-and-ask conditions were ruled on (2026-11-01); the end-to-end recording of R-e2e exists on the controller's machine and its suites
  ran with `RECORDINGS_REQUIRED=1` (executed > 0, skipped 0) before the flags flipped.
- Spec revision 56 written (Task 21.1) with every rule of this brief in its section; the WP20 design doc's two
  passages carry the ruling.
- `pnpm --filter @gmt/core test` (100%), `pnpm --filter @gmt/camoufox-worker test`, `pnpm --filter @gmt/providers test`,
  `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` (85% / 70%), the CLI's
  tests, `pnpm --filter @gmt/web test` (70% / 60%, ending with `test:tz`), each green; the worker's recorded suites
  (`recorded`, `flightsRecorded`, `gridRecorded`, `selectRecorded`, `bookingRecorded`, `returnsRecorded`, `offersRecorded`) green on the
  controller's machine.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`,
  `node scripts/check-mutation-globs.mjs` (nothing pending for WP21 once `status` is `merged`), `pnpm test`.
- Mutation at ≥ 80% with timed-out mutants under 5%: `pnpm --filter @gmt/core mutate` (`flights/{returns,choose,types,limits}.ts`,
  `datePairs/{pairing,figure,rank}.ts` among its list), `pnpm --filter @gmt/camoufox-worker mutate` (`returns.ts`, `offers.ts`, `returnPhase.ts`, `classify.ts`, `ready.ts`, `names.ts`, `flights.ts`,
  `monthly.ts`, `guard.ts`),
  `pnpm --filter @gmt/engine mutate` (`stages/flightLists/select.ts`, `stages/flightLists.ts`, `estimate.ts`, `flightRead.ts`).
- `RETURN_SELECT_VERIFIED` and `BOOKING_SELECT_VERIFIED` true for darwin-arm64 only, named by `PROOFS` with the recording keys of the
  served sequence; false on every other entry; `/v1/status` reports both; `flagsProofs.test.ts` green in CI on every commit.
- `pnpm --filter @gmt/web e2e` green on the desktop and `@phone` projects; CI's `e2e` job green on the PR.
- `pnpm exec vitest run scripts/wording.test.mjs scripts/workflows.test.mjs` green, and
  `git diff main...HEAD | grep -nP '\b[Bb][Oo][t](s?\b|[A-Z_-])'` returns nothing; no commit message names a vendor's
  site or a data-collection method.
- No orphaned vitest, Stryker, Playwright or browser process after the runs; the worker is running again after the recording.
- The PR description (PR #38, or its successor) carries the changed-file count and the CodeRabbit route; every
  CodeRabbit thread fixed and resolved.

## 11. Open questions

None. Ian's four rulings of 2026-11-01 (the pairing's price leads; a second outbound, and the cheapest outbound's returns read anyway
when none fits; the booking options read for the shown pairing, the headline the cheapest offer's stated price; the "more booking
options" expansion opened first) and the orchestrator's rulings on both reviews and on Task 21.0 are folded into the text above. Task
21.0's stop-and-ask conditions have all been met or ruled; no condition remains that needs Ian before the build.
