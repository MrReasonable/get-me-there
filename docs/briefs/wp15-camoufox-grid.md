---
wp: 15
title: Camoufox grid mode (the Dates tab's 7 × 7 date grid)
owner: opus
depends_on: [14]
spec_sections: ["§2", "§5.1", "§5.2", "§5.3", "§7", "§8.1", "§11", "§12", "§13", "§16", "§17 revision 34"]
reviewers: [provenance-auditor, provider-integration-expert, search-strategy-reviewer, cost-and-budget-reviewer, data-model-reviewer, test-strategy-reviewer, code-architect, security-reviewer]
status: draft
---

# WP15: Camoufox grid mode (the Dates tab's 7 × 7 date grid)

Written 2026-10-18 against spec revision 34, plan decisions 1–70 and `feat/camoufox-graph`, and revised after the
round-1 review (0 Critical, 9 High, 19 Medium, 11 Low; findings and rulings under
`~/.cache/get-me-there/review-spec/wp15-camoufox-grid/r1/`). The rulings are folded into plan decision 70; every
finding is addressed, and Appendix A lists each finding ID with where this brief answers it. It builds the `grid` mode
spec §2 designs: up to 49 day pairs per settled view instead of `list` mode's one per page, so a full pass of the worked
example fits in one run. Every WP14 limit holds unchanged (decisions 68, 69, 70).

**The evidence this brief stands on.**

- *Graph exploration 1, 2026-10-18* (`record --graph-explore`, local and gitignored): the results page's one "Price
  graph" button opens a dialog "Price insights" holding a `tablist` ("Dates", "Price graph" selected), the text
  "10-day trip", the buttons "Reduce your stay by one day" and "Extend your stay by one day", the text "Sun 14 Mar - Wed
  24 Mar From £462", a `region "Price graph"` with no accessible children, and the buttons "Scroll forwards", "Scroll
  backwards", "Cancel" and "OK". Exit 0, `SOCS` same, no cool-down.
- *Graph exploration 2, 2026-10-18* (`graph-explore/2026-10-18/2.json`, backed up to the private store): the chart
  region's text is its axes only ("April 2027May 2027£600£400£200£0"), 710 elements with no images and no buttons, so
  its bars cannot be read through the accessibility tree; **the chart is dropped**. After the "Dates" tab's click the
  panel is `tabpanel "Dates"`. In its printed snapshot, in order: an image; the legend text "Cheapest Compared with
  other prices shown Departure"; `button "Scroll left"` and `button "Scroll right"`; an empty `grid "Date grid"`; the
  departures line "0000 Thu 11 Mar Fri 12 Mar … Wed 17 Mar" (the "0000" is a glyph run); the **49 cell buttons as
  siblings in the panel, not children of the grid**, in rows of one return date (11–17 Mar to 21 Mar, then to 22 Mar,
  …), each named like `"£457, 11 Mar to 21 Mar"`, `"£397, cheapest price, 15 Mar to 23 Mar"` (two cells carry the mark)
  or `"£462, 14 Mar to 24 Mar, selected"`; the returns line "Sun 21 Mar … Sat 27 Mar 0000 Return"; `button "Scroll
  up"` and `button "Scroll down"`; and the text "14 – 24 Mar 2027£462 · Round trip". Left and right sit by the
  departures line, up and down by the returns line. No scroll was clicked. Clicks: Price graph, then Dates. Exit 0,
  `SOCS` same, no cool-down. **Its stored classification was `blocked`/`unrecognised` (rule `cheapest-tab-count`)**:
  with the dialog open the results-page structure rules no longer hold, and the exploration had no dialog view, so it
  recorded that kind and, as an exploration, did not stop on `unrecognised` (PA-01, PIE-01). §9 adds that view.
- *A printed snapshot merges adjacent text* into one `text:` line, so "one line of seven labels" says nothing about the
  DOM (PIE-08). Task 15.1's recorder reads the lines and labels through locators and records their element counts.
- *What the evidence does not cover.* Which axis each scroll moves and by how many days; whether "Date grid" on the
  results page opens the same panel directly; the month tokens other than "Mar"; the selected-pair line across two
  months or two years; an unpriced cell; a view near today or near the sale window's end; how the grid rounds against
  the results list's total. Task 15.1 records each before any reader depends on it, and until then each is a hypothesis
  named as such below.

## 0. What the `--grid` recordings settled (2026-10-18; where this section and a later one differ, this one wins)

Task 15.1's recorder ran five pages (`grid/2026-10-18/1.json` … `4.json`, plus the renamed `0-explore.json`; the fifth
query, 2027-09-10, landed on the no-flights page). `SOCS` read back unchanged on every page and nothing stopped.

- **Step.** One scroll moves one day on its axis: left and right the departures, up and down the returns (run 1:
  departures 11–17 Mar, then 12–18 Mar after `right`; returns 21–27 Mar, then 22–28 Mar after `down`). Each scroll
  reveals 7 new cells. `GRID_STEP_DAYS = { departures: 1, returns: 1 }`.
- **Times** (`GRID_TIMES`): a scroll's click about 0.1 s, settle about 6.5 s (two polls), read about 2.6 s: about 9.3 s
  a scroll, so the 5 s spacing never binds. A page's first view is ready about 21–26 s after the load starts, so a page
  costs the 30 s page spacing.
