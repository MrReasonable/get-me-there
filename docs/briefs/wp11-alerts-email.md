---
wp: 11
title: alerts runner, EmailNotifier, Alerts UI
owner: sonnet
depends_on: [7, 8, 10]
spec_sections: ["§6.8", "§8.1", "§8.3", "§10", "§11", "§12 (APP_BASE_URL)", "§9 item 4", "§9 item 6"]
reviewers: [code-architect, test-strategy-reviewer, provenance-auditor, product-owner, persona-flexible-traveller, security-reviewer]
status: draft
---

# WP11: alerts runner, EmailNotifier, Alerts UI

Reconciled 2026-10-14 against spec revision 10 and the plan's "Cross-package contracts" v2 with the round-2 and round-3 pins (decisions 14 and 15, commit 4244030) and spec revision 11 §6.8.

## 1. Goal

Turn the prices an execution wrote into at most one plain-text email per alert rule per execution. Alerts are deduplicated across executions and never built from synthetic rows. The operator gets an Alerts view to manage rules and to read what fired, what was suppressed, and why.

## 2. Scope

**In**

- `packages/engine/src/alerts/runner.ts`: `runAlerts`, the `AlertsStepHook` WP7's engine calls at the §8.1 alerts step. It does the engine side of spec §6.8:
  - gathers candidates per basis from the current execution;
  - looks up previous prices for drops and prior firings for suppression;
  - persists `alert_events`;
  - builds one structured digest per rule with core's `buildDigest`, renders it, and sends it to every notifier.
- `packages/engine/src/alerts/templates.ts`: `renderSubject` and `renderBody` in the spec §8.3 formats, plus `stripControl`, `sourceLabel` and `appRowLink`.
- `packages/engine/src/notifiers/email.ts`: `EmailNotifier` over nodemailer 10.
- `packages/engine/src/notifiers/index.ts`: `buildNotifiers`.
- One modified line in WP8's app bootstrap, which passes `notifiers` and `{ alerts: runAlerts }` to `createEngine`.
- `apps/web/src/views/Alerts/*`: the rule form, the rules list and the events table. These need the alert wrappers added to WP9's `api`, an `alertsView` block in `copy.ts`, and the `App.tsx` mount.

**Out**

- `@gmt/core`, WP2: `evaluateAlertRules` (including the suppression decision), `identityKey`, `dedupKey`, `buildDigest`, `evaluateConstraints`, `verdictClass`, `unverifiedNames` and `searchLinkFor`.
- `@gmt/core`, WP0:
  - the types `AlertRule`, `AlertCandidate`, `Firing`, `PriorFiring`, `DigestItem` and `AlertDigest`;
  - the `Notifier` port and the alert schemas;
  - `formatAgeFull`, `findBannedWords` and `BANNED_WORD_ALLOWLIST`.
- `@gmt/db`, WP3: every repository method this WP calls, including `fetchedBy`, `previousFor`, `writtenBy`, `previousObservation` and `priorFirings`. This WP adds no SQL, no column and no migration.
- `@gmt/engine`, WP7:
  - `createEngine(deps, { alerts })`, `noAlerts`, and how the orchestrator treats a hook that rejects;
  - `LogNotifier` and `renderOperatorMessage`;
  - the "alerts running on calendar basis only" operator notification, which is WP7 Task 7.10 through `renderOperatorMessage`;
  - the layer-A test harness.
- `apps/api`, WP8: the `/api/alerts` routes and the rest of the app bootstrap.
- `apps/web`, WP9: the shell, navigation, `api/client.ts` (`call`), the copy-catalogue guards and `renderWithProviders`.
- WP12: Mailpit and compose.

## 3. Spec sections

- **§6.8**:
  - The rule shape, with `cooldownHours` defaulting to 336.
  - **Verified basis.** Identity is `(ruleId, itineraryHash)`. Candidates are the observations written by the current execution. A `partially-verified` observation counts only when `requireAllVerified` is false. A drop compares an offer's latest observation with its previous one.
  - **Calendar basis.** Identity is `(ruleId, providerId, cabin, cellKey)`. Candidates are the calendar prices fetched by the current execution in the definition's cabin; reused rows are excluded. A drop compares only with a previous price whose `fetchedAt` is within 2 × `discoveryRefreshHours`.
  - An absent-then-present price goes in the digest's "new" section and is never a drop firing.
  - Suppression uses the `dedupKey` cooldown and the equal-or-lower-price rule.
  - Synthetic rows are refused.
  - Each rule produces one digest per execution, listing the top 10 and a count of the rest.
- **§8.1**: the `alerts: evaluateAlertRules → persist events → notify digests` step, which runs before `completed`.
- **§8.3**: plain-text email.
  - `EmailNotifier` maps `SMTP_TLS`: `starttls` sets `requireTLS`; `none` is allowed only for dev Mailpit or a loopback host.
  - Two subject formats.
  - The body contains:
    - segments, or "calendar price, no itinerary";
    - verdicts naming every unverified constraint;
    - a provenance line with the effective age;
    - a validated `https` link showing its host and expiry state; for a POST booking, a link to the app's results row instead;
    - the coverage caveat "itinerary-searched K of N cells, E outbounds each";
    - the rule.
  - Provider strings are stripped of CRLF and control characters.
  - Synthetic rows are refused.
  - The banned-word test runs over the rendered output with word boundaries.
- **§5.3** (revision 10): validated booking and search links keep their query strings in emails.
- **§10**: the alerts routes the view calls.
- **§11**: the Alerts view has a rule form and an events list.
  - The form has type, threshold or percentage, basis, `requireAllVerified` (verified basis only) and `cooldownHours` (default 336).
  - The events list shows status and reason.
  - Vocabulary: "Google Flights via SearchApi", "Google date grid via SearchApi", "Aviasales cache" and "itinerary-search basis". "Verified" appears only next to class-verified values.
- **§12**: `APP_BASE_URL` builds the results-row link; when it is unset the link is a relative path.
- **§9 item 4**: alert dedup across executions on both bases, digests, and synthetic rows refused by both alerts and notifiers.
- **§9 item 6**: the banned-word test covers the Alerts view.

## 4. Interfaces consumed

Copied from the plan's "Cross-package contracts" v2.

```ts
// @gmt/core — types/alerts.ts (WP0)
export type AlertRuleType = 'absolute' | 'dropPct' | 'dropAbs';
export interface AlertRule { id: string; definitionId: string; type: AlertRuleType; thresholdPence: number | null; pct: number | null; basis: ResultBasis; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export type AlertRuleInput = Omit<AlertRule, 'id'>;
export interface AlertEvent { id: number; ruleId: string; identityKey: string; observationId: number | null; calendarPriceId: number | null; dedupKey: string; firedAt: IsoDateTime; status: 'sent' | 'failed' | 'suppressed'; reason: string | null; payload: unknown }
export type VerifiedCandidate = { basis: 'verified'; observation: Observation; itinerary: NormalisedItinerary; verdictClass: VerdictClass; unverified: ConstraintName[]; seller: string; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type CalendarCandidate = { basis: 'calendar'; calendarPriceId: number; fetchedByExecutionId: string; cell: Cell; pricePence: number; provenance: Provenance; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface Firing { rule: AlertRule; candidate: AlertCandidate; identityKey: string; dedupKey: string; reason: string; isNew: boolean; suppressed: { reason: string } | null }   // evaluateAlertRules returns suppressed firings too; the runner records them with status 'suppressed' and the digest excludes them
export interface PriorFiring { identityKey: string; dedupKey: string; firedAt: IsoDateTime; pricePence: number }
// identityKey formats: verified `${ruleId}|${itineraryHash}`; calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`. dedupKey = `${identityKey}|${Math.floor(pricePence / 100)}`.

// @gmt/core — ports/notifier.ts (WP0)
export interface DigestItem { pricePence: number; provenance: Provenance; cell: Cell; verdictClass: VerdictClass | 'unchecked'; itineraryHash: string | null; seller: string | null; unverified: ConstraintName[]; previousPricePence: number | null; previousAgeHours: number | 'unknown' | null; isNew: boolean; firingReason: string; booking: Booking; bookingExpiresAt: IsoDateTime | null; outbound: Segment[] | null; inbound: Segment[] | null; searchLink: { url: string; host: string; label: string } | null /* null for synthetic rows */; rowKey: string /* resultRowKey, for the app link */ }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number /* firings beyond the top 10 */; newItems: DigestItem[]; newRestCount: number /* new cells beyond the top 10 */; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }
export type OperatorMessageKind = 'paused_budget' | 'paused_error' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed' | 'interrupted' | 'provider_disabled' | 'provider_capped' | 'parity_break' | 'alerts_calendar_only' | 'crash_loop';   // all rendered by WP7's operator templates
export interface OperatorMessage { kind: OperatorMessageKind; executionId: string | null; definitionId: string; subject: string; body: string }
export interface Notifier { id: string; send(msg: { kind: 'digest'; digest: AlertDigest; subject: string; body: string } | { kind: 'operator'; message: OperatorMessage }): Promise<{ ok: boolean; detail?: string }> }

// @gmt/core — other types (WP0)
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'confirmedCostPence' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean; droppedAlwaysInclude: CellKey[] };
export interface Execution { id: string; definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; status: ExecutionStatus; /* … */ }
export interface Segment { marketingCarrier: string; operatingCarrier?: string; flightNumber: number; from: Iata; to: Iata; departLocal: string; arriveLocal: string; departUtc?: IsoDateTime; arriveUtc?: IsoDateTime; durationMinutes?: number; aircraft?: string }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Observation extends ObservationFields { id: number; offerId: number; executionId: string; provenance: Provenance; suppliedFields: SuppliedField[]; partialExpansion: boolean }
export type ResultBasis = 'verified' | 'calendar';
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
// Labels: a bounded age with maxAgeHours 0 formats as `fetched 5h ago` (full); "(≤… before that)" only when maxAgeHours > 0.
export function effectiveAge(p, now: IsoDateTime): EffectiveAge; export function formatAgeFull(a: EffectiveAge): string; export function formatDuration(hours: number): string;
export const BANNED_WORD_ALLOWLIST: readonly string[];   // ['smoke:live', 'lives in']
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export class Secret { constructor(value: string); reveal(): string }
// Config: smtp: { host; port; tls: 'implicit' | 'starttls' | 'none'; user; pass: Secret; to; from } | null; nodeEnv; appBaseUrl: string | null
// api-contract/alerts.ts: alertRuleSchema (AlertRule; requireAllVerified only on basis verified; cooldownHours default 336; thresholdPence required for absolute and dropAbs, pct for dropPct), alertRuleInputSchema, alertEventSchema, alertEventsQuerySchema { ruleId?; definitionId?; limit? }

// @gmt/core — domain functions (WP1, WP2)
export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number;
export function itineraryHash(outbound: Segment[], inbound: Segment[]): string;
export function evaluateConstraints(it: NormalisedItinerary, obs: ObservationFields & { segmentCabins: Cabin[] | null }, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts;
export function verdictClass(v: Verdicts): VerdictClass; export function unverifiedNames(v: Verdicts): ConstraintName[];
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], prior: PriorFiring[], ctx: { now: IsoDateTime; executionId: string; cabin: Cabin; discoveryRefreshHours: Partial<Record<ProviderId, number>> }): Firing[];
// evaluateAlertRules (spec rev 11 §6.8): refuses calendar candidates whose fetchedByExecutionId ≠ ctx.executionId; settles each identity on its cheapest
//   eligible candidate; returns suppressed firings; within the cooldown the same identity fires again only at least max(£10, 5%) below the last fired price;
//   every drop reason states the previous price and its age, on both bases.
export function identityKey(rule: AlertRule, c: AlertCandidate): string;
export function formatPence(pence: number): string;   // the single money formatter (en-GB grouping, throws on non-integer or negative)
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // plain-English constraint labels
export function buildDigest(rule: AlertRule, firings: Firing[], ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] }): AlertDigest | null;   // null when no firing; top 10 + restCount

// @gmt/db (WP3)
export function openDatabase(path: string): Db; export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
export function createRepos(db: Db, clock: Clock, opts: { allowSynthetic: boolean }): Repos;
export class DefinitionsRepo { create(input: DefinitionInput): SearchDefinition; get(id): SearchDefinition | null; /* … */ }
export class ExecutionsRepo { create(input: ExecutionCreateInput): Execution; get(id): Execution | null; /* … */ }
export type ExecutionCreateInput = { definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; estimate: Estimate | null; trigger: Execution['trigger']; status: 'pending' | 'running' | ExecutionStatus & `skipped_${string}` }
export class CellsRepo { seed(executionId, cells: Cell[], discoveryProviders: ProviderId[]): void; seedVerification(executionId, selected: Array<{ cell: CellKey; reason: SelectionReason }>, allCells: CellKey[], verificationProviders: ProviderId[]): void; outcomes(executionId, filter?: { stage?: Stage; providerId?: ProviderId; cells?: CellKey[] }): CellOutcome[]; setOutcome(executionId, cell, stage, providerId, patch: Partial<CellOutcome> & { incrementAttempts?: boolean }): void; selected(executionId): Array<{ cell: CellKey; reason: SelectionReason }>; /* … */ }
export interface CalendarPriceInsert { providerId; sourceKind; cabin; cell: CellKey; pricePence; priceNativeMinor; currencyNative; fx: FxInfo; pointOfSale; fetchedAt; providerObservedAt: IsoDateTime | null; maxAgeHours: number | null; vendorLink: string | null; reusedFromExecutionId: string | null }
export interface CalendarPriceRow extends CalendarPriceInsert { id: number; executionId: string; provenance: Provenance }
export class CalendarPricesRepo { insert(executionId, rows: CalendarPriceInsert[]): number[]; fetchedBy(executionId): CalendarPriceRow[] /* reused excluded */; previousFor(definitionId, providerId, cabin, cell, before: IsoDateTime, notOlderThan: IsoDateTime): CalendarPriceRow | null; /* … */ }
export interface ObservationRow extends Observation { offer: Offer & { id: number }; itinerary: NormalisedItinerary; cell: Cell; seller: string }
export class ItinerariesRepo { upsertItinerary(it: NormalisedItinerary): void; upsertOffer(offer: Offer): number; insertObservation(obs: Omit<Observation, 'id'>): number; writtenBy(executionId): ObservationRow[]; previousObservation(offerId: number, before: IsoDateTime): Observation | null; /* … */ }
export class AlertsRepo { rules(definitionId?: string): AlertRule[]; get(id): AlertRule | null; create(input: AlertRuleInput): AlertRule; update(id, patch: Partial<AlertRuleInput>): AlertRule; softDelete(id): void /* alert_rules.deleted_at; events are kept */; events(filter: { ruleId?: string; definitionId?: string; limit: number }): AlertEvent[]; priorFirings(ruleId, identityKeys: string[], since: IsoDateTime): PriorFiring[]; insertEvent(e: Omit<AlertEvent, 'id'>): number }
export class AirportsRepo { upsertAll(dataset: AirportsDataset): void; /* … */ }

