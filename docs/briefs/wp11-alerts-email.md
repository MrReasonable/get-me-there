---
wp: 11
title: alerts runner, EmailNotifier, Alerts UI
owner: sonnet
depends_on: [7, 8, 10]
spec_sections: ["§6.8", "§8.1", "§8.3", "§10", "§11", "§9 item 4", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, product-owner, persona-flexible-traveller, security-reviewer]
status: draft
---

# WP11 — alerts runner, EmailNotifier, Alerts UI

## 1. Goal

Turn the prices an execution wrote into at most one plain-text email per alert rule per execution, deduplicated across executions, never from synthetic rows, and give the operator an Alerts view to manage rules and read what fired, what was suppressed and why.

## 2. Scope

**In**

- `packages/engine/src/alerts/runner.ts`: `runAlerts(deps, executionId)`, the engine side of spec §6.8: gathering candidates per basis from the current execution, previous prices for drops, suppression lookups, persisting `alert_events`, building one digest per rule, sending it to every notifier, and the "alerts running on calendar basis only" operator notification.
- `packages/engine/src/alerts/queries.ts`: four read queries the runner needs that the plan's `Database` contract lacks (section 4.3).
- `packages/engine/src/alerts/templates.ts`: `renderSubject`, `renderBody`, `stripControl`, `sourceLabel`, the spec §8.3 formats.
- `packages/engine/src/notifiers/email.ts`: `EmailNotifier` over nodemailer 10 and `smtpTransportOptions`; `packages/engine/src/notifiers/index.ts`: `buildNotifiers`.
- One-line changes: the orchestrator's alerts step (WP7) and the app bootstrap's notifier list (WP8).
- `apps/web/src/views/Alerts/*`: rule form, rules list, events table.

**Out**

- `evaluateAlertRules`, `dedupKey`, `isSuppressed`, `buildDigest`, `candidateRef`, the identity-key format and the threshold/drop arithmetic: `@gmt/core`, WP2.
- `alertRuleSchema`, `alertEventSchema`, `AlertDigest`, `OperatorMessage`, the `Notifier` port, `formatAgeFull`, `findBannedWords`: `@gmt/core`, WP0.
- `AlertsRepo`, `NotificationsRepo`, every table and migration: `@gmt/db`, WP3. This WP adds no column and no migration.
- `GET/POST/PUT/DELETE /alerts[/:id]`, `GET /alerts/events`: `apps/api`, WP8 (already mounted).
- `LogNotifier`, the orchestrator, the WP7 layer-A test harness: `@gmt/engine`, WP7.
- Navigation and the definition selector that mounts the Alerts view: `apps/web`, WP9.
- Mailpit service and its environment in compose: WP12.

## 3. Spec sections

