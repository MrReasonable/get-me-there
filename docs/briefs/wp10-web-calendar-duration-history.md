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

## 1. Goal

Add the calendar heatmap, the price-by-stay-length chart and the price history view to `@gmt/web`. Every price on them carries provenance, unsearched never looks like "no flights", and the browser's timezone never shifts a date. Add one Playwright smoke that drives the real api in fixture mode.

## 2. Scope

**In**

- View B Calendar (`apps/web/src/views/Calendar/*`). Each day shows one price, chosen by the §11 precedence with the §8.1 staleness rules and `compareAges` from core. Days are coloured by one basis at a time on a quintile scale; days showing the other basis are hatched. The legend is numeric. Days without a price show distinct glyphs with text alternatives. Each day carries the five-way discovery marker and the separate itinerary-search line; the header shows the reused count. The view has a per-destination filter, a keyboard-operable grid with visible focus, and a side panel. The panel shows one cell's outcomes and prices with full provenance and the per-cell verify action, which is hidden when the definition has no verification provider.
- View C Duration (`apps/web/src/views/Duration/*`): Recharts 3 bar chart per nights, the verified series and one calendar series per provider, `n` in the legend label and the tooltip, gaps with no interpolation, axis titles, explicit loading, empty and error states, and an accessible data table.
- History (`apps/web/src/views/History/*`): route history (`GET /routes/:o/:d/history`) and itinerary history (`GET /itineraries/:hash/history`), one line per provider and kind, x = `fetchedAt`, gaps, axis titles, an empty state, and the route series labelled "Google's route-level lowest price, cabin unknown".
- Date handling for review focus 3. `src/lib/isoDate.ts` renders `YYYY-MM-DD` strings with no `Date`. `src/lib/time.ts` is the only file allowed to construct a `Date`. A grep test enforces that rule over all of `apps/web/src` (WP9 code included). A TZ suite runs under `America/Los_Angeles` and `Asia/Tokyo`.
- The string catalogue additions for the three views, plus a banned-word test and a reserved-"verified" test over them.
- Registering the three views in WP9's view registry, and a link from WP9's Results expanded row to itinerary history.
- The Playwright smoke in fixture mode: `apps/web/playwright.config.ts`, `apps/web/e2e/*`, and the `e2e` script. The smoke is excluded from `pnpm test`.

**Out**

- The shell, nav, definition selector, status bar, view header, `Provenance` component, typed api client, `src/strings.ts` base catalogue, Definitions form, Results (View A), Coverage (View D) and Providers belong to **WP9**. WP10 only adds entries and edits two WP9 files, both named in §7.
- Every api route, its SQL and the `stale`/`ageHours` computation belong to **WP8**. The view uses `stale` as the api sends it and never recomputes staleness thresholds.
- The response schemas in `core/api-contract/results.ts` belong to **WP0**. Fields WP10 needs that the plan does not list are reported in §11 and are not added here.
- `effectiveAge`, `compareAges` and `formatAge*` belong to **WP0**. `toEpochDay`, `fromEpochDay`, `addDays`, `monthOf` and `monthsSpanned` belong to **WP1**.
- The fixture provider and the fixture-mode api route that serves `http://fixture.local` belong to **WP4** and **WP8**. The example JSON in `docs/setup.md` belongs to **WP12**.
- The Alerts UI belongs to **WP11**.

## 3. Spec sections

- **§11 View B**: the day shows, by precedence, the cheapest class-verified price under `STALE_AFTER_HOURS`; otherwise the fresher of a stale verified price and the cheapest calendar price (labelled, with unknown age losing to known); otherwise glyphs. Colour uses one basis at a time on a quintile scale over the visible days of that basis. Fallback days are hatched and excluded from the scale, and the legend says which basis each day uses. The marker reads "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M", and "itinerary-searched 1 of 10 selected +C on demand" appears separately. `empty`, `no_data`, `error` and `not_run` each get a distinct glyph. The legend is numeric. The view has a per-destination filter and a side panel with cells, outcomes and verify.
- **§11 View C**: bars per nights with axis titles (nights, £). The series are "min among verified (class verified, n=…)" and calendar per provider. `n` appears in the label and the tooltip. Loading and empty states are explicit. Unsearched nights leave gaps, with no interpolation.
- **§11 History**: one series per provider and kind, x = `fetchedAt`, gaps, reused rows excluded (the api excludes them), axis titles, an empty state.
- **§11 Accessibility**: the calendar is keyboard-operable with visible focus, controls are labelled, no meaning is carried by colour alone, and the heatmap has a numeric legend. Provenance on every price is visible without hover. Calendar prices get a dashed outline and "constraints not checked". "≈" marks an FX-converted price.
- **§8.1 Staleness per price**: verified-basis staleness uses `STALE_AFTER_HOURS` and calendar-basis staleness uses `discoveryRefreshHours + maxAgeHours`. Both arrive as `stale` on each price cell. Stale prices are returned and labelled, never hidden. Unknown age loses to any known age, and ties go to verified.
- **§3**: the six buckets, which sum to the cell count. Reused outcomes count in their own bucket, and the header adds "(R reused from earlier runs)". The word "verified" is reserved for the class, and stage counts say "itinerary-searched". The compact and full age label formats come from core.
- **§10**: `GET /definitions/:id/calendar`, `GET /definitions/:id/duration-analysis`, `GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`, `POST /cells/verify`, `GET /itineraries/:hash/history` and `GET /routes/:o/:d/history`.
- **§9 item 6**: View B states, including the partial-day five-way marker and the per-basis colour scale with hatched fallback days. Chart empty and loading states. Keyboard operation. A banned-word test with word boundaries. A price lacking provenance fails to render. One Playwright smoke in fixture mode.

## 4. Interfaces consumed

### From the plan's "Cross-package contracts" (verbatim)

```ts
// types/ids.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$, upper-case
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const isoDateTimeSchema: z.ZodType<IsoDateTime>; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ and Date.parse round-trips
export function asIata(s: string): Iata;           // throws on mismatch; used by tests and seeds, never on user input (zod does that)
export function asIsoDate(s: string): IsoDate;
export function asIsoDateTime(s: string): IsoDateTime;

// types/provenance.ts (WP0)
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}

// types/definition.ts (WP0)
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface ProvidersConfig { discovery: ProviderId[]; verification: ProviderId[]; discoveryRefreshHours: Partial<Record<ProviderId, number>> }

// labels/age.ts (WP0)
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;   // hours as non-negative numbers, clamped at 0
export function formatAgeFull(a: EffectiveAge): string;
export function formatAgeCompact(a: EffectiveAge): string;
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;  // unknown loses to any known; otherwise by worst-case hours

// text/bannedWords.ts (WP0)
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// WP1 (plan "WP1 — Produces")
toEpochDay(IsoDate): number, fromEpochDay(number): IsoDate, addDays(IsoDate, n): IsoDate, monthOf(IsoDate): IsoMonth
```

WP0's Task 0.7 tests fix the sign of `compareAges`: `compareAges(a, b) < 0` when `a` is fresher, and an unknown age compares greater than any known one.

From the plan's API contract block (`api-contract/common.ts`, WP0, verbatim from Task 0.8):

```ts
export const priceCellSchema = z.object({ pricePence: moneyPenceSchema, provenance: provenanceSchema, stale: z.boolean(), ageHours: ageHoursSchema });
export const bucketsSchema = z.object({ priced: …, empty: …, no_data: …, error: …, skipped: …, not_run: …, reused: … });   // all z.number().int().min(0)
export const bookingSchema = z.discriminatedUnion('kind', [ /* get | post | none, host on get/post */ ]);
```

The plan names these `results.ts` schemas but does not list their fields: `calendarResponseSchema` ("per day as spec §10"), `durationAnalysisResponseSchema`, `cellDetailResponseSchema` and `historyResponseSchema`. `definitionResponseSchema` is `SearchDefinition` plus `budgetFit` plus `estimate`, and `ROUTES` is `readonly RouteDef[]`.

### Fields this brief needs from those four unlisted schemas

The four schemas are WP0's to define. WP10 reads only the fields below, all derived from spec §10. Fields marked **(not in spec/plan)** are needed by a view and are reported in §11. If WP0's merged schema differs, that is a finding against the plan, not something WP10 papers over.

```ts
// calendarResponseSchema
{
  days: Array<{
    date: IsoDate;                                    // the departure date (not in spec/plan: spec §10 says "per day" without naming which date)
    discovery: Array<{ providerId: ProviderId; buckets: Buckets }>;   // spec §10 "discovery counts per provider in the six buckets"
    verification: { selected: number; itinerarySearched: number; onDemand: number } | null;  // null = no verification provider (not_applicable)
    cheapestVerified: (PriceCell & { cell: CellKey }) | null;                   // class verified only, incl. children; `cell` (not in spec/plan)
    cheapestPartiallyVerified: (PriceCell & { cell: CellKey; count: number }) | null;
    cheapestCalendar: (PriceCell & { cell: CellKey }) | null;
    byDestination: Array<{ destination: Iata } & Omit<Day, 'date' | 'byDestination'>>;  // the same fields per destination
  }>;
  executions: Array<{ id: string; status: ExecutionStatus; ageHours: number | 'unknown' }>;   // (not in spec/plan) for the view header
}
// durationAnalysisResponseSchema
{
  nights: Array<{ nights: number; minVerified: (PriceCell & { n: number }) | null; minCalendar: Array<{ providerId: ProviderId; price: PriceCell | null; n: number }> }>;
  executions: Array<{ id: string; status: ExecutionStatus; ageHours: number | 'unknown' }>;   // (not in spec/plan)
}
// cellDetailResponseSchema
{
  cell: CellKey;
  outcomes: Array<{ executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null; attempts: number; fetchedAt: IsoDateTime | null; reusedFromExecutionId: string | null }>;
  calendarPrices: Array<PriceCell & { executionId: string; reusedFromExecutionId: string | null }>;
  observations: Array<PriceCell & { itineraryHash: string; seller: string; verdictClass: VerdictClass; booking: Booking }>;
}
// historyResponseSchema
{
  series: Array<{
    providerId: ProviderId;
    kind: 'offer' | 'calendar' | 'route-lowest';      // (not in spec/plan: spec §10 says "series per provider and kind")
    points: Array<{ fetchedAt: IsoDateTime; pricePence: number; provenance: Provenance | null }>;   // provenance null only for 'route-lowest' (see §11)
  }>;
}
```

The view modules derive their types from the schemas with `z.infer` (Task 10.1 `types.ts`), so a schema that lacks one of these fields fails `pnpm -r typecheck` in WP10. It cannot fail silently at runtime.

### From WP9 (no WP9 brief existed when this brief was written; these names are assumed)

`docs/briefs/wp09-web-shell-definitions-results.md` did not exist on 2026-10-14. The plan's dispatch process re-reviews a later wave's brief against the merged code before dispatch. At that review, Fable replaces any name below that differs and changes nothing else.

```ts
// apps/web/src/api/client.ts (WP9): typed fetch over core/api-contract; validates every response with the schema; relative URLs under WP9's API base
export class ApiError extends Error { status: number; code: string }
export function apiGet<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>>;            // path without the API base, e.g. '/definitions/abc/calendar'
export function apiPost<S extends z.ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>>;  // sends Content-Type: application/json and X-Requested-With: get-me-there
// apps/web/src/components/Provenance.tsx (WP9): badge, source in words, compact age (full on hover), "≈" when FX-converted
export function Provenance(props: { provenance: Provenance; now: IsoDateTime }): JSX.Element;
// apps/web/src/components/ViewHeader.tsx (WP9): execution(s) shown, status, age, stale label, banner when not completed
export function ViewHeader(props: { title: string; executions: Array<{ id: string; status: ExecutionStatus; ageHours: number | 'unknown' }>; children?: ReactNode }): JSX.Element;
// apps/web/src/lib/money.ts (WP9)
export function formatPence(pence: number): string;     // 41200 → "£412"
// apps/web/src/strings.ts (WP9): the string catalogue
export const strings: { nav: { definitions: string; results: string }; definitions: { importExample: string; create: string; runNow: string; discoveryProviders: string; verificationProviders: string }; syntheticBanner: string; /* … */ };
export function providerLabel(id: ProviderId): string;  // "Google Flights via SearchApi" | "Aviasales cache" | the fixture's synthetic label
// apps/web/src/views/registry.tsx (WP9): the views the shell's nav renders, in order
export interface ViewDef { id: string; label: string; render(p: { definition: DefinitionResponse }): ReactNode }
export const VIEWS: ViewDef[];
// apps/web/src/views/Results/ResultsView.tsx and ExpandedRow.tsx (WP9)
export function ResultsView(props: { definition: DefinitionResponse; now?: IsoDateTime }): JSX.Element;
export function ExpandedRow(props: { row: ResultRow; now: IsoDateTime }): JSX.Element;
// apps/web/src/views/Results/columns.tsx (WP9): the Results column definitions, including the departure and return date cells
// test/setup.ts (WP9): imports '@testing-library/jest-dom/vitest'
// DOM hooks WP9 renders: data-testid="results-headline" on the Results header's first line; data-testid="provenance" on every Provenance;
// the synthetic banner is role="alert" with class bg-red-700 and the text strings.syntheticBanner
// view selection by URL: ?view=<ViewDef.id>
```

### From WP8 (api)

The package script `pnpm --filter @gmt/api start` runs the built app bootstrap (`node dist/bootstrap/app.js`). Fixture mode follows spec §5.5: the fixture provider is constructed when `syntheticAllowed(config)` holds, and the api serves the fixture tree so that `http://fixture.local` resolves inside the process. `/providers` lists `fixture` in fixture mode.

## 5. Interfaces produced

```ts
// apps/web/src/lib/isoDate.ts
export function isoDateParts(d: IsoDate): { year: number; month: number; day: number };
export function weekdayIndex(d: IsoDate): 0 | 1 | 2 | 3 | 4 | 5 | 6;   // Monday = 0, from the epoch day; no Date
export function formatIsoDate(d: IsoDate): string;                      // '2027-03-14' → 'Sun 14 Mar 2027'
export function formatIsoDateShort(d: IsoDate): string;                 // '2027-03-14' → 'Sun 14 Mar'
export function formatIsoMonth(m: IsoMonth): string;                    // '2027-03' → 'March 2027'
export function monthDays(m: IsoMonth): IsoDate[];
// apps/web/src/lib/time.ts — the only file in apps/web/src allowed to construct or parse a Date
export function nowIso(): IsoDateTime;
export function instantMs(t: IsoDateTime): number;                      // throws on anything but the toISOString form (rejects '2027-03-14')
export function formatInstantLondon(ms: number): string;                // '14 Mar 15:00' in Europe/London
// apps/web/src/api/views.ts
export function fetchCalendar(definitionId: string): Promise<CalendarResponse>;
export function fetchDuration(definitionId: string): Promise<DurationResponse>;
export function fetchCellDetail(definitionId: string, cell: CellKey): Promise<CellDetailResponse>;
export function fetchRouteHistory(origin: Iata, destination: Iata): Promise<HistoryResponse>;
export function fetchItineraryHistory(hash: string): Promise<HistoryResponse>;
export function verifyCell(definitionId: string, cell: CellKey): Promise<unknown>;
// apps/web/src/views/Calendar/*
export function bucketTotal(b: Buckets): number;
export function formatDiscoveryMarker(b: Buckets): string;
export function formatVerificationMarker(v: DaySlice['verification']): string;
export function totalReused(slices: readonly DaySlice[]): number;
export function resolveDayDisplay(slice: DaySlice, now: IsoDateTime): DayDisplay;
export function buildScale(values: readonly number[]): QuintileScale;
export function quintileBand(sorted: readonly number[], v: number): Band;
export function CalendarGrid(props: { days: readonly GridDay[]; model: CalendarModel; now: IsoDateTime; destinationNotes: Partial<Record<Iata, string>>; onOpen(date: IsoDate, cell: CellKey | null): void }): JSX.Element;
export function CalendarLegend(props: { model: CalendarModel }): JSX.Element;
export function buildCalendarModel(days: readonly GridDay[], colourBasis: DayBasis, now: IsoDateTime): CalendarModel;
export function cellsForDay(definition: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>, date: IsoDate): CellKey[];
export function CellPanel(props: { definition: DefinitionResponse; date: IsoDate; initialCell: CellKey | null; now: IsoDateTime; onClose(): void }): JSX.Element;
export function PanelPrice(props: { price: unknown; kind: 'calendar' | 'observation'; label: string; now: IsoDateTime }): JSX.Element;
export function CalendarView(props: { definition: DefinitionResponse; now?: IsoDateTime }): JSX.Element;
// apps/web/src/views/Duration/*
export function buildDurationData(resp: DurationResponse, minNights: number, maxNights: number, hasVerification: boolean): DurationData;
export function DurationTooltip(props: { active?: boolean | undefined; payload?: ReadonlyArray<{ payload?: unknown }> | undefined; series: readonly DurationSeries[] }): JSX.Element | null;
export function DurationView(props: { definition: DefinitionResponse; now?: IsoDateTime }): JSX.Element;
// apps/web/src/views/History/*
export function buildHistoryLines(resp: HistoryResponse, gapHours: (providerId: ProviderId) => number): HistoryLine[];
export function HistoryView(props: { definition: DefinitionResponse; itineraryHash?: string; now?: IsoDateTime }): JSX.Element;
export function itineraryHashFromLocation(): { itineraryHash?: string };
export function historyHref(itineraryHash: string): string;            // '?view=history&hash=<hash>'
// apps/web/src/strings.ts additions
export const calendarStrings: { … };  export const durationStrings: { … };  export const historyStrings: { … };
```

## 6. Library notes

All versions come from plan Task 0.1. The docs were verified on 2026-10-14 with context7.

- **recharts 3.10.1** (context7 `/recharts/recharts`, versions v3.x; storybook `API/ResponsiveContainer.mdx`, `Customise.mdx`, `API/Accessibility.mdx`, wiki "3.0 migration guide", `src/component/ResponsiveContainer.tsx`, `src/component/Tooltip.tsx`):
  - `BarChart`, `Bar` (`dataKey` accepts a function; `name` sets the legend entry; `isAnimationActive={false}`), `XAxis`/`YAxis` (`label={{ value, position: 'insideBottom' | 'insideLeft', angle, offset }}`, `tickFormatter`, `type="number"`, `scale="time"`, `domain={['dataMin', 'dataMax']}`), `Tooltip` (`content={<Custom />}`, typed with **`TooltipContentProps`**, which the v3 migration guide names as the replacement for `TooltipProps` on custom content; `filterNull` defaults to `true`), `Legend`, `LineChart`, `Line` (`data` per line, `connectNulls={false}`, so a `null` point breaks the line and nothing is interpolated), and `ResponsiveContainer`.
  - v3 enables `accessibilityLayer` by default, so a chart is tab-focusable with arrow-key point navigation. `title` sets the SVG title.
  - **jsdom.** `ResponsiveContainer` reads `getBoundingClientRect()` of its container on mount, then subscribes a `ResizeObserver`. It renders **no children** while width or height is ≤ 0 (`ResponsiveContainerContextProvider` returns `null`). jsdom has no `ResizeObserver` and reports 0×0 rects, so `test/setup-charts.ts` (Task 10.9) installs a no-op `ResizeObserver` and returns 800×320 from `getBoundingClientRect` for `.recharts-responsive-container`. The parent `div` in production has an explicit height (`h-80`), which the source comment says is required for percentage sizes.
