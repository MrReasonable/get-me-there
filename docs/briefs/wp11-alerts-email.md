---
wp: 11
title: alerts runner, digest templates, EmailNotifier, Alerts UI
owner: sonnet
depends_on: [7, 8, 10]
spec_sections: ["§3 (effective age, rev 23)", "§5.2", "§5.3", "§5.5", "§6.2", "§6.8", "§7 (alert_events)", "§8.1", "§8.3", "§11", "§12", "§14", "§9 item 4", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, product-owner, persona-flexible-traveller, security-reviewer]
mutate: {}
status: merged
---

# WP11: alerts runner, digest templates, EmailNotifier, Alerts UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task: failing test, run, minimal code, run, commit. Steps use `- [ ]` checkboxes. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, revision 25: §3, §5.5, §6.8, §7, §8.1, §8.3, §11, §12, §14) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`: "Global Constraints", the Notifier, Alert types, Database, Core domain functions, Engine and Web contracts, and decisions 1–59, especially 10, 14, 21, 24, 25, 27, 30, 36, 37, 44–49, 52, 54–56, 58 and 59) before Task 11.0. Revised on 2026-10-17 after review rounds 1 (51 findings) and 2 (11 findings) against main at `09ed619` (WP0–WP7 merged; decisions 55, 56 and 59 rule on the findings that needed judgment). Every core, db, engine and api code block below was assembled on a scratch worktree of main and replayed task by task (§13 item 1 says what stood in for WP8); the web tasks follow the reviewed WP9 and WP10 briefs, which are not on main yet, and are marked blocked until they merge.

## 1. Goal

Turn the prices an execution wrote into at most one plain-text email per alert rule per stop of the execution, deduplicated across executions and never repeated across passes, never built from synthetic rows or unconfirmed prices, every price labelled with its source, age and marks, every firing persisted before the email goes out; and give the operator an Alerts view that shows each fired fare and its previous price with their provenance, what was suppressed, and why.

## 2. Scope

**In**

- **Core (Task 11.0):** `alertEventPayloadSchema` and `AlertEventPayload` (decision 56: one payload schema the engine writes and the web reads); event statuses `queued | notified | suppressed`; `sourceLabel(provenance)` and `SOURCE_LABELS`, the one copy of the §11 source wording; `ALERT_EMAIL_MAX_PER_HOUR` in config (`Config.alertEmailMaxPerHour`, default 20); `ALERT_EMAIL_TO`/`ALERT_EMAIL_FROM` validated as one mailbox each (`isMailbox`); `APP_BASE_URL` refused with userinfo, a query or a fragment; `smtpPlaintextAllowed`, the one copy of the SMTP_TLS=none rule; the payload's verdict class built from the shared `verdictClassSchema` (decision 59).
- **Db (Task 11.0b):** migration `0002_alert_event_lifecycle` (the status CHECK, old rows mapped); `AlertsRepo.eventsForExecution(ruleId, executionId)` and `AlertsRepo.updateEvents(ids, patch)` (status, and on a successful retry the reason, fire time and digest id, decision 59); `priorFirings` counts `notified` firings only and never a "new" listing; `NotificationsRepo.lastSent(kind, definitionId)`.
- **Engine:**
  - `src/text.ts`: `controlFree` and `stripControl`, the engine's one cleaner (WP7's `cleanLine` is redefined on it).
  - `src/alerts/context.ts`, `pools.ts`, `marks.ts`, `templates.ts`, `runner.ts`: `runAlerts`, the `AlertsStepHook` WP7's engine calls after a pass that completed or paused for a budget cap (decision 25). It gathers candidates per basis (refusing synthetic rows, leaving out unconfirmed prices, measuring a drop against a confirmed previous price only), skips rows an earlier pass of the same execution recorded (a db query, decision 56), evaluates rules (core), reads the marks `DigestItem` does not carry, persists the firings as `queued` events, builds and renders one digest per rule, sends it, and marks the events `notified` — or `suppressed` with "email not configured" when no SMTP is configured, or still `queued` with the failure and whether a retry will come (decision 59). WP7's `AlertsStepHook` gains a third argument, `AlertsPass`, saying whether the pass completed or stopped on a budget cap.
  - `src/notifiers/email.ts`, `src/notifiers/index.ts`: `EmailNotifier` over nodemailer 10 (explicit timeouts, one-mailbox re-check, the outgoing ceiling, scrubbed and URL-stripped error details, codes-only logging) and `buildNotifiers(config, log, clock)`.
  - WP7's `src/notify.ts`: operator messages at most once per kind per definition per London day (decision 56).
- **Api (Task 11.8):** `apps/api/src/bootstrap/engine.ts` `engineFor(ports, log)`, which WP8's `bootApp` calls, so the production wiring has a test.
- **Web (Tasks 11.10, 11.11, blocked until WP9 and WP10 merge):** `apps/web/src/views/Alerts/*`: the rule form, the rules list and the events table (fare and previous price through `PriceCell`, verdict class and unverified constraints in words, reason and threshold text inside `data-quote`), with the alert wrappers in WP9's `api`, `COPY.alertsView`, the `App.tsx` mount, and the guard, catalogue, handler, sweep and source-label edits of §12.

**Out**

- `@gmt/core`, WP2 (merged): `evaluateAlertRules` (eligibility, identity settling, the `isNew` rule, the cooldown and its reasons), `buildDigest`, `identityKey`, `evaluateConstraints`, `verdictClass`, `unverifiedNames`, `searchLinkFor`, `resultRowKey`, `validateVendorUrl`, `formatPence`, `CONSTRAINT_LABELS`, `stripControlChars`, `isTruncated`.
- `@gmt/core`, WP8 (decisions 55, 56, 58, 59): `isStale(provenance, now, thresholdHours)`, the unknown-age wording of `formatAgeFull` ("vendor's cache age unknown") and the exported whole-hour helper `hoursSince`. This WP consumes all three and adds none.
- `@gmt/engine`, WP7 (merged): `createEngine(deps, { alerts })`, `noAlerts`, when the alerts step runs (`execute.ts`), `LogNotifier` and `containsSynthetic`, `renderOperatorMessage`, the "alerts running on calendar basis only" notice, the layer-A harness.
- `apps/api`, WP8: the `/api/alerts` routes and the rest of `bootApp`.
- `apps/web`, WP9 and WP10: the shell, `call`, `PriceCell`, `PriceBoundary`, `format.ts`, `now.tsx`, the copy catalogue and its guards, `renderWithProviders`, the msw server and fixtures.
- WP12: Mailpit, compose and the setup docs (which gain `ALERT_EMAIL_MAX_PER_HOUR`, §13).

## 3. Spec sections and plan decisions

- **§6.8 Alert evaluation.**
  - The rule shape, with `cooldownHours` defaulting to 336; `requireAllVerified` on the verified basis only.
  - **Itinerary-search (verified) basis.** Identity `(ruleId, itineraryHash)`. Candidates are the observations written by the current execution in the definition's cabin, verdicts recomputed against the current definition (§6.2); `partially-verified` counts only when `requireAllVerified` is false. A drop compares an offer's observation with its newest earlier **confirmed** observation (decisions 37, 45; review PA-1).
  - **Calendar basis.** Identity `(ruleId, providerId, cabin, cellKey)`. Candidates are the calendar prices fetched by the current execution in the definition's cabin; reused rows are excluded. A drop compares only with a previous price fetched within 2 × `discoveryRefreshHours` (167, 168 and 169 h tested); an absent-then-present price, or one whose previous price is older, is listed in the "new" section with that previous price and the fetch gap (review PA-9) and is never a drop firing; absolute rules still apply to it.
  - Suppression: the same `dedupKey` fired less than `cooldownHours` ago, or the same identity at a price not at least max(£10, 5%) lower; suppressed firings are recorded with status `suppressed` and their reason. The cooldown counts `notified` events only (decision 59). Synthetic rows are refused. One digest per rule per **stop** of an execution, the top 10 and a count of the rest (decision 55: a paused_budget stop and the later completion may each send one; neither repeats a firing).
