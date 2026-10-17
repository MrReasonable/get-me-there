---
wp: 11
title: alerts runner, digest templates, EmailNotifier, Alerts UI
owner: sonnet
depends_on: [7, 8, 10]
spec_sections: ["§3 (effective age, rev 23)", "§5.2", "§5.3", "§5.5", "§6.2", "§6.8", "§8.1", "§8.3", "§11", "§12 (APP_BASE_URL)", "§14", "§9 item 4", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, product-owner, persona-flexible-traveller, security-reviewer]
status: draft
---

# WP11: alerts runner, digest templates, EmailNotifier, Alerts UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task: failing test, run, minimal code, run, commit. Steps use `- [ ]` checkboxes. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, revision 24: §3, §5.5, §6.8, §8.1, §8.3, §11, §12, §14) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`: "Global Constraints", the Notifier, Alert types, Database, Core domain functions, Engine and Web contracts, and decisions 1–54, especially 10, 14, 21, 24, 25, 27, 30, 36, 37, 44–49, 52, 54) before Task 11.1. Refreshed on 2026-10-17 against main at `bd56eb4` (WP0–WP7 merged). Every engine and api code block below was assembled on a scratch worktree of main and run green, task by task (§13 item 1 says what stood in for WP8's bootstrap); the web tasks follow the reviewed WP9 and WP10 briefs, which are not on main yet.

## 1. Goal

Turn the prices an execution wrote into at most one plain-text email per alert rule per pass, deduplicated across executions, never built from synthetic rows or unconfirmed prices, every price labelled with its source, age and marks; and give the operator an Alerts view to manage rules and read what fired, what was suppressed, and why.

## 2. Scope

**In**

- `packages/engine/src/alerts/runner.ts`: `runAlerts`, the `AlertsStepHook` WP7's engine calls at the §8.1 alerts step, after a pass that completed or paused for a budget cap (decision 25). It does the engine side of spec §6.8:
  - gathers candidates per basis from the current execution, refusing synthetic rows and leaving out prices the final step did not confirm;
  - looks up previous prices for drops and sent firings for the cooldown, and skips rows an earlier pass of the same execution already recorded;
  - builds one structured digest per rule with core's `buildDigest`, renders it, sends it to every notifier, and persists `alert_events` (sent, failed or suppressed) whose payload carries the price, its provenance and its marks;
  - reads the marks `DigestItem` does not carry: stale by effective age, "cheapest of the rows read", "not seen in latest search", the budget-stop count and the unconfirmed count.
- `packages/engine/src/alerts/templates.ts`: `renderSubject` and `renderBody` in the spec §8.3 formats, plus `stripControl`, `controlFree`, `sourceLabel`, `routeLine`, `cellLine`, `appRowLink` and the `ItemMarks` type.
- `packages/engine/src/notifiers/email.ts`: `EmailNotifier` over nodemailer 10, `smtpTransportOptions`.
- `packages/engine/src/notifiers/index.ts`: `buildNotifiers`.
- WP8's `apps/api/src/bootstrap/app.ts`: the one `createEngine` statement in `bootApp` (Tasks 11.8 and 11.9).
- `apps/web/src/views/Alerts/*`: the rule form, the rules list and the events table, with the alert wrappers in WP9's `api`, an `alertsView` block in `copy.ts`, the `App.tsx` mount and the guard, catalogue, handler and shell-test entries they need (§12).

**Out**

- `@gmt/core` (WP0, WP2, merged): `evaluateAlertRules` (eligibility, identity settling, the `isNew` rule, the cooldown and its reasons), `identityKey`, `dedupKey`, `buildDigest`, `evaluateConstraints`, `verdictClass`, `unverifiedNames`, `searchLinkFor`, `resultRowKey`, `validateVendorUrl`, `effectiveAge`, `formatAgeFull`, `worstCaseAgeHours`, `stripControlChars`, `isTruncated`, `formatPence`, `CONSTRAINT_LABELS`, the alert schemas, the `Notifier` port and the alert types. This WP changes no core file.
- `@gmt/db` (WP3, merged): every repository method this WP calls. This WP adds no SQL, no column and no migration.
- `@gmt/engine` (WP7, merged): `createEngine(deps, { alerts })`, `noAlerts`, when the alerts step runs and how a rejecting hook is treated (`execute.ts`), `LogNotifier` and `containsSynthetic` (`notifiers/log.ts`), `renderOperatorMessage`, the "alerts running on calendar basis only" notice, and the layer-A harness (`test/support/harness.ts`).
- `apps/api` (WP8): the `/api/alerts` routes and the rest of `bootApp`.
- `apps/web` (WP9, WP10): the shell, navigation, `call`, `PriceCell`, `PriceBoundary`, `format.ts`, the copy catalogue and its guards, `renderWithProviders`, the msw server and fixtures.
- WP12: Mailpit and compose.

## 3. Spec sections and plan decisions

- **§6.8 Alert evaluation.**
  - The rule shape, with `cooldownHours` defaulting to 336; `requireAllVerified` on the verified basis only.
  - **Itinerary-search (verified) basis.** Identity `(ruleId, itineraryHash)`. Candidates are the observations written by the current execution in the definition's cabin, verdicts recomputed against the current definition (§6.2); `partially-verified` counts only when `requireAllVerified` is false. A drop compares an offer's observation with its previous one.
  - **Calendar basis.** Identity `(ruleId, providerId, cabin, cellKey)`. Candidates are the calendar prices fetched by the current execution in the definition's cabin; reused rows are excluded. A drop compares only with a previous price fetched within 2 × `discoveryRefreshHours` (167, 168 and 169 h tested); an absent-then-present price, or one whose previous price is older, is listed in the "new" section and is never a drop firing; absolute rules still apply to it. The body shows the previous price and the gap between the fetches.
  - Suppression: the same `dedupKey` within `cooldownHours`, or the same identity within it at a price not at least max(£10, 5%) lower; suppressed firings are recorded with status `suppressed` and their reason. Synthetic rows are refused. One digest per rule per execution, the top 10 and a count of the rest.
