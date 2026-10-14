# get-me-there — Flight Price Intelligence & Flexible-Date Optimiser

**Design spec, revision 12.** Written 2026-10-14. Every section is self-contained; nothing refers to a prior revision. Status: **approved by Ian on 2026-10-14 at revision 8** after
four full-roster reviews (145, 140, 126 and 101 findings; zero Critical since
revision 2) and the provider spike. Revision 9 folds in the three decisions
taken at approval (the self-scraping fallback in §2, the dashboard readings in
§2 facts 4 and 7, the $40 plan in §1) and changes no design rule; revision 10
records the contract corrections found while drafting the fourteen work
briefs (§17), none of which changes what the operator sees; revision 11
records the rules settled by the first reviews of those briefs. Review
summaries and the spike record live outside the repository (the operator's
private notes), not in `docs/`; the changelog in §17 maps every finding ID.
The implementation plan under `docs/superpowers/plans/` and the work briefs
under `docs/briefs/` derive from this revision.

This document is the single source of truth for what gets built. The
implementation plan and every per-package work brief derive from it. Where
the original prompt and this spec disagree, this spec wins; the differences
are deliberate and listed in §15.

---

## 1. Purpose and success criteria

The operator makes a long-haul round trip several times a year, has
flexible dates, and wants the cheapest fare that can actually be booked
across a multi-month departure window and a range of stay lengths, without
manually checking date combinations.

**The app is route-agnostic and the docs never name the operator's own
route.** Every search definition carries its own origin and destination
airports, any IATA codes present in the airports table, and nothing about
any specific city or country exists in application code. The worked example
used throughout this spec and in `docs/setup.md` (importable as JSON) is
**London → New York: LHR and LGW to JFK and EWR**, 10–21 nights over a
182-day window; its numbers are illustrations, not defaults.

**Success looks like:** with provider credentials configured, scheduled
searches keep a ranked table, a calendar heatmap and a price-vs-stay chart
current for the configured space, within a configurable spend ceiling, and
email Ian when an itinerary that satisfies his constraints drops under a
threshold. Every price on screen says where it came from, how old it is,
and whether its constraints were checked. The coverage view makes it
impossible to mistake "not searched" for "no flights".

The headline number is the **cheapest round trip found** and always carries
its basis, verdict class, provider and age. Never "cheapest bookable". The
banned-word list for all user-facing text is in §11 and is a single list.

**Configurations the app must support.** The SearchApi free allowance is a
one-off balance of 100 credits (dashboard wording, §2 fact 7), so the **£0
configuration is Travelpayouts-only**, and SearchApi in practice means the
$40/month plan, which is Ian's approved ceiling and the plan he is
subscribing to (decision 2026-10-14).

| Providers | Discovery | Verification | What the operator gets |
|---|---|---|---|
| none | – | – | empty state explaining what to configure |
| Travelpayouts only (£0) | Travelpayouts | none | calendar basis (§6.9) from whatever Aviasales users recently searched for the definition's pairs; every row labelled "constraints not checked" with the inapplicable constraints named and a search link. Coverage is route-dependent and often thin: the Definitions form's **coverage check** (free, §10) reports cached rows per pair before anything is saved. The spike measured a thin long-haul route at zero cached rows over eight months and busy gateways on the same country pair at four to six a month |
| SearchApi $40 | SearchApi calendar | SearchApi | full product, scraping-derived, labelled |
| both (recommended at $40) | both | SearchApi | authorised cached baseline plus scraped verification |

**What £0 gives, honestly:** cached calendar prices only, no constraints
checked, and coverage that depends entirely on what Aviasales users have
searched for the chosen pairs. The coverage check shows this before a
definition is saved, the Results header shows the coverage line on every
run, and per-cell verify is hidden. The spike (2026-10-14) found that a
thin long-haul destination can have **no** cached rows at all across eight
months while the busy gateways of the same country have four to six a
month, so a £0 definition may only be useful against gateways, with the
operator's own per-destination note ("onward leg not included") on those
rows.

**What $40 buys over £0:** thin routes that the free cache never sees,
fully priced calendars (126 of 126 cells on every probe), itinerary search on `maxCells`
cells per run with real segments, per-seller prices, baggage and constraint
verdicts, and a free 60-day route price history. On a subscription plan the
marginal cost per call is zero and the plan's 10,000 calls a month is the
hard stop; the worked example uses ~615 of them a month, so raising
`maxCells` to ~200 per run (~1,090 per run) or running daily (~4,300 a
month) both fit (§8.2).

**Non-goals for this build**: ground transport, rail, accommodation,
multimodal totals (§7 keeps two columns; the operator may enter an
onward-cost estimate shown as a separate "adjusted" sort, never folded into
a price); split-ticket optimisation; booking inside the app; multi-user;
price prediction; any provider not in §2 (the self-scraping fallback named
in §2 is a Phase 4 option, not built).

---

## 2. Provider landscape and decisions (the gating constraint)

Researched 2026-10-14; full report with sources in `docs/providers.md`.

**There is no authorised, individually accessible, live fare API in late
2026.** Amadeus Self-Service was decommissioned on 2026-07-17. Duffel bans
metasearch and bills every search for a non-booking account. Kiwi,
Skyscanner, Trip.com and all GDS/NDC routes are closed to individuals.
Google has no public API.

