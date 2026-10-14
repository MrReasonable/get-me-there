---
wp: 2
title: "core: normalisation, hashing, constraints, results, money, alerts"
owner: sonnet
depends_on: [0]
spec_sections: ["§5.6 (pure parts: carrier canonicalisation, local time, hashing, money, FX flag; the db-touching step is WP7)", "§6.2", "§6.3", "§6.4", "§6.5", "§6.8", "§6.9 (pure parts: dedup, rank, filters, band, search link)", "§5.2 Vendor links", "§9 item 1"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, product-owner, security-reviewer]
status: draft
---

# WP2 — `core`: normalisation, hashing, constraints, results, money, alerts

## 1. Goal

Add to `@gmt/core` the pure functions that turn a raw vendor offer into a hashed, time-zoned, pence-priced itinerary, judge it against the operator's constraints, rank, filter and deduplicate result rows, and decide which alerts fire and how they are digested, all at 100% coverage.

## 2. Scope

**In**

- Carrier and flight-number canonicalisation, `departLocal` with the spec §5.6 DST rules, vendor timestamps to the `toISOString()` form (`packages/core/src/normalise/`).
- `itineraryHash` (spec §6.4) with `@noble/hashes`.
- `toGbp`, `MINOR_EXPONENT`, `ECB_CURRENCIES` (spec §6.3).
- `validateVendorUrl` and the per-provider `LINK_ALLOWLIST` (spec §5.2).
- `normaliseOffer`: the pure half of the spec §5.6 step for one `RawOffer`.
- `evaluateConstraints`, `verdictClass`, `unverifiedNames` (spec §6.2).
- `dedupByItinerary`, `rankRows`, `sortRows`, `filterRows`, `bandCheapest`, `searchLinkFor` (spec §6.5, §6.9).
- `evaluateAlertRules`, `identityKey`, `dedupKey`, `isSuppressed`, `buildDigest` (structured `AlertDigest`, no text) (spec §6.8).
- Barrel exports for all of the above in `packages/core/src/index.ts`.

**Out**

- Reading the airports and FX repositories, writing prices, outcomes and `offers-dropped:n`, the per-tile minimum per cell, the FX refresh: **WP7** (`engine`, `src/normalise.ts`, `src/fx/refresh.ts`).
- Assembling alert candidates (current execution, non-reused calendar rows), persisting `alert_events`, rendering the digest subject and body (spec §8.3), sending: **WP11** (`engine/src/alerts/runner.ts`, `templates.ts`, `notifiers/email.ts`).
- The `/results` query, `basisReason`, `excludedByCurrentSpace`, the calendar-basis `notApplied` list and the default basis choice: **WP8** (`api`).
- Windows, cells, epoch-day helpers, roll-up, buckets, selection: **WP1** (runs in parallel; WP2 must not import it). `cellKeyString` is WP0's.
- Rendering rows, links and forms: **WP9**/**WP10** (`web`).
- Types (including every alert type in `types/alerts.ts` and `DigestItem`/`AlertDigest` in `ports/notifier.ts`), ports, errors, labels, banned words and `BANNED_WORD_ALLOWLIST`, api-contract schemas, the Stryker config: **WP0** (consumed, not changed).

## 3. Spec sections

- **§5.6 (pure parts)**: airport tz unknown → `unknown-airport-tz`, never hash UTC; `departLocal` per segment via `@date-fns/tz`, nonexistent wall times shift forward, ambiguous take the first occurrence, tested on a UK/EU DST change; canonicalise and hash; evidenced cabin only when every segment states one; money via `toGbp`, ECB-covered currencies only, missing rate → `fx-unavailable`; the FX flag and rate travel together.
- **§6.2**: every constraint row of the table, judged at read time against `supplied_fields_json`; absent input → `unverified`, tested per row; `failed` iff any `fail`.
- **§6.3**: `Segment` and `NormalisedItinerary` shapes; integer pence; `fx_rate_nano` = GBP per 1 native unit × 1e9; `toGbp` rounds half-up to the penny, tested against CNY and JPY reference values in that direction; non-integers rejected; timestamps only in `toISOString()` form.
- **§6.4**: hash input `'OUT|' + segs + '|IN|' + segs`, carrier `^[A-Z0-9]{2}$`, unmappable carrier is an error, flight number integer without leading zeros, `departLocal` exactly `YYYY-MM-DDTHH:mm`, marketing carrier for codeshares, price/cabin/provider/seller/tokens excluded; the `VS 938`/`VS938`/`0938`, `4U 8888`, `T` vs space, UTC vs local vs offset, unknown tz matrix.
- **§6.5**: dedup per itinerary hash showing the cheapest qualifying offer in the definition's cabin, others in the expanded row; rank by class then price; sort keys price, total travel time, departure, return, nights, stops, adjusted; filters verdict class, unverified-constraint name, provider, stops, carriers, destination, max price, nights range, stale; `bandCheapest(rows, 6h)`.
- **§6.8**: both bases and their identities; candidates from the current execution only, reused calendar rows excluded; calendar drops only against a previous price fetched within 2 × `discoveryRefreshHours` (tested at 167 h, 168 h, 169 h); absent-then-present is "new", never a drop firing; `dedupKey = identity + floor(pricePence / 100)`; cooldown suppression; synthetic refused; one digest per rule per execution with the top 10 and a count of the rest (50 → one digest).
- **§6.9 (pure parts)**: failed excluded by default and included by filter; every row carries a search link labelled "search link, not a fare link" (Aviasales for Travelpayouts, Google Flights for SearchApi), prefilling airports, dates, cabin and one adult.
- **§5.2 Vendor links**: `https:`, no userinfo, host equal to or a subdomain of the provider allowlist (`aviasales.com`, `google.com`), else `{ kind: 'none' }`; seller hosts never linked.
- **§9 item 1**: the `core` test list for §6.2, §6.3, §6.4, §6.8 and vendor URL validation; `core` 100% lines/branches/functions; Stryker break 80% on `hashing`, `constraints`, `toGbp`, `vendorUrl`, `alertDedup`.

## 4. Interfaces consumed

All from WP0, imported by relative path inside `@gmt/core`. Copied verbatim from the plan's "Cross-package contracts" (commit 790d1ea, round-2 pins included) and spec §5.1. Only the blocks WP2 reads are shown.

```ts
// types/ids.ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export const isoDateSchema: z.ZodType<IsoDate, string>;    // regex + real calendar date check (rejects 2027-02-29)
export const isoMonthSchema: z.ZodType<IsoMonth, string>;
export const isoDateTimeSchema: z.ZodType<IsoDateTime, string>; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ and Date.parse round-trips
export function isRealDate(y: number, m: number, d: number): boolean;
export function asIata(s: string): Iata;           // throws on mismatch; tests and seeds only
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;

// types/provenance.ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';   // defined here; ports/provider.ts re-exports it
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';   // ISO 3166-1 alpha-2 upper-case (POINT_OF_SALE echoes), or 'unknown'; pointOfSaleSchema = z.string().regex(/^[A-Z]{2}$/).or(z.literal('unknown'))
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}
export const providerIdSchema, sourceKindSchema, cabinSchema, pointOfSaleSchema, fxInfoSchema, provenanceSchema;
// provenanceSchema uses z.object({...}).strict() with providerObservedAt: isoDateTimeSchema.exactOptional()  (zod 4; needed under exactOptionalPropertyTypes)

// types/definition.ts (excerpt)
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }   // the ONLY definition; ports/provider.ts imports it
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}` — lives here (WP0) so WP1, WP2, WP3 all share it
export type LocalTimeWindow = { from: string; to: string };   // HH:mm, inclusive, local to the airport
export interface Constraints {
  maxStops?: number; maxJourneyMinutes?: number; minLayoverMinutes?: number; maxLayoverMinutes?: number;
  noOvernightLayover?: boolean; departureWindowLocal?: LocalTimeWindow; arrivalWindowLocal?: LocalTimeWindow;
  cabinBagRequired?: boolean; checkedBagRequired?: boolean; minCheckedBags?: number; maxPricePence?: number;
}

// types/itinerary.ts
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }
export interface FareConditions { refundable?: boolean; changeable?: boolean; notes?: string[] }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Segment { marketingCarrier: string; operatingCarrier?: string; flightNumber: number; from: Iata; to: Iata; departLocal: string; arriveLocal: string; departUtc?: IsoDateTime; arriveUtc?: IsoDateTime; durationMinutes?: number; aircraft?: string }
export interface Layover { at: Iata; minutes: number; overnight: boolean; airportChange: boolean }
export interface NormalisedItinerary { hash: string; origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate; nights: number; outbound: Segment[]; inbound: Segment[]; outboundMinutes?: number; inboundMinutes?: number; stopsOut: number; stopsIn: number; layovers: Layover[]; airportChange?: boolean; marketingCarriers: string[] }
export interface Offer { itineraryHash: string; providerId: ProviderId; seller: string; cabin: Cabin }
export interface ObservationFields {   // what normalisation yields for one raw offer, before the db assigns ids
  pricePence: number; priceNativeMinor: number; currencyNative: string; fx: FxInfo; taxesIncluded: boolean | null; selfTransfer: boolean | null;
  segmentCabins: Cabin[] | null; baggage: BaggageSnapshot | null; fareConditions: FareConditions | null; booking: Booking; bookingExpiresAt: IsoDateTime | null;
}
export interface Observation extends ObservationFields { id: number; offerId: number; executionId: string; provenance: Provenance; suppliedFields: SuppliedField[]; partialExpansion: boolean }
export type Verdict = 'pass' | 'fail' | 'unverified';
export type ConstraintName = keyof Constraints | 'cabin';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
export type ResultBasis = 'verified' | 'calendar';   // API values; the UI labels them "itinerary-search basis" and "calendar basis"

// types/alerts.ts
export type AlertRuleType = 'absolute' | 'dropPct' | 'dropAbs';
export interface AlertRule { id: string; definitionId: string; type: AlertRuleType; thresholdPence: number | null; pct: number | null; basis: ResultBasis; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export type AlertRuleInput = Omit<AlertRule, 'id'>;
export interface AlertEvent { id: number; ruleId: string; identityKey: string; observationId: number | null; calendarPriceId: number | null; dedupKey: string; firedAt: IsoDateTime; status: 'sent' | 'failed' | 'suppressed'; reason: string | null; payload: unknown }
export type VerifiedCandidate = { basis: 'verified'; observation: Observation; itinerary: NormalisedItinerary; verdictClass: VerdictClass; unverified: ConstraintName[]; seller: string; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type CalendarCandidate = { basis: 'calendar'; calendarPriceId: number; cell: Cell; pricePence: number; provenance: Provenance; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface Firing { rule: AlertRule; candidate: AlertCandidate; identityKey: string; dedupKey: string; reason: string; isNew: boolean; suppressed: { reason: string } | null }   // evaluateAlertRules returns suppressed firings too; the runner records them with status 'suppressed' and the digest excludes them
export interface PriorFiring { identityKey: string; dedupKey: string; firedAt: IsoDateTime; pricePence: number }
// identityKey formats: verified `${ruleId}|${itineraryHash}`; calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`. dedupKey = `${identityKey}|${Math.floor(pricePence / 100)}`.

// ports/notifier.ts (excerpt)
export interface DigestItem { pricePence: number; provenance: Provenance; cell: Cell; verdictClass: VerdictClass | 'unchecked'; itineraryHash: string | null; seller: string | null; unverified: ConstraintName[]; previousPricePence: number | null; previousAgeHours: number | 'unknown' | null; isNew: boolean; firingReason: string; booking: Booking; bookingExpiresAt: IsoDateTime | null; outbound: Segment[] | null; inbound: Segment[] | null; searchLink: { url: string; host: string; label: string }; rowKey: string /* resultRowKey, for the app link */ }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number; newItems: DigestItem[]; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }

// ports/provider.ts — spec §5.1 (the parts WP2 reads)
export interface RawSegment { marketingCarrier: string; operatingCarrier?: string; flightNumber: string; from: Iata; to: Iata; depart: string; arrive: string; timeKind: 'local' | 'utc' | 'offset'; cabin?: Cabin; durationMinutes?: number; aircraft?: string }
export interface RawOffer {
  outbound: RawSegment[]; inbound: RawSegment[]; seller: string; requestedCabin: Cabin;
  amountMinor: number; currency: string; taxesIncluded?: boolean;
  baggage?: BaggageSnapshot; fareConditions?: FareConditions; selfTransfer?: boolean;
  booking: { kind: 'get'; url: string } | { kind: 'post'; url: string; postData: string } | { kind: 'none' };
  bookingExpiresAt?: IsoDateTime;
}

// errors.ts (Task 0.4)
export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time' | 'cell-mismatch';
export class NormalisationError extends Error { reason: NormalisationReason; detail?: string }   // new NormalisationError(reason, detail?)

// labels/age.ts (Task 0.7, with the maxAgeHours-0 rule settled in contracts v2)
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;   // hours non-negative, clamped at 0
export function formatAgeCompact(a: EffectiveAge): string;
export function compareAges(a: EffectiveAge, b: EffectiveAge): number;  // unknown loses to any known; otherwise by worst-case hours

// text/bannedWords.ts
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in'];

// api-contract/results.ts — resultRowSchema (its z.infer is ResultRow; fields per the plan's API contract block):
// { itineraryHash: string | null; basis: ResultBasis; verdictClass: VerdictClass | 'unchecked'; pricePence; provenance; stale; ageHours; cell: Cell;
//   outbound: Segment[] | null; inbound: Segment[] | null; totalMinutes: number | null; outboundMinutes; inboundMinutes; stopsOut; stopsIn; layovers: Layover[];
//   carriers: string[]; verdicts: Verdicts; unverified: ConstraintName[]; notApplied: ConstraintName[]; seller: string | null; baggage: BaggageSnapshot | null;
//   fareConditions: FareConditions | null; selfTransfer: boolean | null; booking: Booking; searchLink: { url; host; label };
//   otherOffers: Array<{ seller; pricePence; provenance; booking; stale; ageHours }>; notSeenInLatest: { ageHours } | null; adjustedPence: number | null;
//   destinationNote: string | null; executionId: string; calendarPriceId: number | null; observationId: number | null }
```

## 5. Interfaces produced

The plan's "Core domain functions (WP2)" block, verbatim. Later packages rely on these names, and the code in §8 implements exactly these signatures:

```ts
// WP2 (normalise/, constraints/, results/, alerts/)
export function canonicalCarrier(s: string): string; export function canonicalFlightNumber(s: string | number, carrier?: string): number;
export function departLocal(input: string, timeKind: 'local' | 'utc' | 'offset', tz: string): string; export function toIsoDateTime(input: string, timeKind: 'local' | 'utc' | 'offset', tz: string): IsoDateTime;
export function itineraryHash(outbound: Segment[], inbound: Segment[]): string;
export const MINOR_EXPONENT: Record<string, number>; export const ECB_CURRENCIES: readonly string[]; export function toGbp(amountMinor: number, currency: string, rateNano: number): number;
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export const SEARCH_LINK_LABEL = 'search link, not a fare link'; export function validateVendorUrl(url: string, allowlist: string[]): Booking; export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url: string; host: string; label: string };
export interface NormaliseDeps { providerId: ProviderId; cabin: Cabin; tzOf(iata: Iata): string | null; rateFor(currency: string): { rateNano: number; rateDate: IsoDate; source: string } | null }
export function normaliseOffer(raw: RawOffer, cell: CellKey, deps: NormaliseDeps): { ok: true; itinerary: NormalisedItinerary; offer: Offer; observation: ObservationFields } | { ok: false; error: NormalisationError };
export function evaluateConstraints(it: NormalisedItinerary, obs: ObservationFields & { segmentCabins: Cabin[] | null }, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts; export function verdictClass(v: Verdicts): VerdictClass; export function unverifiedNames(v: Verdicts): ConstraintName[];
export type ResultRow = z.infer<typeof resultRowSchema>; export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted'; export interface ResultFilters { verdictClass?: Array<VerdictClass | 'unchecked'>; unverified?: ConstraintName[]; providerId?: ProviderId[]; maxStops?: number; carriers?: string[]; destination?: Iata[]; maxPricePence?: number; nights?: { min: number; max: number }; hideStale?: boolean }
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;   // itineraryHash, or `calendar:${calendarPriceId}`; the web's `?row=` parameter and email links use it
export function dedupByItinerary(rows: ResultRow[]): ResultRow[]; export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[]; export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[]; export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[]; export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string /* row key */>;
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], prior: PriorFiring[], ctx: { now: IsoDateTime; executionId: string; cabin: Cabin; discoveryRefreshHours: Partial<Record<ProviderId, number>> }): Firing[];
export function identityKey(rule: AlertRule, c: AlertCandidate): string; export function dedupKey(identityKey: string, pricePence: number): string; export function isSuppressed(f: Pick<Firing, 'identityKey' | 'dedupKey' | 'candidate'>, prior: PriorFiring[], cooldownHours: number, now: IsoDateTime): { suppressed: boolean; reason: string | null };
export function buildDigest(rule: AlertRule, firings: Firing[], ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] }): AlertDigest | null;   // null when no firing; top 10 + restCount
```

Settled details this brief pins, all inside those signatures:

- `departLocal` and `toIsoDateTime` throw `NormalisationError('unknown-airport-tz')` for a zone the runtime does not know. `normaliseOffer` turns `tzOf(iata) === null` into the same error.
- `normaliseOffer` drops an offer that does not fly `cell` as `cell-mismatch`, with the detail "offer flies …, cell is …". It compares origin, final destination, local departure date and local return date through `cellKeyString`, and never re-keys an offer.
- `resultRowKey(row)` = `itineraryHash ?? \`calendar:${calendarPriceId}\``. `bandCheapest` returns a set of these keys. Calendar rows have no travel time and are never marked.
- `evaluateAlertRules` returns suppressed firings too, each with `suppressed: { reason }` from `isSuppressed` against `prior` (this rule set's sent firings; WP11's query excludes `failed` and `suppressed` events), else `suppressed: null`. `isNew` firings are never suppressed. The calendar drop window is `2 × (ctx.discoveryRefreshHours[providerId] ?? 168)` whole hours, inclusive. The 168 h default is spec §7's.
- `buildDigest` ignores suppressed firings. `items` = the 10 cheapest non-new firings; `newItems` = the 10 cheapest new cells; `restCount` = everything beyond both lists. It returns null when no unsuppressed non-new firing exists and throws on synthetic provenance. Each `DigestItem` is filled from the candidate:
  - `previousAgeHours`: the previous price's age at this fetch, in whole hours.
  - `booking`, `bookingExpiresAt`, `outbound`, `inbound`: from the observation and itinerary for a verified candidate; `{ kind: 'none' }`, null, null, null for a calendar one.
  - `rowKey`: `resultRowKey` of the row the item stands for.

Module-internal helpers are not in the barrel. They are `parseVendorTime`, `requireZone`, `wallToInstant`, `localMinute` and `vendorInstant` (localTime.ts), `hoursSince` and `priceOf` (alerts/dedup.ts), `need` (alerts/evaluate.ts) and `formatPence` (alerts/format.ts). The type `AlertEvalContext` (alerts/evaluate.ts) names the plan's inline `ctx` type.

## 6. Library notes

Versions from the plan's Task 0.1 list. Every call below was checked on 2026-10-14 against context7 and run in a scratch install of the exact versions, under `TZ=UTC`, `Europe/London`, `America/Los_Angeles` and `Asia/Tokyo`.

| Library | Version | Calls used | Verified against |
|---|---|---|---|
| `@date-fns/tz` | 1.5.0 | `new TZDate(epochMs, tz)` then `getFullYear/getMonth/getDate/getHours/getMinutes` (wall-clock reading in `tz`); `tzOffset(tz, date)` returns minutes east of UTC, and `NaN` for an unknown zone (it never throws) | context7 `/date-fns/tz` (`_autodocs/api-reference/tzdate.md`: constructor overloads; an invalid zone gives Invalid Date without throwing) and source `src/date/mini.js`. **The component constructor `new TZDate(y, m, d, h, mi, tz)` is deliberately not used.** It resolves wall components through the *system* zone and has no disambiguation option, so an ambiguous time would depend on the host TZ. `wallToInstant` computes both candidate offsets with `tzOffset` instead. Scratch run: `tzOffset('Europe/London', 2027-03-28T01:30Z) = 60`, `tzOffset('Bad/Zone', …) = NaN`. |
| `@noble/hashes` | 2.4.0 | `import { sha256 } from '@noble/hashes/sha2.js'`; `import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'` | context7 `/paulmillr/noble-hashes` (README "SHA-2"; `_autodocs/api-reference/utils.md` `bytesToHex`). v2 needs the `.js` subpaths; `@noble/hashes/sha256` is gone. Scratch run: `bytesToHex(sha256(utf8ToBytes('abc')))` = `ba7816bf…15ad`. |
| `zod` | 4.6.7 | Only `z.infer<typeof resultRowSchema>` (type position) and `resultRowSchema.parse` in a test helper; WP2 defines no schemas | WP0's schemas (contracts v2 use `.exactOptional()` for `providerObservedAt`). |
| `fast-check` | 4.10.2 | `fc.assert`, `fc.property`, `fc.integer({ min, max })`, `fc.record`, `fc.constantFrom`, `fc.array(arb, { minLength, maxLength })`, `fc.date({ min, max, noInvalidDate: true })` | Scratch run of every property in this brief. |
| `vitest` | 5.0.4 | `describe`, `it`, `it.each`, `expect(...).toBe/toEqual/toMatchObject/toThrow/toHaveProperty`; a missing module fails with `Error: Cannot find module '<path>' imported from <test>` | Scratch run; that failure text is what the "verify it fails" steps expect. Per-task runs use `pnpm --filter @gmt/core exec vitest run <file>` (no coverage thresholds on a partial run; plan decision 8). |
| Stryker | `@stryker-mutator/core` 10.0.0, command runner | `pnpm --filter @gmt/core mutate` with WP0's config (`"testRunner": "command"`, `pnpm exec vitest run --coverage.enabled=false`; plan decision 8) | Scratch run with that runner on this brief's code (2026-10-14): hashing 100%, money 94.05%, vendorUrl 95%, constraints/evaluate 91.70%, alerts/dedup 97.87%. The one alerts/dedup survivor (`maxAgeHours: 'unknown'` → `""` inside `hoursSince`) is equivalent, because `fetchedHours` does not read `maxAgeHours`. |
| frankfurter (data, not a dependency) | — | the `ECB_CURRENCIES` list | `GET https://api.frankfurter.dev/v1/currencies` on 2026-10-14: 30 codes, no BGN or RUB. |
| Aviasales search URL (data) | — | `https://search.aviasales.com/flights/?origin_iata=&destination_iata=&depart_date=&return_date=&adults=&children=&infants=&trip_class=` | The Travelpayouts help-centre search-form example (`origin_iata=LON…&trip_class=0&depart_date=…&return_date=…`), found by web search on 2026-10-14; a direct fetch of the article returned 403. `trip_class` is 0 economy, 1 business, 2 first. |
| Google Flights search URL (data) | — | `https://www.google.com/travel/flights?q=<words>&hl=en&curr=GBP` | Google publishes no documented deep-link format (spec §2: no public API). The natural-language `q` form is the search-box entry point. It is a convenience search link, labelled as such; WP9's manual check opens one. |

## 7. Files

**Create** (all under `packages/core/`):

