---
wp: 10
title: "web: Calendar (View B), Duration (View C), History, Playwright smoke"
owner: sonnet
depends_on: [9]
spec_sections: ["§11 View B", "§11 View C", "§11 History", "§11 Accessibility", "§8.1 Staleness per price", "§3", "§10", "§9 item 6", "§5.5"]
reviewers: [code-architect, test-strategy-reviewer, ui-reviewer, persona-flexible-traveller, provenance-auditor, product-owner]
status: draft
---

# WP10 — web: Calendar (View B), Duration (View C), History, Playwright smoke

Reconciled on 2026-10-15 against spec revision 20, the plan's "Global Constraints", "API contract", "Web" and "Decisions taken at reconciliation" 1–39 (decision 38 holds this brief's round-1 rulings), the real `@gmt/core` on `main` (`d4256d5`: `api-contract/results.ts`, `labels/age.ts`, `dates/epochDay.ts`), and the WP9 brief as revised under decisions 36 and 38. Round 1 of review (24 High, 46 Medium, 32 Low) is folded into the sections below.

## 1. Goal

Replace WP9's three WP10 placeholders with the calendar heatmap (View B), the price-by-stay-length chart (View C) and the price history view, where every price carries provenance (the route-level series has the spec's exemption), "not searched" never looks like "no flights", coverage is visible without reading counts, and the browser's timezone never moves a date; add the core contract fields these views need, and one Playwright smoke that drives the real api in fixture mode.

## 2. Scope

**In**