| Provider | Nature | Cost | Role | `sourceKind` | `maxAgeHours` |
|---|---|---|---|---|---|
| Travelpayouts `/aviasales/v3/prices_for_dates` (`month` tiles: `departure_at=YYYY-MM`, `one_way=false`, no `return_at`; origin is an airport code, or the metro code when the definition's origins share one, rows split by `origin_airport`; paginated at 1000) | Authorised. Cached from Aviasales user searches, last 48h; **no** `found_at` on rows; `market` ignored; economy only; coverage of thin routes can be zero (spike) | Free, 600/min | Discovery baseline | `authorised-cached` | 48 |
| SearchApi `google_flights_calendar` | Scraping-derived aggregate of Google's date grid; ≤200 combinations per call (HTTP 400 above); per airport only (city codes rejected); entries `{departure, return, price, is_lowest_price}` in the request currency; 126/126 cells priced on every probed route including a thin one (spike); 9–29 s per call | trial 100 once; $40/10k per month | Discovery, opt-in | `scraped-aggregate` | 24 (declared, conservative assumption: a repeat call answered in 3 s and was not billed, so a vendor cache exists; its window is undocumented) |
| SearchApi `google_flights` | Scraping-derived itinerary search, three steps; some options carry no `price`; step 3 reveals OTA prices below the airline fare, so step 3 is always run (§5.4) | same plan | Verification, opt-in | `scraped-search` | 0 (interactive search at request time) |

**Decision (Ian, 2026-10-14):** SearchApi is accepted as an opt-in provider,
on the understanding that its data is obtained in a way Google's terms
prohibit, one step removed from this app; the realistic risk is continuity
and the mitigation is the provider abstraction and labelling. SerpApi is not
integrated.

**Continuity fallback (Ian, 2026-10-14): self-scraping is a named Phase 4
option, not built.** If SearchApi is withdrawn, re-priced above the ceiling
or loses Google's date grid, the replacement is a `FlightProvider` adapter
that drives Google Flights in a Camoufox browser (an anti-detection Firefox
build) through Playwright, behind the same contract, ledger, caps and labels
as every other provider. It is not built in Phases 1–3 because the original
prompt excluded brittle scraping that violates provider terms and
self-scraping moves that exposure from a vendor onto the operator's own
server and IP address; because it needs residential proxies and selector
maintenance against a frontend that changes without notice; because a page
load takes 5–10 s and a CAPTCHA stalls an unattended 05:00 run; and because
it adds a 400 MB browser and a second runtime to a one-process image, to
save roughly £32 a month. The design keeps the door open and nothing more:
`ProviderId` and `SourceKind` are **not** widened now. When the adapter is
built it adds `'camoufox'` to `ProviderId`, a `SourceKind` of
`'scraped-self'` with its own `maxAgeHours`, a `provenanceNote` naming the
method, and its own hostname allowlist; every page load is a ledger row
under the free-provider rules with its own per-execution call cap; its
prices render under the same provenance and banned-word rules. No other
package changes.

**Consequences baked into the design:**

- `sourceKind` and `maxAgeHours` are declared per capability and stamped on
  every stored price row. Every price carries `fetchedAt` (set by http-kit,
  the original `storedAt` on a cache hit, the **oldest** call of a
  multi-step chain) and `providerObservedAt` only when the vendor states
  it. Nothing is defaulted.
- The engine's cells are `(origin, destination)` airport pairs from the
  definition. SearchApi is queried per airport pair (it rejects city
  codes). Travelpayouts is queried per (origin, destination, month) by
  airport code, or once per (metro, destination, month) when several of
  the definition's origins share a metro code in the airports table, with
  rows attributed by their `origin_airport` field, which the spike proved
  is always present; rows for airports outside the definition are
  dropped. No airport, city or country is named in application code. `point_of_sale` is `'unknown'` for Travelpayouts because the
  `market` parameter is ignored, and `'GB'` for SearchApi, which echoes
  `gl=gb`.
- Adapters return raw vendor shapes: native currency **read from the
  response** (a response that states no currency is a `parse` error unless
  a recorded fixture proves the vendor's convention), vendor times, vendor
  links. The engine normalises.
- The app runs with zero, one or both providers.
- Synthetic data exists only behind the gates in §5.5.

**Spike results (2026-10-14; the full record and redacted fixtures are
kept privately by the operator outside the repository, and WP4b re-records
equivalent fixtures on the public example route).** Eleven SearchApi trial
calls and ~175 free Travelpayouts calls settled every open fact:

1. Travelpayouts: airport attribution proven (`origin_airport` on every
   row); `currency=gbp` honoured; `market` ignored (point of sale unknown);
   `trip_class` ignored (economy only); no `found_at` on
   `prices_for_dates` rows; coverage on a thin long-haul route zero to two
   rows over eight months, on busy gateways four to six a month;
   `grouped_prices` unusable with a nights band; cheapest tiling is one
   `prices_for_dates` call per (destination, month) with the origins'
   shared metro code (`LON` in the example).
2. SearchApi calendar: 200-combination limit enforced as HTTP 400; per
   airport only; every probed route fully priced, thin ones included; 9–29 s
   latency; ~23 rectangles per pair for the default band (8 outbound days ×
   the 19-day return span a 12-night band needs; 152 combinations).
3. SearchApi chain: step-1 price equals the step-2 price for the cheapest
   pairing (£603); step 3 showed an OTA at £573, so **the parity assertion
   fails** and `bookingLinks` is forced on (§5.4). Two of nine step-1
   options and one of three step-2 options carried no price.
4. SearchApi caching: a repeat call answered in 3 s with a new search id.
   The dashboard read **91 remaining of 100** after eleven HTTP 200 calls,
   one HTTP 400 and one HTTP 401, so at most nine were billed: error
   responses are not billed and the cached repeat was not. The ledger
   still counts every HTTP 200 attempt against the call cap (it may
   overcount the vendor, never undercount), and `SEARCHAPI_CACHE_TTL_HOURS`
   stays 1 as the local cache window; the vendor's window is undocumented.
5. Error bodies recorded: SearchApi 401 `{"error":"Invalid API key."}` and
   400 with a descriptive message; Travelpayouts 401 plain `Unauthorized`.
   No 429 or quota body observed yet; the adapters map those by status and
   ledger state until one is recorded.
6. Carriers: both providers returned the relevant national and
   connecting carriers for the probed country pair.
7. The dashboard labels the allowance "Remaining free searches (credits)":
   a one-off credit balance, not a recurring monthly allowance, so the
   `trial` plan uses a **lifetime** window and the £0 configuration is
   Travelpayouts-only. Ian is subscribing to the $40 plan (2026-10-14).
8. Both vendors accept the key in a header (`Authorization: Bearer`,
   `X-Access-Token`); no key is ever sent in a URL.

A bonus: `google_flights` step 1 returns `price_insights.price_history`, a
60-day daily series of the route's lowest price, stored on every
verification as a free history source (§7 `route_price_history`).

---

## 3. Core concepts and vocabulary

- **Search definition** — the operator's intent: origins, destinations,
  window (absolute or **relative**), nights range, cabin, constraints,
  verification policy, budget, providers, optional schedule, optional
  standing cost confirmation, optional onward-cost estimates.
- **Cell** — `(origin, destination, departureDate, returnDate)`. The atomic
  unit of coverage. The **search space** is resolved at execution start.
- **Search execution** — one run over a resolved space with a definition
  snapshot, stages, seeded per-cell-per-provider outcomes, an estimate and
  a ledger. Resumable. A **child execution** verifies one cell on demand.
- **Discovery** — stage 1, calendar prices, no verdicts.
- **Verification** — stage 2, itinerary search for selected cells.
- **Itinerary** — the flights; identity by canonical hash (§6.4).
- **Fare offer** — `(itinerary, provider, seller, cabin)`.
- **Price observation** — an offer seen at a moment, with the constraint
  inputs that were available (`supplied_fields_json`); verdicts are
  recomputed at read time.
- **Cell outcome** — per `(execution, cell, stage, provider)`: status
  `not_run | priced | empty | no_data | error | skipped`, `reason`,
  `attempts` (engine passes), `fetched_at`, `min_pence`, `cabin`,
  `point_of_sale`, `source_kind` (so reuse can match outcomes that have no
  price row), `reused_from_execution_id` (always the execution that fetched
  the price).
  Seeded `not_run` at start for every cell × discovery provider, and at
  selection time for every cell × verification provider (non-selected →
  `skipped:not_selected`). A stage with **no provider configured has no
  outcome rows and a `NULL` roll-up** (`not_applicable` in the API).
  - `priced`: the provider returned a price for exactly this cell, and at
    least one price or offer was written. Note `partial-expansion` when
    some expansions failed; note `offers-dropped:n` when offers could not
    be normalised.
  - `empty`: positive "no fares" for this cell.
  - `no_data`: the call covered the cell but had nothing cached or computed.
    Not evidence that no flights exist. Also, with reason `cabin-not-offered`,
    every cell of a provider whose `cabins` excludes the definition's cabin;
    no call is made and parity is unaffected.
  - `error`: `reason` is the `ProviderError.kind`, or `fx-unavailable`,
    `currency-unsupported`, `unknown-airport-tz`, `no-return-legs`,
    `unmappable-carrier`; the vendor's message, URL-stripped, is in
    `last_error`, never in `reason`.
  - `skipped`: `reason ∈ not_selected | budget | provider_disabled | departed`.
  - Coverage is always shown as **six buckets**: priced, no fares (`empty`),
    no cached data (`no_data`), error, skipped (reasons in the drill-down),
    not searched (`not_run`); they sum to the cell count. "Searched" as an
    umbrella (`priced + empty + no_data`) appears only in View D beside the
    breakdown. Reused outcomes count in their bucket and the header adds
    "(R reused from earlier runs)".
  - A cell interrupted mid-flight returns to `not_run`.
- **Cell roll-up** — §6.6 precedence, stored, recomputed with every write.
- **Verdict** — `pass | fail | unverified`; **class** `verified` (all pass),
  `partially-verified`, `failed`; calendar prices are `unchecked`. The word
  "verified" is reserved for the class. Stage counts use
  **"itinerary-searched"**.
- **Provenance** — `{ providerId, sourceKind, fetchedAt, providerObservedAt?, maxAgeHours: number | 'unknown', fx: { converted: false } | { converted: true; rateNano; rateDate; source }, pointOfSale: <ISO 3166-1 alpha-2, the vendor's echo of `POINT_OF_SALE`> | 'unknown', cabin }`.
- **Effective age** — `providerObservedAt` age if present; else `fetchedAt`
  age + `maxAgeHours`; else (`'unknown'`) unknown, treated as stale and
  labelled. Two label formats are defined once in `core`: the full form
  "fetched 2h ago · provider age unknown (≤7d before that)" for tooltips,
  headers and email, and the compact row form "2h ago · ≤7d" for table
  cells and calendar days.

---

## 4. Architecture

Single Node process (API + engine + scheduler) serving a built React SPA,
one SQLite file, one container. Optional Mailpit for local email.

| Package | May import | Owns |
|---|---|---|
| `core` | `zod`, `@noble/hashes`, `@date-fns/tz` (instants and DST; calendar dates stay epoch-day integers) | Types; ports `FlightProvider`, `BudgetGuard`, `ResponseCache`, `Notifier`, `Logger`, `Clock`; errors; the config zod schema (pure) and `syntheticAllowed`; `api-contract`; every §6 function; the label formatter. 100% coverage. |
| `db` | `core` | Schema, migrations, repositories; `BudgetGuard`, `ResponseCache` implementations; airport and FX repositories; `app_lock`; seed. |
| `providers` | `core` | Adapters (raw shapes); `createHttpKit({ budget, cache, limits, clock, log })` over `globalThis.fetch`; the fixture provider, which is an ordinary HTTP adapter against `http://fixture.local` (served by `msw` in tests and, in fixture mode, by an in-process router that http-kit dispatches to for that one hostname, a seam gated by `syntheticAllowed`). No SQLite, no `process.env`. |
| `engine` | `core`, `db`, `providers` | Orchestrator, normalisation step (calls db repositories directly), stage runners, scheduler (owns the single `parseCron` wrapper over `croner`, which `api` imports for validation), notifiers, alert runner, FX refresh (through http-kit under the never-billable id `fx`), maintenance job. |
| `api` | all | Two entrypoints: the **app bootstrap** and the **tool bootstrap** (§7), both built on the wiring helper from WP4b and parsing `process.env` once through the `core` schema. Routes incl. the authenticated `/tools/*` routes, auth, hardening, static, health. |
| `web` | `core` (types, `api-contract`, pure filter/rank/verdict/label functions) | SPA. |

**Tech**: TypeScript strict, Node 22, pnpm, `better-sqlite3` + Drizzle,
Hono + `@hono/node-server` + `@hono/zod-validator`, `zod`, `@noble/hashes`,
`@date-fns/tz`, `bottleneck`, `p-retry`, `pino`, `croner`, `nodemailer`,
Vite + React 19 + TanStack Query + TanStack Table + Tailwind + Recharts,
Vitest + `msw` + Testing Library + Stryker, Playwright, Biome.

**Integration notes to verify at plan time** (each brief links its source):
`@hono/node-server` `serveStatic` SPA fallback; `better-sqlite3` prebuilt
fetch made **fail-closed** (no source-build fallback; version pinned by
lockfile; integrity recorded in the WP12 brief); pnpm
`onlyBuiltDependencies=["better-sqlite3"]`; Drizzle migrations in the
image; `croner` `timezone` and one-shot jobs; `msw` on global `fetch`;
`bottleneck` chained reservoirs + `maxConcurrent`; `p-retry`
`onFailedAttempt` with `Retry-After`; `@date-fns/tz` `TZDate` DST rules;
synchronous `better-sqlite3` transactions.

**Auth and request hardening** (`api`):

- Basic auth, both vars or neither, minimum password length 12, constant-time
  compare, failed-auth rate limit (5 per minute per source IP, taken from
  `X-Forwarded-For` only when `TRUST_PROXY=true`, with a global fallback of
  20 per minute); covers everything except the minimal unauthenticated
  `GET /health`, which is also exempt from the Host allowlist.
- Unauthenticated on a non-loopback bind refuses boot unless
  `ALLOW_UNAUTHENTICATED=true` (Tailscale-only hosts). The container binds
  `0.0.0.0`, compose publishes `127.0.0.1:3000`, so **compose requires
  auth**; `docs/setup.md` makes the two auth vars the first step and states
  that basic auth over plain HTTP beyond loopback needs a TLS reverse proxy
  or Tailscale.
- `ALLOWED_HOSTS` (default derived from `PORT`: `localhost:<port>,127.0.0.1:<port>`,
  plus the Vite dev origin `localhost:5173` under `NODE_ENV=development`);
  rejection names the header value and the variable; setup docs give
  Tailscale and reverse-proxy examples. Mutating routes require
  `Content-Type: application/json` and `X-Requested-With: get-me-there`;
  `Origin` when present must match the allowlist.
- Security headers: CSP `default-src 'self'`, `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Tested.

---

## 5. Provider interface

### 5.1 Contract (`core/provider.ts`, WP0)

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';

export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }

export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];     // when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it
}
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }   // vendor-neutral, typed
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }                                   // Travelpayouts month tiles
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };

export interface RawCalendarPrice extends CellKey {
  amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string;
}
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };

export interface ItineraryQuery extends CellKey { cabin: Cabin; adults: 1; currency: 'GBP'; maxStops?: number; expandTop: number; bookingLinks: boolean }
export interface RawSegment { marketingCarrier: string; operatingCarrier?: string; flightNumber: string; from: Iata; to: Iata; depart: string; arrive: string; timeKind: 'local' | 'utc' | 'offset'; cabin?: Cabin; durationMinutes?: number; aircraft?: string }
export interface RawOffer {
  outbound: RawSegment[]; inbound: RawSegment[]; seller: string; requestedCabin: Cabin;
  amountMinor: number; currency: string; taxesIncluded?: boolean;
  baggage?: BaggageSnapshot; fareConditions?: FareConditions; selfTransfer?: boolean;
  booking: { kind: 'get'; url: string } | { kind: 'post'; url: string; postData: string } | { kind: 'none' };
  bookingExpiresAt?: IsoDateTime;
}
export interface ItinerarySearchResult {
  offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; partial: boolean; failedExpansions: number; notes: string[];
  routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>;   // SearchApi price_insights.price_history; the engine upserts route_price_history
}
// offers: every return option of every expanded outbound, one RawOffer each; the cheapest per outbound is the step-3 candidate.

export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
// Adapters are constructed once with { http: HttpKit, log: Logger, clock: Clock }; the context carries only per-call state.

export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> }
export interface VerificationCapability { info: CapabilityInfo; estimate(q: ItineraryQuery): CostEstimate; search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> }
export interface FlightProvider {
  readonly id: ProviderId; readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
export interface CostEstimate { calls: number; costMicroGbp: number; seconds: number; notes: string[] }

export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void }
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
export interface Notifier { id: string; send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> }

export class ProviderError extends Error { kind: 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout'; reason?: string; retryable: boolean; httpStatus?: number; retryAfterSeconds?: number }
export class BudgetExceeded extends Error { scope: 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-month' | 'provider-lifetime' | 'global-month' }
export class AbortedError extends Error {}
```

### 5.2 Adapter responsibilities

- **Tiling.** `plan` is pure and deterministic and tiles **partition** the
  query's cells (asserted). With `cells` set it re-plans over that subset. A
  tile is one logical request; a paginated endpoint fetches all its pages
  inside one `fetchTile`, each page ledgered with the tile's `tile_index`,
  and parity counts tiles. **Travelpayouts** (measured): `month` tiles on
  `/aviasales/v3/prices_for_dates` with `departure_at=YYYY-MM`,
  `one_way=false`, `currency=gbp`, `limit=1000`, no `return_at`; the query
  stays per (origin, destination) pair and `origin` is the pair's origin
  airport's metropolitan code when the airports table maps it to one, else
  the airport; rows are attributed by `origin_airport` and filtered to the
  pair and the nights band. Logical tiles per scan: `O × D × M`; identical
  metro requests from sibling pairs are answered by the response cache
  inside its TTL, so upstream calls are `D × M` with a shared metro (the
  worked example: 2 origins sharing LON × 2 destinations × 7 months = 28
  tiles, 14 upstream calls, 14 cache hits). **SearchApi** (measured):
  `rectangle` tiles of 8 outbound days × the tight return span the nights
  band needs (19 days for a 12-night band: 152 combinations, 96 useful
  cells), asserted ≤200 before reserve; ~23 tiles per pair for a 182-day
  window (the worked example: 4 pairs ≈ 92).
- **Cell keys from the response**; entries outside `coveredCells` or with
  nights ≠ the requested length are dropped and counted in `notes`.
- **Empty is per capability.** `authorised-cached`: a schema-valid success
  envelope with zero entries → every covered cell `no_data`; a malformed
  envelope or `success:false` → `parse`. `scraped-aggregate`: an empty grid
  under a passing ≤200 assertion → `parse`; `has_no_flights: true` →
  `noFares`. Tested with recorded fixtures for both.
- **Estimate parity.** `plan(q).length` is the estimate; parity (§8.1) is
  measured as distinct tile requests.
- **Raw only.** Currency from the response. Per-segment `cabin` when the
  vendor states it; `requestedCabin` is what was asked. Nothing defaulted.
  `suppliedFields` checked against **recorded** fixtures.
- **Point of sale.** SearchApi `gl` is `POINT_OF_SALE` lower-cased
  (default `GB`), `hl=en`, `currency=GBP`, stored as `pointOfSale` from the
  echo in `search_parameters`. Travelpayouts
  `currency=gbp` only: its `market` parameter is ignored by the vendor, so
  it stores `pointOfSale: 'unknown'`, and `trip_class` is ignored too, so
  it declares `cabins: ['economy']` and the engine marks every cell
  `no_data` with reason `cabin-not-offered` for a non-economy definition
  without calling it. All hard-coded. The dated allowlist
  (`fixtures/recorded/<provider>/params-<date>.json`) enumerates parameter
  names **and values**; tests assert both.
- **Errors.** 401/403 → `auth`; 402 → `quota`; 400 → `parse`
  (non-retryable) with the vendor's message in `last_error`; 404 → `upstream`
  non-retryable; 429 → `rate-limit`, or `quota` when the adapter's
  classifier recognises the recorded quota body (the ledger cannot tell the
  two apart for a billed vendor: a refused reservation never reaches the
  vendor); a 429 without `Retry-After` waits the provider's configured
  fallback (Travelpayouts 60 s) or, with none, is non-retryable with a
  retry time at the hourly window;
  other 5xx → `upstream`; malformed → `parse`; socket → `network`; per-request timeout (`REQUEST_TIMEOUT_SECONDS`, separate from
  `ctx.signal`) → `network` finalised `unknown` and **not retried for billed
  vendors**; limiter deadline → `limiter-timeout`. `signal.aborted` →
  `AbortedError`. No adapter-level retries anywhere; http-kit retries.
- **Vendor links.** `vendorLink` and `booking.url` are validated in `core`
  at normalisation and again in `api-contract`: `https:`, no userinfo, host
  equal to or a subdomain of an entry in the provider's link allowlist
  (`aviasales.com` for Travelpayouts; `google.com` for SearchApi, whose
  step-3 `booking_request` always targets Google), else `{ kind: 'none' }`.
  Seller or airline hosts are never linked directly.

### 5.3 http-kit (`packages/providers/src/http/`)

`createHttpKit({ budget, cache, limits, clock, log, secrets, syntheticAllowed, recorder?, inProcessHosts? })`
over `globalThis.fetch`. The one transport seam is `inProcessHosts`: a
hostname-keyed in-process handler that only wiring under `syntheticAllowed`
may supply (http-kit refuses it otherwise), used for `http://fixture.local`;
tests intercept with `msw` on global fetch. A request that joins an identical
in-flight request records its own cache-hit ledger row and is raced against
its own signal; an adapter may veto caching a body it cannot parse. FX refresh goes through http-kit under
the id `fx` (never ledgered, no caps, host allowlist `api.frankfurter.dev`).
Pipeline, fixed:

```
cache lookup ─hit─▶ budget.recordCacheHit ─▶ return { body, fetchedAt: storedAt }
   │miss
in-flight dedup
p-retry (max 3 attempts; Retry-After honoured up to MAX_WAIT_SECONDS, beyond → limiter-timeout) {
   limiter (chained per-minute + per-hour reservoirs, maxConcurrent; queue age ≤ MAX_WAIT_SECONDS and !signal.aborted checked before reserve)
   budget.reserve  (one BEGIN IMMEDIATE transaction: cap predicates, insert provider_requests outcome='pending')
   fetch (per-provider hostname allowlist; redirect: 'error'; REQUEST_TIMEOUT_SECONDS; credentials in header when supported)
   reservation.finalise
}
cache.set when cacheable  →  return { body, fetchedAt: now }
```

- **Billable rule**: `searchapi` iff upstream HTTP 200 **and** the plan is
  a per-call plan (on subscription plans every call is billable for the
  call cap but costs 0 micro-GBP); `travelpayouts` and `fx` never; cache
  hits never; `fixture` iff HTTP 200 at the configured test cost (only
  under `syntheticAllowed`).
- **Cap predicates** (SQL in `reserve`):
  - `provider-month`/`provider-lifetime`: billed vendors count rows
    `outcome IN ('pending','unknown') OR billable = 1`; free vendors count all
    non-cache rows; cost sums `cost_micro_gbp` over the same rows.
  - `execution-calls`: billed-vendor rows of this execution by the same
    rule; `execution-free-calls`: free-vendor rows of this execution.
  - `global-month`: `Σ cost_micro_gbp` (billed rows) **plus
    `PLAN_FIXED_PENCE × 10 000` for each enabled subscription provider**, so
    `MONTHLY_SPEND_CAP_PENCE` means total monthly spend. On a subscription
    plan the per-call cost is 0, so the fee is counted once and the plan's
    call cap is the hard stop; per-call cost applies only on per-call plans.
  - A cap of 0 refuses when `current + this > 0`; zero-cost calls pass.
  - Pre-start checks use `usage(scope) + estimate ≤ cap` per scope.
- **Crash between reserve and finalise**: boot sweep marks `pending` older
  than 10 minutes `unknown` (still counted). Aborted attempts finalise
  `unknown` before `AbortedError` propagates (tested). Every ledger row
  carries `tile_index` (NULL for verification) so parity can count tiles.
- **Cache**: key = sha256 over the credential-free canonical request; bodies
  scrubbed of credentials; token-bearing SearchApi step responses never
  cached; TTLs from config.
- **Egress**: hostname allowlist per provider; `redirect: 'error'`; a test
  proves a 302 elsewhere sends no credentials.
- **Secret scrubbing**, one rule for every sink: `provider_requests.endpoint_path`
  is the path only (no query); cache keys exclude credentials and cache
  bodies are scrubbed of credentials before storage; `ProviderError.message`
  never contains a URL; every URL written to `cell_outcomes.last_error`,
  `search_executions.error_text`, `alert_events.payload_json`, API
  `error.details`, email bodies or pino output has its query string and
  userinfo stripped, with one exception: a validated booking or search link
  (`https:`, allowlisted host, §5.2) is written whole to API bodies and
  emails, since the query is the link; pino `redact` covers `apiKey`, `token`, `authorization`,
  `url.query`, `req.headers.authorization`; the recorder fails closed. The
  sentinel-key test configures fake values for every secret (both provider
  keys, the SMTP password, the basic-auth password), exercises every path
  including error paths, and asserts none appears in any log line, DB
  column, error message, API body, email or fixture file. CI runs the same
  secret scan over `fixtures/` and the repo's `.gitignore` covers `.env*`,
  `data/`, `*.db*` and `backups/`.
- **Recorder**: `fixtures/recorded/<provider>/<endpoint>/<yyyy-mm-dd>-<sha>.json`;
  credentials fail closed; `search_metadata` URLs stripped; **opaque vendor
  tokens are replaced by deterministic placeholders** (`<departure_token:0>`)
  consistent between a response and the next request so chains replay.

### 5.4 SearchApi itinerary flow

Vendor parameter names from the allowlist (`travel_class` values `economy |
premium_economy | business | first_class`). Step 1 (outbound options,
cheapest-first) → step 2 per `expandTop` outbound (round-trip price for that
pairing) → optional step 3 (`booking_token` → options; `booking_request` is a
POST, stored as `{ kind: 'post', url, postData }`, rendered as a browser form,
never fetched server-side; phone-only → `none`).

Options at any step may carry **no `price`** (the spike saw two of nine at
step 1 and one of three at step 2); they are skipped and counted in
`notes`, never persisted. Each step-2 response lists several return
options for the expanded outbound; **every priced option is persisted as
its own offer** (same call, no extra cost), and step 3 runs for the
cheapest priced option per outbound. Outcome rules (all tested): step 1 zero options → `empty`; step 1
options but every step 2 fails or returns no legs → throw `upstream` with
`reason = 'no-return-legs'` (non-retryable on resume; "fails" means an
`upstream`, `network` or `parse` error, while `auth`, `quota`, `rate-limit`
and `limiter-timeout` from any step propagate unchanged and are never counted
as a failed expansion); some step 2 succeed →
`priced` with `partial: true` and `failedExpansions`; a step 2 that succeeds
with zero legs contributes nothing; a cell is `priced` only if ≥1 offer is
written. **Price source rule (settled by the spike):** the step-2 price is
the airline's own fare and step 3 can show an OTA below it (£603 vs £573
on the probe), so `bookingLinks` is **forced `true` for SearchApi**
(enforced in zod), every step-3 option is persisted as an offer with its
`book_with` seller, `baggage_prices` and booking POST, and the step-2
price is kept only as the airline-direct offer when no step-3 option names
the airline. Three cases the vendor can produce: every step-1 option
unpriced → throw `upstream` with `reason = 'no-priced-options'`
(non-retryable on resume); a failed step 3 keeps the step-2 airline offer
and the cell is `priced` with `partial: true`; split bookings
(`is_split_booking`) are skipped and counted in `notes`. Calls per cell:
`1 + expandTop × 2`; the default `expandTop 2` costs 5.

### 5.5 Fixture provider and the synthetic gates

```ts
syntheticAllowed(c: Config): boolean =
  (c.nodeEnv === 'test' && (c.databasePath === ':memory:' || c.databasePath.endsWith('.test.db')))
  || (c.allowFixtureProvider === 'i-understand-this-is-fake' && c.nodeEnv === 'development' && !c.inContainer && c.databasePath.endsWith('.fixture.db'))
```

`databasePath` is realpath-resolved in bootstrap before the config is built.
The Dockerfile sets `NODE_ENV=production` and `IN_CONTAINER=1`; compose
passes an explicit `environment` allowlist (never `ALLOW_FIXTURE_PROVIDER`).
Both the app bootstrap and the tool bootstrap refuse `NODE_ENV=test`, and
the recorder only writes under `fixtures/recorded/` with a content hash and
`recordedBy` signature that the fixture-tree test verifies. The fixture provider's constructor
takes the config slice and throws when the predicate is false; repositories
reject `source_kind = 'synthetic'` when it is false, and reject any row where
`provider_id = 'fixture'` ⇔ `source_kind = 'synthetic'` does not hold. Every
fixture price is `synthetic` unconditionally. Alerts and notifiers refuse
synthetic rows. The UI banner is data-driven; a negative test asserts its
absence for real data. Tests: the truth table incl. traversal and symlink
cases; injected-config boot matrix; **one test spawning the real bootstrap
with a real production environment**; a Dockerfile assertion.

### 5.6 Normalisation step (engine)

For every raw price or offer: airport tz from the airports repository
(unknown → `error: unknown-airport-tz`, never hash UTC); `departLocal` per
segment via `@date-fns/tz` (nonexistent wall times shift forward, ambiguous
take the first occurrence; tested on a UK/EU DST change); canonicalise and
hash (§6.4); evidenced cabin only when every segment states one, else the
cabin verdict is `unverified`; money via `toGbp` with the FX repository
(`FX_MAX_RATE_AGE_DAYS` 3; ECB-covered currencies only; missing →
`error: fx-unavailable`); `fx_rate_nano` = GBP per native unit × 1e9,
`fx_rate_date`, `fx_source` stored together under a CHECK constraint.
Offers that fail normalisation are dropped and counted as
`offers-dropped:n` on a `priced` outcome; the cell is `error` only when no
offer survives. Per `(provider, cell)` the engine keeps **one** calendar
price per tile (the minimum `amountMinor`, tie-break on vendor order) and
counts discards; the roll-up `min_pence` is the minimum over rows actually
written. Evidenced per-segment cabins are stored on the observation
(`segment_cabins_json`), never on the shared `segments` rows. FX rates come
from frankfurter (`https://api.frankfurter.dev/v1/latest?from=GBP`; the
older `.app` host redirects and http-kit refuses redirects) through http-kit
under the id `fx` (host-allowlisted, never ledgered), refreshed daily by a
scheduled job that runs after boot.

---

## 6. Core domain (pure functions, `packages/core`)

### 6.1 Search-space generation
```ts
resolveWindow(def: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean }
generateCells(space: ResolvedSpace): Cell[]      // deterministic order: origin, destination, departureDate, nights
countCells(space): number                         // closed form, no allocation; the estimate and caps use it
validateSearchSpace(def, todayLondon: IsoDate, lookup: { exists(iata): boolean; metroOf(iata): string | null; airportsOfMetro(code): Iata[] }, maxCells: number): ValidationResult   // a metropolitan code is rejected naming its airports
```

Windows are **absolute** `{ from, to }` or **relative** `{ startOffsetDays ≥ 1,
lengthDays }`. Relative windows resolve at execution start in
`Europe/London` and are frozen into the execution snapshot. Absolute
windows are clamped to start no earlier than tomorrow (noted in the
estimate). A window that resolves to zero cells makes a scheduled tick
record status `skipped_window` with an operator notification and disable
the schedule, and makes `POST` return 422.

Dates are **calendar dates** independent of process timezone: epoch-day
integers and `Intl` only, never `Date`-local arithmetic.
`returnDate = departureDate + nights` for `nights ∈ [minNights, maxNights]`;
window ends are inclusive. Validation: IATA format `^[A-Z]{3}$` and
existence via the supplied lookup; `to ≥ from`; window ≤ 400 days;
`0 ≤ minNights ≤ maxNights ≤ 90`; ≥1 origin and destination, disjoint;
`countCells ≤ MAX_CELLS_PER_DEFINITION`; `alwaysInclude` members of the
space resolved **at save time**. At execution start, `alwaysInclude` cells
that have slid out of a relative window are dropped with a note, not an
error.

Tests: hand-computed counts for the default space (2 × 3 × 182 × 12 =
13,104) and a literally enumerated tiny space (1 × 1 × 3 days × 2 nights =
6 cells, listed), with `countCells === generateCells().length` only as a
secondary property; leap day 2028-02-29; the 2027→2028 boundary; windows
spanning the March and October DST changes with the suite run under
`TZ=Europe/London` and `TZ=UTC`; min = max nights; single-day window;
multi-origin × multi-destination ordering; relative resolution across a
month end; clamping; zero-cell windows; `startOffsetDays = 0` rejected;
unknown IATA rejected.

### 6.2 Constraints and verdicts
```ts
evaluateConstraints(it, offer, c: Constraints, supplied: readonly SuppliedField[]): Verdicts
verdictClass(v): 'verified' | 'partially-verified' | 'failed'
```

Evaluated **at read time** against the current definition, using the
observation's stored `supplied_fields_json`, so edited constraints apply to
old observations correctly. Rows whose cell is outside the current resolved
window or nights range are excluded from results and labelled in history.

| Constraint | Field needed | Rule |
|---|---|---|
| cabin | evidenced per-segment cabins (never `requestedCabin`) | fail if any segment below requested; `unverified` unless every segment states its cabin (mixed-cabin itineraries such as premium long-haul plus an economy domestic leg are common on these routes) |
| maxStops | segments | per direction |
| maxJourneyMinutes (default 1500 per direction in the default definition) | segment times | per direction |
| minLayoverMinutes / maxLayoverMinutes | segment times | every layover |
| noOvernightLayover | segment times + tz | layover spanning 00:00–05:00 local |
| departureWindowLocal / arrivalWindowLocal | first/last segment local times | outbound and inbound |
| noSelfTransfer | observation `selfTransfer` | unverified if absent |
| noAirportChange | segment airports | |
| includeAirlines / excludeAirlines | marketing carrier | any segment |
| cabinBagRequired / checkedBagRequired / minCheckedBags | baggage | unverified when absent |
| maxPricePence | price | |

Absent input → `unverified`, tested per row of this table. `failed` iff any
`fail`.

### 6.3 Normalisation and money
`NormalisedItinerary` = `{ hash, origin, destination, departureDate, returnDate, nights, outbound: Segment[], inbound: Segment[], outboundMinutes?, inboundMinutes?, stopsOut, stopsIn, layovers: Layover[], airportChange?, marketingCarriers: string[] }`.
`Segment` = `{ marketingCarrier, operatingCarrier?, flightNumber: number, from, to, departLocal, arriveLocal, departUtc?, arriveUtc?, durationMinutes?, aircraft? }`.
Cabin is on the offer; evidenced per-segment cabins and `selfTransfer` are
on the observation (they are fare attributes, not itinerary attributes).

**Money.** Prices: integer pence, `*Pence`/`*_pence`. Provider costs:
integer micro-GBP, `*MicroGbp`/`*_micro_gbp` (SearchApi costs 0.32p a
call). Operator-facing config is in pence (`*_PENCE`) converted once at the
config boundary; comparisons are `pence × 10 000 ≥ microGbp`. FX rates are
integer **nano**: `fx_rate_nano` = GBP per 1 unit of native currency × 1e9
(micro would keep only ~4 significant figures for JPY). Native amounts are
integer minor units with the ISO 4217 exponent. `toGbp` rounds half-up to
the penny and is tested against CNY and JPY reference values in that
direction. No float ever holds money; zod and repositories reject
non-integers.

**Timestamps**: `Date.prototype.toISOString()` form only
(`2026-10-14T15:00:00.000Z`); vendor times normalised to it in `core`;
repositories reject other forms.

### 6.4 Itinerary identity
`itineraryHash` = sha256 over `'OUT|' + segs(outbound) + '|IN|' + segs(inbound)`,
each segment `${carrier}:${flightNumber}:${from}:${to}:${departLocal}`
after canonicalisation: carrier matches `^[A-Z0-9]{2}$` (IATA designators
are alphanumeric, e.g. `4U`); an unmappable carrier is a normalisation error
for that offer, never a guess; `flightNumber` integer without leading
zeros; airports upper-case IATA; `departLocal` exactly `YYYY-MM-DDTHH:mm`
local to the departure airport. An offer whose local departure cannot be
derived (UTC input with an unknown airport tz) is a normalisation error
`unknown-airport-tz`; UTC is never hashed. Codeshares hash on the
**marketing** carrier. Excludes price, cabin, provider, seller, tokens.
Matrix tests: `VS 938`/`VS938`/`0938`, `4U 8888`, `T` vs space, UTC vs
local vs offset inputs, unknown tz.

### 6.5 Dedup, ranking and filters

Pure functions shared by `api` and `web`. **Dedup**: one results row per
itinerary hash, showing that itinerary's best offer in the definition's
cabin, chosen by verdict class, then seen-in-latest-search, then price, then
freshness; the other offers for that itinerary appear in the expanded row
with their own class and unverified constraints. Stale rows are labelled,
never demoted (hiding them is the opt-in filter). `/results` returns up to 1000 such rows ranked by verdict
class (verified, partially-verified, failed) then price, for the chosen
basis and execution set; **all sorting and filtering happen client-side**
on that set with these functions, composing without refetch; when
`truncated`, the header says "within the cheapest 1000 of N". Sort keys:
price, total travel time, departure, return, nights, stops, adjusted.
Filters: verdict class, unverified-constraint name, provider, stops,
carriers, destination, max price, nights range, stale. `bandCheapest(rows,
6h)` marks the cheapest per travel-time band.

### 6.6 Coverage math and roll-up precedence

| # | Condition | Roll-up |
|---|---|---|
| 0 | no outcome rows (stage has no provider, or selection not yet persisted) | `NULL` / `not_applicable` |
| 1 | any `priced` | `priced` |
| 2 | any `not_run` | `not_run` |
| 3 | any `error` | `error` |
| 4 | any `empty` and every other ∈ {empty, no_data, skipped} | `empty` |
| 5 | any `no_data` | `no_data` |
| 6 | all `skipped` | `skipped`, reason by priority budget > provider_disabled > departed > not_selected |

`no_data` outcomes whose reason is `cabin-not-offered` are ignored whenever
any other outcome exists for the cell; a cell whose only outcomes are
cabin-not-offered rolls up to `no_data` with that reason. Roll-up reasons: a
`priced` roll-up carries `partial-expansion` when any priced input has it;
`error` carries the reason when every error input agrees, else `mixed`;
`skipped` keeps the priority above. Within one provider, monotone merge
`priced > empty > no_data > error`, `min_pence = min`, every other field
travelling with the input that supplies the minimum (tiles partition cells,
so this is a safety net, tested); a fresh write replaces a reused copy
outright.
Discovery re-plans only over `not_run` cells, so a reused cell is never
fetched again in the same execution; the §7 supersede rule is a safety net
in the tile write, not a path the planner takes. Coverage
fractions in the UI always show the **six buckets** of §3 (priced, no
fares, no cached data, error, skipped, not searched), which sum to the cell
count; "searched" as an umbrella appears only in View D beside the
breakdown. "Selected but not reached" = `selected ∧ (not_run ∨
skipped:budget)`. Property test from an independent enumeration of the
table.

### 6.7 Candidate selection
`policy = { maxCells; topN ≤ maxCells; priceCeilingPence?; perDepartureDateBest?; alwaysInclude: CellKey[] (|·| ≤ maxCells, members of the resolved space) }`.

Selection runs **once per execution**, guarded by `stage`, and is never
recomputed on resume. It refuses a policy whose deduplicated in-space
`alwaysInclude` exceeds `maxCells` or whose counts are not non-negative
integers (validated at save time too), so `maxCells` is a hard bound on
verification spend; the stride walks only cells not already chosen. Child executions bypass it entirely (`alwaysInclude =
[cell]`, `maxCells = 1`, no discovery).

1. Start with `alwaysInclude` (deduplicated, counted toward `maxCells` and
   toward `perDepartureDateBest`).
2. Rank cells with a `priced` discovery roll-up by `discovery_min_pence`,
   tie-break generation order.
3. Walk, skipping `alwaysInclude` members: add if under `maxCells` and, when
   `perDepartureDateBest` is set, that date has fewer than that many
   selected; stop after `topN` additions.
4. If `priceCeilingPence` is set, continue walking, adding only cells ≤
   that ceiling, still honouring `perDepartureDateBest`, until `maxCells`;
   if unset, stop after step 3.
5. Fallback when the execution has **no** discovery provider: replace 2–4
   with an even stride over generation order. `m = maxCells −
   |alwaysInclude|`; if `m ≤ 0` the stride adds nothing; otherwise `k =
   max(1, floor(total / m))`, start at index 0, take at most `m` cells,
   advancing past `alwaysInclude` members rather than losing a slot.
6. Record `selection_reason ∈ always_include | top_n | ceiling | stride`.

The estimate uses `maxCells` as the upper bound. Sparse discovery is
remedied by `alwaysInclude` and single-cell verify, not by stride.

### 6.8 Alert evaluation
Rule: `{ type: 'absolute' | 'dropPct' | 'dropAbs', thresholdPence | pct, basis: 'verified' | 'calendar', requireAllVerified (verified basis only; zod rejects it on calendar basis), cooldownHours (default 336, deliberately not equal to the weekly cadence) }`.

- **Verified basis** identity = `(ruleId, itineraryHash)`; candidates are
  price observations **written by the current execution** with class
  `verified`, or `partially-verified` when `requireAllVerified` is false
  (the firing lists the unverified constraints); drops compare the latest
  observation of an offer with its previous one.
- **Calendar basis** identity = `(ruleId, providerId, cabin, cellKey)`;
  candidates are calendar prices fetched by the current execution (reused
  rows are excluded) in the definition's cabin; drops compare only with a
  previous price for the same `(providerId, cabin, cellKey)` whose
  **`fetchedAt`** is within 2 × `discoveryRefreshHours` (tested at 167 h,
  168 h and 169 h with `maxAgeHours` 168); absent-then-present is listed in
  the digest's "new" section and is never a drop firing (absolute rules
  still apply to it); the body shows the previous price and its age. Allowed
  whenever the operator opts in; the subject carries "constraints not
  checked". When verification is budget-skipped the operator is told
  "alerts running on calendar basis only".