- **Cells by name, never by position.** After a scroll the page reuses and rotates its elements (run 2, view 3: the
  departures line reads "Fri 2 Apr00000000Sat 27 MarSun 28 Mar … Thu 1 Apr" and the first candidate is "£472, 2 Apr to
  4 Apr"). Each cell's dates come from its own name; the lines are a set check only (the departures and returns the
  cells name must equal the lines' sets). This replaces §7's and §9's positional match.
- **Line text.** The lines' text has no spaces between labels ("0000Thu 11 MarFri 12 Mar…Wed 17 Mar0000"), and the 14
  label elements are separate (`labels.count` 14 on every view). Day tokens are matched without word boundaries.
- **Markers.** "£485, low price, 24 Dec to 3 Jan" (run 3): "low price" sits in the slot of "cheapest price". The mark is
  an enum, `vendor_price_mark` ∈ `cheapest | low | none` (NULL where a vendor states no marks); SearchApi's
  `is_lowest_price` gives `cheapest` or `none`.
- **Prices** carry thousands separators ("£1,308, 18 Oct to 20 Oct", run 4).
- **Cell count.** A view holds 49 cells less the pairs whose return precedes the departure; a same-day pair is shown
  ("£843, 20 Oct to 20 Oct"). Run 4 (2026-10-20 to 2026-10-23, two days from today) showed 39 cells and a first view
  starting at today (Sun 18 Oct), not at the query's departure less 3: an off-plan `near-today` view, accepted. Its
  `left` move timed out with no change: the edge behaviour.
- **Selected-pair line.** Its date range and its price are separate elements: "14 – 24 Mar 2027", "28 Mar – 7 Apr 2027",
  "27 Dec 2026 – 6 Jan 2027", "20 – 23 Oct" (no year in the current year), and "£462 · Round trip". Each date on the
  page takes the year nearest the query's departure.
- **Year boundary.** Run 3 (27 Dec 2026 to 6 Jan 2027) read December departures and January returns correctly.
- **Sale window.** A query 327 days out (2027-09-10) answered with the no-flights page, no grid. A grid page that lands
  there is `no_data` for its covered cells, and the planner plans no departure past `GRID_HORIZON_DAYS` (320, dated).
- **Grid vs list.** The selected cell's grid price equals the Best list's minimum in all four runs (£462, £499, £481,
  £705), and the Cheapest tab is lower in three (£453, £455, £669): the grid follows the Best list, not the cheapest set,
  and states whole pounds. The provenance note says so ("the price Google's date grid showed").

**Cost, restated** (the worked example's four pairs, 312 blocks; a block-to-block move is 7 scrolls, about 65 s, against
about 30 s for a page, so the planner opens pages until the page cap binds, then scrolls):

| Caps | Run 1 | Run 2 | A full pass |
|---|---|---|---|
| Defaults (100 pages, 600 scrolls, 30 a page) | 100 pages + 85 moves (595 scrolls) = 185 blocks, ≈ 8,530 s (2.4 h) | 100 pages + 27 moves (189 scrolls) = 127 blocks, ≈ 4,760 s (1.3 h) | 2 runs, ≈ 200 pages, 785 scrolls, 3.7 h |
| Page cap 312 | 312 pages, ≈ 9,360 s (2.6 h) | — | 1 run |

The planner splits each run's page and scroll allowances evenly across the stage's pairs (`DiscoveryQuery.share`, set by
the engine), so every pair gets its share of pages first.

## 1. Goal

Price the definition's day pairs from Google Flights' date grid, 49 to a settled view, by planning page loads and
scrolls from the definition's window and stay range and the measured scroll step, reading every cell by its position
and its own name through locators with a dated grammar, storing each price with the source of its return date and an
honest age, and keeping every WP14 stop, cool-down, spacing and cap, plus scroll caps.

## 2. Scope

**In**

- **The recorder's `--grid`** (Task 15.1): the viewport pinned; one page, the Price graph and Dates clicks, then the
  moves the operator names, each settled by the post-move rule and read; per-view lines, labels, cells, timings and the
  measured step written to `fixtures/recorded/grid/<date>/<n>.json`; the operator records, and renames
  `graph-explore/2026-10-18/2.json` into the `grid` kind.
- **The cell grammar and the view reader** (Task 15.2, worker, pure): the dated cell pattern, the line and
  selected-pair readers, the year rule, the positional match, the cross-product and order checks, the drift threshold.
- **The planner** (Task 15.3, `@gmt/providers` camoufox, pure): the block lattice, the path for a given `stepDays`, the
  cut into pages, the `grid-path` tile, a re-plan over resumable cells and from an off-plan view's dates.
- **The worker's grid page** (Task 15.4): the dialog view, the clicks, the settles, the scroll spacing and allowance,
  the per-move budgets inside the page cap, the answer.
- **Core** (Task 15.5): the grid request and answer schemas; `TileRequest` `grid-path`; `ReturnDateSource`;
  `RawCalendarPrice.returnDateSource` and `vendorPriceMark`; the grid capability info (assumed 24 h age), source
  label and note; the config block.
- **db** (Task 15.6): migration 0006 and the repositories; the scroll caps' predicates.
- **The adapters** (Task 15.7): camoufox grid tiling, the request's allowance and timeout, the answer mapping,
  `scroll_count`; SearchApi's `is_lowest_price` into `vendorPriceMark`; Travelpayouts and the fixture writing
  `null`.
- **Engine, API and web** (Tasks 15.8, 15.9): the estimate's pages, scrolls and seconds at retry factor 1.0; the
  return-date source, age and vendor mark in the provenance the API returns and the views show; View D's scroll count.
- **Docs** (Task 15.10) and **rules tests and smoke rows** (Task 15.11).

**Out**

- The Price graph's chart (no readable bars; decision 70).
- The stay buttons ("Reduce your stay by one day", "Extend your stay by one day"): a stay change is a different query.
- Randomised or jittered scroll spacing (decision 70, ruling 12; PIE-13).
- Itinerary search, verification, proxies, solving or clicking a challenge, any cookie but `SOCS`, signing in,
  clicking anything on a consent page, Linux: all as WP14 (decisions 68, 69).
- Treating Google's or SearchApi's cheapest mark as this app's minimum.

## 3. Spec sections and plan decisions

- **§2 Continuity fallback, the `grid` paragraph (rev 34):** the clicks, the dialog view, cells by position, the
  grammar and drift stop, years, the stay-range lattice, the measured step, the scroll path, caps and spacing, the
  settles and per-move budgets, edges, the return-date source, provenance (assumed 24 h age, whole pounds, the vendor's
  mark), coverage. The labels, coverage and speed lines go verbatim into the operator docs (Task 15.10).
- **§5.1, §5.2:** `grid-path` tiles; cell keys from the page; covered-cell rules.
- **§5.3:** one ledger row per page load; `scroll_count`; the page and scroll caps.
- **§7:** `return_date_source`, `vendor_price_mark`, `scroll_count` (migration 0006).
- **§8.1:** the rows for a grid page that stops, ends early, or meets an off-plan view; the estimate's retry factor 1.0
  for camoufox.
- **§11, §12, §13, §16.**
- **Plan decisions 70** (this mode and the round-1 rulings), **68, 69** (every limit), **61, 64** (recordings
  local-only, visible skip), **24** (cell issues), **30** (truncated tiles), **50** (a resume never re-fetches a priced
  cell).

## 4. Interfaces consumed

From `@gmt/core`: everything WP14's §4 lists, plus `pageRequestSchema`, `workerAnswerSchema`, `TilePlan`,
`TileRequest`, `generateCells`, `addDays`, `daysBetween`, `cellKeyString`, `sourceLabel`.

From the worker (WP14 and this branch): `createDriver`, `runStep`, `CheapestStepFailed`, `classifyPageWithRule`,
`pageBudget`, `Pacer`, `CooldownStore`, `readBack`, the recorder's `record()` loop, and the exploration's `settle`,
`panelOf` and `readCells`, which Task 15.1 moves into `dialogSettle.ts` so the recorder and the session share one copy.

From `camoufox-js` 0.11.5, beyond WP14's list: the `window: [width, height]` launch option (`generateFingerprint`'s
fixed window size). From `playwright-core` 1.59.1: `Locator.ariaSnapshot({ timeout })` (the settle's comparison, hashed
and never parsed; stored only by the recorders), `Locator.isVisible()`.

## 5. Interfaces produced

