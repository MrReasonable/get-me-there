---
wp: 9
title: "web: shell, status bar, Definitions, Results (View A), Coverage (View D), Providers"
owner: sonnet
depends_on: [8]
spec_sections: ["§11", "§6.5", "§6.9", "§3", "§5.5", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, ui-reviewer, persona-flexible-traveller, provenance-auditor, product-owner, security-reviewer]
status: draft
---

# WP9 — web: shell, status bar, Definitions, Results, Coverage, Providers

## 1. Goal

Ship the Vite + React 19 single-page app under `apps/web` with the shell, the status bar, the Definitions form, View A (Results), View D (Coverage) and the Providers view, every price rendered through one provenance-checking component so that a price without provenance cannot reach the screen.

## 2. Scope

**In**

- `apps/web` build and test setup: Vite 8, React 19, Tailwind 4 (CSS-first), Vitest 5 in jsdom, Testing Library, `msw` 3 for the API.
- Shell: `main.tsx`, `App.tsx`, navigation for every view (Results, Calendar, Duration, History, Coverage, Definitions, Alerts, Providers), definition selector, status bar, red synthetic banner, empty state for no providers.
- Routing and persisted view state in **URL search params** on the single path `/` (the API is under `/api`) (`?view=results&def=<id>&basis=calendar&sort=price.asc&f.stops=1`). Filter and sort state survives every view switch because nav links carry every parameter except `view`.
- `api/client.ts`: the one `fetch` in the app, derived from `core/api-contract` `ROUTES`, `X-Requested-With: get-me-there` and `Content-Type: application/json` on every mutation, responses parsed with the route's contract schema in development and test.
- Components: `Provenance`, `PriceCell`, `PriceBoundary`, `StatusBar`, `ViewHeader`, `ClassBadge`, `VerdictList`, `BookingAction`, `SearchLink`, `SyntheticBanner`, `Nav`, `DefinitionSelector`.
- `copy.ts`: the string catalogue every component imports; the banned-word test walks it, a source guard rejects literal copy in `.tsx`, and a rendered-DOM sweep checks the views.
- View A Results (spec §11, §6.5, §6.9), View D Coverage, Providers view, Definitions form (spec §11).
- Tests per spec §9 item 6 for these views.

**Out**

- View B Calendar, View C Duration, History, the Playwright fixture-mode smoke, and the browser-timezone test of review focus 3: **WP10**. WP9 ships routes for Calendar, Duration and History that render "This view is coming in WP10."; WP10 replaces all three.
- Alerts view and alert rule forms: **WP11** (WP9 ships its nav entry with a "coming in WP11" placeholder, allowed by the reconciliation).
- Every API route, its validation and its strings (`basisReason`, error messages, the zero-cap message): **WP8**. The web only renders them.
- `sortRows`, `filterRows`, `bandCheapest` (WP2) and `cellKeyString` (WP0) in `@gmt/core`. The web calls them, never reimplements them.
- `docs/examples/london-new-york.json`, `docs/setup.md` and the test that `EXAMPLE_DEFINITION` equals the JSON: **WP12**. WP9 writes a stand-in copy of the JSON only if the file is absent when it runs (WP12 depends on WP9), with WP12's exact content.
- Serving the built `dist/` at `/` (every API route is under `/api`): **WP8**.

## 3. Spec sections

- **§11 banned words** — "exhaustive", "all combinations", "every combination", "live", "bookable", "guaranteed", "real-time" never appear in user-facing text; "verified" only beside class-`verified` values; stage counts say "itinerary-searched".
- **§11 layout** — nav for all views owned by WP9; definition selector; status bar on every view; per-view header (executions shown, status, age, stale label, banner when not completed); the two-line Results header; empty state for no providers; red synthetic banner.
- **§11 status bar** — stage, progress, spend used / cap for execution and month, paused state with reason and Resume, "schedule blocked since <date>", Cancel.
- **§11 provenance on every price** — visible without hover: provider badge, source in words, compact age ("2h ago · ≤7d") with the full form on hover and in headers, "≈" when FX-converted, dashed outline + "constraints not checked" for calendar prices, destination airport, the operator's per-destination note.
- **§11 Definitions form** — operator-entered origins and destinations with airport autocomplete; coverage check showing cached rows per pair before saving; per-destination note and onward cost; defaults (relative window offset 7, length 182; 10–21 nights; economy; `maxJourneyMinutes` 1500; arrival 06:00–23:00; plan preset for providers and policy; execution budget from config; schedule `0 5 * * 1`); estimate shown, the create click is the explicit confirmation setting `confirmed_cost_pence = ceil(estimateMicroGbp / 10 000)`; advanced fold; "import example".
- **§11 View A** — columns in order; 375px behaviour; expanded row; client-side sort and filter; "within the cheapest 1000 of N"; persisted filter and sort; `bandCheapest`; calendar rows' "not applied: …" note; calendar-gap banner only with a verification provider.
- **§11 View D** — counts per stage × provider with the six buckets and "searched" beside; selected but not reached with reason; overrun and parity flags; error list with retry.
- **§11 Providers** — capabilities, plan, usage vs caps with window bounds, the zero-cap message.
- **§11 accessibility** — 375px layout; keyboard-operable table; visible focus; labelled controls; no colour-only meaning.
- **§6.5** — all sorting and filtering client-side with the shared core functions, composing without refetch. Stale rows keep their place in the server's ranking and are labelled, never demoted; the `hideStale` filter is the operator's opt-in.
- **§6.9** — basis switch with the reason; the search link labelled "search link, not a fare link" on every row whose booking is `none` (shown in every expanded row).
- **§3** — the two label formats from `core` (`formatAgeFull`, `formatAgeCompact`); six coverage buckets; "itinerary-searched".
- **§5.5** — the synthetic banner is data-driven; a negative test asserts its absence for real data.
- **§9 item 6** — price lacking provenance fails to render; synthetic banner present and absent; distinct text and ARIA for pass/fail/unverified; keyboard operation; 375px assertion that price, provenance and the class badge stay visible; banned-word test with word boundaries and an allowlist; booking links with `rel="noopener noreferrer"`, host shown, POST bookings as forms, no auto-navigation; View D sums.

## 4. Interfaces consumed

From `@gmt/core` (plan "Cross-package contracts", rewritten 2026-10-14; copied exactly):

```ts
// types/ids.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export function asIata(s: string): Iata;           // throws on mismatch; tests and seeds only
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;

// types/provenance.ts (WP0)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';   // defined here; ports/provider.ts re-exports it
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}
export const providerIdSchema, sourceKindSchema, cabinSchema, pointOfSaleSchema, fxInfoSchema, provenanceSchema;

// types/definition.ts (WP0)
export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}`
export type LocalTimeWindow = { from: string; to: string };   // HH:mm, inclusive, local to the airport
export interface Constraints {
  maxStops?: number; maxJourneyMinutes?: number; minLayoverMinutes?: number; maxLayoverMinutes?: number;
  noOvernightLayover?: boolean; departureWindowLocal?: LocalTimeWindow; arrivalWindowLocal?: LocalTimeWindow;
  noSelfTransfer?: boolean; noAirportChange?: boolean; includeAirlines?: string[]; excludeAirlines?: string[];
  cabinBagRequired?: boolean; checkedBagRequired?: boolean; minCheckedBags?: number; maxPricePence?: number;
}
export interface VerificationPolicy { maxCells: number; topN: number; priceCeilingPence?: number; perDepartureDateBest?: number; alwaysInclude: CellKey[]; expandTop: number; bookingLinks: boolean; maxStops?: number }
export interface ExecutionBudget { maxCalls: number; maxFreeCalls: number; maxCostMicroGbp: number }
export interface ProvidersConfig { discovery: ProviderId[]; verification: ProviderId[]; discoveryRefreshHours: Partial<Record<ProviderId, number>> }
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'confirmedCostPence' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

// types/execution.ts (WP0)
export type ExecutionStatus = 'pending' | 'running' | 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled' | 'completed'
  | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed';
export const ACTIVE_STATUSES: readonly ExecutionStatus[] = ['pending', 'running', 'paused_budget', 'paused_error', 'interrupted'];
export type Stage = 'discovery' | 'verification';
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }

// types/itinerary.ts (WP0)
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }
export interface FareConditions { refundable?: boolean; changeable?: boolean; notes?: string[] }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Segment { marketingCarrier: string; operatingCarrier?: string; flightNumber: number; from: Iata; to: Iata; departLocal: string; arriveLocal: string; departUtc?: IsoDateTime; arriveUtc?: IsoDateTime; durationMinutes?: number; aircraft?: string }
export interface Layover { at: Iata; minutes: number; overnight: boolean; airportChange: boolean }
export type Verdict = 'pass' | 'fail' | 'unverified';
export type ConstraintName = keyof Constraints | 'cabin';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
export type ResultBasis = 'verified' | 'calendar';   // API values; the UI labels them "itinerary-search basis" and "calendar basis"

// ports/provider.ts (spec §5.1)
export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }

// labels/age.ts (WP0; a bounded age with maxAgeHours 0 formats as "fetched 5h ago" / "5h ago")
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;
export function formatAgeCompact(a: EffectiveAge): string;
export function formatDuration(hours: number): string;

// text/money.ts and constraints/labels.ts (WP2)
export function formatPence(pence: number): string;   // en-GB grouping, throws on non-integer or negative; the single money formatter
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // plain-English labels

// text/bannedWords.ts (WP0)
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];
export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// Core domain functions (WP2)
export type ResultRow = z.infer<typeof resultRowSchema>; export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted'; export interface ResultFilters { verdictClass?: Array<VerdictClass | 'unchecked'>; unverified?: ConstraintName[]; providerId?: ProviderId[]; maxStops?: number; carriers?: string[]; destination?: Iata[]; maxPricePence?: number; nights?: { min: number; max: number }; hideStale?: boolean }
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;   // itineraryHash, or `calendar:${calendarPriceId}`; the web's `?row=` parameter and email links use it
export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[]; export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[]; export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string /* resultRowKey */>;
```

From the plan's "API contract" (`apiContract`, every path under `/api`), the shapes the views read, copied exactly:

- `common.ts`: `errorEnvelopeSchema` `{ error: { code: string; message: string; details?: { fields?: Array<{ field: string; message: string }> } & Record<string, unknown> } }`; `priceCellSchema` `{ pricePence, provenance, stale, ageHours }`; `coverageSummarySchema` `{ buckets, total, selected, itinerarySearched, onDemand, reused }`; `executionSummarySchema` `{ id, status, isChild, startedAt, finishedAt, ageHours }` (lists are newest first); `usageSchema` `{ scope: string; calls; costMicroGbp; costPence; cap; windowStart; windowEnd }`.
- `airports.ts`: `GET /api/airports?q=` → `airportsResponseSchema` `Array<{ iata, name, city, country, tz, metro: string | null }>`.
- `definitions.ts`: `definitionCreateRequestSchema` (DefinitionInput plus `confirmedCostPence?: number`, the explicit confirmation from the create click); `definitionUpdateRequestSchema` (partial); `definitionResponseSchema` `SearchDefinition & { budgetFit: BudgetFit; estimate: Estimate | null; needsConfirmation: { estimateMicroGbp: number; confirmedCostPence: number | null } | null; notices: string[] }`; `budgetFitSchema` `{ fits, runsPerMonth, perScope: Array<{ scope, estimated, cap, fits }> }`; `estimateSchema` `{ cells; perProvider: Array<{ providerId; stage; calls; planCalls; costMicroGbp; costPence; seconds; blocked: string | null }>; totalCalls; totalPlanCalls; totalCostMicroGbp; totalCostPence; seconds; assumptions; windowClamped; retryFactor }`; `POST /api/definitions/estimate` (unsaved body) and `POST /api/definitions/:id/estimate` → `estimateResponseSchema` `{ estimate: Estimate; budgetFit: BudgetFit }`; `coverageCheckRequestSchema` `{ origins, destinations, window, minNights, maxNights }`; `coverageCheckResponseSchema` `{ pairs: Array<{ origin, destination, months: Array<{ month; cachedRows; cellsInBand }> }>; calls; notes }`.
- `executions.ts`: `executionResponseSchema` `{ id, definitionId, isChild, cell, status, stage, reason, resumeAfter, trigger, startedAt, finishedAt, errorText, progress: Array<{ stage, providerId, buckets, total }>, budget: Usage[], estimate, ledger: { calls, costMicroGbp, costPence, tiles, cacheHits, perProvider }, parityBreak, overrun, disabledProviders }`; `startExecutionRequestSchema` `{ confirmCostPence?: number }`; `startExecutionResponseSchema` `{ executionId }`; `verifyCellRequestSchema` `{ definitionId, cell: CellKey }` → `startExecutionResponseSchema`.
- `results.ts`: `resultRowSchema` (fields as in the plan, including `layovers`, `seller`, `baggage`, `fareConditions`, `selfTransfer`, `searchLink: { url; host; label } | null` (null for synthetic rows), `otherOffers[]` with `stale`, `ageHours`, `verdictClass` and `unverified`, `executionId`, `calendarPriceId`, `observationId`); `resultsResponseSchema` `{ rows; total; truncated; basis; basisReason; executions: ExecutionSummary[]; coverage: CoverageSummary; excludedByCurrentSpace; verificationProviderConfigured: boolean; cheapest: ResultRow | null }`; `coverageResponseSchema` `{ executionId; summary; perStage: Array<{ stage; providerId; buckets; total; requests: { calls; cacheHits; costMicroGbp; planCalls: number | null }; overrun; parityBreak }>; selectedNotReached: Array<{ cell: Cell; reason: 'not_run' | 'skipped:budget' }>; errors: Array<{ cell; stage; providerId; reason; lastError; attempts; retryable }>; scheduleBlockedSince: IsoDateTime | null }`; `calendarGapResponseSchema` `{ cheapestVerified: (PriceCell & { cell: Cell; itineraryHash: string }) | null; cells: Array<{ cell: Cell; calendar: PriceCell; verifyAvailable: boolean }> }`.
- `system.ts`: `providersResponseSchema` `{ providers: Array<{ providerId; displayName; enabled; capabilities: { discovery: CapabilityInfo | null; verification: CapabilityInfo | null }; plan: PlanId | 'free' | 'synthetic'; usage: Usage[]; excludedFromSchedule: boolean; notices: string[] }>; synthetic: boolean; presets: { policy: Pick<VerificationPolicy, 'maxCells' | 'topN' | 'expandTop' | 'bookingLinks'>; providers: ProvidersConfig; budget: ExecutionBudget; discoveryRefreshHours: number; schedulerTimezone: string }; pointOfSale: string }`.

Usage scope labels are WP8's `scopeLabel`: `execution-calls`, `execution-free-calls`, `execution-cost`, `global-month`, `provider-month:<id>`, `provider-lifetime:<id>`.

From the plan's "Web" section: `src/copy.ts` is the catalogue; `docs/examples/london-new-york.json` is re-exported by `apps/web/src/example.ts` as `EXAMPLE_DEFINITION`; the boundary script allowlists that file.

## 5. Interfaces produced

Later packages (WP10, WP11, WP12) rely on these names.

```ts
// apps/web/src/copy.ts
export const COPY: { /* the full catalogue, Task 9.1 */ };
// apps/web/src/example.ts
export const EXAMPLE_DEFINITION: DefinitionRequest;   // definitionCreateRequestSchema.parse(docs/examples/london-new-york.json)
// apps/web/src/api/client.ts
export class ApiError extends Error { readonly status: number; readonly code: string; readonly details: unknown; fieldErrors(): Array<{ field: string; message: string }> }
export function findRoute(method: Method, path: string): RouteDef;
export async function call<T>(method: Method, path: string, opts?: CallOptions): Promise<T>;
// apps/web/src/api/endpoints.ts
export const api: { providers, definitions, estimateDraft, createDefinition, updateDefinition, coverageCheck, startExecution,
  execution, cancel, resume, verifyCell, results, coverage, calendarGap, airports };
