---
wp: 10
title: "web: Calendar (View B), Duration (View C), History, Playwright smoke"
owner: sonnet
depends_on: [9]
spec_sections: ["§11 View B", "§11 View C", "§11 History", "§11 Accessibility", "§8.1 Staleness per price", "§3", "§10", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, ui-reviewer, persona-flexible-traveller, provenance-auditor, product-owner]
status: draft
---

# WP10 — web: Calendar (View B), Duration (View C), History, Playwright smoke

Reconciled on 2026-10-14 against spec revision 10, the plan's contracts v2 ("API contract", "Web", "Decisions taken at reconciliation") and the WP9 draft brief (`docs/briefs/wp09-web-shell-definitions-results.md`).

## 1. Goal

Replace WP9's three WP10 placeholders with:

- the calendar heatmap (View B),
- the price-by-stay-length chart (View C),
- the price history view.

On all three, every price carries provenance (except the route-level series that spec §11 exempts), unsearched never looks like "no flights", and the browser's timezone never shifts a date. WP10 also adds one Playwright smoke that drives the real api in fixture mode.

## 2. Scope

**In**

- **View B Calendar** (`apps/web/src/views/Calendar/*`):
  - Each day shows one price, chosen by the §11 precedence with the §8.1 staleness flags and core's `compareAges`.
  - Days are coloured client-side by one basis at a time on a quintile scale; days showing the other basis are hatched. The legend is numeric.
  - Days without a price show distinct glyphs with text.
  - Each day shows the five-way discovery marker and the itinerary-search line; the header shows the reused count.
  - A per-destination filter.
  - Keyboard: an APG grid with arrows, Enter and visible focus.
  - A side panel shows one cell's outcomes and prices and the per-cell verify action. Verify is hidden without a verification provider.
- **View C Duration** (`apps/web/src/views/Duration/*`):
  - Recharts 3 bars per nights: the verified series and one calendar series per provider.
  - `n` appears in the legend label and in the tooltip.
  - Nights the api flags as not searched are gaps (no interpolation) and are labelled "not searched". Nights that were searched but have no price are labelled differently.
  - Axis titles; loading, empty and error states; a data table with provenance.
- **History** (`apps/web/src/views/History/*`):
  - Route history (`GET /api/routes/:origin/:destination/history`): calendar series plotted by `at` (fetchedAt), plus the route-level series plotted by its own `date` and labelled "Google's route-level lowest price, cabin unknown".
  - Itinerary history (`GET /api/itineraries/:hash/history`): one offer series per provider and seller.
  - Gaps, axis titles, an empty state, and tables with provenance.
- **Review focus 3** (dates):
  - `src/lib/isoDate.ts` renders `YYYY-MM-DD` with no `Date`.
  - `src/lib/time.ts` holds the instant helpers.
  - A grep guard over `apps/web/src`.
  - A TZ suite under `America/Los_Angeles` and `Asia/Tokyo`, covering the calendar grid and WP9's Results date columns.
- **Copy:** `COPY.calendarView`, `COPY.durationView` and `COPY.historyView` in WP9's `src/copy.ts`, with their entries in WP9's catalogue test.
- **API wiring:** typed endpoints and query keys for the five WP10 routes, added to WP9's `api/types.ts`, `api/endpoints.ts` and `api/queries.ts`.
- **Shell wiring:** the three views go into WP9's `App.tsx` in place of `<Placeholder wp="WP10" />`, and a "price history" link goes into WP9's `ExpandedRow`.
- **Playwright smoke in fixture mode:** `apps/web/playwright.config.ts`, `apps/web/e2e/*` and the `e2e` script. It is excluded from `pnpm test`.

**Out**

- **WP9:** shell, nav, definition selector, status bar, `ViewHeader`, `Provenance`, `PriceCell`, `PriceBoundary`, `call`/`findRoute`/`api`, `COPY` base entries, `NowContext`/`useNow`, `format.ts`, URL state, Definitions form, Results (View A), Coverage (View D), Providers, and the msw test API (`test/msw/*`, `test/fixtures.ts`, `test/render.tsx`). WP10 edits only the WP9 files named in §7.
- **WP8:** every route, the `stale` and `ageHours` computation, the `searched` flag, and the in-process fixture host (wired by WP4b in fixture mode).
- **WP0:** response schemas in `core/api-contract/results.ts`. **WP0/WP1:** `effectiveAge`, `compareAges`, `formatAge*`, `formatDuration`, `toEpochDay`, `addDays`, `daysBetween`, `monthOf` and `cellKeyString`.
- **WP11:** the Alerts view.

## 3. Spec sections

- **§11 View B:**
  - Precedence: a fresh class-verified price, else the fresher of a stale verified price and the cheapest calendar price (unknown age loses), else glyphs.
  - Colour by one basis at a time on a quintile scale over the visible days of that basis. Fallback days are hatched, excluded from the scale, and named in the legend.
  - Marker text "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M", and "itinerary-searched K of N selected +C on demand" separately.
  - Distinct glyphs for `empty`, `no_data`, `error` and `not_run`; a numeric legend; a per-destination filter; a side panel with cells, outcomes and verify.
- **§11 View C:** bars per nights with axis titles (nights, £); the series "min among verified (class verified, n=…)" and calendar per provider; `n` in label and tooltip; explicit empty and loading states; gaps for unsearched nights; no interpolation.
- **§11 History:** one series per provider and kind. x is `fetchedAt` for provider series and the point's own `date` for the route-level series. Gaps, reused rows excluded (by the api), axis titles, empty state.
- **§11 vocabulary and provenance:**
  - Calendar source names: "Google date grid via SearchApi" and "Aviasales cache"; the verified basis is labelled "itinerary-search basis".
  - Provenance on every price is visible without hover. Calendar prices get a dashed outline and "constraints not checked". The destination and the operator's note are shown.
  - Accessibility: keyboard-operable calendar, visible focus, no colour-only meaning.
- **§8.1 staleness:** `stale` per price comes from the api (`STALE_AFTER_HOURS` for verified, `discoveryRefreshHours + maxAgeHours` for calendar). Stale prices are labelled, never hidden. Unknown age loses to known; ties go to verified.
- **§3:** six buckets summing to M; reused counted inside its bucket with "(R reused from earlier runs)"; "verified" reserved for the class; stage counts say "itinerary-searched".
- **§10:** calendar, duration-analysis, cells, `/cells/verify`, itinerary history and route history, all under `/api`.
- **§9 item 6:**
  - View B states, including the partial-day five-way marker and the per-basis colour scale with hatched fallback days.
  - Chart empty and loading states, the numeric legend, and keyboard operation.
  - Banned words via the catalogue; a price lacking provenance fails to render.
  - One Playwright smoke in fixture mode.

## 4. Interfaces consumed

### From the plan's "Cross-package contracts" (verbatim)

```ts
// types/ids.ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const isoDateTimeSchema: z.ZodType<IsoDateTime, string>; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ and Date.parse round-trips
export function asIata(s: string): Iata;           // throws on mismatch; tests and seeds only
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;
// types/provenance.ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}
// types/definition.ts
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
// types/execution.ts
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }
// core domain (WP1)
export function toEpochDay(d: IsoDate): number; export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number /* b − a */; export function monthOf(d: IsoDate): IsoMonth;
// labels/age.ts (Task 0.7 + the settled maxAgeHours-0 rule)
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;   // bounded with maxAgeHours 0 → "fetched 5h ago"
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;  // < 0 when a is fresher; unknown loses to any known
```

API contract (`results.ts`, contracts v2, verbatim):

```ts
calendarDaySchema { date: IsoDate /* departure date */; discovery: Array<{ providerId; buckets: Buckets; total }>; verification: { selected; itinerarySearched; onDemand };
  cheapestVerified: (PriceCell & { cell: Cell; itineraryHash: string }) | null; cheapestPartiallyVerified: (PriceCell & { cell: Cell; itineraryHash: string; count: number }) | null;
  cheapestCalendar: (PriceCell & { cell: Cell }) | null; byDestination: Array<{ destination: Iata; cheapestVerified: PriceCell | null; cheapestCalendar: PriceCell | null }> }
calendarResponseSchema { days: CalendarDay[]; executions: ExecutionSummary[]; staleAfterHours: number; calendarStaleAfterHours: Record<ProviderId, number> }
durationAnalysisResponseSchema { byNights: Array<{ nights: number; minVerified: (PriceCell & { n: number }) | null; minCalendar: Array<{ providerId; price: PriceCell; n: number }>; searched: boolean }>; executions: ExecutionSummary[] }
cellDetailResponseSchema { cell: Cell; outcomes: CellOutcome[]; calendarPrices: Array<PriceCell & { executionId; calendarPriceId }>; observations: Array<ResultRow> }
historyPointSchema { at: IsoDateTime; pricePence; provenance: Provenance }
routeSeriesPointSchema { date: IsoDate; pricePence; fetchedAt: IsoDateTime; providerId; sourceKind }   // no cabin, so no full provenance; plotted by date
itineraryHistoryResponseSchema { itineraryHash; series: Array<{ providerId; seller; cabin; points: HistoryPoint[] }> }
routeHistoryResponseSchema { origin; destination; calendarSeries: Array<{ providerId; cabin; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> /* one point per execution fetch: the pair's minimum across its cells */; routeSeries: Array<{ providerId; cabin: Cabin | 'unknown'; points: RouteSeriesPoint[] }> }
routeHistoryQuerySchema { cabin?: Cabin }
// core (plan decision 15): export function formatPence(pence: number): string; export const CONSTRAINT_LABELS: Record<ConstraintName, string>; searchLink is nullable on synthetic rows
executionSummarySchema { id, status, isChild, startedAt, finishedAt, ageHours }   // newest first
verifyCellRequestSchema { definitionId, cell: CellKey } → startExecutionResponseSchema { executionId }
```

Every route lives under `/api`, and `ROUTES` paths include the prefix. `byDestination` carries only prices. The discovery counts and the itinerary-search line stay day-level for every destination, so a filtered day says "counts cover all destinations".

### From WP9 (`docs/briefs/wp09-web-shell-definitions-results.md` §5, real names)

```ts
// src/copy.ts
export const COPY = { /* … */ loading: 'Loading…', loadFailed: (message) => …, actionFailed: (message) => …, priceWithheld, source: Record<SourceKind, string>,
  classLabel: Record<VerdictClass | 'unchecked', string>, basisName: { verified: 'itinerary-search basis', calendar: 'calendar basis' },
  bucket: { priced, empty, no_data, error, skipped, not_run }, reusedNote: (n) => `(${n} reused from earlier runs)`, stageName, statusName,
  verifyCell: 'Search this cell for itineraries', verifyStarted, none, nav: { … }, importExample, runNow, createConfirm: (amount) => …, syntheticBanner };
// src/api/client.ts
export class ApiError extends Error { readonly status: number; readonly code: string; readonly details: unknown }
export function findRoute(method: Method, path: string): RouteDef;
export async function call<T>(method: Method, path: string, opts?: { params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown }): Promise<T>;
// src/api/endpoints.ts, src/api/types.ts, src/api/queries.ts
export const api: { …; verifyCell(body: { definitionId: string; cell: CellKey }) };   export type PriceCellData; export type DefinitionResponse; export type ResultRow;
export const qk: { … };
// src/components
export function PriceCell(props: { pricePence: number; provenance: Provenance | undefined; calendar: boolean; stale: boolean; destination?: string | undefined; destinationNote?: string | null | undefined }): JSX.Element;  // throws without valid provenance; renders data-testid="provenance"
export class PriceBoundary;     // renders COPY.priceWithheld (role="alert") instead of a broken price
export function ViewHeader(props: { title: string; executions: ExecutionSummary[]; stale: boolean }): JSX.Element;
export function ExpandedRow(props: { row: ResultRow; extras: boolean; verificationConfigured: boolean; definitionId: string }): JSX.Element;
export function ResultsView(props: { definition: DefinitionResponse }): JSX.Element;   // date columns via format.ts formatIsoDate
export function SyntheticBanner(): JSX.Element;   // role="alert", class bg-red-700, text COPY.syntheticBanner
// src/now.tsx, src/format.ts, src/state/urlState.ts
export const NowContext; export function useNow(): IsoDateTime;
export function formatIsoDate(d: string): string;   // "2027-03-14" → "14 Mar 2027" by string slicing
export function useSearchParams(): URLSearchParams; export function hrefWith(patch: Record<string, string | null>): string; export function navigateTo(patch): (e) => void;
// test/
export const NOW: IsoDateTime;                          // test/render.tsx: '2026-10-14T15:00:00.000Z'
export function renderWithProviders(ui, opts?: { search?: string });   // QueryClient (no retry), NowContext pinned to NOW; returns { user, client, … }
export const server;                                    // test/msw/server.ts, started by test/setup.ts with onUnhandledRequest 'error'
export const API = 'http://localhost:3000'; export function definition(over?); export function resultsResponse(over?); export function calendarRow(over?); export function verifiedRow(over?);   // test/fixtures.ts
```

The guards that WP9 runs and WP10 must pass:

- **Source guard:** no literal JSX text or literal `aria-label`/`title`/`placeholder`/`alt`/`label` containing a letter in any `.tsx`.
- **Catalogue test:** every function in `COPY` has an entry in `SAMPLES`; no banned word; "verified" appears only on allowed paths.
- **Rendered-DOM sweep:** Task 9.14.

The Definitions form's provider checkboxes have ids `p-d-<providerId>` (discovery) and `p-v-<providerId>` (itinerary search). The Results headline is a paragraph starting "cheapest found £…" that names the source in words and the age.

## 5. Interfaces produced

```ts
// src/lib/isoDate.ts (no Date anywhere)
export const WEEKDAYS: readonly ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function isoDateParts(d: IsoDate): { year: number; month: number; day: number };
export function weekdayIndex(d: IsoDate): 0 | 1 | 2 | 3 | 4 | 5 | 6;     // Monday = 0, from the epoch day
export function formatDayShort(d: IsoDate): string;                       // 'Sun 14 Mar'
export function formatDayLong(d: IsoDate): string;                        // 'Sun 14 Mar 2027'
export function formatIsoMonth(m: IsoMonth): string;                      // 'March 2027'
export function monthDays(m: IsoMonth): IsoDate[];
// src/lib/time.ts (with src/now.tsx, the only files that may construct a Date)
export function instantMs(t: IsoDateTime): number;                        // refuses a date-only string
export function dateMs(d: IsoDate): number;                               // toEpochDay(d) × 86 400 000, no Date
export function formatInstantLondon(ms: number): string;                  // '14 Mar 15:00' in Europe/London
// src/lib/sources.ts
export function discoverySourceLabel(providerId: ProviderId): string;     // COPY.source of the provider's calendar capability
// src/api additions
export type CalendarResponse, CalendarDay, DurationResponse, CellDetailResponse, ItineraryHistoryResponse, RouteHistoryResponse;
api.calendar(id); api.durationAnalysis(id); api.cellDetail(id, cell); api.itineraryHistory(hash); api.routeHistory(origin, destination, cabin);
qk.calendar(id); qk.duration(id); qk.cell(id, key); qk.itineraryHistory(hash); qk.routeHistory(origin, destination, cabin);
// src/views/Calendar
export type DaySlice; export type DayPrice; export type GlyphStatus; export type DayBasis;
export function bucketTotal(b: Buckets): number; export function formatDiscoveryMarker(b: Buckets): string;
export function formatVerificationMarker(v: DaySlice['verification']): string; export function totalReused(slices: readonly DaySlice[]): number;
export function sliceForDestination(day: CalendarDay, destination: Iata | 'all', verificationConfigured: boolean): DaySlice | null;
export function DayMarker(props: { slice: DaySlice }): JSX.Element; export function ReusedNote(props: { count: number }): JSX.Element | null;
export function resolveDayDisplay(slice: DaySlice, now: IsoDateTime): DayDisplay;
export function quintileBand(sorted: readonly number[], v: number): Band; export function buildScale(values: readonly number[]): QuintileScale;
export function buildCalendarModel(days: readonly GridDay[], colourBasis: DayBasis, now: IsoDateTime): CalendarModel;
export function CalendarGrid(props: { days: readonly GridDay[]; model: CalendarModel; destinationNotes: Partial<Record<Iata, string>>; onOpen(date: IsoDate, cell: CellKey | null): void }): JSX.Element;
export function CalendarLegend(props: { model: CalendarModel }): JSX.Element;
export function cellsForDay(def: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>, date: IsoDate): CellKey[];
export function CellPanel(props: { definition: DefinitionResponse; date: IsoDate; initialCell: CellKey | null; onClose(): void }): JSX.Element;
export function CalendarView(props: { definition: DefinitionResponse }): JSX.Element;
// src/views/Duration
export function buildDurationData(resp: DurationResponse, minNights: number, maxNights: number, hasVerification: boolean): DurationData;
export function DurationTooltip(props: { active?: boolean | undefined; payload?: ReadonlyArray<{ payload?: unknown }> | undefined; series: readonly DurationSeries[] }): JSX.Element | null;
export function DurationView(props: { definition: DefinitionResponse }): JSX.Element;
// src/views/History
export function linesFromRoute(resp: RouteHistoryResponse, gapHours: (providerId: ProviderId) => number): HistoryLine[];
export function linesFromItinerary(resp: ItineraryHistoryResponse, gapHours: (providerId: ProviderId) => number): HistoryLine[];
export function HistoryView(props: { definition: DefinitionResponse }): JSX.Element;     // reads ?hash= for itinerary mode
// src/copy.ts additions
COPY.calendarView, COPY.durationView, COPY.historyView
```

## 6. Library notes

Versions are from plan Task 0.1. Everything below was verified on 2026-10-14 with context7.

- **recharts 3.10.1** (context7 `/recharts/recharts` v3.x: storybook `API/ResponsiveContainer.mdx`, `Customise.mdx`, `API/Accessibility.mdx`; wiki "3.0 migration guide"; `src/component/ResponsiveContainer.tsx`, `src/component/Tooltip.tsx`):
  - Components used: `BarChart`, `Bar` (function `dataKey`, `name`, `isAnimationActive={false}`), `XAxis`/`YAxis` (`label={{ value, position, angle, offset }}`, `tickFormatter`, `type="number"`, `scale="time"`, `domain={['dataMin', 'dataMax']}`), `Tooltip` (`content` as a function receiving `TooltipContentProps`, the v3 rename of `TooltipProps`; `labelFormatter`, `formatter`), `Legend`, `LineChart`, `Line` (per-line `data`; `connectNulls={false}`, so a `null` point breaks the line and nothing is interpolated), `ResponsiveContainer`, `CartesianGrid`.
  - v3 enables `accessibilityLayer` by default.
  - **jsdom.** `ResponsiveContainer` reads its container's `getBoundingClientRect()` on mount, then observes it with `ResizeObserver`. It renders no children while width or height is ≤ 0. `test/setup-charts.ts` therefore installs a no-op `ResizeObserver` and returns 800×320 for `.recharts-responsive-container`. In production the parent `div` has an explicit height (`h-80`).
- **@playwright/test 1.64.1** (context7 `/microsoft/playwright`, `test-webserver-js.md`, `class-testconfig.md`, `test-projects-js.md`):
  - `defineConfig`, `devices['Desktop Chrome']`, `webServer` as an array of `{ name, command, url, env, timeout, reuseExistingServer, stdout }`. `env` merges over `process.env`; `cwd` defaults to the config's directory.
  - Locators used: `getByRole`, `getByText`, `locator('#id')`, `toContainText`, `toBeVisible`, `toHaveClass`, `expect(fn).toPass({ timeout })`.
  - The DB directory is prepared by the api command, not by `globalSetup`.
- **vite 8.3.4** (context7 `/vitejs/vite`, `packages/vite/src/node/preview.ts`): `resolvePreviewOptions` sets `proxy: preview?.proxy ?? server.proxy`, so `vite preview --host 127.0.0.1 --port 4173 --strictPort` reuses WP9's dev proxy.
- **react 19.3.1:** `useState`, `useRef`, `useEffect`, `useMemo`, `useId`.
- **@tanstack/react-query 5.104.2:** `useQuery({ queryKey, queryFn, enabled })`, `useMutation`, `useQueryClient().invalidateQueries`.
- **Testing libraries:** `@testing-library/react 16.3.3` (peer `@testing-library/dom`, added by WP9), `@testing-library/user-event 14.6.8`, `@testing-library/jest-dom 7.0.1`, all set up by WP9's `test/setup.ts`.
- **vitest 5.0.4:**
  - `setupFiles` run in each worker before the test file is imported, which is where `test/setup-tz.ts` sets `process.env.TZ`.
  - `pool: 'forks'` makes each worker a Node child process, where assigning `process.env.TZ` re-detects the zone for `Date` and `Intl`.
  - Also used: `describe.each`, `it.each`, positional file filters.
