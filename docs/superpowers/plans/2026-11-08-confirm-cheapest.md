# Confirm the Cheapest Trips Automatically: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search reads real flights for its cheapest calendar dates until rule A says more checking stops helping, and every view leads with the trips it confirmed at their real price.

**Architecture:** The rule is pure and lives in `core` (`flights/confirm.ts`: standings, improvement, stop, the confirmed price of one read). The engine's flight-list step builds an open-ended queue from the calendar ranking, fills the standings from reusable lists, then reads through `runPool` and aborts its intake when the rule says stop. The board's shared ranking puts date pairs with flights read before calendar-only ones, and the lead rule stops requiring a seller offer, so the api, the card and the web all move together.

**Tech Stack:** TypeScript 5.9, pnpm workspace, Vitest, zod, SQLite/Drizzle, React 19.

**Spec:** `docs/superpowers/specs/2026-11-08-confirm-cheapest-design.md` (approved by Ian 2026-11-08). The main spec it amends: `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`.

## Global Constraints

- No `as` casts except `as const`/`satisfies`; brands only through core's helpers or zod.
- Tests are event-driven: no sleeps, no poll-until loops; clocks are injected or faked. Every test that drives many pages states an explicit timeout (15_000) so a slow Windows runner does not time it out at 5 s.
- Public wording: no mention of bots, detection, evasion, robots.txt or terms of service anywhere; commit messages and PR text never mention Google or scraping. Examples use London → New York (LHR/LGW → JFK/EWR) or synthetic QQ*/AAA codes. Run the three greps from the PR routine before every push.
- `CONFIRM_TARGET = 5`, `CONFIRM_PATIENCE = 12`, a flight read costed at `FLIGHT_READ_SECONDS = 25`. No other new numbers.
- Run one vitest suite (package) at a time. Before pushing, also run `npx vitest run scripts` and `node scripts/check-mutation-globs.mjs` from the repo root.
- A file added to or removed from a package's pure logic is reflected in its `stryker.config.json` `mutate` list and in the brief front matter that names it.
- The PR lands by squash-merge; plain fix commits are fine.

## Review Focus

1. **Returns cannot be read on this machine** (`RETURN_SELECT_VERIFIED` off): the step reads the first 10 pairs outbound-only as today, nothing claims to be confirmed, and the stop line says trips couldn't be confirmed here. Test in Task 3.
2. **A calendar with long runs of equal prices** (80 pairs at one price): the queue keeps the board's order and patience still ends the step after 12 non-improving reads. Test in Task 3.
3. **Limits no flight can meet** (a journey limit shorter than every flight): the step stops after 12 reads with 0 confirmed, and the page says "Checked 12 dates; 0 trips confirmed…". Tests in Tasks 3 and 5.
4. **A second run within the refresh**: it reuses the first run's confirmed trips without a page, spends patience only on dates not yet read, and reads past where the first run stopped. Test in Task 3.
5. **The window closes or the run is cancelled mid-step**: reads in flight finish and are kept, the stop is recorded, and the page words it. Tests in Tasks 3 and 5.

---

### Task 1: The confirm rule in `core`

**Files:**
- Create: `packages/core/src/flights/confirm.ts`
- Modify: `packages/core/src/flights/index.ts` (export the new module), `packages/core/src/datePairs/pairing.ts` (add `pairingOffer`), `apps/api/src/read/pairings.ts` (`candidateOf` uses `pairingOffer`), `packages/core/stryker.config.json` (add `src/flights/confirm.ts` to `mutate`)
- Test: `packages/core/test/flights/confirm.test.ts`, `packages/core/test/datePairs/pairing.test.ts`