- `dedupKey = identity + floor(pricePence / 100)`. Suppressed if the same key
  fired within `cooldownHours`, or the same identity fired within it at a
  price that is not at least max(£10, 5%) above the new one (a fare
  drifting down £1 a day sends one email, not seven). Each identity is
  judged on its cheapest eligible candidate. Suppressed firings are
  recorded with status `suppressed`. Synthetic rows are refused.
- Firings are delivered as **one digest per rule per execution** listing
  the top 10 and a count of the rest (tested: 50 qualifying cells → one
  email). Returns the digest with reason text.

### 6.9 Results basis
`basis: 'verified' | 'calendar'`. Verified basis ranks observations (class
`verified` and `partially-verified`; `failed` excluded by default, included
by filter). Calendar basis ranks calendar prices as rows with class
`unchecked`, no segments, an explicit "not checked" marker in every
segment-derived column, stops/carrier filters disabled, and an inline note
naming the configured constraints that are not applied ("not applied:
arrival window, max journey, stops").

Calendar basis rows are the latest fetched price per `(providerId, cellKey)`
in the definition's cabin from executions of this definition, ignoring
reused copies (same `fetchedAt` as their origin). The **default basis is
calendar when the snapshot has no verification provider or no observations
exist**; the header says why and offers a one-click switch. Per-cell
verify actions and the calendar-gap banner are hidden when the definition
has no verification provider.

Every row on either basis carries a labelled **search link** (Aviasales
deep link from Travelpayouts; a Google Flights search URL for SearchApi
cells, which may not prefill every field) whenever `booking` is `none`,
labelled "search link, not a fare link"; synthetic rows carry none.

---

## 7. Data model (`packages/db`)
Conventions: `*_pence`, `*_micro_gbp`, `*_nano` are `integer`; timestamps
are `toISOString()` text; booleans are integers 0/1.

- `airports` (iata PK, icao, name, city, country, tz NOT NULL, lat, lon,
  metro NULL, source, dataset_version). Seeded from a vendored, versioned
  `mwgg/Airports` dataset (MIT, has IANA `tz`; it carries no metropolitan
  codes, so `metro` comes from a separately vendored, attributed list of
  IATA metropolitan area codes beside it); re-seeded by upsert when the
  dataset version changes; the sanity check that the table holds at least
  5,000 rows with IATA code and tz, and that every airport referenced by an
  enabled definition exists, **fails boot** if it fails; no network at
  seed. No specific airport is named in code.
- `search_definitions` (id, name, origins_json, destinations_json,
  window_json {kind: absolute|relative, …}, min_nights, max_nights, cabin,
  constraints_json, verification_policy_json NOT NULL, budget_json NOT NULL
  {maxCalls, maxFreeCalls, maxCostMicroGbp}, providers_json {discovery[],
  verification[], discoveryRefreshHours{} (default 168 per provider)},
  destination_notes_json {dest: text} NULL, onward_cost_json {dest: pence} NULL, schedule_cron NULL, schedule_tz NOT
  NULL, confirmed_cost_pence NULL (set **only** from an explicit
  confirmation the operator submits after seeing the estimate; never
  recomputed automatically), enabled, deleted_at NULL, created_at,
  updated_at). Soft-deleted.
- `search_executions` (id, definition_id, is_child NOT NULL default 0,
  child_origin, child_destination, child_departure_date, child_return_date
  (NULL for parents), definition_snapshot_json NOT NULL (with the resolved
  window), trigger ∈ manual | schedule | tool, status ∈ pending | running | paused_budget | paused_error |
  interrupted | cancelled | completed | skipped_budget | skipped_confirm |
  skipped_window | skipped_missed, stage, estimate_json, cancel_requested, resume_after NULL,
  auto_resume_count NOT NULL default 0, created_at, started_at,
  finished_at, error_text). **Parent partial unique index** `(definition_id) WHERE
  is_child = 0 AND status IN (pending, running, paused_budget, paused_error,
  interrupted)`; **child partial unique index** `(definition_id,
  child_origin, child_destination, child_departure_date, child_return_date)
  WHERE is_child = 1 AND status IN (the same active set)`. Index
  `(definition_id, started_at)`. `auto_resume_count` counts consecutive
  restarts without progress: reset when a tile or cell commits; not
  incremented by graceful SIGTERM. `resume_after` drives a one-shot croner
  job.
- `search_cells` (execution_id, origin, destination, departure_date,
  return_date, discovery_status NULL, discovery_reason NULL,
  discovery_min_pence, verification_selected, selection_reason,
  verification_status NULL, verification_reason NULL,
  verification_min_pence NULL, best_observation_id NULL FK
  `price_observations.id`, the cheapest observation written for the cell;
  "cheapest verified" is a read-time query because verdicts are read-time)
  PK five keys.
  A `NULL` status means the stage has no provider or no outcome rows yet.
- `cell_outcomes` PK **(execution_id, origin, destination, departure_date,
  return_date, stage, provider_id)** with status, reason, attempts NOT NULL
  default 0 (engine passes, not HTTP tries), last_error, fetched_at,
  min_pence, cabin, point_of_sale, source_kind, reused_from_execution_id
  NULL (always the execution that fetched the price). Seeded at start (§3). **Resume** selects, per `(stage,
  provider)`, outcomes with status `not_run`, or `error` with `attempts <
  3` and reason ∉ {auth, quota, parse, no-return-legs, fx-unavailable,
  currency-unsupported, unknown-airport-tz}, or `skipped:budget` when
  headroom exists; a **manual** resume additionally selects
  `skipped:provider_disabled` and `error` with reasons auth/quota/parse
  (re-enabling the provider for that pass); never rewrites `priced | empty
  | no_data`. Discovery resume re-plans tiles over the resumable cells only.
- `calendar_prices` (id, execution_id, provider_id, source_kind NOT NULL,
  cabin, origin, destination, departure_date, return_date, price_pence,
  price_native_minor, currency_native, fx_rate_nano NULL, fx_rate_date NULL,
  fx_source NULL, fx_converted NOT NULL, point_of_sale, fetched_at NOT NULL,
  provider_observed_at NULL, max_age_hours NULL, vendor_link NULL,
  reused_from_execution_id NULL). Insert-only; **one row per (execution,
  provider, cell)** (the engine reduces a tile to the minimum per cell with
  a deterministic tie-break and counts discards; an in-tile conflict
  throws); UNIQUE (execution_id, provider_id, cell keys). Indexes (origin,
  destination, departure_date, return_date, fetched_at), (origin,
  destination, fetched_at), (execution_id). History and route series read
  only `reused_from_execution_id IS NULL`.
- `itineraries` (hash PK, kind default 'flight', origin, destination,
  departure_date, return_date, nights, outbound_minutes, inbound_minutes,
  stops_out, stops_in, airport_change NULL, carriers_json, layovers_json,
  first_seen_at). Insert-or-ignore on hash.
- `segments` (itinerary_hash, direction, position, mode default 'air',
  marketing_carrier, operating_carrier, flight_number, from_iata, to_iata,
  depart_local, arrive_local, depart_utc, arrive_utc, duration_minutes,
  aircraft) PK (itinerary_hash, direction, position). No cabin: segments
  belong to the cabin-independent itinerary.
  Insert-or-ignore with the itinerary.
- `fare_offers` (id, itinerary_hash, provider_id, seller NOT NULL, cabin NOT
  NULL, first_seen_at, last_seen_at, first/lowest/highest/latest_price_pence)
  UNIQUE (itinerary_hash, provider_id, seller, cabin); `latest` = max
  `fetched_at`, tie `id`. Index (itinerary_hash).
- `price_observations` (id, offer_id, execution_id, source_kind NOT NULL,
  cabin, fetched_at NOT NULL, provider_observed_at NULL, price_pence,
  price_native_minor, currency_native, fx_rate_nano NULL, fx_rate_date
  NULL, fx_source NULL, fx_converted NOT NULL, point_of_sale,
  max_age_hours NULL (NULL = unknown; written explicitly from
  `CapabilityInfo.maxAgeHours`), taxes_included NULL, self_transfer NULL,
  segment_cabins_json NULL, baggage_json NULL, fare_conditions_json NULL,
  booking_json NULL {kind, url, postData?, host}, booking_expires_at NULL,
  supplied_fields_json NOT NULL, partial_expansion NOT NULL). Append-only. Indexes (execution_id, price_pence), (offer_id,
  fetched_at).
- Both price tables carry `CHECK ((fx_converted = 1) = (currency_native <>
  'GBP'))` and `CHECK (fx_converted = 0 OR (fx_rate_nano IS NOT NULL AND
  fx_rate_date IS NOT NULL AND fx_source IS NOT NULL))`; when unconverted,
  the repository asserts `price_pence = price_native_minor`. In
  `calendar_prices`, `max_age_hours` NULL means unknown and is written
  explicitly. The repository rejects any row where `provider_id =
  'fixture'` ⇔ `source_kind = 'synthetic'` does not hold.
- `provider_requests` (id, provider_id, execution_id NULL, endpoint_path,
  tile_index NULL, started_at, finished_at NULL, duration_ms NULL,
  http_status NULL, outcome ∈ pending | ok | error | unknown | cache_hit,
  billable NULL until finalised, cost_micro_gbp NOT NULL, http_attempt).
  Inserted at reserve.
  Index (provider_id, started_at, outcome, billable), (execution_id).
- `provider_cache` (key PK, provider_id NULL, body_json, stored_at,
  expires_at).
- `fx_rates` (date, currency, rate_nano, source) PK (date, currency).
- `alert_rules` (id, definition_id, type, threshold_pence NULL, pct NULL,
  basis, require_all_verified NULL, cooldown_hours NOT NULL default 336,
  enabled, deleted_at NULL). Soft-deleted; events are kept.
- `alert_events` (id, rule_id, identity_key, observation_id NULL,
  calendar_price_id NULL, dedup_key, fired_at, status ∈ sent | failed |
  suppressed, reason, payload_json). Index (rule_id, dedup_key, fired_at),
  (rule_id, identity_key, fired_at).
- `operator_notifications` (id, kind, execution_id NULL, definition_id,
  sent_at, status).
- `route_price_history` (origin, destination, cabin (a cabin or
  'unknown'), provider_id, date, lowest_price_pence, fetched_at) PK (origin, destination, cabin,
  provider_id, date): the 60-day `price_insights.price_history` series
  SearchApi returns with every step-1 response, upserted on each
  verification. Shown on the History view as its own labelled series
  ("Google's route-level lowest price, cabin unknown").
- `app_lock` (id = 1, holder ∈ app | tool, heartbeat_at, acquired_at).
  Heartbeat every 30 s; stale after 3 missed beats; liveness judged by
  heartbeat age, never by pid. Graceful SIGTERM releases the lock after the
  checkpoint. At boot, a fresh `tool` lock makes the app wait up to 60 s
  then refuse; a fresh `app` lock makes it wait up to 90 s, logging the
  lock age, then take over a lock that has gone stale and refuse one that
  is still being heartbeated (a second live app); the `HEALTHCHECK` `start_period` covers both waits. The tool
  bootstrap refuses while a fresh app lock exists; while the app is
  running, the same scripts are reachable as the authenticated routes
  `POST /tools/smoke` and `POST /tools/record` (§10). Acquisition and
  `reserve()` use `BEGIN IMMEDIATE`.

**Transactions.** Repository transaction callbacks are typed to return
non-Promise values and a db test asserts an async callback is rejected
(`better-sqlite3` commits at the first `await`). Atomic units: seeding
`search_cells` + discovery `cell_outcomes` at start; each tile's prices,
outcomes and roll-ups; selection persistence + verification seeding (resume
re-runs selection only when no verification outcomes exist); each reused
cell's outcome + copied prices + roll-up; a fresh price superseding a reused
row deletes that row in the same transaction; each verified cell's
itinerary, segments, offer, observation, outcome, `best_observation_id` and
roll-up; the boot `running → interrupted` update with its
`auto_resume_count` increment. Ledger finalisation happens in http-kit
(providers) **before** any engine write; the engine then writes outcomes in
its own transaction.

**SQLite settings.** `journal_mode=WAL`, `busy_timeout=5000`,
`foreign_keys=ON`. The app process is the only writer. The smoke and
recording scripts run through the **tool bootstrap**, a second entrypoint in
`apps/api` (WP4b) that reuses the same config parse and port wiring, opens
the same DB, skips the boot sweep, auto-resume and cron, uses the production
ledger, and honours `app_lock` (a test proves it starts no execution).
Graceful shutdown: `wal_checkpoint(TRUNCATE)`.

**Migrations.** Drizzle Kit SQL bundled into the image, applied at boot
idempotently. A `VACUUM INTO` backup runs first **only when migrations are
pending**, to a timestamped file under `/data/backups`, keeping the last 5
and refusing an existing target; **if the backup fails, migrations are
refused and boot fails** naming the cause. Seed after migration when `airports` is
empty or the dataset version changed.

**Retention.** A daily maintenance job deletes expired `provider_cache`
rows, prunes `cache_hit` ledger rows older than 90 days for providers on
monthly windows only (lifetime-window plans keep every row, since the cap
needs them) and logs DB size; expected growth per month is documented in
`docs/setup.md`.

**Budget windows.** Per provider from `<PROVIDER>_BILLING_DAY` (UTC, valid
1–28 so every month has the day); global from `GLOBAL_BILLING_DAY` (UTC,
default 1); `trial` plans use a lifetime window. `/budget` reports every
window's bounds.

## 8. Engine

### 8.1 Execution lifecycle
```
pre-start (scheduler tick and POST): resolve window (§6.1); estimate per provider and stage;
   for every scope check usage(scope) + estimate(scope) ≤ cap (execution calls, execution free calls,
   execution cost, each provider's month/lifetime, global month). A breach on a provider-specific or
   billed scope seeds that provider's cells skipped:budget and the run proceeds with the rest; only when
   nothing can run is the POST refused (409 naming the cap and numbers) or the scheduled run recorded
   skipped_budget + notified. Free providers therefore always run.
   estimate > SOFT_CONFIRM → POST needs confirmCostPence × 10 000 ≥ estimateMicroGbp;
   a scheduled run needs definition.confirmed_cost_pence × 10 000 ≥ estimateMicroGbp else skipped_confirm
   + notified; a PUT that raises the estimate above the stored confirmation returns needsConfirmation
start: snapshot; seed search_cells + cell_outcomes(not_run) for every cell × discovery provider; status=running
   a provider whose `cabins` excludes the snapshot's cabin is not called in either stage: its cells become
   no_data reason cabin-not-offered at seeding
discovery, per discovery provider, per (origin, destination) pair:
   reuse, per cell: the newest priced|empty|no_data outcome for the same cell, provider, definition,
          cabin, point of sale and source kind, from a non-child execution, with age measured from the
          original fetched_at < discoveryRefreshHours × 0.9, is copied with its calendar_prices row
          (original fetched_at, provenance, reused_from_execution_id = the fetching execution)
   plan = discovery.plan(q with cells = cells still not_run)   // re-planned over the subset
   for each tile (bounded pool = provider CONCURRENCY):
      fetchTile → 'tile'       ⇒ normalise (§5.6) ⇒ one price per cell ⇒ write atomically
               → 'tile-error' ⇒ covered cells error(reason = error.reason ?? kind), attempts+1
      errors per the table below
verification:
   selection (§6.7) persisted + verification outcomes seeded in one transaction
   bounded pool of cells (provider CONCURRENCY): verification.search → normalise → write atomically → priced|empty
   errors per the table below; on a stopping condition, abort sibling cells, return them to not_run, then set the status
alerts: evaluateAlertRules → persist events → notify digests
completed
```

**Error table (both stages, tested per row):**

| Event | Cell outcome | Execution |
|---|---|---|
| `ProviderError` rate-limit/upstream/network after retries | `error`, attempts+1 | continue |
| `ProviderError` parse | `error`, attempts+1; 2 consecutive for one provider (counted in ledger finalisation order) → provider disabled for the run, remaining cells `skipped:provider_disabled` | continue other providers; if none remain, `paused_error` + notify |
| `ProviderError` auth or quota on **any** call | provider disabled for the run; remaining cells `skipped:provider_disabled` | continue other providers; if none remain, `paused_error` + notify |
| `ProviderError` upstream with reason `no-return-legs` | `error`, non-retryable on resume | continue |
| `limiter-timeout` | cell returns to `not_run` | `paused_error` with `resume_after` = window reopen; a **one-shot croner job** resumes it at that instant (re-registered at boot, cancelled on cancel or manual resume) |
| `BudgetExceeded` provider-month / provider-lifetime, other providers remain in the stage | remaining cells for that provider and stage `skipped:budget` | continue; notify once; no one-shot job |
| `BudgetExceeded` provider-month / provider-lifetime, no other provider remains | remaining cells `skipped:budget` | `paused_budget` with `resume_after` = next cap window start; a one-shot job resumes it; exempt from the stale-run supersede while `resume_after` is in the future |
| `BudgetExceeded` global-month (billed providers only; free providers continue) | billed providers' remaining cells `skipped:budget`; in-flight billed siblings aborted → `not_run` | continue if a free provider remains, else `paused_budget` as above |
| `BudgetExceeded` execution-* | in-flight siblings aborted → `not_run` | `paused_budget` + notify; needs a manual `/resume`, which copies the definition's current `budget` into the snapshot (nothing else) and re-checks the caps |
| `AbortedError` (cancel / SIGTERM) | `not_run` | `cancelled` (operator) / `interrupted` (SIGTERM) |
| normalisation `fx-unavailable` / `currency-unsupported` / `unknown-airport-tz` / unmappable carrier | offers that fail are dropped and counted `offers-dropped:n` on a `priced` outcome; `error` with the reason only when no offer survives | continue |
| `BudgetExceeded` is never recorded as `error`. | | |

- **Estimate** = Σ discovery `plan(q with cells = non-reused cells).length`
  per pair, using the same reuse query as the run, + `maxCells ×
  verification.estimate`, all × `ESTIMATE_RETRY_FACTOR` (default 1.2), with
  assumptions in `notes`, plus `seconds` including limiter waits. Actuals
  come from the ledger by `execution_id` at any time and are labelled
  "ledger cost, from configured rates". **Parity** = distinct tile requests
  (first-attempt ledger rows + cache hits) for one uninterrupted pass =
  `plan` length; a parity break raises an operator notification and a View
  D flag. View D otherwise flags **overruns** only: actual calls > the
  **pre-factor plan** by more than 10% (the stored estimate already carries
  the 1.2 factor, so it is not the comparison baseline).
- **Resume**: on `interrupted | paused_* | cancelled`, and on `completed`
  when `error` outcomes with headroom remain (retry-errors), continue per
  §7. Resume is a **compare-and-set**: `UPDATE … SET status = 'running'
  WHERE id = ? AND status IN (resumable)` proceeds only when one row
  changed, cancelling the one-shot job in the same step; the tick, the
  one-shot job, boot auto-resume and `/resume` all go through it, so
  losers no-op (or 409 for `/resume`). `/resume` also returns 409 if
  another execution is active. Before planning, `not_run` and `skipped`
  outcomes in either stage for cells with `departureDate ≤ todayLondon`
  become `skipped:departed` (priced/empty/no_data rows are untouched).
  Resume uses `estimateRemaining` (resumable tiles + remaining selected
  cells × estimate × factor) for its per-scope cap check, on both the
  tick and `/resume`. **Any** paused run older than `discoveryRefreshHours`
  whose `resume_after` is not in the future is cancelled and a fresh run
  started (the tick checks this before trying to resume). Manual `/resume`
  re-enables providers disabled in the previous pass; automatic resume does
  not.
- **Boot order**: `pending` executions older than the boot and `running`
  executions become `interrupted` (crash-marked rows increment
  `auto_resume_count`); if `AUTO_RESUME`, every `interrupted` execution
  with count ≤ `MAX_AUTO_RESUMES` resumes (never an execution whose
  definition is soft-deleted); one-shot jobs for `resume_after` are
  re-registered; **then** cron. Boot makes no network call. SIGTERM: stop scheduler, abort in-flight
  (cells → `not_run`), status `interrupted` without incrementing the
  counter, checkpoint, exit.
- **Staleness per price**: effective age (§3) vs `STALE_AFTER_HOURS`
  (default 192 = one weekly cycle + 24 h, verified basis) or, for calendar
  basis, `discoveryRefreshHours + maxAgeHours` of the provider (overridable
  by `CALENDAR_STALE_AFTER_HOURS`).
  Every row shows its effective age as a number; "stale" is reserved for
  older than one full refresh cycle. Stale rows are **returned and
  labelled, never hidden**; hiding is an opt-in filter. Ordering with
  unknown age: unknown loses to any known age; ties → verified; stale
  calendar prices still render, labelled.
- **Verified-basis results** mark rows whose cell has a later `priced |
  empty` verification outcome that did not include the offer as "not seen
  in latest search (<age>)" and rank them after seen rows.
- **Operator notifications** on `paused_*`, `skipped_*` (including
  `skipped_missed` when a boot finds the last scheduled firing was missed),
  `interrupted`, provider disabled, parity break, "alerts on calendar basis
  only"; deduplicated per execution and kind.
- **Single-cell verification** (`POST /cells/verify`): needs no parent;
  validates the cell ∈ `generateCells(current resolved space)` and airports
  exist; creates a child execution (`is_child = 1`, cell columns set) that
  skips discovery, `alwaysInclude = [cell]`, `maxCells = 1`, its own call
  cap (`CHILD_MAX_CALLS` default 6; the other budget fields are inherited
  from the definition), shares the provider/global caps; at most one active child per cell; the action is hidden when the
  definition has no verification provider. Child observations are
  **included** in results, calendar-gap, View B counts and duration
  analysis (filtered to the current resolved space), counted separately as
  "+C on demand" beside "itinerary-searched K of N selected"; children are
  excluded only from "latest execution", reuse sources and the parent
  index.

### 8.2 Scheduler
`croner` with `timezone: definition.schedule_tz`. Jobs are (re)registered on
create, `PUT`, disable, enable and delete, in the same request; a test
covers each. A tick, in order: cancel and supersede any paused run older
than `discoveryRefreshHours` whose `resume_after` is not in the future;
else if an execution is `paused_error` with `resume_after ≤ now`, or
`paused_budget` and `estimateRemaining` now passes the cap check, **resume
it** (through the compare-and-set); else if any execution is active, record
nothing and show "schedule blocked since <date>" in the status bar; else
run the pre-start checks and start. A `paused_error` with no `resume_after`
(every provider disabled) blocks the schedule until a manual resume or the
supersede above. Missed firings are skipped; a boot that finds the last
scheduled firing was missed records `skipped_missed` and notifies the
operator, which is the laptop-asleep case for a personal install. Cron is
a bounded string in `core/api-contract`; the single `parseCron` wrapper in
`engine` (over `croner`) is the **sole** semantic validator, imported by
`api` (sub-hourly rejected, tz validated); `core` has no cron parser.

**Cadence arithmetic** (and `docs/scheduling.md`), from the same functions
as the estimate, for the worked example's 4 pairs over a 182-day window,
under the §5.2 tilings measured by the spike:

| Config | Per run | Per month (weekly) | Fits |
|---|---|---|---|
| £0 Travelpayouts, `month` tiles | `O × D × M` free calls, or `D × M` with a shared metro (worked example 14) | ~60 | yes, cap 50,000; usefulness is whatever the coverage check reports for the pairs |
| SearchApi $40, weekly discovery, `maxCells 10, expandTop 2, bookingLinks true` | ~23 tiles per pair + `maxCells × 5` (worked example ~92 + 50 = ~142) | ~615 of 10,000 | yes: ~£32 subscription, marginal cost 0; the call cap is the hard stop; headroom for `maxCells` ~200 (~1,090/run) or daily runs (~4,300/month) |
| SearchApi trial | one discovery exceeds 100 | — | spike and smoke only; scheduled runs exclude SearchApi on `trial` |

There is no built-in definition with airports in it. The Definitions form
starts with empty origin and destination fields and a plan-aware **policy
preset** (`trial`/£0: Travelpayouts discovery only; `40usd`: both providers,
`maxCells 10, expandTop 2`); execution caps come from the plan preset.
`docs/setup.md` carries the London → New York example as importable JSON. `budgetFit` at save time
compares `runsPerMonth × estimate` with every cap and warns. The
`discoveryRefreshHours` comparison uses a 10% tolerance (reuse iff age <
0.9 × refresh) so a weekly cron refreshes weekly; tested at 151 h, 152 h and
a DST-shortened interval.

### 8.3 Notifications
`EmailNotifier` (nodemailer, `SMTP_*`, all or nothing; `SMTP_TLS = implicit
| starttls | none`, where `starttls` sets `requireTLS` and `none` is
permitted only for the dev Mailpit profile or a loopback host, else boot
refuses) and `LogNotifier`. Plain text only. Alerts are sent as digests
(§6.8). Subject:
`[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · 1 constraint unverified`
or, calendar basis, `… · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · constraints not checked`.
Body: segments (or "calendar price, no itinerary"), verdicts naming every
unverified constraint, provenance line with effective age, link (validated
`https`, host shown, expiry state; for POST bookings a link to the app's
results row instead), coverage caveat "itinerary-searched K of N cells, E
outbounds each", the rule. Provider strings CRLF/control-stripped.
Synthetic refused. The banned-word test (§11) runs over rendered notifier
output and API reason strings with word-boundary matching.

---

## 9. Testing
Thresholds in each package's `vitest.config.ts`, enforced in CI from WP0:
`core` 100% lines/branches/functions; `db`, `providers`, `engine`, `api`
85% lines and 70% branches; `web` 70% lines, 60% branches. Mutation
testing (Stryker) on `core` `hashing`, `constraints`, `selection`,
`rollUp`, `syntheticAllowed`, `toGbp`, `vendorUrl` and `alertDedup` with a
break threshold of 80%. First-failing-test per WP in §16.

1. **`core`**: §6.1 incl. relative windows, clamping, zero-cell windows,
   `startOffsetDays = 0` rejection, DST/TZ matrix; §6.2 every constraint,
   each with absent input → `unverified` (table-driven), and
   `verdictClass`; §6.3 `toGbp` (rounding, zero, large, CNY/JPY reference
   values, direction), non-integer rejection, timestamp format rejection;
   §6.4 matrix incl. `4U`, unmappable carrier, unknown tz; §6.6 precedence
   table enumerated independently, property invariant, monotone merge;
   §6.7 every interaction, stride edge cases (`m ≤ 0`, `total < m`); §6.8
   both bases, dedup, cooldown, calendar identity, digests, sparse-cache
   drop rule, 1,000 calls × 3200 micro-GBP = 320p trips a 300p cap;
   `syntheticAllowed` truth table incl. traversal and symlink cases; vendor
   URL validation; the label formatter.
2. **`providers`** (`msw` on global fetch): tiles partition cells and
   `plan().length` equals msw hits exactly; response-date keying drops
   out-of-band entries; empty-is-per-capability (Travelpayouts empty
   envelope → `no_data`, SearchApi empty grid → `parse`); `has_no_flights` →
   `noFares`; currency read from the response and a non-GBP response asserts
   conversion and the FX flag; `suppliedFields` populated from **recorded**
   fixtures only; parameter names and values match the dated allowlist;
   error mapping incl. `Retry-After`, 403, quota discrimination,
   per-request timeout, limiter-timeout; backoff with fake timers; pipeline
   order (cache hit → zero upstream, non-billable row, original `fetchedAt`;
   dedup → one call; reserve before fetch each attempt; `BudgetExceeded`
   before mock hit); `auth`/`quota`/`parse` never retried; abort mid-fetch
   finalises `unknown`, still counted by `usage()`, no retry; token
   responses never cached; egress allowlist and 302 test; recorder fails
   closed on secret substring and replaces tokens with placeholders so
   chains replay; sentinel-key test; fixture-tree tests (every committed
   fixture scanned; recorded files carry `recordedAt`, `recordedBy` and a
   content hash that the test recomputes, so a hand-edited file fails;
   synthetic files carry `synthetic:true`; loaders refuse the wrong tree);
   fixture gates incl. negatives; the fixture adapter's host allowlist is
   `fixture.local` only.
3. **`db`**: migrations; async transaction callback rejected; rollups
   atomic; `latest` ordering; UNIQUE keys; cap predicates (pending/unknown
   counted; billed vs free execution scopes; zero-cost passes a 0 cap;
   global cap includes the fixed fee once; lifetime window; **1,000 ledger
   rows at 3200 micro-GBP trip a 300p cap in SQL**); compare-and-set resume
   claim (two concurrent claimers, one wins); boot sweep; resume
   query per (stage, provider) with the manual-resume extension; roll-up
   precedence incl. row 0; soft delete; `app_lock` symmetry and stale
   takeover; the provider⇔kind check; FX CHECK constraint.
4. **`engine`**, two layers. **Layer A (WP7)**: the fixture provider as an
   HTTP adapter at `fixture.local` served by `msw` on global fetch, through
   the real http-kit and the real `db` `BudgetGuard` with the fixture cost
   rule, in-memory DB; this layer covers everything vendor-agnostic below.
   **Layer B (WP13, after 4b/5/6)**: the real adapters replaying recorded
   fixtures through the same path. Layer A: seeding; every
   row of the §8.1 error table in both stages; tile-error marks exactly its
   cells; reuse per cell copies prices with original `fetchedAt`, never
   copies error/not_run, refuses on a cabin change; a fresh price
   supersedes a reused row; interrupt after k of n tiles then resume
   re-plans only tiles with resumable cells and ledger rows = n; cancel mid
   expansion → `not_run`, no itinerary; concurrency 4 with 1 call left → 1
   billable call; stopping breach aborts siblings → `not_run`; SIGTERM then
   reboot resumes without incrementing the counter; crash-loop cap; pending
   sweep; boot order; refresh tolerance at 151/152 h and a DST interval;
   `departed` on resume; alert dedup across executions on both bases;
   digests; synthetic refused by alerts and notifiers; child execution
   rules and inclusion in results; scheduler re-registration on
   edit/disable/delete; one-shot resume jobs; paused_budget resumed at
   window start; `fx-unavailable`, `currency-unsupported`,
   `unknown-airport-tz`, `offers-dropped`.
5. **`api`**: every route against `core/api-contract` with provenance
   required on every price-bearing response; verdicts recomputed at read
   time after a constraint edit; stale rows returned with `stale: true`;
   `notSeenInLatest`; default basis per §6.9; auth gate incl. static and
   `/health` split, failed-auth rate limit, password length; Host/Origin/
   Content-Type checks; security headers; the §5.5 boot matrix with injected
   config **and** one test spawning the real bootstrap with a real
   production environment asserting that `/providers` omits `fixture`, that
   constructing the fixture provider throws, and that a synthetic repository
   write throws; cron validation; `/cells/verify` membership; `truncated` +
   `total`; `/tools/*` routes require auth.
6. **`web`**: View B states incl. partial-day five-way marker and
   per-basis colour scale with hatched fallback days; View D sums; a price
   lacking provenance fails to render; synthetic banner present and absent;
   distinct text and ARIA for pass/fail/unverified; keyboard operation;
   375px assertion that price, provenance **and the class badge** stay
   visible; banned-word test with word boundaries and an allowlist over
   web, engine templates and API strings; booking links render with
   `rel="noopener noreferrer"`, host shown, POST bookings as forms, no
   auto-navigation; chart empty and loading states. One Playwright smoke in
   fixture mode.
7. **Live scripts** (excluded from `pnpm test`, run via the tool bootstrap):
   `pnpm smoke:live` issues exactly one tile per configured provider (a
   query sized so `plan` yields one tile), asserts via the ledger, prints
   the cheapest price with provenance, writes dated fixtures, exits non-zero
   on zero providers configured or any configured-provider error, distinct
   exit code for `empty`. `pnpm record:fixtures --budget N` records the step
   1→2→3 chain for one cell and the 429/quota bodies when the vendor can be
   induced to return them, within an explicit call budget.
8. **Build**: a Dockerfile assertion for `NODE_ENV=production` and
   `IN_CONTAINER=1`.

---

## 10. HTTP API
Schemas in `core/api-contract`; every route is mounted under `/api` (the SPA
owns `/`; the table omits the prefix); errors `{ error: { code, message,
details? } }` where a 422 carries `details.fields[]`; every price-bearing
shape carries `provenance` and `stale`.

| Route | Purpose |
|---|---|
| `GET /health` | unauthenticated and exempt from the Host allowlist: `{ ok, degraded }` where `degraded` = job count ≠ enabled scheduled definitions, or an execution running past `STUCK_AFTER_HOURS`, with no detail; authenticated detail `{ db, providers, scheduler: { jobCount, nextRun, lastExecutionAt, degraded } }` |
| `GET /airports?q=` | airport-table autocomplete: up to 20 rows `{ iata, name, city, country, tz, metro }` |
| `GET /providers` | capabilities, plan, usage vs caps with window bounds; "verification will not run: spend cap is 0" when a billed provider is enabled under a zero cap |
| `GET/POST/PUT/DELETE /definitions[/:id]` | CRUD; `POST` with no body creates the **default definition for the configured plan**; response includes `budgetFit`; `PUT` re-registers the schedule; a zero-cell window returns 422 |
| `POST /definitions/estimate`, `POST /definitions/:id/estimate` | for an unsaved body or a saved definition: cells, per-provider calls (pre-factor and factored), cost (micro-GBP and pence), seconds, assumptions |
| `POST /definitions/coverage-check` | body: origins, destinations, window, nights; runs Travelpayouts month tiles (free, ledgered, subject to the free-call caps) and returns cached rows per pair per month; never calls a billed provider |
| `POST /definitions/:id/executions` | pre-start checks; `confirmCostPence?`; 409 on active execution or cap breach naming the cap |
| `GET /executions/:id` | status, stage, reason, `resumeAfter`, progress per stage × provider, budget usage for all scopes, estimate vs ledger (updates during run) |
| `POST /executions/:id/cancel`, `/resume` | `/resume` 409 if another is active or the compare-and-set loses; manual resume re-enables disabled providers and, on a `completed` execution, retries `error` outcomes with headroom |
| `POST /cells/verify` | validated cell → child execution; 409 if a child is active for that cell |
| `GET /definitions/:id/results?basis=&executionId=&limit=` | `{ rows, total, truncated, basis, basisReason, executions: [{ id, status, age }], coverage }`; default basis per §6.9; one row per itinerary (§6.5 dedup) from this definition's executions **including children**, filtered to the current resolved space and cabin, verdicts recomputed, **all verdict classes returned**, ranked by class then price so `failed` rows never consume the cap ahead of better ones, stale labelled, rows carry `notSeenInLatest`; calendar basis per §6.9; cap 1000 with `truncated`. **No sort or filter parameters**: sorting and filtering are client-side (§6.5) |
| `GET /definitions/:id/calendar?basis=` | per day: discovery counts per provider in the six buckets `{ priced, empty, no_data, error, skipped, not_run, reused }`, verification `{ selected, itinerarySearched, onDemand }`, `cheapestVerified` (class verified only, incl. children), `cheapestPartiallyVerified` with count, `cheapestCalendar`, `byDestination`; all in the definition's cabin |
| `GET /definitions/:id/duration-analysis` | per nights: `minVerified` (class verified, with n, incl. children), `minCalendar` per provider with n |
| `GET /definitions/:id/coverage` | summary, per-provider request counts, overrun and parity flags, "selected but not reached", errors with retry |
| `GET /definitions/:id/calendar-gap` | cells whose calendar price is below the cheapest class-`verified` observation (incl. children); empty when the definition has no verification provider |
| `GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate` | that cell's outcomes per stage and provider and its prices, each with full provenance (the View B side panel source) |
| `POST /tools/smoke`, `POST /tools/record` | the live smoke and recording scripts run inside the app process (authenticated), for use while the app holds `app_lock` |
| `GET /itineraries/:hash/history`, `GET /routes/:o/:d/history?cabin=` | series per provider and kind; the route's calendar series has one point per execution fetch (the pair's minimum across its cells, carrying the cheapest cell); reused rows excluded |
| `GET/POST/PUT/DELETE /alerts[/:id]`, `GET /alerts/events` | |
| `GET /scheduler/jobs`, `GET /budget` | |