- **msw 3.0.3:** WP9's single `server` (`test/msw/server.ts`, started in `test/setup.ts` with `onUnhandledRequest: 'error'`). Tests add `server.use(http.get(\`${API}/api/…\`, …))` and `HttpResponse.json(body, { status })`, plus `delay('infinite')` for loading states. Requests are absolute (`window.location.origin` = `http://localhost:3000`).
- **zod 4.6.7** (added by WP9): `import type { z } from 'zod'`.
- **Intl:** `new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`, in `src/lib/time.ts` only.
- **dataviz skill** (spec §11): axis titles with units, one legend, no 3D, no dual axes, a sequential single hue for the heatmap, a categorical palette for series, and line or outline style backing every colour.

## 7. Files

**Create**

- `apps/web/src/lib/{isoDate.ts,time.ts,sources.ts}`
- `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx,display.ts,scale.ts,CalendarGrid.tsx,CalendarLegend.tsx,CellPanel.tsx,CalendarView.tsx,calendar.css}`
- `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`
- `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,HistoryView.tsx}`
- `apps/web/test/fixtures.wp10.ts`, `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts`
- `apps/web/test/views/calendar/{marker,display,scale,grid,panel,view}.test.tsx`
- `apps/web/test/views/duration.test.tsx`, `apps/web/test/views/history.test.tsx`, `apps/web/test/app/wp10Wiring.test.tsx`
- `apps/web/test/lib/{isoDate,time,noDateParsing}.test.ts`, `apps/web/test/tz/dates.tz.test.tsx`
- `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/prepare-db.mjs`

**Modify (WP9 files)**

- `src/copy.ts`: append `calendarView`, `durationView`, `historyView`.
- `test/copy/catalogue.test.ts`: SAMPLES entries for the new functions; extend the "verified" allowlist.
- `src/api/types.ts`, `src/api/endpoints.ts`, `src/api/queries.ts`: the five WP10 routes.
- `src/App.tsx`: render the three views in place of `<Placeholder wp="WP10" />`.
- `src/views/Results/ExpandedRow.tsx`: the history link.
- `vitest.config.ts`: `pool`, `exclude`, `setupFiles`.
- `vite.config.ts`: the proxy target reads `GMT_API_ORIGIN`.
- `package.json`: scripts `test`, `test:tz`, `e2e`, `e2e:install`.
- Root `.gitignore`: Playwright output and `e2e/.tmp/`.

## 8. Tasks

Every command runs from the repository root. Focused runs use `pnpm --filter @gmt/web exec vitest run <files>`, which skips the coverage thresholds (plan decision 8). In the tests, `API`, `definition`, `verifiedRow`, `calendarRow` and `resultsResponse` come from WP9's `test/fixtures.ts`, `NOW` and `renderWithProviders` come from `test/render.tsx`, and `server` comes from `test/msw/server.ts`.

### Task 10.1: Five-way day counts (first failing test)

**Files:**
- Create: `apps/web/src/lib/sources.ts`, `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx}`, `apps/web/test/fixtures.wp10.ts`, `apps/web/test/views/calendar/marker.test.tsx`
- Modify: `apps/web/src/copy.ts` (append `calendarView`), `apps/web/test/copy/catalogue.test.ts` (SAMPLES, "verified" allowlist), `apps/web/src/api/{types.ts,endpoints.ts,queries.ts}` (the five WP10 routes)

**Interfaces:**
- Consumes: `calendarDaySchema` (via `z.infer`), `Buckets`, `COPY.source`, `COPY.reusedNote`, `call`.
- Produces: `DaySlice`, `DayPrice`, `GridDay`, `GlyphStatus`, `DayBasis`, `bucketTotal`, `formatDiscoveryMarker`, `formatVerificationMarker`, `totalReused`, `sliceForDestination`, `DayMarker`, `ReusedNote`, `discoverySourceLabel`, `COPY.calendarView`, the `api.*` and `qk.*` additions.

- [ ] **Step 1: Write the failing test**

`apps/web/test/fixtures.wp10.ts` (WP10's builders, dated relative to WP9's `NOW` = `2026-10-14T15:00:00.000Z`):

```ts
import { addDays, asIata, asIsoDate, asIsoDateTime, type Buckets, type Cell, type CellKey, type IsoDateTime, type ProviderId, type Provenance } from '@gmt/core';
import type { CalendarDay, PriceCellData } from '../src/api/types.js';
import { sliceForDestination } from '../src/views/Calendar/marker.js';
import type { DaySlice, GridDay } from '../src/views/Calendar/types.js';
import { NOW } from './render.js';

/** An instant h hours before NOW. Tests may build Dates; apps/web/src may not (Task 10.2). */
export function hoursBefore(h: number): IsoDateTime {
  return asIsoDateTime(new Date(Date.parse(NOW) - h * 3_600_000).toISOString());
}

/** A worked-example cell (LHR → JFK unless given). */
export function cellAt(departure: string, nights: number, origin = 'LHR', destination = 'JFK'): Cell {
  const dep = asIsoDate(departure);
  return { origin: asIata(origin), destination: asIata(destination), departureDate: dep, returnDate: addDays(dep, nights), nights };
}

export function keyOf(c: Cell): CellKey {
  return { origin: c.origin, destination: c.destination, departureDate: c.departureDate, returnDate: c.returnDate };
}

/** SearchApi itinerary provenance (maxAgeHours 0), fetched h hours before NOW. */
export function provenanceVerified(h: number): Provenance {
  return { providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: hoursBefore(h), maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' };
}

/** Travelpayouts calendar provenance, fetched h hours before NOW. */
export function provenanceCalendar(h: number, maxAgeHours: number | 'unknown' = 48): Provenance {
  return { providerId: 'travelpayouts', sourceKind: 'authorised-cached', fetchedAt: hoursBefore(h), maxAgeHours, fx: { converted: false }, pointOfSale: 'unknown', cabin: 'economy' };
}

/** A day price as calendarDaySchema sends it: a price cell plus its cell and (for verified prices) the itinerary hash. */
export function priceAt(pricePence: number, provenance: Provenance, stale: boolean, at: Cell): PriceCellData & { cell: Cell; itineraryHash: string } {
  const fetchedHours = Math.floor((Date.parse(NOW) - Date.parse(provenance.fetchedAt)) / 3_600_000);
  const ageHours = provenance.maxAgeHours === 'unknown' ? 'unknown' : fetchedHours + provenance.maxAgeHours;
  return { pricePence, provenance, stale, ageHours, cell: at, itineraryHash: `it-${at.departureDate}-${pricePence}` };
}

export function buckets(partial: Partial<Buckets>): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0, ...partial };
}

/** One provider's discovery entry with its total (the six buckets' sum). */
export function disc(providerId: ProviderId, partial: Partial<Buckets>) {
  const b = buckets(partial);
  return { providerId, buckets: b, total: b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run };
}

export function slice(partial: Partial<DaySlice>): DaySlice {
  return { discovery: [], verification: null, cheapestVerified: null, cheapestPartiallyVerified: null, cheapestCalendar: null, destination: null, ...partial };
}

export function day(date: string, partial: Partial<Omit<CalendarDay, 'date'>> = {}): CalendarDay {
  return {
    date: asIsoDate(date), discovery: [], verification: { selected: 0, itinerarySearched: 0, onDemand: 0 },
    cheapestVerified: null, cheapestPartiallyVerified: null, cheapestCalendar: null, byDestination: [], ...partial,
  };
}

/** A grid day for "all destinations". */
export function gridDay(date: string, partial: Partial<Omit<CalendarDay, 'date'>> = {}, verificationConfigured = true): GridDay {
  return { date: asIsoDate(date), slice: sliceForDestination(day(date, partial), 'all', verificationConfigured) };
}
```

`apps/web/test/views/calendar/marker.test.tsx`:

```tsx
import { asIata } from '@gmt/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DayMarker, ReusedNote } from '../../../src/views/Calendar/DayMarker.js';
import { bucketTotal, formatDiscoveryMarker, formatVerificationMarker, sliceForDestination, totalReused } from '../../../src/views/Calendar/marker.js';
import { buckets, cellAt, day, disc, priceAt, provenanceCalendar, slice } from '../../fixtures.wp10.js';

describe('five-way day counts (spec §11 View B, §3)', () => {
  const partial = buckets({ priced: 3, empty: 1, no_data: 2, error: 1, skipped: 0, not_run: 5, reused: 2 });

  it('M is the sum of the six buckets; reused is a subset, not a seventh bucket', () => {
    expect(bucketTotal(partial)).toBe(12);
  });

  it('formats the discovery marker from the six-bucket counts', () => {
    expect(formatDiscoveryMarker(partial)).toBe('3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12');
  });

  it('formats the itinerary-search line separately, and says when no verification provider exists', () => {
    expect(formatVerificationMarker({ selected: 10, itinerarySearched: 1, onDemand: 2 })).toBe('itinerary-searched 1 of 10 selected +2 on demand');
    expect(formatVerificationMarker(null)).toBe('itinerary search: no verification provider configured');
  });

  it('renders one discovery line per provider, named by its calendar source, and the itinerary-search line', () => {
    render(
      <DayMarker
        slice={slice({
          discovery: [disc('travelpayouts', partial), disc('searchapi', { priced: 12 })],
          verification: { selected: 10, itinerarySearched: 1, onDemand: 2 },
        })}
      />,
    );
    const lines = screen.getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Aviasales cache: 3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12');
    expect(lines[1]).toHaveTextContent('Google date grid via SearchApi: 12 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 12');
    expect(screen.getByTestId('day-marker')).toHaveTextContent('itinerary-searched 1 of 10 selected +2 on demand');
  });

  it('says when a day has no discovery provider rather than showing zeros', () => {
    render(<DayMarker slice={slice({ discovery: [] })} />);
    expect(screen.getByTestId('day-marker')).toHaveTextContent('no discovery provider configured');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('a destination-filtered day keeps day-level counts and says they cover all destinations', () => {
    const c = cellAt('2027-03-14', 14);
    const d = day('2027-03-14', {
      discovery: [disc('travelpayouts', partial)],
      cheapestCalendar: priceAt(39900, provenanceCalendar(2), false, cellAt('2027-03-14', 14, 'LHR', 'EWR')),
      byDestination: [{ destination: asIata('JFK'), cheapestVerified: null, cheapestCalendar: priceAt(41200, provenanceCalendar(2), false, c) }],
    });
    const jfk = sliceForDestination(d, asIata('JFK'), true);
    expect(jfk?.destination).toBe('JFK');
    expect(jfk?.cheapestCalendar?.pricePence).toBe(41200);
    expect(jfk?.cheapestCalendar?.cell).toBeNull();
    expect(jfk?.discovery).toBe(d.discovery);
    expect(sliceForDestination(d, asIata('EWR'), true)).toBeNull();
    expect(sliceForDestination(d, 'all', false)?.verification).toBeNull();
    render(<DayMarker slice={jfk ?? slice({})} />);
    expect(screen.getByTestId('day-marker')).toHaveTextContent('counts cover all destinations');
  });

  it('the header shows the reused count summed over days and providers', () => {
    const days = [slice({ discovery: [disc('travelpayouts', partial)] }), slice({ discovery: [disc('travelpayouts', { priced: 4, reused: 3 }), disc('searchapi', { priced: 4, reused: 1 })] })];
    expect(totalReused(days)).toBe(6);
    render(<ReusedNote count={totalReused(days)} />);
    expect(screen.getByText('(6 reused from earlier runs)')).toBeInTheDocument();
  });

  it('shows no reused note when nothing was reused', () => {
    const { container } = render(<ReusedNote count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/marker.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/DayMarker.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/api/types.ts`: append

```ts
/** WP10 route types (plan contracts v2, results.ts). */
export type CalendarResponse = z.infer<typeof apiContract.calendarResponseSchema>;
export type CalendarDay = z.infer<typeof apiContract.calendarDaySchema>;
export type DurationResponse = z.infer<typeof apiContract.durationAnalysisResponseSchema>;
export type CellDetailResponse = z.infer<typeof apiContract.cellDetailResponseSchema>;
export type ItineraryHistoryResponse = z.infer<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.infer<typeof apiContract.routeHistoryResponseSchema>;
```

`apps/web/src/api/endpoints.ts`: add the type imports (and `type Cabin` from `@gmt/core`) and these members to `api`. The paths are `ROUTES` templates under `/api`, checked by `findRoute`.

```ts
  calendar: (id: string) => call<CalendarResponse>('GET', '/api/definitions/:id/calendar', { params: { id } }),
  durationAnalysis: (id: string) => call<DurationResponse>('GET', '/api/definitions/:id/duration-analysis', { params: { id } }),
  cellDetail: (id: string, c: CellKey) =>
    call<CellDetailResponse>('GET', '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate', {
      params: { id, origin: c.origin, destination: c.destination, departureDate: c.departureDate, returnDate: c.returnDate },
    }),
  itineraryHistory: (hash: string) => call<ItineraryHistoryResponse>('GET', '/api/itineraries/:hash/history', { params: { hash } }),
  // why: routeHistoryQuerySchema { cabin?: Cabin } (plan decision 14); the view passes the definition's cabin.
  routeHistory: (origin: string, destination: string, cabin: Cabin) =>
    call<RouteHistoryResponse>('GET', '/api/routes/:origin/:destination/history', { params: { origin, destination }, query: { cabin } }),
```

`apps/web/src/api/queries.ts`: add to `qk`

```ts
  calendar: (id: string) => ['calendar', id] as const,
  duration: (id: string) => ['duration', id] as const,
  cell: (id: string, key: string) => ['cell', id, key] as const,
  itineraryHistory: (hash: string) => ['history', 'itinerary', hash] as const,
  routeHistory: (origin: string, destination: string, cabin: string) => ['history', 'route', origin, destination, cabin] as const,
```

`apps/web/src/lib/sources.ts`:

```ts
import type { ProviderId, SourceKind } from '@gmt/core';
import { COPY } from '../copy.js';

// why: discovery counts carry only a providerId; each provider's calendar capability has exactly one source kind (spec §2 table).
const CALENDAR_SOURCE: Readonly<Record<ProviderId, SourceKind>> = {
  travelpayouts: 'authorised-cached',
  searchapi: 'scraped-aggregate',
  fixture: 'synthetic',
};

/** The source in words for a provider's discovery data: "Aviasales cache", "Google date grid via SearchApi" (spec §11 vocabulary). */
export function discoverySourceLabel(providerId: ProviderId): string {
  return COPY.source[CALENDAR_SOURCE[providerId]];
}
```

`apps/web/src/views/Calendar/types.ts`:

```ts
import type { Cell, Iata, IsoDate } from '@gmt/core';
import type { CalendarDay, PriceCellData } from '../../api/types.js';

/** A price shown on a day; `cell` is null for a per-destination price (byDestination carries prices only). */
export type DayPrice = PriceCellData & { cell: Cell | null };

/** What one day renders, for all destinations or one (spec §11 View B, per-destination filter). */
export interface DaySlice {
  discovery: CalendarDay['discovery'];
  /** null when the definition has no verification provider (spec §6.6 row 0: not applicable). */
  verification: CalendarDay['verification'] | null;
  cheapestVerified: DayPrice | null;
  cheapestPartiallyVerified: (DayPrice & { count: number }) | null;
  cheapestCalendar: DayPrice | null;
  /** null for all destinations; otherwise the filtered destination (its counts are still day-level). */
  destination: Iata | null;
}

/** A day as the grid renders it; `slice` is null when the filter leaves the day no cells. */
export interface GridDay { date: IsoDate; slice: DaySlice | null }
/** Statuses with their own glyph on a day without a price (spec §11 View B). */
export type GlyphStatus = 'empty' | 'no_data' | 'error' | 'not_run';
/** Which kind of price a day shows, and which kind the colour scale uses. */
export type DayBasis = 'verified' | 'calendar';
```

`apps/web/src/views/Calendar/marker.ts`:

```ts
import type { Buckets, Iata } from '@gmt/core';
import type { CalendarDay } from '../../api/types.js';
import { COPY } from '../../copy.js';
import type { DaySlice } from './types.js';

/** M in the marker: the six buckets sum to the cell count (spec §3); `reused` is already counted in its bucket. */
export function bucketTotal(b: Buckets): number {
  return b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run;
}

/** "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M" (spec §11 View B). */
export function formatDiscoveryMarker(b: Buckets): string {
  return COPY.calendarView.discoveryMarker(b, bucketTotal(b));
}

/** "itinerary-searched K of N selected +C on demand", or the not-configured note (spec §6.6 row 0). */
export function formatVerificationMarker(v: DaySlice['verification']): string {
  return v === null ? COPY.calendarView.verificationNotConfigured : COPY.calendarView.verificationMarker(v.itinerarySearched, v.selected, v.onDemand);
}

/** R′ for the header: reused outcomes summed over the slices and every discovery provider (spec §3). */
export function totalReused(slices: readonly DaySlice[]): number {
  return slices.reduce((sum, s) => sum + s.discovery.reduce((acc, d) => acc + d.buckets.reused, 0), 0);
}

/**
 * The slice a day renders for "all" or one destination. byDestination carries prices only (plan contracts v2), so a
 * filtered day keeps the day-level counts, and the marker says they cover all destinations; null when the destination has no entry.
 */
export function sliceForDestination(day: CalendarDay, destination: Iata | 'all', verificationConfigured: boolean): DaySlice | null {
  const verification = verificationConfigured ? day.verification : null;
  if (destination === 'all') {
    return { discovery: day.discovery, verification, cheapestVerified: day.cheapestVerified, cheapestPartiallyVerified: day.cheapestPartiallyVerified, cheapestCalendar: day.cheapestCalendar, destination: null };
  }
  const e = day.byDestination.find((x) => x.destination === destination);
  if (e === undefined) return null;
  return {
    discovery: day.discovery,
    verification,
    cheapestVerified: e.cheapestVerified === null ? null : { ...e.cheapestVerified, cell: null },
    cheapestPartiallyVerified: null,
    cheapestCalendar: e.cheapestCalendar === null ? null : { ...e.cheapestCalendar, cell: null },
    destination,
  };
}
```

`apps/web/src/views/Calendar/DayMarker.tsx`:

```tsx
import { COPY } from '../../copy.js';
import { discoverySourceLabel } from '../../lib/sources.js';
import { formatDiscoveryMarker, formatVerificationMarker } from './marker.js';
import type { DaySlice } from './types.js';

/** The per-day coverage marker: one five-way discovery line per provider, then the itinerary-search line (spec §11 View B). */
export function DayMarker({ slice }: { slice: DaySlice }) {
  return (
    <div className="mt-1 text-[10px] leading-tight text-slate-700" data-testid="day-marker">
      {slice.discovery.length === 0 ? (
        <p>{COPY.calendarView.noDiscoveryProvider}</p>
      ) : (
        <ul>
          {slice.discovery.map((d) => (
            <li key={d.providerId}>{COPY.calendarView.markerSource(discoverySourceLabel(d.providerId), formatDiscoveryMarker(d.buckets))}</li>
          ))}
        </ul>
      )}
      <p>{formatVerificationMarker(slice.verification)}</p>
      {slice.destination !== null ? <p className="italic">{COPY.calendarView.markerAllDestinations}</p> : null}
    </div>
  );
}

/** "(R reused from earlier runs)" for the view header; nothing when R is 0 (spec §3). */
export function ReusedNote({ count }: { count: number }) {
  return count > 0 ? <span>{COPY.reusedNote(count)}</span> : null;
}
```

`apps/web/src/copy.ts`: append inside `COPY` (Task 10.6 relies on `panel`):

```ts
  // View B Calendar (WP10; spec §11 View B, §3)
  calendarView: {
    title: 'Calendar',
    discoveryMarker: (b: { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number }, total: number) =>
      `${b.priced} priced · ${b.empty} no fares · ${b.no_data} no cached data · ${b.error} error · ${b.skipped} skipped · ${b.not_run} not searched of ${total}`,
    verificationMarker: (searched: number, selected: number, onDemand: number) => `itinerary-searched ${searched} of ${selected} selected +${onDemand} on demand`,
    verificationNotConfigured: 'itinerary search: no verification provider configured',
    noDiscoveryProvider: 'no discovery provider configured',
    markerAllDestinations: 'counts cover all destinations',
    markerSource: (source: string, marker: string) => `${source}: ${marker}`,
    glyphSymbol: { empty: '∅', no_data: '?', error: '!', not_run: '○' },
    calendarPrice: 'calendar price',
    partlyVerified: (count: number) => `${count} partially-verified`,
    colourBy: 'Colour by',
    legendTitle: 'Legend',
    legendScale: (basis: string, days: number) =>
      `Colour: ${basis} prices on ${days} ${days === 1 ? 'day' : 'days'}, in five price bands (quintiles of the days shown)`,
    legendBand: (band: number, min: string, max: string, days: number) => `band ${band + 1}: ${min}–${max} (${days} ${days === 1 ? 'day' : 'days'})`,
    legendHatched: (shown: 'verified' | 'calendar', days: number) =>
      `hatched: ${days} ${days === 1 ? 'day shows' : 'days show'} a ${shown === 'verified' ? 'class-verified' : 'calendar'} price instead and ${days === 1 ? 'is' : 'are'} not on this scale`,
    legendGlyphs: 'Days without a price show:',
    bandAria: (band: number) => `price band ${band + 1} of 5${band === 0 ? ', cheapest' : ''}`,
    hatchedAria: 'not on the colour scale',
    destinationFilter: 'Destination',
    allDestinations: 'All destinations',
    noCellsForDestination: 'no cells for this destination',
    empty: 'No days to show yet. The calendar fills in as cells are searched.',
    panel: {
      title: (date: string) => `Departing ${date}`,
      close: 'Close',
      cellPicker: 'Cell',
      cellOption: (origin: string, destination: string, nights: number, back: string) => `${origin}→${destination} · ${nights} nights · back ${back}`,
      outcomes: 'Outcomes per stage and provider',
      columns: { stage: 'Stage', provider: 'Provider', status: 'Outcome', reason: 'Reason', attempts: 'Attempts', fetched: 'Fetched (Europe/London)', reused: 'Reused from' },
      prices: 'Prices for this cell',
      noPrices: 'No prices stored for this cell.',
      observation: (seller: string, cls: string) => `itinerary offer · ${seller} · ${cls}`,
      verifyConflict: 'An itinerary search for this cell is already running.',
      showInResults: 'show in results',
      reusedFrom: (executionId: string) => `run ${executionId}`,
      dash: '—',
    },
  },
```