- **@playwright/test 1.64.1** (context7 `/microsoft/playwright`, `docs/src/test-webserver-js.md`, `class-testconfig.md`, `test-projects-js.md`): `defineConfig`, `devices['Desktop Chrome']`, and `webServer` as an **array** of `{ name, command, url, env, cwd, timeout, reuseExistingServer, stdout }`. `env` is merged over `process.env`. `url` readiness accepts 2xx–403. `cwd` defaults to the config's directory. `globalSetup` ordering against `webServer` is not relied on, because the api command prepares its own DB directory (`e2e/prepare-db.mjs`). Locators used: `getByRole`, `getByTestId`, `toContainText`, `toBeVisible`, `toHaveClass`, and `expect(fn).toPass({ timeout })`.
- **react 19.3.1, react-dom 19.3.1**: function components, `useState`, `useRef`, `useEffect`, `useMemo`, `useId`.
- **@tanstack/react-query 5.104.2**: `useQuery({ queryKey, queryFn })`, `useMutation({ mutationFn, onSuccess })`, `useQueryClient().invalidateQueries({ queryKey })`, `QueryClientProvider`, and `new QueryClient({ defaultOptions: { queries: { retry: false } } })` in tests.
- **@testing-library/react 16.3.3**: `render`, `screen`, `within`, `waitFor`. **@testing-library/user-event 14.6.8**: `userEvent.setup()`, `user.keyboard('{ArrowRight}')`, `user.click`, `user.selectOptions`. **@testing-library/jest-dom 7.0.1** matchers come in through WP9's `test/setup.ts`.
- **vitest 5.0.4** (`environment: 'jsdom'`, jsdom 30.1.2): `setupFiles` run in each worker before the test file is imported, which is where `test/setup-tz.ts` sets `process.env.TZ`. `pool: 'forks'` keeps each worker a child process, where Node honours an assignment to `process.env.TZ` for `Date` and `Intl`. Also used: `describe.each`, `beforeAll`/`afterAll`, and the positional file filters in `vitest run test/tz test/views/Calendar`.
- **msw 3.0.3** (context7 `/mswjs/msw`, `_autodocs/api-reference/setup-server.md`, `src/core/shared-options.ts`): `setupServer(...handlers)` from `msw/node`, `http.get`/`http.post`, `HttpResponse.json(body, { status })`, `server.listen`, `server.use`, `server.resetHandlers`, `server.close`. Version 3 names the unhandled-traffic option `onUnhandledFrame`; the legacy `onUnhandledRequest` is adapted by `fromLegacyOnUnhandledRequest`. This brief uses `onUnhandledFrame: 'error'`. Handlers use the `*/definitions/...` wildcard prefix so they match whatever API base WP9's client uses. The plan's Task 0.1 lists `msw` only under `@gmt/providers`, so Task 10.1 adds `msw@3.0.3` to `@gmt/web` devDependencies.
- **zod 4.6.7**: `import type { z } from 'zod'` for `z.infer`. Task 10.1 adds `zod@4.6.7` to `@gmt/web` dependencies if WP9 has not already added it (pnpm's strict layout does not expose core's copy).
- **vite 8.3.4** (context7 `/vitejs/vite`, `packages/vite/src/node/preview.ts`, `docs/config/preview-options.md`): `vite preview --host 127.0.0.1 --port 4173 --strictPort`. `resolvePreviewOptions` sets `proxy: preview?.proxy ?? server.proxy`, so the preview reuses WP9's dev proxy.
- **Intl** (no library): `new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`. It is used only in `src/lib/time.ts` for instants, never for date-only strings.
- **dataviz skill** (spec §11, "Charts follow the `dataviz` skill"): axis titles with units, one legend, no 3D, no dual axes, a sequential single-hue scale for the heatmap, and a categorical palette for series. Colour is always backed by text.

## 7. Files

**Create**

- `apps/web/src/lib/isoDate.ts`, `apps/web/src/lib/time.ts`
- `apps/web/src/api/views.ts`
- `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx,display.ts,scale.ts,CalendarGrid.tsx,CalendarLegend.tsx,CalendarView.tsx,CellPanel.tsx,PanelPrice.tsx,calendar.css}`
- `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`
- `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,HistoryView.tsx}`
- `apps/web/test/support/{fixtures.ts,server.ts,render.tsx}`
- `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts`
- `apps/web/test/views/Calendar/{marker.test.tsx,display.test.ts,scale.test.ts,grid.test.tsx,view.test.tsx,panel.test.tsx}`
- `apps/web/test/views/Duration/duration.test.tsx`, `apps/web/test/views/History/history.test.tsx`
- `apps/web/test/lib/{isoDate.test.ts,time.test.ts,noDateParsing.test.ts}`
- `apps/web/test/tz/dates.tz.test.tsx`
- `apps/web/test/strings.wp10.test.ts`, `apps/web/test/views/registry.wp10.test.tsx`
- `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/prepare-db.mjs`

**Modify**

- `apps/web/src/strings.ts` (WP9): append `calendarStrings`, `durationStrings`, `historyStrings`.
- `apps/web/src/views/registry.tsx` (WP9): three `VIEWS` entries.
- `apps/web/src/views/Results/ExpandedRow.tsx` (WP9): a "price history" link.
- `apps/web/src/views/Results/columns.tsx` (WP9): departure and return cells render with `formatIsoDateShort` (review focus 3).
- `apps/web/vitest.config.ts` (WP0/WP9): setup files, `pool: 'forks'`, `exclude: ['e2e/**']`.
- `apps/web/vite.config.ts` (WP9): the proxy target reads `GMT_API_ORIGIN`.
- `apps/web/package.json`: `msw`, `zod`, and the scripts `test`, `test:tz`, `e2e`, `e2e:install`.
- Any WP9 file under `apps/web/src` that constructs a `Date` outside `src/lib/time.ts` (Task 10.2 finds them).
- Root `.gitignore`: `apps/web/test-results/`, `apps/web/playwright-report/`, `apps/web/e2e/.tmp/`.

## 8. Tasks

Every command runs from the repository root. `W` stands for `pnpm --filter @gmt/web exec vitest run`.

### Task 10.1: Five-way day counts (first failing test)

**Files:**
- Create: `apps/web/src/api/views.ts`, `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx}`, `apps/web/test/support/{fixtures.ts,server.ts,render.tsx}`, `apps/web/test/views/Calendar/marker.test.tsx`
- Modify: `apps/web/src/strings.ts` (append `calendarStrings`), `apps/web/package.json` (devDependency `msw@3.0.3`; dependency `zod@4.6.7` unless WP9 added it)

**Interfaces:**
- Consumes: `bucketsSchema` fields, `calendarResponseSchema` (via `z.infer`), `apiGet`/`apiPost` and `providerLabel` (WP9).
- Produces: `bucketTotal`, `formatDiscoveryMarker`, `formatVerificationMarker`, `totalReused`, `DayMarker`, `ReusedNote`, the `api/views.ts` fetchers and types, and `calendarStrings`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/Calendar/marker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DayMarker, ReusedNote } from '../../../src/views/Calendar/DayMarker.js';
import { bucketTotal, formatDiscoveryMarker, formatVerificationMarker, totalReused } from '../../../src/views/Calendar/marker.js';
import { buckets, slice } from '../../support/fixtures.js';