- **§6.8** — rule shape and the default `cooldownHours` 336; verified-basis identity `(ruleId, itineraryHash)` over observations written by the current execution, `partially-verified` admitted only when `requireAllVerified` is false; drops compare an offer's latest observation with its previous one; calendar-basis identity `(ruleId, providerId, cabin, cellKey)` over calendar prices fetched by the current execution in the definition's cabin (reused rows excluded); calendar drops only against a previous price whose `fetchedAt` is within 2 × `discoveryRefreshHours`; absent-then-present goes in the digest's "new" section and is never a drop firing; `dedupKey` cooldown and the equal-or-lower-price rule; synthetic refused; one digest per rule per execution with top 10 and a count of the rest; "alerts running on calendar basis only" when verification is budget-skipped.
- **§8.1** — the `alerts: evaluateAlertRules → persist events → notify digests` step before `completed`; operator notifications deduplicated per execution and kind.
- **§8.3** — `EmailNotifier` with `SMTP_TLS = implicit | starttls | none` (`starttls` sets `requireTLS`; `none` only for Mailpit dev or loopback); plain text only; the two subject formats; body contents (segments or "calendar price, no itinerary", verdicts naming every unverified constraint, provenance line with effective age, validated `https` link with host and expiry state or, for POST bookings, a link to the app's results row, coverage caveat "itinerary-searched K of N cells, E outbounds each", the rule); provider strings CRLF/control-stripped; synthetic refused; the banned-word test over rendered output with word boundaries.
- **§10** — the alerts routes the view calls (mounted by WP8).
- **§11** — "Definitions / Alerts / Providers" forms: the Alerts view with rule type, threshold or pct, basis, `requireAllVerified` only on the verified basis, `cooldownHours` default 336, and the events list with status and reason; banned words; "verified" only beside class-verified values.
- **§9 item 4** — alert dedup across executions on both bases, digests, synthetic refused by alerts and notifiers.
- **§9 item 6** — the banned-word test over web strings, engine templates and API reason strings.

## 4. Interfaces consumed

### 4.1 From the plan's "Cross-package contracts" (verbatim)

```ts
// @gmt/core ports/provider.ts (spec §5.1)
export interface Notifier { id: string; send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> }

// @gmt/core ports/notifier.ts (plan Task 0.4)
AlertDigest = { ruleId: string; definitionId: string; executionId: string; basis: 'verified' | 'calendar'; subject: string; body: string; items: DigestItem[]; restCount: number }
OperatorMessage = { kind: 'paused_budget' | 'paused_error' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed' | 'interrupted' | 'provider_disabled' | 'parity_break' | 'alerts_calendar_only'; executionId: string | null; definitionId: string; subject: string; body: string }

// @gmt/core types
export interface Provenance { providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime; maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean };
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Observation { id: number; offerId: number; executionId: string; provenance: Provenance; pricePence: number; priceNativeMinor: number; currencyNative: string; taxesIncluded: boolean | null; selfTransfer: boolean | null; segmentCabins: Cabin[] | null; baggage: BaggageSnapshot | null; fareConditions: FareConditions | null; booking: Booking; bookingExpiresAt: IsoDateTime | null; suppliedFields: SuppliedField[]; partialExpansion: boolean }
export type Verdict = 'pass' | 'fail' | 'unverified';
export type ConstraintName = keyof Constraints | 'cabin';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };
export function effectiveAge(p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>, now: IsoDateTime): EffectiveAge;
export function formatAgeFull(a: EffectiveAge): string;
export function formatDuration(hours: number): string;
export const BANNED_WORDS: readonly string[];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
// Config.smtp:
smtp: { host: string; port: number; tls: 'implicit' | 'starttls' | 'none'; user: string; pass: Secret; to: string; from: string } | null;
// api-contract/alerts.ts
alertRuleSchema (spec §6.8 with the requireAllVerified refinement), alertEventSchema

// WP1 / WP2 produces lines
cellKeyString(cell): string   // 'O|D|dep|ret'
addDays(IsoDate, n): IsoDate; daysBetween(a, b): number
itineraryHash(outbound, inbound): string
evaluateConstraints(it, offer, c: Constraints, supplied: readonly SuppliedField[]): Verdicts
verdictClass(v): 'verified' | 'partially-verified' | 'failed'
evaluateAlertRules(rules, candidates, previous, now): Firing[]
dedupKey, isSuppressed
buildDigest(rule, firings): AlertDigest
searchLinkFor(providerId, cell, cabin): { url; host; label }

// @gmt/db
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T): T; close(): void }
export function openDatabase(path: string): Db;
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
export class DefinitionsRepo { create(input): SearchDefinition; update(id, patch): SearchDefinition; get(id): SearchDefinition | null; list(): SearchDefinition[]; softDelete(id): void; setConfirmedCost(id, pence): void }
export class ExecutionsRepo { create(input): Execution; get(id): Execution | null; /* … */ }
export class CellsRepo { seed(executionId, cells, discoveryProviders): void; seedVerification(executionId, selection, verificationProviders): void; outcomes(executionId, filter?): CellOutcome[]; setOutcome(executionId, cell, stage, providerId, patch): void; selected(executionId): Array<CellKey & { reason: SelectionReason }>; /* … */ }
export class CalendarPricesRepo { insert(rows): void; /* … */ }
export class ItinerariesRepo { upsertItinerary(it, segments): void; upsertOffer(offer): number; insertObservation(obs): number; observationsForDefinition(definitionId, executionIds, space, cabin): ObservationRow[]; /* … */ }
export class AlertsRepo { rules(definitionId?): AlertRule[]; create/update/delete; events(filter): AlertEvent[]; lastFiring(ruleId, dedupKey | identity, since): AlertEvent | null; insertEvent(e): number }
export class NotificationsRepo { wasSent(kind, executionId): boolean; record(kind, executionId, status): void }
export class AirportsRepo { /* … */ upsertAll(rows, datasetVersion): void }

// @gmt/providers
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;

// @gmt/engine (WP7)
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export interface Repos { airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo; calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo; notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo }
export function createEngine(deps: EngineDeps): Engine;
```

### 4.2 Shapes the plan names but does not define (assumed; re-check when wave 7 opens)

Neither `docs/briefs/wp07-engine.md` nor `docs/briefs/wp09-web-shell-definitions-results.md` exists at the time of writing (nor WP2's or WP3's brief), so this brief codes against the plan's contracts and the following exact shapes. The plan says later-wave briefs are re-reviewed against the merged code when their wave opens; that review replaces any assumption below that the merged code contradicts, and nothing else in the brief changes.

```ts
// @gmt/core (WP2) — alerts
export interface AlertRule { id: string; definitionId: string; type: 'absolute' | 'dropPct' | 'dropAbs'; thresholdPence: number | null; pct: number | null; basis: 'verified' | 'calendar'; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export interface VerifiedCandidate {
  basis: 'verified'; observationId: number; offerId: number; itineraryHash: string; cell: Cell; pricePence: number; provenance: Provenance;
  seller: string; verdictClass: 'verified' | 'partially-verified'; unverified: ConstraintName[]; verdicts: Verdicts;
  outbound: Segment[]; inbound: Segment[]; booking: Booking; bookingExpiresAt: IsoDateTime | null;
}
export interface CalendarCandidate { basis: 'calendar'; calendarPriceId: number; cell: Cell; pricePence: number; provenance: Provenance; vendorLink: string | null }
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface PreviousPrice { pricePence: number; fetchedAt: IsoDateTime }
export interface Firing { ruleId: string; kind: 'absolute' | 'drop'; candidate: AlertCandidate; previous: PreviousPrice | null; identityKey: string; dedupKey: string; reason: string }
export type DigestItem = Firing;
export interface FiringHistory { sameKeySentAt: IsoDateTime | null; lowestSentPence: number | null }
export function candidateRef(c: AlertCandidate): string;   // 'v:<observationId>' | 'c:<calendarPriceId>' — the key of the `previous` map
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], previous: ReadonlyMap<string, PreviousPrice>, now: IsoDateTime): Firing[];
//   identityKey: verified `${ruleId}|${itineraryHash}`, calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`;
//   dedupKey = `${identityKey}|${Math.floor(pricePence / 100)}`; a drop rule never fires for a candidate absent from `previous`;
//   on the verified basis, `partially-verified` candidates are dropped when requireAllVerified is true.
export function isSuppressed(f: Firing, history: FiringHistory): { suppressed: boolean; reason: string | null };
export function buildDigest(rule: AlertRule, firings: Firing[]): AlertDigest;   // items = 10 cheapest ascending; restCount = the rest
// api-contract/alerts.ts (WP0)
// alertRuleSchema parses the create/update body: AlertRule without `id` (id optional), cooldownHours default 336,
//   requireAllVerified rejected when basis is 'calendar'.
// alertEventSchema: { id: number; ruleId: string; firedAt: IsoDateTime; status: 'sent' | 'failed' | 'suppressed'; reason: string | null; label: string; pricePence: number }

// @gmt/db (WP3) — row shapes
// ExecutionsRepo.create({ definitionId, isChild: false, cell: null, snapshot: DefinitionSnapshot, status, stage, startedAt }): Execution
// Execution: { id: string; definitionId: string; isChild: boolean; snapshot: DefinitionSnapshot; status: ExecutionStatus; /* … */ }
// CalendarPricesRepo.insert(rows): rows are spec §7 calendar_prices columns in camelCase (executionId, providerId, sourceKind, cabin, origin, destination, departureDate, returnDate, pricePence, priceNativeMinor, currencyNative, fxRateNano, fxRateDate, fxSource, fxConverted, pointOfSale, fetchedAt, providerObservedAt, maxAgeHours, vendorLink, reusedFromExecutionId)
// ItinerariesRepo.upsertItinerary(it: NormalisedItinerary, segments: Segment[]); upsertOffer(o: Offer): number; insertObservation(o: Omit<Observation, 'id'>): number
// ObservationRow: { observation: Observation; offer: Offer & { id: number }; itinerary: NormalisedItinerary }
// AlertsRepo.create(input: Omit<AlertRule, 'id'>): AlertRule; events(filter: { ruleId?: string; definitionId?: string; limit?: number }): AlertEvent[]
// AlertsRepo.insertEvent(e: { ruleId; identityKey; observationId: number | null; calendarPriceId: number | null; dedupKey; firedAt; status; reason: string | null; payloadJson: string }): number
// AlertEvent: the same fields plus id.
// CellsRepo.setOutcome patch: Partial<Pick<CellOutcome, 'status' | 'reason' | 'fetchedAt' | 'minPence'>>

// @gmt/engine (WP7)
// packages/engine/src/alerts/hook.ts:
export type AlertsStepHook = (deps: AlertRunnerDeps, executionId: string) => Promise<AlertRunResult>;
export const noAlerts: AlertsStepHook;   // returns { digests: 0, events: 0 }
// packages/engine/src/orchestrator.ts contains, at the alerts step, exactly:
//   const alerts = await noAlerts(deps, executionId);
// new LogNotifier(log: Logger): Notifier, exported from packages/engine/src/notifiers/log.ts
// test/harness/layerA.ts: layerA(): Promise<{ engine: Engine; deps: EngineDeps; definitionId: string; waitForStatus(executionId: string, status: ExecutionStatus): Promise<void> }>

// apps/api (WP8): bootstrap/app.ts builds EngineDeps with exactly the line
//   notifiers: [new LogNotifier(ports.log)],
// apps/web (WP9): App.tsx renders the Alerts nav entry as
//   <AlertsView definitionId={selectedDefinitionId} />  importing from './views/Alerts/index.js'
```

### 4.3 Queries the runner needs that the plan's `Database` contract lacks

The contract gives `AlertsRepo.lastFiring(ruleId, dedupKey | identity, since): AlertEvent | null` but no "lowest price this identity was sent at", and no repository method returns "calendar prices fetched by this execution, not reused", "the previous calendar price for (provider, cabin, cell) inside a window" or "the previous observation of an offer". This WP implements them as read-only SQL in `packages/engine/src/alerts/queries.ts` over `Db.raw`, against the spec §7 table and column names (Task 11.1, 11.4, 11.5, 11.6). `// why:` the `@gmt/db` contract is frozen once WP3 merges; the plan's process routes a change through Fable, so these four queries are reported as finding WP11-C1 for Fable to fold into `CalendarPricesRepo`, `ItinerariesRepo` and `AlertsRepo`, after which the runner switches its four call sites.

## 5. Interfaces produced

```ts
// packages/engine/src/alerts/runner.ts
export type AlertRunnerDeps = Pick<EngineDeps, 'db' | 'repos' | 'notifiers' | 'clock' | 'log'>;
export interface AlertRunResult { digests: number; events: number }
export async function runAlerts(deps: AlertRunnerDeps, executionId: string): Promise<AlertRunResult>;
export function alertsFailed(log: Logger, executionId: string, err: unknown): AlertRunResult;

// packages/engine/src/alerts/queries.ts
export interface CalendarAlertRow { id: number; providerId: ProviderId; cabin: Cabin; cell: Cell; pricePence: number; provenance: Provenance; vendorLink: string | null }
export interface AlertQueries {
  calendarFetchedByExecution(executionId: string, cabin: Cabin): CalendarAlertRow[];
  previousObservation(offerId: number, before: IsoDateTime): PreviousPrice | null;
  previousCalendarPrice(p: { providerId: ProviderId; cabin: Cabin; cell: CellKey; before: IsoDateTime; notBefore: IsoDateTime }): PreviousPrice | null;
  firingHistory(p: { ruleId: string; identityKey: string; dedupKey: string; since: IsoDateTime }): FiringHistory;
}
export function alertQueries(db: Db): AlertQueries;

// packages/engine/src/alerts/templates.ts
export type CoverageCaveat = { kind: 'verification'; itinerarySearched: number; selected: number; expandTop: number } | { kind: 'no-verification' };
export interface DigestRenderInput {
  rule: AlertRule; definitionId: string; definitionName: string; items: readonly Firing[]; restCount: number;
  newcomers: readonly AlertCandidate[]; newcomersRest: number; coverage: CoverageCaveat; now: IsoDateTime;
}
export function stripControl(s: string): string;
export function sourceLabel(p: Provenance): string;
export function routeLine(c: AlertCandidate): string;
export function renderSubject(item: Firing, now: IsoDateTime): string;
export function renderBody(input: DigestRenderInput): string;
export function appRowPath(definitionId: string, itineraryHash: string): string;

// packages/engine/src/notifiers/email.ts
export type SmtpConfig = NonNullable<Config['smtp']>;
export interface SmtpTransportOptions { host: string; port: number; secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean; auth: { user: string; pass: string } }
export interface MailMessage { from: string; to: string; subject: string; text: string }
export interface MailTransport { sendMail(m: MailMessage): Promise<{ messageId: string }> }
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions;
export class EmailNotifier implements Notifier { constructor(opts: { smtp: SmtpConfig; nodeEnv: Config['nodeEnv']; log: Logger; createTransport?: TransportFactory }); readonly id: 'email'; send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> }

// packages/engine/src/notifiers/index.ts
export function buildNotifiers(config: Pick<Config, 'smtp' | 'nodeEnv'>, log: Logger): Notifier[];

// apps/web/src/views/Alerts/index.ts
export function AlertsView(props: { definitionId: string }): JSX.Element;
```

Every symbol above is re-exported from `packages/engine/src/index.ts` (except `alertQueries`, which stays internal to the engine).

## 6. Library notes

Verified 2026-10-14 with context7.

- **nodemailer 10.1.1** (`@types/nodemailer` 8.0.2), context7 `/nodemailer/nodemailer-homepage`, pages `docs/smtp/index.md` and `docs/transports/stream.md` (nodemailer.com/smtp/, nodemailer.com/transports/stream/).
  - `nodemailer.createTransport({ host, port, secure, requireTLS, ignoreTLS, auth: { user, pass } })`. `secure: true` = TLS from the start (implicit, port 465). `secure: false` starts plain and upgrades with STARTTLS when offered; `requireTLS: true` makes the upgrade mandatory and fails otherwise; `ignoreTLS: true` never attempts STARTTLS. If port 465 is given `secure` defaults to true; this WP always sets `secure` explicitly.
  - `transporter.sendMail({ from, to, subject, text })` returns a promise of `info` with `messageId` and `envelope`.
  - Test transport: **`jsonTransport: true`** (a separate transport type, not a `streamTransport` option). `info.envelope` is `{ from: string; to: string[] }`; `info.message` is a JSON string of the message structure (`subject`, `text`, and `html` only when one was given). This WP's tests inject a `TransportFactory` that records the SMTP options it was given and returns a `jsonTransport` transporter, so one test checks both the TLS mapping and the composed message. `streamTransport` is not used.
  - Types: this WP declares its own minimal `SmtpTransportOptions`/`MailTransport` interfaces instead of importing `nodemailer/lib/smtp-transport` subpath types. `// why:` deep `@types` subpath imports are fragile under `NodeNext` resolution; nodemailer's `Transporter` is structurally assignable to `MailTransport`.
  - Mailpit (dev profile, `SMTP_TLS=none`): config requires `SMTP_USER`/`SMTP_PASS` (all or nothing), so nodemailer sends AUTH over a plain connection; WP12's compose must let Mailpit accept that (its `MP_SMTP_AUTH_ACCEPT_ANY` / `MP_SMTP_AUTH_ALLOW_INSECURE` settings; not verified here, WP12 verifies).
- **msw 3.0.3**, context7 `/mswjs/msw` (`_autodocs/api-reference/setup-server.md`, `http.md`): `setupServer(...handlers)` from `msw/node`; `server.listen({ onUnhandledRequest: 'error' })`, `server.resetHandlers()`, `server.close()`; `http.get(path, resolver)`, `http.post(path, async ({ request }) => … await request.json() …)`, `http.delete`; `HttpResponse.json(body, { status })`. Paths use `*/alerts` so the jsdom origin does not matter.
- **@testing-library/react 16.3.3**: `render`, `screen.getByLabelText`, `screen.getByRole`, `screen.findByText`, `waitFor`. **@testing-library/user-event 14.6.8**, context7 `/testing-library/user-event` (`_autodocs/api-reference/utility.md`, `convenience.md`): `const user = userEvent.setup()`, `await user.selectOptions(select, value)`, `await user.clear(input)`, `await user.type(input, text)`, `await user.click(el)`. **@testing-library/jest-dom 7.0.1** matchers via the web `test/setup.ts` from WP0 (`toBeDisabled`, `toHaveValue`, `toBeInTheDocument`).
- **react 19.3.1**, **@tanstack/react-query 5.104.2**: `useQuery({ queryKey, queryFn })`, `useMutation({ mutationFn, onSuccess })`, `useQueryClient().invalidateQueries({ queryKey })`, `QueryClientProvider`.
- **vitest 5.0.4**: `vi.fn`, `vi.hoisted`, `vi.mock(path, factory)`; engine tests run in Node, web tests in jsdom (WP0 config).

## 7. Files

- Create: `packages/engine/src/alerts/runner.ts`, `packages/engine/src/alerts/queries.ts`, `packages/engine/src/alerts/templates.ts`, `packages/engine/src/notifiers/email.ts`, `packages/engine/src/notifiers/index.ts`
- Create: `apps/web/src/views/Alerts/alertsApi.ts`, `apps/web/src/views/Alerts/RuleForm.tsx`, `apps/web/src/views/Alerts/EventsTable.tsx`, `apps/web/src/views/Alerts/AlertsView.tsx`, `apps/web/src/views/Alerts/index.ts`
- Modify: `packages/engine/src/orchestrator.ts` (one line, Task 11.8), `packages/engine/src/index.ts` (exports), `apps/api/src/bootstrap/app.ts` (one line, Task 11.9), `apps/web/src/App.tsx` (one import, Task 11.10)
- Test: `packages/engine/test/alerts/harness.ts`, `packages/engine/test/alerts/builders.ts`, `packages/engine/test/alerts/runner.digest.test.ts`, `runner.render.test.ts`, `runner.verified.test.ts`, `runner.calendar.test.ts`, `runner.dedup.test.ts`, `runner.refusals.test.ts`, `orchestrator.alerts.test.ts`, `templates.test.ts`, `packages/engine/test/notifiers/email.test.ts`, `apps/web/test/views/Alerts/RuleForm.test.tsx`, `apps/web/test/views/Alerts/AlertsView.test.tsx`

## 8. Tasks

Commands assume the repository root. Every commit message ends with the repository's attribution line.

### Task 11.1: 50 qualifying cells → one digest (first failing test)

**Files:** Create `packages/engine/src/alerts/runner.ts`, `packages/engine/src/alerts/queries.ts`, `packages/engine/test/alerts/harness.ts`, `packages/engine/test/alerts/runner.digest.test.ts`.

**Interfaces:** consumes `evaluateAlertRules`, `buildDigest`, `AlertsRepo`, `ExecutionsRepo`, `DefinitionsRepo`, `CalendarPricesRepo.insert`, `Notifier`; produces `runAlerts`, `AlertRunnerDeps`, `AlertRunResult`, `alertQueries().calendarFetchedByExecution`.

- [ ] **Step 1: Write the failing test.** First the shared harness (test-only; every row it writes is a real-provider kind because alerts refuse synthetic rows, which Task 11.7 proves).

`packages/engine/test/alerts/harness.ts`:

```ts
/**
 * Test harness for the alert runner (spec §6.8): an in-memory database with the real WP3 migrations
 * and repositories, a fixed clock, a capturing logger and a recording notifier.
 * why: alerts refuse synthetic rows (spec §5.5), so these tests write rows of the real provider kinds
 * into a ':memory:' test database; nothing here is reachable from a production bootstrap.
 */
import { fileURLToPath } from 'node:url';
import {
  addDays, asIata, asIsoDate, asIsoDateTime, fixedClock, itineraryHash,
  type AlertDigest, type AlertRule, type Booking, type Cabin, type Cell, type CellKey, type DefinitionSnapshot, type IsoDate,
  type IsoDateTime, type Logger, type NormalisedItinerary, type Notifier, type OperatorMessage, type ProviderId,
  type SearchDefinition, type Segment, type SuppliedField,
} from '@gmt/core';
import {
  AirportsRepo, AlertsRepo, CalendarPricesRepo, CellsRepo, DefinitionsRepo, ExecutionsRepo, FxRepo, ItinerariesRepo,
  LedgerRepo, NotificationsRepo, RoutePriceHistoryRepo, applyMigrations, openDatabase, type Db,
} from '@gmt/db';
import type { Repos } from '../../src/index.js';
import type { AlertRunnerDeps } from '../../src/alerts/runner.js';

export const MIGRATIONS = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');
const HOUR = 3_600_000;

/** An instant `hours` before `at`, in toISOString form. */
export function hoursBefore(at: IsoDateTime, hours: number): IsoDateTime {
  return asIsoDateTime(new Date(new Date(at).getTime() - hours * HOUR).toISOString());
}

export interface LogLine { level: 'debug' | 'info' | 'warn' | 'error'; obj: object; msg: string | undefined }

/** A Logger that keeps every line so tests can assert on messages and on the absence of secrets. */
export function captureLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const make = (bindings: object): Logger => ({
    debug: (o, m) => void lines.push({ level: 'debug', obj: { ...bindings, ...o }, msg: m }),
    info: (o, m) => void lines.push({ level: 'info', obj: { ...bindings, ...o }, msg: m }),
    warn: (o, m) => void lines.push({ level: 'warn', obj: { ...bindings, ...o }, msg: m }),
    error: (o, m) => void lines.push({ level: 'error', obj: { ...bindings, ...o }, msg: m }),
    child: (b) => make({ ...bindings, ...b }),
  });
  return Object.assign(make({}), { lines });
}

/** A Notifier that records every message and answers with a fixed result. */
export class RecordingNotifier implements Notifier {
  readonly id: string;
  readonly sent: Array<AlertDigest | OperatorMessage> = [];
  private readonly result: { ok: boolean; detail?: string };
  constructor(id = 'recording', result: { ok: boolean; detail?: string } = { ok: true }) {
    this.id = id;
    this.result = result;
  }
  async send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> {
    this.sent.push(msg);
    return this.result;
  }
  digests(): AlertDigest[] {
    return this.sent.filter((m): m is AlertDigest => 'items' in m);
  }
  operatorMessages(): OperatorMessage[] {
    return this.sent.filter((m): m is OperatorMessage => !('items' in m));
  }
}

export interface Harness {
  db: Db; clock: ReturnType<typeof fixedClock>; repos: Repos; log: ReturnType<typeof captureLogger>;
  notifier: RecordingNotifier; deps: AlertRunnerDeps;
}

/** Fresh database and repositories per test. */
export function harness(notifier = new RecordingNotifier()): Harness {
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS);
  const clock = fixedClock(NOW);
  const repos: Repos = {
    airports: new AirportsRepo(db, clock), fx: new FxRepo(db, clock), definitions: new DefinitionsRepo(db, clock),
    executions: new ExecutionsRepo(db, clock), cells: new CellsRepo(db, clock), calendarPrices: new CalendarPricesRepo(db, clock),
    itineraries: new ItinerariesRepo(db, clock), ledger: new LedgerRepo(db, clock), alerts: new AlertsRepo(db, clock),
    notifications: new NotificationsRepo(db, clock), routeHistory: new RoutePriceHistoryRepo(db, clock),
  };
  repos.airports.upsertAll([
    { iata: LHR, icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'GB', tz: 'Europe/London', lat: 51.47, lon: -0.4543, metro: 'LON' },
    { iata: LGW, icao: 'EGKK', name: 'Gatwick', city: 'London', country: 'GB', tz: 'Europe/London', lat: 51.148, lon: -0.19, metro: 'LON' },
    { iata: JFK, icao: 'KJFK', name: 'John F Kennedy', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40.64, lon: -73.78, metro: 'NYC' },
    { iata: EWR, icao: 'KEWR', name: 'Newark', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40.69, lon: -74.17, metro: 'NYC' },
  ], 'test');
  const log = captureLogger();
  return { db, clock, repos, log, notifier, deps: { db, repos, notifiers: [notifier], clock, log } };
}

/** The worked-example definition (London → New York), with overrides. */
export function seedDefinition(h: Harness, over: Partial<Omit<SearchDefinition, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> = {}): SearchDefinition {
  return h.repos.definitions.create({
    name: 'London to New York (worked example)', origins: [LHR, LGW], destinations: [JFK, EWR],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' }, checkedBagRequired: true },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: ['searchapi'], discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', confirmedCostPence: null, enabled: true,
    ...over,
  });
}

/** A parent execution over the definition's snapshot; returns its id. */
export function seedExecution(h: Harness, def: SearchDefinition): string {
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: { origins: def.origins, destinations: def.destinations, departureFrom: asIsoDate('2026-10-21'), departureTo: asIsoDate('2027-04-20'), minNights: def.minNights, maxNights: def.maxNights },
    resolvedAt: h.clock.now(), windowClamped: false,
  };
  return h.repos.executions.create({ definitionId: def.id, isChild: false, cell: null, snapshot, status: 'running', stage: 'verification', startedAt: h.clock.now() }).id;
}

/** `n` LHR→JFK cells of 14 nights departing daily from 2026-11-01. */
export function cells(n: number, origin = LHR, destination = JFK): Cell[] {
  return Array.from({ length: n }, (_, i) => {
    const departureDate = addDays(asIsoDate('2026-11-01'), i);
    return { origin, destination, departureDate, returnDate: addDays(departureDate, 14), nights: 14 };
  });
}

export interface CalendarSeed { cell: CellKey; pricePence: number; fetchedAt?: IsoDateTime; providerId?: ProviderId; reusedFrom?: string; cabin?: Cabin }

/** Calendar rows of a real provider kind (searchapi by default). `providerId: 'fixture'` writes synthetic rows. */
export function seedCalendar(h: Harness, executionId: string, rows: CalendarSeed[]): void {
  h.repos.calendarPrices.insert(rows.map((r) => {
    const providerId = r.providerId ?? 'searchapi';
    const sourceKind = providerId === 'searchapi' ? 'scraped-aggregate' : providerId === 'travelpayouts' ? 'authorised-cached' : 'synthetic';
    return {
      executionId, providerId, sourceKind, cabin: r.cabin ?? 'economy',
      origin: r.cell.origin, destination: r.cell.destination, departureDate: r.cell.departureDate, returnDate: r.cell.returnDate,
      pricePence: r.pricePence, priceNativeMinor: r.pricePence, currencyNative: 'GBP', fxRateNano: null, fxRateDate: null, fxSource: null, fxConverted: false,
      pointOfSale: providerId === 'searchapi' ? 'GB' : 'unknown', fetchedAt: r.fetchedAt ?? h.clock.now(), providerObservedAt: null,
      maxAgeHours: providerId === 'searchapi' ? 24 : providerId === 'travelpayouts' ? 48 : 0, vendorLink: null, reusedFromExecutionId: r.reusedFrom ?? null,
    };
  }));
}

export const ALL_FIELDS: SuppliedField[] = ['segments', 'segmentTimes', 'segmentCabins', 'selfTransfer', 'baggage', 'fareConditions', 'seller', 'price'];

export interface ObservationSeed {
  departureDate: IsoDate; pricePence: number; flight?: number; seller?: string; fetchedAt?: IsoDateTime;
  suppliedFields?: SuppliedField[]; booking?: Booking; synthetic?: boolean;
}

/** One BA nonstop LHR→JFK round trip of 14 nights, its offer and one observation. */
export function seedObservation(h: Harness, executionId: string, o: ObservationSeed): { offerId: number; observationId: number; itineraryHash: string } {
  const returnDate = addDays(o.departureDate, 14);
  const flight = o.flight ?? 117;
  const outbound: Segment[] = [{ marketingCarrier: 'BA', flightNumber: flight, from: LHR, to: JFK, departLocal: `${o.departureDate}T08:25`, arriveLocal: `${o.departureDate}T11:20`, durationMinutes: 475 }];
  const inbound: Segment[] = [{ marketingCarrier: 'BA', flightNumber: flight + 1, from: JFK, to: LHR, departLocal: `${returnDate}T18:30`, arriveLocal: `${addDays(returnDate, 1)}T06:35`, durationMinutes: 425 }];
  const hash = itineraryHash(outbound, inbound);
  const it: NormalisedItinerary = {
    hash, origin: LHR, destination: JFK, departureDate: o.departureDate, returnDate, nights: 14, outbound, inbound,
    outboundMinutes: 475, inboundMinutes: 425, stopsOut: 0, stopsIn: 0, layovers: [], airportChange: false, marketingCarriers: ['BA'],
  };
  h.repos.itineraries.upsertItinerary(it, [...outbound, ...inbound]);
  const providerId: ProviderId = o.synthetic === true ? 'fixture' : 'searchapi';
  const offerId = h.repos.itineraries.upsertOffer({ itineraryHash: hash, providerId, seller: o.seller ?? 'British Airways', cabin: 'economy' });
  const observationId = h.repos.itineraries.insertObservation({
    offerId, executionId,
    provenance: { providerId, sourceKind: o.synthetic === true ? 'synthetic' : 'scraped-search', fetchedAt: o.fetchedAt ?? h.clock.now(), maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' },
    pricePence: o.pricePence, priceNativeMinor: o.pricePence, currencyNative: 'GBP', taxesIncluded: true, selfTransfer: false,
    segmentCabins: ['economy', 'economy'], baggage: { cabinBag: 'included', checkedBags: 1 }, fareConditions: null,
    booking: o.booking ?? { kind: 'none' }, bookingExpiresAt: null, suppliedFields: o.suppliedFields ?? ALL_FIELDS, partialExpansion: false,
  });
  return { offerId, observationId, itineraryHash: hash };
}

/** Seeds search_cells for `selected`, selects them for verification and marks the first `searched` as priced. */
export function seedVerificationCoverage(h: Harness, executionId: string, selected: Cell[], searched: number): void {
  h.repos.cells.seed(executionId, selected, ['searchapi']);
  h.repos.cells.seedVerification(executionId, selected.map((cell) => ({ cell, reason: 'top_n' as const })), ['searchapi']);
  for (const cell of selected.slice(0, searched)) h.repos.cells.setOutcome(executionId, cell, 'verification', 'searchapi', { status: 'priced', fetchedAt: h.clock.now() });
}

/** Creates an enabled alert rule. */
export function seedRule(h: Harness, def: SearchDefinition, over: Partial<Omit<AlertRule, 'id' | 'definitionId'>> = {}): AlertRule {
  return h.repos.alerts.create({
    definitionId: def.id, type: 'absolute', thresholdPence: 50000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true,
    ...over,
  });
}

/** Parsed payload_json of an event row. */
export function payloadOf(e: { payloadJson: string }): { digestId: string; executionId: string; kind: string; pricePence: number; previousPence: number | null; label: string } {
  return JSON.parse(e.payloadJson);
}
```

`packages/engine/test/alerts/runner.digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, harness, hoursBefore, NOW, payloadOf, seedCalendar, seedDefinition, seedExecution, seedRule } from './harness.js';

describe('one digest per rule per execution (spec §6.8, §9 item 4)', () => {
  it('50 qualifying calendar cells under one absolute rule → one digest, top 10 + 40 more, 50 sent events sharing a digest id', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    const rule = seedRule(h, def, { type: 'absolute', thresholdPence: 50000, basis: 'calendar' });
    seedCalendar(h, ex, cells(50).map((cell, i) => ({ cell, pricePence: 40000 + i * 100 })));

    const result = await runAlerts(h.deps, ex);

    expect(result).toEqual({ digests: 1, events: 50 });
    expect(h.notifier.sent).toHaveLength(1);
    const [digest] = h.notifier.digests();
    expect(digest?.ruleId).toBe(rule.id);
    expect(digest?.executionId).toBe(ex);
    expect(digest?.basis).toBe('calendar');
    expect(digest?.items).toHaveLength(10);
    expect(digest?.restCount).toBe(40);
    expect(digest?.items.map((i) => i.candidate.pricePence)).toEqual([40000, 40100, 40200, 40300, 40400, 40500, 40600, 40700, 40800, 40900]);

    const events = h.repos.alerts.events({ ruleId: rule.id });
    expect(events).toHaveLength(50);
    expect(new Set(events.map((e) => e.status))).toEqual(new Set(['sent']));
    const digestIds = new Set(events.map((e) => payloadOf(e).digestId));
    expect(digestIds.size).toBe(1);
    expect(events.every((e) => payloadOf(e).executionId === ex && e.calendarPriceId !== null && e.observationId === null)).toBe(true);
  });

  it('only calendar prices fetched by this execution count: reused copies and other executions are excluded', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const earlier = seedExecution(h, def);
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 50000, basis: 'calendar' });
    const [a, b, c] = cells(3);
    if (a === undefined || b === undefined || c === undefined) throw new Error('cells');
    seedCalendar(h, earlier, [{ cell: b, pricePence: 30000, fetchedAt: hoursBefore(NOW, 24) }]);
    seedCalendar(h, ex, [
      { cell: a, pricePence: 45000 },
      { cell: b, pricePence: 30000, fetchedAt: hoursBefore(NOW, 24), reusedFrom: earlier }, // reused copy: excluded
      { cell: c, pricePence: 46000, cabin: 'business' },                                    // other cabin: excluded
    ]);

    const result = await runAlerts(h.deps, ex);

    expect(result).toEqual({ digests: 1, events: 1 });
    expect(h.notifier.digests()[0]?.items.map((i) => i.candidate.cell.departureDate)).toEqual([a.departureDate]);
  });

  it('no enabled rule, or nothing qualifying → no digest and no events', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 30000 });
    seedRule(h, def, { thresholdPence: 99999, enabled: false });
    seedCalendar(h, ex, cells(3).map((cell) => ({ cell, pricePence: 40000 })));
    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(h.notifier.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts`
Expected: FAIL — the import `../../src/alerts/runner.js` cannot be resolved (module not found).

- [ ] **Step 3: Implement**

`packages/engine/src/alerts/queries.ts`:

```ts
/**
 * Read-only SQL the alert runner needs (spec §6.8) that the plan's Database contract does not yet offer.
 * why: the @gmt/db contract is frozen after WP3; these are reported to Fable as finding WP11-C1 to move
 * into CalendarPricesRepo / ItinerariesRepo / AlertsRepo. Column and table names are spec §7's.
 */
import { asIsoDateTime, daysBetween, type Cabin, type Cell, type IsoDate, type Provenance, type ProviderId, type SourceKind, type PointOfSale } from '@gmt/core';
import type { Db } from '@gmt/db';

/** A calendar price written by an execution itself (never a reused copy), with full provenance. */
export interface CalendarAlertRow { id: number; providerId: ProviderId; cabin: Cabin; cell: Cell; pricePence: number; provenance: Provenance; vendorLink: string | null }

/** The alert queries; Task 11.4, 11.5 and 11.6 each add one member. */
export interface AlertQueries {
  calendarFetchedByExecution(executionId: string, cabin: Cabin): CalendarAlertRow[];
}

interface CalendarSqlRow {
  id: number; provider_id: ProviderId; source_kind: SourceKind; cabin: Cabin; origin: string; destination: string;
  departure_date: string; return_date: string; price_pence: number; fx_converted: number; fx_rate_nano: number | null;
  fx_rate_date: string | null; fx_source: string | null; point_of_sale: PointOfSale; fetched_at: string;
  provider_observed_at: string | null; max_age_hours: number | null; vendor_link: string | null;
}

/** Rebuilds the spec §3 provenance object from stored columns; nothing is defaulted. */
function provenanceOf(r: CalendarSqlRow): Provenance {
  const fx: Provenance['fx'] = r.fx_converted === 1 && r.fx_rate_nano !== null && r.fx_rate_date !== null && r.fx_source !== null
    ? { converted: true, rateNano: r.fx_rate_nano, rateDate: r.fx_rate_date as IsoDate, source: r.fx_source }
    : { converted: false };
  const base = {
    providerId: r.provider_id, sourceKind: r.source_kind, fetchedAt: asIsoDateTime(r.fetched_at),
    maxAgeHours: r.max_age_hours ?? ('unknown' as const), fx, pointOfSale: r.point_of_sale, cabin: r.cabin,
  };
  // why: exactOptionalPropertyTypes — providerObservedAt is present only when the vendor stated it.
  return r.provider_observed_at === null ? base : { ...base, providerObservedAt: asIsoDateTime(r.provider_observed_at) };
}

/** Builds the query object over one database handle. */
export function alertQueries(db: Db): AlertQueries {
  const calendarByExecution = db.raw.prepare(
    `SELECT id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence,
            fx_converted, fx_rate_nano, fx_rate_date, fx_source, point_of_sale, fetched_at, provider_observed_at,
            max_age_hours, vendor_link
       FROM calendar_prices
      WHERE execution_id = ? AND cabin = ? AND reused_from_execution_id IS NULL
      ORDER BY price_pence, id`,
  );
  return {
    calendarFetchedByExecution(executionId, cabin) {
      return (calendarByExecution.all(executionId, cabin) as CalendarSqlRow[]).map((r) => {
        const departureDate = r.departure_date as IsoDate;
        const returnDate = r.return_date as IsoDate;
        return {
          id: r.id, providerId: r.provider_id, cabin: r.cabin, pricePence: r.price_pence, provenance: provenanceOf(r), vendorLink: r.vendor_link,
          cell: { origin: r.origin as Cell['origin'], destination: r.destination as Cell['destination'], departureDate, returnDate, nights: daysBetween(departureDate, returnDate) },
        };
      });
    },
  };
}
```

Tasks 11.4, 11.5 and 11.6 extend the core import of this file with `IsoDateTime`, `PreviousPrice`, `CellKey` and `FiringHistory` as their members need them.

`packages/engine/src/alerts/runner.ts`:

```ts
/**
 * The alerts step of the execution lifecycle (spec §8.1) and the engine side of spec §6.8:
 * gather candidates per basis from the current execution, evaluate rules (core), persist alert_events,
 * deliver one digest per rule per execution to every notifier.
 */
import { randomUUID } from 'node:crypto';
import {
  buildDigest, evaluateAlertRules,
  type AlertCandidate, type AlertDigest, type AlertRule, type CalendarCandidate, type DefinitionSnapshot, type Firing,
  type IsoDateTime, type Logger, type OperatorMessage, type PreviousPrice, type SearchDefinition,
} from '@gmt/core';
import type { EngineDeps } from '../index.js';
import { alertQueries, type AlertQueries } from './queries.js';

/** What the runner needs from the engine's dependencies; EngineDeps satisfies it. */
export type AlertRunnerDeps = Pick<EngineDeps, 'db' | 'repos' | 'notifiers' | 'clock' | 'log'>;
/** Digests delivered (sent or failed) and alert_events rows written (any status). */
export interface AlertRunResult { digests: number; events: number }

interface Pool { candidates: AlertCandidate[]; previous: Map<string, PreviousPrice> }
interface RunContext {
  deps: AlertRunnerDeps; log: Logger; now: IsoDateTime; executionId: string;
  definition: SearchDefinition; snapshot: DefinitionSnapshot; queries: AlertQueries; pools: Map<AlertRule['basis'], Pool>;
}

const NONE: AlertRunResult = { digests: 0, events: 0 };

/** Runs every enabled rule of the execution's definition once. Spec §6.8, §8.1. */
export async function runAlerts(deps: AlertRunnerDeps, executionId: string): Promise<AlertRunResult> {
  const execution = deps.repos.executions.get(executionId);
  if (execution === null) throw new Error(`alerts: execution ${executionId} not found`);
  const definition = deps.repos.definitions.get(execution.definitionId);
  if (definition === null || definition.deletedAt !== null) return NONE;
  const rules = deps.repos.alerts.rules(definition.id).filter((r) => r.enabled);
  if (rules.length === 0) return NONE;
  const ctx: RunContext = {
    deps, log: deps.log.child({ executionId, definitionId: definition.id }), now: deps.clock.now(), executionId,
    definition, snapshot: execution.snapshot, queries: alertQueries(deps.db), pools: new Map(),
  };
  let digests = 0;
  let events = 0;
  for (const rule of rules) {
    try {
      const r = await runRule(ctx, rule);
      digests += r.digests;
      events += r.events;
    } catch (err) {
      // why: one broken rule must not stop the others or the execution's transition to completed.
      ctx.log.error({ ruleId: rule.id, err: err instanceof Error ? err.message : String(err) }, 'alerts: rule failed; other rules continue');
    }
  }
  return { digests, events };
}

/** Logs a failure of the whole alerts step and reports nothing delivered; used by the orchestrator. */
export function alertsFailed(log: Logger, executionId: string, err: unknown): AlertRunResult {
  log.error({ executionId, err: err instanceof Error ? err.message : String(err) }, 'alerts: step failed; execution still completes');
  return NONE;
}

function poolFor(ctx: RunContext, basis: AlertRule['basis']): Pool {
  const cached = ctx.pools.get(basis);
  if (cached !== undefined) return cached;
  // why: the verified pool is gathered from Task 11.4 on; until then a verified rule has no candidates.
  const pool = basis === 'calendar' ? calendarPool(ctx) : { candidates: [], previous: new Map<string, PreviousPrice>() };
  ctx.pools.set(basis, pool);
  return pool;
}

/** Calendar prices fetched by this execution, in the snapshot's cabin, reused rows excluded (SQL). Spec §6.8. */
function calendarPool(ctx: RunContext): Pool {
  const rows = ctx.queries.calendarFetchedByExecution(ctx.executionId, ctx.snapshot.cabin);
  const candidates: CalendarCandidate[] = rows.map((r) => ({
    basis: 'calendar', calendarPriceId: r.id, cell: r.cell, pricePence: r.pricePence, provenance: r.provenance, vendorLink: r.vendorLink,
  }));
  return { candidates, previous: new Map() };
}

async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const pool = poolFor(ctx, rule.basis);
  const firings = evaluateAlertRules([rule], pool.candidates, pool.previous, ctx.now);
  if (firings.length === 0) return NONE;
  return deliver(ctx, rule, firings);
}

/** Builds and sends one digest, then writes one event per firing in one transaction. */
async function deliver(ctx: RunContext, rule: AlertRule, firings: Firing[]): Promise<AlertRunResult> {
  const digestId = randomUUID();
  const digest: AlertDigest = { ...buildDigest(rule, firings), executionId: ctx.executionId };
  const outcome = await sendToAll(ctx, digest);
  ctx.deps.db.transaction(() => {
    for (const f of firings) {
      ctx.deps.repos.alerts.insertEvent({
        ruleId: rule.id, identityKey: f.identityKey,
        observationId: f.candidate.basis === 'verified' ? f.candidate.observationId : null,
        calendarPriceId: f.candidate.basis === 'calendar' ? f.candidate.calendarPriceId : null,
        dedupKey: f.dedupKey, firedAt: ctx.now, status: outcome.status,
        reason: outcome.status === 'sent' ? f.reason : `${f.reason}; not delivered: ${outcome.detail}`,
        payloadJson: JSON.stringify({ digestId, executionId: ctx.executionId, kind: f.kind, pricePence: f.candidate.pricePence, previousPence: f.previous?.pricePence ?? null, label: eventLabel(f.candidate) }),
      });
    }
  });
  return { digests: 1, events: firings.length };
}

/** Short identity text for the events list. */
function eventLabel(c: AlertCandidate): string {
  return `${c.cell.origin}→${c.cell.destination} ${c.cell.departureDate}–${c.cell.returnDate} (${c.cell.nights}n)`;
}

/** Sends to every notifier; `sent` only when every notifier accepted the message. */
async function sendToAll(ctx: RunContext, msg: AlertDigest | OperatorMessage): Promise<{ status: 'sent' } | { status: 'failed'; detail: string }> {
  const failures: string[] = [];
  if (ctx.deps.notifiers.length === 0) failures.push('no notifier configured');
  for (const n of ctx.deps.notifiers) {
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

Add to `packages/engine/src/index.ts`:

```ts
export { runAlerts, alertsFailed, type AlertRunnerDeps, type AlertRunResult } from './alerts/runner.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: alert runner delivers one digest per rule per execution (spec §6.8)"`

### Task 11.2: Subject and body templates (spec §8.3)

**Files:** Create `packages/engine/src/alerts/templates.ts`, `packages/engine/test/alerts/builders.ts`, `packages/engine/test/alerts/templates.test.ts`.

**Interfaces:** consumes `effectiveAge`, `formatAgeFull`, `formatDuration`, `searchLinkFor`, `findBannedWords`; produces `stripControl`, `sourceLabel`, `routeLine`, `renderSubject`, `renderBody`, `appRowPath`, `CoverageCaveat`, `DigestRenderInput`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/alerts/builders.ts`:

```ts
/** Hand-built candidates and firings for template and notifier tests (no database). Worked example only. */
import { asIata, asIsoDate, asIsoDateTime, type AlertRule, type CalendarCandidate, type Firing, type VerifiedCandidate } from '@gmt/core';
import type { DigestRenderInput } from '../../src/alerts/templates.js';

export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const LHR = asIata('LHR');
const JFK = asIata('JFK');
const CELL = { origin: LHR, destination: JFK, departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-28'), nights: 14 };

export function verifiedCandidate(over: Partial<VerifiedCandidate> = {}): VerifiedCandidate {
  return {
    basis: 'verified', observationId: 7, offerId: 3, itineraryHash: 'a'.repeat(64), cell: CELL, pricePence: 41200,
    provenance: { providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: asIsoDateTime('2026-10-14T10:00:00.000Z'), maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' },
    seller: 'British Airways', verdictClass: 'partially-verified', unverified: ['checkedBagRequired'],
    verdicts: { cabin: 'pass', maxJourneyMinutes: 'pass', arrivalWindowLocal: 'pass', checkedBagRequired: 'unverified' },
    outbound: [{ marketingCarrier: 'BA', flightNumber: 117, from: LHR, to: JFK, departLocal: '2027-03-14T08:25', arriveLocal: '2027-03-14T11:20', durationMinutes: 475 }],
    inbound: [{ marketingCarrier: 'BA', flightNumber: 112, from: JFK, to: LHR, departLocal: '2027-03-28T18:30', arriveLocal: '2027-03-29T06:35', durationMinutes: 425 }],
    booking: { kind: 'get', url: 'https://www.google.com/travel/clk?tfs=abc', host: 'www.google.com' },
    bookingExpiresAt: asIsoDateTime('2026-10-14T18:00:00.000Z'),
    ...over,
  };
}

// why: maxAgeHours 168 reproduces the spec §8.3 example text "(≤7d before that)"; Travelpayouts itself
// declares 48 (spec §2), so its real emails read "(≤2d before that)".
export function calendarCandidate(over: Partial<CalendarCandidate> = {}): CalendarCandidate {
  return {
    basis: 'calendar', calendarPriceId: 11, cell: CELL, pricePence: 38900,
    provenance: { providerId: 'travelpayouts', sourceKind: 'authorised-cached', fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'), maxAgeHours: 168, fx: { converted: false }, pointOfSale: 'unknown', cabin: 'economy' },
    vendorLink: null,
    ...over,
  };
}

export function firing(candidate: VerifiedCandidate | CalendarCandidate, over: Partial<Firing> = {}): Firing {
  return { ruleId: 'rule-1', kind: 'absolute', candidate, previous: null, identityKey: 'rule-1|x', dedupKey: 'rule-1|x|412', reason: '£412 is at or below the £450 threshold', ...over };
}

export const RULE: AlertRule = { id: 'rule-1', definitionId: 'def-1', type: 'absolute', thresholdPence: 45000, pct: null, basis: 'verified', requireAllVerified: false, cooldownHours: 336, enabled: true };

export function renderInput(over: Partial<DigestRenderInput> = {}): DigestRenderInput {
  return {
    rule: RULE, definitionId: 'def-1', definitionName: 'London to New York (worked example)', items: [firing(verifiedCandidate())], restCount: 0,
    newcomers: [], newcomersRest: 0, coverage: { kind: 'verification', itinerarySearched: 3, selected: 10, expandTop: 2 }, now: NOW,
    ...over,
  };
}
```

`packages/engine/test/alerts/templates.test.ts`:

```ts
import { asIsoDateTime, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { renderBody, renderSubject, sourceLabel, stripControl } from '../../src/alerts/templates.js';
import { calendarCandidate, firing, NOW, renderInput, RULE, verifiedCandidate } from './builders.js';

describe('subject formats (spec §8.3)', () => {
  it('verified basis: the worked example', () => {
    expect(renderSubject(firing(verifiedCandidate()), NOW)).toBe(
      '[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google via SearchApi · fetched 5h ago · 1 constraint unverified',
    );
  });
  it('calendar basis: provider age bound and "constraints not checked"', () => {
    expect(renderSubject(firing(calendarCandidate()), NOW)).toBe(
      '[get-me-there] £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · constraints not checked',
    );
  });
  it('class verified says so; two unverified constraints are plural; FX-converted prices carry ≈', () => {
    expect(renderSubject(firing(verifiedCandidate({ verdictClass: 'verified', unverified: [] })), NOW)).toMatch(/ · class verified$/);
    expect(renderSubject(firing(verifiedCandidate({ unverified: ['checkedBagRequired', 'noSelfTransfer'] })), NOW)).toMatch(/ · 2 constraints unverified$/);
    const fx = verifiedCandidate({ provenance: { ...verifiedCandidate().provenance, fx: { converted: true, rateNano: 790_000_000, rateDate: '2026-10-13' as never, source: 'ecb' } } });
    expect(renderSubject(firing(fx), NOW)).toContain('≈£412 LHR→JFK');
  });
  it('labels the SearchApi date grid and refuses synthetic provenance', () => {
    expect(sourceLabel({ ...calendarCandidate().provenance, providerId: 'searchapi', sourceKind: 'scraped-aggregate' })).toBe('Google date grid via SearchApi');
    expect(() => sourceLabel({ ...calendarCandidate().provenance, providerId: 'fixture', sourceKind: 'synthetic' })).toThrow(/synthetic/);
  });
});

describe('body contents (spec §8.3)', () => {
  it('verified item: segments, seller, every unverified constraint, provenance, link with host and expiry, coverage, rule, rest count', () => {
    const body = renderBody(renderInput({ restCount: 40 }));
    for (const line of [
      'Seller: British Airways',
      'Outbound: BA 117 LHR 08:25 → JFK 11:20 (14 Mar)',
      'Inbound: BA 112 JFK 18:30 → LHR 06:35 (29 Mar)',
      'Verdicts: class partially-verified; unverified: checked bag',
      'Provenance: Google via SearchApi · fetched 5h ago',
      'Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
      'and 40 more',
      'Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each',
      'Rule: alert when the price is £450 or less · itinerary prices (class verified or partially-verified) · cooldown 336h',
    ]) expect(body).toContain(line);
  });
  it('POST booking: links to the app results row, never the vendor form', () => {
    const c = verifiedCandidate({ booking: { kind: 'post', url: 'https://www.google.com/travel/clk/f', postData: 'u=secretish', host: 'www.google.com' } });
    const body = renderBody(renderInput({ items: [firing(c)] }));
    expect(body).toContain(`/definitions/def-1/results?basis=verified&row=${'a'.repeat(64)}`);
    expect(body).not.toContain('u=secretish');
    expect(body).not.toContain('https://www.google.com/travel/clk/f');
  });
  it('expired and unstated expiry; no booking → labelled search link', () => {
    expect(renderBody(renderInput({ items: [firing(verifiedCandidate({ bookingExpiresAt: asIsoDateTime('2026-10-14T13:00:00.000Z') }))] }))).toContain('expired 2h ago');
    expect(renderBody(renderInput({ items: [firing(verifiedCandidate({ bookingExpiresAt: null }))] }))).toContain('expiry not stated');
    expect(renderBody(renderInput({ items: [firing(verifiedCandidate({ booking: { kind: 'none' } }))] }))).toMatch(/Link: https:\/\/\S+ \(host \S+, search link, not a fare link\)/);
  });
  it('a booking link that fails validation is not printed', () => {
    const c = verifiedCandidate({ booking: { kind: 'get', url: 'http://www.google.com/x', host: 'www.google.com' } });
    const body = renderBody(renderInput({ items: [firing(c)] }));
    expect(body).not.toContain('http://www.google.com/x');
    expect(body).toContain('Link: none (the stored link failed validation)');
  });
  it('calendar item: no itinerary, constraints not checked, previous price and its age on a drop', () => {
    const f = firing(calendarCandidate(), { kind: 'drop', previous: { pricePence: 43000, fetchedAt: asIsoDateTime('2026-10-11T15:00:00.000Z') }, reason: 'dropped £41 (9%) from £430' });
    const body = renderBody(renderInput({ rule: { ...RULE, type: 'dropAbs', thresholdPence: 2000, basis: 'calendar', requireAllVerified: null }, items: [f], coverage: { kind: 'no-verification' } }));
    for (const line of [
      'calendar price, no itinerary; constraints not checked',
      'Previous: £430, fetched 3d ago',
      'Provenance: Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
      'Coverage: itinerary-searched 0 cells (no verification provider configured)',
      'Rule: alert when the price drops by £20 or more · calendar prices, constraints not checked · cooldown 336h',
    ]) expect(body).toContain(line);
  });
  it('lists newcomers in their own section with a count of the rest', () => {
    const body = renderBody(renderInput({ newcomers: [calendarCandidate()], newcomersRest: 4 }));
    expect(body).toContain('New since the last check (no earlier price to compare; not a drop):');
    expect(body).toContain('- £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache');
    expect(body).toContain('and 4 more new');
  });
});

describe('provider strings are CRLF/control-stripped (spec §8.3)', () => {
  it('a seller name cannot inject headers or lines', () => {
    const c = verifiedCandidate({ seller: 'Cheap Seats\r\nBcc: victim@example.com\u0007' });
    const body = renderBody(renderInput({ items: [firing(c)], definitionName: 'Trip\r\nX-Injected: 1' }));
    expect(body).not.toMatch(/\r/);
    expect(body.split('\n').some((l) => l.startsWith('Bcc:') || l.startsWith('X-Injected:'))).toBe(false);
    expect(body).toContain('Seller: Cheap Seats Bcc: victim@example.com');
    expect(renderSubject(firing(c), NOW)).not.toMatch(/[\r\n]/);
  });
  it('stripControl removes C0, C1 and line separators', () => {
    expect(stripControl('\u0000a b\tc\u0085d\r\n')).toBe('a b c d');
  });
});

describe('banned words over rendered output (spec §8.3, §11)', () => {
  it('no banned word in any rendered subject or body', () => {
    const outputs = [
      renderSubject(firing(verifiedCandidate()), NOW), renderSubject(firing(calendarCandidate()), NOW),
      renderBody(renderInput({ restCount: 40, newcomers: [calendarCandidate()], newcomersRest: 2 })),
      renderBody(renderInput({ items: [firing(calendarCandidate(), { kind: 'drop', previous: { pricePence: 43000, fetchedAt: NOW } })], coverage: { kind: 'no-verification' } })),
      renderBody(renderInput({ items: [firing(verifiedCandidate({ booking: { kind: 'none' } }))] })),
    ];
    for (const text of outputs) expect(findBannedWords(text)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts`
Expected: FAIL — `../../src/alerts/templates.js` cannot be resolved.

- [ ] **Step 3: Implement** `packages/engine/src/alerts/templates.ts`:

```ts
/**
 * Plain-text alert email: subject and body formats of spec §8.3, labels from core (spec §3, §11).
 * Every provider-supplied string passes stripControl before it is written.
 */
import {
  effectiveAge, formatAgeFull, formatDuration, searchLinkFor,
  type AlertCandidate, type AlertRule, type ConstraintName, type Firing, type IsoDateTime, type Provenance,
  type Segment, type VerifiedCandidate, type CalendarCandidate,
} from '@gmt/core';

/** Coverage line input: the execution's verification counts, or the absence of a verification provider. */
export type CoverageCaveat = { kind: 'verification'; itinerarySearched: number; selected: number; expandTop: number } | { kind: 'no-verification' };

/** Everything renderBody needs; built by the runner. */
export interface DigestRenderInput {
  rule: AlertRule; definitionId: string; definitionName: string; items: readonly Firing[]; restCount: number;
  newcomers: readonly AlertCandidate[]; newcomersRest: number; coverage: CoverageCaveat; now: IsoDateTime;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const HOUR_MS = 3_600_000;

/** Human names for constraint keys, used when naming unverified constraints. Spec §6.2. */
const CONSTRAINT_LABELS: Record<ConstraintName, string> = {
  cabin: 'cabin', maxStops: 'max stops', maxJourneyMinutes: 'max journey', minLayoverMinutes: 'min layover',
  maxLayoverMinutes: 'max layover', noOvernightLayover: 'no overnight layover', departureWindowLocal: 'departure window',
  arrivalWindowLocal: 'arrival window', noSelfTransfer: 'no self-transfer', noAirportChange: 'no airport change',
  includeAirlines: 'include airlines', excludeAirlines: 'exclude airlines', cabinBagRequired: 'cabin bag',
  checkedBagRequired: 'checked bag', minCheckedBags: 'min checked bags', maxPricePence: 'max price',
};

/**
 * Removes CR, LF, every other C0/C1 control and the Unicode line/paragraph separators, collapsing runs to one space.
 * Spec §8.3: provider strings are CRLF/control-stripped so none can start a header or a line.
 */
export function stripControl(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose of this function.
  return s.replace(/[\u0000-\u001f\u007f-\u009f  ]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Source in words (spec §11): "Google via SearchApi", "Aviasales cache". Synthetic rows have no label and throw. */
export function sourceLabel(p: Provenance): string {
  if (p.providerId === 'searchapi' && p.sourceKind === 'scraped-search') return 'Google via SearchApi';
  if (p.providerId === 'searchapi' && p.sourceKind === 'scraped-aggregate') return 'Google date grid via SearchApi';
  if (p.providerId === 'travelpayouts' && p.sourceKind === 'authorised-cached') return 'Aviasales cache';
  throw new Error(`templates: no source label for ${p.providerId}/${p.sourceKind}; synthetic rows are refused (spec §5.5)`);
}

/** "£412", "£1,234.50"; integer pence in, never a float. */
function pounds(pence: number): string {
  const whole = Math.floor(pence / 100).toLocaleString('en-GB');
  const rest = pence % 100;
  return rest === 0 ? `£${whole}` : `£${whole}.${String(rest).padStart(2, '0')}`;
}

/** "14 Mar" from a calendar date string; never through Date (spec §6.1). */
function day(d: string): string {
  const [, m, dd] = d.slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? m}`;
}

function hours(from: IsoDateTime, to: IsoDateTime): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / HOUR_MS);
}

/** Effective age in the core full form; an interactive search (maxAgeHours 0) reads just "fetched 5h ago". */
function ageText(p: Provenance, now: IsoDateTime): string {
  const a = effectiveAge(p, now);
  const full = formatAgeFull(a);
  // why: spec §8.3's verified example reads "fetched 5h ago" with nothing after it; a 0-hour provider bound adds no information.
  return a.kind === 'bounded' && a.maxAgeHours === 0 ? (full.split(' · ')[0] ?? full) : full;
}

/** "£412 LHR→JFK 14 Mar–28 Mar (14n)", with "≈" when FX-converted (spec §11). */
export function routeLine(c: AlertCandidate): string {
  const price = `${c.provenance.fx.converted ? '≈' : ''}${pounds(c.pricePence)}`;
  return `${price} ${c.cell.origin}→${c.cell.destination} ${day(c.cell.departureDate)}–${day(c.cell.returnDate)} (${c.cell.nights}n)`;
}

function verdictSegment(c: AlertCandidate): string {
  if (c.basis === 'calendar') return 'constraints not checked';
  if (c.verdictClass === 'verified') return 'class verified';
  const n = c.unverified.length;
  return `${n} constraint${n === 1 ? '' : 's'} unverified`;
}

/** Spec §8.3 subject for the digest's first (cheapest) item. */
export function renderSubject(item: Firing, now: IsoDateTime): string {
  const c = item.candidate;
  return stripControl(`[get-me-there] ${routeLine(c)} · ${sourceLabel(c.provenance)} · ${ageText(c.provenance, now)} · ${verdictSegment(c)}`);
}

/** The app path of a results row; POST bookings link here because email cannot submit a form. */
export function appRowPath(definitionId: string, itineraryHash: string): string {
  return `/definitions/${encodeURIComponent(definitionId)}/results?basis=verified&row=${encodeURIComponent(itineraryHash)}`;
}

function segmentLine(s: Segment): string {
  const hhmm = (local: string) => local.slice(11, 16);
  return `${stripControl(s.marketingCarrier)} ${s.flightNumber} ${s.from} ${hhmm(s.departLocal)} → ${s.to} ${hhmm(s.arriveLocal)} (${day(s.departLocal)})`;
}

function expiryText(expiresAt: IsoDateTime | null, now: IsoDateTime): string {
  if (expiresAt === null) return 'expiry not stated';
  const h = hours(now, expiresAt);
  if (h > 0) return `expires in ${formatDuration(h)}`;
  const ago = -h;
  return ago < 1 ? 'expired just now' : `expired ${formatDuration(ago)} ago`;
}

/** https, no userinfo, host equal to the stored host. Spec §5.2 rules, re-checked at render time. */
function validHttps(url: string, host: string | null): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
    if (host !== null && u.host !== host) return null;
    return u;
  } catch {
    return null;
  }
}

function searchLinkLine(c: AlertCandidate): string {
  const s = searchLinkFor(c.provenance.providerId, c.cell, c.provenance.cabin);
  return `Link: ${s.url} (host ${s.host}, ${s.label})`;
}

function verifiedLinkLine(c: VerifiedCandidate, definitionId: string, now: IsoDateTime): string {
  const b = c.booking;
  if (b.kind === 'post') return `Link: this fare is booked through a form, which email cannot submit; open the results row in get-me-there at ${appRowPath(definitionId, c.itineraryHash)}`;
  if (b.kind === 'none') return searchLinkLine(c);
  // why: spec §8.3 shows the validated https link with its query (a booking link is useless without it); it carries no credentials.
  return validHttps(b.url, b.host) === null ? 'Link: none (the stored link failed validation)' : `Link: ${b.url} (host ${b.host}, ${expiryText(c.bookingExpiresAt, now)})`;
}

function calendarLinkLine(c: CalendarCandidate): string {
  if (c.vendorLink === null) return searchLinkLine(c);
  const u = validHttps(c.vendorLink, null);
  return u === null ? searchLinkLine(c) : `Link: ${c.vendorLink} (host ${u.host}, calendar price link, not a fare link)`;
}

function itemLines(n: number, f: Firing, input: DigestRenderInput): string[] {
  const c = f.candidate;
  const lines = [`${n}. ${routeLine(c)}`, `   Why: ${stripControl(f.reason)}`];
  if (c.basis === 'verified') {
    lines.push(`   Seller: ${stripControl(c.seller)}`);
    lines.push(`   Outbound: ${c.outbound.map(segmentLine).join('; ')}`);
    lines.push(`   Inbound: ${c.inbound.map(segmentLine).join('; ')}`);
    lines.push(c.verdictClass === 'verified'
      ? '   Verdicts: class verified; every constraint passed'
      : `   Verdicts: class partially-verified; unverified: ${c.unverified.map((k) => CONSTRAINT_LABELS[k]).join(', ')}`);
  } else {
    lines.push('   calendar price, no itinerary; constraints not checked');
  }
  if (f.previous !== null) lines.push(`   Previous: ${pounds(f.previous.pricePence)}, fetched ${formatDuration(Math.max(0, hours(f.previous.fetchedAt, input.now)))} ago`);
  lines.push(`   Provenance: ${sourceLabel(c.provenance)} · ${ageText(c.provenance, input.now)}`);
  lines.push(`   ${c.basis === 'verified' ? verifiedLinkLine(c, input.definitionId, input.now) : calendarLinkLine(c)}`);
  return lines;
}

function ruleText(r: AlertRule): string {
  const what = r.type === 'absolute' ? `alert when the price is ${pounds(r.thresholdPence ?? 0)} or less`
    : r.type === 'dropAbs' ? `alert when the price drops by ${pounds(r.thresholdPence ?? 0)} or more`
    : `alert when the price drops by ${r.pct ?? 0}% or more`;
  const basis = r.basis === 'calendar' ? 'calendar prices, constraints not checked'
    : r.requireAllVerified === true ? 'itinerary prices (class verified only)' : 'itinerary prices (class verified or partially-verified)';
  return `${what} · ${basis} · cooldown ${r.cooldownHours}h`;
}

function coverageText(c: CoverageCaveat): string {
  return c.kind === 'no-verification'
    ? 'Coverage: itinerary-searched 0 cells (no verification provider configured)'
    : `Coverage: itinerary-searched ${c.itinerarySearched} of ${c.selected} cells, ${c.expandTop} outbounds each`;
}

/** Spec §8.3 body. Lines are joined with LF only. */
export function renderBody(input: DigestRenderInput): string {
  const lines = [`get-me-there alert for "${stripControl(input.definitionName)}"`, ''];
  input.items.forEach((f, i) => {
    lines.push(...itemLines(i + 1, f, input), '');
  });
  if (input.restCount > 0) lines.push(`and ${input.restCount} more`, '');
  if (input.newcomers.length > 0) {
    lines.push('New since the last check (no earlier price to compare; not a drop):');
    for (const c of input.newcomers) lines.push(`- ${routeLine(c)} · ${sourceLabel(c.provenance)} · ${ageText(c.provenance, input.now)}`);
    if (input.newcomersRest > 0) lines.push(`and ${input.newcomersRest} more new`);
    lines.push('');
  }
  lines.push(coverageText(input.coverage), `Rule: ${ruleText(input.rule)}`);
  return lines.join('\n');
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { renderSubject, renderBody, stripControl, sourceLabel, routeLine, appRowPath, type CoverageCaveat, type DigestRenderInput } from './alerts/templates.js';
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts` → PASS, 13 tests.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: plain-text alert templates in the spec §8.3 formats"`

### Task 11.3: The runner renders with the engine templates and the coverage caveat

**Files:** Modify `packages/engine/src/alerts/runner.ts`; Test `packages/engine/test/alerts/runner.render.test.ts`.

**Interfaces:** consumes `renderSubject`, `renderBody`, `CellsRepo.selected`, `CellsRepo.outcomes`, `cellKeyString`, `candidateRef`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/alerts/runner.render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, harness, LGW, seedCalendar, seedDefinition, seedExecution, seedRule, seedVerificationCoverage } from './harness.js';

describe('digest subject and body come from the engine templates (spec §8.3)', () => {
  it('subject of the cheapest item, "and 40 more", and the itinerary-searched caveat', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 50000, basis: 'calendar' });
    seedCalendar(h, ex, cells(50).map((cell, i) => ({ cell, pricePence: 40000 + i * 100 })));
    seedVerificationCoverage(h, ex, cells(10, LGW), 3);

    await runAlerts(h.deps, ex);

    const [digest] = h.notifier.digests();
    expect(digest?.subject).toBe('[get-me-there] £400 LHR→JFK 1 Nov–15 Nov (14n) · Google date grid via SearchApi · fetched just now · provider age unknown (≤24h before that) · constraints not checked');
    expect(digest?.body).toContain('and 40 more');
    expect(digest?.body).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');
    expect(digest?.body).toContain('get-me-there alert for "London to New York (worked example)"');
  });

  it('a definition without a verification provider says so in the caveat', async () => {
    const h = harness();
    const def = seedDefinition(h, { providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } });
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 50000, basis: 'calendar' });
    seedCalendar(h, ex, cells(1).map((cell) => ({ cell, pricePence: 40000, providerId: 'travelpayouts' as const })));
    await runAlerts(h.deps, ex);
    expect(h.notifier.digests()[0]?.body).toContain('Coverage: itinerary-searched 0 cells (no verification provider configured)');
  });

  it('a drop rule with no earlier price lists the cells as new and sends nothing', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedRule(h, def, { type: 'dropAbs', thresholdPence: 1000, basis: 'calendar' });
    seedCalendar(h, ex, cells(3).map((cell) => ({ cell, pricePence: 40000 })));
    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(h.notifier.sent).toHaveLength(0);
  });
});
```

`// why:` the selected cells use LGW so they are distinct from the 50 LHR calendar cells; the caveat counts verification outcomes, not calendar rows.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.render.test.ts` → FAIL: `expected … to be '[get-me-there] £400 LHR→JFK 1 Nov–15 Nov (14n) · …'` (the subject is still core's `buildDigest` text) and the body lacks the coverage line.

- [ ] **Step 3: Implement.** In `runner.ts`, extend the imports:

```ts
import { candidateRef, cellKeyString } from '@gmt/core';
import { renderBody, renderSubject, type CoverageCaveat } from './templates.js';
```

Replace `runRule` and `deliver` with:

```ts
const NEWCOMER_LIMIT = 10;

async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const pool = poolFor(ctx, rule.basis);
  const firings = evaluateAlertRules([rule], pool.candidates, pool.previous, ctx.now);
  if (firings.length === 0) return NONE;
  // why: spec §6.8 — absent-then-present is listed as "new", never a drop firing; it rides along only when something fired.
  const newcomers = rule.type === 'absolute' ? [] : pool.candidates.filter((c) => !pool.previous.has(candidateRef(c))).sort((a, b) => a.pricePence - b.pricePence);
  return deliver(ctx, rule, firings, newcomers);
}

/** Builds and sends one digest, then writes one event per firing in one transaction. */
async function deliver(ctx: RunContext, rule: AlertRule, firings: Firing[], newcomers: AlertCandidate[]): Promise<AlertRunResult> {
  const digestId = randomUUID();
  const base = buildDigest(rule, firings);
  const [first] = base.items;
  if (first === undefined) return NONE;
  // why: core's buildDigest chooses and orders the items; the wording is the engine's spec §8.3 templates (finding WP11-C3).
  const digest: AlertDigest = {
    ...base, executionId: ctx.executionId,
    subject: renderSubject(first, ctx.now),
    body: renderBody({
      rule, definitionId: ctx.definition.id, definitionName: ctx.definition.name, items: base.items, restCount: base.restCount,
      newcomers: newcomers.slice(0, NEWCOMER_LIMIT), newcomersRest: Math.max(0, newcomers.length - NEWCOMER_LIMIT),
      coverage: coverageFor(ctx), now: ctx.now,
    }),
  };
  const outcome = await sendToAll(ctx, digest);
  ctx.deps.db.transaction(() => {
    for (const f of firings) {
      ctx.deps.repos.alerts.insertEvent({
        ruleId: rule.id, identityKey: f.identityKey,
        observationId: f.candidate.basis === 'verified' ? f.candidate.observationId : null,
        calendarPriceId: f.candidate.basis === 'calendar' ? f.candidate.calendarPriceId : null,
        dedupKey: f.dedupKey, firedAt: ctx.now, status: outcome.status,
        reason: outcome.status === 'sent' ? f.reason : `${f.reason}; not delivered: ${outcome.detail}`,
        payloadJson: JSON.stringify({ digestId, executionId: ctx.executionId, kind: f.kind, pricePence: f.candidate.pricePence, previousPence: f.previous?.pricePence ?? null, label: eventLabel(f.candidate) }),
      });
    }
  });
  return { digests: 1, events: firings.length };
}

/** "itinerary-searched K of N cells, E outbounds each" for this execution (spec §8.3, §11 wording). */
function coverageFor(ctx: RunContext): CoverageCaveat {
  if (ctx.snapshot.providers.verification.length === 0) return { kind: 'no-verification' };
  const selected = ctx.deps.repos.cells.selected(ctx.executionId).length;
  const searched = new Set(
    ctx.deps.repos.cells.outcomes(ctx.executionId)
      .filter((o) => o.stage === 'verification' && (o.status === 'priced' || o.status === 'empty'))
      .map((o) => cellKeyString(o)),
  );
  return { kind: 'verification', itinerarySearched: searched.size, selected, expandTop: ctx.snapshot.verification.expandTop };
}
```

Replace `eventLabel` with `function eventLabel(c: AlertCandidate): string { return routeLine(c); }` and add `routeLine` to the `./templates.js` import.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/alerts/` → PASS (runner.digest, runner.render, templates).

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: digests rendered by the engine templates with the coverage caveat"`

### Task 11.4: Verified basis — current-execution observations, identity, requireAllVerified, drops

**Files:** Modify `packages/engine/src/alerts/runner.ts`, `packages/engine/src/alerts/queries.ts`; Test `packages/engine/test/alerts/runner.verified.test.ts`.

**Interfaces:** consumes `ItinerariesRepo.observationsForDefinition`, `evaluateConstraints`, `verdictClass`; produces `alertQueries().previousObservation`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/alerts/runner.verified.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { ALL_FIELDS, harness, hoursBefore, NOW, payloadOf, seedDefinition, seedExecution, seedObservation, seedRule } from './harness.js';

const WITHOUT_BAGGAGE = ALL_FIELDS.filter((f) => f !== 'baggage');   // checkedBagRequired → unverified

function scenario() {
  const h = harness();
  const def = seedDefinition(h);
  const earlier = seedExecution(h, def);
  const ex = seedExecution(h, def);
  // A: seen at £500 earlier, £420 now, every constraint passes → class verified
  seedObservation(h, earlier, { departureDate: asIsoDate('2026-11-02'), pricePence: 50000, flight: 117, fetchedAt: hoursBefore(NOW, 168) });
  const a = seedObservation(h, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000, flight: 117 });
  // B: first seen now at £410, baggage not supplied → partially-verified
  const b = seedObservation(h, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 41000, flight: 177, suppliedFields: WITHOUT_BAGGAGE });
  // C: written by the earlier execution only → never a candidate of this one
  seedObservation(h, earlier, { departureDate: asIsoDate('2026-11-04'), pricePence: 30000, flight: 115, fetchedAt: hoursBefore(NOW, 168) });
  return { h, def, ex, a, b };
}

describe('verified basis (spec §6.8)', () => {
  it('candidates are observations written by the current execution; identity is (ruleId, itineraryHash)', async () => {
    const { h, def, ex, a, b } = scenario();
    const rule = seedRule(h, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = h.repos.alerts.events({ ruleId: rule.id });
    expect(events.map((e) => e.identityKey).sort()).toEqual([`${rule.id}|${a.itineraryHash}`, `${rule.id}|${b.itineraryHash}`].sort());
    expect(events.every((e) => e.observationId !== null && e.calendarPriceId === null)).toBe(true);
    expect(h.notifier.digests()[0]?.body).toContain('unverified: checked bag');
  });

  it('requireAllVerified admits class verified only', async () => {
    const { h, def, ex, a } = scenario();
    const rule = seedRule(h, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: true });
    await runAlerts(h.deps, ex);
    expect(h.repos.alerts.events({ ruleId: rule.id }).map((e) => e.identityKey)).toEqual([`${rule.id}|${a.itineraryHash}`]);
  });

  it('a drop compares the offer with its previous observation; a first sighting is new, not a drop', async () => {
    const { h, def, ex, b } = scenario();
    const rule = seedRule(h, def, { basis: 'verified', type: 'dropPct', thresholdPence: null, pct: 10, requireAllVerified: false });
    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = h.repos.alerts.events({ ruleId: rule.id });
    expect(event === undefined ? null : payloadOf(event)).toMatchObject({ kind: 'drop', pricePence: 42000, previousPence: 50000 });
    const body = h.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Previous: £500, fetched 7d ago');
    expect(body).toContain('New since the last check');
    expect(body).toContain('£410 LHR→JFK 3 Nov–17 Nov (14n)');
    expect(h.repos.alerts.events({ ruleId: rule.id }).some((e) => e.observationId === b.observationId)).toBe(false);
  });

  it('the cheapest offer per itinerary represents it once', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedObservation(h, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 44000, seller: 'British Airways' });
    seedObservation(h, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 43000, seller: 'An agency' });
    const rule = seedRule(h, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(h.repos.alerts.events({ ruleId: rule.id }).map((e) => payloadOf(e).pricePence)).toEqual([43000]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.verified.test.ts` → FAIL: `expected { digests: 0, events: 0 } to deeply equal { digests: 1, events: 2 }` (the verified pool is empty).

- [ ] **Step 3: Implement.** In `queries.ts`, prepare one more statement next to `calendarByExecution`:

```ts
  const previousObs = db.raw.prepare(
    `SELECT price_pence, fetched_at FROM price_observations
      WHERE offer_id = ? AND fetched_at < ?
      ORDER BY fetched_at DESC, id DESC LIMIT 1`,
  );
```

add to the `AlertQueries` interface

```ts
  previousObservation(offerId: number, before: IsoDateTime): PreviousPrice | null;
```

and to the returned object (adding `type IsoDateTime, type PreviousPrice` to the core import):

```ts
    previousObservation(offerId, before) {
      const r = previousObs.get(offerId, before) as { price_pence: number; fetched_at: string } | undefined;
      return r === undefined ? null : { pricePence: r.price_pence, fetchedAt: asIsoDateTime(r.fetched_at) };
    },
```

In `runner.ts`, add `evaluateConstraints`, `verdictClass`, `type ConstraintName`, `type VerifiedCandidate` to the `@gmt/core` import, replace the `poolFor` body's pool line with

```ts
  const pool = basis === 'calendar' ? calendarPool(ctx) : verifiedPool(ctx);
```

and add:

```ts
/**
 * Observations written by this execution, verdicts recomputed against the current definition (spec §6.2),
 * failed excluded, the cheapest offer per itinerary kept; previous = that offer's previous observation. Spec §6.8.
 */
function verifiedPool(ctx: RunContext): Pool {
  const rows = ctx.deps.repos.itineraries.observationsForDefinition(ctx.definition.id, [ctx.executionId], ctx.snapshot.resolved, ctx.snapshot.cabin);
  const best = new Map<string, VerifiedCandidate>();
  for (const row of rows) {
    const obs = row.observation;
    // why: spec §6.8 — candidates are observations written by the current execution, never older ones.
    if (obs.executionId !== ctx.executionId) continue;
    const verdicts = evaluateConstraints(row.itinerary, obs, ctx.definition.constraints, obs.suppliedFields);
    const cls = verdictClass(verdicts);
    if (cls === 'failed') continue;
    const unverified = (Object.keys(verdicts) as ConstraintName[]).filter((k) => verdicts[k] === 'unverified');
    const it = row.itinerary;
    const candidate: VerifiedCandidate = {
      basis: 'verified', observationId: obs.id, offerId: obs.offerId, itineraryHash: it.hash,
      cell: { origin: it.origin, destination: it.destination, departureDate: it.departureDate, returnDate: it.returnDate, nights: it.nights },
      pricePence: obs.pricePence, provenance: obs.provenance, seller: row.offer.seller, verdictClass: cls, unverified, verdicts,
      outbound: it.outbound, inbound: it.inbound, booking: obs.booking, bookingExpiresAt: obs.bookingExpiresAt,
    };
    const held = best.get(it.hash);
    if (held === undefined || candidate.pricePence < held.pricePence) best.set(it.hash, candidate);
  }
  const candidates = [...best.values()];
  const previous = new Map<string, PreviousPrice>();
  for (const c of candidates) {
    const p = ctx.queries.previousObservation(c.offerId, c.provenance.fetchedAt);
    if (p !== null) previous.set(candidateRef(c), p);
  }
  return { candidates, previous };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/alerts/` → PASS.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: verified-basis alert candidates from the current execution, drops vs previous observation"`

### Task 11.5: Calendar basis — identity, drop window at 2 × discoveryRefreshHours, new section

**Files:** Modify `packages/engine/src/alerts/runner.ts`, `packages/engine/src/alerts/queries.ts`; Test `packages/engine/test/alerts/runner.calendar.test.ts`.

**Interfaces:** produces `alertQueries().previousCalendarPrice`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/alerts/runner.calendar.test.ts`:

```ts
import { cellKeyString } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, harness, hoursBefore, NOW, payloadOf, seedCalendar, seedDefinition, seedExecution, seedRule } from './harness.js';

// why: discoveryRefreshHours 84 puts the spec §6.8 window (2 × refresh) at 168 h, the boundary the spec tests at 167/168/169 h.
function scenario() {
  const h = harness();
  const def = seedDefinition(h, { providers: { discovery: ['searchapi'], verification: ['searchapi'], discoveryRefreshHours: { searchapi: 84 } } });
  const earlier = seedExecution(h, def);
  const ex = seedExecution(h, def);
  const [c167, c168, c169] = cells(3);
  if (c167 === undefined || c168 === undefined || c169 === undefined) throw new Error('cells');
  seedCalendar(h, earlier, [
    { cell: c167, pricePence: 50000, fetchedAt: hoursBefore(NOW, 167) },
    { cell: c168, pricePence: 50000, fetchedAt: hoursBefore(NOW, 168) },
    { cell: c169, pricePence: 50000, fetchedAt: hoursBefore(NOW, 169) },
  ]);
  seedCalendar(h, ex, [c167, c168, c169].map((cell) => ({ cell, pricePence: 40000 })));
  return { h, def, ex, c167, c168, c169 };
}

describe('calendar basis (spec §6.8)', () => {
  it('drops compare only with a previous price fetched within 2 × discoveryRefreshHours (167 h, 168 h in; 169 h out)', async () => {
    const { h, def, ex, c167, c168, c169 } = scenario();
    const rule = seedRule(h, def, { type: 'dropAbs', thresholdPence: 5000, basis: 'calendar' });
    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = h.repos.alerts.events({ ruleId: rule.id });
    expect(events.map((e) => e.identityKey).sort()).toEqual(
      [c167, c168].map((c) => `${rule.id}|searchapi|economy|${cellKeyString(c)}`).sort(),
    );
    expect(events.every((e) => payloadOf(e).kind === 'drop' && payloadOf(e).previousPence === 50000)).toBe(true);
    const body = h.notifier.digests()[0]?.body ?? '';
    // the 169 h cell is absent-then-present: listed as new, never a drop firing
    expect(body).toContain('New since the last check');
    expect(body).toContain(`£400 LHR→JFK 3 Nov–17 Nov (14n) · Google date grid via SearchApi`);
    expect(events.some((e) => e.identityKey.endsWith(cellKeyString(c169)))).toBe(false);
  });

  it('absolute rules still apply to an absent-then-present cell', async () => {
    const { h, def, ex, c169 } = scenario();
    const rule = seedRule(h, def, { type: 'absolute', thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(h.deps, ex);
    expect(h.repos.alerts.events({ ruleId: rule.id }).some((e) => e.identityKey.endsWith(cellKeyString(c169)))).toBe(true);
  });

  it('identity separates providers for the same cell', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');
    seedCalendar(h, ex, [{ cell, pricePence: 40000, providerId: 'searchapi' }, { cell, pricePence: 39000, providerId: 'travelpayouts' }]);
    const rule = seedRule(h, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(h.deps, ex);
    expect(h.repos.alerts.events({ ruleId: rule.id }).map((e) => e.identityKey).sort()).toEqual(
      [`${rule.id}|searchapi|economy|${cellKeyString(cell)}`, `${rule.id}|travelpayouts|economy|${cellKeyString(cell)}`].sort(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.calendar.test.ts` → FAIL: the drop test reports `{ digests: 0, events: 0 }` (no previous prices gathered yet).

- [ ] **Step 3: Implement.** In `queries.ts`, prepare:

```ts
  const previousCal = db.raw.prepare(
    `SELECT price_pence, fetched_at FROM calendar_prices
      WHERE provider_id = ? AND cabin = ? AND origin = ? AND destination = ? AND departure_date = ? AND return_date = ?
        AND reused_from_execution_id IS NULL AND fetched_at < ? AND fetched_at >= ?
      ORDER BY fetched_at DESC, id DESC LIMIT 1`,
  );
```

add to the `AlertQueries` interface

```ts
  previousCalendarPrice(p: { providerId: ProviderId; cabin: Cabin; cell: CellKey; before: IsoDateTime; notBefore: IsoDateTime }): PreviousPrice | null;
```

and to the returned object (adding `type CellKey` to the core import):

```ts
    previousCalendarPrice({ providerId, cabin, cell, before, notBefore }) {
      // why: toISOString timestamps compare correctly as text; reused copies are never a previous price (spec §6.8, §7).
      const r = previousCal.get(providerId, cabin, cell.origin, cell.destination, cell.departureDate, cell.returnDate, before, notBefore) as { price_pence: number; fetched_at: string } | undefined;
      return r === undefined ? null : { pricePence: r.price_pence, fetchedAt: asIsoDateTime(r.fetched_at) };
    },
```

In `runner.ts`, add `asIsoDateTime` to the core import and replace `calendarPool`:

```ts
const DEFAULT_REFRESH_HOURS = 168;
const HOUR_MS = 3_600_000;

/**
 * Calendar prices fetched by this execution in the snapshot's cabin, reused rows excluded; previous = the latest earlier
 * price for (provider, cabin, cell) whose fetchedAt is within 2 × that provider's discoveryRefreshHours (inclusive). Spec §6.8.
 */
function calendarPool(ctx: RunContext): Pool {
  const rows = ctx.queries.calendarFetchedByExecution(ctx.executionId, ctx.snapshot.cabin);
  const candidates: CalendarCandidate[] = [];
  const previous = new Map<string, PreviousPrice>();
  for (const r of rows) {
    const c: CalendarCandidate = { basis: 'calendar', calendarPriceId: r.id, cell: r.cell, pricePence: r.pricePence, provenance: r.provenance, vendorLink: r.vendorLink };
    candidates.push(c);
    const refresh = ctx.snapshot.providers.discoveryRefreshHours[r.providerId] ?? DEFAULT_REFRESH_HOURS;
    const fetched = new Date(r.provenance.fetchedAt).getTime();
    const p = ctx.queries.previousCalendarPrice({
      providerId: r.providerId, cabin: r.cabin, cell: r.cell, before: r.provenance.fetchedAt,
      notBefore: asIsoDateTime(new Date(fetched - 2 * refresh * HOUR_MS).toISOString()),
    });
    if (p !== null) previous.set(candidateRef(c), p);
  }
  return { candidates, previous };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/alerts/` → PASS.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: calendar-basis drops within 2 x discoveryRefreshHours, absent-then-present listed as new"`

### Task 11.6: dedupKey cooldown across executions, failed deliveries

**Files:** Modify `packages/engine/src/alerts/runner.ts`, `packages/engine/src/alerts/queries.ts`; Test `packages/engine/test/alerts/runner.dedup.test.ts`.

**Interfaces:** consumes `isSuppressed`; produces `alertQueries().firingHistory`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/alerts/runner.dedup.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, harness, RecordingNotifier, seedCalendar, seedDefinition, seedExecution, seedObservation, seedRule } from './harness.js';

const DAY = 24 * 3_600_000;

describe('cooldown across executions (spec §6.8, §9 item 4)', () => {
  it('calendar basis: the same price band within cooldownHours is suppressed with a reason; after the cooldown it sends again', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const rule = seedRule(h, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 336 });
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');

    const first = seedExecution(h, def);
    seedCalendar(h, first, [{ cell, pricePence: 41200 }]);
    expect(await runAlerts(h.deps, first)).toEqual({ digests: 1, events: 1 });

    h.clock.advance(7 * DAY);
    const second = seedExecution(h, def);
    seedCalendar(h, second, [{ cell, pricePence: 41250 }]);   // same £412 band
    expect(await runAlerts(h.deps, second)).toEqual({ digests: 0, events: 1 });
    expect(h.notifier.digests()).toHaveLength(1);
    const suppressed = h.repos.alerts.events({ ruleId: rule.id }).filter((e) => e.status === 'suppressed');
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.reason ?? '').not.toBe('');

    h.clock.advance(8 * DAY);   // 15 days after the first send: past 336 h
    const third = seedExecution(h, def);
    seedCalendar(h, third, [{ cell, pricePence: 41250 }]);
    expect(await runAlerts(h.deps, third)).toEqual({ digests: 1, events: 1 });
  });

  it('a lower price for the same identity inside the cooldown is not suppressed; an equal-or-higher band is', async () => {
    const h = harness();
    const def = seedDefinition(h);
    seedRule(h, def, { thresholdPence: 45000, basis: 'calendar' });
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');
    const first = seedExecution(h, def);
    seedCalendar(h, first, [{ cell, pricePence: 41200 }]);
    await runAlerts(h.deps, first);

    h.clock.advance(DAY);
    const higher = seedExecution(h, def);
    seedCalendar(h, higher, [{ cell, pricePence: 43000 }]);
    expect(await runAlerts(h.deps, higher)).toEqual({ digests: 0, events: 1 });

    h.clock.advance(DAY);
    const lower = seedExecution(h, def);
    seedCalendar(h, lower, [{ cell, pricePence: 39000 }]);
    expect(await runAlerts(h.deps, lower)).toEqual({ digests: 1, events: 1 });
  });

  it('verified basis: the same itinerary and band in the next execution is suppressed', async () => {
    const h = harness();
    const def = seedDefinition(h);
    seedRule(h, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const first = seedExecution(h, def);
    seedObservation(h, first, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    expect(await runAlerts(h.deps, first)).toEqual({ digests: 1, events: 1 });
    h.clock.advance(7 * DAY);
    const second = seedExecution(h, def);
    seedObservation(h, second, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000, fetchedAt: h.clock.now() });
    expect(await runAlerts(h.deps, second)).toEqual({ digests: 0, events: 1 });
  });

  it('a failed delivery is recorded as failed and does not suppress the next execution', async () => {
    const h = harness(new RecordingNotifier('email', { ok: false, detail: 'connection refused' }));
    const def = seedDefinition(h);
    const rule = seedRule(h, def, { thresholdPence: 45000, basis: 'calendar' });
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');
    const first = seedExecution(h, def);
    seedCalendar(h, first, [{ cell, pricePence: 41200 }]);
    await runAlerts(h.deps, first);
    const [failed] = h.repos.alerts.events({ ruleId: rule.id });
    expect(failed?.status).toBe('failed');
    expect(failed?.reason).toContain('not delivered: email: connection refused');

    h.clock.advance(DAY);
    const second = seedExecution(h, def);
    seedCalendar(h, second, [{ cell, pricePence: 41200 }]);
    expect(await runAlerts(h.deps, second)).toEqual({ digests: 1, events: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.dedup.test.ts` → FAIL: the second run returns `{ digests: 1, events: 1 }` instead of `{ digests: 0, events: 1 }`.

- [ ] **Step 3: Implement.** In `queries.ts`, prepare:

```ts
  const history = db.raw.prepare(
    `SELECT
       (SELECT MAX(fired_at) FROM alert_events
         WHERE rule_id = @ruleId AND dedup_key = @dedupKey AND status = 'sent' AND fired_at >= @since) AS sameKeySentAt,
       (SELECT MIN(CAST(json_extract(payload_json, '$.pricePence') AS INTEGER)) FROM alert_events
         WHERE rule_id = @ruleId AND identity_key = @identityKey AND status = 'sent' AND fired_at >= @since) AS lowestSentPence`,
  );
```

add to the `AlertQueries` interface

```ts
  firingHistory(p: { ruleId: string; identityKey: string; dedupKey: string; since: IsoDateTime }): FiringHistory;
```

and to the returned object (adding `type FiringHistory` to the core import):

```ts
    firingHistory(p) {
      // why: only delivered digests count as "fired" (spec §6.8); a failed send must not silence the next run.
      const r = history.get(p) as { sameKeySentAt: string | null; lowestSentPence: number | null };
      return { sameKeySentAt: r.sameKeySentAt === null ? null : asIsoDateTime(r.sameKeySentAt), lowestSentPence: r.lowestSentPence };
    },
```

In `runner.ts`, add `isSuppressed` to the core import and replace `runRule`:

```ts
async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const pool = poolFor(ctx, rule.basis);
  const firings = evaluateAlertRules([rule], pool.candidates, pool.previous, ctx.now);
  if (firings.length === 0) return NONE;
  const since = asIsoDateTime(new Date(new Date(ctx.now).getTime() - rule.cooldownHours * HOUR_MS).toISOString());
  const sendable: Firing[] = [];
  const suppressed: Array<{ f: Firing; reason: string }> = [];
  for (const f of firings) {
    const s = isSuppressed(f, ctx.queries.firingHistory({ ruleId: rule.id, identityKey: f.identityKey, dedupKey: f.dedupKey, since }));
    if (s.suppressed) suppressed.push({ f, reason: s.reason ?? `suppressed within the ${rule.cooldownHours}h cooldown` });
    else sendable.push(f);
  }
  ctx.deps.db.transaction(() => {
    for (const { f, reason } of suppressed) {
      ctx.deps.repos.alerts.insertEvent({
        ruleId: rule.id, identityKey: f.identityKey,
        observationId: f.candidate.basis === 'verified' ? f.candidate.observationId : null,
        calendarPriceId: f.candidate.basis === 'calendar' ? f.candidate.calendarPriceId : null,
        dedupKey: f.dedupKey, firedAt: ctx.now, status: 'suppressed', reason,
        payloadJson: JSON.stringify({ digestId: null, executionId: ctx.executionId, kind: f.kind, pricePence: f.candidate.pricePence, previousPence: f.previous?.pricePence ?? null, label: eventLabel(f.candidate) }),
      });
    }
  });
  if (sendable.length === 0) return { digests: 0, events: suppressed.length };
  const newcomers = rule.type === 'absolute' ? [] : pool.candidates.filter((c) => !pool.previous.has(candidateRef(c))).sort((a, b) => a.pricePence - b.pricePence);
  const delivered = await deliver(ctx, rule, sendable, newcomers);
  return { digests: delivered.digests, events: delivered.events + suppressed.length };
}
```

Move the `HOUR_MS` constant to the top of the file (it is now used by `calendarPool` and `runRule`).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/alerts/` → PASS.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: alert cooldown across executions with suppression reasons; failed sends do not suppress"`

### Task 11.7: Synthetic rows refused; "alerts running on calendar basis only"

**Files:** Modify `packages/engine/src/alerts/runner.ts`; Test `packages/engine/test/alerts/runner.refusals.test.ts`.

**Interfaces:** consumes `NotificationsRepo.wasSent`, `NotificationsRepo.record`, `OperatorMessage` kind `alerts_calendar_only`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/alerts/runner.refusals.test.ts`:

```ts
import { asIsoDate, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, harness, seedCalendar, seedDefinition, seedExecution, seedObservation, seedRule, seedVerificationCoverage } from './harness.js';

describe('synthetic rows are refused by the runner (spec §5.5, §6.8)', () => {
  it('fixture calendar rows and fixture observations never become firings, events or digests', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 99999, basis: 'calendar' });
    seedRule(h, def, { thresholdPence: 99999, basis: 'verified', requireAllVerified: false });
    seedCalendar(h, ex, cells(5).map((cell) => ({ cell, pricePence: 100, providerId: 'fixture' as const })));
    seedObservation(h, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 100, synthetic: true });

    expect(await runAlerts(h.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(h.notifier.sent).toHaveLength(0);
    expect(h.repos.alerts.events({ definitionId: def.id })).toHaveLength(0);
    const refusals = h.log.lines.filter((l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused');
    expect(refusals.map((l) => (l.obj as { basis: string; refused: number }).refused).sort()).toEqual([1, 5]);
  });
});

describe('"alerts running on calendar basis only" (spec §6.8, §8.1)', () => {
  it('is sent once per execution when verification was budget-skipped', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 30000, basis: 'calendar' });
    const selected = cells(10);
    seedVerificationCoverage(h, ex, selected, 0);
    for (const cell of selected) h.repos.cells.setOutcome(ex, cell, 'verification', 'searchapi', { status: 'skipped', reason: 'budget' });

    await runAlerts(h.deps, ex);
    await runAlerts(h.deps, ex);

    const messages = h.notifier.operatorMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: 'alerts_calendar_only', executionId: ex, definitionId: def.id, subject: '[get-me-there] alerts running on calendar basis only' });
    expect(findBannedWords(`${messages[0]?.subject}\n${messages[0]?.body}`)).toEqual([]);
    expect(h.repos.notifications.wasSent('alerts_calendar_only', ex)).toBe(true);
  });

  it('is not sent when any selected cell was itinerary-searched', async () => {
    const h = harness();
    const def = seedDefinition(h);
    const ex = seedExecution(h, def);
    seedRule(h, def, { thresholdPence: 30000, basis: 'calendar' });
    const selected = cells(10);
    seedVerificationCoverage(h, ex, selected, 1);
    for (const cell of selected.slice(1)) h.repos.cells.setOutcome(ex, cell, 'verification', 'searchapi', { status: 'skipped', reason: 'budget' });
    await runAlerts(h.deps, ex);
    expect(h.notifier.operatorMessages()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.refusals.test.ts` → FAIL: the synthetic test gets `{ digests: 2, events: 6 }`; the notification test sees 0 operator messages.

- [ ] **Step 3: Implement.** In `runner.ts`:

Add a helper and use it in both pools:

```ts
/** Spec §5.5: alerts refuse synthetic rows; the fixture provider ⇔ synthetic invariant is checked both ways. */
function isSynthetic(p: { providerId: string; sourceKind: string }): boolean {
  return p.sourceKind === 'synthetic' || p.providerId === 'fixture';
}

function logRefused(ctx: RunContext, basis: AlertRule['basis'], refused: number): void {
  if (refused > 0) ctx.log.warn({ basis, refused }, 'alerts: synthetic rows refused');
}
```

In `calendarPool`, change the loop head to skip and count synthetic rows:

```ts
  let refused = 0;
  for (const r of rows) {
    if (isSynthetic(r.provenance)) { refused += 1; continue; }
```

and before `return`, add `logRefused(ctx, 'calendar', refused);`. In `verifiedPool`, add `let refused = 0;` before the loop, `if (isSynthetic(obs.provenance)) { refused += 1; continue; }` after the execution-id check, and `logRefused(ctx, 'verified', refused);` before `return`.

In `runAlerts`, after `const ctx = …;` add `await notifyCalendarOnly(ctx);`, and add:

```ts
/**
 * Spec §6.8/§8.1: when verification was budget-skipped (a verification provider is configured, at least one selected cell is
 * skipped:budget and none was itinerary-searched), tell the operator once per execution that alerts ran on the calendar basis only.
 */
async function notifyCalendarOnly(ctx: RunContext): Promise<void> {
  if (ctx.snapshot.providers.verification.length === 0) return;
  if (ctx.deps.repos.notifications.wasSent('alerts_calendar_only', ctx.executionId)) return;
  const verification = ctx.deps.repos.cells.outcomes(ctx.executionId).filter((o) => o.stage === 'verification');
  const budgetSkipped = verification.some((o) => o.status === 'skipped' && o.reason === 'budget');
  const searched = verification.some((o) => o.status === 'priced' || o.status === 'empty');
  if (!budgetSkipped || searched) return;
  const msg: OperatorMessage = {
    kind: 'alerts_calendar_only', executionId: ctx.executionId, definitionId: ctx.definition.id,
    subject: '[get-me-there] alerts running on calendar basis only',
    body: [
      `Itinerary search for "${stripControl(ctx.definition.name)}" was skipped by the budget in this run, so rules on itinerary prices had nothing to check.`,
      'Rules on calendar prices ran as usual; their emails say "constraints not checked".',
      'Raise the cap or resume the execution to itinerary-search the selected cells.',
    ].join('\n'),
  };
  const outcome = await sendToAll(ctx, msg);
  ctx.deps.repos.notifications.record('alerts_calendar_only', ctx.executionId, outcome.status);
}
```

Add `stripControl` to the `./templates.js` import.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/alerts/` → PASS.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: alerts refuse synthetic rows; calendar-basis-only operator notification"`

### Task 11.8: Wire the runner into the orchestrator's alerts step

**Files:** Modify `packages/engine/src/orchestrator.ts`; Test `packages/engine/test/alerts/orchestrator.alerts.test.ts`.

**Interfaces:** consumes WP7's `AlertsStepHook`, `noAlerts`, layer-A harness `layerA()`; `runAlerts` satisfies `AlertsStepHook`.

Hook signature (WP7, `packages/engine/src/alerts/hook.ts`):

```ts
export type AlertsStepHook = (deps: AlertRunnerDeps, executionId: string) => Promise<AlertRunResult>;
```

- [ ] **Step 1: Write the failing test** `packages/engine/test/alerts/orchestrator.alerts.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AlertsStepHook } from '../../src/alerts/hook.js';

const runAlerts = vi.hoisted(() => vi.fn(async () => ({ digests: 0, events: 0 })));
vi.mock('../../src/alerts/runner.js', async (importOriginal) => ({ ...(await importOriginal<object>()), runAlerts }));

import { runAlerts as realRunAlerts } from '../../src/alerts/runner.js';
import { layerA } from '../harness/layerA.js';

describe('the §8.1 alerts step', () => {
  it('runAlerts has the hook signature', () => {
    const hook: AlertsStepHook = realRunAlerts;
    expect(typeof hook).toBe('function');
  });

  it('is called once per completed execution with the engine deps and the execution id', async () => {
    const h = await layerA();
    const started = await h.engine.start(h.definitionId, { trigger: 'manual' });
    if (!started.ok) throw new Error(started.message);
    await h.waitForStatus(started.executionId, 'completed');
    expect(runAlerts).toHaveBeenCalledTimes(1);
    expect(runAlerts).toHaveBeenCalledWith(expect.objectContaining({ repos: h.deps.repos, notifiers: h.deps.notifiers }), started.executionId);
  });

  it('a throwing alerts step still completes the execution', async () => {
    runAlerts.mockRejectedValueOnce(new Error('smtp down'));
    const h = await layerA();
    const started = await h.engine.start(h.definitionId, { trigger: 'manual' });
    if (!started.ok) throw new Error(started.message);
    await h.waitForStatus(started.executionId, 'completed');
    expect(h.deps.repos.executions.get(started.executionId)?.status).toBe('completed');
  });
});
```

`// why:` the mocked module keeps every real export except `runAlerts`, so the first test still checks the real function's type against the hook.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/alerts/orchestrator.alerts.test.ts` → FAIL: `expected "spy" to be called 1 times, but got 0 times` (the orchestrator still calls `noAlerts`).

- [ ] **Step 3: Implement.** In `packages/engine/src/orchestrator.ts`, replace the line

```ts
const alerts = await noAlerts(deps, executionId);
```

with

```ts
const alerts = await runAlerts(deps, executionId).catch((err: unknown) => alertsFailed(deps.log, executionId, err));
```

and change the import of `noAlerts` from `./alerts/hook.js` to `import { alertsFailed, runAlerts } from './alerts/runner.js';` (keep `hook.ts` and `noAlerts` for WP7's own tests).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine test` → PASS, every WP7 test still green, thresholds 85/70 met.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "wp11: orchestrator alerts step runs the alert runner (spec §8.1)"`

### Task 11.9: EmailNotifier over nodemailer, notifier wiring

**Files:** Create `packages/engine/src/notifiers/email.ts`, `packages/engine/src/notifiers/index.ts`; Modify `packages/engine/src/index.ts`, `apps/api/src/bootstrap/app.ts`; Test `packages/engine/test/notifiers/email.test.ts`.

**Interfaces:** consumes `Config['smtp']`, `Secret`, `scrubSecrets`, `stripControl`, `LogNotifier`; produces `EmailNotifier`, `smtpTransportOptions`, `TransportFactory`, `buildNotifiers`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/notifiers/email.test.ts`:

```ts
import { Secret, type AlertDigest, type OperatorMessage } from '@gmt/core';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { renderBody, renderSubject } from '../../src/alerts/templates.js';
import { buildNotifiers } from '../../src/notifiers/index.js';
import { EmailNotifier, smtpTransportOptions, type MailMessage, type SmtpConfig, type SmtpTransportOptions, type TransportFactory } from '../../src/notifiers/email.js';
import { calendarCandidate, firing, NOW, renderInput, RULE, verifiedCandidate } from '../alerts/builders.js';
import { captureLogger } from '../alerts/harness.js';

const PASS = 'test-smtp-pass-0123456789abcdef';
const smtp = (over: Partial<SmtpConfig> = {}): SmtpConfig => ({ host: 'smtp.example.com', port: 465, tls: 'implicit', user: 'alerts', pass: new Secret(PASS), to: 'operator@example.com', from: 'get-me-there@example.com', ...over });

/** A factory that records the SMTP options and sends through nodemailer's jsonTransport. */
function jsonFactory() {
  const options: SmtpTransportOptions[] = [];
  const messages: Array<{ envelope: { from: string; to: string[] }; parsed: { subject: string; text: string; html?: unknown } }> = [];
  const factory: TransportFactory = (o) => {
    options.push(o);
    const json = nodemailer.createTransport({ jsonTransport: true });
    return {
      async sendMail(m: MailMessage) {
        const info = await json.sendMail(m);
        messages.push({ envelope: info.envelope as { from: string; to: string[] }, parsed: JSON.parse(String(info.message)) });
        return { messageId: info.messageId };
      },
    };
  };
  return { factory, options, messages };
}

function digestOf(items = [firing(verifiedCandidate())], over: Partial<Parameters<typeof renderInput>[0]> = {}): AlertDigest {
  return { ruleId: RULE.id, definitionId: 'def-1', executionId: 'ex-1', basis: 'verified', subject: renderSubject(items[0] ?? firing(verifiedCandidate()), NOW), body: renderBody(renderInput({ items, ...over })), items, restCount: 0 };
}

describe('SMTP_TLS → transport options (spec §8.3)', () => {
  it('implicit → secure; starttls → requireTLS; none only on loopback or dev Mailpit', () => {
    expect(smtpTransportOptions(smtp(), 'production')).toEqual({ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'alerts', pass: PASS } });
    expect(smtpTransportOptions(smtp({ tls: 'starttls', port: 587 }), 'production')).toEqual({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'alerts', pass: PASS } });
    expect(smtpTransportOptions(smtp({ tls: 'none', host: '127.0.0.1', port: 1025 }), 'production')).toMatchObject({ secure: false, ignoreTLS: true });
    expect(smtpTransportOptions(smtp({ tls: 'none', host: 'mailpit', port: 1025 }), 'development')).toMatchObject({ secure: false, ignoreTLS: true });
    expect(() => smtpTransportOptions(smtp({ tls: 'none', host: 'mailpit' }), 'production')).toThrow(/SMTP_TLS=none/);
    expect(() => smtpTransportOptions(smtp({ tls: 'none' }), 'production')).toThrow(/SMTP_TLS=none/);
  });
});

describe('EmailNotifier with a jsonTransport (spec §8.3)', () => {
  it('envelope, subject and a plain-text body with provenance, coverage caveat and a validated link', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    expect(await n.send(digestOf())).toEqual({ ok: true });
    expect(t.options[0]).toMatchObject({ secure: true });
    const [m] = t.messages;
    expect(m?.envelope).toEqual({ from: 'get-me-there@example.com', to: ['operator@example.com'] });
    expect(m?.parsed.subject).toBe('[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google via SearchApi · fetched 5h ago · 1 constraint unverified');
    expect(m?.parsed.html).toBeUndefined();
    expect(m?.parsed.text).toContain('Provenance: Google via SearchApi · fetched 5h ago');
    expect(m?.parsed.text).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');
    expect(m?.parsed.text).toContain('Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)');
  });

  it('a POST booking links to the app results row instead', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    const post = firing(verifiedCandidate({ booking: { kind: 'post', url: 'https://www.google.com/travel/clk/f', postData: 'x=1', host: 'www.google.com' } }));
    await n.send(digestOf([post]));
    expect(t.messages[0]?.parsed.text).toContain(`/definitions/def-1/results?basis=verified&row=${'a'.repeat(64)}`);
  });

  it('refuses synthetic rows before anything is sent', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    const synthetic = firing(calendarCandidate({ provenance: { ...calendarCandidate().provenance, providerId: 'fixture', sourceKind: 'synthetic' } }));
    const d: AlertDigest = { ...digestOf(), basis: 'calendar', items: [synthetic] };
    await expect(n.send(d)).rejects.toThrow(/synthetic rows refused/);
    expect(t.messages).toHaveLength(0);
  });

  it('strips CR/LF from subjects, so an operator message cannot inject a header', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    const msg: OperatorMessage = { kind: 'paused_error', executionId: 'ex-1', definitionId: 'def-1', subject: '[get-me-there] paused\r\nBcc: victim@example.com', body: 'line one\r\nline two' };
    await n.send(msg);
    expect(t.messages[0]?.parsed.subject).toBe('[get-me-there] paused Bcc: victim@example.com');
    expect(t.messages[0]?.parsed.text).toBe('line one\nline two');
  });

  it('a transport failure returns ok:false and the SMTP password reaches neither the detail nor the log', async () => {
    const log = captureLogger();
    const failing: TransportFactory = () => ({ sendMail: async () => { throw new Error(`535 authentication failed for alerts:${PASS} at smtp.example.com`); } });
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log, createTransport: failing });
    const r = await n.send(digestOf());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('535 authentication failed');
    expect(r.detail).not.toContain(PASS);
    expect(JSON.stringify(log.lines)).not.toContain(PASS);
  });
});

describe('buildNotifiers', () => {
  it('log only without SMTP; log and email with it', () => {
    expect(buildNotifiers({ smtp: null, nodeEnv: 'production' }, captureLogger()).map((n) => n.id)).toEqual(['log']);
    expect(buildNotifiers({ smtp: smtp(), nodeEnv: 'production' }, captureLogger()).map((n) => n.id)).toEqual(['log', 'email']);
  });
});
```

`buildNotifiers` with real SMTP options constructs a real nodemailer SMTP transporter; `createTransport` opens no connection until `sendMail`, so the test sends nothing. The id `'log'` is WP7's `LogNotifier.id` (assumed, section 4.2).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts` → FAIL: `../../src/notifiers/email.js` cannot be resolved.

- [ ] **Step 3: Implement** `packages/engine/src/notifiers/email.ts`:

```ts
/**
 * EmailNotifier (spec §8.3): nodemailer SMTP, plain text only, SMTP_TLS mapped to transport options,
 * subjects CR/LF-stripped, synthetic rows refused before anything is sent, secrets scrubbed from every error.
 */
import type { AlertDigest, Config, Logger, Notifier, OperatorMessage } from '@gmt/core';
import { scrubSecrets } from '@gmt/providers';
import nodemailer from 'nodemailer';
import { stripControl } from '../alerts/templates.js';

export type SmtpConfig = NonNullable<Config['smtp']>;
/** The subset of nodemailer SMTP options this app sets. */
export interface SmtpTransportOptions { host: string; port: number; secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean; auth: { user: string; pass: string } }
export interface MailMessage { from: string; to: string; subject: string; text: string }
/** The one transporter method used; nodemailer's Transporter satisfies it. */
export interface MailTransport { sendMail(m: MailMessage): Promise<{ messageId: string }> }
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;

// why: duplicates the config schema's rule (WP0 Task 0.5) as defence in depth, so a hand-built config cannot send in clear text off-box.
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
        throw new Error(`SMTP_TLS=none is permitted only for a loopback host or the dev Mailpit profile; host ${smtp.host} refused (spec §8.3)`);
      }
      return { ...base, secure: false, ignoreTLS: true };
  }
}

const defaultFactory: TransportFactory = (o) => nodemailer.createTransport(o);

/** Spec §5.5: notifiers refuse synthetic rows. */
function refuseSynthetic(d: AlertDigest): void {
  if (d.items.some((i) => i.candidate.provenance.sourceKind === 'synthetic' || i.candidate.provenance.providerId === 'fixture')) {
    throw new Error('EmailNotifier: synthetic rows refused (spec §5.5)');
  }
}

/** Sends alert digests and operator messages as plain-text email. Spec §8.3. */
export class EmailNotifier implements Notifier {
  readonly id = 'email' as const;
  private readonly transport: MailTransport;
  private readonly smtp: SmtpConfig;
  private readonly log: Logger;

  constructor(opts: { smtp: SmtpConfig; nodeEnv: Config['nodeEnv']; log: Logger; createTransport?: TransportFactory }) {
    this.smtp = opts.smtp;
    this.log = opts.log.child({ notifier: 'email' });
    this.transport = (opts.createTransport ?? defaultFactory)(smtpTransportOptions(opts.smtp, opts.nodeEnv));
  }

  async send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> {
    if ('items' in msg) refuseSynthetic(msg);
    const mail: MailMessage = {
      from: this.smtp.from, to: this.smtp.to,
      subject: stripControl(msg.subject),
      // why: bodies are LF-only plain text; a stray CR from any source is normalised away.
      text: msg.body.replace(/\r\n?/g, '\n'),
    };
    try {
      const info = await this.transport.sendMail(mail);
      this.log.info({ messageId: info.messageId }, 'email sent');
      return { ok: true };
    } catch (err) {
      const detail = scrubSecrets(err instanceof Error ? err.message : String(err), [this.smtp.pass]);
      this.log.warn({ detail }, 'email not sent');
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
  if (config.smtp !== null) notifiers.push(new EmailNotifier({ smtp: config.smtp, nodeEnv: config.nodeEnv, log }));
  return notifiers;
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { EmailNotifier, smtpTransportOptions, type MailMessage, type MailTransport, type SmtpConfig, type SmtpTransportOptions, type TransportFactory } from './notifiers/email.js';
export { buildNotifiers } from './notifiers/index.js';
```

In `apps/api/src/bootstrap/app.ts`, replace `notifiers: [new LogNotifier(ports.log)],` with `notifiers: buildNotifiers(ports.config, ports.log),` and import `buildNotifiers` from `@gmt/engine` in place of `LogNotifier`.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts` → PASS, 7 tests; then `pnpm --filter @gmt/api test` → PASS (the sentinel-key test from WP8 now also covers the email path because `SMTP_PASS` is one of its sentinels).

- [ ] **Step 5: Commit** — `git add packages/engine apps/api && git commit -m "wp11: EmailNotifier over nodemailer with SMTP_TLS mapping and synthetic refusal"`

### Task 11.10: Alerts view — rule form

**Files:** Create `apps/web/src/views/Alerts/alertsApi.ts` (rules and events calls), `RuleForm.tsx`, `AlertsView.tsx`, `index.ts`; Modify `apps/web/src/App.tsx`; Test `apps/web/test/views/Alerts/RuleForm.test.tsx`.

**Interfaces:** consumes `alertRuleSchema`, `alertEventSchema`, `AlertRule` (`@gmt/core`); routes `GET/POST/DELETE /alerts`, `GET /alerts/events` (WP8). Produces `AlertsView`.

- [ ] **Step 1: Write the failing test** `apps/web/test/views/Alerts/RuleForm.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AlertsView } from '../../../src/views/Alerts/index.js';

const posted: unknown[] = [];
const server = setupServer(
  http.get('*/alerts', () => HttpResponse.json([])),
  http.get('*/alerts/events', () => HttpResponse.json([])),
  http.post('*/alerts', async ({ request }) => {
    const body = await request.json();
    posted.push({ body, headers: { xrw: request.headers.get('X-Requested-With'), ct: request.headers.get('Content-Type') } });
    return HttpResponse.json({ id: 'rule-1', ...(body as object) }, { status: 201 });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); posted.length = 0; });
afterAll(() => server.close());

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AlertsView definitionId="def-1" /></QueryClientProvider>);
}

describe('Alerts rule form (spec §6.8, §11)', () => {
  it('defaults: absolute rule, itinerary-price basis, cooldown 336 h', async () => {
    view();
    expect(await screen.findByLabelText('Cooldown (hours)')).toHaveValue(336);
    expect(screen.getByLabelText('Rule type')).toHaveValue('absolute');
    expect(screen.getByLabelText('Basis')).toHaveValue('verified');
    expect(screen.getByLabelText('Only class verified (every constraint passed)')).toBeEnabled();
  });

  it('requireAllVerified is disabled on the calendar basis and never sent', async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByLabelText('Only class verified (every constraint passed)'));
    await user.selectOptions(screen.getByLabelText('Basis'), 'calendar');
    expect(screen.getByLabelText('Only class verified (every constraint passed)')).toBeDisabled();
    await user.type(screen.getByLabelText('Threshold (£)'), '450');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      body: { definitionId: 'def-1', type: 'absolute', thresholdPence: 45000, basis: 'calendar', cooldownHours: 336, enabled: true },
      headers: { xrw: 'get-me-there', ct: 'application/json' },
    });
  });

  it('a percentage drop rule sends pct, and pounds with pence convert without floats', async () => {
    const user = userEvent.setup();
    view();
    await user.selectOptions(await screen.findByLabelText('Rule type'), 'dropPct');
    await user.type(screen.getByLabelText('Drop (%)'), '12');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0] as { body: object }).body).toEqual({ definitionId: 'def-1', type: 'dropPct', pct: 12, basis: 'verified', requireAllVerified: false, cooldownHours: 336, enabled: true });

    await user.selectOptions(screen.getByLabelText('Rule type'), 'dropAbs');
    await user.type(screen.getByLabelText('Threshold (£)'), '20.50');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect((posted[1] as { body: { thresholdPence: number } }).body.thresholdPence).toBe(2050);
  });

  it('invalid input is rejected by alertRuleSchema with a field message and nothing is sent', async () => {
    const user = userEvent.setup();
    view();
    await user.type(await screen.findByLabelText('Threshold (£)'), 'abc');
    await user.clear(screen.getByLabelText('Cooldown (hours)'));
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(await screen.findByText(/threshold/i, { selector: '[role="alert"]' })).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx` → FAIL: `../../../src/views/Alerts/index.js` cannot be resolved.

- [ ] **Step 3: Implement.**

`apps/web/src/views/Alerts/alertsApi.ts`:

```ts
/**
 * Alerts routes (spec §10), validated with core/api-contract schemas.
 * why: no WP9 client signature exists in the plan; this module follows the hardening rules every client must (spec §4).
 */
import { alertEventSchema, alertRuleSchema } from '@gmt/core';

export type AlertRuleBody = ReturnType<typeof alertRuleSchema.parse>;
export type AlertEventRow = ReturnType<typeof alertEventSchema.parse>;

const MUTATING = { 'Content-Type': 'application/json', 'X-Requested-With': 'get-me-there' } as const;

function url(path: string): string {
  return new URL(path, window.location.origin).toString();
}

async function ok(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export async function listRules(definitionId: string): Promise<AlertRuleBody[]> {
  return alertRuleSchema.array().parse(await ok(await fetch(url(`/alerts?definitionId=${encodeURIComponent(definitionId)}`)), 'GET /alerts'));
}

export async function listEvents(definitionId: string): Promise<AlertEventRow[]> {
  return alertEventSchema.array().parse(await ok(await fetch(url(`/alerts/events?definitionId=${encodeURIComponent(definitionId)}&limit=200`)), 'GET /alerts/events'));
}

export async function createRule(body: AlertRuleBody): Promise<void> {
  await ok(await fetch(url('/alerts'), { method: 'POST', headers: MUTATING, body: JSON.stringify(body) }), 'POST /alerts');
}

export async function deleteRule(id: string): Promise<void> {
  await ok(await fetch(url(`/alerts/${encodeURIComponent(id)}`), { method: 'DELETE', headers: MUTATING }), 'DELETE /alerts/:id');
}
```

`apps/web/src/views/Alerts/RuleForm.tsx`:

```tsx
/** Alert rule form (spec §6.8, §11): type, threshold or pct, basis, requireAllVerified on the verified basis only, cooldown. */
import { alertRuleSchema } from '@gmt/core';
import { useState, type FormEvent } from 'react';
import type { AlertRuleBody } from './alertsApi.js';

type RuleType = 'absolute' | 'dropPct' | 'dropAbs';
type Basis = 'verified' | 'calendar';

/** "450" or "20.50" → integer pence by string arithmetic; anything else → NaN, which the schema rejects. */
export function poundsToPence(s: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (m === null) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function RuleForm(props: { definitionId: string; onSubmit: (body: AlertRuleBody) => void; busy: boolean }) {
  const [type, setType] = useState<RuleType>('absolute');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState('');
  const [basis, setBasis] = useState<Basis>('verified');
  const [requireAll, setRequireAll] = useState(false);
  const [cooldown, setCooldown] = useState('336');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      definitionId: props.definitionId, type,
      ...(type === 'dropPct' ? { pct: pct.trim() === '' ? Number.NaN : Number(pct) } : { thresholdPence: poundsToPence(amount) }),
      basis,
      // why: spec §6.8 — requireAllVerified exists only on the verified basis; zod rejects it on the calendar basis.
      ...(basis === 'verified' ? { requireAllVerified: requireAll } : {}),
      cooldownHours: cooldown.trim() === '' ? Number.NaN : Number(cooldown), enabled: true,
    };
    const parsed = alertRuleSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    props.onSubmit(parsed.data);
  }

  const err = (field: string, label: string) => errors[field] === undefined ? null : <p role="alert" className="text-sm text-red-700">{label}: {errors[field]}</p>;

  return (
    <form onSubmit={submit} className="grid gap-3 max-w-xl" aria-label="New alert rule">
      <label className="grid gap-1">Rule type
        <select aria-label="Rule type" value={type} onChange={(e) => setType(e.target.value as RuleType)}>
          <option value="absolute">Price at or below</option>
          <option value="dropPct">Drop by percent</option>
          <option value="dropAbs">Drop by amount</option>
        </select>
      </label>
      {type === 'dropPct' ? (
        <label className="grid gap-1">Drop (%)
          <input aria-label="Drop (%)" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
          {err('pct', 'Drop')}
        </label>
      ) : (
        <label className="grid gap-1">Threshold (£)
          <input aria-label="Threshold (£)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {err('thresholdPence', 'Threshold')}
        </label>
      )}
      <label className="grid gap-1">Basis
        <select aria-label="Basis" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
          <option value="verified">Itinerary prices (class verified or partially-verified)</option>
          <option value="calendar">Calendar prices (constraints not checked)</option>
        </select>
      </label>
      <label className="flex gap-2 items-center">
        <input type="checkbox" aria-label="Only class verified (every constraint passed)" disabled={basis === 'calendar'} checked={basis === 'verified' && requireAll} onChange={(e) => setRequireAll(e.target.checked)} />
        Only class verified (every constraint passed)
      </label>
      {basis === 'calendar' ? <p className="text-sm">Calendar prices carry no constraint checks, so this option applies to itinerary prices only.</p> : null}
      <label className="grid gap-1">Cooldown (hours)
        <input aria-label="Cooldown (hours)" type="number" min={1} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
        <span className="text-sm">Default 336 h (two weeks), deliberately longer than a weekly schedule.</span>
        {err('cooldownHours', 'Cooldown')}
      </label>
      {err('form', 'Rule')}
      <button type="submit" disabled={props.busy}>Add rule</button>
    </form>
  );
}
```

`apps/web/src/views/Alerts/AlertsView.tsx`:

```tsx
/** Alerts view (spec §11): rules with their form, and the events list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRule, deleteRule, listRules, type AlertRuleBody } from './alertsApi.js';
import { RuleForm } from './RuleForm.js';

function pounds(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return '';
  const rest = pence % 100;
  return `£${Math.floor(pence / 100)}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}

/** One line per rule, in the same words as the email's "Rule:" line. */
export function describeRule(r: AlertRuleBody): string {
  const what = r.type === 'absolute' ? `price ${pounds(r.thresholdPence)} or less` : r.type === 'dropAbs' ? `drop of ${pounds(r.thresholdPence)} or more` : `drop of ${r.pct ?? 0}% or more`;
  const basis = r.basis === 'calendar' ? 'calendar prices, constraints not checked' : r.requireAllVerified === true ? 'itinerary prices, class verified only' : 'itinerary prices, class verified or partially-verified';
  return `${what} · ${basis} · cooldown ${r.cooldownHours}h${r.enabled ? '' : ' · disabled'}`;
}

export function AlertsView(props: { definitionId: string }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['alerts', props.definitionId], queryFn: () => listRules(props.definitionId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['alerts', props.definitionId] });
  const create = useMutation({ mutationFn: createRule, onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteRule, onSuccess: refresh });

  return (
    <section aria-labelledby="alerts-heading" className="grid gap-6">
      <h2 id="alerts-heading">Alerts</h2>
      <p>One email per rule per run, listing the ten cheapest matches and a count of the rest. Each price says where it came from and how old it is.</p>
      <RuleForm definitionId={props.definitionId} onSubmit={(b) => create.mutate(b)} busy={create.isPending} />
      {create.isError ? <p role="alert">Rule not saved: {create.error.message}</p> : null}
      <div>
        <h3>Rules</h3>
        {rules.isLoading ? <p>Loading rules…</p> : (rules.data ?? []).length === 0 ? <p>No alert rules for this definition yet.</p> : (
          <ul>
            {(rules.data ?? []).map((r, i) => (
              <li key={r.id ?? i} className="flex gap-2">
                <span>{describeRule(r)}</span>
                {r.id === undefined ? null : <button type="button" onClick={() => remove.mutate(r.id ?? '')}>Delete</button>}
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
/** Alerts view barrel (WP11); WP9's navigation mounts AlertsView. */
export { AlertsView, describeRule } from './AlertsView.js';
```

In `apps/web/src/App.tsx`, make the Alerts nav entry render `<AlertsView definitionId={selectedDefinitionId} />` by adding `import { AlertsView } from './views/Alerts/index.js';` (replacing WP9's placeholder import for that entry, if any).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx` → PASS, 4 tests.

- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "wp11: Alerts view rule form validated by alertRuleSchema"`

### Task 11.11: Alerts view — events list and banned words

**Files:** Create `apps/web/src/views/Alerts/EventsTable.tsx`; Modify `apps/web/src/views/Alerts/AlertsView.tsx`; Test `apps/web/test/views/Alerts/AlertsView.test.tsx`.

- [ ] **Step 1: Write the failing test** `apps/web/test/views/Alerts/AlertsView.test.tsx`:

```tsx
import { findBannedWords } from '@gmt/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AlertsView } from '../../../src/views/Alerts/index.js';

const rules = [
  { id: 'r1', definitionId: 'def-1', type: 'absolute', thresholdPence: 45000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true },
  { id: 'r2', definitionId: 'def-1', type: 'dropPct', thresholdPence: null, pct: 10, basis: 'verified', requireAllVerified: true, cooldownHours: 336, enabled: true },
];
const events = [
  { id: 1, ruleId: 'r1', firedAt: '2026-10-14T05:12:00.000Z', status: 'sent', reason: '£412 is at or below the £450 threshold', label: '£412 LHR→JFK 14 Mar–28 Mar (14n)', pricePence: 41200 },
  { id: 2, ruleId: 'r1', firedAt: '2026-10-21T05:10:00.000Z', status: 'suppressed', reason: 'same £412 band alerted 7d ago; cooldown 336h', label: '£412 LHR→JFK 14 Mar–28 Mar (14n)', pricePence: 41250 },
  { id: 3, ruleId: 'r2', firedAt: '2026-10-21T05:11:00.000Z', status: 'failed', reason: 'dropped 12% from £468; not delivered: email: connection refused', label: '£412 LHR→JFK 14 Mar–28 Mar (14n)', pricePence: 41200 },
];
const server = setupServer(
  http.get('*/alerts', () => HttpResponse.json(rules)),
  http.get('*/alerts/events', () => HttpResponse.json(events)),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AlertsView definitionId="def-1" /></QueryClientProvider>);
}

describe('Alerts events list (spec §11)', () => {
  it('shows every event with its status in words and its reason', async () => {
    view();
    const table = await screen.findByRole('table', { name: 'Alert events' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('suppressed')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('same £412 band alerted 7d ago; cooldown 336h')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('failed')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('price £450 or less · calendar prices, constraints not checked · cooldown 336h')).toBeInTheDocument();
  });

  it('lists rules in words, class verified only where requireAllVerified is set', async () => {
    view();
    expect(await screen.findByText('drop of 10% or more · itinerary prices, class verified only · cooldown 336h')).toBeInTheDocument();
  });

  it('empty states', async () => {
    server.use(http.get('*/alerts', () => HttpResponse.json([])), http.get('*/alerts/events', () => HttpResponse.json([])));
    view();
    expect(await screen.findByText('No alert rules for this definition yet.')).toBeInTheDocument();
    expect(await screen.findByText('No alerts have fired for this definition yet.')).toBeInTheDocument();
  });

  it('no banned word anywhere in the rendered view (spec §11)', async () => {
    const { container } = view();
    await screen.findByRole('table', { name: 'Alert events' });
    expect(findBannedWords(container.textContent ?? '')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gmt/web exec vitest run test/views/Alerts/AlertsView.test.tsx` → FAIL: `Unable to find role="table" and name "Alert events"` (the view has no events list yet); the rules test passes.

- [ ] **Step 3: Implement.**

Create `apps/web/src/views/Alerts/EventsTable.tsx`:

```tsx
/** Alert events (spec §11): when, which rule, status in words, price, reason. */
import type { AlertEventRow } from './alertsApi.js';

const STATUS_TEXT: Record<AlertEventRow['status'], string> = { sent: 'sent', failed: 'failed', suppressed: 'suppressed' };

export function EventsTable(props: { events: readonly AlertEventRow[]; loading: boolean; ruleText: ReadonlyMap<string, string> }) {
  if (props.loading) return <p>Loading alert events…</p>;
  if (props.events.length === 0) return <p>No alerts have fired for this definition yet.</p>;
  return (
    <table aria-label="Alert events">
      <thead><tr><th scope="col">Fired</th><th scope="col">Rule</th><th scope="col">Status</th><th scope="col">Price</th><th scope="col">Reason</th></tr></thead>
      <tbody>
        {props.events.map((e) => (
          <tr key={e.id}>
            <td><time dateTime={e.firedAt}>{e.firedAt.slice(0, 16).replace('T', ' ')} UTC</time></td>
            <td>{props.ruleText.get(e.ruleId) ?? e.ruleId}</td>
            <td>{STATUS_TEXT[e.status]}</td>
            <td>{e.label}</td>
            <td>{e.reason ?? 'no reason recorded'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

In `AlertsView.tsx`, import `listEvents` from `./alertsApi.js` and `EventsTable` from `./EventsTable.js`; after the `rules` query add

```tsx
  const events = useQuery({ queryKey: ['alert-events', props.definitionId], queryFn: () => listEvents(props.definitionId) });
  const ruleText = new Map((rules.data ?? []).flatMap((r) => (r.id === undefined ? [] : [[r.id, describeRule(r)] as const])));
```

and before `</section>` add

```tsx
      <h3>Alert events</h3>
      {/* why: the Rule column shows each rule in words, so the table waits for the rules query */}
      {rules.isLoading ? <p>Loading alert events…</p> : <EventsTable events={events.data ?? []} loading={events.isLoading} ruleText={ruleText} />}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @gmt/web test` → PASS, web thresholds 70/60 met.

- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "wp11: Alerts events list with status and reason; banned-word test over the view"`

## 9. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP11. The spec §9 items this package carries, and where each is pinned:

| Requirement | Test |
|---|---|
| §9 item 4 digests: 50 qualifying cells → one email | Task 11.1 `runner.digest.test.ts` "50 qualifying calendar cells…" |
| §9 item 4 dedup across executions, verified basis | Task 11.6 "verified basis: the same itinerary and band…" |
| §9 item 4 dedup across executions, calendar basis, with reason | Task 11.6 "calendar basis: the same price band within cooldownHours…" |
| §6.8 verified candidates from the current execution only | Task 11.4 "candidates are observations written by the current execution…" |
| §6.8 calendar reused rows excluded | Task 11.1 "only calendar prices fetched by this execution count…" |
| §6.8 drop window 167/168/169 h | Task 11.5 "drops compare only with a previous price fetched within 2 × …" |
| §6.8 absent-then-present is "new", never a drop | Task 11.5 and Task 11.4 drop tests |
| §9 item 4 synthetic refused by alerts | Task 11.7 `runner.refusals.test.ts` |
| §9 item 4 synthetic refused by notifiers | Task 11.9 "refuses synthetic rows before anything is sent" |
| §8.3 banned words over rendered notifier output | Task 11.2 "no banned word in any rendered subject or body" |
| §9 item 6 banned words over the Alerts view | Task 11.11 "no banned word anywhere in the rendered view" |
| §8.3 CRLF injection in a seller name | Task 11.2 "a seller name cannot inject headers or lines"; Task 11.9 subject stripping |
| §5.3 SMTP password never in a log line or error | Task 11.9 "a transport failure returns ok:false…" |

## 10. Definition of done

- `pnpm --filter @gmt/engine test` → PASS; coverage ≥ 85% lines, ≥ 70% branches (and 85% functions/statements).
- `pnpm --filter @gmt/web test` → PASS; coverage ≥ 70% lines, ≥ 60% branches.
- `pnpm --filter @gmt/api test` → PASS (unchanged count plus nothing failing after the bootstrap line change).
- `pnpm -r test` → PASS across the workspace.
- `pnpm lint` → no diagnostics (the one `biome-ignore` in `templates.ts` carries its reason).
- `pnpm -r typecheck` → no errors.
- `node scripts/check-boundaries.mjs` → exit 0 (engine imports only `core`, `db`, `providers`, `nodemailer`, `croner`, `pino`, `node:*`; web imports only `@gmt/core`, React and its listed libraries).
- `grep -rn "process.env" packages/engine/src apps/web/src` → no output.
- `grep -rnE "\b(LHR|LGW|JFK|EWR|LON|NYC)\b" packages/engine/src apps/web/src` → no output (the worked example lives in tests only).

## 11. Open questions

None. The assumptions in section 4.2 and the queries in section 4.3 are contract gaps reported to Fable (findings WP11-C1 to WP11-C6 in the dispatch note), not design questions; the wave-7 re-review checks them against merged code.