- **§3 (rev 23), §8.1; decisions 44, 54.** Effective age: the observed age, else the fetch age plus a known `maxAgeHours`, else the fetch age alone. A price is stale when its effective age exceeds the basis threshold (`STALE_AFTER_HOURS`; for the calendar basis `CALENDAR_STALE_AFTER_HOURS`, else the provider's refresh plus its declared age). An unknown vendor age is labelled "vendor's cache age unknown" and never stale on that account.
- **§6.2, §3 (rev 21, 22); decisions 27, 37, 45.** An offer whose price the final step did not confirm is classed `unverified` ("price not confirmed by the final step"). This WP never alerts on one, labels one wherever it would render, and counts the ones it left out in the digest.
- **Decisions 30, 36, 47.** A price from a discovery tile the page cap cut short carries "cheapest of the rows read" (`isTruncated` over the outcome's `last_error`).
- **§8.1; decision 54.** "Not seen in latest search" marks a verified-basis fare whose cell a newer itinerary search priced without it; "superseded by a later search" marks a calendar price whose cell a newer parent execution found empty. Both are rendered where the read model carries them (§13 item 4 says why only the first can arise at alert time).
- **§8.1; decision 25.** The alerts step runs after a pass that completed and after one that paused for a budget cap, over what the execution has written, before the status write; a later pass of the same execution never repeats a recorded firing. The digest says how many cell searches a budget cap left undone.
- **§8.3 Notifications.** `EmailNotifier` maps `SMTP_TLS`: `implicit` → TLS from connect, `starttls` → `requireTLS`, `none` only for dev Mailpit or a loopback host. Plain text only. Two subject formats. Body: segments (or "calendar price, no itinerary"), verdicts naming every unverified constraint, a provenance line with the effective age, a validated `https` link with its host and expiry state (for a POST booking, a link to the app's results row), the coverage caveat "itinerary-searched K of N cells, E outbounds each", the rule. Provider strings are CRLF/control-stripped (`stripControlChars(s, ' ')`, decision 21). Synthetic refused. The banned-word test runs over rendered output.
- **§5.2, §5.3; decisions 10, 54.** Validated booking and search links keep their query in email; a booking link is re-validated at render against `LINK_ALLOWLIST`. Every other URL sink is stripped (the event reason and the email error detail).
- **§11; decisions 36, 44, 46, 49, 52.** The Alerts view: rule form (type, threshold or percentage, basis, `requireAllVerified` on the itinerary-search basis only, cooldown default 336) and an events list with status and reason. Vocabulary: "Google Flights via SearchApi", "Google date grid via SearchApi", "Aviasales cache", "itinerary-search basis"; "verified" only beside class-verified values. Every fare goes through `PriceCell`; run times render in Europe/London; no cast (`pnpm casts`) and no suppression comment (`pnpm boundaries`) anywhere.
- **§12.** `APP_BASE_URL` makes the results-row link absolute; unset, the link is a relative path.
- **§14.** Engine log lines carry `executionId` and `definitionId`; no secret and no full URL reaches a log line.
- **§9 item 4:** alert dedup across executions on both bases, digests, synthetic rows refused by alerts and notifiers. **§9 item 6:** the banned-word test covers the rendered email and the Alerts view.
- **§1, Global Constraints:** route-agnostic: no airport, city or country in engine or web source; tests use the worked example (London → New York) only.

## 4. Interfaces consumed

Copied from the merged code on main (`bd56eb4`); where the plan's contract text differs, the code is quoted and §13 says so.

```ts
// @gmt/core — ports/notifier.ts (WP0, as merged after decision 21)
export interface DigestItem { pricePence: number; provenance: Provenance; cell: Cell; verdictClass: VerdictClass | 'unchecked'; itineraryHash: string | null; seller: string | null; unverified: ConstraintName[]; previousPricePence: number | null; fetchGapHours: number | null /* whole hours between the previous fetch and this one, never an age */; isNew: boolean; firingReason: string; booking: Booking; bookingExpiresAt: IsoDateTime | null; outbound: Segment[] | null; inbound: Segment[] | null; searchLink: { url: string; host: string; label: string } | null /* null for synthetic rows */; rowKey: string /* resultRowKey */ }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number; newItems: DigestItem[]; newRestCount: number; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }
export interface OperatorMessage { kind: OperatorMessageKind; executionId: string | null; definitionId: string; subject: string; body: string }
export interface Notifier { id: string; send(msg: { kind: 'digest'; digest: AlertDigest; subject: string; body: string } | { kind: 'operator'; message: OperatorMessage }): Promise<{ ok: boolean; detail?: string }> }

// @gmt/core — types/alerts.ts (WP0)
export interface AlertRule { id: string; definitionId: string; type: 'absolute' | 'dropPct' | 'dropAbs'; thresholdPence: number | null; pct: number | null; basis: ResultBasis; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export type AlertRuleInput = Omit<AlertRule, 'id'>;
export interface AlertEvent { id: number; ruleId: string; identityKey: string; observationId: number | null; calendarPriceId: number | null; dedupKey: string; firedAt: IsoDateTime; status: 'sent' | 'failed' | 'suppressed'; reason: string | null; payload: unknown }
export type VerifiedCandidate = { basis: 'verified'; observation: Observation; itinerary: NormalisedItinerary; verdictClass: VerdictClass; unverified: ConstraintName[]; seller: string; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type CalendarCandidate = { basis: 'calendar'; calendarPriceId: number; fetchedByExecutionId: string; cell: Cell; pricePence: number; provenance: Provenance; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface Firing { rule: AlertRule; candidate: AlertCandidate; identityKey: string; dedupKey: string; reason: string; isNew: boolean; suppressed: { reason: string } | null }
export interface PriorFiring { identityKey: string; dedupKey: string; firedAt: IsoDateTime; pricePence: number }

// @gmt/core — alerts/ (WP2)
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;
export interface AlertEvalContext { now: IsoDateTime; executionId: string; cabin: Cabin; discoveryRefreshHours: Partial<Record<ProviderId, number>> }
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], prior: PriorFiring[], ctx: AlertEvalContext): Firing[];
//   refuses synthetic and other-execution candidates; settles each identity on its cheapest eligible candidate; absolute
//   firings are never isNew; a drop rule's candidate with no previous price, or one fetched outside 2 × refresh (whole
//   minutes), is isNew with a reason and never suppressed; reasons: "£412 is at or below the £450 threshold",
//   "down £80 (16%) from £500 fetched 7d (168h) earlier", "same price band alerted 7d (168h) ago; cooldown 2w (336h)".
export function identityKey(rule: AlertRule, c: AlertCandidate): string;
export function buildDigest(rule: AlertRule, firings: Firing[], ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] }): AlertDigest | null;
//   drops suppressed firings; isNew firings go to newItems; null when no other firing remains; throws on synthetic
//   provenance; calendar items carry booking { kind: 'none' }; previousPricePence is set only when the reason states it.

// @gmt/core — labels, text, results, constraints, normalise, ids (WP0–WP2)
export type EffectiveAge = { kind: 'observed'; fetchedHours: number; observedHours: number } | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number } | { kind: 'unknown'; fetchedHours: number };
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown';
export function formatAgeFull(a: EffectiveAge): string;   // "fetched 2h ago · provider age unknown (≤7d before that)"; bounded 0 → "fetched 5h ago"; unknown → "fetched 5h ago · provider age unknown"
export function formatDuration(hours: number): string;    // "just now", "5h", "3d", "2w"
export const TRUNCATED_NOTE = 'cheapest of the rows read'; export function isTruncated(reason: string | null): boolean;
export function stripControlChars(s: string, replacement = ''): string;   // the Unicode Cc set, code-point scan; U+2028/U+2029 left to the caller
export function stripUrlsInText(text: string): string;
export function formatPence(pence: number): string;   // '£412', '£20.50'
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // ConstraintName = keyof Constraints | 'cabin' | 'priceConfirmed'; priceConfirmed → 'price not confirmed by the final step'
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;   // itineraryHash, or `calendar:${calendarPriceId}`
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking;
export function evaluateConstraints(it: NormalisedItinerary, obs: ObservationFields & { segmentCabins: Cabin[] | null }, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts;   // sets priceConfirmed 'unverified' when 'price' is not supplied
export function verdictClass(v: Verdicts): VerdictClass; export function unverifiedNames(v: Verdicts): ConstraintName[];
export function cellKeyString(c: CellKey): string; export function daysBetween(a: IsoDate, b: IsoDate): number; export function addDays(d: IsoDate, n: number): IsoDate;
export function isoDateTimeOfEpochMs(ms: number): IsoDateTime; export function asIsoDateTime(s: string): IsoDateTime; export function asIsoDate(s: string): IsoDate; export function asIata(s: string): Iata;
export function itineraryHash(outbound: Segment[], inbound: Segment[]): string;
export function parseConfig(env: Record<string, string | undefined>, opts: { realpath: (p: string) => string }): { ok: true; config: Config } | { ok: false; errors: Array<{ field: string; message: string }> };
export const provenanceSchema: z.ZodType<Provenance>;
export const BANNED_WORD_ALLOWLIST: readonly string[]; export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export class Secret { constructor(value: string); reveal(): string }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
// Config (fields read here): nodeEnv; appBaseUrl: string | null; staleAfterHours: number; calendarStaleAfterHours: number | null;
//   smtp: { host; port; tls: 'implicit' | 'starttls' | 'none'; user; pass: Secret; to; from } | null
// apiContract (web): alertRuleSchema, alertRuleInputSchema, alertEventSchema; ROUTES: GET /api/alerts (?definitionId) → alertRuleSchema.array(),
//   POST /api/alerts → alertRuleSchema, DELETE /api/alerts/:id → alertRuleSchema, GET /api/alerts/events (?ruleId, ?definitionId, ?limit ≤ 1000) → alertEventSchema.array()

// @gmt/db (WP3)
export function openDatabase(path: string): Db; export function applyMigrations(db: Db, dir: string): { applied: string[] }; export const MIGRATIONS_DIR: string;
export function createRepos(db: Db, clock: Clock, opts: { allowSynthetic: boolean }): Repos;
// Db.transaction<T>(fn: () => T): T (synchronous only)
// ExecutionsRepo: create(input: ExecutionCreateInput): Execution; get(id): Execution | null; activeParent(definitionId): Execution | null; setStatus(id, status, patch?: ExecutionPatch): void
// DefinitionsRepo: create(input: DefinitionInput & { confirmedCostPence?: number }): SearchDefinition; get(id): SearchDefinition | null (soft-deleted rows included, with deletedAt); softDelete(id): void
// AlertsRepo: rules(definitionId?): AlertRule[] (live rules); create(input: AlertRuleInput): AlertRule;
//   events(filter: { ruleId?: string; definitionId?: string; limit: number }): AlertEvent[] (newest first);
//   priorFirings(ruleId, identityKeys: string[], since: IsoDateTime): PriorFiring[] (sent events only); insertEvent(e: Omit<AlertEvent, 'id'>): number (URLs in reason and payload stripped)
// CalendarPricesRepo: insert(executionId, rows: CalendarPriceInsert[]): number[]; fetchedBy(executionId): CalendarPriceRow[] (reused excluded);
//   previousFor(definitionId, providerId, cabin, cell: CellKey, before: IsoDateTime, notOlderThan: IsoDateTime): CalendarPriceRow | null;
//   reuseCandidates(definitionId, providerId, cabin, pointOfSale, sourceKind, cells: CellKey[], newerThan: IsoDateTime): ReusedCopy[]
// CellsRepo: seed(executionId, cells: Cell[], discoveryProviders: ProviderId[]); seedVerification(executionId, selected, allCells, verificationProviders);
//   outcomes(executionId, filter?: { stage?; providerId?; cells? }): CellOutcome[]; selected(executionId): Array<{ cell; reason }>;
//   setOutcome(executionId, cell, stage, providerId, patch) (not_run / error / skipped only); writeTile(executionId, providerId, w: TileWrite);
//   writeVerifiedCell(executionId, providerId, w: VerifiedCellWrite); copyReused(executionId, providerId, copies: ReusedCopy[], criteria: ReuseCriteria)
// ItinerariesRepo: upsertItinerary(it); recordObservation(offer: Offer, obs: Omit<Observation, 'id' | 'offerId'>): { offerId; observationId };
//   writtenBy(executionId): ObservationRow[]; previousObservation(offerId, before: IsoDateTime): Observation | null;
//   latestVerificationOutcomeForCell(definitionId, cell: CellKey, cabin: Cabin): CellOutcome | null (newest priced|empty)
// ObservationRow extends Observation { offer: Offer & { id: number }; itinerary: NormalisedItinerary; cell: Cell; seller: string }
// CalendarPriceRow extends CalendarPriceInsert { id: number; executionId: string; provenance: Provenance }

// @gmt/providers (WP4)
export function scrubSecrets<T>(value: T, secrets: readonly Secret[]): T;   // throws if a secret survives

// @gmt/engine (WP7, as merged)
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export type AlertsStepHook = (deps: EngineDeps, executionId: string) => Promise<{ digests: number; events: number }>;
export interface EngineOptions { alerts?: AlertsStepHook; providerConcurrency?: Partial<Record<ProviderId, number>> }
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;
export class LogNotifier implements Notifier { readonly id = 'log'; constructor(log: Logger) }
// src/notifiers/log.ts (package-internal): export function containsSynthetic(value: unknown): boolean
// src/execute.ts: alertsStep runs the hook when run.stop is null (completed) or a budget stop (paused_budget), before the
//   status write; a rejecting hook is logged ('alerts: step failed') and the pass still finishes. Children run it too.
// test/support/harness.ts: createHarness(opts?: HarnessOptions): Harness with deps, options, repos, logs (LogLine { level; bindings; fields; msg }),
//   digests: unknown[], notifications, createDefinition(patch?), orch(options?), runToCompletion(engine, definitionId, opts?),
//   onStageStart(stage, fn), spendLedger(p); withVerification(): ProvidersConfig; FIXTURE_COST_MICRO_GBP
```

**Code that later waves deliver, and what this brief assumes of it** (checked again when wave 7 opens):

1. **WP8 `bootApp`** (`apps/api/src/bootstrap/app.ts`) builds the engine with the statement `const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });` and its why line "WP11 adds `{ alerts: runAlerts }` to these options". Tasks 11.8 and 11.9 replace exactly that statement.
2. **WP9's web** (as WP10 leaves it): `call(schema, method, path, opts?)` checking the schema against `ROUTES`; `api` in `src/api/endpoints.ts` (`import { apiContract as c } from '@gmt/core'`); `src/api/types.ts` request bodies as `z.input`; `COPY` with `loading` and `fieldError(field, message)`; `format.ts` re-exporting `formatPence`, plus `parsePoundsToPence` and WP10's `formatRunInstant`; `PriceCell` (`pricePence`, `provenance: unknown`, `calendar`, `stale`, `truncated?`, `notSeenInLatestHours?`, root `data-testid="price-cell"`) inside `PriceBoundary`; `test/guards.ts` `MONEY_FILES`; `test/copy/catalogue.test.ts` `SAMPLES` and the "verified" `allowed` set; `test/msw/handlers.ts` `url()` and `handlers`; `test/fixtures.ts` `API`, `provSearch`, `provCalendar`; `test/render.tsx` `renderWithProviders(ui, opts?)` returning `user`; `App.tsx`'s `needsDefinition`, `selected` and `{view === 'alerts' ? <Placeholder /> : null}`; `test/app/shell.test.tsx`'s alerts placeholder test.

## 5. Interfaces produced

```ts
// packages/engine/src/alerts/runner.ts
export type AlertRunnerDeps = Pick<EngineDeps, 'config' | 'db' | 'repos' | 'providers' | 'notifiers' | 'clock' | 'log'>;
export interface AlertRunResult { digests: number; events: number }
export async function runAlerts(deps: AlertRunnerDeps, executionId: string): Promise<AlertRunResult>;   // assignable to AlertsStepHook; never rejects
// alert_events.payload written by runAlerts (the Alerts view reads it):
//   { digestId: string | null; executionId: string; pricePence: number; provenance: Provenance; previousPence: number | null; isNew: boolean;
//     route: string /* "LHR→JFK 14 Mar–28 Mar (14n)" */; stale: boolean; truncated: boolean; notSeenInLatestHours: number | null }

// packages/engine/src/alerts/templates.ts
export interface ItemMarks { stale: { thresholdHours: number } | null; truncated: boolean; notSeenInLatest: { ageHours: number } | null }
export const NO_MARKS: ItemMarks;
export interface DigestRenderInput { digest: AlertDigest; definitionName: string; appBaseUrl: string | null; now: IsoDateTime; marks: ReadonlyMap<string, ItemMarks> /* by DigestItem.rowKey */; budgetUnsearched: number; unconfirmedLeftOut: number }
export function controlFree(s: string): string;   // controls and U+2028/U+2029 → space, no trim
export function stripControl(s: string): string;  // controlFree, runs collapsed, trimmed
export function sourceLabel(p: Pick<Provenance, 'providerId' | 'sourceKind'>): string;   // throws on synthetic
export function cellLine(cell: Cell): string;     // "LHR→JFK 14 Mar–28 Mar (14n)"
export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string;   // "£412 LHR→JFK …", "≈" when converted
export function renderSubject(item: DigestItem, now: IsoDateTime): string;
export function renderBody(input: DigestRenderInput): string;
export function appRowLink(appBaseUrl: string | null, definitionId: string, basis: ResultBasis, rowKey: string): string;   // `${base}/?view=results&def=<id>&basis=<basis>&row=<rowKey>`

// packages/engine/src/notifiers/email.ts
export type SmtpConfig = NonNullable<Config['smtp']>;
export interface SmtpTransportOptions { host: string; port: number; secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean; auth: { user: string; pass: string } }
export interface MailMessage { from: string; to: string; subject: string; text: string }
export interface MailTransport { sendMail(m: MailMessage): Promise<{ messageId: string }> }
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions;
export class EmailNotifier implements Notifier { readonly id = 'email'; constructor(opts: { smtp: SmtpConfig; nodeEnv: Config['nodeEnv']; log: Logger; createTransport?: TransportFactory }) }

// packages/engine/src/notifiers/index.ts
export function buildNotifiers(config: Pick<Config, 'smtp' | 'nodeEnv'>, log: Logger): Notifier[];   // [LogNotifier, EmailNotifier?]

// apps/web/src/views/Alerts/index.ts
export function AlertsView(props: { definitionId: string }): JSX.Element;
export function describeRule(r: AlertRule): string;
// apps/web/src/api/endpoints.ts: api.alertRules(definitionId), api.createAlertRule(body), api.deleteAlertRule(id), api.alertEvents(definitionId, limit)
// apps/web/src/api/types.ts: AlertRuleBody = z.input<typeof apiContract.alertRuleInputSchema>
// apps/web/src/copy.ts: COPY.alertsView
```

`packages/engine/src/index.ts` re-exports every engine symbol above except `controlFree` and `cellLine`, which only the engine uses.

## 6. Library notes

- **nodemailer 10.1.1** with **@types/nodemailer 8.0.2** (both already in `packages/engine/package.json` from WP0). Verified with context7 (`/nodemailer/nodemailer-homepage`, `docs/smtp/index.md`, `docs/transports/stream.md`) on 2026-10-14; the types below were re-read from the installed `@types/nodemailer` on 2026-10-17 (no network).
  - `nodemailer.createTransport({ host, port, secure, requireTLS, ignoreTLS, auth: { user, pass } })`: `secure: true` is TLS from connect (implicit, port 465); `secure: false` upgrades with STARTTLS when offered; `requireTLS: true` makes the upgrade mandatory; `ignoreTLS: true` never attempts it. This WP always sets `secure`. Creating a transporter opens no connection.
  - `sendMail({ from, to, subject, text })` resolves `info` with `messageId`.
  - **Test transport: `createTransport({ jsonTransport: true })`**, its own transport type. `info.envelope` is `MimeNode.Envelope` `{ from: string | false; to: string[] }`; `info.message` is a JSON string of the message (`subject`, `text`, and `html` only when given). The tests parse it with zod rather than cast it.
  - **Types.** The brief declares its own `SmtpTransportOptions` and `MailTransport`: deep `@types` subpaths are fragile under `NodeNext`, and nodemailer's `Transporter` is structurally assignable to `MailTransport`.
  - **Mailpit** sees AUTH over plain SMTP because the `SMTP_*` settings are all or nothing; WP12 configures it to accept that.
- **zod 4.6.7** (engine and web dependencies): `z.object`, `.parse`, `.safeParse`, `.nullable()`; core's `provenanceSchema` inside a test schema.
- **msw 3.0.3**, **@testing-library/react 16.3.3**, **@testing-library/user-event 14.6.8**, **jest-dom 7.0.1**, **react 19.3.1**, **@tanstack/react-query 5.104.2**: as WP9's brief verified them (`http.get/post/delete`, `HttpResponse.json`, `server.use`; `screen`, `within`, `waitFor`; `user.selectOptions/clear/type/click`; `toBeDisabled`, `toHaveValue`; `useQuery`, `useMutation`, `invalidateQueries`).
- **vitest 5.0.4**: `vi.fn<T>(impl)`. Per-task runs use `pnpm --filter <pkg> exec vitest run <file>` (no coverage threshold on a partial run, decision 8).

## 7. Files

- **Create (engine source):** `packages/engine/src/alerts/runner.ts`, `packages/engine/src/alerts/templates.ts`, `packages/engine/src/notifiers/email.ts`, `packages/engine/src/notifiers/index.ts`.
- **Create (engine tests):** `packages/engine/test/alerts/fixtures.ts`, `builders.ts`, `runner.digest.test.ts`, `templates.test.ts`, `runner.verified.test.ts`, `runner.calendar.test.ts`, `runner.dedup.test.ts`, `runner.refusals.test.ts`, `runner.marks.test.ts`, `templates.marks.test.ts`, `engine.alerts.test.ts`; `packages/engine/test/notifiers/email.test.ts`.
- **Create (web):** `apps/web/src/views/Alerts/RuleForm.tsx`, `ruleText.ts`, `AlertsView.tsx`, `EventsTable.tsx`, `index.ts`; tests `apps/web/test/views/Alerts/RuleForm.test.tsx`, `AlertsView.test.tsx`.
- **Modify:** `packages/engine/src/index.ts`; WP8's `apps/api/src/bootstrap/app.ts` (one statement); WP9's `apps/web/src/api/types.ts`, `src/api/endpoints.ts`, `src/copy.ts`, `src/App.tsx`, `test/msw/handlers.ts`, `test/guards.ts`, `test/copy/catalogue.test.ts`, `test/app/shell.test.tsx`.

## 8. Tasks

Commands run from the repository root. Every commit message ends with the repository's attribution line. Test counts are per file unless a directory is named.
### Task 11.1: 50 qualifying cells → one digest (first failing test)

**Files:**
- Create `packages/engine/test/alerts/fixtures.ts` (the database fixtures every runner task uses) and `packages/engine/test/alerts/runner.digest.test.ts`.
- Create `packages/engine/src/alerts/templates.ts` (the calendar half) and `packages/engine/src/alerts/runner.ts` (the calendar pool, the coverage caveat, delivery and events).
- Modify `packages/engine/src/index.ts`.

**Interfaces:**
- **Consumes:** `evaluateAlertRules`, `buildDigest`, `CalendarPricesRepo.fetchedBy`, `CellsRepo.selected/outcomes`, `AlertsRepo.rules/insertEvent`, `Notifier`, `formatAgeFull`, `effectiveAge`, `stripControlChars`.
- **Produces:** `runAlerts`, `AlertRunnerDeps`, `AlertRunResult`, the calendar half of the templates.

- [ ] **Step 1: Write the failing test.** Start with the shared fixtures, which are test-only. Every row they write is of a real provider kind, because alerts refuse synthetic rows (Task 11.6 proves that with `providerId: 'fixture'`). Configuration goes through core's own `parseConfig`, so no `Config` is hand-built or cast; rows go through the real repositories (`insert`, `writeTile`, `writeVerifiedCell`, `copyReused`), so every invariant WP3 enforces holds in the tests too.

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
  type AlertRule,
  addDays,
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
  provenanceSchema,
  type SearchDefinition,
  type Segment,
  type SuppliedField,
} from '@gmt/core';
import { applyMigrations, createRepos, type Db, MIGRATIONS_DIR, openDatabase, type Repos } from '@gmt/db';
import { z } from 'zod';
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
  readonly #result: { ok: boolean; detail?: string };
  constructor(id = 'recording', result: { ok: boolean; detail?: string } = { ok: true }) {
    this.id = id;
    this.#result = result;
  }
  async send(msg: NotifierMessage): Promise<{ ok: boolean; detail?: string }> {
    this.sent.push(msg);
    return this.#result;
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
        maxAgeHours: 'unknown',
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

/** The runner's payload on an event row (WP11 runner), parsed rather than cast. */
export const payloadSchema = z.object({
  digestId: z.string().nullable(),
  executionId: z.string(),
  pricePence: z.number().int(),
  provenance: provenanceSchema,
  previousPence: z.number().int().nullable(),
  isNew: z.boolean(),
  route: z.string(),
});
export function payloadOf(e: { payload: unknown }): z.output<typeof payloadSchema> {
  return payloadSchema.parse(e.payload);
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
  it('50 qualifying calendar cells under one absolute rule → one digest, top 10 + 40 more, 50 sent events sharing a digest id', async () => {
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
    expect(new Set(events.map((e) => e.status))).toEqual(new Set(['sent']));
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

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts`. Expected: FAIL, because `../../src/alerts/runner.js` cannot be resolved.

- [ ] **Step 3: Implement.** This step writes the calendar half of the templates; Task 11.2 adds the itinerary-search lines and Task 11.7 the marks.

`packages/engine/src/alerts/templates.ts`:

```ts
/**
 * Plain-text alert email (spec §8.3). Core's buildDigest decides what is in a digest; this module decides the words.
 * Every provider-supplied string passes stripControl before it is written.
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
  type Provenance,
  type ResultBasis,
  stripControlChars,
} from '@gmt/core';

/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). */
export interface DigestRenderInput {
  digest: AlertDigest;
  definitionName: string;
  appBaseUrl: string | null;
  now: IsoDateTime;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Every control character (core's stripControlChars, the Unicode Cc set) and the Unicode line and paragraph
 * separators replaced by a space, one for one. No trimming, so a body line keeps its indentation.
 */
export function controlFree(s: string): string {
  // why: U+2028 and U+2029 are not controls, so core leaves them (text/control.ts), but a mail client may break a
  // line on them; split/join keeps the code free of a regex over invisible characters.
  return stripControlChars(s, ' ').split('\u2028').join(' ').split('\u2029').join(' ');
}

/**
 * One line of provider-supplied text: control-free, runs of spaces collapsed, trimmed. Spec §8.3: provider strings
 * are CRLF/control-stripped, so none can start a header or a line. URLs are left whole: validated links keep their
 * query in email (decision 10).
 */
export function stripControl(s: string): string {
  return controlFree(s).replace(/ {2,}/g, ' ').trim();
}

/** Source in words (spec §11 vocabulary). Synthetic rows have no label and throw. */
export function sourceLabel(p: Pick<Provenance, 'providerId' | 'sourceKind'>): string {
  if (p.providerId === 'searchapi' && p.sourceKind === 'scraped-search')
    return 'Google Flights via SearchApi';
  if (p.providerId === 'searchapi' && p.sourceKind === 'scraped-aggregate')
    return 'Google date grid via SearchApi';
  if (p.providerId === 'travelpayouts' && p.sourceKind === 'authorised-cached') return 'Aviasales cache';
  throw new Error(
    `templates: no source label for ${p.providerId}/${p.sourceKind}; synthetic rows are refused (spec §5.5)`,
  );
}

/** "14 Mar" from a calendar date or local date-time string; never through Date (spec §6.1). */
function day(d: string): string {
  const [, m, dd] = d.slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/** "AAA→BBB 14 Mar–28 Mar (14n)": the cell in words, without a price (the Alerts view's route column). */
export function cellLine(cell: DigestItem['cell']): string {
  return `${cell.origin}→${cell.destination} ${day(cell.departureDate)}–${day(cell.returnDate)} (${cell.nights}n)`;
}

/** "£412 AAA→BBB 14 Mar–28 Mar (14n)", with "≈" when FX-converted (spec §11). */
export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string {
  return `${item.provenance.fx.converted ? '≈' : ''}${formatPence(item.pricePence)} ${cellLine(item.cell)}`;
}

/** The age in core's full form (spec §3): "fetched 5h ago · provider age unknown (≤7d before that)". */
function ageLine(p: Provenance, now: IsoDateTime): string {
  return formatAgeFull(effectiveAge(p, now));
}

function verdictSegment(item: DigestItem): string {
  if (item.verdictClass === 'unchecked') return 'constraints not checked';
  if (item.verdictClass === 'verified') return 'class verified';
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
 * The app URL of a results row with WP9's parameters (`view`, `def`, `basis`, `row`): absolute under APP_BASE_URL,
 * else a relative path (spec §12).
 */
export function appRowLink(
  appBaseUrl: string | null,
  definitionId: string,
  basis: ResultBasis,
  rowKey: string,
): string {
  const base = (appBaseUrl ?? '').replace(/\/+$/, '');
  const q = new URLSearchParams({ view: 'results', def: definitionId, basis, row: rowKey });
  return `${base}/?${q.toString()}`;
}

/** Core's labelled search link; spec §5.3 keeps its query in email. Null only for synthetic rows, which never reach here. */
function searchLine(item: DigestItem): string {
  return item.searchLink === null
    ? 'Link: none'
    : `Link: ${item.searchLink.url} (host ${item.searchLink.host}, ${item.searchLink.label})`;
}

function previousLine(item: DigestItem): string | null {
  if (item.previousPricePence === null) return null;
  const gap = item.fetchGapHours;
  // why: fetchGapHours is the gap between the two fetches (decision 21), never the previous price's age.
  const when =
    gap === null
      ? ''
      : gap < 1
        ? ', fetched under an hour before this price'
        : `, fetched ${formatDuration(gap)} before this price`;
  return `   Previous: ${formatPence(item.previousPricePence)}${when}`;
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

function ruleText(r: AlertRule): string {
  const what =
    r.type === 'absolute'
      ? `alert when the price is ${formatPence(r.thresholdPence ?? 0)} or less`
      : r.type === 'dropAbs'
        ? `alert when the price drops by ${formatPence(r.thresholdPence ?? 0)} or more`
        : `alert when the price drops by ${r.pct ?? 0}% or more`;
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

/** Spec §8.3 body; LF line endings only. */
export function renderBody(input: DigestRenderInput): string {
  const d = input.digest;
  const lines = [`get-me-there alert for "${stripControl(input.definitionName)}"`, ''];
  d.items.forEach((item, i) => {
    lines.push(...itemLines(i + 1, item, input), '');
  });
  if (d.restCount > 0) lines.push(`and ${d.restCount} more`, '');
  if (d.newItems.length > 0) {
    lines.push('New since the last check (no earlier price to compare; not a drop):');
    for (const item of d.newItems)
      lines.push(
        `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}`,
      );
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
 * from the current execution, evaluate rules (core), build one structured digest per rule (core), render it
 * (templates), send it to every notifier and persist one alert_events row per firing. The engine calls it when a pass
 * completes and when it pauses for a budget cap (decision 25), before the status write.
 */
import { randomUUID } from 'node:crypto';
import {
  type AlertCandidate,
  type AlertRule,
  buildDigest,
  type CalendarCandidate,
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  daysBetween,
  evaluateAlertRules,
  type Firing,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type ResultBasis,
  type SearchDefinition,
} from '@gmt/core';
import type { EngineDeps } from '../types.js';
import { cellLine, renderBody, renderSubject } from './templates.js';

/** What the runner needs from the engine's dependencies; EngineDeps satisfies it, so runAlerts is an AlertsStepHook. */
export type AlertRunnerDeps = Pick<
  EngineDeps,
  'config' | 'db' | 'repos' | 'providers' | 'notifiers' | 'clock' | 'log'
>;
/** Digests delivered (sent or failed) and alert_events rows written (any status). */
export interface AlertRunResult {
  digests: number;
  events: number;
}

/** One basis's candidates, plus the offers left out because the final step did not confirm their price. */
interface Pool {
  candidates: AlertCandidate[];
  unconfirmed: number;
}

interface RunContext {
  deps: AlertRunnerDeps;
  log: Logger;
  now: IsoDateTime;
  executionId: string;
  definition: SearchDefinition;
  snapshot: DefinitionSnapshot;
  pools: Map<ResultBasis, Pool>;
}

const NONE: AlertRunResult = { digests: 0, events: 0 };

/** Runs every enabled rule of the execution's definition once. Never rejects (spec §8.1: alerts never block completion). */
export async function runAlerts(deps: AlertRunnerDeps, executionId: string): Promise<AlertRunResult> {
  try {
    const execution = deps.repos.executions.get(executionId);
    if (execution === null) throw new Error(`execution ${executionId} not found`);
    const definition = deps.repos.definitions.get(execution.definitionId);
    if (definition === null || definition.deletedAt !== null) return NONE;
    const rules = deps.repos.alerts.rules(definition.id).filter((r) => r.enabled);
    if (rules.length === 0) return NONE;
    const ctx: RunContext = {
      deps,
      log: deps.log.child({ executionId, definitionId: definition.id }),
      now: deps.clock.now(),
      executionId,
      definition,
      snapshot: execution.snapshot,
      pools: new Map(),
    };
    let digests = 0;
    let events = 0;
    for (const rule of rules) {
      try {
        const r = await runRule(ctx, rule);
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

function poolFor(ctx: RunContext, basis: ResultBasis): Pool {
  const cached = ctx.pools.get(basis);
  if (cached !== undefined) return cached;
  // why: the itinerary-search pool is gathered from Task 11.3 on; until then a verified rule has no candidates.
  const pool = basis === 'calendar' ? calendarPool(ctx) : { candidates: [], unconfirmed: 0 };
  ctx.pools.set(basis, pool);
  return pool;
}

/** Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin. Spec §6.8. */
function calendarPool(ctx: RunContext): Pool {
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
  return { candidates, unconfirmed: 0 };
}

async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const pool = poolFor(ctx, rule.basis);
  // why: no prior firings until Task 11.5 adds the cooldown lookup.
  const firings = evaluateAlertRules([rule], pool.candidates, [], {
    now: ctx.now,
    executionId: ctx.executionId,
    cabin: ctx.snapshot.cabin,
    discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  // why: a "new" firing (spec §6.8 absent-then-present) is listed in the digest and never recorded as an event.
  const fired = firings.filter((f) => f.suppressed === null && !f.isNew);
  if (fired.length === 0) return NONE;
  return deliver(ctx, rule, { firings, fired });
}

/** "itinerary-searched K of N cells, E outbounds each" for this execution; null without a verification provider. */
function coverageFor(
  ctx: RunContext,
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

function cellOf(c: AlertCandidate): Cell {
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

/**
 * Builds, renders and sends one digest, then writes one event per fired firing in one transaction.
 * why: spec §8.1 lists "persist events → notify digests"; the event's status is the delivery outcome, so the rows are
 * written once the notifiers have answered, in one transaction, before the step returns.
 */
async function deliver(
  ctx: RunContext,
  rule: AlertRule,
  run: { firings: Firing[]; fired: Firing[] },
): Promise<AlertRunResult> {
  const digest = buildDigest(rule, run.firings, {
    executionId: ctx.executionId,
    definitionId: ctx.definition.id,
    coverageCaveat: coverageFor(ctx),
  });
  const first = digest?.items[0];
  // why: plan decision 10 — a digest with only "new" items and no firing is not sent.
  if (digest === null || first === undefined) return NONE;
  const subject = renderSubject(first, ctx.now);
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
  });
  const outcome = await sendToAll(ctx.deps.notifiers, { kind: 'digest', digest, subject, body });
  const digestId = randomUUID();
  ctx.deps.db.transaction(() => {
    for (const f of run.fired) {
      const reason = outcome.status === 'sent' ? f.reason : `${f.reason}; not delivered: ${outcome.detail}`;
      ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, outcome.status, reason, digestId));
    }
  });
  return { digests: 1, events: run.fired.length };
}

/**
 * One alert_events row. The payload carries what the Alerts view shows: the price with its provenance, so the view
 * prints it through WP9's PriceCell (decision 52), and the cell in words. Task 11.7 adds the marks.
 */
function eventRow(
  ctx: RunContext,
  f: Firing,
  status: 'sent' | 'failed' | 'suppressed',
  reason: string | null,
  digestId: string | null,
) {
  const c = f.candidate;
  return {
    ruleId: f.rule.id,
    identityKey: f.identityKey,
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
    dedupKey: f.dedupKey,
    firedAt: ctx.now,
    status,
    reason,
    payload: {
      digestId,
      executionId: ctx.executionId,
      pricePence: c.basis === 'verified' ? c.observation.pricePence : c.pricePence,
      provenance: c.basis === 'verified' ? c.observation.provenance : c.provenance,
      previousPence: c.previous?.pricePence ?? null,
      isNew: f.isNew,
      route: cellLine(cellOf(c)),
    },
  };
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

In `packages/engine/src/index.ts`, replace the barrel comment (the first line) with these lines:

```ts
// Barrel for @gmt/engine (plan contract "Engine"); the alert runner, templates and EmailNotifier are WP11's.
export { type AlertRunnerDeps, type AlertRunResult, runAlerts } from './alerts/runner.js';
export {
  appRowLink,
  type DigestRenderInput,
  renderBody,
  renderSubject,
  routeLine,
  sourceLabel,
  stripControl,
} from './alerts/templates.js';
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts`. Expected: PASS, 4 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert runner delivers one rendered digest per rule per execution (spec §6.8, §8.3)"`

### Task 11.2: Itinerary-search item lines, link re-validation, CRLF stripping, banned words

**Files:** Modify `packages/engine/src/alerts/templates.ts`. Create `packages/engine/test/alerts/builders.ts` and `packages/engine/test/alerts/templates.test.ts`.

**Interfaces:** Consumes `CONSTRAINT_LABELS` (with `priceConfirmed`), `validateVendorUrl`, `LINK_ALLOWLIST`, `effectiveAge`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`.

- [ ] **Step 1: Write the failing test.** The builders hand-build digest items with no database. The itinerary-search item is a SearchApi price, whose vendor age is `'unknown'` (spec rev 15, decision 24), so its subject reads "fetched 5h ago · provider age unknown" and its notes say "vendor's cache age unknown" (spec §3 rev 23); the calendar item keeps the spec §8.3 example's "(≤7d before that)".

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
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  appRowLink,
  renderBody,
  renderSubject,
  sourceLabel,
  stripControl,
} from '../../src/alerts/templates.js';
import { calendarItem, digestOf, HASH, NOW, RULE, renderInput, verifiedItem } from './builders.js';

const ROW = `/?view=results&def=def-1&basis=verified&row=${HASH}`;

describe('subject formats (spec §8.3)', () => {
  it('itinerary-search basis: SearchApi itinerary prices carry an unknown vendor age (spec rev 15)', () => {
    expect(renderSubject(verifiedItem(), NOW)).toBe(
      '[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · provider age unknown · 1 constraint unverified',
    );
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
  it('SearchApi date grid label; synthetic provenance refused', () => {
    expect(sourceLabel({ providerId: 'searchapi', sourceKind: 'scraped-aggregate' })).toBe(
      'Google date grid via SearchApi',
    );
    expect(() => sourceLabel({ providerId: 'fixture', sourceKind: 'synthetic' })).toThrow(/synthetic/);
  });
});

describe('itinerary-search item body (spec §8.3)', () => {
  it('segments, seller, every unverified constraint, provenance, link with host and expiry, coverage, rule, rest count', () => {
    const body = renderBody(renderInput({ digest: digestOf([verifiedItem()], { restCount: 40 }) }));
    expect(body).not.toContain('more new cells');
    for (const line of [
      '   Seller: British Airways',
      '   Outbound: BA 117 LHR 08:25 → JFK 11:20 (14 Mar)',
      '   Inbound: BA 112 JFK 18:30 → LHR 06:35 (28 Mar)',
      `   Verdicts: class partially-verified; unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`,
      '   Provenance: Google Flights via SearchApi · fetched 5h ago · provider age unknown',
      "   Notes: vendor's cache age unknown",
      '   Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
      'and 40 more',
      'Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each',
      'Rule: alert when the price is £450 or less · itinerary-search basis, class verified or partially-verified · cooldown 336h',
    ])
      expect(body).toContain(line);
  });
  it('POST booking: links to the app results row (relative without APP_BASE_URL, absolute with it), never the vendor form', () => {
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
    expect(appRowLink(null, 'def-1', 'verified', HASH)).toBe(ROW);
    expect(appRowLink(null, 'def 1', 'calendar', 'calendar:5')).toBe(
      '/?view=results&def=def+1&basis=calendar&row=calendar%3A5',
    );
    expect(relative).not.toContain('u=formdata');
    expect(relative).not.toContain('https://www.google.com/travel/clk/f');
    const absolute = renderBody(
      renderInput({ digest: digestOf([post]), appBaseUrl: 'https://gmt.example.ts.net/' }),
    );
    expect(absolute).toContain(`https://gmt.example.ts.net${ROW}`);
  });
  it('expired, unstated expiry, no booking → labelled search link; a link that fails re-validation → no link', () => {
    const at = (over: Parameters<typeof verifiedItem>[0]) =>
      renderBody(renderInput({ digest: digestOf([verifiedItem(over)]) }));
    expect(at({ bookingExpiresAt: asIsoDateTime('2026-10-14T13:00:00.000Z') })).toContain('expired 2h ago');
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
    expect(body).toContain("   Notes: price not confirmed by the final step; vendor's cache age unknown");
  });
  it('calendar item with a drop: previous price and the fetch gap; new items in their own section', () => {
    const drop = calendarItem({
      previousPricePence: 43000,
      fetchGapHours: 72,
      firingReason: 'down £41 (9%) from £430 fetched 3d (72h) earlier',
    });
    const body = renderBody(
      renderInput({
        digest: digestOf([drop], {
          basis: 'calendar',
          coverageCaveat: null,
          newItems: [calendarItem({ isNew: true, rowKey: 'calendar:6' })],
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
    for (const line of [
      '   calendar price, no itinerary; constraints not checked',
      '   Previous: £430, fetched 3d before this price',
      '   Provenance: Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
      '   Link: https://www.aviasales.com/search/LON1403NYC28031 (host www.aviasales.com, search link, not a fare link)',
      'New since the last check (no earlier price to compare; not a drop):',
      '- £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
      'and 4 more new cells',
      'Coverage: itinerary-searched 0 cells (no verification provider configured)',
      'Rule: alert when the price drops by £20 or more · calendar basis, constraints not checked · cooldown 336h',
    ])
      expect(body).toContain(line);
    expect(body).not.toContain('Notes:');
  });
});

describe('provider strings are CRLF/control-stripped (spec §8.3)', () => {
  it('a seller name or definition name cannot inject headers or lines', () => {
    const item = verifiedItem({ seller: 'Cheap Seats\r\nBcc: victim@example.com\u0007' });
    const body = renderBody(
      renderInput({ digest: digestOf([item]), definitionName: 'Trip\r\nX-Injected: 1\u2028Y' }),
    );
    expect(body).not.toMatch(/\r/);
    expect(
      body.split('\n').some((l) => l.startsWith('Bcc:') || l.startsWith('X-Injected:') || l.startsWith('Y')),
    ).toBe(false);
    expect(body).toContain('Seller: Cheap Seats Bcc: victim@example.com');
    expect(renderSubject(item, NOW)).not.toMatch(/[\r\n]/);
  });
  it('stripControl removes C0, C1 and the line separators and collapses the gaps', () => {
    expect(stripControl('\u0000a b\tc\u0085d\u2029e\r\n')).toBe('a b c d e');
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

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts`. Expected: FAIL in six tests, among them `expected 'get-me-there alert for "London to New…' to contain '   Seller: British Airways'` (the body still prints "calendar price, no itinerary" for every item) and the unconfirmed subject; the calendar subject, the source labels and the calendar-drop body pass.

- [ ] **Step 3: Implement.** Five edits to `templates.ts`; each shows the full replacement.

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
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  type ResultBasis,
  type Segment,
  stripControlChars,
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

Replace the Task 11.1 `basisLines` and `linkLine` (with their doc comments) with:

```ts
function hoursUntil(from: IsoDateTime, to: IsoDateTime): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 3_600_000);
}

function segmentLine(s: Segment): string {
  const hhmm = (local: string) => local.slice(11, 16);
  return `${stripControl(s.marketingCarrier)} ${s.flightNumber} ${s.from} ${hhmm(s.departLocal)} → ${s.to} ${hhmm(s.arriveLocal)} (${day(s.departLocal)})`;
}

function expiryText(expiresAt: IsoDateTime | null, now: IsoDateTime): string {
  if (expiresAt === null) return 'expiry not stated';
  const h = hoursUntil(now, expiresAt);
  if (h > 0) return `expires in ${formatDuration(h)}`;
  return -h < 1 ? 'expired just now' : `expired ${formatDuration(-h)} ago`;
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
    `   Seller: ${stripControl(item.seller ?? 'not stated')}`,
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

/** Marks a reader needs beside the price (spec §3 rev 23; decisions 37, 44), in a fixed order; Task 11.7 adds the runner's. */
function notesOf(item: DigestItem, input: DigestRenderInput): string[] {
  const notes: string[] = [];
  if (item.unverified.includes('priceConfirmed')) notes.push(CONSTRAINT_LABELS.priceConfirmed);
  // why: spec §3 rev 23 — an unknown vendor age is aged by fetchedAt alone, labelled, and never stale on that account.
  if (effectiveAge(item.provenance, input.now).kind === 'unknown') notes.push("vendor's cache age unknown");
  return notes;
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

In `renderBody`, replace the loop over `d.newItems` with:

```ts
    for (const item of d.newItems) {
      const notes = notesOf(item, input);
      lines.push(
        `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${notes.length > 0 ? ` · ${notes.join('; ')}` : ''}`,
      );
    }
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 16 tests (12 in `templates.test.ts`).

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: itinerary-search email lines, link re-validation, CRLF stripping and banned-word test over rendered output"`

### Task 11.3: Itinerary-search basis: current-execution observations, identity, requireAllVerified, drops, unconfirmed prices

**Files:** Modify `packages/engine/src/alerts/runner.ts`. Test `packages/engine/test/alerts/runner.verified.test.ts`.

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
      previousPence: 50000,
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
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.verified.test.ts`. Expected: FAIL in all five, the first with `expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 2 }`: the itinerary-search pool is empty.

- [ ] **Step 3: Implement.** Three edits to `runner.ts`:

In `runner.ts`, add `evaluateConstraints`, `unverifiedNames`, `verdictClass` and `type VerifiedCandidate` to the `@gmt/core` import, which becomes:

```ts
import {
  type AlertCandidate,
  type AlertRule,
  buildDigest,
  type CalendarCandidate,
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  daysBetween,
  evaluateAlertRules,
  evaluateConstraints,
  type Firing,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type ResultBasis,
  type SearchDefinition,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

In `poolFor`, replace the comment and the pool line with:

```ts
  const pool = basis === 'calendar' ? calendarPool(ctx) : verifiedPool(ctx);
```

Add after `calendarPool`:

```ts
/**
 * Observations written by this execution in the snapshot's cabin, verdicts recomputed against the current definition
 * (spec §6.2), failed excluded; previous = each offer's previous observation. Spec §6.8.
 * why: an offer whose price the final step did not confirm (`price` not supplied) is never alerted on (decisions 27,
 * 37, 45); it is counted so the digest can say how many were left out. Core settles each identity on its cheapest
 * eligible candidate (rev 11), so every other offer is passed; reducing here could drop the class-verified offer a
 * requireAllVerified rule needs in favour of a cheaper partially-verified one.
 */
function verifiedPool(ctx: RunContext): Pool {
  const candidates: VerifiedCandidate[] = [];
  let unconfirmed = 0;
  for (const row of ctx.deps.repos.itineraries.writtenBy(ctx.executionId)) {
    if (row.offer.cabin !== ctx.snapshot.cabin) continue;
    if (!row.suppliedFields.includes('price')) {
      unconfirmed += 1;
      continue;
    }
    const verdicts = evaluateConstraints(
      row.itinerary,
      row,
      ctx.definition.constraints,
      ctx.snapshot.cabin,
      row.suppliedFields,
    );
    const cls = verdictClass(verdicts);
    if (cls === 'failed') continue;
    const prev = ctx.deps.repos.itineraries.previousObservation(row.offerId, row.provenance.fetchedAt);
    candidates.push({
      basis: 'verified',
      observation: row,
      itinerary: row.itinerary,
      verdictClass: cls,
      unverified: unverifiedNames(verdicts),
      seller: row.seller,
      previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.provenance.fetchedAt },
    });
  }
  if (unconfirmed > 0) ctx.log.info({ unconfirmed }, 'alerts: unconfirmed prices left out');
  return { candidates, unconfirmed };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 21 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: itinerary-search candidates from the current execution, drops vs previous observation, unconfirmed prices never alerted"`

### Task 11.4: Calendar basis: previous price, the 2 × discoveryRefreshHours window, the "new" section

**Files:** Modify `packages/engine/src/alerts/runner.ts`. Test `packages/engine/test/alerts/runner.calendar.test.ts`.

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
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(events.map((e) => e.identityKey).sort()).toEqual(
      [c167, c168].map((c) => `${rule.id}|searchapi|economy|${cellKeyString(c)}`).sort(),
    );
    expect(
      events.every((e) => payloadOf(e).previousPence === 50000 && (e.reason ?? '').includes('£500')),
    ).toBe(true);
    const body = f.notifier.digests()[0]?.body ?? '';
    // absent-then-present (outside the window) is listed as new, never a drop, and says why
    expect(body).toContain('New since the last check (no earlier price to compare; not a drop):');
    expect(body).toContain('- £400 LHR→JFK 3 Nov–17 Nov (14n) · Google date grid via SearchApi');
    expect(events.some((e) => e.identityKey.endsWith(cellKeyString(c169)))).toBe(false);
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

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.calendar.test.ts`. Expected: FAIL in the window test with `expected { digests: +0, events: +0 } to deeply equal { digests: 1, events: 2 }`: no previous prices are gathered yet, so every cell is new. The other three pass.

- [ ] **Step 3: Implement.** Three edits to `runner.ts`. The repository query takes no lower bound: core compares only within the window, in whole minutes, and lists a price whose previous fetch is older in the "new" section with that age.

In `runner.ts`, add `isoDateTimeOfEpochMs` to the `@gmt/core` import:

```ts
import {
  type AlertCandidate,
  type AlertRule,
  buildDigest,
  type CalendarCandidate,
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  daysBetween,
  evaluateAlertRules,
  evaluateConstraints,
  type Firing,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  type Logger,
  type Notifier,
  type ResultBasis,
  type SearchDefinition,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

Add after `NONE`:

```ts
/** previousFor's lower bound: none. Core judges the 2 × discoveryRefreshHours window itself (in whole minutes). */
const NO_LOWER_BOUND = isoDateTimeOfEpochMs(0);
```

Replace `calendarPool` and its doc comment with:

```ts
/**
 * Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin; previous =
 * the newest earlier fetch for (definition, provider, cabin, cell). Spec §6.8.
 * why: core compares only within 2 × discoveryRefreshHours and lists an older previous price in the "new" section with
 * its age, so the repository query has no lower bound.
 */
function calendarPool(ctx: RunContext): Pool {
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
      return {
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.fetchedAt },
      };
    });
  return { candidates, unconfirmed: 0 };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 25 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: calendar-basis drops within 2 x discoveryRefreshHours; absent-then-present listed as new"`

### Task 11.5: Cooldown across executions, failed deliveries, later passes of one execution

**Files:** Modify `packages/engine/src/alerts/runner.ts`. Test `packages/engine/test/alerts/runner.dedup.test.ts`.

**Interfaces:** Consumes `AlertsRepo.priorFirings`, `AlertsRepo.events`, `identityKey`, `Firing.suppressed`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.dedup.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cellAt,
  cells,
  fixture,
  RecordingNotifier,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

const DAY = 24 * 3_600_000;

describe('cooldown across executions (spec §6.8, §9 item 4)', () => {
  it('calendar basis: the same price band within cooldownHours is suppressed with a reason; after the cooldown it sends again', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 336 });
    const cell = cellAt(cells(1), 0);

    const first = seedExecution(f, def);
    seedCalendar(f, first, [{ cell, pricePence: 41200 }]);
    expect(await runAlerts(f.deps, first)).toEqual({ digests: 1, events: 1 });

    f.clock.advance(7 * DAY);
    const second = seedExecution(f, def);
    seedCalendar(f, second, [{ cell, pricePence: 41250 }]); // same £412 band
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 0, events: 1 });
    expect(f.notifier.digests()).toHaveLength(1);
    const suppressed = f.repos.alerts
      .events({ ruleId: rule.id, limit: 100 })
      .filter((e) => e.status === 'suppressed');
    expect(suppressed.map((e) => e.reason)).toEqual([
      'same price band alerted 7d (168h) ago; cooldown 2w (336h)',
    ]);

    f.clock.advance(8 * DAY); // 15 days after the first send: past 336 h
    const third = seedExecution(f, def);
    seedCalendar(f, third, [{ cell, pricePence: 41250 }]);
    expect(await runAlerts(f.deps, third)).toEqual({ digests: 1, events: 1 });
  });

  it('inside the cooldown the same identity fires again only at least max(£10, 5%) below the last fired price (spec rev 11 §6.8)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const cell = cellAt(cells(1), 0);
    const first = seedExecution(f, def);
    seedCalendar(f, first, [{ cell, pricePence: 41200 }]);
    await runAlerts(f.deps, first);

    f.clock.advance(DAY);
    const higher = seedExecution(f, def);
    seedCalendar(f, higher, [{ cell, pricePence: 43000 }]);
    expect(await runAlerts(f.deps, higher)).toEqual({ digests: 0, events: 1 });

    f.clock.advance(DAY);
    const drift = seedExecution(f, def);
    seedCalendar(f, drift, [{ cell, pricePence: 40800 }]); // a new £408 band but only £4 below £412: under max(£10, 5%) = £20.60
    expect(await runAlerts(f.deps, drift)).toEqual({ digests: 0, events: 1 });

    f.clock.advance(DAY);
    const lower = seedExecution(f, def);
    seedCalendar(f, lower, [{ cell, pricePence: 39000 }]); // £22 below £412: at least £20.60
    expect(await runAlerts(f.deps, lower)).toEqual({ digests: 1, events: 1 });
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

  it('a failed delivery is recorded as failed and does not suppress the next execution', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const cell = cellAt(cells(1), 0);
    const first = seedExecution(f, def);
    seedCalendar(f, first, [{ cell, pricePence: 41200 }]);
    await runAlerts(f.deps, first);
    const [failed] = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(failed?.status).toBe('failed');
    expect(failed?.reason).toBe(
      '£412 is at or below the £450 threshold; not delivered: email: connection refused',
    );

    f.clock.advance(DAY);
    const second = seedExecution(f, def);
    seedCalendar(f, second, [{ cell, pricePence: 41200 }]);
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 1, events: 1 });
  });
});

describe('a later pass of the same execution never repeats a firing (decision 25)', () => {
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
    f.clock.advance(2 * 3_600_000);
    seedCalendar(f, ex, [{ cell: cellAt(list, 1), pricePence: 42000 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[1]?.digest.items.map((i) => i.pricePence)).toEqual([42000]);

    // a third pass with nothing new
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.dedup.test.ts`. Expected: FAIL in four tests, the first with `expected { digests: 1, events: 1 } to deeply equal { digests: +0, events: 1 }`: no prior firings are read, so nothing is suppressed, and a second pass repeats the first. The failed-delivery test passes.

- [ ] **Step 3: Implement.** Five edits to `runner.ts`. A later pass of the same execution (the engine runs the step after a paused_budget pass and again after the resumed one, decision 25; also after a retry-errors resume of a completed run) skips every row that already has an event of the rule, so it never repeats a firing; what it sends is only what the earlier pass did not see (§13 item 2).

In `runner.ts`, add `identityKey` to the `@gmt/core` import:

```ts
import {
  type AlertCandidate,
  type AlertRule,
  buildDigest,
  type CalendarCandidate,
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  daysBetween,
  evaluateAlertRules,
  evaluateConstraints,
  type Firing,
  type IsoDateTime,
  identityKey,
  isoDateTimeOfEpochMs,
  type Logger,
  type Notifier,
  type ResultBasis,
  type SearchDefinition,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

Replace the `NO_LOWER_BOUND` constant and its doc comment with these constants:

```ts
const HOUR_MS = 3_600_000;
/** previousFor's lower bound: none. Core judges the 2 × discoveryRefreshHours window itself (in whole minutes). */
const NO_LOWER_BOUND = isoDateTimeOfEpochMs(0);
/**
 * Events read back per rule beyond the pool size when looking for an earlier pass's events. Events come newest first and
 * this execution holds at most one per candidate row; only child executions of the same definition interleave.
 */
const EARLIER_PASS_MARGIN = 1_000;
```

Add after `runAlerts`:

```ts
/** An instant `hours` before `at`. */
function hoursBefore(at: IsoDateTime, hours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) - hours * HOUR_MS);
}
```

Add after `verifiedPool`:

```ts
/** The candidate's row, as alert_events references it. */
function rowRef(c: AlertCandidate): string {
  return c.basis === 'verified' ? `observation:${c.observation.id}` : `calendar:${c.calendarPriceId}`;
}

/**
 * Rows of this pool that already have an event of this rule: an earlier pass of the same execution (a paused_budget
 * pass before its resume, or a completed pass before a retry-errors resume) recorded them, so a later pass never
 * repeats one (decision 25).
 */
function recordedRows(ctx: RunContext, rule: AlertRule, pool: Pool): Set<string> {
  const own = new Set(pool.candidates.map(rowRef));
  const out = new Set<string>();
  const events = ctx.deps.repos.alerts.events({
    ruleId: rule.id,
    limit: pool.candidates.length + EARLIER_PASS_MARGIN,
  });
  for (const e of events) {
    const ref =
      e.observationId !== null
        ? `observation:${e.observationId}`
        : e.calendarPriceId !== null
          ? `calendar:${e.calendarPriceId}`
          : null;
    if (ref !== null && own.has(ref)) out.add(ref);
  }
  return out;
}
```

Replace `runRule` with:

```ts
async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const pool = poolFor(ctx, rule.basis);
  const recorded = recordedRows(ctx, rule, pool);
  const candidates = pool.candidates.filter((c) => !recorded.has(rowRef(c)));
  if (candidates.length === 0) return NONE;
  // why: spec §6.8 suppression looks back cooldownHours over this rule's sent firings for these identities.
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
  // why: plan pin — evaluateAlertRules returns suppressed firings too; the runner records them and the digest excludes
  // them. A "new" firing (spec §6.8 absent-then-present) is listed in the digest and never recorded as an event.
  const suppressed = firings.filter((f) => f.suppressed !== null);
  const fired = firings.filter((f) => f.suppressed === null && !f.isNew);
  ctx.deps.db.transaction(() => {
    for (const f of suppressed)
      ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, 'suppressed', f.suppressed?.reason ?? null, null));
  });
  if (fired.length === 0) return { digests: 0, events: suppressed.length };
  const delivered = await deliver(ctx, rule, { firings, fired });
  return { digests: delivered.digests, events: delivered.events + suppressed.length };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 30 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert cooldown across executions with suppression reasons; failed sends do not suppress; later passes never repeat"`

### Task 11.6: Synthetic rows refused by the runner; never-reject behaviour

**Files:** Modify `packages/engine/src/alerts/runner.ts`. Test `packages/engine/test/alerts/runner.refusals.test.ts`.

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
    expect(event?.status).toBe('failed');
    expect(event?.reason).toContain('not delivered: broken: socket closed');
    expect(
      f.log.lines.some((l) => l.level === 'error' && l.msg === 'alerts: rule failed; other rules continue'),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.refusals.test.ts`. Expected: FAIL in the synthetic test with `expected [] to deeply equal [ 1, 5 ]`: core's own eligibility check already drops the rows, so nothing is sent, but the runner logs no refusal. The other two pass (Task 11.1 made `runAlerts` never reject).

- [ ] **Step 3: Implement.** Three edits to `runner.ts`:

In `runner.ts`, add `type Provenance` to the `@gmt/core` import:

```ts
import {
  type AlertCandidate,
  type AlertRule,
  buildDigest,
  type CalendarCandidate,
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  daysBetween,
  evaluateAlertRules,
  evaluateConstraints,
  type Firing,
  type IsoDateTime,
  identityKey,
  isoDateTimeOfEpochMs,
  type Logger,
  type Notifier,
  type Provenance,
  type ResultBasis,
  type SearchDefinition,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
} from '@gmt/core';
```

Add after `hoursBefore`:

```ts
/** Spec §5.5: alerts refuse synthetic rows; the fixture provider ⇔ synthetic invariant is checked both ways. */
function isSynthetic(p: Pick<Provenance, 'providerId' | 'sourceKind'>): boolean {
  return p.sourceKind === 'synthetic' || p.providerId === 'fixture';
}

/** Drops synthetic rows before any rule sees them and logs the count once per basis. */
function refuseSynthetic<T extends { provenance: Provenance }>(
  ctx: RunContext,
  basis: ResultBasis,
  rows: T[],
): T[] {
  const kept = rows.filter((r) => !isSynthetic(r.provenance));
  const refused = rows.length - kept.length;
  if (refused > 0) ctx.log.warn({ basis, refused }, 'alerts: synthetic rows refused');
  return kept;
}
```

Replace `calendarPool` and `verifiedPool` (with their doc comments) with these versions, which read through `refuseSynthetic`:

```ts
/**
 * Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin; previous =
 * the newest earlier fetch for (definition, provider, cabin, cell). Spec §6.8.
 * why: core compares only within 2 × discoveryRefreshHours and lists an older previous price in the "new" section with
 * its age, so the repository query has no lower bound.
 */
function calendarPool(ctx: RunContext): Pool {
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
      return {
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.fetchedAt },
      };
    });
  return { candidates, unconfirmed: 0 };
}

/**
 * Observations written by this execution in the snapshot's cabin, verdicts recomputed against the current definition
 * (spec §6.2), failed excluded; previous = each offer's previous observation. Spec §6.8.
 * why: an offer whose price the final step did not confirm (`price` not supplied) is never alerted on (decisions 27,
 * 37, 45); it is counted so the digest can say how many were left out. Core settles each identity on its cheapest
 * eligible candidate (rev 11), so every other offer is passed; reducing here could drop the class-verified offer a
 * requireAllVerified rule needs in favour of a cheaper partially-verified one.
 */
function verifiedPool(ctx: RunContext): Pool {
  const candidates: VerifiedCandidate[] = [];
  let unconfirmed = 0;
  for (const row of refuseSynthetic(ctx, 'verified', ctx.deps.repos.itineraries.writtenBy(ctx.executionId))) {
    if (row.offer.cabin !== ctx.snapshot.cabin) continue;
    if (!row.suppliedFields.includes('price')) {
      unconfirmed += 1;
      continue;
    }
    const verdicts = evaluateConstraints(
      row.itinerary,
      row,
      ctx.definition.constraints,
      ctx.snapshot.cabin,
      row.suppliedFields,
    );
    const cls = verdictClass(verdicts);
    if (cls === 'failed') continue;
    const prev = ctx.deps.repos.itineraries.previousObservation(row.offerId, row.provenance.fetchedAt);
    candidates.push({
      basis: 'verified',
      observation: row,
      itinerary: row.itinerary,
      verdictClass: cls,
      unverified: unverifiedNames(verdicts),
      seller: row.seller,
      previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.provenance.fetchedAt },
    });
  }
  if (unconfirmed > 0) ctx.log.info({ unconfirmed }, 'alerts: unconfirmed prices left out');
  return { candidates, unconfirmed };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, 33 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert runner refuses synthetic rows before evaluation"`

### Task 11.7: Marks: staleness by effective age, unknown vendor age, truncated tiles, not seen in latest search, budget stops, unconfirmed count

**Files:**
- Modify `packages/engine/src/alerts/templates.ts`, `packages/engine/src/alerts/runner.ts`, `packages/engine/src/index.ts`, `packages/engine/test/alerts/fixtures.ts`, `packages/engine/test/alerts/builders.ts`.
- Test `packages/engine/test/alerts/runner.marks.test.ts` and `packages/engine/test/alerts/templates.marks.test.ts`.

**Interfaces:**
- **Consumes:** `effectiveAge`, `worstCaseAgeHours`, `DEFAULT_DISCOVERY_REFRESH_HOURS`, `isTruncated`, `TRUNCATED_NOTE`, `resultRowKey`, `ItinerariesRepo.latestVerificationOutcomeForCell`, `CellsRepo.outcomes`, `Config.staleAfterHours`, `Config.calendarStaleAfterHours`, `FlightProvider.discovery.info.maxAgeHours`.
- **Produces:** `ItemMarks`, `NO_MARKS`, `DigestRenderInput.marks/budgetUnsearched/unconfirmedLeftOut`, the event payload's `stale`, `truncated` and `notSeenInLatestHours`.

`DigestItem` carries none of these marks, and core is not changed: the runner reads them from the repositories and passes them to the templates keyed by the item's `rowKey`, and stores them on every event row so the Alerts view can print the price through `PriceCell` (decision 52).

- [ ] **Step 1: Write the failing tests.**

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
} from './fixtures.js';

const HOUR = 3_600_000;

describe('staleness by effective age (spec §3 rev 23, §8.1; decision 54)', () => {
  it('a calendar price older than refresh + declared age by its known age is marked stale; an unknown vendor age never is', async () => {
    // why: CALENDAR_STALE_AFTER_HOURS 100 makes the threshold explicit; the observed age (the vendor's search date,
    // decision 35) counts, not the fetch age
    const f = fixture({ env: { CALENDAR_STALE_AFTER_HOURS: '100', STALE_AFTER_HOURS: '192' } });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(3);
    seedCalendar(f, ex, [
      {
        cell: cellAt(list, 0),
        pricePence: 40000,
        providerId: 'travelpayouts',
        providerObservedAt: hoursBefore(NOW, 120),
      },
      {
        cell: cellAt(list, 1),
        pricePence: 40100,
        providerId: 'travelpayouts',
        providerObservedAt: hoursBefore(NOW, 90),
      },
      { cell: cellAt(list, 2), pricePence: 40200, maxAgeHours: null },
    ]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const lines = (f.notifier.digests()[0]?.body ?? '').split('\n');
    const notes = lines.filter((l) => l.startsWith('   Notes:'));
    expect(notes).toEqual([
      '   Notes: stale: older than 100h by its known age',
      "   Notes: vendor's cache age unknown",
    ]);
    // every event row stores the marks beside the price and its provenance, for the Alerts view's PriceCell
    const payloads = f.repos.alerts.events({ definitionId: def.id, limit: 10 }).map(payloadOf);
    expect(payloads.map((p) => [p.pricePence, p.stale]).sort()).toEqual([
      [40000, true],
      [40100, false],
      [40200, false],
    ]);
    expect(payloads.find((p) => p.pricePence === 40200)?.provenance.maxAgeHours).toBe('unknown');
  });

  it('the itinerary-search threshold is STALE_AFTER_HOURS; a SearchApi itinerary price (age unknown) is labelled, never stale', async () => {
    const f = fixture({ env: { STALE_AFTER_HOURS: '1' } });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 42000,
      fetchedAt: hoursBefore(NOW, 5),
    });
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain("   Notes: vendor's cache age unknown");
    expect(body).not.toContain('stale');
  });
});

describe('truncated tiles, newer searches and budget stops (decisions 25, 30, 54)', () => {
  it('a price from a tile the page cap cut short reads "cheapest of the rows read"', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(2);
    seedTile(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }], `${TRUNCATED_NOTE}: page cap reached`);
    seedCalendar(f, ex, [{ cell: cellAt(list, 1), pricePence: 40100 }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const notes = (f.notifier.digests()[0]?.body ?? '').split('\n').filter((l) => l.startsWith('   Notes:'));
    expect(notes).toEqual([`   Notes: ${TRUNCATED_NOTE}`]);
    const payloads = f.repos.alerts.events({ definitionId: def.id, limit: 10 }).map(payloadOf);
    expect(payloads.filter((p) => p.truncated).map((p) => p.route)).toEqual(['LHR→JFK 1 Nov–15 Nov (14n)']);
  });

  it('a fare a newer itinerary search of its cell did not see reads "not seen in latest search"', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 43000, flight: 177 });
    // a single-cell verification (a child) searched 2 Nov after the run's own search and found no fares
    f.clock.advance(HOUR);
    const cell = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-16'),
      nights: 14,
    };
    const child = seedExecution(f, def, cell);
    f.repos.cells.seed(child, [cell], []);
    f.repos.cells.seedVerification(child, [{ cell, reason: 'always_include' }], [cell], ['searchapi']);
    searchedEmpty(f, child, cell);
    f.clock.advance(2 * HOUR);
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    const first = body.split('\n\n')[1] ?? '';
    expect(first).toContain('1. £420 LHR→JFK 2 Nov–16 Nov (14n)');
    expect(first).toContain("   Notes: not seen in latest search (2h ago); vendor's cache age unknown");
    expect(body.split('\n').filter((l) => l.includes('not seen in latest search'))).toHaveLength(1);
  });

  it('the digest counts the fares left out because the final step did not confirm their price', async () => {
    const f = fixture();
    const def = seedDefinition(f);
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
      'Not alerted: 1 fare of this run whose price was not confirmed by the final step.',
    );
  });

  it('a run that stopped at a budget cap says how many cell searches did not run (alerts run on paused_budget)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(4);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }]);
    f.repos.cells.seed(ex, [cellAt(list, 1), cellAt(list, 2), cellAt(list, 3)], ['travelpayouts']);
    f.repos.cells.setOutcome(ex, cellAt(list, 3), 'discovery', 'travelpayouts', {
      status: 'skipped',
      reason: 'budget',
    });
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(f.notifier.digests()[0]?.body).toContain(
      'Not searched: a budget cap left 3 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
  });
});
```

`packages/engine/test/alerts/templates.marks.test.ts`:

```ts
import { BANNED_WORD_ALLOWLIST, findBannedWords, TRUNCATED_NOTE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { renderBody } from '../../src/alerts/templates.js';
import { calendarItem, digestOf, HASH, renderInput, verifiedItem } from './builders.js';

describe('marks the runner reads from the repositories (spec §3, §8.1; decisions 25, 30, 44, 54)', () => {
  it('stale by known age, cheapest of the rows read, not seen in latest search; the left-out and budget lines', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([verifiedItem(), calendarItem()], {
          newItems: [calendarItem({ isNew: true, rowKey: 'calendar:6' })],
        }),
        marks: new Map([
          [HASH, { stale: null, truncated: false, notSeenInLatest: { ageHours: 3 } }],
          ['calendar:5', { stale: { thresholdHours: 192 }, truncated: true, notSeenInLatest: null }],
          ['calendar:6', { stale: null, truncated: true, notSeenInLatest: null }],
        ]),
        unconfirmedLeftOut: 2,
        budgetUnsearched: 1,
      }),
    );
    expect(body).toContain("   Notes: not seen in latest search (3h ago); vendor's cache age unknown");
    expect(body).toContain(`   Notes: ${TRUNCATED_NOTE}; stale: older than 192h by its known age`);
    expect(body).toContain(`(≤7d before that) · ${TRUNCATED_NOTE}`);
    expect(body).toContain(
      'Not alerted: 2 fares of this run whose price was not confirmed by the final step.',
    );
    expect(body).toContain(
      'Not searched: a budget cap left 1 cell search of this run undone; the prices above come from the cells that were searched.',
    );
  });
});

describe('banned words over the marks and run lines (spec §11)', () => {
  it('no banned word with every mark and both run lines set', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([verifiedItem(), calendarItem()]),
        marks: new Map([
          [HASH, { stale: { thresholdHours: 192 }, truncated: false, notSeenInLatest: { ageHours: 0 } }],
          ['calendar:5', { stale: { thresholdHours: 216 }, truncated: true, notSeenInLatest: null }],
        ]),
        unconfirmedLeftOut: 1,
        budgetUnsearched: 3,
      }),
    );
    expect(findBannedWords(body, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
```

In `packages/engine/test/alerts/fixtures.ts`, replace `payloadSchema` and its doc comment with:

```ts
/** The runner's payload on an event row (Task 11.1, marks from Task 11.7), parsed rather than cast. */
export const payloadSchema = z.object({
  digestId: z.string().nullable(),
  executionId: z.string(),
  pricePence: z.number().int(),
  provenance: provenanceSchema,
  previousPence: z.number().int().nullable(),
  isNew: z.boolean(),
  route: z.string(),
  stale: z.boolean(),
  truncated: z.boolean(),
  notSeenInLatestHours: z.number().int().nullable(),
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
    budgetUnsearched: 0,
    unconfirmedLeftOut: 0,
    ...over,
  };
}
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.marks.test.ts test/alerts/templates.marks.test.ts`. Expected: FAIL, 6 failed and 2 passed (under `pnpm --filter @gmt/engine typecheck`, also TS2353 on `marks` in `builders.ts`). The runner tests fail with `expected [ Array(1) ] to deeply equal [ …(2) ]` (no stale note), `expected [] to deeply equal [ Array(1) ]` (no truncated note) and `… to contain 'Not alerted: 1 fare of this run whose…'`; the template test with `… to contain '   Notes: not seen in latest search (…'`. The itinerary-search staleness test and the banned-word test pass (Task 11.2 already labels an unknown vendor age).

- [ ] **Step 3: Implement.** Five edits to `templates.ts`:

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
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  type ResultBasis,
  type Segment,
  stripControlChars,
  TRUNCATED_NOTE,
  validateVendorUrl,
} from '@gmt/core';
```

Add before `DigestRenderInput`:

```ts
/**
 * What the runner reads about one digest item from the repositories, which `DigestItem` does not carry (spec §3, §8.1;
 * decisions 30, 36, 54). Keyed by the item's `rowKey` in `DigestRenderInput.marks`.
 */
export interface ItemMarks {
  /** Effective age above the basis threshold (decision 54); never set for an unknown vendor age. */
  stale: { thresholdHours: number } | null;
  /** The price came from a discovery tile the page cap cut short (decision 30): "cheapest of the rows read". */
  truncated: boolean;
  /** A newer itinerary search of the cell priced it without this offer (spec §8.1, decision 54). */
  notSeenInLatest: { ageHours: number } | null;
}
export const NO_MARKS: ItemMarks = { stale: null, truncated: false, notSeenInLatest: null };
```

Replace `DigestRenderInput` with:

```ts
/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). */
export interface DigestRenderInput {
  digest: AlertDigest;
  definitionName: string;
  appBaseUrl: string | null;
  now: IsoDateTime;
  /** Per `DigestItem.rowKey`; an item without an entry has no marks. */
  marks: ReadonlyMap<string, ItemMarks>;
  /** Cell searches of this run a budget cap left undone (not_run or skipped:budget outcomes; decision 25). */
  budgetUnsearched: number;
  /** Offers of this run left out of the verified basis because the final step did not confirm their price. */
  unconfirmedLeftOut: number;
}
```

Replace `notesOf` (with its doc comment) with:

```ts
/** The marks a reader needs beside the price (spec §3, §8.1; decisions 30, 37, 44, 54), in a fixed order. */
function notesOf(item: DigestItem, input: DigestRenderInput): string[] {
  const m = input.marks.get(item.rowKey) ?? NO_MARKS;
  const notes: string[] = [];
  if (item.unverified.includes('priceConfirmed')) notes.push(CONSTRAINT_LABELS.priceConfirmed);
  if (m.truncated) notes.push(TRUNCATED_NOTE);
  if (m.notSeenInLatest !== null)
    notes.push(
      `not seen in latest search (${formatDuration(m.notSeenInLatest.ageHours)}${m.notSeenInLatest.ageHours < 1 ? '' : ' ago'})`,
    );
  if (m.stale !== null) notes.push(`stale: older than ${m.stale.thresholdHours}h by its known age`);
  // why: spec §3 rev 23 — an unknown vendor age is aged by fetchedAt alone, labelled, and never stale on that account.
  if (effectiveAge(item.provenance, input.now).kind === 'unknown') notes.push("vendor's cache age unknown");
  return notes;
}
```

Replace `renderBody` with:

```ts
/** Spec §8.3 body; LF line endings only. */
export function renderBody(input: DigestRenderInput): string {
  const d = input.digest;
  const lines = [`get-me-there alert for "${stripControl(input.definitionName)}"`, ''];
  d.items.forEach((item, i) => {
    lines.push(...itemLines(i + 1, item, input), '');
  });
  if (d.restCount > 0) lines.push(`and ${d.restCount} more`, '');
  if (d.newItems.length > 0) {
    lines.push('New since the last check (no earlier price to compare; not a drop):');
    for (const item of d.newItems) {
      const notes = notesOf(item, input);
      lines.push(
        `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${notes.length > 0 ? ` · ${notes.join('; ')}` : ''}`,
      );
    }
    if (d.newRestCount > 0) lines.push(`and ${d.newRestCount} more new cells`);
    lines.push('');
  }
  if (input.unconfirmedLeftOut > 0) {
    const n = input.unconfirmedLeftOut;
    lines.push(
      `Not alerted: ${n} ${n === 1 ? 'fare' : 'fares'} of this run whose price was not confirmed by the final step.`,
    );
  }
  if (input.budgetUnsearched > 0) {
    const n = input.budgetUnsearched;
    lines.push(
      `Not searched: a budget cap left ${n} cell ${n === 1 ? 'search' : 'searches'} of this run undone; the prices above come from the cells that were searched.`,
    );
  }
  lines.push(coverageText(d.coverageCaveat), `Rule: ${ruleText(d.rule)}`);
  return lines.join('\n');
}
```

Seven edits to `runner.ts`. The calendar threshold mirrors WP8's `calendarThreshold` (§13 item 3); "superseded by a later search" cannot arise here, as `notSeenMark`'s doc comment says.

In `runner.ts`, the `@gmt/core` import becomes:

```ts
import {
  type AlertCandidate,
  type AlertRule,
  buildDigest,
  type CalendarCandidate,
  type Cell,
  cellKeyString,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type DefinitionSnapshot,
  daysBetween,
  effectiveAge,
  evaluateAlertRules,
  evaluateConstraints,
  type Firing,
  type IsoDateTime,
  identityKey,
  isoDateTimeOfEpochMs,
  isTruncated,
  type Logger,
  type Notifier,
  type Provenance,
  type ProviderId,
  type ResultBasis,
  resultRowKey,
  type SearchDefinition,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
  worstCaseAgeHours,
} from '@gmt/core';
```

and the templates import becomes:

```ts
import { cellLine, type ItemMarks, NO_MARKS, renderBody, renderSubject } from './templates.js';
```

Replace `runRule` with:

```ts
async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const pool = poolFor(ctx, rule.basis);
  const recorded = recordedRows(ctx, rule, pool);
  const candidates = pool.candidates.filter((c) => !recorded.has(rowRef(c)));
  if (candidates.length === 0) return NONE;
  // why: spec §6.8 suppression looks back cooldownHours over this rule's sent firings for these identities.
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
  // why: plan pin — evaluateAlertRules returns suppressed firings too; the runner records them and the digest excludes
  // them. A "new" firing (spec §6.8 absent-then-present) is listed in the digest and never recorded as an event.
  const suppressed = firings.filter((f) => f.suppressed !== null);
  const fired = firings.filter((f) => f.suppressed === null && !f.isNew);
  const marks = marksFor(ctx, firings);
  ctx.deps.db.transaction(() => {
    for (const f of suppressed)
      ctx.deps.repos.alerts.insertEvent(
        eventRow(ctx, f, 'suppressed', f.suppressed?.reason ?? null, null, marks),
      );
  });
  if (fired.length === 0) return { digests: 0, events: suppressed.length };
  const delivered = await deliver(ctx, rule, { firings, fired, pool, marks });
  return { digests: delivered.digests, events: delivered.events + suppressed.length };
}
```

Add after `coverageFor`:

```ts
/** Cell searches a budget cap left undone in this run (spec §8.1 error table; decision 25 runs alerts on paused_budget). */
function budgetUnsearched(ctx: RunContext): number {
  return ctx.deps.repos.cells
    .outcomes(ctx.executionId)
    .filter((o) => o.status === 'not_run' || (o.status === 'skipped' && o.reason === 'budget')).length;
}

/** The calendar stale threshold (spec §8.1): CALENDAR_STALE_AFTER_HOURS, else the refresh plus the provider's declared age. */
function calendarStaleHours(ctx: RunContext, providerId: ProviderId): number {
  const configured = ctx.deps.config.calendarStaleAfterHours;
  if (configured !== null) return configured;
  const refresh = ctx.snapshot.providers.discoveryRefreshHours[providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
  const declared = ctx.deps.providers.find((p) => p.id === providerId)?.discovery?.info.maxAgeHours ?? 0;
  return refresh + (declared === 'unknown' ? 0 : declared);
}

/**
 * Decision 54: stale when the effective age (observed age, else fetch age plus a known maxAgeHours) exceeds the basis
 * threshold. An unknown vendor age is never stale on that account (spec §3 rev 23); the template labels it instead.
 */
function staleMark(ctx: RunContext, c: AlertCandidate): ItemMarks['stale'] {
  const p = c.basis === 'verified' ? c.observation.provenance : c.provenance;
  const threshold =
    c.basis === 'verified' ? ctx.deps.config.staleAfterHours : calendarStaleHours(ctx, p.providerId);
  const age = worstCaseAgeHours(effectiveAge(p, ctx.now));
  return age !== 'unknown' && age > threshold ? { thresholdHours: threshold } : null;
}
```

Add after `cellOf`:

```ts
/**
 * Spec §8.1 "not seen in latest search" (decision 54): the cell's newest priced|empty itinerary search is another
 * execution's (a child that verified the cell during this run) and that search has no observation of this offer.
 * why: "superseded by a later search" cannot arise here — calendar candidates are this execution's own fetches, only
 * one parent runs per definition, children never discover, and the step runs before this execution's status is
 * written, so no newer discovery of the cell exists yet.
 */
function notSeenMark(ctx: RunContext, c: VerifiedCandidate): ItemMarks['notSeenInLatest'] {
  const latest = ctx.deps.repos.itineraries.latestVerificationOutcomeForCell(
    ctx.definition.id,
    cellOf(c),
    ctx.snapshot.cabin,
  );
  if (latest === null || latest.executionId === ctx.executionId) return null;
  const seen = ctx.deps.repos.itineraries
    .writtenBy(latest.executionId)
    .some((o) => o.offerId === c.observation.offerId);
  if (seen) return null;
  const at = latest.fetchedAt ?? ctx.now;
  return { ageHours: effectiveAge({ fetchedAt: at, maxAgeHours: 'unknown' }, ctx.now).fetchedHours };
}

/** The DigestItem rowKey core gives a candidate (resultRowKey): the itinerary hash, or `calendar:<id>`. */
function rowKeyOf(c: AlertCandidate): string {
  return resultRowKey({
    itineraryHash: c.basis === 'verified' ? c.itinerary.hash : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
  });
}

/** Marks for every firing, keyed by rowKeyOf: the digest renders them and every event row stores them. */
function marksFor(ctx: RunContext, firings: Firing[]): Map<string, ItemMarks> {
  const truncated = new Set(
    ctx.deps.repos.cells
      .outcomes(ctx.executionId, { stage: 'discovery' })
      .filter((o) => isTruncated(o.lastError))
      .map((o) => `${o.providerId}|${cellKeyString(o)}`),
  );
  const out = new Map<string, ItemMarks>();
  for (const { candidate: c } of firings) {
    out.set(rowKeyOf(c), {
      stale: staleMark(ctx, c),
      truncated:
        c.basis === 'calendar' && truncated.has(`${c.provenance.providerId}|${cellKeyString(c.cell)}`),
      notSeenInLatest: c.basis === 'verified' ? notSeenMark(ctx, c) : null,
    });
  }
  return out;
}
```

Replace `deliver` (with its doc comment) with:

```ts
/**
 * Builds, renders and sends one digest, then writes one event per fired firing in one transaction.
 * why: spec §8.1 lists "persist events → notify digests"; the event's status is the delivery outcome, so the rows are
 * written once the notifiers have answered, in one transaction, before the step returns.
 */
async function deliver(
  ctx: RunContext,
  rule: AlertRule,
  run: { firings: Firing[]; fired: Firing[]; pool: Pool; marks: ReadonlyMap<string, ItemMarks> },
): Promise<AlertRunResult> {
  const digest = buildDigest(rule, run.firings, {
    executionId: ctx.executionId,
    definitionId: ctx.definition.id,
    coverageCaveat: coverageFor(ctx),
  });
  const first = digest?.items[0];
  // why: plan decision 10 — a digest with only "new" items and no firing is not sent.
  if (digest === null || first === undefined) return NONE;
  const subject = renderSubject(first, ctx.now);
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
    marks: run.marks,
    budgetUnsearched: budgetUnsearched(ctx),
    unconfirmedLeftOut: run.pool.unconfirmed,
  });
  const outcome = await sendToAll(ctx.deps.notifiers, { kind: 'digest', digest, subject, body });
  const digestId = randomUUID();
  ctx.deps.db.transaction(() => {
    for (const f of run.fired) {
      const reason = outcome.status === 'sent' ? f.reason : `${f.reason}; not delivered: ${outcome.detail}`;
      ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, outcome.status, reason, digestId, run.marks));
    }
  });
  return { digests: 1, events: run.fired.length };
}
```

Replace `eventRow` (with its doc comment) with:

```ts
/**
 * One alert_events row. The payload carries what the Alerts view shows: the price with its provenance and marks, so
 * the view prints it through WP9's PriceCell (decision 52), and the cell in words.
 */
function eventRow(
  ctx: RunContext,
  f: Firing,
  status: 'sent' | 'failed' | 'suppressed',
  reason: string | null,
  digestId: string | null,
  marks: ReadonlyMap<string, ItemMarks>,
) {
  const c = f.candidate;
  const m = marks.get(rowKeyOf(c)) ?? NO_MARKS;
  return {
    ruleId: f.rule.id,
    identityKey: f.identityKey,
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
    dedupKey: f.dedupKey,
    firedAt: ctx.now,
    status,
    reason,
    payload: {
      digestId,
      executionId: ctx.executionId,
      pricePence: c.basis === 'verified' ? c.observation.pricePence : c.pricePence,
      provenance: c.basis === 'verified' ? c.observation.provenance : c.provenance,
      previousPence: c.previous?.pricePence ?? null,
      isNew: f.isNew,
      route: cellLine(cellOf(c)),
      stale: m.stale !== null,
      truncated: m.truncated,
      notSeenInLatestHours: m.notSeenInLatest?.ageHours ?? null,
    },
  };
}
```

In `packages/engine/src/index.ts`, add `type ItemMarks` and `NO_MARKS` to the templates export:

```ts
export {
  appRowLink,
  type DigestRenderInput,
  type ItemMarks,
  NO_MARKS,
  renderBody,
  renderSubject,
  routeLine,
  sourceLabel,
  stripControl,
} from './alerts/templates.js';
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`, then `pnpm --filter @gmt/engine typecheck`. Expected: PASS, 41 tests; typecheck clean.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: digest and events carry staleness by effective age, unknown vendor age, truncation, not-seen-in-latest, budget stops and the unconfirmed count"`

### Task 11.8: The engine's alerts step runs runAlerts (layer A, completed and paused_budget); bootstrap wiring

**Files:**
- Modify WP8's `apps/api/src/bootstrap/app.ts` (one statement in `bootApp`).
- Test `packages/engine/test/alerts/engine.alerts.test.ts`.

**Interfaces:**
- **Consumes:** `createEngine(deps, { alerts })` through the harness's `orch(options)`, `AlertsStepHook`, WP7's `createHarness`, `withVerification`, `FIXTURE_COST_MICRO_GBP`.
- **Produces:** `bootApp` passes `{ alerts: runAlerts }`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/engine.alerts.test.ts`. The second test is WP7's provider-month breach scenario (its `budget-breach.test.ts`) with the real runner as the hook.

```ts
import { describe, expect, it, vi } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import type { AlertsStepHook } from '../../src/index.js';
import { createHarness, FIXTURE_COST_MICRO_GBP, type Harness, withVerification } from '../support/harness.js';

const calendarRule = (h: Harness, definitionId: string) =>
  h.repos.alerts.create({
    definitionId,
    type: 'absolute',
    thresholdPence: 99_999_999,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });
const refusals = (h: Harness) =>
  h.logs.filter((l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused');

describe('the §8.1 alerts step runs the alert runner (layer A)', () => {
  it('runAlerts is an AlertsStepHook, called once per completed pass with the engine deps', async () => {
    const h = createHarness();
    const hook = vi.fn<AlertsStepHook>(runAlerts);
    const def = h.createDefinition();
    calendarRule(h, def.id);
    const execution = await h.runToCompletion(h.orch({ ...h.options, alerts: hook }), def.id);
    expect(execution.status).toBe('completed');
    expect(hook).toHaveBeenCalledExactlyOnceWith(h.deps, execution.id);
    await expect(hook.mock.results[0]?.value).resolves.toEqual({ digests: 0, events: 0 });
    // the fixture provider's rows are synthetic: refused, so nothing is recorded or sent (spec §5.5)
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
    expect(hook).toHaveBeenCalledExactlyOnceWith(h.deps, e.id);
    expect(refusals(h).length).toBeGreaterThan(0);
    expect(h.digests).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine typecheck`. Expected: PASS, because WP7 already exports `AlertsStepHook` and calls the hook on completed and paused_budget passes; this test pins that contract with the real runner rather than a stub. To see it bite, replace `runAlerts` with `noAlerts` in the first test and run `pnpm --filter @gmt/engine exec vitest run test/alerts/engine.alerts.test.ts`: FAIL with `expected 0 to be greater than 0` on the refusal count; restore it.

- [ ] **Step 3: Implement.** In WP8's `apps/api/src/bootstrap/app.ts`, in `bootApp`, replace the statement and its why line:

```ts
    // why: WP11 adds `{ alerts: runAlerts }` to these options; until then the engine's default noAlerts step runs.
    const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
```

with:

```ts
    // why: spec §8.1 — the alerts step runs WP11's runner after every completed or budget-paused pass (decision 25).
    const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] }, { alerts: runAlerts });
```

and add `runAlerts` to that file's `@gmt/engine` import.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/engine.alerts.test.ts`, then `pnpm --filter @gmt/api test`. Expected: PASS, 2 tests; the api suite stays green.

- [ ] **Step 5: Commit.** `git add packages/engine apps/api && git commit -m "wp11: engine alerts step wired to runAlerts (spec §8.1)"`

### Task 11.9: EmailNotifier over nodemailer, notifier wiring

**Files:**
- Create `packages/engine/src/notifiers/email.ts` and `packages/engine/src/notifiers/index.ts`.
- Modify `packages/engine/src/index.ts` and WP8's `apps/api/src/bootstrap/app.ts`.
- Test `packages/engine/test/notifiers/email.test.ts`.

**Interfaces:** Consumes `Secret`, `scrubSecrets`, `stripUrlsInText`, `containsSynthetic` (WP7, `notifiers/log.ts`), `controlFree`, `stripControl`. Produces `EmailNotifier`, `smtpTransportOptions`, `buildNotifiers` and the types of §5.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/notifiers/email.test.ts`:

```ts
import { type OperatorMessage, Secret } from '@gmt/core';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { renderBody, renderSubject } from '../../src/alerts/templates.js';
import {
  EmailNotifier,
  type MailMessage,
  type SmtpConfig,
  type SmtpTransportOptions,
  smtpTransportOptions,
  type TransportFactory,
} from '../../src/notifiers/email.js';
import { buildNotifiers } from '../../src/notifiers/index.js';
import { calendarItem, digestOf, HASH, NOW, renderInput, verifiedItem } from '../alerts/builders.js';
import { captureLogger } from '../alerts/fixtures.js';

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
/** nodemailer's jsonTransport message (info.message), parsed rather than cast. */
const jsonMessage = z.object({ subject: z.string(), text: z.string(), html: z.unknown().optional() });

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

describe('SMTP_TLS → transport options (spec §8.3)', () => {
  it('implicit → secure; starttls → requireTLS; none only on loopback or dev Mailpit', () => {
    expect(smtpTransportOptions(smtp(), 'production')).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'alerts', pass: PASS },
    });
    expect(smtpTransportOptions(smtp({ tls: 'starttls', port: 587 }), 'production')).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'alerts', pass: PASS },
    });
    expect(
      smtpTransportOptions(smtp({ tls: 'none', host: '127.0.0.1', port: 1025 }), 'production'),
    ).toMatchObject({ secure: false, ignoreTLS: true });
    expect(
      smtpTransportOptions(smtp({ tls: 'none', host: 'mailpit', port: 1025 }), 'development'),
    ).toMatchObject({ secure: false, ignoreTLS: true });
    expect(() => smtpTransportOptions(smtp({ tls: 'none', host: 'mailpit' }), 'production')).toThrow(
      /SMTP_TLS=none/,
    );
    expect(() => smtpTransportOptions(smtp({ tls: 'none' }), 'production')).toThrow(/SMTP_TLS=none/);
  });
});

describe('EmailNotifier with a jsonTransport (spec §8.3)', () => {
  it('envelope, subject and a plain-text body with provenance, coverage caveat and a validated link', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      createTransport: t.factory,
    });
    expect(await n.send(digestMessage())).toEqual({ ok: true });
    expect(t.options[0]).toMatchObject({ secure: true });
    const [m] = t.messages;
    expect(m?.envelope).toEqual({ from: 'get-me-there@example.com', to: ['operator@example.com'] });
    expect(m?.parsed.subject).toBe(
      '[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · provider age unknown · 1 constraint unverified',
    );
    expect(m?.parsed.html).toBeUndefined();
    expect(m?.parsed.text).toContain(
      '   Provenance: Google Flights via SearchApi · fetched 5h ago · provider age unknown',
    );
    expect(m?.parsed.text).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');
    expect(m?.parsed.text).toContain(
      '   Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
    );
  });

  it('a POST booking links to the app results row instead', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      createTransport: t.factory,
    });
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
    const t = jsonFactory();
    const n = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      createTransport: t.factory,
    });
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

  it('strips CR/LF from subjects and normalises body line endings, so an operator message cannot inject a header', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({
      smtp: smtp(),
      nodeEnv: 'production',
      log: captureLogger(),
      createTransport: t.factory,
    });
    const message: OperatorMessage = {
      kind: 'paused_error',
      executionId: 'ex-1',
      definitionId: 'def-1',
      subject: '[get-me-there] paused\r\nBcc: victim@example.com',
      body: 'line one\r\n   line two\u0007\rline three',
    };
    await n.send({ kind: 'operator', message });
    expect(t.messages[0]?.parsed.subject).toBe('[get-me-there] paused Bcc: victim@example.com');
    expect(t.messages[0]?.parsed.text).toBe('line one\n   line two \nline three');
  });

  it('a transport failure returns ok:false and the SMTP password reaches neither the detail nor the log', async () => {
    const log = captureLogger();
    const failing: TransportFactory = () => ({
      sendMail: async () => {
        throw new Error(
          `535 authentication failed for alerts:${PASS} at https://smtp.example.com/x?token=${PASS}`,
        );
      },
    });
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log, createTransport: failing });
    const r = await n.send(digestMessage());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('535 authentication failed');
    expect(r.detail).not.toContain(PASS);
    expect(JSON.stringify(log.lines)).not.toContain(PASS);
  });
});

