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

Written 2026-10-18 against spec revision 34, plan decisions 1–70 and `feat/camoufox-graph` at the head that adds this
brief. It builds the `grid` mode spec §2 designs: up to 49 day pairs per settled view instead of `list` mode's one per
page, so a full pass of the worked example fits in one run. Every WP14 limit holds unchanged (decisions 68, 69, 70).

**The evidence this brief stands on.**

- *Graph exploration 1, 2026-10-18* (`record --graph-explore`, local and gitignored): the results page's one "Price
  graph" button opens a dialog "Price insights" holding a `tablist` ("Dates", "Price graph" selected), the text
  "10-day trip", the buttons "Reduce your stay by one day" and "Extend your stay by one day", the text "Sun 14 Mar - Wed
  24 Mar From £462", a `region "Price graph"` with no accessible children, and the buttons "Scroll forwards", "Scroll
  backwards", "Cancel" and "OK". Exit 0, `SOCS` same, no stop.
- *Graph exploration 2, 2026-10-18* (`graph-explore/2026-10-18/2.json`, backed up to the private store): the chart
  region's text is its axes only ("April 2027May 2027£600£400£200£0"), 710 elements with no images and no buttons, so
  its bars cannot be read through the accessibility tree; **the chart is dropped**. After the "Dates" tab's click the
  panel is `tabpanel "Dates"`. In its printed snapshot, in order: an image; the legend text "Cheapest Compared with
  other prices shown Departure"; `button "Scroll left"` and `button "Scroll right"`; an empty `grid "Date grid"`; the
  departures line as **one text node** "0000 Thu 11 Mar Fri 12 Mar … Wed 17 Mar" (the "0000" is a glyph run); then the
  **49 cell buttons as siblings in the panel, not children of the grid**, in rows of one return date (11–17 Mar to 21
  Mar, then to 22 Mar, …), each named like `"£457, 11 Mar to 21 Mar"`, `"£397, cheapest price, 15 Mar to 23 Mar"` (two
  cells carry the mark) or `"£462, 14 Mar to 24 Mar, selected"`; the returns line as one text node "Sun 21 Mar … Sat 27
  Mar 0000 Return"; `button "Scroll up"` and `button "Scroll down"`; and the text "14 – 24 Mar 2027£462 · Round trip"
  (the selected pair, with its year). Left and right sit by the departures line, up and down by the returns line, which
  suggests their axes. No scroll was clicked. Clicks: Price graph, then Dates. Exit 0, `SOCS` same, no stop.
- *What the evidence does not cover.* Which axis each scroll moves and by how many days; whether "Date grid" on the
  results page opens the same panel directly; the month tokens other than "Mar"; the selected-pair line when the pair
  spans two months or two years; an unpriced cell; a grid near the end of the sale window. Task 15.1 records each
  before any reader depends on it, and until then each is a hypothesis named as such below.

## 1. Goal

Price the definition's day pairs from Google Flights' date grid, 49 to a settled view, by planning page loads and
scrolls from the definition's window and stay range, reading every cell's own dates and price through locators with a
dated grammar, storing each price with the source of its return date, and keeping every WP14 stop, cool-down, spacing
and cap.

## 2. Scope

**In**

- **The recorder's `--grid`** (Task 15.1): one page, the Price graph and Dates clicks, then the moves the operator
  names (`--moves right,down,left,up`, default one of each, at most `CAMOUFOX_GRID_SCROLL_CAP`), each settled and read;
  the operator records, and renames `graph-explore/2026-10-18/2.json` into the `grid` kind for the recorded suite.
- **The cell grammar and the view reader** (Task 15.2, worker, pure): the dated cell pattern, the header, footer and
  selected-pair readers, the year and rollover rule, the cross-product and order checks, unparsed counts.
- **The planner** (Task 15.3, `@gmt/providers` camoufox, pure): the block lattice from the window and nights, the path,
  the cut into pages under the scroll cap, the `grid-path` tile with its covered cells, a re-plan over resumable cells.
- **The worker's grid page** (Task 15.4): the request, the clicks, the settles (two stable polls, classified on every
  poll), the scroll spacing and cap, the page's whole-call bound, the answer.
- **Core** (Task 15.5): the `grid` request and answer schemas; `TileRequest` `grid-path`; `ReturnDateSource`;
  `RawCalendarPrice.returnDateSource` and `vendorMarkedCheapest`; the grid source label and provenance note;
  `CAMOUFOX_MODE=grid`, `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS`, `CAMOUFOX_GRID_SCROLL_CAP`.
- **db** (Task 15.6): migration 0006 (`calendar_prices.return_date_source` NOT NULL with its backfill,
  `calendar_prices.vendor_marked_cheapest`, `provider_requests.scroll_count`); repositories write and read them.
- **The adapter** (Task 15.7): grid tiling, the request's timeout from its moves, the answer mapping, `scroll_count` on
  the page's row.
