---
wp: 9
title: "web: shell, status bar, Definitions, Results (View A), Coverage (View D), Providers"
owner: sonnet
depends_on: [8]
spec_sections: ["§11", "§6.5", "§6.9", "§3", "§5.5", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, ui-reviewer, persona-flexible-traveller, provenance-auditor, product-owner, security-reviewer]
status: reviewed
---

# WP9 — web: shell, status bar, Definitions, Results, Coverage, Providers

## 1. Goal

Ship the Vite + React 19 single-page app under `apps/web` with the shell, the status bar, the Definitions form, View A (Results), View D (Coverage) and the Providers view, every price in the DOM rendered through one provenance-checking component, so that a price without provenance cannot reach the screen and no price looks more certain than its data.

## 2. Scope

**In**

- Core additions the views need (Task 9.0, decisions 36 and 42): `truncated: boolean` on `priceCellSchema` and `resultRowSchema`; `expandTop` on `executionSummarySchema` (the shown run's own policy); a departure-date range in core's `ResultFilters` and `filterRows`; `formatAgo` and `formatFetchedAgo` beside core's other age labels. WP8 fills the new fields; Task 9.0 lands before WP8's results routes (decision 42).
- `apps/web` build and test setup on WP0's scaffold (modified, not replaced): Vite 8, React 19, Tailwind 4 (CSS-first), Vitest 5 in jsdom, Testing Library, `msw` 3 for the API, coverage held at 100% for the provenance, booking and URL-state files.
- Shell: `main.tsx`, `App.tsx`, navigation for every view (Results, Calendar, Duration, History, Coverage, Definitions, Alerts, Providers), definition selector, status bar, red synthetic banner, an error state when `GET /api/providers` fails, empty state for no providers, a top-level error boundary.
- Routing and persisted view state in **URL search params** on the single path `/` (the API is under `/api`) (`?view=results&def=<id>&basis=calendar&sort=price.asc&f.stops=1`). Filter and sort state survives every view switch because nav links carry every parameter except `view`.
- `api/client.ts`: the one `fetch` in the app, typed by the route's own contract schema, checked against `core/api-contract` `ROUTES`, `X-Requested-With: get-me-there` and `Content-Type: application/json` on every mutation, every response parsed with the contract **in every build mode** (decision 36).
- Components: `Provenance`, `PriceCell` (the only component that prints a price: table, headline, adjusted column, other sellers, calendar gap; it carries "≈", the unconfirmed-price badge, "stale", "vendor's cache age unknown", the truncated note, and decision 46's `compact` variant), `PriceBoundary`, `AppBoundary`, `StatusBar`, `ViewHeader` (with `variant="span"` for WP10's cross-execution views), `ClassBadge`, `VerdictList`, `BookingAction`, `SearchLink`, `SyntheticBanner`, `Nav`, `DefinitionSelector`, `Loading`, `LoadError`.
- `copy.ts`: the string catalogue every component imports; the banned-word test walks it; an AST source guard rejects literal copy in `.tsx` (lettered string props on components included), and money formatting or a "£" literal outside `PriceCell`, the catalogue and the cost views (casts are `pnpm casts`, suppressions `pnpm boundaries`); a rendered-DOM sweep checks every view for banned words and for "£" outside a price or a cost.
- `format.ts`: the one date-formatting module of the web app (decision 46): `formatIsoDate` (`14 Mar 2027`), `formatIsoDateShort` (`14 Mar`), `formatIsoDateLong` (`Sun 14 Mar 2027`) and `formatWeekday` (`Sun`) from one month and weekday table; WP10 imports them.
- View A Results (spec §11, §6.5, §6.9), View D Coverage, Providers view, Definitions form (spec §11).
- `scripts/check-boundaries.mjs` gains the place-name check over the string literals, template text and JSX text of `apps/web/src` and `apps/api/src`, allowlisting exactly `apps/web/src/example.ts` and `apps/api/src/tools/workedExample.ts` with a committed list of non-airport words (decisions 36, 46), and is the one suppression check: `biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` comments are refused in every package's `src` and `test` (decisions 46, 49), so the nine `@ts-expect-error` type tests already on main in core and db are restructured without one; its test is `scripts/check-boundaries.test.mjs`, run by a new root Vitest project `scripts` (decision 49).
- Tests per spec §9 item 6 for these views.

**Out**

- View B Calendar, View C Duration, History, the Playwright fixture-mode smoke, and the browser-timezone test of review focus 3: **WP10**. WP9 ships routes for Calendar, Duration and History that render "This view is not available yet."; WP10 replaces all three and imports `format.ts` (`formatIsoDateShort`, `formatIsoDateLong`, `formatWeekday`), `COPY.truncatedNote`, `PriceCell`'s `truncated` prop and `compact` variant, and `ViewHeader`'s `variant="span"`.
- Alerts view and alert rule forms: **WP11** (WP9 ships its nav entry with the same placeholder).
- Every API route, its validation and its strings (`basisReason`, error messages, the zero-cap message, search-link labels), filling `truncated` and `expandTop`, and `stale` by fetch age (spec rev 23 §3): **WP8**. The web only renders them.
- `sortRows`, `filterRows`, `bandCheapest`, `resultRowKey`, `searchLinkFor`, `validateVendorUrl` (WP2) and `cellKeyString` (WP0) in `@gmt/core`. The web calls them, never reimplements them; Task 9.0 extends `filterRows` in core itself.
- WP7's changes, preconditions here (WP9 depends on WP8, which depends on WP7): core's `microGbpToPence` (Task 7.1, decisions 47, 49), the one micro-GBP→pence rounding (up), which every conversion here uses; `cachedRows: number | null` (Task 7.18, decision 25); `priceConfirmed` in `ConstraintName`, `constraintNameSchema` and `CONSTRAINT_LABELS` ("price not confirmed by the final step", Task 7.8, decision 37); `confirmedCalls` on the definition create, update and response bodies and in `needsConfirmation` (with `totalCalls`), and `confirmCalls` on the start request (Task 7.13, decisions 37, 43).
- `docs/examples/london-new-york.json`, `docs/setup.md` and the test that `EXAMPLE_DEFINITION` equals the JSON: **WP12**. WP9 writes a stand-in copy of the JSON only if the file is absent when it runs (WP12 depends on WP9), with WP12's exact content.
- Serving the built `dist/` at `/` (every API route is under `/api`): **WP8**.
- Phase 4 (decision 36): a max-travel-time filter and a prefilled Google Flights deep link for calendar rows.

## 3. Spec sections

Spec revision 23 and plan decisions 1–49 (rulings of review rounds 1–3: decisions 36, 42, 44, 46, 48, 49) as on main on 2026-10-16.

- **§11 banned words** — "exhaustive", "all combinations", "every combination", "live", "bookable", "guaranteed", "real-time" never appear in user-facing text; "verified" only beside class-`verified` values; stage counts say "itinerary-searched".
- **§11 layout** — nav for all views owned by WP9; definition selector; status bar on every view; per-view header (executions shown, status, age, stale label, banner when not completed); the two-line Results header; empty state for no providers; red synthetic banner.
- **§11 status bar** — stage, progress, spend used / cap for execution and month, paused state with reason and Resume, "schedule blocked since <date>", Cancel.
- **§11 provenance on every price** — visible without hover: provider badge, source in words, compact age ("2h ago · ≤7d", or "age unknown") with the full form on hover and in headers, "≈" when FX-converted, dashed outline + "constraints not checked" for calendar prices, destination airport, the operator's per-destination note; the adjusted column labelled operator-entered and never merged into price.
- **§11 Definitions form** — operator-entered origins and destinations with airport autocomplete; coverage check showing cached rows per pair before saving; per-destination note and onward cost; defaults (relative window offset 7, length 182; 10–21 nights; economy; `maxJourneyMinutes` 1500; arrival 06:00–23:00; plan preset for providers and policy; execution budget from config; schedule `0 5 * * 1`); estimate shown, the create click is the explicit confirmation setting `confirmed_cost_pence = ceil(estimateMicroGbp / 10 000)`; advanced fold; "import example".
- **§11 View A** — columns in order; 375px behaviour; expanded row; client-side sort and filter; "within the cheapest 1000 of N"; persisted filter and sort; `bandCheapest`; calendar rows' "not applied: …" note; calendar-gap banner only with a verification provider.
- **§11 View D** — counts per stage × provider with the six buckets and "searched" beside; selected but not reached with reason; overrun and parity flags; error list with retry.
- **§11 Providers** — capabilities, plan, usage vs caps with window bounds, the zero-cap message.
- **§11 accessibility** — 375px layout; keyboard-operable table; visible focus; labelled controls; no colour-only meaning.
- **§6.5** — all sorting and filtering client-side with the shared core functions, composing without refetch. Stale rows keep their place in the server's ranking and are labelled, never demoted; the `hideStale` filter is the operator's opt-in.
- **§6.9** — basis switch with the reason; `failed` excluded by default and included by filter; the search link labelled "search link, not a fare link" on every row whose booking is `none` (shown in every expanded row).
- **§3** — the two label formats from `core` (`formatAgeFull`, `formatAgeCompact`); staleness by fetch age, and a vendor age of `'unknown'` aged by fetch time and labelled "vendor's cache age unknown" rather than marked stale (spec rev 23 §3, decision 44; WP8 fills `stale` by this rule, §13); six coverage buckets; "searched" only in View D; "itinerary-searched K of N selected".
- **§6.2 (rev 21)** — an offer whose price the final step did not confirm is classed `unverified` on `priceConfirmed`; the web shows "price not confirmed by the final step" as the first mark beside the price wherever it renders (decision 44).
- **§5.5** — the synthetic banner is data-driven; a negative test asserts its absence for real data.
- **§9 item 6** — price lacking provenance fails to render; synthetic banner present and absent; distinct text for pass/fail/unverified; keyboard operation; 375px assertion that price, provenance and the class badge stay visible; banned-word test with word boundaries and an allowlist; booking links with `rel="noopener noreferrer"`, host shown, POST bookings as forms, no auto-navigation; View D sums.

## 4. Interfaces consumed

From `@gmt/core` as merged on main (WP0, WP1, WP2), plus Task 9.0's additions and WP7's contract changes (each marked). Signatures as the code declares them:

```ts
// types/ids.ts (WP0): brands are minted only by these helpers or by zod parsing (decision 15); the web mints none
export type Iata = string & { readonly __brand: 'Iata' };            // ^[A-Z]{3}$ after trim and upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };      // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };    // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema, isoDateSchema, isoMonthSchema, isoDateTimeSchema;   // z schemas whose input is a plain string
export const asIata: (s: string) => Iata; export const asIsoDate: (s: string) => IsoDate; export const asIsoDateTime: (s: string) => IsoDateTime;
export const isoDateTimeOfEpochMs: (ms: number) => IsoDateTime;

// types/provenance.ts (WP0)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance { providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin }
export const providerIdSchema /* z.enum */, sourceKindSchema, cabinSchema /* z.enum */;
export const provenanceSchema: z.ZodType<Provenance>;   // strict object; its input type is unknown, so tests spell the wire shape out

// types/execution.ts, types/itinerary.ts, types/definition.ts (WP0)
export type ExecutionStatus = 'pending' | 'running' | 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled' | 'completed'
  | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed';
export const ACTIVE_STATUSES: readonly ExecutionStatus[];   // pending, running, paused_budget, paused_error, interrupted
export type Stage = 'discovery' | 'verification';
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export type Verdict = 'pass' | 'fail' | 'unverified'; export type ConstraintName = keyof Constraints | 'cabin' | 'priceConfirmed' /* WP7 Task 7.8 */;
export type Verdicts = Partial<Record<ConstraintName, Verdict>>; export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
export type ResultBasis = 'verified' | 'calendar';   // the UI labels them "itinerary-search basis" and "calendar basis"
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export function cellKeyString(c: CellKey): string;
export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }

// labels/age.ts (WP0; Task 9.0 adds formatAgo and formatFetchedAgo)
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;     // "fetched 5h ago · provider age unknown"
export function formatAgeCompact(a: EffectiveAge): string;  // "5h ago · age unknown", "2h ago · ≤2d"
export function formatDuration(hours: number): string;      // "just now", "5h", "3d", "2w"
export function formatAgo(hours: number): string;           // Task 9.0: "just now", "5h ago"
export function formatFetchedAgo(a: EffectiveAge): string;  // Task 9.0: "fetched 2h ago"

// dates, space, ports (WP1, WP0)
export function toEpochDay(date: IsoDate): number;
export function resolveWindow(w: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean };
export function londonDateOf(instant: IsoDateTime): IsoDate;

// text, constraints, results, normalise (WP0, WP2)
export function formatPence(pence: number): string;   // the single money formatter (web and email)
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // priceConfirmed: 'price not confirmed by the final step' (WP7 Task 7.8)
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;
export const PENCE_TO_MICRO = 10_000; export function microGbpToPence(micro: number): number;   // rounds up; WP7 Task 7.1 (decisions 47, 49)
export const BANNED_WORD_ALLOWLIST: readonly string[]; export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted';
export interface ResultFilters { verdictClass?: Array<VerdictClass | 'unchecked'>; unverified?: ConstraintName[]; providerId?: ProviderId[];
  maxStops?: number; carriers?: string[]; destination?: Iata[]; maxPricePence?: number; nights?: { min: number; max: number }; hideStale?: boolean;
  departure?: { from: IsoDate; to: IsoDate } /* Task 9.0 */ }   // verdictClass absent = every class except failed (spec §6.9)
export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[]; export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[];
export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string>; export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking;
export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url: string; host: string; label: string } | null;
export type { BudgetFit, CoverageCheckRequest, CoverageCheckResponse, DefinitionResponse, ResultRow } /* z.infer of the contract */;
export interface Buckets { priced; empty; no_data; error; skipped; not_run; reused }   // the web's BucketName is Exclude<keyof Buckets, 'reused'>
export * as apiContract;   // every schema below and ROUTES: readonly RouteDef[]
```

From `apiContract` (`packages/core/src/api-contract`, every path under `/api`); where WP8's brief and this contract differ, the contract is followed. `RouteDef` is `{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; request?: z.ZodType; query?: z.ZodType; response: z.ZodType; auth }`; `ROUTES` builds `GET /api/definitions` as `definitionResponseSchema.array()`.

- `common.ts`: `errorEnvelopeSchema` `{ error: { code; message; details?: { fields?: Array<{ field; message }> } & Record<string, unknown> } }`; `ageHoursSchema` `number | 'unknown'`; `priceCellSchema` `{ pricePence, provenance, stale, ageHours, truncated /* Task 9.0 */ }`; `coverageSummarySchema` `{ buckets, total, selected, itinerarySearched, onDemand, reused }`; `executionSummarySchema` `{ id, status, isChild, startedAt: IsoDateTime | null, finishedAt: IsoDateTime | null, ageHours: number | 'unknown', expandTop /* Task 9.0, decision 42 */ }` (lists newest first); `usageSchema` `{ scope; calls; costMicroGbp; costPence; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }`; `cellKeySchema`, `cellSchema`; `constraintNameSchema` (with `priceConfirmed`, WP7 Task 7.8), `verdictClassSchema`, `resultBasisSchema` (z.enum, `.options` used for every list the web shows).
- `airports.ts`: `GET /api/airports?q=` → `Array<{ iata, name, city, country, tz, metro: string | null }>`.
- `definitions.ts`: `definitionCreateRequestSchema` (DefinitionInput fields plus `confirmedCostPence?` and `confirmedCalls?` (WP7 Task 7.13), refined); `definitionUpdateRequestSchema` (partial); `definitionResponseSchema` (fields + `confirmedCostPence: number | null`, `confirmedCalls: number | null`, `id`, `createdAt`, `updatedAt`, `deletedAt`, `budgetFit`, `estimate: Estimate | null`, `needsConfirmation: { estimateMicroGbp; totalCalls; confirmedCostPence: number | null; confirmedCalls: number | null } | null`, `notices`); `budgetFitSchema` `{ fits, runsPerMonth, perScope: Array<{ scope, estimated, cap: number | null, fits }> }`; `estimateSchema` `{ cells, perProvider: Array<{ providerId, stage, calls, planCalls, costMicroGbp, costPence, seconds, blocked: string | null }>, totalCalls, totalPlanCalls, totalCostMicroGbp, totalCostPence, seconds, assumptions, windowClamped, retryFactor }`; `estimateResponseSchema` `{ estimate, budgetFit }` from `POST /api/definitions/estimate` (unsaved body); `coverageCheckRequestSchema` `{ origins, destinations, window, minNights, maxNights }`; `coverageCheckResponseSchema` `{ pairs: Array<{ origin, destination, months: Array<{ month: IsoMonth; cachedRows: number | null /* WP7 Task 7.18 */; cellsInBand }> }>; calls; notes }`.
- `executions.ts`: `executionResponseSchema` `{ id, definitionId, isChild, cell, status, stage: Stage | null, reason: string | null, resumeAfter: IsoDateTime | null, trigger, startedAt, finishedAt, errorText, progress: Array<{ stage, providerId, buckets, total }>, budget: Usage[], estimate, ledger, parityBreak, overrun, disabledProviders }` (also the body of cancel and resume); `startExecutionRequestSchema` `{ confirmCostPence?, confirmCalls? }` (WP7 Task 7.13; a confirmation covers a run only with both, decision 43); `startExecutionResponseSchema` `{ executionId }`; `verifyCellRequestSchema` `{ definitionId, cell: CellKey }`.
- `results.ts`: `resultRowSchema` (with `truncated` from Task 9.0, `layovers`, `seller`, `baggage`, `fareConditions`, `selfTransfer`, `booking`, `searchLink: { url; host; label } | null`, `otherOffers[]` each with `stale`, `ageHours`, `verdictClass`, `unverified`, `notSeenInLatest: { ageHours } | null`, `notSeenInLatest`, `adjustedPence`, `destinationNote`, `executionId`, `calendarPriceId`, `observationId`); `resultsResponseSchema` `{ rows, total, truncated, basis, basisReason, executions, coverage, excludedByCurrentSpace, verificationProviderConfigured, cheapest: ResultRow | null }`; `coverageResponseSchema` `{ executionId, summary, perStage: Array<{ stage, providerId, buckets, total, requests: { calls, cacheHits, costMicroGbp, planCalls: number | null }, overrun, parityBreak }>, selectedNotReached: Array<{ cell, reason: 'not_run' | 'skipped:budget' }>, errors: Array<{ cell, stage, providerId, reason, lastError: string | null, attempts, retryable }>, scheduleBlockedSince: IsoDateTime | null }`; `calendarGapResponseSchema` `{ cheapestVerified: (PriceCell & { cell; itineraryHash }) | null; cells: Array<{ cell; calendar: PriceCell; verifyAvailable }> }`.
- `system.ts`: `providersResponseSchema` `{ providers: Array<{ providerId, displayName, enabled, capabilities: { discovery: CapabilityInfo | null, verification: CapabilityInfo | null }, plan: 'trial' | '40usd' | 'free' | 'synthetic', usage: Usage[], excludedFromSchedule, notices }>, synthetic, presets: { policy: { maxCells, topN, expandTop, bookingLinks }, providers, budget, discoveryRefreshHours, schedulerTimezone }, pointOfSale }`.

Usage scope labels are WP8's: `execution-calls`, `execution-free-calls`, `execution-cost`, `global-month`, `provider-month:<id>`, `provider-lifetime:<id>`.

From the plan's "Web" section and decision 36: `src/copy.ts` is the catalogue; `docs/examples/london-new-york.json` is re-exported by `apps/web/src/example.ts` as `EXAMPLE_DEFINITION`; `scripts/check-boundaries.mjs` allowlists that file and `apps/api/src/tools/workedExample.ts` for place names.

## 5. Interfaces produced

Later packages (WP10, WP11, WP12) rely on these names.

```ts
// @gmt/core (Task 9.0)
priceCellSchema.truncated; resultRowSchema.truncated; executionSummarySchema.expandTop; ResultFilters.departure; formatAgo(hours); formatFetchedAgo(age);
// apps/web/src/copy.ts
export const COPY: { /* the full catalogue, Task 9.1 */ };
// apps/web/src/example.ts
export const EXAMPLE_DEFINITION: z.output<typeof apiContract.definitionCreateRequestSchema>;   // parsed from docs/examples/london-new-york.json
export const EXAMPLE_LABEL: string;   // the example's route in words; the one web file allowed to name its places
// apps/web/src/format.ts (decisions 38, 46: the one date-formatting module, one month and weekday table; WP10 imports it)
export { formatPence }; export function formatMicroGbp(micro: number): string;
export function formatIsoDate(d: string): string;        // "14 Mar 2027"
export function formatIsoDateShort(d: string): string;   // "14 Mar"
export function formatIsoDateLong(d: IsoDate): string;   // "Sun 14 Mar 2027"
export function formatWeekday(d: IsoDate): string;       // "Sun"
export function formatInstantUtc(iso: string): string;  // "14 Oct 2026 12:00 UTC"
export function formatLocalDateTime(local: string): string; export function formatMinutes(m: number): string; export function formatSeconds(s: number): string;
export function penceToPoundsInput(p: number | undefined): string; export function parsePoundsToPence(s: string): number | undefined; export function poundsText(s: string): string;
// apps/web/src/api/client.ts
export class ApiError extends Error { readonly status: number; readonly code: string; fieldErrors(): FieldError[] }   // code: envelope code | 'http' | 'malformed' | 'contract' | 'network'
export function findRoute(method: Method, path: string): apiContract.RouteDef; export function fillPath(path: string, params: Record<string, string>): string;
export async function call<S extends z.ZodType>(schema: S, method: Method, path: string, opts?: CallOptions): Promise<z.output<S>>;
// apps/web/src/api/endpoints.ts, queries.ts, types.ts
export const api: { providers, definitions, estimateDraft, createDefinition, updateDefinition, coverageCheck, startExecution,
  execution, cancel, resume, verifyCell, results, coverage, calendarGap, airports };
export const qk; export const POLL_MS = 2_000; export function useProviders(); useDefinitions(); useResults(defId, basis); useExecution(id);
export function useCoverage(defId); useCalendarGap(defId, enabled); useAirportSearch(q); useExecutionActions();
export type DefinitionBody, DefinitionUpdateBody, CoverageCheckBody, VerifyCellBody, StartExecutionBody /* z.input of the request schemas */, ExecutionSummary, ...;
// apps/web/src/components/*
export function PriceCell(props: PriceCellProps): JSX.Element;   // the only component that prints a price; props.provenance: unknown;
  // props: pricePence, calendar, stale, truncated?, unconfirmed?, destination?, destinationNote?, notSeenInLatestHours?, qualifier?,
  //   besideColumns? (the wide Results table: source and age only), compact? (decision 46: amount with "≈", short provider badge,
  //   destination code, stale/truncated/unconfirmed marks; source, age and note in the title), fullAge?; WP10 adds props here
export function priceUnconfirmed(r: { unverified: readonly ConstraintName[]; verdicts?: Verdicts }): boolean;
COPY.truncatedNote;   // 'cheapest of the rows read' (decision 36)
export function Provenance(props: ProvenanceProps): JSX.Element; export function assertProvenance(p: unknown): Provenance; export class MissingProvenanceError;
export class PriceBoundary; export class AppBoundary; export function Loading(); export function LoadError({ error, retry });
export function ViewHeader(props: { title; executions: readonly HeaderRun[]; stale; variant?: 'single' | 'span' }): JSX.Element;
export type HeaderRun = Pick<ExecutionSummary, 'id' | 'status' | 'isChild' | 'startedAt' | 'ageHours'>;
export function StatusBar(props: { definition; showRunNow }); export const near: (used: number, cap: number | null) => boolean; export function ClassBadge, VerdictList, BookingAction, SearchLink, safeVendorUrl, SyntheticBanner, Nav, DefinitionSelector;
// apps/web/src/state/*
export function useSearchParams(): URLSearchParams; export function updateSearchParams(patch, mode?): void; export function hrefWith(patch): string; export function navigateTo(patch): (e: NavClick) => void;
export type ViewId; export const VIEWS; export function parseView(v): ViewId; export function withKey(obj, key, value); export function oneOf(set);
export function parseCarriers(s): { codes; ignored }; export function carriersText(s): string;   // src/state/carriers.ts
export function useSynced(value, means): [text, setText];   // src/hooks/useSynced.ts
// src/views/Definitions/fields.tsx: FieldErrors, NumberField, PoundsField, TimeWindowField, AirlinesField, Check
// src/views/Definitions/Confirmation.tsx: CreateConfirmation({ estimate, fresh, hardStop, onCreate }), Reconfirmation({ definition, onConfirm })
export type SortDir; export interface ResultsUiState; export const SORT_KEYS, CLASSES, DEFAULT_CLASSES; export function parseResultsState, resultsStatePatch, parseBasis, parseSelectedRow, setFilter, activeFilterCount;
// apps/web/src/now.tsx, src/hooks/useMediaQuery.ts
export const NowContext; export function useNow(); export function useMediaQuery(q); export const NARROW_QUERY;
// apps/web/test/*
export function renderWithProviders(ui, opts?: { search?; fakeTimers? }); export function settled(client): Promise<void>; export const NOW; export type ProvenanceInput; export const server;
export function expectConsoleErrors(pattern: RegExp); fixture builders; setViewportWidth(px)
```

## 6. Library notes

Versions from the plan's Task 0.1 list. Verified on 2026-10-14 with context7 against the sources named, and on 2026-10-16 by assembling this brief on a scratch checkout of main (every command of §10 green).

- **react 19.3.1, react-dom 19.3.1.** `createRoot(el).render(<StrictMode>…)`; error boundaries are class components with `static getDerivedStateFromError` and `componentDidCatch(error, info)` (react.dev `reference/react/Component`; the boundary reports through `console.error`, which the test setup records and fails on unless the test calls `expectConsoleErrors()`). `useSyncExternalStore(subscribe, getSnapshot)` for the URL and `matchMedia` stores; `createContext` for the table's sort and band marks. `@types/react` 19.3.0 declares `rel` on `<form>`, so no attribute object is needed.
- **vite 8.3.4 + @vitejs/plugin-react 6.1.2.** `defineConfig({ plugins, resolve: { alias }, server: { proxy: { '/api': { target } } } })` (vite.dev `config/server-options`). `vite.config.ts` uses the workspace's `gmtAliases` from `vitest.aliases.ts` (the same as every package's `vitest.config.ts`), so `vite build` reads core from source; the assembly run built `dist/index.html` and `dist/assets/*` with it. Vite imports JSON (`import x from '…json' with { type: 'json' }`, `resolveJsonModule`) from inside the workspace root. No `changeOrigin`: the api sees `Host: localhost:5173`, which spec §4 allows under `NODE_ENV=development`.
- **tailwindcss 4.3.3 + @tailwindcss/vite 4.3.3.** CSS-first: `@import "tailwindcss";` in `src/styles.css`; no config file. `min-h-11` is 2.75rem = 44 px, the touch-target floor. No inline `style` props (spec §4 CSP `default-src 'self'`).
- **@tanstack/react-query 5.104.2.** `useQuery({ queryKey, queryFn, enabled, refetchInterval: (query) => … })`, `useMutation`, `invalidateQueries({ queryKey })`. Query functions do not forward TanStack's `AbortSignal` to `fetch` (`// why:` in the client). Polling tests fake `setTimeout`, `setInterval`, `clearTimeout` and `clearInterval` together: with the clear functions real, the cleared interval keeps firing on the real clock.
- **@tanstack/react-table 9.3.1** (v9: `tableFeatures({ rowExpandingFeature })`, `createColumnHelper<typeof features, ResultRow>()`, `helper.display`, `useTable({ features, columns, data, getRowId, getRowCanExpand, state: { expanded }, onExpandedChange })`, `<table.FlexRender header|cell />`). No sorted or filtered row models: rows arrive filtered and sorted by core. Column definitions must stay stable across a sort change or the header remounts and loses keyboard focus, so sort state and band marks travel through React context.
- **@testing-library/react 16.3.3**, **@testing-library/dom 10.4.1** (its peer, already in WP0's package.json), **@testing-library/user-event 14.6.8** (`user.type`, `user.paste`, `user.tab`, `user.keyboard`, `user.selectOptions`, `user.clear`), **@testing-library/jest-dom 7.0.1** (`toHaveClass`, `toHaveValue`, `toBeDisabled`, …). Vitest runs without globals, so `test/setup.ts` calls `cleanup()`. A `type="date"` input is driven with `fireEvent.change` (a date input commits a whole value). With fake timers, `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` (the `fakeTimers` option of `renderWithProviders`) so typing does not stall, and the debounce is stepped with `vi.advanceTimersByTimeAsync`.
- **jsdom 30.1.2** with `environmentOptions.jsdom.url = 'http://localhost:3000/'`. jsdom has no `matchMedia` (`test/viewport.ts` installs one) and no `scrollIntoView` (stubbed). Under jsdom `import.meta.url` is not a `file:` URL, so a test that reads files uses `import.meta.dirname`.
- **msw 3.0.3.** `setupServer(...handlers)` from `msw/node`; `http.get/post/put/all`, `HttpResponse.json(body, { status })`, `HttpResponse.error()`, `new HttpResponse(text, { status })`; `server.listen({ onUnhandledFrame: 'error' })` (msw 3's name for the unmatched-request policy), `server.use`, `resetHandlers`, `close`. A catch-all `http.all('*', …)` registered last records any unmatched request and answers with a network error, so nothing reaches the network (decision 18) and afterEach fails the test. Requests use absolute URLs (the client builds `new URL(path, window.location.origin)`).
- **vitest 5.0.4.** `test.environment`, `environmentOptions`, `setupFiles`, `coverage.thresholds` with glob keys for per-file floors; `vi.spyOn`, `vi.stubEnv` / `vi.unstubAllEnvs`, `vi.useFakeTimers({ toFake })`, `vi.advanceTimersByTimeAsync`.
- **zod 4.6.7.** `z.input<S>` (request bodies and fixture overrides: plain strings) and `z.output<S>` (parsed responses: brands); `ZodArray` and `.element` (the client's schema identity check); `.safeParse`; `z.enum(...).options`.
- **typescript 5.9.3** (the workspace root's devDependency): the source guard parses with `ts.createSourceFile` and walks `JsxText`, string and template literals, `AsExpression`, `TypeAssertionExpression`, call expressions and import specifiers, and reads comments with `ts.getLeadingCommentRanges` over every token (`node.getChildren()`); a comment alone in JSX braces belongs to no token's trivia, so those are matched directly. `scripts/check-boundaries.mjs` imports it the same way (`import ts from 'typescript'`) to read only literals; its suppression check is one regex over comment syntax.
- **node:child_process `spawnSync`** runs the boundary script against a scratch tree (`mkdtempSync` in `os.tmpdir()`), since the script exits the process and cannot be imported; the test is plain `.mjs` under a root Vitest project `scripts` (`scripts/vitest.config.mjs`, `environment: 'node'`, added to the root `projects`). **`Reflect.apply(fn, thisArg, args)`** passes an ill-typed argument to a runtime guard without a cast or a suppression, and **`expectTypeOf<T>().toBeNever()`** (vitest) states a compile-time rejection that `tsc` checks.

## 7. Files

**Create** (all under `apps/web/` unless a full path is given):

```
index.html  vite.config.ts
src/main.tsx  src/App.tsx  src/styles.css  src/copy.ts  src/format.ts  src/now.tsx  src/example.ts
src/hooks/useMediaQuery.ts  src/hooks/useSynced.ts
src/state/urlState.ts  src/state/view.ts  src/state/withKey.ts  src/state/resultsState.ts  src/state/carriers.ts
src/api/client.ts  src/api/endpoints.ts  src/api/types.ts  src/api/queries.ts
src/components/Provenance.tsx  src/components/PriceCell.tsx  src/components/PriceBoundary.tsx  src/components/AppBoundary.tsx
src/components/ClassBadge.tsx  src/components/VerdictList.tsx  src/components/BookingAction.tsx  src/components/LoadState.tsx
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
src/views/Definitions/CoverageCheck.tsx  src/views/Definitions/EstimatePanel.tsx  src/views/Definitions/draft.ts
src/views/Definitions/fields.tsx  src/views/Definitions/Confirmation.tsx
test/guards.ts  test/msw/server.ts  test/msw/handlers.ts  test/fixtures.ts  test/render.tsx  test/viewport.ts
packages/core/test/results/webAdditions.test.ts
```

**Create (stand-in, WP12 owns it):** `docs/examples/london-new-york.json`, only when absent (Task 9.12).

**Modify:** `apps/web/tsconfig.json`, `apps/web/tsconfig.test.json`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts` (WP0 files, modified: `package.json`, `src/index.ts`, its `exports` block and `test/smoke.test.ts` stay as WP0 wrote them; every dependency the web needs is already pinned there); `packages/core/src/api-contract/common.ts`, `packages/core/src/api-contract/results.ts`, `packages/core/src/results/types.ts`, `packages/core/src/results/filter.ts`, `packages/core/src/labels/age.ts`, `packages/core/test/helpers/rows.ts`, `packages/core/test/api-contract/contract.test.ts` (Task 9.0); `scripts/check-boundaries.mjs`, the root `vitest.config.ts` (the `scripts` project) and the five core and db test files that held `@ts-expect-error` (Task 9.12). **Create (root):** `scripts/vitest.config.mjs`, `scripts/check-boundaries.test.mjs` (Task 9.12).

**Test:**

```
packages/core/test/results/webAdditions.test.ts   Task 9.0
test/components/provenance.test.tsx               Task 9.1
test/format.test.ts                               Task 9.1
test/copy/catalogue.test.ts                       Task 9.2
test/copy/sourceGuard.test.ts                     Task 9.2
test/api/client.test.ts                           Task 9.3
test/harness.test.ts                              Task 9.3
test/state/resultsState.test.ts                   Task 9.4
test/app/shell.test.tsx                           Task 9.5
test/components/statusBar.test.tsx                Task 9.6
test/views/results/expanded.test.tsx              Task 9.7
test/views/results/table.test.tsx                 Task 9.8
test/views/results/basisAndGap.test.tsx           Task 9.9
test/views/coverage.test.tsx                      Task 9.10
test/views/providers.test.tsx                     Task 9.11
test/views/definitions/form.test.tsx              Task 9.12
scripts/check-boundaries.test.mjs                 Task 9.12 (root Vitest project `scripts`)
test/views/definitions/create.test.tsx            Task 9.13
test/copy/renderedSweep.test.tsx                  Task 9.14
```

Every focused run in the tasks uses `pnpm --filter @gmt/web exec vitest run <file>` (no coverage, so a single file does not trip the package thresholds); the package-wide `pnpm --filter @gmt/web test` runs with coverage in §10. Code blocks are shown formatted by Biome (line width 110); `pnpm lint:fix` keeps them so.

## 8. Tasks

A label `` `path` (new file): `` or `` `path` — replace the file: `` introduces a whole file. A pair `` `path` — find: `` / `` `path` — replace with: `` replaces exactly one occurrence of the found text. Paths without a leading `apps/`, `packages/`, `docs/`, `scripts/` or `./` (the repository root) are under `apps/web/`. Preconditions: WP7 Tasks 7.1 (`microGbpToPence`), 7.8 (`priceConfirmed`), 7.13 (`confirmedCalls`, `confirmCalls`, `needsConfirmation.totalCalls`) and 7.18 (`cachedRows` nullable) are on main; WP9 depends on WP8, which depends on WP7.

### Task 9.0: Core additions: `truncated` on every price, the run's `expandTop`, the departure-date filter, the age phrases

Decisions 36 and 42 put four small things in `@gmt/core` that the views need and WP8, WP10 and WP11 share: the contract's `truncated` flag (WP8 fills it from an outcome's `last_error` starting with core's `TRUNCATED_NOTE`, decision 37), `expandTop` on the execution summary (the shown run's own "outbounds each", never the current definition's), a departure-date range in `ResultFilters` (pure, inclusive, string-compared ISO dates), and the two relative-age phrases the Fetched column and headers print (one name each: `formatAgo` replaces the private `ago`). This task lands first and on its own commit, ahead of WP8's results routes (decision 42). Core stays at 100% coverage.

**Files:**
- Modify: `packages/core/src/api-contract/common.ts`, `packages/core/src/api-contract/results.ts`, `packages/core/src/results/types.ts`, `packages/core/src/results/filter.ts`, `packages/core/src/labels/age.ts`, `packages/core/test/helpers/rows.ts`, `packages/core/test/api-contract/contract.test.ts`
- Test: `packages/core/test/results/webAdditions.test.ts`

**Interfaces:**
- Consumes: `priceCellSchema`, `resultRowSchema`, `ResultFilters`, `filterRows`, `effectiveAge`, `formatAgeFull`, the core test helpers `row` and `calendarRow` (WP0, WP2).
- Produces: `priceCellSchema.truncated`, `resultRowSchema.truncated`, `executionSummarySchema.expandTop`, `ResultFilters.departure`, `formatAgo`, `formatFetchedAgo` (barrel: `export *` from `labels/age.ts` already re-exports them).

- [ ] **Step 1: Write the failing test**

`packages/core/test/results/webAdditions.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import { executionSummarySchema, priceCellSchema, resultRowSchema } from '../../src/api-contract/index.js';
import { effectiveAge, formatAgeFull, formatAgo, formatFetchedAgo } from '../../src/labels/age.js';
import { filterRows } from '../../src/results/filter.js';
import { asIsoDate, asIsoDateTime } from '../../src/types/ids.js';
import { calendarRow, row } from '../helpers/rows.js';

// The core additions the WP9 brief makes (plan decision 36): the truncated flag on prices, the
// departure-date range filter, and the relative-age phrases the web shows.

describe('truncated flag on every price (decisions 30 and 36)', () => {
  it('a price cell and a result row carry it, and neither parses without it', () => {
    const r = calendarRow({ truncated: true });
    expect(r.truncated).toBe(true);
    const { truncated: _row, ...unflaggedRow } = r;
    expect(resultRowSchema.safeParse(unflaggedRow).success).toBe(false);
    const cell = {
      pricePence: r.pricePence,
      provenance: r.provenance,
      stale: false,
      ageHours: 2,
      truncated: true,
    };
    expect(priceCellSchema.parse(cell).truncated).toBe(true);
    const { truncated: _cell, ...unflaggedCell } = cell;
    expect(priceCellSchema.safeParse(unflaggedCell).success).toBe(false);
  });
});

describe('departure-date range filter (spec §6.5 filters, decision 36)', () => {
  const on = (d: string) => row({ itineraryHash: d, cell: { departureDate: d } });
  const rows = [on('2027-02-28'), on('2027-03-01'), on('2027-03-31'), on('2027-04-01')];
  const names = (rs: ReturnType<typeof row>[]) => rs.map((r) => r.itineraryHash);

  it('keeps rows departing inside the range, both ends inclusive', () => {
    const march = { from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-31') };
    expect(names(filterRows(rows, { departure: march }))).toEqual(['2027-03-01', '2027-03-31']);
  });

  it('composes with the other filters (AND), and an absent range keeps every row', () => {
    const priced = [
      row({ itineraryHash: 'in-cheap', pricePence: 100, cell: { departureDate: '2027-03-10' } }),
      row({ itineraryHash: 'in-dear', pricePence: 900, cell: { departureDate: '2027-03-11' } }),
      row({ itineraryHash: 'out-cheap', pricePence: 100, cell: { departureDate: '2027-04-10' } }),
    ];
    const march = { from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-31') };
    expect(names(filterRows(priced, { departure: march, maxPricePence: 500 }))).toEqual(['in-cheap']);
    expect(filterRows(rows, {})).toHaveLength(4);
  });
});

describe('the execution summary carries the run own expandTop (decision 42)', () => {
  it('requires a positive integer', () => {
    const s = {
      id: 'e',
      status: 'completed',
      isChild: false,
      startedAt: null,
      finishedAt: null,
      ageHours: 2,
      expandTop: 2,
    };
    expect(executionSummarySchema.parse(s).expandTop).toBe(2);
    const { expandTop: _drop, ...bare } = s;
    expect(executionSummarySchema.safeParse(bare).success).toBe(false);
    expect(executionSummarySchema.safeParse({ ...s, expandTop: 0 }).success).toBe(false);
  });
});

describe('relative-age phrases shared by web and email (spec §3)', () => {
  it('formatAgo says "just now" under an hour and "<duration> ago" after', () => {
    expect([0, 5, 72, 400].map(formatAgo)).toEqual(['just now', '5h ago', '3d ago', '2w ago']);
  });

  it('formatFetchedAgo is the fetch age alone, the leading part of the full form', () => {
    const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
    const a = effectiveAge({ fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'), maxAgeHours: 48 }, now);
    expect(formatFetchedAgo(a)).toBe('fetched 2h ago');
    expect(formatAgeFull(a).startsWith(formatFetchedAgo(a))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/results/webAdditions.test.ts`
Expected: FAIL: the import of `formatAgo` and `formatFetchedAgo` does not resolve (`formatAgo is not a function`), `calendarRow({ truncated: true }).truncated` is `undefined`, the departure tests keep rows outside the range, and an execution summary without `expandTop` still parses.

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/common.ts` — find:

```ts
/** Every price on the wire: amount, provenance, staleness, effective age. */
export const priceCellSchema = z.object({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
});
```

`packages/core/src/api-contract/common.ts` — replace with:

```ts
/**
 * Every price on the wire: amount, provenance, staleness, effective age, and `truncated`: true when
 * the price came from a discovery tile the pagination cap stopped early, so it is only the
 * cheapest of the rows read (decisions 30 and 36; WP8 derives it from the outcome's `last_error`
 * starting with core's `TRUNCATED_NOTE`). Never defaulted: a price without the flag is invalid.
 */
export const priceCellSchema = z.object({
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  stale: z.boolean(),
  ageHours: ageHoursSchema,
  truncated: z.boolean(),
});
```

`packages/core/src/api-contract/results.ts` — find:

```ts
  stale: z.boolean(),
  ageHours: ageHoursSchema,
  cell: cellSchema,
```

`packages/core/src/api-contract/results.ts` — replace with:

```ts
  stale: z.boolean(),
  ageHours: ageHoursSchema,
  /** Calendar basis: the price is the cheapest of the rows a truncated tile read (decision 36); false for itinerary rows. */
  truncated: z.boolean(),
  cell: cellSchema,
```

`packages/core/src/results/types.ts` — replace the file:

```ts
import type { ResultRow } from '../api-contract/results.js';
import type { Iata, IsoDate } from '../types/ids.js';
import type { ConstraintName, VerdictClass } from '../types/itinerary.js';
import type { ProviderId } from '../types/provenance.js';

// why: WP0 already exports `ResultRow` (z.infer of resultRowSchema) from the barrel; WP2 re-uses
// that one type rather than declaring a second name for it.
export type { ResultRow };

/** Spec §6.5 sort keys: price, total travel time, departure, return, nights, stops, adjusted. */
export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted';

/**
 * Spec §6.5 filters, composed with AND. `verdictClass` absent means "every class except
 * `failed`" (spec §6.9: failed excluded by default, included by filter). `unverified` keeps a row
 * that leaves any of the named constraints unverified. `departure` keeps rows whose departure date
 * lies in `[from, to]`, both ends inclusive (decision 36: "only March" without leaving the table).
 */
export interface ResultFilters {
  verdictClass?: Array<VerdictClass | 'unchecked'>;
  unverified?: ConstraintName[];
  providerId?: ProviderId[];
  maxStops?: number;
  carriers?: string[];
  destination?: Iata[];
  maxPricePence?: number;
  nights?: { min: number; max: number };
  hideStale?: boolean;
  departure?: { from: IsoDate; to: IsoDate };
}
```

`packages/core/src/results/filter.ts` — replace the file:

```ts
import type { ResultFilters, ResultRow } from './types.js';

const DEFAULT_CLASSES: Array<ResultRow['verdictClass']> = ['verified', 'partially-verified', 'unchecked'];

/**
 * Spec §6.5 filters, composed with AND: verdict class, unverified-constraint name, provider,
 * stops, carriers, destination, max price, nights range, departure-date range, stale. Stale rows are kept unless
 * `hideStale` (spec §8.1: returned and labelled, never hidden by default). The stops and
 * carriers filters do not apply to rows without segments (calendar basis, spec §6.9), so such
 * rows are kept rather than silently dropped.
 */
export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[] {
  const classes = f.verdictClass ?? DEFAULT_CLASSES;
  return rows.filter((r) => {
    if (!classes.includes(r.verdictClass)) return false;
    if (f.unverified !== undefined && !f.unverified.some((name) => r.unverified.includes(name))) return false;
    if (f.providerId !== undefined && !f.providerId.includes(r.provenance.providerId)) return false;
    if (f.maxStops !== undefined && r.stopsOut !== null && r.stopsIn !== null) {
      if (r.stopsOut > f.maxStops || r.stopsIn > f.maxStops) return false;
    }
    if (f.carriers !== undefined && r.outbound !== null) {
      const wanted = f.carriers;
      if (!r.carriers.some((c) => wanted.includes(c))) return false;
    }
    if (f.destination !== undefined && !f.destination.includes(r.cell.destination)) return false;
    if (f.maxPricePence !== undefined && r.pricePence > f.maxPricePence) return false;
    if (f.nights !== undefined && (r.cell.nights < f.nights.min || r.cell.nights > f.nights.max))
      return false;
    // why: ISO dates compare correctly as strings, so no Date (and no time zone) is involved.
    if (f.departure !== undefined) {
      const d = r.cell.departureDate;
      if (d < f.departure.from || d > f.departure.to) return false;
    }
    if (f.hideStale === true && r.stale) return false;
    return true;
  });
}
```

`packages/core/src/api-contract/common.ts` — find:

```ts
  finishedAt: isoDateTimeSchema.nullable(),
  ageHours: ageHoursSchema,
});
```

`packages/core/src/api-contract/common.ts` — replace with:

```ts
  finishedAt: isoDateTimeSchema.nullable(),
  ageHours: ageHoursSchema,
  /** The run's own policy, "(E outbounds each)" in the Results header (decision 42); never the current definition's. */
  expandTop: z.number().int().min(1),
});
```

`packages/core/src/labels/age.ts` — replace the file:

```ts
import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';

/** Spec §3 "Effective age" and the two label formats, defined once here for web, api and email. */
export type EffectiveAge =
  | { kind: 'observed'; fetchedHours: number; observedHours: number }
  | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number }
  | { kind: 'unknown'; fetchedHours: number };

/** Whole hours between two instants, never negative (a vendor clock ahead of ours reads as 0). */
function hoursBetween(earlier: IsoDateTime, later: IsoDateTime): number {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.max(0, Math.floor(ms / 3_600_000));
}

export function effectiveAge(
  p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>,
  now: IsoDateTime,
): EffectiveAge {
  const fetchedHours = hoursBetween(p.fetchedAt, now);
  if (p.providerObservedAt !== undefined) {
    return { kind: 'observed', fetchedHours, observedHours: hoursBetween(p.providerObservedAt, now) };
  }
  if (p.maxAgeHours === 'unknown') return { kind: 'unknown', fetchedHours };
  return { kind: 'bounded', fetchedHours, maxAgeHours: p.maxAgeHours };
}

/** The age a careful reader should assume: observed age, or fetched age plus the provider's bound. */
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown' {
  switch (a.kind) {
    case 'observed':
      return a.observedHours;
    case 'bounded':
      return a.fetchedHours + a.maxAgeHours;
    case 'unknown':
      return 'unknown';
  }
}

/** "just now" under an hour; hours to 47h; days to 13d; weeks after. */
export function formatDuration(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** "just now", "5h ago", "3d ago": the one relative-age phrase (web columns, headers, email). Spec §3. */
export function formatAgo(hours: number): string {
  return hours < 1 ? 'just now' : `${formatDuration(hours)} ago`;
}

/** The fetch age alone, "fetched 2h ago": the Results table's Fetched column (spec §11). */
export function formatFetchedAgo(a: EffectiveAge): string {
  return `fetched ${formatAgo(a.fetchedHours)}`;
}

/** Tooltip, header and email form, e.g. "fetched 2h ago · provider age unknown (≤7d before that)". */
export function formatAgeFull(a: EffectiveAge): string {
  const fetched = formatFetchedAgo(a);
  switch (a.kind) {
    case 'observed':
      return `${fetched} · observed ${formatAgo(a.observedHours)}`;
    case 'bounded':
      // why: maxAgeHours 0 is an interactive search at request time; there is no bound to show.
      return a.maxAgeHours === 0
        ? fetched
        : `${fetched} · provider age unknown (≤${formatDuration(a.maxAgeHours)} before that)`;
    case 'unknown':
      return `${fetched} · provider age unknown`;
  }
}

/** Table-cell and calendar-day form, e.g. "2h ago · ≤7d". */
export function formatAgeCompact(a: EffectiveAge): string {
  const fetched = formatAgo(a.fetchedHours);
  switch (a.kind) {
    case 'observed':
      return `${fetched} · obs ${formatDuration(a.observedHours)}`;
    case 'bounded':
      return a.maxAgeHours === 0 ? fetched : `${fetched} · ≤${formatDuration(a.maxAgeHours)}`;
    case 'unknown':
      return `${fetched} · age unknown`;
  }
}

/** Sort comparator: fresher first; an unknown age loses to any known age; two unknowns tie. Spec §8.1. */
export function compareAges(a: EffectiveAge, b: EffectiveAge): number {
  const wa = worstCaseAgeHours(a);
  const wb = worstCaseAgeHours(b);
  if (wa === 'unknown' && wb === 'unknown') return 0;
  if (wa === 'unknown') return 1;
  if (wb === 'unknown') return -1;
  return wa - wb;
}
```

The existing core fixtures gain the flag, since a row or price without it no longer parses.

`packages/core/test/helpers/rows.ts` — find:

```ts
    stale: false,
    ageHours: 2,
    cell: {
```

`packages/core/test/helpers/rows.ts` — replace with:

```ts
    stale: false,
    ageHours: 2,
    truncated: false,
    cell: {
```

`packages/core/test/api-contract/contract.test.ts` — find:

```ts
  it('every price-bearing response requires provenance', () => {
    expect(priceCellSchema.safeParse({ pricePence: 41200, stale: false, ageHours: 2 }).success).toBe(false);
    expect(
      priceCellSchema.safeParse({ pricePence: 41200, provenance, stale: false, ageHours: 2 }).success,
    ).toBe(true);
    expect(
      priceCellSchema.safeParse({ pricePence: 412.5, provenance, stale: false, ageHours: 2 }).success,
    ).toBe(false);
    expect(
      priceCellSchema.safeParse({ pricePence: 41200, provenance, stale: true, ageHours: 'unknown' }).success,
    ).toBe(true);
  });
```

`packages/core/test/api-contract/contract.test.ts` — replace with:

```ts
  it('every price-bearing response requires provenance', () => {
    const cell = { pricePence: 41200, provenance, stale: false, ageHours: 2, truncated: false };
    const { provenance: _drop, ...bare } = cell;
    expect(priceCellSchema.safeParse(bare).success).toBe(false);
    expect(priceCellSchema.safeParse(cell).success).toBe(true);
    expect(priceCellSchema.safeParse({ ...cell, pricePence: 412.5 }).success).toBe(false);
    expect(priceCellSchema.safeParse({ ...cell, stale: true, ageHours: 'unknown' }).success).toBe(true);
  });
```

`packages/core/test/api-contract/contract.test.ts` — find:

```ts
      stale: false,
      ageHours: 2,
      cell: {
```

`packages/core/test/api-contract/contract.test.ts` — replace with:

```ts
      stale: false,
      ageHours: 2,
      truncated: false,
      cell: {
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/results test/api-contract test/labels && pnpm --filter @gmt/core test && pnpm --filter @gmt/core typecheck`
Expected: PASS; the new file has 6 tests; `pnpm --filter @gmt/core test` keeps 100% on every metric and the four `test:tz` runs pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp09: core truncated flag on prices, departure-date filter, age phrases"
```

### Task 9.1: Scaffold, copy catalogue, date formats and the provenance-checked price (first failing test)

**Files:**
- Modify: `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `test/setup.ts` (WP0's; `package.json`, `src/index.ts` and `test/smoke.test.ts` are kept as they are)
- Create: `index.html`, `vite.config.ts`, `src/styles.css`, `src/copy.ts`, `src/format.ts`, `src/now.tsx`, `src/components/Provenance.tsx`, `src/components/PriceCell.tsx`, `src/components/PriceBoundary.tsx`, `test/render.tsx`, `test/viewport.ts`, `test/guards.ts`
- Test: `test/components/provenance.test.tsx`, `test/format.test.ts`

**Interfaces:**
- Consumes: `provenanceSchema`, `Provenance`, `effectiveAge`, `formatAgeCompact`, `formatAgeFull`, `formatAgo`, `formatPence`, `toEpochDay`, `isoDateTimeOfEpochMs`, `asIsoDateTime`, `CONSTRAINT_LABELS` (with WP7's `priceConfirmed`), `Buckets`, `ConstraintName`, `Verdicts` (WP0, WP2, WP7, Task 9.0).
- Produces: `COPY`, `BucketName`, the `format.ts` functions (§5), `NowContext`, `useNow`, `Provenance`, `isCalendarPrice`, `PriceCell`, `priceUnconfirmed`, `PriceBoundary`, `assertProvenance`, `MissingProvenanceError`, `renderWithProviders`, `settled`, `NOW`, `ProvenanceInput`, `setViewportWidth`, `expectConsoleErrors`, `drainGuards`.

`PriceCell` is the one place a price is printed (the Critical of review round 1): table rows, the Results headline, the adjusted column, other sellers and the calendar-gap banner all render through it, so every mark exists once. In order after the amount: the "≈" on the amount, with a spoken-only explanation, so a converted price is never read as exact; then **"price not confirmed by the final step"** as the first badge whenever the final step did not confirm the price (decision 44; `priceUnconfirmed` reads core's `priceConfirmed` verdict or unverified name; the words are core's label); then "stale" for a price stale by fetch age; then **"vendor's cache age unknown"** for a vendor age of `'unknown'`, which is a label, not staleness (decision 44); then the provenance line, the truncated note and the not-seen note. Two variants: `besideColumns`, inside the wide Results table, whose Provider and Destination columns sit beside it, so the line shows only source and age (ruling on UI-14; at 375px, where those columns move out, the line is complete); and decision 46's `compact`, which WP10's calendar day cells use: the amount with "≈", a short provider badge, the destination code and the marks, with source words, age and note in the title. WP10 adds props to `PriceCell`, never a second price component. A calendar source kind (`authorised-cached`, `scraped-aggregate`) always gets the calendar marker, whatever the caller passes. `assertProvenance` also rejects a `fixture` provider without the `synthetic` source kind and the reverse (spec §5.5). `format.ts` gives the four date forms of decision 46 from one month and weekday table. The test guards fail a test on any `console.error` it did not announce with `expectConsoleErrors(pattern)`, on an announced one that never came, and (from Task 9.3) on any unmatched request; `settled(client)` waits for the query client to go quiet before a negative request count.

- [ ] **Step 1: Write the failing test**

`test/components/provenance.test.tsx`:

```tsx
import { asIsoDateTime, effectiveAge, formatAgeCompact, formatAgeFull, provenanceSchema } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PriceBoundary } from '../../src/components/PriceBoundary.js';
import { PriceCell } from '../../src/components/PriceCell.js';
import { assertProvenance, MissingProvenanceError, Provenance } from '../../src/components/Provenance.js';
import { expectConsoleErrors } from '../guards.js';
import { NOW, type ProvenanceInput, renderWithProviders } from '../render.js';

/** SearchApi itinerary price: provider age 'unknown' (spec rev 15, decision 24). */
const searchProvenance: ProvenanceInput = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  maxAgeHours: 'unknown',
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const calendarProvenance: ProvenanceInput = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 48,
  fx: { converted: true, rateNano: 790_000_000, rateDate: '2026-10-13', source: 'frankfurter' },
  pointOfSale: 'unknown',
  cabin: 'economy',
};
const syntheticProvenance: ProvenanceInput = {
  providerId: 'fixture',
  sourceKind: 'synthetic',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};

/** The age labels core computes for a provenance at the tests' NOW: the oracle the DOM is compared with (review tsr-008). */
const ages = (p: ProvenanceInput) => {
  const a = effectiveAge(provenanceSchema.parse(p), NOW);
  return { compact: formatAgeCompact(a), full: formatAgeFull(a) };
};

/** Records the error a child threw so the test can assert its class without relying on render() rethrowing. */
class Catch extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

describe('a price without provenance fails to render (spec §9 item 6; WP9 first failing test)', () => {
  it('PriceCell inside PriceBoundary shows the withheld message and never the number', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={undefined} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.queryByText(/412/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
  });

  it('a provenance missing fetchedAt is treated exactly like no provenance (nothing is defaulted)', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const { fetchedAt: _drop, ...partial } = searchProvenance;
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={partial} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.queryByText(/412/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
  });

  it('Provenance on its own throws MissingProvenanceError', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const errors: unknown[] = [];
    renderWithProviders(
      <Catch onError={(e) => errors.push(e)}>
        <Provenance provenance={undefined} calendar={false} />
      </Catch>,
    );
    expect(errors[0]).toBeInstanceOf(MissingProvenanceError);
  });

  it('the fixture provider and the synthetic source kind only ever appear together (spec §5.5)', () => {
    expect(() => assertProvenance({ ...syntheticProvenance, sourceKind: 'scraped-search' })).toThrow(
      MissingProvenanceError,
    );
    expect(() => assertProvenance({ ...searchProvenance, sourceKind: 'synthetic' })).toThrow(
      MissingProvenanceError,
    );
    expect(assertProvenance(syntheticProvenance).providerId).toBe('fixture');
  });

  it('a valid price inside PriceBoundary renders normally', () => {
    renderWithProviders(
      <PriceBoundary>
        <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} />
      </PriceBoundary>,
    );
    expect(screen.getByText('£412')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Provenance shows source and age without hover (spec §11)', () => {
  it('itinerary price: badge, source in words, compact age with the full form as title; an unknown age says so', () => {
    renderWithProviders(
      <PriceCell
        pricePence={41200}
        provenance={searchProvenance}
        calendar={false}
        stale={false}
        destination="JFK"
        destinationNote={null}
      />,
    );
    expect(screen.getByText('£412')).toBeInTheDocument();
    expect(screen.getByText('SearchApi')).toBeInTheDocument();
    expect(screen.getByText('Google Flights via SearchApi')).toBeInTheDocument();
    const { compact, full } = ages(searchProvenance);
    expect(compact).toBe('5h ago · age unknown'); // canary: one literal per format
    expect(full).toBe('fetched 5h ago · provider age unknown');
    expect(screen.getByText(compact)).toHaveAttribute('title', full);
    expect(screen.queryByText('constraints not checked')).toBeNull();
    expect(screen.queryByText('≈')).toBeNull();
  });

  it('calendar price: dashed outline, "constraints not checked", ≈ on the amount for FX, destination and note', () => {
    renderWithProviders(
      <PriceCell
        pricePence={39950}
        provenance={calendarProvenance}
        calendar
        stale
        destination="EWR"
        destinationNote="onward leg not included"
      />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell.firstElementChild?.textContent).toMatch(/^≈.*£399\.50/);
    expect(screen.getByText('≈')).toHaveAttribute(
      'title',
      'converted to GBP at the 2026-10-13 rate (frankfurter)',
    );
    expect(
      screen.getByText('approximately (converted to GBP at the 2026-10-13 rate (frankfurter))'),
    ).toHaveClass('sr-only');
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByTestId('provenance').className).toContain('border-dashed');
    expect(screen.getByText('constraints not checked')).toBeInTheDocument();
    expect(screen.getByText('Aviasales cache')).toBeInTheDocument();
    const { compact, full } = ages(calendarProvenance);
    expect(compact).toBe('2h ago · ≤2d');
    expect(screen.getByText(compact)).toHaveAttribute('title', full);
    expect(screen.getByText('EWR')).toBeInTheDocument();
    expect(screen.getByText('onward leg not included')).toBeInTheDocument();
  });

  it('a calendar source kind gets the calendar marker even when the caller passes calendar={false}', () => {
    renderWithProviders(
      <PriceCell pricePence={39950} provenance={calendarProvenance} calendar={false} stale={false} />,
    );
    expect(screen.getByText('constraints not checked')).toBeInTheDocument();
    expect(screen.getByTestId('provenance').className).toContain('border-dashed');
  });

  it('a synthetic price says "Fixture" and "synthetic fixture data" (spec §5.5)', () => {
    renderWithProviders(
      <PriceCell pricePence={10000} provenance={syntheticProvenance} calendar={false} stale={false} />,
    );
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(screen.getByText('synthetic fixture data')).toBeInTheDocument();
  });

  it('truncated, not seen in the latest search, and a qualifier are each stated in words', () => {
    renderWithProviders(
      <PriceCell
        pricePence={45000}
        provenance={calendarProvenance}
        calendar
        stale={false}
        truncated
        notSeenInLatestHours="unknown"
        qualifier="incl. operator-entered onward cost"
      />,
    );
    expect(screen.getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(screen.getByText('not seen in latest search (age unknown)')).toBeInTheDocument();
    expect(screen.getByText('incl. operator-entered onward cost')).toBeInTheDocument();
  });

  it('beside the table columns the line drops provider and destination; a header shows the full age', () => {
    const { unmount } = renderWithProviders(
      <PriceCell
        pricePence={41200}
        provenance={searchProvenance}
        calendar={false}
        stale={false}
        destination="JFK"
        notSeenInLatestHours={72}
        besideColumns
      />,
    );
    const line = screen.getByTestId('provenance');
    expect(within(line).queryByText('SearchApi')).toBeNull();
    expect(within(line).queryByText('JFK')).toBeNull();
    expect(screen.getByText('not seen in latest search (3d ago)')).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} fullAge />,
    );
    expect(screen.getByText(ages(searchProvenance).full)).toBeInTheDocument();
  });

  it('an unknown vendor age is labelled "vendor\'s cache age unknown", and the price is not called stale (decision 44)', () => {
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} />,
    );
    expect(screen.getByText("vendor's cache age unknown")).toBeInTheDocument();
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('a stale price with a known age says "stale" and carries no unknown-age label', () => {
    renderWithProviders(<PriceCell pricePence={39950} provenance={calendarProvenance} calendar stale />);
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.queryByText("vendor's cache age unknown")).toBeNull();
  });

  it('an unconfirmed price says so first, beside the amount, before any other mark (decision 44)', () => {
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale unconfirmed />,
    );
    const amount = screen.getByTestId('price-cell').firstElementChild;
    const marks = [...(amount?.querySelectorAll('span') ?? [])].map((m) => m.textContent);
    expect(marks.slice(0, 2)).toEqual(['price not confirmed by the final step', 'stale']);
  });

  it('decision 46 compact: amount with "≈", short provider badge, destination and marks; source, age and note in the title', () => {
    renderWithProviders(
      <PriceCell
        pricePence={39950}
        provenance={calendarProvenance}
        calendar
        stale
        truncated
        unconfirmed
        destination="EWR"
        destinationNote="onward leg not included"
        compact
      />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveTextContent('≈');
    expect(within(cell).getByText('TP')).toBeInTheDocument();
    expect(within(cell).getByText('EWR')).toBeInTheDocument();
    expect(within(cell).getByText('stale')).toBeInTheDocument();
    expect(within(cell).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(within(cell).getByText('price not confirmed by the final step')).toBeInTheDocument();
    expect(within(cell).queryByText('Aviasales cache')).toBeNull();
    expect(within(cell).queryByText('onward leg not included')).toBeNull();
    expect(screen.queryByTestId('provenance')).toBeNull();
    const { full } = ages(calendarProvenance);
    expect(cell.getAttribute('title')).toBe(
      `Travelpayouts · Aviasales cache · ${full} · constraints not checked · onward leg not included`,
    );
    expect(cell.className).toContain('border-dashed');
  });

  it('compact itinerary price without a destination or note: badge only, title without the calendar words', () => {
    renderWithProviders(
      <PriceCell pricePence={41200} provenance={searchProvenance} calendar={false} stale={false} compact />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(within(cell).getByText('SA')).toBeInTheDocument();
    expect(cell.getAttribute('title')).toBe(
      `SearchApi · Google Flights via SearchApi · ${ages(searchProvenance).full}`,
    );
    expect(cell.className).not.toContain('border-dashed');
  });

  it('the tests clock is the fixed NOW', () => {
    expect(NOW).toBe(asIsoDateTime('2026-10-14T15:00:00.000Z'));
  });
});
```

`test/format.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  formatInstantUtc,
  formatIsoDate,
  formatIsoDateLong,
  formatIsoDateShort,
  formatLocalDateTime,
  formatMicroGbp,
  formatMinutes,
  formatSeconds,
  formatWeekday,
  parsePoundsToPence,
  penceToPoundsInput,
} from '../src/format.js';

describe('the one date-formatting module (decision 38; WP10 imports it)', () => {
  it('date and short forms from the YYYY-MM-DD string, never through Date', () => {
    expect(formatIsoDateShort('2027-03-14')).toBe('14 Mar');
    expect(formatIsoDateShort('not a date')).toBe('not a date');
    expect(formatIsoDate('2027-03-14')).toBe('14 Mar 2027');
    expect(formatIsoDate('2027-12-01')).toBe('1 Dec 2027');
    expect(formatIsoDate('not a date')).toBe('not a date');
  });

  it('long form adds the weekday from epoch-day arithmetic, across month, year and leap boundaries', () => {
    expect(formatIsoDateLong(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027');
    expect(formatIsoDateLong(asIsoDate('1970-01-01'))).toBe('Thu 1 Jan 1970');
    expect(formatIsoDateLong(asIsoDate('1969-12-31'))).toBe('Wed 31 Dec 1969');
    expect(formatIsoDateLong(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatWeekday(asIsoDate('2027-03-15'))).toBe('Mon');
  });

  it('a run instant is labelled UTC and never shifted; segment times are airport wall time', () => {
    expect(formatInstantUtc('2026-10-14T12:00:00.000Z')).toBe('14 Oct 2026 12:00 UTC');
    expect(formatLocalDateTime('2027-03-14T10:25')).toBe('14 Mar 10:25');
    expect(formatLocalDateTime('2027-03-14')).toBe('2027-03-14');
  });

  it('durations', () => {
    expect([formatMinutes(905), formatSeconds(45), formatSeconds(720), formatSeconds(7500)]).toEqual([
      '15h 05m',
      '45s',
      '12m',
      '2h 05m',
    ]);
  });
});

describe('money in pounds, held as integer pence', () => {
  it('parses pounds without floating point and refuses anything else', () => {
    expect(['12', '12.5', '12.50', ' 0.07 ', '', '12.345', '-1', '£12'].map(parsePoundsToPence)).toEqual([
      1200,
      1250,
      1250,
      7,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('round-trips pence to an editable pounds string', () => {
    expect([penceToPoundsInput(undefined), penceToPoundsInput(41200), penceToPoundsInput(2550)]).toEqual([
      '',
      '412',
      '25.50',
    ]);
  });

  it('micro-GBP rounds up, so a cost is never understated, and refuses non-integers', () => {
    expect(formatMicroGbp(12_345)).toBe('£0.02');
    expect(() => formatMicroGbp(1.5)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/components/provenance.test.tsx test/format.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/components/PriceBoundary.js"` (and `../src/format.js`, `../render.js`, `../guards.js`).

- [ ] **Step 2b: Prove the provenance check is what bites**

After Step 3, temporarily add a "graceful" fallback at the top of `PriceCell`: `if (!provenanceSchema.safeParse(props.provenance).success) return <span>{formatPence(props.pricePence)}</span>;`. Run the provenance test: "PriceCell inside PriceBoundary shows the withheld message and never the number" and "a provenance missing fetchedAt…" fail with `expected <span>£412</span> to be null` at `queryByText(/412/)`. Remove the fallback.

- [ ] **Step 3: Implement**

`tsconfig.json` — replace the file (WP0's, plus JSON modules and Vite's client types; `rootDir` goes because `src/example.ts` imports the example JSON from `docs/`, and nothing is emitted):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "types": ["vite/client"],
    "noEmit": true,
    "composite": false,
    "declaration": false
  },
  "include": ["src"]
}
```

`tsconfig.test.json` — replace the file (WP0's per-package test project, now covering the two config files too; the two-step `typecheck` script in WP0's `package.json` runs both):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "../..",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "types": ["node", "vite/client", "@testing-library/jest-dom"],
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts` — replace the file (WP0's, keeping `gmtAliases`; adds the React plugin, the jsdom origin and per-file 100% floors for the provenance, booking and URL-state files):

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

/** Provenance and booking safety components and the URL parsers: a gap here is a provenance or link gap (spec §9 item 6). */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };

// Package thresholds from the design spec §9 (web 70% lines, 60% branches); the safety-critical files are held at 100%.
// Coverage counts src/ only; barrels and the browser entry point are excluded.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'web',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'jsdom',
    // why: an absolute origin, so the client's new URL(path, origin) gives msw an interceptable absolute URL.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
        'src/components/{Provenance,PriceCell,PriceBoundary,BookingAction}.tsx': FULL,
        'src/state/{urlState,resultsState}.ts': FULL,
      },
    },
  },
});
```

`vite.config.ts` (new file):

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { gmtAliases } from '../../vitest.aliases.js';

/**
 * The SPA owns "/" with its state in search params; every core/api-contract route lives under /api
 * (spec §10), which is the one prefix the dev server proxies to the api on port 3000.
 * why: the same workspace aliases as vitest.config.ts, so `pnpm dev` and `vite build` read core from source.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  server: {
    port: 5173,
    strictPort: true,
    // why: no changeOrigin, so the api sees Host localhost:5173, which spec §4 allowlists in development.
    proxy: { '/api': { target: 'http://localhost:3000' } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`index.html` (new file):

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

`src/styles.css` (new file):

```css
/* Tailwind v4, CSS-first: no tailwind.config.js. */
@import "tailwindcss";

/* Visible focus on every interactive element (spec §11 accessibility). */
:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}
```

`test/guards.ts` (new file):

```ts
/**
 * Failures that would otherwise be swallowed: an unmatched request (TanStack Query turns it into a
 * query error, so a negative assertion could pass vacuously, review tsr-004) and console.error
 * (React act warnings, boundary reports). test/setup.ts throws in afterEach when either occurred,
 * unless the test announced, with expectConsoleErrors(pattern), the console.error it causes on purpose;
 * an error that does not match the pattern still fails, and so does a pattern that never occurred
 * (review tsr2-006).
 */
export const unhandled: string[] = [];
export const consoleErrors: unknown[][] = [];
let expected: RegExp | null = null;

/** A test that renders a broken price or a crashing view announces the console.error it expects. */
export function expectConsoleErrors(pattern: RegExp): void {
  expected = pattern;
}

/** What the finished test left behind that should fail it; resets the per-test state. */
export function drainGuards(): string[] {
  const text = consoleErrors.map((a) => a.map(String).join(' '));
  const problems = [
    ...unhandled.map((u) => `request no handler matched: ${u}`),
    ...text
      .filter((t) => expected === null || !expected.test(t))
      .map((t) => `console.error during the test: ${t}`),
    ...(expected !== null && !text.some((t) => expected?.test(t) === true)
      ? [`expected console.error ${expected} never occurred`]
      : []),
  ];
  unhandled.length = 0;
  consoleErrors.length = 0;
  expected = null;
  return problems;
}
```

`test/setup.ts` — replace the file (Task 9.3 adds msw):

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { consoleErrors, drainGuards } from './guards.js';
import { setViewportWidth } from './viewport.js';

beforeEach(() => {
  // why: jsdom has no matchMedia; every test starts wide and opts into 375px explicitly.
  setViewportWidth(1280);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
});
afterEach(() => {
  // why: Vitest runs without globals, so RTL's automatic cleanup never registers.
  cleanup();
  vi.restoreAllMocks();
  const problems = drainGuards();
  if (problems.length > 0) throw new Error(problems.join(' | '));
});
```

`test/viewport.ts` (new file):

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
        matches,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}
```

`test/render.tsx` (new file):

```tsx
import { asIsoDateTime, type IsoDateTime, type Provenance } from '@gmt/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { NowContext } from '../src/now.js';

/** The fixed "now" of every web test; fixtures are dated relative to it. */
export const NOW: IsoDateTime = asIsoDateTime('2026-10-14T15:00:00.000Z');

/**
 * Renders with a fresh QueryClient (no retries), a fixed clock and the given search string. With
 * `fakeTimers`, user-event advances Vitest's fake clock, so a debounce is stepped explicitly.
 */
export function renderWithProviders(ui: ReactElement, opts: { search?: string; fakeTimers?: boolean } = {}) {
  window.history.replaceState(null, '', `/${opts.search ?? ''}`);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  const user =
    opts.fakeTimers === true ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) : userEvent.setup();
  const result = render(
    <QueryClientProvider client={client}>
      <NowContext.Provider value={() => NOW}>{ui}</NowContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, user, client };
}

/**
 * Waits until no query or mutation is in flight, then one more macrotask, so a negative request-count
 * assertion runs after any request the last event could have caused (review tsr2-002).
 */
export async function settled(client: QueryClient): Promise<void> {
  await waitFor(() => {
    if (client.isFetching() + client.isMutating() > 0) throw new Error('requests in flight');
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A provenance in wire form (plain strings). core types `provenanceSchema` as `z.ZodType<Provenance>`,
 * whose input is unknown, so the shape is spelled out here; the schema still validates every use.
 */
export type ProvenanceInput = Omit<Provenance, 'fetchedAt' | 'providerObservedAt' | 'fx'> & {
  fetchedAt: string;
  providerObservedAt?: string;
  fx: { converted: false } | { converted: true; rateNano: number; rateDate: string; source: string };
};
```

`src/now.tsx` (new file):

```tsx
import { type IsoDateTime, isoDateTimeOfEpochMs } from '@gmt/core';
import { createContext, useContext } from 'react';

/** The clock components read; tests pin it. Spec §3 ages are computed against it. */
export const NowContext = createContext<() => IsoDateTime>(() => isoDateTimeOfEpochMs(Date.now()));

/** Current instant in toISOString form (spec §6.3). */
export function useNow(): IsoDateTime {
  return useContext(NowContext)();
}
```

`src/format.ts` (new file; decision 38: the one date-formatting module, WP10 imports it):

```ts
import { formatPence, type IsoDate, microGbpToPence, toEpochDay } from '@gmt/core';

// why: core's formatPence (src/text/money.ts: en-GB grouping, throws on non-integer or negative) is the
// single money formatter for web and email; re-exported so components keep one import site.
export { formatPence };

/**
 * The one month and weekday table of the web app (plan decision 38: WP10 imports these formatters
 * rather than writing its own). Every date is formatted from its `YYYY-MM-DD` string, never through
 * a `Date`, so a browser outside Europe/London cannot shift a day (review focus 3).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Indexed by (epoch day + 4) mod 7: 1970-01-01, epoch day 0, was a Thursday. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Integer micro-GBP → pence through core's `microGbpToPence` (rounded up, so a cost is never understated; decision 49) → "£…". */
export function formatMicroGbp(micro: number): string {
  if (!Number.isInteger(micro) || micro < 0)
    throw new RangeError(`micro-GBP must be a non-negative integer, got ${micro}`);
  return formatPence(microGbpToPence(micro));
}

/** Date form, "2027-03-14" → "14 Mar 2027", by string slicing only; anything malformed is returned as given. */
export function formatIsoDate(d: string): string {
  const [y, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (y === undefined || day === undefined || month === undefined) return d;
  return `${Number(day)} ${month} ${y}`;
}

/** Short form without the year, "2027-03-14" → "14 Mar" (day cells, segment times); malformed input is returned as given. */
export function formatIsoDateShort(d: string): string {
  const [, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (day === undefined || month === undefined) return d;
  return `${Number(day)} ${month}`;
}

/** Weekday form, "2027-03-14" → "Sun", from core's epoch-day arithmetic (never a Date). */
export function formatWeekday(d: IsoDate): string {
  return WEEKDAYS[(((toEpochDay(d) + 4) % 7) + 7) % 7] ?? '';
}

/** Long form with the weekday, "2027-03-14" → "Sun 14 Mar 2027". */
export function formatIsoDateLong(d: IsoDate): string {
  return `${formatWeekday(d)} ${formatIsoDate(d)}`;
}

/** A run's UTC instant, "2026-10-14T12:00:00.000Z" → "14 Oct 2026 12:00 UTC" (labelled UTC, never shifted). */
export function formatInstantUtc(iso: string): string {
  return `${formatIsoDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
}

/** Segment local time "2027-03-14T10:25" → "14 Mar 10:25" (wall time at the airport, spec §6.4). */
export function formatLocalDateTime(local: string): string {
  const [date, time] = local.split('T');
  if (date === undefined || time === undefined) return local;
  return `${formatIsoDateShort(date)} ${time}`;
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

/** A typed pounds string in its canonical form ("450.5" → "450.50", junk → ""): what useSynced compares. */
export function poundsText(input: string): string {
  return penceToPoundsInput(parsePoundsToPence(input));
}
```

`src/copy.ts` (new file; the whole catalogue, later tasks only import from it):

```ts
import {
  type apiContract,
  type Buckets,
  type Cabin,
  CONSTRAINT_LABELS,
  type ConstraintName,
  type ExecutionStatus,
  formatAgo,
  type ProviderId,
  type SourceKind,
  type Stage,
  type Verdict,
  type VerdictClass,
} from '@gmt/core';
import type { z } from 'zod';

/** Derived from the contract (decision 46), so a new plan id or bucket fails `satisfies` here. */
type PlanId = z.output<typeof apiContract.providersResponseSchema>['providers'][number]['plan'];
/** The six coverage buckets; `reused` is a count beside them, not a bucket (spec §3). */
export type BucketName = Exclude<keyof Buckets, 'reused'>;

/**
 * Every user-facing string of the web app. Spec §11: the banned-word list applies to all copy,
 * and "verified" appears only beside class-verified values. Components import from here and
 * never write literal copy in JSX (test/copy/sourceGuard.test.ts enforces that); the catalogue
 * test walks every entry. Strings that come from the API (basisReason, error messages, the
 * zero-cap message, provenance notes, search-link labels, airport names) are WP8's and core's and
 * are tested there. The worked example's words live in src/example.ts and arrive as arguments.
 */
export const COPY = {
  appTitle: 'get-me-there',
  navLabel: 'Views',
  nav: {
    results: 'Results',
    calendar: 'Calendar',
    duration: 'Duration',
    history: 'History',
    coverage: 'Coverage',
    definitions: 'Definitions',
    alerts: 'Alerts',
    providers: 'Providers',
  },
  placeholder: 'This view is not available yet.',
  calendarPlaceholderHint:
    'Until it is, the Results filters slice the window by month: set "Departs on or after" and "Departs on or before".',
  definitionSelectorLabel: 'Search definition',
  noDefinitions: 'No search definitions yet. Create one under Definitions.',
  definitionNotFound: 'The definition in this link no longer exists. Pick another one above.',
  loading: 'Loading…',
  loadFailed: (message: string) => `Could not load: ${message}`,
  retryLoad: 'Try again',
  actionFailed: (message: string) => `That did not work: ${message}`,
  appFailed: 'Something went wrong while drawing this page. Reload to try again; nothing was sent.',
  providersUnknown: (message: string) =>
    `Provider status unknown, so this page cannot say whether its prices are synthetic: ${message}`,
  emptyNoProviders:
    'No flight data provider is configured. Set TRAVELPAYOUTS_TOKEN in .env for the free Aviasales cache, or SEARCHAPI_KEY for Google Flights via SearchApi, then restart the app.',
  syntheticBanner:
    'Synthetic data: the fixture provider is enabled. Every price on this page is made up for development and testing.',

  // provenance (spec §11)
  priceWithheld: 'price withheld: provenance missing',
  provider: { travelpayouts: 'Travelpayouts', searchapi: 'SearchApi', fixture: 'Fixture' } satisfies Record<
    ProviderId,
    string
  >,
  source: {
    'authorised-cached': 'Aviasales cache',
    'scraped-aggregate': 'Google date grid via SearchApi',
    'scraped-search': 'Google Flights via SearchApi',
    synthetic: 'synthetic fixture data',
  } satisfies Record<SourceKind, string>,
  fxApprox: '≈',
  fxSpoken: (detail: string) => `approximately (${detail})`,
  fxTitle: (rateDate: string, source: string) => `converted to GBP at the ${rateDate} rate (${source})`,
  constraintsNotChecked: 'constraints not checked',
  notChecked: 'not checked',
  stale: 'stale',
  vendorAgeUnknown: "vendor's cache age unknown",
  // why: core's label, so web, email and the verdict list say the same words (decisions 37, 44).
  priceNotConfirmed: CONSTRAINT_LABELS.priceConfirmed,
  staleView: 'Every row here is older than one refresh cycle.',
  bandCheapest: 'cheapest in its 6h travel-time band',
  notSeenInLatest: (age: string) => `not seen in latest search (${age})`,
  truncatedNote: 'cheapest of the rows read',
  providerShort: { travelpayouts: 'TP', searchapi: 'SA', fixture: 'synthetic' } satisfies Record<
    ProviderId,
    string
  >,
  ageUnknown: 'age unknown',
  agoOf: (hours: number | 'unknown') => (hours === 'unknown' ? 'age unknown' : formatAgo(hours)),
  adjustedQualifier: 'incl. operator-entered onward cost',

  // classes, bases, verdicts (spec §3, §6.2, §6.9)
  classLabel: {
    verified: 'verified',
    'partially-verified': 'partially verified',
    failed: 'failed',
    unchecked: 'constraints not checked',
  } satisfies Record<VerdictClass | 'unchecked', string>,
  classSpoken: 'verdict class:',
  basisName: { verified: 'itinerary-search basis', calendar: 'calendar basis' },
  basisSwitchLabel: 'Price basis',
  // why: core's CONSTRAINT_LABELS is the one set of plain-English constraint names (web and email); kept
  // under COPY so the catalogue test sweeps it for banned words like every other string.
  constraint: CONSTRAINT_LABELS satisfies Record<ConstraintName, string>,
  verdictWord: { pass: 'pass', fail: 'fail', unverified: 'unverified' } satisfies Record<Verdict, string>,
  verdictGlyph: { pass: '✓', fail: '✗', unverified: '?' } satisfies Record<Verdict, string>,
  verdictLine: (constraint: string, verdict: string) => `${constraint}: ${verdict}`,
  verdictsHeading: 'Constraint verdicts',
  noVerdicts: 'No constraints evaluated for this row.',
  notApplied: (names: string) => `not applied: ${names}`,
  unverifiedList: (names: string) => `unverified: ${names}`,

  // results table
  columns: {
    expand: 'Details',
    price: 'Price',
    totalTime: 'Travel time',
    departure: 'Departure',
    return: 'Return',
    nights: 'Nights',
    destination: 'Destination',
    carriers: 'Carriers',
    stops: 'Stops',
    class: 'Class',
    fetched: 'Fetched',
    provider: 'Provider',
    adjusted: 'Adjusted (operator-entered onward cost)',
  },
  resultsTableLabel: 'Round trips found',
  sortBy: (column: string, dir: string) => `Sort by ${column}, ${dir}`,
  sortDir: { asc: 'ascending', desc: 'descending' },
  sortSelect: 'Sort rows by',
  sortOption: (column: string, dir: string) => `${column}, ${dir}`,
  serverOrder: 'server ranking (class, then price)',
  orderNow: (order: string) => `Order: ${order}`,
  sortedWithin: (column: string, shown: number, total: number) =>
    `sorted by ${column} within the cheapest ${shown} of ${total}`,
  showDetails: (what: string) => `Show details for ${what}`,
  hideDetails: (what: string) => `Hide details for ${what}`,
  detailsFor: (what: string) => `Details for ${what}`,
  rowName: (destination: string, departure: string, ret: string) => `${destination} ${departure} to ${ret}`,
  stopsValue: (out: number, back: number) => `${out} out · ${back} back`,
  nightsValue: (n: number) => `${n}n`,
  noRowsFromRun: 'This run has no rows on this basis. Coverage shows what was searched and what was not.',
  noRowsAfterFilter: 'No rows match these filters.',
  showingRows: (shown: number, total: number) => `showing ${shown} of ${total} rows (filters active)`,
  staleHidden: (n: number) => `${n} stale ${n === 1 ? 'row' : 'rows'} hidden`,
  failedHidden: (n: number) => `${n} failed ${n === 1 ? 'row' : 'rows'} hidden by default`,
  showFailed: 'Show failed rows',

  // results header (spec §11)
  headlineLead: 'cheapest found',
  headlineRest: (p: { destination: string; dates: string; basis: string; cls: string }) =>
    `${p.destination} ${p.dates} · ${p.basis} · ${p.cls}`,
  headlineOverall: 'overall, filters not applied',
  dateRange: (dep: string, ret: string, nights: number) => `${dep}–${ret} (${nights}n)`,
  noHeadline: 'No round trip found yet for this definition.',
  coverageLine: (c: {
    priced: number;
    empty: number;
    noData: number;
    error: number;
    skipped: number;
    notRun: number;
    total: number;
    reused: number;
  }) =>
    `discovery: ${c.priced} priced · ${c.empty} no fares · ${c.noData} no cached data · ${c.error} error · ${c.skipped} skipped · ${c.notRun} not searched of ${c.total} (${c.reused} reused)`,
  itineraryLine: (c: { searched: number; selected: number; onDemand: number }) =>
    ` · itinerary-searched ${c.searched} of ${c.selected} selected +${c.onDemand} on demand`,
  itineraryLineExpand: (c: { searched: number; selected: number; expandTop: number; onDemand: number }) =>
    ` · itinerary-searched ${c.searched} of ${c.selected} selected (${c.expandTop} outbounds each) +${c.onDemand} on demand`,
  noItinerarySearch: ' · itinerary search not configured',
  truncated: (shown: number, total: number) => `within the cheapest ${shown} of ${total}`,
  excludedByCurrentSpace: (n: number) =>
    `${n} rows outside the current window and nights range are not shown`,

  // view header (spec §11)
  executionsShown: (list: string) => `showing ${list}`,
  executionItem: (started: string, status: string, age: string) =>
    `run started ${started} (${status}, ${age})`,
  childExecutionItem: (started: string, status: string, age: string) =>
    `itinerary search for one cell, started ${started} (${status}, ${age})`,
  executionNotStarted: (status: string) => `run not started yet (${status})`,
  childExecutionNotStarted: (status: string) => `itinerary search for one cell, not started yet (${status})`,
  spanExecutions: (n: number) => `across ${n} ${n === 1 ? 'run' : 'runs'}; no single run status applies`,
  notCompletedBanner: (status: string) => `The latest run is ${status}; these results may be partial.`,
  noExecution: 'No run yet for this definition.',
  statusName: {
    pending: 'pending',
    running: 'running',
    paused_budget: 'paused: budget',
    paused_error: 'paused: error',
    interrupted: 'interrupted',
    cancelled: 'cancelled',
    completed: 'completed',
    skipped_budget: 'skipped: over budget',
    skipped_confirm: 'skipped: cost not confirmed',
    skipped_window: 'skipped: window has no dates',
    skipped_missed: 'skipped: missed while the app was stopped',
  } satisfies Record<ExecutionStatus, string>,
  stageName: { discovery: 'discovery', verification: 'itinerary search' } satisfies Record<Stage, string>,

  // status bar (spec §11)
  statusBarLabel: 'Run status',
  progress: (p: {
    stage: string;
    provider: string;
    verb: string;
    done: number;
    total: number;
    error: number;
    skipped: number;
    notRun: number;
  }) =>
    `${p.stage} · ${p.provider}: ${p.verb} ${p.done} of ${p.total} cells (${p.error} error) · ${p.skipped} skipped · ${p.notRun} not searched`,
  progressSelected: (p: {
    provider: string;
    done: number;
    selected: number;
    error: number;
    skipped: number;
    notRun: number;
  }) =>
    `itinerary search · ${p.provider}: itinerary-searched ${p.done} of ${p.selected} selected (${p.error} error) · ${p.skipped} skipped · ${p.notRun} not searched`,
  progressVerb: { discovery: 'searched', verification: 'itinerary-searched' } satisfies Record<Stage, string>,
  progressLabel: (stage: string, provider: string) => `${stage} progress, ${provider}`,
  spendRunCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} billed calls`,
  spendRunFreeCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} free calls`,
  spendRunCost: (used: string, cap: string) => `this run: ${used} of ${cap}`,
  spendMonth: (used: string, cap: string) => `this month: ${used} of ${cap}`,
  spendProviderMonth: (provider: string, calls: number, cap: string) =>
    `this month: ${provider} ${calls} of ${cap} calls`,
  nearCap: 'near cap',
  noCap: 'no cap',
  paused: (reason: string) => `Paused: ${reason}`,
  resumesAt: (when: string) => `resumes ${when}`,
  scheduleBlocked: (date: string) => `schedule blocked since ${date}`,
  childRun: (status: string) => `itinerary search for one cell: ${status}`,
  resume: 'Resume',
  cancel: 'Cancel',
  confirmCancel: 'Confirm: cancel this run',
  keepRunning: 'Keep running',
  runNow: (calls: number, cap: number, cost: string) =>
    `Run now (about ${calls} calls (hard stop ${cap}), ${cost})`,
  runNowUnestimated: 'Run now',
  runNowBlocked: 'The estimate is above what you confirmed; confirm it under Definitions before running.',

  // filters (spec §6.5)
  filtersHeading: 'Filter',
  filtersSummary: (n: number) => `Filters (${n} active)`,
  filterClass: 'Verdict class',
  filterProvider: 'Provider',
  filterMaxStops: 'Max stops',
  filterCarriers: 'Carriers (comma-separated codes)',
  carriersIgnored: (entries: string) => `ignored, not two-character carrier codes: ${entries}`,
  filterDestinations: 'Destination',
  filterMaxPrice: 'Max price (£)',
  filterNightsMin: 'Min nights',
  filterNightsMax: 'Max nights',
  filterDepartFrom: 'Departs on or after',
  filterDepartTo: 'Departs on or before',
  filterHideStale: 'Hide stale rows',
  filterUnverified: 'Has this constraint unverified',
  any: 'any',
  applyFilters: 'Apply',
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
  refundable: (v: boolean | undefined) =>
    v === undefined ? 'refunds not stated' : v ? 'refundable' : 'not refundable',
  changeable: (v: boolean | undefined) =>
    v === undefined ? 'changes not stated' : v ? 'changeable' : 'not changeable',
  seller: (s: string) => `sold by ${s}`,
  booking: 'Booking',
  noLink: 'no link',
  openOn: (host: string) => `open on ${host}`,
  continueOnForm: (host: string) => `continue on ${host} (sends a form)`,
  noSearchLink: 'no search link',
  hostShown: (host: string) => `(${host})`,
  otherOffers: 'Other sellers for this itinerary',
  summary: 'Summary',
  verifyCell: 'Search this cell for itineraries (uses billed calls)',
  verifyStarted: 'Itinerary search started for this cell; the status bar follows it.',

  // basis and calendar gap (spec §6.9, §11)
  calendarGapLead: (n: number) =>
    `${n} ${n === 1 ? 'cell has a calendar price' : 'cells have calendar prices'} (constraints not checked) below your cheapest verified`,
  calendarGapList: 'Cells to search',

  // coverage view (spec §11 View D)
  coverageHeading: 'Coverage',
  coverageStage: 'Stage',
  coverageProvider: 'Provider',
  bucket: {
    priced: 'priced',
    empty: 'no fares',
    no_data: 'no cached data',
    error: 'error',
    skipped: 'skipped',
    not_run: 'not searched',
  } satisfies Record<BucketName, string>,
  coverageCells: 'cells',
  reusedNote: (n: number) => `(${n} reused from earlier runs)`,
  cellLabel: (o: string, d: string, dep: string, ret: string) => `${o} → ${d} ${dep} to ${ret}`,
  coverageSearched: 'searched (priced + no fares + no cached data)',
  coverageWithPrice: 'with a price',
  withPriceValue: (priced: number, total: number) => `${priced} of ${total}`,
  coverageScroll: 'Coverage counts (scrolls sideways on a narrow screen)',
  coverageLegend: 'What the columns mean',
  bucketHelp: {
    priced:
      'priced: the provider returned a price for exactly this cell; for itinerary search that may be a price not confirmed by the final step.',
    empty: 'no fares: the provider said there are no fares for this cell.',
    no_data: 'no cached data: asked, nothing returned; this is not evidence that no flights exist.',
    error: 'error: the request failed; the error list below says why.',
    skipped: 'skipped: deliberately not asked (not selected, over budget, provider disabled, or departed).',
    not_run: 'not searched: not asked yet. Different from no fares: nobody has looked.',
  } satisfies Record<BucketName, string>,
  searchedHelp: 'searched: priced + no fares + no cached data, the cells a provider answered.',
  withPriceHelp: 'with a price: the cells that have a price, out of every cell.',
  coverageEmpty: 'No run yet, so nothing has been searched.',
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
  errorRow: (reason: string, attempts: number) =>
    `${reason} after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
  lastError: (message: string) => `(${message})`,
  noErrors: 'No errors.',
  retry: 'Retry errors',

  // providers view (spec §10, §11)
  providersHeading: 'Providers',
  providerEnabled: 'configured',
  providerDisabled: 'not configured',
  plan: (p: string) => `plan: ${p}`,
  planName: {
    trial: 'SearchApi trial credits (lifetime allowance)',
    '40usd': 'SearchApi $40 a month',
    free: 'free',
    synthetic: 'synthetic fixture',
  } satisfies Record<PlanId, string>,
  capability: (title: string, source: string, age: string) => `${title}: ${source} · ${age}`,
  capabilityDiscovery: 'Discovery',
  capabilityVerification: 'Itinerary search',
  maxAge: (age: string) => `prices up to ${age} old when fetched`,
  maxAgeUnknown: 'provider age unknown',
  maxAgeAtFetch: 'provider states no age beyond the fetch time',
  usageWindow: (calls: number, cap: string, start: string, end: string) =>
    `${calls} of ${cap} calls · window ${start} to ${end}`,
  usageLifetime: (calls: number, cap: string) => `${calls} of ${cap} calls over the plan's lifetime`,
  usageNoWindow: (calls: number, cap: string) => `${calls} of ${cap} calls`,
  excludedFromSchedule: 'excluded from scheduled runs',

  // definitions form (spec §11)
  definitionsHeading: 'Definitions',
  definitionsList: 'Definitions to edit',
  newDefinition: 'New definition',
  editDefinition: (name: string) => `Edit ${name}`,
  name: 'Name',
  origins: 'Origins',
  destinations: 'Destinations',
  airportInputHelp: 'Type an airport code or name. A three-letter code is upper-cased.',
  addAirport: 'Add',
  addOrigin: 'Add origin',
  addDestination: 'Add destination',
  removeAirport: (code: string) => `Remove ${code}`,
  iataFormat: 'An airport code is three letters.',
  duplicateAirport: (code: string) => `${code} is already in the list.`,
  metroExpanded: (code: string, airports: string) => `${code} is a city code: added ${airports}.`,
  airportOption: (name: string, city: string, country: string) => `${name}, ${city}, ${country}`,
  destinationNote: (iata: string) => `Note for ${iata} (shown on every row)`,
  onwardCost: (iata: string) => `Onward cost to ${iata} in £ (optional, shown as a separate adjusted column)`,
  windowHeading: 'Departure window',
  windowRelative: 'Relative to today',
  windowAbsolute: 'Fixed dates',
  startOffsetDays: 'Starts in (days)',
  lengthDays: 'Length (days)',
  resolvedWindow: (from: string, to: string) => `departures from ${from} to ${to}, as resolved today`,
  windowFrom: 'From',
  windowTo: 'To',
  minNights: 'Min nights',
  maxNights: 'Max nights',
  cabin: 'Cabin',
  cabinName: {
    economy: 'economy',
    premium_economy: 'premium economy',
    business: 'business',
    first: 'first',
  } satisfies Record<Cabin, string>,
  enabled: 'Enabled: scheduled runs happen',
  advanced: 'Advanced: constraints and policy',
  constraintsHeading: 'Constraints',
  inPounds: (label: string) => `${label} (£)`,
  minutesAsHours: (text: string) => `= ${text}`,
  timeFrom: 'from',
  timeTo: 'to',
  airlinesHelp: 'comma-separated carrier codes',
  policyHeading: 'Itinerary search policy',
  maxCells: 'Max cells per run',
  topN: 'Top N by discovery price',
  priceCeiling: 'Price ceiling in £ (optional)',
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
  maxCost: 'Max cost per run in £',
  scheduleHeading: 'Schedule',
  scheduleCron: 'Cron (blank: manual runs only)',
  scheduleTz: 'Time zone',
  coverageCheck: 'Check free coverage',
  coverageCheckIntro:
    'Free check of the Aviasales cache for these pairs: cells with a cached price, of the cells in your nights range, per departure month. A count of 0 means the cache has nothing for that pair and month, not that there are no flights; "not checked" means the check could not read that month.',
  coverageCheckNeedsTravelpayouts: 'The free coverage check needs TRAVELPAYOUTS_TOKEN.',
  coverageCheckPair: (o: string, d: string) => `${o} → ${d}`,
  coverageCheckCalls: (n: number) => `${n} free tile requests used`,
  coverageCheckMonth: 'Month',
  coverageCheckStale: 'The airports, window or nights changed since this check; run it again.',
  cachedOf: (rows: number, cells: number) => `${rows} of ${cells}`,
  importExample: (label: string) => `Import example (${label})`,
  showEstimate: 'Show estimate',
  estimateStale: 'The draft changed since this estimate; show the estimate again before creating.',
  save: 'Save changes',
  createConfirm: (calls: number, cap: number, amount: string) =>
    `Create and confirm about ${calls} calls (hard stop ${cap}), ${amount} per run`,
  created: 'Created. Scheduled runs use the calls and cost you confirmed.',
  saved: 'Saved.',
  fieldErrorsHeading: 'Fix these before saving:',
  fieldError: (field: string, message: string) => `${field}: ${message}`,
  estimateHeading: 'Estimate',
  estimateCells: (n: number) => `${n} cells`,
  estimateRow: (provider: string, stage: string, calls: number, cost: string, time: string) =>
    `${provider} ${stage}: ${calls} calls · ${cost} · about ${time}`,
  estimateTotal: (calls: number, cap: number, cost: string, time: string) =>
    `about ${calls} calls (hard stop ${cap}), ${cost} per run · about ${time}`,
  windowClamped: 'The window was moved to start tomorrow.',
  estimateBlocked: (reason: string) => `blocked: ${reason}`,
  definitionNotices: 'Notices for this definition',
  assumptions: 'Assumptions',
  budgetFitOk: (runs: number) => `Fits every cap at ${runs} runs a month:`,
  budgetFitWarn: (runs: number) => `Does not fit every cap at ${runs} runs a month:`,
  budgetScope: (scope: string, estimated: number, cap: string) =>
    `${scope}: ${estimated} estimated a month, cap ${cap}`,
  overCap: 'over the cap',
  needsConfirmation: (p: { calls: number; cap: number; estimate: string; confirmed: string }) =>
    `The new estimate, about ${p.calls} calls (hard stop ${p.cap}) and ${p.estimate} per run, is above what you confirmed (${p.confirmed}). Scheduled runs are skipped until you confirm.`,
  confirmedWas: (calls: string, amount: string) => `${calls} calls, ${amount}`,
  confirmNew: (calls: number, cap: number, amount: string) =>
    `Confirm about ${calls} calls (hard stop ${cap}), ${amount} per run`,
  none: 'none',
} as const;
```

`src/components/Provenance.tsx` (new file):

```tsx
import {
  effectiveAge,
  formatAgeCompact,
  formatAgeFull,
  type Provenance as ProvenanceT,
  provenanceSchema,
  type SourceKind,
} from '@gmt/core';
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
 * maxAgeHours missing) fails exactly like undefined. Spec §3: nothing is defaulted. Spec §5.5: a
 * `fixture` provider id and a `synthetic` source kind only ever appear together.
 */
export function assertProvenance(p: unknown): ProvenanceT {
  const r = provenanceSchema.safeParse(p);
  if (!r.success)
    throw new MissingProvenanceError(r.error.issues.map((i) => i.path.join('.') || '(root)').join(', '));
  if ((r.data.providerId === 'fixture') !== (r.data.sourceKind === 'synthetic')) {
    throw new MissingProvenanceError(`provider ${r.data.providerId} with source ${r.data.sourceKind}`);
  }
  return r.data;
}

/** Source kinds that only ever carry calendar prices (spec §2): they always get the calendar marker. */
const CALENDAR_SOURCES: ReadonlySet<SourceKind> = new Set(['authorised-cached', 'scraped-aggregate']);

/** True for a price the caller marks as calendar basis or whose source kind only carries calendar prices. */
export function isCalendarPrice(p: ProvenanceT, calendar: boolean): boolean {
  return calendar || CALENDAR_SOURCES.has(p.sourceKind);
}

export interface ProvenanceProps {
  /** Validated here: anything that is not a complete provenance throws MissingProvenanceError. */
  provenance: unknown;
  /** Calendar-basis price: dashed outline and "constraints not checked" (spec §11). Implied by a calendar source kind. */
  calendar: boolean;
  destination?: string | undefined;
  destinationNote?: string | null | undefined;
  /** False only beside the wide Results table's columns, whose Provider column already names the provider (ruling on UI-14). */
  showProvider?: boolean;
  /** Headers show the full age form visibly (spec §3, §11); rows show the compact form with the full one as title. */
  fullAge?: boolean;
}

/** Spec §11 provenance block, visible without hover. */
export function Provenance({
  provenance,
  calendar,
  destination,
  destinationNote,
  showProvider = true,
  fullAge = false,
}: ProvenanceProps) {
  const now = useNow();
  const p = assertProvenance(provenance);
  const age = effectiveAge(p, now);
  const isCalendar = isCalendarPrice(p, calendar);
  return (
    <span
      data-testid="provenance"
      className={`inline-flex flex-wrap items-center gap-1 text-xs text-slate-700 ${isCalendar ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      {showProvider ? (
        <span className="rounded bg-slate-200 px-1 font-medium text-slate-900">
          {COPY.provider[p.providerId]}
        </span>
      ) : null}
      <span>{COPY.source[p.sourceKind]}</span>
      {fullAge ? (
        <span>{formatAgeFull(age)}</span>
      ) : (
        <span title={formatAgeFull(age)}>{formatAgeCompact(age)}</span>
      )}
      {isCalendar ? <span className="font-medium">{COPY.constraintsNotChecked}</span> : null}
      {destination !== undefined ? <span>{destination}</span> : null}
      {destinationNote ? <span className="italic">{destinationNote}</span> : null}
    </span>
  );
}
```

`src/components/PriceCell.tsx` (new file):

```tsx
import { type ConstraintName, effectiveAge, formatAgeFull, type Verdicts } from '@gmt/core';
import { COPY } from '../copy.js';
import { formatPence } from '../format.js';
import { useNow } from '../now.js';
import { assertProvenance, isCalendarPrice, Provenance } from './Provenance.js';

/**
 * True when the final step did not confirm the price (decisions 37, 44): core judges `priceConfirmed`
 * only as `unverified`, so either the verdict or the unverified list says so.
 */
export function priceUnconfirmed(r: { unverified: readonly ConstraintName[]; verdicts?: Verdicts }): boolean {
  return r.unverified.includes('priceConfirmed') || r.verdicts?.priceConfirmed === 'unverified';
}

export interface PriceCellProps {
  pricePence: number;
  /** Validated before anything renders; typed unknown because validation is this component's job. */
  provenance: unknown;
  calendar: boolean;
  stale: boolean;
  /** The price is the cheapest of the rows a truncated tile read (decision 36). */
  truncated?: boolean;
  /** The final step did not confirm the price: the primary badge, beside the amount (decision 44). */
  unconfirmed?: boolean;
  destination?: string | undefined;
  destinationNote?: string | null | undefined;
  /** The row's `notSeenInLatest.ageHours`, when the latest search no longer returned it. */
  notSeenInLatestHours?: number | 'unknown' | null;
  /** A words-only qualifier after the amount, e.g. the adjusted price's "incl. operator-entered onward cost". */
  qualifier?: string;
  /** Beside the wide Results table's columns: the Provider and Destination columns carry those, so the line omits them. */
  besideColumns?: boolean;
  /**
   * Decision 46's compact variant (WP10's calendar day cells): the amount with "≈", a short provider badge,
   * the destination code and the stale, truncated and unconfirmed marks; source words, the age line and the
   * destination note move to the title. WP10 adds props here, never a second price component.
   */
  compact?: boolean;
  /** Headers: the full age form, visible (spec §11). */
  fullAge?: boolean;
}

const badge = 'ml-1 rounded px-1 text-xs font-normal';

/**
 * The only component that prints a price (spec §11, §9 item 6); wrap it in PriceBoundary. The "≈"
 * sits on the amount, so a converted price can never be read as exact. An unconfirmed price says so
 * first; a stale one says "stale"; a price whose vendor age is unknown is labelled, not called stale
 * (decision 44: staleness is by fetch age).
 */
export function PriceCell(props: PriceCellProps) {
  const now = useNow();
  // why: validate before formatting, so a bare number can never reach the DOM even for one frame.
  const p = assertProvenance(props.provenance);
  const age = effectiveAge(p, now);
  const fxTitle = p.fx.converted ? COPY.fxTitle(p.fx.rateDate, p.fx.source) : null;
  const notSeen = props.notSeenInLatestHours ?? null;
  const compact = props.compact === true;
  const calendar = isCalendarPrice(p, props.calendar);
  const detail = [
    COPY.provider[p.providerId],
    COPY.source[p.sourceKind],
    formatAgeFull(age),
    ...(calendar ? [COPY.constraintsNotChecked] : []),
  ];
  return (
    <span
      data-testid="price-cell"
      title={
        compact
          ? [...detail, ...(props.destinationNote ? [props.destinationNote] : [])].join(' · ')
          : undefined
      }
      className={`flex flex-col gap-0.5 ${compact && calendar ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      <span className="font-semibold tabular-nums">
        {fxTitle !== null ? (
          <>
            <span aria-hidden="true" title={fxTitle}>
              {COPY.fxApprox}
            </span>
            <span className="sr-only">{COPY.fxSpoken(fxTitle)}</span>
          </>
        ) : null}
        {formatPence(props.pricePence)}
        {props.qualifier !== undefined ? (
          <span className="ml-1 text-xs font-normal">{props.qualifier}</span>
        ) : null}
        {props.unconfirmed === true ? (
          <span className={`${badge} border border-red-800 bg-red-50 font-semibold text-red-900`}>
            {COPY.priceNotConfirmed}
          </span>
        ) : null}
        {props.stale ? <span className={`${badge} bg-amber-200`}>{COPY.stale}</span> : null}
        {age.kind === 'unknown' ? (
          <span className={`${badge} bg-slate-100`}>{COPY.vendorAgeUnknown}</span>
        ) : null}
      </span>
      {compact ? (
        <span className="inline-flex gap-1 text-xs">
          <span className="rounded bg-slate-200 px-1 font-medium">{COPY.providerShort[p.providerId]}</span>
          {props.destination !== undefined ? <span>{props.destination}</span> : null}
        </span>
      ) : (
        <Provenance
          provenance={p}
          calendar={props.calendar}
          destination={props.besideColumns === true ? undefined : props.destination}
          destinationNote={props.destinationNote}
          showProvider={props.besideColumns !== true}
          fullAge={props.fullAge === true}
        />
      )}
      {props.truncated === true ? <span className="text-xs font-medium">{COPY.truncatedNote}</span> : null}
      {notSeen !== null ? <span className="text-xs">{COPY.notSeenInLatest(COPY.agoOf(notSeen))}</span> : null}
    </span>
  );
}
```

`src/components/PriceBoundary.tsx` (new file):

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
    // why: a withheld price is a contract bug; make it loud in the console without breaking the page.
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

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/components/provenance.test.tsx test/format.test.ts test/smoke.test.ts`
Expected: PASS, 17 + 7 + 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: web config, copy catalogue, date formats, provenance-checked price cell"
```

### Task 9.2: Banned words over the catalogue; AST guards for copy and money

**Files:**
- Test: `test/copy/catalogue.test.ts`, `test/copy/sourceGuard.test.ts`

**Interfaces:**
- Consumes: `BANNED_WORD_ALLOWLIST`, `findBannedWords` (WP0, the single allowlist every package passes); `COPY` (Task 9.1); the TypeScript compiler API (`typescript`, the workspace root's pinned devDependency).
- Produces: `copyOffenders`, `moneyOffenders` (exported from the test file for its own planted-offender test); nothing in `src`.

Chosen approach (spec §9 item 6 "over every string in apps/web/src"): the **catalogue** `src/copy.ts` holds all copy, and guards make that true. (1) The catalogue test walks every string and calls every function entry with sample arguments, failing when a function has no sample; it also pins the confirmation wording "about N calls (hard stop M)", never "up to" (decision 44). (2) The source guard parses every file with the TypeScript compiler, not a regex (reviews tsr-007, arch-018), and fails on: JSX text containing a letter, on one line or many; a lettered string or template literal rendered as a JSX child, including through a ternary, `&&`, `||` or `??` (a comparison such as `kind === 'calendar'` renders nothing and is not flagged); a lettered literal in a copy attribute (`aria-label`, `title`, `placeholder`, `alt`, `label`, …) or in any prop of a component other than identifier props (`id`, `className`, `variant`, …; review tsr2-008). Casts are not this file's job: decision 48 makes the committed `scripts/check-casts.mjs` (`pnpm casts`, WP7, in CI) the one cast check for every package, and §10 runs it. Suppression comments are not this file's job either: decision 49 makes `scripts/check-boundaries.mjs` the one suppression check for every package (Task 9.12). (3) It fails, outside `PriceCell` and the views that show costs and caps, on a call to `formatPence` or `formatMicroGbp` (bare or through a namespace) and on an import of either (renamed or not), and outside `copy.ts` and `format.ts` on any string or template literal holding "£" (reviews tsr-003, prov-r2-007, tsr2-008). A value passed through a variable is the accepted gap: Task 9.14's rendered sweep checks every view's DOM for "£" outside a price or a `[data-cost]` element.

- [ ] **Step 1: Write the failing tests**

`test/copy/catalogue.test.ts`:

```ts
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[]> = {
  confirmedWas: ['154', '£1'],
  metroExpanded: ['LON', 'LHR, LGW'],
  progressSelected: [{ provider: 'SearchApi', done: 8, selected: 10, error: 1, skipped: 116, notRun: 2 }],
  childExecutionNotStarted: ['pending'],
  executionNotStarted: ['pending'],
  loadFailed: ['network error'],
  actionFailed: ['409 conflict'],
  providersUnknown: ['HTTP 500'],
  fxSpoken: ['converted to GBP at the 2026-10-13 rate (frankfurter)'],
  fxTitle: ['2026-10-13', 'frankfurter'],
  notSeenInLatest: ['3d ago'],
  agoOf: ['unknown'],
  verdictLine: ['arrival time window', 'fail'],
  notApplied: ['arrival time window, maximum journey time'],
  unverifiedList: ['checked bag'],
  sortBy: ['Price', 'ascending'],
  sortOption: ['Travel time', 'descending'],
  orderNow: ['server ranking (class, then price)'],
  sortedWithin: ['Travel time', 1000, 4210],
  showDetails: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  hideDetails: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  detailsFor: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  rowName: ['JFK', '14 Mar 2027', '28 Mar 2027'],
  stopsValue: [0, 1],
  nightsValue: [14],
  showingRows: [3, 10],
  staleHidden: [2],
  failedHidden: [1],
  headlineRest: [
    {
      destination: 'JFK',
      dates: '14 Mar 2027–28 Mar 2027 (14n)',
      basis: 'itinerary-search basis',
      cls: 'verified',
    },
  ],
  dateRange: ['14 Mar 2027', '28 Mar 2027', 14],
  coverageLine: [{ priced: 3, empty: 1, noData: 2, error: 0, skipped: 0, notRun: 4, total: 10, reused: 0 }],
  itineraryLine: [{ searched: 2, selected: 10, onDemand: 1 }],
  itineraryLineExpand: [{ searched: 2, selected: 10, expandTop: 2, onDemand: 1 }],
  truncated: [1000, 4210],
  excludedByCurrentSpace: [3],
  executionsShown: ['run started 14 Oct 2026 12:00 UTC (completed, 2h ago)'],
  executionItem: ['14 Oct 2026 12:00 UTC', 'completed', '2h ago'],
  childExecutionItem: ['14 Oct 2026 12:00 UTC', 'running', 'just now'],
  spanExecutions: [3],
  notCompletedBanner: ['running'],
  progress: [
    {
      stage: 'discovery',
      provider: 'Travelpayouts',
      verb: 'searched',
      done: 116,
      total: 126,
      error: 6,
      skipped: 0,
      notRun: 10,
    },
  ],
  progressLabel: ['discovery', 'Travelpayouts'],
  spendRunCalls: [42, '2000'],
  spendRunFreeCalls: [14, '2000'],
  spendRunCost: ['£0', '£0'],
  spendMonth: ['£32', '£35'],
  spendProviderMonth: ['SearchApi', 615, '10000'],
  paused: ['budget'],
  resumesAt: ['1 Nov 2026 00:00 UTC'],
  scheduleBlocked: ['14 Oct 2026'],
  childRun: ['running'],
  runNow: [154, 2000, '£0'],
  filtersSummary: [2],
  carriersIgnored: ['BRITISH'],
  segment: ['ZZ', 117, 'LHR', '14 Mar 10:25', 'JFK', '14 Mar 13:20'],
  layover: ['BBB', '2h 05m'],
  checkedBags: [1],
  refundable: [true],
  changeable: [undefined],
  seller: ['Example Travel'],
  openOn: ['www.google.com'],
  continueOnForm: ['www.google.com'],
  hostShown: ['www.google.com'],
  calendarGapLead: [3],
  reusedNote: [4],
  cellLabel: ['LHR', 'JFK', '20 Mar 2027', '1 Apr 2027'],
  withPriceValue: [60, 126],
  sumMismatch: [9, 10],
  requestRow: [14, '14', 2, '£0'],
  errorRow: ['rate-limit', 3],
  lastError: ['HTTP 429'],
  plan: ['SearchApi $40 a month'],
  capability: ['Discovery', 'Aviasales cache', 'prices up to 2d old when fetched'],
  maxAge: ['2d'],
  usageWindow: [615, '10000', '1 Oct 2026', '1 Nov 2026'],
  usageLifetime: [9, '100'],
  usageNoWindow: [42, '2000'],
  editDefinition: ['Worked example'],
  removeAirport: ['LHR'],
  duplicateAirport: ['LHR'],
  airportOption: ['Heathrow', 'London', 'United Kingdom'],
  destinationNote: ['JFK'],
  onwardCost: ['JFK'],
  resolvedWindow: ['21 Oct 2026', '20 Apr 2027'],
  inPounds: ['maximum price'],
  minutesAsHours: ['25h 00m'],
  refreshHours: ['Travelpayouts'],
  coverageCheckPair: ['LHR', 'JFK'],
  coverageCheckCalls: [14],
  cachedOf: [5, 372],
  importExample: ['the worked example'],
  createConfirm: [154, 2000, '£0'],
  fieldError: ['origins.0', 'LON is a city code'],
  estimateCells: [126],
  estimateRow: ['SearchApi', 'discovery', 92, '£0', '30m'],
  estimateTotal: [154, 2000, '£0', '45m'],
  estimateBlocked: ['searchapi provider-month cap 10000, estimated 12000'],
  budgetFitOk: [4],
  budgetFitWarn: [4],
  budgetScope: ['provider-month:searchapi', 616, '10000'],
  needsConfirmation: [{ calls: 154, cap: 2000, estimate: '£2', confirmed: '120 calls, £1' }],
  confirmNew: [154, 2000, '£2'],
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
    const produced: unknown = Reflect.apply(value, undefined, args);
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
    const hits = strings.flatMap(({ path, text }) =>
      findBannedWords(text, BANNED_WORD_ALLOWLIST).map((h) => `${path}: "${h.word}" in "${text}"`),
    );
    expect(hits).toEqual([]);
  });

  it('"verified" as a whole word appears only in class labels and beside class-verified values', () => {
    const allowed = new Set([
      'classLabel.verified',
      'classLabel.partially-verified',
      'calendarGapLead',
      'headlineRest',
    ]);
    const offenders = strings.filter(
      ({ path, text }) => /(?<![\p{L}])verified(?![\p{L}])/u.test(text) && !allowed.has(path),
    );
    expect(offenders).toEqual([]);
  });

  it('stage counts say itinerary-searched', () => {
    expect(COPY.itineraryLine({ searched: 2, selected: 10, onDemand: 1 })).toBe(
      ' · itinerary-searched 2 of 10 selected +1 on demand',
    );
    expect(COPY.progressVerb.verification).toBe('itinerary-searched');
  });

  it('confirmations state the estimated calls with the hard stop, and pounds (decisions 36, 44)', () => {
    expect(COPY.createConfirm(154, 2000, '£0')).toBe(
      'Create and confirm about 154 calls (hard stop 2000), £0 per run',
    );
    expect(COPY.confirmNew(154, 2000, '£2')).toBe('Confirm about 154 calls (hard stop 2000), £2 per run');
    expect(COPY.runNow(154, 2000, '£0')).toBe('Run now (about 154 calls (hard stop 2000), £0)');
    const copy = [
      COPY.createConfirm(1, 2, '£0'),
      COPY.confirmNew(1, 2, '£0'),
      COPY.runNow(1, 2, '£0'),
      COPY.estimateTotal(1, 2, '£0', '1m'),
    ];
    expect(copy.filter((c) => /\bup to\b/.test(c))).toEqual([]);
  });

  it('the guard itself works: a planted banned word is found', () => {
    expect(findBannedWords('Live fares', BANNED_WORD_ALLOWLIST)).toHaveLength(1);
  });
});
```

`test/copy/sourceGuard.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
// why: the workspace root's TypeScript (a root devDependency); an AST, not a regex, so multi-line JSX
// text, ternaries and template literals are all seen (reviews tsr-007, arch-018).
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// why: under jsdom import.meta.url is not a file: URL, so the module's directory comes from import.meta.dirname.
const ROOT = resolve(import.meta.dirname, '../..');

/** Every .ts/.tsx file under a directory of apps/web, with its path relative to apps/web. */
function sources(dir: 'src' | 'test'): Array<{ file: string; text: string }> {
  const base = join(ROOT, dir);
  return readdirSync(base, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: relative(ROOT, join(base, f)), text: readFileSync(join(base, f), 'utf8') }));
}

const LETTER = /\p{L}/u;
/** Attributes whose value a person reads or hears: literal copy is forbidden in them. */
const COPY_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
]);
/** The files allowed to format money: PriceCell for prices, and the views that show costs and caps (never a fare). */
const MONEY_FORMATTERS = new Set(['formatPence', 'formatMicroGbp']);
const MONEY_FILES = new Set([
  'src/format.ts',
  'src/components/PriceCell.tsx',
  'src/components/StatusBar.tsx',
  'src/views/Coverage/CoverageView.tsx',
  'src/views/Definitions/Confirmation.tsx',
  'src/views/Definitions/EstimatePanel.tsx',
]);

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The literal text of a string or template node, or null for anything else. */
function literalText(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n))
    return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ');
  return null;
}

const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** True when `n` is a value its parent can render: a ternary branch, the right of `&&`/`||`/`??`, or parenthesised. */
function passesValueUp(n: ts.Node, p: ts.Node): boolean {
  if (ts.isParenthesizedExpression(p)) return true;
  if (ts.isConditionalExpression(p)) return n === p.whenTrue || n === p.whenFalse;
  return ts.isBinaryExpression(p) && VALUE_OPERATORS.has(p.operatorToken.kind) && n === p.right;
}

/** Where a literal ends up when it is rendered from a JSX expression; comparisons (`x === 'calendar'`) render nothing. */
function jsxSlot(n: ts.Node): 'child' | { attr: string } | null {
  let cur = n;
  let p = n.parent;
  while (p !== undefined && passesValueUp(cur, p)) {
    cur = p;
    p = p.parent;
  }
  if (p === undefined) return null;
  if (ts.isJsxAttribute(p)) return { attr: p.name.getText() };
  if (!ts.isJsxExpression(p)) return null;
  if (ts.isJsxAttribute(p.parent)) return { attr: p.parent.name.getText() };
  return ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent) ? 'child' : null;
}

/** Props of a component (a capitalised JSX tag) that carry identifiers or tokens, never copy. */
const NON_COPY_PROPS = new Set([
  'id',
  'className',
  'variant',
  'type',
  'name',
  'role',
  'key',
  'htmlFor',
  'inputMode',
  'value',
]);

/** True when the literal is an attribute value on a component (`<Heading text="…">`), not on an HTML element. */
function onComponent(n: ts.Node): boolean {
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !ts.isJsxOpeningElement(p) && !ts.isJsxSelfClosingElement(p)) p = p.parent;
  return p !== undefined && /^[A-Z]/.test(p.tagName.getText());
}

/** Literal copy in a .tsx file: JSX text with a letter, or a lettered literal rendered as a child or a copy attribute. */
export function copyOffenders(file: string, text: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && LETTER.test(n.text)) out.push(`${file}: text "${n.text.trim()}"`);
    const lit = literalText(n);
    if (lit !== null && LETTER.test(lit)) {
      const slot = jsxSlot(n);
      if (slot === 'child') out.push(`${file}: literal child "${lit}"`);
      else if (slot !== null && COPY_ATTRS.has(slot.attr)) out.push(`${file}: ${slot.attr}="${lit}"`);
      else if (slot !== null && onComponent(n) && !NON_COPY_PROPS.has(slot.attr))
        out.push(`${file}: prop ${slot.attr}="${lit}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(file, text));
  return out;
}

/** Files whose string literals may hold a pound sign: the catalogue (labels such as "Max price (£)") and the formatter. */
const POUND_FILES = new Set(['src/copy.ts', 'src/format.ts']);

/**
 * A price printed without PriceCell (reviews tsr-003, prov-r2-007, tsr2-008): outside the allowlisted
 * files, any call to a money formatter (bare or through a namespace), any import of one (renamed or
 * not), and outside the catalogue any string or template literal holding "£". A value passed through
 * a variable to a non-allowlisted file is the accepted gap; the rendered sweep of Task 9.14 checks the DOM.
 */
export function moneyOffenders(file: string, text: string): string[] {
  const out: string[] = [];
  const money = !MONEY_FILES.has(file);
  const visit = (n: ts.Node): void => {
    if (money && ts.isCallExpression(n)) {
      const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
      if (ts.isIdentifier(callee) && MONEY_FORMATTERS.has(callee.text))
        out.push(`${file}: ${callee.text}(…)`);
    }
    if (money && ts.isImportSpecifier(n) && MONEY_FORMATTERS.has((n.propertyName ?? n.name).text)) {
      out.push(`${file}: imports ${(n.propertyName ?? n.name).text}`);
    }
    const lit = literalText(n);
    if (lit?.includes('£') && !POUND_FILES.has(file)) out.push(`${file}: "£" in "${lit}"`);
    ts.forEachChild(n, visit);
  };
  visit(parse(file, text));
  return out;
}

describe('source guards (spec §11 copy, spec §9 item 6 prices)', () => {
  const src = sources('src');
  const tests = sources('test');

  it('finds files to scan (a vacuous pass is a failure)', () => {
    expect(src.filter((s) => s.file.endsWith('.tsx')).length).toBeGreaterThan(3);
    expect(tests.length).toBeGreaterThan(5);
  });

  it('no literal copy in any component: all copy comes from src/copy.ts', () => {
    expect(src.filter((s) => s.file.endsWith('.tsx')).flatMap((s) => copyOffenders(s.file, s.text))).toEqual(
      [],
    );
  });

  it('money is formatted only by PriceCell and the cost and cap views', () => {
    expect(src.flatMap((s) => moneyOffenders(s.file, s.text))).toEqual([]);
  });

  it('the guards catch planted offenders, multi-line and conditional ones included', () => {
    const planted = [
      'const a = <p>\n  Live fares\n</p>;',
      "const b = <p>{ok ? 'Yes' : null}</p>;",
      "const f = <p>{kind === 'calendar' ? COPY.notChecked : null}</p>;",
      'const c = <button aria-label="Close" />;',
      // why: assembled from pieces so this file has no "${" inside a plain string.
      ['const d = <p>{`Hello $', '{name}`}</p>;'].join(''),
    ].join('\n');
    expect(copyOffenders('planted.tsx', planted)).toHaveLength(4);
    expect(copyOffenders('ok.tsx', 'const e = <p className="text-sm">{COPY.loading}{\' \'}</p>;')).toEqual(
      [],
    );
    expect(moneyOffenders('src/views/Elsewhere.tsx', 'formatPence(100);')).toHaveLength(1);
    expect(
      moneyOffenders(
        'src/views/Elsewhere.tsx',
        "import { formatPence as fp } from '../format.js'; fmt.formatMicroGbp(1);",
      ),
    ).toEqual(['src/views/Elsewhere.tsx: imports formatPence', 'src/views/Elsewhere.tsx: formatMicroGbp(…)']);
    expect(moneyOffenders('src/views/Elsewhere.tsx', ['const p = `£$', '{n}`;'].join(''))).toHaveLength(1);
    expect(copyOffenders('planted.tsx', 'const g = <Heading text="Cheapest" id="h1" />;')).toEqual([
      'planted.tsx: prop text="Cheapest"',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

These are guards over code that already exists, so prove each one bites. Temporarily add `planted: 'live prices',` and ``plantedFn: (n: number) => `${n}`,`` to `COPY` in `src/copy.ts`; in `PriceBoundary`'s fallback, put `{failedOnce ? 'Price hidden' : null}` (with `const failedOnce = true;`) after the message.

Run: `pnpm --filter @gmt/web exec vitest run test/copy`
Expected: FAIL, three tests: "every function entry has sample arguments" (`COPY.plantedFn is a function with no entry in SAMPLES`), "no string contains a banned word" (`planted: "live" in "live prices"`), and "no literal copy in any component" (`src/components/PriceBoundary.tsx: literal child "Price hidden"`).

- [ ] **Step 3: Implement**

Remove the three planted lines. No other production code: the catalogue exists from Task 9.1. Any real copy the test flags is reworded in `src/copy.ts`; the allowlist is core's and is not extended from the web.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/copy`
Expected: PASS, 6 + 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: banned-word catalogue test; AST guards for literal copy and money formatting"
```

### Task 9.3: Schema-typed API client from ROUTES, parsed in every mode; test API on msw

**Files:**
- Create: `src/api/client.ts`, `src/api/types.ts`, `src/api/endpoints.ts`, `src/api/queries.ts`, `test/fixtures.ts`, `test/msw/handlers.ts`, `test/msw/server.ts`
- Modify: `test/setup.ts`
- Test: `test/api/client.test.ts`, `test/harness.test.ts`

**Interfaces:**
- Consumes: `apiContract.ROUTES`, `apiContract.errorEnvelopeSchema`, the response and request schemas named in §4, `ResultRow`, `ResultBasis`; `ZodArray` from zod.
- Produces: `ApiError`, `FieldError`, `findRoute`, `fillPath`, `call`, `api`, `qk`, `POLL_MS`, the query hooks, `useExecutionActions` (whose start sends `confirmCostPence` and `confirmCalls`, decision 43), the response and request-body types (`BudgetFit` re-exported from core, review arch-015), the fixture builders, `server`, `fixtureFor`.

Decisions. **The endpoint names its schema** (review arch-002): `call(schema, method, path, opts)` returns `z.output<typeof schema>`, checks that `schema` is the ROUTES entry's response schema (or an array of the same element, for `GET /api/definitions`), and parses with it; no generic is chosen by the caller and nothing is cast. **Every response is parsed in every build mode** (decision 36): payloads are at most 1000 rows, and an unparsed production response would give the views data no test ever saw. A contract break is an `ApiError` with code `contract`, which every view shows as its load error, so a row without provenance blanks nothing and prints no price. Non-2xx bodies become `ApiError` with the envelope's code and its contract-parsed `details.fields` (no re-validation by hand); a body that is not JSON is `malformed`; a failed fetch is `network`; a non-JSON error page is `http`. **Request bodies are the schemas' input types** (plain strings, `DefinitionBody` and friends): the operator's draft is unvalidated until the API parses it, so the web never mints a brand. **Fixtures** are built through the contract schemas from input-shaped overrides (review tsr-006), agree on one small definition of 126 cells, and use the spec rev 15 provenance: a SearchApi itinerary price has `maxAgeHours: 'unknown'` (decision 24) and `stale: false`, since staleness is by fetch age and an unknown vendor age is a label (decision 44). The stored definition carries `confirmedCalls` and the execution summary `expandTop` (decisions 42, 43); a usage row's `costPence` comes from core's `microGbpToPence`, as every conversion does (decision 49). **The test API** fails a test on any unmatched request through a catch-all handler (review tsr-004, decision 18), and on any `console.error` the test did not announce.

- [ ] **Step 1: Write the failing tests**

`test/api/client.test.ts`:

```ts
import { apiContract } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError, call, findRoute } from '../../src/api/client.js';
import { api } from '../../src/api/endpoints.js';
import { API, calendarRow, resultsResponse } from '../fixtures.js';
import { fixtureFor } from '../msw/handlers.js';
import { server } from '../msw/server.js';

/** The rejection of a call, which must be an ApiError (narrowed, never cast). */
async function failure(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`);
  return err;
}

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

  it('rejects a response that breaks the contract (a row without provenance); there is no mode gate to stub', async () => {
    const { provenance: _drop, ...bare } = calendarRow();
    const body = { ...resultsResponse(), rows: [bare] };
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(body)));
    const err = await failure(api.results('d1', null));
    expect(err.code).toBe('contract');
    expect(err.message).toMatch(
      /GET \/api\/definitions\/:id\/results response does not match core\/api-contract: rows\.0\.provenance/,
    );
  });

  it('sends X-Requested-With and Content-Type on every mutation, even without a body', async () => {
    const headers: Array<Record<string, string | null>> = [];
    server.use(
      http.post(`${API}/executions/:id/cancel`, ({ request }) => {
        headers.push({
          xrw: request.headers.get('x-requested-with'),
          ct: request.headers.get('content-type'),
        });
        return HttpResponse.json(fixtureFor('POST', '/api/executions/:id/cancel'));
      }),
    );
    const r = await api.cancel('e1');
    expect(headers).toEqual([{ xrw: 'get-me-there', ct: 'application/json' }]);
    expect(r.status).toBe('cancelled');
  });

  it('turns the error envelope into an ApiError carrying details.fields', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation',
              message: 'invalid definition',
              details: {
                fields: [{ field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' }],
              },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const err = await failure(
      call(apiContract.estimateResponseSchema, 'POST', '/api/definitions/estimate', { body: {} }),
    );
    expect([err.status, err.code]).toEqual([422, 'validation']);
    expect(err.fieldErrors()).toEqual([
      { field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' },
    ]);
  });

  it.each([
    [
      'a 500 envelope',
      () =>
        HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
      500,
      'internal',
    ],
    [
      'a 502 HTML page',
      () =>
        new HttpResponse('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      502,
      'http',
    ],
    [
      'a 422 whose fields are malformed',
      () =>
        HttpResponse.json(
          { error: { code: 'validation', message: 'x', details: { fields: [{ field: 1 }] } } },
          { status: 422 },
        ),
      422,
      'http',
    ],
    ['a 200 body that is not JSON', () => new HttpResponse('{"rows":', { status: 200 }), 200, 'malformed'],
    ['a 204 with no body', () => new HttpResponse(null, { status: 204 }), 204, 'contract'],
    ['a network failure', () => HttpResponse.error(), 0, 'network'],
  ])('maps %s to an ApiError, never a bare SyntaxError', async (_label, reply, status, code) => {
    server.use(http.get(`${API}/providers`, reply));
    const err = await failure(api.providers());
    expect([err.status, err.code, err.fieldErrors()]).toEqual([status, code, []]);
  });

  it("refuses a route that is not in ROUTES, and a schema that is not the route's", async () => {
    expect(() => findRoute('GET', '/api/not-a-route')).toThrow(
      'route GET /api/not-a-route is not in core/api-contract ROUTES',
    );
    await expect(call(apiContract.coverageResponseSchema, 'GET', '/api/providers')).rejects.toThrow(
      'the schema passed is not the ROUTES response schema',
    );
  });

  it('every route is under /api, the one prefix the dev server proxies', () => {
    for (const r of apiContract.ROUTES) expect(r.path.startsWith('/api/')).toBe(true);
  });
});
```

`test/harness.test.ts`:

```ts
import { apiContract } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as fx from './fixtures.js';
import { drainGuards, expectConsoleErrors } from './guards.js';

describe('test harness (reviews tsr-004, tsr-006, tsr2-006, tsr2-010)', () => {
  it('the fixtures agree on one small definition: 126 cells, the run policy and the stored confirmation', () => {
    expect([
      fx.resultsResponse().coverage.total,
      fx.coverageResponse().summary.total,
      fx.estimate().cells,
    ]).toEqual([126, 126, 126]);
    expect([fx.summary().expandTop, fx.definition().verification.expandTop]).toEqual([2, 2]);
    expect([fx.definition().confirmedCalls, fx.estimate().totalCalls]).toEqual([154, 154]);
  });

  it('a fixture that drifts from the contract fails at build time', () => {
    const offer = {
      seller: 'x',
      pricePence: 1,
      provenance: fx.provSearch,
      booking: { kind: 'none' as const },
      stale: false,
      ageHours: 1,
      verdictClass: 'verified' as const,
      unverified: [],
      notSeenInLatest: null,
    };
    expect(() => fx.verifiedRow({ otherOffers: [offer] })).not.toThrow();
    const { notSeenInLatest: _drop, ...withoutNotSeen } = offer;
    expect(
      apiContract.resultRowSchema.safeParse({ ...fx.verifiedRow(), otherOffers: [withoutNotSeen] }).success,
    ).toBe(false);
    const { fetchedAt: _fetched, ...noFetchedAt } = fx.provSearch;
    expect(() => fx.verifiedRow({ provenance: noFetchedAt })).toThrow(/fetchedAt/);
    expect(() => fx.verifiedRow({ pricePence: 412.5 })).toThrow();
  });

  it('an unmatched request is recorded by the catch-all, so afterEach fails the test', async () => {
    await fetch('http://localhost:3000/api/not-handled').catch(() => undefined);
    expect(drainGuards()).toEqual(['request no handler matched: GET http://localhost:3000/api/not-handled']);
  });

  it('an unannounced console.error fails the test; an announced one passes; an announced one that never came fails', () => {
    console.error('planted');
    expect(drainGuards()).toEqual(['console.error during the test: planted']);
    expectConsoleErrors(/price withheld/);
    console.error('[price withheld] boom');
    console.error('Warning: unrelated');
    expect(drainGuards()).toEqual(['console.error during the test: Warning: unrelated']);
    expectConsoleErrors(/price withheld/);
    expect(drainGuards()).toEqual(['expected console.error /price withheld/ never occurred']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/api/client.test.ts test/harness.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/api/client.js"` (and `../fixtures.js`).

There is no mode gate to stub: `src` never reads `import.meta.env` (§10 item 9 greps for it), so the contract test needs no `vi.stubEnv` (review tsr2-011).

- [ ] **Step 3: Implement**

`src/api/client.ts` (new file):

```ts
import { apiContract } from '@gmt/core';
import { ZodArray, type z } from 'zod';

export type Method = apiContract.RouteDef['method'];

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export type FieldError = { field: string; message: string };

/**
 * Any failed call: a non-2xx response (spec §10 error envelope `{ error: { code, message, details? } }`),
 * a network failure (`code: 'network'`), a body that is not JSON (`'malformed'`), or a 2xx body that
 * breaks core/api-contract (`'contract'`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  private readonly fields: readonly FieldError[];

  constructor(status: number, code: string, message: string, fields: readonly FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** A 422's `details.fields` (spec §10), e.g. the metro-code message of review focus 1; already contract-parsed. */
  fieldErrors(): FieldError[] {
    return [...this.fields];
  }
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

/** The same schema object, or two arrays of the same element (ROUTES builds `definitionResponseSchema.array()` itself). */
function sameSchema(a: z.ZodType, b: z.ZodType): boolean {
  return a === b || (a instanceof ZodArray && b instanceof ZodArray && a.element === b.element);
}

/** JSON.parse that reports failure instead of throwing a bare SyntaxError. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The one fetch in the app. The endpoint passes the response schema it expects; the client checks it
 * is the ROUTES entry's schema and parses every response with it, in production as in tests
 * (decision 36: payloads are at most 1000 rows), so a WP8 drift fails loudly instead of rendering.
 * Spec §4: mutations carry Content-Type: application/json and X-Requested-With: get-me-there.
 */
export async function call<S extends z.ZodType>(
  schema: S,
  method: Method,
  path: string,
  opts: CallOptions = {},
): Promise<z.output<S>> {
  const route = findRoute(method, path);
  if (!sameSchema(route.response, schema))
    throw new Error(`${method} ${path}: the schema passed is not the ROUTES response schema`);
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
  let res: Response;
  try {
    // why: TanStack's AbortSignal is not forwarded; under jsdom it is jsdom's class, which Node's fetch rejects.
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError(
      0,
      'network',
      `${method} ${path} could not reach the server: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const body = parseJson(await res.text());
  if (!res.ok) {
    const envelope = apiContract.errorEnvelopeSchema.safeParse(body.ok ? body.value : null);
    if (envelope.success) {
      const e = envelope.data.error;
      throw new ApiError(res.status, e.code, e.message, e.details?.fields ?? []);
    }
    throw new ApiError(res.status, 'http', `${method} ${path} failed with HTTP ${res.status}`);
  }
  if (!body.ok)
    throw new ApiError(res.status, 'malformed', `${method} ${path} returned a body that is not JSON`);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ApiError(
      res.status,
      'contract',
      `${method} ${path} response does not match core/api-contract: ${issues}`,
    );
  }
  return parsed.data;
}
```

`src/api/types.ts` (new file):

```ts
import type { apiContract, ResultBasis } from '@gmt/core';
import type { z } from 'zod';

// why: core already exports these inferred contract types (decision 17); one import site per type.
export type { BudgetFit, CoverageCheckResponse, DefinitionResponse, ResultRow } from '@gmt/core';

/** Response types: the z.output of each contract schema (plan "API contract"). */
export type ProvidersResponse = z.output<typeof apiContract.providersResponseSchema>;
export type ProviderEntry = ProvidersResponse['providers'][number];
export type Estimate = z.output<typeof apiContract.estimateSchema>;
export type EstimateResponse = z.output<typeof apiContract.estimateResponseSchema>;
export type ExecutionResponse = z.output<typeof apiContract.executionResponseSchema>;
export type StartExecutionResponse = z.output<typeof apiContract.startExecutionResponseSchema>;
export type ResultsResponse = z.output<typeof apiContract.resultsResponseSchema>;
export type ExecutionSummary = z.output<typeof apiContract.executionSummarySchema>;
export type CoverageResponse = z.output<typeof apiContract.coverageResponseSchema>;
export type CalendarGapResponse = z.output<typeof apiContract.calendarGapResponseSchema>;
export type AirportsResponse = z.output<typeof apiContract.airportsResponseSchema>;
export type PriceCellData = z.output<typeof apiContract.priceCellSchema>;
export type UsageRow = z.output<typeof apiContract.usageSchema>;
export type Basis = ResultBasis;

/**
 * Request bodies in the schema's *input* shape: plain strings where the output has brands. The
 * operator's draft is unvalidated until the API parses it (spec §6.1), so the web never mints a brand.
 */
export type DefinitionBody = z.input<typeof apiContract.definitionCreateRequestSchema>;
export type DefinitionUpdateBody = z.input<typeof apiContract.definitionUpdateRequestSchema>;
export type CoverageCheckBody = z.input<typeof apiContract.coverageCheckRequestSchema>;
export type VerifyCellBody = z.input<typeof apiContract.verifyCellRequestSchema>;
export type StartExecutionBody = z.input<typeof apiContract.startExecutionRequestSchema>;
```

`src/api/endpoints.ts` (new file):

```ts
import { apiContract as c } from '@gmt/core';
import { call } from './client.js';
import type {
  Basis,
  CoverageCheckBody,
  DefinitionBody,
  DefinitionUpdateBody,
  StartExecutionBody,
  VerifyCellBody,
} from './types.js';

/**
 * One wrapper per spec §10 route the WP9 views use. Each names its ROUTES path template and the
 * contract schema of that route's response; `call` checks the pair and parses with it.
 */
export const api = {
  providers: () => call(c.providersResponseSchema, 'GET', '/api/providers'),
  definitions: () => call(c.definitionResponseSchema.array(), 'GET', '/api/definitions'),
  estimateDraft: (body: DefinitionBody) =>
    call(c.estimateResponseSchema, 'POST', '/api/definitions/estimate', { body }),
  createDefinition: (body: DefinitionBody) =>
    call(c.definitionResponseSchema, 'POST', '/api/definitions', { body }),
  updateDefinition: (id: string, body: DefinitionUpdateBody) =>
    call(c.definitionResponseSchema, 'PUT', '/api/definitions/:id', { params: { id }, body }),
  coverageCheck: (body: CoverageCheckBody) =>
    call(c.coverageCheckResponseSchema, 'POST', '/api/definitions/coverage-check', { body }),
  startExecution: (id: string, body: StartExecutionBody) =>
    call(c.startExecutionResponseSchema, 'POST', '/api/definitions/:id/executions', { params: { id }, body }),
  execution: (id: string) =>
    call(c.executionResponseSchema, 'GET', '/api/executions/:id', { params: { id } }),
  cancel: (id: string) =>
    call(c.executionResponseSchema, 'POST', '/api/executions/:id/cancel', { params: { id } }),
  resume: (id: string) =>
    call(c.executionResponseSchema, 'POST', '/api/executions/:id/resume', { params: { id } }),
  verifyCell: (body: VerifyCellBody) =>
    call(c.startExecutionResponseSchema, 'POST', '/api/cells/verify', { body }),
  results: (id: string, basis: Basis | null) =>
    call(c.resultsResponseSchema, 'GET', '/api/definitions/:id/results', {
      params: { id },
      query: { basis: basis ?? undefined },
    }),
  coverage: (id: string) =>
    call(c.coverageResponseSchema, 'GET', '/api/definitions/:id/coverage', { params: { id } }),
  calendarGap: (id: string) =>
    call(c.calendarGapResponseSchema, 'GET', '/api/definitions/:id/calendar-gap', { params: { id } }),
  airports: (q: string) => call(c.airportsResponseSchema, 'GET', '/api/airports', { query: { q } }),
};
```

`src/api/queries.ts` (new file):

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';
import type { Basis, VerifyCellBody } from './types.js';

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

/** Polling interval while a run is moving (spec §10 "updates during run"). */
export const POLL_MS = 2_000;
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

/** A run, polled every POLL_MS while pending or running. */
export function useExecution(id: string | null) {
  return useQuery({
    queryKey: qk.execution(id ?? ''),
    queryFn: () => api.execution(id ?? ''),
    enabled: id !== null,
    refetchInterval: (query) =>
      query.state.data !== undefined && POLLING.has(query.state.data.status) ? POLL_MS : false,
  });
}

/** View D and the status bar's "schedule blocked since" (coverage.scheduleBlockedSince). */
export function useCoverage(definitionId: string | null) {
  return useQuery({
    queryKey: qk.coverage(definitionId ?? ''),
    queryFn: () => api.coverage(definitionId ?? ''),
    enabled: definitionId !== null,
  });
}

/** Spec §6.9: only fetched when a verification provider is configured. */
export function useCalendarGap(definitionId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.calendarGap(definitionId),
    queryFn: () => api.calendarGap(definitionId),
    enabled,
  });
}

/** Airport autocomplete (GET /api/airports?q=); two characters minimum. */
export function useAirportSearch(q: string) {
  return useQuery({
    queryKey: qk.airports(q),
    queryFn: () => api.airports(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}

/** Cancel, resume, start and single-cell verify, each refreshing every run-dependent query. */
export function useExecutionActions() {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all(
      [['results'], ['execution'], ['coverage'], ['calendar-gap']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
  };
  return {
    cancel: useMutation({ mutationFn: (id: string) => api.cancel(id), onSuccess: refresh }),
    resume: useMutation({ mutationFn: (id: string) => api.resume(id), onSuccess: refresh }),
    start: useMutation({
      // why: decision 43: a confirmation covers a run only with both its pence and its calls, so both are sent when stored.
      mutationFn: (v: { id: string; confirmCostPence: number | null; confirmCalls: number | null }) =>
        api.startExecution(v.id, {
          ...(v.confirmCostPence === null ? {} : { confirmCostPence: v.confirmCostPence }),
          ...(v.confirmCalls === null ? {} : { confirmCalls: v.confirmCalls }),
        }),
      onSuccess: refresh,
    }),
    verify: useMutation({ mutationFn: (v: VerifyCellBody) => api.verifyCell(v), onSuccess: refresh }),
  };
}
```

`test/fixtures.ts` (new file; worked example only: LHR, LGW → JFK, EWR; carrier `ZZ` and hub `BBB` are synthetic codes):

```ts
import { apiContract, microGbpToPence } from '@gmt/core';
import type { z } from 'zod';
import type {
  AirportsResponse,
  CalendarGapResponse,
  CoverageCheckResponse,
  CoverageResponse,
  DefinitionResponse,
  Estimate,
  ExecutionResponse,
  ExecutionSummary,
  ProvidersResponse,
  ResultRow,
  ResultsResponse,
  UsageRow,
} from '../src/api/types.js';
import type { ProvenanceInput } from './render.js';

/**
 * Every builder ends in the contract schema's parse, and overrides are in the schema's *input*
 * shape (plain strings), so a fixture that drifts from core/api-contract fails here and no test
 * needs a cast or a brand helper. Worked example only: LHR, LGW → JFK, EWR; carrier `ZZ` and the
 * hub `BBB` are synthetic codes. One small definition: 126 cells, 10 selected for itinerary search.
 */
type In<S extends z.ZodType> = z.input<S>;

export type { ProvenanceInput };

/** Base of every handler URL: the api lives under /api (spec §10). */
export const API = 'http://localhost:3000/api';

/** SearchApi itinerary price: age 'unknown' because the vendor may serve a cached answer (spec rev 15, decision 24). */
export const provSearch: ProvenanceInput = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  maxAgeHours: 'unknown',
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
/** Travelpayouts calendar price with the vendor's declared 48h horizon. */
export const provCalendar: ProvenanceInput = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 48,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};
/** A converted price: the rate and its date are the provenance's FX block (spec §3). */
export const fxConverted: ProvenanceInput['fx'] = {
  converted: true,
  rateNano: 790_000_000,
  rateDate: '2026-10-13',
  source: 'frankfurter',
};
/** The fixture provider's price: synthetic, never followable (spec §5.5). */
export const provSynthetic: ProvenanceInput = {
  providerId: 'fixture',
  sourceKind: 'synthetic',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};

type RowIn = In<typeof apiContract.resultRowSchema>;

export function seg(
  carrier: string,
  flight: number,
  from: string,
  to: string,
  depLocal: string,
  arrLocal: string,
) {
  return {
    marketingCarrier: carrier,
    flightNumber: flight,
    from,
    to,
    departLocal: depLocal,
    arriveLocal: arrLocal,
  };
}

export const cell = (o: string, d: string, dep: string, ret: string, nights: number) => ({
  origin: o,
  destination: d,
  departureDate: dep,
  returnDate: ret,
  nights,
});

const verifiedBase: RowIn = {
  itineraryHash: 'hash-verified-1',
  basis: 'verified',
  verdictClass: 'verified',
  pricePence: 41200,
  provenance: provSearch,
  stale: false,
  ageHours: 'unknown',
  truncated: false,
  cell: cell('LHR', 'JFK', '2027-03-14', '2027-03-28', 14),
  outbound: [
    seg('ZZ', 117, 'LHR', 'BBB', '2027-03-14T10:25', '2027-03-14T12:00'),
    seg('ZZ', 9, 'BBB', 'JFK', '2027-03-14T13:30', '2027-03-14T15:10'),
  ],
  inbound: [seg('ZZ', 178, 'JFK', 'LHR', '2027-03-28T19:00', '2027-03-29T07:00')],
  totalMinutes: 1005,
  outboundMinutes: 525,
  inboundMinutes: 480,
  stopsOut: 1,
  stopsIn: 0,
  layovers: [{ at: 'BBB', minutes: 90, overnight: false, airportChange: false }],
  carriers: ['ZZ'],
  verdicts: { cabin: 'pass', maxStops: 'pass', maxJourneyMinutes: 'pass', arrivalWindowLocal: 'pass' },
  unverified: [],
  notApplied: [],
  seller: 'Example Travel',
  baggage: { cabinBag: 'included', checkedBags: 1 },
  fareConditions: { refundable: false, changeable: true },
  selfTransfer: false,
  booking: { kind: 'get', url: 'https://www.google.com/travel/clk/f?id=1', host: 'www.google.com' },
  searchLink: {
    url: 'https://www.google.com/travel/flights?q=LHR.JFK.2027-03-14',
    host: 'www.google.com',
    label: 'search link, not a fare link',
  },
  otherOffers: [],
  notSeenInLatest: null,
  adjustedPence: null,
  destinationNote: null,
  executionId: 'exec-0001',
  calendarPriceId: null,
  observationId: 101,
};

/** Class-verified itinerary row: one stop out via a synthetic hub, direct back. */
export function verifiedRow(over: Partial<RowIn> = {}): ResultRow {
  return apiContract.resultRowSchema.parse({ ...verifiedBase, ...over });
}

/** Class partially-verified, cheaper: shown by default (spec §6.9 hides only `failed` by default). */
export function partialRow(over: Partial<RowIn> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: 'hash-partial-1',
    verdictClass: 'partially-verified',
    pricePence: 38800,
    observationId: 102,
    cell: cell('LGW', 'EWR', '2027-03-15', '2027-03-27', 12),
    totalMinutes: 840,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    verdicts: { cabin: 'pass', checkedBagRequired: 'unverified' },
    unverified: ['checkedBagRequired'],
    ...over,
  });
}

/** Class-failed row carrying all three verdicts, with a POST booking and no baggage or conditions. */
export function failedRow(over: Partial<RowIn> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: 'hash-failed-1',
    verdictClass: 'failed',
    pricePence: 37700,
    observationId: 103,
    cell: cell('LGW', 'EWR', '2027-03-16', '2027-03-28', 12),
    verdicts: { cabin: 'pass', arrivalWindowLocal: 'fail', checkedBagRequired: 'unverified' },
    unverified: ['checkedBagRequired'],
    booking: {
      kind: 'post',
      url: 'https://www.google.com/travel/clk/f',
      postData: 'u=abc&tfu=xyz',
      host: 'www.google.com',
    },
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    ...over,
  });
}

/** Calendar-basis row (spec §6.9): unchecked, no segments, the not-applied note, a search link only. */
export function calendarRow(over: Partial<RowIn> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: null,
    basis: 'calendar',
    verdictClass: 'unchecked',
    pricePence: 39900,
    provenance: provCalendar,
    stale: false,
    ageHours: 50,
    cell: cell('LHR', 'EWR', '2027-04-02', '2027-04-16', 14),
    outbound: null,
    inbound: null,
    totalMinutes: null,
    outboundMinutes: null,
    inboundMinutes: null,
    stopsOut: null,
    stopsIn: null,
    layovers: [],
    carriers: [],
    verdicts: {},
    unverified: [],
    notApplied: ['arrivalWindowLocal', 'maxJourneyMinutes', 'maxStops'],
    seller: null,
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    booking: { kind: 'none' },
    searchLink: {
      url: 'https://search.aviasales.com/flights/?origin_iata=LHR&destination_iata=EWR&depart_date=2027-04-02&return_date=2027-04-16',
      host: 'search.aviasales.com',
      label: 'search link, not a fare link',
    },
    destinationNote: 'onward leg not included',
    calendarPriceId: 7,
    observationId: null,
    ...over,
  });
}

/** An ExecutionSummary (newest first in every list). */
export function summary(over: Partial<In<typeof apiContract.executionSummarySchema>> = {}): ExecutionSummary {
  return apiContract.executionSummarySchema.parse({
    id: 'exec-0001',
    status: 'completed',
    isChild: false,
    startedAt: '2026-10-14T12:00:00.000Z',
    finishedAt: '2026-10-14T13:00:00.000Z',
    ageHours: 2,
    // the run's own policy (decision 42); the definition() fixture's current expandTop is also 2
    expandTop: 2,
    ...over,
  });
}

const buckets = (
  priced: number,
  empty: number,
  noData: number,
  error: number,
  skipped: number,
  notRun: number,
) => ({
  priced,
  empty,
  no_data: noData,
  error,
  skipped,
  not_run: notRun,
  reused: 0,
});

/** The discovery and verification counts every fixture agrees on: 126 cells, 10 selected, 8 itinerary-searched. */
const discoveryBuckets = buckets(60, 10, 40, 6, 0, 10);
const verificationBuckets = buckets(8, 1, 0, 1, 116, 0);
const coverageSummary = {
  buckets: discoveryBuckets,
  total: 126,
  selected: 10,
  itinerarySearched: 8,
  onDemand: 1,
  reused: 0,
};

export function resultsResponse(
  over: Partial<In<typeof apiContract.resultsResponseSchema>> = {},
): ResultsResponse {
  const rows = over.rows ?? [verifiedBase, partialRow()];
  return apiContract.resultsResponseSchema.parse({
    rows,
    total: rows.length,
    truncated: false,
    basis: 'verified',
    basisReason: 'itinerary-searched observations exist',
    executions: [summary()],
    coverage: coverageSummary,
    excludedByCurrentSpace: 0,
    verificationProviderConfigured: true,
    cheapest: rows[0] ?? null,
    ...over,
  });
}

export function estimate(over: Partial<Estimate> = {}): Estimate {
  return apiContract.estimateSchema.parse({
    cells: 126,
    perProvider: [
      {
        providerId: 'travelpayouts',
        stage: 'discovery',
        calls: 14,
        planCalls: 12,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 20,
        blocked: null,
      },
      {
        providerId: 'searchapi',
        stage: 'verification',
        calls: 140,
        planCalls: 120,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 600,
        blocked: null,
      },
    ],
    totalCalls: 154,
    totalPlanCalls: 132,
    totalCostMicroGbp: 0,
    totalCostPence: 0,
    seconds: 620,
    assumptions: ['Travelpayouts month tiles per airport pair'],
    windowClamped: false,
    retryFactor: 1.2,
    ...over,
  });
}

export function definition(
  over: Partial<In<typeof apiContract.definitionResponseSchema>> = {},
): DefinitionResponse {
  return apiContract.definitionResponseSchema.parse({
    id: 'def-0001',
    name: 'Worked example',
    origins: ['LHR', 'LGW'],
    destinations: ['JFK', 'EWR'],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: {
      discovery: ['travelpayouts', 'searchapi'],
      verification: ['searchapi'],
      discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 },
    },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: '0 5 * * 1',
    scheduleTz: 'Europe/London',
    confirmedCostPence: 0,
    confirmedCalls: 154,
    enabled: true,
    createdAt: '2026-10-14T09:00:00.000Z',
    updatedAt: '2026-10-14T09:00:00.000Z',
    deletedAt: null,
    budgetFit: {
      fits: true,
      runsPerMonth: 4,
      perScope: [{ scope: 'provider-month:searchapi', estimated: 616, cap: 10000, fits: true }],
    },
    estimate: estimate(),
    needsConfirmation: null,
    notices: [],
    ...over,
  });
}

export function usage(
  scope: string,
  calls: number,
  cap: number | null,
  costMicroGbp = 0,
  start: string | null = null,
  end: string | null = null,
): UsageRow {
  return apiContract.usageSchema.parse({
    scope,
    calls,
    costMicroGbp,
    costPence: microGbpToPence(costMicroGbp),
    cap,
    windowStart: start,
    windowEnd: end,
  });
}

const OCTOBER = ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'] as const;

export function providersResponse(
  over: Partial<In<typeof apiContract.providersResponseSchema>> = {},
): ProvidersResponse {
  return apiContract.providersResponseSchema.parse({
    synthetic: false,
    pointOfSale: 'GB',
    providers: [
      {
        providerId: 'travelpayouts',
        displayName: 'Travelpayouts',
        enabled: true,
        plan: 'free',
        excludedFromSchedule: false,
        notices: [],
        capabilities: {
          discovery: {
            sourceKind: 'authorised-cached',
            provenanceNote: 'Aviasales cache of recent user searches',
            maxAgeHours: 48,
          },
          verification: null,
        },
        usage: [usage('provider-month:travelpayouts', 60, 50000, 0, ...OCTOBER)],
      },
      {
        providerId: 'searchapi',
        displayName: 'SearchApi',
        enabled: true,
        plan: '40usd',
        excludedFromSchedule: false,
        notices: [],
        capabilities: {
          discovery: {
            sourceKind: 'scraped-aggregate',
            provenanceNote: 'Google date grid via SearchApi',
            maxAgeHours: 24,
          },
          verification: {
            sourceKind: 'scraped-search',
            provenanceNote: 'Google Flights search via SearchApi; the vendor may serve a cached answer',
            maxAgeHours: 'unknown',
          },
        },
        usage: [usage('provider-month:searchapi', 615, 10000, 0, ...OCTOBER)],
      },
    ],
    presets: {
      policy: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true },
      providers: {
        discovery: ['travelpayouts', 'searchapi'],
        verification: ['searchapi'],
        discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 },
      },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      discoveryRefreshHours: 168,
      schedulerTimezone: 'Europe/London',
    },
    ...over,
  });
}

export function execution(
  over: Partial<In<typeof apiContract.executionResponseSchema>> = {},
): ExecutionResponse {
  return apiContract.executionResponseSchema.parse({
    id: 'exec-0001',
    definitionId: 'def-0001',
    isChild: false,
    cell: null,
    status: 'running',
    stage: 'discovery',
    reason: null,
    resumeAfter: null,
    trigger: 'manual',
    startedAt: '2026-10-14T14:00:00.000Z',
    finishedAt: null,
    errorText: null,
    progress: [
      { stage: 'discovery', providerId: 'travelpayouts', buckets: discoveryBuckets, total: 126 },
      { stage: 'verification', providerId: 'searchapi', buckets: buckets(0, 0, 0, 0, 116, 10), total: 126 },
    ],
    budget: [
      usage('execution-calls', 42, 2000),
      usage('execution-free-calls', 14, 2000),
      usage('global-month', 0, 35_000_000, 32_000_000),
      usage('provider-month:searchapi', 615, 10000, 0, ...OCTOBER),
    ],
    estimate: estimate(),
    ledger: {
      calls: 56,
      costMicroGbp: 0,
      costPence: 0,
      tiles: 14,
      cacheHits: 0,
      perProvider: [{ providerId: 'travelpayouts', stage: 'discovery', calls: 14, costMicroGbp: 0 }],
    },
    parityBreak: false,
    overrun: false,
    disabledProviders: [],
    ...over,
  });
}

export function coverageResponse(
  over: Partial<In<typeof apiContract.coverageResponseSchema>> = {},
): CoverageResponse {
  return apiContract.coverageResponseSchema.parse({
    executionId: 'exec-0001',
    summary: coverageSummary,
    perStage: [
      {
        stage: 'discovery',
        providerId: 'travelpayouts',
        buckets: discoveryBuckets,
        total: 126,
        requests: { calls: 14, cacheHits: 0, costMicroGbp: 0, planCalls: 14 },
        overrun: false,
        parityBreak: false,
      },
      {
        stage: 'verification',
        providerId: 'searchapi',
        buckets: verificationBuckets,
        total: 126,
        requests: { calls: 50, cacheHits: 0, costMicroGbp: 0, planCalls: 50 },
        overrun: false,
        parityBreak: false,
      },
    ],
    selectedNotReached: [
      { cell: cell('LHR', 'JFK', '2027-03-20', '2027-04-01', 12), reason: 'skipped:budget' },
    ],
    errors: [
      {
        cell: cell('LGW', 'EWR', '2027-03-21', '2027-04-02', 12),
        stage: 'discovery',
        providerId: 'travelpayouts',
        reason: 'rate-limit',
        lastError: 'HTTP 429',
        attempts: 3,
        retryable: true,
      },
    ],
    scheduleBlockedSince: null,
    ...over,
  });
}

export function calendarGap(
  over: Partial<In<typeof apiContract.calendarGapResponseSchema>> = {},
): CalendarGapResponse {
  return apiContract.calendarGapResponseSchema.parse({
    cheapestVerified: {
      pricePence: 41200,
      provenance: provSearch,
      stale: false,
      ageHours: 'unknown',
      truncated: false,
      cell: cell('LHR', 'JFK', '2027-03-14', '2027-03-28', 14),
      itineraryHash: 'hash-verified-1',
    },
    cells: [
      {
        cell: cell('LHR', 'EWR', '2027-04-02', '2027-04-16', 14),
        calendar: {
          pricePence: 39900,
          provenance: provCalendar,
          stale: false,
          ageHours: 50,
          truncated: false,
        },
        verifyAvailable: true,
      },
    ],
    ...over,
  });
}

export const airports: AirportsResponse = apiContract.airportsResponseSchema.parse([
  {
    iata: 'LHR',
    name: 'Heathrow',
    city: 'London',
    country: 'United Kingdom',
    tz: 'Europe/London',
    metro: 'LON',
  },
  {
    iata: 'LGW',
    name: 'Gatwick',
    city: 'London',
    country: 'United Kingdom',
    tz: 'Europe/London',
    metro: 'LON',
  },
]);

export function coverageCheck(
  over: Partial<In<typeof apiContract.coverageCheckResponseSchema>> = {},
): CoverageCheckResponse {
  return apiContract.coverageCheckResponseSchema.parse({
    pairs: [
      {
        origin: 'LHR',
        destination: 'JFK',
        months: [
          { month: '2027-03', cachedRows: 5, cellsInBand: 372 },
          { month: '2027-04', cachedRows: 0, cellsInBand: 360 },
        ],
      },
    ],
    calls: 14,
    notes: [],
    ...over,
  });
}
```

`test/msw/handlers.ts` (new file):

```ts
import { HttpResponse, http, type JsonBodyType } from 'msw';
import {
  API,
  airports,
  calendarGap,
  coverageCheck,
  coverageResponse,
  definition,
  estimate,
  execution,
  providersResponse,
  resultsResponse,
} from '../fixtures.js';

/** A valid response body for each mutation the views send. */
const MUTATIONS: ReadonlyArray<{ method: 'POST' | 'PUT'; path: string; body: JsonBodyType }> = [
  { method: 'POST', path: '/api/executions/:id/cancel', body: execution({ status: 'cancelled' }) },
  { method: 'POST', path: '/api/executions/:id/resume', body: execution({ status: 'running' }) },
  { method: 'POST', path: '/api/definitions/:id/executions', body: { executionId: 'exec-0002' } },
  { method: 'POST', path: '/api/cells/verify', body: { executionId: 'exec-child-1' } },
  {
    method: 'POST',
    path: '/api/definitions/estimate',
    body: { estimate: estimate(), budgetFit: definition().budgetFit },
  },
  { method: 'POST', path: '/api/definitions/coverage-check', body: coverageCheck() },
  { method: 'POST', path: '/api/definitions', body: definition({ id: 'def-0002' }) },
  { method: 'PUT', path: '/api/definitions/:id', body: definition() },
];

/** The body a default handler returns for a mutation; tests reuse it when they override a handler. */
export function fixtureFor(method: 'POST' | 'PUT', path: string): JsonBodyType {
  const m = MUTATIONS.find((x) => x.method === method && x.path === path);
  if (m === undefined) throw new Error(`no fixture body for ${method} ${path}`);
  return m.body;
}

/** Handler URLs are absolute: API already ends in /api, and the paths start with it. */
const url = (path: string) => `${API}${path.slice('/api'.length)}`;

/** Default API: one definition, both providers, a completed run with two itinerary rows. */
export const handlers = [
  http.get(url('/api/providers'), () => HttpResponse.json(providersResponse())),
  http.get(url('/api/definitions'), () => HttpResponse.json([definition()])),
  http.get(url('/api/definitions/:id/results'), () => HttpResponse.json(resultsResponse())),
  http.get(url('/api/executions/:id'), () =>
    HttpResponse.json(
      execution({ status: 'completed', stage: 'verification', finishedAt: '2026-10-14T13:00:00.000Z' }),
    ),
  ),
  http.get(url('/api/definitions/:id/coverage'), () => HttpResponse.json(coverageResponse())),
  http.get(url('/api/definitions/:id/calendar-gap'), () => HttpResponse.json(calendarGap({ cells: [] }))),
  http.get(url('/api/airports'), () => HttpResponse.json(airports)),
  ...MUTATIONS.map((m) =>
    (m.method === 'POST' ? http.post : http.put)(url(m.path), () => HttpResponse.json(m.body)),
  ),
];
```

`test/msw/server.ts` (new file):

```ts
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { unhandled } from '../guards.js';
import { handlers } from './handlers.js';

/**
 * The test API. A catch-all handler, registered last, records any request no handler matched and
 * answers with a network error, so nothing reaches the network (decision 18) and the test fails in
 * afterEach (test/setup.ts) even when the app swallowed the error into a query state.
 */
export const server = setupServer(
  ...handlers,
  http.all('*', ({ request }) => {
    unhandled.push(`${request.method} ${request.url}`);
    return HttpResponse.error();
  }),
);
```

`test/setup.ts` — replace the file (adds the msw lifecycle and the unmatched-request check):

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { consoleErrors, drainGuards } from './guards.js';
import { server } from './msw/server.js';
import { setViewportWidth } from './viewport.js';

// why: msw 3 names the unmatched-request policy onUnhandledFrame; the catch-all in server.ts records the rest.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  // why: jsdom has no matchMedia; every test starts wide and opts into 375px explicitly.
  setViewportWidth(1280);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
});
afterEach(() => {
  // why: Vitest runs without globals, so RTL's automatic cleanup never registers.
  cleanup();
  // why: per-test handlers prepended with server.use() must not leak into the next test.
  server.resetHandlers();
  vi.restoreAllMocks();
  const problems = drainGuards();
  if (problems.length > 0) throw new Error(problems.join(' | '));
});
afterAll(() => server.close());
// why: jsdom has no scrollIntoView; the ?row= test spies on this stub.
if (typeof Element.prototype.scrollIntoView !== 'function')
  Element.prototype.scrollIntoView = () => undefined;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/api test/harness.test.ts test/components test/copy test/format.test.ts`
Expected: PASS, 12 + 4 tests in the new files and every earlier test still green. A failure naming a field in "response does not match core/api-contract" means a fixture differs from the merged schema: fix the fixture (never loosen the schema).

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: schema-typed API client parsed in every mode, query hooks, msw test API"
```

### Task 9.4: URL state: view, definition, basis, sort and filters

**Files:**
- Create: `src/state/urlState.ts`, `src/state/view.ts`, `src/state/withKey.ts`, `src/state/resultsState.ts`, `src/state/carriers.ts`, `src/hooks/useMediaQuery.ts`, `src/hooks/useSynced.ts`
- Test: `test/state/resultsState.test.ts`

**Interfaces:**
- Consumes: `SortKey`, `ResultFilters` (with Task 9.0's `departure`), `apiContract.verdictClassSchema`, `providerIdSchema`, `constraintNameSchema`, `cellKeySchema` (its `destination` and `departureDate` parse URL tokens into the branded types).
- Produces: `useSearchParams`, `updateSearchParams`, `hrefWith`, `navigateTo`, `NavClick`, `ViewId`, `VIEWS`, `parseView`, `withKey`, `oneOf`, `SortDir`, `ResultsUiState`, `SORT_KEYS`, `CLASSES`, `DEFAULT_CLASSES`, `parseResultsState`, `resultsStatePatch`, `parseBasis`, `parseSelectedRow`, `setFilter`, `activeFilterCount`, `parseCarriers`, `carriersText`, `useMediaQuery`, `NARROW_QUERY`, `useSynced`.

Decision (spec §11 "filter and sort state persists across views"): **URL search params**. They survive view switches (nav links copy every parameter except `view`), reloads and bookmarks, and need no store library. Keys: `view`, `def`, `basis`, `sort` (`price.asc`; absent = the server's class-then-price ranking), `f.class` (absent = spec §6.9's default, every class except `failed`), `f.provider`, `f.stops`, `f.carriers`, `f.dest`, `f.maxPrice` (pence), `f.nights` (`10-14`), `f.depart` (`2027-03-01..2027-03-31`), `f.stale` (`hide`), `f.unverified`, and `row=<resultRowKey>`, which selects, expands and scrolls to one results row (plan "Web"; email links use it). Every list the parser accepts comes from the contract's enums (review arch-010), and every token is parsed by a core schema or a type guard, so no value is cast into a brand or a union. `withKey` is the one helper that sets or removes an optional key, `parseCarriers` the one carriers parser and `useSynced` the one way a typed box follows its value; the Results filters and the Definitions form share all three (review arch-r2-009).

- [ ] **Step 1: Write the failing test**

`test/state/resultsState.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  DEFAULT_CLASSES,
  parseBasis,
  parseResultsState,
  parseSelectedRow,
  type ResultsUiState,
  resultsStatePatch,
  setFilter,
} from '../../src/state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams } from '../../src/state/urlState.js';
import { parseView } from '../../src/state/view.js';
import { withKey } from '../../src/state/withKey.js';

const full: ResultsUiState = {
  sort: { key: 'totalTime', dir: 'desc' },
  filters: {
    verdictClass: ['verified', 'partially-verified'],
    providerId: ['searchapi'],
    maxStops: 1,
    carriers: ['ZZ', 'YY'],
    destination: [asIata('JFK')],
    maxPricePence: 50000,
    nights: { min: 10, max: 14 },
    hideStale: true,
    unverified: ['checkedBagRequired', 'cabin'],
    departure: { from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-31') },
  },
};

function toParams(patch: Record<string, string | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) if (v !== null) p.set(k, v);
  return p;
}

describe('results UI state in the URL (spec §11: filter and sort persist across views)', () => {
  it('round-trips every filter, the departure-date range included, and the sort', () => {
    expect(parseResultsState(toParams(resultsStatePatch(full)))).toEqual(full);
    expect(resultsStatePatch(full)['f.depart']).toBe('2027-03-01..2027-03-31');
  });

  it('no sort param means the server ranking (class then price, spec §6.5); no class param means the spec §6.9 default', () => {
    expect(parseResultsState(new URLSearchParams()).sort).toBeNull();
    expect(resultsStatePatch({ sort: null, filters: {} }).sort).toBeNull();
    expect(DEFAULT_CLASSES).toEqual(['verified', 'partially-verified', 'unchecked']);
  });

  it('ignores malformed values instead of guessing', () => {
    const s = parseResultsState(
      new URLSearchParams(
        'sort=bogus.up&f.class=verified,nope&f.stops=-1&f.nights=14-10x&f.provider=amadeus&f.dest=jfk,JFKX&f.depart=2027-03-31..2027-03-01&f.unverified=x',
      ),
    );
    expect(s).toEqual({ sort: null, filters: { verdictClass: ['verified'] } });
    expect(
      parseResultsState(
        new URLSearchParams('sort=price.sideways&f.nights=14-10&f.depart=2027-02-30..2027-03-01'),
      ).filters,
    ).toEqual({});
  });

  it('setFilter and withKey add and remove keys without leaving undefined behind', () => {
    const a = setFilter({}, 'maxStops', 0);
    expect(a).toEqual({ maxStops: 0 });
    expect(Object.keys(setFilter(a, 'maxStops', undefined))).toEqual([]);
    expect(withKey({ a: 1, b: 2 }, 'b', undefined)).toEqual({ a: 1 });
    expect(activeFilterCount(full.filters)).toBe(10);
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
    expect(hrefWith({ sort: null })).toBe('/?view=results&def=d1&f.stops=1');
    updateSearchParams({ view: 'coverage' }, 'push');
    expect(window.location.search).toBe('?view=coverage&def=d1&sort=price.asc&f.stops=1');
    updateSearchParams({ view: 'results' });
    expect(parseResultsState(new URLSearchParams(window.location.search)).filters).toEqual({ maxStops: 1 });
  });

  it('a nav click navigates in place; a modified click is left to the browser', () => {
    window.history.replaceState(null, '', '/?view=results');
    let prevented = 0;
    const click = (
      over: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }>,
    ) => ({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      button: 0,
      ...over,
      preventDefault: () => {
        prevented += 1;
      },
    });
    const go = navigateTo({ view: 'providers' });
    go(click({ metaKey: true }));
    go(click({ ctrlKey: true }));
    go(click({ shiftKey: true }));
    go(click({ button: 1 }));
    expect([prevented, window.location.search]).toEqual([0, '?view=results']);
    go(click({}));
    expect([prevented, window.location.search]).toEqual([1, '?view=providers']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/state/resultsState.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/state/resultsState.js"`.

- [ ] **Step 3: Implement**

`src/state/withKey.ts` (new file):

```ts
/**
 * Returns a copy of `obj` with `key` set, or removed when `value` is undefined, so optional keys are
 * absent rather than `undefined` (exactOptionalPropertyTypes). The one helper for filters and drafts.
 */
export function withKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** A type guard for membership of a readonly list of string literals (URL tokens, select values). */
export function oneOf<T extends string>(set: readonly T[]): (v: string) => v is T {
  return (v: string): v is T => set.some((s) => s === v);
}
```

`src/state/urlState.ts` (new file):

```ts
import { useMemo, useSyncExternalStore } from 'react';

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
export function updateSearchParams(
  patch: Record<string, string | null>,
  mode: 'push' | 'replace' = 'replace',
): void {
  const url = merged(patch);
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  for (const l of listeners) l();
}

/** The parts of a click navigateTo reads; React's MouseEvent has them. */
export interface NavClick {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button: number;
  preventDefault(): void;
}

/** onClick for an <a href={hrefWith(patch)}>: client-side navigation that keeps the link a real link. */
export function navigateTo(patch: Record<string, string | null>) {
  return (e: NavClick) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    updateSearchParams(patch, 'push');
  };
}
```

`src/state/view.ts` (new file):

```ts
import { oneOf } from './withKey.js';

/** Every view of spec §11; WP9 owns the nav for all of them. */
export type ViewId =
  | 'results'
  | 'calendar'
  | 'duration'
  | 'history'
  | 'coverage'
  | 'definitions'
  | 'alerts'
  | 'providers';
export const VIEWS: readonly ViewId[] = [
  'results',
  'calendar',
  'duration',
  'history',
  'coverage',
  'definitions',
  'alerts',
  'providers',
];

const isView = oneOf(VIEWS);

/** `?view=`; anything unknown or absent is Results. */
export function parseView(v: string | null): ViewId {
  return v !== null && isView(v) ? v : 'results';
}
```

`src/state/resultsState.ts` (new file):

```ts
import { apiContract, type ResultFilters, type SortKey } from '@gmt/core';
import type { Basis } from '../api/types.js';
import { oneOf, withKey } from './withKey.js';

/** sortRows's direction parameter (plan "Core domain functions": `dir: 'asc' | 'desc'`). */
export type SortDir = 'asc' | 'desc';

/** View A state held in the URL (spec §11). `sort: null` keeps the server's class-then-price order. */
export interface ResultsUiState {
  sort: { key: SortKey; dir: SortDir } | null;
  filters: ResultFilters;
}

type ClassFilter = NonNullable<ResultFilters['verdictClass']>[number];

/** Spec §6.5 sort keys, in the column order of spec §11. */
export const SORT_KEYS: readonly SortKey[] = [
  'price',
  'totalTime',
  'departure',
  'return',
  'nights',
  'stops',
  'adjusted',
];
/** Every verdict class a row can carry, from the contract (calendar rows are `unchecked`). */
export const CLASSES: readonly ClassFilter[] = [...apiContract.verdictClassSchema.options, 'unchecked'];
/** Spec §6.9: `failed` is excluded by default and included by filter (core's filterRows default). */
export const DEFAULT_CLASSES: readonly ClassFilter[] = CLASSES.filter((c) => c !== 'failed');

const isSortKey = oneOf(SORT_KEYS);
const isClass = oneOf(CLASSES);
const isProvider = oneOf(apiContract.providerIdSchema.options);
const isConstraint = oneOf(apiContract.constraintNameSchema.options);

const list = (v: string | null): string[] => (v ? v.split(',').filter((s) => s.length > 0) : []);
const int = (v: string | null): number | undefined => (v !== null && /^\d+$/.test(v) ? Number(v) : undefined);
const CARRIER = /^[A-Z0-9]{2}$/;

/** Returns the filters with `key` set, or removed when `value` is undefined. */
export function setFilter<K extends keyof ResultFilters>(
  f: ResultFilters,
  key: K,
  value: ResultFilters[K] | undefined,
): ResultFilters {
  return withKey(f, key, value);
}

export function parseBasis(v: string | null): Basis | null {
  return v === 'verified' || v === 'calendar' ? v : null;
}

/** `row=<resultRowKey>` (plan "Web"): the row an email link points at; bounded so a pasted URL cannot be huge. */
export function parseSelectedRow(p: URLSearchParams): string | null {
  const v = p.get('row');
  return v !== null && v.length > 0 && v.length <= 200 ? v : null;
}

/** Number of filter keys the operator set (the class default does not count). */
export function activeFilterCount(f: ResultFilters): number {
  return Object.keys(f).length;
}

/**
 * Strict parse: malformed tokens are dropped, never coerced. Codes and dates go through core's
 * schemas, which also give the branded types the filter takes (no casts).
 */
export function parseResultsState(p: URLSearchParams): ResultsUiState {
  const rawSort = p.get('sort');
  let sort: ResultsUiState['sort'] = null;
  if (rawSort !== null) {
    const [k, d] = rawSort.split('.');
    if (k !== undefined && isSortKey(k) && (d === 'asc' || d === 'desc')) sort = { key: k, dir: d };
  }
  let f: ResultFilters = {};
  const classes = list(p.get('f.class')).filter(isClass);
  if (classes.length > 0) f = setFilter(f, 'verdictClass', classes);
  const providers = list(p.get('f.provider')).filter(isProvider);
  if (providers.length > 0) f = setFilter(f, 'providerId', providers);
  f = setFilter(f, 'maxStops', int(p.get('f.stops')));
  const carriers = list(p.get('f.carriers')).filter((c) => CARRIER.test(c));
  if (carriers.length > 0) f = setFilter(f, 'carriers', carriers);
  // why: the URL is operator-editable; only codes core's iataSchema accepts become the Iata the filter takes.
  const dests = list(p.get('f.dest')).flatMap((c) => {
    const r = apiContract.cellKeySchema.shape.destination.safeParse(c);
    return r.success && c === r.data ? [r.data] : [];
  });
  if (dests.length > 0) f = setFilter(f, 'destination', dests);
  f = setFilter(f, 'maxPricePence', int(p.get('f.maxPrice')));
  const nights = /^(\d+)-(\d+)$/.exec(p.get('f.nights') ?? '');
  if (nights?.[1] !== undefined && nights[2] !== undefined && Number(nights[1]) <= Number(nights[2])) {
    f = setFilter(f, 'nights', { min: Number(nights[1]), max: Number(nights[2]) });
  }
  const [from, to] = (p.get('f.depart') ?? '').split('..');
  const dateOf = apiContract.cellKeySchema.shape.departureDate;
  const fromDate = dateOf.safeParse(from);
  const toDate = dateOf.safeParse(to);
  if (fromDate.success && toDate.success && fromDate.data <= toDate.data) {
    f = setFilter(f, 'departure', { from: fromDate.data, to: toDate.data });
  }
  if (p.get('f.stale') === 'hide') f = setFilter(f, 'hideStale', true);
  const unverified = list(p.get('f.unverified')).filter(isConstraint);
  if (unverified.length > 0) f = setFilter(f, 'unverified', unverified);
  return { sort, filters: f };
}

const joined = (xs: readonly string[] | undefined): string | null =>
  xs && xs.length > 0 ? xs.join(',') : null;
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
    'f.depart': f.departure === undefined ? null : `${f.departure.from}..${f.departure.to}`,
    'f.stale': f.hideStale === true ? 'hide' : null,
    'f.unverified': joined(f.unverified),
  };
}
```

`src/state/carriers.ts` (new file):

```ts
/** Spec §6.5 carriers, typed as comma-separated two-character codes (Results filter and the airline constraints). */
/** Splits a carriers box into codes and the entries it ignores, which callers show, never silently drop. */
export function parseCarriers(s: string): { codes: string[]; ignored: string[] } {
  const entries = s
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
  return {
    codes: entries.filter((c) => /^[A-Z0-9]{2}$/.test(c)),
    ignored: entries.filter((c) => !/^[A-Z0-9]{2}$/.test(c)),
  };
}

/** The codes a carriers box means, comma-joined: what useSynced compares. */
export function carriersText(input: string): string {
  return parseCarriers(input).codes.join(',');
}
```

`src/hooks/useSynced.ts` (new file):

```ts
import { useEffect, useState } from 'react';

/**
 * A typed box that follows its value when it changes elsewhere (Clear filters, the back button, an import)
 * but keeps what the operator typed while that text already means the value ("zz, British" for carriers ZZ;
 * "450.5" for 45050 pence). `means` turns the text into the value's string form.
 */
export function useSynced(urlValue: string, means: (text: string) => string): [string, (v: string) => void] {
  const [text, setText] = useState(urlValue);
  useEffect(() => setText((t) => (means(t) === urlValue ? t : urlValue)), [urlValue, means]);
  return [text, setText];
}
```

`src/hooks/useMediaQuery.ts` (new file):

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
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: URL-held view, basis, sort and filter state with schema-parsed tokens"
```

### Task 9.5: Shell: nav, definition selector, synthetic banner, provider error state, empty state, placeholders

**Files:**
- Create: `src/main.tsx`, `src/App.tsx`, `src/components/Nav.tsx`, `src/components/DefinitionSelector.tsx`, `src/components/SyntheticBanner.tsx`, `src/components/LoadState.tsx`, `src/components/AppBoundary.tsx`, `src/views/Placeholder.tsx`
- Test: `test/app/shell.test.tsx`

**Interfaces:**
- Consumes: `useProviders`, `useDefinitions` (Task 9.3); URL state (Task 9.4).
- Produces: `App`, `Nav`, `DefinitionSelector`, `SyntheticBanner`, `Loading`, `LoadError`, `AppBoundary`, `Placeholder`. This task's `App` shows the placeholder for every view; Task 9.13 gives the final file with the status bar and the views (the views are tested directly until then).

Decisions. **A failed `GET /api/providers` is an error state** (decision 36): the page says provider status is unknown, so whether its prices are synthetic is unknown, instead of a silently absent banner. The banner itself follows `/providers`'s `synthetic`, and Task 9.8 also raises it from the data: any result row whose source kind is synthetic. **The placeholder names no work package** ("This view is not available yet."; review UI-12), and on Calendar it says the Results departure-date filters slice the window by month meanwhile (review PFT-14); a `def=` that names a missing definition says so, distinct from "no definitions yet". **Every nav target is at least 44 px tall** (`min-h-11`; review UI-15). **A top-level boundary** around the views keeps a render error from blanking the page (review tsr-002).

- [ ] **Step 1: Write the failing test**

`test/app/shell.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { AppBoundary } from '../../src/components/AppBoundary.js';
import { API, definition, providersResponse } from '../fixtures.js';
import { expectConsoleErrors } from '../guards.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

describe('shell (spec §11 layout)', () => {
  it('nav lists every view, with 44px targets, and keeps filters when switching', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001&f.stops=1' });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    for (const name of [
      'Results',
      'Calendar',
      'Duration',
      'History',
      'Coverage',
      'Definitions',
      'Alerts',
      'Providers',
    ]) {
      expect(within(nav).getByRole('link', { name })).toHaveClass('min-h-11');
    }
    await user.click(within(nav).getByRole('link', { name: 'Calendar' }));
    expect(window.location.search).toBe('?view=calendar&def=def-0001&f.stops=1');
    expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  });

  it.each(['duration', 'history', 'alerts'])(
    '%s is a placeholder that names no work package',
    async (view) => {
      renderWithProviders(<App />, { search: `?view=${view}` });
      expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
      expect(screen.queryByText(/WP1/)).toBeNull();
    },
  );

  it('definition selector lists definitions and writes def= to the URL', async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([definition(), definition({ id: 'def-0002', name: 'Second example' })]),
      ),
    );
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

  it('negative: no synthetic banner and no provider alert for real data', async () => {
    renderWithProviders(<App />, { search: '?view=calendar' });
    await screen.findByLabelText('Search definition');
    await screen.findByText('This view is not available yet.');
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
    expect(screen.queryByText(/Provider status unknown/)).toBeNull();
  });

  it('a failed GET /api/providers is an error state, never a silently absent banner (decision 36)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<App />, { search: '?view=calendar' });
    expect(
      await screen.findByText(
        'Provider status unknown, so this page cannot say whether its prices are synthetic: database is locked',
      ),
    ).toBeInTheDocument();
  });

  it('empty state when no provider is configured', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          providersResponse({
            providers: providersResponse().providers.map((p) => ({ ...p, enabled: false })),
          }),
        ),
      ),
    );
    renderWithProviders(<App />, { search: '?view=calendar' });
    expect(await screen.findByText(/No flight data provider is configured/)).toBeInTheDocument();
  });

  it('no definitions, and a def= that names a missing one, say different things', async () => {
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json([])));
    const { unmount } = renderWithProviders(<App />, { search: '?view=coverage' });
    expect(
      await screen.findAllByText('No search definitions yet. Create one under Definitions.'),
    ).not.toHaveLength(0);
    unmount();
    server.resetHandlers();
    renderWithProviders(<App />, { search: '?view=coverage&def=gone' });
    expect(
      await screen.findByText('The definition in this link no longer exists. Pick another one above.'),
    ).toBeInTheDocument();
  });
});

describe('the page never blanks (review tsr-002)', () => {
  function Broken(): never {
    throw new Error('render failed');
  }

  it('a render error inside the views shows a message, not an empty page', () => {
    expectConsoleErrors(/render failed/);
    renderWithProviders(
      <AppBoundary>
        <Broken />
      </AppBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong while drawing this page. Reload to try again; nothing was sent.',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/app/shell.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/App.js"`.

- [ ] **Step 3: Implement**

`src/components/Nav.tsx` (new file):

```tsx
import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';
import { VIEWS, type ViewId } from '../state/view.js';

/**
 * Spec §11: nav for all views, owned by WP9. Links are real links, so they work with the keyboard
 * and new tabs; each is at least 44 px tall (touch target, review UI-15).
 */
export function Nav({ current }: { current: ViewId }) {
  return (
    <nav aria-label={COPY.navLabel}>
      <ul className="flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <li key={v}>
            <a
              href={hrefWith({ view: v })}
              onClick={navigateTo({ view: v })}
              aria-current={v === current ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded px-3 text-sm ${v === current ? 'bg-slate-900 text-white' : 'text-slate-800 underline'}`}
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

`src/components/DefinitionSelector.tsx` (new file):

```tsx
import type { DefinitionResponse } from '../api/types.js';
import { COPY } from '../copy.js';
import { updateSearchParams } from '../state/urlState.js';

/** Spec §11 definition selector; writes `def=` so every view and the status bar follow it. */
export function DefinitionSelector({
  definitions,
  selectedId,
}: {
  definitions: readonly DefinitionResponse[];
  selectedId: string | null;
}) {
  if (definitions.length === 0) return <p className="text-sm">{COPY.noDefinitions}</p>;
  return (
    <span className="flex items-center gap-2 text-sm">
      <label htmlFor="definition-select">{COPY.definitionSelectorLabel}</label>
      <select
        id="definition-select"
        value={selectedId ?? ''}
        onChange={(e) => updateSearchParams({ def: e.target.value }, 'push')}
        className="min-h-11 rounded border border-slate-400 px-1"
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

`src/components/SyntheticBanner.tsx` (new file):

```tsx
import { COPY } from '../copy.js';

/**
 * Spec §5.5: red and data-driven. App shows it when /providers says `synthetic`; a view also shows
 * it when any price it received has the synthetic source kind, whatever /providers said.
 */
export function SyntheticBanner() {
  return (
    <div role="alert" className="bg-red-700 px-4 py-2 font-semibold text-white">
      {COPY.syntheticBanner}
    </div>
  );
}
```

`src/components/LoadState.tsx` (new file):

```tsx
import { COPY } from '../copy.js';

/** A query in flight: announced politely (review UI-13). */
export function Loading() {
  return <p role="status">{COPY.loading}</p>;
}

/** A query that failed: the reason and a retry, never stale numbers (review UI-13, tsr-011). */
export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-red-700 p-2 text-sm">
      <span>{COPY.loadFailed(error.message)}</span>
      <button type="button" className="min-h-11 rounded border border-slate-500 px-3" onClick={retry}>
        {COPY.retryLoad}
      </button>
    </div>
  );
}
```

`src/components/AppBoundary.tsx` (new file):

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COPY } from '../copy.js';

/** Top-level boundary: a render error shows a message instead of a blank page (review tsr-002). */
export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[page failed]', error.message, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <p role="alert" className="p-4 font-medium text-red-800">
        {COPY.appFailed}
      </p>
    ) : (
      this.props.children
    );
  }
}
```

`src/views/Placeholder.tsx` (new file):

```tsx
import { COPY } from '../copy.js';

/**
 * Route body for a view another work package owns (WP10: Calendar, Duration, History; WP11: Alerts).
 * `hint` names what to use meanwhile (the Calendar's month slicing is the Results departure filter).
 */
export function Placeholder({ hint = null }: { hint?: string | null }) {
  return (
    <div className="space-y-1 p-4 text-slate-700">
      <p>{COPY.placeholder}</p>
      {hint !== null ? <p className="text-sm">{hint}</p> : null}
    </div>
  );
}
```

`src/App.tsx` (new file; this task's version, Task 9.13 replaces it):

```tsx
import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { LoadError } from './components/LoadState.js';
import { Nav } from './components/Nav.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { useSearchParams } from './state/urlState.js';
import { parseView } from './state/view.js';
import { Placeholder } from './views/Placeholder.js';

/**
 * Spec §11 layout: synthetic banner, header with nav and definition selector. When /providers fails,
 * the page says provider status is unknown instead of silently showing no banner (decision 36); the
 * views stay inside a boundary so a render error never blanks the page. This task's version shows a
 * placeholder for every view; Task 9.13 gives the final file, with the status bar and the views.
 */
export function App() {
  const params = useSearchParams();
  const view = parseView(params.get('view'));
  const providers = useProviders();
  const definitions = useDefinitions();
  const list = (definitions.data ?? []).filter((d) => d.deletedAt === null);
  const requested = params.get('def');
  const selectedId = requested ?? list[0]?.id ?? null;
  const selected = list.find((d) => d.id === selectedId) ?? null;
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  const needsDefinition = view === 'results' || view === 'coverage';
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
      {providers.error ? (
        <p role="alert" className="bg-red-100 px-4 py-2 font-semibold text-red-900">
          {COPY.providersUnknown(providers.error.message)}
        </p>
      ) : null}
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-300 px-4 py-2">
        <h1 className="text-lg font-bold">{COPY.appTitle}</h1>
        <Nav current={view} />
        <DefinitionSelector definitions={list} selectedId={selectedId} />
      </header>
      <main className="px-4 py-3">
        <AppBoundary>
          {noProviders ? (
            <p className="mb-3 rounded border border-slate-400 p-3">{COPY.emptyNoProviders}</p>
          ) : null}
          {definitions.error ? (
            <LoadError error={definitions.error} retry={() => void definitions.refetch()} />
          ) : null}
          {needsDefinition && definitions.data !== undefined && selected === null ? (
            <p>{requested !== null ? COPY.definitionNotFound : COPY.noDefinitions}</p>
          ) : null}
          {needsDefinition && selected === null ? null : <Placeholder hint={view === 'calendar' ? COPY.calendarPlaceholderHint : null} />}
        </AppBoundary>
      </main>
    </div>
  );
}
```

`src/main.tsx` (new file):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

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
Expected: PASS, 11 tests, and the copy guards still green over the new `.tsx` files.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: shell with nav, selector, synthetic banner, provider error state, boundary"
```

### Task 9.6: Status bar and per-view header

**Files:**
- Create: `src/components/StatusBar.tsx`, `src/components/ViewHeader.tsx`
- Test: `test/components/statusBar.test.tsx`

**Interfaces:**
- Consumes: `useResults`, `useExecution`, `useCoverage`, `useExecutionActions`, `POLL_MS` (Task 9.3); `ACTIVE_STATUSES`, `apiContract.providerIdSchema` (WP0); `coverage.scheduleBlockedSince`, newest-first `executions` with `isChild`, flat `Usage` rows with scope labels (`execution-calls`, `execution-free-calls`, `execution-cost`, `global-month`, `provider-month:<id>`), `execution.resumeAfter`, `definition.estimate`, `definition.needsConfirmation`.
- Produces: `StatusBar({ definition, showRunNow })`, `ViewHeader({ title, executions, stale, variant? })`.

Decisions. **Progress is one line per stage × provider**, never summed across providers (review po-002), and "done" counts only outcomes a provider answered or failed on: priced, no fares, no cached data, error (decision 36). Skipped and not-searched cells are stated beside it; the verification line reads "itinerary-searched K of N selected" with N from the results response's coverage (spec §3, §11; review prov-r2-009). Each line is a `progressbar` with value and maximum. **Spend** shows the run's calls, free calls and cost, the global month in pounds, and every `provider-month:<id>` call cap, which is the hard stop on the $40 plan where marginal cost is £0 (review po-003); a figure at or above 80% of its cap is marked "near cap" (any use of a zero cap counts; a null cap reads "no cap" and is never near). **The bar follows the newest parent run** (review po-009); an active one-cell child gets its own line, so a paused parent keeps its Resume. `paused_budget` shows when it resumes. **Run now** names the stored estimate and the run's hard stop ("Run now (about 154 calls (hard stop 2000), £0)", decision 44), sends the stored `confirmCostPence` and `confirmCalls` (decision 43: a confirmation covers a run only with both), is disabled while the estimate is above the confirmation, and appears only on Results and Definitions (`showRunNow`). **Cancel asks once more.** The status text sits in a polite live region. **ViewHeader** names runs by start time (UTC, labelled), never an id slice; a run with no start says "not started yet" with no age (review prov-r2-011); ages may be `'unknown'` and say so; it reads only `HeaderRun`'s fields, so View D can build its row from the execution itself; the not-completed banner follows the newest parent run; `variant="span"`, which WP10's cross-execution views use (decision 38), states that no single run status applies and shows no banner. Providers and Definitions show configuration, not a run, so they have no run header; the status bar names the run on those views.

- [ ] **Step 1: Write the failing test**

`test/components/statusBar.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../src/api/queries.js';
import { near, StatusBar } from '../../src/components/StatusBar.js';
import { ViewHeader } from '../../src/components/ViewHeader.js';
import {
  API,
  coverageResponse,
  definition,
  execution,
  resultsResponse,
  summary,
  usage,
} from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

const bar = (over: Parameters<typeof definition>[0] = {}, showRunNow = true) => (
  <StatusBar definition={definition(over)} showRunNow={showRunNow} />
);

afterEach(() => vi.useRealTimers());

describe('status bar (spec §11)', () => {
  it('one honest progress line per stage × provider: answered cells, skipped and not searched always add up', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    expect(await screen.findByText('running')).toBeInTheDocument();
    const lines = screen.getAllByRole('progressbar');
    expect(lines.map((l) => l.textContent)).toEqual([
      'discovery · Travelpayouts: searched 116 of 126 cells (6 error) · 0 skipped · 10 not searched',
      'itinerary search · SearchApi: itinerary-searched 0 of 10 selected (0 error) · 116 skipped · 10 not searched',
    ]);
    // why: the itinerary-search line counts against the selected cells (spec §3), from the results response.
    expect(lines.map((l) => [l.getAttribute('aria-valuenow'), l.getAttribute('aria-valuemax')])).toEqual([
      ['116', '126'],
      ['0', '10'],
    ]);
  });

  it('shows spend used / cap for the run, the month and each provider-month call cap, marking a cap that is near', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    expect(await screen.findByText('this run: 42 of 2000 billed calls')).toBeInTheDocument();
    expect(screen.getByText('this run: 14 of 2000 free calls')).toBeInTheDocument();
    expect(screen.getByText('this month: SearchApi 615 of 10000 calls')).toBeInTheDocument();
    const month = screen.getByText('this month: £32 of £35');
    expect(month).toHaveTextContent('near cap');
    expect(screen.getByText('this month: SearchApi 615 of 10000 calls')).not.toHaveTextContent('near cap');
  });

  it('Cancel asks once more, then posts to /executions/:id/cancel with the CSRF header', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
      http.post(`${API}/executions/:id/cancel`, ({ request, params }) => {
        seen.push(`${String(params.id)} ${request.headers.get('x-requested-with')}`);
        return HttpResponse.json(execution({ status: 'cancelled' }));
      }),
    );
    const { user } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(seen).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: cancel this run' }));
    await expect.poll(() => seen).toEqual(['exec-0001 get-me-there']);
  });

  it('a failed action is announced (cancel answered 409)', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
      http.post(`${API}/executions/:id/cancel`, () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'execution already finished' } },
          { status: 409 },
        ),
      ),
    );
    const { user } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: cancel this run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That did not work: execution already finished',
    );
  });

  it('paused: shows the reason and when it resumes, and Resume posts /resume', async () => {
    let resumed = 0;
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'paused_budget',
            reason: 'searchapi provider-month cap reached',
            resumeAfter: '2026-11-01T00:00:00.000Z',
          }),
        ),
      ),
      http.post(`${API}/executions/:id/resume`, () => {
        resumed += 1;
        return HttpResponse.json(execution());
      }),
    );
    const { user } = renderWithProviders(bar());
    expect(
      await screen.findByText('Paused: searchapi provider-month cap reached · resumes 1 Nov 2026 00:00 UTC'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await expect.poll(() => resumed).toBe(1);
  });

  it('shows "schedule blocked since <date>" from coverage.scheduleBlockedSince', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(coverageResponse({ scheduleBlockedSince: '2026-10-12T05:00:00.000Z' })),
      ),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('schedule blocked since 12 Oct 2026')).toBeInTheDocument();
  });

  it('no run yet: Run now names its worst case and posts the stored confirmation', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [], total: 0, executions: [], cheapest: null })),
      ),
      http.post(`${API}/definitions/:id/executions`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-0002' });
      }),
    );
    const { user } = renderWithProviders(bar({ confirmedCostPence: 0 }));
    expect(await screen.findByText('No run yet for this definition.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run now (about 154 calls (hard stop 2000), £0)' }));
    // why: decision 43: the stored confirmation covers a run only with both its pence and its calls.
    await expect.poll(() => bodies).toEqual([{ confirmCostPence: 0, confirmCalls: 154 }]);
  });

  it('Run now is disabled while the estimate is above the confirmation, and absent where the view does not offer it', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [], executions: [], cheapest: null })),
      ),
    );
    const { unmount } = renderWithProviders(
      bar({
        needsConfirmation: {
          estimateMicroGbp: 2_500_000,
          totalCalls: 300,
          confirmedCostPence: 100,
          confirmedCalls: 154,
        },
      }),
    );
    expect(await screen.findByRole('button', { name: /Run now/ })).toBeDisabled();
    expect(
      screen.getByText(
        'The estimate is above what you confirmed; confirm it under Definitions before running.',
      ),
    ).toBeInTheDocument();
    unmount();
    renderWithProviders(bar({}, false));
    await screen.findByText('No run yet for this definition.');
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
  });

  it.each<[number, number | null, boolean]>([
    [79, 100, false],
    [80, 100, true],
    [1, 0, true],
    [0, 0, false],
    [5, null, false],
  ])('near cap: %i used of %s is %s (review tsr2-013)', (used, cap, expected) => {
    expect(near(used, cap)).toBe(expected);
  });

  it('a null cap reads "no cap" and is never marked near', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(execution({ budget: [usage('execution-calls', 5, null)] })),
      ),
    );
    renderWithProviders(bar());
    const line = await screen.findByText('this run: 5 of no cap billed calls');
    expect(line).not.toHaveTextContent('near cap');
  });

  it('follows the newest parent run; an active one-cell child is its own line (review po-009)', async () => {
    const ids: string[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(
          resultsResponse({
            executions: [
              summary({ id: 'exec-child-1', isChild: true, status: 'running' }),
              summary({ id: 'exec-0001', status: 'paused_budget' }),
            ],
          }),
        ),
      ),
      http.get(`${API}/executions/:id`, ({ params }) => {
        ids.push(String(params.id));
        return HttpResponse.json(execution({ status: 'paused_budget', reason: 'cap' }));
      }),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('itinerary search for one cell: running')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(ids).toEqual(['exec-0001']);
  });

  it('polls a running run every POLL_MS, refetches results when it completes, then stops polling', async () => {
    // why: fake the clear functions too, or TanStack's cleared interval keeps firing on the real clock.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    let status: 'running' | 'completed' = 'running';
    const hits = { execution: 0, results: 0 };
    server.use(
      http.get(`${API}/executions/:id`, () => {
        hits.execution += 1;
        return HttpResponse.json(execution({ status }));
      }),
      http.get(`${API}/definitions/:id/results`, () => {
        hits.results += 1;
        return HttpResponse.json(resultsResponse());
      }),
    );
    renderWithProviders(bar());
    await screen.findByText('running');
    expect([hits.execution, hits.results]).toEqual([1, 1]);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await expect.poll(() => hits.execution).toBe(2);
    status = 'completed';
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await screen.findByText('completed');
    await expect.poll(() => hits.results).toBe(2);
    const settled = hits.execution;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(hits.execution).toBe(settled);
  });
});

describe('view header (spec §11)', () => {
  it('names the runs by start time with status and age, unknown ages included, and banners a parent run not completed', () => {
    renderWithProviders(
      <ViewHeader
        title="Results"
        stale
        executions={[
          summary({ status: 'running', ageHours: 0, finishedAt: null }),
          summary({ id: 'exec-0000', startedAt: '2026-10-07T12:00:00.000Z', ageHours: 'unknown' }),
        ]}
      />,
    );
    expect(
      screen.getByText(
        'showing run started 14 Oct 2026 12:00 UTC (running, just now), run started 7 Oct 2026 12:00 UTC (completed, age unknown)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The latest run is running; these results may be partial.',
    );
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('no banner when the latest parent run completed, whatever a child run is doing', () => {
    renderWithProviders(
      <ViewHeader
        title="Results"
        stale={false}
        executions={[summary({ id: 'c1', isChild: true, status: 'pending', startedAt: null }), summary()]}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    // why: a run with no start has no age to give (review prov-r2-011).
    expect(
      screen.getByText(/itinerary search for one cell, not started yet \(pending\), run started/),
    ).toBeInTheDocument();
  });

  it('the cross-execution variant states that no single run status applies, with no banner (decision 38)', () => {
    renderWithProviders(
      <ViewHeader
        title="History"
        stale={false}
        variant="span"
        executions={[summary({ status: 'running' }), summary({ id: 'e0' })]}
      />,
    );
    expect(screen.getByText('across 2 runs; no single run status applies')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('no run yet', () => {
    renderWithProviders(<ViewHeader title="Results" stale={false} executions={[]} />);
    expect(screen.getByText('No run yet for this definition.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/components/statusBar.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/components/StatusBar.js"`.

- [ ] **Step 3: Implement**

`src/components/StatusBar.tsx` (new file):

```tsx
import { ACTIVE_STATUSES, apiContract } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCoverage, useExecution, useExecutionActions, useResults } from '../api/queries.js';
import type { DefinitionResponse, ExecutionResponse, UsageRow } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatInstantUtc, formatIsoDate, formatMicroGbp } from '../format.js';
import { parseBasis } from '../state/resultsState.js';
import { useSearchParams } from '../state/urlState.js';

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_STATUSES);
/** Spend at or above this share of a cap is marked "near cap" (review UI-10). */
const NEAR_CAP = 0.8;

/**
 * Spec §11 progress, one line per stage × provider (never summed across providers). "Done" counts
 * only outcomes a provider answered or failed on: priced, no fares, no cached data, error (decision 36);
 * skipped and not-searched cells are stated beside it, so the three always add up to the cell count.
 * The itinerary-search line counts against the selected cells, "itinerary-searched K of N selected"
 * (spec §3, §11), when the results response gives N.
 */
function progressLines(e: ExecutionResponse, selected: number | null) {
  return e.progress.map((p) => {
    const l = {
      stage: COPY.stageName[p.stage],
      provider: COPY.provider[p.providerId],
      verb: COPY.progressVerb[p.stage],
      done: p.buckets.priced + p.buckets.empty + p.buckets.no_data + p.buckets.error,
      total: p.total,
      error: p.buckets.error,
      skipped: p.buckets.skipped,
      notRun: p.buckets.not_run,
    };
    const bySelection = p.stage === 'verification' && selected !== null;
    return {
      ...l,
      key: `${p.stage}-${p.providerId}`,
      max: bySelection ? selected : p.total,
      text: bySelection ? COPY.progressSelected({ ...l, selected }) : COPY.progress(l),
    };
  });
}

/** Usage rows carry WP8's scope label (`execution-calls`, `global-month`, `provider-month:searchapi`). */
function usageOf(e: ExecutionResponse, label: string): UsageRow | null {
  return e.budget.find((u) => u.scope === label) ?? null;
}

const capText = (cap: number | null, fmt: (n: number) => string): string =>
  cap === null ? COPY.noCap : fmt(cap);
/** At or above 80% of the cap; any use of a zero cap counts (it is already over); no cap is never near. */
export const near = (used: number, cap: number | null): boolean =>
  cap !== null && used > 0 && used >= cap * NEAR_CAP;

function Spend({ text, used, cap }: { text: string; used: number; cap: number | null }) {
  // why: data-cost marks a cost or cap figure, never a fare; the rendered sweep allows "£" only in a PriceCell or here.
  return (
    <span data-cost="">
      {text}
      {near(used, cap) ? (
        <span className="ml-1 rounded bg-amber-200 px-1 font-medium">{COPY.nearCap}</span>
      ) : null}
    </span>
  );
}

/** `provider-month:<id>` rows: the call cap is the hard stop on a subscription plan (spec §1, §5.3). */
function ProviderMonths({ e }: { e: ExecutionResponse }) {
  return e.budget
    .filter((u) => u.scope.startsWith('provider-month:'))
    .map((u) => {
      const id = apiContract.providerIdSchema.safeParse(u.scope.slice('provider-month:'.length));
      const name = id.success ? COPY.provider[id.data] : u.scope;
      return (
        <Spend
          key={u.scope}
          text={COPY.spendProviderMonth(name, u.calls, capText(u.cap, String))}
          used={u.calls}
          cap={u.cap}
        />
      );
    });
}

export interface StatusBarProps {
  definition: DefinitionResponse | null;
  /** "Run now" appears only on Results and Definitions (review UI-10). */
  showRunNow: boolean;
}

/** Spec §11 status bar, on every view: stage, progress, spend, paused reason + Resume, blocked schedule, Cancel. */
export function StatusBar({ definition, showRunNow }: StatusBarProps) {
  const params = useSearchParams();
  const results = useResults(definition?.id ?? null, parseBasis(params.get('basis')));
  const executions = results.data?.executions ?? [];
  // why: lists are newest first; the bar follows the newest parent run, and a one-cell child is a separate line.
  const latestId = executions.find((x) => !x.isChild)?.id ?? null;
  const child = executions.find((x) => x.isChild && ACTIVE.has(x.status)) ?? null;
  const execution = useExecution(latestId);
  const coverage = useCoverage(definition?.id ?? null);
  const actions = useExecutionActions();
  const qc = useQueryClient();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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
  const active = e !== undefined && ACTIVE.has(e.status);
  const est = definition.estimate;

  return (
    <section
      aria-label={COPY.statusBarLabel}
      className="flex flex-wrap items-center gap-3 border-b border-slate-300 bg-slate-50 px-4 py-2 text-sm"
    >
      <span aria-live="polite" className="flex flex-wrap items-center gap-3">
        {e === undefined ? (
          <span>{results.data !== undefined && latestId === null ? COPY.noExecution : COPY.loading}</span>
        ) : (
          <>
            <span className="font-semibold">{COPY.statusName[e.status]}</span>
            {e.stage !== null ? <span>{COPY.stageName[e.stage]}</span> : null}
            {e.status === 'paused_budget' || e.status === 'paused_error' ? (
              <span className="font-medium">
                {COPY.paused(e.reason ?? COPY.statusName[e.status])}
                {e.resumeAfter !== null ? ` · ${COPY.resumesAt(formatInstantUtc(e.resumeAfter))}` : null}
              </span>
            ) : null}
          </>
        )}
        {child !== null ? <span>{COPY.childRun(COPY.statusName[child.status])}</span> : null}
      </span>
      {e !== undefined
        ? progressLines(e, results.data?.coverage.selected ?? null).map((l) => (
            <span
              key={l.key}
              role="progressbar"
              aria-label={COPY.progressLabel(l.stage, l.provider)}
              aria-valuemin={0}
              aria-valuemax={l.max}
              aria-valuenow={l.done}
            >
              {l.text}
            </span>
          ))
        : null}
      {runCalls ? (
        <Spend
          text={COPY.spendRunCalls(runCalls.calls, capText(runCalls.cap, String))}
          used={runCalls.calls}
          cap={runCalls.cap}
        />
      ) : null}
      {freeCalls ? (
        <Spend
          text={COPY.spendRunFreeCalls(freeCalls.calls, capText(freeCalls.cap, String))}
          used={freeCalls.calls}
          cap={freeCalls.cap}
        />
      ) : null}
      {runCost ? (
        <Spend
          text={COPY.spendRunCost(formatMicroGbp(runCost.costMicroGbp), capText(runCost.cap, formatMicroGbp))}
          used={runCost.costMicroGbp}
          cap={runCost.cap}
        />
      ) : null}
      {month ? (
        <Spend
          text={COPY.spendMonth(formatMicroGbp(month.costMicroGbp), capText(month.cap, formatMicroGbp))}
          used={month.costMicroGbp}
          cap={month.cap}
        />
      ) : null}
      {e ? <ProviderMonths e={e} /> : null}
      {blockedSince !== null ? (
        <span className="font-medium">{COPY.scheduleBlocked(formatIsoDate(blockedSince.slice(0, 10)))}</span>
      ) : null}
      {e && (e.status === 'paused_budget' || e.status === 'paused_error') ? (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={() => actions.resume.mutate(e.id)}
        >
          {COPY.resume}
        </button>
      ) : null}
      {e && active && !confirmingCancel ? (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={() => setConfirmingCancel(true)}
        >
          {COPY.cancel}
        </button>
      ) : null}
      {e && active && confirmingCancel ? (
        <>
          <button
            type="button"
            className="min-h-11 rounded border border-red-800 px-3 font-medium text-red-900"
            onClick={() => {
              setConfirmingCancel(false);
              actions.cancel.mutate(e.id);
            }}
          >
            {COPY.confirmCancel}
          </button>
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => setConfirmingCancel(false)}
          >
            {COPY.keepRunning}
          </button>
        </>
      ) : null}
      {showRunNow && !active && results.data !== undefined ? (
        <>
          <button
            type="button"
            data-cost=""
            className="min-h-11 rounded border border-slate-500 px-3 disabled:opacity-60"
            disabled={definition.needsConfirmation !== null}
            onClick={() =>
              actions.start.mutate({
                id: definition.id,
                confirmCostPence: definition.confirmedCostPence,
                confirmCalls: definition.confirmedCalls,
              })
            }
          >
            {est === null
              ? COPY.runNowUnestimated
              : COPY.runNow(
                  est.totalCalls,
                  definition.budget.maxCalls,
                  formatMicroGbp(est.totalCostMicroGbp),
                )}
          </button>
          {definition.needsConfirmation !== null ? <span>{COPY.runNowBlocked}</span> : null}
        </>
      ) : null}
      {failure ? (
        <span role="alert" className="text-red-800">
          {COPY.actionFailed(failure.message)}
        </span>
      ) : null}
    </section>
  );
}
```

`src/components/ViewHeader.tsx` (new file):

```tsx
import type { ExecutionSummary } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatInstantUtc } from '../format.js';

export interface ViewHeaderProps {
  title: string;
  /** ExecutionSummary rows, newest first (plan "API contract"); `ageHours` may be 'unknown'. Only these fields are read. */
  executions: readonly HeaderRun[];
  stale: boolean;
  /**
   * 'span': a cross-execution view (decision 38; WP10's Calendar, Duration and History): the runs are
   * named and no single run status or not-completed banner applies. Default 'single'.
   */
  variant?: 'single' | 'span';
}

/** The fields of an ExecutionSummary the header names. */
export type HeaderRun = Pick<ExecutionSummary, 'id' | 'status' | 'isChild' | 'startedAt' | 'ageHours'>;

/** A run with no start has no age to give: it says "not started yet" (review prov-r2-011). */
function itemText(e: HeaderRun): string {
  const status = COPY.statusName[e.status];
  if (e.startedAt === null)
    return e.isChild ? COPY.childExecutionNotStarted(status) : COPY.executionNotStarted(status);
  const make = e.isChild ? COPY.childExecutionItem : COPY.executionItem;
  return make(formatInstantUtc(e.startedAt), status, COPY.agoOf(e.ageHours));
}

/**
 * Spec §11: every view header names the executions shown (by start time, never an id), their status
 * and age, a stale label, and a banner when the latest run that produced the view is not completed.
 */
export function ViewHeader({ title, executions, stale, variant = 'single' }: ViewHeaderProps) {
  const span = variant === 'span';
  // why: a one-cell child run never stands for the view; the banner follows the newest parent run.
  const latest = executions.find((e) => !e.isChild);
  const list = executions.map(itemText).join(', ');
  return (
    <div className="mb-2 space-y-1">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-slate-700">
        {executions.length === 0 ? COPY.noExecution : COPY.executionsShown(list)}
      </p>
      {span && executions.length > 0 ? (
        <p className="text-sm text-slate-700">{COPY.spanExecutions(executions.length)}</p>
      ) : null}
      {stale ? (
        <p className="text-sm">
          <span className="mr-1 rounded bg-amber-200 px-1">{COPY.stale}</span>
          {COPY.staleView}
        </p>
      ) : null}
      {!span && latest !== undefined && latest.status !== 'completed' ? (
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
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: status bar per stage and provider, provider-month caps, run header by start time"
```

### Task 9.7: Expanded row: segments, layovers, baggage, conditions, verdicts, booking and search links

**Files:**
- Create: `src/components/ClassBadge.tsx`, `src/components/VerdictList.tsx`, `src/components/BookingAction.tsx`, `src/views/Results/ExpandedRow.tsx`
- Test: `test/views/results/expanded.test.tsx`

**Interfaces:**
- Consumes: `ResultRow` (with `layovers`, `seller`, `baggage`, `fareConditions`, `selfTransfer`, `otherOffers[].notSeenInLatest`), `Booking`, `Verdicts`, `apiContract.constraintNameSchema`, `validateVendorUrl`, `LINK_ALLOWLIST`, `effectiveAge`, `formatFetchedAgo`; `PriceCell`, `PriceBoundary` (Task 9.1); `useExecutionActions` (Task 9.3).
- Produces: `ClassBadge({ cls })`, `VerdictList({ verdicts, unverified })`, `BookingAction({ booking, providerId })`, `SearchLink({ link, providerId })`, `safeVendorUrl(url, statedHost, providerId)`, `rowName(row)`, `ExpandedRow({ row, extras, verificationConfigured, definitionId })`.

Decisions. **Verdicts** list every constraint in core's order with a distinct glyph, word and style; a constraint the row lists as `unverified` but whose verdict is missing is shown unverified, never dropped (review tsr-014); `priceConfirmed` shows its label alone, "? price not confirmed by the final step", never "…: unverified" (decision 44). The visible "glyph label: word" text is the accessible text: no `aria-label` on list items or badges (review UI-9); the badge carries a spoken-only "verdict class:" prefix. **Links**: core's spec §5.2 validator with the provider's allowlist (`https:`, no userinfo, no port, length cap, allowlisted host), then the URL's host must equal the stated host the operator sees (review arch-009). **The search link shows core's label as the API sent it**, so "cabin not prefilled" reaches the operator (review arch-008); a prefilled Google Flights link for calendar rows is Phase 4 (decision 36). **One labelled region per row** with plain blocks and `h3` headings inside. **Other sellers** render through `PriceCell` with their own not-seen-in-latest note (review prov-008) and the unconfirmed-price badge when the final step did not confirm their price; `priceConfirmed` is kept out of their "unverified: …" list, which would repeat it as a double negative (decision 44). **The 375px summary** repeats the moved columns, the adjusted price through `PriceCell` with the "incl. operator-entered onward cost" qualifier, so it carries "≈" and "stale" (review prov-009). **Per-cell verify** says it uses billed calls; its call cap and headroom (decision 42's cell-detail `verify`) are WP10's side panel.

- [ ] **Step 1: Write the failing test**

`test/views/results/expanded.test.tsx`:

```tsx
import { CONSTRAINT_LABELS, effectiveAge, formatAgo, formatFetchedAgo, searchLinkFor } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { BookingAction, SearchLink, safeVendorUrl } from '../../../src/components/BookingAction.js';
import { ExpandedRow } from '../../../src/views/Results/ExpandedRow.js';
import { API, calendarRow, failedRow, fxConverted, provSearch, verifiedRow } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { NOW, renderWithProviders } from '../../render.js';

const render = (
  row: Parameters<typeof ExpandedRow>[0]['row'],
  verificationConfigured = true,
  extras = false,
) =>
  renderWithProviders(
    <ExpandedRow
      row={row}
      extras={extras}
      verificationConfigured={verificationConfigured}
      definitionId="def-0001"
    />,
  );
const L = CONSTRAINT_LABELS;
const provenanceOf = () => verifiedRow().provenance;

describe('verdicts: distinct text for pass / fail / unverified (spec §9 item 6)', () => {
  it('each verdict has its own glyph and word, in core constraint order, and its own style', () => {
    render(failedRow());
    const items = within(screen.getByRole('list', { name: 'Constraint verdicts' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      `✓ ${L.cabin}: pass`,
      `✗ ${L.arrivalWindowLocal}: fail`,
      `? ${L.checkedBagRequired}: unverified`,
    ]);
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([null, null, null]);
    expect(new Set(items.map((i) => i.className)).size).toBe(3);
  });

  it('an unconfirmed price reads as its label alone, never "…: unverified" (decision 44)', () => {
    render(
      verifiedRow({
        verdictClass: 'partially-verified',
        verdicts: { cabin: 'pass', priceConfirmed: 'unverified' },
        unverified: ['priceConfirmed'],
      }),
    );
    const items = within(screen.getByRole('list', { name: 'Constraint verdicts' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      `✓ ${L.cabin}: pass`,
      '? price not confirmed by the final step',
    ]);
  });

  it('a constraint listed as unverified but missing from verdicts is shown unverified, never dropped (review tsr-014)', () => {
    render(verifiedRow({ verdicts: {}, unverified: ['checkedBagRequired'] }));
    const items = within(screen.getByRole('list', { name: 'Constraint verdicts' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([`? ${L.checkedBagRequired}: unverified`]);
    expect(screen.queryByText('No constraints evaluated for this row.')).toBeNull();
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
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(failedRow());
    const form = screen
      .getByRole('button', { name: 'continue on www.google.com (sends a form)' })
      .closest('form');
    if (form === null) throw new Error('no form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', 'https://www.google.com/travel/clk/f');
    expect(form).toHaveAttribute('rel', 'noopener noreferrer');
    expect(form).toHaveAttribute('target', '_blank');
    const hidden = [...form.querySelectorAll('input[type="hidden"]')].map(
      (i) => `${i.getAttribute('name')}=${i.getAttribute('value')}`,
    );
    expect(hidden).toEqual(['u=abc', 'tfu=xyz']);
    expect([submit, requestSubmit, open].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('none: "no link", plus the provider search link with the API label and its host', () => {
    render(calendarRow());
    expect(screen.getByText('no link')).toBeInTheDocument();
    const search = screen.getByRole('link', { name: 'search link, not a fare link' });
    expect(search).toHaveAttribute('rel', 'noopener noreferrer');
    expect(search.getAttribute('href')).toMatch(/^https:\/\/search\.aviasales\.com\/flights\//);
    expect(screen.getByText('(search.aviasales.com)')).toBeInTheDocument();
  });

  it("the search link shows core's label as sent, so a premium-economy caveat reaches the operator (review arch-008)", () => {
    const link = searchLinkFor('travelpayouts', calendarRow().cell, 'premium_economy');
    render(calendarRow({ searchLink: link }));
    expect(
      screen.getByRole('link', { name: 'search link, not a fare link; cabin not prefilled' }),
    ).toBeInTheDocument();
  });

  it('a synthetic row has no search link and says so', () => {
    render(calendarRow({ searchLink: null }));
    expect(screen.getByText('no search link')).toBeInTheDocument();
  });

  it("core's vendor validator plus the stated host: anything else is no link", () => {
    expect(safeVendorUrl('https://www.google.com/x', 'www.google.com', 'searchapi')).toBe(
      'https://www.google.com/x',
    );
    for (const [url, host] of [
      ['http://www.google.com/x', 'www.google.com'],
      ['https://u:p@www.google.com/x', 'www.google.com'],
      ['https://www.google.com:8443/x', 'www.google.com'],
      ['https://evil.example/x', 'evil.example'],
      ['https://www.google.com/x', 'maps.google.com'],
      ['javascript:alert(1)', 'www.google.com'],
    ]) {
      expect(safeVendorUrl(url ?? '', host ?? '', 'searchapi')).toBeNull();
    }
    expect(safeVendorUrl('https://www.aviasales.com/x', 'www.aviasales.com', 'searchapi')).toBeNull();
    renderWithProviders(
      <BookingAction
        booking={{ kind: 'get', url: 'https://evil.example/x', host: 'www.google.com' }}
        providerId="searchapi"
      />,
    );
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a POST booking or search link that fails validation is no link too', () => {
    renderWithProviders(
      <>
        <BookingAction
          booking={{ kind: 'post', url: 'https://evil.example/f', postData: 'a=1', host: 'evil.example' }}
          providerId="searchapi"
        />
        <SearchLink
          link={{
            url: 'https://evil.example/s',
            host: 'evil.example',
            label: 'search link, not a fare link',
          }}
          providerId="searchapi"
        />
      </>,
    );
    expect(screen.getByText('no link')).toBeInTheDocument();
    expect(screen.getByText('no search link')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('itinerary detail (spec §11 expanded row)', () => {
  it('one labelled region per row, segments, layovers, baggage and conditions', () => {
    render(verifiedRow());
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(
      screen.getByRole('region', { name: 'Details for JFK 14 Mar 2027 to 28 Mar 2027' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ZZ 117 LHR 14 Mar 10:25 → BBB 14 Mar 12:00')).toBeInTheDocument();
    expect(screen.getByText('ZZ 178 JFK 28 Mar 19:00 → LHR 29 Mar 07:00')).toBeInTheDocument();
    expect(screen.getByText('BBB: 1h 30m')).toBeInTheDocument();
    expect(screen.getByText('cabin bag included')).toBeInTheDocument();
    expect(screen.getByText('1 checked bag')).toBeInTheDocument();
    expect(screen.getByText('not refundable')).toBeInTheDocument();
    expect(screen.getByText('changeable')).toBeInTheDocument();
    expect(screen.getByText('sold by Example Travel')).toBeInTheDocument();
  });

  it('an overnight layover, an airport change and a self-transfer are named', () => {
    render(
      verifiedRow({
        layovers: [{ at: 'BBB', minutes: 540, overnight: true, airportChange: true }],
        selfTransfer: true,
      }),
    );
    expect(screen.getByText('BBB: 9h 00m')).toBeInTheDocument();
    expect(screen.getByText('overnight')).toBeInTheDocument();
    expect(screen.getByText('airport change')).toBeInTheDocument();
    expect(
      screen.getByText('self-transfer: you re-check bags and the airlines do not protect the connection'),
    ).toBeInTheDocument();
  });

  it('missing baggage and conditions say "not stated", never a default', () => {
    render(failedRow());
    expect(screen.getByText('cabin bag not stated')).toBeInTheDocument();
    expect(screen.getByText('checked bags not stated')).toBeInTheDocument();
    expect(screen.getByText('refunds not stated')).toBeInTheDocument();
  });

  it('other sellers render through PriceCell with their class, unverified names and not-seen-in-latest (review prov-008)', () => {
    render(
      verifiedRow({
        otherOffers: [
          {
            seller: 'Second Seller',
            pricePence: 42000,
            provenance: provSearch,
            booking: { kind: 'none' },
            stale: false,
            ageHours: 'unknown',
            verdictClass: 'partially-verified',
            unverified: ['checkedBagRequired', 'priceConfirmed'],
            notSeenInLatest: { ageHours: 72 },
          },
        ],
      }),
    );
    const others = screen.getByRole('list', { name: 'Other sellers for this itinerary' });
    expect(within(others).getByText('£420')).toBeInTheDocument();
    expect(within(others).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(others).getByTestId('class-badge')).toHaveTextContent('partially verified');
    expect(within(others).getByText(`unverified: ${L.checkedBagRequired}`)).toBeInTheDocument();
    expect(within(others).getByText(`not seen in latest search (${formatAgo(72)})`)).toBeInTheDocument();
    expect(formatAgo(72)).toBe('3d ago');
    // why: an other seller whose price the final step did not confirm says so beside its price (decision 44).
    expect(
      within(within(others).getByTestId('price-cell')).getByText('price not confirmed by the final step'),
    ).toBeInTheDocument();
  });

  it('at 375px the summary repeats the moved columns, the adjusted price through PriceCell with "≈" and "stale" (review prov-009)', () => {
    render(
      verifiedRow({ adjustedPence: 45000, stale: true, provenance: { ...provSearch, fx: fxConverted } }),
      true,
      true,
    );
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    const adjusted = screen
      .getByText('incl. operator-entered onward cost')
      .closest('[data-testid="price-cell"]');
    if (adjusted === null) throw new Error('adjusted price not in a PriceCell');
    expect(adjusted).toHaveTextContent('≈');
    expect(adjusted).toHaveTextContent('£450');
    expect(adjusted).toHaveTextContent('stale');
    expect(screen.getByText(formatFetchedAgo(effectiveAge(provenanceOf(), NOW)))).toBeInTheDocument();
  });
});

describe('calendar rows (spec §6.9)', () => {
  it('say there is no itinerary and name the constraints not applied', () => {
    render(calendarRow());
    expect(screen.getAllByText('calendar price, no itinerary')).toHaveLength(2);
    expect(
      screen.getByText(`not applied: ${L.arrivalWindowLocal}, ${L.maxJourneyMinutes}, ${L.maxStops}`),
    ).toBeInTheDocument();
  });

  it('per-cell verify is offered only with a verification provider, names its cost, and posts the cell', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/cells/verify`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user, unmount } = render(calendarRow());
    await user.click(
      screen.getByRole('button', { name: 'Search this cell for itineraries (uses billed calls)' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Itinerary search started for this cell; the status bar follows it.',
    );
    expect(bodies).toEqual([
      {
        definitionId: 'def-0001',
        cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-04-02', returnDate: '2027-04-16' },
      },
    ]);
    unmount();
    render(calendarRow(), false);
    expect(screen.queryByRole('button', { name: /Search this cell/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/expanded.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/components/BookingAction.js"`.

- [ ] **Step 2b: Prove the POST form is never submitted on its own**

After Step 3, temporarily add `ref={(f) => f?.requestSubmit()}` to the `<form>` in `BookingAction`. Run the expanded test: "POST: a form button carrying postData, never submitted on render" fails with `expected [ 0, 1, 0 ] to deeply equal [ 0, 0, 0 ]`. Remove the ref.

- [ ] **Step 3: Implement**

`src/components/ClassBadge.tsx` (new file):

```tsx
import type { VerdictClass } from '@gmt/core';
import { COPY } from '../copy.js';

const STYLE: Record<VerdictClass | 'unchecked', string> = {
  verified: 'border-green-800 bg-green-100 text-green-900',
  'partially-verified': 'border-amber-800 bg-amber-100 text-amber-900',
  failed: 'border-red-800 bg-red-100 text-red-900 line-through decoration-1',
  unchecked: 'border-dashed border-slate-600 bg-white text-slate-800',
};

/**
 * Verdict class in words, never colour alone (spec §11); stays in the 375px primary row. The visible
 * word is the accessible text, with a spoken-only prefix naming what it is.
 */
export function ClassBadge({ cls }: { cls: VerdictClass | 'unchecked' }) {
  return (
    <span data-testid="class-badge" className={`inline-block rounded border px-1 text-xs ${STYLE[cls]}`}>
      <span className="sr-only">{COPY.classSpoken} </span>
      {COPY.classLabel[cls]}
    </span>
  );
}
```

`src/components/VerdictList.tsx` (new file):

```tsx
import { apiContract, type ConstraintName, type Verdict, type Verdicts } from '@gmt/core';
import { COPY } from '../copy.js';

const STYLE: Record<Verdict, string> = {
  pass: 'text-green-900',
  fail: 'font-semibold text-red-900',
  unverified: 'italic text-slate-700',
};

/**
 * Every verdict with a distinct glyph and word (spec §9 item 6), in core's constraint order. A
 * constraint the row lists as unverified but whose verdict is absent is shown as unverified, never
 * dropped, so a missing verdict can never read as satisfied (review tsr-014). `priceConfirmed` shows its
 * label alone ("price not confirmed by the final step"), never "…: unverified".
 */
export function VerdictList({
  verdicts,
  unverified,
}: {
  verdicts: Verdicts;
  unverified: readonly ConstraintName[];
}) {
  const entries = apiContract.constraintNameSchema.options.flatMap(
    (name): Array<[ConstraintName, Verdict]> => {
      const v = verdicts[name] ?? (unverified.includes(name) ? 'unverified' : undefined);
      return v === undefined ? [] : [[name, v]];
    },
  );
  if (entries.length === 0) return <p>{COPY.noVerdicts}</p>;
  return (
    <ul aria-label={COPY.verdictsHeading} className="space-y-0.5">
      {entries.map(([name, v]) => (
        <li key={name} data-verdict={v} className={STYLE[v]}>
          <span aria-hidden="true">{COPY.verdictGlyph[v]}</span>{' '}
          {/* why: this label already says the price was not confirmed; ": unverified" after it would be a double negative (decision 44). */}
          {name === 'priceConfirmed'
            ? COPY.constraint[name]
            : COPY.verdictLine(COPY.constraint[name], COPY.verdictWord[v])}
        </li>
      ))}
    </ul>
  );
}
```

`src/components/BookingAction.tsx` (new file):

```tsx
import { type Booking, LINK_ALLOWLIST, type ProviderId, validateVendorUrl } from '@gmt/core';
import { COPY } from '../copy.js';

/**
 * Defence in depth over the API's validation: core's spec §5.2 validator (`https:` only, no userinfo,
 * no port, length cap, host inside the provider's allowlist) and, on top, the URL's host must equal
 * the host the API states, which is what the operator is shown. Anything else is no link.
 */
export function safeVendorUrl(url: string, statedHost: string, providerId: ProviderId): string | null {
  const v = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return v.kind === 'get' && v.host === statedHost ? v.url : null;
}

/** GET link with host, POST as a form button (never auto-submitted), or "no link" (spec §11). */
export function BookingAction({ booking, providerId }: { booking: Booking; providerId: ProviderId }) {
  if (booking.kind === 'none') return <span>{COPY.noLink}</span>;
  const href = safeVendorUrl(booking.url, booking.host, providerId);
  if (href === null) return <span>{COPY.noLink}</span>;
  if (booking.kind === 'get') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline"
      >
        {COPY.openOn(booking.host)}
      </a>
    );
  }
  const fields = [...new URLSearchParams(booking.postData).entries()];
  return (
    <form method="post" action={href} target="_blank" rel="noopener noreferrer">
      {fields.map(([name, value], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className="min-h-11 rounded border border-slate-500 px-3 underline">
        {COPY.continueOnForm(booking.host)}
      </button>
    </form>
  );
}

/**
 * Spec §6.9: the provider's own search link, with core's label as the API sent it (it carries
 * caveats such as "cabin not prefilled"), the host shown; null for synthetic rows.
 */
export function SearchLink({
  link,
  providerId,
}: {
  link: { url: string; host: string; label: string } | null;
  providerId: ProviderId;
}) {
  const href = link === null ? null : safeVendorUrl(link.url, link.host, providerId);
  if (link === null || href === null) return <span>{COPY.noSearchLink}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline"
      >
        {link.label}
      </a>
      <span>{COPY.hostShown(link.host)}</span>
    </span>
  );
}
```

`src/views/Results/ExpandedRow.tsx` (new file):

```tsx
import { effectiveAge, formatFetchedAgo } from '@gmt/core';
import { useExecutionActions } from '../../api/queries.js';
import type { ResultRow } from '../../api/types.js';
import { BookingAction, SearchLink } from '../../components/BookingAction.js';
import { ClassBadge } from '../../components/ClassBadge.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell, priceUnconfirmed } from '../../components/PriceCell.js';
import { VerdictList } from '../../components/VerdictList.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatLocalDateTime, formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';

type Segment = NonNullable<ResultRow['outbound']>[number];

function Segments({ segments }: { segments: readonly Segment[] | null }) {
  if (segments === null) return <p>{COPY.noSegments}</p>;
  return (
    <ul>
      {segments.map((s) => (
        <li key={`${s.marketingCarrier}${s.flightNumber}${s.departLocal}`}>
          {COPY.segment(
            s.marketingCarrier,
            s.flightNumber,
            s.from,
            formatLocalDateTime(s.departLocal),
            s.to,
            formatLocalDateTime(s.arriveLocal),
          )}
        </li>
      ))}
    </ul>
  );
}

/** The accessible name of a row: destination and dates. */
export function rowName(row: ResultRow): string {
  return COPY.rowName(
    row.cell.destination,
    formatIsoDate(row.cell.departureDate),
    formatIsoDate(row.cell.returnDate),
  );
}

export interface ExpandedRowProps {
  row: ResultRow;
  /** At 375px the columns that left the primary row are shown here (spec §11). */
  extras: boolean;
  verificationConfigured: boolean;
  definitionId: string;
}

/**
 * Spec §11 expanded row: segments, layovers, baggage, conditions, every verdict, booking, search
 * link, other sellers. One labelled region per row; plain blocks with headings inside (review UI-9).
 */
export function ExpandedRow({ row, extras, verificationConfigured, definitionId }: ExpandedRowProps) {
  const now = useNow();
  const actions = useExecutionActions();
  const { nights: _nights, ...cellKey } = row.cell;
  const providerId = row.provenance.providerId;
  return (
    <section aria-label={COPY.detailsFor(rowName(row))} className="grid gap-3 p-2 text-sm md:grid-cols-2">
      {extras ? (
        <div>
          <h3 className="font-semibold">{COPY.summary}</h3>
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
            <dd>{formatFetchedAgo(effectiveAge(row.provenance, now))}</dd>
            <dt>{COPY.columns.provider}</dt>
            <dd>{COPY.provider[providerId]}</dd>
            {row.adjustedPence !== null ? (
              <>
                <dt>{COPY.columns.adjusted}</dt>
                <dd>
                  <PriceBoundary>
                    <PriceCell
                      pricePence={row.adjustedPence}
                      provenance={row.provenance}
                      calendar={row.basis === 'calendar'}
                      stale={row.stale}
                      truncated={row.truncated}
                      unconfirmed={priceUnconfirmed(row)}
                      qualifier={COPY.adjustedQualifier}
                    />
                  </PriceBoundary>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
      <div>
        <h3 className="font-semibold">{COPY.outbound}</h3>
        <Segments segments={row.outbound} />
      </div>
      <div>
        <h3 className="font-semibold">{COPY.inbound}</h3>
        <Segments segments={row.inbound} />
      </div>
      <div>
        <h3 className="font-semibold">{COPY.layovers}</h3>
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
      </div>
      <div>
        <h3 className="font-semibold">{COPY.baggage}</h3>
        <p>
          {row.baggage?.cabinBag !== undefined ? COPY.cabinBag[row.baggage.cabinBag] : COPY.cabinBagUnknown}
        </p>
        <p>
          {row.baggage?.checkedBags !== undefined
            ? COPY.checkedBags(row.baggage.checkedBags)
            : COPY.checkedBagsUnknown}
        </p>
      </div>
      <div>
        <h3 className="font-semibold">{COPY.conditions}</h3>
        <p>{COPY.refundable(row.fareConditions?.refundable)}</p>
        <p>{COPY.changeable(row.fareConditions?.changeable)}</p>
      </div>
      <div>
        <h3 className="font-semibold">{COPY.verdictsHeading}</h3>
        <VerdictList verdicts={row.verdicts} unverified={row.unverified} />
        {row.notApplied.length > 0 ? (
          <p>{COPY.notApplied(row.notApplied.map((n) => COPY.constraint[n]).join(', '))}</p>
        ) : null}
      </div>
      <div>
        <h3 className="font-semibold">{COPY.booking}</h3>
        {row.seller !== null ? <p>{COPY.seller(row.seller)}</p> : null}
        <BookingAction booking={row.booking} providerId={providerId} />
        <SearchLink link={row.searchLink} providerId={providerId} />
      </div>
      {row.otherOffers.length > 0 ? (
        <div>
          <h3 className="font-semibold">{COPY.otherOffers}</h3>
          <ul aria-label={COPY.otherOffers}>
            {row.otherOffers.map((o, i) => (
              <li key={`${o.seller}-${i}`} className="flex flex-wrap items-center gap-2">
                <span>{COPY.seller(o.seller)}</span>
                <PriceBoundary>
                  <PriceCell
                    pricePence={o.pricePence}
                    provenance={o.provenance}
                    calendar={false}
                    stale={o.stale}
                    notSeenInLatestHours={o.notSeenInLatest?.ageHours ?? null}
                    unconfirmed={priceUnconfirmed(o)}
                  />
                </PriceBoundary>
                <ClassBadge cls={o.verdictClass} />
                {/* why: priceConfirmed is the badge on the price; listing it as "unverified: price not confirmed…" would be a double negative. */}
                {o.unverified.some((n) => n !== 'priceConfirmed') ? (
                  <span>
                    {COPY.unverifiedList(
                      o.unverified
                        .filter((n) => n !== 'priceConfirmed')
                        .map((n) => COPY.constraint[n])
                        .join(', '),
                    )}
                  </span>
                ) : null}
                <BookingAction booking={o.booking} providerId={o.provenance.providerId} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.basis === 'calendar' && verificationConfigured ? (
        <div>
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => actions.verify.mutate({ definitionId, cell: cellKey })}
          >
            {COPY.verifyCell}
          </button>
          {actions.verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
          {actions.verify.error ? (
            <p role="alert">{COPY.actionFailed(actions.verify.error.message)}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/expanded.test.tsx test/copy`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: expanded row with verdicts, validated booking forms and the API's search-link label"
```

### Task 9.8: View A table, two-line header, client-side sort and filter

**Files:**
- Create: `src/views/Results/ResultsTable.tsx`, `src/views/Results/ResultsHeader.tsx`, `src/views/Results/Filters.tsx`, `src/views/Results/ResultsView.tsx`
- Test: `test/views/results/table.test.tsx`

**Interfaces:**
- Consumes: `sortRows`, `filterRows` (with `departure`), `bandCheapest`, `resultRowKey`, `SortKey`, `effectiveAge`, `formatFetchedAgo`, `apiContract.constraintNameSchema`, `cellKeySchema`, `ExecutionSummary.expandTop` (Task 9.0); `parseCarriers`, `carriersText`, `useSynced` (Task 9.4); `priceUnconfirmed` (Task 9.1); `useCalendarGap` (Task 9.3); TanStack Table v9 (Library notes); `ExpandedRow`, `rowName` (Task 9.7); `ViewHeader` (Task 9.6); `SyntheticBanner`, `Loading`, `LoadError` (Task 9.5); `useProviders`, `useResults` (Task 9.3); URL state (Task 9.4).
- Produces: `ResultsTable`, `WIDE_COLUMNS`, `NARROW_COLUMNS`, `SORT_LABEL`, `rowId`, `ResultsHeader({ data, filteredFirst })`, `Filters({ state, rows, calendarBasis, narrow })`, `ResultsView({ definition })` (Task 9.9 gives its final form).

Decisions. **Columns stay as the spec mandates** (ruling on UI-14); in the wide table the price line shows source and age only, since Provider and Destination are columns beside it. **The headline is a `PriceCell`** with the provider badge, source, the full age visible (spec §3 "full form … in headers"), "≈", "stale", "cheapest of the rows read" and the not-seen note (the Critical, reviews arch-001, prov-003, po-004, UI-2, PFT-01). **It follows the filters**: it is the first row of the filtered set in server order, and when the filters leave nothing the API's overall cheapest is shown labelled "overall, filters not applied" (decision 36). **Line 2** shows "(E outbounds each)" from the shown run's own execution summary (decision 42), so an edited definition never misdescribes a past run (reviews prov-018, prov-r2-010). **`failed` is hidden by default** (core's default, spec §6.9): the class boxes show the default ticked, the count of hidden failed rows is stated, and one click shows them (reviews tsr-001, po-008, prov-014). **When filters are active** the page says "showing X of Y rows (filters active)", and how many stale rows `hideStale` hid (review prov-013). **Empty states** differ: no rows from the run points to Coverage; rows filtered to nothing say so and offer Clear (review UI-5). **The order is always stated**: "server ranking (class, then price)" or the chosen column, and a non-price sort over a truncated page says it sorts within the cheapest rows (review PFT-04). **At 375px** the sort is a select and the filters fold into a closed `<details>` with an active count (review UI-7). **Filters**: checkboxes, selects and dates apply on change; typed boxes apply on Enter, on Apply and on leaving the box; a blank nights end takes the data's own range, not an invented 90 (review UI-8); carrier entries that are not codes are shown as ignored (review PFT-12); a departure-date range (decision 36). **Keyboard**: sort state and band marks reach the cells through context, so a header keeps focus after Enter. **An unconfirmed price** carries "price not confirmed by the final step" as its first badge in the table row, the adjusted column and the headline (decision 44). **A page of itinerary rows of unknown vendor age** is labelled per price and never called stale (decision 44). **Any synthetic provenance** the page received (rows, other sellers, the overall cheapest, the calendar-gap prices) raises the red banner whatever `/providers` said (reviews prov-005, prov-r2-008); real rows raise none. **A schema-valid row whose provenance pairs `fixture` with a non-synthetic source** withholds only its own price (review tsr2-003). Negative request counts are read after `settled(client)` (review tsr2-002).

- [ ] **Step 1: Write the failing test**

`test/views/results/table.test.tsx`:

```tsx
import {
  asIata,
  asIsoDate,
  bandCheapest,
  effectiveAge,
  filterRows,
  formatAgeFull,
  formatFetchedAgo,
  type ResultFilters,
  resultRowKey,
  type SortKey,
  sortRows,
} from '@gmt/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { ResultRow } from '../../../src/api/types.js';
import { formatIsoDate } from '../../../src/format.js';
import { parseResultsState, SORT_KEYS } from '../../../src/state/resultsState.js';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import {
  API,
  calendarRow,
  cell,
  definition,
  failedRow,
  fxConverted,
  partialRow,
  provCalendar,
  provSearch,
  provSynthetic,
  resultsResponse,
  summary,
  verifiedRow,
} from '../../fixtures.js';
import { expectConsoleErrors } from '../../guards.js';
import { server } from '../../msw/server.js';
import { NOW, renderWithProviders, settled } from '../../render.js';
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

const view = (search = '?view=results&def=def-0001', def = definition()) =>
  renderWithProviders(<ResultsView definition={def} />, { search });
const table = () => screen.findByRole('table', { name: 'Round trips found' });
const headers = () =>
  screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↑↓]/g, '').trim());
const dataRows = () =>
  within(screen.getByRole('table', { name: 'Round trips found' }))
    .getAllByRole('row')
    .filter((r) => r.querySelector('[aria-expanded]') !== null);
const rowNames = () =>
  dataRows().map((r) =>
    r
      .querySelector('[aria-expanded]')
      ?.getAttribute('aria-label')
      ?.replace(/^(Show|Hide) details for /, ''),
  );
const nameOf = (r: ResultRow) =>
  `${r.cell.destination} ${formatIsoDate(r.cell.departureDate)} to ${formatIsoDate(r.cell.returnDate)}`;
const url = () => new URLSearchParams(window.location.search);

/** Five rows with distinct keys for every sort column. */
const five: ResultRow[] = [
  verifiedRow(),
  partialRow(),
  verifiedRow({
    itineraryHash: 'h3',
    pricePence: 50000,
    totalMinutes: 600,
    stopsOut: 0,
    stopsIn: 0,
    cell: cell('LHR', 'EWR', '2027-03-20', '2027-04-05', 16),
    adjustedPence: 52000,
  }),
  verifiedRow({
    itineraryHash: 'h4',
    pricePence: 45000,
    totalMinutes: 1500,
    stopsOut: 2,
    stopsIn: 1,
    cell: cell('LGW', 'JFK', '2027-03-10', '2027-03-21', 11),
    stale: true,
  }),
  calendarRow({ pricePence: 30000 }),
];

describe('View A columns (spec §11)', () => {
  it('wide: every column in the spec order; adjusted appears only when configured, through PriceCell', async () => {
    countResults();
    const { unmount } = view();
    await table();
    expect(headers()).toEqual([
      'Details',
      'Price',
      'Travel time',
      'Departure',
      'Return',
      'Nights',
      'Destination',
      'Carriers',
      'Stops',
      'Class',
      'Fetched',
      'Provider',
    ]);
    unmount();
    countResults(resultsResponse({ rows: [verifiedRow({ adjustedPence: 45000 })] }));
    view();
    await table();
    expect(headers().at(-1)).toBe('Adjusted (operator-entered onward cost)');
    const adjusted = screen
      .getByText('incl. operator-entered onward cost')
      .closest('[data-testid="price-cell"]');
    expect(adjusted).toHaveTextContent('£450');
  });

  it('wide: the price line shows source and age only, since Provider and Destination are columns (ruling on UI-14)', async () => {
    countResults();
    view();
    await table();
    const first = dataRows()[0];
    if (first === undefined) throw new Error('no rows');
    const line = within(first).getByTestId('provenance');
    expect(within(line).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(line).queryByText('SearchApi')).toBeNull();
    expect(within(line).queryByText('JFK')).toBeNull();
  });

  it('375px: price, full provenance and the class badge stay in the primary row; sort is a select; filters fold away', async () => {
    setViewportWidth(375);
    countResults();
    const { user } = view();
    await table();
    // why: jsdom loads no CSS, so this asserts the columns the component chose, not Tailwind's layout.
    expect(headers()).toEqual(['Details', 'Price', 'Class', 'Departure', 'Return', 'Stops']);
    const first = dataRows()[0];
    if (first === undefined) throw new Error('no rows');
    expect(within(first).getByText('£412')).toBeInTheDocument();
    expect(within(within(first).getByTestId('provenance')).getByText('SearchApi')).toBeInTheDocument();
    expect(within(first).getByTestId('class-badge')).toHaveTextContent('verified');
    expect(screen.getByRole('combobox', { name: 'Sort rows by' })).toBeInTheDocument();
    expect(screen.getByText('Filters (0 active)').closest('details')).not.toHaveAttribute('open');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort rows by' }), 'totalTime.asc');
    expect(url().get('sort')).toBe('totalTime.asc');
    await user.click(within(first).getByRole('button', { name: /Show details/ }));
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });
});

describe('View A header (spec §11 two lines)', () => {
  it('line 1: the headline price through PriceCell with provider, source and the full age; line 2 links to Coverage', async () => {
    countResults();
    view();
    await table();
    const headline = screen.getByText('cheapest found').parentElement;
    if (headline === null) throw new Error('no headline');
    expect(headline).toHaveTextContent('£412');
    expect(within(headline).getByText('SearchApi')).toBeInTheDocument();
    expect(
      within(headline).getByText(formatAgeFull(effectiveAge(verifiedRow().provenance, NOW))),
    ).toBeInTheDocument();
    expect(
      within(headline).getByText('JFK 14 Mar 2027–28 Mar 2027 (14n) · itinerary-search basis · verified'),
    ).toBeInTheDocument();
    const line2 = screen.getByRole('link', {
      name: 'discovery: 60 priced · 10 no fares · 40 no cached data · 6 error · 0 skipped · 10 not searched of 126 (0 reused) · itinerary-searched 8 of 10 selected (2 outbounds each) +1 on demand',
    });
    expect(line2).toHaveAttribute('href', '/?view=coverage&def=def-0001');
  });

  it('a converted, stale, truncated calendar headline carries "≈", "stale" and "cheapest of the rows read" (the Critical)', async () => {
    const row = calendarRow({
      stale: true,
      truncated: true,
      provenance: { ...provCalendar, fx: fxConverted },
    });
    countResults(resultsResponse({ basis: 'calendar', rows: [row] }));
    view();
    await table();
    const headline = screen.getByText('cheapest found').parentElement;
    if (headline === null) throw new Error('no headline');
    expect(headline).toHaveTextContent(/≈.*£399/);
    expect(within(headline).getByText('stale')).toBeInTheDocument();
    expect(within(headline).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(within(headline).getByText(formatAgeFull(effectiveAge(row.provenance, NOW)))).toBeInTheDocument();
  });

  it('the headline follows the filters; when they leave nothing it is labelled "overall, filters not applied" (decision 36)', async () => {
    countResults();
    const { unmount } = view('?view=results&f.class=partially-verified');
    await table();
    const headline = () => screen.getByText('cheapest found').parentElement;
    expect(headline()).toHaveTextContent('£388');
    expect(screen.queryByText('overall, filters not applied')).toBeNull();
    unmount();
    view('?view=results&f.maxPrice=100');
    await screen.findByText('No rows match these filters.');
    expect(headline()).toHaveTextContent('£412');
    expect(screen.getByText('overall, filters not applied')).toBeInTheDocument();
  });

  it('"(E outbounds each)" is the shown run own policy, even after the definition changed (decision 42)', async () => {
    countResults(resultsResponse({ executions: [summary({ expandTop: 3 })] }));
    view('?view=results', definition({ updatedAt: '2026-10-14T12:30:00.000Z' }));
    await table();
    expect(
      screen.getByRole('link', {
        name: /itinerary-searched 8 of 10 selected \(3 outbounds each\) \+1 on demand$/,
      }),
    ).toBeInTheDocument();
  });

  it('says "within the cheapest N of M" when truncated, and reports rows outside the current space', async () => {
    countResults(resultsResponse({ truncated: true, excludedByCurrentSpace: 3, total: 4210 }));
    view();
    expect(await screen.findByText('within the cheapest 2 of 4210')).toBeInTheDocument();
    expect(
      screen.getByText('3 rows outside the current window and nights range are not shown'),
    ).toBeInTheDocument();
  });

  it('a non-price sort over a truncated page says it sorts within the cheapest rows (review PFT-04)', async () => {
    countResults(resultsResponse({ truncated: true, total: 4210 }));
    view('?view=results&sort=totalTime.asc');
    expect(
      await screen.findByText('sorted by Travel time within the cheapest 2 of 4210'),
    ).toBeInTheDocument();
    expect(screen.getByText('Order: Travel time, ascending')).toBeInTheDocument();
  });
});

describe('client-side sort and filter (spec §6.5)', () => {
  it.each(
    SORT_KEYS.flatMap((key) =>
      (['asc', 'desc'] as const).map((dir): [SortKey, 'asc' | 'desc'] => [key, dir]),
    ),
  )('sort=%s.%s matches core sortRows over filterRows, without a refetch', async (key, dir) => {
    const hits = countResults(resultsResponse({ rows: five }));
    const { client } = view(`?view=results&sort=${key}.${dir}`);
    await table();
    expect(rowNames()).toEqual(sortRows(filterRows(five, {}), key, dir).map(nameOf));
    await settled(client);
    expect(hits.n).toBe(1);
  });

  it('no sort keeps the server ranking, says so, and stale rows keep their place, labelled', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    expect(screen.getByText('Order: server ranking (class, then price)')).toBeInTheDocument();
    expect(rowNames()).toEqual(filterRows(five, {}).map(nameOf));
    const staleRow = dataRows()[3];
    expect(staleRow && within(staleRow).getByText('stale')).toBeInTheDocument();
  });

  it('marks exactly the rows core bandCheapest marks', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    const marked = bandCheapest(filterRows(five, {}), 6);
    const labelled = dataRows().filter(
      (r) => within(r).queryByText('cheapest in its 6h travel-time band') !== null,
    );
    expect(labelled.map((r) => r.id)).toEqual(
      filterRows(five, {})
        .filter((r) => marked.has(resultRowKey(r)))
        .map((r) => `row-${resultRowKey(r)}`),
    );
    expect(labelled.length).toBeGreaterThan(0);
  });

  it('sorting and filtering compose without refetching, and live in the URL', async () => {
    const hits = countResults();
    const { user, client } = view();
    await table();
    await user.click(screen.getByRole('button', { name: 'Sort by Price, ascending' }));
    expect(rowNames()[0]).toBe(nameOf(partialRow()));
    expect(url().get('sort')).toBe('price.asc');
    await user.click(screen.getByRole('checkbox', { name: 'partially verified' }));
    expect(dataRows()).toHaveLength(1);
    expect(url().get('f.class')).toBe('verified,unchecked');
    expect(screen.getByText('showing 1 of 2 rows (filters active)')).toBeInTheDocument();
    await settled(client);
    expect(hits.n).toBe(1);
  });

  it('failed rows are hidden by default, counted, and one click shows them (spec §6.9)', async () => {
    countResults(resultsResponse({ rows: [verifiedRow(), partialRow(), failedRow()] }));
    const { user } = view();
    await table();
    expect(dataRows()).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'verified' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'failed' })).not.toBeChecked();
    expect(screen.getByText('1 failed row hidden by default')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show failed rows' }));
    expect(dataRows()).toHaveLength(3);
    expect(url().get('f.class')).toBe('verified,partially-verified,failed,unchecked');
  });

  it.each<[string, string, (u: ReturnType<typeof view>['user']) => Promise<void>, ResultFilters]>([
    [
      'provider',
      'f.provider',
      (u) => u.click(screen.getByRole('checkbox', { name: 'Travelpayouts' })),
      { providerId: ['travelpayouts'] },
    ],
    [
      'destination',
      'f.dest',
      (u) => u.click(screen.getByRole('checkbox', { name: 'EWR' })),
      { destination: [asIata('EWR')] },
    ],
    [
      'max stops',
      'f.stops',
      (u) => u.selectOptions(screen.getByLabelText('Max stops'), '0'),
      { maxStops: 0 },
    ],
    [
      'max price (Enter applies)',
      'f.maxPrice',
      (u) => u.type(screen.getByLabelText('Max price (£)'), '400{Enter}'),
      { maxPricePence: 40000 },
    ],
    [
      'nights (a blank end takes the data range)',
      'f.nights',
      (u) => u.type(screen.getByLabelText('Min nights'), '14{Enter}'),
      { nights: { min: 14, max: 16 } },
    ],
    [
      'hide stale',
      'f.stale',
      (u) => u.click(screen.getByRole('checkbox', { name: 'Hide stale rows' })),
      { hideStale: true },
    ],
    [
      'unverified constraint',
      'f.unverified',
      (u) => u.selectOptions(screen.getByLabelText('Has this constraint unverified'), 'checkedBagRequired'),
      { unverified: ['checkedBagRequired'] },
    ],
  ])(
    'the %s filter applies through the URL, as core filterRows would',
    async (_label, param, act, filters) => {
      const hits = countResults(resultsResponse({ rows: five }));
      const { user, client } = view();
      await table();
      await act(user);
      expect(url().get(param)).not.toBeNull();
      expect(parseResultsState(url()).filters).toEqual(filters);
      expect(rowNames()).toEqual(filterRows(five, filters).map(nameOf));
      await settled(client);
      expect(hits.n).toBe(1);
    },
  );

  it('the departure-date range filter keeps departures inside it (decision 36)', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    // why: a date input commits a whole date; setting one end fills the other from the data's own range.
    fireEvent.change(screen.getByLabelText('Departs on or after'), { target: { value: '2027-03-14' } });
    expect(url().get('f.depart')).toBe('2027-03-14..2027-04-02');
    fireEvent.change(screen.getByLabelText('Departs on or before'), { target: { value: '2027-03-20' } });
    expect(url().get('f.depart')).toBe('2027-03-14..2027-03-20');
    expect(rowNames()).toEqual(
      filterRows(five, { departure: { from: asIsoDate('2027-03-14'), to: asIsoDate('2027-03-20') } }).map(
        nameOf,
      ),
    );
    expect(rowNames()).toHaveLength(3);
  });

  it('carriers: codes apply on leaving the box; entries that are not codes are shown as ignored (review PFT-12)', async () => {
    countResults(resultsResponse({ rows: five }));
    const { user } = view();
    await table();
    await user.type(screen.getByLabelText('Carriers (comma-separated codes)'), 'zz, British');
    await user.tab();
    expect(url().get('f.carriers')).toBe('ZZ');
    expect(screen.getByText('ignored, not two-character carrier codes: BRITISH')).toBeInTheDocument();
  });

  it('hide stale states how many rows it hid; Clear filters resets every box', async () => {
    countResults(resultsResponse({ rows: five }));
    const { user } = view('?view=results&f.stale=hide&f.maxPrice=48000');
    await table();
    expect(screen.getByText('1 stale row hidden')).toBeInTheDocument();
    expect(screen.getByLabelText('Max price (£)')).toHaveValue('480');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(url().get('f.stale')).toBeNull();
    expect(screen.getByLabelText('Max price (£)')).toHaveValue('');
  });

  it('filters survive a remount because they are in the URL', async () => {
    countResults();
    const first = view('?view=results&f.class=partially-verified');
    await table();
    expect(dataRows()).toHaveLength(1);
    const search = window.location.search;
    first.unmount();
    view(search);
    await table();
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'partially verified' })).toBeChecked();
  });

  it('stops and carriers filters are disabled on the calendar basis', async () => {
    countResults(resultsResponse({ basis: 'calendar', rows: [calendarRow()] }));
    view();
    expect(await screen.findByLabelText('Max stops')).toBeDisabled();
    expect(screen.getByLabelText('Carriers (comma-separated codes)')).toBeDisabled();
    expect(screen.getByText('Stops and carriers are not known on the calendar basis.')).toBeInTheDocument();
  });
});

describe('empty, loading and error states (reviews UI-5, tsr-011, tsr-002)', () => {
  it('no rows from the run points to Coverage; rows filtered to nothing say so and offer Clear', async () => {
    countResults(resultsResponse({ rows: [], cheapest: null }));
    const { unmount } = view();
    expect(await screen.findByRole('link', { name: /This run has no rows on this basis/ })).toHaveAttribute(
      'href',
      '/?view=coverage&def=def-0001',
    );
    expect(screen.queryByText('No rows match these filters.')).toBeNull();
    unmount();
    countResults();
    const { user } = view('?view=results&f.maxPrice=100');
    expect(await screen.findByText('No rows match these filters.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1) ?? document.body);
    expect(await table()).toBeInTheDocument();
  });

  it('loading is announced, then the table renders', async () => {
    countResults();
    view();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(await table()).toBeInTheDocument();
  });

  it('a failed load shows the reason and a retry, never stale numbers', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        fail
          ? HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 })
          : HttpResponse.json(resultsResponse()),
      ),
    );
    const { user } = view();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: database is locked');
    expect(screen.queryByText(/£/)).toBeNull();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await table()).toBeInTheDocument();
  });

  it('a row without provenance fails the whole response (parsed in every mode): an alert and no price (spec §9 item 6)', async () => {
    const { provenance: _drop, ...bare } = calendarRow();
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json({ ...resultsResponse(), rows: [verifiedRow(), bare] }),
      ),
    );
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /does not match core\/api-contract: rows\.1\.provenance/,
    );
    expect(screen.queryByText(/£/)).toBeNull();
  });

  it('a schema-valid row whose provenance pairs the fixture provider with a non-synthetic source withholds only its own price', async () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const odd = verifiedRow({
      itineraryHash: 'odd',
      pricePence: 45600,
      provenance: { ...provSearch, providerId: 'fixture' },
    });
    countResults(resultsResponse({ rows: [verifiedRow(), odd] }));
    view();
    await table();
    const withheld = dataRows()[1];
    if (withheld === undefined) throw new Error('no second row');
    expect(within(withheld).getByRole('alert')).toHaveTextContent('price withheld: provenance missing');
    expect(within(withheld).queryByText(/£/)).toBeNull();
    expect(within(dataRows()[0] ?? document.body).getByText('£412')).toBeInTheDocument();
  });

  it('every Fetched cell is core formatFetchedAgo of its row (review tsr2-007)', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    const fetchedColumn = headers().indexOf('Fetched');
    const cells = dataRows().map((r) => r.querySelectorAll('td')[fetchedColumn]?.textContent);
    expect(cells).toEqual(filterRows(five, {}).map((r) => formatFetchedAgo(effectiveAge(r.provenance, NOW))));
    expect(cells[0]).toBe('fetched 5h ago');
  });

  it('a page of itinerary rows of unknown vendor age is labelled, not called stale (decision 44)', async () => {
    countResults(resultsResponse({ rows: [verifiedRow(), partialRow()] }));
    view();
    await table();
    expect(screen.getAllByText("vendor's cache age unknown")).toHaveLength(3);
    expect(screen.queryByText('Every row here is older than one refresh cycle.')).toBeNull();
  });

  it('an unconfirmed price says so in the table row and the headline, as the first mark (decision 44)', async () => {
    const unconfirmed = partialRow({
      verdicts: { cabin: 'pass', priceConfirmed: 'unverified' },
      unverified: ['priceConfirmed'],
    });
    countResults(resultsResponse({ rows: [unconfirmed], cheapest: unconfirmed }));
    view();
    await table();
    const headline = screen.getByText('cheapest found').parentElement;
    expect(
      within(headline ?? document.body).getByText('price not confirmed by the final step'),
    ).toBeInTheDocument();
    expect(
      within(dataRows()[0] ?? document.body).getByText('price not confirmed by the final step'),
    ).toBeInTheDocument();
  });

  it('negative: real rows raise no synthetic banner and say no "synthetic fixture data" (spec §5.5)', async () => {
    countResults(resultsResponse({ rows: [verifiedRow(), calendarRow()] }));
    view();
    await table();
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
    expect(screen.queryByText('synthetic fixture data')).toBeNull();
  });

  it('a synthetic price only in the overall cheapest still raises the banner (review prov-r2-008)', async () => {
    const synthetic = calendarRow({ provenance: provSynthetic, searchLink: null });
    countResults(resultsResponse({ rows: [verifiedRow()], cheapest: synthetic }));
    view();
    await table();
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('a synthetic row raises the red banner whatever /providers says, and says "synthetic fixture data" (review prov-005)', async () => {
    countResults(
      resultsResponse({
        basis: 'calendar',
        rows: [calendarRow({ provenance: provSynthetic, searchLink: null })],
      }),
    );
    view();
    await table();
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
    expect(screen.getAllByText('synthetic fixture data').length).toBeGreaterThan(0);
  });
});

describe('row= selects, expands and scrolls to a row (plan "Web")', () => {
  it('the row named by its resultRowKey is marked current, expanded and scrolled into view', async () => {
    countResults();
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    view('?view=results&row=hash-partial-1');
    await table();
    const selected = dataRows().find((r) => r.getAttribute('aria-current') === 'true');
    if (selected === undefined) throw new Error('no selected row');
    expect(within(selected).getByText('£388')).toBeInTheDocument();
    expect(within(selected).getByRole('button', { name: /Hide details/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect.poll(() => scrolled).toEqual([selected]);
  });
});

describe('keyboard operation of the table (spec §9 item 6, §11 accessibility)', () => {
  it('sort headers and row expansion work from the keyboard alone, and Tab moves to the next control', async () => {
    countResults();
    const { user } = view();
    await table();
    const priceSort = screen.getByRole('button', { name: 'Sort by Price, ascending' });
    priceSort.focus();
    await user.keyboard('{Enter}');
    expect(url().get('sort')).toBe('price.asc');
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sort by Price, descending' }));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Sort by Travel time, ascending' }),
    );

    const toggle = within(dataRows()[0] ?? document.body).getByRole('button', { name: /Show details/ });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeNull();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/table.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/views/Results/ResultsView.js"`.

- [ ] **Step 2b: Prove sorting never refetches**

After Step 3, temporarily make `onSort` in `ResultsView` call `void results.refetch()` after it updates the URL (a "fresh data on every sort" regression). Run the table test: "sorting and filtering compose without refetching, and live in the URL" fails with `expected 2 to be 1` at `hits.n` (read after `settled`, so the late request is counted). Remove the call.

- [ ] **Step 3: Implement**

`src/views/Results/ResultsTable.tsx` (new file):

```tsx
import { effectiveAge, formatFetchedAgo, resultRowKey, type SortKey } from '@gmt/core';
import {
  createColumnHelper,
  type ExpandedState,
  rowExpandingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import type { ResultRow } from '../../api/types.js';
import { ClassBadge } from '../../components/ClassBadge.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell, priceUnconfirmed } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';
import { SORT_KEYS, type SortDir } from '../../state/resultsState.js';
import { ExpandedRow, rowName } from './ExpandedRow.js';

// why: only the expanding feature; sorting and filtering are core's functions over the fetched page (spec §6.5).
const features = tableFeatures({ rowExpandingFeature });
const helper = createColumnHelper<typeof features, ResultRow>();

export type ColumnId =
  | 'expand'
  | 'price'
  | 'totalTime'
  | 'departure'
  | 'return'
  | 'nights'
  | 'destination'
  | 'carriers'
  | 'stops'
  | 'class'
  | 'fetched'
  | 'provider'
  | 'adjusted';

/** Spec §11 column order (after the expand toggle); the spec mandates every one (ruling on UI-14). */
export const WIDE_COLUMNS: readonly ColumnId[] = [
  'expand',
  'price',
  'totalTime',
  'departure',
  'return',
  'nights',
  'destination',
  'carriers',
  'stops',
  'class',
  'fetched',
  'provider',
  'adjusted',
];
/** Spec §11 at 375px: price with provenance, the class badge, dates and stops stay in the primary row. */
export const NARROW_COLUMNS: readonly ColumnId[] = [
  'expand',
  'price',
  'class',
  'departure',
  'return',
  'stops',
];

/** Which column sorts by which core SortKey; keyed by the column id string TanStack hands back. */
const SORT_KEY: ReadonlyMap<string, SortKey> = new Map<string, SortKey>(SORT_KEYS.map((k) => [k, k]));
/** The column label of each sort key, for the narrow-screen sort select and the order line. */
export const SORT_LABEL: Record<SortKey, string> = {
  price: COPY.columns.price,
  totalTime: COPY.columns.totalTime,
  departure: COPY.columns.departure,
  return: COPY.columns.return,
  nights: COPY.columns.nights,
  stops: COPY.columns.stops,
  adjusted: COPY.columns.adjusted,
};

type Sort = { key: SortKey; dir: SortDir } | null;

/** Row identity is core's resultRowKey (itineraryHash, or `calendar:<id>`): the bandCheapest Set and `?row=` both use it. */
export const rowId = (r: ResultRow): string => resultRowKey(r);

const detailId = (id: string) => `detail-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const rowDomId = (id: string) => `row-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/**
 * The sort and the band marks reach the cells through context, so the column definitions never change
 * when the sort or the filters do, and a header keeps keyboard focus after Enter (spec §11 keyboard-operable table).
 */
const TableContext = createContext<{ sort: Sort; onSort: (k: SortKey) => void; banded: ReadonlySet<string> }>(
  {
    sort: null,
    onSort: () => undefined,
    banded: new Set(),
  },
);

function SortHeader({ id }: { id: ColumnId }) {
  const { sort, onSort } = useContext(TableContext);
  const key = SORT_KEY.get(id);
  const label = COPY.columns[id];
  if (key === undefined) return <span>{label}</span>;
  const active = sort?.key === key;
  const next: SortDir = active && sort?.dir === 'asc' ? 'desc' : 'asc';
  return (
    <button
      type="button"
      className="min-h-11 underline"
      onClick={() => onSort(key)}
      aria-label={COPY.sortBy(label, COPY.sortDir[next])}
    >
      {label}
      {active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

function FetchedAgo({ row }: { row: ResultRow }) {
  const now = useNow();
  return <span>{formatFetchedAgo(effectiveAge(row.provenance, now))}</span>;
}

/**
 * The price column: every price through PriceCell. Wide, the Provider and Destination columns carry
 * those, so the provenance line shows source and age (ruling on UI-14); narrow, the line is complete.
 */
function PriceColumn({ row, narrow }: { row: ResultRow; narrow: boolean }) {
  const banded = useContext(TableContext).banded.has(rowId(row));
  return (
    <div className="flex flex-col gap-0.5">
      <PriceBoundary>
        <PriceCell
          pricePence={row.pricePence}
          provenance={row.provenance}
          calendar={row.basis === 'calendar'}
          stale={row.stale}
          truncated={row.truncated}
          destination={row.cell.destination}
          destinationNote={row.destinationNote}
          notSeenInLatestHours={row.notSeenInLatest?.ageHours ?? null}
          besideColumns={!narrow}
          unconfirmed={priceUnconfirmed(row)}
        />
      </PriceBoundary>
      {row.basis === 'calendar' && row.notApplied.length > 0 ? (
        <span className="text-xs">
          {COPY.notApplied(row.notApplied.map((n) => COPY.constraint[n]).join(', '))}
        </span>
      ) : null}
      {banded ? <span className="text-xs font-medium">{COPY.bandCheapest}</span> : null}
    </div>
  );
}

/** The adjusted column: the same PriceCell, so it carries "≈", "stale" and its own words (review prov-009). */
function AdjustedColumn({ row }: { row: ResultRow }) {
  if (row.adjustedPence === null) return null;
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={row.adjustedPence}
        provenance={row.provenance}
        calendar={row.basis === 'calendar'}
        stale={row.stale}
        truncated={row.truncated}
        qualifier={COPY.adjustedQualifier}
        besideColumns
        unconfirmed={priceUnconfirmed(row)}
      />
    </PriceBoundary>
  );
}

function cellFor(id: ColumnId, r: ResultRow, narrow: boolean) {
  const calendar = r.basis === 'calendar';
  switch (id) {
    case 'price':
      return <PriceColumn row={r} narrow={narrow} />;
    case 'totalTime':
      return <span>{r.totalMinutes === null ? COPY.notChecked : formatMinutes(r.totalMinutes)}</span>;
    case 'departure':
      return <span>{formatIsoDate(r.cell.departureDate)}</span>;
    case 'return':
      return <span>{formatIsoDate(r.cell.returnDate)}</span>;
    case 'nights':
      return <span>{COPY.nightsValue(r.cell.nights)}</span>;
    case 'destination':
      return <span>{r.cell.destination}</span>;
    case 'carriers':
      return <span>{calendar ? COPY.notChecked : r.carriers.join(', ')}</span>;
    case 'stops':
      return (
        <span>
          {r.stopsOut === null || r.stopsIn === null
            ? COPY.notChecked
            : COPY.stopsValue(r.stopsOut, r.stopsIn)}
        </span>
      );
    case 'class':
      return <ClassBadge cls={r.verdictClass} />;
    case 'fetched':
      return <FetchedAgo row={r} />;
    case 'provider':
      return <span>{COPY.provider[r.provenance.providerId]}</span>;
    case 'adjusted':
      return <AdjustedColumn row={r} />;
    case 'expand':
      return null;
  }
}

function buildColumns(ids: readonly ColumnId[], narrow: boolean) {
  return ids.map((id) =>
    helper.display({
      id,
      header: () => <SortHeader id={id} />,
      cell: ({ row }) => {
        if (id !== 'expand') return cellFor(id, row.original, narrow);
        const open = row.getIsExpanded();
        const name = rowName(row.original);
        return (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded border border-slate-500"
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
  /** Non-empty: the view renders the empty states. */
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
export function ResultsTable({
  rows,
  banded,
  selectedRow,
  sort,
  onSort,
  narrow,
  verificationConfigured,
  definitionId,
}: ResultsTableProps) {
  const [expanded, setExpanded] = useState<ExpandedState>(() =>
    selectedRow === null ? {} : { [selectedRow]: true },
  );
  const selectedPresent = selectedRow !== null && rows.some((r) => rowId(r) === selectedRow);
  useEffect(() => {
    // why: an email link lands here; bring its row into view once the rows are rendered.
    if (selectedRow !== null && selectedPresent)
      document.getElementById(rowDomId(selectedRow))?.scrollIntoView({ block: 'center' });
  }, [selectedRow, selectedPresent]);
  const adjusted = rows.some((r) => r.adjustedPence !== null);
  const ids = useMemo(
    () => (narrow ? NARROW_COLUMNS : WIDE_COLUMNS.filter((c) => c !== 'adjusted' || adjusted)),
    [narrow, adjusted],
  );
  const columns = useMemo(() => buildColumns(ids, narrow), [ids, narrow]);
  const context = useMemo(() => ({ sort, onSort, banded }), [sort, onSort, banded]);
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: rowId,
    getRowCanExpand: () => true,
    state: { expanded },
    onExpandedChange: setExpanded,
  });
  return (
    <TableContext.Provider value={context}>
      <table aria-label={COPY.resultsTableLabel} className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((h) => {
                const key = SORT_KEY.get(h.column.id);
                const ariaSort =
                  key === undefined
                    ? undefined
                    : sort?.key === key
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none';
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className="border-b border-slate-400 p-1 text-left"
                  >
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
                    <ExpandedRow
                      row={row.original}
                      extras={narrow}
                      verificationConfigured={verificationConfigured}
                      definitionId={definitionId}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </TableContext.Provider>
  );
}
```

`src/views/Results/ResultsHeader.tsx` (new file):

```tsx
import type { ResultRow, ResultsResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell, priceUnconfirmed } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

/**
 * Line 1 (spec §11): "cheapest found £X · destination dates · basis · class" with the price through
 * PriceCell, so the headline carries the same "≈", stale, truncated and not-seen marks as the table,
 * the provider badge and the full age form (headers show it, spec §3).
 */
function Headline({ row, overall }: { row: ResultRow; overall: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-start gap-2 text-lg font-semibold ${row.basis === 'calendar' ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      <span>{COPY.headlineLead}</span>
      <PriceBoundary>
        <PriceCell
          pricePence={row.pricePence}
          provenance={row.provenance}
          calendar={row.basis === 'calendar'}
          stale={row.stale}
          truncated={row.truncated}
          unconfirmed={priceUnconfirmed(row)}
          destinationNote={row.destinationNote}
          notSeenInLatestHours={row.notSeenInLatest?.ageHours ?? null}
          fullAge
        />
      </PriceBoundary>
      <span>
        {COPY.headlineRest({
          destination: row.cell.destination,
          dates: COPY.dateRange(
            formatIsoDate(row.cell.departureDate),
            formatIsoDate(row.cell.returnDate),
            row.cell.nights,
          ),
          basis: COPY.basisName[row.basis],
          cls: COPY.classLabel[row.verdictClass],
        })}
      </span>
      {overall ? <span className="font-normal italic">{COPY.headlineOverall}</span> : null}
    </div>
  );
}

export interface ResultsHeaderProps {
  data: ResultsResponse;
  /** The first row of the filtered set in server order (decision 36); null when the filters leave none. */
  filteredFirst: ResultRow | null;
}

/** Spec §11: the two-line Results header, plus the truncation and current-space notes. */
export function ResultsHeader({ data, filteredFirst }: ResultsHeaderProps) {
  // why: the headline follows what the operator is looking at; when the filters leave nothing, the API's
  // overall cheapest is shown and labelled as such, never passed off as matching the filters.
  const headline = filteredFirst ?? data.cheapest;
  const overall = filteredFirst === null && data.cheapest !== null;
  const c = data.coverage;
  const b = c.buckets;
  const latestParent = data.executions.find((e) => !e.isChild);
  // why: "(E outbounds each)" is the shown run's own policy from its summary (decision 42), never the
  // current definition's, which the operator may have edited since.
  const itinerary = { searched: c.itinerarySearched, selected: c.selected, onDemand: c.onDemand };
  const line2 =
    COPY.coverageLine({
      priced: b.priced,
      empty: b.empty,
      noData: b.no_data,
      error: b.error,
      skipped: b.skipped,
      notRun: b.not_run,
      total: c.total,
      reused: c.reused,
    }) +
    (!data.verificationProviderConfigured
      ? COPY.noItinerarySearch
      : latestParent !== undefined
        ? COPY.itineraryLineExpand({ ...itinerary, expandTop: latestParent.expandTop })
        : COPY.itineraryLine(itinerary));
  return (
    <div className="space-y-1">
      {headline !== null ? (
        <Headline row={headline} overall={overall} />
      ) : (
        <p className="text-lg font-semibold">{COPY.noHeadline}</p>
      )}
      <p className="text-sm">
        <a
          href={hrefWith({ view: 'coverage' })}
          onClick={navigateTo({ view: 'coverage' })}
          className="underline"
        >
          {line2}
        </a>
      </p>
      {data.truncated ? <p className="text-sm">{COPY.truncated(data.rows.length, data.total)}</p> : null}
      {data.excludedByCurrentSpace > 0 ? (
        <p className="text-sm">{COPY.excludedByCurrentSpace(data.excludedByCurrentSpace)}</p>
      ) : null}
    </div>
  );
}
```

`src/views/Results/Filters.tsx` (new file):

```tsx
import { apiContract, type ResultFilters } from '@gmt/core';
import type { FormEvent } from 'react';
import type { ResultRow } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { parsePoundsToPence, penceToPoundsInput, poundsText } from '../../format.js';
import { useSynced } from '../../hooks/useSynced.js';
import { carriersText, parseCarriers } from '../../state/carriers.js';
import {
  activeFilterCount,
  CLASSES,
  DEFAULT_CLASSES,
  type ResultsUiState,
  resultsStatePatch,
  setFilter,
} from '../../state/resultsState.js';
import { updateSearchParams } from '../../state/urlState.js';

function toggle<T extends string>(list: readonly T[], v: T): T[] | undefined {
  const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return next.length > 0 ? next : undefined;
}

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];
const intOrUndefined = (s: string): number | undefined =>
  /^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined;

const intMeaning = (t: string) => {
  const n = intOrUndefined(t);
  return n === undefined ? '' : String(n);
};

const field = 'min-h-11 rounded border border-slate-400 px-1';

export interface FiltersProps {
  state: ResultsUiState;
  rows: readonly ResultRow[];
  calendarBasis: boolean;
  /** Collapsed by default on a narrow screen so the table stays above the fold (review UI-7). */
  narrow: boolean;
}

/**
 * Spec §6.5 filters, all client-side; state lives in the URL so it persists across views. Checkboxes,
 * selects and dates apply on change; typed boxes apply on Enter, on Apply and on leaving the box.
 */
export function Filters({ state, rows, calendarBasis, narrow }: FiltersProps) {
  const f = state.filters;
  const apply = (next: ResultFilters) => updateSearchParams(resultsStatePatch({ ...state, filters: next }));
  const [carriers, setCarriers] = useSynced((f.carriers ?? []).join(','), carriersText);
  const [maxPrice, setMaxPrice] = useSynced(penceToPoundsInput(f.maxPricePence), poundsText);
  const [nightsMin, setNightsMin] = useSynced(f.nights === undefined ? '' : String(f.nights.min), intMeaning);
  const [nightsMax, setNightsMax] = useSynced(f.nights === undefined ? '' : String(f.nights.max), intMeaning);
  const providers = unique(rows.map((r) => r.provenance.providerId));
  const destinations = unique(rows.map((r) => r.cell.destination));
  const constraints = apiContract.constraintNameSchema.options.filter((c) =>
    rows.some((r) => r.unverified.includes(c)),
  );
  const classes = f.verdictClass ?? DEFAULT_CLASSES;
  const nights = rows.map((r) => r.cell.nights);
  const dates = rows.map((r) => r.cell.departureDate).sort();
  const ignored = parseCarriers(carriers).ignored;

  /** Applies every typed box at once; a nights box left blank takes the data's own end of the range. */
  const typed = (base: ResultFilters): ResultFilters => {
    const min = intOrUndefined(nightsMin);
    const max = intOrUndefined(nightsMax);
    const range =
      min === undefined && max === undefined
        ? undefined
        : { min: min ?? Math.min(...nights, max ?? 0), max: max ?? Math.max(...nights, min ?? 0) };
    const codes = parseCarriers(carriers).codes;
    let next = setFilter(base, 'carriers', codes.length > 0 ? codes : undefined);
    next = setFilter(next, 'maxPricePence', parsePoundsToPence(maxPrice));
    return setFilter(
      next,
      'nights',
      range === undefined
        ? undefined
        : { min: Math.min(range.min, range.max), max: Math.max(range.min, range.max) },
    );
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply(typed(f));
  };
  const setDeparture = (end: 'from' | 'to', value: string) => {
    const parsed = apiContract.cellKeySchema.shape.departureDate.safeParse(value);
    const current = f.departure;
    const first = dates[0];
    const last = dates.at(-1);
    if (!parsed.success) {
      apply(setFilter(f, 'departure', undefined));
      return;
    }
    const from = end === 'from' ? parsed.data : (current?.from ?? first);
    const to = end === 'to' ? parsed.data : (current?.to ?? last);
    if (from === undefined || to === undefined) return;
    apply(setFilter(f, 'departure', from <= to ? { from, to } : { from: to, to: from }));
  };

  return (
    <details open={!narrow} className="text-sm">
      <summary className="min-h-11 cursor-pointer font-semibold">
        {COPY.filtersSummary(activeFilterCount(f))}
      </summary>
      <form
        aria-label={COPY.filtersHeading}
        onSubmit={onSubmit}
        className="flex flex-wrap items-start gap-3 pt-2"
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="font-semibold">{COPY.filterClass}</legend>
          {CLASSES.map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={classes.includes(c)}
                onChange={() => apply(setFilter(f, 'verdictClass', toggle(classes, c)))}
              />
              {COPY.classLabel[c]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="font-semibold">{COPY.filterProvider}</legend>
          {providers.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={f.providerId?.includes(p) ?? false}
                onChange={() => apply(setFilter(f, 'providerId', toggle(f.providerId ?? [], p)))}
              />
              {COPY.provider[p]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="font-semibold">{COPY.filterDestinations}</legend>
          {destinations.map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={f.destination?.includes(d) ?? false}
                onChange={() => apply(setFilter(f, 'destination', toggle(f.destination ?? [], d)))}
              />
              {d}
            </label>
          ))}
        </fieldset>
        <span className="flex flex-col">
          <label htmlFor="filter-max-stops">{COPY.filterMaxStops}</label>
          <select
            id="filter-max-stops"
            className={field}
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
        <span className="flex flex-col">
          <label htmlFor="filter-carriers">{COPY.filterCarriers}</label>
          <input
            id="filter-carriers"
            className={field}
            disabled={calendarBasis}
            value={carriers}
            aria-describedby={ignored.length > 0 ? 'filter-carriers-ignored' : undefined}
            onChange={(e) => setCarriers(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
          {ignored.length > 0 ? (
            <span id="filter-carriers-ignored" className="text-xs text-red-800">
              {COPY.carriersIgnored(ignored.join(', '))}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-max-price">{COPY.filterMaxPrice}</label>
          <input
            id="filter-max-price"
            className={field}
            inputMode="decimal"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-nights-min">{COPY.filterNightsMin}</label>
          <input
            id="filter-nights-min"
            className={field}
            inputMode="numeric"
            value={nightsMin}
            onChange={(e) => setNightsMin(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-nights-max">{COPY.filterNightsMax}</label>
          <input
            id="filter-nights-max"
            className={field}
            inputMode="numeric"
            value={nightsMax}
            onChange={(e) => setNightsMax(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-depart-from">{COPY.filterDepartFrom}</label>
          <input
            id="filter-depart-from"
            className={field}
            type="date"
            value={f.departure?.from ?? ''}
            onChange={(e) => setDeparture('from', e.target.value)}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-depart-to">{COPY.filterDepartTo}</label>
          <input
            id="filter-depart-to"
            className={field}
            type="date"
            value={f.departure?.to ?? ''}
            onChange={(e) => setDeparture('to', e.target.value)}
          />
        </span>
        <label className="flex min-h-11 items-center gap-1">
          <input
            type="checkbox"
            checked={f.hideStale === true}
            onChange={() => apply(setFilter(f, 'hideStale', f.hideStale === true ? undefined : true))}
          />
          {COPY.filterHideStale}
        </label>
        <span className="flex flex-col">
          <label htmlFor="filter-unverified">{COPY.filterUnverified}</label>
          <select
            id="filter-unverified"
            className={field}
            disabled={calendarBasis}
            // why: core's filter takes a list; this control picks one constraint (a row matches if it is unverified there).
            value={f.unverified?.[0] ?? ''}
            onChange={(e) => {
              const name = apiContract.constraintNameSchema.safeParse(e.target.value);
              apply(setFilter(f, 'unverified', name.success ? [name.data] : undefined));
            }}
          >
            <option value="">{COPY.any}</option>
            {constraints.map((c) => (
              <option key={c} value={c}>
                {COPY.constraint[c]}
              </option>
            ))}
          </select>
        </span>
        <button type="submit" className="min-h-11 rounded border border-slate-500 px-3">
          {COPY.applyFilters}
        </button>
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={() => apply({})}
        >
          {COPY.clearFilters}
        </button>
        {calendarBasis ? <p className="w-full">{COPY.filtersDisabledCalendar}</p> : null}
      </form>
    </details>
  );
}
```

`src/views/Results/ResultsView.tsx` (new file; this task's version, Task 9.9 adds the basis switch and the calendar-gap banner):

```tsx
import { bandCheapest, filterRows, type SortKey, sortRows } from '@gmt/core';
import { useCallback, useMemo } from 'react';
import { useCalendarGap, useProviders, useResults } from '../../api/queries.js';
import type { CalendarGapResponse, DefinitionResponse, ResultsResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import {
  activeFilterCount,
  CLASSES,
  parseBasis,
  parseResultsState,
  parseSelectedRow,
  resultsStatePatch,
  SORT_KEYS,
  setFilter,
} from '../../state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { oneOf } from '../../state/withKey.js';
import { Filters } from './Filters.js';
import { ResultsHeader } from './ResultsHeader.js';
import { ResultsTable, SORT_LABEL } from './ResultsTable.js';

/** Spec §6.5: travel-time band width for bandCheapest. */
const BAND_HOURS = 6;
const SORT_VALUES = SORT_KEYS.flatMap((k) => [`${k}.asc`, `${k}.desc`]);
const isSortValue = oneOf(SORT_VALUES);

/** Narrow screens lose most sortable headers, so the sort is a select there (review UI-7). */
function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="flex flex-col text-sm">
      <label htmlFor="sort-select">{COPY.sortSelect}</label>
      <select
        id="sort-select"
        className="min-h-11 rounded border border-slate-400 px-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{COPY.serverOrder}</option>
        {SORT_KEYS.flatMap((k) =>
          (['asc', 'desc'] as const).map((d) => (
            <option key={`${k}.${d}`} value={`${k}.${d}`}>
              {COPY.sortOption(SORT_LABEL[k], COPY.sortDir[d])}
            </option>
          )),
        )}
      </select>
    </span>
  );
}

/**
 * Every provenance a Results page received: rows, their other sellers, the overall cheapest and the
 * calendar-gap prices. Any synthetic one raises the red banner, whatever /providers said (spec §5.5).
 */
function anySynthetic(data: ResultsResponse, gap: CalendarGapResponse | undefined): boolean {
  const rows = data.cheapest === null ? data.rows : [...data.rows, data.cheapest];
  const kinds = [
    ...rows.flatMap((r) => [r.provenance, ...r.otherOffers.map((o) => o.provenance)]),
    ...(gap === undefined
      ? []
      : [
          ...gap.cells.map((c) => c.calendar.provenance),
          ...(gap.cheapestVerified === null ? [] : [gap.cheapestVerified.provenance]),
        ]),
  ].map((p) => p.sourceKind);
  return kinds.includes('synthetic');
}

/** View A (spec §11): one fetch per basis; every sort and filter is core's pure function over that page. */
export function ResultsView({ definition }: { definition: DefinitionResponse }) {
  const params = useSearchParams();
  const basis = parseBasis(params.get('basis'));
  const ui = useMemo(() => parseResultsState(params), [params]);
  const results = useResults(definition.id, basis);
  const providers = useProviders();
  // why: the same cached query the calendar-gap banner reads; it only runs when a verification provider is configured.
  const gap = useCalendarGap(definition.id, results.data?.verificationProviderConfigured === true);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { filtered, rows, banded } = useMemo(() => {
    if (results.data === undefined) return { filtered: [], rows: [], banded: new Set<string>() };
    const kept = filterRows(results.data.rows, ui.filters);
    // why: band over the filtered set, so "cheapest in its band" means among the rows the operator is looking at.
    const marked = bandCheapest(kept, BAND_HOURS);
    return {
      filtered: kept,
      rows: ui.sort === null ? kept : sortRows(kept, ui.sort.key, ui.sort.dir),
      banded: marked,
    };
  }, [results.data, ui]);
  const setSort = useCallback((value: string) => {
    const current = parseResultsState(new URLSearchParams(window.location.search));
    const sort = isSortValue(value) ? parseResultsState(new URLSearchParams({ sort: value })).sort : null;
    updateSearchParams(resultsStatePatch({ ...current, sort }));
  }, []);
  const onSort = useCallback(
    (key: SortKey) => {
      const current = parseResultsState(new URLSearchParams(window.location.search));
      setSort(`${key}.${current.sort?.key === key && current.sort.dir === 'asc' ? 'desc' : 'asc'}`);
    },
    [setSort],
  );

  if (results.error) return <LoadError error={results.error} retry={() => void results.refetch()} />;
  if (results.data === undefined) return <Loading />;
  const data = results.data;
  const verificationConfigured = data.verificationProviderConfigured;
  const f = ui.filters;
  const failedHidden =
    f.verdictClass === undefined ? data.rows.filter((r) => r.verdictClass === 'failed').length : 0;
  const staleHidden = f.hideStale === true ? data.rows.filter((r) => r.stale).length : 0;
  const synthetic = providers.data?.synthetic !== true && anySynthetic(data, gap.data);
  const order =
    ui.sort === null ? COPY.serverOrder : COPY.sortOption(SORT_LABEL[ui.sort.key], COPY.sortDir[ui.sort.dir]);
  return (
    <div className="space-y-3">
      {synthetic ? <SyntheticBanner /> : null}
      <ViewHeader
        title={COPY.nav.results}
        executions={data.executions}
        stale={data.rows.length > 0 && data.rows.every((r) => r.stale)}
      />
      <ResultsHeader data={data} filteredFirst={filtered[0] ?? null} />
      <Filters state={ui} rows={data.rows} calendarBasis={data.basis === 'calendar'} narrow={narrow} />
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {narrow ? (
          <SortSelect value={ui.sort === null ? '' : `${ui.sort.key}.${ui.sort.dir}`} onChange={setSort} />
        ) : null}
        <span>{COPY.orderNow(order)}</span>
        {data.truncated && ui.sort !== null && ui.sort.key !== 'price' ? (
          <span>{COPY.sortedWithin(SORT_LABEL[ui.sort.key], data.rows.length, data.total)}</span>
        ) : null}
        {activeFilterCount(f) > 0 ? <span>{COPY.showingRows(filtered.length, data.rows.length)}</span> : null}
        {staleHidden > 0 ? <span>{COPY.staleHidden(staleHidden)}</span> : null}
        {failedHidden > 0 ? (
          <span className="flex items-center gap-1">
            {COPY.failedHidden(failedHidden)}
            <button
              type="button"
              className="min-h-11 rounded border border-slate-500 px-3"
              onClick={() =>
                updateSearchParams(
                  resultsStatePatch({ ...ui, filters: setFilter(f, 'verdictClass', [...CLASSES]) }),
                )
              }
            >
              {COPY.showFailed}
            </button>
          </span>
        ) : null}
      </div>
      {data.rows.length === 0 ? (
        <p>
          <a
            href={hrefWith({ view: 'coverage' })}
            onClick={navigateTo({ view: 'coverage' })}
            className="underline"
          >
            {COPY.noRowsFromRun}
          </a>
        </p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2">
          {COPY.noRowsAfterFilter}
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => updateSearchParams(resultsStatePatch({ ...ui, filters: {} }))}
          >
            {COPY.clearFilters}
          </button>
        </p>
      ) : (
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
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results test/copy`
Expected: PASS, 52 + 17 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: View A table, headline through PriceCell, filters incl. departure range"
```

### Task 9.9: Basis switch and the calendar-gap banner

**Files:**
- Create: `src/views/Results/BasisSwitch.tsx`, `src/views/Results/CalendarGapBanner.tsx`
- Modify: `src/views/Results/ResultsView.tsx` (final form below)
- Test: `test/views/results/basisAndGap.test.tsx`

**Interfaces:**
- Consumes: `useCalendarGap`, `useExecutionActions` (Task 9.3); `calendarGapResponseSchema` (with `truncated` on every price cell); `resultsResponse.verificationProviderConfigured`; `apiContract.resultBasisSchema`; `cellKeyString` (WP0); `LoadError` (Task 9.5).
- Produces: `BasisSwitch({ basis, reason })`, `CalendarGapBanner({ definitionId })`, final `ResultsView`.

The banner's lead is pluralised and says the calendar prices are unchecked against the constraints (review PFT-11); both prices render through `PriceCell`, a truncated tile's price says "cheapest of the rows read", and a failed request shows its error in the banner's place instead of looking like "no gap" (review prov-019). Without a verification provider the gap query is never run: the test settles the client and checks the query's update count is 0. The gap's prices carry no unconfirmed badge, and a comment in the banner says why: `cheapestVerified` is chosen from class-verified rows only and an unconfirmed price is never class verified (decision 37), while the cells are discovery prices with the calendar marker (review prov-wp09-r3-002).

- [ ] **Step 1: Write the failing test**

`test/views/results/basisAndGap.test.tsx`:

```tsx
import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { qk } from '../../../src/api/queries.js';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import {
  API,
  calendarGap,
  calendarRow,
  cell,
  definition,
  provCalendar,
  resultsResponse,
} from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

const calendarOnly = definition({
  providers: {
    discovery: ['travelpayouts'],
    verification: [],
    discoveryRefreshHours: { travelpayouts: 168 },
  },
});
const calendarResults = () =>
  resultsResponse({
    basis: 'calendar',
    basisReason: 'no verification provider configured',
    rows: [calendarRow()],
    verificationProviderConfigured: false,
  });

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
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())));
    renderWithProviders(<ResultsView definition={calendarOnly} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    const headline = screen.getByText('cheapest found').parentElement;
    if (headline === null) throw new Error('no headline');
    expect(headline).toHaveTextContent('£399');
    expect(
      within(headline).getByText(
        'EWR 2 Apr 2027–16 Apr 2027 (14n) · calendar basis · constraints not checked',
      ),
    ).toBeInTheDocument();
    expect(within(headline).getByText('Aviasales cache')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /itinerary search not configured$/ })).toBeInTheDocument();
    const L = CONSTRAINT_LABELS;
    expect(
      screen.getByText(`not applied: ${L.arrivalWindowLocal}, ${L.maxJourneyMinutes}, ${L.maxStops}`),
    ).toBeInTheDocument();
    expect(screen.getAllByText('onward leg not included').length).toBeGreaterThan(0);
  });
});

describe('calendar-gap banner (spec §11, §6.9)', () => {
  it('pluralised lead naming unchecked constraints, prices through PriceCell, per-cell verify', async () => {
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
    expect(
      within(banner).getByText(
        '1 cell has a calendar price (constraints not checked) below your cheapest verified',
      ),
    ).toBeInTheDocument();
    const prices = within(banner).getAllByTestId('price-cell');
    expect(prices.map((p) => p.firstElementChild?.firstChild?.textContent)).toEqual(['£412', '£399']);
    expect(within(banner).getByText("vendor's cache age unknown")).toBeInTheDocument();
    expect(within(banner).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(banner).getByText('Aviasales cache')).toBeInTheDocument();
    await user.click(
      within(banner).getByRole('button', { name: 'Search this cell for itineraries (uses billed calls)' }),
    );
    await expect
      .poll(() => verifies)
      .toEqual([
        {
          definitionId: 'def-0001',
          cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-04-02', returnDate: '2027-04-16' },
        },
      ]);
  });

  it('a truncated calendar cell says "cheapest of the rows read"; two cells pluralise', async () => {
    const more = {
      cell: cell('LGW', 'JFK', '2027-04-05', '2027-04-19', 14),
      calendar: { pricePence: 39000, provenance: provCalendar, stale: false, ageHours: 50, truncated: true },
      verifyAvailable: false,
    };
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ ...calendarGap(), cells: [...calendarGap().cells, more] }),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} />);
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    expect(
      within(banner).getByText(
        '2 cells have calendar prices (constraints not checked) below your cheapest verified',
      ),
    ).toBeInTheDocument();
    expect(within(banner).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(within(banner).getAllByRole('button', { name: /Search this cell/ })).toHaveLength(1);
  });

  it('a failed gap request says so in the banner place, never looks like "no gap" (review prov-019)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} />);
    expect(await screen.findByText('Could not load: boom')).toBeInTheDocument();
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
    const { client } = renderWithProviders(<ResultsView definition={calendarOnly} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.queryByRole('region', { name: 'Cells to search' })).toBeNull();
    // why: settle first, so a request the render fired late would be counted (review tsr2-002).
    await settled(client);
    expect(gapHits).toBe(0);
    expect(
      client.getQueryCache().find({ queryKey: qk.calendarGap(calendarOnly.id) })?.state.dataUpdateCount ?? 0,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results/basisAndGap.test.tsx`
Expected: FAIL: `Unable to find an element with the text: no verification provider configured` (the first test) and `Unable to find role="region" and name "Cells to search"` (the third).

- [ ] **Step 2b: Prove the "never requested" check bites**

After Step 3, temporarily pass `true` instead of `results.data?.verificationProviderConfigured === true` to `useCalendarGap` in `ResultsView`. Run the test: "is hidden, and never requested, without a verification provider" fails with `expected 1 to be 0` at `gapHits`, read after `settled(client)`. Restore the condition.

- [ ] **Step 3: Implement**

`src/views/Results/BasisSwitch.tsx` (new file):

```tsx
import { apiContract } from '@gmt/core';
import type { Basis } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { updateSearchParams } from '../../state/urlState.js';

/** Spec §6.9: the basis in use, why (the API's basisReason), and a one-click switch. */
export function BasisSwitch({ basis, reason }: { basis: Basis; reason: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm">
      <legend className="font-semibold">{COPY.basisSwitchLabel}</legend>
      {apiContract.resultBasisSchema.options.map((b) => (
        <label key={b} className="flex min-h-11 items-center gap-1">
          <input
            type="radio"
            name="basis"
            value={b}
            checked={basis === b}
            onChange={() => updateSearchParams({ basis: b }, 'push')}
          />
          {COPY.basisName[b]}
        </label>
      ))}
      <span className="text-slate-700">{reason}</span>
    </fieldset>
  );
}
```

`src/views/Results/CalendarGapBanner.tsx` (new file):

```tsx
import { cellKeyString } from '@gmt/core';
import { useCalendarGap, useExecutionActions } from '../../api/queries.js';
import { LoadError } from '../../components/LoadState.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';

/**
 * Spec §11: "N cells have calendar prices below your cheapest verified (£X)" with per-cell verify.
 * Rendered only when the results response says a verification provider is configured, so the
 * query never runs on the £0 configuration. Every price renders through PriceCell. A failed fetch
 * says so in the banner's place rather than looking like "no gap" (review prov-019).
 */
export function CalendarGapBanner({ definitionId }: { definitionId: string }) {
  const gap = useCalendarGap(definitionId, true);
  const actions = useExecutionActions();
  if (gap.error) return <LoadError error={gap.error} retry={() => void gap.refetch()} />;
  const data = gap.data;
  if (data === undefined || data.cells.length === 0 || data.cheapestVerified === null) return null;
  const cv = data.cheapestVerified;
  // why: no unconfirmed badge on these prices. cheapestVerified is chosen from class-verified rows only (WP8),
  // and a price the final step did not confirm is never class verified (decision 37); the calendar prices are
  // discovery prices, which carry the calendar marker instead. Should the selection rule change, the gap contract
  // must carry the unverified names and this PriceCell must pass `unconfirmed` (review prov-wp09-r3-002).
  return (
    <section
      aria-label={COPY.calendarGapList}
      className="rounded border border-amber-700 bg-amber-50 p-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span>{COPY.calendarGapLead(data.cells.length)}</span>
        <PriceBoundary>
          <PriceCell
            pricePence={cv.pricePence}
            provenance={cv.provenance}
            calendar={false}
            stale={cv.stale}
            truncated={cv.truncated}
            destination={cv.cell.destination}
          />
        </PriceBoundary>
      </div>
      <ul className="mt-1 space-y-1">
        {data.cells.map((c) => {
          const { nights, ...key } = c.cell;
          return (
            <li key={cellKeyString(key)} className="flex flex-wrap items-center gap-2">
              <span>
                {COPY.coverageCheckPair(c.cell.origin, c.cell.destination)}{' '}
                {COPY.dateRange(
                  formatIsoDate(c.cell.departureDate),
                  formatIsoDate(c.cell.returnDate),
                  nights,
                )}
              </span>
              <PriceBoundary>
                <PriceCell
                  pricePence={c.calendar.pricePence}
                  provenance={c.calendar.provenance}
                  calendar
                  stale={c.calendar.stale}
                  truncated={c.calendar.truncated}
                  destination={c.cell.destination}
                />
              </PriceBoundary>
              {c.verifyAvailable ? (
                <button
                  type="button"
                  className="min-h-11 rounded border border-slate-500 px-3"
                  onClick={() => actions.verify.mutate({ definitionId, cell: key })}
                >
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

`src/views/Results/ResultsView.tsx` — replace the file (final):

```tsx
import { bandCheapest, filterRows, type SortKey, sortRows } from '@gmt/core';
import { useCallback, useMemo } from 'react';
import { useCalendarGap, useProviders, useResults } from '../../api/queries.js';
import type { CalendarGapResponse, DefinitionResponse, ResultsResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import {
  activeFilterCount,
  CLASSES,
  parseBasis,
  parseResultsState,
  parseSelectedRow,
  resultsStatePatch,
  SORT_KEYS,
  setFilter,
} from '../../state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { oneOf } from '../../state/withKey.js';
import { BasisSwitch } from './BasisSwitch.js';
import { CalendarGapBanner } from './CalendarGapBanner.js';
import { Filters } from './Filters.js';
import { ResultsHeader } from './ResultsHeader.js';
import { ResultsTable, SORT_LABEL } from './ResultsTable.js';

/** Spec §6.5: travel-time band width for bandCheapest. */
const BAND_HOURS = 6;
const SORT_VALUES = SORT_KEYS.flatMap((k) => [`${k}.asc`, `${k}.desc`]);
const isSortValue = oneOf(SORT_VALUES);

/** Narrow screens lose most sortable headers, so the sort is a select there (review UI-7). */
function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="flex flex-col text-sm">
      <label htmlFor="sort-select">{COPY.sortSelect}</label>
      <select
        id="sort-select"
        className="min-h-11 rounded border border-slate-400 px-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{COPY.serverOrder}</option>
        {SORT_KEYS.flatMap((k) =>
          (['asc', 'desc'] as const).map((d) => (
            <option key={`${k}.${d}`} value={`${k}.${d}`}>
              {COPY.sortOption(SORT_LABEL[k], COPY.sortDir[d])}
            </option>
          )),
        )}
      </select>
    </span>
  );
}

/**
 * Every provenance a Results page received: rows, their other sellers, the overall cheapest and the
 * calendar-gap prices. Any synthetic one raises the red banner, whatever /providers said (spec §5.5).
 */
function anySynthetic(data: ResultsResponse, gap: CalendarGapResponse | undefined): boolean {
  const rows = data.cheapest === null ? data.rows : [...data.rows, data.cheapest];
  const kinds = [
    ...rows.flatMap((r) => [r.provenance, ...r.otherOffers.map((o) => o.provenance)]),
    ...(gap === undefined
      ? []
      : [
          ...gap.cells.map((c) => c.calendar.provenance),
          ...(gap.cheapestVerified === null ? [] : [gap.cheapestVerified.provenance]),
        ]),
  ].map((p) => p.sourceKind);
  return kinds.includes('synthetic');
}

/** View A (spec §11): one fetch per basis; every sort and filter is core's pure function over that page. */
export function ResultsView({ definition }: { definition: DefinitionResponse }) {
  const params = useSearchParams();
  const basis = parseBasis(params.get('basis'));
  const ui = useMemo(() => parseResultsState(params), [params]);
  const results = useResults(definition.id, basis);
  const providers = useProviders();
  // why: the same cached query the calendar-gap banner reads; it only runs when a verification provider is configured.
  const gap = useCalendarGap(definition.id, results.data?.verificationProviderConfigured === true);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { filtered, rows, banded } = useMemo(() => {
    if (results.data === undefined) return { filtered: [], rows: [], banded: new Set<string>() };
    const kept = filterRows(results.data.rows, ui.filters);
    // why: band over the filtered set, so "cheapest in its band" means among the rows the operator is looking at.
    const marked = bandCheapest(kept, BAND_HOURS);
    return {
      filtered: kept,
      rows: ui.sort === null ? kept : sortRows(kept, ui.sort.key, ui.sort.dir),
      banded: marked,
    };
  }, [results.data, ui]);
  const setSort = useCallback((value: string) => {
    const current = parseResultsState(new URLSearchParams(window.location.search));
    const sort = isSortValue(value) ? parseResultsState(new URLSearchParams({ sort: value })).sort : null;
    updateSearchParams(resultsStatePatch({ ...current, sort }));
  }, []);
  const onSort = useCallback(
    (key: SortKey) => {
      const current = parseResultsState(new URLSearchParams(window.location.search));
      setSort(`${key}.${current.sort?.key === key && current.sort.dir === 'asc' ? 'desc' : 'asc'}`);
    },
    [setSort],
  );

  if (results.error) return <LoadError error={results.error} retry={() => void results.refetch()} />;
  if (results.data === undefined) return <Loading />;
  const data = results.data;
  const verificationConfigured = data.verificationProviderConfigured;
  const f = ui.filters;
  const failedHidden =
    f.verdictClass === undefined ? data.rows.filter((r) => r.verdictClass === 'failed').length : 0;
  const staleHidden = f.hideStale === true ? data.rows.filter((r) => r.stale).length : 0;
  const synthetic = providers.data?.synthetic !== true && anySynthetic(data, gap.data);
  const order =
    ui.sort === null ? COPY.serverOrder : COPY.sortOption(SORT_LABEL[ui.sort.key], COPY.sortDir[ui.sort.dir]);
  return (
    <div className="space-y-3">
      {synthetic ? <SyntheticBanner /> : null}
      <ViewHeader
        title={COPY.nav.results}
        executions={data.executions}
        stale={data.rows.length > 0 && data.rows.every((r) => r.stale)}
      />
      <ResultsHeader data={data} filteredFirst={filtered[0] ?? null} />
      <BasisSwitch basis={data.basis} reason={data.basisReason} />
      {verificationConfigured ? <CalendarGapBanner definitionId={definition.id} /> : null}
      <Filters state={ui} rows={data.rows} calendarBasis={data.basis === 'calendar'} narrow={narrow} />
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {narrow ? (
          <SortSelect value={ui.sort === null ? '' : `${ui.sort.key}.${ui.sort.dir}`} onChange={setSort} />
        ) : null}
        <span>{COPY.orderNow(order)}</span>
        {data.truncated && ui.sort !== null && ui.sort.key !== 'price' ? (
          <span>{COPY.sortedWithin(SORT_LABEL[ui.sort.key], data.rows.length, data.total)}</span>
        ) : null}
        {activeFilterCount(f) > 0 ? <span>{COPY.showingRows(filtered.length, data.rows.length)}</span> : null}
        {staleHidden > 0 ? <span>{COPY.staleHidden(staleHidden)}</span> : null}
        {failedHidden > 0 ? (
          <span className="flex items-center gap-1">
            {COPY.failedHidden(failedHidden)}
            <button
              type="button"
              className="min-h-11 rounded border border-slate-500 px-3"
              onClick={() =>
                updateSearchParams(
                  resultsStatePatch({ ...ui, filters: setFilter(f, 'verdictClass', [...CLASSES]) }),
                )
              }
            >
              {COPY.showFailed}
            </button>
          </span>
        ) : null}
      </div>
      {data.rows.length === 0 ? (
        <p>
          <a
            href={hrefWith({ view: 'coverage' })}
            onClick={navigateTo({ view: 'coverage' })}
            className="underline"
          >
            {COPY.noRowsFromRun}
          </a>
        </p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2">
          {COPY.noRowsAfterFilter}
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => updateSearchParams(resultsStatePatch({ ...ui, filters: {} }))}
          >
            {COPY.clearFilters}
          </button>
        </p>
      ) : (
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
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/results test/copy`
Expected: PASS, 6 + 52 + 17 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: basis switch and calendar-gap banner with per-cell verify"
```

### Task 9.10: View D Coverage

**Files:**
- Create: `src/views/Coverage/CoverageView.tsx`
- Test: `test/views/coverage.test.tsx`

**Interfaces:**
- Consumes: `useCoverage`, `useExecution`, `useExecutionActions` (Task 9.3); `coverageResponseSchema`; `ViewHeader`, `HeaderRun` (Task 9.6); `Loading`, `LoadError` (Task 9.5); `useNow`, `BucketName` (Task 9.1); `DEFAULT_DISCOVERY_REFRESH_HOURS` (core).
- Produces: `CoverageView({ definition })`.

Decisions. **"Searched" keeps the spec's definition** (priced + no fares + no cached data, computed here, never taken on trust) and **"with a price"** (priced of every cell) sits beside it, so 40 cells of "no cached data" cannot read as coverage (decision 36, review PFT-10). **A legend defines every bucket**, saying that "not searched" is not "no fares" and that "no cached data" is "asked, nothing returned" (review UI-6). **The header names the run these counts come from** (`coverage.executionId`), with its own status and age from `GET /api/executions/:id`, and is stale when that run is older than the definition's quickest discovery refresh interval, with core's `DEFAULT_DISCOVERY_REFRESH_HOURS` only for a provider that names none (reviews prov-011, po-013, arch-r2-005, prov-r2-012). The six buckets are typed from core's `Buckets` (decision 46). The "priced" legend says an itinerary-search price may be one the final step did not confirm (decision 48); View D shows counts, never a blank price. The table sits in a labelled region without `tabIndex` that scrolls sideways at 375px (decision 46: no suppression comment; browsers make a scrollable box keyboard-focusable themselves); with no run there is an empty state.

- [ ] **Step 1: Write the failing test**

`test/views/coverage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { CoverageView } from '../../src/views/Coverage/CoverageView.js';
import { API, coverageResponse, definition, execution } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

const rowTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.firstChild?.textContent ?? ''));

function withStage(patch: Partial<ReturnType<typeof coverageResponse>['perStage'][number]>) {
  const base = coverageResponse();
  const [first, ...rest] = base.perStage;
  if (first === undefined) throw new Error('fixture');
  return { ...base, perStage: [{ ...first, ...patch }, ...rest] };
}

const render = () => renderWithProviders(<CoverageView definition={definition()} />);

describe('View D (spec §11, §6.6)', () => {
  it('counts per stage × provider in the six buckets, with cells, "searched", "with a price" and estimate vs ledger', async () => {
    render();
    const table = await screen.findByRole('table', { name: 'Coverage' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Stage',
      'Provider',
      'priced',
      'no fares',
      'no cached data',
      'error',
      'skipped',
      'not searched',
      'cells',
      'searched (priced + no fares + no cached data)',
      'with a price',
      'Requests (estimate vs ledger)',
    ]);
    expect(rowTexts(table)).toEqual([
      [
        'discovery',
        'Travelpayouts',
        '60',
        '10',
        '40',
        '6',
        '0',
        '10',
        '126',
        '110',
        '60 of 126',
        '14 of 14 planned calls · 0 cache hits · ledger cost £0, from configured rates',
      ],
      [
        'itinerary search',
        'SearchApi',
        '8',
        '1',
        '0',
        '1',
        '116',
        '0',
        '126',
        '9',
        '8 of 126',
        '50 of 50 planned calls · 0 cache hits · ledger cost £0, from configured rates',
      ],
    ]);
  });

  it('the table scrolls sideways in a labelled region, and a legend defines every bucket (review UI-6)', async () => {
    render();
    const region = await screen.findByRole('region', {
      name: 'Coverage counts (scrolls sideways on a narrow screen)',
    });
    // why: decision 46: a labelled region without tabIndex; the browser makes the scroll box focusable itself.
    expect(region).not.toHaveAttribute('tabindex');
    expect(region.className).toContain('overflow-x-auto');
    const legend = screen.getByRole('list', { name: 'What the columns mean' });
    expect(
      within(legend).getByText('not searched: not asked yet. Different from no fares: nobody has looked.'),
    ).toBeInTheDocument();
    expect(
      within(legend).getByText(
        'no cached data: asked, nothing returned; this is not evidence that no flights exist.',
      ),
    ).toBeInTheDocument();
  });

  it('the header names the run these counts come from, with its own status and age', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(execution({ status: 'running', startedAt: '2026-10-14T14:00:00.000Z' })),
      ),
    );
    render();
    expect(
      await screen.findByText('showing run started 14 Oct 2026 14:00 UTC (running, 1h ago)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The latest run is running; these results may be partial.',
    );
  });

  it('a run older than the refresh cycle is labelled stale', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'completed',
            startedAt: '2026-10-01T00:00:00.000Z',
            finishedAt: '2026-10-01T01:00:00.000Z',
          }),
        ),
      ),
    );
    render();
    expect(await screen.findByText('Every row here is older than one refresh cycle.')).toBeInTheDocument();
  });

  it('View D sums: six buckets that do not add up to the cell count are flagged, never hidden', async () => {
    const first = coverageResponse().perStage[0];
    if (first === undefined) throw new Error('fixture');
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(withStage({ buckets: { ...first.buckets, not_run: 9 } })),
      ),
    );
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('buckets sum to 125, not 126; report this');
  });

  it('no sum alert when the six buckets add up', async () => {
    render();
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByText(/buckets sum to/)).toBeNull();
  });

  it('an empty state when no run exists yet', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(coverageResponse({ perStage: [], selectedNotReached: [], errors: [] })),
      ),
    );
    render();
    expect(await screen.findByText('No run yet, so nothing has been searched.')).toBeInTheDocument();
    expect(screen.getByText('Every selected cell was reached.')).toBeInTheDocument();
    expect(screen.getByText('No errors.')).toBeInTheDocument();
  });

  it('maps both selected-but-not-reached reasons to words', async () => {
    const base = coverageResponse();
    const first = base.selectedNotReached[0];
    if (first === undefined) throw new Error('fixture');
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({
          ...base,
          selectedNotReached: [
            first,
            { ...first, cell: { ...first.cell, departureDate: '2027-03-22' }, reason: 'not_run' },
          ],
        }),
      ),
    );
    render();
    const list = await screen.findByRole('list', { name: 'Selected but not reached' });
    expect(within(list).getByText('LHR → JFK 22 Mar 2027 to 1 Apr 2027: not run')).toBeInTheDocument();
    expect(
      within(list).getByText('LHR → JFK 20 Mar 2027 to 1 Apr 2027: skipped: budget'),
    ).toBeInTheDocument();
  });

  it('overrun and parity flags appear on their stage row only when set; reused cells are noted', async () => {
    const { unmount } = render();
    await screen.findByRole('table', { name: 'Coverage' });
    expect(screen.queryByText(/Overrun/)).toBeNull();
    expect(screen.queryByText(/Parity break/)).toBeNull();
    unmount();
    const flagged = withStage({ overrun: true, parityBreak: true });
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({ ...flagged, summary: { ...flagged.summary, reused: 4 } }),
      ),
    );
    render();
    expect(
      await screen.findByText('Overrun: ledger calls exceed the plan by more than 10%.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Parity break: tile requests differ from the plan.')).toBeInTheDocument();
    expect(screen.getByText('(4 reused from earlier runs)')).toBeInTheDocument();
  });

  it('lists errors and retries the retryable ones through POST /api/executions/:id/resume', async () => {
    const resumed: string[] = [];
    server.use(
      http.post(`${API}/executions/:id/resume`, ({ params }) => {
        resumed.push(String(params.id));
        return HttpResponse.json(execution());
      }),
    );
    const { user } = render();
    const errors = await screen.findByRole('list', { name: 'Errors' });
    expect(within(errors).getByRole('listitem')).toHaveTextContent(
      'LGW → EWR 21 Mar 2027 to 2 Apr 2027: rate-limit after 3 attempts (HTTP 429)',
    );
    await user.click(screen.getByRole('button', { name: 'Retry errors' }));
    await expect.poll(() => resumed).toEqual(['exec-0001']);
  });

  it('no Retry button when no error is retryable', async () => {
    const base = coverageResponse();
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({
          ...base,
          errors: base.errors.map((e) => ({ ...e, retryable: false, lastError: null })),
        }),
      ),
    );
    render();
    await screen.findByRole('list', { name: 'Errors' });
    expect(screen.queryByRole('button', { name: 'Retry errors' })).toBeNull();
  });

  it('a failed load shows the reason and a retry', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/coverage.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/Coverage/CoverageView.js"`.

- [ ] **Step 3: Implement**

`src/views/Coverage/CoverageView.tsx` (new file; the sum-mismatch alert sits in the requests cell so every row keeps its column count):

```tsx
import { type CellKey, DEFAULT_DISCOVERY_REFRESH_HOURS, type IsoDateTime } from '@gmt/core';
import { useCoverage, useExecution, useExecutionActions } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { type HeaderRun, ViewHeader } from '../../components/ViewHeader.js';
import { type BucketName, COPY } from '../../copy.js';
import { formatIsoDate, formatMicroGbp } from '../../format.js';
import { useNow } from '../../now.js';

/** Spec §3 / §6.6: the six buckets, which sum to the cell count. */
const BUCKETS = [
  'priced',
  'empty',
  'no_data',
  'error',
  'skipped',
  'not_run',
] as const satisfies readonly BucketName[];

const cellText = (c: CellKey) =>
  COPY.cellLabel(c.origin, c.destination, formatIsoDate(c.departureDate), formatIsoDate(c.returnDate));
/** The two reasons the contract allows (`'not_run' | 'skipped:budget'`), each in words. */
const reasonText = (r: 'not_run' | 'skipped:budget') =>
  r === 'skipped:budget' ? COPY.reasonBudget : COPY.reasonNotRun;
const hoursSince = (at: IsoDateTime, now: IsoDateTime) =>
  Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / 3_600_000));

/**
 * View D (spec §11): per stage × provider counts, estimate vs ledger, selected-not-reached, flags,
 * errors with retry. The header names the run these counts come from (coverage.executionId) with
 * its own status and age, never the results response's list (review prov-011).
 */
export function CoverageView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const coverage = useCoverage(definition.id);
  const run = useExecution(coverage.data?.executionId ?? null);
  const actions = useExecutionActions();
  if (coverage.error) return <LoadError error={coverage.error} retry={() => void coverage.refetch()} />;
  if (coverage.data === undefined) return <Loading />;
  const c = coverage.data;
  const r = run.data;
  const at = r ? (r.finishedAt ?? r.startedAt) : null;
  const header: HeaderRun[] =
    r === undefined
      ? []
      : [
          {
            id: r.id,
            status: r.status,
            isChild: r.isChild,
            startedAt: r.startedAt,
            ageHours: at === null ? 'unknown' : hoursSince(at, now),
          },
        ];
  // why: stale means older than one refresh cycle of the definition's quickest-refreshing discovery provider;
  // core's default stands in only for a provider that names no interval, or when there is no discovery provider.
  const intervals = definition.providers.discovery.map(
    (p) => definition.providers.discoveryRefreshHours[p] ?? DEFAULT_DISCOVERY_REFRESH_HOURS,
  );
  const refresh = intervals.length === 0 ? DEFAULT_DISCOVERY_REFRESH_HOURS : Math.min(...intervals);
  const stale = header[0] !== undefined && header[0].ageHours !== 'unknown' && header[0].ageHours > refresh;
  const retryable = c.errors.some((e) => e.retryable);
  return (
    <div className="space-y-4">
      <ViewHeader title={COPY.coverageHeading} executions={header} stale={stale} />
      {c.perStage.length === 0 ? (
        <p>{COPY.coverageEmpty}</p>
      ) : (
        // why: a labelled region without tabIndex (decision 46); browsers make a scrollable overflow box keyboard-focusable themselves.
        <section aria-label={COPY.coverageScroll} className="overflow-x-auto">
          <table aria-label={COPY.coverageHeading} className="border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageStage}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageProvider}
                </th>
                {BUCKETS.map((b) => (
                  <th key={b} scope="col" className="p-1 text-right">
                    {COPY.bucket[b]}
                  </th>
                ))}
                <th scope="col" className="p-1 text-right">
                  {COPY.coverageCells}
                </th>
                <th scope="col" className="border-l border-slate-400 p-1 text-right">
                  {COPY.coverageSearched}
                </th>
                <th scope="col" className="p-1 text-right">
                  {COPY.coverageWithPrice}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.requestsHeading}
                </th>
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
                    <th scope="row" className="p-1 text-left font-normal">
                      {COPY.stageName[s.stage]}
                    </th>
                    <td className="p-1">{COPY.provider[s.providerId]}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className="p-1 text-right tabular-nums">
                        {s.buckets[b]}
                      </td>
                    ))}
                    <td className="p-1 text-right tabular-nums">{s.total}</td>
                    <td className="border-l border-slate-400 p-1 text-right tabular-nums">{searched}</td>
                    <td className="p-1 text-right tabular-nums">
                      {COPY.withPriceValue(s.buckets.priced, s.total)}
                    </td>
                    <td className="p-1" data-cost="">
                      {COPY.requestRow(
                        s.requests.calls,
                        planned,
                        s.requests.cacheHits,
                        formatMicroGbp(s.requests.costMicroGbp),
                      )}
                      {s.overrun ? <p className="font-semibold">{COPY.overrunFlag}</p> : null}
                      {s.parityBreak ? <p className="font-semibold">{COPY.parityFlag}</p> : null}
                      {sum !== s.total ? (
                        <p role="alert" className="font-semibold text-red-800">
                          {COPY.sumMismatch(sum, s.total)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {c.summary.reused > 0 ? <p className="text-sm">{COPY.reusedNote(c.summary.reused)}</p> : null}
      <div className="text-sm">
        <h3 className="font-semibold">{COPY.coverageLegend}</h3>
        <ul aria-label={COPY.coverageLegend}>
          {BUCKETS.map((b) => (
            <li key={b}>{COPY.bucketHelp[b]}</li>
          ))}
          <li>{COPY.searchedHelp}</li>
          <li>{COPY.withPriceHelp}</li>
        </ul>
      </div>
      <div>
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
      </div>
      <div>
        <h3 className="font-semibold">{COPY.errorsHeading}</h3>
        {c.errors.length === 0 ? (
          <p className="text-sm">{COPY.noErrors}</p>
        ) : (
          <ul aria-label={COPY.errorsHeading} className="text-sm">
            {c.errors.map((e) => (
              <li
                key={`${e.stage}${e.providerId}${e.cell.origin}${e.cell.destination}${e.cell.departureDate}${e.cell.returnDate}`}
              >
                {cellText(e.cell)}: {COPY.errorRow(e.reason, e.attempts)}
                {e.lastError !== null ? ` ${COPY.lastError(e.lastError)}` : null}
              </li>
            ))}
          </ul>
        )}
        {retryable ? (
          <button
            type="button"
            className="mt-1 min-h-11 rounded border border-slate-500 px-3"
            onClick={() => actions.resume.mutate(c.executionId)}
          >
            {COPY.retry}
          </button>
        ) : null}
        {actions.resume.error ? <p role="alert">{COPY.actionFailed(actions.resume.error.message)}</p> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/coverage.test.tsx test/copy`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: View D with six buckets, searched and with-a-price, legend, run header"
```

### Task 9.11: Providers view

**Files:**
- Create: `src/views/Providers/ProvidersView.tsx`
- Test: `test/views/providers.test.tsx`

**Interfaces:**
- Consumes: `useProviders` (Task 9.3); `providersResponseSchema`; `formatDuration`, `CapabilityInfo` (WP0); `Loading`, `LoadError` (Task 9.5).
- Produces: `ProvidersView()`.

The plan id is shown in words (review po-013). A SearchApi itinerary capability reads "provider age unknown" (spec rev 15, decision 24); a capability that declares 0 reads "provider states no age beyond the fetch time". Only a `provider-lifetime:` scope reads as a lifetime allowance; any other row without window bounds states no window (review prov-020).

- [ ] **Step 1: Write the failing test**

`test/views/providers.test.tsx`:

```tsx
import { formatDuration } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ProvidersView } from '../../src/views/Providers/ProvidersView.js';
import { API, providersResponse, usage } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

type Entry = ReturnType<typeof providersResponse>['providers'][number];
function withSearchApi(patch: Partial<Entry>) {
  const base = providersResponse();
  return {
    ...base,
    providers: base.providers.map((p) => (p.providerId === 'searchapi' ? { ...p, ...patch } : p)),
  };
}

describe('Providers view (spec §10, §11)', () => {
  it('shows capabilities in words, the plan in words, and usage vs caps with window bounds', async () => {
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByText('plan: SearchApi $40 a month')).toBeInTheDocument();
    expect(
      within(searchapi).getByText(
        `Discovery: Google date grid via SearchApi · prices up to ${formatDuration(24)} old when fetched`,
      ),
    ).toBeInTheDocument();
    expect(
      within(searchapi).getByText('Itinerary search: Google Flights via SearchApi · provider age unknown'),
    ).toBeInTheDocument();
    expect(
      within(searchapi).getByText('615 of 10000 calls · window 1 Oct 2026 to 1 Nov 2026'),
    ).toBeInTheDocument();
    const tp = screen.getByRole('region', { name: 'Travelpayouts' });
    expect(
      within(tp).getByText(
        `Discovery: Aviasales cache · prices up to ${formatDuration(48)} old when fetched`,
      ),
    ).toBeInTheDocument();
    expect(within(tp).getByText('Aviasales cache of recent user searches')).toBeInTheDocument();
    expect(within(tp).getByText('plan: free')).toBeInTheDocument();
    expect(formatDuration(48)).toBe('2d'); // canary for the format
  });

  it("shows each provider's notices (the zero-cap message) and marks unconfigured providers", async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({ enabled: false, notices: ['verification will not run: spend cap is 0'] }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByRole('alert')).toHaveTextContent(
      'verification will not run: spend cap is 0',
    );
    expect(within(searchapi).getByText('not configured')).toBeInTheDocument();
  });

  it('only a provider-lifetime scope reads as lifetime; a row without bounds states no window (review prov-020)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({
            plan: 'trial',
            excludedFromSchedule: true,
            usage: [usage('provider-lifetime:searchapi', 9, 100), usage('provider-month:searchapi', 9, null)],
          }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(await screen.findByText("9 of 100 calls over the plan's lifetime")).toBeInTheDocument();
    expect(screen.getByText('9 of no cap calls')).toBeInTheDocument();
    expect(screen.getByText('plan: SearchApi trial credits (lifetime allowance)')).toBeInTheDocument();
    expect(screen.getByText('excluded from scheduled runs')).toBeInTheDocument();
  });

  it('a provider that declares no age beyond the fetch says exactly that', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({
            capabilities: {
              discovery: null,
              verification: { sourceKind: 'scraped-search', provenanceNote: 'x', maxAgeHours: 0 },
            },
          }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(
      await screen.findByText(
        'Itinerary search: Google Flights via SearchApi · provider states no age beyond the fetch time',
      ),
    ).toBeInTheDocument();
  });

  it('a failed load shows the reason and a retry', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/providers.test.tsx`
Expected: FAIL with `Failed to resolve import "../../src/views/Providers/ProvidersView.js"`.

- [ ] **Step 3: Implement**

`src/views/Providers/ProvidersView.tsx` (new file):

```tsx
import { type CapabilityInfo, formatDuration } from '@gmt/core';
import { useProviders } from '../../api/queries.js';
import type { UsageRow } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';

function maxAgeText(h: CapabilityInfo['maxAgeHours']): string {
  if (h === 'unknown') return COPY.maxAgeUnknown;
  return h === 0 ? COPY.maxAgeAtFetch : COPY.maxAge(formatDuration(h));
}

function Capability({ title, info }: { title: string; info: CapabilityInfo }) {
  return (
    <div>
      <p>{COPY.capability(title, COPY.source[info.sourceKind], maxAgeText(info.maxAgeHours))}</p>
      <p className="text-slate-700">{info.provenanceNote}</p>
    </div>
  );
}

/** Only a `provider-lifetime:` scope is a lifetime allowance; any other row without bounds states no window (review prov-020). */
function usageText(u: UsageRow): string {
  const cap = u.cap === null ? COPY.noCap : String(u.cap);
  if (u.scope.startsWith('provider-lifetime:')) return COPY.usageLifetime(u.calls, cap);
  if (u.windowStart === null || u.windowEnd === null) return COPY.usageNoWindow(u.calls, cap);
  return COPY.usageWindow(
    u.calls,
    cap,
    formatIsoDate(u.windowStart.slice(0, 10)),
    formatIsoDate(u.windowEnd.slice(0, 10)),
  );
}

/**
 * Spec §11 Providers: capabilities, plan in words, usage vs caps with window bounds, and the API's
 * notices (the zero-cap message). It shows configuration, not a run, so it has no run header; the
 * status bar names the run on this view too.
 */
export function ProvidersView() {
  const q = useProviders();
  if (q.error) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  if (q.data === undefined) return <Loading />;
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-xl font-semibold">{COPY.providersHeading}</h2>
      {q.data.providers.map((p) => (
        <section
          key={p.providerId}
          aria-label={p.displayName}
          className="rounded border border-slate-300 p-2"
        >
          <h3 className="font-semibold">
            {p.displayName}{' '}
            <span className="font-normal">{p.enabled ? COPY.providerEnabled : COPY.providerDisabled}</span>
          </h3>
          {p.notices.map((n) => (
            <p key={n} role="alert" className="rounded border border-red-700 p-1 font-medium">
              {n}
            </p>
          ))}
          <p>{COPY.plan(COPY.planName[p.plan])}</p>
          {p.excludedFromSchedule ? <p>{COPY.excludedFromSchedule}</p> : null}
          {p.capabilities.discovery !== null ? (
            <Capability title={COPY.capabilityDiscovery} info={p.capabilities.discovery} />
          ) : null}
          {p.capabilities.verification !== null ? (
            <Capability title={COPY.capabilityVerification} info={p.capabilities.verification} />
          ) : null}
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
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: Providers view with plan words, capability ages and usage windows"
```

### Task 9.12: Definitions form: airports, defaults, money in pounds, advanced fold, example import; the place-name check

**Files:**
- Create: `src/example.ts`, `src/views/Definitions/draft.ts`, `src/views/Definitions/fields.tsx`, `src/views/Definitions/AirportListInput.tsx`, `src/views/Definitions/AdvancedFields.tsx`, `src/views/Definitions/CoverageCheck.tsx`, `src/views/Definitions/EstimatePanel.tsx`, `src/views/Definitions/Confirmation.tsx`, `src/views/Definitions/DefinitionForm.tsx`; `scripts/vitest.config.mjs`
- Create (stand-in, owned by WP12): `docs/examples/london-new-york.json`, only if it does not exist yet; WP12 overwrites it and asserts the import still resolves.
- Modify: `scripts/check-boundaries.mjs`; the root `vitest.config.ts` (the `scripts` project); `packages/core/test/dates/epochDay.test.ts`, `packages/core/test/space/validate.test.ts`, `packages/db/test/enums.test.ts`, `packages/db/test/barrel.test.ts`, `packages/db/test/client.test.ts` (their `@ts-expect-error` comments, decision 49)
- Test: `test/views/definitions/form.test.tsx`, `scripts/check-boundaries.test.mjs`

**Interfaces:**
- Consumes: `api`, `useAirportSearch`, `ApiError`, `FieldError`, `DefinitionBody`, `CoverageCheckBody` (Task 9.3); `withKey` (Task 9.4); `providersResponse.presets`; `apiContract.definitionCreateRequestSchema` (parses the example), `cabinSchema`; `resolveWindow`, `londonDateOf`; 422 `details.fields`; `coverageCheckResponseSchema` with `cachedRows: number | null` (WP7 Task 7.18).
- Produces: `EXAMPLE_DEFINITION`, `EXAMPLE_LABEL`, `Draft`, `DraftWindow`, `DEFAULT_RELATIVE`, `EMPTY_ABSOLUTE`, `defaultDraft`, `definitionToDraft`, `draftToRequest`, `applyExample`, `normaliseIata`, `AIRPORT_DEBOUNCE_MS`, `AirportListInput`, `AdvancedFields`, and in `fields.tsx` the shared primitives `FieldErrors`, `NumberField`, `PoundsField`, `TimeWindowField`, `AirlinesField`, `Check` (review arch-r2-008), `CoverageCheck`, `EstimatePanel`, `BudgetFitPanel`, `CreateConfirmation`, `Reconfirmation` (in `Confirmation.tsx`, out of the form, review arch-r3-005), `DefinitionForm({ existing, providers })`. Task 9.13 tests the coverage-check, estimate, create and confirmation flows through `DefinitionsView`.

Decisions. **The draft is the create schema's input type** (plain strings), sent as is; the API's parse is the validator, so the form mints no brand and casts nothing (review arch-004). **`enabled` is carried** through the draft and shown as a checkbox, so saving an edit never re-enables a stopped definition (review po-011). **The field primitives live in `fields.tsx`**, used by the form and its fold; `PoundsField` and `AirlinesField` follow their values through `useSynced`, and `AirlinesField` parses with `parseCarriers`, showing entries that are not codes as ignored (review arch-r2-009). **The time-window boxes follow the draft** when it changes elsewhere, so Import example shows its 06:00–23:00 arrival window and the form never sends a window it does not show (review arch-r3-004). **Money is entered in pounds everywhere**, converted exactly to pence (and to micro-GBP for the run budget's cost cap through `PENCE_TO_MICRO`), and every micro-GBP figure shown or confirmed is core's `microGbpToPence`, which rounds up (decision 49; review arch-r3-001) (price ceiling, maximum cost per run, the maximum-price constraint, onward cost) and sent as integer pence; the journey limit shows its minutes as hours beside the field (reviews po-012, PFT-09). **Airports**: a three-letter code is upper-cased on blur, other text only trimmed; Enter adds without a blur; a duplicate is refused; a metro code the airports table maps (its rows carry `metro`) expands to its member airports on Enter or Add, asking the table directly when the autocomplete has not answered yet, and says so (decision 44, reviews PFT-07, tsr2-005); the autocomplete test steps the debounce on fake timers (review tsr2-009); the API's field errors appear under the field they name, linked with `aria-describedby` and `aria-invalid`, and in a summary (review tsr-013); chip remove buttons are 44 px; the native datalist is the accepted autocomplete for now. **Window**: the relative fields show the dates they resolve to today, and switching mode keeps the other mode's values: the form holds the inactive window in its own state and restores it on toggle (review PFT-08; pinned by "switching the window mode keeps the other mode values"). **The coverage check** shows "cells with a price of cells in your nights range" per pair and month; a month the check could not read (`cachedRows: null`, decision 25) or that a pair's response omits is "not checked", in distinct styling, never 0 (reviews po-001, prov-002, UI-1, PFT-06, prov-021); its call count is labelled as tile requests (decision 37); a result made for other airports or dates is marked out of date. **Estimate before the confirmation**: the estimate ("about 154 calls (hard stop 2000), £0.02 per run", the hard stop being the run budget's call cap, decision 44) and every budget scope (fit or not) render above the create button, "Create and confirm about 154 calls (hard stop 2000), £0.02 per run"; the click sends `confirmedCostPence` and `confirmedCalls` (decisions 42, 43); a re-confirmation states and sends the contract's `needsConfirmation.totalCalls` with the pence; editing after an estimate replaces the button with "show the estimate again" (review UI-11). **The example**: `src/example.ts` is the one web file that may name the example's places, and the import button reads its label from there (decision 36); `scripts/check-boundaries.mjs` now fails on an airport code or a metro city name in a string literal, template text or JSX text of `apps/web/src` or `apps/api/src` outside the two allowlisted files (comments and identifiers are not read, so words like ISO and ALL never collide), with a committed list of non-airport words later packages extend in their own diffs; and, as the one suppression check, on a `biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` comment in any package's `src` or `test` (decisions 46, 49). `scripts/check-boundaries.test.mjs`, under the root Vitest project `scripts`, runs the script against scratch trees with planted files (reviews tsr2-012, arch-r3-006).

- [ ] **Step 1: Write the failing test**

`test/views/definitions/form.test.tsx`:

```tsx
import { CONSTRAINT_LABELS } from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_LABEL } from '../../../src/example.js';
import { AIRPORT_DEBOUNCE_MS } from '../../../src/views/Definitions/AirportListInput.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import {
  defaultDraft,
  definitionToDraft,
  draftToRequest,
  normaliseIata,
} from '../../../src/views/Definitions/draft.js';
import { API, airports, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

afterEach(() => vi.useRealTimers());

const renderForm = (existing: ReturnType<typeof definition> | null = null) =>
  renderWithProviders(<DefinitionForm existing={existing} providers={providersResponse()} />);
/** The current value of a labelled control, read without a cast. */
function fieldValue(label: string): string {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement))
    throw new Error(`${label} is not an input`);
  return el.value;
}
/** The chip list inside the Origins or Destinations group. */
const chips = (name: string) => within(screen.getByRole('group', { name })).getByRole('list');
const chipCodes = (name: string) =>
  within(chips(name))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);

function estimateBodies() {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
    }),
  );
  return bodies;
}

describe('Definitions form defaults (spec §11)', () => {
  it('starts with empty airports and the spec defaults; the plan preset fills providers, policy and budget', async () => {
    const { user } = renderForm();
    expect(chipCodes('Origins')).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Relative to today' })).toBeChecked();
    expect(fieldValue('Starts in (days)')).toBe('7');
    expect(fieldValue('Length (days)')).toBe('182');
    expect(
      screen.getByText('departures from 21 Oct 2026 to 20 Apr 2027, as resolved today'),
    ).toBeInTheDocument();
    expect(fieldValue('Min nights')).toBe('10');
    expect(fieldValue('Max nights')).toBe('21');
    expect(fieldValue('Cabin')).toBe('economy');
    await user.click(screen.getByText('Advanced: constraints and policy'));
    expect(fieldValue(CONSTRAINT_LABELS.maxJourneyMinutes)).toBe('1500');
    expect(screen.getByText('= 25h 00m')).toBeInTheDocument();
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} from`)).toBe('06:00');
    expect(fieldValue(`${CONSTRAINT_LABELS.arrivalWindowLocal} to`)).toBe('23:00');
    expect(fieldValue('Max cells per run')).toBe('10');
    expect(fieldValue('Top N by discovery price')).toBe('10');
    expect(fieldValue('Outbounds expanded per cell')).toBe('2');
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fetch booking options' })).toBeDisabled();
    expect(
      screen.getByText('Always on for SearchApi: its sellers can undercut the airline fare.'),
    ).toBeInTheDocument();
    expect(fieldValue('Max billed calls per run')).toBe('2000');
    expect(fieldValue('Max cost per run in £')).toBe('0');
    expect(fieldValue('Travelpayouts refresh interval (hours)')).toBe('168');
    expect(fieldValue('Cron (blank: manual runs only)')).toBe('0 5 * * 1');
    expect(fieldValue('Time zone')).toBe('Europe/London');
    expect(screen.getByRole('checkbox', { name: 'Enabled: scheduled runs happen' })).toBeChecked();
  });

  it('defaultDraft and draftToRequest carry the spec values; the request never carries a confirmation', () => {
    const req = draftToRequest(defaultDraft(providersResponse().presets));
    expect(req).toMatchObject({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
      scheduleCron: '0 5 * * 1',
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] },
      enabled: true,
    });
    expect(req).not.toHaveProperty('confirmedCostPence');
  });

  it('every money field takes pounds and sends integer pence (review po-012)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'LHR{Enter}');
    await user.type(screen.getByLabelText('Destinations'), 'JFK{Enter}');
    await user.click(screen.getByText('Advanced: constraints and policy'));
    await user.type(screen.getByLabelText(`${CONSTRAINT_LABELS.maxPricePence} (£)`), '480');
    await user.type(screen.getByLabelText('Price ceiling in £ (optional)'), '500.50');
    await user.clear(screen.getByLabelText('Max cost per run in £'));
    await user.type(screen.getByLabelText('Max cost per run in £'), '2');
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({
      constraints: { maxPricePence: 48000 },
      verification: { priceCeilingPence: 50050 },
      budget: { maxCostMicroGbp: 2_000_000 },
    });
  });

  it('airline constraints parse like the carriers filter: codes kept, other entries shown as ignored (review arch-r2-009)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    await user.type(screen.getByLabelText(CONSTRAINT_LABELS.includeAirlines), 'zz, British');
    await user.tab();
    expect(screen.getByText('ignored, not two-character carrier codes: BRITISH')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ constraints: { includeAirlines: ['ZZ'] } });
  });

  it('switching the window mode keeps the other mode values (review PFT-08)', async () => {
    const { user } = renderForm();
    await user.clear(screen.getByLabelText('Starts in (days)'));
    await user.type(screen.getByLabelText('Starts in (days)'), '14');
    await user.click(screen.getByRole('radio', { name: 'Fixed dates' }));
    await user.type(screen.getByLabelText('From'), '2027-04-01');
    await user.click(screen.getByRole('radio', { name: 'Relative to today' }));
    expect(fieldValue('Starts in (days)')).toBe('14');
    await user.click(screen.getByRole('radio', { name: 'Fixed dates' }));
    expect(fieldValue('From')).toBe('2027-04-01');
  });

  it('editing a disabled definition keeps it disabled (review po-011)', async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/definitions/:id`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(definition({ enabled: false }));
      }),
    );
    expect(definitionToDraft(definition({ enabled: false })).enabled).toBe(false);
    const { user } = renderForm(definition({ enabled: false }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toMatchObject({ enabled: false });
  });
});

describe('airport entry (review focus 1)', () => {
  it('upper-cases a three-letter code on blur, and only a three-letter code', async () => {
    expect([normaliseIata(' lhr '), normaliseIata('London'), normaliseIata('lhrx')]).toEqual([
      'LHR',
      'London',
      'lhrx',
    ]);
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.type(input, 'lhr');
    await user.tab();
    expect(input).toHaveValue('LHR');
    await user.click(screen.getByRole('button', { name: 'Add origin' }));
    expect(chipCodes('Origins')).toEqual(['LHR']);
    expect(screen.getByRole('button', { name: 'Remove LHR' })).toHaveClass('min-h-11');
    expect(input).toHaveValue('');
    await user.type(input, 'London');
    await user.tab();
    expect(input).toHaveValue('London');
  });

  it('Enter adds without a blur, a pasted " lgw " is trimmed, and a duplicate is refused', async () => {
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.click(input);
    await user.paste(' lgw ');
    await user.keyboard('{Enter}');
    expect(chipCodes('Origins')).toEqual(['LGW']);
    await user.type(input, 'lgw{Enter}');
    expect(screen.getByText('LGW is already in the list.')).toBeInTheDocument();
    expect(chipCodes('Origins')).toEqual(['LGW']);
  });

  it.each(['L1', 'LHRX'])('rejects "%s" locally, and links the message to the input', async (code) => {
    const { user } = renderForm();
    const input = screen.getByLabelText('Origins');
    await user.type(input, `${code}{Enter}`);
    expect(screen.getByText('An airport code is three letters.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('origins-errors');
  });

  it('autocompletes from GET /api/airports?q= once the debounce has passed', async () => {
    // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    const queries: string[] = [];
    server.use(
      http.get(`${API}/airports`, ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json(airports);
      }),
    );
    const { user } = renderWithProviders(<DefinitionForm existing={null} providers={providersResponse()} />, {
      fakeTimers: true,
    });
    await user.type(screen.getByLabelText('Origins'), 'lon');
    expect(queries).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(AIRPORT_DEBOUNCE_MS));
    await waitFor(() => expect(document.querySelectorAll('#origins-options option')).toHaveLength(2));
    const options = [...document.querySelectorAll('#origins-options option')].map(
      (o) => `${o.getAttribute('value')} ${o.textContent}`,
    );
    expect(options).toEqual(['LHR Heathrow, London, United Kingdom', 'LGW Gatwick, London, United Kingdom']);
    expect(queries).toEqual(['lon']);
    vi.useRealTimers();
  });

  it.each([
    [
      'Enter',
      async (u: ReturnType<typeof renderForm>['user']) =>
        u.type(screen.getByLabelText('Origins'), 'lon{Enter}'),
    ],
    [
      'Add',
      async (u: ReturnType<typeof renderForm>['user']) => {
        await u.type(screen.getByLabelText('Origins'), 'LON');
        await u.click(screen.getByRole('button', { name: 'Add origin' }));
      },
    ],
  ])(
    'a metro code expands to its member airports on %s, before the autocomplete answers (decision 44)',
    async (_how, act) => {
      const { user } = renderForm();
      await act(user);
      await waitFor(() => expect(chipCodes('Origins')).toEqual(['LHR', 'LGW']));
      expect(screen.getByRole('status')).toHaveTextContent('LON is a city code: added LHR, LGW.');
      expect(chipCodes('Origins')).not.toContain('LON');
    },
  );

  it('a code the airports table does not map is added as typed and left to the API to judge', async () => {
    server.use(http.get(`${API}/airports`, () => HttpResponse.json([])));
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Destinations'), 'jfk{Enter}');
    await waitFor(() => expect(chipCodes('Destinations')).toEqual(['JFK']));
  });
});

describe("the API's field errors (422 details.fields) land under the field they name (review tsr-013)", () => {
  it.each<[string, string, () => HTMLElement]>([
    ['origins.0', 'LON is a city code; use one of LHR, LGW', () => screen.getByLabelText('Origins')],
    [
      'destinations',
      'origins and destinations must be disjoint',
      () => screen.getByLabelText('Destinations'),
    ],
    ['name', 'name: required', () => screen.getByLabelText('Name')],
    ['window.lengthDays', 'lengthDays must be at most 400', () => screen.getByLabelText('Length (days)')],
    ['maxNights', 'maxNights must be at least minNights', () => screen.getByLabelText('Max nights')],
  ])('%s', async (field, message, input) => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation',
              message: 'invalid definition',
              details: { fields: [{ field, message }] },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    const summary = await screen.findByText('Fix these before saving:');
    expect(summary.parentElement).toHaveTextContent(`${field}: ${message}`);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input().getAttribute('aria-describedby') ?? '';
    const linked = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(linked).toContain(message);
  });

  it('a field the form has no place for appears in the summary only; a non-422 failure is a notice; errors clear after a success', async () => {
    let reply = () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation',
            message: 'x',
            details: { fields: [{ field: 'verification.alwaysInclude', message: 'too many' }] },
          },
        },
        { status: 422 },
      );
    server.use(http.post(`${API}/definitions/estimate`, () => reply()));
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByText('verification.alwaysInclude: too many')).toBeInTheDocument();
    reply = () =>
      HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 });
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByText('That did not work: database is locked')).toBeInTheDocument();
    expect(screen.queryByText('Fix these before saving:')).toBeNull();
    reply = () => HttpResponse.json({ estimate: estimate(), budgetFit: definition().budgetFit });
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await screen.findByRole('region', { name: 'Estimate' });
    expect(screen.queryByText('That did not work: database is locked')).toBeNull();
  });
});

describe('per-destination fields and the example (spec §11)', () => {
  it('note and onward cost per destination reach the estimate request, the cost in pence', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.type(screen.getByLabelText('Origins'), 'LHR{Enter}');
    await user.type(screen.getByLabelText('Destinations'), 'JFK{Enter}');
    await user.type(screen.getByLabelText('Note for JFK (shown on every row)'), 'onward leg not included');
    await user.type(
      screen.getByLabelText('Onward cost to JFK in £ (optional, shown as a separate adjusted column)'),
      '25.50',
    );
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({
      origins: ['LHR'],
      destinations: ['JFK'],
      destinationNotes: { JFK: 'onward leg not included' },
      onwardCostPence: { JFK: 2550 },
    });
    expect(bodies[0]).not.toHaveProperty('confirmedCostPence');
  });

  it('the time-window boxes follow the draft: Import example shows its 06:00–23:00 arrival window (review arch-r3-004)', async () => {
    const bodies = estimateBodies();
    const { user } = renderForm();
    await user.click(screen.getByText('Advanced: constraints and policy'));
    const from = `${CONSTRAINT_LABELS.arrivalWindowLocal} from`;
    const to = `${CONSTRAINT_LABELS.arrivalWindowLocal} to`;
    await user.clear(screen.getByLabelText(from));
    await user.clear(screen.getByLabelText(to));
    expect([fieldValue(from), fieldValue(to)]).toEqual(['', '']);
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    expect([fieldValue(from), fieldValue(to)]).toEqual(['06:00', '23:00']);
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ constraints: { arrivalWindowLocal: { from: '06:00', to: '23:00' } } });
  });

  it('"import example" loads the route, window, nights, cabin and constraints of docs/examples/london-new-york.json', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: `Import example (${EXAMPLE_LABEL})` }));
    expect(fieldValue('Name')).not.toBe('');
    expect(chipCodes('Origins')).toEqual(['LHR', 'LGW']);
    expect(chipCodes('Destinations')).toEqual(['JFK', 'EWR']);
    expect(fieldValue('Min nights')).toBe('10');
    expect(fieldValue('Max nights')).toBe('21');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions/form.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/example.js"`.

- [ ] **Step 3: Implement**

`docs/examples/london-new-york.json` (stand-in, only when absent; byte-for-byte WP12's content):

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

`src/example.ts` (new file):

```ts
import { apiContract } from '@gmt/core';
import example from '../../../docs/examples/london-new-york.json' with { type: 'json' };

/**
 * Spec §1 / §11 "import example": the worked example as a create body, and the one place its words
 * live. The airport codes are in docs/examples/london-new-york.json (WP12 owns the file and the
 * equality test); this is the one apps/web/src file allowed to name the example's places, which
 * scripts/check-boundaries.mjs enforces (decision 36). Parsed with the contract, so drift fails at load.
 */
export const EXAMPLE_DEFINITION = apiContract.definitionCreateRequestSchema.parse(example);

/** The example's route in words, for the import button; copy.ts takes it as an argument. */
export const EXAMPLE_LABEL = 'London to New York';
```

`src/views/Definitions/draft.ts` (new file):

```ts
import type { DefinitionBody, DefinitionResponse, ProvidersResponse } from '../../api/types.js';

/**
 * The form's model: a definition being edited, in the create schema's *input* shape (plain strings,
 * no brands), so nothing is cast or minted before the API, the one validator, parses it (spec §6.1).
 * The confirmation is not part of it: only the explicit create or confirm click sends one.
 */
export type Draft = Omit<DefinitionBody, 'confirmedCostPence'>;
export type DraftWindow = Draft['window'];

/** Spec §11 default relative window: starts in 7 days, 182 days long. */
export const DEFAULT_RELATIVE: DraftWindow = { kind: 'relative', startOffsetDays: 7, lengthDays: 182 };
/** An absolute window before the operator picks dates; the API rejects it until both are set. */
export const EMPTY_ABSOLUTE: DraftWindow = { kind: 'absolute', from: '', to: '' };

/**
 * Review focus 1: a three-letter code is trimmed and upper-cased on blur; any other text (a city name
 * being typed, say) is only trimmed, so a six-letter city name is never shouted back in capitals.
 */
export function normaliseIata(s: string): string {
  const t = s.trim();
  return /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : t;
}

/** Spec §11 defaults; providers, policy, budget and time zone come from the plan preset (`/api/providers` presets). */
export function defaultDraft(presets: ProvidersResponse['presets']): Draft {
  return {
    name: '',
    origins: [],
    destinations: [],
    window: DEFAULT_RELATIVE,
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
    enabled: true,
  };
}

/** A stored definition as a draft; `enabled` is carried so saving an edit never re-enables it (review po-011). */
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
    destinationNotes: { ...def.destinationNotes },
    onwardCostPence: { ...def.onwardCostPence },
    scheduleCron: def.scheduleCron,
    scheduleTz: def.scheduleTz,
    enabled: def.enabled,
  };
}

/**
 * Loads the example's route, window, nights, cabin, constraints and notes over the draft.
 * why: providers, policy, budget and schedule stay on the plan preset, so importing the example
 * on a £0 install does not ask for SearchApi.
 */
export function applyExample(d: Draft, ex: Draft): Draft {
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
    destinationNotes: { ...ex.destinationNotes },
    onwardCostPence: { ...ex.onwardCostPence },
  };
}

/** Only notes and costs for destinations still in the list, and no blank notes, are sent. */
function forDestinations<V>(rec: Record<string, V>, destinations: readonly string[]): Record<string, V> {
  return Object.fromEntries(Object.entries(rec).filter(([k, v]) => destinations.includes(k) && v !== ''));
}

/** The create/update body (plan `DefinitionInput`): never `confirmedCostPence`, which only the explicit confirmation sets. */
export function draftToRequest(d: Draft): Draft {
  return {
    ...d,
    destinationNotes: forDestinations(d.destinationNotes, d.destinations),
    onwardCostPence: forDestinations(d.onwardCostPence, d.destinations),
  };
}
```

`src/views/Definitions/fields.tsx` (new file):

```tsx
import { useEffect, useState } from 'react';
import { COPY } from '../../copy.js';
import { parsePoundsToPence, penceToPoundsInput, poundsText } from '../../format.js';
import { useSynced } from '../../hooks/useSynced.js';
import { carriersText, parseCarriers } from '../../state/carriers.js';

// The Definitions form's field primitives (review arch-r2-008): the form and its advanced fold both use them.

const input = 'min-h-11 rounded border border-slate-400 px-1';

/** Error messages under a field, tied to its input by id (review tsr-013). */
export function FieldErrors({ id, messages }: { id: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} role="alert" className="text-red-800">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

/**
 * A labelled non-negative integer input; blank means "not set". `hint` is shown beside it (minutes as
 * hours); `errors` are the API's messages for this field, announced and linked with aria-describedby.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  errors = [],
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  hint?: string;
  errors?: readonly string[];
}) {
  const errorId = `${id}-errors`;
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <span className="flex items-center gap-1">
        <input
          id={id}
          inputMode="numeric"
          value={value === undefined ? '' : String(value)}
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length > 0 ? errorId : undefined}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === '') onChange(undefined);
            else if (/^\d+$/.test(t)) onChange(Number(t));
          }}
          className={`w-28 ${input}`}
        />
        {hint !== undefined ? <span className="text-xs">{hint}</span> : null}
      </span>
      <FieldErrors id={errorId} messages={errors} />
    </span>
  );
}

/**
 * Money is entered in pounds everywhere and held as integer pence (review po-012): the text the
 * operator types stays as typed while it is being edited, and follows the value when it changes elsewhere.
 */
export function PoundsField({
  id,
  label,
  pence,
  onChange,
}: {
  id: string;
  label: string;
  pence: number | undefined;
  onChange: (p: number | undefined) => void;
}) {
  const [text, setText] = useSynced(penceToPoundsInput(pence), poundsText);
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = parsePoundsToPence(e.target.value);
          if (p !== undefined || e.target.value.trim() === '') onChange(p);
        }}
        className={`w-28 ${input}`}
      />
    </span>
  );
}

/** A local time window; the constraint exists only once both ends are set. */
export function TimeWindowField({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name: string;
  value: { from: string; to: string } | undefined;
  onChange: (v: { from: string; to: string } | undefined) => void;
}) {
  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? '');
  // why: the boxes follow the draft when it changes elsewhere (Import example), so the form never holds a
  // window it does not show (review arch-r3-004); one end typed alone leaves the value, and so the boxes, as they are.
  useEffect(() => {
    setFrom(value?.from ?? '');
    setTo(value?.to ?? '');
  }, [value?.from, value?.to]);
  // why: the constraint exists only with both ends; one end alone stays local until the other is filled or cleared.
  const sync = (f: string, t: string) => {
    if (f !== '' && t !== '') onChange({ from: f, to: t });
    else if (f === '' && t === '') onChange(undefined);
  };
  return (
    <span className="flex gap-2">
      <span className="flex flex-col">
        <label htmlFor={`${id}-from`}>{`${name} ${COPY.timeFrom}`}</label>
        <input
          id={`${id}-from`}
          type="time"
          className={input}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            sync(e.target.value, to);
          }}
        />
      </span>
      <span className="flex flex-col">
        <label htmlFor={`${id}-to`}>{`${name} ${COPY.timeTo}`}</label>
        <input
          id={`${id}-to`}
          type="time"
          className={input}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            sync(from, e.target.value);
          }}
        />
      </span>
    </span>
  );
}

/**
 * Comma-separated carrier codes, parsed like the Results carriers filter: two-character codes only,
 * other entries shown as ignored rather than stored (review arch-r2-009).
 */
export function AirlinesField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string[] | undefined;
  onChange: (v: string[] | undefined) => void;
}) {
  const [text, setText] = useSynced((value ?? []).join(','), carriersText);
  const ignored = parseCarriers(text).ignored;
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        aria-describedby={ignored.length > 0 ? `${id}-help ${id}-ignored` : `${id}-help`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const codes = parseCarriers(text).codes;
          onChange(codes.length > 0 ? codes : undefined);
        }}
        className={input}
      />
      <span id={`${id}-help`} className="text-xs">
        {COPY.airlinesHelp}
      </span>
      {ignored.length > 0 ? (
        <span id={`${id}-ignored`} className="text-xs text-red-800">
          {COPY.carriersIgnored(ignored.join(', '))}
        </span>
      ) : null}
    </span>
  );
}

/** A labelled checkbox with a 44 px row. */
export function Check({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="flex min-h-11 items-center gap-1">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}
```

`src/views/Definitions/AirportListInput.tsx` (new file):

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { qk, useAirportSearch } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { normaliseIata } from './draft.js';

/** Waits `ms` after the last keystroke before the autocomplete query runs. */
export const AIRPORT_DEBOUNCE_MS = 200;

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

/**
 * Operator-entered airports with airport-table autocomplete; no preset airports (spec §1, §11).
 * A metro code the airports table maps (its rows carry `metro`) expands to its member airports on Enter
 * or Add, the same as picking them from the list, instead of failing only after "Show estimate"
 * (decision 44, reviews PFT-07, tsr2-005); the table is asked directly when the autocomplete has not
 * answered yet. A code the table does not know is left to the API, the validator. Errors are tied to the input with
 * aria-describedby and aria-invalid. The native datalist is the accepted autocomplete for now.
 */
export function AirportListInput({ id, label, addLabel, codes, onChange, errors }: AirportListInputProps) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const query = useDebounced(text.trim(), AIRPORT_DEBOUNCE_MS);
  const suggestions = useAirportSearch(query);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const add = (list: readonly string[]) => {
    const fresh = list.filter((c) => !codes.includes(c));
    if (fresh.length === 0) {
      setLocalError(COPY.duplicateAirport(list.join(', ')));
      return;
    }
    setLocalError(null);
    onChange([...codes, ...fresh]);
    setText('');
  };
  const addTyped = async () => {
    const code = normaliseIata(text);
    setText(code);
    setExpanded(null);
    if (!/^[A-Z]{3}$/.test(code)) {
      setLocalError(COPY.iataFormat);
      return;
    }
    // why: the same cached query the autocomplete uses; a failed lookup adds the code and leaves it to the API.
    const rows = await qc
      .fetchQuery({ queryKey: qk.airports(code), queryFn: () => api.airports(code), staleTime: 60_000 })
      .catch(() => []);
    const members = rows.filter((a) => a.metro === code && a.iata !== code).map((a) => a.iata);
    if (members.length === 0) {
      add([code]);
      return;
    }
    add(members);
    setExpanded(COPY.metroExpanded(code, members.join(', ')));
  };
  const messages = [...(localError === null ? [] : [localError]), ...errors];
  const errorId = `${id}-errors`;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-semibold">{label}</legend>
      {/* why: the chip list has no label of its own, so getByLabelText(label) finds only the input */}
      <ul className="flex flex-wrap gap-1">
        {codes.map((c) => (
          <li key={c} className="flex items-center gap-1 rounded bg-slate-200 px-1">
            <span>{c}</span>
            <button
              type="button"
              aria-label={COPY.removeAirport(c)}
              className="min-h-11 min-w-11"
              onClick={() => onChange(codes.filter((x) => x !== c))}
            >
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
          aria-invalid={messages.length > 0}
          aria-describedby={messages.length > 0 ? `${id}-help ${errorId}` : `${id}-help`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText((t) => normaliseIata(t))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addTyped();
            }
          }}
          className="min-h-11 rounded border border-slate-400 px-1"
        />
        <button
          type="button"
          aria-label={addLabel}
          onClick={() => void addTyped()}
          className="min-h-11 rounded border border-slate-500 px-3"
        >
          {COPY.addAirport}
        </button>
      </span>
      {expanded !== null ? (
        <p role="status" className="text-sm">
          {expanded}
        </p>
      ) : null}
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
      {messages.length > 0 ? (
        <div id={errorId} role="alert" className="text-red-800">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
```

`src/views/Definitions/AdvancedFields.tsx` (new file):

```tsx
import { microGbpToPence, PENCE_TO_MICRO, type ProviderId } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';
import { withKey } from '../../state/withKey.js';
import type { Draft } from './draft.js';
import { AirlinesField, Check, NumberField, PoundsField, TimeWindowField } from './fields.js';

type DraftConstraints = Draft['constraints'];
type DraftPolicy = Draft['verification'];
const input = 'min-h-11 rounded border border-slate-400 px-1';

export interface ProviderCapabilities {
  id: ProviderId;
  displayName: string;
  discovery: boolean;
  verification: boolean;
}

/** Spec §11 advanced fold: every constraint, the verification policy, providers, budget and schedule. */
export function AdvancedFields({
  draft,
  setDraft,
  capabilities,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  capabilities: readonly ProviderCapabilities[];
}) {
  const c = draft.constraints;
  const v = draft.verification;
  const setC = <K extends keyof DraftConstraints>(k: K, value: DraftConstraints[K] | undefined) =>
    setDraft({ ...draft, constraints: withKey(c, k, value) });
  const setV = <K extends keyof DraftPolicy>(k: K, value: DraftPolicy[K] | undefined) =>
    setDraft({ ...draft, verification: withKey(v, k, value) });
  // why: spec §5.4, bookingLinks is forced true whenever SearchApi verifies (zod enforces it too).
  const forcedBooking = draft.providers.verification.includes('searchapi');
  const toggleProvider = (stage: 'discovery' | 'verification', id: ProviderId, on: boolean) => {
    const list = draft.providers[stage].filter((p) => p !== id);
    const providers = { ...draft.providers, [stage]: on ? [...list, id] : list };
    const verification =
      stage === 'verification' && id === 'searchapi' && on ? { ...v, bookingLinks: true } : v;
    setDraft({ ...draft, providers, verification });
  };
  return (
    <div className="mt-2 space-y-3">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.constraintsHeading}</legend>
        <NumberField
          id="c-maxStops"
          label={COPY.constraint.maxStops}
          value={c.maxStops}
          onChange={(n) => setC('maxStops', n)}
        />
        <NumberField
          id="c-maxJourney"
          label={COPY.constraint.maxJourneyMinutes}
          value={c.maxJourneyMinutes}
          onChange={(n) => setC('maxJourneyMinutes', n)}
          {...(c.maxJourneyMinutes === undefined
            ? {}
            : { hint: COPY.minutesAsHours(formatMinutes(c.maxJourneyMinutes)) })}
        />
        <NumberField
          id="c-minLayover"
          label={COPY.constraint.minLayoverMinutes}
          value={c.minLayoverMinutes}
          onChange={(n) => setC('minLayoverMinutes', n)}
        />
        <NumberField
          id="c-maxLayover"
          label={COPY.constraint.maxLayoverMinutes}
          value={c.maxLayoverMinutes}
          onChange={(n) => setC('maxLayoverMinutes', n)}
        />
        <Check
          id="c-overnight"
          label={COPY.constraint.noOvernightLayover}
          checked={c.noOvernightLayover === true}
          onChange={(b) => setC('noOvernightLayover', b ? true : undefined)}
        />
        <TimeWindowField
          id="c-departure"
          name={COPY.constraint.departureWindowLocal}
          value={c.departureWindowLocal}
          onChange={(w) => setC('departureWindowLocal', w)}
        />
        <TimeWindowField
          id="c-arrival"
          name={COPY.constraint.arrivalWindowLocal}
          value={c.arrivalWindowLocal}
          onChange={(w) => setC('arrivalWindowLocal', w)}
        />
        <Check
          id="c-selfTransfer"
          label={COPY.constraint.noSelfTransfer}
          checked={c.noSelfTransfer === true}
          onChange={(b) => setC('noSelfTransfer', b ? true : undefined)}
        />
        <Check
          id="c-airportChange"
          label={COPY.constraint.noAirportChange}
          checked={c.noAirportChange === true}
          onChange={(b) => setC('noAirportChange', b ? true : undefined)}
        />
        <AirlinesField
          id="c-include"
          label={COPY.constraint.includeAirlines}
          value={c.includeAirlines}
          onChange={(a) => setC('includeAirlines', a)}
        />
        <AirlinesField
          id="c-exclude"
          label={COPY.constraint.excludeAirlines}
          value={c.excludeAirlines}
          onChange={(a) => setC('excludeAirlines', a)}
        />
        <Check
          id="c-cabinBag"
          label={COPY.constraint.cabinBagRequired}
          checked={c.cabinBagRequired === true}
          onChange={(b) => setC('cabinBagRequired', b ? true : undefined)}
        />
        <Check
          id="c-checkedBag"
          label={COPY.constraint.checkedBagRequired}
          checked={c.checkedBagRequired === true}
          onChange={(b) => setC('checkedBagRequired', b ? true : undefined)}
        />
        <NumberField
          id="c-minBags"
          label={COPY.constraint.minCheckedBags}
          value={c.minCheckedBags}
          onChange={(n) => setC('minCheckedBags', n)}
        />
        <PoundsField
          id="c-maxPrice"
          label={COPY.inPounds(COPY.constraint.maxPricePence)}
          pence={c.maxPricePence}
          onChange={(p) => setC('maxPricePence', p)}
        />
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.providersSection}</legend>
        <span className="flex flex-col">
          <span>{COPY.discoveryProviders}</span>
          {capabilities
            .filter((p) => p.discovery)
            .map((p) => (
              <Check
                key={p.id}
                id={`p-d-${p.id}`}
                label={p.displayName}
                checked={draft.providers.discovery.includes(p.id)}
                onChange={(b) => toggleProvider('discovery', p.id, b)}
              />
            ))}
        </span>
        <span className="flex flex-col">
          <span>{COPY.verificationProviders}</span>
          {capabilities
            .filter((p) => p.verification)
            .map((p) => (
              <Check
                key={p.id}
                id={`p-v-${p.id}`}
                label={p.displayName}
                checked={draft.providers.verification.includes(p.id)}
                onChange={(b) => toggleProvider('verification', p.id, b)}
              />
            ))}
        </span>
        {draft.providers.discovery.map((id) => (
          <NumberField
            key={id}
            id={`p-refresh-${id}`}
            label={COPY.refreshHours(COPY.provider[id])}
            value={draft.providers.discoveryRefreshHours[id]}
            onChange={(n) =>
              setDraft({
                ...draft,
                providers: {
                  ...draft.providers,
                  discoveryRefreshHours: withKey(draft.providers.discoveryRefreshHours, id, n),
                },
              })
            }
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.policyHeading}</legend>
        <NumberField
          id="v-maxCells"
          label={COPY.maxCells}
          value={v.maxCells}
          onChange={(n) => setV('maxCells', n ?? 0)}
        />
        <NumberField id="v-topN" label={COPY.topN} value={v.topN} onChange={(n) => setV('topN', n ?? 0)} />
        <PoundsField
          id="v-ceiling"
          label={COPY.priceCeiling}
          pence={v.priceCeilingPence}
          onChange={(p) => setV('priceCeilingPence', p)}
        />
        <NumberField
          id="v-perDate"
          label={COPY.perDepartureDateBest}
          value={v.perDepartureDateBest}
          onChange={(n) => setV('perDepartureDateBest', n)}
        />
        <NumberField
          id="v-expandTop"
          label={COPY.expandTop}
          value={v.expandTop}
          onChange={(n) => setV('expandTop', n ?? 0)}
        />
        <span className="flex flex-col">
          <Check
            id="v-booking"
            label={COPY.bookingLinks}
            checked={forcedBooking || v.bookingLinks}
            disabled={forcedBooking}
            onChange={(b) => setV('bookingLinks', b)}
          />
          {forcedBooking ? <span className="text-xs">{COPY.bookingLinksForced}</span> : null}
        </span>
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.budgetHeading}</legend>
        <NumberField
          id="b-calls"
          label={COPY.maxCalls}
          value={draft.budget.maxCalls}
          onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxCalls: n ?? 0 } })}
        />
        <NumberField
          id="b-free"
          label={COPY.maxFreeCalls}
          value={draft.budget.maxFreeCalls}
          onChange={(n) => setDraft({ ...draft, budget: { ...draft.budget, maxFreeCalls: n ?? 0 } })}
        />
        <PoundsField
          id="b-cost"
          label={COPY.maxCost}
          pence={microGbpToPence(draft.budget.maxCostMicroGbp)}
          onChange={(p) =>
            setDraft({ ...draft, budget: { ...draft.budget, maxCostMicroGbp: (p ?? 0) * PENCE_TO_MICRO } })
          }
        />
      </fieldset>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-semibold">{COPY.scheduleHeading}</legend>
        <span className="flex flex-col">
          <label htmlFor="s-cron">{COPY.scheduleCron}</label>
          <input
            id="s-cron"
            value={draft.scheduleCron ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, scheduleCron: e.target.value.trim() === '' ? null : e.target.value })
            }
            className={input}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="s-tz">{COPY.scheduleTz}</label>
          <input
            id="s-tz"
            value={draft.scheduleTz}
            onChange={(e) => setDraft({ ...draft, scheduleTz: e.target.value })}
            className={input}
          />
        </span>
        <Check
          id="d-enabled"
          label={COPY.enabled}
          checked={draft.enabled}
          onChange={(b) => setDraft({ ...draft, enabled: b })}
        />
      </fieldset>
    </div>
  );
}
```

`src/views/Definitions/CoverageCheck.tsx` (new file):

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import type { CoverageCheckBody, CoverageCheckResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import type { Draft } from './draft.js';

type MonthCount = CoverageCheckResponse['pairs'][number]['months'][number];

/**
 * One cell of the table. A month the check could not read (`cachedRows: null`, decision 25) or a
 * month the response omits for a pair is "not checked", visibly different from a real 0, which
 * means the cache holds nothing for that pair and month (reviews po-001, prov-002, UI-1).
 */
function MonthCell({ m }: { m: MonthCount | undefined }) {
  if (m === undefined || m.cachedRows === null) {
    return <td className="p-1 text-right italic text-slate-600">{COPY.notChecked}</td>;
  }
  return <td className="p-1 text-right tabular-nums">{COPY.cachedOf(m.cachedRows, m.cellsInBand)}</td>;
}

/** Spec §10/§11: free Travelpayouts month tiles for the entered pairs, cached cells per pair per month, before saving. */
export function CoverageCheck({ draft, available }: { draft: Draft; available: boolean }) {
  const body: CoverageCheckBody = {
    origins: draft.origins,
    destinations: draft.destinations,
    window: draft.window,
    minNights: draft.minNights,
    maxNights: draft.maxNights,
  };
  const signature = JSON.stringify(body);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: (b: CoverageCheckBody) => api.coverageCheck(b),
    onSuccess: () => setCheckedFor(signature),
  });
  if (!available) return <p className="text-sm">{COPY.coverageCheckNeedsTravelpayouts}</p>;
  const months = [...new Set((check.data?.pairs ?? []).flatMap((p) => p.months.map((m) => m.month)))].sort();
  const stale = check.data !== undefined && checkedFor !== signature;
  return (
    <section aria-label={COPY.coverageCheck} className="space-y-1 text-sm">
      <p>{COPY.coverageCheckIntro}</p>
      <button
        type="button"
        className="min-h-11 rounded border border-slate-500 px-3"
        disabled={draft.origins.length === 0 || draft.destinations.length === 0 || check.isPending}
        onClick={() => check.mutate(body)}
      >
        {COPY.coverageCheck}
      </button>
      {check.error ? <p role="alert">{COPY.actionFailed(check.error.message)}</p> : null}
      {stale ? (
        <p role="status" className="font-medium">
          {COPY.coverageCheckStale}
        </p>
      ) : null}
      {check.data !== undefined ? (
        <div className={stale ? 'opacity-60' : ''}>
          <table aria-label={COPY.coverageCheck} className="border-collapse">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageCheckMonth}
                </th>
                {months.map((m) => (
                  <th key={m} scope="col" className="p-1 text-right">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {check.data.pairs.map((p) => (
                <tr key={`${p.origin}-${p.destination}`}>
                  <th scope="row" className="p-1 text-left font-normal">
                    {COPY.coverageCheckPair(p.origin, p.destination)}
                  </th>
                  {months.map((m) => (
                    <MonthCell key={m} m={p.months.find((x) => x.month === m)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>{COPY.coverageCheckCalls(check.data.calls)}</p>
          {check.data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
```

`src/views/Definitions/EstimatePanel.tsx` (new file):

```tsx
import type { BudgetFit, Estimate } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatSeconds } from '../../format.js';

/** Spec §11: the estimate shown before the operator confirms (POST /api/definitions/estimate for an unsaved body). */
/** `hardStop` is the run budget's call cap, the runtime limit beside the estimate (decision 44). */
export function EstimatePanel({ estimate, hardStop }: { estimate: Estimate; hardStop: number }) {
  const e = estimate;
  return (
    <section
      data-cost=""
      aria-label={COPY.estimateHeading}
      className="space-y-1 rounded border border-slate-300 p-2 text-sm"
    >
      <h3 className="font-semibold">{COPY.estimateHeading}</h3>
      <p>{COPY.estimateCells(e.cells)}</p>
      <ul>
        {e.perProvider.map((p) => (
          <li key={`${p.providerId}-${p.stage}`}>
            {COPY.estimateRow(
              COPY.provider[p.providerId],
              COPY.stageName[p.stage],
              p.calls,
              formatMicroGbp(p.costMicroGbp),
              formatSeconds(p.seconds),
            )}
            {p.blocked !== null ? (
              <span className="ml-1 font-semibold">{COPY.estimateBlocked(p.blocked)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="font-medium">
        {COPY.estimateTotal(
          e.totalCalls,
          hardStop,
          formatMicroGbp(e.totalCostMicroGbp),
          formatSeconds(e.seconds),
        )}
      </p>
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

/**
 * Spec §8.2 budgetFit: runs per month × estimate against every cap, every scope listed whether it
 * fits or not, so the calls a month commits against each provider-month cap are visible before the
 * click (review po-010); a miss is an alert.
 */
export function BudgetFitPanel({ fit }: { fit: BudgetFit }) {
  return (
    <div role={fit.fits ? undefined : 'alert'} className="text-sm">
      <p className={fit.fits ? '' : 'font-semibold'}>
        {fit.fits ? COPY.budgetFitOk(fit.runsPerMonth) : COPY.budgetFitWarn(fit.runsPerMonth)}
      </p>
      <ul>
        {fit.perScope.map((s) => (
          <li key={s.scope}>
            {COPY.budgetScope(s.scope, s.estimated, s.cap === null ? COPY.noCap : String(s.cap))}
            {s.fits ? null : <span className="ml-1 font-semibold">{COPY.overCap}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`src/views/Definitions/Confirmation.tsx` (new file):

```tsx
import { microGbpToPence } from '@gmt/core';
import type { DefinitionResponse, EstimateResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatPence } from '../../format.js';
import { BudgetFitPanel, EstimatePanel } from './EstimatePanel.js';

const button = 'min-h-11 rounded border border-slate-700 px-3';

/**
 * Spec §11 / §8.1, a new definition: the estimate and every budget scope, then the create click, which is
 * the explicit confirmation of the calls and the pounds it names (decisions 42–44). An estimate made for
 * an earlier draft offers no button, only "show the estimate again" (review UI-11).
 */
export function CreateConfirmation({
  estimate,
  fresh,
  hardStop,
  onCreate,
}: {
  estimate: EstimateResponse;
  fresh: boolean;
  /** The run budget's call cap, the runtime limit beside the estimate. */
  hardStop: number;
  onCreate: () => void;
}) {
  return (
    <>
      <EstimatePanel estimate={estimate.estimate} hardStop={hardStop} />
      <BudgetFitPanel fit={estimate.budgetFit} />
      {fresh ? (
        <button
          type="button"
          data-cost=""
          className="min-h-11 rounded bg-slate-900 px-3 text-white"
          onClick={onCreate}
        >
          {COPY.createConfirm(
            estimate.estimate.totalCalls,
            hardStop,
            formatPence(microGbpToPence(estimate.estimate.totalCostMicroGbp)),
          )}
        </button>
      ) : (
        <p role="status" className="font-medium">
          {COPY.estimateStale}
        </p>
      )}
    </>
  );
}

/**
 * A saved definition whose estimate rose above what was confirmed (`needsConfirmation`): the new calls
 * and pounds against the old, and one click that confirms both (decisions 42, 43).
 */
export function Reconfirmation({
  definition,
  onConfirm,
}: {
  definition: DefinitionResponse;
  onConfirm: (v: { pence: number; calls: number }) => void;
}) {
  const n = definition.needsConfirmation;
  if (n === null) return null;
  const pence = microGbpToPence(n.estimateMicroGbp);
  return (
    <div role="alert" data-cost="" className="rounded border border-amber-700 bg-amber-50 p-2">
      <p>
        {COPY.needsConfirmation({
          calls: n.totalCalls,
          cap: definition.budget.maxCalls,
          estimate: formatMicroGbp(n.estimateMicroGbp),
          confirmed:
            n.confirmedCostPence === null
              ? COPY.none
              : COPY.confirmedWas(
                  n.confirmedCalls === null ? COPY.none : String(n.confirmedCalls),
                  formatPence(n.confirmedCostPence),
                ),
        })}
      </p>
      <button type="button" className={button} onClick={() => onConfirm({ pence, calls: n.totalCalls })}>
        {COPY.confirmNew(n.totalCalls, definition.budget.maxCalls, formatPence(pence))}
      </button>
    </div>
  );
}
```

`src/views/Definitions/DefinitionForm.tsx` (new file):

```tsx
import { apiContract, londonDateOf, microGbpToPence, resolveWindow } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, type FieldError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse, EstimateResponse, ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { EXAMPLE_DEFINITION, EXAMPLE_LABEL } from '../../example.js';
import { formatIsoDate } from '../../format.js';
import { useNow } from '../../now.js';
import { updateSearchParams } from '../../state/urlState.js';
import { withKey } from '../../state/withKey.js';
import { AdvancedFields, type ProviderCapabilities } from './AdvancedFields.js';
import { AirportListInput } from './AirportListInput.js';
import { CreateConfirmation, Reconfirmation } from './Confirmation.js';
import { CoverageCheck } from './CoverageCheck.js';
import {
  applyExample,
  DEFAULT_RELATIVE,
  type Draft,
  type DraftWindow,
  defaultDraft,
  definitionToDraft,
  draftToRequest,
  EMPTY_ABSOLUTE,
} from './draft.js';
import { BudgetFitPanel, EstimatePanel } from './EstimatePanel.js';
import { FieldErrors, NumberField, PoundsField } from './fields.js';

/** Field errors whose path is `field` or starts with `field.` (422 `details.fields`). */
const errorsFor = (errors: readonly FieldError[], field: string) =>
  errors.filter((e) => e.field === field || e.field.startsWith(`${field}.`)).map((e) => e.message);

const input = 'min-h-11 rounded border border-slate-400 px-1';
const button = 'min-h-11 rounded border border-slate-700 px-3';

/** "departures from 21 Oct 2026 to 20 Apr 2027, as resolved today" under the relative fields (review PFT-08). */
function ResolvedWindow({ window: w }: { window: DraftWindow }) {
  const now = useNow();
  if (w.kind !== 'relative' || w.startOffsetDays < 1 || w.lengthDays < 1) return null;
  const r = resolveWindow(
    { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
    londonDateOf(now),
  );
  return (
    <p className="w-full text-xs">
      {COPY.resolvedWindow(formatIsoDate(r.departureFrom), formatIsoDate(r.departureTo))}
    </p>
  );
}

/**
 * Spec §11 Definitions form. New definition: "Show estimate" calls POST /api/definitions/estimate
 * with the unsaved body and shows the estimate and budgetFit; "Create and confirm" (below them) is
 * the explicit confirmation, a POST carrying confirmedCostPence = ceil(estimate / 10 000) (spec §8.1)
 * and confirmedCalls = the estimate's calls (decisions 42, 43),
 * labelled with the calls and the pounds it commits to (decision 36). Editing the draft after an
 * estimate hides Create and says why. Saved definition: "Save changes" PUTs; a needsConfirmation
 * response asks again before scheduled runs proceed.
 */
export function DefinitionForm({
  existing,
  providers,
}: {
  existing: DefinitionResponse | null;
  providers: ProvidersResponse;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() =>
    existing ? definitionToDraft(existing) : defaultDraft(providers.presets),
  );
  // why: switching the window mode keeps the other mode's values, so toggling back loses nothing (review PFT-08).
  const [otherWindow, setOtherWindow] = useState<DraftWindow>(() =>
    draft.window.kind === 'relative' ? EMPTY_ABSOLUTE : DEFAULT_RELATIVE,
  );
  const [saved, setSaved] = useState<DefinitionResponse | null>(existing);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimatedFor, setEstimatedFor] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const capabilities: ProviderCapabilities[] = providers.providers
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.providerId,
      displayName: p.displayName,
      discovery: p.capabilities.discovery !== null,
      verification: p.capabilities.verification !== null,
    }));
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
    mutationFn: (e: EstimateResponse) =>
      api.createDefinition({
        ...draftToRequest(draft),
        confirmedCostPence: microGbpToPence(e.estimate.totalCostMicroGbp),
        // why: decisions 42, 43: the calls the operator saw are confirmed with the pence; one without the other covers no run.
        confirmedCalls: e.estimate.totalCalls,
      }),
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
    mutationFn: (v: { id: string; pence: number; calls: number }) =>
      api.updateDefinition(v.id, { confirmedCostPence: v.pence, confirmedCalls: v.calls }),
    onSuccess: (d) => accept(d, COPY.saved),
    onError,
  });

  const w = draft.window;
  const switchWindow = () => {
    setOtherWindow(w);
    setDraft({ ...draft, window: otherWindow });
  };
  const fresh = estimate !== null && estimatedFor === current;
  const nightsErrors = (field: 'minNights' | 'maxNights') => errorsFor(fieldErrors, field);
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
      <button
        type="button"
        className={button}
        onClick={() => setDraft(applyExample(draft, EXAMPLE_DEFINITION))}
      >
        {COPY.importExample(EXAMPLE_LABEL)}
      </button>
      <span className="flex flex-col">
        <label htmlFor="d-name">{COPY.name}</label>
        <input
          id="d-name"
          value={draft.name}
          aria-invalid={errorsFor(fieldErrors, 'name').length > 0}
          aria-describedby={errorsFor(fieldErrors, 'name').length > 0 ? 'd-name-errors' : undefined}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={input}
        />
        <FieldErrors id="d-name-errors" messages={errorsFor(fieldErrors, 'name')} />
      </span>
      <AirportListInput
        id="origins"
        label={COPY.origins}
        addLabel={COPY.addOrigin}
        codes={draft.origins}
        onChange={(origins) => setDraft({ ...draft, origins })}
        errors={errorsFor(fieldErrors, 'origins')}
      />
      <AirportListInput
        id="destinations"
        label={COPY.destinations}
        addLabel={COPY.addDestination}
        codes={draft.destinations}
        onChange={(destinations) => setDraft({ ...draft, destinations })}
        errors={errorsFor(fieldErrors, 'destinations')}
      />
      {draft.destinations.map((d) => (
        <span key={d} className="flex flex-wrap gap-3">
          <span className="flex flex-col">
            <label htmlFor={`note-${d}`}>{COPY.destinationNote(d)}</label>
            <input
              id={`note-${d}`}
              value={draft.destinationNotes[d] ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, destinationNotes: { ...draft.destinationNotes, [d]: e.target.value } })
              }
              className={input}
            />
          </span>
          <PoundsField
            id={`onward-${d}`}
            label={COPY.onwardCost(d)}
            pence={draft.onwardCostPence[d]}
            onChange={(p) => setDraft({ ...draft, onwardCostPence: withKey(draft.onwardCostPence, d, p) })}
          />
        </span>
      ))}
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="font-semibold">{COPY.windowHeading}</legend>
        <span className="flex min-h-11 items-center gap-1">
          <input
            id="w-relative"
            type="radio"
            name="window"
            checked={w.kind === 'relative'}
            onChange={switchWindow}
          />
          <label htmlFor="w-relative">{COPY.windowRelative}</label>
        </span>
        <span className="flex min-h-11 items-center gap-1">
          <input
            id="w-absolute"
            type="radio"
            name="window"
            checked={w.kind === 'absolute'}
            onChange={switchWindow}
          />
          <label htmlFor="w-absolute">{COPY.windowAbsolute}</label>
        </span>
        {w.kind === 'relative' ? (
          <>
            <NumberField
              id="w-offset"
              label={COPY.startOffsetDays}
              value={w.startOffsetDays}
              errors={errorsFor(fieldErrors, 'window.startOffsetDays')}
              onChange={(v) => setDraft({ ...draft, window: { ...w, startOffsetDays: v ?? 0 } })}
            />
            <NumberField
              id="w-length"
              label={COPY.lengthDays}
              value={w.lengthDays}
              errors={errorsFor(fieldErrors, 'window.lengthDays')}
              onChange={(v) => setDraft({ ...draft, window: { ...w, lengthDays: v ?? 0 } })}
            />
            <ResolvedWindow window={w} />
          </>
        ) : (
          <>
            <span className="flex flex-col">
              <label htmlFor="w-from">{COPY.windowFrom}</label>
              <input
                id="w-from"
                type="date"
                className={input}
                value={w.from}
                onChange={(e) => setDraft({ ...draft, window: { ...w, from: e.target.value } })}
              />
            </span>
            <span className="flex flex-col">
              <label htmlFor="w-to">{COPY.windowTo}</label>
              <input
                id="w-to"
                type="date"
                className={input}
                value={w.to}
                onChange={(e) => setDraft({ ...draft, window: { ...w, to: e.target.value } })}
              />
            </span>
          </>
        )}
        <NumberField
          id="n-min"
          label={COPY.minNights}
          value={draft.minNights}
          errors={nightsErrors('minNights')}
          onChange={(v) => setDraft({ ...draft, minNights: v ?? 0 })}
        />
        <NumberField
          id="n-max"
          label={COPY.maxNights}
          value={draft.maxNights}
          errors={nightsErrors('maxNights')}
          onChange={(v) => setDraft({ ...draft, maxNights: v ?? 0 })}
        />
        <span className="flex flex-col">
          <label htmlFor="d-cabin">{COPY.cabin}</label>
          <select
            id="d-cabin"
            className={input}
            value={draft.cabin}
            onChange={(e) => {
              const cabin = apiContract.cabinSchema.safeParse(e.target.value);
              if (cabin.success) setDraft({ ...draft, cabin: cabin.data });
            }}
          >
            {apiContract.cabinSchema.options.map((c) => (
              <option key={c} value={c}>
                {COPY.cabinName[c]}
              </option>
            ))}
          </select>
        </span>
      </fieldset>
      <details>
        <summary className="min-h-11 cursor-pointer font-semibold">{COPY.advanced}</summary>
        <AdvancedFields draft={draft} setDraft={setDraft} capabilities={capabilities} />
      </details>
      <CoverageCheck draft={draft} available={travelpayouts} />
      {saved === null ? (
        <button type="button" className={button} onClick={() => estimateDraft.mutate()}>
          {COPY.showEstimate}
        </button>
      ) : (
        <button type="button" className={button} onClick={() => save.mutate(saved)}>
          {COPY.save}
        </button>
      )}
      {saved === null && estimate !== null ? (
        <CreateConfirmation
          estimate={estimate}
          fresh={fresh}
          hardStop={draft.budget.maxCalls}
          onCreate={() => create.mutate(estimate)}
        />
      ) : null}
      {saved !== null ? (
        <Reconfirmation definition={saved} onConfirm={(v) => confirm.mutate({ id: saved.id, ...v })} />
      ) : null}
      {saved?.estimate ? <EstimatePanel estimate={saved.estimate} hardStop={saved.budget.maxCalls} /> : null}
      {saved !== null ? <BudgetFitPanel fit={saved.budgetFit} /> : null}
      {notice !== null ? <p role="status">{notice}</p> : null}
    </form>
  );
}
```

`scripts/check-boundaries.mjs` — find:

```js
// outside apps/api/src/bootstrap/, on msw imported outside providers' src/testing/, and on msw anywhere in apps/api.
```

`scripts/check-boundaries.mjs` — replace with:

```js
// outside apps/api/src/bootstrap/, on msw imported outside providers' src/testing/, on msw anywhere in apps/api, on
// an airport code or a metro city name in a string literal of apps/web/src or apps/api/src outside the two
// worked-example files, and on a lint or type-check suppression comment in any package's src or test.
```

`scripts/check-boundaries.mjs` — find:

```js
import { join } from 'node:path';
```

`scripts/check-boundaries.mjs` — replace with:

```js
import { join } from 'node:path';
import ts from 'typescript';
```

`scripts/check-boundaries.mjs` — find:

```js
const CORE_ALLOWED_EXTERNAL = ['zod', '@noble/hashes', '@date-fns/tz'];
```

`scripts/check-boundaries.mjs` — replace with:

```js
const CORE_ALLOWED_EXTERNAL = ['zod', '@noble/hashes', '@date-fns/tz'];
// Three-letter words that appear in string literals and are also dataset airport codes (decision 46): currencies,
// HTTP, formats, standards and plain English. A later package adds the words it needs here, in its own diff.
const NOT_AIRPORT_WORDS = [
  'ALL',
  'AND',
  'API',
  'APG',
  'BST',
  'CAP',
  'CET',
  'CLI',
  'CSS',
  'CSV',
  'DIR',
  'DOM',
  'END',
  'ENV',
  'EST',
  'FOR',
  'GBP',
  'GET',
  'GMT',
  'ISO',
  'KEY',
  'MAX',
  'MIN',
  'NEW',
  'NOT',
  'OFF',
  'OUT',
  'PDF',
  'PNG',
  'POS',
  'RUN',
  'SQL',
  'SRC',
  'SVG',
  'TOP',
  'WAL',
];
```

`scripts/check-boundaries.mjs` — find:

```js
process.exit(bad ? 1 : 0);
```

`scripts/check-boundaries.mjs` — replace with:

```js
// why: spec §1 and plan decisions 36, 46: nothing about a specific place exists in application code. A place
// lives in data, so only string literals, template text and JSX text are read (comments and identifiers are
// not): an airport or metro code from the shipped dataset, or the city name of any metro's airports. Only these
// two files may name the worked example's places.
const PLACE_ALLOWLIST = ['apps/web/src/example.ts', 'apps/api/src/tools/workedExample.ts'];
const PLACE_TREES = ['apps/web/src', 'apps/api/src'];
const NOT_AIRPORTS = new Set(NOT_AIRPORT_WORDS);
const dataDir = 'packages/db/data';
const airportsFile = readdirSync(dataDir).find((f) => /^airports\..+\.json$/.test(f));
const airports = JSON.parse(readFileSync(join(dataDir, airportsFile), 'utf8')).airports;
const metros = JSON.parse(readFileSync(join(dataDir, 'metros.json'), 'utf8')).metros;
const codes = new Set([...airports.map((a) => a.iata), ...Object.keys(metros)]);
const metroAirports = new Set(Object.values(metros).flat());
const cities = [
  ...new Set(airports.filter((a) => metroAirports.has(a.iata) && a.city !== '').map((a) => a.city)),
];
const cityPattern = new RegExp(
  `(?<![/\\w])(${cities.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?!\\w)`,
  'g',
);

/** The text a file renders or stores: string literals, template pieces and JSX text, never comments or names. */
function literalTexts(file, src) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every place name a file's literals hold. */
function placeOffenders(file, src) {
  const out = [];
  for (const text of literalTexts(file, src)) {
    for (const m of text.matchAll(/(?<![\w-])[A-Z]{3}(?![\w-])/g)) {
      if (codes.has(m[0]) && !NOT_AIRPORTS.has(m[0])) out.push(`${file} names the airport code ${m[0]}`);
    }
    for (const m of text.matchAll(cityPattern)) out.push(`${file} names the city ${m[1]}`);
  }
  return out;
}

for (const tree of PLACE_TREES) {
  for (const f of walk(tree)) {
    if (PLACE_ALLOWLIST.includes(f)) continue;
    for (const problem of placeOffenders(f, readFileSync(f, 'utf8'))) {
      console.error(`${problem}; only ${PLACE_ALLOWLIST.join(' and ')} may`);
      bad++;
    }
  }
}

// why: decisions 46, 49: the one suppression check. No lint or type-check suppression comment in any package's
// src or test; no scoped lint override is granted, so code that needed one is restructured instead.
const SUPPRESSIONS = '(?:biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck)';
const SUPPRESSION_COMMENT = new RegExp(`//[^\\n]*${SUPPRESSIONS}|/\\*(?:(?!\\*/)[\\s\\S])*${SUPPRESSIONS}`);
for (const dir of Object.values(dirs)) {
  for (const tree of ['src', 'test']) {
    for (const f of walk(join(dir, tree))) {
      if (SUPPRESSION_COMMENT.test(readFileSync(f, 'utf8'))) {
        console.error(`${f} has a lint or type-check suppression comment (decisions 46, 49)`);
        bad++;
      }
    }
  }
}
process.exit(bad ? 1 : 0);
```

The suppression check now covers `@ts-expect-error`, which core's and db's merged tests used for nine type tests. Each is restructured without one: a runtime guard is called through `Reflect.apply`, which passes the ill-typed argument untyped (no cast); the `exhaustive` compile-time rejection is stated with `expectTypeOf<…>().toBeNever()`, which `tsc` checks; and the barrel test reads the barrel source for `ProviderBudget`.

`packages/core/test/dates/epochDay.test.ts` — find:

```ts
    (bad: string) => {
      // @ts-expect-error a plain string is not an IsoDate; the runtime guard is what is under test
      expect(() => toEpochDay(bad)).toThrow(RangeError);
    },
```

`packages/core/test/dates/epochDay.test.ts` — replace with:

```ts
    (bad: string) => {
      // why: a plain string is not an IsoDate; Reflect.apply passes it untyped, since the runtime guard is under test.
      expect(() => Reflect.apply(toEpochDay, undefined, [bad])).toThrow(RangeError);
    },
```

`packages/core/test/dates/epochDay.test.ts` — find:

```ts
    const bad: string = '2027-02-29';
    // @ts-expect-error a plain string is not an IsoDate; the runtime guard is what is under test
    expect(() => monthOf(bad)).toThrow(RangeError);
  });
```

`packages/core/test/dates/epochDay.test.ts` — replace with:

```ts
    const bad: string = '2027-02-29';
    // why: a plain string is not an IsoDate; Reflect.apply passes it untyped, since the runtime guard is under test.
    expect(() => Reflect.apply(monthOf, undefined, [bad])).toThrow(RangeError);
  });
```

`packages/core/test/space/validate.test.ts` — find:

```ts
      const origins: string[] = ['lhr', 'LGW'];
      // @ts-expect-error a plain string[] is not Iata[]; this is a row written around the schema
      expect(fields({ ...base, origins })).toEqual([
        { field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' },
```

`packages/core/test/space/validate.test.ts` — replace with:

```ts
      const origins: string[] = ['lhr', 'LGW'];
      // why: a plain string[] is not Iata[]; this is a row written around the schema, passed untyped by Reflect.apply.
      expect(Reflect.apply(fields, undefined, [{ ...base, origins }])).toEqual([
        { field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' },
```

`packages/db/test/enums.test.ts` — find:

```ts
import { apiContract, cabinSchema, providerIdSchema, sourceKindSchema } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
```

`packages/db/test/enums.test.ts` — replace with:

```ts
import { apiContract, cabinSchema, providerIdSchema, sourceKindSchema } from '@gmt/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
```

`packages/db/test/enums.test.ts` — find:

```ts
    expect(exhaustive<'a' | 'b'>()(['a', 'b'] as const)).toEqual(['a', 'b']);
    // @ts-expect-error a list missing a member of the union does not compile
    exhaustive<'a' | 'b'>()(['a'] as const);
  });
```

`packages/db/test/enums.test.ts` — replace with:

```ts
    expect(exhaustive<'a' | 'b'>()(['a', 'b'] as const)).toEqual(['a', 'b']);
    // why: the list parameter of a list missing a member is `never`, so no such call compiles; checked by tsc.
    const ab = exhaustive<'a' | 'b'>();
    expectTypeOf<Parameters<typeof ab<readonly ['a']>>[0]>().toBeNever();
    expectTypeOf<Parameters<typeof ab<readonly ['a', 'b']>>[0]>().not.toBeNever();
  });
```

`packages/db/test/barrel.test.ts` — find:

```ts
import { fixedClock } from '@gmt/core';
```

`packages/db/test/barrel.test.ts` — replace with:

```ts
import { readFileSync } from 'node:fs';
import { fixedClock } from '@gmt/core';
```

`packages/db/test/barrel.test.ts` — find:

```ts
    );
    // @ts-expect-error ProviderBudget is the guard's internal entry type, not part of the contract
    const leaked = (x?: db.ProviderBudget) => x;
    expect(leaked()).toBeUndefined();
  });
```

`packages/db/test/barrel.test.ts` — replace with:

```ts
    );
    // why: ProviderBudget is the guard's internal entry type, not part of the contract; the barrel never names it.
    expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toMatch(
      /\bProviderBudget\b/,
    );
  });
```

`packages/db/test/client.test.ts` — find:

```ts
    const db = openDatabase(':memory:');
    // @ts-expect-error async callbacks are rejected by the type and at runtime
    expect(() => db.transaction(async () => 1)).toThrow(/synchronous/);
    // @ts-expect-error same guard on the BEGIN IMMEDIATE variant
    expect(() => db.immediateTransaction(async () => 1)).toThrow(/synchronous/);
    expect(db.transaction(() => 41 + 1)).toBe(42);
```

`packages/db/test/client.test.ts` — replace with:

```ts
    const db = openDatabase(':memory:');
    // why: the type rejects an async callback; Reflect.apply passes one untyped so the runtime guard is what is tested.
    expect(() => Reflect.apply(db.transaction, db, [async () => 1])).toThrow(/synchronous/);
    expect(() => Reflect.apply(db.immediateTransaction, db, [async () => 1])).toThrow(/synchronous/);
    expect(db.transaction(() => 41 + 1)).toBe(42);
```

`packages/db/test/client.test.ts` — find:

```ts
    applyMigrations(db, MIGRATIONS_DIR);
    // @ts-expect-error repository transaction callbacks are typed to return non-Promise values (Task 0.10's conditional type)
    expect(() => db.transaction(async () => insertLedgerRow(db))).toThrow(/synchronous/);
    // why: better-sqlite3 runs the callback up to its first await, so the insert happened; the rollback must undo it.
    expect(count(db, 'provider_requests')).toBe(0);
    // @ts-expect-error the same guard on the BEGIN IMMEDIATE variant (ruling 14)
    expect(() => db.immediateTransaction(async () => insertLedgerRow(db))).toThrow(/synchronous/);
    expect(count(db, 'provider_requests')).toBe(0);
```

`packages/db/test/client.test.ts` — replace with:

```ts
    applyMigrations(db, MIGRATIONS_DIR);
    // why: callbacks are typed to return non-Promise values (Task 0.10's conditional type); Reflect.apply bypasses the type.
    expect(() => Reflect.apply(db.transaction, db, [async () => insertLedgerRow(db)])).toThrow(/synchronous/);
    // why: better-sqlite3 runs the callback up to its first await, so the insert happened; the rollback must undo it.
    expect(count(db, 'provider_requests')).toBe(0);
    // why: the same guard on the BEGIN IMMEDIATE variant (ruling 14).
    expect(() => Reflect.apply(db.immediateTransaction, db, [async () => insertLedgerRow(db)])).toThrow(
      /synchronous/,
    );
    expect(count(db, 'provider_requests')).toBe(0);
```
`scripts/vitest.config.mjs` (new file):

```js
import { defineConfig } from 'vitest/config';

// The root Vitest project for repository scripts (decision 49): their tests sit beside them as scripts/*.test.mjs.
export default defineConfig({
  test: {
    name: 'scripts',
    include: ['*.test.mjs'],
    environment: 'node',
  },
});
```

`./vitest.config.ts` — find:

```ts
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
```

`./vitest.config.ts` — replace with:

```ts
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts', 'scripts/vitest.config.mjs'],
```

`scripts/check-boundaries.test.mjs` (new file):

```js
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// why: the boundary script guards the whole repository, so it is run, not imported (it exits the process);
// a scratch tree holds only what it reads, with planted files (reviews tsr2-012, arch-r3-006; decision 49:
// tests of root scripts live beside them in scripts/*.test.mjs, run by the root Vitest project `scripts`).
const REPO = resolve(import.meta.dirname, '..');
const SCRIPT = join(REPO, 'scripts/check-boundaries.mjs');
const PACKAGES = [
  'packages/core',
  'packages/db',
  'packages/providers',
  'packages/engine',
  'apps/api',
  'apps/web',
];
let scratch = null;

/** A scratch repository with every package.json, the airports data and the given files. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'gmt-boundaries-'));
  for (const p of PACKAGES) {
    mkdirSync(join(root, p), { recursive: true });
    copyFileSync(join(REPO, p, 'package.json'), join(root, p, 'package.json'));
  }
  mkdirSync(join(root, 'packages/db/data'), { recursive: true });
  for (const f of readdirSync(join(REPO, 'packages/db/data')).filter((n) => n.endsWith('.json'))) {
    copyFileSync(join(REPO, 'packages/db/data', f), join(root, 'packages/db/data', f));
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  scratch = root;
  return root;
}

const run = (root) => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });

afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('scripts/check-boundaries.mjs place and suppression checks (decisions 36, 46)', () => {
  it('a clean tree passes, with codes and cities in comments, identifiers and the two allowlisted files', () => {
    const r = run(
      tree({
        'apps/web/src/ok.ts':
          "// a JFK comment and London in prose\nconst ISO = 'ISO date'; export const ALL = 'ALL';\n",
        'apps/web/src/example.ts': "export const EXAMPLE_LABEL = 'London to New York'; const a = 'JFK';\n",
        'apps/api/src/tools/workedExample.ts': "export const X = ['LHR', 'JFK'];\n",
      }),
    );
    expect([r.status, r.stderr]).toEqual([0, '']);
  });

  it('an airport code or a metro city in a string literal fails, in web and api alike', () => {
    const r = run(
      tree({
        'apps/web/src/planted.tsx': "export const p = <p>{'from JFK'}</p>;\n",
        'apps/api/src/planted.ts': ['export const c = `New York $', '{1}`;\n'].join(''),
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('apps/web/src/planted.tsx names the airport code JFK');
    expect(r.stderr).toContain('apps/api/src/planted.ts names the city New York');
  });

  it.each([
    ['packages/db/test/x.test.ts', ['// biome', '-ignore lint/x: y'].join('')],
    ['packages/engine/src/y.ts', ['// @ts', '-expect-error why'].join('')],
    ['apps/web/src/z.tsx', ['const a = <p>{/* @ts', '-ignore */}</p>;'].join('')],
    ['packages/core/src/w.ts', ['/* eslint', '-disable */'].join('')],
    ['apps/api/test/v.test.ts', ['// @ts', '-nocheck'].join('')],
  ])('a suppression comment fails in any package: %s', (path, text) => {
    const r = run(tree({ [path]: `${text}\n` }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${path} has a lint or type-check suppression comment`);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions/form.test.tsx test/copy && pnpm exec vitest run --project scripts && pnpm --filter @gmt/core exec vitest run test/dates test/space && pnpm --filter @gmt/db exec vitest run test/enums.test.ts test/barrel.test.ts test/client.test.ts && pnpm -r typecheck && pnpm boundaries`
Expected: PASS, 23 web tests and 7 script tests; the core and db tests still pass; typecheck holds the `expectTypeOf` check; `pnpm boundaries` exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/examples scripts vitest.config.ts packages/core/test packages/db/test && git commit -m "wp09: Definitions form in pounds, metro expansion, confirmations with calls; place and suppression checks"
```

### Task 9.13: Definitions view, estimate-then-create flow, final App wiring

**Files:**
- Create: `src/views/Definitions/DefinitionsView.tsx`
- Modify: `src/App.tsx` (final form below)
- Test: `test/views/definitions/create.test.tsx`

**Interfaces:**
- Consumes: `DefinitionForm`, `CoverageCheck`, `EstimatePanel`, `BudgetFitPanel` (Task 9.12); every view of Tasks 9.5–9.11; `StatusBar` (Task 9.6); `POST /api/definitions/estimate` (`{ estimate, budgetFit }`), `POST /api/definitions` (with `confirmedCostPence?`), `PUT /api/definitions/:id` (`needsConfirmation`, `notices`).
- Produces: `DefinitionsView()`, the final `App()`.

The confirmation keeps both of decision 25's triggers visible and sent: the create button and the re-confirmation state about-calls with the hard stop and pounds, and send `confirmedCalls` beside `confirmedCostPence`, since on the $40 plan the pounds are £0 and the calls are what is committed (decisions 42–44). With `/providers` synthetic and real rows the red banner shows once.

- [ ] **Step 1: Write the failing test**

`test/views/definitions/create.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../../src/App.js';
import { EXAMPLE_LABEL } from '../../../src/example.js';
import { DefinitionsView } from '../../../src/views/Definitions/DefinitionsView.js';
import { API, coverageCheck, definition, estimate, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const pricedEstimate = estimate({ totalCostMicroGbp: 12_345, totalCostPence: 2 });
const estimateBody = (budgetFit = definition().budgetFit) => ({ estimate: pricedEstimate, budgetFit });
const importButton = `Import example (${EXAMPLE_LABEL})`;

async function importAndEstimate(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(await screen.findByRole('button', { name: importButton }));
  await user.click(screen.getByRole('button', { name: 'Show estimate' }));
}

describe('coverage check before saving (spec §1, §10, §11)', () => {
  it('posts the entered pairs, window and nights and shows cached cells of cells in band per pair per month', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/coverage-check`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(coverageCheck());
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: '?view=definitions' });
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    const table = await screen.findByRole('table', { name: 'Check free coverage' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Month', '2027-03', '2027-04']);
    expect(
      [...(within(table).getAllByRole('row')[1]?.querySelectorAll('th, td') ?? [])].map((c) => c.textContent),
    ).toEqual(['LHR → JFK', '5 of 372', '0 of 360']);
    expect(screen.getByText('14 free tile requests used')).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        origins: ['LHR', 'LGW'],
        destinations: ['JFK', 'EWR'],
        window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
        minNights: 10,
        maxNights: 21,
      },
    ]);
  });

  it('a month the check could not read, or did not return for a pair, is "not checked", never 0 (decision 25)', async () => {
    server.use(
      http.post(`${API}/definitions/coverage-check`, () =>
        HttpResponse.json(
          coverageCheck({
            pairs: [
              {
                origin: 'LHR',
                destination: 'JFK',
                months: [
                  { month: '2027-03', cachedRows: null, cellsInBand: 372 },
                  { month: '2027-04', cachedRows: 0, cellsInBand: 360 },
                ],
              },
              {
                origin: 'LGW',
                destination: 'JFK',
                months: [{ month: '2027-04', cachedRows: 2, cellsInBand: 360 }],
              },
            ],
            notes: ['the 2027-03 tile for LHR → JFK failed: rate-limit'],
          }),
        ),
      ),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    const table = await screen.findByRole('table', { name: 'Check free coverage' });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    expect(cells).toEqual([
      ['not checked', '0 of 360'],
      ['not checked', '2 of 360'],
    ]);
    expect(within(table).getAllByText('not checked')[0]).toHaveClass('italic');
    expect(screen.getByText('the 2027-03 tile for LHR → JFK failed: rate-limit')).toBeInTheDocument();
  });

  it('a check made for other airports or dates is marked out of date', async () => {
    const { user } = renderWithProviders(<DefinitionsView />);
    await user.click(await screen.findByRole('button', { name: importButton }));
    await user.click(screen.getByRole('button', { name: 'Check free coverage' }));
    await screen.findByRole('table', { name: 'Check free coverage' });
    expect(screen.queryByText(/changed since this check/)).toBeNull();
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
    expect(
      screen.getByText('The airports, window or nights changed since this check; run it again.'),
    ).toBeInTheDocument();
  });

  it('says what it needs when Travelpayouts is not configured', async () => {
    const base = providersResponse();
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({
          ...base,
          providers: base.providers.map((p) =>
            p.providerId === 'travelpayouts' ? { ...p, enabled: false } : p,
          ),
        }),
      ),
    );
    renderWithProviders(<DefinitionsView />);
    expect(await screen.findByText('The free coverage check needs TRAVELPAYOUTS_TOKEN.')).toBeInTheDocument();
  });
});

describe('estimate, then the create click as the explicit confirmation (spec §8.1, §11)', () => {
  it('estimates the unsaved body; Create, below the estimate, names calls and pounds and POSTs both confirmation figures', async () => {
    const estimates: unknown[] = [];
    const creates: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/estimate`, async ({ request }) => {
        estimates.push(await request.json());
        return HttpResponse.json(estimateBody());
      }),
      http.post(`${API}/definitions`, async ({ request }) => {
        creates.push(await request.json());
        return HttpResponse.json(
          definition({ id: 'def-0002', confirmedCostPence: 2, estimate: pricedEstimate }),
        );
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    const panel = await screen.findByRole('region', { name: 'Estimate' });
    expect(within(panel).getByText('126 cells')).toBeInTheDocument();
    expect(within(panel).getByText('Travelpayouts discovery: 14 calls · £0 · about 20s')).toBeInTheDocument();
    expect(
      within(panel).getByText('about 154 calls (hard stop 2000), £0.02 per run · about 10m'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('provider-month:searchapi: 616 estimated a month, cap 10000'),
    ).toBeInTheDocument();
    expect(estimates[0]).toMatchObject({ origins: ['LHR', 'LGW'], enabled: true });
    expect(estimates[0]).not.toHaveProperty('confirmedCostPence');
    const createButton = screen.getByRole('button', {
      name: 'Create and confirm about 154 calls (hard stop 2000), £0.02 per run',
    });
    // why: the operator sees the breakdown before the amount they confirm (review UI-11).
    expect(panel.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(creates).toEqual([]);
    await user.click(createButton);
    await expect.poll(() => creates.length).toBe(1);
    expect(creates[0]).toMatchObject({
      origins: ['LHR', 'LGW'],
      enabled: true,
      confirmedCostPence: 2,
      confirmedCalls: 154,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created. Scheduled runs use the calls and cost you confirmed.',
    );
  });

  it('editing after an estimate replaces Create with "show the estimate again" until re-estimated', async () => {
    server.use(http.post(`${API}/definitions/estimate`, () => HttpResponse.json(estimateBody())));
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    await screen.findByRole('button', { name: /Create and confirm/ });
    await user.clear(screen.getByLabelText('Max nights'));
    await user.type(screen.getByLabelText('Max nights'), '14');
    expect(screen.queryByRole('button', { name: /Create and confirm/ })).toBeNull();
    expect(
      screen.getByText('The draft changed since this estimate; show the estimate again before creating.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show estimate' }));
    expect(await screen.findByRole('button', { name: /Create and confirm/ })).toBeInTheDocument();
  });

  it('a budgetFit miss is shown as an alert before the create click', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          estimateBody({
            fits: false,
            runsPerMonth: 4,
            perScope: [{ scope: 'provider-month:searchapi', estimated: 12000, cap: 10000, fits: false }],
          }),
        ),
      ),
    );
    const { user } = renderWithProviders(<DefinitionsView />);
    await importAndEstimate(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Does not fit every cap at 4 runs a month:');
    expect(alert).toHaveTextContent(
      'provider-month:searchapi: 12000 estimated a month, cap 10000over the cap',
    );
    expect(screen.getByRole('button', { name: /Create and confirm/ })).toBeInTheDocument();
  });
});

describe('saved definitions (spec §8.1)', () => {
  it('a save that raises the estimate above the confirmation asks again with calls and pounds; Confirm PUTs ceil(estimate / 10 000)', async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/definitions/:id`, async ({ request }) => {
        puts.push(await request.json());
        return HttpResponse.json(
          puts.length === 1
            ? definition({
                needsConfirmation: {
                  estimateMicroGbp: 2_500_000,
                  totalCalls: 300,
                  confirmedCostPence: 100,
                  confirmedCalls: 154,
                },
              })
            : definition({ confirmedCostPence: 250, confirmedCalls: 300 }),
        );
      }),
    );
    const { user } = renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'The new estimate, about 300 calls (hard stop 2000) and £2.50 per run, is above what you confirmed (154 calls, £1). Scheduled runs are skipped until you confirm.',
      ),
    ).toBeInTheDocument();
    expect(puts[0]).not.toHaveProperty('confirmedCostPence');
    await user.click(
      screen.getByRole('button', { name: 'Confirm about 300 calls (hard stop 2000), £2.50 per run' }),
    );
    // why: the call trigger comes from the contract's needsConfirmation (decisions 42, 43), never from a stale estimate.
    await expect.poll(() => puts.at(-1)).toEqual({ confirmedCostPence: 250, confirmedCalls: 300 });
  });

  it("shows the definition's notices from the API", async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([definition({ notices: ['alerts running on calendar basis only'] })]),
      ),
    );
    renderWithProviders(<DefinitionsView />, { search: '?view=definitions&edit=def-0001' });
    const list = await screen.findByRole('list', { name: 'Notices for this definition' });
    expect(within(list).getByText('alerts running on calendar basis only')).toBeInTheDocument();
  });

  it('a failed definitions load shows the reason and a retry', async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<DefinitionsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
  });
});

describe('the App (spec §11 layout)', () => {
  it('filter state persists across a view switch, and the status bar is on every view', async () => {
    const { user } = renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&f.class=partially-verified',
    });
    const table = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    await user.click(within(nav).getByRole('link', { name: 'Providers' }));
    expect(await screen.findByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Run status' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Results' }));
    const again = await screen.findByRole('table', { name: 'Round trips found' });
    expect(within(again).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'partially verified' })).toBeChecked();
  });

  it('with /providers synthetic and real rows the red banner shows once (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=results&def=def-0001' });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.getAllByText(/Synthetic data: the fixture provider is enabled/)).toHaveLength(1);
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

- [ ] **Step 2b: Prove the create click is the confirmation**

After Step 3, temporarily drop `confirmedCalls` from the body `create` sends in `DefinitionForm`. Run the create test: "estimates the unsaved body; Create … POSTs both confirmation figures" fails at `toMatchObject` on `creates[0]` (missing `confirmedCalls: 154`). Restore it.

- [ ] **Step 3: Implement**

`src/views/Definitions/DefinitionsView.tsx` (new file):

```tsx
import { useDefinitions, useProviders } from '../../api/queries.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { DefinitionForm } from './DefinitionForm.js';

/**
 * Spec §11 Definitions: pick a definition to edit or start a new one (`edit=new`, the default). It
 * edits configuration, not a run, so it has no run header; the status bar names the run here too.
 */
export function DefinitionsView() {
  const providers = useProviders();
  const definitions = useDefinitions();
  const params = useSearchParams();
  const editing = params.get('edit') ?? 'new';
  if (providers.error) return <LoadError error={providers.error} retry={() => void providers.refetch()} />;
  if (definitions.error)
    return <LoadError error={definitions.error} retry={() => void definitions.refetch()} />;
  if (providers.data === undefined || definitions.data === undefined) return <Loading />;
  const current = definitions.data.filter((d) => d.deletedAt === null);
  const existing = editing === 'new' ? null : (current.find((d) => d.id === editing) ?? null);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{COPY.definitionsHeading}</h2>
      <ul aria-label={COPY.definitionsList} className="flex flex-wrap gap-2 text-sm">
        <li>
          <a
            href={hrefWith({ edit: 'new' })}
            onClick={navigateTo({ edit: 'new' })}
            aria-current={editing === 'new' ? 'page' : undefined}
            className="inline-flex min-h-11 items-center underline"
          >
            {COPY.newDefinition}
          </a>
        </li>
        {current.map((d) => (
          <li key={d.id}>
            <a
              href={hrefWith({ edit: d.id })}
              onClick={navigateTo({ edit: d.id })}
              aria-current={editing === d.id ? 'page' : undefined}
              className="inline-flex min-h-11 items-center underline"
            >
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

`src/App.tsx` — replace the file (final):

```tsx
import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { LoadError } from './components/LoadState.js';
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

/**
 * Spec §11 layout: synthetic banner, header with nav and definition selector, status bar on every
 * view. When /providers fails, the page says provider status is unknown instead of silently showing
 * no banner (decision 36); the views stay inside a boundary so a render error never blanks the page.
 */
export function App() {
  const params = useSearchParams();
  const view = parseView(params.get('view'));
  const providers = useProviders();
  const definitions = useDefinitions();
  const list = (definitions.data ?? []).filter((d) => d.deletedAt === null);
  const requested = params.get('def');
  const selectedId = requested ?? list[0]?.id ?? null;
  const selected = list.find((d) => d.id === selectedId) ?? null;
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  const needsDefinition = view === 'results' || view === 'coverage';
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
      {providers.error ? (
        <p role="alert" className="bg-red-100 px-4 py-2 font-semibold text-red-900">
          {COPY.providersUnknown(providers.error.message)}
        </p>
      ) : null}
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-300 px-4 py-2">
        <h1 className="text-lg font-bold">{COPY.appTitle}</h1>
        <Nav current={view} />
        <DefinitionSelector definitions={list} selectedId={selectedId} />
      </header>
      <StatusBar definition={selected} showRunNow={view === 'results' || view === 'definitions'} />
      <main className="px-4 py-3">
        <AppBoundary>
          {noProviders ? (
            <p className="mb-3 rounded border border-slate-400 p-3">{COPY.emptyNoProviders}</p>
          ) : null}
          {definitions.error ? (
            <LoadError error={definitions.error} retry={() => void definitions.refetch()} />
          ) : null}
          {needsDefinition && definitions.data !== undefined && selected === null ? (
            <p>{requested !== null ? COPY.definitionNotFound : COPY.noDefinitions}</p>
          ) : null}
          {view === 'results' && selected !== null ? <ResultsView definition={selected} /> : null}
          {view === 'coverage' && selected !== null ? <CoverageView definition={selected} /> : null}
          {view === 'calendar' || view === 'duration' || view === 'history' || view === 'alerts' ? (
            <Placeholder hint={view === 'calendar' ? COPY.calendarPlaceholderHint : null} />
          ) : null}
          {view === 'definitions' ? <DefinitionsView /> : null}
          {view === 'providers' ? <ProvidersView /> : null}
        </AppBoundary>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/web exec vitest run test/views/definitions test/app test/copy`
Expected: PASS, 13 + 23 + 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: Definitions view, create-and-confirm in calls and pounds; final App wiring"
```

### Task 9.14: Banned-word sweep over every rendered view

**Files:**
- Test: `test/copy/renderedSweep.test.tsx`

**Interfaces:**
- Consumes: `App` (Task 9.13), `findBannedWords`, `BANNED_WORD_ALLOWLIST` (WP0).
- Produces: nothing new; closes spec §9 item 6's banned-word row for WP9's views.

Every view renders with `synthetic: true`, a paused run, every verdict class in the URL (core hides `failed` by default, spec §6.9, so the URL asks for all four), a truncated calendar row, the calendar-gap banner, every results row expanded, and the Definitions advanced fold open; the sweep reads the text and every `title`, `aria-label`, `placeholder` and `alt`, and checks that every "£" in the DOM sits inside a `PriceCell`, a `[data-cost]` element (a cost or cap: the status bar's spend, Run now, the estimate, View D's ledger cost, the confirmation) or a form label (reviews tsr-003, prov-r2-007).

- [ ] **Step 1: Write the failing test**

`test/copy/renderedSweep.test.tsx`:

```tsx
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { VIEWS } from '../../src/state/view.js';
import {
  API,
  calendarGap,
  calendarRow,
  execution,
  failedRow,
  partialRow,
  providersResponse,
  resultsResponse,
  verifiedRow,
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

describe('rendered views contain no banned word, and no "£" outside a price or a cost (spec §11, §9 item 6)', () => {
  for (const view of VIEWS) {
    it(`view=${view}`, async () => {
      server.use(
        http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))),
        http.get(`${API}/executions/:id`, () =>
          HttpResponse.json(
            execution({ status: 'paused_budget', reason: 'searchapi provider-month cap reached' }),
          ),
        ),
        http.get(`${API}/definitions/:id/results`, () =>
          HttpResponse.json(
            resultsResponse({
              rows: [verifiedRow(), partialRow(), failedRow(), calendarRow({ truncated: true })],
              truncated: true,
              total: 4210,
            }),
          ),
        ),
        http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())),
      );
      // why: core's filterRows hides failed rows by default (spec §6.9); every class is in the URL so every row's copy is swept.
      const classes = 'f.class=verified,partially-verified,failed,unchecked';
      const { user } = renderWithProviders(<App />, { search: `?view=${view}&def=def-0001&${classes}` });
      await screen.findByRole('navigation', { name: 'Views' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      if (view === 'results') {
        await screen.findByRole('table', { name: 'Round trips found' });
        for (const b of screen.getAllByRole('button', { name: /Show details/ })) await user.click(b);
        expect(screen.getAllByRole('button', { name: /Hide details/ })).toHaveLength(4);
      }
      if (view === 'definitions')
        await user.click(await screen.findByText('Advanced: constraints and policy'));
      const hits = findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST);
      expect(hits.map((h) => h.word)).toEqual([]);
      expect(poundsOutsidePrices()).toEqual([]);
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
Expected: PASS, 6 + 4 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "wp09: banned-word sweep over every rendered view"
```

## 9. Pinned review-focus tests

The plan's Review Focus lines this package owns:

- **Review focus 1 (WP9 half): "Operator types a lowercase or metropolitan IATA code (`lhr`, `LON`, `NYC`) into the Definitions form or the example JSON. Expected: upper-cased before validation; a metro code is rejected with a message naming it as a city code and listing the airports the table maps to it."** WP1 owns the rejection and its message; WP9 owns the form, where decision 44 goes one step further: a metro code the airports table maps expands to its member airports on Enter or Add and says so. Pinned in Task 9.12, `test/views/definitions/form.test.tsx`: "upper-cases a three-letter code on blur, and only a three-letter code", "Enter adds without a blur, a pasted " lgw " is trimmed, and a duplicate is refused", "a metro code expands to its member airports on Enter / on Add, before the autocomplete answers", and the field-error table whose first case is the API's `origins.0` metro-code message under Origins, linked to the input (the API stays the validator for a code the table does not know). The API's `iataSchema` also upper-cases, so the blur rule is the visible half, not the only one. The example JSON path is covered by `EXAMPLE_DEFINITION` being parsed through `definitionCreateRequestSchema` at load; WP12's test keeps the JSON and the import equal.

Review focus 3 (browser outside Europe/London) is WP10's; every date the web prints goes through `format.ts`, which formats by string slicing and epoch-day arithmetic, never through `Date`, so WP10's `TZ` test covers the Results date columns without a change here.

## 10. Definition of done

Run from the repository root, in order; each must give the stated outcome.

1. `pnpm install --frozen-lockfile` → exits 0 (no dependency changes: WP0 pinned every web dependency).
2. `pnpm lint:fix && pnpm lint` → `biome check` reports no errors.
3. `pnpm --filter @gmt/web typecheck` → exits 0 (both `tsconfig.json` and `tsconfig.test.json`). `pnpm -r typecheck` → exits 0.
4. `pnpm --filter @gmt/web test` → 227 tests pass in 18 files, none skipped, and the coverage report meets **lines ≥ 70%, statements ≥ 70%, functions ≥ 70%, branches ≥ 60%** for `apps/web/src` and **100% on every metric** for `Provenance.tsx`, `PriceCell.tsx`, `PriceBoundary.tsx`, `BookingAction.tsx`, `urlState.ts` and `resultsState.ts`, with no threshold error. The floors are the spec §9 web floors; the 100% files are the ones whose gaps would be provenance, link or state gaps.
5. `pnpm --filter @gmt/core test` → 100% on every metric with Task 9.0's additions and the four `test:tz` runs green. `pnpm exec vitest run --project scripts` → the boundary script's 7 tests pass. `pnpm test` → every package and the `scripts` project green with their thresholds.
6. `pnpm boundaries` → exits 0: `@gmt/web` imports no workspace package except `@gmt/core`; no airport code or metro city name appears in a string literal of `apps/web/src` or `apps/api/src` outside `apps/web/src/example.ts` and `apps/api/src/tools/workedExample.ts`; no package's `src` or `test` holds a `biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` comment (the one suppression check, decision 49).
7. `pnpm casts` (WP7's `scripts/check-casts.mjs`, decision 48) → exits 0: no `as` except `as const`, and no angle-bracket assertion, in `apps/web` or Task 9.0's core files.
8. `pnpm --filter @gmt/web build` → exits 0 and writes `apps/web/dist/index.html` plus hashed assets under `apps/web/dist/assets/`.
9. `grep -rn "style={" apps/web/src` → no output (spec §4 CSP `default-src 'self'` blocks inline styles).
10. `grep -rn "process\.env\|import\.meta\.env" apps/web/src` → no output (no mode gate: responses are parsed in every mode).
11. With WP8 merged: `pnpm dev`, open `http://localhost:5173/?view=providers` (API calls go to `/api` through the Vite proxy) with `ALLOW_FIXTURE_PROVIDER=i-understand-this-is-fake`, `NODE_ENV=development`, `DATABASE_PATH=./data/dev.fixture.db` → the red synthetic banner shows on every view; without those three variables and with `TRAVELPAYOUTS_TOKEN` set → no banner, and "Check free coverage" on Definitions returns a table. Record both screenshots in the PR.

## 11. Open questions

None requires the operator's judgement. The items review rounds 1 and 2 marked "needs judgment" were ruled by the operator (decisions 36, 42, 44, 46, 48, 49) and are folded into the tasks: the headline through `PriceCell`, following the filters (Task 9.8); contract parsing in every mode (Task 9.3); the place-name check on string literals with a committed word list, and one suppression check in the boundary script for every package (Task 9.12); the departure-date filter and the run's `expandTop` in core (Task 9.0); staleness by fetch age with "vendor's cache age unknown" as a label (Tasks 9.1, 9.8); the unconfirmed-price badge wherever a price renders, never a double negative, and why the calendar gap needs none (Tasks 9.1, 9.7, 9.8, 9.9); one micro-GBP→pence rounding, core's `microGbpToPence` (Tasks 9.1, 9.3, 9.12); calls sent and stated with every confirmation, worded "about N calls (hard stop M)" (Tasks 9.6, 9.12, 9.13); metro codes expanding on Enter or Add (Task 9.12); the shared names of decision 46 (`format.ts`, `PriceCell` `compact`, `ViewHeader variant="span"`); the `/providers` error state and the synthetic tests (Tasks 9.5, 9.8, 9.13); "searched" kept with "with a price" beside it (Task 9.10); the provider's own search link kept, a Google Flights deep link and a max-travel-time filter in Phase 4 (decision 36); the native datalist accepted.

## 12. Changes outside `apps/web`

- `packages/core` (Task 9.0): `truncated: z.boolean()` on `priceCellSchema` and `resultRowSchema`; `expandTop` on `executionSummarySchema`; `ResultFilters.departure` and its check in `filterRows`; `formatAgo` and `formatFetchedAgo` exported from `labels/age.ts` (the private `ago` is gone); `test/helpers/rows.ts` and `test/api-contract/contract.test.ts` gain `truncated: false`; a new `test/results/webAdditions.test.ts`. Recorded in decisions 36 and 42.
- `scripts/check-boundaries.mjs` (Task 9.12): the place-name check over string literals (decisions 36, 46), reading the airports dataset and `metros.json` from `packages/db/data` with `NOT_AIRPORT_WORDS`, and the one suppression-comment check over five tokens (decisions 46, 49); `scripts/check-boundaries.test.mjs` runs it against scratch trees, under the new root Vitest project `scripts` (`scripts/vitest.config.mjs`, added to the root `vitest.config.ts`).
- `packages/core/test/dates/epochDay.test.ts`, `packages/core/test/space/validate.test.ts`, `packages/db/test/enums.test.ts`, `packages/db/test/barrel.test.ts`, `packages/db/test/client.test.ts` (Task 9.12): their nine `@ts-expect-error` type tests restructured (`Reflect.apply`, `expectTypeOf`, a barrel-source assertion), so the suppression check passes on main (decision 49).
- `docs/examples/london-new-york.json` (Task 9.12): a stand-in only when absent; WP12 owns it.

## 13. For the plan (not yet recorded there)

1. **WP10 and WP11 restructure their suppressed code.** Once this brief's check lands, `pnpm boundaries` fails on any suppression comment (decision 49). WP10 as written puts four `// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole` comments on its APG grid, and WP11's definition of done keeps "the one biome-ignore in templates.ts"; both revisions restructure that code instead (for the grid, an interactive element carrying the role, or the grid built on a `table` the rule accepts). WP10 Task 10.4 also still lists `PriceCellProps.compact` as its own product; WP9 now produces it (decision 46), so WP10 adds props to WP9's `PriceCell` rather than producing one.
2. **WP8's staleness follows spec rev 23 §3.** The WP8 brief's `staleness()` still returns `stale: true` for an unknown vendor age and says "unknown age is stale"; decision 44 and spec rev 23 make an unknown vendor age aged by fetch time and labelled, not stale. WP9's fixtures (`stale: false` with `ageHours: 'unknown'`) and its stale banner assume the new rule, so WP8's revision must adopt it before WP9's views meet real data.
3. **WP7's cast-check test location.** Decision 49 puts tests of root scripts in `scripts/*.test.mjs` under the `scripts` project this brief creates; WP7's `scripts/check-casts.mjs` test is briefed at `packages/engine/test/check-casts.test.ts` and moves beside its script when either package next touches it.