**Interfaces:**
- Produces:
  - `CONFIRM_TARGET = 5`, `CONFIRM_PATIENCE = 12`
  - `interface Standings { prices: readonly number[]; sinceImprovement: number }` (`prices` ascending pence)
  - `EMPTY_STANDINGS: Standings` (`{ prices: [], sinceImprovement: 0 }`)
  - `type Check = { kind: 'confirmed'; pricePence: number } | { kind: 'unconfirmed' }`
  - `improves(s: Standings, c: Check): boolean`
  - `applyCheck(s: Standings, c: Check, by: 'read' | 'reuse'): Standings`
  - `patienceSpent(s: Standings): boolean` (`s.sinceImprovement >= CONFIRM_PATIENCE`)
  - `uncheckedCheaper(remaining: readonly number[], s: Standings): number`
  - `pairingOffer(r: ReturnRead, flights: readonly ListedFlight[], p: Pairing): { offer: Offer | null; complete: boolean }` in `pairing.ts`
  - `confirmedPriceOf(r: ReturnRead, flights: readonly ListedFlight[], limits: FlightLimits): number | null`

- [ ] **Step 1: Write the failing tests** in `confirm.test.ts`:
  - `improves`: with fewer than 5 prices any `confirmed` improves; with 5, only a price below `prices[4]` does; `unconfirmed` never does.
  - `applyCheck` by `read`: an improving check inserts the price in order and sets `sinceImprovement` to 0; any other adds 1 (a dearer `confirmed` is still inserted in `prices`).
  - `applyCheck` by `reuse`: inserts a confirmed price and leaves `sinceImprovement` unchanged either way.
  - The design's worked example (§4.4): reads confirming 35200, 37100, 34900, 36000, 39800, 35600, then 12 reads of 37200–42000 including two `unconfirmed`: `patienceSpent` is false after read 17 and true after read 18; the first five prices are `[34900, 35200, 35600, 36000, 37100]`.
  - `patienceSpent` with 0 confirmed after 12 `unconfirmed` reads is true (the rule holds below the target).
  - `uncheckedCheaper([36000, 37000, 38000], s)` with 5th price 37100 is 2; with 3 confirmed it is 3 (every remaining pair).
  - `confirmedPriceOf`: null with no fitting pairing; the cheapest offer's price when the booking read names the pairing and `offersComplete`; the pairing's `fromMinor` when the booking names another return, kept no offers, or is incomplete. Build `ReturnRead`/`ListedFlight` values with the fixtures the existing `pairing.test.ts` uses.