- **§7, §8.1; decision 56.** Spec order "persist events → notify digests": every firing and every "new" listing is written as a `queued` event in one transaction before the email is sent, and marked `notified` once every notifier accepted it; a failed send leaves it queued and the next pass of the same execution sends it on the same row. Rows an earlier pass recorded are found by a db query on (rule, execution). **Decision 59:** with no SMTP configured the digest reaches only the log, and its events are recorded `suppressed` ("email not configured"); a queued event's reason says why (send failed, hourly limit, migrated) and whether a retry will come (only a resumed pass of the same execution resends it); a retry that succeeds rewrites the row's reason, fire time and digest id.
- **§3 (rev 23), §8.1; decisions 44, 54, 55, 56.** Staleness is core's `isStale` by effective age: the observed age (never younger than the fetch age, decision 58), else the fetch age plus a known `maxAgeHours`, else the fetch age alone — so a price whose vendor age is unknown is still stale when its fetch age alone exceeds the threshold (`STALE_AFTER_HOURS` on the verified basis; on the calendar basis `CALENDAR_STALE_AFTER_HOURS`, else the provider's refresh plus its declared age). The unknown-age label is core's ("vendor's cache age unknown").
- **§6.2, §3 (rev 21, 22); decisions 27, 37, 45.** An offer whose price the final step did not confirm is never alerted on and never the baseline of a drop; the digest states, as a run fact, how many such fares that pass their other constraints the run found.
- **Decisions 30, 36, 47.** A price from a discovery tile the page cap cut short carries "cheapest of the rows read".
- **§8.1; decision 54.** "Not seen in latest search" marks a verified-basis fare a newer itinerary search of its cell did not see, with that search's instant (never an invented age, review PA-6); "superseded by a later search" cannot arise at alert time (§13 item 3).
- **§8.1; decisions 25, 59.** Only the digest of a pass that stopped on a budget cap says how many cell searches the cap left undone; when that pass's itinerary-search stage never ran it says so and gives the count as a lower bound (review PA-2), never "at least 0". An itinerary search that did not run for another reason (no verification provider registered) reads "itinerary search not run" with no cause (review PA2-1).
- **§8.3 Notifications.** `EmailNotifier` maps `SMTP_TLS` (implicit → TLS from connect, starttls → `requireTLS`, none → core's `smtpPlaintextAllowed` only) with explicit socket timeouts; plain text only; two subject formats; the body with segments or "calendar price, no itinerary", verdicts naming every unverified constraint, a provenance line with the effective age, a re-validated `https` link with host and expiry (for a POST booking the app's results row), the coverage caveat and the rule. A previous price carries '≈' when FX-converted, like the current one (decision 59). Provider strings: every control character, U+2028/U+2029, and the bidi and zero-width format characters are cleaned (review TS-14, sec-007); a seller or carrier is cut at 200 characters. Synthetic refused. Banned words tested over rendered output.
- **§5.2, §5.3; decisions 10, 54.** Booking and search links are re-validated at render against `LINK_ALLOWLIST` and keep their query in email; URLs in event reasons and email error details are stripped; the SMTP password never reaches a log line or a reason.
- **Decision 56.** Operator messages at most once per kind per definition per London day; outgoing email capped at `ALERT_EMAIL_MAX_PER_HOUR` (default 20) per hour, beyond which a message is logged and dropped (a digest's events stay queued, their reason saying whether a retry will come).
- **§11; decisions 36, 44, 46, 49, 52, 55, 56.** The Alerts view: rule form and events list with status and reason; the fare and the previous price each through `PriceCell`; thresholds and reason text, which quote prices, inside `data-quote`; vocabulary from core's `sourceLabel`; "verified" only beside class-verified values; run times in Europe/London; no cast and no suppression comment.
- **§12.** `APP_BASE_URL` makes the results-row link absolute (path prefix kept); unset, the link is relative. `ALERT_EMAIL_MAX_PER_HOUR` is new (§13 item 7).
- **§14.** Engine log lines carry `executionId` and `definitionId`; the EmailNotifier logs nodemailer's error code and SMTP response code only.
- **§9 item 4:** dedup across executions on both bases, digests, synthetic rows refused by alerts and notifiers. **§9 item 6:** banned words over the rendered email and the Alerts view.
- **§1, Global Constraints:** route-agnostic: no airport, city or country in engine or web source; tests use the worked example (London → New York) only.

## 4. Interfaces consumed

Copied from the merged code on main (`09ed619`); where the plan's contract text differs, the code is quoted and §13 says so.

```ts
// @gmt/core — ports/notifier.ts (WP0, as merged after decision 21)
export interface DigestItem { pricePence: number; provenance: Provenance; cell: Cell; verdictClass: VerdictClass | 'unchecked'; itineraryHash: string | null; seller: string | null; unverified: ConstraintName[]; previousPricePence: number | null; fetchGapHours: number | null /* hours between the previous fetch and this one, never an age */; isNew: boolean; firingReason: string; booking: Booking; bookingExpiresAt: IsoDateTime | null; outbound: Segment[] | null; inbound: Segment[] | null; searchLink: { url: string; host: string; label: string } | null; rowKey: string /* resultRowKey */ }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number; newItems: DigestItem[]; newRestCount: number; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }
export interface OperatorMessage { kind: OperatorMessageKind; executionId: string | null; definitionId: string; subject: string; body: string }
export interface Notifier { id: string; send(msg: { kind: 'digest'; digest: AlertDigest; subject: string; body: string } | { kind: 'operator'; message: OperatorMessage }): Promise<{ ok: boolean; detail?: string }> }

// @gmt/core — types/alerts.ts (WP0; AlertEvent.status changed by Task 11.0)
export interface AlertRule { id: string; definitionId: string; type: 'absolute' | 'dropPct' | 'dropAbs'; thresholdPence: number | null; pct: number | null; basis: ResultBasis; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export type VerifiedCandidate = { basis: 'verified'; observation: Observation; itinerary: NormalisedItinerary; verdictClass: VerdictClass; unverified: ConstraintName[]; seller: string; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type CalendarCandidate = { basis: 'calendar'; calendarPriceId: number; fetchedByExecutionId: string; cell: Cell; pricePence: number; provenance: Provenance; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface Firing { rule: AlertRule; candidate: AlertCandidate; identityKey: string; dedupKey: string; reason: string; isNew: boolean; suppressed: { reason: string } | null }
export interface PriorFiring { identityKey: string; dedupKey: string; firedAt: IsoDateTime; pricePence: number }

// @gmt/core — alerts/ (WP2)
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], prior: PriorFiring[], ctx: { now: IsoDateTime; executionId: string; cabin: Cabin; discoveryRefreshHours: Partial<Record<ProviderId, number>> }): Firing[];
//   refuses synthetic and other-execution candidates; settles each identity on its cheapest eligible candidate; an
//   absolute firing is never isNew; a drop rule's candidate with no previous price, or one fetched outside 2 × refresh
//   (whole minutes), is isNew and never suppressed; a prior firing counts while it is less than cooldownHours old.
//   Reasons: "£412 is at or below the £450 threshold", "down £80 (16%) from £500 fetched 7d (168h) earlier",
//   "same price band alerted 7d (168h) ago; cooldown 2w (336h)".
export function identityKey(rule: AlertRule, c: AlertCandidate): string;
export function buildDigest(rule: AlertRule, firings: Firing[], ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] }): AlertDigest | null;
//   drops suppressed firings; isNew firings go to newItems; null when no other firing remains; throws on synthetic
//   provenance; calendar items carry booking { kind: 'none' }; previousPricePence is set only when the reason states it.

// @gmt/core — labels, text, results, constraints, normalise, ids, config (WP0–WP2)
export type EffectiveAge = { kind: 'observed'; fetchedHours: number; observedHours: number } | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number } | { kind: 'unknown'; fetchedHours: number };
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;   // "fetched 2h ago · provider age unknown (≤7d before that)"; bounded 0 → "fetched 5h ago"
export function formatDuration(hours: number): string;    // "just now", "5h", "3d", "2w"
export const TRUNCATED_NOTE = 'cheapest of the rows read'; export function isTruncated(reason: string | null): boolean;
export function stripControlChars(s: string, replacement = ''): string;   // the Unicode Cc set (C0, U+007F, C1); U+2028/U+2029 and format characters left to the caller
export function stripUrlsInText(text: string): string;
export function formatPence(pence: number): string;   // '£412', '£20.50'
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // ConstraintName includes 'priceConfirmed' → 'price not confirmed by the final step'
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;   // itineraryHash, or `calendar:${calendarPriceId}`
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking;
export function evaluateConstraints(it: NormalisedItinerary, obs: ObservationFields & { segmentCabins: Cabin[] | null }, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts;
export function verdictClass(v: Verdicts): VerdictClass; export function unverifiedNames(v: Verdicts): ConstraintName[];
export function cellKeyString(c: CellKey): string; export function daysBetween(a: IsoDate, b: IsoDate): number; export function generateCells(space: ResolvedSpace): Cell[];
export function isoDateTimeOfEpochMs(ms: number): IsoDateTime; export function asIsoDateTime(s: string): IsoDateTime; export function asIsoDate(s: string): IsoDate; export function asIata(s: string): Iata;
export function londonDateOf(instant: IsoDateTime): IsoDate; export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export function parseConfig(env: Record<string, string | undefined>, opts: { realpath: (p: string) => string }): ConfigResult;
export class BudgetExceeded extends Error { constructor(p: { scope: BudgetScopeKind; cap: number; current: number; requested: number; providerId?: ProviderId }) }
export class Secret { constructor(value: string); reveal(): string }
export const BANNED_WORD_ALLOWLIST: readonly string[]; export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
// Config (fields read here): nodeEnv; appBaseUrl: string | null; staleAfterHours; calendarStaleAfterHours: number | null;
//   smtp: { host; port; tls: 'implicit' | 'starttls' | 'none'; user; pass: Secret; to; from } | null

// @gmt/db (WP3)
// Db.transaction<T>(fn: () => T): T (synchronous only)
// ExecutionsRepo: create(input); get(id): Execution | null; activeParent(definitionId): Execution | null; setStatus(id, status, patch?)
// DefinitionsRepo: create(input); get(id): SearchDefinition | null (soft-deleted rows included, with deletedAt); softDelete(id)
// AlertsRepo: rules(definitionId?): AlertRule[]; create(input); events(filter: { ruleId?; definitionId?; limit }): AlertEvent[] (newest first);
//   priorFirings(ruleId, identityKeys: string[], since: IsoDateTime): PriorFiring[]; insertEvent(e: Omit<AlertEvent, 'id'>): number (URLs stripped)
// CalendarPricesRepo: insert(executionId, rows); fetchedBy(executionId): CalendarPriceRow[] (reused excluded);
//   previousFor(definitionId, providerId, cabin, cell, before, notOlderThan): CalendarPriceRow | null; reuseCandidates(…): ReusedCopy[]
// CellsRepo: seed; seedVerification; outcomes(executionId, filter?); selected(executionId); hasVerificationOutcomes(executionId): boolean;
//   setOutcome (not_run / error / skipped only); writeTile; writeVerifiedCell; copyReused
// ItinerariesRepo: upsertItinerary; recordObservation(offer, obs): { offerId; observationId }; writtenBy(executionId): ObservationRow[];
//   previousObservation(offerId, before: IsoDateTime): Observation | null (no suppliedFields filter);
//   latestVerificationOutcomeForCell(definitionId, cell, cabin): CellOutcome | null (newest priced|empty)
// NotificationsRepo: wasSent(kind, executionId, definitionId): boolean; record(kind, executionId, definitionId, status)

// @gmt/providers (WP4)
export function scrubSecrets<T>(value: T, secrets: readonly Secret[]): T;   // throws if a secret survives

// @gmt/engine (WP7, as merged)
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export type AlertsStepHook = (deps: EngineDeps, executionId: string) => Promise<{ digests: number; events: number }>;   // Task 11.1 adds a third argument, `pass: AlertsPass`
export interface EngineOptions { alerts?: AlertsStepHook; providerConcurrency?: Partial<Record<ProviderId, number>> }
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;
export class LogNotifier implements Notifier { readonly id = 'log'; constructor(log: Logger) }
// src/notifiers/log.ts: containsSynthetic(value: unknown): boolean; src/notify.ts: notifyOperator(ctx, kind, p): Promise<boolean>
// src/execute.ts: the hook runs when the pass completed or stopped on a budget cap, before the status write; a rejecting hook is
//   logged ('alerts: step failed') and the pass still finishes. Children run it too.
// src/context.ts buildContext(deps, options); src/orchestrator.ts createOrchestrator(ctx): { start; resume(id, { manual }); … }
// test/support/harness.ts: createHarness(opts?) → { deps, options, clock, repos, fixture, logs, digests: unknown[], notifications,
//   createDefinition(patch?), orch(options?), track(s), waitForSettled(id), runToCompletion(engine, definitionId, opts?),
//   onStageStart(stage, fn), spendLedger(p) }; HOUR, WINDOW, FIXTURE_COST_MICRO_GBP, withVerification()

// apps/api (WP4b)
export interface Ports { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; clock: Clock; log: Logger; secrets: Secret[]; recorder: FixtureRecorder | null; fixtureRoot: string | null }
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; migrationsDir: string }): Ports; export function loadConfigFromEnv(env): Config;
```

**Code that later waves deliver, and what this brief assumes of it** (checked again when wave 7 opens):

1. **WP8, core (decisions 55, 56, 58):** `export function isStale(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime, thresholdHours: number): boolean` — true when the effective age (the observed age but never younger than the fetch age, else fetch age plus a known `maxAgeHours`, else fetch age alone) exceeds the threshold — and `formatAgeFull` for an unknown vendor age reading `fetched 5h ago · vendor's cache age unknown`. This brief's expected strings use that wording.
2. **WP8, core (decision 59):** `export function hoursSince(from: IsoDateTime, now: IsoDateTime): number` from core's barrel — whole hours from `from` to `now`, never negative. WP8 moves it into core and exports it; this brief imports it (Tasks 11.1, 11.2, 11.11) and adds no date helper of its own.
3. **WP8 `bootApp`** (`apps/api/src/bootstrap/app.ts`) builds the engine with `const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });` and the why line "WP11 adds `{ alerts: runAlerts }` to these options". Task 11.8 replaces that statement with a call to `engineFor`.
4. **WP9's web, as WP10 leaves it:** `call(schema, method, path, opts?)`; `api` in `src/api/endpoints.ts` (`import { apiContract as c } from '@gmt/core'`); `src/api/types.ts` request bodies as `z.input`; `COPY` with `loading`, `placeholder` and `fieldError(field, message)`; `COPY.source` and its readers `COPY.source[x.sourceKind]` (Provenance, PriceCell, the Providers view) and `COPY.source[k]` (`src/lib/sources.ts`); `format.ts` with `formatPence`, `parsePoundsToPence` and `formatRunInstant`; `now.tsx` `useNow()`; `PriceCell` (`pricePence`, `provenance: unknown`, `calendar`, `stale`, `truncated?`, `unconfirmed?`, `notSeenInLatestHours?: number | 'unknown' | null`, root `data-testid="price-cell"`) inside `PriceBoundary`; `test/guards.ts` with `MONEY_FILES` and the sweep's `closest('[data-testid="price-cell"], [data-cost], label')`; `test/copy/catalogue.test.ts` `SAMPLES` and the "verified" `allowed` set; `test/msw/handlers.ts` `url()` and `handlers`; `test/fixtures.ts` `API`, `provSearch`, `provCalendar`; `renderWithProviders(ui, opts?)` returning `user`; `App.tsx`'s `needsDefinition`, `selected` and `{view === 'alerts' ? <Placeholder /> : null}`; `test/app/shell.test.tsx`'s alerts placeholder test.

## 5. Interfaces produced

```ts
// @gmt/core (Task 11.0)
export type AlertEventStatus = 'queued' | 'notified' | 'suppressed';            // types/alerts.ts; AlertEvent.status
export const alertEventPayloadSchema;   // api-contract/alerts.ts (apiContract.alertEventPayloadSchema), inferred; AlertEventPayload = z.output<typeof alertEventPayloadSchema>:
export type AlertEventPayload = {
  digestId: string | null; executionId: string; pricePence: number; provenance: Provenance;
  previous: { pricePence: number; provenance: Provenance } | null;                // the drop baseline, or a "new" cell's out-of-window price
  isNew: boolean; route: string /* "LHR→JFK 14 Mar–28 Mar (14n)" */;
  verdictClass: 'verified' | 'partially-verified' | 'unchecked' /* verdictClassSchema less 'failed', plus 'unchecked' */; unverified: ConstraintName[];
  reason: { kind: 'threshold' | 'drop' | 'new'; gapHours: number | null };
  staleThresholdHours: number; truncated: boolean; notSeenInLatest: { at: IsoDateTime | null } | null;
};
export const SOURCE_LABELS: Readonly<Record<SourceKind, string>>; export function sourceLabel(p: Pick<Provenance, 'sourceKind'>): string;   // labels/source.ts
export function isMailbox(s: string): boolean; export function smtpPlaintextAllowed(host: string, nodeEnv: Config['nodeEnv']): boolean;      // config/schema.ts
// Config.alertEmailMaxPerHour: number (ALERT_EMAIL_MAX_PER_HOUR, default 20); APP_BASE_URL refuses userinfo, query and fragment;
// ALERT_EMAIL_TO / ALERT_EMAIL_FROM refuse anything but one mailbox.

// @gmt/db (Task 11.0b)
// drizzle/0002_alert_event_lifecycle.sql: alert_events.status CHECK (queued, notified, suppressed); sent → notified, failed → queued (reason: "migrated from a failed send; not retried")
// AlertsRepo.eventsForExecution(ruleId: string, executionId: string): AlertEvent[]       (oldest first; by the price row's execution)
// AlertsRepo.updateEvents(ids: readonly number[], patch: { status: AlertEventStatus; reason?: string | null; firedAt?: IsoDateTime; digestId?: string }): void
//   (one transaction; a field left out keeps its stored value; digestId is written into payload_json)
// AlertsRepo.priorFirings: notified events only, never a payload.isNew listing
// NotificationsRepo.lastSent(kind: OperatorMessageKind, definitionId: string): IsoDateTime | null

// packages/engine/src/types.ts (WP7's, Task 11.1)
export interface AlertsPass { stop: 'completed' | 'budget' }
export type AlertsStepHook = (deps: EngineDeps, executionId: string, pass: AlertsPass) => Promise<{ digests: number; events: number }>;

// packages/engine/src/text.ts
export function controlFree(s: string): string;   // Cc and U+2028/U+2029 → space, hidden format characters removed, no trim
export function stripControl(s: string): string;  // controlFree, runs collapsed, trimmed

// packages/engine/src/alerts/
export type AlertRunnerDeps = Pick<EngineDeps, 'config' | 'db' | 'repos' | 'providers' | 'notifiers' | 'clock' | 'log'>;   // context.ts
export interface AlertRunResult { digests: number; events: number }                                                       // runner.ts
export async function runAlerts(deps: AlertRunnerDeps, executionId: string, pass?: AlertsPass): Promise<AlertRunResult>;   // an AlertsStepHook; never rejects; pass defaults to { stop: 'completed' }
export interface ItemMarks { stale: { thresholdHours: number } | null; truncated: boolean; notSeenInLatest: { at: IsoDateTime | null } | null; previousConverted: boolean }   // templates.ts
export const NO_MARKS: ItemMarks;
export interface DigestRenderInput { digest: AlertDigest; definitionName: string; appBaseUrl: string | null; now: IsoDateTime; marks: ReadonlyMap<string, ItemMarks>; budgetStop: { unsearched: number } | null /* only after a budget stop */; verificationNotRun: boolean; unconfirmed: number }
export const MAX_PROVIDER_TEXT = 200;
export function cellLine(cell: Cell): string; export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string;
export function renderSubject(item: DigestItem, now: IsoDateTime): string; export function renderBody(input: DigestRenderInput): string;
export function appRowLink(appBaseUrl: string | null, definitionId: string, basis: ResultBasis, rowKey: string): string;   // `${base}/?view=results&def=…&basis=…&row=…`

// packages/engine/src/notifiers/email.ts, index.ts
export const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 } as const;
export type SmtpConfig = NonNullable<Config['smtp']>;
export interface SmtpTransportOptions { host: string; port: number; secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean; auth: { user: string; pass: string }; connectionTimeout: number; greetingTimeout: number; socketTimeout: number }
export interface MailMessage { from: string; to: string; subject: string; text: string }
export interface MailTransport { sendMail(m: MailMessage): Promise<{ messageId: string }> }
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions;
export interface EmailNotifierOptions { smtp: SmtpConfig; nodeEnv: Config['nodeEnv']; log: Logger; clock: Clock; maxPerHour: number; createTransport?: TransportFactory }
export class EmailNotifier implements Notifier { readonly id = 'email'; constructor(opts: EmailNotifierOptions) }
export function buildNotifiers(config: Pick<Config, 'smtp' | 'nodeEnv' | 'alertEmailMaxPerHour'>, log: Logger, clock: Clock): Notifier[];

// apps/api/src/bootstrap/engine.ts
export function engineFor(ports: Ports, log: Logger): Engine;   // createEngine({ ...ports, notifiers: buildNotifiers(…) }, { alerts: runAlerts })

// apps/web
export function AlertsView(props: { definitionId: string }): JSX.Element;   // src/views/Alerts/index.ts
export function describeRule(r: AlertRule): string;
// src/api/endpoints.ts: api.alertRules(definitionId), api.createAlertRule(body), api.deleteAlertRule(id), api.alertEvents(definitionId, limit)
// src/api/types.ts: AlertRuleBody = z.input<typeof apiContract.alertRuleInputSchema>;  src/copy.ts: COPY.alertsView
```

`packages/engine/src/index.ts` re-exports `runAlerts`, `AlertRunnerDeps`, `AlertRunResult`, `AlertsPass`, the templates' `appRowLink`, `DigestRenderInput`, `ItemMarks`, `NO_MARKS`, `renderBody`, `renderSubject`, `routeLine`, and the notifier exports above.

## 6. Library notes

- **nodemailer 10.1.1** with **@types/nodemailer 8.0.2** (already in `packages/engine/package.json`, decision 56: nodemailer stays in `@gmt/engine`). Verified with context7 (`/nodemailer/nodemailer-homepage`, `docs/smtp/index.md`, `docs/transports/stream.md`) on 2026-10-14; the types below were re-read from the installed `@types/nodemailer` on 2026-10-17 (no network).
  - `nodemailer.createTransport({ host, port, secure, requireTLS, ignoreTLS, auth, connectionTimeout, greetingTimeout, socketTimeout })`: `secure: true` is TLS from connect; `secure: false` upgrades with STARTTLS when offered; `requireTLS: true` makes the upgrade mandatory; `ignoreTLS: true` never attempts it. The three timeouts are milliseconds (`lib/smtp-connection/index.d.ts`: `connectionTimeout?`, `greetingTimeout?`, `socketTimeout?`); nodemailer's defaults are 2 minutes, 30 seconds and 10 minutes, which would let a stalled server hold the alerts step before the execution's status write (review arch-wp11-004), so this WP sets 10 s, 10 s and 30 s. Certificate checks stay at nodemailer's default (on): the options never carry a `tls` key. Creating a transporter opens no connection.
  - `sendMail({ from, to, subject, text })` resolves `info` with `messageId`; a failure is an `Error` with `code` (for example `EAUTH`) and, for an SMTP reply, `responseCode` (for example 535).
  - **Test transport:** `createTransport({ jsonTransport: true })`. `info.envelope` is `{ from: string | false; to: string[] }`; `info.message` is a JSON string of the message (`subject`, `text`, `html` only when given, `headers` only when given). The tests parse it with zod.
- **drizzle-kit 0.31.11** (`pnpm --filter @gmt/db db:generate --name <tag>`, WP3's script): generates `drizzle/<idx>_<tag>.sql`, `meta/<idx>_snapshot.json` and the journal entry from `src/schema`. A CHECK change on SQLite is a table rebuild (`__new_<table>`, `INSERT … SELECT`, `DROP`, `RENAME`), which copies values as they are; Task 11.0b edits the generated SQL to map the old statuses, as WP7's 0001 did.
- **zod 4.6.7:** `z.object`, `z.email()`, `z.url({ protocol })`, `.parse`, `.safeParse`; core's `provenanceSchema` and `constraintNameSchema` inside the payload schema.
- **msw 3.0.3**, **@testing-library/react 16.3.3**, **@testing-library/user-event 14.6.8**, **jest-dom 7.0.1**, **react 19.3.1**, **@tanstack/react-query 5.104.2**: as WP9's brief verified them.
- **vitest 5.0.4:** `vi.fn<T>(impl)`, `vi.spyOn(namespace, export)` on a workspace package's ESM namespace (used on `@gmt/engine` and `@gmt/providers`), coverage thresholds per glob (`'src/alerts/**': { … }`). Per-task runs use `pnpm --filter <pkg> exec vitest run <file>` (no coverage threshold on a partial run, decision 8). Engine tests use fixed clocks only, and `test/support/setup.ts` refuses every DNS lookup and every unmatched request (decisions 18, 20); the email tests also assert that no socket is opened.

## 7. Files

- **Create (core, Task 11.0):** `packages/core/src/labels/source.ts`; tests `packages/core/test/config/alertsConfig.test.ts`, `packages/core/test/labels/source.test.ts`, `packages/core/test/api-contract/alertPayload.test.ts`.
- **Create (db, Task 11.0b):** `packages/db/drizzle/0002_alert_event_lifecycle.sql`, `packages/db/drizzle/meta/0002_snapshot.json` (generated); tests `packages/db/test/alertsLifecycle.test.ts`, `packages/db/test/migration0002.test.ts`.
- **Create (engine source):** `packages/engine/src/alerts/context.ts`, `pools.ts`, `marks.ts`, `templates.ts`, `runner.ts`; `packages/engine/src/notifiers/email.ts`, `packages/engine/src/notifiers/index.ts`.
- **Create (engine tests):** `packages/engine/test/alerts/fixtures.ts`, `builders.ts`, `realKindProvider.ts`, `text.test.ts`, `runner.digest.test.ts`, `templates.test.ts`, `runner.verified.test.ts`, `runner.calendar.test.ts`, `runner.dedup.test.ts`, `runner.refusals.test.ts`, `runner.marks.test.ts`, `templates.marks.test.ts`, `engine.alerts.test.ts`; `packages/engine/test/notifiers/email.test.ts`.
- **Create (api):** `apps/api/src/bootstrap/engine.ts`; test `apps/api/test/bootstrap/engine.test.ts`.
- **Create (web, blocked until WP9/WP10):** `apps/web/src/views/Alerts/RuleForm.tsx`, `ruleText.ts`, `AlertsView.tsx`, `EventsTable.tsx`, `index.ts`; tests `apps/web/test/views/Alerts/RuleForm.test.tsx`, `AlertsView.test.tsx`.
- **Modify:** the files listed in §12.

## 8. Tasks

Commands run from the repository root. Every commit message ends with the repository's attribution line. Test counts are per file unless a directory is named. Each Step 2 lists the tests that must fail first, with the first assertion message recorded in the assembly, and the ones expected green from the start.

### Task 11.0: Core: the alert event payload and statuses, one source wording, the email config (decisions 55, 56)

**Files:**
- Create `packages/core/src/labels/source.ts`.
- Modify `packages/core/src/types/alerts.ts`, `packages/core/src/api-contract/alerts.ts`, `packages/core/src/config/schema.ts`, `packages/core/src/index.ts`, and WP0's `packages/core/test/config/schema.test.ts` (two test addresses).
- Test `packages/core/test/config/alertsConfig.test.ts`, `packages/core/test/labels/source.test.ts`, `packages/core/test/api-contract/alertPayload.test.ts`.

**Interfaces:** Produces `AlertEventStatus`, `alertEventPayloadSchema`, `AlertEventPayload`, `SOURCE_LABELS`, `sourceLabel`, `isMailbox`, `smtpPlaintextAllowed`, `Config.alertEmailMaxPerHour`.

- [ ] **Step 1: Write the failing tests.**

`packages/core/test/config/alertsConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isMailbox, parseConfig, smtpPlaintextAllowed } from '../../src/config/schema.js';

// Spec §8.3, §12; decision 56 and the WP11 round-1 review (sec-001, sec-004, arch-wp11-007).
const realpath = (p: string) => p;
const minimal = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/get-me-there.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
};
const smtp = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_USER: 'alerts',
  SMTP_PASS: 'test-smtp-pass-0123456789abcdef',
  ALERT_EMAIL_TO: 'operator@example.com',
  ALERT_EMAIL_FROM: 'get-me-there@example.com',
};
function parse(env: Record<string, string>) {
  return parseConfig({ ...minimal, ...env }, { realpath });
}
function failedFields(env: Record<string, string>): string[] {
  const r = parse(env);
  return r.ok ? [] : r.errors.map((e) => e.field);
}

describe('ALERT_EMAIL_TO and ALERT_EMAIL_FROM are one mailbox each (spec §8.3)', () => {
  it('a plain address is accepted', () => {
    const r = parse(smtp);
    expect(r.ok && r.config.smtp?.to).toBe('operator@example.com');
  });
  it.each([
    ['a list', 'a@example.com, b@example.org'],
    ['a semicolon list', 'a@example.com;b@example.org'],
    ['a display name', 'Ops <ops@example.com>'],
    ['a CRLF header', 'ops@example.com\r\nBcc: victim@example.org'],
    ['a bare LF', 'ops@example.com\nBcc: victim@example.org'],
    ['no domain', 'ops'],
  ])('%s is refused for both fields', (_name, value) => {
    expect(isMailbox(value)).toBe(false);
    expect(failedFields({ ...smtp, ALERT_EMAIL_TO: value })).toEqual(['ALERT_EMAIL_TO']);
    expect(failedFields({ ...smtp, ALERT_EMAIL_FROM: value })).toEqual(['ALERT_EMAIL_FROM']);
  });
});

describe('APP_BASE_URL is an https base with no credentials, query or fragment (spec §12)', () => {
  it.each(['https://gmt.example.ts.net', 'https://gmt.example.ts.net/', 'https://example.org/gmt'])(
    '%s is accepted',
    (v) => {
      const r = parse({ APP_BASE_URL: v });
      expect(r.ok && r.config.appBaseUrl).toBe(v);
    },
  );
  it.each([
    'http://gmt.example.ts.net',
    'https://user:pw@gmt.example.ts.net',
    'https://user@gmt.example.ts.net',
    'https://gmt.example.ts.net/?a=1',
    'https://gmt.example.ts.net/?',
    'https://gmt.example.ts.net/#x',
    'https://gmt.example.ts.net/#',
    'not a url',
  ])('%s is refused', (v) => {
    expect(failedFields({ APP_BASE_URL: v })).toEqual(['APP_BASE_URL']);
  });
});

describe('ALERT_EMAIL_MAX_PER_HOUR (decision 56)', () => {
  it('defaults to 20, takes a positive integer, refuses 0 and fractions', () => {
    const d = parse({});
    expect(d.ok && d.config.alertEmailMaxPerHour).toBe(20);
    const five = parse({ ALERT_EMAIL_MAX_PER_HOUR: '5' });
    expect(five.ok && five.config.alertEmailMaxPerHour).toBe(5);
    expect(failedFields({ ALERT_EMAIL_MAX_PER_HOUR: '0' })).toEqual(['ALERT_EMAIL_MAX_PER_HOUR']);
    expect(failedFields({ ALERT_EMAIL_MAX_PER_HOUR: '2.5' })).toEqual(['ALERT_EMAIL_MAX_PER_HOUR']);
  });
});

describe('smtpPlaintextAllowed: the one SMTP_TLS=none rule (spec §8.3)', () => {
  it.each([
    ['localhost', 'production', true],
    ['127.0.0.1', 'production', true],
    ['127.0.0.2', 'test', true],
    ['::1', 'production', true],
    ['mailpit', 'development', true],
    ['mailpit', 'production', false],
    ['mailpit', 'test', false],
    ['LOCALHOST', 'production', false],
    ['[::1]', 'production', false],
    ['127.evil.example', 'production', false],
    ['localhost.evil.example', 'production', false],
    ['127.0.0.1.evil.example', 'production', false],
    ['evil-localhost', 'production', false],
    ['smtp.example.com', 'development', false],
  ] as const)('%s under %s → %s', (host, env, allowed) => {
    expect(smtpPlaintextAllowed(host, env)).toBe(allowed);
  });
});
```

`packages/core/test/labels/source.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SOURCE_LABELS, sourceLabel } from '../../src/labels/source.js';

describe('sourceLabel: the one copy of the spec §11 source wording (decision 56)', () => {
  it('names every source kind', () => {
    expect(sourceLabel({ sourceKind: 'scraped-search' })).toBe('Google Flights via SearchApi');
    expect(sourceLabel({ sourceKind: 'scraped-aggregate' })).toBe('Google date grid via SearchApi');
    expect(sourceLabel({ sourceKind: 'authorised-cached' })).toBe('Aviasales cache');
    expect(sourceLabel({ sourceKind: 'synthetic' })).toBe('synthetic fixture data');
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([
      'authorised-cached',
      'scraped-aggregate',
      'scraped-search',
      'synthetic',
    ]);
  });
});
```

`packages/core/test/api-contract/alertPayload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { alertEventPayloadSchema, alertEventSchema } from '../../src/api-contract/alerts.js';

// Decision 56: one payload schema the engine writes and the web reads.
const provenance = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  maxAgeHours: 'unknown',
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const payload = {
  digestId: 'd1',
  executionId: 'ex-1',
  pricePence: 41_200,
  provenance,
  previous: { pricePence: 50_000, provenance: { ...provenance, fetchedAt: '2026-10-07T10:00:00.000Z' } },
  isNew: false,
  route: 'LHR→JFK 14 Mar–28 Mar (14n)',
  verdictClass: 'partially-verified',
  unverified: ['checkedBagRequired'],
  reason: { kind: 'drop', gapHours: 168 },
  staleThresholdHours: 192,
  truncated: false,
  notSeenInLatest: { at: '2026-10-14T12:00:00.000Z' },
};

describe('alertEventPayloadSchema (decision 56)', () => {
  it('accepts the runner payload and refuses a non-integer price, an unknown class or a provenance without its source', () => {
    expect(alertEventPayloadSchema.parse(payload)).toEqual(payload);
    expect(alertEventPayloadSchema.safeParse({ ...payload, pricePence: 412.5 }).success).toBe(false);
    // the results row's vocabulary less 'failed', derived from verdictClassSchema (decision 59)
    for (const verdictClass of ['verified', 'partially-verified', 'unchecked'])
      expect(alertEventPayloadSchema.safeParse({ ...payload, verdictClass }).success).toBe(true);
    expect(alertEventPayloadSchema.safeParse({ ...payload, verdictClass: 'failed' }).success).toBe(false);
    const { sourceKind: _dropped, ...noSource } = provenance;
    expect(alertEventPayloadSchema.safeParse({ ...payload, provenance: noSource }).success).toBe(false);
    expect(
      alertEventPayloadSchema.safeParse({ ...payload, notSeenInLatest: { at: null }, previous: null })
        .success,
    ).toBe(true);
  });
  it('event statuses are queued, notified and suppressed', () => {
    const event = {
      id: 1,
      ruleId: 'r',
      identityKey: 'k',
      observationId: null,
      calendarPriceId: 1,
      dedupKey: 'd',
      firedAt: '2026-10-14T10:00:00.000Z',
      reason: null,
      payload,
    };
    for (const status of ['queued', 'notified', 'suppressed'])
      expect(alertEventSchema.safeParse({ ...event, status }).success).toBe(true);
    for (const status of ['sent', 'failed'])
      expect(alertEventSchema.safeParse({ ...event, status }).success).toBe(false);
  });
});
```

In WP0's `packages/core/test/config/schema.test.ts`, the two SMTP fixtures use `ALERT_EMAIL_TO: 'a@b.c'` and `ALERT_EMAIL_FROM: 'x@b.c'`, which a one-letter top-level domain makes invalid as a mailbox; change them to `'a@example.com'` and `'x@example.com'`.

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/core exec vitest run test/config/alertsConfig.test.ts test/labels/source.test.ts test/api-contract/alertPayload.test.ts`. Expected (recorded against main): FAIL. `source.test.ts` cannot resolve `../../src/labels/source.js`; in `alertsConfig.test.ts` every `isMailbox` and `smtpPlaintextAllowed` case fails with `TypeError: (0 , __vite_ssr_import_1__.isMailbox) is not a function` (and the same for `smtpPlaintextAllowed`), the six base URLs with userinfo, a query or a fragment fail with `expected [] to deeply equal [ 'APP_BASE_URL' ]`, and the ceiling with `expected undefined to be 20`; `alertPayload.test.ts` fails with `TypeError: Cannot read properties of undefined (reading 'parse')` and `expected false to be true` (the old status enum). Green from the start, because the old https check already gave them: "a plain address is accepted", the three accepted base URLs, "http://gmt.example.ts.net is refused" and "not a url is refused".

- [ ] **Step 3: Implement.**

In `packages/core/src/types/alerts.ts`, add before `AlertEvent` and use it for `AlertEvent.status`:

```ts
/**
 * Spec §7 `alert_events.status`, decision 56: `queued` is written before the email is sent and stays when the send
 * fails (the next pass sends it), `notified` once a notifier accepted it, `suppressed` by the §6.8 cooldown.
 */
export type AlertEventStatus = 'queued' | 'notified' | 'suppressed';

// in AlertEvent:
  status: AlertEventStatus;
```

In `packages/core/src/api-contract/alerts.ts`, the imports become:

```ts
import { z } from 'zod';
import { isoDateTimeSchema } from '../types/ids.js';
import { provenanceSchema } from '../types/provenance.js';
import { constraintNameSchema, moneyPenceSchema, resultBasisSchema, verdictClassSchema } from './common.js';
```

`alertEventSchema.status` becomes `z.enum(['queued', 'notified', 'suppressed'])`, and at the end of the file add the payload schema. Its verdict class is the results row's vocabulary built from the shared `verdictClassSchema` (less `failed`, which never fires) and `'unchecked'`, never a third spelling (decision 59, review arch-wp11-r2-004):

```ts
/**
 * Decision 56: the payload the alert runner (WP11, engine) stores on every alert event and the Alerts view (WP11, web)
 * reads; one schema, no local copies. The fare and the previous price each carry their provenance, so the view prints
 * both through PriceCell (decision 52). Marks are stored as facts the view can re-judge later: the stale threshold
 * that applied (core's isStale recomputes against now) and the instant of the newer search that did not see the fare.
 */
export const alertEventPayloadSchema = z.object({
  /** The digest the event went out in; null for a suppressed event. */
  digestId: z.string().nullable(),
  executionId: z.string(),
  pricePence: moneyPenceSchema,
  provenance: provenanceSchema,
  /** The price a drop was measured against, or the out-of-window price of a "new" cell; null when none. */
  previous: z.object({ pricePence: moneyPenceSchema, provenance: provenanceSchema }).nullable(),
  /** Listed in the digest's "new" section (spec §6.8 absent-then-present); never a drop firing. */
  isNew: z.boolean(),
  /** The cell in words, e.g. "LHR→JFK 14 Mar–28 Mar (14n)". */
  route: z.string(),
  /** The results row's vocabulary (verdictClassSchema plus 'unchecked'); `failed` never fires (decision 59). */
  verdictClass: z.union([verdictClassSchema.exclude(['failed']), z.literal('unchecked')]),
  unverified: z.array(constraintNameSchema),
  /** Reason parts: what fired, and the whole hours between the previous fetch and this one when a previous price exists. */
  reason: z.object({
    kind: z.enum(['threshold', 'drop', 'new']),
    gapHours: z.number().int().min(0).nullable(),
  }),
  /** The basis threshold this price is judged against (decisions 54, 55). */
  staleThresholdHours: z.number().int().min(1),
  /** From a discovery tile the page cap cut short: "cheapest of the rows read" (decision 30). */
  truncated: z.boolean(),
  /** A newer itinerary search of the cell did not see this fare; `at` is that search's fetch instant when known. */
  notSeenInLatest: z.object({ at: isoDateTimeSchema.nullable() }).nullable(),
});
export type AlertEventPayload = z.output<typeof alertEventPayloadSchema>;
```

`packages/core/src/labels/source.ts`:

```ts
import type { Provenance, SourceKind } from '../types/provenance.js';

/**
 * Spec §11 vocabulary, the one copy (decision 56): the source of a price in words. Each source kind belongs to one
 * provider (spec §2), so the kind alone names it. The engine's email templates and WP9's PriceCell both read it.
 */
export const SOURCE_LABELS: Readonly<Record<SourceKind, string>> = {
  'authorised-cached': 'Aviasales cache',
  'scraped-aggregate': 'Google date grid via SearchApi',
  'scraped-search': 'Google Flights via SearchApi',
  synthetic: 'synthetic fixture data',
};

/** The source of a price in words, e.g. "Google Flights via SearchApi" (spec §11). */
export function sourceLabel(p: Pick<Provenance, 'sourceKind'>): string {
  return SOURCE_LABELS[p.sourceKind];
}
```

In `packages/core/src/index.ts`, add `AlertEventPayload` to the `export type { … } from './api-contract/index.js'` list and, after the `labels/age.js` export:

```ts
export { SOURCE_LABELS, sourceLabel } from './labels/source.js';
```

In `packages/core/src/config/schema.ts`:

1. Add to `Config`, before `smtp`:

```ts
  /** ALERT_EMAIL_MAX_PER_HOUR (decision 56): outgoing emails per hour, beyond which messages are logged and dropped. */
  alertEmailMaxPerHour: number;
```

2. After `const LOOPBACK = …;`, add:

```ts
/**
 * Spec §8.3: SMTP_TLS=none is allowed only for a loopback host, or the `mailpit` host under NODE_ENV=development. The
 * one copy of the rule: the config schema enforces it and the engine's EmailNotifier re-checks it (WP11).
 */
export function smtpPlaintextAllowed(host: string, nodeEnv: Config['nodeEnv']): boolean {
  return LOOPBACK.test(host) || (host === 'mailpit' && nodeEnv === 'development');
}

/**
 * One mailbox: an address only, so a list, a display name or a control character can never reach an email header
 * (spec §8.3). The config schema checks ALERT_EMAIL_TO/FROM with it and the engine's EmailNotifier re-checks (WP11).
 */
export function isMailbox(s: string): boolean {
  return z.email().safeParse(s).success;
}
```

3. Before `providerLimits`, add:

```ts
/**
 * APP_BASE_URL (spec §12): https, and nothing an email link must not carry or would break — no userinfo (credentials
 * in every email), no query and no fragment (the app appends its own). A path prefix is allowed (a reverse proxy).
 */
function appBaseUrlOk(raw: string): boolean {
  if (!z.url({ protocol: /^https$/ }).safeParse(raw).success) return false;
  const u = new URL(raw);
  return (
    u.username === '' &&
    u.password === '' &&
    u.search === '' &&
    u.hash === '' &&
    !raw.includes('#') &&
    !raw.includes('?')
  );
}
```

4. Replace the APP_BASE_URL check in `parseConfig` with:

```ts
  if (appBaseUrl !== null && !appBaseUrlOk(appBaseUrl)) {
    r.fail('APP_BASE_URL', 'APP_BASE_URL must be an https URL with no user, password, query or fragment');
  }
```

5. In the SMTP block, replace the `plaintextAllowed` line and its `if` with:

```ts
    if (!isMailbox(to))
      r.fail(
        'ALERT_EMAIL_TO',
        'ALERT_EMAIL_TO must be one email address (no display name, list or control character)',
      );
    if (!isMailbox(from))
      r.fail(
        'ALERT_EMAIL_FROM',
        'ALERT_EMAIL_FROM must be one email address (no display name, list or control character)',
      );
    if (tls === 'none' && !smtpPlaintextAllowed(host, nodeEnv)) {
```

6. After `const staleAfterHours = …;` add `const alertEmailMaxPerHour = r.int('ALERT_EMAIL_MAX_PER_HOUR', 1) ?? 20;`, and add `alertEmailMaxPerHour,` to the returned config before `smtp`.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/core test`. Expected: PASS with core's 100% thresholds met (the three new files: 36 tests).

- [ ] **Step 5: Commit.** `git add packages/core && git commit -m "wp11: core alert event payload schema and statuses, sourceLabel, one-mailbox and base-URL config checks, ALERT_EMAIL_MAX_PER_HOUR (decisions 55, 56)"`

### Task 11.0b: Db: alert events queued then notified, the earlier-pass query, the daily operator check (decision 56)

**Files:**
- Create `packages/db/drizzle/0002_alert_event_lifecycle.sql` and `packages/db/drizzle/meta/0002_snapshot.json` (generated).
- Modify `packages/db/drizzle/meta/_journal.json` (generated), `packages/db/src/internal/enums.ts`, `packages/db/src/repositories/alerts.ts`, `packages/db/src/repositories/notifications.ts`, and WP3's/WP7's tests `packages/db/test/alerts.test.ts`, `client.test.ts`, `migration0001.test.ts`, `barrel.test.ts`.
- Test `packages/db/test/alertsLifecycle.test.ts`, `packages/db/test/migration0002.test.ts`.

**Interfaces:** Consumes `AlertEventStatus` (Task 11.0). Produces the migration, `AlertsRepo.eventsForExecution`, `AlertsRepo.updateEvents`, the new `priorFirings` rule, `NotificationsRepo.lastSent`.

- [ ] **Step 1: Write the failing tests.**

`packages/db/test/alertsLifecycle.test.ts`:

```ts
import { type AlertEvent, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { AlertsRepo } from '../src/repositories/alerts.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { ItinerariesRepo } from '../src/repositories/itineraries.js';
import { NotificationsRepo } from '../src/repositories/notifications.js';
import { at, freshDb, T0 } from './helpers/db.js';
import { calendarPrice, cell, itinerary, newExecution, observationWrite } from './helpers/factories.js';

// Decision 56: alert events are queued before the send and notified after; an earlier pass's events are found by a
// query on (rule, execution); a "new" listing never suppresses; operator messages are de-duplicated per day.
function setup() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const first = newExecution(db, clock, { status: 'completed' });
  const second = newExecution(db, clock, { definition: first.definition });
  const alerts = new AlertsRepo(db, clock);
  const rule = alerts.create({
    definitionId: first.definition.id,
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });
  const prices = new CalendarPricesRepo(db, clock, { allowSynthetic: false });
  const [p1] = prices.insert(first.execution.id, [calendarPrice(cell())]);
  const [p2] = prices.insert(second.execution.id, [calendarPrice(cell())]);
  const itineraries = new ItinerariesRepo(db, clock, { allowSynthetic: false });
  const it = itinerary();
  itineraries.upsertItinerary(it);
  const { observationId } = itineraries.recordObservation(
    { itineraryHash: it.hash, providerId: 'searchapi', seller: 'British Airways', cabin: 'economy' },
    { ...observationWrite(), executionId: second.execution.id },
  );
  if (p1 === undefined || p2 === undefined) throw new Error('fixture');
  const event = (over: Partial<Omit<AlertEvent, 'id'>>): Omit<AlertEvent, 'id'> => ({
    ruleId: rule.id,
    identityKey: 'k',
    observationId: null,
    calendarPriceId: null,
    dedupKey: 'k|412',
    firedAt: T0,
    status: 'queued',
    reason: 'r',
    payload: { isNew: false },
    ...over,
  });
  return { db, clock, alerts, rule, first, second, p1, p2, observationId, event };
}

describe('AlertsRepo event lifecycle (decision 56)', () => {
  it('eventsForExecution returns the rule events whose price row the execution wrote, calendar and observation alike', () => {
    const { alerts, rule, first, second, p1, p2, observationId, event } = setup();
    const a = alerts.insertEvent(event({ calendarPriceId: p1 }));
    const b = alerts.insertEvent(event({ calendarPriceId: p2 }));
    const c = alerts.insertEvent(event({ observationId, status: 'suppressed' }));
    alerts.insertEvent(event({}));
    expect(alerts.eventsForExecution(rule.id, second.execution.id).map((e) => e.id)).toEqual([b, c]);
    expect(alerts.eventsForExecution(rule.id, first.execution.id).map((e) => e.id)).toEqual([a]);
    expect(alerts.eventsForExecution('other-rule', second.execution.id)).toEqual([]);
  });

  it('updateEvents moves statuses in one transaction, keeps or replaces the reason, strips URLs and refuses a missing id', () => {
    const { alerts, rule, second, p2, observationId, event } = setup();
    const a = alerts.insertEvent(event({ calendarPriceId: p2 }));
    const b = alerts.insertEvent(event({ observationId }));
    alerts.updateEvents([a, b], { status: 'notified' });
    expect(alerts.eventsForExecution(rule.id, second.execution.id).map((e) => [e.status, e.reason])).toEqual([
      ['notified', 'r'],
      ['notified', 'r'],
    ]);
    alerts.updateEvents([a], {
      status: 'queued',
      reason: 'not delivered: https://user:pw@mail.example/x?k=1',
    });
    alerts.updateEvents([b], { status: 'suppressed', reason: null });
    const [ea, eb] = alerts.eventsForExecution(rule.id, second.execution.id);
    expect(ea?.status).toBe('queued');
    expect(ea?.reason).not.toMatch(/pw@|k=1/);
    expect(eb).toMatchObject({ status: 'suppressed', reason: null });
    expect(() => alerts.updateEvents([a, 999_999], { status: 'notified' })).toThrow(
      expect.objectContaining({ rule: 'missing' }),
    );
    // the transaction rolled back: `a` is still queued
    expect(alerts.eventsForExecution(rule.id, second.execution.id)[0]?.status).toBe('queued');
  });

  it('a successful retry rewrites the reason, the fire time and the digest id; other payload fields stay (decision 59)', () => {
    const { alerts, rule, second, p2, event } = setup();
    const a = alerts.insertEvent(
      event({
        calendarPriceId: p2,
        reason: 'r; not delivered: refused',
        payload: { digestId: 'd1', isNew: false },
      }),
    );
    alerts.updateEvents([a], {
      status: 'notified',
      reason: 'r',
      firedAt: at('2026-10-14T13:00:00.000Z'),
      digestId: 'd2',
    });
    expect(alerts.eventsForExecution(rule.id, second.execution.id)[0]).toMatchObject({
      status: 'notified',
      reason: 'r',
      firedAt: '2026-10-14T13:00:00.000Z',
      payload: { digestId: 'd2', isNew: false },
    });
    expect(() => alerts.updateEvents([a], { status: 'notified', firedAt: at('not a time') })).toThrow();
  });

  it('priorFirings counts notified firings only: never a queued event or a "new" listing', () => {
    const { alerts, rule, p1, p2, event } = setup();
    alerts.insertEvent(event({ calendarPriceId: p1, status: 'queued' }));
    alerts.insertEvent(event({ calendarPriceId: p1, status: 'notified', payload: { isNew: true } }));
    expect(alerts.priorFirings(rule.id, ['k'], at('2026-10-01T00:00:00.000Z'))).toEqual([]);
    alerts.insertEvent(event({ calendarPriceId: p2, status: 'notified' }));
    alerts.insertEvent(event({ calendarPriceId: p2, status: 'notified', payload: {} }));
    expect(alerts.priorFirings(rule.id, ['k'], at('2026-10-01T00:00:00.000Z'))).toHaveLength(2);
  });
});

describe('NotificationsRepo.lastSent (decision 56: operator messages once per kind per definition per day)', () => {
  it('the newest sent instant of the kind for the definition, any execution; failed sends and other kinds ignored', () => {
    const { db, clock, first, second } = setup();
    const n = new NotificationsRepo(db, clock);
    expect(n.lastSent('paused_budget', first.definition.id)).toBeNull();
    n.record('paused_budget', first.execution.id, first.definition.id, 'sent');
    clock.advance(3_600_000);
    n.record('paused_budget', second.execution.id, first.definition.id, 'failed');
    n.record('paused_error', second.execution.id, first.definition.id, 'sent');
    expect(n.lastSent('paused_budget', first.definition.id)).toBe(T0);
    clock.advance(3_600_000);
    n.record('paused_budget', null, first.definition.id, 'sent');
    expect(n.lastSent('paused_budget', first.definition.id)).toBe(clock.now());
  });
});
```

`packages/db/test/migration0002.test.ts`:

```ts
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { AlertsRepo } from '../src/repositories/alerts.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { openTracked, sqliteCode, T0, tmpDbPath, tmpDir } from './helpers/db.js';
import { exampleDefinitionInput } from './helpers/factories.js';

/** A copy of the migrations folder that stops at 0001, as an install made before this migration has it. */
function upTo0001(): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  rmSync(join(dir, '0002_alert_event_lifecycle.sql'));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.tag !== '0002_alert_event_lifecycle');
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0002: alert event lifecycle (decision 56)', () => {
  it("maps 'sent' to 'notified' and 'failed' to 'queued' (saying it is not retried), keeps the rest, and the CHECK refuses the old names", () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, upTo0001());
    const definition = new DefinitionsRepo(db, fixedClock(T0)).create(exampleDefinitionInput());
    db.raw
      .prepare(
        `INSERT INTO alert_rules (id, definition_id, type, threshold_pence, basis, cooldown_hours, enabled) VALUES ('r1', ?, 'absolute', 45000, 'calendar', 336, 1)`,
      )
      .run(definition.id);
    const insert = db.raw.prepare(
      `INSERT INTO alert_events (rule_id, identity_key, dedup_key, fired_at, status, reason, payload_json) VALUES ('r1', 'k', 'k|412', ?, ?, ?, '{"isNew":false}')`,
    );
    for (const [status, reason] of [
      ['sent', null],
      ['failed', 'not delivered: connection refused'],
      ['suppressed', 'same price band'],
    ])
      insert.run(T0, status, reason);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0002_alert_event_lifecycle']);
    applyMigrations(db, MIGRATIONS_DIR);
    const events = new AlertsRepo(db, fixedClock(T0)).events({ ruleId: 'r1', limit: 10 });
    expect(events.map((e) => [e.id, e.status, e.reason, e.payload]).sort()).toEqual([
      [1, 'notified', null, { isNew: false }],
      [
        2,
        'queued',
        'not delivered: connection refused; migrated from a failed send; not retried',
        { isNew: false },
      ],
      [3, 'suppressed', 'same price band', { isNew: false }],
    ]);
    expect(sqliteCode(() => insert.run(T0, 'sent', null))).toBe('SQLITE_CONSTRAINT_CHECK');
    const indexes = db.raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'alert_events' ORDER BY name`,
      )
      .all();
    expect(indexes).toEqual([
      { name: 'alert_events_rule_dedup_idx' },
      { name: 'alert_events_rule_identity_idx' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/db exec vitest run test/alertsLifecycle.test.ts test/migration0002.test.ts`. Expected (recorded against main plus Task 11.0): FAIL, 6 failed and 0 passed: the four AlertsRepo tests with `SqliteError: CHECK constraint failed: alert_events_status_ck` (the old CHECK refuses `queued`), "the newest sent instant of the kind …" with `TypeError: n.lastSent is not a function`, and the migration test with `ENOENT … 0002_alert_event_lifecycle.sql`.

- [ ] **Step 3: Implement.**

In `packages/db/src/internal/enums.ts`, `ALERT_EVENT_STATUSES` becomes `['queued', 'notified', 'suppressed']` (the schema's CHECK reads it). Then run `pnpm --filter @gmt/db db:generate --name alert_event_lifecycle`: drizzle-kit writes `drizzle/0002_alert_event_lifecycle.sql`, `drizzle/meta/0002_snapshot.json` and the journal entry. Replace the generated SQL with this hand-edited copy (it maps the old statuses instead of copying them into a CHECK that refuses them, says in a mapped failed row's reason that it is not retried (decision 59: only a later pass of its own execution resends a queued event), and drops two PRAGMA lines that have no effect inside the migrator's transaction):

```sql
-- why: generated by drizzle-kit 0.31 (decision 56: alert events queued before the send, notified after), then edited by
-- hand in two places. The copy maps the old statuses ('sent' → 'notified', 'failed' → 'queued') instead of copying
-- them into a CHECK that refuses them; a mapped failed row is never retried (only a later pass of its own execution
-- sends a queued event, decision 59), and its reason says so. The PRAGMA foreign_keys lines are
-- dropped: inside the migrator's transaction they have no effect, and no table references alert_events. Do not
-- regenerate; meta/0002_snapshot.json is drizzle-kit's and matches src/schema.
CREATE TABLE `__new_alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` text NOT NULL,
	`identity_key` text NOT NULL,
	`observation_id` integer,
	`calendar_price_id` integer,
	`dedup_key` text NOT NULL,
	`fired_at` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_id`) REFERENCES `price_observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`calendar_price_id`) REFERENCES `calendar_prices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "alert_events_status_ck" CHECK(status IN ('queued', 'notified', 'suppressed')),
	CONSTRAINT "alert_events_fired_ck" CHECK(fired_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);
--> statement-breakpoint
INSERT INTO `__new_alert_events`("id", "rule_id", "identity_key", "observation_id", "calendar_price_id", "dedup_key", "fired_at", "status", "reason", "payload_json") SELECT "id", "rule_id", "identity_key", "observation_id", "calendar_price_id", "dedup_key", "fired_at", CASE "status" WHEN 'sent' THEN 'notified' WHEN 'failed' THEN 'queued' ELSE "status" END, CASE "status" WHEN 'failed' THEN coalesce("reason" || '; ', '') || 'migrated from a failed send; not retried' ELSE "reason" END, "payload_json" FROM `alert_events`;--> statement-breakpoint
DROP TABLE `alert_events`;--> statement-breakpoint
ALTER TABLE `__new_alert_events` RENAME TO `alert_events`;--> statement-breakpoint
CREATE INDEX `alert_events_rule_dedup_idx` ON `alert_events` (`rule_id`,`dedup_key`,`fired_at`);--> statement-breakpoint
CREATE INDEX `alert_events_rule_identity_idx` ON `alert_events` (`rule_id`,`identity_key`,`fired_at`);
```

In `packages/db/src/repositories/alerts.ts`, add `type AlertEventStatus` to the `@gmt/core` import, replace `priorFirings`' doc comment and `WHERE` line with:

```ts
  /**
   * Spec §6.8 suppression input for `isSuppressed`: every **notified** event for the identities since `since`, with the
   * price that fired (from its observation or calendar price). A queued event (its send pending or failed) does
   * not suppress, and neither does a "new" listing (`payload.isNew`), which was never a firing (decision 56).
   */
  // …
         WHERE ev.rule_id = @ruleId AND ev.status = 'notified' AND ev.fired_at >= @since
           AND coalesce(json_extract(ev.payload_json, '$.isNew'), 0) <> 1
```

and add before `insertEvent` (`updateEvents` keeps a field the patch leaves out; a successful retry passes its reason, fire time and digest id, decision 59):

```ts
  /**
   * Decision 56: every event of the rule whose price row was written by the execution (its observation's or calendar
   * price's execution_id), oldest first. The alert runner reads it to find what an earlier pass of the same execution
   * recorded (never repeated) and what it left queued (sent with the next digest).
   */
  eventsForExecution(ruleId: string, executionId: string): AlertEvent[] {
    return this.db.raw
      .prepare<Record<string, unknown>, EventDbRow>(
        `SELECT ev.* FROM alert_events ev
         LEFT JOIN price_observations o ON o.id = ev.observation_id
         LEFT JOIN calendar_prices p ON p.id = ev.calendar_price_id
         WHERE ev.rule_id = @ruleId AND coalesce(o.execution_id, p.execution_id) = @executionId
         ORDER BY ev.id`,
      )
      .all({ ruleId, executionId })
      .map(toEvent);
  }

  /**
   * Decisions 56, 59: moves events on after a send — `notified` when every notifier accepted the digest, `queued` (with
   * the failure in `reason`) when one did not, `suppressed` when a later pass's cooldown judged a queued firing or no
   * email is configured. A field left out of the patch keeps its stored value; a successful retry passes its own reason,
   * fire time and digest id, so the row describes the send that delivered it. One transaction; URLs in `reason`
   * stripped as on insert. Throws when an id does not exist.
   */
  updateEvents(
    ids: readonly number[],
    patch: { status: AlertEventStatus; reason?: string | null; firedAt?: IsoDateTime; digestId?: string },
  ): void {
    if (patch.firedAt !== undefined) assertIsoDateTime('fired_at', patch.firedAt);
    const update = this.db.raw.prepare(
      `UPDATE alert_events SET status = @status,
         reason = CASE WHEN @keepReason = 1 THEN reason ELSE @reason END,
         fired_at = coalesce(@firedAt, fired_at),
         payload_json = CASE WHEN @digestId IS NULL THEN payload_json ELSE json_set(payload_json, '$.digestId', @digestId) END
       WHERE id = @id`,
    );
    this.db.transaction(() => {
      for (const id of ids) {
        const changed = update.run({
          id,
          status: patch.status,
          keepReason: patch.reason === undefined ? 1 : 0,
          reason: patch.reason === undefined || patch.reason === null ? null : stripUrlsInText(patch.reason),
          firedAt: patch.firedAt ?? null,
          digestId: patch.digestId ?? null,
        }).changes;
        if (changed !== 1) throw new RowRejected('missing', `alert event ${id} does not exist`);
      }
    });
  }
```

In `packages/db/src/repositories/notifications.ts`, the imports become:

```ts
import type { Clock, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { Db } from '../client.js';
import { readTime } from '../internal/read.js';
```

and add before `record`:

```ts
  /**
   * Decision 56: when the kind was last sent for the definition (any execution), or null. The engine compares its London
   * date with today's, so operator messages are de-duplicated per kind per definition per day.
   */
  lastSent(kind: OperatorMessageKind, definitionId: string): IsoDateTime | null {
    const r = this.db.raw
      .prepare<Record<string, unknown>, { sentAt: string }>(
        `SELECT sent_at AS sentAt FROM operator_notifications WHERE kind = @kind AND definition_id = @definitionId AND status = 'sent' ORDER BY sent_at DESC, id DESC LIMIT 1`,
      )
      .get({ kind, definitionId });
    return r === undefined ? null : readTime('operator_notifications.sent_at', r.sentAt);
  }
```

Existing tests that name the old statuses or count migrations:

- `packages/db/test/alerts.test.ts`, the `priorFirings` test: its event statuses `'sent'`, `'failed'`, `'sent'` become `'notified'`, `'queued'`, `'notified'` (and the title "sent events" becomes "notified events"); the expected list becomes `['notified', 'queued', 'notified']`.
- `packages/db/test/client.test.ts`: the pending and applied lists gain `'0002_alert_event_lifecycle'` and the `__drizzle_migrations` count becomes 3.
- `packages/db/test/migration0001.test.ts`: after the 0001 upgrade, `pendingMigrations` and `applyMigrations` list `['0001_confirmed_calls', '0002_alert_event_lifecycle']`.
- `packages/db/test/barrel.test.ts`: the table test's migration count becomes 3 and its title names 0002 (decision 56).

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/db test`. Expected: PASS, 280 tests (6 new), with db's thresholds met (`repositories/alerts.ts` 100% lines).

- [ ] **Step 5: Commit.** `git add packages/db && git commit -m "wp11: alert events queued before the send and notified after, the earlier-pass query, retries rewritten on success, the daily operator check (decisions 56, 59)"`

### Task 11.1: 50 qualifying cells → one digest (first failing test); the engine's one cleaner

**Files:**
- Create `packages/engine/src/alerts/context.ts`, `pools.ts` (the calendar pool), `marks.ts`, `templates.ts` (the calendar half), `runner.ts`.
- Modify WP7's `packages/engine/src/text.ts` (the cleaner), `packages/engine/src/notifiers/operatorTemplates.ts` (`cleanLine` on it), `packages/engine/src/types.ts` and `packages/engine/src/execute.ts` (the hook's `pass` argument), `packages/engine/src/index.ts`.
- Test `packages/engine/test/alerts/fixtures.ts` (the database fixtures every runner task uses), `packages/engine/test/alerts/runner.digest.test.ts`, `packages/engine/test/alerts/text.test.ts`; modify WP7's `packages/engine/test/budget-breach.test.ts`.

**Interfaces:**
- **Consumes:** `evaluateAlertRules`, `buildDigest`, `isStale` and `hoursSince` (WP8), `sourceLabel`, `alertEventPayloadSchema`, `CalendarPricesRepo.fetchedBy`, `CellsRepo.selected/outcomes`, `AlertsRepo.rules/insertEvent/updateEvents`, `ItinerariesRepo.latestVerificationOutcomeForCell/writtenBy`, `Notifier`.
- **Produces:** `runAlerts`, `AlertRunnerDeps`, `AlertRunResult`, `AlertsPass` (WP7's hook gains it), `controlFree`, `stripControl`, the marks and payload of every event, the calendar half of the templates.

The runner is split along its seams (review arch-wp11-012): `context.ts` (what one run shares), `pools.ts` (candidates per basis), `marks.ts` (what `DigestItem` does not carry), `templates.ts` (the words), `runner.ts` (evaluate, persist, send, mark). From this task on every firing is written as a `queued` event before the email is sent and marked `notified` after (spec §8.1 order, decision 56), and every event's payload is core's `AlertEventPayload`. With no SMTP configured the only notifier is WP7's `LogNotifier`, so the digest reaches the log alone and its events are recorded `suppressed` with "email not configured", which no cooldown counts (decision 59). WP7's hook gains a third argument, `pass: { stop: 'completed' | 'budget' }`, because the alerts step runs before the execution's status write and the digest must know whether a budget cap stopped this pass (decision 59; review PA2-1).

- [ ] **Step 1: Write the failing tests.** Start with the shared fixtures, which are test-only. Every row they write is of a real provider kind, because alerts refuse synthetic rows (Task 11.6 proves that with `providerId: 'fixture'`). Configuration goes through core's `parseConfig`, rows through the real repositories (`insert`, `writeTile`, `writeVerifiedCell`, `copyReused`), and payloads are parsed with core's schema, so no `Config`, row or payload is cast.

`packages/engine/test/alerts/fixtures.ts`:

```ts
/**
 * Database fixtures for the alert runner tests (spec §6.8): an in-memory database with the real WP3 migrations and
 * repositories, a fixed clock, a capturing logger and a recording notifier.
 * why: alerts refuse synthetic rows (spec §5.5), so these tests write rows of the real provider kinds into a ':memory:'
 * test database; nothing here is reachable from a production bootstrap. Worked example only (London → New York).
 */
import {
  type AlertDigest,
  type AlertEventPayload,
  type AlertRule,
  addDays,
  apiContract,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type Booking,
  type Cabin,
  type Cell,
  type CellKey,
  type DefinitionInput,
  type DefinitionSnapshot,
  fixedClock,
  type IsoDate,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  itineraryHash,
  type Logger,
  type NormalisedItinerary,
  type Notifier,
  type OperatorMessage,
  type ProviderId,
  parseConfig,
  type SearchDefinition,
  type Segment,
  type SuppliedField,
} from '@gmt/core';
import { applyMigrations, createRepos, type Db, MIGRATIONS_DIR, openDatabase, type Repos } from '@gmt/db';
import type { AlertRunnerDeps } from '../../src/alerts/runner.js';

export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');
const HOUR = 3_600_000;

/** An instant `hours` before `at`. */
export function hoursBefore(at: IsoDateTime, hours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) - hours * HOUR);
}

export interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  msg: string | undefined;
}

/** A Logger that keeps every line with its child bindings, so tests can assert on messages and on absent secrets. */
export function captureLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const make = (bindings: object): Logger => {
    const at =
      (level: LogLine['level']) =>
      (o: object, msg?: string): void => {
        lines.push({ level, fields: { ...bindings, ...o }, msg });
      };
    return {
      debug: at('debug'),
      info: at('info'),
      warn: at('warn'),
      error: at('error'),
      child: (b) => make({ ...bindings, ...b }),
    };
  };
  return Object.assign(make({}), { lines });
}

type NotifierMessage = Parameters<Notifier['send']>[0];
export interface SentDigest {
  digest: AlertDigest;
  subject: string;
  body: string;
}

/** A Notifier that records every message and answers with a fixed result. */
export class RecordingNotifier implements Notifier {
  readonly id: string;
  readonly sent: NotifierMessage[] = [];
  #result: { ok: boolean; detail?: string };
  /** Called during each send, before it answers (a test can look at the database mid-send). */
  onSend: (() => void) | null = null;
  constructor(id = 'recording', result: { ok: boolean; detail?: string } = { ok: true }) {
    this.id = id;
    this.#result = result;
  }
  async send(msg: NotifierMessage): Promise<{ ok: boolean; detail?: string }> {
    this.sent.push(msg);
    this.onSend?.();
    return this.#result;
  }
  /** Changes the answer of every later send. */
  respondWith(result: { ok: boolean; detail?: string }): void {
    this.#result = result;
  }
  digests(): SentDigest[] {
    return this.sent.flatMap((m) =>
      m.kind === 'digest' ? [{ digest: m.digest, subject: m.subject, body: m.body }] : [],
    );
  }
  operatorMessages(): OperatorMessage[] {
    return this.sent.flatMap((m) => (m.kind === 'operator' ? [m.message] : []));
  }
}