---

## 11. Web UI
**Banned words everywhere (the one canonical list, tested with word
boundaries and a small allowlist over web, engine templates and API
strings):** "exhaustive", "all combinations", "every combination", "live",
"bookable", "guaranteed", "real-time". Use "fetched 12m ago", "Google
Flights via SearchApi" (itinerary search), "Google date grid via SearchApi"
(calendar), "Aviasales cache", "estimate vs ledger". The word "verified"
appears only beside class-`verified` values; the `verified` basis is
labelled "itinerary-search basis"; stage counts say "itinerary-searched".

Layout: nav owned by WP9 for all views; definition selector; **status bar**
on every view: stage, progress, spend used / cap for execution and month,
paused state with reason and Resume, "schedule blocked since <date>",
Cancel. Every view header: execution(s) shown, status, age, stale label,
banner when not completed. The Results header is two lines: **"cheapest
found £X · <destination> <dates> · <basis> · <verdict class> · <provider> ·
<age>"** and **"discovery: P priced · E no fares · X no cached data · R
error · S skipped · U not searched of M (R′ reused) · itinerary-searched K
of N selected (E outbounds each) +C on demand"**, linking to Coverage.
Empty state for no providers. Red synthetic banner (§5.5).

**Provenance on every price, visible without hover**: provider badge,
source in words, effective age in the `core` compact row format ("2h ago ·
≤7d", or "age unknown") with the full form on hover and in headers, "≈" when
FX-converted, dashed outline + "constraints not checked" for calendar
prices, destination airport, and the operator's per-destination note from
the definition (free text such as "onward leg not included") on every row
for that destination. Optional operator-entered onward cost per destination
renders as an "adjusted" column, labelled operator-entered, sortable, never
merged into price.

- **Definitions form** (one screen): origins and destinations entered by
  the operator with airport-table autocomplete (no preset airports); a
  **coverage check** button that runs the free Travelpayouts month tiles
  for the entered pairs and shows cached rows per pair before saving;
  per-destination note and onward-cost fields; defaults for everything
  else: relative window offset 7 days, length 182; 10–21 nights; economy;
  `maxJourneyMinutes` 1500; arrival 06:00–23:00 local; providers and
  policy from the plan preset (§8.2) with `discoveryRefreshHours` 168,
  `maxCells 10, topN 10, expandTop 2, bookingLinks true` (forced for
  SearchApi); execution budget from `EXECUTION_MAX_CALLS` /
  `EXECUTION_MAX_FREE_CALLS` / `EXECUTION_MAX_COST_PENCE`; schedule
  `0 5 * * 1` in `SCHEDULER_TIMEZONE`. The creation screen shows the
  estimate and the operator's "create" click is the explicit confirmation
  that sets `confirmed_cost_pence = ceil(estimateMicroGbp / 10 000)`.
  Advanced fold for constraints and policy. An "import example" action
  loads the JSON from `docs/setup.md`. The £0 path needs a three-line
  `.env` (`TRAVELPAYOUTS_TOKEN`, auth user, auth pass).
- **View A Results**: columns in order: price (+ provenance), total travel
  time, departure, return, nights, destination, carriers, stops, verdict
  class badge, fetched-ago, provider, adjusted (if configured). At 375px the
  primary row keeps price, provenance, **the class badge**, dates and stops;
  the rest moves to the expanded row. Expanded row: segments, layovers,
  baggage, conditions, every verdict, booking (GET link with host, POST
  form button, or "no link"), and the search link. Sorting and filtering
  are **client-side** over the fetched page with the shared pure functions,
  composing without refetch; when `truncated` the header says "within the
  cheapest 1000 of N". Filter and sort state persists across views.
  `bandCheapest` marks the cheapest row per 6h travel-time band. Calendar
  rows show the "not applied: …" note. Banner (only when a verification
  provider is configured): "N cells have calendar prices below your
  cheapest verified (£X)" with per-cell verify.
- **View B Calendar**: day shows, by precedence, the cheapest class-verified
  price under `STALE_AFTER_HOURS`, else the fresher of a stale verified and
  the cheapest calendar price (labelled; unknown age loses to known), else
  glyphs. Colour by **one basis at a time** on a quintile scale over the
  visible days of that basis; fallback days are hatched, excluded from the
  scale, and the legend says which basis each day uses. Marker: "P priced ·
  E no fares · X no cached data · R error · S skipped · U not searched of M"
  for discovery, and "itinerary-searched 1 of 10 selected +C on demand"
  separately. Distinct glyphs for `empty`, `no_data`, `error`,
  `not_run`; numeric legend. Per-destination filter. Side panel with cells,
  outcomes, verify.
- **View C Duration**: bars per nights with axis titles (nights, £); series
  "min among verified (class verified, n=…)" and calendar per provider; `n`
  in label and tooltip; explicit empty and loading states; gaps for
  unsearched nights; no interpolation.
- **View D Coverage**: counts per stage × provider with the six-bucket
  breakdown and "searched" as the umbrella beside it; selected but not
  reached with reason; overrun and parity flags; error list with retry.
- **History**: one series per provider and kind; x = `fetchedAt` for
  provider series and the point's own `date` for the route-level series
  from `route_price_history` (sixty points share one fetch time); gaps;
  reused rows excluded; axis titles; empty state.
- **Definitions / Alerts / Providers**: forms with estimate, `budgetFit`,
  standing confirmation, onward-cost entries, plan presets shown.
- **Accessibility**: 375px layout as above; keyboard-operable table and
  calendar; visible focus; labelled controls; no colour-only meaning;
  numeric legend on the heatmap.

Charts follow the `dataviz` skill.

---

## 12. Configuration
Parsed once in `api` bootstrap through the `core` zod schema; empty = unset;
invalid or half-set config fails boot naming the field; nothing defaults to
unlimited. Plan presets fill caps, rates, TTLs and costs; individual
variables override. The full preset table (every field per plan) lives in
`docs/api-limits.md` and the zod schema.

```
# --- core ---
NODE_ENV=production                      # production | development | test (test refused by the app bootstrap)
DATABASE_PATH=/data/get-me-there.db      # realpath-resolved at boot; .fixture.db required with ALLOW_FIXTURE_PROVIDER
PORT=3000
BIND_ADDRESS=0.0.0.0                     # container binds all; compose publishes 127.0.0.1:3000; non-loopback requires auth
ALLOWED_HOSTS=                           # Host allowlist; default derived from PORT: localhost:<port>,127.0.0.1:<port>
APP_BASE_URL=                            # optional https URL of this app, used for links in email; empty = relative links
APP_BASIC_AUTH_USER=                     # both or neither; required in the compose path; password ≥ 12 chars
APP_BASIC_AUTH_PASS=
ALLOW_UNAUTHENTICATED=false              # only for Tailscale-only hosts
TRUST_PROXY=false                        # read the client IP from X-Forwarded-For (reverse-proxy deployments)
LOG_LEVEL=info
POINT_OF_SALE=GB                         # ISO 3166 country for the vendors' point-of-sale parameters; base currency is fixed at GBP in this build
STALE_AFTER_HOURS=192                    # verified basis: one weekly cycle + 24 h
CALENDAR_STALE_AFTER_HOURS=              # optional override; default = discoveryRefreshHours + provider maxAgeHours
STUCK_AFTER_HOURS=12
MAX_CELLS_PER_DEFINITION=50000
SCHEDULER_TIMEZONE=Europe/London         # default schedule_tz for new definitions (single source)
AUTO_RESUME=true
MAX_AUTO_RESUMES=3
MAX_WAIT_SECONDS=3900                    # limiter queue deadline and Retry-After ceiling; above an hourly window
REQUEST_TIMEOUT_SECONDS=60
ESTIMATE_RETRY_FACTOR=1.2
FX_MAX_RATE_AGE_DAYS=3
# --- spend (operator writes pence; code holds micro-GBP) ---
MONTHLY_SPEND_CAP_PENCE=                 # total monthly spend incl. subscription fees; empty = preset default (0 with no billed provider, 3500 on 40usd); 0 = no billable calls; free providers still run
GLOBAL_BILLING_DAY=1                     # 1–28
SOFT_CONFIRM_PENCE=100
EXECUTION_MAX_CALLS=                     # billed calls per execution; preset default (trial 0, 40usd 2000)
EXECUTION_MAX_FREE_CALLS=2000            # free-provider calls per execution
EXECUTION_MAX_COST_PENCE=                # preset default (trial 0, 40usd 0: marginal cost is 0 on a subscription plan)
CHILD_MAX_CALLS=6
# --- travelpayouts (authorised, cached, free; schema defaults: cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0) ---
TRAVELPAYOUTS_TOKEN=                     # enables the provider
TRAVELPAYOUTS_BILLING_DAY=1              # 1–28
# overrides: TRAVELPAYOUTS_MONTHLY_CALL_CAP, _RATE_PER_MINUTE, _RATE_PER_HOUR, _CONCURRENCY, _CACHE_TTL_HOURS
# --- searchapi (scraping-derived; see docs/providers.md) ---
SEARCHAPI_KEY=                           # enables the provider
SEARCHAPI_PLAN=trial                     # trial (100 lifetime, 20/h, 2/min, concurrency 1, cost 0, fixed 0; excluded from scheduled runs)
                                         # | 40usd (subscription: 10000/mo call cap is the hard stop, 2000/h, 10/min, concurrency 2,
                                         #   marginal cost 0 µGBP/call, fixed 3200p counted once in the global cap; sets MONTHLY_SPEND_CAP_PENCE=3500,
                                         #   EXECUTION_MAX_CALLS=2000, EXECUTION_MAX_COST_PENCE=0 unless overridden)
                                         # a per-call plan would set _COST_PER_CALL_MICRO_GBP > 0 and fixed 0; none is offered today
                                         # 100usd is above the approved ceiling and needs every value set explicitly
SEARCHAPI_BILLING_DAY=1                  # 1–28
SEARCHAPI_CACHE_TTL_HOURS=1              # local cache window; the vendor does not bill a cached repeat (spike fact 4) but its window is undocumented
SEARCHAPI_TRIAL_USED=0                   # seed for the lifetime window when the trial was partly spent elsewhere
# overrides: SEARCHAPI_MONTHLY_CALL_CAP, _RATE_PER_MINUTE, _RATE_PER_HOUR, _CONCURRENCY, _COST_PER_CALL_MICRO_GBP, _PLAN_FIXED_PENCE
# --- email (all or nothing) ---
SMTP_HOST=
SMTP_PORT=
SMTP_TLS=implicit                        # implicit (465) | starttls (587, requireTLS) | none (dev Mailpit or loopback only)
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_TO=
ALERT_EMAIL_FROM=
# --- set by the Dockerfile, never by the operator ---
# IN_CONTAINER=1
# --- never in production; development only, not passed by compose ---
ALLOW_FIXTURE_PROVIDER=
```

On subscription plans the **call cap is the hard stop**, the marginal cost
per call is 0, and the global cap and `/budget` count
`SEARCHAPI_PLAN_FIXED_PENCE` once, so `MONTHLY_SPEND_CAP_PENCE` means total
monthly spend and the £35 ceiling is visible. Boot warns when a billed
provider is enabled under a zero cap.

---

## 13. Deployment and operations
`Dockerfile`: multi-stage; `node:22-slim` pinned by digest;
`NODE_ENV=production` and `IN_CONTAINER=1`; `pnpm install --frozen-lockfile`
with `onlyBuiltDependencies=["better-sqlite3"]` and the prebuilt fetch made
**fail-closed** (no source-build fallback; version pinned by the lockfile;
integrity recorded in the WP12 brief); migrations, the vendored airports
dataset and `scripts/` copied into the runtime image; `USER node`;
`.dockerignore` excludes `.env*`, `data/`, `fixtures/recorded/`,
`node_modules/`; the Dockerfile creates `/data` owned by `node` before the
volume is declared so a fresh named volume inherits the ownership;
`HEALTHCHECK` as a `node -e` fetch of `/api/health` with a `start_period`
covering migrations, backup, seeding and the `app_lock` waits (§7). The
repository `.gitignore` covers `.env*`, `data/`, `*.db*` and `backups/`, and
CI runs the secret scan over `fixtures/`.

`docker-compose.yml`: `app` with a **named volume** for `/data` (bind mounts
on Docker Desktop have WAL locking caveats, documented; bind only for
copying backups out), `ports: 127.0.0.1:3000:3000`, an explicit
`environment` allowlist (never `ALLOW_FIXTURE_PROVIDER` or `NODE_ENV`),
`BIND_ADDRESS=0.0.0.0`, `restart: unless-stopped`, `stop_grace_period:
30s`, `logging` options (`max-size`, `max-file`), no `env_file` (it would
forward every line of `.env`); boot fails with a clear message if `/data`
is not writable; `mailpit` under the `dev` profile serves the host-side
`pnpm dev` process (`SMTP_HOST=127.0.0.1`, `SMTP_TLS=none`); the container
always uses real SMTP.

**Backup**: the `db` package's backup routine, exposed as
`scripts/backup.mjs` (`VACUUM INTO` + `PRAGMA integrity_check` on the
output, refusing an existing target; a failure refuses migrations)
runs pre-migration when migrations are pending and on demand via `docker
compose exec`; the live smoke and recording are invoked from the host with
`curl -u … -X POST http://127.0.0.1:3000/api/tools/smoke` (the image has no
curl); docs give a
host cron example with retention, how to copy out of the named volume, and
an off-box copy. **Restore**: stop; delete `*.db-wal` and `*.db-shm`;
replace the `.db`; start. Restoring resets month-to-date spend: lower caps
and reconcile with the vendor dashboard.

**Local dev**: `pnpm dev` (api + web hot reload, `./data/dev.db`), `pnpm
smoke:live`, `pnpm record:fixtures`, `pnpm test`. Docs: `setup.md`
(first-run path: auth first, then `ALLOWED_HOSTS` for every hostname users
type with Tailscale and reverse-proxy examples, TLS termination, expected DB
growth), `api-limits.md` (preset table, per-provider facts, reconciliation),
`scheduling.md` (cron examples, cadence table, pausing).

---

## 14. Logging
pino JSON to stdout; `executionId`, `definitionId`, `providerId` on engine
lines; `redact` paths `apiKey`, `token`, `authorization`, `url.query`,
`req.headers.authorization` and the URL query/userinfo stripping rule, both
as specified in §5.3; no secrets, no full URLs.

---

## 15. Deviations from the original prompt
| Prompt said | This spec does | Why |
|---|---|---|
| Research providers, pick one, integrate ≥1 | Two integrated; Amadeus/Duffel rejected | §2 |
| "Documented, authorised interfaces" | SearchApi scraping-derived, opt-in, labelled | Ian's decision 2026-10-14 |
| No brittle scraping that violates provider terms | Self-scraping via Camoufox is named in §2 as a Phase 4 continuity fallback only; not built; `ProviderId` and `SourceKind` not widened | Ian's decision 2026-10-14; SearchApi carries that exposure one step removed |
| "Cheapest available / bookable" | "Cheapest round trip found"; provenance and age on every price | No path guarantees bookability |
| Free to operate | £0 config is Travelpayouts-only; SearchApi means the $40 plan | Its free allowance is a one-off trial |
| A specific set of origins and destinations as the initial set | No airports in code at all; every definition names its own, with autocomplete and a free coverage check; the docs example is London → New York | A personal tool should not need a code change to search a different route, and the operator's own route is private |
| Preferred currency default GBP | Base currency fixed at GBP (integer pence) for this build; `POINT_OF_SALE` is configurable | Multi-currency money handling is out of scope |
| Multi-airport queries | Per pair | Exact attribution |
| Daily scheduled search | Weekly default, sized to the plan | Cost; `budgetFit` enforces |
| Absolute date range | Relative windows supported and default | A scheduled absolute window expires |
| Filter without rerunning searches | Client-side filtering over the ranked page; `/results` has no filter parameters | One path, no refetch |
| Postgres/SQLite, Prisma/Drizzle | SQLite + Drizzle | One operator |
| Saved searches entity | Definition with schedule | One concept fewer |
| Airlines/routes as search dimensions | Filters and constraints | No provider exposes them |
| "Flexibility around travel dates" | Dropped | Duplicates window + nights |
| Phase 4 multimodal | Two columns + optional operator onward-cost estimate, separate column | Non-goal |
| Spend caps per search and month | Calls and cost caps at execution (billed and free), provider month/lifetime, global month incl. subscription fee; 0 = no spend; pre-start checks | Units unspecified |
| Live prices for table and alerts | Calendar basis, labelled, with search links | The £0 config must be useful |
| Optional auth | Refused unauthenticated on non-loopback; CSRF/Host checks; security headers | The API spends money |
| Multi-channel notifications | `Notifier` with email and log only | Premature abstraction |

---

## 16. Work packages

| WP | Scope | Owner | Depends on | First failing test |
|---|---|---|---|---|
| 0 | Scaffold, thresholds, CI; `core` types, ports, errors, config schema, `syntheticAllowed`, `api-contract`, label formatter; `db` skeleton | Fable | — | `syntheticAllowed` truth table |
| 1 | `core`: windows, space, validation, roll-up, coverage, selection | Sonnet | 0 | hand-computed cell counts for the default and the enumerated tiny space |
| 2 | `core`: normalisation helpers, hashing, constraints, classes, rank/filter/band, money, alerts | Sonnet | 0 | `VS 938` ≡ `VS938` hash |
| 3 | `db`: schema, migrations, repositories, `BudgetGuard`, cache, lock, seed, maintenance | Opus | 0 | 1,000 × 3200 µGBP trips a 300p cap |
| 4 | `providers`: http-kit, recorder, scrubbing, egress; fixture provider as an HTTP adapter | Opus | 0 | reserve happens before fetch on every attempt |
| **4b** | `record:fixtures` (records the public example route, LHR/LGW → JFK/EWR, through the real recorder, incl. a 429 if one can be induced; ~12 of the 91 remaining trial credits) and the minimal **wiring helper** (config parse + port construction) that WP8's bootstraps reuse | Fable | 3, 4 | recorded fixture carries a verifiable content hash |
| 5 | SearchApi adapter | Opus | 1, 2, 4, 4b | tiles partition the band |
| 6 | Travelpayouts adapter | Sonnet | 1, 2, 4, 4b | empty envelope → `no_data` |
| 7 | `engine` with layer-A tests (fixture provider through http-kit) | Opus | 1, 2, 3, 4 | resume after k of n tiles issues n−k |
| 8 | `api` (app and tool bootstraps on the WP4b helper, `/tools/*` routes) | Sonnet | 4b, 7 | production boot lacks `fixture` |
| 9 | `web` shell, Definitions, Results, Coverage | Sonnet | 8 | price without provenance fails to render |
| 10 | `web` Calendar, Duration, History | Sonnet | 9 | five-way day counts |
| 11 | alerts, email, Alerts UI | Sonnet | 7, 8, 10 | 50 firings → one digest |
| 12 | Docker, compose, env, backup, docs | Sonnet | 8, 9 | Dockerfile sets production + container flag |
| 13 | `smoke:live`, layer-B engine tests (real adapters replaying recorded fixtures), the `app_lock` "tool bootstrap starts no execution" test, integration review, final pass | Fable | all | live smoke exits 0 with provenance |

---

## 17. Changelog

### Revision 12: second-pass clarifications (2026-10-14)

§5.4: in a chained itinerary search only `upstream`, `network` and `parse`
errors count as a failed expansion; account and rate refusals propagate.

### Revision 11: rules settled by the wave-1 brief reviews (2026-10-14)

Twenty-six reviewer runs over the WP1–WP4 briefs. Folded in: the 429
quota rule drops its ledger arm and gains a header-less fallback (§5.2); the
http-kit seam is stated and in-flight joiners are ledgered (§5.3); dedup
chooses by class before price and stale rows are never demoted (§6.5);
cabin-not-offered precedence, roll-up reasons and the reused-copy
replacement rule (§6.6); the `maxCells` hard bound (§6.7); the minimum drop
step inside the cooldown and suppressed firings recorded (§6.8); the
`providers` table removed, alert rules soft-deleted, the app-lock refusal of
a live second app (§7); route calendar history as one point per fetch
(§10); search links absent on synthetic rows (§11).

### Revision 10: contract corrections from the brief-drafting pass (2026-10-14)

Fourteen work briefs were drafted against revision 9 and the implementation
plan; each reported where the spec was silent or contradicted itself. Folded
in: `tileIndex` on `reserve`/`recordCacheHit`, a `month` tile kind,
`pointOfSale` on provider results, optional `routeHistory` (§5.1); point of
sale is any ISO alpha-2 code (§3); the vendor message lives in `last_error`,
never `reason` (§3, §5.2); `cabin-not-offered` is an engine rule (§3, §5.2,
§8.1); Travelpayouts queries per pair by metro code with cache dedup (§5.2);
SearchApi rectangles use the tight return span (§2, §5.2); FX goes through
http-kit, never ledgered, at `api.frankfurter.dev` (§5.3, §5.6); validated
links keep their query in API bodies and emails (§5.3); the supersede rule is
a safety net (§6.6); schema additions and the 336 h cooldown default (§7);
manual resume refreshes the snapshot's budget; deleted definitions are never
resumed; boot makes no network call (§8.1); the cadence table is for the
worked example's 4 pairs and §1's numbers now match it; the API lives under
`/api` with `GET /airports` and `POST /definitions/estimate` (§10); vocabulary
for the calendar source and the basis label, six buckets in View D, History
x-axis for the route series (§11); `APP_BASE_URL` (§12); no curl in the
image, no `env_file`, Mailpit for host dev only (§13); React 19 and the gated
in-process fixture seam (§4); WP dependencies (§16). A second pass added
the §6.1 lookup signature, the three silent §5.4 cases, four §7 columns and
the `best_observation_id` semantics, the child budget rule (§8.1), the
§8.3 subject wording and the backup routine's home (§13).

### Revision 9: decisions taken at approval (2026-10-14)

Ian approved revision 8 and settled three open items, folded in without any
change to a design rule: self-scraping via Camoufox is a named Phase 4
continuity fallback in §2 (not built; types not widened; §1 non-goals and
§15 updated); the SearchApi dashboard readings close spike facts 4 and 7
(cached repeats and error responses are not billed; the free allowance is a
one-off credit balance, so `trial` stays a lifetime window and
`SEARCHAPI_CACHE_TTL_HOURS` is no longer provisional); the $40 plan is the
plan Ian is subscribing to (§1, §2 fact 7); WP4b no longer carries the
dashboard readings.

### Revision 8: operator's route removed from the repository (2026-10-14)

The worked example is London → New York throughout; the spike record and
fixtures and the four review summaries moved out of the repository; §2
spike results reworded without route names; WP4b records the example route.

### Revision 7: route-agnostic (2026-10-14, after the operator's correction)

No airport, city or country in application code: Travelpayouts tiling
uses the definition's origins (or their shared metro code from the
airports table), the "gateway mode" and the default definition with
airports are gone, the Definitions form starts empty with a free coverage
check and an importable docs example, the per-destination note is operator
text, the airport seed sanity check is generic, and `POINT_OF_SALE` is
configuration. Cadence rows are formulas with the worked example beside
them. §15 gains two rows.