- **Contract additions in `@gmt/core` `api-contract/results.ts`** (plan decision 38; WP8 fills them, §13): per-series `searched` flags and the `cell` of each per-nights minimum in the duration analysis; `stale` and `truncated` on history points as the api sends them (`historyPointResponseSchema`; the stored `historyPointSchema` that `@gmt/db` returns is unchanged); `priceConfirmed` on itinerary history points; `verify` (the child's call cap and each verification provider's calls left this month) on the cell detail.
- **View B Calendar** (`apps/web/src/views/Calendar/*`):
  - Each day shows one price by the spec §11 precedence (core's `compareAges`; a SearchApi verified price has age `'unknown'`), through PriceCell's compact form: price, stale label, short provider badge, compact age, dashed outline for calendar prices, destination; then the stay of the cheapest cell, "cached from £X" when the shown verified price hides a cheaper calendar price, and a coverage cue ("S/M searched", 11 px, with a solid or striped swatch). Everything else is in the side panel.
  - Colour by one basis at a time. The default basis is the calendar basis unless days showing a class-verified price are a strict majority, judged over all destinations. Quintile bands with a numeric legend; fewer than ten days or a spread under 10% gives one flat shade and the legend says why; days of the other basis are hatched.
  - Days without a price show distinct glyphs with text for `empty`, `no_data`, `error`, `skipped` and `not_run`; a day no run reaches says "not searched yet"; only a definition without a discovery provider says "no discovery provider configured".
  - A per-destination filter. The contract carries coverage counts per day, not per destination, so a filtered day shows no glyph and no fraction and says "coverage counts cover all destinations".
  - A bucket total that disagrees with its buckets shows "counts inconsistent".
  - Filter, basis and (at phone width) month live in the URL. At phone width one month is drawn at a time as a compact grid.
  - Keyboard: an APG grid with arrows, Home/End, PageUp/PageDown, Enter/Space and visible focus.
  - Side panel: the day's six-bucket marker and its prices with full provenance; a cell picker; the cell's outcomes per run (newest first, the latest run marked, reasons in words); its prices; the per-cell verify action through WP9's `useExecutionActions().verify`, with the child's call cap and the month's calls left beside it, a named budget-cap refusal, and the button hidden without a verification provider.
- **View C Duration** (`apps/web/src/views/Duration/*`): Recharts 3 bars per nights for the verified series and one calendar series per provider, labelled from the prices' own provenance with `n` in the label, the tooltip and a note defining it; per-series gaps ("not searched" / "searched, no price", "not itinerary-searched" / "itinerary-searched, no price"); "ns" on the axis for a nights value no series searched; stale minima drawn faded with a heavy outline; a table with destination, note, `n` and departure date per minimum, each nights value linking to Results filtered to it.
- **History** (`apps/web/src/views/History/*`): route history by pair (or all pairs overlaid), the pair in the URL; fetch-time series (calendar per provider; itinerary offers split into confirmed and "price not confirmed by the final step", dashed) joined only between consecutive scheduled runs (gap ≤ 1.5 × the refresh period); Google's indicative route-level series in its own chart, price by travel date; tables of every point with stale and "cheapest of the rows read" labels; the cross-execution ViewHeader; an itinerary heading from the cached Results row.
- **Review focus 3** (dates): the weekday, month and instant forms join WP9's `src/format.ts` (the one date-formatting module, plan decision 38); `src/lib/time.ts` parses instants; a no-Date guard over `apps/web/src`; a TZ suite under `America/Los_Angeles` and `Asia/Tokyo` covering the calendar grid and WP9's Results date columns.
- **Copy** in WP9's `src/copy.ts`: `providerShort`, `calendarView`, `durationView`, `historyView`, with SAMPLES in WP9's catalogue test.
- **WP9 files extended** (§12): `format.ts`, `copy.ts`, `api/{types,endpoints,queries}.ts`, `components/{PriceCell,Provenance}.tsx`, `App.tsx`, `views/Results/ExpandedRow.tsx`, `test/msw/handlers.ts`, `test/copy/catalogue.test.ts`, `test/app/shell.test.tsx`, `vitest.config.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`.
- **Playwright smoke in fixture mode**: Results, Calendar, Duration and History in a real browser on the synthetic run, plus a 375 px project; excluded from `pnpm test`.

**Out**

- **WP9:** the shell, nav, status bar, `ViewHeader` (including its `ageHours: number | 'unknown'` and cross-execution variant), `Provenance`, `PriceCell`'s full form and its `truncated` prop, `PriceBoundary`, the client, `COPY` base entries (including `truncatedNote`), `NowContext`, `format.ts`'s `formatIsoDate`/`formatIsoDateShort`, URL state, Definitions, Results, Coverage, Providers, and the msw test API. WP10 edits only the WP9 files named in §12.
- **WP8:** every route; filling the fields this brief adds (§13); `stale`, `ageHours` and `truncated` per price; the in-process fixture host (WP4b's wiring).
- **WP7:** the child call cap and the dry-run that WP8 reads for `verify` (§13).
- **WP0/WP1:** everything else in `@gmt/core` the views consume.
- **WP11:** the Alerts view.

## 3. Spec sections and plan decisions

- **§11 View B:** precedence (a fresh class-verified price, else the fresher of a stale verified price and the cheapest calendar price, unknown age losing to known, else glyphs); colour by one basis on a quintile scale over that basis's visible days, fallback days hatched and named in the legend; the six-bucket marker "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M" and "itinerary-searched K of N selected +C on demand"; distinct glyphs; a numeric legend; a per-destination filter; a side panel with cells, outcomes and verify.
- **§11 View C:** bars per nights with axis titles (nights, £); "min among verified (class verified, n=…)" and calendar per provider; `n` in label and tooltip; explicit empty and loading states; gaps for unsearched nights; no interpolation.
- **§11 History:** one series per provider and kind; x is `fetchedAt` for provider series and the point's own `date` for the route-level series; gaps; reused rows excluded (by the api); axis titles; empty state.
- **§11 vocabulary and provenance:** "Google date grid via SearchApi", "Google Flights via SearchApi", "Aviasales cache", "itinerary-search basis"; provenance on every price visible without hover; dashed outline and "constraints not checked" for calendar prices; destination and the operator's note; every view header names its executions, status, age and stale label. Accessibility: keyboard-operable calendar, visible focus, labelled controls, no colour-only meaning.
- **§8.1:** `stale` per price comes from the api; stale prices are labelled, never hidden; unknown age loses to known; ties go to verified. Single-cell verification: the child's call cap and the hidden action without a verification provider.
- **§3:** six buckets summing to M; reused counted inside its bucket; "verified" only for the class; stage counts say "itinerary-searched". SearchApi itinerary prices carry `maxAgeHours: 'unknown'` (rev 15).
- **§10:** calendar, duration-analysis, cells, `/cells/verify`, itinerary and route history, all under `/api`.
- **§9 item 6:** View B states including the partial-day six-bucket marker and the per-basis scale with hatched fallback days; chart empty and loading states; the numeric legend; keyboard operation; banned words; a price lacking provenance fails to render; one Playwright smoke in fixture mode. (§9 item 6 and the §16 table say "five-way marker"; spec §3 defines six buckets, §13.)
- **§5.5:** synthetic data is labelled on every view beside the red banner.
- **Plan decisions consumed:** 14 (`resultRowKey`, `?row=`), 15 (route history one point per run), 21 (`DEFAULT_DISCOVERY_REFRESH_HOURS`), 24 (SearchApi itinerary age unknown), 25 (child caps, budget stops), 27 and 37 (unconfirmed offers stored unverified, "price not confirmed by the final step"), 30 and 36 (`truncated`, "cheapest of the rows read"; one PriceCell for every price; contract parsing in production), 38 (this brief's rulings).

## 4. Interfaces consumed

From `@gmt/core` on `main` (real signatures):

```ts
// types/ids.ts
export type Iata = string & { readonly __brand: 'Iata' };
export type IsoDate = string & { readonly __brand: 'IsoDate' };
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };
export const isoDateSchema;   // z.string().refine(real YYYY-MM-DD).transform(→ IsoDate): the one brand mint WP10's src uses (monthDays)
export const isoDateTimeSchema;   // the toISOString form only
export function asIata(s: string): Iata; export function asIsoDate(s: string): IsoDate; export function asIsoMonth(s: string): IsoMonth; // tests and seeds
export const isoDateTimeOfEpochMs: (ms: number) => IsoDateTime;
// types/provenance.ts, types/definition.ts, types/execution.ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export interface Provenance { providerId; sourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime; maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;
export interface ProvidersConfig { discovery: ProviderId[]; verification: ProviderId[]; discoveryRefreshHours: Partial<Record<ProviderId, number>> }
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }
// dates/epochDay.ts
export function toEpochDay(date: IsoDate): number; export function fromEpochDay(day: number): IsoDate;
export function addDays(date: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number; export function monthOf(date: IsoDate): IsoMonth;
// labels/age.ts
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown';
export function formatDuration(hours: number): string; export function formatAgeFull(a: EffectiveAge): string; export function formatAgeCompact(a: EffectiveAge): string;
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;   // < 0 when a is fresher; unknown loses to any known; two unknowns tie
// alerts/evaluate.ts (plan decision 21), results/rowKey.ts, text/money.ts, text/bannedWords.ts
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;
export function formatPence(pence: number): string;
export const BANNED_WORD_ALLOWLIST: readonly string[]; export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export type CalendarDay = z.infer<typeof apiContract.calendarDaySchema>;
export * as apiContract from './api-contract/index.js';
```

From `api-contract/results.ts` on `main` (verbatim shapes; Task 10.1 changes the four marked ⊕):

```ts
const pricedCell = priceCellSchema.extend({ cell: cellSchema });
calendarDaySchema { date: IsoDate; discovery: Array<{ providerId; buckets: Buckets; total }>; verification: { selected; itinerarySearched; onDemand };
  cheapestVerified: (PriceCell & { cell; itineraryHash }) | null; cheapestPartiallyVerified: (PriceCell & { cell; itineraryHash; count }) | null;
  cheapestCalendar: (PriceCell & { cell }) | null; byDestination: Array<{ destination: Iata; cheapestVerified: PriceCell | null; cheapestCalendar: PriceCell | null }> }
calendarResponseSchema { days; executions: ExecutionSummary[]; staleAfterHours: number; calendarStaleAfterHours: z.partialRecord(ProviderId, number) }
⊕ durationAnalysisResponseSchema { byNights: Array<{ nights; minVerified: (PriceCell & { n }) | null; minCalendar: Array<{ providerId; price: PriceCell; n }>; searched: boolean }>; executions }
cellOutcomeSchema = CellKey & { executionId; stage; providerId; status: 'not_run' | 'priced' | 'empty' | 'no_data' | 'error' | 'skipped'; reason: string | null; attempts; lastError: string | null; fetchedAt: IsoDateTime | null; minPence; cabin; pointOfSale; sourceKind; reusedFromExecutionId: string | null }
⊕ cellDetailResponseSchema { cell: Cell; outcomes: CellOutcome[]; calendarPrices: Array<PriceCell & { executionId; calendarPriceId }>; observations: ResultRow[] }
⊕ historyPointSchema { at: IsoDateTime; pricePence; provenance }    // @gmt/db's offerHistory and route history return this type
routeSeriesPointSchema { date: IsoDate; pricePence; fetchedAt: IsoDateTime; providerId; sourceKind }
⊕ itineraryHistoryResponseSchema { itineraryHash; series: Array<{ providerId; seller; cabin; points: HistoryPoint[] }> }
⊕ routeHistoryResponseSchema { origin; destination; calendarSeries: Array<{ providerId; cabin; points: Array<HistoryPoint & { cell; executionId }> }>; routeSeries: Array<{ providerId; cabin: Cabin | 'unknown'; points: RouteSeriesPoint[] }> }
executionSummarySchema { id; status; isChild; startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null; ageHours: number | 'unknown' }   // newest first
```

From WP9 (`docs/briefs/wp09-web-shell-definitions-results.md`, real names; the four lines marked ★ are WP9's revisions under decisions 36 and 38, which WP10 builds on):

```ts
// src/copy.ts
export const COPY: { loading; loadFailed(m); actionFailed(m); priceWithheld; placeholder(wp); provider: Record<ProviderId, string>;
  source: Record<SourceKind, string>; classLabel: Record<VerdictClass | 'unchecked', string>; basisName: { verified: 'itinerary-search basis'; calendar: 'calendar basis' };
  bucket: { priced; empty: 'no fares'; no_data: 'no cached data'; error; skipped; not_run: 'not searched' }; reusedNote(n); stageName; statusName; stale; staleView;
  constraintsNotChecked; fxApprox; fxTitle(d, s); cabinName: Record<Cabin, string>; verifyCell; verifyStarted; none; importExample; runNow; syntheticBanner; … } as const;
★ COPY.truncatedNote: 'cheapest of the rows read'                                     // decision 36
// src/format.ts (the web's one date-formatting module, decision 38)
export function formatIsoDate(d: string): string;        // '2027-03-14' → '14 Mar 2027', string slicing
★ export function formatIsoDateShort(d: string): string; // '2027-03-14' → '14 Mar'
export { formatPence };
// src/components
export interface PriceCellProps { pricePence: number; provenance: Provenance | undefined; calendar: boolean; stale: boolean; destination?: string | undefined; destinationNote?: string | null | undefined;
★   truncated?: boolean | undefined }                                                  // decision 36: renders COPY.truncatedNote
export function PriceCell(props: PriceCellProps): JSX.Element;      // throws without valid provenance; renders data-testid="provenance"
export interface ProvenanceProps { provenance: Provenance | undefined; calendar: boolean; destination?: string | undefined; destinationNote?: string | null | undefined }
export class PriceBoundary;                                           // renders COPY.priceWithheld (role="alert") instead of a broken price
★ export type ViewHeaderProps = { title: string; executions: ReadonlyArray<Pick<ExecutionSummary, 'id' | 'status' | 'ageHours'>>; stale: boolean }
★   | { title: string; span: { runs: number; firstAt: IsoDateTime; lastAt: IsoDateTime } | null; stale: boolean };   // decision 38 cross-execution variant
export function ViewHeader(props: ViewHeaderProps): JSX.Element;    // executions line "showing run <id8> (<status>, <age>)"; stale line COPY.staleView
// src/api
export class ApiError extends Error { readonly status: number; readonly code: string; readonly details: unknown }
export async function call<T>(method: Method, path: string, opts?: { params?; query?; body? }): Promise<T>;   // parses with the route's contract schema
export const api: { providers(); …; verifyCell(body: { definitionId: string; cell: CellKey }) };
export const qk: { providers; definitions; results(id, basis); execution(id); coverage(id); calendarGap(id); airports(q) };
export function useProviders(); export function useExecutionActions(): { cancel; resume; start; verify: UseMutationResult<…, { definitionId: string; cell: CellKey }> };
export type ProvidersResponse; export type DefinitionResponse; export type ResultsResponse; export type ExecutionSummary; export type PriceCellData; export type ResultRow;
// src/now.tsx, src/hooks/useMediaQuery.ts, src/state/urlState.ts
export function useNow(): IsoDateTime; export const NARROW_QUERY = '(max-width: 639px)'; export function useMediaQuery(q: string): boolean;
export function useSearchParams(): URLSearchParams; export function updateSearchParams(patch: Record<string, string | null>, mode?: 'push' | 'replace'): void;
export function hrefWith(patch: Record<string, string | null>): string; export function navigateTo(patch: Record<string, string | null>): (e: MouseEvent<HTMLAnchorElement>) => void;
// Results URL keys: f.nights = '<min>-<max>'; row = resultRowKey
// test/
export const API = 'http://localhost:3000/api';   // test/fixtures.ts; handler URLs append only the route tail
export const provSearch: Provenance; export const provCalendar: Provenance; export const summary: (status?, ageHours?) => ExecutionSummary;
export function definition(over?); export function resultsResponse(over?); export function verifiedRow(over?); export function calendarRow(over?); export function providersResponse(over?);
export const NOW: IsoDateTime;   // '2026-10-14T15:00:00.000Z'
export function renderWithProviders(ui, opts?: { search?: string }): RenderResult & { user; client: QueryClient };
export const server;             // started in test/setup.ts; unhandled requests are errors (msw 3: onUnhandledFrame: 'error')
export function setViewportWidth(px: number): void;   // test/viewport.ts; setup starts every test at 1280
```

WP9's guards that WP10 passes: the source guard (no literal JSX text or literal `aria-label`/`title`/`placeholder`/`alt`/`label` with a letter in any `.tsx`); the catalogue test (every `COPY` function sampled, no banned word, "verified" only on allowed paths); the rendered-DOM sweep over every view.

## 5. Interfaces produced

```ts
// @gmt/core api-contract/results.ts (Task 10.1)
export const historyPointResponseSchema;   // historyPointSchema + { stale: boolean; truncated: boolean }
// durationAnalysisResponseSchema.byNights[]: minVerified: (PriceCell & { cell; n }) | null; minCalendar[].price: PriceCell & { cell };
//   searched: { verification: boolean; discovery: Array<{ providerId; searched: boolean }> }
// itineraryHistoryResponseSchema.series[].points: Array<HistoryPointResponse & { priceConfirmed: boolean }>
// routeHistoryResponseSchema.calendarSeries[].points: Array<HistoryPointResponse & { cell; executionId }>
// cellDetailResponseSchema.verify: { maxCalls: number; providers: Array<{ providerId; monthCallsLeft: number | null }> } | null
// src/format.ts (appended to WP9's module)
export const WEEKDAYS: readonly ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function weekdayIndex(d: IsoDate): number;           // Monday = 0
export function formatDayOfMonth(d: IsoDate): string;       // '14'
export function formatDayShort(d: IsoDate): string;         // 'Sun 14 Mar'
export function formatDayLong(d: IsoDate): string;          // 'Sun 14 Mar 2027'
export function formatIsoMonth(m: IsoMonth): string;        // 'March 2027'
export function monthDays(m: IsoMonth): IsoDate[];
export function formatInstantLondon(ms: number): string;    // '14 Mar 2027, 15:00' (Europe/London)
export function formatInstantDateLondon(ms: number): string; // '14 Mar 2027' (Europe/London)
// src/lib
export function instantMs(t: string): number; export function dateMs(d: IsoDate): number; export function dateOfMs(ms: number): IsoDate;   // time.ts
export function discoverySourceLabel(providerId: ProviderId, providers: ProvidersResponse | undefined): string; export function sourceLabelOf(kinds: Iterable<SourceKind>): string;   // sources.ts
export const SERIES_COLOURS; export function seriesColour(i: number): string;   // palette.ts
// src/api
export type CalendarResponse, DurationResponse, CellDetailResponse, ItineraryHistoryResponse, RouteHistoryResponse; export type { CalendarDay } from '@gmt/core';
api.calendar(id); api.durationAnalysis(id); api.cellDetail(id, cell); api.itineraryHistory(hash); api.routeHistory(origin, destination, cabin);
qk.calendar(id); qk.duration(id); qk.cell(id, key); qk.itineraryHistory(hash); qk.routeHistory(origin, destination, cabin);
export function whileRunning(data): number | false; export function useCalendar(id); export function useDurationAnalysis(id);
export function useCellDetail(id, cell: CellKey | null); export function useRouteHistories(pairs, cabin, enabled); export function useItineraryHistory(hash: string | null);
// src/components/PriceCell.tsx, Provenance.tsx
PriceCellProps.compact?: boolean; ProvenanceProps.compact?: boolean;   // the calendar day form
// src/views/Calendar
export type DayPrice; export interface DaySlice; export interface GridDay; export type GlyphStatus; export type DayBasis;
export function bucketTotal(b); export function searchedCount(b); export function countsConsistent(d); export function formatDiscoveryMarker(d); export function formatVerificationMarker(v);
export function totalReused(slices); export type Coverage; export function coverageOf(slice): Coverage; export interface SliceOptions; export function sliceForDestination(day, destination, o): DaySlice;
export function DayMarker({ slice }); export function ReusedNote({ count }); export function CoverageCue({ coverage });
export type GlyphReason; export type DayDisplay; export function resolveDayDisplay(slice, now): DayDisplay; export interface CalendarModel;
export function buildCalendarModel(days, colourBasis, now): CalendarModel; export function defaultColourBasis(days, hasVerification, now): DayBasis;
export type Band; export type ScaleMode; export interface LegendEntry; export interface QuintileScale; export const MIN_BANDED_DAYS = 10;
export const BAND_CLASSES; export const FLAT_CLASS; export const PRICELESS_CLASS; export function quintileBand(sorted, v): Band; export function buildScale(values): QuintileScale;
export const FOCUS_RING; export function targetOf(date, key): IsoDate | null; export function CalendarGrid({ days, model, months, destinationNotes, onOpen });
export function CalendarLegend({ model, filtered }); export function cellsForDay(def, date): CellKey[]; export function orderOutcomes(outcomes, executions);
export function reasonText(reason): string; export function noHeadroom(v): boolean; export function CellPanel({ definition, date, slice, executions, initialCell, onClose });
export const CALENDAR_PARAMS; export function parseDestination(raw, destinations); export function parseBasis(raw); export function CalendarView({ definition });
// src/views/Duration
export type DurationPrice; export interface DurationCell; export interface DurationRow; export interface DurationSeries; export interface DurationData;
export function buildDurationData(resp, minNights, maxNights, hasVerification): DurationData; export function barValue(row, key): number | null; export function gapLabel(cell, kind): string;
export function rowAt(rows, label); export function DurationTooltip({ active, label, data }); export function DurationChart({ data, tableId }); export function DurationTable({ data, id, notes }); export function DurationView({ definition });
// src/views/History
export type RoutePoint; export type PlotPoint; export interface PlotLine; export type RoutePlotPoint; export interface RouteLine; export const CONNECT_FACTOR = 1.5;
export function refreshHoursOf(providers, id); export function runCadenceHours(providers); export function connectLimitMs(hours); export function withGaps(points, limitMs, gap);
export function linesFromRoute(resp, providers, pair?): { fetch: PlotLine[]; route: RouteLine[] }; export function linesFromItinerary(resp, providers): PlotLine[];
export function historySpan(lines); export function newestAllStale(lines); export function HistoryChart; export function RouteChart; export function HistoryTable; export function RouteTable;
export const HISTORY_PARAMS; export const MAX_OVERLAY_PAIRS = 6; export function historyHref(hash): string; export function findCachedRow(entries, hash); export function HistoryView({ definition });
// src/copy.ts
COPY.providerShort, COPY.calendarView, COPY.durationView, COPY.historyView
```

## 6. Library notes

Versions are from plan Task 0.1 (already in `apps/web/package.json` on `main`). Everything below was checked on 2026-10-15 against the installed packages in a scratch assembly of this brief (§10).

- **recharts 3.10.1:**
  - Components used: `BarChart`, `Bar` (function `dataKey`, `name`, `isAnimationActive={false}`, `<Cell>` children for per-entry `fillOpacity`, `stroke`, `strokeWidth`), `LineChart`, `Line` (per-line `data`, function `dataKey`, `connectNulls={false}`, `strokeDasharray`), `XAxis`/`YAxis` (`label={{ value, position, angle, offset }}`, `tickFormatter`, `type="number"`, `scale="time"`, `domain={['dataMin', 'dataMax']}`, `allowDuplicatedCategory={false}`), `Tooltip` (`content` receives `TooltipContentProps` with `active` and `label`), `Legend`, `CartesianGrid`, `ResponsiveContainer`.
  - Rendered DOM the tests read: the chart surface is `svg[role="application"]` (legend icons are `svg.recharts-surface` too); each drawn bar is a `path.recharts-rectangle` inside `g.recharts-bar`, and a `null` value draws none; extra props on `<Cell>` (`data-stale`) pass to the path; a line is `path.recharts-line-curve` whose `d` has one `M` per unbroken segment, and a line with one point draws no curve.
  - History has no tooltip: with one `data` array per line on a time axis, a shared tooltip pairs points by index, not by time; the tables are the record of every point.
  - jsdom: `ResponsiveContainer` measures its container with `getBoundingClientRect()` and observes it with `ResizeObserver`; `test/setup-charts.ts` installs a no-op `ResizeObserver` (a class implementing the interface, no cast) and sizes only `.recharts-responsive-container` at 800×320.
- **@playwright/test 1.64.1:** `defineConfig`, `devices['Desktop Chrome']`, `projects[]` with `grep`, `grepInvert` and `dependencies`, `webServer` as an array (`env` merges over `process.env`); locators `getByRole`, `getByTestId`, `getByText`, `locator`; `toBeVisible`, `toContainText`, `toHaveClass`, `toHaveCount`, `toHaveCSS`, `expect(fn).toPass({ timeout })`; `page.evaluate` for the scroll-width check.
- **vite 8.3.4:** `preview.proxy` defaults to `server.proxy`, so `vite preview` reuses the dev proxy; the proxy target reads `GMT_API_ORIGIN`.
- **react 19.3.1:** `useState`, `useRef`, `useEffect`, `useMemo`, `useId`.
- **@tanstack/react-query 5.104.2:** `useQuery({ queryKey, queryFn, enabled, refetchInterval: (query) => … })`, `useQueries({ queries })`, `useQueryClient().getQueriesData<T>({ queryKey })`, `setQueryData` (tests).
- **msw 3.0.3:** WP9's `server`; tests prepend `server.use(http.get(\`${API}/…\`, …))` with `HttpResponse.json(body, { status })` and `delay(…)`. msw 3 names the unhandled-request option `onUnhandledFrame` (`lib/_chunks/shared-options.d.ts`); WP9's setup must pass `onUnhandledFrame: 'error'` (its current text says `onUnhandledRequest`, which msw 3 does not type and ignores).
- **vitest 5.0.4:** `pool: 'forks'` (assigning `process.env.TZ` in a forked worker re-detects the zone); `setupFiles` run before the test file is imported; coverage `thresholds` accept glob keys with their own floors; under jsdom, `fileURLToPath(new URL(…, import.meta.url))` throws ("The URL must be of scheme file"), so file-reading tests use `import.meta.dirname`.
- **zod 4.6.7:** builders parse through `apiContract.*Schema.parse`; `z.input<typeof schema>` types a builder argument that accepts plain strings.
- **Intl:** `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', … }).format(epochMs)` takes a number, so `format.ts` never builds a `Date`.
- **Biome 2.5.15:** `noNoninteractiveElementToInteractiveRole` flags the APG grid roles on `<table>`/`<td>`; the grid carries one `// biome-ignore` comment on each `role` attribute with the reason, the only suppressions in WP10.
- **dataviz skill:** axis titles with units, one legend per chart, no dual axes, a sequential single hue for the heatmap with a clearly tinted lightest band, a categorical palette for series, and a dash or outline style backing every colour.

## 7. Files

**Create**

- `packages/core/test/api-contract/wp10.test.ts`
- `apps/web/src/lib/{time.ts,sources.ts,palette.ts}`
- `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx,display.ts,scale.ts,model.ts,CoverageCue.tsx,CalendarGrid.tsx,CalendarLegend.tsx,CellPanel.tsx,CalendarView.tsx,calendar.css}`
- `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`
- `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,HistoryView.tsx}`
- `apps/web/test/fixtures.wp10.ts`, `apps/web/test/msw/wp10Handlers.ts`, `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts`
- `apps/web/test/lib/{dates,time,sources,noDateParsing}.test.ts`, `apps/web/test/components/priceCellCompact.test.tsx`
- `apps/web/test/views/calendar/{marker.test.tsx,display.test.ts,scale.test.ts,grid.test.tsx,panel.test.tsx,view.test.tsx}`
- `apps/web/test/views/duration.test.tsx`, `apps/web/test/views/history.test.tsx`, `apps/web/test/app/wp10Wiring.test.tsx`, `apps/web/test/tz/dates.tz.test.tsx`
- `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/prepare-db.mjs`

**Modify**

- `packages/core/src/api-contract/results.ts` (Task 10.1).
- WP9's files listed in §12, and the root `.gitignore` (Playwright output).

## 8. Tasks

Every command runs from the repository root. Focused runs use `pnpm --filter @gmt/web exec vitest run <files>`, which skips the coverage thresholds (plan decision 8). In the tests, `API`, `definition`, `summary`, `provSearch`, `provCalendar`, `verifiedRow`, `calendarRow`, `resultsResponse` and `providersResponse` come from WP9's `test/fixtures.ts`; `NOW` and `renderWithProviders` from `test/render.tsx`; `server` from `test/msw/server.ts`; `setViewportWidth` from `test/viewport.ts`. No `as` appears anywhere except `as const` and `satisfies`.

### Task 10.1: Contract additions in core (first failing test)

**Files:**
- Create: `packages/core/test/api-contract/wp10.test.ts`
- Modify: `packages/core/src/api-contract/results.ts`

**Interfaces:**
- Consumes: `priceCellSchema` (with WP9's `truncated`, decision 36), `cellSchema`, `providerIdSchema`, `executionSummarySchema`, `historyPointSchema`.
- Produces: the per-series `searched` and the minimum's `cell` in `durationAnalysisResponseSchema`; `historyPointResponseSchema` (`stale`, `truncated`) on both history responses; `priceConfirmed` on itinerary history points; `verify` on `cellDetailResponseSchema` (plan decision 38).

Why each field exists: the duration view must say "not itinerary-searched" where only discovery ran (one flag per nights value cannot), and must name the departure date and destination of each minimum; history points must carry the same `stale` and "cheapest of the rows read" labels as every other price; unconfirmed offers must be told apart from confirmed ones; the verify button must show what the child may spend. `historyPointSchema` itself is unchanged because `@gmt/db`'s `offerHistory` and route history return its type; WP8 adds the flags when it answers.

- [ ] **Step 1: Write the failing test**

`packages/core/test/api-contract/wp10.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cellDetailResponseSchema,
  durationAnalysisResponseSchema,
  historyPointSchema,
  itineraryHistoryResponseSchema,
  routeHistoryResponseSchema,
} from '../../src/api-contract/index.js';

// WP10's contract additions (plan decision 38; spec §11 View B, View C, History). WP8 fills every field.
const provenance = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 48,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};
const cell = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2027-03-14',
  returnDate: '2027-03-28',
  nights: 14,
};
const price = { pricePence: 41200, provenance, stale: false, ageHours: 50, truncated: false };
const point = { at: '2026-10-14T13:00:00.000Z', pricePence: 41200, provenance };

describe('WP10 contract additions (plan decision 38)', () => {
  it('duration analysis: each minimum carries its cell, and searched is per series', () => {
    const night = {
      nights: 14,
      minVerified: { ...price, cell, n: 3 },
      minCalendar: [{ providerId: 'travelpayouts', price: { ...price, cell }, n: 5 }],
      searched: { verification: false, discovery: [{ providerId: 'travelpayouts', searched: true }] },
    };
    const ok = durationAnalysisResponseSchema.safeParse({ byNights: [night], executions: [] });
    expect(ok.success).toBe(true);
    // why: the old single flag can no longer say a stay length was itinerary-searched when only discovery ran.
    expect(
      durationAnalysisResponseSchema.safeParse({ byNights: [{ ...night, searched: true }], executions: [] })
        .success,
    ).toBe(false);
    const { cell: _c, ...noCell } = night.minVerified;
    expect(
      durationAnalysisResponseSchema.safeParse({
        byNights: [{ ...night, minVerified: noCell }],
        executions: [],
      }).success,
    ).toBe(false);
    const bareCalendar = [{ providerId: 'travelpayouts', price, n: 5 }];
    expect(
      durationAnalysisResponseSchema.safeParse({
        byNights: [{ ...night, minCalendar: bareCalendar }],
        executions: [],
      }).success,
    ).toBe(false);
  });

  it('history points on the wire carry stale and truncated; the stored point shape is unchanged', () => {
    const series = [
      { providerId: 'travelpayouts', cabin: 'economy', points: [{ ...point, cell, executionId: 'e1' }] },
    ];
    const route = { origin: 'LHR', destination: 'JFK', calendarSeries: series, routeSeries: [] };
    expect(routeHistoryResponseSchema.safeParse(route).success).toBe(false);
    const withFlags = [
      { ...series[0], points: [{ ...point, stale: true, truncated: true, cell, executionId: 'e1' }] },
    ];
    expect(routeHistoryResponseSchema.safeParse({ ...route, calendarSeries: withFlags }).success).toBe(true);
    // why: @gmt/db's repositories return the stored shape; WP8 adds the flags when it answers.
    expect(historyPointSchema.safeParse(point).success).toBe(true);
  });

  it('itinerary history points say whether the final step confirmed the price', () => {
    const base = {
      itineraryHash: 'h1',
      series: [{ providerId: 'searchapi', seller: 'Example Air', cabin: 'economy' }],
    };
    const p = { ...point, stale: false, truncated: false };
    const one = (points: unknown[]) => ({ ...base, series: [{ ...base.series[0], points }] });
    expect(itineraryHistoryResponseSchema.safeParse(one([p])).success).toBe(false);
    expect(itineraryHistoryResponseSchema.safeParse(one([{ ...p, priceConfirmed: false }])).success).toBe(
      true,
    );
  });

  it('the cell detail carries what a per-cell verify would spend, or null without a verification provider', () => {
    const detail = { cell, outcomes: [], calendarPrices: [], observations: [] };
    expect(cellDetailResponseSchema.safeParse(detail).success).toBe(false);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: null }).success).toBe(true);
    const verify = { maxCalls: 6, providers: [{ providerId: 'searchapi', monthCallsLeft: 9385 }] };
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify }).success).toBe(true);
    const uncapped = { maxCalls: 6, providers: [{ providerId: 'searchapi', monthCallsLeft: null }] };
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: uncapped }).success).toBe(true);
    expect(
      cellDetailResponseSchema.safeParse({ ...detail, verify: { ...verify, maxCalls: -1 } }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract/wp10.test.ts`
Expected: FAIL, 4 of 4: the duration case with `expected false to be true` (the per-series `searched` object is refused), the other three with `expected true to be false` (the old schemas accept a point without `stale`, an offer without `priceConfirmed` and a detail without `verify`).

- [ ] **Step 3: Implement**

In `packages/core/src/api-contract/results.ts`, replace `durationAnalysisResponseSchema` with:

```ts
/**
 * Spec §11 View C per nights value. Each minimum carries the cell it came from (plan decision 38), so the view can name
 * its departure date and destination. `searched` is per series: a series' flag is true when at least one of its
 * outcomes for this nights value is `priced`, `empty` or `no_data` (verification: any verification provider's outcome;
 * discovery: that provider's outcome), so "not searched" and "searched, no price" stay distinct per series.
 */
export const durationAnalysisResponseSchema = z.object({
  byNights: z.array(
    z.object({
      nights: count,
      /** n = cells of this nights value with a class-verified price */
      minVerified: pricedCell.extend({ n: count }).nullable(),
      /** n = cells of this nights value the provider priced */
      minCalendar: z.array(z.object({ providerId: providerIdSchema, price: pricedCell, n: count })),
      searched: z.object({
        verification: z.boolean(),
        discovery: z.array(z.object({ providerId: providerIdSchema, searched: z.boolean() })),
      }),
    }),
  ),
  executions: z.array(executionSummarySchema),
});
```

Add `verify` as the last field of `cellDetailResponseSchema`, after `observations`:

```ts
  /**
   * What the per-cell verify action would spend now (spec §8.1, plan decision 25): the child execution's call cap and
   * each verification provider's calls left this month (null when that provider has no monthly cap). Null when the
   * definition has no verification provider.
   */
  verify: z
    .object({
      maxCalls: count,
      providers: z.array(z.object({ providerId: providerIdSchema, monthCallsLeft: count.nullable() })),
    })
    .nullable(),
});
```

After `historyPointSchema`, add:

```ts
/**
 * A history point as the api sends it: the stored point plus `stale` (spec §8.1, the same rule as any price of its
 * kind) and `truncated` (plan decisions 30 and 36: from a page-capped tile, "cheapest of the rows read").
 */
export const historyPointResponseSchema = historyPointSchema.extend({
  stale: z.boolean(),
  truncated: z.boolean(),
});
```

and use it in both history responses: `itineraryHistoryResponseSchema.series[].points` becomes `z.array(historyPointResponseSchema.extend({ priceConfirmed: z.boolean() }))` (with the doc comment `/** priceConfirmed: false for a step-2 offer the final step did not confirm (plan decisions 27, 37) */` above it), and `routeHistoryResponseSchema.calendarSeries[].points` becomes `z.array(historyPointResponseSchema.extend({ cell: cellSchema, executionId: z.string() }))`. `HistoryPoint`, `RouteSeriesPoint` and `CalendarDay` keep their exports.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract`
Expected: PASS, 3 files (`contract.test.ts`, `types.test.ts`, `wp10.test.ts`), 15 tests.

Run: `pnpm -r typecheck`
Expected: clean. `@gmt/db` still compiles because `HistoryPoint` is unchanged; nothing on `main` reads the changed duration, history or cell-detail shapes yet (WP8 is the first producer, §13).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp10: contract fields for per-series searched, minimum cells, history stale/truncated/confirmed and verify cost"
```

### Task 10.2: Date forms in format.ts, instant helpers, and the no-Date guard (review focus 3, part 1)

**Files:**
- Create: `apps/web/src/lib/time.ts`, `apps/web/test/lib/{dates.test.ts,time.test.ts,noDateParsing.test.ts}`
- Modify: `apps/web/src/format.ts` (WP9's; the import line and an appended block)

**Interfaces:**
- Consumes: `toEpochDay`, `fromEpochDay`, `addDays`, `monthOf`, `isoDateSchema`, `isoDateTimeSchema`; WP9's `formatIsoDate`, `formatIsoDateShort`.
- Produces: `WEEKDAYS`, `weekdayIndex`, `formatDayOfMonth`, `formatDayShort`, `formatDayLong`, `formatIsoMonth`, `monthDays`, `formatInstantLondon`, `formatInstantDateLondon` (in `format.ts`); `instantMs`, `dateMs`, `dateOfMs` (in `lib/time.ts`).

Plan decision 38: one date-formatting module. The weekday forms build on WP9's `formatIsoDate` and `formatIsoDateShort`, so Results and Calendar share one month table and one parser. `lib/time.ts` only parses instants and does epoch-day arithmetic; it formats nothing.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/lib/dates.test.ts`:

```ts
import { asIsoDate, asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  formatDayLong,
  formatDayOfMonth,
  formatDayShort,
  formatInstantDateLondon,
  formatInstantLondon,
  formatIsoMonth,
  monthDays,
  weekdayIndex,
} from '../../src/format.js';

const d = asIsoDate;

describe('date-only forms from YYYY-MM-DD strings, in WP9 format.ts (spec §6.1, review focus 3, plan decision 38)', () => {
  it('weekday from the epoch day, Monday = 0, negative epoch days included', () => {
    expect(weekdayIndex(d('1970-01-01'))).toBe(3); // Thursday
    expect(weekdayIndex(d('2027-03-01'))).toBe(0); // Monday
    expect(weekdayIndex(d('2027-03-14'))).toBe(6); // Sunday, the US DST change
    expect(weekdayIndex(d('2027-03-28'))).toBe(6); // Sunday, the UK DST change
    expect(weekdayIndex(d('1969-12-31'))).toBe(2); // Wednesday
  });
  it('short and long forms build on WP9 formatIsoDate and formatIsoDateShort', () => {
    expect(formatDayShort(d('2027-03-14'))).toBe('Sun 14 Mar');
    expect(formatDayLong(d('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatDayLong(d('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatDayOfMonth(d('2027-03-04'))).toBe('4');
    expect(formatIsoMonth(asIsoMonth('2027-03'))).toBe('March 2027');
  });
  it('lists the days of a month, leap February included', () => {
    expect(monthDays(asIsoMonth('2027-02'))).toHaveLength(28);
    const leap = monthDays(asIsoMonth('2028-02'));
    expect(leap).toHaveLength(29);
    expect(leap[28]).toBe('2028-02-29');
  });
  it('formats instants in Europe/London whatever the process zone, with the year', () => {
    expect(formatInstantLondon(Date.UTC(2027, 2, 14, 15))).toMatch(/^14 Mar 2027,? 15:00$/); // GMT
    expect(formatInstantLondon(Date.UTC(2027, 6, 1, 15))).toMatch(/^1 Jul 2027,? 16:00$/); // BST
    expect(formatInstantDateLondon(Date.UTC(2027, 2, 28, 23, 30))).toBe('29 Mar 2027'); // BST: already the 29th
  });
});
```

`apps/web/test/lib/time.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { dateMs, dateOfMs, instantMs } from '../../src/lib/time.js';

describe('src/lib/time.ts: instants and the date axis (review focus 3)', () => {
  it('instantMs accepts an instant and refuses a date-only string', () => {
    expect(instantMs('2027-03-14T15:00:00.000Z')).toBe(Date.UTC(2027, 2, 14, 15));
    expect(() => instantMs('2027-03-14')).toThrow(RangeError);
  });
  it('dateMs is epoch-day arithmetic, equal to UTC midnight, and dateOfMs inverts it', () => {
    expect(dateMs(asIsoDate('2027-03-14'))).toBe(Date.UTC(2027, 2, 14));
    expect(dateOfMs(dateMs(asIsoDate('1969-12-31')))).toBe('1969-12-31');
    expect(dateOfMs(Date.UTC(2027, 2, 14, 23, 59))).toBe('2027-03-14');
  });
});
```

`apps/web/test/lib/noDateParsing.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: under jsdom `new URL(…, import.meta.url)` is not a file: URL that node:url accepts; import.meta.dirname is a path.
const SRC = join(import.meta.dirname, '..', '..', 'src');
// why: a Date built from 'YYYY-MM-DD' is UTC midnight and renders as the previous day west of Greenwich; local getters
// shift instants the same way. Only these two files may touch Date, and neither ever receives a date-only string:
// lib/time.ts parses toISOString instants; now.tsx (WP9) reads the current instant. format.ts formats instants with
// Intl.DateTimeFormat#format(epochMs), which needs no Date.
const ALLOWLIST = new Set(['lib/time.ts', 'now.tsx']);
const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'new Date(', re: /\bnew\s+Date\s*\(/g },
  { name: 'Date(', re: /(?<![.\w])Date\s*\(/g },
  { name: 'Date.parse(', re: /\bDate\s*\.\s*parse\s*\(/g },
  { name: 'Date.UTC(', re: /\bDate\s*\.\s*UTC\s*\(/g },
  { name: 'Date.now(', re: /\bDate\s*\.\s*now\s*\(/g },
  {
    name: 'local date getter',
    re: /\.\s*(getDate|getDay|getMonth|getFullYear|getHours|getMinutes|getTimezoneOffset)\s*\(/g,
  },
  { name: 'toLocale*String(', re: /\.\s*toLocale(Date|Time)?String\s*\(/g },
  { name: 'date library import', re: /from\s+['"](dayjs|moment|date-fns|luxon)(\/[^'"]*)?['"]/g },
];

/** Comments are blanked (newlines kept, so line numbers hold) before scanning: a comment is never a hit. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

/** Every forbidden use in a file's text, scanned whole (a call split across lines is still found), with its line. */
export function scan(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  for (const f of FORBIDDEN) {
    for (const m of text.matchAll(f.re)) hits.push(`${text.slice(0, m.index).split('\n').length}: ${f.name}`);
  }
  return hits.sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('no Date parsing outside the allowlisted helpers (review focus 3)', () => {
  it('the scanner finds each forbidden form, across lines, and ignores comments and string helpers', () => {
    expect(scan(`const d = new Date('2027-03-14');`)).toEqual(['1: Date(', '1: new Date(']);
    expect(scan(`const d = new\n  Date(\n'2027-03-14');`)).toEqual(['1: new Date(', '2: Date(']);
    expect(scan(`const t = Date.parse(day.date);`)).toEqual(['1: Date.parse(']);
    expect(scan(`const t = Date.UTC(2027, 2, 14);`)).toEqual(['1: Date.UTC(']);
    expect(scan(`const t = Date.now();`)).toEqual(['1: Date.now(']);
    expect(scan(`const s = Date();`)).toEqual(['1: Date(']);
    expect(scan(`const n = when.getDate();`)).toEqual(['1: local date getter']);
    expect(scan(`label = x.toLocaleDateString('en-GB');`)).toEqual(['1: toLocale*String(']);
    expect(scan(`import { format } from 'date-fns';`)).toEqual(['1: date library import']);
    expect(
      scan(`// new Date('2027-03-14')\n/* Date.parse(x) */ const ok = formatDayShort(day.date);`),
    ).toEqual([]);
    expect(scan(`const ok = formatDayShort(day.date); const url = 'http://x//y';`)).toEqual([]);
  });
  it('finds no Date use in apps/web/src outside the allowlist', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(20); // why: a wrong SRC path must not make this vacuous
    const hits = files
      .filter((f) => !ALLOWLIST.has(relative(SRC, f).split(sep).join('/')))
      .flatMap((f) => scan(readFileSync(f, 'utf8')).map((h) => `${relative(SRC, f)}:${h}`));
    expect(hits).toEqual([]);
  });
  it('the allowlist is exactly the two helpers, and both exist', () => {
    expect([...ALLOWLIST]).toEqual(['lib/time.ts', 'now.tsx']);
    for (const f of ALLOWLIST) expect(statSync(join(SRC, f)).isFile()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/lib`
Expected: FAIL. `dates.test.ts` fails with `formatDayShort is not a function` (and its siblings); `time.test.ts` with `Failed to resolve import "../../src/lib/time.js"`; `noDateParsing.test.ts` on "the allowlist is exactly the two helpers, and both exist" (`ENOENT … lib/time.ts`). The guard's scan of WP9's files passes: WP9 builds a `Date` only in `now.tsx`. If it lists a WP9 file, do not edit that file: report it to the WP9 owner, because WP10 changes only the WP9 files named in §12.

- [ ] **Step 3: Implement**

`apps/web/src/format.ts`: replace the first import line with

```ts
import {
  addDays,
  formatPence,
  type IsoDate,
  type IsoMonth,
  isoDateSchema,
  monthOf,
  toEpochDay,
} from '@gmt/core';
```

and append at the end of the file:

```ts
// --- WP10: weekday, month and instant forms (plan decision 38: this is the web's one date-formatting module) ---
// Date-only values render from their YYYY-MM-DD strings and core's epoch-day arithmetic only, so no browser timezone
// can move a day (spec §6.1, review focus 3). Instants format in Europe/London with Intl, which takes epoch
// milliseconds directly, so nothing here constructs a Date.

/** Monday-first weekday abbreviations (grid headers and day labels). */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Weekday of a date with Monday = 0, from the epoch day. */
export function weekdayIndex(d: IsoDate): number {
  // why: epoch day 0 (1970-01-01) was a Thursday, index 3; the double modulo keeps negative epoch days in range.
  return (((toEpochDay(d) + 3) % 7) + 7) % 7;
}

function weekdayName(d: IsoDate): string {
  const name = WEEKDAYS[weekdayIndex(d)];
  if (name === undefined) throw new RangeError(`weekday out of range for ${d}`);
  return name;
}

/** '2027-03-14' → '14' (the grid's day number). */
export function formatDayOfMonth(d: IsoDate): string {
  return String(Number(d.slice(8, 10)));
}

/** '2027-03-14' → 'Sun 14 Mar' (day cells, the panel's cell picker, chart tooltips). */
export function formatDayShort(d: IsoDate): string {
  return `${weekdayName(d)} ${formatIsoDateShort(d)}`;
}

/** '2027-03-14' → 'Sun 14 Mar 2027' (panel title, screen-reader day names, tables). */
export function formatDayLong(d: IsoDate): string {
  return `${weekdayName(d)} ${formatIsoDate(d)}`;
}

/** '2027-03' → 'March 2027'. */
export function formatIsoMonth(m: IsoMonth): string {
  const name = MONTHS_LONG[Number(m.slice(5, 7)) - 1];
  if (name === undefined) throw new RangeError(`month out of range: ${m}`);
  return `${name} ${m.slice(0, 4)}`;
}

/** Every date of a month, in order, by epoch-day steps. */
export function monthDays(m: IsoMonth): IsoDate[] {
  const out: IsoDate[] = [];
  // why: isoDateSchema validates and brands the first of the month; no cast and no Date.
  for (let d = isoDateSchema.parse(`${m}-01`); monthOf(d) === m; d = addDays(d, 1)) out.push(d);
  return out;
}

const LONDON_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const LONDON_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Epoch ms → '14 Mar 2027, 15:00' in Europe/London (history tables, the panel's fetched column). */
export function formatInstantLondon(ms: number): string {
  return LONDON_DATE_TIME.format(ms);
}

/** Epoch ms → '14 Mar 2027' in Europe/London (the History fetch axis). */
export function formatInstantDateLondon(ms: number): string {
  return LONDON_DATE.format(ms);
}
```

`apps/web/src/lib/time.ts`:

```ts
import { fromEpochDay, type IsoDate, isoDateTimeSchema, toEpochDay } from '@gmt/core';

// With src/now.tsx, the only file in apps/web/src that may parse or construct a Date (review focus 3;
// test/lib/noDateParsing.test.ts). Inputs are toISOString instants or epoch-day integers; a date-only string is refused.

const DAY_MS = 86_400_000;

/** Epoch milliseconds of an instant; throws RangeError on anything but the toISOString form (spec §6.3). */
export function instantMs(t: string): number {
  if (!isoDateTimeSchema.safeParse(t).success) throw new RangeError(`instantMs: not an ISO instant: ${t}`);
  return Date.parse(t);
}

/** A calendar date on the same millisecond axis as instants (UTC midnight), by epoch-day arithmetic only. */
export function dateMs(d: IsoDate): number {
  return toEpochDay(d) * DAY_MS;
}

/** The calendar date of a point on the date axis (inverse of dateMs), for date-only tick labels. */
export function dateOfMs(ms: number): IsoDate {
  return fromEpochDay(Math.floor(ms / DAY_MS));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/lib`
Expected: PASS, 3 files, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: weekday, month and instant forms in format.ts, instant helpers, no-Date guard (review focus 3)"
```

### Task 10.3: API wiring, copy, fixtures, source labels and the six-bucket marker

**Files:**
- Create: `apps/web/src/lib/sources.ts`, `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx}`, `apps/web/test/fixtures.wp10.ts`, `apps/web/test/msw/wp10Handlers.ts`, `apps/web/test/lib/sources.test.ts`, `apps/web/test/views/calendar/marker.test.tsx`
- Modify (WP9): `apps/web/src/api/{types.ts,endpoints.ts,queries.ts}`, `apps/web/src/copy.ts`, `apps/web/test/msw/handlers.ts`, `apps/web/test/copy/catalogue.test.ts`

**Interfaces:**
- Consumes: the Task 10.1 schemas through `z.infer`; `call`, `useProviders`, `useExecutionActions`; `COPY.source`, `COPY.provider`, `COPY.reusedNote`; WP9's `provSearch`, `provCalendar`, `summary`; core's `isoDateTimeOfEpochMs`, `effectiveAge`, `worstCaseAgeHours`.
- Produces: the WP10 `api.*`, `qk.*` and query hooks with `whileRunning`; `COPY.providerShort`, `COPY.calendarView`, `COPY.durationView`, `COPY.historyView`; `discoverySourceLabel`, `sourceLabelOf`; `DaySlice`, `DayPrice`, `GridDay`, `GlyphStatus`, `DayBasis`, `bucketTotal`, `searchedCount`, `countsConsistent`, `formatDiscoveryMarker`, `formatVerificationMarker`, `totalReused`, `Coverage`, `coverageOf`, `SliceOptions`, `sliceForDestination`, `DayMarker`, `ReusedNote`; the WP10 test builders and default handlers.

The marker is the spec's six-bucket marker (spec §3 defines six buckets; §9 item 6's "five-way" is a wording slip, §13). Its total M is the api's `total`; when that disagrees with the six buckets' sum the line says "counts inconsistent" (plan decision 38). Discovery counts carry only a providerId, so their source label comes from the provider's discovery capability in GET /api/providers, not from a table in code.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/fixtures.wp10.ts` (WP10's builders over WP9's `test/fixtures.ts`; each contract shape goes through its schema):

```ts
import {
  addDays,
  apiContract,
  asIata,
  asIsoDate,
  type Buckets,
  type Cell,
  type CellKey,
  effectiveAge,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  type Provenance,
  type ProviderId,
  worstCaseAgeHours,
} from '@gmt/core';
import type { z } from 'zod';
import type {
  CalendarDay,
  CalendarResponse,
  CellDetailResponse,
  DurationResponse,
  ItineraryHistoryResponse,
  PriceCellData,
  RouteHistoryResponse,
} from '../src/api/types.js';
import { type SliceOptions, sliceForDestination } from '../src/views/Calendar/marker.js';
import type { DaySlice, GridDay } from '../src/views/Calendar/types.js';
import { provCalendar, provSearch, summary } from './fixtures.js';
import { NOW } from './render.js';

// WP10's builders on top of WP9's test/fixtures.ts (provenance and execution builders come from there). Every builder
// that returns a contract shape runs it through the contract schema, so a schema change breaks here, at the fixture.

/** An instant h hours before NOW, through core's instant helper. */
export function hoursBefore(h: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(NOW) - h * 3_600_000);
}

/** A worked-example cell (LHR → JFK unless given). */
export function cellAt(departure: string, nights: number, origin = 'LHR', destination = 'JFK'): Cell {
  const dep = asIsoDate(departure);
  return {
    origin: asIata(origin),
    destination: asIata(destination),
    departureDate: dep,
    returnDate: addDays(dep, nights),
    nights,
  };
}

export function keyOf(c: Cell): CellKey {
  return {
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
  };
}

/** SearchApi itinerary provenance as stored: maxAgeHours 'unknown' (spec rev 15 §3, plan decision 24). */
export function provItinerary(h: number): Provenance {
  return { ...provSearch, fetchedAt: hoursBefore(h), maxAgeHours: 'unknown' };
}

/** A known-age itinerary provenance; no current provider produces one, so only the precedence tie test uses it. */
export function provItineraryKnownAge(h: number, maxAgeHours: number): Provenance {
  return { ...provSearch, fetchedAt: hoursBefore(h), maxAgeHours };
}

/** Travelpayouts calendar provenance fetched h hours before NOW. */
export function provCalendarAt(h: number, maxAgeHours: number | 'unknown' = 48): Provenance {
  return { ...provCalendar, fetchedAt: hoursBefore(h), maxAgeHours };
}

/** The fixture provider's synthetic provenance (spec §5.5: providerId fixture ⇔ sourceKind synthetic). */
export function provSynthetic(h: number): Provenance {
  return {
    ...provCalendar,
    providerId: 'fixture',
    sourceKind: 'synthetic',
    fetchedAt: hoursBefore(h),
    maxAgeHours: 0,
  };
}

/** A day price as calendarDaySchema sends it, its age from core's effective-age rule. */
export function priceAt(
  pricePence: number,
  provenance: Provenance,
  stale: boolean,
  at: Cell,
  truncated = false,
): PriceCellData & { cell: Cell; itineraryHash: string } {
  const ageHours = worstCaseAgeHours(effectiveAge(provenance, NOW));
  return {
    pricePence,
    provenance,
    stale,
    ageHours,
    truncated,
    cell: at,
    itineraryHash: `it-${at.departureDate}-${pricePence}`,
  };
}

/** A price cell without its cell and hash (byDestination entries, calendar-gap, panel prices). */
export function bare(p: PriceCellData & { cell: Cell }): PriceCellData {
  return {
    pricePence: p.pricePence,
    provenance: p.provenance,
    stale: p.stale,
    ageHours: p.ageHours,
    truncated: p.truncated,
  };
}

export function buckets(partial: Partial<Buckets>): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0, ...partial };
}

/** One provider's discovery entry; total is the six buckets' sum unless a test needs it to disagree. */
export function disc(
  providerId: ProviderId,
  partial: Partial<Buckets>,
  total?: number,
): CalendarDay['discovery'][number] {
  const b = buckets(partial);
  return {
    providerId,
    buckets: b,
    total: total ?? b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run,
  };
}

/** A calendar day through the contract schema. */
export function day(date: string, partial: Partial<Omit<CalendarDay, 'date'>> = {}): CalendarDay {
  return apiContract.calendarDaySchema.parse({
    date,
    discovery: [],
    verification: { selected: 0, itinerarySearched: 0, onDemand: 0 },
    cheapestVerified: null,
    cheapestPartiallyVerified: null,
    cheapestCalendar: null,
    byDestination: [],
    ...partial,
  });
}

/** Definition options with both stages configured. */
export const BOTH: SliceOptions = { verificationConfigured: true, discoveryConfigured: true };

export function slice(partial: Partial<DaySlice>): DaySlice {
  return {
    discovery: [],
    discoveryConfigured: true,
    verification: null,
    cheapestVerified: null,
    cheapestPartiallyVerified: null,
    cheapestCalendar: null,
    destination: null,
    ...partial,
  };
}

/** A grid day for all destinations. */
export function gridDay(
  date: string,
  partial: Partial<Omit<CalendarDay, 'date'>> = {},
  o: SliceOptions = BOTH,
): GridDay {
  return { date: asIsoDate(date), slice: sliceForDestination(day(date, partial), 'all', o) };
}

export function calendarResponse(
  days: CalendarDay[],
  over: Partial<CalendarResponse> = {},
): CalendarResponse {
  return apiContract.calendarResponseSchema.parse({
    days,
    executions: [summary()],
    staleAfterHours: 192,
    calendarStaleAfterHours: { travelpayouts: 216, searchapi: 192 },
    ...over,
  });
}

type Night = DurationResponse['byNights'][number];

/** One nights value; verified/calendar are [pence, n] or null; flags say which series searched it. */
export function night(
  nights: number,
  verified: [number, number] | null,
  calendar: [number, number] | null,
  searched: { verification: boolean; travelpayouts: boolean } = { verification: true, travelpayouts: true },
  at: Cell = cellAt('2027-03-14', nights),
): Night {
  return {
    nights,
    minVerified:
      verified === null
        ? null
        : { ...bare(priceAt(verified[0], provItinerary(5), false, at)), cell: at, n: verified[1] },
    minCalendar:
      calendar === null
        ? []
        : [
            {
              providerId: 'travelpayouts',
              price: { ...bare(priceAt(calendar[0], provCalendarAt(2), false, at)), cell: at },
              n: calendar[1],
            },
          ],
    searched: {
      verification: searched.verification,
      discovery: [{ providerId: 'travelpayouts', searched: searched.travelpayouts }],
    },
  };
}

export function durationResponse(byNights: Night[], over: Partial<DurationResponse> = {}): DurationResponse {
  return apiContract.durationAnalysisResponseSchema.parse({ byNights, executions: [summary()], ...over });
}

type Outcome = CellDetailResponse['outcomes'][number];

/** One cell outcome of the panel's table. */
export function outcome(
  c: Cell,
  stage: Outcome['stage'],
  providerId: ProviderId,
  status: Outcome['status'],
  over: Partial<Outcome> = {},
): Outcome {
  const priced = status === 'priced';
  return {
    ...keyOf(c),
    executionId: 'exec-0001',
    stage,
    providerId,
    status,
    reason: null,
    attempts: priced ? 1 : 0,
    lastError: null,
    fetchedAt: priced ? hoursBefore(2) : null,
    minPence: priced ? 41200 : null,
    cabin: priced ? 'economy' : null,
    pointOfSale: priced ? 'unknown' : null,
    sourceKind: priced ? 'authorised-cached' : null,
    reusedFromExecutionId: null,
    ...over,
  };
}

export function cellDetail(c: Cell, over: Partial<CellDetailResponse> = {}): CellDetailResponse {
  return apiContract.cellDetailResponseSchema.parse({
    cell: c,
    outcomes: [],
    calendarPrices: [],
    observations: [],
    verify: { maxCalls: 6, providers: [{ providerId: 'searchapi', monthCallsLeft: 9385 }] },
    ...over,
  });
}

type RouteFetchPoint = RouteHistoryResponse['calendarSeries'][number]['points'][number];

/** A calendar fetch point h hours ago: the pair's minimum that run, with its cell and run id. */
export function fetchPoint(
  h: number,
  pricePence: number,
  at: Cell = cellAt('2027-03-14', 14),
  over: Partial<RouteFetchPoint> = {},
): RouteFetchPoint {
  return {
    at: hoursBefore(h),
    pricePence,
    provenance: provCalendarAt(h),
    stale: false,
    truncated: false,
    cell: at,
    executionId: `exec-${h}`,
    ...over,
  };
}

/** Accepts the schema's input shape (plain strings for dates), so tests can write literals; returns the parsed shape. */
export function routeHistory(
  over: Partial<z.input<typeof apiContract.routeHistoryResponseSchema>> = {},
): RouteHistoryResponse {
  return apiContract.routeHistoryResponseSchema.parse({
    origin: 'LHR',
    destination: 'JFK',
    calendarSeries: [
      {
        providerId: 'travelpayouts',
        cabin: 'economy',
        points: [fetchPoint(2, 39900), fetchPoint(170, 42000)],
      },
    ],
    routeSeries: [
      {
        providerId: 'searchapi',
        cabin: 'unknown',
        points: ['2027-03-10', '2027-03-11', '2027-03-12'].map((d, i) => ({
          date: d,
          pricePence: 38000 + i * 500,
          fetchedAt: hoursBefore(2),
          providerId: 'searchapi',
          sourceKind: 'scraped-search',
        })),
      },
    ],
    ...over,
  });
}

type OfferPoint = ItineraryHistoryResponse['series'][number]['points'][number];

export function offerPoint(
  h: number,
  pricePence: number,
  priceConfirmed = true,
  over: Partial<OfferPoint> = {},
): OfferPoint {
  return {
    at: hoursBefore(h),
    pricePence,
    provenance: provItinerary(h),
    stale: false,
    truncated: false,
    priceConfirmed,
    ...over,
  };
}

export function itineraryHistory(over: Partial<ItineraryHistoryResponse> = {}): ItineraryHistoryResponse {
  return apiContract.itineraryHistoryResponseSchema.parse({
    itineraryHash: 'hash-verified-1',
    series: [
      {
        providerId: 'searchapi',
        seller: 'Example Travel',
        cabin: 'economy',
        points: [
          offerPoint(5, 41200),
          offerPoint(173, 43000),
          offerPoint(6, 39000, false),
          offerPoint(174, 40000, false),
        ],
      },
    ],
    ...over,
  });
}

/** The default calendar the shared msw handlers serve: a priced day, a glyph day and a day no run has reached. */
export function defaultCalendar(): CalendarResponse {
  const c = cellAt('2027-03-14', 14);
  return calendarResponse([
    day('2027-03-14', {
      discovery: [disc('travelpayouts', { priced: 40, no_data: 8 })],
      cheapestCalendar: priceAt(41200, provCalendarAt(2), false, c),
      byDestination: [
        {
          destination: asIata('JFK'),
          cheapestVerified: null,
          cheapestCalendar: bare(priceAt(41200, provCalendarAt(2), false, c)),
        },
        { destination: asIata('EWR'), cheapestVerified: null, cheapestCalendar: null },
      ],
    }),
    day('2027-03-15', { discovery: [disc('travelpayouts', { no_data: 40, not_run: 8 })] }),
    day('2027-03-16'),
  ]);
}
```

`apps/web/test/msw/wp10Handlers.ts`:

```ts
import { HttpResponse, http } from 'msw';
import { API } from '../fixtures.js';
import {
  cellAt,
  cellDetail,
  defaultCalendar,
  durationResponse,
  itineraryHistory,
  night,
  routeHistory,
} from '../fixtures.wp10.js';

/**
 * Default responses for WP10's five routes, so every view renders real content under WP9's unhandled-request-error
 * server (WP9's rendered-copy sweep visits Calendar, Duration and History too). Tests override them with server.use.
 */
export const wp10Handlers = [
  http.get(`${API}/definitions/:id/calendar`, () => HttpResponse.json(defaultCalendar())),
  http.get(`${API}/definitions/:id/duration-analysis`, () =>
    HttpResponse.json(
      durationResponse([
        night(10, [52000, 3], [41200, 5]),
        night(11, null, [39900, 4]),
        night(12, null, null),
      ]),
    ),
  ),
  http.get(`${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`, () =>
    HttpResponse.json(cellDetail(cellAt('2027-03-14', 14))),
  ),
  http.get(`${API}/routes/:origin/:destination/history`, () => HttpResponse.json(routeHistory())),
  http.get(`${API}/itineraries/:hash/history`, () => HttpResponse.json(itineraryHistory())),
];
```

`apps/web/test/lib/sources.test.ts`:

```ts
import type { ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { discoverySourceLabel, sourceLabelOf } from '../../src/lib/sources.js';
import { providersResponse } from '../fixtures.js';

describe('source labels (spec §11 vocabulary; synthetic tagged end to end, spec §5.5)', () => {
  const withFixture = providersResponse({
    providers: [
      ...providersResponse().providers,
      {
        providerId: 'fixture',
        displayName: 'Fixture',
        enabled: true,
        plan: 'synthetic',
        excludedFromSchedule: false,
        notices: [],
        capabilities: {
          discovery: { sourceKind: 'synthetic', provenanceNote: 'synthetic', maxAgeHours: 0 },
          verification: null,
        },
        usage: [],
      },
    ],
  });
  it.each<[ProviderId, string]>([
    ['travelpayouts', 'Aviasales cache'],
    ['searchapi', 'Google date grid via SearchApi'],
    ['fixture', COPY.source.synthetic],
  ])('discovery counts of %s are labelled "%s" from the providers response', (id, label) => {
    expect(discoverySourceLabel(id, withFixture)).toBe(label);
  });
  it('before the providers response arrives the provider is named, never given a source kind', () => {
    expect(discoverySourceLabel('travelpayouts', undefined)).toBe('Travelpayouts');
  });
  it('a series label names every source kind its prices carry', () => {
    expect(sourceLabelOf(['authorised-cached', 'authorised-cached'])).toBe('Aviasales cache');
    expect(sourceLabelOf(['authorised-cached', 'synthetic'])).toBe(
      `Aviasales cache / ${COPY.source.synthetic}`,
    );
  });
});
```

`apps/web/test/views/calendar/marker.test.tsx`:

```tsx
import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { DayMarker, ReusedNote } from '../../../src/views/Calendar/DayMarker.js';
import {
  bucketTotal,
  countsConsistent,
  coverageOf,
  formatDiscoveryMarker,
  formatVerificationMarker,
  sliceForDestination,
  totalReused,
} from '../../../src/views/Calendar/marker.js';
import {
  BOTH,
  bare,
  buckets,
  cellAt,
  day,
  disc,
  priceAt,
  provCalendarAt,
  slice,
} from '../../fixtures.wp10.js';
import { renderWithProviders } from '../../render.js';

describe('six-bucket day counts (spec §11 View B, §3)', () => {
  const partial = buckets({ priced: 3, empty: 1, no_data: 2, error: 1, skipped: 0, not_run: 5, reused: 2 });

  it('M is the sum of the six buckets; reused is a subset, not a seventh bucket', () => {
    expect(bucketTotal(partial)).toBe(12);
  });

  it('formats the discovery marker with the api total M', () => {
    expect(formatDiscoveryMarker(disc('travelpayouts', partial))).toBe(
      '3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12',
    );
  });

  it('a total that disagrees with the sum of its buckets says "counts inconsistent" (plan decision 38)', () => {
    const wrong = disc('travelpayouts', partial, 14);
    expect(countsConsistent(wrong)).toBe(false);
    expect(formatDiscoveryMarker(wrong)).toBe(
      '3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 14 · counts inconsistent',
    );
    expect(coverageOf(slice({ discovery: [wrong] }))).toEqual({ kind: 'inconsistent' });
  });

  it('formats the itinerary-search line separately, and says when no verification provider exists', () => {
    expect(formatVerificationMarker({ selected: 10, itinerarySearched: 1, onDemand: 2 })).toBe(
      'itinerary-searched 1 of 10 selected +2 on demand',
    );
    expect(formatVerificationMarker(null)).toBe('itinerary search: no verification provider configured');
  });

  it('the coverage cue names the best-covered source: searched = priced + no fares + no cached data', () => {
    const s = slice({
      discovery: [
        disc('travelpayouts', { priced: 4, no_data: 2, not_run: 42 }),
        disc('searchapi', { priced: 12, empty: 3, error: 33 }),
      ],
    });
    expect(coverageOf(s)).toEqual({ kind: 'fraction', searched: 15, total: 48, providerId: 'searchapi' });
    expect(coverageOf(slice({ discovery: [] }))).toEqual({ kind: 'none' });
  });

  it('renders one line per provider named by its source from GET /api/providers, then the itinerary-search line', async () => {
    const { findAllByRole, getByTestId } = renderWithProviders(
      <DayMarker
        slice={slice({
          discovery: [disc('travelpayouts', partial), disc('searchapi', { priced: 12 })],
          verification: { selected: 10, itinerarySearched: 1, onDemand: 2 },
        })}
      />,
    );
    const lines = await findAllByRole('listitem');
    expect(lines).toHaveLength(2);
    await expect
      .poll(() => lines[0]?.textContent)
      .toBe(
        'Aviasales cache: 3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12',
      );
    expect(lines[1]).toHaveTextContent(
      'Google date grid via SearchApi: 12 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 12',
    );
    expect(getByTestId('day-marker')).toHaveTextContent('itinerary-searched 1 of 10 selected +2 on demand');
  });

  it('a definition without a discovery provider says so; a configured one with no outcome rows says not searched yet', () => {
    const none = renderWithProviders(<DayMarker slice={slice({ discoveryConfigured: false })} />);
    expect(none.getByTestId('day-marker')).toHaveTextContent('no discovery provider configured');
    none.unmount();
    const noRun = renderWithProviders(<DayMarker slice={slice({ discovery: [] })} />);
    expect(noRun.getByTestId('day-marker')).toHaveTextContent('not searched yet: no run covers this day');
    expect(noRun.getByTestId('day-marker')).not.toHaveTextContent('no discovery provider configured');
  });

  it('a destination-filtered day takes that destination’s prices with no cell; its counts are day-level and say so', () => {
    const jfkCell = cellAt('2027-03-14', 14);
    const d = day('2027-03-14', {
      discovery: [disc('travelpayouts', partial)],
      cheapestCalendar: priceAt(39900, provCalendarAt(2), false, cellAt('2027-03-14', 14, 'LHR', 'EWR')),
      byDestination: [
        {
          destination: asIata('JFK'),
          cheapestVerified: null,
          cheapestCalendar: bare(priceAt(41200, provCalendarAt(2), false, jfkCell)),
        },
        { destination: asIata('EWR'), cheapestVerified: null, cheapestCalendar: null },
      ],
    });
    const jfk = sliceForDestination(d, asIata('JFK'), BOTH);
    expect(jfk.destination).toBe('JFK');
    expect(jfk.cheapestCalendar?.pricePence).toBe(41200);
    expect(jfk.cheapestCalendar?.cell).toBeNull();
    expect(coverageOf(jfk)).toEqual({ kind: 'all-destinations' });
    expect(sliceForDestination(d, asIata('EWR'), BOTH).cheapestCalendar).toBeNull();
    expect(sliceForDestination(d, 'all', { ...BOTH, verificationConfigured: false }).verification).toBeNull();
    const { getByTestId } = renderWithProviders(<DayMarker slice={jfk} />);
    expect(getByTestId('day-marker')).toHaveTextContent('coverage counts cover all destinations');
  });

  it('the header shows the reused count summed over days and providers, and nothing when it is zero', () => {
    const days = [
      slice({ discovery: [disc('travelpayouts', partial)] }),
      slice({
        discovery: [
          disc('travelpayouts', { priced: 4, reused: 3 }),
          disc('searchapi', { priced: 4, reused: 1 }),
        ],
      }),
    ];
    expect(totalReused(days)).toBe(6);
    const shown = renderWithProviders(<ReusedNote count={totalReused(days)} />);
    expect(shown.getByText('(6 reused from earlier runs)')).toBeInTheDocument();
    shown.unmount();
    const { container } = renderWithProviders(<ReusedNote count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/lib/sources.test.ts test/views/calendar/marker.test.tsx`
Expected: FAIL, both files: `Failed to resolve import "../../src/lib/sources.js"`, and `Failed to resolve import "../src/views/Calendar/marker.js" from "test/fixtures.wp10.ts"` (the builders use `sliceForDestination`).

- [ ] **Step 3: Implement**

`apps/web/src/api/types.ts`: append

```ts
// WP10 routes (plan "API contract", results.ts, with WP10's additions of plan decision 38).
export type CalendarResponse = z.infer<typeof apiContract.calendarResponseSchema>;
export type { CalendarDay } from '@gmt/core';
export type DurationResponse = z.infer<typeof apiContract.durationAnalysisResponseSchema>;
export type CellDetailResponse = z.infer<typeof apiContract.cellDetailResponseSchema>;
export type ItineraryHistoryResponse = z.infer<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.infer<typeof apiContract.routeHistoryResponseSchema>;
```

`apps/web/src/api/endpoints.ts`: import `type Cabin` beside `CellKey` from `@gmt/core`, add `CalendarResponse`, `CellDetailResponse`, `DurationResponse`, `ItineraryHistoryResponse` and `RouteHistoryResponse` to the type import, and add these members at the end of `api`:

```ts
  // WP10 (spec §10): the calendar route takes no query; both bases come back per day.
  calendar: (id: string) =>
    call<CalendarResponse>('GET', '/api/definitions/:id/calendar', { params: { id } }),
  durationAnalysis: (id: string) =>
    call<DurationResponse>('GET', '/api/definitions/:id/duration-analysis', { params: { id } }),
  cellDetail: (id: string, c: CellKey) =>
    call<CellDetailResponse>(
      'GET',
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      {
        params: {
          id,
          origin: c.origin,
          destination: c.destination,
          departureDate: c.departureDate,
          returnDate: c.returnDate,
        },
      },
    ),
  itineraryHistory: (hash: string) =>
    call<ItineraryHistoryResponse>('GET', '/api/itineraries/:hash/history', { params: { hash } }),
  // why: routeHistoryQuerySchema { cabin?: Cabin 
```

`apps/web/src/api/queries.ts`: change the first two imports to

```ts
import { type Cabin, type CellKey, cellKeyString, type Iata } from '@gmt/core';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
```

add to `qk`

```ts
  // WP10
  calendar: (id: string) => ['calendar', id] as const,
  duration: (id: string) => ['duration', id] as const,
  cell: (id: string, key: string) => ['cell', id, key] as const,
  itineraryHistory: (hash: string) => ['history', 'itinerary', hash] as const,
  routeHistory: (origin: string, destination: string, cabin: string) =>
    ['history', 'route', origin, destination, cabin] as const,
```

add `['calendar'], ['duration'], ['cell'], ['history']` to the list `useExecutionActions`'s `refresh` invalidates, so a start, cancel, resume or single-cell verify refreshes every WP10 view (po-wp10-006), and append

```ts
// --- WP10 queries ---

/**
 * Refetch every 2 s while the newest execution a response names is pending or running, the cadence the status bar
 * polls at, so the heatmap and the duration chart fill in during a run (spec §10 "updates during run").
 */
export function whileRunning(
  data: { executions: ReadonlyArray<{ status: string }> } | undefined,
): number | false {
  const latest = data?.executions[0];
  return latest !== undefined && POLLING.has(latest.status) ? 2_000 : false;
}

/** View B data (spec §10 calendar route). */
export function useCalendar(definitionId: string) {
  return useQuery({
    queryKey: qk.calendar(definitionId),
    queryFn: () => api.calendar(definitionId),
    refetchInterval: (query) => whileRunning(query.state.data),
  });
}

/** View C data (spec §10 duration-analysis route). */
export function useDurationAnalysis(definitionId: string) {
  return useQuery({
    queryKey: qk.duration(definitionId),
    queryFn: () => api.durationAnalysis(definitionId),
    refetchInterval: (query) => whileRunning(query.state.data),
  });
}

/** One cell's outcomes and prices for the View B side panel; idle until a cell is chosen. */
export function useCellDetail(definitionId: string, cell: CellKey | null) {
  return useQuery({
    queryKey: qk.cell(definitionId, cell === null ? '' : cellKeyString(cell)),
    queryFn: () =>
      cell === null ? Promise.reject(new Error('no cell chosen')) : api.cellDetail(definitionId, cell),
    enabled: cell !== null,
  });
}

/** Route history for each origin-destination pair given (one pair, or every pair for the overlay). */
export function useRouteHistories(
  pairs: ReadonlyArray<{ origin: Iata; destination: Iata }>,
  cabin: Cabin,
  enabled: boolean,
) {
  return useQueries({
    queries: pairs.map((p) => ({
      queryKey: qk.routeHistory(p.origin, p.destination, cabin),
      queryFn: () => api.routeHistory(p.origin, p.destination, cabin),
      enabled,
    })),
  });
}

/** One itinerary's offer history; idle without a hash. */
export function useItineraryHistory(hash: string | null) {
  return useQuery({
    queryKey: qk.itineraryHistory(hash ?? ''),
    queryFn: () => api.itineraryHistory(hash ?? ''),
    enabled: hash !== null && hash !== '',
  });
}
```

`apps/web/src/copy.ts`: append inside `COPY`, before `} as const;`:

```ts
  // --- WP10 (spec §11 View B, View C, History; plan decision 38) ---
  /** The compact badge of a calendar day (PriceCell's compact form); "synthetic" is never abbreviated (spec §5.5). */
  providerShort: { travelpayouts: 'TP', searchapi: 'SA', fixture: 'synthetic' } satisfies Record<
    ProviderId,
    string
  >,
  calendarView: {
    title: 'Calendar',
    discoveryMarker: (
      b: { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number },
      total: number,
    ) =>
      `${b.priced} priced · ${b.empty} no fares · ${b.no_data} no cached data · ${b.error} error · ${b.skipped} skipped · ${b.not_run} not searched of ${total}`,
    countsInconsistent: 'counts inconsistent',
    verificationMarker: (searched: number, selected: number, onDemand: number) =>
      `itinerary-searched ${searched} of ${selected} selected +${onDemand} on demand`,
    verificationNotConfigured: 'itinerary search: no verification provider configured',
    noDiscoveryProvider: 'no discovery provider configured',
    noRunCoversDay: 'not searched yet: no run covers this day',
    markerSource: (source: string, marker: string) => `${source}: ${marker}`,
    partlyVerified: (count: number) =>
      `${count} partially verified ${count === 1 ? 'itinerary' : 'itineraries'} found for this day (never the day price)`,
    countsAllDestinations: 'coverage counts cover all destinations',
    glyphSymbol: { empty: '∅', no_data: '?', error: '!', skipped: '–', not_run: '○' },
    calendarPrice: 'calendar price',
    bandAria: (band: number) => `price band ${band + 1} of 5${band === 0 ? ', cheapest' : ''}`,
    flatAria: 'one shade: the scale is flat',
    hatchedAria: 'not on the colour scale',
    noPriceForDestination: (destination: string) => `no ${destination} price`,
    stay: (nights: number, back: string) => `${nights}n · back ${back}`,
    stayInPanel: 'stay: see panel',
    cachedFrom: 'cached from',
    searchedFraction: (searched: number, total: number) => `${searched}/${total} searched`,
    destinationFilter: 'Destination',
    allDestinations: 'All destinations',
    colourBy: 'Colour by',
    empty: 'No days to show yet. The calendar fills in as cells are searched.',
    staleLine: (stale: number, shown: number, verifiedAfter: string) =>
      `${stale} of ${shown} shown prices are stale (itinerary prices after ${verifiedAfter}; calendar prices after their provider's refresh interval plus its age bound)`,
    monthNav: 'Month',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    legend: {
      title: 'Legend',
      scaleQuintile: (basis: string, days: number) =>
        `Colour: ${basis} prices on ${days} days, in five price bands (quintiles of the days shown)`,
      scaleFlatFew: (basis: string, days: number, min: number) =>
        `Colour: one shade for ${basis} prices on ${days} ${days === 1 ? 'day' : 'days'}; fewer than ${min} days are too few for price bands`,
      scaleFlatNarrow: (basis: string, days: number, min: string, max: string) =>
        `Colour: one shade for ${basis} prices on ${days} days; they span ${min}–${max}, less than 10%, too narrow for price bands`,
      scaleEmpty: (basis: string) => `Colour: no ${basis} prices to colour yet`,
      band: (band: number, min: string, max: string, days: number) =>
        `band ${band + 1}: ${min}–${max} (${days} ${days === 1 ? 'day' : 'days'})`,
      flatSwatch: (days: number) => `one shade: ${days} ${days === 1 ? 'day' : 'days'}`,
      hatched: (shown: 'verified' | 'calendar', days: number) =>
        `hatched: ${days} ${days === 1 ? 'day shows' : 'days show'} a ${shown === 'verified' ? 'class-verified' : 'calendar'} price instead and ${days === 1 ? 'is' : 'are'} not on this scale`,
      priceless: 'grey with a label: no price for this day',
      dashed: 'dashed outline: a calendar price; constraints not checked',
      stale: 'stale: older than one refresh cycle; shown and labelled, never hidden',
      coverageFull:
        'S/M searched with a solid square: every cell of the day searched (priced, no fares or no cached data) by its best-covered source',
      coveragePartial:
        'S/M searched with a striped square: part of the day not searched; per-source counts are in the panel',
      cachedFrom: 'cached from £X: a cheaper calendar price exists for this day; constraints not checked',
      truncated: 'cheapest of the rows read: the provider returned more rows than were read for that month',
      stay: 'Nn · back <date>: the stay of the cheapest cell; the panel lists every cell of the day',
      filtered:
        'With a destination filter the coverage counts cover all destinations: the api does not split them per destination.',
      glyphs: 'Days without a price show:',
      skippedWhy: ' (a budget stop, a disabled provider or a passed date; reasons in the panel)',
    },
    panel: {
      title: (date: string) => `Departing ${date}`,
      close: 'Close',
      dayHeading: 'This day',
      dayVerified: 'cheapest class-verified price',
      dayPartlyVerified: 'cheapest partially verified itinerary',
      dayCalendar: 'cheapest calendar price',
      dayCell: (nights: number, back: string) => `${nights} nights · back ${back}`,
      cellPicker: 'Cell',
      cellOption: (origin: string, destination: string, nights: number, back: string) =>
        `${origin}→${destination} · ${nights} nights · back ${back}`,
      outcomes: 'Outcomes per run, stage and provider (newest run first)',
      columns: {
        run: 'Run',
        stage: 'Stage',
        provider: 'Provider',
        status: 'Outcome',
        reason: 'Reason',
        attempts: 'Attempts',
        fetched: 'Fetched (Europe/London)',
        detail: 'Detail',
        reused: 'Reused from',
      },
      run: (label: string) => `run ${label}`,
      latestRun: 'latest run',
      reasons: {
        not_selected: 'not selected for itinerary search',
        budget: 'stopped: a budget cap was reached',
        provider_disabled: 'provider disabled',
        departed: 'departure date has passed',
        'cabin-not-offered': "the provider does not offer this definition's cabin",
        auth: 'the provider refused the credentials',
        'rate-limit': 'the provider rate-limited the request',
        quota: "the provider's quota is used up",
        upstream: 'the provider failed',
        parse: "the provider's answer could not be read",
        network: 'network failure',
        'limiter-timeout': 'waited too long for a request slot',
        'fx-unavailable': 'no exchange rate available',
        'currency-unsupported': 'currency not supported',
        'unknown-airport-tz': 'airport time zone unknown',
        'no-return-legs': 'no return legs offered',
        'unmappable-carrier': 'carrier code not recognised',
        'bad-local-time': 'a flight time could not be read',
        'cell-mismatch': 'the answer was for different dates or airports',
        'partial-expansion': 'some outbound flights could not be expanded',
      },
      offersDropped: (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'} could not be read and were dropped`,
      reasonRaw: (reason: string) => `other: ${reason}`,
      dash: '—',
      reusedFrom: (run: string) => `reused from ${run}`,
      prices: 'Prices for this cell',
      noPrices: 'No prices stored for this cell.',
      calendarPriceRun: (run: string) => `calendar price · ${run}`,
      observation: (seller: string, cls: string) => `itinerary offer · ${seller} · ${cls}`,
      showInResults: 'show in results',
      verifyCost: (maxCalls: number, left: string) =>
        `uses up to ${maxCalls} ${maxCalls === 1 ? 'call' : 'calls'} · ${left}`,
      monthLeft: (provider: string, left: number) => `${provider}: ${left} left this month`,
      noMonthCap: (provider: string) => `${provider}: no monthly cap`,
      verifyNoHeadroom: 'No calls left for this search this month.',
      verifyCapRefused: (message: string) => `Refused by a budget cap: ${message}`,
      verifyConflict: 'An itinerary search for this cell is already running.',
    },
  },
  durationView: {
    title: 'Duration',
    chartTitle: 'Cheapest found by stay length',
    chartNote:
      'n = priced cells behind each minimum; the legend gives n summed over all stay lengths. ns on the axis = no source searched that stay length. A missing bar elsewhere means that series found no price; the table names each gap. A faded bar with a black outline is stale.',
    xAxis: 'nights',
    yAxis: '£',
    tickNotSearched: (nights: number) => `${nights} ns`,
    verifiedSeries: (n: number) => `min among verified (class verified, n=${n})`,
    verifiedShort: 'min among verified',
    calendarSeries: (source: string, n: number) => `calendar, ${source} (constraints not checked, n=${n})`,
    calendarShort: (source: string) => `calendar, ${source}`,
    nightsLabel: (n: number) => `${n} nights`,
    nightsLink: (n: number) => `${n} nights: show in results`,
    tooltipValue: (price: string, n: number, departs: string) => `${price} (n=${n}) · departs ${departs}`,
    tooltipGap: (state: string) => state,
    seriesLine: (series: string, value: string) => `${series}: ${value}`,
    cellDetail: (n: number, departs: string) => `n=${n} · departs ${departs}`,
    notSearched: 'not searched',
    searchedNoPrice: 'searched, no price',
    notItinerarySearched: 'not itinerary-searched',
    itinerarySearchedNoPrice: 'itinerary-searched, no price',
    tableCaption: 'Cheapest found per stay length, with provenance',
    staleLine: (stale: number, shown: number) =>
      `${stale} of ${shown} shown prices are stale (older than one refresh cycle)`,
    empty:
      "No prices yet for any stay length in this definition's range. Run a search; Coverage shows what has been searched.",
  },
  historyView: {
    title: 'History',
    fetchChartTitle: 'Price by fetch date',
    connectorNote:
      'Each point is one run. Lines join consecutive scheduled runs only (at most 1.5 refresh periods apart); no price was fetched between two points.',
    xAxisFetched: 'fetched (Europe/London)',
    yAxis: '£',
    routeChartTitle: "Google's indicative route-level series: price by travel date",
    routeChartNote:
      'Reported by the vendor for the route as a whole, not searched cell by cell; its cabin and route scope are as the vendor states them.',
    xAxisTravelDate: 'travel date',
    routeSeries: "Google's indicative route-level series",
    calendarSeries: (source: string) =>
      `${source} · cheapest calendar price across this pair's cells, per run (constraints not checked)`,
    offerSeries: (source: string, seller: string) => `${source} · itinerary offer · ${seller}`,
    offerUnconfirmedSeries: (source: string, seller: string) =>
      `${source} · itinerary offer · ${seller} · price not confirmed by the final step`,
    pairPrefix: (pair: string, name: string) => `${pair} · ${name}`,
    cheapestCell: (origin: string, destination: string, dep: string, ret: string) =>
      `cheapest searched cell ${origin}→${destination} ${dep}–${ret}`,
    cellChanged: 'a different cell from the previous point',
    priceNotConfirmed: 'price not confirmed by the final step',
    routePicker: 'Route',
    pairOption: (origin: string, destination: string) => `${origin}→${destination}`,
    allPairs: (shown: number, total: number) =>
      shown === total ? 'All pairs' : `All pairs (first ${shown} of ${total})`,
    itineraryHeading: (route: string, departs: string, back: string, carriers: string) =>
      `${route} · ${departs} to ${back} · ${carriers}`,
    itineraryUnknown: (hash: string) =>
      `Itinerary ${hash}: open it from a Results row to see its route and dates`,
    itineraryHash: (hash: string) => `itinerary ${hash}`,
    backToRoute: 'Show route history',
    tableCaption: (series: string) => `${series}: every point, with provenance`,
    whenColumn: 'Fetched (Europe/London)',
    travelDateColumn: 'Travel date',
    priceColumn: 'Price',
    detailColumn: 'Detail',
    cabinNotStated: 'cabin not stated',
    routeProvenance: (source: string, cabin: string, age: string) =>
      `${source} · indicative route-level series · ${cabin} · ${age}`,
    rowLink: 'price history',
    empty: 'No price history yet for this selection. Each run adds a point.',
  },
```

`apps/web/test/copy/catalogue.test.ts`: add to `SAMPLES`

```ts
  // WP10 (Task 10.3)
  'calendarView.discoveryMarker': [{ priced: 1, empty: 2, no_data: 3, error: 4, skipped: 5, not_run: 6 }, 21],
  'calendarView.verificationMarker': [1, 10, 2],
  'calendarView.markerSource': [
    'Aviasales cache',
    '1 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 1',
  ],
  'calendarView.partlyVerified': [2],
  'calendarView.bandAria': [0],
  'calendarView.noPriceForDestination': ['JFK'],
  'calendarView.stay': [14, '28 Mar'],
  'calendarView.searchedFraction': [12, 48],
  'calendarView.staleLine': [3, 40, '8d'],
  'calendarView.legend.scaleQuintile': ['itinerary-search basis', 12],
  'calendarView.legend.scaleFlatFew': ['calendar basis', 4, 10],
  'calendarView.legend.scaleFlatNarrow': ['calendar basis', 20, '£400', '£430'],
  'calendarView.legend.scaleEmpty': ['calendar basis'],
  'calendarView.legend.band': [0, '£400', '£450', 2],
  'calendarView.legend.flatSwatch': [4],
  'calendarView.legend.hatched': ['verified', 1],
  'calendarView.panel.title': ['Sun 14 Mar 2027'],
  'calendarView.panel.dayCell': [14, 'Sun 28 Mar'],
  'calendarView.panel.cellOption': ['LHR', 'JFK', 14, 'Sun 28 Mar'],
  'calendarView.panel.run': ['14 Oct 2026'],
  'calendarView.panel.offersDropped': [3],
  'calendarView.panel.reasonRaw': ['something-new'],
  'calendarView.panel.reusedFrom': ['run 7 Oct 2026'],
  'calendarView.panel.calendarPriceRun': ['run 7 Oct 2026'],
  'calendarView.panel.observation': ['Example Air', 'verified'],
  'calendarView.panel.verifyCost': [6, 'SearchApi: 9385 left this month'],
  'calendarView.panel.monthLeft': ['SearchApi', 9385],
  'calendarView.panel.noMonthCap': ['SearchApi'],
  'calendarView.panel.verifyCapRefused': ['budget cap: provider-month:searchapi 10000 of 10000 calls'],
  'durationView.tickNotSearched': [13],
  'durationView.verifiedSeries': [3],
  'durationView.calendarSeries': ['Aviasales cache', 9],
  'durationView.calendarShort': ['Aviasales cache'],
  'durationView.nightsLabel': [14],
  'durationView.nightsLink': [14],
  'durationView.tooltipValue': ['£412', 5, 'Sun 14 Mar'],
  'durationView.tooltipGap': ['not searched'],
  'durationView.seriesLine': ['calendar, Aviasales cache', '£412 (n=5) · departs Sun 14 Mar'],
  'durationView.cellDetail': [5, 'Sun 14 Mar'],
  'durationView.staleLine': [1, 4],
  'historyView.calendarSeries': ['Aviasales cache'],
  'historyView.offerSeries': ['Google Flights via SearchApi', 'Example Air'],
  'historyView.offerUnconfirmedSeries': ['Google Flights via SearchApi', 'Example Air'],
  'historyView.pairPrefix': ['LHR-JFK', "Google's indicative route-level series"],
  'historyView.cheapestCell': ['LHR', 'JFK', 'Sun 14 Mar', 'Sun 28 Mar'],
  'historyView.pairOption': ['LHR', 'JFK'],
  'historyView.allPairs': [4, 4],
  'historyView.itineraryHeading': ['LHR→JFK', 'Sun 14 Mar 2027', 'Sun 28 Mar 2027', 'ZZ'],
  'historyView.itineraryUnknown': ['abc123'],
  'historyView.itineraryHash': ['abc123'],
  'historyView.tableCaption': ["Google's indicative route-level series"],
  'historyView.routeProvenance': [
    'Google Flights via SearchApi',
    'cabin not stated',
    'fetched 2h ago · provider age unknown',
  ],
```

and extend the "verified" test's `allowed` set with `'calendarView.partlyVerified'`, `'calendarView.legend.hatched'`, `'calendarView.panel.dayVerified'`, `'calendarView.panel.dayPartlyVerified'`, `'calendarView.panel.observation'`, `'durationView.verifiedSeries'` and `'durationView.verifiedShort'`. Each names the class ("class-verified", "partially verified") or sits beside a class-verified value.

`apps/web/test/msw/handlers.ts`: import `wp10Handlers` from `./wp10Handlers.js` and put `...wp10Handlers,` first in `handlers`. WP9's rendered-copy sweep then meets real WP10 content instead of unhandled requests.

`apps/web/src/lib/sources.ts`:

```ts
import type { ProviderId, SourceKind } from '@gmt/core';
import type { ProvidersResponse } from '../api/types.js';
import { COPY } from '../copy.js';

/**
 * The source in words for a provider's discovery counts, which carry only a providerId: the sourceKind of that
 * provider's discovery capability from GET /api/providers (spec §11 vocabulary). Before the providers response
 * arrives, or for a provider it does not list, the provider's own name stands in; no source kind is assumed.
 */
export function discoverySourceLabel(
  providerId: ProviderId,
  providers: ProvidersResponse | undefined,
): string {
  const capability =
    providers?.providers.find((p) => p.providerId === providerId)?.capabilities.discovery ?? null;
  return capability === null ? COPY.provider[providerId] : COPY.source[capability.sourceKind];
}

/**
 * A series label from the source kinds of the prices it plots (each price carries its own provenance). Normally one
 * kind; if a series mixes kinds every one is named, never only the first.
 */
export function sourceLabelOf(kinds: Iterable<SourceKind>): string {
  return [...new Set(kinds)].map((k) => COPY.source[k]).join(' / ');
}
```

`apps/web/src/views/Calendar/types.ts`:

```ts
import type { Cell, Iata, IsoDate } from '@gmt/core';
import type { CalendarDay, PriceCellData } from '../../api/types.js';

/** A price shown on a day; `cell` is null for a per-destination price (byDestination carries prices only). */
export type DayPrice = PriceCellData & { cell: Cell | null };

/** What one day renders, for all destinations or for one (spec §11 View B, per-destination filter). */
export interface DaySlice {
  /** Day-level discovery counts per provider: always for every destination (the contract has no per-destination counts). */
  discovery: CalendarDay['discovery'];
  /** False when the definition names no discovery provider: no outcome rows exist (spec §3, `not_applicable`). */
  discoveryConfigured: boolean;
  /** Null when the definition has no verification provider (spec §6.6 row 0: not applicable). */
  verification: CalendarDay['verification'] | null;
  cheapestVerified: DayPrice | null;
  cheapestPartiallyVerified: (DayPrice & { count: number }) | null;
  cheapestCalendar: DayPrice | null;
  /** Null for all destinations; otherwise the filtered destination, whose coverage the day-level counts do not break out. */
  destination: Iata | null;
}

/** A day as the grid renders it. */
export interface GridDay {
  date: IsoDate;
  slice: DaySlice;
}

/** Statuses with their own glyph on a day without a price (spec §11 View B; `skipped` added by plan decision 38). */
export type GlyphStatus = 'empty' | 'no_data' | 'error' | 'skipped' | 'not_run';

/** Which kind of price a day shows, and which kind the colour scale uses. */
export type DayBasis = 'verified' | 'calendar';
```

`apps/web/src/views/Calendar/marker.ts`:

```ts
import type { Buckets, Iata } from '@gmt/core';
import type { CalendarDay } from '../../api/types.js';
import { COPY } from '../../copy.js';
import type { DaySlice } from './types.js';

type DiscoveryEntry = CalendarDay['discovery'][number];

/** The six buckets summed (spec §3); `reused` is already counted inside its bucket, never a seventh. */
export function bucketTotal(b: Buckets): number {
  return b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run;
}

/** Cells a provider searched: priced, no fares or no cached data (spec §3 "searched"). */
export function searchedCount(b: Buckets): number {
  return b.priced + b.empty + b.no_data;
}

/**
 * True when the api's total M equals the six buckets' sum (spec §3: they sum to the cell count). A mismatch is a WP8
 * accounting bug; the day says "counts inconsistent" rather than picking one number (plan decision 38).
 */
export function countsConsistent(d: DiscoveryEntry): boolean {
  return d.total === bucketTotal(d.buckets);
}

/** "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M", M from the api (spec §11). */
export function formatDiscoveryMarker(d: DiscoveryEntry): string {
  const line = COPY.calendarView.discoveryMarker(d.buckets, d.total);
  return countsConsistent(d) ? line : `${line} · ${COPY.calendarView.countsInconsistent}`;
}

/** "itinerary-searched K of N selected +C on demand", or the not-configured note (spec §6.6 row 0). */
export function formatVerificationMarker(v: DaySlice['verification']): string {
  return v === null
    ? COPY.calendarView.verificationNotConfigured
    : COPY.calendarView.verificationMarker(v.itinerarySearched, v.selected, v.onDemand);
}

/** R′ for the header: reused outcomes over the slices and every discovery provider (spec §3). */
export function totalReused(slices: readonly DaySlice[]): number {
  return slices.reduce((sum, s) => sum + s.discovery.reduce((acc, d) => acc + d.buckets.reused, 0), 0);
}

/** The day's coverage cue (plan decision 38): searched cells of the day by its best-covered source. */
export type Coverage =
  | { kind: 'fraction'; searched: number; total: number; providerId: DiscoveryEntry['providerId'] }
  | { kind: 'inconsistent' }
  | { kind: 'all-destinations' }
  | { kind: 'none' };

/**
 * The coverage cue of a slice. A filtered day gets no fraction: the counts cover every destination (plan decision 38,
 * ruling 3). With several discovery providers the cue names the one that searched most cells, a lower bound on the
 * cells any source searched; the panel lists every provider.
 */
export function coverageOf(slice: DaySlice): Coverage {
  if (slice.destination !== null) return { kind: 'all-destinations' };
  if (slice.discovery.length === 0) return { kind: 'none' };
  if (!slice.discovery.every(countsConsistent)) return { kind: 'inconsistent' };
  let best: Coverage = { kind: 'none' };
  for (const d of slice.discovery) {
    const searched = searchedCount(d.buckets);
    if (best.kind !== 'fraction' || searched > best.searched)
      best = { kind: 'fraction', searched, total: d.total, providerId: d.providerId };
  }
  return best;
}

/** Options that come from the definition, not from the day. */
export interface SliceOptions {
  verificationConfigured: boolean;
  discoveryConfigured: boolean;
}

/**
 * The slice a day renders for "all" or one destination. byDestination carries prices only and lists every destination
 * of the definition (WP8); a destination it does not list has no price that day.
 */
export function sliceForDestination(day: CalendarDay, destination: Iata | 'all', o: SliceOptions): DaySlice {
  const base = {
    discovery: day.discovery,
    discoveryConfigured: o.discoveryConfigured,
    verification: o.verificationConfigured ? day.verification : null,
  };
  if (destination === 'all') {
    return {
      ...base,
      cheapestVerified: day.cheapestVerified,
      cheapestPartiallyVerified: day.cheapestPartiallyVerified,
      cheapestCalendar: day.cheapestCalendar,
      destination: null,
    };
  }
  const e = day.byDestination.find((x) => x.destination === destination);
  return {
    ...base,
    cheapestVerified: e?.cheapestVerified == null ? null : { ...e.cheapestVerified, cell: null },
    cheapestPartiallyVerified: null,
    cheapestCalendar: e?.cheapestCalendar == null ? null : { ...e.cheapestCalendar, cell: null },
    destination,
  };
}
```

`apps/web/src/views/Calendar/DayMarker.tsx`:

```tsx
import { useProviders } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { discoverySourceLabel } from '../../lib/sources.js';
import { formatDiscoveryMarker, formatVerificationMarker } from './marker.js';
import type { DaySlice } from './types.js';

/**
 * The full six-bucket day marker (spec §11 View B, §3): one line per discovery provider named by its source, then the
 * itinerary-search line. Shown in the side panel; the day cell carries only the coverage cue (plan decision 38).
 */
export function DayMarker({ slice }: { slice: DaySlice }) {
  const providers = useProviders();
  const C = COPY.calendarView;
  return (
    <div className="text-xs text-slate-800" data-testid="day-marker">
      {!slice.discoveryConfigured ? (
        <p>{C.noDiscoveryProvider}</p>
      ) : slice.discovery.length === 0 ? (
        <p>{C.noRunCoversDay}</p>
      ) : (
        <ul>
          {slice.discovery.map((d) => (
            <li key={d.providerId}>
              {C.markerSource(discoverySourceLabel(d.providerId, providers.data), formatDiscoveryMarker(d))}
            </li>
          ))}
        </ul>
      )}
      <p>{formatVerificationMarker(slice.verification)}</p>
      {slice.cheapestPartiallyVerified !== null ? (
        <p>{C.partlyVerified(slice.cheapestPartiallyVerified.count)}</p>
      ) : null}
      {slice.destination !== null ? <p className="italic">{C.countsAllDestinations}</p> : null}
    </div>
  );
}

/** "(R reused from earlier runs)" for the view header; nothing when R is 0 (spec §3). */
export function ReusedNote({ count }: { count: number }) {
  return count > 0 ? <span>{COPY.reusedNote(count)}</span> : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/lib/sources.test.ts test/views/calendar/marker.test.tsx test/copy`
Expected: PASS. Sources 5 tests, marker 9; in `test/copy` the catalogue (every new function sampled, no banned word, "verified" only on allowed paths), the source guard and the rendered sweep pass.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: WP10 endpoints and polling queries, copy, test builders, source labels, six-bucket day marker"
```

### Task 10.4: PriceCell's compact form (the calendar day)

**Files:**
- Create: `apps/web/test/components/priceCellCompact.test.tsx`
- Modify (WP9): `apps/web/src/components/PriceCell.tsx`, `apps/web/src/components/Provenance.tsx`

**Interfaces:**
- Consumes: `assertProvenance`, `effectiveAge`, `formatAgeCompact`, `formatAgeFull`, `COPY.providerShort`, `COPY.truncatedNote` (WP9).
- Produces: `PriceCellProps.compact`, `ProvenanceProps.compact`.

Plan decisions 36 and 38: every price goes through PriceCell, and a day cell shows price, compact badge, stay and coverage cue with details in the panel. The compact form keeps the price, the stale label, a short provider badge ("synthetic" is never shortened), the compact age, "≈" for FX, the dashed outline for calendar prices and the destination visible; the source in words, "constraints not checked" and the operator's note go to the title and to screen-reader text, and in full to the side panel. At phone width the age is screen-reader only (the day is about 48 px wide).

- [ ] **Step 1: Write the failing test**

`apps/web/test/components/priceCellCompact.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../src/components/PriceCell.js';
import { provCalendarAt, provItinerary, provSynthetic } from '../fixtures.wp10.js';
import { renderWithProviders } from '../render.js';

describe('PriceCell compact form, the calendar day (plan decisions 36, 38)', () => {
  it('keeps price, stale, short badge, compact age and destination visible; the rest in the title and screen-reader text', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <PriceCell
        compact
        pricePence={41200}
        provenance={provCalendarAt(2)}
        calendar
        stale
        destination="JFK"
        destinationNote="onward leg not included"
      />,
    );
    const prov = getByTestId('provenance');
    expect(getByText('£412')).toBeInTheDocument();
    expect(getByText('stale')).toBeInTheDocument();
    expect(prov).toHaveClass('border-dashed');
    expect(getByText('TP')).toBeInTheDocument();
    expect(getByText('2h ago · ≤2d')).toBeInTheDocument();
    expect(getByText('JFK')).toBeInTheDocument();
    expect(prov.getAttribute('title')).toBe(
      'Aviasales cache · constraints not checked · onward leg not included · fetched 2h ago · provider age unknown (≤2d before that)',
    );
    expect(prov).toHaveTextContent('Aviasales cache · constraints not checked · onward leg not included');
  });
  it('an itinerary price has no dashed outline; a synthetic price is never abbreviated', () => {
    const first = renderWithProviders(
      <PriceCell compact pricePence={52000} provenance={provItinerary(5)} calendar={false} stale={false} />,
    );
    expect(first.getByTestId('provenance')).not.toHaveClass('border-dashed');
    expect(first.getByText('SA')).toBeInTheDocument();
    first.unmount();
    const second = renderWithProviders(
      <PriceCell compact pricePence={30000} provenance={provSynthetic(1)} calendar stale={false} />,
    );
    expect(second.getByText('synthetic')).toBeInTheDocument();
  });
  it('says "cheapest of the rows read" for a price from a page-capped tile', () => {
    const { getByText } = renderWithProviders(
      <PriceCell
        compact
        truncated
        pricePence={41200}
        provenance={provCalendarAt(2)}
        calendar
        stale={false}
      />,
    );
    expect(getByText('cheapest of the rows read')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/components/priceCellCompact.test.tsx`
Expected: FAIL, 2 of 3: `Unable to find an element with the text: TP` and `… SA` (the full form renders "Travelpayouts" and "SearchApi"). The third passes already: `truncated` is WP9's (decision 36).

- [ ] **Step 3: Implement**

`apps/web/src/components/PriceCell.tsx` (WP9's component with the `compact` prop added; `truncated` is WP9's):

```tsx
import type { Provenance as ProvenanceT } from '@gmt/core';
import { COPY } from '../copy.js';
import { formatPence } from '../format.js';
import { assertProvenance, Provenance } from './Provenance.js';

export interface PriceCellProps {
  pricePence: number;
  provenance: ProvenanceT | undefined;
  calendar: boolean;
  stale: boolean;
  destination?: string | undefined;
  destinationNote?: string | null | undefined;
  /** Plan decisions 30 and 36: a price from a page-capped tile reads "cheapest of the rows read". */
  truncated?: boolean | undefined;
  /**
   * WP10 (plan decision 38): the calendar day form. Price, stale label, a short provider badge and the compact age stay
   * visible; the source in words, "constraints not checked" and the operator's note move to the title and to
   * screen-reader text, and in full to the side panel.
   */
  compact?: boolean | undefined;
}

/** The only component that prints a price. Wrap it in PriceBoundary. Spec §11, §9 item 6. */
export function PriceCell(props: PriceCellProps) {
  // why: validate before formatting, so a bare number can never reach the DOM even for one frame.
  assertProvenance(props.provenance);
  return (
    <span className="flex flex-col gap-0.5">
      <span className={`font-semibold tabular-nums ${props.compact === true ? 'text-sm' : ''}`}>
        {formatPence(props.pricePence)}
        {props.stale ? (
          <span className="ml-1 rounded bg-amber-200 px-1 text-xs font-normal">{COPY.stale}</span>
        ) : null}
      </span>
      {props.truncated === true ? <span className="text-[11px] italic">{COPY.truncatedNote}</span> : null}
      <Provenance
        provenance={props.provenance}
        calendar={props.calendar}
        destination={props.destination}
        destinationNote={props.destinationNote}
        compact={props.compact}
      />
    </span>
  );
}
```

`apps/web/src/components/Provenance.tsx`: add `/** WP10: the calendar day form (see PriceCell). */ compact?: boolean | undefined;` to `ProvenanceProps`, take `compact` in the parameter list, and put this branch after `fxTitle` is computed, before the full form's `return`:

```tsx
  if (compact === true) {
    // why: plan decision 38 — a calendar day keeps price, a short badge, the compact age and the destination; the
    // rest is in the title, in screen-reader text and in the side panel, so the heatmap stays readable.
    const hidden = [
      COPY.source[p.sourceKind],
      calendar ? COPY.constraintsNotChecked : null,
      destinationNote ?? null,
    ];
    const details = hidden.filter((x): x is string => x !== null && x !== '').join(' · ');
    return (
      <span
        data-testid="provenance"
        data-variant="compact"
        title={`${details} · ${formatAgeFull(age)}`}
        className={`inline-flex flex-wrap items-center gap-1 text-[11px] text-slate-800 ${calendar ? 'rounded border border-dashed border-slate-600 px-0.5' : ''}`}
      >
        <span className="rounded bg-slate-200 px-0.5 font-medium text-slate-900">
          {COPY.providerShort[p.providerId]}
        </span>
        <span className="max-sm:sr-only">{formatAgeCompact(age)}</span>
        {fxTitle !== null ? <span title={fxTitle}>{COPY.fxApprox}</span> : null}
        {destination !== undefined ? <span>{destination}</span> : null}
        <span className="sr-only">{fxTitle === null ? details : `${details} · ${fxTitle}`}</span>
      </span>
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/components test/copy`
Expected: PASS: the compact file 3 tests, WP9's provenance tests unchanged, and the source guard (no literal JSX text).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: PriceCell compact form for calendar days (decisions 36, 38)"
```

### Task 10.5: Day display: precedence, glyphs, default basis

**Files:**
- Create: `apps/web/src/views/Calendar/display.ts`, `apps/web/test/views/calendar/display.test.ts`

**Interfaces:**
- Consumes: `effectiveAge`, `compareAges`; `DaySlice`, `DayPrice`, `GlyphStatus`, `DayBasis`, `GridDay`.
- Produces: `GlyphReason`, `DayDisplay`, `resolveDayDisplay`, `defaultColourBasis`.

The precedence is spec §11's. With SearchApi's itinerary age `'unknown'` (spec rev 15), a stale verified price always loses to a known-age calendar price, and two unknown ages tie to verified; one test keeps a known-age itinerary provenance only to pin the equal-age tie. A priceless day says why: glyphs from its counts (now including `skipped`), "not searched yet" when discovery is configured but no run has rows for the day (WP8 sends `discovery: []` before the first run and for days a relative window adds), "no discovery provider configured" only from the definition, and nothing claimed about a filtered destination.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/display.test.ts`:

```ts
import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultColourBasis, resolveDayDisplay } from '../../../src/views/Calendar/display.js';
import {
  cellAt,
  disc,
  gridDay,
  priceAt,
  provCalendarAt,
  provItinerary,
  provItineraryKnownAge,
  slice,
} from '../../fixtures.wp10.js';
import { NOW } from '../../render.js';

const c14 = cellAt('2027-03-14', 14);

describe('day precedence (spec §11 View B, §8.1)', () => {
  it('a fresh class-verified price wins even over a cheaper calendar price, which the day then names', () => {
    const v = priceAt(52000, provItinerary(5), false, c14);
    const c = priceAt(41200, provCalendarAt(2), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({
      kind: 'price',
      basis: 'verified',
      price: v,
      stale: false,
      why: 'fresh-verified',
      cheaperCached: c,
    });
  });
  it('a dearer calendar price is not named as cached', () => {
    const v = priceAt(41200, provItinerary(5), false, c14);
    const c = priceAt(52000, provCalendarAt(2), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({
      cheaperCached: null,
    });
  });
  it('a stale SearchApi verified price (age unknown, spec rev 15) loses to any known-age calendar price', () => {
    const v = priceAt(52000, provItinerary(200), true, c14);
    const c = priceAt(41200, provCalendarAt(190), true, c14); // known worst case 238h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({
      kind: 'price',
      basis: 'calendar',
      price: c,
      stale: true,
      why: 'calendar-fresher',
      cheaperCached: null,
    });
  });
  it('two unknown ages tie, and ties go to verified', () => {
    const v = priceAt(52000, provItinerary(300), true, c14);
    const c = priceAt(41200, provCalendarAt(1, 'unknown'), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({
      basis: 'verified',
      why: 'stale-verified-fresher',
      cheaperCached: c,
    });
  });
  it('equal known ages go to verified (a known-age itinerary provider; none exists today)', () => {
    const v = priceAt(52000, provItineraryKnownAge(58, 0), true, c14); // 58h
    const c = priceAt(41200, provCalendarAt(10), false, c14); // 10 + 48 = 58h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({
      basis: 'verified',
    });
  });
  it('a stale calendar price still renders, labelled stale', () => {
    const c = priceAt(41200, provCalendarAt(400), true, c14);
    expect(resolveDayDisplay(slice({ cheapestCalendar: c }), NOW)).toMatchObject({
      basis: 'calendar',
      stale: true,
      why: 'calendar-only',
    });
  });
  it('a stale verified price with no calendar price renders, labelled stale', () => {
    const v = priceAt(52000, provItinerary(300), true, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v }), NOW)).toMatchObject({
      basis: 'verified',
      stale: true,
      why: 'stale-verified-only',
    });
  });
  it('a partially-verified price never becomes the day price', () => {
    const pv = { ...priceAt(30000, provItinerary(1), false, c14), count: 3 };
    expect(
      resolveDayDisplay(
        slice({ cheapestPartiallyVerified: pv, discovery: [disc('searchapi', { priced: 1 })] }),
        NOW,
      ).kind,
    ).toBe('glyphs');
  });
});

describe('days without a price (spec §11 View B, plan decision 38)', () => {
  it('one glyph per non-zero unpriced status across providers, in a fixed order, skipped included', () => {
    const s = slice({
      discovery: [
        disc('travelpayouts', { no_data: 3, not_run: 2, skipped: 1 }),
        disc('searchapi', { error: 1, empty: 4 }),
      ],
    });
    expect(resolveDayDisplay(s, NOW)).toEqual({
      kind: 'glyphs',
      glyphs: ['empty', 'no_data', 'error', 'skipped', 'not_run'],
      reason: 'counts',
    });
  });
  it('a day whose cells are all skipped shows the skipped glyph, never a blank', () => {
    expect(resolveDayDisplay(slice({ discovery: [disc('travelpayouts', { skipped: 12 })] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: ['skipped'],
      reason: 'counts',
    });
  });
  it('a configured definition whose day no run has reached is not searched, not "no provider" (po-wp10-001)', () => {
    expect(resolveDayDisplay(slice({ discovery: [] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: ['not_run'],
      reason: 'no-run',
    });
    expect(resolveDayDisplay(slice({ discovery: [], discoveryConfigured: false }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [],
      reason: 'no-provider',
    });
  });
  it('a filtered day with no price for its destination shows no glyph from another destination’s cells', () => {
    const s = slice({
      destination: asIata('JFK'),
      discovery: [disc('travelpayouts', { priced: 24, not_run: 24 })],
    });
    expect(resolveDayDisplay(s, NOW)).toEqual({ kind: 'glyphs', glyphs: [], reason: 'filtered' });
  });
});

describe('default colour basis (plan decision 38)', () => {
  const v = (d: string) =>
    gridDay(d, { cheapestVerified: priceAt(50000, provItinerary(5), false, cellAt(d, 14)) });
  const c = (d: string) =>
    gridDay(d, { cheapestCalendar: priceAt(40000, provCalendarAt(5), false, cellAt(d, 14)) });
  it('is the calendar basis with one verified day among many priced days', () => {
    expect(defaultColourBasis([v('2027-03-01'), c('2027-03-02'), c('2027-03-03')], true, NOW)).toBe(
      'calendar',
    );
  });
  it('is the calendar basis on an even split, and verified only with a strict majority', () => {
    expect(defaultColourBasis([v('2027-03-01'), c('2027-03-02')], true, NOW)).toBe('calendar');
    expect(defaultColourBasis([v('2027-03-01'), v('2027-03-02'), c('2027-03-03')], true, NOW)).toBe(
      'verified',
    );
  });
  it('is the calendar basis without a verification provider, and with no priced day', () => {
    expect(defaultColourBasis([v('2027-03-01')], false, NOW)).toBe('calendar');
    expect(defaultColourBasis([gridDay('2027-03-01')], true, NOW)).toBe('calendar');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/display.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/display.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/display.ts`:

```ts
import { compareAges, effectiveAge, type IsoDateTime } from '@gmt/core';
import type { DayBasis, DayPrice, DaySlice, GlyphStatus, GridDay } from './types.js';

/** Why a priceless day shows what it shows. */
export type GlyphReason =
  /** one glyph per non-zero unpriced bucket */
  | 'counts'
  /** discovery is configured but no run has outcome rows for this day yet: not searched */
  | 'no-run'
  /** the definition has no discovery provider */
  | 'no-provider'
  /** a destination filter is on and that destination has no price; the counts cover every destination */
  | 'filtered';

/** What one calendar day shows (spec §11 View B). */
export type DayDisplay =
  | {
      kind: 'price';
      basis: DayBasis;
      price: DayPrice;
      stale: boolean;
      why:
        | 'fresh-verified'
        | 'stale-verified-fresher'
        | 'calendar-fresher'
        | 'stale-verified-only'
        | 'calendar-only';
      /** A cheaper calendar price the verified day price hides (plan decision 38: "cached from £X"). */
      cheaperCached: DayPrice | null;
    }
  | { kind: 'glyphs'; glyphs: GlyphStatus[]; reason: GlyphReason };

const GLYPH_ORDER: readonly GlyphStatus[] = ['empty', 'no_data', 'error', 'skipped', 'not_run'];

function priceless(slice: DaySlice): DayDisplay {
  if (!slice.discoveryConfigured) return { kind: 'glyphs', glyphs: [], reason: 'no-provider' };
  // why: plan decision 38 — a filtered day's counts cover every destination, so no glyph may claim this destination's coverage.
  if (slice.destination !== null) return { kind: 'glyphs', glyphs: [], reason: 'filtered' };
  // why: WP8 sends discovery [] for a day no run has reached (no parent yet, or a relative window that moved on): not searched.
  if (slice.discovery.length === 0) return { kind: 'glyphs', glyphs: ['not_run'], reason: 'no-run' };
  const glyphs = GLYPH_ORDER.filter((s) => slice.discovery.some((d) => d.buckets[s] > 0));
  return { kind: 'glyphs', glyphs, reason: 'counts' };
}

/**
 * Spec §11 precedence: a class-verified price that is not stale (the api's `stale` uses STALE_AFTER_HOURS, §8.1);
 * else the fresher of a stale verified price and the cheapest calendar price (unknown age loses to known, two unknowns
 * and equal ages go to verified); else glyphs. Partially-verified prices never become the day price.
 */
export function resolveDayDisplay(slice: DaySlice, now: IsoDateTime): DayDisplay {
  const v = slice.cheapestVerified;
  const c = slice.cheapestCalendar;
  const cheaper = (shown: DayPrice) => (c !== null && c.pricePence < shown.pricePence ? c : null);
  if (v !== null && !v.stale) {
    return {
      kind: 'price',
      basis: 'verified',
      price: v,
      stale: false,
      why: 'fresh-verified',
      cheaperCached: cheaper(v),
    };
  }
  if (v !== null && c !== null) {
    // why: §8.1 — compareAges(a, b) < 0 means a is fresher; unknown loses to any known age; ties go to verified.
    const cmp = compareAges(effectiveAge(v.provenance, now), effectiveAge(c.provenance, now));
    return cmp <= 0
      ? {
          kind: 'price',
          basis: 'verified',
          price: v,
          stale: true,
          why: 'stale-verified-fresher',
          cheaperCached: cheaper(v),
        }
      : {
          kind: 'price',
          basis: 'calendar',
          price: c,
          stale: c.stale,
          why: 'calendar-fresher',
          cheaperCached: null,
        };
  }
  if (v !== null)
    return {
      kind: 'price',
      basis: 'verified',
      price: v,
      stale: true,
      why: 'stale-verified-only',
      cheaperCached: null,
    };
  if (c !== null)
    return {
      kind: 'price',
      basis: 'calendar',
      price: c,
      stale: c.stale,
      why: 'calendar-only',
      cheaperCached: null,
    };
  return priceless(slice);
}

/**
 * The default colour basis (plan decision 38): the calendar basis unless days showing a class-verified price are a
 * strict majority of the priced days, judged over all destinations so a filter change never flips what colour means.
 */
export function defaultColourBasis(
  days: readonly GridDay[],
  hasVerification: boolean,
  now: IsoDateTime,
): DayBasis {
  if (!hasVerification) return 'calendar';
  let priced = 0;
  let verified = 0;
  for (const d of days) {
    const disp = resolveDayDisplay(d.slice, now);
    if (disp.kind !== 'price') continue;
    priced += 1;
    if (disp.basis === 'verified') verified += 1;
  }
  return verified * 2 > priced ? 'verified' : 'calendar';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/display.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: day precedence, skipped and not-searched states, default colour basis (spec §11, §8.1, decision 38)"
```

### Task 10.6: Scale, flat scale and the calendar model

**Files:**
- Create: `apps/web/src/views/Calendar/{scale.ts,model.ts}`, `apps/web/test/views/calendar/scale.test.ts`

**Interfaces:**
- Produces: `Band`, `ScaleMode`, `LegendEntry`, `QuintileScale`, `MIN_BANDED_DAYS`, `BAND_CLASSES`, `FLAT_CLASS`, `PRICELESS_CLASS`, `quintileBand`, `buildScale`, `CalendarModel`, `buildCalendarModel`.

The quintile function: sort the n prices of the colour basis ascending; a price v gets band `min(4, floor(r × 5 / n))`, r being the count of prices strictly below v. Plan decision 38: with fewer than ten days, or when the dearest is less than 10% above the cheapest (`(max − min) × 10 < min`, integer arithmetic), every day gets one flat shade and the legend says which reason applies. The lightest band (teal-200) stays clearly tinted, and a priceless day is neutral grey with text, so "dearest" never reads as "not searched". The model also counts the shown and stale prices for the header line.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/scale.test.ts` (the invariant loop uses a seeded generator, so it is reproducible without a new dependency):

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildCalendarModel } from '../../../src/views/Calendar/model.js';
import { buildScale, quintileBand } from '../../../src/views/Calendar/scale.js';
import { cellAt, gridDay, priceAt, provCalendarAt, provItinerary } from '../../fixtures.wp10.js';
import { NOW } from '../../render.js';

/** A small seeded generator (mulberry32): the invariant loops below are reproducible without a new dependency. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ten = (from: number, step: number) => Array.from({ length: 10 }, (_, i) => from + i * step);

describe('quintile scale (spec §11 View B)', () => {
  it('ten distinct values take two per band', () => {
    const sorted = ten(40000, 5000);
    expect(sorted.map((v) => quintileBand(sorted, v))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('ties share the lower band', () => {
    expect(quintileBand([100, 100, 200], 100)).toBe(0);
    expect(quintileBand([100, 100, 200], 200)).toBe(3);
  });
  it('an empty scale refuses to band anything', () => {
    expect(() => quintileBand([], 1)).toThrow(RangeError);
    expect(buildScale([])).toMatchObject({ mode: 'empty', count: 0, legend: [], minPence: null });
  });
  it('the legend is numeric: one entry per occupied band with its pence range and day count', () => {
    const s = buildScale([...ten(40000, 5000)].reverse());
    expect(s.mode).toBe('quintile');
    expect(s.legend[0]).toEqual({ band: 0, minPence: 40000, maxPence: 45000, count: 2 });
    expect(s.legend[4]).toEqual({ band: 4, minPence: 80000, maxPence: 85000, count: 2 });
  });
});

describe('flat scale (plan decision 38)', () => {
  it('fewer than ten days give one shade and no bands', () => {
    const s = buildScale(ten(40000, 5000).slice(0, 9));
    expect(s.mode).toBe('flat-few');
    expect(s.band(40000)).toBeNull();
    expect(s.legend).toEqual([]);
  });
  it('a spread under 10% of the cheapest gives one shade; exactly 10% is banded', () => {
    expect(buildScale(ten(40000, 400)).mode).toBe('flat-narrow'); // 40000–43600: 9%
    expect(buildScale([...ten(40000, 400).slice(0, 9), 44000]).mode).toBe('quintile'); // 10%
  });
});

describe('scale invariants over seeded random inputs (TS-3)', () => {
  it('200 runs: bands in 0..4 and monotone in price; legend counts sum to n; legend ranges ordered and disjoint', () => {
    const rand = seeded(20261015);
    let banded = 0;
    for (let run = 0; run < 200; run += 1) {
      const n = 1 + Math.floor(rand() * 60);
      const values = Array.from(
        { length: n },
        () => 30000 + Math.floor(rand() * 4) * Math.floor(rand() * 20000),
      );
      const s = buildScale(values);
      if (s.mode !== 'quintile') {
        expect(s.legend, `run ${run}`).toEqual([]);
        continue;
      }
      banded += 1;
      const bands = [...values].sort((a, b) => a - b).map((v) => s.band(v) ?? -1);
      expect(Math.min(...bands), `run ${run}`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...bands), `run ${run}`).toBeLessThanOrEqual(4);
      for (let i = 1; i < bands.length; i += 1)
        expect(bands[i] ?? 0, `run ${run}`).toBeGreaterThanOrEqual(bands[i - 1] ?? 0);
      expect(
        s.legend.reduce((sum, e) => sum + e.count, 0),
        `run ${run}`,
      ).toBe(n);
      for (let i = 1; i < s.legend.length; i += 1) {
        const prev = s.legend[i - 1];
        const cur = s.legend[i];
        expect(
          cur !== undefined && prev !== undefined && cur.minPence > prev.maxPence && cur.band > prev.band,
          `run ${run}`,
        ).toBe(true);
      }
    }
    // why: the loop must exercise the banded path, not only the flat one.
    expect(banded).toBeGreaterThan(50);
  });
});

describe('calendar model: one basis at a time, other-basis days hatched and excluded (spec §11 View B)', () => {
  const v = (date: string, pence: number) =>
    gridDay(date, { cheapestVerified: priceAt(pence, provItinerary(5), false, cellAt(date, 14)) });
  const c = (date: string, pence: number, stale = false) =>
    gridDay(date, { cheapestCalendar: priceAt(pence, provCalendarAt(5), stale, cellAt(date, 14)) });
  const verifiedDays = ten(40000, 5000).map((p, i) => v(`2027-03-${String(i + 1).padStart(2, '0')}`, p));
  const days = [...verifiedDays, c('2027-03-15', 30000, true)];

  it('colouring by verified bands only the verified days; the cheaper calendar day is hatched and does not move the scale', () => {
    const m = buildCalendarModel(days, 'verified', NOW);
    expect(m.scale.count).toBe(10);
    expect(m.bands.get(asIsoDate('2027-03-01'))).toBe(0);
    expect(m.hatchedDays).toBe(1);
    expect(m.bands.get(asIsoDate('2027-03-15'))).toBeUndefined();
    expect(m).toMatchObject({ shownPrices: 11, stalePrices: 1 });
  });
  it('colouring by calendar puts the one calendar day on a flat scale and hatches the ten verified days', () => {
    const m = buildCalendarModel(days, 'calendar', NOW);
    expect(m.scale.mode).toBe('flat-few');
    expect(m.flatDays.has(asIsoDate('2027-03-15'))).toBe(true);
    expect(m.bands.size).toBe(0);
    expect(m.hatchedDays).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/scale.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/scale.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/scale.ts`:

```ts
/** A quintile band; 0 is the cheapest fifth (spec §11 View B). */
export type Band = 0 | 1 | 2 | 3 | 4;
const BANDS = [0, 1, 2, 3, 4] as const satisfies readonly Band[];

/** Plan decision 38: fewer than this many days on the scale is too few for quintiles. */
export const MIN_BANDED_DAYS = 10;

/**
 * How the scale colours its days. `flat-few` and `flat-narrow` give every day one shade (plan decision 38: fewer than
 * ten days, or a spread under 10% of the cheapest price) so the colour never implies a spread the data lacks.
 */
export type ScaleMode = 'quintile' | 'flat-few' | 'flat-narrow' | 'empty';

/** One numeric legend row: the pence range and the number of days in a band. */
export interface LegendEntry {
  band: Band;
  minPence: number;
  maxPence: number;
  count: number;
}

export interface QuintileScale {
  mode: ScaleMode;
  count: number;
  minPence: number | null;
  maxPence: number | null;
  /** The band of a price on the scale, or null on a flat scale. */
  band(v: number): Band | null;
  legend: LegendEntry[];
}

/**
 * Sequential single-hue fills (dataviz skill). The lightest band (teal-200) stays clearly tinted, so "dearest" never
 * reads as a priceless day (slate-100 with text). Price text and the screen-reader band label carry the meaning.
 */
export const BAND_CLASSES: Readonly<Record<Band, string>> = {
  0: 'bg-teal-800 text-white',
  1: 'bg-teal-600 text-white',
  2: 'bg-teal-400 text-black',
  3: 'bg-teal-300 text-black',
  4: 'bg-teal-200 text-black',
};
/** The one shade of a flat scale. */
export const FLAT_CLASS = 'bg-teal-300 text-black';
/** A day with no price: neutral, never a band colour; it always carries text saying why. */
export const PRICELESS_CLASS = 'border border-slate-300 bg-slate-100 text-black';

/** Band of v within `sorted` (ascending): floor(r × 5 / n), r = count of values strictly below v. */
export function quintileBand(sorted: readonly number[], v: number): Band {
  if (sorted.length === 0) throw new RangeError('quintileBand: empty scale');
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = sorted[mid];
    if (x !== undefined && x < v) lo = mid + 1;
    else hi = mid;
  }
  // why: an index into an `as const` tuple, never a cast to Band.
  return BANDS[Math.min(4, Math.floor((lo * 5) / sorted.length))] ?? 4;
}

function modeOf(sorted: readonly number[]): ScaleMode {
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) return 'empty';
  if (sorted.length < MIN_BANDED_DAYS) return 'flat-few';
  // why: integer arithmetic for "spread under 10% of the cheapest" (money never in a float).
  return (max - min) * 10 < min ? 'flat-narrow' : 'quintile';
}

/** The scale over the shown days of one basis, its mode and its numeric legend. */
export function buildScale(values: readonly number[]): QuintileScale {
  const sorted = [...values].sort((a, b) => a - b);
  const mode = modeOf(sorted);
  const legend: LegendEntry[] = [];
  if (mode === 'quintile') {
    for (const v of sorted) {
      const b = quintileBand(sorted, v);
      const last = legend[legend.length - 1];
      // why: bands never decrease as price rises, so consecutive equal bands merge into one legend row.
      if (last !== undefined && last.band === b) {
        last.maxPence = v;
        last.count += 1;
      } else legend.push({ band: b, minPence: v, maxPence: v, count: 1 });
    }
  }
  return {
    mode,
    count: sorted.length,
    minPence: sorted[0] ?? null,
    maxPence: sorted[sorted.length - 1] ?? null,
    band: (v) => (mode === 'quintile' ? quintileBand(sorted, v) : null),
    legend,
  };
}
```

`apps/web/src/views/Calendar/model.ts`:

```ts
import type { IsoDate, IsoDateTime } from '@gmt/core';
import { type DayDisplay, resolveDayDisplay } from './display.js';
import { type Band, buildScale, type QuintileScale } from './scale.js';
import type { DayBasis, GridDay } from './types.js';

/** Per-day displays, the one-basis colour scale and the counts the header and legend need (spec §11 View B). */
export interface CalendarModel {
  colourBasis: DayBasis;
  displays: ReadonlyMap<IsoDate, DayDisplay>;
  /** Quintile band per day on the scale; empty when the scale is flat. */
  bands: ReadonlyMap<IsoDate, Band>;
  /** Days on a flat scale (plan decision 38: too few days or too narrow a spread for bands). */
  flatDays: ReadonlySet<IsoDate>;
  scale: QuintileScale;
  hatchedDays: number;
  /** Days showing a price, and how many of those prices are stale (the header's "N of M stale" line). */
  shownPrices: number;
  stalePrices: number;
}

/** Resolves every day, scales the days whose shown price is of `colourBasis`, and counts the hatched rest. */
export function buildCalendarModel(
  days: readonly GridDay[],
  colourBasis: DayBasis,
  now: IsoDateTime,
): CalendarModel {
  const displays = new Map<IsoDate, DayDisplay>();
  for (const d of days) displays.set(d.date, resolveDayDisplay(d.slice, now));
  const onBasis: Array<{ date: IsoDate; pence: number }> = [];
  let hatchedDays = 0;
  let shownPrices = 0;
  let stalePrices = 0;
  for (const [date, disp] of displays) {
    if (disp.kind !== 'price') continue;
    shownPrices += 1;
    if (disp.stale) stalePrices += 1;
    if (disp.basis === colourBasis) onBasis.push({ date, pence: disp.price.pricePence });
    else hatchedDays += 1; // why: spec §11 — days showing the other basis are hatched and excluded from the scale
  }
  const scale = buildScale(onBasis.map((x) => x.pence));
  const bands = new Map<IsoDate, Band>();
  const flatDays = new Set<IsoDate>();
  for (const x of onBasis) {
    const b = scale.band(x.pence);
    if (b === null) flatDays.add(x.date);
    else bands.set(x.date, b);
  }
  return { colourBasis, displays, bands, flatDays, scale, hatchedDays, shownPrices, stalePrices };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar`
Expected: PASS: marker 9, display 15, scale 9.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: quintile and flat scales per basis, calendar model with hatched and stale counts"
```

### Task 10.7: Calendar grid, coverage cue, legend and keyboard

**Files:**
- Create: `apps/web/src/views/Calendar/{CoverageCue.tsx,CalendarGrid.tsx,CalendarLegend.tsx,calendar.css}`, `apps/web/test/views/calendar/grid.test.tsx`

**Interfaces:**
- Consumes: `CalendarModel`, `GridDay`, `coverageOf`, `BAND_CLASSES`, `FLAT_CLASS`, `PRICELESS_CLASS`, `MIN_BANDED_DAYS`; WP9's `PriceCell` (compact), `PriceBoundary`, `COPY`; the `format.ts` forms; `addDays`, `monthOf`.
- Produces: `FOCUS_RING`, `targetOf`, `CalendarGrid({ days, model, months, destinationNotes, onOpen })`, `CoverageCue({ coverage })`, `CalendarLegend({ model, filtered })`.

The grid follows the APG grid pattern: one `role="grid"` table per drawn month, `role="gridcell"` days with a roving `tabIndex`; arrows move by a day or a week across drawn months, Home and End to Monday and Sunday, PageUp and PageDown to the same day of the month before or after; focus moves only to a drawn day with data. A day shows its number, PriceCell's compact form, the stay ("14n · back 28 Mar", or "stay: see panel" for a per-destination price, which has no cell), "cached from" with the cheaper calendar price's own compact PriceCell, and the coverage cue. Every meaning has text or a pattern: band number and "not on the colour scale" in screen-reader text, hatching, swatches and glyphs with words. The legend sits above the grid.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/grid.test.tsx`:

```tsx
import { asIsoMonth, type Buckets, monthOf } from '@gmt/core';
import { within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarGrid, FOCUS_RING } from '../../../src/views/Calendar/CalendarGrid.js';
import { CalendarLegend } from '../../../src/views/Calendar/CalendarLegend.js';
import { buildCalendarModel } from '../../../src/views/Calendar/model.js';
import type { DayBasis, GridDay } from '../../../src/views/Calendar/types.js';
import {
  cellAt,
  disc,
  gridDay,
  priceAt,
  provCalendarAt,
  provItinerary,
  provSynthetic,
  slice,
} from '../../fixtures.wp10.js';
import { NOW, renderWithProviders } from '../../render.js';

const vDay = (date: string, pence: number): GridDay =>
  gridDay(date, {
    cheapestVerified: priceAt(pence, provItinerary(5), false, cellAt(date, 14)),
    discovery: [disc('searchapi', { priced: 48 })],
  });
const cDay = (date: string, pence: number, stale = false, truncated = false): GridDay =>
  gridDay(date, {
    cheapestCalendar: priceAt(pence, provCalendarAt(5), stale, cellAt(date, 14), truncated),
    discovery: [disc('travelpayouts', { priced: 20, no_data: 4, not_run: 24 })],
  });
const gDay = (date: string, b: Partial<Buckets>): GridDay =>
  gridDay(date, { discovery: [disc('travelpayouts', b)] });
const tenVerified = Array.from({ length: 10 }, (_, i) =>
  vDay(`2027-03-${String(i + 1).padStart(2, '0')}`, 40000 + i * 5000),
);

function renderGrid(
  days: GridDay[],
  basis: DayBasis = 'verified',
  notes: Record<string, string> = {},
  filtered = false,
) {
  const onOpen = vi.fn();
  const model = buildCalendarModel(days, basis, NOW);
  const months = [...new Set(days.map((d) => monthOf(d.date)))];
  const r = renderWithProviders(
    <>
      <CalendarLegend model={model} filtered={filtered} />
      <CalendarGrid days={days} model={model} months={months} destinationNotes={notes} onOpen={onOpen} />
    </>,
  );
  return { onOpen, ...r };
}
function dayCell(date: string): HTMLTableCellElement {
  const el = document.querySelector(`[data-date="${date}"]`);
  if (!(el instanceof HTMLTableCellElement)) throw new Error(`no day cell ${date}`);
  return el;
}

describe('calendar grid (spec §11 View B, Accessibility; plan decision 38)', () => {
  it('places each day under its weekday in its own month grid, and draws only the months it is given', () => {
    const days = [vDay('2027-03-14', 41200), vDay('2027-04-01', 41200)];
    const model = buildCalendarModel(days, 'verified', NOW);
    const { getByRole, queryByRole } = renderWithProviders(
      <CalendarGrid
        days={days}
        model={model}
        months={[asIsoMonth('2027-03')]}
        destinationNotes={{}}
        onOpen={vi.fn()}
      />,
    );
    expect(dayCell('2027-03-14').cellIndex).toBe(6); // Sunday
    expect(getByRole('grid', { name: 'March 2027' })).toContainElement(dayCell('2027-03-14'));
    expect(queryByRole('grid', { name: 'April 2027' })).toBeNull();
  });

  it('colours by one basis in quintiles; other-basis days are hatched, excluded and named in the numeric legend', () => {
    const days = [...tenVerified, cDay('2027-03-13', 30000)];
    const first = renderGrid(days, 'verified');
    expect(['01', '02', '05', '10'].map((d) => dayCell(`2027-03-${d}`).dataset.band)).toEqual([
      '0',
      '0',
      '2',
      '4',
    ]);
    expect(dayCell('2027-03-13')).toHaveClass('day-hatched');
    expect(within(dayCell('2027-03-13')).getByText('not on the colour scale')).toBeInTheDocument();
    expect(within(dayCell('2027-03-01')).getByText('price band 1 of 5, cheapest')).toBeInTheDocument();
    const legend = first.getByTestId('calendar-legend');
    expect(legend).toHaveTextContent(
      'Colour: itinerary-search basis prices on 10 days, in five price bands (quintiles of the days shown)',
    );
    expect(legend).toHaveTextContent('band 1: £400–£450 (2 days)');
    expect(legend).toHaveTextContent('band 5: £800–£850 (2 days)');
    expect(legend).toHaveTextContent(
      'hatched: 1 day shows a calendar price instead and is not on this scale',
    );
    first.unmount();

    const second = renderGrid(days, 'calendar');
    expect(dayCell('2027-03-13').dataset.band).toBe('flat');
    expect(second.getByTestId('calendar-legend')).toHaveTextContent(
      'Colour: one shade for calendar basis prices on 1 day; fewer than 10 days are too few for price bands',
    );
    expect(second.getByTestId('calendar-legend')).toHaveTextContent(
      'hatched: 10 days show a class-verified price instead and are not on this scale',
    );
  });

  it('the legend explains every mark: dashed, stale, coverage, cached, rows read, stay, glyphs with skipped', () => {
    const { getByTestId } = renderGrid([gDay('2027-03-08', { not_run: 1 })], 'calendar', {}, true);
    const legend = getByTestId('calendar-legend');
    for (const text of [
      'dashed outline: a calendar price; constraints not checked',
      'stale: older than one refresh cycle; shown and labelled, never hidden',
      'S/M searched with a striped square',
      'cached from £X',
      'cheapest of the rows read',
      'Nn · back <date>',
      'the coverage counts cover all destinations',
      '– skipped (a budget stop, a disabled provider or a passed date; reasons in the panel)',
      '○ not searched',
    ])
      expect(legend).toHaveTextContent(text);
  });

  it('a day shows price, compact badge, stay and coverage cue; details are in the title and the panel', () => {
    renderGrid([vDay('2027-03-08', 40000), cDay('2027-03-09', 30000, true)], 'verified', {
      JFK: 'onward leg not included',
    });
    const v = within(dayCell('2027-03-08'));
    const prov = v.getByTestId('provenance');
    expect(prov).toHaveAttribute('data-variant', 'compact');
    expect(prov).not.toHaveClass('border-dashed');
    expect(prov).toHaveTextContent('SA');
    expect(prov.getAttribute('title')).toContain('Google Flights via SearchApi');
    expect(prov.getAttribute('title')).toContain('onward leg not included');
    expect(prov).toHaveTextContent('JFK');
    expect(v.getByTestId('day-stay')).toHaveTextContent('14n · back 22 Mar');
    expect(v.getByTestId('coverage-cue')).toHaveTextContent('48/48 searched');
    expect(v.getByTestId('coverage-cue')).toHaveAttribute('data-coverage', 'full');
    const c = within(dayCell('2027-03-09'));
    expect(c.getByTestId('provenance')).toHaveClass('border-dashed');
    expect(c.getByTestId('provenance')).toHaveTextContent('constraints not checked'); // screen-reader text
    expect(dayCell('2027-03-09')).toHaveTextContent('stale');
    expect(dayCell('2027-03-09')).toHaveTextContent('£300');
    expect(c.getByTestId('coverage-cue')).toHaveTextContent('24/48 searched');
    expect(c.getByTestId('coverage-cue')).toHaveAttribute('data-coverage', 'partial');
  });

  it('a verified day that hides a cheaper cached fare shows "cached from" with that price’s provenance', () => {
    const d = gridDay('2027-03-08', {
      cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-08', 14)),
      cheapestCalendar: priceAt(41000, provCalendarAt(2), false, cellAt('2027-03-08', 12)),
      discovery: [disc('travelpayouts', { priced: 48 })],
    });
    renderGrid([d]);
    const cached = within(dayCell('2027-03-08')).getByTestId('cached-from');
    expect(cached).toHaveTextContent('cached from');
    expect(cached).toHaveTextContent('£410');
    expect(within(cached).getByTestId('provenance')).toHaveClass('border-dashed');
  });

  it('a price from a page-capped tile says "cheapest of the rows read" (plan decisions 30, 36)', () => {
    renderGrid([cDay('2027-03-09', 30000, false, true)], 'calendar');
    expect(dayCell('2027-03-09')).toHaveTextContent('cheapest of the rows read');
  });

  it('a synthetic price carries the synthetic badge and source on the day (spec §5.5)', () => {
    renderGrid(
      [
        gridDay('2027-03-09', {
          cheapestCalendar: priceAt(30000, provSynthetic(1), false, cellAt('2027-03-09', 14)),
        }),
      ],
      'calendar',
    );
    const prov = within(dayCell('2027-03-09')).getByTestId('provenance');
    expect(prov).toHaveTextContent('synthetic');
    expect(prov).toHaveTextContent('synthetic fixture data');
  });

  it('a total that disagrees with its buckets shows "counts inconsistent" instead of a fraction', () => {
    renderGrid(
      [
        gridDay('2027-03-09', {
          cheapestCalendar: priceAt(30000, provCalendarAt(1), false, cellAt('2027-03-09', 14)),
          discovery: [disc('travelpayouts', { priced: 10 }, 48)],
        }),
      ],
      'calendar',
    );
    expect(within(dayCell('2027-03-09')).getByTestId('coverage-cue')).toHaveTextContent(
      'counts inconsistent',
    );
  });

  it('withholds a day price that arrives without provenance', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prevent = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', prevent);
    try {
      const broken = vDay('2027-03-08', 40000);
      if (broken.slice.cheapestVerified)
        Object.assign(broken.slice.cheapestVerified, { provenance: undefined });
      renderGrid([broken]);
      expect(dayCell('2027-03-08')).toHaveTextContent('price withheld: provenance missing');
      expect(dayCell('2027-03-08')).not.toHaveTextContent('£400');
    } finally {
      window.removeEventListener('error', prevent);
      errors.mockRestore();
    }
  });

  it('days without a price show distinct glyphs with text, never blank; a skipped-only day says skipped', () => {
    renderGrid([
      gDay('2027-03-08', { empty: 1, no_data: 1, error: 1, skipped: 1, not_run: 1 }),
      gDay('2027-03-09', { skipped: 48 }),
    ]);
    const glyphs = [...dayCell('2027-03-08').querySelectorAll('[data-glyph]')];
    expect(glyphs.map((g) => g.getAttribute('data-glyph'))).toEqual([
      'empty',
      'no_data',
      'error',
      'skipped',
      'not_run',
    ]);
    expect(new Set(glyphs.map((g) => g.querySelector('[aria-hidden="true"]')?.textContent)).size).toBe(5);
    expect(glyphs.map((g) => g.textContent)).toEqual([
      '∅ no fares',
      '? no cached data',
      '! error',
      '– skipped',
      '○ not searched',
    ]);
    expect(dayCell('2027-03-09')).toHaveTextContent('– skipped');
    expect(dayCell('2027-03-09')).toHaveClass('bg-slate-100');
  });

  it('a day no run reaches says not searched; a filtered day with no price says so and claims no coverage', () => {
    const noRun = gridDay('2027-03-08');
    const filtered: GridDay = {
      date: noRun.date,
      slice: slice({
        destination: cellAt('2027-03-08', 1).destination,
        discovery: [disc('travelpayouts', { not_run: 48 })],
      }),
    };
    const first = renderGrid([noRun]);
    expect(dayCell('2027-03-08')).toHaveTextContent('○ not searched');
    expect(dayCell('2027-03-08')).toHaveTextContent('not searched yet: no run covers this day');
    first.unmount();
    renderGrid([filtered]);
    expect(dayCell('2027-03-08')).toHaveTextContent('no JFK price');
    expect(dayCell('2027-03-08')).toHaveTextContent('coverage counts cover all destinations');
    expect(dayCell('2027-03-08').querySelectorAll('[data-glyph]')).toHaveLength(0);
  });

  it('is keyboard-operable: arrows, Home/End, PageUp/PageDown, Enter and Space, one tab stop, visible focus', async () => {
    const dates = [
      '2027-03-03',
      '2027-03-29',
      '2027-03-30',
      '2027-03-31',
      '2027-04-01',
      '2027-04-02',
      '2027-04-04',
      '2027-04-06',
      '2027-04-07',
      '2027-04-30',
    ];
    const { onOpen, user } = renderGrid(dates.map((d) => vDay(d, 40000)));
    await user.tab();
    expect(dayCell('2027-03-03')).toHaveFocus();
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    dayCell('2027-03-30').focus();
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-03-31')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // across the month boundary
    await user.keyboard('{ArrowDown}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // 2027-04-08 has no data: focus stays
    await user.keyboard('{End}');
    expect(dayCell('2027-04-04')).toHaveFocus(); // Sunday of that week
    await user.keyboard('{Home}');
    expect(dayCell('2027-03-29')).toHaveFocus(); // Monday of that week
    await user.keyboard('{PageDown}');
    expect(dayCell('2027-03-29')).toHaveFocus(); // 29 Apr has no data: focus stays
    dayCell('2027-03-30').focus();
    await user.keyboard('{PageDown}');
    expect(dayCell('2027-04-30')).toHaveFocus();
    await user.keyboard('{PageUp}');
    expect(dayCell('2027-03-30')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('2027-03-30', cellAt('2027-03-30', 14));
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(dayCell('2027-03-30').className).toContain(FOCUS_RING);
  });

  it('clicking a glyph day opens the panel with no preselected cell', async () => {
    const { onOpen, user } = renderGrid([gDay('2027-03-08', { not_run: 48 })]);
    await user.click(dayCell('2027-03-08'));
    expect(onOpen).toHaveBeenCalledWith('2027-03-08', null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/grid.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CalendarGrid.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/calendar.css` (a stylesheet, not inline styles: spec §4's CSP):

```css
/* View B patterns (spec §11, plan decision 38). Stylesheet rules, not inline styles: spec §4's CSP blocks inline styles.
   Patterns, not colours, so each meaning survives greyscale and colour-blindness. */

/* A day showing the other basis: hatched, not on the colour scale. */
.day-hatched {
  background-color: #f4f4f5;
  background-image: repeating-linear-gradient(45deg, transparent 0 6px, rgb(0 0 0 / 0.22) 6px 8px);
}

/* Coverage cue swatch: solid when every cell of the day was searched, striped when part of it was not. */
.cov-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
}
.cov-full {
  background-color: currentColor;
}
.cov-partial {
  background-image: repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 4px);
}
```

`apps/web/src/views/Calendar/CoverageCue.tsx`:

```tsx
import { COPY } from '../../copy.js';
import type { Coverage } from './marker.js';

/**
 * The day's visible, non-colour coverage cue (plan decision 38): "S/M searched" at 11 px beside a solid swatch when the
 * whole day was searched and a striped one when part was not, so thin coverage is visible without reading counts.
 */
export function CoverageCue({ coverage }: { coverage: Coverage }) {
  const C = COPY.calendarView;
  if (coverage.kind === 'none') return null;
  if (coverage.kind !== 'fraction') {
    return (
      <p data-testid="coverage-cue" className="text-[11px] italic">
        {coverage.kind === 'inconsistent' ? C.countsInconsistent : C.countsAllDestinations}
      </p>
    );
  }
  const full = coverage.searched === coverage.total;
  return (
    <p
      data-testid="coverage-cue"
      data-coverage={full ? 'full' : 'partial'}
      className="flex items-center gap-1 text-[11px]"
    >
      <span aria-hidden="true" className={`cov-swatch ${full ? 'cov-full' : 'cov-partial'}`} />
      {C.searchedFraction(coverage.searched, coverage.total)}
    </p>
  );
}
```

`apps/web/src/views/Calendar/CalendarGrid.tsx`:

```tsx
import { addDays, type CellKey, type Iata, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { type KeyboardEvent, useRef, useState } from 'react';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import {
  formatDayLong,
  formatDayOfMonth,
  formatIsoDateShort,
  formatIsoMonth,
  monthDays,
  WEEKDAYS,
  weekdayIndex,
} from '../../format.js';
import { CoverageCue } from './CoverageCue.js';
import type { DayDisplay } from './display.js';
import { coverageOf } from './marker.js';
import type { CalendarModel } from './model.js';
import { BAND_CLASSES, FLAT_CLASS, PRICELESS_CLASS } from './scale.js';
import type { DaySlice, GlyphStatus, GridDay } from './types.js';
import './calendar.css';

/** Visible focus (spec §11 accessibility); focus-visible keeps it off mouse clicks. Exported for the grid test. */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export interface CalendarGridProps {
  days: readonly GridDay[];
  model: CalendarModel;
  /** The months to draw: every month of the window, or one at a time at phone width (plan decision 38). */
  months: readonly IsoMonth[];
  destinationNotes: Partial<Record<Iata, string>>;
  onOpen(date: IsoDate, cell: CellKey | null): void;
}

/** Monday-first weeks of one month, null for padding. */
function weeksOf(month: IsoMonth): Array<Array<IsoDate | null>> {
  const dates = monthDays(month);
  const first = dates[0];
  const cells: Array<IsoDate | null> =
    first === undefined ? [] : Array.from({ length: weekdayIndex(first) }, () => null);
  cells.push(...dates);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<IsoDate | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The same day of the month before or after, clamped to that month's length (PageUp / PageDown). */
function sameDayOtherMonth(date: IsoDate, delta: -1 | 1): IsoDate {
  const own = monthDays(monthOf(date));
  const edge = delta === -1 ? own[0] : own[own.length - 1];
  const other = monthDays(monthOf(addDays(edge ?? date, delta)));
  const index = Math.min(own.indexOf(date), other.length - 1);
  return other[index] ?? date;
}

/** The date a navigation key moves focus to, or null for any other key (APG grid pattern). */
export function targetOf(date: IsoDate, key: string): IsoDate | null {
  const step = STEPS[key];
  if (step !== undefined) return addDays(date, step);
  if (key === 'Home') return addDays(date, -weekdayIndex(date));
  if (key === 'End') return addDays(date, 6 - weekdayIndex(date));
  if (key === 'PageUp') return sameDayOtherMonth(date, -1);
  if (key === 'PageDown') return sameDayOtherMonth(date, 1);
  return null;
}

/**
 * View B heatmap: one APG grid per month, roving tabindex; arrows move by a day or a week, Home and End to the ends of
 * the week, PageUp and PageDown by a month; Enter or Space opens the side panel (spec §11 View B, Accessibility).
 */
export function CalendarGrid({ days, model, months, destinationNotes, onOpen }: CalendarGridProps) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const shown = new Set(months);
  const [focusDate, setFocusDate] = useState<IsoDate | null>(null);
  const refs = useRef(new Map<IsoDate, HTMLTableCellElement>());
  // why: the tab stop is the focused day if it is still drawn, else the first drawn day.
  const firstShown = days.find((d) => shown.has(monthOf(d.date)))?.date ?? null;
  const tabStop =
    focusDate !== null && shown.has(monthOf(focusDate)) && byDate.has(focusDate) ? focusDate : firstShown;

  const open = (date: IsoDate) => {
    const disp = model.displays.get(date);
    onOpen(date, disp?.kind === 'price' ? disp.price.cell : null);
  };
  const onKeyDown = (date: IsoDate) => (e: KeyboardEvent<HTMLTableCellElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(date);
      return;
    }
    const next = targetOf(date, e.key);
    if (next === null) return;
    e.preventDefault();
    // why: focus moves only to a drawn day that has data; elsewhere it stays put.
    if (byDate.has(next) && shown.has(monthOf(next))) {
      setFocusDate(next);
      refs.current.get(next)?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {months.map((m) => (
        <table
          key={m}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the APG grid pattern on a month table (spec §11)
          role="grid"
          aria-label={formatIsoMonth(m)}
          className="w-full table-fixed border-separate border-spacing-1"
        >
          <caption className="text-left font-semibold">{formatIsoMonth(m)}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((w) => (
                <th key={w} scope="col" className="text-xs font-medium">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeksOf(m).map((week) => (
              <tr key={week.find((d) => d !== null) ?? m}>
                {week.map((date, i) => {
                  if (date === null) {
                    return (
                      <td
                        key={`pad-${m}-${i}`}
                        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a padding cell of the APG grid
                        role="gridcell"
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                    );
                  }
                  const gd = byDate.get(date);
                  if (gd === undefined) {
                    return (
                      <td
                        key={date}
                        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a day outside the data, still a cell of the APG grid
                        role="gridcell"
                        tabIndex={-1}
                        aria-disabled="true"
                        className="align-top text-xs text-slate-500"
                      >
                        {/* why: outside the window or the api's days: only the day number, never a price or a glyph */}
                        {formatDayOfMonth(date)}
                      </td>
                    );
                  }
                  const disp = model.displays.get(date);
                  if (disp === undefined) throw new Error(`calendar model has no display for ${date}`);
                  const band = model.bands.get(date);
                  const flat = model.flatDays.has(date);
                  const hatched = disp.kind === 'price' && disp.basis !== model.colourBasis;
                  const fill =
                    band !== undefined
                      ? BAND_CLASSES[band]
                      : flat
                        ? FLAT_CLASS
                        : hatched
                          ? 'day-hatched'
                          : PRICELESS_CLASS;
                  return (
                    <td
                      key={date}
                      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a day of the APG grid, focused by roving tabindex
                      role="gridcell"
                      data-date={date}
                      data-basis={disp.kind === 'price' ? disp.basis : 'none'}
                      data-band={band ?? (flat ? 'flat' : '')}
                      tabIndex={date === tabStop ? 0 : -1}
                      ref={(el) => {
                        if (el) refs.current.set(date, el);
                        else refs.current.delete(date);
                      }}
                      onKeyDown={onKeyDown(date)}
                      onFocus={() => setFocusDate(date)}
                      onClick={() => {
                        setFocusDate(date);
                        open(date);
                      }}
                      className={`cursor-pointer rounded p-1 text-left align-top ${FOCUS_RING} ${fill}`}
                    >
                      <span className="block text-xs font-semibold">
                        <span aria-hidden="true">{formatDayOfMonth(date)}</span>
                        <span className="sr-only">{formatDayLong(date)}</span>
                      </span>
                      <DayBody display={disp} slice={gd.slice} notes={destinationNotes} />
                      {band !== undefined ? (
                        <span className="sr-only">{COPY.calendarView.bandAria(band)}</span>
                      ) : null}
                      {flat ? <span className="sr-only">{COPY.calendarView.flatAria}</span> : null}
                      {hatched ? <span className="sr-only">{COPY.calendarView.hatchedAria}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function DayBody(props: { display: DayDisplay; slice: DaySlice; notes: Partial<Record<Iata, string>> }) {
  const { display, slice, notes } = props;
  if (display.kind === 'price') return <DayPriceBlock display={display} slice={slice} notes={notes} />;
  const C = COPY.calendarView;
  return (
    <div className="text-[11px]">
      <GlyphList glyphs={display.glyphs} />
      {display.reason === 'no-run' ? <p>{C.noRunCoversDay}</p> : null}
      {display.reason === 'no-provider' ? <p>{C.noDiscoveryProvider}</p> : null}
      {display.reason === 'filtered' && slice.destination !== null ? (
        <>
          <p>{C.noPriceForDestination(slice.destination)}</p>
          <p className="italic">{C.countsAllDestinations}</p>
        </>
      ) : null}
    </div>
  );
}

/**
 * The day's price in PriceCell's compact form (plan decisions 36 and 38): price, stale label, short provider badge,
 * compact age, dashed outline for calendar prices, the destination; then the stay, any cheaper cached fare, and the
 * coverage cue. Everything else is in the side panel. A price without provenance is withheld (spec §9 item 6).
 */
function DayPriceBlock(props: {
  display: Extract<DayDisplay, { kind: 'price' }>;
  slice: DaySlice;
  notes: Partial<Record<Iata, string>>;
}) {
  const { display, slice, notes } = props;
  const C = COPY.calendarView;
  const p = display.price;
  const isCalendar = display.basis === 'calendar';
  // why: a per-destination price has no cell; the filtered destination is its destination.
  const destination = p.cell?.destination ?? slice.destination ?? undefined;
  const note = destination === undefined ? null : (notes[destination] ?? null);
  const cached = display.cheaperCached;
  return (
    <div data-testid="day-price-block" className="flex flex-col gap-0.5 text-xs">
      <span className="sr-only">{isCalendar ? C.calendarPrice : COPY.classLabel.verified}</span>
      <PriceBoundary>
        <PriceCell
          compact
          pricePence={p.pricePence}
          provenance={p.provenance}
          calendar={isCalendar}
          stale={display.stale}
          truncated={p.truncated}
          destination={destination}
          destinationNote={note}
        />
      </PriceBoundary>
      <p data-testid="day-stay" className="text-[11px]">
        {p.cell === null ? C.stayInPanel : C.stay(p.cell.nights, formatIsoDateShort(p.cell.returnDate))}
      </p>
      {cached !== null ? (
        <div data-testid="cached-from" className="text-[11px]">
          <span>{C.cachedFrom}</span>
          <PriceBoundary>
            <PriceCell
              compact
              pricePence={cached.pricePence}
              provenance={cached.provenance}
              calendar
              stale={cached.stale}
              truncated={cached.truncated}
            />
          </PriceBoundary>
        </div>
      ) : null}
      <CoverageCue coverage={coverageOf(slice)} />
    </div>
  );
}

function GlyphList({ glyphs }: { glyphs: readonly GlyphStatus[] }) {
  if (glyphs.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {glyphs.map((g) => (
        <li key={g} data-glyph={g}>
          <span aria-hidden="true" className="font-bold">
            {COPY.calendarView.glyphSymbol[g]}
          </span>{' '}
          {COPY.bucket[g]}
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/src/views/Calendar/CalendarLegend.tsx`:

```tsx
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';
import type { CalendarModel } from './model.js';
import { BAND_CLASSES, FLAT_CLASS, MIN_BANDED_DAYS, PRICELESS_CLASS } from './scale.js';
import type { DayBasis, GlyphStatus } from './types.js';

const GLYPHS: readonly GlyphStatus[] = ['empty', 'no_data', 'error', 'skipped', 'not_run'];

/**
 * Numeric legend (spec §11 View B): the basis on the scale and how it is banded (or why it is flat), each band's pence
 * range and day count, the hatched days, the dashed outline, stale, the coverage cue, "cached from", "cheapest of the
 * rows read", every glyph, and the destination-filter caveat. Rendered above the grid so it is never far from it.
 */
export function CalendarLegend({ model, filtered }: { model: CalendarModel; filtered: boolean }) {
  const C = COPY.calendarView;
  const L = C.legend;
  const other: DayBasis = model.colourBasis === 'verified' ? 'calendar' : 'verified';
  const basis = COPY.basisName[model.colourBasis];
  const s = model.scale;
  const range =
    s.minPence !== null && s.maxPence !== null ? [formatPence(s.minPence), formatPence(s.maxPence)] : null;
  return (
    <section aria-label={L.title} data-testid="calendar-legend" className="flex flex-col gap-1 text-sm">
      <p>
        {s.mode === 'quintile'
          ? L.scaleQuintile(basis, s.count)
          : s.mode === 'flat-few'
            ? L.scaleFlatFew(basis, s.count, MIN_BANDED_DAYS)
            : s.mode === 'flat-narrow' && range !== null
              ? L.scaleFlatNarrow(basis, s.count, range[0] ?? '', range[1] ?? '')
              : L.scaleEmpty(basis)}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {s.legend.map((e) => (
          <li key={e.band}>
            <span
              aria-hidden="true"
              className={`mr-1 inline-block h-3 w-3 align-middle ${BAND_CLASSES[e.band]}`}
            />
            {L.band(e.band, formatPence(e.minPence), formatPence(e.maxPence), e.count)}
          </li>
        ))}
        {s.mode === 'flat-few' || s.mode === 'flat-narrow' ? (
          <li>
            <span aria-hidden="true" className={`mr-1 inline-block h-3 w-3 align-middle ${FLAT_CLASS}`} />
            {L.flatSwatch(s.count)}
          </li>
        ) : null}
        {model.hatchedDays > 0 ? (
          <li>
            <span aria-hidden="true" className="day-hatched mr-1 inline-block h-3 w-3 align-middle" />
            {L.hatched(other, model.hatchedDays)}
          </li>
        ) : null}
        <li>
          <span aria-hidden="true" className={`mr-1 inline-block h-3 w-3 align-middle ${PRICELESS_CLASS}`} />
          {L.priceless}
        </li>
      </ul>
      <ul className="flex flex-col gap-0.5">
        <li>{L.dashed}</li>
        <li>{L.stale}</li>
        <li>
          <span aria-hidden="true" className="cov-swatch cov-full mr-1 align-middle" />
          {L.coverageFull}
        </li>
        <li>
          <span aria-hidden="true" className="cov-swatch cov-partial mr-1 align-middle" />
          {L.coveragePartial}
        </li>
        <li>{L.cachedFrom}</li>
        <li>{L.truncated}</li>
        <li>{L.stay}</li>
        {filtered ? <li>{L.filtered}</li> : null}
      </ul>
      <p>{L.glyphs}</p>
      <ul className="flex flex-wrap gap-x-4">
        {GLYPHS.map((g) => (
          <li key={g}>
            <span aria-hidden="true">{C.glyphSymbol[g]}</span> {COPY.bucket[g]}
            {g === 'skipped' ? <span>{L.skippedWhy}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/grid.test.tsx test/copy`
Expected: PASS. The grid file passes 13 tests; the source guard passes.

Run: `pnpm lint`
Expected: no errors. The four `biome-ignore` comments on the grid's `role` attributes (table, padding cell, out-of-data day, day) are the only suppressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar grid with compact prices, coverage cue, flat and hatched scales, full legend, APG keys"
```

### Task 10.8: Side panel: the day, the cell's outcomes and prices, per-cell verify with its cost

**Files:**
- Create: `apps/web/src/views/Calendar/CellPanel.tsx`, `apps/web/test/views/calendar/panel.test.tsx`

**Interfaces:**
- Consumes: `useCellDetail`, WP9's `useExecutionActions().verify`, `ApiError`, `resultRowKey`, `hrefWith`/`navigateTo` and WP9's `?row=`, `PriceCell`, `PriceBoundary`, `DayMarker`, `cellKeyString`, `addDays`, `daysBetween`, the `format.ts` forms, `instantMs`.
- Produces: `cellsForDay`, `orderOutcomes`, `reasonText`, `noHeadroom`, `CellPanel({ definition, date, slice, executions, initialCell, onClose })`.

The panel opens on the day: its six-bucket marker per provider (with the partially-verified count) and its prices with full provenance, then the cell picker. The cell route returns outcomes from every run of the definition, so rows are ordered by the calendar response's run list (newest first), the latest run is marked, runs are named by start date, reasons are in words (spec §3's closed lists; an unknown reason is shown as it came), and the vendor detail (`lastError`) has its own column. Verify goes through WP9's single action, whose refresh now covers the WP10 queries; beside it, "uses up to N calls · SearchApi: M left this month" from the cell detail's `verify` (plan decision 38); a 409 `active` says a search is already running, a 409 `cap` names the cap with WP8's message, and with no calls left the button is disabled with the reason.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/panel.test.tsx`:

```tsx
import { asIsoDate, resultRowKey } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  CellPanel,
  cellsForDay,
  noHeadroom,
  orderOutcomes,
  reasonText,
} from '../../../src/views/Calendar/CellPanel.js';
import { API, definition, summary, verifiedRow } from '../../fixtures.js';
import {
  bare,
  cellAt,
  cellDetail,
  disc,
  hoursBefore,
  keyOf,
  outcome,
  priceAt,
  provCalendarAt,
  provItinerary,
  slice,
} from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const c = cellAt('2027-03-14', 14);
const date = asIsoDate('2027-03-14');
const earlier = {
  ...summary('completed', 170),
  id: 'exec-0000',
  startedAt: hoursBefore(172),
  finishedAt: hoursBefore(171),
};
const executions = [summary(), earlier];
const observation = verifiedRow({ cell: c, seller: 'Example Air', pricePence: 52000 });
const detail = cellDetail(c, {
  outcomes: [
    outcome(c, 'discovery', 'travelpayouts', 'priced', {
      executionId: 'exec-0000',
      fetchedAt: hoursBefore(171),
    }),
    outcome(c, 'discovery', 'travelpayouts', 'priced', { reusedFromExecutionId: 'exec-0000' }),
    outcome(c, 'verification', 'searchapi', 'skipped', { reason: 'budget' }),
  ],
  calendarPrices: [
    {
      ...bare(priceAt(41200, provCalendarAt(2), false, c, true)),
      executionId: 'exec-0000',
      calendarPriceId: 7,
    },
  ],
  observations: [observation],
});
const cellRoute = `${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`;
const daySlice = slice({
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8 })],
  verification: { selected: 10, itinerarySearched: 1, onDemand: 0 },
  cheapestCalendar: priceAt(41200, provCalendarAt(2), false, c),
});

function renderPanel(def = definition(), s = daySlice) {
  const onClose = vi.fn();
  const r = renderWithProviders(
    <CellPanel
      definition={def}
      date={date}
      slice={s}
      executions={executions}
      initialCell={c}
      onClose={onClose}
    />,
  );
  return { onClose, ...r };
}

describe('outcome order and reason words (prov-011, ui-r1-012)', () => {
  it('orders rows by the run list, newest first, then any other run, each by fetchedAt', () => {
    const child = outcome(c, 'verification', 'searchapi', 'priced', {
      executionId: 'child-1',
      fetchedAt: hoursBefore(1),
    });
    const [oldRun, reused, skipped] = detail.outcomes;
    if (oldRun === undefined || reused === undefined || skipped === undefined)
      throw new Error('fixture has three outcomes');
    const order = orderOutcomes([oldRun, child, skipped, reused], executions);
    expect(order.map((o) => `${o.executionId}:${o.stage}`)).toEqual([
      'exec-0001:discovery',
      'exec-0001:verification',
      'exec-0000:discovery',
      'child-1:verification',
    ]);
  });
  it('puts every reason in operator words; an unknown reason is shown as it came', () => {
    expect(reasonText('budget')).toBe('stopped: a budget cap was reached');
    expect(reasonText('not_selected')).toBe('not selected for itinerary search');
    expect(reasonText('offers-dropped:3')).toBe('3 offers could not be read and were dropped');
    expect(reasonText('something-new')).toBe('other: something-new');
    expect(reasonText(null)).toBe('—');
  });
  it('no headroom: a zero cap, or every provider out of calls this month', () => {
    expect(noHeadroom(null)).toBe(false);
    expect(noHeadroom({ maxCalls: 0, providers: [] })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, providers: [{ providerId: 'searchapi', monthCallsLeft: 0 }] })).toBe(
      true,
    );
    expect(noHeadroom({ maxCalls: 6, providers: [{ providerId: 'searchapi', monthCallsLeft: null }] })).toBe(
      false,
    );
  });
});

describe('View B side panel (spec §11, §10 cells route; plan decision 38)', () => {
  it('shows the day’s six-bucket marker and its prices with full provenance', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole } = renderPanel();
    const day = await findByRole('region', { name: 'This day' });
    expect(within(day).getByTestId('day-marker')).toHaveTextContent(
      '40 priced · 0 no fares · 8 no cached data',
    );
    expect(day).toHaveTextContent('cheapest calendar price');
    expect(day).toHaveTextContent('14 nights · back Sun 28 Mar');
    expect(within(day).getByTestId('provenance')).toHaveTextContent('Aviasales cache');
    expect(within(day).getByTestId('provenance')).toHaveTextContent('constraints not checked');
  });

  it('lists the cell outcomes newest run first, marks the latest run, words the reason and labels reuse by date', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole } = renderPanel();
    const table = await findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.getAttribute('data-current'))).toEqual(['true', 'true', 'false']);
    expect(rows[0]).toHaveTextContent(
      /run 14 Oct 2026.*latest run.*discovery.*Travelpayouts.*priced.*reused from run 7 Oct 2026/,
    );
    expect(rows[1]).toHaveTextContent(
      /itinerary search.*SearchApi.*skipped.*stopped: a budget cap was reached/,
    );
    expect(rows[2]).toHaveTextContent(/run 7 Oct 2026.*discovery/);
  });

  it('shows every cell price with provenance and the rows-read note; an offer links to its Results row', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByText, getByRole } = renderPanel(definition(), slice({}));
    await findByText('£412');
    const dialog = getByRole('dialog');
    const provs = within(dialog).getAllByTestId('provenance');
    expect(provs).toHaveLength(2);
    expect(provs[0]).toHaveClass('border-dashed');
    expect(dialog).toHaveTextContent('calendar price · run 7 Oct 2026');
    expect(dialog).toHaveTextContent('cheapest of the rows read');
    expect(dialog).toHaveTextContent('itinerary offer · Example Air · verified');
    const link = within(dialog).getByRole('link', { name: 'show in results' }).getAttribute('href') ?? '';
    expect(new URLSearchParams(link.split('?')[1]).get('row')).toBe(resultRowKey(observation));
    expect(new URLSearchParams(link.split('?')[1]).get('view')).toBe('results');
  });

  it('a cell price lacking provenance fails to render: the contract parse refuses the response, no amount appears', async () => {
    const [first] = detail.calendarPrices;
    if (first === undefined) throw new Error('fixture has a calendar price');
    const { provenance: _dropped, ...rest } = first;
    server.use(
      http.get(cellRoute, () => HttpResponse.json({ ...detail, calendarPrices: [rest], observations: [] })),
    );
    const { findByRole, getByRole } = renderPanel(definition(), slice({}));
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(getByRole('dialog')).not.toHaveTextContent('£');
  });

  it('hides the verify action when the definition has no verification provider', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json({ ...detail, verify: null })));
    const def = definition({
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
    });
    const { findByRole, queryByRole } = renderPanel(def);
    await findByRole('table');
    expect(queryByRole('button', { name: 'Search this cell for itineraries' })).toBeNull();
  });

  it('verify shows what it may spend, posts through WP9’s action, and names a running search or a budget cap', async () => {
    let posted: unknown = null;
    server.use(
      http.get(cellRoute, () => HttpResponse.json(detail)),
      http.post(`${API}/cells/verify`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ executionId: 'child-1' });
      }),
    );
    const { findByTestId, findByText, getByRole, user } = renderPanel();
    expect(await findByTestId('verify-cost')).toHaveTextContent(
      'uses up to 6 calls · SearchApi: 9385 left this month',
    );
    await user.click(getByRole('button', { name: 'Search this cell for itineraries' }));
    expect(await findByText('Itinerary search started for this cell.')).toBeInTheDocument();
    expect(posted).toEqual({ definitionId: 'def-0001', cell: keyOf(c) });

    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'active', message: 'child active' } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: 'Search this cell for itineraries' }));
    expect(await findByText('An itinerary search for this cell is already running.')).toBeInTheDocument();

    const capMessage = 'budget cap: provider-month:searchapi 10000 of 10000 calls';
    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'cap', message: capMessage } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: 'Search this cell for itineraries' }));
    expect(await findByText(`Refused by a budget cap: ${capMessage}`)).toBeInTheDocument();
  });

  it('with no calls left this month the button is disabled and says why', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({
          ...detail,
          verify: { maxCalls: 6, providers: [{ providerId: 'searchapi', monthCallsLeft: 0 }] },
        }),
      ),
    );
    const { findByText, getByRole } = renderPanel();
    expect(await findByText('No calls left for this search this month.')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Search this cell for itineraries' })).toBeDisabled();
  });

  it('the cell picker lists origins × destinations × nights for the day and fetches the chosen cell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(cellRoute, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(detail);
      }),
    );
    expect(cellsForDay(definition(), date)).toHaveLength(2 * 2 * 12);
    const { findByLabelText, getByRole, user } = renderPanel();
    const picker = await findByLabelText('Cell');
    const target = cellsForDay(definition(), date).findIndex(
      (k) => k.origin === 'LGW' && k.destination === 'EWR' && k.returnDate === '2027-04-04',
    );
    await user.selectOptions(picker, String(target));
    await waitFor(() =>
      expect(paths.at(-1)).toMatch(/\/api\/definitions\/def-0001\/cells\/LGW\/EWR\/2027-03-14\/2027-04-04$/),
    );
    expect(getByRole('option', { name: 'LGW→EWR · 21 nights · back Sun 4 Apr' })).toBeInTheDocument();
  });

  it('focuses its heading on open and closes on Escape', async () => {
    const { getByRole, onClose, user } = renderPanel(
      definition(),
      slice({ cheapestVerified: priceAt(52000, provItinerary(5), false, c) }),
    );
    expect(getByRole('heading', { name: 'Departing Sun 14 Mar 2027' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/panel.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CellPanel.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/CellPanel.tsx`:

```tsx
import { addDays, type CellKey, cellKeyString, daysBetween, type IsoDate, resultRowKey } from '@gmt/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useCellDetail, useExecutionActions } from '../../api/queries.js';
import type { CellDetailResponse, DefinitionResponse, ExecutionSummary } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayLong, formatDayShort, formatInstantDateLondon, formatInstantLondon } from '../../format.js';
import { instantMs } from '../../lib/time.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { DayMarker } from './DayMarker.js';
import type { DayPrice, DaySlice } from './types.js';

const P = COPY.calendarView.panel;
type Outcome = CellDetailResponse['outcomes'][number];

/** Every cell departing on `date`: origins × destinations × nights, in generation order (spec §6.1). */
export function cellsForDay(
  def: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>,
  date: IsoDate,
): CellKey[] {
  const out: CellKey[] = [];
  for (const origin of def.origins)
    for (const destination of def.destinations)
      for (let n = def.minNights; n <= def.maxNights; n += 1)
        out.push({ origin, destination, departureDate: date, returnDate: addDays(date, n) });
  return out;
}

/**
 * Outcomes newest run first (prov-011): rows of runs the calendar response lists come in its newest-first order, then
 * any other run (an on-demand child), each group by fetchedAt descending. Pure, so the order is unit-tested.
 */
export function orderOutcomes(
  outcomes: readonly Outcome[],
  executions: readonly ExecutionSummary[],
): Outcome[] {
  const rank = (o: Outcome) => {
    const i = executions.findIndex((e) => e.id === o.executionId);
    return i === -1 ? executions.length : i;
  };
  const fetched = (o: Outcome) => (o.fetchedAt === null ? 0 : instantMs(o.fetchedAt));
  return [...outcomes].sort((a, b) => rank(a) - rank(b) || fetched(b) - fetched(a));
}

/** An outcome reason in operator words (spec §3 reason lists); an unknown reason is shown as it came. */
export function reasonText(reason: string | null): string {
  if (reason === null) return P.dash;
  const dropped = /^offers-dropped:(\d+)$/.exec(reason);
  if (dropped?.[1] !== undefined) return P.offersDropped(Number(dropped[1]));
  const known = Object.entries(P.reasons).find(([k]) => k === reason);
  return known === undefined ? P.reasonRaw(reason) : known[1];
}

/** "run 14 Mar 2027" for a run the response lists, else the run id's head. */
function runLabel(executionId: string, executions: readonly ExecutionSummary[]): string {
  const started = executions.find((e) => e.id === executionId)?.startedAt ?? null;
  return P.run(started === null ? executionId.slice(0, 8) : formatInstantDateLondon(instantMs(started)));
}

// why: a day price's cell carries `nights`; the verify request and the picker take the four-field key only.
const toKey = (c: CellKey): CellKey => ({
  origin: c.origin,
  destination: c.destination,
  departureDate: c.departureDate,
  returnDate: c.returnDate,
});

export interface CellPanelProps {
  definition: DefinitionResponse;
  date: IsoDate;
  /** The day as the grid shows it: its six-bucket marker and its prices with full provenance live here. */
  slice: DaySlice;
  /** The calendar response's executions, newest first: they order and label the outcome rows. */
  executions: readonly ExecutionSummary[];
  initialCell: CellKey | null;
  onClose(): void;
}

/**
 * View B side panel (spec §11, plan decision 38): the day's six-bucket marker and its prices with full provenance; a
 * cell picker; that cell's outcomes per run, stage and provider, newest first; its prices; and the per-cell verify
 * action with what it may spend. Verify is hidden without a verification provider (spec §8.1).
 */
export function CellPanel({ definition, date, slice, executions, initialCell, onClose }: CellPanelProps) {
  const cells = useMemo(() => cellsForDay(definition, date), [definition, date]);
  const [selected, setSelected] = useState<CellKey | null>(
    initialCell === null ? (cells[0] ?? null) : toKey(initialCell),
  );
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const detail = useCellDetail(definition.id, selected);
  const verify = useExecutionActions().verify;
  const canVerify = definition.providers.verification.length > 0;
  const key = selected === null ? '' : cellKeyString(selected);
  const selectedIndex = cells.findIndex((c) => cellKeyString(c) === key);
  const notes = definition.destinationNotes;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      className="fixed inset-y-0 right-0 z-10 w-full max-w-lg overflow-y-auto border-l bg-white p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {P.title(formatDayLong(date))}
        </h2>
        <button type="button" onClick={onClose} className="rounded border px-2">
          {P.close}
        </button>
      </div>
      <section aria-label={P.dayHeading} className="mt-3 flex flex-col gap-2">
        <h3 className="font-medium">{P.dayHeading}</h3>
        <DayMarker slice={slice} />
        <DayPrices slice={slice} notes={notes} />
      </section>
      <label className="mt-3 flex flex-col text-sm">
        {P.cellPicker}
        <select
          value={selectedIndex >= 0 ? String(selectedIndex) : ''}
          onChange={(e) => setSelected(cells[Number(e.target.value)] ?? null)}
          className="rounded border px-2 py-1"
        >
          {cells.map((c, i) => (
            <option key={cellKeyString(c)} value={String(i)}>
              {P.cellOption(
                c.origin,
                c.destination,
                daysBetween(c.departureDate, c.returnDate),
                formatDayShort(c.returnDate),
              )}
            </option>
          ))}
        </select>
      </label>
      {selected !== null && detail.isPending ? <p role="status">{COPY.loading}</p> : null}
      {detail.isError ? <p role="alert">{COPY.loadFailed(detail.error.message)}</p> : null}
      {detail.data !== undefined ? (
        <CellDetailBody
          detail={detail.data}
          executions={executions}
          note={notes[detail.data.cell.destination] ?? null}
        />
      ) : null}
      {canVerify && selected !== null ? (
        <div className="mt-4 flex flex-col gap-1">
          <VerifyCost verify={detail.data?.verify ?? null} />
          <button
            type="button"
            disabled={verify.isPending || noHeadroom(detail.data?.verify ?? null)}
            onClick={() => verify.mutate({ definitionId: definition.id, cell: selected })}
            className="self-start rounded bg-slate-900 px-3 py-1 text-white disabled:bg-slate-400"
          >
            {COPY.verifyCell}
          </button>
          {verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
          {verify.isError ? <p role="alert">{verifyError(verify.error)}</p> : null}
        </div>
      ) : null}
    </aside>
  );
}

type VerifyInfo = CellDetailResponse['verify'];

/** True when the child could make no call: a zero cap, or no verification provider has calls left this month. */
export function noHeadroom(v: VerifyInfo): boolean {
  if (v === null) return false;
  return v.maxCalls === 0 || v.providers.every((p) => p.monthCallsLeft === 0);
}

/** "uses up to N calls · SearchApi: M left this month" beside the button (plan decision 38, spec §8.1 child cap). */
function VerifyCost({ verify }: { verify: VerifyInfo }) {
  if (verify === null) return null;
  const left = verify.providers.map((p) =>
    p.monthCallsLeft === null
      ? P.noMonthCap(COPY.provider[p.providerId])
      : P.monthLeft(COPY.provider[p.providerId], p.monthCallsLeft),
  );
  return (
    <p data-testid="verify-cost" className="text-xs">
      {P.verifyCost(verify.maxCalls, left.join(' · '))}
      {noHeadroom(verify) ? <span className="block font-medium">{P.verifyNoHeadroom}</span> : null}
    </p>
  );
}

/** A refusal in words: a running child, a named budget cap (409 `cap`, WP8 passes the engine's message), or else. */
function verifyError(error: Error): string {
  if (error instanceof ApiError && error.status === 409) {
    return error.code === 'cap' ? P.verifyCapRefused(error.message) : P.verifyConflict;
  }
  return COPY.actionFailed(error.message);
}

/** The day's own prices with full provenance (the day cell shows them compact). */
function DayPrices({ slice, notes }: { slice: DaySlice; notes: Partial<Record<string, string>> }) {
  const rows: Array<{ key: string; label: string; price: DayPrice; calendar: boolean }> = [];
  if (slice.cheapestVerified !== null)
    rows.push({ key: 'v', label: P.dayVerified, price: slice.cheapestVerified, calendar: false });
  if (slice.cheapestPartiallyVerified !== null)
    rows.push({
      key: 'pv',
      label: P.dayPartlyVerified,
      price: slice.cheapestPartiallyVerified,
      calendar: false,
    });
  if (slice.cheapestCalendar !== null)
    rows.push({ key: 'c', label: P.dayCalendar, price: slice.cheapestCalendar, calendar: true });
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const destination = r.price.cell?.destination ?? slice.destination ?? undefined;
        return (
          <li key={r.key}>
            <span className="text-xs">{r.label}</span>
            {r.price.cell !== null ? (
              <span className="block text-xs">
                {P.dayCell(r.price.cell.nights, formatDayShort(r.price.cell.returnDate))}
              </span>
            ) : null}
            <PriceBoundary>
              <PriceCell
                pricePence={r.price.pricePence}
                provenance={r.price.provenance}
                calendar={r.calendar}
                stale={r.price.stale}
                truncated={r.price.truncated}
                destination={destination}
                destinationNote={destination === undefined ? null : (notes[destination] ?? null)}
              />
            </PriceBoundary>
          </li>
        );
      })}
    </ul>
  );
}

// Observations are ResultRows; their searchLink may be null (synthetic rows, plan decision 15). The panel never renders it.
function CellDetailBody(props: {
  detail: CellDetailResponse;
  executions: readonly ExecutionSummary[];
  note: string | null;
}) {
  const { detail, executions, note } = props;
  const latest = executions[0]?.id ?? null;
  const empty = detail.calendarPrices.length + detail.observations.length === 0;
  return (
    <>
      <h3 className="mt-4 font-medium">{P.outcomes}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {(
                [
                  'run',
                  'stage',
                  'provider',
                  'status',
                  'reason',
                  'attempts',
                  'fetched',
                  'detail',
                  'reused',
                ] as const
              ).map((k) => (
                <th key={k} scope="col" className="text-left">
                  {P.columns[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderOutcomes(detail.outcomes, executions).map((o) => (
              <tr
                key={`${o.executionId}|${o.stage}|${o.providerId}`}
                data-current={o.executionId === latest ? 'true' : 'false'}
              >
                <td>
                  {runLabel(o.executionId, executions)}
                  {o.executionId === latest ? <span className="block font-medium">{P.latestRun}</span> : null}
                </td>
                <td>{COPY.stageName[o.stage]}</td>
                <td>{COPY.provider[o.providerId]}</td>
                <td>{COPY.bucket[o.status]}</td>
                <td>{reasonText(o.reason)}</td>
                <td>{o.attempts}</td>
                <td>{o.fetchedAt === null ? P.dash : formatInstantLondon(instantMs(o.fetchedAt))}</td>
                <td>{o.lastError ?? P.dash}</td>
                <td>
                  {o.reusedFromExecutionId === null
                    ? P.dash
                    : P.reusedFrom(runLabel(o.reusedFromExecutionId, executions))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mt-4 font-medium">{P.prices}</h3>
      {empty ? (
        <p>{P.noPrices}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.calendarPrices.map((p) => (
            <li key={`cal-${p.calendarPriceId}`}>
              <span className="text-xs">{P.calendarPriceRun(runLabel(p.executionId, executions))}</span>
              <PriceBoundary>
                <PriceCell
                  pricePence={p.pricePence}
                  provenance={p.provenance}
                  calendar
                  stale={p.stale}
                  truncated={p.truncated}
                  destination={detail.cell.destination}
                  destinationNote={note}
                />
              </PriceBoundary>
            </li>
          ))}
          {detail.observations.map((o) => (
            <li key={`obs-${o.observationId ?? o.itineraryHash}-${o.seller ?? ''}`}>
              <span className="text-xs">
                {P.observation(o.seller ?? COPY.none, COPY.classLabel[o.verdictClass])}
              </span>{' '}
              {/* why: WP9 owns ?row=<resultRowKey>, which selects and scrolls to that results row (plan decision 14) */}
              <a
                href={hrefWith({ view: 'results', row: resultRowKey(o) })}
                onClick={navigateTo({ view: 'results', row: resultRowKey(o) })}
                className="text-xs underline"
              >
                {P.showInResults}
              </a>
              <PriceBoundary>
                <PriceCell
                  pricePence={o.pricePence}
                  provenance={o.provenance}
                  calendar={o.basis === 'calendar'}
                  stale={o.stale}
                  destination={o.cell.destination}
                  destinationNote={note}
                />
              </PriceBoundary>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/panel.test.tsx test/copy`
Expected: PASS. The panel file passes 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: side panel with the day, ordered outcomes, provenance-checked prices and costed per-cell verify"
```

### Task 10.9: Calendar view (data, URL state, basis, phone width, states)

**Files:**
- Create: `apps/web/src/views/Calendar/CalendarView.tsx`, `apps/web/test/views/calendar/view.test.tsx`

**Interfaces:**
- Consumes: `useCalendar`, `whileRunning`, `ViewHeader` (executions variant), `useNow`, `useMediaQuery`/`NARROW_QUERY`, `useSearchParams`/`updateSearchParams`, `CalendarGrid`, `CalendarLegend`, `CellPanel`, `buildCalendarModel`, `defaultColourBasis`, `sliceForDestination`, `totalReused`, `ReusedNote`, `formatDuration`.
- Produces: `CALENDAR_PARAMS`, `parseDestination`, `parseBasis`, `CalendarView({ definition })`.

The destination filter (`cal.dest`), the chosen basis (`cal.basis`) and the phone-width month (`cal.month`) live in the URL like WP9's Results state, so they survive navigation and links. The default basis is judged over all destinations, so a filter change never flips what the colours mean. Below the header, "N of M shown prices are stale" names the itinerary threshold from the response; the header's stale flag is set only when every shown price is stale. The query refetches every 2 s while the newest run is pending or running.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/view.test.tsx`:

```tsx
import { asIata } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { whileRunning } from '../../../src/api/queries.js';
import type { CalendarDay } from '../../../src/api/types.js';
import { CalendarView } from '../../../src/views/Calendar/CalendarView.js';
import { API, definition, summary } from '../../fixtures.js';
import {
  bare,
  calendarResponse,
  cellAt,
  day,
  disc,
  priceAt,
  provCalendarAt,
  provItinerary,
} from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';

const route = `${API}/definitions/:id/calendar`;
const jfk = priceAt(41200, provCalendarAt(2), false, cellAt('2027-03-14', 14, 'LHR', 'JFK'));
const ewr = priceAt(39900, provCalendarAt(2), false, cellAt('2027-03-14', 14, 'LHR', 'EWR'));
const mixedDay = day('2027-03-14', {
  cheapestCalendar: ewr,
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8, reused: 3 })],
  byDestination: [
    { destination: asIata('JFK'), cheapestVerified: null, cheapestCalendar: bare(jfk) },
    { destination: asIata('EWR'), cheapestVerified: null, cheapestCalendar: bare(ewr) },
  ],
});
// why: WP8 lists every destination in byDestination; an entry with null prices is "no price for that destination".
const ewrOnlyDay = day('2027-03-15', {
  cheapestCalendar: priceAt(45000, provCalendarAt(2), false, cellAt('2027-03-15', 14, 'LHR', 'EWR')),
  discovery: [disc('travelpayouts', { priced: 20, not_run: 28 })],
  byDestination: [
    { destination: asIata('JFK'), cheapestVerified: null, cheapestCalendar: null },
    { destination: asIata('EWR'), cheapestVerified: null, cheapestCalendar: bare(ewr) },
  ],
});
const verifiedDay = (d: string, stale = false) =>
  day(d, {
    cheapestVerified: priceAt(50000, provItinerary(5), stale, cellAt(d, 14)),
    discovery: [disc('searchapi', { priced: 48 })],
  });
const calendarDay = (d: string, stale = false) =>
  day(d, {
    cheapestCalendar: priceAt(40000, provCalendarAt(5), stale, cellAt(d, 14)),
    discovery: [disc('travelpayouts', { priced: 48 })],
  });
const serve = (days: CalendarDay[]) =>
  server.use(http.get(route, () => HttpResponse.json(calendarResponse(days))));
const at = (d: string): HTMLElement => {
  const el = document.querySelector(`[data-date="${d}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no day ${d}`);
  return el;
};
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

describe('Calendar view (spec §11 View B; plan decision 38)', () => {
  it('shows an explicit loading state, then the grid', async () => {
    server.use(
      http.get(route, async () => {
        await delay(30);
        return HttpResponse.json(calendarResponse([mixedDay]));
      }),
    );
    const { getByRole, findByRole } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(getByRole('status')).toHaveTextContent('Loading…');
    expect(await findByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
  });

  it('shows an error state naming the failure', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    const { findByRole } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByRole('alert')).toHaveTextContent('Could not load: boom');
  });

  it('shows the empty state when there are no days', async () => {
    serve([]);
    const { findByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(
      await findByText('No days to show yet. The calendar fills in as cells are searched.'),
    ).toBeInTheDocument();
  });

  it('the header names the run and carries the reused count', async () => {
    serve([mixedDay]);
    const { findByText, getByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByText('(3 reused from earlier runs)')).toBeInTheDocument();
    expect(getByText('showing run exec-000 (completed, 2h ago)')).toBeInTheDocument();
  });

  it('says how many shown prices are stale; the header stale flag only when every one is', async () => {
    serve([calendarDay('2027-03-01', true), calendarDay('2027-03-02')]);
    const first = renderWithProviders(<CalendarView definition={definition()} />);
    expect(
      await first.findByText(/^1 of 2 shown prices are stale \(itinerary prices after 8d;/),
    ).toBeInTheDocument();
    expect(first.queryByText('Every row here is older than one refresh cycle.')).toBeNull();
    first.unmount();
    serve([calendarDay('2027-03-01', true)]);
    const second = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await second.findByText('Every row here is older than one refresh cycle.')).toBeInTheDocument();
  });

  it('the destination filter lives in the URL; filtered days take that destination’s prices and claim no coverage', async () => {
    serve([mixedDay, ewrOnlyDay]);
    const { findByRole, getByLabelText, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await findByRole('grid', { name: 'March 2027' });
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£399');
    await user.selectOptions(getByLabelText('Destination'), 'JFK');
    expect(param('cal.dest')).toBe('JFK');
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£412');
    expect(within(at('2027-03-14')).getByTestId('day-stay')).toHaveTextContent('stay: see panel');
    expect(within(at('2027-03-14')).getByTestId('coverage-cue')).toHaveTextContent(
      'coverage counts cover all destinations',
    );
    expect(at('2027-03-15')).toHaveTextContent('no JFK price');
    expect(at('2027-03-15').querySelectorAll('[data-glyph]')).toHaveLength(0);
    await user.selectOptions(getByLabelText('Destination'), 'all');
    expect(param('cal.dest')).toBeNull();
  });

  it('defaults to the calendar basis when verified days are not a majority, and to verified when they are', async () => {
    serve([verifiedDay('2027-03-01'), calendarDay('2027-03-02'), calendarDay('2027-03-03')]);
    const first = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await first.findByRole('radio', { name: 'calendar basis' })).toBeChecked();
    first.unmount();
    serve([verifiedDay('2027-03-01'), verifiedDay('2027-03-02'), calendarDay('2027-03-03')]);
    const second = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await second.findByRole('radio', { name: 'itinerary-search basis' })).toBeChecked();
  });

  it('the operator’s basis overrides the default, persists in the URL, and survives a filter change', async () => {
    serve([verifiedDay('2027-03-01'), calendarDay('2027-03-02'), calendarDay('2027-03-03')]);
    const { findByRole, getByLabelText, getByRole, getByTestId, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await user.click(await findByRole('radio', { name: 'itinerary-search basis' }));
    expect(param('cal.basis')).toBe('verified');
    expect(getByTestId('calendar-legend')).toHaveTextContent(
      'Colour: one shade for itinerary-search basis prices on 1 day',
    );
    await user.selectOptions(getByLabelText('Destination'), 'JFK');
    expect(getByRole('radio', { name: 'itinerary-search basis' })).toBeChecked();
  });

  it('without a verification provider: calendar basis, the other disabled, and the day says itinerary search is not configured', async () => {
    serve([mixedDay]);
    const def = definition({
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
    });
    const { findByRole, getByRole, user } = renderWithProviders(<CalendarView definition={def} />);
    expect(await findByRole('radio', { name: 'calendar basis' })).toBeChecked();
    expect(getByRole('radio', { name: 'itinerary-search basis' })).toBeDisabled();
    at('2027-03-14').focus();
    await user.keyboard('{Enter}');
    expect(await findByRole('dialog')).toHaveTextContent(
      'itinerary search: no verification provider configured',
    );
  });

  it('at phone width shows one month at a time, with month navigation in the URL (plan decision 38)', async () => {
    setViewportWidth(375);
    serve([calendarDay('2027-03-30'), calendarDay('2027-04-02')]);
    const { findByRole, getAllByRole, getByRole, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await findByRole('grid', { name: 'March 2027' });
    expect(getAllByRole('grid')).toHaveLength(1);
    expect(getByRole('button', { name: 'Previous month' })).toBeDisabled();
    await user.click(getByRole('button', { name: 'Next month' }));
    expect(param('cal.month')).toBe('2027-04');
    expect(getByRole('grid', { name: 'April 2027' })).toBeInTheDocument();
    expect(getAllByRole('grid')).toHaveLength(1);
  });

  it('Enter opens the side panel for the day; Escape closes it and focus returns to the day', async () => {
    serve([mixedDay]);
    const { findByRole, queryByRole, user } = renderWithProviders(<CalendarView definition={definition()} />);
    await findByRole('grid', { name: 'March 2027' });
    // why: focus the day directly; tabbing would first reach the filter controls above the grid.
    at('2027-03-14').focus();
    await user.keyboard('{Enter}');
    expect(await findByRole('dialog', { name: 'Departing Sun 14 Mar 2027' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(at('2027-03-14')).toHaveFocus();
  });

  it('refetches every 2 s while the newest run is pending or running, and stops after (po-wp10-006)', () => {
    expect(whileRunning({ executions: [summary('running')] })).toBe(2_000);
    expect(whileRunning({ executions: [summary('pending')] })).toBe(2_000);
    expect(whileRunning({ executions: [summary('completed')] })).toBe(false);
    expect(whileRunning({ executions: [] })).toBe(false);
    expect(whileRunning(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/view.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CalendarView.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/CalendarView.tsx`:

```tsx
import { type CellKey, formatDuration, type Iata, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { useMemo, useState } from 'react';
import { useCalendar } from '../../api/queries.js';
import type { CalendarDay, DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatIsoMonth } from '../../format.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useNow } from '../../now.js';
import { updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { CalendarGrid } from './CalendarGrid.js';
import { CalendarLegend } from './CalendarLegend.js';
import { CellPanel } from './CellPanel.js';
import { ReusedNote } from './DayMarker.js';
import { defaultColourBasis } from './display.js';
import { type SliceOptions, sliceForDestination, totalReused } from './marker.js';
import { buildCalendarModel } from './model.js';
import type { DayBasis, GridDay } from './types.js';

/** URL keys of the view's state (ui-r1-016: filters survive navigation and links, like WP9's Results state). */
export const CALENDAR_PARAMS = { destination: 'cal.dest', basis: 'cal.basis', month: 'cal.month' } as const;

/** The destination filter from the URL: one of the definition's destinations, else all. */
export function parseDestination(raw: string | null, destinations: readonly Iata[]): Iata | 'all' {
  return destinations.find((d) => d === raw) ?? 'all';
}

/** The operator's chosen colour basis from the URL, or null for the default. */
export function parseBasis(raw: string | null): DayBasis | null {
  return raw === 'verified' || raw === 'calendar' ? raw : null;
}

function gridDays(days: readonly CalendarDay[], destination: Iata | 'all', o: SliceOptions): GridDay[] {
  return days.map((d) => ({ date: d.date, slice: sliceForDestination(d, destination, o) }));
}

/** View B: the calendar heatmap for one definition (spec §11 View B, §10 calendar route; plan decision 38). */
export function CalendarView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const q = useCalendar(definition.id);
  const params = useSearchParams();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [open, setOpen] = useState<{ date: IsoDate; cell: CellKey | null } | null>(null);
  const destination = parseDestination(params.get(CALENDAR_PARAMS.destination), definition.destinations);
  const hasVerification = definition.providers.verification.length > 0;
  const discoveryConfigured = definition.providers.discovery.length > 0;
  const raw = q.data?.days;

  const allDays = useMemo(
    () => gridDays(raw ?? [], 'all', { verificationConfigured: hasVerification, discoveryConfigured }),
    [raw, hasVerification, discoveryConfigured],
  );
  const days = useMemo(
    () => gridDays(raw ?? [], destination, { verificationConfigured: hasVerification, discoveryConfigured }),
    [raw, destination, hasVerification, discoveryConfigured],
  );
  const chosen = parseBasis(params.get(CALENDAR_PARAMS.basis));
  // why: plan decision 38 — the default is judged over all destinations, so a filter change never flips the colouring.
  const colourBasis: DayBasis =
    chosen === 'calendar' || (chosen === 'verified' && hasVerification)
      ? chosen
      : defaultColourBasis(allDays, hasVerification, now);
  const model = useMemo(() => buildCalendarModel(days, colourBasis, now), [days, colourBasis, now]);
  const months = useMemo(() => [...new Set(days.map((d) => monthOf(d.date)))], [days]);

  if (q.isPending) return <p role="status">{COPY.loading}</p>;
  if (q.isError) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;

  const C = COPY.calendarView;
  const wanted = months.find((m) => m === params.get(CALENDAR_PARAMS.month)) ?? months[0];
  // why: plan decision 38 — at phone width one month at a time as a compact grid, never every day stacked.
  const drawn: IsoMonth[] = narrow ? (wanted === undefined ? [] : [wanted]) : months;
  const at = wanted === undefined ? -1 : months.indexOf(wanted);
  const openSlice = open === null ? undefined : days.find((d) => d.date === open.date)?.slice;
  const closePanel = () => {
    const date = open?.date;
    setOpen(null);
    if (date !== undefined) document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  };
  const setParam = (key: string, value: string | null) => updateSearchParams({ [key]: value }, 'replace');

  return (
    <section aria-label={C.title} className="flex flex-col gap-4">
      <ViewHeader
        title={C.title}
        executions={q.data.executions}
        stale={model.shownPrices > 0 && model.stalePrices === model.shownPrices}
      />
      {model.stalePrices > 0 ? (
        <p className="text-sm">
          {C.staleLine(model.stalePrices, model.shownPrices, formatDuration(q.data.staleAfterHours))}
        </p>
      ) : null}
      <ReusedNote count={totalReused(days.map((d) => d.slice))} />
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm">
          {C.destinationFilter}
          <select
            value={destination}
            onChange={(e) =>
              setParam(CALENDAR_PARAMS.destination, e.target.value === 'all' ? null : e.target.value)
            }
            className="rounded border px-2 py-1"
          >
            <option value="all">{C.allDestinations}</option>
            {definition.destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend>{C.colourBy}</legend>
          {(['verified', 'calendar'] as const).map((b) => (
            <label key={b} className="mr-3">
              <input
                type="radio"
                name="colour-basis"
                value={b}
                checked={colourBasis === b}
                disabled={b === 'verified' && !hasVerification}
                onChange={() => setParam(CALENDAR_PARAMS.basis, b)}
              />{' '}
              {COPY.basisName[b]}
            </label>
          ))}
        </fieldset>
      </div>
      {days.length === 0 ? (
        <p>{C.empty}</p>
      ) : (
        <>
          <CalendarLegend model={model} filtered={destination !== 'all'} />
          {narrow && wanted !== undefined ? (
            <nav aria-label={C.monthNav} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={at <= 0}
                onClick={() => setParam(CALENDAR_PARAMS.month, months[at - 1] ?? null)}
                className="rounded border px-2 disabled:opacity-50"
              >
                {C.previousMonth}
              </button>
              <span>{formatIsoMonth(wanted)}</span>
              <button
                type="button"
                disabled={at >= months.length - 1}
                onClick={() => setParam(CALENDAR_PARAMS.month, months[at + 1] ?? null)}
                className="rounded border px-2 disabled:opacity-50"
              >
                {C.nextMonth}
              </button>
            </nav>
          ) : null}
          <CalendarGrid
            days={days}
            model={model}
            months={drawn}
            destinationNotes={definition.destinationNotes}
            onOpen={(date, cell) => setOpen({ date, cell })}
          />
        </>
      )}
      {open !== null && openSlice !== undefined ? (
        <CellPanel
          definition={definition}
          date={open.date}
          slice={openSlice}
          executions={q.data.executions}
          initialCell={open.cell}
          onClose={closePanel}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar test/copy`
Expected: PASS. The calendar files pass 70 tests (marker 9, display 15, scale 9, grid 13, panel 12, view 12).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar view with URL state, stable default basis, stale line, phone month grid, polling"
```

### Task 10.10: TZ suite, chart setup and the web test config (review focus 3, pinned)

**Files:**
- Create: `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts`, `apps/web/test/tz/dates.tz.test.tsx`
- Modify (WP9): `apps/web/vitest.config.ts`, `apps/web/package.json` (scripts)

**Interfaces:**
- Consumes: `CalendarGrid`, `buildCalendarModel`, `formatDayLong`, `formatIsoDate`, `WEEKDAYS`, WP9's `ResultsView`, `resultsResponse`, `calendarRow`.
- Produces: the `test:tz` script; `test` running coverage and then `test:tz`; per-glob coverage floors for WP10's pure modules (TS-8).

The suite proves the zone two ways. The `test:tz` script runs the TZ suite and the calendar tests as whole processes twice, with `GMT_TEST_TZ=America/Los_Angeles` and `GMT_TEST_TZ=Asia/Tokyo`; `test/setup-tz.ts` copies that value into `process.env.TZ` before any test module loads. Inside the suite, `describe.each` switches `process.env.TZ` per block, so the root `pnpm test` (one process, the machine's zone) covers both zones too. Each block first asserts the zone took effect (the resolved `Intl` zone and the January offset) and runs a negative control: a naive `Date` moves the day, and west of Greenwich a `Date`-based formatter prints "Sat 13" for 2027-03-14. `test:tz` is a zone check, not a coverage run.

- [ ] **Step 1: Write the failing test**

`apps/web/test/tz/dates.tz.test.tsx`:

```tsx
import { asIata, asIsoDate, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatDayLong, formatIsoDate, WEEKDAYS } from '../../src/format.js';
import { CalendarGrid } from '../../src/views/Calendar/CalendarGrid.js';
import { buildCalendarModel } from '../../src/views/Calendar/model.js';
import { ResultsView } from '../../src/views/Results/ResultsView.js';
import { API, calendarRow, definition, resultsResponse } from '../fixtures.js';
import { cellAt, gridDay, priceAt, provItinerary } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { NOW, renderWithProviders } from '../render.js';

const ZONES = ['America/Los_Angeles', 'Asia/Tokyo'] as const;
// why: the 2027-01-01 offsets prove the zone is in effect, so these tests cannot pass vacuously in UTC.
const JAN_OFFSET_MINUTES = { 'America/Los_Angeles': 480, 'Asia/Tokyo': -540 } as const;
// why: the control proves the bug is real in each zone: a naive Date moves the day.
const NAIVE_SHIFT = {
  'America/Los_Angeles': { input: '2027-03-14', localDay: 13 },
  'Asia/Tokyo': { input: '2027-03-14T20:00:00.000Z', localDay: 15 },
} as const;
/** The negative control (TS-11): what a Date-based formatter would print. Test code only; src may not do this. */
const naiveDayLong = (iso: string) => {
  const d = new Date(iso);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}`;
};

function cell(date: string): HTMLTableCellElement {
  const el = document.querySelector(`[data-date="${date}"]`);
  if (!(el instanceof HTMLTableCellElement)) throw new Error(`no day cell ${date}`);
  return el;
}

describe.each(ZONES)('dates never shift under TZ=%s (review focus 3)', (zone) => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  it('the zone is in effect', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(2027, 0, 1).getTimezoneOffset()).toBe(JAN_OFFSET_MINUTES[zone]);
  });

  it('control: a naive Date would move the day in this zone, and would mislabel the US DST day west of Greenwich', () => {
    expect(new Date(NAIVE_SHIFT[zone].input).getDate()).toBe(NAIVE_SHIFT[zone].localDay);
    if (zone === 'America/Los_Angeles') expect(naiveDayLong('2027-03-14')).toBe('Sat 13');
  });

  it('formatting comes from the string: DST-change days and the leap day keep their date and weekday', () => {
    expect(formatDayLong(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027'); // US DST starts
    expect(formatDayLong(asIsoDate('2027-03-28'))).toBe('Sun 28 Mar 2027'); // UK DST starts
    expect(formatDayLong(asIsoDate('2027-10-31'))).toBe('Sun 31 Oct 2027'); // UK DST ends
    expect(formatDayLong(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatIsoDate('2027-03-14')).toBe('14 Mar 2027'); // WP9's Results form, the same module
  });

  it('the calendar grid renders each day under its own date and weekday', () => {
    const days = ['2027-03-13', '2027-03-14', '2027-03-15', '2027-03-28', '2027-04-01'].map((d) =>
      gridDay(d, { cheapestVerified: priceAt(41200, provItinerary(5), false, cellAt(d, 14)) }),
    );
    renderWithProviders(
      <CalendarGrid
        days={days}
        model={buildCalendarModel(days, 'verified', NOW)}
        months={[asIsoMonth('2027-03'), asIsoMonth('2027-04')]}
        destinationNotes={{}}
        onOpen={() => undefined}
      />,
    );
    expect(cell('2027-03-13').cellIndex).toBe(5);
    expect(cell('2027-03-14').cellIndex).toBe(6);
    expect(cell('2027-03-15').cellIndex).toBe(0);
    expect(cell('2027-03-14').querySelector('[aria-hidden="true"]')?.textContent).toBe('14');
    expect(cell('2027-03-14')).toHaveTextContent('Sun 14 Mar 2027');
    expect(cell('2027-03-28')).toHaveTextContent('Sun 28 Mar 2027');
    expect(cell('2027-04-01').closest('table')).toHaveAccessibleName('April 2027');
    expect(cell('2027-04-01').cellIndex).toBe(3);
  });

  it('the Results date columns render departure and return from their strings', async () => {
    const row = calendarRow({
      cell: {
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
        nights: 14,
      },
    });
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [row], total: 1 })),
      ),
    );
    const { findAllByText, queryAllByText } = renderWithProviders(<ResultsView definition={definition()} />);
    expect((await findAllByText(/14 Mar 2027/)).length).toBeGreaterThan(0);
    expect((await findAllByText(/28 Mar 2027/)).length).toBeGreaterThan(0);
    expect(queryAllByText(/\b(13|15) Mar 2027\b|\b(27|29) Mar 2027\b/)).toHaveLength(0);
  });
});
```

`apps/web/test/setup-tz.ts`:

```ts
// Review focus 3. Vitest runs setupFiles in each worker before it imports the test file, so no Date exists yet.
// The test:tz script sets GMT_TEST_TZ; under pool 'forks' each worker is its own Node process, where an assignment to
// process.env.TZ re-detects the zone for Date and Intl.
// why: a separate variable (not TZ itself) makes the zone explicit and immune to a stray shell TZ.
const forced = process.env.GMT_TEST_TZ;
if (forced !== undefined && forced !== '') process.env.TZ = forced;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/tz`
Expected: FAIL on "the zone is in effect" (`expected 'Europe/London' to be 'America/Los_Angeles'`, or the machine's zone) under WP9's default worker pool, where assigning `process.env.TZ` does not re-detect the zone.

Run: `pnpm --filter @gmt/web run test:tz`
Expected: FAIL with `Missing script: "test:tz"`.

Manual mutation, once: in `format.ts` replace `formatDayLong`'s body with the `Date`-based `naiveDayLong` of the test file and rerun `test:tz`; the Los Angeles run must go red on the grid and formatting tests. Restore the file.

- [ ] **Step 3: Implement**

`apps/web/test/setup-charts.ts`:

```ts
// Recharts in jsdom (recharts 3 ResponsiveContainer source, checked 2026-10-15): ResponsiveContainer reads its
// container's getBoundingClientRect() on mount, then observes it with ResizeObserver, and renders no chart while
// width or height is 0. jsdom has no ResizeObserver and reports 0×0 boxes.

/** A no-op ResizeObserver; jsdom never resizes. */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = ResizeObserverStub;

const original = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
  // why: size only the chart container, so every other layout assertion still sees jsdom's real 0×0.
  if (this.classList.contains('recharts-responsive-container')) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 320,
      width: 800,
      height: 320,
      toJSON: () => ({}),
    };
  }
  return original.call(this);
};
```

`apps/web/vitest.config.ts` (WP9's file; keep its other keys, set `pool`, `exclude` and `setupFiles`, and add the glob floors):

```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** WP10: the pure view-model modules carry their own floors above the package's (TS-8). */
const VIEW_MODEL_FLOOR = { lines: 95, branches: 85, functions: 95, statements: 95 };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@gmt/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    // why: an absolute origin so the client's new URL(path, origin) gives msw an interceptable absolute URL.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    include: ['test/**/*.test.{ts,tsx}'],
    // why: forks keep each worker a separate Node process, where assigning process.env.TZ re-detects the zone (review focus 3).
    pool: 'forks',
    // why: the Playwright smoke lives in e2e/ and runs only through `pnpm --filter @gmt/web e2e` (spec §9 item 6).
    exclude: ['e2e/**', 'node_modules/**'],
    // why: setup-tz first so the zone is set before anything touches Date; setup-charts sizes Recharts in jsdom.
    setupFiles: ['test/setup-tz.ts', 'test/setup.ts', 'test/setup-charts.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
        'src/lib/**': VIEW_MODEL_FLOOR,
        'src/views/{Calendar,Duration,History}/*.ts': VIEW_MODEL_FLOOR,
      },
    },
  },
});
```

`apps/web/package.json` scripts (set these four, keep WP9's others):

```json
{
  "test": "vitest run --coverage && pnpm run test:tz",
  "test:tz": "GMT_TEST_TZ=America/Los_Angeles vitest run test/tz test/views/calendar && GMT_TEST_TZ=Asia/Tokyo vitest run test/tz test/views/calendar",
  "e2e": "pnpm --workspace-root run build && playwright test",
  "e2e:install": "playwright install chromium"
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/tz`
Expected: PASS, 10 tests (5 per zone).

Run: `pnpm --filter @gmt/web run test:tz`
Expected: two passing runs, each listing `test/tz/dates.tz.test.tsx` and the six `test/views/calendar/*` files, 80 tests each.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: TZ suite under Los Angeles and Tokyo, chart setup, forks pool and view-model coverage floors"
```

### Task 10.11: View C Duration (Recharts 3)

**Files:**
- Create: `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`, `apps/web/test/views/duration.test.tsx`

**Interfaces:**
- Consumes: `useDurationAnalysis`, `ViewHeader`, `PriceCell`, `PriceBoundary`, `formatPence`, `formatDayShort`, `sourceLabelOf`, `seriesColour`, `hrefWith`/`navigateTo` and WP9's `f.nights`; recharts `BarChart`, `Bar`, `Cell`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.
- Produces: `DurationPrice`, `DurationCell`, `DurationRow`, `DurationSeries`, `DurationData`, `buildDurationData`, `barValue`, `gapLabel`, `rowAt`, `DurationTooltip`, `DurationChart`, `DurationTable`, `DurationView`; `src/lib/palette.ts`.

One row per nights value in `[minNights, maxNights]`. Each series cell carries its own `searched` flag from the contract, so a gap reads "not searched" or "searched, no price" for a calendar series and "not itinerary-searched" or "itinerary-searched, no price" for the verified series; a nights value the api omits was searched by nothing. A gap is `null`: Recharts draws no bar, never a zero bar, never an interpolated one, and the x axis marks "ns" where no series searched. Series names come from their prices' provenance. The note under the title defines `n` ("priced cells behind each minimum"; the legend's `n` sums over stay lengths). The tooltip finds its row by the axis label in the data it already holds, so no chart payload is cast. A stale minimum is drawn at 30% opacity with a 2 px black outline. The table is the chart's text alternative (`aria-describedby`); each nights value links to Results with `f.nights=<n>-<n>`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/duration.test.tsx`:

```tsx
import { within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { DurationTooltip } from '../../src/views/Duration/DurationChart.js';
import { DurationView } from '../../src/views/Duration/DurationView.js';
import { barValue, buildDurationData, gapLabel } from '../../src/views/Duration/data.js';
import { API, definition } from '../fixtures.js';
import { bare, cellAt, durationResponse, night, priceAt, provSynthetic } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

// 10: both priced; 11: discovery searched, no itinerary search; 12: calendar only, itinerary-searched, no price;
// 13: nothing searched; 14: omitted by the api.
const resp = durationResponse([
  night(10, [52000, 3], [41200, 5]),
  night(11, null, null, { verification: false, travelpayouts: true }),
  night(
    12,
    null,
    [39900, 4],
    { verification: true, travelpayouts: true },
    cellAt('2027-03-20', 12, 'LGW', 'EWR'),
  ),
  night(13, null, null, { verification: false, travelpayouts: false }),
]);
const route = `${API}/definitions/:id/duration-analysis`;
const def = definition({
  minNights: 10,
  maxNights: 14,
  destinationNotes: { EWR: 'onward leg not included' },
});
const data = () => buildDurationData(resp, 10, 14, true);

describe('duration data (spec §11 View C; plan decision 38)', () => {
  it('one row per nights in range; missing prices are null gaps, never 0, never interpolated', () => {
    const d = data();
    expect(d.rows.map((r) => barValue(r, 'verified'))).toEqual([52000, null, null, null, null]);
    expect(d.rows.map((r) => r.nights)).toEqual([10, 11, 12, 13, 14]);
    expect(d.rows.map((r) => r.cells.verified?.price?.pricePence ?? null)).toEqual([
      52000,
      null,
      null,
      null,
      null,
    ]);
    expect(d.rows.map((r) => r.cells['calendar:travelpayouts']?.price?.pricePence ?? null)).toEqual([
      41200,
      null,
      39900,
      null,
      null,
    ]);
  });
  it('gaps are per series: not searched versus searched with no price, by stage', () => {
    const d = data();
    const verified = d.rows.map((r) => gapLabel(r.cells.verified, 'verified'));
    const calendar = d.rows.map((r) => gapLabel(r.cells['calendar:travelpayouts'], 'calendar'));
    expect(verified.slice(1)).toEqual([
      'not itinerary-searched',
      'itinerary-searched, no price',
      'not itinerary-searched',
      'not itinerary-searched',
    ]);
    expect(calendar.slice(1)).toEqual([
      'searched, no price',
      'searched, no price',
      'not searched',
      'not searched',
    ]);
    expect(d.rows.map((r) => r.anySearched)).toEqual([true, true, true, false, false]);
  });
  it('names the series from the prices’ own provenance, with n in the label', () => {
    expect(data().series.map((s) => s.name)).toEqual([
      'min among verified (class verified, n=3)',
      'calendar, Aviasales cache (constraints not checked, n=9)',
    ]);
    const at = cellAt('2027-03-14', 10);
    const synthetic = durationResponse([
      {
        nights: 10,
        minVerified: null,
        minCalendar: [
          {
            providerId: 'fixture',
            price: { ...bare(priceAt(30000, provSynthetic(1), false, at)), cell: at },
            n: 2,
          },
        ],
        searched: { verification: false, discovery: [{ providerId: 'fixture', searched: true }] },
      },
    ]);
    expect(buildDurationData(synthetic, 10, 10, false).series.map((s) => s.name)).toEqual([
      'calendar, synthetic fixture data (constraints not checked, n=2)',
    ]);
  });
  it('omits the verified series when there is no verification provider and nothing verified; empty with no price', () => {
    expect(
      buildDurationData(durationResponse([night(10, null, [41200, 5])]), 10, 14, false).series.map(
        (s) => s.key,
      ),
    ).toEqual(['calendar:travelpayouts']);
    expect(buildDurationData(durationResponse([night(10, null, null)]), 10, 14, true).isEmpty).toBe(true);
  });
  it('the tooltip shows each series with price, n and departure date, or the gap by kind', () => {
    const d = data();
    const tip = renderWithProviders(<DurationTooltip active label={10} data={d} />).getByTestId(
      'duration-tooltip',
    );
    expect(tip).toHaveTextContent('10 nights');
    expect(tip).toHaveTextContent('min among verified: £520 (n=3) · departs Sun 14 Mar');
    expect(tip).toHaveTextContent('calendar, Aviasales cache: £412 (n=5) · departs Sun 14 Mar');
    const gap = renderWithProviders(<DurationTooltip active label="12" data={d} />).getAllByTestId(
      'duration-tooltip',
    )[1];
    expect(gap).toHaveTextContent('min among verified: itinerary-searched, no price');
    expect(gap).toHaveTextContent('calendar, Aviasales cache: £399 (n=4) · departs Sat 20 Mar');
    const none = renderWithProviders(<DurationTooltip active label={13} data={d} />).getAllByTestId(
      'duration-tooltip',
    )[2];
    expect(none).toHaveTextContent('calendar, Aviasales cache: not searched');
  });
  it('the tooltip renders nothing when inactive or off the data', () => {
    expect(
      renderWithProviders(<DurationTooltip active={false} label={10} data={data()} />).container,
    ).toBeEmptyDOMElement();
    expect(
      renderWithProviders(<DurationTooltip active label={99} data={data()} />).container,
    ).toBeEmptyDOMElement();
  });
});

describe('Duration view (spec §11 View C)', () => {
  it('shows an explicit loading state', () => {
    server.use(
      http.get(route, async () => {
        await delay('infinite');
        return HttpResponse.json(resp);
      }),
    );
    expect(renderWithProviders(<DurationView definition={def} />).getByRole('status')).toHaveTextContent(
      'Loading…',
    );
  });
  it('shows an error state', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    expect(
      await renderWithProviders(<DurationView definition={def} />).findByRole('alert'),
    ).toHaveTextContent('Could not load: boom');
  });
  it('shows an explicit empty state and no chart', async () => {
    server.use(http.get(route, () => HttpResponse.json(durationResponse([]))));
    expect(
      await renderWithProviders(<DurationView definition={def} />).findByText(
        /^No prices yet for any stay length/,
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('draws a named chart with axis titles, a legend carrying n, ns ticks and no bar for a gap', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const figure = await findByRole('figure', { name: 'Cheapest found by stay length' });
    expect(figure).toHaveAccessibleDescription(/Cheapest found per stay length, with provenance/);
    expect(figure).toHaveTextContent('n = priced cells behind each minimum');
    // why: recharts draws legend icons as svgs too; the chart surface is the one with role="application".
    const svg = figure.querySelector('svg[role="application"]');
    expect(svg?.textContent).toContain('nights');
    expect(svg?.textContent).toContain('13 ns');
    expect(svg?.textContent).toContain('14 ns');
    expect(svg?.textContent).not.toContain('11 ns');
    const legend = figure.querySelector('.recharts-legend-wrapper')?.textContent ?? '';
    expect(legend).toContain('min among verified (class verified, n=3)');
    expect(legend).toContain('calendar, Aviasales cache (constraints not checked, n=9)');
    // why: three non-null values (10 verified, 10 and 12 calendar): a gap must never be drawn as a zero-height bar.
    expect(figure.querySelectorAll('.recharts-rectangle')).toHaveLength(3);
    const [verifiedBars, calendarBars] = [...figure.querySelectorAll('.recharts-bar')];
    expect(verifiedBars?.querySelectorAll('.recharts-rectangle')).toHaveLength(1);
    const dashed = [...(calendarBars?.querySelectorAll('.recharts-rectangle') ?? [])].map((b) =>
      b.getAttribute('stroke-dasharray'),
    );
    expect(dashed).toEqual(['4 2', '4 2']);
  });

  it('a stale minimum is drawn faded with a heavy outline', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json(
          durationResponse([
            {
              ...night(10, null, [41200, 5]),
              minCalendar: [
                {
                  providerId: 'travelpayouts',
                  price: {
                    ...bare(priceAt(41200, provSynthetic(400), true, cellAt('2027-03-14', 10))),
                    cell: cellAt('2027-03-14', 10),
                  },
                  n: 5,
                },
              ],
            },
          ]),
        ),
      ),
    );
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const figure = await findByRole('figure');
    const bar = figure.querySelector('.recharts-rectangle');
    expect(bar?.getAttribute('stroke-width')).toBe('2');
    expect(bar?.getAttribute('fill-opacity')).toBe('0.3');
  });

  it('tables every price with provenance, destination and note, n and departure date; each gap by kind; nights link to Results', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />, {
      search: '?view=duration&def=def-0001',
    });
    const table = await findByRole('table', { name: 'Cheapest found per stay length, with provenance' });
    const provs = within(table).getAllByTestId('provenance');
    expect(provs).toHaveLength(3);
    expect(table).toHaveTextContent('EWR');
    expect(table).toHaveTextContent('onward leg not included');
    expect(table).toHaveTextContent('n=4 · departs Sat 20 Mar');
    for (const gap of [
      'not itinerary-searched',
      'itinerary-searched, no price',
      'searched, no price',
      'not searched',
    ])
      expect(table).toHaveTextContent(gap);
    const link =
      within(table).getByRole('link', { name: '12 nights: show in results' }).getAttribute('href') ?? '';
    const p = new URLSearchParams(link.split('?')[1]);
    expect(p.get('view')).toBe('results');
    expect(p.get('f.nights')).toBe('12-12');
    expect(p.get('def')).toBe('def-0001');
  });

  it('a duration price lacking provenance fails to render: the contract parse refuses it, no amount appears', async () => {
    const [first] = resp.byNights;
    if (first?.minVerified == null) throw new Error('fixture has a verified minimum');
    const { provenance: _dropped, ...noProv } = first.minVerified;
    server.use(
      http.get(route, () => HttpResponse.json({ ...resp, byNights: [{ ...first, minVerified: noProv }] })),
    );
    const { findByRole, container } = renderWithProviders(<DurationView definition={def} />);
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(container).not.toHaveTextContent('£');
  });

  it('says how many shown prices are stale', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json(
          durationResponse(
            [night(10, [52000, 3], [41200, 5])].map((n) => ({
              ...n,
              minVerified: n.minVerified === null ? null : { ...n.minVerified, stale: true },
            })),
          ),
        ),
      ),
    );
    expect(
      await renderWithProviders(<DurationView definition={def} />).findByText(
        '1 of 2 shown prices are stale (older than one refresh cycle)',
      ),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/duration.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/Duration/data.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/palette.ts`:

```ts
/**
 * The categorical series palette for every WP10 chart (dataviz skill: one hue per series, never the only cue; dash
 * styles and labels back every colour). Defined once; Duration and History import it.
 */
export const SERIES_COLOURS = ['#1d4ed8', '#c2410c', '#7c3aed', '#047857', '#be185d', '#4d7c0f'] as const;

/** Colour of the i-th series, cycling. */
export function seriesColour(i: number): string {
  return SERIES_COLOURS[i % SERIES_COLOURS.length] ?? SERIES_COLOURS[0];
}
```

`apps/web/src/views/Duration/data.ts`:

```ts
import type { ProviderId, SourceKind } from '@gmt/core';
import type { DurationResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { sourceLabelOf } from '../../lib/sources.js';

type Night = DurationResponse['byNights'][number];
/** A per-nights minimum as the duration route sends it: a price cell with the cell it came from (plan decision 38). */
export type DurationPrice = Night['minCalendar'][number]['price'];

/** One series at one nights value: its minimum (or null), n, and whether that series searched this nights value. */
export interface DurationCell {
  price: DurationPrice | null;
  n: number;
  searched: boolean;
}
export interface DurationRow {
  nights: number;
  cells: Record<string, DurationCell>;
  /** False when no series searched this nights value: the x axis marks it "ns". */
  anySearched: boolean;
}
export interface DurationSeries {
  key: string;
  kind: 'verified' | 'calendar';
  providerId: ProviderId | null;
  totalN: number;
  name: string;
  shortName: string;
}
export interface DurationData {
  rows: DurationRow[];
  series: DurationSeries[];
  isEmpty: boolean;
}

const VERIFIED = 'verified';
const calendarKey = (p: ProviderId) => `calendar:${p}`;

/**
 * Rows for every nights in [minNights, maxNights] and one series per basis and provider (spec §11 View C). Missing
 * values stay null so the chart leaves a gap (never 0, never interpolated); each cell carries its own series'
 * `searched` flag, so "not searched" and "searched, no price" stay distinct per series (plan decision 38). A nights
 * value the api omits was searched by nothing.
 */
export function buildDurationData(
  resp: DurationResponse,
  minNights: number,
  maxNights: number,
  hasVerification: boolean,
): DurationData {
  const byNights = new Map<number, Night>(resp.byNights.map((r) => [r.nights, r]));
  const providers: ProviderId[] = [];
  const kinds = new Map<ProviderId, SourceKind[]>();
  for (const r of resp.byNights) {
    for (const d of r.searched.discovery) if (!providers.includes(d.providerId)) providers.push(d.providerId);
    for (const m of r.minCalendar) {
      if (!providers.includes(m.providerId)) providers.push(m.providerId);
      kinds.set(m.providerId, [...(kinds.get(m.providerId) ?? []), m.price.provenance.sourceKind]);
    }
  }
  const rows: DurationRow[] = [];
  for (let nights = minNights; nights <= maxNights; nights += 1) {
    const r = byNights.get(nights);
    const v = r?.minVerified ?? null;
    const cells: Record<string, DurationCell> = {
      [VERIFIED]: { price: v, n: v?.n ?? 0, searched: r?.searched.verification ?? false },
    };
    for (const p of providers) {
      const m = r?.minCalendar.find((x) => x.providerId === p);
      const searched = r?.searched.discovery.find((x) => x.providerId === p)?.searched ?? false;
      cells[calendarKey(p)] = { price: m?.price ?? null, n: m?.n ?? 0, searched };
    }
    rows.push({ nights, cells, anySearched: Object.values(cells).some((c) => c.searched) });
  }
  const totalN = (key: string) => rows.reduce((sum, r) => sum + (r.cells[key]?.n ?? 0), 0);
  const anyVerified = rows.some((r) => r.cells[VERIFIED]?.price != null);
  const series: DurationSeries[] = [];
  const D = COPY.durationView;
  // why: a verified series with no provider and no data would be an empty promise in the legend.
  if (hasVerification || anyVerified) {
    const n = totalN(VERIFIED);
    series.push({
      key: VERIFIED,
      kind: 'verified',
      providerId: null,
      totalN: n,
      name: D.verifiedSeries(n),
      shortName: D.verifiedShort,
    });
  }
  for (const p of providers) {
    const key = calendarKey(p);
    // why: label from the prices' own provenance (each carries its sourceKind); a provider with no price yet is named.
    const found = kinds.get(p) ?? [];
    const source = found.length === 0 ? COPY.provider[p] : sourceLabelOf(found);
    const n = totalN(key);
    series.push({
      key,
      kind: 'calendar',
      providerId: p,
      totalN: n,
      name: D.calendarSeries(source, n),
      shortName: D.calendarShort(source),
    });
  }
  return { rows, series, isEmpty: rows.every((r) => series.every((s) => r.cells[s.key]?.price == null)) };
}

/**
 * The bar height of one series at one nights value: its minimum's pence, or null for a gap. Recharts draws no bar for
 * null; a 0 here would claim a free fare and is never produced (spec §11 View C: gaps, no interpolation).
 */
export function barValue(row: DurationRow, key: string): number | null {
  return row.cells[key]?.price?.pricePence ?? null;
}

/** The gap wording of one series at one nights value (plan decision 38: per series, by stage). */
export function gapLabel(cell: DurationCell | undefined, kind: DurationSeries['kind']): string {
  const searched = cell?.searched ?? false;
  const D = COPY.durationView;
  if (kind === 'verified') return searched ? D.itinerarySearchedNoPrice : D.notItinerarySearched;
  return searched ? D.searchedNoPrice : D.notSearched;
}
```

`apps/web/src/views/Duration/DurationChart.tsx`:

```tsx
import type { Iata } from '@gmt/core';
import { useId } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayShort, formatPence } from '../../format.js';
import { seriesColour } from '../../lib/palette.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { barValue, type DurationData, type DurationRow, type DurationSeries, gapLabel } from './data.js';

const D = COPY.durationView;

/** The row a tooltip label (the nights value on the x axis) names; a lookup, never a cast of the chart payload. */
export function rowAt(rows: readonly DurationRow[], label: unknown): DurationRow | undefined {
  const nights = typeof label === 'number' ? label : typeof label === 'string' ? Number(label) : Number.NaN;
  return rows.find((r) => r.nights === nights);
}

/** One series' tooltip value: price, n, departure date and stale, or the gap kind (spec §11 View C: n in the tooltip). */
function tooltipValue(row: DurationRow, s: DurationSeries): string {
  const c = row.cells[s.key];
  if (c === undefined || c.price === null) return D.tooltipGap(gapLabel(c, s.kind));
  const base = D.tooltipValue(
    formatPence(c.price.pricePence),
    c.n,
    formatDayShort(c.price.cell.departureDate),
  );
  return c.price.stale ? `${base} · ${COPY.stale}` : base;
}

/** Custom tooltip: the nights, then each series' price with n, departure date and stale label, or its gap kind. */
export function DurationTooltip(props: {
  active?: boolean | undefined;
  label?: unknown;
  data: DurationData;
}) {
  const row = rowAt(props.data.rows, props.label);
  if (props.active !== true || row === undefined) return null;
  return (
    <div data-testid="duration-tooltip" className="rounded border bg-white p-2 text-xs shadow">
      <p className="font-medium">{D.nightsLabel(row.nights)}</p>
      <ul>
        {props.data.series.map((s) => (
          <li key={s.key}>{D.seriesLine(s.shortName, tooltipValue(row, s))}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bars per nights with axis titles (nights, £), one series per basis and provider (spec §11 View C). A missing value
 * is a gap, never a zero bar; a nights value no series searched is marked "ns" on the axis; calendar series are dashed
 * and a stale minimum is drawn faded with a heavy outline, so no meaning rests on colour alone.
 */
export function DurationChart({ data, tableId }: { data: DurationData; tableId: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tableId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {D.chartTitle}
      </figcaption>
      <p className="text-xs">{D.chartNote}</p>
      {/* why: ui-r1-010 — on a phone the bars keep a readable width and the chart scrolls sideways */}
      <div className="overflow-x-auto">
        <div className="h-80 min-w-[36rem]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.rows} margin={{ top: 8, right: 16, bottom: 28, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="nights"
                tickFormatter={(v: number) =>
                  rowAt(data.rows, v)?.anySearched === false ? D.tickNotSearched(v) : String(v)
                }
                label={{ value: D.xAxis, position: 'insideBottom', offset: -16 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatPence(v)}
                label={{ value: D.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Tooltip content={(p) => <DurationTooltip active={p.active} label={p.label} data={data} />} />
              <Legend verticalAlign="top" />
              {data.series.map((s, i) => (
                <Bar
                  key={s.key}
                  name={s.name}
                  dataKey={(r: DurationRow) => barValue(r, s.key)}
                  fill={seriesColour(i)}
                  stroke={seriesColour(i)}
                  {...(s.kind === 'calendar' ? { strokeDasharray: '4 2' } : {})}
                  isAnimationActive={false}
                >
                  {data.rows.map((r) => {
                    const stale = r.cells[s.key]?.price?.stale === true;
                    return (
                      <Cell
                        key={r.nights}
                        data-stale={stale ? 'true' : 'false'}
                        fillOpacity={stale ? 0.3 : s.kind === 'calendar' ? 0.6 : 1}
                        stroke={stale ? '#000000' : seriesColour(i)}
                        strokeWidth={stale ? 2 : 1}
                      />
                    );
                  })}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </figure>
  );
}

/**
 * The same numbers as a table (the chart's text alternative): every price through PriceCell with its destination and
 * the operator's note (spec §11), n, the departure date of the minimum, each gap by kind; the nights value links to
 * Results filtered to that stay length (plan decision 38).
 */
export function DurationTable(props: {
  data: DurationData;
  id: string;
  notes: Partial<Record<Iata, string>>;
}) {
  const { data, id, notes } = props;
  return (
    <div className="overflow-x-auto">
      <table id={id} className="mt-2 w-full text-xs">
        <caption className="text-left font-medium">{D.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white">
              {D.xAxis}
            </th>
            {data.series.map((s) => (
              <th key={s.key} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const patch = { view: 'results', 'f.nights': `${r.nights}-${r.nights}` };
            return (
              <tr key={r.nights}>
                <th scope="row" className="sticky left-0 bg-white">
                  <a href={hrefWith(patch)} onClick={navigateTo(patch)} className="underline">
                    {D.nightsLink(r.nights)}
                  </a>
                </th>
                {data.series.map((s) => {
                  const c = r.cells[s.key];
                  if (c === undefined || c.price === null) return <td key={s.key}>{gapLabel(c, s.kind)}</td>;
                  const p = c.price;
                  return (
                    <td key={s.key}>
                      <PriceBoundary>
                        <PriceCell
                          pricePence={p.pricePence}
                          provenance={p.provenance}
                          calendar={s.kind === 'calendar'}
                          stale={p.stale}
                          truncated={p.truncated}
                          destination={p.cell.destination}
                          destinationNote={notes[p.cell.destination] ?? null}
                        />
                      </PriceBoundary>
                      <span className="block">{D.cellDetail(c.n, formatDayShort(p.cell.departureDate))}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

`apps/web/src/views/Duration/DurationView.tsx`:

```tsx
import { useId, useMemo } from 'react';
import { useDurationAnalysis } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { DurationChart, DurationTable } from './DurationChart.js';
import { buildDurationData } from './data.js';

/** View C: cheapest found per stay length (spec §11 View C, §10 duration-analysis route). */
export function DurationView({ definition }: { definition: DefinitionResponse }) {
  const q = useDurationAnalysis(definition.id);
  const tableId = useId();
  const data = useMemo(
    () =>
      q.data === undefined
        ? null
        : buildDurationData(
            q.data,
            definition.minNights,
            definition.maxNights,
            definition.providers.verification.length > 0,
          ),
    [q.data, definition],
  );
  if (q.isPending) return <p role="status">{COPY.loading}</p>;
  if (q.isError) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;
  const prices =
    data === null
      ? []
      : data.rows.flatMap((r) => Object.values(r.cells).flatMap((c) => (c.price === null ? [] : [c.price])));
  const stale = prices.filter((p) => p.stale).length;
  return (
    <section aria-label={COPY.durationView.title} className="flex flex-col gap-4">
      <ViewHeader
        title={COPY.durationView.title}
        executions={q.data.executions}
        stale={prices.length > 0 && stale === prices.length}
      />
      {stale > 0 ? <p className="text-sm">{COPY.durationView.staleLine(stale, prices.length)}</p> : null}
      {data === null || data.isEmpty ? (
        <p>{COPY.durationView.empty}</p>
      ) : (
        <>
          <DurationChart data={data} tableId={tableId} />
          <DurationTable data={data} id={tableId} notes={definition.destinationNotes} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/duration.test.tsx test/copy`
Expected: PASS. The duration file passes 14 tests. Mutation check, once: make `barValue` return `?? 0` instead of `?? null`; "missing prices are null gaps, never 0" must fail. (Recharts draws no visible bar at 0 either, so the DOM test alone cannot catch it; the value test does.) Restore it.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: duration view with per-series gaps, ns ticks, stale bars, n defined, links to Results (spec §11 View C)"
```

### Task 10.12: History view

**Files:**
- Create: `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,HistoryView.tsx}`, `apps/web/test/views/history.test.tsx`

**Interfaces:**
- Consumes: `useRouteHistories`, `useItineraryHistory`, `qk.results` (cache lookup), `DEFAULT_DISCOVERY_REFRESH_HOURS`, `cellKeyString`, `instantMs`, `dateMs`, `dateOfMs`, the `format.ts` forms, `effectiveAge`, `formatAgeFull`, `PriceCell`, `PriceBoundary`, `sourceLabelOf`, `seriesColour`, `ViewHeader` (cross-execution variant), `useSearchParams`, `updateSearchParams`, `hrefWith`, `navigateTo`; recharts `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Legend`, `ResponsiveContainer`.
- Produces: `RoutePoint`, `PlotPoint`, `PlotLine`, `RoutePlotPoint`, `RouteLine`, `CONNECT_FACTOR`, `refreshHoursOf`, `runCadenceHours`, `connectLimitMs`, `withGaps`, `linesFromRoute`, `linesFromItinerary`, `historySpan`, `newestAllStale`, `HistoryChart`, `RouteChart`, `HistoryTable`, `RouteTable`, `HISTORY_PARAMS`, `MAX_OVERLAY_PAIRS`, `historyHref`, `findCachedRow`, `HistoryView`.

**Two charts (plan decision 38).** Fetch-time series (calendar per provider, itinerary offers) are plotted at `fetchedAt` on a Europe/London date axis. Google's indicative route-level series is a different quantity (price by travel date for the route as a whole), so it gets its own chart with a date axis (`dateMs`, ticks as dates with the year) and its own tables.

**Joins (plan decision 38).** Two consecutive points of a fetch-time series are joined only when they are at most 1.5 refresh periods apart: that provider's `discoveryRefreshHours` (core's default 168 h when absent) for calendar series; for offers, the definition's run cadence (its longest discovery refresh period), because offers are fetched by the runs, not on the itinerary provider's own clock. A longer gap inserts a `null`, and `connectNulls={false}` breaks the line. The caption says that each point is one run and no price was fetched between two points. The daily route-level series breaks after a missing travel date.

**Provenance.** Every fetch-time point renders through PriceCell with its own `stale` and `truncated` from the contract. A calendar point names its cheapest searched cell and says when that cell differs from the previous point's. An offer the final step did not confirm sits in its own dashed series named "… · price not confirmed by the final step" and says so in its row. Route-level points carry no cabin, so (spec §11) they show the amount with "indicative route-level series", the cabin as the vendor gave it ("cabin not stated" for `unknown`) and the fetched age, never a PriceCell.

**State.** The pair (`hist.pair`, or `all` for the overlay of up to six pairs) and the itinerary (`hash`) live in the URL. In itinerary mode the heading names the route, dates and carriers of the Results row with that hash from the query cache (the operator arrived from it); without it the heading says how to get them. The header is WP9's cross-execution `ViewHeader`: how many runs the lines span, first and last fetch, stale when every series' newest point is stale. No tooltip (§6).

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/history.test.tsx`:

```tsx
import { DEFAULT_DISCOVERY_REFRESH_HOURS } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { qk } from '../../src/api/queries.js';
import { HISTORY_PARAMS, HistoryView, historyHref } from '../../src/views/History/HistoryView.js';
import {
  connectLimitMs,
  historySpan,
  linesFromItinerary,
  linesFromRoute,
  newestAllStale,
  runCadenceHours,
  withGaps,
} from '../../src/views/History/lines.js';
import { API, definition, resultsResponse, verifiedRow } from '../fixtures.js';
import { cellAt, fetchPoint, itineraryHistory, offerPoint, routeHistory } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

const H = 3_600_000;
const weekly = { discovery: ['travelpayouts' as const], discoveryRefreshHours: { travelpayouts: 168 } };
const routeRoute = `${API}/routes/:origin/:destination/history`;
const itineraryRoute = `${API}/itineraries/:hash/history`;
// Runs 2h, 170h and 500h ago: 168h apart connect (≤ 1.5 × 168 = 252h); 330h apart break.
const threeRuns = routeHistory({
  calendarSeries: [
    {
      providerId: 'travelpayouts',
      cabin: 'economy',
      points: [
        fetchPoint(500, 45000),
        fetchPoint(2, 39900, cellAt('2027-03-21', 14)),
        fetchPoint(170, 42000),
      ],
    },
  ],
});
const priced = (pts: ReadonlyArray<{ pricePence: number | null }>) => pts.map((p) => p.pricePence);

describe('history lines (spec §11 History; plan decision 38)', () => {
  it('withGaps sorts any input order and breaks only beyond the limit: the limit connects, the limit + 1 ms breaks', () => {
    const gap = (t: number) => ({ t, gap: true });
    expect(withGaps([{ t: 300 }, { t: 0 }, { t: 100 }], 200, gap)).toEqual([
      { t: 0 },
      { t: 100 },
      { t: 300 },
    ]);
    expect(withGaps([{ t: 0 }, { t: 201 }], 200, gap)).toEqual([
      { t: 0 },
      { t: 100.5, gap: true },
      { t: 201 },
    ]);
  });
  it('connects consecutive scheduled runs only: 1.5 × that provider’s refresh period, core’s default when absent', () => {
    expect(connectLimitMs(168)).toBe(252 * H);
    const [line] = linesFromRoute(threeRuns, weekly).fetch;
    expect(priced(line?.points ?? [])).toEqual([45000, null, 42000, 39900]);
    const daily = linesFromRoute(threeRuns, { discoveryRefreshHours: { travelpayouts: 24 } }).fetch[0];
    expect(priced(daily?.points ?? [])).toEqual([45000, null, 42000, null, 39900]);
    const absent = linesFromRoute(threeRuns, { discoveryRefreshHours: {} }).fetch[0];
    expect(DEFAULT_DISCOVERY_REFRESH_HOURS).toBe(168);
    expect(priced(absent?.points ?? [])).toEqual([45000, null, 42000, 39900]);
  });
  it('marks a calendar point whose cheapest cell differs from the previous point’s', () => {
    const [line] = linesFromRoute(threeRuns, weekly).fetch;
    const changed = (line?.points ?? []).flatMap((p) => (p.kind === 'price' ? [p.cellChanged] : []));
    expect(changed).toEqual([false, false, true]);
  });
  it('the route-level series is its own line, plotted by travel date, broken after a missing day', () => {
    const r = routeHistory({
      routeSeries: [
        {
          providerId: 'searchapi',
          cabin: 'unknown',
          points: ['2027-03-10', '2027-03-11', '2027-03-14'].map((date) => ({
            date,
            pricePence: 38000,
            fetchedAt: fetchPoint(2, 1).at,
            providerId: 'searchapi',
            sourceKind: 'scraped-search',
          })),
        },
      ],
    });
    const { route } = linesFromRoute(r, weekly);
    expect(route[0]?.points[0]?.t).toBe(Date.UTC(2027, 2, 10));
    expect(priced(route[0]?.points ?? [])).toEqual([38000, 38000, null, 38000]);
  });
  it('names each series by the source its prices carry, with the indicative label for the route-level series', () => {
    const { fetch, route } = linesFromRoute(threeRuns, weekly);
    expect(fetch.map((l) => l.name)).toEqual([
      "Aviasales cache · cheapest calendar price across this pair's cells, per run (constraints not checked)",
    ]);
    expect(route.map((l) => l.name)).toEqual(["Google's indicative route-level series"]);
    expect(linesFromRoute(threeRuns, weekly, 'LHR-JFK').fetch[0]?.name).toMatch(/^LHR-JFK · Aviasales cache/);
  });
  it('an itinerary splits confirmed and unconfirmed prices into a solid and a dashed series, on the run cadence', () => {
    const lines = linesFromItinerary(itineraryHistory(), weekly);
    expect(lines.map((l) => [l.kind, l.name])).toEqual([
      ['offer', 'Google Flights via SearchApi · itinerary offer · Example Travel'],
      [
        'offer-unconfirmed',
        'Google Flights via SearchApi · itinerary offer · Example Travel · price not confirmed by the final step',
      ],
    ]);
    expect(
      runCadenceHours({
        discovery: ['travelpayouts', 'searchapi'],
        discoveryRefreshHours: { travelpayouts: 168, searchapi: 336 },
      }),
    ).toBe(336);
    expect(runCadenceHours({ discovery: [], discoveryRefreshHours: {} })).toBe(168);
  });
  it('drops series with no points; spans and newest-stale come from the drawn points', () => {
    expect(
      linesFromRoute(
        routeHistory({
          calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points: [] }],
          routeSeries: [],
        }),
        weekly,
      ),
    ).toEqual({ fetch: [], route: [] });
    const { fetch } = linesFromRoute(threeRuns, weekly);
    expect(historySpan(fetch)).toEqual({
      runs: 3,
      firstAt: fetchPoint(500, 1).at,
      lastAt: fetchPoint(2, 1).at,
    });
    expect(historySpan([])).toBeNull();
    expect(newestAllStale(fetch)).toBe(false);
    const stale = linesFromRoute(
      routeHistory({
        calendarSeries: [
          {
            providerId: 'travelpayouts',
            cabin: 'economy',
            points: [fetchPoint(2, 1, undefined, { stale: true })],
          },
        ],
      }),
      weekly,
    );
    expect(newestAllStale(stale.fetch)).toBe(true);
  });
});

describe('History view (spec §11 History, §10 history routes; plan decision 38)', () => {
  it('shows an explicit loading state', () => {
    server.use(
      http.get(routeRoute, async () => {
        await delay('infinite');
        return HttpResponse.json(threeRuns);
      }),
    );
    expect(
      renderWithProviders(<HistoryView definition={definition()} />).getByRole('status'),
    ).toHaveTextContent('Loading…');
  });
  it('shows an error state', async () => {
    server.use(
      http.get(routeRoute, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    expect(
      await renderWithProviders(<HistoryView definition={definition()} />).findByRole('alert'),
    ).toHaveTextContent('Could not load: boom');
  });
  it('shows the empty state when there is no history', async () => {
    server.use(
      http.get(routeRoute, () => HttpResponse.json(routeHistory({ calendarSeries: [], routeSeries: [] }))),
    );
    const { findByText } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(
      await findByText('No price history yet for this selection. Each run adds a point.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('route mode: the pair lives in the URL, the definition’s cabin is the query, and "all pairs" overlays them', async () => {
    const paths: string[] = [];
    const cabins: Array<string | null> = [];
    server.use(
      http.get(routeRoute, ({ request }) => {
        const u = new URL(request.url);
        paths.push(u.pathname);
        cabins.push(u.searchParams.get('cabin'));
        return HttpResponse.json(threeRuns);
      }),
    );
    const { findByLabelText, findAllByRole, user } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    const picker = await findByLabelText('Route');
    if (!(picker instanceof HTMLSelectElement)) throw new Error('route picker is a select');
    expect([...picker.options].map((o) => o.text)).toEqual([
      'LHR→JFK',
      'LHR→EWR',
      'LGW→JFK',
      'LGW→EWR',
      'All pairs',
    ]);
    await waitFor(() => expect(paths.at(-1)).toBe('/api/routes/LHR/JFK/history'));
    expect(cabins.at(-1)).toBe('economy');
    await user.selectOptions(picker, 'LGW-EWR');
    expect(new URLSearchParams(window.location.search).get(HISTORY_PARAMS.pair)).toBe('LGW-EWR');
    await waitFor(() => expect(paths.at(-1)).toBe('/api/routes/LGW/EWR/history'));
    await user.selectOptions(picker, 'all');
    const tables = await findAllByRole('table', { name: /^LGW-EWR · Aviasales cache/ });
    expect(tables).toHaveLength(1);
    expect(new Set(paths)).toEqual(
      new Set([
        '/api/routes/LHR/JFK/history',
        '/api/routes/LHR/EWR/history',
        '/api/routes/LGW/JFK/history',
        '/api/routes/LGW/EWR/history',
      ]),
    );
  });

  it('draws fetch-time lines and the indicative route-level series in separate charts, breaking only between runs', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json(threeRuns)));
    const { findByRole, getByRole, getByText } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    const fetchChart = await findByRole('figure', { name: 'Price by fetch date' });
    const routeChart = getByRole('figure', {
      name: "Google's indicative route-level series: price by travel date",
    });
    expect(fetchChart.querySelector('svg[role="application"]')?.textContent).toContain(
      'fetched (Europe/London)',
    );
    expect(routeChart.querySelector('svg[role="application"]')?.textContent).toContain('travel date');
    expect(routeChart.querySelector('svg[role="application"]')?.textContent).toContain('10 Mar 2027');
    expect(
      getByText(/^Each point is one run. Lines join consecutive scheduled runs only/),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchChart.querySelector('.recharts-line-curve')).not.toBeNull());
    const curve = fetchChart.querySelector('.recharts-line-curve');
    // why: one null between the 500h and 170h runs: two sub-paths, never a segment across the gap (TS-1).
    expect(curve?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(curve?.getAttribute('stroke-dasharray')).toBe('6 3');
    expect(routeChart.querySelector('.recharts-line-curve')?.getAttribute('d')?.match(/M/g)).toHaveLength(1);
  });

  it('tables every point: provider prices through PriceCell with stale and rows-read labels and the changed cell; route rows labelled indicative', async () => {
    const r = routeHistory({
      calendarSeries: [
        {
          providerId: 'travelpayouts',
          cabin: 'economy',
          points: [
            fetchPoint(2, 39900, cellAt('2027-03-21', 14), { truncated: true }),
            fetchPoint(170, 42000, undefined, { stale: true }),
          ],
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(r)));
    const { findByRole, getByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const calendarTable = await findByRole('table', { name: /Aviasales cache · cheapest calendar price/ });
    const rows = within(calendarTable).getAllByRole('row').slice(1);
    expect(within(calendarTable).getAllByTestId('provenance')).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('cheapest of the rows read');
    expect(rows[0]).toHaveTextContent('cheapest searched cell LHR→JFK Sun 21 Mar–Sun 4 Apr');
    expect(rows[0]).toHaveTextContent('a different cell from the previous point');
    expect(rows[1]).toHaveTextContent('stale');
    const routeTable = getByRole('table', { name: /^Google's indicative route-level series/ });
    expect(
      within(routeTable).getAllByText(
        'Google Flights via SearchApi · indicative route-level series · cabin not stated · fetched 2h ago · provider age unknown',
      ),
    ).toHaveLength(3);
    expect(routeTable).toHaveTextContent('Wed 10 Mar 2027');
    expect(within(routeTable).queryAllByTestId('provenance')).toHaveLength(0);
  });

  it('the header spans the runs shown (the cross-execution ViewHeader)', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json(threeRuns)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    await findByRole('figure', { name: 'Price by fetch date' });
    // why: the wording is WP9's ViewHeader's; WP10 checks it receives the span (3 runs, first and last fetch dates).
    const header = (await findByRole('heading', { name: 'History', level: 2 })).parentElement;
    expect(header).toHaveTextContent('3');
    expect(header).toHaveTextContent('23 Sep 2026');
    expect(header).toHaveTextContent('14 Oct 2026');
  });

  it('itinerary mode names the trip from the cached Results row and draws unconfirmed prices dashed and labelled', async () => {
    const paths: string[] = [];
    server.use(
      http.get(itineraryRoute, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(itineraryHistory());
      }),
    );
    const { client, findByRole, getByText } = renderWithProviders(
      <HistoryView definition={definition({ destinationNotes: { JFK: 'onward leg not included' } })} />,
      { search: '?view=history&hash=hash-verified-1' },
    );
    // why: the operator arrives from a Results row, so that response is in the query cache (the view never refetches it).
    client.setQueryData(qk.results('def-0001', null), resultsResponse({ rows: [verifiedRow()] }));
    const unconfirmed = await findByRole('table', {
      name: /price not confirmed by the final step: every point/,
    });
    expect(unconfirmed).toHaveTextContent('price not confirmed by the final step');
    expect(getByText('LHR→JFK · Sun 14 Mar 2027 to Sun 28 Mar 2027 · ZZ')).toBeInTheDocument();
    expect(getByText('itinerary hash-verified-1')).toBeInTheDocument();
    expect(unconfirmed).toHaveTextContent('onward leg not included');
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.recharts-line-curve')].map((c) => c.getAttribute('stroke-dasharray')),
      ).toEqual([null, '2 3']),
    );
    expect(paths.at(-1)).toBe('/api/itineraries/hash-verified-1/history');
  });

  it('an itinerary opened without its Results row says how to see its route and dates', async () => {
    server.use(
      http.get(itineraryRoute, () =>
        HttpResponse.json(
          itineraryHistory({
            series: [
              {
                providerId: 'searchapi',
                seller: 'Example Travel',
                cabin: 'economy',
                points: [offerPoint(5, 41200)],
              },
            ],
          }),
        ),
      ),
    );
    const { findByText } = renderWithProviders(<HistoryView definition={definition()} />, {
      search: '?view=history&hash=abc123',
    });
    expect(
      await findByText('Itinerary abc123: open it from a Results row to see its route and dates'),
    ).toBeInTheDocument();
  });

  it('a history price lacking provenance fails to render: the contract parse refuses it, no amount appears', async () => {
    const [series] = threeRuns.calendarSeries;
    const [point] = series?.points ?? [];
    if (series === undefined || point === undefined) throw new Error('fixture has a calendar point');
    const { provenance: _dropped, ...noProv } = point;
    server.use(
      http.get(routeRoute, () =>
        HttpResponse.json({ ...threeRuns, calendarSeries: [{ ...series, points: [noProv] }] }),
      ),
    );
    const { findByRole, container } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(container).not.toHaveTextContent('£');
  });

  it('historyHref keeps the other URL parameters and sets view and hash', () => {
    window.history.replaceState(null, '', '/?view=results&def=def-0001');
    const p = new URLSearchParams(historyHref('abc 123').split('?')[1]);
    expect([p.get('view'), p.get('hash'), p.get('def')]).toEqual(['history', 'abc 123', 'def-0001']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/history.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/History/HistoryView.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/History/lines.ts`:

```ts
import {
  type Cabin,
  type Cell,
  cellKeyString,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type IsoDateTime,
  type Provenance,
  type ProviderId,
  type ProvidersConfig,
  type SourceKind,
} from '@gmt/core';
import type { ItineraryHistoryResponse, RouteHistoryResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { sourceLabelOf } from '../../lib/sources.js';
import { dateMs, instantMs } from '../../lib/time.js';

type CalendarFetchPoint = RouteHistoryResponse['calendarSeries'][number]['points'][number];
type OfferPoint = ItineraryHistoryResponse['series'][number]['points'][number];
/** A point of Google's indicative route-level series: no cabin, so no full provenance (spec §11); plotted by date. */
export type RoutePoint = RouteHistoryResponse['routeSeries'][number]['points'][number];

/** A fetch-time point: a price with its provenance, or a gap that breaks the line. Priced points always carry provenance. */
export type PlotPoint =
  | {
      kind: 'price';
      t: number;
      at: IsoDateTime;
      pricePence: number;
      provenance: Provenance;
      stale: boolean;
      truncated: boolean;
      /** The pair's cheapest cell at that run (calendar series); null for offers. */
      cell: Cell | null;
      /** True when the cell differs from the previous point's: the line then joins different date pairs. */
      cellChanged: boolean;
      /** False for an offer whose price the final step did not confirm (plan decisions 27, 37). */
      priceConfirmed: boolean;
    }
  | { kind: 'gap'; t: number; pricePence: null };

/** One fetch-time series (spec §11 History: one series per provider and kind). */
export interface PlotLine {
  key: string;
  kind: 'calendar' | 'offer' | 'offer-unconfirmed';
  providerId: ProviderId;
  name: string;
  points: PlotPoint[];
}

/** A route-level point: a vendor price for one travel date, or a gap for a missing date. */
export type RoutePlotPoint =
  | { kind: 'price'; t: number; pricePence: number; route: RoutePoint }
  | { kind: 'gap'; t: number; pricePence: null };

/** One route-level series, plotted by travel date in its own chart (plan decision 38). */
export interface RouteLine {
  key: string;
  providerId: ProviderId;
  cabin: Cabin | 'unknown';
  name: string;
  points: RoutePlotPoint[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Plan decision 38: two fetches connect only when they are consecutive scheduled runs, at most 1.5 refresh periods apart. */
export const CONNECT_FACTOR = 1.5;

/** A provider's refresh period: the definition's discoveryRefreshHours entry, else core's default (plan decision 21). */
export function refreshHoursOf(
  providers: Pick<ProvidersConfig, 'discoveryRefreshHours'>,
  id: ProviderId,
): number {
  return providers.discoveryRefreshHours[id] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
}

/**
 * The scheduled-run cadence that itinerary offers follow: offers are fetched by the runs' itinerary-search stage, so
 * the longest discovery refresh period of the definition, never the itinerary provider's own entry (ui-r1-020).
 */
export function runCadenceHours(
  providers: Pick<ProvidersConfig, 'discovery' | 'discoveryRefreshHours'>,
): number {
  const hours = providers.discovery.map((id) => refreshHoursOf(providers, id));
  return hours.length === 0 ? DEFAULT_DISCOVERY_REFRESH_HOURS : Math.max(...hours);
}

/** The largest gap two consecutive points may have and still be joined by a line. */
export function connectLimitMs(refreshHours: number): number {
  return refreshHours * CONNECT_FACTOR * HOUR_MS;
}

/**
 * Sorts by t and inserts a gap wherever two neighbours are more than `limitMs` apart, so the chart (connectNulls off)
 * breaks the line there. A line between two points never implies a price between them; the chart caption says so.
 */
export function withGaps<P extends { t: number }, G>(
  points: readonly P[],
  limitMs: number,
  gap: (t: number) => G,
): Array<P | G> {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Array<P | G> = [];
  let prev: number | null = null;
  for (const p of sorted) {
    if (prev !== null && p.t - prev > limitMs) out.push(gap(prev + (p.t - prev) / 2));
    out.push(p);
    prev = p.t;
  }
  return out;
}

const fetchGap = (t: number): PlotPoint => ({ kind: 'gap', t, pricePence: null });
const routeGap = (t: number): RoutePlotPoint => ({ kind: 'gap', t, pricePence: null });

/** Marks each calendar point whose cheapest cell differs from the previous point's (prov-006). */
function markCellChanges(points: PlotPoint[]): PlotPoint[] {
  let prev: string | null = null;
  return points.map((p) => {
    if (p.kind !== 'price' || p.cell === null) return p;
    const key = cellKeyString(p.cell);
    const changed = prev !== null && prev !== key;
    prev = key;
    return { ...p, cellChanged: changed };
  });
}

function sourceOf(points: ReadonlyArray<{ provenance: Provenance }>): string {
  const kinds: SourceKind[] = points.map((p) => p.provenance.sourceKind);
  return sourceLabelOf(kinds);
}

const prefixed = (pair: string | null, name: string) =>
  pair === null ? name : COPY.historyView.pairPrefix(pair, name);

/**
 * Route history (spec §11 History): the calendar series per provider at fetchedAt, one point per run (the pair's
 * minimum across its cells, carrying that cell), and the route-level series per provider and cabin by travel date.
 */
export function linesFromRoute(
  resp: RouteHistoryResponse,
  providers: Pick<ProvidersConfig, 'discoveryRefreshHours'>,
  pair: string | null = null,
): { fetch: PlotLine[]; route: RouteLine[] } {
  const H = COPY.historyView;
  const fetch: PlotLine[] = resp.calendarSeries
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const priced = s.points.map(
        (p: CalendarFetchPoint): PlotPoint => ({
          kind: 'price',
          t: instantMs(p.at),
          at: p.at,
          pricePence: p.pricePence,
          provenance: p.provenance,
          stale: p.stale,
          truncated: p.truncated,
          cell: p.cell,
          cellChanged: false,
          priceConfirmed: true,
        }),
      );
      return {
        key: `${pair ?? ''}calendar:${s.providerId}`,
        kind: 'calendar',
        providerId: s.providerId,
        name: prefixed(pair, H.calendarSeries(sourceOf(s.points))),
        points: markCellChanges(
          withGaps(priced, connectLimitMs(refreshHoursOf(providers, s.providerId)), fetchGap),
        ),
      };
    });
  const route: RouteLine[] = resp.routeSeries
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      key: `${pair ?? ''}route:${s.providerId}:${s.cabin}`,
      providerId: s.providerId,
      cabin: s.cabin,
      name: prefixed(pair, H.routeSeries),
      // why: a daily series (spec §7 route_price_history); a missing travel date breaks the line.
      points: withGaps(
        s.points.map(
          (p): RoutePlotPoint => ({ kind: 'price', t: dateMs(p.date), pricePence: p.pricePence, route: p }),
        ),
        DAY_MS,
        routeGap,
      ),
    }));
  return { fetch, route };
}

/**
 * Itinerary history: per provider and seller, one solid series of confirmed prices and one dashed series of prices
 * the final step did not confirm (plan decision 38), both at fetchedAt and joined only across consecutive runs.
 */
export function linesFromItinerary(
  resp: ItineraryHistoryResponse,
  providers: Pick<ProvidersConfig, 'discovery' | 'discoveryRefreshHours'>,
): PlotLine[] {
  const H = COPY.historyView;
  const limit = connectLimitMs(runCadenceHours(providers));
  return resp.series.flatMap((s) => {
    const toPlot = (p: OfferPoint): PlotPoint => ({
      kind: 'price',
      t: instantMs(p.at),
      at: p.at,
      pricePence: p.pricePence,
      provenance: p.provenance,
      stale: p.stale,
      truncated: p.truncated,
      cell: null,
      cellChanged: false,
      priceConfirmed: p.priceConfirmed,
    });
    const confirmed = s.points.filter((p) => p.priceConfirmed);
    const unconfirmed = s.points.filter((p) => !p.priceConfirmed);
    const lines: PlotLine[] = [];
    if (confirmed.length > 0) {
      lines.push({
        key: `offer:${s.providerId}:${s.seller}`,
        kind: 'offer',
        providerId: s.providerId,
        name: H.offerSeries(sourceOf(confirmed), s.seller),
        points: withGaps(confirmed.map(toPlot), limit, fetchGap),
      });
    }
    if (unconfirmed.length > 0) {
      lines.push({
        key: `offer-unconfirmed:${s.providerId}:${s.seller}`,
        kind: 'offer-unconfirmed',
        providerId: s.providerId,
        name: H.offerUnconfirmedSeries(sourceOf(unconfirmed), s.seller),
        points: withGaps(unconfirmed.map(toPlot), limit, fetchGap),
      });
    }
    return lines;
  });
}

/** What the cross-execution header shows (plan decision 38): how many fetches the lines span, first and last. */
export function historySpan(
  lines: readonly PlotLine[],
): { runs: number; firstAt: IsoDateTime; lastAt: IsoDateTime } | null {
  const priced = lines.flatMap((l) => l.points.flatMap((p) => (p.kind === 'price' ? [p] : [])));
  const first = priced.reduce<(typeof priced)[number] | null>(
    (a, p) => (a === null || p.t < a.t ? p : a),
    null,
  );
  const last = priced.reduce<(typeof priced)[number] | null>(
    (a, p) => (a === null || p.t > a.t ? p : a),
    null,
  );
  if (first === null || last === null) return null;
  return { runs: new Set(priced.map((p) => p.t)).size, firstAt: first.at, lastAt: last.at };
}

/** The header's stale flag: true when every series' newest point is stale. */
export function newestAllStale(lines: readonly PlotLine[]): boolean {
  const newest = lines.flatMap((l) => {
    const priced = l.points.flatMap((p) => (p.kind === 'price' ? [p] : []));
    const n = priced[priced.length - 1];
    return n === undefined ? [] : [n];
  });
  return newest.length > 0 && newest.every((p) => p.stale);
}
```

`apps/web/src/views/History/HistoryChart.tsx`:

```tsx
import { effectiveAge, formatAgeFull, type IsoDateTime } from '@gmt/core';
import { useId } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import {
  formatDayLong,
  formatDayShort,
  formatInstantDateLondon,
  formatInstantLondon,
  formatIsoDate,
  formatPence,
} from '../../format.js';
import { seriesColour } from '../../lib/palette.js';
import { dateOfMs } from '../../lib/time.js';
import type { PlotLine, PlotPoint, RouteLine, RoutePlotPoint } from './lines.js';

const H = COPY.historyView;
/** Line style backs up colour (no colour-only meaning): calendar dashed, unconfirmed offers dotted, offers solid. */
const DASH: Readonly<Record<PlotLine['kind'], string | null>> = {
  offer: null,
  calendar: '6 3',
  'offer-unconfirmed': '2 3',
};

const fetchValue = (p: PlotPoint) => p.pricePence;
const routeValue = (p: RoutePlotPoint) => p.pricePence;

/**
 * Fetch-time history (spec §11 History): one line per provider and kind on a time axis in Europe/London. A line joins
 * only consecutive scheduled runs (plan decision 38); the caption says no price was fetched between two points. No
 * tooltip: with one data array per line on a time axis a shared tooltip cannot pair points reliably, and the tables
 * below are the record of every point with its provenance.
 */
export function HistoryChart({ lines, tablesId }: { lines: readonly PlotLine[]; tablesId: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tablesId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {H.fetchChartTitle}
      </figcaption>
      <p className="text-xs">{H.connectorNote}</p>
      <div className="overflow-x-auto">
        <div className="h-80 min-w-[36rem]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 8, right: 16, bottom: 28, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                allowDuplicatedCategory={false}
                tickFormatter={(v: number) => formatInstantDateLondon(v)}
                label={{ value: H.xAxisFetched, position: 'insideBottom', offset: -16 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatPence(v)}
                label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Legend verticalAlign="top" />
              {lines.map((l, i) => {
                const dash = DASH[l.kind];
                return (
                  <Line
                    key={l.key}
                    data={l.points}
                    dataKey={fetchValue}
                    name={l.name}
                    type="linear"
                    connectNulls={false}
                    stroke={seriesColour(i)}
                    {...(dash === null ? {} : { strokeDasharray: dash })}
                    dot
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </figure>
  );
}

/**
 * Google's indicative route-level series in its own chart, price by travel date (plan decision 38): a different
 * quantity from the fetch-time lines, so never on their axis.
 */
export function RouteChart({ lines, tablesId }: { lines: readonly RouteLine[]; tablesId: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tablesId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {H.routeChartTitle}
      </figcaption>
      <p className="text-xs">{H.routeChartNote}</p>
      <div className="overflow-x-auto">
        <div className="h-64 min-w-[36rem]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 8, right: 16, bottom: 28, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                allowDuplicatedCategory={false}
                tickFormatter={(v: number) => formatIsoDate(dateOfMs(v))}
                label={{ value: H.xAxisTravelDate, position: 'insideBottom', offset: -16 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatPence(v)}
                label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Legend verticalAlign="top" />
              {lines.map((l, i) => (
                <Line
                  key={l.key}
                  data={l.points}
                  dataKey={routeValue}
                  name={l.name}
                  type="linear"
                  connectNulls={false}
                  stroke={seriesColour(i)}
                  strokeDasharray="1 2"
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </figure>
  );
}

type Priced = Extract<PlotPoint, { kind: 'price' }>;

/**
 * Every point of one fetch-time line, newest first, each price through PriceCell with its stale label, "cheapest of
 * the rows read" and its destination (spec §11); calendar points name their cheapest searched cell and flag a change of
 * cell; unconfirmed offers say the final step did not confirm the price.
 */
export function HistoryTable(props: {
  line: PlotLine;
  destination: string | undefined;
  notes: Partial<Record<string, string>>;
}) {
  const { line, destination, notes } = props;
  const points = line.points.filter((p): p is Priced => p.kind === 'price').reverse();
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="text-left font-medium">{H.tableCaption(line.name)}</caption>
        <thead>
          <tr>
            <th scope="col">{H.whenColumn}</th>
            <th scope="col">{H.priceColumn}</th>
            <th scope="col">{H.detailColumn}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => {
            const dest = p.cell?.destination ?? destination;
            return (
              <tr key={p.t}>
                <td>{formatInstantLondon(p.t)}</td>
                <td>
                  <PriceBoundary>
                    <PriceCell
                      pricePence={p.pricePence}
                      provenance={p.provenance}
                      calendar={line.kind === 'calendar'}
                      stale={p.stale}
                      truncated={p.truncated}
                      destination={dest}
                      destinationNote={dest === undefined ? null : (notes[dest] ?? null)}
                    />
                  </PriceBoundary>
                </td>
                <td>
                  {p.cell !== null ? (
                    <span className="block">
                      {H.cheapestCell(
                        p.cell.origin,
                        p.cell.destination,
                        formatDayShort(p.cell.departureDate),
                        formatDayShort(p.cell.returnDate),
                      )}
                    </span>
                  ) : null}
                  {p.cellChanged ? <span className="block font-medium">{H.cellChanged}</span> : null}
                  {!p.priceConfirmed ? (
                    <span className="block font-medium">{H.priceNotConfirmed}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every point of one route-level line. Spec §11 exempts these from full provenance (no cabin), so each row shows the
 * amount with its source, "indicative", the cabin as the vendor gave it and the fetched age, never a PriceCell.
 */
export function RouteTable({ line, now }: { line: RouteLine; now: IsoDateTime }) {
  const points = line.points.flatMap((p) => (p.kind === 'price' ? [p] : []));
  const cabin = line.cabin === 'unknown' ? H.cabinNotStated : COPY.cabinName[line.cabin];
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="text-left font-medium">{H.tableCaption(line.name)}</caption>
        <thead>
          <tr>
            <th scope="col">{H.travelDateColumn}</th>
            <th scope="col">{H.priceColumn}</th>
            <th scope="col">{H.detailColumn}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.t}>
              <td>{formatDayLong(p.route.date)}</td>
              <td>{formatPence(p.pricePence)}</td>
              <td>
                {H.routeProvenance(
                  COPY.source[p.route.sourceKind],
                  cabin,
                  formatAgeFull(effectiveAge({ fetchedAt: p.route.fetchedAt, maxAgeHours: 'unknown' }, now)),
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`apps/web/src/views/History/HistoryView.tsx`:

```tsx
import type { Iata } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useItineraryHistory, useRouteHistories } from '../../api/queries.js';
import type { DefinitionResponse, ResultRow, ResultsResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatDayLong } from '../../format.js';
import { useNow } from '../../now.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { HistoryChart, HistoryTable, RouteChart, RouteTable } from './HistoryChart.js';
import {
  historySpan,
  linesFromItinerary,
  linesFromRoute,
  newestAllStale,
  type PlotLine,
  type RouteLine,
} from './lines.js';

const H = COPY.historyView;
/** URL keys of the view's state: the itinerary hash and the chosen pair (ui-r1-016, PFT-WP10-011). */
export const HISTORY_PARAMS = { hash: 'hash', pair: 'hist.pair' } as const;
/** The overlay of every pair draws at most this many pairs, so the chart stays readable. */
export const MAX_OVERLAY_PAIRS = 6;
const ALL = 'all';

type Pair = { origin: Iata; destination: Iata };
const pairKey = (p: Pair) => `${p.origin}-${p.destination}`;

/** Link to one itinerary's history (WP9's expanded row); keeps every other URL parameter. */
export function historyHref(itineraryHash: string): string {
  return hrefWith({ view: 'history', [HISTORY_PARAMS.hash]: itineraryHash });
}

/** The Results row with this itinerary hash in any cached results response of the definition, for the heading. */
export function findCachedRow(
  entries: ReadonlyArray<readonly [unknown, ResultsResponse | undefined]>,
  hash: string,
): ResultRow | null {
  for (const [, data] of entries) {
    const row = data?.rows.find((r) => r.itineraryHash === hash);
    if (row !== undefined) return row;
  }
  return null;
}

/**
 * History (spec §11 History, §10 history routes; plan decision 38): route history by pair (or every pair overlaid),
 * itinerary history with ?hash=. Fetch-time series and Google's indicative route-level series get separate charts;
 * every point is tabled with its provenance; the header spans the runs shown.
 */
export function HistoryView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const params = useSearchParams();
  const qc = useQueryClient();
  const tablesId = useId();
  const routeTablesId = useId();
  const raw = params.get(HISTORY_PARAMS.hash);
  const hash = raw === null || raw === '' ? null : raw;
  const itineraryMode = hash !== null;
  const pairs: Pair[] = definition.origins.flatMap((origin) =>
    definition.destinations.map((destination) => ({ origin, destination })),
  );
  const pairParam = params.get(HISTORY_PARAMS.pair);
  const overlay = pairParam === ALL;
  const chosen = pairs.find((p) => pairKey(p) === pairParam) ?? pairs[0];
  const shownPairs = overlay ? pairs.slice(0, MAX_OVERLAY_PAIRS) : chosen === undefined ? [] : [chosen];
  const routes = useRouteHistories(shownPairs, definition.cabin, !itineraryMode);
  const itinerary = useItineraryHistory(hash);

  let fetchLines: PlotLine[] = [];
  let routeLines: RouteLine[] = [];
  let pending: boolean;
  let error: Error | null;
  let destination: string | undefined;
  let heading: string | null = null;
  if (hash !== null) {
    pending = itinerary.isPending;
    error = itinerary.error;
    if (itinerary.data !== undefined) fetchLines = linesFromItinerary(itinerary.data, definition.providers);
    const row = findCachedRow(
      qc.getQueriesData<ResultsResponse>({ queryKey: ['results', definition.id] }),
      hash,
    );
    destination = row?.cell.destination;
    heading =
      row === null
        ? H.itineraryUnknown(hash)
        : H.itineraryHeading(
            `${row.cell.origin}→${row.cell.destination}`,
            formatDayLong(row.cell.departureDate),
            formatDayLong(row.cell.returnDate),
            row.carriers.join(', '),
          );
  } else {
    pending = routes.some((r) => r.isPending);
    error = routes.find((r) => r.error !== null)?.error ?? null;
    routes.forEach((r, i) => {
      const pair = shownPairs[i];
      if (r.data === undefined || pair === undefined) return;
      const lines = linesFromRoute(r.data, definition.providers, overlay ? pairKey(pair) : null);
      fetchLines = [...fetchLines, ...lines.fetch];
      routeLines = [...routeLines, ...lines.route];
    });
  }
  const span = historySpan(fetchLines);
  const notes = definition.destinationNotes;

  return (
    <section aria-label={H.title} className="flex flex-col gap-4">
      <ViewHeader title={H.title} span={span} stale={newestAllStale(fetchLines)} />
      {hash !== null ? (
        <div>
          <p className="font-medium">{heading}</p>
          <p className="text-xs">{H.itineraryHash(hash)}</p>
          <a
            href={hrefWith({ [HISTORY_PARAMS.hash]: null })}
            onClick={navigateTo({ [HISTORY_PARAMS.hash]: null })}
            className="underline"
          >
            {H.backToRoute}
          </a>
        </div>
      ) : (
        <label className="flex flex-col text-sm">
          {H.routePicker}
          <select
            value={overlay ? ALL : chosen === undefined ? '' : pairKey(chosen)}
            onChange={(e) => updateSearchParams({ [HISTORY_PARAMS.pair]: e.target.value }, 'replace')}
            className="rounded border px-2 py-1"
          >
            {pairs.map((p) => (
              <option key={pairKey(p)} value={pairKey(p)}>
                {H.pairOption(p.origin, p.destination)}
              </option>
            ))}
            <option value={ALL}>{H.allPairs(Math.min(pairs.length, MAX_OVERLAY_PAIRS), pairs.length)}</option>
          </select>
        </label>
      )}
      {pending ? (
        <p role="status">{COPY.loading}</p>
      ) : error !== null ? (
        <p role="alert">{COPY.loadFailed(error.message)}</p>
      ) : fetchLines.length === 0 && routeLines.length === 0 ? (
        <p>{H.empty}</p>
      ) : (
        <>
          {fetchLines.length > 0 ? (
            <>
              <HistoryChart lines={fetchLines} tablesId={tablesId} />
              <div id={tablesId} className="flex flex-col gap-3">
                {fetchLines.map((l) => (
                  <HistoryTable key={l.key} line={l} destination={destination} notes={notes} />
                ))}
              </div>
            </>
          ) : null}
          {routeLines.length > 0 ? (
            <>
              <RouteChart lines={routeLines} tablesId={routeTablesId} />
              <div id={routeTablesId} className="flex flex-col gap-3">
                {routeLines.map((l) => (
                  <RouteTable key={l.key} line={l} now={now} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/history.test.tsx test/copy`
Expected: PASS. The history file passes 18 tests. Mutation check, once: set `connectNulls` on the fetch-time `Line` to `true`; "breaking only between runs" must fail (one `M`, not two). Restore it.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: history with fetch-time and indicative route-level charts, run-to-run joins, unconfirmed offers dashed"
```

### Task 10.13: Wire the views into WP9's shell, and link Results to history

**Files:**
- Create: `apps/web/test/app/wp10Wiring.test.tsx`
- Modify (WP9): `apps/web/src/App.tsx`, `apps/web/src/views/Results/ExpandedRow.tsx`, `apps/web/test/app/shell.test.tsx`

**Interfaces:**
- Consumes: `App`, `ExpandedRow`, `COPY.placeholder`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`, `historyHref`, `HISTORY_PARAMS`, `navigateTo`.
- Produces: the Calendar, Duration and History views behind WP9's nav; the "price history" link on expanded rows that have an itinerary hash.

The wiring test renders each view through `App` on the default handlers, asserts it drew its real content (a grid and legend; a chart figure and table; both history charts), checks that WP9's placeholder text is gone using `COPY.placeholder('WP10')` itself, and sweeps the rendered copy for banned words.

- [ ] **Step 1: Write the failing test**

`apps/web/test/app/wp10Wiring.test.tsx`:

```tsx
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { COPY } from '../../src/copy.js';
import { ExpandedRow } from '../../src/views/Results/ExpandedRow.js';
import { calendarRow, verifiedRow } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

/** Visible text plus the attributes a screen reader or tooltip shows (the same reach as WP9's sweep). */
function renderedCopy(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label]')].flatMap((el) => [
    el.getAttribute('title') ?? '',
    el.getAttribute('aria-label') ?? '',
  ]);
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

// The default msw handlers (test/msw/wp10Handlers.ts) serve every WP10 route, so these views render real content.
describe('WP10 views in the shell: no placeholder left, real content, no banned word (spec §11, §9 item 6)', () => {
  it('?view=calendar renders the calendar grid, legend and a priced day', async () => {
    const { findByRole, getByTestId, queryByText } = renderWithProviders(<App />, {
      search: '?view=calendar&def=def-0001',
    });
    expect(await findByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
    expect(getByTestId('calendar-legend')).toBeInTheDocument();
    expect(getByTestId('day-price-block')).toHaveTextContent('£412');
    expect(queryByText(COPY.placeholder('WP10'))).toBeNull();
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST)).toEqual([]);
  });

  it('?view=duration renders the chart figure and the table', async () => {
    const { findByRole, getByRole, queryByText } = renderWithProviders(<App />, {
      search: '?view=duration&def=def-0001',
    });
    expect(await findByRole('figure', { name: 'Cheapest found by stay length' })).toBeInTheDocument();
    expect(
      getByRole('table', { name: 'Cheapest found per stay length, with provenance' }),
    ).toBeInTheDocument();
    expect(queryByText(COPY.placeholder('WP10'))).toBeNull();
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST)).toEqual([]);
  });

  it('?view=history renders both charts and their tables', async () => {
    const { findByRole, getByRole, queryByText } = renderWithProviders(<App />, {
      search: '?view=history&def=def-0001',
    });
    expect(await findByRole('figure', { name: 'Price by fetch date' })).toBeInTheDocument();
    expect(
      getByRole('figure', { name: "Google's indicative route-level series: price by travel date" }),
    ).toBeInTheDocument();
    expect(queryByText(COPY.placeholder('WP10'))).toBeNull();
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST)).toEqual([]);
  });

  it('an expanded Results row with an itinerary links to its history; a calendar row does not', () => {
    const first = renderWithProviders(
      <ExpandedRow
        row={verifiedRow({ itineraryHash: 'abc123' })}
        extras={false}
        verificationConfigured
        definitionId="def-0001"
      />,
      {
        search: '?view=results&def=def-0001',
      },
    );
    const href = first.getByRole('link', { name: 'price history' }).getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect([params.get('view'), params.get('hash'), params.get('def')]).toEqual([
      'history',
      'abc123',
      'def-0001',
    ]);
    first.unmount();
    const second = renderWithProviders(
      <ExpandedRow row={calendarRow()} extras={false} verificationConfigured definitionId="def-0001" />,
    );
    expect(second.queryByRole('link', { name: 'price history' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/app/wp10Wiring.test.tsx`
Expected: FAIL, 4 of 4: the three view tests time out on `findByRole` (the placeholder renders instead), and the link test fails with `Unable to find an accessible element with the role "link" and name "price history"`.

- [ ] **Step 3: Implement**

`apps/web/src/App.tsx`: import the three views, widen `needsDefinition` and replace the WP10 placeholder line:

```tsx
import { CalendarView } from './views/Calendar/CalendarView.js';
import { DurationView } from './views/Duration/DurationView.js';
import { HistoryView } from './views/History/HistoryView.js';

const needsDefinition =
  view === 'results' || view === 'coverage' || view === 'calendar' || view === 'duration' || view === 'history';

// in place of {view === 'calendar' || view === 'duration' || view === 'history' ? <Placeholder wp="WP10" /> : null}
{view === 'calendar' && selected !== null ? (
  // why: a new definition starts with no panel open and its own filter defaults.
  <CalendarView key={selected.id} definition={selected} />
) : null}
{view === 'duration' && selected !== null ? <DurationView definition={selected} /> : null}
{view === 'history' && selected !== null ? <HistoryView definition={selected} /> : null}
```

WP9's `Placeholder` stays for Alerts (WP11 replaces it).

`apps/web/src/views/Results/ExpandedRow.tsx`: import `navigateTo` from `../../state/urlState.js` and `HISTORY_PARAMS`, `historyHref` from `../History/HistoryView.js`, and after `<SearchLink link={row.searchLink} />` add:

```tsx
        {row.itineraryHash !== null ? (
          <a
            href={historyHref(row.itineraryHash)}
            onClick={navigateTo({ view: 'history', [HISTORY_PARAMS.hash]: row.itineraryHash })}
            className="block underline"
          >
            {COPY.historyView.rowLink}
          </a>
        ) : null}
```

`apps/web/test/app/shell.test.tsx`: in "nav lists every view and keeps filters when switching", replace the placeholder assertion after the Calendar click with

```ts
    // why: WP10 replaced the placeholder; the default msw handlers serve the calendar.
    expect(await screen.findByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
```

and delete the test "Duration and History are WP10 placeholders" (the wiring test covers both views).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/app test/copy test/views test/components test/lib test/tz`
Expected: PASS: the wiring file 4 tests, WP9's shell, copy (catalogue, source guard, rendered sweep over every view, which now meets the real WP10 views) and every view test.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar, duration and history in the shell; results link to itinerary history"
```

### Task 10.14: Playwright smoke in fixture mode (spec §9 item 6)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/prepare-db.mjs`
- Modify (WP9): `apps/web/vite.config.ts` (proxy target), `apps/web/tsconfig.json` (`include`); root `.gitignore`

**Interfaces:**
- Consumes: `pnpm --filter @gmt/api start` (WP8); fixture mode per spec §5.5 (WP4b's wiring reaches the fixture host through http-kit's gated `inProcessHosts`, plan decision 7); WP9's `COPY`, the Definitions form's checkbox ids `p-d-<providerId>` and `p-v-<providerId>`, and the Results headline "cheapest found £…".
- Produces: `pnpm --filter @gmt/web e2e`, excluded from `pnpm test` (vitest `exclude: ['e2e/**']`; the root runs vitest only).

The smoke drives the real api in fixture mode and the built SPA through `vite preview`, whose proxy is WP9's `server.proxy` pointed at `GMT_API_ORIGIN`. The api environment meets `syntheticAllowed` (spec §5.5): `NODE_ENV=development`, `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake`, a `.fixture.db` path, no `IN_CONTAINER`; it binds loopback (no auth, spec §4), disables auto-resume and raises the confirmation threshold so the run starts without a cost prompt. The desktop project runs the whole flow: Results headline and banner, then the Calendar (a grid, a priced day with the synthetic badge, the legend, a computed `outline-style` on the focused day), the Duration figure and table, and History's fetch-time figure and table, each naming the synthetic source. The phone project (375 × 812, after the desktop one) checks one month, the month buttons, the legend and no horizontal page scroll.

- [ ] **Step 1: Write the failing test**

`apps/web/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { COPY } from '../src/copy.js';

// Spec §9 item 6: one Playwright smoke in fixture mode, through the real api and the built SPA. Every price here is
// synthetic, and every view must say so beside the red banner (spec §5.5).
test('fixture mode: import, run, then Results, Calendar, Duration and History show synthetic prices with provenance', async ({
  page,
}) => {
  await page.goto('/?view=definitions');
  await page.getByRole('button', { name: COPY.importExample }).click();
  // why: the example JSON names the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const prefix of ['p-d-', 'p-v-']) {
    for (const box of await page.locator(`input[type="checkbox"][id^="${prefix}"]`).all())
      await box.uncheck();
    await page.locator(`#${prefix}fixture`).check();
  }
  await page.getByRole('button', { name: /^Create and confirm up to/ }).click();
  await page.getByRole('button', { name: COPY.runNow }).click();

  const headline = page.getByText(/^cheapest found £\d/);
  await expect(async () => {
    await page.goto('/?view=results');
    await expect(headline).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(headline).toContainText(COPY.source.synthetic);
  await expect(headline).toContainText(/ago|just now/);
  const banner = page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/bg-red-700/);

  // View B: a real grid, a priced day carrying the synthetic badge, visible focus in a real browser.
  await page.goto('/?view=calendar');
  await expect(page.getByRole('grid').first()).toBeVisible();
  const priced = page.locator('[data-testid="day-price-block"]').first();
  await expect(priced).toContainText(COPY.providerShort.fixture);
  await expect(page.getByTestId('calendar-legend')).toBeVisible();
  await expect(banner).toBeVisible();
  await page.locator('td[role="gridcell"][tabindex="0"]').focus();
  await expect(page.locator('td[role="gridcell"][tabindex="0"]')).toHaveCSS('outline-style', 'solid');

  // View C and History: the charts draw in a real layout and their tables name the synthetic source.
  await page.goto('/?view=duration');
  await expect(
    page.getByRole('figure', { name: COPY.durationView.chartTitle }).locator('svg[role="application"]'),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: COPY.durationView.tableCaption })).toContainText(
    COPY.source.synthetic,
  );
  await page.goto('/?view=history');
  await expect(
    page.getByRole('figure', { name: COPY.historyView.fetchChartTitle }).locator('svg[role="application"]'),
  ).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText(COPY.source.synthetic);
});

test('at 375px the calendar shows one month as a compact grid with no horizontal page scroll @phone', async ({
  page,
}) => {
  await page.goto('/?view=calendar');
  await expect(page.getByRole('grid')).toHaveCount(1);
  await expect(page.getByRole('button', { name: COPY.calendarView.nextMonth })).toBeVisible();
  await expect(page.getByTestId('calendar-legend')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('[data-testid="day-price-block"]').first()).toContainText(
    COPY.providerShort.fixture,
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web e2e`
Expected: FAIL: Playwright reports `Error: No tests found` (or a config load error) because `playwright.config.ts` does not exist yet.

- [ ] **Step 3: Implement**

`apps/web/e2e/prepare-db.mjs`:

```js
#!/usr/bin/env node
// Prepares a fresh database for the fixture-mode smoke. Spec §5.5: fixture mode needs a path ending in .fixture.db,
// and the api realpath-resolves it at boot, so the directory must exist first. Run by the api webServer command.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DATABASE_PATH;
if (!path?.endsWith('.fixture.db')) {
  console.error('prepare-db: DATABASE_PATH must be set and end in .fixture.db');
  process.exit(1);
}
mkdirSync(dirname(path), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
```

`apps/web/playwright.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Spec §9 item 6: one smoke in fixture mode, run on a desktop browser and at the 375px phone width (ui-r1-014).
// Excluded from `pnpm test`; run with `pnpm --filter @gmt/web e2e`.
const API_PORT = 3100;
const WEB_PORT = 4173;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const DB_PATH = fileURLToPath(new URL('./e2e/.tmp/smoke.fixture.db', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env.CI === 'true',
  reporter: [['list']],
  use: { baseURL: WEB_ORIGIN, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    // why: the phone project only checks layout on the run the desktop project made (it depends on it).
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
      dependencies: ['desktop'],
      grep: /@phone/,
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node e2e/prepare-db.mjs && pnpm --filter @gmt/api start',
      url: `${API_ORIGIN}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: {
        // spec §5.5 fixture gate: development + the exact opt-in phrase + a .fixture.db path + not in a container
        NODE_ENV: 'development',
        ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake',
        DATABASE_PATH: DB_PATH,
        IN_CONTAINER: '',
        PORT: String(API_PORT),
        BIND_ADDRESS: '127.0.0.1',
        // why: the preview proxy keeps the browser's Host (no changeOrigin), so the api must allow the preview origin too.
        ALLOWED_HOSTS: `127.0.0.1:${API_PORT},127.0.0.1:${WEB_PORT}`,
        APP_BASE_URL: WEB_ORIGIN,
        APP_BASIC_AUTH_USER: '',
        APP_BASIC_AUTH_PASS: '',
        TRAVELPAYOUTS_TOKEN: '',
        SEARCHAPI_KEY: '',
        SMTP_HOST: '',
        AUTO_RESUME: 'false',
        SOFT_CONFIRM_PENCE: '100000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      name: 'web',
      command: `pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { GMT_API_ORIGIN: API_ORIGIN },
    },
  ],
});
```

`apps/web/vite.config.ts` (WP9): add above `defineConfig`

```ts
/**
 * The api the dev and preview servers proxy /api to. The Playwright smoke (WP10) points the preview at its own
 * fixture-mode api with GMT_API_ORIGIN; dev keeps the default. preview.proxy inherits server.proxy.
 */
const API_ORIGIN = process.env.GMT_API_ORIGIN ?? 'http://localhost:3000';
```

and set the proxy entry to `proxy: { [API_PREFIX]: { target: API_ORIGIN } },`. Nothing else in the file changes.

`apps/web/tsconfig.json` (WP9): add `"e2e"` and `"playwright.config.ts"` to `include`, so `pnpm -r typecheck` covers the smoke and its config under the same strict rules.

Root `.gitignore`: add

```
apps/web/test-results/
apps/web/playwright-report/
apps/web/e2e/.tmp/
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web e2e:install` (once per machine)
Expected: Chromium downloaded.

Run: `pnpm --filter @gmt/web e2e`
Expected: the workspace builds, both servers start, and the reporter prints `2 passed` (desktop, then phone).

Run: `pnpm -r typecheck`
Expected: clean, including `e2e/smoke.spec.ts` and `playwright.config.ts`.

Run: `pnpm test`
Expected: no file under `apps/web/e2e/` is listed.

- [ ] **Step 5: Commit**

```bash
git add apps/web .gitignore && git commit -m "wp10: Playwright smoke in fixture mode across Results, Calendar, Duration, History and 375px (spec §9 item 6)"
```

## 9. Pinned review-focus tests

- **Review focus 3** (plan: "The browser runs outside Europe/London … a day never shifts by one. Owner: WP10"):
  - **Task 10.10**, `test/tz/dates.tz.test.tsx`, under `America/Los_Angeles` and `Asia/Tokyo`, in-process per `describe.each` block and as whole processes via `pnpm --filter @gmt/web run test:tz` (`GMT_TEST_TZ` copied to `process.env.TZ` in `test/setup-tz.ts`). In each zone: the zone took effect; the negative control shows a naive `Date` moves the day (and, west of Greenwich, mislabels the US DST day); the US and UK DST days and the leap day keep their date and weekday; the calendar grid puts each day under its own weekday and month; WP9's Results renders departure and return from their strings. A recorded manual mutation turns the suite red.
  - **Task 10.2**, `test/lib/noDateParsing.test.ts`, fails on any `new Date(`, `Date(`, `Date.parse(`, `Date.UTC(`, `Date.now(`, local date getter, `toLocale*String(` or date-library import anywhere in `apps/web/src` outside `lib/time.ts` and `now.tsx`, scanning whole files with comments blanked; its positive cases (including a call split across lines) keep it from being vacuous.

## 10. Definition of done

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/core test` | Every core test passes at core's 100% thresholds, including `test/api-contract/wp10.test.ts`. |
| `pnpm --filter @gmt/web test` | Every web test passes. Coverage meets the package floors (lines, functions, statements ≥ 70%, branches ≥ 60%) and the WP10 floors on `src/lib/**` and `src/views/{Calendar,Duration,History}/*.ts` (lines, functions, statements ≥ 95%, branches ≥ 85%). Then `test:tz` prints two passing runs (Los Angeles, Tokyo). |
| `pnpm test` | The root run passes and lists no `e2e/` file. |
| `pnpm --filter @gmt/web exec vitest run test/copy` | PASS: catalogue (every new function sampled, no banned word, "verified" only on allowed paths), source guard, rendered sweep over every view. |
| `pnpm --filter @gmt/web exec vitest run test/lib/noDateParsing.test.ts` | PASS. |
| `pnpm --filter @gmt/web e2e` | `2 passed`. |
| `pnpm lint` | Biome reports no errors. |
| `pnpm -r typecheck` | Clean, including `@gmt/db` (its `HistoryPoint` is unchanged), the web tests, `e2e/` and `playwright.config.ts`. |
| `pnpm boundaries` | Exit 0: `@gmt/web` imports only `@gmt/core` among workspace packages; no `process.env` under `apps/web/src`; no airport literal in `apps/web/src` outside `example.ts`. |
| `grep -rnE '\bas [A-Z(]' <the files of §7 Create>` | No line (no casts; WP10 uses only `as const` and `satisfies`). |

**Assembly record (2026-10-15, scratch worktree of `main` at `d4256d5`).** The brief's code was applied on top of a snapshot of WP9's assembled shell, with WP9's pending revisions stubbed as §4 marks them (★: `ViewHeader`'s union, `formatIsoDateShort`, `COPY.truncatedNote`, `priceCellSchema.truncated` and `PriceCell`'s `truncated`). Tasks 10.1–10.13 ran in order; each red step failed as quoted (Task 10.1: 4 of 4 against `main`'s `results.ts`). Final state: `pnpm -r typecheck` exit 0; `pnpm lint` clean (461 files); `pnpm boundaries` exit 0; `pnpm --filter @gmt/core test` 721 tests at 100%; `pnpm --filter @gmt/db test` 263 tests; `pnpm --filter @gmt/web test` 30 files, 233 tests (WP10's 15 files hold 133 of them), coverage 93.6% lines and 83.8% branches overall, every WP10 floor met, then `test:tz` 80 tests in each zone. Task 10.14 was type-checked and linted but not run: WP8's api is not on `main`. Four WP9 issues surfaced on the way and were patched only in the scratch copy; they are WP9's to fix (§11).

## 11. Open questions

None for WP10. Four WP9 items surfaced in assembly, for the WP9 author (not WP10 work): `test/setup.ts` passes `onUnhandledRequest`, which msw 3 does not have (it is `onUnhandledFrame`, so unhandled requests currently only warn); `test/copy/sourceGuard.test.ts` and `test/api/client.test.ts` (through `vite.config.ts`'s `CORE_SRC`) call `fileURLToPath(new URL(…, import.meta.url))`, which throws under jsdom, where `import.meta.dirname` works; `test/views/results/expanded.test.tsx`'s other-offer literal lacks `notSeenInLatest`; `ClassBadge`, `Provenance`'s FX span and `form.test.tsx`'s `valueOf` fail Biome (`useAriaPropsSupportedByRole`, `noShadowRestrictedNames`). The ★ names in §4 are the ones WP10 calls; if WP9's revision names them differently, only the import sites change.

## 12. Changes outside WP10's own files

- `packages/core/src/api-contract/results.ts` (Task 10.1): the plan decision 38 fields, plus `priceConfirmed` and `verify`, which §13 asks the plan to record.
- WP9's `src/format.ts` (Task 10.2): the weekday, month and instant forms.
- WP9's `src/api/{types,endpoints,queries}.ts`, `src/copy.ts`, `test/msw/handlers.ts`, `test/copy/catalogue.test.ts` (Task 10.3): WP10 routes and hooks, `useExecutionActions`' refresh list, copy, default handlers, SAMPLES and the "verified" allowlist.
- WP9's `src/components/{PriceCell,Provenance}.tsx` (Task 10.4): the `compact` form.
- WP9's `vitest.config.ts` and `package.json` (Task 10.10): `pool: 'forks'`, `exclude`, `setupFiles`, glob floors; `test`, `test:tz`, `e2e`, `e2e:install`.
- WP9's `src/App.tsx`, `src/views/Results/ExpandedRow.tsx`, `test/app/shell.test.tsx` (Task 10.13).
- WP9's `vite.config.ts`, `tsconfig.json`, and the root `.gitignore` (Task 10.14).

## 13. For the plan and the WP8 brief (not yet recorded there)

1. **WP8 fills WP10's contract fields** (decision 38 names the first three; these are the rules WP8 needs):
   - `durationAnalysisResponseSchema.byNights[]`: `minVerified` and `minCalendar[].price` carry the `cell` of the minimum; `n` is the number of cells of that nights value with a class-verified price (verified) or that the provider priced (calendar); `searched.verification` is true when any verification outcome of that nights value is `priced`, `empty` or `no_data`; `searched.discovery[]` lists every discovery provider of the definition with the same rule for its own outcomes.
   - `historyPointResponseSchema`: `stale` by the same §8.1 rule as any price of its kind (`STALE_AFTER_HOURS` for offers; `discoveryRefreshHours + maxAgeHours` for calendar points); `truncated` as for price cells (decision 36).
   - Not yet in the plan: `priceConfirmed` on itinerary history points (the stored observation's step-3 confirmation, decisions 27 and 37), and `cellDetailResponseSchema.verify` (`maxCalls`: the child cap WP7 would give the cell now, decision 25; `providers[].monthCallsLeft`: each verification provider's provider-month cap minus its calls, `null` when uncapped; `null` without a verification provider). `verify` needs a WP7 dry-run of `childMaxCalls` over `estimateStart` that WP8 can call; WP7's brief does not expose one yet.
2. **Per-destination coverage and stay on a filtered day.** `calendarDaySchema.byDestination[]` carries prices only, so a filtered day can show neither that destination's glyphs and coverage nor the stay of its price; WP10 says "coverage counts cover all destinations" and "stay: see panel" instead (decision 38's fallback). Adding `discovery` buckets and `cell` to each `byDestination` entry (WP0 contract, WP8) would let the filter show both.
3. **Spec wording at the next revision:** §9 item 6 and the §16 table say "five-way" day marker where §3 defines six buckets; §11 View B's glyph list gains `skipped`, and its quintile scale gains the flat cases (decision 38); §11 History gains the separate route-level chart and the run-to-run join rule; §11's "provenance on every price, visible without hover" gains decision 38's calendar-day form (badge, compact age, dashed outline and destination on the day; source in words, "constraints not checked" and the note in the title, screen-reader text and the panel).