/** Test configuration through core's own parser (no hand-built Config). */
export function testConfig(env: Record<string, string> = {}) {
  const parsed = parseConfig(
    { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1', ...env },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`test config invalid: ${JSON.stringify(parsed.errors)}`);
  return parsed.config;
}

export interface Fixture {
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  repos: Repos;
  log: ReturnType<typeof captureLogger>;
  notifier: RecordingNotifier;
  deps: AlertRunnerDeps;
}

/** A fresh database and repositories per test. `env` reaches the config parser (APP_BASE_URL, STALE_AFTER_HOURS, …). */
export function fixture(opts: { notifier?: RecordingNotifier; env?: Record<string, string> } = {}): Fixture {
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = fixedClock(NOW);
  // why: allowSynthetic lets Task 11.6 write fixture rows so the runner's own refusal can be observed.
  const repos = createRepos(db, clock, { allowSynthetic: true });
  repos.airports.upsertAll({
    version: 'test',
    airports: [
      {
        iata: LHR,
        icao: 'EGLL',
        name: 'Heathrow',
        city: 'London',
        country: 'GB',
        tz: 'Europe/London',
        lat: 51.47,
        lon: -0.4543,
        metro: 'LON',
      },
      {
        iata: LGW,
        icao: 'EGKK',
        name: 'Gatwick',
        city: 'London',
        country: 'GB',
        tz: 'Europe/London',
        lat: 51.148,
        lon: -0.19,
        metro: 'LON',
      },
      {
        iata: JFK,
        icao: 'KJFK',
        name: 'John F Kennedy',
        city: 'New York',
        country: 'US',
        tz: 'America/New_York',
        lat: 40.64,
        lon: -73.78,
        metro: 'NYC',
      },
      {
        iata: EWR,
        icao: 'KEWR',
        name: 'Newark',
        city: 'New York',
        country: 'US',
        tz: 'America/New_York',
        lat: 40.69,
        lon: -74.17,
        metro: 'NYC',
      },
    ],
    metros: { LON: [LHR, LGW], NYC: [JFK, EWR] },
  });
  const log = captureLogger();
  const notifier = opts.notifier ?? new RecordingNotifier();
  const config = testConfig(opts.env);
  return {
    db,
    clock,
    repos,
    log,
    notifier,
    deps: { config, db, repos, providers: [], notifiers: [notifier], clock, log },
  };
}

/** The worked-example definition (London → New York), with overrides. */
export function seedDefinition(f: Fixture, over: Partial<DefinitionInput> = {}): SearchDefinition {
  return f.repos.definitions.create({
    name: 'London to New York (worked example)',
    origins: [LHR, LGW],
    destinations: [JFK, EWR],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: {
      maxJourneyMinutes: 1500,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      checkedBagRequired: true,
    },
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
    enabled: true,
    ...over,
  });
}

/**
 * A running execution over the definition's snapshot (a child of one cell when `child` is given); returns its id.
 * A new parent first completes the definition's running parent, as consecutive runs leave it (one active parent).
 */
export function seedExecution(f: Fixture, def: SearchDefinition, child: CellKey | null = null): string {
  const active = child === null ? f.repos.executions.activeParent(def.id) : null;
  if (active !== null) f.repos.executions.setStatus(active.id, 'completed', { finishedAt: f.clock.now() });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: {
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: asIsoDate('2026-10-21'),
      departureTo: asIsoDate('2027-04-20'),
      minNights: def.minNights,
      maxNights: def.maxNights,
    },
    resolvedAt: f.clock.now(),
    windowClamped: false,
    droppedAlwaysInclude: [],
  };
  return f.repos.executions.create({
    definitionId: def.id,
    isChild: child !== null,
    cell: child,
    snapshot,
    estimate: null,
    trigger: 'manual',
    status: 'running',
  }).id;
}

/** `n` cells of 14 nights departing daily from 2026-11-01. */
export function cells(n: number, origin = LHR, destination = JFK): Cell[] {
  return Array.from({ length: n }, (_, i) => {
    const departureDate = addDays(asIsoDate('2026-11-01'), i);
    return { origin, destination, departureDate, returnDate: addDays(departureDate, 14), nights: 14 };
  });
}

/** The one cell of `cells(n)` at index `i`, or a thrown error (keeps tests free of non-null assertions). */
export function cellAt(list: Cell[], i: number): Cell {
  const c = list[i];
  if (c === undefined) throw new Error(`no cell at ${i}`);
  return c;
}

export interface CalendarSeed {
  cell: CellKey;
  pricePence: number;
  fetchedAt?: IsoDateTime;
  providerId?: ProviderId;
  cabin?: Cabin;
  /** The vendor's own age bound; null = unknown. Defaults: Travelpayouts 48, SearchApi date grid 24. */
  maxAgeHours?: number | null;
  providerObservedAt?: IsoDateTime | null;
}

function calendarRow(f: Fixture, r: CalendarSeed) {
  const providerId = r.providerId ?? 'searchapi';
  const sourceKind =
    providerId === 'searchapi'
      ? 'scraped-aggregate'
      : providerId === 'travelpayouts'
        ? 'authorised-cached'
        : 'synthetic';
  return {
    providerId,
    sourceKind,
    cabin: r.cabin ?? 'economy',
    cell: r.cell,
    pricePence: r.pricePence,
    priceNativeMinor: r.pricePence,
    currencyNative: 'GBP',
    fx: { converted: false },
    pointOfSale: providerId === 'searchapi' ? 'GB' : 'unknown',
    fetchedAt: r.fetchedAt ?? f.clock.now(),
    providerObservedAt: r.providerObservedAt ?? null,
    maxAgeHours:
      r.maxAgeHours !== undefined
        ? r.maxAgeHours
        : providerId === 'searchapi'
          ? 24
          : providerId === 'travelpayouts'
            ? 48
            : 0,
    vendorLink: null,
    reusedFromExecutionId: null,
  } as const;
}

/** Calendar rows of a real provider kind (SearchApi date grid by default) fetched by the execution; 'fixture' is synthetic. */
export function seedCalendar(f: Fixture, executionId: string, rows: CalendarSeed[]): number[] {
  return f.repos.calendarPrices.insert(
    executionId,
    rows.map((r) => calendarRow(f, r)),
  );
}

/**
 * One discovery tile through CellsRepo.writeTile, so the priced outcome can carry `lastError` (decision 30: a tile the
 * page cap cut short leads its last_error with core's TRUNCATED_NOTE).
 */
export function seedTile(
  f: Fixture,
  executionId: string,
  rows: CalendarSeed[],
  lastError: string | null,
): void {
  const prices = rows.map((r) => calendarRow(f, r));
  const providerId = prices[0]?.providerId ?? 'searchapi';
  f.repos.cells.seed(
    executionId,
    rows.map((r) => ({ ...r.cell, nights: 14 })),
    [providerId],
  );
  f.repos.cells.writeTile(executionId, providerId, {
    tileIndex: 0,
    cells: rows.map((r) => r.cell),
    prices: [...prices],
    outcomes: prices.map((p) => ({
      ...p.cell,
      status: 'priced',
      reason: null,
      lastError,
      fetchedAt: p.fetchedAt,
      minPence: p.pricePence,
      cabin: p.cabin,
      pointOfSale: p.pointOfSale,
      sourceKind: p.sourceKind,
    })),
    discards: 0,
  });
}

/**
 * Copies the newest earlier SearchApi date-grid price of `cell` into the execution, as the engine's reuse does
 * (spec §8.1: original fetchedAt, reused_from_execution_id set). A reused row is never an alert candidate.
 */
export function seedReused(
  f: Fixture,
  def: SearchDefinition,
  executionId: string,
  cell: Cell,
  newerThan: IsoDateTime,
): void {
  const criteria = { pointOfSale: 'GB', sourceKind: 'scraped-aggregate', newerThan } as const;
  const copies = f.repos.calendarPrices.reuseCandidates(
    def.id,
    'searchapi',
    'economy',
    criteria.pointOfSale,
    criteria.sourceKind,
    [cell],
    newerThan,
  );
  f.repos.cells.seed(executionId, [cell], ['searchapi']);
  f.repos.cells.copyReused(executionId, 'searchapi', copies, criteria);
}

export const ALL_FIELDS: SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'fareConditions',
  'seller',
  'price',
];

export interface ObservationSeed {
  departureDate: IsoDate;
  pricePence: number;
  flight?: number;
  seller?: string;
  fetchedAt?: IsoDateTime;
  suppliedFields?: SuppliedField[];
  booking?: Booking;
  bookingExpiresAt?: IsoDateTime | null;
  synthetic?: boolean;
  /** Default 'unknown', as SearchApi itinerary results carry (decision 24). */
  maxAgeHours?: number | 'unknown';
}

/** One BA nonstop LHR→JFK round trip of 14 nights, its offer and one observation (SearchApi itinerary age: unknown). */
export function seedObservation(
  f: Fixture,
  executionId: string,
  o: ObservationSeed,
): { offerId: number; observationId: number; itineraryHash: string } {
  const returnDate = addDays(o.departureDate, 14);
  const flight = o.flight ?? 117;
  const outbound: Segment[] = [
    {
      marketingCarrier: 'BA',
      flightNumber: flight,
      from: LHR,
      to: JFK,
      departLocal: `${o.departureDate}T08:25`,
      arriveLocal: `${o.departureDate}T11:20`,
      durationMinutes: 475,
    },
  ];
  const inbound: Segment[] = [
    {
      marketingCarrier: 'BA',
      flightNumber: flight + 1,
      from: JFK,
      to: LHR,
      departLocal: `${returnDate}T18:30`,
      arriveLocal: `${addDays(returnDate, 1)}T06:35`,
      durationMinutes: 425,
    },
  ];
  const hash = itineraryHash(outbound, inbound);
  const it: NormalisedItinerary = {
    hash,
    origin: LHR,
    destination: JFK,
    departureDate: o.departureDate,
    returnDate,
    nights: 14,
    outbound,
    inbound,
    outboundMinutes: 475,
    inboundMinutes: 425,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    airportChange: false,
    marketingCarriers: ['BA'],
  };
  f.repos.itineraries.upsertItinerary(it);
  const providerId: ProviderId = o.synthetic === true ? 'fixture' : 'searchapi';
  const r = f.repos.itineraries.recordObservation(
    { itineraryHash: hash, providerId, seller: o.seller ?? 'British Airways', cabin: 'economy' },
    {
      executionId,
      // why: decision 24 — SearchApi itinerary results carry maxAgeHours 'unknown'
      provenance: {
        providerId,
        sourceKind: o.synthetic === true ? 'synthetic' : 'scraped-search',
        fetchedAt: o.fetchedAt ?? f.clock.now(),
        maxAgeHours: o.maxAgeHours ?? 'unknown',
        fx: { converted: false },
        pointOfSale: 'GB',
        cabin: 'economy',
      },
      pricePence: o.pricePence,
      priceNativeMinor: o.pricePence,
      currencyNative: 'GBP',
      fx: { converted: false },
      taxesIncluded: true,
      selfTransfer: false,
      segmentCabins: ['economy', 'economy'],
      baggage: { cabinBag: 'included', checkedBags: 1 },
      fareConditions: null,
      booking: o.booking ?? { kind: 'none' },
      bookingExpiresAt: o.bookingExpiresAt ?? null,
      suppliedFields: o.suppliedFields ?? ALL_FIELDS,
      partialExpansion: false,
    },
  );
  return { ...r, itineraryHash: hash };
}

/**
 * Selects `selected` for itinerary search; the first `searched` come back empty (an itinerary search with no fares,
 * which counts as itinerary-searched), the rest end in error, as a completed run leaves them.
 */
export function seedVerificationCoverage(
  f: Fixture,
  executionId: string,
  selected: Cell[],
  searched: number,
): void {
  f.repos.cells.seed(executionId, selected, []);
  f.repos.cells.seedVerification(
    executionId,
    selected.map((cell) => ({ cell, reason: 'top_n' })),
    selected,
    ['searchapi'],
  );
  selected.forEach((cell, i) => {
    if (i < searched) searchedEmpty(f, executionId, cell);
    else
      f.repos.cells.setOutcome(executionId, cell, 'verification', 'searchapi', {
        status: 'error',
        reason: 'upstream',
      });
  });
}

/** An itinerary search of `cell` by the execution that found no fares (an `empty` verification outcome). */
export function searchedEmpty(f: Fixture, executionId: string, cell: CellKey): void {
  f.repos.cells.writeVerifiedCell(executionId, 'searchapi', {
    cell,
    outcome: {
      ...cell,
      status: 'empty',
      reason: null,
      lastError: null,
      fetchedAt: f.clock.now(),
      minPence: null,
      cabin: 'economy',
      pointOfSale: 'GB',
      sourceKind: 'scraped-search',
    },
    itineraries: [],
  });
}

/** Creates an enabled alert rule (calendar, absolute, £500 by default). */
export function seedRule(
  f: Fixture,
  def: SearchDefinition,
  over: Partial<Omit<AlertRule, 'id' | 'definitionId'>> = {},
): AlertRule {
  return f.repos.alerts.create({
    definitionId: def.id,
    type: 'absolute',
    thresholdPence: 50000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
    ...over,
  });
}

/** The runner's payload on an event row, parsed with core's schema (decision 56: one schema, no local copies). */
export function payloadOf(e: { payload: unknown }): AlertEventPayload {
  return apiContract.alertEventPayloadSchema.parse(e.payload);
}
```

`packages/engine/test/alerts/runner.digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cellAt,
  cells,
  fixture,
  hoursBefore,
  LGW,
  NOW,
  payloadOf,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedReused,
  seedRule,
  seedVerificationCoverage,
} from './fixtures.js';

describe('one digest per rule per execution (spec §6.8, §9 item 4)', () => {
  it('50 qualifying calendar cells under one absolute rule → one digest, top 10 + 40 more, 50 notified events sharing a digest id', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 50000, basis: 'calendar' });
    seedCalendar(
      f,
      ex,
      cells(50).map((cell, i) => ({ cell, pricePence: 40000 + i * 100 })),
    );
    // why: LGW cells keep the verification caveat's cells distinct from the 50 LHR calendar cells.
    seedVerificationCoverage(f, ex, cells(10, LGW), 3);

    const result = await runAlerts(f.deps, ex);

    expect(result).toEqual({ digests: 1, events: 50 });
    expect(f.notifier.sent).toHaveLength(1);
    const [sent] = f.notifier.digests();
    expect(sent?.digest).toMatchObject({
      ruleId: rule.id,
      executionId: ex,
      definitionId: def.id,
      basis: 'calendar',
      restCount: 40,
    });
    expect(sent?.digest.items.map((i) => i.pricePence)).toEqual([
      40000, 40100, 40200, 40300, 40400, 40500, 40600, 40700, 40800, 40900,
    ]);
    expect(sent?.digest.coverageCaveat).toEqual({ itinerarySearched: 3, selected: 10, expandTop: 2 });
    expect(sent?.subject).toBe(
      '[get-me-there] £400 LHR→JFK 1 Nov–15 Nov (14n) · Google date grid via SearchApi · fetched just now · provider age unknown (≤24h before that) · constraints not checked',
    );
    expect(sent?.body).toContain('and 40 more');
    expect(sent?.body).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');

    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 1000 });
    expect(events).toHaveLength(50);
    expect(new Set(events.map((e) => e.status))).toEqual(new Set(['notified']));
    expect(new Set(events.map((e) => payloadOf(e).digestId)).size).toBe(1);
    expect(
      events.every(
        (e) => payloadOf(e).executionId === ex && e.calendarPriceId !== null && e.observationId === null,
      ),
    ).toBe(true);
  });

  it('only calendar prices fetched by this execution count: reused copies, other executions and other cabins are excluded', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const earlier = seedExecution(f, def);
    const list = cells(3);
    const [a, b, c] = [cellAt(list, 0), cellAt(list, 1), cellAt(list, 2)];
    seedCalendar(f, earlier, [{ cell: b, pricePence: 30000, fetchedAt: hoursBefore(NOW, 24) }]);
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 50000, basis: 'calendar' });
    seedReused(f, def, ex, b, hoursBefore(NOW, 48));
    seedCalendar(f, ex, [
      { cell: a, pricePence: 45000 },
      { cell: c, pricePence: 46000, cabin: 'business' },
    ]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[0]?.digest.items.map((i) => i.cell.departureDate)).toEqual([a.departureDate]);
  });

  it('a definition without a verification provider says so; a disabled rule sends nothing', async () => {
    const f = fixture();
    const def = seedDefinition(f, {
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
      verification: { maxCells: 0, topN: 0, alwaysInclude: [], expandTop: 2, bookingLinks: false },
    });
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 45000 });
    seedRule(f, def, { thresholdPence: 99999, enabled: false });
    seedCalendar(
      f,
      ex,
      cells(3).map((cell, i) => ({ cell, pricePence: i === 0 ? 40000 : 47000, providerId: 'travelpayouts' })),
    );
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[0]?.digest.coverageCaveat).toBeNull();
    expect(f.notifier.digests()[0]?.body).toContain(
      'Coverage: itinerary-searched 0 cells (no verification provider configured)',
    );
  });

  it('no qualifying price, no rule, or a deleted definition → nothing sent, nothing recorded', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedCalendar(
      f,
      ex,
      cells(2).map((cell) => ({ cell, pricePence: 60000 })),
    );
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    seedRule(f, def, { thresholdPence: 50000 });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    f.repos.definitions.softDelete(def.id);
    seedCalendar(f, ex, [{ cell: cellAt(cells(3), 2), pricePence: 100 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
  });
});
```

`packages/engine/test/alerts/text.test.ts` (every C0 and C1 point, U+007F, the separators, the bidi, zero-width and invisible format characters, a lone CR; review TS-14, sec-007):

```ts
import { describe, expect, it } from 'vitest';
import { cleanLine } from '../../src/notifiers/operatorTemplates.js';
import { controlFree, stripControl } from '../../src/text.js';

// Spec §8.3 "provider strings CRLF/control-stripped"; decision 21; review TS-14, sec-007, arch-wp11-006.
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const C0 = range(0x00, 0x1f);
const C1 = range(0x80, 0x9f);
const SEPARATORS = [0x2028, 0x2029];
// bidi embeddings, overrides and isolates; zero-width and invisible characters; the byte-order mark
const HIDDEN = [
  0x00ad,
  0x061c,
  0x180e,
  ...range(0x200b, 0x200f),
  ...range(0x202a, 0x202e),
  ...range(0x2060, 0x2064),
  ...range(0x2066, 0x206f),
  0xfeff,
];

describe('the engine cleaner (text.ts)', () => {
  it.each([...C0, 0x7f, ...C1, ...SEPARATORS].map((c) => [c.toString(16).padStart(4, '0'), c]))(
    'U+%s becomes a space',
    (_hex, c) => {
      expect(controlFree(`a${String.fromCodePoint(c)}b`)).toBe('a b');
      expect(stripControl(`a${String.fromCodePoint(c)}b`)).toBe('a b');
    },
  );

  it.each(HIDDEN.map((c) => [c.toString(16).padStart(4, '0'), c]))('U+%s is removed', (_hex, c) => {
    expect(controlFree(`a${String.fromCodePoint(c)}b`)).toBe('ab');
  });

  it('a lone CR, a lone LF and CRLF each become one space; runs collapse and the ends are trimmed', () => {
    expect(stripControl('one\rtwo')).toBe('one two');
    expect(stripControl('one\ntwo')).toBe('one two');
    expect(stripControl('  one\r\n\r\ntwo\t ')).toBe('one two');
  });

  it('controlFree keeps leading spaces (a body line keeps its indentation) and every other character', () => {
    expect(controlFree('   Seller: Café Ünïcode £412 → 東京 🛫')).toBe(
      '   Seller: Café Ünïcode £412 → 東京 🛫',
    );
  });

  it('a right-to-left override cannot reverse the host a reader sees', () => {
    expect(stripControl('www.google.com\u202Emoc.live\u202C')).toBe('www.google.commoc.live');
  });

  it("the operator templates' cleanLine is the same cleaner after URL stripping", () => {
    expect(cleanLine('paused\r\nBcc: x\u2028\u202Ey https://h.example/p?key=1')).toBe(
      'paused Bcc: x y https://h.example/p',
    );
  });
});
```

In WP7's `packages/engine/test/budget-breach.test.ts`, the two hook assertions name the pass: in "runs once after a completed pass with (deps, executionId); …" (retitled "… with (deps, executionId, pass); …") the call becomes `expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, done.id, { stop: 'completed' });`, and in the provider-month verification breach test `expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, e.id, { stop: 'budget' });`.

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts test/alerts/text.test.ts test/budget-breach.test.ts`. Expected: FAIL. `runner.digest.test.ts` cannot resolve `../../src/alerts/runner.js`; in `text.test.ts` all 100 fail: the cleaner cases with `TypeError: controlFree is not a function` (or `stripControl is not a function`), and "the operator templates' cleanLine is the same cleaner after URL stripping" on its expected text (the old cleanLine keeps U+2028 and U+202E); in `budget-breach.test.ts` the two edited tests fail with `AssertionError: expected "vi.fn()" to be called once with arguments: [ { config: { …(28) }, …(9) }, …(2) ]` and the other 13 stay green.

- [ ] **Step 3: Implement.**

In WP7's `packages/engine/src/text.ts`, add `stripControlChars` to the `@gmt/core` import and append:

```ts
/**
 * Unicode format characters that reorder or hide text in a plain-text mail client (sec-007): the soft hyphen, the
 * Arabic letter mark, the Mongolian vowel separator, the zero-width space, joiners and directional marks
 * (U+200B–U+200F), the bidi embeddings and overrides (U+202A–U+202E), the invisible operators (U+2060–U+2064), the
 * bidi isolates and deprecated format controls (U+2066–U+206F) and the byte-order mark. Removed, not replaced: they
 * have no width, so a space would add one.
 */
function isHiddenFormat(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x061c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/**
 * Text with no character that can start a header or a line, or reorder or hide text: every control character (core's
 * stripControlChars, the Unicode Cc set: C0, U+007F, C1; decision 21) and the line and paragraph separators
 * (U+2028, U+2029) become a space, one for one; the format characters of isHiddenFormat are removed. No trimming, so a
 * body line keeps its indentation. The one cleaner of the engine (spec §8.3): the email templates, the EmailNotifier
 * and the operator templates' cleanLine all use it.
 */
export function controlFree(s: string): string {
  let out = '';
  for (const ch of stripControlChars(s, ' ')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x2028 || code === 0x2029) out += ' ';
    else if (!isHiddenFormat(code)) out += ch;
  }
  return out;
}

/**
 * One line of provider-supplied text: controlFree, runs of spaces collapsed, trimmed. Spec §8.3: provider strings are
 * CRLF/control-stripped, so none can start a header or a line. URLs are left whole: validated links keep their query
 * in email (decision 10); the operator templates strip them first.
 */
export function stripControl(s: string): string {
  return controlFree(s).replace(/ {2,}/g, ' ').trim();
}
```

In WP7's `packages/engine/src/notifiers/operatorTemplates.ts`, the import becomes `import { type OperatorMessageKind, stripUrlsInText } from '@gmt/core';` plus `import { stripControl } from '../text.js';`, and `cleanLine` (with its doc comment) becomes:

```ts
/**
 * One line of provider- or operator-supplied text: URL query and userinfo stripped, then the engine's one cleaner
 * (text.ts stripControl: controls and line separators to a space, hidden format characters removed, runs collapsed;
 * spec §5.3, §8.3).
 */
export function cleanLine(s: string): string {
  return stripControl(stripUrlsInText(s));
}
```

In WP7's `packages/engine/src/types.ts`, add before `AlertsStepHook` and give the hook its third parameter:

```ts
/**
 * How the pass that runs the alerts step ended (decision 59): `completed`, or stopped by a budget cap (`budget`, the
 * paused_budget stop of decision 25). The alert runner says "a budget cap left … undone" only for the latter.
 */
export interface AlertsPass {
  stop: 'completed' | 'budget';
}
/** The alerts step of spec §8.1 ("alerts: evaluateAlertRules → persist events → notify digests"); WP11 provides runAlerts. */
export type AlertsStepHook = (
  deps: EngineDeps,
  executionId: string,
  pass: AlertsPass,
) => Promise<{ digests: number; events: number }>;
```

In WP7's `packages/engine/src/execute.ts` (`alertsStep`), the hook call becomes:

```ts
    const r = await ctx.alertsStep(ctx.deps, run.executionId, {
      stop: run.stop === null ? 'completed' : 'budget',
    });
```

`packages/engine/src/alerts/context.ts`:

```ts
/** What every part of the alert runner shares for one run of the alerts step (spec §6.8, §8.1). */
import type { DefinitionSnapshot, IsoDateTime, Logger, SearchDefinition } from '@gmt/core';
import type { AlertsPass, EngineDeps } from '../types.js';

/** What the runner needs from the engine's dependencies; EngineDeps satisfies it, so runAlerts is an AlertsStepHook. */
export type AlertRunnerDeps = Pick<
  EngineDeps,
  'config' | 'db' | 'repos' | 'providers' | 'notifiers' | 'clock' | 'log'
>;

/** One run of the alerts step over one execution. */
export interface AlertRunContext {
  deps: AlertRunnerDeps;
  log: Logger;
  now: IsoDateTime;
  executionId: string;
  definition: SearchDefinition;
  snapshot: DefinitionSnapshot;
  /** How the pass ended: the budget-stop lines and the retry wording depend on it (decision 59). */
  pass: AlertsPass;
}
```

`packages/engine/src/alerts/pools.ts` (the calendar pool; Tasks 11.3, 11.4 and 11.6 complete it):

```ts
/**
 * Alert candidates of one execution, per basis (spec §6.8): the calendar prices it fetched and the observations it
 * wrote, with each candidate's previous price and that price's provenance (decision 56).
 */
import {
  type AlertCandidate,
  type AlertEvent,
  type CalendarCandidate,
  daysBetween,
  type Provenance,
} from '@gmt/core';
import type { AlertRunContext } from './context.js';

/** A previous price with its provenance, for the email and the event payload. */
export interface PreviousPrice {
  pricePence: number;
  provenance: Provenance;
}

/** One basis's candidates, their previous prices by rowRef, and the fares left out because their price is unconfirmed. */
export interface Pool {
  candidates: AlertCandidate[];
  previous: ReadonlyMap<string, PreviousPrice>;
  unconfirmed: number;
}

/** A price row as alert_events references it: the one format (decision 59), for candidates and events alike. */
export function rowRefOf(r: Pick<AlertEvent, 'observationId' | 'calendarPriceId'>): string {
  return r.observationId !== null ? `observation:${r.observationId}` : `calendar:${r.calendarPriceId}`;
}

/** The candidate's row, as alert_events references it. */
export function rowRef(c: AlertCandidate): string {
  return rowRefOf({
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
  });
}

/** Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin. Spec §6.8. */
export function calendarPool(ctx: AlertRunContext): Pool {
  const candidates = ctx.deps.repos.calendarPrices
    .fetchedBy(ctx.executionId)
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map(
      (r): CalendarCandidate => ({
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: null,
      }),
    );
  return { candidates, previous: new Map(), unconfirmed: 0 };
}
```

`packages/engine/src/alerts/marks.ts` (complete from this task: every event stores its marks, which Task 11.7 renders):

```ts
/**
 * What the runner reads about each firing that core's DigestItem does not carry (spec §3, §8.1; decisions 25, 30, 54,
 * 55, 56): the stale threshold and verdict, "cheapest of the rows read", "not seen in latest search", and the run's
 * budget-stop facts.
 */
import {
  type AlertCandidate,
  type Cell,
  cellKeyString,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type Firing,
  isStale,
  isTruncated,
  type ProviderId,
  resultRowKey,
  type VerifiedCandidate,
} from '@gmt/core';
import type { AlertRunContext } from './context.js';
import { type Pool, rowRef } from './pools.js';
import type { ItemMarks } from './templates.js';

/** The marks of one firing plus the threshold its staleness was judged against (stored on the event, decision 56). */
export interface FiringMarks extends ItemMarks {
  staleThresholdHours: number;
}

/** The cell a candidate prices. */
export function cellOf(c: AlertCandidate): Cell {
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

/** The DigestItem rowKey core gives a candidate (resultRowKey): the itinerary hash, or `calendar:<id>`. */
export function rowKeyOf(c: AlertCandidate): string {
  return resultRowKey({
    itineraryHash: c.basis === 'verified' ? c.itinerary.hash : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
  });
}

/**
 * The stale threshold of a price (spec §8.1): STALE_AFTER_HOURS on the itinerary-search basis; on the calendar basis
 * CALENDAR_STALE_AFTER_HOURS, else the provider's refresh plus its declared age (0 when the vendor's age is unknown).
 * The same one-line pick as WP8's calendarThreshold (§13 item 3); the staleness rule itself is core's isStale.
 */
function staleThresholdHours(ctx: AlertRunContext, c: AlertCandidate): number {
  if (c.basis === 'verified') return ctx.deps.config.staleAfterHours;
  const configured = ctx.deps.config.calendarStaleAfterHours;
  if (configured !== null) return configured;
  const id: ProviderId = c.provenance.providerId;
  const refresh = ctx.snapshot.providers.discoveryRefreshHours[id] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
  const declared = ctx.deps.providers.find((p) => p.id === id)?.discovery?.info.maxAgeHours ?? 0;
  return refresh + (declared === 'unknown' ? 0 : declared);
}

/**
 * Spec §8.1 "not seen in latest search" (decision 54): the cell's newest priced|empty itinerary search is another
 * execution's (a child that verified the cell during this run) and that search has no observation of this offer.
 * `at` is that search's fetch instant, or null when the outcome records none (no age is invented, PA-6).
 * why: "superseded by a later search" cannot arise here — calendar candidates are this execution's own fetches, only
 * one parent runs per definition, children never discover, and the step runs before this execution's status is
 * written, so no newer discovery of the cell exists yet.
 */
function notSeenMark(
  ctx: AlertRunContext,
  c: VerifiedCandidate,
  offersOf: (executionId: string) => ReadonlySet<number>,
): ItemMarks['notSeenInLatest'] {
  const latest = ctx.deps.repos.itineraries.latestVerificationOutcomeForCell(
    ctx.definition.id,
    cellOf(c),
    ctx.snapshot.cabin,
  );
  if (latest === null || latest.executionId === ctx.executionId) return null;
  if (offersOf(latest.executionId).has(c.observation.offerId)) return null;
  return { at: latest.fetchedAt };
}

/** Marks for every firing, keyed by rowKeyOf: the digest renders them and every event row stores them. */
export function marksFor(
  ctx: AlertRunContext,
  firings: readonly Firing[],
  pool: Pool,
): Map<string, FiringMarks> {
  const truncated = new Set(
    ctx.deps.repos.cells
      .outcomes(ctx.executionId, { stage: 'discovery' })
      .filter((o) => isTruncated(o.lastError))
      .map((o) => `${o.providerId}|${cellKeyString(o)}`),
  );
  // why: one read of another execution's observations, however many firings share its cells (arch-wp11-013)
  const offers = new Map<string, ReadonlySet<number>>();
  const offersOf = (executionId: string): ReadonlySet<number> => {
    const known = offers.get(executionId);
    if (known !== undefined) return known;
    const ids = new Set(ctx.deps.repos.itineraries.writtenBy(executionId).map((o) => o.offerId));
    offers.set(executionId, ids);
    return ids;
  };
  const out = new Map<string, FiringMarks>();
  for (const { candidate: c } of firings) {
    const threshold = staleThresholdHours(ctx, c);
    const p = c.basis === 'verified' ? c.observation.provenance : c.provenance;
    out.set(rowKeyOf(c), {
      staleThresholdHours: threshold,
      // why: decisions 55, 56 — core's isStale by effective age; an unknown vendor age is aged by its fetch age alone
      stale: isStale(p, ctx.now, threshold) ? { thresholdHours: threshold } : null,
      truncated:
        c.basis === 'calendar' && truncated.has(`${c.provenance.providerId}|${cellKeyString(c.cell)}`),
      notSeenInLatest: c.basis === 'verified' ? notSeenMark(ctx, c, offersOf) : null,
      // why: decision 59 — DigestItem carries the previous price but not its provenance, so its '≈' travels here
      previousConverted: pool.previous.get(rowRef(c))?.provenance.fx.converted === true,
    });
  }
  return out;
}

/**
 * What the digest says about the pass (decision 59): whether the itinerary-search stage never ran although a
 * verification provider is configured (any cause: no outcome rows), and — only when the pass stopped on a budget cap
 * (decision 25) — how many cell searches the cap left undone (not_run or skipped:budget). When the stage never ran
 * the count is a lower bound: the unplanned stage's searches are not in it (review PA-2).
 */
export function passFacts(ctx: AlertRunContext): {
  budgetStop: { unsearched: number } | null;
  verificationNotRun: boolean;
} {
  const verificationNotRun =
    ctx.snapshot.providers.verification.length > 0 &&
    !ctx.deps.repos.cells.hasVerificationOutcomes(ctx.executionId);
  if (ctx.pass.stop !== 'budget') return { budgetStop: null, verificationNotRun };
  const unsearched = ctx.deps.repos.cells
    .outcomes(ctx.executionId)
    .filter((o) => o.status === 'not_run' || (o.status === 'skipped' && o.reason === 'budget')).length;
  return { budgetStop: { unsearched }, verificationNotRun };
}
```

`packages/engine/src/alerts/templates.ts` (the calendar half; Tasks 11.2 and 11.7 complete it):

```ts
/**
 * Plain-text alert email (spec §8.3). Core's buildDigest decides what is in a digest; this module decides the words.
 * Every provider-supplied string passes the engine's one cleaner (text.ts) before it is written.
 */
import {
  type AlertDigest,
  type AlertRule,
  type DigestItem,
  effectiveAge,
  formatAgeFull,
  formatDuration,
  formatPence,
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  type ResultBasis,
  sourceLabel,
  validateVendorUrl,
} from '@gmt/core';
import { stripControl } from '../text.js';

/**
 * What the runner reads about one digest item from the repositories, which `DigestItem` does not carry (spec §3, §8.1;
 * decisions 30, 36, 54, 55). Keyed by the item's `rowKey` in `DigestRenderInput.marks`.
 */
export interface ItemMarks {
  /** Stale by core's isStale against the basis threshold (decisions 55, 56); null when not stale. */
  stale: { thresholdHours: number } | null;
  /** The price came from a discovery tile the page cap cut short (decision 30): "cheapest of the rows read". */
  truncated: boolean;
  /** A newer itinerary search of the cell did not see this offer; `at` is when it searched, null when unrecorded. */
  notSeenInLatest: { at: IsoDateTime | null } | null;
  /** The previous price was FX-converted: it prints with '≈' like the current one (decision 59). */
  previousConverted: boolean;
}
export const NO_MARKS: ItemMarks = {
  stale: null,
  truncated: false,
  notSeenInLatest: null,
  previousConverted: false,
};

/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). Task 11.7 adds the marks. */
export interface DigestRenderInput {
  digest: AlertDigest;
  definitionName: string;
  appBaseUrl: string | null;
  now: IsoDateTime;
}

/** Longest provider-supplied string printed (seller, carrier, definition name): a hostile value cannot flood an email (sec-007). */
export const MAX_PROVIDER_TEXT = 200;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A provider string for one line: cleaned (text.ts stripControl) and cut at MAX_PROVIDER_TEXT characters with "…". */
function providerText(s: string): string {
  const chars = [...stripControl(s)];
  return chars.length > MAX_PROVIDER_TEXT
    ? `${chars.slice(0, MAX_PROVIDER_TEXT - 1).join('')}…`
    : chars.join('');
}

/** "14 Mar" from a calendar date or local date-time string; never through Date (spec §6.1). */
function day(d: string): string {
  const [, m, dd] = d.slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/** "AAA→BBB 14 Mar–28 Mar (14n)": the cell in words, without a price (the Alerts view's trip column). */
export function cellLine(cell: DigestItem['cell']): string {
  return `${cell.origin}→${cell.destination} ${day(cell.departureDate)}–${day(cell.returnDate)} (${cell.nights}n)`;
}

/** "£412 AAA→BBB 14 Mar–28 Mar (14n)", with "≈" when FX-converted (spec §11). */
export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string {
  return `${item.provenance.fx.converted ? '≈' : ''}${formatPence(item.pricePence)} ${cellLine(item.cell)}`;
}

/** The age in core's full form (spec §3; decision 55 labels an unknown vendor age "vendor's cache age unknown"). */
function ageLine(p: Provenance, now: IsoDateTime): string {
  return formatAgeFull(effectiveAge(p, now));
}

function verdictSegment(item: DigestItem): string {
  if (item.verdictClass === 'unchecked') return 'constraints not checked';
  const n = item.unverified.length;
  return `${n} constraint${n === 1 ? '' : 's'} unverified`;
}

/** Spec §8.3 subject for the digest's first (cheapest) item. */
export function renderSubject(item: DigestItem, now: IsoDateTime): string {
  return stripControl(
    `[get-me-there] ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, now)} · ${verdictSegment(item)}`,
  );
}

/**
 * The app URL of a results row with WP9's parameters (`view`, `def`, `basis`, `row`): under APP_BASE_URL (an https
 * base with no credentials, query or fragment, which core's config enforces; a path prefix is kept), else a relative
 * path (spec §12).
 */
export function appRowLink(
  appBaseUrl: string | null,
  definitionId: string,
  basis: ResultBasis,
  rowKey: string,
): string {
  const query = new URLSearchParams({ view: 'results', def: definitionId, basis, row: rowKey }).toString();
  if (appBaseUrl === null) return `/?${query}`;
  const u = new URL(appBaseUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/`;
  u.search = query;
  return u.toString();
}

/**
 * Core's labelled search link, re-validated at render like a booking link (sec-005): https on the provider's
 * LINK_ALLOWLIST and the host core stored; spec §5.3 keeps its query in email. Null only for synthetic rows.
 */
function searchLine(item: DigestItem): string {
  const link = item.searchLink;
  if (link === null) return 'Link: none';
  const checked = validateVendorUrl(link.url, LINK_ALLOWLIST[item.provenance.providerId]);
  return checked.kind === 'get' && checked.host === link.host
    ? `Link: ${checked.url} (host ${checked.host}, ${link.label})`
    : 'Link: none (the search link failed validation)';
}

/** "fetched 3d before this price", or "under an hour"; fetchGapHours is the gap between two fetches (decision 21), never an age. */
function gapText(gap: number): string {
  return gap < 1
    ? 'fetched under an hour before this price'
    : `fetched ${formatDuration(gap)} before this price`;
}

function previousLine(item: DigestItem): string | null {
  if (item.previousPricePence === null) return null;
  const gap = item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`;
  return `   Previous: ${formatPence(item.previousPricePence)}${gap}`;
}

/** Lines specific to the item's basis; Task 11.2 adds the itinerary-search branch. */
function basisLines(_item: DigestItem): string[] {
  return ['   calendar price, no itinerary; constraints not checked'];
}

/** Task 11.2 adds the itinerary-search links. */
function linkLine(item: DigestItem, _input: DigestRenderInput): string {
  return searchLine(item);
}

function itemLines(n: number, item: DigestItem, input: DigestRenderInput): string[] {
  const lines = [
    `${n}. ${routeLine(item)}`,
    `   Why: ${stripControl(item.firingReason)}`,
    ...basisLines(item),
  ];
  const prev = previousLine(item);
  if (prev !== null) lines.push(prev);
  lines.push(`   Provenance: ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}`);
  lines.push(`   ${linkLine(item, input)}`);
  return lines;
}

function amount(pence: number | null): string {
  // why: core's evaluateAlertRules refuses a rule without its figure before anything renders; never print "£0" for it
  return pence === null ? 'an amount not set' : formatPence(pence);
}

function ruleText(r: AlertRule): string {
  const what =
    r.type === 'absolute'
      ? `alert when the price is ${amount(r.thresholdPence)} or less`
      : r.type === 'dropAbs'
        ? `alert when the price drops by ${amount(r.thresholdPence)} or more`
        : `alert when the price drops by ${r.pct === null ? 'a percentage not set' : `${r.pct}%`} or more`;
  const basis =
    r.basis === 'calendar'
      ? 'calendar basis, constraints not checked'
      : r.requireAllVerified === true
        ? 'itinerary-search basis, class verified only'
        : 'itinerary-search basis, class verified or partially-verified';
  return `${what} · ${basis} · cooldown ${r.cooldownHours}h`;
}

function coverageText(c: AlertDigest['coverageCaveat']): string {
  return c === null
    ? 'Coverage: itinerary-searched 0 cells (no verification provider configured)'
    : `Coverage: itinerary-searched ${c.itinerarySearched} of ${c.selected} cells, ${c.expandTop} outbounds each`;
}

/** One line per new item; the out-of-window previous price, when core states one, with its fetch gap (spec §6.8). */
function newItemLine(item: DigestItem, input: DigestRenderInput): string {
  const prev =
    item.previousPricePence === null
      ? ''
      : ` · previous ${formatPence(item.previousPricePence)}${item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`}`;
  return `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${prev}`;
}