- **Engine, API and web** (Tasks 15.8, 15.9): the estimate's pages, scrolls and time; the return-date source and the
  vendor's mark in the provenance the API returns and the views show.
- **Docs** (Task 15.10) and **rules tests and smoke rows** (Task 15.11).

**Out**

- The Price graph's chart (no readable bars; decision 70).
- The stay buttons ("Reduce your stay by one day", "Extend your stay by one day"): the planner moves the grid with the
  scroll buttons only; a stay change is a different query and a new page.
- Itinerary search, verification, proxies, solving or clicking a challenge, any cookie but `SOCS`, signing in,
  clicking anything on a consent page, Linux: all as WP14 (decisions 68, 69).
- Treating Google's "cheapest price" mark as this app's minimum: it is stored as Google's flag only.

## 3. Spec sections and plan decisions

- **§2 Continuity fallback, the `grid` paragraph (rev 34):** the clicks, the grammar, the stay-range lattice, the
  scroll path and caps, the settles, the stops, the return-date source, provenance, coverage. The labels and the
  coverage arithmetic go verbatim into the operator docs (Task 15.10).
- **§5.1, §5.2:** `grid-path` tiles; cell keys from the page; covered-cell rules.
- **§5.3:** one ledger row per page load; `scroll_count`; page caps count rows.
- **§7:** `return_date_source`, `vendor_marked_cheapest`, `scroll_count` (migration 0006).
- **§8.1:** the rows for a grid page that stops, ends early or reads fewer views than planned.
- **§11, §12, §13, §16.**
- **Plan decisions 70** (this mode), **68, 69** (every limit), **61, 64** (recordings local-only, visible skip), **24**
  (cell issues), **30** (truncated tiles), **50** (a resume never re-fetches a priced cell).

## 4. Interfaces consumed

From `@gmt/core`: everything WP14's §4 lists, plus `pageRequestSchema`, `workerAnswerSchema`, `TilePlan`,
`TileRequest`, `generateCells`, `addDays`, `daysBetween`, `cellKeyString`, `sourceLabel`.

From the worker (WP14 and this branch): `createDriver`, `runStep`, `CheapestStepFailed`, `pollUntilSettled`,
`classifyPageWithRule`, `pageBudget`, `Pacer`, `CooldownStore`, `readBack`, the recorder's `record()` loop and
`writeRecording`, and the exploration's `exploreGraph`, whose Dates-panel settle (`settle`, `panelOf`, `readCells`) this
package moves into a shared module (Task 15.4) so the recorder and the session use one copy.

From `playwright-core` 1.59.1, beyond WP14's list: `Locator.ariaSnapshot({ timeout })` (the settle's comparison only,
hashed and never parsed, never stored by the provider path), `Locator.isVisible()`.

## 5. Interfaces produced

```ts
// packages/core/src/types/provenance.ts
export type ReturnDateSource = 'vendor' | 'asked' | 'grid-cell';
export interface Provenance { /* existing fields */ returnDateSource: ReturnDateSource; vendorMarkedCheapest: boolean | null }
// packages/core/src/ports/provider.ts
export type GridMove = 'left' | 'right' | 'up' | 'down';
export type TileRequest =
  | /* the four existing kinds */
  | { kind: 'grid-path'; start: { departureDate: IsoDate; returnDate: IsoDate }; moves: GridMove[]; reads: boolean[] };
  // reads[0] is the first view; reads[i + 1] says whether the view after moves[i] is read (false: a view passed through)
export interface RawCalendarPrice { /* existing fields */ returnDateSource: ReturnDateSource; vendorMarkedCheapest?: boolean }
// packages/core/src/labels/source.ts
export function sourceLabel(p: Pick<Provenance, 'sourceKind' | 'returnDateSource'>): string;
  // scraped-self + grid-cell → 'Google Flights date grid via Camoufox'; scraped-self otherwise → 'Google Flights prices via Camoufox'

// packages/core/src/camoufox/protocol.ts
export const gridRequestSchema;   // { mode: 'grid'; origin; destination; gl; start: { departureDate; returnDate };
                                  //   moves: GridMove[] (≤ scrollCap); reads: boolean[] (moves.length + 1) }
                                  // pageRequestSchema becomes the union of the list request and this one
export type GridCell =
  | { status: 'price'; departureDate: IsoDate; returnDate: IsoDate; amountMinor: number; vendorMarkedCheapest: boolean }
  | { status: 'no-flights'; departureDate: IsoDate; returnDate: IsoDate };   // only once a recording pins the dash
export interface GridView {
  index: number;                 // 0 the first view, i + 1 the view after moves[i]
  departures: IsoDate[];         // the header's seven, in order
  returns: IsoDate[];            // the footer's seven, in order
  cells: GridCell[];             // the parsed cells, keyed from the page
  unparsed: number;              // cells counted, never guessed
}
// WorkerAnswer gains:
//   | { kind: 'grid'; fetchedAt; currency: 'GBP'; pointOfSale; views: GridView[]; scrolls: number;
//       ended: 'complete' | 'scroll-not-settled'; notes: string[]; versions }        // 200, Google contacted
// 'mode-unavailable' stays for a worker whose GRID_VERIFIED is false or whose mode is list.

// packages/providers/src/camoufox/grid.ts
export const GRID_SIDE = 7;
export function gridBlocks(q: DiscoveryQuery): Block[];                    // the lattice blocks holding at least one wanted cell
export function gridPath(blocks: Block[]): { start: Block; moves: GridMove[]; reads: boolean[] };
export function planGridTiles(q: DiscoveryQuery, scrollCap: number): TilePlan[];   // pages of ≤ scrollCap moves
export function gridRequestTimeoutMs(tile: TilePlan, c: CamoufoxConfig): number;
```