### Revision 6 after the provider spike (2026-10-14)

Spike facts 1–8 resolved in §2. £0 configuration shown to be route-dependent
(thin routes can have no cached rows at all);
Travelpayouts tiling is `month` tiles via `LON` (21 per scan), `maxAgeHours`
48, `pointOfSale` unknown, economy only; SearchApi calendar is per airport
with a hard 200-combination 400, 9–29 s latency; `bookingLinks` forced on
after the parity assertion failed; unpriced options skipped;
`route_price_history` table added; cadence rows and §1 recomputed; WP4b
narrowed to re-recording and the wiring helper.

### Revision 5 against review 4 (101 findings)

1. Fold regressions repaired: §5.3 secret-sink list and §6.1 generation contract restored in full; §14 names the redact paths [arch-r4-001, sec4-001, devops4-005, strat-r4-001, arch-r4-010, po-308].
2. Subscription cost model: marginal cost 0 on subscription plans, fixed fee counted once, call cap is the hard stop; §1 headroom, §8.2 row and presets recomputed [cost-401, po-302, pft-r4-002, pie4-006, prov4-011, cost-405, cost-406].
3. WP4b owns a wiring helper; smoke, lock test and layer-B engine tests move to WP13; WP7 tests run the fixture provider through http-kit; WP8 depends on 4b; no injectable fetch [arch-r4-002, arch-r4-003, test-002, arch-r4-004, arch-r4-005, arch-r4-006].
4. Pre-start per provider and stage; global-month breach affects billed providers only [cost-402].
5. `confirmed_cost_pence` only from explicit confirmation; PUT returns `needsConfirmation` [cost-403].
6. Per-segment cabins on the observation; `max_age_hours` on observations; FX CHECK both directions; cabin/POS/kind on outcomes; cabin filter on every read and in calendar alert identity [dm-301, dm-302, dm-305, dm-303, dm-304, prov4-001, prov4-003, prov4-004, arch-r4-009].
7. `app_lock` symmetric with SIGTERM release and takeover; `/tools/*` routes; tool bootstrap refuses test [devops4-001, devops4-007, prov4-009].
8. £0 sparseness stated; first-run coverage line; six buckets; reused and on-demand counted; "searched" defined [pft-r4-001, po-301, strat-r4-007, prov4-006, prov4-007, prov4-008, ui-002].
9. Calendar drop window on `fetchedAt`; cooldown 336; "new" never a drop firing [po-303, po-306, pft-r4-006].
10. Parity-failure rule forces `bookingLinks`; every step-2 return option persisted; Travelpayouts market gate; `point_of_sale` `unknown`; SearchApi calendar currency and `maxAgeHours` 24; other 4xx mapped; paginated tiles ledger `tile_index`; month-matrix removed [pie4-001, pie4-002, pie4-003, pie4-004, pie4-005, pie4-007, pie4-008, prov4-005].
11. Provider-month row split; resume compare-and-set; `departed` scoped; supersede for any stale paused run; retry-errors on completed; ceiling unset rule; `skipped_window` and `skipped_missed`; deterministic normalisation failures excluded from auto-resume; `alwaysInclude` membership at save, dropped with a note at start [strat-r4-002, strat-r4-003, strat-r4-004, strat-r4-005, strat-r4-006, strat-r4-008, strat-r4-009, strat-r4-010, strat-r4-011, strat-r4-012, strat-r4-013, strat-r4-014, arch-r4-008].
12. `/results` returns all classes ranked by class then price; dedup per itinerary; sort keys and filters listed; cells route; health exempt from Host; `fx` through http-kit; `parseCron` in engine [ui-001, dm-306, po-307, prov4-002, prov4-010, devops4-002, arch-r4-007, arch-r4-011].
13. Security: `TRUST_PROXY` for the auth rate limit, `.gitignore` and CI scan, `/data` ownership in the Dockerfile, link allowlist matching [sec4-002, sec4-003, sec4-004, sec4-005, devops4-003].
14. Backup failure refuses migrations; lifetime plans keep ledger rows; billing day 1–28; `discoveryRefreshHours` default 168; `STALE_AFTER_HOURS` 192; overrun vs pre-factor plan; missed-firing notification [devops4-004, dm-308, cost-407, cost-408, po-304, po-305, cost-404, devops4-008, pft-r4-004].
15. UI: headline with destination and dates on two lines; compact age labels; quintile scale per basis; verify hidden on £0; label consistency [pft-r4-003, pft-r4-005, ui-003, ui-004, po-309, prov4-013, dm-307, prov4-012].
16. Tests: hand-computed counts; db-level cap test; bootstrap spawn assertions; recorded-file content hash; Stryker scope; branch floors [test-001, test-003, test-004, test-005, test-006, test-007].

