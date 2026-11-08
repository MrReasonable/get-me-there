# Confirm the Cheapest Trips Automatically: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search reads real flights for its cheapest calendar dates until rule A says more checking stops helping, and every view leads with the trips whose flights were read, at their real price.

**Architecture:** The rule is pure and lives in `core` (`datePairs/confirm.ts`: standings, improvement, stop, the price of one read). The engine's flight-list step builds an open-ended queue from the calendar ranking, fills the standings from verified figures and reusable lists, then reads through `runPool` and aborts its intake when the rule says stop. The shared ranking puts read trips in two tiers before calendar-only prices, and the lead rule stops requiring a seller offer, so the api, the card and the web move together.

**Tech Stack:** TypeScript 5.9, pnpm workspace, Vitest, zod, SQLite/Drizzle, React 19.

**Spec:** `docs/superpowers/specs/2026-11-08-confirm-cheapest-design.md` (approved 2026-11-08; Ian ruled on the ranking tiers and the wording after the plan's review). The main spec it amends: `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`. Review record: `~/.cache/get-me-there/review-spec/2026-11-08-confirm-cheapest/lC1A6tcdxl/summary.md`.

## Global Constraints

- No `as` casts except `as const`/`satisfies`; brands only through core's helpers or zod.
- Tests are event-driven: no sleeps, no poll-until loops; clocks are injected or faked. Every test that drives many pages states a 15_000 timeout.
- Public wording: the repo's wording rules apply to every doc, comment, test name and commit (the orchestrator gives implementers the three wording greps; run them before every push). Examples use London → New York or synthetic QQ*/AAA codes.
- Operator-facing words are "trips with flights read", never "confirmed" (which the "≠ price not confirmed" mark owns). `confirm` is the code's term.
- New numbers: `CONFIRM_TARGET = 5`, `CONFIRM_PATIENCE = 12`, `FLIGHT_READ_SECONDS = 25`, and `CONFIRM_TYPICAL_EXTRA = 8` (the estimate's allowance for improving reads beyond the target). No others.
- One vitest suite (package) at a time; before pushing also `npx vitest run scripts` and `node scripts/check-mutation-globs.mjs` from the repo root. A pure-logic file added or removed is reflected in its package's `stryker.config.json` and in any brief front matter naming it.
- When a task changes an existing test's expectation, its commit message lists each such test and the rule change behind it.
- The PR lands by squash-merge; plain fix commits are fine.

## Review Focus

1. **Returns cannot be read on this machine:** the step reads the first 10 pairs outbound-only as today, stores mode `outbound-only`, and the page says trips couldn't be checked here. Tests in Tasks 3 and 5.
2. **Long runs of equal calendar prices:** the queue keeps the board's order and patience ends the step. Test in Task 3.
3. **Limits no flight can meet:** the step stops after 12 reads with 0 trips and the page gives the unchecked count. Tests in Tasks 3 and 5.
4. **A second run within the refresh:** reuse fills the standings without spending patience; the run reads at least 12 dates the first did not. Tests in Tasks 3 and 4.
5. **A blocked page or the window mid-step:** no row is written for unstarted pairs, reads in flight are kept, a date's last real trip still leads, and the page words the stop. Tests in Tasks 3 and 5.

---

### Task 1: The confirm rule and the one pairing price in `core`

**Files:**
- Create: `packages/core/src/datePairs/confirm.ts`
- Modify: `packages/core/src/datePairs/index.ts` (export), `packages/core/src/datePairs/pairing.ts` (`pairingOffer`, `pairingPrice`), `apps/api/src/read/pairings.ts` (`candidateOf` uses `pairingOffer`; its output unchanged), `packages/core/stryker.config.json` (add `src/datePairs/confirm.ts`)
- Test: `packages/core/test/datePairs/confirm.test.ts` (new), `packages/core/test/datePairs/pairing.test.ts`

**Interfaces:**
- Produces:
  - `CONFIRM_TARGET = 5`, `CONFIRM_PATIENCE = 12`
  - `interface Standings { prices: readonly number[]; sinceImprovement: number }` (ascending pence); `EMPTY_STANDINGS`
  - `type Check = { kind: 'confirmed'; pricePence: number } | { kind: 'none' } | { kind: 'unread' }` (`none`: no trip within limits; `unread`: §4.3's third bullet)
  - `improves(s: Standings, c: Check): boolean`
  - `applyCheck(s: Standings, c: Check, by: 'read' | 'reuse'): Standings`
  - `patienceSpent(s: Standings): boolean`
  - `uncheckedCheaper(remaining: readonly number[], s: Standings): number`
  - `type PairingPriceKind = 'seller' | 'google'`
  - `pairingPrice(c: { offer: { priceMinor: number } | null; complete: boolean; fromMinor: number }): { pricePence: number; kind: PairingPriceKind }`
  - `pairingOffer(r: ReturnRead, flights: readonly ListedFlight[], p: Pairing): { offer: Offer | null; complete: boolean }`
  - `checkOfRead(r: ReturnRead | null, flights: readonly ListedFlight[], limits: FlightLimits): Check`

- [ ] **Step 1: Write the failing tests** in `confirm.test.ts`:
  - `improves`: below 5 prices any `confirmed` improves; with 5, only a price strictly below `prices[4]` (a price equal to `prices[4]` does not); `none` and `unread` never do.
  - `applyCheck` by `read`: an improving check inserts in order and sets `sinceImprovement` to 0; any other adds 1, and a dearer `confirmed` is still inserted.
  - `applyCheck` by `reuse`: inserts a confirmed price; `sinceImprovement` unchanged either way.
  - The worked example (design §4.4), prices in pence: reads 35200, 37100, 34900, 36000, 39800, 35600, then 12 non-improving reads of 37200–42000 with two `none`: `patienceSpent` false after read 17, true after read 18; `prices.slice(0, 5)` is `[34900, 35200, 35600, 36000, 37100]`.
  - `patienceSpent` after 12 `unread` reads with 0 prices is true.
  - `uncheckedCheaper([36000, 37100, 38000], s)` with 5th price 37100 is 1 (equal is not below); with 3 prices it is 3.
  - `pairingPrice`: complete offer → `{ offer price, 'seller' }`; no offer → `{ fromMinor, 'google' }`; incomplete offer → `{ fromMinor, 'google' }`.
  - `checkOfRead`: `none` with no fitting pairing or a `no-outbound` read; `unread` with `r === null`, a return status other than `read`/`no-outbound`, or `r.limits` not `sameFlightLimits` with `limits`; `confirmed` at `pairingPrice` otherwise, including a booking that ended transient (priced at `fromMinor`). Build fixtures as `pairing.test.ts` does. (A limit can never pass without evidence: the flight schema requires duration, stops and both times.)

- [ ] **Step 2: Run** `cd packages/core && npx vitest run test/datePairs/confirm.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** `pairingOffer` moves `candidateOf`'s `forPairing` test into core unchanged. `checkOfRead` = `cheapestPairing(r, flights, limits)` then `pairingOffer` then `pairingPrice`. `candidateOf` calls `pairingOffer` and its output is unchanged (`pairingGroupOf` changes in Task 2, with the contract).

- [ ] **Step 4: Run** core, then `cd apps/api && npx vitest run test/routes/pairingFigure.test.ts test/routes/flightLists.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Add the rule that decides when enough trips have flights read"`.

---

### Task 2: Read trips lead and rank in two tiers, worded by price kind

**Files:**
- Modify: `packages/core/src/datePairs/pairing.ts` (`pairingLeads`; `pairingReadOf` loses its `sellers-not-read` and `offers-incomplete` branches, the `PAIRING_READ` values stay for their wire codes and are never produced), `packages/core/src/datePairs/figure.ts` (`withPairing`, `overStaleVerified`), `packages/core/src/datePairs/rank.ts` (`rankTierOf`), `packages/core/src/api-contract/datePairs.ts` (the leading-pairing refinements and `beneathBreach`), `apps/api/src/read/pairings.ts` (`pairingGroupOf` prices and words its group from `pairingPrice`), `apps/web/src/views/Dates/pairing.ts` and `PairingSection.tsx` (lead with the board's price), `apps/web/src/views/Dates/board.ts` (`sellerCoverage` counts complete offers only), `apps/web/src/views/Dates/BoardCard.tsx` (an `isFrom` branch that never calls `sellerOf`), `apps/web/src/copy.ts` (`basisName.pairing`, `pairingSource`, `howFar.pairing` per kind; the beneath-rule copy that becomes unreachable is removed), `apps/web/src/views/Dates/OverviewGrid.tsx` and the legend copy (`ring`)
- Test: `packages/core/test/datePairs/pairing.test.ts`, `figure.test.ts`, `rank.test.ts`; `apps/api/test/routes/cards.test.ts`, `pairingFigure.test.ts`; `apps/web/test/views/dates/flights.test.tsx`, `board.test.tsx`, `overview.test.tsx`, `logic/pairing.test.ts`

**Interfaces:**
- Consumes: `pairingPrice`, `PairingPriceKind` (Task 1).
- Produces: `pairingLeads` (same signature); `rankTierOf(f: DatePairFigure): 0 | 1 | 2` (used by `rankDatePairs` and by Task 5's tie key and tier break); `pairingKindOf(g: DatePairPairing): 'seller' | 'google-unread' | 'google-incomplete'` (from the group's `isFrom` and `offersRead`; no new contract field: the group's `isFrom` already says which price it is).
- The contract rule: a leading pairing figure carries either a complete offer (`isFrom` false, a seller) or the return's "from" price (`isFrom` true, no seller); never an incomplete offer's price.

- [ ] **Step 1: Write the failing tests:**
  - `pairingLeads` is true for a fitting, current-limits pairing with `offer: null` and with incomplete offers; false over the limits, under other limits, or older than the refresh with a newer grid price (the 2026-11-06 ruling unchanged).
  - `figuresByDatePair`: no offer → a `pairing` figure at `fromMinor`; complete offers → offer price; incomplete → `fromMinor`. `pairingGroupOf` gives the same price, `isFrom` true for both `fromMinor` cases, no seller, `offersRead` as read.
  - Contract (`packages/core/test/api-contract/`): a leading pairing with a complete offer parses; one at `fromMinor` with `isFrom` and no seller parses; one carrying an incomplete offer's price is refused. The figure keeps the list's provider, source kind and fetch time in its provenance. The `pairingRead` stays `within`; the seller detail ("sellers not read", "a cheaper seller may not have been read") comes from the candidate's `offer`/`complete`, shown in the expanded detail.
  - `rankTierOf` and `rankDatePairs` tiers (tier 0 = `pairing` or `verified` with `figure.price.stale === false`; 1 = any other `pairing`/`verified`; 2 = `calendar`), then price: a fresh `pairing` at 63400 before an older leading `pairing` at 60000 before a `calendar` at 56500; a fresh `verified` in tier 0, a stale `verified` in tier 1; superseded and not-seen figures still after every current one.
  - Card: a calendar 56500 and a fresh fitting pairing 63400 on another pair → `cheapest` is the pairing, with `priceKind` and age.
  - Web: a no-offer pairing renders "Google's price, sellers not read" and an incomplete one "Google's price, not every seller read", neither calling `sellerOf`; a complete one renders the seller and "seller's price"; `PairingSection` leads with the same price as the board row; `sellerCoverage` ignores incomplete offers.
  - Overview: with 3 read trips among 10 board rows, only those 3 are outlined, and the legend reads "outlined: trips with flights read".

- [ ] **Step 2: Run** `cd packages/core && npx vitest run test/datePairs`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement.** `pairingLeads` drops `p.offer !== null && p.complete`. `figure.ts` and `pairingGroupOf` price through `pairingPrice`. `rankDatePairs` compares `rankTierOf` after `current`.

- [ ] **Step 4: Run** core, then api, then web, one at a time. Fix only tests that pinned the old lead rule or the calendar-first order, and list each in the commit message. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Lead and rank date pairs by the trips whose flights were read"`.

---

### Task 3: The flight-list step reads until rule A stops it

**Files:**
- Modify: `packages/engine/src/stages/flightLists.ts` (`readPage` loses its allowance check; `budgetOutcome` keeps only the scopes still raised; `planOf`, `markLeftByWindow`, the pool loop, `returnPhaseOf`), `packages/engine/src/stages/flightLists/select.ts`, `packages/engine/src/types.ts` (`RankedDatePair.basis`, `.current`, `.stale`), `apps/api/src/read/ranked.ts`, `packages/core/src/types/execution.ts` and `packages/core/src/api-contract/executions.ts` (`ConfirmSummary`), `packages/core/src/ports/budget.ts`, `packages/core/src/api-contract/common.ts` and `apps/api/src/read/usage.ts` (usage reports flight pages with no cap), `packages/db/src/budgetGuard.ts` (no flight cap statement or check), `packages/engine/src/snapshot.ts` and `packages/core/src/types/definition.ts` (document `flightListPages` as the step's on-switch), `apps/web/src/copy/estimate.ts` (`'provider-execution': 'over its page allowance for one run'` no longer names a flight allowance), `packages/db/src/internal/read.ts` (`readFlightLists` passes `confirm` through, absent read as null)
- Test: `packages/engine/test/stages/flightLists.test.ts`, `flightListsEdges.test.ts`, `flightListsResume.test.ts`, `flightListsSelect.test.ts`; `packages/db/test/budgetGuard.flightLists.test.ts` and a db round-trip test of a stored `confirm`; `packages/core/test/api-contract/executions.test.ts`; `apps/api/test/bootstrap/engine.test.ts`

**Interfaces:**
- Consumes: Task 1's `Standings`, `applyCheck`, `patienceSpent`, `uncheckedCheaper`, `checkOfRead`, `EMPTY_STANDINGS`.
- Produces:
  - `RankedDatePair` gains `basis: FigureBasis`, `current: boolean` (`!superseded && notSeenInLatest === null`), `stale: boolean`.
  - `interface ConfirmSummary { mode: 'confirm' | 'outbound-only' | 'flags-unread'; confirmed: number; unread: number; uncheckedCheaper: number; stop: 'patience' | 'queue-empty' | 'returns-stopped' | null }` on `FlightListsState.confirm?` (schema `.exactOptional()`, absent read as null = a run stored before this change). One owner per count: date pairs read = `cells.length` (`cells` = this run's started pairs, carried across passes and appended to); reused = `FlightListsState.reused` (other runs' reusable lists, fresh verified figures, and the recently read pairs of §"end of step" below); `confirmed` = `standings.prices.length`; `unread` = `unread` checks. The page's "Checked N" is `cells.length + reused`. `planned = cells.length + reused`, so the existing `read + reused + failed <= planned` refinement holds. `mode` is `outbound-only` only when the worker's flags were read and lack `RETURN_SELECT_VERIFIED`; `flags-unread` when no flags had been read when the step planned.
  - `confirmQueue(ranked: readonly RankedDatePair[]): RankedDatePair[]` = `ranked.filter(p => p.current && !(p.basis === 'verified' && !p.stale))`: stale verified pairs are queued for a read; fresh verified pairs enter the standings instead (departed pairs are already dropped by `rankedPairsFor`). The read/reuse split is `selectFlightPairs(queue, …, Number.POSITIVE_INFINITY)`.
  - `returnPhaseOf(ctx, snapshot)`: no `pairs` parameter, no allowance test.

- [ ] **Step 1: Write the failing tests** (fake worker and in-memory repos as the existing step tests use; 15_000 timeouts):
  - **No allowance stop:** a budget port whose usage still reports the stored 20-page figure; 30 two-page reads run; no `BudgetExceeded` (engine test). The guard test: a flights request past 20 pages is reserved; usage reports `flightLists: { calls }` with no `cap`.
  - **Rule A ends the step:** 40 queued pairs at concurrency 1; reads 1–6 confirm per the worked example, 7–18 do not improve: exactly 18 reads, `confirm = { mode: 'confirm', reads: 18, reused: 0, confirmed: 16, unread: 0, uncheckedCheaper: <the queued pairs after 18 priced below 37100>, stop: 'patience' }`.
  - **Finishing order:** concurrency 4; read 1 confirms a trip and is held; reads 2 onward are `no-outbound` and finish at once, in order. Each finish starts the next read, so when read 13 (the 12th non-improving finish) finishes, reads 1–15 have started and patience is spent: assert no read 16 starts, `stop: 'patience'`, and read 1, released afterwards, still writes its row and counts in `confirmed`. Counting in queue order (read 1 first) would reset patience and start more reads.
  - **Reuse does not spend patience** (Review Focus 4): the newest lists hold 13 reusable non-improving pairs and 5 reusable improving ones at the head of the queue; the step sends no request for them, then reads at least 12 further pairs, and `reused: 18`.
  - **Verified in the standings:** two fresh, current verified figures cheaper than every read count in `confirmed` and `reused`, are not queued, and set the 5th price `uncheckedCheaper` uses; a fresh verified figure the latest search did not see (`current` false) does not count; a stale verified pair is queued and read (`flightListsSelect.test.ts`).
  - **Not current:** a superseded cheap pair is not queued and not counted in `uncheckedCheaper` (`flightListsSelect.test.ts`).
  - **Unread reads spend patience:** 12 reads in a row that fail without ending the step: `confirm.unread: 12`, `stop: 'patience'`, the rows `failed`. A read whose booking ends transient is confirmed at `fromMinor` and counts in `confirmed`.
  - **Recently read, not reached:** an unstarted pair whose newest list is 22 h old under a 24 h refresh (not reusable at 0.9 × refresh, still fresh) with a leading pairing is counted as reused at the end of the step and not in `uncheckedCheaper`.
  - **Window too short for returns:** in confirm mode, when the window cannot hold a return-phase read, the step ends `window` and sends no outbound-only read.
  - **Running counts:** the execution read mid-step returns `cells` and the `confirm` counts so far; a plan interrupted by a crash still carries `confirm`.
  - **No trip can be read** (Review Focus 3): every read `no-outbound`; 12 reads, `confirmed: 0`, `stop: 'patience'`.
  - **Equal prices** (Review Focus 2): 80 pairs at one price; reads follow ranked order; stop at patience.
  - **Queue empty:** 7 pairs, all confirming; `stop: 'queue-empty'`.
  - **Returns lost part-way:** read 3's return ends transient; no read starts after it; in-flight reads finish; `stop: 'returns-stopped'`; a pass after it sends no return phase.
  - **Returns off** (Review Focus 1): no `RETURN_SELECT_VERIFIED`; the first `FLIGHT_LIST_COUNT` pairs outbound-only as before; `confirm.mode: 'outbound-only'`.
  - **Blocked page mid-step** (Review Focus 5): read 3 of 40 ends blocked; rows exist only for pages sent; a pair whose older pairing led before the run still leads after it; `ended: 'stopped'`; unstarted pairs count in `uncheckedCheaper`.
  - **Window and cancel:** the existing first-stop tests pass; a window mid-step stores `ended: 'window'`, `confirm.stop: null` and the counts so far; patience and returns-stopped set the shared `stopped` flag, so a later in-flight error or window changes neither `ended` nor `stop`.
  - **Resume** (`flightListsResume.test.ts`): a run interrupted by the window just after an improving read and resumed stores the same `cells`, `reused` and `confirm` as an uninterrupted run with the same fake worker; a non-ending failed read before the interruption is not read again; a resume with the worker's flags unset keeps the stored `returns`, `booking` and `mode`; a step that finished at patience and is resumed after a verification pause sends no flight request; a resumed confirm-mode pass refused by the window records `ended: 'window'` (an outbound-only plan keeps today's rule); a plan stored before this change (fixed `cells`, no `confirm`, snapshot `flightListPages: 20`) parses with `confirm` null, resumes by rebuilding the queue, and is not refused.

- [ ] **Step 2: Run** `cd packages/engine && npx vitest run test/stages`, then the db and core test files named above, one suite at a time. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement.**
  - `rankedPairsFor` sets `basis`, `current` and `stale` from the figure.
  - Delete `readPage`'s allowance check and its doc comment; the guard drops `FLIGHT_LIST_CAP_SQL` and its check; usage keeps the page count.
  - `planOf` in confirm mode (returns planned): if a stored plan has `confirm.stop` set or `ended` other than `null`/`'window'`, return null (finished). Else build the queue; apply fresh, current verified pairs by `'reuse'`; leave out of the read split every cell with a row of this execution, whatever its status, and apply this run's `read` rows to the standings' prices without touching patience or `reused`; split the rest with `selectFlightPairs`; apply each reused pair's stored list through `checkOfRead` by `'reuse'`. On a resume keep the stored `returns`, `booking`, `mode`, `returnsStopped`, `bookingStopped`, `cells`, `reused` and `confirm` counts, never recomputed from flags. Without returns: today's first-`FLIGHT_LIST_COUNT` selection, `mode` per the flags. Write the plan with `confirm` (zero counts, `stop: null`) before the first read.
  - The pool worker patches `cells` when a read starts and the `confirm` counts when it finishes, so the running line and a crash both see them.
  - In confirm mode, `requestOf`'s window-shortfall path ends the step `window` instead of sending an outbound-only read.
  - Pool worker, after `writeRow`: `applyCheck(standings, checkOfRead(o.list.returns, o.list.flights, flightLimitsOf(constraints)), 'read')`; a failed read without `end` applies `{ kind: 'unread' }`. If `patienceSpent` or `returnsStopped` became non-null and `!stopped`, set the stop, `stopped = true` and `intake.abort()`.
  - On an ending error in confirm mode, write no rows for unstarted pairs (today's write-the-rest stays only in outbound-only mode).
  - After the pool: `queue-empty` when every queued pair started and no stop was set. Then, for each unstarted pair whose newest list is fresh (`listFresh` with the full refresh) and gives a confirmed check, apply it by `'reuse'` and add it to `reused`; `uncheckedCheaper` from the remaining unstarted pairs' `pricePence`; patch `confirm`.
  - `markLeftByWindow`: a stored plan with `confirm.mode === 'confirm'`, `confirm.stop` null and `ended` null gets `ended: 'window'`; other plans keep today's rule.

- [ ] **Step 4: Run** engine, then db, then core, then api suites, one at a time. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Read flight lists until more reading stops finding cheaper trips"`.

---

### Task 4: The estimate's flight line

**Files:**
- Modify: `packages/engine/src/estimate.ts` (`perPair`, `flightPairsWanted`, `estimatePhaseOf`, `estimateRemainingFor`, the `FLIGHT_VIEW_SECONDS` comment), `apps/web/src/copy/estimate.ts`, `apps/web/src/views/Searches/estimateLine.ts`
- Test: `packages/engine/test/estimate.test.ts`, `estimateLines.test.ts`, `apps/web/test/views/searches/logic/estimateLine.test.ts`

**Interfaces:**
- Consumes: `CONFIRM_TARGET`, `CONFIRM_PATIENCE` (Task 1); `confirmQueue`, `selectFlightPairs`, `returnPhaseOf(ctx, snapshot)` (Task 3).
- Produces: `FLIGHT_READ_SECONDS = 25`, `CONFIRM_TYPICAL_EXTRA = 8`; the flight object keeps its exact shape (`pages`, `seconds`, `pairs`, `returns`, `pagesMax`, `secondsMax`): `pairs`/`pages`/`seconds` are the typical reads, `pagesMax`/`secondsMax` the at-most reads. `withFlights`' note reads "usually about N dates, at most M" from them, never "up to" the typical count.

- [ ] **Step 1: Write the failing tests:**
  - 300 queued pairs, reusable at positions 1–10: typical `max(min(290, 12), 25 - 10)` = 15 reads, at most 290; at 4 at once, spacing 0: `ceil(15/4) × 25 = 100` s and `ceil(290/4) × 25 = 1825` s.
  - The same queue with 5 reusable pairs at positions 30–34: typical 25 (they are not among the first 25), at most 295.
  - The first 25 all reusable: typical 12 (`CONFIRM_PATIENCE`), so `ceil(12/4) × 25 = 75` s.
  - A queue of 7: typical 7, at most 7.
  - Worker flags unread with 40 queued pairs: returns and booking assumed (the bound), the confirm figures above, never outbound-only.
  - A resumed run with an interrupted confirm-mode plan: the remaining flight line equals a fresh estimate over the rebuilt queue (this run's reads not counted again); a finished step's remaining flight line is 0.
  - Returns off: today's 10 outbound-only pairs at 25 s.
  - Web: "then about 2 minutes checking flights, longer if prices are close together" for 100 s; "about 1 minute" singular. The note for the 300-pair case reads "usually about 15 dates, at most 290".

- [ ] **Step 2: Run** `cd packages/engine && npx vitest run test/estimate.test.ts test/estimateLines.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** with `FLIGHT_READ_SECONDS` per read through `inWaves`; typical = `max(min(unreused, CONFIRM_PATIENCE), min(queue, CONFIRM_TARGET + CONFIRM_PATIENCE + CONFIRM_TYPICAL_EXTRA) - reusableAmongThem)` capped at `unreused`. Correct the comment that called the 2026-11-07 measurement outbound-only (ten reads with returns and booking, 19–29 s).

- [ ] **Step 4: Run** engine, then web. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Estimate the flight checks from measured read times"`.

---

### Task 5: The search page: one price per row, closed rows, how checking ended

**Files:**
- Modify: `apps/api/src/read/executions.ts` (`flightsOf` passes `confirm` through) and `apps/api/src/read/cards.ts`, `packages/core/src/api-contract/executions.ts` (`flights.confirm`), `apps/web/src/views/Dates/BoardTable.tsx` (the tier break via `rankTierOf`), `board.ts`, `flightLines.ts` (`tieKey` includes `rankTierOf`; ranks follow display order within a tie), new `apps/web/src/views/Dates/ConfirmLine.tsx`, `apps/web/src/views/Dates/stateLines.ts` (in confirm mode `flightsClause` adds nothing and the reading state uses ConfirmLine's running words), `packages/core/src/labels/stopCause.ts` (`budgetText`: "flights were read for N dates", no denominator, in confirm mode), `apps/web/src/views/Searches/cardWords.ts`, `apps/web/src/lib/flightsReading.ts`, `apps/web/src/copy.ts`
- Test: `apps/api/test/routes/flightLists.test.ts`, `cards.test.ts`; `apps/web/test/views/dates/board.test.tsx`, `flights.test.tsx`, `keyboard.test.tsx`, `states.test.tsx`, `logic/flightLines.test.ts`, `confirmLine.test.tsx` (new); `apps/web/test/views/searches/` card tests; `packages/core/test/labels/` stop-cause tests

**Interfaces:**
- Consumes: `ConfirmSummary` (Task 3); `rankTierOf`, `pairingKindOf` (Task 2).
- Produces: `GET /executions/:id` and a card's `latestRun.flights` carry `confirm: ConfirmSummary | null`. `ConfirmLine` takes `{ confirm, ended, stopCause, running }`.

- [ ] **Step 1: Write the failing tests:**
  - **Price per row:** a read trip shows its price in the main element with "seller's price", "Google's price, sellers not read" or "Google's price, not every seller read" (from `pairingKindOf`) and "read 6 h ago" (visible, not hover-only), plus times, journey time and changes each way; an older leading trip also shows its age label. A calendar row shows "calendar £565" in the secondary style with "flights not checked" only for `not-read`, and with each other `pairingRead`'s words otherwise (one test per value). No "Google's list: from" in a closed row.
  - **Tiers on screen:** a labelled break between the read trips and the "not checked yet" rows; a read trip and a calendar row at the same price are not one tie group.
  - **Closed rows:** with 10 rows no flights block renders until its button is pressed; the button has `aria-expanded` and `aria-controls`, opens with Enter and Space, and shows a focus ring.
  - **Ranks in a tie:** three tied pairs reordered by flight time show 1, 2, 3 top to bottom.
  - **ConfirmLine**, exact copy:
    - patience, 7 trips, 31 unchecked: "Checked 18 dates; 7 trips with flights read. 31 dates look cheaper on the calendar but weren't checked."
    - the same with `unread: 2`: "Checked 18 dates, 2 couldn't be read; 7 trips with flights read. 31 dates look cheaper on the calendar but weren't checked."
    - patience, 0 unchecked: "Checked 18 dates; 7 trips with flights read."
    - queue empty: "Checked every date with a calendar price; 5 trips with flights read."
    - patience, 2 trips, 288 unchecked: "Checked 12 dates; 2 trips with flights read: the other dates' flights didn't fit your limits or couldn't be read. 288 dates weren't checked."
    - returns stopped / window / cancel, with fewer than 5 trips: "Stopped checking flights after 9 dates because return flights couldn't be read; 3 trips with flights read. 120 dates weren't checked." with "because the browser's time ran out" and "because the search was cancelled". With 5 or more trips the count reads "31 dates that look cheaper on the calendar weren't checked."
    - `ended: 'stopped'` (an ending page or a cap): "Stopped checking flights after 3 dates because <reason>; 1 trip with flights read. 120 dates weren't checked.", where <reason> is the stop detail's existing wording from `stopText`, never new wording; a test per stop detail the error table can end with, each distinct from the cancel line.
    - an abort with `stopCause` cancel, budget or fatal: the reason from `stopCause` ("because the search was cancelled", "because a spending limit was reached", "because the app hit an error"), and "because the search stopped" when it holds none of those.
    - queue empty with `unread: 2`: "Checked every date with a calendar price, 2 couldn't be read; 5 trips with flights read."
    - mode `outbound-only`: "Trips couldn't be checked on this machine: it can't read return flights."
    - mode `flags-unread`: "Trips couldn't be checked this run: the browser hadn't yet said what it can read."
    - running: "Checking flights: 9 dates so far; 3 trips with flights read."
    - `confirm: null` (a run before this change, or the step not reached): no line.
    - singulars: "1 date", "1 trip".
  - **Card, page state and stop sentence:** in confirm mode the card's reading line has no "of N" denominator ("Reading flights · 9 dates checked, 3 trips with flights read") and "still reading" comes from the run's stage, not `read + reused + failed < planned`; the page's state line adds no flights clause (ConfirmLine owns it) and its reading state uses the running words; the stop sentence says "flights were read for 9 dates".
  - The api passes `confirm` through unchanged, and null for a pre-change run.

- [ ] **Step 2: Run** `cd apps/web && npx vitest run test/views/dates`. Expected: FAIL.

- [ ] **Step 3: Implement** the closed-row disclosure (the row stays a real table row; the block renders only when open), the price and calendar wording, the tier break and `tieKey`, the rank renumbering, `ConfirmLine` under the table, and the card wording. Copy goes in `copy.ts` under `dates.confirm`.

- [ ] **Step 4: Run** api, then web. Check the search page at 375 px and 1280 px against a dev server: no sideways scroll, closed rows, the break and the stop line visible. Expected: PASS and both widths right.

- [ ] **Step 5: Commit** `git commit -m "Show one real price per date, closed rows, and how flight checking ended"`.

---

### Task 6: Fold the design into the main spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (header to revision 68; §6.9 the lead rule, price kinds and ranking tiers; §8.1 the step, reuse, resume, the allowance's withdrawal, the estimate; §11 rows, the tier break, the overview ring, the stop line; §10 usage without a flight cap; revision 66's measurement wording corrected; a "Revision 68" changelog entry dated 2026-11-08 recording Ian's two rulings of that day as rulings), `docs/superpowers/specs/2026-11-08-confirm-cheapest-design.md` (status: folded into revision 68)

- [ ] **Step 1:** Write each section in the main spec's style: one rule set per section, no amendment blocks.
- [ ] **Step 2:** Run the three wording greps over the diff. Expected: no hits.
- [ ] **Step 3: Commit** `git commit -m "Spec revision 68: check the cheapest trips' flights automatically"`.