```ts
// packages/core/src/types/provenance.ts
export type ReturnDateSource = 'vendor' | 'asked' | 'grid-cell';
export interface Provenance { /* existing fields */ returnDateSource: ReturnDateSource; vendorPriceMark: boolean | null }
  // vendorPriceMark: true = the vendor marked it its cheapest of the prices shown with it; false = not marked
  // in the view it was read from; null = the vendor states no mark (Travelpayouts, camoufox list, fixture)
// packages/core/src/ports/provider.ts
export type GridMove = 'left' | 'right' | 'up' | 'down';
export type TileRequest =
  | /* the four existing kinds */
  | { kind: 'grid-path'; start: { departureDate: IsoDate; returnDate: IsoDate }; moves: GridMove[]; reads: boolean[] };
  // reads[0] is the first view; reads[i + 1] whether the view after moves[i] is read (false: a transit view)
export interface RawCalendarPrice { /* existing fields */ returnDateSource: ReturnDateSource; vendorPriceMark: boolean | null }
// packages/core/src/labels/source.ts
export function sourceLabel(p: Pick<Provenance, 'sourceKind' | 'returnDateSource'>): string;
  // scraped-self + grid-cell → 'Google Flights date grid via Camoufox'; scraped-self otherwise → 'Google Flights prices via Camoufox'

// packages/core/src/camoufox/protocol.ts
export const gridRequestSchema;   // { mode: 'grid'; origin; destination; gl; start: { departureDate; returnDate };
                                  //   moves: GridMove[]; reads: boolean[] (moves.length + 1);
                                  //   scrollAllowance: number (≤ moves.length: the scrolls the run and month caps leave) }
export type GridCell = { status: 'price'; departureDate: IsoDate; returnDate: IsoDate; amountMinor: number;
                         vendorPriceMark: boolean };
  // a 'no-flights' cell is added only in the commit whose recording pins Google's unpriced form (PA-13)
export interface GridView {
  index: number;                 // 0 the first view, i + 1 the view after moves[i]
  departures: IsoDate[];         // the departures line's seven, in order
  returns: IsoDate[];            // the returns line's seven, in order
  cells: GridCell[];             // parsed cells matching their position's pair
  unparsed: number;              // cells counted, never guessed
  structural: 'ok' | 'unparsed'; // 'unparsed': duplicate pairs or a failed cross-product; nothing from it is stored
  offPlan: null | 'near-today' | 'sale-window-end' | 'short-move';
}
// WorkerAnswer gains:
//   | { kind: 'grid'; fetchedAt; currency: 'GBP'; pointOfSale; views: GridView[]; scrolls: number;
//       ended: 'complete' | 'scroll-not-settled' | 'off-plan' | 'allowance'; notes: string[]; versions }   // 200
// and every answer to a grid request that reached Google (blocked, not-ready, browser-error) carries `scrolls` (CB-4).
// versions gains gridGrammar and dialogSelectors (PIE-15). /v1/status gains gridStepDays: { departures; returns } | null.

// packages/providers/src/camoufox/grid.ts
export const GRID_SIDE = 7;      // the recorded side at the pinned 1280 × 900 window
export function gridBlocks(q: DiscoveryQuery): Block[];
export function gridPath(blocks: Block[], stepDays: { departures: number; returns: number }):
  { start: Block; moves: GridMove[]; reads: boolean[] };
export function planGridTiles(q: DiscoveryQuery, o: { stepDays; scrollCap: number; today: IsoDate }): TilePlan[];
export function gridTileEstimate(tile: TilePlan, c: GridTimes): { scrolls: number; seconds: number };   // CB-3
export function gridRequestTimeoutMs(tile: TilePlan, c: CamoufoxConfig): number;
// packages/core: CostEstimate gains scrolls?: number (camoufox grid only; CB-3)
```

Config (`Config.providers.camoufox`): `mode: 'list' | 'grid'`, `gridScrollSpacingSeconds` (5–30, default 5),
`gridScrollCap` (0–60, default 30), `executionScrollCap` (0–6,000, default 600), `monthlyScrollCap` (default 6,000).
Grid mode is skipped at preflight (`skipped:provider_disabled`, "grid mode not verified") while the worker's
`GRID_VERIFIED` flag is false or its `gridStepDays` is null.

## 6. Endpoints, parameters and cost

**Worker.** `POST /v1/page` takes either request; a `grid` request is answered `mode-unavailable` (409, Google not
contacted) unless `GRID_VERIFIED` is true and `worker.env` sets `CAMOUFOX_MODE=grid`. Every other WP14 answer and status
applies unchanged. A request whose `moves` exceed the worker's own `CAMOUFOX_GRID_SCROLL_CAP` is 400, Google not
contacted. The worker never scrolls more than `scrollAllowance` (it ends `allowance` there).

**The page URL** is list mode's, with the first block's centre as its dates: a view opened by `…on <d> returning <r>`
shows departures `d − 3 … d + 3` and returns `r − 3 … r + 3` (observed 2026-10-18). The planner asks for `d = a + 3`,
`r = b + 3` to open the block with departures `a … a + 6` and returns `b … b + 6`, and clamps `d` to at least
`today + 3` (PIE-05); a view shifted anyway is an off-plan view (§9).

**Budgets.** Load through the Dates tab's settle: the page budget as the Cheapest flow (the page timeout, then the same
again from the first click, never past twice it from the start). Each move: the scroll spacing, then its own budget,
`MOVE_BUDGET_MS` = 45 s for the click, settle and read plus `MOVE_RESERVE_MS` = 15 s (so a move whose settle needs three
12 s polls still fits). The page's overall cap is `2 × pageTimeout + moves × (spacing + 60 s)`, and the adapter's request
timeout is that plus 15 s (`gridRequestTimeoutMs`). Per-move timings (click, settle, read, polls) from Task 15.1 are dated
constants (`GRID_TIMES`) the estimate and docs use (CB-9).

**Cost, the worked example** (one airport pair: a 182-day window, 10–21 nights, so D = 182 and 12 stays; a 7-day step
assumed until Task 15.1 measures it; about 60 s a page and about 11 s a move, 5 s spacing plus settle and read, PIE-14):

| Step | Arithmetic | Per pair | Four pairs |
|---|---|---|---|
| Cells wanted | 182 × 12 | 2,184 | 8,736 |
| Floor if every grid cell were wanted | ⌈2,184 / 49⌉ | 45 views | 180 |
| Blocks on the lattice | ⌈182 / 7⌉ × ⌈(7 + 21 − 10) / 7⌉ = 26 × 3 | 78 views (3,822 grid cells, 2,184 stored, 57%) | 312 |
| Moves on the path | 2 (first column) + 25 × 4 (right, up, down through a transit view, down) | 102 (24 into transit views) | 408 |
| Pages and scrolls | a page ends on a read view; the next opens the next read block, skipping a transit view; greedy at 30 moves | 4 pages, 97 scrolls | 16 pages, 388 scrolls |
| Time | 4 × 60 + 97 × 11 | ~1,307 s (22 min) | ~87 min |
| Against the caps | pages 16 of 100 a run; scrolls 388 of 600 a run; weekly, ~70 of 1,500 pages and ~1,680 of 6,000 scrolls a month | | |