/** Spec §8.3 body; LF line endings only. */
export function renderBody(input: DigestRenderInput): string {
  const d = input.digest;
  const lines = [`get-me-there alert for "${providerText(input.definitionName)}"`, ''];
  d.items.forEach((item, i) => {
    lines.push(...itemLines(i + 1, item, input), '');
  });
  if (d.restCount > 0) lines.push(`and ${d.restCount} more`, '');
  if (d.newItems.length > 0) {
    lines.push('New since the last check (no earlier price within the comparison window; not a drop):');
    for (const item of d.newItems) lines.push(newItemLine(item, input));
    if (d.newRestCount > 0) lines.push(`and ${d.newRestCount} more new cells`);
    lines.push('');
  }
  lines.push(coverageText(d.coverageCaveat), `Rule: ${ruleText(d.rule)}`);
  return lines.join('\n');
}
```

`packages/engine/src/alerts/runner.ts`:

```ts
/**
 * The alerts step of the execution lifecycle (spec §8.1) and the engine side of spec §6.8: gather candidates per basis
 * from the current execution (pools.ts), evaluate rules (core), persist the firings as `queued` events, build one
 * structured digest per rule (core), render it (templates.ts), send it to every notifier, then mark the events
 * `notified` (decision 56). The engine calls it when a pass completes and when it pauses for a budget cap (decision
 * 25), before the status write.
 */
import { randomUUID } from 'node:crypto';
import {
  type AlertEvent,
  type AlertEventPayload,
  type AlertRule,
  buildDigest,
  cellKeyString,
  evaluateAlertRules,
  type Firing,
  hoursSince,
  type Notifier,
  type ResultBasis,
} from '@gmt/core';
import { LogNotifier } from '../notifiers/log.js';
import type { AlertsPass } from '../types.js';
import type { AlertRunContext, AlertRunnerDeps } from './context.js';
import { cellOf, type FiringMarks, marksFor, rowKeyOf } from './marks.js';
import { calendarPool, type Pool, rowRef } from './pools.js';
import { cellLine, renderBody, renderSubject } from './templates.js';

export type { AlertRunnerDeps } from './context.js';
/** Digests sent or attempted, and alert_events rows this run inserted or moved to a new status. */
export interface AlertRunResult {
  digests: number;
  events: number;
}

const NONE: AlertRunResult = { digests: 0, events: 0 };

/**
 * Runs every enabled rule of the execution's definition once. Never rejects (spec §8.1: alerts never block completion).
 * `pass` is how the pass ended (WP7's AlertsStepHook passes it); a direct call defaults to a completed pass.
 */
export async function runAlerts(
  deps: AlertRunnerDeps,
  executionId: string,
  pass: AlertsPass = { stop: 'completed' },
): Promise<AlertRunResult> {
  try {
    const execution = deps.repos.executions.get(executionId);
    if (execution === null) throw new Error(`execution ${executionId} not found`);
    const definition = deps.repos.definitions.get(execution.definitionId);
    if (definition === null || definition.deletedAt !== null) return NONE;
    const rules = deps.repos.alerts.rules(definition.id).filter((r) => r.enabled);
    if (rules.length === 0) return NONE;
    const ctx: AlertRunContext = {
      deps,
      log: deps.log.child({ executionId, definitionId: definition.id }),
      now: deps.clock.now(),
      executionId,
      definition,
      snapshot: execution.snapshot,
      pass,
    };
    const pools = new Map<ResultBasis, Pool>();
    const poolFor = (basis: ResultBasis): Pool => {
      const cached = pools.get(basis);
      if (cached !== undefined) return cached;
      // why: the itinerary-search pool is gathered from Task 11.3 on; until then a verified rule has no candidates.
      const pool: Pool =
        basis === 'calendar' ? calendarPool(ctx) : { candidates: [], previous: new Map(), unconfirmed: 0 };
      pools.set(basis, pool);
      return pool;
    };
    let digests = 0;
    let events = 0;
    for (const rule of rules) {
      try {
        const r = await runRule(ctx, rule, poolFor(rule.basis));
        digests += r.digests;
        events += r.events;
      } catch (err) {
        // why: one broken rule must not stop the others.
        ctx.log.error(
          { ruleId: rule.id, err: err instanceof Error ? err.message : String(err) },
          'alerts: rule failed; other rules continue',
        );
      }
    }
    return { digests, events };
  } catch (err) {
    deps.log.error(
      { executionId, err: err instanceof Error ? err.message : String(err) },
      'alerts: step failed; execution still completes',
    );
    return NONE;
  }
}

/** The event row (insert form) of one firing; the payload is core's alertEventPayloadSchema shape (decision 56). */
function eventRow(
  ctx: AlertRunContext,
  f: Firing,
  pool: Pool,
  marks: ReadonlyMap<string, FiringMarks>,
  status: 'queued' | 'suppressed',
  digestId: string | null,
): Omit<AlertEvent, 'id'> {
  const c = f.candidate;
  const m = marks.get(rowKeyOf(c));
  if (m === undefined) throw new Error(`alerts: no marks for ${rowKeyOf(c)}`);
  const provenance = c.basis === 'verified' ? c.observation.provenance : c.provenance;
  const payload: AlertEventPayload = {
    digestId,
    executionId: ctx.executionId,
    pricePence: c.basis === 'verified' ? c.observation.pricePence : c.pricePence,
    provenance,
    previous: pool.previous.get(rowRef(c)) ?? null,
    isNew: f.isNew,
    route: cellLine(cellOf(c)),
    verdictClass:
      c.basis === 'calendar'
        ? 'unchecked'
        : c.verdictClass === 'verified'
          ? 'verified'
          : 'partially-verified',
    unverified: c.basis === 'verified' ? c.unverified : [],
    reason: {
      kind: f.isNew ? 'new' : f.rule.type === 'absolute' ? 'threshold' : 'drop',
      gapHours: c.previous === null ? null : hoursSince(c.previous.fetchedAt, provenance.fetchedAt),
    },
    staleThresholdHours: m.staleThresholdHours,
    truncated: m.truncated,
    notSeenInLatest: m.notSeenInLatest,
  };
  return {
    ruleId: f.rule.id,
    identityKey: f.identityKey,
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
    dedupKey: f.dedupKey,
    firedAt: ctx.now,
    status,
    reason: status === 'suppressed' ? (f.suppressed?.reason ?? null) : f.reason,
    payload,
  };
}

async function runRule(ctx: AlertRunContext, rule: AlertRule, pool: Pool): Promise<AlertRunResult> {
  // why: no prior firings and no earlier pass until Task 11.5.
  const firings = evaluateAlertRules([rule], pool.candidates, [], {
    now: ctx.now,
    executionId: ctx.executionId,
    cabin: ctx.snapshot.cabin,
    discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  const marks = marksFor(ctx, firings, pool);
  const sendable = firings.filter((f) => f.suppressed === null);
  // why: plan decision 10 — "new" listings alone are not a digest.
  if (!sendable.some((f) => !f.isNew)) return NONE;
  return deliver(ctx, rule, { firings, sendable, pool, marks });
}

/** "itinerary-searched K of N cells, E outbounds each" for this execution; null without a verification provider. */
function coverageFor(
  ctx: AlertRunContext,
): { itinerarySearched: number; selected: number; expandTop: number } | null {
  if (ctx.snapshot.providers.verification.length === 0) return null;
  const selected = ctx.deps.repos.cells.selected(ctx.executionId).length;
  const searched = new Set(
    ctx.deps.repos.cells
      .outcomes(ctx.executionId, { stage: 'verification' })
      .filter((o) => o.status === 'priced' || o.status === 'empty')
      .map((o) => cellKeyString(o)),
  );
  return { itinerarySearched: searched.size, selected, expandTop: ctx.snapshot.verification.expandTop };
}

/**
 * Spec §8.1 order, decisions 56 and 59: persist the firings as `queued` events (one transaction), send the digest, then
 * move each event on:
 * - every notifier accepted and one of them is not the log → `notified`, with this send's reason, fire time and digest
 *   id (a retried row no longer reads as failed);
 * - only the log notifier exists (no SMTP configured) → `suppressed`, "email not configured", which the cooldown never
 *   counts;
 * - a notifier refused or threw (including the hourly ceiling) → still `queued`, the failure in its reason (Task 11.5
 *   adds the retry and says in the reason whether one will come).
 * Every emailed item has an event, "new" listings included (PA-5).
 */
async function deliver(
  ctx: AlertRunContext,
  rule: AlertRule,
  run: {
    firings: Firing[];
    sendable: Firing[];
    pool: Pool;
    marks: ReadonlyMap<string, FiringMarks>;
  },
): Promise<AlertRunResult> {
  const digest = buildDigest(rule, run.firings, {
    executionId: ctx.executionId,
    definitionId: ctx.definition.id,
    coverageCaveat: coverageFor(ctx),
  });
  const first = digest?.items[0];
  if (digest === null || first === undefined) return NONE;
  const digestId = randomUUID();
  const ids = ctx.deps.db.transaction(() =>
    run.sendable.map((f) =>
      ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, run.pool, run.marks, 'queued', digestId)),
    ),
  );
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
  });
  const outcome = await sendToAll(ctx.deps.notifiers, {
    kind: 'digest',
    digest,
    subject: renderSubject(first, ctx.now),
    body,
  });
  const emailed = ctx.deps.notifiers.some((n) => !(n instanceof LogNotifier));
  run.sendable.forEach((f, i) => {
    const id = ids[i];
    if (id === undefined) return;
    if (outcome.status === 'failed')
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'queued',
        reason: `${f.reason}; not delivered: ${outcome.detail}`,
      });
    else if (!emailed)
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'suppressed',
        reason: `${f.reason}; email not configured`,
      });
    else
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'notified',
        reason: f.reason,
        firedAt: ctx.now,
        digestId,
      });
  });
  return { digests: 1, events: ids.length };
}

/** Sends to every notifier; `sent` only when every notifier accepted the message. */
async function sendToAll(
  notifiers: readonly Notifier[],
  msg: Parameters<Notifier['send']>[0],
): Promise<{ status: 'sent' } | { status: 'failed'; detail: string }> {
  const failures: string[] = [];
  if (notifiers.length === 0) failures.push('no notifier configured');
  for (const n of notifiers) {
    try {
      const r = await n.send(msg);
      if (!r.ok) failures.push(`${n.id}: ${r.detail ?? 'not delivered'}`);
    } catch (err) {
      failures.push(`${n.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failures.length === 0 ? { status: 'sent' } : { status: 'failed', detail: failures.join('; ') };
}
```

In `packages/engine/src/index.ts`, replace the barrel comment (the first line) with:

```ts
// Barrel for @gmt/engine (plan contract "Engine"); the alert runner, templates and EmailNotifier are WP11's.
export { type AlertRunnerDeps, type AlertRunResult, runAlerts } from './alerts/runner.js';
export {
  appRowLink,
  type DigestRenderInput,
  type ItemMarks,
  NO_MARKS,
  renderBody,
  renderSubject,
  routeLine,
} from './alerts/templates.js';
```

and add `AlertsPass` to its `export type { … } from './types.js'` list, before `AlertsStepHook`.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 104 tests (4 in `runner.digest.test.ts`, 100 in `text.test.ts`); then `pnpm --filter @gmt/engine exec vitest run test/notifications.test.ts test/budget-breach.test.ts`, which stay green (15 in `budget-breach.test.ts`).

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert runner persists, sends and marks one digest per rule per execution; the engine's one cleaner; the hook names the pass (spec §6.8, §8.1, §8.3; decision 59)"`

### Task 11.2: Itinerary-search item lines, link re-validation, hostile strings, exact digests, banned words

**Files:** Modify `packages/engine/src/alerts/templates.ts`. Create `packages/engine/test/alerts/builders.ts` and `packages/engine/test/alerts/templates.test.ts`.

**Interfaces:** Consumes `CONSTRAINT_LABELS` (with `priceConfirmed`), `hoursSince` (WP8), `validateVendorUrl`, `LINK_ALLOWLIST`, `sourceLabel`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`.

- [ ] **Step 1: Write the failing test.** The builders hand-build digest items with no database. The itinerary-search item is a SearchApi price, whose vendor age is `'unknown'` (spec rev 15, decision 24), so its age reads "fetched 5h ago · vendor's cache age unknown" (core's wording after WP8, decision 55); the calendar item keeps the spec §8.3 example's "(≤7d before that)". Two tests compare a whole rendered digest with `toBe` (review TS-13).

`packages/engine/test/alerts/builders.ts`:

```ts
/** Hand-built digest items for template and notifier tests (no database). Worked example only. */
import {
  type AlertDigest,
  type AlertRule,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type DigestItem,
} from '@gmt/core';
import type { DigestRenderInput } from '../../src/alerts/templates.js';

export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
export const HASH = 'a'.repeat(64);
const LHR = asIata('LHR');
const JFK = asIata('JFK');
const CELL = {
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate('2027-03-14'),
  returnDate: asIsoDate('2027-03-28'),
  nights: 14,
};
const SEARCH = {
  url: 'https://www.google.com/travel/flights?q=LHR+JFK+2027-03-14+2027-03-28',
  host: 'www.google.com',
  label: 'search link, not a fare link',
};

/** A SearchApi itinerary-search item: maxAgeHours 'unknown' (spec rev 15, decision 24), one constraint unverified. */
export function verifiedItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    pricePence: 41200,
    cell: CELL,
    verdictClass: 'partially-verified',
    itineraryHash: HASH,
    seller: 'British Airways',
    unverified: ['checkedBagRequired'],
    provenance: {
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
      fetchedAt: asIsoDateTime('2026-10-14T10:00:00.000Z'),
      maxAgeHours: 'unknown',
      fx: { converted: false },
      pointOfSale: 'GB',
      cabin: 'economy',
    },
    previousPricePence: null,
    fetchGapHours: null,
    isNew: false,
    firingReason: '£412 is at or below the £450 threshold',
    booking: { kind: 'get', url: 'https://www.google.com/travel/clk?tfs=abc', host: 'www.google.com' },
    searchLink: SEARCH,
    bookingExpiresAt: asIsoDateTime('2026-10-14T18:00:00.000Z'),
    rowKey: HASH,
    outbound: [
      {
        marketingCarrier: 'BA',
        flightNumber: 117,
        from: LHR,
        to: JFK,
        departLocal: '2027-03-14T08:25',
        arriveLocal: '2027-03-14T11:20',
        durationMinutes: 475,
      },
    ],
    inbound: [
      {
        marketingCarrier: 'BA',
        flightNumber: 112,
        from: JFK,
        to: LHR,
        departLocal: '2027-03-28T18:30',
        arriveLocal: '2027-03-29T06:35',
        durationMinutes: 425,
      },
    ],
    ...over,
  };
}

// why: maxAgeHours 168 reproduces the spec §8.3 example text "(≤7d before that)"; Travelpayouts itself declares 48 (spec §2).
export function calendarItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    pricePence: 38900,
    cell: CELL,
    verdictClass: 'unchecked',
    itineraryHash: null,
    seller: null,
    unverified: [],
    provenance: {
      providerId: 'travelpayouts',
      sourceKind: 'authorised-cached',
      fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'),
      maxAgeHours: 168,
      fx: { converted: false },
      pointOfSale: 'unknown',
      cabin: 'economy',
    },
    previousPricePence: null,
    fetchGapHours: null,
    isNew: false,
    firingReason: '£389 is at or below the £450 threshold',
    booking: { kind: 'none' },
    searchLink: {
      url: 'https://www.aviasales.com/search/LON1403NYC28031',
      host: 'www.aviasales.com',
      label: 'search link, not a fare link',
    },
    bookingExpiresAt: null,
    outbound: null,
    inbound: null,
    rowKey: 'calendar:5',
    ...over,
  };
}

export const RULE: AlertRule = {
  id: 'rule-1',
  definitionId: 'def-1',
  type: 'absolute',
  thresholdPence: 45000,
  pct: null,
  basis: 'verified',
  requireAllVerified: false,
  cooldownHours: 336,
  enabled: true,
};

export function digestOf(items: DigestItem[], over: Partial<AlertDigest> = {}): AlertDigest {
  return {
    ruleId: RULE.id,
    definitionId: 'def-1',
    executionId: 'ex-1',
    basis: 'verified',
    items,
    restCount: 0,
    newItems: [],
    newRestCount: 0,
    coverageCaveat: { itinerarySearched: 3, selected: 10, expandTop: 2 },
    rule: RULE,
    ...over,
  };
}

export function renderInput(over: Partial<DigestRenderInput> = {}): DigestRenderInput {
  return {
    digest: digestOf([verifiedItem()]),
    definitionName: 'London to New York (worked example)',
    appBaseUrl: null,
    now: NOW,
    ...over,
  };
}
```

`packages/engine/test/alerts/templates.test.ts`:

```ts
import {
  asIsoDate,
  asIsoDateTime,
  BANNED_WORD_ALLOWLIST,
  CONSTRAINT_LABELS,
  findBannedWords,
  type Segment,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { appRowLink, MAX_PROVIDER_TEXT, renderBody, renderSubject } from '../../src/alerts/templates.js';
import { calendarItem, digestOf, HASH, NOW, RULE, renderInput, verifiedItem } from './builders.js';

/** The worked example's outbound segment with a hostile carrier string. */
function hostileSegment(marketingCarrier: string): Segment {
  const { cell } = verifiedItem();
  return {
    marketingCarrier,
    flightNumber: 117,
    from: cell.origin,
    to: cell.destination,
    departLocal: '2027-03-14T08:25',
    arriveLocal: '2027-03-14T11:20',
  };
}

const ROW = `/?view=results&def=def-1&basis=verified&row=${HASH}`;
const VERIFIED_SUBJECT =
  "[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown · 1 constraint unverified";

describe('subject formats (spec §8.3)', () => {
  it("itinerary-search basis: a SearchApi itinerary price's vendor age is unknown (spec rev 15; decision 55 wording)", () => {
    expect(renderSubject(verifiedItem(), NOW)).toBe(VERIFIED_SUBJECT);
  });
  it('calendar basis: the spec §8.3 example, provider age bound and "constraints not checked"', () => {
    expect(renderSubject(calendarItem(), NOW)).toBe(
      '[get-me-there] £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · constraints not checked',
    );
  });
  it('class verified, plural unverified, an unconfirmed price, ≈ for FX-converted prices', () => {
    expect(renderSubject(verifiedItem({ verdictClass: 'verified', unverified: [] }), NOW)).toMatch(
      / · class verified$/,
    );
    expect(
      renderSubject(verifiedItem({ unverified: ['checkedBagRequired', 'noSelfTransfer'] }), NOW),
    ).toMatch(/ · 2 constraints unverified$/);
    expect(
      renderSubject(verifiedItem({ unverified: ['priceConfirmed', 'checkedBagRequired'] }), NOW),
    ).toMatch(/ · price not confirmed by the final step$/);
    const fx = verifiedItem({
      provenance: {
        ...verifiedItem().provenance,
        fx: { converted: true, rateNano: 790_000_000, rateDate: asIsoDate('2026-10-13'), source: 'ecb' },
      },
    });
    expect(renderSubject(fx, NOW)).toContain('≈£412 LHR→JFK');
  });
  it('hostile provider strings never reach the subject: it is exactly the plain one (review TS-9, TS-14)', () => {
    const hostile = verifiedItem({
      seller: 'Cheap\r\nBcc: victim@example.org\u202E',
      firingReason: 'x\r\nSubject: y',
      booking: {
        kind: 'get',
        url: 'https://www.google.com/travel/clk?tfs=abc',
        host: 'www.google.com\r\nX: 1',
      },
      outbound: [hostileSegment('B\u0000A\u200B')],
    });
    expect(renderSubject(hostile, NOW)).toBe(VERIFIED_SUBJECT);
  });
});

describe('itinerary-search item body (spec §8.3)', () => {
  it('a whole one-item digest, exactly (review TS-13)', () => {
    expect(renderBody(renderInput({ digest: digestOf([verifiedItem()], { restCount: 2 }) }))).toBe(
      [
        'get-me-there alert for "London to New York (worked example)"',
        '',
        '1. £412 LHR→JFK 14 Mar–28 Mar (14n)',
        '   Why: £412 is at or below the £450 threshold',
        '   Seller: British Airways',
        '   Outbound: BA 117 LHR 08:25 → JFK 11:20 (14 Mar)',
        '   Inbound: BA 112 JFK 18:30 → LHR 06:35 (28 Mar)',
        `   Verdicts: class partially-verified; unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`,
        "   Provenance: Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown",
        '   Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
        '',
        'and 2 more',
        '',
        'Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each',
        'Rule: alert when the price is £450 or less · itinerary-search basis, class verified or partially-verified · cooldown 336h',
      ].join('\n'),
    );
  });
  it('POST booking: links to the app results row (relative, absolute, under a path prefix), never the vendor form', () => {
    const post = verifiedItem({
      booking: {
        kind: 'post',
        url: 'https://www.google.com/travel/clk/f',
        postData: 'u=formdata',
        host: 'www.google.com',
      },
    });
    const relative = renderBody(renderInput({ digest: digestOf([post]) }));
    expect(relative).toContain(`get-me-there: ${ROW}`);
    expect(relative).not.toContain('u=formdata');
    expect(relative).not.toContain('https://www.google.com/travel/clk/f');
    expect(appRowLink(null, 'def-1', 'verified', HASH)).toBe(ROW);
    expect(appRowLink(null, 'def 1', 'calendar', 'calendar:5')).toBe(
      '/?view=results&def=def+1&basis=calendar&row=calendar%3A5',
    );
    expect(appRowLink('https://gmt.example.ts.net', 'def-1', 'verified', HASH)).toBe(
      `https://gmt.example.ts.net${ROW}`,
    );
    expect(appRowLink('https://gmt.example.ts.net/', 'def-1', 'verified', HASH)).toBe(
      `https://gmt.example.ts.net${ROW}`,
    );
    expect(appRowLink('https://example.org/gmt/', 'def-1', 'verified', HASH)).toBe(
      `https://example.org/gmt${ROW}`,
    );
    const absolute = renderBody(
      renderInput({ digest: digestOf([post]), appBaseUrl: 'https://gmt.example.ts.net/' }),
    );
    expect(absolute).toContain(`https://gmt.example.ts.net${ROW}`);
  });
  it('expiry states; no booking → labelled search link; a booking or search link that fails re-validation → no link', () => {
    const at = (over: Parameters<typeof verifiedItem>[0]) =>
      renderBody(renderInput({ digest: digestOf([verifiedItem(over)]) }));
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T13:00:00.000Z') })).toContain('expired 2h ago');
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T14:30:00.000Z') })).toContain('expired just now');
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T15:30:00.000Z') })).toContain(
      'expires within the hour',
    );
    expect(at({ bookingExpiresAt: null })).toContain('expiry not stated');
    expect(at({ booking: { kind: 'none' } })).toContain(
      'Link: https://www.google.com/travel/flights?q=LHR+JFK+2027-03-14+2027-03-28 (host www.google.com, search link, not a fare link)',
    );
    for (const booking of [
      { kind: 'get', url: 'http://www.google.com/x', host: 'www.google.com' },
      { kind: 'get', url: 'https://www.google.com.evil.example/x', host: 'www.google.com.evil.example' },
      { kind: 'get', url: 'https://www.google.com/x', host: 'www.aviasales.com' },
    ] as const) {
      const bad = at({ booking });
      expect(bad).not.toContain(booking.url);
      expect(bad).toContain('Link: none (the stored link failed validation)');
    }
    for (const searchLink of [
      { url: 'https://evil.example/flights', host: 'evil.example', label: 'search link, not a fare link' },
      {
        url: 'http://www.google.com/travel/flights',
        host: 'www.google.com',
        label: 'search link, not a fare link',
      },
    ]) {
      const bad = at({ booking: { kind: 'none' }, searchLink });
      expect(bad).not.toContain(searchLink.url);
      expect(bad).toContain('Link: none (the search link failed validation)');
    }
  });
  it('class verified says every constraint passed; an unconfirmed price is labelled in its verdicts and notes', () => {
    expect(
      renderBody(
        renderInput({ digest: digestOf([verifiedItem({ verdictClass: 'verified', unverified: [] })]) }),
      ),
    ).toContain('   Verdicts: class verified; every constraint passed');
    const body = renderBody(
      renderInput({ digest: digestOf([verifiedItem({ unverified: ['priceConfirmed'] })]) }),
    );
    expect(body).toContain(
      '   Verdicts: class partially-verified; unverified: price not confirmed by the final step',
    );
    expect(body).toContain('   Notes: price not confirmed by the final step');
  });
});

describe('calendar items (spec §6.8, §8.3)', () => {
  it('a whole calendar digest with a drop and a new cell whose previous price is outside the window, exactly (review TS-13, PA-9)', () => {
    const drop = calendarItem({
      previousPricePence: 43000,
      fetchGapHours: 72,
      firingReason: 'down £41 (9%) from £430 fetched 3d (72h) earlier',
    });
    const outOfWindow = calendarItem({
      isNew: true,
      rowKey: 'calendar:6',
      previousPricePence: 50000,
      fetchGapHours: 169,
    });
    const body = renderBody(
      renderInput({
        digest: digestOf([drop], {
          basis: 'calendar',
          coverageCaveat: null,
          newItems: [outOfWindow, calendarItem({ isNew: true, rowKey: 'calendar:7', pricePence: 39900 })],
          newRestCount: 4,
          rule: {
            ...RULE,
            type: 'dropAbs',
            thresholdPence: 2000,
            basis: 'calendar',
            requireAllVerified: null,
          },
        }),
      }),
    );
    expect(body).toBe(
      [
        'get-me-there alert for "London to New York (worked example)"',
        '',
        '1. £389 LHR→JFK 14 Mar–28 Mar (14n)',
        '   Why: down £41 (9%) from £430 fetched 3d (72h) earlier',
        '   calendar price, no itinerary; constraints not checked',
        '   Previous: £430, fetched 3d before this price',
        '   Provenance: Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
        '   Link: https://www.aviasales.com/search/LON1403NYC28031 (host www.aviasales.com, search link, not a fare link)',
        '',
        'New since the last check (no earlier price within the comparison window; not a drop):',
        '- £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · previous £500, fetched 7d before this price',
        '- £399 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
        'and 4 more new cells',
        '',
        'Coverage: itinerary-searched 0 cells (no verification provider configured)',
        'Rule: alert when the price drops by £20 or more · calendar basis, constraints not checked · cooldown 336h',
      ].join('\n'),
    );
  });
  it('a gap under an hour reads "under an hour", never "just now"', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem({ previousPricePence: 43000, fetchGapHours: 0 })], {
          coverageCaveat: null,
        }),
      }),
    );
    expect(body).toContain('   Previous: £430, fetched under an hour before this price');
  });
});

describe('provider strings are CRLF/control-stripped and bounded (spec §8.3; review TS-14, sec-007)', () => {
  it('a seller, carrier, definition name or reason cannot inject headers or lines, reorder text or flood the body', () => {
    const item = verifiedItem({
      seller: 'Cheap Seats\r\nBcc: victim@example.org\u0007\u202E',
      firingReason: '£412 is at or below the £450 threshold\rX-Injected: 1',
      outbound: [hostileSegment('B\u0085A\u200B')],
    });
    const body = renderBody(
      renderInput({ digest: digestOf([item]), definitionName: 'Trip\r\nX-Injected: 1\u2028Y\u2066' }),
    );
    const hostile = [0x0d, 0x07, 0x85, 0x2028, 0x202e, 0x2066, 0x200b];
    expect([...body].filter((ch) => hostile.includes(ch.codePointAt(0) ?? 0))).toEqual([]);
    expect(body.split('\n').filter((l) => /^(Bcc|X-Injected|Y)\b/.test(l))).toEqual([]);
    expect(body).toContain('get-me-there alert for "Trip X-Injected: 1 Y"');
    expect(body).toContain('   Seller: Cheap Seats Bcc: victim@example.org');
    expect(body).toContain('   Why: £412 is at or below the £450 threshold X-Injected: 1');
    expect(body).toContain('   Outbound: B A 117 LHR 08:25 → JFK 11:20 (14 Mar)');
    const long = renderBody(renderInput({ digest: digestOf([verifiedItem({ seller: 'S'.repeat(500) })]) }));
    expect(long).toContain(`   Seller: ${'S'.repeat(MAX_PROVIDER_TEXT - 1)}…\n`);
  });
});

describe('banned words over rendered output (spec §8.3, §11)', () => {
  it('no banned word in any rendered subject or body', () => {
    const outputs = [
      renderSubject(verifiedItem(), NOW),
      renderSubject(calendarItem(), NOW),
      renderSubject(verifiedItem({ unverified: ['priceConfirmed'] }), NOW),
      renderBody(
        renderInput({
          digest: digestOf([verifiedItem()], { restCount: 40, newItems: [calendarItem({ isNew: true })] }),
        }),
      ),
      renderBody(
        renderInput({
          digest: digestOf([calendarItem({ previousPricePence: 43000, fetchGapHours: 0 })], {
            coverageCaveat: null,
          }),
        }),
      ),
      renderBody(
        renderInput({
          digest: digestOf([
            verifiedItem({
              booking: {
                kind: 'post',
                url: 'https://www.google.com/f',
                postData: 'x',
                host: 'www.google.com',
              },
            }),
          ]),
        }),
      ),
    ];
    for (const text of outputs) expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts`.

Expected: FAIL, 6 failed and 6 passed.

Failing first (test, then its first assertion message):

- "class verified, plural unverified, an unconfirmed price, ≈ for FX-converted prices": `AssertionError: expected '[get-me-there] £412 LHR→JFK 14 Mar–28…' to match / · class verified$/`
- "a whole one-item digest, exactly (review TS-13)": `AssertionError: expected 'get-me-there alert for "London to New…' to be 'get-me-there alert for "London to New…' // Object.is equality`
- "POST booking: links to the app results row (relative, absolute, under a path prefix), never the vendor form": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'get-me-there: /?view=results&def=def-…'`
- "expiry states; no booking → labelled search link; a booking or search link that fails re-validation → no link": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'expired 2h ago'`
- "class verified says every constraint passed; an unconfirmed price is labelled in its verdicts and notes": `AssertionError: expected 'get-me-there alert for "London to New…' to contain '   Verdicts: class verified; every co…'`
- "a seller, carrier, definition name or reason cannot inject headers or lines, reorder text or flood the body": `AssertionError: expected 'get-me-there alert for "Trip X-Inject…' to contain '   Seller: Cheap Seats Bcc: victim@ex…'`

Green from the start, because Task 11.1 already renders calendar items, both subject formats and hostile-free subjects:

- "itinerary-search basis: a SearchApi itinerary price's vendor age is unknown (spec rev 15; decision 55 wording)"
- "calendar basis: the spec §8.3 example, provider age bound and "constraints not checked""
- "hostile provider strings never reach the subject: it is exactly the plain one (review TS-9, TS-14)"
- "a whole calendar digest with a drop and a new cell whose previous price is outside the window, exactly (review TS-13, PA-9)"
- "a gap under an hour reads "under an hour", never "just now""
- "no banned word in any rendered subject or body"

- [ ] **Step 3: Implement.** Five edits to `templates.ts`; each shows the full replacement. `expiryText` and `agoText` measure whole hours with core's `hoursSince`, the one whole-hour helper (decision 59).

In `templates.ts`, the `@gmt/core` import becomes:

```ts
import {
  type AlertDigest,
  type AlertRule,
  CONSTRAINT_LABELS,
  type DigestItem,
  effectiveAge,
  formatAgeFull,
  formatDuration,
  formatPence,
  hoursSince,
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  type ResultBasis,
  type Segment,
  sourceLabel,
  validateVendorUrl,
} from '@gmt/core';
```

Replace `verdictSegment` with:

```ts
function verdictSegment(item: DigestItem): string {
  if (item.verdictClass === 'unchecked') return 'constraints not checked';
  // why: decisions 37, 44 — an unconfirmed price says so wherever it renders; the runner never alerts on one.
  if (item.unverified.includes('priceConfirmed')) return CONSTRAINT_LABELS.priceConfirmed;
  if (item.verdictClass === 'verified') return 'class verified';
  const n = item.unverified.length;
  return `${n} constraint${n === 1 ? '' : 's'} unverified`;
}
```

Replace the Task 11.1 `basisLines` and `linkLine` (with their doc comments) with these functions:

```ts
function segmentLine(s: Segment): string {
  const hhmm = (local: string) => local.slice(11, 16);
  return `${providerText(s.marketingCarrier)} ${s.flightNumber} ${s.from} ${hhmm(s.departLocal)} → ${s.to} ${hhmm(s.arriveLocal)} (${day(s.departLocal)})`;
}

function expiryText(expiresAt: IsoDateTime | null, now: IsoDateTime): string {
  if (expiresAt === null) return 'expiry not stated';
  if (Date.parse(expiresAt) > Date.parse(now)) {
    const h = hoursSince(now, expiresAt);
    return h < 1 ? 'expires within the hour' : `expires in ${formatDuration(h)}`;
  }
  const h = hoursSince(expiresAt, now);
  return h < 1 ? 'expired just now' : `expired ${formatDuration(h)} ago`;
}

/**
 * A booking link re-validated at render (spec §5.2, decision 54): core's validateVendorUrl against the provider's
 * LINK_ALLOWLIST, and the host the adapter stored. A POST booking links to the app's results row instead (spec §8.3).
 */
function verifiedLinkLine(item: DigestItem, input: DigestRenderInput): string {
  const b = item.booking;
  if (b.kind === 'post') {
    const row = appRowLink(input.appBaseUrl, input.digest.definitionId, 'verified', item.rowKey);
    return `Link: this fare is booked through a form, which email cannot submit; open the results row in get-me-there: ${row}`;
  }
  if (b.kind === 'none') return searchLine(item);
  const checked = validateVendorUrl(b.url, LINK_ALLOWLIST[item.provenance.providerId]);
  // why: spec §5.3 (rev 10) — a validated booking link keeps its query in email; it carries no credentials.
  return checked.kind === 'get' && checked.host === b.host
    ? `Link: ${checked.url} (host ${checked.host}, ${expiryText(item.bookingExpiresAt, input.now)})`
    : 'Link: none (the stored link failed validation)';
}

/** Lines specific to the item's basis: seller, segments and verdicts for itinerary-search items; a marker for calendar prices. */
function basisLines(item: DigestItem): string[] {
  if (item.verdictClass === 'unchecked') return ['   calendar price, no itinerary; constraints not checked'];
  return [
    `   Seller: ${providerText(item.seller ?? 'not stated')}`,
    item.outbound === null
      ? '   Segments: not available'
      : `   Outbound: ${item.outbound.map(segmentLine).join('; ')}`,
    ...(item.inbound === null ? [] : [`   Inbound: ${item.inbound.map(segmentLine).join('; ')}`]),
    item.verdictClass === 'verified'
      ? '   Verdicts: class verified; every constraint passed'
      : `   Verdicts: class ${item.verdictClass}; unverified: ${item.unverified.map((k) => CONSTRAINT_LABELS[k]).join(', ')}`,
  ];
}

/** Calendar items always carry `booking: none` (core's buildDigest), so their link is the labelled search link. */
function linkLine(item: DigestItem, input: DigestRenderInput): string {
  return item.verdictClass === 'unchecked' ? searchLine(item) : verifiedLinkLine(item, input);
}

/** The marks a reader needs beside the price (decisions 37, 44), in a fixed order; Task 11.7 adds the runner's. */
function notesOf(item: DigestItem, _input: DigestRenderInput): string[] {
  return item.unverified.includes('priceConfirmed') ? [CONSTRAINT_LABELS.priceConfirmed] : [];
}
```

Replace `itemLines` with:

```ts
function itemLines(n: number, item: DigestItem, input: DigestRenderInput): string[] {
  const lines = [
    `${n}. ${routeLine(item)}`,
    `   Why: ${stripControl(item.firingReason)}`,
    ...basisLines(item),
  ];
  const prev = previousLine(item);
  if (prev !== null) lines.push(prev);
  lines.push(`   Provenance: ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}`);
  const notes = notesOf(item, input);
  if (notes.length > 0) lines.push(`   Notes: ${notes.join('; ')}`);
  lines.push(`   ${linkLine(item, input)}`);
  return lines;
}
```

Replace `newItemLine` (with its doc comment) with:

```ts
/** One line per new item; the out-of-window previous price, when core states one, with its fetch gap (spec §6.8). */
function newItemLine(item: DigestItem, input: DigestRenderInput): string {
  const prev =
    item.previousPricePence === null
      ? ''
      : ` · previous ${formatPence(item.previousPricePence)}${item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`}`;
  const notes = notesOf(item, input);
  return `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${prev}${notes.length > 0 ? ` · ${notes.join('; ')}` : ''}`;
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 116 tests (12 in `templates.test.ts`).

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: itinerary-search email lines, link re-validation, hostile strings, exact digests and the banned-word test over rendered output"`

### Task 11.3: Itinerary-search basis: current-execution observations, requireAllVerified, drops against a confirmed price, unconfirmed prices

**Files:** Modify `packages/engine/src/alerts/pools.ts` and `runner.ts`. Test `packages/engine/test/alerts/runner.verified.test.ts`.

**Interfaces:** Consumes `ItinerariesRepo.writtenBy`, `ItinerariesRepo.previousObservation`, `evaluateConstraints`, `verdictClass`, `unverifiedNames`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.verified.test.ts`:

```ts
import { asIsoDate, CONSTRAINT_LABELS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  ALL_FIELDS,
  fixture,
  hoursBefore,
  NOW,
  payloadOf,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

const WITHOUT_BAGGAGE = ALL_FIELDS.filter((x) => x !== 'baggage'); // checkedBagRequired → unverified
const UNCONFIRMED = ALL_FIELDS.filter((x) => x !== 'price'); // decisions 27, 37: the final step did not confirm the price

function scenario() {
  const f = fixture();
  const def = seedDefinition(f);
  const earlier = seedExecution(f, def);
  // A was seen at £500 a week ago; C was written by the earlier execution only, so it is never a candidate of the next one
  seedObservation(f, earlier, {
    departureDate: asIsoDate('2026-11-02'),
    pricePence: 50000,
    flight: 117,
    fetchedAt: hoursBefore(NOW, 168),
  });
  seedObservation(f, earlier, {
    departureDate: asIsoDate('2026-11-04'),
    pricePence: 30000,
    flight: 115,
    fetchedAt: hoursBefore(NOW, 168),
  });
  const ex = seedExecution(f, def);
  // A: £420 now, every constraint passes → class verified
  const a = seedObservation(f, ex, {
    departureDate: asIsoDate('2026-11-02'),
    pricePence: 42000,
    flight: 117,
  });
  // B: first seen now at £410, baggage not supplied → partially-verified
  const b = seedObservation(f, ex, {
    departureDate: asIsoDate('2026-11-03'),
    pricePence: 41000,
    flight: 177,
    suppliedFields: WITHOUT_BAGGAGE,
  });
  return { f, def, ex, a, b };
}

describe('itinerary-search basis (spec §6.8)', () => {
  it('candidates are observations written by the current execution; identity is (ruleId, itineraryHash)', async () => {
    const { f, def, ex, a, b } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(events.map((e) => e.identityKey).sort()).toEqual(
      [`${rule.id}|${a.itineraryHash}`, `${rule.id}|${b.itineraryHash}`].sort(),
    );
    expect(events.every((e) => e.observationId !== null && e.calendarPriceId === null)).toBe(true);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(`unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`);
    expect(body).toContain('Outbound: BA 117 LHR 08:25 → JFK 11:20 (2 Nov)');
  });

  it('requireAllVerified admits class verified only', async () => {
    const { f, def, ex, a } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: true });
    await runAlerts(f.deps, ex);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => e.identityKey)).toEqual([
      `${rule.id}|${a.itineraryHash}`,
    ]);
  });

  it('a drop compares the offer with its previous observation; a first sighting cannot drop', async () => {
    const { f, def, ex, b } = scenario();
    const rule = seedRule(f, def, {
      basis: 'verified',
      type: 'dropPct',
      thresholdPence: null,
      pct: 10,
      requireAllVerified: false,
    });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(event === undefined ? null : payloadOf(event)).toMatchObject({
      pricePence: 42000,
      previous: { pricePence: 50000 },
      reason: { kind: 'drop', gapHours: 168 },
      isNew: false,
    });
    expect(event?.reason).toBe('down £80 (16%) from £500 fetched 7d (168h) earlier');
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Previous: £500, fetched 7d before this price');
    // why: only calendar cells have a "new" section (spec §6.8); an offer seen for the first time is not listed
    expect(body).not.toContain('New since the last check');
    expect(
      f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).some((e) => e.observationId === b.observationId),
    ).toBe(false);
  });

  it('the cheapest eligible offer per itinerary represents it once (core settles identities, rev 11)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 44000,
      seller: 'British Airways',
    });
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 43000,
      seller: 'An agency',
    });
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(
      f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => payloadOf(e).pricePence),
    ).toEqual([43000]);
  });

  it('an unconfirmed price never fires, however cheap (decisions 27, 37, 45)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const cheap = seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 20000,
      seller: 'An agency',
      suppliedFields: UNCONFIRMED,
    });
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 44000, flight: 177 });
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 100 })
        .some((e) => e.observationId === cheap.observationId),
    ).toBe(false);
    expect(f.notifier.digests()[0]?.digest.items.map((i) => i.pricePence)).toEqual([44000]);
    // an execution with only unconfirmed prices sends nothing
    const next = seedExecution(f, def);
    seedObservation(f, next, {
      departureDate: asIsoDate('2026-11-05'),
      pricePence: 20000,
      flight: 119,
      suppliedFields: UNCONFIRMED,
    });
    expect(await runAlerts(f.deps, next)).toEqual({ digests: 0, events: 0 });
  });
});