Config (`Config.providers.camoufox`): `mode: 'list' | 'grid'`, `gridScrollSpacingSeconds` (3–30, default 3),
`gridScrollCap` (0–60, default 30). The schema refuses `grid` while the worker's `/v1/status` flag `GRID_VERIFIED` is
false at preflight (the provider is then `skipped:provider_disabled` "grid mode not verified").

## 6. Endpoints, parameters and cost

**Worker.** `POST /v1/page` takes either request; a `grid` request is answered `mode-unavailable` (409, Google not
contacted) unless `GRID_VERIFIED` is true and `worker.env` sets `CAMOUFOX_MODE=grid`. Every other WP14 answer and status
applies unchanged. The worker refuses a request whose `moves` exceed its own `CAMOUFOX_GRID_SCROLL_CAP` (400, Google not
contacted), so the app and the worker agree on the cap as they do on the spacing.

**The page URL** is list mode's, with the first block's centre as its dates: a view opened by `…on <d> returning <r>`
shows departures `d − 3 … d + 3` and returns `r − 3 … r + 3` (observed 2026-10-18: the query 14 Mar to 24 Mar showed
11–17 Mar by 21–27 Mar). The planner asks for `d = a + 3`, `r = b + 3` to open the block with departures `a … a + 6`
and returns `b … b + 6`.

**The whole call's bound.** Load through the Dates tab's settle: the page budget as the Cheapest flow (the page
timeout, then the same again from the first click, never past twice it from the start). Each move: the scroll spacing,
then one 30 s step for the click, settle and read (`SCROLL_STEP_MS`, dated). The adapter's request timeout is
`2 × pageTimeout + moves × (spacing + 30 s) + 15 s` (`gridRequestTimeoutMs`).

**Cost, the worked example** (one airport pair: a 182-day window, 10–21 nights, so D = 182 and 12 stays):

| Step | Arithmetic | Per pair | Four pairs |
|---|---|---|---|
| Cells wanted | 182 × 12 | 2,184 | 8,736 |
| Floor if every grid cell were wanted | ⌈2,184 / 49⌉ | 45 views | 180 |
| Blocks on the lattice | ⌈182 / 7⌉ × ⌈(7 + 21 − 10) / 7⌉ = 26 × 3 | 78 views (3,822 grid cells, 2,184 stored, 57%) | 312 |
| Moves on the path | 2 (first column) + 25 × 4 (right, up, down, down) | 102 | 408 |
| Pages at 30 scrolls a page | each new page opens its block directly, replacing one move: 102 − (P − 1) ≤ 30 P gives P = 4 | 4 pages, 99 scrolls | 16 pages, 396 scrolls |
| Time | 4 × ~60 s (load, settle, two clicks) + 99 × ~8 s (3 s spacing, settle, read) | ~1,030 s (17 min) | ~70 min |
| Against the caps | 16 pages of the 100 a run; weekly, ~70 of the 1,500 a month | | |

`list` mode for comparison: 2,184 pages a pair, 8,736 for the four, so about 88 runs at 100 pages a run. The figures
assume a scroll moves one whole block (7 days) along one axis. If Task 15.1 measures a smaller step `s`, a block-to-
block move costs `⌈7 / s⌉` scrolls; the planner then compares, per move, `⌈7 / s⌉` scrolls against one new page load
(at the measured times) and takes the cheaper, and Task 15.1's commit restates this table from the measured step and
times before Task 15.3 starts.

## 7. Library and tool notes

- Cell names come from `getByRole('button', { name: /^£/ })` inside the panel (recording 2: the 49 buttons are the
  panel's, not the grid's; the empty `grid "Date grid"` is checked present, exactly one), each through the driver's
  `nameOf` (`aria-label`, else text), every read with its own timeout. The header, footer and
  selected-pair lines come from `getByText(pattern)` inside the panel. The printed snapshot is used only as the settle's
  comparison, hashed in memory; the provider path never stores or parses it (a rules test pins `ariaSnapshot` to the
  shared settle module and the recorder).