// @gmt/providers (WP4)
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;

// @gmt/engine (WP7)
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export interface EngineOptions { alerts?: AlertsStepHook; fixtureCostMicroGbp?: number }
export type AlertsStepHook = (deps: EngineDeps, executionId: string) => Promise<{ digests: number; events: number }>;   // WP11 provides runAlerts; default noAlerts
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;
export class LogNotifier implements Notifier { constructor(log: Logger) }

// apps/api (WP8), bootstrap/app.ts: "createEngine(ports, { alerts: runAlerts })"
// apps/web (WP9): results-row URL parameters `definition=<id>&row=<rowKey>` (pinned); call<T>(method, path, opts?: { params?; query?: Record<string, string | undefined>; body? }); api; COPY; parsePoundsToPence(input): number | undefined;
//   test/render.tsx renderWithProviders(ui, opts?) → { …render result, user, client }; test/msw/server.ts server (listening from test/setup.ts)
```

**Assumptions about code that later waves deliver.** Each is checked again when wave 7 opens.

1. **`evaluateAlertRules` and new candidates.** An absent-then-present candidate comes back with `isNew: true`. Under a drop rule it is a listing, never a firing. Under an absolute rule it is a firing that is also new.
2. **`buildDigest`.** It puts drop-rule `isNew` firings in `newItems` (top 10, the rest counted in `newRestCount`), excludes suppressed firings, and returns `null` when no firing remains in `items`.
6. **`formatPence(41200)` is `'£412'`** and `formatPence(2050)` is `'£20.50'` (the spec §8.3 subject format). If WP0 renders whole pounds with `.00`, the subject tests change to its output and spec §8.3 is reported.
3. **`AlertsRepo.priorFirings`** returns `sent` events only, so a failed delivery never suppresses the next execution.
4. **WP7's layer-A harness** (`packages/engine/test/harness.ts`) exposes `createHarness()` returning:
   - `deps` and `options`;
   - `createDefinition(patch?)`;
   - `runToCompletion(engine, definitionId)`;
   - `repos` and `notifications`.
5. **WP8's bootstrap** currently reads `createEngine({ ...ports, notifiers: [new LogNotifier(log)] })`. Task 11.7 rewrites that one line.

## 5. Interfaces produced

```ts
// packages/engine/src/alerts/runner.ts
export type AlertRunnerDeps = Pick<EngineDeps, 'config' | 'db' | 'repos' | 'notifiers' | 'clock' | 'log'>;
export interface AlertRunResult { digests: number; events: number }
export async function runAlerts(deps: AlertRunnerDeps, executionId: string): Promise<AlertRunResult>;   // assignable to AlertsStepHook; never rejects

// packages/engine/src/alerts/templates.ts
export interface DigestRenderInput { digest: AlertDigest; definitionName: string; appBaseUrl: string | null; now: IsoDateTime }
export function stripControl(s: string): string;
export function sourceLabel(p: Provenance): string;
export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string;
export function renderSubject(item: DigestItem, now: IsoDateTime): string;
export function renderBody(input: DigestRenderInput): string;
export function appRowLink(appBaseUrl: string | null, definitionId: string, rowKey: string): string;   // `${appBaseUrl ?? ''}/?view=results&definition=<id>&row=<rowKey>`

// packages/engine/src/notifiers/email.ts
export type SmtpConfig = NonNullable<Config['smtp']>;
export interface SmtpTransportOptions { host: string; port: number; secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean; auth: { user: string; pass: string } }
export interface MailMessage { from: string; to: string; subject: string; text: string }
export interface MailTransport { sendMail(m: MailMessage): Promise<{ messageId: string }> }
export type TransportFactory = (o: SmtpTransportOptions) => MailTransport;
export function smtpTransportOptions(smtp: SmtpConfig, nodeEnv: Config['nodeEnv']): SmtpTransportOptions;
export class EmailNotifier implements Notifier { constructor(opts: { smtp: SmtpConfig; nodeEnv: Config['nodeEnv']; log: Logger; createTransport?: TransportFactory }); readonly id: 'email' }

// packages/engine/src/notifiers/index.ts
export function buildNotifiers(config: Pick<Config, 'smtp' | 'nodeEnv'>, log: Logger): Notifier[];   // [LogNotifier, EmailNotifier?]

// apps/web/src/views/Alerts/index.ts
export function AlertsView(props: { definitionId: string }): JSX.Element;
export function describeRule(r: AlertRule): string;
// apps/web/src/api/endpoints.ts additions: api.alertRules(definitionId), api.createAlertRule(body), api.deleteAlertRule(id), api.alertEvents(definitionId, limit)
// apps/web/src/copy.ts addition: COPY.alertsView
```

`packages/engine/src/index.ts` re-exports every engine symbol above.

## 6. Library notes

Verified with context7 on 2026-10-14.

- **nodemailer 10.1.1** (with `@types/nodemailer` 8.0.2). Source: context7 `/nodemailer/nodemailer-homepage`, pages `docs/smtp/index.md` and `docs/transports/stream.md`.
  - `nodemailer.createTransport({ host, port, secure, requireTLS, ignoreTLS, auth: { user, pass } })`:
    - `secure: true` means TLS from connect (implicit, port 465).
    - `secure: false` upgrades with STARTTLS when the server offers it.
    - `requireTLS: true` makes that upgrade mandatory.
    - `ignoreTLS: true` never attempts STARTTLS.
    - Port 465 defaults `secure` to true; this WP always sets `secure` explicitly.
  - `sendMail({ from, to, subject, text })` resolves `info` with `messageId` and `envelope`.
  - **Test transport: `jsonTransport: true`.** This is its own transport type, not an option of `streamTransport`.
    - `info.envelope` is `{ from, to: string[] }`.
    - `info.message` is a JSON string of the message (`subject`, `text`, and `html` only when one is given).
    - The tests inject a `TransportFactory` that records the SMTP options it receives and returns a `jsonTransport` transporter. One test therefore checks both the TLS mapping and the composed message.
  - **Types.** The brief declares its own minimal `SmtpTransportOptions` and `MailTransport`. `// why:` deep `@types` subpath imports are fragile under `NodeNext`, and nodemailer's `Transporter` is structurally assignable to `MailTransport`.
  - **Mailpit.** It sees AUTH over plain SMTP because the `SMTP_*` settings are all-or-nothing. WP12 configures Mailpit to accept that.
- **msw 3.0.3.** Source: context7 `/mswjs/msw`, `setup-server.md` and `http.md`.
  - `http.get/post/delete(path, resolver)`, `HttpResponse.json(body, { status })`, `await request.json()`.
  - Per-test overrides go through `server.use(...)` on WP9's shared `server`. Patterns are `*/api/alerts…`.
- **@testing-library/user-event 14.6.8.** Source: context7 `/testing-library/user-event`, `utility.md` and `convenience.md`.
  - `user.selectOptions`, `user.clear`, `user.type` and `user.click`, through the `user` that `renderWithProviders` returns.
- **@testing-library/react 16.3.3**: `screen`, `within`, `waitFor`.
- **jest-dom 7.0.1**: `toBeDisabled`, `toBeEnabled`, `toHaveValue`.
- **react 19.3.1** with **@tanstack/react-query 5.104.2**: `useQuery`, `useMutation`, `useQueryClient().invalidateQueries`.
- **vitest 5.0.4**: `vi.fn`. Per-task runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>`, which applies no coverage threshold (plan decision 8).

## 7. Files

- **Create (engine source):**
  - `packages/engine/src/alerts/runner.ts`
  - `packages/engine/src/alerts/templates.ts`
  - `packages/engine/src/notifiers/email.ts`
  - `packages/engine/src/notifiers/index.ts`
- **Create (web source):**
  - `apps/web/src/views/Alerts/RuleForm.tsx`
  - `apps/web/src/views/Alerts/EventsTable.tsx`
  - `apps/web/src/views/Alerts/AlertsView.tsx`
  - `apps/web/src/views/Alerts/index.ts`
- **Modify:**
  - `packages/engine/src/index.ts` (exports)
  - `apps/api/src/bootstrap/app.ts` (the one `createEngine` line, Task 11.7)
  - `apps/web/src/api/endpoints.ts` (four wrappers)
  - `apps/web/src/copy.ts` (`alertsView` block)
  - `apps/web/src/App.tsx` (the Alerts placeholder line)
- **Test (engine):**
  - `packages/engine/test/alerts/fixtures.ts`
  - `packages/engine/test/alerts/builders.ts`
  - `packages/engine/test/alerts/runner.digest.test.ts`
  - `packages/engine/test/alerts/templates.test.ts`
  - `packages/engine/test/alerts/runner.verified.test.ts`
  - `packages/engine/test/alerts/runner.calendar.test.ts`
  - `packages/engine/test/alerts/runner.dedup.test.ts`
  - `packages/engine/test/alerts/runner.refusals.test.ts`
  - `packages/engine/test/alerts/engine.alerts.test.ts`
  - `packages/engine/test/notifiers/email.test.ts`
- **Test (web):**
  - `apps/web/test/views/Alerts/RuleForm.test.tsx`
  - `apps/web/test/views/Alerts/AlertsView.test.tsx`

## 8. Tasks

Commands run from the repository root. Every commit message ends with the repository's attribution line.

### Task 11.1: 50 qualifying cells → one digest (first failing test)

**Files:** Create:
- `packages/engine/src/alerts/runner.ts`
- `packages/engine/src/alerts/templates.ts`
- `packages/engine/test/alerts/fixtures.ts`
- `packages/engine/test/alerts/runner.digest.test.ts`

**Interfaces:**
- **Consumes:** `evaluateAlertRules`, `buildDigest`, `CalendarPricesRepo.fetchedBy`, `CellsRepo.selected/outcomes`, `AlertsRepo.rules/insertEvent`, `Notifier`.
- **Produces:** `runAlerts`, `AlertRunnerDeps`, and the calendar half of the templates.

- [ ] **Step 1: Write the failing test.** Start with the shared fixtures, which are test-only. Every row they write is of a real provider kind, because alerts refuse synthetic rows; Task 11.6 proves that.

`packages/engine/test/alerts/fixtures.ts`:

```ts
/**
 * Database fixtures for the alert runner tests (spec §6.8): an in-memory database with the real WP3
 * migrations and repositories, a fixed clock, a capturing logger and a recording notifier.
 * why: alerts refuse synthetic rows (spec §5.5), so these tests write rows of the real provider kinds into a
 * ':memory:' test database; nothing here is reachable from a production bootstrap.
 */
import { fileURLToPath } from 'node:url';
import {
  addDays, asIata, asIsoDate, asIsoDateTime, fixedClock, itineraryHash,
  type AlertDigest, type AlertRule, type Booking, type Cabin, type Cell, type CellKey, type Config, type DefinitionInput,
  type DefinitionSnapshot, type IsoDate, type IsoDateTime, type Logger, type NormalisedItinerary, type Notifier,
  type OperatorMessage, type ProviderId, type SearchDefinition, type Segment, type SuppliedField,
} from '@gmt/core';
import { applyMigrations, createRepos, openDatabase, type Db, type Repos } from '@gmt/db';
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

/** A Logger that keeps every line, so tests can assert on messages and on the absence of secrets. */
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

type NotifierMessage = Parameters<Notifier['send']>[0];
export interface SentDigest { digest: AlertDigest; subject: string; body: string }

/** A Notifier that records every message and answers with a fixed result. */
export class RecordingNotifier implements Notifier {
  readonly id: string;
  readonly sent: NotifierMessage[] = [];
  private readonly result: { ok: boolean; detail?: string };
  constructor(id = 'recording', result: { ok: boolean; detail?: string } = { ok: true }) {
    this.id = id;
    this.result = result;
  }
  async send(msg: NotifierMessage): Promise<{ ok: boolean; detail?: string }> {
    this.sent.push(msg);
    return this.result;
  }
  digests(): SentDigest[] {
    return this.sent.flatMap((m) => (m.kind === 'digest' ? [{ digest: m.digest, subject: m.subject, body: m.body }] : []));
  }
  operatorMessages(): OperatorMessage[] {
    return this.sent.flatMap((m) => (m.kind === 'operator' ? [m.message] : []));
  }
}

export interface Fixture {
  db: Db; clock: ReturnType<typeof fixedClock>; repos: Repos; log: ReturnType<typeof captureLogger>;
  notifier: RecordingNotifier; deps: AlertRunnerDeps;
}

/** A fresh database and repositories per test. `appBaseUrl` defaults to unset. */
export function fixture(opts: { notifier?: RecordingNotifier; appBaseUrl?: string | null } = {}): Fixture {
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS);
  const clock = fixedClock(NOW);
  // why: allowSynthetic lets Task 11.6 write fixture rows so the runner's own refusal can be observed.
  const repos = createRepos(db, clock, { allowSynthetic: true });
  repos.airports.upsertAll({
    version: 'test',
    airports: [
      { iata: LHR, icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'GB', tz: 'Europe/London', lat: 51.47, lon: -0.4543, metro: 'LON' },
      { iata: LGW, icao: 'EGKK', name: 'Gatwick', city: 'London', country: 'GB', tz: 'Europe/London', lat: 51.148, lon: -0.19, metro: 'LON' },
      { iata: JFK, icao: 'KJFK', name: 'John F Kennedy', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40.64, lon: -73.78, metro: 'NYC' },
      { iata: EWR, icao: 'KEWR', name: 'Newark', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40.69, lon: -74.17, metro: 'NYC' },
    ],
    metros: { LON: [LHR, LGW], NYC: [JFK, EWR] },
  });
  const log = captureLogger();
  const notifier = opts.notifier ?? new RecordingNotifier();
  // why: the runner reads only appBaseUrl from config; the cast keeps the test free of the full Config shape.
  const config = { appBaseUrl: opts.appBaseUrl ?? null } as Config;
  return { db, clock, repos, log, notifier, deps: { config, db, repos, notifiers: [notifier], clock, log } };
}