describe('the drop baseline and the event payload (decisions 37, 45, 56; review PA-1, PA-3)', () => {
  it('a drop is measured against the newest earlier confirmed price: an unconfirmed one in between is walked past', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const older = seedExecution(f, def);
    seedObservation(f, older, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 45000,
      fetchedAt: hoursBefore(NOW, 336),
    });
    const earlier = seedExecution(f, def);
    seedObservation(f, earlier, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 50000,
      fetchedAt: hoursBefore(NOW, 168),
      suppliedFields: UNCONFIRMED,
    });
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    // £80 below the unconfirmed £500 would fire; only £30 below the confirmed £450 does not
    seedRule(f, def, { basis: 'verified', type: 'dropAbs', thresholdPence: 5000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    const rule = seedRule(f, def, {
      basis: 'verified',
      type: 'dropAbs',
      thresholdPence: 2000,
      requireAllVerified: false,
    });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(event?.reason).toBe('down £30 (6%) from £450 fetched 2w (336h) earlier');
    expect(event === undefined ? null : payloadOf(event).previous?.pricePence).toBe(45000);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Previous: £450, fetched 2w before this price');
    expect(body).not.toContain('£500');
    expect(JSON.stringify(event?.payload)).not.toContain('50000');
  });

  it('only an unconfirmed earlier price: the offer has no previous price, so a drop rule cannot fire', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const earlier = seedExecution(f, def);
    seedObservation(f, earlier, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 50000,
      fetchedAt: hoursBefore(NOW, 168),
      suppliedFields: UNCONFIRMED,
    });
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    seedRule(f, def, { basis: 'verified', type: 'dropAbs', thresholdPence: 1000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
  });

  it("the payload carries the verdict class, every unverified constraint, the previous price's provenance and the reason parts", async () => {
    const { f, def, ex, a, b } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const byObservation = new Map(
      f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => [e.observationId, payloadOf(e)]),
    );
    expect(byObservation.get(a.observationId)).toMatchObject({
      verdictClass: 'verified',
      unverified: [],
      pricePence: 42000,
      previous: {
        pricePence: 50000,
        provenance: { fetchedAt: hoursBefore(NOW, 168), sourceKind: 'scraped-search' },
      },
      reason: { kind: 'threshold', gapHours: 168 },
      route: 'LHR→JFK 2 Nov–16 Nov (14n)',
    });
    expect(byObservation.get(b.observationId)).toMatchObject({
      verdictClass: 'partially-verified',
      unverified: ['checkedBagRequired'],
      previous: null,
      reason: { kind: 'threshold', gapHours: null },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.verified.test.ts`.

Expected: FAIL, 7 failed and 1 passed.

Failing first (test, then its first assertion message):

- "candidates are observations written by the current execution; identity is (ruleId, itineraryHash)": `AssertionError: expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 2 }`
- "requireAllVerified admits class verified only": `AssertionError: expected [] to deeply equal [ Array(1) ]`
- "a drop compares the offer with its previous observation; a first sighting cannot drop": `AssertionError: expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 1 }`
- "the cheapest eligible offer per itinerary represents it once (core settles identities, rev 11)": `AssertionError: expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 1 }`
- "an unconfirmed price never fires, however cheap (decisions 27, 37, 45)": `AssertionError: expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 1 }`
- "a drop is measured against the newest earlier confirmed price: an unconfirmed one in between is walked past": `AssertionError: expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 1 }`
- "the payload carries the verdict class, every unverified constraint, the previous price's provenance and the reason parts": `AssertionError: expected undefined to match object { verdictClass: 'verified', …(5) }`

Green from the start, because an empty itinerary-search pool sends nothing, which is also what that test expects:

- "only an unconfirmed earlier price: the offer has no previous price, so a drop rule cannot fire"

- [ ] **Step 3: Implement.** In `pools.ts`:

In `pools.ts`, the `@gmt/core` import becomes:

```ts
import {
  type AlertCandidate,
  type AlertEvent,
  type CalendarCandidate,
  daysBetween,
  evaluateConstraints,
  type Observation,
  type Provenance,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

Add at the end of `pools.ts`:

```ts
/**
 * The offer's newest earlier observation whose price the final step confirmed (PA-1): a drop is never measured against
 * an unconfirmed price, so unconfirmed ones are walked past.
 */
function confirmedPrevious(ctx: AlertRunContext, offerId: number, before: Observation): Observation | null {
  let prev = ctx.deps.repos.itineraries.previousObservation(offerId, before.provenance.fetchedAt);
  while (prev !== null && !prev.suppliedFields.includes('price'))
    prev = ctx.deps.repos.itineraries.previousObservation(offerId, prev.provenance.fetchedAt);
  return prev;
}

/**
 * Observations written by this execution in the snapshot's cabin, verdicts recomputed against the current definition
 * (spec §6.2), failed excluded; previous = the offer's newest earlier confirmed observation. Spec §6.8.
 * why: an offer whose price the final step did not confirm (`price` not supplied) is never alerted on (decisions 27,
 * 37, 45); one that passes its other constraints is counted, so the digest can say so. Core settles each identity on
 * its cheapest eligible candidate (rev 11), so every other offer is passed; reducing here could drop the
 * class-verified offer a requireAllVerified rule needs in favour of a cheaper partially-verified one.
 */
export function verifiedPool(ctx: AlertRunContext): Pool {
  const candidates: VerifiedCandidate[] = [];
  const previous = new Map<string, PreviousPrice>();
  let unconfirmed = 0;
  for (const row of ctx.deps.repos.itineraries.writtenBy(ctx.executionId)) {
    if (row.offer.cabin !== ctx.snapshot.cabin) continue;
    const verdicts = evaluateConstraints(
      row.itinerary,
      row,
      ctx.definition.constraints,
      ctx.snapshot.cabin,
      row.suppliedFields,
    );
    const cls = verdictClass(verdicts);
    if (cls === 'failed') continue;
    if (!row.suppliedFields.includes('price')) {
      unconfirmed += 1;
      continue;
    }
    const prev = confirmedPrevious(ctx, row.offerId, row);
    const c: VerifiedCandidate = {
      basis: 'verified',
      observation: row,
      itinerary: row.itinerary,
      verdictClass: cls,
      unverified: unverifiedNames(verdicts),
      seller: row.seller,
      previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.provenance.fetchedAt },
    };
    if (prev !== null) previous.set(rowRef(c), { pricePence: prev.pricePence, provenance: prev.provenance });
    candidates.push(c);
  }
  if (unconfirmed > 0) ctx.log.info({ unconfirmed }, 'alerts: unconfirmed prices left out');
  return { candidates, previous, unconfirmed };
}
```

In `runner.ts`:

In `runner.ts`, replace the pool line in `runAlerts` (and its why line) with:

```ts
      const pool = basis === 'calendar' ? calendarPool(ctx) : verifiedPool(ctx);
```

and its pools import with:

```ts
import { calendarPool, type Pool, rowRef, verifiedPool } from './pools.js';
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 124 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: itinerary-search candidates, drops against the newest confirmed price, unconfirmed prices never alerted"`

### Task 11.4: Calendar basis: previous price, the 2 × discoveryRefreshHours window, the "new" section with its previous price

**Files:** Modify `packages/engine/src/alerts/pools.ts`. Test `packages/engine/test/alerts/runner.calendar.test.ts`.

**Interfaces:** Consumes `CalendarPricesRepo.previousFor`, `isoDateTimeOfEpochMs`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.calendar.test.ts`:

```ts
import { cellKeyString } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cellAt,
  cells,
  fixture,
  hoursBefore,
  NOW,
  payloadOf,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedRule,
} from './fixtures.js';

// why: discoveryRefreshHours 84 puts the spec §6.8 window (2 × refresh) at 168 h, the boundary spec §6.8 tests at 167/168/169 h.
function scenario() {
  const f = fixture();
  const def = seedDefinition(f, {
    providers: {
      discovery: ['searchapi'],
      verification: ['searchapi'],
      discoveryRefreshHours: { searchapi: 84 },
    },
  });
  const earlier = seedExecution(f, def);
  const list = cells(3);
  const [c167, c168, c169] = [cellAt(list, 0), cellAt(list, 1), cellAt(list, 2)];
  seedCalendar(f, earlier, [
    { cell: c167, pricePence: 50000, fetchedAt: hoursBefore(NOW, 167), maxAgeHours: 168 },
    { cell: c168, pricePence: 50000, fetchedAt: hoursBefore(NOW, 168), maxAgeHours: 168 },
    { cell: c169, pricePence: 50000, fetchedAt: hoursBefore(NOW, 169), maxAgeHours: 168 },
  ]);
  const ex = seedExecution(f, def);
  seedCalendar(
    f,
    ex,
    [c167, c168, c169].map((cell) => ({ cell, pricePence: 40000, maxAgeHours: 168 })),
  );
  return { f, def, ex, c167, c168, c169 };
}