### Revision 4 against review 3 (126 findings)

1. `fetchedAt` on tile and result from http-kit; `maxAgeHours` required per
   capability with values in §2; label format in `core`; unknown-age
   ordering [arch-r3-001, prov3-007, ui-005, prov3-015].
2. Synthetic gate: tmp branch replaced by `.test.db`, realpath in bootstrap,
   `IN_CONTAINER`, compose env allowlist, provider⇔kind check, real
   bootstrap spawn test, http-kit `fetch` seam gated [arch-r3-002, sec3-005,
   prov3-006, prov3-019, test-r3-001, test-r3-002, arch-r3-006].
3. WP4b spike/record/tool bootstrap [arch-r3-003, arch-r3-007].
4. Execution-calls predicates for billed vs free; presets with full table;
   global cap includes fixed fee; boot warning on 0 cap; trial default
   definition; 100usd removed; `SEARCHAPI_TRIAL_USED` [cost-301, cost-303,
   cost-308, cost-310, po-204, pft-r3-006].
5. Adapter retries removed; per-request timeout; retry bounds; parity metric
   redefined; retry factor on discovery [cost-305, cost-304, cost-306,
   pie3-007, strat-r3-008].
6. Child observations included in results/calendar-gap/counts; child cell
   columns and index; no parent required [dm-201, po-202, strat-r3-004,
   prov3-013, dm-208, strat-r3-015].