- [ ] **Step 2: Run** `cd packages/core && npx vitest run test/flights/confirm.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `confirm.ts` and `pairingOffer`. `pairingOffer` moves the `forPairing` test out of the api's `candidateOf` (the booking counts only when its attempt and return equal both `bookingReturnOf`'s and the pairing's) and returns `cheapestOffer(b)?.offer ?? null` with `complete = offer !== null && offersComplete(b, p.fromMinor)`. `confirmedPriceOf` = `cheapestPairing(r, flights, limits)`; null unless `outboundFits && returnFits`; then the offer's `priceMinor` when `complete`, else `fromMinor`. `candidateOf` in the api calls `pairingOffer` and keeps its output unchanged.

- [ ] **Step 4: Run** the core suite, then `cd apps/api && npx vitest run test/routes/pairingFigure.test.ts test/routes/flightLists.test.ts`. Expected: PASS, the api's pairing tests unchanged.

- [ ] **Step 5: Commit** `git commit -m "Add the rule that decides when enough trips are confirmed"`.

---

### Task 2: Trips with flights read lead and rank first

**Files:**
- Modify: `packages/core/src/datePairs/pairing.ts` (`pairingLeads`, `pairingReadOf`), `packages/core/src/datePairs/figure.ts` (`withPairing`, `overStaleVerified`), `packages/core/src/datePairs/rank.ts` (`rankDatePairs`)
- Test: `packages/core/test/datePairs/pairing.test.ts`, `figure.test.ts`, `rank.test.ts`; update the api and web tests that pinned the old lead rule

**Interfaces:**
- Consumes: `pairingOffer` (Task 1).
- Produces: `pairingLeads(p: LeadFacts, gridFetchedAt)` with the same signature; `rankDatePairs(pairs, now)` with the same signature and a new first key after `current`.

- [ ] **Step 1: Write the failing tests:**
  - `pairingLeads` is true for a fitting, current-limits, fresh pairing with `offer: null`, and with an offer that is not complete. It stays false for a pairing over the limits, under other limits, or older than the refresh while a newer grid price exists (`gridFetchedAt` later), which keeps Ian's 2026-11-06 ruling.
  - `pairingReadOf` returns `within` for both cases above; `sellers-not-read` and `offers-incomplete` are no longer returned for a fitting current pairing.
  - `figuresByDatePair`: a calendar figure whose cell's pairing fits with no offer becomes a `pairing` figure priced at the pairing's `fromMinor`; with complete offers, at the cheapest offer; with incomplete offers, at `fromMinor`.
  - `rankDatePairs`: a `pairing` figure at 63400 ranks before a `calendar` figure at 56500; two `pairing` figures rank by price; a superseded figure still ranks after every current one; a `verified` figure ranks with the pairing ones by price.
  - The api's search card (`apps/api/test/routes/cards.test.ts`): with a calendar figure at 56500 and a fitting pairing at 63400 on another date pair, the card's `cheapest` is the 63400 pairing (design §5.6).
  - No overview change: `shadeScale` reads each figure's own price, not the ranking, and the "outlined: on the board above" ring marks the board's rows, which are now the confirmed trips; the existing overview tests must still pass unchanged.

- [ ] **Step 2: Run** `cd packages/core && npx vitest run test/datePairs`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement.** `pairingLeads` drops `p.offer !== null && p.complete`. In `figure.ts` the price is `candidate.offer !== null && candidate.complete ? candidate.offer.priceMinor : candidate.fromMinor`, and the `offer === null` early returns go. In `rankDatePairs` add the key `checked: p.figure.basis === 'calendar' ? 1 : 0`, compared after `current` and before `price`. Update the doc comments to name spec revision 68.

- [ ] **Step 4: Run** core, then `apps/api`, then `apps/web`, one at a time. Fix each test that pinned the old rule (a pairing without offers not leading, a calendar row outranking a dearer pairing) to the new expectation; change no test that pins something else. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Lead and rank date pairs by the trips whose flights were read"`.

---

### Task 3: The flight-list step reads until rule A stops it

**Files:**
- Modify: `packages/engine/src/stages/flightLists.ts`, `packages/engine/src/stages/flightLists/select.ts`, `packages/engine/src/types.ts` (`RankedDatePair.basis`), `apps/api/src/read/ranked.ts` (`rankedPairsFor` sets `basis`), `packages/core/src/types/execution.ts` and `packages/core/src/api-contract/executions.ts` (`FlightListsState.confirm`), `packages/engine/src/stages/flightLists.ts` `returnPhaseOf`, `packages/db/src/budgetGuard.ts` (flight allowance no longer refuses), `packages/engine/src/snapshot.ts` (comment only)
- Test: `packages/engine/test/stages/flightLists.test.ts`, `flightListsEdges.test.ts`, `flightListsResume.test.ts`, `flightListsSelect.test.ts`, `packages/db/test/budgetGuard.flightLists.test.ts`, `packages/core/test/api-contract/executions.test.ts`, `apps/api/test/bootstrap/engine.test.ts`

**Interfaces:**
- Consumes: Task 1's `Standings`, `applyCheck`, `patienceSpent`, `uncheckedCheaper`, `confirmedPriceOf`, `EMPTY_STANDINGS`.
- Produces:
  - `RankedDatePair.basis: FigureBasis`
  - `FlightListsState.confirm?: ConfirmSummary | null`, where `interface ConfirmSummary { reads: number; reused: number; confirmed: number; uncheckedCheaper: number; stop: 'patience' | 'queue-empty' | 'returns-stopped' | null }` (`null` while running and on the existing `ended` stops). Schema: `confirm: z.strictObject({...}).nullable().exactOptional()`, absent read as null.
  - `confirmQueue(ranked: readonly RankedDatePair[], todayLondon: IsoDate): RankedDatePair[]` in `select.ts`: every pair departing after today whose `basis` is not `verified`, in the given order.