describe('calendar basis (spec §6.8)', () => {
  it('drops compare only with a previous price fetched within 2 × discoveryRefreshHours (167 h, 168 h in; 169 h out)', async () => {
    const { f, def, ex, c167, c168, c169 } = scenario();
    const rule = seedRule(f, def, { type: 'dropAbs', thresholdPence: 5000, basis: 'calendar' });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 3 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    const drops = events.filter((e) => !payloadOf(e).isNew);
    expect(drops.map((e) => e.identityKey).sort()).toEqual(
      [c167, c168].map((c) => `${rule.id}|searchapi|economy|${cellKeyString(c)}`).sort(),
    );
    expect(
      drops.every((e) => payloadOf(e).previous?.pricePence === 50000 && (e.reason ?? '').includes('£500')),
    ).toBe(true);
    // absent-then-present (outside the window) is listed as new, never a drop; the body shows its previous price and
    // the fetch gap (spec §6.8; review PA-9), and the listing is recorded as a notified "new" event (PA-5)
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(
      'New since the last check (no earlier price within the comparison window; not a drop):',
    );
    expect(body).toContain(
      '- £400 LHR→JFK 3 Nov–17 Nov (14n) · Google date grid via SearchApi · fetched just now · provider age unknown (≤7d before that) · previous £500, fetched 7d before this price',
    );
    const listed = events.filter((e) => payloadOf(e).isNew);
    expect(listed.map((e) => [e.identityKey, e.status])).toEqual([
      [`${rule.id}|searchapi|economy|${cellKeyString(c169)}`, 'notified'],
    ]);
    expect(listed[0] === undefined ? null : payloadOf(listed[0])).toMatchObject({
      reason: { kind: 'new', gapHours: 169 },
      previous: { pricePence: 50000 },
    });
  });

  it('absolute rules still apply to an absent-then-present cell', async () => {
    const { f, def, ex, c169 } = scenario();
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 100 })
        .some((e) => e.identityKey.endsWith(cellKeyString(c169))),
    ).toBe(true);
  });

  it('a cell first seen by this execution under a drop rule is listed as new; with no drop at all nothing is sent', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 40000 }]);
    seedRule(f, def, { type: 'dropPct', thresholdPence: null, pct: 5, basis: 'calendar' });
    // why: plan decision 10 — "new" listings alone are not a digest
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
  });

  it('identity separates providers for the same cell', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const cell = cellAt(cells(1), 0);
    seedCalendar(f, ex, [
      { cell, pricePence: 40000, providerId: 'searchapi' },
      { cell, pricePence: 39000, providerId: 'travelpayouts' },
    ]);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 100 })
        .map((e) => e.identityKey)
        .sort(),
    ).toEqual(
      [
        `${rule.id}|searchapi|economy|${cellKeyString(cell)}`,
        `${rule.id}|travelpayouts|economy|${cellKeyString(cell)}`,
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.calendar.test.ts`.

Expected: FAIL, 1 failed and 3 passed.

Failing first (test, then its first assertion message):

- "drops compare only with a previous price fetched within 2 × discoveryRefreshHours (167 h, 168 h in; 169 h out)": `AssertionError: expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 3 }`

Green from the start, because they need no previous price: absolute rules, first sightings and identities:

- "absolute rules still apply to an absent-then-present cell"
- "a cell first seen by this execution under a drop rule is listed as new; with no drop at all nothing is sent"
- "identity separates providers for the same cell"

- [ ] **Step 3: Implement.** Three edits to `pools.ts`. The repository query takes no lower bound: core compares only within the window, in whole minutes, and lists a price whose previous fetch is older in the "new" section, where the email shows that previous price and the gap (review PA-9).

In `pools.ts`, add `isoDateTimeOfEpochMs` to the `@gmt/core` import:

```ts
import {
  type AlertCandidate,
  type AlertEvent,
  type CalendarCandidate,
  daysBetween,
  evaluateConstraints,
  isoDateTimeOfEpochMs,
  type Observation,
  type Provenance,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

Add after `Pool`:

```ts
/** previousFor's lower bound: none. Core judges the 2 × discoveryRefreshHours window itself (in whole minutes). */
const NO_LOWER_BOUND = isoDateTimeOfEpochMs(0);
```

Replace `calendarPool` (with its doc comment) with:

```ts
/**
 * Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin; previous =
 * the newest earlier fetch for (definition, provider, cabin, cell). Spec §6.8.
 * why: core compares only within 2 × discoveryRefreshHours and lists an older previous price in the "new" section with
 * its age, so the repository query has no lower bound.
 */
export function calendarPool(ctx: AlertRunContext): Pool {
  const previous = new Map<string, PreviousPrice>();
  const candidates = ctx.deps.repos.calendarPrices
    .fetchedBy(ctx.executionId)
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map((r): CalendarCandidate => {
      const prev = ctx.deps.repos.calendarPrices.previousFor(
        ctx.definition.id,
        r.providerId,
        r.cabin,
        r.cell,
        r.fetchedAt,
        NO_LOWER_BOUND,
      );
      const c: CalendarCandidate = {
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.fetchedAt },
      };
      if (prev !== null)
        previous.set(rowRef(c), { pricePence: prev.pricePence, provenance: prev.provenance });
      return c;
    });
  return { candidates, previous, unconfirmed: 0 };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 128 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: calendar-basis drops within 2 x discoveryRefreshHours; absent-then-present listed as new with its previous price"`

### Task 11.5: Cooldown across executions at its edges; queued events sent by the next pass; later passes never repeat

**Files:** Modify `packages/engine/src/alerts/runner.ts`. Test `packages/engine/test/alerts/runner.dedup.test.ts` (it uses Task 11.1's `RecordingNotifier.respondWith` and `onSend`).

**Interfaces:** Consumes `AlertsRepo.priorFirings`, `AlertsRepo.eventsForExecution`, `AlertsRepo.updateEvents`, `identityKey`, `Firing.suppressed`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.dedup.test.ts`. The cooldown is tested at 335, 336 and 337 hours (review TS-1), the minimum drop at its 5% side to the penny and on its £10 floor (TS-2), and identity settling across classes (TS-3: alerts settle each identity on its cheapest eligible offer whatever its class; the class → seen → price → age order is the results ranking, `dedupByItinerary`, WP2's tests).

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { LogNotifier } from '../../src/notifiers/log.js';
import {
  ALL_FIELDS,
  cellAt,
  cells,
  type Fixture,
  fixture,
  payloadOf,
  RecordingNotifier,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One calendar cell priced by a new execution of the definition at `pricePence`; returns its run result. */
async function runAt(f: Fixture, def: Parameters<typeof seedExecution>[1], pricePence: number) {
  const ex = seedExecution(f, def);
  seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence }]);
  return runAlerts(f.deps, ex);
}

describe('cooldown across executions (spec §6.8, §9 item 4)', () => {
  it('calendar basis: the same price band is suppressed with a reason until cooldownHours have passed, exactly (review TS-1)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 336 });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(335 * HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 0, events: 1 }); // same £412 band, 335 h later
    const suppressed = f.repos.alerts
      .events({ ruleId: rule.id, limit: 100 })
      .filter((e) => e.status === 'suppressed');
    expect(suppressed.map((e) => e.reason)).toEqual([
      'same price band alerted 13d (335h) ago; cooldown 2w (336h)',
    ]);
    // why: core's window is "fired less than cooldownHours ago", so at exactly 336 h the earlier firing no longer counts
    f.clock.advance(HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 0, events: 1 }); // 1 h after that firing: suppressed again
  });

  it('inside the cooldown a repeat needs max(£10, 5%) below the last fired price: the 5% side at ±1p (review TS-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 }); // step max(£10, ⌈5% of £412⌉ = £20.60)
    f.clock.advance(DAY);
    expect(await runAt(f, def, 43000)).toEqual({ digests: 0, events: 1 }); // dearer
    f.clock.advance(DAY);
    expect(await runAt(f, def, 39141)).toEqual({ digests: 0, events: 1 }); // £20.59 below
    f.clock.advance(DAY);
    expect(await runAt(f, def, 39140)).toEqual({ digests: 1, events: 1 }); // £20.60 below
  });

  it('under £200 the £10 floor applies (5% would be less): £9.99 below is suppressed, £10.00 below fires (review TS-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 20000, basis: 'calendar' });
    expect(await runAt(f, def, 15000)).toEqual({ digests: 1, events: 1 }); // 5% = £7.50 < £10
    f.clock.advance(DAY);
    expect(await runAt(f, def, 14001)).toEqual({ digests: 0, events: 1 });
    f.clock.advance(DAY);
    expect(await runAt(f, def, 14000)).toEqual({ digests: 1, events: 1 });
  });

  it('itinerary-search basis: the same itinerary and band in the next execution is suppressed', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const first = seedExecution(f, def);
    seedObservation(f, first, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    expect(await runAlerts(f.deps, first)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(7 * DAY);
    const second = seedExecution(f, def);
    seedObservation(f, second, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 0, events: 1 });
  });

  it('one identity is judged on its cheapest eligible offer whatever its class; class order is the results ranking, not alerts (review TS-3)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    // a class-verified offer at £440 and a cheaper partially-verified one (baggage not supplied) at £430, same itinerary
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 44000,
      seller: 'British Airways',
    });
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 43000,
      seller: 'An agency',
      suppliedFields: ALL_FIELDS.filter((x) => x !== 'baggage'),
    });
    const any = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const strict = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: true });
    await runAlerts(f.deps, ex);
    const firedAt = (ruleId: string) =>
      f.repos.alerts
        .events({ ruleId, limit: 10 })
        .map((e) => [payloadOf(e).pricePence, payloadOf(e).verdictClass]);
    expect(firedAt(any.id)).toEqual([[43000, 'partially-verified']]);
    expect(firedAt(strict.id)).toEqual([[44000, 'verified']]);
  });
});

describe('event lifecycle: queued before the send, notified after (spec §8.1; decision 56)', () => {
  it('events exist as queued while the notifier is sending, and are notified once it accepted', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const seen: string[][] = [];
    f.notifier.onSend = () =>
      seen.push(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => e.status));
    await runAt(f, def, 41200);
    expect(seen).toEqual([['queued']]);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => e.status)).toEqual(['notified']);
  });

  it('a failed send stays queued saying why and whether it is retried; the resumed pass resends it on the same row, rewritten (decision 59)', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 41200 }]);
    // a pass that stopped on a budget cap: the resumed pass will send it
    expect(await runAlerts(f.deps, ex, { stop: 'budget' })).toEqual({ digests: 1, events: 1 });
    const [queued] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(queued).toMatchObject({
      status: 'queued',
      reason:
        '£412 is at or below the £450 threshold; not delivered: email: connection refused; sent again when this run resumes',
    });
    const failedDigest = queued === undefined ? null : payloadOf(queued).digestId;
    // the resumed pass of the same execution retries it
    f.notifier.respondWith({ ok: true });
    f.clock.advance(HOUR);
    const resent = f.clock.now();
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests().map((d) => d.digest.items.map((i) => i.pricePence))).toEqual([
      [41200],
      [41200],
    ]);
    const [notified] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(notified).toMatchObject({
      id: queued?.id,
      status: 'notified',
      reason: '£412 is at or below the £450 threshold',
      firedAt: resent,
    });
    expect(notified === undefined ? null : payloadOf(notified).digestId).not.toBe(failedDigest);
    // and a third pass has nothing left to send
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
  });

  it('a queued (never delivered) firing does not suppress the next execution', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAt(f, def, 41200);
    f.notifier.respondWith({ ok: true });
    f.clock.advance(DAY);
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
  });
});

describe('a later pass of the same execution never repeats a firing or a listing (decisions 25, 55, 56)', () => {
  it('the second pass sends only prices the first pass did not record; with none, it sends and records nothing', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 1 });
    const list = cells(3);
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 41200 }]);
    // first pass: paused at a budget cap (the engine runs the alerts step on paused_budget)
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    // why: a cooldown shorter than the pause shows the guard is the earlier pass's event, not the cooldown
    f.clock.advance(2 * HOUR);
    seedCalendar(f, ex, [{ cell: cellAt(list, 1), pricePence: 42000 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[1]?.digest.items.map((i) => i.pricePence)).toEqual([42000]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 })).toHaveLength(2);
  });

  it('a "new" cell listed by the first pass is not listed again by the second (review PA-5)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { type: 'dropAbs', thresholdPence: 1000, basis: 'calendar' });
    const list = cells(3);
    const earlier = seedExecution(f, def);
    seedCalendar(f, earlier, [
      { cell: cellAt(list, 0), pricePence: 50000 },
      { cell: cellAt(list, 2), pricePence: 50000 },
    ]);
    f.clock.advance(HOUR);
    const ex = seedExecution(f, def);
    // first pass: a drop on cell 0 and a first sighting on cell 1
    seedCalendar(f, ex, [
      { cell: cellAt(list, 0), pricePence: 40000 },
      { cell: cellAt(list, 1), pricePence: 41000 },
    ]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    expect(f.notifier.digests()[0]?.digest.newItems.map((i) => i.pricePence)).toEqual([41000]);
    // second pass: a drop on cell 2 sends a digest; cell 1, already listed, is not listed again
    f.clock.advance(HOUR);
    seedCalendar(f, ex, [{ cell: cellAt(list, 2), pricePence: 42000 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[1]?.digest.items.map((i) => i.pricePence)).toEqual([42000]);
    expect(f.notifier.digests()[1]?.digest.newItems).toEqual([]);
  });

  it('a failure on a completed pass says it is not retried unless the run is resumed', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAt(f, def, 41200);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 1 })[0]?.reason).toBe(
      '£412 is at or below the £450 threshold; not delivered: email: connection refused; not retried unless this run is resumed',
    );
  });
});

describe('with no SMTP configured the digest only reaches the log (decision 59; review PA2-3)', () => {
  it('its firings are suppressed, "email not configured", and never start a cooldown', async () => {
    const f = fixture();
    f.deps.notifiers.splice(0, f.deps.notifiers.length, new LogNotifier(f.log));
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    expect(f.log.lines.some((l) => l.fields.kind === 'alert_digest')).toBe(true);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => [e.status, e.reason])).toEqual([
      ['suppressed', '£412 is at or below the £450 threshold; email not configured'],
    ]);
    // the same band a day later is not held back by a cooldown the operator never received
    f.clock.advance(DAY);
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => e.reason)).toEqual([
      '£412 is at or below the £450 threshold; email not configured',
      '£412 is at or below the £450 threshold; email not configured',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.dedup.test.ts`.

Expected: FAIL, 8 failed and 4 passed.

Failing first (test, then its first assertion message):

- "calendar basis: the same price band is suppressed with a reason until cooldownHours have passed, exactly (review TS-1)": `AssertionError: expected { digests: 1, events: 1 } to deeply equal { digests: +0, events: 1 }`
- "inside the cooldown a repeat needs max(£10, 5%) below the last fired price: the 5% side at ±1p (review TS-2)": `AssertionError: expected { digests: 1, events: 1 } to deeply equal { digests: +0, events: 1 }`
- "under £200 the £10 floor applies (5% would be less): £9.99 below is suppressed, £10.00 below fires (review TS-2)": `AssertionError: expected { digests: 1, events: 1 } to deeply equal { digests: +0, events: 1 }`
- "itinerary-search basis: the same itinerary and band in the next execution is suppressed": `AssertionError: expected { digests: 1, events: 1 } to deeply equal { digests: +0, events: 1 }`
- "a failed send stays queued saying why and whether it is retried; the resumed pass resends it on the same row, rewritten (decision 59)": `AssertionError: expected { id: 1, …(9) } to match object { status: 'queued', …(1) }`
- "the second pass sends only prices the first pass did not record; with none, it sends and records nothing": `AssertionError: expected { digests: 1, events: 2 } to deeply equal { digests: 1, events: 1 }`
- "a "new" cell listed by the first pass is not listed again by the second (review PA-5)": `AssertionError: expected { digests: 1, events: 3 } to deeply equal { digests: 1, events: 1 }`
- "a failure on a completed pass says it is not retried unless the run is resumed": `AssertionError: expected '£412 is at or below the £450 threshol…' to be '£412 is at or below the £450 threshol…' // Object.is equality`

Green from the start, because Task 11.1 already persists before the send and records a log-only digest as suppressed, a queued event never suppresses (no prior firings are read yet), and identity settling is core's:

- "one identity is judged on its cheapest eligible offer whatever its class; class order is the results ranking, not alerts (review TS-3)"
- "events exist as queued while the notifier is sending, and are notified once it accepted"
- "a queued (never delivered) firing does not suppress the next execution"
- "its firings are suppressed, "email not configured", and never start a cooldown"

- [ ] **Step 3: Implement.** Seven edits to `runner.ts`. A later pass of the same execution (after a paused_budget stop, or a retry-errors resume of a completed run) reads this rule's events for the execution through the db query, matches them to candidates through `pools.ts`'s one row-reference format (`rowRefOf`, review arch-wp11-r2-003), never judges again a row it notified or suppressed, and sends again on the same event row a firing whose send failed (decisions 25, 55, 56). Decision 59: a failure's reason says why the event is queued and whether a retry will come ("sent again when this run resumes" after a budget stop, "not retried unless this run is resumed" after a completed pass; nothing else resends a queued event), and a retry that succeeds rewrites the row's reason, fire time and digest id, so a delivered row never reads "not delivered" and its cooldown counts from the send that delivered it.

In `runner.ts`, add `type IsoDateTime`, `identityKey` and `isoDateTimeOfEpochMs` to the `@gmt/core` import:

```ts
import {
  type AlertEvent,
  type AlertEventPayload,
  type AlertRule,
  buildDigest,
  cellKeyString,
  evaluateAlertRules,
  type Firing,
  hoursSince,
  type IsoDateTime,
  identityKey,
  isoDateTimeOfEpochMs,
  type Notifier,
  type ResultBasis,
} from '@gmt/core';
```

Add after `NONE`:

```ts
const HOUR_MS = 3_600_000;
```

Add after `runAlerts`:

```ts
/** An instant `hours` before `at`. */
function hoursBefore(at: IsoDateTime, hours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) - hours * HOUR_MS);
}
```

and the pools import becomes:

```ts
import { calendarPool, type Pool, rowRef, rowRefOf, verifiedPool } from './pools.js';
```

Replace `runRule` with:

```ts
async function runRule(ctx: AlertRunContext, rule: AlertRule, pool: Pool): Promise<AlertRunResult> {
  // why: decisions 25, 56 — a row an earlier pass of this execution notified or suppressed is never judged again; one it
  // left queued (its send failed) is judged again and sent with this digest, reusing its event row.
  const earlier = ctx.deps.repos.alerts.eventsForExecution(rule.id, ctx.executionId);
  const done = new Set<string>();
  const queued = new Map<string, number>();
  for (const e of earlier) {
    if (e.status === 'queued') queued.set(rowRefOf(e), e.id);
    else done.add(rowRefOf(e));
  }
  const candidates = pool.candidates.filter((c) => !done.has(rowRef(c)));
  if (candidates.length === 0) return NONE;
  // why: spec §6.8 suppression looks back cooldownHours over this rule's notified firings for these identities.
  const prior = ctx.deps.repos.alerts.priorFirings(
    rule.id,
    [...new Set(candidates.map((c) => identityKey(rule, c)))],
    hoursBefore(ctx.now, rule.cooldownHours),
  );
  const firings = evaluateAlertRules([rule], candidates, prior, {
    now: ctx.now,
    executionId: ctx.executionId,
    cabin: ctx.snapshot.cabin,
    discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  const marks = marksFor(ctx, firings, pool);
  // why: plan pin — evaluateAlertRules returns suppressed firings too; the runner records them and the digest omits them.
  const suppressed = firings.filter((f) => f.suppressed !== null);
  const sendable = firings.filter((f) => f.suppressed === null);
  ctx.deps.db.transaction(() => {
    for (const f of suppressed) {
      const id = queued.get(rowRef(f.candidate));
      if (id === undefined)
        ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, pool, marks, 'suppressed', null));
      else
        ctx.deps.repos.alerts.updateEvents([id], {
          status: 'suppressed',
          reason: f.suppressed?.reason ?? null,
        });
    }
  });
  // why: plan decision 10 — "new" listings alone are not a digest.
  if (!sendable.some((f) => !f.isNew)) return { digests: 0, events: suppressed.length };
  const delivered = await deliver(ctx, rule, { firings, sendable, pool, marks, queued });
  return { digests: delivered.digests, events: delivered.events + suppressed.length };
}
```

Add before `deliver`'s doc comment:

```ts
/** Decision 59: why an event stays queued, and whether a later pass of this execution will send it. */
function retryText(ctx: AlertRunContext): string {
  return ctx.pass.stop === 'budget'
    ? 'sent again when this run resumes'
    : 'not retried unless this run is resumed';
}
```

Replace `deliver` (with its doc comment) with this version, which reuses an earlier pass's queued event row and says in a failure's reason whether a retry will come:

```ts
/**
 * Spec §8.1 order, decisions 56 and 59: persist the firings as `queued` events (one transaction), send the digest, then
 * move each event on:
 * - every notifier accepted and one of them is not the log → `notified`, with this send's reason, fire time and digest
 *   id (a retried row no longer reads as failed);
 * - only the log notifier exists (no SMTP configured) → `suppressed`, "email not configured", which the cooldown never
 *   counts;
 * - a notifier refused or threw (including the hourly ceiling) → still `queued`, the failure and the retry outlook in
 *   its reason.
 * Every emailed item has an event, "new" listings included (PA-5).
 */
async function deliver(
  ctx: AlertRunContext,
  rule: AlertRule,
  run: {
    firings: Firing[];
    sendable: Firing[];
    pool: Pool;
    marks: ReadonlyMap<string, FiringMarks>;
    queued: ReadonlyMap<string, number>;
  },
): Promise<AlertRunResult> {
  const digest = buildDigest(rule, run.firings, {
    executionId: ctx.executionId,
    definitionId: ctx.definition.id,
    coverageCaveat: coverageFor(ctx),
  });
  const first = digest?.items[0];
  if (digest === null || first === undefined) return NONE;
  const digestId = randomUUID();
  const ids = ctx.deps.db.transaction(() =>
    run.sendable.map(
      (f) =>
        run.queued.get(rowRef(f.candidate)) ??
        ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, run.pool, run.marks, 'queued', digestId)),
    ),
  );
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
  });
  const outcome = await sendToAll(ctx.deps.notifiers, {
    kind: 'digest',
    digest,
    subject: renderSubject(first, ctx.now),
    body,
  });
  const emailed = ctx.deps.notifiers.some((n) => !(n instanceof LogNotifier));
  run.sendable.forEach((f, i) => {
    const id = ids[i];
    if (id === undefined) return;
    if (outcome.status === 'failed')
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'queued',
        reason: `${f.reason}; not delivered: ${outcome.detail}; ${retryText(ctx)}`,
      });
    else if (!emailed)
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'suppressed',
        reason: `${f.reason}; email not configured`,
      });
    else
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'notified',
        reason: f.reason,
        firedAt: ctx.now,
        digestId,
      });
  });
  return { digests: 1, events: ids.length };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 140 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: cooldown across executions, queued firings sent by the next pass on the same row and rewritten on success, later passes never repeat a firing or a listing"`

### Task 11.6: Synthetic rows refused by the runner; never-reject behaviour

**Files:** Modify `packages/engine/src/alerts/pools.ts`. Test `packages/engine/test/alerts/runner.refusals.test.ts`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.refusals.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cells,
  fixture,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

describe('synthetic rows are refused by the runner (spec §5.5, §6.8, §9 item 4)', () => {
  it('fixture calendar rows and fixture observations never become firings, events or digests', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 99999, basis: 'calendar' });
    seedRule(f, def, { thresholdPence: 99999, basis: 'verified', requireAllVerified: false });
    seedCalendar(
      f,
      ex,
      cells(5).map((cell) => ({ cell, pricePence: 100, providerId: 'fixture' })),
    );
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 100, synthetic: true });

    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
    expect(f.repos.alerts.events({ definitionId: def.id, limit: 100 })).toHaveLength(0);
    const refusals = f.log.lines.filter(
      (l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused',
    );
    expect(refusals.map((l) => l.fields.refused).sort()).toEqual([1, 5]);
  });

  it('runAlerts never rejects: a missing execution is logged and reports nothing', async () => {
    const f = fixture();
    expect(await runAlerts(f.deps, 'no-such-execution')).toEqual({ digests: 0, events: 0 });
    expect(
      f.log.lines.some(
        (l) => l.level === 'error' && l.msg === 'alerts: step failed; execution still completes',
      ),
    ).toBe(true);
  });

  it('a notifier that throws is a failed delivery, and one broken rule does not stop the others', async () => {
    const f = fixture();
    f.deps.notifiers.push({ id: 'broken', send: async () => Promise.reject(new Error('socket closed')) });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedCalendar(
      f,
      ex,
      cells(1).map((cell) => ({ cell, pricePence: 40000 })),
    );
    const good = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const broken = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    // why: a rule core cannot judge (absolute with no threshold) stands in for any rule that throws
    f.db.raw.prepare('UPDATE alert_rules SET threshold_pence = NULL WHERE id = ?').run(broken.id);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: good.id, limit: 10 });
    expect(event?.status).toBe('queued');
    expect(event?.reason).toContain('not delivered: broken: socket closed');
    expect(
      f.log.lines.some((l) => l.level === 'error' && l.msg === 'alerts: rule failed; other rules continue'),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.refusals.test.ts`.

Expected: FAIL, 1 failed and 2 passed.

Failing first (test, then its first assertion message):

- "fixture calendar rows and fixture observations never become firings, events or digests": `AssertionError: expected [] to deeply equal [ 1, 5 ]`

Green from the start, because Task 11.1 made `runAlerts` never reject and a throwing notifier a failed send:

- "runAlerts never rejects: a missing execution is logged and reports nothing"
- "a notifier that throws is a failed delivery, and one broken rule does not stop the others"

- [ ] **Step 3: Implement.** Four edits to `pools.ts`:

In `pools.ts`, add `type ResultBasis` to the `@gmt/core` import:

```ts
import {
  type AlertCandidate,
  type AlertEvent,
  type CalendarCandidate,
  daysBetween,
  evaluateConstraints,
  isoDateTimeOfEpochMs,
  type Observation,
  type Provenance,
  type ResultBasis,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

In `pools.ts`, add after `rowRef`:

```ts
/** Spec §5.5: alerts refuse synthetic rows; the fixture provider ⇔ synthetic invariant is checked both ways. */
function isSynthetic(p: Pick<Provenance, 'providerId' | 'sourceKind'>): boolean {
  return p.sourceKind === 'synthetic' || p.providerId === 'fixture';
}

/** Drops synthetic rows before any rule sees them and logs the count once per basis. */
function refuseSynthetic<T extends { provenance: Provenance }>(
  ctx: AlertRunContext,
  basis: ResultBasis,
  rows: T[],
): T[] {
  const kept = rows.filter((r) => !isSynthetic(r.provenance));
  const refused = rows.length - kept.length;
  if (refused > 0) ctx.log.warn({ basis, refused }, 'alerts: synthetic rows refused');
  return kept;
}
```

Replace `calendarPool` (with its doc comment) with this version, which reads through `refuseSynthetic`:

```ts
/**
 * Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin; previous =
 * the newest earlier fetch for (definition, provider, cabin, cell). Spec §6.8.
 * why: core compares only within 2 × discoveryRefreshHours and lists an older previous price in the "new" section with
 * its age, so the repository query has no lower bound.
 */
export function calendarPool(ctx: AlertRunContext): Pool {
  const previous = new Map<string, PreviousPrice>();
  const rows = refuseSynthetic(ctx, 'calendar', ctx.deps.repos.calendarPrices.fetchedBy(ctx.executionId));
  const candidates = rows
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map((r): CalendarCandidate => {
      const prev = ctx.deps.repos.calendarPrices.previousFor(
        ctx.definition.id,
        r.providerId,
        r.cabin,
        r.cell,
        r.fetchedAt,
        NO_LOWER_BOUND,
      );
      const c: CalendarCandidate = {
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.fetchedAt },
      };
      if (prev !== null)
        previous.set(rowRef(c), { pricePence: prev.pricePence, provenance: prev.provenance });
      return c;
    });
  return { candidates, previous, unconfirmed: 0 };
}
```

and in `verifiedPool`, replace the loop header with:

```ts
  for (const row of refuseSynthetic(ctx, 'verified', ctx.deps.repos.itineraries.writtenBy(ctx.executionId))) {
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 143 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert runner refuses synthetic rows before evaluation"`

### Task 11.7: The digest renders the marks: staleness by isStale, truncated tiles, not seen in latest search, unconfirmed fares, budget stops, converted previous prices

**Files:**
- Modify `packages/engine/src/alerts/templates.ts`, `packages/engine/src/alerts/runner.ts`, `packages/engine/test/alerts/builders.ts`.
- Test `packages/engine/test/alerts/runner.marks.test.ts`, `packages/engine/test/alerts/templates.marks.test.ts`.

**Interfaces:** Consumes `TRUNCATED_NOTE`, `isStale` (WP8), `passFacts` (Task 11.1's `marks.ts`), `AlertsPass`. Produces `DigestRenderInput.marks/budgetStop/verificationNotRun/unconfirmed`; renders `ItemMarks.previousConverted`.

`DigestItem` carries none of these marks and core is not changed for them: Task 11.1's `marks.ts` already reads them and stores them on every event; this task renders them.

- [ ] **Step 1: Write the failing tests.** Staleness is tested at the threshold and one hour over on both bases, for an observed age, for fetch age plus a declared age, and with the observed age and fetch-plus-declared on opposite sides of the threshold (reviews TS-4, TS-15); an unknown vendor age is stale by its fetch age alone (PA-8, decision 56); "not seen in latest search" has its negative case and a case with no recorded instant (PA-6); the itinerary search that never ran (PA-2). Decision 59: the "Not searched" line and the budget cause appear only when the pass stopped on a budget cap, never as "at least 0", and a completed run whose itinerary search never ran (no verification provider registered) names no cause (review PA2-1); a converted previous price prints '≈' in the item and in the "new" section (PA2-4).

`packages/engine/test/alerts/runner.marks.test.ts`:

```ts
import { asIsoDate, TRUNCATED_NOTE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  ALL_FIELDS,
  cellAt,
  cells,
  fixture,
  hoursBefore,
  JFK,
  LGW,
  LHR,
  NOW,
  payloadOf,
  searchedEmpty,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
  seedTile,
  seedVerificationCoverage,
} from './fixtures.js';

const HOUR = 3_600_000;
const notesOf = (body: string) => body.split('\n').filter((l) => l.startsWith('   Notes:'));

describe('staleness by effective age through core isStale (spec §3, §8.1; decisions 54, 55, 56)', () => {
  it('calendar basis at the threshold and one hour over, for an observed age and for fetch age plus the declared age (review TS-4)', async () => {
    const f = fixture({ env: { CALENDAR_STALE_AFTER_HOURS: '100' } });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(5);
    seedCalendar(f, ex, [
      // observed age: 100 h is not over 100 h; 101 h is
      {
        cell: cellAt(list, 0),
        pricePence: 40000,
        providerId: 'travelpayouts',
        providerObservedAt: hoursBefore(NOW, 100),
      },
      {
        cell: cellAt(list, 1),
        pricePence: 40100,
        providerId: 'travelpayouts',
        providerObservedAt: hoursBefore(NOW, 101),
      },
      // fetch age plus the declared 48 h: 52 + 48 = 100 not stale, 53 + 48 = 101 stale
      {
        cell: cellAt(list, 2),
        pricePence: 40200,
        providerId: 'travelpayouts',
        fetchedAt: hoursBefore(NOW, 52),
      },
      {
        cell: cellAt(list, 3),
        pricePence: 40300,
        providerId: 'travelpayouts',
        fetchedAt: hoursBefore(NOW, 53),
      },
      // the observed age wins over fetch plus declared: observed 90 h (fresh) although 60 + 48 = 108 would be stale
      {
        cell: cellAt(list, 4),
        pricePence: 40400,
        providerId: 'travelpayouts',
        fetchedAt: hoursBefore(NOW, 60),
        providerObservedAt: hoursBefore(NOW, 90),
      },
    ]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const payloads = f.repos.alerts.events({ definitionId: def.id, limit: 10 }).map(payloadOf);
    expect(new Set(payloads.map((p) => p.staleThresholdHours))).toEqual(new Set([100]));
    const lines = (f.notifier.digests()[0]?.body ?? '').split('\n');
    const staleItems = lines.filter((l) => /^\d+\. /.test(l) || l === '   Notes: stale: older than 100h');
    expect(staleItems).toEqual([
      '1. £400 LHR→JFK 1 Nov–15 Nov (14n)',
      '2. £401 LHR→JFK 2 Nov–16 Nov (14n)',
      '   Notes: stale: older than 100h',
      '3. £402 LHR→JFK 3 Nov–17 Nov (14n)',
      '4. £403 LHR→JFK 4 Nov–18 Nov (14n)',
      '   Notes: stale: older than 100h',
      '5. £404 LHR→JFK 5 Nov–19 Nov (14n)',
    ]);
  });

  it('the calendar threshold defaults to the refresh plus the declared age', async () => {
    const f = fixture();
    const def = seedDefinition(f); // travelpayouts refresh 168 h; no provider registered here, so declared age 0
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 40000, providerId: 'travelpayouts' }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const [event] = f.repos.alerts.events({ definitionId: def.id, limit: 1 });
    expect(event === undefined ? null : payloadOf(event).staleThresholdHours).toBe(168);
  });

  it('itinerary-search basis: STALE_AFTER_HOURS for a known age, and for an unknown vendor age by its fetch age alone (review TS-15, PA-8)', async () => {
    const f = fixture({ env: { STALE_AFTER_HOURS: '192' } });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const day = (d: number) => asIsoDate(`2026-11-0${d}`);
    // a known (bounded, 0) age at 192 h and 193 h; an unknown vendor age at 192 h and 193 h
    seedObservation(f, ex, {
      departureDate: day(1),
      flight: 101,
      pricePence: 41000,
      maxAgeHours: 0,
      fetchedAt: hoursBefore(NOW, 192),
    });
    seedObservation(f, ex, {
      departureDate: day(2),
      flight: 103,
      pricePence: 41100,
      maxAgeHours: 0,
      fetchedAt: hoursBefore(NOW, 193),
    });
    seedObservation(f, ex, {
      departureDate: day(3),
      flight: 105,
      pricePence: 41200,
      fetchedAt: hoursBefore(NOW, 192),
    });
    seedObservation(f, ex, {
      departureDate: day(4),
      flight: 107,
      pricePence: 41300,
      fetchedAt: hoursBefore(NOW, 193),
    });
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(notesOf(body)).toEqual(['   Notes: stale: older than 192h', '   Notes: stale: older than 192h']);
    expect(body).toContain(
      "   Provenance: Google Flights via SearchApi · fetched 8d ago · vendor's cache age unknown",
    );
    const staleByPrice = body
      .split('\n\n')
      .filter((block) => block.includes('stale: older than 192h'))
      .map((block) => block.split('\n')[0]);
    expect(staleByPrice).toEqual([
      '2. £411 LHR→JFK 2 Nov–16 Nov (14n)',
      '4. £413 LHR→JFK 4 Nov–18 Nov (14n)',
    ]);
  });
});

describe('truncated tiles, newer searches, unconfirmed fares and budget stops (decisions 25, 30, 54; review PA-2, PA-10)', () => {
  it('a price from a tile the page cap cut short reads "cheapest of the rows read" in the email and the payload', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(2);
    seedTile(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }], `${TRUNCATED_NOTE}: page cap reached`);
    seedCalendar(f, ex, [{ cell: cellAt(list, 1), pricePence: 40100 }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(notesOf(f.notifier.digests()[0]?.body ?? '')).toEqual([`   Notes: ${TRUNCATED_NOTE}`]);
    const payloads = f.repos.alerts.events({ definitionId: def.id, limit: 10 }).map(payloadOf);
    expect(payloads.filter((p) => p.truncated).map((p) => p.route)).toEqual(['LHR→JFK 1 Nov–15 Nov (14n)']);
  });

  it("a fare a newer itinerary search of its cell did not see is marked with that search's instant; one it saw is not", async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    const seen = seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-03'),
      pricePence: 43000,
      flight: 177,
    });
    f.clock.advance(HOUR);
    const searchedAt = f.clock.now();
    // a single-cell verification (a child) searched 2 Nov after the run's own search and found no fares
    const nov2 = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-16'),
      nights: 14,
    };
    const child = seedExecution(f, def, nov2);
    f.repos.cells.seed(child, [nov2], []);
    f.repos.cells.seedVerification(child, [{ cell: nov2, reason: 'always_include' }], [nov2], ['searchapi']);
    searchedEmpty(f, child, nov2);
    // another child searched 3 Nov and saw the same offer again
    const nov3 = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-03'),
      returnDate: asIsoDate('2026-11-17'),
      nights: 14,
    };
    const child3 = seedExecution(f, def, nov3);
    seedObservation(f, child3, { departureDate: asIsoDate('2026-11-03'), pricePence: 43000, flight: 177 });
    f.repos.cells.seed(child3, [nov3], []);
    f.repos.cells.seedVerification(child3, [{ cell: nov3, reason: 'always_include' }], [nov3], ['searchapi']);
    searchedEmpty(f, child3, nov3);
    f.clock.advance(2 * HOUR);
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(notesOf(body)).toEqual(['   Notes: not seen in latest search (2h ago)']);
    const byObservation = new Map(
      f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => [e.observationId, payloadOf(e)]),
    );
    expect(byObservation.get(seen.observationId)?.notSeenInLatest).toBeNull();
    expect([...byObservation.values()].map((p) => p.notSeenInLatest).filter((m) => m !== null)).toEqual([
      { at: searchedAt },
    ]);
  });

  it('the digest counts the fares whose price the final step did not confirm, leaving out ones that fail a constraint anyway', async () => {
    const f = fixture();
    const def = seedDefinition(f, { constraints: { maxJourneyMinutes: 1500 } });
    const ex = seedExecution(f, def);
    const unconfirmed = ALL_FIELDS.filter((x) => x !== 'price');
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 20000,
      seller: 'An agency',
      suppliedFields: unconfirmed,
    });
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 44000, flight: 177 });
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    expect(f.notifier.digests()[0]?.body).toContain(
      'Unconfirmed: 1 fare in this run had no price confirmed by the final step; they are never alerted.',
    );
    const strict = fixture();
    const sdef = seedDefinition(strict, { constraints: { maxJourneyMinutes: 60 } }); // every fare fails this
    const sex = seedExecution(strict, sdef);
    seedObservation(strict, sex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 20000,
      suppliedFields: unconfirmed,
    });
    seedRule(strict, sdef, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(strict.deps, sex)).toEqual({ digests: 0, events: 0 });
  });

  it('a run a budget cap stopped says how many cell searches did not run', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(4);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }]);
    seedVerificationCoverage(f, ex, cells(1, LGW), 1); // the itinerary search ran (one cell)
    f.repos.cells.seed(ex, [cellAt(list, 1), cellAt(list, 2), cellAt(list, 3)], ['travelpayouts']);
    f.repos.cells.setOutcome(ex, cellAt(list, 3), 'discovery', 'travelpayouts', {
      status: 'skipped',
      reason: 'budget',
    });
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex, { stop: 'budget' });
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(
      'Not searched: a budget cap left 3 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
    expect(body).toContain('Coverage: itinerary-searched 1 of 1 cells, 2 outbounds each');
  });

  it('a cap that stopped the run during discovery: the itinerary search is "not run" and the count a lower bound (review PA-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f); // verification by SearchApi is configured
    const ex = seedExecution(f, def);
    const list = cells(3);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }]);
    f.repos.cells.seed(ex, [cellAt(list, 1), cellAt(list, 2)], ['travelpayouts']);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex, { stop: 'budget' });
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(
      'Not searched: a budget cap left at least 2 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
    expect(body).toContain(
      'Coverage: itinerary search not run (a budget cap stopped the run during discovery)',
    );
  });

  it('a completed pass whose itinerary search never ran (no verification provider registered) names no budget cap (review PA2-1)', async () => {
    const f = fixture();
    const def = seedDefinition(f); // the snapshot names SearchApi for verification; nothing seeded verification outcomes
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 40000 }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex); // a completed pass
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Coverage: itinerary search not run\n');
    expect(body).not.toContain('budget cap');
    expect(body).not.toContain('Not searched');
  });
});
```

`packages/engine/test/alerts/templates.marks.test.ts`:

```ts
import { asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords, TRUNCATED_NOTE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type ItemMarks, NO_MARKS, renderBody } from '../../src/alerts/templates.js';
import { calendarItem, digestOf, HASH, renderInput, verifiedItem } from './builders.js';

const marks = (over: Partial<ItemMarks>): ItemMarks => ({ ...NO_MARKS, ...over });

describe('marks the runner reads from the repositories (spec §3, §8.1; decisions 25, 30, 54, 55, 59)', () => {
  it('not seen in latest search, stale, cheapest of the rows read; the unconfirmed and budget lines', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([verifiedItem(), calendarItem()], {
          newItems: [calendarItem({ isNew: true, rowKey: 'calendar:6' })],
        }),
        marks: new Map([
          [HASH, marks({ notSeenInLatest: { at: asIsoDateTime('2026-10-14T12:00:00.000Z') } })],
          ['calendar:5', marks({ stale: { thresholdHours: 192 }, truncated: true })],
          ['calendar:6', marks({ truncated: true })],
        ]),
        unconfirmed: 2,
        budgetStop: { unsearched: 1 },
      }),
    );
    expect(body).toContain('   Notes: not seen in latest search (3h ago)');
    expect(body).toContain(`   Notes: ${TRUNCATED_NOTE}; stale: older than 192h`);
    expect(body).toContain(`(≤7d before that) · ${TRUNCATED_NOTE}`);
    expect(body).toContain(
      'Unconfirmed: 2 fares in this run had no price confirmed by the final step; they are never alerted.',
    );
    expect(body).toContain(
      'Not searched: a budget cap left 1 cell search of this run undone; the prices above come from the cells that were searched.',
    );
  });

  it('a newer search with no recorded instant reads "not seen in latest search" with no age (review PA-6)', () => {
    const body = renderBody(
      renderInput({ marks: new Map([[HASH, marks({ notSeenInLatest: { at: null } })]]) }),
    );
    expect(body).toContain('   Notes: not seen in latest search\n');
  });

  it('a converted previous price carries "≈" in the item and in the "new" section (decision 59)', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem({ previousPricePence: 43000, fetchGapHours: 72 })], {
          basis: 'calendar',
          newItems: [
            calendarItem({
              isNew: true,
              rowKey: 'calendar:6',
              previousPricePence: 50000,
              fetchGapHours: 169,
            }),
          ],
        }),
        marks: new Map([
          ['calendar:5', marks({ previousConverted: true })],
          ['calendar:6', marks({ previousConverted: true })],
        ]),
      }),
    );
    expect(body).toContain('   Previous: ≈£430, fetched 3d before this price');
    expect(body).toContain(' · previous ≈£500, fetched 7d before this price');
  });
});

describe('the budget-stop lines appear only after a budget stop (decision 59; review PA2-1)', () => {
  it('a budget stop during discovery: "not run" with its cause, and the count as a lower bound', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem()], { basis: 'calendar' }),
        budgetStop: { unsearched: 14 },
        verificationNotRun: true,
      }),
    );
    expect(body).toContain(
      'Not searched: a budget cap left at least 14 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
    expect(body).toContain(
      'Coverage: itinerary search not run (a budget cap stopped the run during discovery)',
    );
    expect(body).not.toContain('itinerary-searched');
  });

  it('a budget stop with nothing left unsearched but no itinerary search says so without a count ("at least 0" never)', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem()]),
        budgetStop: { unsearched: 0 },
        verificationNotRun: true,
      }),
    );
    expect(body).toContain(
      'Not searched: a budget cap stopped this run before its itinerary search; the prices above are calendar prices only.',
    );
    expect(body).not.toContain('at least 0');
  });

  it('no budget stop: no "Not searched" line, and an itinerary search that never ran names no cause', () => {
    const body = renderBody(renderInput({ digest: digestOf([calendarItem()]), verificationNotRun: true }));
    expect(body).not.toContain('Not searched');
    expect(body).not.toContain('budget cap');
    expect(body).toContain('Coverage: itinerary search not run\n');
  });
});

describe('banned words over the marks and run lines (spec §11)', () => {
  it('no banned word with every mark and both run lines set', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([verifiedItem(), calendarItem({ previousPricePence: 43000, fetchGapHours: 2 })]),
        marks: new Map([
          [HASH, marks({ stale: { thresholdHours: 192 }, notSeenInLatest: { at: null } })],
          ['calendar:5', marks({ stale: { thresholdHours: 216 }, truncated: true, previousConverted: true })],
        ]),
        unconfirmed: 1,
        budgetStop: { unsearched: 3 },
        verificationNotRun: true,
      }),
    );
    expect(findBannedWords(body, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
```

In `packages/engine/test/alerts/builders.ts`, replace `renderInput` with:

```ts
export function renderInput(over: Partial<DigestRenderInput> = {}): DigestRenderInput {
  return {
    digest: digestOf([verifiedItem()]),
    definitionName: 'London to New York (worked example)',
    appBaseUrl: null,
    now: NOW,
    marks: new Map(),
    budgetStop: null,
    verificationNotRun: false,
    unconfirmed: 0,
    ...over,
  };
}
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.marks.test.ts test/alerts/templates.marks.test.ts` (under `pnpm --filter @gmt/engine typecheck` the new `renderInput` fields are also TS2353 until Step 3).

Expected: FAIL, 14 failed and 2 passed.

Failing first (test, then its first assertion message):

- "calendar basis at the threshold and one hour over, for an observed age and for fetch age plus the declared age (review TS-4)": `AssertionError: expected [ …(5) ] to deeply equal [ …(7) ]`
- "itinerary-search basis: STALE_AFTER_HOURS for a known age, and for an unknown vendor age by its fetch age alone (review TS-15, PA-8)": `AssertionError: expected [] to deeply equal [ …(2) ]`
- "a price from a tile the page cap cut short reads "cheapest of the rows read" in the email and the payload": `AssertionError: expected [] to deeply equal [ Array(1) ]`
- "a fare a newer itinerary search of its cell did not see is marked with that search's instant; one it saw is not": `AssertionError: expected [] to deeply equal [ Array(1) ]`
- "the digest counts the fares whose price the final step did not confirm, leaving out ones that fail a constraint anyway": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Unconfirmed: 1 fare in this run had n…'`
- "a run a budget cap stopped says how many cell searches did not run": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Not searched: a budget cap left 3 cel…'`
- "a cap that stopped the run during discovery: the itinerary search is "not run" and the count a lower bound (review PA-2)": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Not searched: a budget cap left at le…'`
- "a completed pass whose itinerary search never ran (no verification provider registered) names no budget cap (review PA2-1)": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Coverage: itinerary search not run\n'`
- "not seen in latest search, stale, cheapest of the rows read; the unconfirmed and budget lines": `AssertionError: expected 'get-me-there alert for "London to New…' to contain '   Notes: not seen in latest search (…'`
- "a newer search with no recorded instant reads "not seen in latest search" with no age (review PA-6)": `AssertionError: expected 'get-me-there alert for "London to New…' to contain '   Notes: not seen in latest search\n'`
- "a converted previous price carries "≈" in the item and in the "new" section (decision 59)": `AssertionError: expected 'get-me-there alert for "London to New…' to contain '   Previous: ≈£430, fetched 3d before…'`
- "a budget stop during discovery: "not run" with its cause, and the count as a lower bound": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Not searched: a budget cap left at le…'`
- "a budget stop with nothing left unsearched but no itinerary search says so without a count ("at least 0" never)": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Not searched: a budget cap stopped th…'`
- "no budget stop: no "Not searched" line, and an itinerary search that never ran names no cause": `AssertionError: expected 'get-me-there alert for "London to New…' to contain 'Coverage: itinerary search not run\n'`

Green from the start, because Task 11.1 already stores the threshold on every payload and the banned-word sweep has nothing new to find before the marks render:

- "the calendar threshold defaults to the refresh plus the declared age"
- "no banned word with every mark and both run lines set"

- [ ] **Step 3: Implement.** Eight edits to `templates.ts`:

In `templates.ts`, add `TRUNCATED_NOTE` to the `@gmt/core` import:

```ts
import {
  type AlertDigest,
  type AlertRule,
  CONSTRAINT_LABELS,
  type DigestItem,
  effectiveAge,
  formatAgeFull,
  formatDuration,
  formatPence,
  hoursSince,
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  type ResultBasis,
  type Segment,
  sourceLabel,
  TRUNCATED_NOTE,
  validateVendorUrl,
} from '@gmt/core';
```

Replace `DigestRenderInput` (with its doc comment) with:

```ts
/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). */
export interface DigestRenderInput {
  digest: AlertDigest;
  definitionName: string;
  appBaseUrl: string | null;
  now: IsoDateTime;
  /** Per `DigestItem.rowKey`; an item without an entry has no marks. */
  marks: ReadonlyMap<string, ItemMarks>;
  /** Only when the pass stopped on a budget cap: the cell searches it left undone (decisions 25, 59). */
  budgetStop: { unsearched: number } | null;
  /** The itinerary-search stage never ran although a verification provider is configured (any cause). */
  verificationNotRun: boolean;
  /** Fares of this run left out of the itinerary-search basis because the final step did not confirm their price. */
  unconfirmed: number;
}
```

Replace the Task 11.2 `notesOf` (with its doc comment) with `agoText` and the full `notesOf`:

```ts
/** "3h ago", or "just now" under an hour. */
function agoText(at: IsoDateTime, now: IsoDateTime): string {
  const h = hoursSince(at, now);
  return h < 1 ? 'just now' : `${formatDuration(h)} ago`;
}

/** The marks a reader needs beside the price (spec §3, §8.1; decisions 30, 37, 44, 54, 55), in a fixed order. */
function notesOf(item: DigestItem, input: DigestRenderInput): string[] {
  const m = input.marks.get(item.rowKey) ?? NO_MARKS;
  const notes: string[] = [];
  if (item.unverified.includes('priceConfirmed')) notes.push(CONSTRAINT_LABELS.priceConfirmed);
  if (m.truncated) notes.push(TRUNCATED_NOTE);
  if (m.notSeenInLatest !== null)
    notes.push(
      m.notSeenInLatest.at === null
        ? 'not seen in latest search'
        : `not seen in latest search (${agoText(m.notSeenInLatest.at, input.now)})`,
    );
  if (m.stale !== null) notes.push(`stale: older than ${m.stale.thresholdHours}h`);
  return notes;
}
```

Replace `previousLine` with `previousPrice` and this `previousLine`, which mark a converted previous price '≈' (decision 59):

```ts
/** The previous price with '≈' when it was FX-converted (decision 59). */
function previousPrice(item: DigestItem, input: DigestRenderInput, pence: number): string {
  return `${(input.marks.get(item.rowKey) ?? NO_MARKS).previousConverted ? '≈' : ''}${formatPence(pence)}`;
}

function previousLine(item: DigestItem, input: DigestRenderInput): string | null {
  if (item.previousPricePence === null) return null;
  const gap = item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`;
  return `   Previous: ${previousPrice(item, input, item.previousPricePence)}${gap}`;
}
```

In `itemLines`, pass the input on:

```ts
  const prev = previousLine(item, input);
```

Replace `coverageText` with:

```ts
function coverageText(c: AlertDigest['coverageCaveat'], input: DigestRenderInput): string {
  // why: decision 59 — a cause is named only when the pass did stop on a budget cap (review PA2-1)
  if (input.verificationNotRun)
    return input.budgetStop === null
      ? 'Coverage: itinerary search not run'
      : 'Coverage: itinerary search not run (a budget cap stopped the run during discovery)';
  return c === null
    ? 'Coverage: itinerary-searched 0 cells (no verification provider configured)'
    : `Coverage: itinerary-searched ${c.itinerarySearched} of ${c.selected} cells, ${c.expandTop} outbounds each`;
}
```

Replace `newItemLine` (with its doc comment) with:

```ts
/** One line per new item; the out-of-window previous price, when core states one, with its fetch gap (spec §6.8). */
function newItemLine(item: DigestItem, input: DigestRenderInput): string {
  const prev =
    item.previousPricePence === null
      ? ''
      : ` · previous ${previousPrice(item, input, item.previousPricePence)}${item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`}`;
  const notes = notesOf(item, input);
  return `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${prev}${notes.length > 0 ? ` · ${notes.join('; ')}` : ''}`;
}
```

Replace `renderBody` with:

```ts
/** Spec §8.3 body; LF line endings only. */
export function renderBody(input: DigestRenderInput): string {
  const d = input.digest;
  const lines = [`get-me-there alert for "${providerText(input.definitionName)}"`, ''];
  d.items.forEach((item, i) => {
    lines.push(...itemLines(i + 1, item, input), '');
  });
  if (d.restCount > 0) lines.push(`and ${d.restCount} more`, '');
  if (d.newItems.length > 0) {
    lines.push('New since the last check (no earlier price within the comparison window; not a drop):');
    for (const item of d.newItems) lines.push(newItemLine(item, input));
    if (d.newRestCount > 0) lines.push(`and ${d.newRestCount} more new cells`);
    lines.push('');
  }
  if (input.unconfirmed > 0) {
    const n = input.unconfirmed;
    lines.push(
      `Unconfirmed: ${n} ${n === 1 ? 'fare' : 'fares'} in this run had no price confirmed by the final step; they are never alerted.`,
    );
  }
  const stop = input.budgetStop;
  if (stop !== null && stop.unsearched > 0) {
    const n = stop.unsearched;
    const count = `${input.verificationNotRun ? 'at least ' : ''}${n} cell ${n === 1 ? 'search' : 'searches'}`;
    lines.push(
      `Not searched: a budget cap left ${count} of this run undone; the prices above come from the cells that were searched.`,
    );
  } else if (stop !== null && input.verificationNotRun) {
    lines.push(
      'Not searched: a budget cap stopped this run before its itinerary search; the prices above are calendar prices only.',
    );
  }
  lines.push(coverageText(d.coverageCaveat, input), `Rule: ${ruleText(d.rule)}`);
  return lines.join('\n');
}
```

Two edits to `runner.ts`:

In `runner.ts`, add `passFacts` to the marks import:

```ts
import { cellOf, type FiringMarks, marksFor, passFacts, rowKeyOf } from './marks.js';
```

Replace `deliver` (with its doc comment) with:

```ts
/**
 * Spec §8.1 order, decisions 56 and 59: persist the firings as `queued` events (one transaction), send the digest, then
 * move each event on:
 * - every notifier accepted and one of them is not the log → `notified`, with this send's reason, fire time and digest
 *   id (a retried row no longer reads as failed);
 * - only the log notifier exists (no SMTP configured) → `suppressed`, "email not configured", which the cooldown never
 *   counts;
 * - a notifier refused or threw (including the hourly ceiling) → still `queued`, the failure and the retry outlook in
 *   its reason.
 * Every emailed item has an event, "new" listings included (PA-5).
 */
async function deliver(
  ctx: AlertRunContext,
  rule: AlertRule,
  run: {
    firings: Firing[];
    sendable: Firing[];
    pool: Pool;
    marks: ReadonlyMap<string, FiringMarks>;
    queued: ReadonlyMap<string, number>;
  },
): Promise<AlertRunResult> {
  const digest = buildDigest(rule, run.firings, {
    executionId: ctx.executionId,
    definitionId: ctx.definition.id,
    coverageCaveat: coverageFor(ctx),
  });
  const first = digest?.items[0];
  if (digest === null || first === undefined) return NONE;
  const digestId = randomUUID();
  const ids = ctx.deps.db.transaction(() =>
    run.sendable.map(
      (f) =>
        run.queued.get(rowRef(f.candidate)) ??
        ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, run.pool, run.marks, 'queued', digestId)),
    ),
  );
  const facts = passFacts(ctx);
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
    marks: run.marks,
    budgetStop: facts.budgetStop,
    verificationNotRun: facts.verificationNotRun,
    unconfirmed: run.pool.unconfirmed,
  });
  const outcome = await sendToAll(ctx.deps.notifiers, {
    kind: 'digest',
    digest,
    subject: renderSubject(first, ctx.now),
    body,
  });
  const emailed = ctx.deps.notifiers.some((n) => !(n instanceof LogNotifier));
  run.sendable.forEach((f, i) => {
    const id = ids[i];
    if (id === undefined) return;
    if (outcome.status === 'failed')
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'queued',
        reason: `${f.reason}; not delivered: ${outcome.detail}; ${retryText(ctx)}`,
      });
    else if (!emailed)
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'suppressed',
        reason: `${f.reason}; email not configured`,
      });
    else
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'notified',
        reason: f.reason,
        firedAt: ctx.now,
        digestId,
      });
  });
  return { digests: 1, events: ids.length };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`, then `pnpm --filter @gmt/engine typecheck`. Expected: PASS, 159 tests; typecheck clean.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: digest renders staleness by isStale, truncation, not-seen-in-latest, the unconfirmed count, budget stops only after a budget stop, and '≈' on converted previous prices (decision 59)"`

### Task 11.8: The alerts step with real-kind prices through a pause and a resume (layer A); the production engine wiring

**Files:**
- Create `apps/api/src/bootstrap/engine.ts`; modify WP8's `apps/api/src/bootstrap/app.ts` (one statement).
- Test `packages/engine/test/alerts/realKindProvider.ts` (test support), `packages/engine/test/alerts/engine.alerts.test.ts`, `apps/api/test/bootstrap/engine.test.ts`.

**Interfaces:**
- **Consumes:** `createEngine(deps, { alerts })`, `buildContext`, `createOrchestrator` (`start`, `resume`), WP7's `createHarness`, `withVerification`, `WINDOW`, `FIXTURE_COST_MICRO_GBP`, core's `BudgetExceeded`, `generateCells`; WP4b's `buildPorts`, `loadConfigFromEnv`, `testEnv`, `silentLog`, `SENTINEL_SMTP`.
- **Produces:** `engineFor(ports, log)`; `bootApp` builds its engine with it.

The fixture provider's rows are synthetic, so on its own the layer-A harness can only show that the runner refuses them. `realKindProvider` answers as Travelpayouts (`authorised-cached`) without HTTP and stands in for a cap breach by throwing core's `BudgetExceeded` from a chosen tile — what http-kit's reservation throws — so the engine's own pause, alerts step, status write and manual resume run over prices the runner accepts (reviews TS-5, TS-16, PA-2). The harness configures Travelpayouts with a sentinel token so the engine has limits for it.

- [ ] **Step 1: Write the tests.**

`packages/engine/test/alerts/realKindProvider.ts`:

```ts
/**
 * A calendar provider of a real kind for layer-A alert tests (review TS-5, TS-16): id `travelpayouts`, sourceKind
 * `authorised-cached`, so the alert runner does not refuse its rows the way it refuses the fixture provider's. It makes
 * no HTTP call: it answers every planned tile from `priceOf`, and stands in for a cap breach by throwing core's
 * BudgetExceeded from the tile that `refuse` names — what http-kit's reservation throws in production (spec §5.3).
 * Test-only; nothing in src imports it, and the engine still runs its whole pass, status and alerts step.
 */
import {
  BudgetExceeded,
  type CellKey,
  type Clock,
  type FlightProvider,
  generateCells,
  type TilePlan,
} from '@gmt/core';

export interface RealKindProviderOptions {
  clock: Clock;
  /** The price of a cell, in pence. */
  priceOf: (cell: CellKey) => number;
  /** Called before each tile; a BudgetExceeded it returns is thrown instead of answering. */
  refuse?: (tileIndex: number) => BudgetExceeded | null;
}

/** One tile per departure date over the cells the engine asks for (q.cells on a resume), in date order. */
export function realKindProvider(o: RealKindProviderOptions): FlightProvider {
  return {
    id: 'travelpayouts',
    displayName: 'Travelpayouts (layer-A stand-in)',
    suppliedFields: ['price'],
    cabins: ['economy'],
    discovery: {
      info: { sourceKind: 'authorised-cached', provenanceNote: 'layer-A stand-in, no HTTP', maxAgeHours: 48 },
      plan(q): TilePlan[] {
        const cells: CellKey[] =
          q.cells ??
          generateCells({
            origins: [q.origin],
            destinations: [q.destination],
            departureFrom: q.departureFrom,
            departureTo: q.departureTo,
            minNights: q.minNights,
            maxNights: q.maxNights,
          });
        const byDate = new Map<string, CellKey[]>();
        for (const c of cells) byDate.set(c.departureDate, [...(byDate.get(c.departureDate) ?? []), c]);
        return [...byDate.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([, covered], index) => {
            const returns = covered.map((c) => c.returnDate).sort();
            const first = covered[0];
            if (first === undefined) throw new Error('empty tile');
            return {
              index,
              coveredCells: covered,
              request: {
                kind: 'rectangle',
                departFrom: first.departureDate,
                departTo: first.departureDate,
                returnFrom: returns[0] ?? first.returnDate,
                returnTo: returns.at(-1) ?? first.returnDate,
              },
            };
          });
      },
      async fetchTile(plan) {
        const refusal = o.refuse?.(plan.index) ?? null;
        if (refusal !== null) throw refusal;
        return {
          kind: 'tile',
          index: plan.index,
          coveredCells: plan.coveredCells,
          fetchedAt: o.clock.now(),
          pointOfSale: 'unknown',
          prices: plan.coveredCells.map((c) => ({ ...c, amountMinor: o.priceOf(c), currency: 'GBP' })),
          noFares: [],
          notes: [],
        };
      },
    },
    healthcheck: async () => ({ ok: true, detail: 'not probed' }),
  };
}

/** The cap breach http-kit's reservation throws when this run's free-call cap is spent. */
export function freeCallCapBreach(): BudgetExceeded {
  return new BudgetExceeded({ scope: 'execution-free-calls', cap: 5, current: 5, requested: 1 });
}

/** The cap breach of a provider's monthly call cap (no other discovery provider remains). */
export function providerMonthBreach(): BudgetExceeded {
  return new BudgetExceeded({
    scope: 'provider-month',
    cap: 5,
    current: 5,
    requested: 1,
    providerId: 'travelpayouts',
  });
}
```

`packages/engine/test/alerts/engine.alerts.test.ts`:

```ts
import { type CellKey, daysBetween, type ProvidersConfig } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { buildContext } from '../../src/context.js';
import type { AlertsStepHook } from '../../src/index.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import {
  createHarness,
  FIXTURE_COST_MICRO_GBP,
  type Harness,
  WINDOW,
  withVerification,
} from '../support/harness.js';
import { freeCallCapBreach, providerMonthBreach, realKindProvider } from './realKindProvider.js';

const calendarRule = (h: Harness, definitionId: string, thresholdPence = 99_999_999) =>
  h.repos.alerts.create({
    definitionId,
    type: 'absolute',
    thresholdPence,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });
const refusals = (h: Harness) =>
  h.logs.filter((l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused');
/** Every digest body the harness's notifier received, in order. */
const bodies = (h: Harness): string[] =>
  h.digests.flatMap((d) =>
    typeof d === 'object' && d !== null && 'body' in d && typeof d.body === 'string' ? [d.body] : [],
  );
/** £400, plus £1 per departure day after the window opens, plus £0.50 per night: every cell's price distinct. */
const priceOf = (c: CellKey) =>
  40_000 + 100 * daysBetween(WINDOW.from, c.departureDate) + 50 * daysBetween(c.departureDate, c.returnDate);

/** The harness's ports with the real-kind provider (Travelpayouts configured with a sentinel token), the real runner as the hook. */
function realKind(refuse: (tileIndex: number) => ReturnType<typeof freeCallCapBreach> | null) {
  const h = createHarness({ env: { TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789abcdef' } });
  let refusing = true;
  const provider = realKindProvider({
    clock: h.clock,
    priceOf,
    refuse: (i) => (refusing ? refuse(i) : null),
  });
  const hook = vi.fn<AlertsStepHook>(runAlerts);
  const orch = h.track(
    createOrchestrator(
      buildContext(
        { ...h.deps, providers: [provider, h.fixture] },
        { ...h.options, alerts: hook, providerConcurrency: { travelpayouts: 1 } },
      ),
    ),
  );
  const providers = (verification: ProvidersConfig['verification'] = []): ProvidersConfig => ({
    discovery: ['travelpayouts'],
    verification,
    discoveryRefreshHours: { travelpayouts: 168 },
  });
  return { h, orch, hook, providers, stopRefusing: () => (refusing = false) };
}

describe('the §8.1 alerts step runs the alert runner (layer A)', () => {
  it('runAlerts is an AlertsStepHook, called once per completed pass with the engine deps; fixture rows are refused', async () => {
    const h = createHarness();
    const hook = vi.fn<AlertsStepHook>(runAlerts);
    const def = h.createDefinition();
    calendarRule(h, def.id);
    const execution = await h.runToCompletion(h.orch({ ...h.options, alerts: hook }), def.id);
    expect(execution.status).toBe('completed');
    expect(hook).toHaveBeenCalledExactlyOnceWith(h.deps, execution.id, { stop: 'completed' });
    await expect(hook.mock.results[0]?.value).resolves.toEqual({ digests: 0, events: 0 });
    expect(refusals(h).length).toBeGreaterThan(0);
    expect(h.repos.alerts.events({ definitionId: def.id, limit: 100 })).toHaveLength(0);
    expect(h.digests).toHaveLength(0);
  });

  it('also runs when the pass pauses for a provider-month cap (decision 25)', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const hook = vi.fn<AlertsStepHook>(runAlerts);
    const def = h.createDefinition({ providers: withVerification() });
    calendarRule(h, def.id);
    const e = await h.runToCompletion(h.orch({ ...h.options, alerts: hook }), def.id);
    expect(e.status).toBe('paused_budget');
    expect(hook).toHaveBeenCalledExactlyOnceWith(h.deps, e.id, { stop: 'budget' });
    expect(refusals(h).length).toBeGreaterThan(0);
    expect(h.digests).toHaveLength(0);
  });
});

describe('real-kind prices through a pause and a resume (decisions 25, 55, 56; review TS-5, TS-16, PA-2)', () => {
  it("free-call cap: the paused pass sends one digest with the 'Not searched' line; the resumed pass sends only new prices; no event twice", async () => {
    const { h, orch, hook, providers, stopRefusing } = realKind((i) => (i >= 5 ? freeCallCapBreach() : null));
    const def = h.createDefinition({ providers: providers() });
    calendarRule(h, def.id, 45_000);
    const paused = await h.runToCompletion(orch, def.id);
    expect(paused.status).toBe('paused_budget');
    expect(hook).toHaveBeenCalledTimes(1);
    const [first] = bodies(h);
    expect(first).toContain('1. £403.50 LHR→JFK 2 Nov–9 Nov (7n)');
    expect(first).toContain('10. £408 LHR→JFK 6 Nov–14 Nov (8n)');
    expect(first).not.toMatch(/^and \d+ more/m);
    expect(first).toMatch(/Not searched: a budget cap left 18 cell searches of this run undone;/);
    const afterPause = h.repos.alerts.events({ definitionId: def.id, limit: 100 });
    expect(afterPause).toHaveLength(10);
    expect(new Set(afterPause.map((e) => e.status))).toEqual(new Set(['notified']));

    stopRefusing();
    expect(await orch.resume(paused.id, { manual: true })).toEqual({ ok: true, executionId: paused.id });
    const done = await h.waitForSettled(paused.id);
    expect(done.status).toBe('completed');
    expect(hook).toHaveBeenCalledTimes(2);
    const events = h.repos.alerts.events({ definitionId: def.id, limit: 100 });
    expect(events).toHaveLength(28);
    expect(new Set(events.map((e) => e.calendarPriceId)).size).toBe(28);
    const second = bodies(h)[1] ?? '';
    expect(second).toContain('1. £408.50 LHR→JFK 7 Nov–14 Nov (7n)');
    expect(second).not.toContain('2 Nov–9 Nov');
    expect(second).not.toContain('Not searched');
  });

  it('provider-month cap with no qualifying price: the paused pass sends nothing and records nothing', async () => {
    const { h, orch, hook, providers } = realKind((i) => (i >= 3 ? providerMonthBreach() : null));
    const def = h.createDefinition({ providers: providers() });
    calendarRule(h, def.id, 100);
    const paused = await h.runToCompletion(orch, def.id);
    expect(paused.status).toBe('paused_budget');
    expect(hook).toHaveBeenCalledTimes(1);
    await expect(hook.mock.results[0]?.value).resolves.toEqual({ digests: 0, events: 0 });
    expect(h.digests).toHaveLength(0);
  });

  it('a cap in discovery with a verification provider configured: "itinerary search not run" and a lower bound (review PA-2)', async () => {
    const { h, orch, providers } = realKind((i) => (i >= 2 ? freeCallCapBreach() : null));
    const def = h.createDefinition({ providers: providers(['fixture']) });
    calendarRule(h, def.id, 45_000);
    const paused = await h.runToCompletion(orch, def.id);
    expect(paused.status).toBe('paused_budget');
    const [body] = bodies(h);
    expect(body).toContain(
      'Coverage: itinerary search not run (a budget cap stopped the run during discovery)',
    );
    expect(body).toMatch(/Not searched: a budget cap left at least 24 cell searches of this run undone;/);
  });
});
```

`apps/api/test/bootstrap/engine.test.ts` (review TS-6: the wiring that makes alerts fire at all has a test of its own):

```ts
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import * as engine from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineFor } from '../../src/bootstrap/engine.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SMTP, silentLog, testEnv } from '../helpers/env.js';
import { onCleanup } from '../helpers/tmp.js';

function ports(extra: Record<string, string> = {}) {
  const p = buildPorts(loadConfigFromEnv(testEnv(extra)), {
    log: silentLog,
    clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => p.db.close());
  return p;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('engineFor: the production engine wiring (spec §8.1, §8.3; review TS-6)', () => {
  it('passes WP11 runAlerts as the alerts step and the log notifier alone without SMTP', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(ports(), silentLog);
    expect(spy).toHaveBeenCalledTimes(1);
    const [deps, opts] = spy.mock.calls[0] ?? [];
    expect(opts?.alerts).toBe(engine.runAlerts);
    expect(deps?.notifiers.map((n) => n.id)).toEqual(['log']);
  });

  it('adds the EmailNotifier when SMTP_* is configured', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(
      ports({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'alerts',
        SMTP_PASS: SENTINEL_SMTP,
        ALERT_EMAIL_TO: 'operator@example.com',
        ALERT_EMAIL_FROM: 'get-me-there@example.com',
      }),
      silentLog,
    );
    expect(spy.mock.calls[0]?.[0].notifiers.map((n) => n.id)).toEqual(['log', 'email']);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/api exec vitest run test/bootstrap/engine.test.ts`. Expected: FAIL, because `../../src/bootstrap/engine.js` cannot be resolved. Then run `pnpm --filter @gmt/engine exec vitest run test/alerts/engine.alerts.test.ts`: PASS, 5 tests, green from the start — they pin WP7's step (completed and paused_budget, before the status write, the manual resume) and Tasks 11.1–11.7's runner end to end; replacing `runAlerts` with WP7's `noAlerts` in the first test makes it fail with `expected 0 to be greater than 0`, and dropping Task 11.5's earlier-pass query makes the free-call-cap test fail with `expected [ { id: 38, …(9) }, …(37) ] to have a length of 28 but got 38` (each restored).

- [ ] **Step 3: Implement.**

`apps/api/src/bootstrap/engine.ts`:

```ts
/**
 * The app's engine (spec §8.1, §8.3): the notifiers config asks for (the log always, email when SMTP_* is set, with the
 * ALERT_EMAIL_MAX_PER_HOUR ceiling) and WP11's alert runner as the alerts step. WP8's bootApp calls it, so the
 * production wiring has a test of its own (review TS-6).
 */
import type { Logger } from '@gmt/core';
import { buildNotifiers, createEngine, type Engine, runAlerts } from '@gmt/engine';
import type { Ports } from '../wiring.js';

export function engineFor(ports: Ports, log: Logger): Engine {
  return createEngine(
    { ...ports, notifiers: buildNotifiers(ports.config, log, ports.clock) },
    { alerts: runAlerts },
  );
}
```

In WP8's `apps/api/src/bootstrap/app.ts`, in `bootApp`, replace:

```ts
    // why: WP11 adds `{ alerts: runAlerts }` to these options; until then the engine's default noAlerts step runs.
    const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
```

with:

```ts
    // why: spec §8.1, §8.3 — WP11's alert runner as the alerts step, the notifiers config asks for (engine.ts).
    const engine = engineFor(ports, log);
```

import `engineFor` from `./engine.js`, and drop `createEngine` and `LogNotifier` from the `@gmt/engine` import if nothing else in the file uses them.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/api exec vitest run test/bootstrap/engine.test.ts` (PASS, 2 tests), then `pnpm --filter @gmt/api test` and `pnpm --filter @gmt/engine exec vitest run test/alerts/` (PASS, 158 tests).

- [ ] **Step 5: Commit.** `git add packages/engine apps/api && git commit -m "wp11: alerts step over real-kind prices through a pause and a resume; engineFor wires the runner and notifiers (spec §8.1)"`

### Task 11.9: EmailNotifier over nodemailer; the outgoing ceiling; operator messages once a day per kind and definition

**Files:**
- Create `packages/engine/src/notifiers/email.ts` and `packages/engine/src/notifiers/index.ts`.
- Modify `packages/engine/src/index.ts`, WP7's `packages/engine/src/notify.ts`, `packages/engine/test/notifications.test.ts`, `packages/engine/vitest.config.ts`, and WP4b's `apps/api/test/helpers/env.ts` and `apps/api/test/bootstrap/tool.test.ts`.
- Test `packages/engine/test/notifiers/email.test.ts`.

**Interfaces:** Consumes `Secret`, `isMailbox`, `smtpPlaintextAllowed`, `scrubSecrets`, `stripUrlsInText`, `containsSynthetic` (WP7), `controlFree`, `stripControl`, `NotificationsRepo.lastSent`, `londonDateOf`. Produces `EmailNotifier`, `EmailNotifierOptions`, `SMTP_TIMEOUTS`, `smtpTransportOptions`, `buildNotifiers(config, log, clock)` and the types of §5.

- [ ] **Step 1: Write the failing tests.** `packages/engine/test/notifiers/email.test.ts` (one test per TLS mode and hostile host, review TS-17; exact subjects for hostile digests and operator messages, TS-9 and TS-14; the ceiling, decision 56; codes-only logging, sec-008; the scrub fallback, sec-002, which logs a codes-only `scrub_refused` warning rather than failing silently (decision 59, review arch-wp11-r2-006); no socket from `buildNotifiers`, TS-8):

```ts
import { Socket } from 'node:net';
import { asIsoDateTime, fixedClock, type OperatorMessage, Secret } from '@gmt/core';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { renderBody, renderSubject } from '../../src/alerts/templates.js';
import {
  EmailNotifier,
  type EmailNotifierOptions,
  type MailMessage,
  SMTP_TIMEOUTS,
  type SmtpConfig,
  type SmtpTransportOptions,
  smtpTransportOptions,
  type TransportFactory,
} from '../../src/notifiers/email.js';
import { buildNotifiers } from '../../src/notifiers/index.js';
import { calendarItem, digestOf, HASH, NOW, renderInput, verifiedItem } from '../alerts/builders.js';
import { captureLogger } from '../alerts/fixtures.js';

// Engine tests make no outbound connection (plan decisions 18, 20: test/support/setup.ts refuses DNS and unmatched
// requests); the transport is nodemailer's jsonTransport, and buildNotifiers is checked to open no socket.
const PASS = 'test-smtp-pass-0123456789abcdef';
const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: 'smtp.example.com',
  port: 465,
  tls: 'implicit',
  user: 'alerts',
  pass: new Secret(PASS),
  to: 'operator@example.com',
  from: 'get-me-there@example.com',
  ...over,
});
const AUTH = { user: 'alerts', pass: PASS };
/** nodemailer's jsonTransport message (info.message), parsed rather than cast. */
const jsonMessage = z.object({
  subject: z.string(),
  text: z.string(),
  html: z.unknown().optional(),
  headers: z.record(z.string(), z.unknown()).optional(),
  bcc: z.unknown().optional(),
});

/** A factory that records the SMTP options and sends through nodemailer's jsonTransport. */
function jsonFactory() {
  const options: SmtpTransportOptions[] = [];
  const messages: Array<{
    envelope: { from: string | false; to: string[] };
    parsed: z.output<typeof jsonMessage>;
  }> = [];
  const factory: TransportFactory = (o) => {
    options.push(o);
    const json = nodemailer.createTransport({ jsonTransport: true });
    return {
      async sendMail(m: MailMessage) {
        const info = await json.sendMail(m);
        messages.push({
          envelope: { from: info.envelope.from, to: info.envelope.to },
          parsed: jsonMessage.parse(JSON.parse(String(info.message))),
        });
        return { messageId: info.messageId };
      },
    };
  };
  return { factory, options, messages };
}

function notifier(over: Partial<EmailNotifierOptions> = {}) {
  const t = jsonFactory();
  const log = captureLogger();
  const clock = fixedClock(NOW);
  const n = new EmailNotifier({
    smtp: smtp(),
    nodeEnv: 'production',
    log,
    clock,
    maxPerHour: 20,
    createTransport: t.factory,
    ...over,
  });
  return { n, t, log, clock };
}

function digestMessage(items = [verifiedItem()]) {
  const input = renderInput({ digest: digestOf(items) });
  const first = items[0] ?? verifiedItem();
  return {
    kind: 'digest' as const,
    digest: input.digest,
    subject: renderSubject(first, NOW),
    body: renderBody(input),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SMTP_TLS → transport options (spec §8.3; review TS-17, sec-006, arch-wp11-004)', () => {
  it('implicit → secure from connect, with the explicit timeouts and no tls override', () => {
    const o = smtpTransportOptions(smtp(), 'production');
    expect(o).toEqual({ host: 'smtp.example.com', port: 465, secure: true, auth: AUTH, ...SMTP_TIMEOUTS });
    expect(o).not.toHaveProperty('tls');
    expect(SMTP_TIMEOUTS).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  });
  it('starttls → requireTLS (the upgrade is mandatory)', () => {
    expect(smtpTransportOptions(smtp({ tls: 'starttls', port: 587 }), 'production')).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: AUTH,
      ...SMTP_TIMEOUTS,
    });
  });
  it.each([
    ['localhost', 'production'],
    ['127.0.0.1', 'production'],
    ['127.0.0.2', 'test'],
    ['::1', 'production'],
    ['mailpit', 'development'],
  ] as const)('none is allowed for %s under %s, and never attempts STARTTLS', (host, env) => {
    expect(smtpTransportOptions(smtp({ tls: 'none', host, port: 1025 }), env)).toMatchObject({
      secure: false,
      ignoreTLS: true,
    });
  });
  it.each([
    ['mailpit', 'production'],
    ['mailpit', 'test'],
    ['smtp.example.com', 'development'],
    ['127.evil.example', 'production'],
    ['localhost.evil.example', 'production'],
    ['127.0.0.1.evil.example', 'production'],
    ['[::1]', 'production'],
    ['LOCALHOST', 'production'],
  ] as const)('none is refused for %s under %s', (host, env) => {
    expect(() => smtpTransportOptions(smtp({ tls: 'none', host }), env)).toThrow(/SMTP_TLS=none/);
  });
});