7. One calendar price per (provider, cell); reuse predicate with cabin/POS/
   kind; reused rows excluded from history and alerts; supersede rule;
   transactions for selection+seeding and reuse [dm-202, dm-203, dm-204,
   prov3-001, strat-r3-013, dm-210, prov3-012, strat-r3-007].
8. Search link on every row; default basis calendar; inapplicable
   constraints note; effective age as a number; calendar stale threshold
   derived [pft-r3-001, pft-r3-002, po-206, pft-r3-003, pft-r3-004].
9. Five-way coverage breakdown; "itinerary-searched"; headline carries
   basis/class/provenance [po-201, prov3-008, ui-002, po-205, prov3-004,
   prov3-016, ui-003].
10. Alert digests, cooldown default, sparse-cache drop rule [po-203,
    pft-r3-005].
11. Currency from response; `currency-unsupported`; ECB coverage; `gl=gb`;
    allowlist with values; quota discrimination; placeholder tokens in
    fixtures; step-3 parity definition [prov3-002, pie3-008, pie3-002,
    pie3-006, pie3-005, pie3-004].
12. Empty-is-per-capability [prov3-003, pie3-001, strat-r3-001].
13. Per-segment cabin and unverified cabin verdict [prov3-005].
14. One-shot resume jobs; departed cells on resume; `estimateRemaining`;
    paused run superseded; manual resume re-enables providers; pending
    sweep; interrupted auto-resume; counter semantics [strat-r3-002,
    strat-r3-003, cost-307, strat-r3-009, strat-r3-006, strat-r3-012,
    devops-001, strat-r3-005].