/** The worked-example definition (London → New York), with overrides. */
export function seedDefinition(f: Fixture, over: Partial<DefinitionInput> = {}): SearchDefinition {
  return f.repos.definitions.create({
    name: 'London to New York (worked example)', origins: [LHR, LGW], destinations: [JFK, EWR],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' }, checkedBagRequired: true },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: ['searchapi'], discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
    destinationNotes: {}, onwardCostPence: {}, scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London', enabled: true,
    ...over,
  });
}

/** A running parent execution over the definition's snapshot; returns its id. */
export function seedExecution(f: Fixture, def: SearchDefinition): string {
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: { origins: def.origins, destinations: def.destinations, departureFrom: asIsoDate('2026-10-21'), departureTo: asIsoDate('2027-04-20'), minNights: def.minNights, maxNights: def.maxNights },
    resolvedAt: f.clock.now(), windowClamped: false, droppedAlwaysInclude: [],
  };
  return f.repos.executions.create({ definitionId: def.id, isChild: false, cell: null, snapshot, estimate: null, trigger: 'manual', status: 'running' }).id;
}

/** `n` cells of 14 nights departing daily from 2026-11-01. */
export function cells(n: number, origin = LHR, destination = JFK): Cell[] {
  return Array.from({ length: n }, (_, i) => {
    const departureDate = addDays(asIsoDate('2026-11-01'), i);
    return { origin, destination, departureDate, returnDate: addDays(departureDate, 14), nights: 14 };
  });
}

export interface CalendarSeed { cell: CellKey; pricePence: number; fetchedAt?: IsoDateTime; providerId?: ProviderId; reusedFrom?: string; cabin?: Cabin }

/** Calendar rows of a real provider kind (searchapi by default); providerId 'fixture' writes synthetic rows. */
export function seedCalendar(f: Fixture, executionId: string, rows: CalendarSeed[]): number[] {
  return f.repos.calendarPrices.insert(executionId, rows.map((r) => {
    const providerId = r.providerId ?? 'searchapi';
    const sourceKind = providerId === 'searchapi' ? 'scraped-aggregate' : providerId === 'travelpayouts' ? 'authorised-cached' : 'synthetic';
    return {
      providerId, sourceKind, cabin: r.cabin ?? 'economy', cell: r.cell, pricePence: r.pricePence, priceNativeMinor: r.pricePence,
      currencyNative: 'GBP', fx: { converted: false }, pointOfSale: providerId === 'searchapi' ? 'GB' : 'unknown',
      fetchedAt: r.fetchedAt ?? f.clock.now(), providerObservedAt: null,
      maxAgeHours: providerId === 'searchapi' ? 24 : providerId === 'travelpayouts' ? 48 : 0,
      vendorLink: null, reusedFromExecutionId: r.reusedFrom ?? null,
    };
  }));
}

export const ALL_FIELDS: SuppliedField[] = ['segments', 'segmentTimes', 'segmentCabins', 'selfTransfer', 'baggage', 'fareConditions', 'seller', 'price'];

export interface ObservationSeed {
  departureDate: IsoDate; pricePence: number; flight?: number; seller?: string; fetchedAt?: IsoDateTime;
  suppliedFields?: SuppliedField[]; booking?: Booking; bookingExpiresAt?: IsoDateTime | null; synthetic?: boolean;
}

/** One BA nonstop LHR→JFK round trip of 14 nights, its offer and one observation. */
export function seedObservation(f: Fixture, executionId: string, o: ObservationSeed): { offerId: number; observationId: number; itineraryHash: string } {
  const returnDate = addDays(o.departureDate, 14);
  const flight = o.flight ?? 117;
  const outbound: Segment[] = [{ marketingCarrier: 'BA', flightNumber: flight, from: LHR, to: JFK, departLocal: `${o.departureDate}T08:25`, arriveLocal: `${o.departureDate}T11:20`, durationMinutes: 475 }];
  const inbound: Segment[] = [{ marketingCarrier: 'BA', flightNumber: flight + 1, from: JFK, to: LHR, departLocal: `${returnDate}T18:30`, arriveLocal: `${addDays(returnDate, 1)}T06:35`, durationMinutes: 425 }];
  const hash = itineraryHash(outbound, inbound);
  const it: NormalisedItinerary = {
    hash, origin: LHR, destination: JFK, departureDate: o.departureDate, returnDate, nights: 14, outbound, inbound,
    outboundMinutes: 475, inboundMinutes: 425, stopsOut: 0, stopsIn: 0, layovers: [], airportChange: false, marketingCarriers: ['BA'],
  };
  f.repos.itineraries.upsertItinerary(it);
  const providerId: ProviderId = o.synthetic === true ? 'fixture' : 'searchapi';
  const offerId = f.repos.itineraries.upsertOffer({ itineraryHash: hash, providerId, seller: o.seller ?? 'British Airways', cabin: 'economy' });
  const observationId = f.repos.itineraries.insertObservation({
    offerId, executionId,
    provenance: { providerId, sourceKind: o.synthetic === true ? 'synthetic' : 'scraped-search', fetchedAt: o.fetchedAt ?? f.clock.now(), maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' },
    pricePence: o.pricePence, priceNativeMinor: o.pricePence, currencyNative: 'GBP', fx: { converted: false }, taxesIncluded: true, selfTransfer: false,
    segmentCabins: ['economy', 'economy'], baggage: { cabinBag: 'included', checkedBags: 1 }, fareConditions: null,
    booking: o.booking ?? { kind: 'none' }, bookingExpiresAt: o.bookingExpiresAt ?? null, suppliedFields: o.suppliedFields ?? ALL_FIELDS, partialExpansion: false,
  });
  return { offerId, observationId, itineraryHash: hash };
}

/** Seeds search_cells for `selected`, selects them for verification and marks the first `searched` as priced. */
export function seedVerificationCoverage(f: Fixture, executionId: string, selected: Cell[], searched: number): void {
  f.repos.cells.seed(executionId, selected, ['searchapi']);
  f.repos.cells.seedVerification(executionId, selected.map((cell) => ({ cell, reason: 'top_n' as const })), selected, ['searchapi']);
  for (const cell of selected.slice(0, searched)) f.repos.cells.setOutcome(executionId, cell, 'verification', 'searchapi', { status: 'priced', fetchedAt: f.clock.now() });
}

/** Creates an enabled alert rule (calendar, absolute, £500 by default). */
export function seedRule(f: Fixture, def: SearchDefinition, over: Partial<Omit<AlertRule, 'id' | 'definitionId'>> = {}): AlertRule {
  return f.repos.alerts.create({
    definitionId: def.id, type: 'absolute', thresholdPence: 50000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true,
    ...over,
  });
}

/** The runner's payload on an event row. */
export function payloadOf(e: { payload: unknown }): { digestId: string | null; executionId: string; pricePence: number; previousPence: number | null; isNew: boolean; label: string } {
  return e.payload as ReturnType<typeof payloadOf>;
}
```

`packages/engine/test/alerts/runner.digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, fixture, hoursBefore, LGW, NOW, payloadOf, seedCalendar, seedDefinition, seedExecution, seedRule, seedVerificationCoverage } from './fixtures.js';

describe('one digest per rule per execution (spec §6.8, §9 item 4)', () => {
  it('50 qualifying calendar cells under one absolute rule → one digest, top 10 + 40 more, 50 sent events sharing a digest id', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 50000, basis: 'calendar' });
    seedCalendar(f, ex, cells(50).map((cell, i) => ({ cell, pricePence: 40000 + i * 100 })));
    // why: LGW cells keep the verification caveat's cells distinct from the 50 LHR calendar cells.
    seedVerificationCoverage(f, ex, cells(10, LGW), 3);

    const result = await runAlerts(f.deps, ex);

    expect(result).toEqual({ digests: 1, events: 50 });
    expect(f.notifier.sent).toHaveLength(1);
    const [sent] = f.notifier.digests();
    expect(sent?.digest).toMatchObject({ ruleId: rule.id, executionId: ex, definitionId: def.id, basis: 'calendar', restCount: 40 });
    expect(sent?.digest.items.map((i) => i.pricePence)).toEqual([40000, 40100, 40200, 40300, 40400, 40500, 40600, 40700, 40800, 40900]);
    expect(sent?.digest.coverageCaveat).toEqual({ itinerarySearched: 3, selected: 10, expandTop: 2 });
    expect(sent?.subject).toBe('[get-me-there] £400 LHR→JFK 1 Nov–15 Nov (14n) · Google date grid via SearchApi · fetched just now · provider age unknown (≤24h before that) · constraints not checked');
    expect(sent?.body).toContain('and 40 more');
    expect(sent?.body).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');

    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 1000 });
    expect(events).toHaveLength(50);
    expect(new Set(events.map((e) => e.status))).toEqual(new Set(['sent']));
    expect(new Set(events.map((e) => payloadOf(e).digestId)).size).toBe(1);
    expect(events.every((e) => payloadOf(e).executionId === ex && e.calendarPriceId !== null && e.observationId === null)).toBe(true);
  });

  it('only calendar prices fetched by this execution count: reused copies, other executions and other cabins are excluded', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const earlier = seedExecution(f, def);
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 50000, basis: 'calendar' });
    const [a, b, c] = cells(3);
    if (a === undefined || b === undefined || c === undefined) throw new Error('cells');
    seedCalendar(f, earlier, [{ cell: b, pricePence: 30000, fetchedAt: hoursBefore(NOW, 24) }]);
    seedCalendar(f, ex, [
      { cell: a, pricePence: 45000 },
      { cell: b, pricePence: 30000, fetchedAt: hoursBefore(NOW, 24), reusedFrom: earlier },
      { cell: c, pricePence: 46000, cabin: 'business' },
    ]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[0]?.digest.items.map((i) => i.cell.departureDate)).toEqual([a.departureDate]);
  });

  it('a definition without a verification provider says so; no qualifying price → nothing sent', async () => {
    const f = fixture();
    const def = seedDefinition(f, { providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: { travelpayouts: 168 } } });
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 45000 });
    seedRule(f, def, { thresholdPence: 99999, enabled: false });
    seedCalendar(f, ex, [...cells(1).map((cell) => ({ cell, pricePence: 40000, providerId: 'travelpayouts' as const })), ...cells(3).slice(1).map((cell) => ({ cell, pricePence: 47000, providerId: 'travelpayouts' as const }))]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[0]?.digest.coverageCaveat).toBeNull();
    expect(f.notifier.digests()[0]?.body).toContain('Coverage: itinerary-searched 0 cells (no verification provider configured)');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts`

Expected: FAIL, because the import `../../src/alerts/runner.js` cannot be resolved.

- [ ] **Step 3: Implement.** This step writes the full calendar half of the templates. Task 11.2 adds the verified-item lines.

`packages/engine/src/alerts/templates.ts`:

```ts
/**
 * Plain-text alert email (spec §8.3). Core's buildDigest decides what is in a digest; this module decides the words.
 * Every provider-supplied string passes stripControl before it is written.
 */
import {
  effectiveAge, formatAgeFull, formatDuration, formatPence,
  type AlertDigest, type AlertRule, type DigestItem, type IsoDateTime, type Provenance,
} from '@gmt/core';

/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). */
export interface DigestRenderInput { digest: AlertDigest; definitionName: string; appBaseUrl: string | null; now: IsoDateTime }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Removes CR, LF, every other C0/C1 control and the Unicode line/paragraph separators, collapsing runs to one space.
 * Spec §8.3: provider strings are CRLF/control-stripped, so none can start a header or a line.
 */