- `src/normalise/carrier.ts`, `src/normalise/localTime.ts`, `src/normalise/timestamps.ts`, `src/normalise/hashing.ts`, `src/normalise/money.ts`, `src/normalise/vendorUrl.ts`, `src/normalise/itinerary.ts`
- `src/constraints/evaluate.ts`, `src/constraints/verdictClass.ts`
- `src/results/types.ts`, `src/results/dedup.ts`, `src/results/rank.ts`, `src/results/filter.ts`, `src/results/rowKey.ts`, `src/results/band.ts`, `src/results/searchLink.ts`
- `src/alerts/format.ts`, `src/alerts/dedup.ts`, `src/alerts/evaluate.ts`, `src/alerts/digest.ts` (the alert *types* are WP0's `types/alerts.ts`)

**Modify:**

- `packages/core/src/index.ts`: append the WP2 export block (Task 2.12). WP1 appends its own block in parallel, so keep WP2's lines contiguous under the `// --- WP2` comment and resolve any merge by keeping both blocks.

**Test** (mirroring `src`):

- `test/helpers/offers.ts`, `test/helpers/rows.ts`, `test/helpers/alerts.ts` (helpers, not matched by `test/**/*.test.ts`)
- `test/normalise/hashing.test.ts`, `localTime.test.ts`, `money.test.ts`, `vendorUrl.test.ts`, `itinerary.test.ts`
- `test/constraints/evaluate.test.ts`
- `test/results/dedupRank.test.ts`, `test/results/filterBandLink.test.ts`
- `test/alerts/dedup.test.ts`, `test/alerts/evaluate.test.ts`, `test/alerts/digest.test.ts`
- `test/text/emitted.test.ts`, `test/wp2-barrel.test.ts`

No other package and no WP0 file is touched. The plan file map lists `src/results/rank.ts` for `rankRows` and `sortRows`; `results/types.ts`, `results/rowKey.ts`, `results/searchLink.ts` and `alerts/format.ts` are added here because they have one responsibility each.

## 8. Tasks

Every "Run" step runs **only that task's test file**, with `pnpm --filter @gmt/core exec vitest run <file>` (plan decision 8). `pnpm --filter @gmt/core test` enables coverage with the 100% thresholds over all of `src`, so a partial run would fail those thresholds even when every test passes. The full coverage run belongs in the definition of done. The code below is already formatted with the plan's `biome.json` (Biome 2.5.15). Run `pnpm lint:fix` if an edit reflows it.

### Task 2.1: Carrier canonicalisation and the itinerary hash (first failing test)

**Files:**
- Create: `packages/core/src/normalise/carrier.ts`, `packages/core/src/normalise/hashing.ts`
- Test: `packages/core/test/normalise/hashing.test.ts`

**Interfaces:**
- Consumes: `NormalisationError` (errors.ts), `Segment`, `Iata` (types), `sha256`, `bytesToHex`, `utf8ToBytes` (`@noble/hashes`)
- Produces: `canonicalCarrier`, `canonicalFlightNumber`, `HashSegment`, `itineraryHash`

The first test is the plan's first failing test: `VS 938` ≡ `VS938`. The golden value was computed from the literal string `OUT|VS:938:LHR:JFK:2027-03-14T10:05|IN|VS:939:JFK:LHR:2027-03-28T18:30`, independently of the implementation. A second golden value, two segments each way, pins the `;` separator. If the hash input format ever changes, these tests must fail. `itineraryHash` accepts `Pick<Segment, …>` (`HashSegment`), which is wider than the plan's `Segment[]`, so every `Segment[]` caller compiles unchanged.

- [ ] **Step 1: Write the failing test**

`packages/core/test/normalise/hashing.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { canonicalCarrier, canonicalFlightNumber } from '../../src/normalise/carrier.js';
import { type HashSegment, itineraryHash } from '../../src/normalise/hashing.js';
import type { Iata } from '../../src/types/ids.js';

const LHR = 'LHR' as Iata;
const JFK = 'JFK' as Iata;

/** One-segment each way on the worked example, with the flight number as a vendor string. */
function trip(carrier: string, flight: string): [HashSegment[], HashSegment[]] {
  const c = canonicalCarrier(carrier);
  return [
    [
      {
        marketingCarrier: c,
        flightNumber: canonicalFlightNumber(flight, c),
        from: LHR,
        to: JFK,
        departLocal: '2027-03-14T10:05',
      },
    ],
    [
      {
        marketingCarrier: c,
        flightNumber: canonicalFlightNumber('939', c),
        from: JFK,
        to: LHR,
        departLocal: '2027-03-28T18:30',
      },
    ],
  ];
}

describe('itinerary identity (spec §6.4)', () => {
  it('VS 938 ≡ VS938', () => {
    expect(itineraryHash(...trip('VS', 'VS 938'))).toBe(itineraryHash(...trip('VS', 'VS938')));
  });

  it('VS 938 ≡ VS938 ≡ 0938 ≡ 938, and a lower-case carrier is canonicalised', () => {
    const h = itineraryHash(...trip('VS', '938'));
    for (const f of ['VS 938', 'VS938', '0938', 'vs 0938', ' VS  938 '])
      expect(itineraryHash(...trip('vs', f))).toBe(h);
  });

  it('4U 8888: an alphanumeric designator is kept and its digit is not read as a flight number', () => {
    expect(canonicalCarrier('4U')).toBe('4U');
    expect(canonicalFlightNumber('4U 8888', '4U')).toBe(8888);
    expect(canonicalFlightNumber('4U8888')).toBe(8888);
    expect(itineraryHash(...trip('4U', '4U 8888'))).toBe(itineraryHash(...trip('4U', '8888')));
  });

  it('is pinned to a golden value so the input format cannot drift silently', () => {
    expect(itineraryHash(...trip('VS', '938'))).toBe(
      '3e3edd61cf5e74553b055c04f2e900d3dcc398977171e8ae25e19b8d754fe75c',
    );
    // Two segments each way pins the ';' separator inside a direction. Golden input:
    // OUT|VS:938:LGW:AAA:2027-03-14T10:05;VS:1:AAA:JFK:2027-03-14T15:00|IN|VS:2:JFK:BBB:2027-03-28T18:30;VS:3:BBB:LHR:2027-03-29T01:00
    const s = (flightNumber: number, from: string, to: string, departLocal: string): HashSegment => ({
      marketingCarrier: 'VS',
      flightNumber,
      from: from as Iata,
      to: to as Iata,
      departLocal,
    });
    expect(
      itineraryHash(
        [s(938, 'LGW', 'AAA', '2027-03-14T10:05'), s(1, 'AAA', 'JFK', '2027-03-14T15:00')],
        [s(2, 'JFK', 'BBB', '2027-03-28T18:30'), s(3, 'BBB', 'LHR', '2027-03-29T01:00')],
      ),
    ).toBe('c3cbf8809e84d4b8762f1bfd437a5f345b0effd5b2633ac3058ba48264ddecc3');
  });

  it.each(['VIR', 'C', 'C-', 'Virgin Atlantic', ''])(
    'unmappable carrier %j is a NormalisationError, never a guess',
    (c) => {
      expect(() => canonicalCarrier(c)).toThrow(NormalisationError);
      try {
        canonicalCarrier(c);
      } catch (e) {
        expect((e as NormalisationError).reason).toBe('unmappable-carrier');
      }
    },
  );

  it.each(['VS 938A', '0', '0000', '12345', 'VS', '', 'VS-938'])('flight number %j is rejected', (f) => {
    expect(() => canonicalFlightNumber(f)).toThrow(NormalisationError);
  });

  it('a numeric flight number gets the same canonical form and range check', () => {
    expect(canonicalFlightNumber(938, 'VS')).toBe(938);
    for (const n of [0, -938, 93.8, 10_000])
      expect(() => canonicalFlightNumber(n)).toThrow(NormalisationError);
  });

  it('a designator prefix naming another airline is rejected, not re-labelled', () => {
    expect(() => canonicalFlightNumber('BA 938', 'VS')).toThrow(/does not belong to VS/);
  });

  it('a non-canonical departLocal (UTC instant, seconds) cannot be hashed', () => {
    const [out, back] = trip('VS', '938');
    expect(() =>
      itineraryHash([{ ...(out[0] as HashSegment), departLocal: '2027-03-14T10:05:00.000Z' }], back),
    ).toThrow(RangeError);
    expect(() =>
      itineraryHash([{ ...(out[0] as HashSegment), departLocal: '2027-03-14 10:05' }], back),
    ).toThrow(RangeError);
    expect(() =>
      itineraryHash([{ ...(out[0] as HashSegment), departLocal: 'x2027-03-14T10:05' }], back),
    ).toThrow('departLocal not canonical: x2027-03-14T10:05');
  });

  it('property: equal inputs give equal hashes; any change to a hashed field changes it', () => {
    const segArb = fc.record({
      marketingCarrier: fc.constantFrom('VS', '4U', 'BA', 'AA'),
      flightNumber: fc.integer({ min: 1, max: 9999 }),
      from: fc.constantFrom('LHR', 'LGW') as fc.Arbitrary<Iata>,
      to: fc.constantFrom('JFK', 'EWR') as fc.Arbitrary<Iata>,
      departLocal: fc.constantFrom('2027-03-14T10:05', '2027-03-14T22:40', '2027-10-31T01:30'),
    });
    fc.assert(
      fc.property(
        fc.array(segArb, { minLength: 1, maxLength: 3 }),
        fc.array(segArb, { minLength: 1, maxLength: 3 }),
        (out, back) => {
          expect(itineraryHash(out, back)).toBe(itineraryHash(structuredClone(out), structuredClone(back)));
          const changed = [
            { ...(out[0] as HashSegment), flightNumber: ((out[0] as HashSegment).flightNumber % 9999) + 1 },
            ...out.slice(1),
          ];
          expect(itineraryHash(changed, back)).not.toBe(itineraryHash(out, back));
          // why: swapping directions must change identity (OUT/IN are tagged).
          expect(itineraryHash(back, out) === itineraryHash(out, back)).toBe(
            JSON.stringify(out) === JSON.stringify(back),
          );
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/hashing.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/normalise/carrier.js' imported from …/test/normalise/hashing.test.ts`.

- [ ] **Step 3: Implement**

`packages/core/src/normalise/carrier.ts`:

```ts
import { NormalisationError } from '../errors.js';

// why: IATA designators are two alphanumeric characters (spec §6.4, e.g. `4U`). Three-letter
// ICAO codes or airline names are not mapped: an unmappable carrier is an error, never a guess.
const CARRIER_RE = /^[A-Z0-9]{2}$/;

// why: a designator prefix inside a flight-number string must contain at least one letter,
// otherwise "0938" would read as carrier "09" + flight 38.
const FLIGHT_RE = /^(?:([A-Z][A-Z0-9]|[0-9][A-Z])\s*)?(\d{1,4})$/;

/**
 * Canonical marketing or operating carrier: trimmed, upper-case, exactly `^[A-Z0-9]{2}$`.
 * Spec §6.4. Throws `NormalisationError('unmappable-carrier')` for anything else.
 */
export function canonicalCarrier(s: string): string {
  const c = s.trim().toUpperCase();
  if (!CARRIER_RE.test(c)) throw new NormalisationError('unmappable-carrier', `carrier ${JSON.stringify(s)}`);
  return c;
}

/**
 * Canonical flight number: an integer 1–9999 without leading zeros. Spec §6.4.
 * Accepts `938`, `0938`, `VS938`, `VS 938`, or a number; when `carrier` is given, a designator prefix in
 * the string must equal it (a vendor string naming another airline is not silently re-labelled).
 * Throws `NormalisationError('unmappable-carrier')` for anything else (suffix letters, 0, >4 digits).
 */
export function canonicalFlightNumber(s: string | number, carrier?: string): number {
  // why: some vendors send the number as JSON number; it gets the same range check as a string.
  const text = typeof s === 'number' ? (Number.isInteger(s) && s >= 0 ? String(s) : 'x') : s;
  const m = FLIGHT_RE.exec(text.trim().toUpperCase());
  const prefix = m?.[1];
  const digits = m?.[2];
  if (digits === undefined)
    throw new NormalisationError('unmappable-carrier', `flight number ${JSON.stringify(s)}`);
  if (prefix !== undefined && carrier !== undefined && prefix !== carrier) {
    throw new NormalisationError(
      'unmappable-carrier',
      `flight number ${JSON.stringify(s)} does not belong to ${carrier}`,
    );
  }
  const n = Number(digits);
  if (n === 0) throw new NormalisationError('unmappable-carrier', `flight number ${JSON.stringify(s)}`);
  return n;
}
```

`packages/core/src/normalise/hashing.ts`:

```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Segment } from '../types/itinerary.js';

/** The hashed fields of a segment, already canonical (spec §6.4). */
export type HashSegment = Pick<Segment, 'marketingCarrier' | 'flightNumber' | 'from' | 'to' | 'departLocal'>;

const LOCAL_MINUTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function seg(s: HashSegment): string {
  // why: guard the canonical form here too, so a caller that skipped normaliseOffer cannot hash
  // a UTC instant or a seconds-bearing string (spec §6.4: "UTC is never hashed").
  if (!LOCAL_MINUTE_RE.test(s.departLocal))
    throw new RangeError(`departLocal not canonical: ${s.departLocal}`);
  return `${s.marketingCarrier}:${s.flightNumber}:${s.from}:${s.to}:${s.departLocal}`;
}

/**
 * Itinerary identity. Spec §6.4: sha256 (lower-case hex) over
 * `'OUT|' + segs(outbound) + '|IN|' + segs(inbound)`, segments joined by `;`, each
 * `${carrier}:${flightNumber}:${from}:${to}:${departLocal}`. Codeshares hash on the marketing
 * carrier. Price, cabin, provider, seller and tokens are not inputs, so they cannot change it.
 */
export function itineraryHash(outbound: readonly HashSegment[], inbound: readonly HashSegment[]): string {
  const text = `OUT|${outbound.map(seg).join(';')}|IN|${inbound.map(seg).join(';')}`;
  return bytesToHex(sha256(utf8ToBytes(text)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/hashing.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 20 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: carrier canonicalisation and itinerary hash (spec §6.4)"
```

### Task 2.2: Local wall time with DST rules, and vendor timestamps

**Files:**
- Create: `packages/core/src/normalise/localTime.ts`, `packages/core/src/normalise/timestamps.ts`
- Test: `packages/core/test/normalise/localTime.test.ts`

**Interfaces:**
- Consumes: `NormalisationError`, `isRealDate`, `IsoDateTime`, `TZDate` and `tzOffset` (`@date-fns/tz`)
- Produces: `TimeKind`, `departLocal`, `toIsoDateTime`; module-internal `parseVendorTime`, `requireZone`, `wallToInstant`, `localMinute`, `vendorInstant` (not in the barrel)

The DST cases use the 2027 changes: UK/EU 28 Mar 2027 at 01:00 GMT (gap 01:00–02:00) and 31 Oct 2027 at 02:00 BST (overlap 01:00–02:00), and US 14 Mar and 7 Nov 2027. A nonexistent wall time is read with the offset in force before the gap, which shifts it forward by the gap. An ambiguous one takes the earlier instant. `tz` is a non-null string, per the plan. An unknown zone string (including `''`) is `unknown-airport-tz`, and a null from the airports table is turned into the same error by `normaliseOffer` (Task 2.5).

- [ ] **Step 1: Write the failing test**

`packages/core/test/normalise/localTime.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { departLocal, localMinute, parseVendorTime, wallToInstant } from '../../src/normalise/localTime.js';
import { toIsoDateTime } from '../../src/normalise/timestamps.js';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof NormalisationError) return e.reason;
    throw e;
  }
  return 'no error';
}

describe('departLocal input forms (spec §6.4 matrix)', () => {
  it('T and space separators give the same wall time; seconds are dropped', () => {
    expect(departLocal('2027-03-14T10:05', 'local', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14 10:05', 'local', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14T10:05:59', 'local', LONDON)).toBe('2027-03-14T10:05');
  });

  it('UTC, local and offset inputs for the same instant agree', () => {
    // LHR in winter: GMT, so UTC and wall time coincide.
    expect(departLocal('2027-03-14T10:05:00Z', 'utc', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14 10:05:00', 'utc', LONDON)).toBe('2027-03-14T10:05');
    expect(departLocal('2027-03-14T10:05:00+00:00', 'offset', LONDON)).toBe('2027-03-14T10:05');
    // JFK in summer: EDT, UTC−4.
    expect(departLocal('2027-06-01T14:00:00.000Z', 'utc', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(departLocal('2027-06-01T10:00:00-04:00', 'offset', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(departLocal('2027-06-01T10:00-0400', 'offset', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(departLocal('2027-06-01T10:00', 'local', NEW_YORK)).toBe('2027-06-01T10:00');
    expect(toIsoDateTime('2027-06-01T10:00', 'local', NEW_YORK)).toBe('2027-06-01T14:00:00.000Z');
    expect(toIsoDateTime('2027-06-01T15:30:00+05:30', 'offset', 'UTC')).toBe('2027-06-01T10:00:00.000Z');
  });

  it('an unknown zone is NormalisationError(unknown-airport-tz) for every time kind; UTC is never hashed', () => {
    expect(reasonOf(() => departLocal('2027-03-14T10:05:00Z', 'utc', 'Mars/Olympus_Mons'))).toBe(
      'unknown-airport-tz',
    );
    expect(reasonOf(() => departLocal('2027-03-14T10:05', 'local', ''))).toBe('unknown-airport-tz');
    expect(reasonOf(() => departLocal('2027-03-14T10:05:00+00:00', 'offset', 'Mars/Olympus_Mons'))).toBe(
      'unknown-airport-tz',
    );
    expect(reasonOf(() => toIsoDateTime('2027-03-14T10:05', 'local', ''))).toBe('unknown-airport-tz');
  });
});

describe('DST rules (spec §5.6), UK/EU and US changes in 2027', () => {
  it('a nonexistent wall time shifts forward by the gap (London, 28 Mar 2027 01:00 → 02:00)', () => {
    expect(departLocal('2027-03-28T01:30', 'local', LONDON)).toBe('2027-03-28T02:30');
    expect(toIsoDateTime('2027-03-28T01:30', 'local', LONDON)).toBe('2027-03-28T01:30:00.000Z');
    expect(toIsoDateTime('2027-03-28T00:59', 'local', LONDON)).toBe('2027-03-28T00:59:00.000Z');
    expect(toIsoDateTime('2027-03-28T02:00', 'local', LONDON)).toBe('2027-03-28T01:00:00.000Z');
  });

  it('an ambiguous wall time takes the first occurrence (London, 31 Oct 2027 02:00 BST → 01:00 GMT)', () => {
    expect(departLocal('2027-10-31T01:30', 'local', LONDON)).toBe('2027-10-31T01:30');
    expect(toIsoDateTime('2027-10-31T01:30', 'local', LONDON)).toBe('2027-10-31T00:30:00.000Z');
    expect(toIsoDateTime('2027-10-31T00:59', 'local', LONDON)).toBe('2027-10-30T23:59:00.000Z');
    expect(toIsoDateTime('2027-10-31T02:00', 'local', LONDON)).toBe('2027-10-31T02:00:00.000Z');
    // UTC input on either side of the overlap reads back as the same wall time.
    expect(departLocal('2027-10-31T00:30:00Z', 'utc', LONDON)).toBe('2027-10-31T01:30');
    expect(departLocal('2027-10-31T01:30:00Z', 'utc', LONDON)).toBe('2027-10-31T01:30');
  });

  it('the same rules hold in New York (14 Mar and 7 Nov 2027)', () => {
    expect(departLocal('2027-03-14T02:30', 'local', NEW_YORK)).toBe('2027-03-14T03:30');
    expect(toIsoDateTime('2027-03-14T02:30', 'local', NEW_YORK)).toBe('2027-03-14T07:30:00.000Z');
    expect(toIsoDateTime('2027-11-07T01:30', 'local', NEW_YORK)).toBe('2027-11-07T05:30:00.000Z');
  });

  it('property: reading an instant as wall time and back loses nothing except the second occurrence of an overlap', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2028, 11, 31);
    fc.assert(
      fc.property(
        fc.integer({ min: from / 60_000, max: to / 60_000 }),
        fc.constantFrom(LONDON, NEW_YORK),
        (minute, tz) => {
          const instant = minute * 60_000;
          const p = parseVendorTime(localMinute(instant, tz));
          const back = wallToInstant(p, tz);
          expect([0, 3_600_000]).toContain(instant - back);
        },
      ),
    );
  });
});

describe('timestamp format rejection (spec §6.3)', () => {
  it.each([
    ['14/03/2027 10:05', 'local'],
    ['2027-03-14', 'local'],
    ['1710410700', 'utc'],
    ['2027-02-29T10:00', 'local'],
    ['2027-03-14T24:00', 'local'],
    ['2027-03-14T10:60', 'local'],
    ['2027-03-14T10:05:60', 'local'],
    ['2027-03-14T10:05Z', 'local'], // local with a suffix
    ['2027-03-14T10:05+01:00', 'utc'], // utc with an offset
    ['2027-03-14T10:05', 'offset'], // offset without one
  ] as const)('%s as %s is bad-local-time', (value, kind) => {
    expect(reasonOf(() => toIsoDateTime(value, kind, LONDON))).toBe('bad-local-time');
  });

  it('keeps milliseconds and always emits the toISOString form', () => {
    expect(toIsoDateTime('2027-06-01T14:00:00.5Z', 'utc', 'UTC')).toBe('2027-06-01T14:00:00.500Z');
    expect(toIsoDateTime('2027-06-01 14:00', 'utc', 'UTC')).toBe('2027-06-01T14:00:00.000Z');
  });

  it('property: any toISOString value round-trips', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2026-01-01T00:00:00Z'),
          max: new Date('2028-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        (d) => {
          expect(toIsoDateTime(d.toISOString(), 'utc', 'UTC')).toBe(d.toISOString());
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/localTime.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/normalise/localTime.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/normalise/localTime.ts`:

```ts
import { TZDate, tzOffset } from '@date-fns/tz';
import { NormalisationError } from '../errors.js';
import { isRealDate } from '../types/ids.js';

/** How a vendor states a segment time (spec §5.1 `RawSegment.timeKind`). */
export type TimeKind = 'local' | 'utc' | 'offset';

/** A vendor time string split into parts; `suffix` is `Z`, `±HH:MM`/`±HHMM`, or absent. */
export interface VendorTimeParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
  suffix: string | undefined;
}

// why: vendors use `T` or a space, may omit seconds, and may append Z or an offset. Anything
// else (day-first dates, 12-hour clocks, epoch numbers) is rejected rather than guessed.
const VENDOR_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Parse and range-check a vendor time; `bad-local-time` on any other shape. */
export function parseVendorTime(value: string): VendorTimeParts {
  const m = VENDOR_RE.exec(value.trim());
  if (m === null)
    throw new NormalisationError('bad-local-time', `unrecognised time ${JSON.stringify(value)}`);
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (!isRealDate(y, mo, d) || h > 23 || mi > 59 || s > 59) {
    throw new NormalisationError('bad-local-time', `out-of-range time ${JSON.stringify(value)}`);
  }
  return { y, mo, d, h, mi, s, ms, suffix: m[8] };
}

/** Throws `unknown-airport-tz` unless `tz` is a non-null zone the runtime knows. Spec §5.6. */
export function requireZone(tz: string | null): string {
  // why: TZDate and tzOffset never throw on a bad zone; they return NaN (verified 2026-10-14).
  if (tz === null || Number.isNaN(tzOffset(tz, new Date(0)))) {
    throw new NormalisationError('unknown-airport-tz', `time zone ${JSON.stringify(tz)}`);
  }
  return tz;
}

/**
 * The UTC instant (epoch ms) of a wall-clock time in `tz`, with the spec §5.6 DST rules:
 * a nonexistent wall time (spring-forward gap) shifts forward by the gap; an ambiguous one
 * (fall-back overlap) takes the first occurrence.
 *
 * why: `new TZDate(y, m, d, h, mi, tz)` resolves wall components through the *system* zone and
 * has no disambiguation option (context7 /date-fns/tz, src/date/mini.js), so it would make the
 * result depend on the host's TZ. We compute both candidate offsets with `tzOffset` instead.
 */
export function wallToInstant(p: Omit<VendorTimeParts, 'suffix'>, tz: string): number {
  const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms);
  const before = tzOffset(tz, new Date(wall - 24 * HOUR_MS));
  const after = tzOffset(tz, new Date(wall + 24 * HOUR_MS));
  const candidates = [wall - before * MINUTE_MS, wall - after * MINUTE_MS].sort((a, b) => a - b);
  const valid = candidates.filter((c) => tzOffset(tz, new Date(c)) * MINUTE_MS === wall - c);
  // why: no valid candidate means the wall time sits in a gap; reading it with the offset in
  // force before the gap lands after the gap, i.e. shifted forward by the gap length.
  return valid[0] ?? wall - before * MINUTE_MS;
}

/** `YYYY-MM-DDTHH:mm` wall-clock reading of an instant in `tz`. */
export function localMinute(instantMs: number, tz: string): string {
  const t = new TZDate(instantMs, tz);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function suffixOffsetMinutes(suffix: string): number {
  if (suffix === 'Z') return 0;
  const sign = suffix.startsWith('-') ? -1 : 1;
  const digits = suffix.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/**
 * Epoch ms of a vendor time. `utc` accepts a `Z` suffix or none; `offset` needs `Z` or `±HH:MM`;
 * `local` must carry no suffix and needs the airport's zone. A suffix that contradicts
 * `timeKind` is `bad-local-time`, never reinterpreted.
 */
export function vendorInstant(value: string, timeKind: TimeKind, tz: string | null): number {
  const p = parseVendorTime(value);
  if (timeKind === 'local') {
    if (p.suffix !== undefined)
      throw new NormalisationError('bad-local-time', `local time with suffix ${JSON.stringify(value)}`);
    return wallToInstant(p, requireZone(tz));
  }
  if (timeKind === 'utc' && p.suffix !== undefined && p.suffix !== 'Z') {
    throw new NormalisationError('bad-local-time', `utc time with offset ${JSON.stringify(value)}`);
  }
  if (timeKind === 'offset' && p.suffix === undefined) {
    throw new NormalisationError('bad-local-time', `offset time without offset ${JSON.stringify(value)}`);
  }
  const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms);
  return wall - suffixOffsetMinutes(p.suffix ?? 'Z') * MINUTE_MS;
}

/**
 * Departure (or arrival) wall time at the airport, exactly `YYYY-MM-DDTHH:mm`. Spec §5.6, §6.4.
 * UTC and offset inputs are converted into `tz`; local inputs are re-read through `tz` so a
 * nonexistent wall time comes out shifted forward. A zone the runtime does not know is
 * `unknown-airport-tz` for every time kind: UTC is never hashed. (An airport missing from the
 * table is caught one step earlier, in `normaliseOffer`, when `tzOf` returns null.)
 */
export function departLocal(value: string, timeKind: TimeKind, tz: string): string {
  const zone = requireZone(tz);
  return localMinute(vendorInstant(value, timeKind, zone), zone);
}
```

`packages/core/src/normalise/timestamps.ts`:

```ts
import type { IsoDateTime } from '../types/ids.js';
import { type TimeKind, vendorInstant } from './localTime.js';

/**
 * A vendor time as the one stored timestamp form, `Date#toISOString()` (spec §6.3:
 * "vendor times normalised to it in `core`"). Same accepted shapes and DST rules as
 * `departLocal`; `tz` is read only for `local` input (pass the airport's zone regardless).
 */
export function toIsoDateTime(value: string, timeKind: TimeKind, tz: string): IsoDateTime {
  return new Date(vendorInstant(value, timeKind, tz)).toISOString() as IsoDateTime;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/localTime.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 19 tests (also run with `TZ=Asia/Tokyo` and `TZ=America/Los_Angeles` prefixed: same result); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: departLocal and vendor timestamps with DST rules (spec §5.6, §6.3)"
```

### Task 2.3: Money: `toGbp`, exponents and the ECB list

**Files:**
- Create: `packages/core/src/normalise/money.ts`
- Test: `packages/core/test/normalise/money.test.ts`

**Interfaces:**
- Consumes: `NormalisationError`
- Produces: `ECB_CURRENCIES`, `MINOR_EXPONENT`, `toGbp`

Reference values. `rateNano` is GBP per **one native unit** × 1e9, and pence = minor ÷ 10^exponent × rateNano ÷ 1e9 × 100, rounded half-up:

| Input | Rate | Exact pence | Expected |
|---|---|---|---|
| CNY 412 345 minor (¥4,123.45, exponent 2) | 104 300 000 (£0.1043) | 43 007.5835 | **43 008** |
| JPY 82 000 minor (¥82,000, exponent 0) | 5 020 000 (£0.00502) | 41 164 | **41 164** |
| CNY 10 000 minor (¥100.00): direction check | 104 300 000 | 1 043 | **1 043** (not ¥100 ÷ 0.1043) |
| JPY 1 | 5 000 000 | 0.5 | **1** (half up) |
| JPY 1 | 4 999 999 | 0.4999999 | **0** |
| JPY 3 | 5 000 000 | 1.5 | **2** |
| CNY 1 minor (¥0.01) | 500 000 000 | 0.5 | **1** |
| USD 0 | 790 000 000 | 0 | **0** |
| USD 100 000 000 000 minor ($1bn) | 790 000 000 | 79 000 000 000 | **79 000 000 000** |
| USD `Number.MAX_SAFE_INTEGER` | 2 000 000 000 | > 2^53 | **RangeError** |


- [ ] **Step 1: Write the failing test**

`packages/core/test/normalise/money.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { ECB_CURRENCIES, MINOR_EXPONENT, toGbp } from '../../src/normalise/money.js';

describe('toGbp (spec §6.3): rateNano = GBP per 1 native unit × 1e9, half-up to the penny', () => {
  it('CNY reference: ¥4,123.45 (412345 minor, exponent 2) at 1 CNY = £0.1043 (rateNano 104_300_000) → 43008p', () => {
    // 4123.45 × 0.1043 = £430.075835 → 43007.5835p → half-up → 43008p
    expect(toGbp(412_345, 'CNY', 104_300_000)).toBe(43_008);
  });

  it('JPY reference: ¥82,000 (82000 minor, exponent 0) at 1 JPY = £0.00502 (rateNano 5_020_000) → 41164p exactly', () => {
    expect(toGbp(82_000, 'JPY', 5_020_000)).toBe(41_164);
  });

  it('direction: ¥100.00 CNY at £0.1043 is £10.43, not ¥100 ÷ 0.1043', () => {
    expect(toGbp(10_000, 'CNY', 104_300_000)).toBe(1_043);
  });

  it('rounds exactly half up and anything below half down', () => {
    expect(toGbp(1, 'JPY', 5_000_000)).toBe(1); // 0.5p
    expect(toGbp(1, 'JPY', 4_999_999)).toBe(0); // 0.4999999p
    expect(toGbp(1, 'CNY', 500_000_000)).toBe(1); // 0.01 CNY × £0.50 = 0.5p
    expect(toGbp(3, 'JPY', 5_000_000)).toBe(2); // 1.5p
  });

  it('zero is zero', () => {
    expect(toGbp(0, 'USD', 790_000_000)).toBe(0);
  });

  it('large amounts stay exact: $1,000,000,000.00 at £0.79 is 79_000_000_000p', () => {
    expect(toGbp(100_000_000_000, 'USD', 790_000_000)).toBe(79_000_000_000);
  });

  it('a result beyond Number.MAX_SAFE_INTEGER throws instead of losing pence', () => {
    expect(() => toGbp(Number.MAX_SAFE_INTEGER, 'USD', 2_000_000_000)).toThrow(RangeError);
  });

  it('GBP is the identity and ignores the rate', () => {
    expect(toGbp(41_200, 'GBP', 1)).toBe(41_200);
  });

  it.each([412.5, Number.NaN, -1, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects non-integer or negative amount %s',
    (a) => {
      expect(() => toGbp(a, 'EUR', 860_000_000)).toThrow(RangeError);
      expect(() => toGbp(a, 'GBP', 1)).toThrow(RangeError);
    },
  );

  it.each([1.5, 0, -860_000_000])('rejects rate %s', (r) => {
    expect(() => toGbp(100, 'EUR', r)).toThrow(RangeError);
  });

  it('a currency without an exponent is currency-unsupported', () => {
    expect(() => toGbp(100, 'XAU', 1)).toThrow(NormalisationError);
  });

  it('ECB list and exponents (frankfurter 2026-10-14)', () => {
    const list =
      'AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR';
    expect(ECB_CURRENCIES).toEqual(list.split(' '));
    expect(ECB_CURRENCIES).not.toContain('BGN');
    expect(MINOR_EXPONENT).toEqual(
      Object.fromEntries(list.split(' ').map((c) => [c, ['ISK', 'JPY', 'KRW'].includes(c) ? 0 : 2])),
    );
  });

  it('property: within half a penny of the exact value and monotone in the amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 2_000_000_000 }),
        (a, r) => {
          const p = toGbp(a, 'EUR', r);
          const exact = (a * r) / 1e9; // EUR exponent 2: minor × rate / 1e9 is pence
          expect(Math.abs(p - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(toGbp(a + 1, 'EUR', r)).toBeGreaterThanOrEqual(p);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/money.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/normalise/money.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/normalise/money.ts`:

```ts
import { NormalisationError } from '../errors.js';

/**
 * The currencies frankfurter (ECB reference rates) publishes, read from
 * https://api.frankfurter.dev/v1/currencies on 2026-10-14. Spec §5.6: "ECB-covered currencies
 * only". A currency outside this list is `currency-unsupported`, never converted by a guess.
 */
export const ECB_CURRENCIES: readonly string[] = [
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
];

/**
 * ISO 4217 minor-unit exponent for every ECB currency (spec §6.3: "Native amounts are integer
 * minor units with the ISO 4217 exponent"). ISK, JPY and KRW have no minor unit.
 */
export const MINOR_EXPONENT: Record<string, number> = Object.fromEntries(
  ECB_CURRENCIES.map((c) => [c, c === 'ISK' || c === 'JPY' || c === 'KRW' ? 0 : 2]),
);

const NANO = 1_000_000_000n;

/**
 * Native minor units → integer pence. Spec §6.3.
 * `rateNano` is GBP per **one native unit** × 1e9 (the direction is fixed: a rate of
 * 104_300_000 means 1 CNY = £0.1043). Exact integer arithmetic in BigInt, rounded half-up to
 * the penny; no float ever holds the amount.
 * `GBP` is the identity and ignores `rateNano`.
 * Throws `RangeError` on a non-integer or negative amount, a non-integer or non-positive rate, or
 * a result beyond `Number.MAX_SAFE_INTEGER`; `NormalisationError('currency-unsupported')` on a
 * currency without a known exponent.
 */
export function toGbp(amountMinor: number, currency: string, rateNano: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new RangeError(`amountMinor must be a non-negative integer: ${amountMinor}`);
  if (currency === 'GBP') return amountMinor;
  const exponent = MINOR_EXPONENT[currency];
  if (exponent === undefined) throw new NormalisationError('currency-unsupported', currency);
  if (!Number.isSafeInteger(rateNano) || rateNano <= 0)
    throw new RangeError(`rateNano must be a positive integer: ${rateNano}`);
  // pence = amountMinor / 10^exp × rateNano / 1e9 × 100
  const numerator = BigInt(amountMinor) * BigInt(rateNano) * 100n;
  const denominator = NANO * 10n ** BigInt(exponent);
  // why: half-up for non-negative values is floor((2n + d) / 2d).
  const pence = (2n * numerator + denominator) / (2n * denominator);
  if (pence > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`converted amount too large: ${pence}`);
  return Number(pence);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/money.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 19 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: toGbp with half-up rounding and the ECB currency list (spec §6.3)"
```

### Task 2.4: Vendor URL validation and the link allowlist

**Files:**
- Create: `packages/core/src/normalise/vendorUrl.ts`
- Test: `packages/core/test/normalise/vendorUrl.test.ts`

**Interfaces:**
- Consumes: `ProviderId`, `Booking`
- Produces: `LINK_ALLOWLIST`, `validateVendorUrl`

- [ ] **Step 1: Write the failing test**

`packages/core/test/normalise/vendorUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LINK_ALLOWLIST, validateVendorUrl } from '../../src/normalise/vendorUrl.js';

describe('validateVendorUrl (spec §5.2 "Vendor links")', () => {
  it.each([
    ['https://www.google.com/travel/flights/booking?tfs=abc', 'www.google.com'],
    ['https://google.com/x', 'google.com'],
    ['https://WWW.GOOGLE.COM/x', 'www.google.com'],
  ])('accepts %s for SearchApi', (url, host) => {
    expect(validateVendorUrl(url, LINK_ALLOWLIST.searchapi)).toEqual({
      kind: 'get',
      url: new URL(url).href,
      host,
    });
  });

  it('accepts a subdomain of aviasales.com for Travelpayouts', () => {
    expect(
      validateVendorUrl(
        'https://search.aviasales.com/flights/?origin_iata=LHR',
        LINK_ALLOWLIST.travelpayouts,
      ),
    ).toMatchObject({ kind: 'get', host: 'search.aviasales.com' });
  });

  it.each([
    'http://www.google.com/travel', // not https
    'https://user:pw@www.google.com/x', // userinfo
    'https://user@www.google.com/x', // username only
    'https://google.com.evil.example/x', // allowlist entry as a prefix
    'https://evilgoogle.com/x', // suffix without the dot
    'https://www.aviasales.com/x', // another provider's host
    'https://www.british-airways.example/x', // a seller host is never linked
    'javascript:alert(1)',
    'not a url',
    '',
  ])('rejects %j → none', (url) => {
    expect(validateVendorUrl(url, LINK_ALLOWLIST.searchapi)).toEqual({ kind: 'none' });
  });

  it('the fixture provider has an empty allowlist, so nothing it supplies is linked', () => {
    expect(validateVendorUrl('https://www.google.com/x', LINK_ALLOWLIST.fixture)).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/vendorUrl.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/normalise/vendorUrl.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/normalise/vendorUrl.ts`:

```ts
import type { Booking } from '../types/itinerary.js';
import type { ProviderId } from '../types/provenance.js';

/**
 * Per-provider link allowlist. Spec §5.2 "Vendor links": `aviasales.com` for Travelpayouts,
 * `google.com` for SearchApi (its step-3 `booking_request` always targets Google). The fixture
 * provider gets none: synthetic rows never carry a followable link.
 */
export const LINK_ALLOWLIST: Record<ProviderId, string[]> = {
  travelpayouts: ['aviasales.com'],
  searchapi: ['google.com'],
  fixture: [],
};

/**
 * Validate a provider-supplied URL before it is stored or rendered. Spec §5.2: `https:` only,
 * no userinfo, host equal to or a subdomain of an allowlist entry; anything else (including an
 * unparseable string) is `{ kind: 'none' }`. Seller or airline hosts are never linked.
 * Returns a `get` booking carrying the parsed host so the UI can show it.
 */
export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'none' };
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return { kind: 'none' };
  // why: WHATWG URL lower-cases and IDNA-encodes the hostname, so `WWW.GOOGLE.COM` matches and
  // `google.com.evil.example` or `evilgoogle.com` do not (suffix match needs the leading dot).
  const host = u.hostname;
  const allowed = allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
  return allowed ? { kind: 'get', url: u.href, host } : { kind: 'none' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/vendorUrl.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 15 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: vendor URL validation against the provider allowlist (spec §5.2)"
```

### Task 2.5: `normaliseOffer`: the pure §5.6 step for one raw offer

**Files:**
- Create: `packages/core/src/normalise/itinerary.ts`
- Test: `packages/core/test/helpers/offers.ts`, `packages/core/test/normalise/itinerary.test.ts`

**Interfaces:**
- Consumes: Tasks 2.1–2.4; `RawOffer`, `RawSegment`, `NormalisedItinerary`, `Segment`, `Layover`, `ObservationFields`, `Offer`, `Booking`, `FxInfo`, `Cabin`, `ProviderId`, `CellKey`, `cellKeyString`
- Produces: `NormaliseDeps`, `NormaliseResult` (the plan's inline result union, named), `normaliseOffer(raw, cell, deps)`

`AAA` and `BBB` are clearly synthetic connection airports (README rule), zoned `Atlantic/Reykjavik` (UTC+0, no DST) so that layover arithmetic is easy to read. `ZZZ` is the unknown airport. A layover is overnight when the connection interval overlaps 00:00–05:00 local at the connecting airport on any date it touches. `normaliseOffer` *returns* `{ ok: false, error }` for every `NormalisationError` so that WP7 can count `offers-dropped:n`. Any other error is a caller bug and is thrown. The cell guard compares the offer's origin, final destination and local departure and return dates with `cell` through `cellKeyString`. A mismatch is `cell-mismatch` (plan round-2 pin). The helper `cellOf(raw)` reads the cell from the raw strings, and the guard tests pass a different cell explicitly.

- [ ] **Step 1: Write the failing test**

`packages/core/test/helpers/offers.ts`:

```ts
import type { NormaliseDeps } from '../../src/normalise/itinerary.js';
import type { RawOffer, RawSegment } from '../../src/ports/provider.js';
import type { CellKey } from '../../src/types/definition.js';
import type { Iata, IsoDate } from '../../src/types/ids.js';

/** Worked-example zones plus two clearly synthetic connection airports (AAA, BBB). */
const ZONES: Record<string, string> = {
  LHR: 'Europe/London',
  LGW: 'Europe/London',
  JFK: 'America/New_York',
  EWR: 'America/New_York',
  AAA: 'Atlantic/Reykjavik',
  BBB: 'Atlantic/Reykjavik',
};

export const iata = (s: string): Iata => s as Iata;

export function deps(over: Partial<NormaliseDeps> = {}): NormaliseDeps {
  return {
    providerId: 'searchapi',
    tzOf: (a) => ZONES[a] ?? null,
    rateFor: (c) =>
      c === 'CNY'
        ? { rateNano: 104_300_000, rateDate: '2027-03-01' as IsoDate, source: 'frankfurter' }
        : null,
    cabin: 'economy',
    ...over,
  };
}

export function seg(
  over: Partial<RawSegment> & Pick<RawSegment, 'from' | 'to' | 'depart' | 'arrive'>,
): RawSegment {
  return { marketingCarrier: 'VS', flightNumber: '938', timeKind: 'local', ...over };
}

/** LHR→JFK 14 Mar 2027 10:05–13:05 local, JFK→LHR 28 Mar 2027 18:30 → 29 Mar 06:40 local; £412 at one seller. */
export function offer(over: Partial<RawOffer> = {}): RawOffer {
  return {
    outbound: [
      seg({ from: iata('LHR'), to: iata('JFK'), depart: '2027-03-14T10:05', arrive: '2027-03-14T13:05' }),
    ],
    inbound: [
      seg({
        flightNumber: '939',
        from: iata('JFK'),
        to: iata('LHR'),
        depart: '2027-03-28T18:30',
        arrive: '2027-03-29T06:40',
      }),
    ],
    seller: 'Virgin Atlantic',
    requestedCabin: 'economy',
    amountMinor: 41_200,
    currency: 'GBP',
    booking: { kind: 'none' },
    ...over,
  };
}

/**
 * The cell a raw offer was returned for, read from its first and last segments as written. Tests
 * that check the cell guard pass a different cell explicitly; local and UTC inputs used here fall
 * on the same calendar day in both zones.
 */
export function cellOf(raw: RawOffer): CellKey {
  const first = raw.outbound[0];
  const last = raw.outbound[raw.outbound.length - 1];
  const back = raw.inbound[0];
  return {
    origin: first?.from ?? iata('LHR'),
    destination: last?.to ?? iata('JFK'),
    departureDate: (first?.depart.slice(0, 10) ?? '2027-03-14') as IsoDate,
    returnDate: (back?.depart.slice(0, 10) ?? '2027-03-28') as IsoDate,
  };
}
```

`packages/core/test/normalise/itinerary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { type NormaliseResult, normaliseOffer } from '../../src/normalise/itinerary.js';
import type { RawOffer } from '../../src/ports/provider.js';
import type { CellKey } from '../../src/types/definition.js';
import { cellOf, deps, iata, offer, seg } from '../helpers/offers.js';

function ok(raw: RawOffer, d = deps(), cell: CellKey = cellOf(raw)): Extract<NormaliseResult, { ok: true }> {
  const r = normaliseOffer(raw, cell, d);
  if (!r.ok) throw new Error(`unexpected ${r.error.reason}: ${r.error.message}`);
  return r;
}
function reason(raw: RawOffer, d = deps(), cell: CellKey = cellOf(raw)): string {
  const r = normaliseOffer(raw, cell, d);
  if (r.ok) return 'normalised';
  expect(r.error).toBeInstanceOf(NormalisationError);
  return r.error.reason;
}

describe('normaliseOffer: identity (spec §6.4 matrix through the full step)', () => {
  const base = ok(offer()).itinerary.hash;

  it('VS 938 / VS938 / 0938 give one itinerary', () => {
    for (const f of ['VS 938', 'VS938', '0938']) {
      const raw = offer();
      raw.outbound = [
        seg({
          flightNumber: f,
          from: iata('LHR'),
          to: iata('JFK'),
          depart: '2027-03-14T10:05',
          arrive: '2027-03-14T13:05',
        }),
      ];
      expect(ok(raw).itinerary.hash).toBe(base);
    }
  });

  it('UTC, local and offset inputs for the same flights give one itinerary', () => {
    const utc = offer({
      outbound: [
        seg({
          timeKind: 'utc',
          from: iata('LHR'),
          to: iata('JFK'),
          depart: '2027-03-14T10:05:00Z',
          arrive: '2027-03-14T17:05:00Z',
        }),
      ],
      inbound: [
        seg({
          timeKind: 'utc',
          flightNumber: '939',
          from: iata('JFK'),
          to: iata('LHR'),
          depart: '2027-03-28T22:30:00Z',
          arrive: '2027-03-29T05:40:00Z',
        }),
      ],
    });
    const offset = offer({
      outbound: [
        seg({
          timeKind: 'offset',
          from: iata('LHR'),
          to: iata('JFK'),
          depart: '2027-03-14T10:05:00+00:00',
          arrive: '2027-03-14T13:05:00-04:00',
        }),
      ],
      inbound: [
        seg({
          timeKind: 'offset',
          flightNumber: '939',
          from: iata('JFK'),
          to: iata('LHR'),
          depart: '2027-03-28T18:30:00-04:00',
          arrive: '2027-03-29T06:40:00+01:00',
        }),
      ],
    });
    expect(ok(utc).itinerary.hash).toBe(base);
    expect(ok(offset).itinerary.hash).toBe(base);
    expect(ok(utc).itinerary.outbound[0]).toMatchObject({
      departLocal: '2027-03-14T10:05',
      arriveLocal: '2027-03-14T13:05',
      departUtc: '2027-03-14T10:05:00.000Z',
    });
  });

  it('price, cabin, seller, provider, booking and currency do not change identity', () => {
    const other = offer({
      seller: 'Some OTA',
      amountMinor: 999_999,
      currency: 'CNY',
      requestedCabin: 'business',
      booking: { kind: 'get', url: 'https://www.google.com/x' },
    });
    expect(ok(other, deps({ providerId: 'searchapi', cabin: 'business' })).itinerary.hash).toBe(base);
  });

  it('unknown airport tz is returned as unknown-airport-tz, never hashed on UTC', () => {
    const raw = offer();
    raw.outbound = [
      seg({
        timeKind: 'utc',
        from: iata('LHR'),
        to: iata('ZZZ'),
        depart: '2027-03-14T10:05:00Z',
        arrive: '2027-03-14T17:05:00Z',
      }),
    ];
    expect(reason(raw)).toBe('unknown-airport-tz');
  });

  it('an unmappable marketing or operating carrier is returned as unmappable-carrier', () => {
    const raw = offer();
    raw.outbound = [
      seg({
        marketingCarrier: 'VIR',
        from: iata('LHR'),
        to: iata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(reason(raw)).toBe('unmappable-carrier');
    const op = offer();
    op.outbound = [
      seg({
        operatingCarrier: 'Virgin Atlantic',
        from: iata('LHR'),
        to: iata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(reason(op)).toBe('unmappable-carrier');
  });

  it('an offer that flies another cell than the one asked is dropped, never re-keyed', () => {
    const asked = cellOf(offer());
    expect(reason(offer(), deps(), { ...asked, returnDate: '2027-03-27' as never })).toBe('cell-mismatch');
    expect(reason(offer(), deps(), { ...asked, departureDate: '2027-03-13' as never })).toBe('cell-mismatch');
    expect(reason(offer(), deps(), { ...asked, origin: iata('LGW') })).toBe('cell-mismatch');
    expect(reason(offer(), deps(), { ...asked, destination: iata('EWR') })).toBe('cell-mismatch');
    const r = normaliseOffer(offer(), { ...asked, returnDate: '2027-03-27' as never }, deps());
    expect(r.ok ? '' : r.error.message).toBe(
      'cell-mismatch: offer flies LHR|JFK|2027-03-14|2027-03-28, cell is LHR|JFK|2027-03-14|2027-03-27',
    );
  });

  it('an airport missing from the airports table is unknown-airport-tz', () => {
    expect(reason(offer(), deps({ tzOf: (a) => (a === 'JFK' ? null : 'Europe/London') }))).toBe(
      'unknown-airport-tz',
    );
  });

  it('missing directions are no-return-legs; impossible times are bad-local-time', () => {
    expect(reason(offer({ inbound: [] }))).toBe('no-return-legs');
    expect(reason(offer({ outbound: [] }))).toBe('no-return-legs');
    expect(
      reason(
        offer({
          outbound: [
            seg({
              from: iata('LHR'),
              to: iata('JFK'),
              depart: '2027-03-14T10:05',
              arrive: '2027-03-14T05:00',
            }),
          ],
        }),
      ),
    ).toBe('bad-local-time');
    expect(
      reason(
        offer({
          outbound: [
            seg({
              from: iata('LGW'),
              to: iata('AAA'),
              depart: '2027-03-14T10:00',
              arrive: '2027-03-14T13:00',
            }),
            seg({
              flightNumber: '1',
              from: iata('AAA'),
              to: iata('JFK'),
              depart: '2027-03-14T12:00',
              arrive: '2027-03-14T15:00',
            }),
          ],
        }),
      ),
    ).toBe('bad-local-time');
  });

  it('a requested cabin that differs from the definition cabin is a caller bug and throws', () => {
    expect(() => normaliseOffer(offer({ requestedCabin: 'business' }), cellOf(offer()), deps())).toThrow(
      /differs from the definition cabin/,
    );
  });

  it('non-normalisation errors (a float amount) are thrown, not returned', () => {
    expect(() => normaliseOffer(offer({ amountMinor: 412.5 }), cellOf(offer()), deps())).toThrow(RangeError);
  });
});

describe('normaliseOffer: derived itinerary fields', () => {
  it('dates, nights, stops, minutes, carriers', () => {
    const it0 = ok(offer()).itinerary;
    expect(it0).toMatchObject({
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2027-03-14',
      returnDate: '2027-03-28',
      nights: 14,
      stopsOut: 0,
      stopsIn: 0,
      outboundMinutes: 420,
      inboundMinutes: 430,
      layovers: [],
      airportChange: false,
      marketingCarriers: ['VS'],
    });
  });

  it('optional vendor facts are copied only when stated', () => {
    const plain = ok(offer()).itinerary.outbound[0];
    expect(plain).not.toHaveProperty('operatingCarrier');
    expect(plain).not.toHaveProperty('durationMinutes');
    expect(plain).not.toHaveProperty('aircraft');
    const rich = offer();
    rich.outbound = [
      seg({
        operatingCarrier: 'ba',
        durationMinutes: 420,
        aircraft: '77W',
        from: iata('LHR'),
        to: iata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(ok(rich).itinerary.outbound[0]).toMatchObject({
      operatingCarrier: 'BA',
      durationMinutes: 420,
      aircraft: '77W',
    });
  });

  it('layovers: minutes, overnight (00:00–05:00 local at the connection) and airport change', () => {
    const raw = offer({
      outbound: [
        seg({
          marketingCarrier: '4U',
          flightNumber: '4U 8888',
          from: iata('LGW'),
          to: iata('AAA'),
          depart: '2027-03-14T20:00',
          arrive: '2027-03-14T23:10',
        }),
        seg({
          marketingCarrier: 'VS',
          flightNumber: '1',
          from: iata('AAA'),
          to: iata('JFK'),
          depart: '2027-03-15T06:20',
          arrive: '2027-03-15T08:00',
        }),
      ],
      inbound: [
        seg({
          flightNumber: '2',
          from: iata('JFK'),
          to: iata('AAA'),
          depart: '2027-03-28T10:00',
          arrive: '2027-03-28T19:00',
        }),
        seg({
          flightNumber: '3',
          from: iata('BBB'),
          to: iata('LHR'),
          depart: '2027-03-28T21:00',
          arrive: '2027-03-29T00:10',
        }),
      ],
    });
    const it0 = ok(raw).itinerary;
    expect(it0.layovers).toEqual([
      { at: 'AAA', minutes: 430, overnight: true, airportChange: false },
      { at: 'AAA', minutes: 120, overnight: false, airportChange: true },
    ]);
    expect(it0).toMatchObject({
      stopsOut: 1,
      stopsIn: 1,
      airportChange: true,
      marketingCarriers: ['4U', 'VS'],
    });
  });

  it.each([
    ['2027-03-14T05:00', '2027-03-14T07:00', false], // arrives as the night window closes
    ['2027-03-14T21:00', '2027-03-14T23:59', false], // evening only
    ['2027-03-14T23:00', '2027-03-15T00:30', true], // crosses midnight
    ['2027-03-14T04:00', '2027-03-14T06:00', true], // inside the window on the same day
  ])('overnight boundary: arrive %s, depart %s → %s', (arrive, depart, overnight) => {
    const raw = offer({
      outbound: [
        seg({ from: iata('LGW'), to: iata('AAA'), depart: '2027-03-13T20:00', arrive }),
        seg({ flightNumber: '1', from: iata('AAA'), to: iata('JFK'), depart, arrive: '2027-03-15T12:00' }),
      ],
    });
    expect(ok(raw).itinerary.layovers[0]?.overnight).toBe(overnight);
  });

  it('evidenced cabins only when every segment states one', () => {
    const all = offer();
    all.outbound = [
      seg({
        cabin: 'premium_economy',
        from: iata('LHR'),
        to: iata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    all.inbound = [
      seg({
        cabin: 'economy',
        flightNumber: '939',
        from: iata('JFK'),
        to: iata('LHR'),
        depart: '2027-03-28T18:30',
        arrive: '2027-03-29T06:40',
      }),
    ];
    expect(ok(all).observation.segmentCabins).toEqual(['premium_economy', 'economy']);
    const some = offer();
    some.outbound = [
      seg({
        cabin: 'economy',
        from: iata('LHR'),
        to: iata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(ok(some).observation.segmentCabins).toBeNull();
  });
});

describe('normaliseOffer: money and the FX flag (spec §5.6, §6.3)', () => {
  it('GBP is unconverted and keeps pence equal to native minor units', () => {
    expect(ok(offer({ currency: 'gbp' })).observation).toMatchObject({
      pricePence: 41_200,
      priceNativeMinor: 41_200,
      currencyNative: 'GBP',
      fx: { converted: false },
    });
  });

  it('CNY converts with the rate stored beside it', () => {
    expect(ok(offer({ currency: 'CNY', amountMinor: 412_345 })).observation).toMatchObject({
      pricePence: 43_008,
      priceNativeMinor: 412_345,
      currencyNative: 'CNY',
      fx: { converted: true, rateNano: 104_300_000, rateDate: '2027-03-01', source: 'frankfurter' },
    });
  });

  it('a non-ECB currency is currency-unsupported; a missing rate is fx-unavailable', () => {
    expect(reason(offer({ currency: 'XAU' }))).toBe('currency-unsupported');
    expect(reason(offer({ currency: 'USD' }))).toBe('fx-unavailable');
  });

  it('optional fare facts are null when absent and copied when present', () => {
    expect(ok(offer()).observation).toMatchObject({
      taxesIncluded: null,
      selfTransfer: null,
      baggage: null,
      fareConditions: null,
      bookingExpiresAt: null,
    });
    const rich = offer({
      taxesIncluded: true,
      selfTransfer: false,
      baggage: { checkedBags: 1 },
      fareConditions: { refundable: false },
      bookingExpiresAt: '2027-03-01T12:00:00.000Z' as never,
    });
    expect(ok(rich).observation).toMatchObject({
      taxesIncluded: true,
      selfTransfer: false,
      baggage: { checkedBags: 1 },
      fareConditions: { refundable: false },
      bookingExpiresAt: '2027-03-01T12:00:00.000Z',
    });
  });
});

describe('normaliseOffer: booking links (spec §5.2)', () => {
  it('a GET link on the provider allowlist is kept with its host', () => {
    expect(
      ok(offer({ booking: { kind: 'get', url: 'https://www.google.com/travel/flights/booking?x=1' } }))
        .observation.booking,
    ).toEqual({
      kind: 'get',
      url: 'https://www.google.com/travel/flights/booking?x=1',
      host: 'www.google.com',
    });
  });
  it('a POST booking keeps its form data and host', () => {
    expect(
      ok(offer({ booking: { kind: 'post', url: 'https://www.google.com/travel/clk', postData: 'u=abc' } }))
        .observation.booking,
    ).toEqual({
      kind: 'post',
      url: 'https://www.google.com/travel/clk',
      postData: 'u=abc',
      host: 'www.google.com',
    });
  });
  it('anything off the allowlist becomes none, for GET and POST', () => {
    expect(
      ok(offer({ booking: { kind: 'get', url: 'https://seller.example/pay' } })).observation.booking,
    ).toEqual({ kind: 'none' });
    expect(
      ok(offer({ booking: { kind: 'post', url: 'http://www.google.com/travel/clk', postData: 'u' } }))
        .observation.booking,
    ).toEqual({ kind: 'none' });
    expect(
      ok(offer({ booking: { kind: 'get', url: 'https://www.aviasales.com/x' } })).observation.booking,
    ).toEqual({ kind: 'none' });
  });
  it('the offer carries provider, seller and the requested cabin', () => {
    const r = ok(offer(), deps({ providerId: 'travelpayouts' }));
    expect(r.offer).toEqual({
      itineraryHash: r.itinerary.hash,
      providerId: 'travelpayouts',
      seller: 'Virgin Atlantic',
      cabin: 'economy',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/itinerary.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/normalise/itinerary.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/normalise/itinerary.ts`:

```ts
import { NormalisationError } from '../errors.js';
import type { RawOffer, RawSegment } from '../ports/provider.js';
import { type CellKey, cellKeyString } from '../types/definition.js';
import type { Iata, IsoDate, IsoDateTime } from '../types/ids.js';
import type {
  Booking,
  Layover,
  NormalisedItinerary,
  ObservationFields,
  Offer,
  Segment,
} from '../types/itinerary.js';
import type { Cabin, FxInfo, ProviderId } from '../types/provenance.js';
import { canonicalCarrier, canonicalFlightNumber } from './carrier.js';
import { itineraryHash } from './hashing.js';
import { localMinute, requireZone, vendorInstant, wallToInstant } from './localTime.js';
import { ECB_CURRENCIES, toGbp } from './money.js';
import { LINK_ALLOWLIST, validateVendorUrl } from './vendorUrl.js';

/** What the pure normaliser needs from the engine (which reads the airports and FX repositories). */
export interface NormaliseDeps {
  providerId: ProviderId;
  /** The definition's cabin; must equal `raw.requestedCabin`. */
  cabin: Cabin;
  /** IANA zone of an airport from the airports table, or null when the airport is unknown. */
  tzOf(iata: Iata): string | null;
  /** A rate already checked against `FX_MAX_RATE_AGE_DAYS` by the engine, or null. */
  rateFor(currency: string): { rateNano: number; rateDate: IsoDate; source: string } | null;
}

/** `normaliseOffer`'s result: the three parts on success, or the reason the offer is dropped. */
export type NormaliseResult =
  | { ok: true; itinerary: NormalisedItinerary; offer: Offer; observation: ObservationFields }
  | { ok: false; error: NormalisationError };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface TimedSegment {
  segment: Segment;
  departMs: number;
  arriveMs: number;
}

function normaliseSegment(raw: RawSegment, tzOf: (iata: Iata) => string): TimedSegment {
  const marketingCarrier = canonicalCarrier(raw.marketingCarrier);
  const flightNumber = canonicalFlightNumber(raw.flightNumber, marketingCarrier);
  const from = raw.from.toUpperCase() as Iata;
  const to = raw.to.toUpperCase() as Iata;
  const fromTz = requireZone(tzOf(from));
  const toTz = requireZone(tzOf(to));
  const departMs = vendorInstant(raw.depart, raw.timeKind, fromTz);
  const arriveMs = vendorInstant(raw.arrive, raw.timeKind, toTz);
  if (arriveMs <= departMs)
    throw new NormalisationError(
      'bad-local-time',
      `${marketingCarrier}${flightNumber} arrives before it departs`,
    );
  const segment: Segment = {
    marketingCarrier,
    flightNumber,
    from,
    to,
    departLocal: localMinute(departMs, fromTz),
    arriveLocal: localMinute(arriveMs, toTz),
    departUtc: new Date(departMs).toISOString() as IsoDateTime,
    arriveUtc: new Date(arriveMs).toISOString() as IsoDateTime,
  };
  // why: optional vendor facts are copied only when stated; nothing is defaulted (spec §5.2).
  if (raw.operatingCarrier !== undefined) segment.operatingCarrier = canonicalCarrier(raw.operatingCarrier);
  if (raw.durationMinutes !== undefined) segment.durationMinutes = raw.durationMinutes;
  if (raw.aircraft !== undefined) segment.aircraft = raw.aircraft;
  return { segment, departMs, arriveMs };
}

/** True when (arriveMs, departMs) overlaps 00:00–05:00 local on any date it touches. Spec §6.2. */
function spansNight(arriveMs: number, departMs: number, tz: string): boolean {
  const first = Date.parse(`${localMinute(arriveMs, tz).slice(0, 10)}T00:00:00.000Z`);
  const last = Date.parse(`${localMinute(departMs, tz).slice(0, 10)}T00:00:00.000Z`);
  for (let day = first; day <= last; day += DAY_MS) {
    const d = new Date(day);
    const parts = { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), mi: 0, s: 0, ms: 0 };
    const start = wallToInstant({ ...parts, h: 0 }, tz);
    const end = wallToInstant({ ...parts, h: 5 }, tz);
    if (arriveMs < end && departMs > start) return true;
  }
  return false;
}

function layoversOf(direction: readonly TimedSegment[], tzOf: (iata: Iata) => string): Layover[] {
  const out: Layover[] = [];
  for (let i = 0; i + 1 < direction.length; i++) {
    const inbound = direction[i] as TimedSegment;
    const next = direction[i + 1] as TimedSegment;
    const minutes = Math.round((next.departMs - inbound.arriveMs) / MINUTE_MS);
    if (minutes < 0)
      throw new NormalisationError(
        'bad-local-time',
        `connection at ${inbound.segment.to} departs before arrival`,
      );
    out.push({
      at: inbound.segment.to,
      minutes,
      overnight: spansNight(inbound.arriveMs, next.departMs, requireZone(tzOf(inbound.segment.to))),
      airportChange: inbound.segment.to !== next.segment.from,
    });
  }
  return out;
}

function directionMinutes(direction: readonly TimedSegment[]): number {
  const first = direction[0] as TimedSegment;
  const last = direction[direction.length - 1] as TimedSegment;
  return Math.round((last.arriveMs - first.departMs) / MINUTE_MS);
}

function money(raw: RawOffer, deps: NormaliseDeps): { pricePence: number; fx: FxInfo } {
  const currency = raw.currency.toUpperCase();
  if (currency === 'GBP') return { pricePence: toGbp(raw.amountMinor, 'GBP', 1), fx: { converted: false } };
  if (!ECB_CURRENCIES.includes(currency)) throw new NormalisationError('currency-unsupported', currency);
  const rate = deps.rateFor(currency);
  if (rate === null) throw new NormalisationError('fx-unavailable', currency);
  return {
    pricePence: toGbp(raw.amountMinor, currency, rate.rateNano),
    fx: { converted: true, rateNano: rate.rateNano, rateDate: rate.rateDate, source: rate.source },
  };
}

function booking(raw: RawOffer, providerId: ProviderId): Booking {
  if (raw.booking.kind === 'none') return { kind: 'none' };
  const checked = validateVendorUrl(raw.booking.url, LINK_ALLOWLIST[providerId]);
  if (checked.kind !== 'get' || raw.booking.kind === 'get') return checked;
  return { kind: 'post', url: checked.url, postData: raw.booking.postData, host: checked.host };
}

function zoneOf(tzOf: NormaliseDeps['tzOf'], iata: Iata): string {
  const tz = tzOf(iata);
  // why: an airport missing from the table must stop the offer here; UTC is never hashed (spec §6.4).
  if (tz === null) throw new NormalisationError('unknown-airport-tz', `no time zone for ${iata}`);
  return tz;
}

/**
 * Spec §5.6 pure step for one raw offer returned for `cell`: carriers and flight numbers
 * canonicalised, local and UTC times per segment (DST rules), layovers, identity hash (§6.4),
 * evidenced cabins, money in pence with the FX flag (§6.3), booking link validated (§5.2).
 * The offer must fly the cell it was returned for (origin, destination, local departure and
 * return dates); a vendor answer for another cell is dropped, never re-keyed (spec §5.2 "cell
 * keys from the response").
 * Returns `{ ok: false, error }` for every `NormalisationError`, so the engine can drop the offer
 * and count it as `offers-dropped:n`. Programming errors (cabin mismatch, non-integer amounts) throw.
 */
export function normaliseOffer(raw: RawOffer, cell: CellKey, deps: NormaliseDeps): NormaliseResult {
  if (raw.requestedCabin !== deps.cabin) {
    throw new Error(`requestedCabin ${raw.requestedCabin} differs from the definition cabin ${deps.cabin}`);
  }
  const tzOf = (iata: Iata): string => zoneOf(deps.tzOf, iata);
  try {
    if (raw.outbound.length === 0 || raw.inbound.length === 0) {
      throw new NormalisationError(
        'no-return-legs',
        raw.outbound.length === 0 ? 'no outbound segments' : 'no inbound segments',
      );
    }
    const out = raw.outbound.map((s) => normaliseSegment(s, tzOf));
    const back = raw.inbound.map((s) => normaliseSegment(s, tzOf));
    const outbound = out.map((t) => t.segment);
    const inbound = back.map((t) => t.segment);
    const firstOut = outbound[0] as Segment;
    const lastOut = outbound[outbound.length - 1] as Segment;
    const firstIn = inbound[0] as Segment;
    const flown = cellKeyString({
      origin: firstOut.from,
      destination: lastOut.to,
      departureDate: firstOut.departLocal.slice(0, 10) as IsoDate,
      returnDate: firstIn.departLocal.slice(0, 10) as IsoDate,
    });
    const asked = cellKeyString(cell);
    if (flown !== asked)
      throw new NormalisationError('cell-mismatch', `offer flies ${flown}, cell is ${asked}`);
    const layovers = [...layoversOf(out, tzOf), ...layoversOf(back, tzOf)];
    const hash = itineraryHash(outbound, inbound);
    const itinerary: NormalisedItinerary = {
      hash,
      origin: cell.origin,
      destination: cell.destination,
      departureDate: cell.departureDate,
      returnDate: cell.returnDate,
      nights: Math.round((Date.parse(cell.returnDate) - Date.parse(cell.departureDate)) / DAY_MS),
      outbound,
      inbound,
      outboundMinutes: directionMinutes(out),
      inboundMinutes: directionMinutes(back),
      stopsOut: outbound.length - 1,
      stopsIn: inbound.length - 1,
      layovers,
      airportChange: layovers.some((l) => l.airportChange),
      marketingCarriers: [...new Set([...outbound, ...inbound].map((s) => s.marketingCarrier))].sort(),
    };
    const all = [...raw.outbound, ...raw.inbound];
    // why: a cabin is evidence only when the vendor states it on every segment; otherwise the
    // cabin verdict must be `unverified`, so we store null rather than a partial list (spec §5.6).
    const segmentCabins = all.every((s) => s.cabin !== undefined) ? all.map((s) => s.cabin as Cabin) : null;
    const { pricePence, fx } = money(raw, deps);
    return {
      ok: true,
      itinerary,
      offer: {
        itineraryHash: hash,
        providerId: deps.providerId,
        seller: raw.seller,
        cabin: raw.requestedCabin,
      },
      observation: {
        pricePence,
        fx,
        priceNativeMinor: raw.amountMinor,
        currencyNative: raw.currency.toUpperCase(),
        taxesIncluded: raw.taxesIncluded ?? null,
        selfTransfer: raw.selfTransfer ?? null,
        segmentCabins,
        baggage: raw.baggage ?? null,
        fareConditions: raw.fareConditions ?? null,
        booking: booking(raw, deps.providerId),
        bookingExpiresAt: raw.bookingExpiresAt ?? null,
      },
    };
  } catch (e) {
    if (e instanceof NormalisationError) return { ok: false, error: e };
    throw e;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/normalise/itinerary.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 26 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: normaliseOffer: segments, layovers, hash, cabins, money, booking (spec §5.6)"
```

### Task 2.6: Constraints and verdict class

**Files:**
- Create: `packages/core/src/constraints/evaluate.ts`, `packages/core/src/constraints/verdictClass.ts`
- Test: `packages/core/test/constraints/evaluate.test.ts`

**Interfaces:**
- Consumes: `normaliseOffer` (Task 2.5, to build the test itinerary), `Constraints`, `NormalisedItinerary`, `ObservationFields`, `SuppliedField`, `Verdict(s)`, `VerdictClass`, `ConstraintName`, `Cabin`
- Produces: `evaluateConstraints(it, obs, c, requestedCabin, supplied)`, `verdictClass`, `unverifiedNames`

Rules per spec §6.2 row. "Absent" means the field is missing from `supplied`, or the value the rule needs is null or undefined.

| Constraint | Needs | Rule |
|---|---|---|
| cabin (always) | `segmentCabins` supplied, one per segment | fail if any segment is below `requestedCabin`, else pass |
| maxStops | `segments` | `stopsOut ≤ n` and `stopsIn ≤ n` |
| maxJourneyMinutes | `segments`+`segmentTimes`, both direction minutes | each direction ≤ n |
| min/maxLayoverMinutes | `segments`+`segmentTimes` | every layover (none = pass) |
| noOvernightLayover | `segments`+`segmentTimes` | no layover overlaps 00:00–05:00 local |
| departure/arrivalWindowLocal | `segments`+`segmentTimes` | first departure / last arrival of **each** direction in `[from, to]`; `from > to` wraps midnight |
| noSelfTransfer | `selfTransfer` and a non-null value | not `true` |
| noAirportChange | `segments` and a defined `airportChange` | not `true` |
| includeAirlines | `segments` | any segment's marketing carrier is listed |
| excludeAirlines | `segments` | no segment's marketing carrier is listed |
| cabinBagRequired / checkedBagRequired / minCheckedBags | `baggage` with the field present | `included` / `≥ 1` / `≥ n` |
| maxPricePence | `price` | `pricePence ≤ n` |


- [ ] **Step 1: Write the failing test**

`packages/core/test/constraints/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateConstraints } from '../../src/constraints/evaluate.js';
import { unverifiedNames, verdictClass } from '../../src/constraints/verdictClass.js';
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import type { Constraints } from '../../src/types/definition.js';
import type {
  ConstraintName,
  NormalisedItinerary,
  ObservationFields,
  SuppliedField,
  Verdict,
} from '../../src/types/itinerary.js';
import type { Cabin } from '../../src/types/provenance.js';
import { cellOf, deps, iata, offer, seg } from '../helpers/offers.js';

/**
 * One-stop out via AAA (overnight, 430 min), one-stop back changing AAA→BBB (120 min), VS and 4U.
 * Out: LGW 20:00 → AAA 23:10, AAA 06:20 → JFK 08:00 (+1). Back: JFK 10:00 → AAA 19:00, BBB 21:00 → LHR 00:10 (+1).
 */
function itinerary(): NormalisedItinerary {
  const raw = offer({
    outbound: [
      seg({
        marketingCarrier: '4U',
        flightNumber: '8888',
        from: iata('LGW'),
        to: iata('AAA'),
        depart: '2027-03-14T20:00',
        arrive: '2027-03-14T23:10',
      }),
      seg({
        flightNumber: '1',
        from: iata('AAA'),
        to: iata('JFK'),
        depart: '2027-03-15T06:20',
        arrive: '2027-03-15T08:00',
      }),
    ],
    inbound: [
      seg({
        flightNumber: '2',
        from: iata('JFK'),
        to: iata('AAA'),
        depart: '2027-03-28T10:00',
        arrive: '2027-03-28T19:00',
      }),
      seg({
        flightNumber: '3',
        from: iata('BBB'),
        to: iata('LHR'),
        depart: '2027-03-28T21:00',
        arrive: '2027-03-29T00:10',
      }),
    ],
  });
  const r = normaliseOffer(raw, cellOf(raw), deps());
  if (!r.ok) throw r.error;
  return r.itinerary;
}

const IT = itinerary();
const ALL: SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'fareConditions',
  'seller',
  'price',
];
const without = (...f: SuppliedField[]): SuppliedField[] => ALL.filter((x) => !f.includes(x));
const OFFER: ObservationFields = {
  pricePence: 41_200,
  priceNativeMinor: 41_200,
  currencyNative: 'GBP',
  fx: { converted: false },
  taxesIncluded: true,
  selfTransfer: false,
  segmentCabins: ['economy', 'economy', 'economy', 'economy'],
  baggage: { cabinBag: 'included', checkedBags: 1 },
  fareConditions: null,
  booking: { kind: 'none' },
  bookingExpiresAt: null,
};

/** Third column: observation overrides, plus `cabin` for the requested cabin (default economy). */
type Row = [
  ConstraintName,
  Constraints,
  Partial<ObservationFields> & { cabin?: Cabin },
  SuppliedField[],
  Verdict,
];

// Every row of the spec §6.2 table, each with pass, fail and absent-input → unverified.
const ROWS: Row[] = [
  ['maxStops', { maxStops: 1 }, {}, ALL, 'pass'],
  ['maxStops', { maxStops: 0 }, {}, ALL, 'fail'],
  ['maxStops', { maxStops: 1 }, {}, without('segments'), 'unverified'],
  ['maxJourneyMinutes', { maxJourneyMinutes: 1500 }, {}, ALL, 'pass'],
  ['maxJourneyMinutes', { maxJourneyMinutes: 600 }, {}, ALL, 'fail'],
  ['maxJourneyMinutes', { maxJourneyMinutes: 1500 }, {}, without('segmentTimes'), 'unverified'],
  ['minLayoverMinutes', { minLayoverMinutes: 120 }, {}, ALL, 'pass'],
  ['minLayoverMinutes', { minLayoverMinutes: 121 }, {}, ALL, 'fail'],
  ['minLayoverMinutes', { minLayoverMinutes: 60 }, {}, without('segmentTimes'), 'unverified'],
  ['maxLayoverMinutes', { maxLayoverMinutes: 430 }, {}, ALL, 'pass'],
  ['maxLayoverMinutes', { maxLayoverMinutes: 429 }, {}, ALL, 'fail'],
  ['maxLayoverMinutes', { maxLayoverMinutes: 600 }, {}, without('segments'), 'unverified'],
  ['noOvernightLayover', { noOvernightLayover: true }, {}, ALL, 'fail'],
  ['noOvernightLayover', { noOvernightLayover: true }, {}, without('segmentTimes'), 'unverified'],
  ['departureWindowLocal', { departureWindowLocal: { from: '09:00', to: '21:00' } }, {}, ALL, 'pass'],
  ['departureWindowLocal', { departureWindowLocal: { from: '21:00', to: '09:00' } }, {}, ALL, 'fail'], // wraps midnight: 20:00 and 10:00 both outside
  [
    'departureWindowLocal',
    { departureWindowLocal: { from: '09:00', to: '21:00' } },
    {},
    without('segmentTimes'),
    'unverified',
  ],
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '06:00', to: '23:00' } }, {}, ALL, 'fail'], // inbound lands 00:10
  ['arrivalWindowLocal', { arrivalWindowLocal: { from: '22:00', to: '08:30' } }, {}, ALL, 'pass'], // wraps: 08:00 and 00:10 inside
  [
    'arrivalWindowLocal',
    { arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    {},
    without('segments'),
    'unverified',
  ],
  ['noSelfTransfer', { noSelfTransfer: true }, { selfTransfer: false }, ALL, 'pass'],
  ['noSelfTransfer', { noSelfTransfer: true }, { selfTransfer: true }, ALL, 'fail'],
  ['noSelfTransfer', { noSelfTransfer: true }, { selfTransfer: null }, ALL, 'unverified'],
  [
    'noSelfTransfer',
    { noSelfTransfer: true },
    { selfTransfer: false },
    without('selfTransfer'),
    'unverified',
  ],
  ['noAirportChange', { noAirportChange: true }, {}, ALL, 'fail'],
  ['noAirportChange', { noAirportChange: true }, {}, without('segments'), 'unverified'],
  ['includeAirlines', { includeAirlines: ['4U'] }, {}, ALL, 'pass'],
  ['includeAirlines', { includeAirlines: ['BA'] }, {}, ALL, 'fail'],
  ['includeAirlines', { includeAirlines: ['4U'] }, {}, without('segments'), 'unverified'],
  ['excludeAirlines', { excludeAirlines: ['BA'] }, {}, ALL, 'pass'],
  ['excludeAirlines', { excludeAirlines: ['4U'] }, {}, ALL, 'fail'],
  ['excludeAirlines', { excludeAirlines: ['4U'] }, {}, without('segments'), 'unverified'],
  ['cabinBagRequired', { cabinBagRequired: true }, {}, ALL, 'pass'],
  ['cabinBagRequired', { cabinBagRequired: true }, { baggage: { cabinBag: 'not-included' } }, ALL, 'fail'],
  ['cabinBagRequired', { cabinBagRequired: true }, { baggage: { checkedBags: 1 } }, ALL, 'unverified'],
  ['cabinBagRequired', { cabinBagRequired: true }, {}, without('baggage'), 'unverified'],
  ['checkedBagRequired', { checkedBagRequired: true }, {}, ALL, 'pass'],
  ['checkedBagRequired', { checkedBagRequired: true }, { baggage: { checkedBags: 0 } }, ALL, 'fail'],
  ['checkedBagRequired', { checkedBagRequired: true }, { baggage: null }, ALL, 'unverified'],
  ['minCheckedBags', { minCheckedBags: 1 }, {}, ALL, 'pass'],
  ['minCheckedBags', { minCheckedBags: 2 }, {}, ALL, 'fail'],
  ['minCheckedBags', { minCheckedBags: 1 }, { baggage: { cabinBag: 'included' } }, ALL, 'unverified'],
  ['maxPricePence', { maxPricePence: 41_200 }, {}, ALL, 'pass'],
  ['maxPricePence', { maxPricePence: 41_199 }, {}, ALL, 'fail'],
  ['maxPricePence', { maxPricePence: 50_000 }, {}, without('price'), 'unverified'],
  ['cabin', {}, {}, ALL, 'pass'],
  ['cabin', {}, { cabin: 'premium_economy' }, ALL, 'fail'], // every segment below the requested cabin
  [
    'cabin',
    {},
    { segmentCabins: ['business', 'economy', 'first', 'premium_economy'], cabin: 'economy' },
    ALL,
    'pass',
  ], // mixed, none below
  ['cabin', {}, { segmentCabins: null }, ALL, 'unverified'],
  ['cabin', {}, { segmentCabins: ['economy'] }, ALL, 'unverified'], // not every segment stated
  ['cabin', {}, {}, without('segmentCabins'), 'unverified'],
];

describe('evaluateConstraints (spec §6.2)', () => {
  it.each(ROWS)('%s %j %j → %s', (name, c, o, supplied, expected) => {
    const { cabin = 'economy', ...obs } = o;
    expect(evaluateConstraints(IT, { ...OFFER, ...obs }, c, cabin, supplied)[name]).toBe(expected);
  });

  it('judges only the constraints that are set (false and [] are not set); cabin is always judged', () => {
    const v = evaluateConstraints(
      IT,
      OFFER,
      {
        noOvernightLayover: false,
        noSelfTransfer: false,
        noAirportChange: false,
        includeAirlines: [],
        excludeAirlines: [],
        cabinBagRequired: false,
        checkedBagRequired: false,
      },
      'economy',
      ALL,
    );
    expect(v).toEqual({ cabin: 'pass' });
  });

  it('journey minutes missing from the itinerary are unverified even when times are supplied', () => {
    const { outboundMinutes: _o, ...rest } = IT;
    expect(
      evaluateConstraints(rest, OFFER, { maxJourneyMinutes: 1500 }, 'economy', ALL).maxJourneyMinutes,
    ).toBe('unverified');
  });

  it('a malformed time window is a caller error', () => {
    expect(() =>
      evaluateConstraints(IT, OFFER, { departureWindowLocal: { from: '9:00', to: '21:00' } }, 'economy', ALL),
    ).toThrow(RangeError);
  });

  it('a direct itinerary passes layover constraints vacuously', () => {
    const direct = { ...IT, layovers: [], stopsOut: 0, stopsIn: 0 };
    expect(
      evaluateConstraints(
        direct,
        OFFER,
        { minLayoverMinutes: 60, maxLayoverMinutes: 300, noOvernightLayover: true },
        'economy',
        ALL,
      ),
    ).toMatchObject({ minLayoverMinutes: 'pass', maxLayoverMinutes: 'pass', noOvernightLayover: 'pass' });
  });
});

describe('verdictClass (spec §3, §6.2)', () => {
  it.each([
    [{ cabin: 'pass', maxStops: 'pass' }, 'verified'],
    [{ cabin: 'unverified', maxStops: 'pass' }, 'partially-verified'],
    [{ cabin: 'unverified', maxStops: 'fail' }, 'failed'],
    [{ cabin: 'pass', maxStops: 'fail' }, 'failed'],
    [{}, 'verified'],
  ] as const)('%j → %s', (v, cls) => {
    expect(verdictClass(v)).toBe(cls);
  });
});

describe('unverifiedNames', () => {
  it('lists the unverified constraints in key order', () => {
    expect(
      unverifiedNames({
        cabin: 'unverified',
        maxStops: 'pass',
        checkedBagRequired: 'unverified',
        maxPricePence: 'fail',
      }),
    ).toEqual(['cabin', 'checkedBagRequired']);
    expect(unverifiedNames({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/constraints/evaluate.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/constraints/evaluate.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/constraints/evaluate.ts`:

```ts
import type { Constraints } from '../types/definition.js';
import type {
  NormalisedItinerary,
  ObservationFields,
  Segment,
  SuppliedField,
  Verdict,
  Verdicts,
} from '../types/itinerary.js';
import type { Cabin } from '../types/provenance.js';

const CABIN_RANK: Readonly<Record<Cabin, number>> = { economy: 0, premium_economy: 1, business: 2, first: 3 };
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const verdict = (ok: boolean): Verdict => (ok ? 'pass' : 'fail');

/** `HH:mm` inside [from, to]; a window whose `from` is later than `to` wraps midnight. */
function inWindow(time: string, w: { from: string; to: string }): boolean {
  if (!HHMM_RE.test(w.from) || !HHMM_RE.test(w.to))
    throw new RangeError(`window must be HH:mm: ${w.from}–${w.to}`);
  return w.from <= w.to ? time >= w.from && time <= w.to : time >= w.from || time <= w.to;
}

const hhmm = (local: string): string => local.slice(11, 16);
const firstOf = (d: readonly Segment[]): Segment => d[0] as Segment;
const lastOf = (d: readonly Segment[]): Segment => d[d.length - 1] as Segment;

/**
 * Spec §6.2. Evaluated at read time against the current definition's constraints and the
 * observation's stored `supplied_fields_json`, so an edited constraint re-judges old rows.
 * Only constraints the definition sets are judged (a `false` boolean or an empty airline list is
 * "not set"); `cabin` is always judged against `requestedCabin` (the offer's cabin, never
 * evidence itself). Absent input is `unverified`, never `pass`.
 */
export function evaluateConstraints(
  it: NormalisedItinerary,
  obs: ObservationFields & { segmentCabins: Cabin[] | null },
  c: Constraints,
  requestedCabin: Cabin,
  supplied: readonly SuppliedField[],
): Verdicts {
  const has = (f: SuppliedField): boolean => supplied.includes(f);
  const segments = has('segments');
  const times = segments && has('segmentTimes');
  const all = [...it.outbound, ...it.inbound];
  const v: Verdicts = {};

  // why: requestedCabin is never evidence; only per-segment cabins stated by the vendor count, and
  // only when every segment states one (mixed-cabin itineraries are common).
  const cabins = has('segmentCabins') ? obs.segmentCabins : null;
  v.cabin =
    cabins === null || cabins.length !== all.length
      ? 'unverified'
      : verdict(cabins.every((k) => CABIN_RANK[k] >= CABIN_RANK[requestedCabin]));

  if (c.maxStops !== undefined) {
    const max = c.maxStops;
    v.maxStops = segments ? verdict(it.stopsOut <= max && it.stopsIn <= max) : 'unverified';
  }
  if (c.maxJourneyMinutes !== undefined) {
    const max = c.maxJourneyMinutes;
    const out = it.outboundMinutes;
    const back = it.inboundMinutes;
    v.maxJourneyMinutes =
      times && out !== undefined && back !== undefined ? verdict(out <= max && back <= max) : 'unverified';
  }
  if (c.minLayoverMinutes !== undefined) {
    const min = c.minLayoverMinutes;
    v.minLayoverMinutes = times ? verdict(it.layovers.every((l) => l.minutes >= min)) : 'unverified';
  }
  if (c.maxLayoverMinutes !== undefined) {
    const max = c.maxLayoverMinutes;
    v.maxLayoverMinutes = times ? verdict(it.layovers.every((l) => l.minutes <= max)) : 'unverified';
  }
  if (c.noOvernightLayover === true) {
    v.noOvernightLayover = times ? verdict(!it.layovers.some((l) => l.overnight)) : 'unverified';
  }
  if (c.departureWindowLocal !== undefined) {
    const w = c.departureWindowLocal;
    v.departureWindowLocal = times
      ? verdict(
          inWindow(hhmm(firstOf(it.outbound).departLocal), w) &&
            inWindow(hhmm(firstOf(it.inbound).departLocal), w),
        )
      : 'unverified';
  }
  if (c.arrivalWindowLocal !== undefined) {
    const w = c.arrivalWindowLocal;
    v.arrivalWindowLocal = times
      ? verdict(
          inWindow(hhmm(lastOf(it.outbound).arriveLocal), w) &&
            inWindow(hhmm(lastOf(it.inbound).arriveLocal), w),
        )
      : 'unverified';
  }
  if (c.noSelfTransfer === true) {
    v.noSelfTransfer =
      has('selfTransfer') && obs.selfTransfer !== null ? verdict(!obs.selfTransfer) : 'unverified';
  }
  if (c.noAirportChange === true) {
    v.noAirportChange =
      segments && it.airportChange !== undefined ? verdict(!it.airportChange) : 'unverified';
  }
  if (c.includeAirlines !== undefined && c.includeAirlines.length > 0) {
    const list = c.includeAirlines;
    v.includeAirlines = segments ? verdict(all.some((s) => list.includes(s.marketingCarrier))) : 'unverified';
  }
  if (c.excludeAirlines !== undefined && c.excludeAirlines.length > 0) {
    const list = c.excludeAirlines;
    v.excludeAirlines = segments
      ? verdict(!all.some((s) => list.includes(s.marketingCarrier)))
      : 'unverified';
  }
  const bags = has('baggage') ? obs.baggage : null;
  if (c.cabinBagRequired === true) {
    const cabinBag = bags?.cabinBag;
    v.cabinBagRequired = cabinBag === undefined ? 'unverified' : verdict(cabinBag === 'included');
  }
  if (c.checkedBagRequired === true) {
    const n = bags?.checkedBags;
    v.checkedBagRequired = n === undefined ? 'unverified' : verdict(n >= 1);
  }
  if (c.minCheckedBags !== undefined) {
    const min = c.minCheckedBags;
    const n = bags?.checkedBags;
    v.minCheckedBags = n === undefined ? 'unverified' : verdict(n >= min);
  }
  if (c.maxPricePence !== undefined) {
    v.maxPricePence = has('price') ? verdict(obs.pricePence <= c.maxPricePence) : 'unverified';
  }
  return v;
}
```

`packages/core/src/constraints/verdictClass.ts`:

```ts
import type { ConstraintName, Verdict, VerdictClass, Verdicts } from '../types/itinerary.js';

/**
 * Spec §3, §6.2: `failed` iff any verdict is `fail`; `verified` iff every verdict is `pass`;
 * otherwise `partially-verified`. The word "verified" is reserved for this class.
 */
export function verdictClass(v: Verdicts): VerdictClass {
  const values = Object.values(v) as Verdict[];
  if (values.includes('fail')) return 'failed';
  return values.every((x) => x === 'pass') ? 'verified' : 'partially-verified';
}

/** The constraints judged `unverified`, in `Verdicts` key order; a row and a firing list these (spec §6.8, §11). */
export function unverifiedNames(v: Verdicts): ConstraintName[] {
  return (Object.entries(v) as Array<[ConstraintName, Verdict]>)
    .filter(([, x]) => x === 'unverified')
    .map(([k]) => k);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/constraints/evaluate.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 61 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: evaluateConstraints, verdictClass, unverifiedNames, table-driven (spec §6.2)"
```

### Task 2.7: Results: dedup, rank (review focus 2), sort

**Files:**
- Create: `packages/core/src/results/types.ts`, `packages/core/src/results/dedup.ts`, `packages/core/src/results/rank.ts`
- Test: `packages/core/test/helpers/rows.ts`, `packages/core/test/results/dedupRank.test.ts`

**Interfaces:**
- Consumes: `resultRowSchema` (api-contract), `effectiveAge`, `compareAges`, `formatAgeCompact` (labels), `cellKeyString`, `ProviderId`, `ConstraintName`, `VerdictClass`
- Produces: `ResultRow`, `SortKey`, `ResultFilters`, `dedupByItinerary(rows)`, `rankRows(rows, now)`, `sortRows(rows, key, dir)`

`dedupByItinerary` takes no cabin: WP8 reads only rows in the definition's cabin (spec §6.5), so the rows it passes are already in-cabin. `rankRows` orders by class, then seen-in-latest before `notSeenInLatest` (spec §8.1), then price, age (`compareAges`) and identity. `test/helpers/rows.ts` parses every fixture row through WP0's `resultRowSchema`. If the merged schema requires a field this helper lacks, the parse fails loudly. Add the field with a value the schema accepts. Never loosen the schema from WP2.

- [ ] **Step 1: Write the failing test**

`packages/core/test/helpers/rows.ts`:

```ts
import { resultRowSchema } from '../../src/api-contract/results.js';
import type { ResultRow } from '../../src/results/types.js';
import type { IsoDateTime } from '../../src/types/ids.js';

export const NOW = '2027-03-01T12:00:00.000Z' as IsoDateTime;

type Over = Partial<Omit<ResultRow, 'provenance' | 'cell'>> & {
  provenance?: Partial<ResultRow['provenance']>;
  cell?: Partial<ResultRow['cell']>;
};

/**
 * A verified-basis row on the worked example, parsed through WP0's `resultRowSchema` so a
 * fixture that drifts from the contract fails here, not silently in a later package.
 */
export function row(over: Over = {}): ResultRow {
  const { provenance, cell, ...rest } = over;
  return resultRowSchema.parse({
    itineraryHash: 'h1',
    basis: 'verified',
    verdictClass: 'verified',
    pricePence: 41_200,
    provenance: {
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
      fetchedAt: '2027-03-01T10:00:00.000Z',
      maxAgeHours: 0,
      fx: { converted: false },
      pointOfSale: 'GB',
      cabin: 'economy',
      ...provenance,
    },
    stale: false,
    ageHours: 2,
    cell: {
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2027-03-14',
      returnDate: '2027-03-28',
      nights: 14,
      ...cell,
    },
    outbound: [],
    inbound: [],
    totalMinutes: 850,
    outboundMinutes: 420,
    inboundMinutes: 430,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    carriers: ['VS'],
    verdicts: { cabin: 'pass' },
    unverified: [],
    notApplied: [],
    seller: 'Virgin Atlantic',
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    booking: { kind: 'none' },
    searchLink: {
      url: 'https://www.google.com/travel/flights?q=x',
      host: 'www.google.com',
      label: 'search link, not a fare link',
    },
    otherOffers: [],
    notSeenInLatest: null,
    adjustedPence: null,
    destinationNote: null,
    executionId: 'ex-2',
    calendarPriceId: null,
    observationId: 1,
    ...rest,
  });
}

/** A calendar-basis row: no segments, class unchecked, Travelpayouts provenance. */
export function calendarRow(over: Over = {}): ResultRow {
  return row({
    itineraryHash: null,
    basis: 'calendar',
    verdictClass: 'unchecked',
    outbound: null,
    inbound: null,
    totalMinutes: null,
    outboundMinutes: null,
    inboundMinutes: null,
    stopsOut: null,
    stopsIn: null,
    carriers: [],
    verdicts: {},
    seller: null,
    observationId: null,
    calendarPriceId: 7,
    ...over,
    provenance: {
      providerId: 'travelpayouts',
      sourceKind: 'authorised-cached',
      maxAgeHours: 48,
      pointOfSale: 'unknown',
      ...over.provenance,
    },
  });
}
```

`packages/core/test/results/dedupRank.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { effectiveAge, formatAgeCompact } from '../../src/labels/age.js';
import { dedupByItinerary } from '../../src/results/dedup.js';
import { rankRows, sortRows } from '../../src/results/rank.js';
import type { SortKey } from '../../src/results/types.js';
import { calendarRow, NOW, row } from '../helpers/rows.js';

describe('dedupByItinerary (spec §6.5)', () => {
  it('one row per itinerary showing the cheapest qualifying offer; others go to the expanded row with their age', () => {
    const rows = [
      row({ seller: 'A', pricePence: 52_000, verdictClass: 'verified', stale: true, ageHours: 300 }),
      row({ seller: 'B', pricePence: 48_000, verdictClass: 'failed' }),
      row({ seller: 'C', pricePence: 50_000, verdictClass: 'partially-verified' }),
    ];
    const out = dedupByItinerary(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ seller: 'C', pricePence: 50_000, verdictClass: 'partially-verified' });
    expect(out[0]?.otherOffers.map((o) => [o.seller, o.pricePence])).toEqual([
      ['B', 48_000],
      ['A', 52_000],
    ]);
    expect(out[0]?.otherOffers[1]).toMatchObject({ stale: true, ageHours: 300 });
  });

  it('an itinerary row without a seller sorts as an empty name and lists as ""', () => {
    // Both input orders, so the comparator sees the missing seller on either side.
    for (const rows of [
      [row({ seller: null, pricePence: 1 }), row({ seller: 'A', pricePence: 1 })],
      [row({ seller: 'A', pricePence: 1 }), row({ seller: null, pricePence: 1 })],
    ]) {
      const out = dedupByItinerary(rows);
      expect(out[0]?.seller).toBeNull();
      expect(out[0]?.otherOffers.map((o) => o.seller)).toEqual(['A']);
    }
    expect(
      dedupByItinerary([row({ seller: 'A', pricePence: 1 }), row({ seller: null, pricePence: 2 })])[0]
        ?.otherOffers[0]?.seller,
    ).toBe('');
  });

  it('an itinerary whose every offer failed keeps its cheapest failed offer', () => {
    const out = dedupByItinerary([
      row({ seller: 'A', pricePence: 60_000, verdictClass: 'failed' }),
      row({ seller: 'B', pricePence: 55_000, verdictClass: 'failed' }),
    ]);
    expect(out[0]).toMatchObject({ seller: 'B', verdictClass: 'failed' });
  });

  it('equal prices pick by seller name; calendar rows pass through; first-appearance order is kept', () => {
    const cal = calendarRow();
    const out = dedupByItinerary([
      row({ itineraryHash: 'h2', seller: 'Z' }),
      cal,
      row({ itineraryHash: 'h2', seller: 'M' }),
      row({ itineraryHash: 'h1' }),
    ]);
    expect(out.map((r) => r.itineraryHash)).toEqual(['h2', null, 'h1']);
    expect(out[0]?.seller).toBe('M');
    expect(out[1]).toBe(cal);
  });
});

describe('rankRows (spec §6.5: class, then price)', () => {
  it('orders verified, partially-verified, failed, then by price', () => {
    const ranked = rankRows(
      [
        row({ itineraryHash: 'f', verdictClass: 'failed', pricePence: 30_000 }),
        row({ itineraryHash: 'p', verdictClass: 'partially-verified', pricePence: 35_000 }),
        row({ itineraryHash: 'v2', pricePence: 45_000 }),
        row({ itineraryHash: 'v1', pricePence: 40_000 }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['v1', 'v2', 'p', 'f']);
  });

  it('within a class, rows not seen in the latest search rank after seen rows (spec §8.1)', () => {
    const ranked = rankRows(
      [
        row({ itineraryHash: 'gone', pricePence: 30_000, notSeenInLatest: { ageHours: 5 } }),
        row({ itineraryHash: 'seen', pricePence: 45_000 }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['seen', 'gone']);
  });

  it('calendar rows (unchecked) rank by price after any checked class', () => {
    const ranked = rankRows(
      [calendarRow({ pricePence: 10_000 }), row({ verdictClass: 'failed', pricePence: 90_000 })],
      NOW,
    );
    expect(ranked.map((r) => r.verdictClass)).toEqual(['failed', 'unchecked']);
  });

  it('equal class and price: fresher first through compareAges; unknown age loses to any known age; then identity', () => {
    const old = row({ itineraryHash: 'old', provenance: { fetchedAt: '2027-02-20T12:00:00.000Z' as never } });
    const fresh = row({
      itineraryHash: 'fresh',
      provenance: { fetchedAt: '2027-03-01T11:00:00.000Z' as never },
    });
    const unknown = row({
      itineraryHash: 'unknown',
      provenance: { fetchedAt: '2027-03-01T11:30:00.000Z' as never, maxAgeHours: 'unknown' },
    });
    expect(rankRows([unknown, old, fresh], NOW).map((r) => r.itineraryHash)).toEqual([
      'fresh',
      'old',
      'unknown',
    ]);
    expect(
      rankRows([row({ itineraryHash: 'b' }), row({ itineraryHash: 'a' })], NOW).map((r) => r.itineraryHash),
    ).toEqual(['a', 'b']);
    const calA = calendarRow({ cell: { departureDate: '2027-03-15' as never } });
    const calB = calendarRow({ cell: { departureDate: '2027-03-14' as never } });
    expect(rankRows([calA, calB], NOW)).toEqual([calB, calA]);
  });

  it('review focus 2: a future fetchedAt or providerObservedAt sorts as "just now" and never throws', () => {
    const future = row({
      itineraryHash: 'future',
      provenance: {
        fetchedAt: '2027-03-01T15:00:00.000Z' as never,
        providerObservedAt: '2027-03-01T16:00:00.000Z' as never,
      },
    });
    const recent = row({
      itineraryHash: 'recent',
      provenance: { fetchedAt: '2027-03-01T09:00:00.000Z' as never },
    });
    let ranked: ReturnType<typeof rankRows> = [];
    expect(() => {
      ranked = rankRows([recent, future], NOW);
    }).not.toThrow();
    expect(ranked.map((r) => r.itineraryHash)).toEqual(['future', 'recent']);
    const age = effectiveAge(future.provenance, NOW);
    expect(age).toEqual({ kind: 'observed', fetchedHours: 0, observedHours: 0 });
    expect(formatAgeCompact(age)).toBe('just now · obs just now');
  });
});

describe('sortRows (spec §6.5 sort keys)', () => {
  const a = row({
    itineraryHash: 'a',
    pricePence: 40_000,
    totalMinutes: 900,
    stopsOut: 1,
    stopsIn: 1,
    adjustedPence: 45_000,
    cell: { departureDate: '2027-03-15' as never, returnDate: '2027-03-25' as never, nights: 10 },
  });
  const b = row({
    itineraryHash: 'b',
    pricePence: 38_000,
    totalMinutes: 840,
    stopsOut: 0,
    stopsIn: 0,
    adjustedPence: 47_000,
    cell: { departureDate: '2027-03-14' as never, returnDate: '2027-03-28' as never, nights: 14 },
  });
  const cal = calendarRow({
    pricePence: 39_000,
    cell: { departureDate: '2027-03-16' as never, returnDate: '2027-03-27' as never, nights: 11 },
  });

  it.each<[SortKey, string[], string[]]>([
    ['price', ['b', 'cal', 'a'], ['a', 'cal', 'b']],
    ['totalTime', ['b', 'a', 'cal'], ['a', 'b', 'cal']],
    ['departure', ['b', 'a', 'cal'], ['cal', 'a', 'b']],
    ['return', ['a', 'cal', 'b'], ['b', 'cal', 'a']],
    ['nights', ['a', 'cal', 'b'], ['b', 'cal', 'a']],
    ['stops', ['b', 'a', 'cal'], ['a', 'b', 'cal']],
    ['adjusted', ['a', 'b', 'cal'], ['b', 'a', 'cal']],
  ])('%s asc %j, desc %j; missing keys last both ways', (key, asc, desc) => {
    const name = (r: { itineraryHash: string | null }) => r.itineraryHash ?? 'cal';
    expect(sortRows([a, b, cal], key, 'asc').map(name)).toEqual(asc);
    expect(sortRows([a, b, cal], key, 'desc').map(name)).toEqual(desc);
  });

  it('is stable: equal keys keep the ranked order', () => {
    const x = row({ itineraryHash: 'x' });
    const y = row({ itineraryHash: 'y' });
    expect(sortRows([y, x], 'price', 'asc').map((r) => r.itineraryHash)).toEqual(['y', 'x']);
    const c1 = calendarRow({ pricePence: 1 });
    const c2 = calendarRow({ pricePence: 2 });
    expect(sortRows([c2, c1], 'totalTime', 'desc')).toEqual([c2, c1]); // both lack the key
    expect(sortRows([c1, x], 'totalTime', 'asc')).toEqual([x, c1]); // missing key last, whichever side it is on
    expect(sortRows([x, c1], 'totalTime', 'desc')).toEqual([x, c1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/results/dedupRank.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/results/dedup.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/results/types.ts`:

```ts
import type { z } from 'zod';
import type { resultRowSchema } from '../api-contract/results.js';
import type { Iata } from '../types/ids.js';
import type { ConstraintName, VerdictClass } from '../types/itinerary.js';
import type { ProviderId } from '../types/provenance.js';

/** One `/results` row (spec §6.5, §10): the type of WP0's `resultRowSchema`. */
export type ResultRow = z.infer<typeof resultRowSchema>;

/** Spec §6.5 sort keys: price, total travel time, departure, return, nights, stops, adjusted. */
export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted';

/**
 * Spec §6.5 filters, composed with AND. `verdictClass` absent means "every class except
 * `failed`" (spec §6.9: failed excluded by default, included by filter). `unverified` keeps a row
 * that leaves any of the named constraints unverified.
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
}
```

`packages/core/src/results/dedup.ts`:

```ts
import type { ResultRow } from './types.js';

/**
 * Spec §6.5 dedup: one row per itinerary hash, showing the cheapest *qualifying* offer (any
 * seller); the itinerary's other offers go to `otherOffers` (cheapest first) for the expanded row.
 * Qualifying = not `failed` when the itinerary has any non-failed offer; an itinerary whose every
 * offer failed keeps its cheapest failed offer so the failed filter can still show it. Rows are
 * already in the definition's cabin (WP8 filters on read). Calendar rows (`itineraryHash === null`)
 * pass through unchanged. Input order of first appearance is kept.
 */
export function dedupByItinerary(rows: ResultRow[]): ResultRow[] {
  const groups = new Map<string, ResultRow[]>();
  const out: Array<ResultRow | string> = [];
  for (const row of rows) {
    if (row.itineraryHash === null) {
      out.push(row);
      continue;
    }
    const group = groups.get(row.itineraryHash);
    if (group === undefined) {
      groups.set(row.itineraryHash, [row]);
      out.push(row.itineraryHash);
    } else {
      group.push(row);
    }
  }
  return out.map((entry) => {
    if (typeof entry !== 'string') return entry;
    const group = groups.get(entry) as ResultRow[];
    // why: cheapest first, then seller name, so the pick is deterministic across runs.
    const byPrice = [...group].sort(
      (a, b) => a.pricePence - b.pricePence || (a.seller ?? '').localeCompare(b.seller ?? ''),
    );
    const primary = byPrice.find((r) => r.verdictClass !== 'failed') ?? (byPrice[0] as ResultRow);
    const otherOffers = byPrice
      .filter((r) => r !== primary)
      .map((r) => ({
        seller: r.seller ?? '',
        pricePence: r.pricePence,
        provenance: r.provenance,
        booking: r.booking,
        stale: r.stale,
        ageHours: r.ageHours,
      }));
    return { ...primary, otherOffers };
  });
}
```

`packages/core/src/results/rank.ts`:

```ts
import { compareAges, effectiveAge } from '../labels/age.js';
import { cellKeyString } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
import type { ResultRow, SortKey } from './types.js';

const CLASS_RANK: Readonly<Record<ResultRow['verdictClass'], number>> = {
  verified: 0,
  'partially-verified': 1,
  failed: 2,
  unchecked: 3,
};

function identity(r: ResultRow): string {
  return r.itineraryHash ?? `${r.provenance.providerId}|${cellKeyString(r.cell)}`;
}

/**
 * Spec §6.5 server ranking: verdict class (verified, partially-verified, failed; calendar rows
 * are `unchecked`); within a class, rows seen in the latest search before rows marked
 * `notSeenInLatest` (spec §8.1); then price; ties by effective age through core's `compareAges`
 * (fresher first, unknown age loses to any known age, a future timestamp clamps to "just now":
 * plan review focus 2), then by identity so the order is total and deterministic. Returns a copy.
 */
export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[] {
  return [...rows].sort(
    (a, b) =>
      CLASS_RANK[a.verdictClass] - CLASS_RANK[b.verdictClass] ||
      Number(a.notSeenInLatest !== null) - Number(b.notSeenInLatest !== null) ||
      a.pricePence - b.pricePence ||
      compareAges(effectiveAge(a.provenance, now), effectiveAge(b.provenance, now)) ||
      identity(a).localeCompare(identity(b)),
  );
}

function keyOf(r: ResultRow, key: SortKey): number | string | null {
  switch (key) {
    case 'price':
      return r.pricePence;
    case 'totalTime':
      return r.totalMinutes;
    case 'departure':
      return r.cell.departureDate;
    case 'return':
      return r.cell.returnDate;
    case 'nights':
      return r.cell.nights;
    case 'stops':
      return r.stopsOut === null || r.stopsIn === null ? null : r.stopsOut + r.stopsIn;
    case 'adjusted':
      return r.adjustedPence;
  }
}

/**
 * Spec §6.5 client-side sort over the fetched page; composes with `filterRows` without refetch.
 * Rows lacking the key (calendar rows have no travel time or stops; `adjusted` needs an
 * operator onward cost) sort last in both directions. Stable, so equal keys keep the ranked order.
 */
export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = keyOf(a, key);
    const kb = keyOf(b, key);
    if (ka === null) return kb === null ? 0 : 1;
    if (kb === null) return -1;
    return ka < kb ? -sign : ka > kb ? sign : 0;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/results/dedupRank.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 17 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: result dedup, ranking with clamped ages, client-side sort (spec §6.5)"
```

### Task 2.8: Results: filters, travel-time bands, search links

**Files:**
- Create: `packages/core/src/results/filter.ts`, `packages/core/src/results/rowKey.ts`, `packages/core/src/results/band.ts`, `packages/core/src/results/searchLink.ts`
- Test: `packages/core/test/results/filterBandLink.test.ts`

**Interfaces:**
- Consumes: Task 2.7 types and helpers; `validateVendorUrl`, `LINK_ALLOWLIST` (Task 2.4, test only); `CellKey`
- Produces: `filterRows(rows, f)`, `resultRowKey(row)`, `bandCheapest(rows, bandHours): Set<string>` of `resultRowKey`s, `SEARCH_LINK_LABEL`, `searchLinkFor`

- [ ] **Step 1: Write the failing test**

`packages/core/test/results/filterBandLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LINK_ALLOWLIST, validateVendorUrl } from '../../src/normalise/vendorUrl.js';
import { bandCheapest } from '../../src/results/band.js';
import { filterRows } from '../../src/results/filter.js';
import { resultRowKey } from '../../src/results/rowKey.js';
import { SEARCH_LINK_LABEL, searchLinkFor } from '../../src/results/searchLink.js';
import type { ResultFilters, ResultRow } from '../../src/results/types.js';
import type { CellKey } from '../../src/types/definition.js';
import { calendarRow, row } from '../helpers/rows.js';

const v = row({
  itineraryHash: 'v',
  carriers: ['VS'],
  stopsOut: 0,
  stopsIn: 0,
  pricePence: 41_200,
  unverified: [],
});
const p = row({
  itineraryHash: 'p',
  verdictClass: 'partially-verified',
  carriers: ['4U', 'VS'],
  stopsOut: 1,
  stopsIn: 0,
  pricePence: 38_000,
  unverified: ['cabinBagRequired'],
  cell: { destination: 'EWR' as never, nights: 10 },
});
const f = row({
  itineraryHash: 'f',
  verdictClass: 'failed',
  carriers: ['BA'],
  stopsOut: 2,
  stopsIn: 2,
  pricePence: 30_000,
  stale: true,
});
const c = calendarRow({ pricePence: 29_000, cell: { nights: 21 } });
const ALL = [v, p, f, c];
const names = (rows: ResultRow[]) => rows.map((r) => r.itineraryHash ?? 'cal');

describe('filterRows (spec §6.5 filters, §6.9 defaults)', () => {
  it.each<[string, ResultFilters, string[]]>([
    ['default: every class except failed', {}, ['v', 'p', 'cal']],
    ['verdict class, failed included by filter', { verdictClass: ['failed'] }, ['f']],
    [
      'unverified-constraint name',
      {
        verdictClass: ['verified', 'partially-verified', 'failed', 'unchecked'],
        unverified: ['cabinBagRequired', 'noSelfTransfer'],
      },
      ['p'],
    ],
    ['provider', { providerId: ['travelpayouts'] }, ['cal']],
    ['stops (calendar rows have no stops and are kept)', { maxStops: 0 }, ['v', 'cal']],
    ['carriers: any carrier on the row matches (calendar rows kept)', { carriers: ['4U'] }, ['p', 'cal']],
    ['destination', { destination: ['EWR' as never] }, ['p']],
    ['max price', { maxPricePence: 40_000 }, ['p', 'cal']],
    ['nights range', { nights: { min: 11, max: 20 } }, ['v']],
    ['stale shown unless hidden', { verdictClass: ['failed'], hideStale: true }, []],
    ['stale shown by default', { verdictClass: ['failed'], hideStale: false }, ['f']],
    ['filters compose with AND', { maxPricePence: 40_000, destination: ['JFK' as never] }, ['cal']],
  ])('%s', (_label, filters, expected) => {
    expect(names(filterRows(ALL, filters))).toEqual(expected);
  });

  it('a stops filter judges each direction', () => {
    expect(
      names(filterRows([row({ itineraryHash: 'in2', stopsOut: 0, stopsIn: 2 })], { maxStops: 1 })),
    ).toEqual([]);
  });
});

describe('bandCheapest (spec §6.5, 6h bands)', () => {
  it('marks the cheapest row per 6h travel-time band; boundaries at whole multiples of 6h', () => {
    const rows = [
      row({ itineraryHash: 'b0', totalMinutes: 359, pricePence: 40_000 }), // 5h59 → band 0
      row({ itineraryHash: 'b1a', totalMinutes: 360, pricePence: 38_000 }), // 6h00 → band 1
      row({ itineraryHash: 'b1b', totalMinutes: 719, pricePence: 39_000 }), // 11h59 → band 1
      row({ itineraryHash: 'b2', totalMinutes: 720, pricePence: 50_000 }), // 12h00 → band 2
      row({ itineraryHash: 'b2tie', totalMinutes: 800, pricePence: 50_000 }), // tie: first wins
      calendarRow({ pricePence: 1 }), // no travel time: never marked
    ];
    const marked = bandCheapest(rows, 6);
    expect(marked).toBeInstanceOf(Set);
    expect([...marked]).toEqual(['b0', 'b1a', 'b2']);
  });

  it.each([0, -6, 1.5])('rejects band width %s', (h) => {
    expect(() => bandCheapest([v], h)).toThrow(RangeError);
  });
});

describe('resultRowKey (plan contract)', () => {
  it('is the itinerary hash, or calendar:<calendarPriceId> for a calendar row', () => {
    expect(resultRowKey(row({ itineraryHash: 'h9' }))).toBe('h9');
    expect(resultRowKey(calendarRow({ calendarPriceId: 42 }))).toBe('calendar:42');
  });
});

describe('searchLinkFor (spec §6.9)', () => {
  const cell = {
    origin: 'LHR',
    destination: 'JFK',
    departureDate: '2027-03-14',
    returnDate: '2027-03-28',
  } as CellKey;

  it('Travelpayouts rows link to an Aviasales search with airports, dates, cabin and one adult', () => {
    const link = searchLinkFor('travelpayouts', cell, 'economy');
    const u = new URL(link.url);
    expect(u.hostname).toBe('search.aviasales.com');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      origin_iata: 'LHR',
      destination_iata: 'JFK',
      depart_date: '2027-03-14',
      return_date: '2027-03-28',
      adults: '1',
      children: '0',
      infants: '0',
      trip_class: '0',
    });
    expect(new URL(searchLinkFor('travelpayouts', cell, 'business').url).searchParams.get('trip_class')).toBe(
      '1',
    );
  });

  it('SearchApi and fixture rows link to a Google Flights search', () => {
    for (const id of ['searchapi', 'fixture'] as const) {
      const u = new URL(searchLinkFor(id, cell, 'premium_economy').url);
      expect(u.hostname).toBe('www.google.com');
      expect(u.searchParams.get('q')).toBe(
        'Flights from LHR to JFK on 2027-03-14 through 2027-03-28 premium economy 1 adult',
      );
      expect(u.searchParams.get('curr')).toBe('GBP');
    }
  });

  it('every link carries the label and passes the vendor-link rule for its provider', () => {
    for (const cabin of ['economy', 'premium_economy', 'business', 'first'] as const) {
      const tp = searchLinkFor('travelpayouts', cell, cabin);
      const sa = searchLinkFor('searchapi', cell, cabin);
      expect(tp.label).toBe('search link, not a fare link');
      expect(sa.label).toBe(SEARCH_LINK_LABEL);
      expect(validateVendorUrl(tp.url, LINK_ALLOWLIST.travelpayouts)).toEqual({
        kind: 'get',
        url: tp.url,
        host: tp.host,
      });
      expect(validateVendorUrl(sa.url, LINK_ALLOWLIST.searchapi)).toEqual({
        kind: 'get',
        url: sa.url,
        host: sa.host,
      });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/results/filterBandLink.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/results/band.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/results/filter.ts`:

```ts
import type { ResultFilters, ResultRow } from './types.js';

const DEFAULT_CLASSES: Array<ResultRow['verdictClass']> = ['verified', 'partially-verified', 'unchecked'];

/**
 * Spec §6.5 filters, composed with AND: verdict class, unverified-constraint name, provider,
 * stops, carriers, destination, max price, nights range, stale. Stale rows are kept unless
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
    if (f.hideStale === true && r.stale) return false;
    return true;
  });
}
```

`packages/core/src/results/rowKey.ts`:

```ts
import type { ResultRow } from './types.js';

/**
 * The stable key of a results row (plan contract): its `itineraryHash`, or
 * `calendar:${calendarPriceId}` for a calendar-basis row. The web's `?row=` parameter, email links
 * (`DigestItem.rowKey`) and `bandCheapest` all use it.
 */
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string {
  return row.itineraryHash ?? `calendar:${row.calendarPriceId}`;
}
```

`packages/core/src/results/band.ts`:

```ts
import { resultRowKey } from './rowKey.js';
import type { ResultRow } from './types.js';

/**
 * Spec §6.5, §11: the cheapest row in each travel-time band of `bandHours` (6 in the UI):
 * band = floor(totalMinutes / (bandHours × 60)), so 5h59 is band 0 and 6h00 band 1. Returns the
 * set of marked `resultRowKey`s. Rows without a travel time (calendar basis) are never marked.
 * Equal prices: the first row in input order wins.
 */
export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string> {
  if (!Number.isInteger(bandHours) || bandHours <= 0) {
    throw new RangeError(`band hours must be a positive integer: ${bandHours}`);
  }
  const best = new Map<number, ResultRow>();
  for (const r of rows) {
    if (r.totalMinutes === null) continue;
    const band = Math.floor(r.totalMinutes / (bandHours * 60));
    const current = best.get(band);
    if (current === undefined || r.pricePence < current.pricePence) best.set(band, r);
  }
  return new Set([...best.values()].map(resultRowKey));
}
```

`packages/core/src/results/searchLink.ts`:

```ts
import type { CellKey } from '../types/definition.js';
import type { Cabin, ProviderId } from '../types/provenance.js';

/** The one label every search link carries (spec §6.9). */
export const SEARCH_LINK_LABEL = 'search link, not a fare link';

// why: Aviasales `trip_class` is 0 economy, 1 business, 2 first (Travelpayouts search-form
// documentation); it has no premium economy, and Travelpayouts is economy-only anyway (spec §2).
const AVIASALES_CLASS: Readonly<Record<Cabin, string>> = {
  economy: '0',
  premium_economy: '0',
  business: '1',
  first: '2',
};
const GOOGLE_CABIN: Readonly<Record<Cabin, string>> = {
  economy: 'economy',
  premium_economy: 'premium economy',
  business: 'business class',
  first: 'first class',
};

/**
 * Spec §6.9: a labelled search link for a row whose booking is `none`, prefilling airports,
 * dates, cabin and one adult: an Aviasales search for Travelpayouts rows, a Google Flights
 * search for SearchApi rows (and fixture rows, which have no vendor of their own). Both hosts sit
 * inside `LINK_ALLOWLIST` (a test passes every generated link through `validateVendorUrl`).
 */
export function searchLinkFor(
  providerId: ProviderId,
  cell: CellKey,
  cabin: Cabin,
): { url: string; host: string; label: string } {
  let url: URL;
  if (providerId === 'travelpayouts') {
    url = new URL('https://search.aviasales.com/flights/');
    url.search = new URLSearchParams({
      origin_iata: cell.origin,
      destination_iata: cell.destination,
      depart_date: cell.departureDate,
      return_date: cell.returnDate,
      adults: '1',
      children: '0',
      infants: '0',
      trip_class: AVIASALES_CLASS[cabin],
    }).toString();
  } else {
    url = new URL('https://www.google.com/travel/flights');
    url.search = new URLSearchParams({
      q: `Flights from ${cell.origin} to ${cell.destination} on ${cell.departureDate} through ${cell.returnDate} ${GOOGLE_CABIN[cabin]} 1 adult`,
      hl: 'en',
      curr: 'GBP',
    }).toString();
  }
  return { url: url.href, host: url.hostname, label: SEARCH_LINK_LABEL };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/results/filterBandLink.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 21 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: result filters, row keys, 6h bands and labelled search links (spec §6.5, §6.9)"
```

### Task 2.9: Alert identity, dedup key and cooldown suppression

**Files:**
- Create: `packages/core/src/alerts/format.ts`, `packages/core/src/alerts/dedup.ts`
- Test: `packages/core/test/helpers/alerts.ts`, `packages/core/test/alerts/dedup.test.ts`

**Interfaces:**
- Consumes: `effectiveAge` (labels), `cellKeyString`, `AlertRule`, `AlertCandidate`, `Firing`, `PriorFiring` (WP0 `types/alerts.ts`), `normaliseOffer` (Task 2.5, test helper)
- Produces: `identityKey`, `dedupKey`, `isSuppressed`; module-internal `hoursSince`, `priceOf`, `formatPence`

Elapsed hours are whole hours from core's `effectiveAge` (floored, clamped at 0), the same figure the email shows. So 335 h is inside a 336 h cooldown and 336 h is outside. A firing stamped in the future reads as 0 h. `isSuppressed` returns the reason text WP11 stores on a suppressed `alert_events` row.

- [ ] **Step 1: Write the failing test**

`packages/core/test/helpers/alerts.ts`:

```ts
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import type { AlertRule, CalendarCandidate, PriorFiring, VerifiedCandidate } from '../../src/types/alerts.js';
import type { Cell } from '../../src/types/definition.js';
import type { IsoDateTime } from '../../src/types/ids.js';
import type { Observation } from '../../src/types/itinerary.js';
import type { Cabin, Provenance, ProviderId } from '../../src/types/provenance.js';
import { cellOf, deps, offer } from './offers.js';

export const NOW = '2027-03-01T12:00:00.000Z' as IsoDateTime;
/** `evaluateAlertRules`' context (spelled out so this helper compiles before Task 2.10 exists). */
export const CTX: {
  now: IsoDateTime;
  executionId: string;
  cabin: Cabin;
  discoveryRefreshHours: Partial<Record<ProviderId, number>>;
} = {
  now: NOW,
  executionId: 'ex-2',
  cabin: 'economy',
  discoveryRefreshHours: {},
};

/** ISO instant `h` hours before NOW (negative = in the future). */
export const hoursAgo = (h: number): IsoDateTime =>
  new Date(Date.parse(NOW) - h * 3_600_000).toISOString() as IsoDateTime;

export function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    definitionId: 'd1',
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'verified',
    requireAllVerified: true,
    cooldownHours: 336,
    enabled: true,
    ...over,
  };
}

export function cell(day = 14, nights = 14): Cell {
  const dep = `2027-03-${String(day).padStart(2, '0')}`;
  const ret = new Date(Date.parse(dep) + nights * 86_400_000).toISOString().slice(0, 10);
  return { origin: 'LHR', destination: 'JFK', departureDate: dep, returnDate: ret, nights } as Cell;
}

const verifiedProv: Provenance = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: hoursAgo(5),
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const calendarProv: Provenance = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: hoursAgo(2),
  maxAgeHours: 48,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};

/** The worked-example itinerary from `offers.ts`, normalised once (LHR→JFK 14–28 Mar 2027). */
const NORMALISED = (() => {
  const raw = offer();
  const r = normaliseOffer(raw, cellOf(raw), deps());
  if (!r.ok) throw r.error;
  return r;
})();

type VOver = Partial<Omit<VerifiedCandidate, 'observation'>> & {
  observation?: Partial<Omit<Observation, 'provenance'>> & { provenance?: Partial<Provenance> };
  hash?: string;
};

export function verified(over: VOver = {}): VerifiedCandidate {
  const { observation, hash, ...rest } = over;
  const { provenance, ...obs } = observation ?? {};
  return {
    basis: 'verified',
    observation: {
      ...NORMALISED.observation,
      id: 1,
      offerId: 1,
      executionId: 'ex-2',
      suppliedFields: ['segments', 'segmentTimes', 'price', 'seller'],
      partialExpansion: false,
      ...obs,
      provenance: { ...verifiedProv, ...provenance },
    },
    itinerary: { ...NORMALISED.itinerary, hash: hash ?? 'h1' },
    verdictClass: 'verified',
    unverified: [],
    seller: 'Virgin Atlantic',
    previous: null,
    ...rest,
  };
}

type COver = Partial<Omit<CalendarCandidate, 'provenance'>> & { provenance?: Partial<Provenance> };

export function calendar(over: COver = {}): CalendarCandidate {
  const { provenance, ...rest } = over;
  return {
    basis: 'calendar',
    calendarPriceId: 1,
    cell: cell(),
    pricePence: 41_200,
    previous: null,
    ...rest,
    provenance: { ...calendarProv, ...provenance },
  };
}

export function prior(over: Partial<PriorFiring> = {}): PriorFiring {
  return { identityKey: 'r1|h1', dedupKey: 'r1|h1|412', pricePence: 41_200, firedAt: hoursAgo(24), ...over };
}
```

`packages/core/test/alerts/dedup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dedupKey, identityKey, isSuppressed } from '../../src/alerts/dedup.js';
import { calendar, cell, hoursAgo, NOW, prior, rule, verified } from '../helpers/alerts.js';

const f = {
  identityKey: 'r1|h1',
  dedupKey: 'r1|h1|412',
  candidate: verified({ observation: { pricePence: 41_200 } }),
};

describe('identityKey (plan contract formats, spec §6.8)', () => {
  it('verified is ruleId|itineraryHash; calendar is ruleId|providerId|cabin|cellKeyString', () => {
    expect(identityKey(rule(), verified())).toBe('r1|h1');
    expect(identityKey(rule({ basis: 'calendar' }), calendar({ cell: cell(15) }))).toBe(
      'r1|travelpayouts|economy|LHR|JFK|2027-03-15|2027-03-29',
    );
  });
});

describe('dedupKey (spec §6.8)', () => {
  it('is identity + floor(pricePence / 100)', () => {
    expect(dedupKey('r1|h1', 41_200)).toBe('r1|h1|412');
    expect(dedupKey('r1|h1', 41_299)).toBe('r1|h1|412');
    expect(dedupKey('r1|h1', 41_300)).toBe('r1|h1|413');
    expect(dedupKey('r1|h1', 99)).toBe('r1|h1|0');
  });
});

describe('isSuppressed (spec §6.8 cooldown, default 336 h)', () => {
  it('same dedup key within the cooldown is suppressed, with a reason; at the cooldown it is not', () => {
    expect(isSuppressed(f, [prior({ firedAt: hoursAgo(335) })], 336, NOW)).toEqual({
      suppressed: true,
      reason: 'same price band alerted 335h ago (cooldown 336h)',
    });
    expect(isSuppressed(f, [prior({ firedAt: hoursAgo(336) })], 336, NOW)).toEqual({
      suppressed: false,
      reason: null,
    });
  });

  it('same identity at an equal or lower price within the cooldown is suppressed', () => {
    const higher = {
      ...f,
      dedupKey: 'r1|h1|415',
      candidate: verified({ observation: { pricePence: 41_500 } }),
    };
    expect(isSuppressed(higher, [prior({ pricePence: 41_200 })], 336, NOW)).toEqual({
      suppressed: true,
      reason: 'alerted at £412 24h ago, not above this price (cooldown 336h)',
    });
    expect(isSuppressed(f, [prior({ dedupKey: 'other', pricePence: 41_200 })], 336, NOW).suppressed).toBe(
      true,
    );
  });

  it('a lower price than the earlier firing (new pound bucket) fires again; other identities do not count', () => {
    const lower = {
      ...f,
      dedupKey: 'r1|h1|398',
      candidate: verified({ observation: { pricePence: 39_800 } }),
    };
    expect(isSuppressed(lower, [prior()], 336, NOW).suppressed).toBe(false);
    expect(
      isSuppressed(f, [prior({ identityKey: 'r1|h9', dedupKey: 'r1|h9|412' })], 336, NOW).suppressed,
    ).toBe(false);
  });

  it('calendar candidates are priced from the candidate itself', () => {
    const c = { identityKey: 'k', dedupKey: 'k|300', candidate: calendar({ pricePence: 30_000 }) };
    expect(
      isSuppressed(c, [prior({ identityKey: 'k', dedupKey: 'x', pricePence: 30_000 })], 336, NOW).suppressed,
    ).toBe(true);
  });

  it('review focus 2: a firing stamped in the future reads as 0 h old (inside the cooldown) without throwing', () => {
    expect(isSuppressed(f, [prior({ firedAt: hoursAgo(-3) })], 336, NOW)).toEqual({
      suppressed: true,
      reason: 'same price band alerted 0h ago (cooldown 336h)',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/alerts/dedup.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/alerts/dedup.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/alerts/format.ts`:

```ts
/** `41200` → `£412`, `41205` → `£412.05`. Integer arithmetic only. */
export function formatPence(pence: number): string {
  const pounds = Math.floor(pence / 100);
  const rest = pence % 100;
  return rest === 0 ? `£${pounds}` : `£${pounds}.${String(rest).padStart(2, '0')}`;
}
```

`packages/core/src/alerts/dedup.ts`:

```ts
import { effectiveAge } from '../labels/age.js';
import type { AlertCandidate, AlertRule, Firing, PriorFiring } from '../types/alerts.js';
import { cellKeyString } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';
import { formatPence } from './format.js';

/** Whole hours from `at` to `now`, clamped at 0 through core's `effectiveAge` (plan review focus 2). */
export function hoursSince(at: IsoDateTime, now: IsoDateTime): number {
  return effectiveAge({ fetchedAt: at, maxAgeHours: 'unknown' }, now).fetchedHours;
}

/** The candidate's price and provenance, whichever basis it is on. */
export function priceOf(c: AlertCandidate): { pricePence: number; provenance: Provenance } {
  return c.basis === 'verified'
    ? { pricePence: c.observation.pricePence, provenance: c.observation.provenance }
    : { pricePence: c.pricePence, provenance: c.provenance };
}

/**
 * Spec §6.8 identity, in the plan's pinned formats: verified `${ruleId}|${itineraryHash}`;
 * calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`.
 */
export function identityKey(rule: AlertRule, c: AlertCandidate): string {
  if (c.basis === 'verified') return `${rule.id}|${c.itinerary.hash}`;
  return `${rule.id}|${c.provenance.providerId}|${c.provenance.cabin}|${cellKeyString(c.cell)}`;
}

/** Spec §6.8: `dedupKey = identity + floor(pricePence / 100)` (whole pounds). */
export function dedupKey(identityKey: string, pricePence: number): string {
  return `${identityKey}|${Math.floor(pricePence / 100)}`;
}

/**
 * Spec §6.8 cooldown. `prior` is this rule's *sent* firings (the engine's query excludes failed
 * and suppressed events, so a failed send is retried next run). Suppressed when, within
 * `cooldownHours` before `now`, a prior firing had the same dedup key, or the same identity
 * fired at an equal or lower price. A prior firing stamped in the future reads as 0 h old.
 */
export function isSuppressed(
  f: Pick<Firing, 'identityKey' | 'dedupKey' | 'candidate'>,
  prior: PriorFiring[],
  cooldownHours: number,
  now: IsoDateTime,
): { suppressed: boolean; reason: string | null } {
  const price = priceOf(f.candidate).pricePence;
  for (const p of prior) {
    const age = hoursSince(p.firedAt, now);
    if (age >= cooldownHours) continue;
    if (p.dedupKey === f.dedupKey) {
      return { suppressed: true, reason: `same price band alerted ${age}h ago (cooldown ${cooldownHours}h)` };
    }
    if (p.identityKey === f.identityKey && p.pricePence <= price) {
      return {
        suppressed: true,
        reason: `alerted at ${formatPence(p.pricePence)} ${age}h ago, not above this price (cooldown ${cooldownHours}h)`,
      };
    }
  }
  return { suppressed: false, reason: null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/alerts/dedup.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 7 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: alert identityKey, dedupKey and cooldown suppression with clamped ages (spec §6.8)"
```

### Task 2.10: Alert evaluation on both bases

**Files:**
- Create: `packages/core/src/alerts/evaluate.ts`
- Test: `packages/core/test/alerts/evaluate.test.ts`

**Interfaces:**
- Consumes: Task 2.9; `AlertRule`, `AlertCandidate`, `Firing`, `PriorFiring`
- Produces: `evaluateAlertRules(rules, candidates, prior, ctx)`, type `AlertEvalContext`; module-internal `need`

Decisions this task encodes, all from spec §6.8:

- The sparse-cache window is inclusive. A drop compares when the previous price was fetched **≤ 2 × `ctx.discoveryRefreshHours[providerId]`** whole hours before this one (168 per provider when absent, spec §7). With refresh 84 h, 167 h and 168 h compare and 169 h does not. `maxAgeHours` 168 on the row is deliberately present, to show that the provider's age bound does not enter the rule.
- A calendar candidate without a usable previous price is a `Firing` with `isNew: true`. It never fires a drop and is never suppressed, but an absolute rule still fires on it with `isNew: false`.
- A verified candidate without a previous observation never fires a drop.
- One firing per (rule, identity): the cheapest eligible candidate. Verified eligibility is checked here: same execution, definition cabin, class `verified`, or `partially-verified` when `requireAllVerified` is false. Calendar candidates carry no execution id, so "fetched by this execution, not reused" is the engine's query (WP11). Synthetic and other-cabin candidates are refused on both bases.
- Every firing carries `suppressed`: `{ reason }` from `isSuppressed` against `prior`, or null. Suppressed firings are returned so the runner records them with status `suppressed`. `buildDigest` leaves them out.

- [ ] **Step 1: Write the failing test**

`packages/core/test/alerts/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateAlertRules } from '../../src/alerts/evaluate.js';
import type { AlertCandidate, AlertRule, PriorFiring } from '../../src/types/alerts.js';
import { CTX, calendar, cell, hoursAgo, prior, rule, verified } from '../helpers/alerts.js';

const run = (r: AlertRule[], c: AlertCandidate[], p: PriorFiring[] = [], ctx = CTX) =>
  evaluateAlertRules(r, c, p, ctx);
const prices = (fs: ReturnType<typeof run>) =>
  fs.map((f) =>
    f.candidate.basis === 'verified' ? f.candidate.observation.pricePence : f.candidate.pricePence,
  );

describe('evaluateAlertRules, verified basis (spec §6.8)', () => {
  it('identity is ruleId|itineraryHash; an absolute rule fires at or below the threshold', () => {
    const [f] = run([rule()], [verified({ observation: { pricePence: 45_000 } })]);
    expect(f).toMatchObject({
      identityKey: 'r1|h1',
      dedupKey: 'r1|h1|450',
      isNew: false,
      reason: '£450 is at or below the £450 threshold',
    });
    expect(f?.rule.id).toBe('r1');
    expect(run([rule()], [verified({ observation: { pricePence: 45_001 } })])).toEqual([]);
  });

  it('partially-verified candidates count only when requireAllVerified is false', () => {
    const partial = verified({ verdictClass: 'partially-verified', unverified: ['cabin'] });
    expect(run([rule({ requireAllVerified: true })], [partial])).toEqual([]);
    expect(run([rule({ requireAllVerified: false })], [partial])).toHaveLength(1);
  });

  it('failed candidates, other executions, other cabins and synthetic rows never fire', () => {
    expect(
      run(
        [rule({ requireAllVerified: false })],
        [
          verified({ verdictClass: 'failed' }),
          verified({ observation: { executionId: 'ex-1' } }),
          verified({ observation: { provenance: { cabin: 'business' } } }),
          verified({ observation: { provenance: { providerId: 'fixture', sourceKind: 'synthetic' } } }),
        ],
      ),
    ).toEqual([]);
  });

  it('one firing per identity: the cheapest offer of the itinerary', () => {
    const out = run(
      [rule()],
      [
        verified({ observation: { offerId: 2, pricePence: 43_000 } }),
        verified({ observation: { offerId: 1, pricePence: 41_200 } }),
        verified({ hash: 'h2', observation: { pricePence: 44_000 } }),
      ],
    );
    expect(out.map((f) => f.identityKey)).toEqual(['r1|h1', 'r1|h2']);
    expect(prices(out)).toEqual([41_200, 44_000]);
  });

  it('drops compare the latest observation of an offer with its previous one (dropAbs and dropPct)', () => {
    const c = verified({
      observation: { pricePence: 40_500 },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(200) },
    });
    expect(run([rule({ type: 'dropAbs', thresholdPence: 4_500 })], [c])[0]?.reason).toBe(
      'down £45 (10%) from £450',
    );
    expect(run([rule({ type: 'dropAbs', thresholdPence: 4_501 })], [c])).toEqual([]);
    expect(run([rule({ type: 'dropPct', thresholdPence: null, pct: 10 })], [c])).toHaveLength(1);
    const short = verified({
      observation: { pricePence: 40_501 },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(1) },
    });
    expect(run([rule({ type: 'dropPct', thresholdPence: null, pct: 10 })], [short])).toEqual([]);
  });

  it('no previous observation, or a price that did not fall, never fires a drop', () => {
    expect(run([rule({ type: 'dropAbs', thresholdPence: 1 })], [verified()])).toEqual([]);
    const same = verified({ previous: { pricePence: 41_200, fetchedAt: hoursAgo(1) } });
    expect(run([rule({ type: 'dropPct', thresholdPence: null, pct: 0 })], [same])).toEqual([]);
  });

  it('cooldown: a firing suppressed by prior is returned with its reason; without prior, suppressed is null', () => {
    expect(run([rule()], [verified()], [prior()])[0]?.suppressed).toEqual({
      reason: 'same price band alerted 24h ago (cooldown 336h)',
    });
    expect(run([rule()], [verified()], [])[0]?.suppressed).toBeNull();
  });

  it('disabled rules are skipped; a rule missing its threshold is a caller bug', () => {
    expect(run([rule({ enabled: false })], [verified()])).toEqual([]);
    expect(() => run([rule({ thresholdPence: null })], [verified()])).toThrow(RangeError);
    const dropping = verified({ previous: { pricePence: 50_000, fetchedAt: hoursAgo(1) } });
    expect(() => run([rule({ type: 'dropPct', pct: null })], [dropping])).toThrow(RangeError);
  });
});

describe('evaluateAlertRules, calendar basis (spec §6.8)', () => {
  const cal = rule({ basis: 'calendar', requireAllVerified: null });
  const drop = rule({ basis: 'calendar', type: 'dropAbs', thresholdPence: 1_000, requireAllVerified: null });

  it('identity is ruleId|providerId|cabin|cellKey; providers and cells are separate identities', () => {
    const out = run(
      [cal],
      [
        calendar(),
        calendar({ provenance: { providerId: 'searchapi', sourceKind: 'scraped-aggregate' } }),
        calendar({ cell: cell(15) }),
      ],
    );
    expect(out.map((f) => f.identityKey)).toEqual([
      'r1|travelpayouts|economy|LHR|JFK|2027-03-14|2027-03-28',
      'r1|searchapi|economy|LHR|JFK|2027-03-14|2027-03-28',
      'r1|travelpayouts|economy|LHR|JFK|2027-03-15|2027-03-29',
    ]);
  });

  it('other-cabin and synthetic calendar rows are refused', () => {
    expect(
      run(
        [cal],
        [
          calendar({ provenance: { cabin: 'business' } }),
          calendar({ provenance: { providerId: 'fixture', sourceKind: 'synthetic' } }),
        ],
      ),
    ).toEqual([]);
  });

  // Sparse-cache drop rule: discoveryRefreshHours 84, so the window is 2 × 84 = 168 h; maxAgeHours 168
  // on the row shows the provider's age bound does not enter the comparison.
  it.each([
    [167, false],
    [168, false],
    [169, true],
  ] as const)('previous fetched %i h before this fetch → isNew %s', (gap, isNew) => {
    const fetchedAt = hoursAgo(2);
    const c = calendar({
      pricePence: 38_000,
      provenance: { fetchedAt, maxAgeHours: 168 },
      previous: {
        pricePence: 45_000,
        fetchedAt: new Date(Date.parse(fetchedAt) - gap * 3_600_000).toISOString() as never,
      },
    });
    const [f] = run([drop], [c], [], { ...CTX, discoveryRefreshHours: { travelpayouts: 84 } });
    expect(f?.isNew).toBe(isNew);
    expect(f?.reason).toBe(
      isNew
        ? 'first price in the comparison window; no earlier price to compare'
        : 'down £70 (15%) from £450',
    );
  });

  it('the window defaults to 2 × 168 h when the definition omits the provider', () => {
    const c = calendar({
      pricePence: 38_000,
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(2 + 336) },
    });
    expect(run([drop], [c])[0]?.isNew).toBe(false);
    const older = calendar({
      pricePence: 38_000,
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(2 + 337) },
    });
    expect(run([drop], [older])[0]?.isNew).toBe(true);
  });

  it('absent-then-present is listed as new and never a drop firing; absolute rules still apply; new is never suppressed', () => {
    const c = calendar({ pricePence: 38_000, previous: null });
    expect(
      run([rule({ basis: 'calendar', type: 'dropPct', thresholdPence: null, pct: 5 })], [c])[0]?.isNew,
    ).toBe(true);
    expect(run([cal], [c])[0]).toMatchObject({
      isNew: false,
      reason: '£380 is at or below the £450 threshold',
    });
    const id = 'r1|travelpayouts|economy|LHR|JFK|2027-03-14|2027-03-28';
    expect(
      run([drop], [c], [prior({ identityKey: id, dedupKey: `${id}|380`, pricePence: 30_000 })])[0],
    ).toMatchObject({ isNew: true, suppressed: null });
  });

  it('review focus 2: a previous price stamped in the future is compared as 0 h old, without throwing', () => {
    const c = calendar({ pricePence: 38_000, previous: { pricePence: 45_000, fetchedAt: hoursAgo(-5) } });
    expect(run([drop], [c])[0]).toMatchObject({ isNew: false, reason: 'down £70 (15%) from £450' });
  });

  it('basis must match: a calendar candidate is not seen by a verified rule and vice versa', () => {
    expect(run([rule()], [calendar()])).toEqual([]);
    expect(run([cal], [verified()])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/alerts/evaluate.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/alerts/evaluate.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/alerts/evaluate.ts`:

```ts
import type { AlertCandidate, AlertRule, Firing, PriorFiring } from '../types/alerts.js';
import type { IsoDateTime } from '../types/ids.js';
import type { Cabin, ProviderId } from '../types/provenance.js';
import { dedupKey, hoursSince, identityKey, isSuppressed, priceOf } from './dedup.js';
import { formatPence } from './format.js';

/** Spec §7: `discoveryRefreshHours` defaults to 168 per provider when the definition omits it. */
const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;

/** Per-run context for `evaluateAlertRules` (plan contract). */
export interface AlertEvalContext {
  now: IsoDateTime;
  executionId: string;
  cabin: Cabin;
  discoveryRefreshHours: Partial<Record<ProviderId, number>>;
}

/** A rule field zod guarantees for this rule type; a missing one is a caller bug, never "0". */
export function need(n: number | null, field: string, rule: AlertRule): number {
  if (n === null) throw new RangeError(`alert rule ${rule.id} (${rule.type}) has no ${field}`);
  return n;
}

function eligible(rule: AlertRule, c: AlertCandidate, ctx: AlertEvalContext): boolean {
  const { provenance } = priceOf(c);
  // why: synthetic rows are refused by alerts outright (spec §5.5, §6.8).
  if (provenance.sourceKind === 'synthetic') return false;
  if (c.basis !== rule.basis || provenance.cabin !== ctx.cabin) return false;
  // why: calendar candidates carry no execution id; the engine's query supplies only prices fetched
  // by this execution and never reused copies (spec §6.8). Verified ones are checked here.
  if (c.basis === 'calendar') return true;
  if (c.observation.executionId !== ctx.executionId) return false;
  return (
    c.verdictClass === 'verified' ||
    (c.verdictClass === 'partially-verified' && rule.requireAllVerified === false)
  );
}

type Judged = { reason: string; isNew: boolean } | null;

function judge(rule: AlertRule, c: AlertCandidate, ctx: AlertEvalContext): Judged {
  const { pricePence, provenance } = priceOf(c);
  if (rule.type === 'absolute') {
    const threshold = need(rule.thresholdPence, 'thresholdPence', rule);
    if (pricePence > threshold) return null;
    return {
      reason: `${formatPence(pricePence)} is at or below the ${formatPence(threshold)} threshold`,
      isNew: false,
    };
  }
  const prev = c.previous;
  // why (sparse-cache rule, spec §6.8): a calendar price compares only with a previous price for the
  // same provider, cabin and cell fetched within 2 × discoveryRefreshHours of this one (inclusive,
  // whole hours); with none, the cell is listed as new and never fires as a drop.
  const window = 2 * (ctx.discoveryRefreshHours[provenance.providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS);
  const usable =
    prev !== null && (c.basis === 'verified' || hoursSince(prev.fetchedAt, provenance.fetchedAt) <= window);
  if (!usable) {
    if (c.basis === 'verified') return null;
    return { reason: 'first price in the comparison window; no earlier price to compare', isNew: true };
  }
  const drop = prev.pricePence - pricePence;
  if (drop <= 0) return null;
  const fires =
    rule.type === 'dropAbs'
      ? drop >= need(rule.thresholdPence, 'thresholdPence', rule)
      : drop * 100 >= need(rule.pct, 'pct', rule) * prev.pricePence;
  if (!fires) return null;
  const pct = Math.floor((drop * 100) / prev.pricePence);
  return { reason: `down ${formatPence(drop)} (${pct}%) from ${formatPence(prev.pricePence)}`, isNew: false };
}

/**
 * Spec §6.8: evaluate every enabled rule against the current execution's candidates. One firing
 * per (rule, identity): the cheapest qualifying candidate. Each firing carries `suppressed`: the
 * cooldown verdict against `prior` (this rule set's sent firings), or null. Suppressed firings are
 * returned so the runner can record them with status `suppressed`; `buildDigest` leaves them out.
 * "New" calendar cells (`isNew`) are never suppressed. Synthetic, other-cabin and other-execution
 * candidates never fire. Output order: rule order, then price ascending.
 */
export function evaluateAlertRules(
  rules: AlertRule[],
  candidates: AlertCandidate[],
  prior: PriorFiring[],
  ctx: AlertEvalContext,
): Firing[] {
  const out: Firing[] = [];
  const byPrice = [...candidates].sort((a, b) => priceOf(a).pricePence - priceOf(b).pricePence);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const seen = new Set<string>();
    for (const c of byPrice) {
      if (!eligible(rule, c, ctx)) continue;
      const id = identityKey(rule, c);
      if (seen.has(id)) continue;
      const j = judge(rule, c, ctx);
      if (j === null) continue;
      seen.add(id);
      const key = dedupKey(id, priceOf(c).pricePence);
      const verdict = j.isNew
        ? { suppressed: false, reason: null }
        : isSuppressed({ identityKey: id, dedupKey: key, candidate: c }, prior, rule.cooldownHours, ctx.now);
      out.push({
        rule,
        candidate: c,
        identityKey: id,
        dedupKey: key,
        ...j,
        suppressed: verdict.reason === null ? null : { reason: verdict.reason },
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/alerts/evaluate.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 17 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: alert evaluation: identities, sparse-cache drop rule, new cells, cooldown (spec §6.8)"
```

### Task 2.11: Alert digests

**Files:**
- Create: `packages/core/src/alerts/digest.ts`
- Test: `packages/core/test/alerts/digest.test.ts`

**Interfaces:**
- Consumes: Tasks 2.8–2.10 (`resultRowKey`, `searchLinkFor`); `AlertDigest`, `DigestItem` (WP0 `ports/notifier.ts`), `Cell`
- Produces: `buildDigest(rule, firings, ctx)` returning a structured `AlertDigest | null`; each `DigestItem` filled with `bookingExpiresAt`, `outbound`, `inbound` and `rowKey` from the candidate

Core returns the structure only. WP11 renders the subject and body (spec §8.3) from `AlertDigest`, including the coverage caveat it passes in as `ctx.coverageCaveat`. Each item carries its own search link from `searchLinkFor` (Aviasales for Travelpayouts, Google Flights otherwise), so the template never builds a URL.

- [ ] **Step 1: Write the failing test**

`packages/core/test/alerts/digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildDigest } from '../../src/alerts/digest.js';
import { evaluateAlertRules } from '../../src/alerts/evaluate.js';
import { formatPence } from '../../src/alerts/format.js';
import { CTX, calendar, cell, hoursAgo, rule, verified } from '../helpers/alerts.js';

const cal = rule({ basis: 'calendar', requireAllVerified: null });
const DCTX = {
  executionId: 'ex-2',
  definitionId: 'd1',
  coverageCaveat: { itinerarySearched: 9, selected: 10, expandTop: 2 },
};

describe('buildDigest (spec §6.8)', () => {
  it('50 qualifying cells → one digest listing the cheapest 10 and counting the other 40', () => {
    const candidates = Array.from({ length: 50 }, (_, i) =>
      calendar({
        calendarPriceId: i + 1,
        cell: cell(1 + (i % 28), 10 + Math.floor(i / 28)),
        pricePence: 30_000 + i * 100,
      }),
    );
    const firings = evaluateAlertRules([cal], candidates, [], CTX);
    expect(firings).toHaveLength(50);
    const d = buildDigest(cal, firings, DCTX);
    expect(d?.items.map((i) => i.pricePence)).toEqual(Array.from({ length: 10 }, (_, i) => 30_000 + i * 100));
    expect(d).toMatchObject({
      ruleId: 'r1',
      definitionId: 'd1',
      executionId: 'ex-2',
      basis: 'calendar',
      restCount: 40,
      newItems: [],
      coverageCaveat: DCTX.coverageCaveat,
      rule: cal,
    });
  });

  it('a verified item carries the itinerary, seller, unverified names, booking and a Google search link', () => {
    const r = rule({ requireAllVerified: false });
    const firings = evaluateAlertRules(
      [r],
      [
        verified({
          verdictClass: 'partially-verified',
          unverified: ['checkedBagRequired'],
          observation: {
            booking: { kind: 'get', url: 'https://www.google.com/b', host: 'www.google.com' },
            bookingExpiresAt: '2027-03-01T13:00:00.000Z' as never,
          },
        }),
      ],
      [],
      CTX,
    );
    const item = buildDigest(r, firings, DCTX)?.items[0];
    expect(item).toMatchObject({
      pricePence: 41_200,
      itineraryHash: 'h1',
      seller: 'Virgin Atlantic',
      verdictClass: 'partially-verified',
      unverified: ['checkedBagRequired'],
      previousPricePence: null,
      previousAgeHours: null,
      isNew: false,
      firingReason: '£412 is at or below the £450 threshold',
      booking: { kind: 'get', host: 'www.google.com' },
      bookingExpiresAt: '2027-03-01T13:00:00.000Z',
      rowKey: 'h1',
      cell: {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-14',
        returnDate: '2027-03-28',
        nights: 14,
      },
    });
    expect(item?.searchLink).toMatchObject({ host: 'www.google.com', label: 'search link, not a fare link' });
    expect(item?.outbound?.map((s) => `${s.marketingCarrier}${s.flightNumber}`)).toEqual(['VS938']);
    expect(item?.inbound?.map((s) => s.departLocal)).toEqual(['2027-03-28T18:30']);
  });

  it('a calendar drop item carries the previous price and its age at this fetch, no booking, an Aviasales search link', () => {
    const drop = rule({
      basis: 'calendar',
      type: 'dropAbs',
      thresholdPence: 1_000,
      requireAllVerified: null,
    });
    const c = calendar({
      pricePence: 38_000,
      provenance: { fetchedAt: hoursAgo(2) },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(50) },
    });
    const item = buildDigest(drop, evaluateAlertRules([drop], [c], [], CTX), DCTX)?.items[0];
    expect(item).toMatchObject({
      verdictClass: 'unchecked',
      itineraryHash: null,
      seller: null,
      unverified: [],
      previousPricePence: 45_000,
      previousAgeHours: 48,
      booking: { kind: 'none' },
      bookingExpiresAt: null,
      outbound: null,
      inbound: null,
      rowKey: 'calendar:1',
    });
    expect(item?.searchLink.host).toBe('search.aviasales.com');
  });

  it('new cells go to newItems; new cells alone send nothing', () => {
    const drop = rule({
      basis: 'calendar',
      type: 'dropAbs',
      thresholdPence: 1_000,
      requireAllVerified: null,
    });
    expect(buildDigest(drop, evaluateAlertRules([drop], [calendar()], [], CTX), DCTX)).toBeNull();
    const mixed = evaluateAlertRules(
      [drop],
      [
        calendar(),
        calendar({
          cell: cell(20),
          pricePence: 30_000,
          previous: { pricePence: 40_000, fetchedAt: hoursAgo(10) },
        }),
      ],
      [],
      CTX,
    );
    const d = buildDigest(drop, mixed, DCTX);
    expect(d?.items.map((i) => i.isNew)).toEqual([false]);
    expect(d?.newItems.map((i) => i.isNew)).toEqual([true]);
    expect(d?.restCount).toBe(0);
  });

  it('only the digest rule’s own firings are used', () => {
    const r2 = rule({ id: 'r2' });
    const firings = evaluateAlertRules([rule(), r2], [verified()], [], CTX);
    expect(firings).toHaveLength(2);
    expect(buildDigest(r2, firings, DCTX)?.items).toHaveLength(1);
  });

  it('suppressed firings are left out of the digest; all suppressed sends nothing', () => {
    const firings = evaluateAlertRules(
      [cal],
      [calendar(), calendar({ cell: cell(16), pricePence: 40_000 })],
      [],
      CTX,
    );
    // firings are price-ascending, so index 0 is the £400 cell
    const muted = firings.map((f, i) => (i === 0 ? { ...f, suppressed: { reason: 'cooldown' } } : f));
    expect(buildDigest(cal, muted, DCTX)?.items.map((i) => i.pricePence)).toEqual([41_200]);
    expect(
      buildDigest(
        cal,
        muted.map((f) => ({ ...f, suppressed: { reason: 'cooldown' } })),
        DCTX,
      ),
    ).toBeNull();
  });

  it('refuses synthetic rows', () => {
    const [f] = evaluateAlertRules([cal], [calendar()], [], CTX);
    const synthetic = {
      ...(f as NonNullable<typeof f>),
      candidate: calendar({ provenance: { providerId: 'fixture', sourceKind: 'synthetic' } }),
    };
    expect(() => buildDigest(cal, [synthetic], DCTX)).toThrow(/synthetic/);
  });

  it('formatPence', () => {
    expect(formatPence(41_200)).toBe('£412');
    expect(formatPence(41_205)).toBe('£412.05');
    expect(formatPence(5)).toBe('£0.05');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/alerts/digest.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/alerts/digest.js' …`.

- [ ] **Step 3: Implement**

`packages/core/src/alerts/digest.ts`:

```ts
import type { AlertDigest, DigestItem } from '../ports/notifier.js';
import { resultRowKey } from '../results/rowKey.js';
import { searchLinkFor } from '../results/searchLink.js';
import type { AlertRule, Firing } from '../types/alerts.js';
import type { Cell } from '../types/definition.js';
import { hoursSince, priceOf } from './dedup.js';

/** Spec §6.8: a digest lists the cheapest 10 firings (and 10 new cells) and counts the rest. */
const DIGEST_TOP = 10;

function cellOf(f: Firing): Cell {
  const c = f.candidate;
  if (c.basis === 'calendar') return c.cell;
  const it = c.itinerary;
  return {
    origin: it.origin,
    destination: it.destination,
    departureDate: it.departureDate,
    returnDate: it.returnDate,
    nights: it.nights,
  };
}

function item(f: Firing): DigestItem {
  const c = f.candidate;
  const { pricePence, provenance } = priceOf(c);
  const cell = cellOf(f);
  const verified = c.basis === 'verified';
  return {
    pricePence,
    provenance,
    cell,
    verdictClass: verified ? c.verdictClass : 'unchecked',
    itineraryHash: verified ? c.itinerary.hash : null,
    seller: verified ? c.seller : null,
    unverified: verified ? c.unverified : [],
    previousPricePence: c.previous === null ? null : c.previous.pricePence,
    // why: the previous price's age at the time of this fetch, the figure the drop rule judged.
    previousAgeHours: c.previous === null ? null : hoursSince(c.previous.fetchedAt, provenance.fetchedAt),
    isNew: f.isNew,
    firingReason: f.reason,
    booking: verified ? c.observation.booking : { kind: 'none' },
    bookingExpiresAt: verified ? c.observation.bookingExpiresAt : null,
    outbound: verified ? c.itinerary.outbound : null,
    inbound: verified ? c.itinerary.inbound : null,
    searchLink: searchLinkFor(provenance.providerId, cell, provenance.cabin),
    rowKey: resultRowKey({
      itineraryHash: verified ? c.itinerary.hash : null,
      calendarPriceId: verified ? null : c.calendarPriceId,
    }),
  };
}

/**
 * Spec §6.8: one structured digest per rule per execution. `items` are the 10 cheapest firings,
 * `newItems` the 10 cheapest new calendar cells (suppressed firings are excluded), `restCount` everything beyond those two lists.
 * WP11 renders subject and body from it (spec §8.3). Returns null when nothing fires: new cells
 * alone send nothing. Throws if any firing carries synthetic provenance (spec §5.5).
 */
export function buildDigest(
  rule: AlertRule,
  firings: Firing[],
  ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] },
): AlertDigest | null {
  // why: suppressed firings are recorded by the runner but never sent (spec §6.8 cooldown).
  const own = firings.filter((f) => f.rule.id === rule.id && f.suppressed === null);
  if (own.some((f) => priceOf(f.candidate).provenance.sourceKind === 'synthetic')) {
    throw new Error('alerts refuse synthetic rows');
  }
  const cheapest = (a: Firing, b: Firing): number =>
    priceOf(a.candidate).pricePence - priceOf(b.candidate).pricePence;
  const fired = own.filter((f) => !f.isNew).sort(cheapest);
  const listed = own.filter((f) => f.isNew).sort(cheapest);
  if (fired.length === 0) return null;
  const items = fired.slice(0, DIGEST_TOP).map(item);
  const newItems = listed.slice(0, DIGEST_TOP).map(item);
  return {
    ruleId: rule.id,
    definitionId: ctx.definitionId,
    executionId: ctx.executionId,
    basis: rule.basis,
    items,
    restCount: fired.length - items.length + (listed.length - newItems.length),
    newItems,
    coverageCaveat: ctx.coverageCaveat,
    rule,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/alerts/digest.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 8 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: structured digest per rule per execution, top 10 and a count of the rest (spec §6.8)"
```

### Task 2.12: Banned words over every emitted string, and the barrel

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/text/emitted.test.ts`, `packages/core/test/wp2-barrel.test.ts`

**Interfaces:**
- Consumes: every WP2 module; `findBannedWords` (WP0)
- Produces: the WP2 export block

Append this block to the end of `packages/core/src/index.ts`. Keep WP0's lines unchanged and leave WP1's block alone if it has merged:

```ts
// --- WP2: normalisation, hashing, constraints, results, money, alerts (spec §5.6 pure parts, §6.2–§6.5, §6.8, §6.9) ---
// why: named exports, not `export *`, so module-internal helpers (wallToInstant, vendorInstant,
// hoursSince, priceOf, need, formatPence) stay private to core and the public surface is exactly the plan's.
export { dedupKey, identityKey, isSuppressed } from './alerts/dedup.js';
export { buildDigest } from './alerts/digest.js';
export { evaluateAlertRules } from './alerts/evaluate.js';
export { evaluateConstraints } from './constraints/evaluate.js';
export { unverifiedNames, verdictClass } from './constraints/verdictClass.js';
export { canonicalCarrier, canonicalFlightNumber } from './normalise/carrier.js';
export { itineraryHash } from './normalise/hashing.js';
export { type NormaliseDeps, normaliseOffer } from './normalise/itinerary.js';
export { departLocal } from './normalise/localTime.js';
export { ECB_CURRENCIES, MINOR_EXPONENT, toGbp } from './normalise/money.js';
export { toIsoDateTime } from './normalise/timestamps.js';
export { LINK_ALLOWLIST, validateVendorUrl } from './normalise/vendorUrl.js';
export { bandCheapest } from './results/band.js';
export { dedupByItinerary } from './results/dedup.js';
export { filterRows } from './results/filter.js';
export { rankRows, sortRows } from './results/rank.js';
export { resultRowKey } from './results/rowKey.js';
export { SEARCH_LINK_LABEL, searchLinkFor } from './results/searchLink.js';
export type { ResultFilters, ResultRow, SortKey } from './results/types.js';
```

Named exports keep the module helpers (`wallToInstant`, `vendorInstant`, `parseVendorTime`, `localMinute`, `requireZone`, `hoursSince`, `priceOf`, `need`, `formatPence`) private. The barrel test pins that. The emitted-strings test passes WP0's `BANNED_WORD_ALLOWLIST`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/text/emitted.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSuppressed } from '../../src/alerts/dedup.js';
import { buildDigest } from '../../src/alerts/digest.js';
import { evaluateAlertRules } from '../../src/alerts/evaluate.js';
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import { searchLinkFor } from '../../src/results/searchLink.js';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '../../src/text/bannedWords.js';
import type { CellKey } from '../../src/types/definition.js';
import { CTX, calendar, cell, hoursAgo, prior, rule, verified } from '../helpers/alerts.js';
import { cellOf, deps, iata, offer, seg } from '../helpers/offers.js';

/** Every user-facing string WP2 emits, gathered from real calls (spec §11 banned words). */
function emitted(): string[] {
  const out: string[] = [];
  const rules = [
    rule(),
    rule({ id: 'r2', requireAllVerified: false, type: 'dropAbs', thresholdPence: 1_000 }),
    rule({ id: 'r3', type: 'dropPct', thresholdPence: null, pct: 5, requireAllVerified: false }),
    rule({ id: 'r4', basis: 'calendar', requireAllVerified: null }),
    rule({ id: 'r5', basis: 'calendar', type: 'dropAbs', thresholdPence: 1_000, requireAllVerified: null }),
  ];
  const candidates = [
    verified({
      observation: { pricePence: 30_000 },
      previous: { pricePence: 40_000, fetchedAt: hoursAgo(30) },
    }),
    calendar({ pricePence: 30_000, previous: { pricePence: 40_000, fetchedAt: hoursAgo(30) } }),
    calendar({ cell: cell(20), previous: null }),
  ];
  const firings = evaluateAlertRules(rules, candidates, [], CTX);
  for (const f of firings) {
    out.push(f.reason, f.suppressed?.reason ?? '');
    const s1 = isSuppressed(
      f,
      [prior({ identityKey: f.identityKey, dedupKey: f.dedupKey })],
      336,
      CTX.now,
    ).reason;
    const s2 = isSuppressed(
      f,
      [prior({ identityKey: f.identityKey, dedupKey: 'x', pricePence: 1 })],
      336,
      CTX.now,
    ).reason;
    out.push(s1 ?? '', s2 ?? '');
  }
  for (const r of rules) {
    const d = buildDigest(r, firings, { executionId: 'ex-2', definitionId: 'd1', coverageCaveat: null });
    if (d !== null)
      out.push(...[...d.items, ...d.newItems].flatMap((i) => [i.firingReason, i.searchLink.label]));
  }
  const c = {
    origin: 'LHR',
    destination: 'JFK',
    departureDate: '2027-03-14',
    returnDate: '2027-03-28',
  } as CellKey;
  for (const id of ['travelpayouts', 'searchapi', 'fixture'] as const)
    out.push(searchLinkFor(id, c, 'economy').label);
  const failures = [
    offer({ inbound: [] }),
    offer({ currency: 'XAU' }),
    offer({ currency: 'USD' }),
    offer({
      outbound: [
        seg({
          marketingCarrier: 'VIR',
          from: iata('LHR'),
          to: iata('JFK'),
          depart: '2027-03-14T10:05',
          arrive: '2027-03-14T13:05',
        }),
      ],
    }),
    offer({
      outbound: [
        seg({ from: iata('LHR'), to: iata('ZZZ'), depart: '2027-03-14T10:05', arrive: '2027-03-14T13:05' }),
      ],
    }),
    offer({
      outbound: [
        seg({ from: iata('LHR'), to: iata('JFK'), depart: '14/03/2027 10:05', arrive: '2027-03-14T13:05' }),
      ],
    }),
  ];
  for (const raw of failures) {
    const r = normaliseOffer(raw, cellOf(raw), deps());
    if (!r.ok) out.push(r.error.message);
  }
  const wrongCell = normaliseOffer(
    offer(),
    { ...cellOf(offer()), returnDate: '2027-03-27' } as CellKey,
    deps(),
  );
  if (!wrongCell.ok) out.push(wrongCell.error.message);
  return out;
}

describe('banned words (spec §11) in every string core emits', () => {
  it('none of them contains a banned word (with the shared allowlist)', () => {
    const strings = emitted();
    expect(strings.filter((s) => s !== '').length).toBeGreaterThan(25);
    for (const s of strings) expect(findBannedWords(s, BANNED_WORD_ALLOWLIST), s).toEqual([]);
  });
});
```

`packages/core/test/wp2-barrel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

// The WP2 public surface: the plan's "Core domain functions (WP2)" block.
const WP2 = [
  'canonicalCarrier',
  'canonicalFlightNumber',
  'departLocal',
  'toIsoDateTime',
  'itineraryHash',
  'MINOR_EXPONENT',
  'ECB_CURRENCIES',
  'toGbp',
  'LINK_ALLOWLIST',
  'SEARCH_LINK_LABEL',
  'validateVendorUrl',
  'searchLinkFor',
  'normaliseOffer',
  'evaluateConstraints',
  'verdictClass',
  'unverifiedNames',
  'dedupByItinerary',
  'rankRows',
  'sortRows',
  'filterRows',
  'bandCheapest',
  'resultRowKey',
  'evaluateAlertRules',
  'identityKey',
  'dedupKey',
  'isSuppressed',
  'buildDigest',
];
const PRIVATE = [
  'wallToInstant',
  'vendorInstant',
  'parseVendorTime',
  'localMinute',
  'requireZone',
  'hoursSince',
  'priceOf',
  'need',
  'formatPence',
];

describe('@gmt/core barrel, WP2 exports', () => {
  it.each(WP2)('exports %s', (name) => {
    expect(core).toHaveProperty(name);
  });
  it.each(PRIVATE)('keeps %s private', (name) => {
    expect(core).not.toHaveProperty(name);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/text/emitted.test.ts test/wp2-barrel.test.ts`
Expected: FAIL, the barrel test fails on `exports canonicalCarrier` and the 26 other WP2 names (the emitted-strings test already passes, because it imports modules directly).

- [ ] **Step 3: Implement**

Append the export block shown above to `packages/core/src/index.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/text/emitted.test.ts test/wp2-barrel.test.ts && pnpm --filter @gmt/core typecheck && pnpm lint`
Expected: PASS, 37 tests; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp02: WP2 barrel exports and the banned-word check over emitted strings (spec §11)"
```

## 9. Pinned review-focus tests

- **Plan Review Focus line 2: a vendor timestamp in the future.** WP0 clamps `effectiveAge` at 0 (Task 0.7). WP2 owns ordering and the alert age comparisons, and every one of them goes through `effectiveAge` and `compareAges`. Ordering is in `rankRows`. The alert comparisons are the sparse-cache window in `evaluate.ts`, the previous-price age in `buildDigest`, and cooldown age in `isSuppressed`, all via `hoursSince`, which wraps `effectiveAge`. Pinned tests:
  - Task 2.7, `test/results/dedupRank.test.ts`, "review focus 2: a future fetchedAt or providerObservedAt sorts as "just now" and never throws". A row fetched 3 h in the future, observed 4 h in the future, ranks ahead of a row fetched 3 h ago, at equal class and price. Its age is `{ kind: 'observed', fetchedHours: 0, observedHours: 0 }` and its compact label is `just now · obs just now`. `rankRows` does not throw.
  - Task 2.10, `test/alerts/evaluate.test.ts`, "review focus 2: a previous price stamped in the future is compared as 0 h old, without throwing". The calendar drop still fires (`isNew: false`, reason `down £70 (15%) from £450`).
  - Task 2.9, `test/alerts/dedup.test.ts`, "review focus 2: a firing stamped in the future reads as 0 h old (inside the cooldown) without throwing".

## 10. Definition of done

Run from the repository root, on the `wp/02-core-normalise-constraints-alerts` branch:

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/core test` | every test passes (WP0's, plus the 267 added here); coverage 100% lines, branches, functions and statements, with no threshold error |
| `TZ=UTC pnpm --filter @gmt/core test`, `TZ=America/Los_Angeles pnpm --filter @gmt/core test`, `TZ=Asia/Tokyo pnpm --filter @gmt/core test` | identical result in each |
| `pnpm --filter @gmt/core mutate` | `hashing.ts`, `money.ts`, `vendorUrl.ts`, `constraints/evaluate.ts` and `alerts/dedup.ts` each at a mutation score ≥ 80% (scratch run: 100 / 94.05 / 95 / 91.70 / 97.87) and the run exits 0. |
| `pnpm lint` | clean |
| `pnpm -r typecheck` | clean |
| `node scripts/check-boundaries.mjs` | exit 0: `@gmt/core` depends only on `zod`, `@noble/hashes` and `@date-fns/tz`, and nothing outside `apps/api/src/bootstrap/` reads `process.env` |

Purity and route checks; each command prints nothing:

```bash
grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/core/src          # airport codes appear only in tests
grep -rnE "process\.env|Math\.random|new Date\(\)" packages/core/src/normalise packages/core/src/constraints packages/core/src/results packages/core/src/alerts   # every instant arrives as an argument
```

## 11. Open questions

None.