- The Dates panel is the first visible `tabpanel` in the dialog (`panelOf`), as the exploration read it.
- Playwright's `getByRole('grid')` matches ARIA `grid`; the buttons inside are found by role, never by CSS.

## 8. Files

- `apps/camoufox-worker/src/gridNames.ts` (new): the dated cell pattern, the header, footer and selected-pair patterns,
  the month-token table, the year rule. Pure. Joins the mutation run and the 100% safety floor.
- `apps/camoufox-worker/src/gridView.ts` (new): reads one settled view into a `GridView` (locators only).
- `apps/camoufox-worker/src/dialogSettle.ts` (new): `settle`, `panelOf`, `readCells`, moved out of `graph.ts`, which
  then imports them; the only module besides the recorder that calls `ariaSnapshot`.
- `apps/camoufox-worker/src/gridPage.ts` (new): the grid page flow under the page budget, the scroll spacing and cap.
- `apps/camoufox-worker/src/session.ts`, `server.ts`, `selectors.ts` (the dialog's names, `GRID_MOVES`, `SCROLL_STEP_DAYS`,
  `GRID_VERIFIED` with its proof), `config.ts`, `recordArgs.ts`, `record.ts` (`--grid`, `--moves`).
- `packages/core/src/camoufox/protocol.ts`, `ports/provider.ts`, `types/provenance.ts`, `labels/source.ts`,
  `config/schema.ts`, `api-contract/*` (provenance fields).
- `packages/db/drizzle/0006_grid_return_source.sql`, `meta/0006_snapshot.json`, `src/schema/calendarPrices.ts`,
  `src/schema/providerRequests.ts`, the repositories that write and read them.
- `packages/providers/src/camoufox/grid.ts` (new), `tiles.ts`, `answer.ts`, `limits.ts`, `provider.ts`.
- `packages/engine/src/estimate.ts`, `budgetFit.ts`, `stages/*` (the grid tile's issues).
- `apps/web/src/**` (the provenance line's return-date source and the vendor's mark).
- `docs/setup.md` §14, `docs/providers.md`, `docs/scheduling.md` (generated rows).
- Tests beside each, and `apps/camoufox-worker/test/support/gridTree.ts` (the synthetic grid builder).

## 9. What the worker recognises in grid mode, and what is verified

The WP14 classifier and its order are unchanged and run on every poll of every settle. Grid mode adds, after a page
classified `results` and settled on the Best view:

| Step | Rule | Evidence | On failure |
|---|---|---|---|
| Open | exactly one `button` named "Price graph" in the main frame; click; a dialog appears | exploration 1 | not found: `unrecognised` (1 h) |
| Dates | exactly one `tab` named "Dates" in that dialog; click; settle the first visible `tabpanel` | exploration 2 | not found: `unrecognised` (1 h); not settled: `not-ready` |
| View | the panel holds one `grid "Date grid"`, 49 `button`s named from "£", a departures line of seven day labels, a returns line of seven day labels ending "Return", and a selected-pair line | exploration 2 | anything else: `unrecognised` (1 h) |
| First view | its selected cell (", selected") is the query's own pair, and the header and footer are the query's dates ± 3 | exploration 2 | `unrecognised` (1 h) |
| Move | exactly one `button` named "Scroll left", "Scroll right", "Scroll up" or "Scroll down"; click; settle; the header or footer moved as `GRID_MOVES` says | exploration 2 (names); Task 15.1 (axes, step) | not found: `unrecognised`; not settled: the page ends `scroll-not-settled` |

`GRID_VERIFIED` flips only in the commit that adds the `--grid` recording proving every row above, including the move
axes and step (`GRID_MOVES`, `SCROLL_STEP_DAYS`), with `PROOFS` naming it.

**The cell grammar** (`gridNames.ts`, `GRID_GRAMMAR_VERSION = '2026-10-18'`):

```
^£(?<price>[1-9]\d{0,2}(?:,\d{3})*)(?<cheapest>, cheapest price)?, (?<dd>\d{1,2}) (?<dm><MON>) to (?<rd>\d{1,2}) (?<rm><MON>)(?<selected>, selected)?$
```

`<MON>` is the month-token table, which holds only the tokens recordings have shown ("Mar" on 2026-10-18; Task 15.1
adds the others its moves cross). A token not in the table makes the cell unparsed. The price is whole pounds (the grid
states no pence): `amountMinor = pounds × 100`.

- **Departures and returns lines.** One text node each (recording 2): every match of
  `\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (<MON>)\b` in the line, which must be exactly seven consecutive dates in
  order; other tokens (the "0000" glyph run) are ignored; the returns line ends with "Return". The departures line is
  the one before the first cell button, the returns line the one after the last.
- **Year.** The selected-pair line (observed `^(\d{1,2}) – (\d{1,2}) (<MON>) (\d{4})£`; the two-month and two-year forms
  are hypotheses Task 15.1 records) gives the year of the query's own pair, which must equal the query's. Every other
  `<d> <Mon>` on the view takes the year, of that one and its neighbours, that puts the date nearest the block the
  planner expects; the header's weekday must then agree with the computed date. So a block across 31 December rolls over
  ("Thu 30 Dec … Wed 5 Jan" is 2027-12-30 … 2028-01-05), and a wrong year is caught by the weekday.
- **Each cell.** Its departure is one of the header's seven dates, its return one of the footer's, the departure is
  before the return; across the view, the 49 cells are exactly the header × footer pairs, each once. A cell that fails is
  `unparsed` (counted on the view), never guessed; a view whose header, footer or year cannot be read is `unrecognised`.
- **Flags.** ", cheapest price" sets `vendorMarkedCheapest`; ", selected" is checked on the first view and not stored.
- **Currency.** The results page's "Currency GBP" control (list mode's `currencyName` check) is read before the Price
  graph click; any other currency is `unrecognised`; every cell's `£` is part of the grammar.