export function stripControl(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose of this function.
  return s.replace(/[\u0000-\u001f\u007f-\u009f  ]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Source in words (spec §11 vocabulary). Synthetic rows have no label and throw. */
export function sourceLabel(p: Provenance): string {
  if (p.providerId === 'searchapi' && p.sourceKind === 'scraped-search') return 'Google Flights via SearchApi';
  if (p.providerId === 'searchapi' && p.sourceKind === 'scraped-aggregate') return 'Google date grid via SearchApi';
  if (p.providerId === 'travelpayouts' && p.sourceKind === 'authorised-cached') return 'Aviasales cache';
  throw new Error(`templates: no source label for ${p.providerId}/${p.sourceKind}; synthetic rows are refused (spec §5.5)`);
}

/** "14 Mar" from a calendar date string; never through Date (spec §6.1). */
function day(d: string): string {
  const [, m, dd] = d.slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/** "£412 LHR→JFK 14 Mar–28 Mar (14n)", with "≈" when FX-converted (spec §11). */
export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string {
  const price = `${item.provenance.fx.converted ? '≈' : ''}${formatPence(item.pricePence)}`;
  return `${price} ${item.cell.origin}→${item.cell.destination} ${day(item.cell.departureDate)}–${day(item.cell.returnDate)} (${item.cell.nights}n)`;
}

function verdictSegment(item: DigestItem): string {
  if (item.verdictClass === 'unchecked') return 'constraints not checked';
  if (item.verdictClass === 'verified') return 'class verified';
  const n = item.unverified.length;
  return `${n} constraint${n === 1 ? '' : 's'} unverified`;
}

/** Spec §8.3 subject for the digest's first (cheapest) item. */
export function renderSubject(item: DigestItem, now: IsoDateTime): string {
  return stripControl(`[get-me-there] ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${formatAgeFull(effectiveAge(item.provenance, now))} · ${verdictSegment(item)}`);
}

/** The app URL of a results row with WP9's pinned parameters: absolute under APP_BASE_URL, else a relative path (spec §12). */
export function appRowLink(appBaseUrl: string | null, definitionId: string, rowKey: string): string {
  return `${(appBaseUrl ?? '').replace(/\/+$/, '')}/?view=results&definition=${encodeURIComponent(definitionId)}&row=${encodeURIComponent(rowKey)}`;
}

/** https, no userinfo, and (when given) the host the link was validated against. Spec §5.2, re-checked at render. */
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

/** Core's labelled search link; spec §5.3 keeps its query in email. Null only for synthetic rows, which never reach here. */
function searchLine(item: DigestItem): string {
  return item.searchLink === null ? 'Link: none' : `Link: ${item.searchLink.url} (host ${item.searchLink.host}, ${item.searchLink.label})`;
}

function calendarLinkLine(item: DigestItem): string {
  if (item.booking.kind === 'get' && validHttps(item.booking.url, item.booking.host) !== null) {
    return `Link: ${item.booking.url} (host ${item.booking.host}, calendar price link, not a fare link)`;
  }
  return searchLine(item);
}

function previousLine(item: DigestItem): string | null {
  if (item.previousPricePence === null) return null;
  const age = item.previousAgeHours;
  const when = age === null || age === 'unknown' ? 'at an unknown time' : age < 1 ? 'just now' : `${formatDuration(age)} ago`;
  return `   Previous: ${formatPence(item.previousPricePence)}, fetched ${when}`;
}

/** Lines specific to the item's basis; Task 11.2 adds the verified branch. */
function basisLines(_item: DigestItem, _input: DigestRenderInput): string[] {
  return ['   calendar price, no itinerary; constraints not checked'];
}

function linkLine(item: DigestItem, _input: DigestRenderInput): string {
  return calendarLinkLine(item);
}

function itemLines(n: number, item: DigestItem, input: DigestRenderInput): string[] {
  const lines = [`${n}. ${routeLine(item)}`, `   Why: ${stripControl(item.firingReason)}`, ...basisLines(item, input)];
  const prev = previousLine(item);
  if (prev !== null) lines.push(prev);
  lines.push(`   Provenance: ${sourceLabel(item.provenance)} · ${formatAgeFull(effectiveAge(item.provenance, input.now))}`);
  lines.push(`   ${linkLine(item, input)}`);
  return lines;
}

function ruleText(r: AlertRule): string {
  const what = r.type === 'absolute' ? `alert when the price is ${formatPence(r.thresholdPence ?? 0)} or less`
    : r.type === 'dropAbs' ? `alert when the price drops by ${formatPence(r.thresholdPence ?? 0)} or more`
    : `alert when the price drops by ${r.pct ?? 0}% or more`;
  const basis = r.basis === 'calendar' ? 'calendar basis, constraints not checked'
    : r.requireAllVerified === true ? 'itinerary-search basis, class verified only' : 'itinerary-search basis, class verified or partially-verified';
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
    for (const item of d.newItems) lines.push(`- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${formatAgeFull(effectiveAge(item.provenance, input.now))}`);
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
 * from the current execution, evaluate rules (core), build one structured digest per rule (core), render it (templates),
 * send it to every notifier and persist one alert_events row per firing.
 */
import { randomUUID } from 'node:crypto';
import {
  asIsoDateTime, buildDigest, daysBetween, evaluateAlertRules,
  type AlertCandidate, type AlertDigest, type AlertRule, type CalendarCandidate, type DefinitionSnapshot, type Firing,
  type IsoDateTime, type Logger, type Notifier, type SearchDefinition,
} from '@gmt/core';
import type { EngineDeps } from '../index.js';
import { renderBody, renderSubject, routeLine } from './templates.js';

/** What the runner needs from the engine's dependencies; EngineDeps satisfies it, so runAlerts is an AlertsStepHook. */
export type AlertRunnerDeps = Pick<EngineDeps, 'config' | 'db' | 'repos' | 'notifiers' | 'clock' | 'log'>;
/** Digests delivered (sent or failed) and alert_events rows written (any status). */
export interface AlertRunResult { digests: number; events: number }

interface RunContext {
  deps: AlertRunnerDeps; log: Logger; now: IsoDateTime; executionId: string;
  definition: SearchDefinition; snapshot: DefinitionSnapshot;
  pools: Map<AlertRule['basis'], AlertCandidate[]>;
}

const NONE: AlertRunResult = { digests: 0, events: 0 };
const HOUR_MS = 3_600_000;

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
      deps, log: deps.log.child({ executionId, definitionId: definition.id }), now: deps.clock.now(), executionId,
      definition, snapshot: execution.snapshot, pools: new Map(),
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
        ctx.log.error({ ruleId: rule.id, err: err instanceof Error ? err.message : String(err) }, 'alerts: rule failed; other rules continue');
      }
    }
    return { digests, events };
  } catch (err) {
    deps.log.error({ executionId, err: err instanceof Error ? err.message : String(err) }, 'alerts: step failed; execution still completes');
    return NONE;
  }
}

function poolFor(ctx: RunContext, basis: AlertRule['basis']): AlertCandidate[] {
  const cached = ctx.pools.get(basis);
  if (cached !== undefined) return cached;
  // why: the verified pool is gathered from Task 11.3 on; until then a verified rule has no candidates.
  const pool = basis === 'calendar' ? calendarPool(ctx) : [];
  ctx.pools.set(basis, pool);
  return pool;
}

/** Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin. Spec §6.8. */
function calendarPool(ctx: RunContext): CalendarCandidate[] {
  return ctx.deps.repos.calendarPrices.fetchedBy(ctx.executionId)
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map((r) => ({
      basis: 'calendar' as const, calendarPriceId: r.id, fetchedByExecutionId: r.executionId, pricePence: r.pricePence, provenance: r.provenance, previous: null,
      cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
    }));
}

/** "itinerary-searched K of N cells, E outbounds each" for this execution; null without a verification provider. */
function coverageFor(ctx: RunContext): AlertDigest['coverageCaveat'] {
  if (ctx.snapshot.providers.verification.length === 0) return null;
  const selected = ctx.deps.repos.cells.selected(ctx.executionId).length;
  const searched = new Set(
    ctx.deps.repos.cells.outcomes(ctx.executionId, { stage: 'verification' })
      .filter((o) => o.status === 'priced' || o.status === 'empty')
      .map((o) => `${o.origin}|${o.destination}|${o.departureDate}|${o.returnDate}`),
  );
  return { itinerarySearched: searched.size, selected, expandTop: ctx.snapshot.verification.expandTop };
}

async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const candidates = poolFor(ctx, rule.basis);
  // why: no prior firings until Task 11.5 adds the cooldown lookup.
  const firings = evaluateAlertRules([rule], candidates, [], {
    now: ctx.now, executionId: ctx.executionId, cabin: ctx.snapshot.cabin, discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  // why: spec §6.8 — absent-then-present is listed as "new" and is never a drop firing.
  const listings = firings.filter((f) => f.isNew && rule.type !== 'absolute');
  const real = firings.filter((f) => !(f.isNew && rule.type !== 'absolute'));
  if (real.length === 0) return NONE;
  return deliver(ctx, rule, real, listings);
}

/** Builds, renders and sends one digest, then writes one event per firing in one transaction. */
async function deliver(ctx: RunContext, rule: AlertRule, firings: Firing[], listings: Firing[]): Promise<AlertRunResult> {
  const digest = buildDigest(rule, [...firings, ...listings], { executionId: ctx.executionId, definitionId: ctx.definition.id, coverageCaveat: coverageFor(ctx) });
  const first = digest?.items[0];
  // why: plan decision 10 — a digest with only "new" items and no firing is not sent.
  if (digest === null || first === undefined) return NONE;
  const subject = renderSubject(first, ctx.now);
  const body = renderBody({ digest, definitionName: ctx.definition.name, appBaseUrl: ctx.deps.config.appBaseUrl, now: ctx.now });
  const outcome = await sendToAll(ctx.deps.notifiers, { kind: 'digest', digest, subject, body });
  const digestId = randomUUID();
  ctx.deps.db.transaction(() => {
    for (const f of firings) {
      ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, outcome.status, outcome.status === 'sent' ? f.reason : `${f.reason}; not delivered: ${outcome.detail}`, digestId));
    }
  });
  return { digests: 1, events: firings.length };
}

function priceOf(c: AlertCandidate): number {
  return c.basis === 'verified' ? c.observation.pricePence : c.pricePence;
}

function eventRow(ctx: RunContext, f: Firing, status: 'sent' | 'failed' | 'suppressed', reason: string, digestId: string | null) {
  const c = f.candidate;
  const label = c.basis === 'verified'
    ? routeLine({ pricePence: c.observation.pricePence, provenance: c.observation.provenance, cell: { origin: c.itinerary.origin, destination: c.itinerary.destination, departureDate: c.itinerary.departureDate, returnDate: c.itinerary.returnDate, nights: c.itinerary.nights } })
    : routeLine(c);
  return {
    ruleId: f.rule.id, identityKey: f.identityKey,
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
    dedupKey: f.dedupKey, firedAt: ctx.now, status, reason,
    payload: { digestId, executionId: ctx.executionId, pricePence: priceOf(c), previousPence: c.previous?.pricePence ?? null, isNew: f.isNew, label },
  };
}

/** Sends to every notifier; `sent` only when every notifier accepted the message. */
async function sendToAll(notifiers: readonly Notifier[], msg: Parameters<Notifier['send']>[0]): Promise<{ status: 'sent' } | { status: 'failed'; detail: string }> {
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

/** Internal pieces later tasks extend. */
export const _hours = (at: IsoDateTime, h: number): IsoDateTime => asIsoDateTime(new Date(new Date(at).getTime() - h * HOUR_MS).toISOString());
```

Add the following to `packages/engine/src/index.ts`:

```ts
export { runAlerts, type AlertRunnerDeps, type AlertRunResult } from './alerts/runner.js';
export { renderSubject, renderBody, stripControl, sourceLabel, routeLine, appRowLink, type DigestRenderInput } from './alerts/templates.js';
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.digest.test.ts`. Expected: PASS, 3 tests.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert runner delivers one rendered digest per rule per execution (spec §6.8, §8.3)"`

### Task 11.2: Templates for verified items, CRLF stripping, banned words

**Files:** Modify `packages/engine/src/alerts/templates.ts`. Create:
- `packages/engine/test/alerts/builders.ts`
- `packages/engine/test/alerts/templates.test.ts`

- [ ] **Step 1: Write the failing test.**

`packages/engine/test/alerts/builders.ts`:

```ts
/** Hand-built digest items for template and notifier tests (no database). Worked example only. */
import { asIata, asIsoDate, asIsoDateTime, type AlertDigest, type AlertRule, type DigestItem } from '@gmt/core';
import type { DigestRenderInput } from '../../src/alerts/templates.js';

export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
export const HASH = 'a'.repeat(64);
export const ROW_KEY = `v:${HASH}`;
const LHR = asIata('LHR');
const JFK = asIata('JFK');
const CELL = { origin: LHR, destination: JFK, departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-28'), nights: 14 };
const SEARCH = { url: 'https://www.google.com/travel/flights?q=LHR+JFK+2027-03-14+2027-03-28', host: 'www.google.com', label: 'search link, not a fare link' };

export function verifiedItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    pricePence: 41200, cell: CELL, verdictClass: 'partially-verified', itineraryHash: HASH, seller: 'British Airways', unverified: ['checkedBagRequired'],
    provenance: { providerId: 'searchapi', sourceKind: 'scraped-search', fetchedAt: asIsoDateTime('2026-10-14T10:00:00.000Z'), maxAgeHours: 0, fx: { converted: false }, pointOfSale: 'GB', cabin: 'economy' },
    previousPricePence: null, previousAgeHours: null, isNew: false, firingReason: '£412 is at or below the £450 threshold',
    booking: { kind: 'get', url: 'https://www.google.com/travel/clk?tfs=abc', host: 'www.google.com' }, searchLink: SEARCH,
    bookingExpiresAt: asIsoDateTime('2026-10-14T18:00:00.000Z'), rowKey: ROW_KEY,
    outbound: [{ marketingCarrier: 'BA', flightNumber: 117, from: LHR, to: JFK, departLocal: '2027-03-14T08:25', arriveLocal: '2027-03-14T11:20', durationMinutes: 475 }],
    inbound: [{ marketingCarrier: 'BA', flightNumber: 112, from: JFK, to: LHR, departLocal: '2027-03-28T18:30', arriveLocal: '2027-03-29T06:35', durationMinutes: 425 }],
    ...over,
  };
}

// why: maxAgeHours 168 reproduces the spec §8.3 example text "(≤7d before that)"; Travelpayouts itself declares 48 (spec §2).
export function calendarItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    pricePence: 38900, cell: CELL, verdictClass: 'unchecked', itineraryHash: null, seller: null, unverified: [],
    provenance: { providerId: 'travelpayouts', sourceKind: 'authorised-cached', fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'), maxAgeHours: 168, fx: { converted: false }, pointOfSale: 'unknown', cabin: 'economy' },
    previousPricePence: null, previousAgeHours: null, isNew: false, firingReason: '£389 is at or below the £450 threshold',
    booking: { kind: 'none' }, searchLink: { url: 'https://www.aviasales.com/search/LON1403NYC28031', host: 'www.aviasales.com', label: 'search link, not a fare link' },
    bookingExpiresAt: null, outbound: null, inbound: null, rowKey: 'c:travelpayouts|LHR|JFK|2027-03-14|2027-03-28',
    ...over,
  };
}

export const RULE: AlertRule = { id: 'rule-1', definitionId: 'def-1', type: 'absolute', thresholdPence: 45000, pct: null, basis: 'verified', requireAllVerified: false, cooldownHours: 336, enabled: true };

export function digestOf(items: DigestItem[], over: Partial<AlertDigest> = {}): AlertDigest {
  return { ruleId: RULE.id, definitionId: 'def-1', executionId: 'ex-1', basis: 'verified', items, restCount: 0, newItems: [], newRestCount: 0, coverageCaveat: { itinerarySearched: 3, selected: 10, expandTop: 2 }, rule: RULE, ...over };
}

export function renderInput(over: Partial<DigestRenderInput> = {}): DigestRenderInput {
  return { digest: digestOf([verifiedItem()]), definitionName: 'London to New York (worked example)', appBaseUrl: null, now: NOW, ...over };
}
```

`packages/engine/test/alerts/templates.test.ts`:

```ts
import { asIsoDateTime, BANNED_WORD_ALLOWLIST, CONSTRAINT_LABELS, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { appRowLink, renderBody, renderSubject, sourceLabel, stripControl } from '../../src/alerts/templates.js';
import { calendarItem, digestOf, NOW, renderInput, ROW_KEY, RULE, verifiedItem } from './builders.js';

describe('subject formats (spec §8.3)', () => {
  it('verified basis: the worked example', () => {
    expect(renderSubject(verifiedItem(), NOW)).toBe('[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · 1 constraint unverified');
  });
  it('calendar basis: provider age bound and "constraints not checked"', () => {
    expect(renderSubject(calendarItem(), NOW)).toBe('[get-me-there] £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · constraints not checked');
  });
  it('class verified, plural unverified, ≈ for FX-converted prices', () => {
    expect(renderSubject(verifiedItem({ verdictClass: 'verified', unverified: [] }), NOW)).toMatch(/ · class verified$/);
    expect(renderSubject(verifiedItem({ unverified: ['checkedBagRequired', 'noSelfTransfer'] }), NOW)).toMatch(/ · 2 constraints unverified$/);
    const fx = verifiedItem({ provenance: { ...verifiedItem().provenance, fx: { converted: true, rateNano: 790_000_000, rateDate: '2026-10-13' as never, source: 'ecb' } } });
    expect(renderSubject(fx, NOW)).toContain('≈£412 LHR→JFK');
  });
  it('SearchApi date grid label; synthetic provenance refused', () => {
    expect(sourceLabel({ ...calendarItem().provenance, providerId: 'searchapi', sourceKind: 'scraped-aggregate' })).toBe('Google date grid via SearchApi');
    expect(() => sourceLabel({ ...calendarItem().provenance, providerId: 'fixture', sourceKind: 'synthetic' })).toThrow(/synthetic/);
  });
});

describe('verified item body (spec §8.3)', () => {
  it('segments, seller, every unverified constraint, provenance, link with host and expiry, coverage, rule, rest count', () => {
    const body = renderBody(renderInput({ digest: digestOf([verifiedItem()], { restCount: 40 }) }));
    expect(body).not.toContain('more new cells');
    for (const line of [
      'Seller: British Airways',
      'Outbound: BA 117 LHR 08:25 → JFK 11:20 (14 Mar)',
      'Inbound: BA 112 JFK 18:30 → LHR 06:35 (29 Mar)',
      `Verdicts: class partially-verified; unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`,
      'Provenance: Google Flights via SearchApi · fetched 5h ago',
      'Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)',
      'and 40 more',
      'Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each',
      'Rule: alert when the price is £450 or less · itinerary-search basis, class verified or partially-verified · cooldown 336h',
    ]) expect(body).toContain(line);
  });
  it('POST booking: links to the app results row (relative without APP_BASE_URL, absolute with it), never the vendor form', () => {
    const post = verifiedItem({ booking: { kind: 'post', url: 'https://www.google.com/travel/clk/f', postData: 'u=formdata', host: 'www.google.com' } });
    const relative = renderBody(renderInput({ digest: digestOf([post]) }));
    expect(relative).toContain(`/?view=results&definition=def-1&row=${encodeURIComponent(ROW_KEY)}`);
    expect(appRowLink(null, 'def-1', ROW_KEY)).toBe(`/?view=results&definition=def-1&row=${encodeURIComponent(ROW_KEY)}`);
    expect(relative).not.toContain('u=formdata');
    expect(relative).not.toContain('https://www.google.com/travel/clk/f');
    const absolute = renderBody(renderInput({ digest: digestOf([post]), appBaseUrl: 'https://gmt.example.ts.net' }));
    expect(absolute).toContain(`https://gmt.example.ts.net/?view=results&definition=def-1&row=${encodeURIComponent(ROW_KEY)}`);
  });
  it('expired, unstated expiry, no booking → labelled search link, failed validation → no link', () => {
    expect(renderBody(renderInput({ digest: digestOf([verifiedItem({ bookingExpiresAt: asIsoDateTime('2026-10-14T13:00:00.000Z') })]) }))).toContain('expired 2h ago');
    expect(renderBody(renderInput({ digest: digestOf([verifiedItem({ bookingExpiresAt: null })]) }))).toContain('expiry not stated');
    expect(renderBody(renderInput({ digest: digestOf([verifiedItem({ booking: { kind: 'none' } })]) }))).toContain('Link: https://www.google.com/travel/flights?q=LHR+JFK+2027-03-14+2027-03-28 (host www.google.com, search link, not a fare link)');
    const bad = renderBody(renderInput({ digest: digestOf([verifiedItem({ booking: { kind: 'get', url: 'http://www.google.com/x', host: 'www.google.com' } })]) }));
    expect(bad).not.toContain('http://www.google.com/x');
    expect(bad).toContain('Link: none (the stored link failed validation)');
  });
  it('calendar item with a drop: previous price and age; new items in their own section', () => {
    const drop = calendarItem({ previousPricePence: 43000, previousAgeHours: 72, firingReason: 'dropped £41 (9%) from £430' });
    const body = renderBody(renderInput({
      digest: digestOf([drop], { basis: 'calendar', coverageCaveat: null, newItems: [calendarItem({ isNew: true })], newRestCount: 4, rule: { ...RULE, type: 'dropAbs', thresholdPence: 2000, basis: 'calendar', requireAllVerified: null } }),
    }));
    for (const line of [
      'calendar price, no itinerary; constraints not checked',
      'Previous: £430, fetched 3d ago',
      'Provenance: Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that)',
      'Link: https://www.aviasales.com/search/LON1403NYC28031 (host www.aviasales.com, search link, not a fare link)',
      'New since the last check (no earlier price to compare; not a drop):',
      'and 4 more new cells',
      '- £389 LHR→JFK 14 Mar–28 Mar (14n) · Aviasales cache',
      'Coverage: itinerary-searched 0 cells (no verification provider configured)',
      'Rule: alert when the price drops by £20 or more · calendar basis, constraints not checked · cooldown 336h',
    ]) expect(body).toContain(line);
  });
});

