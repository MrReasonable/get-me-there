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

Reconciled on 2026-10-17 against spec revision 24, the plan's "Global Constraints", "API contract", "Web" and "Decisions taken at reconciliation" 1–54 (38 holds this brief's round-1 rulings, 51 and 52 its round-2 rulings, 53 the calendar's destination parameter, 54 the "not seen in latest search", "superseded" and route-point marks; 42, 44, 46, 48, 49 and 50 the shared names and rules it follows), the real `@gmt/core` on `main` (`62d6a11`), WP9's committed revision after its round 3 (the shell WP10 extends, never replaces, decision 46) and WP7's changes that WP9 also takes as preconditions (Tasks 7.1, 7.4's `NoPricedOptionsReason`, 7.8, 7.13, 7.18, and `pnpm casts`). Review rounds 1 (24 High, 46 Medium, 32 Low) and 2 (7 High, 16 Medium, 17 Low) are folded into the sections below. Spec revision 24 changed only §6.7, §7 and §8.1's resume and stride rules (decision 50); §3, §10, §11 and §13 read as in revision 23, so nothing here changes with it.

## 1. Goal

Replace WP9's three "not available yet" views with the calendar heatmap (View B), the price-by-stay-length chart (View C) and the price history view, where every fare goes through PriceCell (chart tooltips included; the route-level series has the spec's exemption), "not searched" never looks like "no flights", an unconfirmed price never looks confirmed, coverage is visible without reading counts, every run time is Europe/London, and the browser's timezone never moves a date; add the core contract fields these views need, and one Playwright smoke that drives the real api in fixture mode, its selectors proven against the markup in `pnpm test`.

## 2. Scope

**In**

- **Contract additions in `@gmt/core` `api-contract/results.ts`** (decisions 38, 42, 51, 52, 53, 54; WP8 fills them, §13): `calendarQuerySchema` (an optional `destination`) on the calendar route; decision 54's marks on the views' figures (`notSeenInLatest` on the calendar day's verified minima, the duration's `minVerified` and the calendar gap's `cheapestVerified`; `superseded` on the day's and the duration's calendar minima and the cell detail's calendar prices; `stale` on route-level points); `verification.unconfirmedCells` on the calendar day; per-series `searched` counts (`searched` of `total` cells) and the `cell` of each per-nights minimum in the duration analysis; `historyPointResponseSchema` (`stale`, `truncated`) on both history responses, while the stored `historyPointSchema` that `@gmt/db` returns is unchanged; `priceConfirmed` and `executionId` on itinerary history points, and the itinerary's `cell` and `carriers`; `verify: { maxCalls, headroomCalls }` on the cell detail (WP7's `childCapPreview`).
- **View B Calendar** (`apps/web/src/views/Calendar/*`):
  - Each day shows one price by the spec §11 precedence (core's `compareAges`; a SearchApi verified price has age `'unknown'`) through WP9's PriceCell `compact` form (decision 46); then the stay of the cheapest cell, "cached from £X" with that cheaper fare's own destination, note and stay when the shown verified price hides a cheaper calendar price (decision 52), and a coverage cue ("S/M searched", 11 px, with a solid or striped swatch). Everything else is in the side panel.
  - Colour by one basis at a time. The default basis is the calendar basis unless days showing a class-verified price are a strict majority, judged on the all-destination calendar. Quintile bands with a numeric legend; fewer than ten days or a spread under 10% gives one flat shade and the legend says why; days of the other basis are hatched. Every band carries its text at 4.5:1 or better, neighbouring bands differ clearly in lightness, and the band number is printed on the face.
  - Days without a price show distinct glyphs with their cell counts from the best-covered source ("∅ 1 no fares · ○ 47 not searched") and the same "S/M searched" cue as a priced day; a day no run reaches says "not searched yet"; only a definition without a discovery provider says "no discovery provider configured". A day whose itinerary search priced cells but confirmed none of their prices says "price not confirmed" (decision 48).
  - A destination filter, sent to the api (decision 53): the api computes that destination's buckets, minimums and unconfirmed cells, and the web renders the days as they come, so a filtered day is as honest as an unfiltered one.
  - A bucket total that disagrees with its buckets shows "counts inconsistent".
  - Decision 54: a verified day price the latest search no longer returned says "not seen in latest search (…)", and a calendar price whose cell a newer run found empty or no fares says "superseded by a later search", in the day, the "cached from" fare and the panel (one glyph each on the phone face); the panel lists superseded calendar prices after current ones.
  - Filter, basis and (at phone width) month live in the URL. At phone width one month is drawn at a time, month navigation before the legend, and each day shows its phone face: day number, band number, the amount through PriceCell's new `face` form (marks as single glyphs, their words in its title and spoken text) and one-glyph marks for "price not confirmed" and partial coverage; the panel then sits below the grid as a page section.
  - The legend keeps the scale, the band swatches and the glyphs open and folds the explanations of the marks into "What the marks mean".
  - Keyboard: each month is a captioned table of day buttons with a roving `tabIndex` (decision 51); arrows, Home/End and PageUp/PageDown move focus, Enter and Space open the day; visible focus.
  - Side panel: the day's six-bucket marker (a "not searched yet" line for each configured provider with no counts, and the unconfirmed cells) and its prices with full provenance; a cell picker in core's generation order; the cell's outcomes per run (newest first, the Run column sticky, the latest run marked, reasons in words from a map typed against core's reason types, "price not confirmed" beside a priced verification outcome whose reason carries `price-unconfirmed`); its prices, an unconfirmed offer badged inside its PriceCell; the per-cell verify action through WP9's `useExecutionActions().verify`, disabled until the cell detail has loaded its hard stop and headroom, with a named budget-cap refusal, and hidden without a verification provider.
- **View C Duration** (`apps/web/src/views/Duration/*`): Recharts 3 bars per nights for the verified series and one calendar series per provider, labelled from the prices' own provenance with `n` in the label, the tooltip and a note defining it; per-series gaps with counts ("not searched", "searched 3 of 48 cells, no price", "searched, no price"; "not itinerary-searched", "itinerary-searched 1 of 4 selected cells, no class-verified price", "itinerary-searched, no class-verified price"); a star on the axis for a nights value no series searched; stale minima drawn faded with a heavy outline; a tooltip whose fares are PriceCells, with decision 54's "not seen in latest search" and "superseded" marks there and in the table; price ticks without "£" (the axis title says GBP); a table with destination, note, `n` and departure date per minimum, each nights value linking to Results filtered to it.
- **History** (`apps/web/src/views/History/*`): route history by pair (or all pairs overlaid, one colour per pair), the pair in the URL; fetch-time series (calendar per provider and cabin; itinerary offers split into confirmed and "price not confirmed by the final step", dotted) joined only between consecutive runs of the definition in run order (decision 52), the runs read from the executions list the status bar uses; the route-level series named by its provider and cabin ("SearchApi route-level series, indicative · cabin not stated") in its own chart, price by travel date, every point dotted, each row "indicative" and, by fetch age, "stale" (decision 54); tables of every point with stale, "cheapest of the rows read" and the unconfirmed badge; WP9's `ViewHeader variant="span"`; an itinerary heading from the api's own cell and carriers.
- **Run times in Europe/London** (decision 52): WP9's `formatInstantUtc` becomes `formatRunInstant` ("14 Oct 2026 13:00 Europe/London"), used by WP9's `ViewHeader` and status bar; the panel and History name runs by their Europe/London date.
- **Review focus 3** (dates): the grid and instant forms join WP9's `src/format.ts` on its one month and weekday table (decisions 38, 46); `src/lib/time.ts` turns instants into epoch milliseconds; a guard against `Date` objects over `apps/web/src`; a TZ suite under `America/Los_Angeles` and `Asia/Tokyo` covering the calendar grid and WP9's Results date columns.
- **Copy** in WP9's `src/copy.ts`: `calendarView`, `durationView`, `historyView`, `priceMarkGlyph`, with SAMPLES in WP9's catalogue test.
- **WP9 files extended** (§12): `format.ts`, `copy.ts`, `components/{PriceCell,ViewHeader,StatusBar}.tsx`, `api/{types,endpoints,queries}.ts`, `App.tsx`, `views/Results/{ExpandedRow,CalendarGapBanner}.tsx` (the gap's cheapest verified price says when the latest search no longer returned it, decision 54), `test/fixtures.ts`, `test/guards.ts`, `test/msw/handlers.ts`, `test/copy/{catalogue,sourceGuard}.test.ts`, `test/copy/renderedSweep.test.tsx`, `test/app/shell.test.tsx`, `test/format.test.ts`, `test/components/statusBar.test.tsx`, `test/views/coverage.test.tsx`, `vitest.config.ts`, `vite.config.ts`, `tsconfig.test.json`, `package.json`.
- **Playwright smoke in fixture mode**: Results, Calendar, Duration and History in a real browser on the synthetic run, plus a 375 px project that checks no day's content spills out of its cell; excluded from `pnpm test`, its calendar selectors shared with a jsdom test that proves they match.

**Out**

- **WP9:** the shell, nav, status bar, `ViewHeader` (with `variant="span"`), `Provenance`, `PriceCell` (with `compact`, `truncated`, `superseded` (decision 57; the words "superseded by a later search"), `unconfirmed`, `notSeenInLatestHours`; WP10 adds only `face`), `PriceBoundary`, the client, `COPY` base entries (`truncatedNote`, `providerShort`, `priceNotConfirmed`, `vendorAgeUnknown`, `spanExecutions`), `NowContext`, `format.ts`'s `formatIsoDate`/`formatIsoDateShort`/`formatIsoDateLong`/`formatWeekday`, URL state, Definitions, Results, Coverage, Providers, the msw test API and its guards, and the boundary script's place-name and suppression checks. WP10 edits only the WP9 files named in §12.
- **WP8:** every route; filling the fields this brief adds (§13); decision 54's rules (effective-age staleness, which figures were not seen in the latest search, which calendar prices are superseded and their ranking, the execution set behind duration, link re-validation in the contract, request limits); `stale` by fetch age (decision 44), `ageHours` and `truncated` per price; the in-process fixture host (WP4b's wiring).
- **WP7:** `Engine.childCapPreview` behind `verify`, the `price-unconfirmed` priced reason, `isPriceUnconfirmed` and decision 50's one priced-reason builder, `NoPricedOptionsReason` in `ErrorReason` (Task 7.4), `microGbpToPence`, and `scripts/check-casts.mjs` (preconditions, as for WP9).
- **WP0/WP1:** everything else in `@gmt/core` the views consume.
- **WP11:** the Alerts view.

## 3. Spec sections and plan decisions

- **§11 View B:** precedence (a fresh class-verified price, else the fresher of a stale verified price and the cheapest calendar price, unknown age losing to known, else glyphs); colour by one basis on a quintile scale over that basis's visible days, fallback days hatched and named in the legend; the six-bucket marker "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M" and "itinerary-searched K of N selected +C on demand"; distinct glyphs; a numeric legend; a per-destination filter; a side panel with cells, outcomes and verify.
- **§11 View C:** bars per nights with axis titles (nights, price in GBP); "min among verified (class verified, n=…)" and calendar per provider; `n` in label and tooltip; explicit empty and loading states; gaps for unsearched nights; no interpolation.
- **§11 History:** one series per provider and kind; x is `fetchedAt` for provider series and the point's own `date` for the route-level series; gaps (decision 52: lines join consecutive runs only); reused rows excluded (by the api); axis titles; empty state.
- **§11 vocabulary and provenance:** "Google date grid via SearchApi", "Google Flights via SearchApi", "Aviasales cache", "itinerary-search basis"; provenance on every price visible without hover (the calendar day uses decision 46's compact form); dashed outline and "constraints not checked" for calendar prices; destination and the operator's note; every view header names its executions, status, age and stale label. Accessibility: keyboard-operable calendar, visible focus, labelled controls, no colour-only meaning.
- **§3 (rev 23), §8.1:** `stale` per price comes from the api, by fetch age plus any known vendor age; a vendor age of `'unknown'` is labelled "vendor's cache age unknown", never called stale for that reason (decision 44); stale prices are labelled, never hidden; unknown age loses to known in the precedence; ties go to verified. Single-cell verification: the child's cap and the hidden action without a verification provider.
- **§3, §6.6, §7 (rev 22):** a priced outcome's reason may carry `price-unconfirmed`; a cell's verification price counts only confirmed prices and shows "price not confirmed" when it has none (decisions 45, 48).
- **§3:** six buckets summing to M; reused counted inside its bucket; "verified" only for the class; stage counts say "itinerary-searched".
- **§10:** calendar, duration-analysis, cells, `/cells/verify`, itinerary and route history, all under `/api`.
- **§9 item 6:** View B states including the partial-day six-bucket marker and the per-basis scale with hatched fallback days; chart empty and loading states; the numeric legend; keyboard operation; banned words; a price lacking provenance fails to render; one Playwright smoke in fixture mode. (§9 item 6 and the §16 table say "five-way marker"; spec §3 defines six buckets, §13.)
- **§5.5:** synthetic data is labelled on every view beside the red banner.
- **Plan decisions consumed:** 14 (`resultRowKey`, `?row=`), 15 (route history one point per run), 21 (`DEFAULT_DISCOVERY_REFRESH_HOURS`), 24 (SearchApi itinerary age unknown), 25 and 43 (child caps), 27 and 37 (unconfirmed offers, "price not confirmed by the final step"), 30, 36 and 47 (`truncated`, "cheapest of the rows read"), 38 (this brief's rulings), 42 (the contract fields and the names shared with WP9), 44 (staleness by fetch age; no suppressions; "hard stop", never "up to"), 45 and 48 (`price-unconfirmed`, `childCapPreview`, `pnpm casts`), 46 (WP9 is the base; one date table; PriceCell `compact`; `ViewHeader variant="span"`; no lint suppressions; the place-name word list), 49 (one suppression check; `microGbpToPence`), 50 (one priced-reason builder in core), 51 (`unconfirmedCells`; no `Date` objects; the month table of day buttons), 52 (every fare through PriceCell, tooltips included; `data-scale` only on legend scale values; "cached from" with destination and stay; run times in Europe/London; joins by run order; the route-level series named by provider; History's runs from the executions list), 53 (the calendar's `destination` parameter), 54 ("not seen in latest search" on verified-basis figures, "superseded by a later search" on calendar-basis prices ranked after current ones, `stale` and "indicative" on route-level points; vendor links re-validated by the contract, so the web trusts the parsed value).

## 4. Interfaces consumed

From `@gmt/core` on `main`, with WP9's Task 9.0 and WP7's Tasks 7.1, 7.8, 7.13 and 7.18 applied (both are preconditions of this package):

```ts
// types/ids.ts: brands come from these helpers (tests) or zod parsing (src); the web's src mints none by hand
export type Iata = string & { readonly __brand: 'Iata' }; export type IsoDate = string & { readonly __brand: 'IsoDate' };
export type IsoMonth = string & { readonly __brand: 'IsoMonth' }; export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };
export const isoDateSchema, isoDateTimeSchema;   // z schemas over a plain string
export const asIata, asIsoDate, asIsoMonth, asIsoDateTime;   // tests and seeds
export const isoDateTimeOfEpochMs: (ms: number) => IsoDateTime;
// types/provenance.ts, types/definition.ts, types/execution.ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export interface Provenance { providerId; sourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime; maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale; cabin }
export const provenanceSchema: z.ZodType<Provenance>;
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate } export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;
export interface ProvidersConfig { discovery: ProviderId[]; verification: ProviderId[]; discoveryRefreshHours: Partial<Record<ProviderId, number>> }
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }
// dates/epochDay.ts
export function toEpochDay(d: IsoDate): number; export function fromEpochDay(day: number): IsoDate; export function addDays(d: IsoDate, n: number): IsoDate;
export function daysBetween(a: IsoDate, b: IsoDate): number; export function monthOf(d: IsoDate): IsoMonth;
// labels/age.ts
export function effectiveAge(p, now: IsoDateTime): EffectiveAge; export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown';
export function formatDuration(hours: number): string; export function formatAgeFull(a: EffectiveAge): string; export function compareAges(a: EffectiveAge, b: EffectiveAge): number;
// coverage/rollUp.ts (WP7 Task 7.8, decision 48), types/execution.ts and errors.ts (WP7 Task 7.4)
export const PARTIAL_EXPANSION = 'partial-expansion'; export const PRICE_UNCONFIRMED = 'price-unconfirmed'; export const MIXED_ERROR_REASON = 'mixed';
export function isPriceUnconfirmed(reason: string | null): boolean;
export type SkipReason; export type NoDataReason; export type ErrorReason = ProviderErrorKind | NormalisationReason | NoPricedOptionsReason;
// space/generate.ts
export function generateCells(space: ResolvedSpace): Cell[];   // origins and destinations sorted, then dates, then nights (spec §6.1)
// alerts/evaluate.ts, results/rowKey.ts, text/bannedWords.ts
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168; export function resultRowKey(row): string;
export const BANNED_WORD_ALLOWLIST: readonly string[]; export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export type CalendarDay = z.infer<typeof apiContract.calendarDaySchema>; export * as apiContract;
```

From `api-contract/results.ts` and `index.ts` (verbatim shapes; Task 10.1 changes the seven marked ⊕):

```ts
priceCellSchema { pricePence; provenance; stale; ageHours: number | 'unknown'; truncated }   // truncated: WP9 Task 9.0
const pricedCell = priceCellSchema.extend({ cell: cellSchema });
⊕ ROUTES: GET /api/definitions/:id/calendar, no query
⊕ calendarDaySchema { date; discovery: Array<{ providerId; buckets; total }>; verification: { selected; itinerarySearched; onDemand };
  cheapestVerified: (PriceCell & { cell; itineraryHash }) | null; cheapestPartiallyVerified: (PriceCell & { cell; itineraryHash; count }) | null;
  cheapestCalendar: (PriceCell & { cell }) | null; byDestination: Array<{ destination; cheapestVerified: PriceCell | null; cheapestCalendar: PriceCell | null }> }
calendarResponseSchema { days; executions: ExecutionSummary[]; staleAfterHours; calendarStaleAfterHours: z.partialRecord(ProviderId, number) }
⊕ durationAnalysisResponseSchema { byNights: Array<{ nights; minVerified: (PriceCell & { n }) | null; minCalendar: Array<{ providerId; price: PriceCell; n }>; searched: boolean }>; executions }
cellOutcomeSchema = CellKey & { executionId; stage; providerId; status; reason: string | null; attempts; lastError: string | null; fetchedAt: IsoDateTime | null; minPence; cabin; pointOfSale; sourceKind; reusedFromExecutionId: string | null }
⊕ cellDetailResponseSchema { cell; outcomes: CellOutcome[]; calendarPrices: Array<PriceCell & { executionId; calendarPriceId }>; observations: ResultRow[] }
⊕ calendarGapResponseSchema { cheapestVerified: (PriceCell & { cell; itineraryHash }) | null; cells: Array<{ cell; calendar: PriceCell; verifyAvailable }> }
historyPointSchema { at: IsoDateTime; pricePence; provenance }    // @gmt/db's offerHistory and route history return this type
routeSeriesPointSchema { date: IsoDate; pricePence; fetchedAt: IsoDateTime; providerId; sourceKind }
⊕ itineraryHistoryResponseSchema { itineraryHash; series: Array<{ providerId; seller; cabin; points: HistoryPoint[] }> }
⊕ routeHistoryResponseSchema { origin; destination; calendarSeries: Array<{ providerId; cabin; points: Array<HistoryPoint & { cell; executionId }> }>; routeSeries: Array<{ providerId; cabin: Cabin | 'unknown'; points: RouteSeriesPoint[] }> }
executionSummarySchema { id; status; isChild; startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null; ageHours: number | 'unknown'; expandTop }   // newest first
```

From WP9 (`docs/briefs/wp09-web-shell-definitions-results.md` as committed, §5; real names):

```ts
// src/format.ts: the web's one date-formatting module, one month and weekday table (decision 46)
export { formatPence }; export function formatIsoDate(d: string): string;   // "14 Mar 2027"
export function formatIsoDateShort(d: string): string;   // "14 Mar"
export function formatIsoDateLong(d: IsoDate): string;   // "Sun 14 Mar 2027"
export function formatWeekday(d: IsoDate): string;       // "Sun"
export function formatInstantUtc(iso: string): string;   // "14 Oct 2026 12:00 UTC": ViewHeader's and the status bar's run times
// src/copy.ts (as const): loading, loadFailed(m), actionFailed(m), placeholder ("This view is not available yet."), provider, source, stale, staleView,
//   vendorAgeUnknown, priceNotConfirmed, truncatedNote, providerShort, classLabel, basisName, bucket, reusedNote(n), stageName, cabinName,
//   spanExecutions(n), executionsShown, verifyCell, verifyStarted, none, advanced, headlineLead, …
// src/components
export interface PriceCellProps { pricePence: number; provenance: unknown; calendar: boolean; stale: boolean; truncated?: boolean; unconfirmed?: boolean;
  destination?: string | undefined; destinationNote?: string | null | undefined; notSeenInLatestHours?; qualifier?; besideColumns?: boolean; compact?: boolean; fullAge?: boolean }
export function PriceCell(props: PriceCellProps): JSX.Element;   // data-testid="price-cell"; the full form holds Provenance (data-testid="provenance")
export class PriceBoundary;   // COPY.priceWithheld (role="alert"), reported through console.error
export function ViewHeader(props: { title: string; executions: readonly HeaderRun[]; stale: boolean; variant?: 'single' | 'span' }): JSX.Element;
export type HeaderRun = Pick<ExecutionSummary, 'id' | 'status' | 'isChild' | 'startedAt' | 'ageHours'>;
// src/api
export class ApiError extends Error { readonly status: number; readonly code: string }
export async function call<S extends z.ZodType>(schema: S, method: Method, path: string, opts?: CallOptions): Promise<z.output<S>>;   // checks the pair against ROUTES, parses in every mode
export const api: { providers(); …; verifyCell(body: VerifyCellBody) }; export const qk: { …; results(id, basis) };
export const POLL_MS = 2_000; export function useProviders(); export function useExecutionActions(): { cancel; resume; start; verify };
export type ProvidersResponse, DefinitionResponse, ResultsResponse, ExecutionSummary, PriceCellData, ResultRow, VerifyCellBody /* z.input */;
// src/now.tsx, src/hooks/useMediaQuery.ts, src/state/urlState.ts
export function useNow(): IsoDateTime; export const NARROW_QUERY; export function useMediaQuery(q: string): boolean;
export function useSearchParams(): URLSearchParams; export function updateSearchParams(patch, mode?: 'push' | 'replace'): void;
export function hrefWith(patch): string; export function navigateTo(patch): (e) => void;   // Results URL keys: f.nights = '<min>-<max>', row = resultRowKey
// test/
export function parseBasis(v: string | null): Basis | null;   // src/state/resultsState.ts; useResults(id, basis) is the status bar's executions list
export const API = 'http://localhost:3000/api'; export const provSearch, provCalendar, provSynthetic: ProvenanceInput;   // test/fixtures.ts, wire form
export function summary(over?: Partial<z.input<typeof executionSummarySchema>>): ExecutionSummary; export function definition(over?); export function resultsResponse(over?);
export function verifiedRow(over?); export function calendarRow(over?); export function providersResponse(over?);
export const NOW: IsoDateTime; export type ProvenanceInput; export function renderWithProviders(ui, opts?: { search?; fakeTimers? }): RenderResult & { user; client };   // test/render.tsx
export const server;   // a catch-all records any unmatched request; test/setup.ts fails the test on it and on any console.error
export function expectConsoleErrors(pattern: RegExp): void;   // test/guards.ts; renderedSweep.test.tsx holds renderedCopy and poundsOutsidePrices
export function setViewportWidth(px: number): void;   // test/viewport.ts
```

WP9's guards WP10 passes: the AST source guard (no literal copy in JSX or in lettered props of components, money formatted only in its allowlisted files, "£" only in the catalogue and the formatter); the catalogue test; the rendered-DOM sweep (no banned word; every "£" inside a PriceCell, a cost or a label); `pnpm boundaries` (the one suppression check, decision 49: no `biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` in any package; and no place name in an `apps/web/src` string literal outside `example.ts`, with a committed non-airport word list); `pnpm casts`.

## 5. Interfaces produced

```ts
// @gmt/core api-contract/results.ts and index.ts (Task 10.1)
export const calendarQuerySchema;   // { destination?: Iata }, the calendar route's query (decision 53)
export const historyPointResponseSchema;   // historyPointSchema + { stale: boolean; truncated: boolean }
// calendarDaySchema.verification.unconfirmedCells: number   (for the requested destination, else every destination)
// decision 54: notSeenInLatest: { ageHours } | null on calendarDay.cheapestVerified/cheapestPartiallyVerified, durationAnalysis minVerified,
//   calendarGap.cheapestVerified; superseded: boolean on calendarDay.cheapestCalendar, durationAnalysis minCalendar[].price,
//   cellDetail.calendarPrices[]; stale: boolean on routeHistory.routeSeries[].points[] (the stored RouteSeriesPoint is unchanged)
// durationAnalysisResponseSchema.byNights[]: minVerified: (PriceCell & { cell; n }) | null; minCalendar[].price: PriceCell & { cell };
//   searched: { verification: { searched; total }; discovery: Array<{ providerId; searched; total }> }
// itineraryHistoryResponseSchema: { itineraryHash; cell; carriers: string[]; series[].points: Array<HistoryPointResponse & { priceConfirmed; executionId }> }
// routeHistoryResponseSchema.calendarSeries[].points: Array<HistoryPointResponse & { cell; executionId }>
// cellDetailResponseSchema.verify: { maxCalls: number; headroomCalls: number } | null
// src/format.ts (WP9's module: formatInstantUtc becomes formatRunInstant; a block appended on its one table)
export function formatRunInstant(iso: string): string;       // '14 Oct 2026 13:00 Europe/London' (decision 52)
export function weekdayIndex(d: IsoDate): number;            // Monday = 0
export const WEEK_HEADERS: readonly string[];                 // ['Mon', …, 'Sun']
export function formatDayOfMonth(d: IsoDate): string;        // '14'
export function formatDayShort(d: IsoDate): string;          // 'Sun 14 Mar'
export function formatIsoMonth(m: IsoMonth): string;         // 'Mar 2027'
export function monthDays(m: IsoMonth): IsoDate[];
export function formatInstantLondon(ms: number): string;     // '14 Mar 2027 15:00' (Europe/London)
export function formatInstantDateLondon(ms: number): string; // '14 Mar 2027' (Europe/London)
export function formatAxisPounds(pence: number): string;     // '1,200': a chart's price tick, no "£"
// src/components/PriceCell.tsx (WP9's): PriceCellProps.face?: boolean (the phone day cell's amount; COPY.priceMarkGlyph); `superseded?: boolean` and `COPY.superseded` are WP9's already (decision 57)
// src/lib/marks.ts
export interface FigureMarks; export function figureMarks(p): FigureMarks;   // decision 54's two marks of a figure, spread into PriceCell
// src/lib
export function instantMs(t: string): number; export function dateMs(d: IsoDate): number; export function dateOfMs(ms: number): IsoDate;   // time.ts
export function discoverySourceLabel(providerId: ProviderId, providers: ProvidersResponse | undefined): string; export function sourceLabelOf(kinds: Iterable<SourceKind>): string;   // sources.ts
export const SERIES_COLOURS; export function seriesColour(i: number): string;   // palette.ts
// src/state/links.ts
export const HISTORY_PARAMS; export function historyHref(hash): string;
// src/api
export type { CalendarDay }; export type CalendarResponse, DurationResponse, CellDetailResponse, ItineraryHistoryResponse, RouteHistoryResponse;
api.calendar(id, destination: Iata | null); api.durationAnalysis(id); api.cellDetail(id, cell); api.itineraryHistory(hash); api.routeHistory(origin, destination, cabin);
qk.calendar(id, destination); qk.duration(id); qk.cell(id, key: string | null); qk.itineraryHistory(hash: string | null); qk.routeHistory(origin, destination, cabin);
export function whileRunning(data): number | false; export function useCalendar(id, destination: Iata | null); export function useDurationAnalysis(id);
export function useCellDetail(id, cell: CellKey | null); export function useRouteHistories(pairs, cabin, enabled); export function useItineraryHistory(hash: string | null);   // skipToken while idle
// src/views/Calendar
export type DayPrice; export interface DaySlice; export interface GridDay; export type GlyphStatus; export type DayBasis;
export function bucketTotal(b); export function searchedCount(b); export function countsConsistent(d); export function formatDiscoveryMarker(d); export function formatVerificationMarker(v);
export function totalReused(slices); export type Coverage; export function bestCovered(discovery); export function coverageOf(slice): Coverage; export function providersNotSearched(slice);
export interface SliceOptions; export function sliceOf(day, o, destination): DaySlice;
export function DayMarker({ slice }); export function ReusedNote({ count }); export function CoverageCue({ coverage });
export type GlyphReason; export interface Glyph; export type DayDisplay; export function resolveDayDisplay(slice, now): DayDisplay; export function defaultColourBasis(days, hasVerification, now): DayBasis;
export interface CalendarModel; export function buildCalendarModel(days, colourBasis, now): CalendarModel;   // model.ts
export type Band; export type ScaleMode; export interface LegendEntry; export interface QuintileScale; export const MIN_BANDED_DAYS = 10; export interface BandColour;
export const BAND_COLOURS; export const BAND_CLASSES; export const FLAT_CLASS; export const PRICELESS_CLASS; export function quintileBand(sorted, v): Band; export function buildScale(values): QuintileScale;
export const FOCUS_RING; export function targetOf(date, key): IsoDate | null; export function CalendarGrid({ days, model, months, destinationNotes, compact, onOpen });
export function CalendarLegend({ model });
export function cellsForDay(def, date): CellKey[]; export function toKey(c); export function orderOutcomes(outcomes, executions); export function reasonText(reason): string;
export function runLabel(executionId, executions): string; export function orderCalendarPrices(prices); export function noHeadroom(v): boolean; export function canPressVerify(detail, sending): boolean;   // panel.ts
export function VerifyCost({ verify }); export function DayPrices({ slice, notes }); export function CellDetailBody({ detail, executions, note });   // PanelSections.tsx
export function CellPanel({ definition, date, slice, executions, initialCell, inline, onClose });
export const CALENDAR_PARAMS; export function parseDestination(raw, destinations); export function parseBasis(raw); export function CalendarView({ definition });
// src/views/Duration
export type DurationPrice; export interface SearchedCount; export interface DurationCell; export interface DurationRow; export interface DurationSeries; export interface DurationData;
export function buildDurationData(resp, minNights, maxNights, hasVerification): DurationData; export function rowAt(rows, label); export function barValue(row, key): number | null; export function gapLabel(cell, kind): string;
export function DurationTooltip({ active, label, data, notes }); export function DurationChart({ data, tableId, notes }); export function DurationTable({ data, id, notes }); export function DurationView({ definition });
// src/views/History
export type RoutePoint; export type PlotPoint; export interface PlotLine; export type RoutePlotPoint; export interface RouteLine; export type RunOrder;
export function runOrder(executions): RunOrder; export function withBreaks(points, joined, gap); export function consecutiveRuns(order);
export function linesFromRoute(resp, order, pair?): { fetch: PlotLine[]; route: RouteLine[] }; export function linesFromItinerary(resp, order): PlotLine[];
export function assignColours(lines); export function linesForPairs(responses, pairs, order, overlay); export function coloursRepeat(lines): boolean; export function itineraryHeading(resp): string;
export function historySpan(lines); export function newestAllStale(lines); export function HistoryChart; export function RouteChart; export function HistoryTable;   // HistoryChart.tsx
export function RouteTable({ line, now });   // RouteTable.tsx
export const MAX_OVERLAY_PAIRS = 6; export function HistoryView({ definition });
// src/copy.ts
COPY.calendarView, COPY.durationView, COPY.historyView, COPY.priceMarkGlyph (`COPY.superseded` is WP9's)
// test/guards.ts (WP9's): renderedCopy() and poundsOutsidePrices(), shared by WP9's sweep and WP10's wiring test
// e2e/selectors.ts: SMOKE, the Playwright smoke's calendar selectors
// DOM markers WP9's rendered sweep accepts for "£" outside a PriceCell (Task 10.12): [data-scale] (the calendar legend's scale values only), [data-indicative] (route-level rows)
```

## 6. Library notes

Versions are from plan Task 0.1 (already in `apps/web/package.json`). Everything below was checked on 2026-10-16 against the installed packages in a scratch assembly of this brief on `main` with WP9's committed code applied (§10).

- **recharts 3.10.1:**
  - Components used: `BarChart`, `Bar` (function `dataKey`, `name`, `isAnimationActive={false}`, `<Cell>` children for per-entry `fillOpacity`, `stroke`, `strokeWidth`), `LineChart`, `Line` (per-line `data`, function `dataKey`, `connectNulls={false}`, `strokeDasharray`, `dot` as `true` or `{ r: 2 }`), `XAxis`/`YAxis` (`label={{ value, position, angle, offset }}`, `tickFormatter`, `type="number"`, `scale="time"`, `domain={['dataMin', 'dataMax']}`, `allowDuplicatedCategory={false}`), `Tooltip` (`content` receives `TooltipContentProps` with `active` and `label`; the content is ordinary React, so it renders PriceCell inside the app's providers), `Legend`, `CartesianGrid`, `ResponsiveContainer`.
  - Rendered DOM the tests read: the chart surface is `svg[role="application"]` (legend icons are `svg.recharts-surface` too); each drawn bar is a `path.recharts-rectangle` inside `g.recharts-bar`, and a `null` value draws none (a 0 draws none visibly either, so a value test guards it); extra props on `<Cell>` (`data-stale`) pass to the path; a line is `path.recharts-line-curve` whose `d` has one `M` per unbroken segment, and a line with one point draws no curve; each dot is a `circle` inside `g.recharts-line-dots`, one per non-null point, so a point flanked by gaps still shows.
  - History has no tooltip: with one `data` array per line on a time axis a shared tooltip pairs points by index, not by time; the tables are the record of every point.
  - jsdom: `ResponsiveContainer` measures its container with `getBoundingClientRect()` and observes it with `ResizeObserver`; `test/setup-charts.ts` installs a no-op `ResizeObserver` (a class implementing the interface, no cast) and sizes only `.recharts-responsive-container` at 800×320.
- **Biome 2.5.15 and the calendar's markup:** `useSemanticElements` wants a `<table>`, `<tr>` and `<td>` where ARIA `grid`, `row` and `gridcell` roles sit on divs, and `noNoninteractiveElementToInteractiveRole` refuses those roles on table elements, so an APG `role="grid"` cannot be written without a suppression, which decisions 46 and 49 forbid (no scoped lint override is granted either). Each month is therefore a native table (its caption names it) whose data days are `<button>`s with a roving `tabIndex`: the table gives rows, columns and headers to assistive technology, the buttons give focus and activation, and the arrow, Home/End and PageUp/PageDown keys move focus between them. A button holds phrasing content only, so the day's parts are `span`s.
- **@playwright/test 1.64.1:** `defineConfig`, `devices['Desktop Chrome']`, `projects[]` with `grep`, `grepInvert` and `dependencies`, `webServer` as an array (`env` merges over `process.env`); locators `getByRole`, `getByTestId`, `getByText`, `locator(…, { hasText })`; `toBeVisible`, `toContainText`, `toHaveClass`, `toHaveCount`, `toHaveCSS`, `expect(fn).toPass({ timeout })`; `page.evaluate` for the scroll-width check.
- **vite 8.3.4:** `preview.proxy` defaults to `server.proxy`, so `vite preview` reuses the dev proxy; the proxy target reads `GMT_API_ORIGIN`.
- **react 19.3.1:** `useState`, `useRef`, `useEffect`, `useMemo`, `useId`.
- **@tanstack/react-query 5.104.2:** `useQuery({ queryKey, queryFn, enabled, refetchInterval: (query) => … })`, `useQueries({ queries })`; `skipToken` as `queryFn` idles a query without a sentinel key or a rejecting function ("Disabling Queries" guide), and narrows the types.
- **tailwindcss 4.3.3:** arbitrary values (`bg-[#0f766e]`) are generated only from class names written out in full in the source, so `BAND_CLASSES` spells each one; `BAND_COLOURS` holds the same hex values for the contrast test.
- **msw 3.0.3:** WP9's `server` and catch-all; tests prepend `server.use(http.get(\`${API}/…\`, …))` with `HttpResponse.json(body, { status })` and `delay(…)`. Every route a WP10 view calls has a default handler (`test/msw/wp10Handlers.ts`), because an unmatched request fails the test.
- **vitest 5.0.4:** `pool: 'forks'` is Vitest 5's default (docs `config/pool.md`, v5.0.3: only `threads` ignores a change of `process.env.TZ`); the config pins it with that reason; `setupFiles` run before the test file is imported; coverage `thresholds` accept glob keys with their own floors; under jsdom a file-reading test uses `import.meta.dirname`.
- **zod 4.6.7:** builders parse through `apiContract.*Schema.parse` (and `provenanceSchema.parse` for provenance), so a contract change breaks at the fixture; `z.input<typeof schema>` types a builder argument that accepts plain strings.
- **Intl:** `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year, month: '2-digit', day: '2-digit', hour, minute, hourCycle: 'h23' }).formatToParts(epochMs)`: numeric parts only, so month names come from WP9's one table, and nothing builds a `Date`.
- **dataviz skill:** axis titles with units, one legend per chart, no dual axes, a sequential single hue for the heatmap with a clearly tinted lightest band, a categorical palette for series, and a dash or outline style backing every colour.

## 7. Files

**Create**

- `packages/core/test/api-contract/wp10.test.ts`
- `apps/web/src/lib/{time.ts,sources.ts,palette.ts,marks.ts}`, `apps/web/src/state/links.ts`
- `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx,display.ts,scale.ts,model.ts,CoverageCue.tsx,CalendarGrid.tsx,CalendarLegend.tsx,panel.ts,PanelSections.tsx,CellPanel.tsx,CalendarView.tsx,calendar.css}`
- `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`
- `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,RouteTable.tsx,HistoryView.tsx}`
- `apps/web/test/fixtures.wp10.ts`, `apps/web/test/msw/wp10Handlers.ts`, `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts`
- `apps/web/test/lib/{dates,time,sources,noDateParsing,marks}.test.ts`, `apps/web/test/components/priceCellFace.test.tsx`, `apps/web/test/views/results/gapNotSeen.test.tsx`
- `apps/web/test/views/calendar/{marker.test.tsx,display.test.ts,scale.test.ts,grid.test.tsx,panel.test.tsx,view.test.tsx}`
- `apps/web/test/views/duration.test.tsx`, `apps/web/test/views/history.test.tsx`, `apps/web/test/app/wp10Wiring.test.tsx`, `apps/web/test/tz/dates.tz.test.tsx`, `apps/web/test/e2e/selectors.test.tsx`
- `apps/web/playwright.config.ts`, `apps/web/e2e/{smoke.spec.ts,selectors.ts,prepare-db.mjs}`

**Modify**

- `packages/core/src/api-contract/{results,index}.ts` (Task 10.1).
- WP9's files listed in §12, and the root `.gitignore` (Playwright output).

## 8. Tasks

Every command runs from the repository root. Focused runs use `pnpm --filter @gmt/web exec vitest run <files>`, which skips the coverage thresholds (plan decision 8). In the tests, `API`, `definition`, `summary`, `provSearch`, `provCalendar`, `provSynthetic`, `verifiedRow`, `calendarRow`, `resultsResponse` and `providersResponse` come from WP9's `test/fixtures.ts`; `NOW` and `renderWithProviders` from `test/render.tsx`; `server` from `test/msw/server.ts`; `expectConsoleErrors` from `test/guards.ts`; `setViewportWidth` from `test/viewport.ts`. A label `` `path` — find: `` followed by `` `path` — replace with: `` replaces exactly one occurrence of the found text in a WP9 file, as in WP9's brief. No `as` appears anywhere except `as const` and `satisfies` (`pnpm casts`), and no comment suppresses a lint or type rule.

### Task 10.1: Contract additions in core (first failing test)

**Files:**
- Create: `packages/core/test/api-contract/wp10.test.ts`
- Modify: `packages/core/src/api-contract/{results.ts,index.ts}`

**Interfaces:**
- Consumes: `priceCellSchema` (with WP9 Task 9.0's `truncated`), `cellSchema`, `iataSchema`, `providerIdSchema`, `executionSummarySchema`, `historyPointSchema`, `ROUTES`.
- Produces: `calendarQuerySchema` on the calendar route (decision 53); `calendarDaySchema.verification.unconfirmedCells` (decision 51); the per-series `searched` counts and the minimum's `cell` in `durationAnalysisResponseSchema`; `historyPointResponseSchema` (`stale`, `truncated`) on both history responses; `priceConfirmed` and `executionId` on itinerary history points and the itinerary's `cell` and `carriers` (decision 52); `verify: { maxCalls, headroomCalls }` on `cellDetailResponseSchema` (decisions 38, 42, 48); decision 54's `notSeenInLatest` (verified-basis minima of the calendar day, the duration and the calendar gap), `superseded` (calendar-basis minima of the day and the duration, and the cell detail's calendar prices) and `stale` on route-level response points.

Why each field exists: a destination-filtered calendar must count that destination's cells, never every destination's, so the route takes the filter and the api computes the day for it (decision 53); the calendar day must say "price not confirmed" when its itinerary search priced cells but confirmed none of their prices (decisions 48, 51; the day carries counts, not outcome reasons); the duration view must say "not itinerary-searched" where only discovery ran and "searched 3 of 48 cells" where a stay length was only partly searched (a flag cannot tell one cell of hundreds from all of them, review prov-r2-007), and must name the departure date and destination of each minimum; history points must carry the same `stale` and "cheapest of the rows read" labels as every other price; unconfirmed offers must be told apart from confirmed ones; an offer line joins only consecutive runs, so each point names its run, and the itinerary's heading and destination come from the api on a bookmark too (decision 52); the verify button must show the hard stop the child would get and the calls of headroom left (WP7's `childCapPreview`, decisions 42, 45); and a minimum the latest search no longer returned, or a calendar price a newer run superseded, must say so wherever it is shown, as a results row already does, while a route-level point says when it is stale (decision 54). The two marks sit on the shapes WP10 renders; `priceCellSchema` and `routeSeriesPointSchema`, which other packages share, are unchanged. `historyPointSchema` itself is unchanged because `@gmt/db`'s `offerHistory` and route history return its type; WP8 adds the flags when it answers.

- [ ] **Step 1: Write the failing test**

`packages/core/test/api-contract/wp10.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  calendarDaySchema,
  calendarGapResponseSchema,
  calendarQuerySchema,
  cellDetailResponseSchema,
  durationAnalysisResponseSchema,
  historyPointSchema,
  itineraryHistoryResponseSchema,
  ROUTES,
  routeHistoryResponseSchema,
} from '../../src/api-contract/index.js';

// WP10's contract additions (plan decisions 38, 42, 48, 51, 52; spec §11 View B, View C, History). WP8 fills every field.
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
  it('duration analysis: each minimum carries its cell, and searched counts k of N per series', () => {
    const night = {
      nights: 14,
      minVerified: { ...price, cell, n: 3, notSeenInLatest: null },
      minCalendar: [{ providerId: 'travelpayouts', price: { ...price, cell, superseded: false }, n: 5 }],
      searched: {
        verification: { searched: 0, total: 4 },
        discovery: [{ providerId: 'travelpayouts', searched: 30, total: 48 }],
      },
    };
    const ok = durationAnalysisResponseSchema.safeParse({ byNights: [night], executions: [] });
    expect(ok.success).toBe(true);
    // why: a flag cannot tell one searched cell of hundreds from all of them (review prov-r2-007).
    const flags = { verification: true, discovery: [{ providerId: 'travelpayouts', searched: true }] };
    expect(
      durationAnalysisResponseSchema.safeParse({ byNights: [{ ...night, searched: flags }], executions: [] })
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

  it('itinerary history names its cell and carriers, and each point its run and whether its price was confirmed', () => {
    const base = {
      itineraryHash: 'h1',
      cell,
      carriers: ['BA'],
      series: [{ providerId: 'searchapi', seller: 'Example Air', cabin: 'economy' }],
    };
    const p = { ...point, stale: false, truncated: false };
    const one = (points: unknown[], over: object = {}) => ({
      ...base,
      ...over,
      series: [{ ...base.series[0], points }],
    });
    const full = { ...p, priceConfirmed: false, executionId: 'e1' };
    expect(itineraryHistoryResponseSchema.safeParse(one([full])).success).toBe(true);
    expect(itineraryHistoryResponseSchema.safeParse(one([{ ...p, executionId: 'e1' }])).success).toBe(false);
    expect(itineraryHistoryResponseSchema.safeParse(one([{ ...p, priceConfirmed: true }])).success).toBe(
      false,
    );
    // why: decision 52: the destination comes from the api, never from a cached Results row.
    const { cell: _cell, ...noCell } = base;
    expect(itineraryHistoryResponseSchema.safeParse({ ...noCell, series: one([full]).series }).success).toBe(
      false,
    );
  });

  it('the cell detail carries what a per-cell verify would spend, or null without a verification provider', () => {
    const detail = { cell, outcomes: [], calendarPrices: [], observations: [] };
    expect(cellDetailResponseSchema.safeParse(detail).success).toBe(false);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: null }).success).toBe(true);
    const verify = { maxCalls: 6, headroomCalls: 1840 };
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify }).success).toBe(true);
    expect(
      cellDetailResponseSchema.safeParse({ ...detail, verify: { ...verify, maxCalls: -1 } }).success,
    ).toBe(false);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: { maxCalls: 6 } }).success).toBe(false);
  });

  it('a calendar day counts its unconfirmed cells; the route takes an optional destination (decisions 51, 53)', () => {
    const day = {
      date: '2027-03-14',
      discovery: [],
      verification: { selected: 2, itinerarySearched: 2, onDemand: 0 },
      cheapestVerified: null,
      cheapestPartiallyVerified: null,
      cheapestCalendar: null,
      byDestination: [],
    };
    expect(calendarDaySchema.safeParse(day).success).toBe(false);
    const verification = { ...day.verification, unconfirmedCells: 1 };
    expect(calendarDaySchema.safeParse({ ...day, verification }).success).toBe(true);
    expect(
      calendarDaySchema.safeParse({ ...day, verification: { ...verification, unconfirmedCells: true } })
        .success,
    ).toBe(false);
    expect(calendarQuerySchema.safeParse({}).success).toBe(true);
    expect(calendarQuerySchema.safeParse({ destination: 'JFK' }).success).toBe(true);
    expect(calendarQuerySchema.safeParse({ destination: 'not-an-airport' }).success).toBe(false);
    const calendar = ROUTES.find((r) => r.method === 'GET' && r.path === '/api/definitions/:id/calendar');
    expect(calendar?.query).toBe(calendarQuerySchema);
  });

  it('decision 54: verified minima say when the latest search no longer returned them; calendar prices when superseded; route points their staleness', () => {
    const notSeen = { ageHours: 30 };
    const day = {
      date: '2027-03-14',
      discovery: [],
      verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 0 },
      cheapestVerified: { ...price, cell, itineraryHash: 'h1', notSeenInLatest: notSeen },
      cheapestPartiallyVerified: null,
      cheapestCalendar: { ...price, cell, superseded: true },
      byDestination: [],
    };
    expect(calendarDaySchema.safeParse(day).success).toBe(true);
    const { notSeenInLatest: _n, ...noNotSeen } = day.cheapestVerified;
    expect(calendarDaySchema.safeParse({ ...day, cheapestVerified: noNotSeen }).success).toBe(false);
    expect(calendarDaySchema.safeParse({ ...day, cheapestCalendar: { ...price, cell } }).success).toBe(false);
    const gap = {
      cheapestVerified: { ...price, cell, itineraryHash: 'h1', notSeenInLatest: null },
      cells: [],
    };
    expect(calendarGapResponseSchema.safeParse(gap).success).toBe(true);
    const { notSeenInLatest: _g, ...bareGap } = gap.cheapestVerified;
    expect(calendarGapResponseSchema.safeParse({ ...gap, cheapestVerified: bareGap }).success).toBe(false);
    const night = {
      nights: 14,
      minVerified: { ...price, cell, n: 1, notSeenInLatest: notSeen },
      minCalendar: [{ providerId: 'travelpayouts', price: { ...price, cell, superseded: false }, n: 1 }],
      searched: { verification: { searched: 1, total: 1 }, discovery: [] },
    };
    expect(durationAnalysisResponseSchema.safeParse({ byNights: [night], executions: [] }).success).toBe(
      true,
    );
    const oldCalendar = [{ providerId: 'travelpayouts', price: { ...price, cell }, n: 1 }];
    expect(
      durationAnalysisResponseSchema.safeParse({
        byNights: [{ ...night, minCalendar: oldCalendar }],
        executions: [],
      }).success,
    ).toBe(false);
    const detail = { cell, outcomes: [], observations: [], verify: null };
    const calendarPrice = { ...price, executionId: 'e1', calendarPriceId: 7 };
    expect(cellDetailResponseSchema.safeParse({ ...detail, calendarPrices: [calendarPrice] }).success).toBe(
      false,
    );
    expect(
      cellDetailResponseSchema.safeParse({
        ...detail,
        calendarPrices: [{ ...calendarPrice, superseded: true }],
      }).success,
    ).toBe(true);
    const routePoint = {
      date: '2027-03-10',
      pricePence: 38000,
      fetchedAt: '2026-10-14T13:00:00.000Z',
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
    };
    const route = (points: unknown[]) => ({
      origin: 'LHR',
      destination: 'JFK',
      calendarSeries: [],
      routeSeries: [{ providerId: 'searchapi', cabin: 'unknown', points }],
    });
    expect(routeHistoryResponseSchema.safeParse(route([routePoint])).success).toBe(false);
    expect(routeHistoryResponseSchema.safeParse(route([{ ...routePoint, stale: true }])).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract/wp10.test.ts`
Expected: FAIL, 6 of 6: the duration case with `expected false to be true` (the per-series `searched` counts are refused), the other five with `expected true to be false` (the old schemas accept a point without `stale`, an offer point without `priceConfirmed`, a detail without `verify`, a day without `unconfirmedCells`, and a verified minimum without `notSeenInLatest`).

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/results.ts` (after WP9's Task 9.0):

`packages/core/src/api-contract/results.ts` — find:

```ts
const pricedCell = priceCellSchema.extend({ cell: cellSchema });
export const calendarDaySchema = z.object({
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
const pricedCell = priceCellSchema.extend({ cell: cellSchema });
/**
 * Plan decision 54 on the views' figures. A verified-basis minimum the latest search no longer returned carries
 * `notSeenInLatest` (the same shape as a results row's); a calendar-basis price whose cell a newer parent execution
 * found empty or no_data is `superseded` (WP8 ranks such prices after current ones).
 */
const notSeenInLatest = z.object({ ageHours: ageHoursSchema }).nullable();
const verifiedFigure = pricedCell.extend({ itineraryHash: z.string(), notSeenInLatest });
const calendarFigure = pricedCell.extend({ superseded: z.boolean() });
export const calendarDaySchema = z.object({
```

`packages/core/src/api-contract/results.ts` — find:

```ts
  discovery: z.array(z.object({ providerId: providerIdSchema, buckets: bucketsSchema, total: count })),
  verification: z.object({ selected: count, itinerarySearched: count, onDemand: count }),
  cheapestVerified: pricedCell.extend({ itineraryHash: z.string() }).nullable(),
  cheapestPartiallyVerified: pricedCell.extend({ itineraryHash: z.string(), count }).nullable(),
  cheapestCalendar: pricedCell.nullable(),
  byDestination: z.array(
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
  discovery: z.array(z.object({ providerId: providerIdSchema, buckets: bucketsSchema, total: count })),
  /**
   * `unconfirmedCells`: cells of the day whose itinerary search priced but confirmed no price (reason part
   * `price-unconfirmed`; plan decisions 45, 48, 51), for the destination the request names, else every destination.
   */
  verification: z.object({
    selected: count,
    itinerarySearched: count,
    onDemand: count,
    unconfirmedCells: count,
  }),
  cheapestVerified: verifiedFigure.nullable(),
  cheapestPartiallyVerified: verifiedFigure.extend({ count }).nullable(),
  cheapestCalendar: calendarFigure.nullable(),
  byDestination: z.array(
```

`packages/core/src/api-contract/results.ts` — find:

```ts
});
export const calendarResponseSchema = z.object({
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
});
/**
 * Plan decision 53: the calendar route's optional destination. With it, every day's buckets, selection counts, minimums
 * and `unconfirmedCells` cover that destination's cells only, so a filtered calendar is as honest as the unfiltered one.
 */
export const calendarQuerySchema = z.object({ destination: iataSchema.optional() });
export const calendarResponseSchema = z.object({
```

`packages/core/src/api-contract/results.ts` — find:

```ts
});
export const durationAnalysisResponseSchema = z.object({
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
});
/**
 * Spec §11 View C per nights value. Each minimum carries the cell it came from (plan decision 38), so the view can name
 * its departure date and destination. `searched` counts per series: `total` is the cells of this nights value in the
 * series' scope (verification: the selected cells; discovery: every cell) and `searched` those whose outcome is
 * `priced`, `empty` or `no_data` (verification: any verification provider's outcome; discovery: that provider's), so
 * "not searched", "searched k of N" and "searched, no price" stay distinct per series.
 */
const searchedCount = z.object({ searched: count, total: count });
export const durationAnalysisResponseSchema = z.object({
```

`packages/core/src/api-contract/results.ts` — find:

```ts
      nights: count,
      minVerified: priceCellSchema.extend({ n: count }).nullable(),
      minCalendar: z.array(z.object({ providerId: providerIdSchema, price: priceCellSchema, n: count })),
      searched: z.boolean(),
    }),
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
      nights: count,
      /** n = cells of this nights value with a class-verified price */
      minVerified: pricedCell.extend({ n: count, notSeenInLatest }).nullable(),
      /** n = cells of this nights value the provider priced */
      minCalendar: z.array(z.object({ providerId: providerIdSchema, price: calendarFigure, n: count })),
      searched: z.object({
        verification: searchedCount,
        discovery: z.array(searchedCount.extend({ providerId: providerIdSchema })),
      }),
    }),
```

`packages/core/src/api-contract/results.ts` — find:

```ts
export const calendarGapResponseSchema = z.object({
  cheapestVerified: pricedCell.extend({ itineraryHash: z.string() }).nullable(),
  cells: z.array(z.object({ cell: cellSchema, calendar: priceCellSchema, verifyAvailable: z.boolean() })),
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
export const calendarGapResponseSchema = z.object({
  cheapestVerified: verifiedFigure.nullable(),
  cells: z.array(z.object({ cell: cellSchema, calendar: priceCellSchema, verifyAvailable: z.boolean() })),
```

`packages/core/src/api-contract/results.ts` — find:

```ts
  outcomes: z.array(cellOutcomeSchema),
  calendarPrices: z.array(
    priceCellSchema.extend({ executionId: z.string(), calendarPriceId: z.number().int() }),
  ),
  observations: z.array(resultRowSchema),
});
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
  outcomes: z.array(cellOutcomeSchema),
  /** `superseded` (decision 54): a newer parent execution found this cell empty or no_data. */
  calendarPrices: z.array(
    priceCellSchema.extend({
      executionId: z.string(),
      calendarPriceId: z.number().int(),
      superseded: z.boolean(),
    }),
  ),
  observations: z.array(resultRowSchema),
  /**
   * What the per-cell verify action would spend now (spec §8.1; plan decisions 42, 45): WP7's childCapPreview, the
   * child's hard stop and the calls of budget headroom left for it. Null when the definition has no verification
   * provider.
   */
  verify: z.object({ maxCalls: count, headroomCalls: count }).nullable(),
});
```

`packages/core/src/api-contract/results.ts` — find:

```ts
  provenance: provenanceSchema,
});
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
  provenance: provenanceSchema,
});
/**
 * A history point as the api sends it: the stored point plus `stale` (spec §3 and plan decision 44: by fetch age plus
 * any known vendor age) and `truncated` (decisions 30, 36: "cheapest of the rows read"). The db keeps historyPointSchema.
 */