## 10. Tasks

Conventions as WP14 §10: fixed clocks, the fake timers, no casts, every case written in full, `expect.hasAssertions()`
in a `beforeEach`, failing first. Synthetic trees only, built by `test/support/gridTree.ts` exactly in recording 2's
shape:

```ts
gridTree({ depart: '2027-03-11', ret: '2027-03-21', year: 2027, prices?: (d, r) => number | null,
           cheapest?: Array<[IsoDate, IsoDate]>, selected?: [IsoDate, IsoDate], cellsInGrid?: boolean })
// cellsInGrid: true nests the buttons inside the grid instead (the reader must find them either way)
// → dialog "Price insights" > tablist (tab "Dates" selected, tab "Price graph"), text "10-day trip",
//   button "Reduce your stay by one day", button "Extend your stay by one day",
//   tabpanel "Dates" > img, text "Cheapest Compared with other prices shown Departure", button "Scroll left",
//   button "Scroll right", grid "Date grid" (empty), text "0000 Thu 11 Mar … Wed 17 Mar",
//   49 sibling buttons "£457, 11 Mar to 21 Mar" … in rows of one return, text "Sun 21 Mar … Sat 27 Mar 0000 Return",
//   button "Scroll up", button "Scroll down", text "14 – 24 Mar 2027£462 · Round trip";
//   then (outside the panel) buttons "Cancel", "OK"
```

### Task 15.1: The recorder's `--grid`, then the recording (first failing test)

**Files:** `recordArgs.ts`, `record.ts`, `dialogSettle.ts`, `graph.ts`, their tests.