// apps/web/src/api/queries.ts
export const qk: { providers; definitions; results(id, basis); execution(id); coverage(id); calendarGap(id); airports(q) };
export function useProviders(); useDefinitions(); useResults(defId, basis); useExecution(id); useCoverage(defId);
export function useCalendarGap(defId, enabled); useAirportSearch(q); useExecutionActions();
// apps/web/src/components/*
export function Provenance(props: ProvenanceProps): JSX.Element;      // throws MissingProvenanceError without valid provenance
export function PriceCell(props: PriceCellProps): JSX.Element;        // the only way a price reaches the DOM
export class PriceBoundary;                                           // renders COPY.priceWithheld instead of a broken price
export function assertProvenance(p: unknown): Provenance;
export function ViewHeader(props): JSX.Element;
export function ClassBadge, VerdictList, BookingAction, SearchLink, SyntheticBanner;
// apps/web/src/state/urlState.ts
export function useSearchParams(): URLSearchParams; export function updateSearchParams(patch, mode?): void;
export function hrefWith(patch): string; export function navigateTo(patch): (e: MouseEvent) => void;
// apps/web/src/state/view.ts
export type ViewId = 'results' | 'calendar' | 'duration' | 'history' | 'coverage' | 'definitions' | 'alerts' | 'providers';
// apps/web/src/state/resultsState.ts
export type SortDir; export interface ResultsUiState; parseResultsState; resultsStatePatch; parseBasis; setFilter;
// apps/web/src/now.tsx, src/hooks/useMediaQuery.ts, src/format.ts
export const NowContext; useNow(); useMediaQuery(q); NARROW_QUERY; formatPence; formatMicroGbp; formatIsoDate; formatLocalDateTime; formatMinutes; formatSeconds; parsePoundsToPence; penceToPoundsInput;
// apps/web/test/*
export function renderWithProviders(ui, opts?); export const NOW; export const server; fixture builders; setViewportWidth(px)
```

## 6. Library notes

Versions from the plan's Task 0.1 list. Verified on 2026-10-14 with context7 against the sources named.

- **react 19.3.1, react-dom 19.3.1.** `createRoot(el).render(<StrictMode>…)`; error boundaries are still class components with `static getDerivedStateFromError` and `componentDidCatch(error, info)` (react.dev `reference/react/Component`; in development a caught error still reaches `window.onerror`, so boundary tests prevent the default on `window` `error` events and mute `console.error`). `useSyncExternalStore(subscribe, getSnapshot)` for the URL and `matchMedia` stores (react.dev `reference/react/useSyncExternalStore`).
- **vite 8.3.4 + @vitejs/plugin-react 6.1.2.** `defineConfig({ plugins: [react(), tailwindcss()], server: { proxy: { '/api': { target } } } })`; `server.proxy` keys are path prefixes mapped to `{ target }` (vite.dev `config/server-options`, "server.proxy"). Vite imports JSON (`import x from '…json' with { type: 'json' }`, with `resolveJsonModule` in tsconfig) and allows files inside the pnpm workspace root, so `src/example.ts` can import `docs/examples/london-new-york.json`. No `changeOrigin`: the api sees `Host: localhost:5173`, which spec §4 adds to `ALLOWED_HOSTS` under `NODE_ENV=development`. Vite resolves a `.js` import from a `.ts` file to the `.ts` source, so the `@gmt/core` alias to `packages/core/src/index.ts` works without building core.
- **tailwindcss 4.3.3 + @tailwindcss/vite 4.3.3.** CSS-first: `@import "tailwindcss";` in `src/styles.css` and the `tailwindcss()` Vite plugin; no `tailwind.config.js`, no PostCSS config (tailwindcss.com blog "Tailwind CSS v4.0", "Configure the Vite plugin"). No inline `style` props anywhere: spec §4's CSP `default-src 'self'` blocks inline styles.
- **@tanstack/react-query 5.104.2.** `useQuery({ queryKey, queryFn, enabled, refetchInterval: (query) => … })` (v5 passes only `query` to the callback), `useMutation({ mutationFn, onSuccess })`, `queryClient.invalidateQueries({ queryKey: [prefix] })` (tanstack.com/query `guides/polling`, `quick-start`, `migrating-to-v5`). Query functions do not forward TanStack's `AbortSignal` to `fetch` (`// why:` in the client: under jsdom the signal is jsdom's `AbortSignal`, which Node's `fetch` rejects; the single-operator app does not need query cancellation).
- **@tanstack/react-table 9.3.1** (v9 API, changed from v8; github.com/TanStack/table `docs/framework/react/guide/migrating.md`, `packages/react-table/skills/getting-started`, `docs/reference/index/interfaces/Row_RowExpanding.md`). Used: `tableFeatures({ rowExpandingFeature })`; `createColumnHelper<typeof features, ResultRow>()` (v9 takes the features type first); `helper.columns([...])`; `helper.display({ id, header, cell })`; `useTable({ features, columns, data, getRowId, getRowCanExpand: () => true, state: { expanded }, onExpandedChange })`; `table.getHeaderGroups()`, `table.getRowModel().rows`, `row.getAllCells()`, `row.getIsExpanded()`, `row.getToggleExpandedHandler()`, `<table.FlexRender header={…} />`, `<table.FlexRender cell={…} />`; `ExpandedState`. **No sorted or filtered row models are registered**: spec §6.5 requires core's `sortRows`/`filterRows`, so the rows arrive at the table already filtered and sorted, and sort state lives in the URL.
- **@testing-library/react 16.3.3** needs **`@testing-library/dom`** (plan: `10.x`) as a peer since v16 (README "Installation"). Auto-cleanup registers only when `afterEach` is a global; Vitest runs without globals here, so `test/setup.ts` calls `cleanup()` in `afterEach`.
- **@testing-library/user-event 14.6.8.** `const user = userEvent.setup(); await user.type(el, 'lhr'); await user.tab(); await user.keyboard('{Enter}'); await user.click(el)`.
- **@testing-library/jest-dom 7.0.1.** `import '@testing-library/jest-dom/vitest'` in the setup file (the plan's Task 0.1 setup line); matchers `toBeInTheDocument`, `toHaveTextContent`, `toHaveAttribute`, `toBeVisible`, `toHaveValue`, `toBeDisabled`.
- **jsdom 30.1.2** via `environment: 'jsdom'` and `environmentOptions.jsdom.url = 'http://localhost:3000/'` so `window.location.origin` is absolute. jsdom has no `matchMedia`; `test/viewport.ts` installs one.
- **msw 3.0.3** (mswjs.io "Quick start" Node integration, "Defaults", runbook "relative URLs"). `setupServer(...handlers)` from `msw/node`; `http.get/post/put/delete(url, resolver)` and `HttpResponse.json(body, { status })` from `msw`; `server.listen({ onUnhandledRequest: 'error' })` in `beforeAll`, `server.resetHandlers()` in `afterEach`, `server.close()` in `afterAll`; `server.use(...)` prepends per-test overrides. Under jsdom, `fetch` is Node's global fetch, which `setupServer` intercepts; requests must use **absolute URLs** (relative URLs are not intercepted in Node), which is why the client builds `new URL(path, window.location.origin)`.
- **vitest 5.0.4.** `defineConfig` from `vitest/config`; `test.environment`, `test.environmentOptions`, `test.setupFiles`, `test.coverage.thresholds`; `vi.spyOn`, `vi.fn`. `import.meta.env.DEV` is `true` under Vitest, so contract parsing runs in every test.
- **zod 4.6.7.** `import type { z } from 'zod'` for `z.infer`; runtime parsing uses the contract's schemas. A web dependency per the plan's "Web" section.

## 7. Files

**Create** (all under `apps/web/`):

```
index.html
vite.config.ts
src/main.tsx  src/App.tsx  src/styles.css  src/vite-env.d.ts
src/copy.ts  src/format.ts  src/now.tsx
src/hooks/useMediaQuery.ts
src/state/urlState.ts  src/state/view.ts  src/state/resultsState.ts
src/api/client.ts  src/api/endpoints.ts  src/api/types.ts  src/api/queries.ts
src/components/Provenance.tsx  src/components/PriceCell.tsx  src/components/PriceBoundary.tsx
src/components/ClassBadge.tsx  src/components/VerdictList.tsx  src/components/BookingAction.tsx
src/components/SyntheticBanner.tsx  src/components/Nav.tsx  src/components/DefinitionSelector.tsx
src/components/StatusBar.tsx  src/components/ViewHeader.tsx
src/views/Placeholder.tsx
src/views/Results/ResultsView.tsx  src/views/Results/ResultsHeader.tsx  src/views/Results/ResultsTable.tsx
src/views/Results/ExpandedRow.tsx  src/views/Results/Filters.tsx  src/views/Results/BasisSwitch.tsx
src/views/Results/CalendarGapBanner.tsx
src/views/Coverage/CoverageView.tsx
src/views/Providers/ProvidersView.tsx
src/views/Definitions/DefinitionsView.tsx  src/views/Definitions/DefinitionForm.tsx
src/views/Definitions/AirportListInput.tsx  src/views/Definitions/AdvancedFields.tsx
src/views/Definitions/CoverageCheck.tsx  src/views/Definitions/EstimatePanel.tsx
src/views/Definitions/draft.ts  src/example.ts
test/msw/server.ts  test/msw/handlers.ts  test/fixtures.ts  test/render.tsx  test/viewport.ts
```

**Create (stand-in, WP12 owns it):** `docs/examples/london-new-york.json`, only when absent (Task 9.12).

**Modify:** `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts` (all created empty-ish by WP0 Task 0.1); delete `apps/web/test/smoke.test.ts` in Task 9.1 (superseded).

**Test:**

```
test/components/provenance.test.tsx        Task 9.1
test/copy/catalogue.test.ts                Task 9.2
test/copy/sourceGuard.test.ts              Task 9.2
test/api/client.test.ts                    Task 9.3
test/state/resultsState.test.ts            Task 9.4
test/app/shell.test.tsx                    Task 9.5
test/components/statusBar.test.tsx         Task 9.6
test/views/results/expanded.test.tsx       Task 9.7
test/views/results/table.test.tsx          Task 9.8
test/views/results/basisAndGap.test.tsx    Task 9.9
test/views/coverage.test.tsx               Task 9.10
test/views/providers.test.tsx              Task 9.11
test/views/definitions/form.test.tsx       Task 9.12
test/views/definitions/create.test.tsx     Task 9.13
test/copy/renderedSweep.test.tsx           Task 9.14
```

Every focused run in the tasks uses `pnpm --filter @gmt/web exec vitest run <file>` (no coverage, so a single file does not trip the package thresholds); the package-wide `pnpm --filter @gmt/web test` runs with coverage in §10.

## 8. Tasks

### Task 9.1: Scaffold, copy catalogue, and the provenance-checked price (first failing test)

**Files:**
- Modify: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts`
- Delete: `apps/web/test/smoke.test.ts`
- Create: `apps/web/index.html`, `apps/web/vite.config.ts`, `src/vite-env.d.ts`, `src/styles.css`, `src/copy.ts`, `src/format.ts`, `src/now.tsx`, `src/components/Provenance.tsx`, `src/components/PriceCell.tsx`, `src/components/PriceBoundary.tsx`, `test/render.tsx`, `test/viewport.ts`
- Test: `test/components/provenance.test.tsx`

**Interfaces:**
- Consumes: `provenanceSchema`, `Provenance`, `effectiveAge`, `formatAgeCompact`, `formatAgeFull`, `asIsoDateTime` (WP0).
- Produces: `COPY`, `formatPence`, `formatMicroGbp`, `formatIsoDate`, `formatLocalDateTime`, `formatMinutes`, `formatSeconds`, `parsePoundsToPence`, `NowContext`, `useNow`, `Provenance`, `PriceCell`, `PriceBoundary`, `assertProvenance`, `MissingProvenanceError`, `renderWithProviders`, `NOW`, `setViewportWidth`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/components/provenance.test.tsx`:

```tsx
import { asIsoDate, asIsoDateTime, type Provenance as ProvenanceT } from '@gmt/core';
import { screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceBoundary } from '../../src/components/PriceBoundary.js';
import { PriceCell } from '../../src/components/PriceCell.js';
import { MissingProvenanceError, Provenance } from '../../src/components/Provenance.js';
import { renderWithProviders } from '../render.js';

const searchProvenance: ProvenanceT = {
  providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: asIsoDateTime('2026-10-14T10:00:00.000Z'),
  maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy',
};
const calendarProvenance: ProvenanceT = {
  providerId: 'travelpayouts', sourceKind: 'authorised-cached', fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'),
  maxAgeHours: 48, fx: { converted: true, rateNano: 790_000_000, rateDate: asIsoDate('2026-10-13'), source: 'frankfurter' },
  pointOfSale: 'unknown', cabin: 'economy',
};

/** Records the error a child threw so the test can assert its class without relying on render() rethrowing. */
class Catch extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: unknown) { this.props.onError(error); }
  override render() { return this.state.failed ? null : this.props.children; }
}

// why: React reports boundary-caught errors to console.error and, in development, to window 'error'.
const swallow = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.addEventListener('error', swallow);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.removeEventListener('error', swallow);
});

describe('a price without provenance fails to render (spec §9 item 6; WP9 first failing test)', () => {
  it('PriceCell inside PriceBoundary shows the withheld message and never the number', () => {
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={undefined} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.queryByText(/412/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
  });

  it('a provenance missing fetchedAt is treated exactly like no provenance (nothing is defaulted)', () => {
    const { fetchedAt: _drop, ...partial } = searchProvenance;
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={partial as unknown as ProvenanceT} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.queryByText(/412/)).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('Provenance on its own throws MissingProvenanceError', () => {
    const errors: unknown[] = [];
    renderWithProviders(
      <Catch onError={(e) => errors.push(e)}>
        <Provenance provenance={undefined} calendar={false} />
      </Catch>,
    );
    expect(errors[0]).toBeInstanceOf(MissingProvenanceError);
  });
});

describe('Provenance shows source and age without hover (spec §11)', () => {
  it('itinerary price: badge, source in words, compact age with the full form as title', () => {
    renderWithProviders(<PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} destination="JFK" destinationNote={null} />);
    expect(screen.getByText('£412')).toBeInTheDocument();
    expect(screen.getByText('SearchApi')).toBeInTheDocument();
    expect(screen.getByText('Google Flights via SearchApi')).toBeInTheDocument();
    // why: maxAgeHours 0 (priced at request time) has no "≤…" clause (plan "Labels").
    const age = screen.getByText('5h ago');
    expect(age).toHaveAttribute('title', 'fetched 5h ago');
    expect(screen.queryByText('constraints not checked')).toBeNull();
    expect(screen.queryByText('≈')).toBeNull();
  });

  it('calendar price: dashed outline, "constraints not checked", ≈ for FX, destination and note', () => {
    renderWithProviders(
      <PriceCell pricePence={39950} provenance={calendarProvenance} calendar stale destination="EWR" destinationNote="onward leg not included" />,
    );
    expect(screen.getByText('£399.50')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
    const box = screen.getByTestId('provenance');
    expect(box.className).toContain('border-dashed');
    expect(screen.getByText('constraints not checked')).toBeInTheDocument();
    expect(screen.getByText('Aviasales cache')).toBeInTheDocument();
    expect(screen.getByText('2h ago · ≤2d')).toHaveAttribute('title', 'fetched 2h ago · provider age unknown (≤2d before that)');
    expect(screen.getByText('≈')).toHaveAttribute('title', 'converted to GBP at the 2026-10-13 rate (frankfurter)');
    expect(screen.getByText('EWR')).toBeInTheDocument();
    expect(screen.getByText('onward leg not included')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/components/provenance.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/components/PriceBoundary.js"` (and `../render.js`).

- [ ] **Step 3: Implement**

`apps/web/package.json` (replace WP0's file; scripts change to Vite, dependencies gain `msw`, `@testing-library/dom`, `zod`):

```json
{
  "name": "@gmt/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --coverage"
  },
  "dependencies": {
    "@gmt/core": "workspace:*",
    "@tanstack/react-query": "5.104.2",
    "@tanstack/react-table": "9.3.1",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "recharts": "3.10.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@playwright/test": "1.64.1",
    "@tailwindcss/vite": "4.3.3",
    "@testing-library/dom": "10.4.1",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.8",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.2",
    "msw": "3.0.3",
    "tailwindcss": "4.3.3",
    "vite": "8.3.4"
  }
}
```

`// why:` (in the PR description, JSON has no comments) `tailwindcss` moves to devDependencies because it is a build-time plugin; `@testing-library/dom` is RTL 16's peer; `msw` mocks the API; `zod` resolves `import type { z }`. Run `pnpm view @testing-library/dom@10.4.1 version` before committing; if that exact version is not published, pin the newest 10.x that is at least two weeks old and record it in the PR.

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "types": ["vite/client", "node"],
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`// why:` (comment line at the top of `vite.config.ts`) the web overrides the base's NodeNext resolution with Bundler because Vite, not `tsc`, emits it; `composite` is off because nothing references the web project.

`apps/web/vite.config.ts`:

```ts
// why: the web builds with Vite (Bundler resolution); tsconfig overrides the base's NodeNext for that reason.
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Every core/api-contract route lives under /api (spec §10); the SPA owns "/" with its state in
 * search params. test/api/client.test.ts asserts every ROUTES path starts with this prefix.
 */
export const API_PREFIX = '/api';

/** core is consumed from source so `pnpm dev` and `vite build` never need core's dist. */
export const CORE_SRC = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@gmt/core': CORE_SRC } },
  server: {
    port: 5173,
    strictPort: true,
    // why: no changeOrigin, so the api sees Host localhost:5173, which spec §4 allowlists in development.
    proxy: { [API_PREFIX]: { target: 'http://localhost:3000' } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`apps/web/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@gmt/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  test: {
    name: 'web',
    environment: 'jsdom',
    // why: an absolute origin so the client's new URL(path, origin) gives msw an interceptable absolute URL.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
    },
  },
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>get-me-there</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`src/styles.css`:

```css
/* Tailwind v4, CSS-first: no tailwind.config.js. */
@import "tailwindcss";

/* Visible focus on every interactive element (spec §11 accessibility). */
:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}
```

`test/setup.ts` (replaces WP0's one-liner; Task 9.3 adds msw):

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setViewportWidth } from './viewport.js';

// why: Vitest runs without globals, so RTL's automatic cleanup never registers.
afterEach(() => cleanup());
// why: jsdom has no matchMedia; every test starts wide and opts into 375px explicitly.
beforeEach(() => setViewportWidth(1280));
```

`test/viewport.ts`:

```ts
/** Installs a matchMedia that evaluates `(max-width: Npx)` against a chosen viewport width. */
export function setViewportWidth(px: number): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const m = /max-width:\s*(\d+)px/.exec(query);
      const limit = m?.[1];
      const matches = limit !== undefined ? px <= Number(limit) : false;
      return {
        matches, media: query, onchange: null,
        addListener: () => undefined, removeListener: () => undefined,
        addEventListener: () => undefined, removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}
```

`test/render.tsx`:

```tsx
import { asIsoDateTime, type IsoDateTime } from '@gmt/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { NowContext } from '../src/now.js';

/** The fixed "now" of every web test; fixtures are dated relative to it. */
export const NOW: IsoDateTime = asIsoDateTime('2026-10-14T15:00:00.000Z');

/** Renders with a fresh QueryClient (no retries), a fixed clock and the given search string. */
export function renderWithProviders(ui: ReactElement, opts: { search?: string } = {}) {
  window.history.replaceState(null, '', `/${opts.search ?? ''}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } } });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={client}>
      <NowContext.Provider value={() => NOW}>{ui}</NowContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, user, client };
}
```

`src/now.tsx`:

```tsx
import type { IsoDateTime } from '@gmt/core';
import { createContext, useContext } from 'react';

/** The clock components read; tests pin it. Spec §3 ages are computed against it. */
export const NowContext = createContext<() => IsoDateTime>(() => new Date().toISOString() as IsoDateTime);

/** Current instant in toISOString form (spec §6.3). */
export function useNow(): IsoDateTime {
  return useContext(NowContext)();
}
```

`src/format.ts`:

```ts
import { formatPence } from '@gmt/core';

// why: core's formatPence (src/text/money.ts: en-GB grouping, throws on non-integer or negative) is the
// single money formatter for web and email; re-exported so components keep one import site.
export { formatPence };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Integer micro-GBP → pence (rounded up, so a cost is never understated) → "£…". */
export function formatMicroGbp(micro: number): string {
  if (!Number.isInteger(micro) || micro < 0) throw new RangeError(`micro-GBP must be a non-negative integer, got ${micro}`);
  return formatPence(Math.ceil(micro / 10_000));
}

/**
 * "2027-03-14" → "14 Mar 2027" by string slicing only.
 * why: never through Date, so the day cannot shift in a browser outside Europe/London (review focus 3).
 */
export function formatIsoDate(d: string): string {
  const [y, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (y === undefined || day === undefined || month === undefined) return d;
  return `${Number(day)} ${month} ${y}`;
}

/** Segment local time "2027-03-14T10:25" → "14 Mar 10:25" (wall time at the airport, spec §6.4). */
export function formatLocalDateTime(local: string): string {
  const [date, time] = local.split('T');
  if (date === undefined || time === undefined) return local;
  const full = formatIsoDate(date);
  return `${full.slice(0, full.lastIndexOf(' '))} ${time}`;
}

/** 905 → "15h 05m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Estimate seconds → "45s", "12m", "2h 05m". */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : formatMinutes(minutes);
}

/** Pence → "412" or "412.50" for an editable input: no float, no thousands separator. */
export function penceToPoundsInput(pence: number | undefined): string {
  if (pence === undefined) return '';
  const rest = pence % 100;
  return `${Math.floor(pence / 100)}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}

/** "12" | "12.5" | "12.50" → pence, without floating point; blank or malformed → undefined. */
export function parsePoundsToPence(input: string): number | undefined {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m || m[1] === undefined) return undefined;
  const fraction = (m[2] ?? '').padEnd(2, '0');
  return Number(m[1]) * 100 + Number(fraction);
}
```

`src/copy.ts` (the whole catalogue; later tasks only import from it):

```ts
import { type Cabin, CONSTRAINT_LABELS, type ConstraintName, type ExecutionStatus, type ProviderId, type SourceKind, type Verdict, type VerdictClass } from '@gmt/core';

/**
 * Every user-facing string of the web app. Spec §11: the banned-word list applies to all copy,
 * and "verified" appears only beside class-verified values. Components import from here and
 * never write literal copy in JSX (test/copy/sourceGuard.test.ts enforces that); the catalogue
 * test walks every entry. Strings that come from the API (basisReason, error messages, the
 * zero-cap message, provenance notes, airport names) are WP8's and are tested there.
 */
export const COPY = {
  appTitle: 'get-me-there',
  navLabel: 'Views',
  nav: {
    results: 'Results', calendar: 'Calendar', duration: 'Duration', history: 'History',
    coverage: 'Coverage', definitions: 'Definitions', alerts: 'Alerts', providers: 'Providers',
  },
  placeholder: (wp: string) => `This view is coming in ${wp}.`,
  definitionSelectorLabel: 'Search definition',
  noDefinitions: 'No search definitions yet. Create one under Definitions.',
  loading: 'Loading…',
  loadFailed: (message: string) => `Could not load: ${message}`,
  actionFailed: (message: string) => `That did not work: ${message}`,
  emptyNoProviders:
    'No flight data provider is configured. Set TRAVELPAYOUTS_TOKEN in .env for the free Aviasales cache, or SEARCHAPI_KEY for Google Flights via SearchApi, then restart the app.',
  syntheticBanner:
    'Synthetic data: the fixture provider is enabled. Every price on this page is made up for development and testing.',

  // provenance (spec §11)
  priceWithheld: 'price withheld: provenance missing',
  provider: { travelpayouts: 'Travelpayouts', searchapi: 'SearchApi', fixture: 'Fixture' } satisfies Record<ProviderId, string>,
  source: {
    'authorised-cached': 'Aviasales cache',
    'scraped-aggregate': 'Google date grid via SearchApi',
    'scraped-search': 'Google Flights via SearchApi',
    synthetic: 'synthetic fixture data',
  } satisfies Record<SourceKind, string>,
  fxApprox: '≈',
  fxTitle: (rateDate: string, source: string) => `converted to GBP at the ${rateDate} rate (${source})`,
  constraintsNotChecked: 'constraints not checked',
  notChecked: 'not checked',
  stale: 'stale',
  staleView: 'Every row here is older than one refresh cycle.',
  bandCheapest: 'cheapest in its 6h travel-time band',
  notSeenInLatest: (age: string) => `not seen in latest search (${age})`,
  ago: (duration: string) => (duration === 'just now' ? duration : `${duration} ago`),
  fetchedAgo: (ago: string) => `fetched ${ago}`,

  // classes, bases, verdicts (spec §3, §6.2, §6.9)
  classLabel: {
    verified: 'verified', 'partially-verified': 'partially verified', failed: 'failed', unchecked: 'constraints not checked',
  } satisfies Record<VerdictClass | 'unchecked', string>,
  classAria: (label: string) => `verdict class: ${label}`,
  basisName: { verified: 'itinerary-search basis', calendar: 'calendar basis' },
  basisSwitchLabel: 'Price basis',
  // why: core's CONSTRAINT_LABELS is the one set of plain-English constraint names (web and email); kept
  // under COPY so the catalogue test sweeps it for banned words like every other string.
  constraint: CONSTRAINT_LABELS satisfies Record<ConstraintName, string>,
  verdictWord: { pass: 'pass', fail: 'fail', unverified: 'unverified' } satisfies Record<Verdict, string>,
  verdictGlyph: { pass: '✓', fail: '✗', unverified: '?' } satisfies Record<Verdict, string>,
  verdictAria: (constraint: string, verdict: string) => `${constraint}: ${verdict}`,
  verdictsHeading: 'Constraint verdicts',
  noVerdicts: 'No constraints evaluated for this row.',
  notApplied: (names: string) => `not applied: ${names}`,
  unverifiedList: (names: string) => `unverified: ${names}`,

  // results table
  columns: {
    expand: 'Details', price: 'Price', totalTime: 'Travel time', departure: 'Departure', return: 'Return',
    nights: 'Nights', destination: 'Destination', carriers: 'Carriers', stops: 'Stops', class: 'Class',
    fetched: 'Fetched', provider: 'Provider', adjusted: 'Adjusted (operator-entered onward cost)',
  },
  resultsTableLabel: 'Round trips found',
  sortBy: (column: string, dir: string) => `Sort by ${column}, ${dir}`,
  sortDir: { asc: 'ascending', desc: 'descending' },
  showDetails: (what: string) => `Show details for ${what}`,
  hideDetails: (what: string) => `Hide details for ${what}`,
  rowName: (destination: string, departure: string, ret: string) => `${destination} ${departure} to ${ret}`,
  stopsValue: (out: number, back: number) => `${out} out · ${back} back`,
  nightsValue: (n: number) => `${n}n`,
  adjustedValue: (amount: string) => `${amount} adjusted`,
  noRowsAfterFilter: 'No rows match these filters.',

  // results header (spec §11)
  headline: (p: { price: string; destination: string; dates: string; basis: string; cls: string; provider: string; age: string }) =>
    `cheapest found ${p.price} · ${p.destination} ${p.dates} · ${p.basis} · ${p.cls} · ${p.provider} · ${p.age}`,
  dateRange: (dep: string, ret: string, nights: number) => `${dep}–${ret} (${nights}n)`,
  noHeadline: 'No round trip found yet for this definition.',
  coverageLine: (c: { priced: number; empty: number; noData: number; error: number; skipped: number; notRun: number; total: number; reused: number }) =>
    `discovery: ${c.priced} priced · ${c.empty} no fares · ${c.noData} no cached data · ${c.error} error · ${c.skipped} skipped · ${c.notRun} not searched of ${c.total} (${c.reused} reused)`,
  itineraryLine: (c: { searched: number; selected: number; expandTop: number; onDemand: number }) =>
    ` · itinerary-searched ${c.searched} of ${c.selected} selected (${c.expandTop} outbounds each) +${c.onDemand} on demand`,
  noItinerarySearch: ' · itinerary search not configured',
  truncated: (shown: number, total: number) => `within the cheapest ${shown} of ${total}`,
  excludedByCurrentSpace: (n: number) => `${n} rows outside the current window and nights range are not shown`,

  // view header (spec §11)
  executionsShown: (list: string) => `showing ${list}`,
  executionItem: (id: string, status: string, age: string) => `run ${id} (${status}, ${age})`,
  notCompletedBanner: (status: string) => `The latest run is ${status}; these results may be partial.`,
  noExecution: 'No run yet for this definition.',
  statusName: {
    pending: 'pending', running: 'running', paused_budget: 'paused: budget', paused_error: 'paused: error',
    interrupted: 'interrupted', cancelled: 'cancelled', completed: 'completed', skipped_budget: 'skipped: over budget',
    skipped_confirm: 'skipped: cost not confirmed', skipped_window: 'skipped: window has no dates',
    skipped_missed: 'skipped: missed while the app was stopped',
  } satisfies Record<ExecutionStatus, string>,
  stageName: { discovery: 'discovery', verification: 'itinerary search' } as Record<string, string>,

  // status bar (spec §11)
  statusBarLabel: 'Run status',
  progress: (stage: string, done: number, total: number) => `${stage}: ${done} of ${total} cells`,
  spendRunCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} billed calls`,
  spendRunFreeCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} free calls`,
  spendRunCost: (used: string, cap: string) => `this run: ${used} of ${cap}`,
  spendMonth: (used: string, cap: string) => `this month: ${used} of ${cap}`,
  noCap: 'no cap',
  paused: (reason: string) => `Paused: ${reason}`,
  scheduleBlocked: (date: string) => `schedule blocked since ${date}`,
  resume: 'Resume',
  cancel: 'Cancel',
  runNow: 'Run now',

  // filters (spec §6.5)
  filtersHeading: 'Filter',
  filterClass: 'Verdict class',
  filterProvider: 'Provider',
  filterMaxStops: 'Max stops',
  filterCarriers: 'Carriers (comma-separated codes)',
  filterDestinations: 'Destination',
  filterMaxPrice: 'Max price (£)',
  filterNightsMin: 'Min nights',
  filterNightsMax: 'Max nights',
  filterHideStale: 'Hide stale rows',
  filterUnverified: 'Has this constraint unverified',
  any: 'any',
  clearFilters: 'Clear filters',
  filtersDisabledCalendar: 'Stops and carriers are not known on the calendar basis.',

  // expanded row (spec §11)
  outbound: 'Outbound',
  inbound: 'Return',
  segment: (carrier: string, flight: number, from: string, dep: string, to: string, arr: string) =>
    `${carrier} ${flight} ${from} ${dep} → ${to} ${arr}`,
  noSegments: 'calendar price, no itinerary',
  layovers: 'Layovers',
  layover: (at: string, duration: string) => `${at}: ${duration}`,
  overnightLayover: 'overnight',
  selfTransfer: 'self-transfer: you re-check bags and the airlines do not protect the connection',
  airportChange: 'airport change',
  noLayovers: 'none',
  baggage: 'Baggage',
  cabinBag: { included: 'cabin bag included', 'not-included': 'cabin bag not included' },
  cabinBagUnknown: 'cabin bag not stated',
  checkedBags: (n: number) => `${n} checked bag${n === 1 ? '' : 's'}`,
  checkedBagsUnknown: 'checked bags not stated',
  conditions: 'Fare conditions',
  refundable: (v: boolean | undefined) => (v === undefined ? 'refunds not stated' : v ? 'refundable' : 'not refundable'),
  changeable: (v: boolean | undefined) => (v === undefined ? 'changes not stated' : v ? 'changeable' : 'not changeable'),
  seller: (s: string) => `sold by ${s}`,
  booking: 'Booking',
  noLink: 'no link',
  openOn: (host: string) => `open on ${host}`,
  continueOnForm: (host: string) => `continue on ${host} (sends a form)`,
  searchLinkLabel: 'search link, not a fare link',
  noSearchLink: 'no search link',
  hostShown: (host: string) => `(${host})`,
  otherOffers: 'Other sellers for this itinerary',
  summary: 'Summary',
  verifyCell: 'Search this cell for itineraries',
  verifyStarted: 'Itinerary search started for this cell.',

  // basis and calendar gap (spec §6.9, §11)
  calendarGapLead: (n: number) => `${n} cells have calendar prices below your cheapest verified`,
  calendarGapList: 'Cells to search',

  // coverage view (spec §11 View D)
  coverageHeading: 'Coverage',
  coverageStage: 'Stage',
  coverageProvider: 'Provider',
  bucket: { priced: 'priced', empty: 'no fares', no_data: 'no cached data', error: 'error', skipped: 'skipped', not_run: 'not searched' },
  coverageCells: 'cells',
  reusedNote: (n: number) => `(${n} reused from earlier runs)`,
  cellLabel: (o: string, d: string, dep: string, ret: string) => `${o} → ${d} ${dep} to ${ret}`,
  coverageSearched: 'searched (priced + no fares + no cached data)',
  sumMismatch: (sum: number, total: number) => `buckets sum to ${sum}, not ${total}; report this`,
  selectedNotReached: 'Selected but not reached',
  reasonNotRun: 'not run',
  reasonBudget: 'skipped: budget',
  noneSelectedNotReached: 'Every selected cell was reached.',
  overrunFlag: 'Overrun: ledger calls exceed the plan by more than 10%.',
  parityFlag: 'Parity break: tile requests differ from the plan.',
  requestsHeading: 'Requests (estimate vs ledger)',
  requestRow: (calls: number, planned: string, hits: number, cost: string) =>
    `${calls} of ${planned} planned calls · ${hits} cache hits · ledger cost ${cost}, from configured rates`,
  errorsHeading: 'Errors',
  errorRow: (reason: string, attempts: number) => `${reason} after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
  noErrors: 'No errors.',
  retry: 'Retry errors',

  // providers view (spec §10, §11)
  providersHeading: 'Providers',
  providerEnabled: 'configured',
  providerDisabled: 'not configured',
  plan: (p: string) => `plan: ${p}`,
  capabilityDiscovery: 'Discovery',
  capabilityVerification: 'Itinerary search',
  maxAge: (age: string) => `prices up to ${age} old when fetched`,
  maxAgeUnknown: 'provider age unknown',
  maxAgeZero: 'priced at request time',
  usageWindow: (calls: number, cap: string, start: string, end: string) => `${calls} of ${cap} calls · window ${start} to ${end}`,
  usageLifetime: (calls: number, cap: string) => `${calls} of ${cap} calls over the plan's lifetime`,
  excludedFromSchedule: 'excluded from scheduled runs',

  // definitions form (spec §11)
  definitionsHeading: 'Definitions',
  newDefinition: 'New definition',
  editDefinition: (name: string) => `Edit ${name}`,
  name: 'Name',
  origins: 'Origins',
  destinations: 'Destinations',
  airportInputHelp: 'Type an airport code or name. Codes are upper-cased.',
  addAirport: 'Add',
  addOrigin: 'Add origin',
  addDestination: 'Add destination',
  removeAirport: (code: string) => `Remove ${code}`,
  iataFormat: 'An airport code is three letters.',
  airportOption: (name: string, city: string, country: string) => `${name}, ${city}, ${country}`,
  destinationNote: (iata: string) => `Note for ${iata} (shown on every row)`,
  onwardCost: (iata: string) => `Onward cost to ${iata} in £ (optional, shown as a separate adjusted column)`,
  windowHeading: 'Departure window',
  windowRelative: 'Relative to today',
  windowAbsolute: 'Fixed dates',
  startOffsetDays: 'Starts in (days)',
  lengthDays: 'Length (days)',
  windowFrom: 'From',
  windowTo: 'To',
  minNights: 'Min nights',
  maxNights: 'Max nights',
  cabin: 'Cabin',
  cabinName: { economy: 'economy', premium_economy: 'premium economy', business: 'business', first: 'first' } satisfies Record<Cabin, string>,
  advanced: 'Advanced: constraints and policy',
  constraintsHeading: 'Constraints',
  timeFrom: 'from',
  timeTo: 'to',
  airlinesHelp: 'comma-separated carrier codes',
  policyHeading: 'Itinerary search policy',
  maxCells: 'Max cells per run',
  topN: 'Top N by discovery price',
  priceCeilingPence: 'Price ceiling in pence (optional)',
  perDepartureDateBest: 'Best cells per departure date (optional)',
  expandTop: 'Outbounds expanded per cell',
  bookingLinks: 'Fetch booking options',
  bookingLinksForced: 'Always on for SearchApi: its sellers can undercut the airline fare.',
  providersSection: 'Providers',
  discoveryProviders: 'Discovery',
  verificationProviders: 'Itinerary search',
  refreshHours: (provider: string) => `${provider} refresh interval (hours)`,
  budgetHeading: 'Run budget',
  maxCalls: 'Max billed calls per run',
  maxFreeCalls: 'Max free calls per run',
  maxCostPence: 'Max cost per run (pence)',
  scheduleHeading: 'Schedule',
  scheduleCron: 'Cron (blank: manual runs only)',
  scheduleTz: 'Time zone',
  coverageCheck: 'Check free coverage',
  coverageCheckIntro:
    'Free check of the Aviasales cache for these pairs: cached rows per month. Zero means the free provider has nothing for that pair and month; it does not mean there are no flights.',
  coverageCheckNeedsTravelpayouts: 'The free coverage check needs TRAVELPAYOUTS_TOKEN.',
  coverageCheckPair: (o: string, d: string) => `${o} → ${d}`,
  coverageCheckCalls: (n: number) => `${n} free calls used`,
  coverageCheckMonth: 'Month',
  importExample: 'Import example (London to New York)',
  showEstimate: 'Show estimate',
  save: 'Save changes',
  createConfirm: (amount: string) => `Create and confirm up to ${amount} per run`,
  created: 'Created. Scheduled runs use the cost you confirmed.',
  saved: 'Saved.',
  fieldErrorsHeading: 'Fix these before saving:',
  fieldError: (field: string, message: string) => `${field}: ${message}`,
  estimateHeading: 'Estimate',
  estimateCells: (n: number) => `${n} cells`,
  estimateRow: (provider: string, stage: string, calls: number, cost: string, time: string) =>
    `${provider} ${stage}: ${calls} calls · ${cost} · about ${time}`,
  estimateTotal: (cost: string, time: string) => `total ${cost} per run · about ${time}`,
  windowClamped: 'The window was moved to start tomorrow.',
  estimateBlocked: (reason: string) => `blocked: ${reason}`,
  definitionNotices: 'Notices for this definition',
  assumptions: 'Assumptions',
  budgetFitOk: (runs: number) => `Fits every cap at ${runs} runs a month.`,
  budgetFitWarn: (runs: number) => `Does not fit every cap at ${runs} runs a month:`,
  budgetScope: (scope: string, estimated: number, cap: string) => `${scope}: ${estimated} estimated, cap ${cap}`,
  needsConfirmation: (estimate: string, confirmed: string) =>
    `The new estimate (${estimate} per run) is above your confirmation (${confirmed}). Scheduled runs are skipped until you confirm.`,
  confirmNew: (amount: string) => `Confirm up to ${amount} per run`,
  none: 'none',
} as const;
```

`src/components/Provenance.tsx`:

```tsx
import { effectiveAge, formatAgeCompact, formatAgeFull, type Provenance as ProvenanceT, provenanceSchema } from '@gmt/core';
import { COPY } from '../copy.js';
import { useNow } from '../now.js';

/** Thrown when a price would render without complete provenance. Spec §11: provenance on every price. */
export class MissingProvenanceError extends Error {
  constructor(detail: string) {
    super(`price rendered without valid provenance: ${detail}`);
    this.name = 'MissingProvenanceError';
  }
}

/**
 * Validates with core's schema, never by presence checks, so a partial object (no fetchedAt,
 * maxAgeHours missing) fails exactly like undefined. Spec §3: nothing is defaulted.
 */
export function assertProvenance(p: unknown): ProvenanceT {
  const r = provenanceSchema.safeParse(p);
  if (!r.success) throw new MissingProvenanceError(r.error.issues.map((i) => i.path.join('.') || '(root)').join(', '));
  return r.data;
}

export interface ProvenanceProps {
  provenance: ProvenanceT | undefined;
  /** Calendar-basis price: dashed outline and "constraints not checked" (spec §11). */
  calendar: boolean;
  destination?: string | undefined;
  destinationNote?: string | null | undefined;
}

/** Spec §11 provenance block, visible without hover; the full age form is the title. */
export function Provenance({ provenance, calendar, destination, destinationNote }: ProvenanceProps) {
  const now = useNow();
  const p = assertProvenance(provenance);
  const age = effectiveAge(p, now);
  const fxTitle = p.fx.converted ? COPY.fxTitle(p.fx.rateDate, p.fx.source) : null;
  return (
    <span
      data-testid="provenance"
      className={`inline-flex flex-wrap items-center gap-1 text-xs text-slate-700 ${calendar ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      <span className="rounded bg-slate-200 px-1 font-medium text-slate-900">{COPY.provider[p.providerId]}</span>
      <span>{COPY.source[p.sourceKind]}</span>
      <span title={formatAgeFull(age)}>{formatAgeCompact(age)}</span>
      {fxTitle !== null ? <span title={fxTitle} aria-label={fxTitle}>{COPY.fxApprox}</span> : null}
      {calendar ? <span className="font-medium">{COPY.constraintsNotChecked}</span> : null}
      {destination !== undefined ? <span>{destination}</span> : null}
      {destinationNote ? <span className="italic">{destinationNote}</span> : null}
    </span>
  );
}
```

`src/components/PriceCell.tsx`:

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
}

/** The only component that prints a price. Wrap it in PriceBoundary. Spec §11, §9 item 6. */
export function PriceCell(props: PriceCellProps) {
  // why: validate before formatting, so a bare number can never reach the DOM even for one frame.
  assertProvenance(props.provenance);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold tabular-nums">
        {formatPence(props.pricePence)}
        {props.stale ? <span className="ml-1 rounded bg-amber-200 px-1 text-xs font-normal">{COPY.stale}</span> : null}
      </span>
      <Provenance
        provenance={props.provenance}
        calendar={props.calendar}
        destination={props.destination}
        destinationNote={props.destinationNote}
      />
    </span>
  );
}
```

`src/components/PriceBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COPY } from '../copy.js';

interface State {
  failed: boolean;
}

/** Catches a price that failed provenance validation and shows the withheld message instead. Spec §9 item 6. */
export class PriceBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // why: a withheld price is a WP8 contract bug; make it loud in the console without breaking the page.
    console.error('[price withheld]', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <span role="alert" className="text-sm font-medium text-red-800">
          {COPY.priceWithheld}
        </span>
      );
    }
    return this.props.children;
  }
}
```

Delete `apps/web/test/smoke.test.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm install && pnpm --filter @gmt/web exec vitest run test/components/provenance.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml && git commit -m "wp09: web scaffold, copy catalogue, provenance-checked price cell"
```

### Task 9.2: Banned-word tests over the catalogue and the source

**Files:**
- Test: `test/copy/catalogue.test.ts`, `test/copy/sourceGuard.test.ts`

**Interfaces:**
- Consumes: `BANNED_WORDS`, `findBannedWords`, `BANNED_WORD_ALLOWLIST` (WP0, the single allowlist every package passes); `COPY` (Task 9.1).
- Produces: nothing new; the tests guard `src/copy.ts` and the `.tsx` sources.

Chosen approach (spec §9 item 6 "over every string in apps/web/src"): the **catalogue** `src/copy.ts` holds all copy, and two guards make that true: (1) the catalogue test walks every string and calls every function entry with sample arguments, failing when a function has no sample; (2) the source guard fails when any `.tsx` under `src/` contains JSX text with a letter or a literal `aria-label`, `title`, `placeholder`, `alt` or `label` attribute with a letter. Task 9.14 adds a sweep over the rendered DOM of every view.

- [ ] **Step 1: Write the failing tests**

`test/copy/catalogue.test.ts`:

```ts
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[]> = {
  placeholder: ['WP10'],
  loadFailed: ['network error'],
  actionFailed: ['409 conflict'],
  fxTitle: ['2026-10-13', 'frankfurter'],
  notSeenInLatest: ['3d ago'],
  ago: ['2h'],
  fetchedAgo: ['2h ago'],
  classAria: ['verified'],
  verdictAria: ['arrival time window', 'fail'],
  notApplied: ['arrival time window, maximum journey time'],
  unverifiedList: ['checked bag'],
  sortBy: ['Price', 'ascending'],
  showDetails: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  hideDetails: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  rowName: ['JFK', '14 Mar 2027', '28 Mar 2027'],
  stopsValue: [0, 1],
  nightsValue: [14],
  adjustedValue: ['£450'],
  headline: [{ price: '£412', destination: 'JFK', dates: '14 Mar 2027–28 Mar 2027 (14n)', basis: 'calendar basis', cls: 'constraints not checked', provider: 'Aviasales cache', age: '2h ago · ≤2d' }],
  dateRange: ['14 Mar 2027', '28 Mar 2027', 14],
  coverageLine: [{ priced: 3, empty: 1, noData: 2, error: 0, skipped: 0, notRun: 4, total: 10, reused: 0 }],
  itineraryLine: [{ searched: 2, selected: 10, expandTop: 2, onDemand: 1 }],
  truncated: [1000, 4210],
  excludedByCurrentSpace: [3],
  executionsShown: ['run abc (completed, 2h ago)'],
  executionItem: ['abc', 'completed', '2h ago'],
  notCompletedBanner: ['running'],
  progress: ['discovery', 120, 126],
  spendRunCalls: [42, '2000'],
  spendRunFreeCalls: [14, '2000'],
  spendRunCost: ['£0', '£0'],
  spendMonth: ['£32', '£35'],
  paused: ['budget'],
  scheduleBlocked: ['14 Oct 2026'],
  segment: ['ZZ', 117, 'LHR', '14 Mar 10:25', 'JFK', '14 Mar 13:20'],
  layover: ['BOS', '2h 05m'],
  checkedBags: [1],
  refundable: [true],
  changeable: [undefined],
  seller: ['Example Travel'],
  openOn: ['www.google.com'],
  continueOnForm: ['www.google.com'],
  hostShown: ['www.google.com'],
  calendarGapLead: [3],
  sumMismatch: [9, 10],
  reusedNote: [4],
  cellLabel: ['LHR', 'JFK', '20 Mar 2027', '1 Apr 2027'],
  requestRow: [14, '14', 2, '£0'],
  errorRow: ['rate-limit', 3],
  plan: ['40usd'],
  maxAge: ['2d'],
  usageWindow: [615, '10000', '1 Oct 2026', '1 Nov 2026'],
  usageLifetime: [9, '100'],
  editDefinition: ['London to New York (example)'],
  removeAirport: ['LHR'],
  fieldError: ['origins.0', 'LON is a city code'],
  airportOption: ['Heathrow', 'London', 'United Kingdom'],
  destinationNote: ['JFK'],
  onwardCost: ['JFK'],
  refreshHours: ['Travelpayouts'],
  coverageCheckPair: ['LHR', 'JFK'],
  coverageCheckCalls: [14],
  createConfirm: ['£0'],
  estimateCells: [13104],
  estimateRow: ['SearchApi', 'discovery', 92, '£0', '30m'],
  estimateTotal: ['£0', '45m'],
  estimateBlocked: ['searchapi provider-month cap 10000, estimated 12000'],
  budgetFitOk: [4],
  budgetFitWarn: [4],
  budgetScope: ['provider-month', 615, '10000'],
  needsConfirmation: ['£2', '£1'],
  confirmNew: ['£2'],
};

interface Collected {
  strings: Array<{ path: string; text: string }>;
  fns: string[];
  problems: string[];
}

/** Every string the catalogue can produce, with its dotted path; problems are reported, never thrown. */
function collect(value: unknown, path: string, out: Collected): void {
  if (typeof value === 'string') {
    out.strings.push({ path, text: value });
    return;
  }
  if (typeof value === 'function') {
    out.fns.push(path);
    const args = SAMPLES[path];
    if (args === undefined) {
      out.problems.push(`COPY.${path} is a function with no entry in SAMPLES`);
      return;
    }
    const produced = (value as (...a: unknown[]) => unknown)(...args);
    if (typeof produced !== 'string') out.problems.push(`COPY.${path} did not return a string`);
    else out.strings.push({ path, text: produced });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, path === '' ? k : `${path}.${k}`, out);
  }
}

describe('COPY catalogue (spec §11 banned words)', () => {
  const collected: Collected = { strings: [], fns: [], problems: [] };
  collect(COPY, '', collected);
  const strings = collected.strings;

  it('every function entry has sample arguments and every sample names a real entry', () => {
    expect(collected.problems).toEqual([]);
    expect(Object.keys(SAMPLES).filter((k) => !collected.fns.includes(k))).toEqual([]);
  });

  it('no string contains a banned word (word boundaries, small allowlist)', () => {
    const hits = strings.flatMap(({ path, text }) => findBannedWords(text, BANNED_WORD_ALLOWLIST).map((h) => `${path}: "${h.word}" in "${text}"`));
    expect(hits).toEqual([]);
  });

  it('"verified" as a whole word appears only in class labels and beside class-verified values', () => {
    const allowed = new Set(['classLabel.verified', 'classLabel.partially-verified', 'calendarGapLead', 'headline', 'classAria']);
    const offenders = strings.filter(({ path, text }) => /(?<![\p{L}])verified(?![\p{L}])/u.test(text) && !allowed.has(path));
    expect(offenders).toEqual([]);
  });

  it('stage counts say itinerary-searched', () => {
    expect(COPY.itineraryLine({ searched: 2, selected: 10, expandTop: 2, onDemand: 1 })).toBe(
      ' · itinerary-searched 2 of 10 selected (2 outbounds each) +1 on demand',
    );
  });

  it('the guard itself works: a planted banned word is found', () => {
    expect(findBannedWords('Live fares', BANNED_WORD_ALLOWLIST)).toHaveLength(1);
  });
});
```

`test/copy/sourceGuard.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Every .tsx file under src/, relative path and contents. */
function tsxFiles(): Array<{ file: string; text: string }> {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8') }));
}