export const historyPointResponseSchema = historyPointSchema.extend({
  stale: z.boolean(),
  truncated: z.boolean(),
});
```

`packages/core/src/api-contract/results.ts` — find:

```ts
});
export const itineraryHistoryResponseSchema = z.object({
  itineraryHash: z.string(),
  series: z.array(
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
});
/**
 * One itinerary's offer history. `cell` and `carriers` name it (plan decision 52: the heading and every price's
 * destination come from the api, never from a cached Results row). Each point names the execution that fetched it,
 * so lines join only consecutive runs of the definition (decision 52).
 */
export const itineraryHistoryResponseSchema = z.object({
  itineraryHash: z.string(),
  cell: cellSchema,
  carriers: z.array(z.string()),
  series: z.array(
```

`packages/core/src/api-contract/results.ts` — find:

```ts
      cabin: cabinSchema,
      points: z.array(historyPointSchema),
    }),
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
      cabin: cabinSchema,
      /** priceConfirmed: false for an offer whose price the final step did not confirm (decisions 27, 37) */
      points: z.array(
        historyPointResponseSchema.extend({ priceConfirmed: z.boolean(), executionId: z.string() }),
      ),
    }),
```

`packages/core/src/api-contract/results.ts` — find:

```ts
      cabin: cabinSchema,
      points: z.array(historyPointSchema.extend({ cell: cellSchema, executionId: z.string() })),
    }),
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
      cabin: cabinSchema,
      points: z.array(historyPointResponseSchema.extend({ cell: cellSchema, executionId: z.string() })),
    }),
```

`packages/core/src/api-contract/results.ts` — find:

```ts
      cabin: z.union([cabinSchema, z.literal('unknown')]),
      points: z.array(routeSeriesPointSchema),
    }),
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
      cabin: z.union([cabinSchema, z.literal('unknown')]),
      /** `stale` by fetch age (decision 54); the stored point type is unchanged */
      points: z.array(routeSeriesPointSchema.extend({ stale: z.boolean() })),
    }),
```

`packages/core/src/api-contract/index.ts`: the calendar route declares its query, which WP9's `call` sends and WP8 parses.

`packages/core/src/api-contract/index.ts` — find:

```ts
  calendarGapResponseSchema,
  calendarResponseSchema,
```

`packages/core/src/api-contract/index.ts` — replace with:

```ts
  calendarGapResponseSchema,
  calendarQuerySchema,
  calendarResponseSchema,
```

`packages/core/src/api-contract/index.ts` — find:

```ts
  route('GET', '/definitions/:id/results', resultsResponseSchema, { query: resultsQuerySchema }),
  route('GET', '/definitions/:id/calendar', calendarResponseSchema),
  route('GET', '/definitions/:id/duration-analysis', durationAnalysisResponseSchema),
```

`packages/core/src/api-contract/index.ts` — replace with:

```ts
  route('GET', '/definitions/:id/results', resultsResponseSchema, { query: resultsQuerySchema }),
  route('GET', '/definitions/:id/calendar', calendarResponseSchema, { query: calendarQuerySchema }),
  route('GET', '/definitions/:id/duration-analysis', durationAnalysisResponseSchema),
```

`HistoryPoint`, `RouteSeriesPoint` and `CalendarDay` keep their exports; `byDestination` is unchanged (decision 53 makes the filter the api's job).

`apps/web/test/fixtures.ts` (WP9's): its calendar-gap builder parses through the gap schema, which now requires `notSeenInLatest`:

`test/fixtures.ts` — find:

```ts
      itineraryHash: 'hash-verified-1',
    },
```

`test/fixtures.ts` — replace with:

```ts
      itineraryHash: 'hash-verified-1',
      notSeenInLatest: null,
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/api-contract`
Expected: PASS; `wp10.test.ts` passes 6 tests and the other contract files are unchanged.

Run: `pnpm -r typecheck`
Expected: clean. `@gmt/db` still compiles because `HistoryPoint` is unchanged; nothing on `main` reads the changed duration, history or cell-detail shapes yet (WP8 is the first producer, §13).

- [ ] **Step 5: Commit**

```bash
git add packages/core apps/web/test/fixtures.ts && git commit -m "wp10: calendar destination query, unconfirmed cells, searched counts, decision-54 marks, history fields, verify"
```

### Task 10.2: Run times in Europe/London, grid and instant forms in format.ts, instant helpers, and the Date guard (review focus 3, part 1)

**Files:**
- Create: `apps/web/src/lib/time.ts`, `apps/web/test/lib/{dates.test.ts,time.test.ts,noDateParsing.test.ts}`
- Modify (WP9): `apps/web/src/format.ts` (its import line, `formatInstantUtc`, and a block appended after its last function), `apps/web/src/components/{ViewHeader,StatusBar}.tsx`, `apps/web/test/format.test.ts`, `apps/web/test/components/statusBar.test.tsx`, `apps/web/test/views/coverage.test.tsx`

**Interfaces:**
- Consumes: `toEpochDay`, `addDays`, `monthOf`, `isoDateSchema`, `isoDateTimeSchema`, `fromEpochDay`; WP9's `formatIsoDate`, `formatIsoDateShort`, `formatIsoDateLong`, `formatWeekday` and its private `MONTHS` and `WEEKDAYS` table.
- Produces: `formatRunInstant` (replacing WP9's `formatInstantUtc`), `weekdayIndex`, `WEEK_HEADERS`, `formatDayOfMonth`, `formatDayShort`, `formatIsoMonth`, `monthDays`, `formatInstantLondon`, `formatInstantDateLondon`, `formatAxisPounds` (in `format.ts`); `instantMs`, `dateMs`, `dateOfMs` (in `lib/time.ts`).

Decision 52: every run time the web shows is in `SCHEDULER_TIMEZONE` (Europe/London), the zone runs are scheduled in, so one run never reads as the 14th in the header and the 15th in the panel. WP9's `formatInstantUtc` becomes `formatRunInstant` ("14 Oct 2026 13:00 Europe/London"); its two callers, `ViewHeader` and the status bar's "resumes …", and the WP9 tests that quote a run time change with it. `formatAxisPounds` prints a chart's price tick as whole pounds without "£" (the axis title says GBP), so a chart holds no "£" outside a PriceCell (decision 52).

Decisions 38 and 46: one date-formatting module with one month and weekday table. WP10 adds no table: the grid's Monday-first headers and the month caption read WP9's `WEEKDAYS` and `MONTHS`, and the instant forms take only numeric parts from `Intl` (Europe/London) and print them with `formatIsoDate`. `lib/time.ts` only turns instants into epoch milliseconds and does epoch-day arithmetic; it formats nothing.

The guard forbids `Date` objects, not epoch arithmetic: a `Date` renders in the browser's zone through its local getters and `toLocale*String`, while `Date.parse`, `Date.UTC` and `Date.now` return milliseconds, which carry no zone. Only WP9's `now.tsx` builds one.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/lib/dates.test.ts`:

