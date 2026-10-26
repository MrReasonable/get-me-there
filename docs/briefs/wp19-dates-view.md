---
wp: 19
title: The Dates view (the date-pair board and overview, the date pair detail, the two-tier nav)
owner: opus
depends_on: [18]
spec_sections: ["§1", "§6.5", "§6.6", "§8.3", "§9 items 1, 4, 5, 6", "§10 GET /definitions/:id/date-pairs", "§10 /results scope parameters", "§10 Routes the Dates view retires", "§11 layout and nav", "§11 URLs", "§11 Dates", "§11 Date pair detail", "§16", "§17 revisions 48 and 50"]
reviewers: [code-architect, test-strategy-reviewer, ui-reviewer, provenance-auditor, data-model-reviewer, search-strategy-reviewer]
mutate: {"@gmt/core": ["src/datePairs/space.ts", "src/datePairs/figure.ts", "src/datePairs/rank.ts", "src/datePairs/bands.ts", "src/datePairs/encode.ts", "src/datePairs/decode.ts", "src/datePairs/detailLink.ts", "src/api-contract/datePairs.ts"], "@gmt/web": ["src/state/parse.ts", "src/state/datesState.ts", "src/views/Dates/board.ts", "src/views/Dates/howFar.ts", "src/views/Dates/stayScope.ts", "src/views/Dates/refresh.ts", "src/views/Dates/shade.ts", "src/views/Dates/overview.ts", "src/views/Dates/keys.ts", "src/state/landing.ts"]}
pending: {}
status: reviewed
---

# WP19: The Dates view (the date-pair board and overview, the date pair detail, the two-tier nav)

Written 2026-10-26 against spec revision 48 (main `1d568c01`), Ian's confirmed design brief of the same day (shaped
after that day's critique of the web UI) and his rulings on revision 48's draft ("Ian ruled 2026-10-26" in §17).
Revised the same day after the core roster's review (89 findings: 19 High, 51 Medium, 19 Low; every one answered in
the text below), Ian's two further rulings and the orchestrator's settlements, all of which Task 19.0 records as spec
revision 50 (revision 49 is PR #28's grid-cells change, which merges first; the build rebases onto main before it
starts). Revised again after the quick re-review of `d43004b1` (20 findings: 9 Medium, 11 Low; each answered in
the text) and Ian's confirmation of four review settlements. WP18 is merged.

This package makes the first screen answer which dates to fly: a ranked board of date pairs, each priced by the
figure chosen across the airport pairs in scope, with an overview of months beneath it; Results becomes that date
pair's detail; Calendar, Duration and Coverage go, and nothing they held that still matters is lost (spec §17
revision 48, "Moved from the retired views"). Where this brief names a rule "revision 50", Task 19.0 writes it into
the spec in the same PR, and the spec text then wins as usual.

The tasks follow the form of the WP17 and WP18 briefs: each names its failing tests first, in full where the test's
data is the rule (the core tables), and as exact assertions where it is a component; the run commands and the expected
failure are stated for every task.

**Briefs this one supersedes.** The work briefs are historical records (`docs/briefs/README.md`) and none is edited.
Where they describe the retired views as current, this brief wins (spec §17 revision 48):

- **WP8** (`wp08-api.md`): Task 8.12's calendar route (`GET /definitions/:id/calendar` with `destination`) and
  duration-analysis route, their contract schemas and read modules; §4 and §5's lines for them. The coverage route,
  the calendar-gap route and the cell route of Task 8.12 stay.