/** `<tag ...>Some words</` on one line: literal JSX text containing a letter. */
const JSX_TEXT = /<([A-Za-z][\w.]*)(?:\s[^<>]*)?>([^<>{}\n]*[A-Za-z][^<>{}\n]*)<\//g;
/** aria-label="Close", title='x', placeholder="..." — literal attribute copy. */
const LITERAL_ATTR = /\b(aria-label|title|placeholder|alt|label)=(["'])([^"']*[A-Za-z][^"']*)\2/g;

describe('source guard: all copy comes from src/copy.ts (spec §11)', () => {
  it('finds .tsx files to scan (a vacuous pass is a failure)', () => {
    expect(tsxFiles().length).toBeGreaterThan(3);
  });

  it('no literal JSX text or literal copy attributes in any component', () => {
    const offenders: string[] = [];
    for (const { file, text } of tsxFiles()) {
      for (const m of text.matchAll(JSX_TEXT)) offenders.push(`${file}: text "${m[2]?.trim()}"`);
      for (const m of text.matchAll(LITERAL_ATTR)) offenders.push(`${file}: ${m[1]}="${m[3]}"`);
    }
    expect(offenders).toEqual([]);
  });

  it('the guard regexes catch planted offenders', () => {
    expect('<p>Live fares</p>'.match(JSX_TEXT)).not.toBeNull();
    expect('<button aria-label="Close">'.match(LITERAL_ATTR)).not.toBeNull();
    expect('<p>{COPY.loading}</p>'.match(JSX_TEXT)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

These are guards over code that already exists, so prove each one bites. Temporarily add `planted: 'live prices',` and ``plantedFn: (n: number) => `${n}`,`` to `COPY` in `src/copy.ts`, and `<p>Live fares</p>` inside `PriceBoundary`'s fallback `<span>`.

Run: `pnpm --filter @gmt/web exec vitest run test/copy`
Expected: FAIL, three tests: "every function entry has sample arguments" (`COPY.plantedFn is a function with no entry in SAMPLES`), "no string contains a banned word" (`planted: "live" in "live prices"`), and "no literal JSX text" (`components/PriceBoundary.tsx: text "Live fares"`).

- [ ] **Step 3: Implement**

Remove the three planted lines. No other production code: the catalogue exists from Task 9.1. Any real copy the test flags is reworded in `src/copy.ts`; the allowlist is core's and is not extended from the web.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/copy`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: banned-word tests over the copy catalogue and a source guard"
```

### Task 9.3: API client derived from ROUTES, test API on msw

**Files:**
- Create: `src/api/client.ts`, `src/api/types.ts`, `src/api/endpoints.ts`, `src/api/queries.ts`, `test/fixtures.ts`, `test/msw/handlers.ts`, `test/msw/server.ts`
- Modify: `test/setup.ts`
- Test: `test/api/client.test.ts`

**Interfaces:**
- Consumes: `apiContract.ROUTES` (every path under `/api`), `apiContract.errorEnvelopeSchema` (422 `details.fields`), the response schemas named in §4, `ResultRow`, `ResultBasis`.
- Produces: `ApiError`, `findRoute`, `fillPath`, `call`, `api`, `qk`, the query hooks, `useExecutionActions`, the response types, the fixture builders and `server`.

- [ ] **Step 1: Write the failing test**

`test/api/client.test.ts`:

```ts
import { apiContract } from '@gmt/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../vite.config.js';
import { ApiError, call, findRoute } from '../../src/api/client.js';
import { api } from '../../src/api/endpoints.js';
import { API, calendarRow, resultsResponse } from '../fixtures.js';
import { fixtureFor } from '../msw/handlers.js';
import { server } from '../msw/server.js';

describe('api client (derived from core/api-contract ROUTES)', () => {
  it('builds an absolute same-origin /api URL with path params and query, and parses with the contract', async () => {
    let seen = '';
    server.use(
      http.get(`${API}/definitions/:id/results`, ({ request }) => {
        seen = request.url;
        return HttpResponse.json(resultsResponse({ rows: [calendarRow()], total: 1 }));
      }),
    );
    const r = await api.results('def 1', 'calendar');
    expect(seen).toBe('http://localhost:3000/api/definitions/def%201/results?basis=calendar');
    expect(r.rows).toHaveLength(1);
  });

  it('rejects a response that breaks the contract (a row without provenance) in development', async () => {
    const { provenance: _drop, ...bare } = calendarRow();
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(resultsResponse({ rows: [bare as never] }))));
    await expect(api.results('d1', null)).rejects.toThrow(/GET \/api\/definitions\/:id\/results response does not match core\/api-contract/);
  });

  it('sends X-Requested-With and Content-Type on every mutation, even without a body', async () => {
    const headers: Array<Record<string, string | null>> = [];
    server.use(
      http.post(`${API}/executions/:id/cancel`, ({ request }) => {
        headers.push({ xrw: request.headers.get('x-requested-with'), ct: request.headers.get('content-type') });
        return HttpResponse.json(fixtureFor('POST', '/api/executions/:id/cancel'));
      }),
    );
    await api.cancel('e1');
    expect(headers).toEqual([{ xrw: 'get-me-there', ct: 'application/json' }]);
  });

  it('turns the error envelope into an ApiError carrying details.fields', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          { error: { code: 'validation', message: 'invalid definition', details: { fields: [{ field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' }] } } },
          { status: 422 },
        ),
      ),
    );
    const err = await call('POST', '/api/definitions/estimate', { body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).fieldErrors()).toEqual([{ field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' }]);
  });

  it('refuses a route that is not in ROUTES', () => {
    expect(() => findRoute('GET', '/api/not-a-route')).toThrow('route GET /api/not-a-route is not in core/api-contract ROUTES');
  });

  it('every route is under /api, which is the one prefix the dev server proxies', () => {
    expect(API_PREFIX).toBe('/api');
    for (const r of apiContract.ROUTES) expect(r.path.startsWith('/api/')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/api/client.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/api/client.js"`.

- [ ] **Step 3: Implement**

`src/api/client.ts`:

```ts
import { apiContract } from '@gmt/core';

export type Method = apiContract.RouteDef['method'];

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** A non-2xx response, from the spec §10 error envelope `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** A 422's `details.fields` (spec §10), e.g. the metro-code message of review focus 1. */
  fieldErrors(): Array<{ field: string; message: string }> {
    if (typeof this.details !== 'object' || this.details === null) return [];
    const fields = (this.details as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) return [];
    return fields.flatMap((d: unknown) => (isFieldError(d) ? [d] : []));
  }
}

function isFieldError(d: unknown): d is { field: string; message: string } {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  return typeof r.field === 'string' && typeof r.message === 'string';
}

/** The ROUTES entry for a method and path template (paths include `/api`); an unknown route is a programming error. */
export function findRoute(method: Method, path: string): apiContract.RouteDef {
  const route = apiContract.ROUTES.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route ${method} ${path} is not in core/api-contract ROUTES`);
  return route;
}

/** "/api/definitions/:id/results" + { id } → "/api/definitions/abc/results", every value URL-encoded. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`missing path parameter ${name} for ${path}`);
    return encodeURIComponent(v);
  });
}

/**
 * The one fetch in the app. Spec §4: mutations carry Content-Type: application/json and
 * X-Requested-With: get-me-there. In development and test every response is parsed with the
 * route's contract schema, so a WP8 drift (a price without provenance) fails loudly.
 */
export async function call<T>(method: Method, path: string, opts: CallOptions = {}): Promise<T> {
  const route = findRoute(method, path);
  // why: absolute URL; Node's fetch under jsdom (and msw's interceptor) cannot use a relative one.
  const url = new URL(fillPath(path, opts.params ?? {}), window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, headers, credentials: 'same-origin', redirect: 'error' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'get-me-there';
    init.body = JSON.stringify(opts.body ?? {});
  }
  // why: TanStack's AbortSignal is not forwarded; under jsdom it is jsdom's class, which Node's fetch rejects.
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text === '' ? null : JSON.parse(text);
  if (!res.ok) {
    const envelope = apiContract.errorEnvelopeSchema.safeParse(json);
    if (envelope.success) {
      throw new ApiError(res.status, envelope.data.error.code, envelope.data.error.message, envelope.data.error.details);
    }
    throw new ApiError(res.status, 'http', `${method} ${path} failed with HTTP ${res.status}`, undefined);
  }
  if (import.meta.env.DEV) {
    const parsed = route.response.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`${method} ${path} response does not match core/api-contract: ${issues}`);
    }
    return parsed.data as T;
  }
  return json as T;
}
```

`src/api/types.ts`:

```ts
import type { apiContract, ResultBasis } from '@gmt/core';
import type { z } from 'zod';

/** Response and request types, each the z.infer of its contract schema (plan "API contract"). */
export type ProvidersResponse = z.infer<typeof apiContract.providersResponseSchema>;
export type ProviderEntry = ProvidersResponse['providers'][number];
export type DefinitionResponse = z.infer<typeof apiContract.definitionResponseSchema>;
export type DefinitionRequest = z.infer<typeof apiContract.definitionCreateRequestSchema>;
export type DefinitionUpdate = z.infer<typeof apiContract.definitionUpdateRequestSchema>;
export type Estimate = z.infer<typeof apiContract.estimateSchema>;
export type EstimateResponse = z.infer<typeof apiContract.estimateResponseSchema>;   // { estimate, budgetFit }
export type CoverageCheckRequest = z.infer<typeof apiContract.coverageCheckRequestSchema>;
export type CoverageCheckResponse = z.infer<typeof apiContract.coverageCheckResponseSchema>;
export type ExecutionResponse = z.infer<typeof apiContract.executionResponseSchema>;
export type StartExecutionResponse = z.infer<typeof apiContract.startExecutionResponseSchema>;
export type ResultsResponse = z.infer<typeof apiContract.resultsResponseSchema>;
export type ExecutionSummary = ResultsResponse['executions'][number];
export type CoverageResponse = z.infer<typeof apiContract.coverageResponseSchema>;
export type CalendarGapResponse = z.infer<typeof apiContract.calendarGapResponseSchema>;
export type AirportsResponse = z.infer<typeof apiContract.airportsResponseSchema>;
export type PriceCellData = z.infer<typeof apiContract.priceCellSchema>;
export type UsageRow = z.infer<typeof apiContract.usageSchema>;
export type Basis = ResultBasis;
export type { ResultRow } from '@gmt/core';
```

`src/api/endpoints.ts`:

```ts
import type { CellKey } from '@gmt/core';
import { call } from './client.js';
import type {
  AirportsResponse, Basis, CalendarGapResponse, CoverageCheckRequest, CoverageCheckResponse, CoverageResponse,
  DefinitionRequest, DefinitionResponse, DefinitionUpdate, EstimateResponse, ExecutionResponse, ProvidersResponse,
  ResultsResponse, StartExecutionResponse,
} from './types.js';

/** One typed wrapper per spec §10 route the WP9 views use. Paths are ROUTES templates, checked by findRoute. */
export const api = {
  providers: () => call<ProvidersResponse>('GET', '/api/providers'),
  definitions: () => call<DefinitionResponse[]>('GET', '/api/definitions'),
  estimateDraft: (body: DefinitionRequest) => call<EstimateResponse>('POST', '/api/definitions/estimate', { body }),
  createDefinition: (body: DefinitionRequest) => call<DefinitionResponse>('POST', '/api/definitions', { body }),
  updateDefinition: (id: string, body: DefinitionUpdate) =>
    call<DefinitionResponse>('PUT', '/api/definitions/:id', { params: { id }, body }),
  coverageCheck: (body: CoverageCheckRequest) => call<CoverageCheckResponse>('POST', '/api/definitions/coverage-check', { body }),
  startExecution: (id: string, body: { confirmCostPence?: number }) =>
    call<StartExecutionResponse>('POST', '/api/definitions/:id/executions', { params: { id }, body }),
  execution: (id: string) => call<ExecutionResponse>('GET', '/api/executions/:id', { params: { id } }),
  cancel: (id: string) => call<unknown>('POST', '/api/executions/:id/cancel', { params: { id } }),
  resume: (id: string) => call<unknown>('POST', '/api/executions/:id/resume', { params: { id } }),
  verifyCell: (body: { definitionId: string; cell: CellKey }) => call<StartExecutionResponse>('POST', '/api/cells/verify', { body }),
  results: (id: string, basis: Basis | null) =>
    call<ResultsResponse>('GET', '/api/definitions/:id/results', { params: { id }, query: { basis: basis ?? undefined } }),
  coverage: (id: string) => call<CoverageResponse>('GET', '/api/definitions/:id/coverage', { params: { id } }),
  calendarGap: (id: string) => call<CalendarGapResponse>('GET', '/api/definitions/:id/calendar-gap', { params: { id } }),
  airports: (q: string) => call<AirportsResponse>('GET', '/api/airports', { query: { q } }),
};
```

`src/api/queries.ts`:

```ts
import type { CellKey } from '@gmt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';
import type { Basis } from './types.js';

/** Query keys; prefixes are what mutations invalidate. */
export const qk = {
  providers: ['providers'] as const,
  definitions: ['definitions'] as const,
  results: (id: string, basis: Basis | null) => ['results', id, basis ?? 'default'] as const,
  execution: (id: string) => ['execution', id] as const,
  coverage: (id: string) => ['coverage', id] as const,
  calendarGap: (id: string) => ['calendar-gap', id] as const,
  airports: (q: string) => ['airports', q] as const,
};

/** Statuses the status bar polls while a run is moving (spec §10 "updates during run"). */
const POLLING: ReadonlySet<string> = new Set(['pending', 'running']);

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: () => api.providers() });
}

export function useDefinitions() {
  return useQuery({ queryKey: qk.definitions, queryFn: () => api.definitions() });
}

/** One fetch per (definition, basis); every sort and filter is client-side (spec §6.5). */
export function useResults(definitionId: string | null, basis: Basis | null) {
  return useQuery({
    queryKey: qk.results(definitionId ?? '', basis),
    queryFn: () => api.results(definitionId ?? '', basis),
    enabled: definitionId !== null,
  });
}

export function useExecution(id: string | null) {
  return useQuery({
    queryKey: qk.execution(id ?? ''),
    queryFn: () => api.execution(id ?? ''),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data !== undefined && POLLING.has(query.state.data.status) ? 2_000 : false),
  });
}

/** View D and the status bar's "schedule blocked since" (coverage.scheduleBlockedSince). */
export function useCoverage(definitionId: string | null) {
  return useQuery({ queryKey: qk.coverage(definitionId ?? ''), queryFn: () => api.coverage(definitionId ?? ''), enabled: definitionId !== null });
}

/** Spec §6.9: only fetched when a verification provider is configured. */
export function useCalendarGap(definitionId: string, enabled: boolean) {
  return useQuery({ queryKey: qk.calendarGap(definitionId), queryFn: () => api.calendarGap(definitionId), enabled });
}

/** Airport autocomplete (GET /api/airports?q=); two characters minimum. */
export function useAirportSearch(q: string) {
  return useQuery({ queryKey: qk.airports(q), queryFn: () => api.airports(q), enabled: q.length >= 2, staleTime: 60_000 });
}

/** Cancel, resume, start and single-cell verify, each refreshing every run-dependent query. */
export function useExecutionActions() {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all([['results'], ['execution'], ['coverage'], ['calendar-gap']].map((queryKey) => qc.invalidateQueries({ queryKey })));
  };
  return {
    cancel: useMutation({ mutationFn: (id: string) => api.cancel(id), onSuccess: refresh }),
    resume: useMutation({ mutationFn: (id: string) => api.resume(id), onSuccess: refresh }),
    start: useMutation({
      mutationFn: (v: { id: string; confirmCostPence: number | null }) =>
        api.startExecution(v.id, v.confirmCostPence === null ? {} : { confirmCostPence: v.confirmCostPence }),
      onSuccess: refresh,
    }),
    verify: useMutation({ mutationFn: (v: { definitionId: string; cell: CellKey }) => api.verifyCell(v), onSuccess: refresh }),
  };
}
```

`test/fixtures.ts` (worked example only: LHR, LGW → JFK, EWR; carriers `ZZ` and the hub `BBB` are synthetic codes):

```ts
import { asIata, asIsoDate, asIsoDateTime, asIsoMonth, type Layover, type Provenance } from '@gmt/core';
import type {
  AirportsResponse, CalendarGapResponse, CoverageCheckResponse, CoverageResponse, DefinitionResponse, Estimate,
  ExecutionResponse, ProvidersResponse, ResultRow, ResultsResponse, UsageRow,
} from '../src/api/types.js';

/** Base of every handler URL: the api lives under /api (spec §10). */
export const API = 'http://localhost:3000/api';
const I = asIata;
const D = asIsoDate;
const T = asIsoDateTime;

export const provSearch: Provenance = {
  providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: T('2026-10-14T10:00:00.000Z'),
  maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy',
};
export const provCalendar: Provenance = {
  providerId: 'travelpayouts', sourceKind: 'authorised-cached', fetchedAt: T('2026-10-14T13:00:00.000Z'),
  maxAgeHours: 48, fx: { converted: false }, pointOfSale: 'unknown', cabin: 'economy',
};

export function seg(carrier: string, flight: number, from: string, to: string, depLocal: string, arrLocal: string) {
  return { marketingCarrier: carrier, flightNumber: flight, from: I(from), to: I(to), departLocal: depLocal, arriveLocal: arrLocal };
}

const cell = (o: string, d: string, dep: string, ret: string, nights: number) => ({
  origin: I(o), destination: I(d), departureDate: D(dep), returnDate: D(ret), nights,
});
const hubLayover: Layover = { at: I('BBB'), minutes: 90, overnight: false, airportChange: false };

/** Class-verified itinerary row: one stop out via a synthetic hub, direct back. */
export function verifiedRow(over: Partial<ResultRow> = {}): ResultRow {
  return {
    itineraryHash: 'hash-verified-1', basis: 'verified', verdictClass: 'verified', pricePence: 41200,
    provenance: provSearch, stale: false, ageHours: 5,
    cell: cell('LHR', 'JFK', '2027-03-14', '2027-03-28', 14),
    outbound: [seg('ZZ', 117, 'LHR', 'BBB', '2027-03-14T10:25', '2027-03-14T12:00'), seg('ZZ', 9, 'BBB', 'JFK', '2027-03-14T13:30', '2027-03-14T15:10')],
    inbound: [seg('ZZ', 178, 'JFK', 'LHR', '2027-03-28T19:00', '2027-03-29T07:00')],
    totalMinutes: 1005, outboundMinutes: 525, inboundMinutes: 480, stopsOut: 1, stopsIn: 0, layovers: [hubLayover], carriers: ['ZZ'],
    verdicts: { cabin: 'pass', maxStops: 'pass', maxJourneyMinutes: 'pass', arrivalWindowLocal: 'pass' },
    unverified: [], notApplied: [],
    seller: 'Example Travel', baggage: { cabinBag: 'included', checkedBags: 1 }, fareConditions: { refundable: false, changeable: true }, selfTransfer: false,
    booking: { kind: 'get', url: 'https://www.google.com/travel/clk/f?id=1', host: 'www.google.com' },
    searchLink: { url: 'https://www.google.com/travel/flights?q=LHR.JFK.2027-03-14', host: 'www.google.com', label: 'search link, not a fare link' },
    otherOffers: [], notSeenInLatest: null, adjustedPence: null, destinationNote: null,
    executionId: 'exec-0001', calendarPriceId: null, observationId: 101,
    ...over,
  };
}

/** Class partially-verified, cheaper: shown by default (spec §6.9 hides only `failed` by default). */
export function partialRow(over: Partial<ResultRow> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: 'hash-partial-1', verdictClass: 'partially-verified', pricePence: 38800, observationId: 102,
    cell: cell('LGW', 'EWR', '2027-03-15', '2027-03-27', 12),
    verdicts: { cabin: 'pass', checkedBagRequired: 'unverified' }, unverified: ['checkedBagRequired'],
    ...over,
  });
}

/** Class-failed row carrying all three verdicts, with a POST booking and no baggage or conditions. */
export function failedRow(over: Partial<ResultRow> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: 'hash-failed-1', verdictClass: 'failed', pricePence: 37700, observationId: 103,
    cell: cell('LGW', 'EWR', '2027-03-16', '2027-03-28', 12),
    verdicts: { cabin: 'pass', arrivalWindowLocal: 'fail', checkedBagRequired: 'unverified' },
    unverified: ['checkedBagRequired'],
    booking: { kind: 'post', url: 'https://www.google.com/travel/clk/f', postData: 'u=abc&tfu=xyz', host: 'www.google.com' },
    baggage: null, fareConditions: null, selfTransfer: null,
    ...over,
  });
}

/** Calendar-basis row (spec §6.9): unchecked, no segments, the not-applied note, a search link only. */
export function calendarRow(over: Partial<ResultRow> = {}): ResultRow {
  return {
    itineraryHash: null, basis: 'calendar', verdictClass: 'unchecked', pricePence: 39900,
    provenance: provCalendar, stale: false, ageHours: 50,
    cell: cell('LHR', 'EWR', '2027-04-02', '2027-04-16', 14),
    outbound: null, inbound: null, totalMinutes: null, outboundMinutes: null, inboundMinutes: null, stopsOut: null, stopsIn: null,
    layovers: [], carriers: [], verdicts: {}, unverified: [], notApplied: ['arrivalWindowLocal', 'maxJourneyMinutes', 'maxStops'],
    seller: null, baggage: null, fareConditions: null, selfTransfer: null, booking: { kind: 'none' },
    searchLink: { url: 'https://www.aviasales.com/search/LHR0204EWR16041', host: 'www.aviasales.com', label: 'search link, not a fare link' },
    otherOffers: [], notSeenInLatest: null, adjustedPence: null, destinationNote: 'onward leg not included',
    executionId: 'exec-0001', calendarPriceId: 7, observationId: null,
    ...over,
  };
}

export const summary = (status: ResultsResponse['executions'][number]['status'] = 'completed', ageHours = 2) => ({
  id: 'exec-0001', status, isChild: false, startedAt: T('2026-10-14T12:00:00.000Z'), finishedAt: status === 'completed' ? T('2026-10-14T13:00:00.000Z') : null, ageHours,
});

export function resultsResponse(over: Partial<ResultsResponse> = {}): ResultsResponse {
  const rows = over.rows ?? [verifiedRow(), partialRow()];
  return {
    rows, total: rows.length, truncated: false, basis: 'verified',
    basisReason: 'itinerary-searched observations exist', executions: [summary()],
    coverage: { buckets: { priced: 3, empty: 1, no_data: 2, error: 0, skipped: 0, not_run: 4, reused: 0 }, total: 10, selected: 10, itinerarySearched: 2, onDemand: 1, reused: 0 },
    excludedByCurrentSpace: 0, verificationProviderConfigured: true, cheapest: rows[0] ?? null,
    ...over,
  };
}

export const estimate = (over: Partial<Estimate> = {}): Estimate => ({
  cells: 2184,
  perProvider: [{ providerId: 'travelpayouts', stage: 'discovery', calls: 14, planCalls: 12, costMicroGbp: 0, costPence: 0, seconds: 20, blocked: null }],
  totalCalls: 14, totalPlanCalls: 12, totalCostMicroGbp: 0, totalCostPence: 0, seconds: 20,
  assumptions: ['Travelpayouts month tiles via the shared metro code'], windowClamped: false, retryFactor: 1.2,
  ...over,
});

export function definition(over: Partial<DefinitionResponse> = {}): DefinitionResponse {
  return {
    id: 'def-0001', name: 'London → New York (example)', origins: [I('LHR'), I('LGW')], destinations: [I('JFK'), I('EWR')],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: ['searchapi'], discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', confirmedCostPence: 0, enabled: true,
    createdAt: T('2026-10-14T09:00:00.000Z'), updatedAt: T('2026-10-14T09:00:00.000Z'), deletedAt: null,
    budgetFit: { fits: true, runsPerMonth: 4, perScope: [{ scope: 'provider-month:searchapi', estimated: 615, cap: 10000, fits: true }] },
    estimate: estimate(), needsConfirmation: null, notices: [],
    ...over,
  };
}

export const usage = (scope: string, calls: number, cap: number | null, costMicroGbp = 0, start: string | null = null, end: string | null = null): UsageRow => ({
  scope, calls, costMicroGbp, costPence: Math.ceil(costMicroGbp / 10_000), cap,
  windowStart: start === null ? null : T(start), windowEnd: end === null ? null : T(end),
});

export function providersResponse(over: Partial<ProvidersResponse> = {}): ProvidersResponse {
  return {
    synthetic: false, pointOfSale: 'GB',
    providers: [
      {
        providerId: 'travelpayouts', displayName: 'Travelpayouts', enabled: true, plan: 'free', excludedFromSchedule: false, notices: [],
        capabilities: { discovery: { sourceKind: 'authorised-cached', provenanceNote: 'Aviasales cache of recent user searches', maxAgeHours: 48 }, verification: null },
        usage: [usage('provider-month:travelpayouts', 60, 50000, 0, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')],
      },
      {
        providerId: 'searchapi', displayName: 'SearchApi', enabled: true, plan: '40usd', excludedFromSchedule: false, notices: [],
        capabilities: {
          discovery: { sourceKind: 'scraped-aggregate', provenanceNote: 'Google date grid via SearchApi', maxAgeHours: 24 },
          verification: { sourceKind: 'scraped-search', provenanceNote: 'Google Flights search via SearchApi', maxAgeHours: 0 },
        },
        usage: [usage('provider-month:searchapi', 615, 10000, 0, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')],
      },
    ],
    presets: {
      policy: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true },
      providers: { discovery: ['travelpayouts', 'searchapi'], verification: ['searchapi'], discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      discoveryRefreshHours: 168,
      schedulerTimezone: 'Europe/London',
    },
    ...over,
  };
}

const buckets = (priced: number, empty: number, noData: number, error: number, skipped: number, notRun: number) => ({
  priced, empty, no_data: noData, error, skipped, not_run: notRun, reused: 0,
});

export function execution(over: Partial<ExecutionResponse> = {}): ExecutionResponse {
  return {
    id: 'exec-0001', definitionId: 'def-0001', isChild: false, cell: null, status: 'running', stage: 'discovery', reason: null, resumeAfter: null,
    trigger: 'manual', startedAt: T('2026-10-14T14:00:00.000Z'), finishedAt: null, errorText: null,
    progress: [
      { stage: 'discovery', providerId: 'travelpayouts', buckets: buckets(60, 10, 40, 0, 0, 16), total: 126 },
      { stage: 'verification', providerId: 'searchapi', buckets: buckets(0, 0, 0, 0, 116, 10), total: 126 },
    ],
    budget: [usage('execution-calls', 42, 2000), usage('execution-free-calls', 14, 2000), usage('global-month', 0, 35_000_000, 32_000_000)],
    estimate: estimate(),
    ledger: { calls: 56, costMicroGbp: 0, costPence: 0, tiles: 14, cacheHits: 0, perProvider: [{ providerId: 'travelpayouts', stage: 'discovery', calls: 14, costMicroGbp: 0 }] },
    parityBreak: false, overrun: false, disabledProviders: [],
    ...over,
  };
}

export function coverageResponse(over: Partial<CoverageResponse> = {}): CoverageResponse {
  return {
    executionId: 'exec-0001',
    summary: { buckets: buckets(60, 10, 40, 6, 0, 10), total: 126, selected: 10, itinerarySearched: 8, onDemand: 0, reused: 0 },
    perStage: [
      { stage: 'discovery', providerId: 'travelpayouts', buckets: buckets(60, 10, 40, 6, 0, 10), total: 126, requests: { calls: 14, cacheHits: 0, costMicroGbp: 0, planCalls: 14 }, overrun: false, parityBreak: false },
      { stage: 'verification', providerId: 'searchapi', buckets: buckets(8, 1, 0, 1, 116, 0), total: 126, requests: { calls: 50, cacheHits: 0, costMicroGbp: 0, planCalls: 50 }, overrun: false, parityBreak: false },
    ],
    selectedNotReached: [{ cell: cell('LHR', 'JFK', '2027-03-20', '2027-04-01', 12), reason: 'skipped:budget' }],
    errors: [{ cell: cell('LGW', 'EWR', '2027-03-21', '2027-04-02', 12), stage: 'discovery', providerId: 'travelpayouts', reason: 'rate-limit', lastError: 'HTTP 429', attempts: 3, retryable: true }],
    scheduleBlockedSince: null,
    ...over,
  };
}

export function calendarGap(over: Partial<CalendarGapResponse> = {}): CalendarGapResponse {
  return {
    cheapestVerified: { pricePence: 41200, provenance: provSearch, stale: false, ageHours: 5, cell: cell('LHR', 'JFK', '2027-03-14', '2027-03-28', 14), itineraryHash: 'hash-verified-1' },
    cells: [{ cell: cell('LHR', 'EWR', '2027-04-02', '2027-04-16', 14), calendar: { pricePence: 39900, provenance: provCalendar, stale: false, ageHours: 50 }, verifyAvailable: true }],
    ...over,
  };
}

export const airports: AirportsResponse = [
  { iata: I('LHR'), name: 'Heathrow', city: 'London', country: 'United Kingdom', tz: 'Europe/London', metro: 'LON' },
  { iata: I('LGW'), name: 'Gatwick', city: 'London', country: 'United Kingdom', tz: 'Europe/London', metro: 'LON' },
];

export const coverageCheck: CoverageCheckResponse = {
  pairs: [{ origin: I('LHR'), destination: I('JFK'), months: [{ month: asIsoMonth('2027-03'), cachedRows: 5, cellsInBand: 372 }, { month: asIsoMonth('2027-04'), cachedRows: 0, cellsInBand: 360 }] }],
  calls: 14, notes: [],
};
```

`test/msw/handlers.ts`:

```ts
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { airports, API, calendarGap, coverageCheck, coverageResponse, definition, estimate, execution, providersResponse, resultsResponse } from '../fixtures.js';

/** A valid response body for each mutation the views send, keyed "METHOD /api/path-template". */
const MUTATION_BODIES: Record<string, JsonBodyType> = {
  'POST /api/executions/:id/cancel': execution({ status: 'cancelled' }),
  'POST /api/executions/:id/resume': execution({ status: 'running' }),
  'POST /api/definitions/:id/executions': { executionId: 'exec-0002' },
  'POST /api/cells/verify': { executionId: 'exec-child-1' },
  'POST /api/definitions/estimate': { estimate: estimate(), budgetFit: definition().budgetFit },
  'POST /api/definitions': definition({ id: 'def-0002' }),
  'PUT /api/definitions/:id': definition(),
  'POST /api/definitions/coverage-check': coverageCheck,
};

/** The body a default handler returns for a mutation; tests reuse it when they override a handler. */
export function fixtureFor(method: string, path: string): JsonBodyType {
  const body = MUTATION_BODIES[`${method} ${path}`];
  if (body === undefined) throw new Error(`no fixture body for ${method} ${path}`);
  return body;
}

/** Default API: one definition, both providers, a completed run with two itinerary rows. */
export const handlers = [
  http.get(`${API}/providers`, () => HttpResponse.json(providersResponse())),
  http.get(`${API}/definitions`, () => HttpResponse.json([definition()])),
  http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(resultsResponse())),
  http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'completed', stage: 'verification', finishedAt: definition().updatedAt }))),
  http.get(`${API}/definitions/:id/coverage`, () => HttpResponse.json(coverageResponse())),
  http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap({ cells: [] }))),
  http.get(`${API}/airports`, () => HttpResponse.json(airports)),
  ...Object.keys(MUTATION_BODIES).map((key) => {
    const [method, path] = key.split(' ') as [string, string];
    const verb = method === 'POST' ? http.post : http.put;
    // why: handler URLs are absolute; API already ends in /api, the keys start with it.
    return verb(`${API}${path.slice('/api'.length)}`, () => HttpResponse.json(MUTATION_BODIES[key]));
  }),
];
```

`test/msw/server.ts`:

```ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers.js';

/** The test API. Requests not matched by a handler fail the test (onUnhandledRequest: 'error'). */
export const server = setupServer(...handlers);
```

`test/setup.ts` (add msw lifecycle):

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { server } from './msw/server.js';
import { setViewportWidth } from './viewport.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
// why: Vitest runs without globals, so RTL's automatic cleanup never registers.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
// why: jsdom has no matchMedia; every test starts wide and opts into 375px explicitly.
beforeEach(() => setViewportWidth(1280));
// why: jsdom has no scrollIntoView; the ?row= test spies on this stub.
if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => undefined;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/api/client.test.ts test/components test/copy`
Expected: PASS, 6 + 5 + 8 tests. A failure naming a field in "response does not match core/api-contract" means a fixture differs from the merged WP0 schema: fix the fixture to the schema (never loosen the schema) and note it in the PR.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: typed API client from ROUTES, query hooks, msw test API"
```

### Task 9.4: URL state: view, definition, basis, sort and filters

**Files:**
- Create: `src/state/urlState.ts`, `src/state/view.ts`, `src/state/resultsState.ts`, `src/hooks/useMediaQuery.ts`
- Test: `test/state/resultsState.test.ts`

**Interfaces:**
- Consumes: `SortKey`, `ResultFilters` (plan "Core domain functions"), `VerdictClass`, `ProviderId`, `ConstraintName`, `Iata`.
- Produces: `useSearchParams`, `updateSearchParams`, `hrefWith`, `navigateTo`, `ViewId`, `VIEWS`, `parseView`, `SortDir`, `ResultsUiState`, `parseResultsState`, `resultsStatePatch`, `parseBasis`, `parseSelectedRow`, `setFilter`, `useMediaQuery`, `NARROW_QUERY`.

Decision (spec §11 "filter and sort state persists across views"): **URL search params**. They survive view switches (nav links copy every parameter except `view`), reloads and bookmarks, and need no store library. Keys: `view`, `def`, `basis`, `sort` (`price.asc`; absent = the server's class-then-price ranking), `f.class`, `f.provider`, `f.stops`, `f.carriers`, `f.dest`, `f.maxPrice` (pence), `f.nights` (`10-14`), `f.stale` (`hide`), `f.unverified`, and `row=<resultRowKey>`, which selects, expands and scrolls to one results row (plan "Web"; email links use it, e.g. `/?view=results&def=<id>&row=calendar:7`).

- [ ] **Step 1: Write the failing test**

`test/state/resultsState.test.ts`:

```ts
import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { parseBasis, parseResultsState, parseSelectedRow, resultsStatePatch, setFilter, type ResultsUiState } from '../../src/state/resultsState.js';
import { hrefWith, updateSearchParams } from '../../src/state/urlState.js';
import { parseView } from '../../src/state/view.js';

const full: ResultsUiState = {
  sort: { key: 'totalTime', dir: 'desc' },
  filters: {
    verdictClass: ['verified', 'partially-verified'], providerId: ['searchapi'], maxStops: 1, carriers: ['ZZ', 'YY'],
    destination: [asIata('JFK')], maxPricePence: 50000, nights: { min: 10, max: 14 }, hideStale: true, unverified: ['checkedBagRequired', 'cabin'],
  },
};

function toParams(patch: Record<string, string | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) if (v !== null) p.set(k, v);
  return p;
}

describe('results UI state in the URL (spec §11: filter and sort persist across views)', () => {
  it('round-trips every filter and the sort', () => {
    expect(parseResultsState(toParams(resultsStatePatch(full)))).toEqual(full);
  });

  it('no sort param means the server ranking (class then price, spec §6.5)', () => {
    expect(parseResultsState(new URLSearchParams()).sort).toBeNull();
    expect(resultsStatePatch({ sort: null, filters: {} }).sort).toBeNull();
  });

  it('ignores malformed values instead of guessing', () => {
    const s = parseResultsState(new URLSearchParams('sort=bogus.up&f.class=verified,nope&f.stops=-1&f.nights=14-10x&f.provider=amadeus'));
    expect(s).toEqual({ sort: null, filters: { verdictClass: ['verified'] } });
  });

  it('setFilter adds and removes keys without leaving undefined behind', () => {
    const a = setFilter({}, 'maxStops', 0);
    expect(a).toEqual({ maxStops: 0 });
    expect(Object.keys(setFilter(a, 'maxStops', undefined))).toEqual([]);
  });

  it('parses basis and view strictly', () => {
    expect(parseBasis('calendar')).toBe('calendar');
    expect(parseBasis('verified')).toBe('verified');
    expect(parseBasis('live')).toBeNull();
    expect(parseView('coverage')).toBe('coverage');
    expect(parseView(null)).toBe('results');
    expect(parseView('nope')).toBe('results');
  });

  it('row= selects a results row by resultRowKey (email links)', () => {
    expect(parseSelectedRow(new URLSearchParams('row=hash-verified-1'))).toBe('hash-verified-1');
    expect(parseSelectedRow(new URLSearchParams('row=calendar%3A7'))).toBe('calendar:7');
    expect(parseSelectedRow(new URLSearchParams('row='))).toBeNull();
    expect(parseSelectedRow(new URLSearchParams(''))).toBeNull();
    expect(parseSelectedRow(new URLSearchParams(`row=${'x'.repeat(300)}`))).toBeNull();
  });

  it('nav hrefs keep filters and sort when the view changes', () => {
    window.history.replaceState(null, '', '/?view=results&def=d1&sort=price.asc&f.stops=1');
    expect(hrefWith({ view: 'coverage' })).toBe('/?view=coverage&def=d1&sort=price.asc&f.stops=1');
    updateSearchParams({ view: 'coverage' }, 'push');
    expect(window.location.search).toBe('?view=coverage&def=d1&sort=price.asc&f.stops=1');
    updateSearchParams({ view: 'results' }, 'push');
    expect(parseResultsState(new URLSearchParams(window.location.search)).filters).toEqual({ maxStops: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/state/resultsState.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/state/resultsState.js"`.

- [ ] **Step 3: Implement**

`src/state/urlState.ts`:

```ts
import { type MouseEvent, useMemo, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const getSnapshot = () => window.location.search;

/** The current search params; re-renders on every updateSearchParams and on back/forward. */
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => new URLSearchParams(search), [search]);
}

function merged(patch: Record<string, string | null>): string {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  return `${window.location.pathname}?${p.toString()}`;
}

/** The href for the current URL with `patch` applied (null deletes); every other parameter is kept. */
export function hrefWith(patch: Record<string, string | null>): string {
  return merged(patch);
}

/** Applies `patch` to the URL: `push` for navigation, `replace` for filter edits. */
export function updateSearchParams(patch: Record<string, string | null>, mode: 'push' | 'replace' = 'replace'): void {
  const url = merged(patch);
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  for (const l of listeners) l();
}

/** onClick for an <a href={hrefWith(patch)}>: client-side navigation that keeps the link a real link. */
export function navigateTo(patch: Record<string, string | null>) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    updateSearchParams(patch, 'push');
  };
}
```

`src/state/view.ts`:

```ts
/** Every view of spec §11; WP9 owns the nav for all of them. */
export type ViewId = 'results' | 'calendar' | 'duration' | 'history' | 'coverage' | 'definitions' | 'alerts' | 'providers';
export const VIEWS: readonly ViewId[] = ['results', 'calendar', 'duration', 'history', 'coverage', 'definitions', 'alerts', 'providers'];

export function parseView(v: string | null): ViewId {
  return (VIEWS as readonly string[]).includes(v ?? '') ? (v as ViewId) : 'results';
}
```

`src/state/resultsState.ts`:

```ts
import type { ConstraintName, Iata, ProviderId, ResultFilters, SortKey, VerdictClass } from '@gmt/core';
import type { Basis } from '../api/types.js';

/** sortRows's direction parameter (plan "Core domain functions": `dir: 'asc' | 'desc'`). */
export type SortDir = 'asc' | 'desc';

/** View A state held in the URL (spec §11). `sort: null` keeps the server's class-then-price order. */
export interface ResultsUiState {
  sort: { key: SortKey; dir: SortDir } | null;
  filters: ResultFilters;
}

export const SORT_KEYS: readonly SortKey[] = ['price', 'totalTime', 'departure', 'return', 'nights', 'stops', 'adjusted'];
const CLASSES: ReadonlyArray<VerdictClass | 'unchecked'> = ['verified', 'partially-verified', 'failed', 'unchecked'];
const PROVIDERS: readonly ProviderId[] = ['travelpayouts', 'searchapi', 'fixture'];
const CONSTRAINTS: readonly ConstraintName[] = [
  'cabin', 'maxStops', 'maxJourneyMinutes', 'minLayoverMinutes', 'maxLayoverMinutes', 'noOvernightLayover', 'departureWindowLocal',
  'arrivalWindowLocal', 'noSelfTransfer', 'noAirportChange', 'includeAirlines', 'excludeAirlines', 'cabinBagRequired',
  'checkedBagRequired', 'minCheckedBags', 'maxPricePence',
];

const oneOf =
  <T extends string>(set: readonly T[]) =>
  (v: string): v is T =>
    (set as readonly string[]).includes(v);
const list = (v: string | null): string[] => (v ? v.split(',').filter((s) => s.length > 0) : []);
const int = (v: string | null): number | undefined => (v !== null && /^\d+$/.test(v) ? Number(v) : undefined);
const IATA = /^[A-Z]{3}$/;
const CARRIER = /^[A-Z0-9]{2}$/;

/** Returns a copy with `key` set, or removed when `value` is undefined (exactOptionalPropertyTypes-safe). */
export function setFilter<K extends keyof ResultFilters>(f: ResultFilters, key: K, value: ResultFilters[K] | undefined): ResultFilters {
  const next: ResultFilters = { ...f };
  if (value === undefined) delete next[key];
  else Object.assign(next, { [key]: value });
  return next;
}

export function parseBasis(v: string | null): Basis | null {
  return v === 'verified' || v === 'calendar' ? v : null;
}

/** `row=<resultRowKey>` (plan "Web"): the row an email link points at; bounded so a pasted URL cannot be huge. */
export function parseSelectedRow(p: URLSearchParams): string | null {
  const v = p.get('row');
  return v !== null && v.length > 0 && v.length <= 200 ? v : null;
}

/** Strict parse: malformed tokens are dropped, never coerced. */
export function parseResultsState(p: URLSearchParams): ResultsUiState {
  const rawSort = p.get('sort');
  let sort: ResultsUiState['sort'] = null;
  if (rawSort !== null) {
    const [k, d] = rawSort.split('.');
    if (k !== undefined && oneOf(SORT_KEYS)(k) && (d === 'asc' || d === 'desc')) sort = { key: k, dir: d };
  }
  let f: ResultFilters = {};
  const classes = list(p.get('f.class')).filter(oneOf(CLASSES));
  if (classes.length > 0) f = setFilter(f, 'verdictClass', classes);
  const providers = list(p.get('f.provider')).filter(oneOf(PROVIDERS));
  if (providers.length > 0) f = setFilter(f, 'providerId', providers);
  f = setFilter(f, 'maxStops', int(p.get('f.stops')));
  const carriers = list(p.get('f.carriers')).filter((c) => CARRIER.test(c));
  if (carriers.length > 0) f = setFilter(f, 'carriers', carriers);
  // why: the URL is operator-editable; only well-formed codes become the branded Iata the filter takes.
  const dests = list(p.get('f.dest')).filter((c) => IATA.test(c)) as Iata[];
  if (dests.length > 0) f = setFilter(f, 'destination', dests);
  f = setFilter(f, 'maxPricePence', int(p.get('f.maxPrice')));
  const nights = /^(\d+)-(\d+)$/.exec(p.get('f.nights') ?? '');
  if (nights?.[1] !== undefined && nights[2] !== undefined && Number(nights[1]) <= Number(nights[2])) {
    f = setFilter(f, 'nights', { min: Number(nights[1]), max: Number(nights[2]) });
  }
  if (p.get('f.stale') === 'hide') f = setFilter(f, 'hideStale', true);
  const unverified = list(p.get('f.unverified')).filter(oneOf(CONSTRAINTS));
  if (unverified.length > 0) f = setFilter(f, 'unverified', unverified);
  return { sort, filters: f };
}

const joined = (xs: readonly string[] | undefined): string | null => (xs && xs.length > 0 ? xs.join(',') : null);
const num = (n: number | undefined): string | null => (n === undefined ? null : String(n));

/** The URL patch for a state; null removes the parameter. */
export function resultsStatePatch(s: ResultsUiState): Record<string, string | null> {
  const f = s.filters;
  return {
    sort: s.sort === null ? null : `${s.sort.key}.${s.sort.dir}`,
    'f.class': joined(f.verdictClass),
    'f.provider': joined(f.providerId),
    'f.stops': num(f.maxStops),
    'f.carriers': joined(f.carriers),
    'f.dest': joined(f.destination),
    'f.maxPrice': num(f.maxPricePence),
    'f.nights': f.nights === undefined ? null : `${f.nights.min}-${f.nights.max}`,
    'f.stale': f.hideStale === true ? 'hide' : null,
    'f.unverified': joined(f.unverified),
  };
}
```

`src/hooks/useMediaQuery.ts`:

```ts
import { useSyncExternalStore } from 'react';

/** Spec §11: below this width the primary row keeps price, provenance, class badge, dates and stops. */
export const NARROW_QUERY = '(max-width: 639px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/state/resultsState.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: URL-held view, basis, sort and filter state"
```

### Task 9.5: Shell: nav, definition selector, synthetic banner, empty state, placeholders

**Files:**
- Create: `src/main.tsx`, `src/App.tsx`, `src/components/Nav.tsx`, `src/components/DefinitionSelector.tsx`, `src/components/SyntheticBanner.tsx`, `src/views/Placeholder.tsx`
- Test: `test/app/shell.test.tsx`

**Interfaces:**
- Consumes: `useProviders`, `useDefinitions` (Task 9.3); URL state (Task 9.4).
- Produces: `App`, `Nav`, `DefinitionSelector`, `SyntheticBanner`, `Placeholder`. `App` renders `ResultsView`, `CoverageView`, `ProvidersView`, `DefinitionsView` once Tasks 9.7–9.13 land; this task wires the placeholders for those four as `Placeholder` with `wp="WP9"` and each later task swaps in its view (the only temporary placeholder text, removed by Task 9.13; the source of truth for the final `App.tsx` is the block in Task 9.13).

- [ ] **Step 1: Write the failing test**

`test/app/shell.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { API, definition, providersResponse } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

describe('shell (spec §11 layout)', () => {
  it('nav lists every view and keeps filters when switching', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001&f.stops=1' });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    for (const name of ['Results', 'Calendar', 'Duration', 'History', 'Coverage', 'Definitions', 'Alerts', 'Providers']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    await user.click(within(nav).getByRole('link', { name: 'Calendar' }));
    expect(window.location.search).toBe('?view=calendar&def=def-0001&f.stops=1');
    expect(await screen.findByText('This view is coming in WP10.')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  });

  it('Duration and History are WP10 placeholders', async () => {
    renderWithProviders(<App />, { search: '?view=duration' });
    expect(await screen.findByText('This view is coming in WP10.')).toBeInTheDocument();
  });

  it('definition selector lists definitions and writes def= to the URL', async () => {
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json([definition(), definition({ id: 'def-0002', name: 'Second example' })])));
    const { user } = renderWithProviders(<App />, { search: '?view=calendar' });
    const select = await screen.findByLabelText('Search definition');
    await screen.findByRole('option', { name: 'Second example' });
    await user.selectOptions(select, 'def-0002');
    expect(new URLSearchParams(window.location.search).get('def')).toBe('def-0002');
  });

  it('red synthetic banner is present when the providers response says synthetic (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=calendar' });
    const banner = await screen.findByText(/Synthetic data: the fixture provider is enabled/);
    expect(banner.closest('[role="alert"]')?.className).toContain('bg-red-700');
  });

  it('negative: no synthetic banner for real data', async () => {
    renderWithProviders(<App />, { search: '?view=calendar' });
    await screen.findByRole('navigation', { name: 'Views' });
    await screen.findByLabelText('Search definition');
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
  });

  it('empty state when no provider is configured', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(providersResponse({ providers: providersResponse().providers.map((p) => ({ ...p, enabled: false })) })),
      ),
    );
    renderWithProviders(<App />, { search: '?view=calendar' });
    expect(await screen.findByText(/No flight data provider is configured/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/app/shell.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/App.js"`.

- [ ] **Step 3: Implement**

`src/components/Nav.tsx`:

```tsx
import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { VIEWS, type ViewId } from '../state/view.js';

/** Spec §11: nav for all views, owned by WP9. Links are real links, so they work with the keyboard and new tabs. */
export function Nav({ current }: { current: ViewId }) {
  return (
    <nav aria-label={COPY.navLabel}>
      <ul className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <li key={v}>
            <a
              href={hrefWith({ view: v })}
              onClick={navigateTo({ view: v })}
              aria-current={v === current ? 'page' : undefined}
              className={`rounded px-2 py-1 text-sm ${v === current ? 'bg-slate-900 text-white' : 'text-slate-800 underline'}`}
            >
              {COPY.nav[v]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`src/components/DefinitionSelector.tsx`:

```tsx
import type { DefinitionResponse } from '../api/types.js';
import { COPY } from '../copy.js';
import { updateSearchParams } from '../state/urlState.js';

export function DefinitionSelector({ definitions, selectedId }: { definitions: readonly DefinitionResponse[]; selectedId: string | null }) {
  if (definitions.length === 0) return <p className="text-sm">{COPY.noDefinitions}</p>;
  return (
    <span className="flex items-center gap-2 text-sm">
      <label htmlFor="definition-select">{COPY.definitionSelectorLabel}</label>
      <select
        id="definition-select"
        value={selectedId ?? ''}
        onChange={(e) => updateSearchParams({ def: e.target.value }, 'push')}
        className="rounded border border-slate-400 px-1"
      >
        {definitions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </span>
  );
}
```

`src/components/SyntheticBanner.tsx`:

```tsx
import { COPY } from '../copy.js';

/** Spec §5.5: red, on every view, driven only by `synthetic` from /providers. */
export function SyntheticBanner() {
  return (
    <div role="alert" className="bg-red-700 px-4 py-2 font-semibold text-white">
      {COPY.syntheticBanner}
    </div>
  );
}
```

`src/views/Placeholder.tsx`:

```tsx
import { COPY } from '../copy.js';

/** Temporary route body for a view another work package owns (WP10: Calendar, Duration, History; WP11: Alerts). */
export function Placeholder({ wp }: { wp: string }) {
  return <p className="p-4 text-slate-700">{COPY.placeholder(wp)}</p>;
}
```

`src/App.tsx` (this task's version; Task 9.13 gives the final one):

```tsx
import { useDefinitions, useProviders } from './api/queries.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { Nav } from './components/Nav.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { useSearchParams } from './state/urlState.js';
import { parseView } from './state/view.js';
import { Placeholder } from './views/Placeholder.js';

export function App() {
  const params = useSearchParams();
  const view = parseView(params.get('view'));
  const providers = useProviders();
  const definitions = useDefinitions();
  const list = definitions.data ?? [];
  const selectedId = params.get('def') ?? list[0]?.id ?? null;
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-300 px-4 py-2">
        <h1 className="text-lg font-bold">{COPY.appTitle}</h1>
        <Nav current={view} />
        <DefinitionSelector definitions={list} selectedId={selectedId} />
      </header>
      <main className="px-4 py-3">
        {noProviders ? <p className="mb-3 rounded border border-slate-400 p-3">{COPY.emptyNoProviders}</p> : null}
        {view === 'calendar' || view === 'duration' || view === 'history' ? <Placeholder wp="WP10" /> : null}
        {view === 'alerts' ? <Placeholder wp="WP11" /> : null}
        {view === 'results' || view === 'coverage' || view === 'definitions' || view === 'providers' ? <Placeholder wp="WP9" /> : null}
      </main>
    </div>
  );
}
```

`src/main.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/app/shell.test.tsx test/copy`
Expected: PASS, 6 + 8 tests (the source guard now scans the new `.tsx` files).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: shell with nav, definition selector, synthetic banner, empty state"
```

### Task 9.6: Status bar and per-view header

**Files:**
- Create: `src/components/StatusBar.tsx`, `src/components/ViewHeader.tsx`
- Test: `test/components/statusBar.test.tsx`

**Interfaces:**
- Consumes: `useResults`, `useExecution`, `useCoverage`, `useExecutionActions` (Task 9.3); `ACTIVE_STATUSES`, `formatDuration` (WP0); `coverageResponse.scheduleBlockedSince`, newest-first `executions`, flat `Usage` rows with scope labels (`execution-calls`, `global-month`, `provider-month:<id>`).
- Produces: `StatusBar({ definition })`, `ViewHeader({ title, executions, stale })`.

- [ ] **Step 1: Write the failing test**

`test/components/statusBar.test.tsx`:

```tsx
import { asIsoDateTime } from '@gmt/core';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { StatusBar } from '../../src/components/StatusBar.js';
import { ViewHeader } from '../../src/components/ViewHeader.js';
import { API, coverageResponse, definition, execution, resultsResponse } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

describe('status bar (spec §11)', () => {
  it('shows stage, progress per stage, and spend used / cap for the run and the month', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(<StatusBar definition={definition()} />);
    expect(await screen.findByText('running')).toBeInTheDocument();
    expect(screen.getByText('discovery: 110 of 126 cells')).toBeInTheDocument();
    expect(screen.getByText('itinerary search: 116 of 126 cells')).toBeInTheDocument();
    expect(screen.getByText('this run: 42 of 2000 billed calls')).toBeInTheDocument();
    expect(screen.getByText('this run: 14 of 2000 free calls')).toBeInTheDocument();
    expect(screen.getByText('this month: £32 of £35')).toBeInTheDocument();
  });

  it('Cancel posts to /executions/:id/cancel with the CSRF header', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
      http.post(`${API}/executions/:id/cancel`, ({ request, params }) => {
        seen.push(`${String(params.id)} ${request.headers.get('x-requested-with')}`);
        return HttpResponse.json(execution({ status: 'cancelled' }));
      }),
    );
    const { user } = renderWithProviders(<StatusBar definition={definition()} />);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect.poll(() => seen).toEqual(['exec-0001 get-me-there']);
  });

  it('paused: shows the reason and Resume posts /resume', async () => {
    let resumed = 0;
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'paused_budget', reason: 'searchapi provider-month cap reached' }))),
      http.post(`${API}/executions/:id/resume`, () => {
        resumed += 1;
        return HttpResponse.json(execution());
      }),
    );
    const { user } = renderWithProviders(<StatusBar definition={definition()} />);
    expect(await screen.findByText('Paused: searchapi provider-month cap reached')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await expect.poll(() => resumed).toBe(1);
  });

  it('shows "schedule blocked since <date>" from coverage.scheduleBlockedSince', async () => {
    server.use(http.get(`${API}/definitions/:id/coverage`, () => HttpResponse.json(coverageResponse({ scheduleBlockedSince: asIsoDateTime('2026-10-12T05:00:00.000Z') }))));
    renderWithProviders(<StatusBar definition={definition()} />);
    expect(await screen.findByText('schedule blocked since 12 Oct 2026')).toBeInTheDocument();
  });

  it('no run yet: Run now posts the stored confirmation', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(resultsResponse({ rows: [], total: 0, executions: [] }))),
      http.post(`${API}/definitions/:id/executions`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-0002' });
      }),
    );
    const { user } = renderWithProviders(<StatusBar definition={definition({ confirmedCostPence: 0 })} />);
    expect(await screen.findByText('No run yet for this definition.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    await expect.poll(() => bodies).toEqual([{ confirmCostPence: 0 }]);
  });
});

describe('view header (spec §11)', () => {
  it('names the executions shown with status and age, and banners a run that is not completed', () => {
    renderWithProviders(
      <ViewHeader title="Results" stale executions={[{ id: 'exec-0001-abcdef', status: 'running', ageHours: 0 }, { id: 'exec-0000', status: 'completed', ageHours: 170 }]} />,
    );
    expect(screen.getByText('showing run exec-000 (running, just now), run exec-000 (completed, 7d ago)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The latest run is running; these results may be partial.');
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('no banner when the latest run completed', () => {
    renderWithProviders(<ViewHeader title="Results" stale={false} executions={[{ id: 'exec-0001', status: 'completed', ageHours: 2 }]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/components/statusBar.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/components/StatusBar.js"`.

- [ ] **Step 3: Implement**

`src/components/StatusBar.tsx`:

```tsx
import { ACTIVE_STATUSES } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useCoverage, useExecution, useExecutionActions, useResults } from '../api/queries.js';
import type { DefinitionResponse, ExecutionResponse, UsageRow } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatIsoDate, formatMicroGbp } from '../format.js';
import { parseBasis } from '../state/resultsState.js';
import { useSearchParams } from '../state/urlState.js';

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_STATUSES);

/** Cells done (any outcome but not_run) over cells, per stage, summed across providers. */
function stageTotals(e: ExecutionResponse): Array<{ stage: string; done: number; total: number }> {
  const by = new Map<string, { done: number; total: number }>();
  for (const p of e.progress) {
    const cur = by.get(p.stage) ?? { done: 0, total: 0 };
    cur.done += p.total - p.buckets.not_run;
    cur.total += p.total;
    by.set(p.stage, cur);
  }
  return [...by.entries()].map(([stage, v]) => ({ stage, ...v }));
}

/** Usage rows carry WP8's scope label (`execution-calls`, `global-month`, `provider-month:searchapi`). */
function usageOf(e: ExecutionResponse, label: string): UsageRow | null {
  return e.budget.find((u) => u.scope === label) ?? null;
}

const capText = (cap: number | null, fmt: (n: number) => string): string => (cap === null ? COPY.noCap : fmt(cap));

/** Spec §11 status bar, on every view: stage, progress, spend, paused reason + Resume, blocked schedule, Cancel. */
export function StatusBar({ definition }: { definition: DefinitionResponse | null }) {
  const params = useSearchParams();
  const results = useResults(definition?.id ?? null, parseBasis(params.get('basis')));
  // why: execution lists are newest first (plan "API contract"), so [0] is the run the status bar follows.
  const latestId = results.data?.executions[0]?.id ?? null;
  const execution = useExecution(latestId);
  const coverage = useCoverage(definition?.id ?? null);
  const actions = useExecutionActions();
  const qc = useQueryClient();

  // why: when a polled run changes status, the rows and coverage it produced change too.
  const status = execution.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== status) {
      void qc.invalidateQueries({ queryKey: ['results'] });
      void qc.invalidateQueries({ queryKey: ['coverage'] });
    }
    previous.current = status;
  }, [status, qc]);

  if (definition === null) return null;
  const blockedSince = coverage.data?.scheduleBlockedSince ?? null;
  const e = execution.data;
  const failure = actions.cancel.error ?? actions.resume.error ?? actions.start.error;
  const runCalls = e ? usageOf(e, 'execution-calls') : null;
  const freeCalls = e ? usageOf(e, 'execution-free-calls') : null;
  const runCost = e ? usageOf(e, 'execution-cost') : null;
  const month = e ? usageOf(e, 'global-month') : null;

  return (
    <section aria-label={COPY.statusBarLabel} className="flex flex-wrap items-center gap-3 border-b border-slate-300 bg-slate-50 px-4 py-2 text-sm">
      {e === undefined ? (
        <span>{results.data !== undefined && latestId === null ? COPY.noExecution : COPY.loading}</span>
      ) : (
        <>
          <span className="font-semibold">{COPY.statusName[e.status]}</span>
          {e.stage !== null ? <span>{COPY.stageName[e.stage] ?? e.stage}</span> : null}
          {stageTotals(e).map((s) => (
            <span key={s.stage}>{COPY.progress(COPY.stageName[s.stage] ?? s.stage, s.done, s.total)}</span>
          ))}
          {runCalls ? <span>{COPY.spendRunCalls(runCalls.calls, capText(runCalls.cap, String))}</span> : null}
          {freeCalls ? <span>{COPY.spendRunFreeCalls(freeCalls.calls, capText(freeCalls.cap, String))}</span> : null}
          {runCost ? <span>{COPY.spendRunCost(formatMicroGbp(runCost.costMicroGbp), capText(runCost.cap, formatMicroGbp))}</span> : null}
          {month ? <span>{COPY.spendMonth(formatMicroGbp(month.costMicroGbp), capText(month.cap, formatMicroGbp))}</span> : null}
        </>
      )}
      {blockedSince !== null ? <span className="font-medium">{COPY.scheduleBlocked(formatIsoDate(blockedSince.slice(0, 10)))}</span> : null}
      {e && (e.status === 'paused_budget' || e.status === 'paused_error') ? (
        <>
          <span className="font-medium">{COPY.paused(e.reason ?? COPY.statusName[e.status])}</span>
          <button type="button" className="rounded border border-slate-500 px-2" onClick={() => actions.resume.mutate(e.id)}>
            {COPY.resume}
          </button>
        </>
      ) : null}
      {e && ACTIVE.has(e.status) ? (
        <button type="button" className="rounded border border-slate-500 px-2" onClick={() => actions.cancel.mutate(e.id)}>
          {COPY.cancel}
        </button>
      ) : results.data !== undefined ? (
        <button
          type="button"
          className="rounded border border-slate-500 px-2"
          onClick={() => actions.start.mutate({ id: definition.id, confirmCostPence: definition.confirmedCostPence })}
        >
          {COPY.runNow}
        </button>
      ) : null}
      {failure ? <span role="alert" className="text-red-800">{COPY.actionFailed(failure.message)}</span> : null}
    </section>
  );
}
```

`src/components/ViewHeader.tsx`:

```tsx
import { type ExecutionStatus, formatDuration } from '@gmt/core';
import { COPY } from '../copy.js';

export interface ViewHeaderProps {
  title: string;
  /** ExecutionSummary rows, newest first (plan "API contract"). */
  executions: ReadonlyArray<{ id: string; status: ExecutionStatus; ageHours: number }>;
  stale: boolean;
}

/** Spec §11: every view header names the executions shown, their status and age, a stale label, and a banner when not completed. */
export function ViewHeader({ title, executions, stale }: ViewHeaderProps) {
  const latest = executions[0];
  const list = executions
    .map((e) => COPY.executionItem(e.id.slice(0, 8), COPY.statusName[e.status], COPY.ago(formatDuration(e.ageHours))))
    .join(', ');
  return (
    <div className="mb-2 space-y-1">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-slate-700">{executions.length === 0 ? COPY.noExecution : COPY.executionsShown(list)}</p>
      {stale ? (
        <p className="text-sm">
          <span className="mr-1 rounded bg-amber-200 px-1">{COPY.stale}</span>
          {COPY.staleView}
        </p>
      ) : null}
      {latest !== undefined && latest.status !== 'completed' ? (
        <p role="status" className="rounded bg-amber-100 px-2 py-1 text-sm">
          {COPY.notCompletedBanner(COPY.statusName[latest.status])}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/components/statusBar.test.tsx test/copy`
Expected: PASS, 7 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: status bar and per-view header"
```

### Task 9.7: Expanded row: segments, layovers, baggage, conditions, verdicts, booking and search links

**Files:**
- Create: `src/components/ClassBadge.tsx`, `src/components/VerdictList.tsx`, `src/components/BookingAction.tsx`, `src/views/Results/ExpandedRow.tsx`
- Test: `test/views/results/expanded.test.tsx`

**Interfaces:**
- Consumes: `ResultRow` (with `layovers`, `seller`, `baggage`, `fareConditions`, `selfTransfer`), `Booking`, `Verdicts`, `effectiveAge`, `formatDuration`; `PriceCell`, `PriceBoundary` (Task 9.1); `useExecutionActions` (Task 9.3).
- Produces: `ClassBadge({ cls })`, `VerdictList({ verdicts })`, `BookingAction({ booking })`, `SearchLink({ link })`, `safeHttpsUrl(url, host)`, `ExpandedRow({ row, extras, verificationConfigured, definitionId })`.

- [ ] **Step 1: Write the failing test**

`test/views/results/expanded.test.tsx`:

```tsx
import { asIata, CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingAction, safeHttpsUrl } from '../../../src/components/BookingAction.js';
import { ExpandedRow } from '../../../src/views/Results/ExpandedRow.js';
import { API, calendarRow, failedRow, verifiedRow } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

afterEach(() => vi.restoreAllMocks());

const render = (row: Parameters<typeof ExpandedRow>[0]['row'], verificationConfigured = true) =>
  renderWithProviders(<ExpandedRow row={row} extras={false} verificationConfigured={verificationConfigured} definitionId="def-0001" />);

describe('verdicts: distinct text and ARIA for pass / fail / unverified (spec §9 item 6)', () => {
  it('each verdict has its own glyph, word and accessible name', () => {
    render(failedRow());
    const list = screen.getByRole('list', { name: 'Constraint verdicts' });
    const items = within(list).getAllByRole('listitem');
    const L = CONSTRAINT_LABELS;
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([`${L.cabin}: pass`, `${L.arrivalWindowLocal}: fail`, `${L.checkedBagRequired}: unverified`]);
    expect(items.map((i) => i.textContent)).toEqual([`✓ ${L.cabin}: pass`, `✗ ${L.arrivalWindowLocal}: fail`, `? ${L.checkedBagRequired}: unverified`]);
    expect(new Set(items.map((i) => i.className)).size).toBe(3);
  });
});

describe('booking links (spec §5.2, §9 item 6)', () => {
  it('GET: a new-tab link with rel="noopener noreferrer" and the host shown', () => {
    render(verifiedRow());
    const link = screen.getByRole('link', { name: 'open on www.google.com' });
    expect(link).toHaveAttribute('href', 'https://www.google.com/travel/clk/f?id=1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('POST: a form button carrying postData, never submitted on render', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(failedRow());
    const button = screen.getByRole('button', { name: 'continue on www.google.com (sends a form)' });
    const form = button.closest('form');
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', 'https://www.google.com/travel/clk/f');
    expect(form).toHaveAttribute('rel', 'noopener noreferrer');
    expect(form).toHaveAttribute('target', '_blank');
    const hidden = [...(form?.querySelectorAll('input[type="hidden"]') ?? [])].map((i) => `${i.getAttribute('name')}=${i.getAttribute('value')}`);
    expect(hidden).toEqual(['u=abc', 'tfu=xyz']);
    expect(submit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('none: "no link", plus the labelled search link with its host', () => {
    render(calendarRow());
    expect(screen.getByText('no link')).toBeInTheDocument();
    const search = screen.getByRole('link', { name: 'search link, not a fare link' });
    expect(search).toHaveAttribute('rel', 'noopener noreferrer');
    expect(search).toHaveAttribute('href', 'https://www.aviasales.com/search/LHR0204EWR16041');
    expect(screen.getByText('(www.aviasales.com)')).toBeInTheDocument();
  });

  it('a synthetic row has no search link and says so', () => {
    render(calendarRow({ searchLink: null }));
    expect(screen.getByText('no search link')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'search link, not a fare link' })).toBeNull();
  });

  it('a non-https URL, userinfo, or a host that disagrees with the stated host renders "no link"', () => {
    expect(safeHttpsUrl('http://www.google.com/x', 'www.google.com')).toBeNull();
    expect(safeHttpsUrl('https://u:p@www.google.com/x', 'www.google.com')).toBeNull();
    expect(safeHttpsUrl('https://evil.example/x', 'www.google.com')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)', 'www.google.com')).toBeNull();
    renderWithProviders(<BookingAction booking={{ kind: 'get', url: 'https://evil.example/x', host: 'www.google.com' }} />);
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('itinerary detail (spec §11 expanded row)', () => {
  it('segments, layovers, baggage and conditions', () => {
    render(verifiedRow());
    expect(screen.getByText('ZZ 117 LHR 14 Mar 10:25 → BBB 14 Mar 12:00')).toBeInTheDocument();
    expect(screen.getByText('ZZ 178 JFK 28 Mar 19:00 → LHR 29 Mar 07:00')).toBeInTheDocument();
    expect(screen.getByText('BBB: 1h 30m')).toBeInTheDocument();
    expect(screen.getByText('cabin bag included')).toBeInTheDocument();
    expect(screen.getByText('1 checked bag')).toBeInTheDocument();
    expect(screen.getByText('not refundable')).toBeInTheDocument();
    expect(screen.getByText('changeable')).toBeInTheDocument();
    expect(screen.getByText('sold by Example Travel')).toBeInTheDocument();
  });

  it('an overnight layover and a self-transfer are named', () => {
    render(verifiedRow({ layovers: [{ at: asIata('BBB'), minutes: 540, overnight: true, airportChange: false }], selfTransfer: true }));
    expect(screen.getByText('BBB: 9h 00m')).toBeInTheDocument();
    expect(screen.getByText('overnight')).toBeInTheDocument();
    expect(screen.getByText('self-transfer: you re-check bags and the airlines do not protect the connection')).toBeInTheDocument();
  });

  it('missing baggage and conditions say "not stated", never a default', () => {
    render(failedRow());
    expect(screen.getByText('cabin bag not stated')).toBeInTheDocument();
    expect(screen.getByText('checked bags not stated')).toBeInTheDocument();
    expect(screen.getByText('refunds not stated')).toBeInTheDocument();
  });

  it('marks a row not seen in the latest search', () => {
    render(verifiedRow({ notSeenInLatest: { ageHours: 72 } }));
    expect(screen.getByText('not seen in latest search (3d ago)')).toBeInTheDocument();
  });

  it('other sellers render through the provenance-checked price', () => {
    render(
      verifiedRow({
        otherOffers: [
          { seller: 'Second Seller', pricePence: 42000, provenance: verifiedRow().provenance, booking: { kind: 'none' }, stale: false, ageHours: 5, verdictClass: 'partially-verified', unverified: ['checkedBagRequired'] },
        ],
      }),
    );
    const others = screen.getByRole('region', { name: 'Other sellers for this itinerary' });
    expect(within(others).getByText('£420')).toBeInTheDocument();
    expect(within(others).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(others).getByTestId('class-badge')).toHaveTextContent('partially verified');
    expect(within(others).getByText(`unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`)).toBeInTheDocument();
  });
});

describe('calendar rows (spec §6.9)', () => {
  it('say there is no itinerary and name the constraints not applied', () => {
    render(calendarRow());
    expect(screen.getAllByText('calendar price, no itinerary')).toHaveLength(2);
    const L = CONSTRAINT_LABELS;
    expect(screen.getByText(`not applied: ${L.arrivalWindowLocal}, ${L.maxJourneyMinutes}, ${L.maxStops}`)).toBeInTheDocument();
  });

  it('per-cell verify is offered only with a verification provider, and posts the cell', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/cells/verify`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user, unmount } = render(calendarRow());
    await user.click(screen.getByRole('button', { name: 'Search this cell for itineraries' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Itinerary search started for this cell.');
    expect(bodies).toEqual([{ definitionId: 'def-0001', cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-04-02', returnDate: '2027-04-16' } }]);
    unmount();
    render(calendarRow(), false);
    expect(screen.queryByRole('button', { name: 'Search this cell for itineraries' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/expanded.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/components/BookingAction.js"`.

- [ ] **Step 3: Implement**

`src/components/ClassBadge.tsx`:

```tsx
import type { VerdictClass } from '@gmt/core';
import { COPY } from '../copy.js';

const STYLE: Record<VerdictClass | 'unchecked', string> = {
  verified: 'border-green-800 bg-green-100 text-green-900',
  'partially-verified': 'border-amber-800 bg-amber-100 text-amber-900',
  failed: 'border-red-800 bg-red-100 text-red-900 line-through decoration-1',
  unchecked: 'border-dashed border-slate-600 bg-white text-slate-800',
};

/** Verdict class in words (never colour alone, spec §11); stays in the 375px primary row. */
export function ClassBadge({ cls }: { cls: VerdictClass | 'unchecked' }) {
  const label = COPY.classLabel[cls];
  return (
    <span data-testid="class-badge" aria-label={COPY.classAria(label)} className={`inline-block rounded border px-1 text-xs ${STYLE[cls]}`}>
      {label}
    </span>
  );
}
```

`src/components/VerdictList.tsx`:

```tsx
import type { ConstraintName, Verdict, Verdicts } from '@gmt/core';
import { COPY } from '../copy.js';

const STYLE: Record<Verdict, string> = {
  pass: 'text-green-900',
  fail: 'font-semibold text-red-900',
  unverified: 'italic text-slate-700',
};

/** Every verdict with a distinct glyph, word and accessible name (spec §9 item 6). */
export function VerdictList({ verdicts }: { verdicts: Verdicts }) {
  const entries = (Object.entries(verdicts) as Array<[ConstraintName, Verdict | undefined]>).flatMap(([name, v]) =>
    v === undefined ? [] : [[name, v] as const],
  );
  if (entries.length === 0) return <p>{COPY.noVerdicts}</p>;
  return (
    <ul aria-label={COPY.verdictsHeading} className="space-y-0.5">
      {entries.map(([name, v]) => {
        const label = COPY.constraint[name];
        return (
          <li key={name} data-verdict={v} aria-label={COPY.verdictAria(label, COPY.verdictWord[v])} className={STYLE[v]}>
            <span aria-hidden="true">{COPY.verdictGlyph[v]}</span> {label}: {COPY.verdictWord[v]}
          </li>
        );
      })}
    </ul>
  );
}
```

`src/components/BookingAction.tsx`:

```tsx
import type { Booking } from '@gmt/core';
import { COPY } from '../copy.js';

/**
 * Defence in depth over spec §5.2's validation in core and api-contract: https only, no userinfo,
 * and the URL's host must equal the host the API states (which is what the UI shows the operator).
 */
export function safeHttpsUrl(url: string, host: string): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.host !== host) return null;
    return u;
  } catch {
    return null;
  }
}

// why: React's form attribute types omit `rel`; it is valid HTML and keeps the new tab without an opener.
const FORM_REL = { rel: 'noopener noreferrer' } as Record<string, string>;

/** GET link with host, POST as a form button (never auto-submitted), or "no link" (spec §11). */
export function BookingAction({ booking }: { booking: Booking }) {
  if (booking.kind === 'none') return <span>{COPY.noLink}</span>;
  const u = safeHttpsUrl(booking.url, booking.host);
  if (u === null) return <span>{COPY.noLink}</span>;
  if (booking.kind === 'get') {
    return (
      <a href={u.href} target="_blank" rel="noopener noreferrer" className="underline">
        {COPY.openOn(booking.host)}
      </a>
    );
  }
  const fields = [...new URLSearchParams(booking.postData).entries()];
  return (
    <form method="post" action={u.href} target="_blank" {...FORM_REL}>
      {fields.map(([name, value], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className="rounded border border-slate-500 px-2 underline">
        {COPY.continueOnForm(booking.host)}
      </button>
    </form>
  );
}

/** Spec §6.9: the provider search link, labelled so it is never mistaken for a fare link; null for synthetic rows. */
export function SearchLink({ link }: { link: { url: string; host: string; label: string } | null }) {
  if (link === null) return <span>{COPY.noSearchLink}</span>;
  const u = safeHttpsUrl(link.url, link.host);
  if (u === null) return <span>{COPY.noSearchLink}</span>;
  return (
    <span className="flex gap-1">
      <a href={u.href} target="_blank" rel="noopener noreferrer" className="underline">
        {COPY.searchLinkLabel}
      </a>
      <span>{COPY.hostShown(link.host)}</span>
    </span>
  );
}
```

`src/views/Results/ExpandedRow.tsx`:

```tsx
import { effectiveAge, formatDuration } from '@gmt/core';
import { useExecutionActions } from '../../api/queries.js';
import type { ResultRow } from '../../api/types.js';
import { BookingAction, SearchLink } from '../../components/BookingAction.js';
import { ClassBadge } from '../../components/ClassBadge.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { VerdictList } from '../../components/VerdictList.js';
import { COPY } from '../../copy.js';
import { formatLocalDateTime, formatMinutes, formatPence } from '../../format.js';
import { useNow } from '../../now.js';

type Segment = NonNullable<ResultRow['outbound']>[number];

function Segments({ segments }: { segments: readonly Segment[] | null }) {
  if (segments === null) return <p>{COPY.noSegments}</p>;
  return (
    <ul>
      {segments.map((s) => (
        <li key={`${s.marketingCarrier}${s.flightNumber}${s.departLocal}`}>
          {COPY.segment(s.marketingCarrier, s.flightNumber, s.from, formatLocalDateTime(s.departLocal), s.to, formatLocalDateTime(s.arriveLocal))}
        </li>
      ))}
    </ul>
  );
}

export interface ExpandedRowProps {
  row: ResultRow;
  /** At 375px the columns that left the primary row are shown here (spec §11). */
  extras: boolean;
  verificationConfigured: boolean;
  definitionId: string;
}

/** Spec §11 expanded row: segments, layovers, baggage, conditions, every verdict, booking, search link. */
export function ExpandedRow({ row, extras, verificationConfigured, definitionId }: ExpandedRowProps) {
  const now = useNow();
  const actions = useExecutionActions();
  const age = effectiveAge(row.provenance, now);
  const { nights: _nights, ...cellKey } = row.cell;
  return (
    <div className="grid gap-3 p-2 text-sm md:grid-cols-2">
      {extras ? (
        <section aria-label={COPY.summary}>
          <dl className="grid grid-cols-2 gap-x-2">
            <dt>{COPY.columns.destination}</dt>
            <dd>{row.cell.destination}</dd>
            <dt>{COPY.columns.totalTime}</dt>
            <dd>{row.totalMinutes === null ? COPY.notChecked : formatMinutes(row.totalMinutes)}</dd>
            <dt>{COPY.columns.nights}</dt>
            <dd>{COPY.nightsValue(row.cell.nights)}</dd>
            <dt>{COPY.columns.carriers}</dt>
            <dd>{row.basis === 'calendar' ? COPY.notChecked : row.carriers.join(', ')}</dd>
            <dt>{COPY.columns.fetched}</dt>
            <dd>{COPY.fetchedAgo(COPY.ago(formatDuration(age.fetchedHours)))}</dd>
            <dt>{COPY.columns.provider}</dt>
            <dd>{COPY.provider[row.provenance.providerId]}</dd>
            {row.adjustedPence !== null ? (
              <>
                <dt>{COPY.columns.adjusted}</dt>
                <dd>{COPY.adjustedValue(formatPence(row.adjustedPence))}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
      <section aria-label={COPY.outbound}>
        <h4 className="font-semibold">{COPY.outbound}</h4>
        <Segments segments={row.outbound} />
      </section>
      <section aria-label={COPY.inbound}>
        <h4 className="font-semibold">{COPY.inbound}</h4>
        <Segments segments={row.inbound} />
      </section>
      <section aria-label={COPY.layovers}>
        <h4 className="font-semibold">{COPY.layovers}</h4>
        {row.layovers.length === 0 ? (
          <p>{COPY.noLayovers}</p>
        ) : (
          <ul>
            {row.layovers.map((l, i) => (
              <li key={`${l.at}-${i}`}>
                {COPY.layover(l.at, formatMinutes(l.minutes))}
                {l.overnight ? <span className="ml-1 font-semibold">{COPY.overnightLayover}</span> : null}
                {l.airportChange ? <span className="ml-1 font-semibold">{COPY.airportChange}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {row.selfTransfer === true ? <p className="font-semibold">{COPY.selfTransfer}</p> : null}
      </section>
      <section aria-label={COPY.baggage}>
        <h4 className="font-semibold">{COPY.baggage}</h4>
        <p>{row.baggage?.cabinBag !== undefined ? COPY.cabinBag[row.baggage.cabinBag] : COPY.cabinBagUnknown}</p>
        <p>{row.baggage?.checkedBags !== undefined ? COPY.checkedBags(row.baggage.checkedBags) : COPY.checkedBagsUnknown}</p>
      </section>
      <section aria-label={COPY.conditions}>
        <h4 className="font-semibold">{COPY.conditions}</h4>
        <p>{COPY.refundable(row.fareConditions?.refundable)}</p>
        <p>{COPY.changeable(row.fareConditions?.changeable)}</p>
      </section>
      <section aria-label={COPY.verdictsHeading}>
        <h4 className="font-semibold">{COPY.verdictsHeading}</h4>
        <VerdictList verdicts={row.verdicts} />
        {row.notApplied.length > 0 ? <p>{COPY.notApplied(row.notApplied.map((n) => COPY.constraint[n]).join(', '))}</p> : null}
      </section>
      <section aria-label={COPY.booking}>
        <h4 className="font-semibold">{COPY.booking}</h4>
        {row.seller !== null ? <p>{COPY.seller(row.seller)}</p> : null}
        <BookingAction booking={row.booking} />
        <SearchLink link={row.searchLink} />
      </section>
      {row.otherOffers.length > 0 ? (
        <section aria-label={COPY.otherOffers}>
          <h4 className="font-semibold">{COPY.otherOffers}</h4>
          <ul>
            {row.otherOffers.map((o, i) => (
              <li key={`${o.seller}-${i}`} className="flex flex-wrap items-center gap-2">
                <span>{COPY.seller(o.seller)}</span>
                <PriceBoundary>
                  <PriceCell pricePence={o.pricePence} provenance={o.provenance} calendar={false} stale={o.stale} />
                </PriceBoundary>
                <ClassBadge cls={o.verdictClass} />
                {o.unverified.length > 0 ? <span>{COPY.unverifiedList(o.unverified.map((n) => COPY.constraint[n]).join(', '))}</span> : null}
                <BookingAction booking={o.booking} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {row.notSeenInLatest !== null ? <p className="font-medium">{COPY.notSeenInLatest(COPY.ago(formatDuration(row.notSeenInLatest.ageHours)))}</p> : null}
      {row.basis === 'calendar' && verificationConfigured ? (
        <div>
          <button
            type="button"
            className="rounded border border-slate-500 px-2"
            onClick={() => actions.verify.mutate({ definitionId, cell: cellKey })}
          >
            {COPY.verifyCell}
          </button>
          {actions.verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
          {actions.verify.error ? <p role="alert">{COPY.actionFailed(actions.verify.error.message)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
```

`// why:` (on `VerdictList`'s `{label}: {COPY.verdictWord[v]}`) the literal `: ` between expressions has no letter, so the source guard allows it; the accessible name is the `aria-label`, the visible text is the same words plus the glyph.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/expanded.test.tsx test/copy`
Expected: PASS, 13 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: expanded row with verdicts, booking forms and labelled search links"
```

### Task 9.8: View A table, two-line header and client-side sort and filter

**Files:**
- Create: `src/views/Results/ResultsTable.tsx`, `src/views/Results/ResultsHeader.tsx`, `src/views/Results/Filters.tsx`, `src/views/Results/ResultsView.tsx`
- Test: `test/views/results/table.test.tsx`

**Interfaces:**
- Consumes: `sortRows`, `filterRows`, `bandCheapest` (returns a `Set` of `resultRowKey`s), `resultRowKey`, `SortKey` (plan "Core domain functions"); TanStack Table v9 (Library notes); `ExpandedRow` (Task 9.7); `ViewHeader` (Task 9.6); URL state (Task 9.4).
- Produces: `ResultsTable`, `WIDE_COLUMNS`, `NARROW_COLUMNS`, `rowId`, `ResultsHeader`, `Filters`, `ResultsView({ definition })` (Task 9.9 gives its final form).

- [ ] **Step 1: Write the failing test**

`test/views/results/table.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import { API, definition, resultsResponse, verifiedRow } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';

/** Counts GET /results so tests can prove sorting and filtering never refetch (spec §6.5). */
function countResults(body = resultsResponse()) {
  const hits = { n: 0 };
  server.use(
    http.get(`${API}/definitions/:id/results`, () => {
      hits.n += 1;
      return HttpResponse.json(body);
    }),
  );
  return hits;
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↑↓]/g, '').trim());
const dataRows = () => within(screen.getByRole('table', { name: 'Round trips found' })).getAllByRole('row').slice(1);

describe('View A columns (spec §11)', () => {
  it('wide: every column in the spec order; adjusted appears only when configured', async () => {
    countResults();
    const { unmount } = renderWithProviders(<ResultsView definition={definition()} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(headers()).toEqual(['Details', 'Price', 'Travel time', 'Departure', 'Return', 'Nights', 'Destination', 'Carriers', 'Stops', 'Class', 'Fetched', 'Provider']);
    unmount();
    countResults(resultsResponse({ rows: [verifiedRow({ adjustedPence: 45000 })], total: 1 }));
    renderWithProviders(<ResultsView definition={definition()} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(headers().at(-1)).toBe('Adjusted (operator-entered onward cost)');
    expect(screen.getByText('£450 adjusted')).toBeInTheDocument();
  });

  it('375px: price, provenance and the class badge stay in the primary row; the rest moves to the expanded row', async () => {
    setViewportWidth(375);
    countResults();
    const { user } = renderWithProviders(<ResultsView definition={definition()} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(headers()).toEqual(['Details', 'Price', 'Class', 'Departure', 'Return', 'Stops']);
    const first = dataRows()[0];
    if (first === undefined) throw new Error('no rows');
    expect(within(first).getByText('£412')).toBeVisible();
    expect(within(first).getByTestId('provenance')).toBeVisible();
    expect(within(first).getByTestId('class-badge')).toHaveTextContent('verified');
    expect(within(first).queryByText('ZZ')).toBeNull();
    await user.click(within(first).getByRole('button', { name: /Show details/ }));
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Carriers')).toBeInTheDocument();
    expect(within(summary).getByText('ZZ')).toBeInTheDocument();
  });
});

describe('View A header (spec §11 two lines)', () => {
  it('line 1 is the headline, line 2 the six-bucket coverage line linking to Coverage', async () => {
    countResults();
    renderWithProviders(<ResultsView definition={definition()} />, { search: '?view=results&def=def-0001' });
    expect(
      await screen.findByText('cheapest found £412 · JFK 14 Mar 2027–28 Mar 2027 (14n) · itinerary-search basis · verified · Google Flights via SearchApi · 5h ago'),
    ).toBeInTheDocument();
    const line2 = screen.getByRole('link', {
      name: 'discovery: 3 priced · 1 no fares · 2 no cached data · 0 error · 0 skipped · 4 not searched of 10 (0 reused) · itinerary-searched 2 of 10 selected (2 outbounds each) +1 on demand',
    });
    expect(line2).toHaveAttribute('href', '/?view=coverage&def=def-0001');
  });

  it('says "within the cheapest 1000 of N" when truncated, and reports rows outside the current space', async () => {
    countResults({ ...resultsResponse({ truncated: true, excludedByCurrentSpace: 3 }), total: 4210 });
    renderWithProviders(<ResultsView definition={definition()} />);
    expect(await screen.findByText('within the cheapest 2 of 4210')).toBeInTheDocument();
    expect(screen.getByText('3 rows outside the current window and nights range are not shown')).toBeInTheDocument();
  });
});

describe('client-side sort and filter (spec §6.5)', () => {
  it('sorting and filtering compose without refetching, and live in the URL', async () => {
    const hits = countResults();
    const { user } = renderWithProviders(<ResultsView definition={definition()} />, { search: '?view=results' });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(dataRows()[0] ?? document.body).getByText('£412')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sort by Price, ascending' }));
    expect(within(dataRows()[0] ?? document.body).getByText('£388')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('price.asc');

    await user.click(screen.getByRole('checkbox', { name: 'verified' }));
    expect(dataRows()).toHaveLength(1);
    expect(new URLSearchParams(window.location.search).get('f.class')).toBe('verified');
    expect(hits.n).toBe(1);
  });

  it('filters survive a view switch because they are in the URL', async () => {
    countResults();
    const first = renderWithProviders(<ResultsView definition={definition()} />, { search: '?view=results&f.class=partially-verified' });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(dataRows()).toHaveLength(1);
    const search = window.location.search;
    first.unmount();
    renderWithProviders(<ResultsView definition={definition()} />, { search });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'partially verified' })).toBeChecked();
  });

  it('stops and carriers filters are disabled on the calendar basis', async () => {
    countResults(resultsResponse({ basis: 'calendar', rows: [], total: 0 }));
    renderWithProviders(<ResultsView definition={definition()} />);
    expect(await screen.findByLabelText('Max stops')).toBeDisabled();
    expect(screen.getByLabelText('Carriers (comma-separated codes)')).toBeDisabled();
    expect(screen.getByText('Stops and carriers are not known on the calendar basis.')).toBeInTheDocument();
  });
});

describe('row= selects, expands and scrolls to a row (plan "Web")', () => {
  it('the row named by its resultRowKey is marked current, expanded and scrolled into view', async () => {
    countResults();
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    renderWithProviders(<ResultsView definition={definition()} />, { search: '?view=results&row=hash-partial-1' });
    await screen.findByRole('table', { name: 'Round trips found' });
    const selected = dataRows().find((r) => r.getAttribute('aria-current') === 'true');
    expect(selected).toBeDefined();
    expect(within(selected ?? document.body).getByText('£388')).toBeInTheDocument();
    expect(within(selected ?? document.body).getByRole('button', { name: /Hide details/ })).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => scrolled).toEqual([selected]);
    spy.mockRestore();
  });
});

describe('keyboard operation of the table (spec §9 item 6, §11 accessibility)', () => {
  it('sort headers and row expansion work from the keyboard alone', async () => {
    countResults();
    const { user } = renderWithProviders(<ResultsView definition={definition()} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    const priceSort = screen.getByRole('button', { name: 'Sort by Price, ascending' });
    priceSort.focus();
    await user.keyboard('{Enter}');
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('price.asc');
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending');

    const toggle = within(dataRows()[0] ?? document.body).getByRole('button', { name: /Show details/ });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(detail).not.toBeNull();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/table.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Results/ResultsView.js"`.

- [ ] **Step 3: Implement**

`src/views/Results/ResultsTable.tsx`:

```tsx
import { effectiveAge, formatDuration, resultRowKey, type SortKey } from '@gmt/core';
import { createColumnHelper, type ExpandedState, rowExpandingFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ResultRow } from '../../api/types.js';
import { ClassBadge } from '../../components/ClassBadge.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatMinutes, formatPence } from '../../format.js';
import { useNow } from '../../now.js';
import type { SortDir } from '../../state/resultsState.js';
import { ExpandedRow } from './ExpandedRow.js';

// why: only the expanding feature; sorting and filtering are core's functions over the fetched page (spec §6.5).
const features = tableFeatures({ rowExpandingFeature });
const helper = createColumnHelper<typeof features, ResultRow>();

export type ColumnId =
  | 'expand' | 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'destination' | 'carriers' | 'stops' | 'class'
  | 'fetched' | 'provider' | 'adjusted';

/** Spec §11 column order (after the expand toggle). */
export const WIDE_COLUMNS: readonly ColumnId[] = [
  'expand', 'price', 'totalTime', 'departure', 'return', 'nights', 'destination', 'carriers', 'stops', 'class', 'fetched', 'provider', 'adjusted',
];
/** Spec §11 at 375px: price with provenance, the class badge, dates and stops stay in the primary row. */
export const NARROW_COLUMNS: readonly ColumnId[] = ['expand', 'price', 'class', 'departure', 'return', 'stops'];

const SORT_KEY: Partial<Record<ColumnId, SortKey>> = {
  price: 'price', totalTime: 'totalTime', departure: 'departure', return: 'return', nights: 'nights', stops: 'stops', adjusted: 'adjusted',
};

type Sort = { key: SortKey; dir: SortDir } | null;

/** Row identity is core's resultRowKey (itineraryHash, or `calendar:<id>`): the bandCheapest Set and `?row=` both use it. */
export const rowId = (r: ResultRow): string => resultRowKey(r);

const detailId = (id: string) => `detail-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const rowDomId = (id: string) => `row-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

function SortHeader({ id, sort, onSort }: { id: ColumnId; sort: Sort; onSort: (k: SortKey) => void }) {
  const key = SORT_KEY[id];
  const label = COPY.columns[id];
  if (key === undefined) return <span>{label}</span>;
  const active = sort?.key === key;
  const next: SortDir = active && sort?.dir === 'asc' ? 'desc' : 'asc';
  return (
    <button type="button" className="underline" onClick={() => onSort(key)} aria-label={COPY.sortBy(label, COPY.sortDir[next])}>
      {label}
      {active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

function FetchedAgo({ row }: { row: ResultRow }) {
  const now = useNow();
  return <span>{COPY.fetchedAgo(COPY.ago(formatDuration(effectiveAge(row.provenance, now).fetchedHours)))}</span>;
}

function PriceColumn({ row, banded }: { row: ResultRow; banded: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <PriceBoundary>
        <PriceCell
          pricePence={row.pricePence}
          provenance={row.provenance}
          calendar={row.basis === 'calendar'}
          stale={row.stale}
          destination={row.cell.destination}
          destinationNote={row.destinationNote}
        />
      </PriceBoundary>
      {row.basis === 'calendar' && row.notApplied.length > 0 ? (
        <span className="text-xs">{COPY.notApplied(row.notApplied.map((n) => COPY.constraint[n]).join(', '))}</span>
      ) : null}
      {banded ? <span className="text-xs font-medium">{COPY.bandCheapest}</span> : null}
      {row.notSeenInLatest !== null ? (
        <span className="text-xs">{COPY.notSeenInLatest(COPY.ago(formatDuration(row.notSeenInLatest.ageHours)))}</span>
      ) : null}
    </div>
  );
}

function cellFor(id: ColumnId, r: ResultRow, banded: ReadonlySet<string>) {
  const calendar = r.basis === 'calendar';
  switch (id) {
    case 'price': return <PriceColumn row={r} banded={banded.has(rowId(r))} />;
    case 'totalTime': return <span>{r.totalMinutes === null ? COPY.notChecked : formatMinutes(r.totalMinutes)}</span>;
    case 'departure': return <span>{formatIsoDate(r.cell.departureDate)}</span>;
    case 'return': return <span>{formatIsoDate(r.cell.returnDate)}</span>;
    case 'nights': return <span>{COPY.nightsValue(r.cell.nights)}</span>;
    case 'destination': return <span>{r.cell.destination}</span>;
    case 'carriers': return <span>{calendar ? COPY.notChecked : r.carriers.join(', ')}</span>;
    case 'stops': return <span>{r.stopsOut === null || r.stopsIn === null ? COPY.notChecked : COPY.stopsValue(r.stopsOut, r.stopsIn)}</span>;
    case 'class': return <ClassBadge cls={r.verdictClass} />;
    case 'fetched': return <FetchedAgo row={r} />;
    case 'provider': return <span>{COPY.provider[r.provenance.providerId]}</span>;
    case 'adjusted': return <span>{r.adjustedPence === null ? '' : COPY.adjustedValue(formatPence(r.adjustedPence))}</span>;
    case 'expand': return null;
  }
}

function buildColumns(ids: readonly ColumnId[], sort: Sort, onSort: (k: SortKey) => void, banded: ReadonlySet<string>) {
  return ids.map((id) =>
    helper.display({
      id,
      header: () => <SortHeader id={id} sort={sort} onSort={onSort} />,
      cell: ({ row }) => {
        if (id !== 'expand') return cellFor(id, row.original, banded);
        const open = row.getIsExpanded();
        const name = COPY.rowName(row.original.cell.destination, formatIsoDate(row.original.cell.departureDate), formatIsoDate(row.original.cell.returnDate));
        return (
          <button
            type="button"
            className="rounded border border-slate-500 px-1"
            aria-expanded={open}
            aria-controls={detailId(row.id)}
            aria-label={open ? COPY.hideDetails(name) : COPY.showDetails(name)}
            onClick={row.getToggleExpandedHandler()}
          >
            {open ? '−' : '+'}
          </button>
        );
      },
    }),
  );
}

export interface ResultsTableProps {
  rows: readonly ResultRow[];
  /** Row keys core's bandCheapest marked over the filtered set (spec §6.5). */
  banded: ReadonlySet<string>;
  /** `?row=<resultRowKey>`: selected, expanded and scrolled to (email links). */
  selectedRow: string | null;
  sort: Sort;
  onSort: (k: SortKey) => void;
  narrow: boolean;
  verificationConfigured: boolean;
  definitionId: string;
}

/** View A table. Rows arrive filtered and sorted by core's functions; the table renders and expands. */
export function ResultsTable({ rows, banded, selectedRow, sort, onSort, narrow, verificationConfigured, definitionId }: ResultsTableProps) {
  const [expanded, setExpanded] = useState<ExpandedState>(() => (selectedRow === null ? {} : { [selectedRow]: true }));
  const selectedPresent = selectedRow !== null && rows.some((r) => rowId(r) === selectedRow);
  useEffect(() => {
    // why: an email link lands here; bring its row into view once the rows are rendered.
    if (selectedRow !== null && selectedPresent) document.getElementById(rowDomId(selectedRow))?.scrollIntoView({ block: 'center' });
  }, [selectedRow, selectedPresent]);
  const adjusted = rows.some((r) => r.adjustedPence !== null);
  const ids = useMemo(() => (narrow ? NARROW_COLUMNS : WIDE_COLUMNS.filter((c) => c !== 'adjusted' || adjusted)), [narrow, adjusted]);
  const columns = useMemo(() => buildColumns(ids, sort, onSort, banded), [ids, sort, onSort, banded]);
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({
    features, columns, data, getRowId: rowId, getRowCanExpand: () => true, state: { expanded }, onExpandedChange: setExpanded,
  });
  if (rows.length === 0) return <p>{COPY.noRowsAfterFilter}</p>;
  return (
    <table aria-label={COPY.resultsTableLabel} className="w-full border-collapse text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((h) => {
              const key = SORT_KEY[h.column.id as ColumnId];
              const ariaSort = key === undefined ? undefined : sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th key={h.id} scope="col" aria-sort={ariaSort} className="border-b border-slate-400 p-1 text-left">
                  <table.FlexRender header={h} />
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <Fragment key={row.id}>
            <tr
              id={rowDomId(row.id)}
              aria-current={row.id === selectedRow ? 'true' : undefined}
              className={`border-b border-slate-200 align-top ${row.id === selectedRow ? 'bg-amber-50 outline outline-2 outline-amber-600' : ''}`}
            >
              {row.getAllCells().map((c) => (
                <td key={c.id} className="p-1">
                  <table.FlexRender cell={c} />
                </td>
              ))}
            </tr>
            {row.getIsExpanded() ? (
              <tr id={detailId(row.id)}>
                <td colSpan={ids.length} className="bg-slate-50">
                  <ExpandedRow row={row.original} extras={narrow} verificationConfigured={verificationConfigured} definitionId={definitionId} />
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
```

`src/views/Results/ResultsHeader.tsx`:

```tsx
import { effectiveAge, formatAgeCompact, formatAgeFull } from '@gmt/core';
import type { DefinitionResponse, ResultRow, ResultsResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { assertProvenance } from '../../components/Provenance.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatPence } from '../../format.js';
import { useNow } from '../../now.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

/** Line 1. The headline price is still a price: provenance is asserted before anything renders. */
function Headline({ row }: { row: ResultRow }) {
  const now = useNow();
  const p = assertProvenance(row.provenance);
  const age = effectiveAge(p, now);
  const text = COPY.headline({
    price: formatPence(row.pricePence),
    destination: row.cell.destination,
    dates: COPY.dateRange(formatIsoDate(row.cell.departureDate), formatIsoDate(row.cell.returnDate), row.cell.nights),
    basis: COPY.basisName[row.basis],
    cls: COPY.classLabel[row.verdictClass],
    provider: COPY.source[p.sourceKind],
    age: formatAgeCompact(age),
  });
  return (
    <p className={`text-lg font-semibold ${row.basis === 'calendar' ? 'rounded border border-dashed border-slate-500 px-1' : ''}`} title={formatAgeFull(age)}>
      {text}
    </p>
  );
}

/** Spec §11: the two-line Results header, plus the truncation and current-space notes. */
export function ResultsHeader({ data, definition }: { data: ResultsResponse; definition: DefinitionResponse }) {
  // why: the API picks the headline row (resultsResponse.cheapest), so web and email agree on it.
  const headline = data.cheapest;
  const c = data.coverage;
  const b = c.buckets;
  const line2 =
    COPY.coverageLine({ priced: b.priced, empty: b.empty, noData: b.no_data, error: b.error, skipped: b.skipped, notRun: b.not_run, total: c.total, reused: c.reused }) +
    (data.verificationProviderConfigured
      ? COPY.itineraryLine({ searched: c.itinerarySearched, selected: c.selected, expandTop: definition.verification.expandTop, onDemand: c.onDemand })
      : COPY.noItinerarySearch);
  return (
    <div className="space-y-1">
      {headline !== null ? (
        <PriceBoundary>
          <Headline row={headline} />
        </PriceBoundary>
      ) : (
        <p className="text-lg font-semibold">{COPY.noHeadline}</p>
      )}
      <p className="text-sm">
        <a href={hrefWith({ view: 'coverage' })} onClick={navigateTo({ view: 'coverage' })} className="underline">
          {line2}
        </a>
      </p>
      {data.truncated ? <p className="text-sm">{COPY.truncated(data.rows.length, data.total)}</p> : null}
      {data.excludedByCurrentSpace > 0 ? <p className="text-sm">{COPY.excludedByCurrentSpace(data.excludedByCurrentSpace)}</p> : null}
    </div>
  );
}
```

`src/views/Results/Filters.tsx`:

```tsx
import type { ConstraintName, Iata, ResultFilters, VerdictClass } from '@gmt/core';
import type { ResultRow } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { penceToPoundsInput, parsePoundsToPence } from '../../format.js';
import { type ResultsUiState, resultsStatePatch, setFilter } from '../../state/resultsState.js';
import { updateSearchParams } from '../../state/urlState.js';

const CLASSES: ReadonlyArray<VerdictClass | 'unchecked'> = ['verified', 'partially-verified', 'failed', 'unchecked'];

function toggle<T extends string>(list: readonly T[] | undefined, v: T): T[] | undefined {
  const set = new Set(list ?? []);
  if (set.has(v)) set.delete(v);
  else set.add(v);
  return set.size > 0 ? [...set] : undefined;
}

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];
const codes = (s: string): string[] | undefined => {
  const list = s.split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9]{2}$/.test(c));
  return list.length > 0 ? list : undefined;
};
const intOrUndefined = (s: string): number | undefined => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined);

/** Spec §6.5 filters, all client-side; state lives in the URL so it persists across views. */
export function Filters({ state, rows, calendarBasis }: { state: ResultsUiState; rows: readonly ResultRow[]; calendarBasis: boolean }) {
  const f = state.filters;
  const apply = (next: ResultFilters) => updateSearchParams(resultsStatePatch({ ...state, filters: next }));
  const providers = unique(rows.map((r) => r.provenance.providerId));
  const destinations = unique(rows.map((r) => r.cell.destination));
  const constraints = unique(rows.flatMap((r) => r.unverified)) as ConstraintName[];
  const version = JSON.stringify(f);
  return (
    <form aria-label={COPY.filtersHeading} onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-start gap-3 text-sm">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="font-semibold">{COPY.filterClass}</legend>
        {CLASSES.map((c) => (
          <label key={c} className="flex items-center gap-1">
            <input type="checkbox" checked={f.verdictClass?.includes(c) ?? false} onChange={() => apply(setFilter(f, 'verdictClass', toggle(f.verdictClass, c)))} />
            {COPY.classLabel[c]}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="font-semibold">{COPY.filterProvider}</legend>
        {providers.map((p) => (
          <label key={p} className="flex items-center gap-1">
            <input type="checkbox" checked={f.providerId?.includes(p) ?? false} onChange={() => apply(setFilter(f, 'providerId', toggle(f.providerId, p)))} />
            {COPY.provider[p]}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="font-semibold">{COPY.filterDestinations}</legend>
        {destinations.map((d) => (
          <label key={d} className="flex items-center gap-1">
            <input type="checkbox" checked={f.destination?.includes(d) ?? false} onChange={() => apply(setFilter(f, 'destination', toggle<Iata>(f.destination, d)))} />
            {d}
          </label>
        ))}
      </fieldset>
      <span className="flex flex-col">
        {/* why: a select inside its label would put the option text into the label's name */}
        <label htmlFor="filter-max-stops">{COPY.filterMaxStops}</label>
        <select
          id="filter-max-stops"
          disabled={calendarBasis}
          value={f.maxStops === undefined ? '' : String(f.maxStops)}
          onChange={(e) => apply(setFilter(f, 'maxStops', intOrUndefined(e.target.value)))}
        >
          <option value="">{COPY.any}</option>
          <option value="0">0</option>
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </span>
      <label className="flex flex-col">
        {COPY.filterCarriers}
        <input
          key={`carriers-${version}`}
          disabled={calendarBasis}
          defaultValue={(f.carriers ?? []).join(',')}
          onBlur={(e) => apply(setFilter(f, 'carriers', codes(e.target.value)))}
        />
      </label>
      <label className="flex flex-col">
        {COPY.filterMaxPrice}
        <input
          key={`price-${version}`}
          inputMode="decimal"
          defaultValue={penceToPoundsInput(f.maxPricePence)}
          onBlur={(e) => apply(setFilter(f, 'maxPricePence', parsePoundsToPence(e.target.value)))}
        />
      </label>
      <label className="flex flex-col">
        {COPY.filterNightsMin}
        <input
          key={`nmin-${version}`}
          inputMode="numeric"
          defaultValue={f.nights === undefined ? '' : String(f.nights.min)}
          onBlur={(e) => {
            const min = intOrUndefined(e.target.value);
            const max = f.nights?.max ?? 90;
            apply(setFilter(f, 'nights', min === undefined ? undefined : { min, max: Math.max(min, max) }));
          }}
        />
      </label>
      <label className="flex flex-col">
        {COPY.filterNightsMax}
        <input
          key={`nmax-${version}`}
          inputMode="numeric"
          defaultValue={f.nights === undefined ? '' : String(f.nights.max)}
          onBlur={(e) => {
            const max = intOrUndefined(e.target.value);
            const min = f.nights?.min ?? 0;
            apply(setFilter(f, 'nights', max === undefined ? undefined : { min: Math.min(min, max), max }));
          }}
        />
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={f.hideStale === true} onChange={() => apply(setFilter(f, 'hideStale', f.hideStale === true ? undefined : true))} />
        {COPY.filterHideStale}
      </label>
      <span className="flex flex-col">
        <label htmlFor="filter-unverified">{COPY.filterUnverified}</label>
        <select
          id="filter-unverified"
          disabled={calendarBasis}
          // why: core's filter takes a list; this control picks one constraint (a row matches if it is unverified there).
          value={f.unverified?.[0] ?? ''}
          onChange={(e) => apply(setFilter(f, 'unverified', e.target.value === '' ? undefined : [e.target.value as ConstraintName]))}
        >
          <option value="">{COPY.any}</option>
          {constraints.map((c) => (
            <option key={c} value={c}>
              {COPY.constraint[c]}
            </option>
          ))}
        </select>
      </span>
      <button type="button" className="rounded border border-slate-500 px-2" onClick={() => apply({})}>
        {COPY.clearFilters}
      </button>
      {calendarBasis ? <p className="w-full">{COPY.filtersDisabledCalendar}</p> : null}
    </form>
  );
}
```

`src/views/Results/ResultsView.tsx` (this task's version; Task 9.9 adds the basis switch and the calendar-gap banner):

```tsx
import { bandCheapest, filterRows, type SortKey, sortRows } from '@gmt/core';
import { useCallback, useMemo } from 'react';
import { useResults } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { parseBasis, parseResultsState, parseSelectedRow, resultsStatePatch } from '../../state/resultsState.js';
import { updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { Filters } from './Filters.js';
import { ResultsHeader } from './ResultsHeader.js';
import { ResultsTable } from './ResultsTable.js';

/** Spec §6.5: travel-time band width for bandCheapest. */
const BAND_HOURS = 6;

export function ResultsView({ definition }: { definition: DefinitionResponse }) {
  const params = useSearchParams();
  const basis = parseBasis(params.get('basis'));
  const ui = useMemo(() => parseResultsState(params), [params]);
  const results = useResults(definition.id, basis);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { rows, banded } = useMemo(() => {
    if (results.data === undefined) return { rows: [], banded: new Set<string>() };
    const filtered = filterRows(results.data.rows, ui.filters);
    // why: band over the filtered set, so "cheapest in its band" means among the rows the operator is looking at.
    const marked = bandCheapest(filtered, BAND_HOURS);
    return { rows: ui.sort === null ? filtered : sortRows(filtered, ui.sort.key, ui.sort.dir), banded: marked };
  }, [results.data, ui]);
  const onSort = useCallback((key: SortKey) => {
    const current = parseResultsState(new URLSearchParams(window.location.search));
    const dir = current.sort?.key === key && current.sort.dir === 'asc' ? 'desc' : 'asc';
    updateSearchParams(resultsStatePatch({ ...current, sort: { key, dir } }));
  }, []);

  if (results.error) return <p role="alert">{COPY.loadFailed(results.error.message)}</p>;
  if (results.data === undefined) return <p>{COPY.loading}</p>;
  const data = results.data;
  return (
    <div className="space-y-3">
      <ViewHeader title={COPY.nav.results} executions={data.executions} stale={data.rows.length > 0 && data.rows.every((r) => r.stale)} />
      <ResultsHeader data={data} definition={definition} />
      <Filters state={ui} rows={data.rows} calendarBasis={data.basis === 'calendar'} />
      <ResultsTable
        rows={rows}
        banded={banded}
        selectedRow={parseSelectedRow(params)}
        sort={ui.sort}
        onSort={onSort}
        narrow={narrow}
        verificationConfigured={data.verificationProviderConfigured}
        definitionId={definition.id}
      />
    </div>
  );
}
```

Wire the view into `App.tsx`: replace the `view === 'results'` part of the WP9 placeholder line with `{view === 'results' && selected ? <ResultsView definition={selected} /> : null}`, where `const selected = list.find((d) => d.id === selectedId) ?? null;` (the full file is in Task 9.13).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results test/copy`
Expected: PASS, 9 + 13 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: View A table, two-line header, client-side sort and filter"
```

### Task 9.9: Basis switch and the calendar-gap banner

**Files:**
- Create: `src/views/Results/BasisSwitch.tsx`, `src/views/Results/CalendarGapBanner.tsx`
- Modify: `src/views/Results/ResultsView.tsx` (final form below)
- Test: `test/views/results/basisAndGap.test.tsx`

**Interfaces:**
- Consumes: `useCalendarGap`, `useExecutionActions` (Task 9.3); `calendarGapResponseSchema` `{ cheapestVerified: (PriceCell & { cell, itineraryHash }) | null, cells: [{ cell, calendar: PriceCell, verifyAvailable }] }`; `resultsResponse.verificationProviderConfigured`; `cellKeyString` (WP0).
- Produces: `BasisSwitch({ basis, reason })`, `CalendarGapBanner({ definitionId })`, final `ResultsView`.

- [ ] **Step 1: Write the failing test**

`test/views/results/basisAndGap.test.tsx`:

```tsx
import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import { API, calendarGap, calendarRow, definition, resultsResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const calendarOnly = definition({ providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } });
const calendarResults = () =>
  resultsResponse({ basis: 'calendar', basisReason: 'no verification provider configured', rows: [calendarRow()], verificationProviderConfigured: false });

describe('basis (spec §6.9)', () => {
  it('calendar default says why and switches basis in one click, refetching with basis=', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json(calendarResults());
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={calendarOnly} />);
    expect(await screen.findByText('no verification provider configured')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar basis' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'itinerary-search basis' }));
    expect(new URLSearchParams(window.location.search).get('basis')).toBe('verified');
    await expect.poll(() => urls).toEqual(['', '?basis=verified']);
  });

  it('calendar headline and coverage line when no verification provider is configured', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())),
    );
    renderWithProviders(<ResultsView definition={calendarOnly} />);
    expect(
      await screen.findByText('cheapest found £399 · EWR 2 Apr 2027–16 Apr 2027 (14n) · calendar basis · constraints not checked · Aviasales cache · 2h ago · ≤2d'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /itinerary search not configured$/ })).toBeInTheDocument();
    const L = CONSTRAINT_LABELS;
    expect(screen.getByText(`not applied: ${L.arrivalWindowLocal}, ${L.maxJourneyMinutes}, ${L.maxStops}`)).toBeInTheDocument();
    expect(screen.getByText('onward leg not included')).toBeInTheDocument();
  });
});

describe('calendar-gap banner (spec §11, §6.9)', () => {
  it('shows "N cells have calendar prices below your cheapest verified (£X)" with per-cell verify', async () => {
    const verifies: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())),
      http.post(`${API}/cells/verify`, async ({ request }) => {
        verifies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={definition()} />);
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    expect(banner).toHaveTextContent('1 cells have calendar prices below your cheapest verified (£412');
    expect(within(banner).getByText('£412')).toBeInTheDocument();
    expect(within(banner).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(banner).getByText('£399')).toBeInTheDocument();
    expect(within(banner).getByText('Aviasales cache')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search this cell for itineraries' }));
    await expect.poll(() => verifies).toEqual([
      { definitionId: 'def-0001', cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-04-02', returnDate: '2027-04-16' } },
    ]);
  });

  it('is hidden, and never requested, without a verification provider', async () => {
    let gapHits = 0;
    server.use(
      http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())),
      http.get(`${API}/definitions/:id/calendar-gap`, () => {
        gapHits += 1;
        return HttpResponse.json(calendarGap());
      }),
    );
    renderWithProviders(<ResultsView definition={calendarOnly} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.queryByRole('region', { name: 'Cells to search' })).toBeNull();
    expect(gapHits).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/basisAndGap.test.tsx`
Expected: FAIL: `Unable to find an element with the text: no verification provider configured` (the first test), and `Unable to find role="region" and name "Cells to search"` (the third).

- [ ] **Step 3: Implement**

`src/views/Results/BasisSwitch.tsx`:

```tsx
import type { Basis } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { updateSearchParams } from '../../state/urlState.js';

const BASES: readonly Basis[] = ['verified', 'calendar'];

/** Spec §6.9: the basis in use, why (the API's basisReason), and a one-click switch. */
export function BasisSwitch({ basis, reason }: { basis: Basis; reason: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm">
      <legend className="font-semibold">{COPY.basisSwitchLabel}</legend>
      {BASES.map((b) => (
        <label key={b} className="flex items-center gap-1">
          <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => updateSearchParams({ basis: b }, 'push')} />
          {COPY.basisName[b]}
        </label>
      ))}
      <span className="text-slate-700">{reason}</span>
    </fieldset>
  );
}
```

`src/views/Results/CalendarGapBanner.tsx`:

```tsx
import { cellKeyString } from '@gmt/core';
import { useCalendarGap, useExecutionActions } from '../../api/queries.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';

/**
 * Spec §11: "N cells have calendar prices below your cheapest verified (£X)" with per-cell verify.
 * Rendered only when the results response says a verification provider is configured, so the
 * query never runs on the £0 configuration. £X renders through PriceCell with its provenance.
 */
export function CalendarGapBanner({ definitionId }: { definitionId: string }) {
  const gap = useCalendarGap(definitionId, true);
  const actions = useExecutionActions();
  const data = gap.data;
  if (data === undefined || data.cells.length === 0 || data.cheapestVerified === null) return null;
  const cv = data.cheapestVerified;
  return (
    <section aria-label={COPY.calendarGapList} className="rounded border border-amber-700 bg-amber-50 p-2 text-sm">
      <p className="flex flex-wrap items-center gap-1">
        {COPY.calendarGapLead(data.cells.length)} (
        <PriceBoundary>
          <PriceCell pricePence={cv.pricePence} provenance={cv.provenance} calendar={false} stale={cv.stale} destination={cv.cell.destination} />
        </PriceBoundary>
        )
      </p>
      <ul className="mt-1 space-y-1">
        {data.cells.map((c) => {
          const { nights, ...key } = c.cell;
          return (
            <li key={cellKeyString(key)} className="flex flex-wrap items-center gap-2">
              <span>
                {COPY.coverageCheckPair(c.cell.origin, c.cell.destination)} {COPY.dateRange(formatIsoDate(c.cell.departureDate), formatIsoDate(c.cell.returnDate), nights)}
              </span>
              <PriceBoundary>
                <PriceCell pricePence={c.calendar.pricePence} provenance={c.calendar.provenance} calendar stale={c.calendar.stale} destination={c.cell.destination} />
              </PriceBoundary>
              {c.verifyAvailable ? (
                <button type="button" className="rounded border border-slate-500 px-2" onClick={() => actions.verify.mutate({ definitionId, cell: key })}>
                  {COPY.verifyCell}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {actions.verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
      {actions.verify.error ? <p role="alert">{COPY.actionFailed(actions.verify.error.message)}</p> : null}
    </section>
  );
}
```

`src/views/Results/ResultsView.tsx` (final):

```tsx
import { bandCheapest, filterRows, type SortKey, sortRows } from '@gmt/core';
import { useCallback, useMemo } from 'react';
import { useResults } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { parseBasis, parseResultsState, parseSelectedRow, resultsStatePatch } from '../../state/resultsState.js';
import { updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { BasisSwitch } from './BasisSwitch.js';
import { CalendarGapBanner } from './CalendarGapBanner.js';
import { Filters } from './Filters.js';
import { ResultsHeader } from './ResultsHeader.js';
import { ResultsTable } from './ResultsTable.js';

/** Spec §6.5: travel-time band width for bandCheapest. */
const BAND_HOURS = 6;

/** View A (spec §11): one fetch per basis; every sort and filter is core's pure function over that page. */
export function ResultsView({ definition }: { definition: DefinitionResponse }) {
  const params = useSearchParams();
  const basis = parseBasis(params.get('basis'));
  const ui = useMemo(() => parseResultsState(params), [params]);
  const results = useResults(definition.id, basis);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { rows, banded } = useMemo(() => {
    if (results.data === undefined) return { rows: [], banded: new Set<string>() };
    const filtered = filterRows(results.data.rows, ui.filters);
    // why: band over the filtered set, so "cheapest in its band" means among the rows the operator is looking at.
    const marked = bandCheapest(filtered, BAND_HOURS);
    return { rows: ui.sort === null ? filtered : sortRows(filtered, ui.sort.key, ui.sort.dir), banded: marked };
  }, [results.data, ui]);
  const onSort = useCallback((key: SortKey) => {
    const current = parseResultsState(new URLSearchParams(window.location.search));
    const dir = current.sort?.key === key && current.sort.dir === 'asc' ? 'desc' : 'asc';
    updateSearchParams(resultsStatePatch({ ...current, sort: { key, dir } }));
  }, []);

  if (results.error) return <p role="alert">{COPY.loadFailed(results.error.message)}</p>;
  if (results.data === undefined) return <p>{COPY.loading}</p>;
  const data = results.data;
  const verificationConfigured = data.verificationProviderConfigured;
  return (
    <div className="space-y-3">
      <ViewHeader title={COPY.nav.results} executions={data.executions} stale={data.rows.length > 0 && data.rows.every((r) => r.stale)} />
      <ResultsHeader data={data} definition={definition} />
      <BasisSwitch basis={data.basis} reason={data.basisReason} />
      {verificationConfigured ? <CalendarGapBanner definitionId={definition.id} /> : null}
      <Filters state={ui} rows={data.rows} calendarBasis={data.basis === 'calendar'} />
      <ResultsTable
        rows={rows}
        banded={banded}
        selectedRow={parseSelectedRow(params)}
        sort={ui.sort}
        onSort={onSort}
        narrow={narrow}
        verificationConfigured={verificationConfigured}
        definitionId={definition.id}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results test/copy`
Expected: PASS, 4 + 9 + 13 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: basis switch and calendar-gap banner with per-cell verify"
```

### Task 9.10: View D Coverage

**Files:**
- Create: `src/views/Coverage/CoverageView.tsx`
- Test: `test/views/coverage.test.tsx`

**Interfaces:**
- Consumes: `useCoverage`, `useResults`, `useExecutionActions` (Task 9.3); `coverageResponseSchema` `{ executionId, summary, perStage: [{ stage, providerId, buckets, total, requests: { calls, cacheHits, costMicroGbp, planCalls }, overrun, parityBreak }], selectedNotReached: [{ cell, reason }], errors: [{ cell, stage, providerId, reason, lastError, attempts, retryable }], scheduleBlockedSince }`; `ViewHeader` (Task 9.6).
- Produces: `CoverageView({ definition })`.

- [ ] **Step 1: Write the failing test**

`test/views/coverage.test.tsx`:

```tsx
import { asIsoDate } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CoverageView } from '../../src/views/Coverage/CoverageView.js';
import { API, coverageResponse, definition, execution } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

const rowTexts = (table: HTMLElement) =>
  within(table).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent));

function withStage(patch: Partial<ReturnType<typeof coverageResponse>['perStage'][number]>) {
  const base = coverageResponse();
  const [first, ...rest] = base.perStage;
  if (first === undefined) throw new Error('fixture');
  return { ...base, perStage: [{ ...first, ...patch }, ...rest] };
}

describe('View D (spec §11, §6.6)', () => {
  it('counts per stage × provider in the six buckets, with cells, the "searched" umbrella and estimate vs ledger beside', async () => {
    renderWithProviders(<CoverageView definition={definition()} />);
    const table = await screen.findByRole('table', { name: 'Coverage' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Stage', 'Provider', 'priced', 'no fares', 'no cached data', 'error', 'skipped', 'not searched', 'cells',
      'searched (priced + no fares + no cached data)', 'Requests (estimate vs ledger)',
    ]);
    expect(rowTexts(table)).toEqual([
      ['discovery', 'Travelpayouts', '60', '10', '40', '6', '0', '10', '126', '110', '14 of 14 planned calls · 0 cache hits · ledger cost £0, from configured rates'],
      ['itinerary search', 'SearchApi', '8', '1', '0', '1', '116', '0', '126', '9', '50 of 50 planned calls · 0 cache hits · ledger cost £0, from configured rates'],
    ]);
  });

  it('View D sums: six buckets that do not add up to the cell count are flagged, never hidden', async () => {
    const first = coverageResponse().perStage[0];
    if (first === undefined) throw new Error('fixture');
    server.use(http.get(`${API}/definitions/:id/coverage`, () => HttpResponse.json(withStage({ buckets: { ...first.buckets, not_run: 9 } }))));
    renderWithProviders(<CoverageView definition={definition()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('buckets sum to 125, not 126; report this');
  });

  it('no sum alert when the six buckets add up', async () => {
    renderWithProviders(<CoverageView definition={definition()} />);
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByText(/buckets sum to/)).toBeNull();
  });

  it('selected but not reached, with the reason', async () => {
    renderWithProviders(<CoverageView definition={definition()} />);
    const list = await screen.findByRole('list', { name: 'Selected but not reached' });
    expect(within(list).getByText('LHR → JFK 20 Mar 2027 to 1 Apr 2027: skipped: budget')).toBeInTheDocument();
  });

  it('maps both selected-but-not-reached reasons to words', async () => {
    const base = coverageResponse();
    const first = base.selectedNotReached[0];
    if (first === undefined) throw new Error('fixture');
    server.use(http.get(`${API}/definitions/:id/coverage`, () => HttpResponse.json({ ...base, selectedNotReached: [first, { ...first, cell: { ...first.cell, departureDate: asIsoDate('2027-03-22') }, reason: 'not_run' }] })));
    renderWithProviders(<CoverageView definition={definition()} />);
    const list = await screen.findByRole('list', { name: 'Selected but not reached' });
    expect(within(list).getByText('LHR → JFK 22 Mar 2027 to 1 Apr 2027: not run')).toBeInTheDocument();
    expect(within(list).getByText('LHR → JFK 20 Mar 2027 to 1 Apr 2027: skipped: budget')).toBeInTheDocument();
  });

  it('overrun and parity flags appear on their stage row only when set', async () => {
    const { unmount } = renderWithProviders(<CoverageView definition={definition()} />);
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByText(/Overrun/)).toBeNull();
    expect(screen.queryByText(/Parity break/)).toBeNull();
    unmount();
    server.use(http.get(`${API}/definitions/:id/coverage`, () => HttpResponse.json(withStage({ overrun: true, parityBreak: true }))));
    renderWithProviders(<CoverageView definition={definition()} />);
    expect(await screen.findByText('Overrun: ledger calls exceed the plan by more than 10%.')).toBeInTheDocument();
    expect(screen.getByText('Parity break: tile requests differ from the plan.')).toBeInTheDocument();
  });

  it('lists errors and retries the retryable ones through POST /api/executions/:id/resume', async () => {
    const resumed: string[] = [];
    server.use(
      http.post(`${API}/executions/:id/resume`, ({ params }) => {
        resumed.push(String(params.id));
        return HttpResponse.json(execution());
      }),
    );
    const { user } = renderWithProviders(<CoverageView definition={definition()} />);
    const errors = await screen.findByRole('list', { name: 'Errors' });
    expect(within(errors).getByText('LGW → EWR 21 Mar 2027 to 2 Apr 2027: rate-limit after 3 attempts (HTTP 429)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry errors' }));
    await expect.poll(() => resumed).toEqual(['exec-0001']);
  });

  it('no Retry button when no error is retryable', async () => {
    const base = coverageResponse();
    server.use(http.get(`${API}/definitions/:id/coverage`, () => HttpResponse.json({ ...base, errors: base.errors.map((e) => ({ ...e, retryable: false })) })));
    renderWithProviders(<CoverageView definition={definition()} />);
    await screen.findByRole('list', { name: 'Errors' });
    expect(screen.queryByRole('button', { name: 'Retry errors' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/coverage.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/Coverage/CoverageView.js"`.

- [ ] **Step 3: Implement**

`src/views/Coverage/CoverageView.tsx`:

```tsx
import type { CellKey } from '@gmt/core';
import { useCoverage, useExecutionActions, useResults } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatMicroGbp } from '../../format.js';
import { parseBasis } from '../../state/resultsState.js';
import { useSearchParams } from '../../state/urlState.js';

/** Spec §3 / §6.6: the six buckets, which sum to the cell count. */
const BUCKETS = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run'] as const;

const cellText = (c: CellKey) => COPY.cellLabel(c.origin, c.destination, formatIsoDate(c.departureDate), formatIsoDate(c.returnDate));
/** The two reasons the contract allows (`'not_run' | 'skipped:budget'`), each in words. */
const reasonText = (r: 'not_run' | 'skipped:budget') => (r === 'skipped:budget' ? COPY.reasonBudget : COPY.reasonNotRun);

/** View D (spec §11): per stage × provider counts, estimate vs ledger, selected-not-reached, flags, errors with retry. */
export function CoverageView({ definition }: { definition: DefinitionResponse }) {
  const params = useSearchParams();
  const results = useResults(definition.id, parseBasis(params.get('basis')));
  const coverage = useCoverage(definition.id);
  const actions = useExecutionActions();
  if (coverage.error) return <p role="alert">{COPY.loadFailed(coverage.error.message)}</p>;
  if (coverage.data === undefined) return <p>{COPY.loading}</p>;
  const c = coverage.data;
  const executionId = c.executionId;
  const retryable = c.errors.some((e) => e.retryable);
  return (
    <div className="space-y-4">
      <ViewHeader title={COPY.coverageHeading} executions={results.data?.executions ?? []} stale={false} />
      <table aria-label={COPY.coverageHeading} className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="p-1 text-left">{COPY.coverageStage}</th>
            <th scope="col" className="p-1 text-left">{COPY.coverageProvider}</th>
            {BUCKETS.map((b) => (
              <th key={b} scope="col" className="p-1 text-right">{COPY.bucket[b]}</th>
            ))}
            <th scope="col" className="p-1 text-right">{COPY.coverageCells}</th>
            <th scope="col" className="border-l border-slate-400 p-1 text-right">{COPY.coverageSearched}</th>
            <th scope="col" className="p-1 text-left">{COPY.requestsHeading}</th>
          </tr>
        </thead>
        <tbody>
          {c.perStage.map((s) => {
            const sum = BUCKETS.reduce((n, b) => n + s.buckets[b], 0);
            // why: "searched" is computed here from its definition (spec §3), never taken on trust.
            const searched = s.buckets.priced + s.buckets.empty + s.buckets.no_data;
            const planned = s.requests.planCalls === null ? COPY.none : String(s.requests.planCalls);
            return (
              <tr key={`${s.stage}-${s.providerId}`} className="border-t border-slate-200 align-top">
                <th scope="row" className="p-1 text-left font-normal">{COPY.stageName[s.stage] ?? s.stage}</th>
                <td className="p-1">{COPY.provider[s.providerId]}</td>
                {BUCKETS.map((b) => (
                  <td key={b} className="p-1 text-right tabular-nums">{s.buckets[b]}</td>
                ))}
                <td className="p-1 text-right tabular-nums">{s.total}</td>
                <td className="border-l border-slate-400 p-1 text-right tabular-nums">{searched}</td>
                <td className="p-1">
                  {COPY.requestRow(s.requests.calls, planned, s.requests.cacheHits, formatMicroGbp(s.requests.costMicroGbp))}
                  {s.overrun ? <p className="font-semibold">{COPY.overrunFlag}</p> : null}
                  {s.parityBreak ? <p className="font-semibold">{COPY.parityFlag}</p> : null}
                  {sum !== s.total ? (
                    <p role="alert" className="font-semibold text-red-800">{COPY.sumMismatch(sum, s.total)}</p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {c.summary.reused > 0 ? <p className="text-sm">{COPY.reusedNote(c.summary.reused)}</p> : null}
      <section>
        <h3 className="font-semibold">{COPY.selectedNotReached}</h3>
        {c.selectedNotReached.length === 0 ? (
          <p className="text-sm">{COPY.noneSelectedNotReached}</p>
        ) : (
          <ul aria-label={COPY.selectedNotReached} className="text-sm">
            {c.selectedNotReached.map((x) => (
              <li key={`${x.cell.origin}${x.cell.destination}${x.cell.departureDate}${x.cell.returnDate}`}>
                {cellText(x.cell)}: {reasonText(x.reason)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="font-semibold">{COPY.errorsHeading}</h3>
        {c.errors.length === 0 ? (
          <p className="text-sm">{COPY.noErrors}</p>
        ) : (
          <ul aria-label={COPY.errorsHeading} className="text-sm">
            {c.errors.map((e) => (
              <li key={`${e.stage}${e.providerId}${e.cell.origin}${e.cell.destination}${e.cell.departureDate}${e.cell.returnDate}`}>
                {cellText(e.cell)}: {COPY.errorRow(e.reason, e.attempts)}
                {e.lastError !== null ? ` (${e.lastError})` : ''}
              </li>
            ))}
          </ul>
        )}
        {retryable && executionId !== null ? (
          <button type="button" className="mt-1 rounded border border-slate-500 px-2" onClick={() => actions.resume.mutate(executionId)}>
            {COPY.retry}
          </button>
        ) : null}
        {actions.resume.error ? <p role="alert">{COPY.actionFailed(actions.resume.error.message)}</p> : null}
      </section>
    </div>
  );
}
```

`// why:` the sum-mismatch alert sits inside the requests cell so every row keeps the same column count.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/coverage.test.tsx test/copy`
Expected: PASS, 8 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: View D coverage with six buckets, estimate vs ledger, flags and retry"
```

### Task 9.11: Providers view

**Files:**
- Create: `src/views/Providers/ProvidersView.tsx`
- Test: `test/views/providers.test.tsx`

**Interfaces:**
- Consumes: `useProviders` (Task 9.3); `providersResponseSchema` `{ providers: [{ providerId, displayName, enabled, capabilities: { discovery, verification }, plan, usage: Usage[], excludedFromSchedule, notices }], synthetic, presets, pointOfSale }`; `formatDuration` (WP0).
- Produces: `ProvidersView()`.

- [ ] **Step 1: Write the failing test**

`test/views/providers.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ProvidersView } from '../../src/views/Providers/ProvidersView.js';
import { API, providersResponse, usage } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

describe('Providers view (spec §10, §11)', () => {
  it('shows capabilities in words, plan, and usage vs caps with window bounds', async () => {
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByText('plan: 40usd')).toBeInTheDocument();
    expect(within(searchapi).getByText('Discovery: Google date grid via SearchApi · prices up to 24h old when fetched')).toBeInTheDocument();
    expect(within(searchapi).getByText('Itinerary search: Google Flights via SearchApi · priced at request time')).toBeInTheDocument();
    expect(within(searchapi).getByText('615 of 10000 calls · window 1 Oct 2026 to 1 Nov 2026')).toBeInTheDocument();
    const tp = screen.getByRole('region', { name: 'Travelpayouts' });
    expect(within(tp).getByText('Discovery: Aviasales cache · prices up to 2d old when fetched')).toBeInTheDocument();
    expect(within(tp).getByText('Aviasales cache of recent user searches')).toBeInTheDocument();
    expect(within(tp).getByText('plan: free')).toBeInTheDocument();
  });

  it("shows each provider's notices (the zero-cap message) and marks unconfigured providers", async () => {
    const base = providersResponse();
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({
          ...base,
          providers: base.providers.map((p) =>
            p.providerId === 'searchapi' ? { ...p, enabled: false, notices: ['verification will not run: spend cap is 0'] } : p,
          ),
        }),
      ),
    );
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByRole('alert')).toHaveTextContent('verification will not run: spend cap is 0');
    expect(within(searchapi).getByText('not configured')).toBeInTheDocument();
  });

  it('a lifetime (trial) window is labelled as such, and exclusion from schedules is stated', async () => {
    const base = providersResponse();
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({
          ...base,
          providers: base.providers.map((p) =>
            p.providerId === 'searchapi' ? { ...p, plan: 'trial', excludedFromSchedule: true, usage: [usage('provider-lifetime:searchapi', 9, 100)] } : p,
          ),
        }),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(await screen.findByText("9 of 100 calls over the plan's lifetime")).toBeInTheDocument();
    expect(screen.getByText('excluded from scheduled runs')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/providers.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/Providers/ProvidersView.js"`.

- [ ] **Step 3: Implement**

`src/views/Providers/ProvidersView.tsx`:

```tsx
import { type CapabilityInfo, formatDuration } from '@gmt/core';
import { useProviders } from '../../api/queries.js';
import type { UsageRow } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';

function maxAgeText(h: CapabilityInfo['maxAgeHours']): string {
  if (h === 'unknown') return COPY.maxAgeUnknown;
  return h === 0 ? COPY.maxAgeZero : COPY.maxAge(formatDuration(h));
}

function Capability({ title, info }: { title: string; info: CapabilityInfo }) {
  return (
    <div>
      <p>
        {title}: {COPY.source[info.sourceKind]} · {maxAgeText(info.maxAgeHours)}
      </p>
      <p className="text-slate-700">{info.provenanceNote}</p>
    </div>
  );
}

/** A lifetime scope (`provider-lifetime:<id>`) or a row without window bounds reads as lifetime. */
function usageText(u: UsageRow): string {
  const cap = u.cap === null ? COPY.noCap : String(u.cap);
  if (u.scope.startsWith('provider-lifetime') || u.windowStart === null || u.windowEnd === null) return COPY.usageLifetime(u.calls, cap);
  return COPY.usageWindow(u.calls, cap, formatIsoDate(u.windowStart.slice(0, 10)), formatIsoDate(u.windowEnd.slice(0, 10)));
}

/** Spec §11 Providers: capabilities, plan, usage vs caps with window bounds, and the API's notices (the zero-cap message). */
export function ProvidersView() {
  const q = useProviders();
  if (q.error) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;
  if (q.data === undefined) return <p>{COPY.loading}</p>;
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-xl font-semibold">{COPY.providersHeading}</h2>
      {q.data.providers.map((p) => (
        <section key={p.providerId} aria-label={p.displayName} className="rounded border border-slate-300 p-2">
          <h3 className="font-semibold">
            {p.displayName} <span className="font-normal">{p.enabled ? COPY.providerEnabled : COPY.providerDisabled}</span>
          </h3>
          {p.notices.map((n) => (
            <p key={n} role="alert" className="rounded border border-red-700 p-1 font-medium">
              {n}
            </p>
          ))}
          <p>{COPY.plan(p.plan)}</p>
          {p.excludedFromSchedule ? <p>{COPY.excludedFromSchedule}</p> : null}
          {p.capabilities.discovery !== null ? <Capability title={COPY.capabilityDiscovery} info={p.capabilities.discovery} /> : null}
          {p.capabilities.verification !== null ? <Capability title={COPY.capabilityVerification} info={p.capabilities.verification} /> : null}
          <ul>
            {p.usage.map((u) => (
              <li key={u.scope}>{usageText(u)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/providers.test.tsx test/copy`
Expected: PASS, 3 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: Providers view with capabilities, plan, usage windows and notices"
```

### Task 9.12: Definitions form: airports, defaults, advanced fold, example import

**Files:**
- Create: `src/example.ts`, `src/views/Definitions/draft.ts`, `src/views/Definitions/AirportListInput.tsx`, `src/views/Definitions/AdvancedFields.tsx`, `src/views/Definitions/CoverageCheck.tsx`, `src/views/Definitions/EstimatePanel.tsx`, `src/views/Definitions/DefinitionForm.tsx`
- Create (stand-in, owned by WP12): `docs/examples/london-new-york.json`, only if it does not exist yet; WP12 Task 12.7 overwrites it and Task 12.9 asserts the import still resolves.
- Test: `test/views/definitions/form.test.tsx`

**Interfaces:**
- Consumes: `api`, `useAirportSearch`, `ApiError` (Task 9.3); `providersResponse.presets`; `definitionCreateRequestSchema` (parses the example); `POST /api/definitions/estimate`; 422 `details.fields`; `WindowSpec`, `Constraints`, `VerificationPolicy`, `ExecutionBudget`, `ProvidersConfig`, `Cabin`, `ProviderId`, `Iata`.
- Produces: `EXAMPLE_DEFINITION` (from `src/example.ts`), `Draft`, `defaultDraft`, `definitionToDraft`, `draftToRequest`, `applyExample`, `normaliseIata`, `confirmationPence`, `withKey`, `AirportListInput`, `AdvancedFields`, `NumberField`, `CoverageCheck`, `EstimatePanel`, `BudgetFitPanel`, `DefinitionForm({ existing, providers })`. Task 9.13 tests the coverage-check, estimate, create and confirmation flows through `DefinitionsView`.

- [ ] **Step 1: Write the failing test**

`test/views/definitions/form.test.tsx`:

```tsx
import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { defaultDraft, draftToRequest } from '../../../src/views/Definitions/draft.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import { API, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const renderForm = () => renderWithProviders(<DefinitionForm existing={null} providers={providersResponse()} />);
const valueOf = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
/** The chip list inside the Origins or Destinations group. */
const chips = (name: string) => within(screen.getByRole('group', { name })).getByRole('list');

describe('Definitions form defaults (spec §11)', () => {
  it('starts with empty airports and the spec defaults; the plan preset fills providers, policy and budget', async () => {
    const { user } = renderForm();
    expect(chips('Origins').children).toHaveLength(0);
    expect(screen.getByRole('radio', { name: 'Relative to today' })).toBeChecked();
    expect(valueOf('Starts in (days)')).toBe('7');
    expect(valueOf('Length (days)')).toBe('182');
    expect(valueOf('Min nights')).toBe('10');
    expect(valueOf('Max nights')).toBe('21');
    expect(valueOf('Cabin')).toBe('economy');
    await user.click(screen.getByText('Advanced: constraints and policy'));
    expect(valueOf(CONSTRAINT_LABELS.maxJourneyMinutes)).toBe('1500');
    expect(valueOf(`${CONSTRAINT_LABELS.arrivalWindowLocal} from`)).toBe('06:00');
    expect(valueOf(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`)).toBe('23:00');
    expect(valueOf('Max cells per run')).toBe('10');
    expect(valueOf('Top N by discovery price')).toBe('10');
    expect(valueOf('Outbounds expanded per cell')).toBe('2');
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeDisabled();
    expect(screen.getByText('Always on for SearchApi: its sellers can undercut the airline fare.')).toBeInTheDocument();
    expect(valueOf('Max billed calls per run')).toBe('2000');
    expect(valueOf('Travelpayouts refresh interval (hours)')).toBe('168');
    expect(valueOf('Cron (blank: manual runs only)')).toBe('0 5 * * 1');
    expect(valueOf('Time zone')).toBe('Europe/London');
  });

  it('defaultDraft and draftToRequest carry the spec values; the request never carries a confirmation', () => {
    const req = draftToRequest(defaultDraft(providersResponse().presets));
    expect(req).toMatchObject({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } }, scheduleCron: '0 5 * * 1',
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] }, enabled: true,
    });
    expect(req).not.toHaveProperty('confirmedCostPence');
  });
});

describe('airport entry (review focus 1)', () => {
  it('upper-cases a lowercase code on blur and adds it', async () => {
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.type(input, 'lhr');
    await user.tab();
    expect((input as HTMLInputElement).value).toBe('LHR');
    await user.click(screen.getByRole('button', { name: 'Add origin' }));
    expect(within(chips('Origins')).getByText('LHR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove LHR' })).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('rejects a malformed code locally', async () => {
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'L1{Enter}');
    expect(screen.getByText('An airport code is three letters.')).toBeInTheDocument();
  });

  it('autocompletes from GET /api/airports?q=', async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${API}/airports`, ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json([
          { iata: 'LHR', name: 'Heathrow', city: 'London', country: 'United Kingdom', tz: 'Europe/London', metro: 'LON' },
          { iata: 'LGW', name: 'Gatwick', city: 'London', country: 'United Kingdom', tz: 'Europe/London', metro: 'LON' },
        ]);
      }),
    );
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'lon');
    await expect.poll(() => document.querySelectorAll('#origins-options option').length).toBe(2);
    const options = [...document.querySelectorAll('#origins-options option')].map((o) => `${o.getAttribute('value')} ${o.textContent}`);
    expect(options).toEqual(['LHR Heathrow, London, United Kingdom', 'LGW Gatwick, London, United Kingdom']);
    expect(queries.at(-1)).toBe('lon');
  });

  it("shows the API's metro-code message (422 details.fields) under the field it names", async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          { error: { code: 'validation', message: 'invalid definition', details: { fields: [{ field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' }] } } },
          { status: 422 },
        ),
      ),
    );
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'lon{Enter}');
    await user.type(screen.getByLabelText('Destinations'), 'jfk{Enter}');
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    const origins = screen.getByRole('group', { name: 'Origins' });
    expect(await within(origins).findByText('LON is a city code; use one of LHR, LGW')).toBeInTheDocument();
  });
});

describe('per-destination fields and the example (spec §11)', () => {
  it('note and onward cost per destination reach the estimate request in pence', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/estimate`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
      }),
    );
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'LHR{Enter}');
    await user.type(screen.getByLabelText('Destinations'), 'JFK{Enter}');
    await user.type(screen.getByLabelText('Note for JFK (shown on every row)'), 'onward leg not included');
    await user.type(screen.getByLabelText('Onward cost to JFK in £ (optional, shown as a separate adjusted column)'), '25.50');
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ origins: ['LHR'], destinations: ['JFK'], destinationNotes: { JFK: 'onward leg not included' }, onwardCostPence: { JFK: 2550 } });
    expect(bodies[0]).not.toHaveProperty('confirmedCostPence');
  });

  it('"import example" loads the route, window, nights, cabin and constraints of docs/examples/london-new-york.json', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Import example (London to New York)' }));
    expect(valueOf('Name')).toBe('London → New York (example)');
    expect(within(chips('Origins')).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual(['LHR', 'LGW']);
    expect(within(chips('Destinations')).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual(['JFK', 'EWR']);
    expect(valueOf('Min nights')).toBe('10');
    expect(valueOf('Max nights')).toBe('21');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions/form.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Definitions/draft.js"`.

- [ ] **Step 3: Implement**

`docs/examples/london-new-york.json` (stand-in, only when absent; byte-for-byte WP12's Task 12.7 content):

```json
{
  "name": "London → New York (example)",
  "origins": ["LHR", "LGW"],
  "destinations": ["JFK", "EWR"],
  "window": { "kind": "relative", "startOffsetDays": 7, "lengthDays": 182 },
  "minNights": 10,
  "maxNights": 21,
  "cabin": "economy",
  "constraints": {
    "maxJourneyMinutes": 1500,
    "arrivalWindowLocal": { "from": "06:00", "to": "23:00" }
  },
  "verification": {
    "maxCells": 10,
    "topN": 10,
    "alwaysInclude": [],
    "expandTop": 2,
    "bookingLinks": true
  },
  "budget": { "maxCalls": 2000, "maxFreeCalls": 2000, "maxCostMicroGbp": 0 },
  "providers": {
    "discovery": ["travelpayouts", "searchapi"],
    "verification": ["searchapi"],
    "discoveryRefreshHours": { "travelpayouts": 168, "searchapi": 168 }
  },
  "destinationNotes": {},
  "onwardCostPence": {},
  "scheduleCron": "0 5 * * 1",
  "scheduleTz": "Europe/London",
  "enabled": true
}
```

`src/example.ts`:

```ts
import { apiContract } from '@gmt/core';
import example from '../../../docs/examples/london-new-york.json' with { type: 'json' };
import type { DefinitionRequest } from './api/types.js';

/**
 * Spec §1 / §11 "import example": the worked example (London → New York) as a create body.
 * The airport codes live in docs/examples/london-new-york.json (WP12 owns the file and the
 * equality test); this is the one application file allowed to reference them, and
 * scripts/check-boundaries.mjs allowlists it. Parsed with the contract so a drift fails at load.
 */
export const EXAMPLE_DEFINITION: DefinitionRequest = apiContract.definitionCreateRequestSchema.parse(example);
```

`src/views/Definitions/draft.ts`:

```ts
import type { Cabin, Constraints, ExecutionBudget, Iata, ProvidersConfig, VerificationPolicy, WindowSpec } from '@gmt/core';
import type { DefinitionRequest, DefinitionResponse, ProvidersResponse } from '../../api/types.js';

/** The form's model: a definition being edited, before the API validates it. */
export interface Draft {
  name: string;
  origins: string[];
  destinations: string[];
  window: WindowSpec;
  minNights: number;
  maxNights: number;
  cabin: Cabin;
  constraints: Constraints;
  verification: VerificationPolicy;
  budget: ExecutionBudget;
  providers: ProvidersConfig;
  destinationNotes: Record<string, string>;
  onwardCostPence: Record<string, number>;
  scheduleCron: string | null;
  scheduleTz: string;
}

/** Returns a copy with `key` set, or removed when `value` is undefined (exactOptionalPropertyTypes-safe). */
export function withKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else Object.assign(next, { [key]: value });
  return next;
}

/** Trim and upper-case on blur (review focus 1); the API's iataSchema upper-cases too and is the validator. */
export function normaliseIata(s: string): string {
  return s.trim().toUpperCase();
}

/** Spec §11: the create click confirms ceil(estimateMicroGbp / 10 000) pence. */
export function confirmationPence(estimateMicroGbp: number): number {
  return Math.ceil(estimateMicroGbp / 10_000);
}

/** Spec §11 defaults; providers, policy, budget and time zone come from the plan preset (`/api/providers` presets). */
export function defaultDraft(presets: ProvidersResponse['presets']): Draft {
  return {
    name: '',
    origins: [],
    destinations: [],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { ...presets.policy, alwaysInclude: [] },
    budget: { ...presets.budget },
    providers: structuredClone(presets.providers),
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: '0 5 * * 1',
    scheduleTz: presets.schedulerTimezone,
  };
}

const defined = <V>(rec: Partial<Record<string, V>>): Record<string, V> =>
  Object.fromEntries(Object.entries(rec).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])));

export function definitionToDraft(def: DefinitionResponse): Draft {
  return {
    name: def.name,
    origins: [...def.origins],
    destinations: [...def.destinations],
    window: structuredClone(def.window),
    minNights: def.minNights,
    maxNights: def.maxNights,
    cabin: def.cabin,
    constraints: structuredClone(def.constraints),
    verification: structuredClone(def.verification),
    budget: { ...def.budget },
    providers: structuredClone(def.providers),
    destinationNotes: defined(def.destinationNotes),
    onwardCostPence: defined(def.onwardCostPence),
    scheduleCron: def.scheduleCron,
    scheduleTz: def.scheduleTz,
  };
}

/**
 * Loads the example's route, window, nights, cabin, constraints and notes over the draft.
 * why: providers, policy, budget and schedule stay on the plan preset, so importing the example
 * on a £0 install does not ask for SearchApi.
 */
export function applyExample(d: Draft, ex: DefinitionRequest): Draft {
  return {
    ...d,
    name: ex.name,
    origins: [...ex.origins],
    destinations: [...ex.destinations],
    window: structuredClone(ex.window),
    minNights: ex.minNights,
    maxNights: ex.maxNights,
    cabin: ex.cabin,
    constraints: structuredClone(ex.constraints),
    destinationNotes: defined(ex.destinationNotes),
    onwardCostPence: defined(ex.onwardCostPence),
  };
}

/** Only notes and costs for destinations still in the list are sent. */
function forDestinations<V>(rec: Record<string, V>, destinations: readonly string[]): Record<string, V> {
  return Object.fromEntries(Object.entries(rec).filter(([k, v]) => destinations.includes(k) && v !== ''));
}

/** The create/update body (plan `DefinitionInput`): never `confirmedCostPence`, which only the explicit confirmation sets. */
export function draftToRequest(d: Draft): DefinitionRequest {
  return {
    name: d.name,
    // why: unvalidated operator input; the API's zod schema and validateSearchSpace are the validators (spec §6.1).
    origins: d.origins as Iata[],
    destinations: d.destinations as Iata[],
    window: d.window,
    minNights: d.minNights,
    maxNights: d.maxNights,
    cabin: d.cabin,
    constraints: d.constraints,
    verification: d.verification,
    budget: d.budget,
    providers: d.providers,
    destinationNotes: forDestinations(d.destinationNotes, d.destinations) as Partial<Record<Iata, string>>,
    onwardCostPence: forDestinations(d.onwardCostPence, d.destinations) as Partial<Record<Iata, number>>,
    scheduleCron: d.scheduleCron,
    scheduleTz: d.scheduleTz,
    enabled: true,
  } as DefinitionRequest;
}
```

`// why:` the final `as DefinitionRequest` bridges the branded `IsoDate` inside an absolute `window` the operator typed; the server parses it.

`src/views/Definitions/AirportListInput.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAirportSearch } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { normaliseIata } from './draft.js';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface AirportListInputProps {
  id: 'origins' | 'destinations';
  label: string;
  addLabel: string;
  codes: readonly string[];
  onChange: (codes: string[]) => void;
  /** Messages from the API's 422 `details.fields` for this field, e.g. the metro-code message. */
  errors: readonly string[];
}

/** Operator-entered airports with airport-table autocomplete; no preset airports (spec §1, §11). */
export function AirportListInput({ id, label, addLabel, codes, onChange, errors }: AirportListInputProps) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const query = useDebounced(text.trim(), 200);
  const suggestions = useAirportSearch(query);
  const add = () => {
    const code = normaliseIata(text);
    if (!/^[A-Z]{3}$/.test(code)) {
      setLocalError(COPY.iataFormat);
      return;
    }
    setLocalError(null);
    if (!codes.includes(code)) onChange([...codes, code]);
    setText('');
  };
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-semibold">{label}</legend>
      {/* why: the chip list has no label of its own, so getByLabelText(label) finds only the input */}
      <ul className="flex flex-wrap gap-1">
        {codes.map((c) => (
          <li key={c} className="flex items-center gap-1 rounded bg-slate-200 px-1">
            <span>{c}</span>
            <button type="button" aria-label={COPY.removeAirport(c)} onClick={() => onChange(codes.filter((x) => x !== c))}>
              {'×'}
            </button>
          </li>
        ))}
      </ul>
      <span className="flex gap-1">
        <label htmlFor={`${id}-input`} className="sr-only">
          {label}
        </label>
        <input
          id={`${id}-input`}
          list={`${id}-options`}
          value={text}
          aria-describedby={`${id}-help`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText((t) => normaliseIata(t))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="rounded border border-slate-400 px-1"
        />
        <button type="button" aria-label={addLabel} onClick={add} className="rounded border border-slate-500 px-2">
          {COPY.addAirport}
        </button>
      </span>
      <datalist id={`${id}-options`}>
        {(suggestions.data ?? []).map((a) => (
          <option key={a.iata} value={a.iata}>
            {COPY.airportOption(a.name, a.city, a.country)}
          </option>
        ))}
      </datalist>
      <span id={`${id}-help`} className="text-xs text-slate-700">
        {COPY.airportInputHelp}
      </span>
      {localError !== null ? <p role="alert" className="text-red-800">{localError}</p> : null}
      {errors.map((m) => (
        <p key={m} role="alert" className="text-red-800">
          {m}
        </p>
      ))}
    </fieldset>
  );
}
```

`src/views/Definitions/AdvancedFields.tsx`:

```tsx
import type { Constraints, ProviderId, VerificationPolicy } from '@gmt/core';
import { useState } from 'react';
import { COPY } from '../../copy.js';
import { type Draft, withKey } from './draft.js';

/** A labelled non-negative integer input; blank means "not set". */
export function NumberField({ id, label, value, onChange }: { id: string; label: string; value: number | undefined; onChange: (n: number | undefined) => void }) {
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="numeric"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => {
          const t = e.target.value.trim();
          if (t === '') onChange(undefined);
          else if (/^\d+$/.test(t)) onChange(Number(t));
        }}
        className="w-28 rounded border border-slate-400 px-1"
      />
    </span>
  );
}

function TimeWindowField({ id, name, value, onChange }: { id: string; name: string; value: { from: string; to: string } | undefined; onChange: (v: { from: string; to: string } | undefined) => void }) {
  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? '');
  // why: the constraint exists only with both ends; one end alone stays local until the other is filled or cleared.
  const sync = (f: string, t: string) => {
    if (f !== '' && t !== '') onChange({ from: f, to: t });
    else if (f === '' && t === '') onChange(undefined);
  };
  return (
    <span className="flex gap-2">
      <span className="flex flex-col">
        <label htmlFor={`${id}-from`}>{`${name} ${COPY.timeFrom}`}</label>
        <input id={`${id}-from`} type="time" value={from} onChange={(e) => { setFrom(e.target.value); sync(e.target.value, to); }} />
      </span>
      <span className="flex flex-col">
        <label htmlFor={`${id}-to`}>{`${name} ${COPY.timeTo}`}</label>
        <input id={`${id}-to`} type="time" value={to} onChange={(e) => { setTo(e.target.value); sync(from, e.target.value); }} />
      </span>
    </span>
  );
}

function AirlinesField({ id, label, value, onChange }: { id: string; label: string; value: string[] | undefined; onChange: (v: string[] | undefined) => void }) {
  const [text, setText] = useState((value ?? []).join(', '));
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        aria-describedby={`${id}-help`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const codes = text.split(',').map((c) => c.trim().toUpperCase()).filter((c) => c.length > 0);
          onChange(codes.length > 0 ? codes : undefined);
        }}
        className="rounded border border-slate-400 px-1"
      />
      <span id={`${id}-help`} className="text-xs">{COPY.airlinesHelp}</span>
    </span>
  );
}

function Check({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-1">
      <input id={id} type="checkbox" checked={checked} disabled={disabled === true} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}

export interface ProviderCapabilities {
  id: ProviderId;
  displayName: string;
  discovery: boolean;
  verification: boolean;
}

/** Spec §11 advanced fold: every constraint, the verification policy, providers, budget and schedule. */
export function AdvancedFields({ draft, setDraft, capabilities }: { draft: Draft; setDraft: (d: Draft) => void; capabilities: readonly ProviderCapabilities[] }) {
  const c = draft.constraints;
  const v = draft.verification;
  const setC = <K extends keyof Constraints>(k: K, value: Constraints[K] | undefined) => setDraft({ ...draft, constraints: withKey(c, k, value) });
  const setV = <K extends keyof VerificationPolicy>(k: K, value: VerificationPolicy[K] | undefined) => setDraft({ ...draft, verification: withKey(v, k, value) });
  // why: spec §5.4, bookingLinks is forced true whenever SearchApi verifies (zod enforces it too).
  const forcedBooking = draft.providers.verification.includes('searchapi');
  const toggleProvider = (stage: 'discovery' | 'verification', id: ProviderId, on: boolean) => {
    const list = draft.providers[stage].filter((p) => p !== id);
    const providers = { ...draft.providers, [stage]: on ? [...list, id] : list };
    const verification = stage === 'verification' && id === 'searchapi' && on ? { ...v, bookingLinks: true } : v;
    setDraft({ ...draft, providers, verification });
  };
  return (
    <div className="mt-2 space-y-3">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.constraintsHeading}</legend>
        <NumberField id="c-maxStops" label={COPY.constraint.maxStops} value={c.maxStops} onChange={(n) => setC('maxStops', n)} />
        <NumberField id="c-maxJourney" label={COPY.constraint.maxJourneyMinutes} value={c.maxJourneyMinutes} onChange={(n) => setC('maxJourneyMinutes', n)} />
        <NumberField id="c-minLayover" label={COPY.constraint.minLayoverMinutes} value={c.minLayoverMinutes} onChange={(n) => setC('minLayoverMinutes', n)} />
        <NumberField id="c-maxLayover" label={COPY.constraint.maxLayoverMinutes} value={c.maxLayoverMinutes} onChange={(n) => setC('maxLayoverMinutes', n)} />
        <Check id="c-overnight" label={COPY.constraint.noOvernightLayover} checked={c.noOvernightLayover === true} onChange={(b) => setC('noOvernightLayover', b ? true : undefined)} />
        <TimeWindowField id="c-departure" name={COPY.constraint.departureWindowLocal} value={c.departureWindowLocal} onChange={(w) => setC('departureWindowLocal', w)} />
        <TimeWindowField id="c-arrival" name={COPY.constraint.arrivalWindowLocal} value={c.arrivalWindowLocal} onChange={(w) => setC('arrivalWindowLocal', w)} />
        <Check id="c-selfTransfer" label={COPY.constraint.noSelfTransfer} checked={c.noSelfTransfer === true} onChange={(b) => setC('noSelfTransfer', b ? true : undefined)} />
        <Check id="c-airportChange" label={COPY.constraint.noAirportChange} checked={c.noAirportChange === true} onChange={(b) => setC('noAirportChange', b ? true : undefined)} />
        <AirlinesField id="c-include" label={COPY.constraint.includeAirlines} value={c.includeAirlines} onChange={(a) => setC('includeAirlines', a)} />
        <AirlinesField id="c-exclude" label={COPY.constraint.excludeAirlines} value={c.excludeAirlines} onChange={(a) => setC('excludeAirlines', a)} />
        <Check id="c-cabinBag" label={COPY.constraint.cabinBagRequired} checked={c.cabinBagRequired === true} onChange={(b) => setC('cabinBagRequired', b ? true : undefined)} />
        <Check id="c-checkedBag" label={COPY.constraint.checkedBagRequired} checked={c.checkedBagRequired === true} onChange={(b) => setC('checkedBagRequired', b ? true : undefined)} />
        <NumberField id="c-minBags" label={COPY.constraint.minCheckedBags} value={c.minCheckedBags} onChange={(n) => setC('minCheckedBags', n)} />
        <NumberField id="c-maxPrice" label={COPY.constraint.maxPricePence} value={c.maxPricePence} onChange={(n) => setC('maxPricePence', n)} />
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.providersSection}</legend>
        <span className="flex flex-col">
          <span>{COPY.discoveryProviders}</span>
          {capabilities.filter((p) => p.discovery).map((p) => (
            <Check key={p.id} id={`p-d-${p.id}`} label={p.displayName} checked={draft.providers.discovery.includes(p.id)} onChange={(b) => toggleProvider('discovery', p.id, b)} />
          ))}
        </span>
        <span className="flex flex-col">
          <span>{COPY.verificationProviders}</span>
          {capabilities.filter((p) => p.verification).map((p) => (
            <Check key={p.id} id={`p-v-${p.id}`} label={p.displayName} checked={draft.providers.verification.includes(p.id)} onChange={(b) => toggleProvider('verification', p.id, b)} />
          ))}
        </span>
        {draft.providers.discovery.map((id) => (
          <NumberField
            key={id}
            id={`p-refresh-${id}`}
            label={COPY.refreshHours(COPY.provider[id])}
            value={draft.providers.discoveryRefreshHours[id]}
            onChange={(n) => setDraft({ ...draft, providers: { ...draft.providers, discoveryRefreshHours: withKey(draft.providers.discoveryRefreshHours, id, n) } })}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.policyHeading}</legend>
        <NumberField id="v-maxCells" label={COPY.maxCells} value={v.maxCells} onChange={(n) => setV('maxCells', n ?? 0)} />
        <NumberField id="v-topN" label={COPY.topN} value={v.topN} onChange={(n) => setV('topN', n ?? 0)} />
        <NumberField id="v-ceiling" label={COPY.priceCeilingPence} value={v.priceCeilingPence} onChange={(n) => setV('priceCeilingPence', n)} />
        <NumberField id="v-perDate" label={COPY.perDepartureDateBest} value={v.perDepartureDateBest} onChange={(n) => setV('perDepartureDateBest', n)} />
        <NumberField id="v-expandTop" label={COPY.expandTop} value={v.expandTop} onChange={(n) => setV('expandTop', n ?? 0)} />
        <span className="flex flex-col">
          <Check id="v-booking" label={COPY.bookingLinks} checked={forcedBooking || v.bookingLinks} disabled={forcedBooking} onChange={(b) => setV('bookingLinks', b)} />
          {forcedBooking ? <span className="text-xs">{COPY.bookingLinksForced}</span> : null}
        </span>
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.budgetHeading}</legend>
        <NumberField id="b-calls" label={COPY.maxCalls} value={draft.budget.maxCalls} onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxCalls: n ?? 0 } })} />
        <NumberField id="b-free" label={COPY.maxFreeCalls} value={draft.budget.maxFreeCalls} onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxFreeCalls: n ?? 0 } })} />
        <NumberField
          id="b-cost"
          label={COPY.maxCostPence}
          value={Math.floor(draft.budget.maxCostMicroGbp / 10_000)}
          onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxCostMicroGbp: (n ?? 0) * 10_000 } })}
        />
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.scheduleHeading}</legend>
        <span className="flex flex-col">
          <label htmlFor="s-cron">{COPY.scheduleCron}</label>
          <input
            id="s-cron"
            value={draft.scheduleCron ?? ''}
            onChange={(e) => setDraft({ ...draft, scheduleCron: e.target.value.trim() === '' ? null : e.target.value })}
            className="rounded border border-slate-400 px-1"
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="s-tz">{COPY.scheduleTz}</label>
          <input id="s-tz" value={draft.scheduleTz} onChange={(e) => setDraft({ ...draft, scheduleTz: e.target.value })} className="rounded border border-slate-400 px-1" />
        </span>
      </fieldset>
    </div>
  );
}
```

`src/views/Definitions/CoverageCheck.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import type { Iata } from '@gmt/core';
import { COPY } from '../../copy.js';
import type { Draft } from './draft.js';

/** Spec §10/§11: free Travelpayouts month tiles for the entered pairs, cached rows per pair per month, before saving. */
export function CoverageCheck({ draft, available }: { draft: Draft; available: boolean }) {
  const check = useMutation({
    mutationFn: () =>
      api.coverageCheck({
        // why: unvalidated input, validated by the API (spec §6.1).
        origins: draft.origins as Iata[],
        destinations: draft.destinations as Iata[],
        window: draft.window,
        minNights: draft.minNights,
        maxNights: draft.maxNights,
      }),
  });
  if (!available) return <p className="text-sm">{COPY.coverageCheckNeedsTravelpayouts}</p>;
  const months = [...new Set((check.data?.pairs ?? []).flatMap((p) => p.months.map((m) => m.month)))].sort();
  return (
    <section aria-label={COPY.coverageCheck} className="space-y-1 text-sm">
      <p>{COPY.coverageCheckIntro}</p>
      <button
        type="button"
        className="rounded border border-slate-500 px-2"
        disabled={draft.origins.length === 0 || draft.destinations.length === 0 || check.isPending}
        onClick={() => check.mutate()}
      >
        {COPY.coverageCheck}
      </button>
      {check.error ? <p role="alert">{COPY.actionFailed(check.error.message)}</p> : null}
      {check.data !== undefined ? (
        <>
          <table aria-label={COPY.coverageCheck} className="border-collapse">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">{COPY.coverageCheckMonth}</th>
                {months.map((m) => (
                  <th key={m} scope="col" className="p-1 text-right">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {check.data.pairs.map((p) => (
                <tr key={`${p.origin}-${p.destination}`}>
                  <th scope="row" className="p-1 text-left font-normal">{COPY.coverageCheckPair(p.origin, p.destination)}</th>
                  {months.map((m) => (
                    <td key={m} className="p-1 text-right tabular-nums">{p.months.find((x) => x.month === m)?.cachedRows ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>{COPY.coverageCheckCalls(check.data.calls)}</p>
          {check.data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </>
      ) : null}
    </section>
  );
}
```

`src/views/Definitions/EstimatePanel.tsx`:

```tsx
import type { DefinitionResponse, Estimate } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatSeconds } from '../../format.js';

/** Spec §11: the estimate shown before the operator confirms (POST /api/definitions/estimate for an unsaved body). */
export function EstimatePanel({ estimate }: { estimate: Estimate }) {
  const e = estimate;
  return (
    <section aria-label={COPY.estimateHeading} className="space-y-1 rounded border border-slate-300 p-2 text-sm">
      <h3 className="font-semibold">{COPY.estimateHeading}</h3>
      <p>{COPY.estimateCells(e.cells)}</p>
      <ul>
        {e.perProvider.map((p) => (
          <li key={`${p.providerId}-${p.stage}`}>
            {COPY.estimateRow(COPY.provider[p.providerId], COPY.stageName[p.stage] ?? p.stage, p.calls, formatMicroGbp(p.costMicroGbp), formatSeconds(p.seconds))}
            {p.blocked !== null ? <span className="ml-1 font-semibold">{COPY.estimateBlocked(p.blocked)}</span> : null}
          </li>
        ))}
      </ul>
      <p className="font-medium">{COPY.estimateTotal(formatMicroGbp(e.totalCostMicroGbp), formatSeconds(e.seconds))}</p>
      {e.windowClamped ? <p>{COPY.windowClamped}</p> : null}
      {e.assumptions.length > 0 ? (
        <div>
          <p>{COPY.assumptions}</p>
          <ul className="list-disc pl-5">
            {e.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Spec §8.2: budgetFit (runs per month × estimate vs every cap), from the estimate response before the create click and from the saved definition after; a miss is an alert. */
export function BudgetFitPanel({ fit }: { fit: DefinitionResponse['budgetFit'] }) {
  return fit.fits ? (
    <p className="text-sm">{COPY.budgetFitOk(fit.runsPerMonth)}</p>
  ) : (
    <div role="alert" className="text-sm">
      <p className="font-semibold">{COPY.budgetFitWarn(fit.runsPerMonth)}</p>
      <ul>
        {fit.perScope
          .filter((s) => !s.fits)
          .map((s) => (
            <li key={s.scope}>{COPY.budgetScope(s.scope, s.estimated, s.cap === null ? COPY.noCap : String(s.cap))}</li>
          ))}
      </ul>
    </div>
  );
}
```

`src/views/Definitions/DefinitionForm.tsx`:

```tsx
import type { Cabin, IsoDate } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse, EstimateResponse, ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { EXAMPLE_DEFINITION } from '../../example.js';
import { formatMicroGbp, formatPence, parsePoundsToPence, penceToPoundsInput } from '../../format.js';
import { updateSearchParams } from '../../state/urlState.js';
import { AdvancedFields, NumberField, type ProviderCapabilities } from './AdvancedFields.js';
import { AirportListInput } from './AirportListInput.js';
import { CoverageCheck } from './CoverageCheck.js';
import { applyExample, confirmationPence, type Draft, defaultDraft, definitionToDraft, draftToRequest, withKey } from './draft.js';
import { BudgetFitPanel, EstimatePanel } from './EstimatePanel.js';

const CABINS: readonly Cabin[] = ['economy', 'premium_economy', 'business', 'first'];

/** Field errors whose path is `field` or starts with `field.` (422 `details.fields`). */
const errorsFor = (errors: ReadonlyArray<{ field: string; message: string }>, field: string) =>
  errors.filter((e) => e.field === field || e.field.startsWith(`${field}.`)).map((e) => e.message);

/**
 * Spec §11 Definitions form. New definition: "Show estimate" calls POST /api/definitions/estimate
 * with the unsaved body and shows the estimate and budgetFit; "Create and confirm" is the explicit confirmation, a POST carrying
 * confirmedCostPence = ceil(estimate / 10 000) (spec §8.1). Editing the draft after an estimate
 * hides Create until it is re-estimated. Saved definition: "Save changes" PUTs; a needsConfirmation
 * response asks again before scheduled runs proceed.
 */
export function DefinitionForm({ existing, providers }: { existing: DefinitionResponse | null; providers: ProvidersResponse }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => (existing ? definitionToDraft(existing) : defaultDraft(providers.presets)));
  const [saved, setSaved] = useState<DefinitionResponse | null>(existing);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimatedFor, setEstimatedFor] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const capabilities: ProviderCapabilities[] = providers.providers
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.providerId, displayName: p.displayName, discovery: p.capabilities.discovery !== null, verification: p.capabilities.verification !== null }));
  const travelpayouts = providers.providers.some((p) => p.providerId === 'travelpayouts' && p.enabled);
  const current = JSON.stringify(draft);

  const refresh = () => qc.invalidateQueries({ queryKey: ['definitions'] });
  const onError = (e: Error) => {
    setFieldErrors(e instanceof ApiError ? e.fieldErrors() : []);
    setNotice(COPY.actionFailed(e.message));
  };
  const accept = (d: DefinitionResponse, message: string | null) => {
    setSaved(d);
    setFieldErrors([]);
    setNotice(message);
    void refresh();
  };

  const estimateDraft = useMutation({
    mutationFn: () => api.estimateDraft(draftToRequest(draft)),
    onSuccess: (e) => {
      setEstimate(e);
      setEstimatedFor(current);
      setFieldErrors([]);
      setNotice(null);
    },
    onError,
  });
  const create = useMutation({
    mutationFn: (e: EstimateResponse) => api.createDefinition({ ...draftToRequest(draft), confirmedCostPence: confirmationPence(e.estimate.totalCostMicroGbp) }),
    onSuccess: (d) => {
      accept(d, COPY.created);
      // why: only the selected definition changes; edit= stays, so the form keeps its confirmation notice.
      updateSearchParams({ def: d.id });
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (s: DefinitionResponse) => api.updateDefinition(s.id, draftToRequest(draft)),
    onSuccess: (d) => accept(d, COPY.saved),
    onError,
  });
  const confirm = useMutation({
    mutationFn: (v: { id: string; pence: number }) => api.updateDefinition(v.id, { confirmedCostPence: v.pence }),
    onSuccess: (d) => accept(d, COPY.saved),
    onError,
  });

  const w = draft.window;
  const n = saved?.needsConfirmation ?? null;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-3 text-sm">
      {fieldErrors.length > 0 ? (
        <div role="alert" className="rounded border border-red-700 p-2">
          <p className="font-semibold">{COPY.fieldErrorsHeading}</p>
          <ul>
            {fieldErrors.map((e) => (
              <li key={`${e.field}-${e.message}`}>{COPY.fieldError(e.field, e.message)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {saved !== null && saved.notices.length > 0 ? (
        <ul aria-label={COPY.definitionNotices} className="rounded border border-amber-700 bg-amber-50 p-2">
          {saved.notices.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="rounded border border-slate-500 px-2" onClick={() => setDraft(applyExample(draft, EXAMPLE_DEFINITION))}>
        {COPY.importExample}
      </button>
      <span className="flex flex-col">
        <label htmlFor="d-name">{COPY.name}</label>
        <input id="d-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="rounded border border-slate-400 px-1" />
      </span>
      <AirportListInput id="origins" label={COPY.origins} addLabel={COPY.addOrigin} codes={draft.origins} onChange={(origins) => setDraft({ ...draft, origins })} errors={errorsFor(fieldErrors, 'origins')} />
      <AirportListInput id="destinations" label={COPY.destinations} addLabel={COPY.addDestination} codes={draft.destinations} onChange={(destinations) => setDraft({ ...draft, destinations })} errors={errorsFor(fieldErrors, 'destinations')} />
      {draft.destinations.map((d) => (
        <span key={d} className="flex flex-wrap gap-3">
          <span className="flex flex-col">
            <label htmlFor={`note-${d}`}>{COPY.destinationNote(d)}</label>
            <input
              id={`note-${d}`}
              value={draft.destinationNotes[d] ?? ''}
              onChange={(e) => setDraft({ ...draft, destinationNotes: { ...draft.destinationNotes, [d]: e.target.value } })}
              className="rounded border border-slate-400 px-1"
            />
          </span>
          <span className="flex flex-col">
            <label htmlFor={`onward-${d}`}>{COPY.onwardCost(d)}</label>
            <input
              id={`onward-${d}`}
              inputMode="decimal"
              defaultValue={penceToPoundsInput(draft.onwardCostPence[d])}
              onBlur={(e) => setDraft({ ...draft, onwardCostPence: withKey(draft.onwardCostPence, d, parsePoundsToPence(e.target.value)) })}
              className="rounded border border-slate-400 px-1"
            />
          </span>
        </span>
      ))}
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="font-semibold">{COPY.windowHeading}</legend>
        <span className="flex items-center gap-1">
          <input id="w-relative" type="radio" name="window" checked={w.kind === 'relative'} onChange={() => setDraft({ ...draft, window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 } })} />
          <label htmlFor="w-relative">{COPY.windowRelative}</label>
        </span>
        <span className="flex items-center gap-1">
          <input
            id="w-absolute"
            type="radio"
            name="window"
            checked={w.kind === 'absolute'}
            // why: empty dates until the operator picks them; the API rejects an incomplete window (spec §6.1).
            onChange={() => setDraft({ ...draft, window: { kind: 'absolute', from: '' as IsoDate, to: '' as IsoDate } })}
          />
          <label htmlFor="w-absolute">{COPY.windowAbsolute}</label>
        </span>
        {w.kind === 'relative' ? (
          <>
            <NumberField id="w-offset" label={COPY.startOffsetDays} value={w.startOffsetDays} onChange={(v) => setDraft({ ...draft, window: { ...w, startOffsetDays: v ?? 0 } })} />
            <NumberField id="w-length" label={COPY.lengthDays} value={w.lengthDays} onChange={(v) => setDraft({ ...draft, window: { ...w, lengthDays: v ?? 0 } })} />
          </>
        ) : (
          <>
            <span className="flex flex-col">
              <label htmlFor="w-from">{COPY.windowFrom}</label>
              <input id="w-from" type="date" value={w.from} onChange={(e) => setDraft({ ...draft, window: { ...w, from: e.target.value as IsoDate } })} />
            </span>
            <span className="flex flex-col">
              <label htmlFor="w-to">{COPY.windowTo}</label>
              <input id="w-to" type="date" value={w.to} onChange={(e) => setDraft({ ...draft, window: { ...w, to: e.target.value as IsoDate } })} />
            </span>
          </>
        )}
        <NumberField id="n-min" label={COPY.minNights} value={draft.minNights} onChange={(v) => setDraft({ ...draft, minNights: v ?? 0 })} />
        <NumberField id="n-max" label={COPY.maxNights} value={draft.maxNights} onChange={(v) => setDraft({ ...draft, maxNights: v ?? 0 })} />
        <span className="flex flex-col">
          <label htmlFor="d-cabin">{COPY.cabin}</label>
          <select id="d-cabin" value={draft.cabin} onChange={(e) => setDraft({ ...draft, cabin: e.target.value as Cabin })}>
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {COPY.cabinName[c]}
              </option>
            ))}
          </select>
        </span>
      </fieldset>
      <details>
        <summary className="cursor-pointer font-semibold">{COPY.advanced}</summary>
        <AdvancedFields draft={draft} setDraft={setDraft} capabilities={capabilities} />
      </details>
      <CoverageCheck draft={draft} available={travelpayouts} />
      <div className="flex flex-wrap gap-2">
        {saved === null ? (
          <button type="button" className="rounded border border-slate-700 px-2" onClick={() => estimateDraft.mutate()}>
            {COPY.showEstimate}
          </button>
        ) : (
          <button type="button" className="rounded border border-slate-700 px-2" onClick={() => save.mutate(saved)}>
            {COPY.save}
          </button>
        )}
        {saved === null && estimate !== null && estimatedFor === current ? (
          <button type="button" className="rounded bg-slate-900 px-2 text-white" onClick={() => create.mutate(estimate)}>
            {COPY.createConfirm(formatPence(confirmationPence(estimate.estimate.totalCostMicroGbp)))}
          </button>
        ) : null}
      </div>
      {saved !== null && n !== null ? (
        <div role="alert" className="rounded border border-amber-700 bg-amber-50 p-2">
          <p>{COPY.needsConfirmation(formatMicroGbp(n.estimateMicroGbp), n.confirmedCostPence === null ? COPY.none : formatPence(n.confirmedCostPence))}</p>
          <button
            type="button"
            className="rounded border border-slate-700 px-2"
            onClick={() => confirm.mutate({ id: saved.id, pence: confirmationPence(n.estimateMicroGbp) })}
          >
            {COPY.confirmNew(formatPence(confirmationPence(n.estimateMicroGbp)))}
          </button>
        </div>
      ) : null}
      {saved === null && estimate !== null ? (
        <>
          <EstimatePanel estimate={estimate.estimate} />
          <BudgetFitPanel fit={estimate.budgetFit} />
        </>
      ) : null}
      {saved?.estimate ? <EstimatePanel estimate={saved.estimate} /> : null}
      {saved !== null ? <BudgetFitPanel fit={saved.budgetFit} /> : null}
      {notice !== null ? <p role="status">{notice}</p> : null}
    </form>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions/form.test.tsx test/copy`
Expected: PASS, 8 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/examples && git commit -m "wp09: Definitions form with airport autocomplete, defaults, advanced fold, example import"
```

### Task 9.13: Definitions view, estimate-then-create flow, final App wiring

**Files:**
- Create: `src/views/Definitions/DefinitionsView.tsx`
- Modify: `src/App.tsx` (final form below)
- Test: `test/views/definitions/create.test.tsx`

**Interfaces:**
- Consumes: `DefinitionForm`, `CoverageCheck`, `EstimatePanel`, `BudgetFitPanel` (Task 9.12); every view of Tasks 9.5–9.11; `StatusBar` (Task 9.6); `POST /api/definitions/estimate` (`{ estimate, budgetFit }`), `POST /api/definitions` (with `confirmedCostPence?`), `PUT /api/definitions/:id` (`needsConfirmation`, `notices`).
- Produces: `DefinitionsView()`, the final `App()`.

- [ ] **Step 1: Write the failing test**

`test/views/definitions/create.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../../src/App.js';
import { DefinitionsView } from '../../../src/views/Definitions/DefinitionsView.js';
import { API, coverageCheck, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const pricedEstimate = estimate({ totalCostMicroGbp: 12_345, totalCostPence: 2 });
const estimateBody = (budgetFit = definition().budgetFit) => ({ estimate: pricedEstimate, budgetFit });

async function importAndEstimate(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Import example (London to New York)' }));
  await user.click(screen.getByRole('button', { name: 'Show estimate' }));
}

describe('coverage check before saving (spec §1, §10, §11)', () => {
  it('posts the entered pairs, window and nights and shows cached rows per pair per month', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/coverage-check`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(coverageCheck);
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: '?view=definitions' });
    await user.click(await screen.findByRole('button', { name: 'Import example (London to New York)' }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    const table = await screen.findByRole('table', { name: 'Check free coverage' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Month', '2027-03', '2027-04']);
    expect([...(within(table).getAllByRole('row')[1]?.querySelectorAll('th, td') ?? [])].map((c) => c.textContent)).toEqual(['LHR → JFK', '5', '0']);
    expect(screen.getByText('14 free calls used')).toBeInTheDocument();
    expect(bodies).toEqual([
      { origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'], window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21 },
    ]);
  });

  it('says what it needs when Travelpayouts is not configured', async () => {
    const base = providersResponse();
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ ...base, providers: base.providers.map((p) => (p.providerId === 'travelpayouts' ? { ...p, enabled: false } : p)) }),
      ),
    );
    renderWithProviders(<DefinitionsView />);
    expect(await screen.findByText('The free coverage check needs TRAVELPAYOUTS_TOKEN.')).toBeInTheDocument();
  });
});

describe('estimate, then the create click as the explicit confirmation (spec §8.1, §11)', () => {
  it('estimates the unsaved body; Create POSTs it with confirmedCostPence = ceil(estimate / 10 000)', async () => {
    const estimates: unknown[] = [];
    const creates: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/estimate`, async ({ request }) => {
        estimates.push(await request.json());
        return HttpResponse.json(estimateBody());
      }),
      http.post(`${API}/definitions`, async ({ request }) => {
        creates.push(await request.json());
        return HttpResponse.json(definition({ id: 'def-0002', confirmedCostPence: 2, estimate: pricedEstimate }));
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    const panel = await screen.findByRole('region', { name: 'Estimate' });
    expect(within(panel).getByText('2184 cells')).toBeInTheDocument();
    expect(within(panel).getByText('Travelpayouts discovery: 14 calls · £0 · about 20s')).toBeInTheDocument();
    expect(within(panel).getByText('total £0.02 per run · about 20s')).toBeInTheDocument();
    expect(screen.getByText('Fits every cap at 4 runs a month.')).toBeInTheDocument();
    expect(estimates[0]).toMatchObject({ origins: ['LHR', 'LGW'], enabled: true });
    expect(estimates[0]).not.toHaveProperty('confirmedCostPence');
    expect(creates).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Create and confirm up to £0.02 per run' }));
    await expect.poll(() => creates.length).toBe(1);
    expect(creates[0]).toMatchObject({ origins: ['LHR', 'LGW'], enabled: true, confirmedCostPence: 2 });
    expect(await screen.findByRole('status')).toHaveTextContent('Created. Scheduled runs use the cost you confirmed.');
    expect(screen.getByText('Fits every cap at 4 runs a month.')).toBeInTheDocument();
  });

  it('editing after an estimate hides Create until the draft is re-estimated', async () => {
    server.use(http.post(`${API}/definitions/estimate`, () => HttpResponse.json(estimateBody())));
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    await screen.findByRole('button', { name: /Create and confirm/ });
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
    expect(screen.queryByRole('button', { name: /Create and confirm/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByRole('button', { name: /Create and confirm/ })).toBeInTheDocument();
  });

  it('a budgetFit miss is shown as an alert before the create click', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(estimateBody({ fits: false, runsPerMonth: 4, perScope: [{ scope: 'provider-month:searchapi', estimated: 12000, cap: 10000, fits: false }] })),
      ),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    expect(await screen.findByText('Does not fit every cap at 4 runs a month:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create and confirm/ })).toBeInTheDocument();
    expect(screen.getByText('provider-month:searchapi: 12000 estimated, cap 10000')).toBeInTheDocument();
  });
});

describe('saved definitions (spec §8.1)', () => {
  it('a save that raises the estimate above the confirmation asks again, and Confirm PUTs ceil(estimate / 10 000)', async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/definitions/:id`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(
          puts.length === 1 ? definition({ needsConfirmation: { estimateMicroGbp: 2_500_000, confirmedCostPence: 100 } }) : definition({ confirmedCostPence: 250 }),
        );
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The new estimate (£2.50 per run) is above your confirmation (£1). Scheduled runs are skipped until you confirm.'),
    ).toBeInTheDocument();
    expect(puts[0]).not.toHaveProperty('confirmedCostPence');
    await user.click(screen.getByRole('button', { name: 'Confirm up to £2.50 per run' }));
    await expect.poll(() => puts.at(-1)).toEqual({ confirmedCostPence: 250 });
  });

  it("shows the definition's notices from the API", async () => {
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json([definition({ notices: ['alerts running on calendar basis only'] })])));
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    const list = await screen.findByRole('list', { name: 'Notices for this definition' });
    expect(within(list).getByText('alerts running on calendar basis only')).toBeInTheDocument();
  });
});

describe('the App (spec §11 layout)', () => {
  it('filter state persists across a view switch, and the status bar is on every view', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001&f.class=partially-verified' });
    const table = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    await user.click(within(nav).getByRole('link', { name: 'Providers' }));
    expect(await screen.findByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Run status' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Results' }));
    const again = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(again).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'partially verified' })).toBeChecked();
  });

  it('Coverage is reachable from the Results header link', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001' });
    await user.click(await screen.findByRole('link', { name: /^discovery: / }));
    expect(await screen.findByRole('table', { name: 'Coverage' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions/create.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Definitions/DefinitionsView.js"`.

- [ ] **Step 3: Implement**

`src/views/Definitions/DefinitionsView.tsx`:

```tsx
import { useDefinitions, useProviders } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { DefinitionForm } from './DefinitionForm.js';

/** Spec §11 Definitions: pick a definition to edit or start a new one (`edit=new`, the default). */
export function DefinitionsView() {
  const providers = useProviders();
  const definitions = useDefinitions();
  const params = useSearchParams();
  const editing = params.get('edit') ?? 'new';
  const failure = providers.error ?? definitions.error;
  if (failure) return <p role="alert">{COPY.loadFailed(failure.message)}</p>;
  if (providers.data === undefined || definitions.data === undefined) return <p>{COPY.loading}</p>;
  const current = definitions.data.filter((d) => d.deletedAt === null);
  const existing = editing === 'new' ? null : (current.find((d) => d.id === editing) ?? null);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{COPY.definitionsHeading}</h2>
      <ul className="flex flex-wrap gap-2 text-sm">
        <li>
          <a href={hrefWith({ edit: 'new' })} onClick={navigateTo({ edit: 'new' })} aria-current={editing === 'new' ? 'page' : undefined} className="underline">
            {COPY.newDefinition}
          </a>
        </li>
        {current.map((d) => (
          <li key={d.id}>
            <a href={hrefWith({ edit: d.id })} onClick={navigateTo({ edit: d.id })} aria-current={editing === d.id ? 'page' : undefined} className="underline">
              {COPY.editDefinition(d.name)}
            </a>
          </li>
        ))}
      </ul>
      {/* why: keyed by the URL's edit value, so a create that stays on edit=new keeps its confirmation notice */}
      <DefinitionForm key={editing} existing={existing} providers={providers.data} />
    </div>
  );
}
```

`src/App.tsx` (final):

```tsx
import { useDefinitions, useProviders } from './api/queries.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { Nav } from './components/Nav.js';
import { StatusBar } from './components/StatusBar.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { useSearchParams } from './state/urlState.js';
import { parseView } from './state/view.js';
import { CoverageView } from './views/Coverage/CoverageView.js';
import { DefinitionsView } from './views/Definitions/DefinitionsView.js';
import { Placeholder } from './views/Placeholder.js';
import { ProvidersView } from './views/Providers/ProvidersView.js';
import { ResultsView } from './views/Results/ResultsView.js';

/** Spec §11 layout: synthetic banner, header with nav and definition selector, status bar on every view. */
export function App() {
  const params = useSearchParams();
  const view = parseView(params.get('view'));
  const providers = useProviders();
  const definitions = useDefinitions();
  const list = (definitions.data ?? []).filter((d) => d.deletedAt === null);
  const selectedId = params.get('def') ?? list[0]?.id ?? null;
  const selected = list.find((d) => d.id === selectedId) ?? null;
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  const needsDefinition = view === 'results' || view === 'coverage';
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-300 px-4 py-2">
        <h1 className="text-lg font-bold">{COPY.appTitle}</h1>
        <Nav current={view} />
        <DefinitionSelector definitions={list} selectedId={selectedId} />
      </header>
      <StatusBar definition={selected} />
      <main className="px-4 py-3">
        {noProviders ? <p className="mb-3 rounded border border-slate-400 p-3">{COPY.emptyNoProviders}</p> : null}
        {needsDefinition && definitions.data !== undefined && selected === null ? <p>{COPY.noDefinitions}</p> : null}
        {view === 'results' && selected !== null ? <ResultsView definition={selected} /> : null}
        {view === 'coverage' && selected !== null ? <CoverageView definition={selected} /> : null}
        {view === 'calendar' || view === 'duration' || view === 'history' ? <Placeholder wp="WP10" /> : null}
        {view === 'alerts' ? <Placeholder wp="WP11" /> : null}
        {view === 'definitions' ? <DefinitionsView /> : null}
        {view === 'providers' ? <ProvidersView /> : null}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions test/app test/copy`
Expected: PASS, 8 + 9 + 6 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: Definitions view with create-and-confirm flow; final App wiring"
```

### Task 9.14: Banned-word sweep over every rendered view

**Files:**
- Test: `test/copy/renderedSweep.test.tsx`

**Interfaces:**
- Consumes: `App` (Task 9.13), `findBannedWords`, `BANNED_WORD_ALLOWLIST` (WP0).
- Produces: nothing new; closes spec §9 item 6's banned-word row for WP9's views.

- [ ] **Step 1: Write the failing test**

`test/copy/renderedSweep.test.tsx`:

```tsx
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { VIEWS } from '../../src/state/view.js';
import { API, calendarGap, calendarRow, failedRow, partialRow, providersResponse, resultsResponse, verifiedRow } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

/** Every visible string plus the attributes a screen reader or tooltip shows. */
function renderedCopy(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')].flatMap((el) =>
    ['title', 'aria-label', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

describe('rendered views contain no banned word (spec §11, §9 item 6)', () => {
  for (const view of VIEWS) {
    it(`view=${view}`, async () => {
      server.use(
        http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))),
        http.get(`${API}/definitions/:id/results`, () =>
          HttpResponse.json(resultsResponse({ rows: [verifiedRow(), partialRow(), failedRow(), calendarRow()], truncated: true })),
        ),
        http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())),
      );
      const { user } = renderWithProviders(<App />, { search: `?view=${view}&def=def-0001` });
      await screen.findByRole('navigation', { name: 'Views' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      if (view === 'results') {
        // why: failed rows are hidden by default (spec §6.9); select every class so all rows' copy is swept.
        for (const name of ['verified', 'partially verified', 'failed', 'constraints not checked']) {
          await user.click(await screen.findByRole('checkbox', { name }));
        }
        for (const b of await screen.findAllByRole('button', { name: /Show details/ })) await user.click(b);
      }
      if (view === 'definitions') await user.click(screen.getByText('Advanced: constraints and policy'));
      const hits = findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST);
      expect(hits.map((h) => h.word)).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Prove the sweep bites: temporarily set `statusBarLabel: 'Live run status'` in `src/copy.ts`.

Run: `pnpm --filter @gmt/web exec vitest run test/copy/renderedSweep.test.tsx`
Expected: FAIL in all 8 cases with `expected [ 'live' ] to deeply equal []` (the label is an `aria-label` on every view). The catalogue test fails too, naming `statusBarLabel`.

- [ ] **Step 3: Implement**

Restore `statusBarLabel: 'Run status'`. No other production change; any real hit is fixed by rewording in `src/copy.ts`, never by allowlisting.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/copy`
Expected: PASS, 8 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: banned-word sweep over every rendered view"
```

## 9. Pinned review-focus tests

The plan's Review Focus lines this package owns:

- **Review focus 1 (WP9 half): "Operator types a lowercase or metropolitan IATA code (`lhr`, `LON`, `NYC`) into the Definitions form or the example JSON. Expected: upper-cased before validation; a metro code is rejected with a message naming it as a city code and listing the airports the table maps to it."** WP1 owns the rejection and its message; WP9 owns the form. Pinned in Task 9.12, `test/views/definitions/form.test.tsx`: "upper-cases a lowercase code on blur and adds it" (`lhr` → `LHR` on blur) and "shows the API's metro-code message under the field it names" (`LON` → the 422's `details.fields` entry for `origins.0` rendered inside the Origins group). The API's `iataSchema` also upper-cases, so the blur rule is the visible half, not the only one. The example JSON path is covered by `EXAMPLE_DEFINITION` being parsed through `definitionCreateRequestSchema` at load; WP12's test keeps the JSON and the import equal.

Review focus 3 (browser outside Europe/London) is WP10's; WP9's `formatIsoDate` and `formatLocalDateTime` already format by string slicing, never through `Date`, so WP10's `TZ` test covers the Results date columns without a change here.

## 10. Definition of done

Run from the repository root, in order; each must give the stated outcome.

1. `pnpm install --frozen-lockfile` → exits 0 (the lockfile includes `msw`, `@testing-library/dom` and `zod` for `@gmt/web`).
2. `pnpm lint:fix && pnpm lint` → `biome check` reports no errors (format and organised imports applied).
3. `pnpm --filter @gmt/web typecheck` → exits 0. `pnpm -r typecheck` → exits 0.
4. `pnpm --filter @gmt/web test` → every web test passes (Tasks 9.1–9.14: 5 + 8 + 6 + 7 + 6 + 7 + 13 + 9 + 4 + 8 + 3 + 8 + 9 + 8 = 101 tests, none skipped) and the coverage report shows **lines ≥ 70%, statements ≥ 70%, functions ≥ 70%, branches ≥ 60%** for `apps/web/src` with no threshold error.
5. `pnpm test` → every package green with its thresholds.
6. `node scripts/check-boundaries.mjs` → exits 0; `@gmt/web` imports no workspace package except `@gmt/core`.
7. `pnpm --filter @gmt/web build` → exits 0 and writes `apps/web/dist/index.html` plus hashed assets under `apps/web/dist/assets/`.
8. `grep -rn "style={" apps/web/src` → no output (spec §4 CSP `default-src 'self'` blocks inline styles).
9. `grep -rn "process\.env" apps/web/src` → no output.
10. `grep -rnE "(LHR|LGW|JFK|EWR|LON|NYC)" apps/web/src` → no output (the example's codes live in `docs/examples/london-new-york.json`; `src/example.ts` only names the file).
11. `grep -rnE "\b(Live|live|bookable|guaranteed|exhaustive|real-time)\b" apps/web/src` → no output (a cheap cross-check of the three banned-word tests; identifiers included).
12. With WP8 merged: `pnpm dev`, open `http://localhost:5173/?view=providers` (API calls go to `/api` through the Vite proxy) with `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake`, `NODE_ENV=development`, `DATABASE_PATH=./data/dev.fixture.db` → the red synthetic banner shows on every view; without those three variables and with `TRAVELPAYOUTS_TOKEN` set → no banner, and "Check free coverage" on Definitions returns a table. Record both screenshots in the PR.

## 11. Open questions

None requires the operator's judgement. The contract gaps of the first draft (airports route, providers, coverage, calendar-gap and scheduler shapes, `needsConfirmation`, result-row fields, 422 details, unsaved-body estimate, list order, `Usage`) are closed by plan contracts v2 and spec revision 10, and this brief now follows them.

### Remaining mismatches (spec, plan, brief; neither spec nor plan edited)

Round-3 pins (decision 15, spec rev 11) are applied: core's `formatPence` (re-exported by `src/format.ts`), `CONSTRAINT_LABELS` for constraint names, nullable search links ("no search link"), class and unverified names on other sellers, the two `selectedNotReached` reasons, stale rows never demoted. Round-2 pins (plan commit 790d1ea, decision 14) closed the confirmation field (`confirmedCostPence?` on create and update), the row key (`resultRowKey`, used by `bandCheapest` and `?row=`), the calendar-gap price's provenance (`cheapestVerified` is a PriceCell) and budgetFit before the create click (`{ estimate, budgetFit }` from both estimate routes). WP2's brief now uses the plan's `ResultFilters` names.

- **R6** WP12 depends on WP9 but owns `docs/examples/london-new-york.json`, which WP9 imports; WP9 writes it with WP12's content only when absent, and WP12 owns its final content and the docs test.
- **R7** `docs/briefs/wp08-api.md` (Task 8 definitions routes) still says "the confirmation itself is never written by these routes", which contradicts the plan's `confirmedCostPence?` on create and update that this brief's create click and re-confirmation send. WP8's brief needs the same round-2 pin.