```ts
import { asIsoDate, asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  formatDayOfMonth,
  formatDayShort,
  formatInstantDateLondon,
  formatInstantLondon,
  formatIsoDateLong,
  formatIsoMonth,
  monthDays,
  WEEK_HEADERS,
  weekdayIndex,
} from '../../src/format.js';

const d = asIsoDate;

describe('WP10’s date forms in WP9’s format.ts (spec §6.1, review focus 3, decisions 38, 46)', () => {
  it('weekday from the epoch day, Monday = 0, negative epoch days included', () => {
    expect(weekdayIndex(d('1970-01-01'))).toBe(3); // Thursday
    expect(weekdayIndex(d('2027-03-01'))).toBe(0); // Monday
    expect(weekdayIndex(d('2027-03-14'))).toBe(6); // Sunday, the US DST change
    expect(weekdayIndex(d('2027-03-28'))).toBe(6); // Sunday, the UK DST change
    expect(weekdayIndex(d('1969-12-31'))).toBe(2); // Wednesday
  });
  it('the grid forms read WP9’s one month and weekday table (decision 46)', () => {
    expect(WEEK_HEADERS).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(formatDayShort(d('2027-03-14'))).toBe('Sun 14 Mar');
    expect(formatIsoDateLong(d('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatIsoDateLong(d('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatDayOfMonth(d('2027-03-04'))).toBe('4');
    expect(formatIsoMonth(asIsoMonth('2027-03'))).toBe('Mar 2027');
  });
  it('lists the days of a month, leap February included', () => {
    expect(monthDays(asIsoMonth('2027-02'))).toHaveLength(28);
    const leap = monthDays(asIsoMonth('2028-02'));
    expect(leap).toHaveLength(29);
    expect(leap[28]).toBe('2028-02-29');
  });
  it('formats instants in Europe/London whatever the process zone, with the year', () => {
    expect(formatInstantLondon(Date.UTC(2027, 2, 14, 15))).toBe('14 Mar 2027 15:00'); // GMT
    expect(formatInstantLondon(Date.UTC(2027, 6, 1, 15))).toBe('1 Jul 2027 16:00'); // BST
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
// why: a Date object renders in the browser's zone: built from 'YYYY-MM-DD' it is UTC midnight, and its local getters
// and toLocale*String show the previous day west of Greenwich. So no file but now.tsx (WP9: the current instant) builds a
// Date. Date.parse, Date.UTC and Date.now return epoch milliseconds, which carry no zone, so they are not hazards; the
// formatters take those milliseconds into an Intl.DateTimeFormat with an explicit timeZone (src/format.ts).
const ALLOWLIST = new Set(['now.tsx']);
const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'new Date(', re: /\bnew\s+Date\s*\(/g },
  { name: 'Date(', re: /(?<![.\w])Date\s*\(/g },
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

describe('no Date object outside WP9’s clock (review focus 3)', () => {
  it('the scanner finds each forbidden form, across lines, and ignores comments and string helpers', () => {
    expect(scan(`const d = new Date('2027-03-14');`)).toEqual(['1: Date(', '1: new Date(']);
    expect(scan(`const d = new\n  Date(\n'2027-03-14');`)).toEqual(['1: new Date(', '2: Date(']);
    // why: epoch milliseconds carry no zone; only a Date object (or a library around one) can shift a day.
    expect(scan(`const t = Date.parse(day.at) + Date.UTC(2027, 2, 14) + Date.now();`)).toEqual([]);
    expect(scan(`const s = Date();`)).toEqual(['1: Date(']);
    expect(scan(`const n = when.getDate();`)).toEqual(['1: local date getter']);
    expect(scan(`label = x.toLocaleDateString('en-GB');`)).toEqual(['1: toLocale*String(']);
    expect(scan(`import { format } from 'date-fns';`)).toEqual(['1: date library import']);
    expect(
      scan(`// new Date('2027-03-14')\n/* Date.parse(x) */ const ok = formatDayShort(day.date);`),
    ).toEqual([]);
    expect(scan(`const ok = formatDayShort(day.date); const url = 'http://x//y';`)).toEqual([]);
  });
  it('finds no Date object in apps/web/src outside the allowlist', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(20); // why: a wrong SRC path must not make this vacuous
    const hits = files
      .filter((f) => !ALLOWLIST.has(relative(SRC, f).split(sep).join('/')))
      .flatMap((f) => scan(readFileSync(f, 'utf8')).map((h) => `${relative(SRC, f)}:${h}`));
    expect(hits).toEqual([]);
  });
  it('the allowlist is exactly WP9’s clock, and it exists', () => {
    expect([...ALLOWLIST]).toEqual(['now.tsx']);
    for (const f of ALLOWLIST) expect(statSync(join(SRC, f)).isFile()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/lib`
Expected: FAIL. `dates.test.ts` fails with `TypeError: weekdayIndex is not a function` (and `formatDayShort`, `monthDays`, …); `time.test.ts` with `Failed to resolve import "../../src/lib/time.js"`. `noDateParsing.test.ts` passes already: it guards code that exists (WP9's code builds a `Date` only in `now.tsx`), and its planted cases are what prove it bites. If it lists a WP9 file, report it to the WP9 owner rather than editing that file.

WP9's tests that quote a run time move to Europe/London in the same red step (until Step 3, `format.test.ts` fails with `formatRunInstant is not a function` and the status bar and coverage tests find no "Europe/London" text):

`test/format.test.ts` — find:

```ts
import {
  formatInstantUtc,
  formatIsoDate,
```

`test/format.test.ts` — replace with:

```ts
import {
  formatIsoDate,
```

`test/format.test.ts` — find:

```ts
  formatMinutes,
  formatSeconds,
```

`test/format.test.ts` — replace with:

```ts
  formatMinutes,
  formatRunInstant,
  formatSeconds,
```

`test/format.test.ts` — find:

```ts

  it('a run instant is labelled UTC and never shifted; segment times are airport wall time', () => {
    expect(formatInstantUtc('2026-10-14T12:00:00.000Z')).toBe('14 Oct 2026 12:00 UTC');
    expect(formatLocalDateTime('2027-03-14T10:25')).toBe('14 Mar 10:25');
```

`test/format.test.ts` — replace with:

```ts

  it('a run instant is shown in Europe/London and labelled; segment times are airport wall time', () => {
    expect(formatRunInstant('2026-10-14T12:00:00.000Z')).toBe('14 Oct 2026 13:00 Europe/London');
    expect(formatRunInstant('2026-12-14T12:00:00.000Z')).toBe('14 Dec 2026 12:00 Europe/London');
    expect(formatLocalDateTime('2027-03-14T10:25')).toBe('14 Mar 10:25');
```

`test/components/statusBar.test.tsx` — find:

```tsx
    expect(
      await screen.findByText('Paused: searchapi provider-month cap reached · resumes 1 Nov 2026 00:00 UTC'),
    ).toBeInTheDocument();
```

`test/components/statusBar.test.tsx` — replace with:

```tsx
    expect(
      await screen.findByText(
        'Paused: searchapi provider-month cap reached · resumes 1 Nov 2026 00:00 Europe/London',
      ),
    ).toBeInTheDocument();
```

`test/components/statusBar.test.tsx` — find:

```tsx
      screen.getByText(
        'showing run started 14 Oct 2026 12:00 UTC (running, just now), run started 7 Oct 2026 12:00 UTC (completed, age unknown)',
      ),
```

`test/components/statusBar.test.tsx` — replace with:

```tsx
      screen.getByText(
        'showing run started 14 Oct 2026 13:00 Europe/London (running, just now), run started 7 Oct 2026 13:00 Europe/London (completed, age unknown)',
      ),
```

`test/views/coverage.test.tsx` — find:

```tsx
    expect(
      await screen.findByText('showing run started 14 Oct 2026 14:00 UTC (running, 1h ago)'),
    ).toBeInTheDocument();
```

`test/views/coverage.test.tsx` — replace with:

```tsx
    expect(
      await screen.findByText('showing run started 14 Oct 2026 15:00 Europe/London (running, 1h ago)'),
    ).toBeInTheDocument();
```

- [ ] **Step 3: Implement**

`src/format.ts` — find:

```ts
import { formatPence, type IsoDate, microGbpToPence, toEpochDay } from '@gmt/core';
```

`src/format.ts` — replace with:

```ts
import {
  addDays,
  formatPence,
  type IsoDate,
  type IsoMonth,
  isoDateSchema,
  microGbpToPence,
  monthOf,
  toEpochDay,
} from '@gmt/core';
```

`src/format.ts` — find:

```ts

/** A run's UTC instant, "2026-10-14T12:00:00.000Z" → "14 Oct 2026 12:00 UTC" (labelled UTC, never shifted). */
export function formatInstantUtc(iso: string): string {
  return `${formatIsoDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
}
```

`src/format.ts` — replace with:

```ts

/**
 * A run's instant in SCHEDULER_TIMEZONE, labelled (plan decision 52: every run time the web shows is Europe/London,
 * the zone runs are scheduled in): "2026-10-14T12:00:00.000Z" → "14 Oct 2026 13:00 Europe/London".
 */
export function formatRunInstant(iso: string): string {
  return `${formatInstantLondon(Date.parse(iso))} Europe/London`;
}
```

`src/format.ts` — find:

```ts
  return penceToPoundsInput(parsePoundsToPence(input));
}
```

`src/format.ts` — replace with:

```ts
  return penceToPoundsInput(parsePoundsToPence(input));
}

// --- WP10: calendar-grid and instant forms (decisions 38, 46: this module, its one month and weekday table) ---

/** Weekday with Monday = 0, the calendar grid's column, from core's epoch day (1970-01-01 was a Thursday, index 3). */
export function weekdayIndex(d: IsoDate): number {
  return (((toEpochDay(d) + 3) % 7) + 7) % 7;
}

/** The grid's Monday-first column headers, read from the one weekday table. */
export const WEEK_HEADERS: readonly string[] = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAYS[i] ?? '');

/** "2027-03-14" → "14", the grid's day number. */
export function formatDayOfMonth(d: IsoDate): string {
  return String(Number(d.slice(8, 10)));
}

/** "2027-03-14" → "Sun 14 Mar" (day cells, the panel's cell picker, chart tooltips). */
export function formatDayShort(d: IsoDate): string {
  return `${formatWeekday(d)} ${formatIsoDateShort(d)}`;
}

/** "2027-03" → "Mar 2027" (month grids); malformed input is returned as given. */
export function formatIsoMonth(m: IsoMonth): string {
  const month = MONTHS[Number(m.slice(5, 7)) - 1];
  return month === undefined ? m : `${month} ${m.slice(0, 4)}`;
}

/** Every date of a month, in order, by epoch-day steps; isoDateSchema validates and brands the first day. */
export function monthDays(m: IsoMonth): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = isoDateSchema.parse(`${m}-01`); monthOf(d) === m; d = addDays(d, 1)) out.push(d);
  return out;
}

// why: numeric parts only, so the month name comes from the one table above, never from Intl; Intl takes epoch ms,
// so nothing here builds a Date. Europe/London is the app's reference zone (spec §6.1).
const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function londonParts(ms: number): { date: string; time: string } {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    LONDON_PARTS.formatToParts(ms).find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/** Epoch ms → "14 Mar 2027 15:00" in Europe/London (history tables, the panel's fetched column). */
export function formatInstantLondon(ms: number): string {
  const { date, time } = londonParts(ms);
  return `${formatIsoDate(date)} ${time}`;
}

/** Epoch ms → "14 Mar 2027" in Europe/London (the History fetch axis, run dates). */
export function formatInstantDateLondon(ms: number): string {
  return formatIsoDate(londonParts(ms).date);
}

/**
 * A chart's price-axis tick, whole pounds without the sign ("1,200"; the axis title says GBP). A scale value, never a
 * fare: with no "£" it needs no exemption from the rendered sweep, and every fare in a chart goes through PriceCell
 * (plan decision 52).
 */
export function formatAxisPounds(pence: number): string {
  return formatPence(Math.round(pence / 100) * 100).replace('£', '');
}
```

`src/components/ViewHeader.tsx` — find:

```tsx
import { COPY } from '../copy.js';
import { formatInstantUtc } from '../format.js';
```

`src/components/ViewHeader.tsx` — replace with:

```tsx
import { COPY } from '../copy.js';
import { formatRunInstant } from '../format.js';
```

`src/components/ViewHeader.tsx` — find:

```tsx
  const make = e.isChild ? COPY.childExecutionItem : COPY.executionItem;
  return make(formatInstantUtc(e.startedAt), status, COPY.agoOf(e.ageHours));
}
```

`src/components/ViewHeader.tsx` — replace with:

```tsx
  const make = e.isChild ? COPY.childExecutionItem : COPY.executionItem;
  return make(formatRunInstant(e.startedAt), status, COPY.agoOf(e.ageHours));
}
```

`src/components/StatusBar.tsx` — find:

```tsx
import { COPY } from '../copy.js';
import { formatInstantUtc, formatIsoDate, formatMicroGbp } from '../format.js';
import { parseBasis } from '../state/resultsState.js';
```

`src/components/StatusBar.tsx` — replace with:

```tsx
import { COPY } from '../copy.js';
import { formatIsoDate, formatMicroGbp, formatRunInstant } from '../format.js';
import { parseBasis } from '../state/resultsState.js';
```

`src/components/StatusBar.tsx` — find:

```tsx
                {COPY.paused(e.reason ?? COPY.statusName[e.status])}
                {e.resumeAfter !== null ? ` · ${COPY.resumesAt(formatInstantUtc(e.resumeAfter))}` : null}
              </span>
```

`src/components/StatusBar.tsx` — replace with:

```tsx
                {COPY.paused(e.reason ?? COPY.statusName[e.status])}
                {e.resumeAfter !== null ? ` · ${COPY.resumesAt(formatRunInstant(e.resumeAfter))}` : null}
              </span>
```

`apps/web/src/lib/time.ts`:

```ts
import { fromEpochDay, type IsoDate, isoDateTimeSchema, toEpochDay } from '@gmt/core';

// Instants as epoch milliseconds, which carry no zone (review focus 3; test/lib/noDateParsing.test.ts forbids Date
// objects outside src/now.tsx). Inputs are toISOString instants or epoch-day integers; a date-only string is refused.

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

Run: `pnpm --filter @gmt/web exec vitest run test/lib test/format.test.ts test/components/statusBar.test.tsx test/views/coverage.test.tsx`
Expected: PASS: `test/lib` 3 files, 9 tests; WP9's format (7), status bar (20) and coverage (12) tests with run times in Europe/London.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: run times in Europe/London, grid and instant forms on format.ts's one table, instant helpers, Date guard"
```

### Task 10.3: API wiring, copy, fixtures, source labels and the six-bucket marker

**Files:**
- Create: `apps/web/src/lib/sources.ts`, `apps/web/src/views/Calendar/{types.ts,marker.ts,DayMarker.tsx}`, `apps/web/test/fixtures.wp10.ts`, `apps/web/test/msw/wp10Handlers.ts`, `apps/web/test/lib/sources.test.ts`, `apps/web/test/views/calendar/marker.test.tsx`
- Modify (WP9): `apps/web/src/api/{types.ts,endpoints.ts,queries.ts}`, `apps/web/src/copy.ts`, `apps/web/test/msw/handlers.ts`, `apps/web/test/copy/catalogue.test.ts`

**Interfaces:**
- Consumes: the Task 10.1 schemas through `z.output`; `call(schema, …)`, `POLL_MS`, `useProviders`, `useExecutionActions`; `COPY.source`, `COPY.provider`, `COPY.reusedNote`; WP9's `provSearch`, `provCalendar`, `provSynthetic` (wire form), `summary`; core's `provenanceSchema`, `isoDateTimeOfEpochMs`, `effectiveAge`, `worstCaseAgeHours`.
- Produces: the WP10 `api.*`, `qk.*` and query hooks with `whileRunning` (`api.calendar` sends the destination filter, decision 53; the two idle queries use TanStack's `skipToken`); `COPY.calendarView`, `COPY.durationView`, `COPY.historyView` (the panel's reason map `satisfies` a record over core's `SkipReason | NoDataReason | ErrorReason` and the priced-reason parts, so a new or renamed core reason fails to compile here); `discoverySourceLabel`, `sourceLabelOf`; `DaySlice`, `DayPrice`, `GridDay`, `GlyphStatus`, `DayBasis`, `bucketTotal`, `searchedCount`, `countsConsistent`, `formatDiscoveryMarker`, `formatVerificationMarker`, `totalReused`, `Coverage`, `bestCovered`, `coverageOf`, `providersNotSearched`, `SliceOptions`, `sliceOf`, `DayMarker`, `ReusedNote`; the WP10 test builders and default handlers.

The marker is the spec's six-bucket marker (spec §3 defines six buckets; §9 item 6's "five-way" is a wording slip, §13). Its total M is the api's `total`; when that disagrees with the six buckets' sum the line says "counts inconsistent" (plan decision 38). Discovery counts carry only a providerId, so their source label comes from the provider's discovery capability in GET /api/providers, not from a table in code; a provider the definition names that has no counts for the day gets its own "not searched yet for this day" line (review prov-r2-009), so another provider's line never stands for it. A day is taken as the api sent it: with a destination filter the api already computed that destination's buckets, minimums and unconfirmed cells (decision 53), so the web slices nothing and the slice's `destination` only names the filter in words.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/fixtures.wp10.ts` (WP10's builders over WP9's `test/fixtures.ts`; each contract shape, provenance included, goes through its schema):

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
  provenanceSchema,
  worstCaseAgeHours,
} from '@gmt/core';
import type { z } from 'zod';
import type {
  CalendarDay,
  CalendarResponse,
  CellDetailResponse,
  DurationResponse,
  ExecutionSummary,
  ItineraryHistoryResponse,
  PriceCellData,
  RouteHistoryResponse,
} from '../src/api/types.js';
import { bucketTotal, type SliceOptions, sliceOf } from '../src/views/Calendar/marker.js';
import type { DaySlice, GridDay } from '../src/views/Calendar/types.js';
import { provCalendar, provSearch, provSynthetic, summary } from './fixtures.js';
import { NOW, type ProvenanceInput } from './render.js';

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

/** WP9's wire-form provenance, re-dated and parsed through core's schema (brands minted by zod, never by hand). */
function prov(base: ProvenanceInput, h: number, over: Partial<ProvenanceInput> = {}): Provenance {
  return provenanceSchema.parse({ ...base, fetchedAt: hoursBefore(h), ...over });
}

/** SearchApi itinerary provenance as stored: maxAgeHours 'unknown' (spec rev 15 §3, plan decision 24). */
export function provItinerary(h: number): Provenance {
  return prov(provSearch, h, { maxAgeHours: 'unknown' });
}

/** A known-age itinerary provenance; no current provider produces one, so only the precedence tie test uses it. */
export function provItineraryKnownAge(h: number, maxAgeHours: number): Provenance {
  return prov(provSearch, h, { maxAgeHours });
}

/** Travelpayouts calendar provenance fetched h hours before NOW. */
export function provCalendarAt(h: number, maxAgeHours: number | 'unknown' = 48): Provenance {
  return prov(provCalendar, h, { maxAgeHours });
}

/** The fixture provider's synthetic provenance, from WP9's provSynthetic (spec §5.5). */
export function provSyntheticAt(h: number): Provenance {
  return prov(provSynthetic, h);
}

/** Decision 54's marks on a view figure; a builder that does not set them sends neither. */
export interface Marks {
  notSeenInLatest: { ageHours: number | 'unknown' } | null;
  superseded: boolean;
}

/**
 * A day price as calendarDaySchema sends it, its age from core's effective-age rule. It carries both decision-54
 * fields, so it fits a verified or a calendar minimum (the contract parse keeps the one each shape declares).
 */
export function priceAt(
  pricePence: number,
  provenance: Provenance,
  stale: boolean,
  at: Cell,
  truncated = false,
  marks: Partial<Marks> = {},
): PriceCellData & { cell: Cell; itineraryHash: string } & Marks {
  const ageHours = worstCaseAgeHours(effectiveAge(provenance, NOW));
  return {
    pricePence,
    provenance,
    stale,
    ageHours,
    truncated,
    cell: at,
    itineraryHash: `it-${at.departureDate}-${pricePence}`,
    notSeenInLatest: marks.notSeenInLatest ?? null,
    superseded: marks.superseded ?? false,
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
  return { providerId, buckets: b, total: total ?? bucketTotal(b) };
}

/** A calendar day through the contract schema. */
export function day(date: string, partial: Partial<Omit<CalendarDay, 'date'>> = {}): CalendarDay {
  return apiContract.calendarDaySchema.parse({
    date,
    discovery: [],
    verification: { selected: 0, itinerarySearched: 0, onDemand: 0, unconfirmedCells: 0 },
    cheapestVerified: null,
    cheapestPartiallyVerified: null,
    cheapestCalendar: null,
    byDestination: [],
    ...partial,
  });
}

/** Definition options with both stages configured. */
export const BOTH: SliceOptions = { verificationConfigured: true, discoveryProviders: ['travelpayouts'] };

export function slice(partial: Partial<DaySlice>): DaySlice {
  return {
    discovery: [],
    discoveryProviders: ['travelpayouts'],
    verification: null,
    unconfirmedCells: 0,
    cheapestVerified: null,
    cheapestPartiallyVerified: null,
    cheapestCalendar: null,
    destination: null,
    ...partial,
  };
}

/** A grid day as the unfiltered calendar returns it. */
export function gridDay(
  date: string,
  partial: Partial<Omit<CalendarDay, 'date'>> = {},
  o: SliceOptions = BOTH,
): GridDay {
  return { date: asIsoDate(date), slice: sliceOf(day(date, partial), o, null) };
}

/**
 * Parent runs started h hours before NOW, newest first as the executions list sends them, each with id `exec-<h>`
 * (the run ids fetchPoint and offerPoint give their points), so History's run order can be set per test.
 */
export function runsAt(...hours: number[]): ExecutionSummary[] {
  return [...hours]
    .sort((a, b) => a - b)
    .map((h) =>
      summary({ id: `exec-${h}`, startedAt: hoursBefore(h), finishedAt: hoursBefore(h), ageHours: h }),
    );
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

/** How much of a nights value a series searched: all of it, none of it, or [searched, total] cells. */
type Searched = boolean | [number, number];
function searchedOf(s: Searched, total: number): { searched: number; total: number } {
  if (s === true) return { searched: total, total };
  if (s === false) return { searched: 0, total };
  return { searched: s[0], total: s[1] };
}

/** One nights value; verified/calendar are [pence, n] or null; `searched` says how much each series searched. */
export function night(
  nights: number,
  verified: [number, number] | null,
  calendar: [number, number] | null,
  searched: { verification: Searched; travelpayouts: Searched } = { verification: true, travelpayouts: true },
  at: Cell = cellAt('2027-03-14', nights),
): Night {
  return {
    nights,
    minVerified:
      verified === null
        ? null
        : {
            ...bare(priceAt(verified[0], provItinerary(5), false, at)),
            cell: at,
            n: verified[1],
            notSeenInLatest: null,
          },
    minCalendar:
      calendar === null
        ? []
        : [
            {
              providerId: 'travelpayouts',
              price: {
                ...bare(priceAt(calendar[0], provCalendarAt(2), false, at)),
                cell: at,
                superseded: false,
              },
              n: calendar[1],
            },
          ],
    searched: {
      verification: searchedOf(searched.verification, 4),
      discovery: [{ providerId: 'travelpayouts', ...searchedOf(searched.travelpayouts, 48) }],
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
    verify: { maxCalls: 6, headroomCalls: 1840 },
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
          stale: false,
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
    executionId: `exec-${h}`,
    ...over,
  };
}

export function itineraryHistory(over: Partial<ItineraryHistoryResponse> = {}): ItineraryHistoryResponse {
  return apiContract.itineraryHistoryResponseSchema.parse({
    itineraryHash: 'hash-verified-1',
    cell: cellAt('2027-03-14', 14),
    carriers: ['BA'],
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
  providersNotSearched,
  sliceOf,
  totalReused,
} from '../../../src/views/Calendar/marker.js';
import { BOTH, buckets, cellAt, day, disc, priceAt, provCalendarAt, slice } from '../../fixtures.wp10.js';
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
    expect(
      formatVerificationMarker({ selected: 10, itinerarySearched: 1, onDemand: 2, unconfirmedCells: 0 }),
    ).toBe('itinerary-searched 1 of 10 selected +2 on demand');
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
          discoveryProviders: ['travelpayouts', 'searchapi'],
          verification: { selected: 10, itinerarySearched: 1, onDemand: 2, unconfirmedCells: 0 },
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
    const none = renderWithProviders(<DayMarker slice={slice({ discoveryProviders: [] })} />);
    expect(none.getByTestId('day-marker')).toHaveTextContent('no discovery provider configured');
    none.unmount();
    const noRun = renderWithProviders(<DayMarker slice={slice({ discovery: [] })} />);
    expect(noRun.getByTestId('day-marker')).toHaveTextContent('not searched yet: no run covers this day');
    expect(noRun.getByTestId('day-marker')).not.toHaveTextContent('no discovery provider configured');
  });

  it('a configured provider with no counts for the day gets its own "not searched yet" line (prov-r2-009)', async () => {
    const s = slice({
      discovery: [disc('travelpayouts', { priced: 48 })],
      discoveryProviders: ['travelpayouts', 'searchapi'],
    });
    expect(providersNotSearched(s)).toEqual(['searchapi']);
    const { findAllByRole } = renderWithProviders(<DayMarker slice={s} />);
    const lines = await findAllByRole('listitem');
    expect(lines).toHaveLength(2);
    await expect
      .poll(() => lines[1]?.textContent)
      .toBe('Google date grid via SearchApi: not searched yet for this day');
  });

  it("the unconfirmed line counts the slice's own cells, naming the destination under a filter (decision 51)", () => {
    const all = renderWithProviders(<DayMarker slice={slice({ unconfirmedCells: 2 })} />);
    expect(all.getByTestId('day-marker')).toHaveTextContent(
      'price not confirmed: 2 itinerary-searched cells priced nothing the final step confirmed',
    );
    all.unmount();
    const jfk = renderWithProviders(
      <DayMarker slice={slice({ unconfirmedCells: 1, destination: asIata('JFK') })} />,
    );
    expect(jfk.getByTestId('day-marker')).toHaveTextContent(
      'price not confirmed: 1 itinerary-searched JFK cell priced nothing the final step confirmed',
    );
  });

  it('a day is taken as the api computed it for the filter; the destination only names it (decision 53)', () => {
    const jfkCell = cellAt('2027-03-14', 12);
    const d = day('2027-03-14', {
      discovery: [disc('travelpayouts', { priced: 4, not_run: 20 })],
      verification: { selected: 4, itinerarySearched: 4, onDemand: 0, unconfirmedCells: 1 },
      cheapestCalendar: priceAt(41200, provCalendarAt(2), false, jfkCell),
    });
    const jfk = sliceOf(d, BOTH, asIata('JFK'));
    expect(jfk.destination).toBe('JFK');
    expect(jfk.cheapestCalendar?.cell).toEqual(jfkCell);
    expect(jfk.unconfirmedCells).toBe(1);
    expect(coverageOf(jfk)).toEqual({
      kind: 'fraction',
      searched: 4,
      total: 24,
      providerId: 'travelpayouts',
    });
    const off = sliceOf(d, { ...BOTH, verificationConfigured: false }, null);
    expect(off.verification).toBeNull();
    expect(off.unconfirmedCells).toBe(0);
    const { getByTestId } = renderWithProviders(<DayMarker slice={jfk} />);
    expect(getByTestId('day-marker')).toHaveTextContent('4 priced · 0 no fares');
    expect(getByTestId('day-marker')).not.toHaveTextContent('all destinations');
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
Expected: FAIL, both files: `Failed to resolve import "../../src/lib/sources.js"`, and `Failed to resolve import "../src/views/Calendar/marker.js" from "test/fixtures.wp10.ts"` (the builders use `sliceOf`).

- [ ] **Step 3: Implement**

`apps/web/src/api/types.ts`: append

```ts
// WP10 routes (plan "API contract", results.ts, with WP10's additions of decisions 38, 42 and 48).
export type { CalendarDay } from '@gmt/core';
export type CalendarResponse = z.output<typeof apiContract.calendarResponseSchema>;
export type DurationResponse = z.output<typeof apiContract.durationAnalysisResponseSchema>;
export type CellDetailResponse = z.output<typeof apiContract.cellDetailResponseSchema>;
export type ItineraryHistoryResponse = z.output<typeof apiContract.itineraryHistoryResponseSchema>;
export type RouteHistoryResponse = z.output<typeof apiContract.routeHistoryResponseSchema>;
```

`apps/web/src/api/endpoints.ts`: each WP10 route names its contract schema, which WP9's `call` checks against `ROUTES` and parses with.

`src/api/endpoints.ts` — find:

```ts
import { apiContract as c } from '@gmt/core';
import { call } from './client.js';
```

`src/api/endpoints.ts` — replace with:

```ts
import { type Cabin, type CellKey, apiContract as c, type Iata } from '@gmt/core';
import { call } from './client.js';
```

`src/api/endpoints.ts` — find:

```ts
  airports: (q: string) => call(c.airportsResponseSchema, 'GET', '/api/airports', { query: { q } }),
};
```

`src/api/endpoints.ts` — replace with:

```ts
  airports: (q: string) => call(c.airportsResponseSchema, 'GET', '/api/airports', { query: { q } }),
  // WP10 (spec §10; plan decision 53): both bases per day, for one destination when given, else every destination.
  calendar: (id: string, destination: Iata | null) =>
    call(c.calendarResponseSchema, 'GET', '/api/definitions/:id/calendar', {
      params: { id },
      query: { destination: destination ?? undefined },
    }),
  durationAnalysis: (id: string) =>
    call(c.durationAnalysisResponseSchema, 'GET', '/api/definitions/:id/duration-analysis', {
      params: { id },
    }),
  cellDetail: (id: string, k: CellKey) =>
    call(
      c.cellDetailResponseSchema,
      'GET',
      '/api/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      {
        params: {
          id,
          origin: k.origin,
          destination: k.destination,
          departureDate: k.departureDate,
          returnDate: k.returnDate,
        },
      },
    ),
  itineraryHistory: (hash: string) =>
    call(c.itineraryHistoryResponseSchema, 'GET', '/api/itineraries/:hash/history', { params: { hash } }),
  // why: routeHistoryQuerySchema { cabin?: Cabin }; the view always passes the definition's cabin.
  routeHistory: (origin: string, destination: string, cabin: Cabin) =>
    call(c.routeHistoryResponseSchema, 'GET', '/api/routes/:origin/:destination/history', {
      params: { origin, destination },
      query: { cabin },
    }),
};
```

`apps/web/src/api/queries.ts`: the WP10 keys (the calendar's carries its destination), every WP10 prefix in `useExecutionActions`' refresh (a start, cancel, resume or single-cell verify refreshes every WP10 view, po-wp10-006), and the WP10 hooks, polling at WP9's `POLL_MS` while the newest run is pending or running; a hook with nothing to fetch passes `skipToken`, so no sentinel key or rejecting function exists (review arch2-013).

`src/api/queries.ts` — find:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';
```

`src/api/queries.ts` — replace with:

```ts
import { type Cabin, type CellKey, cellKeyString, type Iata } from '@gmt/core';
import { skipToken, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';
```

`src/api/queries.ts` — find:

```ts
  airports: (q: string) => ['airports', q] as const,
};
```

`src/api/queries.ts` — replace with:

```ts
  airports: (q: string) => ['airports', q] as const,
  // WP10
  calendar: (id: string, destination: Iata | null) => ['calendar', id, destination ?? 'all'] as const,
  duration: (id: string) => ['duration', id] as const,
  cell: (id: string, key: string | null) => ['cell', id, key] as const,
  itineraryHistory: (hash: string | null) => ['history', 'itinerary', hash] as const,
  routeHistory: (origin: string, destination: string, cabin: string) =>
    ['history', 'route', origin, destination, cabin] as const,
};
```

`src/api/queries.ts` — find:

```ts
    await Promise.all(
      [['results'], ['execution'], ['coverage'], ['calendar-gap']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
```

`src/api/queries.ts` — replace with:

```ts
    await Promise.all(
      [
        ['results'],
        ['execution'],
        ['coverage'],
        ['calendar-gap'],
        ['calendar'],
        ['duration'],
        ['cell'],
        ['history'],
      ].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
```

`src/api/queries.ts` — find:

```ts
  };
}
```

`src/api/queries.ts` — replace with:

```ts
  };
}

// --- WP10 queries ---

/**
 * Refetch every POLL_MS while the newest run a response names is pending or running, the status bar's cadence, so
 * the heatmap and the duration chart fill in during a run (spec §10 "updates during run").
 */
export function whileRunning(
  data: { executions: ReadonlyArray<{ status: string }> } | undefined,
): number | false {
  const latest = data?.executions[0];
  return latest !== undefined && POLLING.has(latest.status) ? POLL_MS : false;
}

/** View B data (spec §10 calendar route), for one destination or all (plan decision 53: the api computes the filter). */
export function useCalendar(definitionId: string, destination: Iata | null) {
  return useQuery({
    queryKey: qk.calendar(definitionId, destination),
    queryFn: () => api.calendar(definitionId, destination),
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
    queryKey: qk.cell(definitionId, cell === null ? null : cellKeyString(cell)),
    // why: TanStack Query 5's skipToken idles the query without a sentinel key or a rejecting queryFn (arch2-013).
    queryFn: cell === null ? skipToken : () => api.cellDetail(definitionId, cell),
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
    queryKey: qk.itineraryHistory(hash),
    queryFn: hash === null ? skipToken : () => api.itineraryHistory(hash),
  });
}
```

`apps/web/src/copy.ts`: core's reason types for the panel's map, and the WP10 catalogue inside `COPY` before its closing `} as const;`. WP9 already holds `providerShort`, `truncatedNote`, `priceNotConfirmed`, `vendorAgeUnknown` and `spanExecutions`, which WP10 reuses.

`src/copy.ts` — find:

```ts
  type ConstraintName,
  type ExecutionStatus,
  formatAgo,
  type ProviderId,
  type SourceKind,
```

`src/copy.ts` — replace with:

```ts
  type ConstraintName,
  type ErrorReason,
  type ExecutionStatus,
  formatAgo,
  type MIXED_ERROR_REASON,
  type NoDataReason,
  type PARTIAL_EXPANSION,
  type PRICE_UNCONFIRMED,
  type ProviderId,
  type SkipReason,
  type SourceKind,
```

`src/copy.ts` — find:

```ts
type PlanId = z.output<typeof apiContract.providersResponseSchema>['providers'][number]['plan'];
/** The six coverage buckets; `reused` is a count beside them, not a bucket (spec §3). */
```

`src/copy.ts` — replace with:

```ts
type PlanId = z.output<typeof apiContract.providersResponseSchema>['providers'][number]['plan'];
/** Every outcome reason core can write (review arch2-005): a new or renamed one fails `satisfies` in the panel's map. */
type OutcomeReasonKey =
  | SkipReason
  | NoDataReason
  | ErrorReason
  | typeof MIXED_ERROR_REASON
  | typeof PARTIAL_EXPANSION
  | typeof PRICE_UNCONFIRMED;
/** The six coverage buckets; `reused` is a count beside them, not a bucket (spec §3). */
```

`src/copy.ts` — find:

```ts
  none: 'none',
} as const;
```

`src/copy.ts` — replace with:

```ts
  none: 'none',
  // --- WP10 (spec §11 View B, View C, History; plan decisions 38, 44, 46, 48) ---
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
    providerNotSearched: (source: string) => `${source}: not searched yet for this day`,
    markerSource: (source: string, marker: string) => `${source}: ${marker}`,
    partlyVerified: (count: number) =>
      `${count} partially verified ${count === 1 ? 'itinerary' : 'itineraries'} found for this day (never the day price)`,
    glyphSymbol: { empty: '∅', no_data: '?', error: '!', skipped: '–', not_run: '○' },
    calendarPrice: 'calendar price',
    bandAria: (band: number) => `price band ${band + 1} of 5${band === 0 ? ', cheapest' : ''}`,
    flatAria: 'one shade: the scale is flat',
    hatchedAria: 'not on the colour scale',
    stay: (nights: number, back: string) => `${nights}n · back ${back}`,
    cachedFrom: 'cached from',
    glyphCount: (n: number, words: string) => `${n} ${words}`,
    phoneMark: { partial: '◐', unconfirmed: '!' },
    phonePartial: 'part of the day not searched',
    searchedFraction: (searched: number, total: number) => `${searched}/${total} searched`,
    destinationFilter: 'Destination',
    allDestinations: 'All destinations',
    colourBy: 'Colour by',
    empty: 'No days to show yet. The calendar fills in as cells are searched.',
    staleLine: (stale: number, shown: number, verifiedAfter: string) =>
      `${stale} of ${shown} shown prices are stale by fetch age plus any known vendor age (itinerary prices after ${verifiedAfter}, calendar prices after their provider's refresh interval)`,
    unconfirmedShort: 'price not confirmed',
    unconfirmedCells: (n: number) =>
      `price not confirmed: ${n} itinerary-searched ${n === 1 ? 'cell' : 'cells'} priced nothing the final step confirmed`,
    unconfirmedCellsFor: (n: number, destination: string) =>
      `price not confirmed: ${n} itinerary-searched ${destination} ${n === 1 ? 'cell' : 'cells'} priced nothing the final step confirmed`,
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
      more: 'What the marks mean',
      dashed: 'dashed outline: a calendar price; constraints not checked',
      stale:
        'stale: older than one refresh cycle by fetch age plus any known vendor age; shown and labelled, never hidden. A price whose vendor age is unknown says "vendor\'s cache age unknown" instead',
      coverageFull:
        'S/M searched with a solid square: every cell of the day searched (priced, no fares or no cached data) by its best-covered source',
      coveragePartial:
        'S/M searched with a striped square: part of the day not searched; per-source counts are in the panel',
      cachedFrom:
        'cached from £X: a cheaper calendar price exists for this day, with its destination and stay; constraints not checked',
      unconfirmed:
        'price not confirmed: an itinerary search priced this day, but the final step confirmed none of its prices',
      truncated: 'cheapest of the rows read: the provider returned more rows than were read for that month',
      stay: 'Nn · back <date>: the stay of the cheapest cell; the panel lists every cell of the day',
      bandNumber: 'the small number beside the day is its price band, 1 cheapest to 5 dearest',
      phone:
        'On a narrow screen a day shows its number, band, amount and one-glyph marks: ! price not confirmed, ◷ stale, ? vendor cache age unknown, … cheapest of the rows read, ◐ part of the day not searched. Open a day for the rest.',
      glyphs: 'Days without a price show, with how many cells of the best-covered source:',
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
        'no-priced-options': 'the provider answered with no priced options',
        mixed: 'several different errors',
        'partial-expansion': 'some outbound flights could not be expanded',
        'price-unconfirmed': 'price not confirmed by the final step',
      } satisfies Record<OutcomeReasonKey, string>,
      offersDropped: (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'} could not be read and were dropped`,
      reasonRaw: (reason: string) => `other: ${reason}`,
      dash: '—',
      reusedFrom: (run: string) => `reused from ${run}`,
      prices: 'Prices for this cell',
      noPrices: 'No prices stored for this cell.',
      calendarPriceRun: (run: string) => `calendar price · ${run}`,
      observation: (seller: string, cls: string) => `itinerary offer · ${seller} · ${cls}`,
      showInResults: 'show in results',
      verifyCost: (maxCalls: number, headroom: number) =>
        `hard stop ${maxCalls} ${maxCalls === 1 ? 'call' : 'calls'} · ${headroom} ${headroom === 1 ? 'call' : 'calls'} of budget headroom left`,
      verifyNoHeadroom: 'No budget headroom left for this search.',
      verifyCostLoading: 'Loading what this search may spend…',
      verifyCapRefused: (message: string) => `Refused by a budget cap: ${message}`,
      verifyConflict: 'An itinerary search for this cell is already running.',
    },
  },
  durationView: {
    title: 'Duration',
    chartTitle: 'Cheapest found by stay length',
    chartNote:
      'n = priced cells behind each minimum; the legend gives n summed over all stay lengths. A star on the axis (13*) = no source searched that stay length. A missing bar elsewhere means that series found no class-verified or calendar price; the table names each gap. Calendar bars are paler with a dashed outline (constraints not checked); a faded bar with a black outline is stale.',
    xAxis: 'nights',
    yAxis: 'price (GBP)',
    tickNotSearched: (nights: number) => `${nights}*`,
    verifiedSeries: (n: number) => `min among verified (class verified, n=${n})`,
    verifiedShort: 'min among verified',
    calendarSeries: (source: string, n: number) => `calendar, ${source} (constraints not checked, n=${n})`,
    calendarShort: (source: string) => `calendar, ${source}`,
    nightsLabel: (n: number) => `${n} nights`,
    nightsLink: (n: number) => `${n} nights: show in results`,
    tooltipDetail: (n: number, departs: string) => `n=${n} · departs ${departs}`,
    seriesLine: (series: string, value: string) => `${series}: ${value}`,
    cellDetail: (n: number, departs: string) => `n=${n} · departs ${departs}`,
    notSearched: 'not searched',
    searchedNoPrice: 'searched, no price',
    partlySearchedNoPrice: (k: number, total: number) => `searched ${k} of ${total} cells, no price`,
    notItinerarySearched: 'not itinerary-searched',
    itinerarySearchedNoPrice: 'itinerary-searched, no class-verified price',
    partlyItinerarySearchedNoPrice: (k: number, total: number) =>
      `itinerary-searched ${k} of ${total} selected cells, no class-verified price`,
    tableCaption: 'Cheapest found per stay length, with provenance',
    staleLine: (stale: number, shown: number) =>
      `${stale} of ${shown} shown prices are stale (older than one refresh cycle by fetch age)`,
    empty:
      "No prices yet for any stay length in this definition's range. Run a search; Coverage shows what has been searched.",
  },
  historyView: {
    title: 'History',
    fetchChartTitle: 'Price by fetch date',
    connectorNote:
      'Each point is one run. A line joins two points only when they come from consecutive runs of this definition; a run that did not fetch the series breaks the line. No price was fetched between two points.',
    coloursRepeat: (lines: number, colours: number) =>
      `${lines} series share ${colours} colours: tell them apart by the legend name and line style`,
    xAxisFetched: 'fetched (Europe/London)',
    yAxis: 'price (GBP)',
    routeChartTitle: 'Route-level series (indicative): price by travel date',
    routeChartNote:
      'Reported by the vendor, not searched cell by cell; the vendor does not state its route scope or which date pairs it covers. Indicative: not an offer, no seller, constraints not checked.',
    xAxisTravelDate: 'travel date',
    routeSeries: (provider: string, cabin: string) => `${provider} route-level series, indicative · ${cabin}`,
    calendarSeries: (source: string, cabin: string) =>
      `${source} · ${cabin} · cheapest calendar price across this pair's cells, per run (constraints not checked)`,
    offerSeries: (source: string, seller: string) => `${source} · itinerary offer · ${seller}`,
    offerUnconfirmedSeries: (source: string, seller: string) =>
      `${source} · itinerary offer · ${seller} · price not confirmed by the final step`,
    pairPrefix: (pair: string, name: string) => `${pair} · ${name}`,
    cheapestCell: (origin: string, destination: string, dep: string, ret: string) =>
      `cheapest searched cell ${origin}→${destination} ${dep}–${ret}`,
    cellChanged: 'a different cell from the previous point',
    routePicker: 'Route',
    pairOption: (origin: string, destination: string) => `${origin}→${destination}`,
    allPairs: (shown: number, total: number) =>
      shown === total ? 'All pairs' : `All pairs (first ${shown} of ${total})`,
    itineraryHeading: (route: string, departs: string, back: string, carriers: string) =>
      `${route} · ${departs} to ${back} · ${carriers}`,
    itineraryHash: (hash: string) => `itinerary ${hash}`,
    backToRoute: 'Show route history',
    spanLine: (points: number, from: string, to: string) =>
      `${points} ${points === 1 ? 'run' : 'runs'} shown, ${from} to ${to}`,
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
} as const;
```

`apps/web/test/copy/catalogue.test.ts`: SAMPLES for every new function (and WP9's run-time samples in Europe/London), and the "verified" allowlist gains ten paths, each naming the class ("class-verified", "partially verified") or sitting beside a class-verified value.

`test/copy/catalogue.test.ts` — find:

```ts
  excludedByCurrentSpace: [3],
  executionsShown: ['run started 14 Oct 2026 12:00 UTC (completed, 2h ago)'],
  executionItem: ['14 Oct 2026 12:00 UTC', 'completed', '2h ago'],
  childExecutionItem: ['14 Oct 2026 12:00 UTC', 'running', 'just now'],
  spanExecutions: [3],
```

`test/copy/catalogue.test.ts` — replace with:

```ts
  excludedByCurrentSpace: [3],
  executionsShown: ['run started 14 Oct 2026 13:00 Europe/London (completed, 2h ago)'],
  executionItem: ['14 Oct 2026 13:00 Europe/London', 'completed', '2h ago'],
  childExecutionItem: ['14 Oct 2026 13:00 Europe/London', 'running', 'just now'],
  spanExecutions: [3],
```

`test/copy/catalogue.test.ts` — find:

```ts
  paused: ['budget'],
  resumesAt: ['1 Nov 2026 00:00 UTC'],
  scheduleBlocked: ['14 Oct 2026'],
```

`test/copy/catalogue.test.ts` — replace with:

```ts
  paused: ['budget'],
  resumesAt: ['1 Nov 2026 00:00 Europe/London'],
  scheduleBlocked: ['14 Oct 2026'],
```

`test/copy/catalogue.test.ts` — find:

```ts
  confirmNew: [154, 2000, '£2'],
};
```

`test/copy/catalogue.test.ts` — replace with:

```ts
  confirmNew: [154, 2000, '£2'],
  // WP10 (Task 10.3)
  'calendarView.discoveryMarker': [{ priced: 1, empty: 2, no_data: 3, error: 4, skipped: 5, not_run: 6 }, 21],
  'calendarView.verificationMarker': [1, 10, 2],
  'calendarView.markerSource': [
    'Aviasales cache',
    '1 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 1',
  ],
  'calendarView.partlyVerified': [2],
  'calendarView.bandAria': [0],
  'calendarView.providerNotSearched': ['Google date grid via SearchApi'],
  'calendarView.glyphCount': [47, 'not searched'],
  'calendarView.unconfirmedCellsFor': [1, 'JFK'],
  'calendarView.stay': [14, '28 Mar'],
  'calendarView.searchedFraction': [12, 48],
  'calendarView.staleLine': [3, 40, '8d'],
  'calendarView.unconfirmedCells': [2],
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
  'calendarView.panel.verifyCost': [6, 1840],
  'calendarView.panel.verifyCapRefused': ['budget cap: provider-month:searchapi 10000 of 10000 calls'],
  'durationView.tickNotSearched': [13],
  'durationView.verifiedSeries': [3],
  'durationView.calendarSeries': ['Aviasales cache', 9],
  'durationView.calendarShort': ['Aviasales cache'],
  'durationView.nightsLabel': [14],
  'durationView.nightsLink': [14],
  'durationView.tooltipDetail': [5, 'Sun 14 Mar'],
  'durationView.seriesLine': ['calendar, Aviasales cache', 'not searched'],
  'durationView.partlySearchedNoPrice': [3, 48],
  'durationView.partlyItinerarySearchedNoPrice': [1, 4],
  'durationView.cellDetail': [5, 'Sun 14 Mar'],
  'durationView.staleLine': [1, 4],
  'historyView.calendarSeries': ['Aviasales cache', 'economy'],
  'historyView.routeSeries': ['SearchApi', 'cabin not stated'],
  'historyView.coloursRepeat': [8, 6],
  'historyView.offerSeries': ['Google Flights via SearchApi', 'Example Air'],
  'historyView.offerUnconfirmedSeries': ['Google Flights via SearchApi', 'Example Air'],
  'historyView.pairPrefix': ['LHR-JFK', 'SearchApi route-level series, indicative · economy'],
  'historyView.cheapestCell': ['LHR', 'JFK', 'Sun 14 Mar', 'Sun 28 Mar'],
  'historyView.pairOption': ['LHR', 'JFK'],
  'historyView.allPairs': [4, 4],
  'historyView.itineraryHeading': ['LHR→JFK', 'Sun 14 Mar 2027', 'Sun 28 Mar 2027', 'BA'],
  'historyView.itineraryHash': ['abc123'],
  'historyView.spanLine': [3, '23 Sep 2026', '14 Oct 2026'],
  'historyView.tableCaption': ['SearchApi route-level series, indicative · economy'],
  'historyView.routeProvenance': [
    'Google Flights via SearchApi',
    'cabin not stated',
    'fetched 2h ago · provider age unknown',
  ],
};
```

`test/copy/catalogue.test.ts` — find:

```ts
      'headlineRest',
    ]);
```

`test/copy/catalogue.test.ts` — replace with:

```ts
      'headlineRest',
      // WP10: each names the class or sits beside a class-verified value (spec §11 View B, View C wording)
      'calendarView.partlyVerified',
      'calendarView.legend.hatched',
      'calendarView.panel.dayVerified',
      'calendarView.panel.dayPartlyVerified',
      'calendarView.panel.observation',
      'durationView.verifiedSeries',
      'durationView.verifiedShort',
      'durationView.chartNote',
      'durationView.itinerarySearchedNoPrice',
      'durationView.partlyItinerarySearchedNoPrice',
    ]);