- **WP9** (`wp09-web-shell-definitions-results.md`): Task 9.4's view list and the Results default (`parseView`); Task
  9.5's one-tier nav; Task 9.8's View A as a view in the nav and the default view; Task 9.10's View D Coverage as a
  view (its content moves into the Dates view's coverage section); Task 9.9's calendar-gap banner placement (it moves
  to the Dates header and its cells are marked in the detail).
- **WP10** (`wp10-web-calendar-duration-history.md`): Tasks 10.4–10.8 (the Calendar view: day display, scale, grid,
  side panel, view), Task 10.10 (Duration), Task 10.12's wiring of those views, and Task 10.13's Playwright smoke.
  Task 10.11 (History) stays; Task 10.9's TZ suite stays, rewritten for the Dates view (Task 19.8).
- **WP11** (`wp11-alerts-email.md`): §5's `appRowLink` signature and its `?view=results&def=…&basis=…&row=…` form
  (the results-row link), and Task 11.2's link assertion.
- **WP18** (`wp18-status.md`): Task 18.6's link from a search's `data` card to the Coverage view (it now opens the
  Dates view with its coverage section open).

The plan's file map and its WP9 and WP10 sections yield to spec revisions 48 and 50 where they differ.

## 0. Standing rules for the implementer

- **No `as`** except `as const` and `satisfies`; brands only through `core`'s helpers or zod; `node scripts/check-casts.mjs`
  passes. Tests are type-checked through each package's `tsconfig.test.json`.
- **TDD**: the failing test first, run it and see it fail for the stated reason, then the least code, then green.
- **Event-driven tests**: no sleeps, fixed delays or poll-until loops. Wait on an event (a promise from the code under
  test, a rendered element through Testing Library's `findBy…`, a User Timing mark through `waitForFunction`), with a
  timeout only as a backstop. The 30 s re-read, the 200 ms transition and every clock read go through an injected
  clock or `vi.useFakeTimers()`.
- **Package-scoped tests while iterating** (`pnpm --filter @gmt/<pkg> exec vitest run <path>`); the whole `pnpm test`
  only before a push.
- **Stryker scoped**: `pnpm --filter @gmt/<pkg> exec stryker run --mutate <file> --concurrency 2` while iterating;
  the full package run only for the definition of done.
- **Orphans**: after every vitest, Stryker or Playwright run, `pgrep -fl 'vitest|stryker|playwright|chrom'` and stop
  anything left from that run before the next.
- **Public wording**: code, comments, docs, test names and commit messages follow the project's public wording
  ruling (the words `scripts/wording.test.mjs` refuses, and nothing about how the browser provider's pages look to a
  site); commit messages stay neutral and name no vendor's site and no data-collection method. Before every push, run
  the wording test and grep the diff, including `git diff main...HEAD | grep -nP '\b[Bb][Oo][t](s?\b|[A-Z_-])'`.
- **The only example route** is London → New York (`LHR`, `LGW` → `JFK`, `EWR`; synthetic codes `AAA`, `BBB`).
  Every web and e2e fixture provenance is `providerId: 'fixture'`, `sourceKind: 'synthetic'` by default; a test that
  needs a price that is not synthetic (the synthetic banner's absent case, Task 19.4) overrides it with a real
  provider's shape (`provCached`, `provSearched` in `test/fixtures.dates.ts`); no fixture reads `fixtures/recorded`.
- **Commits**: plain fix commits are fine (the PR lands by squash-merge; no fixups or history rewrites needed). Every
  commit ends with the trailer `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`. Never a bare
  `git stash`.
- **CodeRabbit**: count the PR's changed files (`git diff --name-only main...HEAD | wc -l`). At 150 or fewer the
  CodeRabbit app reviews the PR; above 150 run the CodeRabbit CLI locally and say so in the PR. Before the merge, read
  the app's inline threads and its outside-diff list, fix each, push, and resolve each thread.
- **Ported tests**: before Task 19.8 deletes a test file, the PR description carries a table mapping each deleted
  `it(…)` title to the test that now holds its rule, or to the line of spec revision 48 that dropped the rule.

## 1. Goal

`GET /api/definitions/:id/date-pairs` returns every date pair of the current resolved space with its buckets,
verification counts and figure over the airport pairs in scope, honestly filtered, bounded and read through a fixed
number of grouped statements; the web's default view ranks those figures on a "Best dates" board and shades them on
an overview of months, each price through `PriceCell` with its provenance and each gap in words; a board row, an
overview cell or an alert email opens the date pair detail (Results scoped to one date pair, with per-airport-pair
panels); the nav has two tiers; and the old view URLs land on Dates.

## 2. Scope

**In**

- **Spec revision 50** (Task 19.0), written in this PR.
- `core`: the date-pair space arithmetic, `datePairsQuerySchema` and `datePairsResponseSchema` with their refinement,
  `encodeDatePairs` and `decodeDatePairs`, the figure precedence (`pickFigure`, `figuresByDatePair`),
  `rankDatePairs`, `bestPerWeek`, `foldNights`, the detail link's query (`detailLinkQuery`); the barrel exports;
  Stryker entries for each.
- `db`: the grouped reads the routes need (§5), each one statement, reworked in place where a method already exists,
  so no read route issues a statement per cell, per past execution, per child or per itinerary;
  `latestVerificationOutcomeForCell` gains the provider tie-break.
- `api`: the date-pairs route with Hono's `compress` on that route alone, its 422s, the 50,000-cell bound; `/results`'
  scope parameters (date pair, airports, journey limit) and its `datePairFigure`; one shared scope parser and one
  per-cell classification (`classifyCells`, summed by `summariseCells`) behind every coverage summary the api sends:
  the date-pairs route, `/results` (scoped, unscoped and `?executionId=`) and the coverage route's summary (revision
  50, settled by the orchestrator; the coverage route's per-stage × provider breakdown stays run-scoped as it is);
  `pick.ts` delegating to `core`; removal of the calendar and
  duration-analysis routes, schemas, read modules and tests, with their rules ported first.
- `engine`: the alert email's POST-booking link through `core`'s `detailLinkQuery` (§8.3).
- `web`: the Dates view (header line, calendar-gap banner, filters, board with its week switch and update button,
  overview with legend, readout, rings, folded bands, keyboard and touch, coverage section, phone layout, every state);
  Results as the date pair detail with per-airport-pair panels and "Back to dates"; the two-tier nav; the `?view=`
  landing rules; the status bar's progress link and the Status `data` card's link; removal of the Calendar, Duration
  and Coverage views; Stryker for the web's pure-logic files (revision 50, settled by the orchestrator).
- The Playwright smoke rewritten for the Dates view (desktop and 375 px) and the performance test.
- Docs: `docs/setup.md` ("Verify in the calendar", "in View D") and `apps/web/PRODUCT.md` (views, success line,
  desk-use line, the coverage unit, the alert email line).

**Out**

- The overview's shading colours beyond the existing palette, the wording of "how far checked" beyond the spec's
  words ("verified · cabin only" included), the board's default row count beyond 10, typography and any other visual
  system change: the later design steps (colorize, clarify, typeset, polish; spec §17 revision 48 item 7). The spec's
  own rules for each (one scale, the numeric legend, no colour-only meaning, the banned words, the "verified" rule, 10
  rows then "Show 10 more") are in scope.
- An arrival-time filter: Ian removed the arrival window from his search (revision 50, settled by the orchestrator);
  arrival times are shown where the figure's own data carries them, and nothing filters on them.
- Restoring filters from browser storage on a bare link: the filters live in the URL (§11) and travel with every nav
  link (Task 19.7); a board filtered by settings the link did not carry would show a narrower answer than the operator
  asked for, so a bare `?view=dates` shows the unfiltered board.
- `PriceCell`, `Provenance` and `ClassBadge` beyond using them (WP9 owns them; this package adds no second price
  renderer, and adds a prop only where a face it needs is missing).
- The estimate and budget surfaces, and the status bar beyond its progress link and its Run now on Dates (WP9, WP18).
- The coverage route's per-stage × provider breakdown, its error list and its on-demand list, and the cell route
  (WP8; read here as they are). Only the coverage route's summary changes (In, above).
- History beyond its nav place and one test's retired-route assertion (WP10 Task 10.11).
- Alerts rules, digests and their wording beyond the link (WP11).
- Any change to discovery, selection, verification or the engine's runs (WP7); the providers (WP5, WP6, WP14, WP15).
- The status report (WP18) beyond the `data` card's link.
- Windows, CI matrix changes other than the mutation workflow's web shard and the `e2e` job (WP16b, WP17).

## 3. Spec sections

- **§1**: success is stated through the Dates view: name the cheapest acceptable date pair and how far it was checked.
- **§6.5**: `/results` reads the whole space or one date pair's cells across the airport pairs in scope; sorting and
  filtering stay client-side.
- **§6.6**: the six buckets, the roll-up precedence a date pair's mark uses across its airport pairs, "selected but
  not reached" (`selected ∧ (not_run ∨ skipped:budget)`), "searched" only in the coverage section.
- **§8.3**: a POST booking's email link opens that row's date pair detail,
  `/?view=results&def=…&depart=…&return=…&basis=…&row=…`.
- **§9 items 1, 4, 5, 6**: the core tables and property tests, the engine link test, the route tests (honesty, bound,
  422s, query count, size), the web state, keyboard, provenance and phone tests, the Playwright smoke and the
  performance test; the mutation list (revision 50 adds the web's pure-logic files).
- **§10**: the date-pairs route and its shape, bounds and compression; `/results`' scope parameters; the retired
  routes.
- **§11**: the two-tier nav, the `?view=` rules, the Dates view top to bottom, the date pair detail, provenance on
  every price through `PriceCell`, accessibility.
- **§16**: work package 19, first failing test "a date pair priced only on a filtered-out airport pair has no figure".
- **§17 revision 48**: Ian's decisions and rulings, what moved and what was dropped, the briefs and documents to align.
- **§17 revision 50** (Task 19.0): the rulings, settlements and shape fixes listed there.

Plan decisions carried: 36 (truncated "cheapest of the rows read"; its Phase 4 placement of the max journey filter is
superseded), 38 ("cached from £X", the flat scale under ten figures or a 10% spread), 52 (History reads the executions
list), 53 (a filter is honest: a filtered read equals a definition holding only those airports), 54 (superseded and
not-seen marks), 58 (minima picked over confirmed offers before dedup).

## 4. Interfaces consumed

From merged packages, unchanged unless a task says otherwise:

```ts
// @gmt/core
export function addDays(date: IsoDate, n: number): IsoDate;
export function daysBetween(a: IsoDate, b: IsoDate): number;
export function countCells(space: ResolvedSpace): number;   // clamps an expired window to 0
export function generateCells(space: ResolvedSpace): Cell[];   // origins sorted, destinations sorted, then day, then nights
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours' | 'maxAgeAssumed'>, now: IsoDateTime): EffectiveAge;
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;   // fresher first; unknown loses to known
export function worstCaseAgeHours(a: EffectiveAge): number;
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;
export function cellKeyString(c: CellKey): string;
export type Buckets = { priced; empty; no_data; error; skipped; not_run; reused };   // counts
export type ResolvedSpace;   // { origins, destinations, departureFrom, departureTo, minNights, maxNights }
export const priceCellSchema, coverageSummarySchema, executionSummarySchema, provenanceSchema, bucketsSchema,
  moneyPenceSchema, ageHoursSchema;
export type ResultRow;   // z.infer<typeof resultRowSchema>

// @gmt/api (apps/api/src/read)
export function loadRows(def: SearchDefinition, ports: Ports, executionIds?: readonly string[]): Loaded;  // reworked, Task 19.2
export function confirmedIn(loaded: Loaded): (r: ResultRow) => boolean;
export function chooseBasis(loaded: Loaded, requested: Basis | undefined): { basis: Basis; reason: string };
export function onDemandSearched(executions: readonly Execution[], ports: Ports, space: ResolvedSpace): Execution[];  // reworked, Task 19.2; deleted in Task 19.8 with its last callers (the calendar and duration reads)
export function coverageSummaryFor(latestParent, executions, ports, space): CoverageSummary;  // replaced by summariseCells, Task 19.2
export const SEARCHED: ReadonlySet<CellOutcomeStatus>;
export function currentSpace(def, today: IsoDate): ResolvedSpace;
export function cellInSpace(space: ResolvedSpace, cell: CellKey): boolean;
export function assembleCalendarGap(def, ports, engine): CalendarGapResponse;   // moved to read/calendarGap.ts, unchanged
export function assembleCellDetail(def, cell, ports, engine): CellDetailResponse;
export function assembleCoverage(def, ports, engine): CoverageResponse;

// @gmt/engine (packages/engine/src/alerts/templates.ts), changed by Task 19.3
export function appRowLink(appBaseUrl: string | null, definitionId: string, basis: ResultBasis, rowKey: string): string;

// @gmt/web
export function PriceCell(props: PriceCellProps): JSX.Element;   // the only price renderer; `compact`, `face`, `fullAge`
export function hrefWith(patch: Record<string, string | null>): string;   // keeps every other parameter
export function updateSearchParams(patch: Record<string, string | null>, mode?: 'push' | 'replace'): void;
export function navigateTo(patch: Record<string, string | null>): (e: NavClick) => void;
export function useSearchParams(): URLSearchParams;
export function useNow(): IsoDateTime;
export function useMediaQuery(q: string): boolean;
```

Moved, not rewritten (each with its existing tests ported beside it; the new tests cover only new behaviour):

- `views/Calendar/scale.ts`: `quintileBand`, `modeOf`, `buildScale`, `MIN_BANDED_DAYS`, `BAND_COLOURS`,
  `BAND_CLASSES`, `FLAT_CLASS`, `PRICELESS_CLASS` → `views/Dates/shade.ts` (decision 38's rank quintile with ties in one
  band, the integer 10% spread test, the merged numeric legend). `test/views/calendar/scale.test.ts`'s quintile, flat,
  invariant and band-colour cases → `test/views/dates/logic/shade.test.ts`.
- `views/Calendar/grid.ts`: `weeksOf`, `targetOf` and `sameDayOtherMonth` → `views/Dates/overview.ts` (month layout)
  and `views/Dates/keys.ts` (the month-crossing moves). `test/views/calendar/gridLogic.test.ts` →
  `test/views/dates/logic/keys.test.ts`.
- `views/Calendar/display.ts`: `GLYPH_ORDER` → `views/Dates/overview.ts` (the legend's mark order); its figure
  precedence → `core`'s `pickFigure` (Task 19.1).
- `views/Calendar/{CellPanel,PanelSections}.tsx` and `panel.ts` → `views/Results/{AirportPairPanel,PanelSections}.tsx`
  and `views/Results/panel.ts` (Task 19.6), with `test/views/calendar/panel.test.tsx` →
  `test/views/results/panel.test.tsx`.
- `views/Coverage/CoverageView.tsx`'s body → `views/Dates/CoverageSection.tsx` (as `CoverageBody`, which the folded
  `CoverageSection` renders when open), with `test/views/coverage.test.tsx` → `test/views/dates/coverageSection.test.tsx`.
  Until Task 19.8 deletes it, `CoverageView` renders `CoverageBody` whole; the Calendar view imports `shade.ts`,
  `keys.ts` (`targetOf`) and `overview.ts` (`weeksOf`, `GLYPH_ORDER`) from their new homes rather than keeping copies.
- `state/resultsState.ts`'s private `list`, `safeInt`, nights-range and sort-token parsers and its IATA list filter →
  `state/parse.ts`, used by `resultsState.ts` and `datesState.ts` (resultsState's tests stay the pin).

## 5. Interfaces produced

```ts
// packages/core/src/api-contract/datePairs.ts (beside results.ts; re-exported through api-contract/index.ts)
// The wire form of the query: every value a string, as Hono's c.req.query() gives it. The api parses and answers 422
// itself (revision 50: the route wrapper answers 400 for a schema failure, and §10 asks for 422 on these values).
export const datePairsQuerySchema = z.strictObject({
  origins: z.string().max(200).optional(),          // comma list
  destinations: z.string().max(200).optional(),     // comma list
  maxJourneyMinutes: z.string().max(10).optional(), // integer 60..6000
});
export const MIN_JOURNEY_LIMIT_MINUTES = 60;       // the journey limit's bounds, for parseScope's 422 and the web's
export const MAX_JOURNEY_LIMIT_MINUTES = 6000;     // "between 60 and 6000 minutes"; scope.maxJourneyMinutes is held to them
// re-exported from packages/core/src/space/limits.ts, the one home of the space's limits (below)
export { DEFAULT_MAX_CELLS, MAX_DATE_PAIRS } from '../space/limits.js';
export const datePairsResponseSchema;      // §10's shape with revision 50's columns (below), a z.strictObject with one
                                           // superRefine (one linear pass, no per-pair allocation)
export type DatePairsResponse = z.output<typeof datePairsResponseSchema>;
```

The response shape is §10's, with these element schemas and revision 50's additions:

- Every money column (`figures.pricePence`, `cheaperCached.pricePence`) is `moneyPenceSchema`; `figures.ageHours` and `notSeenInLatestAgeHours` use `ageHoursSchema`; `journeyMinutes` and every count and
  index column are non-negative integers.
- `pairs` gains `journeyLeftOut: number[]` (the airport pairs in scope with at least one figure-eligible price, every
  one of them left out for a known journey time above `maxJourneyMinutes`; figure-eligible means class `verified` and
  confirmed, or a calendar price; 0 everywhere when `scope.maxJourneyMinutes` is null) and `notReached: number[]` (the
  in-scope cells that are `selected ∧ (verification not_run ∨ skipped:budget)`, §6.6's "selected but not reached").
- The cheaper-cached price leaves `figures` for a sparse group `cheaperCached: { figure, pricePence, provenance, origin,
  destination, truncated, stale }`, one entry per verified figure that hides a cheaper current calendar price, `figure`
  an index into the figures columns (strictly ascending), `origin` and `destination` indices into `scope.origins` and
  `scope.destinations`, `stale` by the server's staleness rule (the same one the figure's `stale` uses). The local
  times are a sparse group `times: { figure, departOut, arriveOut, departBack, arriveBack }`, one entry per verified
  figure with at least one time: `arriveOut` and `arriveBack` the last outbound and last inbound segment's
  `arriveLocal`, `departOut` and `departBack` the first segment's `departLocal` of each direction (so the web can show
  the arrival's day offset), each as the source states it and null where it does not. Revision 50: as dense columns
  these ten put 36,400 date pairs at about 5 MiB, above §10's 4 MiB bound; sparse, the case measures about 3.5 MiB. The
  decoder's output is unchanged: every `DatePairFigure` carries `cheaperCached` and the four times, null where the
  groups have no entry. `figures` gains `fromEarlierSearch: boolean[]` (true when the figure's row was
  fetched by an execution created before the latest parent run, an earlier parent or an earlier on-demand search;
  false when the latest parent run or a later on-demand search fetched it, and false before any parent run; revision
  50, settled by the orchestrator).
- Every per-date-pair count (`selected`, `itinerarySearched`, `onDemand`, `unconfirmed`, `partiallyVerified`,
  `notReached`, `journeyLeftOut`, `reused`) counts **distinct in-scope cells**, never executions, offers or itineraries.

The refinement rejects, besides §10's rules: six buckets summing to anything but `scope.airportPairs` (revision 50:
never 0, see the classification in Task 19.2); `summary.buckets`, `summary.reused`, `summary.selected`,
`summary.itinerarySearched` and `summary.onDemand` differing from the column sums, or `summary.total` differing from
`scope.cells`; `scope.origins` or `scope.destinations` not sorted and unique; `scope.airportPairs` ≠ origins ×
destinations; `scope.cells` ≠ days × stays × airportPairs; days × stays > `MAX_DATE_PAIRS`; `scope.cells` above
`DEFAULT_MAX_CELLS`; `notReached` above `selected` for a pair; `journeyLeftOut` non-zero while `scope.maxJourneyMinutes`
is null; a sparse group's columns of different lengths, or its `figure` indices not strictly ascending or not naming a
figure; a cheaper-cached price or times on a calendar figure; a cheaper-cached price not below its figure's price; a
times entry holding no time; `truncated` true on a verified figure; money not integer pence.

```ts
// packages/core/src/api-contract/results.ts: resultsQuerySchema gains five strings, parsed by the api (all 422):
//   departureDate?: string; returnDate?: string; origins?: string; destinations?: string; maxJourneyMinutes?: string
// resultsResponseSchema gains:
//   datePairFigure: z.output<typeof datePairFigureSchema> | null   // only on a date-pair-scoped read: pickFigure over
//                                                                   // the scoped rows, the same figure the board shows
// datePairFigureSchema (in api-contract/datePairs.ts): a strict object with DatePairFigure's fields below, less
// `airportPair`, each provenance inline (provenanceSchema), money as moneyPenceSchema, refined by the board's per-figure
// rules (superseded and truncated only on a calendar figure, a not-seen age and a cheaper-cached price only on a verified
// one, the cheaper-cached price below the figure's); the codec test compares it with the board's decoded figure.

// packages/core/src/space/limits.ts (new; validate.ts's private MAX_WINDOW_DAYS and MAX_NIGHTS move here, and
// api-contract/datePairs.ts and config/schema.ts both import from it, so config never depends on api-contract)
export const MAX_WINDOW_DAYS = 400;
export const MAX_NIGHTS = 90;
export const DEFAULT_MAX_CELLS = 50_000;                         // §10's fixed bound; MAX_CELLS_PER_DEFINITION's default
export const MAX_DATE_PAIRS = MAX_WINDOW_DAYS * (MAX_NIGHTS + 1); // 36,400

// packages/core/src/space/generate.ts (the one home of the order and the clamp; generateCells and countCells use both)
export function windowDays(s: Pick<ResolvedSpace, 'departureFrom' | 'departureTo'>): number;  // max(0, daysBetween + 1)
export function sortedAirportPairs(origins: readonly Iata[], destinations: readonly Iata[]): Array<{ origin: Iata; destination: Iata }>;

// packages/core/src/datePairs/space.ts (imports windowDays and sortedAirportPairs; adds only the date-pair arithmetic)
export type DatePairSpace = Omit<ResolvedSpace, 'origins' | 'destinations'>;
export function stayCount(s: DatePairSpace): number;                  // max(0, maxNights − minNights + 1)
export function datePairCount(s: DatePairSpace): number;              // windowDays × stayCount
export function datePairAt(s: DatePairSpace, i: number): { departureDate: IsoDate; returnDate: IsoDate; nights: number; dayIndex: number };  // RangeError outside
export function datePairIndex(s: DatePairSpace, departureDate: IsoDate, returnDate: IsoDate): number | null; // null outside
export function datePairIndexer(s: DatePairSpace): (departureDate: IsoDate, returnDate: IsoDate) => number | null;
  // datePairIndex for many rows or cells over one space, each distinct date parsed once (figuresByDatePair and the api's
  // per-cell grouping use it)

// packages/core/src/datePairs/figure.ts
export type FigureCandidate = Pick<ResultRow,
  'cell' | 'verdictClass' | 'pricePence' | 'provenance' | 'stale' | 'ageHours' | 'truncated' | 'notSeenInLatest'
  | 'superseded' | 'totalMinutes' | 'outbound' | 'inbound' | 'itineraryHash' | 'calendarPriceId' | 'executionId'>;
export type Figure<T extends FigureCandidate> =
  | { basis: 'verified'; chosen: T; cheaperCached: T | null }
  | { basis: 'calendar'; chosen: T; cheaperCached: null };
export function pickVerifiedFigure<T extends FigureCandidate>(rows: readonly T[]): T | null; // seen, then fresh, then cheaper
export function pickCalendarFigure<T extends FigureCandidate>(rows: readonly T[]): T | null; // current before superseded, then cheapest
export function pickFigure<T extends FigureCandidate>(candidates: readonly T[], now: IsoDateTime): Figure<T> | null;
export interface FigureScope { space: ResolvedSpace /* airports already narrowed to the scope */; maxJourneyMinutes: number | null }
export function figuresByDatePair<T extends FigureCandidate>(candidates: readonly T[], scope: FigureScope, now: IsoDateTime):
  { figures: Map<number, Figure<T>>; journeyLeftOut: Map<number, number> };
  // keyed by date-pair index; journeyLeftOut holds only non-zero counts (read it with `.get(i) ?? 0`) and is empty
  // without a limit

// packages/core/src/datePairs/encode.ts and decode.ts (inverse pair; decode(encode(x)) deep-equals x)
export interface DatePairFigure {
  price: z.output<typeof priceCellSchema>;   // pricePence, provenance, stale, ageHours, truncated
  basis: 'verified' | 'calendar';
  origin: Iata; destination: Iata; airportPair: number;   // airportPair: index in sortedAirportPairs(scope)
  superseded: boolean;
  notSeenInLatest: { ageHours: number | 'unknown' } | null;
  journeyMinutes: number | null;
  departOut: string | null; arriveOut: string | null; departBack: string | null; arriveBack: string | null;
  fromEarlierSearch: boolean;
  cheaperCached: { pricePence: number; provenance: Provenance; stale: boolean; truncated: boolean;
                   origin: Iata; destination: Iata } | null;
}
export interface DatePair {
  index: number; departureDate: IsoDate; returnDate: IsoDate; nights: number;
  buckets: Buckets;   // the six over the airport pairs in scope, `reused` inside them (never a seventh)
  selected: number; itinerarySearched: number; notReached: number; onDemand: number;
  unconfirmed: number; partiallyVerified: number; journeyLeftOut: number;
  figure: DatePairFigure | null;
}
export interface DecodedDatePairs {
  executionId: string | null; executions: ExecutionSummary[];
  discoveryProviders: ProviderId[]; verificationProviderConfigured: boolean;
  staleAfterHours: number; calendarStaleAfterHours: Partial<Record<ProviderId, number>>;
  space: DatePairSpace; scope: DatePairsResponse['scope']; summary: CoverageSummary;
  pairs: DatePair[];   // every date pair, index order
}
export function encodeDatePairs(d: DecodedDatePairs): DatePairsResponse;   // one pass; provenance table keyed canonically
export function decodeDatePairs(r: DatePairsResponse): DecodedDatePairs;   // pure; no clock
export function provenanceKey(p: Provenance): string;   // canonical: every field, nested fx included, keys sorted
// DatePairFigure, DatePair and DecodedDatePairs are declared in encode.ts. encodeDatePairs throws RangeError for a
// figure or cheaper-cached price on an airport outside the scope; decodeDatePairs throws RangeError on a body the
// contract refuses (a short column, a sparse group's figure index naming no figure) rather than invent a value.
// CoverageSummary and ExecutionSummary are z.output types of their schemas in api-contract/common.ts.

// packages/core/src/datePairs/rank.ts
export function rankDatePairs(pairs: readonly DatePair[], now: IsoDateTime): DatePair[]; // those with a figure, best first
export function bestPerWeek(ranked: readonly DatePair[]): DatePair[];   // the first-ranked pair of each Monday-start departure week

// packages/core/src/datePairs/bands.ts
export const MAX_NIGHT_BANDS = 12;
export interface NightsBand { from: number; to: number }
export function foldNights(minNights: number, maxNights: number): NightsBand[];

// packages/core/src/datePairs/detailLink.ts (the one place the detail URL's names live; engine and web both use it)
export const DETAIL_LINK_PARAMS = { view: 'view', def: 'def', depart: 'depart', return: 'return', basis: 'basis', row: 'row' } as const;
export function detailLinkQuery(p: { definitionId: string; departureDate: IsoDate; returnDate: IsoDate;
  basis: ResultBasis; row?: string }): string;   // "view=results&def=…&depart=…&return=…&basis=…[&row=…]", §8.3's order

// packages/db: grouped reads, each a fixed number of statements (better-sqlite3, synchronous). Existing methods are
// reworked in place, keeping their signatures; no method is left without a caller.
type CalendarMarks = { sourceLastError: string | null; searchedEmptyLater: boolean };
  // sourceLastError: the last_error of the discovery outcome that fetched the price (through reused_from_execution_id
  // for a reused copy), for truncation; searchedEmptyLater: the newest searched, non-reused discovery outcome of a parent
  // execution for that (provider, cell) is newer than the price's execution and found empty or no_data (supersession).
  // Both in the same statement: the latest row per (provider, cell) grouped in the order of migration 0009's covering
  // index `calendar_prices_latest_idx` (max fetched_at, then max id; a ROW_NUMBER window sorted every row of a 20-run
  // history, several seconds), the truncation by a primary-key join to the fetching outcome, and the supersession by a
  // correlated probe of only the executions newer than the price's.
CalendarPricesRepo.latestPerCell(definitionId: string, cabin: Cabin, space: ResolvedSpace | null):
  Array<CalendarPriceRow & CalendarMarks>;   // reworked: the same rows, one statement, with the marks joined
CalendarPricesRepo.latestHeldBy(executionIds: readonly string[], cabin: Cabin, space: ResolvedSpace | null):
  Array<CalendarPriceRow & CalendarMarks>;   // new: `/results?executionId=`'s rows (latest held per (provider, cell)
                                             // among those executions, reused copies included), one statement;
                                             // heldBy(id) stays for its other caller, read/statusSources.ts
ItinerariesRepo.observationsForDefinition(definitionId, { executionIds, space, cabin, includeChildren }): ObservationRow[];
  // reworked: its private rows() hydrates itineraries and segments by hash list (json_each) in two statements instead of
  // get(hash) per itinerary, so writtenBy (the engine's alerts) gains the same fix
ItinerariesRepo.latestVerificationOutcomes(definitionId: string, cabin: Cabin, space: ResolvedSpace | null): Map<string, CellOutcome>;
CellsRepo.childVerificationRollUps(definitionId: string): Array<{ executionId: string; createdAt: IsoDateTime; cell: CellKey;
  status: CellOutcomeStatus | null }>;
CellsRepo.reusedCells(executionId: string): Set<string>;   // new: ParentFacts.reusedCells in one statement (cell keys)
CalendarPricesRepo.history(...)   // each point gains `sourceLastError` (same join), so read/history.ts keeps its
                                  // truncation mark without truncationOf
// truncationOf and supersessionOf (apps/api/src/read/results.ts) and their per-execution outcome reads are deleted.
// Migration 0009 (`0009_wp19_latest_price_idx`, with test/migration0009.test.ts) adds the covering index above.

// packages/engine/src/alerts/templates.ts
export function appRowLink(appBaseUrl: string | null, definitionId: string, basis: ResultBasis, rowKey: string,
  cell: Pick<CellKey, 'departureDate' | 'returnDate'>): string;   // through detailLinkQuery

// apps/api/src/read/scope.ts (one parser for both routes)
export function parseScope(def: SearchDefinition, q: { origins?: string; destinations?: string; maxJourneyMinutes?: string;
  departureDate?: string; returnDate?: string }, space: ResolvedSpace):
  { space: ResolvedSpace /* airports narrowed, sorted, unique */; maxJourneyMinutes: number | null;
    datePair: { departureDate: IsoDate; returnDate: IsoDate } | null };   // throws ApiError 422
export interface CellClass {
  cell: Cell;
  bucket: 'priced' | 'empty' | 'no_data' | 'error' | 'skipped' | 'not_run';
  reused: boolean; selected: boolean; itinerarySearched: boolean; notReached: boolean;
  onDemand: boolean; unconfirmed: boolean; partiallyVerified: boolean;
}
export interface ParentFacts {   // read once per request, each one statement
  rollUps: Map<string, { discovery: RollUp; verification: RollUp }>;   // cells.rollUps(parent.id)
  reusedCells: ReadonlySet<string>;                                    // the parent's reused discovery outcomes
  selected: ReadonlySet<string>;                                       // cells.selected(parent.id)
}
export function classifyCells(space: ResolvedSpace /* scoped */, parent: ParentFacts | null,
  children: ReturnType<CellsRepo['childVerificationRollUps']>,
  offers: { partiallyVerified: ReadonlySet<string> }): CellClass[];
  // one per cell of `space` in generation order; bucket = the parent's discovery roll-up status when present and not
  // null, else not_run (and every cell not_run when parent is null); no read inside. `unconfirmed` comes from the
  // parent's roll-up (itinerary-searched, priced, no confirmed price: decisions 45, 48, 51), the rule the calendar's
  // `unconfirmedCells` had ("follows the latest run"), so `offers` carries the partially-verified cells only
export function parentFacts(ports: Ports, parent: Execution | null): ParentFacts | null;   // the three reads above
export function summariseCells(classes: readonly CellClass[]): CoverageSummary;
  // the only way the api builds a CoverageSummary: buckets, total (= classes.length), reused, selected,
  // itinerarySearched and onDemand as counts of distinct cells

// apps/api/src/read/datePairs.ts
export function datePairFigures(loaded: Loaded, scope: ParsedScope, rc: RowContext):
  { figures: Map<number, DatePairFigure>; journeyLeftOut: Map<number, number> };
  // the one path from rows to a figure: confirmedIn, figuresByDatePair (journey rule included), the cheaper-cached
  // staleness by thresholdFor, fromEarlierSearch from the executions' order; assembleDatePairs uses the whole map and
  // figuresByDatePair's journeyLeftOut, assembleResults takes .figures.get(datePairIndex(...)) and drops airportPair
  // for datePairFigureSchema
// apps/api/src/read/load.ts: loadRows, Loaded and LoadOptions (re-exported from results.ts), so results.ts and
// datePairs.ts both read them without importing each other; confirmedIn lives in rows.ts for the same reason

// apps/web/src/state/view.ts
export type ViewId = 'dates' | 'results' | 'history' | 'definitions' | 'providers' | 'alerts' | 'status';
export const NAV_TIERS: readonly { id: 'decide' | 'setup'; views: readonly ViewId[] }[]; // decide: dates, history; setup: definitions, providers, alerts, status
// apps/web/src/state/landing.ts
export type Landing =
  | { kind: 'view'; view: ViewId; patch: Record<string, string | null> }  // patch applied with replace
  | { kind: 'row-lookup'; row: string; basis: 'verified' | 'calendar' | null };  // needs the whole-space /results read
export function land(params: URLSearchParams, def: { destinations: readonly Iata[] } | null): Landing;  // format only; no clock
// apps/web/src/state/datesState.ts
export const DATES_PARAMS = { nights: 'd.nights', from: 'd.from', to: 'd.to', journey: 'd.journey', sort: 'd.sort',
  week: 'd.week', coverage: 'd.coverage' } as const;
export interface DatesUiState { nights: { min: number; max: number } | null; from: Iata[]; to: Iata[]; journey: number | null;
  sort: { key: 'price' | 'departure' | 'nights' | 'journey'; dir: 'asc' | 'desc' }; bestPerWeek: boolean; coverageOpen: boolean }
export function parseDatesState(p: URLSearchParams, def: { origins: readonly Iata[]; destinations: readonly Iata[] }): DatesUiState;
export function datesPatch(s: Partial<DatesUiState>): Record<string, string | null>;
export function detailHref(pair: DatePair): string;
  // hrefWith({ [DETAIL_LINK_PARAMS.view]: 'results', [DETAIL_LINK_PARAMS.depart]: …, [DETAIL_LINK_PARAMS.return]: …,
  //   [DETAIL_LINK_PARAMS.basis]: <figure's basis>, [DETAIL_LINK_PARAMS.row]: null }): def and every d.* kept, the
  //   parameter names from core's one constant
```

The "Show 10 more" count is component state, not a URL parameter: §11 puts the filters, the sort, the week switch and
the coverage section in the URL, not how many rows are shown.

## 6. Library notes

Versions from the lockfile (plan Task 0.1 list and later pins). Verified 2026-10-26.

- **Hono 4.13.13** (`apps/api`): `import { compress } from 'hono/compress'`; `compress({ encoding: 'gzip' })`,
  `threshold` default 1024 bytes, the default content-type filter covers `application/json`. Mounted for one path:
  `app.use('/api/definitions/:id/date-pairs', compress({ encoding: 'gzip' }))` in `createApp`, after `noStore` and
  the hardening middleware (a refused request is never compressed work) and before the route loop. Verified with
  context7 `/honojs/website` (docs/middleware/builtin/compress.md). The response carries `Content-Encoding: gzip` only
  when the request's `Accept-Encoding` names gzip; the route test asserts both cases.
- **zod 4.6.7** (`core`): `z.strictObject`, `.superRefine((v, ctx) => ctx.addIssue({ code: 'custom', path, message }))`
  for the column refinement, one issue per rule broken. Verified with context7 `/colinhacks/zod` (v4 refine tests).
- **@tanstack/react-query 5.104.2** (`web`): the date-pairs query key holds every route parameter
  (`['date-pairs', id, from, to, journey]`); **no** `placeholderData: keepPreviousData` on it, because that would show
  the previous key's (unfiltered) figures while a filtered read loads (§9: "never from a cached unfiltered read").
  `queryClient.invalidateQueries({ queryKey: ['date-pairs', id] })` for the run re-read. Verified with context7
  `/tanstack/query` (migrating-to-v5, keepPreviousData).
- **@playwright/test 1.64.1** (`web` e2e): `page.route('**/api/**', (route) => route.fulfill({ status, contentType,
  body }))` for the performance test, `page.addInitScript` to install a `PerformanceObserver({ type: 'longtask',
  buffered: true })` before the app loads, `page.waitForFunction` on a User Timing mark with a timeout as backstop
  only, `page.setViewportSize`. Verified with context7 `/microsoft/playwright.dev` (network mocking). Chromium reports
  `longtask` entries; the test runs in the `desktop` (Chromium) project.
- **React 19.3.1**: `useLayoutEffect` to measure row positions before paint (the re-rank transition), `useId` for the
  readout's `aria-describedby`. Web Animations API `Element.prototype.animate` for the one transition, injected so
  jsdom tests spy on it (jsdom has no `animate` and no layout); `matchMedia('(prefers-reduced-motion: reduce)')`
  through the existing `useMediaQuery`.
- **User Timing API** (browser built-in): `performance.mark('gmt:dates-response')` when the date-pairs body has been
  parsed and `performance.mark('gmt:dates-drawn')` in an effect after the board and overview commit. The performance
  test calls `performance.clearMarks()` before each step and waits for that step's own pair of marks, so a later wait
  never returns on an earlier mark.
- **SQLite window functions and `json_each`** (better-sqlite3 as pinned): `ROW_NUMBER() OVER (PARTITION BY … ORDER BY
  …)` for the grouped reads and `json_each(?)` for the hash list; both in the SQLite bundled with the pinned
  better-sqlite3 (sqlite.org/windowfunctions.html, sqlite.org/json1.html#jeach).
- **@stryker-mutator/core 10.0.0** (new in `apps/web`): the command runner as `apps/api` uses it, with `--mutate` on
  the CLI while iterating.

## 7. Files

**Create**

- `packages/core/src/datePairs/{space,figure,rank,bands,encode,decode,detailLink,index}.ts`,
  `packages/core/src/api-contract/datePairs.ts`, `packages/core/src/space/limits.ts`; tests `packages/core/test/datePairs/{space,figure,rank,bands,codec,
  detailLink}.test.ts`, `packages/core/test/api-contract/datePairs.test.ts`, `packages/core/test/helpers/datePairs.ts`
  (builds a `DecodedDatePairs` and encodes it through `encodeDatePairs`).
- `apps/api/src/read/{datePairs,scope,calendarGap,load}.ts`, `apps/api/test/helpers/dates.ts` (the date-pairs world and
  the shared 422 table), `packages/db/test/helpers/history.ts` (the several-runs seed), `packages/db/drizzle/0009_wp19_latest_price_idx.sql`
  with `packages/db/test/migration0009.test.ts`; `apps/api/test/routes/{datePairs,datePairsBound,
  datePairsClassify,resultsScope}.test.ts`.
- `apps/web/src/views/Dates/{DatesView,DatesHeader,BoardTable,BoardCard,UpdateBoard,OverviewGrid,OverviewMonth,Legend,
  Readout,Filters,CoverageSection,States}.tsx` and `dates.css` (the board's and the overview's components are
  `BoardTable.tsx` and `OverviewGrid.tsx`: beside `board.ts` and `overview.ts`, a `Board.tsx` or `Overview.tsx` would
  differ only in case, which a case-insensitive file system cannot tell apart in an import),
  `apps/web/src/lib/coverageLine.ts` (§11's coverage line, one builder for the Results header, the Dates header and the
  detail), `apps/web/src/views/Dates/{board,howFar,stayScope,refresh,shade,overview,keys,
  flip}.ts`, `apps/web/src/state/{parse,datesState,landing}.ts`, `apps/web/src/views/Results/{AirportPairPanel,
  PanelSections,DetailHeader,RowLanding}.tsx`, `apps/web/src/views/Results/panel.ts`; tests:
  `apps/web/test/views/dates/logic/*.test.ts` (the pure-logic tests Stryker runs),
  `apps/web/test/views/dates/*.test.tsx` (components), `apps/web/test/state/{datesState,landing,parse}.test.ts`,
  `apps/web/test/views/results/{detail,panel}.test.tsx`, `apps/web/test/fixtures.dates.ts` (through `@gmt/core`'s
  `encodeDatePairs`), `apps/web/test/msw/datesHandlers.ts`, `apps/web/test/tz/datesView.tz.test.tsx`.
- `apps/web/stryker.config.json`; `apps/web/e2e/perf.spec.ts`, `apps/web/e2e/perfFixtures.ts` (through
  `@gmt/core`'s `encodeDatePairs`).

No web or e2e file imports from `packages/core/test`; fixtures build through `@gmt/core`'s exports.

**Modify**

- `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` (revision 50, Task 19.0).
- `packages/core/src/api-contract/{results,index}.ts`, `packages/core/src/index.ts`, `packages/core/src/space/generate.ts`
  (`windowDays`, `sortedAirportPairs`), `packages/core/src/space/validate.ts` (its limits from `limits.ts`),
  `packages/core/src/config/schema.ts` (`DEFAULT_MAX_CELLS` from `limits.ts`), `packages/core/stryker.config.json`,
  `packages/core/test/api-contract/{contract,wp10}.test.ts`, the core barrel tests.
- `packages/db/src/repositories/{itineraries,calendarPrices,cells}.ts` (+ `packages/db/test/{itineraries,
  calendarPrices,cells.rollup}.test.ts`).
- `apps/api/src/app.ts` (compress on the one path), `apps/api/src/routes/results.ts`, `apps/api/src/read/{results,pick,
  rows,coverage,coverageView,calendar}.ts` (`calendar.ts` loses `assembleCalendarGap` in Task 19.2 and is deleted in
  Task 19.8), `apps/api/test/routes/{views,contract-sweep,results}.test.ts`, `apps/api/test/helpers/seed.ts`,
  `apps/api/test/wiring/buildPorts.test.ts` (only where it names a retired route).
- `packages/engine/src/alerts/templates.ts`, `packages/engine/test/alerts/templates.test.ts`.
- `apps/web/src/{App.tsx,copy.ts}`, `apps/web/src/state/{view,resultsState}.ts`, `apps/web/src/components/{Nav,
  StatusBar,StatusCard}.tsx`, `apps/web/src/api/{endpoints,queries,types}.ts`, `apps/web/src/views/Results/*`,
  `apps/web/package.json` (`mutate` script, Stryker devDependency, `test:tz` paths), the web tests that pin the old
  view list (`test/app/shell.test.tsx`, `test/app/shellBoundary.test.tsx`, `test/app/wp10Wiring.test.tsx`,
  `test/state/resultsState.test.ts`, `test/copy/{catalogue,renderedSweep}.test.ts(x)`, `test/views/status.test.tsx`,
  `test/views/history.test.tsx`, `test/views/definitions/create.test.tsx`, `test/e2e/selectors.test.tsx`),
  `apps/web/test/tz/dates.tz.test.tsx` (its Calendar cases removed, Task 19.8), `apps/web/e2e/{smoke.spec.ts,selectors.ts}`,
  `apps/web/playwright.config.ts` (the `@perf` tag).
- Root `package.json` (`mutate` runs `@gmt/web`'s), `.github/workflows/mutation.yml` (a `web` shard and gate),
  `.github/workflows/ci.yml` (`GMT_TIMING_FACTOR: 3` on the job that runs `pnpm test`), `scripts/workflows.test.mjs`.
- `docs/setup.md`, `apps/web/PRODUCT.md`.

**Delete** (Task 19.8, after the moves of §4)

- `apps/web/src/views/{Calendar,Duration,Coverage}/`, `apps/web/src/state/calendarState.ts`,
  `apps/web/test/views/{calendar/,duration.test.tsx,coverage.test.tsx}`, `apps/web/test/state/calendarState.test.ts`,
  `apps/web/test/fixtures.wp10.ts`'s calendar and duration builders and `apps/web/test/msw/wp10Handlers.ts`'s two
  handlers (History's stay).
- `apps/api/src/read/{calendar,duration}.ts` (the gap moved to `read/calendarGap.ts` in Task 19.2).

## 8. Tasks

### Task 19.0: Spec revision 50

**Files**: the spec. No code. First commit of the build, after rebasing onto main (revision 49, PR #28, is merged).

- [ ] Write `### Revision 50: the Dates view's review (2026-10-26)` at the top of §17, in four labelled parts, and fold
  each change into the section it changes (no amendment blocks):
  - **Ian ruled 2026-10-26**: (1) the board has a "best per departure week" switch, off by default, in the URL
    (`d.week=best`), applied in the browser: when on, the board shows the first-ranked date pair of each departure week
    (Monday to Sunday over departure dates, which are calendar dates as the source states them, so no time zone
    enters), ranked by the same rule (§11 Board). (2) While a run is in progress and the pointer is over the board or
    focus is inside it, a new read does not re-rank rows: an "N changes · Update board" button appears, reachable by
    keyboard and announced politely, and applies them; otherwise rows re-rank in place as before (§11 Run landing).
  - **Ian confirmed 2026-10-26** (settlements of the brief's review he was shown): (1) the detail applies the journey
    limit, keeps "cheapest found" as its headline, and shows the board's price with a one-line reason when it differs
    (§10 `/results`' `maxJourneyMinutes` and `datePairFigure`, §11 Date pair detail); (2) superseded and not-seen figures
    are not on the overview's colour scale: drawn with their mark and counted in the legend, so every printed band range
    holds every price shaded in it (§11 Overview); (3) on touch, a tap on an overview cell shows its readout and a second
    tap (or the readout's link) opens the detail (§11 Overview); (4) a search with no discovery source shows every date
    pair as not searched, by the classification below (§6.6, §11).
  - **Settled by the orchestrator** (po-010's split): `journeyLeftOut` (its definition in §5 above; 0 without a journey
    limit); every cell of the current space in scope that the latest parent run has no discovery result for (a day the
    relative window rolled in, widened nights, an added airport, a roll-up with no discovery status) counts as not
    searched, so a date pair's six buckets always sum to its airport pairs in scope and the header and summary count
    those cells; a "not searched" date pair is one with no figure whose every airport pair is not searched; the
    old-email landing line for a truncated read, "That result is not among the first 1000 results read for this
    search."; `too_many_cells` in snake_case like every other code; web mutation testing on the pure-logic files
    (`apps/web/src/state/{parse,datesState,landing}.ts`, `apps/web/src/views/Dates/{board,howFar,stayScope,refresh,
    shade,overview,keys}.ts`), run over their pure unit tests only, never the jsdom component tests, at ≥ 80% (§9's
    mutation list); arrival times shown on the board row and in the detail only where the figure's own data carries
    them, with no arrival filter; the route reads what the latest parent run, its on-demand children and the scope
    need through a fixed number of grouped statements, never one per cell, past run, child or itinerary, and
    `/results?executionId=` reads the same way with its truncation and supersession marks (§10, §16); every coverage
    summary the api sends (the date-pairs route, `/results` scoped, unscoped and by execution, and the coverage route's
    summary) is the sum of one per-cell classification, so the totals always agree, and the coverage route's
    not-searched count now includes days a relative window rolled in, widened nights and added airports (§10 coverage
    route, §6.6); each figure carries `fromEarlierSearch`, and how far checked says the price comes from an earlier
    search exactly when it is true (§10, §11); an arrival on a later date than its leg's departure shows its day offset
    ("arrives 06:40 +1", the full date in words for assistive technology) (§11 Board, Date pair detail); CI runs
    the Playwright suite (the smoke on the desktop and 375 px projects, and the performance test) in a job of its own
    on ubuntu-24.04 with `GMT_TIMING_FACTOR=3`, path-filtered to `apps/web/**`, `apps/api/**`, `packages/core/**`,
    `packages/db/**`, `packages/engine/**` and the workflow itself (§9).
  - **Settled with the brief's review** (the brief's author, from the roster's findings; Ian may overturn any): the
    §10 query is a wire form of strings and the api answers 422 itself; the shape additions of §5 above
    (`notReached`, the cheaper-cached price's origin, destination, truncated and stale, `departOut`, `arriveOut`,
    `departBack`, `arriveBack`), the sparse `cheaperCached` and `times` groups that carry the last ten (as dense columns
    they put 36,400 date pairs at about 5 MiB, above the 4 MiB bound) and the refinement rules listed there; "cached from £X" only from a current (not superseded) calendar price, named with
    its own airport pair; the date pair's counts are distinct cells; the scope's airports are sorted and unique;
    §11's last rank tie (the airport pair's order) is removed, because each date pair has one figure and one index, so
    departure and nights already make the order total; the stay filter applies before ranking and shading, and bands
    fold the filtered stay range; the calendar-gap banner lists only cells inside the airport scope and the stay filter
    and names its reference price as "across the whole search"; the Dates and detail synthetic-banner rule (Tasks 19.4,
    19.6); the space's limits written once in `core/space/limits.ts`; §9's time limits (the route's 3 s, the browser's
    1.5 s and 200 ms) are multiplied by `GMT_TIMING_FACTOR` (default 1; the CI job that runs `pnpm test` sets 3,
    because shared runners are slower and noisier than the operator's machine, and a limit that fails on noise teaches
    nothing), while the statement counts and byte sizes stay exact.
- [ ] §16's row 19 names the grouped db reads and `encodeDatePairs`; §9 item 5's bound test names its axes (Task 19.2)
  and item 6 the web mutation list.
- [ ] **Run**: `pnpm exec vitest run scripts/wording.test.mjs` and `pnpm --filter @gmt/api exec vitest run
  test/deploy/docs.test.ts` green.
- [ ] **Commit**: `Specify the Dates view's review rulings (spec revision 50)`.

### Task 19.1: `core`: space, contract, codec, figure precedence, ranking, week, bands, detail link (first failing test)

**Files**: create `packages/core/src/datePairs/*`, `packages/core/src/api-contract/datePairs.ts`, their tests and
`packages/core/test/helpers/datePairs.ts`, and `space/limits.ts`; modify `space/generate.ts`, `space/validate.ts`,
`config/schema.ts`, the barrels and `packages/core/stryker.config.json`.
**Consumes**: §4's core helpers. **Produces**: §5's core interfaces.

- [ ] **Write the failing tests.**

  **First failing test (§16)**, `test/datePairs/figure.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { figuresByDatePair } from '../../src/datePairs/figure.js';
  import { asIata, asIsoDate } from '../../src/types/ids.js';
  import { calendarRow, NOW } from '../helpers/rows.js';

  // why: the row helpers take the schema's input shape, so the cell is plain strings and needs no brand helper.
  const onPair = (origin: string, destination: string) => ({
    origin, destination, departureDate: '2027-03-14', returnDate: '2027-03-24', nights: 10,
  });
  const scopeOf = (origins: string[]) => ({
    space: {
      origins: origins.map(asIata), destinations: [asIata('EWR'), asIata('JFK')],
      departureFrom: asIsoDate('2027-03-14'), departureTo: asIsoDate('2027-03-15'), minNights: 10, maxNights: 11,
    },
    maxJourneyMinutes: null,
  });

  describe('a figure is the cheapest across the airport pairs in scope (decision 53)', () => {
    it('a date pair priced only on a filtered-out airport pair has no figure', () => {
      const priced = calendarRow({ cell: onPair('LGW', 'EWR'), pricePence: 31_200 });
      // index 0 is 14 Mar, 10 nights: its only priced cell is LGW→EWR, outside an LHR-only scope
      expect(figuresByDatePair([priced], scopeOf(['LHR']), NOW).figures.has(0)).toBe(false);
      // and the same price is the figure once its airport pair is in scope
      expect(figuresByDatePair([priced], scopeOf(['LGW', 'LHR']), NOW).figures.get(0)?.chosen.pricePence).toBe(31_200);
    });
  });
  ```

  Then, in the same file, table-driven over `pickFigure` (each case names the §11 branch it pins): fresh verified wins
  over a cheaper current calendar price and carries it as `cheaperCached`; a fresh verified price above every calendar
  price has `cheaperCached` null; a fresh verified figure whose only cheaper calendar price is superseded has
  `cheaperCached` null; `cheaperCached` may sit on another airport pair than the figure and keeps its own cell; stale
  verified against calendar, the fresher wins (`compareAges`), equal ages go to verified, unknown age loses to known
  on either side, two unknowns go to verified; stale verified alone is the figure (stale); calendar alone; neither gives
  null; a `partially-verified` and a `failed` candidate are never chosen, even when cheapest and alone (null);
  `pickVerifiedFigure` prefers a seen over a not-seen, then a fresh over a stale, then the cheaper; on a full tie it
  takes the first by generation order and then `resultRowKey`, whatever the input order (property: the pick is the same
  for every permutation); `pickCalendarFigure` prefers a current over a superseded price even when the superseded one is
  cheaper, and returns the cheapest superseded one when nothing is current, ties by generation order then
  `resultRowKey`. One case per tie level, for each of the two picks, so every arm of `cellOrder` and `tieOrder` runs:
  equal keys on cells that differ only in origin, only in destination, only in departure date, only in return date;
  the same cell with two different row keys (an itinerary hash against `calendar:<id>`, and two hashes); and two
  candidates with the same cell and the same row key (the first in input order stays). `figuresByDatePair`: candidates outside the space or the scope's airports are dropped;
  `maxJourneyMinutes` 600 drops a candidate with `totalMinutes` 601, keeps 600 and keeps `null`; a date pair whose
  every figure-eligible candidate was dropped for a known journey time has no figure and `journeyLeftOut` equal to
  those airport pairs; a date pair whose only over-limit prices are `failed` or `partially-verified` has no figure and
  `journeyLeftOut` 0; with `maxJourneyMinutes` null, `journeyLeftOut` is empty; two airport pairs of one date pair give
  one figure, the cheaper by the precedence, wherever it sits.

  `test/datePairs/space.test.ts`: `datePairAt` and `datePairIndex` are inverse over a space crossing a month end
  (2027-01-30 to 2027-02-02), the leap day (2028-02-28 to 2028-03-01, 29 Feb present) and the 2027→2028 boundary, and
  over `minNights` 0 (index offset 0 returns on the departure date); `datePairIndex` is null for a departure outside the
  window, a nights value outside the range and a return before the departure; an expired window (`departureFrom` after
  `departureTo`, as `resolveWindow` gives an absolute window that has passed) has `datePairCount` 0 and
  every `datePairIndex` null, and `windowDays` 0; `datePairCount` is 182 × 12 = 2,184 for the worked example's default space and
  400 × 91 = 36,400 at the largest (0–90 nights), and equals `countCells` over the same space with one airport pair
  (property); `sortedAirportPairs(['LHR','LGW'], ['JFK','EWR'])` is LGW→EWR, LGW→JFK, LHR→EWR, LHR→JFK, and
  `generateCells` and `countCells` still pass their own tests after they are refactored onto `windowDays` and
  `sortedAirportPairs`; `MAX_DATE_PAIRS` equals `MAX_WINDOW_DAYS × (MAX_NIGHTS + 1)` and `validateSearchSpace` still
  refuses 401 days and 91 nights through the moved constants.

  `test/datePairs/rank.test.ts`, table-driven (one row per tie rule, each built so only that rule decides):

  | case | a | b | first |
  |---|---|---|---|
  | price | £300 calendar | £310 verified | a |
  | equal price, basis | £300 calendar | £300 verified | b |
  | equal price and basis, fresher | £300 verified, 2 h | £300 verified, 30 h | a |
  | unknown age last | £300 calendar, age unknown | £300 calendar, ≤7 d | b |
  | earlier departure | 14 Mar, 12 n | 15 Mar, 10 n | a |
  | fewer nights | 14 Mar, 12 n | 14 Mar, 10 n | b |
  | equal price, basis and age, nights decide | £300 verified, 2 h, 14 Mar 12 n | £300 verified, 2 h, 14 Mar 11 n | b |
  | superseded after current | £200 calendar, superseded | £900 calendar | b |
  | not seen after current | £200 verified, not seen | £900 calendar | b |
  | superseded against not seen: price decides | £250 calendar, superseded | £240 verified, not seen | b |
  | only superseded set, against current | £100 calendar, superseded | £500 verified | b |
  | only not-seen set, against current | £100 verified, not seen | £500 calendar | b |
  | truncated ranked by amount | £250 calendar, truncated | £260 calendar | a |

  Property tests (`fast-check`): `rankDatePairs` is a total order (antisymmetric, transitive, ties only for the same
  index) and its output is the same for every permutation of its input; pairs without a figure never appear; a
  truncated figure's flag survives. `bestPerWeek` over a ranked list keeps, for each Monday-start departure week, the
  first pair in rank order and drops the rest, in rank order: a Sunday and the following Monday fall in different
  weeks; a week crossing a month end and the 2027→2028 boundary is one week; the output is a subsequence of the input.
  There is no airport-pair tie (revision 50).

  `test/datePairs/bands.test.ts`: 12 stay lengths (10–21) stay twelve single-night bands; 13 (10–22) fold into seven
  bands, six of 2 nights and the last 22–22; 91 (0–90) fold into twelve bands, eleven of 8 and the last 88–90; a
  property that for every `0 ≤ min ≤ max ≤ 90` the bands are contiguous, in order, cover `[min, max]` exactly, number
  at most 12, and all but the last share one width; `foldNights(5, 4)`, `foldNights(5.5, 8)`, `foldNights(5, 8.5)` and
  `foldNights(-1, 4)` throw `RangeError`.

  `test/datePairs/detailLink.test.ts`: `detailLinkQuery({ definitionId: 'def-1', departureDate: '2027-03-14',
  returnDate: '2027-03-28', basis: 'verified', row: HASH })` is exactly
  `view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=verified&row=<HASH>`, and the same without
  `row`. This literal is the one the engine (Task 19.3) and the web landing (Task 19.7) tests also use.

  `test/api-contract/datePairs.test.ts`: the helper's worked-example response parses; each refinement rejects its own
  malformed response with an issue at its path, one test per rule: §10's (a `pairs` column not `days × stays` long;
  `figures` columns of different lengths; `pair` not strictly ascending, and out of range; a provenance, origin or
  destination index out of range; a count above `scope.airportPairs` or not an integer; superseded on a verified
  figure; a not-seen age on a calendar figure; `scope.cells` above 50,000) and each rule of §5 above (buckets summing to
  anything but `airportPairs`, 0 included; summary differing from the column sums; `summary.total` ≠ `scope.cells`;
  unsorted or repeated scope airports; `airportPairs` ≠ the product; `cells` ≠ days × stays × airportPairs; more than
  36,400 date pairs; `notReached` above `selected`; `journeyLeftOut` non-zero with no limit; a sparse group's columns
  of different lengths, its `figure` index not strictly ascending or naming no figure; a cheaper-cached price or times
  on a calendar figure; a cheaper-cached price not below the figure's price; a times entry with no time; truncated on a
  verified figure; `pricePence` 31200.5 and −1, and the same in `cheaperCached.pricePence`); an unknown key
  (strict). The query schema accepts the three strings and rejects an unknown key.

  `test/datePairs/codec.test.ts`: `decodeDatePairs(encodeDatePairs(x))` deep-equals `x` (fast-check over generated
  `DecodedDatePairs`, every date pair's dates derived from its index), and `encodeDatePairs`' output always parses
  against `datePairsResponseSchema`; the decoder returns every date pair in index order with its dates across the month
  end, the leap day and the year boundary; every figure and every cheaper-cached price carries its full provenance by
  deep equality; `provenanceKey` gives two provenances differing in exactly one field (FX converted or not,
  `providerObservedAt`, `pointOfSale`, `maxAgeAssumed`, `returnDateSource`, `vendorPriceMark`) two distinct keys and two
  table entries, and two identical ones one entry; `buckets.reused` is the `reused` column.

- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/datePairs test/api-contract/datePairs.test.ts`
  → every file fails to load: `src/datePairs/figure.ts` (and the others) do not exist ("Failed to load url" / "Cannot
  find module").
- [ ] **Implement.** The load-bearing parts, in full:

  ```ts
  // packages/core/src/datePairs/figure.ts (spec §11 "The figure"; plan decisions 38, 53, 54, 58)
  /** Generation order of two cells: origin, destination, departure, nights (as generateCells emits them). */
  function cellOrder(a: CellKey, b: CellKey): number {
    const s = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    return s(a.origin, b.origin) || s(a.destination, b.destination) || s(a.departureDate, b.departureDate) ||
      s(a.returnDate, b.returnDate);   // why: within one departure date, the earlier return is the fewer nights
  }
  /** Generation order of a candidate's cell, then its row key: the one deterministic tie-break of every pick. */
  function tieOrder(a: FigureCandidate, b: FigureCandidate): number {
    return cellOrder(a.cell, b.cell) || (resultRowKey(a) < resultRowKey(b) ? -1 : resultRowKey(a) > resultRowKey(b) ? 1 : 0);
  }

  export function pickVerifiedFigure<T extends FigureCandidate>(rows: readonly T[]): T | null {
    // why: decision 54 then 58: a price the newest search returned beats one it did not, a fresh one a stale one, then
    // the cheaper; a full tie falls to generation order and the row key, never to database order.
    const better = (a: T, b: T) =>
      (a.notSeenInLatest === null) !== (b.notSeenInLatest === null) ? a.notSeenInLatest === null
      : a.stale !== b.stale ? !a.stale
      : a.pricePence !== b.pricePence ? a.pricePence < b.pricePence
      : tieOrder(a, b) < 0;
    let best: T | null = null;
    for (const r of rows) if (best === null || better(r, best)) best = r;
    return best;
  }

  export function pickCalendarFigure<T extends FigureCandidate>(rows: readonly T[]): T | null {
    const cheapest = (xs: readonly T[]) =>
      xs.reduce<T | null>((m, r) => (m === null || r.pricePence < m.pricePence || (r.pricePence === m.pricePence && tieOrder(r, m) < 0) ? r : m), null);
    return cheapest(rows.filter((r) => !r.superseded)) ?? cheapest(rows);
  }

  export function pickFigure<T extends FigureCandidate>(candidates: readonly T[], now: IsoDateTime): Figure<T> | null {
    // why: §11: partially-verified and failed prices are never the figure; 'unchecked' is a calendar price.
    const v = pickVerifiedFigure(candidates.filter((x) => x.verdictClass === 'verified'));
    const calendar = candidates.filter((x) => x.verdictClass === 'unchecked');
    const c = pickCalendarFigure(calendar);
    // why: revision 50: "cached from £X" quotes a current calendar price only; a later search found a superseded one empty.
    const current = pickCalendarFigure(calendar.filter((x) => !x.superseded));
    const cheaper = (shown: T) => (current !== null && current.pricePence < shown.pricePence ? current : null);
    if (v !== null && !v.stale) return { basis: 'verified', chosen: v, cheaperCached: cheaper(v) };
    if (v !== null && c !== null)
      // why: §8.1: fresher wins, unknown age loses to known, a tie goes to verified.
      return compareAges(effectiveAge(v.provenance, now), effectiveAge(c.provenance, now)) <= 0
        ? { basis: 'verified', chosen: v, cheaperCached: cheaper(v) }
        : { basis: 'calendar', chosen: c, cheaperCached: null };
    if (v !== null) return { basis: 'verified', chosen: v, cheaperCached: null };
    if (c !== null) return { basis: 'calendar', chosen: c, cheaperCached: null };
    return null;
  }
  ```

  ```ts
  // packages/core/src/datePairs/rank.ts (spec §11 "Board": the rank is by price whatever the sort)
  export function rankDatePairs(pairs: readonly DatePair[], now: IsoDateTime): DatePair[] {
    // why: each pair's key is computed once (decorate, sort, undecorate): 36,400 pairs re-rank inside the 200 ms limit.
    const keyed = pairs.flatMap((p) => p.figure === null ? [] : [{
      p,
      current: p.figure.superseded || p.figure.notSeenInLatest !== null ? 1 : 0,
      price: p.figure.price.pricePence,
      basis: p.figure.basis === 'verified' ? 0 : 1,
      age: effectiveAge(p.figure.price.provenance, now),
    }]);
    keyed.sort((a, b) =>
      a.current - b.current || a.price - b.price || a.basis - b.basis || compareAges(a.age, b.age) ||
      // why: the index orders by departure, then nights; each date pair has one figure and one index, so the order is
      // total here (revision 50 removed §11's airport-pair tie, which could never be reached).
      a.p.index - b.p.index);
    return keyed.map((k) => k.p);
  }
  ```

  ```ts
  // packages/core/src/datePairs/bands.ts (spec §11 "Folded bands")
  export function foldNights(minNights: number, maxNights: number): NightsBand[] {
    if (!Number.isInteger(minNights) || !Number.isInteger(maxNights) || minNights < 0 || maxNights < minNights)
      throw new RangeError(`foldNights: ${minNights}–${maxNights} is not a stay range`);
    const n = maxNights - minNights + 1;
    const width = Math.ceil(n / MAX_NIGHT_BANDS);   // 1 up to twelve lengths: one band per night
    const bands: NightsBand[] = [];
    for (let from = minNights; from <= maxNights; from += width)
      bands.push({ from, to: Math.min(from + width - 1, maxNights) });
    return bands;
  }
  ```

  `space.ts`: the day count is `generate.ts`'s `windowDays` (the one clamp, shared with `countCells`); `datePairAt` is `dayIndex = Math.floor(i / stays)`,
  `nights = minNights + (i % stays)`, dates by `addDays`; `datePairIndex` uses `daysBetween` and returns null outside.
  `figuresByDatePair` drops candidates outside the scope's space, counts per date pair the airport pairs whose every
  figure-eligible candidate has `totalMinutes !== null && totalMinutes > maxJourneyMinutes` (and drops those
  candidates), groups the rest by `datePairIndex`, and calls `pickFigure` per group. `encodeDatePairs` writes every
  column in one pass with the provenance table keyed by `provenanceKey`; `decodeDatePairs` walks `pairs` once and
  `figures` once. The contract's `superRefine` is one pass, reporting the first offending index per rule.
  `config/schema.ts`'s `MAX_CELLS_PER_DEFINITION` default reads `DEFAULT_MAX_CELLS` from `space/limits.ts`.
  Add the eight files to `packages/core/stryker.config.json`'s `mutate` and move them in this brief's front matter
  from `pending` to `mutate` in the same commit.
- [ ] **Run to verify they pass**: the same command, green; `pnpm --filter @gmt/core test` green at 100% (no
  unreachable branch: the comparators above have none);
  `pnpm --filter @gmt/core exec stryker run --mutate src/datePairs/figure.ts,src/datePairs/rank.ts --concurrency 2`
  ≥ 80%.
- [ ] **Commit**: `wp19: date-pair figure, ranking, codec and bands in core`.

### Task 19.2: The db reads, the date-pairs route and `/results`' scope

**Files**: `packages/db/src/repositories/{itineraries,calendarPrices,cells}.ts` and their tests;
`apps/api/src/read/{datePairs,scope,calendarGap,calendar,results,pick,rows,coverage,coverageView}.ts`,
`routes/results.ts`, `app.ts`; `.github/workflows/ci.yml` and `scripts/workflows.test.mjs` (`GMT_TIMING_FACTOR`);
`packages/core/src/api-contract/{index,results}.ts` (the ROUTES entry, the scope fields, `datePairFigure`); the api
tests named in §7.
**Consumes**: Task 19.1; §4's api helpers. **Produces**: §5's db methods, `parseScope`, `classifyCells`,
`summariseCells`, `datePairFigures`, `GET /api/definitions/:id/date-pairs`, `/results` scoped, the coverage route's
summary.

- [ ] **Write the failing tests.**

  **db** (each method: a fixed number of statements, by a `prepare` spy; with the scope's space pushed into the SQL;
  equal, over a seed with several runs, to a reference the test computes the old way: the per-execution and per-cell
  algorithm of today's `truncationOf`, `supersessionOf`, `get(hash)` and `latestVerificationOutcomeForCell`, written out
  in the test file, since the reworked methods replace those paths):
  - `latestVerificationOutcomes`: for every cell, the outcome `latestVerificationOutcomeForCell` returns, including a
    tie between two verification providers' outcomes with one `fetched_at` in one execution (both queries end their
    `ORDER BY` with `o.provider_id`, so they agree whatever the plan); a cell with only an error outcome is absent.
  - `CalendarPricesRepo.latestPerCell` (reworked): the same rows as before, restricted to the scope when given;
    `sourceLastError` equal to the reference truncation read; `searchedEmptyLater` equal to the reference supersession
    answer over a history of five parent runs (a newer run that skipped, errored or reused the cell does not count as a
    search).
  - `CalendarPricesRepo.latestHeldBy`: for one and for several executions, the latest held row per (provider, cell)
    the old `heldBy` loop gives, reused copies included, each with `sourceLastError` taken from the run that fetched it
    (through `reused_from_execution_id`) and `searchedEmptyLater` as above.
  - `ItinerariesRepo.observationsForDefinition` (reworked): the same rows as before, with itineraries and segments
    hydrated in two statements whether there are 1 or 500 distinct itineraries; `writtenBy` likewise.
  - `CellsRepo.childVerificationRollUps`: every completed child's verification roll-up for its cell, in one statement.

  **The classification** (`test/routes/datePairsClassify.test.ts`, a route property test over seeded states): for each
  of (a) the relative window rolled forward one day after the run (the new day's date pairs are not searched; a day the
  run searched that has departed is in neither the columns nor the summary), (b) the nights range widened after the
  run, (c) an airport added after the run and (d) one removed, (e) a discovery provider added and (f) removed, (g) a
  parent run in progress, (h) a cell whose roll-up has verification outcomes only (discovery status null): the body
  passes `datePairsResponseSchema`, every date pair's six buckets sum to `scope.airportPairs`, `summary.buckets` equal
  the column sums and `summary.total === scope.cells`; `/results` scoped to any of those date pairs reports the same
  six counts in its `coverage`; the coverage route's `summary` equals the unfiltered date-pairs summary (after the
  one-day roll-forward too) while its per-stage × provider breakdown keeps the run's own cells; unscoped `/results` and
  `/results?executionId=` build their `coverage` through `summariseCells` as well. Before any parent run: every cell
  is not searched, `executionId` null. A search with no discovery source: every cell not searched.

  **The route** (`test/routes/datePairs.test.ts`, a migrated in-memory database seeded through `test/helpers/seed.ts`
  with the worked example's four airport pairs):
  - **Airport filtering honesty (decision 53)**: for `origins=LHR` and for `destinations=JFK`, every bucket count, every
    verification count, every figure (price, provenance, basis, airport pair, marks, cheaper-cached price) and the
    summary equal those of a second definition holding only those airports, seeded with the same cells; a date pair
    priced only on LGW→EWR has no figure under `origins=LHR` and counts only its in-scope buckets (the §16 test at
    the route).
  - Scope normalised: `origins=LHR,LHR` equals `origins=LHR`; `origins=LHR,LGW` gives `scope.origins` `[LGW, LHR]` and
    figure indices into that order.
  - Columns in generation order and of equal length; `executionId` the latest parent; an on-demand child's verified
    price becomes a figure and counts in `onDemand`; decision 54's marks (a calendar figure whose cell a newer parent
    found empty is `superseded`; a verified figure the latest search did not return carries `notSeenInLatestAgeHours`);
    `cheaperCached` on a fresh verified LHR→JFK figure that hides a cheaper LGW→EWR calendar price, with LGW and EWR in
    its decoded `cheaperCached`; a date pair whose only cheaper calendar price is superseded has none; a truncated cheaper
    price carries `cheaperCached.truncated`; `cheaperCached.stale` for a provider no longer among the definition's discovery providers
    follows the figure's own staleness rule; a truncated tile's calendar figure carries `truncated`; `departOut`,
    `arriveOut`, `departBack` and `arriveBack` from a verified figure's segments (an overnight return among them) and
    null on a calendar figure; `fromEarlierSearch` false on a figure the latest parent run fetched while another airport
    pair of the same date pair is not searched, true on a figure an earlier run fetched, false on one an on-demand search
    after the latest run fetched, false before any parent run.
  - **Distinct cells**: two completed children on one cell give `onDemand` 1; two partially-verified itineraries in one
    cell give `partiallyVerified` 1; a partially-verified-only date pair has no figure; an unconfirmed offer is never a
    figure and counts once in `unconfirmed`; a selected cell whose verification is `not_run`, one `skipped:budget` and
    one in `error` give `notReached` 2; with one airport pair in scope every count stays within 0..1 and the body parses.
  - **Provenance by deep equality**: every decoded figure's provenance, and every cheaper-cached one, deep-equals the
    stored row's provenance as the row carries it (after the assumed-bound mark); two figures whose provenances differ
    in one field each get distinct table entries.
  - **Board and detail agree** (prov-014): for each date pair with a figure, `/results` scoped to that date pair, the
    same airports, the same journey limit and the figure's basis returns `datePairFigure` deep-equal to the board's
    figure with `airportPair` removed, and contains a row (or other offer) with the figure's price, provenance and cell.
    Both come from `datePairFigures`, the one path from rows to a figure.
  - `maxJourneyMinutes=600`: a verified price of 601 minutes is left out of its figure, one of 600 and a calendar price
    with no journey time stay; a date pair whose every figure-eligible price was left out has no figure, keeps its
    buckets and has `journeyLeftOut` equal to those airport pairs; without the parameter every `journeyLeftOut` is 0.
  - 422s: an origin or destination outside the definition (`unknown_airport`), a journey limit that is not an integer
    from 60 to 6000 (`invalid_journey_limit`, for `abc`, `59`, `6001`, `600.5`), and a scope above 50,000 cells
    (`too_many_cells`, `details: { cells, bound: 50000 }`, by raising `MAX_CELLS_PER_DEFINITION` in the test's config).
    A draft definition (no airports) answers 200 with `airportPairs: 0` and zero-length figure columns. An absolute
    window that has passed answers 200 with zero-length `pairs` columns and `scope.cells` 0.
  - Children before any parent: `executionId` null, every cell not searched, `summary.onDemand` and the figures as the
    children give them.
  - Gzip: with `Accept-Encoding: gzip` the response has `Content-Encoding: gzip` and decompresses (`node:zlib`
    `gunzipSync`) to the same JSON; without it, plain JSON; `/results` is never compressed.
  - The contract sweep (`contract-sweep.test.ts`) covers the new route: auth required, response parses, provenance on
    every figure by shape, banned words over its strings.
  - **The calendar route's rules, ported before Task 19.8 deletes them**: each `it` of `test/routes/views.test.ts`'s
    "calendar selection rules (plan decisions 53, 54; review prov-009)", "an assumed calendar bound reaches every price
    as such" and "superseded calendar prices on the views" is rewritten against the date-pairs route with the same seed
    and the same expectation on the figure (listed in the PR's ported-tests table).

  **`/results` scope** (`test/routes/resultsScope.test.ts`): `departureDate` and `returnDate` narrow the rows and
  `coverage` to that date pair's cells, before `chooseBasis` and ranking, so `basis`, `total`, `truncated`, `cheapest`
  and `excludedByCurrentSpace` describe the scoped cells (a date pair priced only by a calendar price opens on the
  calendar basis although other date pairs have observations; `cheapest` is that date pair's); one date without the
  other is 422 `date_pair_incomplete`; a malformed date is 422 `invalid_date_pair`; a date pair outside the current
  resolved space is 422 `date_pair_outside_space`; `origins`, `destinations` and `maxJourneyMinutes` narrow by
  `parseScope`'s rule with the date-pairs route's 422s (one shared table drives both test files); `datePairFigure` is
  null without a date pair; with no scope parameter the read is the whole space as before (the existing results tests
  stay green).

  **The bound** (`test/routes/datePairsBound.test.ts`, its seeds built once in `beforeAll` inside one transaction, the
  hook's timeout set explicitly to 120 s):
  - **Query count**: a `prepare` spy counts statements per request, and the count is equal between the smaller and the
    larger seed on each axis that grows: (a) 10 against 500 verified cells with distinct itineraries, (b) 1 against 20
    parent executions over the same cells, (c) 0 against 20 completed children, (d) 1,000 against 50,000 cells; and
    the same axes on `/results` (whole space, one date pair, and `?executionId=` of the oldest of 20 runs, so its
    truncation and supersession marks are read without a scan of each past run). A statement per cell, per past run,
    per child or per itinerary fails it.
  - **Time and size**: a definition of exactly 50,000 cells in scope (250 days × 50 nights × the worked example's 4
    airport pairs, LHR, LGW → EWR, JFK; a fifth airport pair would need a code outside the example), with history
    20 parent runs deep over those cells (their discovery outcomes and calendar prices), every cell priced, a few hundred
    verified observations and about one distinct provenance per 49 cells: the request, timed on its own, answers 200
    within `3_000 * timingFactor` ms (`timingFactor` is `Number(process.env.GMT_TIMING_FACTOR ?? 1)`, a positive number
    else the test throws; the `it`'s own timeout is a backstop only),
    the uncompressed body is at most 4 MiB (4 × 1024 × 1024 bytes) and the gzip body at most 512 KiB. A second case at
    36,400 date pairs (400 × 91, one airport pair, every one with a figure) holds the same bounds. A third: a
    100,000-cell definition (the operator's raised setting; 250 × 50 × 8 airport pairs, origins AAA, BBB, LGW, LHR →
    EWR, JFK, AAA and BBB being the example's synthetic codes) read with `origins=LGW,LHR` bringing the scope to 50,000
    answers 200 within the same bounds, reading only the scope's cells (the SQL carries the scope), and its unscoped
    read is 422 `too_many_cells` with `cells: 100000`. Axis (d) compares 1,000 cells with the 50,000-cell seed. The
    first run's bulk rows are written with raw statements in one transaction, each later run copied from it in SQL
    (INSERT … SELECT, prices and fetch times moved per run) to stay inside the 120 s seed budget (the repositories'
    per-tile writes would take minutes), the verified cells through the repositories; their harnesses are built with `createHarness({ persistent: true })`, which the file closes in
    `afterAll` and which stores a rate for today so the engine's after-boot FX refresh never fires mid-file.
  - The count and size assertions are exact gates everywhere. The 3 s limit is §10's starting default; it is exact on
    the operator's machine (factor 1) and multiplied by 3 on CI, where `ci.yml` sets `GMT_TIMING_FACTOR: 3` on the job
    that runs the package suites (`test`, whose step runs `pnpm -r --workspace-concurrency=1 test`) (revision 50: shared runners are slower and noisier, and a limit that fails on noise proves
    nothing; the factor never applies to counts or sizes, and no test is ever retried). `scripts/workflows.test.mjs`
    pins that env line.

- [ ] **Run to verify they fail**: `pnpm --filter @gmt/db exec vitest run test/itineraries.test.ts
  test/calendarPrices.test.ts test/cells.rollup.test.ts` → the new methods are not functions and the reworked ones
  still issue a statement per itinerary;
  `pnpm --filter @gmt/api exec vitest run test/routes/datePairs.test.ts test/routes/datePairsBound.test.ts
  test/routes/datePairsClassify.test.ts test/routes/resultsScope.test.ts` → 404 on `/api/definitions/:id/date-pairs`
  and the scope tests fail on unscoped counts.
- [ ] **Implement.**
  - `db`: §5's methods, each a fixed number of statements with `ROW_NUMBER()` windows and `json_each` as §6 says; the
    scope's space (airports, dates, nights) in the `WHERE`; the reworked methods keep their signatures and callers. The
    history-deep seed needed an index: migration 0009 (`calendar_prices_latest_idx`, a covering index in (provider,
    cell, fetched_at, id) order), after main's 0008, with its migration test, and `latestPerCell` groups in that index's
    order (`INDEXED BY`) instead of a window over every row; the stay filter applies to the winners only.
  - `read/scope.ts`: `parseScope` splits each comma list, keeps only the definition's codes (else 422
    `unknown_airport`), sorts and deduplicates them, treats empty or absent as all; parses the journey limit
    (`/^\d+$/`, 60..6000, else 422 `invalid_journey_limit`) and the date pair (both or neither, ISO dates, inside the
    space); `classifyCells` (§5's signature; its inputs are read once per request by the caller and it reads nothing
    itself) walks the in-scope cells of the current space once: a cell's bucket is the parent run's discovery roll-up
    status when it exists and is not null, else `not_run` (revision 50; before any parent run every cell is `not_run`);
    `reused` from the parent's reused discovery outcomes; selected, itinerary-searched and not-reached from its
    selections and verification roll-ups; on demand from `childVerificationRollUps`. `summariseCells` sums it into the
    one `CoverageSummary` every caller sends: the date-pairs route, `/results` (scoped and unscoped: the latest parent
    over the scope or the current space; `?executionId=`: that run as the parent over the current space) and
    `read/coverageView.ts`'s `summary` (the latest parent over the current space; its per-stage × provider breakdown,
    errors and on-demand list stay as they are). `coverageSummaryFor` is deleted.
  - `read/results.ts`: `loadRows(def, ports, { executionIds?, scope? })` reads through the grouped methods (scope
    pushed into SQL; the whole space when absent, so `excluded` counts stay); `notSeenResolver` takes the
    `latestVerificationOutcomes` map; calendar rows come from `latestPerCell` (whole history) or `latestHeldBy`
    (`?executionId=`), each with its truncation and supersession columns, and `truncationOf` and `supersessionOf` are
    deleted; `assembleResults` applies `parseScope` before `chooseBasis` and ranking and, on a date-pair read, sets
    `datePairFigure` from `datePairFigures(…).get(datePairIndex(…))` with `airportPair` dropped.
  - `read/datePairs.ts` `assembleDatePairs(def, query, ports)`: `parseScope`; cells = `countCells(scoped space)`, over
    `DEFAULT_MAX_CELLS` (fixed, whatever `MAX_CELLS_PER_DEFINITION` says, §10) → 422 `too_many_cells`; one `loadRows`
    with the scope; `classifyCells` and `summariseCells`; figures from `datePairFigures` (which applies `confirmedIn`,
    calls `figuresByDatePair`, takes the cheaper-cached staleness from the same `thresholdFor` as the figure, and sets
    `fromEarlierSearch` by comparing the row's execution's creation with the latest parent's); a `DecodedDatePairs`
    built in one pass and written by `encodeDatePairs`. It stays synchronous from its first read to its last
    (`// why: the api process is the only writer and better-sqlite3 is synchronous, so no engine write lands between
    these reads; an await here would break that snapshot`), and so does the scoped `assembleResults`.
  - `read/pick.ts`: `pickVerified` and `pickCalendar` delegate to `core`'s `pickVerifiedFigure` and
    `pickCalendarFigure` (one rule; the calendar-gap reference keeps using them). `read/coverage.ts`'s
    `onDemandSearched` reads `childVerificationRollUps` once instead of one roll-up read per child.
  - `ci.yml`: `GMT_TIMING_FACTOR: 3` as the `env` of the `test` job (it runs the package suites), with a `# why:` naming
    revision 50's reason.
  - `read/calendarGap.ts`: `assembleCalendarGap` moved out of `calendar.ts` unchanged.
  - `routes/results.ts` and `core`'s ROUTES: `route('GET', '/definitions/:id/date-pairs', datePairsResponseSchema,
    { query: datePairsQuerySchema })` beside `/results`; `app.ts`: `compress` on that path.
- [ ] **Run to verify they pass**: the same commands green; `pnpm --filter @gmt/db test` and `pnpm --filter @gmt/api
  test` green at their thresholds.
- [ ] **Commit**: `wp19: grouped reads, date-pairs route and scoped results`.

### Task 19.3: The engine's alert link

**Files**: `packages/engine/src/alerts/templates.ts`, `packages/engine/test/alerts/templates.test.ts`.

- [ ] **Write the failing test**: `appRowLink(null, 'def-1', 'verified', HASH, { departureDate: '2027-03-14',
  returnDate: '2027-03-28' })` is exactly `/?` followed by Task 19.1's `detailLink.test.ts` literal; the base-URL
  cases of the existing test keep their path prefix with the new parameters; a rendered digest with a POST booking
  carries that link with the item's cell dates; the banned-word test over the rendered body still passes.
- [ ] **Run to verify it fails**: `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts` → the
  expected string differs (no `depart`/`return`).
- [ ] **Implement**: `appRowLink` builds its query with `core`'s `detailLinkQuery`; the call site passes `item.cell`.
  The body sentence is unchanged.
- [ ] **Run to verify it passes**; `pnpm --filter @gmt/engine test` green.
- [ ] **Commit**: `wp19: alert link opens the row's date pair`.

### Task 19.4: The Dates view: data, header line, filters, board and run updates

**Files**: `apps/web/src/api/{client,endpoints,queries,types}.ts` (`ApiError` keeps the envelope's `details`, so the
422 `too_many_cells` state reads its `cells` and `bound`), `src/state/{parse,datesState,resultsState}.ts`,
`src/views/Dates/{DatesView,DatesHeader,Filters,BoardTable,BoardCard,UpdateBoard,States}.tsx`, `src/lib/coverageLine.ts`,
`src/components/StatusBar.tsx` (its Run now button exported as `RunNowButton` for the never-run state),
`src/views/Dates/{board,howFar,stayScope,refresh,flip}.ts`, `copy.ts`; tests under `test/views/dates/` and
`test/views/dates/logic/`, `test/state/{parse,datesState}.test.ts`, `test/fixtures.dates.ts`,
`test/msw/datesHandlers.ts`; `apps/web/stryker.config.json`, `apps/web/package.json`, root `package.json`,
`.github/workflows/mutation.yml`, `scripts/workflows.test.mjs`, `apps/web/vitest.config.ts` (the alias table and the
worked example's JSON are loaded from the repository root wherever the config runs, as `apps/api`'s config does, so the
config also runs from Stryker's sandbox).
**Consumes**: Task 19.1's codec, ranking and `bestPerWeek`; Task 19.2's route.

- [ ] **Write the failing tests** (Testing Library over msw, fake timers, `test/fixtures.dates.ts` building responses
  through `@gmt/core`'s `encodeDatePairs`, every provenance `fixture`/`synthetic`):
  - **Parsers** (`test/state/parse.test.ts`, pure): the helpers moved out of `resultsState.ts` keep resultsState's
    tests green and are used by `datesState.ts`.
  - **State**: `parseDatesState` reads `d.nights=10-14`, `d.from=LHR,LGW`, `d.to=JFK`, `d.journey=900`,
    `d.sort=journey.asc`, `d.week=best`, `d.coverage=open`; an airport outside the definition, a reversed or malformed
    range, a journey outside 60..6000 and an unknown sort key are ignored by the parser; `datesPatch` round-trips.
  - **Filters** (component): every control (stay range, origin and destination pickers, journey limit, week switch,
    "Clear filters") has an accessible label and is operable by keyboard; a journey limit outside 60..6000 typed by
    the operator is explained in words beside the field ("between 60 and 6000 minutes") and not sent; the filters and
    header stay mounted while a new read loads, focus stays on the control that changed, and the board and overview
    show a labelled loading state in place (`role="status"` "Loading dates for these filters").
  - **Query**: the endpoint sends `origins`, `destinations` and `maxJourneyMinutes` from the state and nothing for the
    stay range or the week switch; changing `d.to` issues a new request and, until it answers, the board shows that
    loading state, never the previous (unfiltered) figures (the msw handler holds the filtered answer on a promise the
    test resolves).
  - **Order of operations** (`logic/stayScope.test.ts`, `logic/board.test.ts`): the stay filter applies first; ranks,
    quintiles and the flat-shade test run over the filtered pairs (a stay filter moves a pair from rank 3 to rank 1);
    the header's counts are always the sum of the decoded pairs in view, and the full stay range renders the same
    line as no filter; `bestPerWeek` applies after ranking when `d.week=best`.
  - **One component test per §11 state**: no search ("No search yet" linking to Definitions); never run, when
    `executions` is empty ("Not run yet: nothing has been searched", the estimate and Run now); on-demand searches but
    no parent run ("Not run yet" with the on-demand count and their figures, never "nothing has been searched"); run in
    progress (board captioned "partial: run in progress", date pairs not yet reached read not searched); paused and
    budget-stopped (the reason, Resume, "the board shows prices found before the pause", the not searched count); stale
    (the header's stale label only when every figure is stale, and each stale figure labelled); no prices but coverage
    ("No prices in this run" with the coverage line and marks; no "no flights"); thin coverage (the next-move line when
    more than half the counted cells are no cached data, with the coverage-check link and "not evidence that no flights
    exist"); too many cells (the 422's cell count, the bound and the airport filter named as the way under it); no
    price within the filters (the board's line, the coverage line over the filtered scope with its not searched and
    error counts, a filtered scope partly not searched and one in error, "Clear filters"); loading; load error with
    Retry.
  - **Synthetic banner** (revision 50): shown when any entry of the response's provenance table (figures and
    cheaper-cached prices alike) is `sourceKind: 'synthetic'` or `providerId: 'fixture'`, or `discoveryProviders` or
    any execution read names the fixture provider, whatever `/providers` says; judged on the decoded response, not the
    rendered rows. Cases: only the 11th-ranked figure synthetic; only a cheaper-cached provenance synthetic; a fixture
    run that priced nothing; none synthetic (absent).
  - **Header line**: the search's name; the run with status and age ("run finished 2h ago", "run in progress, started
    40 min ago", "run paused 3h ago: <reason>"); the coverage line in §11's form over the cells in view, linking to the
    coverage section; with filters set, "2 of 4 airport pairs · 10–14 nights"; the calendar-gap banner, when a
    verification provider is configured, lists only the gap cells inside the airport scope and the stay filter (each
    gap cell carries its cell, nights included, so this is done in the browser), names its reference price "across the
    whole search" (it is not narrowed by any filter), and links each cell to its date pair's detail (`detailHref`),
    where the verify action runs (Task 19.6); under `d.nights=10-14` a 20-night gap cell is not listed and the
    reference label is unchanged.
  - **Board**: a `table` captioned "Best dates", with one caption line saying prices a later search no longer found rank
    after current ones; columns rank, depart, return, nights, price, how far checked, journey time (with "arrives
    HH:MM" for each direction when `arriveOut`/`arriveBack` carry a well-formed `YYYY-MM-DDTHH:MM` local time, nothing
    otherwise; when the arrival's date is later than that direction's `departOut`/`departBack` date, the day offset
    follows, "arrives 06:40 +1", with the arrival's full date in words in visually hidden text; an overnight return
    pins it), airports; rows in `rankDatePairs` order; the rank stays the price rank whatever the sort; sort buttons for price
    (default; the rank order, "current prices first" in its accessible description), departure, nights and journey
    time with `aria-sort`, a second press reverses, unknown journey time last both ways, the sort written to `d.sort`;
    10 rows, then "Show 10 more" adding 10, with "showing 10 of P date pairs with a price"; the week switch shows one
    row per departure week and says "best per departure week: W weeks"; "cached from £X (LGW → EWR)" through
    `PriceCell` with its own destination, truncated mark and stale mark; "superseded by a later search", "not seen in
    latest search (<age>)" and "cheapest of the rows read" on their figures; point of sale in words on each row;
    journey time "not known" when null, and "journey time not known" on a kept row under a journey filter; "none within
    <limit>" with its marks on a date pair whose `journeyLeftOut` is non-zero and that has no figure, never on one that
    had no price; each row's dates are a link to `detailHref` carrying the figure's basis, and a click elsewhere on the
    row follows it.
  - **How far checked** (`logic/howFar.test.ts`): class verified or a calendar price; itinerary-searched, selected but
    not reached (`notReached`), or not selected, and a selected cell in error worded as an error, never "not reached";
    partially-verified and unconfirmed counts; the date pair's airport pairs without a price by bucket ("3 no cached
    data"); the line "price from an earlier search" exactly when the figure's `fromEarlierSearch` is true (revision 50),
    and never on a figure the latest run fetched while another airport pair of its date pair is not searched (that pair
    reads "1 of 2 airport pairs not searched"); a truncated figure says the read was cut short; never "searched", never a banned word, "verified" only
    beside a class-verified figure.
  - **Run updates** (`logic/refresh.test.ts` and the component): while the latest parent run is pending or running, a
    progress change from the status bar's execution poll re-reads the route at most once per 30 s, with a trailing
    read (a change at 10 s after a read is read at 30 s) and an immediate read when the run leaves pending or running
    (a terminal status 5 s after a read is read at once). Not held: a read that changes the order moves rows in one
    transition of at most 200 ms (`getBoundingClientRect` stubbed per row so moved rows have real deltas; the injected
    `animate` called once per moved row with `duration ≤ 200`, never for an unmoved row) and none under
    `prefers-reduced-motion: reduce`; focus stays on the same date pair's row, or moves to the caption when that row
    leaves the shown rows; one `role="status"` region says "Best dates updated" once per read, never per row. **Held**
    (Ian ruled, revision 50): while the pointer is over the board or focus is inside it, a read that changes the board
    is kept pending and the whole view (header, board, overview) stays on the shown read; an "N changes · Update board"
    button appears (N = the date pairs whose rank or figure differs between the shown read and the pending one, among
    the rows either would show), reachable by Tab from the board, and the status region says "N changes to Best dates;
    Update board to see them" once per read; pressing it applies the pending read with the transition and moves focus
    to the caption; when the pointer has left the board and focus is outside it, the pending read applies in place.
  - **Phone (below 900 px)**: the board is stacked cards, each a link to the detail; dates and price lead (`PriceCell`
    face: provider mark, destination, short age, "not checked" on a calendar price, "≈" on a converted price), then how
    far checked (with "cheapest of the rows read" and "read was cut short" on a truncated figure), then journey time,
    arrival and airports; point of sale is not on the card. Sizes and sideways scroll are Playwright's (Task 19.9).
  - **Provenance**: every amount on the board and the cards renders inside `[data-testid="price-cell"]`. Two seams:
    (1) `Board` given a decoded `DatePair` whose figure's provenance lacks a required field renders the price boundary's
    message and no amount in the DOM; (2) a response body whose provenance index is out of range fails the contract,
    and the view shows its load error with no amount in the DOM.
  - **Time zones** (`test/tz/datesView.tz.test.tsx`, run by `test:tz` under `America/Los_Angeles` and `Asia/Tokyo`):
    a 2027-03-14 date pair reads 14 Mar on the board and in the card, and a 2027-04-01 date pair stays in April's
    group; the existing `JAN_OFFSET` control case is copied in so the file cannot pass in UTC alone. Its first failure
    is a time-zone failure: before the board's date formatting is written, the test is run against a formatter built
    on `new Date(iso)` and fails under `America/Los_Angeles` (1 Apr reads 31 Mar); the real formatter, from the string,
    then passes.
  - **Mutation workflow**: `scripts/workflows.test.mjs` expects a `web` entry in `mutate` (one shard) and in
    `mutation-gate`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates test/state` → modules
  missing; `pnpm exec vitest run scripts/workflows.test.mjs` → no `web` shard.
- [ ] **Implement.** `DatesView` decodes with `decodeDatePairs`, applies the stay range in `stayScope.ts`, ranks with
  `rankDatePairs`, applies `bestPerWeek` when switched on, and renders the board from `board.ts` (sort, page size,
  arrival time; `isSyntheticRead`, the banner's judgement over the decoded read, lives there too, so Stryker covers
  it). `refresh.ts` is a pure state machine over an injected clock (throttle, trailing read, terminal read,
  held pending read and its change count). `flip.ts` measures row tops in `useLayoutEffect` and calls the injected
  `animate(el, [{ transform: 'translateY(Δpx)' }, { transform: 'none' }], { duration: 200 })`, skipped under reduced
  motion. The re-read hook watches the status bar's execution query (same key, no second poll). `performance.mark` as
  §6 says. `apps/web/stryker.config.json` mirrors `apps/api`'s with the command
  `pnpm exec vitest run --coverage.enabled=false --bail=1 test/views/dates/logic test/state` (pure `.test.ts` files
  only, never the `.tsx` component tests; revision 50) and `StringLiteral` excluded for the reason `apps/api` gives
  (the words are pinned phrase by phrase); this task's files (`src/state/{parse,datesState}.ts`,
  `src/views/Dates/{board,howFar,stayScope,refresh}.ts`) go into its `mutate` and move from `pending` to `mutate` here
  in the same commit. The `web` shard's expected run is under 30 minutes (the pure tests run in seconds).
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test` green at 70% lines, 60% branches.
- [ ] **Commit**: `wp19: dates view header, filters, board and run updates`.

### Task 19.5: The overview and the coverage section

**Files**: `apps/web/src/views/Dates/{OverviewGrid,OverviewMonth,Legend,Readout,CoverageSection}.tsx`, `dates.css`,
`{overview,keys,shade}.ts` (with §4's moved functions); tests `test/views/dates/{overview,keyboard,marks,
coverageSection}.test.tsx`, `test/views/dates/logic/{shade,overview,keys}.test.ts` (the ported scale and grid tests
among them).

- [ ] **Write the failing tests:**
  - **Coverage marks never read as no flights**: for each unpriced bucket alone (empty, no_data, error, skipped,
    not_run) and mixed with the others, the cell's mark, its readout, its accessible name and the board's how far
    checked use that bucket's words; no text anywhere says "no flights"; only `empty` says "no fares"; with several
    airport pairs, the cell's bucket is §6.6's precedence over their buckets (table-driven against an independent
    enumeration).
  - **Not searched, defined** (revision 50): a date pair with no figure whose `notRun` equals its airport pairs is "not
    searched" and is never shaded; a date pair with a figure is shaded (when current) and, if any of its airport pairs is
    not searched, also carries the striped "partly not searched" mark; a figure from an earlier run on a date pair the
    in-progress run has not reached (its `fromEarlierSearch` true) is shaded, striped, and its readout says the price
    comes from an earlier search.
  - **Distinct marks**: the six marks (not searched, no fares, no cached data, error, skipped, partly not searched) and
    the "not checked", "superseded" and "not seen" marks render pairwise-distinct non-colour glyphs or patterns (by
    class or SVG pattern id) in the cells and the same ones in the legend with the word beside each, and no mark is
    drawn by `background-color` alone (a class-level guard; jsdom cannot apply `forced-colors`, so the browser check is
    the smoke's, Task 19.9); each mark meets the contrast test (`test/contrast.ts`) on every band shade.
  - **Shading** (`logic/shade.test.ts`, with the ported scale tests): one scale for current verified and calendar figures
    together, by `quintileBand` over their prices in view (ties share a band); fewer than ten figures, or a spread under
    10% of the cheapest, gives the flat shade and the legend says so; superseded and not-seen figures are not on the
    scale (neutral fill, their mark, counted in the legend) (revision 50); a property that every shaded cell's price lies
    within its band's printed range and equal prices share a shade; a calendar figure carries the "not checked" mark;
    the legend is numeric and always open: each mark in words with its count in view, the bands as price ranges, what
    "not checked" means; no cell prints an amount.
  - **Folded bands**: bands fold the filtered stay range with `foldNights`; a band cell shows its cheapest current
    figure's shade and the striped mark when any date pair in it has a cell not searched; click or Enter opens the band
    for that month, Escape or the band's header closes it; a ring on a date pair in a closed band rings the band.
  - **Keyboard** (`logic/keys.test.ts`, with the ported grid tests, and the component): one tab stop (roving
    tabindex); Left/Right by reading order (stay lengths, then the next day), Up/Down a week, PageUp/PageDown a month
    (clamped as `sameDayOtherMonth` does), Home/End the first and last cell of the day, across a month end and into an
    open band; Enter on a cell opens the detail with the date pair in the URL, on a closed band opens the band; focus
    always visible (a solid outline class asserted). Across the whole view, Tab reaches the filters, the board's sort
    buttons, each row's link, "Show 10 more", the "Update board" button when shown, the overview's one tab stop and the
    coverage section's toggle, in that order.
  - **Readout and names**: pointing at or focusing a cell shows its date pair in one line beside the legend (dates,
    nights, the figure through `PriceCell` row form with point of sale in words, how far checked with "cheapest of the
    rows read" on a truncated figure, airports, "≈" on a converted price, "not checked" on a calendar price; or its
    marks with counts by bucket); the cell's accessible name gives dates, nights and rank or mark in words, and its
    `aria-describedby` is the readout, so an amount is read only from `PriceCell`'s output.
  - **Touch** (revision 50): a first tap on a cell focuses it and shows its readout (one line at 375 px); a second tap on
    the same cell, or the readout's "Open these dates" link, opens the detail; the readout stays visible while a month is
    swiped.
  - **Rings both ways**: the board's shown rows are ringed (an outline class, not colour alone); hovering or focusing a
    row lights its cell and a ringed cell lights its row; neither calls `scrollIntoView` (spy).
  - **Phone**: one month at a time with Previous and Next month buttons and a swipe (pointer events), each day a row
    with its strip across the width, the legend and readout present (sizes in Task 19.9).
  - **Time zones** (added to `test/tz/datesView.tz.test.tsx`): under both zones a 2027-03-31 date pair sits in March's
    month of the overview and a 2027-04-01 one in April's, and the readout names 14 Mar for a 2027-03-14 date pair;
    first run against a `new Date(iso)` month helper and seen to fail under `America/Los_Angeles`, as in Task 19.4.
  - **Coverage section** (what the Coverage view held, moved, with `coverage.test.tsx`'s cases ported): folded by
    default; the header line's coverage link, `d.coverage=open` and `?view=coverage` (Task 19.7) open it; counts per
    stage × provider with the six-bucket breakdown and "searched" as the umbrella beside it (the one place it appears)
    with the "with a price" share; selected but not reached with reason; the browser provider's left cells with §3's
    texts; overrun and parity flags worded by unit; the error list with Retry only on a cell that has not departed;
    "schedule blocked since <date>"; the on-demand searches with their own buckets and calls; a line saying the filters
    do not narrow it.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates` → the overview modules
  are missing.
- [ ] **Implement.** Desktop: each month a table captioned by its name, weeks as rows (`weeksOf`), each day cell
  holding its strip of stay-length (or band) buttons; at most 400 × 12 = 4,800 cells drawn, plus one open band-month,
  which keeps the DOM bounded at the worst case. `shade.ts` is `scale.ts` moved, with the superseded and not-seen rule
  added; no new palette. Add `overview.ts`, `keys.ts` and `shade.ts` to the web Stryker list and this brief's `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test`.
- [ ] **Commit**: `wp19: dates overview, legend, readout, keyboard and coverage section`.

### Task 19.6: Results as the date pair detail, with the per-airport-pair panels

**Files**: `apps/web/src/views/Results/{ResultsView,ResultsHeader,BasisSwitch,AirportPairPanel,PanelSections,
DetailHeader}.tsx`, `views/Results/panel.ts` (moved from `views/Calendar`), `state/resultsState.ts`; tests
`test/views/results/{detail,panel}.test.tsx` and the existing results tests.

- [ ] **Write the failing tests:**
  - `?view=results&depart=2027-03-14&return=2027-03-28` reads `/results` with `departureDate`, `returnDate`, the Dates
    airport filter (`origins`, `destinations` from `d.from`/`d.to`) and `maxJourneyMinutes` from `d.journey`; rows and
    header are that date pair's only.
  - Results' own filters inside the detail: the nights range, departure range and destination filters (`f.nights`,
    `f.depart`, `f.dest`) are hidden and ignored, because the date pair and the Dates airport filter fix them; class,
    provider, stops, carriers, maximum price, unverified constraint and stale stay. A stale `f.nights=20-21` and
    `f.dest=EWR` in the URL do not empty a detail opened from the board under `d.to=JFK`.
  - Header: the dates and nights, "2 of 4 airport pairs" under a filter, then "cheapest found £X · <destination>
    <dates> · <basis> · <verdict class> · <provider> · <age>" with point of sale in words, and the coverage line over the
    date pair's cells (the same counts the board's date pair has), linking to the Dates coverage section. When the
    response's `datePairFigure` differs from the cheapest row, a second line shows it through `PriceCell` ("Dates board
    price: £X · <airport pair> · <basis>") and says why they differ ("the board prefers a price the latest search
    returned, then a fresh one"; revision 50). Opened under `d.journey=600`, no row over 600 minutes leads; opened with a
    not-seen verified row cheaper than the board's figure, both lines show and say so.
  - Arrival: the primary row shows "arrives HH:MM" for each direction where the row has segments, with "+1" (or
    "+2") and the arrival's full date in visually hidden text when the last segment's `arriveLocal` date is later than
    the first segment's `departLocal` date; an overnight return pins it.
  - The basis switch opens on `basis=` from the link (a calendar figure's row opens on the calendar basis) and else on
    §6.9's default, and the header says why; switching keeps the date pair.
  - "Back to dates" links to `?view=dates` with every `d.*` parameter kept and `depart`, `return`, `basis`, `row`
    removed.
  - One panel per airport pair in scope, from the cell route (ported panel tests): outcomes per stage and provider with
    reasons (the browser provider's left-cell texts), prices each with full provenance and point of sale through
    `PriceCell` (superseded marked), and, with a verification provider, "Search <cell> for itineraries (uses billed
    calls)" stating "hard stop 6 calls · 40 calls of budget headroom left", naming the call cap at 0 billed calls,
    saying when no headroom is left, showing a refusal with its cap, and handing the started search to the status bar;
    the calendar-gap cells of this date pair marked in their panels.
  - Booking: the cheapest row, on desktop and in the 375 px primary row, carries its booking link (GET link with host,
    POST form, or "no link", as WP9's `BookingAction` tests pin) with the `PriceCell` age and the class badge beside it.
  - `row=` opens and scrolls to that row, or says the row is no longer among this date pair's results.
  - A date pair without a row says so with its coverage line and a link to the coverage section, never "no flights".
  - 375 px: price, provenance, the class badge, dates and stops stay on the primary row.
  - The synthetic banner (revision 50): shown when any provenance in the scoped `/results` response is synthetic or the
    fixture provider's: every row's, every row's `otherOffers`, `cheapest`, `datePairFigure.price.provenance`,
    `datePairFigure.cheaperCached.provenance`, and the calendar-gap prices the detail marks; whatever `/providers` says.
    Test: opened on the verified basis with real verified rows and a synthetic calendar `datePairFigure`, the banner
    shows.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/results` → the scoped request
  is missing its parameters and the header lacks the date pair.
- [ ] **Implement**; the panel is the Calendar's `CellPanel`/`PanelSections`/`panel.ts` moved, not rewritten. As built:
  `panel.ts` and `PanelSections.tsx` moved to `views/Results/` (with the panel's words, from `COPY.calendarView.panel` to
  `COPY.panel`); `CellPanel.tsx` stays in `views/Calendar/` until Task 19.8 (the Calendar still renders it), so
  `AirportPairPanel.tsx` is its shell for one cell and both use the verify block it held, now `VerifySection` in
  `PanelSections.tsx`; `views/Calendar/{panel.ts,PanelSections.tsx}` keep only the day's picker and prices and re-export
  the rest. The Calendar-only cases of the old panel test (the day's section, the picker, focus and Escape, the inline
  section) stay in `test/views/calendar/cellPanel.test.tsx` until Task 19.8. The detail's coverage line and empty state
  link to the Dates coverage section; the calendar-gap banner left Results (`CalendarGapBanner.tsx` and
  `test/views/results/gapNotSeen.test.tsx` deleted, their rules held by the panel's gap-mark tests and
  `basisAndGap.test.tsx`); Results' `Filters` lost the stay, departure-range and destination controls, and the
  table tests that drove them (the departure range, the nights box, the destination checkbox) went with them.
  `test:tz` also runs `test/views/results/panel.test.tsx`, which formats London instants.
- [ ] **Run to verify they pass**; **Commit**: `wp19: results as the date pair detail`.

### Task 19.7: The two-tier nav and the `?view=` landing rules

**Files**: `apps/web/src/state/{view,landing}.ts`, `components/{Nav,StatusBar,StatusCard}.tsx`,
`views/Results/RowLanding.tsx`, `App.tsx`, `copy.ts`; tests `test/state/landing.test.ts`, `test/app/shell.test.tsx`,
`test/components/{statusBar,statusLink}.test.tsx`, `test/views/status.test.tsx`.

- [ ] **Write the failing tests:**
  - **Old `?view=` URLs land on Dates** (`land`, table-driven, no clock): absent or unknown → Dates; `calendar` and
    `duration` → Dates keeping `def=`; `calendar` with `cal.dest=JFK` → `d.to=JFK` (a destination outside the definition
    is dropped), other `cal.*` removed; `coverage` → Dates with `d.coverage=open`; `results` with two well-formed dates
    (return on or after departure) → the detail; `results` with a malformed or missing date pair and no `row=` → Dates;
    `results` without a well-formed date pair but with `row=` → a row lookup. `land` judges format only: whether the
    date pair is inside the current resolved space is the server's answer, so the detail, on `/results`' 422
    `date_pair_outside_space`, replaces the URL with Dates (keeping `def=` and `d.*`). A new alert link for a search over
    the 50,000-cell bound still opens its detail (the scoped `/results` read answers). Every landing rewrites the URL
    with `replace` and an unknown parameter is ignored.
  - **The email link**: the landing test feeds `/?` plus Task 19.1's `detailLink.test.ts` literal (and the same under a
    base-URL path prefix) and lands on the detail with `row=` kept, so the engine and the web cannot drift.
  - **The row lookup** (`RowLanding`): it reads the whole-space `/results` with the link's basis; a row found opens its
    date pair's detail with `row=` kept; a row not found in an untruncated read opens Dates with "That result is no
    longer in this search's results."; in a truncated read, with "That result is not among the first 1000 results read
    for this search." (revision 50); neither line holds a banned word.
  - **The nav**: two lists, each headed by its tier's name in text, Decide (Dates, History) and Set up (Definitions,
    Providers, Alerts, Status); real links; `aria-current="page"` and a non-colour cue on the current view; Results is
    not in the nav; every link carries `min-h-11` (44 px; measured in Task 19.9); at 375 px each tier is one row, its
    name first (measured in Task 19.9).
  - **Filters kept across views**: with `d.nights`, `d.from`, `d.to`, `d.journey`, `d.sort` and `d.week` set, the nav's
    History link keeps them (`hrefWith`), and the Dates link back restores the same board with no request for the stay
    filter or the sort.
  - The status bar shows Run now on Dates; its progress breakdown links to `?view=dates&d.coverage=open`; a search's
    Status `data` card links to that search's Dates view with its coverage section open.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/state/landing.test.ts
  test/app/shell.test.tsx test/views/status.test.tsx` → `parseView` still defaults to Results; the nav has one list.
- [ ] **Implement**; add `landing.ts` to the web Stryker list and this brief's `mutate`. As built: `ViewId` is the
  seven views here (Calendar, Duration and Coverage stay as modules no URL reaches until Task 19.8), `NAV_TIERS` and
  `navPatch` live in `state/view.ts`, and every nav link drops the detail's `depart`, `return` and `row` while keeping
  every filter; the App draws a view only once the landing's patch is in the URL (it waits for the definitions, so a
  `cal.dest` is judged against the selected one), shows Dates' own "No search yet" when there is no definition, and
  carries the row lookup's line on the Dates view until the URL next changes; a row found opens on the basis of the
  read that held it; the truncated line counts the rows that read returned (1000 at the cap). The Dates view and the
  detail read `/providers` through a non-fetching observer (`useProvidersWatch`): a second active observer mounting on
  a failed `/providers` refetched it, read as pending, unmounted the view and looped; the Dates view also leaves the red
  banner to the shell when `/providers` already says synthetic, so it shows once. `test/app/wp10Wiring.test.tsx` lost its
  `?view=calendar` and `?view=duration` cases (the landing tests hold that rule).
- [ ] **Run to verify they pass**; **Commit**: `wp19: two-tier nav and view landing rules`.

### Task 19.8: Remove the retired views and routes; the TZ suite

**Files**: §7's Delete list; `packages/core/src/api-contract/{results,index}.ts`, `apps/api/src/routes/results.ts`,
`apps/web/src/api/*`, `apps/web/package.json` (`test:tz` → `test/tz test/views/dates test/views/results/panel.test.tsx`), `apps/web/test/tz/dates.tz.test.tsx`
(its Calendar cases removed; its Results and formatting cases stay), the tests that named them. The Dates view's own
time-zone cases were written first, beside the view, in Tasks 19.4 and 19.5. As built: `apps/web/src/copy.ts` loses
`calendarView` and `durationView` (the Readout's `bucketBreakdown` moves to the top level, the panel's
`unconfirmedShort` to `COPY.panel`), with their catalogue, plural, glyph and camoufox-copy cases; `apps/api`'s
`read/coverage.ts` `onDemandSearched` and `read/pick.ts` `pickCalendar` go with their last callers; the
duration-analysis route's two "one set of executions" rules are ported into `test/routes/datePairs.test.ts` first;
and the smoke and its selectors (`apps/web/e2e/{smoke.spec.ts,selectors.ts}`, `test/e2e/selectors.test.tsx`), which
named the Calendar and Duration views and so cannot typecheck without them, are rewritten for the Dates view in this
task's commit (Task 19.9 adds the performance test).

- [ ] **Write the failing tests first:**
  - `packages/core/test/api-contract/contract.test.ts`'s ROUTES list no longer has `GET /definitions/:id/calendar` or
    `/duration-analysis` and has `/date-pairs`; `apiContract` exports no `calendarDaySchema`, `calendarQuerySchema`,
    `calendarResponseSchema` or `durationAnalysisResponseSchema`; History's "never the calendar" test asserts no request
    to `/date-pairs` either; the shell test's view list is the seven views.
  - `test/tz/datesView.tz.test.tsx` gains the detail header's case: a 2027-03-14 → 2027-03-28 detail reads 14 Mar and
    28 Mar under both zones.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/api-contract` → the old routes are
  still listed (the web's view list is already the seven views since Task 19.7).
- [ ] **Implement**: delete (the calendar gap already lives in `read/calendarGap.ts`, Task 19.2); remove the query keys
  and invalidations for `calendar` and `duration` and add `date-pairs` to `useExecutionActions`' refresh list; keep
  `recharts` (History uses it). `grep -rn "duration-analysis\|/calendar'\|calendarState\|DurationView\|CalendarView\|
  CoverageView" apps packages --include='*.ts' --include='*.tsx'` finds only the fixture provider's own `/calendar`
  endpoint (`packages/providers` and the engine's and api's tests that drive it) and the tests and comments that say
  the routes are gone; no source file imports or serves a retired view or route. `test:tz` runs `test/tz
  test/views/dates test/views/results/panel.test.tsx`, and `dates.tz.test.tsx` no longer imports `views/Calendar` or
  `fixtures.wp10`'s calendar builders.
- [ ] **Ported titles**: list every `it(…)` title of the deleted test files and print those no surviving test holds:

  ```bash
  git diff --name-only --diff-filter=D main...HEAD | grep -E '\.test\.tsx?$' | while read -r f; do
    git show "main:$f" | grep -oP "\bit\(\s*['\"\`]\K[^'\"\`]+"
  done | sort -u | while IFS= read -r t; do
    grep -rqF -- "$t" apps packages --include='*.test.ts' --include='*.test.tsx' || printf '%s\n' "$t"
  done
  ```

  Every printed title is in the PR's ported-tests table (§0) with the test that now holds its rule under another title,
  or the line of spec revision 48 that dropped the rule. The output and the table go into the PR description.
- [ ] **Run to verify they pass**: `pnpm -r typecheck`, `pnpm test`, `pnpm --filter @gmt/web run test:tz`.
- [ ] **Commit**: `wp19: remove the calendar, duration and coverage views and routes`.

### Task 19.9: The Playwright smoke and the performance test

**Files**: `apps/web/e2e/{smoke.spec.ts,selectors.ts,perf.spec.ts,perfFixtures.ts}`, `apps/web/playwright.config.ts`,
`.github/workflows/e2e.yml` and `scripts/workflows.test.mjs` (the `e2e` job),
`apps/web/test/e2e/selectors.test.tsx`.

- [ ] **Write the failing tests:**
  - `selectors.test.tsx`: each `SMOKE` selector (the board caption, a board row link, the overview's tab stop, an
    overview cell, a ringed cell, the legend, the readout, the phone card, Previous and Next month, the coverage
    section, the nav tiers) matches the rendered markup in jsdom.
  - **Smoke** (fixture mode, real api and built SPA), §9 item 6 steps 1–6: (1) import the example, switch both stages to
    the fixture provider, enable, estimate, create, run now, waiting on the run's finished status in the status bar;
    (2) Dates: the header line names the search, the run and its age, the red banner shows, the first board row carries
    the synthetic source and its age, the legend is visible, the overview's one tab stop moves by arrow with a solid
    focus outline, and hovering the first row lights its ringed cell; (3) the first row opens the detail, whose headline
    names the synthetic source and whose URL carries `depart` and `return`, and "Back to dates" returns with `d.nights`
    kept; (4) `?view=calendar` lands on Dates and `?view=coverage` on Dates with the coverage section open; (5) History's
    charts draw and its table names the synthetic source; (6) `@phone`, at 375 px: the board is stacked cards, the
    overview shows one month with Previous and Next, every overview cell's box is at least 24 × 24 px, nothing spills
    out of a cell, a tap on a cell shows the readout, the filters fit without sideways scroll, and on Dates, the detail,
    History, Definitions, Alerts, Providers and Status every nav link is at least 44 px tall, the two tiers keep every
    link in view in at most two rows, and `document.documentElement.scrollWidth <= 375`; (7) desktop, after
    `page.emulateMedia({ forcedColors: 'active' })`: on Dates each mark of the legend and of an overview cell that
    carries one still has its glyph or pattern (the glyph element is visible, or the computed `background-image` /
    SVG `fill` names the pattern), and the current nav entry keeps its non-colour cue.
  - **Performance** (`perf.spec.ts`, tagged `@perf`, desktop project): an init script installs a `longtask`
    `PerformanceObserver`; `page.route('**/api/**')` serves a synthetic definition, providers (the fixture provider,
    synthetic), status and executions, and the date-pairs body built by `@gmt/core`'s `encodeDatePairs` in
    `perfFixtures.ts` (every provenance `fixture`/`synthetic`, airports `AAA`, `BBB`) for (a) 36,400 date pairs every one
    with a figure (400 × 91, one airport pair) and (b) 50,000 cells (400 days × 25 nights × 5 airport pairs); the red
    banner shows; with marks cleared before each step, the board and overview are drawn within 1.5 s of the response
    (`gmt:dates-drawn` minus `gmt:dates-response`); a stay filter change redraws within 200 ms; a re-rank redraws
    within 200 ms, triggered without waiting: the page is loaded under `page.clock.install()`, the served status and
    execution show a running parent run, the pointer is moved off the board and focus put on the page body (so the
    board is not held), the next execution poll is served with changed progress, `page.clock.fastForward('00:31')`
    passes the 30 s throttle, and the date-pairs route serves a second body whose order differs; no long task over
    200 ms is recorded. Each limit is multiplied by `GMT_TIMING_FACTOR` (default 1, revision 50). Each wait is
    `waitForFunction` on that step's mark, with the timeout only as a backstop. The performance test runs with the e2e
    suite, locally and in CI's `e2e` job, and is not part of `pnpm test`.
  - **CI** (revision 50, settled by the orchestrator): a new workflow, `.github/workflows/e2e.yml` (a workflow of its
    own, because GitHub applies a path filter to a whole workflow and ci.yml's test matrix runs on every push), holds an
    `e2e` job on ubuntu-24.04 that installs Chromium with `pnpm --filter @gmt/web e2e:install` and runs `pnpm --filter
    @gmt/web e2e` (the smoke on both projects and the `@perf` test) with `GMT_TIMING_FACTOR: 3`, path-filtered to
    `apps/web/**`, `apps/api/**`, `packages/core/**`, `packages/db/**`, `packages/engine/**` and the workflow itself;
    `scripts/workflows.test.mjs` pins the job, its runner, its install and run steps, its factor and its path filter.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web e2e` → the smoke looks for the board caption on the old
  Results view and fails; the perf spec finds no `gmt:dates-drawn` mark.
- [ ] **Implement**; `playwright.config.ts` keeps `@phone` in the phone project and runs `@perf` in the desktop project
  only.
- [ ] **Run to verify they pass**: `pnpm --filter @gmt/web e2e` green on both projects.
- [ ] **Commit**: `wp19: dates smoke and performance test`.

### Task 19.10: `docs/setup.md` and `apps/web/PRODUCT.md`

- [ ] `docs/setup.md`: "Verify in the calendar" becomes the detail's verify action ("Search <cell> for itineraries" in
  a date pair's detail); "in View D" becomes "in the Dates view's coverage section". The docs tests
  (`apps/api/test/deploy/docs.test.ts`) and `scripts/wording.test.mjs` pass.
- [ ] `apps/web/PRODUCT.md`: the views list (Dates with its board, overview and coverage section; the date pair
  detail; History; the Set up views); the success line (the board and overview, not the calendar heatmap and the
  price-vs-stay chart); the desk-use line ("studying the Dates board and overview, a date pair's detail and History");
  Positioning's coverage bullet stated in the spec's units ("a date pair is a departure and a return date; a cell is
  one airport pair on one date pair; coverage is stated per date pair over its airport pairs"); and the Operating
  Context's alert-email line (its link opens that fare's date pair).
- [ ] **Commit**: `wp19: setup and product docs for the dates view`.

## 9. Pinned review-focus tests

- **Coverage marks never read as no flights**: each unpriced bucket alone and mixed, on the overview cell, readout,
  accessible name and how far checked; only `empty` says "no fares"; a not searched date pair never shaded; the striped
  mark; distinct glyphs (Task 19.5).
- **Airport-filter honesty (decision 53)**: a filtered read equals a definition holding only those airports; a date
  pair priced only on a filtered-out airport pair has no figure (Tasks 19.1 and 19.2); the web never shows unfiltered
  figures for a filtered key (Task 19.4); the calendar-gap banner keeps to the scope (Task 19.4).
- **Nothing conveyed by colour alone**: every mark in words and glyph, forced colours, rings as outlines, the current
  nav entry's non-colour cue, the "not checked" mark on calendar shades, states in words (Tasks 19.4, 19.5, 19.7).
- **Every amount goes through `PriceCell`**: board, cards, readout, "cached from £X", the detail's rows, header and
  panels; no overview cell prints an amount; a figure lacking provenance fails to render; provenance by deep equality
  through the codec (Tasks 19.1, 19.2, 19.4, 19.5, 19.6).
- **The banned words**: the web's catalogue and rendered-sweep tests over every new string, the engine's over the
  email body, the contract sweep over the route's strings (Tasks 19.2, 19.3, 19.4).
- **The 50,000-cell bound**: 3 s, 4 MiB, 512 KiB gzip, statements constant on four axes, the scope in the SQL, 422
  above it (Task 19.2); 1.5 s and 200 ms in the browser (Task 19.9).
- **Old `?view=` URLs land on Dates**: `calendar`, `duration`, `coverage`, unknown, and `results` without a date pair,
  with and without `row=`, and the email link's shared literal (Task 19.7, and the smoke's step 4).

## 10. Definition of done

- Spec revision 50 written (Task 19.0) and every "revision 50" rule of this brief in it.
- `pnpm --filter @gmt/core test` (100% lines, branches, functions), `pnpm --filter @gmt/db test`,
  `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` (85% / 70%), `pnpm --filter @gmt/web test` (70% /
  60%; the script ends by running `test:tz`), and `pnpm --filter @gmt/web run test:tz` on its own (both zones), each
  green.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`, `pnpm test`.
- Mutation, each at ≥ 80% with timed-out mutants under 5% of those tested: `pnpm --filter @gmt/core mutate` (the eight
  `core` files of this brief among its list) and `pnpm --filter @gmt/web mutate` (the ten `web` files, over the pure
  tests). Every file in this brief's `pending` has moved to `mutate` and to its package's `stryker.config.json`, and
  `status` reads `merged` only after that: `node scripts/check-mutation-globs.mjs` exits 0 with nothing pending for
  WP19.
- `pnpm --filter @gmt/web e2e`, run locally with `GMT_TIMING_FACTOR` unset (factor 1): the smoke green on the desktop
  project and the `@phone` project at 375 px, the `@perf` test green on the desktop project. CI gates the route's
  statement counts, sizes and 3 s × 3 through `pnpm test`, and the smoke and the browser's 1.5 s and 200 ms limits
  (× 3) through `e2e.yml`'s `e2e` job (revision 50, settled by the orchestrator), green on the PR.
- `pnpm exec vitest run scripts/wording.test.mjs scripts/workflows.test.mjs` green.
- No orphaned vitest, Stryker, Playwright or browser process after the runs.
- The PR's description carries the ported-tests table and the changed-file count with the CodeRabbit route it took
  (app at ≤ 150 files, CLI above), and every CodeRabbit thread is fixed and resolved before the merge.

## 11. Open questions

None. Revision 48's three questions were settled by the orchestrator on 2026-10-26, and Ian confirmed the review's
four operator-facing settlements the same day; Task 19.0 records all of them in revision 50: `journeyLeftOut` is added (§5); cells without a discovery result in the latest parent run count as not
searched (Task 19.2's classification); the truncated-read landing line is "That result is not among the first 1000
results read for this search." (Task 19.7). Ian's two rulings of the same day (the week switch, the update button) and
the review's own settlements are in Task 19.0's list.