The estimate's retry factor is 1.0 for camoufox (it never retries, ruling 13): these are the estimate's figures, not
× 1.2. At the maximums (cap 60, spacing 30) a page takes `60 + 60 × (30 + 6)` ≈ 2,220 s (37 min), and a full pass with
`scrollCap` 0 is 312 pages, 4 runs at 100 pages (CB-7). `list` mode for comparison: 2,184 pages a pair, about 88 runs
for the four. If Task 15.1 measures a smaller step `s`, a block-to-block move costs `⌈7 / s⌉` scrolls; the planner
compares, per move, those scrolls against a new page load at the measured times and takes the cheaper, and Task 15.1's
commit restates this table from the measured step and times before Task 15.3 starts.

## 7. Library and tool notes

- **The window.** Grid mode's layout must not follow the generated screen size (PIE-10). camoufox-js 0.11.5 pins the
  window through its `window: [1280, 900]` option (`generateFingerprint(window, …)` sets the outer window size, and the
  persistent context then measures its viewport from that window); an explicit Playwright `viewport` over a spoofed
  window is the case camoufox-js documents as hanging a second `newPage()` (daijro/camoufox#666), so the worker uses
  `window`. Every recording's meta stores it; `GRID_SIDE` 7 is the recorded side at that window. This is ordinary layout
  configuration (ruling 7).
- **Cells by position** (ruling 2): the panel's `getByRole('button')`, minus the four scroll buttons by exact name, in
  document order, is the candidate list; 49 candidates is the structural check; candidate `i` sits at row `⌊i / 7⌋`
  (the returns line's date) and column `i mod 7` (the departures line's date), the order recording 2 shows. Each name
  is read through `nameOf`, every read with its own timeout.
- **Lines and labels** through locators only: day labels `getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} <MON>$/)`
  inside the panel, and the lines `getByText(/(Mon|…|Sun) \d{1,2} <MON>.*(Mon|…|Sun) \d{1,2} <MON>/)`; the first seven
  labels (or the first line) are the departures, the next seven (or the line ending "Return") the returns. Task 15.1
  records which form the page uses (element counts and texts) and the reader takes that one (PIE-08).
- The printed snapshot is used only as the settle's comparison, hashed in memory; the provider path never stores or
  parses it; the recorders store it for people to read.

## 8. Files

- `apps/camoufox-worker/src/gridNames.ts` (new): the dated cell, label and selected-pair patterns, the month-token
  table, the year rule, the positional match. Pure. Joins the mutation run and the 100% safety floor.
- `apps/camoufox-worker/src/gridView.ts` (new): reads one settled view into a `GridView` (locators only).
- `apps/camoufox-worker/src/dialogSettle.ts` (new): `settle` (with the post-move rule), `panelOf`, `readCells`, moved
  out of `graph.ts`, which then imports them.
- `apps/camoufox-worker/src/gridRecord.ts` (new, Task 15.1) and `gridPage.ts` (new, Task 15.4).
- `apps/camoufox-worker/src/launch.ts` (`window`), `budget.ts` (`nextFor`), `classify.ts` (the `dates-grid` view),
  `session.ts`, `server.ts`, `selectors.ts` (the dialog's names, `GRID_MOVES`, `GRID_STEP_DAYS`, `GRID_TIMES`,
  `GRID_VERIFIED` with its proof), `config.ts`, `recordArgs.ts`, `record.ts`, `recordWrite.ts`.
- `packages/core/src/camoufox/protocol.ts`, `ports/provider.ts`, `types/provenance.ts`, `labels/source.ts`,
  `config/schema.ts`, `api-contract/*`.
- `packages/db/drizzle/0006_grid_return_source.sql`, `meta/0006_snapshot.json`, `src/schema/calendarPrices.ts`,
  `src/schema/providerRequests.ts`, the repositories and the budget predicates.
- `packages/providers/src/camoufox/grid.ts` (new), `tiles.ts`, `answer.ts`, `limits.ts`, `provider.ts`;
  `packages/providers/src/searchapi/*` (`is_lowest_price`); `travelpayouts/*` and the fixture provider (`null`).
- `packages/engine/src/estimate.ts`, `budgetFit.ts`, `stages/*`.
- `apps/web/src/**` (the provenance line, the vendor mark, View D's scrolls).
- `docs/setup.md` §14, `docs/providers.md`, `docs/scheduling.md` (generated), spec §12 and `.env.example`.
- Tests beside each, and `apps/camoufox-worker/test/support/gridTree.ts` (Task 15.1).

## 9. What the worker recognises in grid mode, and what is verified

**Gates before any click** (PA-12): the WP14 search-form check (round trip, one adult, the query's dates) and the
currency check ("Currency GBP") pass on the settled Best view; otherwise the page is `unrecognised` and nothing in the
dialog is clicked.

**The classifier inside the dialog** (ruling 1): on every poll after the Price graph click, the challenge, sign-in,
signed-in control, consent and allowlist checks run first, unchanged, with `SOCS` read back after the page; any of
them stops the page with its cool-down. The results-page structure rules (`cheapest-tab-count`, the Date grid button,
the result links) are not applied while the dialog is open. The dialog view, `dates-grid`, is recognised when the
"Price insights" dialog is open, its "Dates" tab is selected, and its panel holds the four scroll buttons; anything else
is `unrecognised` (1 h).

| Step | Rule | Evidence | On failure |
|---|---|---|---|
| Open | exactly one `button` named "Price graph" in the main frame; click; a dialog "Price insights" appears | explorations 1, 2 | not found: `unrecognised` (1 h) |
| Dates | exactly one `tab` named "Dates" in that dialog; click; the first visible `tabpanel` settles by two stable polls | exploration 2 | not found: `unrecognised`; not settled: `not-ready` |
| View (structural) | `dates-grid` recognised; one `grid "Date grid"`; exactly 49 candidate cells; a departures line and a returns line of seven consecutive dates each, every weekday agreeing; a selected-pair line | exploration 2 | `unrecognised` (1 h) |
| View (data) | each candidate's name parses and names its position's pair | exploration 2 | that cell unparsed; duplicates or a failed cross-product: the view structurally unparsed; drift (below): `unrecognised` |
| First view | its selected cell is the query's pair, at the selected-pair line's price (PA-11) | exploration 2 | `unrecognised` |
| Move | exactly one `button` named "Scroll left/right/up/down" in the panel; click; the departures or returns line differs from the view before the move, then holds for two polls 2 s apart | names: exploration 2; axes and step: Task 15.1 | not found: `unrecognised`; no change within the move's budget: `scroll-not-settled` (no cool-down) |
| Edges | a first view or a move whose dates differ from the plan but are consistent (seven consecutive dates per line, on the planned axis) and inside the sale window | Task 15.1 | the view is kept, flagged `offPlan` with its cause; the page ends `off-plan`; the planner re-plans from the dates shown |

**Grammar drift** (ruling 3): when more than half of a view's priced-looking candidates (names starting "£") fail the
grammar, the page stops as `unrecognised`, no further scrolls run, and the notes name `selector-drift`, pointing to
WP14's re-dating task (PIE-09).

`GRID_VERIFIED` flips only in the commit that adds the `--grid` recordings proving every row above, the move axes and
step (`GRID_MOVES`, `GRID_STEP_DAYS`), and, if one was seen, the unpriced form, with `PROOFS` naming them.

**The cell grammar** (`gridNames.ts`, `GRID_GRAMMAR_VERSION = '2026-10-18'`):

```
^£(?<price>[1-9]\d{0,2}(?:,\d{3})*)(?<cheapest>, cheapest price)?, (?<dd>\d{1,2}) (?<dm><MON>) to (?<rd>\d{1,2}) (?<rm><MON>)(?<selected>, selected)?$
```

`<MON>` is the month-token table, which holds only the tokens recordings have shown ("Mar" on 2026-10-18; Task 15.1
adds the others its moves cross). A token not in the table makes the cell unparsed. The price is whole pounds:
`amountMinor = pounds × 100`, and the note says the grid shows whole pounds (ruling 5; PA-10). An unpriced cell is
unparsed until a recording proves Google's unpriced form, and then `no_data` (ruling 2).

- **Years** (PA-05): the selected-pair line (observed `^(\d{1,2}) – (\d{1,2}) (<MON>) (\d{4})£(\d…)`; the two-month and
  two-year forms are hypotheses Task 15.1 records) gives the query pair's year Y, which must equal the query's. Each
  label on both lines takes the year in {Y − 1, Y, Y + 1} nearest the planned block, and every weekday on both lines
  must agree with its computed date; a cell takes its dates only by matching the resolved lines. So a view of
  departures in December and returns in January rolls over, and a wrong weekday on either line is `unrecognised`.
- **Positional match** (ruling 2): candidate `i` must name departures[`i mod 7`] to returns[`⌊i / 7⌋`]; a cell that
  names another pair is unparsed. A pair named twice makes both copies unparsed and, with a pair left missing, the view
  structurally unparsed: nothing from it is stored and its covered cells are issues (PA-06).
- **Order:** a departure on or after its return is unparsed (a block holding such pairs keeps them as unparsed
  candidates, never priced; PIE-04).
- **Flags.** ", cheapest price" sets `vendorPriceMark` (relative to that view: the legend reads "Cheapest Compared
  with other prices shown"; PA-04, PIE-11); each cell is read in exactly one view (`reads`), so no flag is merged. ",
  selected" is checked on the first view and not stored.

## 10. Tasks

Conventions as WP14 §10: fixed clocks, the fake timers, no casts, every case written in full, `expect.hasAssertions()`
in a `beforeEach`, failing first. Synthetic trees only, built by `test/support/gridTree.ts` (Task 15.1) in recording
2's shape:

```ts
gridTree({ depart: '2027-03-11', ret: '2027-03-21', year: 2027, price?: (d, r) => number | null,
           cheapest?: Array<[IsoDate, IsoDate]>, selected?: [IsoDate, IsoDate], labels?: 'lines' | 'labels',
           names?: (d, r, i) => string })
// → dialog "Price insights" > tablist (tab "Dates" selected, tab "Price graph"), text "10-day trip",
//   button "Reduce your stay by one day", button "Extend your stay by one day",
//   tabpanel "Dates" > img, text "Cheapest Compared with other prices shown Departure", button "Scroll left",
//   button "Scroll right", grid "Date grid" (empty), the departures (one line, or seven label nodes),
//   49 sibling buttons in rows of one return, the returns (line ending "Return", or seven labels then "Return"),
//   button "Scroll up", button "Scroll down", text "14 – 24 Mar 2027£462 · Round trip";
//   then (outside the panel) buttons "Cancel", "OK"
```

### Task 15.1: The pinned window, the recorder's `--grid`, then the recording (first failing test) — done (`dfa7d82`, recordings of 2026-10-18)

**Files:** `launch.ts`, `budget.ts`, `recordArgs.ts`, `record.ts`, `recordWrite.ts`, `dialogSettle.ts`, `graph.ts`,
`gridRecord.ts`, `test/support/gridTree.ts` (with a shape test: 49 names in the recorded forms, the lines, the four
scroll buttons; PIE-16), their tests, `rules.test.ts`.

- [ ] **Step 1: Failing tests.**
  - The launch options gain `window: [1280, 900]` (the rules test's pinned set gains `window`).
  - `parseRecordArgs([...Q, '--grid'])` is `{ kind: 'grid', moves: ['right', 'down', 'left', 'up'] }`; `--moves
    right,right` is accepted; a move outside the four, more than 12 moves, `--moves` without `--grid`, or `--grid` with
    another mode flag is refused (EX_CONFIG) before any launch. The old `--grid` refusal test is replaced.
  - On a `gridTree` page: the clicks are exactly `button:Price graph`, `tab:Dates`, then one `button:Scroll <dir>` per
    move, each at least 5 s after the last scroll's start (fake timers); a view after a move counts only once its
    departures or returns line differs from the view before, then holds for two polls; the file
    `fixtures/recorded/grid/<date>/<n>.json` (0600 in 0700 directories, queries stripped, scanned for an account name
    and an e-mail address) holds per view: the panel's printed snapshot, the lines' and labels' texts and element
    counts, the candidates' names in order, the `dates-grid` check, and per move the click, settle and read ms, the polls
    and the measured day deltas of both lines; plus the results page's Cheapest tab name and the list minimum parsed
    from its result links (to learn how the grid rounds against the list, PA-10).
  - A move whose view never changes within its budget is recorded `{ step, reason, timedOut }` and the file is still
    written; a challenge on any poll is that stop with its cool-down, and nothing is written but the stop record; an
    open dialog does not trip `cheapest-tab-count` (PA-01).
  - Each move's own budget: a move whose settle takes three 12 s polls still records; one that needs 61 s is
    `timedOut`; the page's overall cap closes the page (boundary tests, ruling 10).
  - `SOCS` is set before the page and read back after it by value; the account-cookie refusal, the guard and the
    pacer apply.
  - Rules: `ariaSnapshot` is called only in `dialogSettle.ts` and `graph.ts`; `exploreGraph` and `exploreGrid` are
    imported only by `record.ts`.
- [ ] **Step 2: Implement.** Move `settle`, `panelOf` and `readCells` from `graph.ts` to `dialogSettle.ts`; give
  `settle` the post-move rule; `--graph-explore` keeps its behaviour and tests.
- [ ] **Step 3: The operator records** (the controller runs these; the implementer never loads a Google page). The
  dates are chosen against 2026-10-18 and the sale window (about 11 months, so no pair past September 2027; PIE-07):

```bash
cd /Users/iandominey/projects/get-me-there/.worktrees/graph
W='pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK'
$W --depart 2027-03-14 --return 2027-03-24 --grid                                   # one move each way: axes and step
$W --depart 2027-03-28 --return 2027-04-07 --grid --moves right,right,down          # across a month boundary
$W --depart 2026-12-27 --return 2027-01-06 --grid --moves right,down                # across a year boundary
$W --depart 2026-10-20 --return 2026-10-23 --grid --moves left,down                 # near today; short stay; impossible pairs
$W --depart 2027-09-10 --return 2027-09-20 --grid --moves right,right               # near the sale window's end; unpriced cells
mkdir -p apps/camoufox-worker/fixtures/recorded/grid/2026-10-18
mv apps/camoufox-worker/fixtures/recorded/graph-explore/2026-10-18/2.json apps/camoufox-worker/fixtures/recorded/grid/2026-10-18/0-explore.json
pnpm --filter @gmt/camoufox-worker recordings:backup
```

- [ ] **Step 4: From the recordings**, write `GRID_MOVES` (each button's axis and day step), `GRID_STEP_DAYS`, the line
  and label form, the month tokens seen, the selected-line forms, the unpriced form if seen, `GRID_TIMES`, and restate
  §6's cost table from them. Commit with the recordings' dates named; `GRID_VERIFIED` stays false until Task 15.4.

### Task 15.2: The cell grammar and the view reader

**Files:** `gridNames.ts`, `gridView.ts`, `classify.ts`, tests, `recorded.test.ts`.

- [ ] **Step 1: Failing tests.**
  - The observed forms parse: `"£457, 11 Mar to 21 Mar"` → 45 700, not marked; `"£397, cheapest price, 15 Mar to 23
    Mar"` → marked; `"£462, 14 Mar to 24 Mar, selected"` → selected. Marks out of their places are unparsed.
    `"£1,204, 2 Apr to 12 Apr"` → 120 400 once "Apr" is in the table, unparsed before.
  - Unparsed, counted, never guessed: no `£`, `£0`, no "to", a token not in the table, day 32, a name for another
    position's pair, a departure on or after its return, a dash-named cell, a cell past the sale window.
  - Structural: a pair named twice makes both copies unparsed and the view `structural: 'unparsed'` (nothing stored);
    48 or 50 candidates is `unrecognised`; a missing line or selected-pair line is `unrecognised`.
  - Drift: 25 of 49 priced-looking names failing is `unrecognised` with `selector-drift`; 24 is not.
  - Years: departures 27 Dec … 2 Jan with returns 6 … 12 Jan read 2026-12-27 … 2027-01-02 and 2027-01-06 … 12; a wrong
    weekday on either line is `unrecognised`; a selected-pair year that is not the query's is `unrecognised`; a selected
    cell whose price differs from the line's is `unrecognised`.
  - `classify.ts`: with the dialog open and Dates selected, `dates-grid`; a challenge or account control still stops;
    `cheapest-tab-count` is not raised for an open dialog.
  - The reader on `gridTree`, both label forms: 49 cells, `unparsed` 0.
  - Recorded suite (kind `grid`, skipped visibly when absent, decision 61): every recorded candidate parses or is the
    recorded unpriced form; each view's cells are its lines' cross product; the first view's selected cell is the query's
    pair; `0-explore.json` is read for its 49 candidate names only (the four scroll buttons excluded).
- [ ] **Step 2: Implement; run; commit.**

### Task 15.3: The planner (pure)

**Files:** `packages/providers/src/camoufox/grid.ts`, `tiles.ts`, `test/camoufox/grid.test.ts`. Starts only after Task
15.1's step and times are committed (PIE-06).

- [ ] **Step 1: Failing tests** (each for `stepDays` 7 and for the measured step if it differs):
  - The lattice: for D days from `F` and nights `[m, M]`, column `c` holds departures `F + 7c … F + 7c + 6`; its blocks
    start at returns `F + m + 7c + 7k`, `k < ⌈(7 + M − m) / 7⌉`. The worked example: 78 blocks; its 2,184 cells each in
    exactly one block (a partition test over `generateCells`).
  - The path: 102 moves with 78 read views and 24 transit views; first column top to bottom, then right, up, down,
    down per column.
  - Pages: a page ends on a read view; the next opens the next read block; greedy at 30 moves gives 4 tiles and 97
    scrolls (CB-1); each tile's `start` centres its first block, clamped to `today + 3`; tiles' covered cells partition
    the pair's cells; `scrollCap` 0 gives 78 one-view pages.
  - Stay range: 1–3 nights, a single 7-night stay, 10–21 across 31 December; cells outside the band in no tile.
  - Re-plan: `q.cells` with 5 resumable cells in two blocks plans those blocks; an off-plan view's dates re-anchor the
    remaining blocks (`planGridTiles` with `shown`).
  - `gridTileEstimate` gives each tile's scrolls and seconds from `GRID_TIMES`; determinism (no clock but `today`).
- [ ] **Step 2: Implement; run; commit.**

### Task 15.4: The worker's grid page

**Files:** `gridPage.ts`, `session.ts`, `server.ts`, `selectors.ts`, `config.ts`, tests.

- [ ] **Step 1: Failing tests** (fake page and context, `gridTree`):
  - `GRID_VERIFIED` false, `CAMOUFOX_MODE=list` or `gridStepDays` null: 409 `mode-unavailable`, no page opened.
  - A form showing two adults, or a currency other than GBP: `unrecognised` and Price graph is never clicked (PA-12).
  - The happy path: one page load at the start block's URL; `SOCS` set before and read back by value after; the two
    clicks; each move at least the scroll spacing after the last (start to start) and inside its own budget; every
    view settled (first by two stable polls, each later one only after it changes) and classified; `reads` honoured;
    the answer `grid`, `scrolls` equal to the clicks made, `ended: 'complete'`, versions with `gridGrammar`.
  - Stops on any poll after any click: that `blocked` answer with its cool-down and `scrolls` so far, no view; a `SOCS`
    changed by a scroll is `consent-unhandled` and wipes the profile.
  - A move whose view never changes: `scroll-not-settled` with the views so far, no cool-down; a move of the wrong
    length on the right axis inside the sale window: `off-plan`, the view kept and flagged `short-move`; a first view
    shifted by the sale window's start: kept, `near-today`.
  - Drift on a view: `unrecognised`, no further scrolls.
  - `scrollAllowance` 2 with 4 moves: 2 scrolls, `ended: 'allowance'`. More moves than the worker's cap: 400 first.
  - The page's overall cap; the pacer released on every path; the next page waits the 30 s page spacing from this
    page's start.
- [ ] **Step 2: Implement; run.**
- [ ] **Step 3: Set `GRID_VERIFIED`** with `PROOFS` naming Task 15.1's recordings, in the commit whose recorded suite
  proves every row of §9; commit.

### Task 15.5: Core

- [ ] **Step 1: Failing tests.** The grid schemas accept §5's shapes and refuse `reads` of the wrong length, a move
  outside the four, `scrollAllowance` above the moves, a cell whose return is not after its departure, a view of more
  than 49 cells, and a `no-flights` cell (PA-13). `sourceLabel` gives the two camoufox labels. The grid capability info
  declares `maxAgeHours` 24, assumed, with the age line "Google's date grid; age not stated (assumed ≤24h)" (ruling 4;
  PA-03), list mode keeping 0. The config accepts `CAMOUFOX_MODE=grid`, spacing 5–30, cap 0–60, the two scroll caps, and
  refuses a spacing under 5. `RawCalendarPrice.vendorPriceMark` is required (`boolean | null`, PA-08).
- [ ] **Step 2: Implement; run; commit.**

### Task 15.6: db: migration 0006 and the scroll caps

- [ ] **Step 1: Failing tests.**
  - Migrating a 0005 database with rows of every provider backfills `return_date_source` (`asked` for camoufox, `vendor`
    otherwise) and leaves `vendor_price_mark` and `scroll_count` NULL; the column has no default and an insert
    without it fails (PA-09).
  - CHECKs: `return_date_source` NOT NULL in the three values, `grid-cell` only with `camoufox`; `vendor_price_mark`
    NULL or 0/1; `scroll_count` NULL or an integer ≥ 0, NULL unless `camoufox`. The repository writes NULL for list
    rows and the count (0 allowed) for grid pages (CB-8).
  - A grid page blocked after 3 scrolls writes `scroll_count` 3; a timed-out grid call writes NULL (CB-4).
  - The page caps count rows; `provider-execution-scrolls` and `provider-month-scrolls` sum `scroll_count` and refuse a
    tile whose allowance would pass them (ruling 12).
  - A reused grid-cell row keeps `grid-cell` and its `vendor_price_mark` (PA-09).
- [ ] **Step 2: Implement** (rebuild the tables as 0005 did, foreign keys off around the run and `foreign_key_check`
  after; do not regenerate); run; commit.

### Task 15.7: The adapters

- [ ] **Step 1: Failing tests** (msw, the providers harness):
  - Camoufox grid: `planGridTiles` tiles with the worker's `gridStepDays` from preflight; one call per tile with its
    timeout and its `scrollAllowance` from the scroll caps; priced cells inside `coveredCells` become rows with
    `returnDateSource: 'grid-cell'`, `vendorPriceMark` from the cell, the assumed 24 h age, GBP; cells outside are
    dropped and counted in `notes`; each view's unparsed count goes to `notes` as `unparsed:<n>@<view>` (PA-07); a covered
    cell with no parsed cell on a read view is an issue `error`/`parse`/`cell-unparsed`, resumable, never `empty` or
    `no_data`; a structurally unparsed view's covered cells are issues `view-unparsed`; cells of views not reached are
    issues `page-not-ready`, `off-plan-view:<cause>` or `scroll-allowance`; a cell read twice throws.
  - `scrolls` reaches `scroll_count` through `finalise` on every answer that carries it.
  - SearchApi `google_flights_calendar`: `is_lowest_price` true or false fills `vendorPriceMark`; absent is `null`.
    Travelpayouts and the fixture write `null`; camoufox list writes `null` and `returnDateSource: 'asked'`.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.8: Engine: estimate, budget fit, resume

- [ ] **Step 1: Failing tests.** The worked example's grid estimate is 16 pages, 388 scrolls and the seconds from
  `GRID_TIMES`, at retry factor 1.0 (the plan's own figures, CB-2), and says a full pass fits one run; `scrollCap` 0
  gives 312 pages and 4 runs; spacing 30 with cap 60 gives its seconds and a note when the run would pass
  `STUCK_AFTER_HOURS` (CB-7); `budgetFit` counts pages and scrolls against their caps; a resume after a
  `scroll-not-settled` or `off-plan` page re-plans only the unread cells (decision 50); a blocked grid page disables the
  provider as in list mode.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.9: API and web

- [ ] **Step 1: Failing tests.** Every camoufox grid price renders "Google Flights date grid via Camoufox" with "age
  not stated (assumed ≤24h)"; its provenance line says "return date: read from the grid" and "whole pounds"; a marked
  cell shows "Google's date grid marked this the cheapest of the prices shown in that view", never a badge of this
  app's own; a SearchApi calendar price with `is_lowest_price` shows its own wording; list-mode prices keep "return date:
  the date asked for"; View D shows a run's scrolls beside its pages (CB-5).
- [ ] **Step 2: Implement; run; commit.**

### Task 15.10: Operator docs

- [ ] Spec §12's block and `.env.example` together (the envExample test holds them equal): `CAMOUFOX_MODE` (now
  offered, `list` or `grid`, so it leaves `NOT_OPERATOR`), `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS=5`,
  `CAMOUFOX_GRID_SCROLL_CAP=30`, `CAMOUFOX_EXECUTION_SCROLL_CAP=600`, `CAMOUFOX_MONTHLY_SCROLL_CAP=6000`.
- [ ] `docs/setup.md` §14: turning grid mode on, what a grid page does, the coverage paragraph, the speed line and cost
  table of §6 from the measured figures (the time a page at the defaults and at the maximums, CB-7, CB-9), the scroll
  caps, that a stop discards the whole page, and that cells the grid cannot show read as issues, never as priced
  coverage (PA-02). `docs/providers.md`: the camoufox row and section. `docs/scheduling.md` regenerated. A docs test
  asserts the figures equal the estimate's output.

### Task 15.11: Rules tests and smoke rows

- [ ] Rules (compiler API): `ariaSnapshot` only in `dialogSettle.ts` and `graph.ts`; the grid flow clicks only the
  dialog's named buttons (Price graph, Dates, the four scrolls); every scroll delay is a plain name or number; the grid
  flow sets no cookie; the launch options' `window` is the literal `[1280, 900]`.
- [ ] Smoke (`smoke:live`): one grid page with one move, its row's `scroll_count` 1, its prices labelled "Google
  Flights date grid via Camoufox" with the assumed age, `SOCS` same.

## 11. Pinned review-focus tests

- A cell is stored only when it sits at its position's pair, names that pair, and the departure precedes the return;
  a duplicate or a failed cross-product stores nothing from the view (Task 15.2).
- Every weekday on both lines is checked; a December-to-January view rolls over (Task 15.2).
- The dialog's polls stop on every challenge, sign-in, consent, account and allowlist kind, and never on the results
  page's structure rules (Tasks 15.2, 15.4).
- A post-scroll view counts only after it changes; each move has its own budget (Tasks 15.1, 15.4).
- Grammar drift stops the page (Task 15.4).
- Grid cells outside the window or nights are never stored (Tasks 15.3, 15.7).
- Every stored price records its return-date source, with no default (Task 15.6).
- The cheapest mark is the vendor's, scoped to its view, never this app's minimum (Tasks 15.7, 15.9).
- Grid prices carry the assumed 24 h age (Task 15.5).
- One ledger row per page; the page caps count rows; the scroll caps count `scroll_count` and are checked before each
  scroll (Tasks 15.4, 15.6).
- Scroll spacing is fixed at 5 s or more; the page spacing is unchanged (Task 15.4).
- Grid mode stays refused until `GRID_VERIFIED` and a measured step (Tasks 15.4, 15.5).

## 12. Definition of done

- The worker's tests pass with their floors (90/80/90/90; 100 lines and branches for the safety modules, `gridNames.ts`
  added); `pnpm --filter @gmt/camoufox-worker mutate` passes with `gridNames.ts` in the run; the recorded `grid` suite
  passes where the recordings are present and is reported skipped with the decision-61 suffix where they are not.
- `@gmt/core` at 100%; `@gmt/db`, `@gmt/providers`, `@gmt/engine`, `@gmt/api`, `@gmt/web` with their thresholds;
  `pnpm test`, `pnpm lint`, `pnpm -r typecheck`, `check-boundaries`, `check-casts`, the wording test and
  `pnpm secret-scan` clean.
- Migration 0006 applies to a copy of the operator's database, and `PRAGMA foreign_key_check` prints nothing.
- `git ls-files apps/camoufox-worker/fixtures/recorded` prints only `.gitkeep` files.
- The default image is unchanged and browser-free (WP14's DoD check).
- On the operator's Mac: one grid page of the worked example with its planned moves prices every covered cell or names
  why, with `SOCS` same and the row's `scroll_count` equal to the scrolls; the smoke rows read `ok`.
- §6's cost table restated from the measured step and times in Task 15.1's commit and in `docs/setup.md`.
- Every task's checkbox ticked.

## 13. For the plan (not yet recorded there)

Decision 70 records the rulings. Items for Fable:

1. **Contracts:** `GridMove`, the `grid-path` `TileRequest`, `ReturnDateSource`, `Provenance.returnDateSource` and
   `vendorPriceMark`, `RawCalendarPrice.returnDateSource` and `vendorPriceMark`, the grid request and answer
   schemas, `gridTileEstimate`, `gridRequestTimeoutMs`, `CostEstimate.scrolls` and the scroll-cap budget scopes belong
   in the plan's contract blocks.
2. **The scroll step** is a dated value from Task 15.1; if it is not one block, §6's arithmetic and spec §2's coverage
   paragraph are restated before Task 15.3.
3. **"Date grid" on the results page** may open the same panel in one click; if Task 15.1's recording shows it, a later
   change may use it in place of Price graph then Dates, with its own proof.
4. **An unpriced cell** is unparsed until a recording shows Google's form; then it maps to `no_data` (spec §2).
5. **Re-dating** the grid's names after a Google change is part of WP14's standing maintenance task.

## 14. Open questions

- The scroll buttons' axes and step (Task 15.1 measures them; the design assumes one block along one axis each, left and
  right on departures and up and down on returns, as their places in recording 2 suggest).
- The lines' and labels' DOM form, the two-month and two-year selected-pair forms, the month tokens beyond "Mar", the
  unpriced form, and the grid's rounding against the list (Task 15.1 records them).

## Appendix A: findings and where each is answered

| Finding | Severity | Where |
|---|---|---|
| PA-01 | High | Evidence (stored classification); §9 classifier inside the dialog; Tasks 15.1, 15.2 (`dates-grid`, no `cheapest-tab-count` with the dialog open) |
| PA-02 | High | §7 cells by position; §9 View rows; Task 15.2 (dash-named cell, past the sale window); Task 15.10 (issues, not coverage) |
| PA-03 | High | Ruling 4: spec §2 provenance, §5 capability info, Task 15.5 (assumed 24 h), Task 15.9 |
| PA-04 | Medium | §9 flags; Task 15.9 wording "the cheapest of the prices shown in that view"; spec §2 note |
| PA-05 | Medium | §9 years (both lines' weekdays, {Y − 1, Y, Y + 1}, cell years from the lines); Task 15.2 |
| PA-06 | Medium | §9 positional match (both copies unparsed; view structurally unparsed); Task 15.2 |
| PA-07 | Medium | Task 15.7 (`unparsed:<n>@<view>`; `cell-unparsed` issues, never `empty` or `no_data`) |
| PA-08 | Medium | Ruling 6: §5 `boolean \| null` everywhere; Task 15.7 (SearchApi `is_lowest_price`); spec §7 |
| PA-09 | Medium | Task 15.6 (no default; reused rows keep source and mark); spec §7 |
| PA-10 | Low | Ruling 5: §9 and the note (whole pounds); Task 15.1 records the list minimum beside the grid |
| PA-11 | Low | §9 First view (selected price equals the line's); Task 15.2 |
| PA-12 | Low | §9 gates before any click; Task 15.4 (two adults never clicks Price graph) |
| PA-13 | Low | §5 (`no-flights` cell left out until recorded); Task 15.5 refuses it |
| PA-14 | Low | Ruling 11: §9 Edges (`offPlan` with cause); Tasks 15.4, 15.7 |
| PIE-01 | High | As PA-01 |
| PIE-02 | High | Ruling 10: §6 budgets (45 s + 15 s a move inside the page cap); Task 15.1 boundary tests |
| PIE-03 | High | Ruling 9: §9 Move row; `dialogSettle.ts` post-move rule; Tasks 15.1, 15.4 |
| PIE-04 | High | §9 structural against data checks; order rule; Task 15.1 short-stay recording with impossible pairs |
| PIE-05 | High | Ruling 11: §6 clamp to `today + 3`; §9 Edges; Task 15.1 near-today and sale-end recordings |
| PIE-06 | High | Ruling 8: §5 `stepDays`; §6; Task 15.3 blocked on Task 15.1; `gridStepDays` in status and preflight |
| PIE-07 | Medium | Task 15.1 Step 3 (dates inside the sale window; `mv` before `recordings:backup`) |
| PIE-08 | Medium | Evidence; §7 lines and labels through locators; Task 15.1 records element counts |
| PIE-09 | Medium | Ruling 3: §9 grammar drift; Tasks 15.2, 15.4 |
| PIE-10 | Medium | Ruling 7: §7 the window; Task 15.1 launch test; Task 15.11 rule |
| PIE-11 | Medium | As PA-04; §9 (each cell read in one view, no merge) |
| PIE-12 | Medium | Ruling 11: §9 Move and Edges rows (`short-move`, `scroll-not-settled`, structural `unrecognised`) |
| PIE-13 | Medium | Ruling 12: the scroll caps; spacing fixed at 5 s or more, never jittered (Out) |
| PIE-14 | Low | §6 (about 11 s a move; the run limit checked in Task 15.8) |
| PIE-15 | Low | §5 `versions.gridGrammar`, `dialogSelectors`; Task 15.4 |
| PIE-16 | Low | Task 15.1 files (`gridTree.ts` with its shape test) |
| CB-1 | Medium | §6 cut rule (ends on a read view; next opens the next read block): 4 pages, 97 scrolls; Task 15.3 |
| CB-2 | Medium | Ruling 13: §6; spec §8.1; Task 15.8 (plan figures at 1.0) |
| CB-3 | Medium | §5 `gridTileEstimate`, `CostEstimate.scrolls`; §13 item 1 |
| CB-4 | Medium | §5 (every grid answer that reached Google carries `scrolls`); Task 15.6 (blocked after 3: 3; timeout: NULL) |
| CB-5 | Medium | Ruling 12 (option a): the scroll caps; Task 15.9 (View D scrolls); spec §2 costs |
| CB-6 | Medium | As PIE-02 |
| CB-7 | Low | §6 (the maximums; `scrollCap` 0); Task 15.8; Task 15.10 |
| CB-8 | Low | Task 15.6 (NULL for list rows, the count for grid pages); spec §7 |
| CB-9 | Low | §6 `GRID_TIMES` from Task 15.1; Task 15.10 speed line; spec §2 speed |