```

`apps/web/test/msw/handlers.ts`: WP9's rendered sweep and shell tests then meet real WP10 content, and WP9's catch-all never sees a WP10 request.

`test/msw/handlers.ts` — find:

```ts
} from '../fixtures.js';
```

`test/msw/handlers.ts` — replace with:

```ts
} from '../fixtures.js';
import { wp10Handlers } from './wp10Handlers.js';
```

`test/msw/handlers.ts` — find:

```ts
export const handlers = [
  http.get(url('/api/providers'), () => HttpResponse.json(providersResponse())),
```

`test/msw/handlers.ts` — replace with:

```ts
export const handlers = [
  ...wp10Handlers,
  http.get(url('/api/providers'), () => HttpResponse.json(providersResponse())),
```

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
import type { Cell, Iata, IsoDate, ProviderId } from '@gmt/core';
import type { CalendarDay, PriceCellData } from '../../api/types.js';

/**
 * A price shown on a day, with the cell it came from (plan decisions 38, 52) and its decision-54 mark: a verified-basis
 * minimum carries `notSeenInLatest`, a calendar-basis one `superseded`.
 */
export type DayPrice = PriceCellData & {
  cell: Cell;
  notSeenInLatest?: { ageHours: number | 'unknown' } | null;
  superseded?: boolean;
};

/** What one day renders, for all destinations or for one (spec §11 View B, per-destination filter). */
export interface DaySlice {
  /** Discovery counts per provider, for the filtered destination when one is set (the api computes it, decision 53). */
  discovery: CalendarDay['discovery'];
  /**
   * The definition's discovery providers. Empty when it names none (spec §3, `not_applicable`); a configured provider
   * with no entry for the day is "not searched yet" for it (review prov-r2-009).
   */
  discoveryProviders: readonly ProviderId[];
  /** Null when the definition has no verification provider (spec §6.6 row 0: not applicable). */
  verification: CalendarDay['verification'] | null;
  /** Cells whose itinerary search priced but confirmed no price, under the destination filter (decisions 51, 53). */
  unconfirmedCells: number;
  cheapestVerified: DayPrice | null;
  cheapestPartiallyVerified: (DayPrice & { count: number }) | null;
  cheapestCalendar: DayPrice | null;
  /** The destination filter the day was fetched for, or null for all destinations; it only names the filter in words. */
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
import type { Buckets, Iata, ProviderId } from '@gmt/core';
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
  | { kind: 'none' };

/** The provider that searched most cells of the day (the first on a tie), or null when none has rows. */
export function bestCovered(discovery: readonly DiscoveryEntry[]): DiscoveryEntry | null {
  let best: DiscoveryEntry | null = null;
  for (const d of discovery)
    if (best === null || searchedCount(d.buckets) > searchedCount(best.buckets)) best = d;
  return best;
}

/**
 * The coverage cue of a slice, for the destination it was asked for (plan decision 53). With several discovery
 * providers the cue names the one that searched most cells, a lower bound on the cells any source searched; the panel
 * lists every provider.
 */
export function coverageOf(slice: DaySlice): Coverage {
  const best = bestCovered(slice.discovery);
  if (best === null) return { kind: 'none' };
  if (!slice.discovery.every(countsConsistent)) return { kind: 'inconsistent' };
  return {
    kind: 'fraction',
    searched: searchedCount(best.buckets),
    total: best.total,
    providerId: best.providerId,
  };
}

/** The configured discovery providers that have no counts for the day: not searched yet by them (prov-r2-009). */
export function providersNotSearched(slice: DaySlice): ProviderId[] {
  return slice.discoveryProviders.filter((p) => !slice.discovery.some((d) => d.providerId === p));
}

/** Options that come from the definition, not from the day. */
export interface SliceOptions {
  verificationConfigured: boolean;
  /** The definition's discovery providers, in its order. */
  discoveryProviders: readonly ProviderId[];
}

/**
 * The slice a day renders. With a destination filter the api already computed every count, minimum and
 * `unconfirmedCells` for that destination (plan decision 53), so the day is taken as it came; `destination` only names
 * the filter in the panel's words.
 */
export function sliceOf(day: CalendarDay, o: SliceOptions, destination: Iata | null): DaySlice {
  const verification = o.verificationConfigured ? day.verification : null;
  return {
    discovery: day.discovery,
    discoveryProviders: o.discoveryProviders,
    verification,
    unconfirmedCells: verification?.unconfirmedCells ?? 0,
    cheapestVerified: day.cheapestVerified,
    cheapestPartiallyVerified: day.cheapestPartiallyVerified,
    cheapestCalendar: day.cheapestCalendar,
    destination,
  };
}
```

`apps/web/src/views/Calendar/DayMarker.tsx`:

```tsx
import { useProviders } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { discoverySourceLabel } from '../../lib/sources.js';
import { formatDiscoveryMarker, formatVerificationMarker, providersNotSearched } from './marker.js';
import type { DaySlice } from './types.js';

/**
 * The full six-bucket day marker (spec §11 View B, §3): one line per discovery provider named by its source, a
 * "not searched yet" line for each configured provider with no counts for the day (prov-r2-009), then the
 * itinerary-search line. Shown in the side panel; the day cell carries only the coverage cue (plan decision 38).
 */
export function DayMarker({ slice }: { slice: DaySlice }) {
  const providers = useProviders();
  const C = COPY.calendarView;
  const missing = providersNotSearched(slice);
  return (
    <div className="text-xs text-slate-800" data-testid="day-marker">
      {slice.discoveryProviders.length === 0 ? (
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
          {missing.map((p) => (
            <li key={p}>{C.providerNotSearched(discoverySourceLabel(p, providers.data))}</li>
          ))}
        </ul>
      )}
      <p>{formatVerificationMarker(slice.verification)}</p>
      {slice.unconfirmedCells > 0 ? (
        <p className="font-semibold">
          {slice.destination === null
            ? C.unconfirmedCells(slice.unconfirmedCells)
            : C.unconfirmedCellsFor(slice.unconfirmedCells, slice.destination)}
        </p>
      ) : null}
      {slice.cheapestPartiallyVerified !== null ? (
        <p>{C.partlyVerified(slice.cheapestPartiallyVerified.count)}</p>
      ) : null}
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
Expected: PASS. Sources 5 tests, marker 11; in `test/copy` the catalogue (every new function sampled, no banned word, "verified" only on allowed paths), the source guard and the rendered sweep pass (the WP10 routes still render WP9's placeholder until Task 10.12).

Run: `pnpm --filter @gmt/web typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: WP10 endpoints with the calendar filter, polling queries, typed reason copy, test builders, six-bucket marker"
```

### Task 10.4: Day display: precedence, glyphs, default basis

**Files:**
- Create: `apps/web/src/views/Calendar/display.ts`, `apps/web/test/views/calendar/display.test.ts`

**Interfaces:**
- Consumes: `effectiveAge`, `compareAges`; `DaySlice`, `DayPrice`, `GlyphStatus`, `DayBasis`, `GridDay`.
- Produces: `GlyphReason`, `Glyph`, `DayDisplay`, `resolveDayDisplay`, `defaultColourBasis`.

The precedence is spec §11's. With SearchApi's itinerary age `'unknown'` (spec rev 15), a stale verified price always loses to a known-age calendar price, and two unknown ages tie to verified; one test keeps a known-age itinerary provenance only to pin the equal-age tie. A priceless day says why: glyphs with their cell counts (now including `skipped`), taken from the source that searched most of the day, the same source the coverage cue names, so "1 no fares, 47 not searched" never reads like "47 no fares, 1 not searched" and two providers' states are never mixed (review ui-r2-003); "not searched yet" when discovery is configured but no run has rows for the day (WP8 sends `discovery: []` before the first run and for days a relative window adds); "no discovery provider configured" only from the definition. A filtered day needs no special case: the api counted its destination's cells (decision 53).

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
  it('one counted glyph per non-zero unpriced status of the best-covered source, in a fixed order, skipped included', () => {
    const s = slice({
      discovery: [
        disc('travelpayouts', { no_data: 3, not_run: 2, skipped: 1, error: 1 }),
        disc('searchapi', { error: 1, empty: 1 }),
      ],
    });
    // why: ui-r2-003 — one source's counts, never a union of two providers' states.
    expect(resolveDayDisplay(s, NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [
        { status: 'no_data', count: 3 },
        { status: 'error', count: 1 },
        { status: 'skipped', count: 1 },
        { status: 'not_run', count: 2 },
      ],
      reason: 'counts',
    });
  });
  it('"1 no fares, 47 not searched" and "47 no fares, 1 not searched" are different days (ui-r2-003)', () => {
    const a = resolveDayDisplay(
      slice({ discovery: [disc('travelpayouts', { empty: 1, not_run: 47 })] }),
      NOW,
    );
    const b = resolveDayDisplay(
      slice({ discovery: [disc('travelpayouts', { empty: 47, not_run: 1 })] }),
      NOW,
    );
    expect(a).not.toEqual(b);
    expect(a).toEqual({
      kind: 'glyphs',
      glyphs: [
        { status: 'empty', count: 1 },
        { status: 'not_run', count: 47 },
      ],
      reason: 'counts',
    });
  });
  it('a day whose cells are all skipped shows the skipped glyph, never a blank', () => {
    expect(resolveDayDisplay(slice({ discovery: [disc('travelpayouts', { skipped: 12 })] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [{ status: 'skipped', count: 12 }],
      reason: 'counts',
    });
  });
  it('a configured definition whose day no run has reached is not searched, not "no provider" (po-wp10-001)', () => {
    expect(resolveDayDisplay(slice({ discovery: [] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [{ status: 'not_run', count: null }],
      reason: 'no-run',
    });
    expect(resolveDayDisplay(slice({ discovery: [], discoveryProviders: [] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [],
      reason: 'no-provider',
    });
  });
  it('a filtered day is counted by the api for its destination, so its glyphs are its own (decision 53)', () => {
    const s = slice({
      destination: asIata('JFK'),
      discovery: [disc('travelpayouts', { empty: 2, not_run: 22 })],
    });
    expect(resolveDayDisplay(s, NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [
        { status: 'empty', count: 2 },
        { status: 'not_run', count: 22 },
      ],
      reason: 'counts',
    });
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
import { bestCovered } from './marker.js';
import type { DayBasis, DayPrice, DaySlice, GlyphStatus, GridDay } from './types.js';

/** Why a priceless day shows what it shows. */
export type GlyphReason =
  /** one glyph per non-zero unpriced bucket */
  | 'counts'
  /** discovery is configured but no run has outcome rows for this day yet: not searched */
  | 'no-run'
  /** the definition has no discovery provider */
  | 'no-provider';

/** One glyph of a priceless day and its cell count (null when no run has counted the day: review ui-r2-003). */
export interface Glyph {
  status: GlyphStatus;
  count: number | null;
}

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
  | { kind: 'glyphs'; glyphs: Glyph[]; reason: GlyphReason };

const GLYPH_ORDER: readonly GlyphStatus[] = ['empty', 'no_data', 'error', 'skipped', 'not_run'];

function priceless(slice: DaySlice): DayDisplay {
  if (slice.discoveryProviders.length === 0) return { kind: 'glyphs', glyphs: [], reason: 'no-provider' };
  // why: WP8 sends discovery [] for a day no run has reached (no parent yet, or a relative window that moved on): not searched.
  const best = bestCovered(slice.discovery);
  if (best === null)
    return { kind: 'glyphs', glyphs: [{ status: 'not_run', count: null }], reason: 'no-run' };
  // why: ui-r2-003 — counts from one source (the cue's best-covered one), so "1 no fares, 47 not searched" never
  // reads like "47 no fares, 1 not searched", and two providers' states are never mixed; the panel lists every source.
  const glyphs = GLYPH_ORDER.filter((s) => best.buckets[s] > 0).map((status) => ({
    status,
    count: best.buckets[status],
  }));
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
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: day precedence, counted glyphs, skipped and not-searched states, default colour basis (spec §11, §8.1)"
```

### Task 10.5: Scale, flat scale and the calendar model

**Files:**
- Create: `apps/web/src/views/Calendar/{scale.ts,model.ts}`, `apps/web/test/views/calendar/scale.test.ts`

**Interfaces:**
- Produces: `Band`, `ScaleMode`, `LegendEntry`, `QuintileScale`, `MIN_BANDED_DAYS`, `BandColour`, `BAND_COLOURS`, `BAND_CLASSES`, `FLAT_CLASS`, `PRICELESS_CLASS`, `quintileBand`, `buildScale`, `CalendarModel`, `buildCalendarModel`.

The quintile function: sort the n prices of the colour basis ascending; a price v gets band `min(4, floor(r × 5 / n))`, r being the count of prices strictly below v. Plan decision 38: with fewer than ten days, or when the dearest is less than 10% above the cheapest (`(max − min) × 10 < min`, integer arithmetic), every day gets one flat shade and the legend says which reason applies. Five teal fills from `#134e4a` to `#ccfbf1` (review ui-r2-005): white text on the two darkest, black on the rest, every one at WCAG AA 4.5:1 or better, neighbours at a lightness ratio of 1.3 or more, the lightest bordered; the test computes both from `BAND_COLOURS`, whose hex values the Tailwind classes spell out. The band number is also printed on each banded day (Task 10.6), so no meaning rests on telling two shades apart. A priceless day is neutral grey with text, so "dearest" never reads as "not searched". The model also counts the shown and stale prices for the header line.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/scale.test.ts` (the invariant loop uses a seeded generator, so it is reproducible without a new dependency):

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildCalendarModel } from '../../../src/views/Calendar/model.js';
import {
  BAND_CLASSES,
  BAND_COLOURS,
  type Band,
  buildScale,
  FLAT_CLASS,
  quintileBand,
} from '../../../src/views/Calendar/scale.js';
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

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
/** WCAG 2 contrast ratio of two colours, lighter over darker. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('band colours (review ui-r2-005)', () => {
  const bands: Band[] = [0, 1, 2, 3, 4];
  it('every band carries its text at WCAG AA 4.5:1 or better, and its class spells the same colours', () => {
    for (const b of bands) {
      const { fill, text } = BAND_COLOURS[b];
      expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5);
      expect(BAND_CLASSES[b]).toContain(`bg-[${fill}]`);
      expect(BAND_CLASSES[b]).toContain(text === '#ffffff' ? 'text-white' : 'text-black');
    }
  });
  it('neighbouring bands differ in lightness by a ratio of 1.3 or more, darkest to lightest', () => {
    for (const b of [0, 1, 2, 3] as const) {
      const next = BAND_COLOURS[quintileNext(b)].fill;
      expect(luminance(next)).toBeGreaterThan(luminance(BAND_COLOURS[b].fill));
      expect(contrast(BAND_COLOURS[b].fill, next)).toBeGreaterThanOrEqual(1.3);
    }
  });
  it('the lightest band is bordered and the flat shade is a band colour, so neither reads as priceless', () => {
    expect(BAND_CLASSES[4]).toContain('border');
    expect(FLAT_CLASS).toContain(`bg-[${BAND_COLOURS[3].fill}]`);
  });
});

function quintileNext(b: 0 | 1 | 2 | 3): Band {
  return b === 0 ? 1 : b === 1 ? 2 : b === 2 ? 3 : 4;
}
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

/** A band's fill and text colour, as hex so the contrast test can check them (review ui-r2-005). */
export interface BandColour {
  fill: string;
  text: string;
}

/**
 * Sequential single-hue fills (dataviz skill), every one with text at WCAG AA 4.5:1 or better and neighbours spread
 * far enough in lightness to tell apart (scale.test.ts checks both). The lightest band stays tinted and bordered, so
 * "dearest" never reads as a priceless day (slate-100 with text); the band number is printed on the face as well.
 */
export const BAND_COLOURS: Readonly<Record<Band, BandColour>> = {
  0: { fill: '#134e4a', text: '#ffffff' },
  1: { fill: '#0f766e', text: '#ffffff' },
  2: { fill: '#14b8a6', text: '#000000' },
  3: { fill: '#5eead4', text: '#000000' },
  4: { fill: '#ccfbf1', text: '#000000' },
};
// why: Tailwind generates only class names it finds written out, so each arbitrary value is spelled in full here.
export const BAND_CLASSES: Readonly<Record<Band, string>> = {
  0: 'bg-[#134e4a] text-white',
  1: 'bg-[#0f766e] text-white',
  2: 'bg-[#14b8a6] text-black',
  3: 'bg-[#5eead4] text-black',
  4: 'border border-[#0f766e] bg-[#ccfbf1] text-black',
};
/** The one shade of a flat scale. */
export const FLAT_CLASS = 'bg-[#5eead4] text-black';
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
Expected: PASS: marker 11, display 16, scale 12.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: quintile and flat scales per basis with contrast-checked bands, calendar model"
```

### Task 10.6: Calendar grid, phone face, coverage cue, legend and keyboard

**Files:**
- Create: `apps/web/src/views/Calendar/{CoverageCue.tsx,CalendarGrid.tsx,CalendarLegend.tsx,calendar.css}`, `apps/web/src/lib/marks.ts`, `apps/web/test/views/calendar/grid.test.tsx`, `apps/web/test/components/priceCellFace.test.tsx`, `apps/web/test/lib/marks.test.ts`
- Modify (WP9): `apps/web/src/components/PriceCell.tsx` (the `face` and `superseded` props), `apps/web/src/copy.ts` (`priceMarkGlyph`, `superseded`), `apps/web/test/copy/sourceGuard.test.ts` (money files and non-copy props)

**Interfaces:**
- Consumes: `CalendarModel`, `GridDay`, `coverageOf`, `BAND_CLASSES`, `FLAT_CLASS`, `PRICELESS_CLASS`, `MIN_BANDED_DAYS`; WP9's `PriceCell` (`compact`), `PriceBoundary`, `COPY`; the `format.ts` forms (`WEEK_HEADERS`, `formatIsoMonth`, `formatIsoDateLong`, …); `addDays`, `monthOf`.
- Produces: `PriceCellProps.face`, `COPY.priceMarkGlyph`, `FigureMarks`, `figureMarks`, `FOCUS_RING`, `targetOf`, `CalendarGrid({ days, model, months, destinationNotes, compact, onOpen })`, `CoverageCue({ coverage })`, `CalendarLegend({ model })`.

Each drawn month is a native table (its caption is its accessible name) with Monday-first column headers; each data day is a `<button>` with a roving `tabIndex` (§6: an ARIA `grid` cannot be written without a lint suppression). Arrows move by a day or a week across drawn months, Home and End to Monday and Sunday, PageUp and PageDown to the same day of the month before or after; focus moves only to a drawn day with data; Enter and Space are the button's own activation. A desktop day shows its number and band number, WP9's PriceCell `compact` form, the stay ("14n · back 28 Mar"), "cached from" with the cheaper calendar price's own compact PriceCell carrying its destination and note, and its stay below it (decision 52: with all destinations shown the cheaper fare can be EWR for 12 nights beside a JFK day price for 14), "price not confirmed" when its itinerary search confirmed no price (decision 48; under a filter the api's count is that destination's, decision 53), and the coverage cue. A priceless day shows its counted glyphs and the same coverage cue (review ui-r2-003). Every meaning has text or a pattern: band number on the face and in screen-reader text, "not on the colour scale", hatching, swatches and glyphs with words.

At phone width (`compact`, review ui-r2-001) a column is about 45 px, which the desktop body cannot fit, so a day shows its number and band, the amount through PriceCell's new `face` form and one-glyph marks: "!" for "price not confirmed" and "◐" for part of the day not searched, each with its words in screen-reader text. `face` is a prop on WP9's PriceCell, not a second price component (decision 46): the amount with "≈", every mark as one glyph from `COPY.priceMarkGlyph` ("!" unconfirmed, "◷" stale, "?" vendor's cache age unknown, "…" cheapest of the rows read), and the marks' words, provider, source, age, destination and note in its title and its spoken text. Stay, provider badge, "cached from" and the counts are in the panel, one tap away; the Playwright phone project checks that no day's content overflows its button (Task 10.13).

Decision 54's marks: a verified-basis minimum the latest search no longer returned carries `notSeenInLatest`, which PriceCell already shows as WP9's "not seen in latest search (…)" note; a calendar-basis price whose cell a newer parent run found empty or no fares carries `superseded`, which WP9's `superseded` prop shows as the words "superseded by a later search" (on the face, "◌" and "↺"). `lib/marks.ts`'s `figureMarks` reads both from any figure, so every view spreads the same two props into PriceCell; the day price and the "cached from" fare each carry their own.

The legend sits above the grid; its band ranges are scale values, so it carries `data-scale`, the one place WP9's rendered sweep accepts "£" outside a PriceCell besides an indicative row (decision 52, Task 10.12). The scale line, the swatches and the glyph row stay open; the explanations of the marks fold into "What the marks mean" (review ui-r2-006).

WP9's source guard allows money formatting only in named files; the legend (band ranges) and History's `RouteTable.tsx` (the indicative route-level series, Task 10.11) join the list. The chart files do not: their fares go through PriceCell and their price ticks through `formatAxisPounds`, which prints no "£". Recharts' identifier props (`dataKey`, `scale`, `verticalAlign`) and `data-*` attributes join its non-copy props.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/grid.test.tsx`:

```tsx
import { asIata, asIsoDate, asIsoMonth, type Buckets, monthOf } from '@gmt/core';
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
  provSyntheticAt,
  slice,
} from '../../fixtures.wp10.js';
import { expectConsoleErrors } from '../../guards.js';
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
  compact = false,
) {
  const onOpen = vi.fn();
  const model = buildCalendarModel(days, basis, NOW);
  const months = [...new Set(days.map((d) => monthOf(d.date)))];
  const r = renderWithProviders(
    <>
      <CalendarLegend model={model} />
      <CalendarGrid
        days={days}
        model={model}
        months={months}
        destinationNotes={notes}
        compact={compact}
        onOpen={onOpen}
      />
    </>,
  );
  return { onOpen, ...r };
}
/** A day's button: the grid is a table of days, each a button with a roving tabIndex. */
function dayCell(date: string): HTMLButtonElement {
  const el = document.querySelector(`button[data-date="${date}"]`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no day ${date}`);
  return el;
}
/** The weekday column of a day (Monday = 0). */
function column(date: string): number {
  const td = dayCell(date).closest('td');
  if (td === null) throw new Error(`day ${date} is outside a table cell`);
  return td.cellIndex;
}
/** The compact PriceCell of a day, or of an element inside one. */
function priceCellIn(el: HTMLElement): HTMLElement {
  return within(el).getByTestId('price-cell');
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
        compact={false}
        onOpen={vi.fn()}
      />,
    );
    expect(column('2027-03-14')).toBe(6); // Sunday
    expect(getByRole('table', { name: 'Mar 2027' })).toContainElement(dayCell('2027-03-14'));
    expect(getByRole('columnheader', { name: 'Mon' })).toBeInTheDocument();
    expect(queryByRole('table', { name: 'Apr 2027' })).toBeNull();
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
    // why: ui-r2-005 — the band number is printed on the face, so neighbouring shades never rest on colour alone.
    expect(dayCell('2027-03-10').querySelector('[data-band-number]')).toHaveTextContent('5');
    expect(dayCell('2027-03-13').querySelector('[data-band-number]')).toBeNull();
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
    const { getByTestId } = renderGrid([gDay('2027-03-08', { not_run: 1 })], 'calendar');
    const legend = getByTestId('calendar-legend');
    for (const text of [
      'dashed outline: a calendar price; constraints not checked',
      'stale: older than one refresh cycle by fetch age plus any known vendor age',
      'price not confirmed: an itinerary search priced this day',
      'S/M searched with a striped square',
      'cached from £X',
      'cheapest of the rows read',
      'Nn · back <date>',
      '– skipped (a budget stop, a disabled provider or a passed date; reasons in the panel)',
      '○ not searched',
      'its price band, 1 cheapest to 5 dearest',
      '◐ part of the day not searched',
    ])
      expect(legend).toHaveTextContent(text);
    // why: ui-r2-006 — the long explanations fold away; the scale and the glyphs stay open.
    const more = within(legend).getByText('What the marks mean').closest('details');
    expect(more).not.toHaveAttribute('open');
    expect(more).toHaveTextContent('dashed outline');
    expect(more).not.toHaveTextContent('○ not searched');
  });

  it('a day shows price, compact badge, stay and coverage cue; details are in the title and the panel', () => {
    renderGrid([vDay('2027-03-08', 40000), cDay('2027-03-09', 30000, true)], 'verified', {
      JFK: 'onward leg not included',
    });
    const v = within(dayCell('2027-03-08'));
    // why: WP9's compact PriceCell (decision 46): amount, short badge, destination, marks; the rest in its title.
    const price = priceCellIn(dayCell('2027-03-08'));
    expect(price).not.toHaveClass('border-dashed');
    expect(price).toHaveTextContent('SA');
    expect(price).toHaveTextContent('JFK');
    expect(price).toHaveTextContent("vendor's cache age unknown"); // decision 44: labelled, not called stale
    expect(price.getAttribute('title')).toContain('Google Flights via SearchApi');
    expect(price.getAttribute('title')).toContain('onward leg not included');
    expect(v.queryByTestId('provenance')).toBeNull();
    expect(v.getByTestId('day-stay')).toHaveTextContent('14n · back 22 Mar');
    expect(v.getByTestId('coverage-cue')).toHaveTextContent('48/48 searched');
    expect(v.getByTestId('coverage-cue')).toHaveAttribute('data-coverage', 'full');
    const c = within(dayCell('2027-03-09'));
    expect(priceCellIn(dayCell('2027-03-09'))).toHaveClass('border-dashed');
    expect(priceCellIn(dayCell('2027-03-09')).getAttribute('title')).toContain('constraints not checked');
    expect(dayCell('2027-03-09')).toHaveTextContent('stale');
    expect(dayCell('2027-03-09')).toHaveTextContent('£300');
    expect(c.getByTestId('coverage-cue')).toHaveTextContent('24/48 searched');
    expect(c.getByTestId('coverage-cue')).toHaveAttribute('data-coverage', 'partial');
  });

  it('a verified day that hides a cheaper cached fare shows "cached from" with its own destination, note and stay', () => {
    const d = gridDay('2027-03-08', {
      cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-08', 14)),
      cheapestCalendar: priceAt(41000, provCalendarAt(2), false, cellAt('2027-03-08', 12, 'LHR', 'EWR')),
      discovery: [disc('travelpayouts', { priced: 48 })],
    });
    renderGrid([d], 'verified', { EWR: 'onward leg not included' });
    const cached = within(dayCell('2027-03-08')).getByTestId('cached-from');
    expect(cached).toHaveTextContent('cached from');
    expect(cached).toHaveTextContent('£410');
    expect(priceCellIn(cached)).toHaveClass('border-dashed');
    // why: decision 52, review prov-r2-002 — the cheaper fare is EWR for 12 nights, not the day price's JFK for 14.
    expect(priceCellIn(cached)).toHaveTextContent('EWR');
    expect(priceCellIn(cached).getAttribute('title')).toContain('onward leg not included');
    expect(cached).toHaveTextContent('12n · back 20 Mar');
    expect(within(dayCell('2027-03-08')).getAllByTestId('price-cell')[0]).toHaveTextContent('JFK');
  });

  it('a price from a page-capped tile says "cheapest of the rows read" (plan decisions 30, 36)', () => {
    renderGrid([cDay('2027-03-09', 30000, false, true)], 'calendar');
    expect(dayCell('2027-03-09')).toHaveTextContent('cheapest of the rows read');
  });

  it('a synthetic price carries the synthetic badge and source on the day (spec §5.5)', () => {
    renderGrid(
      [
        gridDay('2027-03-09', {
          cheapestCalendar: priceAt(30000, provSyntheticAt(1), false, cellAt('2027-03-09', 14)),
        }),
      ],
      'calendar',
    );
    const price = priceCellIn(dayCell('2027-03-09'));
    expect(price).toHaveTextContent('synthetic');
    expect(price.getAttribute('title')).toContain('synthetic fixture data');
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
    // why: PriceBoundary reports the withheld price through console.error, which WP9's harness fails on unless announced.
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
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
    }
  });

  it('a day whose itinerary search confirmed no price says "price not confirmed" (decision 48)', () => {
    renderGrid(
      [
        gridDay('2027-03-08', {
          cheapestCalendar: priceAt(41200, provCalendarAt(2), false, cellAt('2027-03-08', 14)),
          verification: { selected: 2, itinerarySearched: 2, onDemand: 0, unconfirmedCells: 1 },
          discovery: [disc('travelpayouts', { priced: 48 })],
        }),
        gridDay('2027-03-09', {
          verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
          discovery: [disc('travelpayouts', { no_data: 48 })],
        }),
        gridDay('2027-03-10', {
          cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-10', 14)),
          verification: { selected: 2, itinerarySearched: 2, onDemand: 0, unconfirmedCells: 1 },
          discovery: [disc('searchapi', { priced: 48 })],
        }),
      ],
      'calendar',
    );
    expect(within(dayCell('2027-03-08')).getByTestId('day-unconfirmed')).toHaveTextContent(
      'price not confirmed',
    );
    expect(within(dayCell('2027-03-09')).getByTestId('day-unconfirmed')).toHaveTextContent(
      'price not confirmed',
    );
    // why: a confirmed class-verified price is the day's itinerary-search price; other cells' unconfirmed prices are in the panel.
    expect(within(dayCell('2027-03-10')).queryByTestId('day-unconfirmed')).toBeNull();
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
      '∅ 1 no fares',
      '? 1 no cached data',
      '! 1 error',
      '– 1 skipped',
      '○ 1 not searched',
    ]);
    expect(dayCell('2027-03-09')).toHaveTextContent('– 48 skipped');
    expect(dayCell('2027-03-09')).toHaveClass('bg-slate-100');
  });

  it('a grey day carries the same "S/M searched" cue as a priced day, so its coverage is visible (ui-r2-003)', () => {
    renderGrid([
      gDay('2027-03-08', { empty: 1, not_run: 47 }),
      gDay('2027-03-09', { empty: 47, not_run: 1 }),
    ]);
    const a = within(dayCell('2027-03-08')).getByTestId('coverage-cue');
    expect(a).toHaveTextContent('1/48 searched');
    expect(a).toHaveAttribute('data-coverage', 'partial');
    expect(dayCell('2027-03-08')).toHaveTextContent('∅ 1 no fares');
    expect(dayCell('2027-03-08')).toHaveTextContent('○ 47 not searched');
    expect(within(dayCell('2027-03-09')).getByTestId('coverage-cue')).toHaveTextContent('47/48 searched');
  });

  it('under a destination filter "price not confirmed" follows the count the api returns for it (decision 53, prov-r2-004)', () => {
    const jfk = asIata('JFK');
    const base = { discovery: [disc('travelpayouts', { no_data: 48 })], destination: jfk };
    renderGrid([
      { date: asIsoDate('2027-03-08'), slice: slice({ ...base, unconfirmedCells: 0 }) },
      { date: asIsoDate('2027-03-09'), slice: slice({ ...base, unconfirmedCells: 1 }) },
    ]);
    expect(within(dayCell('2027-03-08')).queryByTestId('day-unconfirmed')).toBeNull();
    expect(within(dayCell('2027-03-09')).getByTestId('day-unconfirmed')).toHaveTextContent(
      'price not confirmed',
    );
  });

  it('a day no run reaches says not searched; a filtered day shows the counts the api computed for its destination', () => {
    const noRun = gridDay('2027-03-08');
    const filtered: GridDay = {
      date: noRun.date,
      slice: slice({
        destination: cellAt('2027-03-08', 1).destination,
        discovery: [disc('travelpayouts', { empty: 3, not_run: 21 })],
      }),
    };
    const first = renderGrid([noRun]);
    expect(dayCell('2027-03-08')).toHaveTextContent('○ not searched');
    expect(dayCell('2027-03-08')).toHaveTextContent('not searched yet: no run covers this day');
    first.unmount();
    renderGrid([filtered]);
    // why: decision 53, ui-r2-004 — the api counted JFK's 24 cells, so "not searched" and "no fares" stay distinct.
    expect(dayCell('2027-03-08')).toHaveTextContent('∅ 3 no fares');
    expect(dayCell('2027-03-08')).toHaveTextContent('○ 21 not searched');
    expect(within(dayCell('2027-03-08')).getByTestId('coverage-cue')).toHaveTextContent('3/24 searched');
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
    // why: the legend's "What the marks mean" fold is the first stop; the grid has one stop after it.
    await user.tab();
    await user.tab();
    expect(dayCell('2027-03-03')).toHaveFocus();
    expect(document.querySelectorAll('button[data-date][tabindex="0"]')).toHaveLength(1);
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

  it('decision 54: a verified day price the latest search no longer returned, and a superseded cached fare, say so', () => {
    const d = gridDay('2027-03-08', {
      cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-08', 14), false, {
        notSeenInLatest: { ageHours: 30 },
      }),
      cheapestCalendar: priceAt(41000, provCalendarAt(2), false, cellAt('2027-03-08', 12), false, {
        superseded: true,
      }),
      discovery: [disc('travelpayouts', { priced: 48 })],
    });
    renderGrid([d]);
    const cells = within(dayCell('2027-03-08')).getAllByTestId('price-cell');
    expect(cells[0]).toHaveTextContent('not seen in latest search (30h ago)');
    expect(cells[0]).not.toHaveTextContent('superseded');
    expect(cells[1]).toHaveTextContent('superseded by a later search');
    expect(cells[1]).not.toHaveTextContent('not seen in latest search');
  });

  it('at phone width a day shows its number, band, amount face and one-glyph marks; the rest is in the panel (ui-r2-001)', () => {
    const days = [
      ...tenVerified,
      gridDay('2027-03-20', {
        cheapestCalendar: priceAt(41000, provCalendarAt(2), true, cellAt('2027-03-20', 12), true),
        verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
        discovery: [disc('travelpayouts', { priced: 20, not_run: 28 })],
      }),
      gDay('2027-03-21', { empty: 2, not_run: 46 }),
    ];
    renderGrid(days, 'verified', { JFK: 'onward leg not included' }, true);
    const priced = dayCell('2027-03-20');
    const face = within(priced).getByTestId('day-price-face');
    const price = priceCellIn(priced);
    expect(price).toHaveAttribute('data-face');
    expect(price).toHaveClass('border-dashed');
    // why: one glyph per mark, the words spoken and in the title: stale, then cheapest of the rows read.
    expect(price.querySelector('[aria-hidden="true"]')).toHaveTextContent('◷…');
    expect(price.getAttribute('title')).toContain('stale');
    expect(price.getAttribute('title')).toContain('cheapest of the rows read');
    expect(price.getAttribute('title')).toContain('JFK');
    expect(price.getAttribute('title')).toContain('onward leg not included');
    expect(face).toHaveTextContent('£410');
    expect(face).toHaveTextContent('price not confirmed');
    expect(face).toHaveTextContent('part of the day not searched');
    // why: stay, cached-from, the badge and the counts are left to the panel at this width.
    expect(within(priced).queryByTestId('day-stay')).toBeNull();
    expect(within(priced).queryByTestId('coverage-cue')).toBeNull();
    expect(within(priced).queryByText('TP')).toBeNull();
    const grey = dayCell('2027-03-21');
    expect([...grey.querySelectorAll('[data-glyph]')].map((g) => g.textContent)).toEqual([
      '∅2 no fares',
      '○46 not searched',
    ]);
    expect(dayCell('2027-03-10').querySelector('[data-band-number]')).toHaveTextContent('5');
    expect(document.querySelector('table')).toHaveClass('border-spacing-0.5');
  });
});
```

`apps/web/test/components/priceCellFace.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../src/components/PriceCell.js';
import { fxConverted, provCalendar, provSearch } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