15. Vendor URL validation in core; render rules; 375 px badge; security
    headers; TLS guidance, auth rate limit, password length; `SMTP_TLS`;
    fail-closed prebuilt; IATA checks in validation [sec3-001, ui-001,
    sec3-002, sec3-003, sec3-004, sec3-006, sec3-007, devops-007].
16. Ports trimmed; cron single validator; `ProviderError.reason`; client-side
    filtering only; `@date-fns/tz`; grouped capabilities with typed
    `TileRequest`; dead fields dropped [arch-r3-004, arch-r3-005, arch-r3-008,
    arch-r3-009, ui-006, arch-r3-010, arch-r3-011, arch-r3-012].
17. Cadence table recomputed; "what $40 buys" [cost-302, po-207,
    strat-r3-016, pie3-003, pft-r3-007].
18. Schema: `self_transfer` on observation; `best_observation_id`;
    `last_verified_at` dropped; `unknown-airport-tz`; `app_lock` symmetric
    with heartbeat; retention job; backup rules; airport re-seed; FX CHECK and
    nano scale [dm-205, dm-206, dm-207, dm-209, dm-211, devops-002,
    devops-003, devops-004, dm-212, dm-213, prov3-018].
19. Roll-up row 0; `offers-dropped`; zero-legs step 2; stride edge cases;
    brackets; notes placement; zero-cell windows [strat-r3-010, prov3-011,
    prov3-010, strat-r3-011, strat-r3-018, strat-r3-017, strat-r3-014].
20. Tests: abort finalise, constraint-absent matrix, Stryker threshold, web
    branch floor, banned-word scope and word boundaries, first-failing-test
    column, chart states, refresh boundary values, `confirmed_cost` ceil,
    pre-start predicate, `ALLOWED_HOSTS` docs, compose logging/healthcheck,
    health degraded flag [test-r3-003…007, prov3-017, ui-007, ui-008,
    cost-309, cost-311, cost-312, devops-005, devops-006, devops-008,
    ui-004, prov3-009, pie3-004].

### Revision 3 against review 2 (140 findings)

See `.review-2.md`; every ID mapped in the revision-3 changelog, retained
in git history at commit 3cae750.

### Revision 2 against review 1 (145 findings)

See `.review-1.md`; mapped at commit 346f975.