describe('provider strings are CRLF/control-stripped (spec §8.3)', () => {
  it('a seller name or definition name cannot inject headers or lines', () => {
    const item = verifiedItem({ seller: 'Cheap Seats\r\nBcc: victim@example.com\u0007' });
    const body = renderBody(renderInput({ digest: digestOf([item]), definitionName: 'Trip\r\nX-Injected: 1' }));
    expect(body).not.toMatch(/\r/);
    expect(body.split('\n').some((l) => l.startsWith('Bcc:') || l.startsWith('X-Injected:'))).toBe(false);
    expect(body).toContain('Seller: Cheap Seats Bcc: victim@example.com');
    expect(renderSubject(item, NOW)).not.toMatch(/[\r\n]/);
  });
  it('stripControl removes C0, C1 and line separators', () => {
    expect(stripControl('\u0000a b\tc\u0085d\r\n')).toBe('a b c d');
  });
});

describe('banned words over rendered output (spec §8.3, §11)', () => {
  it('no banned word in any rendered subject or body', () => {
    const outputs = [
      renderSubject(verifiedItem(), NOW), renderSubject(calendarItem(), NOW),
      renderBody(renderInput({ digest: digestOf([verifiedItem()], { restCount: 40, newItems: [calendarItem({ isNew: true })] }) })),
      renderBody(renderInput({ digest: digestOf([calendarItem({ previousPricePence: 43000, previousAgeHours: 'unknown' })], { coverageCaveat: null }) })),
      renderBody(renderInput({ digest: digestOf([verifiedItem({ booking: { kind: 'none' }, verdictClass: 'verified', unverified: [] })]) })),
    ];
    for (const text of outputs) expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/templates.test.ts`. Expected: FAIL in "verified item body" and the CRLF seller test. The body still prints "calendar price, no itinerary" for verified items and has no `Seller:` line. The subject tests pass.

- [ ] **Step 3: Implement.** In `templates.ts`, add `CONSTRAINT_LABELS` and `type Segment` to the core import (the labels are core's, plan decision 15) and add:

```ts
const HOUR_MS = 3_600_000;

function hoursBetween(from: IsoDateTime, to: IsoDateTime): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / HOUR_MS);
}

function segmentLine(s: Segment): string {
  const hhmm = (local: string) => local.slice(11, 16);
  return `${stripControl(s.marketingCarrier)} ${s.flightNumber} ${s.from} ${hhmm(s.departLocal)} → ${s.to} ${hhmm(s.arriveLocal)} (${day(s.departLocal)})`;
}

function expiryText(expiresAt: IsoDateTime | null, now: IsoDateTime): string {
  if (expiresAt === null) return 'expiry not stated';
  const h = hoursBetween(now, expiresAt);
  if (h > 0) return `expires in ${formatDuration(h)}`;
  return -h < 1 ? 'expired just now' : `expired ${formatDuration(-h)} ago`;
}

function verifiedLinkLine(item: DigestItem, input: DigestRenderInput): string {
  const b = item.booking;
  if (b.kind === 'post') {
    return `Link: this fare is booked through a form, which email cannot submit; open the results row in get-me-there: ${appRowLink(input.appBaseUrl, input.digest.definitionId, item.rowKey)}`;
  }
  if (b.kind === 'none') return searchLine(item);
  // why: spec §5.3 (rev 10) — a validated booking link keeps its query in email; it carries no credentials.
  return validHttps(b.url, b.host) === null ? 'Link: none (the stored link failed validation)' : `Link: ${b.url} (host ${b.host}, ${expiryText(item.bookingExpiresAt, input.now)})`;
}
```

Then replace `basisLines` and `linkLine` with:

```ts
/** Lines specific to the item's basis: segments and verdicts for verified items, a marker for calendar prices. */
function basisLines(item: DigestItem, _input: DigestRenderInput): string[] {
  if (item.verdictClass === 'unchecked') return ['   calendar price, no itinerary; constraints not checked'];
  return [
    `   Seller: ${stripControl(item.seller ?? 'not stated')}`,
    item.outbound === null ? '   Segments: not available' : `   Outbound: ${item.outbound.map(segmentLine).join('; ')}`,
    ...(item.inbound === null ? [] : [`   Inbound: ${item.inbound.map(segmentLine).join('; ')}`]),
    item.verdictClass === 'verified'
      ? '   Verdicts: class verified; every constraint passed'
      : `   Verdicts: class ${item.verdictClass}; unverified: ${item.unverified.map((k) => CONSTRAINT_LABELS[k]).join(', ')}`,
  ];
}

function linkLine(item: DigestItem, input: DigestRenderInput): string {
  return item.verdictClass === 'unchecked' ? calendarLinkLine(item) : verifiedLinkLine(item, input);
}
```


- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS, with 12 tests in `templates.test.ts`.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: verified-item email lines, CRLF stripping and banned-word test over rendered output"`

### Task 11.3: Verified basis: current-execution observations, identity, requireAllVerified, drops

**Files:**
- Modify `packages/engine/src/alerts/runner.ts`.
- Test `packages/engine/test/alerts/runner.verified.test.ts`.

**Interfaces:** Consumes `ItinerariesRepo.writtenBy`, `ItinerariesRepo.previousObservation`, `evaluateConstraints`, `verdictClass` and `unverifiedNames`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.verified.test.ts`:

```ts
import { asIsoDate, CONSTRAINT_LABELS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { ALL_FIELDS, fixture, hoursBefore, NOW, payloadOf, seedDefinition, seedExecution, seedObservation, seedRule } from './fixtures.js';

const WITHOUT_BAGGAGE = ALL_FIELDS.filter((x) => x !== 'baggage');   // checkedBagRequired → unverified

function scenario() {
  const f = fixture();
  const def = seedDefinition(f);
  const earlier = seedExecution(f, def);
  const ex = seedExecution(f, def);
  // A: seen at £500 a week ago, £420 now, every constraint passes → class verified
  seedObservation(f, earlier, { departureDate: asIsoDate('2026-11-02'), pricePence: 50000, flight: 117, fetchedAt: hoursBefore(NOW, 168) });
  const a = seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000, flight: 117 });
  // B: first seen now at £410, baggage not supplied → partially-verified
  const b = seedObservation(f, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 41000, flight: 177, suppliedFields: WITHOUT_BAGGAGE });
  // C: written by the earlier execution only → never a candidate of this one
  seedObservation(f, earlier, { departureDate: asIsoDate('2026-11-04'), pricePence: 30000, flight: 115, fetchedAt: hoursBefore(NOW, 168) });
  return { f, def, ex, a, b };
}