// WP10's `face` prop on WP9's PriceCell (plan decision 52, review ui-r2-001): the phone day cell's amount.
describe('PriceCell face (phone day cell)', () => {
  it('shows "≈" and one glyph per mark; every word is spoken and in the title, unconfirmed first', () => {
    const { getByTestId } = renderWithProviders(
      <PriceCell
        face
        pricePence={41200}
        provenance={{ ...provSearch, maxAgeHours: 'unknown', fx: fxConverted }}
        calendar={false}
        stale
        truncated
        unconfirmed
        superseded
        notSeenInLatestHours={30}
        destination="EWR"
        destinationNote="onward leg not included"
      />,
    );
    const cell = getByTestId('price-cell');
    expect(cell).toHaveAttribute('data-face');
    expect(cell).not.toHaveClass('border-dashed');
    const hidden = [...cell.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent);
    expect(hidden).toEqual(['≈', '!◷?…↺◌']);
    const title = cell.getAttribute('title') ?? '';
    expect(title.indexOf('price not confirmed by the final step')).toBe(0);
    for (const words of [
      'stale',
      "vendor's cache age unknown",
      'cheapest of the rows read',
      'superseded by a later search',
      'not seen in latest search (30h ago)',
      'EWR',
      'onward leg',
    ])
      expect(title).toContain(words);
    expect(cell).toHaveTextContent('£412');
    expect(cell).toHaveTextContent(/converted/);
  });

  it('a plain calendar price has the dashed outline, no marks, and no destination or note when none is given', () => {
    const { getByTestId } = renderWithProviders(
      <PriceCell face pricePence={30000} provenance={provCalendar} calendar stale={false} />,
    );
    const cell = getByTestId('price-cell');
    expect(cell).toHaveClass('border-dashed');
    expect(cell.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(cell.getAttribute('title')).not.toContain('onward');
    expect(cell.getAttribute('title')).toContain('constraints not checked');
  });

  it('the full form badges a superseded calendar price after "stale" (decision 54)', () => {
    const { getByTestId } = renderWithProviders(
      <PriceCell pricePence={30000} provenance={provCalendar} calendar stale superseded />,
    );
    const text = getByTestId('price-cell').textContent ?? '';
    expect(text).toContain('superseded by a later search');
    expect(text.indexOf('stale')).toBeLessThan(text.indexOf('superseded'));
  });
});
```

`apps/web/test/lib/marks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { figureMarks } from '../../src/lib/marks.js';

describe('figureMarks (decision 54)', () => {
  it('reads not-seen hours and superseded from a figure, and nothing from a figure without them', () => {
    expect(figureMarks({ notSeenInLatest: { ageHours: 30 } })).toEqual({
      notSeenInLatestHours: 30,
      superseded: false,
    });
    expect(figureMarks({ notSeenInLatest: { ageHours: 'unknown' } }).notSeenInLatestHours).toBe('unknown');
    expect(figureMarks({ notSeenInLatest: null, superseded: true })).toEqual({
      notSeenInLatestHours: null,
      superseded: true,
    });
    expect(figureMarks({})).toEqual({ notSeenInLatestHours: null, superseded: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/grid.test.tsx test/components/priceCellFace.test.tsx`
Expected: FAIL: the grid file with `Failed to resolve import "../../../src/views/Calendar/CalendarGrid.js"`, the marks file with `Failed to resolve import "../../src/lib/marks.js"`; the face tests with `expect(element).toHaveAttribute("data-face")` and `expect(element).toHaveClass("border-dashed")` (WP9's PriceCell ignores the prop and renders its full form).

- [ ] **Step 3: Implement**

`apps/web/src/components/PriceCell.tsx` (WP9's): the `face` prop and its early return, before the compact and full forms. WP9 already provides the `superseded` prop and its words (decision 57), so WP10 adds neither a prop nor a badge for it; the face uses them.

`src/components/PriceCell.tsx` — find:

```tsx
  fullAge?: boolean;
}
```

`src/components/PriceCell.tsx` — replace with:

```tsx
  fullAge?: boolean;
  /**
   * WP10's phone day-cell face (plan decision 52): the amount with "≈" and each mark as one glyph; the provider,
   * destination, source, age, note and the marks' words are in the title and in spoken text, so nothing is lost.
   */
  face?: boolean;
}
```

`src/components/PriceCell.tsx` — find:

```tsx
  ];
  return (
```

`src/components/PriceCell.tsx` — replace with:

```tsx
  ];
  if (props.face === true) {
    const G = COPY.priceMarkGlyph;
    const marks = [
      ...(props.unconfirmed === true ? [{ glyph: G.unconfirmed, words: COPY.priceNotConfirmed }] : []),
      ...(props.stale ? [{ glyph: G.stale, words: COPY.stale }] : []),
      ...(age.kind === 'unknown' ? [{ glyph: G.ageUnknown, words: COPY.vendorAgeUnknown }] : []),
      ...(props.truncated === true ? [{ glyph: G.truncated, words: COPY.truncatedNote }] : []),
      ...(props.superseded === true ? [{ glyph: G.superseded, words: COPY.superseded }] : []),
      ...(notSeen !== null ? [{ glyph: G.notSeen, words: COPY.notSeenInLatest(COPY.agoOf(notSeen)) }] : []),
    ];
    const spoken = [
      ...marks.map((m) => m.words),
      ...detail,
      ...(props.destination !== undefined ? [props.destination] : []),
      ...(props.destinationNote ? [props.destinationNote] : []),
    ].join(' · ');
    return (
      <span
        data-testid="price-cell"
        data-face
        title={spoken}
        className={`block min-w-0 text-[11px] font-semibold tabular-nums ${calendar ? 'rounded border border-dashed border-slate-500' : ''}`}
      >
        {fxTitle !== null ? (
          <>
            <span aria-hidden="true">{COPY.fxApprox}</span>
            <span className="sr-only">{COPY.fxSpoken(fxTitle)}</span>
          </>
        ) : null}
        {formatPence(props.pricePence)}
        {marks.length > 0 ? <span aria-hidden="true">{marks.map((m) => m.glyph).join('')}</span> : null}
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }
  return (
```

`apps/web/src/copy.ts`: the face's glyphs, beside WP9's `fxApprox` (WP9's `superseded` entry stays).

`src/copy.ts` — find:

```ts
  fxApprox: '≈',
  fxSpoken: (detail: string) => `approximately (${detail})`,
```

`src/copy.ts` — replace with:

```ts
  fxApprox: '≈',
  /** WP10 (decision 52): PriceCell's `face` marks on a phone day cell; the words stay in its title and spoken text. */
  priceMarkGlyph: {
    unconfirmed: '!',
    stale: '◷',
    ageUnknown: '?',
    truncated: '…',
    notSeen: '◌',
    superseded: '↺',
  },
  fxSpoken: (detail: string) => `approximately (${detail})`,
```

`apps/web/src/lib/marks.ts`:

```ts
/**
 * The decision-54 marks a view figure may carry, read once for PriceCell: `notSeenInLatest` on a verified-basis minimum
 * (the latest search no longer returned it) and `superseded` on a calendar-basis price (a newer parent execution found
 * its cell empty or no_data). A figure without the field carries no such mark.
 */
export interface FigureMarks {
  notSeenInLatestHours: number | 'unknown' | null;
  superseded: boolean;
}

export function figureMarks(p: {
  notSeenInLatest?: { ageHours: number | 'unknown' } | null;
  superseded?: boolean;
}): FigureMarks {
  return { notSeenInLatestHours: p.notSeenInLatest?.ageHours ?? null, superseded: p.superseded === true };
}
```

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
      <span data-testid="coverage-cue" className="block text-[11px] italic">
        {C.countsInconsistent}
      </span>
    );
  }
  const full = coverage.searched === coverage.total;
  return (
    <span
      data-testid="coverage-cue"
      data-coverage={full ? 'full' : 'partial'}
      className="flex items-center gap-1 text-[11px]"
    >
      <span aria-hidden="true" className={`cov-swatch ${full ? 'cov-full' : 'cov-partial'}`} />
      {C.searchedFraction(coverage.searched, coverage.total)}
    </span>
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
  formatDayOfMonth,
  formatIsoDateLong,
  formatIsoDateShort,
  formatIsoMonth,
  monthDays,
  WEEK_HEADERS,
  weekdayIndex,
} from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { CoverageCue } from './CoverageCue.js';
import type { DayDisplay, Glyph } from './display.js';
import { coverageOf } from './marker.js';
import type { CalendarModel } from './model.js';
import { BAND_CLASSES, FLAT_CLASS, PRICELESS_CLASS } from './scale.js';
import type { DaySlice, GridDay } from './types.js';
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
  /** Phone width: each day shows its compact face, the rest is in the panel (plan decision 52, review ui-r2-001). */
  compact: boolean;
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
 * View B heatmap: a captioned table of day buttons per month (plan decision 51), roving tabindex; arrows move by a day or a week, Home and End to the ends of
 * the week, PageUp and PageDown by a month; Enter or Space opens the side panel (spec §11 View B, Accessibility).
 */
export function CalendarGrid({ days, model, months, destinationNotes, compact, onOpen }: CalendarGridProps) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const shown = new Set(months);
  const [focusDate, setFocusDate] = useState<IsoDate | null>(null);
  const refs = useRef(new Map<IsoDate, HTMLButtonElement>());
  // why: the tab stop is the focused day if it is still drawn, else the first drawn day.
  const firstShown = days.find((d) => shown.has(monthOf(d.date)))?.date ?? null;
  const tabStop =
    focusDate !== null && shown.has(monthOf(focusDate)) && byDate.has(focusDate) ? focusDate : firstShown;

  const open = (date: IsoDate) => {
    const disp = model.displays.get(date);
    onOpen(date, disp?.kind === 'price' ? disp.price.cell : null);
  };
  // why: Enter and Space are the button's own activation (its onClick); the keys below move focus.
  const onKeyDown = (date: IsoDate) => (e: KeyboardEvent<HTMLButtonElement>) => {
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
          className={`w-full table-fixed border-separate ${compact ? 'border-spacing-0.5' : 'border-spacing-1'}`}
        >
          <caption className="text-left font-semibold">{formatIsoMonth(m)}</caption>
          <thead>
            <tr>
              {WEEK_HEADERS.map((w) => (
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
                  if (date === null) return <td key={`pad-${m}-${i}`} />;
                  const gd = byDate.get(date);
                  if (gd === undefined) {
                    // why: outside the window or the api's days: only the day number, never a price or a glyph.
                    return (
                      <td key={date} className="align-top text-xs text-slate-500">
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
                    <td key={date} className="align-top">
                      <button
                        type="button"
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
                        className={`block h-full w-full min-w-0 cursor-pointer overflow-hidden rounded text-left ${compact ? 'p-0.5' : 'p-1'} ${FOCUS_RING} ${fill}`}
                      >
                        <span className="block text-xs font-semibold">
                          <span aria-hidden="true">{formatDayOfMonth(date)}</span>
                          {band !== undefined ? (
                            // why: ui-r2-005 — the band is printed, so adjacent shades never rest on colour alone
                            <span
                              aria-hidden="true"
                              data-band-number
                              className="ml-0.5 align-super text-[10px]"
                            >
                              {band + 1}
                            </span>
                          ) : null}
                          <span className="sr-only">{formatIsoDateLong(date)}</span>
                        </span>
                        {compact ? (
                          <PhoneDayBody display={disp} slice={gd.slice} notes={destinationNotes} />
                        ) : (
                          <DayBody display={disp} slice={gd.slice} notes={destinationNotes} />
                        )}
                        {band !== undefined ? (
                          <span className="sr-only">{COPY.calendarView.bandAria(band)}</span>
                        ) : null}
                        {flat ? <span className="sr-only">{COPY.calendarView.flatAria}</span> : null}
                        {hatched ? <span className="sr-only">{COPY.calendarView.hatchedAria}</span> : null}
                      </button>
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
    <span className="block text-[11px]">
      <Unconfirmed slice={slice} />
      <GlyphList glyphs={display.glyphs} />
      {display.reason === 'no-run' ? <span className="block">{C.noRunCoversDay}</span> : null}
      {display.reason === 'no-provider' ? <span className="block">{C.noDiscoveryProvider}</span> : null}
      {/* why: ui-r2-003 — a grey day says how much of it was looked at, as a priced day does */}
      {display.reason === 'counts' ? <CoverageCue coverage={coverageOf(slice)} /> : null}
    </span>
  );
}

/**
 * The phone face (plan decision 52, review ui-r2-001): at 375 px a column is about 45 px, so a day shows its number and
 * band, the amount through PriceCell's `face` (marks as single glyphs, words in its title and spoken text) or the
 * glyphs of a priceless day, and one-glyph marks for "price not confirmed" and partial coverage. Stay, provider,
 * "cached from" and the counts are in the panel, one tap away.
 */
function PhoneDayBody(props: { display: DayDisplay; slice: DaySlice; notes: Partial<Record<Iata, string>> }) {
  const { display, slice, notes } = props;
  const C = COPY.calendarView;
  const coverage = coverageOf(slice);
  const partial = coverage.kind === 'fraction' && coverage.searched < coverage.total;
  const unconfirmed = slice.unconfirmedCells > 0 && slice.cheapestVerified === null;
  const marks = (
    <>
      {unconfirmed ? (
        <span data-testid="day-unconfirmed">
          <span aria-hidden="true">{C.phoneMark.unconfirmed}</span>
          <span className="sr-only">{C.unconfirmedShort}</span>
        </span>
      ) : null}
      {partial ? (
        <span data-coverage="partial">
          <span aria-hidden="true">{C.phoneMark.partial}</span>
          <span className="sr-only">{C.phonePartial}</span>
        </span>
      ) : null}
    </>
  );
  if (display.kind === 'price') {
    const p = display.price;
    return (
      <span data-testid="day-price-face" className="block min-w-0 text-[11px]">
        <span className="sr-only">
          {display.basis === 'calendar' ? C.calendarPrice : COPY.classLabel.verified}
        </span>
        <PriceBoundary>
          <PriceCell
            face
            {...figureMarks(p)}
            pricePence={p.pricePence}
            provenance={p.provenance}
            calendar={display.basis === 'calendar'}
            stale={display.stale}
            truncated={p.truncated}
            destination={p.cell.destination}
            destinationNote={notes[p.cell.destination] ?? null}
          />
        </PriceBoundary>
        <span className="block">{marks}</span>
      </span>
    );
  }
  return (
    <span className="block min-w-0 text-[11px]">
      {display.glyphs.map((g) => (
        <span key={g.status} data-glyph={g.status}>
          <span aria-hidden="true" className="font-bold">
            {C.glyphSymbol[g.status]}
          </span>
          <span className="sr-only">{glyphWords(g)}</span>
        </span>
      ))}
      {display.reason === 'no-provider' ? <span className="sr-only">{C.noDiscoveryProvider}</span> : null}
      <span className="block">{marks}</span>
    </span>
  );
}

/**
 * The day's price in WP9's PriceCell compact form (decisions 36, 38, 46): the amount with "≈", a short provider badge,
 * the destination code and the stale, truncated and unconfirmed marks, with source, age and note in its title; then
 * the stay, any cheaper cached fare with its own destination and stay (decision 52) and the coverage cue. Everything
 * else is in the side panel. A price without provenance is withheld (spec §9 item 6).
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
  const cached = display.cheaperCached;
  return (
    <span data-testid="day-price-block" className="flex flex-col gap-0.5 text-xs">
      <span className="sr-only">{isCalendar ? C.calendarPrice : COPY.classLabel.verified}</span>
      <Unconfirmed slice={slice} />
      <PriceBoundary>
        <PriceCell
          compact
          {...figureMarks(p)}
          pricePence={p.pricePence}
          provenance={p.provenance}
          calendar={isCalendar}
          stale={display.stale}
          truncated={p.truncated}
          destination={p.cell.destination}
          destinationNote={notes[p.cell.destination] ?? null}
        />
      </PriceBoundary>
      <span data-testid="day-stay" className="block text-[11px]">
        {C.stay(p.cell.nights, formatIsoDateShort(p.cell.returnDate))}
      </span>
      {cached !== null ? (
        <span data-testid="cached-from" className="block text-[11px]">
          <span>{C.cachedFrom}</span>
          <PriceBoundary>
            <PriceCell
              compact
              {...figureMarks(cached)}
              pricePence={cached.pricePence}
              provenance={cached.provenance}
              calendar
              stale={cached.stale}
              truncated={cached.truncated}
              destination={cached.cell.destination}
              destinationNote={notes[cached.cell.destination] ?? null}
            />
          </PriceBoundary>
          <span className="block">
            {C.stay(cached.cell.nights, formatIsoDateShort(cached.cell.returnDate))}
          </span>
        </span>
      ) : null}
      <CoverageCue coverage={coverageOf(slice)} />
    </span>
  );
}

/**
 * Decision 48: a day whose itinerary search priced cells but confirmed no price says "price not confirmed", so it never
 * reads as "nothing found" or as a confirmed fare. Only when the day shows no class-verified price; under a filter the
 * api counts that destination's cells only (decisions 51, 53; review prov-r2-004).
 */
function Unconfirmed({ slice }: { slice: DaySlice }) {
  if (slice.unconfirmedCells === 0 || slice.cheapestVerified !== null) return null;
  return (
    <span data-testid="day-unconfirmed" className="block text-[11px] font-semibold">
      {COPY.calendarView.unconfirmedShort}
    </span>
  );
}

/** "47 not searched": the glyph's words with its count when one is known. */
function glyphWords(g: Glyph): string {
  return g.count === null
    ? COPY.bucket[g.status]
    : COPY.calendarView.glyphCount(g.count, COPY.bucket[g.status]);
}

function GlyphList({ glyphs }: { glyphs: readonly Glyph[] }) {
  if (glyphs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {glyphs.map((g) => (
        <span key={g.status} data-glyph={g.status}>
          <span aria-hidden="true" className="font-bold">
            {COPY.calendarView.glyphSymbol[g.status]}
          </span>{' '}
          {glyphWords(g)}
        </span>
      ))}
    </span>
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
 * range and day count, the hatched days and the glyphs stay open; the explanations of the marks (dashed, stale,
 * coverage cue, "cached from", "cheapest of the rows read", the stay, the band number and the phone glyphs) fold into "What the marks mean" (review ui-r2-006), so a phone reaches the grid soon.
 * `data-scale` marks the legend's scale values, the one exemption the rendered sweep grants (plan decision 52).
 */
export function CalendarLegend({ model }: { model: CalendarModel }) {
  const C = COPY.calendarView;
  const L = C.legend;
  const other: DayBasis = model.colourBasis === 'verified' ? 'calendar' : 'verified';
  const basis = COPY.basisName[model.colourBasis];
  const s = model.scale;
  const range =
    s.minPence !== null && s.maxPence !== null ? [formatPence(s.minPence), formatPence(s.maxPence)] : null;
  return (
    <section
      aria-label={L.title}
      data-testid="calendar-legend"
      data-scale
      className="flex flex-col gap-1 text-sm"
    >
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
      <p>{L.glyphs}</p>
      <ul className="flex flex-wrap gap-x-4">
        {GLYPHS.map((g) => (
          <li key={g}>
            <span aria-hidden="true">{C.glyphSymbol[g]}</span> {COPY.bucket[g]}
            {g === 'skipped' ? <span>{L.skippedWhy}</span> : null}
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer">{L.more}</summary>
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
          <li>{L.unconfirmed}</li>
          <li>{L.truncated}</li>
          <li>{L.stay}</li>
          <li>{L.bandNumber}</li>
          <li>{L.phone}</li>
        </ul>
      </details>
    </section>
  );
}
```

`test/copy/sourceGuard.test.ts` — find:

```ts
  'src/views/Definitions/EstimatePanel.tsx',
]);
```

`test/copy/sourceGuard.test.ts` — replace with:

```ts
  'src/views/Definitions/EstimatePanel.tsx',
  // WP10 (plan decision 52): the heatmap legend's band ranges, scale values in [data-scale], never fares; the
  // indicative route-level series, which spec §11 exempts from full provenance ([data-indicative] rows). The charts
  // print fares only through PriceCell and their axes without "£" (format.ts formatAxisPounds), so they are not here.
  'src/views/Calendar/CalendarLegend.tsx',
  'src/views/History/RouteTable.tsx',
]);
```

`test/copy/sourceGuard.test.ts` — find:

```ts
  'value',
]);
```

`test/copy/sourceGuard.test.ts` — replace with:

```ts
  'value',
  // WP10: Recharts' identifier props (a data field, an axis scale, a legend position), never copy
  'dataKey',
  'scale',
  'verticalAlign',
]);
```

`test/copy/sourceGuard.test.ts` — find:

```ts
      else if (slot !== null && COPY_ATTRS.has(slot.attr)) out.push(`${file}: ${slot.attr}="${lit}"`);
      else if (slot !== null && onComponent(n) && !NON_COPY_PROPS.has(slot.attr))
        out.push(`${file}: prop ${slot.attr}="${lit}"`);
```

`test/copy/sourceGuard.test.ts` — replace with:

```ts
      else if (slot !== null && COPY_ATTRS.has(slot.attr)) out.push(`${file}: ${slot.attr}="${lit}"`);
      else if (
        slot !== null &&
        onComponent(n) &&
        !NON_COPY_PROPS.has(slot.attr) &&
        !slot.attr.startsWith('data-')
      )
        out.push(`${file}: prop ${slot.attr}="${lit}"`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/grid.test.tsx test/components test/copy`
Expected: PASS. The grid file passes 18 tests, the face file 3 and the marks file 1; WP9's PriceCell and provenance tests still pass (the face is a separate branch); the source guard passes.

Run: `pnpm lint`
Expected: no errors, with no suppression comment (`pnpm boundaries` rejects one).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar month tables of day buttons, phone face, cached-from with its own stay, counted glyphs, folded legend"
```

### Task 10.7: Side panel: the day, the cell's outcomes and prices, per-cell verify with its cost

**Files:**
- Create: `apps/web/src/views/Calendar/{panel.ts,PanelSections.tsx,CellPanel.tsx}`, `apps/web/test/views/calendar/panel.test.tsx`

**Interfaces:**
- Consumes: `useCellDetail`, WP9's `useExecutionActions().verify`, `ApiError`, `resultRowKey`, `hrefWith`/`navigateTo` and WP9's `?row=`, `PriceCell` with `priceUnconfirmed`, `PriceBoundary`, `DayMarker`, core's `generateCells`, `cellKeyString`, `isPriceUnconfirmed`, `daysBetween`, the `format.ts` forms, `instantMs`.
- Produces: `cellsForDay`, `toKey`, `orderOutcomes`, `reasonText`, `runLabel`, `orderCalendarPrices`, `noHeadroom`, `canPressVerify` (`panel.ts`); `VerifyCost`, `DayPrices`, `CellDetailBody` (`PanelSections.tsx`); `CellPanel({ definition, date, slice, executions, initialCell, inline, onClose })`.

The panel opens on the day: its six-bucket marker per provider (with a "not searched yet" line for a configured provider with no counts, the partially-verified count and, decision 48, the cells whose itinerary search confirmed no price) and its prices with full provenance, then the cell picker, whose cells come from core's `generateCells` over that one departure date, so the picker follows core's generation order (origins and destinations sorted) and the space has one enumerator (review arch2-004). The cell route returns outcomes from every run of the definition, so rows are ordered by the calendar response's run list (newest first), the latest run is marked, runs are named by their Europe/London start date (decision 52), reasons are in words (each `;`-joined part of core's priced reason, decisions 19, 48 and 50, looked up in a map typed against core's reason types; an unknown reason is shown as it came, marked "other"), a priced outcome whose reason carries `price-unconfirmed` says "price not confirmed" beside its status, and the vendor detail (`lastError`) has its own column. The Run column is each row's header and stays in view while the nine columns scroll sideways (review ui-r2-010). The cell's calendar prices list current ones first and those a newer run superseded after them, badged (decision 54); the day's prices carry their own decision-54 marks. Each observation is a ResultRow through PriceCell with `unconfirmed={priceUnconfirmed(o)}` and `truncated`, so an unconfirmed offer says so first, inside its price, and a page-capped row says "cheapest of the rows read" (decision 44, review prov-r2-001).

Verify goes through WP9's single action, whose refresh now covers the WP10 queries. Beside it, "hard stop N calls · M calls of budget headroom left" from the cell detail's `verify` (decisions 42, 45; decision 44 words a cap as a hard stop). Until the cell detail has loaded, the line says it is loading what the search may spend and the button is disabled, so no call is spent before the operator has seen the hard stop (review ui-r2-007); a 409 `active` says a search is already running, a 409 `cap` names the cap with WP8's message, and with no headroom the button is disabled with the reason. At phone width the panel is a section of the page below the grid (`inline`), never a full-screen non-modal overlay that Tab could leave for the hidden grid (review ui-r2-010). The pure helpers live in `panel.ts` under the view-model coverage floor, the sections in `PanelSections.tsx`, and `CellPanel.tsx` keeps the shell, the picker and the action (review arch2-008).

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/panel.test.tsx`:

```tsx
import { asIsoDate, generateCells, resultRowKey } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { CellPanel } from '../../../src/views/Calendar/CellPanel.js';
import {
  canPressVerify,
  cellsForDay,
  noHeadroom,
  orderCalendarPrices,
  orderOutcomes,
  reasonText,
} from '../../../src/views/Calendar/panel.js';
import { API, calendarRow, definition, summary, verifiedRow } from '../../fixtures.js';
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
const earlier = summary({
  id: 'exec-0000',
  ageHours: 170,
  startedAt: hoursBefore(172),
  finishedAt: hoursBefore(171),
});
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
      superseded: false,
    },
  ],
  observations: [observation],
});
const cellRoute = `${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`;
const daySlice = slice({
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8 })],
  verification: { selected: 10, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 0 },
  cheapestCalendar: priceAt(41200, provCalendarAt(2), false, c),
});

function renderPanel(def = definition(), s = daySlice, inline = false) {
  const onClose = vi.fn();
  const r = renderWithProviders(
    <CellPanel
      definition={def}
      date={date}
      slice={s}
      executions={executions}
      initialCell={c}
      inline={inline}
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
    expect(reasonText('constructor')).toBe('other: constructor');
    expect(reasonText('no-priced-options')).toBe('the provider answered with no priced options');
    expect(reasonText('mixed')).toBe('several different errors');
    expect(reasonText(null)).toBe('—');
    expect(reasonText('partial-expansion;price-unconfirmed;offers-dropped:2')).toBe(
      'some outbound flights could not be expanded; price not confirmed by the final step; 2 offers could not be read and were dropped',
    );
  });
  it('no headroom: a zero cap or no calls of headroom left (WP7 childCapPreview)', () => {
    expect(noHeadroom(null)).toBe(false);
    expect(noHeadroom({ maxCalls: 0, headroomCalls: 40 })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, headroomCalls: 0 })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, headroomCalls: 1840 })).toBe(false);
  });
  it('verify may be pressed only once its cost has loaded, with headroom, and not while one is sent (ui-r2-007)', () => {
    expect(canPressVerify(undefined, false)).toBe(false);
    expect(canPressVerify({ ...detail, verify: null }, false)).toBe(false);
    expect(canPressVerify({ ...detail, verify: { maxCalls: 6, headroomCalls: 0 } }, false)).toBe(false);
    expect(canPressVerify(detail, true)).toBe(false);
    expect(canPressVerify(detail, false)).toBe(true);
  });
  it('superseded calendar prices come after current ones, each group in api order (decision 54)', () => {
    const p = (id: number, superseded: boolean) => ({ id, superseded });
    expect(orderCalendarPrices([p(1, true), p(2, false), p(3, true), p(4, false)]).map((x) => x.id)).toEqual([
      2, 4, 1, 3,
    ]);
  });
  it("the cell picker follows core's generation order: origins and destinations sorted (arch2-004)", () => {
    const def = definition();
    const cells = cellsForDay(def, date);
    expect(def.origins).toEqual(['LHR', 'LGW']);
    expect(cells[0]).toEqual({
      origin: 'LGW',
      destination: 'EWR',
      departureDate: '2027-03-14',
      returnDate: '2027-03-24',
    });
    const core = generateCells({
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: date,
      departureTo: date,
      minNights: def.minNights,
      maxNights: def.maxNights,
    });
    expect(cells.map((k) => `${k.origin}${k.destination}${k.returnDate}`)).toEqual(
      core.map((k) => `${k.origin}${k.destination}${k.returnDate}`),
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
    // why: ui-r2-010 — the run labels each row and stays in view while the table scrolls sideways.
    expect(within(table).getAllByRole('rowheader')[0]).toHaveClass('sticky');
    expect(rows.map((r) => r.getAttribute('data-current'))).toEqual(['true', 'true', 'false']);
    expect(rows[0]).toHaveTextContent(
      /run 14 Oct 2026.*latest run.*discovery.*Travelpayouts.*priced.*reused from run 7 Oct 2026/,
    );
    expect(rows[1]).toHaveTextContent(
      /itinerary search.*SearchApi.*skipped.*stopped: a budget cap was reached/,
    );
    expect(rows[2]).toHaveTextContent(/run 7 Oct 2026.*discovery/);
  });

  it('a priced verification with no confirmed price says "price not confirmed" in the outcome and the day (decision 48)', async () => {
    const unconfirmed = cellDetail(c, {
      outcomes: [
        outcome(c, 'verification', 'searchapi', 'priced', { reason: 'partial-expansion;price-unconfirmed' }),
      ],
    });
    server.use(http.get(cellRoute, () => HttpResponse.json(unconfirmed)));
    const day = slice({
      discovery: [disc('travelpayouts', { priced: 48 })],
      verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
      unconfirmedCells: 1,
    });
    const { findByRole, getByRole } = renderPanel(definition(), day);
    const row = within(await findByRole('table')).getAllByRole('row')[1];
    expect(row).toHaveTextContent(/priced.*price not confirmed/);
    expect(row).toHaveTextContent(
      'some outbound flights could not be expanded; price not confirmed by the final step',
    );
    expect(within(getByRole('region', { name: 'This day' })).getByTestId('day-marker')).toHaveTextContent(
      'price not confirmed: 1 itinerary-searched cell priced nothing the final step confirmed',
    );
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

  it('an offer whose price the final step did not confirm says so inside its price; a page-capped row says rows read (prov-r2-001)', async () => {
    const unconfirmed = verifiedRow({
      cell: c,
      seller: 'Example Air',
      pricePence: 50000,
      unverified: ['priceConfirmed'],
    });
    const capped = calendarRow({ cell: c, truncated: true });
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({ ...detail, calendarPrices: [], observations: [unconfirmed, capped] }),
      ),
    );
    const { findAllByTestId } = renderPanel(definition(), slice({}));
    const [first, second] = await findAllByTestId('panel-observation');
    if (first === undefined || second === undefined) throw new Error('two observations');
    expect(within(first).getByTestId('price-cell')).toHaveTextContent(
      'price not confirmed by the final step',
    );
    expect(within(second).getByTestId('price-cell')).toHaveTextContent('cheapest of the rows read');
    expect(within(second).getByTestId('price-cell')).not.toHaveTextContent('price not confirmed');
  });

  it('a superseded calendar price says so and is listed after the current one (decision 54)', async () => {
    const [first] = detail.calendarPrices;
    if (first === undefined) throw new Error('fixture has a calendar price');
    const old = { ...first, calendarPriceId: 8, pricePence: 30000, superseded: true };
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({ ...detail, calendarPrices: [old, first], observations: [] }),
      ),
    );
    const { findByText, getByRole } = renderPanel(definition(), slice({}));
    await findByText('£300');
    const prices = within(getByRole('dialog')).getAllByTestId('price-cell');
    expect(prices.map((c) => c.textContent?.includes('superseded by a later search'))).toEqual([false, true]);
    expect(prices[0]).toHaveTextContent('£412');
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
    expect(queryByRole('button', { name: COPY.verifyCell })).toBeNull();
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
    const { findByText, getByRole, user } = renderPanel();
    expect(await findByText('hard stop 6 calls · 1840 calls of budget headroom left')).toHaveAttribute(
      'data-testid',
      'verify-cost',
    );
    await user.click(getByRole('button', { name: COPY.verifyCell }));
    expect(await findByText(COPY.verifyStarted)).toBeInTheDocument();
    expect(posted).toEqual({ definitionId: 'def-0001', cell: keyOf(c) });

    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'active', message: 'child active' } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCell }));
    expect(await findByText('An itinerary search for this cell is already running.')).toBeInTheDocument();

    const capMessage = 'budget cap: provider-month:searchapi 10000 of 10000 calls';
    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'cap', message: capMessage } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCell }));
    expect(await findByText(`Refused by a budget cap: ${capMessage}`)).toBeInTheDocument();
  });

  it('while the cell detail loads, verify is disabled and says its cost is loading (ui-r2-007)', async () => {
    server.use(
      http.get(cellRoute, async () => {
        await delay('infinite');
        return HttpResponse.json(detail);
      }),
    );
    const { getByRole, getByTestId } = renderPanel();
    expect(getByTestId('verify-cost')).toHaveTextContent('Loading what this search may spend…');
    expect(getByRole('button', { name: COPY.verifyCell })).toBeDisabled();
  });

  it('at phone width the panel is a section of the page, not an overlay dialog (ui-r2-010)', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole, queryByRole, getByTestId } = renderPanel(definition(), daySlice, true);
    await findByRole('table');
    expect(queryByRole('dialog')).toBeNull();
    expect(getByTestId('cell-panel').tagName).toBe('SECTION');
    expect(getByTestId('cell-panel')).not.toHaveClass('fixed');
  });

  it('with no headroom left the button is disabled and says why', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({
          ...detail,
          verify: { maxCalls: 6, headroomCalls: 0 },
        }),
      ),
    );
    const { findByText, getByRole } = renderPanel();
    expect(await findByText('No budget headroom left for this search.')).toBeInTheDocument();
    expect(getByRole('button', { name: COPY.verifyCell })).toBeDisabled();
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

`apps/web/src/views/Calendar/panel.ts`:

```ts
import { type CellKey, generateCells, type IsoDate } from '@gmt/core';
import type { CellDetailResponse, DefinitionResponse, ExecutionSummary } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatInstantDateLondon } from '../../format.js';
import { instantMs } from '../../lib/time.js';

// The side panel's pure helpers (review arch2-008: under the view-model coverage floor, beside the components).

const P = COPY.calendarView.panel;
type Outcome = CellDetailResponse['outcomes'][number];
type VerifyInfo = CellDetailResponse['verify'];

/** Every cell departing on `date`, in core's generation order (spec §6.1; review arch2-004: core's one enumerator). */
export function cellsForDay(
  def: Pick<DefinitionResponse, 'origins' | 'destinations' | 'minNights' | 'maxNights'>,
  date: IsoDate,
): CellKey[] {
  return generateCells({
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: date,
    departureTo: date,
    minNights: def.minNights,
    maxNights: def.maxNights,
  }).map(toKey);
}

/** The four-field key of a cell (the verify request and the picker take no `nights`). */
export function toKey(c: CellKey): CellKey {
  return {
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
  };
}

/**
 * Outcomes newest run first (prov-011): rows of runs the calendar response lists come in its newest-first order, then
 * any other run (an on-demand child), each group by fetchedAt descending.
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

// why: widened once, so a part is looked up by Object.hasOwn and never reaches Object.prototype.
const REASONS: Readonly<Record<string, string>> = P.reasons;

/**
 * An outcome reason in operator words (spec §3 reason lists). A priced reason is core's `;`-joined parts
 * (`pricedReason`: partial-expansion, price-unconfirmed, offers-dropped:n; decisions 19, 45, 48, 50); a reason core
 * does not know is shown as it came, marked "other".
 */
export function reasonText(reason: string | null): string {
  if (reason === null) return P.dash;
  return reason.split(';').map(reasonPart).join('; ');
}

function reasonPart(part: string): string {
  const dropped = /^offers-dropped:(\d+)$/.exec(part);
  if (dropped?.[1] !== undefined) return P.offersDropped(Number(dropped[1]));
  return Object.hasOwn(REASONS, part) ? (REASONS[part] ?? P.reasonRaw(part)) : P.reasonRaw(part);
}

/** "run 14 Mar 2027" (Europe/London, decision 52) for a run the response lists, else the run id's head. */
export function runLabel(executionId: string, executions: readonly ExecutionSummary[]): string {
  const started = executions.find((e) => e.id === executionId)?.startedAt ?? null;
  return P.run(started === null ? executionId.slice(0, 8) : formatInstantDateLondon(instantMs(started)));
}

/**
 * The cell's calendar prices with current ones first and those a newer parent execution superseded after them
 * (decision 54), each group in the order the api sent it.
 */
export function orderCalendarPrices<P extends { superseded: boolean }>(prices: readonly P[]): P[] {
  return [...prices.filter((p) => !p.superseded), ...prices.filter((p) => p.superseded)];
}

/** True when the child could make no call: a zero cap or no budget headroom left (WP7's childCapPreview). */
export function noHeadroom(v: VerifyInfo): boolean {
  if (v === null) return false;
  return v.maxCalls === 0 || v.headroomCalls === 0;
}

/**
 * Whether Verify may be pressed (review ui-r2-007): only once the cell detail has loaded what the search may spend,
 * so no call is spent before the operator has seen its hard stop; never with no headroom, never while one is sent.
 */
export function canPressVerify(detail: CellDetailResponse | undefined, sending: boolean): boolean {
  return detail !== undefined && detail.verify !== null && !noHeadroom(detail.verify) && !sending;
}
```

`apps/web/src/views/Calendar/PanelSections.tsx`:

```tsx
import { isPriceUnconfirmed, resultRowKey } from '@gmt/core';
import type { CellDetailResponse, ExecutionSummary } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell, priceUnconfirmed } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayShort, formatInstantLondon } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { instantMs } from '../../lib/time.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { noHeadroom, orderCalendarPrices, orderOutcomes, reasonText, runLabel } from './panel.js';
import type { DayPrice, DaySlice } from './types.js';

// The side panel's sections (review arch2-008: CellPanel.tsx keeps the shell, the picker and the action).

const P = COPY.calendarView.panel;
const COLUMNS = [
  'run',
  'stage',
  'provider',
  'status',
  'reason',
  'attempts',
  'fetched',
  'detail',
  'reused',
] as const;
// why: ui-r2-010 — the Run column stays in view while the nine-column table scrolls sideways on a phone.
const STICKY = 'sticky left-0 bg-white';

/**
 * "hard stop N calls · M calls of budget headroom left" beside the button (decisions 38, 42, 45: WP7's childCapPreview;
 * decision 44: a cap is stated as a hard stop, never "up to").
 */
export function VerifyCost({ verify }: { verify: CellDetailResponse['verify'] }) {
  if (verify === null) return null;
  return (
    <p data-testid="verify-cost" className="text-xs">
      {P.verifyCost(verify.maxCalls, verify.headroomCalls)}
      {noHeadroom(verify) ? <span className="block font-medium">{P.verifyNoHeadroom}</span> : null}
    </p>
  );
}

/** The day's own prices with full provenance (the day cell shows them compact). */
export function DayPrices({ slice, notes }: { slice: DaySlice; notes: Partial<Record<string, string>> }) {
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
        const destination = r.price.cell.destination;
        return (
          <li key={r.key}>
            <span className="text-xs">{r.label}</span>
            <span className="block text-xs">
              {P.dayCell(r.price.cell.nights, formatDayShort(r.price.cell.returnDate))}
            </span>
            <PriceBoundary>
              <PriceCell
                {...figureMarks(r.price)}
                pricePence={r.price.pricePence}
                provenance={r.price.provenance}
                calendar={r.calendar}
                stale={r.price.stale}
                truncated={r.price.truncated}
                destination={destination}
                destinationNote={notes[destination] ?? null}
              />
            </PriceBoundary>
          </li>
        );
      })}
    </ul>
  );
}