describe('buildNotifiers', () => {
  it('log only without SMTP; log and email with it (creating a transporter opens no connection)', () => {
    expect(buildNotifiers({ smtp: null, nodeEnv: 'production' }, captureLogger()).map((n) => n.id)).toEqual([
      'log',
    ]);
    expect(buildNotifiers({ smtp: smtp(), nodeEnv: 'production' }, captureLogger()).map((n) => n.id)).toEqual(
      ['log', 'email'],
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts`. Expected: FAIL, because `../../src/notifiers/email.js` cannot be resolved.

- [ ] **Step 3: Implement.** The synthetic refusal is WP7's `containsSynthetic` with `LogNotifier`'s answer, so both notifiers refuse alike and the runner records a `failed` event; the body keeps its indentation (only line endings and controls are normalised); the error detail is scrubbed of the SMTP password and URL-stripped before it reaches a log line or an event reason.

`packages/engine/src/notifiers/email.ts`:

```ts
/**
 * EmailNotifier (spec §8.3): nodemailer SMTP, plain text only, SMTP_TLS mapped to transport options, subjects
 * CR/LF-stripped, synthetic rows refused before anything is sent, the SMTP password scrubbed from every error.
 */
import { type Config, type Logger, type Notifier, stripUrlsInText } from '@gmt/core';
import { scrubSecrets } from '@gmt/providers';
import nodemailer from 'nodemailer';
import { controlFree, stripControl } from '../alerts/templates.js';
import { containsSynthetic } from './log.js';

export type SmtpConfig = NonNullable<Config['smtp']>;
/** The subset of nodemailer SMTP options this app sets. */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth: { user: string; pass: string };
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

// why: repeats the config schema's rule (WP0) as defence in depth, so a hand-built config cannot send in clear text off-box.
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i;

/** SMTP_TLS → nodemailer options: implicit = TLS from connect; starttls = mandatory upgrade; none = loopback or dev Mailpit only. */
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions {
  const base = { host: smtp.host, port: smtp.port, auth: { user: smtp.user, pass: smtp.pass.reveal() } };
  switch (smtp.tls) {
    case 'implicit':
      return { ...base, secure: true };
    case 'starttls':
      return { ...base, secure: false, requireTLS: true };
    case 'none':
      if (!(LOOPBACK.test(smtp.host) || (smtp.host === 'mailpit' && nodeEnv === 'development'))) {
        throw new Error(
          `SMTP_TLS=none is permitted only for a loopback host or the dev Mailpit profile; host ${smtp.host} refused (spec §8.3)`,
        );
      }
      return { ...base, secure: false, ignoreTLS: true };
  }
}

const defaultFactory: TransportFactory = (o) => nodemailer.createTransport(o);

/** A plain-text body: LF line endings, every other control character a space, indentation kept. */
function plainText(body: string): string {
  return body
    .split(/\r\n|\r|\n/)
    .map(controlFree)
    .join('\n');
}

/** Sends alert digests and operator messages as plain-text email. Spec §8.3. */
export class EmailNotifier implements Notifier {
  readonly id = 'email';
  readonly #transport: MailTransport;
  readonly #smtp: SmtpConfig;
  readonly #log: Logger;

  constructor(opts: {
    smtp: SmtpConfig;
    nodeEnv: Config['nodeEnv'];
    log: Logger;
    createTransport?: TransportFactory;
  }) {
    this.#smtp = opts.smtp;
    this.#log = opts.log.child({ notifier: 'email' });
    this.#transport = (opts.createTransport ?? defaultFactory)(smtpTransportOptions(opts.smtp, opts.nodeEnv));
  }

  async send(msg: Parameters<Notifier['send']>[0]): Promise<{ ok: boolean; detail?: string }> {
    // why: spec §5.5 — notifiers refuse synthetic rows; the same check and answer as WP7's LogNotifier.
    if (containsSynthetic(msg))
      return { ok: false, detail: 'synthetic data is never delivered by a notifier' };
    const subject = msg.kind === 'digest' ? msg.subject : msg.message.subject;
    const body = msg.kind === 'digest' ? msg.body : msg.message.body;
    const mail: MailMessage = {
      from: this.#smtp.from,
      to: this.#smtp.to,
      subject: stripControl(subject),
      text: plainText(body),
    };
    try {
      const info = await this.#transport.sendMail(mail);
      this.#log.info({ messageId: info.messageId }, 'email sent');
      return { ok: true };
    } catch (err) {
      // why: spec §5.3 — the password never reaches a log line or an event reason, and no URL keeps its query there.
      const detail = stripUrlsInText(
        scrubSecrets(err instanceof Error ? err.message : String(err), [this.#smtp.pass]),
      );
      this.#log.warn({ detail }, 'email not sent');
      return { ok: false, detail };
    }
  }
}
```

`packages/engine/src/notifiers/index.ts`:

```ts
/** The notifier list for EngineDeps: the log always, email when SMTP is configured. Spec §8.3. */
import type { Config, Logger, Notifier } from '@gmt/core';
import { EmailNotifier } from './email.js';
import { LogNotifier } from './log.js';

export function buildNotifiers(config: Pick<Config, 'smtp' | 'nodeEnv'>, log: Logger): Notifier[] {
  const notifiers: Notifier[] = [new LogNotifier(log)];
  if (config.smtp !== null)
    notifiers.push(new EmailNotifier({ smtp: config.smtp, nodeEnv: config.nodeEnv, log }));
  return notifiers;
}
```

In `packages/engine/src/index.ts`, add after the `fxHttpLimits` export:

```ts
export {
  EmailNotifier,
  type MailMessage,
  type MailTransport,
  type SmtpConfig,
  type SmtpTransportOptions,
  smtpTransportOptions,
  type TransportFactory,
} from './notifiers/email.js';
export { buildNotifiers } from './notifiers/index.js';
```

In WP8's `apps/api/src/bootstrap/app.ts`, replace the Task 11.8 statement with:

```ts
    // why: spec §8.3 — the log notifier always, email when SMTP_* is configured; the alerts step runs WP11's runner.
    const engine = createEngine(
      { ...ports, notifiers: buildNotifiers(ports.config, log) },
      { alerts: runAlerts },
    );
```

Import `buildNotifiers` from `@gmt/engine`, and drop `LogNotifier` from that import if nothing else in the file uses it.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts`, which should PASS with 7 tests. Then run `pnpm --filter @gmt/api test`, which should PASS: WP4b's `collectSecrets` already scrubs `SMTP_PASS` from every log line, and WP8's sentinel test covers it.

- [ ] **Step 5: Commit.** `git add packages/engine apps/api && git commit -m "wp11: EmailNotifier over nodemailer with SMTP_TLS mapping, synthetic refusal and scrubbed errors"`

### Task 11.10: Alerts view: rule form and rules list

**Files:**
- Create `apps/web/src/views/Alerts/RuleForm.tsx`, `ruleText.ts`, `AlertsView.tsx`, `index.ts`.
- Modify WP9's `apps/web/src/api/types.ts`, `src/api/endpoints.ts`, `src/copy.ts`, `src/App.tsx`, `test/msw/handlers.ts`, `test/guards.ts`, `test/copy/catalogue.test.ts`, `test/app/shell.test.tsx`.
- Test `apps/web/test/views/Alerts/RuleForm.test.tsx`.

**Interfaces:**
- **Consumes:** `apiContract.alertRuleInputSchema`, `alertRuleSchema`, `alertEventSchema`, `AlertRule`, WP9's `call`, `api`, `COPY` (`loading`, `fieldError`), `parsePoundsToPence`, `formatPence` (through `format.ts`), `renderWithProviders`, `server`, `API`.
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

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx`. Expected: FAIL, because `../../../src/views/Alerts/index.js` cannot be resolved and `COPY.alertsView` is undefined.

- [ ] **Step 3: Implement.**

In `apps/web/src/copy.ts`, add this entry to `COPY` (the "£" in the threshold label is a form label, which the sweep allows; "verified" sits beside class names only):

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
    colReason: 'Reason',
    status: { sent: 'sent', failed: 'failed', suppressed: 'suppressed' },
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
/** One line per alert rule in the email's "Rule:" words (spec §6.8), built from catalogue strings only. */
import type { AlertRule } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';

const C = COPY.alertsView;

/** "Price at or below £450 · Calendar basis (constraints not checked) · cooldown 336h". */
export function describeRule(r: AlertRule): string {
  const what =
    r.type === 'absolute'
      ? `${C.typeAbsolute} ${formatPence(r.thresholdPence ?? 0)}`
      : r.type === 'dropAbs'
        ? `${C.typeDropAbs} ${formatPence(r.thresholdPence ?? 0)}`
        : `${C.typeDropPct} ${r.pct ?? 0}%`;
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
                {/* why: the threshold is an operator-entered cap, not a fare; WP9's sweep allows "£" inside [data-cost] */}
                <span data-cost>{describeRule(r)}</span>
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

In `apps/web/src/App.tsx`: add `view === 'alerts'` to the `needsDefinition` disjunction; replace `{view === 'alerts' ? <Placeholder /> : null}` with `{view === 'alerts' && selected !== null ? <AlertsView definitionId={selected.id} /> : null}`; add `import { AlertsView } from './views/Alerts/index.js';` and drop the `Placeholder` import if nothing else in the file uses it.

In `apps/web/test/msw/handlers.ts`, add to `handlers` (the default API answers no rules and no events):

```ts
  http.get(url('/api/alerts'), () => HttpResponse.json([])),
  http.get(url('/api/alerts/events'), () => HttpResponse.json([])),
```

In `apps/web/test/guards.ts`, add `'src/views/Alerts/ruleText.ts'` to `MONEY_FILES`, with the why line `// why: a rule's threshold is an operator-entered cap, rendered inside [data-cost], never a fare (WP11).`

In `apps/web/test/copy/catalogue.test.ts`, add `'alertsView.notSaved': ['database is locked']` and `'alertsView.cooldownText': [336]` to `SAMPLES`, and `'alertsView.basisVerified'` and `'alertsView.requireAll'` to the `allowed` set of the "verified" test (both name the class).

In `apps/web/test/app/shell.test.tsx`, replace the `it.each(['alerts'])('%s is a placeholder that names no work package', …)` test with:

```tsx
  it('alerts renders the Alerts view for the selected definition; no placeholder is left', async () => {
    renderWithProviders(<App />, { search: '?view=alerts&def=def-0001' });
    expect(await screen.findByRole('heading', { name: COPY.alertsView.heading })).toBeInTheDocument();
    expect(screen.queryByText(COPY.placeholder)).toBeNull();
  });
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx`, which should PASS with 4 tests. Then run `pnpm --filter @gmt/web test`; the catalogue, source-guard, rendered-sweep and shell tests stay green.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "wp11: Alerts view rule form validated by alertRuleInputSchema"`

### Task 11.11: Alerts view: events list with prices through PriceCell; banned words

**Files:** Create `apps/web/src/views/Alerts/EventsTable.tsx`. Modify `apps/web/src/views/Alerts/AlertsView.tsx`. Test `apps/web/test/views/Alerts/AlertsView.test.tsx`.

**Interfaces:** Consumes `PriceCell`, `PriceBoundary`, `formatRunInstant`, the event payload of §5, `provCalendar`, `provSearch`.

- [ ] **Step 1: Write the failing test** in `apps/web/test/views/Alerts/AlertsView.test.tsx`:

```tsx
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
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
    requireAllVerified: true,
    cooldownHours: 336,
    enabled: true,
  },
] as const;
const payload = (pricePence: number, provenance: unknown, extra: object = {}) => ({
  digestId: 'd1',
  executionId: 'ex-1',
  pricePence,
  provenance,
  previousPence: null,
  isNew: false,
  route: 'LHR→JFK 14 Mar–28 Mar (14n)',
  stale: false,
  truncated: false,
  notSeenInLatestHours: null,
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
    status: 'sent',
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
    status: 'failed',
    reason: 'down £56 (11%) from £468 fetched 7d (168h) earlier; not delivered: email: connection refused',
    payload: payload(41200, provSearch),
  },
  {
    id: 4,
    ruleId: 'other-definition-rule',
    identityKey: 'z',
    observationId: null,
    calendarPriceId: 7,
    dedupKey: 'z|1',
    firedAt: '2026-10-21T05:11:00.000Z',
    status: 'sent',
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

describe('Alerts events list (spec §11)', () => {
  it("shows this definition's events: status in words, the trip, the price through PriceCell, the reason", async () => {
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
    expect(within(second).getByText(C.status.suppressed)).toBeInTheDocument();
    expect(
      within(second).getByText('same price band alerted 7d (168h) ago; cooldown 2w (336h)'),
    ).toBeInTheDocument();
    expect(within(third).getByText(C.status.failed)).toBeInTheDocument();
    expect(screen.queryByText('not this definition')).toBeNull();
  });

  it('a payload of another shape shows "not recorded" and no price', async () => {
    const [sent] = events;
    if (sent === undefined) throw new Error('events');
    withData(rules, [{ ...sent, payload: { label: 'old shape' } }]);
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    expect(within(table).getAllByText(C.notRecorded)).toHaveLength(2);
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

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/AlertsView.test.tsx`. Expected: FAIL with `Unable to find role="table" and name "Alert events"`.

- [ ] **Step 3: Implement.**

`apps/web/src/views/Alerts/EventsTable.tsx`:

```tsx
/** Alert events (spec §11): when, which rule, status in words, the trip, its price with provenance, and the reason. */
import type { AlertEvent } from '@gmt/core';
import { z } from 'zod';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatRunInstant } from '../../format.js';

const C = COPY.alertsView;

/**
 * The runner's event payload (WP11 Task 11.7), parsed rather than cast; PriceCell validates the provenance itself
 * (decision 52: every fare through PriceCell). A payload of another shape parses to null and shows "not recorded".
 */
const payloadSchema = z.object({
  pricePence: z.number().int(),
  provenance: z.unknown(),
  route: z.string(),
  stale: z.boolean(),
  truncated: z.boolean(),
  notSeenInLatestHours: z.number().int().nullable(),
});

function payloadOf(e: AlertEvent): z.output<typeof payloadSchema> | null {
  const p = payloadSchema.safeParse(e.payload);
  return p.success ? p.data : null;
}

export function EventsTable(props: { events: readonly AlertEvent[]; ruleText: ReadonlyMap<string, string> }) {
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
          <th scope="col">{C.colReason}</th>
        </tr>
      </thead>
      <tbody>
        {props.events.map((e) => {
          const p = payloadOf(e);
          return (
            <tr key={e.id}>
              <td>
                <time dateTime={e.firedAt}>{formatRunInstant(e.firedAt)}</time>
              </td>
              <td>
                {/* why: a rule's threshold is an operator-entered cap (§13 item 8) */}
                <span data-cost>{props.ruleText.get(e.ruleId) ?? e.ruleId}</span>
              </td>
              <td>{C.status[e.status]}</td>
              <td>{p === null ? C.notRecorded : p.route}</td>
              <td>
                {p === null ? (
                  C.notRecorded
                ) : (
                  <PriceBoundary>
                    <PriceCell
                      pricePence={p.pricePence}
                      provenance={p.provenance}
                      calendar={e.calendarPriceId !== null}
                      stale={p.stale}
                      truncated={p.truncated}
                      notSeenInLatestHours={p.notSeenInLatestHours}
                    />
                  </PriceBoundary>
                )}
              </td>
              <td>
                {/* why: spec §6.8 reason text quotes the prices the rule judged; the fare itself is the PriceCell */}
                <span data-cost>{e.reason ?? C.noReason}</span>
              </td>
            </tr>
          );
        })}
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
                {/* why: the threshold is an operator-entered cap, not a fare; WP9's sweep allows "£" inside [data-cost] */}
                <span data-cost>{ruleText.get(r.id)}</span>
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

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/web test`. Expected: PASS, with the web thresholds (70% lines, 60% branches) met and WP9's guards green.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "wp11: Alerts events list with prices through PriceCell, status and reason; banned-word test over the view"`

## 9. Pinned review-focus tests

WP11 owns none of the plan's Review Focus lines. The spec requirements this package carries, and where each is pinned:

| Requirement | Test |
|---|---|
| §9 item 4: 50 qualifying cells → one email | Task 11.1, "50 qualifying calendar cells…" |
| §6.8: calendar reused rows, other executions and other cabins excluded | Task 11.1 |
| §8.3: subject formats, provenance line, link with host and expiry, POST → app row, coverage caveat | Task 11.2; Task 11.9 through nodemailer |
| §5.2, decision 54: a stored booking link re-validated at render | Task 11.2, "a link that fails re-validation → no link" |
| §8.3: CRLF and control characters in provider strings | Task 11.2; Task 11.9 (subject and body) |
| §8.3, §11: banned words over rendered email | Tasks 11.2 and 11.7 |
| §6.8: verified candidates from the current execution only; requireAllVerified; drop vs previous observation | Task 11.3 |
| Decisions 27, 37, 45: an unconfirmed price never fires; labelled and counted | Task 11.3; Tasks 11.2 and 11.7 |
| §6.8: drop window 167/168/169 h; absent-then-present is "new" | Task 11.4 |
| §9 item 4: dedup across executions, both bases, with reason; failed sends do not suppress | Task 11.5 |
| Decision 25: a later pass never repeats a firing | Task 11.5 |
| §9 item 4: synthetic refused by alerts | Task 11.6; Task 11.8 (layer A) |
| §3 rev 23, decision 54: stale by effective age; unknown vendor age labelled, never stale | Task 11.7 |
| Decisions 30, 36: "cheapest of the rows read" | Task 11.7 |
| §8.1, decision 54: "not seen in latest search" | Task 11.7 |
| Decision 25: alerts run on paused_budget; budget stops counted | Tasks 11.7 and 11.8 |
| §9 item 4: synthetic refused by notifiers | Task 11.9 |
| §5.3, §14: SMTP password never in a log line or error detail | Task 11.9 |
| §9 item 6, decision 52: banned words over the Alerts view; every fare through PriceCell | Task 11.11 (plus WP9's catalogue, source guard and rendered sweep over `COPY.alertsView` and the view) |

## 10. Definition of done

- `pnpm --filter @gmt/engine test` passes with coverage ≥ 85% lines and ≥ 70% branches (assembled: 35 files, 331 tests; `src/alerts` 99.6% lines, 89% branches; `src/notifiers/email.ts` 100% lines).
- `pnpm --filter @gmt/api test` passes.
- `pnpm --filter @gmt/web test` passes with coverage ≥ 70% lines and ≥ 60% branches; WP9's catalogue, source-guard and rendered-sweep tests and WP10's wiring test stay green.
- `pnpm -r test` passes.
- `pnpm lint` reports no diagnostics.
- `pnpm -r typecheck` reports no errors.
- `pnpm boundaries` exits 0: no `biome-ignore`, `eslint-disable` or `@ts-*` suppression anywhere (decision 49), and no airport literal in `apps/web/src` outside `example.ts`.
- `pnpm casts` reports 0 casts (decisions 45, 48): payloads and nodemailer's JSON are parsed with zod; select values are narrowed by lookup.
- `grep -rn "process.env" packages/engine/src apps/web/src` prints nothing.
- `grep -rnE "\b(LHR|LGW|JFK|EWR|LON|NYC)\b" packages/engine/src apps/web/src/views/Alerts` prints nothing (route-agnostic: the templates' doc examples use `AAA→BBB`; tests use the worked example).

## 11. Open questions

None requires the operator's judgment. The coordination items for the plan owner and other briefs are collected in §13.

## 12. Changes outside WP11's own files

- `packages/engine/src/index.ts` (Tasks 11.1, 11.7, 11.9): the runner, template and notifier exports.
- WP8's `apps/api/src/bootstrap/app.ts` (Tasks 11.8, 11.9): the one `createEngine` statement in `bootApp`.
- WP9's `apps/web/src/api/types.ts`, `src/api/endpoints.ts`, `src/copy.ts`, `src/App.tsx`, `test/msw/handlers.ts`, `test/guards.ts`, `test/copy/catalogue.test.ts`, `test/app/shell.test.tsx` (Task 11.10): the alert wrappers and body type, `COPY.alertsView`, the mount, default handlers, `ruleText.ts` in `MONEY_FILES`, SAMPLES and the "verified" allowlist, and the shell test that no longer expects a placeholder.

## 13. For the plan (not yet recorded there)

1. **Assembly.** On 2026-10-17 the engine and api parts were assembled on a detached scratch worktree of main at `bd56eb4` and replayed task by task (each task's tests run first against the previous task's code, then green; `tsc` and Biome after every task). WP8's `bootApp` is not on main, so a one-function stand-in holding the Task 11.9 statement was typechecked and linted in `apps/api/src/bootstrap/app.ts`. Results: `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries` and `pnpm casts` (0 casts) clean; `pnpm --filter @gmt/engine test` 331/331 with thresholds met; `pnpm --filter @gmt/api test` 195/195. The web tasks were not assembled: WP9 and WP10 are not on main.
2. **One digest per rule per execution, across passes.** Decision 25 runs the alerts step after a paused_budget pass and again after the resumed pass; a completed run resumed for retry-errors runs it twice too. The runner skips every row that already has an event of the rule, so no firing is ever repeated, but the later pass can send a second digest holding only prices the first pass had not seen. Spec §6.8 says "one digest per rule per execution"; the alternative (no digest from a later pass) would drop the cheapest fare a resumed run finds. The plan should record which reading holds; this brief implements the first.
3. **The calendar stale threshold is written twice.** `CALENDAR_STALE_AFTER_HOURS`, else the provider's refresh plus its declared `maxAgeHours`: WP8's `calendarThreshold` (apps/api) and this WP's `calendarStaleHours` (engine) implement the same rule, because neither package may import the other. A core helper (`calendarStaleAfterHours(config, refreshHours, declared)`) would make it one. Both use decision 54's effective age; WP8's refreshed brief still compares fetch age plus known age, which ignores an observed age.
4. **Marks `DigestItem` does not carry.** The runner passes "stale", "cheapest of the rows read" and "not seen in latest search" to the templates in `DigestRenderInput.marks` (keyed by `rowKey`), with the budget-stop and unconfirmed counts beside them, and stores the first three on every event's payload with the price, its provenance and the route, so the Alerts view prints the price through `PriceCell` (decision 52). The plan's Notifier contract lists neither the render input nor the payload shape (§5 here). "Superseded by a later search" (decision 54) cannot arise at alert time: calendar candidates are the execution's own fetches, one parent runs per definition, children never discover, and the step runs before the status write.
5. **Unconfirmed prices and requireAllVerified.** Core's `evaluateAlertRules` admits a partially-verified candidate whose only unverified constraint is `priceConfirmed` when `requireAllVerified` is false. This WP removes such candidates before evaluation and counts them in the digest ("Not alerted: N fares of this run whose price was not confirmed by the final step."), reading decisions 37 and 45 as "never alert on an unconfirmed price". If the plan prefers core to own the rule, `eligible()` in `alerts/evaluate.ts` is the place.
6. **Age wording.** Spec §8.3's itinerary-search subject example shows no age clause, but SearchApi itinerary prices carry `maxAgeHours: 'unknown'` (decision 24), so real subjects read "fetched 5h ago · provider age unknown" (core's `formatAgeFull`); spec §3 rev 23 names the label "vendor's cache age unknown", which the email adds as a note, as WP9's `PriceCell` does. One wording in core's `formatAgeFull` for the unknown case would settle both.
7. **The email's results-row link** uses WP9's URL parameters `view=results&def=<id>&basis=<basis>&row=<rowKey>`; the plan's Web section names only `row=`, and the old brief used `definition=`.
8. **Alerts view and WP9's "£" sweep.** Rule thresholds ("Price at or below £450") and event reasons ("down £80 (16%) from £500 …", spec §6.8's reason text) quote amounts that are not fares with provenance; the view renders them inside `[data-cost]`, which WP9's sweep allows for costs and caps, and adds `ruleText.ts` to `MONEY_FILES`. The plan names `[data-cost]` for costs and caps only; a ruling should say whether thresholds and reasons belong there or need their own marker.
9. **EmailNotifier refuses synthetic data by answering** `{ ok: false, detail: 'synthetic data is never delivered by a notifier' }`, WP7's `LogNotifier` behaviour, rather than throwing; the runner records the event as `failed`.