describe('verified basis (spec §6.8)', () => {
  it('candidates are observations written by the current execution; identity is (ruleId, itineraryHash)', async () => {
    const { f, def, ex, a, b } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(events.map((e) => e.identityKey).sort()).toEqual([`${rule.id}|${a.itineraryHash}`, `${rule.id}|${b.itineraryHash}`].sort());
    expect(events.every((e) => e.observationId !== null && e.calendarPriceId === null)).toBe(true);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(`unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`);
    expect(body).toContain('Outbound: BA 117 LHR 08:25 → JFK 11:20 (2 Nov)');
  });

  it('requireAllVerified admits class verified only', async () => {
    const { f, def, ex, a } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: true });
    await runAlerts(f.deps, ex);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => e.identityKey)).toEqual([`${rule.id}|${a.itineraryHash}`]);
  });

  it('a drop compares the offer with its previous observation; a first sighting is new, not a drop', async () => {
    const { f, def, ex, b } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', type: 'dropPct', thresholdPence: null, pct: 10, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(event === undefined ? null : payloadOf(event)).toMatchObject({ pricePence: 42000, previousPence: 50000, isNew: false });
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Previous: £500, fetched 7d ago');
    expect(event?.reason).toContain('£500');
    expect(body).toContain('New since the last check');
    expect(body).toContain('£410 LHR→JFK 3 Nov–17 Nov (14n)');
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).some((e) => e.observationId === b.observationId)).toBe(false);
  });

  it('the cheapest eligible offer per itinerary represents it once (core settles identities, rev 11)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 44000, seller: 'British Airways' });
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 43000, seller: 'An agency' });
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => payloadOf(e).pricePence)).toEqual([43000]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.verified.test.ts`. Expected: FAIL with `expected { digests: 0, events: 0 } to deeply equal { digests: 1, events: 2 }`, because the verified pool is empty.

- [ ] **Step 3: Implement.** In `runner.ts`, add `evaluateConstraints`, `unverifiedNames`, `verdictClass` and `type VerifiedCandidate` to the core import. In `poolFor`, replace the pool line with:

```ts
  const pool = basis === 'calendar' ? calendarPool(ctx) : verifiedPool(ctx);
```

Then add:

```ts
/**
 * Observations written by this execution in the snapshot's cabin, verdicts recomputed against the current definition (spec §6.2),
 * failed excluded; previous = each offer's previous observation. Spec §6.8.
 * why: core settles each identity on its cheapest eligible candidate (rev 11), so every offer is passed; reducing here could
 * drop the class-verified offer a requireAllVerified rule needs in favour of a cheaper partially-verified one.
 */
function verifiedPool(ctx: RunContext): VerifiedCandidate[] {
  const out: VerifiedCandidate[] = [];
  for (const row of ctx.deps.repos.itineraries.writtenBy(ctx.executionId)) {
    if (row.offer.cabin !== ctx.snapshot.cabin) continue;
    const verdicts = evaluateConstraints(row.itinerary, row, ctx.definition.constraints, ctx.snapshot.cabin, row.suppliedFields);
    const cls = verdictClass(verdicts);
    if (cls === 'failed') continue;
    const prev = ctx.deps.repos.itineraries.previousObservation(row.offerId, row.provenance.fetchedAt);
    out.push({
      basis: 'verified', observation: row, itinerary: row.itinerary, verdictClass: cls, unverified: unverifiedNames(verdicts), seller: row.seller,
      previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.provenance.fetchedAt },
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: verified-basis candidates from the current execution, drops vs previous observation"`

### Task 11.4: Calendar basis: identity, drop window at 2 × discoveryRefreshHours, new section

**Files:**
- Modify `packages/engine/src/alerts/runner.ts`.
- Test `packages/engine/test/alerts/runner.calendar.test.ts`.

**Interfaces:** Consumes `CalendarPricesRepo.previousFor`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.calendar.test.ts`:

```ts
import { cellKeyString } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, fixture, hoursBefore, NOW, payloadOf, seedCalendar, seedDefinition, seedExecution, seedRule } from './fixtures.js';

// why: discoveryRefreshHours 84 puts the spec §6.8 window (2 × refresh) at 168 h, the boundary spec §6.8 tests at 167/168/169 h.
function scenario() {
  const f = fixture();
  const def = seedDefinition(f, { providers: { discovery: ['searchapi'], verification: ['searchapi'], discoveryRefreshHours: { searchapi: 84 } } });
  const earlier = seedExecution(f, def);
  const ex = seedExecution(f, def);
  const [c167, c168, c169] = cells(3);
  if (c167 === undefined || c168 === undefined || c169 === undefined) throw new Error('cells');
  seedCalendar(f, earlier, [
    { cell: c167, pricePence: 50000, fetchedAt: hoursBefore(NOW, 167) },
    { cell: c168, pricePence: 50000, fetchedAt: hoursBefore(NOW, 168) },
    { cell: c169, pricePence: 50000, fetchedAt: hoursBefore(NOW, 169) },
  ]);
  seedCalendar(f, ex, [c167, c168, c169].map((cell) => ({ cell, pricePence: 40000 })));
  return { f, def, ex, c167, c168, c169 };
}

describe('calendar basis (spec §6.8)', () => {
  it('drops compare only with a previous price fetched within 2 × discoveryRefreshHours (167 h, 168 h in; 169 h out)', async () => {
    const { f, def, ex, c167, c168, c169 } = scenario();
    const rule = seedRule(f, def, { type: 'dropAbs', thresholdPence: 5000, basis: 'calendar' });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(events.map((e) => e.identityKey).sort()).toEqual([c167, c168].map((c) => `${rule.id}|searchapi|economy|${cellKeyString(c)}`).sort());
    expect(events.every((e) => payloadOf(e).previousPence === 50000 && (e.reason ?? '').includes('£500'))).toBe(true);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('New since the last check');
    expect(body).toContain('- £400 LHR→JFK 3 Nov–17 Nov (14n) · Google date grid via SearchApi');
    expect(events.some((e) => e.identityKey.endsWith(cellKeyString(c169)))).toBe(false);
  });

  it('absolute rules still apply to an absent-then-present cell', async () => {
    const { f, def, ex, c169 } = scenario();
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).some((e) => e.identityKey.endsWith(cellKeyString(c169)))).toBe(true);
  });

  it('identity separates providers for the same cell', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');
    seedCalendar(f, ex, [{ cell, pricePence: 40000, providerId: 'searchapi' }, { cell, pricePence: 39000, providerId: 'travelpayouts' }]);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => e.identityKey).sort()).toEqual(
      [`${rule.id}|searchapi|economy|${cellKeyString(cell)}`, `${rule.id}|travelpayouts|economy|${cellKeyString(cell)}`].sort(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.calendar.test.ts`. Expected: FAIL, because the drop test returns `{ digests: 0, events: 0 }`; no previous prices are gathered yet.

- [ ] **Step 3: Implement.** In `runner.ts`, replace `calendarPool` with:

```ts
const DEFAULT_REFRESH_HOURS = 168;

/**
 * Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin; previous = the
 * latest earlier price for (definition, provider, cabin, cell) fetched within 2 × that provider's discoveryRefreshHours. Spec §6.8.
 */
function calendarPool(ctx: RunContext): CalendarCandidate[] {
  return ctx.deps.repos.calendarPrices.fetchedBy(ctx.executionId)
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map((r) => {
      const refresh = ctx.snapshot.providers.discoveryRefreshHours[r.providerId] ?? DEFAULT_REFRESH_HOURS;
      const prev = ctx.deps.repos.calendarPrices.previousFor(ctx.definition.id, r.providerId, r.cabin, r.cell, r.fetchedAt, _hours(r.fetchedAt, 2 * refresh));
      return {
        basis: 'calendar' as const, calendarPriceId: r.id, fetchedByExecutionId: r.executionId, pricePence: r.pricePence, provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.fetchedAt },
      };
    });
}
```

Move `_hours` above `calendarPool` and make it non-exported. Rename it `hoursBefore` and update this one call site.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: calendar-basis drops within 2 x discoveryRefreshHours, absent-then-present listed as new"`

### Task 11.5: dedupKey cooldown across executions, failed deliveries

**Files:**
- Modify `packages/engine/src/alerts/runner.ts`.
- Test `packages/engine/test/alerts/runner.dedup.test.ts`.

**Interfaces:** Consumes `AlertsRepo.priorFirings`, `identityKey` and `Firing.suppressed`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.dedup.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, fixture, RecordingNotifier, seedCalendar, seedDefinition, seedExecution, seedObservation, seedRule } from './fixtures.js';

const DAY = 24 * 3_600_000;

describe('cooldown across executions (spec §6.8, §9 item 4)', () => {
  it('calendar basis: the same price band within cooldownHours is suppressed with a reason; after the cooldown it sends again', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 336 });
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');

    const first = seedExecution(f, def);
    seedCalendar(f, first, [{ cell, pricePence: 41200 }]);
    expect(await runAlerts(f.deps, first)).toEqual({ digests: 1, events: 1 });

    f.clock.advance(7 * DAY);
    const second = seedExecution(f, def);
    seedCalendar(f, second, [{ cell, pricePence: 41250 }]);   // same £412 band
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 0, events: 1 });
    expect(f.notifier.digests()).toHaveLength(1);
    const suppressed = f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).filter((e) => e.status === 'suppressed');
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.reason ?? '').not.toBe('');

    f.clock.advance(8 * DAY);   // 15 days after the first send: past 336 h
    const third = seedExecution(f, def);
    seedCalendar(f, third, [{ cell, pricePence: 41250 }]);
    expect(await runAlerts(f.deps, third)).toEqual({ digests: 1, events: 1 });
  });

  it('inside the cooldown the same identity fires again only at least max(£10, 5%) below the last fired price (spec rev 11 §6.8)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');
    const first = seedExecution(f, def);
    seedCalendar(f, first, [{ cell, pricePence: 41200 }]);
    await runAlerts(f.deps, first);

    f.clock.advance(DAY);
    const higher = seedExecution(f, def);
    seedCalendar(f, higher, [{ cell, pricePence: 43000 }]);
    expect(await runAlerts(f.deps, higher)).toEqual({ digests: 0, events: 1 });

    f.clock.advance(DAY);
    const drift = seedExecution(f, def);
    seedCalendar(f, drift, [{ cell, pricePence: 40800 }]);   // new £408 band but only £4 below £412: under max(£10, 5%) = £20.60
    expect(await runAlerts(f.deps, drift)).toEqual({ digests: 0, events: 1 });

    f.clock.advance(DAY);
    const lower = seedExecution(f, def);
    seedCalendar(f, lower, [{ cell, pricePence: 39000 }]);   // £22 below £412: at least £20.60
    expect(await runAlerts(f.deps, lower)).toEqual({ digests: 1, events: 1 });
  });

  it('verified basis: the same itinerary and band in the next execution is suppressed', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const first = seedExecution(f, def);
    seedObservation(f, first, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    expect(await runAlerts(f.deps, first)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(7 * DAY);
    const second = seedExecution(f, def);
    seedObservation(f, second, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000, fetchedAt: f.clock.now() });
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 0, events: 1 });
  });

  it('a failed delivery is recorded as failed and does not suppress the next execution', async () => {
    const f = fixture({ notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }) });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const [cell] = cells(1);
    if (cell === undefined) throw new Error('cells');
    const first = seedExecution(f, def);
    seedCalendar(f, first, [{ cell, pricePence: 41200 }]);
    await runAlerts(f.deps, first);
    const [failed] = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(failed?.status).toBe('failed');
    expect(failed?.reason).toContain('not delivered: email: connection refused');

    f.clock.advance(DAY);
    const second = seedExecution(f, def);
    seedCalendar(f, second, [{ cell, pricePence: 41200 }]);
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 1, events: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.dedup.test.ts`. Expected: FAIL, because the second run returns `{ digests: 1, events: 1 }` instead of `{ digests: 0, events: 1 }`.

- [ ] **Step 3: Implement.** In `runner.ts`, add `identityKey` to the core import and replace `runRule` with:

```ts
async function runRule(ctx: RunContext, rule: AlertRule): Promise<AlertRunResult> {
  const candidates = poolFor(ctx, rule.basis);
  if (candidates.length === 0) return NONE;
  // why: spec §6.8 suppression looks back cooldownHours over this rule's sent firings for these identities.
  const prior = ctx.deps.repos.alerts.priorFirings(rule.id, [...new Set(candidates.map((c) => identityKey(rule, c)))], hoursBefore(ctx.now, rule.cooldownHours));
  const firings = evaluateAlertRules([rule], candidates, prior, {
    now: ctx.now, executionId: ctx.executionId, cabin: ctx.snapshot.cabin, discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  // why: plan pin — evaluateAlertRules returns suppressed firings too; the runner records them and the digest excludes them.
  const suppressed = firings.filter((f) => f.suppressed !== null);
  const live = firings.filter((f) => f.suppressed === null);
  // why: spec §6.8 — absent-then-present is listed as "new" and is never a drop firing.
  const listings = live.filter((f) => f.isNew && rule.type !== 'absolute');
  const sendable = live.filter((f) => !(f.isNew && rule.type !== 'absolute'));
  ctx.deps.db.transaction(() => {
    for (const f of suppressed) ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, 'suppressed', f.suppressed?.reason ?? `suppressed within the ${rule.cooldownHours}h cooldown`, null));
  });
  if (sendable.length === 0) return { digests: 0, events: suppressed.length };
  const delivered = await deliver(ctx, rule, sendable, listings);
  return { digests: delivered.digests, events: delivered.events + suppressed.length };
}
```

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert cooldown across executions with suppression reasons; failed sends do not suppress"`

### Task 11.6: Synthetic rows refused by the runner

**Files:**
- Modify `packages/engine/src/alerts/runner.ts`.
- Test `packages/engine/test/alerts/runner.refusals.test.ts`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/runner.refusals.test.ts`:

```ts
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { cells, fixture, seedCalendar, seedDefinition, seedExecution, seedObservation, seedRule } from './fixtures.js';