- [ ] **Step 1: Failing tests** (`record.test.ts`, `describe('record --grid')`):
  - `parseRecordArgs([...Q, '--grid'])` is `{ kind: 'grid', moves: ['right', 'down', 'left', 'up'] }`; `--moves
    right,right` is accepted; a move outside the four, more than `CAMOUFOX_GRID_SCROLL_CAP` moves, or `--grid` with
    another mode flag is refused (EX_CONFIG) before any launch. The old `--grid` refusal test is replaced.
  - On a `gridTree` page: the clicks are exactly `button:Price graph`, `tab:Dates`, then one `button:Scroll <dir>` per
    move, each at least 3 s after the last (fake timers: the sleeps); each view is settled by two stable polls and its
    header, footer, selected line and 49 names are recorded to `fixtures/recorded/grid/<date>/<n>.json`, 0600 in 0700
    directories, queries stripped, scanned for an account name and an e-mail address.
  - A scroll whose view never holds still is recorded as `{ step, reason, timedOut }` and the file is still written; a
    challenge on any poll is that stop, with its cool-down, and nothing is written but the stop record.
  - `SOCS` is set before the page and read back after it by value; the account-cookie refusal, the guard and the pacer
    apply (the WP14 recorder's tests run for `--grid` too through `it.each`).
- [ ] **Step 2: Implement.** Move `settle`, `panelOf` and `readCells` from `graph.ts` to `dialogSettle.ts`; `graph.ts`
  imports them; `--graph-explore` keeps its behaviour and tests.
- [ ] **Step 3: The operator records** (the controller runs these; the implementer never loads a Google page):

```bash
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-14 --return 2027-03-24 --grid
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-03-28 --return 2027-04-07 --grid --moves right,right,down
pnpm --filter @gmt/camoufox-worker record --origin LHR --destination JFK --depart 2027-12-27 --return 2028-01-06 --grid --moves right
pnpm --filter @gmt/camoufox-worker recordings:backup
mv apps/camoufox-worker/fixtures/recorded/graph-explore/2026-10-18/2.json apps/camoufox-worker/fixtures/recorded/grid/2026-10-18/0-explore.json
```

  (a same-month pair with one move each way; a two-month pair crossing into April; a two-year pair, if the sale window
  reaches it, else the latest the window allows).
- [ ] **Step 4: From the recordings**, write `GRID_MOVES` (each button's axis and day step), `SCROLL_STEP_DAYS`, the
  header and footer node split, the month tokens seen, the selected-line forms, and restate §6's cost table from the
  measured step and times. Commit with the recordings' dates named; `GRID_VERIFIED` stays false until Task 15.4.

### Task 15.2: The cell grammar and the view reader

**Files:** `gridNames.ts`, `gridView.ts`, `test/gridNames.test.ts`, `test/gridView.test.ts`, `recorded.test.ts`.

- [ ] **Step 1: Failing tests.**
  - The three observed forms parse: `"£457, 11 Mar to 21 Mar"` → 45 700, 2027-03-11 to 2027-03-21, not marked;
    `"£397, cheapest price, 15 Mar to 23 Mar"` → marked; `"£462, 14 Mar to 24 Mar, selected"` → selected. The marks
    out of their recorded places (`"£397, 15 Mar to 23 Mar, cheapest price"`, `"£462, selected, 14 Mar to 24 Mar"`) are
    unparsed. `"£1,204, 2 Apr to 12 Apr"` → 120 400 once "Apr" is in the table, unparsed before.
  - Unparsed, counted, never guessed: a price without `£`, a price of `£0`, a missing "to", a token not in the table, a
    day 32, a cell whose departure is not in the header, a return not in the footer, a return on or before the departure,
    a duplicate pair, a view with 48 cells.
  - Year and rollover: a view planned at 2027-12-27 with header "Mon 27 Dec … Sun 2 Jan" reads 2027-12-27 …
    2028-01-02; the same header with a weekday one day off is `unrecognised`; a selected line whose year is not the
    query's is `unrecognised`.
  - The view reader on `gridTree` (buttons as the panel's siblings, and nested in the grid): `departures`, `returns`,
    49 `cells`, `unparsed` 0; with one reworded cell, 48 and 1; with the "0000" glyph run moved or absent, the same.
  - The recorded suite (`recorded.test.ts`, kind `grid`, skipped visibly when absent, decision 61): every recorded name
    parses; each view's cells are exactly its header × footer; the first view's selected cell is the query's pair;
    `0-explore.json` (the renamed exploration) is read for its 49 names only.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.3: The planner (pure)

**Files:** `packages/providers/src/camoufox/grid.ts`, `tiles.ts`, `test/camoufox/grid.test.ts`.

- [ ] **Step 1: Failing tests.**
  - The lattice: for a window of D departure days from `F` and nights `[m, M]`, column `c` holds departures
    `F + 7c … F + 7c + 6`; its blocks start at returns `F + m + 7c + 7k` for `k = 0 … ⌈(7 + M − m) / 7⌉ − 1`. The worked
    example gives 26 × 3 = 78 blocks, and every one of its 2,184 cells lies in exactly one block (a partition test over
    `generateCells`).
  - The path: 102 moves for the worked example, the first column top to bottom, then right, up, down, down per column;
    every wanted block is a read view exactly once; transit views have `reads` false.
  - Pages: the cut gives 4 tiles of at most 30 moves (99 scrolls in all); each tile's `start` centres its first block
    (`d = a + 3`, `r = b + 3`); `coveredCells` are the read blocks' cells inside the window and nights, and the tiles'
    covered cells partition the pair's cells; `scrollCap` 0 gives one tile per block (78 pages, 0 scrolls).
  - Stay range: a 1–3-night band, a 7-night single stay (one block a column), a 10–21 band near a 31-December window;
    cells inside a block but outside the band are in no tile's `coveredCells`.
  - Re-plan: `q.cells` holding 5 resumable cells in two blocks plans only those blocks.
  - Determinism: the same query gives the same tiles; nothing reads a clock.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.4: The worker's grid page

**Files:** `gridPage.ts`, `session.ts`, `server.ts`, `selectors.ts`, `config.ts`, tests.

- [ ] **Step 1: Failing tests** (fake page and context, `gridTree`):
  - A grid request with `GRID_VERIFIED` false, or `CAMOUFOX_MODE=list`, is 409 `mode-unavailable`, no page opened.
  - The happy path: one page load at the start block's URL, `SOCS` set before it and read back by value after the whole
    interaction, the Price graph and Dates clicks, each move after at least the scroll spacing (start to start), every
    view settled by two stable polls and classified on every poll, `reads` honoured; the answer is `grid` with the read
    views, `scrolls` equal to the moves made, `ended: 'complete'`.
  - Stops: a challenge, consent page, sign-in, signed-in control or off-allowlist hop on any poll after any click is
    that `blocked` answer with its cool-down, and no view is returned; a `SOCS` changed by a scroll is
    `consent-unhandled` and wipes the profile.
  - A scroll whose view never holds still ends the page `scroll-not-settled` with the views read so far; no cool-down.
  - A move whose button is missing, or a view that moved on the wrong axis, is `unrecognised` (1 h).
  - More moves than `CAMOUFOX_GRID_SCROLL_CAP` is 400 before any page; the whole call ends within its bound (fake timers).
  - The pacer is released on every path; the next page waits the 30 s page spacing from this page's start, whatever the
    scrolls took.
- [ ] **Step 2: Implement; run.**
- [ ] **Step 3: Set `GRID_VERIFIED`** with `PROOFS` naming Task 15.1's recordings, in the commit whose recorded suite
  proves every row of §9; commit.

### Task 15.5: Core

**Files:** `protocol.ts`, `ports/provider.ts`, `types/provenance.ts`, `labels/source.ts`, `config/schema.ts`,
`api-contract/*`, tests.

- [ ] **Step 1: Failing tests.** The grid request and answer schemas accept the shapes of §5 and refuse: `reads` of the
  wrong length, a move outside the four, a cell with a return on or before its departure, a view of more than 49 cells.
  `sourceLabel` gives the two camoufox labels by `returnDateSource`. The config accepts `CAMOUFOX_MODE=grid`, the
  spacing 3–30 and the cap 0–60, and refuses a spacing under 3. `Provenance.returnDateSource` is required on every
  price the API returns.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.6: db: migration 0006

**Files:** `packages/db/drizzle/0006_grid_return_source.sql`, its snapshot, the schema and repositories, tests.

- [ ] **Step 1: Failing tests.**
  - Migrating a database at 0005 holding rows of every provider backfills `return_date_source` `asked` for camoufox and
    `vendor` for the rest, and leaves `vendor_marked_cheapest` and `scroll_count` NULL.
  - The CHECKs: `return_date_source ∈ vendor | asked | grid-cell` and NOT NULL; `grid-cell` only with provider
    `camoufox`; `vendor_marked_cheapest` NULL or 0/1; `scroll_count` NULL or an integer ≥ 0, and NULL unless provider
    `camoufox`.
  - A camoufox grid page writes one `provider_requests` row with its `scroll_count`; the page caps (`provider-month`,
    `provider-execution`) count that one row, never the scrolls.
- [ ] **Step 2: Implement** (rebuild the two tables as 0005 did, foreign keys off around the run and
  `foreign_key_check` after; do not regenerate); run; commit.

### Task 15.7: The adapter

**Files:** `packages/providers/src/camoufox/{provider,tiles,answer,limits}.ts`, tests.

- [ ] **Step 1: Failing tests** (msw, the providers harness):
  - With `mode: 'grid'` the discovery capability plans `planGridTiles` tiles; one worker call per tile, sent with the
    tile's timeout; the request body is the tile's `grid-path`.
  - The answer maps each read view's priced cells inside `coveredCells` to `RawCalendarPrice` rows with
    `returnDateSource: 'grid-cell'`, `vendorMarkedCheapest` from the cell, `fetchedAt` from the answer, GBP; cells
    outside `coveredCells` are dropped and counted in `notes`; a covered cell on a read view with no parsed cell is a
    cell issue (`offers-dropped`); covered cells of views not reached (`scroll-not-settled`) are issues with detail
    `page-not-ready`; a cell read twice is an in-tile conflict and throws.
  - `scrolls` reaches the ledger row's `scroll_count` through `finalise`.
  - `blocked`, `cooling-down`, `spacing`, `not-ready`, `browser-error` map exactly as in list mode.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.8: Engine: estimate, budget fit, resume

- [ ] **Step 1: Failing tests.** The estimate for the worked example in grid mode says 16 pages, 396 scrolls and about
  70 minutes, and that a full pass fits one run; `budgetFit` counts pages, not scrolls; a resume after a
  `scroll-not-settled` page re-plans only the blocks with resumable cells (decision 50: priced cells never re-fetched);
  a blocked grid page disables the provider for the run exactly as in list mode.
- [ ] **Step 2: Implement; run; commit.**

### Task 15.9: API and web

- [ ] **Step 1: Failing tests.** Every camoufox grid price renders "Google Flights date grid via Camoufox", its
  provenance line says "return date: read from the grid", and a cell Google marked shows "Google marks this its cheapest
  price" in the side panel, never as a badge of this app's own; list-mode prices keep "return date: the date asked
  for".
- [ ] **Step 2: Implement; run; commit.**

### Task 15.10: Operator docs

- [ ] Spec §12's block and `.env.example` together (the envExample test holds them equal): `CAMOUFOX_MODE` (now offered,
  `list` or `grid`, so it leaves `NOT_OPERATOR`), `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS=3`, `CAMOUFOX_GRID_SCROLL_CAP=30`.
- [ ] `docs/setup.md` §14: turning grid mode on (`CAMOUFOX_MODE=grid` in `worker.env`, the two grid settings on both
  sides), what a grid page does (one load, two clicks, scrolls at the spacing), the coverage paragraph and cost table of
  §6 from the measured figures, and that a stop discards the whole page. `docs/providers.md`: the camoufox row and
  section. `docs/scheduling.md` regenerated. A docs test asserts the figures equal the estimate's output.

### Task 15.11: Rules tests and smoke rows

- [ ] Rules (`rules.test.ts`, compiler API): `ariaSnapshot` is called only in `dialogSettle.ts` and the recorder; the
  only buttons the grid flow clicks are the dialog's named ones (Price graph, Dates, the four scrolls); every scroll
  delay is a plain name or number (never randomised); the grid flow sets no cookie.
- [ ] Smoke (`smoke:live` checklist): one grid page with one move, its row's `scroll_count` 1, its prices labelled
  "Google Flights date grid via Camoufox", `SOCS` same.

## 11. Pinned review-focus tests

- A cell is stored only when its own departure is in the header, its return in the footer, and the departure precedes
  the return; the view is exactly the header × footer; anything else is counted unparsed (Task 15.2).
- A wrong year is caught by the header's weekday; a block across 31 December rolls over (Task 15.2).
- Grid cells outside the window or the nights are never stored (Tasks 15.3, 15.7).
- Every stored price records its return-date source; existing rows are backfilled (Task 15.6).
- Google's "cheapest price" mark is stored as Google's and never used as this app's minimum (Tasks 15.7, 15.9).
- One ledger row per page; the page caps never count scrolls (Task 15.6).
- Every view is settled by two stable polls and classified on every poll; any stop discards the page and keeps its
  cool-down (Task 15.4).
- Scroll clicks keep their fixed spacing and the per-page cap; the page spacing is unchanged (Task 15.4).
- Grid mode stays refused until `GRID_VERIFIED` (Tasks 15.4, 15.5).

## 12. Definition of done

- The worker's tests pass with their floors (90/80/90/90; 100 lines and branches for the safety modules, `gridNames.ts`
  added); `pnpm --filter @gmt/camoufox-worker mutate` passes with `gridNames.ts` in the run; the recorded `grid` suite
  passes where the recordings are present and is reported skipped with the decision-61 suffix where they are not.
- `@gmt/core` at 100%; `@gmt/db`, `@gmt/providers`, `@gmt/engine`, `@gmt/api`, `@gmt/web` with their thresholds;
  `pnpm test`, `pnpm lint`, `pnpm -r typecheck`, `check-boundaries`, `check-casts`, the wording test and
  `pnpm secret-scan` clean.
- Migration 0006 applies to a copy of the operator's database, and `PRAGMA foreign_key_check` prints nothing.
- `git ls-files apps/camoufox-worker/fixtures/recorded` prints only `.gitkeep` files.
- On the operator's Mac: one grid page of the worked example with its planned moves prices every covered cell or names
  why, with `SOCS` same and the row's `scroll_count` equal to the moves; the smoke rows read `ok`.
- §6's cost table restated from the measured step and times in Task 15.1's commit and in `docs/setup.md`.
- Every task's checkbox ticked.

## 13. For the plan (not yet recorded there)

Decision 70 records the rulings. Items for Fable:

1. **Contracts:** `GridMove`, the `grid-path` `TileRequest`, `ReturnDateSource`, `Provenance.returnDateSource` and
   `vendorMarkedCheapest`, `RawCalendarPrice.returnDateSource`, the grid request and answer schemas and
   `gridRequestTimeoutMs` belong in the plan's contract blocks.
2. **The scroll step** is a dated constant from Task 15.1; if it is not one block, §6's arithmetic and spec §2's
   coverage paragraph are restated before Task 15.3.
3. **"Date grid" on the results page** may open the same panel in one click; if Task 15.1's recording shows it, a later
   change may use it in place of Price graph then Dates (one click fewer a page), with its own proof.
4. **An unpriced cell** (Google's dash, or a cell past the sale window) is unparsed until a recording shows it; then it
   maps to `no_data`, as spec §2 says.
5. **Re-dating** the grid's names after a Google change is part of WP14's standing maintenance task.

## 14. Open questions

- The scroll buttons' axes and step (Task 15.1 measures them; the design assumes one block along one axis each, left and
  right on departures and up and down on returns, as their places in recording 2 suggest).
- The two-month and two-year forms of the selected-pair line, and the month tokens beyond "Mar" (Task 15.1 records
  them; until then a cell naming an unrecorded token is unparsed).
- What "0000" in the departures and returns lines is (a glyph run in recording 2); the reader ignores tokens that are not
  day labels, so it does not matter unless it changes the labels.