describe('EmailNotifier with a jsonTransport (spec §8.3)', () => {
  it('envelope, exact subject and a plain-text body with provenance, coverage caveat and a validated link', async () => {
    const { n, t } = notifier();
    expect(await n.send(digestMessage())).toEqual({ ok: true });
    expect(t.options[0]).toMatchObject({ secure: true, ...SMTP_TIMEOUTS });
    const [m] = t.messages;
    expect(m?.envelope).toEqual({ from: 'get-me-there@example.com', to: ['operator@example.com'] });
    expect(m?.parsed.subject).toBe(
      "[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown · 1 constraint unverified",
    );
    expect(m?.parsed.html).toBeUndefined();
    expect(m?.parsed.text).toContain(
      "   Provenance: Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown",
    );
    expect(m?.parsed.text).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');
    expect(m?.parsed.text).toContain(
      '   Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
    );
  });

  it('a POST booking links to the app results row instead', async () => {
    const { n, t } = notifier();
    await n.send(
      digestMessage([
        verifiedItem({
          booking: {
            kind: 'post',
            url: 'https://www.google.com/travel/clk/f',
            postData: 'x=1',
            host: 'www.google.com',
          },
        }),
      ]),
    );
    expect(t.messages[0]?.parsed.text).toContain(`/?view=results&def=def-1&basis=verified&row=${HASH}`);
  });

  it('refuses synthetic rows before anything is sent', async () => {
    const { n, t } = notifier();
    const synthetic = calendarItem({
      provenance: { ...calendarItem().provenance, providerId: 'fixture', sourceKind: 'synthetic' },
    });
    const msg = {
      kind: 'digest' as const,
      digest: digestOf([calendarItem()], { newItems: [synthetic] }),
      subject: 's',
      body: 'b',
    };
    expect(await n.send(msg)).toEqual({
      ok: false,
      detail: 'synthetic data is never delivered by a notifier',
    });
    expect(t.messages).toHaveLength(0);
  });

  it('a digest with a hostile seller, carrier and booking host: exact subject, no extra header (review TS-9)', async () => {
    const { n, t } = notifier();
    const hostile = verifiedItem({
      seller: 'Cheap\r\nBcc: victim@example.org',
      booking: {
        kind: 'get',
        url: 'https://www.google.com/travel/clk?tfs=abc',
        host: 'www.google.com\r\nBcc: x@example.org',
      },
    });
    await n.send(digestMessage([hostile]));
    const parsed = t.messages[0]?.parsed;
    expect(parsed?.subject).toBe(
      "[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · vendor's cache age unknown · 1 constraint unverified",
    );
    expect(parsed?.bcc).toBeUndefined();
    expect(Object.keys(parsed?.headers ?? {})).toEqual([]);
    expect(parsed?.text).toContain('   Seller: Cheap Bcc: victim@example.org');
    expect(parsed?.text).toContain('Link: none (the stored link failed validation)');
  });

  it('an operator message with every kind of control character: exact subject, LF-only body with its indentation kept (review TS-14)', async () => {
    const { n, t } = notifier();
    const message: OperatorMessage = {
      kind: 'paused_error',
      executionId: 'ex-1',
      definitionId: 'def-1',
      subject: '[get-me-there] paused\r\nBcc: victim@example.org\u0000\u007F\u0085\u2028\u202E\u200B\uFEFF!',
      body: 'line one\r\n   line two\u0007\rline three\nline four\u2029end',
    };
    await n.send({ kind: 'operator', message });
    expect(t.messages[0]?.parsed.subject).toBe('[get-me-there] paused Bcc: victim@example.org !');
    expect(t.messages[0]?.parsed.text).toBe('line one\n   line two \nline three\nline four end');
  });

  it('refuses at construction an address that is not one mailbox (review sec-001)', () => {
    for (const to of [
      'a@example.com, b@example.org',
      'ops@example.com\r\nBcc: x@example.org',
      'Ops <ops@example.com>',
    ])
      expect(() => notifier({ smtp: smtp({ to }) })).toThrow(/one email address/);
    expect(() => notifier({ smtp: smtp({ from: 'a@example.com;b@example.org' }) })).toThrow(
      /one email address/,
    );
  });

  it(`sends at most ALERT_EMAIL_MAX_PER_HOUR in any hour; beyond it the message is logged and dropped (decision 56)`, async () => {
    const { n, t, log, clock } = notifier({ maxPerHour: 2 });
    expect((await n.send(digestMessage())).ok).toBe(true);
    clock.advance(30 * 60_000);
    expect((await n.send(digestMessage())).ok).toBe(true);
    expect(await n.send(digestMessage())).toEqual({
      ok: false,
      detail: 'outgoing email ceiling reached (2 per hour); message dropped',
    });
    expect(t.messages).toHaveLength(2);
    expect(
      log.lines.some((l) => l.level === 'warn' && l.msg === 'email ceiling reached; message dropped'),
    ).toBe(true);
    clock.set(asIsoDateTime('2026-10-14T16:00:00.000Z')); // the first send is now an hour old
    expect((await n.send(digestMessage())).ok).toBe(true);
    expect(t.messages).toHaveLength(3);
  });

  it('a transport failure returns ok:false; the password reaches neither the detail nor the log, and the log holds codes only (review sec-008)', async () => {
    const log = captureLogger();
    const failing: TransportFactory = () => ({
      sendMail: async () => {
        throw Object.assign(
          new Error(
            `535 authentication failed for alerts:${PASS} at https://smtp.example.com/x?token=${PASS}`,
          ),
          {
            code: 'EAUTH',
            responseCode: 535,
          },
        );
      },
    });
    const { n } = notifier({ log, createTransport: failing });
    const msg = digestMessage();
    const r = await n.send(msg);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('535 authentication failed');
    expect(r.detail).not.toContain(PASS);
    expect(r.detail).not.toContain('token=');
    const warn = log.lines.find((l) => l.msg === 'email not sent');
    expect(warn?.fields).toMatchObject({ code: 'EAUTH', responseCode: 535 });
    const all = JSON.stringify(log.lines);
    expect(all).not.toContain(PASS);
    expect(all).not.toContain('535 authentication failed');
    expect(all).not.toContain('Seller: British Airways'); // the body is never logged
  });

  it('when scrubSecrets throws (a secret survived it), send still answers ok:false with a fixed detail (review sec-002)', async () => {
    const failing: TransportFactory = () => ({
      sendMail: async () => {
        throw new Error('535 refused');
      },
    });
    const providers = await import('@gmt/providers');
    vi.spyOn(providers, 'scrubSecrets').mockImplementation(() => {
      throw new Error('scrubSecrets: a secret survived scrubbing');
    });
    const log = captureLogger();
    const { n } = notifier({ log, createTransport: failing });
    expect(await n.send(digestMessage())).toEqual({ ok: false, detail: 'smtp send failed; detail withheld' });
    expect(log.lines.find((l) => l.msg === 'email failure detail withheld')?.fields).toMatchObject({
      code: 'scrub_refused',
    });
  });
});

describe('buildNotifiers', () => {
  it('log only without SMTP; log and email with it; creating the transporter opens no connection', () => {
    const connect = vi.spyOn(Socket.prototype, 'connect');
    const clock = fixedClock(NOW);
    expect(
      buildNotifiers(
        { smtp: null, nodeEnv: 'production', alertEmailMaxPerHour: 20 },
        captureLogger(),
        clock,
      ).map((n) => n.id),
    ).toEqual(['log']);
    expect(
      buildNotifiers(
        { smtp: smtp(), nodeEnv: 'production', alertEmailMaxPerHour: 20 },
        captureLogger(),
        clock,
      ).map((n) => n.id),
    ).toEqual(['log', 'email']);
    expect(connect).not.toHaveBeenCalled();
  });
});
```

In WP7's `packages/engine/test/notifications.test.ts`, add `HOUR` to the harness import and replace the test "a second execution of the same definition is told again: the key is (kind, execution), not kind alone (test-strategy-reviewer-025)" with:

```ts
  it('a second execution of the same definition is told on a later London day, not the same day (decision 56; test-strategy-reviewer-025)', async () => {
    const h = createHarness();
    const first = await anExecution(h);
    const def = h.repos.definitions.get(first.definitionId);
    if (def === null) throw new Error('no definition');
    const second = await h.runToCompletion(h.orch(), def.id);
    const ctx = buildContext(h.deps, h.options);
    const p = (executionId: string) => ({
      executionId,
      definitionId: def.id,
      definitionName: 'x',
      detail: 'cap',
    });
    expect(await notifyOperator(ctx, 'paused_budget', p(first.id))).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(false);
    expect(await notifyOperator(ctx, 'paused_error', p(second.id))).toBe(true); // another kind is told
    h.clock.advance(24 * HOUR);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(false);
    expect(h.notifications.map((m) => [m.kind, m.body.split('\n').at(-1)])).toEqual([
      ['paused_budget', `Execution: ${first.id}`],
      ['paused_error', `Execution: ${second.id}`],
      ['paused_budget', `Execution: ${second.id}`],
    ]);
  });
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts test/notifications.test.ts`. Expected: FAIL: `email.test.ts` cannot resolve `../../src/notifiers/email.js`; the replaced notifications test fails with `expected true to be false` (the second execution is told the same day).

- [ ] **Step 3: Implement.**

`packages/engine/src/notifiers/email.ts`:

```ts
/**
 * EmailNotifier (spec §8.3): nodemailer SMTP, plain text only, SMTP_TLS mapped to transport options with short
 * timeouts, one mailbox per address, subjects and bodies cleaned by the engine's one cleaner, synthetic data refused,
 * an outgoing ceiling per hour (decision 56), and the SMTP password scrubbed from every error.
 */
import {
  type Clock,
  type Config,
  type IsoDateTime,
  isMailbox,
  type Logger,
  type Notifier,
  smtpPlaintextAllowed,
  stripUrlsInText,
} from '@gmt/core';
import { scrubSecrets } from '@gmt/providers';
import nodemailer from 'nodemailer';
import { controlFree, stripControl } from '../text.js';
import { containsSynthetic } from './log.js';

export type SmtpConfig = NonNullable<Config['smtp']>;

/**
 * Socket timeouts, in milliseconds (arch-wp11-004). nodemailer's defaults (2 min to connect, 30 s greeting, 10 min of
 * inactivity) would let a stalled server hold the alerts step, which runs before the execution's status write.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/** The subset of nodemailer SMTP options this app sets; certificate checks stay at nodemailer's default (on). */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}
/** The one transporter method used; nodemailer's Transporter satisfies it. */
export interface MailTransport {
  sendMail(m: MailMessage): Promise<{ messageId: string }>;
}
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;

/**
 * SMTP_TLS → nodemailer options: implicit = TLS from connect; starttls = mandatory upgrade; none = core's
 * smtpPlaintextAllowed only (loopback, or the dev Mailpit host), re-checked here because a Config could be built by
 * hand. Throws on a refused combination.
 */
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions {
  const base = {
    host: smtp.host,
    port: smtp.port,
    auth: { user: smtp.user, pass: smtp.pass.reveal() },
    ...SMTP_TIMEOUTS,
  };
  switch (smtp.tls) {
    case 'implicit':
      return { ...base, secure: true };
    case 'starttls':
      return { ...base, secure: false, requireTLS: true };
    case 'none':
      if (!smtpPlaintextAllowed(smtp.host, nodeEnv))
        throw new Error(
          `SMTP_TLS=none is permitted only for a loopback host or the dev Mailpit profile; host ${smtp.host} refused (spec §8.3)`,
        );
      return { ...base, secure: false, ignoreTLS: true };
  }
}

const defaultFactory: TransportFactory = (o) => nodemailer.createTransport(o);

/** A plain-text body: LF line endings (CRLF, a lone CR and a lone LF all end a line), every line control-free. */
function plainText(body: string): string {
  return body
    .split(/\r\n|\r|\n/)
    .map(controlFree)
    .join('\n');
}

/** nodemailer's error code and SMTP response code, the only parts of a failure that are logged (sec-008). */
function failureCodes(err: unknown): { code: string | null; responseCode: number | null } {
  if (typeof err !== 'object' || err === null) return { code: null, responseCode: null };
  const code = 'code' in err && typeof err.code === 'string' ? err.code : null;
  const responseCode =
    'responseCode' in err && typeof err.responseCode === 'number' ? err.responseCode : null;
  return { code, responseCode };
}

const HOUR_MS = 3_600_000;

export interface EmailNotifierOptions {
  smtp: SmtpConfig;
  nodeEnv: Config['nodeEnv'];
  log: Logger;
  clock: Clock;
  /** ALERT_EMAIL_MAX_PER_HOUR (decision 56). */
  maxPerHour: number;
  createTransport?: TransportFactory;
}

/** Sends alert digests and operator messages as plain-text email. Spec §8.3. */
export class EmailNotifier implements Notifier {
  readonly id = 'email';
  readonly #transport: MailTransport;
  readonly #smtp: SmtpConfig;
  readonly #log: Logger;
  readonly #clock: Clock;
  readonly #maxPerHour: number;
  /** Instants of the sends attempted in the last hour (in process; a restart starts a fresh hour). */
  #recent: IsoDateTime[] = [];

  constructor(opts: EmailNotifierOptions) {
    // why: defence in depth for sec-001 — core's config already refuses anything but one mailbox per address
    if (!isMailbox(opts.smtp.to) || !isMailbox(opts.smtp.from))
      throw new Error('EmailNotifier: ALERT_EMAIL_TO and ALERT_EMAIL_FROM must each be one email address');
    this.#smtp = opts.smtp;
    this.#log = opts.log.child({ notifier: 'email' });
    this.#clock = opts.clock;
    this.#maxPerHour = opts.maxPerHour;
    this.#transport = (opts.createTransport ?? defaultFactory)(smtpTransportOptions(opts.smtp, opts.nodeEnv));
  }