- [ ] **Step 1: Write the failing tests** in `flightLists.test.ts` (fake worker and in-memory repos as the existing step tests use; `CAMOUFOX_PAGES_AT_ONCE: '4'` where stated; 15_000 timeouts):
  - **Rule A ends the step:** 40 ranked pairs; the fake worker confirms prices so that the 5th-cheapest settles after read 6 and reads 7–18 do not improve. Exactly 18 reads are *started* at concurrency 1; at concurrency 4, no read starts after the 12th non-improving one finishes, and every read already started writes its row. Stored `confirm` is `{ reads, reused: 0, confirmed, uncheckedCheaper, stop: 'patience' }` with `uncheckedCheaper` equal to the remaining pairs whose calendar price is below the 5th confirmed price.
  - **Patience counts reads in finishing order:** at concurrency 4, the fake worker finishes reads out of queue order (hold read 1, release reads 2–4 first); the stop is decided by finishing order.
  - **Reuse fills the standings without spending patience** (Review Focus 4): a second run within the refresh, over the same 40 pairs, reuses the first run's read lists (`reused` equals their count, no request for them) and reads only pairs the first run did not, starting at the first unread pair in queue order.
  - **No trip can be confirmed** (Review Focus 3): every read returns `no-outbound`; the step stops after 12 reads with `confirmed: 0`, `stop: 'patience'`.
  - **Equal prices** (Review Focus 2): 80 pairs at one calendar price; reads follow the ranked order and the step stops at patience.
  - **Queue empty:** 7 pairs, all confirming: 7 reads, `stop: 'queue-empty'`.
  - **Returns lost part-way:** read 3 ends with a transient return status (`returnsStopOf` non-null); no read starts after it; reads in flight finish; `stop: 'returns-stopped'`.
  - **Returns off from the start** (Review Focus 1): worker flags without `RETURN_SELECT_VERIFIED`; the step reads the first `FLIGHT_LIST_COUNT` pairs outbound-only as before and stores `confirm: null`.
  - **Window and cancel** (Review Focus 5): the existing first-stop tests still pass; with the new queue, a window met mid-step stores `ended: 'window'`, `confirm.stop: null`, and the counts so far.
  - **No allowance stop:** a run of 30 reads with returns completes with no `BudgetExceeded` from the flight allowance (`budgetGuard.flightLists.test.ts`: a flights request past `flightListPages` pages is reserved, not refused).
  - **Verified pairs are not queued:** `confirmQueue` drops `basis: 'verified'` and departed pairs and keeps order (`flightListsSelect.test.ts`).
  - **Resume:** a run stopped by the window and resumed rebuilds the queue, reuses this run's read lists, and starts patience at 0.