// Observations are ResultRows; their searchLink may be null (synthetic rows, plan decision 15). The panel never renders it.
export function CellDetailBody(props: {
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
              {COLUMNS.map((k) => (
                <th key={k} scope="col" className={`text-left ${k === 'run' ? STICKY : ''}`}>
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
                <th scope="row" className={`text-left font-normal ${STICKY}`}>
                  {runLabel(o.executionId, executions)}
                  {o.executionId === latest ? <span className="block font-medium">{P.latestRun}</span> : null}
                </th>
                <td>{COPY.stageName[o.stage]}</td>
                <td>{COPY.provider[o.providerId]}</td>
                <td>
                  {COPY.bucket[o.status]}
                  {/* why: decision 48: a priced verification outcome with no confirmed price says so beside its status */}
                  {o.status === 'priced' && isPriceUnconfirmed(o.reason) ? (
                    <span className="block font-semibold">{COPY.calendarView.unconfirmedShort}</span>
                  ) : null}
                </td>
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
          {orderCalendarPrices(detail.calendarPrices).map((p) => (
            <li key={`cal-${p.calendarPriceId}`}>
              <span className="text-xs">{P.calendarPriceRun(runLabel(p.executionId, executions))}</span>
              <PriceBoundary>
                <PriceCell
                  pricePence={p.pricePence}
                  provenance={p.provenance}
                  calendar
                  stale={p.stale}
                  truncated={p.truncated}
                  superseded={p.superseded}
                  destination={detail.cell.destination}
                  destinationNote={note}
                />
              </PriceBoundary>
            </li>
          ))}
          {detail.observations.map((o) => (
            <li
              key={`obs-${o.observationId ?? o.itineraryHash}-${o.seller ?? ''}`}
              data-testid="panel-observation"
            >
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
                {/* why: decision 44 and review prov-r2-001: an unconfirmed offer says so first, beside its amount */}
                <PriceCell
                  pricePence={o.pricePence}
                  provenance={o.provenance}
                  calendar={o.basis === 'calendar'}
                  stale={o.stale}
                  truncated={o.truncated}
                  unconfirmed={priceUnconfirmed(o)}
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

`apps/web/src/views/Calendar/CellPanel.tsx`:

```tsx
import { type CellKey, cellKeyString, daysBetween, type IsoDate } from '@gmt/core';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useCellDetail, useExecutionActions } from '../../api/queries.js';
import type { DefinitionResponse, ExecutionSummary } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatDayShort, formatIsoDateLong } from '../../format.js';
import { DayMarker } from './DayMarker.js';
import { CellDetailBody, DayPrices, VerifyCost } from './PanelSections.js';
import { canPressVerify, cellsForDay, toKey } from './panel.js';
import type { DaySlice } from './types.js';

const P = COPY.calendarView.panel;

export interface CellPanelProps {
  definition: DefinitionResponse;
  date: IsoDate;
  /** The day as the grid shows it: its six-bucket marker and its prices with full provenance live here. */
  slice: DaySlice;
  /** The calendar response's executions, newest first: they order and label the outcome rows. */
  executions: readonly ExecutionSummary[];
  initialCell: CellKey | null;
  /**
   * At phone width the panel is a section of the page below the grid, not an overlay (review ui-r2-010): a full-width
   * non-modal dialog would let Tab wander into the hidden grid behind it.
   */
  inline: boolean;
  onClose(): void;
}

/**
 * View B side panel (spec §11, plan decision 38): the day's six-bucket marker and its prices with full provenance; a
 * cell picker; that cell's outcomes per run, stage and provider, newest first; its prices; and the per-cell verify
 * action with what it may spend. Verify is hidden without a verification provider (spec §8.1).
 */
export function CellPanel(props: CellPanelProps) {
  const { definition, date, slice, executions, initialCell, inline, onClose } = props;
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

  const body: ReactNode = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {P.title(formatIsoDateLong(date))}
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
          {detail.data === undefined ? (
            <p data-testid="verify-cost" className="text-xs">
              {P.verifyCostLoading}
            </p>
          ) : (
            <VerifyCost verify={detail.data.verify} />
          )}
          <button
            type="button"
            disabled={!canPressVerify(detail.data, verify.isPending)}
            onClick={() => verify.mutate({ definitionId: definition.id, cell: selected })}
            className="self-start rounded bg-slate-900 px-3 py-1 text-white disabled:bg-slate-400"
          >
            {COPY.verifyCell}
          </button>
          {verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
          {verify.isError ? <p role="alert">{verifyError(verify.error)}</p> : null}
        </div>
      ) : null}
    </>
  );
  const onKeyDown = (e: { key: string; preventDefault(): void }) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  if (inline) {
    return (
      <section
        aria-labelledby={headingId}
        data-testid="cell-panel"
        onKeyDown={onKeyDown}
        className="mt-2 border-t pt-4"
      >
        {body}
      </section>
    );
  }
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      data-testid="cell-panel"
      onKeyDown={onKeyDown}
      className="fixed inset-y-0 right-0 z-10 w-full max-w-lg overflow-y-auto border-l bg-white p-4 shadow-lg"
    >
      {body}
    </aside>
  );
}

/** A refusal in words: a running child, a named budget cap (409 `cap`, WP8 passes the engine's message), or else. */
function verifyError(error: Error): string {
  if (error instanceof ApiError && error.status === 409) {
    return error.code === 'cap' ? P.verifyCapRefused(error.message) : P.verifyConflict;
  }
  return COPY.actionFailed(error.message);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar/panel.test.tsx test/copy`
Expected: PASS. The panel file passes 20 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: side panel with core's cells, typed reasons, badged offers, verify gated on its cost, inline on phones"
```

### Task 10.8: Calendar view (data, URL state, basis, phone width, states)

**Files:**
- Create: `apps/web/src/views/Calendar/CalendarView.tsx`, `apps/web/test/views/calendar/view.test.tsx`

**Interfaces:**
- Consumes: `useCalendar`, `whileRunning`, `ViewHeader` (`variant="span"`), `useNow`, `useMediaQuery`/`NARROW_QUERY`, `useSearchParams`/`updateSearchParams`, `CalendarGrid`, `CalendarLegend`, `CellPanel`, `buildCalendarModel`, `defaultColourBasis`, `sliceOf`, `totalReused`, `ReusedNote`, `formatDuration`.
- Produces: `CALENDAR_PARAMS`, `parseDestination`, `parseBasis`, `CalendarView({ definition })`.

The destination filter (`cal.dest`), the chosen basis (`cal.basis`) and the phone-width month (`cal.month`) live in the URL like WP9's Results state, so they survive navigation and links. The filter is sent to the api (`?destination=JFK`, decision 53), which computes that destination's days; the view renders them as they come. The default basis is judged on the all-destination calendar (the same query the unfiltered view uses, cached), so a filter change never flips what the colours mean; a filtered view waits for both. At phone width the month navigation comes before the legend (review ui-r2-006), the grid draws the phone face, and the panel opens below the grid. The header is WP9's `variant="span"` (a calendar spans runs). Below it, "N of M shown prices are stale" (by fetch age plus any known vendor age, decision 44) names the itinerary threshold from the response; the header's stale flag is set only when every shown price is stale. The query refetches every 2 s while the newest run is pending or running.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/calendar/view.test.tsx`:

```tsx
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { whileRunning } from '../../../src/api/queries.js';
import type { CalendarDay } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import { CalendarView } from '../../../src/views/Calendar/CalendarView.js';
import { API, definition, summary } from '../../fixtures.js';
import {
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
// The unfiltered day: every destination's 48 cells; the JFK-filtered one the api computes (decision 53): JFK's 24.
const mixedDay = day('2027-03-14', {
  cheapestCalendar: ewr,
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8, reused: 3 })],
});
const jfkDay = day('2027-03-14', {
  cheapestCalendar: jfk,
  discovery: [disc('travelpayouts', { priced: 18, no_data: 6, reused: 1 })],
});
const ewrOnlyDay = day('2027-03-15', {
  cheapestCalendar: priceAt(45000, provCalendarAt(2), false, cellAt('2027-03-15', 14, 'LHR', 'EWR')),
  discovery: [disc('travelpayouts', { priced: 20, not_run: 28 })],
});
const jfkNoPriceDay = day('2027-03-15', { discovery: [disc('travelpayouts', { empty: 4, not_run: 20 })] });
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
/** Serves `days` unfiltered and `filtered[destination]` for a destination query; records each query. */
const serve = (days: CalendarDay[], filtered: Partial<Record<string, CalendarDay[]>> = {}) => {
  const asked: Array<string | null> = [];
  server.use(
    http.get(route, ({ request }) => {
      const d = new URL(request.url).searchParams.get('destination');
      asked.push(d);
      return HttpResponse.json(calendarResponse(d === null ? days : (filtered[d] ?? [])));
    }),
  );
  return asked;
};
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
    expect(await findByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
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
    // why: WP9's span header names the runs by start time and says no single run status applies.
    expect(getByText(COPY.spanExecutions(1))).toBeInTheDocument();
    expect(getByText(/14 Oct 2026 13:00 Europe\/London/)).toBeInTheDocument();
  });

  it('says how many shown prices are stale; the header stale flag only when every one is', async () => {
    serve([calendarDay('2027-03-01', true), calendarDay('2027-03-02')]);
    const first = renderWithProviders(<CalendarView definition={definition()} />);
    expect(
      await first.findByText(
        /^1 of 2 shown prices are stale by fetch age plus any known vendor age \(itinerary prices after 8d,/,
      ),
    ).toBeInTheDocument();
    expect(first.queryByText('Every row here is older than one refresh cycle.')).toBeNull();
    first.unmount();
    serve([calendarDay('2027-03-01', true)]);
    const second = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await second.findByText('Every row here is older than one refresh cycle.')).toBeInTheDocument();
  });

  it('the destination filter lives in the URL and is sent to the api, whose filtered days render as they come (decision 53)', async () => {
    const asked = serve([mixedDay, ewrOnlyDay], { JFK: [jfkDay, jfkNoPriceDay] });
    const { findByRole, getByLabelText, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await findByRole('table', { name: 'Mar 2027' });
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£399');
    await user.selectOptions(getByLabelText('Destination'), 'JFK');
    expect(param('cal.dest')).toBe('JFK');
    await waitFor(() =>
      expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£412'),
    );
    expect(asked).toContain('JFK');
    expect(within(at('2027-03-14')).getByTestId('day-stay')).toHaveTextContent('14n · back 28 Mar');
    // why: the api counted JFK's cells, so the cue and the glyphs are JFK's own, never all destinations'.
    expect(within(at('2027-03-14')).getByTestId('coverage-cue')).toHaveTextContent('24/24 searched');
    expect(at('2027-03-15')).toHaveTextContent('∅ 4 no fares');
    expect(at('2027-03-15')).toHaveTextContent('○ 20 not searched');
    expect(document.body).not.toHaveTextContent('all destinations');
    await user.selectOptions(getByLabelText('Destination'), 'all');
    expect(param('cal.dest')).toBeNull();
  });

  it('the default basis is judged on the all-destination calendar, so a filter never flips it (decision 38)', async () => {
    serve([verifiedDay('2027-03-01'), verifiedDay('2027-03-02'), calendarDay('2027-03-03')], {
      JFK: [calendarDay('2027-03-01'), calendarDay('2027-03-02')],
    });
    const { findByRole } = renderWithProviders(<CalendarView definition={definition()} />, {
      search: '?cal.dest=JFK',
    });
    expect(await findByRole('radio', { name: 'itinerary-search basis' })).toBeChecked();
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
    const days = [verifiedDay('2027-03-01'), calendarDay('2027-03-02'), calendarDay('2027-03-03')];
    serve(days, { JFK: days });
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
    await findByRole('table', { name: 'Mar 2027' });
    expect(getAllByRole('table')).toHaveLength(1);
    expect(getByRole('button', { name: 'Previous month' })).toBeDisabled();
    await user.click(getByRole('button', { name: 'Next month' }));
    expect(param('cal.month')).toBe('2027-04');
    expect(getByRole('table', { name: 'Apr 2027' })).toBeInTheDocument();
    expect(getAllByRole('table')).toHaveLength(1);
    // why: ui-r2-006 — the month navigation comes before the legend; ui-r2-001 — each day shows its phone face.
    const nav = getByRole('navigation', { name: 'Month' });
    const legend = getByRole('region', { name: 'Legend' });
    expect(nav.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(at('2027-04-02')).getByTestId('day-price-face')).toHaveTextContent('£400');
    expect(within(at('2027-04-02')).queryByTestId('day-price-block')).toBeNull();
  });

  it('Enter opens the side panel for the day; Escape closes it and focus returns to the day', async () => {
    serve([mixedDay]);
    const { findByRole, queryByRole, user } = renderWithProviders(<CalendarView definition={definition()} />);
    await findByRole('table', { name: 'Mar 2027' });
    // why: focus the day directly; tabbing would first reach the filter controls above the grid.
    at('2027-03-14').focus();
    await user.keyboard('{Enter}');
    expect(await findByRole('dialog', { name: 'Departing Sun 14 Mar 2027' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(at('2027-03-14')).toHaveFocus();
  });

  it('refetches every 2 s while the newest run is pending or running, and stops after (po-wp10-006)', () => {
    expect(whileRunning({ executions: [summary({ status: 'running' })] })).toBe(2_000);
    expect(whileRunning({ executions: [summary({ status: 'pending' })] })).toBe(2_000);
    expect(whileRunning({ executions: [summary({ status: 'completed' })] })).toBe(false);
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
import { type SliceOptions, sliceOf, totalReused } from './marker.js';
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

function gridDays(days: readonly CalendarDay[], o: SliceOptions, destination: Iata | null): GridDay[] {
  return days.map((d) => ({ date: d.date, slice: sliceOf(d, o, destination) }));
}

/**
 * View B: the calendar heatmap for one definition (spec §11 View B, §10 calendar route; plan decisions 38, 53). A
 * destination filter is sent to the api, which computes that destination's counts, minimums and unconfirmed cells; the
 * days are rendered as they come. The default colour basis is judged on the all-destination calendar (the same query
 * the unfiltered view uses), so a filter change never flips what colour means.
 */
export function CalendarView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const params = useSearchParams();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [open, setOpen] = useState<{ date: IsoDate; cell: CellKey | null } | null>(null);
  const destination = parseDestination(params.get(CALENDAR_PARAMS.destination), definition.destinations);
  const filter = destination === 'all' ? null : destination;
  const q = useCalendar(definition.id, filter);
  const all = useCalendar(definition.id, null);
  const hasVerification = definition.providers.verification.length > 0;
  const discoveryProviders = definition.providers.discovery;
  const raw = q.data?.days;
  const allRaw = all.data?.days;

  const allDays = useMemo(
    () => gridDays(allRaw ?? [], { verificationConfigured: hasVerification, discoveryProviders }, null),
    [allRaw, hasVerification, discoveryProviders],
  );
  const days = useMemo(
    () => gridDays(raw ?? [], { verificationConfigured: hasVerification, discoveryProviders }, filter),
    [raw, filter, hasVerification, discoveryProviders],
  );
  const chosen = parseBasis(params.get(CALENDAR_PARAMS.basis));
  // why: plan decision 38 — the default is judged over all destinations, so a filter change never flips the colouring.
  const colourBasis: DayBasis =
    chosen === 'calendar' || (chosen === 'verified' && hasVerification)
      ? chosen
      : defaultColourBasis(allDays, hasVerification, now);
  const model = useMemo(() => buildCalendarModel(days, colourBasis, now), [days, colourBasis, now]);
  const months = useMemo(() => [...new Set(days.map((d) => monthOf(d.date)))], [days]);

  // why: the default basis needs the all-destination calendar too, so a filtered view waits for both.
  if (q.isPending || all.isPending) return <p role="status">{COPY.loading}</p>;
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
        variant="span"
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
          {/* why: ui-r2-006 — month navigation before the legend, so a phone reaches it without scrolling past */}
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
          <CalendarLegend model={model} />
          <CalendarGrid
            days={days}
            model={model}
            months={drawn}
            destinationNotes={definition.destinationNotes}
            compact={narrow}
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
          inline={narrow}
          onClose={closePanel}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/calendar test/copy`
Expected: PASS. The calendar files pass 90 tests (marker 11, display 16, scale 12, grid 18, panel 20, view 13).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar view with the api's destination filter, stable default basis, phone layout, polling"
```

### Task 10.9: TZ suite, chart setup and the web test config (review focus 3, pinned)

**Files:**
- Create: `apps/web/test/setup-tz.ts`, `apps/web/test/setup-charts.ts`, `apps/web/test/tz/dates.tz.test.tsx`
- Modify (WP9): `apps/web/vitest.config.ts`, `apps/web/package.json` (scripts)

**Interfaces:**
- Consumes: `CalendarGrid`, `buildCalendarModel`, `formatIsoDateLong`, `formatIsoDate`, `WEEK_HEADERS`, WP9's `ResultsView`, `resultsResponse`, `calendarRow`.
- Produces: the `test:tz` script; `test` running coverage and then `test:tz`; per-glob coverage floors for WP10's pure modules (TS-8), which hold every pure helper (the panel's in `panel.ts`, Duration's `rowAt` and counts in `data.ts`, History's pair lines and heading in `lines.ts`; review arch2-008).

The suite proves the zone two ways. The `test:tz` script runs the TZ suite and the calendar tests as whole processes twice, with `GMT_TEST_TZ=America/Los_Angeles` and `GMT_TEST_TZ=Asia/Tokyo`; `test/setup-tz.ts` copies that value into `process.env.TZ` before any test module loads. Inside the suite, `describe.each` switches `process.env.TZ` per block, so the root `pnpm test` (one process, the machine's zone) covers both zones too. Each block first asserts the zone took effect (the resolved `Intl` zone and the January offset) and runs a negative control: a naive `Date` moves the day, and west of Greenwich a `Date`-based formatter prints "Sat 13" for 2027-03-14. `test:tz` is a zone check, not a coverage run.

- [ ] **Step 1: Write the failing test**

`apps/web/test/tz/dates.tz.test.tsx`:

```tsx
import { asIata, asIsoDate, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIsoDate, formatIsoDateLong, WEEK_HEADERS } from '../../src/format.js';
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
  return `${WEEK_HEADERS[(d.getDay() + 6) % 7]} ${d.getDate()}`;
};

/** A day's button and its weekday column (Monday = 0). */
function cell(date: string): HTMLButtonElement {
  const el = document.querySelector(`button[data-date="${date}"]`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no day ${date}`);
  return el;
}
function column(date: string): number {
  return cell(date).closest('td')?.cellIndex ?? -1;
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
    expect(formatIsoDateLong(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027'); // US DST starts
    expect(formatIsoDateLong(asIsoDate('2027-03-28'))).toBe('Sun 28 Mar 2027'); // UK DST starts
    expect(formatIsoDateLong(asIsoDate('2027-10-31'))).toBe('Sun 31 Oct 2027'); // UK DST ends
    expect(formatIsoDateLong(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
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
        compact={false}
        onOpen={() => undefined}
      />,
    );
    expect(column('2027-03-13')).toBe(5);
    expect(column('2027-03-14')).toBe(6);
    expect(column('2027-03-15')).toBe(0);
    expect(cell('2027-03-14').querySelector('[aria-hidden="true"]')?.textContent).toBe('14');
    expect(cell('2027-03-14')).toHaveTextContent('Sun 14 Mar 2027');
    expect(cell('2027-03-28')).toHaveTextContent('Sun 28 Mar 2027');
    expect(cell('2027-04-01').closest('table')).toHaveAccessibleName('Apr 2027');
    expect(column('2027-04-01')).toBe(3);
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

Run: `pnpm --filter @gmt/web run test:tz`
Expected: FAIL with `Missing script: "test:tz"`.

The in-process blocks already pass under `pnpm --filter @gmt/web exec vitest run test/tz`: Vitest 5's default pool is `forks`, where assigning `process.env.TZ` re-detects the zone, so the suite's red evidence is the missing script above and the mutation below, not a pool failure.

Manual mutation, once: in `format.ts` replace `formatIsoDateLong`'s body with the `Date`-based `naiveDayLong` of the test file and rerun `test:tz`; the Los Angeles run must go red on the grid and formatting tests. Restore the file.

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

`apps/web/vitest.config.ts` (WP9's: `pool` pinned to Vitest 5's default with the reason, `exclude`, the setup order and the view-model floors beside WP9's 100% files):

`vitest.config.ts` — find:

```ts
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };
```

`vitest.config.ts` — replace with:

```ts
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };
/** WP10's pure view-model modules carry their own floor above the package's (review TS-8). */
const VIEW_MODEL = { lines: 95, branches: 85, functions: 95, statements: 95 };
```

`vitest.config.ts` — find:

```ts
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['test/setup.ts'],
    coverage: {
```

`vitest.config.ts` — replace with:

```ts
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    // why: Vitest 5's default, pinned (review arch2-003): each worker is its own Node process, where assigning
    // process.env.TZ re-detects the zone; 'threads' would ignore it (vitest v5.0.3 docs/config/pool.md).
    pool: 'forks',
    // why: the Playwright smoke lives in e2e/ and runs only through `pnpm --filter @gmt/web e2e` (spec §9 item 6).
    exclude: ['e2e/**', 'node_modules/**'],
    // why: setup-tz first so the zone is set before anything touches Date; setup-charts sizes Recharts in jsdom.
    setupFiles: ['test/setup-tz.ts', 'test/setup.ts', 'test/setup-charts.ts'],
    coverage: {
```

`vitest.config.ts` — find:

```ts
        'src/state/{urlState,resultsState}.ts': FULL,
      },
```

`vitest.config.ts` — replace with:

```ts
        'src/state/{urlState,resultsState}.ts': FULL,
        'src/lib/**': VIEW_MODEL,
        'src/views/{Calendar,Duration,History}/*.ts': VIEW_MODEL,
      },
```

`apps/web/package.json` (WP0's, which WP9 keeps; WP10 changes `test` and `e2e` and adds `test:tz` and `e2e:install`):

`apps/web/package.json` — find:

```json
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
    "test": "vitest run --coverage",
    "dev": "vite",
    "e2e": "playwright test"
  },
```

`apps/web/package.json` — replace with:

```json
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
    "test": "vitest run --coverage && pnpm run test:tz",
    "dev": "vite",
    "e2e": "pnpm --workspace-root run build && playwright test",
    "test:tz": "GMT_TEST_TZ=America/Los_Angeles vitest run test/tz test/views/calendar && GMT_TEST_TZ=Asia/Tokyo vitest run test/tz test/views/calendar",
    "e2e:install": "playwright install chromium"
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/tz`
Expected: PASS, 10 tests (5 per zone).

Run: `pnpm --filter @gmt/web run test:tz`
Expected: two passing runs, each listing `test/tz/dates.tz.test.tsx` and the six `test/views/calendar/*` files, 100 tests each.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: TZ suite under Los Angeles and Tokyo, chart setup, pinned forks pool and view-model coverage floors"
```

### Task 10.10: View C Duration (Recharts 3)

**Files:**
- Create: `apps/web/src/views/Duration/{data.ts,DurationChart.tsx,DurationView.tsx}`, `apps/web/test/views/duration.test.tsx`

**Interfaces:**
- Consumes: `useDurationAnalysis`, `ViewHeader` (`variant="span"`), `PriceCell`, `PriceBoundary`, `formatAxisPounds`, `formatDayShort`, `sourceLabelOf`, `seriesColour`, `hrefWith`/`navigateTo` and WP9's `f.nights`; recharts `BarChart`, `Bar`, `Cell`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.
- Produces: `DurationPrice`, `SearchedCount`, `DurationCell`, `DurationRow`, `DurationSeries`, `DurationData` (with `shownPrices` and `stalePrices`), `buildDurationData`, `rowAt`, `barValue`, `gapLabel`, `DurationTooltip`, `DurationChart`, `DurationTable`, `DurationView`; `src/lib/palette.ts`.

One row per nights value in `[minNights, maxNights]`. Each series cell carries its own `searched` count of `total` cells from the contract, so a gap reads "not searched", "searched 3 of 48 cells, no price" or "searched, no price" for a calendar series (review prov-r2-007) and "not itinerary-searched", "itinerary-searched 1 of 4 selected cells, no class-verified price" or "itinerary-searched, no class-verified price" for the verified series: offers that were found but did not qualify are never reported as absent (review prov-r2-006); a nights value the api omits was searched by nothing. A gap is `null`: Recharts draws no bar, never a zero bar, never an interpolated one, and the x axis stars ("13*") a nights value no series searched, which the chart note explains (review ui-r2-011). Series names come from their prices' provenance. The note under the title defines `n` ("priced cells behind each minimum"; the legend's `n` sums over stay lengths) and names the dashed and faded styles the legend swatch cannot show. The tooltip finds its row by the axis label in the data it already holds, so no chart payload is cast, and prints each minimum through PriceCell `compact` with its destination, note and "cheapest of the rows read" (decision 52: every fare in the DOM through PriceCell, tooltips included), then `n` and the departure date; the tooltip and the table carry decision 54's marks through `figureMarks` ("not seen in latest search" on the verified minimum, "superseded by a later search" on a calendar one). A stale minimum is drawn at 30% opacity with a 2 px black outline. Price ticks are whole pounds without "£" under the axis title "price (GBP)", so the figure needs no exemption from WP9's sweep. The shown and stale counts come from `DurationData`. The table is the chart's text alternative (`aria-describedby`); each nights value links to Results with `f.nights=<n>-<n>`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/duration.test.tsx`:

```tsx
import { within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { DurationTooltip } from '../../src/views/Duration/DurationChart.js';
import { DurationView } from '../../src/views/Duration/DurationView.js';
import { barValue, buildDurationData, gapLabel, rowAt } from '../../src/views/Duration/data.js';
import { API, definition } from '../fixtures.js';
import { bare, cellAt, durationResponse, night, priceAt, provSyntheticAt } from '../fixtures.wp10.js';
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
      'itinerary-searched, no class-verified price',
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
  it('a partly searched nights value says k of N, never "searched, no price" for the whole stay length (prov-r2-007)', () => {
    const partly = buildDurationData(
      durationResponse([night(10, null, null, { verification: [1, 4], travelpayouts: [3, 48] })]),
      10,
      10,
      true,
    );
    const [row] = partly.rows;
    expect(gapLabel(row?.cells.verified, 'verified')).toBe(
      'itinerary-searched 1 of 4 selected cells, no class-verified price',
    );
    expect(gapLabel(row?.cells['calendar:travelpayouts'], 'calendar')).toBe(
      'searched 3 of 48 cells, no price',
    );
    expect(gapLabel(undefined, 'calendar')).toBe('not searched');
  });
  it('counts the prices shown and the stale ones; the tooltip row is found by label, never by cast', () => {
    const d = data();
    expect([d.shownPrices, d.stalePrices]).toEqual([3, 0]);
    expect(rowAt(d.rows, 12)?.nights).toBe(12);
    expect(rowAt(d.rows, '12')?.nights).toBe(12);
    expect(rowAt(d.rows, null)).toBeUndefined();
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
            price: { ...bare(priceAt(30000, provSyntheticAt(1), false, at)), cell: at, superseded: false },
            n: 2,
          },
        ],
        searched: {
          verification: { searched: 0, total: 4 },
          discovery: [{ providerId: 'fixture', searched: 48, total: 48 }],
        },
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
  it('the tooltip shows each price through PriceCell with its provenance marks, n and departure date, or the gap by kind', () => {
    const d = data();
    const notes = def.destinationNotes;
    const tip = renderWithProviders(<DurationTooltip active label={10} data={d} notes={notes} />).getByTestId(
      'duration-tooltip',
    );
    expect(tip).toHaveTextContent('10 nights');
    // why: decision 52, review prov-r2-003 — a tooltip fare is a PriceCell: badge, destination, age in its title.
    const cells = within(tip).getAllByTestId('price-cell');
    expect(cells.map((c) => c.textContent)).toEqual([
      expect.stringContaining('£520'),
      expect.stringContaining('£412'),
    ]);
    expect(cells[0]).toHaveTextContent("vendor's cache age unknown");
    expect(cells[1]).toHaveClass('border-dashed');
    expect(cells[1]).toHaveTextContent('JFK');
    expect(tip).toHaveTextContent('n=3 · departs Sun 14 Mar');
    expect(tip).toHaveTextContent('n=5 · departs Sun 14 Mar');
    const gap = renderWithProviders(
      <DurationTooltip active label="12" data={d} notes={notes} />,
    ).getAllByTestId('duration-tooltip')[1];
    if (gap === undefined) throw new Error('second tooltip');
    expect(gap).toHaveTextContent('min among verified: itinerary-searched, no class-verified price');
    expect(within(gap).getByTestId('price-cell').getAttribute('title')).toContain('onward leg not included');
    expect(gap).toHaveTextContent('n=4 · departs Sat 20 Mar');
    const none = renderWithProviders(
      <DurationTooltip active label={13} data={d} notes={notes} />,
    ).getAllByTestId('duration-tooltip')[2];
    expect(none).toHaveTextContent('calendar, Aviasales cache: not searched');
  });
  it('the tooltip renders nothing when inactive or off the data', () => {
    expect(
      renderWithProviders(<DurationTooltip active={false} label={10} data={data()} notes={{}} />).container,
    ).toBeEmptyDOMElement();
    expect(
      renderWithProviders(<DurationTooltip active label={99} data={data()} notes={{}} />).container,
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

  it('draws a named chart with axis titles, a legend carrying n, starred ticks, no "£" and no bar for a gap', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const figure = await findByRole('figure', { name: 'Cheapest found by stay length' });
    expect(figure).toHaveAccessibleDescription(/Cheapest found per stay length, with provenance/);
    expect(figure).toHaveTextContent('n = priced cells behind each minimum');
    // why: recharts draws legend icons as svgs too; the chart surface is the one with role="application".
    const svg = figure.querySelector('svg[role="application"]');
    expect(svg?.textContent).toContain('nights');
    expect(svg?.textContent).toContain('13*');
    expect(svg?.textContent).toContain('14*');
    expect(svg?.textContent).not.toContain('11*');
    // why: decision 52 — axis ticks print pounds without the sign; the figure carries no sweep exemption.
    expect(svg?.textContent).toContain('price (GBP)');
    expect(svg?.textContent).not.toContain('£');
    expect(figure).not.toHaveAttribute('data-scale');
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
                    ...bare(priceAt(41200, provSyntheticAt(400), true, cellAt('2027-03-14', 10))),
                    cell: cellAt('2027-03-14', 10),
                    superseded: false,
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
      'itinerary-searched, no class-verified price',
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

  it('decision 54: a verified minimum not seen in the latest search and a superseded calendar minimum say so', async () => {
    const [first] = resp.byNights;
    if (first === undefined || first.minVerified === null) throw new Error('fixture has a verified minimum');
    const [cal] = first.minCalendar;
    if (cal === undefined) throw new Error('fixture has a calendar minimum');
    const marked = {
      ...first,
      minVerified: { ...first.minVerified, notSeenInLatest: { ageHours: 30 } },
      minCalendar: [{ ...cal, price: { ...cal.price, superseded: true } }],
    };
    server.use(http.get(route, () => HttpResponse.json({ ...resp, byNights: [marked] })));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const table = await findByRole('table', { name: 'Cheapest found per stay length, with provenance' });
    const [verified, calendar] = within(table).getAllByTestId('price-cell');
    expect(verified).toHaveTextContent('not seen in latest search (30h ago)');
    expect(calendar).toHaveTextContent('superseded by a later search');
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
        '1 of 2 shown prices are stale (older than one refresh cycle by fetch age)',
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
/**
 * A per-nights minimum as the duration route sends it: a price cell with the cell it came from (plan decision 38), and
 * its decision-54 mark (`notSeenInLatest` on the verified minimum, `superseded` on a calendar one).
 */
export type DurationPrice = Night['minCalendar'][number]['price'] | NonNullable<Night['minVerified']>;

/** Cells of one nights value a series searched, of the cells in its scope (review prov-r2-007). */
export interface SearchedCount {
  searched: number;
  total: number;
}

/** One series at one nights value: its minimum (or null), n, and how much of this nights value that series searched. */
export interface DurationCell {
  price: DurationPrice | null;
  n: number;
  searched: SearchedCount;
}
export interface DurationRow {
  nights: number;
  cells: Record<string, DurationCell>;
  /** False when no series searched any cell of this nights value: the x axis marks it with a star. */
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
  /** Prices shown and how many are stale: the header's stale line and flag (review arch2-008). */
  shownPrices: number;
  stalePrices: number;
}

const NONE: SearchedCount = { searched: 0, total: 0 };

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
      [VERIFIED]: { price: v, n: v?.n ?? 0, searched: r?.searched.verification ?? NONE },
    };
    for (const p of providers) {
      const m = r?.minCalendar.find((x) => x.providerId === p);
      const d = r?.searched.discovery.find((x) => x.providerId === p);
      const searched = d === undefined ? NONE : { searched: d.searched, total: d.total };
      cells[calendarKey(p)] = { price: m?.price ?? null, n: m?.n ?? 0, searched };
    }
    rows.push({ nights, cells, anySearched: Object.values(cells).some((c) => c.searched.searched > 0) });
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
  const prices = rows.flatMap((r) =>
    series.flatMap((s) => {
      const p = r.cells[s.key]?.price ?? null;
      return p === null ? [] : [p];
    }),
  );
  return {
    rows,
    series,
    isEmpty: prices.length === 0,
    shownPrices: prices.length,
    stalePrices: prices.filter((p) => p.stale).length,
  };
}

/** The row a tooltip label (the nights value on the x axis) names; a lookup, never a cast of the chart payload. */
export function rowAt(rows: readonly DurationRow[], label: unknown): DurationRow | undefined {
  const nights = typeof label === 'number' ? label : typeof label === 'string' ? Number(label) : Number.NaN;
  return rows.find((r) => r.nights === nights);
}

/**
 * The bar height of one series at one nights value: its minimum's pence, or null for a gap. Recharts draws no bar for
 * null; a 0 here would claim a free fare and is never produced (spec §11 View C: gaps, no interpolation).
 */
export function barValue(row: DurationRow, key: string): number | null {
  return row.cells[key]?.price?.pricePence ?? null;
}

/**
 * The gap wording of one series at one nights value (plan decision 38: per series, by stage). Partial coverage says
 * "k of N" (review prov-r2-007); the verified series says "no class-verified price", never "no price", because offers
 * that were found but did not qualify are not absent fares (review prov-r2-006).
 */
export function gapLabel(cell: DurationCell | undefined, kind: DurationSeries['kind']): string {
  const { searched, total } = cell?.searched ?? NONE;
  const D = COPY.durationView;
  if (kind === 'verified') {
    if (searched === 0) return D.notItinerarySearched;
    return searched < total ? D.partlyItinerarySearchedNoPrice(searched, total) : D.itinerarySearchedNoPrice;
  }
  if (searched === 0) return D.notSearched;
  return searched < total ? D.partlySearchedNoPrice(searched, total) : D.searchedNoPrice;
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
import { formatAxisPounds, formatDayShort } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { seriesColour } from '../../lib/palette.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { barValue, type DurationData, type DurationRow, gapLabel, rowAt } from './data.js';

const D = COPY.durationView;

/**
 * Custom tooltip: the nights, then each series' minimum through PriceCell compact (plan decision 52: every fare in the
 * DOM, tooltips included, with "≈", stale, vendor age, destination, note and "cheapest of the rows read"), its n and
 * departure date, or its gap kind (spec §11 View C: n in the tooltip).
 */
export function DurationTooltip(props: {
  active?: boolean | undefined;
  label?: unknown;
  data: DurationData;
  notes: Partial<Record<Iata, string>>;
}) {
  const row = rowAt(props.data.rows, props.label);
  if (props.active !== true || row === undefined) return null;
  return (
    <div data-testid="duration-tooltip" className="rounded border bg-white p-2 text-xs shadow">
      <p className="font-medium">{D.nightsLabel(row.nights)}</p>
      <ul className="flex flex-col gap-1">
        {props.data.series.map((s) => {
          const c = row.cells[s.key];
          const p = c?.price ?? null;
          return (
            <li key={s.key}>
              <span>{p === null ? D.seriesLine(s.shortName, gapLabel(c, s.kind)) : s.shortName}</span>
              {p !== null && c !== undefined ? (
                <>
                  <PriceBoundary>
                    <PriceCell
                      compact
                      {...figureMarks(p)}
                      pricePence={p.pricePence}
                      provenance={p.provenance}
                      calendar={s.kind === 'calendar'}
                      stale={p.stale}
                      truncated={p.truncated}
                      destination={p.cell.destination}
                      destinationNote={props.notes[p.cell.destination] ?? null}
                    />
                  </PriceBoundary>
                  <span className="block">{D.tooltipDetail(c.n, formatDayShort(p.cell.departureDate))}</span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Bars per nights with axis titles (nights, price in GBP), one series per basis and provider (spec §11 View C). A
 * missing value is a gap, never a zero bar; a nights value no series searched is starred on the axis; calendar series
 * are paler and dashed and a stale minimum is drawn faded with a heavy outline, so no meaning rests on colour alone.
 */
export function DurationChart(props: {
  data: DurationData;
  tableId: string;
  notes: Partial<Record<Iata, string>>;
}) {
  const { data, tableId, notes } = props;
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
                tickFormatter={(v: number) => formatAxisPounds(v)}
                label={{ value: D.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                content={(p) => (
                  <DurationTooltip active={p.active} label={p.label} data={data} notes={notes} />
                )}
              />
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
                          {...figureMarks(p)}
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
  const shown = data?.shownPrices ?? 0;
  const stale = data?.stalePrices ?? 0;
  return (
    <section aria-label={COPY.durationView.title} className="flex flex-col gap-4">
      <ViewHeader
        variant="span"
        title={COPY.durationView.title}
        executions={q.data.executions}
        stale={shown > 0 && stale === shown}
      />
      {stale > 0 ? <p className="text-sm">{COPY.durationView.staleLine(stale, shown)}</p> : null}
      {data === null || data.isEmpty ? (
        <p>{COPY.durationView.empty}</p>
      ) : (
        <>
          <DurationChart data={data} tableId={tableId} notes={definition.destinationNotes} />
          <DurationTable data={data} id={tableId} notes={definition.destinationNotes} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/duration.test.tsx test/copy`
Expected: PASS. The duration file passes 17 tests. Mutation check, once: make `barValue` return `?? 0` instead of `?? null`; "missing prices are null gaps, never 0" must fail. (Recharts draws no visible bar at 0 either, so the DOM test alone cannot catch it; the value test does.) Restore it.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: duration view with counted per-series gaps, PriceCell tooltip, starred ticks, links to Results"
```

### Task 10.11: History view

**Files:**
- Create: `apps/web/src/views/History/{lines.ts,HistoryChart.tsx,RouteTable.tsx,HistoryView.tsx}`, `apps/web/src/state/links.ts`, `apps/web/test/views/history.test.tsx`

**Interfaces:**
- Consumes: `useRouteHistories`, `useItineraryHistory`, WP9's `useResults` and `parseBasis` (the executions list the status bar reads), `cellKeyString`, `instantMs`, `dateMs`, `dateOfMs`, the `format.ts` forms, `effectiveAge`, `formatAgeFull`, `PriceCell`, `PriceBoundary`, `sourceLabelOf`, `SERIES_COLOURS`, `seriesColour`, `ViewHeader` (`variant="span"`), `useSearchParams`, `updateSearchParams`, `hrefWith`, `navigateTo`; recharts `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Legend`, `ResponsiveContainer`.
- Produces: `RoutePoint`, `PlotPoint`, `PlotLine`, `RoutePlotPoint`, `RouteLine`, `RunOrder`, `runOrder`, `withBreaks`, `consecutiveRuns`, `linesFromRoute`, `linesFromItinerary`, `assignColours`, `linesForPairs`, `coloursRepeat`, `itineraryHeading`, `historySpan`, `newestAllStale` (`lines.ts`); `HistoryChart`, `RouteChart`, `HistoryTable`; `RouteTable`; `HISTORY_PARAMS`, `historyHref` (`src/state/links.ts`); `MAX_OVERLAY_PAIRS`, `HistoryView`.

**Two charts (plan decision 38).** Fetch-time series (calendar per provider and cabin, itinerary offers) are plotted at `fetchedAt` on a Europe/London date axis. The route-level series is a different quantity (a vendor price per travel date), so it gets its own chart with a date axis (`dateMs`, ticks as dates with the year) and its own tables. Its series are named by their provider and cabin ("SearchApi route-level series, indicative · cabin not stated", decision 52), and its note says the vendor states neither its route scope nor which date pairs it covers (WP5 records that scope as unevidenced; review prov-007). Every route-level point is dotted, so a travel date between two missing dates still shows (review ui-r2-008).

**Joins (plan decision 52).** Two consecutive points of a fetch-time series are joined only when their runs are consecutive runs of the definition in run order, never by a time gap: an offer missing from a run between two points (not seen, so possibly gone) breaks the line, whatever the schedule's cadence (review prov-r2-005). The run order is the definition's parent runs, oldest first, from the executions list the status bar reads (`useResults` with the same key, so no extra request); one-cell child runs search one cell, not the route, so a point they fetched joins no neighbour. Each point names its run (`executionId`: calendar points already carried it; itinerary points carry it from Task 10.1). A refused join inserts a `null`, and `connectNulls={false}` breaks the line. The caption says that each point is one run and no price was fetched between two points. The daily route-level series breaks after a missing travel date.

**Colours (review ui-r2-009).** In the overlay every line of a pair takes the pair's colour (its place among the definition's pairs; at most six pairs, the palette's size, are drawn) and the kind keeps its dash, so two pairs never share a colour; one pair colours its series by their keys' sorted order, so a series keeps its colour as data refreshes. When more series than colours are drawn the chart says colours repeat.

**Provenance.** Every fetch-time point renders through PriceCell with its own `stale` and `truncated` from the contract, and an offer the final step did not confirm gets `unconfirmed`, so the badge sits first inside its price as everywhere else (decision 44, review prov-r2-010); unconfirmed offers also sit in their own dotted series named "… · price not confirmed by the final step". A calendar point names its cheapest searched cell and says when that cell differs from the previous point's. Route-level points carry no cabin, so (spec §11) `RouteTable.tsx` shows the amount with "indicative route-level series", the cabin as the vendor gave it ("cabin not stated" for `unknown`), the fetched age and, from the point's own `stale` (by fetch age, decision 54), "stale", never a PriceCell; it is the one History file allowed to format money, and each row carries `data-indicative`. The charts print price ticks without "£" and carry no `data-scale` (decision 52).

**State.** The pair (`hist.pair`, or `all` for the overlay of up to six pairs) and the itinerary (`hash`) live in the URL; `HISTORY_PARAMS` and `historyHref` live in `src/state/links.ts` beside WP9's URL state, so Results links here without importing the History module and its chart library (review arch2-011). In itinerary mode the heading names the route, dates and carriers from the itinerary response's own `cell` and `carriers`, and every price its destination and note from that cell, on a bookmark or a fresh load too (decision 52, review prov-005). The header is WP9's `ViewHeader variant="span"` over the definition's runs from the executions list (decision 52: never the calendar response), stale when every series' newest point is stale; a WP10 line below it gives how many runs the lines hold and their first and last date. No tooltip (§6).

- [ ] **Step 1: Write the failing test**

`apps/web/test/views/history.test.tsx`:

```tsx
import { asIata } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { HISTORY_PARAMS, historyHref } from '../../src/state/links.js';
import { HistoryView } from '../../src/views/History/HistoryView.js';
import {
  assignColours,
  coloursRepeat,
  consecutiveRuns,
  historySpan,
  itineraryHeading,
  linesForPairs,
  linesFromItinerary,
  linesFromRoute,
  newestAllStale,
  runOrder,
  withBreaks,
} from '../../src/views/History/lines.js';
import { API, definition, resultsResponse, summary } from '../fixtures.js';
import { cellAt, fetchPoint, itineraryHistory, routeHistory, runsAt } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

const routeRoute = `${API}/routes/:origin/:destination/history`;
const itineraryRoute = `${API}/itineraries/:hash/history`;
const resultsRoute = `${API}/definitions/:id/results`;
// Points from the runs 2h, 170h and 500h ago; a run 300h ago fetched nothing for this series.
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
/** The definition's runs: 500h, 300h, 170h and 2h ago, so 500→170 skips a run and 170→2 is consecutive. */
const RUNS = runsAt(2, 170, 300, 500);
const order = runOrder(RUNS);
const serveRuns = (executions = RUNS) =>
  server.use(http.get(resultsRoute, () => HttpResponse.json(resultsResponse({ executions }))));
const priced = (pts: ReadonlyArray<{ pricePence: number | null }>) => pts.map((p) => p.pricePence);

describe('history lines (spec §11 History; plan decisions 38, 52)', () => {
  it('the run order lists parent runs oldest first; one-cell child runs are not in it', () => {
    const child = summary({ id: 'child-1', isChild: true });
    expect([...runOrder([...RUNS.slice(0, 1), child, ...RUNS.slice(1)]).entries()]).toEqual([
      ['exec-500', 0],
      ['exec-300', 1],
      ['exec-170', 2],
      ['exec-2', 3],
    ]);
  });
  it('withBreaks sorts any input order and breaks wherever the join rule refuses', () => {
    const gap = (t: number) => ({ t, gap: true });
    const near = (a: { t: number }, b: { t: number }) => b.t - a.t <= 200;
    expect(withBreaks([{ t: 300 }, { t: 0 }, { t: 100 }], near, gap)).toEqual([
      { t: 0 },
      { t: 100 },
      { t: 300 },
    ]);
    expect(withBreaks([{ t: 0 }, { t: 201 }], near, gap)).toEqual([
      { t: 0 },
      { t: 100.5, gap: true },
      { t: 201 },
    ]);
  });
  it('joins only consecutive runs of the definition, never by time gap (decision 52, prov-r2-005)', () => {
    const joined = consecutiveRuns(order);
    expect(joined({ executionId: 'exec-170' }, { executionId: 'exec-2' })).toBe(true);
    expect(joined({ executionId: 'exec-500' }, { executionId: 'exec-170' })).toBe(false);
    expect(joined({ executionId: 'exec-2' }, { executionId: 'exec-170' })).toBe(false);
    expect(joined({ executionId: 'child-1' }, { executionId: 'exec-2' })).toBe(false);
    const [line] = linesFromRoute(threeRuns, order).fetch;
    expect(priced(line?.points ?? [])).toEqual([45000, null, 42000, 39900]);
    // why: the same points with no run between them join, however far apart in time.
    const [dense] = linesFromRoute(threeRuns, runOrder(runsAt(2, 170, 500))).fetch;
    expect(priced(dense?.points ?? [])).toEqual([45000, 42000, 39900]);
    // why: an unknown run order joins nothing.
    const [none] = linesFromRoute(threeRuns, runOrder([])).fetch;
    expect(priced(none?.points ?? [])).toEqual([45000, null, 42000, null, 39900]);
  });
  it('marks a calendar point whose cheapest cell differs from the previous point’s', () => {
    const [line] = linesFromRoute(threeRuns, order).fetch;
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
            stale: false,
          })),
        },
      ],
    });
    const { route } = linesFromRoute(r, order);
    expect(route[0]?.points[0]?.t).toBe(Date.UTC(2027, 2, 10));
    expect(priced(route[0]?.points ?? [])).toEqual([38000, 38000, null, 38000]);
  });
  it('names each series by its source and cabin; the route-level series by its provider (decision 52, ui-r2-008)', () => {
    const { fetch, route } = linesFromRoute(threeRuns, order);
    expect(fetch.map((l) => l.name)).toEqual([
      "Aviasales cache · economy · cheapest calendar price across this pair's cells, per run (constraints not checked)",
    ]);
    expect(route.map((l) => l.name)).toEqual(['SearchApi route-level series, indicative · cabin not stated']);
    expect(linesFromRoute(threeRuns, order, 'LHR-JFK').fetch[0]?.name).toMatch(/^LHR-JFK · Aviasales cache/);
  });
  it('an itinerary splits confirmed and unconfirmed prices into a solid and a dotted series, joined by run order', () => {
    const lines = linesFromItinerary(itineraryHistory(), runOrder(runsAt(5, 6, 173, 174)));
    expect(lines.map((l) => [l.kind, l.name])).toEqual([
      ['offer', 'Google Flights via SearchApi · itinerary offer · Example Travel'],
      [
        'offer-unconfirmed',
        'Google Flights via SearchApi · itinerary offer · Example Travel · price not confirmed by the final step',
      ],
    ]);
    // why: 173 → 5 skips the runs 174 and 6 between them, so the confirmed line breaks; 174 → 6 skips 173 and breaks too.
    expect(lines.map((l) => priced(l.points))).toEqual([
      [43000, null, 41200],
      [40000, null, 39000],
    ]);
  });
  it('colours: one pair keeps a colour per series key; the overlay gives every line of a pair the pair’s colour (ui-r2-009)', () => {
    const pairs = [
      { origin: asIata('LHR'), destination: asIata('JFK') },
      { origin: asIata('LGW'), destination: asIata('EWR') },
    ];
    const both = linesForPairs([threeRuns, threeRuns], pairs, order, true);
    expect(both.fetch.map((l) => l.colour)).toEqual([0, 1]);
    expect(both.route.map((l) => l.colour)).toEqual([0, 1]);
    const one = linesForPairs([threeRuns], pairs.slice(0, 1), order, false);
    expect(one.fetch.map((l) => l.colour)).toEqual([0]);
    expect(
      assignColours([
        { key: 'b', colour: 0 },
        { key: 'a', colour: 0 },
      ]).map((l) => l.colour),
    ).toEqual([1, 0]);
    expect(coloursRepeat([{ colour: 5 }])).toBe(false);
    expect(coloursRepeat([{ colour: 6 }])).toBe(true);
  });
  it('drops series with no points; spans count runs and newest-stale come from the drawn points', () => {
    expect(
      linesFromRoute(
        routeHistory({
          calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points: [] }],
          routeSeries: [],
        }),
        order,
      ),
    ).toEqual({ fetch: [], route: [] });
    const { fetch } = linesFromRoute(threeRuns, order);
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
      order,
    );
    expect(newestAllStale(stale.fetch)).toBe(true);
  });
  it('the itinerary heading comes from the api’s cell and carriers', () => {
    expect(itineraryHeading(itineraryHistory())).toBe('LHR→JFK · Sun 14 Mar 2027 to Sun 28 Mar 2027 · BA');
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
    serveRuns();
    server.use(http.get(routeRoute, () => HttpResponse.json(threeRuns)));
    const { findByRole, getByRole, getByText } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    const fetchChart = await findByRole('figure', { name: 'Price by fetch date' });
    const routeChart = getByRole('figure', { name: 'Route-level series (indicative): price by travel date' });
    expect(fetchChart.querySelector('svg[role="application"]')?.textContent).toContain(
      'fetched (Europe/London)',
    );
    expect(routeChart.querySelector('svg[role="application"]')?.textContent).toContain('travel date');
    expect(routeChart.querySelector('svg[role="application"]')?.textContent).toContain('10 Mar 2027');
    expect(
      getByText(/^Each point is one run. A line joins two points only when they come from consecutive runs/),
    ).toBeInTheDocument();
    // why: decision 52 — no fare outside PriceCell, so neither figure is exempt and their axes print no "£".
    for (const f of [fetchChart, routeChart]) {
      expect(f).not.toHaveAttribute('data-scale');
      expect(f.querySelector('svg[role="application"]')?.textContent).not.toContain('£');
    }
    await waitFor(() => expect(fetchChart.querySelector('.recharts-line-curve')).not.toBeNull());
    const curve = fetchChart.querySelector('.recharts-line-curve');
    // why: the 300h run between the 500h and 170h points fetched nothing: two sub-paths, never a segment across it.
    expect(curve?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(curve?.getAttribute('stroke-dasharray')).toBe('6 3');
    expect(routeChart.querySelector('.recharts-line-curve')?.getAttribute('d')?.match(/M/g)).toHaveLength(1);
  });

  it('a stale route-level point is labelled stale beside its indicative amount (decision 54)', async () => {
    const r = routeHistory();
    const [series] = r.routeSeries;
    if (series === undefined) throw new Error('fixture has a route series');
    const [p0, ...rest] = series.points;
    if (p0 === undefined) throw new Error('fixture has a route point');
    const stale = { ...r, routeSeries: [{ ...series, points: [{ ...p0, stale: true }, ...rest] }] };
    server.use(http.get(routeRoute, () => HttpResponse.json(stale)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const table = await findByRole('table', { name: /^SearchApi route-level series, indicative/ });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent?.includes('stale'))).toEqual([true, false, false]);
    expect(rows[0]).toHaveAttribute('data-indicative');
  });

  it('a route-level travel date between two missing dates still shows as a dot (ui-r2-008)', async () => {
    const lone = routeHistory({
      calendarSeries: [],
      routeSeries: [
        {
          providerId: 'searchapi',
          cabin: 'economy',
          points: ['2027-03-10', '2027-03-12', '2027-03-14'].map((date) => ({
            date,
            pricePence: 38000,
            fetchedAt: fetchPoint(2, 1).at,
            providerId: 'searchapi',
            sourceKind: 'scraped-search',
            stale: false,
          })),
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(lone)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const chart = await findByRole('figure', {
      name: 'Route-level series (indicative): price by travel date',
    });
    await waitFor(() => expect(chart.querySelectorAll('.recharts-line-dots circle')).toHaveLength(3));
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
    const calendarTable = await findByRole('table', {
      name: /Aviasales cache · economy · cheapest calendar price/,
    });
    const rows = within(calendarTable).getAllByRole('row').slice(1);
    expect(within(calendarTable).getAllByTestId('provenance')).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('cheapest of the rows read');
    expect(rows[0]).toHaveTextContent('cheapest searched cell LHR→JFK Sun 21 Mar–Sun 4 Apr');
    expect(rows[0]).toHaveTextContent('a different cell from the previous point');
    expect(rows[1]).toHaveTextContent('stale');
    const routeTable = getByRole('table', { name: /^SearchApi route-level series, indicative/ });
    expect(
      within(routeTable).getAllByText(
        'Google Flights via SearchApi · indicative route-level series · cabin not stated · fetched 2h ago · provider age unknown',
      ),
    ).toHaveLength(3);
    expect(routeTable).toHaveTextContent('Wed 10 Mar 2027');
    // why: decision 54 — a route-level point carries "stale" by fetch age; this fixture's are fresh.
    expect(routeTable).not.toHaveTextContent('stale');
    expect(within(routeTable).queryAllByTestId('provenance')).toHaveLength(0);
  });

  it('the header names the definition’s runs from the executions list the status bar uses, never the calendar (decision 52)', async () => {
    const paths: string[] = [];
    serveRuns();
    server.use(
      http.get(routeRoute, () => HttpResponse.json(threeRuns)),
      http.get(`${API}/definitions/:id/calendar`, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
    );
    const { findByRole, findByText, getByText } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    await findByRole('figure', { name: 'Price by fetch date' });
    expect(await findByText(COPY.spanExecutions(4))).toBeInTheDocument();
    expect(getByText('3 runs shown, 23 Sep 2026 to 14 Oct 2026')).toBeInTheDocument();
    expect(getByText(/run started 14 Oct 2026 \d\d:00 Europe\/London/)).toBeInTheDocument();
    expect(paths).toEqual([]);
  });

  it('itinerary mode names the trip from the api, on a fresh load, and badges unconfirmed prices inside their PriceCell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(itineraryRoute, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(itineraryHistory());
      }),
    );
    // why: decision 52, review prov-005 — no Results row is cached (a bookmark): the api's cell names the trip.
    const { findByRole, getByText } = renderWithProviders(
      <HistoryView definition={definition({ destinationNotes: { JFK: 'onward leg not included' } })} />,
      { search: '?view=history&hash=hash-verified-1' },
    );
    const unconfirmed = await findByRole('table', {
      name: /price not confirmed by the final step: every point/,
    });
    // why: prov-r2-010 — the badge sits inside each unconfirmed price, first, as everywhere else.
    for (const cell of within(unconfirmed).getAllByTestId('price-cell'))
      expect(cell).toHaveTextContent('price not confirmed by the final step');
    const confirmed = await findByRole('table', { name: /Example Travel: every point/ });
    expect(within(confirmed).getAllByTestId('price-cell')[0]).not.toHaveTextContent('price not confirmed');
    expect(getByText('LHR→JFK · Sun 14 Mar 2027 to Sun 28 Mar 2027 · BA')).toBeInTheDocument();
    expect(unconfirmed).toHaveTextContent('JFK');
    expect(getByText('itinerary hash-verified-1')).toBeInTheDocument();
    expect(unconfirmed).toHaveTextContent('onward leg not included');
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.recharts-line-curve')].map((c) => c.getAttribute('stroke-dasharray')),
      ).toEqual([null, '2 3']),
    );
    expect(paths.at(-1)).toBe('/api/itineraries/hash-verified-1/history');
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

`apps/web/src/state/links.ts`:

```ts
import { hrefWith } from './urlState.js';

/**
 * Links between views, beside WP9's URL state (review arch2-011): Results' expanded row links to History without
 * importing the History view module and its chart library.
 */
export const HISTORY_PARAMS = { hash: 'hash', pair: 'hist.pair' } as const;

/** Link to one itinerary's history (WP9's expanded row); keeps every other URL parameter. */
export function historyHref(itineraryHash: string): string {
  return hrefWith({ view: 'history', [HISTORY_PARAMS.hash]: itineraryHash });
}
```

`apps/web/src/views/History/lines.ts`:

```ts
import {
  type Cabin,
  type Cell,
  cellKeyString,
  type Iata,
  type IsoDateTime,
  type Provenance,
  type ProviderId,
  type SourceKind,
} from '@gmt/core';
import type { ExecutionSummary, ItineraryHistoryResponse, RouteHistoryResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDateLong } from '../../format.js';
import { SERIES_COLOURS } from '../../lib/palette.js';
import { sourceLabelOf } from '../../lib/sources.js';
import { dateMs, instantMs } from '../../lib/time.js';

type CalendarFetchPoint = RouteHistoryResponse['calendarSeries'][number]['points'][number];
type OfferPoint = ItineraryHistoryResponse['series'][number]['points'][number];
/** A point of a route-level series: no cabin, so no full provenance (spec §11); plotted by date. */
export type RoutePoint = RouteHistoryResponse['routeSeries'][number]['points'][number];

/** A fetch-time point: a price with its provenance, or a gap that breaks the line. Priced points always carry provenance. */
export type PlotPoint =
  | {
      kind: 'price';
      t: number;
      at: IsoDateTime;
      /** The run that fetched it: lines join only consecutive runs (plan decision 52). */
      executionId: string;
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
  /** Palette index: the pair's in the overlay, else stable per series key (review ui-r2-009). */
  colour: number;
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
  colour: number;
  points: RoutePlotPoint[];
}

const DAY_MS = 86_400_000;

/** Each parent run's place in the definition's run order, oldest 0 (executions arrive newest first). */
export type RunOrder = ReadonlyMap<string, number>;

/**
 * The definition's run order from the executions list (the status bar's query; plan decision 52). One-cell child runs
 * are not in it: they search one cell, not the route, so a point they fetched is joined to no neighbour.
 */
export function runOrder(executions: ReadonlyArray<Pick<ExecutionSummary, 'id' | 'isChild'>>): RunOrder {
  const parents = executions.filter((e) => !e.isChild).reverse();
  return new Map(parents.map((e, i) => [e.id, i]));
}

/**
 * Sorts by t and inserts a gap between neighbours that `joined` refuses, so the chart (connectNulls off) breaks the
 * line there. A line between two points never implies a price between them; the chart caption says so.
 */
export function withBreaks<P extends { t: number }, G>(
  points: readonly P[],
  joined: (a: P, b: P) => boolean,
  gap: (t: number) => G,
): Array<P | G> {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Array<P | G> = [];
  let prev: P | null = null;
  for (const p of sorted) {
    if (prev !== null && !joined(prev, p)) out.push(gap(prev.t + (p.t - prev.t) / 2));
    out.push(p);
    prev = p;
  }
  return out;
}

/** Plan decision 52: two points join only when their runs are consecutive runs of the definition, never by time gap. */
export function consecutiveRuns(order: RunOrder) {
  return (a: { executionId: string }, b: { executionId: string }): boolean => {
    const i = order.get(a.executionId);
    const j = order.get(b.executionId);
    return i !== undefined && j !== undefined && j === i + 1;
  };
}

const fetchGap = (t: number): PlotPoint => ({ kind: 'gap', t, pricePence: null });
const routeGap = (t: number): RoutePlotPoint => ({ kind: 'gap', t, pricePence: null });
// why: a route-level series is daily (spec §7 route_price_history); a missing travel date breaks the line.
const nextDay = (a: { t: number }, b: { t: number }) => b.t - a.t <= DAY_MS;

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

const cabinName = (c: Cabin | 'unknown') =>
  c === 'unknown' ? COPY.historyView.cabinNotStated : COPY.cabinName[c];
const prefixed = (pair: string | null, name: string) =>
  pair === null ? name : COPY.historyView.pairPrefix(pair, name);

/**
 * Route history (spec §11 History): the calendar series per provider and cabin at fetchedAt, one point per run (the
 * pair's minimum across its cells, carrying that cell), and the route-level series per provider and cabin by travel
 * date, named by its provider (plan decision 52). Colours are set by `assignColours`.
 */
export function linesFromRoute(
  resp: RouteHistoryResponse,
  order: RunOrder,
  pair: string | null = null,
): { fetch: PlotLine[]; route: RouteLine[] } {
  const H = COPY.historyView;
  const fetch: PlotLine[] = resp.calendarSeries
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const priced = s.points.map(
        (p: CalendarFetchPoint): Extract<PlotPoint, { kind: 'price' }> => ({
          kind: 'price',
          t: instantMs(p.at),
          at: p.at,
          executionId: p.executionId,
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
        key: `${pair ?? ''}calendar:${s.providerId}:${s.cabin}`,
        kind: 'calendar',
        providerId: s.providerId,
        name: prefixed(pair, H.calendarSeries(sourceOf(s.points), cabinName(s.cabin))),
        colour: 0,
        points: markCellChanges(withBreaks(priced, consecutiveRuns(order), fetchGap)),
      };
    });
  const route: RouteLine[] = resp.routeSeries
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      key: `${pair ?? ''}route:${s.providerId}:${s.cabin}`,
      providerId: s.providerId,
      cabin: s.cabin,
      name: prefixed(pair, H.routeSeries(COPY.provider[s.providerId], cabinName(s.cabin))),
      colour: 0,
      points: withBreaks(
        s.points.map(
          (p): RoutePlotPoint => ({ kind: 'price', t: dateMs(p.date), pricePence: p.pricePence, route: p }),
        ),
        nextDay,
        routeGap,
      ),
    }));
  return { fetch, route };
}

/**
 * Itinerary history: per provider and seller, one solid series of confirmed prices and one dotted series of prices
 * the final step did not confirm (plan decision 38), both at fetchedAt and joined only across consecutive runs.
 */
export function linesFromItinerary(resp: ItineraryHistoryResponse, order: RunOrder): PlotLine[] {
  const H = COPY.historyView;
  const joined = consecutiveRuns(order);
  const lines = resp.series.flatMap((s) => {
    const toPlot = (p: OfferPoint): Extract<PlotPoint, { kind: 'price' }> => ({
      kind: 'price',
      t: instantMs(p.at),
      at: p.at,
      executionId: p.executionId,
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
    const out: PlotLine[] = [];
    if (confirmed.length > 0) {
      out.push({
        key: `offer:${s.providerId}:${s.seller}`,
        kind: 'offer',
        providerId: s.providerId,
        name: H.offerSeries(sourceOf(confirmed), s.seller),
        colour: 0,
        points: withBreaks(confirmed.map(toPlot), joined, fetchGap),
      });
    }
    if (unconfirmed.length > 0) {
      out.push({
        key: `offer-unconfirmed:${s.providerId}:${s.seller}`,
        kind: 'offer-unconfirmed',
        providerId: s.providerId,
        name: H.offerUnconfirmedSeries(sourceOf(unconfirmed), s.seller),
        colour: 0,
        points: withBreaks(unconfirmed.map(toPlot), joined, fetchGap),
      });
    }
    return out;
  });
  return assignColours(lines);
}

/** Colour by the series key's place among the keys shown (sorted), so a series keeps its colour as data refreshes. */
export function assignColours<L extends { key: string; colour: number }>(lines: readonly L[]): L[] {
  const keys = [...new Set(lines.map((l) => l.key))].sort();
  return lines.map((l) => ({ ...l, colour: keys.indexOf(l.key) }));
}

type Pair = { origin: Iata; destination: Iata };
const pairKey = (p: Pair) => `${p.origin}-${p.destination}`;

/**
 * Every line of the pairs shown. In the overlay every line of a pair takes the pair's colour (its place in the
 * definition's pairs; at most SERIES_COLOURS.length pairs are drawn) and the kind keeps its dash, so two pairs never
 * share a colour (review ui-r2-009); one pair colours its series by key.
 */
export function linesForPairs(
  responses: ReadonlyArray<RouteHistoryResponse | undefined>,
  pairs: readonly Pair[],
  order: RunOrder,
  overlay: boolean,
): { fetch: PlotLine[]; route: RouteLine[] } {
  const fetch: PlotLine[] = [];
  const route: RouteLine[] = [];
  responses.forEach((r, i) => {
    const pair = pairs[i];
    if (r === undefined || pair === undefined) return;
    const lines = linesFromRoute(r, order, overlay ? pairKey(pair) : null);
    fetch.push(...lines.fetch.map((l) => ({ ...l, colour: i })));
    route.push(...lines.route.map((l) => ({ ...l, colour: i })));
  });
  return overlay ? { fetch, route } : { fetch: assignColours(fetch), route: assignColours(route) };
}

/** True when more series are drawn than the palette has colours, so the chart says colours repeat. */
export function coloursRepeat(lines: ReadonlyArray<{ colour: number }>): boolean {
  return lines.some((l) => l.colour >= SERIES_COLOURS.length);
}

/** The itinerary's heading from the api's own cell and carriers (plan decision 52, review prov-005). */
export function itineraryHeading(resp: Pick<ItineraryHistoryResponse, 'cell' | 'carriers'>): string {
  const c = resp.cell;
  return COPY.historyView.itineraryHeading(
    `${c.origin}→${c.destination}`,
    formatIsoDateLong(c.departureDate),
    formatIsoDateLong(c.returnDate),
    resp.carriers.join(', '),
  );
}

/** What the cross-execution header shows (plan decision 38): how many runs the lines span, first and last fetch. */
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
  return { runs: new Set(priced.map((p) => p.executionId)).size, firstAt: first.at, lastAt: last.at };
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
import { useId } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import {
  formatAxisPounds,
  formatDayShort,
  formatInstantDateLondon,
  formatInstantLondon,
  formatIsoDate,
} from '../../format.js';
import { SERIES_COLOURS, seriesColour } from '../../lib/palette.js';
import { dateOfMs } from '../../lib/time.js';
import {
  coloursRepeat,
  type PlotLine,
  type PlotPoint,
  type RouteLine,
  type RoutePlotPoint,
} from './lines.js';

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
 * only consecutive runs of the definition (plan decision 52); the caption says no price was fetched between two
 * points. No tooltip: with one data array per line on a time axis a shared tooltip cannot pair points reliably, and
 * the tables below are the record of every point with its provenance (PriceCell, decision 52). The price axis prints
 * pounds without "£", so the figure holds no fare outside PriceCell.
 */
export function HistoryChart({ lines, tablesId }: { lines: readonly PlotLine[]; tablesId: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tablesId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {H.fetchChartTitle}
      </figcaption>
      <p className="text-xs">{H.connectorNote}</p>
      {coloursRepeat(lines) ? (
        <p className="text-xs">{H.coloursRepeat(lines.length, SERIES_COLOURS.length)}</p>
      ) : null}
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
                tickFormatter={(v: number) => formatAxisPounds(v)}
                label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Legend verticalAlign="top" />
              {lines.map((l) => {
                const dash = DASH[l.kind];
                return (
                  <Line
                    key={l.key}
                    data={l.points}
                    dataKey={fetchValue}
                    name={l.name}
                    type="linear"
                    connectNulls={false}
                    stroke={seriesColour(l.colour)}
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
 * The indicative route-level series in its own chart, price by travel date (plan decision 38): a different quantity
 * from the fetch-time lines, so never on their axis. Each series is named by its provider and cabin (decision 52).
 * Every point gets a dot, so a travel date between two missing dates still shows (review ui-r2-008).
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
                tickFormatter={(v: number) => formatAxisPounds(v)}
                label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Legend verticalAlign="top" />
              {lines.map((l) => (
                <Line
                  key={l.key}
                  data={l.points}
                  dataKey={routeValue}
                  name={l.name}
                  type="linear"
                  connectNulls={false}
                  stroke={seriesColour(l.colour)}
                  strokeDasharray="1 2"
                  dot={{ r: 2 }}
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
                      unconfirmed={!p.priceConfirmed}
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

`apps/web/src/views/History/RouteTable.tsx`:

```tsx
import { effectiveAge, formatAgeFull, type IsoDateTime } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatIsoDateLong, formatPence } from '../../format.js';
import type { RouteLine } from './lines.js';

const H = COPY.historyView;

/**
 * Every point of one route-level line. Spec §11 exempts these from full provenance (no cabin), so each row shows the
 * amount with its source, "indicative", the cabin as the vendor gave it, the fetched age and "stale" by fetch age
 * (decision 54), never a PriceCell; the
 * row is marked `data-indicative`, the rendered sweep's one exemption besides the legend's scale (plan decision 52).
 * The only History file allowed to format money.
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
            <tr key={p.t} data-indicative>
              <td>{formatIsoDateLong(p.route.date)}</td>
              <td>
                {formatPence(p.pricePence)}
                {/* why: decision 54 — stale by fetch age, labelled like every other price */}
                {p.route.stale ? <span className="ml-1 rounded bg-amber-200 px-1">{COPY.stale}</span> : null}
              </td>
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
import { useId } from 'react';
import { useItineraryHistory, useResults, useRouteHistories } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatInstantDateLondon } from '../../format.js';
import { instantMs } from '../../lib/time.js';
import { useNow } from '../../now.js';
import { HISTORY_PARAMS } from '../../state/links.js';
import { parseBasis } from '../../state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { HistoryChart, HistoryTable, RouteChart } from './HistoryChart.js';
import {
  historySpan,
  itineraryHeading,
  linesForPairs,
  linesFromItinerary,
  newestAllStale,
  type PlotLine,
  type RouteLine,
  runOrder,
} from './lines.js';
import { RouteTable } from './RouteTable.js';

const H = COPY.historyView;
/** The overlay of every pair draws at most this many pairs, one palette colour each (review ui-r2-009). */
export const MAX_OVERLAY_PAIRS = 6;
const ALL = 'all';

type Pair = { origin: Iata; destination: Iata };
const pairKey = (p: Pair) => `${p.origin}-${p.destination}`;

/**
 * History (spec §11 History, §10 history routes; plan decisions 38, 52): route history by pair (or every pair
 * overlaid), itinerary history with ?hash=. Fetch-time series and the indicative route-level series get separate
 * charts; every point is tabled with its provenance; the header names the definition's runs, read from the executions
 * list the status bar uses (the same query, so no second fetch), which also orders the runs lines join across.
 */
export function HistoryView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const params = useSearchParams();
  const tablesId = useId();
  const routeTablesId = useId();
  const raw = params.get(HISTORY_PARAMS.hash);
  const hash = raw === null || raw === '' ? null : raw;
  const pairs: Pair[] = definition.origins.flatMap((origin) =>
    definition.destinations.map((destination) => ({ origin, destination })),
  );
  const pairParam = params.get(HISTORY_PARAMS.pair);
  const overlay = pairParam === ALL;
  const chosen = pairs.find((p) => pairKey(p) === pairParam) ?? pairs[0];
  const shownPairs = overlay ? pairs.slice(0, MAX_OVERLAY_PAIRS) : chosen === undefined ? [] : [chosen];
  const routes = useRouteHistories(shownPairs, definition.cabin, hash === null);
  const itinerary = useItineraryHistory(hash);
  const runs = useResults(definition.id, parseBasis(params.get('basis')));
  const executions = runs.data?.executions ?? [];
  const order = runOrder(executions);

  let fetchLines: PlotLine[] = [];
  let routeLines: RouteLine[] = [];
  let pending: boolean;
  let error: Error | null;
  let destination: Iata | undefined;
  let heading: string | null = null;
  if (hash !== null) {
    pending = itinerary.isPending || runs.isPending;
    error = itinerary.error;
    if (itinerary.data !== undefined) {
      fetchLines = linesFromItinerary(itinerary.data, order);
      // why: decision 52, review prov-005: destination and heading come from the api, on a bookmark too.
      destination = itinerary.data.cell.destination;
      heading = itineraryHeading(itinerary.data);
    }
  } else {
    pending = routes.some((r) => r.isPending) || runs.isPending;
    error = routes.find((r) => r.error !== null)?.error ?? null;
    const lines = linesForPairs(
      routes.map((r) => r.data),
      shownPairs,
      order,
      overlay,
    );
    fetchLines = lines.fetch;
    routeLines = lines.route;
  }
  const span = historySpan(fetchLines);
  const notes = definition.destinationNotes;

  return (
    <section aria-label={H.title} className="flex flex-col gap-4">
      <ViewHeader title={H.title} variant="span" executions={executions} stale={newestAllStale(fetchLines)} />
      {span !== null ? (
        <p className="text-sm">
          {H.spanLine(
            span.runs,
            formatInstantDateLondon(instantMs(span.firstAt)),
            formatInstantDateLondon(instantMs(span.lastAt)),
          )}
        </p>
      ) : null}
      {hash !== null ? (
        <div>
          {heading !== null ? <p className="font-medium">{heading}</p> : null}
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
Expected: PASS. The history file passes 22 tests. Mutation check, once: set `connectNulls` on the fetch-time `Line` to `true`; "breaking only between runs" must fail (one `M`, not two). Restore it.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: history joined by run order, runs from the executions list, api heading, provider-named route series"
```

### Task 10.12: Wire the views into WP9's shell, and link Results to history

**Files:**
- Create: `apps/web/test/app/wp10Wiring.test.tsx`, `apps/web/test/views/results/gapNotSeen.test.tsx`
- Modify (WP9): `apps/web/src/App.tsx`, `apps/web/src/copy.ts` (the calendar placeholder hint goes), `apps/web/src/views/Results/{ExpandedRow,CalendarGapBanner}.tsx`, `apps/web/test/guards.ts`, `apps/web/test/app/shell.test.tsx`, `apps/web/test/copy/renderedSweep.test.tsx`

**Interfaces:**
- Consumes: `App`, `ExpandedRow`, `COPY.placeholder`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`, `historyHref`, `HISTORY_PARAMS` (from `src/state/links.ts`), `navigateTo`.
- Produces: the Calendar, Duration and History views behind WP9's nav; the "price history" link on expanded rows that have an itinerary hash; "not seen in latest search" on the calendar gap's cheapest verified price (decision 54); `renderedCopy` and `poundsOutsidePrices` exported from WP9's `test/guards.ts`.

The wiring test renders each view through `App` on the default handlers, asserts it drew its real content (month tables and legend; a chart figure and table; both history charts), checks that WP9's placeholder text is gone using `COPY.placeholder` itself, and runs WP9's two sweep collectors, which move from the sweep test to `test/guards.ts` so both tests share one copy (review arch2-012). The sweep's `[data-scale]` exemption now covers the calendar legend's scale values only: no fare is exempt, chart tooltips included, and chart axes print no "£" (decision 52).

- [ ] **Step 1: Write the failing test**

`apps/web/test/app/wp10Wiring.test.tsx`:

```tsx
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { COPY } from '../../src/copy.js';
import { ExpandedRow } from '../../src/views/Results/ExpandedRow.js';
import { calendarRow, verifiedRow } from '../fixtures.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { renderWithProviders } from '../render.js';

// why: WP9's sweep collectors, shared through test/guards.ts (review arch2-012), never a second copy here.
const swept = () => ({
  banned: findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST),
  pounds: poundsOutsidePrices(),
});

// The default msw handlers (test/msw/wp10Handlers.ts) serve every WP10 route, so these views render real content.
describe('WP10 views in the shell: no placeholder left, real content, no banned word (spec §11, §9 item 6)', () => {
  it('?view=calendar renders the calendar grid, legend and a priced day', async () => {
    const { findByRole, getByTestId, queryByText } = renderWithProviders(<App />, {
      search: '?view=calendar&def=def-0001',
    });
    expect(await findByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
    expect(getByTestId('calendar-legend')).toBeInTheDocument();
    expect(getByTestId('day-price-block')).toHaveTextContent('£412');
    expect(queryByText(COPY.placeholder)).toBeNull();
    expect(swept()).toEqual({ banned: [], pounds: [] });
  });

  it('?view=duration renders the chart figure and the table', async () => {
    const { findByRole, getByRole, queryByText } = renderWithProviders(<App />, {
      search: '?view=duration&def=def-0001',
    });
    expect(await findByRole('figure', { name: 'Cheapest found by stay length' })).toBeInTheDocument();
    expect(
      getByRole('table', { name: 'Cheapest found per stay length, with provenance' }),
    ).toBeInTheDocument();
    expect(queryByText(COPY.placeholder)).toBeNull();
    expect(swept()).toEqual({ banned: [], pounds: [] });
  });

  it('?view=history renders both charts and their tables', async () => {
    const { findByRole, getByRole, queryByText } = renderWithProviders(<App />, {
      search: '?view=history&def=def-0001',
    });
    expect(await findByRole('figure', { name: 'Price by fetch date' })).toBeInTheDocument();
    expect(
      getByRole('figure', { name: 'Route-level series (indicative): price by travel date' }),
    ).toBeInTheDocument();
    expect(queryByText(COPY.placeholder)).toBeNull();
    expect(swept()).toEqual({ banned: [], pounds: [] });
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

`apps/web/test/views/results/gapNotSeen.test.tsx`:

```tsx
import { within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { CalendarGapBanner } from '../../../src/views/Results/CalendarGapBanner.js';
import { API, calendarGap } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// WP10's edit to WP9's calendar-gap banner (plan decision 54): the cheapest verified price the gap is measured
// against says when the latest search no longer returned it.
describe('calendar-gap cheapest verified (decision 54)', () => {
  it('a cheapest verified price not seen in the latest search says so; a current one does not', async () => {
    const base = calendarGap();
    const cv = base.cheapestVerified;
    if (cv === null) throw new Error('fixture has a cheapest verified price');
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ ...base, cheapestVerified: { ...cv, notSeenInLatest: { ageHours: 30 } } }),
      ),
    );
    const first = renderWithProviders(<CalendarGapBanner definitionId="def-0001" />);
    const banner = await first.findByRole('region', { name: 'Cells to search' });
    const [cheapest, cellPrice] = within(banner).getAllByTestId('price-cell');
    expect(cheapest).toHaveTextContent('not seen in latest search (30h ago)');
    expect(cellPrice).not.toHaveTextContent('not seen in latest search');
    first.unmount();
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(base)));
    const second = renderWithProviders(<CalendarGapBanner definitionId="def-0001" />);
    const current = await second.findByRole('region', { name: 'Cells to search' });
    expect(current).not.toHaveTextContent('not seen in latest search');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/app/wp10Wiring.test.tsx`
Expected: FAIL, 4 of 4: the three view tests time out on `findByRole` (the placeholder renders instead), and the link test fails with `Unable to find an accessible element with the role "link" and name "price history"`. The gap test fails because WP9's banner passes no not-seen hours to its PriceCell.

- [ ] **Step 3: Implement**

`apps/web/src/App.tsx`: the three views replace WP9's placeholder (which stays for Alerts, WP11's) and need a definition like Results:

`src/App.tsx` — find:

```tsx
import { parseView } from './state/view.js';
import { CoverageView } from './views/Coverage/CoverageView.js';
import { DefinitionsView } from './views/Definitions/DefinitionsView.js';
import { Placeholder } from './views/Placeholder.js';
```

`src/App.tsx` — replace with:

```tsx
import { parseView } from './state/view.js';
import { CalendarView } from './views/Calendar/CalendarView.js';
import { CoverageView } from './views/Coverage/CoverageView.js';
import { DefinitionsView } from './views/Definitions/DefinitionsView.js';
import { DurationView } from './views/Duration/DurationView.js';
import { HistoryView } from './views/History/HistoryView.js';
import { Placeholder } from './views/Placeholder.js';
```

`src/App.tsx` — find:

```tsx
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  const needsDefinition = view === 'results' || view === 'coverage';
  return (
```

`src/App.tsx` — replace with:

```tsx
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  const needsDefinition =
    view === 'results' ||
    view === 'coverage' ||
    view === 'calendar' ||
    view === 'duration' ||
    view === 'history';
  return (
```

`src/App.tsx` — find:

```tsx
          {view === 'coverage' && selected !== null ? <CoverageView definition={selected} /> : null}
          {view === 'calendar' || view === 'duration' || view === 'history' || view === 'alerts' ? (
            <Placeholder hint={view === 'calendar' ? COPY.calendarPlaceholderHint : null} />
          ) : null}
          {view === 'definitions' ? <DefinitionsView /> : null}
```

`src/App.tsx` — replace with:

```tsx
          {view === 'coverage' && selected !== null ? <CoverageView definition={selected} /> : null}
          {view === 'calendar' && selected !== null ? (
            // why: a new definition starts with no panel open and its own filter defaults.
            <CalendarView key={selected.id} definition={selected} />
          ) : null}
          {view === 'duration' && selected !== null ? <DurationView definition={selected} /> : null}
          {view === 'history' && selected !== null ? <HistoryView definition={selected} /> : null}
          {view === 'alerts' ? <Placeholder /> : null}
          {view === 'definitions' ? <DefinitionsView /> : null}
```

`apps/web/src/copy.ts`: the placeholder's calendar hint has no reader left.

`src/copy.ts` — find:

```ts
  placeholder: 'This view is not available yet.',
  calendarPlaceholderHint:
    'Until it is, the Results filters slice the window by month: set "Departs on or after" and "Departs on or before".',
  definitionSelectorLabel: 'Search definition',
```

`src/copy.ts` — replace with:

```ts
  placeholder: 'This view is not available yet.',
  definitionSelectorLabel: 'Search definition',
```

`apps/web/src/views/Results/ExpandedRow.tsx`: the "price history" link after the search link, for a row with an itinerary:

`src/views/Results/ExpandedRow.tsx` — find:

```tsx
import { useNow } from '../../now.js';
```

`src/views/Results/ExpandedRow.tsx` — replace with:

```tsx
import { useNow } from '../../now.js';
import { HISTORY_PARAMS, historyHref } from '../../state/links.js';
import { navigateTo } from '../../state/urlState.js';
```

`src/views/Results/ExpandedRow.tsx` — find:

```tsx
        <SearchLink link={row.searchLink} providerId={providerId} />
      </div>
```

`src/views/Results/ExpandedRow.tsx` — replace with:

```tsx
        <SearchLink link={row.searchLink} providerId={providerId} />
        {row.itineraryHash !== null ? (
          <a
            href={historyHref(row.itineraryHash)}
            onClick={navigateTo({ view: 'history', [HISTORY_PARAMS.hash]: row.itineraryHash })}
            className="block underline"
          >
            {COPY.historyView.rowLink}
          </a>
        ) : null}
      </div>
```

`apps/web/src/views/Results/CalendarGapBanner.tsx`: the cheapest verified price passes its not-seen hours (decision 54):

`src/views/Results/CalendarGapBanner.tsx` — find:

```tsx
            truncated={cv.truncated}
            destination={cv.cell.destination}
```

`src/views/Results/CalendarGapBanner.tsx` — replace with:

```tsx
            truncated={cv.truncated}
            notSeenInLatestHours={cv.notSeenInLatest?.ageHours ?? null}
            destination={cv.cell.destination}
```

`apps/web/test/app/shell.test.tsx`: Calendar now renders its month tables, and only Alerts is a placeholder:

`test/app/shell.test.tsx` — find:

```tsx
    expect(window.location.search).toBe('?view=calendar&def=def-0001&f.stops=1');
    expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
```

`test/app/shell.test.tsx` — replace with:

```tsx
    expect(window.location.search).toBe('?view=calendar&def=def-0001&f.stops=1');
    // why: WP10 replaced the placeholder; the default msw handlers serve the calendar.
    expect(await screen.findByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
```

`test/app/shell.test.tsx` — find:

```tsx

  it.each(['duration', 'history', 'alerts'])(
    '%s is a placeholder that names no work package',
    async (view) => {
      renderWithProviders(<App />, { search: `?view=${view}` });
      expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
      expect(screen.queryByText(/WP1/)).toBeNull();
    },
  );
```

`test/app/shell.test.tsx` — replace with:

```tsx

  it.each(['alerts'])('%s is a placeholder that names no work package', async (view) => {
    renderWithProviders(<App />, { search: `?view=${view}` });
    expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
    expect(screen.queryByText(/WP1/)).toBeNull();
  });
```

`test/app/shell.test.tsx` — find:

```tsx
    await screen.findByLabelText('Search definition');
    await screen.findByText('This view is not available yet.');
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
```

`test/app/shell.test.tsx` — replace with:

```tsx
    await screen.findByLabelText('Search definition');
    await screen.findByRole('table', { name: 'Mar 2027' });
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
```

`apps/web/test/guards.ts`: WP9's sweep collectors, exported for both tests, with the exemption reworded (no fare is exempt):

`test/guards.ts` — find:

```ts
  return problems;
}
```

`test/guards.ts` — replace with:

```ts
  return problems;
}

// The rendered-copy sweep's two collectors, shared by WP9's sweep and WP10's wiring test (review arch2-012).

/** Every visible string plus the attributes a screen reader or tooltip shows. */
export function renderedCopy(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')].flatMap(
    (el) => ['title', 'aria-label', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

/**
 * Every "£" in the DOM sits inside a PriceCell (a fare, with provenance), a [data-cost] element (a cost
 * or a cap), a [data-scale] element (WP10: the heatmap legend's band ranges, scale values only; no fare is ever
 * exempt, chart tooltips included, and chart axes print no "£": plan decision 52), a [data-indicative] row (WP10:
 * a route-level series, exempt from full provenance by spec §11) or a form label ("Max price (£)"), on every view
 * (reviews tsr-003, prov-r2-007).
 */
export function poundsOutsidePrices(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const outside: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const host = n.parentElement;
    if (
      n.textContent?.includes('£') &&
      host?.closest('[data-testid="price-cell"], [data-cost], [data-scale], [data-indicative], label') ===
        null
    ) {
      outside.push(n.textContent);
    }
  }
  return outside;
}
```

`apps/web/test/copy/renderedSweep.test.tsx`: the collectors come from `test/guards.ts`:

`test/copy/renderedSweep.test.tsx` — find:

```tsx
} from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

/** Every visible string plus the attributes a screen reader or tooltip shows. */
function renderedCopy(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')].flatMap(
    (el) => ['title', 'aria-label', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

/**
 * Every "£" in the DOM sits inside a PriceCell (a fare, with provenance), a [data-cost] element (a cost
 * or a cap) or a form label ("Max price (£)"), on every view (reviews tsr-003, prov-r2-007).
 */
function poundsOutsidePrices(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const outside: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const host = n.parentElement;
    if (
      n.textContent?.includes('£') &&
      host?.closest('[data-testid="price-cell"], [data-cost], label') === null
    ) {
      outside.push(n.textContent);
    }
  }
  return outside;
}
```

`test/copy/renderedSweep.test.tsx` — replace with:

```tsx
} from '../fixtures.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/app test/copy test/views test/components test/lib test/tz`
Expected: PASS: the wiring file 4 tests, the gap file 1, WP9's shell, copy (catalogue, source guard, rendered sweep over every view, which now meets the real WP10 views with no "£" outside a PriceCell, a cost, the legend's scale or an indicative row) and every view test.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp10: calendar, duration and history in the shell; results link to itinerary history"
```

### Task 10.13: Playwright smoke in fixture mode (spec §9 item 6)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/{smoke.spec.ts,selectors.ts,prepare-db.mjs}`, `apps/web/test/e2e/selectors.test.tsx`
- Modify (WP9): `apps/web/vite.config.ts` (proxy target), `apps/web/tsconfig.test.json` (`include`); root `.gitignore`

**Interfaces:**
- Consumes: `pnpm --filter @gmt/api start` (WP8); fixture mode per spec §5.5 (WP4b's wiring reaches the fixture host through http-kit's gated `inProcessHosts`, plan decision 7); WP9's `COPY`, the Definitions form's advanced fold (`COPY.advanced`) with its checkbox ids `p-d-<providerId>` and `p-v-<providerId>`, its "Import example (…)", "Create and confirm about …" and "Run now (…)" buttons, and the Results headline led by `COPY.headlineLead`.
- Produces: `pnpm --filter @gmt/web e2e`, excluded from `pnpm test` (vitest `exclude: ['e2e/**']`; the root runs vitest only).

The smoke drives the real api in fixture mode and the built SPA through `vite preview`, whose proxy is WP9's `server.proxy` pointed at `GMT_API_ORIGIN`. The api environment meets `syntheticAllowed` (spec §5.5): `NODE_ENV=development`, `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake`, a `.fixture.db` path, no `IN_CONTAINER`; it binds loopback (no auth, spec §4), disables auto-resume and raises the confirmation threshold so the run starts without a cost prompt. The desktop project runs the whole flow: Results headline and banner, then the Calendar (month tables, one tab stop on a day button, a priced day with the synthetic badge, the legend, a computed `outline-style` on the day after keyboard focus), the Duration figure and table, and History's fetch-time figure and table, each naming the synthetic source. The phone project (375 × 812, after the desktop one) checks one month table, the month buttons, the legend, no horizontal page scroll, no day button whose `scrollWidth` exceeds its `clientWidth`, and a phone face whose PriceCell names the fixture provider (review ui-r2-001).

The smoke needs WP8's api and a browser, so `pnpm test` cannot run it; its calendar selectors therefore live in `e2e/selectors.ts`, and `test/e2e/selectors.test.tsx` renders the calendar under jsdom at both widths and asserts each one matches the markup (reviews arch2-001, ui-r2-002: the round-1 smoke targeted an ARIA grid the components no longer draw).

- [ ] **Step 1: Write the failing test**

`apps/web/e2e/selectors.ts`:

```ts
import { COPY } from '../src/copy.js';

/**
 * What the Playwright smoke looks for in the calendar, shared with the jsdom test that proves each one matches the
 * markup (test/e2e/selectors.test.tsx; review arch2-001, ui-r2-002): the smoke needs a running api, so it cannot run in
 * `pnpm test`, but its selectors can never drift from the component again.
 */
export const SMOKE = {
  /** Each month is a table captioned by its month name ("Mar 2027"; plan decision 51). */
  monthTable: /^[A-Z][a-z]{2} \d{4}$/,
  /** The roving tab stop: exactly one day button carries tabindex 0. */
  dayTabStop: 'button[data-date][tabindex="0"]',
  /** Every day button. */
  dayButton: 'button[data-date]',
  /** A priced day on a desktop, with WP9's compact PriceCell inside. */
  pricedDay: '[data-testid="day-price-block"]',
  /** A priced day at phone width: PriceCell's face (plan decision 52). */
  pricedDayPhone: '[data-testid="day-price-face"]',
  nextMonth: COPY.calendarView.nextMonth,
} as const;
```

`apps/web/test/e2e/selectors.test.tsx`:

```tsx
import { within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SMOKE } from '../../e2e/selectors.js';
import { COPY } from '../../src/copy.js';
import { CalendarView } from '../../src/views/Calendar/CalendarView.js';
import { API, definition } from '../fixtures.js';
import { calendarResponse, cellAt, day, disc, priceAt, provSyntheticAt } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';

// The Playwright smoke needs WP8's api and a browser, so `pnpm test` cannot run it; this proves its calendar
// selectors match the markup the components render (review arch2-001, ui-r2-002), at both widths it checks.
const synthetic = (d: string) =>
  day(d, {
    cheapestCalendar: priceAt(30000, provSyntheticAt(1), false, cellAt(d, 14)),
    discovery: [disc('fixture', { priced: 48 })],
  });
const serve = () =>
  server.use(
    http.get(`${API}/definitions/:id/calendar`, () =>
      HttpResponse.json(calendarResponse([synthetic('2027-03-14'), synthetic('2027-04-02')])),
    ),
  );
const fixtureDefinition = () =>
  definition({
    providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 24 } },
  });

describe('the Playwright smoke’s calendar selectors match the rendered calendar', () => {
  it('desktop: month tables, one tab stop on a day button, a priced day with the synthetic badge', async () => {
    serve();
    const { findAllByRole } = renderWithProviders(<CalendarView definition={fixtureDefinition()} />);
    const tables = await findAllByRole('table', { name: SMOKE.monthTable });
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['Mar 2027', 'Apr 2027']);
    const stops = document.querySelectorAll(SMOKE.dayTabStop);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.tagName).toBe('BUTTON');
    expect(document.querySelectorAll(SMOKE.dayButton)).toHaveLength(2);
    const priced = document.querySelector(SMOKE.pricedDay);
    expect(priced).toHaveTextContent(COPY.providerShort.fixture);
  });

  it('phone: one month table, the next-month button, a phone face whose PriceCell title names the fixture', async () => {
    setViewportWidth(375);
    serve();
    const { findAllByRole, getByRole } = renderWithProviders(
      <CalendarView definition={fixtureDefinition()} />,
    );
    expect(await findAllByRole('table', { name: SMOKE.monthTable })).toHaveLength(1);
    expect(getByRole('button', { name: SMOKE.nextMonth })).toBeInTheDocument();
    const face = document.querySelector(SMOKE.pricedDayPhone);
    if (!(face instanceof HTMLElement)) throw new Error('no phone face');
    expect(face).toHaveTextContent('£');
    expect(within(face).getByTestId('price-cell').getAttribute('title')).toMatch(
      new RegExp(COPY.provider.fixture),
    );
    expect(document.querySelector(SMOKE.pricedDay)).toBeNull();
  });
});
```

`apps/web/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { COPY } from '../src/copy.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6: one Playwright smoke in fixture mode, through the real api and the built SPA. Every price here is
// synthetic, and every view must say so beside the red banner (spec §5.5).
test('fixture mode: import, run, then Results, Calendar, Duration and History show synthetic prices with provenance', async ({
  page,
}) => {
  await page.goto('/?view=definitions');
  await page.getByRole('button', { name: /^Import example/ }).click();
  // why: the provider checkboxes sit in WP9's advanced fold.
  await page.getByText(COPY.advanced).click();
  // why: the example JSON names the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const prefix of ['p-d-', 'p-v-']) {
    for (const box of await page.locator(`input[type="checkbox"][id^="${prefix}"]`).all())
      await box.uncheck();
    await page.locator(`#${prefix}fixture`).check();
  }
  await page.getByRole('button', { name: /^Create and confirm about/ }).click();
  await page.getByRole('button', { name: /^Run now/ }).click();

  const headline = page.locator('p', { hasText: COPY.headlineLead }).first();
  await expect(async () => {
    await page.goto('/?view=results');
    await expect(headline).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(headline).toContainText(COPY.source.synthetic);
  await expect(headline).toContainText(/ago|just now/);
  const banner = page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/bg-red-700/);

  // View B: month tables of day buttons, a priced day carrying the synthetic badge, visible focus in a real browser.
  await page.goto('/?view=calendar');
  await expect(page.getByRole('table', { name: SMOKE.monthTable }).first()).toBeVisible();
  const priced = page.locator(SMOKE.pricedDay).first();
  await expect(priced).toContainText(COPY.providerShort.fixture);
  await expect(page.getByTestId('calendar-legend')).toBeVisible();
  await expect(banner).toBeVisible();
  await expect(page.locator(SMOKE.dayTabStop)).toHaveCount(1);
  // why: focus-visible applies to keyboard focus, so the tab stop is reached with Tab, not focus().
  await page.locator(SMOKE.dayTabStop).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(SMOKE.dayTabStop)).toHaveCSS('outline-style', 'solid');

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

test('at 375px the calendar shows one month of compact days, nothing spilling out of its cell @phone', async ({
  page,
}) => {
  await page.goto('/?view=calendar');
  await expect(page.getByRole('table', { name: SMOKE.monthTable })).toHaveCount(1);
  await expect(page.getByRole('button', { name: SMOKE.nextMonth })).toBeVisible();
  await expect(page.getByTestId('calendar-legend')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // why: ui-r2-001 — every day's content stays inside its button, and the amount is never cut off.
  const spilled = await page
    .locator(SMOKE.dayButton)
    .evaluateAll((days) =>
      days.filter((d) => d.scrollWidth > d.clientWidth).map((d) => d.getAttribute('data-date')),
    );
  expect(spilled).toEqual([]);
  const face = page.locator(SMOKE.pricedDayPhone).first();
  await expect(face).toContainText('£');
  await expect(face.getByTestId('price-cell')).toHaveAttribute('title', new RegExp(COPY.provider.fixture));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/e2e`
Expected: PASS, 2 tests: the selectors match the calendar Tasks 10.6 and 10.8 built (a mutation, once: change `dayTabStop` to `td[role="gridcell"][tabindex="0"]`, the round-1 selector, and the desktop test fails with `AssertionError: expected  to have a length of 1 but got +0`; restore it).

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

`apps/web/vite.config.ts` (WP9):

`vite.config.ts` — find:

```ts
 */
export default defineConfig({
```

`vite.config.ts` — replace with:

```ts
 */
/**
 * The api the dev and preview servers proxy /api to. The Playwright smoke (WP10) points `vite preview` at its own
 * fixture-mode api with GMT_API_ORIGIN; dev keeps the default. preview.proxy inherits server.proxy.
 */
const API_ORIGIN = process.env.GMT_API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
```

`vite.config.ts` — find:

```ts
    // why: no changeOrigin, so the api sees Host localhost:5173, which spec §4 allowlists in development.
    proxy: { '/api': { target: 'http://localhost:3000' } },
  },
```

`vite.config.ts` — replace with:

```ts
    // why: no changeOrigin, so the api sees Host localhost:5173, which spec §4 allowlists in development.
    proxy: { '/api': { target: API_ORIGIN } },
  },
```

`apps/web/tsconfig.test.json` (WP9's test project, which `pnpm --filter @gmt/web typecheck` runs): the smoke and its config are type-checked under the same strict rules.

`tsconfig.test.json` — find:

```json
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`tsconfig.test.json` — replace with:

```json
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts", "e2e", "playwright.config.ts"]
}
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
Expected: the workspace builds, both servers start, and the reporter prints `2 passed` (desktop, then phone). Until WP8's api is on `main` this step cannot run; `test/e2e/selectors.test.tsx` keeps the selectors honest meanwhile.

Run: `pnpm -r typecheck`
Expected: clean, including `e2e/smoke.spec.ts` and `playwright.config.ts`.

Run: `pnpm test`
Expected: no file under `apps/web/e2e/` is listed.

- [ ] **Step 5: Commit**

```bash
git add apps/web .gitignore && git commit -m "wp10: Playwright smoke in fixture mode with selectors proven under jsdom, 375px overflow check (spec §9 item 6)"
```

## 9. Pinned review-focus tests

- **Review focus 3** (plan: "The browser runs outside Europe/London … a day never shifts by one. Owner: WP10"):
  - **Task 10.9**, `test/tz/dates.tz.test.tsx`, under `America/Los_Angeles` and `Asia/Tokyo`, in-process per `describe.each` block and as whole processes via `pnpm --filter @gmt/web run test:tz` (`GMT_TEST_TZ` copied to `process.env.TZ` in `test/setup-tz.ts`). In each zone: the zone took effect; the negative control shows a naive `Date` moves the day (and, west of Greenwich, mislabels the US DST day); the US and UK DST days and the leap day keep their date and weekday; the calendar grid puts each day under its own weekday and month; WP9's Results renders departure and return from their strings. A recorded manual mutation turns the suite red.
  - **Task 10.2**, `test/lib/noDateParsing.test.ts`, fails on any `new Date(`, `Date(` call, local date getter, `toLocale*String(` or date-library import anywhere in `apps/web/src` outside WP9's `now.tsx`, scanning whole files with comments blanked; its planted cases (a call split across lines, a commented one, epoch arithmetic that must pass) keep it from being vacuous.

## 10. Definition of done

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/core test` | Every core test passes at core's 100% thresholds, including `test/api-contract/wp10.test.ts`. |
| `pnpm --filter @gmt/web typecheck` | Exit 0 for `tsconfig.json` and `tsconfig.test.json` (which now covers `e2e/` and `playwright.config.ts`). |
| `pnpm --filter @gmt/web test` | Every web test passes. Coverage meets the package floors (lines, functions, statements ≥ 70%, branches ≥ 60%), WP9's 100% files, and the WP10 floors on `src/lib/**` and `src/views/{Calendar,Duration,History}/*.ts` (lines, functions, statements ≥ 95%, branches ≥ 85%). Then `test:tz` prints two passing runs (Los Angeles, Tokyo). |
| `pnpm test` | The root run passes and lists no `e2e/` file. |
| `pnpm --filter @gmt/web exec vitest run test/copy` | PASS: catalogue (every new function sampled, no banned word, "verified" only on allowed paths), source guard (no literal copy; money only in its files), rendered sweep over every view (no banned word; "£" only in a PriceCell, a cost, the calendar legend's scale or an indicative row). |
| `pnpm --filter @gmt/web exec vitest run test/e2e` | PASS: the smoke's calendar selectors match the rendered markup at both widths. |
| `pnpm --filter @gmt/web e2e` | `2 passed`. |
| `pnpm lint` | Biome reports no errors. |
| `pnpm -r typecheck` | Exit 0, including `@gmt/db` (its `HistoryPoint` is unchanged). |
| `pnpm boundaries` | Exit 0: `@gmt/web` imports only `@gmt/core` among workspace packages; no `process.env` under `apps/web/src`; no place name in an `apps/web/src` string literal outside `example.ts` (WP10's literals need no new entry in the committed non-airport word list); no lint or type-check suppression comment in any package (decision 49). |
| `pnpm casts` | Exit 0: no `as` except `as const`, and no angle-bracket assertion, in any WP10 file (decision 48). |

**Assembly record (2026-10-17, scratch worktree of `main` at `697ad9d`; decision 53 at `a670b49` changes only the plan and WP8's brief).** Preconditions applied first: WP7's `packages/core` and `packages/db` changes of Tasks 7.1, 7.4 (`NoPricedOptionsReason`, its core type test), 7.8, 7.13 and 7.18 with their core tests, and `scripts/check-casts.mjs` with the `casts` script (Task 7.20); then every code block of WP9's committed brief (round 3) in task order. Then this brief, task by task. The red steps quoted were re-run where rounds 2 and 3 changed them: Task 10.1 fails 6 of 6 as quoted against the baseline schema, and the face tests of Task 10.6 fail as quoted against WP9's PriceCell. The decision-54 pass was re-assembled from the committed round-2 brief on `main` at `6c27a94` the same way. Final state: `pnpm -r typecheck` exit 0; `pnpm lint` clean (539 files); `pnpm boundaries` exit 0 with no word-list change; `pnpm casts` 374 files, 0 casts; `pnpm --filter @gmt/core test` 48 files, 741 tests, every core threshold met; `pnpm --filter @gmt/web test` 36 files, 389 tests (WP10's 18 files hold 164), coverage 96.5% statements, 90.8% branches, 94.4% functions and 97.0% lines overall with every floor met (WP9's PriceCell at 100% with the face tests), then `test:tz` 100 tests in each zone. The recorded mutations turn their tests red. Task 10.13's Playwright run was not executed (WP8's api is not on `main`); its config and spec are type-checked and linted, and its calendar selectors pass the jsdom test. Every whole-file code block in this brief is byte-identical to the assembled file, and every find text occurs exactly once in WP9's assembled file.

## 11. Open questions

None. The Playwright run (Task 10.13) is the one step not yet executed end to end; it needs WP8's api.

## 12. Changes outside WP10's own files

- `packages/core/src/api-contract/{results,index}.ts` and WP9's `test/fixtures.ts` (Task 10.1): `calendarQuerySchema` on the calendar route (decision 53); decision 54's `notSeenInLatest`, `superseded` and route-point `stale`; `verification.unconfirmedCells` (decision 51); decision 38's duration fields with `searched` counts; decision 42's `verify`, `priceConfirmed` and `historyPointResponseSchema`; decision 52's itinerary `cell`, `carriers` and point `executionId`.
- WP9's `src/format.ts`, `src/components/{ViewHeader,StatusBar}.tsx`, `test/format.test.ts`, `test/components/statusBar.test.tsx`, `test/views/coverage.test.tsx` (Task 10.2): `formatRunInstant` replaces `formatInstantUtc` (decision 52); the grid, instant and axis forms on the one table.
- WP9's `src/api/{types,endpoints,queries}.ts`, `src/copy.ts`, `test/msw/handlers.ts`, `test/copy/catalogue.test.ts` (Task 10.3): WP10 routes and hooks (the calendar's destination, `skipToken`), `useExecutionActions`' refresh list, copy with the typed reason map, default handlers, SAMPLES and the "verified" allowlist.
- WP9's `src/components/PriceCell.tsx`, `src/copy.ts` (`priceMarkGlyph`, `superseded`), `test/copy/sourceGuard.test.ts` (Task 10.6): the `face` and `superseded` props; the legend and `RouteTable.tsx` may format money (scale values and the indicative series, never fares); Recharts' `dataKey`, `scale` and `verticalAlign` and `data-*` attributes are non-copy props.
- WP9's `vitest.config.ts` and WP0's `package.json` (Task 10.9): `pool: 'forks'` pinned with its reason, `exclude`, setup order, view-model floors; `test`, `test:tz`, `e2e`, `e2e:install`.
- WP9's `src/App.tsx`, `src/copy.ts` (the unused calendar hint), `src/views/Results/ExpandedRow.tsx` (the history link from `src/state/links.ts`), `src/views/Results/CalendarGapBanner.tsx` (decision 54's not-seen note on the cheapest verified price), `test/guards.ts` (the shared sweep collectors), `test/app/shell.test.tsx`, `test/copy/renderedSweep.test.tsx` (Task 10.12).
- WP9's `vite.config.ts`, `tsconfig.test.json`, and the root `.gitignore` (Task 10.13).

## 13. For the plan and the WP8 brief (not yet recorded there)

1. **Contract details WP8 fills that no decision spells out** (decisions 51 to 53 name the fields; these are the shapes and rules):
   - The calendar route's query is `calendarQuerySchema` (`destination?: Iata`) in `ROUTES`; with it every day's `discovery` buckets and totals, `verification` counts, the three minimums and `unconfirmedCells` cover that destination's cells only. WP8's refreshed brief still says the route takes no query and counts `unconfirmedCells` over every destination (its §13 item 2); decision 53 supersedes both, and `byDestination` stays as it is (the web no longer reads it).
   - `durationAnalysisResponseSchema.byNights[].searched` is a count per series, `{ searched, total }`: verification `total` is the selected cells of that nights value and `searched` those with a `priced`, `empty` or `no_data` verification outcome (latest parent or a completed child); each discovery provider's `total` is every cell of that nights value and `searched` those its own outcome in the latest parent answered. WP8's brief describes booleans.
   - `itineraryHistoryResponseSchema` gains `cell` and `carriers` (the itinerary's own, from its stored row), and each point `executionId` (the run whose observation it is), so History names the trip on a bookmark and joins only consecutive runs (decision 52).
   - Decision 54's marks on WP10's shapes: `notSeenInLatest` (`{ ageHours } | null`, as on a results row) on the calendar day's `cheapestVerified` and `cheapestPartiallyVerified`, the duration's `minVerified` and the calendar gap's `cheapestVerified`; `superseded: boolean` on the day's `cheapestCalendar`, the duration's `minCalendar[].price` and the cell detail's `calendarPrices[]`; `stale` by fetch age on each route-level response point. The minima are chosen among current prices first (decision 54's ranking), so a superseded calendar price is a day's or a stay length's minimum only when no current one exists. Superseded calendar rows in `/results` and the calendar gap's `cells[].calendar` (WP9's views) carry no field yet; WP8 and WP9 own those.
   - `resultsResponseSchema.executions`, which History reads as the definition's run order, must list every parent run of the definition, newest first, including runs whose rows no longer show; a run left out would join the points on either side of it.
2. **Spec wording at the next revision:** §9 item 6 and the §16 table say "five-way" day marker where §3 defines six buckets; §11 View B's glyph list gains `skipped`, counts and "price not confirmed", its quintile scale the flat cases, and its destination filter the api parameter (decisions 38, 53); §11 View C's gaps gain "searched k of N" and "no class-verified price"; §11 History gains the separate route-level chart named by provider and the run-order join (decision 52); §11's "provenance on every price, visible without hover" names decision 46's compact day form and decision 52's phone face.