  async send(msg: Parameters<Notifier['send']>[0]): Promise<{ ok: boolean; detail?: string }> {
    // why: spec §5.5 — notifiers refuse synthetic rows; the same check and answer as WP7's LogNotifier.
    if (containsSynthetic(msg))
      return { ok: false, detail: 'synthetic data is never delivered by a notifier' };
    const subject = stripControl(msg.kind === 'digest' ? msg.subject : msg.message.subject);
    const now = this.#clock.now();
    this.#recent = this.#recent.filter((t) => Date.parse(now) - Date.parse(t) < HOUR_MS);
    if (this.#recent.length >= this.#maxPerHour) {
      // why: decision 56 — beyond the ceiling a message is logged and dropped; a digest's events stay queued for the next pass
      this.#log.warn(
        { kind: msg.kind, subject, maxPerHour: this.#maxPerHour },
        'email ceiling reached; message dropped',
      );
      return {
        ok: false,
        detail: `outgoing email ceiling reached (${this.#maxPerHour} per hour); message dropped`,
      };
    }
    this.#recent.push(now);
    const body = msg.kind === 'digest' ? msg.body : msg.message.body;
    const mail: MailMessage = { from: this.#smtp.from, to: this.#smtp.to, subject, text: plainText(body) };
    try {
      const info = await this.#transport.sendMail(mail);
      this.#log.info({ messageId: info.messageId }, 'email sent');
      return { ok: true };
    } catch (err) {
      this.#log.warn(failureCodes(err), 'email not sent');
      return { ok: false, detail: this.#detail(err) };
    }
  }

  /**
   * The failure for the event reason (spec §5.3): the SMTP password scrubbed and URLs stripped; when scrubbing itself
   * refuses (a secret form it cannot remove), a fixed text, so `send` still answers instead of rejecting (sec-002).
   * The SMTP user is an account name, not a secret, and may appear.
   */
  #detail(err: unknown): string {
    try {
      return stripUrlsInText(
        scrubSecrets(err instanceof Error ? err.message : String(err), [this.#smtp.pass]),
      );
    } catch {
      // why: decision 59 — no silent catch: the operator needs to know a failure detail was withheld
      this.#log.warn({ code: 'scrub_refused' }, 'email failure detail withheld');
      return 'smtp send failed; detail withheld';
    }
  }
}
```

`packages/engine/src/notifiers/index.ts`:

```ts
/** The notifier list for EngineDeps: the log always, email when SMTP is configured. Spec §8.3; decision 56. */
import type { Clock, Config, Logger, Notifier } from '@gmt/core';
import { EmailNotifier } from './email.js';
import { LogNotifier } from './log.js';

export function buildNotifiers(
  config: Pick<Config, 'smtp' | 'nodeEnv' | 'alertEmailMaxPerHour'>,
  log: Logger,
  clock: Clock,
): Notifier[] {
  const notifiers: Notifier[] = [new LogNotifier(log)];
  if (config.smtp !== null)
    notifiers.push(
      new EmailNotifier({
        smtp: config.smtp,
        nodeEnv: config.nodeEnv,
        log,
        clock,
        maxPerHour: config.alertEmailMaxPerHour,
      }),
    );
  return notifiers;
}
```

In `packages/engine/src/index.ts`, add after the `fxHttpLimits` export:

```ts
export {
  EmailNotifier,
  type EmailNotifierOptions,
  type MailMessage,
  type MailTransport,
  SMTP_TIMEOUTS,
  type SmtpConfig,
  type SmtpTransportOptions,
  smtpTransportOptions,
  type TransportFactory,
} from './notifiers/email.js';
export { buildNotifiers } from './notifiers/index.js';
```

In WP7's `packages/engine/src/notify.ts`, the core import becomes `import { londonDateOf, type OperatorMessage, type OperatorMessageKind } from '@gmt/core';`, `notifyOperator`'s context gains `'clock'`, and its doc comment and first lines become:

```ts
/**
 * Sends one operator notification to every notifier, at most once per (kind, execution) — per (kind, definition) when
 * there is no execution (spec §8.1 "deduplicated per execution and kind") — and at most once per kind per definition
 * per London day (decision 56), so a pause-and-resume loop cannot flood the inbox. Returns false when deduplicated.
 * Never throws: a failing notifier is logged and recorded as failed, because a notification must not stop a run.
 */
export async function notifyOperator(
  ctx: Pick<EngineContext, 'repos' | 'notifiers' | 'log' | 'clock'>,
  kind: OperatorMessageKind,
  p: NotifyParams,
): Promise<boolean> {
  if (ctx.repos.notifications.wasSent(kind, p.executionId, p.definitionId)) return false;
  const last = ctx.repos.notifications.lastSent(kind, p.definitionId);
  if (last !== null && londonDateOf(last) === ctx.clock.todayLondon()) {
    ctx.log.info(
      { kind, executionId: p.executionId, definitionId: p.definitionId },
      'operator notification already sent today',
    );
    return false;
  }
```

In `packages/engine/vitest.config.ts`, `thresholds` becomes (review TS-12: the runner decides what the operator is told, so it keeps a higher floor, and CI fails below either):

```ts
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 85,
        statements: 85,
        // why: the alert runner decides what the operator is told about a fare (WP11 review TS-12), so it keeps a higher floor
        'src/alerts/**': { lines: 95, branches: 80, functions: 95, statements: 95 },
      },
```

In WP4b's `apps/api/test/helpers/env.ts`, add `'ALERT_EMAIL_MAX_PER_HOUR'` to `ALL_VARS` after `'ALERT_EMAIL_FROM'`; in `apps/api/test/bootstrap/tool.test.ts`, the backup line reads `'backup before 3 migration(s)'` (0000, WP7's 0001, this WP's 0002).

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine test`: PASS with the thresholds met, the `src/alerts/**` floor included (assembled: 36 files, 470 tests; `src/alerts` 99.6% lines, 90.5% branches; `notifiers/email.ts` 100% lines). Then `pnpm --filter @gmt/api test`: PASS.

- [ ] **Step 5: Commit.** `git add packages/engine apps/api && git commit -m "wp11: EmailNotifier with timeouts, one-mailbox check, hourly ceiling and scrubbed details; operator messages once a day per kind and definition"`

### Task 11.10: Alerts view: rule form and rules list

> **Blocked until WP9 and WP10 merge.** The code below follows their reviewed briefs and was linted and cast-checked on its own; it has not been compiled or run against their code, so the Step 2 and Step 4 outcomes are unverified until then. Precondition: `pnpm --filter @gmt/web test` is green on main with WP10 merged.

**Files:**
- Create `apps/web/src/views/Alerts/RuleForm.tsx`, `ruleText.ts`, `AlertsView.tsx`, `index.ts`.
- Modify WP9's `apps/web/src/api/types.ts`, `src/api/endpoints.ts`, `src/copy.ts`, `src/App.tsx`, `src/components/Provenance.tsx`, `src/components/PriceCell.tsx`, the Providers view and `src/lib/sources.ts` (the source wording), `test/msw/handlers.ts`, `test/guards.ts`, `test/copy/catalogue.test.ts`, `test/app/shell.test.tsx`.
- Test `apps/web/test/views/Alerts/RuleForm.test.tsx`.

**Interfaces:**
- **Consumes:** `apiContract.alertRuleInputSchema`, `alertRuleSchema`, `alertEventSchema`, `AlertRule`, `sourceLabel`, `SOURCE_LABELS`, WP9's `call`, `api`, `COPY` (`loading`, `fieldError`), `parsePoundsToPence`, `formatPence`, `renderWithProviders`, `server`, `API`.
- **Produces:** `AlertsView`, `describeRule`, `COPY.alertsView`, `AlertRuleBody`, `api.alertRules/createAlertRule/deleteAlertRule/alertEvents`.

- [ ] **Step 1: Write the failing test** in `apps/web/test/views/Alerts/RuleForm.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AlertsView } from '../../../src/views/Alerts/index.js';
import { API } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const C = COPY.alertsView;
let posted: Array<{ body: unknown; xrw: string | null; ct: string | null }> = [];

beforeEach(() => {
  posted = [];
  server.use(
    http.post(`${API}/alerts`, async ({ request }) => {
      const body = await request.json();
      posted.push({
        body,
        xrw: request.headers.get('X-Requested-With'),
        ct: request.headers.get('Content-Type'),
      });
      const rule = {
        id: `rule-${posted.length}`,
        ...(typeof body === 'object' && body !== null ? body : {}),
      };
      return HttpResponse.json(rule, { status: 201 });
    }),
  );
});

describe('Alerts rule form (spec §6.8, §11)', () => {
  it('defaults: absolute rule, itinerary-search basis, cooldown 336 h; deleting keeps history', async () => {
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByLabelText(C.cooldown)).toHaveValue(336);
    expect(screen.getByText(C.deleteKeepsHistory)).toBeInTheDocument();
    expect(screen.getByLabelText(C.ruleType)).toHaveValue('absolute');
    expect(screen.getByLabelText(C.basis)).toHaveValue('verified');
    expect(screen.getByLabelText(C.requireAll)).toBeEnabled();
  });

  it('requireAllVerified is disabled on the calendar basis and never sent', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.click(await screen.findByLabelText(C.requireAll));
    await user.selectOptions(screen.getByLabelText(C.basis), 'calendar');
    expect(screen.getByLabelText(C.requireAll)).toBeDisabled();
    await user.type(screen.getByLabelText(C.threshold), '450');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      body: {
        definitionId: 'def-1',
        type: 'absolute',
        thresholdPence: 45000,
        pct: null,
        basis: 'calendar',
        requireAllVerified: null,
        cooldownHours: 336,
        enabled: true,
      },
      xrw: 'get-me-there',
      ct: 'application/json',
    });
  });

  it('a percentage drop sends pct; pounds with pence convert without floats', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.selectOptions(await screen.findByLabelText(C.ruleType), 'dropPct');
    await user.type(screen.getByLabelText(C.dropPct), '12');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({
      definitionId: 'def-1',
      type: 'dropPct',
      thresholdPence: null,
      pct: 12,
      basis: 'verified',
      requireAllVerified: false,
      cooldownHours: 336,
      enabled: true,
    });

    await user.selectOptions(screen.getByLabelText(C.ruleType), 'dropAbs');
    await user.type(screen.getByLabelText(C.threshold), '20.50');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.body).toMatchObject({ type: 'dropAbs', thresholdPence: 2050, pct: null });
  });

  it('invalid input is rejected by alertRuleInputSchema with a field message and nothing is sent', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.type(await screen.findByLabelText(C.threshold), 'abc');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.threshold);
    expect(posted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx`. Expected (unverified until WP9/WP10 merge): FAIL, because `../../../src/views/Alerts/index.js` cannot be resolved and `COPY.alertsView` is undefined.

- [ ] **Step 3: Implement.**

In `apps/web/src/copy.ts`, add this entry to `COPY` (the "£" in the threshold label is a form label, which the sweep allows; "verified" sits beside class names only; a queued event reads "not delivered", because only a later pass of its own execution resends it and its reason says whether one will, decision 59, review PA2-5):

```ts
  // Alerts view (WP11; spec §6.8, §11). "verified" appears only beside class-verified values.
  alertsView: {
    heading: 'Alerts',
    intro:
      'One email per rule per run: the ten cheapest matches and a count of the rest, each price with its source and age.',
    formLabel: 'New alert rule',
    ruleType: 'Rule type',
    typeAbsolute: 'Price at or below',
    typeDropPct: 'Drop by percent',
    typeDropAbs: 'Drop by amount',
    threshold: 'Threshold (£)',
    dropPct: 'Drop (%)',
    notSet: 'not set',
    basis: 'Basis',
    basisVerified: 'Itinerary-search basis (class verified or partially-verified)',
    basisCalendar: 'Calendar basis (constraints not checked)',
    requireAll: 'Only class verified (every constraint passed)',
    requireAllCalendarNote:
      'Calendar prices carry no constraint checks, so this option applies to the itinerary-search basis only.',
    cooldown: 'Cooldown (hours)',
    cooldownHint: 'Default 336 h (two weeks), deliberately longer than a weekly schedule.',
    cooldownText: (hours: number) => `cooldown ${hours}h`,
    addRule: 'Add rule',
    deleteRule: 'Delete rule',
    deleteKeepsHistory: 'Deleting a rule stops it firing; its alert history below is kept.',
    notSaved: (message: string) => `Rule not saved: ${message}`,
    rulesHeading: 'Rules',
    noRules: 'No alert rules for this definition yet.',
    eventsHeading: 'Alert events',
    eventsTable: 'Alert events',
    noEvents: 'No alerts have fired for this definition yet.',
    colFired: 'Fired',
    colRule: 'Rule',
    colStatus: 'Status',
    colTrip: 'Trip',
    colPrice: 'Price',
    colPrevious: 'Previous price',
    colClass: 'Constraints',
    colReason: 'Reason',
    // why: decision 59 — only a later pass of its own execution resends a queued event; its reason says if one will
    status: { queued: 'not delivered', notified: 'sent', suppressed: 'suppressed' },
    listedAsNew: 'listed as new (not a drop)',
    classVerified: 'class verified',
    classPartial: (unverified: string) => `partially-verified; unverified: ${unverified}`,
    classUnchecked: 'constraints not checked',
    noPrevious: 'none',
    noReason: 'no reason recorded',
    notRecorded: 'not recorded',
  },
```

In `apps/web/src/api/types.ts`, add:

```ts
/** An alert rule as the form sends it: the schema's input shape (cooldownHours may be left to its default of 336). */
export type AlertRuleBody = z.input<typeof apiContract.alertRuleInputSchema>;
```

In `apps/web/src/api/endpoints.ts`, add `AlertRuleBody` to the `./types.js` import and these entries to `api` (each names its `ROUTES` path and response schema, as `call` requires):

```ts
  alertRules: (definitionId: string) =>
    call(c.alertRuleSchema.array(), 'GET', '/api/alerts', { query: { definitionId } }),
  createAlertRule: (body: AlertRuleBody) => call(c.alertRuleSchema, 'POST', '/api/alerts', { body }),
  // why: DELETE soft-deletes the rule (AlertsRepo.softDelete); its events stay listed.
  deleteAlertRule: (id: string) => call(c.alertRuleSchema, 'DELETE', '/api/alerts/:id', { params: { id } }),
  alertEvents: (definitionId: string, limit: number) =>
    call(c.alertEventSchema.array(), 'GET', '/api/alerts/events', {
      query: { definitionId, limit: String(limit) },
    }),
```

`apps/web/src/views/Alerts/ruleText.ts`:

```ts
/** One line per alert rule for the Alerts view (spec §6.8, §11), built from catalogue strings only. */
import type { AlertRule } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';

const C = COPY.alertsView;

/** "Price at or below £450 · Calendar basis (constraints not checked) · cooldown 336h"; a missing figure reads "not set". */
export function describeRule(r: AlertRule): string {
  const pounds = r.thresholdPence === null ? C.notSet : formatPence(r.thresholdPence);
  const what =
    r.type === 'absolute'
      ? `${C.typeAbsolute} ${pounds}`
      : r.type === 'dropAbs'
        ? `${C.typeDropAbs} ${pounds}`
        : `${C.typeDropPct} ${r.pct === null ? C.notSet : `${r.pct}%`}`;
  const basis =
    r.basis === 'calendar' ? C.basisCalendar : r.requireAllVerified === true ? C.requireAll : C.basisVerified;
  return `${what} · ${basis} · ${C.cooldownText(r.cooldownHours)}`;
}
```

`apps/web/src/views/Alerts/RuleForm.tsx`:

```tsx
/** Alert rule form (spec §6.8, §11): type, threshold or percentage, basis, requireAllVerified on the itinerary-search basis only, cooldown. */
import { apiContract } from '@gmt/core';
import { type FormEvent, useState } from 'react';
import type { AlertRuleBody } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { parsePoundsToPence } from '../../format.js';

const C = COPY.alertsView;
const RULE_TYPES = ['absolute', 'dropPct', 'dropAbs'] as const;
const BASES = ['verified', 'calendar'] as const;
type RuleType = (typeof RULE_TYPES)[number];
type Basis = (typeof BASES)[number];

/** A select's value narrowed by lookup (decision 48: no casts); the options are the only values it can hold. */
function ruleTypeOf(v: string): RuleType {
  return RULE_TYPES.find((t) => t === v) ?? 'absolute';
}
function basisOf(v: string): Basis {
  return BASES.find((b) => b === v) ?? 'verified';
}

/** The field label a zod issue belongs to, by the first segment of its path. */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  thresholdPence: C.threshold,
  pct: C.dropPct,
  cooldownHours: C.cooldown,
  basis: C.basis,
  requireAllVerified: C.requireAll,
  type: C.ruleType,
};

/** A number field: empty or unparsable input becomes NaN, which the schema rejects with a field message. */
function numberOrNaN(s: string): number {
  return s.trim() === '' ? Number.NaN : Number(s);
}

export function RuleForm(props: {
  definitionId: string;
  onSubmit: (body: AlertRuleBody) => void;
  busy: boolean;
}) {
  const [type, setType] = useState<RuleType>('absolute');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState('');
  const [basis, setBasis] = useState<Basis>('verified');
  const [requireAll, setRequireAll] = useState(false);
  const [cooldown, setCooldown] = useState('336');
  const [errors, setErrors] = useState<string[]>([]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = apiContract.alertRuleInputSchema.safeParse({
      definitionId: props.definitionId,
      type,
      thresholdPence: type === 'dropPct' ? null : (parsePoundsToPence(amount) ?? Number.NaN),
      pct: type === 'dropPct' ? numberOrNaN(pct) : null,
      basis,
      // why: spec §6.8 — requireAllVerified exists only on the itinerary-search basis; the schema rejects it on calendar.
      requireAllVerified: basis === 'verified' ? requireAll : null,
      cooldownHours: numberOrNaN(cooldown),
      enabled: true,
    });
    if (!parsed.success) {
      setErrors(
        parsed.error.issues.map((i) =>
          COPY.fieldError(FIELD_LABEL[String(i.path[0])] ?? C.formLabel, i.message),
        ),
      );
      return;
    }
    setErrors([]);
    props.onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-3" aria-label={C.formLabel}>
      <label className="grid gap-1">
        <span>{C.ruleType}</span>
        <select aria-label={C.ruleType} value={type} onChange={(e) => setType(ruleTypeOf(e.target.value))}>
          <option value="absolute">{C.typeAbsolute}</option>
          <option value="dropPct">{C.typeDropPct}</option>
          <option value="dropAbs">{C.typeDropAbs}</option>
        </select>
      </label>
      {type === 'dropPct' ? (
        <label className="grid gap-1">
          <span>{C.dropPct}</span>
          <input
            aria-label={C.dropPct}
            inputMode="numeric"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </label>
      ) : (
        <label className="grid gap-1">
          <span>{C.threshold}</span>
          <input
            aria-label={C.threshold}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      )}
      <label className="grid gap-1">
        <span>{C.basis}</span>
        <select aria-label={C.basis} value={basis} onChange={(e) => setBasis(basisOf(e.target.value))}>
          <option value="verified">{C.basisVerified}</option>
          <option value="calendar">{C.basisCalendar}</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label={C.requireAll}
          disabled={basis === 'calendar'}
          checked={basis === 'verified' && requireAll}
          onChange={(e) => setRequireAll(e.target.checked)}
        />
        <span>{C.requireAll}</span>
      </label>
      {basis === 'calendar' ? <p className="text-sm">{C.requireAllCalendarNote}</p> : null}
      <label className="grid gap-1">
        <span>{C.cooldown}</span>
        <input
          aria-label={C.cooldown}
          type="number"
          min={1}
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
        />
        <span className="text-sm">{C.cooldownHint}</span>
      </label>
      {errors.length > 0 ? (
        <div role="alert" className="text-sm text-red-800">
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}
      <button type="submit" disabled={props.busy}>
        {C.addRule}
      </button>
    </form>
  );
}
```

`apps/web/src/views/Alerts/AlertsView.tsx`:

```tsx
/** Alerts view (spec §11): the rule form and the rules list. Task 11.11 adds the events list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import { COPY } from '../../copy.js';
import { RuleForm } from './RuleForm.js';
import { describeRule } from './ruleText.js';

const C = COPY.alertsView;

export const alertKeys = {
  rules: (id: string) => ['alerts', id] as const,
  events: (id: string) => ['alert-events', id] as const,
};

export function AlertsView(props: { definitionId: string }) {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: alertKeys.rules(props.definitionId),
    queryFn: () => api.alertRules(props.definitionId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: alertKeys.rules(props.definitionId) });
  const create = useMutation({ mutationFn: api.createAlertRule, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: refresh });
  const list = rules.data ?? [];

  return (
    <section aria-labelledby="alerts-heading" className="grid gap-6">
      <h2 id="alerts-heading">{C.heading}</h2>
      <p>{C.intro}</p>
      <RuleForm
        definitionId={props.definitionId}
        onSubmit={(b) => create.mutate(b)}
        busy={create.isPending}
      />
      {create.isError ? <p role="alert">{C.notSaved(create.error.message)}</p> : null}
      <div>
        <h3>{C.rulesHeading}</h3>
        <p className="text-sm">{C.deleteKeepsHistory}</p>
        {rules.isLoading ? (
          <p>{COPY.loading}</p>
        ) : list.length === 0 ? (
          <p>{C.noRules}</p>
        ) : (
          <ul>
            {list.map((r) => (
              <li key={r.id} className="flex gap-2">
                {/* why: decision 55 — a rule's threshold is a price quoted in text, which WP9's sweep allows inside [data-quote] */}
                <span data-quote>{describeRule(r)}</span>
                <button type="button" onClick={() => remove.mutate(r.id)}>
                  {C.deleteRule}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

`apps/web/src/views/Alerts/index.ts`:

```ts
/** Alerts view barrel (WP11); WP9's App mounts AlertsView. */
export { AlertsView } from './AlertsView.js';
export { describeRule } from './ruleText.js';
```

In `apps/web/src/App.tsx`: add `view === 'alerts'` to the `needsDefinition` disjunction; replace `{view === 'alerts' ? <Placeholder /> : null}` with `{view === 'alerts' && selected !== null ? <AlertsView definitionId={selected.id} /> : null}`; add `import { AlertsView } from './views/Alerts/index.js';` and drop the `Placeholder` import, which nothing in `App.tsx` uses any more. `src/views/Placeholder.tsx` and `COPY.placeholder` stay: ruling for review arch-wp11-014, they are kept for the Phase 4 views the nav will gain, and WP10's wiring test reads `COPY.placeholder` to prove no view shows it. Add above the component's export in `Placeholder.tsx`: `// why: no Phase 1–3 view renders it after WP11; kept for the Phase 4 views (WP11 brief §12).`

The one copy of the source wording (decision 56): run `grep -rn "COPY.source" apps/web/src` and replace every `COPY.source[x.sourceKind]` with `sourceLabel(x)` (in `src/components/Provenance.tsx`, `src/components/PriceCell.tsx` and the Providers view, each importing `sourceLabel` from `@gmt/core`) and every `COPY.source[k]` with `SOURCE_LABELS[k]` (in `src/lib/sources.ts`, importing `SOURCE_LABELS`); then delete the `source` entry from `COPY`. The grep then prints nothing.

In `apps/web/test/msw/handlers.ts`, add to `handlers` (the default API answers no rules and no events):

```ts
  http.get(url('/api/alerts'), () => HttpResponse.json([])),
  http.get(url('/api/alerts/events'), () => HttpResponse.json([])),
```

In `apps/web/test/guards.ts` (decision 55):

- add `'src/views/Alerts/ruleText.ts'` to `MONEY_FILES`, with the why line `// why: decision 55 — a rule's threshold is a price quoted in text, rendered inside [data-quote], never a fare`;
- in the rendered sweep, replace `host?.closest('[data-testid="price-cell"], [data-cost], label') === null` with `host?.closest('[data-testid="price-cell"], [data-cost], [data-quote], label') === null`, and in its doc comment replace "a [data-cost] element (a cost or a cap) or a form label" with "a [data-cost] element (a cost or a cap), a [data-quote] element (a price quoted in text: an alert threshold or firing reason, decision 55) or a form label".

In `apps/web/test/copy/catalogue.test.ts`, add `'alertsView.notSaved': ['database is locked']`, `'alertsView.cooldownText': [336]` and `'alertsView.classPartial': ['checked bag']` to `SAMPLES`, and `'alertsView.basisVerified'`, `'alertsView.requireAll'` and `'alertsView.classVerified'` to the `allowed` set of the "verified" test (each names the class).

In `apps/web/test/app/shell.test.tsx`, replace the `it.each(['alerts'])('%s is a placeholder that names no work package', …)` test with:

```tsx
  it('alerts renders the Alerts view for the selected definition', async () => {
    renderWithProviders(<App />, { search: '?view=alerts&def=def-0001' });
    expect(await screen.findByRole('heading', { name: COPY.alertsView.heading })).toBeInTheDocument();
    expect(screen.queryByText(COPY.placeholder)).toBeNull();
  });
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx` (expected PASS, 4 tests), then `pnpm --filter @gmt/web test`: the catalogue, source-guard, rendered-sweep, shell and wiring tests stay green. Unverified until WP9/WP10 merge.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "wp11: Alerts view rule form validated by alertRuleInputSchema; one copy of the source wording (decisions 55, 56)"`

### Task 11.11: Alerts view: events list with the fare and the previous price through PriceCell; banned words

> **Blocked until WP9 and WP10 merge** (as Task 11.10).

**Files:** Create `apps/web/src/views/Alerts/EventsTable.tsx`. Modify `apps/web/src/views/Alerts/AlertsView.tsx`. Test `apps/web/test/views/Alerts/AlertsView.test.tsx`.

**Interfaces:** Consumes `PriceCell` (with `unconfirmed`, `truncated`, `notSeenInLatestHours`), `PriceBoundary`, `useNow`, `formatRunInstant`, core's `alertEventPayloadSchema`, `isStale` and `hoursSince` (WP8), `CONSTRAINT_LABELS`, `provCalendar`, `provSearch`.

The payload is core's schema (decision 56), so the view and the runner cannot drift. Marks are stored as facts and judged now: the stale threshold goes through core's `isStale` against `useNow()`, and "not seen in latest search" is measured from the stored instant with core's `hoursSince` (review PA-7; decision 59: no local date helper). The verdict class and every unverified constraint are shown in words (PA-3); the previous price is a `PriceCell` with its own provenance, so no fare reaches the page without one (PA-4, decision 52); the reason, which quotes those prices, sits in `data-quote` (decision 55).

- [ ] **Step 1: Write the failing test** in `apps/web/test/views/Alerts/AlertsView.test.tsx`:

```tsx
import { type AlertEventPayload, BANNED_WORD_ALLOWLIST, CONSTRAINT_LABELS, findBannedWords } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AlertsView, describeRule } from '../../../src/views/Alerts/index.js';
import { API, provCalendar, provSearch } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const C = COPY.alertsView;
const rules = [
  {
    id: 'r1',
    definitionId: 'def-1',
    type: 'absolute',
    thresholdPence: 45000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  },
  {
    id: 'r2',
    definitionId: 'def-1',
    type: 'dropPct',
    thresholdPence: null,
    pct: 10,
    basis: 'verified',
    requireAllVerified: false,
    cooldownHours: 336,
    enabled: true,
  },
] as const;
/** Core's payload shape (decision 56), in its wire form. */
const payload = (
  pricePence: number,
  provenance: unknown,
  extra: Partial<Record<keyof AlertEventPayload, unknown>> = {},
) => ({
  digestId: 'd1',
  executionId: 'ex-1',
  pricePence,
  provenance,
  previous: null,
  isNew: false,
  route: 'LHR→JFK 14 Mar–28 Mar (14n)',
  verdictClass: 'unchecked',
  unverified: [],
  reason: { kind: 'threshold', gapHours: null },
  staleThresholdHours: 216,
  truncated: false,
  notSeenInLatest: null,
  ...extra,
});
const events = [
  {
    id: 1,
    ruleId: 'r1',
    identityKey: 'r1|x',
    observationId: null,
    calendarPriceId: 5,
    dedupKey: 'r1|x|412',
    firedAt: '2026-10-14T05:12:00.000Z',
    status: 'notified',
    reason: '£412 is at or below the £450 threshold',
    payload: payload(41200, provCalendar, { truncated: true }),
  },
  {
    id: 2,
    ruleId: 'r1',
    identityKey: 'r1|x',
    observationId: null,
    calendarPriceId: 6,
    dedupKey: 'r1|x|412',
    firedAt: '2026-10-21T05:10:00.000Z',
    status: 'suppressed',
    reason: 'same price band alerted 7d (168h) ago; cooldown 2w (336h)',
    payload: payload(41250, provCalendar),
  },
  {
    id: 3,
    ruleId: 'r2',
    identityKey: 'r2|y',
    observationId: 9,
    calendarPriceId: null,
    dedupKey: 'r2|y|412',
    firedAt: '2026-10-21T05:11:00.000Z',
    status: 'queued',
    reason: 'down £56 (11%) from £468 fetched 7d (168h) earlier; not delivered: email: connection refused',
    payload: payload(41200, provSearch, {
      verdictClass: 'partially-verified',
      unverified: ['checkedBagRequired'],
      previous: { pricePence: 46800, provenance: provSearch },
      reason: { kind: 'drop', gapHours: 168 },
      staleThresholdHours: 192,
    }),
  },
  {
    id: 4,
    ruleId: 'other-definition-rule',
    identityKey: 'z',
    observationId: null,
    calendarPriceId: 7,
    dedupKey: 'z|1',
    firedAt: '2026-10-21T05:11:00.000Z',
    status: 'notified',
    reason: 'not this definition',
    payload: payload(100, provCalendar),
  },
];

function withData(r: unknown = rules, e: readonly { ruleId: string }[] = events) {
  server.use(
    http.get(`${API}/alerts`, () => HttpResponse.json(r)),
    // the server filters by definition (alertEventsQuerySchema.definitionId); this handler proves the view asks for it
    http.get(`${API}/alerts/events`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('definitionId') === 'def-1'
          ? e.filter((x) => x.ruleId !== 'other-definition-rule')
          : e,
      ),
    ),
  );
}

describe('Alerts events list (spec §11; decisions 52, 55, 56)', () => {
  it("shows this definition's events: status in words, the trip, the fare through PriceCell, the reason as a quote", async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const [first, second, third] = rows;
    if (first === undefined || second === undefined || third === undefined) throw new Error('rows');
    expect(within(first).getByText(describeRule({ ...rules[0] }))).toBeInTheDocument();
    expect(within(first).getByText('LHR→JFK 14 Mar–28 Mar (14n)')).toBeInTheDocument();
    expect(within(first).getByTestId('price-cell')).toHaveTextContent('£412');
    expect(within(first).getByText(C.classUnchecked)).toBeInTheDocument();
    expect(within(second).getByText(C.status.suppressed)).toBeInTheDocument();
    expect(
      within(second)
        .getByText('same price band alerted 7d (168h) ago; cooldown 2w (336h)')
        .closest('[data-quote]'),
    ).not.toBeNull();
    expect(screen.queryByText('not this definition')).toBeNull();
  });

  it('a partially-verified firing names its unverified constraint and shows the previous price through PriceCell too (review PA-3, PA-4)', async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    const third = within(table).getAllByRole('row')[3];
    if (third === undefined) throw new Error('row');
    expect(within(third).getByText(C.status.queued)).toBeInTheDocument();
    expect(within(third).getByText(C.classPartial(CONSTRAINT_LABELS.checkedBagRequired))).toBeInTheDocument();
    const prices = within(third).getAllByTestId('price-cell');
    expect(prices.map((p) => p.textContent?.match(/£\d+/)?.[0])).toEqual(['£412', '£468']);
  });

  it('a payload of another shape shows "not recorded" and no price', async () => {
    const [sent] = events;
    if (sent === undefined) throw new Error('events');
    withData(rules, [{ ...sent, payload: { label: 'old shape' } }]);
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    expect(within(table).getAllByText(C.notRecorded)).toHaveLength(4);
    expect(within(table).queryByTestId('price-cell')).toBeNull();
  });

  it('empty states', async () => {
    withData([], []);
    renderWithProviders(<AlertsView definitionId="def-1" />);
    expect(await screen.findByText(C.noRules)).toBeInTheDocument();
    expect(await screen.findByText(C.noEvents)).toBeInTheDocument();
  });

  it('no banned word anywhere in the rendered view (spec §11)', async () => {
    withData();
    const { container } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await screen.findByRole('table', { name: C.eventsTable });
    expect(findBannedWords(container.textContent ?? '', BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/AlertsView.test.tsx`. Expected (unverified until WP9/WP10 merge): FAIL with `Unable to find role="table" and name "Alert events"`.

- [ ] **Step 3: Implement.**

`apps/web/src/views/Alerts/EventsTable.tsx`:

```tsx
/**
 * Alert events (spec §11): when, which rule, status in words, the trip, the fare and the previous price each through
 * PriceCell (decisions 52, 56), the constraints in words, and the reason.
 */
import {
  type AlertEvent,
  type AlertEventPayload,
  apiContract,
  CONSTRAINT_LABELS,
  hoursSince,
  type IsoDateTime,
  isStale,
} from '@gmt/core';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatRunInstant } from '../../format.js';
import { useNow } from '../../now.js';

const C = COPY.alertsView;

/** Core's payload schema (decision 56: one schema, no local copy); a payload of another shape parses to null. */
function payloadOf(e: AlertEvent): AlertEventPayload | null {
  const p = apiContract.alertEventPayloadSchema.safeParse(e.payload);
  return p.success ? p.data : null;
}

/** The verdict class in words; "verified" only beside the class-verified value (spec §11). */
function classText(p: AlertEventPayload): string {
  if (p.verdictClass === 'unchecked') return C.classUnchecked;
  if (p.verdictClass === 'verified') return C.classVerified;
  return C.classPartial(p.unverified.map((k) => CONSTRAINT_LABELS[k]).join(', '));
}

function EventRow(props: { e: AlertEvent; ruleText: string; now: IsoDateTime }) {
  const { e, now } = props;
  const p = payloadOf(e);
  const calendar = e.calendarPriceId !== null;
  return (
    <tr>
      <td>
        <time dateTime={e.firedAt}>{formatRunInstant(e.firedAt)}</time>
      </td>
      <td>
        {/* why: decision 55 — a rule's threshold is a price quoted in text, which WP9's sweep allows inside [data-quote] */}
        <span data-quote>{props.ruleText}</span>
      </td>
      <td>{C.status[e.status]}</td>
      <td>{p === null ? C.notRecorded : p.isNew ? `${p.route} · ${C.listedAsNew}` : p.route}</td>
      <td>
        {p === null ? (
          C.notRecorded
        ) : (
          <PriceBoundary>
            <PriceCell
              pricePence={p.pricePence}
              provenance={p.provenance}
              calendar={calendar}
              // why: the stored threshold is re-judged against now by core's isStale (decisions 55, 56; review PA-7)
              stale={isStale(p.provenance, now, p.staleThresholdHours)}
              truncated={p.truncated}
              unconfirmed={p.unverified.includes('priceConfirmed')}
              notSeenInLatestHours={
                p.notSeenInLatest === null
                  ? null
                  : p.notSeenInLatest.at === null
                    ? 'unknown'
                    : hoursSince(p.notSeenInLatest.at, now)
              }
            />
          </PriceBoundary>
        )}
      </td>
      <td>
        {p === null ? (
          C.notRecorded
        ) : p.previous === null ? (
          C.noPrevious
        ) : (
          <PriceBoundary>
            <PriceCell
              pricePence={p.previous.pricePence}
              provenance={p.previous.provenance}
              calendar={calendar}
              stale={isStale(p.previous.provenance, now, p.staleThresholdHours)}
            />
          </PriceBoundary>
        )}
      </td>
      <td>{p === null ? C.notRecorded : classText(p)}</td>
      <td>
        {/* why: decision 55 — spec §6.8 reason text quotes the prices the rule judged; each fare is also a PriceCell */}
        <span data-quote>{e.reason ?? C.noReason}</span>
      </td>
    </tr>
  );
}

export function EventsTable(props: { events: readonly AlertEvent[]; ruleText: ReadonlyMap<string, string> }) {
  const now = useNow();
  if (props.events.length === 0) return <p>{C.noEvents}</p>;
  return (
    <table aria-label={C.eventsTable}>
      <thead>
        <tr>
          <th scope="col">{C.colFired}</th>
          <th scope="col">{C.colRule}</th>
          <th scope="col">{C.colStatus}</th>
          <th scope="col">{C.colTrip}</th>
          <th scope="col">{C.colPrice}</th>
          <th scope="col">{C.colPrevious}</th>
          <th scope="col">{C.colClass}</th>
          <th scope="col">{C.colReason}</th>
        </tr>
      </thead>
      <tbody>
        {props.events.map((e) => (
          <EventRow key={e.id} e={e} ruleText={props.ruleText.get(e.ruleId) ?? e.ruleId} now={now} />
        ))}
      </tbody>
    </table>
  );
}
```

Replace `apps/web/src/views/Alerts/AlertsView.tsx` with:

```tsx
/** Alerts view (spec §11): the rule form, the rules list and the events list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import { COPY } from '../../copy.js';
import { EventsTable } from './EventsTable.js';
import { RuleForm } from './RuleForm.js';
import { describeRule } from './ruleText.js';

const C = COPY.alertsView;
/** The newest events shown (alertEventsQuerySchema allows up to 1000). */
const EVENTS_LIMIT = 200;

export const alertKeys = {
  rules: (id: string) => ['alerts', id] as const,
  events: (id: string) => ['alert-events', id] as const,
};

export function AlertsView(props: { definitionId: string }) {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: alertKeys.rules(props.definitionId),
    queryFn: () => api.alertRules(props.definitionId),
  });
  const events = useQuery({
    queryKey: alertKeys.events(props.definitionId),
    queryFn: () => api.alertEvents(props.definitionId, EVENTS_LIMIT),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: alertKeys.rules(props.definitionId) }),
      qc.invalidateQueries({ queryKey: alertKeys.events(props.definitionId) }),
    ]);
  const create = useMutation({ mutationFn: api.createAlertRule, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: refresh });
  const list = rules.data ?? [];
  const ruleText = new Map(list.map((r) => [r.id, describeRule(r)] as const));

  return (
    <section aria-labelledby="alerts-heading" className="grid gap-6">
      <h2 id="alerts-heading">{C.heading}</h2>
      <p>{C.intro}</p>
      <RuleForm
        definitionId={props.definitionId}
        onSubmit={(b) => create.mutate(b)}
        busy={create.isPending}
      />
      {create.isError ? <p role="alert">{C.notSaved(create.error.message)}</p> : null}
      <div>
        <h3>{C.rulesHeading}</h3>
        <p className="text-sm">{C.deleteKeepsHistory}</p>
        {rules.isLoading ? (
          <p>{COPY.loading}</p>
        ) : list.length === 0 ? (
          <p>{C.noRules}</p>
        ) : (
          <ul>
            {list.map((r) => (
              <li key={r.id} className="flex gap-2">
                {/* why: decision 55 — a rule's threshold is a price quoted in text, which WP9's sweep allows inside [data-quote] */}
                <span data-quote>{ruleText.get(r.id)}</span>
                <button type="button" onClick={() => remove.mutate(r.id)}>
                  {C.deleteRule}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3>{C.eventsHeading}</h3>
        {/* why: the Rule column shows each rule in words, so the table waits for both queries */}
        {rules.isLoading || events.isLoading ? (
          <p>{COPY.loading}</p>
        ) : (
          <EventsTable events={events.data ?? []} ruleText={ruleText} />
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/web test`. Expected (unverified until WP9/WP10 merge): PASS, with the web thresholds (70% lines, 60% branches) met and WP9's guards green.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "wp11: Alerts events list with fare and previous price through PriceCell, verdicts in words, reasons as quotes"`

## 9. Pinned review-focus tests

WP11 owns none of the plan's Review Focus lines. The requirements this package carries, and where each is pinned:

| Requirement | Test |
|---|---|
| §9 item 4: 50 qualifying cells → one email | Task 11.1, "50 qualifying calendar cells…" |
| §6.8: calendar reused rows, other executions and other cabins excluded | Task 11.1 |
| §8.3: subject formats, provenance line, link with host and expiry, POST → app row, coverage caveat; whole digests exactly | Task 11.2; Task 11.9 through nodemailer |
| §5.2, decision 54: booking and search links re-validated at render | Task 11.2 |
| §8.3: every C0/C1 point, U+007F, separators, bidi and zero-width characters, a lone CR; exact subjects with hostile fields | Tasks 11.1 (`text.test.ts`), 11.2, 11.9 |
| §8.3, §11: banned words over rendered email | Tasks 11.2, 11.7 |
| §6.8: verified candidates from the current execution; requireAllVerified; a drop against the newest confirmed price | Task 11.3 |
| Decisions 27, 37, 45: an unconfirmed price never fires and is never a baseline; counted in the digest | Tasks 11.3, 11.7 |
| §6.8: drop window 167/168/169 h; absent-then-present listed as new with its previous price | Task 11.4 |
| §9 item 4: dedup across executions, both bases; cooldown at 335/336/337 h; the max(£10, 5%) step to the penny | Task 11.5 |
| Decisions 56, 59: queued before the send, notified after; a failed send retried on the same row, its reason saying whether a retry will come, and rewritten when the retry succeeds; queued never suppresses | Task 11.5 (and Task 11.0b for the row rewrite) |
| Decision 59: with no SMTP configured a digest's events are suppressed ("email not configured") and start no cooldown | Task 11.5 |
| Decisions 25, 55: a later pass never repeats a firing or a listing | Tasks 11.5, 11.8 |
| §9 item 4: synthetic refused by alerts | Task 11.6; Task 11.8 (layer A) |
| §3 rev 23, decisions 54–56, 58: stale by isStale at the threshold and one hour over, both bases, unknown vendor age by fetch age | Task 11.7 |
| Decisions 30, 36: "cheapest of the rows read" | Task 11.7 |
| §8.1, decision 54: "not seen in latest search", with and without its instant, and its negative case | Task 11.7 |
| Decision 25: alerts on paused_budget; a cap in discovery says "itinerary search not run" | Tasks 11.7, 11.8 |
| Decision 59: the budget-stop lines only after a budget stop, never "at least 0"; no cause named otherwise; the hook names the pass | Tasks 11.1, 11.7 |
| Decision 59: '≈' on a converted previous price in the email | Task 11.7 |
| §8.1: the production engine passes runAlerts and the configured notifiers | Task 11.8 (`engineFor`) |
| §9 item 4: synthetic refused by notifiers | Task 11.9 |
| §5.3, §14: the SMTP password never in a log line or detail; codes-only logging; scrub fallback, logged (decision 59) | Task 11.9 |
| Decision 56: operator messages once per kind per definition per day; the hourly ceiling | Task 11.9 |
| §8.3: SMTP_TLS per mode, hostile hosts refused, timeouts set, no `tls` override | Tasks 11.0, 11.9 |
| §9 item 6, decisions 52, 55, 56: banned words over the Alerts view; every fare and previous price through PriceCell; quotes in `data-quote` | Task 11.11 (plus WP9's catalogue, source guard and rendered sweep) |

## 10. Definition of done

**Now (core, db, engine, api; assembled green):**

- `pnpm --filter @gmt/core test` passes with core's 100% thresholds (`vitest.config.ts`, CI fails below them).
- `pnpm --filter @gmt/db test` passes with db's thresholds (85% lines, 70% branches).
- `pnpm --filter @gmt/engine test` passes with the engine's thresholds (85% lines, 70% branches) and the `src/alerts/**` floor (95% lines, 80% branches), both in `packages/engine/vitest.config.ts` (assembled: 36 files, 470 tests).
- `pnpm --filter @gmt/api test` passes (assembled: 19 files, 197 tests).
- `pnpm -r typecheck` reports no errors; `pnpm lint` reports no diagnostics.
- `pnpm boundaries` exits 0: no `biome-ignore`, `eslint-disable` or `@ts-*` suppression anywhere (decision 49).
- `pnpm casts` reports 0 casts (decisions 45, 48): payloads, configs and nodemailer's JSON are parsed with zod; select values are narrowed by lookup.
- `grep -rn "process.env" packages/engine/src` prints nothing.
- `grep -rnE "\b(LHR|LGW|JFK|EWR|LON|NYC)\b" packages/engine/src` prints nothing (the templates' doc examples use `AAA→BBB`; tests use the worked example).

**After WP9 and WP10 merge (Tasks 11.10, 11.11):**

- `pnpm --filter @gmt/web test` passes with the web thresholds (70% lines, 60% branches); WP9's catalogue, source-guard and rendered-sweep tests and WP10's wiring test stay green; `grep -rn "COPY.source" apps/web/src` prints nothing.
- `grep -rnE "\b(LHR|LGW|JFK|EWR|LON|NYC)\b" apps/web/src/views/Alerts` prints nothing.
- `pnpm -r test` passes.

## 11. Open questions

None requires the operator's judgment. Decisions 55 and 56 settled the round-1 findings marked for judgment and decision 59 the round-2 ones; the coordination items for the plan owner and other briefs are in §13.

## 12. Changes outside WP11's own files

- WP0's core (Task 11.0): `src/types/alerts.ts` (`AlertEventStatus`), `src/api-contract/alerts.ts` (statuses, `alertEventPayloadSchema` with its verdict class from `verdictClassSchema`), `src/config/schema.ts` (`alertEmailMaxPerHour`, `isMailbox`, `smtpPlaintextAllowed`, the base-URL check), `src/index.ts`, `test/config/schema.test.ts` (two test addresses).
- WP3's db (Task 11.0b): migration 0002 and its generated snapshot and journal entry, `src/internal/enums.ts`, `src/repositories/alerts.ts`, `src/repositories/notifications.ts`, and the tests `alerts.test.ts`, `client.test.ts`, `migration0001.test.ts`, `barrel.test.ts`.
- WP7's engine: `src/text.ts` and `src/notifiers/operatorTemplates.ts` (Task 11.1: the one cleaner); `src/types.ts` (`AlertsPass`, the hook's third argument), `src/execute.ts` (passes it) and `test/budget-breach.test.ts` (two assertions name it) (Task 11.1, decision 59); `src/index.ts` (Tasks 11.1, 11.9); `src/notify.ts`, `test/notifications.test.ts` and `vitest.config.ts` (Task 11.9).
- WP4b's api tests: `test/helpers/env.ts` (`ALERT_EMAIL_MAX_PER_HOUR` in `ALL_VARS`) and `test/bootstrap/tool.test.ts` (three migrations) (Task 11.9). WP8's `src/bootstrap/app.ts` (Task 11.8: `engineFor`).
- WP9's and WP10's web (Task 11.10): `src/api/types.ts`, `src/api/endpoints.ts`, `src/copy.ts` (`alertsView`; `source` removed), `src/App.tsx`, `src/views/Placeholder.tsx` (why line), `src/components/Provenance.tsx`, `src/components/PriceCell.tsx`, the Providers view and `src/lib/sources.ts` (`sourceLabel`/`SOURCE_LABELS`), `test/msw/handlers.ts`, `test/guards.ts` (`MONEY_FILES`, the `[data-quote]` sweep selector), `test/copy/catalogue.test.ts`, `test/app/shell.test.tsx`.

## 13. For the plan (not yet recorded there)

1. **Assembly.** On 2026-10-17 the core, db, engine and api parts were assembled on a detached scratch worktree of main at `09ed619` and replayed task by task: each engine task's tests were run first against the previous task's code (the outcomes listed in Step 2 are those runs), then green, with `tsc` and Biome clean after every task. Stand-ins for WP8 (§4 items 1 and 2), in the scratch tree only: core's `isStale` by decision 58's effective age, with a six-case test; the "vendor's cache age unknown" wording in `formatAgeFull`; and `hoursSince` exported from core's barrel (the existing `alerts/dedup.ts` helper, moved to the public list of `test/wp2-barrel.test.ts`). WP8's `bootApp` is not on main, so its one statement was not replayed (Task 11.8 tests `engineFor` instead). Results: `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries` and `pnpm casts` (0 casts) clean; core 776 tests (one of them the stand-in's) and db 280 tests with their thresholds; engine 470 tests with the `src/alerts/**` floor; api 197 tests. The web tasks were linted and cast-checked only.
2. **The calendar stale threshold pick** (`CALENDAR_STALE_AFTER_HOURS`, else the provider's refresh plus its declared age) is one line in this WP's `marks.ts` and one in WP8's `calendarThreshold`; the rule itself is core's `isStale`. A core helper for the threshold would remove the second line; a request to WP8, not a blocker.
3. **"Superseded by a later search"** (decision 54) cannot arise at alert time: calendar candidates are the execution's own fetches, one parent runs per definition, children never discover, and the step runs before the status write. Nothing renders it here.
4. **Unconfirmed prices and requireAllVerified.** Core's `evaluateAlertRules` would admit a partially-verified candidate whose only unverified constraint is `priceConfirmed`; this WP removes such candidates (and never uses one as a drop baseline) before evaluation and states the count as a run fact. If the plan prefers core to own the rule, `eligible()` in `alerts/evaluate.ts` is the place.
5. **Spec wording at the next revision:** §7 and §8.1 say that a digest which reached no email is recorded `suppressed` ("email not configured") and that a queued event is resent only by a later pass of its own execution (decision 59); §8.3's itinerary-search example subject omits the unknown-age clause SearchApi itinerary prices always carry (decision 24); §8.3 names the hidden format characters it strips and the 200-character cut.
6. **The email's results-row link** uses WP9's URL parameters `view=results&def=<id>&basis=<basis>&row=<rowKey>`; the plan's Web section names only `row=`.
7. **`ALERT_EMAIL_MAX_PER_HOUR`** (decision 56, default 20) is new: spec §12's environment listing, WP12's `.env.example` and setup docs, and the api's config-variable list (done here) carry it.
8. **A real SMTP conversation was not added (review TS-8).** The package's network guard refuses every DNS lookup, and nodemailer looks up even an IP literal, so a loopback SMTP stand-in cannot be reached from the engine's tests without loosening the guard. The fail-closed STARTTLS behaviour rests on nodemailer's `requireTLS`, whose mapping is asserted per mode; `buildNotifiers` is asserted to open no socket. WP13's smoke could exercise a real conversation against Mailpit.
9. **The SMTP user** is an account name, not a secret: it may appear in an event's failure reason (stored and shown in the Alerts view); the password never does, and the log holds codes only.