describe('synthetic rows are refused by the runner (spec §5.5, §6.8, §9 item 4)', () => {
  it('fixture calendar rows and fixture observations never become firings, events or digests', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 99999, basis: 'calendar' });
    seedRule(f, def, { thresholdPence: 99999, basis: 'verified', requireAllVerified: false });
    seedCalendar(f, ex, cells(5).map((cell) => ({ cell, pricePence: 100, providerId: 'fixture' as const })));
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 100, synthetic: true });

    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
    expect(f.repos.alerts.events({ definitionId: def.id, limit: 100 })).toHaveLength(0);
    const refusals = f.log.lines.filter((l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused');
    expect(refusals.map((l) => (l.obj as { refused: number }).refused).sort()).toEqual([1, 5]);
  });

  it('runAlerts never rejects: a missing execution is logged and reports nothing', async () => {
    const f = fixture();
    expect(await runAlerts(f.deps, 'no-such-execution')).toEqual({ digests: 0, events: 0 });
    expect(f.log.lines.some((l) => l.level === 'error' && l.msg === 'alerts: step failed; execution still completes')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/runner.refusals.test.ts`. Expected: FAIL in the synthetic test. Either core's own refusal returns no firings but no warn line is logged, or, if core does not refuse, digests are sent. Either way the `refusals` assertion fails.

- [ ] **Step 3: Implement.** In `runner.ts`, add:

```ts
/** Spec §5.5: alerts refuse synthetic rows; the fixture provider ⇔ synthetic invariant is checked both ways. */
function isSynthetic(p: { providerId: string; sourceKind: string }): boolean {
  return p.sourceKind === 'synthetic' || p.providerId === 'fixture';
}

/** Drops synthetic candidates before any rule sees them and logs the count once per basis. */
function refuseSynthetic<T>(ctx: RunContext, basis: AlertRule['basis'], rows: T[], provenanceOf: (r: T) => { providerId: string; sourceKind: string }): T[] {
  const kept = rows.filter((r) => !isSynthetic(provenanceOf(r)));
  const refused = rows.length - kept.length;
  if (refused > 0) ctx.log.warn({ basis, refused }, 'alerts: synthetic rows refused');
  return kept;
}
```

In `calendarPool`, wrap the repository call: `refuseSynthetic(ctx, 'calendar', ctx.deps.repos.calendarPrices.fetchedBy(ctx.executionId), (r) => r.provenance)`. In `verifiedPool`, iterate over `refuseSynthetic(ctx, 'verified', ctx.deps.repos.itineraries.writtenBy(ctx.executionId), (r) => r.provenance)`.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/engine && git commit -m "wp11: alert runner refuses synthetic rows before evaluation"`

### Task 11.7: The engine's alerts step runs runAlerts (layer A), bootstrap wiring

**Files:**
- Modify `apps/api/src/bootstrap/app.ts` (one line).
- Test `packages/engine/test/alerts/engine.alerts.test.ts`.

**Interfaces:**
- **Consumes:** `createEngine(deps, { alerts })`, `AlertsStepHook`, and WP7's `createHarness`.
- **Produces:** the bootstrap line `createEngine({ ...ports, notifiers: buildNotifiers(ports.config, log) }, { alerts: runAlerts })`. Task 11.8 adds `buildNotifiers`; until then this task keeps WP8's notifier list.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/alerts/engine.alerts.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { createEngine, type AlertsStepHook } from '../../src/index.js';
import { createHarness } from '../harness.js';

describe('the §8.1 alerts step runs the alert runner', () => {
  it('runAlerts is an AlertsStepHook and is called once per completed execution with the engine deps', async () => {
    const h = createHarness();
    const hook = vi.fn<AlertsStepHook>(runAlerts);
    const engine = createEngine(h.deps, { ...h.options, alerts: hook });
    const def = h.createDefinition();
    h.repos.alerts.create({ definitionId: def.id, type: 'absolute', thresholdPence: 99999999, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true });
    const execution = await h.runToCompletion(engine, def.id);
    expect(execution.status).toBe('completed');
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(h.deps, execution.id);
    // the fixture provider's rows are synthetic: refused, so nothing is recorded or sent (spec §5.5)
    expect(h.repos.alerts.events({ definitionId: def.id, limit: 100 })).toHaveLength(0);
    expect(h.notifications.filter((m) => (m as { kind?: string }).kind === 'digest')).toHaveLength(0);
    h.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/engine.alerts.test.ts`. Expected: FAIL with `AlertsStepHook` not exported from `../../src/index.js` (a type error under `vitest --typecheck`), or `hook` called 0 times if WP7's `createEngine` ignores `opts.alerts`. Re-run after Step 3.

- [ ] **Step 3: Implement.**
  - In `packages/engine/src/index.ts`, make sure `export type { AlertsStepHook, EngineOptions } from './types.js';` is present. The plan's contract says WP7 exports it; add the line only if WP7's barrel lacks it.
  - In `apps/api/src/bootstrap/app.ts`, replace `const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });` with `const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] }, { alerts: runAlerts });` and add `runAlerts` to the `@gmt/engine` import.

  `// why:` the plan's bootstrap order already reads `createEngine(ports, { alerts: runAlerts })`. This line is the only WP8 code that changes.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/alerts/engine.alerts.test.ts`, then `pnpm --filter @gmt/api test`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git add packages/engine apps/api && git commit -m "wp11: engine alerts step wired to runAlerts (spec §8.1)"`

### Task 11.8: EmailNotifier over nodemailer, notifier wiring

**Files:**
- Create `packages/engine/src/notifiers/email.ts` and `packages/engine/src/notifiers/index.ts`.
- Modify `packages/engine/src/index.ts` and `apps/api/src/bootstrap/app.ts`.
- Test `packages/engine/test/notifiers/email.test.ts`.

- [ ] **Step 1: Write the failing test** in `packages/engine/test/notifiers/email.test.ts`:

```ts
import { Secret, type OperatorMessage } from '@gmt/core';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { renderBody, renderSubject } from '../../src/alerts/templates.js';
import { EmailNotifier, smtpTransportOptions, type MailMessage, type SmtpConfig, type SmtpTransportOptions, type TransportFactory } from '../../src/notifiers/email.js';
import { buildNotifiers } from '../../src/notifiers/index.js';
import { calendarItem, digestOf, NOW, renderInput, ROW_KEY, verifiedItem } from '../alerts/builders.js';
import { captureLogger } from '../alerts/fixtures.js';

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

function digestMessage(items = [verifiedItem()]) {
  const input = renderInput({ digest: digestOf(items) });
  const first = items[0] ?? verifiedItem();
  return { kind: 'digest' as const, digest: input.digest, subject: renderSubject(first, NOW), body: renderBody(input) };
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
    expect(await n.send(digestMessage())).toEqual({ ok: true });
    expect(t.options[0]).toMatchObject({ secure: true });
    const [m] = t.messages;
    expect(m?.envelope).toEqual({ from: 'get-me-there@example.com', to: ['operator@example.com'] });
    expect(m?.parsed.subject).toBe('[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · 1 constraint unverified');
    expect(m?.parsed.html).toBeUndefined();
    expect(m?.parsed.text).toContain('Provenance: Google Flights via SearchApi · fetched 5h ago');
    expect(m?.parsed.text).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');
    expect(m?.parsed.text).toContain('Link: https://www.google.com/travel/clk?tfs=abc (host www.google.com, expires in 3h)');
  });

  it('a POST booking links to the app results row instead', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    await n.send(digestMessage([verifiedItem({ booking: { kind: 'post', url: 'https://www.google.com/travel/clk/f', postData: 'x=1', host: 'www.google.com' } })]));
    expect(t.messages[0]?.parsed.text).toContain(`/?view=results&definition=def-1&row=${encodeURIComponent(ROW_KEY)}`);
  });

  it('refuses synthetic rows before anything is sent', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    const synthetic = calendarItem({ provenance: { ...calendarItem().provenance, providerId: 'fixture', sourceKind: 'synthetic' } });
    const msg = { kind: 'digest' as const, digest: digestOf([calendarItem()], { newItems: [synthetic] }), subject: 's', body: 'b' };
    await expect(n.send(msg)).rejects.toThrow(/synthetic rows refused/);
    expect(t.messages).toHaveLength(0);
  });

  it('strips CR/LF from subjects, so an operator message cannot inject a header', async () => {
    const t = jsonFactory();
    const n = new EmailNotifier({ smtp: smtp(), nodeEnv: 'production', log: captureLogger(), createTransport: t.factory });
    const message: OperatorMessage = { kind: 'paused_error', executionId: 'ex-1', definitionId: 'def-1', subject: '[get-me-there] paused\r\nBcc: victim@example.com', body: 'line one\r\nline two' };
    await n.send({ kind: 'operator', message });
    expect(t.messages[0]?.parsed.subject).toBe('[get-me-there] paused Bcc: victim@example.com');
    expect(t.messages[0]?.parsed.text).toBe('line one\nline two');
  });

  it('a transport failure returns ok:false and the SMTP password reaches neither the detail nor the log', async () => {
    const log = captureLogger();
    const failing: TransportFactory = () => ({ sendMail: async () => { throw new Error(`535 authentication failed for alerts:${PASS} at smtp.example.com`); } });
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
    expect(buildNotifiers({ smtp: null, nodeEnv: 'production' }, captureLogger())).toHaveLength(1);
    expect(buildNotifiers({ smtp: smtp(), nodeEnv: 'production' }, captureLogger()).map((n) => n.id).at(-1)).toBe('email');
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts`. Expected: FAIL, because `../../src/notifiers/email.js` cannot be resolved.

- [ ] **Step 3: Implement.**

`packages/engine/src/notifiers/email.ts`:

```ts
/**
 * EmailNotifier (spec §8.3): nodemailer SMTP, plain text only, SMTP_TLS mapped to transport options,
 * subjects CR/LF-stripped, synthetic rows refused before anything is sent, secrets scrubbed from every error.
 */
import type { AlertDigest, Config, Logger, Notifier } from '@gmt/core';
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
        throw new Error(`SMTP_TLS=none is permitted only for a loopback host or the dev Mailpit profile; host ${smtp.host} refused (spec §8.3)`);
      }
      return { ...base, secure: false, ignoreTLS: true };
  }
}

const defaultFactory: TransportFactory = (o) => nodemailer.createTransport(o);

/** Spec §5.5: notifiers refuse synthetic rows, in the listed items and in the "new" section alike. */
function refuseSynthetic(d: AlertDigest): void {
  if ([...d.items, ...d.newItems].some((i) => i.provenance.sourceKind === 'synthetic' || i.provenance.providerId === 'fixture')) {
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

  async send(msg: Parameters<Notifier['send']>[0]): Promise<{ ok: boolean; detail?: string }> {
    if (msg.kind === 'digest') refuseSynthetic(msg.digest);
    const subject = msg.kind === 'digest' ? msg.subject : msg.message.subject;
    const body = msg.kind === 'digest' ? msg.body : msg.message.body;
    // why: bodies are LF-only plain text; a stray CR from any source is normalised away.
    const mail: MailMessage = { from: this.smtp.from, to: this.smtp.to, subject: stripControl(subject), text: body.replace(/\r\n?/g, '\n') };
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

Add the following to `packages/engine/src/index.ts`:

```ts
export { EmailNotifier, smtpTransportOptions, type MailMessage, type MailTransport, type SmtpConfig, type SmtpTransportOptions, type TransportFactory } from './notifiers/email.js';
export { buildNotifiers } from './notifiers/index.js';
```

In `apps/api/src/bootstrap/app.ts`, replace the Task 11.7 line with:

```ts
const engine = createEngine({ ...ports, notifiers: buildNotifiers(ports.config, log) }, { alerts: runAlerts });
```

Import `buildNotifiers` from `@gmt/engine`, and drop `LogNotifier` from that import if nothing else uses it.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/engine exec vitest run test/notifiers/email.test.ts`, which should PASS with 7 tests. Then run `pnpm --filter @gmt/api test`, which should PASS. WP8's sentinel-key test already lists `SMTP_PASS`, so it now covers the email path.

- [ ] **Step 5: Commit.** `git add packages/engine apps/api && git commit -m "wp11: EmailNotifier over nodemailer with SMTP_TLS mapping and synthetic refusal"`

### Task 11.9: Alerts view: rule form

**Files:**
- Create `apps/web/src/views/Alerts/RuleForm.tsx`, `AlertsView.tsx` and `index.ts`.
- Modify `apps/web/src/api/endpoints.ts`, `apps/web/src/copy.ts` and `apps/web/src/App.tsx`.
- Test `apps/web/test/views/Alerts/RuleForm.test.tsx`.

**Interfaces:**
- **Consumes:** `alertRuleInputSchema`, `AlertRule`, `AlertRuleInput`, WP9's `call`, `api`, `COPY`, `parsePoundsToPence`, `renderWithProviders` and `server`.
- **Produces:** `AlertsView`, `describeRule`, `COPY.alertsView`, `api.alertRules/createAlertRule/deleteAlertRule/alertEvents`.

- [ ] **Step 1: Write the failing test** in `apps/web/test/views/Alerts/RuleForm.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AlertsView } from '../../../src/views/Alerts/index.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const C = COPY.alertsView;
let posted: Array<{ body: unknown; xrw: string | null; ct: string | null }> = [];

beforeEach(() => {
  posted = [];
  server.use(
    http.get('*/api/alerts', () => HttpResponse.json([])),
    http.get('*/api/alerts/events', () => HttpResponse.json([])),
    http.post('*/api/alerts', async ({ request }) => {
      const body = await request.json();
      posted.push({ body, xrw: request.headers.get('X-Requested-With'), ct: request.headers.get('Content-Type') });
      return HttpResponse.json({ id: `rule-${posted.length}`, ...(body as object) }, { status: 201 });
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
      body: { definitionId: 'def-1', type: 'absolute', thresholdPence: 45000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true },
      xrw: 'get-me-there', ct: 'application/json',
    });
  });

  it('a percentage drop sends pct; pounds with pence convert without floats', async () => {
    const { user } = renderWithProviders(<AlertsView definitionId="def-1" />);
    await user.selectOptions(await screen.findByLabelText(C.ruleType), 'dropPct');
    await user.type(screen.getByLabelText(C.dropPct), '12');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ definitionId: 'def-1', type: 'dropPct', thresholdPence: null, pct: 12, basis: 'verified', requireAllVerified: false, cooldownHours: 336, enabled: true });

    await user.selectOptions(screen.getByLabelText(C.ruleType), 'dropAbs');
    await user.type(screen.getByLabelText(C.threshold), '20.50');
    await user.click(screen.getByRole('button', { name: C.addRule }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect((posted[1]?.body as { thresholdPence: number }).thresholdPence).toBe(2050);
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

In `apps/web/src/copy.ts`, add this entry to `COPY`:

```ts
  // Alerts view (WP11; spec §6.8, §11). "verified" appears only beside class-verified values.
  alertsView: {
    heading: 'Alerts',
    intro: 'One email per rule per run, listing the ten cheapest matches and a count of the rest. Each price says where it came from and how old it is.',
    formLabel: 'New alert rule',
    ruleType: 'Rule type',
    typeAbsolute: 'Price at or below', typeDropPct: 'Drop by percent', typeDropAbs: 'Drop by amount',
    threshold: 'Threshold (£)', dropPct: 'Drop (%)',
    basis: 'Basis',
    basisVerified: 'Itinerary-search basis (class verified or partially-verified)',
    basisCalendar: 'Calendar basis (constraints not checked)',
    requireAll: 'Only class verified (every constraint passed)',
    requireAllCalendarNote: 'Calendar prices carry no constraint checks, so this option applies to the itinerary-search basis only.',
    cooldown: 'Cooldown (hours)',
    cooldownHint: 'Default 336 h (two weeks), deliberately longer than a weekly schedule.',
    addRule: 'Add rule', deleteRule: 'Delete rule',
    deleteKeepsHistory: 'Deleting a rule stops it firing; its alert history below is kept.',
    fieldError: (field: string, message: string) => `${field}: ${message}`,
    notSaved: (message: string) => `Rule not saved: ${message}`,
    rulesHeading: 'Rules', noRules: 'No alert rules for this definition yet.',
    eventsHeading: 'Alert events', eventsTable: 'Alert events', noEvents: 'No alerts have fired for this definition yet.',
    colFired: 'Fired', colRule: 'Rule', colStatus: 'Status', colPrice: 'Price', colReason: 'Reason',
    statusSent: 'sent', statusFailed: 'failed', statusSuppressed: 'suppressed',
    noReason: 'no reason recorded',
    firedAt: (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`,
  },
```

In `apps/web/src/api/endpoints.ts`, import `type { AlertEvent, AlertRule, AlertRuleInput } from '@gmt/core'` and add these to `api`:

```ts
  alertRules: (definitionId: string) => call<AlertRule[]>('GET', '/api/alerts', { query: { definitionId } }),
  createAlertRule: (body: AlertRuleInput) => call<AlertRule>('POST', '/api/alerts', { body }),
  // why: DELETE soft-deletes the rule (AlertsRepo.softDelete, plan decision 15); its events stay listed.
  deleteAlertRule: (id: string) => call<AlertRule>('DELETE', '/api/alerts/:id', { params: { id } }),
  alertEvents: (definitionId: string, limit: number) => call<AlertEvent[]>('GET', '/api/alerts/events', { query: { definitionId, limit: String(limit) } }),
```

`// why:` the plan's `ROUTES` paths carry the `/api` prefix, and `findRoute` matches them exactly. If WP9 merged with unprefixed templates, use the same form as its other entries.

`apps/web/src/views/Alerts/RuleForm.tsx`:

```tsx
/** Alert rule form (spec §6.8, §11): type, threshold or pct, basis, requireAllVerified on the verified basis only, cooldown. */
import { alertRuleInputSchema, type AlertRuleInput } from '@gmt/core';
import { useState, type FormEvent } from 'react';
import { COPY } from '../../copy.js';
import { parsePoundsToPence } from '../../format.js';

const C = COPY.alertsView;
type RuleType = AlertRuleInput['type'];
type Basis = AlertRuleInput['basis'];

/** Maps the first path segment of a zod issue to the field label it belongs to. */
const FIELD_LABEL: Record<string, string> = { thresholdPence: C.threshold, pct: C.dropPct, cooldownHours: C.cooldown, basis: C.basis, requireAllVerified: C.requireAll, type: C.ruleType };

export function RuleForm(props: { definitionId: string; onSubmit: (body: AlertRuleInput) => void; busy: boolean }) {
  const [type, setType] = useState<RuleType>('absolute');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState('');
  const [basis, setBasis] = useState<Basis>('verified');
  const [requireAll, setRequireAll] = useState(false);
  const [cooldown, setCooldown] = useState('336');
  const [errors, setErrors] = useState<string[]>([]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      definitionId: props.definitionId, type,
      thresholdPence: type === 'dropPct' ? null : (parsePoundsToPence(amount) ?? Number.NaN),
      pct: type === 'dropPct' ? (pct.trim() === '' ? Number.NaN : Number(pct)) : null,
      basis,
      // why: spec §6.8 — requireAllVerified exists only on the verified basis; the schema rejects it on the calendar basis.
      requireAllVerified: basis === 'verified' ? requireAll : null,
      cooldownHours: cooldown.trim() === '' ? Number.NaN : Number(cooldown), enabled: true,
    };
    const parsed = alertRuleInputSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => C.fieldError(FIELD_LABEL[String(i.path[0])] ?? C.formLabel, i.message)));
      return;
    }
    setErrors([]);
    props.onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-3" aria-label={C.formLabel}>
      <label className="grid gap-1">
        <span>{C.ruleType}</span>
        <select aria-label={C.ruleType} value={type} onChange={(e) => setType(e.target.value as RuleType)}>
          <option value="absolute">{C.typeAbsolute}</option>
          <option value="dropPct">{C.typeDropPct}</option>
          <option value="dropAbs">{C.typeDropAbs}</option>
        </select>
      </label>
      {type === 'dropPct' ? (
        <label className="grid gap-1">
          <span>{C.dropPct}</span>
          <input aria-label={C.dropPct} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
        </label>
      ) : (
        <label className="grid gap-1">
          <span>{C.threshold}</span>
          <input aria-label={C.threshold} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      <label className="grid gap-1">
        <span>{C.basis}</span>
        <select aria-label={C.basis} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
          <option value="verified">{C.basisVerified}</option>
          <option value="calendar">{C.basisCalendar}</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" aria-label={C.requireAll} disabled={basis === 'calendar'} checked={basis === 'verified' && requireAll} onChange={(e) => setRequireAll(e.target.checked)} />
        <span>{C.requireAll}</span>
      </label>
      {basis === 'calendar' ? <p className="text-sm">{C.requireAllCalendarNote}</p> : null}
      <label className="grid gap-1">
        <span>{C.cooldown}</span>
        <input aria-label={C.cooldown} type="number" min={1} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
        <span className="text-sm">{C.cooldownHint}</span>
      </label>
      {errors.length > 0 ? <div role="alert" className="text-sm text-red-800">{errors.map((m) => <p key={m}>{m}</p>)}</div> : null}
      <button type="submit" disabled={props.busy}>{C.addRule}</button>
    </form>
  );
}
```

`apps/web/src/views/Alerts/AlertsView.tsx`:

```tsx
/** Alerts view (spec §11): the rule form and the rules list. Task 11.10 adds the events list. */
import type { AlertRule } from '@gmt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import { COPY } from '../../copy.js';
import { formatPence } from '@gmt/core';
import { RuleForm } from './RuleForm.js';

const C = COPY.alertsView;

/** One line per rule, in the same words as the email's "Rule:" line (built from catalogue strings only). */
export function describeRule(r: AlertRule): string {
  const what = r.type === 'absolute' ? `${C.typeAbsolute} ${formatPence(r.thresholdPence ?? 0)}`
    : r.type === 'dropAbs' ? `${C.typeDropAbs} ${formatPence(r.thresholdPence ?? 0)}` : `${C.typeDropPct} ${r.pct ?? 0}%`;
  const basis = r.basis === 'calendar' ? C.basisCalendar : r.requireAllVerified === true ? C.requireAll : C.basisVerified;
  return `${what} · ${basis} · ${C.cooldown} ${r.cooldownHours}`;
}

export const alertKeys = { rules: (id: string) => ['alerts', id] as const, events: (id: string) => ['alert-events', id] as const };

export function AlertsView(props: { definitionId: string }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: alertKeys.rules(props.definitionId), queryFn: () => api.alertRules(props.definitionId) });
  const refresh = () => qc.invalidateQueries({ queryKey: alertKeys.rules(props.definitionId) });
  const create = useMutation({ mutationFn: api.createAlertRule, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: refresh });
  const list = rules.data ?? [];

  return (
    <section aria-labelledby="alerts-heading" className="grid gap-6">
      <h2 id="alerts-heading">{C.heading}</h2>
      <p>{C.intro}</p>
      <RuleForm definitionId={props.definitionId} onSubmit={(b) => create.mutate(b)} busy={create.isPending} />
      {create.isError ? <p role="alert">{C.notSaved(create.error.message)}</p> : null}
      <div>
        <h3>{C.rulesHeading}</h3>
        <p className="text-sm">{C.deleteKeepsHistory}</p>
        {rules.isLoading ? <p>{COPY.loading}</p> : list.length === 0 ? <p>{C.noRules}</p> : (
          <ul>
            {list.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span>{describeRule(r)}</span>
                <button type="button" onClick={() => remove.mutate(r.id)}>{C.deleteRule}</button>
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
export { AlertsView, describeRule } from './AlertsView.js';
```

In `apps/web/src/App.tsx`, replace `{view === 'alerts' ? <Placeholder wp="WP11" /> : null}` with `{view === 'alerts' && selected !== null ? <AlertsView definitionId={selected.id} /> : null}`. Also add `import { AlertsView } from './views/Alerts/index.js';`. Add `'alerts'` to the views that set `needsDefinition`, if WP9's App keeps that list.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/web exec vitest run test/views/Alerts/RuleForm.test.tsx`, which should PASS with 4 tests. Then run `pnpm --filter @gmt/web test`; the catalogue, source-guard and DOM-sweep tests from WP9 should still be green.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "wp11: Alerts view rule form validated by alertRuleInputSchema"`

### Task 11.10: Alerts view: events list and banned words

**Files:**
- Create `apps/web/src/views/Alerts/EventsTable.tsx`.
- Modify `apps/web/src/views/Alerts/AlertsView.tsx`.
- Test `apps/web/test/views/Alerts/AlertsView.test.tsx`.

- [ ] **Step 1: Write the failing test** in `apps/web/test/views/Alerts/AlertsView.test.tsx`:

```tsx
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AlertsView, describeRule } from '../../../src/views/Alerts/index.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const C = COPY.alertsView;
const rules = [
  { id: 'r1', definitionId: 'def-1', type: 'absolute', thresholdPence: 45000, pct: null, basis: 'calendar', requireAllVerified: null, cooldownHours: 336, enabled: true },
  { id: 'r2', definitionId: 'def-1', type: 'dropPct', thresholdPence: null, pct: 10, basis: 'verified', requireAllVerified: true, cooldownHours: 336, enabled: true },
] as const;
const payload = (pricePence: number) => ({ digestId: 'd1', executionId: 'ex-1', pricePence, previousPence: null, isNew: false, label: '£412 LHR→JFK 14 Mar–28 Mar (14n)' });
const events = [
  { id: 1, ruleId: 'r1', identityKey: 'r1|x', observationId: null, calendarPriceId: 5, dedupKey: 'r1|x|412', firedAt: '2026-10-14T05:12:00.000Z', status: 'sent', reason: '£412 is at or below the £450 threshold', payload: payload(41200) },
  { id: 2, ruleId: 'r1', identityKey: 'r1|x', observationId: null, calendarPriceId: 6, dedupKey: 'r1|x|412', firedAt: '2026-10-21T05:10:00.000Z', status: 'suppressed', reason: 'same £412 band alerted 7d ago; cooldown 336h', payload: payload(41250) },
  { id: 3, ruleId: 'r2', identityKey: 'r2|y', observationId: 9, calendarPriceId: null, dedupKey: 'r2|y|412', firedAt: '2026-10-21T05:11:00.000Z', status: 'failed', reason: 'dropped 12% from £468; not delivered: email: connection refused', payload: payload(41200) },
  { id: 4, ruleId: 'other-definition-rule', identityKey: 'z', observationId: null, calendarPriceId: 7, dedupKey: 'z|1', firedAt: '2026-10-21T05:11:00.000Z', status: 'sent', reason: 'not this definition', payload: payload(100) },
];

function withData(r: unknown = rules, e: unknown = events) {
  server.use(
    http.get('*/api/alerts', () => HttpResponse.json(r)),
    // the server filters by definition (alertEventsQuerySchema.definitionId); this handler proves the view asks for it
    http.get('*/api/alerts/events', ({ request }) => {
      const all = e as Array<{ ruleId: string }>;
      return HttpResponse.json(new URL(request.url).searchParams.get('definitionId') === 'def-1' ? all.filter((x) => x.ruleId !== 'other-definition-rule') : all);
    }),
  );
}

describe('Alerts events list (spec §11)', () => {
  it('shows this definition\'s events with status in words and the reason; other definitions\' events are not shown', async () => {
    withData();
    renderWithProviders(<AlertsView definitionId="def-1" />);
    const table = await screen.findByRole('table', { name: C.eventsTable });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText(C.statusSuppressed)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('same £412 band alerted 7d ago; cooldown 336h')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText(C.statusFailed)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(describeRule(rules[0]))).toBeInTheDocument();
    expect(screen.queryByText('not this definition')).toBeNull();
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

Create `apps/web/src/views/Alerts/EventsTable.tsx`:

```tsx
/** Alert events (spec §11): when, which rule, status in words, the priced route, reason. */
import type { AlertEvent } from '@gmt/core';
import { COPY } from '../../copy.js';

const C = COPY.alertsView;
const STATUS: Record<AlertEvent['status'], string> = { sent: C.statusSent, failed: C.statusFailed, suppressed: C.statusSuppressed };

/** The runner's payload label (WP11 runner), read defensively because payload is `unknown` on the wire. */
function labelOf(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && typeof (payload as { label?: unknown }).label === 'string' ? (payload as { label: string }).label : '';
}

export function EventsTable(props: { events: readonly AlertEvent[]; ruleText: ReadonlyMap<string, string> }) {
  if (props.events.length === 0) return <p>{C.noEvents}</p>;
  return (
    <table aria-label={C.eventsTable}>
      <thead>
        <tr><th scope="col">{C.colFired}</th><th scope="col">{C.colRule}</th><th scope="col">{C.colStatus}</th><th scope="col">{C.colPrice}</th><th scope="col">{C.colReason}</th></tr>
      </thead>
      <tbody>
        {props.events.map((e) => (
          <tr key={e.id}>
            <td><time dateTime={e.firedAt}>{C.firedAt(e.firedAt)}</time></td>
            <td>{props.ruleText.get(e.ruleId) ?? e.ruleId}</td>
            <td>{STATUS[e.status]}</td>
            <td>{labelOf(e.payload)}</td>
            <td>{e.reason ?? C.noReason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

In `AlertsView.tsx`:
1. Import `EventsTable` from `./EventsTable.js`.
2. Update the doc comment to "the rule form, the rules list and the events list".
3. After `const list = …`, add:

```tsx
  const events = useQuery({ queryKey: alertKeys.events(props.definitionId), queryFn: () => api.alertEvents(props.definitionId, 200) });
  const ruleText = new Map(list.map((r) => [r.id, describeRule(r)] as const));
  const mine = events.data ?? [];
```

4. Before `</section>`, add:

```tsx
      <div>
        <h3>{C.eventsHeading}</h3>
        {/* why: the Rule column shows each rule in words, so the table waits for both queries */}
        {rules.isLoading || events.isLoading ? <p>{COPY.loading}</p> : <EventsTable events={mine} ruleText={ruleText} />}
      </div>
```

5. In the create and delete mutations, also invalidate `alertKeys.events(props.definitionId)`.

- [ ] **Step 4: Run to verify it passes.** Run `pnpm --filter @gmt/web test`. Expected: PASS, with web thresholds of 70/60 met.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "wp11: Alerts events list with status and reason; banned-word test over the view"`

## 9. Pinned review-focus tests

WP11 owns none of the plan's Review Focus lines. The spec requirements this package carries, and where each is pinned:

| Requirement | Test |
|---|---|
| §9 item 4: 50 qualifying cells → one email | Task 11.1, "50 qualifying calendar cells…" |
| §6.8: calendar reused rows excluded | Task 11.1, "only calendar prices fetched by this execution count…" |
| §8.3: subject formats, provenance line, link with expiry, POST → app row, coverage caveat | Task 11.2 |
| §8.3: CRLF injection in a seller name | Task 11.2; Task 11.8 subject stripping |
| §8.3 / §11: banned words over rendered email | Task 11.2 |
| §6.8: verified candidates from the current execution only; requireAllVerified; drop vs previous observation | Task 11.3 |
| §6.8: drop window 167/168/169 h; absent-then-present is "new" | Task 11.4 |
| §9 item 4: dedup across executions, both bases, with reason | Task 11.5 |
| §9 item 4: synthetic refused by alerts | Task 11.6; Task 11.7 (layer A) |
| §9 item 4: synthetic refused by notifiers | Task 11.8 |
| §5.3: SMTP password never in a log line or error detail | Task 11.8 |
| §9 item 6: banned words over the Alerts view | Task 11.10 (plus WP9's catalogue and source guards over `COPY.alertsView`) |

## 10. Definition of done

- `pnpm --filter @gmt/engine test` passes, with coverage ≥ 85% lines and ≥ 70% branches.
- `pnpm --filter @gmt/web test` passes, with coverage ≥ 70% lines and ≥ 60% branches. WP9's catalogue, source-guard and DOM-sweep tests stay green.
- `pnpm --filter @gmt/api test` passes.
- `pnpm -r test` passes.
- `pnpm lint` reports no diagnostics. The one `biome-ignore` in `templates.ts` carries its reason.
- `pnpm -r typecheck` reports no errors.
- `node scripts/check-boundaries.mjs` exits 0.
- `grep -rn "process.env" packages/engine/src apps/web/src` prints nothing.
- `grep -rnE "\b(LHR|LGW|JFK|EWR|LON|NYC)\b" packages/engine/src apps/web/src/views/Alerts` prints nothing.

## 11. Open questions

None. The assumptions at the end of section 4 are about the internal behaviour of WP2, WP3 and WP7 functions whose signatures the plan fixes. They are checked again when wave 7 opens.
