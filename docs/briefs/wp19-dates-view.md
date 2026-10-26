---
wp: 19
title: The Dates view (the date-pair board and overview, the date pair detail, the two-tier nav)
owner: opus
depends_on: [18]
spec_sections: ["§1", "§6.5", "§6.6", "§8.3", "§9 items 1, 4, 5, 6", "§10 GET /definitions/:id/date-pairs", "§10 /results scope parameters", "§10 Routes the Dates view retires", "§11 layout and nav", "§11 URLs", "§11 Dates", "§11 Date pair detail", "§16", "§17 revision 48"]
reviewers: [code-architect, test-strategy-reviewer, ui-reviewer, provenance-auditor, data-model-reviewer, search-strategy-reviewer]
mutate: {}
pending: {"@gmt/core": ["src/datePairs/space.ts", "src/datePairs/figure.ts", "src/datePairs/rank.ts", "src/datePairs/bands.ts", "src/datePairs/decode.ts", "src/api-contract/datePairs.ts"], "@gmt/web": ["src/state/datesState.ts", "src/state/landing.ts", "src/views/Dates/board.ts", "src/views/Dates/howFar.ts", "src/views/Dates/stayScope.ts", "src/views/Dates/shade.ts", "src/views/Dates/overview.ts", "src/views/Dates/keys.ts"]}
status: draft
---

# WP19: The Dates view (the date-pair board and overview, the date pair detail, the two-tier nav)

Written 2026-10-26 against spec revision 48 (main `1d568c01`), Ian's confirmed design brief of the same day (shaped
after that day's critique of the web UI) and his rulings on the draft's open questions ("Ian ruled 2026-10-26" in §17).
WP18 is merged. This package makes the first screen answer which dates to fly: a ranked board of date pairs, each
priced by the cheapest figure across the airport pairs in scope, with an overview of months beneath it; Results
becomes that date pair's detail; Calendar, Duration and Coverage go, and nothing they held that still matters is lost
(spec §17 revision 48, "Moved from the retired views").

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
  Task 10.11 (History) and Task 10.9's TZ suite stay, the TZ suite pointed at the Dates tests.
- **WP11** (`wp11-alerts-email.md`): §5's `appRowLink` signature and its `?view=results&def=…&basis=…&row=…` form
  (the results-row link), and Task 11.2's link assertion.
- **WP18** (`wp18-status.md`): Task 18.6's link from a search's `data` card to the Coverage view (it now opens the
  Dates view with its coverage section open).

The plan's file map and its WP9 and WP10 sections yield to spec revision 48 where they differ.

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
- **Commits**: plain fix commits are fine (the PR lands by squash-merge; no fixups or history rewrites needed). Every
  commit ends with the trailer `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`. Never a bare
  `git stash`.
- **CodeRabbit**: count the PR's changed files (`git diff --name-only main...HEAD | wc -l`). At 150 or fewer the
  CodeRabbit app reviews the PR; above 150 run the CodeRabbit CLI locally and say so in the PR. Before the merge, read
  the app's inline threads and its outside-diff list, fix each, push, and resolve each thread.

## 1. Goal

`GET /api/definitions/:id/date-pairs` returns every date pair of the current resolved space with its buckets,
verification counts and figure over the airport pairs in scope, honestly filtered and bounded; the web's default view
ranks those figures on a "Best dates" board and shades them on an overview of months, each price through `PriceCell`
with its provenance and each gap in words; a board row, an overview cell or an alert email opens the date pair detail
(Results scoped to one date pair, with per-airport-pair panels); the nav has two tiers; and the old view URLs land on
Dates.

## 2. Scope

**In**

- `core`: the date-pair space arithmetic, `datePairsQuerySchema` and `datePairsResponseSchema` with their refinement,
  `decodeDatePairs`, the figure precedence (`pickFigure`, `figuresByDatePair`), `rankDatePairs` and `foldNights`; the
  barrel exports; Stryker entries for each.