`apps/web/test/copy/catalogue.test.ts`: add to `SAMPLES`

```ts
  'calendarView.discoveryMarker': [{ priced: 1, empty: 2, no_data: 3, error: 4, skipped: 5, not_run: 6 }, 21],
  'calendarView.verificationMarker': [1, 10, 2],
  'calendarView.markerSource': ['Aviasales cache', '1 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 1'],
  'calendarView.partlyVerified': [2],
  'calendarView.legendScale': ['itinerary-search basis', 5],
  'calendarView.legendBand': [0, '£400', '£450', 2],
  'calendarView.legendHatched': ['verified', 1],
  'calendarView.bandAria': [0],
  'calendarView.panel.title': ['Sun 14 Mar 2027'],
  'calendarView.panel.cellOption': ['LHR', 'JFK', 14, 'Sun 28 Mar'],
  'calendarView.panel.observation': ['Example Air', 'verified'],
  'calendarView.panel.reusedFrom': ['exec-0'],
```

and extend the "verified" test's `allowed` set with `'calendarView.partlyVerified', 'calendarView.legendHatched', 'calendarView.panel.observation'`. Each of these sits beside a class-verified value or names the class.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/marker.test.tsx test/copy`
Expected: PASS. The marker file passes 8 tests. In the copy files, the catalogue and source-guard tests pass with the new entries. The searchapi line needs WP9's `COPY.source['scraped-aggregate']` to read "Google date grid via SearchApi" (spec rev 10 §11). If it does not, fix that WP9 entry; that change is the spec's vocabulary, not a WP10 choice.

Run: `pnpm -r typecheck`
Expected: clean. A missing schema field fails here; report it to Fable.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: five-way day marker, per-destination slices, calendar copy and WP10 endpoints"
```

### Task 10.2: Date-only helpers and the no-Date guard (review focus 3, part 1)

**Files:**
- Create: `apps/web/src/lib/isoDate.ts`, `apps/web/src/lib/time.ts`, `apps/web/test/lib/{isoDate.test.ts,time.test.ts,noDateParsing.test.ts}`
- Modify: any WP9 file under `apps/web/src` that the guard flags, other than `now.tsx`

**Interfaces:**
- Consumes: `toEpochDay`, `addDays`, `monthOf`, `asIsoDate`, `isoDateTimeSchema`.
- Produces: `WEEKDAYS`, `isoDateParts`, `weekdayIndex`, `formatDayShort`, `formatDayLong`, `formatIsoMonth`, `monthDays`, `instantMs`, `dateMs`, `formatInstantLondon`.

WP9's `format.ts` `formatIsoDate` ("14 Mar 2027", string slicing) stays the Results formatter. The calendar needs a weekday, which only the epoch day can give without `Date`, so it uses the helpers below.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/lib/isoDate.test.ts`:

```ts
import { asIsoDate, asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { formatDayLong, formatDayShort, formatIsoMonth, isoDateParts, monthDays, weekdayIndex } from '../../src/lib/isoDate.js';

const d = asIsoDate;

describe('date-only rendering from YYYY-MM-DD strings (spec §6.1, review focus 3)', () => {
  it('splits the string, never parses it', () => {
    expect(isoDateParts(d('2027-03-14'))).toEqual({ year: 2027, month: 3, day: 14 });
  });
  it('weekday from the epoch day, Monday = 0', () => {
    expect(weekdayIndex(d('1970-01-01'))).toBe(3); // Thursday
    expect(weekdayIndex(d('2027-03-01'))).toBe(0); // Monday
    expect(weekdayIndex(d('2027-03-14'))).toBe(6); // Sunday, the US DST change
    expect(weekdayIndex(d('2027-03-28'))).toBe(6); // Sunday, the UK DST change
    expect(weekdayIndex(d('1969-12-31'))).toBe(2); // a negative epoch day is still Wednesday
  });
  it('formats short and long forms', () => {
    expect(formatDayShort(d('2027-03-14'))).toBe('Sun 14 Mar');
    expect(formatDayLong(d('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatDayLong(d('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatIsoMonth(asIsoMonth('2027-03'))).toBe('March 2027');
  });
  it('lists the days of a month, leap February included', () => {
    expect(monthDays(asIsoMonth('2027-02'))).toHaveLength(28);
    const leap = monthDays(asIsoMonth('2028-02'));
    expect(leap).toHaveLength(29);
    expect(leap[28]).toBe('2028-02-29');
  });
});
```

`apps/web/test/lib/time.test.ts`:

```ts
import { asIsoDate, asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { dateMs, formatInstantLondon, instantMs } from '../../src/lib/time.js';

describe('src/lib/time.ts: instants only (review focus 3)', () => {
  it('instantMs accepts an instant and refuses a date-only string', () => {
    expect(instantMs(asIsoDateTime('2027-03-14T15:00:00.000Z'))).toBe(Date.UTC(2027, 2, 14, 15));
    expect(() => instantMs('2027-03-14' as never)).toThrow(RangeError);
  });
  it('dateMs is epoch-day arithmetic, equal to UTC midnight', () => {
    expect(dateMs(asIsoDate('2027-03-14'))).toBe(Date.UTC(2027, 2, 14));
  });
  it('formats instants in Europe/London whatever the process zone', () => {
    expect(formatInstantLondon(Date.UTC(2027, 2, 14, 15))).toMatch(/^14 Mar,? 15:00$/); // GMT
    expect(formatInstantLondon(Date.UTC(2027, 6, 1, 15))).toMatch(/^1 Jul,? 16:00$/); // BST
  });
});
```

`apps/web/test/lib/noDateParsing.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
// why: a Date built from 'YYYY-MM-DD' is UTC midnight and renders as the previous day west of Greenwich; local getters
// shift instants the same way. Only these two files may touch Date, and neither ever receives a date-only string:
// time.ts takes toISOString instants or epoch-day integers; now.tsx (WP9) builds the current instant.
const ALLOWLIST = new Set(['lib/time.ts', 'now.tsx']);
const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'new Date(', re: /\bnew\s+Date\s*\(/ },
  { name: 'Date.parse(', re: /\bDate\.parse\s*\(/ },
  { name: 'local date getter', re: /\.(getDate|getDay|getMonth|getFullYear|getHours|getTimezoneOffset)\s*\(/ },
  { name: 'toLocaleDateString(', re: /\.toLocale(Date|Time)?String\s*\(/ },
];

function scan(source: string): string[] {
  const hits: string[] = [];
  source.split('\n').forEach((line, i) => {
    for (const f of FORBIDDEN) if (f.re.test(line)) hits.push(`${i + 1}: ${f.name}`);
  });
  return hits;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('no Date parsing outside the allowlisted helpers (review focus 3)', () => {
  it('the scanner flags a date-only string fed to Date, and leaves string helpers alone', () => {
    expect(scan(`const d = new Date('2027-03-14');`)).toEqual(['1: new Date(']);
    expect(scan(`const t = Date.parse(day.date);`)).toEqual(['1: Date.parse(']);
    expect(scan(`const n = when.getDate();`)).toEqual(['1: local date getter']);
    expect(scan(`label = x.toLocaleDateString('en-GB');`)).toEqual(['1: toLocaleDateString(']);
    expect(scan(`const ok = formatDayShort(day.date);`)).toEqual([]);
  });
  it('finds no Date construction in apps/web/src outside the allowlist', () => {
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
Expected: FAIL. `isoDate.test.ts` and `time.test.ts` fail with `Failed to resolve import`. `noDateParsing.test.ts` fails on the missing `lib/time.ts` and lists any WP9 hit outside `now.tsx`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/isoDate.ts`:

```ts
import { addDays, asIsoDate, type IsoDate, type IsoMonth, monthOf, toEpochDay } from '@gmt/core';

// Date-only values render from their YYYY-MM-DD strings and epoch-day integers only (spec §6.1, review focus 3).
// No Date is built here, so no browser timezone can move a day.

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** Monday-first weekday abbreviations (grid headers and day labels). */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function monthName(table: readonly string[], month: number): string {
  const name = table[month - 1];
  if (name === undefined) throw new RangeError(`month out of range: ${month}`);
  return name;
}

/** Year, month and day read from the string itself. */
export function isoDateParts(d: IsoDate): { year: number; month: number; day: number } {
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) };
}

/** Weekday with Monday = 0. */
export function weekdayIndex(d: IsoDate): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  // why: epoch day 0 (1970-01-01) was a Thursday, index 3; the double modulo keeps negative epoch days in range.
  return ((((toEpochDay(d) + 3) % 7) + 7) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** '2027-03-14' → 'Sun 14 Mar'. */
export function formatDayShort(d: IsoDate): string {
  const { month, day } = isoDateParts(d);
  return `${WEEKDAYS[weekdayIndex(d)]} ${day} ${monthName(MONTHS_SHORT, month)}`;
}

/** '2027-03-14' → 'Sun 14 Mar 2027'. */
export function formatDayLong(d: IsoDate): string {
  return `${formatDayShort(d)} ${isoDateParts(d).year}`;
}

/** '2027-03' → 'March 2027'. */
export function formatIsoMonth(m: IsoMonth): string {
  return `${monthName(MONTHS_LONG, Number(m.slice(5, 7)))} ${m.slice(0, 4)}`;
}

/** Every date in the month, in order. */
export function monthDays(m: IsoMonth): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = asIsoDate(`${m}-01`); monthOf(d) === m; d = addDays(d, 1)) out.push(d);
  return out;
}
```

`apps/web/src/lib/time.ts`:

```ts
import { isoDateTimeSchema, type IsoDate, type IsoDateTime, toEpochDay } from '@gmt/core';

// With src/now.tsx, the only file in apps/web/src that constructs or parses a Date (review focus 3; test/lib/noDateParsing).
// Inputs are toISOString instants or epoch-day integers; a date-only string is refused.

/** Epoch milliseconds of an instant; throws RangeError on anything but the toISOString form (spec §6.3). */
export function instantMs(t: IsoDateTime): number {
  if (!isoDateTimeSchema.safeParse(t).success) throw new RangeError(`instantMs: not an ISO instant: ${String(t)}`);
  return Date.parse(t);
}

/** A calendar date on the same millisecond axis as instants (UTC midnight), by epoch-day arithmetic only. */
export function dateMs(d: IsoDate): number {
  return toEpochDay(d) * 86_400_000;
}

// why: an explicit zone keeps chart ticks identical in every browser; Europe/London is the app's reference zone (spec §6.1).
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** '14 Mar 15:00' in Europe/London, for the History axis, tooltips and the panel's fetched column. */
export function formatInstantLondon(ms: number): string {
  return LONDON.format(new Date(ms));
}
```

For each WP9 hit outside `now.tsx`, read the current instant through `useNow()` and convert instants with `instantMs()`. Change nothing else in those files.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/lib`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: date-only helpers, instant helpers and the no-Date guard (review focus 3)"
```

### Task 10.3: Day price precedence (spec §11 View B, §8.1)

**Files:**
- Create: `apps/web/src/views/Calendar/display.ts`, `apps/web/test/views/calendar/display.test.ts`

**Interfaces:**
- Consumes: `effectiveAge`, `compareAges`; `DaySlice`, `DayPrice`, `GlyphStatus`, `DayBasis`.
- Produces: `DayDisplay`, `resolveDayDisplay`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveDayDisplay } from '../../../src/views/Calendar/display.js';
import { NOW } from '../../render.js';
import { buckets, cellAt, disc, priceAt, provenanceCalendar, provenanceVerified, slice } from '../../fixtures.wp10.js';

const c14 = cellAt('2027-03-14', 14);