- [ ] **Step 2: Run** `cd packages/engine && npx vitest run test/stages`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement.**
  - `rankedPairsFor` sets `basis` from the figure.
  - `returnPhaseOf(ctx, snapshot)` loses the `pairs` parameter and the allowance test: returns are planned when the worker's flags allow them.
  - `planOf` with returns planned: queue = `confirmQueue(ranked, today)`; read the newest list of every queued cell once (`newestPerCell`, as now); walk the queue, and for each reusable pair (`listReusable`) apply `{ kind: 'confirmed', pricePence: confirmedPriceOf(...) }` or `unconfirmed` by `'reuse'` from the stored list; the rest, in order, are `toRead`. Without returns, keep today's selection of the first `FLIGHT_LIST_COUNT` (`selectFlightPairs`), and store `confirm: null`.
  - The stored plan for the new mode: `cells` holds the pairs whose read has *started* (patched as each starts, so `forExecution` counts read and failed), `planned` = started + reused, `confirm` the summary. A stored plan with `confirm` present is never resumed cell by cell: `planOf` rebuilds the queue (this run's read lists are reusable, so they fill the standings).
  - In the pool worker, after `writeRow`: for `read`, `applyCheck(standings, check, 'read')` with `confirmedPriceOf(o.list.returns, o.list.flights, flightLimitsOf(constraints))` (null → `unconfirmed`; `o.list.returns === null` → `unconfirmed`); for `failed` without `end`, `applyCheck(standings, { kind: 'unconfirmed' }, 'read')`. Then, if `patienceSpent` or `returnsStopped` became non-null, set the stop (first one met decides, as `ended` does) and `intake.abort()`. After the pool: `queue-empty` when every queued pair was started and no stop was set; compute `uncheckedCheaper` from the unstarted pairs' `pricePence`; patch `confirm`.
  - `budgetGuard`: the flights scope counts pages as now and no longer compares them with `flightListPages`; the snapshot keeps the field as the step's on-switch (`flightStepEntry`). Update the comments that call it an allowance.

- [ ] **Step 4: Run** engine, then db, then core suites, one at a time. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Read flight lists until more reading stops finding cheaper trips"`.

---

### Task 4: The estimate's flight line

**Files:**
- Modify: `packages/engine/src/estimate.ts`, the web estimate copy (`apps/web/src/copy/estimate.ts`) and its line builder (`apps/web/src/views/Searches/estimateLine.ts`)
- Test: `packages/engine/test/estimate.test.ts`, `estimateLines.test.ts`, `apps/web/test/views/searches/logic/estimateLine.test.ts`

**Interfaces:**
- Consumes: `CONFIRM_TARGET`, `CONFIRM_PATIENCE` (Task 1); `confirmQueue`, `returnPhaseOf(ctx, snapshot)` (Task 3).
- Produces: `FLIGHT_READ_SECONDS = 25` in `estimate.ts` (replacing `FLIGHT_VIEW_SECONDS`); the estimate's flight object keeps its shape with `pairs` = typical reads, `pairsMax` = queue reads.

- [ ] **Step 1: Write the failing tests:** with returns planned and a queue of 300 pairs of which 10 are reusable, typical reads = `5 + 12 + 8 - 10 = 15`, at most = 290; at 4 pages at once and spacing 0 the typical seconds are `ceil(15/4) × 25 = 100` and the at-most seconds `ceil(290/4) × 25 = 1825`. A queue of 7 pairs gives 7 and 7. Without returns: today's figures for 10 outbound-only pairs at 25 s. The web line for the typical case reads "then about 2 minutes checking flights, longer if prices are close together" (minutes rounded up from the seconds; "about 1 minute" singular).

- [ ] **Step 2: Run** `cd packages/engine && npx vitest run test/estimate.test.ts test/estimateLines.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `perPair`'s page-count figures with `FLIGHT_READ_SECONDS` per read, typical = `min(queue, CONFIRM_TARGET + CONFIRM_PATIENCE + 8)` less the reusable pairs among them (floor 0), at most = queue less reusable, both through `inWaves`. Fix the comment that called the 2026-11-07 measurement outbound-only (it was ten reads with returns and booking). Update the web copy.

- [ ] **Step 4: Run** engine, then web suites. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Estimate the flight checks from measured read times"`.

---

### Task 5: The search page says one price per row, closed rows, and how checking ended

**Files:**
- Modify: `apps/api/src/read/` execution and cards readers (pass `confirm` through), `packages/core/src/api-contract/executions.ts` (the run report's `flights.confirm`), `apps/web/src/views/Dates/BoardTable.tsx`, `apps/web/src/views/Dates/board.ts`, `apps/web/src/views/Dates/TieLine.tsx` callers in `flightLines.ts`, a new `apps/web/src/views/Dates/ConfirmLine.tsx`, `apps/web/src/copy.ts`
- Test: `apps/api/test/routes/flightLists.test.ts`, `apps/api/test/routes/cards.test.ts`, `apps/web/test/views/dates/board.test.tsx`, `apps/web/test/views/dates/flights.test.tsx`, `apps/web/test/views/dates/logic/flightLines.test.ts`, `apps/web/test/views/dates/confirmLine.test.tsx` (new)

**Interfaces:**
- Consumes: `ConfirmSummary` (Task 3).
- Produces: `GET /executions/:id` and the card's `latestRun.flights` carry `confirm: ConfirmSummary | null`.

- [ ] **Step 1: Write the failing tests:**
  - **One price per row:** a `calendar` row renders its price as "calendar £565 · flights not checked" in the secondary style and not in the price column's main element; a `pairing` row renders its price in the main element with outbound and return times, journey time and changes each way. The "Google's list: from" figure is not in the closed row.
  - **Rows closed by default:** with 10 rows, no flights block is in the DOM until its row's disclosure is opened; opening one shows that row's block only; the disclosure is a button with `aria-expanded`.
  - **Ranks in order within a tie:** three pairs tied in price, reordered by shortest flight time, show ranks 1, 2, 3 top to bottom (the displayed rank is the position in the tie group).
  - **The stop line**, exact copy:
    - patience, 5 confirmed: "Checked 18 dates; 5 trips confirmed. 31 dates look cheaper on the calendar but weren't checked; the next search checks them first."
    - patience, 5 confirmed, 0 unchecked: "Checked 18 dates; 5 trips confirmed."
    - queue empty: "Checked every date that could be cheaper; 5 trips confirmed."
    - patience, fewer than 5 (Review Focus 3): "Checked 12 dates; 0 trips confirmed. The other dates' flights didn't fit your limits or couldn't be read."
    - returns stopped: "Stopped checking flights after 9 dates because return flights couldn't be read; 3 trips confirmed."
    - window / cancel (Review Focus 5): "Stopped checking flights after 9 dates because the browser's time ran out; 3 trips confirmed." and "… because the search was cancelled; …".
    - `confirm: null` with returns off: "Trips couldn't be confirmed on this machine: it can't read return flights."
    - "1 date" / "1 trip" singular in each.
  - The api passes `confirm` through unchanged, and null for a run stored before this change.

- [ ] **Step 2: Run** `cd apps/web && npx vitest run test/views/dates`. Expected: FAIL.

- [ ] **Step 3: Implement** the closed-row disclosure in `BoardTable.tsx` (the row's one line stays a real table row; the block renders only when open), the price rendering in `board.ts`/`BoardTable.tsx`, the rank renumbering in the tie grouping, and `ConfirmLine` under the table. Copy goes in `copy.ts` under `dates.confirm`.

- [ ] **Step 4: Run** api, then web suites. Check the search page at 375 px and 1280 px against the running dev server (as the date-picker PR did): no sideways scroll, closed rows, the stop line visible. Expected: PASS and both widths right.

- [ ] **Step 5: Commit** `git commit -m "Show one real price per date, closed rows, and how flight checking ended"`.

---

### Task 6: Fold the design into the main spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (header to revision 68; §6.9 lead rule and ranking; §8.1 the step, reuse, the allowance's withdrawal, the estimate; §11 Board rows, the stop line; the rev 66 measurement wording corrected; a "Revision 68" changelog entry dated 2026-11-08), `docs/superpowers/specs/2026-11-08-confirm-cheapest-design.md` (status: folded into revision 68; §5.2 says date pairs with flights read, older ones included under the 2026-11-06 ruling, rank before calendar-only ones)

- [ ] **Step 1:** Write the sections in the main spec's style: each section states one rule set, no amendment blocks.
- [ ] **Step 2:** Run the three wording greps over the diff. Expected: no hits.
- [ ] **Step 3: Commit** `git commit -m "Spec revision 68: confirm the cheapest trips automatically"`.