describe('five-way day counts (spec §11 View B, §3)', () => {
  const partial = buckets({ priced: 3, empty: 1, no_data: 2, error: 1, skipped: 0, not_run: 5, reused: 2 });

  it('M is the sum of the six buckets; reused is a subset, not a seventh bucket', () => {
    expect(bucketTotal(partial)).toBe(12);
  });

  it('formats the discovery marker from the six-bucket counts', () => {
    expect(formatDiscoveryMarker(partial)).toBe(
      '3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12',
    );
  });

  it('formats the itinerary-search line separately, and says so when no verification provider exists', () => {
    expect(formatVerificationMarker({ selected: 10, itinerarySearched: 1, onDemand: 2 })).toBe(
      'itinerary-searched 1 of 10 selected +2 on demand',
    );
    expect(formatVerificationMarker(null)).toBe('itinerary search: no verification provider configured');
  });

  it('renders one discovery line per provider and the itinerary-search line on a partial day', () => {
    render(
      <DayMarker
        slice={slice({
          discovery: [
            { providerId: 'travelpayouts', buckets: partial },
            { providerId: 'searchapi', buckets: buckets({ priced: 12 }) },
          ],
          verification: { selected: 10, itinerarySearched: 1, onDemand: 2 },
        })}
      />,
    );
    const lines = screen.getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent(
      'Aviasales cache: 3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12',
    );
    expect(lines[1]).toHaveTextContent(
      'Google Flights via SearchApi: 12 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 12',
    );
    expect(screen.getByTestId('day-marker')).toHaveTextContent('itinerary-searched 1 of 10 selected +2 on demand');
  });

  it('says when a day has no discovery provider rather than showing zeros', () => {
    render(<DayMarker slice={slice({ discovery: [] })} />);
    expect(screen.getByTestId('day-marker')).toHaveTextContent('no discovery provider configured');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('the header shows the reused count summed over days and providers', () => {
    const days = [
      slice({ discovery: [{ providerId: 'travelpayouts', buckets: partial }] }),
      slice({
        discovery: [
          { providerId: 'travelpayouts', buckets: buckets({ priced: 4, reused: 3 }) },
          { providerId: 'searchapi', buckets: buckets({ priced: 4, reused: 1 }) },
        ],
      }),
    ];
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

`apps/web/test/support/fixtures.ts` (shared by every WP10 test):

```ts
import { addDays, asIata, asIsoDate, asIsoDateTime, type CellKey, type IsoDateTime, type Provenance } from '@gmt/core';
import type { DefinitionResponse } from '../../src/api/views.js';
import type { Buckets, CalendarDay, DayPrice, DaySlice } from '../../src/views/Calendar/types.js';

/** The fixed "now" every WP10 test renders against. */
export const NOW: IsoDateTime = asIsoDateTime('2027-03-01T12:00:00.000Z');
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');

/** An instant h hours before `now`, in toISOString form. Tests may use Date; apps/web/src may not (Task 10.2). */
export function hoursBefore(now: IsoDateTime, h: number): IsoDateTime {
  return asIsoDateTime(new Date(Date.parse(now) - h * 3_600_000).toISOString());
}

export function cell(departure: string, nights: number, origin = LHR, destination = JFK): CellKey {
  const dep = asIsoDate(departure);
  return { origin, destination, departureDate: dep, returnDate: addDays(dep, nights) };
}

/** SearchApi itinerary provenance (scraped-search, maxAgeHours 0), fetched h hours before NOW. */
export function provenanceVerified(h: number): Provenance {
  return { providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: hoursBefore(NOW, h), maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' };
}

/** Travelpayouts calendar provenance (authorised-cached), fetched h hours before NOW. */
export function provenanceCalendar(h: number, maxAgeHours: number | 'unknown' = 48): Provenance {
  return { providerId: 'travelpayouts', sourceKind: 'authorised-cached', fetchedAt: hoursBefore(NOW, h), maxAgeHours, fx: { converted: false }, pointOfSale: 'unknown', cabin: 'economy' };
}

export function price(pricePence: number, provenance: Provenance, stale: boolean, at: CellKey): DayPrice {
  const fetchedHours = Math.floor((Date.parse(NOW) - Date.parse(provenance.fetchedAt)) / 3_600_000);
  const ageHours = provenance.maxAgeHours === 'unknown' ? 'unknown' : fetchedHours + provenance.maxAgeHours;
  return { pricePence, provenance, stale, ageHours, cell: at };
}

export function buckets(partial: Partial<Buckets>): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0, ...partial };
}

export function slice(partial: Partial<DaySlice>): DaySlice {
  return { discovery: [], verification: null, cheapestVerified: null, cheapestPartiallyVerified: null, cheapestCalendar: null, ...partial };
}

export function day(date: string, partial: Partial<DaySlice> & { byDestination?: CalendarDay['byDestination'] } = {}): CalendarDay {
  const { byDestination = [], ...rest } = partial;
  return { date: asIsoDate(date), byDestination, ...slice(rest) };
}

/** The worked-example definition (London → New York, 10–21 nights) as the api returns it. */
export function definitionFixture(partial: Partial<DefinitionResponse> = {}): DefinitionResponse {
  return {
    id: 'def-1', name: 'London to New York (example)', origins: [LHR, LGW], destinations: [JFK, EWR],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500 },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: ['searchapi'], discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', confirmedCostPence: 0, enabled: true,
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
    budgetFit: { fits: true, runsPerMonth: 4, perScope: [] },
    estimate: { cells: 13104, perProvider: [], totalCostMicroGbp: 0, totalCostPence: 0, seconds: 0, assumptions: [], windowClamped: false },
    ...partial,
  };
}
```

`apps/web/test/support/server.ts`:

```ts
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/** One msw server per test file; handlers use the "*\/…" prefix so they match whatever API base WP9's client uses. */
export const server = setupServer();

export function useMswServer(): void {
  // why: an unmatched request is a test bug, never a silent pass (msw 3 option name; see Library notes).
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
```

`apps/web/test/support/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Renders under a fresh QueryClient with retries off, so error states appear on the first failure. */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/marker.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/DayMarker.js"`.

- [ ] **Step 3: Implement**

`apps/web/package.json`: add `"msw": "3.0.3"` to `devDependencies`, and `"zod": "4.6.7"` to `dependencies` if absent. Then run `pnpm install`.

`apps/web/src/api/views.ts`:

```ts
import {
  calendarResponseSchema, cellDetailResponseSchema, definitionResponseSchema, durationAnalysisResponseSchema,
  historyResponseSchema, ROUTES, type CellKey, type Iata,
} from '@gmt/core';
import type { z } from 'zod';
import { apiGet, apiPost } from './client.js';

/** Response types of the WP10 routes, inferred from the WP0 contract so a missing field fails typecheck (spec §10). */
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
export type DurationResponse = z.infer<typeof durationAnalysisResponseSchema>;
export type CellDetailResponse = z.infer<typeof cellDetailResponseSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type DefinitionResponse = z.infer<typeof definitionResponseSchema>;

const enc = encodeURIComponent;

/** GET /definitions/:id/calendar (spec §10). */
export function fetchCalendar(definitionId: string): Promise<CalendarResponse> {
  return apiGet(`/definitions/${enc(definitionId)}/calendar`, calendarResponseSchema);
}

/** GET /definitions/:id/duration-analysis (spec §10). */
export function fetchDuration(definitionId: string): Promise<DurationResponse> {
  return apiGet(`/definitions/${enc(definitionId)}/duration-analysis`, durationAnalysisResponseSchema);
}

/** GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate, the View B side panel source (spec §10). */
export function fetchCellDetail(definitionId: string, cell: CellKey): Promise<CellDetailResponse> {
  const path = [cell.origin, cell.destination, cell.departureDate, cell.returnDate].map(enc).join('/');
  return apiGet(`/definitions/${enc(definitionId)}/cells/${path}`, cellDetailResponseSchema);
}

/** GET /routes/:o/:d/history (spec §10, §11 History). */
export function fetchRouteHistory(origin: Iata, destination: Iata): Promise<HistoryResponse> {
  return apiGet(`/routes/${enc(origin)}/${enc(destination)}/history`, historyResponseSchema);
}

/** GET /itineraries/:hash/history (spec §10, §11 History). */
export function fetchItineraryHistory(hash: string): Promise<HistoryResponse> {
  return apiGet(`/itineraries/${enc(hash)}/history`, historyResponseSchema);
}

// why: the plan does not name the /cells/verify response schema; ROUTES carries it, so look it up rather than guess a name.
const verifyRoute = ROUTES.find((r) => r.method === 'POST' && r.path === '/cells/verify');

/** POST /cells/verify: starts a child execution for one cell (spec §8.1 single-cell verification). */
export function verifyCell(definitionId: string, cell: CellKey): Promise<unknown> {
  if (verifyRoute === undefined) throw new Error('ROUTES lacks POST /cells/verify (WP0 contract)');
  return apiPost('/cells/verify', { definitionId, cell }, verifyRoute.response);
}
```

`apps/web/src/views/Calendar/types.ts`:

```ts
import type { CalendarResponse } from '../../api/views.js';

/** One calendar day as the api sends it (spec §10 calendar route). */
export type CalendarDay = CalendarResponse['days'][number];
/** The fields a day and a per-destination entry share; the day itself is the "all destinations" slice. */
export type DaySlice = Omit<CalendarDay, 'date' | 'byDestination'>;
export type DestinationSlice = CalendarDay['byDestination'][number];
/** A day's price: a priceCell (amount, provenance, stale, ageHours) plus the cell it belongs to. */
export type DayPrice = NonNullable<DaySlice['cheapestCalendar']>;
export type Buckets = DaySlice['discovery'][number]['buckets'];
/** Statuses with their own glyph on a day without a price (spec §11 View B). */
export type GlyphStatus = 'empty' | 'no_data' | 'error' | 'not_run';
/** Which kind of price a day shows, and which kind the colour scale uses. */
export type DayBasis = 'verified' | 'calendar';
```

`apps/web/src/views/Calendar/marker.ts`:

```ts
import { calendarStrings } from '../../strings.js';
import type { Buckets, DaySlice } from './types.js';

/** M in the marker: the six buckets sum to the cell count (spec §3); `reused` is already counted inside its bucket. */
export function bucketTotal(b: Buckets): number {
  return b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run;
}

/** "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M" (spec §11 View B). */
export function formatDiscoveryMarker(b: Buckets): string {
  return calendarStrings.discoveryMarker(b, bucketTotal(b));
}

/** "itinerary-searched K of N selected +C on demand", or the not-configured note when the stage has no provider (spec §6.6 row 0). */
export function formatVerificationMarker(v: DaySlice['verification']): string {
  return v === null ? calendarStrings.verificationNotConfigured : calendarStrings.verificationMarker(v.itinerarySearched, v.selected, v.onDemand);
}

/** R′ for the header: reused outcomes summed over the given slices and every discovery provider (spec §3). */
export function totalReused(slices: readonly DaySlice[]): number {
  return slices.reduce((sum, s) => sum + s.discovery.reduce((acc, d) => acc + d.buckets.reused, 0), 0);
}
```

`apps/web/src/views/Calendar/DayMarker.tsx`:

```tsx
import { calendarStrings, providerLabel } from '../../strings.js';
import { formatDiscoveryMarker, formatVerificationMarker } from './marker.js';
import type { DaySlice } from './types.js';

/** The per-day coverage marker: one five-way discovery line per provider, then the itinerary-search line (spec §11 View B). */
export function DayMarker({ slice }: { slice: DaySlice }) {
  return (
    <div className="mt-1 text-[10px] leading-tight text-zinc-700" data-testid="day-marker">
      {slice.discovery.length === 0 ? (
        <p>{calendarStrings.noDiscoveryProvider}</p>
      ) : (
        <ul>
          {slice.discovery.map((d) => (
            <li key={d.providerId}>
              <span className="font-medium">{providerLabel(d.providerId)}:</span> {formatDiscoveryMarker(d.buckets)}
            </li>
          ))}
        </ul>
      )}
      <p>{formatVerificationMarker(slice.verification)}</p>
    </div>
  );
}

/** "(R reused from earlier runs)" for the view header; nothing when R is 0 (spec §3). */
export function ReusedNote({ count }: { count: number }) {
  return count > 0 ? <span>{calendarStrings.reusedNote(count)}</span> : null;
}
```

`apps/web/src/strings.ts`: append this block. Task 10.4 adjusts three of its entries (`legendBand`, `legendHatched`, `partlyVerified`).

```ts
/** View B strings (spec §11 View B; §3 bucket names; "verified" only beside class-verified values). WP10. */
export const calendarStrings = {
  title: 'Calendar',
  discoveryMarker: (
    b: { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number },
    total: number,
  ): string =>
    `${b.priced} priced · ${b.empty} no fares · ${b.no_data} no cached data · ${b.error} error · ${b.skipped} skipped · ${b.not_run} not searched of ${total}`,
  verificationMarker: (searched: number, selected: number, onDemand: number): string =>
    `itinerary-searched ${searched} of ${selected} selected +${onDemand} on demand`,
  verificationNotConfigured: 'itinerary search: no verification provider configured',
  noDiscoveryProvider: 'no discovery provider configured',
  reusedNote: (n: number): string => `(${n} reused from earlier runs)`,
  glyphs: {
    empty: { symbol: '∅', text: 'no fares' },
    no_data: { symbol: '?', text: 'no cached data' },
    error: { symbol: '!', text: 'error' },
    not_run: { symbol: '○', text: 'not searched' },
  },
  basisName: { verified: 'verified', calendar: 'calendar price' },
  constraintsNotChecked: 'constraints not checked',
  stale: 'stale',
  partlyVerified: (count: number): string => `${count} partially-verified`,
  colourBy: 'Colour by',
  colourByOption: { verified: 'verified prices', calendar: 'calendar prices' },
  legendTitle: 'Legend',
  legendScale: (basis: 'verified' | 'calendar', days: number): string =>
    `Colour: ${basis === 'verified' ? 'verified' : 'calendar'} prices on ${days} days, in five price bands (quintiles of the days shown)`,
  legendBand: (band: number, min: string, max: string, days: number): string => `band ${band + 1}: ${min}–${max} (${days} days)`,
  legendHatched: (shown: 'verified' | 'calendar', days: number): string =>
    `hatched: ${days} days show a ${shown === 'verified' ? 'verified' : 'calendar'} price instead and are not on this scale`,
  legendGlyphs: 'Days without a price show:',
  bandAria: (band: number): string => `price band ${band + 1} of 5${band === 0 ? ', cheapest' : ''}`,
  hatchedAria: 'not on the colour scale',
  destinationFilter: 'Destination',
  allDestinations: 'All destinations',
  noCellsForDestination: 'no cells for this destination',
  loading: 'Loading calendar…',
  empty: 'No days to show yet. The calendar fills in as cells are searched.',
  error: (message: string): string => `Could not load the calendar: ${message}`,
  panel: {
    title: (date: string): string => `Departing ${date}`,
    close: 'Close',
    cellPicker: 'Cell',
    cellOption: (origin: string, destination: string, nights: number, back: string): string =>
      `${origin}→${destination} · ${nights} nights · back ${back}`,
    outcomes: 'Outcomes per stage and provider',
    columns: { stage: 'Stage', provider: 'Provider', status: 'Outcome', reason: 'Reason', attempts: 'Attempts', fetched: 'Fetched', reused: 'Reused from' },
    status: { not_run: 'not searched', priced: 'priced', empty: 'no fares', no_data: 'no cached data', error: 'error', skipped: 'skipped' },
    stage: { discovery: 'discovery', verification: 'itinerary search' },
    prices: 'Prices for this cell',
    noPrices: 'No prices stored for this cell.',
    calendarPrice: 'calendar price',
    observation: (seller: string, verdictClass: string): string => `itinerary offer · ${seller} · ${verdictClass}`,
    verify: 'Run itinerary search for this cell',
    verifyStarted: 'Itinerary search started for this cell; results appear when it finishes.',
    verifyConflict: 'An itinerary search for this cell is already running.',
    verifyFailed: (message: string): string => `Could not start the itinerary search: ${message}`,
    provenanceMissing: 'price withheld: provenance missing',
    loading: 'Loading cell…',
    error: (message: string): string => `Could not load the cell: ${message}`,
    reusedFrom: (executionId: string): string => `run ${executionId}`,
    notReused: '—',
    note: 'Note',
  },
} as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/marker.test.tsx`
Expected: PASS, 7 tests.

Run: `pnpm -r typecheck`
Expected: clean. If `calendarResponseSchema` lacks a field from §4, it fails here naming that field; raise it as a finding against the plan.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml && git commit -m "wp10: five-way day marker and itinerary-search line (spec §11 View B)"
```

### Task 10.2: Date-only rendering helpers and the no-Date guard (review focus 3, part 1)

**Files:**
- Create: `apps/web/src/lib/isoDate.ts`, `apps/web/src/lib/time.ts`, `apps/web/test/lib/{isoDate.test.ts,time.test.ts,noDateParsing.test.ts}`
- Modify: any WP9 file in `apps/web/src` that the guard flags (expected: the status bar's and `Provenance`'s "now", replaced by `nowIso()`)

**Interfaces:**
- Consumes: `toEpochDay`, `addDays`, `monthOf`, `asIsoDate`, `asIsoDateTime`, `isoDateTimeSchema`.
- Produces: `isoDateParts`, `weekdayIndex`, `formatIsoDate`, `formatIsoDateShort`, `formatIsoMonth`, `monthDays`, `WEEKDAY_HEADERS`, `nowIso`, `instantMs`, `formatInstantLondon`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/lib/isoDate.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { formatIsoDate, formatIsoDateShort, formatIsoMonth, isoDateParts, monthDays, weekdayIndex } from '../../src/lib/isoDate.js';

const d = asIsoDate;

describe('date-only rendering from YYYY-MM-DD strings (spec §6.1, review focus 3)', () => {
  it('splits the string, never parses it', () => {
    expect(isoDateParts(d('2027-03-14'))).toEqual({ year: 2027, month: 3, day: 14 });
  });
  it('weekday from the epoch day, Monday = 0', () => {
    expect(weekdayIndex(d('1970-01-01'))).toBe(3); // a Thursday
    expect(weekdayIndex(d('2027-03-01'))).toBe(0); // Monday
    expect(weekdayIndex(d('2027-03-14'))).toBe(6); // Sunday (the US DST change day)
    expect(weekdayIndex(d('2027-03-28'))).toBe(6); // Sunday (the UK DST change day)
    expect(weekdayIndex(d('1969-12-31'))).toBe(2); // negative epoch day still lands on Wednesday
  });
  it('formats long and short forms', () => {
    expect(formatIsoDate(d('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatIsoDateShort(d('2027-03-14'))).toBe('Sun 14 Mar');
    expect(formatIsoDate(d('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatIsoMonth('2027-03' as never)).toBe('March 2027');
  });
  it('lists the days of a month, leap February included', () => {
    expect(monthDays('2027-02' as never)).toHaveLength(28);
    const leap = monthDays('2028-02' as never);
    expect(leap).toHaveLength(29);
    expect(leap[0]).toBe('2028-02-01');
    expect(leap[28]).toBe('2028-02-29');
  });
});
```

`apps/web/test/lib/time.test.ts`:

```ts
import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { formatInstantLondon, instantMs, nowIso } from '../../src/lib/time.js';

describe('src/lib/time.ts: instants only (review focus 3)', () => {
  it('nowIso is in toISOString form', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
  it('instantMs accepts an instant and refuses a date-only string', () => {
    expect(instantMs(asIsoDateTime('2027-03-14T15:00:00.000Z'))).toBe(Date.UTC(2027, 2, 14, 15));
    expect(() => instantMs('2027-03-14' as never)).toThrow(RangeError);
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
// shift instants the same way. Only src/lib/time.ts may touch Date, and its helpers accept toISOString instants only.
const ALLOWLIST = new Set(['lib/time.ts']);
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

describe('no Date parsing outside src/lib/time.ts (review focus 3)', () => {
  it('the scanner flags a date-only string fed to Date, and leaves string helpers alone', () => {
    expect(scan(`const d = new Date('2027-03-14');`)).toEqual(['1: new Date(']);
    expect(scan(`const t = Date.parse(day.date);`)).toEqual(['1: Date.parse(']);
    expect(scan(`const n = when.getDate();`)).toEqual(['1: local date getter']);
    expect(scan(`label = x.toLocaleDateString('en-GB');`)).toEqual(['1: toLocaleDateString(']);
    expect(scan(`const ok = formatIsoDate(day.date);`)).toEqual([]);
  });
  it('finds no Date construction in apps/web/src outside the allowlist', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(10); // why: a wrong SRC path must not make this test vacuous
    const hits = files
      .filter((f) => !ALLOWLIST.has(relative(SRC, f).split(sep).join('/')))
      .flatMap((f) => scan(readFileSync(f, 'utf8')).map((h) => `${relative(SRC, f)}:${h}`));
    expect(hits).toEqual([]);
  });
  it('the allowlist is exactly the one helper, and it exists', () => {
    expect([...ALLOWLIST]).toEqual(['lib/time.ts']);
    expect(statSync(join(SRC, 'lib/time.ts')).isFile()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/lib`
Expected: FAIL. `isoDate.test.ts` and `time.test.ts` fail with `Failed to resolve import "../../src/lib/isoDate.js"` (or `time.js`). `noDateParsing.test.ts` fails on the missing `lib/time.ts` and lists any WP9 hits, for example `components/StatusBar.tsx:12: new Date(`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/isoDate.ts`:

```ts
import { addDays, asIsoDate, monthOf, toEpochDay, type IsoDate, type IsoMonth } from '@gmt/core';

// Date-only values are rendered from their YYYY-MM-DD strings and epoch-day integers only (spec §6.1, review focus 3).
// No Date object is ever built here, so no browser timezone can move a day.

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** Column headers for the Monday-first calendar grid. */
export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

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

/** '2027-03-14' → 'Sun 14 Mar' (calendar days, table cells). */
export function formatIsoDateShort(d: IsoDate): string {
  const { month, day } = isoDateParts(d);
  return `${WEEKDAY_HEADERS[weekdayIndex(d)]} ${day} ${monthName(MONTHS_SHORT, month)}`;
}

/** '2027-03-14' → 'Sun 14 Mar 2027' (headers, panel titles). */
export function formatIsoDate(d: IsoDate): string {
  return `${formatIsoDateShort(d)} ${isoDateParts(d).year}`;
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
import { asIsoDateTime, isoDateTimeSchema, type IsoDateTime } from '@gmt/core';

// The only file in apps/web/src that constructs or parses a Date (review focus 3; guarded by test/lib/noDateParsing.test.ts).
// Everything here takes or returns instants in toISOString form or epoch milliseconds; a date-only string is refused.

/** The current instant, for effective-age labels (spec §3). */
export function nowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

/** Epoch milliseconds of an instant; throws RangeError on anything but the toISOString form (spec §6.3). */
export function instantMs(t: IsoDateTime): number {
  if (!isoDateTimeSchema.safeParse(t).success) throw new RangeError(`instantMs: not an ISO instant: ${String(t)}`);
  return Date.parse(t);
}

// why: an explicit zone keeps chart ticks identical in every browser; Europe/London is the app's reference zone (spec §6.1).
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** '14 Mar 15:00' in Europe/London, for the History x axis and tooltips. */
export function formatInstantLondon(ms: number): string {
  return LONDON.format(new Date(ms));
}
```

For each WP9 hit the guard lists, replace the `Date` use with `nowIso()` (current instant) or `instantMs()` (instant to milliseconds). Replace any date-only formatting with `formatIsoDateShort()`. Make no other change to those files.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/lib`
Expected: PASS, 10 tests. `noDateParsing` reports `hits: []`.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: date-only helpers, instant helpers and the no-Date guard (review focus 3)"
```

### Task 10.3: Day price precedence (spec §11 View B, §8.1)

**Files:**
- Create: `apps/web/src/views/Calendar/display.ts`, `apps/web/test/views/Calendar/display.test.ts`

**Interfaces:**
- Consumes: `effectiveAge`, `compareAges` (WP0); `DaySlice`, `DayPrice`, `GlyphStatus`, `DayBasis`.
- Produces: `DayDisplay`, `resolveDayDisplay`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/Calendar/display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveDayDisplay } from '../../../src/views/Calendar/display.js';
import { buckets, cell, NOW, price, provenanceCalendar, provenanceVerified, slice } from '../../support/fixtures.js';

const c14 = cell('2027-03-14', 14);

describe('day precedence (spec §11 View B, §8.1)', () => {
  it('a fresh class-verified price wins even over a cheaper calendar price', () => {
    const v = price(52000, provenanceVerified(5), false, c14);
    const c = price(41200, provenanceCalendar(2), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'verified', price: v, stale: false, why: 'fresh-verified' });
  });

  it('stale verified vs calendar: the fresher one wins (calendar 10h + ≤48h beats verified 200h)', () => {
    const v = price(52000, provenanceVerified(200), true, c14);
    const c = price(41200, provenanceCalendar(10), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'calendar', price: c, stale: false, why: 'calendar-fresher' });
  });

  it('stale verified vs calendar: a stale verified price fresher than the calendar one wins, labelled stale', () => {
    const v = price(52000, provenanceVerified(200), true, c14);
    const c = price(41200, provenanceCalendar(190), true, c14); // worst case 238h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'verified', price: v, stale: true, why: 'stale-verified-fresher' });
  });

  it('unknown age loses to any known age', () => {
    const v = price(52000, provenanceVerified(300), true, c14);
    const c = price(41200, provenanceCalendar(1, 'unknown'), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({ basis: 'verified', why: 'stale-verified-fresher' });
  });

  it('ties go to verified', () => {
    const v = price(52000, provenanceVerified(58), true, c14); // worst case 58h
    const c = price(41200, provenanceCalendar(10), false, c14); // worst case 10 + 48 = 58h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({ basis: 'verified' });
  });

  it('a stale calendar price still renders, labelled stale', () => {
    const c = price(41200, provenanceCalendar(400), true, c14);
    expect(resolveDayDisplay(slice({ cheapestCalendar: c }), NOW)).toEqual({ kind: 'price', basis: 'calendar', price: c, stale: true, why: 'calendar-only' });
  });

  it('a stale verified price with no calendar price renders, labelled stale', () => {
    const v = price(52000, provenanceVerified(300), true, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v }), NOW)).toEqual({ kind: 'price', basis: 'verified', price: v, stale: true, why: 'stale-verified-only' });
  });

  it('a partially-verified price never becomes the day price', () => {
    const pv = { ...price(30000, provenanceVerified(1), false, c14), count: 3 };
    expect(resolveDayDisplay(slice({ cheapestPartiallyVerified: pv }), NOW).kind).toBe('glyphs');
  });

  it('no price: one glyph per non-zero unpriced status across providers, in a fixed order', () => {
    const s = slice({
      discovery: [
        { providerId: 'travelpayouts', buckets: buckets({ no_data: 3, not_run: 2 }) },
        { providerId: 'searchapi', buckets: buckets({ error: 1, empty: 4 }) },
      ],
    });
    expect(resolveDayDisplay(s, NOW)).toEqual({ kind: 'glyphs', glyphs: ['empty', 'no_data', 'error', 'not_run'] });
  });

  it('a day of only skipped cells shows no glyph (the marker carries the count)', () => {
    const s = slice({ discovery: [{ providerId: 'travelpayouts', buckets: buckets({ skipped: 12 }) }] });
    expect(resolveDayDisplay(s, NOW)).toEqual({ kind: 'glyphs', glyphs: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/display.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/display.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/display.ts` (Task 10.4 appends `buildCalendarModel` to this file):

```ts
import { compareAges, effectiveAge, type IsoDateTime } from '@gmt/core';
import type { DayBasis, DayPrice, DaySlice, GlyphStatus } from './types.js';

/** What one calendar day shows (spec §11 View B). */
export type DayDisplay =
  | { kind: 'price'; basis: DayBasis; price: DayPrice; stale: boolean; why: 'fresh-verified' | 'stale-verified-fresher' | 'calendar-fresher' | 'stale-verified-only' | 'calendar-only' }
  | { kind: 'glyphs'; glyphs: GlyphStatus[] };

const GLYPH_ORDER: readonly GlyphStatus[] = ['empty', 'no_data', 'error', 'not_run'];

/**
 * The day's price by the spec §11 precedence: a class-verified price that is not stale (the api's `stale` uses
 * STALE_AFTER_HOURS, §8.1); else the fresher of a stale verified price and the cheapest calendar price; else glyphs.
 * Partially-verified prices never become the day price; the day shows only their count.
 */
export function resolveDayDisplay(slice: DaySlice, now: IsoDateTime): DayDisplay {
  const v = slice.cheapestVerified;
  const c = slice.cheapestCalendar;
  if (v !== null && !v.stale) return { kind: 'price', basis: 'verified', price: v, stale: false, why: 'fresh-verified' };
  if (v !== null && c !== null) {
    // why: §8.1 — unknown age loses to any known age and ties go to verified; compareAges(a, b) < 0 means a is fresher (WP0 Task 0.7).
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

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/display.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: day price precedence with stale and unknown-age rules (spec §11, §8.1)"
```

### Task 10.4: Quintile scale over one basis, and the calendar model

**Files:**
- Create: `apps/web/src/views/Calendar/scale.ts`, `apps/web/test/views/Calendar/scale.test.ts`
- Modify: `apps/web/src/views/Calendar/display.ts` (append `GridDay`, `CalendarModel`, `buildCalendarModel`), `apps/web/src/strings.ts` (singular/plural day counts)

**Interfaces:**
- Produces: `Band`, `QuintileScale`, `LegendEntry`, `BAND_CLASSES`, `quintileBand`, `buildScale`, `GridDay`, `CalendarModel`, `buildCalendarModel`.

The quintile function: sort the n values of the colour basis ascending. A value v gets band `min(4, floor(r × 5 / n))`, where r is the number of values strictly below v. Equal prices therefore share a band, bands never decrease as the price rises, and n < 5 leaves the upper bands empty instead of stretching them.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/Calendar/scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCalendarModel } from '../../../src/views/Calendar/display.js';
import { buildScale, quintileBand } from '../../../src/views/Calendar/scale.js';
import { cell, day, NOW, price, provenanceCalendar, provenanceVerified } from '../../support/fixtures.js';

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
  it('an empty scale refuses to band anything', () => {
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
  const verifiedDay = (date: string, pence: number) => ({ date: day(date).date, slice: day(date, { cheapestVerified: price(pence, provenanceVerified(5), false, cell(date, 14)) }) });
  const calendarDay = (date: string, pence: number) => ({ date: day(date).date, slice: day(date, { cheapestCalendar: price(pence, provenanceCalendar(5), false, cell(date, 14)) }) });
  const days = [verifiedDay('2027-03-10', 40000), verifiedDay('2027-03-11', 50000), verifiedDay('2027-03-12', 60000), verifiedDay('2027-03-13', 70000), verifiedDay('2027-03-14', 80000), calendarDay('2027-03-15', 30000)];

  it('colouring by verified bands only the verified days; the cheaper calendar day is hatched and does not move the scale', () => {
    const m = buildCalendarModel(days, 'verified', NOW);
    expect(m.scale.count).toBe(5);
    expect(m.scale.band(40000)).toBe(0);
    expect(m.hatchedDays).toBe(1);
    expect(m.bands.get(day('2027-03-15').date)).toBeUndefined();
  });
  it('colouring by calendar bands the calendar day and hatches the five verified days', () => {
    const m = buildCalendarModel(days, 'calendar', NOW);
    expect(m.scale.count).toBe(1);
    expect(m.bands.get(day('2027-03-15').date)).toBe(0);
    expect(m.hatchedDays).toBe(5);
  });
  it('a filtered-out destination day (slice null) has no price and is neither banded nor hatched', () => {
    const m = buildCalendarModel([{ date: day('2027-03-16').date, slice: null }], 'verified', NOW);
    expect(m.displays.get(day('2027-03-16').date)).toEqual({ kind: 'glyphs', glyphs: [] });
    expect(m.hatchedDays).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/scale.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/scale.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/scale.ts`:

```ts
/** A quintile band; 0 is the cheapest fifth (spec §11 View B). */
export type Band = 0 | 1 | 2 | 3 | 4;
/** One numeric legend row: the pence range and the number of days in a band. */
export interface LegendEntry { band: Band; minPence: number; maxPence: number; count: number }
export interface QuintileScale { count: number; band(v: number): Band; legend: LegendEntry[] }

/** Sequential single-hue fills (dataviz skill); the price text and the sr-only band label carry the meaning, never the colour alone. */
export const BAND_CLASSES: Readonly<Record<Band, string>> = {
  0: 'bg-teal-700 text-white',
  1: 'bg-teal-500 text-white',
  2: 'bg-teal-300 text-black',
  3: 'bg-teal-200 text-black',
  4: 'bg-teal-100 text-black',
};

/** Band of v within `sorted` (ascending): floor(r × 5 / n), where r counts values strictly below v. */
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
    // why: bands never decrease as price rises, so equal consecutive bands merge into one legend row.
    if (last !== undefined && last.band === b) {
      last.maxPence = v;
      last.count += 1;
    } else legend.push({ band: b, minPence: v, maxPence: v, count: 1 });
  }
  return { count: sorted.length, band: (v) => quintileBand(sorted, v), legend };
}
```

Append to `apps/web/src/views/Calendar/display.ts`:

```ts
import type { IsoDate } from '@gmt/core';
import { type Band, buildScale, type QuintileScale } from './scale.js';

/** A day as the grid renders it; `slice` is null when the destination filter leaves the day no cells. */
export interface GridDay { date: IsoDate; slice: DaySlice | null }

/** Per-day displays plus the one-basis colour scale (spec §11 View B). */
export interface CalendarModel {
  colourBasis: DayBasis;
  displays: ReadonlyMap<IsoDate, DayDisplay>;
  bands: ReadonlyMap<IsoDate, Band>;
  scale: QuintileScale;
  hatchedDays: number;
}

/** Resolves every day, builds the scale over the days whose shown price is of `colourBasis`, and counts the hatched rest. */
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
  const bands = new Map<IsoDate, Band>(onBasis.map((x) => [x.date, scale.band(x.pence)]));
  return { colourBasis, displays, bands, scale, hatchedDays };
}
```

(Merge the two new `import` lines into the existing import block at the top of `display.ts`.)

In `apps/web/src/strings.ts`, replace three `calendarStrings` entries so day counts read correctly:

```ts
  legendBand: (band: number, min: string, max: string, days: number): string => `band ${band + 1}: ${min}–${max} (${days} ${days === 1 ? 'day' : 'days'})`,
  legendHatched: (shown: 'verified' | 'calendar', days: number): string =>
    `hatched: ${days} ${days === 1 ? 'day shows' : 'days show'} a ${shown === 'verified' ? 'verified' : 'calendar'} price instead and ${days === 1 ? 'is' : 'are'} not on this scale`,
  legendScale: (basis: 'verified' | 'calendar', days: number): string =>
    `Colour: ${basis === 'verified' ? 'verified' : 'calendar'} prices on ${days} ${days === 1 ? 'day' : 'days'}, in five price bands (quintiles of the days shown)`,
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar`
Expected: PASS (marker, display, scale; 25 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: quintile scale per basis with hatched fallback days (spec §11 View B)"
```

### Task 10.5: Calendar grid, glyphs, legend and keyboard navigation

**Files:**
- Create: `apps/web/src/views/Calendar/{CalendarGrid.tsx,CalendarLegend.tsx,calendar.css}`, `apps/web/test/views/Calendar/grid.test.tsx`

**Interfaces:**
- Consumes: `CalendarModel`, `GridDay`, `BAND_CLASSES`, `DayMarker`, `Provenance` and `formatPence` (WP9), the `isoDate` helpers, `addDays` and `monthOf`.
- Produces: `CalendarGrid({ days, model, now, destinationNotes, onOpen })` and `CalendarLegend({ model })`.

The grid follows the APG grid pattern: one `role="grid"` table per month, `role="gridcell"` days with a roving `tabIndex`, arrow keys to move by one day or one week (across months), and Enter or Space to open the side panel.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/Calendar/grid.test.tsx`:

```tsx
import { asIsoDate } from '@gmt/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarGrid } from '../../../src/views/Calendar/CalendarGrid.js';
import { CalendarLegend } from '../../../src/views/Calendar/CalendarLegend.js';
import { buildCalendarModel, type GridDay } from '../../../src/views/Calendar/display.js';
import type { Buckets, DayBasis } from '../../../src/views/Calendar/types.js';
import { buckets, cell, day, NOW, price, provenanceCalendar, provenanceVerified } from '../../support/fixtures.js';

const vDay = (date: string, pence: number): GridDay => ({
  date: asIsoDate(date),
  slice: day(date, { cheapestVerified: price(pence, provenanceVerified(5), false, cell(date, 14)), discovery: [{ providerId: 'searchapi', buckets: buckets({ priced: 48 }) }] }),
});
const cDay = (date: string, pence: number, stale = false): GridDay => ({
  date: asIsoDate(date),
  slice: day(date, { cheapestCalendar: price(pence, provenanceCalendar(5), stale, cell(date, 14)), discovery: [{ providerId: 'travelpayouts', buckets: buckets({ priced: 20, no_data: 28 }) }] }),
});
const gDay = (date: string, b: Partial<Buckets>): GridDay => ({ date: asIsoDate(date), slice: day(date, { discovery: [{ providerId: 'travelpayouts', buckets: buckets(b) }] }) });

function renderGrid(days: GridDay[], basis: DayBasis = 'verified', notes: Record<string, string> = {}) {
  const onOpen = vi.fn();
  const model = buildCalendarModel(days, basis, NOW);
  const r = render(
    <>
      <CalendarGrid days={days} model={model} now={NOW} destinationNotes={notes} onOpen={onOpen} />
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
    renderGrid([vDay('2027-03-14', 41200), vDay('2027-04-01', 41200)]);
    expect(within(screen.getByRole('grid', { name: 'March 2027' })).getByText('14')).toBeInTheDocument();
    expect(dayCell('2027-03-14').cellIndex).toBe(6); // Sunday
    expect(dayCell('2027-04-01').cellIndex).toBe(3); // Thursday
    expect(screen.getByRole('grid', { name: 'April 2027' })).toContainElement(dayCell('2027-04-01'));
  });

  it('colours by one basis; other-basis days are hatched, excluded from the scale and named in the numeric legend', () => {
    const days = [vDay('2027-03-08', 40000), vDay('2027-03-09', 50000), vDay('2027-03-10', 60000), vDay('2027-03-11', 70000), vDay('2027-03-12', 80000), cDay('2027-03-13', 30000)];
    const { unmount } = renderGrid(days, 'verified');
    expect(['08', '09', '10', '11', '12'].map((d) => dayCell(`2027-03-${d}`).dataset.band)).toEqual(['0', '1', '2', '3', '4']);
    expect(dayCell('2027-03-13')).toHaveClass('day-hatched');
    expect(dayCell('2027-03-13').dataset.band).toBe('');
    expect(within(dayCell('2027-03-13')).getByText('not on the colour scale')).toBeInTheDocument();
    expect(within(dayCell('2027-03-08')).getByText('price band 1 of 5, cheapest')).toBeInTheDocument();
    const legend = screen.getByTestId('calendar-legend');
    expect(legend).toHaveTextContent('Colour: verified prices on 5 days, in five price bands (quintiles of the days shown)');
    expect(legend).toHaveTextContent('band 1: £400–£400 (1 day)');
    expect(legend).toHaveTextContent('band 5: £800–£800 (1 day)');
    expect(legend).toHaveTextContent('hatched: 1 day shows a calendar price instead and is not on this scale');
    unmount();

    renderGrid(days, 'calendar');
    expect(dayCell('2027-03-13').dataset.band).toBe('0');
    expect(['08', '09', '10', '11', '12'].every((d) => dayCell(`2027-03-${d}`).classList.contains('day-hatched'))).toBe(true);
    expect(screen.getByTestId('calendar-legend')).toHaveTextContent('hatched: 5 days show a verified price instead and are not on this scale');
  });

  it('every shown price carries provenance; calendar prices are dashed and say constraints not checked; stale is labelled', () => {
    renderGrid([vDay('2027-03-08', 40000), cDay('2027-03-09', 30000, true)], 'verified');
    const v = dayCell('2027-03-08');
    expect(within(v).getByTestId('provenance')).toBeInTheDocument();
    expect(within(v).getByText('verified')).toBeInTheDocument();
    expect(within(v).getByTestId('day-price-block')).toHaveClass('border-solid');
    const c = dayCell('2027-03-09');
    expect(within(c).getByTestId('provenance')).toBeInTheDocument();
    expect(within(c).getByTestId('day-price-block')).toHaveClass('border-dashed');
    expect(c).toHaveTextContent('constraints not checked');
    expect(c).toHaveTextContent('stale');
    expect(within(c).getByTestId('day-price')).toHaveTextContent('£300');
  });

  it('shows the operator note for the destination of the shown price', () => {
    renderGrid([vDay('2027-03-08', 40000)], 'verified', { JFK: 'onward leg not included' });
    expect(dayCell('2027-03-08')).toHaveTextContent('onward leg not included');
  });

  it('days without a price show distinct glyphs, each with a text alternative', () => {
    renderGrid([gDay('2027-03-08', { empty: 1, no_data: 1, error: 1, not_run: 1 })]);
    const glyphs = [...dayCell('2027-03-08').querySelectorAll('[data-glyph]')];
    expect(glyphs.map((g) => g.getAttribute('data-glyph'))).toEqual(['empty', 'no_data', 'error', 'not_run']);
    expect(new Set(glyphs.map((g) => g.querySelector('[aria-hidden="true"]')?.textContent)).size).toBe(4);
    expect(glyphs.map((g) => g.textContent)).toEqual(['∅ no fares', '? no cached data', '! error', '○ not searched']);
    expect(screen.getByTestId('calendar-legend')).toHaveTextContent('∅ no fares');
  });

  it('is keyboard-operable: arrows move by day and week across months, Enter and Space open, one tab stop, visible focus', async () => {
    const user = userEvent.setup();
    const days = ['2027-03-30', '2027-03-31', '2027-04-01', '2027-04-02', '2027-04-03', '2027-04-04', '2027-04-05', '2027-04-06', '2027-04-07'].map((d) => vDay(d, 40000));
    const { onOpen } = renderGrid(days);
    await user.tab();
    expect(dayCell('2027-03-30')).toHaveFocus();
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-03-31')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // across the month boundary
    await user.keyboard('{ArrowDown}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // 2027-04-08 is outside the data, focus stays
    await user.keyboard('{ArrowUp}');
    expect(dayCell('2027-04-01')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(dayCell('2027-03-31')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(dayCell('2027-04-07')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('2027-04-07', cell('2027-04-07', 14));
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(dayCell('2027-04-07').className).toContain('focus-visible:outline-2');
  });

  it('clicking a glyph day opens the panel with no preselected cell', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderGrid([gDay('2027-03-08', { not_run: 48 })]);
    await user.click(dayCell('2027-03-08'));
    expect(onOpen).toHaveBeenCalledWith('2027-03-08', null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/grid.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CalendarGrid.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/calendar.css`:

```css
/* Hatched days (spec §11 View B): a pattern, not a colour, so "not on this scale" survives greyscale and colour-blindness. */
.day-hatched {
  background-color: #f4f4f5;
  background-image: repeating-linear-gradient(45deg, transparent 0 6px, rgb(0 0 0 / 0.18) 6px 8px);
}
```

`apps/web/src/views/Calendar/CalendarGrid.tsx`:

```tsx
import { addDays, monthOf, type CellKey, type Iata, type IsoDate, type IsoDateTime, type IsoMonth } from '@gmt/core';
import { type KeyboardEvent, useRef, useState } from 'react';
import { Provenance } from '../../components/Provenance.js';
import { formatIsoDate, formatIsoMonth, isoDateParts, monthDays, WEEKDAY_HEADERS, weekdayIndex } from '../../lib/isoDate.js';
import { formatPence } from '../../lib/money.js';
import { calendarStrings } from '../../strings.js';
import { DayMarker } from './DayMarker.js';
import type { CalendarModel, DayDisplay, GridDay } from './display.js';
import { type Band, BAND_CLASSES } from './scale.js';
import type { DaySlice, GlyphStatus } from './types.js';
import './calendar.css';

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
// why: visible focus is a spec §11 accessibility requirement; focus-visible keeps it off mouse clicks.
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

export interface CalendarGridProps {
  days: readonly GridDay[];
  model: CalendarModel;
  now: IsoDateTime;
  destinationNotes: Partial<Record<Iata, string>>;
  onOpen(date: IsoDate, cell: CellKey | null): void;
}

/** Monday-first weeks of one month, null for the padding cells. */
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

/** View B heatmap: one APG grid per month, roving tabindex, arrows by day/week, Enter or Space opens the side panel (spec §11). */
export function CalendarGrid({ days, model, now, destinationNotes, onOpen }: CalendarGridProps) {
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
              {WEEKDAY_HEADERS.map((w) => (
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
                      <td key={date} role="gridcell" aria-disabled="true" className="align-top text-xs text-zinc-400 max-sm:hidden">
                        {isoDateParts(date).day}
                      </td>
                    );
                  }
                  const disp = model.displays.get(date) ?? { kind: 'glyphs', glyphs: [] };
                  const band = model.bands.get(date);
                  const hatched = disp.kind === 'price' && disp.basis !== model.colourBasis;
                  const fill = band !== undefined ? BAND_CLASSES[band] : hatched ? 'day-hatched' : 'bg-white border border-zinc-200';
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
                      className={`cursor-pointer rounded p-1 text-left align-top max-sm:block max-sm:mb-1 ${FOCUS_RING} ${fill}`}
                    >
                      <span className="block text-xs font-semibold">
                        <span aria-hidden="true">{isoDateParts(date).day}</span>
                        <span className="sr-only">{formatIsoDate(date)}</span>
                      </span>
                      <DayBody display={disp} band={band} hatched={hatched} slice={gd.slice} notes={destinationNotes} now={now} />
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

function DayBody(props: { display: DayDisplay; band: Band | undefined; hatched: boolean; slice: DaySlice | null; notes: Partial<Record<Iata, string>>; now: IsoDateTime }) {
  const { display, band, hatched, slice, notes, now } = props;
  if (slice === null) return <p className="text-[10px]">{calendarStrings.noCellsForDestination}</p>;
  return (
    <>
      {display.kind === 'price' ? <DayPriceBlock display={display} notes={notes} now={now} /> : <GlyphList glyphs={display.glyphs} />}
      {band !== undefined && <span className="sr-only">{calendarStrings.bandAria(band)}</span>}
      {hatched && <span className="sr-only">{calendarStrings.hatchedAria}</span>}
      {slice.cheapestPartiallyVerified !== null && <p className="text-[10px]">{calendarStrings.partlyVerified(slice.cheapestPartiallyVerified.count)}</p>}
      <DayMarker slice={slice} />
    </>
  );
}

/** The day's price with its provenance visible without hover (spec §11): amount, destination, basis, staleness, badge and age. */
function DayPriceBlock({ display, notes, now }: { display: Extract<DayDisplay, { kind: 'price' }>; notes: Partial<Record<Iata, string>>; now: IsoDateTime }) {
  const p = display.price;
  const isCalendar = display.basis === 'calendar';
  const note = notes[p.cell.destination];
  return (
    <div data-testid="day-price-block" className={`rounded border border-current px-1 ${isCalendar ? 'border-dashed' : 'border-solid'}`}>
      <span data-testid="day-price" className="font-semibold">{formatPence(p.pricePence)}</span> <span>{p.cell.destination}</span>{' '}
      <span>{calendarStrings.basisName[display.basis]}</span>
      {isCalendar && <span> · {calendarStrings.constraintsNotChecked}</span>}
      {display.stale && <span> · {calendarStrings.stale}</span>}
      <Provenance provenance={p.provenance} now={now} />
      {note !== undefined && <span className="block text-[10px]">{note}</span>}
    </div>
  );
}

function GlyphList({ glyphs }: { glyphs: readonly GlyphStatus[] }) {
  if (glyphs.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1 text-[10px]">
      {glyphs.map((g) => (
        <li key={g} data-glyph={g}>
          <span aria-hidden="true" className="font-bold">{calendarStrings.glyphs[g].symbol}</span> {calendarStrings.glyphs[g].text}
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/src/views/Calendar/CalendarLegend.tsx`:

```tsx
import { formatPence } from '../../lib/money.js';
import { calendarStrings } from '../../strings.js';
import type { CalendarModel } from './display.js';
import { BAND_CLASSES } from './scale.js';
import type { DayBasis } from './types.js';

/** Numeric legend (spec §11): the basis on the scale, each band's pence range and day count, the hatched days, and the glyphs. */
export function CalendarLegend({ model }: { model: CalendarModel }) {
  const other: DayBasis = model.colourBasis === 'verified' ? 'calendar' : 'verified';
  return (
    <section aria-label={calendarStrings.legendTitle} data-testid="calendar-legend" className="text-sm">
      <p>{calendarStrings.legendScale(model.colourBasis, model.scale.count)}</p>
      <ul>
        {model.scale.legend.map((e) => (
          <li key={e.band}>
            <span aria-hidden="true" className={`mr-1 inline-block h-3 w-3 align-middle ${BAND_CLASSES[e.band]}`} />
            {calendarStrings.legendBand(e.band, formatPence(e.minPence), formatPence(e.maxPence), e.count)}
          </li>
        ))}
        {model.hatchedDays > 0 && (
          <li>
            <span aria-hidden="true" className="day-hatched mr-1 inline-block h-3 w-3 align-middle" />
            {calendarStrings.legendHatched(other, model.hatchedDays)}
          </li>
        )}
      </ul>
      <p>{calendarStrings.legendGlyphs}</p>
      <ul>
        {(['empty', 'no_data', 'error', 'not_run'] as const).map((g) => (
          <li key={g}>
            <span aria-hidden="true">{calendarStrings.glyphs[g].symbol}</span> {calendarStrings.glyphs[g].text}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/grid.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar grid with hatched days, glyphs, numeric legend and keyboard navigation"
```

### Task 10.6: Side panel: outcomes, prices with full provenance, per-cell verify

**Files:**
- Create: `apps/web/src/views/Calendar/{CellPanel.tsx,PanelPrice.tsx}`, `apps/web/test/views/Calendar/panel.test.tsx`
- Modify: `apps/web/test/support/fixtures.ts` (add `verifyResponseFixture`)

**Interfaces:**
- Consumes: `fetchCellDetail`, `verifyCell`, `ApiError` (WP9), `priceCellSchema`, `effectiveAge`, `formatAgeFull`, `cellKeyString`, `addDays`, `daysBetween`, `Provenance` (WP9).
- Produces: `CellPanel({ definition, date, initialCell, now, onClose })`, `cellsForDay(definition, date)`, `PanelPrice({ price, kind, label, now })`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/support/fixtures.ts` a body for `POST /cells/verify` shaped by the plan's `executionResponseSchema` fields (a child execution just created):

```ts
export function verifyResponseFixture(at: CellKey) {
  return {
    id: 'child-1', definitionId: 'def-1', isChild: true, cell: at, status: 'pending', stage: 'verification', reason: null, resumeAfter: null,
    startedAt: NOW, finishedAt: null, progress: [], budget: [],
    estimate: { cells: 1, perProvider: [], totalCostMicroGbp: 0, totalCostPence: 0, seconds: 0, assumptions: [], windowClamped: false },
    ledger: { calls: 0, costMicroGbp: 0, costPence: 0 },
  };
}
```

`apps/web/test/views/Calendar/panel.test.tsx`:

```tsx
import { asIsoDate } from '@gmt/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { CellPanel, cellsForDay } from '../../../src/views/Calendar/CellPanel.js';
import { PanelPrice } from '../../../src/views/Calendar/PanelPrice.js';
import { cell, definitionFixture, EWR, hoursBefore, LGW, NOW, price, provenanceCalendar, provenanceVerified, verifyResponseFixture } from '../../support/fixtures.js';
import { renderWithQuery } from '../../support/render.js';
import { server, useMswServer } from '../../support/server.js';

useMswServer();

const c = cell('2027-03-14', 14);
const date = asIsoDate('2027-03-14');
const detail = {
  cell: c,
  outcomes: [
    { executionId: 'exec-1', stage: 'discovery', providerId: 'travelpayouts', status: 'priced', reason: null, attempts: 1, fetchedAt: hoursBefore(NOW, 2), reusedFromExecutionId: 'exec-0' },
    { executionId: 'exec-1', stage: 'verification', providerId: 'searchapi', status: 'not_run', reason: null, attempts: 0, fetchedAt: null, reusedFromExecutionId: null },
  ],
  calendarPrices: [{ ...price(41200, provenanceCalendar(2), false, c), executionId: 'exec-0', reusedFromExecutionId: 'exec-0' }],
  observations: [{ ...price(52000, provenanceVerified(5), false, c), itineraryHash: 'abc123', seller: 'Example Air', verdictClass: 'verified', booking: { kind: 'none' } }],
};
const cellRoute = '*/definitions/:id/cells/:o/:d/:dep/:ret';

function renderPanel(def = definitionFixture(), onClose = vi.fn()) {
  renderWithQuery(<CellPanel definition={def} date={date} initialCell={c} now={NOW} onClose={onClose} />);
  return { onClose };
}

describe('View B side panel (spec §11, §10 cells route)', () => {
  it('lists the cell outcomes per stage and provider, including reuse', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    renderPanel();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/discovery.*Aviasales cache.*priced.*run exec-0/);
    expect(rows[1]).toHaveTextContent(/itinerary search.*Google Flights via SearchApi.*not searched/);
  });

  it('shows every price with full provenance; the calendar price is dashed and says constraints not checked', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    renderPanel();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('£412');
    expect(within(dialog).getAllByTestId('provenance')).toHaveLength(2);
    expect(dialog).toHaveTextContent('fetched 2h ago · provider age unknown (≤2d before that)');
    expect(dialog).toHaveTextContent('itinerary offer · Example Air · verified');
    const calendarBlock = within(dialog).getByText('£412').closest('[data-testid="panel-price"]');
    expect(calendarBlock).toHaveClass('border-dashed');
    expect(calendarBlock).toHaveTextContent('constraints not checked');
  });

  it('a price lacking provenance fails to render (component guard)', () => {
    render(<PanelPrice price={{ pricePence: 41200, stale: false, ageHours: 2 }} kind="calendar" label="calendar price" now={NOW} />);
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
    expect(screen.queryByText(/£412/)).toBeNull();
  });

  it('a price lacking provenance fails to render (api response refused, no amount shown)', async () => {
    const { provenance: _dropped, ...bare } = detail.calendarPrices[0] as (typeof detail.calendarPrices)[number];
    server.use(http.get(cellRoute, () => HttpResponse.json({ ...detail, calendarPrices: [bare], observations: [] })));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Could not load the cell/);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('£');
  });

  it('hides the verify action when the definition has no verification provider', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    renderPanel(definitionFixture({ providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } }));
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Run itinerary search for this cell' })).toBeNull();
  });

  it('verify posts the definition and cell, then confirms; a 409 says a search is already running', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    server.use(
      http.get(cellRoute, () => HttpResponse.json(detail)),
      http.post('*/cells/verify', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(verifyResponseFixture(c));
      }),
    );
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Run itinerary search for this cell' }));
    expect(await screen.findByText('Itinerary search started for this cell; results appear when it finishes.')).toBeInTheDocument();
    expect(posted).toEqual({ definitionId: 'def-1', cell: c });

    server.use(http.post('*/cells/verify', () => HttpResponse.json({ error: { code: 'conflict', message: 'child active' } }, { status: 409 })));
    await user.click(screen.getByRole('button', { name: 'Run itinerary search for this cell' }));
    expect(await screen.findByText('An itinerary search for this cell is already running.')).toBeInTheDocument();
  });

  it('the cell picker lists origins × destinations × nights for the day and fetches the chosen cell', async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    server.use(
      http.get(cellRoute, ({ request, params }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({ ...detail, cell: { origin: params.o, destination: params.d, departureDate: params.dep, returnDate: params.ret }, calendarPrices: [], observations: [] });
      }),
    );
    expect(cellsForDay(definitionFixture(), date)).toHaveLength(2 * 2 * 12);
    renderPanel();
    const picker = await screen.findByLabelText('Cell');
    const target = cellsForDay(definitionFixture(), date).findIndex((k) => k.origin === LGW && k.destination === EWR && k.returnDate === '2027-04-04');
    await user.selectOptions(picker, String(target));
    await waitFor(() => expect(paths.at(-1)).toMatch(/\/cells\/LGW\/EWR\/2027-03-14\/2027-04-04$/));
    expect(screen.getByRole('option', { name: 'LGW→EWR · 21 nights · back Sun 4 Apr' })).toBeInTheDocument();
  });

  it('focuses its heading on open and closes on Escape', async () => {
    const user = userEvent.setup();
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { onClose } = renderPanel();
    expect(screen.getByRole('heading', { name: 'Departing Sun 14 Mar 2027' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/panel.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CellPanel.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/PanelPrice.tsx`:

```tsx
import { effectiveAge, formatAgeFull, type IsoDateTime, priceCellSchema } from '@gmt/core';
import { Provenance } from '../../components/Provenance.js';
import { formatPence } from '../../lib/money.js';
import { calendarStrings } from '../../strings.js';

/**
 * One price in the side panel with its full provenance (spec §3, §11). It takes `unknown` and re-validates: a price without
 * provenance must never render an amount, even if a caller bypasses the api client's schema check (§9 item 6).
 */
export function PanelPrice({ price, kind, label, now }: { price: unknown; kind: 'calendar' | 'observation'; label: string; now: IsoDateTime }) {
  const parsed = priceCellSchema.safeParse(price);
  if (!parsed.success) return <p role="alert" data-testid="price-withheld">{calendarStrings.panel.provenanceMissing}</p>;
  const p = parsed.data;
  return (
    <div data-testid="panel-price" className={`rounded border border-current p-2 ${kind === 'calendar' ? 'border-dashed' : 'border-solid'}`}>
      <span className="font-semibold">{formatPence(p.pricePence)}</span> <span>{label}</span>
      {kind === 'calendar' && <span> · {calendarStrings.constraintsNotChecked}</span>}
      {p.stale && <span> · {calendarStrings.stale}</span>}
      <Provenance provenance={p.provenance} now={now} />
      <p className="text-xs">{formatAgeFull(effectiveAge(p.provenance, now))}</p>
    </div>
  );
}
```

`apps/web/src/views/Calendar/CellPanel.tsx`:

```tsx
import { addDays, cellKeyString, type CellKey, daysBetween, type IsoDate, type IsoDateTime } from '@gmt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { type CellDetailResponse, type DefinitionResponse, fetchCellDetail, verifyCell } from '../../api/views.js';
import { formatIsoDate, formatIsoDateShort } from '../../lib/isoDate.js';
import { formatInstantLondon, instantMs } from '../../lib/time.js';
import { calendarStrings, providerLabel } from '../../strings.js';
import { PanelPrice } from './PanelPrice.js';

const S = calendarStrings.panel;

/** Every cell departing on `date`: origins × destinations × nights, in generation order (spec §6.1). */
export function cellsForDay(definition: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>, date: IsoDate): CellKey[] {
  const out: CellKey[] = [];
  for (const origin of definition.origins)
    for (const destination of definition.destinations)
      for (let n = definition.minNights; n <= definition.maxNights; n += 1) out.push({ origin, destination, departureDate: date, returnDate: addDays(date, n) });
  return out;
}

export interface CellPanelProps { definition: DefinitionResponse; date: IsoDate; initialCell: CellKey | null; now: IsoDateTime; onClose(): void }

/** View B side panel: pick a cell of the day, see its outcomes per stage and provider and its prices, and verify it (spec §11, §8.1). */
export function CellPanel({ definition, date, initialCell, now, onClose }: CellPanelProps) {
  const cells = useMemo(() => cellsForDay(definition, date), [definition, date]);
  const [selected, setSelected] = useState<CellKey | null>(initialCell ?? cells[0] ?? null);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const qc = useQueryClient();
  const key = selected === null ? '' : cellKeyString(selected);
  const detail = useQuery({
    queryKey: ['cell', definition.id, key],
    queryFn: () => (selected === null ? Promise.reject(new Error('no cell')) : fetchCellDetail(definition.id, selected)),
    enabled: selected !== null,
  });
  const verify = useMutation({
    mutationFn: (c: CellKey) => verifyCell(definition.id, c),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cell', definition.id] });
      void qc.invalidateQueries({ queryKey: ['calendar', definition.id] });
    },
  });
  // why: spec §6.9 and §8.1 — the per-cell verify action is hidden when the definition has no verification provider.
  const canVerify = definition.providers.verification.length > 0;
  const selectedIndex = selected === null ? -1 : cells.findIndex((c) => cellKeyString(c) === key);
  const note = selected === null ? undefined : definition.destinationNotes[selected.destination];

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
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">{S.title(formatIsoDate(date))}</h2>
        <button type="button" onClick={onClose} className="rounded border px-2">{S.close}</button>
      </div>
      <label className="mt-3 flex flex-col text-sm">
        {S.cellPicker}
        <select value={selectedIndex >= 0 ? String(selectedIndex) : ''} onChange={(e) => setSelected(cells[Number(e.target.value)] ?? null)} className="rounded border px-2 py-1">
          {cells.map((c, i) => (
            <option key={cellKeyString(c)} value={String(i)}>
              {S.cellOption(c.origin, c.destination, daysBetween(c.departureDate, c.returnDate), formatIsoDateShort(c.returnDate))}
            </option>
          ))}
        </select>
      </label>
      {note !== undefined && <p className="mt-2 text-sm">{S.note}: {note}</p>}
      {selected !== null && detail.isPending && <p role="status">{S.loading}</p>}
      {detail.isError && <p role="alert">{S.error(detail.error.message)}</p>}
      {detail.data !== undefined && <CellDetailBody detail={detail.data} now={now} />}
      {canVerify && selected !== null && (
        <div className="mt-4">
          <button type="button" disabled={verify.isPending} onClick={() => verify.mutate(selected)} className="rounded bg-zinc-900 px-3 py-1 text-white">
            {S.verify}
          </button>
          {verify.isSuccess && <p role="status">{S.verifyStarted}</p>}
          {verify.isError && <p role="alert">{verify.error instanceof ApiError && verify.error.status === 409 ? S.verifyConflict : S.verifyFailed(verify.error.message)}</p>}
        </div>
      )}
    </aside>
  );
}

function CellDetailBody({ detail, now }: { detail: CellDetailResponse; now: IsoDateTime }) {
  const empty = detail.calendarPrices.length + detail.observations.length === 0;
  return (
    <>
      <h3 className="mt-4 font-medium">{S.outcomes}</h3>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {(['stage', 'provider', 'status', 'reason', 'attempts', 'fetched', 'reused'] as const).map((k) => (
              <th key={k} scope="col" className="text-left">{S.columns[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.outcomes.map((o) => (
            <tr key={`${o.executionId}|${o.stage}|${o.providerId}`}>
              <td>{S.stage[o.stage]}</td>
              <td>{providerLabel(o.providerId)}</td>
              <td>{S.status[o.status]}</td>
              <td>{o.reason ?? '—'}</td>
              <td>{o.attempts}</td>
              <td>{o.fetchedAt === null ? '—' : formatInstantLondon(instantMs(o.fetchedAt))}</td>
              <td>{o.reusedFromExecutionId === null ? S.notReused : S.reusedFrom(o.reusedFromExecutionId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mt-4 font-medium">{S.prices}</h3>
      {empty ? (
        <p>{S.noPrices}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.calendarPrices.map((p) => (
            <li key={`cal-${p.executionId}-${p.provenance.providerId}`}>
              <PanelPrice price={p} kind="calendar" label={S.calendarPrice} now={now} />
            </li>
          ))}
          {detail.observations.map((o) => (
            <li key={`obs-${o.itineraryHash}-${o.seller}`}>
              <PanelPrice price={o} kind="observation" label={S.observation(o.seller, o.verdictClass)} now={now} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/panel.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: side panel with outcomes, provenance-guarded prices and per-cell verify"
```

### Task 10.7: Calendar view (data, destination filter, basis toggle, states)

**Files:**
- Create: `apps/web/src/views/Calendar/CalendarView.tsx`, `apps/web/test/views/Calendar/view.test.tsx`

**Interfaces:**
- Consumes: `fetchCalendar`, `ViewHeader` (WP9), `CalendarGrid`, `CalendarLegend`, `buildCalendarModel`, `totalReused`, `ReusedNote`, and `CellPanel` (Task 10.6).
- Produces: `CalendarView({ definition, now? })`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/Calendar/view.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CalendarView } from '../../../src/views/Calendar/CalendarView.js';
import type { CalendarDay } from '../../../src/views/Calendar/types.js';
import { buckets, cell, day, definitionFixture, EWR, JFK, NOW, price, provenanceCalendar } from '../../support/fixtures.js';
import { renderWithQuery } from '../../support/render.js';
import { server, useMswServer } from '../../support/server.js';

useMswServer();

const body = (days: CalendarDay[]) => ({ days, executions: [{ id: 'exec-1', status: 'completed', ageHours: 2 }] });
const jfk = price(41200, provenanceCalendar(2), false, cell('2027-03-14', 14, undefined, JFK));
const ewr = price(39900, provenanceCalendar(2), false, cell('2027-03-14', 14, undefined, EWR));
const mixedDay = day('2027-03-14', {
  cheapestCalendar: ewr,
  discovery: [{ providerId: 'travelpayouts', buckets: buckets({ priced: 40, no_data: 8, reused: 3 }) }],
  byDestination: [
    { destination: JFK, discovery: [{ providerId: 'travelpayouts', buckets: buckets({ priced: 20, no_data: 4, reused: 1 }) }], verification: null, cheapestVerified: null, cheapestPartiallyVerified: null, cheapestCalendar: jfk },
    { destination: EWR, discovery: [{ providerId: 'travelpayouts', buckets: buckets({ priced: 20, no_data: 4, reused: 2 }) }], verification: null, cheapestVerified: null, cheapestPartiallyVerified: null, cheapestCalendar: ewr },
  ],
});
const ewrOnlyDay = day('2027-03-15', {
  cheapestCalendar: price(45000, provenanceCalendar(2), false, cell('2027-03-15', 14, undefined, EWR)),
  byDestination: [{ destination: EWR, discovery: [], verification: null, cheapestVerified: null, cheapestPartiallyVerified: null, cheapestCalendar: price(45000, provenanceCalendar(2), false, cell('2027-03-15', 14, undefined, EWR)) }],
});
const calendarRoute = '*/definitions/:id/calendar';

describe('Calendar view (spec §11 View B)', () => {
  it('shows an explicit loading state, then the grid', async () => {
    server.use(http.get(calendarRoute, async () => { await delay(30); return HttpResponse.json(body([mixedDay])); }));
    renderWithQuery(<CalendarView definition={definitionFixture()} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading calendar…');
    expect(await screen.findByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
  });

  it('shows an error state naming the failure', async () => {
    server.use(http.get(calendarRoute, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })));
    renderWithQuery(<CalendarView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Could not load the calendar/);
  });

  it('shows the empty state when there are no days', async () => {
    server.use(http.get(calendarRoute, () => HttpResponse.json(body([]))));
    renderWithQuery(<CalendarView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByText('No days to show yet. The calendar fills in as cells are searched.')).toBeInTheDocument();
  });

  it('the header carries the reused count for the visible slices', async () => {
    server.use(http.get(calendarRoute, () => HttpResponse.json(body([mixedDay]))));
    renderWithQuery(<CalendarView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByText('(3 reused from earlier runs)')).toBeInTheDocument();
  });

  it('the destination filter swaps every day to that destination and says when a day has none', async () => {
    const user = userEvent.setup();
    server.use(http.get(calendarRoute, () => HttpResponse.json(body([mixedDay, ewrOnlyDay]))));
    renderWithQuery(<CalendarView definition={definitionFixture()} now={NOW} />);
    const d14 = () => document.querySelector('[data-date="2027-03-14"]') as HTMLElement;
    const d15 = () => document.querySelector('[data-date="2027-03-15"]') as HTMLElement;
    await screen.findByRole('grid', { name: 'March 2027' });
    expect(within(d14()).getByTestId('day-price')).toHaveTextContent('£399');
    await user.selectOptions(screen.getByLabelText('Destination'), 'JFK');
    expect(within(d14()).getByTestId('day-price')).toHaveTextContent('£412');
    expect(d15()).toHaveTextContent('no cells for this destination');
    expect(screen.getByText('(1 reused from earlier runs)')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Destination'), 'EWR');
    expect(within(d14()).getByTestId('day-price')).toHaveTextContent('£399');
  });

  it('defaults the colour basis to calendar and disables verified when the definition has no verification provider', async () => {
    server.use(http.get(calendarRoute, () => HttpResponse.json(body([mixedDay]))));
    const def = definitionFixture({ providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } });
    renderWithQuery(<CalendarView definition={def} now={NOW} />);
    expect(await screen.findByRole('radio', { name: 'calendar prices' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'verified prices' })).toBeDisabled();
  });

  it('Enter opens the side panel for the day; Escape closes it and focus returns to the day', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(calendarRoute, () => HttpResponse.json(body([mixedDay]))),
      http.get('*/definitions/:id/cells/:o/:d/:dep/:ret', ({ params }) =>
        HttpResponse.json({ cell: { origin: params.o, destination: params.d, departureDate: params.dep, returnDate: params.ret }, outcomes: [], calendarPrices: [], observations: [] }),
      ),
    );
    renderWithQuery(<CalendarView definition={definitionFixture()} now={NOW} />);
    await screen.findByRole('grid', { name: 'March 2027' });
    // why: focus the day directly; tabbing would first reach the filter controls above the grid.
    (document.querySelector('[data-date="2027-03-14"]') as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Departing Sun 14 Mar 2027' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('[data-date="2027-03-14"]')).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar/view.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Calendar/CalendarView.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/Calendar/CalendarView.tsx`:

```tsx
import { asIata, type CellKey, type Iata, type IsoDate, type IsoDateTime } from '@gmt/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type DefinitionResponse, fetchCalendar } from '../../api/views.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { nowIso } from '../../lib/time.js';
import { calendarStrings } from '../../strings.js';
import { CalendarGrid } from './CalendarGrid.js';
import { CalendarLegend } from './CalendarLegend.js';
import { CellPanel } from './CellPanel.js';
import { ReusedNote } from './DayMarker.js';
import { buildCalendarModel, type GridDay } from './display.js';
import { totalReused } from './marker.js';
import type { DayBasis } from './types.js';

/** View B: the calendar heatmap for one definition (spec §11 View B, §10 calendar route). */
export function CalendarView({ definition, now: nowProp }: { definition: DefinitionResponse; now?: IsoDateTime }) {
  // why: one "now" per mount keeps ages and the colour model stable across re-renders.
  const [now] = useState<IsoDateTime>(() => nowProp ?? nowIso());
  const q = useQuery({ queryKey: ['calendar', definition.id], queryFn: () => fetchCalendar(definition.id) });
  const [destination, setDestination] = useState<Iata | 'all'>('all');
  const [chosenBasis, setChosenBasis] = useState<DayBasis | null>(null);
  const [open, setOpen] = useState<{ date: IsoDate; cell: CellKey | null } | null>(null);
  const hasVerification = definition.providers.verification.length > 0;

  const days = useMemo<GridDay[]>(
    () =>
      (q.data?.days ?? []).map((d) => ({
        date: d.date,
        slice: destination === 'all' ? d : (d.byDestination.find((x) => x.destination === destination) ?? null),
      })),
    [q.data, destination],
  );
  // why: §6.9 — calendar is the default when there is no verification provider or nothing verified to colour by.
  const defaultBasis: DayBasis = hasVerification && days.some((d) => d.slice?.cheapestVerified != null) ? 'verified' : 'calendar';
  const colourBasis = chosenBasis ?? defaultBasis;
  const model = useMemo(() => buildCalendarModel(days, colourBasis, now), [days, colourBasis, now]);

  if (q.isPending) return <p role="status">{calendarStrings.loading}</p>;
  if (q.isError) return <p role="alert">{calendarStrings.error(q.error.message)}</p>;

  const slices = days.flatMap((d) => (d.slice === null ? [] : [d.slice]));
  const closePanel = () => {
    const date = open?.date;
    setOpen(null);
    if (date !== undefined) document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  };

  return (
    <section aria-label={calendarStrings.title} className="flex flex-col gap-4">
      <ViewHeader title={calendarStrings.title} executions={q.data.executions}>
        <ReusedNote count={totalReused(slices)} />
      </ViewHeader>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm">
          {calendarStrings.destinationFilter}
          <select
            value={destination}
            // why: option values come from the definition's own destinations, never free text, so asIata cannot throw here.
            onChange={(e) => setDestination(e.target.value === 'all' ? 'all' : asIata(e.target.value))}
            className="rounded border px-2 py-1"
          >
            <option value="all">{calendarStrings.allDestinations}</option>
            {definition.destinations.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend>{calendarStrings.colourBy}</legend>
          {(['verified', 'calendar'] as const).map((b) => (
            <label key={b} className="mr-3">
              <input type="radio" name="colour-basis" value={b} checked={colourBasis === b} disabled={b === 'verified' && !hasVerification} onChange={() => setChosenBasis(b)} />{' '}
              {calendarStrings.colourByOption[b]}
            </label>
          ))}
        </fieldset>
      </div>
      {days.length === 0 ? (
        <p>{calendarStrings.empty}</p>
      ) : (
        <>
          <CalendarGrid days={days} model={model} now={now} destinationNotes={definition.destinationNotes} onOpen={(date, cell) => setOpen({ date, cell })} />
          <CalendarLegend model={model} />
        </>
      )}
      {open !== null && <CellPanel definition={definition} date={open.date} initialCell={open.cell} now={now} onClose={closePanel} />}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Calendar`
Expected: PASS (marker, display, scale, grid, panel, view; 47 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar view with destination filter, basis toggle and explicit states"
```

### Task 10.8: The TZ suite (review focus 3, pinned)

**Files:**
- Create: `apps/web/test/setup-tz.ts`, `apps/web/test/tz/dates.tz.test.tsx`
- Modify: `apps/web/test/support/fixtures.ts` (add `resultRowFixture`, `resultsBodyFixture`), `apps/web/vitest.config.ts`, `apps/web/package.json` (scripts), WP9's Results date columns (`apps/web/src/views/Results/columns.tsx`) to render with `formatIsoDateShort`

**Interfaces:**
- Consumes: `CalendarGrid`, `buildCalendarModel`, `formatIsoDate`, `ResultsView` (WP9).
- Produces: the `test:tz` script; the `test` script that runs coverage, then `test:tz`.

The suite proves the zone in two ways. The `test:tz` script runs the TZ suite and the calendar tests twice, as whole processes with `GMT_TEST_TZ=America/Los_Angeles` and then `GMT_TEST_TZ=Asia/Tokyo`. `test/setup-tz.ts` copies that value into `process.env.TZ` before any test module is imported. Inside the TZ suite, `describe.each` also switches `process.env.TZ` per block, so the root `pnpm test` (one process, the machine's zone) still exercises both zones. Each block first asserts that the zone took effect (`Intl` resolved zone and the January UTC offset), so the suite cannot pass vacuously under UTC.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/support/fixtures.ts` a Results row and body (the row is the plan's Task 0.8 contract-test row with provenance added):

```ts
export function resultRowFixture(partial: Record<string, unknown> = {}) {
  return {
    itineraryHash: 'abc123', basis: 'calendar', verdictClass: 'unchecked', pricePence: 41200,
    provenance: provenanceCalendar(2), stale: false, ageHours: 50,
    cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-14', returnDate: '2027-03-28', nights: 14 },
    outbound: null, inbound: null, totalMinutes: null, stopsOut: null, stopsIn: null, carriers: [], verdicts: {}, unverified: [],
    notApplied: ['arrivalWindowLocal'], booking: { kind: 'none' },
    searchLink: { url: 'https://www.aviasales.com/search/LON1403NYC28031', host: 'www.aviasales.com', label: 'search link, not a fare link' },
    otherOffers: [], notSeenInLatest: null, adjustedPence: null, destinationNote: null, bandCheapest: true,
    ...partial,
  };
}

export function resultsBodyFixture() {
  return {
    rows: [resultRowFixture()], total: 1, truncated: false, basis: 'calendar', basisReason: 'no observations yet',
    executions: [{ id: 'exec-1', status: 'completed', ageHours: 2 }],
    coverage: { buckets: buckets({ priced: 1 }), total: 1, selected: 0, itinerarySearched: 0, onDemand: 0 }, excludedByCurrentSpace: 0,
  };
}
```

`apps/web/test/tz/dates.tz.test.tsx`:

```tsx
import { asIsoDate } from '@gmt/core';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIsoDate, formatIsoDateShort } from '../../src/lib/isoDate.js';
import { CalendarGrid } from '../../src/views/Calendar/CalendarGrid.js';
import { buildCalendarModel, type GridDay } from '../../src/views/Calendar/display.js';
import { ResultsView } from '../../src/views/Results/ResultsView.js';
import { cell, day, definitionFixture, NOW, price, provenanceVerified, resultsBodyFixture } from '../support/fixtures.js';
import { renderWithQuery } from '../support/render.js';
import { server, useMswServer } from '../support/server.js';

useMswServer();

const ZONES = ['America/Los_Angeles', 'Asia/Tokyo'] as const;
// why: the 2027-01-01 offsets prove the zone is in effect, so these tests cannot pass vacuously in UTC.
const JAN_OFFSET_MINUTES = { 'America/Los_Angeles': 480, 'Asia/Tokyo': -540 } as const;
// why: the control proves the bug this suite guards against is real in each zone (a naive Date moves the day).
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
    expect(formatIsoDate(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027'); // US DST starts
    expect(formatIsoDate(asIsoDate('2027-03-28'))).toBe('Sun 28 Mar 2027'); // UK DST starts
    expect(formatIsoDate(asIsoDate('2027-10-31'))).toBe('Sun 31 Oct 2027'); // UK DST ends
    expect(formatIsoDate(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
  });

  it('the calendar grid renders each day under its own date and weekday', () => {
    const days: GridDay[] = ['2027-03-13', '2027-03-14', '2027-03-15', '2027-03-28', '2027-03-31', '2027-04-01'].map((d) => ({
      date: asIsoDate(d),
      slice: day(d, { cheapestVerified: price(41200, provenanceVerified(5), false, cell(d, 14)) }),
    }));
    render(<CalendarGrid days={days} model={buildCalendarModel(days, 'verified', NOW)} now={NOW} destinationNotes={{}} onOpen={() => undefined} />);
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
    server.use(http.get('*/definitions/:id/results', () => HttpResponse.json(resultsBodyFixture())));
    renderWithQuery(<ResultsView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByText(formatIsoDateShort(asIsoDate('2027-03-14')))).toBeInTheDocument();
    expect(screen.getByText(formatIsoDateShort(asIsoDate('2027-03-28')))).toBeInTheDocument();
    expect(screen.queryByText(/\b13 Mar\b|\b15 Mar\b|\b27 Mar\b|\b29 Mar\b/)).toBeNull();
  });
});
```

`apps/web/test/setup-tz.ts`:

```ts
// Review focus 3. Vitest runs setupFiles in each worker before importing the test file, so no Date exists yet.
// The test:tz script sets GMT_TEST_TZ; Node applies an assignment to process.env.TZ to Date and Intl at once.
// why: a separate variable (not TZ itself) lets the script name the zone explicitly without inheriting a stray shell TZ.
const forced = process.env.GMT_TEST_TZ;
if (forced !== undefined && forced !== '') process.env.TZ = forced;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/tz`
Expected: FAIL on "the Results date columns render departure and return from their strings", because WP9's columns do not yet render `formatIsoDateShort` output ("Sun 14 Mar"). Under a worker-thread pool, "the zone is in effect" also fails; Step 3's `pool: 'forks'` fixes that.

Run: `pnpm --filter @gmt/web run test:tz`
Expected: FAIL with `Missing script: "test:tz"`.

- [ ] **Step 3: Implement**

`apps/web/vitest.config.ts` (WP0 created it and WP9 may have extended it; keep WP9's plugins and add the marked lines):

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    // why: forks keep each worker a separate Node process, where assigning process.env.TZ re-detects the zone (review focus 3).
    pool: 'forks',
    include: ['test/**/*.test.{ts,tsx}'],
    // why: the Playwright smoke lives in e2e/ and runs only through `pnpm --filter @gmt/web e2e` (spec §9 item 6).
    exclude: ['e2e/**', 'node_modules/**'],
    // why: setup-tz must run first so the zone is set before anything else touches Date.
    setupFiles: ['test/setup-tz.ts', 'test/setup.ts', 'test/setup-charts.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
    },
  },
});
```

(`test/setup-charts.ts` is created in Task 10.9. Create it now as an empty module, `export {};`, so this config loads.)

`apps/web/package.json` scripts (add or replace these four; keep WP9's `dev`, `build`, `preview` and `typecheck`):

```json
{
  "test": "vitest run --coverage && pnpm run test:tz",
  "test:tz": "GMT_TEST_TZ=America/Los_Angeles vitest run test/tz test/views/Calendar && GMT_TEST_TZ=Asia/Tokyo vitest run test/tz test/views/Calendar",
  "e2e": "pnpm --workspace-root run build && playwright test",
  "e2e:install": "playwright install chromium"
}
```

WP9's Results date columns (the departure and return cells in `apps/web/src/views/Results/columns.tsx`) render `formatIsoDateShort(row.cell.departureDate)` and `formatIsoDateShort(row.cell.returnDate)`, importing `formatIsoDateShort` from `../../lib/isoDate.js`. Change nothing else in that file.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/tz`
Expected: PASS, 10 tests (5 per zone).

Run: `pnpm --filter @gmt/web run test:tz`
Expected: two passing runs, each listing `test/tz/dates.tz.test.tsx` and the six `test/views/Calendar/*` files with every test passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: TZ suite under Los Angeles and Tokyo for calendar and results dates (review focus 3)"
```

### Task 10.9: View C Duration (Recharts 3)

**Files:**
- Create: `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`, `apps/web/test/views/Duration/duration.test.tsx`
- Modify: `apps/web/test/setup-charts.ts` (replace the empty module from Task 10.8), `apps/web/src/strings.ts` (append `durationStrings`)

**Interfaces:**
- Consumes: `fetchDuration`, `ViewHeader`, `Provenance`, `formatPence`, `providerLabel` (WP9); recharts `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.
- Produces: `buildDurationData(resp, minNights, maxNights, hasVerification)`, `DurationChart`, `DurationTooltip`, `DurationTable`, `DurationView`, `durationStrings`.

There is one row per nights value in `[minNights, maxNights]`. A nights value the api did not return, or returned with no price, is `null`: Recharts draws no bar for it, and the data table says "no price". Nothing is interpolated and nothing becomes 0.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/Duration/duration.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { DurationResponse } from '../../../src/api/views.js';
import { buildDurationData } from '../../../src/views/Duration/data.js';
import { DurationTooltip } from '../../../src/views/Duration/DurationChart.js';
import { DurationView } from '../../../src/views/Duration/DurationView.js';
import { cell, definitionFixture, NOW, price, provenanceCalendar, provenanceVerified } from '../../support/fixtures.js';
import { renderWithQuery } from '../../support/render.js';
import { server, useMswServer } from '../../support/server.js';

useMswServer();

const c = cell('2027-03-14', 14);
function night(nights: number, verified: [number, number] | null, calendar: [number, number] | null): DurationResponse['nights'][number] {
  return {
    nights,
    minVerified: verified === null ? null : { ...price(verified[0], provenanceVerified(5), false, c), n: verified[1] },
    minCalendar: [{ providerId: 'travelpayouts', price: calendar === null ? null : price(calendar[0], provenanceCalendar(2), false, c), n: calendar?.[1] ?? 0 }],
  };
}
const resp: DurationResponse = { nights: [night(10, [52000, 3], [41200, 5]), night(12, null, [39900, 4])], executions: [{ id: 'exec-1', status: 'completed', ageHours: 2 }] };
const route = '*/definitions/:id/duration-analysis';
const def = definitionFixture({ minNights: 10, maxNights: 14 });

describe('duration data (spec §11 View C)', () => {
  it('one row per nights in range; unsearched nights are null gaps, never 0, never interpolated', () => {
    const d = buildDurationData(resp, 10, 14, true);
    expect(d.rows.map((r) => r.nights)).toEqual([10, 11, 12, 13, 14]);
    expect(d.rows.map((r) => r.cells.verified?.pricePence ?? null)).toEqual([52000, null, null, null, null]);
    expect(d.rows.map((r) => r.cells['calendar:travelpayouts']?.pricePence ?? null)).toEqual([41200, null, 39900, null, null]);
    expect(d.isEmpty).toBe(false);
  });
  it('names the series with n in the label', () => {
    const d = buildDurationData(resp, 10, 14, true);
    expect(d.series.map((s) => s.name)).toEqual(['min among verified (class verified, n=3)', 'calendar, Aviasales cache (constraints not checked, n=9)']);
  });
  it('omits the verified series when there is no verification provider and nothing verified', () => {
    const noV: DurationResponse = { ...resp, nights: [night(10, null, [41200, 5])] };
    expect(buildDurationData(noV, 10, 14, false).series.map((s) => s.key)).toEqual(['calendar:travelpayouts']);
  });
  it('is empty when no nights has a price', () => {
    expect(buildDurationData({ ...resp, nights: [night(10, null, null)] }, 10, 14, true).isEmpty).toBe(true);
  });
  it('the tooltip shows the nights and n for every series', () => {
    const d = buildDurationData(resp, 10, 14, true);
    render(<DurationTooltip active payload={[{ payload: d.rows[0] }]} series={d.series} />);
    const tip = screen.getByTestId('duration-tooltip');
    expect(tip).toHaveTextContent('10 nights');
    expect(tip).toHaveTextContent('min among verified: £520 (n=3)');
    expect(tip).toHaveTextContent('calendar, Aviasales cache: £412 (n=5)');
  });
  it('the tooltip renders nothing when inactive', () => {
    const { container } = render(<DurationTooltip active={false} payload={[]} series={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Duration view (spec §11 View C)', () => {
  it('shows an explicit loading state', () => {
    server.use(http.get(route, async () => { await delay('infinite'); return HttpResponse.json(resp); }));
    renderWithQuery(<DurationView definition={def} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading duration analysis…');
  });
  it('shows an error state', async () => {
    server.use(http.get(route, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })));
    renderWithQuery(<DurationView definition={def} now={NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Could not load the duration analysis/);
  });
  it('shows an explicit empty state and no chart', async () => {
    server.use(http.get(route, () => HttpResponse.json({ ...resp, nights: [] })));
    renderWithQuery(<DurationView definition={def} now={NOW} />);
    expect(await screen.findByText(/^No prices yet for any stay length/)).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });
  it('draws the chart with axis titles, a legend carrying n, and a table where every price has provenance', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    renderWithQuery(<DurationView definition={def} now={NOW} />);
    const table = await screen.findByRole('table', { name: 'Cheapest price per stay length, with provenance' });
    const svg = document.querySelector('.recharts-responsive-container svg');
    expect(svg?.textContent).toContain('nights');
    expect(svg?.textContent).toContain('£');
    const legend = document.querySelector('.recharts-legend-wrapper');
    expect(legend?.textContent).toContain('min among verified (class verified, n=3)');
    expect(legend?.textContent).toContain('calendar, Aviasales cache (constraints not checked, n=9)');
    expect(table.querySelectorAll('[data-testid="provenance"]')).toHaveLength(3);
    expect(table).toHaveTextContent('no price');
    expect(screen.getByText(/not searched or was searched with no fares/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Duration`
Expected: FAIL with `Failed to resolve import "../../../src/views/Duration/data.js"`.

- [ ] **Step 3: Implement**

`apps/web/test/setup-charts.ts`:

```ts
// Recharts in jsdom (verified against recharts 3 ResponsiveContainer source, 2026-10-14):
// ResponsiveContainer reads getBoundingClientRect() of its container on mount, then subscribes a ResizeObserver,
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
  // why: give only the chart container a size, so every other layout assertion still sees jsdom's real 0×0.
  if (this.classList.contains('recharts-responsive-container')) {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 320, width: 800, height: 320, toJSON: () => ({}) } as DOMRect;
  }
  return original.call(this);
};
```

`apps/web/src/strings.ts`: append

```ts
/** View C strings (spec §11 View C; series labels as the spec words them). WP10. */
export const durationStrings = {
  title: 'Duration',
  chartTitle: 'Cheapest price by stay length',
  xAxis: 'nights',
  yAxis: '£',
  verifiedSeries: (n: number): string => `min among verified (class verified, n=${n})`,
  verifiedShort: 'min among verified',
  calendarSeries: (provider: string, n: number): string => `calendar, ${provider} (constraints not checked, n=${n})`,
  calendarShort: (provider: string): string => `calendar, ${provider}`,
  nightsLabel: (n: number): string => `${n} nights`,
  tooltipValue: (price: string, n: number): string => `${price} (n=${n})`,
  noPrice: 'no price',
  noPriceNote: 'A stay length with no price was not searched or was searched with no fares; Coverage shows which.',
  tableCaption: 'Cheapest price per stay length, with provenance',
  loading: 'Loading duration analysis…',
  empty: "No prices yet for any stay length in this definition's range. Run a search; Coverage shows what has been searched.",
  error: (message: string): string => `Could not load the duration analysis: ${message}`,
} as const;
```

`apps/web/src/views/Duration/data.ts`:

```ts
import type { ProviderId } from '@gmt/core';
import type { DurationResponse } from '../../api/views.js';
import { durationStrings, providerLabel } from '../../strings.js';

type Night = DurationResponse['nights'][number];
/** A price cell as the duration route sends it (amount, provenance, stale, ageHours). */
export type DurationPrice = NonNullable<Night['minCalendar'][number]['price']>;
export interface DurationCell { pricePence: number | null; n: number; price: DurationPrice | null }
export interface DurationRow { nights: number; cells: Record<string, DurationCell> }
export interface DurationSeries { key: string; kind: 'verified' | 'calendar'; providerId: ProviderId | null; totalN: number; name: string; shortName: string }
export interface DurationData { rows: DurationRow[]; series: DurationSeries[]; isEmpty: boolean }

/**
 * Rows for every nights in [minNights, maxNights] and one series per basis and provider (spec §11 View C).
 * Missing nights stay null so the chart shows a gap (no interpolation); `n` is summed per series for the legend label.
 */
export function buildDurationData(resp: DurationResponse, minNights: number, maxNights: number, hasVerification: boolean): DurationData {
  const byNights = new Map<number, Night>(resp.nights.map((r) => [r.nights, r]));
  const providers: ProviderId[] = [];
  for (const r of resp.nights) for (const m of r.minCalendar) if (!providers.includes(m.providerId)) providers.push(m.providerId);
  const rows: DurationRow[] = [];
  for (let nights = minNights; nights <= maxNights; nights += 1) {
    const r = byNights.get(nights);
    const v = r?.minVerified ?? null;
    const cells: Record<string, DurationCell> = { verified: { pricePence: v?.pricePence ?? null, n: v?.n ?? 0, price: v } };
    for (const p of providers) {
      const m = r?.minCalendar.find((x) => x.providerId === p);
      cells[`calendar:${p}`] = { pricePence: m?.price?.pricePence ?? null, n: m?.n ?? 0, price: m?.price ?? null };
    }
    rows.push({ nights, cells });
  }
  const totalN = (key: string) => rows.reduce((sum, r) => sum + (r.cells[key]?.n ?? 0), 0);
  const anyVerified = rows.some((r) => r.cells.verified?.pricePence != null);
  const series: DurationSeries[] = [];
  // why: a verified series with no provider and no data would be an empty promise in the legend.
  if (hasVerification || anyVerified) {
    series.push({ key: 'verified', kind: 'verified', providerId: null, totalN: totalN('verified'), name: durationStrings.verifiedSeries(totalN('verified')), shortName: durationStrings.verifiedShort });
  }
  for (const p of providers) {
    const key = `calendar:${p}`;
    series.push({ key, kind: 'calendar', providerId: p, totalN: totalN(key), name: durationStrings.calendarSeries(providerLabel(p), totalN(key)), shortName: durationStrings.calendarShort(providerLabel(p)) });
  }
  const isEmpty = rows.every((r) => series.every((s) => r.cells[s.key]?.pricePence == null));
  return { rows, series, isEmpty };
}
```

`apps/web/src/views/Duration/DurationChart.tsx`:

```tsx
import type { IsoDateTime } from '@gmt/core';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Provenance } from '../../components/Provenance.js';
import { formatPence } from '../../lib/money.js';
import { calendarStrings, durationStrings } from '../../strings.js';
import type { DurationData, DurationRow, DurationSeries } from './data.js';

// why: categorical palette, one hue per series (dataviz skill); calendar series also get a dashed outline, so colour is never the only cue.
const SERIES_COLOURS = ['#1d4ed8', '#c2410c', '#7c3aed', '#047857'] as const;
const colourAt = (i: number): string => SERIES_COLOURS[i % SERIES_COLOURS.length] ?? '#1d4ed8';

/** Custom tooltip: nights, then each series' price and n (spec §11 View C: n in label and tooltip). */
export function DurationTooltip(props: { active?: boolean | undefined; payload?: ReadonlyArray<{ payload?: unknown }> | undefined; series: readonly DurationSeries[] }) {
  const row = props.payload?.[0]?.payload as DurationRow | undefined;
  if (props.active !== true || row === undefined) return null;
  return (
    <div data-testid="duration-tooltip" className="rounded border bg-white p-2 text-xs shadow">
      <p className="font-medium">{durationStrings.nightsLabel(row.nights)}</p>
      <ul>
        {props.series.map((s) => {
          const c = row.cells[s.key];
          return (
            <li key={s.key}>
              {s.shortName}: {c !== undefined && c.pricePence !== null ? durationStrings.tooltipValue(formatPence(c.pricePence), c.n) : `${durationStrings.noPrice} (n=0)`}
            </li>
          );
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
        <BarChart data={data.rows} margin={{ top: 8, right: 16, bottom: 28, left: 24 }} title={durationStrings.chartTitle}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="nights" label={{ value: durationStrings.xAxis, position: 'insideBottom', offset: -16 }} />
          <YAxis tickFormatter={(v: number) => formatPence(v)} label={{ value: durationStrings.yAxis, angle: -90, position: 'insideLeft' }} />
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

/** The same numbers as a table, each price with its provenance visible (spec §11; accessibility). */
export function DurationTable({ data, now }: { data: DurationData; now: IsoDateTime }) {
  return (
    <>
      <table className="mt-4 w-full text-xs">
        <caption className="text-left font-medium">{durationStrings.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{durationStrings.xAxis}</th>
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
                      durationStrings.noPrice
                    ) : (
                      <>
                        <span>{durationStrings.tooltipValue(formatPence(c.price.pricePence), c.n)}</span>
                        {c.price.stale && <span> · {calendarStrings.stale}</span>}
                        {s.kind === 'calendar' && <span> · {calendarStrings.constraintsNotChecked}</span>}
                        <Provenance provenance={c.price.provenance} now={now} />
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs">{durationStrings.noPriceNote}</p>
    </>
  );
}
```

`apps/web/src/views/Duration/DurationView.tsx`:

```tsx
import type { IsoDateTime } from '@gmt/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type DefinitionResponse, fetchDuration } from '../../api/views.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { nowIso } from '../../lib/time.js';
import { durationStrings } from '../../strings.js';
import { buildDurationData } from './data.js';
import { DurationChart, DurationTable } from './DurationChart.js';

/** View C: cheapest price per stay length (spec §11 View C, §10 duration-analysis route). */
export function DurationView({ definition, now: nowProp }: { definition: DefinitionResponse; now?: IsoDateTime }) {
  const [now] = useState<IsoDateTime>(() => nowProp ?? nowIso());
  const q = useQuery({ queryKey: ['duration', definition.id], queryFn: () => fetchDuration(definition.id) });
  const data = useMemo(
    () => (q.data === undefined ? null : buildDurationData(q.data, definition.minNights, definition.maxNights, definition.providers.verification.length > 0)),
    [q.data, definition],
  );
  if (q.isPending) return <p role="status">{durationStrings.loading}</p>;
  if (q.isError) return <p role="alert">{durationStrings.error(q.error.message)}</p>;
  return (
    <section aria-label={durationStrings.title} className="flex flex-col gap-4">
      <ViewHeader title={durationStrings.title} executions={q.data.executions} />
      {data === null || data.isEmpty ? (
        <p>{durationStrings.empty}</p>
      ) : (
        <>
          <DurationChart data={data} />
          <DurationTable data={data} now={now} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/Duration`
Expected: PASS, 10 tests. If the chart test finds no `svg`, the `setup-charts.ts` stub is not loaded: check that `setupFiles` lists it (Task 10.8).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: duration view with per-basis bars, n in label and tooltip, gaps and states (spec §11 View C)"
```

### Task 10.10: History view

**Files:**
- Create: `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,HistoryView.tsx}`, `apps/web/test/views/History/history.test.tsx`
- Modify: `apps/web/src/strings.ts` (append `historyStrings`)

**Interfaces:**
- Consumes: `fetchRouteHistory`, `fetchItineraryHistory`, `instantMs`, `formatInstantLondon`, `effectiveAge`, `formatAgeFull`, `Provenance`, `formatPence`, `providerLabel`; recharts `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.
- Produces: `buildHistoryLines`, `HistoryChart`, `HistoryTable`, `HistoryView`, `historyHref`, `itineraryHashFromLocation`, `historyStrings`.

A gap is a null point inserted between two consecutive points of one series that lie more than 2 × that provider's `discoveryRefreshHours` apart (default 168 h). `connectNulls={false}` then breaks the line there. The rule's reason: a series with no point for two refresh cycles was not fetched, and a joined line would claim the price held steady.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/History/history.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { HistoryResponse } from '../../../src/api/views.js';
import { historyHref, HistoryView, itineraryHashFromLocation } from '../../../src/views/History/HistoryView.js';
import { buildHistoryLines } from '../../../src/views/History/lines.js';
import { definitionFixture, hoursBefore, NOW, provenanceCalendar, provenanceVerified } from '../../support/fixtures.js';
import { renderWithQuery } from '../../support/render.js';
import { server, useMswServer } from '../../support/server.js';

useMswServer();

const pt = (h: number, pricePence: number, provenance: HistoryResponse['series'][number]['points'][number]['provenance']) => ({ fetchedAt: hoursBefore(NOW, h), pricePence, provenance });
const history: HistoryResponse = {
  series: [
    { providerId: 'travelpayouts', kind: 'calendar', points: [pt(0, 39900, provenanceCalendar(0)), pt(1000, 45000, provenanceCalendar(1000)), pt(496, 42000, provenanceCalendar(496)), pt(664, 43000, provenanceCalendar(664))] },
    { providerId: 'searchapi', kind: 'offer', points: [pt(5, 52000, provenanceVerified(5))] },
    { providerId: 'searchapi', kind: 'route-lowest', points: [pt(2, 38000, null), pt(26, 38500, null)] },
  ],
};
const routeRoute = '*/routes/:o/:d/history';

describe('history lines (spec §11 History)', () => {
  it('sorts by fetchedAt and inserts a null break only where a gap exceeds the threshold', () => {
    const [calendar] = buildHistoryLines(history, () => 336);
    expect(calendar?.points.map((p) => p.pricePence)).toEqual([45000, 43000, 42000, null, 39900]); // 1000→664 is 336h: no break; 496→0 is 496h: break
    expect(calendar?.points.every((p, i, a) => i === 0 || p.t > (a[i - 1]?.t ?? 0))).toBe(true);
  });
  it('labels each series by provider and kind, with the spec wording for the route series', () => {
    expect(buildHistoryLines(history, () => 336).map((l) => l.name)).toEqual([
      'Aviasales cache · calendar price (constraints not checked)',
      'Google Flights via SearchApi · itinerary offer',
      "Google's route-level lowest price, cabin unknown",
    ]);
  });
  it('drops series with no points', () => {
    expect(buildHistoryLines({ series: [{ providerId: 'searchapi', kind: 'offer', points: [] }] }, () => 336)).toEqual([]);
  });
});

describe('History view (spec §11 History, §10 history routes)', () => {
  it('shows an explicit loading state', () => {
    server.use(http.get(routeRoute, async () => { await delay('infinite'); return HttpResponse.json(history); }));
    renderWithQuery(<HistoryView definition={definitionFixture()} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history…');
  });

  it('route mode: picks among the definition pairs and fetches the chosen route', async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    server.use(http.get(routeRoute, ({ request }) => { paths.push(new URL(request.url).pathname); return HttpResponse.json(history); }));
    renderWithQuery(<HistoryView definition={definitionFixture()} now={NOW} />);
    const picker = await screen.findByLabelText('Route');
    expect([...(picker as HTMLSelectElement).options].map((o) => o.text)).toEqual(['LHR→JFK', 'LHR→EWR', 'LGW→JFK', 'LGW→EWR']);
    await waitFor(() => expect(paths.at(-1)).toMatch(/\/routes\/LHR\/JFK\/history$/));
    await user.selectOptions(picker, '3');
    await waitFor(() => expect(paths.at(-1)).toMatch(/\/routes\/LGW\/EWR\/history$/));
  });

  it('draws one line per provider and kind with axis titles, and tables every price with its provenance', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json(history)));
    renderWithQuery(<HistoryView definition={definitionFixture()} now={NOW} />);
    await screen.findByRole('table', { name: /Aviasales cache · calendar price/ });
    const svg = document.querySelector('.recharts-responsive-container svg');
    expect(svg?.textContent).toContain('fetched (Europe/London time)');
    expect(svg?.textContent).toContain('£');
    const legend = document.querySelector('.recharts-legend-wrapper')?.textContent ?? '';
    expect(legend).toContain("Google's route-level lowest price, cabin unknown");
    expect(legend).toContain('Google Flights via SearchApi · itinerary offer');
    expect(document.querySelectorAll('[data-testid="provenance"]')).toHaveLength(5); // 4 calendar + 1 offer
    expect(screen.getAllByText('Google Flights via SearchApi · route-level series, cabin unknown · fetched 2h ago · provider age unknown')).toHaveLength(1);
  });

  it('withholds a non-route price that arrives without provenance', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json({ series: [{ providerId: 'travelpayouts', kind: 'calendar', points: [pt(3, 41200, null)] }] })));
    renderWithQuery(<HistoryView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByText('price withheld: provenance missing')).toBeInTheDocument();
    expect(screen.queryByText('£412')).toBeNull();
  });

  it('shows the empty state when there is no history', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json({ series: [] })));
    renderWithQuery(<HistoryView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByText('No price history yet for this selection. Each run adds a point.')).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('shows an error state', async () => {
    server.use(http.get(routeRoute, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })));
    renderWithQuery(<HistoryView definition={definitionFixture()} now={NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Could not load history/);
  });

  it('itinerary mode fetches the itinerary history', async () => {
    const paths: string[] = [];
    server.use(http.get('*/itineraries/:hash/history', ({ request }) => { paths.push(new URL(request.url).pathname); return HttpResponse.json(history); }));
    renderWithQuery(<HistoryView definition={definitionFixture()} itineraryHash="abc123" now={NOW} />);
    expect(await screen.findByText(/Itinerary abc123/)).toBeInTheDocument();
    await waitFor(() => expect(paths.at(-1)).toMatch(/\/itineraries\/abc123\/history$/));
  });

  it('links and location round-trip the itinerary hash', () => {
    expect(historyHref('abc 123')).toBe('?view=history&hash=abc%20123');
    window.history.pushState({}, '', '/?view=history&hash=abc123');
    expect(itineraryHashFromLocation()).toEqual({ itineraryHash: 'abc123' });
    window.history.pushState({}, '', '/?view=history');
    expect(itineraryHashFromLocation()).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/History`
Expected: FAIL with `Failed to resolve import "../../../src/views/History/HistoryView.js"`.

- [ ] **Step 3: Implement**

`apps/web/src/strings.ts`: append

```ts
/** History strings (spec §11 History; the route series label is the spec's §7 wording). WP10. */
export const historyStrings = {
  title: 'History',
  chartTitle: 'Price history',
  xAxis: 'fetched (Europe/London time)',
  yAxis: '£',
  routeLowestSeries: "Google's route-level lowest price, cabin unknown",
  offerSeries: (provider: string): string => `${provider} · itinerary offer`,
  calendarSeries: (provider: string): string => `${provider} · calendar price (constraints not checked)`,
  routePicker: 'Route',
  pairOption: (origin: string, destination: string): string => `${origin}→${destination}`,
  itineraryHeading: (hash: string): string => `Itinerary ${hash}`,
  backToRoute: 'Show route history',
  tableCaption: (series: string): string => `${series}: prices with provenance`,
  fetchedColumn: 'Fetched (Europe/London)',
  priceColumn: 'Price',
  provenanceColumn: 'Provenance',
  routeLowestProvenance: (provider: string, age: string): string => `${provider} · route-level series, cabin unknown · ${age}`,
  rowLink: 'price history',
  loading: 'Loading history…',
  empty: 'No price history yet for this selection. Each run adds a point.',
  error: (message: string): string => `Could not load history: ${message}`,
} as const;
```

`apps/web/src/views/History/lines.ts`:

```ts
import type { IsoDateTime, Provenance, ProviderId } from '@gmt/core';
import type { HistoryResponse } from '../../api/views.js';
import { instantMs } from '../../lib/time.js';
import { historyStrings, providerLabel } from '../../strings.js';

type Series = HistoryResponse['series'][number];
export interface HistoryPoint { t: number; pricePence: number | null; fetchedAt: IsoDateTime | null; provenance: Provenance | null }
export interface HistoryLine { key: string; providerId: ProviderId; kind: Series['kind']; name: string; points: HistoryPoint[] }

/** Series label by kind (spec §11 History; §7 route_price_history wording). */
export function seriesName(s: Pick<Series, 'providerId' | 'kind'>): string {
  switch (s.kind) {
    case 'route-lowest':
      return historyStrings.routeLowestSeries;
    case 'offer':
      return historyStrings.offerSeries(providerLabel(s.providerId));
    case 'calendar':
      return historyStrings.calendarSeries(providerLabel(s.providerId));
  }
}

/**
 * One line per provider and kind, x = fetchedAt (spec §11 History). A null point between two points further apart than
 * gapHours(provider) makes Recharts break the line (connectNulls false), so a missing fetch is never drawn as a flat price.
 */
export function buildHistoryLines(resp: HistoryResponse, gapHours: (providerId: ProviderId) => number): HistoryLine[] {
  return resp.series
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const sorted = [...s.points].sort((a, b) => instantMs(a.fetchedAt) - instantMs(b.fetchedAt));
      const limitMs = gapHours(s.providerId) * 3_600_000;
      const points: HistoryPoint[] = [];
      let prev: number | null = null;
      for (const p of sorted) {
        const t = instantMs(p.fetchedAt);
        if (prev !== null && t - prev > limitMs) points.push({ t: prev + (t - prev) / 2, pricePence: null, fetchedAt: null, provenance: null });
        points.push({ t, pricePence: p.pricePence, fetchedAt: p.fetchedAt, provenance: p.provenance });
        prev = t;
      }
      return { key: `${s.providerId}:${s.kind}`, providerId: s.providerId, kind: s.kind, name: seriesName(s), points };
    });
}
```

`apps/web/src/views/History/HistoryChart.tsx`:

```tsx
import { effectiveAge, formatAgeFull, type IsoDateTime } from '@gmt/core';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Provenance } from '../../components/Provenance.js';
import { formatPence } from '../../lib/money.js';
import { formatInstantLondon } from '../../lib/time.js';
import { calendarStrings, historyStrings, providerLabel } from '../../strings.js';
import type { HistoryLine, HistoryPoint } from './lines.js';

const COLOURS = ['#1d4ed8', '#c2410c', '#7c3aed', '#047857'] as const;
const colourAt = (i: number): string => COLOURS[i % COLOURS.length] ?? '#1d4ed8';
// why: line style backs up colour (no colour-only meaning): calendar dashed, route-level dotted, offers solid.
const DASH: Readonly<Record<HistoryLine['kind'], string | null>> = { offer: null, calendar: '5 3', 'route-lowest': '2 2' };

/** One line per provider and kind on a shared time axis, with gaps (spec §11 History). */
export function HistoryChart({ lines }: { lines: readonly HistoryLine[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 16, bottom: 28, left: 24 }} title={historyStrings.chartTitle}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => formatInstantLondon(v)} label={{ value: historyStrings.xAxis, position: 'insideBottom', offset: -16 }} />
          <YAxis tickFormatter={(v: number) => formatPence(v)} label={{ value: historyStrings.yAxis, angle: -90, position: 'insideLeft' }} />
          <Tooltip labelFormatter={(v) => (typeof v === 'number' ? formatInstantLondon(v) : String(v))} formatter={(v) => (typeof v === 'number' ? formatPence(v) : String(v))} />
          <Legend verticalAlign="top" />
          {lines.map((l, i) => {
            const dash = DASH[l.kind];
            return (
              <Line
                key={l.key}
                data={l.points}
                dataKey="pricePence"
                name={l.name}
                type="linear"
                connectNulls={false}
                stroke={colourAt(i)}
                {...(dash === null ? {} : { strokeDasharray: dash })}
                dot
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type Priced = HistoryPoint & { pricePence: number; fetchedAt: IsoDateTime };

/** Every point of one line with its provenance visible; a non-route price without provenance is withheld (spec §3). */
export function HistoryTable({ line, now }: { line: HistoryLine; now: IsoDateTime }) {
  const priced = line.points.filter((p): p is Priced => p.pricePence !== null && p.fetchedAt !== null);
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="text-left font-medium">{historyStrings.tableCaption(line.name)}</caption>
        <thead>
          <tr>
            <th scope="col">{historyStrings.fetchedColumn}</th>
            <th scope="col">{historyStrings.priceColumn}</th>
            <th scope="col">{historyStrings.provenanceColumn}</th>
          </tr>
        </thead>
        <tbody>
          {priced.map((p) => {
            const withheld = p.provenance === null && line.kind !== 'route-lowest';
            return (
              <tr key={p.t}>
                <td>{formatInstantLondon(p.t)}</td>
                <td>{withheld ? '—' : formatPence(p.pricePence)}</td>
                <td>
                  {withheld ? (
                    <span role="alert">{calendarStrings.panel.provenanceMissing}</span>
                  ) : p.provenance !== null ? (
                    <Provenance provenance={p.provenance} now={now} />
                  ) : (
                    historyStrings.routeLowestProvenance(providerLabel(line.providerId), formatAgeFull(effectiveAge({ fetchedAt: p.fetchedAt, maxAgeHours: 'unknown' }, now)))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

`apps/web/src/views/History/HistoryView.tsx`:

```tsx
import type { IsoDateTime } from '@gmt/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type DefinitionResponse, fetchItineraryHistory, fetchRouteHistory } from '../../api/views.js';
import { nowIso } from '../../lib/time.js';
import { historyStrings } from '../../strings.js';
import { HistoryChart, HistoryTable } from './HistoryChart.js';
import { buildHistoryLines } from './lines.js';

/** Link to one itinerary's history from a Results row (WP9's expanded row). */
export function historyHref(itineraryHash: string): string {
  return `?view=history&hash=${encodeURIComponent(itineraryHash)}`;
}

/** The `hash` query parameter as an optional prop, so the registry can open itinerary mode from a link. */
export function itineraryHashFromLocation(): { itineraryHash?: string } {
  const h = new URLSearchParams(window.location.search).get('hash');
  return h === null || h === '' ? {} : { itineraryHash: h };
}

/** History: route history by default, itinerary history when a hash is given (spec §11 History, §10). */
export function HistoryView({ definition, itineraryHash, now: nowProp }: { definition: DefinitionResponse; itineraryHash?: string; now?: IsoDateTime }) {
  const [now] = useState<IsoDateTime>(() => nowProp ?? nowIso());
  const pairs = useMemo(() => definition.origins.flatMap((origin) => definition.destinations.map((destination) => ({ origin, destination }))), [definition]);
  const [pairIndex, setPairIndex] = useState(0);
  const pair = pairs[pairIndex] ?? null;
  const q = useQuery({
    queryKey: itineraryHash !== undefined ? ['history', 'itinerary', itineraryHash] : ['history', 'route', pair?.origin ?? '', pair?.destination ?? ''],
    queryFn: () =>
      itineraryHash !== undefined ? fetchItineraryHistory(itineraryHash) : pair === null ? Promise.reject(new Error('no route')) : fetchRouteHistory(pair.origin, pair.destination),
    enabled: itineraryHash !== undefined || pair !== null,
  });
  // why: two refresh cycles without a point is a gap, not a steady price (spec §11 "gaps"); default refresh is 168 h (§7).
  const lines = useMemo(() => (q.data === undefined ? [] : buildHistoryLines(q.data, (id) => 2 * (definition.providers.discoveryRefreshHours[id] ?? 168))), [q.data, definition]);

  return (
    <section aria-label={historyStrings.title} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{historyStrings.title}</h2>
      {itineraryHash !== undefined ? (
        <p>
          {historyStrings.itineraryHeading(itineraryHash)} · <a href="?view=history" className="underline">{historyStrings.backToRoute}</a>
        </p>
      ) : (
        <label className="flex flex-col text-sm">
          {historyStrings.routePicker}
          <select value={String(pairIndex)} onChange={(e) => setPairIndex(Number(e.target.value))} className="rounded border px-2 py-1">
            {pairs.map((p, i) => (
              <option key={`${p.origin}-${p.destination}`} value={String(i)}>{historyStrings.pairOption(p.origin, p.destination)}</option>
            ))}
          </select>
        </label>
      )}
      {q.isPending ? (
        <p role="status">{historyStrings.loading}</p>
      ) : q.isError ? (
        <p role="alert">{historyStrings.error(q.error.message)}</p>
      ) : lines.length === 0 ? (
        <p>{historyStrings.empty}</p>
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

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/History`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: history view with one line per provider and kind, gaps and provenance tables"
```

### Task 10.11: Register the views, link Results to history, and scan the new strings

**Files:**
- Create: `apps/web/test/strings.wp10.test.ts`, `apps/web/test/views/registry.wp10.test.tsx`
- Modify: `apps/web/src/views/registry.tsx` (WP9), `apps/web/src/views/Results/ExpandedRow.tsx` (WP9)

**Interfaces:**
- Consumes: `VIEWS`, `ExpandedRow` (WP9), `findBannedWords`, `BANNED_WORDS`.
- Produces: `VIEWS` entries `calendar`, `duration` and `history`, and the "price history" link on expanded rows that have an itinerary hash.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/strings.wp10.test.ts`:

```ts
import { BANNED_WORDS, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { calendarStrings, durationStrings, historyStrings } from '../src/strings.js';

// Every function-valued string gets explicit sample arguments, so a new function cannot slip past the scan.
const SAMPLES: Record<string, unknown[][]> = {
  'calendar.discoveryMarker': [[{ priced: 1, empty: 2, no_data: 3, error: 4, skipped: 5, not_run: 6 }, 21]],
  'calendar.verificationMarker': [[1, 10, 2]],
  'calendar.reusedNote': [[3]],
  'calendar.partlyVerified': [[2]],
  'calendar.legendScale': [['verified', 5], ['calendar', 1]],
  'calendar.legendBand': [[0, '£400', '£450', 2], [4, '£800', '£800', 1]],
  'calendar.legendHatched': [['verified', 5], ['calendar', 1]],
  'calendar.bandAria': [[0], [3]],
  'calendar.error': [['boom']],
  'calendar.panel.title': [['Sun 14 Mar 2027']],
  'calendar.panel.cellOption': [['LHR', 'JFK', 14, 'Sun 28 Mar']],
  'calendar.panel.observation': [['Example Air', 'verified'], ['Example Air', 'partially-verified'], ['Example Air', 'failed']],
  'calendar.panel.verifyFailed': [['boom']],
  'calendar.panel.error': [['boom']],
  'calendar.panel.reusedFrom': [['exec-0']],
  'duration.verifiedSeries': [[3]],
  'duration.calendarSeries': [['Aviasales cache', 9]],
  'duration.calendarShort': [['Aviasales cache']],
  'duration.nightsLabel': [[14]],
  'duration.tooltipValue': [['£412', 5]],
  'duration.error': [['boom']],
  'history.offerSeries': [['Google Flights via SearchApi']],
  'history.calendarSeries': [['Aviasales cache']],
  'history.pairOption': [['LHR', 'JFK']],
  'history.itineraryHeading': [['abc123']],
  'history.tableCaption': [['Aviasales cache · calendar price (constraints not checked)']],
  'history.routeLowestProvenance': [['Google Flights via SearchApi', 'fetched 2h ago · provider age unknown']],
  'history.error': [['boom']],
};

function collect(prefix: string, obj: object, out: Array<{ key: string; text: string }>): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}.${k}`;
    if (typeof v === 'string') out.push({ key, text: v });
    else if (typeof v === 'function') {
      const samples = SAMPLES[key];
      if (samples === undefined) throw new Error(`no sample arguments for ${key}`);
      for (const args of samples) out.push({ key, text: String((v as (...a: unknown[]) => unknown)(...args)) });
    } else if (v !== null && typeof v === 'object') collect(key, v, out);
  }
}
const ALL: Array<{ key: string; text: string }> = [];
collect('calendar', calendarStrings, ALL);
collect('duration', durationStrings, ALL);
collect('history', historyStrings, ALL);

// Keys whose text sits beside class-verified values or names the classes themselves (spec §3, §11).
const VERIFIED_ALLOWED = new Set([
  'calendar.basisName.verified', 'calendar.colourByOption.verified', 'calendar.legendScale', 'calendar.legendHatched',
  'calendar.partlyVerified', 'calendar.panel.observation', 'duration.verifiedSeries', 'duration.verifiedShort',
]);

describe('WP10 strings (spec §11 banned words; §3 reserved "verified")', () => {
  it('scans every string, functions included', () => {
    expect(ALL.length).toBeGreaterThan(60);
    expect(Object.keys(SAMPLES).every((k) => ALL.some((x) => x.key === k))).toBe(true);
  });
  it('contains no banned word (word boundaries, core list)', () => {
    expect(BANNED_WORDS).toEqual(['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time']);
    expect(ALL.flatMap(({ key, text }) => findBannedWords(text).map((h) => `${key}: ${h.word}`))).toEqual([]);
  });
  it('uses "verified" only beside class-verified values', () => {
    const offenders = ALL.filter(({ text }) => /\bverified\b/i.test(text)).map((x) => x.key);
    expect([...new Set(offenders)].filter((k) => !VERIFIED_ALLOWED.has(k))).toEqual([]);
  });
  it('stage counts say itinerary-searched', () => {
    expect(calendarStrings.verificationMarker(1, 10, 0)).toMatch(/^itinerary-searched /);
  });
});
```

`apps/web/test/views/registry.wp10.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { VIEWS } from '../../src/views/registry.js';
import { ExpandedRow } from '../../src/views/Results/ExpandedRow.js';
import { definitionFixture, NOW, resultRowFixture } from '../support/fixtures.js';
import { renderWithQuery } from '../support/render.js';
import { server, useMswServer } from '../support/server.js';

useMswServer();

describe('WP10 views in the shell', () => {
  it('registers Calendar and Duration between Results and Coverage, and History after Coverage', () => {
    const ids = VIEWS.map((v) => v.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at('results')).toBeLessThan(at('calendar'));
    expect(at('calendar')).toBeLessThan(at('duration'));
    expect(at('duration')).toBeLessThan(at('coverage'));
    expect(at('coverage')).toBeLessThan(at('history'));
    expect(VIEWS.filter((v) => ['calendar', 'duration', 'history'].includes(v.id)).map((v) => v.label)).toEqual(['Calendar', 'Duration', 'History']);
  });

  it.each([
    ['calendar', 'Loading calendar…'],
    ['duration', 'Loading duration analysis…'],
    ['history', 'Loading history…'],
  ])('the %s entry renders its view', (id, loading) => {
    server.use(http.get('*', async () => { await delay('infinite'); return HttpResponse.json({}); }));
    const view = VIEWS.find((v) => v.id === id);
    if (view === undefined) throw new Error(`no view ${id}`);
    renderWithQuery(<>{view.render({ definition: definitionFixture() })}</>);
    expect(screen.getByRole('status')).toHaveTextContent(loading);
  });

  it('a Results expanded row links to that itinerary history; a calendar row without a hash does not', () => {
    const { unmount } = render(<ExpandedRow row={resultRowFixture({ itineraryHash: 'abc123', basis: 'verified', verdictClass: 'verified' }) as never} now={NOW} />);
    expect(screen.getByRole('link', { name: 'price history' })).toHaveAttribute('href', '?view=history&hash=abc123');
    unmount();
    render(<ExpandedRow row={resultRowFixture({ itineraryHash: null }) as never} now={NOW} />);
    expect(screen.queryByRole('link', { name: 'price history' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/strings.wp10.test.ts test/views/registry.wp10.test.tsx`
Expected: the strings test PASSES (the strings exist since Tasks 10.1, 10.9 and 10.10; it is a guard). The registry test FAILS: `expected -1 to be less than …` (no `calendar` entry), and `Unable to find an accessible element with the role "link" and name "price history"`.

- [ ] **Step 3: Implement**

`apps/web/src/views/registry.tsx` (WP9): add the imports, insert the `calendar` and `duration` entries after WP9's `results` entry and the `history` entry after `coverage`:

```tsx
import { calendarStrings, durationStrings, historyStrings } from '../strings.js';
import { CalendarView } from './Calendar/CalendarView.js';
import { DurationView } from './Duration/DurationView.js';
import { HistoryView, itineraryHashFromLocation } from './History/HistoryView.js';

// after the 'results' entry:
  { id: 'calendar', label: calendarStrings.title, render: ({ definition }) => <CalendarView definition={definition} /> },
  { id: 'duration', label: durationStrings.title, render: ({ definition }) => <DurationView definition={definition} /> },
// after the 'coverage' entry:
  { id: 'history', label: historyStrings.title, render: ({ definition }) => <HistoryView definition={definition} {...itineraryHashFromLocation()} /> },
```

`apps/web/src/views/Results/ExpandedRow.tsx` (WP9): add the imports and, after the search link, the history link:

```tsx
import { historyStrings } from '../../strings.js';
import { historyHref } from '../History/HistoryView.js';

// inside the expanded row, after the search link:
{row.itineraryHash !== null && (
  <a href={historyHref(row.itineraryHash)} className="underline">
    {historyStrings.rowLink}
  </a>
)}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/strings.wp10.test.ts test/views/registry.wp10.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: register calendar, duration and history views; results link to history; string scan"
```

### Task 10.12: Playwright smoke in fixture mode (spec §9 item 6)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/prepare-db.mjs`
- Modify: `apps/web/vite.config.ts` (WP9: the proxy target), root `.gitignore`

**Interfaces:**
- Consumes: `pnpm --filter @gmt/api start` (WP8); fixture mode per spec §5.5; WP9's `strings` keys and DOM hooks (§4).
- Produces: `pnpm --filter @gmt/web e2e`, which is excluded from `pnpm test` (vitest `exclude: ['e2e/**']`, and the root `pnpm test` runs vitest only).

The smoke drives the real api in fixture mode and the built SPA through `vite preview`. Its proxy forwards api calls, and the preview reuses WP9's `server.proxy` (Vite's `preview.proxy` defaults to `server.proxy`). The api environment satisfies `syntheticAllowed` (spec §5.5): `NODE_ENV=development`, `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake`, a `.fixture.db` path, and no `IN_CONTAINER`. It binds loopback, so no auth is needed (spec §4). It disables auto-resume and sets the confirmation threshold high, so the run starts without a cost prompt.

- [ ] **Step 1: Write the failing test**

`apps/web/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { strings } from '../src/strings.js';

// Spec §9 item 6: one Playwright smoke in fixture mode. Every price here is synthetic, and the red banner must say so.
test('fixture mode: import example, run, and the Results header shows a price with provenance under the synthetic banner', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: strings.nav.definitions }).click();
  await page.getByRole('button', { name: strings.definitions.importExample }).click();

  // why: the example JSON names the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const groupName of [strings.definitions.discoveryProviders, strings.definitions.verificationProviders]) {
    const group = page.getByRole('group', { name: groupName });
    for (const box of await group.getByRole('checkbox').all()) await box.uncheck();
    await group.getByRole('checkbox', { name: /fixture/i }).check();
  }
  await page.getByRole('button', { name: strings.definitions.create }).click();
  await page.getByRole('button', { name: strings.definitions.runNow }).click();

  const headline = page.getByTestId('results-headline');
  await expect(async () => {
    await page.getByRole('link', { name: strings.nav.results }).click();
    await expect(headline).toContainText(/cheapest found £\d/, { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(headline.getByTestId('provenance')).toBeVisible();

  const banner = page.getByRole('alert').filter({ hasText: strings.syntheticBanner });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/bg-red-700/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web e2e`
Expected: FAIL with `Missing script: "e2e"` if Task 10.8's scripts are absent. Otherwise Playwright fails with `Error: No tests found` or a config load error, because `playwright.config.ts` does not exist yet.

- [ ] **Step 3: Implement**

`apps/web/e2e/prepare-db.mjs`:

```js
#!/usr/bin/env node
// Prepares a fresh database for the fixture-mode smoke. Spec §5.5: fixture mode requires a path ending in .fixture.db,
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
      url: `${API_ORIGIN}/health`,
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
        ALLOWED_HOSTS: `127.0.0.1:${API_PORT},127.0.0.1:${WEB_PORT}`,
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

`apps/web/vite.config.ts` (WP9): change only the proxy target, so dev keeps its default and the smoke points the preview at its own api:

```ts
// why: the Playwright smoke runs its own fixture-mode api on another port; dev keeps the default. preview.proxy inherits server.proxy.
const apiOrigin = process.env.GMT_API_ORIGIN ?? 'http://127.0.0.1:3000';
// in defineConfig({ server: { proxy: { … } } }): every proxy entry's `target` becomes `apiOrigin`
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
Expected: the workspace builds, both web servers start, and the reporter prints `1 passed`.

Run: `pnpm test`
Expected: the root vitest run lists no file under `apps/web/e2e/`.

- [ ] **Step 5: Commit**

```bash
git add apps/web .gitignore && git commit -m "wp10: Playwright smoke in fixture mode (spec §9 item 6)"
```

## 9. Pinned review-focus tests

- **Review focus 3** (plan: "The browser runs outside Europe/London … a day never shifts by one. Owner: WP10"):
  - Task 10.8, `apps/web/test/tz/dates.tz.test.tsx`, runs under `America/Los_Angeles` and `Asia/Tokyo` in two ways: in-process per `describe.each` block, and as whole processes via `pnpm --filter @gmt/web run test:tz` (`GMT_TEST_TZ` → `process.env.TZ` in `test/setup-tz.ts` before any Date is built). It asserts the zone took effect and that a naive `Date` would shift the day (the control). It also checks that the US and UK DST-change days and the leap day keep their date and weekday, that the calendar grid puts each day under its own weekday and month, and that the Results date columns render departure and return from their strings.
  - Task 10.2, `apps/web/test/lib/noDateParsing.test.ts`, fails on any `new Date(`, `Date.parse(`, local date getter or `toLocale*String(` in `apps/web/src` outside `src/lib/time.ts`, whose helpers refuse a date-only string. The scanner's own positive cases keep the test from being vacuous.

## 10. Definition of done

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/web test` | Every web test passes. Coverage meets lines ≥ 70%, branches ≥ 60%, functions ≥ 70%, statements ≥ 70%, with no threshold error. Then `test:tz` prints two passing runs (Los Angeles, Tokyo). |
| `pnpm test` | The root run passes, and no `e2e/` file is listed. |
| `pnpm --filter @gmt/web exec vitest run test/lib/noDateParsing.test.ts` | PASS: no Date construction outside `src/lib/time.ts`. |
| `pnpm --filter @gmt/web exec vitest run test/strings.wp10.test.ts` | PASS: no banned word, and "verified" only on allowed keys. |
| `pnpm --filter @gmt/web e2e` | `1 passed`. |
| `pnpm lint` | Biome reports no errors. |
| `pnpm -r typecheck` | Clean, including the `z.infer` types over the WP0 response schemas. |
| `node scripts/check-boundaries.mjs` | Exit 0: `@gmt/web` imports only `@gmt/core` among workspace packages. |
| `grep -rn "process.env" apps/web/src` | No output. `process.env` appears only in `test/setup-tz.ts`, `playwright.config.ts`, `vite.config.ts` and `e2e/prepare-db.mjs`, which are test and build tooling. |
| `grep -rnE "'(LHR\|LGW\|JFK\|EWR\|LON\|NYC)'" apps/web/src` | No output. No airport, city or metro literal appears in source; the worked-example codes appear only in tests. |

## 11. Open questions

1. **`requires_human_judgment`: x axis of the route-level series.** Spec §11 says History plots x = `fetchedAt` for every series. Spec §7's `route_price_history` stores 60 **daily** points per verification, each with a `date`, and all of them share one `fetched_at`. Plotted literally, the route series collapses into a vertical stack at one instant. This brief implements the spec as written (x = `fetchedAt`). The proposed alternative: plot that series by its `date` on the same time axis, keep `fetchedAt` in its table, and add the x-axis note "route series: date of the lowest price". The operator decides. If the alternative is chosen, it touches `lines.ts` (one branch on `kind === 'route-lowest'`) and needs `date` added to `historyResponseSchema` points.

The brief does not paper over these findings against the plan; they are not design questions. Fable resolves them in the plan's contract before dispatch:

- `calendarResponseSchema`, `durationAnalysisResponseSchema`, `cellDetailResponseSchema` and `historyResponseSchema` have no field lists in the plan. §4 lists the fields WP10 reads, derived from spec §10.
- The calendar day needs `date` (the spec does not say which date keys a day; this brief assumes the departure date), and each day price needs its `cell`. Without the cell, a day cannot show the destination airport (spec §11 provenance list) and the side panel cannot open the priced cell.
- The calendar and duration responses need `executions` for the view header (spec §11: "Every view header: execution(s) shown, status, age …").
- `duration-analysis` gives per-nights `n` but no coverage, so View C cannot tell "not searched" from "searched, no fares". The view says "no price" with a pointer to Coverage instead of claiming either.
- History points of `kind: 'route-lowest'` cannot carry `Provenance`, because `Provenance.cabin` is a `Cabin` and that series' cabin is unknown (spec §7). The api contract says every price-bearing shape carries provenance. This brief allows `provenance: null` for that kind only and renders provider, source and fetched age in its place. Any other kind without provenance is withheld.
- Plan Task 0.1 lists `msw` only for `@gmt/providers`, but spec §9 item 6 web tests need it. This brief adds `msw@3.0.3` to `@gmt/web`, plus `zod@4.6.7` for `z.infer`.
- Spec §4's tech line says "React 18"; the plan pins React 19.3.1. This brief follows the plan's pinned version; the spec line needs correcting.