- `db`: one grouped read of the newest priced-or-empty verification outcome per cell for a definition and cabin, so the
  read routes stop issuing one query per verified cell (§10's "one grouped query per stage … never one per cell").
- `api`: the date-pairs route with Hono's `compress` on that route alone, its 422s, the 50,000-cell bound;
  `/results`' scope parameters; the api's `pick.ts` delegating to `core`'s figure precedence; removal of the calendar
  and duration-analysis routes, schemas, read modules and tests, with the calendar's selection-rule tests ported to the
  date-pairs route first.
- `engine`: the alert email's POST-booking link carrying the row's date pair (§8.3).
- `web`: the Dates view (header line, calendar-gap banner, board, overview with legend, readout, rings, folded bands
  and keyboard, filters, coverage section, phone layout, every §11 state, run landing and re-ranking); Results as the
  date pair detail with its per-airport-pair panels and "Back to dates"; the two-tier nav; the `?view=` landing rules;
  the status bar's progress link and the Status `data` card's link; removal of the Calendar, Duration and Coverage
  views, their state, queries and tests; `apps/web/stryker.config.json` and the web's place in the mutation workflow.
- The Playwright smoke rewritten for the Dates view (desktop and 375 px) and the performance test.
- Docs: `docs/setup.md` ("Verify in the calendar", "in View D") and `apps/web/PRODUCT.md` (its list of views, its
  success line and its desk-use line).

**Out**

- The overview's shading colours beyond the existing palette, the wording of "how far checked" beyond the spec's
  words ("verified · cabin only" included), the board's default row count beyond 10, typography and any other visual
  system change: the later design steps (colorize, clarify, typeset, polish; spec §17 revision 48 item 7). The spec's
  own rules for each (one scale, the numeric legend, no colour-only meaning, the banned words, the "verified" rule, 10
  rows then "Show 10 more") are in scope.
- `PriceCell`, `Provenance` and `ClassBadge` beyond using them (WP9 owns them; this package adds no second price
  renderer and changes their props only if a face variant it needs is missing, as a new prop).
- The estimate and budget surfaces, and the status bar beyond its progress link and its Run now on Dates (WP9, WP18).
- The coverage route's content and the cell route (WP8; read here as they are).
- History beyond its nav place and one test's retired-route assertion (WP10 Task 10.11).
- Alerts rules, digests and their wording beyond the link (WP11).
- Any change to discovery, selection, verification or the engine's runs (WP7); the providers (WP5, WP6, WP14, WP15).
- The status report (WP18) beyond the `data` card's link.
- Windows, CI matrix changes other than the mutation workflow's web shard (WP16b, WP17).

## 3. Spec sections

- **§1**: success is stated through the Dates view: name the cheapest acceptable date pair and how far it was checked.
- **§6.5**: `/results` reads the whole space or one date pair's cells across the airport pairs in scope; sorting and
  filtering stay client-side.
- **§6.6**: the six buckets, the roll-up precedence a date pair's mark uses across its airport pairs, "searched" only
  in the coverage section.
- **§8.3**: a POST booking's email link opens that row's date pair detail,
  `/?view=results&def=…&depart=…&return=…&basis=…&row=…`.
- **§9 items 1, 4, 5, 6**: the core tables and property tests, the engine link test, the route tests (honesty, bound,
  422s, query count, size), the web state, keyboard, provenance and phone tests, the Playwright smoke and the
  performance test; `rankDatePairs` and the figure precedence on the mutation list.
- **§10**: the date-pairs route and its shape, bounds and compression; `/results`' scope parameters; the retired
  routes.
- **§11**: the two-tier nav, the `?view=` rules, the Dates view top to bottom, the date pair detail, provenance on
  every price through `PriceCell`, accessibility.
- **§16**: work package 19, first failing test "a date pair priced only on a filtered-out airport pair has no figure".
- **§17 revision 48**: Ian's decisions and rulings, what moved and what was dropped, the briefs and documents to align.

Plan decisions carried: 36 (truncated "cheapest of the rows read"; its Phase 4 placement of the max journey filter is
superseded), 38 ("cached from £X", the flat scale under ten figures or a 10% spread), 52 (History reads the executions
list), 53 (a filter is honest: a filtered read equals a definition holding only those airports), 54 (superseded and
not-seen marks), 58 (minima picked over confirmed offers before dedup).

## 4. Interfaces consumed

From merged packages, unchanged:

```ts
// @gmt/core
export function addDays(date: IsoDate, n: number): IsoDate;
export function daysBetween(a: IsoDate, b: IsoDate): number;
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours' | 'maxAgeAssumed'>, now: IsoDateTime): EffectiveAge;
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;   // fresher first; unknown loses to known
export function isStale(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime, thresholdHours: number): boolean;
export function generateCells(space: ResolvedSpace): Cell[];   // origins sorted, destinations sorted, then day, then nights
export function resolveSpace(def, today: IsoDate): { space: ResolvedSpace; … };
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;
export type Buckets = { priced; empty; no_data; error; skipped; not_run; reused };   // counts
export const priceCellSchema, coverageSummarySchema, executionSummarySchema, provenanceSchema, bucketsSchema;
export type ResultRow;   // z.infer<typeof resultRowSchema>

// @gmt/api (apps/api/src/read)
export function loadRows(def: SearchDefinition, ports: Ports, executionIds?: readonly string[]): Loaded;
export function confirmedIn(loaded: Loaded): (r: ResultRow) => boolean;
export function coverageSummaryFor(latestParent: Execution | null, executions: readonly Execution[], ports: Ports, space: ResolvedSpace): CoverageSummary;
export function onDemandSearched(executions: readonly Execution[], ports: Ports, space: ResolvedSpace): Execution[];
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
export function hrefWith(patch: Record<string, string | null>): string;
export function updateSearchParams(patch: Record<string, string | null>, mode?: 'push' | 'replace'): void;
export function navigateTo(patch: Record<string, string | null>): (e: NavClick) => void;
export function useSearchParams(): URLSearchParams;
export function useNow(): IsoDateTime;
export function useMediaQuery(q: string): boolean;
// views/Calendar: CellPanel, PanelSections, panel.ts (moved into the detail's per-airport-pair panel by Task 19.6);
// scale.ts's BAND_COLOURS, BAND_CLASSES, FLAT_CLASS, PRICELESS_CLASS, MIN_BANDED_DAYS (moved to views/Dates/shade.ts);
// views/Coverage/CoverageView's body (moved into views/Dates/CoverageSection.tsx); Results/CalendarGapBanner.
```

## 5. Interfaces produced

```ts
// packages/core/src/api-contract/datePairs.ts (beside results.ts; re-exported through api-contract/index.ts)
// The wire form of the query: every value a string as Hono's c.req.query() gives it. The api turns it into the
// typed scope and answers 422 itself (§10's "else 422"; the route wrapper's schema failures answer 400, so the range
// and membership rules are not in this schema).
export const datePairsQuerySchema = z.object({
  origins: z.string().max(200).optional(),          // comma list
  destinations: z.string().max(200).optional(),     // comma list
  maxJourneyMinutes: z.string().max(10).optional(), // integer 60..6000, checked by the api
});
export const datePairsResponseSchema;   // §10's shape exactly, as a z.strictObject, with one superRefine for §10's
                                        // refinement (a single linear pass; no per-pair allocation)
export type DatePairsResponse = z.output<typeof datePairsResponseSchema>;
export const MAX_DATE_PAIR_CELLS = 50_000;   // §10's fixed bound
export const MAX_DATE_PAIRS = 36_400;        // 400 × 91

// packages/core/src/api-contract/results.ts, resultsQuerySchema gains (strings; the api checks them, 422 per §10):
//   departureDate?: IsoDate; returnDate?: IsoDate; origins?: string; destinations?: string

// packages/core/src/datePairs/space.ts
export interface DatePairSpace { departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export function stayCount(s: DatePairSpace): number;                  // maxNights − minNights + 1
export function dayCount(s: DatePairSpace): number;                   // daysBetween(from, to) + 1
export function datePairCount(s: DatePairSpace): number;              // dayCount × stayCount
export function datePairAt(s: DatePairSpace, i: number): { departureDate: IsoDate; returnDate: IsoDate; nights: number; dayIndex: number };
export function datePairIndex(s: DatePairSpace, departureDate: IsoDate, returnDate: IsoDate): number | null; // null outside
export function airportPairsOf(origins: readonly Iata[], destinations: readonly Iata[]): Array<{ origin: Iata; destination: Iata }>; // generation order

// packages/core/src/datePairs/figure.ts
export type FigureCandidate = Pick<ResultRow,
  'cell' | 'verdictClass' | 'pricePence' | 'provenance' | 'stale' | 'notSeenInLatest' | 'superseded' | 'totalMinutes'>;
export type Figure<T extends FigureCandidate> =
  | { basis: 'verified'; chosen: T; cheaperCached: T | null }
  | { basis: 'calendar'; chosen: T; cheaperCached: null };
export function pickVerifiedFigure<T extends FigureCandidate>(rows: readonly T[]): T | null; // seen, then fresh, then cheaper; ties keep input order
export function pickCalendarFigure<T extends FigureCandidate>(rows: readonly T[]): T | null; // current before superseded, then cheapest
export function pickFigure<T extends FigureCandidate>(candidates: readonly T[], now: IsoDateTime): Figure<T> | null;
export interface FigureScope { space: DatePairSpace; origins: readonly Iata[]; destinations: readonly Iata[]; maxJourneyMinutes: number | null }
export function figuresByDatePair<T extends FigureCandidate>(candidates: readonly T[], scope: FigureScope, now: IsoDateTime):
  { figures: Map<number, Figure<T>>; journeyLeftOut: Map<number, number> };  // journeyLeftOut: see open question 1

// packages/core/src/datePairs/decode.ts
export interface DatePairFigure {
  price: { pricePence: number; provenance: Provenance; stale: boolean; ageHours: number | 'unknown'; truncated: boolean };
  basis: 'verified' | 'calendar';
  origin: Iata; destination: Iata; airportPair: number;   // airportPair: generation order within scope
  superseded: boolean;
  notSeenInLatest: { ageHours: number | 'unknown' } | null;
  journeyMinutes: number | null;
  cheaperCached: { pricePence: number; provenance: Provenance; stale: boolean } | null;
}
export interface DatePair {
  index: number; departureDate: IsoDate; returnDate: IsoDate; nights: number;
  buckets: Buckets;   // the six over the airport pairs in scope, `reused` inside them (never a seventh)
  selected: number; itinerarySearched: number; onDemand: number; unconfirmed: number; partiallyVerified: number;
  figure: DatePairFigure | null;
}
export interface DecodedDatePairs {
  executionId: string | null; executions: ExecutionSummary[];
  discoveryProviders: ProviderId[]; verificationProviderConfigured: boolean;
  space: DatePairSpace; scope: DatePairsResponse['scope']; summary: CoverageSummary;
  pairs: DatePair[];   // every date pair, index order
}
export function decodeDatePairs(r: DatePairsResponse, now: IsoDateTime): DecodedDatePairs;

// packages/core/src/datePairs/rank.ts
export function compareDatePairs(a: DatePair, b: DatePair, now: IsoDateTime): number; // both with a figure
export function rankDatePairs(pairs: readonly DatePair[], now: IsoDateTime): DatePair[]; // those with a figure, best first

// packages/core/src/datePairs/bands.ts
export const MAX_NIGHT_BANDS = 12;
export interface NightsBand { from: number; to: number }
export function foldNights(minNights: number, maxNights: number): NightsBand[];

// packages/db: ItinerariesRepo gains
latestVerificationOutcomes(definitionId: string, cabin: Cabin): Map<string, CellOutcome>; // cellKeyString → newest priced|empty

// packages/engine/src/alerts/templates.ts
export function appRowLink(appBaseUrl: string | null, definitionId: string, basis: ResultBasis, rowKey: string,
  cell: Pick<CellKey, 'departureDate' | 'returnDate'>): string;   // ?view=results&def&depart&return&basis&row

// apps/web/src/state/view.ts
export type ViewId = 'dates' | 'results' | 'history' | 'definitions' | 'providers' | 'alerts' | 'status';
export const NAV_TIERS: readonly { id: 'decide' | 'setup'; views: readonly ViewId[] }[]; // decide: dates, history; setup: definitions, providers, alerts, status
// apps/web/src/state/landing.ts
export type Landing =
  | { kind: 'view'; view: ViewId; patch: Record<string, string | null> }  // patch applied with replace
  | { kind: 'row-lookup'; row: string; basis: 'verified' | 'calendar' | null };  // needs the whole-space /results read
export function land(params: URLSearchParams, def: { destinations: readonly Iata[] } | null, space: DatePairSpace | null): Landing;
// apps/web/src/state/datesState.ts
export const DATES_PARAMS = { nights: 'd.nights', from: 'd.from', to: 'd.to', journey: 'd.journey', sort: 'd.sort', coverage: 'd.coverage' } as const;
export interface DatesUiState { nights: { min: number; max: number } | null; from: Iata[]; to: Iata[]; journey: number | null;
  sort: { key: 'price' | 'departure' | 'nights' | 'journey'; dir: 'asc' | 'desc' }; coverageOpen: boolean }
export function parseDatesState(p: URLSearchParams, def: { origins: readonly Iata[]; destinations: readonly Iata[] }): DatesUiState;
export function datesPatch(s: Partial<DatesUiState>): Record<string, string | null>;
export function detailHref(pair: DatePair): string;   // ?view=results&depart&return&basis, every d.* kept
```

The "Show 10 more" count is component state, not a URL parameter: §11 puts the filters, the sort and the coverage
section in the URL, not how many rows are shown.

## 6. Library notes

Versions from the lockfile (plan Task 0.1 list and later pins). Verified 2026-10-26.

- **Hono 4.13.13** (`apps/api`): `import { compress } from 'hono/compress'`; `compress({ encoding: 'gzip' })`,
  `threshold` default 1024 bytes, the default content-type filter covers `application/json`. Mounted for one path:
  `app.use('/api/definitions/:id/date-pairs', compress({ encoding: 'gzip' }))` in `createApp` before the route loop
  (the middleware sits beside `noStore` and the hardening middleware; order: after them, so a refused request is never
  compressed work). Verified with context7 `/honojs/website` (docs/middleware/builtin/compress.md). The response
  carries `Content-Encoding: gzip` only when the request's `Accept-Encoding` names gzip; the route test asserts both
  cases.
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
  jsdom tests spy on it (jsdom has no `animate`); `matchMedia('(prefers-reduced-motion: reduce)')` read through the
  existing `useMediaQuery`.
- **User Timing API** (browser built-in): `performance.mark('gmt:dates-response')` when the date-pairs body has been
  parsed and `performance.mark('gmt:dates-drawn')` in an effect after the board and overview commit; the performance
  test reads `performance.getEntriesByName`. Marks cost nothing measurable and carry no data.
- **@stryker-mutator/core 10.0.0** (new in `apps/web`): the command runner as `apps/api` uses it, with `--mutate` on
  the CLI while iterating.

## 7. Files

**Create**

- `packages/core/src/datePairs/{space,figure,rank,bands,decode,index}.ts`, `packages/core/src/api-contract/datePairs.ts`;
  tests `packages/core/test/datePairs/{space,figure,rank,bands,decode}.test.ts`,
  `packages/core/test/api-contract/datePairs.test.ts`, `packages/core/test/helpers/datePairs.ts` (response builder).
- `apps/api/src/read/datePairs.ts`, `apps/api/src/read/calendarGap.ts` (moved out of `calendar.ts`);
  `apps/api/test/routes/datePairs.test.ts`, `apps/api/test/routes/datePairsBound.test.ts`,
  `apps/api/test/routes/resultsScope.test.ts`.
- `apps/web/src/views/Dates/{DatesView,DatesHeader,Board,BoardCard,Overview,OverviewMonth,Legend,Readout,Filters,
  CoverageSection,States}.tsx`, `apps/web/src/views/Dates/{board,howFar,stayScope,shade,overview,keys,flip}.ts`,
  `apps/web/src/state/{datesState,landing}.ts`, `apps/web/src/views/Results/{AirportPairPanel,DetailHeader,
  RowLanding}.tsx`; tests under `apps/web/test/views/dates/`, `apps/web/test/state/{datesState,landing}.test.ts`,
  `apps/web/test/views/results/detail.test.tsx`, `apps/web/test/fixtures.dates.ts`, `apps/web/test/msw/datesHandlers.ts`.
- `apps/web/stryker.config.json`; `apps/web/e2e/perf.spec.ts`, `apps/web/e2e/perfFixtures.ts`.

**Modify**

- `packages/core/src/api-contract/{results,index}.ts`, `packages/core/src/index.ts`, `packages/core/stryker.config.json`,
  `packages/core/test/api-contract/{contract,wp10}.test.ts`, the core barrel tests.
- `packages/db/src/repositories/itineraries.ts` (+ its test).
- `apps/api/src/app.ts` (compress on the one path), `apps/api/src/routes/results.ts`, `apps/api/src/read/{results,
  pick,rows}.ts`, `apps/api/test/routes/{views,contract-sweep,results}.test.ts`, `apps/api/test/helpers/seed.ts`,
  `apps/api/test/wiring/buildPorts.test.ts` (only where it names a retired route).
- `packages/engine/src/alerts/templates.ts`, `packages/engine/test/alerts/templates.test.ts`.
- `apps/web/src/{App.tsx,copy.ts}`, `apps/web/src/state/view.ts`, `apps/web/src/components/{Nav,StatusBar,
  StatusCard}.tsx`, `apps/web/src/api/{endpoints,queries,types}.ts`, `apps/web/src/views/Results/*`,
  `apps/web/package.json` (`mutate` script, Stryker devDependency, `test:tz` paths), the web tests that pin the old
  view list (`test/app/shell.test.tsx`, `test/app/shellBoundary.test.tsx`, `test/app/wp10Wiring.test.tsx`,
  `test/state/resultsState.test.ts`, `test/copy/{catalogue,renderedSweep}.test.ts(x)`, `test/views/status.test.tsx`,
  `test/views/history.test.tsx`, `test/views/definitions/create.test.tsx`, `test/e2e/selectors.test.tsx`),
  `apps/web/e2e/{smoke.spec.ts,selectors.ts}`, `apps/web/playwright.config.ts` (the `@perf` tag).
- Root `package.json` (`mutate` runs `@gmt/web`'s), `.github/workflows/mutation.yml` (a `web` shard and gate),
  `scripts/workflows.test.mjs`.
- `docs/setup.md`, `apps/web/PRODUCT.md`.

**Delete**

- `apps/web/src/views/{Calendar,Duration,Coverage}/` (after the pieces named in §4 are moved),
  `apps/web/src/state/calendarState.ts`, `apps/web/test/views/{calendar/,duration.test.tsx,coverage.test.tsx}`,
  `apps/web/test/state/calendarState.test.ts`, `apps/web/test/fixtures.wp10.ts`'s calendar and duration builders and
  `apps/web/test/msw/wp10Handlers.ts`'s two handlers (History's stay).
- `apps/api/src/read/{calendar,duration}.ts` (the gap moved first).

## 8. Tasks

### Task 19.1: `core`: the space arithmetic, the contract, the decoder, the figure precedence, `rankDatePairs` and band folding (first failing test)

**Files**: create `packages/core/src/datePairs/*`, `packages/core/src/api-contract/datePairs.ts`, their tests and
`packages/core/test/helpers/datePairs.ts`; modify the barrels and `packages/core/stryker.config.json`.
**Consumes**: §4's core helpers. **Produces**: §5's core interfaces.

- [ ] **Write the failing tests.**

  **First failing test (§16)**, `test/datePairs/figure.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { figuresByDatePair } from '../../src/datePairs/figure.js';
  import { asIata, asIsoDate } from '../../src/types/ids.js';
  import { calendarRow, NOW } from '../helpers/rows.js';

  const space = { departureFrom: asIsoDate('2027-03-14'), departureTo: asIsoDate('2027-03-15'), minNights: 10, maxNights: 11 };
  // why: the row helpers take the schema's input shape, so the cell is plain strings and needs no brand helper.
  const onPair = (origin: string, destination: string) => ({
    origin, destination, departureDate: '2027-03-14', returnDate: '2027-03-24', nights: 10,
  });

  describe('a figure is the cheapest across the airport pairs in scope (decision 53)', () => {
    it('a date pair priced only on a filtered-out airport pair has no figure', () => {
      const priced = calendarRow({ cell: onPair('LGW', 'EWR'), pricePence: 31_200 });
      const { figures } = figuresByDatePair([priced], {
        space, origins: [asIata('LHR')], destinations: [asIata('JFK'), asIata('EWR')], maxJourneyMinutes: null,
      }, NOW);
      // index 0 is 14 Mar, 10 nights: the only priced cell of that date pair is LGW→EWR, outside the scope
      expect(figures.has(0)).toBe(false);
      // and the same price is the figure once its airport pair is in scope
      const all = figuresByDatePair([priced], {
        space, origins: [asIata('LHR'), asIata('LGW')], destinations: [asIata('JFK'), asIata('EWR')], maxJourneyMinutes: null,
      }, NOW);
      expect(all.figures.get(0)?.chosen.pricePence).toBe(31_200);
    });
  });
  ```

  Then, in the same file, table-driven over `pickFigure` (each case names the §11 branch it pins): fresh verified wins
  over a cheaper calendar price and carries it as `cheaperCached`; a fresh verified price above every calendar price
  has `cheaperCached` null; stale verified against calendar, the fresher wins (`compareAges`), equal ages go to
  verified, unknown age loses to known on either side, two unknowns go to verified; stale verified alone is the figure
  (stale); calendar alone; neither gives null; a `partially-verified` and a `failed` candidate are never chosen, even
  when cheapest and alone (null); `pickVerifiedFigure` prefers a seen over a not-seen, then a fresh over a stale, then
  the cheaper, and keeps input order on a full tie; `pickCalendarFigure` prefers a current over a superseded price
  even when the superseded one is cheaper, and returns the cheapest superseded one when nothing is current.
  `figuresByDatePair`: candidates outside the space are dropped; `maxJourneyMinutes` 600 drops a candidate with
  `totalMinutes` 601, keeps 600 and keeps `null`; a date pair whose every candidate was dropped for a known journey
  time has no figure and `journeyLeftOut` counts its airport pairs (open question 1); two airport pairs of one date
  pair give one figure, the cheaper by the precedence, wherever it sits.

  `test/datePairs/space.test.ts`: `datePairAt` and `datePairIndex` are inverse over a space crossing a month end
  (2027-01-30 to 2027-02-02), the leap day (2028-02-28 to 2028-03-01, 29 Feb present) and the 2027→2028 boundary;
  `datePairIndex` is null for a departure outside the window, a nights value outside the range and a return before the
  departure; `datePairCount` is 182 × 12 = 2,184 for the worked example's default space and 400 × 91 = 36,400 at the
  largest; `airportPairsOf(['LHR','LGW'], ['JFK','EWR'])` is LGW→EWR, LGW→JFK, LHR→EWR, LHR→JFK (sorted, as
  `generateCells`, asserted against `generateCells` on a one-day space).

  `test/datePairs/rank.test.ts`, table-driven (one row per tie rule, each built so only that rule decides):

  | case | a | b | first |
  |---|---|---|---|
  | price | £300 calendar | £310 verified | a |
  | equal price, basis | £300 calendar | £300 verified | b |
  | equal price and basis, fresher | £300 verified, 2 h | £300 verified, 30 h | a |
  | unknown age last | £300 calendar, age unknown | £300 calendar, ≤7 d | b |
  | earlier departure | 14 Mar, 12 n | 15 Mar, 10 n | a |
  | fewer nights | 14 Mar, 12 n | 14 Mar, 10 n | b |
  | superseded after current | £200 calendar, superseded | £900 calendar | b |
  | not seen after current | £200 verified, not seen | £900 calendar | b |
  | truncated ranked by amount | £250 calendar, truncated | £260 calendar | a |

  Property tests (`fast-check`): `rankDatePairs` is a total order (antisymmetric, transitive, `compare(a, a) === 0`
  only for the same index) and its output is the same for every permutation of its input; pairs without a figure never
  appear; a truncated figure's flag survives (it is the decoder's, carried on the pair). The airport-pair tie of §11
  is not coded: every date pair has one figure and a distinct index, so the departure and nights ties already make the
  order total (a `// why:` in `rank.ts` says so; a coded airport-pair step would be a mutant no test can kill).

  `test/datePairs/bands.test.ts`: 12 stay lengths (10–21) stay 12 single-night bands; 13 (10–22) fold into 7 bands of
  2, the last of 1 (22–22); 91 (1–91) fold into 12 bands of 8, the last of 3 (89–91); a
  property that for every `1 ≤ min ≤ max ≤ 91` the bands are contiguous, in order, cover `[min, max]` exactly, number at
  most 12, and all but the last share one width; `foldNights(5, 4)` throws `RangeError`.

  `test/api-contract/datePairs.test.ts`: the helper's valid worked-example response parses; each §10 refinement
  rejects its own malformed response with an issue at its path, one test per rule: a `pairs` column not
  `days × stays` long; `figures` columns of different lengths; `pair` not strictly ascending, and out of range; a
  provenance, origin or destination index out of range; a bucket, `reused`, `selected`, `itinerarySearched`,
  `onDemand`, `unconfirmed` or `partiallyVerified` value above `scope.airportPairs` or not an integer; six buckets
  summing to neither `airportPairs` nor 0; `superseded` true on a verified figure; `notSeenInLatestAgeHours` non-null on
  a calendar figure; `cheaperCachedProvenance` null while `cheaperCachedPence` is not (and the reverse);
  `scope.cells` above 50,000; an unknown key (strict). The query schema accepts the three strings and rejects an
  unknown key.

  `test/datePairs/decode.test.ts`: every date pair comes back in index order with its dates (across the month end,
  the leap day and the year boundary), nights and buckets; every figure carries its full provenance from the table
  (`provenanceSchema.parse` on each), its airport pair named by `scope.origins[o]` and `scope.destinations[d]`, its
  truncated, superseded and not-seen marks, its journey time; `cheaperCached` carries its own provenance and `stale`
  from `isStale` with `calendarStaleAfterHours[provider]` (falling back to `staleAfterHours`); a response with no
  figures decodes every pair with `figure: null`; `buckets.reused` is the `reused` column.

- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/datePairs test/api-contract/datePairs.test.ts`
  → every file fails to load: `src/datePairs/figure.ts` (and the others) do not exist ("Failed to load url" / "Cannot
  find module").
- [ ] **Implement.** The load-bearing parts, in full:

  ```ts
  // packages/core/src/datePairs/figure.ts (spec §11 "The figure"; plan decisions 38, 53, 54, 58)
  export function pickVerifiedFigure<T extends FigureCandidate>(rows: readonly T[]): T | null {
    // why: decision 54 then 58: a price the newest search returned beats one it did not, a fresh one a stale one, then
    // the cheaper; the first wins a full tie, and callers pass candidates in generation order, so the pick is stable.
    const key = (r: T) => [r.notSeenInLatest === null ? 0 : 1, r.stale ? 1 : 0, r.pricePence] as const;
    let best: T | null = null;
    for (const r of rows) {
      if (best === null) { best = r; continue; }
      const a = key(r); const b = key(best);
      const i = a.findIndex((x, k) => x !== b[k]);
      if (i >= 0 && (a[i] ?? 0) < (b[i] ?? 0)) best = r;
    }
    return best;
  }

  export function pickCalendarFigure<T extends FigureCandidate>(rows: readonly T[]): T | null {
    const cheapest = (xs: readonly T[]) => xs.reduce<T | null>((m, r) => (m === null || r.pricePence < m.pricePence ? r : m), null);
    return cheapest(rows.filter((r) => !r.superseded)) ?? cheapest(rows);
  }

  export function pickFigure<T extends FigureCandidate>(candidates: readonly T[], now: IsoDateTime): Figure<T> | null {
    // why: §11: partially-verified and failed prices are never the figure; 'unchecked' is a calendar price.
    const v = pickVerifiedFigure(candidates.filter((x) => x.verdictClass === 'verified'));
    const c = pickCalendarFigure(candidates.filter((x) => x.verdictClass === 'unchecked'));
    const cheaper = (shown: T) => (c !== null && c.pricePence < shown.pricePence ? c : null);
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
  export function compareDatePairs(a: DatePair, b: DatePair, now: IsoDateTime): number {
    const fa = a.figure; const fb = b.figure;
    if (fa === null || fb === null) throw new RangeError('compareDatePairs: both date pairs need a figure');
    const current = (f: DatePairFigure) => (f.superseded || f.notSeenInLatest !== null ? 1 : 0);
    return (
      current(fa) - current(fb) ||
      fa.price.pricePence - fb.price.pricePence ||
      (fa.basis === fb.basis ? 0 : fa.basis === 'verified' ? -1 : 1) ||
      compareAges(effectiveAge(fa.price.provenance, now), effectiveAge(fb.price.provenance, now)) ||
      // why: the index orders by departure, then nights (generation order); each date pair has one figure and one
      // index, so the order is total here and §11's last tie (the airport pair's order) can never be reached.
      a.index - b.index
    );
  }
  export function rankDatePairs(pairs: readonly DatePair[], now: IsoDateTime): DatePair[] {
    return pairs.filter((p) => p.figure !== null).sort((a, b) => compareDatePairs(a, b, now));
  }
  ```

  ```ts
  // packages/core/src/datePairs/bands.ts (spec §11 "Folded bands")
  export function foldNights(minNights: number, maxNights: number): NightsBand[] {
    if (!Number.isInteger(minNights) || !Number.isInteger(maxNights) || maxNights < minNights)
      throw new RangeError(`foldNights: ${minNights}–${maxNights} is not a stay range`);
    const n = maxNights - minNights + 1;
    const width = n > MAX_NIGHT_BANDS ? Math.ceil(n / MAX_NIGHT_BANDS) : 1;
    const bands: NightsBand[] = [];
    for (let from = minNights; from <= maxNights; from += width)
      bands.push({ from, to: Math.min(from + width - 1, maxNights) });
    return bands;
  }
  ```

  `space.ts`: `datePairAt` is `dayIndex = Math.floor(i / stays)`, `nights = minNights + (i % stays)`, dates by
  `addDays`; `datePairIndex` uses `daysBetween` and returns null outside. `figuresByDatePair` drops candidates whose
  cell is outside the space or whose airport is outside `origins`/`destinations`, drops (and counts per airport pair)
  those with `totalMinutes !== null && totalMinutes > maxJourneyMinutes`, groups the rest by `datePairIndex`, and calls
  `pickFigure` per group. `decodeDatePairs` walks `pairs` once and `figures` once (no per-pair search). The contract's
  `superRefine` is one pass over the columns, reporting the first offending index per rule.
  Add the six files to `packages/core/stryker.config.json`'s `mutate` and move them in this brief's front matter from
  `pending` to `mutate` in the same commit.
- [ ] **Run to verify they pass**: the same command, green; `pnpm --filter @gmt/core test` green at 100%;
  `pnpm --filter @gmt/core exec stryker run --mutate src/datePairs/figure.ts,src/datePairs/rank.ts --concurrency 2`
  ≥ 80%.
- [ ] **Commit**: `wp19: date-pair figure, ranking, bands and decoder in core`.

### Task 19.2: The api: the date-pairs route and `/results`' scope parameters

**Files**: `apps/api/src/read/datePairs.ts`, `read/calendarGap.ts` (moved), `read/{results,pick,rows}.ts`,
`routes/results.ts`, `app.ts`; `packages/db/src/repositories/itineraries.ts`; `packages/core/src/api-contract/{index,
results}.ts` (the ROUTES entry and the scope fields); tests named in §7.
**Consumes**: Task 19.1; §4's api helpers. **Produces**: `GET /api/definitions/:id/date-pairs`; `/results` scoped.

- [ ] **Write the failing tests** (`test/routes/datePairs.test.ts`, over a migrated in-memory database seeded through
  `test/helpers/seed.ts`, the worked example's four airport pairs):
  - **Airport filtering honesty (decision 53)**: for `origins=LHR` and for `destinations=JFK`, every bucket count, every
    verification count, every figure (price, provenance, basis, airport pair, marks) and the summary equal those of a
    second definition holding only those airports, seeded with the same cells; a date pair priced only on LGW→EWR has no
    figure under `origins=LHR` and counts only its in-scope buckets (the §16 test, at the route).
  - Columns in generation order and of equal length; `executionId` the latest parent; children included in figures
    (an on-demand child's verified price becomes a figure) and counted in `onDemand`; decision 54's marks over a
    migrated database (a calendar figure whose cell a newer parent found empty is `superseded`; a verified figure the
    latest search did not return carries `notSeenInLatestAgeHours`); `cheaperCached` columns on a fresh verified figure
    above a calendar price; a truncated tile's calendar figure carries `truncated`; a partially-verified-only date pair
    has no figure and `partiallyVerified` 1; an unconfirmed offer is never a figure (`confirmedIn`) and counts in
    `unconfirmed`.
  - **The calendar route's selection-rule tests, ported before Task 19.8 deletes them**: each `it` of
    `test/routes/views.test.ts`'s "calendar selection rules (plan decisions 53, 54; review prov-009)", "an assumed
    calendar bound reaches every price as such" and "superseded calendar prices on the views" is rewritten against the
    date-pairs route with the same seed and the same expectation on the figure.
  - `maxJourneyMinutes=600`: a verified price of 601 minutes is left out of its figure, one of 600 and a calendar price
    with no journey time stay; a date pair whose every price was left out has no figure but keeps its buckets.
  - 422s: an origin or destination outside the definition (`unknown_airport`), a journey limit that is not an integer
    from 60 to 6000 (`invalid_journey_limit`, for `abc`, `59`, `6001`, `600.5`), and a scope above 50,000 cells
    (`too-many-cells`, `details: { cells, bound: 50000 }`; seeded by raising `MAX_CELLS_PER_DEFINITION` in the test's
    config). A draft definition (no airports) answers 200 with `airportPairs: 0`, no figures, every pair all zero.
    §10 names one code, `too-many-cells`, and it is used as written; the others follow the api's existing snake_case
    codes (`unknown_destination`, `cell_not_in_space`).
  - Before the first run: `executionId` null, every pair's buckets all zero, `summary` zero.
  - **Open question 1** (recommended column): a date pair whose prices were all left out for a known journey time over
    the limit carries `journeyLeftOut` equal to those airport pairs; 0 elsewhere.
  - **Open question 2** (recommended rule): after a destination is added to a definition whose latest parent ran
    without it, each date pair's new airport pairs count as `notRun`, so the six sum to `airportPairs`.
  - Gzip: with `Accept-Encoding: gzip` the response has `Content-Encoding: gzip` and decompresses (`node:zlib`
    `gunzipSync`) to the same JSON; without it, plain JSON; no other route's response is compressed (`/results`
    checked).
  - `/results` scope (`test/routes/resultsScope.test.ts`): `departureDate` and `returnDate` narrow the rows and
    `coverage` to that date pair's cells; one without the other is 422 `date_pair_incomplete`; a date pair outside the
    current resolved space is 422 `date_pair_outside_space`; `origins`/`destinations` narrow to those airport pairs by
    the date-pairs route's rule and 422 outside the definition; with none of them, the whole space as before (the
    existing results tests stay green).
  - The contract sweep (`contract-sweep.test.ts`) covers the new route: auth required, response parses, provenance on
    every figure by shape, banned words over its strings.

  **The bound** (`test/routes/datePairsBound.test.ts`, its own file so its seed is built once): a database seeded with
  50,000 cells in scope (400 days × 25 nights × 5 airport pairs, every one priced by a calendar price, a few hundred
  verified observations, built once in `beforeAll` outside the timed test), `it(…, { timeout: 3_000 })`: the route
  answers 200; the uncompressed body is at most
  4 MiB (4 × 1024 × 1024 bytes) and the gzip body at most 512 KiB; **query count**: a spy on the database's `prepare`
  counts statements, and the 50,000-cell seed issues exactly as many as a 1,000-cell seed with the same executions and
  the same observations (no statement per cell). A second case at 36,400 date pairs (400 × 91, one airport pair, every
  one with a figure) holds the same size bounds.

  `packages/db` (`test/itineraries.test.ts`): `latestVerificationOutcomes(def, cabin)` returns for each cell
  the outcome `latestVerificationOutcomeForCell` returns, over a seed with two executions per cell and one with only an
  error (absent), in one statement.

- [ ] **Run to verify they fail**: `pnpm --filter @gmt/api exec vitest run test/routes/datePairs.test.ts
  test/routes/datePairsBound.test.ts test/routes/resultsScope.test.ts` → 404 on `/api/definitions/:id/date-pairs`
  (no route) and the scope tests fail on the unscoped row counts; `pnpm --filter @gmt/db exec vitest run
  test/itineraries.test.ts` → `latestVerificationOutcomes is not a function`.
- [ ] **Implement.**
  - `db`: `latestVerificationOutcomes` with one `SELECT` using `ROW_NUMBER() OVER (PARTITION BY origin, destination,
    departure_date, return_date ORDER BY fetched_at DESC, e.created_at DESC, e.rowid DESC)` over the same join and
    filters as `latestVerificationOutcomeForCell`; `loadRows` passes a map lookup to `notSeenResolver` instead of the
    per-cell callback (one change, every read route benefits; the existing tests pin the result).
  - `read/datePairs.ts` `assembleDatePairs(def, query, ports)`: parse the scope (comma lists split, each an IATA code
    of the definition's, empty or absent meaning all; the journey limit `/^\d+$/` and 60..6000); `space =
    currentSpace(def, today)`; `cells = datePairCount(space) × airportPairs`, over `MAX_DATE_PAIR_CELLS` → 422; one
    `loadRows`; the latest parent's discovery and verification roll-ups (`cells.rollUps`), its discovery outcomes (for
    `reused`), its selections, the on-demand children (`onDemandSearched`), read once each; per cell in scope, its
    discovery roll-up status into the date pair's bucket (a missing roll-up: open question 2); figures through
    `figuresByDatePair` over `loaded.verified.filter(confirmedIn(loaded))` and `loaded.calendar`, each in generation
    order; provenances deduplicated by a stable key into the table; columns written in one pass. `summary` is
    `coverageSummaryFor` restricted to the cells in scope (a `cellFilter` parameter added to it, default all).
  - `read/pick.ts`: `pickVerified` and `pickCalendar` delegate to `core`'s `pickVerifiedFigure` and
    `pickCalendarFigure` (one rule; the calendar-gap reference keeps using them).
  - `read/results.ts`: `assembleResults` applies the scope after `loadRows` (rows and `coverage` alike, with the same
    `cellFilter`).
  - `routes/results.ts`: `'GET /api/definitions/:id/date-pairs'` through `route({ request: NO_INPUT, query:
    apiContract.datePairsQuerySchema }, …)`; `core`'s ROUTES gains `route('GET', '/definitions/:id/date-pairs',
    datePairsResponseSchema, { query: datePairsQuerySchema })` beside `/results`.
  - `app.ts`: `app.use('/api/definitions/:id/date-pairs', compress({ encoding: 'gzip' }))`.
- [ ] **Run to verify they pass**: the same commands green; `pnpm --filter @gmt/api test` green at its thresholds.
- [ ] **Commit**: `wp19: date-pairs route and scoped results`.

### Task 19.3: The engine's alert link

**Files**: `packages/engine/src/alerts/templates.ts`, `packages/engine/test/alerts/templates.test.ts`.

- [ ] **Write the failing test**: `appRowLink(null, 'def-1', 'verified', HASH, { departureDate: '2027-03-14',
  returnDate: '2027-03-28' })` is exactly
  `/?view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=verified&row=<HASH>` (parameter order as §8.3);
  the base-URL cases of the existing test keep their path prefix with the new parameters; a rendered digest with a POST
  booking carries that link with the item's cell dates; the banned-word test over the rendered body still passes.
- [ ] **Run to verify it fails**: `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts` → the
  expected string differs (no `depart`/`return`).
- [ ] **Implement**: the new parameter, `URLSearchParams` built in §8.3's order; the call site passes `item.cell`. The
  body sentence is unchanged.
- [ ] **Run to verify it passes**; `pnpm --filter @gmt/engine test` green.
- [ ] **Commit**: `wp19: alert link opens the row's date pair`.

### Task 19.4: The Dates view: data, header line, filters and the board

**Files**: `apps/web/src/api/{endpoints,queries,types}.ts`, `src/state/datesState.ts`, `src/views/Dates/{DatesView,
DatesHeader,Filters,Board,BoardCard,States,board.ts,howFar.ts,stayScope.ts,flip.ts}`, `copy.ts`; tests under
`test/views/dates/`, `test/state/datesState.test.ts`, `test/fixtures.dates.ts`, `test/msw/datesHandlers.ts`;
`apps/web/stryker.config.json`, `apps/web/package.json`, root `package.json`, `.github/workflows/mutation.yml`,
`scripts/workflows.test.mjs`.
**Consumes**: Task 19.1's decoder and ranking; Task 19.2's route.

- [ ] **Write the failing tests** (Testing Library over msw, fake timers, `test/fixtures.dates.ts` building responses
  through Task 19.1's helper so every fixture passes the contract):
  - **State**: `parseDatesState` reads `d.nights=10-14`, `d.from=LHR,LGW`, `d.to=JFK`, `d.journey=900`,
    `d.sort=journey.asc`, `d.coverage=open`; an airport outside the definition, a reversed or malformed range, a
    journey outside 60..6000 and an unknown sort key are ignored, never an error; `datesPatch` round-trips.
  - **Query**: the endpoint sends `origins`, `destinations` and `maxJourneyMinutes` from the state and nothing for the
    stay range; changing `d.to` issues a new request and, until it answers, the board shows loading, never the
    previous (unfiltered) figures (the msw handler holds the filtered answer on a promise the test resolves).
  - **One component test per §11 state**: no search ("No search yet" linking to Definitions); never run ("Not run yet:
    nothing has been searched", the estimate and Run now; the overview's all-not-searched cells are Task 19.5's); run in progress (board
    captioned "partial: run in progress", date pairs not yet reached read not searched); paused and budget-stopped
    (the reason, Resume, "the board shows prices found before the pause", the not searched count); stale (the header's
    stale label only when every figure is stale, and each stale figure labelled); no prices but coverage ("No prices in
    this run" with the coverage line and marks; no "no flights"); thin coverage (the next-move line when more than half
    the counted cells are no cached data, with the coverage-check link and "not evidence that no flights exist");
    synthetic banner present and absent; too many cells (the 422's cell count, the bound and the airport filter named
    as the way under it); no price within the filters (the board's line, the coverage line over the filtered scope with
    its not searched and error counts, a filtered scope partly not searched and one in error, "Clear filters"); loading;
    load error with Retry.
  - **Header line**: names the run with status and age ("run finished 2h ago", "run in progress, started 40 min ago",
    "run paused 3h ago: <reason>"); the coverage line in §11's form over the cells in scope, linking to the coverage
    section; with filters set, "2 of 4 airport pairs · 10–14 nights"; the stay filter re-sums the header from the
    decoded pairs' own counts; the calendar-gap banner when a verification provider is configured, with its verify
    action.
  - **Board**: a `table` captioned "Best dates"; columns rank, depart, return, nights, price, how far checked, journey
    time, airports; rows in `rankDatePairs` order; the rank stays the price rank whatever the sort; sort buttons for
    price (default), departure, nights and journey time with `aria-sort`, a second press reverses, unknown journey time
    last both ways, the sort written to `d.sort`; 10 rows, then "Show 10 more" adding 10, with "showing 10 of P date
    pairs with a price"; "cached from £X" through `PriceCell` on a verified figure hiding a cheaper calendar price;
    "superseded by a later search", "not seen in latest search (<age>)" and "cheapest of the rows read" on their
    figures; journey time "not known" when null, and "journey time not known" on a kept row under a journey filter;
    "none within <limit>" with its marks on a date pair whose prices were all left out (open question 1), never on one
    that had no price; each row's dates are a link to `detailHref` carrying the figure's basis, and a click elsewhere on
    the row follows it.
  - **How far checked** (`howFar.ts`, table-driven): class verified or a calendar price; itinerary-searched, selected
    but not reached, or not selected; partially-verified and unconfirmed counts; the date pair's airport pairs without a
    price by bucket ("3 no cached data"); a truncated figure says the read was cut short; never "searched", never a
    banned word, "verified" only beside a class-verified figure.
  - **Run landing and re-ranking**: while the latest parent run is pending or running, a progress change from the
    status bar's execution poll re-reads the route at most once per 30 s (fake timers: two changes 10 s apart give one
    read; a change at 31 s gives a second); a read that changes the order moves rows in one transition of at most
    200 ms (the injected `animate` called once per moved row with `duration ≤ 200`) and none under
    `prefers-reduced-motion: reduce`; focus stays on the same date pair's row, or moves to the caption when that row
    leaves the shown rows; the scroll position is unchanged; one `role="status"` region says "Best dates updated" once
    per read, never per row.
  - **Phone (375 px, below 900 px)**: the board is stacked cards, each a link to the detail; dates and price lead
    (`PriceCell` face: provider mark, destination, short age, "not checked" on a calendar price), then how far checked,
    then journey time and airports; point of sale is not on the card; no sideways scroll.
  - **Provenance**: every amount on the board and the cards renders inside `[data-testid="price-cell"]`; a figure whose
    provenance is removed from the table fails to render (the boundary's message, no amount in the DOM).
  - **Mutation workflow**: `scripts/workflows.test.mjs` expects a `web` entry in `mutate` (one shard) and in
    `mutation-gate`.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates test/state/datesState.test.ts`
  → modules missing; `pnpm exec vitest run scripts/workflows.test.mjs` → no `web` shard.
- [ ] **Implement.** `DatesView` decodes with `decodeDatePairs`, ranks with `rankDatePairs`, applies the stay range in
  `stayScope.ts` (filters the decoded pairs and sums their counts for the header), and renders the board from
  `board.ts` (sort, page size). `flip.ts` measures row tops in `useLayoutEffect` and calls the injected
  `animate(el, [{ transform: 'translateY(Δpx)' }, { transform: 'none' }], { duration: 200 })`, skipped under reduced
  motion. The re-read hook watches the status bar's execution query (same key, no second poll) and invalidates
  `['date-pairs', id]` through an injected clock. `performance.mark` as §6 says. `apps/web/stryker.config.json` mirrors
  `apps/api`'s (command `pnpm exec vitest run --coverage.enabled=false --bail=1 test/views/dates test/state`,
  `StringLiteral` excluded for the same reason: the words are pinned phrase by phrase), with this task's logic files
  in `mutate` (`src/state/datesState.ts`, `src/views/Dates/{board,howFar,stayScope}.ts`); they move from `pending` to
  `mutate` in this brief in the same commit.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test` green at 70% lines, 60% branches.
- [ ] **Commit**: `wp19: dates view header, filters and board`.

### Task 19.5: The overview

**Files**: `apps/web/src/views/Dates/{Overview,OverviewMonth,Legend,Readout,CoverageSection}.tsx`,
`{overview,keys,shade}.ts`; tests `test/views/dates/{overview,keyboard,marks,coverageSection}.test.tsx`,
`test/views/dates/{shade,overviewModel,keys}.test.ts`.

- [ ] **Write the failing tests:**
  - **Coverage marks never read as no flights**: for each unpriced bucket alone (empty, no_data, error, skipped,
    not_run) and mixed with the others, the cell's mark, its readout, its accessible name and the board's how far
    checked use that bucket's words; no text anywhere says "no flights"; only `empty` says "no fares"; a not searched
    date pair is never shaded; a date pair with some airport pairs not searched, priced or not, carries the striped
    "partly not searched" mark; with several airport pairs, the cell's bucket is §6.6's precedence over their roll-ups
    (table-driven against an independent enumeration).
  - **Shading** (`shade.ts`): one scale for verified and calendar figures by quintile of rank among the date pairs in
    view; fewer than ten figures, or a spread under 10% of the cheapest, gives the flat shade and the legend says so;
    a calendar figure carries the "not checked" mark; the legend is numeric and always open: each mark in words with its
    count in view, the bands as price ranges, what "not checked" means; no cell prints an amount.
  - **Folded bands**: 13 or more stay lengths fold by `foldNights`; a band cell shows its cheapest figure's shade and
    the striped mark when any date pair in it has a not searched cell; click or Enter opens the band for that month,
    Escape or the band's header closes it; a ring on a date pair in a closed band rings the band.
  - **Keyboard**: one tab stop (roving tabindex); Left/Right by reading order (stay lengths, then the next day), Up/Down
    a week, PageUp/PageDown a month, Home/End the first and last cell of the day, across a month end and into an open
    band; Enter on a cell opens the detail with the date pair in the URL, on a closed band opens the band; focus always
    visible (a solid outline class asserted). Across the whole view, Tab reaches the filters, the board's sort buttons,
    each row's link, "Show 10 more", the overview's one tab stop and the coverage section's toggle, in that order.
  - **Coverage section** (what the Coverage view held, moved, not rewritten): folded by default; the header line's
    coverage link, `d.coverage=open` and `?view=coverage` (Task 19.7) open it; counts per stage × provider with the
    six-bucket breakdown and "searched" as the umbrella beside it (the one place it appears) with the "with a price"
    share; selected but not reached with reason; the browser provider's left cells with §3's texts; overrun and parity
    flags worded by unit; the error list with Retry only on a cell that has not departed; "schedule blocked since
    <date>"; the on-demand searches with their own buckets and calls; a line saying the filters do not narrow it. The
    retired `coverage.test.tsx` cases are carried over here before Task 19.8 deletes that file.
  - **Readout and names**: pointing at or focusing a cell shows its date pair in one line beside the legend (dates,
    nights, the figure through `PriceCell` row form with how far checked and airports, or its marks with counts by
    bucket); the cell's accessible name gives dates, nights and rank or mark in words, and its `aria-describedby` is
    the readout, so an amount is read only from `PriceCell`'s output.
  - **Rings both ways**: the board's shown rows are ringed (an outline class, not colour alone); hovering or focusing a
    row lights its cell and a ringed cell lights its row; neither calls `scrollIntoView` (spy).
  - **Phone**: one month at a time with Previous and Next month buttons and a swipe (pointer events), each day a row
    with its strip across the width, every cell at least 24 px square, no sideways scroll at 375 px.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/dates/overview.test.tsx
  test/views/dates/keyboard.test.tsx test/views/dates/marks.test.tsx test/views/dates/shade.test.ts` → modules missing.
- [ ] **Implement.** Desktop: each month a table captioned by its name, weeks as rows, each day cell holding its strip
  of stay-length (or band) buttons; at most 400 × 12 = 4,800 cells drawn, plus one open band-month, which keeps the DOM
  bounded at the worst case. `shade.ts` takes `BAND_COLOURS`, `BAND_CLASSES`, `FLAT_CLASS` and `PRICELESS_CLASS` from
  the retired `scale.ts` unchanged (no new palette). Add `overview.ts`, `keys.ts` and `shade.ts` to the web Stryker list
  and to this brief's `mutate`.
- [ ] **Run to verify they pass**; `pnpm --filter @gmt/web test`.
- [ ] **Commit**: `wp19: dates overview, legend, readout and keyboard`.

### Task 19.6: Results as the date pair detail, with the per-airport-pair panels

**Files**: `apps/web/src/views/Results/{ResultsView,ResultsHeader,BasisSwitch,AirportPairPanel,DetailHeader}.tsx`,
the panel pieces moved from `views/Calendar`; tests `test/views/results/detail.test.tsx` and the existing results tests.

- [ ] **Write the failing tests:**
  - `?view=results&depart=2027-03-14&return=2027-03-28` reads `/results` with `departureDate`, `returnDate` and the
    Dates airport filter (`origins`, `destinations` from `d.from`/`d.to`); rows and header are that date pair's only.
  - Header: the dates and nights, "2 of 4 airport pairs" under a filter, then "cheapest found £X · <destination>
    <dates> · <basis> · <verdict class> · <provider> · <age>" and the coverage line over the date pair's cells, linking
    to the Dates coverage section.
  - The basis switch opens on `basis=` from the link (a calendar figure's row opens on the calendar basis) and else on
    §6.9's default, and the header says why; switching keeps the date pair.
  - "Back to dates" links to `?view=dates` with every `d.*` parameter kept and `depart`, `return`, `basis`, `row`
    removed.
  - One panel per airport pair in scope, from the cell route: outcomes per stage and provider with reasons (the browser
    provider's left-cell texts), prices each with full provenance through `PriceCell` (superseded marked), and, with a
    verification provider, "Search <cell> for itineraries (uses billed calls)" stating "hard stop 6 calls · 40 calls of
    budget headroom left", naming the call cap at 0 billed calls, saying when no headroom is left, showing a refusal
    with its cap, and handing the started search to the status bar; calendar-gap cells of this date pair marked in
    their panels.
  - `row=` opens and scrolls to that row, or says the row is no longer among this date pair's results.
  - A date pair without a row says so with its coverage line and a link to the coverage section, never "no flights".
  - 375 px: price, provenance, the class badge, dates and stops stay on the primary row.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/views/results` → the scoped request
  is missing its parameters and the header lacks the date pair.
- [ ] **Implement**; the panel is the Calendar's `CellPanel`/`PanelSections` moved, not rewritten.
- [ ] **Run to verify they pass**; **Commit**: `wp19: results as the date pair detail`.

### Task 19.7: The two-tier nav and the `?view=` landing rules

**Files**: `apps/web/src/state/{view,landing}.ts`, `components/{Nav,StatusBar,StatusCard}.tsx`,
`views/Results/RowLanding.tsx`, `App.tsx`, `copy.ts`; tests `test/state/landing.test.ts`, `test/app/shell.test.tsx`,
`test/components/{statusBar,statusLink}.test.tsx`, `test/views/status.test.tsx`.

- [ ] **Write the failing tests:**
  - **Old `?view=` URLs land on Dates** (`land`, table-driven): absent or unknown → Dates; `calendar` and `duration` →
    Dates keeping `def=`; `calendar` with `cal.dest=JFK` → `d.to=JFK` (a destination outside the definition is
    dropped), other `cal.*` removed; `coverage` → Dates with `d.coverage=open`; `results` with a date pair in the
    current resolved space → the detail; `results` with a date pair outside it, a malformed one or none → Dates;
    `results` without a valid date pair but with `row=` → a row lookup. Every landing rewrites the URL with `replace`
    (the back button does not loop) and an unknown parameter is ignored, never an error.
  - The row lookup (`RowLanding`): it reads the whole-space `/results` with the link's basis; a row found opens its
    date pair's detail with `row=` kept; a row not found opens Dates with "That result is no longer in this search's
    results." (open question 3 for a truncated read).
  - The nav: two lists, each headed by its tier's name in text, Decide (Dates, History) and Set up (Definitions,
    Providers, Alerts, Status); real links; `aria-current="page"` and a non-colour cue on the current view; Results is
    not in the nav; every link at least 44 px tall (`min-h-11`); at 375 px each tier is one row, its name first.
  - The status bar shows Run now on Dates; its progress breakdown links to `?view=dates&d.coverage=open`; a search's
    Status `data` card links to that search's Dates view with its coverage section open.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/web exec vitest run test/state/landing.test.ts
  test/app/shell.test.tsx test/views/status.test.tsx` → `parseView` still defaults to Results; the nav has one list.
- [ ] **Implement**; add `landing.ts` to the web Stryker list and this brief's `mutate`.
- [ ] **Run to verify they pass**; **Commit**: `wp19: two-tier nav and view landing rules`.

### Task 19.8: Remove the retired views and routes

**Files**: §7's Delete list; `packages/core/src/api-contract/{results,index}.ts`, `apps/api/src/routes/results.ts`,
`apps/web/src/api/*`, `apps/web/package.json` (`test:tz` → `test/tz test/views/dates`), the tests that named them.

- [ ] **Write the failing tests first:** `packages/core/test/api-contract/contract.test.ts`'s ROUTES list no longer has
  `GET /definitions/:id/calendar` or `/duration-analysis` and has `/date-pairs`; `apiContract` exports no
  `calendarDaySchema`, `calendarQuerySchema`, `calendarResponseSchema` or `durationAnalysisResponseSchema`; History's
  "never the calendar" test asserts no request to `/date-pairs` either; the shell test's view list is the seven views.
- [ ] **Run to verify they fail**: `pnpm --filter @gmt/core exec vitest run test/api-contract` → the old routes are
  still listed.
- [ ] **Implement**: delete; move `assembleCalendarGap` to `read/calendarGap.ts` first; remove the query keys and
  invalidations for `calendar` and `duration` and add `date-pairs` to `useExecutionActions`' refresh list; keep
  `recharts` (History uses it). `grep -rn "duration-analysis\|/calendar'\|calendarState\|DurationView\|CalendarView\|
  CoverageView" apps packages --include='*.ts' --include='*.tsx'` finds nothing outside the spec, plan and briefs.
- [ ] **Run to verify they pass**: `pnpm -r typecheck`, `pnpm test`.
- [ ] **Commit**: `wp19: remove the calendar, duration and coverage views and routes`.

### Task 19.9: The Playwright smoke and the performance test

**Files**: `apps/web/e2e/{smoke.spec.ts,selectors.ts,perf.spec.ts,perfFixtures.ts}`, `apps/web/playwright.config.ts`,
`apps/web/test/e2e/selectors.test.tsx`.

- [ ] **Write the failing tests:**
  - `selectors.test.tsx`: each `SMOKE` selector (the board caption, a board row link, the overview's tab stop, an
    overview cell, a ringed cell, the legend, the phone card, Previous and Next month, the coverage section) matches the
    rendered markup in jsdom.
  - **Smoke** (fixture mode, real api and built SPA), §9 item 6 steps 1–6: (1) import the example, switch both stages to
    the fixture provider, enable, estimate, create, run now, waiting on the run's finished status in the status bar;
    (2) Dates: the header line names the run and its age, the red banner shows, the first board row carries the
    synthetic source and its age, the legend is visible, the overview's one tab stop moves by arrow with a solid focus
    outline, and hovering the first row lights its ringed cell; (3) the first row opens the detail, whose headline
    names the synthetic source and whose URL carries `depart` and `return`, and "Back to dates" returns with
    `d.nights` kept; (4) `?view=calendar` lands on Dates and `?view=coverage` on Dates with the coverage section open;
    (5) History's charts draw and its table names the synthetic source; (6) `@phone`, at 375 px: the board is stacked
    cards, the overview shows one month with Previous and Next, nothing spills out of a cell, and on Dates, the detail,
    History, Definitions, Alerts, Providers and Status the nav's two tiers keep every link in view in at most two rows
    and `document.documentElement.scrollWidth <= 375`.
  - **Performance** (`perf.spec.ts`, tagged `@perf`, desktop project): an init script installs a `longtask`
    `PerformanceObserver`; `page.route('**/api/**')` serves a synthetic definition, providers, status and executions and
    the date-pairs body from `perfFixtures.ts` for (a) 36,400 date pairs every one with a figure (400 × 91, one airport
    pair) and (b) 50,000 cells (400 days × 25 nights × 5 airport pairs), each passing `datePairsResponseSchema`; the
    board and overview are drawn within 1.5 s of the response (`gmt:dates-drawn` minus `gmt:dates-response`); a stay
    filter change and a re-rank (a second response served on the next request) each redraw within 200 ms; no long task
    over 200 ms is recorded. Each wait is `waitForFunction` on the mark, with the timeout only as a backstop.
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
  detail; History; the Set up views), the success line (the board and overview, not the calendar heatmap and the
  price-vs-stay chart), and the desk-use line ("studying the Dates board and overview, a date pair's detail and
  History"). Nothing else in the product record changes.
- [ ] **Commit**: `wp19: setup and product docs for the dates view`.

## 9. Pinned review-focus tests

- **Coverage marks never read as no flights**: each unpriced bucket alone and mixed, on the overview cell, readout,
  accessible name and how far checked; only `empty` says "no fares"; not searched never shaded; the striped mark
  (Task 19.5).
- **Airport-filter honesty (decision 53)**: a filtered read equals a definition holding only those airports; a date
  pair priced only on a filtered-out airport pair has no figure (Tasks 19.1 and 19.2); the web never shows unfiltered
  figures for a filtered key (Task 19.4).
- **Nothing conveyed by colour alone**: every mark in words, rings as outlines, the current nav entry's non-colour cue,
  the "not checked" mark on calendar shades, states in words (Tasks 19.4, 19.5, 19.7).
- **Every amount goes through `PriceCell`**: board, cards, readout, "cached from £X", the detail's rows and panels; no
  overview cell prints an amount; a figure lacking provenance fails to render (Tasks 19.4, 19.5, 19.6).
- **The banned words**: the web's catalogue and rendered-sweep tests over every new string, the engine's over the
  email body, the contract sweep over the route's strings (Tasks 19.2, 19.3, 19.4).
- **The 50,000-cell bound**: 3 s, 4 MiB, 512 KiB gzip, query count independent of cells, 422 above it (Task 19.2);
  1.5 s and 200 ms in the browser (Task 19.9).
- **Old `?view=` URLs land on Dates**: `calendar`, `duration`, `coverage`, unknown, and `results` without a date pair,
  with and without `row=` (Task 19.7, and the smoke's step 4).

## 10. Definition of done

- `pnpm --filter @gmt/core test` (100% lines, branches, functions), `pnpm --filter @gmt/db test`,
  `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test` (85% / 70%), `pnpm --filter @gmt/web test` (70% /
  60%, both time zones of `test:tz`), each green.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`, `pnpm test`.
- Mutation, each at ≥ 80% with timed-out mutants under 5% of those tested:
  `pnpm --filter @gmt/core mutate` (the six `core` files of this brief among its list) and
  `pnpm --filter @gmt/web mutate` (the eight `web` files). Every file in this brief's `pending` has moved to `mutate`
  and to its package's `stryker.config.json`, and `status` reads `merged` only after that:
  `node scripts/check-mutation-globs.mjs` exits 0 with nothing pending for WP19.
- `pnpm --filter @gmt/web e2e`: the smoke green on the desktop project and the `@phone` project at 375 px, the `@perf`
  test green on the desktop project.
- `pnpm exec vitest run scripts/wording.test.mjs scripts/workflows.test.mjs` green.
- No orphaned vitest, Stryker, Playwright or browser process after the runs.
- The PR's changed-file count stated in its description, with the CodeRabbit route it took (app at ≤ 150 files, CLI
  above), and every CodeRabbit thread fixed and resolved before the merge.

## 11. Open questions

Each needs Ian's ruling before dispatch (`requires_human_judgment`); the recommended answer is what the tasks above
assume.

1. **"none within <limit>" has no field in §10's shape.** §11 says a date pair that had at least one price and saw every
   one left out for a known journey time above the limit reads "none within <limit>", and one that had no price keeps
   its own marks. The response says neither: a left-out date pair simply has no figure, and its buckets cannot tell
   the two apart (a verified-only price, with no discovery stage, leaves `priced` at 0). `requires_human_judgment`.
   **Recommended**: add one column, `pairs.journeyLeftOut: number[]` (the airport pairs in scope whose every price was
   left out for a known journey time over the limit; 0 without the filter), with the refinement bounding it like the
   other counts, recorded as spec revision 49.
2. **A date pair whose airport pairs only partly have outcomes.** §10's refinement allows the six buckets to sum only
   to `scope.airportPairs` or 0. After an airport is added to a definition, the latest parent run has no outcome for
   the new airport pairs while it has them for the old ones, so the sum is neither. `requires_human_judgment`.
   **Recommended**: when the definition has a discovery provider and a latest parent run exists, a cell in scope with no
   discovery roll-up counts as `notRun` ("not searched"), so the sum is `airportPairs`; all six stay 0 only before the
   first run or with no discovery stage. The web reads both as not searched, as the calendar did.
3. **`row=` beyond the whole-space read's 1,000 rows.** §11 sends an old email's `row=` through the whole-space
   `/results` read, which returns at most 1,000 rows; a row ranked past them reads "That result is no longer in this
   search's results." though it still is. `requires_human_judgment`. **Recommended**: when the read is `truncated` and
   the row is not found, say "That result is not among this search's cheapest 1000 results." instead, which is true in
   both cases.