describe('day precedence (spec §11 View B, §8.1)', () => {
  it('a fresh class-verified price wins even over a cheaper calendar price', () => {
    const v = priceAt(52000, provenanceVerified(5), false, c14);
    const c = priceAt(41200, provenanceCalendar(2), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'verified', price: v, stale: false, why: 'fresh-verified' });
  });
  it('stale verified vs calendar: the fresher wins (calendar 10h + ≤48h beats verified 200h)', () => {
    const v = priceAt(52000, provenanceVerified(200), true, c14);
    const c = priceAt(41200, provenanceCalendar(10), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'calendar', price: c, stale: false, why: 'calendar-fresher' });
  });
  it('stale verified vs calendar: a stale verified price fresher than the calendar one wins, labelled stale', () => {
    const v = priceAt(52000, provenanceVerified(200), true, c14);
    const c = priceAt(41200, provenanceCalendar(190), true, c14); // worst case 238h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'verified', price: v, stale: true, why: 'stale-verified-fresher' });
  });
  it('unknown age loses to any known age', () => {
    const v = priceAt(52000, provenanceVerified(300), true, c14);
    const c = priceAt(41200, provenanceCalendar(1, 'unknown'), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({ basis: 'verified', why: 'stale-verified-fresher' });
  });
  it('ties go to verified', () => {
    const v = priceAt(52000, provenanceVerified(58), true, c14); // 58h
    const c = priceAt(41200, provenanceCalendar(10), false, c14); // 10 + 48 = 58h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({ basis: 'verified' });
  });
  it('a stale calendar price still renders, labelled stale', () => {
    const c = priceAt(41200, provenanceCalendar(400), true, c14);
    expect(resolveDayDisplay(slice({ cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'calendar', price: c, stale: true, why: 'calendar-only' });
  });
  it('a stale verified price with no calendar price renders, labelled stale', () => {
    const v = priceAt(52000, provenanceVerified(300), true, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v }), NOW)).toEqual({ kind: 'price', basis: 'verified', price: v, stale: true, why: 'stale-verified-only' });
  });
  it('a partially-verified price never becomes the day price', () => {
    const pv = { ...priceAt(30000, provenanceVerified(1), false, c14), count: 3 };
    expect(resolveDayDisplay(slice({ cheapestPartiallyVerified: pv }), NOW).kind).toBe('glyphs');
  });
  it('no price: one glyph per non-zero unpriced status across providers, in a fixed order', () => {
    const s = slice({ discovery: [disc('travelpayouts', { no_data: 3, not_run: 2 }), disc('searchapi', { error: 1, empty: 4 })] });
    expect(resolveDayDisplay(s, NOW)).toEqual({ kind: 'glyphs', glyphs: ['empty', 'no_data', 'error', 'not_run'] });
  });
  it('a day of only skipped cells shows no glyph (the marker carries the count)', () => {
    expect(resolveDayDisplay(slice({ discovery: [disc('travelpayouts', { skipped: 12 })] }), NOW)).toEqual({ kind: 'glyphs', glyphs: [] });
    expect(buckets({}).skipped).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/display.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/display.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/display.ts` (Task 10.4 appends `buildCalendarModel`):

```ts
import { compareAges, effectiveAge, type IsoDateTime } from '@gmt/core';
import type { DayBasis, DayPrice, DaySlice, GlyphStatus } from './types.js';

/** What one calendar day shows (spec §11 View B). */
export type DayDisplay =
  | { kind: 'price'; basis: DayBasis; price: DayPrice; stale: boolean; why: 'fresh-verified' | 'stale-verified-fresher' | 'calendar-fresher' | 'stale-verified-only' | 'calendar-only' }
  | { kind: 'glyphs'; glyphs: GlyphStatus[] };

const GLYPH_ORDER: readonly GlyphStatus[] = ['empty', 'no_data', 'error', 'not_run'];

/**
 * Spec §11 precedence: a class-verified price that is not stale (the api's `stale` uses STALE_AFTER_HOURS, §8.1);
 * else the fresher of a stale verified price and the cheapest calendar price; else glyphs. Partially-verified prices
 * never become the day price; the day shows only their count.
 */
export function resolveDayDisplay(slice: DaySlice, now: IsoDateTime): DayDisplay {
  const v = slice.cheapestVerified;
  const c = slice.cheapestCalendar;
  if (v !== null && !v.stale) return { kind: 'price', basis: 'verified', price: v, stale: false, why: 'fresh-verified' };
  if (v !== null && c !== null) {
    // why: §8.1 — unknown age loses to any known age and ties go to verified; compareAges(a, b) < 0 means a is fresher.
    const cmp = compareAges(effectiveAge(v.provenance, now), effectiveAge(c.provenance, now));
    return cmp <= 0
      ? { kind: 'price', basis: 'verified', price: v, stale: true, why: 'stale-verified-fresher' }
      : { kind: 'price', basis: 'calendar', price: c, stale: c.stale, why: 'calendar-fresher' };
  }
  if (v !== null) return { kind: 'price', basis: 'verified', price: v, stale: true, why: 'stale-verified-only' };
  if (c !== null) return { kind: 'price', basis: 'calendar', price: c, stale: c.stale, why: 'calendar-only' };
  return { kind: 'glyphs', glyphs: GLYPH_ORDER.filter((s) => slice.discovery.some((d) => d.buckets[s] > 0)) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/display.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: day price precedence with stale and unknown-age rules (spec §11, §8.1)"
```

### Task 10.4: Quintile scale over one basis, and the calendar model

**Files:**
- Create: `apps/web/src/views/Calendar/scale.ts`, `apps/web/test/views/calendar/scale.test.ts`
- Modify: `apps/web/src/views/Calendar/display.ts` (append `CalendarModel`, `buildCalendarModel`)

**Interfaces:**
- Produces: `Band`, `LegendEntry`, `QuintileScale`, `BAND_CLASSES`, `quintileBand`, `buildScale`, `CalendarModel`, `buildCalendarModel`.

The quintile function: sort the n prices of the colour basis ascending. A price v gets band `min(4, floor(r × 5 / n))`, where r is the number of prices strictly below v. Equal prices share a band, bands never decrease as the price rises, and n < 5 leaves the upper bands empty instead of stretching them.

The colour basis is a client-side toggle. The calendar route returns both bases per day (plan reconciliation), so no request parameter is involved.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/scale.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildCalendarModel } from '../../../src/views/Calendar/display.js';
import { buildScale, quintileBand } from '../../../src/views/Calendar/scale.js';
import { NOW } from '../../render.js';
import { cellAt, gridDay, priceAt, provenanceCalendar, provenanceVerified } from '../../fixtures.wp10.js';

describe('quintile scale (spec §11 View B)', () => {
  it('five distinct values take one band each', () => {
    const sorted = [100, 200, 300, 400, 500];
    expect(sorted.map((v) => quintileBand(sorted, v))).toEqual([0, 1, 2, 3, 4]);
  });
  it('ten values take two per band', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sorted.map((v) => quintileBand(sorted, v))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('ties share the lower band; a lone value is band 0', () => {
    expect(quintileBand([100, 100, 200], 100)).toBe(0);
    expect(quintileBand([100, 100, 200], 200)).toBe(3);
    expect(quintileBand([42], 42)).toBe(0);
  });
  it('an empty scale refuses to band anything and has an empty legend', () => {
    expect(() => quintileBand([], 1)).toThrow(RangeError);
    expect(buildScale([]).legend).toEqual([]);
  });
  it('the legend is numeric: one entry per occupied band with its pence range and day count', () => {
    expect(buildScale([50000, 41200, 41200, 61000, 45500]).legend).toEqual([
      { band: 0, minPence: 41200, maxPence: 41200, count: 2 },
      { band: 2, minPence: 45500, maxPence: 45500, count: 1 },
      { band: 3, minPence: 50000, maxPence: 50000, count: 1 },
      { band: 4, minPence: 61000, maxPence: 61000, count: 1 },
    ]);
  });
});

describe('calendar model: one basis at a time, other-basis days hatched and excluded (spec §11 View B)', () => {
  const v = (date: string, pence: number) => gridDay(date, { cheapestVerified: priceAt(pence, provenanceVerified(5), false, cellAt(date, 14)) });
  const c = (date: string, pence: number) => gridDay(date, { cheapestCalendar: priceAt(pence, provenanceCalendar(5), false, cellAt(date, 14)) });
  const days = [v('2027-03-10', 40000), v('2027-03-11', 50000), v('2027-03-12', 60000), v('2027-03-13', 70000), v('2027-03-14', 80000), c('2027-03-15', 30000)];

  it('colouring by verified bands only the verified days; the cheaper calendar day is hatched and does not move the scale', () => {
    const m = buildCalendarModel(days, 'verified', NOW);
    expect(m.scale.count).toBe(5);
    expect(m.scale.band(40000)).toBe(0);
    expect(m.hatchedDays).toBe(1);
    expect(m.bands.get(asIsoDate('2027-03-15'))).toBeUndefined();
  });
  it('colouring by calendar bands the calendar day and hatches the five verified days', () => {
    const m = buildCalendarModel(days, 'calendar', NOW);
    expect(m.scale.count).toBe(1);
    expect(m.bands.get(asIsoDate('2027-03-15'))).toBe(0);
    expect(m.hatchedDays).toBe(5);
  });
  it('a day the filter leaves empty (slice null) is neither banded nor hatched', () => {
    const m = buildCalendarModel([{ date: asIsoDate('2027-03-16'), slice: null }], 'verified', NOW);
    expect(m.displays.get(asIsoDate('2027-03-16'))).toEqual({ kind: 'glyphs', glyphs: [] });
    expect(m.hatchedDays).toBe(0);
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
/** One numeric legend row: the pence range and the number of days in a band. */
export interface LegendEntry { band: Band; minPence: number; maxPence: number; count: number }
export interface QuintileScale { count: number; band(v: number): Band; legend: LegendEntry[] }

/** Sequential single-hue fills (dataviz skill); the price text and the sr-only band label carry the meaning, never colour alone. */
export const BAND_CLASSES: Readonly<Record<Band, string>> = {
  0: 'bg-teal-700 text-white',
  1: 'bg-teal-500 text-white',
  2: 'bg-teal-300 text-black',
  3: 'bg-teal-200 text-black',
  4: 'bg-teal-100 text-black',
};

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
  return Math.min(4, Math.floor((lo * 5) / sorted.length)) as Band;
}

/** The scale over the visible days of one basis, plus its numeric legend. */
export function buildScale(values: readonly number[]): QuintileScale {
  const sorted = [...values].sort((a, b) => a - b);
  const legend: LegendEntry[] = [];
  for (const v of sorted) {
    const b = quintileBand(sorted, v);
    const last = legend[legend.length - 1];
    // why: bands never decrease as price rises, so consecutive equal bands merge into one legend row.
    if (last !== undefined && last.band === b) {
      last.maxPence = v;
      last.count += 1;
    } else legend.push({ band: b, minPence: v, maxPence: v, count: 1 });
  }
  return { count: sorted.length, band: (v) => quintileBand(sorted, v), legend };
}
```

Append to `apps/web/src/views/Calendar/display.ts`, merging the imports into the top block:

```ts
import type { IsoDate } from '@gmt/core';
import { type Band, buildScale, type QuintileScale } from './scale.js';
import type { GridDay } from './types.js';

/** Per-day displays plus the one-basis colour scale (spec §11 View B). */
export interface CalendarModel {
  colourBasis: DayBasis;
  displays: ReadonlyMap<IsoDate, DayDisplay>;
  bands: ReadonlyMap<IsoDate, Band>;
  scale: QuintileScale;
  hatchedDays: number;
}

/** Resolves every day, scales the days whose shown price is of `colourBasis`, and counts the hatched rest. */
export function buildCalendarModel(days: readonly GridDay[], colourBasis: DayBasis, now: IsoDateTime): CalendarModel {
  const displays = new Map<IsoDate, DayDisplay>();
  for (const d of days) displays.set(d.date, d.slice === null ? { kind: 'glyphs', glyphs: [] } : resolveDayDisplay(d.slice, now));
  const onBasis: Array<{ date: IsoDate; pence: number }> = [];
  let hatchedDays = 0;
  for (const [date, disp] of displays) {
    if (disp.kind !== 'price') continue;
    if (disp.basis === colourBasis) onBasis.push({ date, pence: disp.price.pricePence });
    else hatchedDays += 1; // why: spec §11 — days showing the other basis are hatched and excluded from the scale
  }
  const scale = buildScale(onBasis.map((x) => x.pence));
  return { colourBasis, displays, bands: new Map(onBasis.map((x) => [x.date, scale.band(x.pence)])), scale, hatchedDays };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar`
Expected: PASS (marker 8, display 10, scale 8).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: quintile scale per basis with hatched fallback days (spec §11 View B)"
```

### Task 10.5: Calendar grid, glyphs, legend and keyboard navigation

**Files:**
- Create: `apps/web/src/views/Calendar/{CalendarGrid.tsx,CalendarLegend.tsx,calendar.css}`, `apps/web/test/views/calendar/grid.test.tsx`

**Interfaces:**
- Consumes: `CalendarModel`, `GridDay`, `BAND_CLASSES`, `DayMarker`, WP9's `PriceCell`, `PriceBoundary`, `formatPence` and `COPY`; the `isoDate` helpers; `addDays`, `monthOf`.
- Produces: `CalendarGrid({ days, model, destinationNotes, onOpen })`, `CalendarLegend({ model })`.

The grid follows the APG grid pattern: one `role="grid"` table per month and `role="gridcell"` days with a roving `tabIndex`. Arrow keys move by a day or a week, across months; Enter or Space opens the panel. Every shown price goes through `PriceBoundary` and `PriceCell`. That puts provenance on the day without hover (badge, source, compact age, "≈", dashed outline and "constraints not checked" for calendar prices, destination, the operator's note), and withholds a price that lacks provenance.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/grid.test.tsx`:

```tsx
import { within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarGrid } from '../../../src/views/Calendar/CalendarGrid.js';
import { CalendarLegend } from '../../../src/views/Calendar/CalendarLegend.js';
import { buildCalendarModel } from '../../../src/views/Calendar/display.js';
import type { DayBasis, GridDay } from '../../../src/views/Calendar/types.js';
import { NOW, renderWithProviders } from '../../render.js';
import { cellAt, disc, gridDay, priceAt, provenanceCalendar, provenanceVerified } from '../../fixtures.wp10.js';
import type { Buckets } from '@gmt/core';

const vDay = (date: string, pence: number): GridDay =>
  gridDay(date, { cheapestVerified: priceAt(pence, provenanceVerified(5), false, cellAt(date, 14)), discovery: [disc('searchapi', { priced: 48 })] });
const cDay = (date: string, pence: number, stale = false): GridDay =>
  gridDay(date, { cheapestCalendar: priceAt(pence, provenanceCalendar(5), stale, cellAt(date, 14)), discovery: [disc('travelpayouts', { priced: 20, no_data: 28 })] });
const gDay = (date: string, b: Partial<Buckets>): GridDay => gridDay(date, { discovery: [disc('travelpayouts', b)] });

function renderGrid(days: GridDay[], basis: DayBasis = 'verified', notes: Record<string, string> = {}) {
  const onOpen = vi.fn();
  const model = buildCalendarModel(days, basis, NOW);
  const r = renderWithProviders(
    <>
      <CalendarGrid days={days} model={model} destinationNotes={notes} onOpen={onOpen} />
      <CalendarLegend model={model} />
    </>,
  );
  return { onOpen, ...r };
}
function dayCell(date: string): HTMLTableCellElement {
  const el = document.querySelector(`[data-date="${date}"]`);
  if (!(el instanceof HTMLTableCellElement)) throw new Error(`no day cell ${date}`);
  return el;
}

describe('calendar grid (spec §11 View B, Accessibility)', () => {
  it('places each day under its weekday in its own month grid', () => {
    const { getByRole } = renderGrid([vDay('2027-03-14', 41200), vDay('2027-04-01', 41200)]);
    expect(dayCell('2027-03-14').cellIndex).toBe(6); // Sunday
    expect(dayCell('2027-04-01').cellIndex).toBe(3); // Thursday
    expect(getByRole('grid', { name: 'March 2027' })).toContainElement(dayCell('2027-03-14'));
    expect(getByRole('grid', { name: 'April 2027' })).toContainElement(dayCell('2027-04-01'));
  });

  it('colours by one basis; other-basis days are hatched, excluded from the scale and named in the numeric legend', () => {
    const days = [vDay('2027-03-08', 40000), vDay('2027-03-09', 50000), vDay('2027-03-10', 60000), vDay('2027-03-11', 70000), vDay('2027-03-12', 80000), cDay('2027-03-13', 30000)];
    const first = renderGrid(days, 'verified');
    expect(['08', '09', '10', '11', '12'].map((d) => dayCell(`2027-03-${d}`).dataset.band)).toEqual(['0', '1', '2', '3', '4']);
    expect(dayCell('2027-03-13')).toHaveClass('day-hatched');
    expect(dayCell('2027-03-13').dataset.band).toBe('');
    expect(within(dayCell('2027-03-13')).getByText('not on the colour scale')).toBeInTheDocument();
    expect(within(dayCell('2027-03-08')).getByText('price band 1 of 5, cheapest')).toBeInTheDocument();
    const legend = first.getByTestId('calendar-legend');
    expect(legend).toHaveTextContent('Colour: itinerary-search basis prices on 5 days, in five price bands (quintiles of the days shown)');
    expect(legend).toHaveTextContent('band 1: £400–£400 (1 day)');
    expect(legend).toHaveTextContent('band 5: £800–£800 (1 day)');
    expect(legend).toHaveTextContent('hatched: 1 day shows a calendar price instead and is not on this scale');
    first.unmount();

    const second = renderGrid(days, 'calendar');
    expect(dayCell('2027-03-13').dataset.band).toBe('0');
    expect(['08', '09', '10', '11', '12'].every((d) => dayCell(`2027-03-${d}`).classList.contains('day-hatched'))).toBe(true);
    expect(second.getByTestId('calendar-legend')).toHaveTextContent('hatched: 5 days show a class-verified price instead and are not on this scale');
  });

  it('every shown price carries provenance; calendar prices are dashed and say constraints not checked; stale is labelled', () => {
    renderGrid([vDay('2027-03-08', 40000), cDay('2027-03-09', 30000, true)], 'verified');
    const v = dayCell('2027-03-08');
    expect(within(v).getByTestId('provenance')).not.toHaveClass('border-dashed');
    expect(within(v).getByTestId('day-price-block')).toHaveTextContent('verified');
    const c = dayCell('2027-03-09');
    expect(within(c).getByTestId('provenance')).toHaveClass('border-dashed');
    expect(c).toHaveTextContent('constraints not checked');
    expect(c).toHaveTextContent('calendar price');
    expect(c).toHaveTextContent('stale');
    expect(c).toHaveTextContent('£300');
  });

  it('shows the destination and the operator note for the destination of the shown price', () => {
    renderGrid([vDay('2027-03-08', 40000)], 'verified', { JFK: 'onward leg not included' });
    expect(within(dayCell('2027-03-08')).getByTestId('provenance')).toHaveTextContent('JFK');
    expect(dayCell('2027-03-08')).toHaveTextContent('onward leg not included');
  });

  it('withholds a day price that arrives without provenance', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prevent = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', prevent);
    const broken = vDay('2027-03-08', 40000);
    if (broken.slice?.cheapestVerified) Object.assign(broken.slice.cheapestVerified, { provenance: undefined });
    renderGrid([broken]);
    expect(dayCell('2027-03-08')).toHaveTextContent('price withheld: provenance missing');
    expect(dayCell('2027-03-08')).not.toHaveTextContent('£400');
    window.removeEventListener('error', prevent);
    errors.mockRestore();
  });

  it('days without a price show distinct glyphs, each with its text', () => {
    const r = renderGrid([gDay('2027-03-08', { empty: 1, no_data: 1, error: 1, not_run: 1 })]);
    const glyphs = [...dayCell('2027-03-08').querySelectorAll('[data-glyph]')];
    expect(glyphs.map((g) => g.getAttribute('data-glyph'))).toEqual(['empty', 'no_data', 'error', 'not_run']);
    expect(new Set(glyphs.map((g) => g.querySelector('[aria-hidden="true"]')?.textContent)).size).toBe(4);
    expect(glyphs.map((g) => g.textContent)).toEqual(['∅ no fares', '? no cached data', '! error', '○ not searched']);
    expect(r.getByTestId('calendar-legend')).toHaveTextContent('∅ no fares');
  });

  it('is keyboard-operable: arrows by day and week across months, Enter and Space open, one tab stop, visible focus', async () => {
    const days = ['2027-03-30', '2027-03-31', '2027-04-01', '2027-04-02', '2027-04-03', '2027-04-04', '2027-04-05', '2027-04-06', '2027-04-07'].map((d) => vDay(d, 40000));
    const { onOpen, user } = renderGrid(days);
    await user.tab();
    expect(dayCell('2027-03-30')).toHaveFocus();
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-03-31')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // across the month boundary
    await user.keyboard('{ArrowDown}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // 2027-04-08 has no data: focus stays
    await user.keyboard('{ArrowLeft}');
    expect(dayCell('2027-03-31')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(dayCell('2027-04-07')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('2027-04-07', cellAt('2027-04-07', 14));
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(dayCell('2027-04-07').className).toContain('focus-visible:outline-2');
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

`apps/web/src/views/Calendar/calendar.css` (a stylesheet, not an inline style: spec §4's CSP blocks inline styles):

```css
/* Hatched days (spec §11 View B): a pattern, not a colour, so "not on this scale" survives greyscale and colour-blindness. */
.day-hatched {
  background-color: #f4f4f5;
  background-image: repeating-linear-gradient(45deg, transparent 0 6px, rgb(0 0 0 / 0.18) 6px 8px);
}
```

`apps/web/src/views/Calendar/CalendarGrid.tsx`:

```tsx
import { addDays, type CellKey, type Iata, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { type KeyboardEvent, useRef, useState } from 'react';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayLong, formatIsoMonth, isoDateParts, monthDays, WEEKDAYS, weekdayIndex } from '../../lib/isoDate.js';
import { DayMarker } from './DayMarker.js';
import type { CalendarModel, DayDisplay } from './display.js';
import { type Band, BAND_CLASSES } from './scale.js';
import type { DaySlice, GlyphStatus, GridDay } from './types.js';
import './calendar.css';

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
// why: visible focus is a spec §11 accessibility requirement; focus-visible keeps it off mouse clicks.
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

export interface CalendarGridProps {
  days: readonly GridDay[];
  model: CalendarModel;
  destinationNotes: Partial<Record<Iata, string>>;
  onOpen(date: IsoDate, cell: CellKey | null): void;
}

/** Monday-first weeks of one month, null for padding. */
function weeksOf(month: IsoMonth): Array<Array<IsoDate | null>> {
  const dates = monthDays(month);
  const first = dates[0];
  const cells: Array<IsoDate | null> = first === undefined ? [] : Array.from({ length: weekdayIndex(first) }, () => null);
  cells.push(...dates);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<IsoDate | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** View B heatmap: one APG grid per month, roving tabindex, arrows by day and week, Enter or Space opens the side panel (spec §11). */
export function CalendarGrid({ days, model, destinationNotes, onOpen }: CalendarGridProps) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const months = [...new Set(days.map((d) => monthOf(d.date)))];
  const [focusDate, setFocusDate] = useState<IsoDate | null>(days[0]?.date ?? null);
  const refs = useRef(new Map<IsoDate, HTMLTableCellElement>());

  const open = (date: IsoDate) => {
    const disp = model.displays.get(date);
    onOpen(date, disp?.kind === 'price' ? disp.price.cell : null);
  };
  const onKeyDown = (date: IsoDate) => (e: KeyboardEvent<HTMLTableCellElement>) => {
    const step = STEPS[e.key];
    if (step !== undefined) {
      e.preventDefault();
      const next = addDays(date, step);
      if (byDate.has(next)) {
        setFocusDate(next);
        refs.current.get(next)?.focus();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(date);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {months.map((m) => (
        <table key={m} role="grid" aria-label={formatIsoMonth(m)} className="w-full table-fixed border-separate border-spacing-1 max-sm:block">
          <caption className="text-left font-semibold">{formatIsoMonth(m)}</caption>
          <thead className="max-sm:hidden">
            <tr role="row">
              {WEEKDAYS.map((w) => (
                <th key={w} role="columnheader" scope="col" className="text-xs font-medium">{w}</th>
              ))}
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {weeksOf(m).map((week) => (
              <tr role="row" key={week.find((d) => d !== null) ?? m} className="max-sm:block">
                {week.map((date, i) => {
                  if (date === null) return <td key={`pad-${m}-${i}`} role="gridcell" aria-hidden="true" className="max-sm:hidden" />;
                  const gd = byDate.get(date);
                  if (gd === undefined) {
                    return (
                      <td key={date} role="gridcell" aria-disabled="true" className="align-top text-xs text-slate-400 max-sm:hidden">
                        {isoDateParts(date).day}
                      </td>
                    );
                  }
                  const disp: DayDisplay = model.displays.get(date) ?? { kind: 'glyphs', glyphs: [] };
                  const band = model.bands.get(date);
                  const hatched = disp.kind === 'price' && disp.basis !== model.colourBasis;
                  const fill = band !== undefined ? BAND_CLASSES[band] : hatched ? 'day-hatched' : 'border border-slate-200 bg-white';
                  return (
                    <td
                      key={date}
                      role="gridcell"
                      data-date={date}
                      data-basis={disp.kind === 'price' ? disp.basis : 'none'}
                      data-band={band ?? ''}
                      tabIndex={date === focusDate ? 0 : -1}
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
                      className={`cursor-pointer rounded p-1 text-left align-top max-sm:mb-1 max-sm:block ${FOCUS_RING} ${fill}`}
                    >
                      <span className="block text-xs font-semibold">
                        <span aria-hidden="true">{isoDateParts(date).day}</span>
                        <span className="sr-only">{formatDayLong(date)}</span>
                      </span>
                      <DayBody display={disp} band={band} hatched={hatched} slice={gd.slice} notes={destinationNotes} />
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

function DayBody(props: { display: DayDisplay; band: Band | undefined; hatched: boolean; slice: DaySlice | null; notes: Partial<Record<Iata, string>> }) {
  const { display, band, hatched, slice, notes } = props;
  if (slice === null) return <p className="text-[10px]">{COPY.calendarView.noCellsForDestination}</p>;
  return (
    <>
      {display.kind === 'price' ? <DayPriceBlock display={display} sliceDestination={slice.destination} notes={notes} /> : <GlyphList glyphs={display.glyphs} />}
      {band !== undefined ? <span className="sr-only">{COPY.calendarView.bandAria(band)}</span> : null}
      {hatched ? <span className="sr-only">{COPY.calendarView.hatchedAria}</span> : null}
      {slice.cheapestPartiallyVerified !== null ? <p className="text-[10px]">{COPY.calendarView.partlyVerified(slice.cheapestPartiallyVerified.count)}</p> : null}
      <DayMarker slice={slice} />
    </>
  );
}

/** The day's price via PriceCell: provenance visible without hover, withheld without provenance (spec §11, §9 item 6). */
function DayPriceBlock(props: { display: Extract<DayDisplay, { kind: 'price' }>; sliceDestination: Iata | null; notes: Partial<Record<Iata, string>> }) {
  const p = props.display.price;
  const isCalendar = props.display.basis === 'calendar';
  // why: a per-destination price has no cell; the filtered destination is its destination.
  const destination = p.cell?.destination ?? props.sliceDestination ?? undefined;
  const note = destination === undefined ? null : (props.notes[destination] ?? null);
  return (
    <div data-testid="day-price-block" className="text-xs">
      <span className="block text-[10px] font-medium">{isCalendar ? COPY.calendarView.calendarPrice : COPY.classLabel.verified}</span>
      <PriceBoundary>
        <PriceCell pricePence={p.pricePence} provenance={p.provenance} calendar={isCalendar} stale={props.display.stale} destination={destination} destinationNote={note} />
      </PriceBoundary>
    </div>
  );
}

function GlyphList({ glyphs }: { glyphs: readonly GlyphStatus[] }) {
  if (glyphs.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1 text-[10px]">
      {glyphs.map((g) => (
        <li key={g} data-glyph={g}>
          <span aria-hidden="true" className="font-bold">{COPY.calendarView.glyphSymbol[g]}</span> {COPY.bucket[g]}
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/src/views/Calendar/CalendarLegend.tsx`:

```tsx
import { COPY } from '../../copy.js';
import type { CalendarModel } from './display.js';
import { BAND_CLASSES } from './scale.js';
import type { DayBasis } from './types.js';
import { formatPence } from '@gmt/core';

/** Numeric legend (spec §11): the basis on the scale, each band's pence range and day count, the hatched days, and the glyphs. */
export function CalendarLegend({ model }: { model: CalendarModel }) {
  const other: DayBasis = model.colourBasis === 'verified' ? 'calendar' : 'verified';
  return (
    <section aria-label={COPY.calendarView.legendTitle} data-testid="calendar-legend" className="text-sm">
      <p>{COPY.calendarView.legendScale(COPY.basisName[model.colourBasis], model.scale.count)}</p>
      <ul>
        {model.scale.legend.map((e) => (
          <li key={e.band}>
            <span aria-hidden="true" className={`mr-1 inline-block h-3 w-3 align-middle ${BAND_CLASSES[e.band]}`} />
            {COPY.calendarView.legendBand(e.band, formatPence(e.minPence), formatPence(e.maxPence), e.count)}
          </li>
        ))}
        {model.hatchedDays > 0 ? (
          <li>
            <span aria-hidden="true" className="day-hatched mr-1 inline-block h-3 w-3 align-middle" />
            {COPY.calendarView.legendHatched(other, model.hatchedDays)}
          </li>
        ) : null}
      </ul>
      <p>{COPY.calendarView.legendGlyphs}</p>
      <ul>
        {(['empty', 'no_data', 'error', 'not_run'] as const).map((g) => (
          <li key={g}>
            <span aria-hidden="true">{COPY.calendarView.glyphSymbol[g]}</span> {COPY.bucket[g]}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/grid.test.tsx test/copy`
Expected: PASS. The grid file passes 8 tests. The source guard passes: no literal JSX text with a letter.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar grid with hatched days, glyphs, numeric legend and keyboard navigation"
```

### Task 10.6: Side panel: outcomes, prices with full provenance, per-cell verify

**Files:**
- Create: `apps/web/src/views/Calendar/CellPanel.tsx`, `apps/web/test/views/calendar/panel.test.tsx`

**Interfaces:**
- Consumes: `api.cellDetail`, `api.verifyCell`, `qk.cell`, `qk.calendar`, `resultRowKey` (WP2, plan decision 14), `hrefWith`/`navigateTo` and WP9's `?row=` parameter, `ApiError`, `PriceCell`, `PriceBoundary`, `COPY`, `formatInstantLondon`, `instantMs`, `cellKeyString`, `addDays`, `daysBetween`.
- Produces: `cellsForDay(definition, date)`, `CellPanel({ definition, date, initialCell, onClose })`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/panel.test.tsx`:

```tsx
import { asIsoDate, resultRowKey } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellPanel, cellsForDay } from '../../../src/views/Calendar/CellPanel.js';
import { API, definition, verifiedRow } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { cellAt, hoursBefore, keyOf, priceAt, provenanceCalendar } from '../../fixtures.wp10.js';

const c = cellAt('2027-03-14', 14);
const date = asIsoDate('2027-03-14');
const outcome = (stage: 'discovery' | 'verification', providerId: 'travelpayouts' | 'searchapi', status: 'priced' | 'not_run', extra: Record<string, unknown> = {}) => ({
  ...keyOf(c), executionId: 'exec-1', stage, providerId, status, reason: null, attempts: status === 'priced' ? 1 : 0, lastError: null,
  fetchedAt: status === 'priced' ? hoursBefore(2) : null, minPence: status === 'priced' ? 41200 : null, cabin: 'economy',
  pointOfSale: status === 'priced' ? 'unknown' : null, sourceKind: status === 'priced' ? 'authorised-cached' : null, reusedFromExecutionId: null, ...extra,
});
const { cell: _cell, itineraryHash: _hash, ...calendarPrice } = priceAt(41200, provenanceCalendar(2), false, c);
const detail = {
  cell: c,
  outcomes: [outcome('discovery', 'travelpayouts', 'priced', { reusedFromExecutionId: 'exec-0' }), outcome('verification', 'searchapi', 'not_run')],
  calendarPrices: [{ ...calendarPrice, executionId: 'exec-0', calendarPriceId: 7 }],
  observations: [verifiedRow({ cell: c, seller: 'Example Air', pricePence: 52000 })],
};
const cellRoute = `${API}/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`;

function renderPanel(def = definition(), onClose = vi.fn()) {
  const r = renderWithProviders(<CellPanel definition={def} date={date} initialCell={c} onClose={onClose} />);
  return { onClose, ...r };
}

describe('View B side panel (spec §11, §10 cells route)', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  const prevent = (e: ErrorEvent) => e.preventDefault();
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.addEventListener('error', prevent);
  });
  afterEach(() => {
    window.removeEventListener('error', prevent);
    errors.mockRestore();
  });

  it('lists the cell outcomes per stage and provider, including reuse', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole } = renderPanel();
    const table = await findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/discovery.*Travelpayouts.*priced.*run exec-0/);
    expect(rows[1]).toHaveTextContent(/itinerary search.*SearchApi.*not searched/);
  });

  it('shows every price with its provenance; the calendar price is dashed and says constraints not checked', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole } = renderPanel();
    const dialog = await findByRole('dialog');
    await within(dialog).findByText('£412');
    const provs = within(dialog).getAllByTestId('provenance');
    expect(provs).toHaveLength(2);
    expect(provs[0]).toHaveClass('border-dashed');
    expect(provs[0]).toHaveTextContent('constraints not checked');
    expect(within(provs[0] as HTMLElement).getByTitle('fetched 2h ago · provider age unknown (≤2d before that)')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('itinerary offer · Example Air · verified');
    const link = within(dialog).getByRole('link', { name: 'show in results' }).getAttribute('href') ?? '';
    expect(new URLSearchParams(link.split('?')[1]).get('row')).toBe(resultRowKey(detail.observations[0] as never));
    expect(new URLSearchParams(link.split('?')[1]).get('view')).toBe('results');
  });

  it('a price lacking provenance fails to render: the contract parse refuses the response and no amount appears', async () => {
    const { provenance: _dropped, ...bare } = detail.calendarPrices[0] as (typeof detail.calendarPrices)[number];
    server.use(http.get(cellRoute, () => HttpResponse.json({ ...detail, calendarPrices: [bare], observations: [] })));
    const { findByRole, getByRole } = renderPanel();
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(getByRole('dialog')).not.toHaveTextContent('£');
  });

  it('hides the verify action when the definition has no verification provider', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole, queryByRole } = renderPanel(definition({ providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } }));
    await findByRole('table');
    expect(queryByRole('button', { name: 'Search this cell for itineraries' })).toBeNull();
  });

  it('verify posts the definition and cell key, then confirms; a 409 says a search is already running', async () => {
    let posted: unknown = null;
    server.use(
      http.get(cellRoute, () => HttpResponse.json(detail)),
      http.post(`${API}/api/cells/verify`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ executionId: 'child-1' });
      }),
    );
    const { findByRole, findByText, getByRole, user } = renderPanel();
    await user.click(await findByRole('button', { name: 'Search this cell for itineraries' }));
    expect(await findByText('Itinerary search started for this cell.')).toBeInTheDocument();
    expect(posted).toEqual({ definitionId: 'def-0001', cell: keyOf(c) });

    server.use(http.post(`${API}/api/cells/verify`, () => HttpResponse.json({ error: { code: 'conflict', message: 'child active' } }, { status: 409 })));
    await user.click(getByRole('button', { name: 'Search this cell for itineraries' }));
    expect(await findByText('An itinerary search for this cell is already running.')).toBeInTheDocument();
  });

  it('the cell picker lists origins × destinations × nights for the day and fetches the chosen cell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(cellRoute, ({ request, params }) => {
        paths.push(new URL(request.url).pathname);
        const key = { origin: params.origin, destination: params.destination, departureDate: params.departureDate, returnDate: params.returnDate };
        return HttpResponse.json({ ...detail, cell: { ...key, nights: 14 }, outcomes: [], calendarPrices: [], observations: [] });
      }),
    );
    expect(cellsForDay(definition(), date)).toHaveLength(2 * 2 * 12);
    const { findByLabelText, getByRole, user } = renderPanel();
    const picker = await findByLabelText('Cell');
    const target = cellsForDay(definition(), date).findIndex((k) => k.origin === 'LGW' && k.destination === 'EWR' && k.returnDate === '2027-04-04');
    await user.selectOptions(picker, String(target));
    await waitFor(() => expect(paths.at(-1)).toMatch(/\/api\/definitions\/def-0001\/cells\/LGW\/EWR\/2027-03-14\/2027-04-04$/));
    expect(getByRole('option', { name: 'LGW→EWR · 21 nights · back Sun 4 Apr' })).toBeInTheDocument();
  });

  it('focuses its heading on open and closes on Escape', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { getByRole, onClose, user } = renderPanel();
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type { CellDetailResponse, DefinitionResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayLong, formatDayShort } from '../../lib/isoDate.js';
import { formatInstantLondon, instantMs } from '../../lib/time.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

const P = COPY.calendarView.panel;

/** Every cell departing on `date`: origins × destinations × nights, in generation order (spec §6.1). */
export function cellsForDay(def: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>, date: IsoDate): CellKey[] {
  const out: CellKey[] = [];
  for (const origin of def.origins)
    for (const destination of def.destinations)
      for (let n = def.minNights; n <= def.maxNights; n += 1) out.push({ origin, destination, departureDate: date, returnDate: addDays(date, n) });
  return out;
}

// why: a day price's cell carries `nights`; the verify request and the picker take the four-field key only.
const toKey = (c: CellKey): CellKey => ({ origin: c.origin, destination: c.destination, departureDate: c.departureDate, returnDate: c.returnDate });

export interface CellPanelProps { definition: DefinitionResponse; date: IsoDate; initialCell: CellKey | null; onClose(): void }

/** View B side panel: pick a cell of the day, see its outcomes per stage and provider and its prices, verify it (spec §11, §8.1). */
export function CellPanel({ definition, date, initialCell, onClose }: CellPanelProps) {
  const cells = useMemo(() => cellsForDay(definition, date), [definition, date]);
  const [selected, setSelected] = useState<CellKey | null>(initialCell === null ? (cells[0] ?? null) : toKey(initialCell));
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const qc = useQueryClient();
  const key = selected === null ? '' : cellKeyString(selected);
  const detail = useQuery({
    queryKey: qk.cell(definition.id, key),
    queryFn: () => (selected === null ? Promise.reject(new Error('no cell')) : api.cellDetail(definition.id, selected)),
    enabled: selected !== null,
  });
  const verify = useMutation({
    mutationFn: (c: CellKey) => api.verifyCell({ definitionId: definition.id, cell: c }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cell', definition.id] });
      void qc.invalidateQueries({ queryKey: qk.calendar(definition.id) });
    },
  });
  // why: spec §6.9 and §8.1 — the per-cell verify action is hidden when the definition has no verification provider.
  const canVerify = definition.providers.verification.length > 0;
  const selectedIndex = cells.findIndex((c) => cellKeyString(c) === key);

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
      className="fixed inset-y-0 right-0 z-10 w-full max-w-md overflow-y-auto border-l bg-white p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">{P.title(formatDayLong(date))}</h2>
        <button type="button" onClick={onClose} className="rounded border px-2">{P.close}</button>
      </div>
      <label className="mt-3 flex flex-col text-sm">
        {P.cellPicker}
        <select value={selectedIndex >= 0 ? String(selectedIndex) : ''} onChange={(e) => setSelected(cells[Number(e.target.value)] ?? null)} className="rounded border px-2 py-1">
          {cells.map((c, i) => (
            <option key={cellKeyString(c)} value={String(i)}>
              {P.cellOption(c.origin, c.destination, daysBetween(c.departureDate, c.returnDate), formatDayShort(c.returnDate))}
            </option>
          ))}
        </select>
      </label>
      {selected !== null && detail.isPending ? <p role="status">{COPY.loading}</p> : null}
      {detail.isError ? <p role="alert">{COPY.loadFailed(detail.error.message)}</p> : null}
      {detail.data !== undefined ? <CellDetailBody detail={detail.data} note={definition.destinationNotes[detail.data.cell.destination] ?? null} /> : null}
      {canVerify && selected !== null ? (
        <div className="mt-4">
          <button type="button" disabled={verify.isPending} onClick={() => verify.mutate(selected)} className="rounded bg-slate-900 px-3 py-1 text-white">
            {COPY.verifyCell}
          </button>
          {verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
          {verify.isError ? (
            <p role="alert">{verify.error instanceof ApiError && verify.error.status === 409 ? P.verifyConflict : COPY.actionFailed(verify.error.message)}</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

// Observations are ResultRows; their searchLink may be null (synthetic rows, plan decision 15). The panel never renders it.
function CellDetailBody({ detail, note }: { detail: CellDetailResponse; note: string | null }) {
  const empty = detail.calendarPrices.length + detail.observations.length === 0;
  return (
    <>
      <h3 className="mt-4 font-medium">{P.outcomes}</h3>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {(['stage', 'provider', 'status', 'reason', 'attempts', 'fetched', 'reused'] as const).map((k) => (
              <th key={k} scope="col" className="text-left">{P.columns[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.outcomes.map((o) => (
            <tr key={`${o.executionId}|${o.stage}|${o.providerId}`}>
              <td>{COPY.stageName[o.stage]}</td>
              <td>{COPY.provider[o.providerId]}</td>
              <td>{COPY.bucket[o.status]}</td>
              <td>{o.reason ?? P.dash}</td>
              <td>{o.attempts}</td>
              <td>{o.fetchedAt === null ? P.dash : formatInstantLondon(instantMs(o.fetchedAt))}</td>
              <td>{o.reusedFromExecutionId === null ? P.dash : P.reusedFrom(o.reusedFromExecutionId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mt-4 font-medium">{P.prices}</h3>
      {empty ? (
        <p>{P.noPrices}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.calendarPrices.map((p) => (
            <li key={`cal-${p.calendarPriceId}`}>
              <span className="text-xs">{COPY.calendarView.calendarPrice}</span>
              <PriceBoundary>
                <PriceCell pricePence={p.pricePence} provenance={p.provenance} calendar stale={p.stale} destination={detail.cell.destination} destinationNote={note} />
              </PriceBoundary>
            </li>
          ))}
          {detail.observations.map((o) => (
            <li key={`obs-${o.observationId ?? o.itineraryHash}-${o.seller ?? ''}`}>
              <span className="text-xs">{P.observation(o.seller ?? COPY.none, COPY.classLabel[o.verdictClass])}</span>{' '}
              {/* why: WP9 owns ?row=<resultRowKey>, which selects and scrolls to that results row (plan decision 14) */}
              <a href={hrefWith({ view: 'results', row: resultRowKey(o) })} onClick={navigateTo({ view: 'results', row: resultRowKey(o) })} className="text-xs underline">
                {P.showInResults}
              </a>
              <PriceBoundary>
                <PriceCell pricePence={o.pricePence} provenance={o.provenance} calendar={o.basis === 'calendar'} stale={o.stale} destination={o.cell.destination} destinationNote={note} />
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
Expected: PASS. The panel file passes 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: side panel with outcomes, provenance-checked prices and per-cell verify"
```

### Task 10.7: Calendar view (data, destination filter, basis toggle, states)

**Files:**
- Create: `apps/web/src/views/Calendar/CalendarView.tsx`, `apps/web/test/views/calendar/view.test.tsx`

**Interfaces:**
- Consumes: `api.calendar`, `qk.calendar`, `ViewHeader`, `useNow`, `CalendarGrid`, `CalendarLegend`, `CellPanel`, `buildCalendarModel`, `sliceForDestination`, `totalReused`, `ReusedNote`.
- Produces: `CalendarView({ definition })`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/view.test.tsx`:

```tsx
import { asIata } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CalendarDay } from '../../../src/api/types.js';
import { CalendarView } from '../../../src/views/Calendar/CalendarView.js';
import { API, definition } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { cellAt, day, disc, priceAt, provenanceCalendar } from '../../fixtures.wp10.js';

const body = (days: CalendarDay[]) => ({
  days,
  executions: [{ id: 'exec-0001', status: 'completed', isChild: false, startedAt: '2026-10-14T12:00:00.000Z', finishedAt: '2026-10-14T13:00:00.000Z', ageHours: 2 }],
  staleAfterHours: 192,
  calendarStaleAfterHours: { travelpayouts: 216, searchapi: 192, fixture: 168 },
});
const jfk = priceAt(41200, provenanceCalendar(2), false, cellAt('2027-03-14', 14, 'LHR', 'JFK'));
const ewr = priceAt(39900, provenanceCalendar(2), false, cellAt('2027-03-14', 14, 'LHR', 'EWR'));
const { cell: _a, itineraryHash: _b, ...jfkBare } = jfk;
const { cell: _c, itineraryHash: _d, ...ewrBare } = ewr;
const mixedDay = day('2027-03-14', {
  cheapestCalendar: ewr,
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8, reused: 3 })],
  byDestination: [
    { destination: asIata('JFK'), cheapestVerified: null, cheapestCalendar: jfkBare },
    { destination: asIata('EWR'), cheapestVerified: null, cheapestCalendar: ewrBare },
  ],
});
const ewrOnlyDay = day('2027-03-15', {
  cheapestCalendar: priceAt(45000, provenanceCalendar(2), false, cellAt('2027-03-15', 14, 'LHR', 'EWR')),
  byDestination: [{ destination: asIata('EWR'), cheapestVerified: null, cheapestCalendar: ewrBare }],
});
const route = `${API}/api/definitions/:id/calendar`;
const at = (d: string) => document.querySelector(`[data-date="${d}"]`) as HTMLElement;

describe('Calendar view (spec §11 View B)', () => {
  it('shows an explicit loading state, then the grid', async () => {
    server.use(http.get(route, async () => { await delay(30); return HttpResponse.json(body([mixedDay])); }));
    const { getByRole, findByRole } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(getByRole('status')).toHaveTextContent('Loading…');
    expect(await findByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
  });

  it('shows an error state naming the failure', async () => {
    server.use(http.get(route, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })));
    const { findByRole } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByRole('alert')).toHaveTextContent('Could not load: boom');
  });

  it('shows the empty state when there are no days', async () => {
    server.use(http.get(route, () => HttpResponse.json(body([]))));
    const { findByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByText('No days to show yet. The calendar fills in as cells are searched.')).toBeInTheDocument();
  });

  it('the header names the run and carries the reused count', async () => {
    server.use(http.get(route, () => HttpResponse.json(body([mixedDay]))));
    const { findByText, getByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByText('(3 reused from earlier runs)')).toBeInTheDocument();
    expect(getByText(/run exec-000/)).toBeInTheDocument();
  });

  it('the destination filter swaps every day to that destination and says when a day has none', async () => {
    server.use(http.get(route, () => HttpResponse.json(body([mixedDay, ewrOnlyDay]))));
    const { findByRole, getByLabelText, user } = renderWithProviders(<CalendarView definition={definition()} />);
    await findByRole('grid', { name: 'March 2027' });
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£399');
    await user.selectOptions(getByLabelText('Destination'), 'JFK');
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£412');
    expect(at('2027-03-14')).toHaveTextContent('counts cover all destinations');
    expect(at('2027-03-15')).toHaveTextContent('no cells for this destination');
    await user.selectOptions(getByLabelText('Destination'), 'EWR');
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£399');
  });

  it('defaults the colour basis to calendar and disables the itinerary-search basis without a verification provider', async () => {
    server.use(http.get(route, () => HttpResponse.json(body([mixedDay]))));
    const def = definition({ providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } });
    const { findByRole, getByRole } = renderWithProviders(<CalendarView definition={def} />);
    expect(await findByRole('radio', { name: 'calendar basis' })).toBeChecked();
    expect(getByRole('radio', { name: 'itinerary-search basis' })).toBeDisabled();
    expect(at('2027-03-14')).toHaveTextContent('itinerary search: no verification provider configured');
  });

  it('Enter opens the side panel for the day; Escape closes it and focus returns to the day', async () => {
    server.use(
      http.get(route, () => HttpResponse.json(body([mixedDay]))),
      http.get(`${API}/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`, ({ params }) =>
        HttpResponse.json({ cell: { origin: params.origin, destination: params.destination, departureDate: params.departureDate, returnDate: params.returnDate, nights: 14 }, outcomes: [], calendarPrices: [], observations: [] }),
      ),
    );
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/view.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CalendarView.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/CalendarView.tsx`:

```tsx
import { type CellKey, type Iata, type IsoDate } from '@gmt/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { CalendarGrid } from './CalendarGrid.js';
import { CalendarLegend } from './CalendarLegend.js';
import { CellPanel } from './CellPanel.js';
import { ReusedNote } from './DayMarker.js';
import { buildCalendarModel } from './display.js';
import { sliceForDestination, totalReused } from './marker.js';
import type { DayBasis, GridDay } from './types.js';

/** View B: the calendar heatmap for one definition (spec §11 View B, §10 calendar route). */
export function CalendarView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const q = useQuery({ queryKey: qk.calendar(definition.id), queryFn: () => api.calendar(definition.id) });
  const [destination, setDestination] = useState<Iata | 'all'>('all');
  const [chosenBasis, setChosenBasis] = useState<DayBasis | null>(null);
  const [open, setOpen] = useState<{ date: IsoDate; cell: CellKey | null } | null>(null);
  const hasVerification = definition.providers.verification.length > 0;

  const days = useMemo<GridDay[]>(
    () => (q.data?.days ?? []).map((d) => ({ date: d.date, slice: sliceForDestination(d, destination, hasVerification) })),
    [q.data, destination, hasVerification],
  );
  // why: §6.9 — calendar is the default when there is no verification provider or nothing class-verified to colour by.
  const defaultBasis: DayBasis = hasVerification && days.some((d) => d.slice?.cheapestVerified != null) ? 'verified' : 'calendar';
  const colourBasis = chosenBasis ?? defaultBasis;
  const model = useMemo(() => buildCalendarModel(days, colourBasis, now), [days, colourBasis, now]);

  if (q.isPending) return <p role="status">{COPY.loading}</p>;
  if (q.isError) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;

  const slices = days.flatMap((d) => (d.slice === null ? [] : [d.slice]));
  const shown = [...model.displays.values()].filter((d) => d.kind === 'price');
  const closePanel = () => {
    const date = open?.date;
    setOpen(null);
    if (date !== undefined) document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  };

  return (
    <section aria-label={COPY.calendarView.title} className="flex flex-col gap-4">
      <ViewHeader title={COPY.calendarView.title} executions={q.data.executions} stale={shown.length > 0 && shown.every((d) => d.kind === 'price' && d.stale)} />
      <ReusedNote count={totalReused(slices)} />
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm">
          {COPY.calendarView.destinationFilter}
          <select
            value={destination}
            onChange={(e) => setDestination(definition.destinations.find((d) => d === e.target.value) ?? 'all')}
            className="rounded border px-2 py-1"
          >
            <option value="all">{COPY.calendarView.allDestinations}</option>
            {definition.destinations.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend>{COPY.calendarView.colourBy}</legend>
          {(['verified', 'calendar'] as const).map((b) => (
            <label key={b} className="mr-3">
              <input type="radio" name="colour-basis" value={b} checked={colourBasis === b} disabled={b === 'verified' && !hasVerification} onChange={() => setChosenBasis(b)} />{' '}
              {COPY.basisName[b]}
            </label>
          ))}
        </fieldset>
      </div>
      {days.length === 0 ? (
        <p>{COPY.calendarView.empty}</p>
      ) : (
        <>
          <CalendarGrid days={days} model={model} destinationNotes={definition.destinationNotes} onOpen={(date, cell) => setOpen({ date, cell })} />
          <CalendarLegend model={model} />
        </>
      )}
      {open !== null ? <CellPanel definition={definition} date={open.date} initialCell={open.cell} onClose={closePanel} /> : null}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar test/copy`
Expected: PASS. The calendar files pass 48 tests (marker 8, display 10, scale 8, grid 8, panel 7, view 7).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar view with destination filter, basis toggle and explicit states"
```

### Task 10.8: The TZ suite (review focus 3, pinned)

**Files:**
- Create: `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts` (empty module for now, `export {};`; Task 10.9 fills it), `apps/web/test/tz/dates.tz.test.tsx`
- Modify: `apps/web/vitest.config.ts`, `apps/web/package.json` (scripts)

**Interfaces:**
- Consumes: `CalendarGrid`, `buildCalendarModel`, `formatDayLong`, WP9's `ResultsView`, `formatIsoDate`, `resultsResponse`, `calendarRow`.
- Produces: the `test:tz` script, and `test`, which runs coverage and then `test:tz`.

The suite proves the zone two ways:

- The `test:tz` script runs the TZ suite and the calendar tests as whole processes, twice: once with `GMT_TEST_TZ=America/Los_Angeles`, once with `GMT_TEST_TZ=Asia/Tokyo`. `test/setup-tz.ts` copies that value into `process.env.TZ` before any test module is imported.
- Inside the suite, `describe.each` switches `process.env.TZ` per block, so the root `pnpm test` (one process, in the machine's zone) covers both zones too.

Each block first asserts that the zone took effect (the resolved `Intl` zone and the January UTC offset), and runs a control showing that a naive `Date` would move the day. Neither half can pass vacuously.

- [ ] **Step 1: Write the failing test**

`apps/web/test/tz/dates.tz.test.tsx`:

```tsx
import { asIata, asIsoDate } from '@gmt/core';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIsoDate } from '../../src/format.js';
import { formatDayLong } from '../../src/lib/isoDate.js';
import { CalendarGrid } from '../../src/views/Calendar/CalendarGrid.js';
import { buildCalendarModel } from '../../src/views/Calendar/display.js';
import { ResultsView } from '../../src/views/Results/ResultsView.js';
import { API, calendarRow, definition, resultsResponse } from '../fixtures.js';
import { server } from '../msw/server.js';
import { NOW, renderWithProviders } from '../render.js';
import { cellAt, gridDay, priceAt, provenanceVerified } from '../fixtures.wp10.js';

const ZONES = ['America/Los_Angeles', 'Asia/Tokyo'] as const;
// why: the 2027-01-01 offsets prove the zone is in effect, so these tests cannot pass vacuously in UTC.
const JAN_OFFSET_MINUTES = { 'America/Los_Angeles': 480, 'Asia/Tokyo': -540 } as const;
// why: the control proves the bug is real in each zone: a naive Date moves the day.
const NAIVE_SHIFT = {
  'America/Los_Angeles': { input: '2027-03-14', localDay: 13 },
  'Asia/Tokyo': { input: '2027-03-14T20:00:00.000Z', localDay: 15 },
} as const;

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

  it('control: a naive Date would move the day in this zone', () => {
    expect(new Date(NAIVE_SHIFT[zone].input).getDate()).toBe(NAIVE_SHIFT[zone].localDay);
  });

  it('formatting comes from the string: DST-change days and the leap day keep their date and weekday', () => {
    expect(formatDayLong(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027'); // US DST starts
    expect(formatDayLong(asIsoDate('2027-03-28'))).toBe('Sun 28 Mar 2027'); // UK DST starts
    expect(formatDayLong(asIsoDate('2027-10-31'))).toBe('Sun 31 Oct 2027'); // UK DST ends
    expect(formatDayLong(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatIsoDate('2027-03-14')).toBe('14 Mar 2027'); // WP9's Results formatter
  });

  it('the calendar grid renders each day under its own date and weekday', () => {
    const days = ['2027-03-13', '2027-03-14', '2027-03-15', '2027-03-28', '2027-04-01'].map((d) =>
      gridDay(d, { cheapestVerified: priceAt(41200, provenanceVerified(5), false, cellAt(d, 14)) }),
    );
    renderWithProviders(<CalendarGrid days={days} model={buildCalendarModel(days, 'verified', NOW)} destinationNotes={{}} onOpen={() => undefined} />);
    const at = (d: string) => document.querySelector(`[data-date="${d}"]`) as HTMLTableCellElement;
    expect(at('2027-03-13').cellIndex).toBe(5);
    expect(at('2027-03-14').cellIndex).toBe(6);
    expect(at('2027-03-15').cellIndex).toBe(0);
    expect(at('2027-03-14').querySelector('[aria-hidden="true"]')?.textContent).toBe('14');
    expect(at('2027-03-14')).toHaveTextContent('Sun 14 Mar 2027');
    expect(at('2027-03-28')).toHaveTextContent('Sun 28 Mar 2027');
    expect(at('2027-04-01').closest('table')).toHaveAccessibleName('April 2027');
    expect(at('2027-04-01').cellIndex).toBe(3);
  });

  it('the Results date columns render departure and return from their strings', async () => {
    const row = calendarRow({ cell: { origin: asIata('LHR'), destination: asIata('JFK'), departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-28'), nights: 14 } });
    server.use(http.get(`${API}/api/definitions/:id/results`, () => HttpResponse.json(resultsResponse({ rows: [row], total: 1 }))));
    const { findAllByText, queryAllByText } = renderWithProviders(<ResultsView definition={definition()} />);
    expect((await findAllByText(/14 Mar 2027/)).length).toBeGreaterThan(0);
    expect((await findAllByText(/28 Mar 2027/)).length).toBeGreaterThan(0);
    expect(queryAllByText(/\b(13|15) Mar 2027\b|\b(27|29) Mar 2027\b/)).toHaveLength(0);
  });
});
```

`apps/web/test/setup-tz.ts`:

```ts
// Review focus 3. Vitest runs setupFiles in each worker before importing the test file, so no Date exists yet.
// The test:tz script sets GMT_TEST_TZ; Node applies an assignment to process.env.TZ to Date and Intl immediately.
// why: a separate variable (not TZ itself) makes the zone explicit and immune to a stray shell TZ.
const forced = process.env.GMT_TEST_TZ;
if (forced !== undefined && forced !== '') process.env.TZ = forced;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/tz`
Expected: FAIL on "the zone is in effect" in both blocks under WP9's default worker pool (the zone does not re-detect in a worker thread). If WP9 already uses forks, this run passes, and the next run is the failing step.

Run: `pnpm --filter @gmt/web run test:tz`
Expected: FAIL with `Missing script: "test:tz"`.

- [ ] **Step 3: Implement**

`apps/web/vitest.config.ts` (WP9's file): keep everything and add the marked lines under `test`:

```ts
    // why: forks keep each worker a separate Node process, where assigning process.env.TZ re-detects the zone (review focus 3).
    pool: 'forks',
    // why: the Playwright smoke lives in e2e/ and runs only through `pnpm --filter @gmt/web e2e` (spec §9 item 6).
    exclude: ['e2e/**', 'node_modules/**'],
    // why: setup-tz runs first so the zone is set before anything touches Date; setup-charts sizes Recharts in jsdom.
    setupFiles: ['test/setup-tz.ts', 'test/setup.ts', 'test/setup-charts.ts'],
```

`apps/web/package.json` scripts (add or replace these four, keep WP9's others):

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
Expected: two passing runs. Each lists `test/tz/dates.tz.test.tsx` and the six `test/views/calendar/*` files.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: TZ suite under Los Angeles and Tokyo for calendar and results dates (review focus 3)"
```

### Task 10.9: View C Duration (Recharts 3)

**Files:**
- Create: `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`, `apps/web/test/views/duration.test.tsx`
- Modify: `apps/web/test/setup-charts.ts`, `apps/web/src/copy.ts` (append `durationView`), `apps/web/test/copy/catalogue.test.ts`

**Interfaces:**
- Consumes: `api.durationAnalysis`, `qk.duration`, `ViewHeader`, `PriceCell`, `PriceBoundary`, `formatPence`, `discoverySourceLabel`, `useNow`; recharts `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.
- Produces: `buildDurationData`, `DurationTooltip`, `DurationChart`, `DurationTable`, `DurationView`, `COPY.durationView`.

There is one row per nights value in `[minNights, maxNights]`:

- A nights value the api flags `searched: false`, or omits, is **not searched**.
- A searched nights value with no price for a series is **searched, no price**.

Both are `null` values that Recharts draws as gaps, never 0 and never interpolated. The table and tooltip name which case it is.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/duration.test.tsx`:

```tsx
import { render, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { DurationResponse } from '../../src/api/types.js';
import { buildDurationData } from '../../src/views/Duration/data.js';
import { DurationTooltip } from '../../src/views/Duration/DurationChart.js';
import { DurationView } from '../../src/views/Duration/DurationView.js';
import { API, definition } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { cellAt, priceAt, provenanceCalendar, provenanceVerified } from '../fixtures.wp10.js';

const c = cellAt('2027-03-14', 14);
const bare = (p: ReturnType<typeof priceAt>) => {
  const { cell: _c, itineraryHash: _h, ...rest } = p;
  return rest;
};
function night(nights: number, verified: [number, number] | null, calendar: [number, number] | null, searched = true): DurationResponse['byNights'][number] {
  return {
    nights, searched,
    minVerified: verified === null ? null : { ...bare(priceAt(verified[0], provenanceVerified(5), false, c)), n: verified[1] },
    minCalendar: calendar === null ? [] : [{ providerId: 'travelpayouts', price: bare(priceAt(calendar[0], provenanceCalendar(2), false, c)), n: calendar[1] }],
  };
}
const executions = [{ id: 'exec-0001', status: 'completed' as const, isChild: false, startedAt: '2026-10-14T12:00:00.000Z' as never, finishedAt: '2026-10-14T13:00:00.000Z' as never, ageHours: 2 }];
const resp: DurationResponse = { byNights: [night(10, [52000, 3], [41200, 5]), night(11, null, null, true), night(12, null, [39900, 4]), night(13, null, null, false)], executions };
const route = `${API}/api/definitions/:id/duration-analysis`;
const def = definition({ minNights: 10, maxNights: 14 });

describe('duration data (spec §11 View C)', () => {
  it('one row per nights in range; missing prices are null gaps, never 0, never interpolated', () => {
    const d = buildDurationData(resp, 10, 14, true);
    expect(d.rows.map((r) => r.nights)).toEqual([10, 11, 12, 13, 14]);
    expect(d.rows.map((r) => r.cells.verified?.pricePence ?? null)).toEqual([52000, null, null, null, null]);
    expect(d.rows.map((r) => r.cells['calendar:travelpayouts']?.pricePence ?? null)).toEqual([41200, null, 39900, null, null]);
  });
  it('distinguishes not searched (flag false or absent) from searched with no price', () => {
    expect(buildDurationData(resp, 10, 14, true).rows.map((r) => r.searched)).toEqual([true, true, true, false, false]);
  });
  it('names the series with n in the label', () => {
    expect(buildDurationData(resp, 10, 14, true).series.map((s) => s.name)).toEqual([
      'min among verified (class verified, n=3)',
      'calendar, Aviasales cache (constraints not checked, n=9)',
    ]);
  });
  it('omits the verified series when there is no verification provider and nothing verified', () => {
    const noV: DurationResponse = { byNights: [night(10, null, [41200, 5])], executions };
    expect(buildDurationData(noV, 10, 14, false).series.map((s) => s.key)).toEqual(['calendar:travelpayouts']);
  });
  it('is empty when no nights has a price', () => {
    expect(buildDurationData({ byNights: [night(10, null, null)], executions }, 10, 14, true).isEmpty).toBe(true);
  });
  it('the tooltip shows the nights and each series with its n, naming the gap kind', () => {
    const d = buildDurationData(resp, 10, 14, true);
    const tip = render(<DurationTooltip active payload={[{ payload: d.rows[0] }]} series={d.series} />).getByTestId('duration-tooltip');
    expect(tip).toHaveTextContent('10 nights');
    expect(tip).toHaveTextContent('min among verified: £520 (n=3)');
    expect(tip).toHaveTextContent('calendar, Aviasales cache: £412 (n=5)');
    const gap = render(<DurationTooltip active payload={[{ payload: d.rows[3] }]} series={d.series} />).getAllByTestId('duration-tooltip')[1];
    expect(gap).toHaveTextContent('min among verified: not searched (n=0)');
  });
  it('the tooltip renders nothing when inactive', () => {
    const { container } = render(<DurationTooltip active={false} payload={[]} series={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Duration view (spec §11 View C)', () => {
  it('shows an explicit loading state', () => {
    server.use(http.get(route, async () => { await delay('infinite'); return HttpResponse.json(resp); }));
    const { getByRole } = renderWithProviders(<DurationView definition={def} />);
    expect(getByRole('status')).toHaveTextContent('Loading…');
  });
  it('shows an error state', async () => {
    server.use(http.get(route, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    expect(await findByRole('alert')).toHaveTextContent('Could not load: boom');
  });
  it('shows an explicit empty state and no chart', async () => {
    server.use(http.get(route, () => HttpResponse.json({ byNights: [], executions })));
    const { findByText } = renderWithProviders(<DurationView definition={def} />);
    expect(await findByText(/^No prices yet for any stay length/)).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });
  it('draws the chart with axis titles and a legend carrying n, and tables every price with provenance', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const table = await findByRole('table', { name: 'Cheapest price per stay length, with provenance' });
    const svg = document.querySelector('.recharts-responsive-container svg');
    expect(svg?.textContent).toContain('nights');
    expect(svg?.textContent).toContain('£');
    const legend = document.querySelector('.recharts-legend-wrapper')?.textContent ?? '';
    expect(legend).toContain('min among verified (class verified, n=3)');
    expect(legend).toContain('calendar, Aviasales cache (constraints not checked, n=9)');
    expect(within(table).getAllByTestId('provenance')).toHaveLength(3);
    expect(table).toHaveTextContent('searched, no price');
    expect(table).toHaveTextContent('not searched');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/duration.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/Duration/data.js"`.

- [ ] **Step 3: Implement**

`apps/web/test/setup-charts.ts`:

```ts
// Recharts in jsdom (verified against the recharts 3 ResponsiveContainer source on 2026-10-14):
// ResponsiveContainer reads getBoundingClientRect() of its container on mount, then observes it with ResizeObserver,
// and renders no children while width or height is ≤ 0. jsdom has no ResizeObserver and reports 0×0 boxes.

class ResizeObserverStub {
  observe(): void {
    // no-op: jsdom never resizes
  }
  unobserve(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

const original = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
  // why: size only the chart container, so every other layout assertion still sees jsdom's real 0×0.
  if (this.classList.contains('recharts-responsive-container')) {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 320, width: 800, height: 320, toJSON: () => ({}) } as DOMRect;
  }
  return original.call(this);
};
```

`apps/web/src/copy.ts`: append inside `COPY`

```ts
  // View C Duration (WP10; spec §11 View C wording)
  durationView: {
    title: 'Duration',
    chartTitle: 'Cheapest price by stay length',
    xAxis: 'nights',
    yAxis: '£',
    verifiedSeries: (n: number) => `min among verified (class verified, n=${n})`,
    verifiedShort: 'min among verified',
    calendarSeries: (source: string, n: number) => `calendar, ${source} (constraints not checked, n=${n})`,
    calendarShort: (source: string) => `calendar, ${source}`,
    nightsLabel: (n: number) => `${n} nights`,
    tooltipValue: (price: string, n: number) => `${price} (n=${n})`,
    tooltipEmpty: (state: string) => `${state} (n=0)`,
    seriesLine: (series: string, value: string) => `${series}: ${value}`,
    nLabel: (n: number) => `n=${n}`,
    notSearched: 'not searched',
    searchedNoPrice: 'searched, no price',
    tableCaption: 'Cheapest price per stay length, with provenance',
    empty: "No prices yet for any stay length in this definition's range. Run a search; Coverage shows what has been searched.",
  },
```

`apps/web/test/copy/catalogue.test.ts`: add to `SAMPLES`

```ts
  'durationView.verifiedSeries': [3],
  'durationView.calendarSeries': ['Aviasales cache', 9],
  'durationView.calendarShort': ['Aviasales cache'],
  'durationView.nightsLabel': [14],
  'durationView.tooltipValue': ['£412', 5],
  'durationView.tooltipEmpty': ['not searched'],
  'durationView.seriesLine': ['calendar, Aviasales cache', '£412 (n=5)'],
  'durationView.nLabel': [5],
```

and add `'durationView.verifiedSeries', 'durationView.verifiedShort'` to the "verified" test's `allowed` set (the spec's own series label, beside class-verified values).

`apps/web/src/views/Duration/data.ts`:

```ts
import type { ProviderId } from '@gmt/core';
import type { DurationResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { discoverySourceLabel } from '../../lib/sources.js';

type Night = DurationResponse['byNights'][number];
/** A price cell as the duration route sends it. */
export type DurationPrice = Night['minCalendar'][number]['price'];
export interface DurationCell { pricePence: number | null; n: number; price: DurationPrice | null }
export interface DurationRow { nights: number; searched: boolean; cells: Record<string, DurationCell> }
export interface DurationSeries { key: string; kind: 'verified' | 'calendar'; providerId: ProviderId | null; totalN: number; name: string; shortName: string }
export interface DurationData { rows: DurationRow[]; series: DurationSeries[]; isEmpty: boolean }

/**
 * Rows for every nights in [minNights, maxNights] and one series per basis and provider (spec §11 View C).
 * Missing values stay null so the chart shows a gap (no interpolation); `searched` says which kind of gap it is.
 */
export function buildDurationData(resp: DurationResponse, minNights: number, maxNights: number, hasVerification: boolean): DurationData {
  const byNights = new Map<number, Night>(resp.byNights.map((r) => [r.nights, r]));
  const providers: ProviderId[] = [];
  for (const r of resp.byNights) for (const m of r.minCalendar) if (!providers.includes(m.providerId)) providers.push(m.providerId);
  const rows: DurationRow[] = [];
  for (let nights = minNights; nights <= maxNights; nights += 1) {
    const r = byNights.get(nights);
    const v = r?.minVerified ?? null;
    const cells: Record<string, DurationCell> = { verified: { pricePence: v?.pricePence ?? null, n: v?.n ?? 0, price: v } };
    for (const p of providers) {
      const m = r?.minCalendar.find((x) => x.providerId === p);
      cells[`calendar:${p}`] = { pricePence: m?.price.pricePence ?? null, n: m?.n ?? 0, price: m?.price ?? null };
    }
    // why: a nights value the api omits was not searched; never assume it was.
    rows.push({ nights, searched: r?.searched ?? false, cells });
  }
  const totalN = (key: string) => rows.reduce((sum, r) => sum + (r.cells[key]?.n ?? 0), 0);
  const anyVerified = rows.some((r) => r.cells.verified?.pricePence != null);
  const series: DurationSeries[] = [];
  // why: a verified series with no provider and no data would be an empty promise in the legend.
  if (hasVerification || anyVerified) {
    series.push({ key: 'verified', kind: 'verified', providerId: null, totalN: totalN('verified'), name: COPY.durationView.verifiedSeries(totalN('verified')), shortName: COPY.durationView.verifiedShort });
  }
  for (const p of providers) {
    const key = `calendar:${p}`;
    const source = discoverySourceLabel(p);
    series.push({ key, kind: 'calendar', providerId: p, totalN: totalN(key), name: COPY.durationView.calendarSeries(source, totalN(key)), shortName: COPY.durationView.calendarShort(source) });
  }
  return { rows, series, isEmpty: rows.every((r) => series.every((s) => r.cells[s.key]?.pricePence == null)) };
}

/** "not searched" or "searched, no price" for a gap. */
export function gapLabel(row: DurationRow): string {
  return row.searched ? COPY.durationView.searchedNoPrice : COPY.durationView.notSearched;
}
```

`apps/web/src/views/Duration/DurationChart.tsx`:

```tsx
import { formatPence } from '@gmt/core';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { type DurationData, type DurationRow, type DurationSeries, gapLabel } from './data.js';

// why: categorical palette, one hue per series (dataviz skill); calendar series also get a dashed outline, so colour is never the only cue.
const SERIES_COLOURS = ['#1d4ed8', '#c2410c', '#7c3aed', '#047857'] as const;
const colourAt = (i: number): string => SERIES_COLOURS[i % SERIES_COLOURS.length] ?? '#1d4ed8';
const D = COPY.durationView;

/** Custom tooltip: nights, then each series' price and n (spec §11 View C: n in label and tooltip). */
export function DurationTooltip(props: { active?: boolean | undefined; payload?: ReadonlyArray<{ payload?: unknown }> | undefined; series: readonly DurationSeries[] }) {
  const row = props.payload?.[0]?.payload as DurationRow | undefined;
  if (props.active !== true || row === undefined) return null;
  return (
    <div data-testid="duration-tooltip" className="rounded border bg-white p-2 text-xs shadow">
      <p className="font-medium">{D.nightsLabel(row.nights)}</p>
      <ul>
        {props.series.map((s) => {
          const c = row.cells[s.key];
          const value = c !== undefined && c.pricePence !== null ? D.tooltipValue(formatPence(c.pricePence), c.n) : D.tooltipEmpty(gapLabel(row));
          return <li key={s.key}>{D.seriesLine(s.shortName, value)}</li>;
        })}
      </ul>
    </div>
  );
}

/** Bars per nights with axis titles (nights, £), one series per basis and provider, gaps for missing nights. */
export function DurationChart({ data }: { data: DurationData }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.rows} margin={{ top: 8, right: 16, bottom: 28, left: 24 }} title={D.chartTitle}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="nights" label={{ value: D.xAxis, position: 'insideBottom', offset: -16 }} />
          <YAxis tickFormatter={(v: number) => formatPence(v)} label={{ value: D.yAxis, angle: -90, position: 'insideLeft' }} />
          <Tooltip content={(p) => <DurationTooltip active={p.active} payload={p.payload} series={data.series} />} />
          <Legend verticalAlign="top" />
          {data.series.map((s, i) => (
            <Bar
              key={s.key}
              name={s.name}
              dataKey={(r: DurationRow) => r.cells[s.key]?.pricePence ?? null}
              fill={colourAt(i)}
              stroke={colourAt(i)}
              {...(s.kind === 'calendar' ? { strokeDasharray: '4 2', fillOpacity: 0.55 } : {})}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The same numbers as a table, every price through PriceCell so its provenance is visible (spec §11). */
export function DurationTable({ data }: { data: DurationData }) {
  return (
    <table className="mt-4 w-full text-xs">
      <caption className="text-left font-medium">{D.tableCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{D.xAxis}</th>
          {data.series.map((s) => (
            <th key={s.key} scope="col">{s.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.nights}>
            <th scope="row">{r.nights}</th>
            {data.series.map((s) => {
              const c = r.cells[s.key];
              return (
                <td key={s.key}>
                  {c === undefined || c.price === null ? (
                    gapLabel(r)
                  ) : (
                    <>
                      <PriceBoundary>
                        <PriceCell pricePence={c.price.pricePence} provenance={c.price.provenance} calendar={s.kind === 'calendar'} stale={c.price.stale} />
                      </PriceBoundary>
                      <span>{D.nLabel(c.n)}</span>
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`apps/web/src/views/Duration/DurationView.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { buildDurationData } from './data.js';
import { DurationChart, DurationTable } from './DurationChart.js';

/** View C: cheapest price per stay length (spec §11 View C, §10 duration-analysis route). */
export function DurationView({ definition }: { definition: DefinitionResponse }) {
  const q = useQuery({ queryKey: qk.duration(definition.id), queryFn: () => api.durationAnalysis(definition.id) });
  const data = useMemo(
    () => (q.data === undefined ? null : buildDurationData(q.data, definition.minNights, definition.maxNights, definition.providers.verification.length > 0)),
    [q.data, definition],
  );
  if (q.isPending) return <p role="status">{COPY.loading}</p>;
  if (q.isError) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;
  const prices = data === null ? [] : data.rows.flatMap((r) => Object.values(r.cells).flatMap((c) => (c.price === null ? [] : [c.price])));
  return (
    <section aria-label={COPY.durationView.title} className="flex flex-col gap-4">
      <ViewHeader title={COPY.durationView.title} executions={q.data.executions} stale={prices.length > 0 && prices.every((p) => p.stale)} />
      {data === null || data.isEmpty ? (
        <p>{COPY.durationView.empty}</p>
      ) : (
        <>
          <DurationChart data={data} />
          <DurationTable data={data} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/duration.test.tsx test/copy`
Expected: PASS. The duration file passes 11 tests. If the chart test finds no `svg`, `setup-charts.ts` is not loaded; check `setupFiles` (Task 10.8).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: duration view with per-basis bars, n in label and tooltip, searched-aware gaps (spec §11 View C)"
```

### Task 10.10: History view

**Files:**
- Create: `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,HistoryView.tsx}`, `apps/web/test/views/history.test.tsx`
- Modify: `apps/web/src/copy.ts` (append `historyView`), `apps/web/test/copy/catalogue.test.ts`

**Interfaces:**
- Consumes: `api.routeHistory`, `api.itineraryHistory`, `qk.routeHistory`, `qk.itineraryHistory`, `instantMs`, `dateMs`, `formatInstantLondon`, `formatDayLong`, `effectiveAge`, `formatAgeFull`, `PriceCell`, `PriceBoundary`, `formatPence`, `discoverySourceLabel`, `useNow`, `useSearchParams`, `hrefWith`, `navigateTo`; recharts `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.
- Produces: `linesFromRoute`, `linesFromItinerary`, `HistoryChart`, `HistoryTable`, `HistoryView`, `historyHref`, `COPY.historyView`.

**x axis (spec §11 rev 10).** Provider series (calendar prices, itinerary offers) are plotted at `at` (fetchedAt). The route-level series is plotted at its own `date`, placed on the same millisecond axis by epoch-day arithmetic (`dateMs`), because its sixty points share one fetch time.

**Gaps.** A null point goes between two consecutive points of one series when they are further apart than the series' threshold, and `connectNulls={false}` breaks the line there:
- Provider series: 2 × that provider's `discoveryRefreshHours` (default 168 h).
- The daily route series: 48 h.

The reason for the rule: a series with no point for that long was not fetched, and a joined line would claim the price held steady.

**Provenance.** Provider points carry full `Provenance` and render through `PriceCell`. Route-level points carry `{ date, pricePence, fetchedAt, providerId, sourceKind }` with no cabin, so spec §11 exempts them from full provenance. They render the amount with their source in words, "route-level series, cabin unknown", and their fetched age.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/history.test.tsx`:

```tsx
import { asIata, asIsoDate } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ItineraryHistoryResponse, RouteHistoryResponse } from '../../src/api/types.js';
import { historyHref, HistoryView } from '../../src/views/History/HistoryView.js';
import { linesFromItinerary, linesFromRoute } from '../../src/views/History/lines.js';
import { API, definition } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { cellAt, hoursBefore, provenanceCalendar, provenanceVerified } from '../fixtures.wp10.js';
import { render } from '@testing-library/react';
import { HistoryTooltip } from '../../src/views/History/HistoryChart.js';

const hp = (h: number, pricePence: number, provenance = provenanceCalendar(h)) => ({ at: hoursBefore(h), pricePence, provenance });
// one point per execution fetch: the pair's minimum across its cells, with that cell and the fetching execution (plan decision 15)
const fp = (h: number, pricePence: number) => ({ ...hp(h, pricePence), cell: cellAt('2027-03-14', 14), executionId: `exec-${h}` });
const rp = (date: string, pricePence: number) => ({ date: asIsoDate(date), pricePence, fetchedAt: hoursBefore(2), providerId: 'searchapi' as const, sourceKind: 'scraped-search' as const });
const routeHistory: RouteHistoryResponse = {
  origin: asIata('LHR'), destination: asIata('JFK'),
  calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points: [fp(0, 39900), fp(1000, 45000), fp(496, 42000), fp(664, 43000)] }],
  routeSeries: [{ providerId: 'searchapi', cabin: 'unknown', points: [rp('2026-10-10', 38000), rp('2026-10-11', 38500), rp('2026-10-14', 37000)] }],
};
const itineraryHistory: ItineraryHistoryResponse = {
  itineraryHash: 'abc123',
  series: [{ providerId: 'searchapi', seller: 'Example Air', cabin: 'economy', points: [hp(5, 52000, provenanceVerified(5)), hp(173, 54000, provenanceVerified(173))] }],
};
const routeRoute = `${API}/api/routes/:origin/:destination/history`;

describe('history lines (spec §11 History)', () => {
  it('provider series: sorted by fetchedAt, a null break only where a gap exceeds the threshold', () => {
    const [calendar] = linesFromRoute(routeHistory, () => 336);
    expect(calendar?.points.map((p) => p.pricePence)).toEqual([45000, 43000, 42000, null, 39900]); // 1000→664 is 336h: no break; 496→0: break
  });
  it('the route series is plotted by its own date, with a break after a missing day', () => {
    const route = linesFromRoute(routeHistory, () => 336)[1];
    expect(route?.points[0]?.t).toBe(Date.UTC(2026, 9, 10));
    expect(route?.points.map((p) => p.pricePence)).toEqual([38000, 38500, null, 37000]);
  });
  it('labels each series by source and kind, with the spec wording for the route series', () => {
    expect(linesFromRoute(routeHistory, () => 336).map((l) => l.name)).toEqual([
      'Aviasales cache · calendar price (constraints not checked)',
      "Google's route-level lowest price, cabin unknown",
    ]);
    expect(linesFromItinerary(itineraryHistory, () => 336).map((l) => l.name)).toEqual(['Google Flights via SearchApi · itinerary offer · Example Air']);
  });
  it('a calendar fetch point names its cheapest cell in the tooltip; a known-cabin route series names the cabin', () => {
    const [calendar] = linesFromRoute(routeHistory, () => 336);
    const point = calendar?.points[0];
    const tip = render(<HistoryTooltip active payload={[{ name: calendar?.name, payload: point }]} />).getByTestId('history-tooltip');
    expect(tip).toHaveTextContent('Aviasales cache · calendar price (constraints not checked): £450');
    expect(tip).toHaveTextContent('cheapest cell LHR→JFK Sun 14 Mar–Sun 28 Mar');
    const economy = linesFromRoute({ ...routeHistory, routeSeries: [{ providerId: 'searchapi', cabin: 'economy', points: [rp('2026-10-10', 38000)] }] }, () => 336);
    expect(economy.at(-1)?.name).toBe("Google's route-level lowest price, economy");
  });
  it('drops series with no points', () => {
    expect(linesFromRoute({ ...routeHistory, calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points: [] }], routeSeries: [] }, () => 336)).toEqual([]);
  });
});

describe('History view (spec §11 History, §10 history routes)', () => {
  it('shows an explicit loading state', () => {
    server.use(http.get(routeRoute, async () => { await delay('infinite'); return HttpResponse.json(routeHistory); }));
    const { getByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(getByRole('status')).toHaveTextContent('Loading…');
  });

  it('route mode: picks among the definition pairs and fetches the chosen route', async () => {
    const paths: string[] = [];
    const cabins: Array<string | null> = [];
    server.use(http.get(routeRoute, ({ request }) => { const u = new URL(request.url); paths.push(u.pathname); cabins.push(u.searchParams.get('cabin')); return HttpResponse.json(routeHistory); }));
    const { findByLabelText, user } = renderWithProviders(<HistoryView definition={definition()} />);
    const picker = await findByLabelText('Route');
    expect([...(picker as HTMLSelectElement).options].map((o) => o.text)).toEqual(['LHR→JFK', 'LHR→EWR', 'LGW→JFK', 'LGW→EWR']);
    await waitFor(() => expect(paths.at(-1)).toBe('/api/routes/LHR/JFK/history'));
    expect(cabins.at(-1)).toBe('economy'); // routeHistoryQuerySchema { cabin?: Cabin }, the definition's cabin
    await user.selectOptions(picker, '3');
    await waitFor(() => expect(paths.at(-1)).toBe('/api/routes/LGW/EWR/history'));
  });

  it('draws one line per provider and kind with axis titles, and tables every price with its provenance or route label', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json(routeHistory)));
    const { findByRole, getByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const calendarTable = await findByRole('table', { name: /Aviasales cache · calendar price/ });
    const svg = document.querySelector('.recharts-responsive-container svg');
    expect(svg?.textContent).toContain('fetched, or price date for the route series (Europe/London)');
    expect(svg?.textContent).toContain('£');
    expect(document.querySelector('.recharts-legend-wrapper')?.textContent).toContain("Google's route-level lowest price, cabin unknown");
    expect(within(calendarTable).getAllByTestId('provenance')).toHaveLength(4);
    const routeTable = getByRole('table', { name: /route-level lowest price/ });
    expect(within(routeTable).getAllByText('Google Flights via SearchApi · route-level series, cabin unknown · fetched 2h ago · provider age unknown')).toHaveLength(3);
    expect(routeTable).toHaveTextContent('Sat 10 Oct 2026');
    expect(within(routeTable).queryAllByTestId('provenance')).toHaveLength(0);
  });

  it('shows the empty state when there is no history', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json({ ...routeHistory, calendarSeries: [], routeSeries: [] })));
    const { findByText } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(await findByText('No price history yet for this selection. Each run adds a point.')).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('shows an error state', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(await findByRole('alert')).toHaveTextContent('Could not load: boom');
  });

  it('itinerary mode (?hash=) fetches the itinerary history', async () => {
    const paths: string[] = [];
    server.use(http.get(`${API}/api/itineraries/:hash/history`, ({ request }) => { paths.push(new URL(request.url).pathname); return HttpResponse.json(itineraryHistory); }));
    const { findByText } = renderWithProviders(<HistoryView definition={definition()} />, { search: '?view=history&hash=abc123' });
    expect(await findByText(/Itinerary abc123/)).toBeInTheDocument();
    await waitFor(() => expect(paths.at(-1)).toBe('/api/itineraries/abc123/history'));
  });

  it('historyHref keeps the other URL parameters and sets view and hash', () => {
    window.history.replaceState(null, '', '/?view=results&def=def-0001');
    const href = historyHref('abc 123');
    expect(new URLSearchParams(href.split('?')[1]).get('view')).toBe('history');
    expect(new URLSearchParams(href.split('?')[1]).get('hash')).toBe('abc 123');
    expect(new URLSearchParams(href.split('?')[1]).get('def')).toBe('def-0001');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/history.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/History/HistoryView.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/copy.ts`: append inside `COPY`

```ts
  // History (WP10; spec §11 History; the route label is spec §7's wording)
  historyView: {
    title: 'History',
    chartTitle: 'Price history',
    xAxis: 'fetched, or price date for the route series (Europe/London)',
    yAxis: '£',
    routeLowestSeries: "Google's route-level lowest price, cabin unknown",
    routeLowestSeriesCabin: (cabin: string) => `Google's route-level lowest price, ${cabin}`,
    cheapestCell: (origin: string, destination: string, dep: string, ret: string) => `cheapest cell ${origin}→${destination} ${dep}–${ret}`,
    tooltipLine: (series: string, price: string) => `${series}: ${price}`,
    offerSeries: (source: string, seller: string) => `${source} · itinerary offer · ${seller}`,
    calendarSeries: (source: string) => `${source} · calendar price (constraints not checked)`,
    routePicker: 'Route',
    pairOption: (origin: string, destination: string) => `${origin}→${destination}`,
    itineraryHeading: (hash: string) => `Itinerary ${hash}`,
    backToRoute: 'Show route history',
    tableCaption: (series: string) => `${series}: prices with provenance`,
    whenColumn: 'When',
    priceColumn: 'Price',
    provenanceColumn: 'Provenance',
    routeProvenance: (source: string, age: string) => `${source} · route-level series, cabin unknown · ${age}`,
    rowLink: 'price history',
    empty: 'No price history yet for this selection. Each run adds a point.',
  },
```

`apps/web/test/copy/catalogue.test.ts`: add to `SAMPLES`

```ts
  'historyView.offerSeries': ['Google Flights via SearchApi', 'Example Air'],
  'historyView.routeLowestSeriesCabin': ['economy'],
  'historyView.cheapestCell': ['LHR', 'JFK', 'Sun 14 Mar', 'Sun 28 Mar'],
  'historyView.tooltipLine': ["Google's route-level lowest price, cabin unknown", '£380'],
  'historyView.calendarSeries': ['Aviasales cache'],
  'historyView.pairOption': ['LHR', 'JFK'],
  'historyView.itineraryHeading': ['abc123'],
  'historyView.tableCaption': ['Aviasales cache · calendar price (constraints not checked)'],
  'historyView.routeProvenance': ['Google Flights via SearchApi', 'fetched 2h ago · provider age unknown'],
```

`apps/web/src/views/History/lines.ts`:

```ts
import type { Cell, Provenance, ProviderId } from '@gmt/core';
import type { ItineraryHistoryResponse, RouteHistoryResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { discoverySourceLabel } from '../../lib/sources.js';
import { dateMs, instantMs } from '../../lib/time.js';

export type RoutePoint = RouteHistoryResponse['routeSeries'][number]['points'][number];
type ProviderPoint = ItineraryHistoryResponse['series'][number]['points'][number];
type CalendarFetchPoint = RouteHistoryResponse['calendarSeries'][number]['points'][number];
/** One plotted point: provider points carry provenance, route points carry their own record; gap points carry neither. */
export interface HistoryPoint { t: number; pricePence: number | null; provenance: Provenance | null; route: RoutePoint | null; cell: Cell | null }
export interface HistoryLine { key: string; kind: 'offer' | 'calendar' | 'route-lowest'; providerId: ProviderId; name: string; points: HistoryPoint[] }

const HOUR_MS = 3_600_000;
// why: route_price_history is a daily series (spec §7); a missing day beyond one is a gap.
const ROUTE_GAP_HOURS = 48;

/** Sorts by t and inserts a null point wherever two neighbours are more than `limitMs` apart (connectNulls false breaks there). */
function withGaps(points: HistoryPoint[], limitMs: number): HistoryPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: HistoryPoint[] = [];
  let prev: number | null = null;
  for (const p of sorted) {
    if (prev !== null && p.t - prev > limitMs) out.push({ t: prev + (p.t - prev) / 2, pricePence: null, provenance: null, route: null, cell: null });
    out.push(p);
    prev = p.t;
  }
  return out;
}

const fromProvider = (p: ProviderPoint): HistoryPoint => ({ t: instantMs(p.at), pricePence: p.pricePence, provenance: p.provenance, route: null, cell: null });
// why: plan decision 15 — the route's calendar series is one point per execution fetch, the pair's minimum across its cells;
// the point carries that cheapest cell so the tooltip and table can name it.
const fromFetch = (p: CalendarFetchPoint): HistoryPoint => ({ t: instantMs(p.at), pricePence: p.pricePence, provenance: p.provenance, route: null, cell: p.cell });

/** Route history: calendar series at fetchedAt, the route-level series at its own date (spec §11 History). */
export function linesFromRoute(resp: RouteHistoryResponse, gapHours: (providerId: ProviderId) => number): HistoryLine[] {
  const calendar: HistoryLine[] = resp.calendarSeries
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      key: `calendar:${s.providerId}`, kind: 'calendar', providerId: s.providerId,
      name: COPY.historyView.calendarSeries(discoverySourceLabel(s.providerId)),
      points: withGaps(s.points.map(fromFetch), gapHours(s.providerId) * HOUR_MS),
    }));
  const route: HistoryLine[] = resp.routeSeries
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      // why: route-level series are per cabin (plan contracts v3); the spec's wording names an unknown cabin as such.
      key: `route:${s.providerId}:${s.cabin}`, kind: 'route-lowest', providerId: s.providerId,
      name: s.cabin === 'unknown' ? COPY.historyView.routeLowestSeries : COPY.historyView.routeLowestSeriesCabin(COPY.cabinName[s.cabin]),
      points: withGaps(s.points.map((p) => ({ t: dateMs(p.date), pricePence: p.pricePence, provenance: null, route: p, cell: null })), ROUTE_GAP_HOURS * HOUR_MS),
    }));
  return [...calendar, ...route];
}

/** Itinerary history: one offer series per provider and seller, at fetchedAt. */
export function linesFromItinerary(resp: ItineraryHistoryResponse, gapHours: (providerId: ProviderId) => number): HistoryLine[] {
  return resp.series
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      key: `offer:${s.providerId}:${s.seller}`, kind: 'offer', providerId: s.providerId,
      // why: the series' own provenance names its source; every point of one series shares it.
      name: COPY.historyView.offerSeries(COPY.source[s.points[0]?.provenance.sourceKind ?? 'scraped-search'], s.seller),
      points: withGaps(s.points.map(fromProvider), gapHours(s.providerId) * HOUR_MS),
    }));
}
```

`apps/web/src/views/History/HistoryChart.tsx`:

```tsx
import { effectiveAge, formatAgeFull, formatPence, type IsoDateTime } from '@gmt/core';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayLong, formatDayShort } from '../../lib/isoDate.js';
import { formatInstantLondon } from '../../lib/time.js';
import type { HistoryLine, HistoryPoint } from './lines.js';

const H = COPY.historyView;
const COLOURS = ['#1d4ed8', '#c2410c', '#7c3aed', '#047857'] as const;
const colourAt = (i: number): string => COLOURS[i % COLOURS.length] ?? '#1d4ed8';
// why: line style backs up colour (no colour-only meaning): calendar dashed, route-level dotted, offers solid.
const DASH: Readonly<Record<HistoryLine['kind'], string | null>> = { offer: null, calendar: '5 3', 'route-lowest': '2 2' };

/** One line per provider and kind on a shared time axis, with gaps (spec §11 History). */
export function HistoryChart({ lines }: { lines: readonly HistoryLine[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 16, bottom: 28, left: 24 }} title={H.chartTitle}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => formatInstantLondon(v)} label={{ value: H.xAxis, position: 'insideBottom', offset: -16 }} />
          <YAxis tickFormatter={(v: number) => formatPence(v)} label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }} />
          <Tooltip content={(p) => <HistoryTooltip active={p.active} payload={p.payload} />} />
          <Legend verticalAlign="top" />
          {lines.map((l, i) => {
            const dash = DASH[l.kind];
            return (
              <Line key={l.key} data={l.points} dataKey="pricePence" name={l.name} type="linear" connectNulls={false} stroke={colourAt(i)} {...(dash === null ? {} : { strokeDasharray: dash })} dot isAnimationActive={false} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Custom tooltip: when, each series' price, and for a calendar fetch the cheapest cell it came from (plan decision 15). */
export function HistoryTooltip(props: { active?: boolean | undefined; payload?: ReadonlyArray<{ name?: unknown; payload?: unknown }> | undefined }) {
  const items = (props.payload ?? []).flatMap((e) => {
    const point = e.payload as HistoryPoint | undefined;
    return point === undefined || point.pricePence === null ? [] : [{ name: String(e.name ?? ''), point: point as Plotted }];
  });
  const first = items[0];
  if (props.active !== true || first === undefined) return null;
  return (
    <div data-testid="history-tooltip" className="rounded border bg-white p-2 text-xs shadow">
      <p className="font-medium">{first.point.route !== null ? formatDayLong(first.point.route.date) : formatInstantLondon(first.point.t)}</p>
      <ul>
        {items.map(({ name, point }) => (
          <li key={name}>
            {H.tooltipLine(name, formatPence(point.pricePence))}
            {point.cell !== null ? <span className="block">{H.cheapestCell(point.cell.origin, point.cell.destination, formatDayShort(point.cell.departureDate), formatDayShort(point.cell.returnDate))}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Plotted = HistoryPoint & { pricePence: number };

/** Every point of one line: provider prices through PriceCell; route-level prices with source, "cabin unknown" and fetched age (spec §11). */
export function HistoryTable({ line, now }: { line: HistoryLine; now: IsoDateTime }) {
  const points = line.points.filter((p): p is Plotted => p.pricePence !== null);
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="text-left font-medium">{H.tableCaption(line.name)}</caption>
        <thead>
          <tr>
            <th scope="col">{H.whenColumn}</th>
            <th scope="col">{H.priceColumn}</th>
            <th scope="col">{H.provenanceColumn}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) =>
            p.route !== null ? (
              <tr key={p.t}>
                <td>{formatDayLong(p.route.date)}</td>
                {/* why: spec §11 rev 10 — the route-level series has no cabin, so no full provenance; it shows source and fetched age instead */}
                <td>{formatPence(p.pricePence)}</td>
                <td>{H.routeProvenance(COPY.source[p.route.sourceKind], formatAgeFull(effectiveAge({ fetchedAt: p.route.fetchedAt, maxAgeHours: 'unknown' }, now)))}</td>
              </tr>
            ) : (
              <tr key={p.t}>
                <td>
                  {formatInstantLondon(p.t)}
                  {p.cell !== null ? <span className="block">{H.cheapestCell(p.cell.origin, p.cell.destination, formatDayShort(p.cell.departureDate), formatDayShort(p.cell.returnDate))}</span> : null}
                </td>
                <td colSpan={2}>
                  <PriceBoundary>
                    <PriceCell pricePence={p.pricePence} provenance={p.provenance ?? undefined} calendar={line.kind === 'calendar'} stale={false} />
                  </PriceBoundary>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
```

`apps/web/src/views/History/HistoryView.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { HistoryChart, HistoryTable } from './HistoryChart.js';
import { type HistoryLine, linesFromItinerary, linesFromRoute } from './lines.js';

const H = COPY.historyView;

/** Link to one itinerary's history (WP9's expanded row); keeps every other URL parameter. */
export function historyHref(itineraryHash: string): string {
  return hrefWith({ view: 'history', hash: itineraryHash });
}

/** History: route history by default, itinerary history with ?hash= (spec §11 History, §10). */
export function HistoryView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const hash = useSearchParams().get('hash');
  const pairs = useMemo(() => definition.origins.flatMap((origin) => definition.destinations.map((destination) => ({ origin, destination }))), [definition]);
  const [pairIndex, setPairIndex] = useState(0);
  const pair = pairs[pairIndex] ?? null;
  // why: two refresh cycles without a point is a gap, not a steady price (spec §11 "gaps"); default refresh is 168 h (§7).
  const gap = (id: keyof typeof definition.providers.discoveryRefreshHours) => 2 * (definition.providers.discoveryRefreshHours[id] ?? 168);
  const itinerary = useQuery({ queryKey: qk.itineraryHistory(hash ?? ''), queryFn: () => api.itineraryHistory(hash ?? ''), enabled: hash !== null && hash !== '' });
  const route = useQuery({
    queryKey: qk.routeHistory(pair?.origin ?? '', pair?.destination ?? '', definition.cabin),
    queryFn: () => (pair === null ? Promise.reject(new Error('no route')) : api.routeHistory(pair.origin, pair.destination, definition.cabin)),
    enabled: (hash === null || hash === '') && pair !== null,
  });
  const q = hash !== null && hash !== '' ? itinerary : route;
  const lines: HistoryLine[] = useMemo(() => {
    if (hash !== null && hash !== '') return itinerary.data === undefined ? [] : linesFromItinerary(itinerary.data, gap);
    return route.data === undefined ? [] : linesFromRoute(route.data, gap);
  }, [hash, itinerary.data, route.data]);

  return (
    <section aria-label={H.title} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{H.title}</h2>
      {hash !== null && hash !== '' ? (
        <p>
          {H.itineraryHeading(hash)}{' '}
          <a href={hrefWith({ hash: null })} onClick={navigateTo({ hash: null })} className="underline">{H.backToRoute}</a>
        </p>
      ) : (
        <label className="flex flex-col text-sm">
          {H.routePicker}
          <select value={String(pairIndex)} onChange={(e) => setPairIndex(Number(e.target.value))} className="rounded border px-2 py-1">
            {pairs.map((p, i) => (
              <option key={`${p.origin}-${p.destination}`} value={String(i)}>{H.pairOption(p.origin, p.destination)}</option>
            ))}
          </select>
        </label>
      )}
      {q.isPending ? (
        <p role="status">{COPY.loading}</p>
      ) : q.isError ? (
        <p role="alert">{COPY.loadFailed(q.error.message)}</p>
      ) : lines.length === 0 ? (
        <p>{H.empty}</p>
      ) : (
        <>
          <HistoryChart lines={lines} />
          {lines.map((l) => (
            <HistoryTable key={l.key} line={l} now={now} />
          ))}
        </>
      )}
    </section>
  );
}
```

(The `useMemo` dependency list leaves out `gap`, which depends only on `definition`. Add `definition` to the list if Biome's `useExhaustiveDependencies` asks.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/history.test.tsx test/copy`
Expected: PASS. The history file passes 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: history view, provider series by fetchedAt and route series by date, with gaps"
```

### Task 10.11: Wire the views into WP9's shell, and link Results to history

**Files:**
- Create: `apps/web/test/app/wp10Wiring.test.tsx`
- Modify: `apps/web/src/App.tsx` (WP9), `apps/web/src/views/Results/ExpandedRow.tsx` (WP9)

**Interfaces:**
- Consumes: `App`, `ExpandedRow`, `verifiedRow`, `calendarRow`, `hrefWith`, `navigateTo`.
- Produces: the Calendar, Duration and History views behind WP9's nav; the "price history" link on expanded rows that have an itinerary hash.

- [ ] **Step 1: Write the failing test**

`apps/web/test/app/wp10Wiring.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { ExpandedRow } from '../../src/views/Results/ExpandedRow.js';
import { API, calendarRow, verifiedRow } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { day, disc } from '../fixtures.wp10.js';

const executions = [{ id: 'exec-0001', status: 'completed', isChild: false, startedAt: '2026-10-14T12:00:00.000Z', finishedAt: '2026-10-14T13:00:00.000Z', ageHours: 2 }];

describe('WP10 views in the shell (no placeholder left)', () => {
  it('?view=calendar renders the calendar grid', async () => {
    server.use(http.get(`${API}/api/definitions/:id/calendar`, () =>
      HttpResponse.json({ days: [day('2027-03-14', { discovery: [disc('travelpayouts', { not_run: 48 })] })], executions, staleAfterHours: 192, calendarStaleAfterHours: { travelpayouts: 216, searchapi: 192, fixture: 168 } }),
    ));
    const { findByRole, queryByText } = renderWithProviders(<App />, { search: '?view=calendar&def=def-0001' });
    expect(await findByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
    expect(queryByText('This view is coming in WP10.')).toBeNull();
  });

  it('?view=duration renders the duration view', async () => {
    server.use(http.get(`${API}/api/definitions/:id/duration-analysis`, () => HttpResponse.json({ byNights: [], executions })));
    const { findByText } = renderWithProviders(<App />, { search: '?view=duration&def=def-0001' });
    expect(await findByText(/^No prices yet for any stay length/)).toBeInTheDocument();
  });

  it('?view=history renders the history view', async () => {
    server.use(http.get(`${API}/api/routes/:origin/:destination/history`, () => HttpResponse.json({ origin: 'LHR', destination: 'JFK', calendarSeries: [], routeSeries: [] })));
    const { findByText } = renderWithProviders(<App />, { search: '?view=history&def=def-0001' });
    expect(await findByText('No price history yet for this selection. Each run adds a point.')).toBeInTheDocument();
  });

  it('an expanded Results row with an itinerary links to its history; a calendar row does not', () => {
    const first = renderWithProviders(<ExpandedRow row={verifiedRow({ itineraryHash: 'abc123' })} extras={false} verificationConfigured definitionId="def-0001" />, { search: '?view=results&def=def-0001' });
    const href = first.getByRole('link', { name: 'price history' }).getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('view')).toBe('history');
    expect(params.get('hash')).toBe('abc123');
    first.unmount();
    const second = renderWithProviders(<ExpandedRow row={calendarRow()} extras={false} verificationConfigured definitionId="def-0001" />);
    expect(second.queryByRole('link', { name: 'price history' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/app/wp10Wiring.test.tsx`
Expected: FAIL. The three view tests time out on `findBy…`, because the placeholder "This view is coming in WP10." renders instead. The link test fails with `Unable to find an accessible element with the role "link" and name "price history"`.

- [ ] **Step 3: Implement**

`apps/web/src/App.tsx` (WP9's final version): add the imports and replace the placeholder line.

```tsx
import { CalendarView } from './views/Calendar/CalendarView.js';
import { DurationView } from './views/Duration/DurationView.js';
import { HistoryView } from './views/History/HistoryView.js';

// needsDefinition now covers the WP10 views too:
const needsDefinition = view === 'results' || view === 'coverage' || view === 'calendar' || view === 'duration' || view === 'history';

// replaces {view === 'calendar' || view === 'duration' || view === 'history' ? <Placeholder wp="WP10" /> : null}
{view === 'calendar' && selected !== null ? <CalendarView definition={selected} /> : null}
{view === 'duration' && selected !== null ? <DurationView definition={selected} /> : null}
{view === 'history' && selected !== null ? <HistoryView definition={selected} /> : null}
```

`apps/web/src/views/Results/ExpandedRow.tsx` (WP9): add the imports and, after the search link, the history link:

```tsx
import { navigateTo } from '../../state/urlState.js';
import { historyHref } from '../History/HistoryView.js';

{row.itineraryHash !== null ? (
  <a href={historyHref(row.itineraryHash)} onClick={navigateTo({ view: 'history', hash: row.itineraryHash })} className="underline">
    {COPY.historyView.rowLink}
  </a>
) : null}
```

If WP9's `Placeholder` is now used only for Alerts, keep it (WP11 replaces that one).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/app test/copy test/views`
Expected: PASS: WP10's 4 wiring tests, WP9's shell, copy and rendered-sweep tests (the sweep now visits the real WP10 views), and every view test.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar, duration and history views in the shell; results link to itinerary history"
```

### Task 10.12: Playwright smoke in fixture mode (spec §9 item 6)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/prepare-db.mjs`
- Modify: `apps/web/vite.config.ts` (WP9: the proxy target), root `.gitignore`

**Interfaces:**
- Consumes: `pnpm --filter @gmt/api start` (WP8); fixture mode per spec §5.5 (the fixture host is reached through http-kit's gated `inProcessHosts`, installed by WP4b's wiring in fixture mode; plan decision 7); WP9's `COPY` and the Definitions form's provider checkbox ids `p-d-<id>` / `p-v-<id>`.
- Produces: `pnpm --filter @gmt/web e2e`. It is excluded from `pnpm test`: vitest `exclude: ['e2e/**']`, and the root `pnpm test` runs vitest only.

The smoke drives the real api in fixture mode and the built SPA through `vite preview`, whose proxy is WP9's `server.proxy` (Vite's `preview.proxy` defaults to it). The api environment meets `syntheticAllowed` (spec §5.5): `NODE_ENV=development`, `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake`, a `.fixture.db` path, and no `IN_CONTAINER`. It binds loopback, so no auth is needed (spec §4). It disables auto-resume and sets the confirmation threshold high, so the run starts without a cost prompt.

- [ ] **Step 1: Write the failing test**

`apps/web/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { COPY } from '../src/copy.js';

// Spec §9 item 6: one Playwright smoke in fixture mode. Every price here is synthetic, and the red banner must say so.
test('fixture mode: import example, run, and the Results header shows a price with provenance under the synthetic banner', async ({ page }) => {
  await page.goto('/?view=definitions');
  await page.getByRole('button', { name: COPY.importExample }).click();

  // why: the example JSON names the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const prefix of ['p-d-', 'p-v-']) {
    for (const box of await page.locator(`input[type="checkbox"][id^="${prefix}"]`).all()) await box.uncheck();
    await page.locator(`#${prefix}fixture`).check();
  }
  await page.getByRole('button', { name: /^Create and confirm up to/ }).click();
  await page.getByRole('button', { name: COPY.runNow }).click();

  const headline = page.getByText(/^cheapest found £\d/);
  await expect(async () => {
    await page.goto('/?view=results');
    await expect(headline).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  // Provenance on the headline (spec §11): the source in words and the effective age.
  await expect(headline).toContainText(COPY.source.synthetic);
  await expect(headline).toContainText(/ago|just now/);

  const banner = page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/bg-red-700/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web e2e`
Expected: FAIL. Playwright reports `Error: No tests found` or a config load error, because `playwright.config.ts` does not exist yet.

- [ ] **Step 3: Implement**

`apps/web/e2e/prepare-db.mjs`:

```js
#!/usr/bin/env node
// Prepares a fresh database for the fixture-mode smoke. Spec §5.5: fixture mode needs a path ending in .fixture.db,
// and the api realpath-resolves it at boot, so the directory must exist first. Run by the api webServer command.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DATABASE_PATH;
if (!path || !path.endsWith('.fixture.db')) {
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

// Spec §9 item 6: one smoke in fixture mode. Excluded from `pnpm test`; run with `pnpm --filter @gmt/web e2e`.
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
  use: { ...devices['Desktop Chrome'], baseURL: WEB_ORIGIN, trace: 'retain-on-failure' },
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

`apps/web/vite.config.ts` (WP9): change only the proxy target, so dev keeps its default and the smoke points the preview at its own api.

```ts
// why: the Playwright smoke runs its own fixture-mode api on another port; dev keeps the default. preview.proxy inherits server.proxy.
const API_ORIGIN = process.env.GMT_API_ORIGIN ?? 'http://localhost:3000';
// in server.proxy, every entry's target becomes API_ORIGIN:
proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, { target: API_ORIGIN }])),
```

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
Expected: the workspace builds, both servers start, and the reporter prints `1 passed`.

Run: `pnpm test`
Expected: no file under `apps/web/e2e/` is listed.

- [ ] **Step 5: Commit**

```bash
git add apps/web .gitignore && git commit -m "wp10: Playwright smoke in fixture mode (spec §9 item 6)"
```

## 9. Pinned review-focus tests

- **Review focus 3** (plan: "The browser runs outside Europe/London … a day never shifts by one. Owner: WP10"):
  - **Task 10.8**, `test/tz/dates.tz.test.tsx`, runs under `America/Los_Angeles` and `Asia/Tokyo` in two ways: in-process per `describe.each` block, and as whole processes via `pnpm --filter @gmt/web run test:tz`, where `GMT_TEST_TZ` is copied to `process.env.TZ` in `test/setup-tz.ts` before any Date is built. In each zone it asserts:
    - the zone took effect;
    - a naive `Date` would shift the day (the control);
    - the US and UK DST-change days and the leap day keep their date and weekday;
    - the calendar grid puts each day under its own weekday and month;
    - WP9's Results renders departure and return from their strings.
  - **Task 10.2**, `test/lib/noDateParsing.test.ts`, fails on any `new Date(`, `Date.parse(`, local date getter or `toLocale*String(` in `apps/web/src` outside `lib/time.ts` and `now.tsx`. The scanner's own positive cases keep it from being vacuous.

## 10. Definition of done

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/web test` | Every web test passes. Coverage meets lines ≥ 70%, branches ≥ 60%, functions ≥ 70%, statements ≥ 70%. Then `test:tz` prints two passing runs (Los Angeles, Tokyo). |
| `pnpm test` | The root run passes and lists no `e2e/` file. |
| `pnpm --filter @gmt/web exec vitest run test/copy` | PASS: catalogue (every new function sampled, no banned word, "verified" only on allowed paths), source guard, rendered sweep. |
| `pnpm --filter @gmt/web exec vitest run test/lib/noDateParsing.test.ts` | PASS. |
| `pnpm --filter @gmt/web e2e` | `1 passed`. |
| `pnpm lint` | Biome reports no errors. |
| `pnpm -r typecheck` | Clean, including the `z.infer` types over the contract v2 schemas. |
| `node scripts/check-boundaries.mjs` | Exit 0. `@gmt/web` imports only `@gmt/core` among workspace packages; no `process.env` under `apps/web/src`; no airport literal in `apps/web/src` outside the allowlisted `example.ts`. |

## 11. Open questions

None. The route-series x axis was decided at reconciliation (spec §11 rev 10: plotted by its own `date`, carrying `{ date, pricePence, fetchedAt, providerId, sourceKind }` instead of full provenance). The `/api` prefix, web dependencies, React 19, the `src/`-only `process.env` rule, the client-side colour toggle and the fixture host seam are settled by the plan's "Decisions taken at reconciliation".

Items the WP9 reconciliation must carry, which this brief relies on:
- `COPY.source['scraped-aggregate']` reads "Google date grid via SearchApi" (spec rev 10 §11).
- `ViewHeader` accepts the contract's `ExecutionSummary`, whose `ageHours` may be `'unknown'`.
- `test/fixtures.ts` and the msw handlers use the `/api` paths and the contract v2 shapes.
